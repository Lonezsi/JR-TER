package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Songs: a port of jriter/modules/songs.py over the same tables. */
@RestController
public class SongsController {
    private final Library library;
    private final Accounts accounts;

    public SongsController(Library library, Accounts accounts) {
        this.library = library;
        this.accounts = accounts;
    }

    static double now() { return Accounts.now(); }

    static Map<String, Object> getSong(Library.Db db, Object id) {
        Map<String, Object> song = db.one("SELECT * FROM songs WHERE id = ?", id);
        if (song == null) throw new ApiError("no song with id " + id, 404);
        return song;
    }

    static void touch(Library.Db db, Object songId) {
        db.run("UPDATE songs SET updated_at = ? WHERE id = ?", now(), songId);
    }

    /** Attach the version count, latest take, duration and cover to each song. */
    static List<Map<String, Object>> decorate(Library.Db db, List<Map<String, Object>> songs) {
        if (songs.isEmpty()) return songs;
        List<Object> ids = new ArrayList<>();
        for (Map<String, Object> s : songs) ids.add(s.get("id"));
        String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        Map<Object, Map<String, Object>> latest = new HashMap<>();
        for (Map<String, Object> r : db.query("SELECT song_id, MAX(n) AS n, COUNT(*) AS versions FROM versions"
                + " WHERE song_id IN (" + marks + ") GROUP BY song_id", ids.toArray()))
            latest.put(r.get("song_id"), r);
        for (Map<String, Object> r : db.query("SELECT song_id, id, n, duration FROM versions WHERE song_id IN ("
                + marks + ")", ids.toArray())) {
            Map<String, Object> entry = latest.computeIfAbsent(r.get("song_id"), k -> new HashMap<>());
            if (r.get("n") != null && r.get("n").equals(entry.get("n"))) {
                entry.put("duration", r.get("duration"));
                entry.put("version_id", r.get("id"));
            }
        }
        Map<Object, Object> covers = new HashMap<>();
        if (db.tableExists("artwork"))
            for (Map<String, Object> r : db.query("SELECT song_id, MIN(position) AS p, id FROM artwork"
                    + " WHERE song_id IN (" + marks + ") GROUP BY song_id", ids.toArray()))
                covers.put(r.get("song_id"), r.get("id"));
        for (Map<String, Object> s : songs) {
            Map<String, Object> info = latest.getOrDefault(s.get("id"), Map.of());
            s.put("version_count", info.getOrDefault("versions", 0));
            s.put("latest_version", info.getOrDefault("n", 0));
            s.put("latest_version_id", info.get("version_id"));
            s.put("duration", info.getOrDefault("duration", 0));
            s.put("artwork_id", covers.get(s.get("id")));
        }
        return songs;
    }

    static Map<String, Object> one(Library.Db db, Map<String, Object> song) {
        return decorate(db, new ArrayList<>(List.of(song))).get(0);
    }

    @GetMapping("/api/songs")
    public Object list(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String term = req.getParameter("q") == null ? "" : req.getParameter("q").strip();
        String sort = req.getParameter("sort") == null ? "updated" : req.getParameter("sort");
        String by = switch (sort) {
            case "title" -> "title COLLATE NOCASE ASC";
            case "created" -> "created_at DESC";
            default -> "updated_at DESC";
        };
        List<Map<String, Object>> rows = term.isEmpty()
                ? db.query("SELECT * FROM songs ORDER BY " + by)
                : db.query("SELECT * FROM songs WHERE title LIKE ? ORDER BY " + by, "%" + term + "%");
        return Map.of("songs", decorate(db, rows));
    }

    @PostMapping("/api/songs")
    public Object create(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> data = Body.json(req);
        String title = Body.need(data, "title");
        double now = now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", title);
        Object notes = data.get("notes");
        v.put("notes", notes == null ? "" : notes);
        v.put("created_at", now);
        v.put("updated_at", now);
        long id = db.insert("songs", v);
        return Map.of("song", one(db, getSong(db, id)));
    }

    @GetMapping("/api/songs/match")
    public Object match(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String name = req.getParameter("name") == null ? "" : req.getParameter("name").strip();
        if (name.isEmpty()) throw new ApiError("name is required");
        int dot = name.lastIndexOf('.');
        String stem = dot < 0 ? name : name.substring(0, dot);
        String cleaned = stem.replace("_", " ").replace("-", " ").strip().toLowerCase(Locale.ROOT);
        record Scored(double ratio, Map<String, Object> row) {}
        List<Scored> scored = new ArrayList<>();
        for (Map<String, Object> row : db.query("SELECT id, title FROM songs")) {
            String title = ((String) row.get("title")).toLowerCase(Locale.ROOT);
            double ratio = Similar.ratio(cleaned, title);
            if (cleaned.contains(title)) ratio = Math.max(ratio, 0.9);
            scored.add(new Scored(ratio, row));
        }
        scored.sort((a, b) -> Double.compare(b.ratio, a.ratio));
        List<Map<String, Object>> best = new ArrayList<>();
        for (Scored s : scored.subList(0, Math.min(5, scored.size()))) {
            if (s.ratio < 0.45) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("song_id", s.row.get("id"));
            m.put("title", s.row.get("title"));
            m.put("score", AudioMeta.round(s.ratio, 3));
            best.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("query", stem);
        out.put("matches", best);
        out.put("suggest", !best.isEmpty() && ((Number) best.get(0).get("score")).doubleValue() >= 0.62 ? best.get(0) : null);
        return out;
    }

    @GetMapping("/api/songs/most-opened")
    public Object mostOpened(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        List<Map<String, Object>> rows = db.query(
                "SELECT id, title, opened, current_version_id, created_at, updated_at FROM songs"
                + " WHERE opened > 0 ORDER BY opened DESC, updated_at DESC LIMIT ?", Api.queryInt(req, "limit", 6));
        return Map.of("songs", decorate(db, rows));
    }

    @GetMapping("/api/songs/up-next")
    public Object upNext(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        long after = Api.queryInt(req, "after", 0);
        Set<Long> skip = new HashSet<>();
        String not = req.getParameter("not");
        if (not != null)
            for (String part : not.split(",")) {
                try {
                    skip.add(Long.parseLong(part.strip()));
                } catch (NumberFormatException ignored) {
                    // not a number, ignored like Python
                }
            }
        if (after != 0) skip.add(after);

        List<Map<String, Object>> rows = db.query("SELECT id, title, opened, current_version_id, created_at,"
                + " updated_at FROM songs WHERE current_version_id IS NOT NULL");
        List<Map<String, Object>> pool = new ArrayList<>();
        for (Map<String, Object> r : rows) if (!skip.contains(Accounts.num(r.get("id")))) pool.add(r);
        if (pool.isEmpty())
            for (Map<String, Object> r : rows) if (Accounts.num(r.get("id")) != after) pool.add(r);
        if (pool.isEmpty()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("song", null);
            out.put("why", "nothing else in this library can be played");
            return out;
        }
        Set<Long> mates = new HashSet<>();
        if (after != 0 && db.tableExists("album_songs"))
            for (Map<String, Object> r : db.query("SELECT song_id FROM album_songs WHERE album_id IN"
                    + " (SELECT album_id FROM album_songs WHERE song_id = ?)", after))
                mates.add(Accounts.num(r.get("song_id")));

        double now = now();
        long most = 1;
        for (Map<String, Object> r : pool) most = Math.max(most, Accounts.num(r.get("opened")));
        Map<String, Object> best = null;
        double bestScore = -1;
        for (Map<String, Object> row : pool) {
            double score = 1.0;
            if (mates.contains(Accounts.num(row.get("id")))) score += 3.0;
            score += 2.0 * (Accounts.num(row.get("opened")) / (double) most);
            double updated = row.get("updated_at") == null ? now : Accounts.dbl(row.get("updated_at"));
            double months = Math.max(0.0, (now - updated) / (30 * 86400));
            score += 1.5 / (1.0 + months);
            score *= 0.5 + ThreadLocalRandom.current().nextDouble();
            if (score > bestScore) { bestScore = score; best = row; }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("song", one(db, new LinkedHashMap<>(best)));
        out.put("why", mates.contains(Accounts.num(best.get("id"))) ? "from the same album" : "from your library");
        return out;
    }

    @GetMapping("/api/songs/{id}")
    public Object get(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = getSong(db, id);
        // Counted on the read, as in Python: this is the only place that knows it was opened.
        db.run("UPDATE songs SET opened = opened + 1 WHERE id = ?", song.get("id"));
        return Map.of("song", one(db, song));
    }

    @GetMapping("/api/songs/{id}/titles")
    public Object titles(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = getSong(db, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("current", song.get("title"));
        out.put("previous", db.query("SELECT title, changed_at FROM song_titles WHERE song_id = ? ORDER BY id DESC",
                song.get("id")));
        return out;
    }

    @PatchMapping("/api/songs/{id}")
    public Object update(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = getSong(db, id);
        Map<String, Object> data = Body.json(req);
        Map<String, Object> patch = new LinkedHashMap<>();
        if (data.containsKey("title")) {
            String title = Body.need(data, "title");
            patch.put("title", title);
            if (!title.equals(song.get("title"))) {
                Map<String, Object> old = new LinkedHashMap<>();
                old.put("song_id", song.get("id"));
                old.put("title", song.get("title"));
                old.put("changed_at", now());
                db.insert("song_titles", old);
            }
        }
        if (data.containsKey("notes")) {
            Object n = data.get("notes");
            patch.put("notes", n == null || Boolean.FALSE.equals(n) || "".equals(n) ? "" : n);
        }
        if (data.containsKey("current_version_id")) patch.put("current_version_id", data.get("current_version_id"));
        patch.put("updated_at", now());
        db.update("songs", Accounts.num(song.get("id")), patch);
        return Map.of("song", one(db, getSong(db, song.get("id"))));
    }

    @DeleteMapping("/api/songs/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = getSong(db, id);
        long songId = Accounts.num(song.get("id"));
        // Its shares first: the next song may be given this id (see Accounts.revokeSharesFor).
        int taken = accounts.revokeSharesFor(acct, songId);
        // Blobs are left alone: another song may point at the same bytes.
        db.run("DELETE FROM songs WHERE id = ?", songId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("deleted", songId);
        out.put("shares_taken_back", taken);
        return out;
    }
}
