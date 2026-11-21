package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Watched folders, a port of jriter/modules/sync.py: render collectors (a scan offers what is
 * new) and sample libraries (an inventory, and uploads into them). Every folder is a path on
 * the host, so the whole module is the owner's.
 */
@RestController
public class SyncController {
    static final String COLLECTOR = "collector";
    static final String SYNC = "sync";
    static final long UPLOAD_MOST = 64L * 1024 * 1024;
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    private final Library library;
    private final Blobs blobs;

    public SyncController(Library library, Blobs blobs) {
        this.library = library;
        this.blobs = blobs;
    }

    /** Refuse anybody but the account that owns the machine; the owner's library is the one used. */
    private Library.Db hostOnly(HttpServletRequest req) {
        if (Api.actor(req) != Accounts.OWNER)
            throw new ApiError("Watched folders are folders on the machine JR!TER runs on, so only "
                    + "its owner can use them.", 403);
        return library.of(Accounts.OWNER);
    }

    private static Map<String, Object> folder(Library.Db db, Object id) {
        return db.one("SELECT * FROM sync_folders WHERE id = ?", id);
    }

    @GetMapping("/api/sync/folders")
    public Object list(HttpServletRequest req) {
        Library.Db db = hostOnly(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("folders", db.query("SELECT * FROM sync_folders ORDER BY path"));
        return out;
    }

    @PostMapping("/api/sync/folders")
    public Object add(HttpServletRequest req) {
        Library.Db db = hostOnly(req);
        Map<String, Object> data = Body.json(req);
        String given = Body.need(data, "path");
        if (given.equals("~") || given.startsWith("~/") || given.startsWith("~\\"))
            given = System.getProperty("user.home") + given.substring(1);
        Path path;
        try {
            path = Path.of(given).toAbsolutePath().normalize();
        } catch (java.nio.file.InvalidPathException e) {
            throw new ApiError("there is no folder at " + given);
        }
        if (!Files.isDirectory(path)) throw new ApiError("there is no folder at " + path);
        String kind = Body.str(data, "kind").strip();
        if (kind.isEmpty()) kind = COLLECTOR;
        if (!kind.equals(COLLECTOR) && !kind.equals(SYNC))
            throw new ApiError("a folder is either a " + COLLECTOR + " or a " + SYNC);
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> existing = db.one("SELECT * FROM sync_folders WHERE path = ?", path.toString());
        if (existing != null) {
            out.put("folder", existing);
            out.put("added", false);
            return out;
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("path", path.toString());
        v.put("enabled", 1);
        v.put("kind", kind);
        v.put("created_at", Accounts.now());
        long id = db.insert("sync_folders", v);
        out.put("folder", folder(db, id));
        out.put("added", true);
        return out;
    }

    @PatchMapping("/api/sync/folders/{id}")
    public Object update(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = hostOnly(req);
        Map<String, Object> f = folder(db, id);
        if (f == null) throw new ApiError("no folder with id " + id, 404);
        Map<String, Object> data = Body.json(req);
        if (data.containsKey("enabled")) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("enabled", SoundController.truthy(data.get("enabled"), false) ? 1 : 0);
            db.update("sync_folders", Accounts.num(f.get("id")), v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("folder", folder(db, f.get("id")));
        return out;
    }

    @DeleteMapping("/api/sync/folders/{id}")
    public Object remove(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = hostOnly(req);
        db.run("DELETE FROM sync_folders WHERE id = ?", id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("removed", id);
        return out;
    }

    // -- scanning ----------------------------------------------------------------

    private static double mtime(Path p) throws IOException {
        return Files.getLastModifiedTime(p).toMillis() / 1000.0;
    }

    /** Hash a file, reusing the last answer when size and mtime are unchanged. */
    private String digestFor(Library.Db db, Path path, long size, double mtime) throws IOException {
        Map<String, Object> cached = db.one("SELECT * FROM sync_seen WHERE path = ?", path.toString());
        if (cached != null && Accounts.num(cached.get("size")) == size
                && Math.abs(Accounts.dbl(cached.get("mtime")) - mtime) < 1)
            return (String) cached.get("digest");
        MessageDigest h = Blobs.sha256();
        try (InputStream in = Files.newInputStream(path)) {
            byte[] buf = new byte[1 << 20];
            int n;
            while ((n = in.read(buf)) > 0) h.update(buf, 0, n);
        }
        String digest = Blobs.hex(h.digest());
        db.run("INSERT INTO sync_seen (path, digest, size, mtime, checked_at) VALUES (?, ?, ?, ?, ?) "
                + "ON CONFLICT(path) DO UPDATE SET digest = excluded.digest, size = excluded.size, "
                + "mtime = excluded.mtime, checked_at = excluded.checked_at",
                path.toString(), digest, size, mtime, Accounts.now());
        return digest;
    }

    /** normcase on Windows: the same folder can be spelled with either case. */
    private static String norm(Path p) {
        String s = p.toAbsolutePath().normalize().toString();
        return WINDOWS ? s.toLowerCase(Locale.ROOT) : s;
    }

    static boolean under(Path path, List<Path> roots) {
        String here = norm(path);
        for (Path root : roots) {
            String top = norm(root);
            if (here.equals(top) || here.startsWith(top + java.io.File.separator)) return true;
        }
        return false;
    }

    private static List<Path> children(Path dir) {
        try (var s = Files.list(dir)) {
            return s.toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    /** Every audio file under root, never descending into a folder in skip. */
    static void walkAudio(Path root, List<Path> skip, List<Path> out) {
        if (under(root, skip)) return;
        for (Path p : children(root)) {
            String name = p.getFileName().toString();
            if (Files.isDirectory(p) && !Files.isSymbolicLink(p)) {
                if (!name.startsWith(".")) walkAudio(p, skip, out);
            } else if (Files.isRegularFile(p) && Api.AUDIO_EXT.contains(Api.extOf(name))) {
                out.add(p);
            }
        }
    }

    @PostMapping("/api/sync/scan")
    public Object scan(HttpServletRequest req) {
        Library.Db db = hostOnly(req);
        List<Map<String, Object>> folders = db.query(
                "SELECT * FROM sync_folders WHERE enabled = 1 AND kind = ?", COLLECTOR);
        List<Path> libraries = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT path FROM sync_folders WHERE kind = ?", SYNC))
            libraries.add(Path.of((String) r.get("path")));
        List<Map<String, Object>> candidates = new ArrayList<>(), errors = new ArrayList<>();
        int known = 0;
        for (Map<String, Object> f : folders) {
            Path root = Path.of((String) f.get("path"));
            if (!Files.isDirectory(root)) {
                errors.add(problem((String) f.get("path"), "the folder is not there any more"));
                continue;
            }
            List<Path> files = new ArrayList<>();
            walkAudio(root, libraries, files);
            for (Path p : files) {
                String digest;
                long size;
                double modified;
                try {
                    size = Files.size(p);
                    modified = mtime(p);
                    digest = digestFor(db, p, size, modified);
                } catch (IOException e) {
                    errors.add(problem(p.toString(), String.valueOf(e.getMessage())));
                    continue;
                }
                if (db.one("SELECT v.id FROM versions v JOIN songs s ON s.id = v.song_id WHERE v.digest = ? LIMIT 1",
                        digest) != null) {
                    known++;
                    continue;
                }
                String name = p.getFileName().toString();
                AudioMeta.Probe meta = AudioMeta.probe(p, Api.extOf(name));
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("path", p.toString());
                c.put("name", name);
                c.put("digest", digest);
                c.put("size", size);
                c.put("modified", modified);
                c.put("duration", meta.duration());
                c.put("bitrate", meta.bitrate());
                c.put("suggest", suggest(db, name));
                candidates.add(c);
            }
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("last_scan", Accounts.now());
            db.update("sync_folders", Accounts.num(f.get("id")), v);
        }
        candidates.sort((a, b) -> Double.compare(Accounts.dbl(b.get("modified")), Accounts.dbl(a.get("modified"))));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("candidates", candidates);
        out.put("already_have", known);
        out.put("errors", errors);
        out.put("folders", folders.size());
        return out;
    }

    private static Map<String, Object> problem(String path, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("path", path);
        m.put("why", why);
        return m;
    }

    private static String stemOf(String name) {
        String ext = Api.extOf(name);
        return ext.isEmpty() ? name : name.substring(0, name.length() - ext.length());
    }

    /** Which song a file name looks like a new take of, or null. */
    static Map<String, Object> suggest(Library.Db db, String name) {
        String stem = stemOf(name).replace("_", " ").replace("-", " ").strip().toLowerCase(Locale.ROOT);
        Map<String, Object> best = null;
        double score = 0.0;
        for (Map<String, Object> row : db.query("SELECT id, title FROM songs")) {
            String title = ((String) row.get("title")).toLowerCase(Locale.ROOT);
            double ratio = Similar.ratio(stem, title);
            if (stem.contains(title)) ratio = Math.max(ratio, 0.9);
            if (ratio > score) {
                best = row;
                score = ratio;
            }
        }
        if (best != null && score >= 0.62) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("song_id", best.get("id"));
            m.put("title", best.get("title"));
            m.put("score", Math.round(score * 1000) / 1000.0);
            return m;
        }
        return null;
    }

    @PostMapping("/api/sync/stock")
    public Object stock(HttpServletRequest req) {
        Library.Db db = hostOnly(req);
        List<Map<String, Object>> libs = new ArrayList<>(), errors = new ArrayList<>();
        for (Map<String, Object> f : db.query("SELECT * FROM sync_folders WHERE enabled = 1 AND kind = ?", SYNC)) {
            Path root = Path.of((String) f.get("path"));
            if (!Files.isDirectory(root)) {
                errors.add(problem((String) f.get("path"), "the folder is not there any more"));
                continue;
            }
            long[] tally = {0, 0};
            double[] newest = {0.0};
            inventory(root, tally, newest);
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("last_scan", Accounts.now());
            db.update("sync_folders", Accounts.num(f.get("id")), v);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", f.get("id"));
            m.put("path", f.get("path"));
            m.put("files", tally[0]);
            m.put("bytes", tally[1]);
            m.put("newest", newest[0]);
            libs.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("libraries", libs);
        out.put("errors", errors);
        return out;
    }

    private static void inventory(Path dir, long[] tally, double[] newest) {
        for (Path p : children(dir)) {
            String name = p.getFileName().toString();
            if (Files.isDirectory(p) && !Files.isSymbolicLink(p)) {
                if (!name.startsWith(".")) inventory(p, tally, newest);
            } else if (!name.startsWith(".")) {
                try {
                    long size = Files.size(p);
                    double m = mtime(p);
                    tally[0]++;
                    tally[1] += size;
                    newest[0] = Math.max(newest[0], m);
                } catch (IOException ignored) { /* vanished or unreadable: not counted */ }
            }
        }
    }

    @PostMapping("/api/sync/import")
    public Object importFile(HttpServletRequest req) {
        Library.Db db = hostOnly(req);
        Map<String, Object> data = Body.json(req);
        String given = Body.need(data, "path");
        Path path;
        try {
            path = Path.of(given);
        } catch (java.nio.file.InvalidPathException e) {
            throw new ApiError("there is no file at " + given);
        }
        if (!Files.isRegularFile(path)) throw new ApiError("there is no file at " + given);
        String ext = Api.extOf(path.getFileName().toString());
        if (!Api.AUDIO_EXT.contains(ext)) throw new ApiError("that is not an audio file JR!TER handles");

        List<Path> watched = new ArrayList<>();
        for (Map<String, Object> f : db.query("SELECT path FROM sync_folders WHERE enabled = 1"))
            watched.add(Path.of((String) f.get("path")));
        // only files inside a folder the owner chose
        if (!under(path, watched)) throw new ApiError("that file is not inside any watched folder", 403);

        Object songId = data.get("song_id");
        Map<String, Object> song;
        if (songId != null && !Boolean.FALSE.equals(songId) && !"".equals(songId) && !Integer.valueOf(0).equals(songId)) {
            song = SongsController.getSong(db, songId);
        } else {
            String title = Body.str(data, "title").strip();
            if (title.isEmpty()) title = stemOf(path.getFileName().toString());
            double now = Accounts.now();
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", title);
            v.put("notes", "");
            v.put("created_at", now);
            v.put("updated_at", now);
            song = SongsController.getSong(db, db.insert("songs", v));
        }
        Blobs.Stored s;
        try {
            s = blobs.putPath(Accounts.OWNER, path);
        } catch (IOException e) {
            throw new ApiError("could not read that file: " + e.getMessage(), 500);
        }
        long sid = Accounts.num(song.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> same = db.one("SELECT * FROM versions WHERE song_id = ? AND digest = ?", sid, s.digest());
        if (same != null) {
            out.put("song", song);
            out.put("version", same);
            out.put("duplicate", true);
            return out;
        }
        AudioMeta.Probe meta = AudioMeta.probe(path, ext);
        Map<String, Object> row = db.one("SELECT MAX(n) AS n FROM versions WHERE song_id = ?", sid);
        long n = row == null || row.get("n") == null ? 1 : Accounts.num(row.get("n")) + 1;
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", sid);
        v.put("n", n);
        v.put("digest", s.digest());
        v.put("ext", ext);
        v.put("size", s.size());
        v.put("duration", meta.duration());
        v.put("bitrate", meta.bitrate());
        v.put("label", "");
        v.put("filename", path.getFileName().toString());
        v.put("source_path", path.toAbsolutePath().toString());
        v.put("created_at", Accounts.now());
        long versionId = db.insert("versions", v);
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("current_version_id", versionId);
        u.put("updated_at", Accounts.now());
        db.update("songs", sid, u);
        out.put("song", SongsController.getSong(db, sid));
        out.put("version", db.one("SELECT * FROM versions WHERE id = ?", versionId));
        out.put("duplicate", false);
        return out;
    }

    /** A name inside folder that is not taken, by adding a number if it has to. */
    static String freeName(Path folder, String name) {
        String ext = Api.extOf(name);
        String stem = ext.isEmpty() ? name : name.substring(0, name.length() - ext.length());
        String tryout = name;
        int n = 2;
        while (Files.exists(folder.resolve(tryout))) {
            tryout = stem + " " + n + ext;
            n++;
        }
        return tryout;
    }

    /** Percent-decoded like Python's unquote ('+' stays a plus, a bad escape stays as it is). */
    static String unquote(String s) {
        try {
            return java.net.URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return s;
        }
    }

    @PostMapping("/api/sync/folders/{id}/upload")
    public Object upload(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = hostOnly(req);
        Map<String, Object> f = folder(db, id);
        if (f == null) throw new ApiError("no watched folder with that id", 404);
        Object kind = f.get("kind");
        if (!SYNC.equals(kind == null || "".equals(kind) ? COLLECTOR : kind))
            throw new ApiError("that folder is a render collector, not a sample library. Anything "
                    + "landing in a collector is offered as a new render, which is not "
                    + "what a one shot is for.", 400);
        Path into = Path.of((String) f.get("path")).toAbsolutePath().normalize();
        if (!Files.isDirectory(into))
            throw new ApiError("the folder " + f.get("path") + " is not there any more", 409);

        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no file in that upload");
        if (length > UPLOAD_MOST)
            throw new ApiError("a sample over " + (UPLOAD_MOST / 1048576) + " MB is not a sample");

        // Decoded first, then taken apart: %2F must not become a separator that survives.
        String raw = req.getHeader("X-Filename-Enc") != null ? Api.header(req, "X-Filename")
                : unquote(Api.header(req, "X-Filename"));
        String name = raw.replace("\\", "/");
        name = name.substring(name.lastIndexOf('/') + 1);
        if (name.isEmpty() || name.equals(".") || name.equals(".."))
            throw new ApiError("that upload did not say what it was called");
        String ext = Api.extOf(name);
        if (!Api.AUDIO_EXT.contains(ext)) {
            List<String> all = new ArrayList<>(Api.AUDIO_EXT);
            throw new ApiError("JR!TER takes " + String.join(", ", all) + ", not " + (ext.isEmpty() ? name : ext));
        }
        Path dest;
        try {
            name = freeName(into, name);
            dest = into.resolve(name).toAbsolutePath().normalize();
        } catch (java.nio.file.InvalidPathException e) {
            throw new ApiError("that name does not stay inside the folder", 400);
        }
        if (!into.equals(dest.getParent())) throw new ApiError("that name does not stay inside the folder", 400);

        byte[] body;
        try {
            body = req.getInputStream().readNBytes((int) length);
        } catch (IOException e) {
            throw new ApiError("the upload stopped early", 400);
        }
        if (body.length != length) throw new ApiError("the upload stopped early", 400);
        Path tmp = into.resolve(name + ".part");
        try {
            Files.write(tmp, body);
            Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new ApiError("could not write the file: " + e.getMessage(), 500);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", name);
        out.put("folder", f.get("id"));
        out.put("bytes", (long) body.length);
        out.put("path", dest.toString());
        return out;
    }
}
