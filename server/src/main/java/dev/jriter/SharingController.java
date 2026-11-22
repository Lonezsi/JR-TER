package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Letting a friend work on one song: a port of jriter/modules/sharing.py.
 *
 * The reach of a share is bounded by this file: every route takes a share id, looks up what
 * it may touch, and crosses into the other library for exactly one read (library.of(other)).
 * Files and the guest proxy hand the request on to the ordinary routes by a forward, with the
 * acting account set to the library the file lives in, so Range and content types come from
 * the controllers that already get them right.
 */
@RestController
public class SharingController {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern SHARED_ON = Pattern.compile("^/api/shared/(\\d+)/on/(.+)$");
    private static final Pattern SAFE_PATH = Pattern.compile("^[A-Za-z0-9_./-]+$");
    private static final String NOT_OPEN = "That share is not open to you.";
    private static final String LINK_CLOSED = "That link is not open. It may have been used already, or taken back.";

    private final Library library;
    private final Accounts accounts;
    private final Auth auth;
    private final AuthController authController;

    public SharingController(Library library, Accounts accounts, Auth auth, AuthController authController) {
        this.library = library;
        this.accounts = accounts;
        this.auth = auth;
        this.authController = authController;
    }

    // -- what a share is allowed to reach ----------------------------------------------
    static long id(Object v, String field) {
        try {
            if (v instanceof Number n) return n.longValue();
            return Long.parseLong(String.valueOf(v).strip());
        } catch (NumberFormatException e) {
            throw new ApiError(field + " must be a whole number");
        }
    }

    /** One live share, or the same refusal for "no such share" and "not yours". */
    private Map<String, Object> share(Object shareId, long want) {
        Map<String, Object> row;
        try {
            row = accounts.share(Long.parseLong(String.valueOf(shareId).strip()));
        } catch (NumberFormatException e) {
            row = null;
        }
        if (row == null || Accounts.dbl(row.get("revoked_at")) != 0) throw new ApiError(NOT_OPEN, 404);
        if (Accounts.num(row.get("to_account")) != want && Accounts.num(row.get("from_account")) != want)
            throw new ApiError(NOT_OPEN, 404);
        return row;
    }

    private static long theirs(Map<String, Object> share) { return Accounts.num(share.get("from_account")); }

    private static Map<String, Object> presetOut(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        try {
            out.put("data", JSON.readValue(String.valueOf(row.get("data")), Object.class));
        } catch (Exception e) {
            out.put("data", new LinkedHashMap<>());
        }
        return out;
    }

    private static Map<String, Object> sheetOut(Library.Db db, Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>(row);
        Map<String, Object> latest = db.one("SELECT text FROM lyric_revisions WHERE sheet_id = ? ORDER BY id DESC LIMIT 1", row.get("id"));
        out.put("text", latest == null ? "" : latest.get("text"));
        return out;
    }

    private static final String PRESET_COLS = "SELECT id, name, is_current, data, created_at FROM sound_presets WHERE song_id = ? ORDER BY id";
    private static final String SHEET_COLS = "SELECT id, name, position, is_current, created_at FROM lyric_sheets WHERE song_id = ? ORDER BY position, id";

    private List<Object> presetsOf(Library.Db db, Object songId) {
        List<Object> out = new ArrayList<>();
        if (db.tableExists("sound_presets")) for (Map<String, Object> r : db.query(PRESET_COLS, songId)) out.add(presetOut(r));
        return out;
    }

    private List<Object> sheetsOf(Library.Db db, Object songId) {
        List<Object> out = new ArrayList<>();
        if (db.tableExists("lyric_sheets")) for (Map<String, Object> r : db.query(SHEET_COLS, songId)) out.add(sheetOut(db, r));
        return out;
    }

    /** The shared song, read out of the sharer's library; 410 when it is gone or is a different song with the old id. */
    private Map<String, Object> songIn(Map<String, Object> share) {
        Map<String, Object> row = library.of(theirs(share)).one(
                "SELECT id, title, current_version_id, created_at FROM songs WHERE id = ?", share.get("song_id"));
        if (row == null) throw new ApiError("The song behind this share is gone.", 410);
        if (Accounts.dbl(row.get("created_at")) > Accounts.dbl(share.get("created_at")))
            throw new ApiError("The song behind this share is gone.", 410);
        return row;
    }

    private List<Map<String, Object>> artworkIn(Map<String, Object> share) {
        songIn(share);
        Library.Db db = library.of(theirs(share));
        if (!db.tableExists("artwork")) return new ArrayList<>();
        return db.query("SELECT id, caption, position FROM artwork WHERE song_id = ? ORDER BY position, id", share.get("song_id"));
    }

    private String nameOf(Object accountId) {
        Map<String, Object> p = accounts.pub(accounts.byId(Accounts.num(accountId)));
        return p == null ? "somebody" : String.valueOf(p.get("name"));
    }

    /** Hand the request to an ordinary route, acting as the account whose library holds the file. */
    private static void forward(HttpServletRequest req, HttpServletResponse res, long as, String path) throws Exception {
        req.setAttribute(Door.WHO, as);
        req.getRequestDispatcher(path).forward(req, res);
    }

    // -- the recipient's view ------------------------------------------------------------
    @GetMapping("/api/shared")
    public Object sharedWithMe(HttpServletRequest req) {
        long me = Api.acct(req);
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> row : accounts.sharesTo(me)) {
            Map<String, Object> song;
            try {
                song = songIn(row);
            } catch (ApiError e) {
                continue;
            }
            Map<String, Object> from = accounts.pub(accounts.byId(Accounts.num(row.get("from_account"))));
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("share", row.get("id"));
            o.put("title", song.get("title"));
            o.put("from", from == null ? "somebody" : from.get("name"));
            o.put("from_handle", from == null ? "" : from.get("handle"));
            o.put("as_name", row.get("as_name"));
            o.put("created_at", row.get("created_at"));
            o.put("can_play", song.get("current_version_id") != null && Accounts.num(song.get("current_version_id")) != 0);
            List<Map<String, Object>> art = artworkIn(row);
            o.put("art", art.isEmpty() ? null : art.get(0).get("id"));
            out.add(o);
        }
        return Map.of("shared", out);
    }

    @GetMapping("/api/shared/{id}")
    public Object openShare(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        Map<String, Object> share = share(id, me);
        Map<String, Object> song = songIn(share);
        Library.Db their = library.of(theirs(share));
        Map<String, Object> version = null;
        if (song.get("current_version_id") != null && Accounts.num(song.get("current_version_id")) != 0)
            version = their.one("SELECT id, n, duration, filename FROM versions WHERE id = ?", song.get("current_version_id"));
        List<Object> presets = presetsOf(their, share.get("song_id"));
        List<Object> sheets = sheetsOf(their, share.get("song_id"));
        Map<String, Object> from = accounts.pub(accounts.byId(theirs(share)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("share", share.get("id"));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("title", song.get("title"));
        s.put("id", song.get("id"));
        out.put("song", s);
        out.put("artwork", artworkIn(share));
        out.put("from", from == null ? "somebody" : from.get("name"));
        out.put("as_name", share.get("as_name"));
        out.put("version", version);
        out.put("presets", presets);
        out.put("sheets", sheets);
        out.put("mine", myCopies(library.of(me), share));
        return out;
    }

    @GetMapping("/api/shared/{id}/artwork/{image}")
    public void sharedArtwork(HttpServletRequest req, HttpServletResponse res, @PathVariable String id,
                              @PathVariable String image) throws Exception {
        Map<String, Object> share = share(id, Api.acct(req));
        long want = id(image, "image");
        boolean ok = false;
        for (Map<String, Object> r : artworkIn(share)) if (Accounts.num(r.get("id")) == want) ok = true;
        if (!ok) throw new ApiError("That picture is not part of this share.", 404);
        forward(req, res, theirs(share), "/api/artwork/" + want + "/image");
    }

    @GetMapping("/api/shared/{id}/audio")
    public void sharedAudio(HttpServletRequest req, HttpServletResponse res, @PathVariable String id) throws Exception {
        Map<String, Object> share = share(id, Api.acct(req));
        Map<String, Object> song = songIn(share);
        if (song.get("current_version_id") == null || Accounts.num(song.get("current_version_id")) == 0)
            throw new ApiError("There is no render on this song yet.", 404);
        forward(req, res, theirs(share), "/api/versions/" + Accounts.num(song.get("current_version_id")) + "/audio");
    }

    // -- what the recipient makes (written to their own library) -------------------------
    private long mySong(Library.Db mine, Map<String, Object> share) {
        String marker = "share:" + share.get("id");
        Map<String, Object> row = mine.one("SELECT id FROM songs WHERE shared_from = ?", marker);
        if (row != null) return Accounts.num(row.get("id"));
        Map<String, Object> song = songIn(share);
        Map<String, Object> from = accounts.pub(accounts.byId(theirs(share)));
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("title", song.get("title") + " (" + (from == null ? "shared" : from.get("name")) + ")");
        v.put("created_at", now);
        v.put("updated_at", now);
        v.put("shared_from", marker);
        return mine.insert("songs", v);
    }

    private Map<String, Object> myCopies(Library.Db mine, Map<String, Object> share) {
        Map<String, Object> row = mine.one("SELECT id FROM songs WHERE shared_from = ?", "share:" + share.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        if (row == null) {
            out.put("song", null);
            out.put("presets", new ArrayList<>());
            out.put("sheets", new ArrayList<>());
            return out;
        }
        out.put("song", row.get("id"));
        out.put("presets", presetsOf(mine, row.get("id")));
        out.put("sheets", sheetsOf(mine, row.get("id")));
        return out;
    }

    private static String named(Map<String, Object> share, String original) {
        String as = String.valueOf(share.get("as_name"));
        if (share.get("as_name") == null || as.isEmpty()) return original;
        return original + ", edited by " + as;
    }

    private static boolean hasAsName(Map<String, Object> share) {
        return share.get("as_name") != null && !String.valueOf(share.get("as_name")).isEmpty();
    }

    private static String cut(String s, int n) {
        s = s.strip();
        return s.length() > n ? s.substring(0, n) : s;
    }

    @PostMapping("/api/shared/{id}/preset")
    public Object savePreset(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        Map<String, Object> share = share(id, me);
        if (Accounts.num(share.get("to_account")) != me)
            throw new ApiError("Only the person a song was shared with can save into it.", 403);
        songIn(share);
        Map<String, Object> data = Body.json(req);
        if (data.get("data") == null) throw new ApiError("data is required");
        Map<String, Object> payload = SoundController.normalise(data.get("data"));
        Object fromId = data.get("from");
        Object nameRaw = data.get("name");
        String name = cut(nameRaw == null || nameRaw.equals(false) ? "" : String.valueOf(nameRaw), 80);
        if (SoundController.truthy(fromId, false) && name.isEmpty()) {
            Map<String, Object> original = library.of(theirs(share)).one(
                    "SELECT name FROM sound_presets WHERE id = ? AND song_id = ?", fromId, share.get("song_id"));
            if (original == null) throw new ApiError("That preset is not part of this share.", 404);
            name = named(share, String.valueOf(original.get("name")));
        }
        if (name.isEmpty()) name = hasAsName(share) ? named(share, "Current") : "Mine";

        Library.Db mine = library.of(me);
        long songId = mySong(mine, share);
        double now = Accounts.now();
        Map<String, Object> held = mine.one("SELECT id FROM sound_presets WHERE song_id = ? AND name = ?", songId, name);
        long made;
        if (held != null) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("data", SoundController.dump(payload));
            v.put("updated_at", now);
            mine.update("sound_presets", Accounts.num(held.get("id")), v);
            made = Accounts.num(held.get("id"));
        } else {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("song_id", songId);
            v.put("name", name);
            v.put("is_current", 1);
            v.put("data", SoundController.dump(payload));
            v.put("created_at", now);
            v.put("updated_at", now);
            made = mine.insert("sound_presets", v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("preset", presetOut(mine.one("SELECT id, name, is_current, data, created_at FROM sound_presets WHERE id = ?", made)));
        out.put("song", songId);
        return out;
    }

    @PostMapping("/api/shared/{id}/sheet")
    public Object saveSheet(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        Map<String, Object> share = share(id, me);
        if (Accounts.num(share.get("to_account")) != me)
            throw new ApiError("Only the person a song was shared with can save into it.", 403);
        songIn(share);
        Map<String, Object> data = Body.json(req);
        Object t = data.get("text");
        String text = t == null || t.equals(false) || "".equals(t) ? "" : String.valueOf(t);
        Object fromId = data.get("from");
        Object nameRaw = data.get("name");
        String name = cut(nameRaw == null || nameRaw.equals(false) ? "" : String.valueOf(nameRaw), 80);
        if (SoundController.truthy(fromId, false) && name.isEmpty()) {
            Map<String, Object> original = library.of(theirs(share)).one(
                    "SELECT name FROM lyric_sheets WHERE id = ? AND song_id = ?", fromId, share.get("song_id"));
            if (original == null) throw new ApiError("Those words are not part of this share.", 404);
            Object n = original.get("name");
            name = named(share, n == null || String.valueOf(n).isEmpty() ? "Lyrics" : String.valueOf(n));
        }
        if (name.isEmpty()) name = hasAsName(share) ? named(share, "Lyrics") : "Mine";

        Library.Db mine = library.of(me);
        long songId = mySong(mine, share);
        double now = Accounts.now();
        Map<String, Object> held = mine.one("SELECT id FROM lyric_sheets WHERE song_id = ? AND name = ?", songId, name);
        long sheetId;
        if (held != null) sheetId = Accounts.num(held.get("id"));
        else {
            Map<String, Object> row = mine.one("SELECT MAX(position) AS p FROM lyric_sheets WHERE song_id = ?", songId);
            long position = (row != null && row.get("p") != null ? Accounts.num(row.get("p")) : -1) + 1;
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("song_id", songId);
            v.put("name", name);
            v.put("position", position);
            v.put("is_current", 1);
            v.put("created_at", now);
            sheetId = mine.insert("lyric_sheets", v);
        }
        Map<String, Object> latest = mine.one("SELECT text FROM lyric_revisions WHERE sheet_id = ? ORDER BY id DESC LIMIT 1", sheetId);
        if (latest == null || !text.equals(latest.get("text"))) {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("sheet_id", sheetId);
            v.put("text", text);
            v.put("created_at", now);
            mine.insert("lyric_revisions", v);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sheet", sheetOut(mine, mine.one(
                "SELECT id, name, position, is_current, created_at FROM lyric_sheets WHERE id = ?", sheetId)));
        out.put("song", songId);
        return out;
    }

    // -- what everybody on a song has made -------------------------------------------------
    private List<Map<String, Object>> peopleOn(long owner, long songId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : accounts.sharesFrom(owner, songId))
            if (Accounts.num(r.get("to_account")) != 0) out.add(r);
        return out;
    }

    private boolean maySee(Map<String, Object> share, long me) {
        if (me == theirs(share)) return true;
        for (Map<String, Object> r : peopleOn(theirs(share), Accounts.num(share.get("song_id"))))
            if (Accounts.num(r.get("to_account")) == me) return true;
        return false;
    }

    private Map<String, Object> theirCopy(Map<String, Object> share) {
        return library.of(Accounts.num(share.get("to_account")))
                .one("SELECT id, title, updated_at FROM songs WHERE shared_from = ?", "share:" + share.get("id"));
    }

    private Map<String, Object> workOf(Map<String, Object> share) {
        Map<String, Object> copy = theirCopy(share);
        Map<String, Object> person = accounts.pub(accounts.byId(Accounts.num(share.get("to_account"))));
        Object pname = person == null ? null : person.get("name");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("share", share.get("id"));
        out.put("name", pname != null && !String.valueOf(pname).isEmpty() ? pname : share.get("as_name") == null ? "" : share.get("as_name"));
        out.put("handle", person == null ? "" : person.get("handle"));
        out.put("since", share.get("created_at"));
        out.put("updated_at", null);
        List<Object> sheets = new ArrayList<>(), presets = new ArrayList<>(), art = new ArrayList<>(), versions = new ArrayList<>();
        out.put("sheets", sheets);
        out.put("presets", presets);
        out.put("artwork", art);
        out.put("versions", versions);
        out.put("made_anything", false);
        if (copy == null) return out;
        out.put("updated_at", copy.get("updated_at"));
        Library.Db db = library.of(Accounts.num(share.get("to_account")));
        for (Object s : sheetsOf(db, copy.get("id")))
            if (!String.valueOf(((Map<?, ?>) s).get("text")).strip().isEmpty()) sheets.add(s);
        presets.addAll(presetsOf(db, copy.get("id")));
        if (db.tableExists("artwork"))
            art.addAll(db.query("SELECT id, caption, position FROM artwork WHERE song_id = ? ORDER BY position, id", copy.get("id")));
        if (db.tableExists("versions"))
            versions.addAll(db.query("SELECT id, n, filename, duration, created_at FROM versions WHERE song_id = ? ORDER BY n DESC", copy.get("id")));
        out.put("made_anything", !sheets.isEmpty() || !presets.isEmpty() || !art.isEmpty() || !versions.isEmpty());
        return out;
    }

    @GetMapping("/api/songs/{id}/guests")
    public Object songGuests(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        long song = id(id, "id");
        Library.Db db = library.of(me);
        if (db.one("SELECT id FROM songs WHERE id = ?", song) == null) throw new ApiError("No such song.", 404);
        List<Object> people = new ArrayList<>();
        for (Map<String, Object> r : peopleOn(me, song)) {
            Map<String, Object> person = workOf(r);
            Map<String, Object> n = db.one("SELECT COUNT(*) AS n FROM guest_edits WHERE share_id = ? AND song_id = ? AND undone_at = 0",
                    r.get("id"), song);
            long changes = n == null ? 0 : Accounts.num(n.get("n"));
            person.put("changes", changes);
            person.put("made_anything", Boolean.TRUE.equals(person.get("made_anything")) || changes != 0);
            people.add(person);
        }
        return Map.of("people", people);
    }

    @GetMapping("/api/shared/{id}/guests")
    public Object sharedGuests(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        Map<String, Object> share = share(id, me);
        songIn(share);
        List<Object> people = new ArrayList<>();
        for (Map<String, Object> r : peopleOn(theirs(share), Accounts.num(share.get("song_id"))))
            if (Accounts.num(r.get("to_account")) != me) people.add(workOf(r));
        return Map.of("people", people);
    }

    private Map<String, Object> guestShare(Object shareId, long me) {
        Map<String, Object> share;
        try {
            share = accounts.share(Long.parseLong(String.valueOf(shareId).strip()));
        } catch (NumberFormatException e) {
            throw new ApiError("share must be a whole number");
        }
        if (share == null || Accounts.dbl(share.get("revoked_at")) != 0 || Accounts.num(share.get("to_account")) == 0
                || !maySee(share, me))
            throw new ApiError("That is not open to you.", 404);
        return share;
    }

    @GetMapping("/api/guestwork/{share}/artwork/{image}")
    public void guestArtwork(HttpServletRequest req, HttpServletResponse res, @PathVariable String share,
                             @PathVariable String image) throws Exception {
        Map<String, Object> s = guestShare(share, Api.acct(req));
        Map<String, Object> copy = theirCopy(s);
        long want = id(image, "image");
        long guest = Accounts.num(s.get("to_account"));
        if (copy == null || library.of(guest).one("SELECT id FROM artwork WHERE id = ? AND song_id = ?", want, copy.get("id")) == null)
            throw new ApiError("That picture is not part of this share.", 404);
        forward(req, res, guest, "/api/artwork/" + want + "/image");
    }

    @GetMapping("/api/guestwork/{share}/audio/{version}")
    public void guestAudio(HttpServletRequest req, HttpServletResponse res, @PathVariable String share,
                           @PathVariable String version) throws Exception {
        Map<String, Object> s = guestShare(share, Api.acct(req));
        Map<String, Object> copy = theirCopy(s);
        long want = id(version, "version");
        long guest = Accounts.num(s.get("to_account"));
        if (copy == null || library.of(guest).one("SELECT id FROM versions WHERE id = ? AND song_id = ?", want, copy.get("id")) == null)
            throw new ApiError("That mix is not part of this share.", 404);
        forward(req, res, guest, "/api/versions/" + want + "/audio");
    }

    // -- working on the owner's song itself (the guest proxy) ----------------------------
    // {method, route, what the ids are, what the change is called}
    private static final String[][] GUEST_MAY = {
        {"GET", "/api/songs/<id>", "song", null},
        {"GET", "/api/songs/<id>/titles", "song", null},
        {"PATCH", "/api/songs/<id>", "song", "renamed the song"},
        {"GET", "/api/songs/<id>/artwork", "song", null},
        {"POST", "/api/songs/<id>/artwork", "song", "added a picture"},
        {"POST", "/api/songs/<id>/artwork/order", "song", "changed the cover"},
        {"GET", "/api/artwork/<id>/image", "artwork", null},
        {"GET", "/api/songs/<id>/lyrics", "song", null},
        {"POST", "/api/songs/<id>/lyrics", "song", "added words"},
        {"PUT", "/api/lyrics/<id>/text", "sheet", "edited the words"},
        {"PATCH", "/api/lyrics/<id>", "sheet", "renamed the words"},
        {"POST", "/api/lyrics/<id>/current", "sheet", "chose which words"},
        {"GET", "/api/lyrics/<id>/history", "sheet", null},
        {"POST", "/api/lyrics/<id>/restore", "sheet", "brought back older words"},
        {"GET", "/api/lyric-revisions/<id>", "revision", null},
        {"GET", "/api/songs/<id>/sound", "song", null},
        {"POST", "/api/songs/<id>/sound", "song", "added a sound"},
        {"PUT", "/api/sound/<id>", "preset", "changed the sound"},
        {"PATCH", "/api/sound/<id>", "preset", "renamed a sound"},
        {"POST", "/api/sound/<id>/current", "preset", "chose which sound"},
        {"GET", "/api/songs/<id>/daw", "song", null},
        {"PUT", "/api/songs/<id>/daw", "song", "changed the DAW project"},
        {"POST", "/api/songs/<id>/daw/here", "song", null},
        {"GET", "/api/songs/<id>/versions", "song", null},
        {"POST", "/api/songs/<id>/versions", "song", "uploaded a mix"},
        {"PATCH", "/api/versions/<id>", "version", "renamed a mix"},
        {"POST", "/api/versions/<id>/current", "version", "chose which mix"},
        {"GET", "/api/versions/<id>/audio", "version", null},
        {"GET", "/api/versions/<id>/download", "version", null},
        {"GET", "/api/songs/<id>/arrangement", "song", null},
        {"PUT", "/api/songs/<id>/arrangement", "song", "changed the arrangement"},
        {"POST", "/api/songs/<id>/arrangement/enabled", "song", "switched the arrangement"},
        {"GET", "/api/arrangements/shapes", null, null},
        // Voices: not in the history; the vocals module decides who may change a take.
        {"GET", "/api/songs/<id>/vocals", "song", null},
        {"POST", "/api/songs/<id>/vocals", "song", null},
        {"PATCH", "/api/vocals/<id>", "vocal", null},
        {"DELETE", "/api/vocals/<id>", "vocal", null},
        {"GET", "/api/vocals/<id>/audio", "vocal", null},
    };

    /** The route entry and the value of its <id>, or null. */
    private static Object[] findGuestRoute(String method, String path) {
        String[] got = path.replaceAll("^/+|/+$", "").split("/");
        for (String[] r : GUEST_MAY) {
            if (!r[0].equals(method)) continue;
            String[] want = r[1].replaceAll("^/+|/+$", "").split("/");
            if (want.length != got.length) continue;
            String ident = null;
            boolean ok = true;
            for (int i = 0; i < want.length && ok; i++) {
                if (want[i].equals("<id>")) ident = got[i];
                else if (!want[i].equals(got[i])) ok = false;
            }
            if (ok) return new Object[] {r, ident};
        }
        return null;
    }

    private static boolean belongs(Library.Db db, String kind, long ident, long songId) {
        if (kind.equals("song")) return ident == songId;
        Map<String, Object> row;
        switch (kind) {
            case "artwork" -> row = db.one("SELECT song_id FROM artwork WHERE id = ?", ident);
            case "sheet" -> row = db.one("SELECT song_id FROM lyric_sheets WHERE id = ?", ident);
            case "preset" -> row = db.one("SELECT song_id FROM sound_presets WHERE id = ?", ident);
            case "version" -> row = db.one("SELECT song_id FROM versions WHERE id = ?", ident);
            case "vocal" -> row = db.tableExists("vocal_takes") ? db.one("SELECT song_id FROM vocal_takes WHERE id = ?", ident) : null;
            case "revision" -> row = db.one("SELECT s.song_id FROM lyric_revisions r JOIN lyric_sheets s ON s.id = r.sheet_id WHERE r.id = ?", ident);
            default -> { return false; }
        }
        return row != null && Accounts.num(row.get("song_id")) == songId;
    }

    /** A guest's request, run on the owner's song through the owner's own routes. */
    @RequestMapping("/api/shared/{share:\\d+}/on/**")
    public void proxy(HttpServletRequest req, HttpServletResponse res) throws Exception {
        long me = Api.acct(req);
        Matcher m = SHARED_ON.matcher(req.getRequestURI());
        if (!m.matches()) throw new ApiError("no such endpoint", 404);
        Map<String, Object> share = accounts.share(Long.parseLong(m.group(1)));
        if (share == null || Accounts.dbl(share.get("revoked_at")) != 0 || Accounts.num(share.get("to_account")) != me)
            throw new ApiError(NOT_OPEN, 404);
        songIn(share);
        String rest = "/api/" + m.group(2);
        if (!SAFE_PATH.matcher(rest).matches() || rest.contains(".."))
            throw new ApiError("That is not something a guest can do on a shared song.", 403);
        String method = req.getMethod();
        Object[] found = findGuestRoute(method, rest);
        if (found == null) throw new ApiError("That is not something a guest can do on a shared song.", 403);
        String[] route = (String[]) found[0];
        String kind = route[2], what = route[3];
        long owner = theirs(share);
        long songId = Accounts.num(share.get("song_id"));
        Library.Db db = library.of(owner);
        if (kind != null && !belongs(db, kind, id(found[1], "id"), songId)) throw new ApiError("That is not part of this share.", 404);

        String target = rest + (req.getQueryString() == null ? "" : "?" + req.getQueryString());
        req.setAttribute(Door.WHO, owner);
        req.setAttribute(Api.GUEST, me);
        if (what == null) {
            req.getRequestDispatcher(target).forward(req, res);
            return;
        }
        // A rename is a title and nothing else: the song's notes are the owner's own.
        if (route[1].equals("/api/songs/<id>") && method.equals("PATCH")) {
            for (String k : Body.json(req).keySet())
                if (!k.equals("title")) throw new ApiError("A guest can change the title and nothing else there.", 403);
        }
        Map<String, Object> before = GuestEdits.snapshot(db, songId);
        req.getRequestDispatcher(target).forward(req, res);
        if (res.getStatus() >= 400) return;
        Map<String, Object> touched = GuestEdits.difference(before, GuestEdits.snapshot(db, songId));
        if (GuestEdits.empty(touched)) return;
        double now = Accounts.now();
        String routeName = method + " " + route[1];
        Map<String, Object> last = db.one("SELECT * FROM guest_edits WHERE song_id = ? ORDER BY id DESC LIMIT 1", songId);
        if (last != null && Accounts.num(last.get("account")) == me && routeName.equals(last.get("route"))
                && Accounts.dbl(last.get("undone_at")) == 0 && now - Accounts.dbl(last.get("updated_at")) < GuestEdits.SITTING) {
            @SuppressWarnings("unchecked")
            Map<String, Object> merged = GuestEdits.merge(
                    (Map<String, Object>) JSON.readValue(String.valueOf(last.get("before")), Object.class), touched);
            db.run("UPDATE guest_edits SET updated_at = ?, before = ? WHERE id = ?", now, JSON.writeValueAsString(merged), last.get("id"));
        } else {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("song_id", songId);
            v.put("account", me);
            v.put("share_id", share.get("id"));
            v.put("what", what);
            v.put("route", routeName);
            v.put("before", JSON.writeValueAsString(touched));
            v.put("created_at", now);
            v.put("updated_at", now);
            db.insert("guest_edits", v);
        }
    }

    @GetMapping("/api/songs/{id}/edits")
    public Object songEdits(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        long song = id(id, "id");
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT id, account, what, created_at, updated_at, undone_at "
                + "FROM guest_edits WHERE song_id = ? ORDER BY id DESC LIMIT 200", song)) {
            Map<String, Object> person = accounts.pub(accounts.byId(Accounts.num(r.get("account"))));
            Map<String, Object> o = new LinkedHashMap<>(r);
            o.put("name", person == null ? "" : person.get("name"));
            o.put("handle", person == null ? "" : person.get("handle"));
            out.add(o);
        }
        return Map.of("edits", out);
    }

    @PostMapping("/api/guest-edits/{id}/undo")
    @SuppressWarnings("unchecked")
    public Object undoEdit(HttpServletRequest req, @PathVariable String id) throws Exception {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> edit = db.one("SELECT * FROM guest_edits WHERE id = ?", id(id, "id"));
        if (edit == null) throw new ApiError("No such change.", 404);
        GuestEdits.putBack(db, Accounts.num(edit.get("song_id")),
                (Map<String, Object>) JSON.readValue(String.valueOf(edit.get("before")), Object.class));
        db.run("UPDATE guest_edits SET undone_at = ? WHERE id = ?", Accounts.now(), edit.get("id"));
        return Map.of("undone", edit.get("id"));
    }

    // -- the sharer's side -------------------------------------------------------------------
    @GetMapping("/api/shares")
    public Object listShares(HttpServletRequest req) {
        long me = Api.acct(req);
        String song = req.getParameter("song");
        List<Map<String, Object>> rows = accounts.sharesFrom(me, song == null || song.isEmpty() ? null : id(song, "song"));
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> to = accounts.pub(accounts.byId(Accounts.num(row.get("to_account"))));
            Map<String, Object> o = new LinkedHashMap<>(row);
            o.put("to_handle", to == null ? "" : to.get("handle"));
            o.put("to_name", to == null ? "somebody" : to.get("name"));
            out.add(o);
        }
        List<Object> people = new ArrayList<>();
        for (Map<String, Object> a : accounts.everybody()) if (Accounts.num(a.get("id")) != me) people.add(accounts.pub(a));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("shares", out);
        body.put("people", people);
        return body;
    }

    @PostMapping("/api/shares")
    public Object makeShare(HttpServletRequest req) {
        long me = Api.acct(req);
        Map<String, Object> data = Body.json(req);
        if (data.get("song") == null) throw new ApiError("song is required");
        long songId = id(Body.need(data, "song"), "song");
        if (library.of(me).one("SELECT id, title FROM songs WHERE id = ?", songId) == null)
            throw new ApiError("no song with id " + songId, 404);
        Object asRaw = data.get("as_name");
        String asName = cut(asRaw == null ? "" : String.valueOf(asRaw), 60);
        Object h = data.get("handle");
        String handle = h == null ? "" : String.valueOf(h).strip();
        if (handle.isEmpty()) {
            Object[] made = accounts.makeShareLink(me, songId, asName);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("share", made[0]);
            out.put("token", made[1]);
            out.put("path", "/#/join/" + made[1]);
            out.put("note", "This is the only time the link is shown.");
            return out;
        }
        Map<String, Object> them = accounts.byHandle(handle);
        if (them == null) throw new ApiError("Nobody on this library has the handle " + handle + ".", 404);
        if (Accounts.num(them.get("id")) == me) throw new ApiError("That song is already yours.", 400);
        Map<String, Object> held = accounts.shareBetween(me, songId, Accounts.num(them.get("id")));
        if (held != null && Accounts.dbl(held.get("revoked_at")) == 0) {
            Object n = them.get("name");
            throw new ApiError((n == null || String.valueOf(n).isEmpty() ? handle : String.valueOf(n)) + " already has this song.", 409);
        }
        long made = accounts.addShare(me, songId, Accounts.num(them.get("id")), asName, "");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("share", made);
        out.put("to", accounts.pub(them));
        return out;
    }

    // -- a link, and whoever opens it (no session needed) --------------------------------
    private Map<String, Object> byToken(String token) {
        String t = token == null ? "" : token.strip();
        Map<String, Object> share = t.isEmpty() ? null : accounts.shareByToken(t);
        if (share == null) throw new ApiError(LINK_CLOSED, 404);
        return share;
    }

    @GetMapping("/api/shares/invitation/{token}")
    public Object invitation(HttpServletRequest req, @PathVariable String token) {
        Map<String, Object> share = byToken(token);
        Map<String, Object> song = songIn(share);
        Map<String, Object> from = accounts.pub(accounts.byId(theirs(share)));
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("title", song.get("title"));
        out.put("song", s);
        out.put("from", from == null ? "somebody" : from.get("name"));
        out.put("as_name", share.get("as_name"));
        out.put("signed_in", Door.who(req) != null);
        return out;
    }

    @PostMapping("/api/shares/invitation/{token}")
    public ResponseEntity<Object> accept(HttpServletRequest req, @PathVariable String token) {
        Map<String, Object> share = byToken(token);
        Map<String, Object> data = Body.json(req);
        Long me = Door.who(req);
        String session = null;
        if (me == null) {
            Object h = data.get("handle");
            String handle = h == null ? "" : String.valueOf(h).strip();
            if (handle.isEmpty()) throw new ApiError("Pick a handle so the song has somebody to belong to.", 400);
            Object p = data.get("password"), n = data.get("name");
            Object[] made = authController.signUpForShare(req, handle, p == null ? "" : String.valueOf(p),
                    n == null ? "" : String.valueOf(n).strip());
            me = (Long) made[0];
            session = (String) made[1];
        }
        if (theirs(share) == me) throw new ApiError("That song is already yours.", 400);
        if (!accounts.claimShare(Accounts.num(share.get("id")), me)) throw new ApiError(LINK_CLOSED, 404);
        Map<String, Object> body = Map.of("share", share.get("id"));
        return session == null ? AuthController.json(body) : AuthController.json(body, session);
    }

    @DeleteMapping("/api/shares/{id}")
    public Object revoke(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        Map<String, Object> share = share(id, me);
        if (theirs(share) != me) throw new ApiError("Only the person who shared a song can take it back.", 403);
        accounts.revokeShare(Accounts.num(share.get("id")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("revoked", share.get("id"));
        out.put("note", "Their own copies stay theirs.");
        return out;
    }
}
