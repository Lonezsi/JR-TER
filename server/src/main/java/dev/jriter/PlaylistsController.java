package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/** Playlists, which hold songs and loose renders side by side: a port of jriter/modules/playlists.py. */
@RestController
public class PlaylistsController {
    static final int MAX_ITEMS = 2000;

    private final Library library;
    private final Grave grave;

    public PlaylistsController(Library library, Grave grave) { this.library = library; this.grave = grave; }

    static Map<String, Object> getPlaylist(Library.Db db, Object id) {
        Map<String, Object> row = db.one("SELECT * FROM playlists WHERE id = ?", id);
        if (row == null) throw new ApiError("no playlist with id " + id, 404);
        return row;
    }

    private static List<Map<String, Object>> items(Library.Db db, Object playlistId) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position, id", playlistId);
        List<Map<String, Object>> out = new ArrayList<>();
        if (rows.isEmpty()) return out;
        List<Object> songIds = new ArrayList<>(), renderIds = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            if (r.get("song_id") != null) songIds.add(r.get("song_id"));
            if (r.get("render_id") != null) renderIds.add(r.get("render_id"));
        }
        Map<Object, Map<String, Object>> songs = new HashMap<>();
        if (!songIds.isEmpty()) {
            String marks = String.join(",", Collections.nCopies(songIds.size(), "?"));
            List<Map<String, Object>> found = db.query("SELECT s.*, (SELECT COUNT(*) FROM versions v WHERE v.song_id = s.id)"
                    + " AS version_count FROM songs s WHERE s.id IN (" + marks + ")", songIds.toArray());
            for (Map<String, Object> s : SongsController.decorate(db, found)) songs.put(s.get("id"), s);
        }
        Map<Object, Map<String, Object>> renders = new HashMap<>();
        if (!renderIds.isEmpty() && db.tableExists("renders")) {
            String marks = String.join(",", Collections.nCopies(renderIds.size(), "?"));
            for (Map<String, Object> r : db.query("SELECT * FROM renders WHERE id IN (" + marks + ")", renderIds.toArray()))
                renders.put(r.get("id"), r);
        }
        for (Map<String, Object> row : rows) {
            Map<String, Object> o = new LinkedHashMap<>();
            if (row.get("song_id") != null) {
                Map<String, Object> song = songs.get(row.get("song_id"));
                if (song == null) continue;
                o.put("item_id", row.get("id"));
                o.put("position", row.get("position"));
                o.put("kind", "song");
                o.put("song", song);
                o.put("title", song.get("title"));
            } else if (row.get("render_id") != null) {
                Map<String, Object> render = renders.get(row.get("render_id"));
                if (render == null) continue;
                String filename = String.valueOf(render.get("filename"));
                String ext = Api.extOf(filename);
                String name = ext.isEmpty() ? filename : filename.substring(0, filename.length() - ext.length());
                if (name.isEmpty()) name = "render";
                Map<String, Object> carried = new LinkedHashMap<>(render);
                carried.put("name", name);
                o.put("item_id", row.get("id"));
                o.put("position", row.get("position"));
                o.put("kind", "render");
                o.put("render", carried);
                o.put("title", name);
            } else continue;
            out.add(o);
        }
        return out;
    }

    private static Map<String, Object> read(Library.Db db, Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        List<Map<String, Object>> items = items(db, row.get("id"));
        out.put("items", items);
        out.put("count", items.size());
        return out;
    }

    private static long countOf(Library.Db db, Object playlistId) {
        return Accounts.num(db.one("SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?", playlistId).get("n"));
    }

    private static List<Map<String, Object>> behind(Library.Db db, Object playlistId) {
        List<Map<String, Object>> rows = db.query("SELECT s.id, s.title, (SELECT a.id FROM artwork a WHERE a.song_id = s.id"
                + " ORDER BY a.position LIMIT 1) AS artwork_id FROM playlist_items i JOIN songs s"
                + " ON s.id = i.song_id WHERE i.playlist_id = ? ORDER BY i.position, i.id LIMIT 3", playlistId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("title", r.get("title"));
            m.put("artwork_id", r.get("artwork_id"));
            out.add(m);
        }
        return out;
    }

    @GetMapping("/api/playlists")
    public Object list(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        for (Map<String, Object> album : db.query("SELECT id, title FROM albums"))
            forAlbum(db, album.get("id"), null);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : db.query("SELECT * FROM playlists ORDER BY album_id IS NULL DESC, title")) {
            Map<String, Object> item = new LinkedHashMap<>(row);
            item.put("count", countOf(db, row.get("id")));
            item.put("behind", behind(db, row.get("id")));
            out.add(item);
        }
        return Map.of("playlists", out);
    }

    @GetMapping("/api/songs/{id}/playlists")
    public Object forSong(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : db.query("SELECT p.*, MIN(i.position) AS at, COUNT(i.id) AS times"
                + " FROM playlists p JOIN playlist_items i ON i.playlist_id = p.id"
                + " WHERE i.song_id = ? GROUP BY p.id ORDER BY p.album_id IS NULL DESC, p.title", song.get("id"))) {
            Map<String, Object> item = new LinkedHashMap<>(row);
            item.put("count", countOf(db, row.get("id")));
            item.put("index", Accounts.num(db.one("SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ? AND position < ?",
                    row.get("id"), row.get("at")).get("n")));
            out.add(item);
        }
        return Map.of("playlists", out);
    }

    @PostMapping("/api/playlists")
    public Object create(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String title = Body.need(Body.json(req), "title");
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", title.length() > 120 ? title.substring(0, 120) : title);
        v.put("album_id", null);
        v.put("created_at", now);
        v.put("updated_at", now);
        long made = db.insert("playlists", v);
        return Map.of("playlist", read(db, getPlaylist(db, made)));
    }

    @GetMapping("/api/playlists/{id}")
    public Object get(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        return Map.of("playlist", read(db, getPlaylist(db, id)));
    }

    private static void bump(Library.Db db, Object playlistId) {
        db.run("UPDATE playlists SET updated_at = ? WHERE id = ?", Accounts.now(), playlistId);
    }

    @PatchMapping("/api/playlists/{id}")
    public Object rename(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> playlist = getPlaylist(db, id);
        String title = Body.need(Body.json(req), "title");
        db.run("UPDATE playlists SET title = ?, updated_at = ? WHERE id = ?",
                title.length() > 120 ? title.substring(0, 120) : title, Accounts.now(), playlist.get("id"));
        return Map.of("playlist", read(db, getPlaylist(db, playlist.get("id"))));
    }

    @DeleteMapping("/api/playlists/{id}")
    public Object remove(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> playlist = getPlaylist(db, id);
        if (playlist.get("album_id") != null && Accounts.num(playlist.get("album_id")) != 0)
            throw new ApiError("that playlist belongs to an album. Delete the album instead.");
        grave.buryPlaylist(db, acct, playlist.get("id"));
        db.run("DELETE FROM playlists WHERE id = ?", playlist.get("id"));
        return Map.of("deleted", playlist.get("id"));
    }

    private static double nextPosition(Library.Db db, Object playlistId) {
        Map<String, Object> row = db.one("SELECT MAX(position) AS at FROM playlist_items WHERE playlist_id = ?", playlistId);
        return (row == null || row.get("at") == null ? 0 : Accounts.dbl(row.get("at"))) + 1;
    }

    @PostMapping("/api/playlists/{id}/items")
    public Object add(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> playlist = getPlaylist(db, id);
        Map<String, Object> data = Body.json(req);
        Object songId = data.get("song_id"), renderId = data.get("render_id");
        if (ArrangeController.truthy(songId) == ArrangeController.truthy(renderId))
            throw new ApiError("say either a song_id or a render_id, not both and not neither");
        if (countOf(db, playlist.get("id")) >= MAX_ITEMS) throw new ApiError("that playlist is full at " + MAX_ITEMS);
        if (ArrangeController.truthy(songId)) SongsController.getSong(db, songId);
        else if (db.one("SELECT id FROM renders WHERE id = ?", renderId) == null)
            throw new ApiError("no render with id " + renderId, 404);
        if (!ArrangeController.truthy(songId)) songId = null;
        if (!ArrangeController.truthy(renderId)) renderId = null;
        Map<String, Object> last = db.one("SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position DESC, id DESC LIMIT 1", playlist.get("id"));
        if (last != null && same(last.get("song_id"), songId) && same(last.get("render_id"), renderId)) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("playlist", read(db, getPlaylist(db, playlist.get("id"))));
            out.put("added", false);
            out.put("message", "That is already the last thing in it.");
            return out;
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("playlist_id", playlist.get("id"));
        v.put("position", nextPosition(db, playlist.get("id")));
        v.put("song_id", songId);
        v.put("render_id", renderId);
        v.put("added_at", Accounts.now());
        db.insert("playlist_items", v);
        bump(db, playlist.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("playlist", read(db, getPlaylist(db, playlist.get("id"))));
        out.put("added", true);
        return out;
    }

    /** Python's == between a column value and a request value: numbers by value, anything else by equality. */
    private static boolean same(Object a, Object b) {
        if (a instanceof Number x && b instanceof Number y) return x.doubleValue() == y.doubleValue();
        return Objects.equals(a, b);
    }

    @DeleteMapping("/api/playlists/{id}/items/{itemId}")
    public Object dropItem(HttpServletRequest req, @PathVariable String id, @PathVariable String itemId) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> playlist = getPlaylist(db, id);
        db.run("DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?", itemId, playlist.get("id"));
        bump(db, playlist.get("id"));
        return Map.of("playlist", read(db, getPlaylist(db, playlist.get("id"))));
    }

    @PutMapping("/api/playlists/{id}/order")
    public Object reorder(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> playlist = getPlaylist(db, id);
        Object order = Body.json(req).get("items");
        if (!(order instanceof List<?> list)) throw new ApiError("items must be a list of item ids");
        Set<Long> known = new HashSet<>();
        for (Map<String, Object> r : db.query("SELECT id FROM playlist_items WHERE playlist_id = ?", playlist.get("id")))
            known.add(Accounts.num(r.get("id")));
        long at = 1;
        for (Object o : list) {
            long itemId;
            try {
                if (o instanceof Number n) itemId = n.longValue();
                else if (o instanceof Boolean b) itemId = b ? 1 : 0;
                else if (o instanceof String s) itemId = Long.parseLong(s.strip());
                else throw new NumberFormatException();
            } catch (NumberFormatException e) {
                throw new ApiError("an item id must be a whole number");
            }
            if (!known.contains(itemId)) continue;
            db.run("UPDATE playlist_items SET position = ? WHERE id = ?", (double) at, itemId);
            at++;
        }
        bump(db, playlist.get("id"));
        return Map.of("playlist", read(db, getPlaylist(db, playlist.get("id"))));
    }

    // ── albums ──

    /** The playlist that belongs to an album, made on demand (seeded with the album's songs). */
    static Map<String, Object> forAlbum(Library.Db db, Object albumId, String title) {
        Map<String, Object> row = db.one("SELECT * FROM playlists WHERE album_id = ?", albumId);
        if (row != null) return row;
        Map<String, Object> album = db.one("SELECT * FROM albums WHERE id = ?", albumId);
        if (album == null) return null;
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", title != null && !title.isEmpty() ? title : album.get("title"));
        v.put("album_id", albumId);
        v.put("created_at", now);
        v.put("updated_at", now);
        long made = db.insert("playlists", v);
        for (Map<String, Object> link : db.query("SELECT song_id FROM album_songs WHERE album_id = ? ORDER BY position, song_id", albumId))
            addSong(db, made, link.get("song_id"), now);
        return db.one("SELECT * FROM playlists WHERE id = ?", made);
    }

    private static void addSong(Library.Db db, Object playlistId, Object songId, double now) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("playlist_id", playlistId);
        v.put("position", nextPosition(db, playlistId));
        v.put("song_id", songId);
        v.put("render_id", null);
        v.put("added_at", now);
        db.insert("playlist_items", v);
    }

    static void albumGainedSong(Library.Db db, Object albumId, Object songId) {
        Map<String, Object> playlist = forAlbum(db, albumId, null);
        if (playlist == null) return;
        if (db.one("SELECT id FROM playlist_items WHERE playlist_id = ? AND song_id = ?", playlist.get("id"), songId) != null) return;
        addSong(db, playlist.get("id"), songId, Accounts.now());
    }

    static void albumLostSong(Library.Db db, Object albumId, Object songId) {
        Map<String, Object> playlist = db.one("SELECT * FROM playlists WHERE album_id = ?", albumId);
        if (playlist == null) return;
        db.run("DELETE FROM playlist_items WHERE playlist_id = ? AND song_id = ?", playlist.get("id"), songId);
    }
}
