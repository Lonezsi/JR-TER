package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Your own one-shots for the DAW (kicks, hits, effects): a port of jriter/modules/samples.py.
 * They belong to the library, not to a song. Deleting only hides them, so a project that still
 * points at one keeps playing and Undo brings it back.
 */
@RestController
public class SamplesController {
    static final List<String> EXT = List.of(".wav", ".mp3", ".ogg", ".opus", ".flac", ".m4a", ".aiff", ".aif");
    static final Map<String, String> TYPES = Map.of(
            ".wav", "audio/wav", ".mp3", "audio/mpeg", ".ogg", "audio/ogg", ".opus", "audio/ogg",
            ".flac", "audio/flac", ".m4a", "audio/mp4", ".aiff", "audio/aiff", ".aif", "audio/aiff");
    static final long MOST = 50L * 1024 * 1024;

    private final Library library;
    private final Blobs blobs;

    public SamplesController(Library library, Blobs blobs) {
        this.library = library;
        this.blobs = blobs;
    }

    private static Map<String, Object> row(Library.Db db, String id) {
        long n;
        try { n = Long.parseLong(id.strip()); } catch (NumberFormatException e) { throw new ApiError("id must be a whole number"); }
        Map<String, Object> r = db.one("SELECT * FROM samples WHERE id = ?", n);
        if (r == null) throw new ApiError("No such sound.", 404);
        return r;
    }

    private static Map<String, Object> out(Map<String, Object> r) {
        Map<String, Object> o = new LinkedHashMap<>();
        for (String k : new String[] {"id", "name", "folder", "ext", "size", "duration", "created_at"}) o.put(k, r.get(k));
        return o;
    }

    private static String clean(Object text, int most) {
        String s = text == null ? "" : String.join(" ", String.valueOf(text).strip().split("\\s+"));
        return s.length() > most ? s.substring(0, most) : s;
    }

    private static String unquote(String s) {
        try {
            return java.net.URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return s;
        }
    }

    @GetMapping("/api/samples")
    public Object list(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT * FROM samples WHERE deleted_at = 0"
                + " ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE, id")) out.add(out(r));
        return Map.of("samples", out);
    }

    @PostMapping("/api/samples")
    public Object add(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no sound in that upload");
        if (length > MOST) throw new ApiError("That sound is too long to keep here.", 413);
        String filename = Api.header(req, "X-Filename");
        if (req.getHeader("X-Filename-Enc") == null) filename = unquote(filename);
        filename = filename.strip();
        if (filename.isEmpty()) filename = "sound.wav";
        String ext = Api.extOf(filename);
        if (!EXT.contains(ext)) throw new ApiError((ext.isEmpty() ? filename : ext) + " is not a sound JR!TER can keep");
        double duration;
        try {
            String d = Api.header(req, "X-Duration");
            duration = d.isEmpty() ? 0 : Math.max(0.0, Double.parseDouble(d));
        } catch (NumberFormatException e) {
            throw new ApiError("X-Duration is seconds");
        }
        String folder = clean(unquote(Api.header(req, "X-Folder")), 80);
        String base = filename.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.substring(0, base.length() - Api.extOf(base).length());
        String name = clean(base, 80);
        if (name.isEmpty()) name = "Sound";
        Blobs.Stored stored = blobs.putStream(acct, req.getInputStream(), length);
        Map<String, Object> same = db.one("SELECT * FROM samples WHERE digest = ? AND name = ? AND folder = ?",
                stored.digest(), name, folder);
        if (same != null) {
            if (Accounts.num(same.get("deleted_at")) != 0) {
                Map<String, Object> back = new LinkedHashMap<>();
                back.put("deleted_at", 0);
                db.update("samples", Accounts.num(same.get("id")), back);
                same = row(db, String.valueOf(same.get("id")));
            }
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("sample", out(same));
            o.put("duplicate", true);
            return o;
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("name", name);
        v.put("folder", folder);
        v.put("digest", stored.digest());
        v.put("ext", ext);
        v.put("size", stored.size());
        v.put("duration", duration);
        v.put("created_at", Accounts.now());
        long made = db.insert("samples", v);
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("sample", out(row(db, String.valueOf(made))));
        o.put("duplicate", false);
        return o;
    }

    @PatchMapping("/api/samples/{id}")
    public Object change(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> r = row(db, id);
        Map<String, Object> body = Body.json(req);
        Map<String, Object> fields = new LinkedHashMap<>();
        if (body.containsKey("name")) {
            String n = clean(body.get("name"), 80);
            fields.put("name", n.isEmpty() ? r.get("name") : n);
        }
        if (body.containsKey("folder")) fields.put("folder", clean(body.get("folder"), 80));
        if (!fields.isEmpty()) db.update("samples", Accounts.num(r.get("id")), fields);
        return Map.of("sample", out(row(db, id)));
    }

    @DeleteMapping("/api/samples/{id}")
    public Object drop(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> r = row(db, id);
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("deleted_at", Accounts.now());
        db.update("samples", Accounts.num(r.get("id")), f);
        return Map.of("deleted", r.get("id"));
    }

    @PostMapping("/api/samples/{id}/restore")
    public Object restore(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> r = row(db, id);
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("deleted_at", 0);
        db.update("samples", Accounts.num(r.get("id")), f);
        return Map.of("sample", out(row(db, id)));
    }

    @GetMapping("/api/samples/{id}/audio")
    public ResponseEntity<Resource> audio(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> r = row(library.of(acct), id);
        return Api.serve(blobs.pathFor(acct, (String) r.get("digest")),
                TYPES.getOrDefault((String) r.get("ext"), "audio/wav"), null, "the sound is missing from storage");
    }
}
