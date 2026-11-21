package dev.jriter;

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

/** Lyrics, their alternatives and the history of each: a port of jriter/modules/lyrics.py. */
@RestController
public class LyricsController {
    private final Library library;

    public LyricsController(Library library) { this.library = library; }

    static Map<String, Object> getSheet(Library.Db db, Object id) {
        Map<String, Object> row = db.one("SELECT * FROM lyric_sheets WHERE id = ?", id);
        if (row == null) throw new ApiError("no lyric alternative with id " + id, 404);
        return row;
    }

    /** The first non empty line, minus any Markdown heading marks. */
    static String nameFrom(String text, String fallback) {
        if (text == null) return fallback;
        for (String line : text.split("\\r\\n|\\r|\\n|\\u000b|\\u000c|\\u001c|\\u001d|\\u001e|\\u0085|\\u2028|\\u2029")) {
            String l = line.strip();
            int i = 0;
            while (i < l.length() && l.charAt(i) == '#') i++;
            l = l.substring(i).strip();
            if (!l.isEmpty()) return l.length() > 80 ? l.substring(0, 80) : l;
        }
        return fallback;
    }

    static String plainName(Map<String, Object> sheet) {
        Object p = sheet.get("position");
        return "v" + (p == null ? 1 : Accounts.num(p) + 1);
    }

    private static Map<String, Object> latest(Library.Db db, Object sheetId) {
        return db.one("SELECT * FROM lyric_revisions WHERE sheet_id = ? ORDER BY id DESC LIMIT 1", sheetId);
    }

    static Map<String, Object> withText(Library.Db db, Map<String, Object> sheet) {
        Map<String, Object> rev = latest(db, sheet.get("id"));
        Map<String, Object> out = new LinkedHashMap<>(sheet);
        out.put("text", rev == null ? "" : rev.get("text"));
        out.put("revision_id", rev == null ? null : rev.get("id"));
        out.put("updated_at", rev == null ? sheet.get("created_at") : rev.get("created_at"));
        Map<String, Object> n = db.one("SELECT COUNT(*) AS n FROM lyric_revisions WHERE sheet_id = ?", sheet.get("id"));
        out.put("revisions", n == null ? 0 : n.get("n"));
        return out;
    }

    private static void addRevision(Library.Db db, Object sheetId, String text) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("sheet_id", sheetId);
        v.put("text", text);
        v.put("created_at", Accounts.now());
        db.insert("lyric_revisions", v);
    }

    private static void setName(Library.Db db, Object sheetId, String name) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("name", name);
        db.update("lyric_sheets", Accounts.num(sheetId), p);
    }

    @GetMapping("/api/songs/{id}/lyrics")
    public Object list(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT * FROM lyric_sheets WHERE song_id = ? ORDER BY position, id", song.get("id")))
            out.add(withText(db, r));
        return Map.of("lyrics", out);
    }

    @PostMapping("/api/songs/{id}/lyrics")
    public Object create(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> data = Body.json(req);
        String name = Body.str(data, "name").strip();
        long existing = Accounts.num(db.one("SELECT COUNT(*) AS n FROM lyric_sheets WHERE song_id = ?", song.get("id")).get("n"));
        if (name.isEmpty()) name = "v" + (existing + 1);
        Map<String, Object> row = db.one("SELECT MAX(position) AS p FROM lyric_sheets WHERE song_id = ?", song.get("id"));
        long next = row == null || row.get("p") == null ? 0 : Accounts.num(row.get("p")) + 1;
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", song.get("id"));
        v.put("name", name);
        v.put("position", next);
        v.put("is_current", existing > 0 ? 0 : 1);
        v.put("created_at", Accounts.now());
        long sheetId = db.insert("lyric_sheets", v);
        Object text = data.get("text");
        if (text instanceof String t && !t.isEmpty()) {
            addRevision(db, sheetId, t);
            setName(db, sheetId, nameFrom(t, name));
        }
        SongsController.touch(db, song.get("id"));
        return Map.of("sheet", withText(db, getSheet(db, sheetId)));
    }

    @PutMapping("/api/lyrics/{id}/text")
    public Object saveText(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        Map<String, Object> data = Body.json(req);
        if (!data.containsKey("text")) throw new ApiError("text is required");
        Object raw = data.get("text");
        String text = raw == null ? "" : raw instanceof String s ? s : String.valueOf(raw);
        Map<String, Object> current = latest(db, sheet.get("id"));
        if (current != null && text.equals(current.get("text"))) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("sheet", withText(db, sheet));
            out.put("saved", false);
            out.put("message", "Nothing changed, so no new revision was kept.");
            return out;
        }
        addRevision(db, sheet.get("id"), text);
        setName(db, sheet.get("id"), nameFrom(text, plainName(sheet)));
        SongsController.touch(db, sheet.get("song_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sheet", withText(db, getSheet(db, sheet.get("id"))));
        out.put("saved", true);
        return out;
    }

    @PatchMapping("/api/lyrics/{id}")
    public Object rename(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        Map<String, Object> data = Body.json(req);
        if (data.containsKey("name")) setName(db, sheet.get("id"), Body.need(data, "name"));
        return Map.of("sheet", withText(db, getSheet(db, sheet.get("id"))));
    }

    @PostMapping("/api/lyrics/{id}/current")
    public Object makeCurrent(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        db.run("UPDATE lyric_sheets SET is_current = 0 WHERE song_id = ?", sheet.get("song_id"));
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("is_current", 1);
        db.update("lyric_sheets", Accounts.num(sheet.get("id")), p);
        SongsController.touch(db, sheet.get("song_id"));
        return Map.of("sheet", withText(db, getSheet(db, sheet.get("id"))));
    }

    @GetMapping("/api/lyrics/{id}/history")
    public Object history(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        return Map.of("revisions", db.query("SELECT id, created_at, length(text) AS length FROM lyric_revisions"
                + " WHERE sheet_id = ? ORDER BY id DESC", sheet.get("id")));
    }

    @GetMapping("/api/lyric-revisions/{id}")
    public Object revision(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> row = db.one("SELECT * FROM lyric_revisions WHERE id = ?", id);
        if (row == null) throw new ApiError("no revision with id " + id, 404);
        return Map.of("revision", row);
    }

    @PostMapping("/api/lyrics/{id}/restore")
    public Object restore(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        Object revisionId = Body.json(req).get("revision_id");
        Map<String, Object> old = revisionId == null ? null
                : db.one("SELECT * FROM lyric_revisions WHERE id = ? AND sheet_id = ?", revisionId, sheet.get("id"));
        if (old == null) throw new ApiError("that revision is not part of this alternative", 404);
        Map<String, Object> current = latest(db, sheet.get("id"));
        if (current != null && old.get("text").equals(current.get("text"))) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("sheet", withText(db, sheet));
            out.put("saved", false);
            out.put("message", "That text is already the current one.");
            return out;
        }
        String text = (String) old.get("text");
        addRevision(db, sheet.get("id"), text);
        setName(db, sheet.get("id"), nameFrom(text, plainName(sheet)));
        SongsController.touch(db, sheet.get("song_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sheet", withText(db, getSheet(db, sheet.get("id"))));
        out.put("saved", true);
        return out;
    }

    @DeleteMapping("/api/lyrics/{id}")
    public Object delete(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> sheet = getSheet(db, id);
        // shortcut: grave (slice 9d) buries the sheet before it goes
        db.run("DELETE FROM lyric_revisions WHERE sheet_id = ?", sheet.get("id"));
        db.run("DELETE FROM lyric_sheets WHERE id = ?", sheet.get("id"));
        if (Accounts.num(sheet.get("is_current")) != 0) {
            Map<String, Object> other = db.one("SELECT id FROM lyric_sheets WHERE song_id = ? ORDER BY position LIMIT 1", sheet.get("song_id"));
            if (other != null) {
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("is_current", 1);
                db.update("lyric_sheets", Accounts.num(other.get("id")), p);
            }
        }
        return Map.of("deleted", sheet.get("id"));
    }
}
