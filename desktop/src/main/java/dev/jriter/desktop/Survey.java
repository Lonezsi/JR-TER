package dev.jriter.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.Stream;

/** What is in the watched folders, split into what the library holds and what it does not. */
public final class Survey {
    public record Found(Path path, String digest) { }
    public record Result(List<Found> known, List<Found> fresh) { }

    static final Set<String> AUDIO = Set.of(".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus");

    public static boolean isAudio(Path p) {
        String n = p.getFileName().toString().toLowerCase();
        int dot = n.lastIndexOf('.');
        return dot >= 0 && AUDIO.contains(n.substring(dot));
    }

    public static String digest(Path p) throws IOException {
        try (InputStream in = Files.newInputStream(p)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1 << 20];
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
            return HexFormat.of().formatHex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    /** Audio files under the folders, sorted per folder; dot directories are skipped. */
    public static List<Path> walk(List<String> folders) {
        List<Path> out = new ArrayList<>();
        for (String f : folders) {
            Path root = Path.of(f);
            if (!Files.isDirectory(root)) continue;
            List<Path> found = new ArrayList<>();
            try {
                Files.walkFileTree(root, new SimpleFileVisitor<>() {
                    @Override public FileVisitResult preVisitDirectory(Path dir, java.nio.file.attribute.BasicFileAttributes a) {
                        return !dir.equals(root) && dir.getFileName().toString().startsWith(".")
                                ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFile(Path file, java.nio.file.attribute.BasicFileAttributes a) {
                        if (isAudio(file)) found.add(file);
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFileFailed(Path file, IOException e) { return FileVisitResult.CONTINUE; }
                });
            } catch (IOException ignored) { }
            Collections.sort(found);
            out.addAll(found);
        }
        return out;
    }

    public static Result run(Config cfg, Library lib) {
        List<Found> all = new ArrayList<>();
        for (Path p : walk(cfg.folders())) {
            try { all.add(new Found(p, digest(p))); } catch (IOException ignored) { }
        }
        List<Found> known = new ArrayList<>(), fresh = new ArrayList<>();
        for (int i = 0; i < all.size(); i += 400) {
            List<Found> batch = all.subList(i, Math.min(all.size(), i + 400));
            StringJoiner j = new StringJoiner(",");
            batch.forEach(f -> j.add(f.digest()));
            JsonNode have = lib.get("/api/versions/have?digest=" + Library.enc(j.toString())).path("have");
            for (Found f : batch) (have.hasNonNull(f.digest()) ? known : fresh).add(f);
        }
        return new Result(known, fresh);
    }
}
