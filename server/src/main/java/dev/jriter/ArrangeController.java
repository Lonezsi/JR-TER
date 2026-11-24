package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/** The compositor: a port of jriter/modules/arrange.py. */
@RestController
public class ArrangeController {
    static final int MAX_PARTS = 64;
    static final int MAX_CLIPS = 512;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;

    public ArrangeController(Library library) { this.library = library; }

    private static Map<String, Object> blank(Object songId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("song_id", songId);
        m.put("version_id", null);
        m.put("bpm", 120.0);
        m.put("offset", 0.0);
        m.put("per_bar", 4);
        m.put("enabled", 0);
        m.put("parts", new ArrayList<>());
        m.put("clips", new ArrayList<>());
        m.put("lyrics", new LinkedHashMap<>());
        m.put("updated_at", 0);
        return m;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> dataOf(Object text) {
        try {
            String s = text == null || String.valueOf(text).isEmpty() ? "{}" : String.valueOf(text);
            Object v = JSON.readValue(s, Object.class);
            return v instanceof Map ? (Map<String, Object>) v : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Object orEmpty(Object v, Object empty) { return truthy(v) ? v : empty; }

    private static Map<String, Object> read(Map<String, Object> row) {
        Map<String, Object> data = dataOf(row.get("data"));
        if (data == null) data = new LinkedHashMap<>();
        Map<String, Object> out = new LinkedHashMap<>(row);
        out.remove("data");
        out.put("parts", orEmpty(data.get("parts"), new ArrayList<>()));
        out.put("clips", orEmpty(data.get("clips"), new ArrayList<>()));
        out.put("lyrics", orEmpty(data.get("lyrics"), new LinkedHashMap<>()));
        return out;
    }

    static Map<String, Object> getFor(Library.Db db, Object songId) {
        Map<String, Object> row = db.one("SELECT * FROM arrangements WHERE song_id = ?", songId);
        return row == null ? blank(songId) : read(row);
    }

    /** Python truthiness of a JSON value. */
    static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.doubleValue() != 0;
        if (v instanceof String s) return !s.isEmpty();
        if (v instanceof java.util.Collection<?> c) return !c.isEmpty();
        if (v instanceof Map<?, ?> m) return !m.isEmpty();
        return true;
    }

    /** Python's %g for the limits used here. */
    private static String g(double d) {
        if (d == 1e6) return "1e+06";
        if (d == Math.rint(d)) return String.valueOf((long) d);
        return String.valueOf(d);
    }

    /** Returns a Long when the default is used (Python hands back its int default), else a Double. */
    private static Number number(Object value, String field, double low, double high, Double def) {
        if (value == null) {
            if (def == null) throw new ApiError(field + " is required");
            return def == Math.rint(def) ? (Number) (long) (double) def : def;
        }
        double n;
        try {
            if (value instanceof Number x) n = x.doubleValue();
            else if (value instanceof Boolean b) n = b ? 1 : 0;
            else if (value instanceof String s) n = Double.parseDouble(s.strip());
            else throw new NumberFormatException();
        } catch (NumberFormatException e) {
            throw new ApiError(field + " must be a number");
        }
        if (!(low <= n && n <= high))
            throw new ApiError(field + " must be between " + g(low) + " and " + g(high));
        return n;
    }

    private static String text(Object v) {
        if (v instanceof Double d && d == Math.rint(d) && !d.isInfinite()) return d + "";
        return String.valueOf(v);
    }

    @SuppressWarnings("unchecked")
    private static List<Object> spans(Object items, String kind, int limit, Set<String> knownParts) {
        if (!(items instanceof List)) throw new ApiError(kind + " must be a list");
        List<Object> list = (List<Object>) items;
        if (list.size() > limit) throw new ApiError("that is more than " + limit + " " + kind);
        List<Object> out = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            if (!(list.get(i) instanceof Map)) throw new ApiError(kind + " " + (i + 1) + " is not an object");
            Map<String, Object> item = (Map<String, Object>) list.get(i);
            Map<String, Object> span = new LinkedHashMap<>();
            String id = truthy(item.get("id")) ? text(item.get("id")) : kind.charAt(0) + "" + (i + 1);
            span.put("id", id.length() > 40 ? id.substring(0, 40) : id);
            span.put("from", number(item.get("from"), kind + " start", 0, 1e6, 0.0));
            span.put("beats", number(item.get("beats"), kind + " length", 0.001, 1e6, 4.0));
            if (kind.equals("parts")) {
                String name = (truthy(item.get("name")) ? text(item.get("name")) : "Part " + (i + 1)).strip();
                span.put("name", name.length() > 60 ? name.substring(0, 60) : name);
                span.put("hue", number(item.get("hue"), "hue", 0, 360, 140.0).longValue());
            } else {
                Object part = item.get("part");
                if (part != null) {
                    String p = text(part);
                    if (p.length() > 40) p = p.substring(0, 40);
                    if (knownParts != null && !knownParts.contains(p)) part = null;
                    else part = p;
                }
                span.put("part", part);
            }
            out.add(span);
        }
        return out;
    }

    @PutMapping("/api/songs/{id}/arrangement")
    public Object save(HttpServletRequest req, @PathVariable String id) throws Exception {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> body = Body.json(req);

        Number bpm = number(body.get("bpm"), "bpm", 20, 400, 120.0);
        Number offset = number(body.get("offset"), "offset", -60, 600, 0.0);
        long perBar = number(body.get("per_bar"), "beats in a bar", 1, 16, 4.0).longValue();
        List<Object> parts = spans(orEmpty(body.get("parts"), new ArrayList<>()), "parts", MAX_PARTS, null);
        Set<String> known = new HashSet<>();
        for (Object p : parts) known.add((String) ((Map<?, ?>) p).get("id"));
        List<Object> clips = spans(orEmpty(body.get("clips"), new ArrayList<>()), "clips", MAX_CLIPS, known);

        Object links = orEmpty(body.get("lyrics"), new LinkedHashMap<>());
        if (!(links instanceof Map)) throw new ApiError("lyrics links must be an object");
        Map<String, Object> lyrics = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) links).entrySet()) {
            String partId = String.valueOf(e.getKey());
            Object sheet = e.getValue();
            if (known.contains(partId) && sheet != null) {
                try {
                    if (sheet instanceof Number n) lyrics.put(partId, n.longValue());
                    else if (sheet instanceof Boolean b) lyrics.put(partId, b ? 1L : 0L);
                    else if (sheet instanceof String s) lyrics.put(partId, Long.parseLong(s.strip()));
                    else throw new NumberFormatException();
                } catch (NumberFormatException ex) {
                    throw new ApiError("a lyrics link must be a sheet id");
                }
            }
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("parts", parts);
        data.put("clips", clips);
        data.put("lyrics", lyrics);
        db.run("INSERT INTO arrangements (song_id, version_id, bpm, offset, per_bar, enabled, data, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET"
                + " version_id = excluded.version_id, bpm = excluded.bpm, offset = excluded.offset,"
                + " per_bar = excluded.per_bar, enabled = excluded.enabled, data = excluded.data,"
                + " updated_at = excluded.updated_at",
                song.get("id"), body.get("version_id"), bpm.doubleValue(), offset.doubleValue(), perBar,
                truthy(body.get("enabled")) ? 1 : 0, JSON.writeValueAsString(data), Accounts.now());
        return Map.of("arrangement", getFor(db, song.get("id")));
    }

    @GetMapping("/api/songs/{id}/arrangement")
    public Object get(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        return Map.of("arrangement", getFor(db, song.get("id")));
    }

    @SuppressWarnings("unchecked")
    @GetMapping("/api/arrangements/shapes")
    public Object shapes(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map<String, Object> row : db.query("SELECT song_id, data FROM arrangements WHERE enabled = 1")) {
            Map<String, Object> data = dataOf(row.get("data"));
            if (data == null) continue;
            Map<Object, Map<String, Object>> parts = new LinkedHashMap<>();
            Object plist = data.get("parts");
            if (plist instanceof List<?> pl)
                for (Object p : pl) if (p instanceof Map<?, ?> pm) parts.put(pm.get("id"), (Map<String, Object>) pm);
            List<Object> shape = new ArrayList<>();
            Object clist = data.get("clips");
            if (clist instanceof List<?> cl)
                for (Object c : cl) {
                    if (!(c instanceof Map<?, ?> cm)) continue;
                    Map<String, Object> part = parts.get(cm.get("part"));
                    Map<String, Object> s = new LinkedHashMap<>();
                    s.put("beats", truthy(cm.get("beats")) ? cm.get("beats") : 1);
                    s.put("hue", part != null && part.containsKey("hue") ? part.get("hue") : 210);
                    shape.add(s);
                }
            out.put(String.valueOf(row.get("song_id")), shape);
        }
        return Map.of("shapes", out);
    }

    @PostMapping("/api/songs/{id}/arrangement/enabled")
    public Object enabled(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Object v = Body.json(req).get("on");
        if (v == null || (v instanceof String s && s.isBlank())) throw new ApiError("on is required");
        if (v instanceof String s) v = s.strip();
        boolean on = Boolean.TRUE.equals(v) || (v instanceof Number n && n.doubleValue() == 1)
                || "1".equals(v) || "true".equals(v);
        if (db.one("SELECT song_id FROM arrangements WHERE song_id = ?", song.get("id")) == null)
            throw new ApiError("that song has no arrangement yet", 404);
        db.run("UPDATE arrangements SET enabled = ?, updated_at = ? WHERE song_id = ?",
                on ? 1 : 0, Accounts.now(), song.get("id"));
        return Map.of("arrangement", getFor(db, song.get("id")));
    }

    @DeleteMapping("/api/songs/{id}/arrangement")
    public Object forget(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        db.run("DELETE FROM arrangements WHERE song_id = ?", song.get("id"));
        return Map.of("arrangement", blank(song.get("id")));
    }
}
