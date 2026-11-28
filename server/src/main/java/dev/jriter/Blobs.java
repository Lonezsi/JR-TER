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
import java.util.Map;
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

    private Accounts accounts;

    /** Lets the quota see who a file is billed to (null in plain tests: no ledger). */
    @org.springframework.beans.factory.annotation.Autowired
    public void setAccounts(Accounts accounts) { this.accounts = accounts; }

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

    private static long folderSize(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) return 0;
        try (java.util.stream.Stream<Path> s = Files.walk(dir)) {
            return s.filter(Files::isRegularFile).mapToLong(p -> {
                try { return Files.size(p); } catch (IOException e) { return 0; }
            }).sum();
        }
    }

    /**
     * What an account is charged for: every file in its folder, less what guests put there
     * (those are the guests' own), plus what it put into other libraries as a guest. Ledger
     * rows whose file is gone are dropped. shortcut: walks the folder on every upload; keep a
     * running total if it gets slow.
     */
    public long used(long account) throws IOException {
        long total = folderSize(dir(account));
        if (accounts == null) return total;
        for (Map<String, Object> r : accounts.guestUploadsTo(account)) {
            if (Files.isRegularFile(pathFor(account, (String) r.get("digest")))) total -= Accounts.num(r.get("size"));
            else accounts.forgetGuestUpload(Accounts.num(r.get("id")));
        }
        for (Map<String, Object> r : accounts.guestUploadsBy(account)) {
            long owner = Accounts.num(r.get("owner"));
            if (Files.isRegularFile(pathFor(owner, (String) r.get("digest")))) total += Accounts.num(r.get("size"));
            else accounts.forgetGuestUpload(Accounts.num(r.get("id")));
        }
        return Math.max(0, total);
    }

    /** 413 if keeping length more bytes would take the payer past the account total. */
    public void room(long payer, long length) throws IOException {
        if (used(payer) + length > Api.ACCOUNT_MOST)
            throw new ApiError("That would take you past " + Api.gb(Api.ACCOUNT_MOST)
                    + ", the most one account keeps here. Delete something and empty the grave to make room.", 413);
    }

    /** An upload from a request: the guest pays when it came through a share, else the library's account. */
    public Stored putUpload(jakarta.servlet.http.HttpServletRequest req, long acct, long length) throws IOException {
        long guest = Api.guest(req);
        room(guest != 0 ? guest : acct, length);
        Stored s = putStream(acct, req.getInputStream(), length);
        if (guest != 0 && s.added() && accounts != null) accounts.guestUploaded(guest, acct, s.digest(), s.size());
        return s;
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
