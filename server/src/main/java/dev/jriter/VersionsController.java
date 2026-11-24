package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/** Takes of a song: a port of jriter/modules/versions.py. */
@RestController
public class VersionsController {
    private final Library library;
    private final Grave grave;
    private final Blobs blobs;

    public VersionsController(Library library, Blobs blobs, Grave grave) {
        this.library = library;
        this.blobs = blobs;
        this.grave = grave;
    }

    static Map<String, Object> getVersion(Library.Db db, Object id) {
        Map<String, Object> v = db.one("SELECT * FROM versions WHERE id = ?", id);
        if (v == null) throw new ApiError("no version with id " + id, 404);
        return v;
    }

    /** The drawn shape and verdict of a stored file (see versions._shape_of). */
    static Map<String, Object> shapeOf(Path file, String ext) {
        Map<String, Object> out = new LinkedHashMap<>();
        AudioMeta.Peaks found = AudioMeta.peaks(file, ext);
        String trouble = found.unreadable() ? "unreadable" : found.silent() ? "silent" : "";
        StringBuilder sb = new StringBuilder();
        for (int p : found.peaks()) {
            if (sb.length() > 0) sb.append(',');
            sb.append(p);
        }
        out.put("peaks", sb.toString());
        out.put("peak_db", found.peakDb());
        out.put("trouble", trouble);
        return out;
    }

    static final java.util.Set<String> PLUGIN_KINDS = java.util.Set.of("vst2", "vst3", "fl");
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    /** A plugin list from an X-Plugins header as compact JSON, or "" if nothing usable (see versions.clean_plugins). */
    static String cleanPlugins(String raw) {
        if (raw == null || raw.isBlank()) return "";
        try {
            com.fasterxml.jackson.databind.JsonNode in = MAPPER.readTree(raw);
            if (in == null || !in.isArray()) return "";
            com.fasterxml.jackson.databind.node.ArrayNode out = MAPPER.createArrayNode();
            int seen = 0;
            for (com.fasterxml.jackson.databind.JsonNode it : in) {
                if (seen++ >= 200) break;
                if (!it.isObject() || !PLUGIN_KINDS.contains(it.path("kind").asText(""))) continue;
                String name = cut(it.path("name").asText("")); 
                if (name.isEmpty()) continue;
                com.fasterxml.jackson.databind.node.ObjectNode o = out.addObject();
                o.put("kind", it.path("kind").asText());
                o.put("name", name);
                o.put("vendor", cut(it.path("vendor").asText("")));
                o.put("uses", Math.max(1, it.path("uses").asInt(1)));
                if (it.path("installed").isBoolean()) o.put("installed", it.path("installed").asBoolean());
            }
            return out.isEmpty() ? "" : MAPPER.writeValueAsString(out);
        } catch (Exception e) {
            return "";
        }
    }

    private static String cut(String s) {
        s = s.strip();
        return s.length() > 200 ? s.substring(0, 200) : s;
    }

    /** The stored string as a list; empty for nothing or damage. */
    static List<Object> pluginList(Object text) {
        if (text == null || text.toString().isBlank()) return new ArrayList<>();
        try {
            return MAPPER.readValue(text.toString(), new com.fasterxml.jackson.core.type.TypeReference<List<Object>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    static List<Integer> shapeList(Object raw) {
        List<Integer> out = new ArrayList<>();
        if (raw == null) return out;
        for (String n : raw.toString().split(","))
            if (!n.isEmpty() && n.chars().allMatch(Character::isDigit)) out.add(Integer.parseInt(n));
        return out;
    }

    /** A version row pointing at bytes already in the store. Returns the row and whether it was already there. */
    record Added(Map<String, Object> version, boolean already) {}

    Added addStored(long acct, long songId, String digest, String ext, long size, double duration, int bitrate,
                    String label, String filename, String sourcePath, double projectAt, double renderedAt) {
        return addStored(acct, songId, digest, ext, size, duration, bitrate, label, filename, sourcePath, projectAt, renderedAt, "");
    }

    Added addStored(long acct, long songId, String digest, String ext, long size, double duration, int bitrate,
                    String label, String filename, String sourcePath, double projectAt, double renderedAt, String plugins) {
        Library.Db db = library.of(acct);
        Map<String, Object> same = db.one("SELECT * FROM versions WHERE song_id = ? AND digest = ?", songId, digest);
        if (same != null) return new Added(same, true);
        Map<String, Object> row = db.one("SELECT MAX(n) AS n FROM versions WHERE song_id = ?", songId);
        long next = (row == null || row.get("n") == null ? 0 : Accounts.num(row.get("n"))) + 1;
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", songId);
        v.put("n", next);
        v.put("digest", digest);
        v.put("ext", ext);
        v.put("size", size);
        v.put("duration", duration);
        v.put("bitrate", bitrate);
        v.put("label", label == null ? "" : label);
        v.put("filename", filename == null ? "" : filename);
        v.put("source_path", sourcePath == null ? "" : sourcePath);
        v.put("created_at", Accounts.now());
        v.put("project_at", projectAt);
        v.put("rendered_at", renderedAt);
        v.put("plugins", plugins == null ? "" : plugins);
        v.putAll(shapeOf(blobs.pathFor(acct, digest), ext));
        long id = db.insert("versions", v);
        Map<String, Object> song = new LinkedHashMap<>();
        song.put("current_version_id", id);
        song.put("updated_at", Accounts.now());
        db.update("songs", songId, song);
        return new Added(getVersion(db, id), false);
    }

    @GetMapping("/api/songs/{id}/versions")
    public Object list(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Map<String, Object>> rows = db.query("SELECT * FROM versions WHERE song_id = ? ORDER BY n DESC", song.get("id"));
        for (Map<String, Object> r : rows) { r.put("shape", shapeList(r.remove("peaks"))); r.put("plugins", pluginList(r.get("plugins"))); Object d = r.remove("daw"); r.put("has_daw", d != null && !d.toString().isEmpty()); }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("versions", rows);
        out.put("current_version_id", song.get("current_version_id"));
        return out;
    }

    @PostMapping("/api/songs/{id}/versions")
    public Object upload(HttpServletRequest req, @PathVariable String id) throws IOException {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        long songId = Accounts.num(song.get("id"));
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no file in that upload");
        String filename = Api.header(req, "X-Filename");
        if (filename.isEmpty()) filename = "render.mp3";
        String ext = Api.extOf(filename);
        if (!Api.AUDIO_EXT.contains(ext))
            throw new ApiError((ext.isEmpty() ? filename : ext) + " is not an audio file JR!TER handles");

        Blobs.Stored stored = blobs.putStream(acct, req.getInputStream(), length);
        Map<String, Object> same = db.one("SELECT * FROM versions WHERE song_id = ? AND digest = ?", songId, stored.digest());
        if (same != null) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("version", same);
            out.put("duplicate", true);
            out.put("message", "That is byte for byte v" + same.get("n") + ", so nothing was added.");
            return out;
        }
        AudioMeta.Probe meta = AudioMeta.probe(blobs.pathFor(acct, stored.digest()), ext);
        double duration = meta.duration();
        String hd = Api.header(req, "X-Duration");
        if (duration == 0 && !hd.isEmpty()) {
            try {
                duration = Double.parseDouble(hd);
            } catch (NumberFormatException e) {
                duration = 0.0;
            }
        }
        Added a = addStored(acct, songId, stored.digest(), ext, stored.size(), duration, meta.bitrate(),
                Api.header(req, "X-Label"), filename, Api.header(req, "X-Source-Path"), 0.0, 0.0);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", a.version());
        out.put("duplicate", false);
        return out;
    }

    /** The DAW project a bounce was made from. */
    @GetMapping("/api/versions/{id}/daw")
    public Object getDaw(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> v = getVersion(library.of(Api.acct(req)), id);
        Object text = v.get("daw");
        if (text == null || text.toString().isEmpty()) throw new ApiError("That version has no DAW project.", 404);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version_id", v.get("id"));
        out.put("song_id", v.get("song_id"));
        out.put("n", v.get("n"));
        out.put("text", text);
        return out;
    }

    @PutMapping("/api/versions/{id}/daw")
    public Object putDaw(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> v = getVersion(db, id);
        Object text = Body.json(req).get("text");
        if (text == null) throw new ApiError("text is needed");
        DawController.checkText(text);
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("daw", text);
        db.update("versions", Accounts.num(v.get("id")), patch);
        return Map.of("ok", true);
    }

    @GetMapping("/api/versions/have")
    public Object have(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        List<String> digests = new ArrayList<>();
        String raw = req.getParameter("digest");
        if (raw != null) for (String d : raw.split(",")) if (!d.isEmpty()) digests.add(d);
        if (digests.isEmpty()) throw new ApiError("digest is required");
        if (digests.size() > 500) throw new ApiError("ask about at most 500 files at a time");
        String marks = String.join(",", java.util.Collections.nCopies(digests.size(), "?"));
        Map<String, Map<String, Object>> found = new HashMap<>();
        for (Map<String, Object> r : db.query("SELECT v.digest, v.id, v.n, v.song_id, s.title FROM versions v"
                + " JOIN songs s ON s.id = v.song_id WHERE v.digest IN (" + marks + ")", digests.toArray()))
            found.put((String) r.get("digest"), r);
        Map<String, Object> have = new LinkedHashMap<>();
        for (String d : digests) have.put(d, found.get(d));
        return Map.of("have", have);
    }

    @PatchMapping("/api/versions/{id}")
    public Object patch(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> version = getVersion(db, id);
        Map<String, Object> data = Body.json(req);
        Map<String, Object> patch = new LinkedHashMap<>();
        if (data.containsKey("label")) patch.put("label", Body.str(data, "label").strip());
        if (data.containsKey("duration")) {
            try {
                Object d = data.get("duration");
                patch.put("duration", Math.max(0.0, d instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(d))));
            } catch (NumberFormatException e) {
                throw new ApiError("duration must be a number");
            }
        }
        db.update("versions", Accounts.num(version.get("id")), patch);
        SongsController.touch(db, version.get("song_id"));
        return Map.of("version", getVersion(db, version.get("id")));
    }

    @PostMapping("/api/versions/{id}/current")
    public Object makeCurrent(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> version = getVersion(db, id);
        Map<String, Object> song = new LinkedHashMap<>();
        song.put("current_version_id", version.get("id"));
        song.put("updated_at", Accounts.now());
        db.update("songs", Accounts.num(version.get("song_id")), song);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("song_id", version.get("song_id"));
        out.put("current_version_id", version.get("id"));
        return out;
    }

    @DeleteMapping("/api/versions/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> version = getVersion(db, id);
        grave.buryVersion(db, acct, version.get("id"));
        db.run("DELETE FROM versions WHERE id = ?", version.get("id"));
        Map<String, Object> song = db.one("SELECT * FROM songs WHERE id = ?", version.get("song_id"));
        if (song != null && version.get("id").equals(song.get("current_version_id"))) {
            Map<String, Object> newest = db.one("SELECT id FROM versions WHERE song_id = ? ORDER BY n DESC LIMIT 1", song.get("id"));
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("current_version_id", newest == null ? null : newest.get("id"));
            db.update("songs", Accounts.num(song.get("id")), p);
        }
        if (song != null) SongsController.touch(db, song.get("id"));
        Object digest = version.get("digest");
        if (!stillUsed(db, digest)) blobs.delete(acct, (String) digest);
        return Map.of("deleted", version.get("id"));
    }

    /** Does any row still point at this blob? (versions, renders, artwork, voice takes, album covers) */
    static boolean stillUsed(Library.Db db, Object digest) {
        return db.one("SELECT id FROM versions WHERE digest = ? LIMIT 1", digest) != null
                || db.one("SELECT id FROM renders WHERE digest = ? LIMIT 1", digest) != null
                || db.one("SELECT id FROM artwork WHERE digest = ? LIMIT 1", digest) != null
                || db.one("SELECT id FROM vocal_takes WHERE digest = ? LIMIT 1", digest) != null
                || db.one("SELECT id FROM albums WHERE cover_digest = ? LIMIT 1", digest) != null;
    }

    /** The stored file as a response: Spring answers Range requests itself. */
    static ResponseEntity<Resource> file(Path path, String ext, String downloadName, String what) {
        if (!Files.isRegularFile(path)) throw new ApiError("the file for that " + what + " is missing from storage", 410);
        ResponseEntity.BodyBuilder b = ResponseEntity.ok().contentType(MediaType.parseMediaType(Api.audioType(ext)));
        if (downloadName != null)
            b.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + downloadName + "\"");
        return b.body(new FileSystemResource(path));
    }

    @GetMapping("/api/versions/{id}/audio")
    public ResponseEntity<Resource> audio(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> v = getVersion(library.of(acct), id);
        return file(blobs.pathFor(acct, (String) v.get("digest")), (String) v.get("ext"), null, "version");
    }

    @GetMapping("/api/versions/{id}/download")
    public ResponseEntity<Resource> download(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> v = getVersion(library.of(acct), id);
        String name = (String) v.get("filename");
        if (name == null || name.isEmpty()) name = "v" + v.get("n") + v.get("ext");
        return file(blobs.pathFor(acct, (String) v.get("digest")), (String) v.get("ext"), name, "version");
    }

    @PostMapping("/api/versions/examine")
    public Object examine(HttpServletRequest req) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        int limit = Math.max(1, Math.min(200, Api.queryInt(req, "limit", 60)));
        int looked = 0, found = 0;
        for (Map<String, Object> row : db.query("SELECT id, digest, ext FROM versions WHERE peaks = '' AND trouble = '' LIMIT ?", limit)) {
            Map<String, Object> shape = shapeOf(blobs.pathFor(acct, (String) row.get("digest")), (String) row.get("ext"));
            if (shape.get("peaks").equals("") && shape.get("trouble").equals("")) shape.put("trouble", "not looked at");
            db.update("versions", Accounts.num(row.get("id")), shape);
            looked++;
            if (shape.get("trouble").equals("silent") || shape.get("trouble").equals("unreadable")) found++;
        }
        Map<String, Object> left = db.one("SELECT COUNT(*) AS n FROM versions WHERE peaks = '' AND trouble = ''");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("looked_at", looked);
        out.put("trouble", found);
        out.put("left", left == null ? 0 : left.get("n"));
        return out;
    }
}
