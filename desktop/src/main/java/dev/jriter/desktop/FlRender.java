package dev.jriter.desktop;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import java.util.regex.*;
import java.util.stream.Stream;

/** Rendering FL Studio projects with its /R switch. Not headless: FL opens its window. */
public final class FlRender {
    public record Rendered(Path audio, double projectAt, double renderedAt) { }
    public static class RenderException extends Exception { public RenderException(String m) { super(m); } }

    static final List<String> SEARCH = List.of(
            "C:\\Program Files\\Image-Line", "C:\\Program Files (x86)\\Image-Line",
            System.getenv("LOCALAPPDATA") + "\\Image-Line", System.getenv("PROGRAMFILES") + "\\Image-Line");
    static final Set<String> AUDIO_OUT = Set.of(".wav", ".mp3", ".flac", ".ogg");

    /** fl64 before fl, then the highest version number in the path. */
    static final Comparator<Path> RANK = Comparator
            .<Path, Integer>comparing(p -> p.getFileName().toString().toLowerCase().contains("fl64") ? 0 : 1)
            .thenComparing((a, b) -> {
                List<Integer> x = digits(a), y = digits(b);
                for (int i = 0; i < Math.min(x.size(), y.size()); i++) { int c = Integer.compare(y.get(i), x.get(i)); if (c != 0) return c; }
                return 0;
            });

    static List<Integer> digits(Path p) {
        List<Integer> out = new ArrayList<>();
        Matcher m = Pattern.compile("(\\d+)").matcher(p.toString());
        while (m.find() && out.size() < 3) out.add(Integer.parseInt(m.group(1).length() > 9 ? "0" : m.group(1)));
        return out;
    }

    public static Optional<Path> find(String explicit) {
        if (explicit != null && !explicit.isBlank()) return Files.isRegularFile(Path.of(explicit)) ? Optional.of(Path.of(explicit)) : Optional.empty();
        Optional<Path> reg = fromRegistry();
        if (reg.isPresent()) return reg;
        List<Path> found = new ArrayList<>();
        for (String root : SEARCH) {
            Path r = Path.of(root);
            if (!Files.isDirectory(r)) continue;
            try (Stream<Path> s = Files.walk(r, 3)) {
                s.filter(p -> { String n = p.getFileName().toString().toLowerCase(); return n.equals("fl64.exe") || n.equals("fl.exe"); }).forEach(found::add);
            } catch (IOException ignored) { }
        }
        found.sort(RANK);
        return found.stream().findFirst();
    }

    static Optional<Path> fromRegistry() {
        if (!System.getProperty("os.name").toLowerCase().contains("win")) return Optional.empty();
        for (String key : new String[]{"HKCR\\FLStudio.Project\\shell\\open\\command", "HKCR\\Image-Line.FLP\\shell\\open\\command"}) {
            try {
                Process p = new ProcessBuilder("reg", "query", key, "/ve").redirectErrorStream(true).start();
                String out = new String(p.getInputStream().readAllBytes());
                p.waitFor();
                Matcher m = Pattern.compile("\"([^\"]+)\"").matcher(out);
                if (m.find() && Files.isRegularFile(Path.of(m.group(1)))) return Optional.of(Path.of(m.group(1)));
            } catch (IOException | InterruptedException ignored) { }
        }
        return Optional.empty();
    }

    /** Waits for the file to exist and stop growing. */
    static boolean settled(Path file, double quietFor, long timeoutSec, Process started) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutSec * 1000;
        long last = -1, stillSince = 0;
        while (System.currentTimeMillis() < deadline) {
            if (Files.isRegularFile(file)) {
                long size;
                try { size = Files.size(file); } catch (IOException e) { size = -1; }
                if (size > 0 && size == last) {
                    if (stillSince > 0 && System.currentTimeMillis() - stillSince >= quietFor * 1000) return true;
                    if (stillSince == 0) stillSince = System.currentTimeMillis();
                } else { stillSince = 0; last = size; }
            }
            if (started != null && !started.isAlive() && !Files.isRegularFile(file)) {
                Thread.sleep(2000);
                return Files.isRegularFile(file);
            }
            Thread.sleep(250);
        }
        return false;
    }

    public static Rendered render(Path project, Path outDir, String fmt, String fl, long timeoutSec, double quietFor, Consumer<String> say) throws RenderException {
        project = project.toAbsolutePath();
        if (!Files.isRegularFile(project)) throw new RenderException("no project at " + project);
        if (!project.getFileName().toString().toLowerCase().endsWith(".flp")) throw new RenderException(project.getFileName() + " is not an .flp");
        Path exe = find(fl).orElseThrow(() -> new RenderException("FL Studio was not found. Set it once with: jriter-cli flpath \"C:\\Program Files\\Image-Line\\FL Studio 2024\\FL64.exe\""));
        Path out = (outDir != null ? outDir : project.getParent()).toAbsolutePath();
        fmt = fmt.toLowerCase();
        String name = project.getFileName().toString();
        String stem = name.substring(0, name.length() - 4);
        Path work = null;
        try {
            Files.createDirectories(out);
            work = Files.createTempDirectory("jriterfl");
            Path staged = work.resolve("project.flp");
            Files.copy(project, staged);
            Path target = work.resolve("render." + fmt);
            say.accept("rendering " + name + " with " + exe.getFileName());
            Process p = new ProcessBuilder(exe.toString(), "/R" + target, "/E" + fmt, staged.toString()).directory(work.toFile()).start();
            Path produced = null;
            if (settled(target, quietFor, timeoutSec, p)) produced = target;
            else try (Stream<Path> s = Files.list(work)) {
                produced = s.filter(f -> AUDIO_OUT.stream().anyMatch(e -> f.toString().toLowerCase().endsWith(e))).findFirst().orElse(null);
            }
            if (p.isAlive()) say.accept("FL is still open; leaving it alone");
            if (produced == null || !Files.isRegularFile(produced))
                throw new RenderException("FL Studio did not produce a file for " + name + ". Its command line render is not headless: it opens the application, and on some versions the export dialog waits for Start to be pressed.");
            Path finalFile = out.resolve(stem + "." + fmt);
            Files.copy(produced, finalFile, StandardCopyOption.REPLACE_EXISTING);
            say.accept("wrote " + finalFile);
            var a = Files.readAttributes(project, java.nio.file.attribute.BasicFileAttributes.class);
            double made = Math.min(a.creationTime().toMillis(), a.lastModifiedTime().toMillis()) / 1000.0;
            double bounced = Files.getLastModifiedTime(produced).toMillis() / 1000.0;
            return new Rendered(finalFile, made, bounced);
        } catch (IOException | InterruptedException e) {
            throw new RenderException(e.toString());
        } finally {
            if (work != null) try (Stream<Path> s = Files.walk(work)) { s.sorted(Comparator.reverseOrder()).forEach(f -> f.toFile().delete()); } catch (IOException ignored) { }
        }
    }

    public static List<Path> projectsIn(Path folder) {
        List<Path> out = new ArrayList<>();
        try {
            Files.walkFileTree(folder, new SimpleFileVisitor<>() {
                @Override public FileVisitResult preVisitDirectory(Path d, java.nio.file.attribute.BasicFileAttributes a) {
                    String n = d.getFileName().toString();
                    return !d.equals(folder) && (n.startsWith(".") || n.equalsIgnoreCase("backup")) ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
                }
                @Override public FileVisitResult visitFile(Path f, java.nio.file.attribute.BasicFileAttributes a) {
                    if (f.toString().toLowerCase().endsWith(".flp")) out.add(f);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException ignored) { }
        Collections.sort(out);
        return out;
    }
}
