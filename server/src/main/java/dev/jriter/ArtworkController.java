package dev.jriter;

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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Images attached to a song: a port of jriter/modules/artwork.py. */
@RestController
public class ArtworkController {
    static final List<String> IMAGE_EXT = List.of(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif");

    private final Library library;
    private final Grave grave;
    private final Blobs blobs;

    public ArtworkController(Library library, Blobs blobs, Grave grave) {
        this.library = library;
        this.blobs = blobs;
        this.grave = grave;
    }

    static Map<String, Object> getImage(Library.Db db, Object id) {
        Map<String, Object> row = db.one("SELECT * FROM artwork WHERE id = ?", id);
        if (row == null) throw new ApiError("no image with id " + id, 404);
        return row;
    }

    private static List<Map<String, Object>> images(Library.Db db, Object songId) {
        return db.query("SELECT * FROM artwork WHERE song_id = ? ORDER BY position, id", songId);
    }

    @GetMapping("/api/songs/{id}/artwork")
    public Object list(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        return Map.of("artwork", images(db, song.get("id")));
    }

    @PostMapping("/api/songs/{id}/artwork")
    public Object upload(HttpServletRequest req, @PathVariable String id) throws IOException {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no image in that upload");
        if (length > Api.IMAGE_MOST) throw new ApiError("That picture is over " + Api.mb(Api.IMAGE_MOST) + ", too big to keep here.", 413);
        String filename = Api.header(req, "X-Filename");
        if (filename.isEmpty()) filename = "cover.jpg";
        String ext = Api.extOf(filename);
        if (!IMAGE_EXT.contains(ext))
            throw new ApiError((ext.isEmpty() ? filename : ext) + " is not an image JR!TER handles");

        Blobs.Stored stored = blobs.putStream(acct, req.getInputStream(), length);
        Map<String, Object> same = db.one("SELECT * FROM artwork WHERE song_id = ? AND digest = ?",
                song.get("id"), stored.digest());
        Map<String, Object> out = new LinkedHashMap<>();
        if (same != null) {
            out.put("image", same);
            out.put("duplicate", true);
            return out;
        }
        Map<String, Object> row = db.one("SELECT MAX(position) AS p FROM artwork WHERE song_id = ?", song.get("id"));
        long next = row == null || row.get("p") == null ? 0 : Accounts.num(row.get("p")) + 1;
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", song.get("id"));
        v.put("digest", stored.digest());
        v.put("ext", ext);
        v.put("position", next);
        v.put("caption", Api.header(req, "X-Caption"));
        v.put("created_at", Accounts.now());
        long imageId = db.insert("artwork", v);
        SongsController.touch(db, song.get("id"));
        out.put("image", getImage(db, imageId));
        out.put("duplicate", false);
        return out;
    }

    @PostMapping("/api/songs/{id}/artwork/order")
    public Object reorder(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Object order = Body.json(req).get("order");
        if (!(order instanceof List<?> list) || list.isEmpty()) throw new ApiError("order must be a list of image ids");
        Set<Long> owned = new HashSet<>();
        for (Map<String, Object> r : db.query("SELECT id FROM artwork WHERE song_id = ?", song.get("id")))
            owned.add(Accounts.num(r.get("id")));
        List<Object> unknown = new ArrayList<>();
        for (Object o : list) if (asId(o) == null || !owned.contains(asId(o))) unknown.add(o);
        if (!unknown.isEmpty()) throw new ApiError("those images are not on this song: " + Api.listRepr(unknown));
        long position = 0;
        for (Object o : list) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("position", position++);
            db.update("artwork", asId(o), p);
        }
        SongsController.touch(db, song.get("id"));
        return Map.of("artwork", images(db, song.get("id")));
    }

    /** A JSON number that is a whole number, as Python's set lookup would match it. */
    static Long asId(Object o) {
        if (o instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) return n.longValue();
        return null;
    }

    @DeleteMapping("/api/artwork/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> image = getImage(db, id);
        grave.buryImage(db, acct, image.get("id"));
        db.run("DELETE FROM artwork WHERE id = ?", image.get("id"));
        String digest = (String) image.get("digest");
        if (db.one("SELECT id FROM artwork WHERE digest = ? LIMIT 1", digest) == null
                && db.one("SELECT id FROM albums WHERE cover_digest = ? LIMIT 1", digest) == null)
            blobs.delete(acct, digest);
        return Map.of("deleted", image.get("id"));
    }

    @GetMapping("/api/artwork/{id}/image")
    public ResponseEntity<Resource> image(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Map<String, Object> row = getImage(library.of(acct), id);
        return Api.serve(blobs.pathFor(acct, (String) row.get("digest")),
                Api.IMAGE_TYPES.getOrDefault((String) row.get("ext"), "application/octet-stream"),
                null, "that image is missing from storage");
    }
}
