package dev.jriter;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import javax.sql.DataSource;
import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Component;
import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteDataSource;

/**
 * Who exists: a port of jriter/accounts.py over the same data/accounts.db, same tables,
 * same digests, same scrypt, so the Python server and this one can share the file.
 */
@Component
public class Accounts {
    public static final long OWNER = 1;
    static final String HANDLE_OK = "abcdefghijklmnopqrstuvwxyz0123456789-_.";
    static final int HANDLE_MAX = 32;
    public static final long NOBODY_YET = 0;
    private static final SecureRandom RNG = new SecureRandom();

    private static final String[] SCHEMA = {
        "CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, handle TEXT NOT NULL UNIQUE,"
            + " name TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL, hash TEXT NOT NULL,"
            + " created_at REAL NOT NULL, last_seen REAL NOT NULL DEFAULT 0,"
            + " secret TEXT NOT NULL DEFAULT '')",
        "CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE,"
            + " made_by INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,"
            + " expires_at REAL NOT NULL DEFAULT 0, used_at REAL NOT NULL DEFAULT 0,"
            + " used_by INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS shares (id INTEGER PRIMARY KEY, from_account INTEGER NOT NULL,"
            + " song_id INTEGER NOT NULL, to_account INTEGER NOT NULL,"
            + " token_digest TEXT NOT NULL DEFAULT '', as_name TEXT NOT NULL DEFAULT '',"
            + " created_at REAL NOT NULL, revoked_at REAL NOT NULL DEFAULT 0)",
        "CREATE INDEX IF NOT EXISTS shares_to ON shares(to_account, revoked_at)",
        "CREATE INDEX IF NOT EXISTS shares_from ON shares(from_account, song_id)",
        "CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL,"
            + " name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,"
            + " scope TEXT NOT NULL DEFAULT 'upload', created_at REAL NOT NULL,"
            + " last_used REAL NOT NULL DEFAULT 0)",
        "CREATE INDEX IF NOT EXISTS tokens_account ON tokens(account_id)",
        "CREATE TABLE IF NOT EXISTS foyer_links (foyer_id TEXT PRIMARY KEY,"
            + " account_id INTEGER NOT NULL UNIQUE, linked_at REAL NOT NULL, handle TEXT NOT NULL DEFAULT '')",
    };

    private final Config config;
    private final JdbcTemplate db;

    public Accounts(Config config) {
        this.config = config;
        try {
            java.nio.file.Files.createDirectories(config.data);
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
        SQLiteConfig c = new SQLiteConfig();
        c.setJournalMode(SQLiteConfig.JournalMode.WAL);
        c.setSynchronous(SQLiteConfig.SynchronousMode.NORMAL);
        c.setBusyTimeout(30000);
        SQLiteDataSource ds = new SQLiteDataSource(c);
        ds.setUrl("jdbc:sqlite:" + config.accountsDb().toAbsolutePath());
        DataSource source = ds;
        this.db = new JdbcTemplate(source);
        for (String s : SCHEMA) db.execute(s);
        List<Map<String, Object>> cols = db.queryForList("PRAGMA table_info(shares)");
        boolean have = cols.stream().anyMatch(r -> "token_digest".equals(r.get("name")));
        if (!have) db.execute("ALTER TABLE shares ADD COLUMN token_digest TEXT NOT NULL DEFAULT ''");
        boolean hasHandle = db.queryForList("PRAGMA table_info(foyer_links)").stream()
                .anyMatch(r -> "handle".equals(r.get("name")));
        if (!hasHandle) db.execute("ALTER TABLE foyer_links ADD COLUMN handle TEXT NOT NULL DEFAULT ''");
    }

    // -- small helpers -----------------------------------------------------------
    static double now() { return System.currentTimeMillis() / 1000.0; }

    static long num(Object o) { return o == null ? 0 : ((Number) o).longValue(); }

    static double dbl(Object o) { return o == null ? 0 : ((Number) o).doubleValue(); }

    static String hex(byte[] b) { return HexFormat.of().formatHex(b); }

    static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        RNG.nextBytes(b);
        return b;
    }

    public static String sha256Hex(String s) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    List<Map<String, Object>> query(String sql, Object... args) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : db.queryForList(sql, args)) out.add(new LinkedHashMap<>(r));
        return out;
    }

    Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> rows = query(sql, args);
        return rows.isEmpty() ? null : rows.get(0);
    }

    int run(String sql, Object... args) { return db.update(sql, args); }

    long insert(String sql, Object... args) {
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        db.update(con -> {
            PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            return ps;
        }, keys);
        return keys.getKey().longValue();
    }

    /**
     * Every live share of one song (or, with null, of a whole library) taken back, marked
     * revoked rather than deleted. A share names its song by rowid, and a deleted song's
     * number is reused, so a share left open would become a share of the next song.
     */
    public int revokeSharesFor(long from, Long songId) {
        double now = now();
        if (songId == null) {
            int n = query("SELECT id FROM shares WHERE from_account = ? AND revoked_at = 0", from).size();
            run("UPDATE shares SET revoked_at = ? WHERE from_account = ? AND revoked_at = 0", now, from);
            return n;
        }
        int n = query("SELECT id FROM shares WHERE from_account = ? AND song_id = ? AND revoked_at = 0", from, songId).size();
        run("UPDATE shares SET revoked_at = ? WHERE from_account = ? AND song_id = ? AND revoked_at = 0", now, from, songId);
        return n;
    }

    // -- shares (accounts.py): a row here is the whole permission model ---------------
    static String shareDigest(String raw) { return sha256Hex("jriter-share:" + (raw == null ? "" : raw)); }

    public long addShare(long from, long songId, long to, String asName, String tokenDigest) {
        return insert("INSERT INTO shares (from_account, song_id, to_account, as_name, created_at, token_digest)"
                + " VALUES (?, ?, ?, ?, ?, ?)", from, songId, to, asName, now(), tokenDigest);
    }

    /** A share with nobody on the other end yet: {id, token}. Only the digest is kept. */
    public Object[] makeShareLink(long from, long songId, String asName) {
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(18));
        long id = addShare(from, songId, NOBODY_YET, asName, shareDigest(raw));
        return new Object[] {id, raw};
    }

    /** The unclaimed, unrevoked share this link opens, or null. */
    public Map<String, Object> shareByToken(String raw) {
        Map<String, Object> row = one("SELECT * FROM shares WHERE token_digest = ? AND token_digest != ''", shareDigest(raw));
        if (row == null || dbl(row.get("revoked_at")) != 0 || num(row.get("to_account")) != NOBODY_YET) return null;
        return row;
    }

    /** Hand a link share to whoever opened it, once (one UPDATE with the owner test in its WHERE). */
    public boolean claimShare(long shareId, long to) {
        return run("UPDATE shares SET to_account = ?, token_digest = '' WHERE id = ? AND to_account = ? AND revoked_at = 0",
                to, shareId, NOBODY_YET) == 1;
    }

    public Map<String, Object> share(long id) { return one("SELECT * FROM shares WHERE id = ?", id); }

    public Map<String, Object> shareBetween(long from, long songId, long to) {
        return one("SELECT * FROM shares WHERE from_account = ? AND song_id = ? AND to_account = ?", from, songId, to);
    }

    public List<Map<String, Object>> sharesTo(long account) {
        return query("SELECT * FROM shares WHERE to_account = ? AND revoked_at = 0 ORDER BY created_at DESC", account);
    }

    public List<Map<String, Object>> sharesFrom(long account, Long songId) {
        if (songId == null)
            return query("SELECT * FROM shares WHERE from_account = ? AND revoked_at = 0 ORDER BY created_at DESC", account);
        return query("SELECT * FROM shares WHERE from_account = ? AND song_id = ? AND revoked_at = 0 ORDER BY created_at DESC",
                account, songId);
    }

    public void revokeShare(long id) { run("UPDATE shares SET revoked_at = ? WHERE id = ?", now(), id); }

    // -- passwords ---------------------------------------------------------------
    /** scrypt N=2^14 r=8 p=1 dkLen=32, base64: the same as hashlib.scrypt in Python. */
    public static String hash(String password, byte[] salt) {
        return Base64.getEncoder().encodeToString(
                SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), salt, 1 << 14, 8, 1, 32));
    }

    public boolean check(Map<String, Object> account, String password) {
        if (account == null) return false;
        byte[] salt = Base64.getDecoder().decode((String) account.get("salt"));
        return MessageDigest.isEqual(hash(password == null ? "" : password, salt).getBytes(StandardCharsets.UTF_8),
                ((String) account.get("hash")).getBytes(StandardCharsets.UTF_8));
    }

    public void setPassword(long id, String password) {
        if (password == null || password.isEmpty()) throw new ApiError("Type a password. Anything you like, but not nothing.");
        byte[] salt = randomBytes(16);
        run("UPDATE accounts SET salt = ?, hash = ? WHERE id = ?",
                Base64.getEncoder().encodeToString(salt), hash(password, salt), id);
    }

    public void signOutEverywhere(long id) {
        // A Foyer tie is a way in too: ending every session ends it (CONDOM 3).
        unlinkFoyer(id);
        run("UPDATE accounts SET secret = ? WHERE id = ?", hex(randomBytes(32)), id);
    }

    public String secretOf(long id) {
        Map<String, Object> row = one("SELECT secret FROM accounts WHERE id = ?", id);
        if (row == null) return null;
        String s = (String) row.get("secret");
        if (s == null || s.isEmpty()) {
            String fresh = hex(randomBytes(32));
            run("UPDATE accounts SET secret = ? WHERE id = ?", fresh, id);
            return fresh;
        }
        return s;
    }

    // -- handles -----------------------------------------------------------------
    public static String tidyHandle(String raw) {
        String handle = raw == null ? "" : raw.strip().toLowerCase();
        if (handle.isEmpty()) throw new ApiError("Choose a handle. It is what you type to sign in.");
        if (handle.length() > HANDLE_MAX)
            throw new ApiError("That handle is too long: " + HANDLE_MAX + " characters at most.");
        TreeSet<String> bad = new TreeSet<>();
        for (char c : handle.toCharArray()) if (HANDLE_OK.indexOf(c) < 0) bad.add(String.valueOf(c));
        if (!bad.isEmpty())
            throw new ApiError("A handle can hold letters, digits, and - _ . only. Not: " + String.join(" ", bad));
        return handle;
    }

    public Map<String, Object> byHandle(String handle) {
        return one("SELECT * FROM accounts WHERE handle = ?", handle == null ? "" : handle.strip().toLowerCase());
    }

    public Map<String, Object> byId(long id) { return one("SELECT * FROM accounts WHERE id = ?", id); }

    public Map<String, Object> owner() { return one("SELECT * FROM accounts ORDER BY id LIMIT 1"); }

    public long count() { return num(one("SELECT COUNT(*) AS n FROM accounts").get("n")); }

    /** What anybody signed in may know about an account. Never the hash, salt or secret. */
    public Map<String, Object> pub(Map<String, Object> a) {
        if (a == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        String name = (String) a.get("name");
        out.put("id", a.get("id"));
        out.put("handle", a.get("handle"));
        out.put("name", name == null || name.isEmpty() ? a.get("handle") : name);
        out.put("is_owner", num(a.get("id")) == OWNER);
        out.put("created_at", a.get("created_at"));
        return out;
    }

    public Map<String, Object> create(String handle, String password, String name, Long accountId) {
        handle = tidyHandle(handle);
        if (byHandle(handle) != null) throw new ApiError("Somebody already has the handle " + handle + ".", 409);
        if (password == null || password.isEmpty())
            throw new ApiError("Type a password. Anything you like, but not nothing.");
        byte[] salt = randomBytes(16);
        String n = name == null ? "" : name.strip();
        if (n.length() > 80) n = n.substring(0, 80);
        String saltB64 = Base64.getEncoder().encodeToString(salt);
        long made;
        if (accountId != null) {
            run("INSERT INTO accounts (handle, name, salt, hash, created_at, secret, id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    handle, n, saltB64, hash(password, salt), now(), hex(randomBytes(32)), accountId);
            made = accountId;
        } else {
            made = insert("INSERT INTO accounts (handle, name, salt, hash, created_at, secret) VALUES (?, ?, ?, ?, ?, ?)",
                    handle, n, saltB64, hash(password, salt), now(), hex(randomBytes(32)));
        }
        config.ensureHome(made);
        return byId(made);
    }

    public void seen(long id) { run("UPDATE accounts SET last_seen = ? WHERE id = ?", now(), id); }

    public Map<String, Object> rename(long id, String name) {
        String n = name == null ? "" : name.strip();
        if (n.length() > 80) n = n.substring(0, 80);
        run("UPDATE accounts SET name = ? WHERE id = ?", n, id);
        return byId(id);
    }

    public List<Map<String, Object>> everybody() { return query("SELECT * FROM accounts ORDER BY id"); }

    // -- invites -----------------------------------------------------------------
    static String inviteDigest(String raw) { return sha256Hex("jriter-invite:" + (raw == null ? "" : raw)); }

    static String threeFours() {
        return hex(randomBytes(2)) + "-" + hex(randomBytes(2)) + "-" + hex(randomBytes(2));
    }

    public String makeInvite(long madeBy, String note, int days) {
        String raw = threeFours();
        String n = note == null ? "" : note.strip();
        if (n.length() > 80) n = n.substring(0, 80);
        run("INSERT INTO invites (digest, made_by, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                inviteDigest(raw), madeBy, n, now(), days > 0 ? now() + days * 86400.0 : 0.0);
        return raw;
    }

    public Map<String, Object> inviteFor(String raw) {
        Map<String, Object> row = one("SELECT * FROM invites WHERE digest = ?", inviteDigest(raw));
        if (row == null || dbl(row.get("used_at")) != 0) return null;
        double exp = dbl(row.get("expires_at"));
        if (exp != 0 && exp < now()) return null;
        return row;
    }

    public void spendInvite(long inviteId, long by) {
        run("UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?", now(), by, inviteId);
    }

    public List<Map<String, Object>> invitesBy(long id) {
        List<Map<String, Object>> rows = query("SELECT * FROM invites WHERE made_by = ? ORDER BY created_at DESC", id);
        for (Map<String, Object> row : rows) {
            row.remove("digest");
            boolean used = dbl(row.get("used_at")) != 0;
            double exp = dbl(row.get("expires_at"));
            row.put("used", used);
            row.put("expired", exp != 0 && exp < now() && !used);
            long by = num(row.get("used_by"));
            if (by != 0) {
                Map<String, Object> a = byId(by);
                row.put("used_by_handle", a == null ? "" : a.get("handle"));
            }
        }
        return rows;
    }

    public void dropInvite(String inviteId, long madeBy) {
        run("DELETE FROM invites WHERE id = ? AND made_by = ?", inviteId, madeBy);
    }

    // -- machine credentials -------------------------------------------------------
    public void addToken(long account, String name, String digest, String scope) {
        run("INSERT INTO tokens (account_id, name, digest, scope, created_at) VALUES (?, ?, ?, ?, ?)",
                account, name, digest, scope, now());
    }

    public Map<String, Object> tokenFor(String digest) { return one("SELECT * FROM tokens WHERE digest = ?", digest); }

    public void tokenUsed(long id) { run("UPDATE tokens SET last_used = ? WHERE id = ?", now(), id); }

    public List<Map<String, Object>> tokensOf(long account) {
        return query("SELECT id, name, scope, created_at, last_used FROM tokens WHERE account_id = ? "
                + "ORDER BY created_at DESC", account);
    }

    public void dropToken(String id, long account) {
        run("DELETE FROM tokens WHERE id = ? AND account_id = ?", id, account);
    }

    // -- Foyer -------------------------------------------------------------------
    public Long foyerAccount(String foyerId) {
        Map<String, Object> r = one("SELECT account_id FROM foyer_links WHERE foyer_id = ?", foyerId);
        return r == null ? null : num(r.get("account_id"));
    }

    public String foyerOf(long account) {
        Map<String, Object> r = one("SELECT foyer_id FROM foyer_links WHERE account_id = ?", account);
        return r == null ? null : (String) r.get("foyer_id");
    }

    public void linkFoyer(String foyerId, String handle, long account) {
        run("DELETE FROM foyer_links WHERE foyer_id = ? OR account_id = ?", foyerId, account);
        run("INSERT INTO foyer_links (foyer_id, account_id, linked_at, handle) VALUES (?, ?, ?, ?)",
                foyerId, account, now(), handle == null ? "" : handle);
    }

    /** The Foyer handle this account is tied to ("" if tied before handles were kept), or null. */
    public String foyerHandleOf(long account) {
        Map<String, Object> r = one("SELECT handle FROM foyer_links WHERE account_id = ?", account);
        return r == null ? null : (String) r.get("handle");
    }

    public void foyerSeenAs(String foyerId, String handle) {
        if (handle == null || handle.isEmpty()) return;
        run("UPDATE foyer_links SET handle = ? WHERE foyer_id = ? AND handle <> ?", handle, foyerId, handle);
    }

    public void unlinkFoyer(long account) { run("DELETE FROM foyer_links WHERE account_id = ?", account); }

    public String freeHandle(String wanted) {
        StringBuilder sb = new StringBuilder();
        for (char c : (wanted == null ? "" : wanted.strip().toLowerCase()).toCharArray())
            if (HANDLE_OK.indexOf(c) >= 0) sb.append(c);
        String base = sb.length() > HANDLE_MAX - 4 ? sb.substring(0, HANDLE_MAX - 4) : sb.toString();
        if (base.isEmpty()) base = "friend";
        String handle = base;
        int n = 1;
        while (byHandle(handle) != null) handle = base + (++n);
        return handle;
    }
}
