package dev.jriter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;

/**
 * Content addressed files, the layout of jriter/blobs.py: data/accounts/ID/blobs/aa/bb/SHA256.
 * Each upload gets a temporary file of its own, flushed to disk before it is given the name
 * that promises what is in it.
 */
@Component
public class Blobs {
    private final Config config;

    private Library library;

    public Blobs(Config config) { this.config = config; }

    /** Lets delete() ask the grave (not in the constructor, so Blobs works without a library in tests). */
    @org.springframework.beans.factory.annotation.Autowired
    public void setLibrary(Library library) { this.library = library; }

    /** What was stored: the digest, the size, and whether the bytes were new. */
    public record Stored(String digest, long size, boolean added) {}

    public Path dir(long account) { return config.ensureHome(account).resolve("blobs"); }

    public Path pathFor(long account, String digest) {
        return dir(account).resolve(digest.substring(0, 2)).resolve(digest.substring(2, 4)).resolve(digest);
    }

    public Stored putStream(long account, InputStream in, long length) throws IOException {
        Path tmp = Files.createTempFile(dir(account), "incoming.", ".part");
        try {
            MessageDigest h = sha256();
            long size = 0, remaining = length;
            byte[] buf = new byte[1 << 20];
            try (FileChannel ch = FileChannel.open(tmp, StandardOpenOption.WRITE);
                 OutputStream out = java.nio.channels.Channels.newOutputStream(ch)) {
                while (remaining > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, remaining));
                    if (n < 0) break;
                    remaining -= n;
                    size += n;
                    h.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
                out.flush();
                ch.force(true);
            }
            return finish(account, tmp, hex(h.digest()), size);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    public Stored putPath(long account, Path source) throws IOException {
        try (InputStream in = Files.newInputStream(source)) {
            return putStream(account, in, Files.size(source));
        }
    }

    private Stored finish(long account, Path tmp, String digest, long size) throws IOException {
        Path dest = pathFor(account, digest);
        if (Files.isRegularFile(dest)) return new Stored(digest, size, false);
        Files.createDirectories(dest.getParent());
        Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        return new Stored(digest, size, true);
    }

    /** Only called once nothing references the blob. */
    public boolean delete(long account, String digest) {
        // a deleted thing waiting in the grave still needs its file (modules/grave.py holds)
        if (library != null && Grave.holds(library.of(account), digest)) return false;
        try {
            return Files.deleteIfExists(pathFor(account, digest));
        } catch (IOException e) {
            return false;
        }
    }

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String hex(byte[] b) { return Accounts.hex(b); }
}
