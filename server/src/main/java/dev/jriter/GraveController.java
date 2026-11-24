package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** The grave's routes: a port of the ROUTES of jriter/modules/grave.py. */
@RestController
public class GraveController {
    private final Library library;
    private final Grave grave;

    public GraveController(Library library, Grave grave) {
        this.library = library;
        this.grave = grave;
    }

    private static Map<String, Object> get(Library.Db db, String id) {
        Map<String, Object> row = null;
        try {
            row = db.one("SELECT * FROM grave WHERE id = ?", Long.parseLong(id.strip()));
        } catch (NumberFormatException e) {
            // falls through to the 404
        }
        if (row == null) throw new ApiError("That's not in the grave any more.", 404);
        return row;
    }

    @GetMapping("/api/grave")
    public Object listing(HttpServletRequest req) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        grave.forgetOld(db, acct);
        List<Map<String, Object>> rows = db.query("SELECT id, kind, title, deleted_at FROM grave ORDER BY deleted_at DESC");
        for (Map<String, Object> r : rows) {
            r.put("kind_said", Grave.KIND_SAID.getOrDefault((String) r.get("kind"), (String) r.get("kind")));
            r.put("goes_at", Accounts.dbl(r.get("deleted_at")) + Grave.KEEP_DAYS * 86400);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", rows);
        out.put("keep_days", Grave.KEEP_DAYS);
        return out;
    }

    @PostMapping("/api/grave/{id}/restore")
    public Object bringBack(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> row = get(db, id);
        int back = grave.restore(db, (String) row.get("tables"));
        db.run("DELETE FROM grave WHERE id = ?", row.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("restored", row.get("kind"));
        out.put("title", row.get("title"));
        out.put("rows", back);
        return out;
    }

    @DeleteMapping("/api/grave/{id}")
    public Object forget(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> row = get(db, id);
        grave.leave(db, acct, "id = ?", row.get("id"));
        return Map.of("forgotten", row.get("id"));
    }

    @DeleteMapping("/api/grave")
    public Object empty(HttpServletRequest req) {
        long acct = Api.acct(req);
        return Map.of("forgotten", grave.leave(library.of(acct), acct, "1"));
    }
}
