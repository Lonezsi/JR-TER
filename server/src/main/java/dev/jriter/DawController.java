package dev.jriter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A song's DAW project, kept so friends can edit it together: a port of jriter/modules/daw.py.
 * The server stores one text and a revision. A save names the revision it grew from; if
 * somebody saved in between, the answer is the current text and the browser merges.
 * Who is in the DAW and their cursor are in memory only.
 */
@RestController
public class DawController {
    static final int MAX_TEXT = 2 * 1024 * 1024;
    static final double GONE_AFTER = 12.0;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;
    private final Accounts accounts;
    /** "library account:song" -> person id -> who and where. */
    private final Map<String, Map<Long, Map<String, Object>>> here = new ConcurrentHashMap<>();

    public DawController(Library library, Accounts accounts) {
        this.library = library;
        this.accounts = accounts;
    }

    private static Map<String, Object> project(Library.Db db, Object songId) {
        Map<String, Object> row = db.one("SELECT text, rev FROM daw_projects WHERE song_id = ?", songId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("text", row == null ? "" : row.get("text"));
        out.put("rev", row == null ? 0L : Accounts.num(row.get("rev")));
        return out;
    }

    private static Map<String, Object> cleanCursor(Object raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!(raw instanceof Map<?, ?> m)) return out;
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (out.size() >= 8) break;
            if (!(e.getKey() instanceof String k) || k.length() > 20) continue;
            Object v = e.getValue();
            if (v == null || v instanceof Number || v instanceof Boolean) out.put(k, v);
            else if (v instanceof String s) out.put(k, s.length() > 40 ? s.substring(0, 40) : s);
        }
        return out;
    }

    private List<Map<String, Object>> people(long libraryAccount, Object songId, long me, Map<String, Object> note) {
        Map<Long, Map<String, Object>> room =
                here.computeIfAbsent(libraryAccount + ":" + songId, k -> new ConcurrentHashMap<>());
        double now = Accounts.now();
        room.values().removeIf(p -> now - (Double) p.get("at") > GONE_AFTER);
        if (note != null) {
            Map<String, Object> who = accounts.pub(accounts.byId(me));
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", me);
            p.put("name", who == null || who.get("name") == null ? "?" : who.get("name"));
            p.put("hue", (me * 137) % 360);
            p.put("cursor", note);
            p.put("at", now);
            room.put(me, p);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<Long, Map<String, Object>> e : room.entrySet()) {
            if (e.getKey() == me) continue;
            Map<String, Object> p = new LinkedHashMap<>(e.getValue());
            p.remove("at");
            out.add(p);
        }
        return out;
    }

    @GetMapping("/api/songs/{id}/daw")
    public Object get(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> out = project(db, song.get("id"));
        out.put("people", people(acct, song.get("id"), Api.actor(req), null));
        return out;
    }

    @PutMapping("/api/songs/{id}/daw")
    public Object put(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> body = Body.json(req);
        Object t = body.get("text");
        if (t == null) throw new ApiError("text is needed");
        if (!(t instanceof String text) || text.length() > MAX_TEXT) throw new ApiError("That project is too big.", 413);
        try {
            JsonNode parsed = JSON.readTree(text);
            if (parsed == null || !parsed.isObject() || !parsed.path("tracks").isArray())
                throw new ApiError("That is not a DAW project.");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiError("That is not a DAW project.");
        }
        long base = 0;
        if (body.get("base") instanceof Number n) base = n.longValue();
        long me = Api.actor(req);
        double now = Accounts.now();
        boolean won;
        long rev;
        if (base == 0) {
            won = db.run("INSERT OR IGNORE INTO daw_projects (song_id, text, rev, updated_at, updated_by)"
                    + " VALUES (?, ?, 1, ?, ?)", song.get("id"), text, now, me) == 1;
            rev = 1;
        } else {
            won = db.run("UPDATE daw_projects SET text = ?, rev = rev + 1, updated_at = ?, updated_by = ?"
                    + " WHERE song_id = ? AND rev = ?", text, now, me, song.get("id"), base) == 1;
            rev = base + 1;
        }
        if (!won) {
            Map<String, Object> out = project(db, song.get("id"));
            out.put("conflict", true);
            return out;
        }
        SongsController.touch(db, song.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rev", rev);
        out.put("conflict", false);
        return out;
    }

    @PostMapping("/api/songs/{id}/daw/here")
    public Object here(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> cursor = cleanCursor(Body.json(req).get("cursor"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("people", people(acct, song.get("id"), Api.actor(req), cursor));
        out.put("rev", project(db, song.get("id")).get("rev"));
        return out;
    }
}
