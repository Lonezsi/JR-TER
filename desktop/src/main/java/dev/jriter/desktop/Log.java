package dev.jriter.desktop;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** One line per event in watch.log beside the config. Never throws. */
public final class Log {
    private static final long MOST = 256 * 1024;
    private final Path file;

    public Log(Path dir) { this.file = dir.resolve("watch.log"); }
    public Path file() { return file; }

    public synchronized void line(String text) {
        try {
            Files.createDirectories(file.getParent());
            if (Files.exists(file) && Files.size(file) > MOST) {
                byte[] all = Files.readAllBytes(file);
                Files.write(file, java.util.Arrays.copyOfRange(all, all.length / 2, all.length));
            }
            String stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
            Files.writeString(file, stamp + " - " + text + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ignored) { }
    }
}
