package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Finding anything: /api/search, a port of jriter/modules/search.py plus the SEARCH function of
 * each module it asks (songs, albums, playlists, lyrics, versions, renders, artwork). The groups
 * come in a fixed order (the number each declares), never by how good their best hit is.
 */
@RestController
public class SearchController {
    static final int SHOW = 8, MOST = 50;
    private final Library library;

    public SearchController(Library library) { this.library = library; }

    // -- the seven searches -----------------------------------------------------------

    private static Map<String, Object> group(String label, String kind, int order, int total, List<Map<String, Object>> hits) {
        Map<String, Object> g = new LinkedHashMap<>();
        g.put("label", label);
        g.put("kind", kind);
        g.put("order", order);
        g.put("total", total);
        g.put("hits", hits);
        return g;
    }

    private static double d(Object o) { return o == null ? 0 : Accounts.dbl(o); }

    private static int score(Map<String, Object> r) { return (int) Accounts.num(r.get("score")); }

    private static List<Map<String, Object>> head(List<Map<String, Object>> rows, int limit) {
        return new ArrayList<>(rows.subList(0, Math.min(limit, rows.size())));
    }

    private static String stem(String name) {
        int dot = name.lastIndexOf('.');
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        return (dot < 0 || dot < slash || dot == slash + 1) ? name : name.substring(0, dot);
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private static String orElse(Object o, String fallback) { return str(o).isEmpty() ? fallback : str(o); }

    static Map<String, Object> songs(Library.Db db, String term, int limit) {
        String like = Finding.pattern(term);
        List<Map<String, Object>> rows = db.query(
                "SELECT s.*, (SELECT t.title FROM song_titles t WHERE t.song_id = s.id "
                + "   AND fold(t.title) LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT 1) AS was "
                + "FROM songs s WHERE fold(s.title) LIKE ? ESCAPE '\\' "
                + "   OR EXISTS (SELECT 1 FROM song_titles t WHERE t.song_id = s.id "
                + "              AND fold(t.title) LIKE ? ESCAPE '\\')", like, like, like);
        for (Map<String, Object> r : rows) r.put("score", Finding.rank(term, str(r.get("title"))));
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparingDouble(r -> -d(r.get("updated_at"))));
        List<Map<String, Object>> hits = SongsController.decorate(db, head(rows, limit));
        for (Map<String, Object> r : hits) {
            r.put("href", "#/song/" + r.get("id"));
            if (score(r) == 0 && r.get("was") != null && !str(r.get("was")).isEmpty()) r.put("sub", "was called " + r.get("was"));
        }
        return group("Songs", "song", 10, rows.size(), hits);
    }

    static Map<String, Object> albums(Library.Db db, String term, int limit) {
        String like = Finding.pattern(term);
        List<Map<String, Object>> rows = db.query("SELECT * FROM albums WHERE fold(title) LIKE ? ESCAPE '\\' OR fold(notes) LIKE ? ESCAPE '\\'", like, like);
        for (Map<String, Object> r : rows) r.put("score", Finding.rank(term, str(r.get("title"))));
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r))
                .thenComparingDouble(r -> -d(r.get("year"))).thenComparing(r -> Finding.fold(str(r.get("title")))));
        List<Map<String, Object>> hits = head(rows, limit);
        for (Map<String, Object> r : hits) {
            AlbumsController.counted(db, r);
            r.put("href", "#/album/" + r.get("id"));
        }
        return group("Albums", "album", 20, rows.size(), hits);
    }

    static Map<String, Object> playlists(Library.Db db, String term, int limit) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM playlists WHERE fold(title) LIKE ? ESCAPE '\\' AND album_id IS NULL", Finding.pattern(term));
        for (Map<String, Object> r : rows) r.put("score", Finding.rank(term, str(r.get("title"))));
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparing(r -> Finding.fold(str(r.get("title")))));
        List<Map<String, Object>> hits = head(rows, limit);
        for (Map<String, Object> r : hits) {
            Map<String, Object> n = db.one("SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?", r.get("id"));
            r.put("count", n == null ? 0 : n.get("n"));
            r.put("href", "#/playlist/" + r.get("id"));
        }
        return group("Playlists", "playlist", 30, rows.size(), hits);
    }

    static Map<String, Object> lyrics(Library.Db db, String term, int limit) {
        if (term.length() < Finding.MIN_TEXT) return group("Words", "lyric", 40, 0, new ArrayList<>());
        String like = Finding.pattern(term);
        List<Map<String, Object>> rows = db.query(
                "SELECT sh.id, sh.song_id, sh.name, sh.is_current, s.title AS song_title, s.updated_at, r.text "
                + "FROM lyric_sheets sh JOIN songs s ON s.id = sh.song_id "
                + "JOIN lyric_revisions r ON r.id = (SELECT id FROM lyric_revisions WHERE sheet_id = sh.id ORDER BY id DESC LIMIT 1) "
                + "WHERE fold(r.text) LIKE ? ESCAPE '\\' OR fold(sh.name) LIKE ? ESCAPE '\\'", like, like);
        for (Map<String, Object> r : rows) {
            String text = str(r.remove("text"));
            r.put("line", Finding.lineAround(text, term));
            r.put("score", Finding.rank(term, str(r.get("name"))));
        }
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparingDouble(r -> -d(r.get("updated_at"))));
        List<Map<String, Object>> hits = head(rows, limit);
        for (Map<String, Object> r : hits) {
            r.put("title", r.get("song_title"));
            r.put("href", "#/song/" + r.get("song_id"));
        }
        return group("Words", "lyric", 40, rows.size(), hits);
    }

    static Map<String, Object> versions(Library.Db db, String term, int limit) {
        String like = Finding.pattern(term);
        List<Map<String, Object>> rows = db.query(
                "SELECT v.id, v.song_id, v.n, v.label, v.filename, v.duration, v.created_at, s.title AS song_title "
                + "FROM versions v JOIN songs s ON s.id = v.song_id "
                + "WHERE fold(v.label) LIKE ? ESCAPE '\\' OR fold(v.filename) LIKE ? ESCAPE '\\' "
                + "   OR fold(v.source_path) LIKE ? ESCAPE '\\'", like, like, like);
        for (Map<String, Object> r : rows) {
            r.put("score", Finding.rank(term, orElse(r.get("label"), str(r.get("filename")))));
            r.put("title", orElse(r.get("label"), orElse(stem(str(r.get("filename"))), "v" + r.get("n"))));
            r.put("sub", "v" + r.get("n") + " of " + r.get("song_title"));
            r.put("href", "#/song/" + r.get("song_id"));
        }
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparingDouble(r -> -d(r.get("created_at"))));
        return group("Takes", "version", 50, rows.size(), head(rows, limit));
    }

    static Map<String, Object> renders(Library.Db db, String term, int limit) {
        String like = Finding.pattern(term);
        List<Map<String, Object>> rows = db.query(
                "SELECT r.id, r.filename, r.source_path, r.duration, r.size, r.used_at, r.trouble, r.song_id, "
                + "       s.title AS song_title, r.created_at "
                + "FROM renders r LEFT JOIN songs s ON s.id = r.song_id "
                + "WHERE fold(r.filename) LIKE ? ESCAPE '\\' OR fold(r.source_path) LIKE ? ESCAPE '\\'", like, like);
        for (Map<String, Object> r : rows) {
            String name = orElse(stem(str(r.get("filename"))), "render");
            r.put("name", name);
            r.put("title", name);
            r.put("waiting", d(r.get("used_at")) == 0);
            r.put("score", Finding.rank(term, name));
            r.put("sub", !str(r.get("song_title")).isEmpty() ? "went to " + r.get("song_title") : "waiting for a song");
            r.put("href", "#/renders");
        }
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparingDouble(r -> -d(r.get("created_at"))));
        return group("Renders", "render", 60, rows.size(), head(rows, limit));
    }

    static Map<String, Object> artwork(Library.Db db, String term, int limit) {
        List<Map<String, Object>> rows = db.query(
                "SELECT a.id, a.song_id, a.caption, a.created_at, s.title AS song_title "
                + "FROM artwork a JOIN songs s ON s.id = a.song_id WHERE fold(a.caption) LIKE ? ESCAPE '\\'", Finding.pattern(term));
        for (Map<String, Object> r : rows) {
            r.put("score", Finding.rank(term, str(r.get("caption"))));
            r.put("title", r.get("caption"));
            r.put("sub", "on " + r.get("song_title"));
            r.put("href", "#/song/" + r.get("song_id"));
        }
        rows.sort(Comparator.<Map<String, Object>>comparingInt(r -> -score(r)).thenComparingDouble(r -> -d(r.get("created_at"))));
        return group("Artwork", "artwork", 70, rows.size(), head(rows, limit));
    }

    /** Ask every search, as registry.searches does: one that fails gives an error group, not an error. */
    private static List<Map<String, Object>> ask(Library.Db db, String term, int limit) {
        String[] names = {"songs", "albums", "playlists", "lyrics", "versions", "renders", "artwork"};
        List<Function<Object[], Map<String, Object>>> fns = List.of(
                a -> songs(db, term, limit), a -> albums(db, term, limit), a -> playlists(db, term, limit),
                a -> lyrics(db, term, limit), a -> versions(db, term, limit), a -> renders(db, term, limit),
                a -> artwork(db, term, limit));
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            Map<String, Object> g;
            try {
                g = fns.get(i).apply(null);
            } catch (RuntimeException e) {
                g = group(names[i].substring(0, 1).toUpperCase() + names[i].substring(1), names[i], 100, 0, new ArrayList<>());
                g.put("error", "this could not be searched");
            }
            g.putIfAbsent("module", names[i]);
            out.add(g);
        }
        return out;
    }

    /** What the album: and has: filters need about each song. */
    private static Map<Object, Map<String, Object>> songFacts(Library.Db db, List<Object> ids) {
        Map<Object, Map<String, Object>> facts = new HashMap<>();
        for (Object id : ids) {
            Map<String, Object> f = new HashMap<>();
            f.put("albums", new ArrayList<String>());
            f.put("has_words", false);
            f.put("has_art", false);
            facts.put(Accounts.num(id), f);
        }
        if (ids.isEmpty()) return facts;
        String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
        for (Map<String, Object> r : db.query("SELECT s.song_id, a.title FROM album_songs s JOIN albums a ON a.id = s.album_id WHERE s.song_id IN (" + marks + ")", ids.toArray())) {
            @SuppressWarnings("unchecked")
            List<String> l = (List<String>) facts.get(Accounts.num(r.get("song_id"))).get("albums");
            l.add(str(r.get("title")));
        }
        for (Map<String, Object> r : db.query("SELECT DISTINCT song_id FROM lyric_sheets WHERE song_id IN (" + marks + ")", ids.toArray()))
            facts.get(Accounts.num(r.get("song_id"))).put("has_words", true);
        for (Map<String, Object> r : db.query("SELECT DISTINCT song_id FROM artwork WHERE song_id IN (" + marks + ")", ids.toArray()))
            facts.get(Accounts.num(r.get("song_id"))).put("has_art", true);
        return facts;
    }

    @SuppressWarnings("unchecked")
    @GetMapping("/api/search")
    public Object search(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String raw = str(req.getParameter("q")).strip();
        raw = raw.substring(0, Math.min(raw.length(), Finding.MAX_TERM * 3));
        int limit = Math.max(1, Math.min(MOST, Api.queryInt(req, "limit", SHOW)));
        Query q = Query.parse(raw);
        String text = q.text();
        String term = text.substring(0, Math.min(text.length(), Finding.MAX_TERM));
        Map<String, Object> out = new LinkedHashMap<>();
        if (term.isEmpty() && !q.narrowed()) {
            out.put("query", "");
            out.put("groups", new ArrayList<>());
            out.put("looked_in", new ArrayList<>());
            return out;
        }
        List<Map<String, Object>> found = ask(db, term, q.narrowed() ? MOST : limit);
        if (q.narrowed()) {
            for (Map<String, Object> g : found) {
                Object k = g.getOrDefault("kind", g.get("module"));
                String kind = String.valueOf(k);
                List<Map<String, Object>> hits = (List<Map<String, Object>>) g.get("hits");
                Map<Object, Map<String, Object>> facts = new HashMap<>();
                if (Query.kindOf(kind).equals("song") && q.songFactsNeeded()) {
                    List<Object> ids = new ArrayList<>();
                    for (Map<String, Object> h : hits) if (h.containsKey("id")) ids.add(h.get("id"));
                    facts = songFacts(db, ids);
                }
                List<Map<String, Object>> kept = new ArrayList<>();
                for (Map<String, Object> h : hits) {
                    Object id = h.get("id");
                    if (q.allows(kind, h, id == null ? null : facts.get(Accounts.num(id)))) kept.add(h);
                }
                if (hits.size() < MOST) g.put("total", kept.size());
                g.put("hits", kept.size() > limit ? new ArrayList<>(kept.subList(0, limit)) : kept);
            }
        }
        found.sort(Comparator.<Map<String, Object>>comparingInt(g -> (int) Accounts.num(g.get("order"))).thenComparing(g -> str(g.get("label"))));
        List<Object> groups = new ArrayList<>(), looked = new ArrayList<>();
        for (Map<String, Object> g : found) {
            if (!((List<?>) g.get("hits")).isEmpty() || g.containsKey("error")) groups.add(g);
            looked.add(g.getOrDefault("label", g.get("module")));
        }
        out.put("query", raw);
        out.put("groups", groups);
        out.put("looked_in", looked);
        return out;
    }
}
