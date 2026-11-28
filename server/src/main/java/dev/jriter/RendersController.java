package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Renders waiting for a home: a port of jriter/modules/renders.py. */
@RestController
public class RendersController {
    private final Library library;
    private final Grave grave;
    private final Blobs blobs;
    private final VersionsController versions;

    public RendersController(Library library, Blobs blobs, VersionsController versions, Grave grave) {
        this.library = library;
        this.blobs = blobs;
        this.grave = grave;
        this.versions = versions;
    }

    static Map<String, Object> getRender(Library.Db db, Object id) {
        Map<String, Object> r = db.one("SELECT * FROM renders WHERE id = ?", id);
        if (r == null) throw new ApiError("no render with id " + id, 404);
        return r;
    }

    static String stem(String name) {
        String ext = Api.extOf(name);
        return name.substring(0, name.length() - ext.length());
    }

    /** Each row carries the song it went to, so the list needs no second call. */
    static Map<String, Object> decorate(Library.Db db, Map<String, Object> row, Map<Object, Object> titles) {
        row.put("song_title", titles.get(row.get("song_id")));
        String name = stem((String) row.get("filename"));
        row.put("name", name.isEmpty() ? "render" : name);
        row.put("waiting", Accounts.dbl(row.get("used_at")) == 0);
        row.put("shape", VersionsController.shapeList(row.remove("peaks")));
        row.put("plugins", VersionsController.pluginList(row.get("plugins")));
        return row;
    }

    static Map<Object, Object> titles(Library.Db db) {
        Map<Object, Object> t = new HashMap<>();
        for (Map<String, Object> r : db.query("SELECT id, title FROM songs")) t.put(r.get("id"), r.get("title"));
        return t;
    }

    static List<Map<String, Object>> decorate(Library.Db db, List<Map<String, Object>> rows) {
        Map<Object, Object> t = titles(db);
        for (Map<String, Object> r : rows) decorate(db, r, t);
        return rows;
    }

    static Map<String, Object> decorate1(Library.Db db, Map<String, Object> row) {
        return decorate(db, row, titles(db));
    }

    @GetMapping("/api/renders")
    public Object list(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        List<Map<String, Object>> rows = req.getParameter("all") != null && !req.getParameter("all").isEmpty()
                ? db.query("SELECT * FROM renders ORDER BY created_at DESC")
                : db.query("SELECT * FROM renders WHERE used_at = 0 ORDER BY created_at DESC");
        Map<String, Object> waiting = db.one("SELECT COUNT(*) AS n FROM renders WHERE used_at = 0");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("renders", decorate(db, rows));
        out.put("waiting", waiting == null ? 0 : waiting.get("n"));
        return out;
    }

    /** The row for these bytes, written or already there; the second value is whether it is new. */
    record Remembered(Map<String, Object> row, boolean added) {}

    Remembered remember(long acct, String digest, String ext, long size, String filename, String sourcePath,
                        String origin, double duration, int bitrate, double projectAt, double renderedAt, String plugins) {
        Library.Db db = library.of(acct);
        Map<String, Object> existing = db.one("SELECT * FROM renders WHERE digest = ?", digest);
        if (existing != null) {
            Map<String, Object> learned = new LinkedHashMap<>();
            if (projectAt != 0 && Accounts.dbl(existing.get("project_at")) == 0) learned.put("project_at", projectAt);
            if (renderedAt != 0 && Accounts.dbl(existing.get("rendered_at")) == 0) learned.put("rendered_at", renderedAt);
            if (!plugins.isEmpty() && String.valueOf(existing.get("plugins") == null ? "" : existing.get("plugins")).isEmpty()) learned.put("plugins", plugins);
            if (!learned.isEmpty()) {
                db.update("renders", Accounts.num(existing.get("id")), learned);
                return new Remembered(getRender(db, existing.get("id")), false);
            }
            return new Remembered(existing, false);
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("digest", digest);
        v.put("ext", ext);
        v.put("size", size);
        v.put("duration", duration);
        v.put("bitrate", bitrate);
        v.put("filename", filename);
        v.put("source_path", sourcePath);
        v.put("origin", origin);
        v.put("created_at", Accounts.now());
        v.put("project_at", projectAt);
        v.put("rendered_at", renderedAt);
        v.put("plugins", plugins);
        v.putAll(VersionsController.shapeOf(blobs.pathFor(acct, digest), ext));
        long id = db.insert("renders", v);
        return new Remembered(getRender(db, id), true);
    }

    /** A date from a header, in epoch seconds, or zero for anything that is not a believable one. */
    static double stamp(HttpServletRequest req, String name) {
        String raw = Api.header(req, name);
        if (raw.isEmpty()) return 0.0;
        try {
            double v = Double.parseDouble(raw);
            return v > 631152000 && v < Accounts.now() + 86400 ? v : 0.0;
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }

    @PostMapping("/api/renders")
    public Object upload(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no file in that upload");
        if (length > Api.AUDIO_MOST) throw new ApiError("That render is over " + Api.mb(Api.AUDIO_MOST) + ", too big to keep here.", 413);
        String filename = Api.header(req, "X-Filename");
        if (filename.isEmpty()) filename = "render.wav";
        String ext = Api.extOf(filename);
        if (!Api.AUDIO_EXT.contains(ext))
            throw new ApiError((ext.isEmpty() ? filename : ext) + " is not an audio file JR!TER handles");
        Blobs.Stored s = blobs.putUpload(req, acct, length);
        AudioMeta.Probe meta = AudioMeta.probe(blobs.pathFor(acct, s.digest()), ext);
        String origin = Api.header(req, "X-Origin");
        Remembered r = remember(acct, s.digest(), ext, s.size(), filename, Api.header(req, "X-Source-Path"),
                origin.isEmpty() ? "upload" : origin, meta.duration(), meta.bitrate(),
                stamp(req, "X-Project-At"), stamp(req, "X-Rendered-At"),
                VersionsController.cleanPlugins(Api.header(req, "X-Plugins")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("render", decorate1(library.of(acct), r.row()));
        out.put("added", r.added());
        return out;
    }

    static double mtime(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis() / 1000.0;
        } catch (IOException e) {
            return 0.0;
        }
    }

    /** The age of the .flp lying next to this audio with the same stem, or 0. */
    static double projectBeside(Path audio) {
        String name = audio.getFileName().toString();
        String base = stem(name);
        for (String ext : new String[] {".flp", ".FLP"}) {
            Path project = audio.resolveSibling(base + ext);
            if (Files.isRegularFile(project)) {
                try {
                    BasicFileAttributes a = Files.readAttributes(project, BasicFileAttributes.class);
                    return Math.min(a.creationTime().toMillis(), a.lastModifiedTime().toMillis()) / 1000.0;
                } catch (IOException e) {
                    return 0.0;
                }
            }
        }
        return 0.0;
    }

    static void walk(Path dir, List<Path> found) throws IOException {
        List<Path> files = new ArrayList<>(), dirs = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            for (Path p : (Iterable<Path>) s::iterator) {
                if (Files.isDirectory(p)) {
                    if (!p.getFileName().toString().startsWith(".")) dirs.add(p);
                } else files.add(p);
            }
        }
        files.sort(null);
        for (Path f : files) if (Api.AUDIO_EXT.contains(Api.extOf(f.getFileName().toString()))) found.add(f);
        for (Path d : dirs) walk(d, found);
    }

    @PostMapping("/api/renders/ingest")
    public Object ingest(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        if (acct != Accounts.OWNER)
            throw new ApiError("Importing from a path reads files on the machine JR!TER runs on, so only "
                    + "its owner can do it. Upload the file instead.", 403);
        Library.Db db = library.of(acct);
        Map<String, Object> data = Body.json(req);
        String given = Body.need(data, "path");
        if (given.equals("~") || given.startsWith("~/") || given.startsWith("~\\"))
            given = System.getProperty("user.home") + given.substring(1);
        Path path = Path.of(given).toAbsolutePath().normalize();
        List<Path> found = new ArrayList<>();
        if (Files.isRegularFile(path)) {
            if (!Api.AUDIO_EXT.contains(Api.extOf(path.getFileName().toString())))
                throw new ApiError("only audio files can be taken in (" + String.join(", ", Api.AUDIO_EXT.stream().sorted().toList()) + ")");
            found.add(path);
        } else if (Files.isDirectory(path)) {
            walk(path, found);
        } else {
            throw new ApiError("there is nothing at " + path);
        }
        List<Map<String, Object>> added = new ArrayList<>();
        int already = 0;
        String origin = Body.str(data, "origin").strip();
        for (Path item : found) {
            String ext = Api.extOf(item.getFileName().toString());
            Blobs.Stored s = blobs.putPath(acct, item);
            AudioMeta.Probe meta = AudioMeta.probe(blobs.pathFor(acct, s.digest()), ext);
            Remembered r = remember(acct, s.digest(), ext, s.size(), item.getFileName().toString(), item.toString(),
                    origin.isEmpty() ? "import" : origin, meta.duration(), meta.bitrate(),
                    projectBeside(item), mtime(item), "");
            if (r.added()) added.add(r.row());
            else already++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("added", decorate(db, added));
        out.put("count", added.size());
        out.put("already_here", already);
        out.put("looked_at", found.size());
        return out;
    }

    @PostMapping("/api/renders/{id}/attach")
    public Object attach(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> render = getRender(db, id);
        Map<String, Object> data = Body.json(req);
        Object songId = data.get("song_id");
        Map<String, Object> song;
        if (songId != null && !Boolean.FALSE.equals(songId) && !"".equals(songId) && !Integer.valueOf(0).equals(songId)) {
            song = SongsController.getSong(db, songId);
        } else {
            String title = Body.str(data, "title").strip();
            if (title.isEmpty()) title = stem((String) render.get("filename"));
            if (title.isEmpty()) title = "Untitled";
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("title", title);
            v.put("created_at", Accounts.now());
            v.put("updated_at", Accounts.now());
            song = SongsController.getSong(db, db.insert("songs", v));
        }
        VersionsController.Added a = versions.addStored(acct, Accounts.num(song.get("id")), (String) render.get("digest"),
                (String) render.get("ext"), Accounts.num(render.get("size")), Accounts.dbl(render.get("duration")),
                (int) Accounts.num(render.get("bitrate")), "", (String) render.get("filename"),
                (String) render.get("source_path"), Accounts.dbl(render.get("project_at")), Accounts.dbl(render.get("rendered_at")),
                render.get("plugins") == null ? "" : render.get("plugins").toString());
        Map<String, Object> used = new LinkedHashMap<>();
        used.put("used_at", Accounts.now());
        used.put("song_id", song.get("id"));
        used.put("version_id", a.version().get("id"));
        db.update("renders", Accounts.num(render.get("id")), used);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("render", decorate1(db, getRender(db, render.get("id"))));
        out.put("song", SongsController.getSong(db, song.get("id")));
        out.put("version", a.version());
        out.put("already_there", a.already());
        return out;
    }

    @PostMapping("/api/renders/{id}/unattach")
    public Object unattach(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> render = getRender(db, id);
        db.run("UPDATE renders SET used_at = 0, song_id = NULL, version_id = NULL WHERE id = ?", render.get("id"));
        return Map.of("render", decorate1(db, getRender(db, render.get("id"))));
    }

    @PatchMapping("/api/renders/{id}")
    public Object rename(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> render = getRender(db, id);
        String name = Body.need(Body.json(req), "name");
        String ext = (String) render.get("ext");
        if (ext == null || ext.isEmpty()) ext = Api.extOf((String) render.get("filename"));
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("filename", name + ext);
        db.update("renders", Accounts.num(render.get("id")), p);
        return Map.of("render", decorate1(db, getRender(db, render.get("id"))));
    }

    @DeleteMapping("/api/renders/{id}")
    public Object dismiss(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> render = getRender(db, id);
        grave.buryRender(db, acct, render.get("id"));
        db.run("DELETE FROM renders WHERE id = ?", render.get("id"));
        if (!VersionsController.stillUsed(db, render.get("digest")))
            blobs.delete(acct, (String) render.get("digest"));
        return Map.of("dismissed", render.get("id"));
    }

    @PostMapping("/api/renders/clear")
    public Object clear(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        int n = db.query("SELECT id FROM renders WHERE used_at > 0").size();
        db.run("DELETE FROM renders WHERE used_at > 0");
        return Map.of("cleared", n);
    }

    @GetMapping("/api/renders/{id}/audio")
    public ResponseEntity<Resource> audio(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> r = getRender(library.of(acct), id);
        return VersionsController.file(blobs.pathFor(acct, (String) r.get("digest")), (String) r.get("ext"), null, "render");
    }

    @PostMapping("/api/renders/examine")
    public Object examine(HttpServletRequest req) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        int limit = Math.max(1, Math.min(200, Api.queryInt(req, "limit", 60)));
        int looked = 0, found = 0;
        for (Map<String, Object> row : db.query("SELECT id, digest, ext FROM renders WHERE peaks = '' AND trouble = '' LIMIT ?", limit)) {
            Map<String, Object> shape = VersionsController.shapeOf(blobs.pathFor(acct, (String) row.get("digest")), (String) row.get("ext"));
            if (shape.get("peaks").equals("") && shape.get("trouble").equals("")) shape.put("trouble", "not looked at");
            db.update("renders", Accounts.num(row.get("id")), shape);
            looked++;
            if (shape.get("trouble").equals("silent") || shape.get("trouble").equals("unreadable")) found++;
        }
        Map<String, Object> left = db.one("SELECT COUNT(*) AS n FROM renders WHERE peaks = '' AND trouble = ''");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("looked_at", looked);
        out.put("trouble", found);
        out.put("left", left == null ? 0 : left.get("n"));
        return out;
    }
}
