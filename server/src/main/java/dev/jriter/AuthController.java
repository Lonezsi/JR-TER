package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Every route in jriter/modules/auth.py ROUTES(), same paths, bodies, statuses, messages. */
@RestController
public class AuthController {
    private static final String SIGN_IN_FIRST = "Sign in first.";
    private final Auth auth;
    private final Accounts accounts;
    private final Config config;

    public AuthController(Auth auth, Accounts accounts, Config config) {
        this.auth = auth;
        this.accounts = accounts;
        this.config = config;
    }

    // -- helpers -------------------------------------------------------------------
    static ResponseEntity<Object> json(Object body) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }

    static ResponseEntity<Object> json(Object body, String setCookie) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.SET_COOKIE, setCookie).body(body);
    }

    String cookie(HttpServletRequest req, String value, int days) {
        boolean https = "https".equalsIgnoreCase(req.getHeader("X-Forwarded-Proto"));
        return Auth.COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax;"
                + (https ? " Secure;" : "") + " Max-Age=" + (days * 86400);
    }

    String ip(HttpServletRequest req) { return Auth.who(req.getRemoteAddr(), req.getHeader("X-Forwarded-For")); }

    long here(HttpServletRequest req) {
        Long who = auth.accountFor(req.getHeader("Cookie"));
        if (who == null) throw new ApiError(SIGN_IN_FIRST, 401);
        return who;
    }

    long owner(HttpServletRequest req) {
        Long who = auth.accountFor(req.getHeader("Cookie"));
        if (who == null || who != Accounts.OWNER)
            throw new ApiError("Only the owner of this library hands out invites.", 403);
        return who;
    }

    /** The account the door let in: a session, Foyer, or a token. */
    long bound(HttpServletRequest req) {
        Long who = Door.who(req);
        if (who == null) throw new ApiError("Sign in to use this library.", 401);
        return who;
    }

    private void waitOr429(String ip) {
        int wait = auth.waitFor(ip);
        if (wait > 0) throw new ApiError("Too many attempts. Try again in " + wait + " seconds.", 429);
    }

    // -- state ---------------------------------------------------------------------
    @GetMapping("/api/auth/state")
    public Object state(HttpServletRequest req) {
        Long here = auth.accountFor(req.getHeader("Cookie"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("has_password", accounts.count() > 0 || auth.hasPassword());
        out.put("signed_in", here != null);
        out.put("who", here == null ? null : accounts.pub(accounts.byId(here)));
        out.put("can_sign_up", accounts.count() > 0);
        out.put("locked_for", auth.waitFor(ip(req)));
        // shortcut: appearance is not ported yet, so no custom font is ever reported.
        out.put("custom_font", false);
        out.put("foyer", foyerState(req).get("foyer"));
        out.put("foyer_tied", here != null && accounts.foyerOf(here) != null);
        if (here != null && accounts.foyerOf(here) != null) {
            Map<String, Object> f = auth.foyer(req.getHeader("Cookie"));
            if (f != null && accounts.foyerOf(here).equals(f.get("id")))
                accounts.foyerSeenAs((String) f.get("id"), (String) f.get("handle"));
        }
        out.put("foyer_tied_as", here == null ? null : accounts.foyerHandleOf(here));
        return out;
    }

    Map<String, Object> foyerState(HttpServletRequest req) {
        Map<String, Object> f = auth.foyer(req.getHeader("Cookie"));
        Map<String, Object> out = new LinkedHashMap<>();
        if (f == null) {
            out.put("foyer", null);
            return out;
        }
        Long here = auth.foyerLibrary(f);
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("handle", f.get("handle"));
        inner.put("linked", here != null);
        Map<String, Object> a = here == null ? null : accounts.byId(here);
        inner.put("handle_here", here != null && a != null ? a.get("handle") : null);
        inner.put("can_make", here == null && Boolean.TRUE.equals(f.get("ownerFriend")));
        out.put("foyer", inner);
        return out;
    }

    // -- the first account, signing up, signing in -----------------------------------
    @PostMapping("/api/auth/setup")
    public ResponseEntity<Object> setup(HttpServletRequest req) {
        if (accounts.count() > 0) throw new ApiError("This library already has an owner.", 409);
        Map<String, Object> data = Body.json(req);
        String code = auth.setupCode();
        String given = Body.str(data, "code").strip();
        if (given.isEmpty() || !Auth.same(given, code == null ? "" : code)) {
            auth.noteFailure(ip(req));
            throw new ApiError("That setup code is not right.", 403);
        }
        Map<String, Object> made = accounts.create("owner", Body.str(data, "password"),
                Body.str(data, "name").strip(), Accounts.OWNER);
        auth.spendSetupCode();
        auth.clear(ip(req));
        return json(Map.of("ok", true), cookie(req, auth.issue(Accounts.num(made.get("id"))), Auth.SESSION_DAYS));
    }

    @PostMapping("/api/auth/signup")
    public ResponseEntity<Object> signUp(HttpServletRequest req) {
        String ip = ip(req);
        waitOr429(ip);
        if (accounts.count() == 0) throw new ApiError("This library has no owner yet.", 409);
        Map<String, Object> data = Body.json(req);
        if (Boolean.TRUE.equals(data.get("foyer"))) return foyerNew(req);
        Map<String, Object> invite = accounts.inviteFor(Body.str(data, "code").strip());
        if (invite == null) {
            auth.noteFailure(ip);
            throw new ApiError("That invite is not one this library gave out, or it has been used already.", 403);
        }
        Map<String, Object> made = accounts.create(Body.str(data, "handle"), Body.str(data, "password"),
                Body.str(data, "name").strip(), null);
        accounts.spendInvite(Accounts.num(invite.get("id")), Accounts.num(made.get("id")));
        auth.clear(ip);
        return json(Map.of("ok", true), cookie(req, auth.issue(Accounts.num(made.get("id"))), Auth.SESSION_DAYS));
    }

    /** An account made by opening a share link: {account id, Set-Cookie value} (auth.sign_up_for_share). */
    Object[] signUpForShare(HttpServletRequest req, String handle, String password, String name) {
        String ip = ip(req);
        waitOr429(ip);
        if (accounts.count() == 0) throw new ApiError("This library has no owner yet.", 409);
        Map<String, Object> made = accounts.create(handle, password == null ? "" : password, name, null);
        auth.clear(ip);
        long id = Accounts.num(made.get("id"));
        return new Object[] {id, cookie(req, auth.issue(id), Auth.SESSION_DAYS)};
    }

    ResponseEntity<Object> foyerNew(HttpServletRequest req) {
        Map<String, Object> f = auth.foyer(req.getHeader("Cookie"));
        if (f == null) throw new ApiError("Sign in on Foyer first.", 401);
        if (auth.foyerLibrary(f) != null) throw new ApiError("Your Foyer account already opens a library here.", 409);
        if (!Boolean.TRUE.equals(f.get("ownerFriend")))
            throw new ApiError("A library here is for friends of whoever runs this machine. Ask them "
                    + "to add you on Foyer.", 403);
        if (accounts.count() == 0) throw new ApiError("This library has no owner yet.", 409);
        Map<String, Object> made = accounts.create(accounts.freeHandle((String) f.get("handle")),
                java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(Accounts.randomBytes(24)),
                f.get("name") == null ? "" : String.valueOf(f.get("name")).strip(), null);
        accounts.linkFoyer((String) f.get("id"), (String) f.get("handle"), Accounts.num(made.get("id")));
        return json(Map.of("ok", true, "handle", made.get("handle")));
    }

    @PostMapping("/api/auth/login")
    public ResponseEntity<Object> login(HttpServletRequest req) {
        String ip = ip(req);
        waitOr429(ip);
        if (accounts.count() == 0) throw new ApiError("No account has been made on this library yet.", 409);
        Map<String, Object> data = Body.json(req);
        String handle = Body.str(data, "handle").strip();
        Map<String, Object> account = !handle.isEmpty() ? accounts.byHandle(handle) : accounts.owner();
        if (!accounts.check(account, Body.str(data, "password"))) {
            auth.noteFailure(ip);
            int again = auth.waitFor(ip);
            throw new ApiError("That is not right." + (again > 0 ? " Too many attempts, wait " + again + " seconds." : ""), 401);
        }
        auth.clear(ip);
        long id = Accounts.num(account.get("id"));
        accounts.seen(id);
        // A password proves this library, not whose Foyer is in this browser. Tying is
        // Settings > Connect to Foyer only (CONDOM 3).
        return json(Map.of("ok", true), cookie(req, auth.issue(id), Auth.SESSION_DAYS));
    }

    @PostMapping("/api/auth/logout")
    public ResponseEntity<Object> logout() {
        return json(Map.of("ok", true), Auth.COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    }

    @PostMapping("/api/auth/password")
    public ResponseEntity<Object> change(HttpServletRequest req) {
        long here = here(req);
        Map<String, Object> data = Body.json(req);
        if (!accounts.check(accounts.byId(here), Body.str(data, "current"))) {
            auth.noteFailure(ip(req));
            throw new ApiError("That is not the current password.", 401);
        }
        accounts.setPassword(here, Body.str(data, "new"));
        boolean wasTied = accounts.foyerOf(here) != null;
        accounts.signOutEverywhere(here);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        if (wasTied) body.put("foyer_untied", true);
        body.put("signed_out", true);
        return json(body, cookie(req, auth.issue(here), Auth.SESSION_DAYS));
    }

    /** Every device signed out, this one too, and the Foyer tie dropped. */
    @PostMapping("/api/auth/everywhere")
    public ResponseEntity<Object> everywhere(HttpServletRequest req) {
        accounts.signOutEverywhere(here(req));
        return json(Map.of("ok", true), Auth.COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    }

    // -- invites -------------------------------------------------------------------
    @GetMapping("/api/auth/invites")
    public Object listInvites(HttpServletRequest req) {
        long here = owner(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("invites", accounts.invitesBy(here));
        out.put("accounts", accounts.everybody().stream().map(accounts::pub).collect(Collectors.toList()));
        return out;
    }

    @PostMapping("/api/auth/invites")
    public Object createInvite(HttpServletRequest req) {
        long here = owner(req);
        Map<String, Object> data = Body.json(req);
        String code = accounts.makeInvite(here, Body.str(data, "note"), asDays(data.get("days")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("note", "This is the only time it is shown. Send it to whoever it is for.");
        return out;
    }

    static int asDays(Object value) {
        try {
            int days = value instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(value).strip());
            return Math.max(0, Math.min(365, days));
        } catch (NumberFormatException e) {
            return 14;
        }
    }

    @DeleteMapping("/api/auth/invites/{id}")
    public Object revokeInvite(HttpServletRequest req, @PathVariable String id) {
        long here = owner(req);
        accounts.dropInvite(id, here);
        return Map.of("revoked", id);
    }

    // -- who -----------------------------------------------------------------------
    @GetMapping("/api/auth/me")
    public Object me(HttpServletRequest req) {
        return Map.of("who", accounts.pub(accounts.byId(here(req))));
    }

    @GetMapping("/api/auth/people")
    public Object people(HttpServletRequest req) {
        long here = here(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("people", accounts.everybody().stream().map(accounts::pub).collect(Collectors.toList()));
        out.put("me", here);
        out.put("owner", Accounts.OWNER);
        return out;
    }

    @PatchMapping("/api/auth/me")
    public Object renameMe(HttpServletRequest req) {
        long here = here(req);
        return Map.of("who", accounts.pub(accounts.rename(here, Body.need(Body.json(req), "name"))));
    }

    // -- machine tokens ------------------------------------------------------------
    @GetMapping("/api/auth/tokens")
    public Object listTokens(HttpServletRequest req) {
        return Map.of("tokens", accounts.tokensOf(bound(req)));
    }

    @PostMapping("/api/auth/tokens")
    public Object createToken(HttpServletRequest req) {
        long who = bound(req);
        Map<String, Object> data = Body.json(req);
        String scope = Body.str(data, "scope").strip();
        String raw = auth.makeToken(Body.str(data, "name"), scope.isEmpty() ? "upload" : scope, who);
        return Map.of("token", raw, "note", "This is the only time it is shown.");
    }

    @DeleteMapping("/api/auth/tokens/{id}")
    public Object revokeToken(HttpServletRequest req, @PathVariable String id) {
        accounts.dropToken(id, bound(req));
        return Map.of("revoked", id);
    }

    // -- Foyer ---------------------------------------------------------------------
    @PostMapping("/api/auth/foyer/connect")
    public Object foyerConnect(HttpServletRequest req) {
        long here = here(req);
        Map<String, Object> f = auth.foyer(req.getHeader("Cookie"));
        if (f == null) throw new ApiError("Sign in on Foyer first, then press this again.", 409);
        accounts.linkFoyer((String) f.get("id"), (String) f.get("handle"), here);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("foyer", f.get("handle"));
        return out;
    }

    @PostMapping("/api/auth/foyer/disconnect")
    public Object foyerDisconnect(HttpServletRequest req) {
        accounts.unlinkFoyer(here(req));
        return Map.of("ok", true);
    }
}
