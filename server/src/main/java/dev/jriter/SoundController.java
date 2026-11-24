package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/** Per-song sound presets (an EQ curve and a limiter): a port of jriter/modules/sound.py. */
@RestController
public class SoundController {
    static final List<String> FILTER_TYPES =
            List.of("peaking", "lowshelf", "highshelf", "lowpass", "highpass", "notch", "bandpass");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;

    public SoundController(Library library) { this.library = library; }

    static Map<String, Object> defaults() {
        Map<String, Object> limiter = new LinkedHashMap<>();
        limiter.put("on", false);
        limiter.put("threshold", -6.0);
        limiter.put("ceiling", -0.3);
        limiter.put("release", 120.0);
        limiter.put("attack", 5.0);
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("bands", new ArrayList<>());
        d.put("limiter", limiter);
        d.put("gain", 0.0);
        d.put("bypass", false);
        return d;
    }

    static double clamp(Object value, double low, double high, double def) {
        double n;
        if (value instanceof Number num) n = num.doubleValue();
        else if (value instanceof String s) {
            try { n = Double.parseDouble(s.strip()); } catch (NumberFormatException e) { return def; }
        } else if (value instanceof Boolean b) n = b ? 1 : 0;
        else return def;
        if (Double.isNaN(n)) return def;
        return Math.max(low, Math.min(high, n));
    }

    static boolean truthy(Object v, boolean def) {
        if (v == null) return def;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.doubleValue() != 0;
        if (v instanceof String s) return !s.isEmpty();
        if (v instanceof java.util.Collection<?> c) return !c.isEmpty();
        if (v instanceof Map<?, ?> m) return !m.isEmpty();
        return true;
    }

    /** Clamp anything a client sends into ranges Web Audio will accept. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> normalise(Object rawIn) {
        Map<String, Object> raw = rawIn instanceof Map ? (Map<String, Object>) rawIn : new LinkedHashMap<>();
        Map<String, Object> out = new LinkedHashMap<>();
        List<Object> bands = new ArrayList<>();
        out.put("bands", bands);
        out.put("limiter", defaults().get("limiter"));
        out.put("gain", clamp(raw.get("gain") == null ? 0.0 : raw.get("gain"), -24.0, 24.0, 0.0));
        out.put("bypass", truthy(raw.get("bypass"), false));
        Object list = raw.get("bands");
        if (list instanceof List<?> l) {
            for (Object b : l.subList(0, Math.min(24, l.size()))) {
                if (!(b instanceof Map)) continue;
                Map<String, Object> band = (Map<String, Object>) b;
                Object kind = band.get("type") == null ? "peaking" : band.get("type");
                if (!(kind instanceof String k) || !FILTER_TYPES.contains(k)) kind = "peaking";
                Object id = band.get("id");
                if (id == null || (id instanceof String s && s.isEmpty()) || Boolean.FALSE.equals(id)
                        || (id instanceof Number n && n.doubleValue() == 0)) id = "b" + (bands.size() + 1);
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("id", id);
                o.put("type", kind);
                o.put("freq", clamp(band.getOrDefault("freq", 1000), 10.0, 22000.0, 1000.0));
                o.put("gain", clamp(band.getOrDefault("gain", 0.0), -30.0, 30.0, 0.0));
                o.put("q", clamp(band.getOrDefault("q", 1.0), 0.05, 30.0, 1.0));
                o.put("on", truthy(band.get("on"), true));
                bands.add(o);
            }
        }
        Object lim = raw.get("limiter");
        if (lim == null || (lim instanceof Map<?, ?> m && m.isEmpty())) lim = new LinkedHashMap<String, Object>();
        if (lim instanceof Map) {
            Map<String, Object> l = (Map<String, Object>) lim;
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("on", truthy(l.get("on"), false));
            o.put("threshold", clamp(l.getOrDefault("threshold", -6.0), -60.0, 0.0, -6.0));
            o.put("ceiling", clamp(l.getOrDefault("ceiling", -0.3), -30.0, 0.0, -0.3));
            o.put("release", clamp(l.getOrDefault("release", 120.0), 1.0, 1000.0, 120.0));
            o.put("attack", clamp(l.getOrDefault("attack", 5.0), 0.0, 100.0, 5.0));
            out.put("limiter", o);
        }
        return out;
    }

    static String dump(Object o) {
        try { return JSON.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** A stored preset row as the API shows it: data parsed and normalised. */
    static Map<String, Object> row(Map<String, Object> preset) {
        Map<String, Object> out = new LinkedHashMap<>(preset);
        try {
            out.put("data", normalise(JSON.readValue(String.valueOf(preset.get("data")), Object.class)));
        } catch (Exception e) {
            out.put("data", defaults());
        }
        return out;
    }

    static Map<String, Object> get(Library.Db db, Object id) {
        Map<String, Object> r = db.one("SELECT * FROM sound_presets WHERE id = ?", id);
        if (r == null) throw new ApiError("no preset with id " + id, 404);
        return r;
    }

    @GetMapping("/api/songs/{id}/sound")
    public Object list(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Map<String, Object>> rows = db.query("SELECT * FROM sound_presets WHERE song_id = ? ORDER BY id", song.get("id"));
        if (rows.isEmpty()) {
            double now = Accounts.now();
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("song_id", song.get("id"));
            v.put("name", "Current");
            v.put("is_current", 1);
            v.put("data", dump(defaults()));
            v.put("created_at", now);
            v.put("updated_at", now);
            long made = db.insert("sound_presets", v);
            rows = db.query("SELECT * FROM sound_presets WHERE id = ?", made);
        }
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> r : rows) out.add(row(r));
        return Map.of("presets", out);
    }

    @PostMapping("/api/songs/{id}/sound")
    @SuppressWarnings("unchecked")
    public Object create(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> data = Body.json(req);
        String name = Body.need(data, "name");
        Object payload = data.get("data");
        if (payload == null && truthy(data.get("copy_from"), false)) {
            Map<String, Object> source = get(db, data.get("copy_from"));
            if (Accounts.num(source.get("song_id")) != Accounts.num(song.get("id")))
                throw new ApiError("that preset belongs to another song");
            try { payload = JSON.readValue(String.valueOf(source.get("data")), Object.class); }
            catch (Exception e) { payload = null; }
        }
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", song.get("id"));
        v.put("name", name);
        v.put("is_current", 0);
        v.put("data", dump(normalise(payload == null || (payload instanceof Map<?, ?> m && m.isEmpty()) ? defaults() : payload)));
        v.put("created_at", now);
        v.put("updated_at", now);
        long made = db.insert("sound_presets", v);
        return Map.of("preset", row(get(db, made)));
    }

    @PutMapping("/api/sound/{id}")
    @SuppressWarnings("unchecked")
    public Object save(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> preset = get(db, id);
        Map<String, Object> body = Body.json(req);
        Object payload = body.containsKey("data") ? body.get("data") : body;
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("data", dump(normalise(payload)));
        v.put("updated_at", Accounts.now());
        db.update("sound_presets", Accounts.num(preset.get("id")), v);
        SongsController.touch(db, preset.get("song_id"));
        return Map.of("preset", row(get(db, preset.get("id"))));
    }

    @PatchMapping("/api/sound/{id}")
    public Object rename(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> preset = get(db, id);
        db.update("sound_presets", Accounts.num(preset.get("id")), Map.of("name", Body.need(Body.json(req), "name")));
        return Map.of("preset", row(get(db, preset.get("id"))));
    }

    @PostMapping("/api/sound/{id}/current")
    public Object makeCurrent(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> preset = get(db, id);
        db.run("UPDATE sound_presets SET is_current = 0 WHERE song_id = ?", preset.get("song_id"));
        db.update("sound_presets", Accounts.num(preset.get("id")), Map.of("is_current", 1));
        return Map.of("preset", row(get(db, preset.get("id"))));
    }

    @DeleteMapping("/api/sound/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> preset = get(db, id);
        List<Map<String, Object>> remaining = db.query(
                "SELECT id FROM sound_presets WHERE song_id = ? AND id != ?", preset.get("song_id"), preset.get("id"));
        if (remaining.isEmpty()) throw new ApiError("a song keeps at least one preset");
        db.run("DELETE FROM sound_presets WHERE id = ?", preset.get("id"));
        if (Accounts.num(preset.get("is_current")) != 0)
            db.update("sound_presets", Accounts.num(remaining.get(0).get("id")), Map.of("is_current", 1));
        return Map.of("deleted", preset.get("id"));
    }
}
