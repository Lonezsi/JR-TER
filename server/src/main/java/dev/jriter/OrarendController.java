package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The timetable, a port of jriter/modules/orarend.py (read its docstring for why it is here and
 * why the data is not in the repo). The week is the OWNER's orarend.json, read by the owner and the
 * owner's Foyer friends (CONDOM legal 3) and written only by the owner; notes, pages and absences are each account's own, in its library.
 *
 * shortcut: a week file that does not parse says what Jackson says, not Python's wording.
 */
@RestController
public class OrarendController {
    static final int ABSENCES = 3, FROM = 8, TO = 22, HOUR = 60;
    static final List<String> FIELDS = List.of("day", "at", "to", "kind", "whose", "name", "where", "skip",
            "code", "group", "teacher");
    static final List<String> KINDS = List.of("ea", "gy", "both", "konz", "band");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Library library;
    private final Config config;
    private final Accounts accounts;
    private final Auth auth;

    public OrarendController(Library library, Config config, Accounts accounts, Auth auth) {
        this.library = library;
        this.config = config;
        this.accounts = accounts;
        this.auth = auth;
    }

    // -- the file ---------------------------------------------------------------------

    private Path path() { return config.home(Accounts.OWNER).resolve("orarend.json"); }

    private String ownerName() {
        Map<String, Object> a = accounts.byId(Accounts.OWNER);
        if (a == null) return "";
        return truthy(a.get("name")) ? String.valueOf(a.get("name")) : String.valueOf(a.get("handle"));
    }

    private void onlyTheOwner(long me) {
        if (me != Accounts.OWNER) {
            String who = ownerName();
            throw new ApiError("Ezt az órarendet csak " + (who.isEmpty() ? "a tulajdonosa" : who) + " szerkesztheti.", 403);
        }
    }

    /** Who may read the week: the owner, or the owner's Foyer friend whose Foyer account, signed in in
     *  this browser, is the one tied to this library (CONDOM legal 3). */
    boolean mayRead(long me, String cookieHeader) {
        if (me == Accounts.OWNER) return true;
        String tied = accounts.foyerOf(me);
        if (tied == null) return false;
        Map<String, Object> f = auth.foyer(cookieHeader);
        return f != null && tied.equals(f.get("id")) && Boolean.TRUE.equals(f.get("ownerFriend"));
    }

    /** The week as it is on disk: null when absent, {"broken": why} when it will not parse. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> read() {
        String text;
        try {
            text = Files.readString(path(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
        try {
            Object found = JSON.readValue(text, Object.class);
            if (found instanceof List) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("classes", found);
                return m;
            }
            if (found instanceof Map) return (Map<String, Object>) found;
            return broken("the week should be a list or an object");
        } catch (IOException e) {
            return broken(e.getMessage());
        }
    }

    /** What /api/state says: nothing when there is no week. */
    Map<String, Object> summary() {
        Map<String, Object> found = read();
        Map<String, Object> out = new LinkedHashMap<>();
        if (found == null || found.get("broken") != null) return out;
        Object c = found.get("classes");
        out.put("classes", c instanceof List<?> l ? l.size() : 0);
        return out;
    }

    private static Map<String, Object> broken(String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("broken", why == null ? "unreadable" : why);
        return m;
    }

    /** json.dump(found, ensure_ascii=False, indent=2), so the file stays as Python writes it. */
    static void dump(Object v, StringBuilder out, int depth) {
        String pad = "  ".repeat(depth + 1), end = "  ".repeat(depth);
        if (v == null) out.append("null");
        else if (v instanceof Boolean b) out.append(b ? "true" : "false");
        else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            out.append(d == Math.rint(d) && Math.abs(d) < 1e16 ? String.format("%.1f", d) : Double.toString(d).replace("E", "e"));
        } else if (v instanceof Number n) out.append(n);
        else if (v instanceof String s) {
            out.append('"');
            for (char c : s.toCharArray()) {
                switch (c) {
                    case '"' -> out.append("\\\"");
                    case '\\' -> out.append("\\\\");
                    case '\n' -> out.append("\\n");
                    case '\r' -> out.append("\\r");
                    case '\t' -> out.append("\\t");
                    case '\b' -> out.append("\\b");
                    case '\f' -> out.append("\\f");
                    default -> { if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c); }
                }
            }
            out.append('"');
        } else if (v instanceof List<?> l) {
            if (l.isEmpty()) { out.append("[]"); return; }
            out.append("[\n");
            for (int i = 0; i < l.size(); i++) {
                out.append(pad);
                dump(l.get(i), out, depth + 1);
                out.append(i + 1 < l.size() ? ",\n" : "\n");
            }
            out.append(end).append("]");
        } else if (v instanceof Map<?, ?> m) {
            if (m.isEmpty()) { out.append("{}"); return; }
            out.append("{\n");
            int i = 0;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                out.append(pad);
                dump(String.valueOf(e.getKey()), out, depth + 1);
                out.append(": ");
                dump(e.getValue(), out, depth + 1);
                out.append(++i < m.size() ? ",\n" : "\n");
            }
            out.append(end).append("}");
        } else dump(String.valueOf(v), out, depth);
    }

    /** The week back to disk whole, beside itself and moved into place. */
    private void save(Map<String, Object> found) {
        Path where = path();
        Path beside = where.resolveSibling("orarend.json.writing");
        StringBuilder sb = new StringBuilder();
        dump(found, sb, 0);
        try {
            config.ensureHome(Accounts.OWNER);
            Files.writeString(beside, sb.toString(), StandardCharsets.UTF_8);
            Files.move(beside, where, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new ApiError("the week could not be written: " + e.getMessage(), 500);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> weekNow() {
        Map<String, Object> found = read();
        if (found == null) found = new LinkedHashMap<>();
        if (found.get("broken") != null)
            throw new ApiError("orarend.json cannot be read, so it is not being written over: " + found.get("broken"), 409);
        Object c = found.get("classes");
        if (!(c instanceof List)) found.put("classes", new ArrayList<Object>());
        else found.put("classes", new ArrayList<Object>((List<Object>) c));
        return found;
    }

    // -- small Python-isms ------------------------------------------------------------

    static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof Boolean b) return b;
        if (o instanceof Number n) return n.doubleValue() != 0;
        if (o instanceof String s) return !s.isEmpty();
        if (o instanceof List<?> l) return !l.isEmpty();
        if (o instanceof Map<?, ?> m) return !m.isEmpty();
        return true;
    }

    /** Python's str(). */
    static String pyStr(Object o) {
        if (o == null) return "None";
        if (o instanceof Boolean b) return b ? "True" : "False";
        if (o instanceof Double d && d == Math.rint(d) && Math.abs(d) < 1e16) return String.format("%.1f", d);
        return String.valueOf(o);
    }

    /** Python's repr() for the few shapes a time field can be. */
    private static String pyRepr(Object o) {
        return o instanceof String s ? "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'" : pyStr(o);
    }

    /** wire.as_int: int(value), with a minimum. */
    static long asInt(Object value, String field, Long minimum) {
        long n;
        if (value instanceof Number x) n = x.longValue();
        else if (value instanceof Boolean b) n = b ? 1 : 0;
        else if (value instanceof String s) {
            try {
                n = Long.parseLong(s.strip());
            } catch (NumberFormatException e) {
                throw new ApiError(field + " must be a whole number");
            }
        } else throw new ApiError(field + " must be a whole number");
        if (minimum != null && n < minimum) throw new ApiError(field + " must be at least " + minimum);
        return n;
    }

    // -- the week ---------------------------------------------------------------------

    private Map<String, Object> scale(Map<String, Object> out, Map<String, Object> found) {
        out.put("from", found == null ? FROM : found.getOrDefault("from", FROM));
        out.put("to", found == null ? TO : found.getOrDefault("to", TO));
        out.put("hour", found == null ? HOUR : found.getOrDefault("hour", HOUR));
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> week(long me) {
        Map<String, Object> found = read();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("readonly", me != Accounts.OWNER);
        out.put("owner", ownerName());
        if (found == null) {
            out.put("classes", new ArrayList<>());
            out.put("missing", true);
            out.put("where", "orarend.json");
            return scale(out, null);
        }
        if (found.get("broken") != null) {
            out.put("classes", new ArrayList<>());
            out.put("broken", found.get("broken"));
            out.put("where", "orarend.json");
            return scale(out, null);
        }
        List<Object> keyed = new ArrayList<>();
        Object c = found.get("classes");
        List<Object> list = truthy(c) ? (List<Object>) c : new ArrayList<>();
        for (int at = 0; at < list.size(); at++) {
            Map<String, Object> said = new LinkedHashMap<>((Map<String, Object>) list.get(at));
            Object id = said.get("id");
            said.put("key", truthy(id) ? pyStr(id instanceof Number n && !(id instanceof Double) ? (Object) n.longValue() : id) : "i:" + at);
            keyed.add(said);
        }
        out.put("classes", keyed);
        return scale(out, found);
    }

    @GetMapping("/api/orarend")
    public Object week(HttpServletRequest req) {
        long me = Api.acct(req);
        if (!mayRead(me, req.getHeader("Cookie"))) {
            String who = ownerName();
            throw new ApiError("Az órarendet csak " + (who.isEmpty() ? "a tulajdonosa" : who) + " és a Foyer-barátai láthatják. Ha az vagy, jelentkezz be a Foyeren, és kösd össze a fiókodat a Beállításokban.", 403);
        }
        return week(me);
    }

    // -- writing the week -------------------------------------------------------------

    private static long clock(Object said, String what) {
        String[] parts = (truthy(said) ? pyStr(said) : "").split(":", -1);
        long hour, minute;
        try {
            if (parts.length != 2) throw new NumberFormatException();
            hour = Long.parseLong(parts[0].strip());
            minute = Long.parseLong(parts[1].strip());
        } catch (NumberFormatException e) {
            throw new ApiError(what + " should be a time like 09:30, not " + pyRepr(said));
        }
        if (!(0 <= hour && hour <= 23 && 0 <= minute && minute <= 59))
            throw new ApiError(what + " is not a time of day: " + pyRepr(said));
        return hour * 60 + minute;
    }

    private static String clip(Object v, int max) {
        String s = truthy(v) ? pyStr(v).strip() : "";
        return s.length() > max ? s.substring(0, max) : s;
    }

    /** One class, checked, as it will be written. */
    private static Map<String, Object> entry(Map<String, Object> sent, Map<String, Object> onto) {
        Map<String, Object> made = new LinkedHashMap<>(onto == null ? Map.of() : onto);
        for (String f : FIELDS) if (sent.containsKey(f)) made.put(f, sent.get(f));
        made.put("day", asInt(made.get("day"), "day", 0L));
        if (((Number) made.get("day")).longValue() > 4) throw new ApiError("the week has five days, so day is 0 to 4");
        long starts = clock(made.get("at"), "at"), ends = clock(made.get("to"), "to");
        if (ends <= starts) throw new ApiError("a class cannot finish before it starts");
        String kind = truthy(made.get("kind")) ? pyStr(made.get("kind")).strip() : "gy";
        made.put("kind", kind);
        if (!KINDS.contains(kind)) throw new ApiError("kind is one of " + String.join(", ", KINDS));
        String name = clip(made.get("name"), 200);
        made.put("name", name);
        if (name.isEmpty()) throw new ApiError("a class needs a name");
        String whose = truthy(made.get("whose")) ? pyStr(made.get("whose")).strip() : "me";
        if (whose.length() > 100) whose = whose.substring(0, 100);
        made.put("whose", whose.isEmpty() ? "me" : whose);
        for (String f : new String[] {"where", "code", "group", "teacher"}) made.put(f, clip(made.get(f), 200));
        made.put("skip", truthy(made.get("skip")));
        return made;
    }

    /** Which class a call is about (an id, or i:N for one typed in by hand) and where it sits. */
    @SuppressWarnings("unchecked")
    private static int find(List<Object> classes, String said) {
        if (said.startsWith("i:")) {
            long at = asInt(said.substring(2), "id", 0L);
            if (at >= classes.size()) throw new ApiError("there is no class at " + said + " any more", 404);
            if (truthy(((Map<String, Object>) classes.get((int) at)).get("id")))
                throw new ApiError("the week has moved under this edit; open it again", 409);
            return (int) at;
        }
        long wanted = asInt(said, "id", null);
        for (int at = 0; at < classes.size(); at++) {
            Object id = ((Map<String, Object>) classes.get(at)).get("id");
            if (id instanceof Number n && n.longValue() == wanted) return at;
        }
        throw new ApiError("no class with id " + wanted, 404);
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/api/orarend/classes")
    public Object addClass(HttpServletRequest req) {
        long me = Api.acct(req);
        onlyTheOwner(me);
        Map<String, Object> sent = Body.json(req);
        Body.need(sent, "name");
        Body.need(sent, "at");
        Body.need(sent, "to");
        Map<String, Object> found = weekNow();
        Map<String, Object> made = entry(sent, null);
        List<Object> classes = (List<Object>) found.get("classes");
        java.util.Set<Long> taken = new java.util.HashSet<>();
        for (Object e : classes) if (((Map<String, Object>) e).get("id") instanceof Number n) taken.add(n.longValue());
        long id = System.currentTimeMillis();
        while (taken.contains(id)) id++;
        made.put("id", id);
        classes.add(made);
        save(found);
        return week(me);
    }

    @SuppressWarnings("unchecked")
    @PutMapping("/api/orarend/classes/{id}")
    public Object saveClass(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        onlyTheOwner(me);
        Map<String, Object> found = weekNow();
        List<Object> classes = (List<Object>) found.get("classes");
        int at = find(classes, id);
        Map<String, Object> old = (Map<String, Object>) classes.get(at);
        Map<String, Object> made = entry(Body.json(req), old);
        made.put("id", truthy(old.get("id")) ? old.get("id") : (Object) System.currentTimeMillis());
        classes.set(at, made);
        save(found);
        return week(me);
    }

    @SuppressWarnings("unchecked")
    @DeleteMapping("/api/orarend/classes/{id}")
    public Object dropClass(HttpServletRequest req, @PathVariable String id) {
        long me = Api.acct(req);
        onlyTheOwner(me);
        Map<String, Object> found = weekNow();
        List<Object> classes = (List<Object>) found.get("classes");
        classes.remove(find(classes, id));
        save(found);
        return week(me);
    }

    // -- notes, and how many times I was not there ------------------------------------

    private static String subject(HttpServletRequest req) {
        String q = req.getParameter("subject");
        String name = truthy(q) ? q : "";
        if (name.isEmpty()) {
            Object s = Body.json(req).get("subject");
            name = truthy(s) ? pyStr(s) : "";
        }
        name = name.strip();
        if (name.isEmpty()) throw new ApiError("which subject?");
        return name.length() > 200 ? name.substring(0, 200) : name;
    }

    private static Map<String, Object> note(Library.Db db, String subject, boolean make) {
        Map<String, Object> row = db.one("SELECT * FROM orarend_notes WHERE subject = ?", subject);
        if (row != null || !make) return row;
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("subject", subject);
        v.put("absences", 0);
        v.put("created_at", now);
        v.put("updated_at", now);
        db.insert("orarend_notes", v);
        return db.one("SELECT * FROM orarend_notes WHERE subject = ?", subject);
    }

    private static List<Map<String, Object>> pages(Library.Db db, Object noteId) {
        return db.query("SELECT id, position, text, updated_at FROM orarend_pages WHERE note_id = ? ORDER BY position, id", noteId);
    }

    private static Map<String, Object> out(Library.Db db, String subject, Map<String, Object> row) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("subject", subject);
        o.put("absences", row == null ? 0 : row.get("absences"));
        o.put("allowed", ABSENCES);
        o.put("pages", row == null ? new ArrayList<>() : pages(db, row.get("id")));
        return o;
    }

    @GetMapping("/api/orarend/notes")
    public Object notes(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String subject = subject(req);
        return out(db, subject, note(db, subject, false));
    }

    @PutMapping("/api/orarend/notes")
    public Object setAbsences(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String subject = subject(req);
        long want = Math.min(asInt(Body.json(req).get("absences"), "absences", 0L), ABSENCES);
        Map<String, Object> row = note(db, subject, true);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("absences", want);
        p.put("updated_at", Accounts.now());
        db.update("orarend_notes", Accounts.num(row.get("id")), p);
        return out(db, subject, note(db, subject, false));
    }

    private static String textOf(HttpServletRequest req) {
        Object t = Body.json(req).get("text");
        return truthy(t) ? String.valueOf(t) : "";
    }

    @PostMapping("/api/orarend/notes/pages")
    public Object addPage(HttpServletRequest req) {
        Library.Db db = library.of(Api.acct(req));
        String subject = subject(req);
        Map<String, Object> row = note(db, subject, true);
        double now = Accounts.now();
        List<Map<String, Object>> held = pages(db, row.get("id"));
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("note_id", row.get("id"));
        v.put("position", held.isEmpty() ? 0 : Accounts.num(held.get(held.size() - 1).get("position")) + 1);
        v.put("text", textOf(req));
        v.put("created_at", now);
        v.put("updated_at", now);
        db.insert("orarend_pages", v);
        db.update("orarend_notes", Accounts.num(row.get("id")), Map.of("updated_at", now));
        return out(db, subject, note(db, subject, false));
    }

    private static Map<String, Object>[] pageIn(Library.Db db, long pageId) {
        Map<String, Object> page = db.one("SELECT * FROM orarend_pages WHERE id = ?", pageId);
        Map<String, Object> note = page == null ? null : db.one("SELECT * FROM orarend_notes WHERE id = ?", page.get("note_id"));
        if (page == null || note == null) throw new ApiError("no page with id " + pageId, 404);
        @SuppressWarnings("unchecked")
        Map<String, Object>[] both = new Map[] {page, note};
        return both;
    }

    @PutMapping("/api/orarend/notes/pages/{id}")
    public Object savePage(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object>[] pn = pageIn(db, asInt(id, "id", null));
        double now = Accounts.now();
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("text", textOf(req));
        p.put("updated_at", now);
        db.update("orarend_pages", Accounts.num(pn[0].get("id")), p);
        db.update("orarend_notes", Accounts.num(pn[1].get("id")), Map.of("updated_at", now));
        return out(db, (String) pn[1].get("subject"), pn[1]);
    }

    @DeleteMapping("/api/orarend/notes/pages/{id}")
    public Object dropPage(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object>[] pn = pageIn(db, asInt(id, "id", null));
        db.run("DELETE FROM orarend_pages WHERE id = ?", pn[0].get("id"));
        db.update("orarend_notes", Accounts.num(pn[1].get("id")), Map.of("updated_at", Accounts.now()));
        return out(db, (String) pn[1].get("subject"), db.one("SELECT * FROM orarend_notes WHERE id = ?", pn[1].get("id")));
    }
}
