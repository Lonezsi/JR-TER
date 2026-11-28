package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Albums: a cover, a title and an ordered list of songs: a port of jriter/modules/albums.py. */
@RestController
public class AlbumsController {
    static final Set<String> STICKER_KINDS = Set.of("warning", "price", "barcode", "sale", "ticket", "tape", "year", "discount");
    static final Map<String, double[]> STICKER_AT = Map.of(
            "tl", new double[] {28, 14}, "t", new double[] {50, 11}, "tr", new double[] {76, 13},
            "bl", new double[] {30, 86}, "b", new double[] {50, 89}, "br", new double[] {74, 86});
    static final int STICKER_MAX = 8;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;
    private final Grave grave;
    private final Blobs blobs;

    public AlbumsController(Library library, Blobs blobs, Grave grave) {
        this.library = library;
        this.blobs = blobs;
        this.grave = grave;
    }

    static Map<String, Object> getAlbum(Library.Db db, Object id) {
        Map<String, Object> row = db.one("SELECT * FROM albums WHERE id = ?", id);
        if (row == null) throw new ApiError("no album with id " + id, 404);
        return row;
    }

    /** Adds song_count, duration and has_cover to an album row. */
    static Map<String, Object> counted(Library.Db db, Map<String, Object> album) {
        Object id = album.get("id");
        album.put("song_count", db.one("SELECT COUNT(*) AS n FROM album_songs WHERE album_id = ?", id).get("n"));
        Object total = db.one("SELECT COALESCE(SUM(v.duration), 0) AS d FROM album_songs a JOIN songs s ON s.id = a.song_id"
                + " LEFT JOIN versions v ON v.id = s.current_version_id WHERE a.album_id = ?", id).get("d");
        album.put("duration", AudioMeta.round(total == null ? 0 : Accounts.dbl(total), 2));
        Object digest = album.get("cover_digest");
        album.put("has_cover", digest != null && !String.valueOf(digest).isEmpty());
        return album;
    }

    @GetMapping("/api/albums")
    public Object list(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        List<Map<String, Object>> rows = db.query("SELECT * FROM albums ORDER BY COALESCE(year, 0) DESC, title COLLATE NOCASE");
        for (Map<String, Object> r : rows) counted(db, r);
        return Map.of("albums", rows);
    }

    @GetMapping("/api/albums/most-opened")
    public Object mostOpened(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        // Python passes 6 as the field name here, so a missing limit is an error there; this does what it meant.
        int limit = Api.queryInt(req, "limit", 6);
        List<Map<String, Object>> rows = db.query("SELECT * FROM albums WHERE opened > 0 ORDER BY opened DESC, updated_at DESC LIMIT ?", limit);
        for (Map<String, Object> r : rows) counted(db, r);
        return Map.of("albums", rows);
    }

    private Object open(Library.Db db, Object id) {
        Map<String, Object> album = getAlbum(db, id);
        db.run("UPDATE albums SET opened = opened + 1 WHERE id = ?", album.get("id"));
        PlaylistsController.forAlbum(db, album.get("id"), (String) album.get("title"));
        counted(db, album);
        List<Map<String, Object>> rows = db.query("SELECT s.*, a.position FROM album_songs a JOIN songs s ON s.id = a.song_id"
                + " WHERE a.album_id = ? ORDER BY a.position, s.title COLLATE NOCASE", album.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("album", album);
        out.put("songs", SongsController.decorate(db, rows));
        return out;
    }

    @GetMapping("/api/albums/{id}")
    public Object get(HttpServletRequest req, @PathVariable String id) {
        return open(library.of(Api.acct(req)), id);
    }

    private static Object year(Object v) {
        if (v == null || (v instanceof String s && s.isEmpty())) return null;
        try {
            if (v instanceof Number n) return n.longValue();
            if (v instanceof Boolean b) return b ? 1L : 0L;
            return Long.parseLong(String.valueOf(v).strip());
        } catch (NumberFormatException e) {
            throw new ApiError("year must be a whole number");
        }
    }

    @PostMapping("/api/albums")
    public Object create(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> data = Body.json(req);
        String title = Body.need(data, "title");
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", title);
        v.put("year", year(data.get("year")));
        Object notes = data.get("notes");
        v.put("notes", notes == null ? "" : notes);
        v.put("created_at", now);
        v.put("updated_at", now);
        long id = db.insert("albums", v);
        PlaylistsController.forAlbum(db, id, title);
        return Map.of("album", getAlbum(db, id));
    }

    @PatchMapping("/api/albums/{id}")
    public Object update(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> album = getAlbum(db, id);
        Map<String, Object> data = Body.json(req);
        Map<String, Object> patch = new LinkedHashMap<>();
        if (data.containsKey("title")) patch.put("title", Body.need(data, "title"));
        if (data.containsKey("year")) patch.put("year", year(data.get("year")));
        if (data.containsKey("notes")) patch.put("notes", ArrangeController.truthy(data.get("notes")) ? data.get("notes") : "");
        if (data.containsKey("stickers")) patch.put("stickers", stickers(data.get("stickers")));
        if (data.containsKey("released_at")) patch.put("released_at", releasedAt(data.get("released_at")));
        if (data.containsKey("store_link")) patch.put("store_link", storeLink(data.get("store_link")));
        if (data.containsKey("upc")) patch.put("upc", upc(data.get("upc")));
        patch.put("updated_at", Accounts.now());
        db.update("albums", Accounts.num(album.get("id")), patch);
        return Map.of("album", getAlbum(db, album.get("id")));
    }

    private static String blank(Object v) {
        return v == null ? "" : String.valueOf(v).strip();
    }

    /** The day the album came out, as 2026-11-27; empty clears it. */
    static String releasedAt(Object value) {
        String s = blank(value);
        if (s.isEmpty()) return "";
        try {
            if (!s.matches("\\d{4}-\\d{2}-\\d{2}")) throw new java.time.DateTimeException(s);
            java.time.LocalDate.parse(s);
        } catch (java.time.DateTimeException e) {
            throw new ApiError("The release date must look like 2026-11-27.");
        }
        return s;
    }

    /** Where the album is in a store: an https:// address only; empty clears it. */
    static String storeLink(Object value) {
        String s = blank(value);
        if (s.isEmpty()) return "";
        String host = null;
        try {
            if (s.length() <= 500 && s.regionMatches(true, 0, "https://", 0, 8) && !s.matches(".*\\s.*"))
                host = java.net.URI.create(s).getHost();
        } catch (IllegalArgumentException e) {
            host = null;
        }
        if (host == null || host.isEmpty()) throw new ApiError("The store link must be an https:// address.");
        return s;
    }

    /** A UPC or EAN barcode: 12 or 13 digits (spaces and dashes dropped); empty clears it. */
    static String upc(Object value) {
        String s = blank(value).replaceAll("[ -]", "");
        if (s.isEmpty()) return "";
        if (!s.matches("\\d{12,13}")) throw new ApiError("A UPC is 12 or 13 digits.");
        return s;
    }

    private static double num(Map<?, ?> s, String key, double low, double high, double def) {
        if (!s.containsKey(key)) return clamp(def, low, high);
        Object v = s.get(key);
        try {
            double d;
            if (v instanceof Number n) d = n.doubleValue();
            else if (v instanceof Boolean b) d = b ? 1 : 0;
            else if (v instanceof String str) d = Double.parseDouble(str.strip());
            else return def;
            if (Double.isNaN(d)) return def;
            return clamp(Math.round(d * 10) / 10.0, low, high);
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static double clamp(double v, double low, double high) { return Math.max(low, Math.min(high, v)); }

    /** A case's stickers, checked: up to eight, of the kinds the page draws, short texts. */
    static String stickers(Object value) {
        if (value == null || (value instanceof String s && s.isEmpty())) return "";
        if (!(value instanceof List<?> list) || list.size() > STICKER_MAX)
            throw new ApiError("Up to " + STICKER_MAX + " stickers on a case.");
        List<Object> out = new ArrayList<>();
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> s) || !STICKER_KINDS.contains(s.get("kind")))
                throw new ApiError("That's not a sticker JR!TER knows.");
            double[] at = s.get("at") instanceof String a && STICKER_AT.containsKey(a) ? STICKER_AT.get(a) : new double[] {50, 50};
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("kind", s.get("kind"));
            one.put("x", num(s, "x", 0, 100, at[0]));
            one.put("y", num(s, "y", 0, 100, at[1]));
            one.put("s", num(s, "s", 0.4, 3, 1));
            one.put("rot", num(s, "rot", -180, 180, 0));
            if (ArrangeController.truthy(s.get("text"))) {
                String t = String.valueOf(s.get("text"));
                one.put("text", t.length() > 48 ? t.substring(0, 48) : t);
            }
            out.add(one);
        }
        try {
            return JSON.writeValueAsString(out);
        } catch (IOException e) {
            throw new ApiError("That's not a sticker JR!TER knows.");
        }
    }

    @DeleteMapping("/api/albums/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> album = getAlbum(db, id);
        grave.buryAlbum(db, acct, album.get("id"));
        db.run("DELETE FROM album_songs WHERE album_id = ?", album.get("id"));
        db.run("DELETE FROM albums WHERE id = ?", album.get("id"));
        return Map.of("deleted", album.get("id"));
    }

    private static void bump(Library.Db db, Object albumId) {
        db.run("UPDATE albums SET updated_at = ? WHERE id = ?", Accounts.now(), albumId);
    }

    @PostMapping("/api/albums/{id}/songs")
    public Object addSong(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> album = getAlbum(db, id);
        Map<String, Object> song = SongsController.getSong(db, Body.need(Body.json(req), "song_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("album_id", album.get("id"));
        out.put("song_id", song.get("id"));
        if (db.one("SELECT * FROM album_songs WHERE album_id = ? AND song_id = ?", album.get("id"), song.get("id")) != null) {
            out.put("added", false);
            return out;
        }
        Map<String, Object> row = db.one("SELECT MAX(position) AS p FROM album_songs WHERE album_id = ?", album.get("id"));
        long next = row == null || row.get("p") == null ? 0 : Accounts.num(row.get("p")) + 1;
        db.run("INSERT INTO album_songs (album_id, song_id, position) VALUES (?, ?, ?)", album.get("id"), song.get("id"), next);
        bump(db, album.get("id"));
        PlaylistsController.albumGainedSong(db, album.get("id"), song.get("id"));
        out.put("added", true);
        return out;
    }

    @DeleteMapping("/api/albums/{id}/songs/{songId}")
    public Object removeSong(HttpServletRequest req, @PathVariable String id, @PathVariable String songId) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> album = getAlbum(db, id);
        db.run("DELETE FROM album_songs WHERE album_id = ? AND song_id = ?", album.get("id"), songId);
        PlaylistsController.albumLostSong(db, album.get("id"), songId);
        bump(db, album.get("id"));
        return Map.of("removed", songId);
    }

    @PostMapping("/api/albums/{id}/order")
    public Object reorder(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> album = getAlbum(db, id);
        Object order = Body.json(req).get("order");
        if (!(order instanceof List<?> list) || list.isEmpty()) throw new ApiError("order must be a list of song ids");
        Set<Long> owned = new HashSet<>();
        for (Map<String, Object> r : db.query("SELECT song_id FROM album_songs WHERE album_id = ?", album.get("id")))
            owned.add(Accounts.num(r.get("song_id")));
        List<Object> unknown = new ArrayList<>();
        for (Object o : list) if (ArtworkController.asId(o) == null || !owned.contains(ArtworkController.asId(o))) unknown.add(o);
        if (!unknown.isEmpty()) throw new ApiError("those songs are not on this album: " + Api.listRepr(unknown));
        long position = 0;
        for (Object o : list)
            db.run("UPDATE album_songs SET position = ? WHERE album_id = ? AND song_id = ?", position++, album.get("id"), ArtworkController.asId(o));
        bump(db, album.get("id"));
        return open(db, album.get("id"));
    }

    @PostMapping("/api/albums/{id}/cover")
    public Object uploadCover(HttpServletRequest req, @PathVariable String id) throws IOException {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> album = getAlbum(db, id);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no image in that upload");
        if (length > Api.IMAGE_MOST) throw new ApiError("That cover is over " + Api.mb(Api.IMAGE_MOST) + ", too big to keep here.", 413);
        String filename = Api.header(req, "X-Filename");
        if (filename.isEmpty()) filename = "cover.jpg";
        String ext = Api.extOf(filename);
        if (!ArtworkController.IMAGE_EXT.contains(ext))
            throw new ApiError((ext.isEmpty() ? filename : ext) + " is not an image JR!TER handles");
        Blobs.Stored stored = blobs.putUpload(req, acct, length);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("cover_digest", stored.digest());
        p.put("cover_ext", ext);
        p.put("updated_at", Accounts.now());
        db.update("albums", Accounts.num(album.get("id")), p);
        return Map.of("album", getAlbum(db, album.get("id")));
    }

    @GetMapping("/api/albums/{id}/cover")
    public ResponseEntity<Resource> cover(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> album = getAlbum(library.of(acct), id);
        String digest = (String) album.get("cover_digest");
        if (digest == null || digest.isEmpty()) throw new ApiError("this album has no cover yet", 404);
        return Api.serve(blobs.pathFor(acct, digest),
                Api.IMAGE_TYPES.getOrDefault((String) album.get("cover_ext"), "application/octet-stream"),
                null, "that cover is missing from storage");
    }

    @GetMapping("/api/songs/{id}/albums")
    public Object forSong(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        return Map.of("albums", db.query("SELECT al.* FROM album_songs a JOIN albums al ON al.id = a.album_id"
                + " WHERE a.song_id = ? ORDER BY al.title COLLATE NOCASE", song.get("id")));
    }
}
