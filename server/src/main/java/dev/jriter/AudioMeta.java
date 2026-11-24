package dev.jriter;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Length, bitrate and a coarse drawn shape of an audio file: a port of jriter/audio_meta.py,
 * with the same numbers (the tests pin them). Never throws; anything unreadable is a fact
 * about the file, not a failed upload.
 */
public final class AudioMeta {
    private AudioMeta() {}

    static final int PEAK_COLUMNS = 120;
    static final double SILENT_DB = -60.0;
    private static final int[] BR_V1 = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0};
    private static final int[] BR_V2 = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0};

    public record Probe(double duration, int bitrate) {}

    public record Peaks(List<Integer> peaks, Double peakDb, boolean silent, boolean unreadable) {}

    static String extOf(Path p, String ext) {
        if (ext != null && !ext.isEmpty()) return ext.toLowerCase(Locale.ROOT);
        String n = p.getFileName().toString();
        int dot = n.lastIndexOf('.');
        return dot < 0 ? "" : n.substring(dot).toLowerCase(Locale.ROOT);
    }

    static double round(double v, int places) {
        double m = Math.pow(10, places);
        return Math.round(v * m) / m;
    }

    public static Probe probe(Path path, String ext) {
        try {
            String e = extOf(path, ext);
            if (e.equals(".wav")) return wav(path);
            if (e.equals(".mp3")) return mp3(path);
        } catch (Exception ignored) {
            // unreadable is not an error here
        }
        return new Probe(0.0, 0);
    }

    // -- WAV ----------------------------------------------------------------------
    /** What the fmt and data chunks say; null if this is not a PCM wav (Python's wave raises). */
    record Wav(int channels, int width, int rate, long frames, long dataAt, long dataBytes) {}

    static Wav readWav(RandomAccessFile f) throws IOException {
        byte[] head = new byte[12];
        f.readFully(head);
        if (head[0] != 'R' || head[1] != 'I' || head[2] != 'F' || head[3] != 'F'
                || head[8] != 'W' || head[9] != 'A' || head[10] != 'V' || head[11] != 'E')
            throw new IOException("not a wav");
        int channels = 0, width = 0, rate = 0;
        boolean fmt = false;
        while (f.getFilePointer() + 8 <= f.length()) {
            byte[] h = new byte[8];
            f.readFully(h);
            ByteBuffer b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN);
            String id = new String(h, 0, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
            long size = b.getInt(4) & 0xFFFFFFFFL;
            long at = f.getFilePointer();
            if (id.equals("fmt ")) {
                byte[] c = new byte[(int) Math.min(size, 16)];
                f.readFully(c);
                ByteBuffer cb = ByteBuffer.wrap(c).order(ByteOrder.LITTLE_ENDIAN);
                if (cb.getShort(0) != 1) throw new IOException("not PCM");
                channels = cb.getShort(2);
                rate = cb.getInt(4);
                width = (cb.getShort(14) + 7) / 8;
                fmt = true;
            } else if (id.equals("data")) {
                if (!fmt) throw new IOException("data before fmt");
                if (channels <= 0 || width <= 0) throw new IOException("bad fmt");
                long frames = size / ((long) channels * width);
                return new Wav(channels, width, rate, frames, at, size);
            }
            f.seek(at + size + (size & 1));
        }
        throw new IOException("no data chunk");
    }

    static Probe wav(Path path) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(path.toFile(), "r")) {
            Wav w = readWav(f);
            double duration = w.rate() != 0 ? w.frames() / (double) w.rate() : 0.0;
            int bitrate = (int) ((double) w.rate() * w.channels() * w.width() * 8 / 1000);
            return new Probe(round(duration, 3), bitrate);
        }
    }

    public static Peaks peaks(Path path, String ext) {
        Peaks empty = new Peaks(List.of(), null, false, false);
        if (!extOf(path, ext).equals(".wav")) return empty;
        try {
            return wavPeaks(path, PEAK_COLUMNS);
        } catch (Exception e) {
            return new Peaks(List.of(), null, false, true);
        }
    }

    static Peaks wavPeaks(Path path, int columns) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(path.toFile(), "r")) {
            Wav w = readWav(f);
            long frames = w.frames();
            int width = w.width();
            if (frames == 0 || width > 4)
                return new Peaks(List.of(), null, true, frames == 0);
            long per = Math.max(1, frames / columns);
            double full = (double) (1L << (width * 8 - 1));
            List<Integer> shape = new ArrayList<>();
            double loudest = 0.0;
            int frameBytes = w.channels() * width;
            for (int column = 0; column < columns; column++) {
                long start = column * per;
                if (start >= frames) { shape.add(0); continue; }
                long count = Math.min(per, frames - start);
                long want = count * frameBytes;
                long have = Math.max(0, Math.min(want, f.length() - (w.dataAt() + start * frameBytes)));
                if (have <= 0) { shape.add(0); continue; }
                byte[] raw = new byte[(int) have];
                f.seek(w.dataAt() + start * frameBytes);
                f.readFully(raw);
                double highest = loudest(raw, width, w.channels());
                loudest = Math.max(loudest, highest);
                shape.add((int) Math.min(255, (long) ((highest / full) * 255)));
            }
            Double db = loudest > 0 ? 20 * Math.log10(loudest / full) : null;
            Double rounded = db == null ? null : round(db, 2);
            return new Peaks(shape, rounded, db == null || db < SILENT_DB, false);
        }
    }

    static double loudest(byte[] raw, int width, int channels) {
        int step = Math.max(1, channels * width * 8);
        long biggest = 0;
        if (width == 1) {
            for (int i = 0; i < raw.length; i += Math.max(1, channels * 8))
                biggest = Math.max(biggest, Math.abs((raw[i] & 0xFF) - 128) * 256L);
            return (double) biggest;
        }
        for (int i = 0; i + width <= raw.length; i += step) {
            long v = 0;
            for (int k = width - 1; k >= 0; k--) v = (v << 8) | (raw[i + k] & 0xFF);
            if ((raw[i + width - 1] & 0x80) != 0) v -= 1L << (width * 8);
            v = Math.abs(v);
            if (v > biggest) biggest = v;
        }
        return (double) biggest;
    }

    // -- MP3 ----------------------------------------------------------------------
    record Header(int bitrate, int rate, int samples, int length) {}

    static Header parseHeader(long word) {
        if ((word & 0xFFE00000L) != 0xFFE00000L) return null;
        int version = (int) ((word >> 19) & 0x3);
        int layer = (int) ((word >> 17) & 0x3);
        int brIx = (int) ((word >> 12) & 0xF);
        int rateIx = (int) ((word >> 10) & 0x3);
        int padding = (int) ((word >> 9) & 0x1);
        if (layer != 1 || version == 1 || brIx == 0 || brIx == 15 || rateIx == 3) return null;
        int bitrate = (version == 3 ? BR_V1 : BR_V2)[brIx];
        int[][] rates = {{11025, 12000, 8000}, null, {22050, 24000, 16000}, {44100, 48000, 32000}};
        int rate = rates[version][rateIx];
        if (bitrate == 0 || rate == 0) return null;
        int samples = version == 3 ? 1152 : 576;
        int length = (int) ((samples / 8) * 1000.0 * bitrate / rate) + padding;
        return new Header(bitrate, rate, samples, length);
    }

    static Probe mp3(Path path) throws IOException {
        long size = Files.size(path);
        try (RandomAccessFile f = new RandomAccessFile(path.toFile(), "r")) {
            long start = 0;
            byte[] id3 = new byte[10];
            int got = f.read(id3);
            if (got == 10 && id3[0] == 'I' && id3[1] == 'D' && id3[2] == '3') {
                long s = 0;
                for (int i = 6; i < 10; i++) s = (s << 7) | (id3[i] & 0x7F);
                start = 10 + s;
            }
            f.seek(start);
            byte[] window = new byte[65536];
            int n = Math.max(0, f.read(window));
            Header first = null;
            for (int i = 0; i < n - 4; i++) {
                long word = ((window[i] & 0xFFL) << 24) | ((window[i + 1] & 0xFFL) << 16)
                        | ((window[i + 2] & 0xFFL) << 8) | (window[i + 3] & 0xFFL);
                first = parseHeader(word);
                if (first != null) { start += i; break; }
            }
            if (first == null) return new Probe(0.0, 0);
            f.seek(start);
            byte[] head = new byte[first.length() > 4 ? first.length() + 4 : 1024];
            int hn = Math.max(0, f.read(head));
            head = java.util.Arrays.copyOf(head, hn);
            long frames = xingFrames(head);
            if (frames > 0) {
                double duration = frames * first.samples() / (double) first.rate();
                long audioBytes = size - start;
                int bitrate = duration != 0 ? (int) (audioBytes * 8 / duration / 1000) : first.bitrate();
                return new Probe(round(duration, 3), bitrate);
            }
            double duration = (size - start) * 8 / (double) (first.bitrate() * 1000L);
            return new Probe(round(duration, 3), first.bitrate());
        }
    }

    static int find(byte[] h, String tag) {
        byte[] t = tag.getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        outer:
        for (int i = 0; i + t.length <= h.length; i++) {
            for (int k = 0; k < t.length; k++) if (h[i + k] != t[k]) continue outer;
            return i;
        }
        return -1;
    }

    static long u32(byte[] h, int at) { return ByteBuffer.wrap(h, at, 4).order(ByteOrder.BIG_ENDIAN).getInt() & 0xFFFFFFFFL; }

    static long xingFrames(byte[] head) {
        for (String tag : new String[] {"Xing", "Info"}) {
            int at = find(head, tag);
            if (at != -1 && head.length >= at + 12 && (u32(head, at + 4) & 1) != 0) return u32(head, at + 8);
        }
        int at = find(head, "VBRI");
        if (at != -1 && head.length >= at + 22) return u32(head, at + 14);
        return 0;
    }
}
