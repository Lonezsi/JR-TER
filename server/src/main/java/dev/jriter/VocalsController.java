package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
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

/** Voices recorded over a song: a port of jriter/modules/vocals.py. */
@RestController
public class VocalsController {
    static final List<String> EFFECTS = List.of("eq", "limiter", "autotune", "sidechain");
    static final List<String> EXT = List.of(".webm", ".ogg", ".opus", ".m4a", ".mp4", ".aac", ".mp3", ".wav", ".flac");
    static final Map<String, String> TYPES = Map.of(
            ".webm", "audio/webm", ".ogg", "audio/ogg", ".opus", "audio/ogg", ".m4a", "audio/mp4",
            ".mp4", "audio/mp4", ".aac", "audio/aac", ".mp3", "audio/mpeg", ".wav", "audio/wav",
            ".flac", "audio/flac");
    static final long MOST = 400L * 1024 * 1024;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;
    private final Grave grave;
    private final Blobs blobs;
    private final Accounts accounts;

    public VocalsController(Library library, Blobs blobs, Accounts accounts, Grave grave) {
        this.library = library;
        this.blobs = blobs;
        this.grave = grave;
        this.accounts = accounts;
    }

    static Map<String, Object> take(Library.Db db, String id) {
        long n;
        try { n = Long.parseLong(id.strip()); } catch (NumberFormatException e) { throw new ApiError("id must be a whole number"); }
        Map<String, Object> row = db.one("SELECT * FROM vocal_takes WHERE id = ?", n);
        if (row == null) throw new ApiError("No such recording.", 404);
        return row;
    }

    /** A guest may change or delete only the takes they recorded themselves. */
    static void mineOrRefuse(HttpServletRequest req, Map<String, Object> take) {
        long g = Api.guest(req);
        if (g != 0 && Accounts.num(take.get("author")) != g)
            throw new ApiError("Only whoever recorded this can change or delete it.", 403);
    }

    private Map<String, Object> out(Map<String, Object> row, long me) {
        Map<String, Object> o = new LinkedHashMap<>(row);
        Object chain;
        try {
            Object raw = row.get("chain");
            chain = JSON.readValue(raw == null || String.valueOf(raw).isEmpty() ? "[]" : String.valueOf(raw), Object.class);
        } catch (Exception e) {
            chain = new java.util.ArrayList<>();
        }
        o.put("chain", chain);
        long author = Accounts.num(row.get("author"));
        Map<String, Object> person = author != 0 ? accounts.pub(accounts.byId(author)) : null;
        String name = person == null ? "" : String.valueOf(person.get("name"));
        String handle = person == null ? "" : String.valueOf(person.get("handle"));
        o.put("by", !name.isEmpty() ? name : handle);
        o.put("by_handle", handle);
        o.put("yours", author == me);
        return o;
    }

    @GetMapping("/api/songs/{id}/vocals")
    public Object list(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Object> takes = new java.util.ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT * FROM vocal_takes WHERE song_id = ? ORDER BY id", song.get("id")))
            takes.add(out(r, Api.actor(req)));
        return Map.of("takes", takes);
    }

    private static String unquote(String s) {
        try {
            return java.net.URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return s;
        }
    }

    private static double seconds(String raw) {
        if (raw.isEmpty()) return 0;
        return Math.max(0.0, Double.parseDouble(raw));
    }

    @PostMapping("/api/songs/{id}/vocals")
    public Object add(HttpServletRequest req, @PathVariable String id) throws IOException {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no recording in that upload");
        if (length > MOST) throw new ApiError("That recording is too long to keep here.", 413);
        String name = Api.header(req, "X-Filename");
        if (name.isEmpty()) name = "take.webm";
        if (req.getHeader("X-Filename-Enc") == null) name = unquote(name);
        String ext = Api.extOf(name);
        if (!EXT.contains(ext)) throw new ApiError((ext.isEmpty() ? name : ext) + " is not a recording JR!TER can keep");
        double offset, duration;
        try {
            offset = seconds(Api.header(req, "X-Offset"));
            duration = seconds(Api.header(req, "X-Duration"));
        } catch (NumberFormatException e) {
            throw new ApiError("X-Offset and X-Duration are seconds");
        }
        Blobs.Stored stored = blobs.putUpload(req, acct, length);
        double now = Accounts.now();
        String label = Api.header(req, "X-Label");
        if (label.length() > 80) label = label.substring(0, 80);
        if (label.isEmpty()) {
            label = ext.isEmpty() ? name : name.substring(0, name.length() - ext.length());
            if (label.length() > 80) label = label.substring(0, 80);
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", song.get("id"));
        v.put("author", Api.actor(req));
        v.put("name", label);
        v.put("digest", stored.digest());
        v.put("ext", ext);
        v.put("size", stored.size());
        v.put("duration", duration);
        v.put("offset", offset);
        v.put("created_at", now);
        v.put("updated_at", now);
        long made = db.insert("vocal_takes", v);
        SongsController.touch(db, song.get("id"));
        return Map.of("take", out(take(db, String.valueOf(made)), Api.actor(req)));
    }

    private static double number(Object v, String field) {
        try {
            if (v instanceof Number n) return n.doubleValue();
            if (v instanceof Boolean b) return b ? 1 : 0;
            return Double.parseDouble(String.valueOf(v).strip());
        } catch (NumberFormatException e) {
            throw new ApiError(field + " must be a number");
        }
    }

    @PatchMapping("/api/vocals/{id}")
    public Object change(HttpServletRequest req, @PathVariable String id) throws Exception {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> take = take(db, id);
        mineOrRefuse(req, take);
        Map<String, Object> body = Body.json(req);
        Map<String, Object> f = new LinkedHashMap<>();
        if (body.containsKey("name")) {
            Object n = body.get("name");
            String s = ArrangeController.truthy(n) ? String.valueOf(n).strip() : "";
            f.put("name", s.length() > 80 ? s.substring(0, 80) : s);
        }
        if (body.containsKey("enabled")) f.put("enabled", ArrangeController.truthy(body.get("enabled")) ? 1 : 0);
        if (body.containsKey("gain")) f.put("gain", Math.min(4.0, Math.max(0.0, number(body.get("gain"), "gain"))));
        if (body.containsKey("offset")) f.put("offset", Math.max(0.0, number(body.get("offset"), "offset")));
        if (body.containsKey("fx")) f.put("fx", ArrangeController.truthy(body.get("fx")) ? 1 : 0);
        if (body.containsKey("chain")) {
            Object chain = body.get("chain");
            if (!(chain instanceof List<?> list) || list.size() > 16)
                throw new ApiError("chain is a list of at most sixteen effects");
            for (Object e : list)
                if (!(e instanceof Map<?, ?> m) || !EFFECTS.contains(m.get("type")))
                    throw new ApiError("an effect is one of: " + String.join(", ", EFFECTS));
            f.put("chain", JSON.writeValueAsString(chain));
        }
        if (f.isEmpty()) return Map.of("take", out(take, Api.actor(req)));
        f.put("updated_at", Accounts.now());
        db.update("vocal_takes", Accounts.num(take.get("id")), f);
        return Map.of("take", out(take(db, String.valueOf(take.get("id"))), Api.actor(req)));
    }

    @DeleteMapping("/api/vocals/{id}")
    public Object drop(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> take = take(db, id);
        mineOrRefuse(req, take);
        grave.buryTake(db, acct, take.get("id"));
        db.run("DELETE FROM vocal_takes WHERE id = ?", take.get("id"));
        return Map.of("deleted", take.get("id"));
    }

    @GetMapping("/api/vocals/{id}/audio")
    public ResponseEntity<Resource> audio(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> take = take(library.of(acct), id);
        String download = null;
        String q = req.getParameter("download");
        if (q != null && !q.isEmpty()) {
            Object n = take.get("name");
            String base = n == null || String.valueOf(n).isEmpty() ? "voice" : String.valueOf(n);
            StringBuilder safe = new StringBuilder();
            for (char c : base.toCharArray())
                if (Character.isLetterOrDigit(c) || c == ' ' || c == '-' || c == '_') safe.append(c);
            String s = safe.toString().strip();
            download = (s.isEmpty() ? "voice" : s) + take.get("ext");
        }
        return Api.serve(blobs.pathFor(acct, (String) take.get("digest")),
                TYPES.getOrDefault((String) take.get("ext"), "audio/webm"), download,
                "the recording is missing from storage");
    }
}
