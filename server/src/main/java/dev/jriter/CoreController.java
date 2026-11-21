package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What is switched on and the settings the whole app shares: a port of the routes of
 * jriter/modules/core.py (/api/health lives in WebController). The video.forget() call Python
 * makes when ffmpeg_path changes has no counterpart: Spring has no video module yet.
 */
@RestController
public class CoreController {
    static final List<String> EFFECT_KINDS = List.of("eq", "comp", "drive", "delay", "reverb", "width", "gain", "limiter");
    /** config.MODULES, sorted, minus youtube (task 9e3 adds it). */
    static final List<String> MODULES = List.of("albums", "appearance", "arrange", "artwork", "auth", "core",
            "devlog", "export", "grave", "lyrics", "orarend", "playlists", "renders", "search", "sharing", "songs",
            "sound", "sync", "updater", "versions", "vocals");
    private static final long STARTED = System.currentTimeMillis();

    private final Config config;
    private final Settings settings;
    private final Problems problems;
    private final Library library;
    private final Accounts accounts;
    private final Auth auth;
    private final DevlogController devlog;
    private final AppearanceController appearance;
    private final OrarendController orarend;
    private final Updater updater;

    public CoreController(Config config, Settings settings, Problems problems, Library library, Accounts accounts,
                          Auth auth, DevlogController devlog, AppearanceController appearance,
                          OrarendController orarend, Updater updater) {
        this.config = config;
        this.settings = settings;
        this.problems = problems;
        this.library = library;
        this.accounts = accounts;
        this.auth = auth;
        this.devlog = devlog;
        this.appearance = appearance;
        this.orarend = orarend;
        this.updater = updater;
    }

    // -- settings ---------------------------------------------------------------------

    @GetMapping("/api/settings")
    public Object getSettings(HttpServletRequest req) { return settings.get(Api.acct(req)); }

    @GetMapping("/api/settings/defaults")
    public Object getDefaults() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("defaults", Settings.defaults());
        return out;
    }

    private static boolean number(Object v) { return v instanceof Number; }

    private static boolean whole(Object v) {
        return v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof java.math.BigInteger;
    }

    @PutMapping("/api/settings")
    public Object putSettings(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> patch = new LinkedHashMap<>(Body.json(req));
        java.util.TreeSet<String> unknown = new java.util.TreeSet<>(patch.keySet());
        unknown.removeAll(Settings.defaults().keySet());
        if (!unknown.isEmpty()) throw new ApiError("not a setting: " + String.join(", ", unknown));
        if (patch.containsKey("effect_presets")) patch.put("effect_presets", effectPresets(patch.get("effect_presets")));
        if (patch.containsKey("pinned")) {
            Object pinned = patch.get("pinned");
            boolean ok = pinned instanceof List<?> l && l.size() <= 100;
            if (ok)
                for (Object p : (List<?>) pinned)
                    if (!(p instanceof Map<?, ?> m) || !List.of("song", "album", "playlist", "render").contains(m.get("kind"))
                            || !whole(m.get("id"))) { ok = false; break; }
            if (!ok) throw new ApiError("pinned takes up to 100 {kind, id} entries");
            List<Object> clean = new ArrayList<>();
            for (Object p : (List<?>) pinned) {
                Map<?, ?> m = (Map<?, ?>) p;
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("kind", m.get("kind"));
                e.put("id", m.get("id"));
                clean.add(e);
            }
            patch.put("pinned", clean);
        }
        if (patch.containsKey("lyrics_view")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> base = (Map<String, Object>) Settings.defaults().get("lyrics_view");
            Object view = patch.get("lyrics_view");
            boolean ok = view instanceof Map<?, ?> m && base.keySet().containsAll(m.keySet());
            if (ok) for (Object v : ((Map<?, ?>) view).values()) if (!(v instanceof Boolean)) ok = false;
            if (!ok)
                throw new ApiError("lyrics_view takes " + String.join(", ", Settings.sorted(base.keySet()))
                        + ", each true or false");
            Map<String, Object> merged = new LinkedHashMap<>(base);
            for (Map.Entry<?, ?> e : ((Map<?, ?>) view).entrySet()) merged.put((String) e.getKey(), e.getValue());
            patch.put("lyrics_view", merged);
        }
        return settings.save(acct, patch);
    }

    private static Object effectPresets(Object value) {
        if (!(value instanceof Map<?, ?> all)) throw new ApiError("effect presets must be an object");
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> en : all.entrySet()) {
            String kind = String.valueOf(en.getKey());
            if (!EFFECT_KINDS.contains(kind) || !(en.getValue() instanceof List<?> presets) || presets.size() > 50)
                throw new ApiError("effect presets: bad entry for '" + kind + "'");
            List<Object> clean = new ArrayList<>();
            for (Object p : presets) {
                Object name = p instanceof Map<?, ?> m ? m.get("name") : null;
                Object values = p instanceof Map<?, ?> m ? m.get("values") : null;
                if (!(name instanceof String n) || n.isBlank() || n.length() > 80 || !(values instanceof Map<?, ?> vals))
                    throw new ApiError("effect presets: each needs a name and values");
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", n.strip());
                if (kind.equals("eq")) {
                    Object bandsRaw = vals.containsKey("bands") ? vals.get("bands") : List.of();
                    if (!(bandsRaw instanceof List<?> bands) || bands.size() > 24)
                        throw new ApiError("effect presets: an equaliser holds up to 24 bands");
                    List<Object> kept = new ArrayList<>();
                    for (Object b : bands) {
                        if (!(b instanceof Map<?, ?> bm) || !(bm.get("type") instanceof String t) || t.length() > 12)
                            throw new ApiError("effect presets: bad band");
                        Map<String, Object> band = new LinkedHashMap<>();
                        band.put("type", t);
                        Object on = bm.containsKey("on") ? bm.get("on") : true;
                        band.put("on", !(on == null || Boolean.FALSE.equals(on) || (on instanceof Number x && x.doubleValue() == 0)
                                || "".equals(on)));
                        for (String k : new String[] {"freq", "gain", "q"}) {
                            if (!number(bm.get(k))) throw new ApiError("effect presets: bad band");
                            band.put(k, bm.get(k));
                        }
                        kept.add(band);
                    }
                    Map<String, Object> v = new LinkedHashMap<>();
                    v.put("bands", kept);
                    item.put("values", v);
                } else {
                    if (vals.size() > 16) throw new ApiError("effect presets: values must be numbers");
                    for (Map.Entry<?, ?> ve : vals.entrySet())
                        if (!(ve.getKey() instanceof String) || !number(ve.getValue()))
                            throw new ApiError("effect presets: values must be numbers");
                    item.put("values", new LinkedHashMap<>(vals));
                }
                clean.add(item);
            }
            out.put(kind, clean);
        }
        return out;
    }

    // -- the error list -----------------------------------------------------------------

    @GetMapping("/api/health/errors")
    public Object errors(HttpServletRequest req) {
        Api.acct(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("errors", problems.recent(Api.queryInt(req, "limit", 50)));
        out.putAll(problems.count());
        return out;
    }

    @DeleteMapping("/api/health/errors")
    public Object forgetErrors(HttpServletRequest req) {
        Api.acct(req);
        problems.clear();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("cleared", true);
        return out;
    }

    // -- /api/state -----------------------------------------------------------------------

    private Map<String, Object> storage(long acct) {
        long total = 0, count = 0;
        Path dir = config.home(acct).resolve("blobs");
        if (Files.isDirectory(dir)) {
            try (Stream<Path> s = Files.walk(dir)) {
                for (Path p : (Iterable<Path>) s.filter(Files::isRegularFile)::iterator) {
                    if (p.getFileName().toString().endsWith(".part")) continue;
                    try { total += Files.size(p); count++; } catch (IOException ignored) { /* gone meanwhile */ }
                }
            } catch (IOException ignored) { /* an unreadable folder counts as empty */ }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("files", count);
        m.put("bytes", total);
        return m;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static Object n(Map<String, Object> row, String key) {
        return row == null ? 0 : row.get(key);
    }

    private Map<String, Object> summaries(long acct, long actor) {
        Library.Db db = library.of(acct);
        Map<String, Supplier<Object>> s = new LinkedHashMap<>();
        s.put("albums", () -> m("count", n(db.one("SELECT COUNT(*) AS n FROM albums"), "n")));
        s.put("appearance", () -> appearance.state(acct));
        s.put("arrange", () -> m("count", n(db.one("SELECT COUNT(*) AS n FROM arrangements"), "n"),
                "on", n(db.one("SELECT COUNT(*) AS n FROM arrangements WHERE enabled = 1"), "n")));
        s.put("artwork", () -> m("count", n(db.one("SELECT COUNT(*) AS n FROM artwork"), "n")));
        s.put("auth", () -> m("protected", accounts.count() > 0 || auth.hasPassword(),
                "accounts", accounts.count(), "is_owner", actor == Accounts.OWNER,
                "who", accounts.pub(accounts.byId(actor))));
        s.put("export", () -> m("tables", ExportController.TAKEN.size()));
        s.put("grave", () -> m("count", db.tableExists("grave") ? n(db.one("SELECT COUNT(*) AS n FROM grave"), "n") : 0,
                "keep_days", Grave.KEEP_DAYS));
        s.put("lyrics", () -> m("alternatives", n(db.one("SELECT COUNT(*) AS n FROM lyric_sheets"), "n")));
        s.put("orarend", orarend::summary);
        s.put("playlists", () -> m("count", n(db.one("SELECT COUNT(*) AS n FROM playlists"), "n"),
                "yours", n(db.one("SELECT COUNT(*) AS n FROM playlists WHERE album_id IS NULL"), "n")));
        s.put("renders", () -> m("waiting", n(db.one("SELECT COUNT(*) AS n FROM renders WHERE used_at = 0"), "n"),
                "count", n(db.one("SELECT COUNT(*) AS n FROM renders"), "n")));
        // albums, artwork, lyrics, playlists, renders, songs and versions define SEARCH in Python
        s.put("search", () -> m("categories", 7));
        s.put("sharing", () -> m("shared_with_me", accounts.sharesTo(actor).size()));
        s.put("songs", () -> m("count", n(db.one("SELECT COUNT(*) AS n FROM songs"), "n")));
        s.put("sound", () -> m("presets", n(db.one("SELECT COUNT(*) AS n FROM sound_presets"), "n")));
        s.put("sync", () -> actor != Accounts.OWNER ? m()
                : m("folders", n(library.of(Accounts.OWNER).one("SELECT COUNT(*) AS n FROM sync_folders WHERE enabled = 1"), "n")));
        s.put("updater", () -> {
            String commit = updater.commit();
            return commit == null ? m("git", false) : m("git", true, "commit", commit);
        });
        s.put("versions", () -> {
            Map<String, Object> row = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM versions");
            Map<String, Object> distinct = db.one("SELECT COUNT(DISTINCT digest) AS n FROM versions");
            return m("count", row.get("n"), "bytes", row.get("bytes"), "distinct_files", n(distinct, "n"));
        });
        s.put("vocals", () -> m());
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Supplier<Object>> e : s.entrySet()) {
            try {
                out.put(e.getKey(), e.getValue().get());
            } catch (RuntimeException ex) {
                out.put(e.getKey(), m("error", "summary failed"));
            }
        }
        return out;
    }

    @GetMapping("/api/state")
    public Object state(HttpServletRequest req) {
        long acct = Api.acct(req);
        long actor = Api.actor(req);
        Map<String, Object> cfg = settings.get(acct);
        double now = System.currentTimeMillis();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", cfg.get("library_name"));
        out.put("version", devlog.version());
        out.put("modules", MODULES);
        out.put("failed", m());
        out.put("summary", summaries(acct, actor));
        out.put("settings", cfg);
        out.put("storage", storage(acct));
        out.put("audio", Api.AUDIO_EXT);
        out.put("started", STARTED / 1000.0);
        out.put("uptime", Math.round((now - STARTED) / 100.0) / 10.0);
        return out;
    }
}
