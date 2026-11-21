package dev.jriter.desktop;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Reads which plugins an FL Studio project (.flp) uses. Follows PyFLP's description of the
 * format: header "FLhd", then "FLdt" and a run of events. Event id 0-63 carries 1 byte,
 * 64-127 two, 128-191 four, 192+ a varint length and that many bytes. Id 201 is a plugin's
 * internal name; "Fruity Wrapper" means a VST, whose details sit in the next 213 event.
 * A cut-off or odd file returns what was found before the problem.
 */
public final class FlProject {
    /** kind is "vst2", "vst3" or "fl". */
    public record Plugin(String kind, String name, String vendor, String path, int uses) { }

    private static final int INTERNAL_NAME = 201, PLUGIN_DATA = 213;
    private static final String WRAPPER = "Fruity Wrapper";

    private FlProject() { }

    public static List<Plugin> plugins(Path flp) throws IOException {
        return plugins(Files.readAllBytes(flp));
    }

    public static List<Plugin> plugins(byte[] d) throws IOException {
        if (d.length < 14 || d[0] != 'F' || d[1] != 'L' || d[2] != 'h' || d[3] != 'd')
            throw new IOException("not an FL Studio project");
        long hlen = u32(d, 4);
        int p = (int) Math.min(d.length, 8 + hlen);
        if (p + 8 > d.length || d[p] != 'F' || d[p + 1] != 'L' || d[p + 2] != 'd' || d[p + 3] != 't')
            throw new IOException("not an FL Studio project");
        long dlen = u32(d, p + 4);
        p += 8;
        int end = (int) Math.min(d.length, p + dlen);

        Map<String, Plugin> found = new LinkedHashMap<>();
        String pending = null;
        while (p < end) {
            int id = d[p++] & 0xff;
            int from, len;
            if (id < 64) { from = p; len = 1; }
            else if (id < 128) { from = p; len = 2; }
            else if (id < 192) { from = p; len = 4; }
            else {
                long n = 0; int shift = 0; boolean ok = false;
                while (p < end && shift < 35) {
                    int b = d[p++] & 0xff;
                    n |= (long) (b & 0x7f) << shift;
                    shift += 7;
                    if ((b & 0x80) == 0) { ok = true; break; }
                }
                if (!ok) break;
                from = p; len = (int) Math.min(n, Integer.MAX_VALUE);
            }
            if (len < 0 || from + len > end) break;
            if (id == INTERNAL_NAME) {
                if (pending != null) add(found, pending, null);
                pending = text(d, from, len);
            } else if (id == PLUGIN_DATA && pending != null) {
                add(found, pending, Arrays.copyOfRange(d, from, from + len));
                pending = null;
            }
            p = from + len;
        }
        if (pending != null) add(found, pending, null);

        List<Plugin> out = new ArrayList<>(found.values());
        out.sort(Comparator.comparing((Plugin x) -> x.kind().equals("fl")).thenComparing(x -> x.name().toLowerCase()));
        return out;
    }

    private static void add(Map<String, Plugin> found, String internal, byte[] data) {
        Plugin pl;
        if (internal.equals(WRAPPER)) pl = vst(data);
        else pl = new Plugin("fl", internal, "", "", 1);
        String key = pl.kind() + "|" + pl.name() + "|" + pl.vendor();
        Plugin old = found.get(key);
        found.put(key, old == null ? pl : new Plugin(pl.kind(), pl.name(), pl.vendor(), pl.path(), old.uses() + 1));
    }

    private static Plugin vst(byte[] b) {
        String name = "", vendor = "", path = "";
        if (b != null && b.length >= 4) {
            long type = u32(b, 0);
            if (type == 8 || type == 10) {
                int p = 4;
                while (p + 12 <= b.length) {
                    long id = u32(b, p);
                    long size = u64(b, p + 4);
                    p += 12;
                    if (size < 0 || size > b.length - p) break;
                    int s = (int) size;
                    String v = new String(b, p, s, StandardCharsets.UTF_8).replace("\0", "").trim();
                    if (id == 54) name = v; else if (id == 56) vendor = v; else if (id == 55) path = v;
                    p += s;
                }
            }
        }
        if (name.isEmpty()) name = "unknown VST";
        return new Plugin(path.toLowerCase().endsWith(".vst3") ? "vst3" : "vst2", name, vendor, path, 1);
    }

    private static String text(byte[] d, int from, int len) {
        boolean utf16 = len >= 2 && len % 2 == 0;
        if (utf16) {
            int zeros = 0, odd = len / 2;
            for (int i = 1; i < len; i += 2) if (d[from + i] == 0) zeros++;
            utf16 = zeros * 2 > odd;
        }
        String s = new String(d, from, len, utf16 ? StandardCharsets.UTF_16LE : StandardCharsets.ISO_8859_1);
        return s.replace("\0", "").trim();
    }

    private static long u32(byte[] d, int i) {
        return (d[i] & 0xffL) | (d[i + 1] & 0xffL) << 8 | (d[i + 2] & 0xffL) << 16 | (d[i + 3] & 0xffL) << 24;
    }

    private static long u64(byte[] d, int i) {
        long v = 0;
        for (int k = 7; k >= 0; k--) v = v << 8 | (d[i + k] & 0xffL);
        return v;
    }
}
