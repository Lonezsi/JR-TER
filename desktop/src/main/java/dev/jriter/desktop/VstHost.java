package dev.jriter.desktop;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/** Plays a MIDI or audio file through a real VST on this PC, using the Plugalyzer command-line host. */
public final class VstHost {
    private VstHost() { }

    /** Runs a command; returns its exit code and output. Replaceable in tests. */
    public interface Runner { Result run(List<String> cmd) throws IOException, InterruptedException; }
    public record Result(int code, String output) { }

    public static final String DOWNLOAD = "https://github.com/CrushedPixel/Plugalyzer/releases";

    public static Optional<Path> findPlugalyzer(Config cfg) {
        String set = cfg.plugalyzer();
        if (!set.isBlank()) {
            try { Path p = Path.of(set); if (Files.isRegularFile(p)) return Optional.of(p); } catch (InvalidPathException ignored) { }
        }
        String path = System.getenv("PATH");
        if (path != null) {
            for (String d : path.split(java.io.File.pathSeparator)) {
                try {
                    for (String n : new String[] { "plugalyzer.exe", "plugalyzer" }) {
                        Path p = Path.of(d.trim(), n);
                        if (Files.isRegularFile(p)) return Optional.of(p);
                    }
                } catch (InvalidPathException ignored) { }
            }
        }
        String local = System.getenv("LOCALAPPDATA");
        if (local != null) {
            Path p = Path.of(local, "Programs", "plugalyzer", "plugalyzer.exe");
            if (Files.isRegularFile(p)) return Optional.of(p);
        }
        return Optional.empty();
    }

    /** VST3 (file or bundle folder) and VST2 .dll files, sorted by file name. A .vst3 bundle is not entered. */
    public static List<Path> installed(List<Path> folders) {
        List<Path> out = new ArrayList<>();
        for (Path f : folders) {
            try {
                Files.walkFileTree(f, EnumSet.noneOf(FileVisitOption.class), 6, new SimpleFileVisitor<>() {
                    @Override public FileVisitResult preVisitDirectory(Path d, java.nio.file.attribute.BasicFileAttributes a) {
                        if (d.getFileName() != null && d.getFileName().toString().toLowerCase().endsWith(".vst3")) {
                            out.add(d);
                            return FileVisitResult.SKIP_SUBTREE;
                        }
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFile(Path p, java.nio.file.attribute.BasicFileAttributes a) {
                        String n = p.getFileName().toString().toLowerCase();
                        if (n.endsWith(".vst3") || n.endsWith(".dll")) out.add(p);
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFileFailed(Path p, IOException e) { return FileVisitResult.CONTINUE; }
                });
            } catch (IOException | java.io.UncheckedIOException | SecurityException ignored) { /* unreadable folder */ }
        }
        out.sort(Comparator.comparing((Path p) -> p.getFileName().toString().toLowerCase()).thenComparing(Path::toString));
        return out;
    }

    /** An existing path, else the installed plugin whose name matches ignoring case, spaces and dashes. */
    public static Optional<Path> resolve(String nameOrPath, List<Path> folders) {
        try {
            Path p = Path.of(nameOrPath);
            if (Files.exists(p)) return Optional.of(p);
        } catch (InvalidPathException ignored) { }
        String want = VstFolders.norm(VstFolders.stem(nameOrPath.toLowerCase()));
        String wantFull = VstFolders.norm(nameOrPath);
        for (Path p : installed(folders)) {
            String file = p.getFileName().toString().toLowerCase();
            String have = VstFolders.norm(VstFolders.stem(file));
            if (have.equals(want) || have.equals(wantFull)) return Optional.of(p);
        }
        return Optional.empty();
    }

    public static double midiSeconds(Path mid) throws IOException {
        try {
            return javax.sound.midi.MidiSystem.getSequence(mid.toFile()).getMicrosecondLength() / 1e6;
        } catch (javax.sound.midi.InvalidMidiDataException e) {
            throw new IOException(mid.getFileName() + " is not a MIDI file I can read.", e);
        }
    }

    /** 16-bit stereo PCM silence. */
    public static void writeSilentWav(Path out, double seconds, int rate) throws IOException {
        long frames = Math.max(1, Math.round(seconds * rate));
        var fmt = new javax.sound.sampled.AudioFormat(rate, 16, 2, true, false);
        byte[] data = new byte[(int) (frames * 4)];
        try (var in = new javax.sound.sampled.AudioInputStream(new java.io.ByteArrayInputStream(data), fmt, frames)) {
            javax.sound.sampled.AudioSystem.write(in, javax.sound.sampled.AudioFileFormat.Type.WAVE, out.toFile());
        }
    }

    public static List<String> command(Path exe, Path plugin, Path inputWav, Path midi, Path out, List<String> params) {
        List<String> c = new ArrayList<>();
        c.add(exe.toString());
        c.add("process");
        c.add("--plugin=" + plugin);
        c.add("--input=" + inputWav);
        if (midi != null) c.add("--midiInput=" + midi);
        c.add("--output=" + out);
        c.add("--overwrite");
        for (String p : params) c.add("--param=" + p);
        return c;
    }

    public static Runner processRunner() {
        return cmd -> {
            Process pr = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            pr.getOutputStream().close();
            var buf = new java.io.ByteArrayOutputStream();
            Thread t = new Thread(() -> { try { pr.getInputStream().transferTo(buf); } catch (IOException ignored) { } });
            t.setDaemon(true);
            t.start();
            if (!pr.waitFor(600, TimeUnit.SECONDS)) { pr.destroyForcibly(); throw new IOException("The VST host took more than 10 minutes and was stopped."); }
            t.join(2000);
            return new Result(pr.exitValue(), buf.toString(java.nio.charset.StandardCharsets.UTF_8));
        };
    }

    /**
     * Renders. With a .wav input that audio goes through the plugin (and a MIDI file, if given, plays it);
     * with only MIDI, a silent WAV as long as the MIDI plus tail seconds is the input.
     */
    public static Path render(Runner run, Path exe, Path plugin, Path wavOrNull, Path midiOrNull, Path out,
                              double tail, List<String> params) throws IOException, InterruptedException {
        if (wavOrNull == null && midiOrNull == null) throw new IOException("Give a .mid or .wav to play through the plugin.");
        Path tmp = null;
        Path in = wavOrNull;
        try {
            if (in == null) {
                tmp = Files.createTempDirectory("jriter-vst");
                in = tmp.resolve("silence.wav");
                writeSilentWav(in, midiSeconds(midiOrNull) + Math.max(0, tail), 44100);
            }
            Files.deleteIfExists(out);
            Result r = run.run(command(exe, plugin, in, midiOrNull, out, params));
            if (r.code() != 0 || !Files.isRegularFile(out) || Files.size(out) == 0) {
                String[] lines = r.output().strip().split("\\R");
                String last = String.join("\n", Arrays.copyOfRange(lines, Math.max(0, lines.length - 5), lines.length));
                throw new IOException("The VST host failed (exit " + r.code() + ")." + (last.isBlank() ? "" : "\n" + last));
            }
            return out;
        } finally {
            if (tmp != null) {
                try (Stream<Path> s = Files.walk(tmp)) { s.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete()); }
                catch (IOException ignored) { }
            }
        }
    }
}
