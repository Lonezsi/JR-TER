package dev.jriter.desktop;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;

/** Finds the VST plugins installed on this PC, to tell which of a project's VSTs are missing. */
public final class VstFolders {
    /** files: lowercase file names; names: normalised names without extension. */
    public record Installed(Set<String> files, Set<String> names) { }

    private VstFolders() { }

    public static List<Path> defaults(Config cfg) {
        List<String> raw = new ArrayList<>();
        String common = System.getenv("CommonProgramFiles"), commonX86 = System.getenv("CommonProgramFiles(x86)");
        String pf = System.getenv("ProgramFiles"), pfX86 = System.getenv("ProgramFiles(x86)");
        String local = System.getenv("LOCALAPPDATA");
        if (common != null) { raw.add(common + "\\VST3"); raw.add(common + "\\VST2"); raw.add(common + "\\Steinberg\\VST2"); }
        if (commonX86 != null) raw.add(commonX86 + "\\VST3");
        if (local != null) raw.add(local + "\\Programs\\Common\\VST3");
        if (pf != null) { raw.add(pf + "\\VSTPlugins"); raw.add(pf + "\\Steinberg\\VSTPlugins"); }
        if (pfX86 != null) { raw.add(pfX86 + "\\VSTPlugins"); raw.add(pfX86 + "\\Steinberg\\VSTPlugins"); }
        raw.addAll(cfg.vstFolders());
        List<Path> out = new ArrayList<>();
        for (String r : raw) {
            try {
                Path p = Path.of(r);
                if (Files.isDirectory(p) && !out.contains(p)) out.add(p);
            } catch (InvalidPathException ignored) { /* skip */ }
        }
        return out;
    }

    public static Installed scan(List<Path> folders) {
        Set<String> files = new HashSet<>(), names = new HashSet<>();
        for (Path f : folders) {
            try (Stream<Path> w = Files.walk(f, 6)) {
                w.forEach(p -> {
                    Path fn = p.getFileName();
                    if (fn == null) return;
                    String n = fn.toString().toLowerCase();
                    if (n.endsWith(".dll") || n.endsWith(".vst3")) {
                        files.add(n);
                        names.add(norm(stem(n)));
                    }
                });
            } catch (IOException | UncheckedIOException | SecurityException ignored) { /* unreadable folder */ }
        }
        return new Installed(files, names);
    }

    public static String norm(String s) {
        String t = s.toLowerCase().trim().replaceAll("[\\s_(]*x?64\\)?$", "");
        return t.replaceAll("[^a-z0-9]", "");
    }

    static String stem(String file) {
        int i = file.lastIndexOf('.');
        return i > 0 ? file.substring(0, i) : file;
    }

    public static boolean has(Installed in, FlProject.Plugin p) {
        if (p.kind().equals("fl")) return true;
        String path = p.path();
        if (!path.isEmpty()) {
            try { if (Files.exists(Path.of(path))) return true; } catch (InvalidPathException ignored) { /* fall through */ }
            String base = path.substring(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1).toLowerCase();
            if (in.files().contains(base)) return true;
            if (!base.isEmpty() && in.names().contains(norm(stem(base)))) return true;
        }
        return !p.name().isEmpty() && in.names().contains(norm(p.name()));
    }
}
