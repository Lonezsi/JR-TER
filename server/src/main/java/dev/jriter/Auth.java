package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** The door: a port of jriter/modules/auth.py. Sessions, tokens, the guess limit, Foyer. */
@Component
public class Auth {
    public static final String COOKIE = "jriter_session";
    public static final String LEGACY_COOKIE = "jong_session";
    static final int SESSION_DAYS = 30;
    static final int FREE_TRIES = 6;
    static final int[] LOCKOUTS = {30, 120, 600, 1800, 3600};
    static final int WINDOW = 900;
    static final String FOYER_COOKIE = "foyer";
    static final int FOYER_KEEP = 30;

    /** What a token may do. null means no restriction. */
    static final Map<String, Set<String>> SCOPES = new HashMap<>();
    static {
        SCOPES.put("upload", Set.of("GET /api/state", "GET /api/health", "POST /api/renders",
                "POST /api/renders/ingest", "GET /api/songs", "GET /api/songs/match",
                "GET /api/versions/have", "GET /api/sync/folders", "POST /api/songs",
                "POST /api/songs/<id>/versions"));
        SCOPES.put("full", null);
    }

    private static final ObjectMapper JSON = new ObjectMapper();
    private final Config config;
    private final Accounts accounts;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    private record Attempt(int fails, double since, double until, int level) {}

    private final Map<String, Attempt> attempts = new HashMap<>();
    private final Map<String, Object[]> foyerSeen = new HashMap<>();
    /** Why auth.json cannot be used, or null. Set by read(). */
    private volatile String damaged;

    public Auth(Config config, Accounts accounts) {
        this.config = config;
        this.accounts = accounts;
    }

    // -- the stored secret ---------------------------------------------------------
    @SuppressWarnings("unchecked")
    synchronized Map<String, Object> read() {
        Path p = config.authJson();
        Object data;
        try {
            data = JSON.readValue(Files.readAllBytes(p), Object.class);
        } catch (java.nio.file.NoSuchFileException e) {
            damaged = null;
            return new HashMap<>();
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            damaged = "auth.json is not readable JSON (" + e.getOriginalMessage() + ")";
            return new HashMap<>();
        } catch (IOException e) {
            damaged = "auth.json could not be opened (" + e.getMessage() + ")";
            return new HashMap<>();
        }
        if (!(data instanceof Map)) {
            damaged = "auth.json does not hold an object";
            return new HashMap<>();
        }
        Map<String, Object> m = new HashMap<>((Map<String, Object>) data);
        Object h = m.get("hash");
        Object s = m.get("salt");
        if (h != null && !"".equals(h) && (s == null || "".equals(s))) {
            damaged = "auth.json has a password hash with no salt";
            return new HashMap<>();
        }
        damaged = null;
        return m;
    }

    public String damaged() {
        read();
        return damaged;
    }

    /** Never over a file that could not be read: it may be the only copy of a secret. */
    synchronized void write(Map<String, Object> data) {
        String why = damaged();
        if (why != null)
            throw new ApiError("the stored password is damaged and will not be overwritten: " + why, 503);
        try {
            Files.createDirectories(config.data);
            Path tmp = Path.of(config.authJson() + ".tmp");
            Files.write(tmp, JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(data));
            Files.move(tmp, config.authJson(), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean hasPassword() {
        if (accounts.count() > 0) return true;
        Object h = read().get("hash");
        return h != null && !"".equals(h);
    }

    void spendSetupCode() {
        try {
            Files.deleteIfExists(config.setupCode());
        } catch (IOException ignored) {
        }
    }

    /** The one time setup code, or null once there is somebody to sign in as. */
    public synchronized String setupCode() {
        if (accounts.count() > 0 || hasPassword()) return null;
        try {
            String code = Files.readString(config.setupCode()).strip();
            if (!code.isEmpty()) return code;
        } catch (IOException ignored) {
        }
        String code = Accounts.threeFours();
        try {
            Files.createDirectories(config.data);
            Files.writeString(config.setupCode(), code);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return code;
    }

    // -- sessions ------------------------------------------------------------------
    synchronized byte[] secret() {
        Map<String, Object> data = read();
        if (data.get("secret") == null || "".equals(data.get("secret"))) {
            data.put("secret", Base64.getEncoder().encodeToString(Accounts.randomBytes(32)));
            write(data);
        }
        return Base64.getDecoder().decode((String) data.get("secret"));
    }

    static String hmacHex32(byte[] key, String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return Accounts.hex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8))).substring(0, 32);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Two secrets: the server's ends every session, the account's ends one person's. */
    String sign(String body, long accountId) {
        byte[] a = secret();
        byte[] b = ((String) (accounts.secretOf(accountId) == null ? "" : accounts.secretOf(accountId)))
                .getBytes(StandardCharsets.UTF_8);
        byte[] key = new byte[a.length + b.length];
        System.arraycopy(a, 0, key, 0, a.length);
        System.arraycopy(b, 0, key, a.length, b.length);
        return hmacHex32(key, body);
    }

    public String issue(long accountId) {
        String body = (System.currentTimeMillis() / 1000) + "." + accountId + "." + Accounts.hex(Accounts.randomBytes(8));
        return body + "." + sign(body, accountId);
    }

    static boolean fresh(String issued) {
        try {
            long age = System.currentTimeMillis() / 1000 - Long.parseLong(issued);
            return age >= 0 && age <= SESSION_DAYS * 86400L;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    static boolean same(String a, String b) {
        return java.security.MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    /** The account a cookie value belongs to, or null. Four parts now, three before accounts. */
    public Long whose(String token) {
        if (token == null || token.isEmpty()) return null;
        String[] bits = token.split("\\.", -1);
        long id;
        if (bits.length == 4) {
            try {
                id = Long.parseLong(bits[1]);
            } catch (NumberFormatException e) {
                return null;
            }
            String body = bits[0] + "." + bits[1] + "." + bits[2];
            if (!same(bits[3], sign(body, id))) return null;
            if (!fresh(bits[0])) return null;
            return accounts.byId(id) != null ? id : null;
        }
        if (bits.length == 3) {
            id = Accounts.OWNER;
            String body = bits[0] + "." + bits[1];
            if (!same(bits[2], hmacHex32(secret(), body))) return null;
            return fresh(bits[0]) && accounts.byId(id) != null ? id : null;
        }
        return null;
    }

    // -- machine tokens ------------------------------------------------------------
    /** The prefix still says jong: it is salt in every stored digest ever minted. */
    public static String tokenDigest(String raw) { return Accounts.sha256Hex("jong-token:" + raw); }

    public String makeToken(String name, String scope, long account) {
        if (!SCOPES.containsKey(scope)) throw new ApiError("scope must be one of: full, upload");
        String raw = "jt_" + Base64.getUrlEncoder().withoutPadding().encodeToString(Accounts.randomBytes(30));
        String n = name == null || name.isEmpty() ? "a machine" : name;
        accounts.addToken(account, n.length() > 80 ? n.substring(0, 80) : n, tokenDigest(raw), scope);
        return raw;
    }

    /** /api/songs/12/versions -> /api/songs/<id>/versions */
    static String shape(String path) {
        StringBuilder sb = new StringBuilder();
        String[] parts = path.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) sb.append('/');
            String p = parts[i];
            sb.append(!p.isEmpty() && p.chars().allMatch(Character::isDigit) ? "<id>" : p);
        }
        return sb.toString();
    }

    /** Which account's library the token on this request may reach, or null. */
    public Long tokenAccount(String raw, String method, String path) {
        if (raw == null || raw.isBlank()) return null;
        Map<String, Object> row = accounts.tokenFor(tokenDigest(raw.strip()));
        if (row == null) return null;
        String scope = (String) row.get("scope");
        Set<String> allowed = SCOPES.containsKey(scope) ? SCOPES.get(scope) : Set.of();
        if (allowed != null && !allowed.contains(method + " " + path)
                && !allowed.contains(method + " " + shape(path))) return null;
        accounts.tokenUsed(Accounts.num(row.get("id")));
        return Accounts.num(row.get("account_id"));
    }

    // -- Foyer ---------------------------------------------------------------------
    @SuppressWarnings("unchecked")
    public Map<String, Object> foyer(String cookieHeader) {
        String token = null;
        if (cookieHeader != null) for (String part : cookieHeader.split(";")) {
            String p = part.strip();
            int eq = p.indexOf('=');
            if (eq > 0 && p.substring(0, eq).equals(FOYER_COOKIE) && eq + 1 < p.length()) token = p.substring(eq + 1);
        }
        if (token == null || config.foyer.isEmpty() || token.length() > 400
                || !token.chars().allMatch(c -> Character.isLetterOrDigit(c) || c == '-' || c == '_' || c == '.')) return null;
        double now = Accounts.now();
        synchronized (foyerSeen) {
            Object[] seen = foyerSeen.get(token);
            if (seen != null && now - (double) seen[1] < FOYER_KEEP) return (Map<String, Object>) seen[0];
        }
        Map<String, Object> account = null;
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(config.foyer.replaceAll("/+$", "") + "/api/account"))
                    .timeout(Duration.ofSeconds(2)).header("Cookie", FOYER_COOKIE + "=" + token).build();
            HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            Object body = JSON.readValue(res.body(), Object.class);
            if (body instanceof Map && ((Map<?, ?>) body).get("account") instanceof Map)
                account = (Map<String, Object>) ((Map<?, ?>) body).get("account");
        } catch (Exception e) {
            account = null;
        }
        if (account != null && !(account.get("id") instanceof String)) account = null;
        synchronized (foyerSeen) {
            if (foyerSeen.size() > 1000) foyerSeen.clear();
            foyerSeen.put(token, new Object[] {account, now});
        }
        return account;
    }

    /** The library a Foyer account opens, tying Foyer's owner to this one's on the way. */
    public Long foyerLibrary(Map<String, Object> f) {
        if (f == null) return null;
        Long here = accounts.foyerAccount((String) f.get("id"));
        if (here != null && accounts.byId(here) != null) return here;
        if (Boolean.TRUE.equals(f.get("owner")) && accounts.byId(Accounts.OWNER) != null
                && accounts.foyerOf(Accounts.OWNER) == null) {
            accounts.linkFoyer((String) f.get("id"), (String) f.get("handle"), Accounts.OWNER);
            return Accounts.OWNER;
        }
        return null;
    }

    /** Which account this request is, by this library's cookie first and then Foyer's. */
    public Long accountFor(String cookieHeader) {
        if (cookieHeader != null) for (String part : cookieHeader.split(";")) {
            String p = part.strip();
            int eq = p.indexOf('=');
            if (eq <= 0) continue;
            String n = p.substring(0, eq);
            if (n.equals(COOKIE) || n.equals(LEGACY_COOKIE)) {
                Long found = whose(p.substring(eq + 1));
                if (found != null) return found;
            }
        }
        return foyerLibrary(foyer(cookieHeader));
    }

    public void signOutEverywhere() {
        Map<String, Object> data = read();
        data.put("secret", Base64.getEncoder().encodeToString(Accounts.randomBytes(32)));
        write(data);
    }

    // -- guessing limits -----------------------------------------------------------
    /**
     * The caller's address for counting wrong guesses. Behind the tunnel every request is
     * from loopback and the LAST X-Forwarded-For entry is the one the tunnel saw; the
     * header only counts when the peer is this machine.
     */
    public static String who(String peer, String forwardedFor) {
        if (peer == null) peer = "local";
        if (!List.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "local").contains(peer)) return peer;
        String[] bits = (forwardedFor == null ? "" : forwardedFor).split(",");
        String last = bits[bits.length - 1].strip();
        return last.isEmpty() ? peer : last;
    }

    public synchronized int waitFor(String ip) {
        Attempt a = attempts.get(ip);
        if (a == null) return 0;
        double now = Accounts.now();
        return a.until > now ? (int) (a.until - now) : 0;
    }

    public synchronized void noteFailure(String ip) {
        double now = Accounts.now();
        attempts.values().removeIf(e -> e.until < now && now - e.since > WINDOW);
        Attempt e = attempts.get(ip);
        if (e == null || now - e.since > WINDOW) e = new Attempt(0, now, 0, 0);
        int fails = e.fails + 1;
        double until = e.until;
        int level = e.level;
        if (fails > FREE_TRIES) {
            until = now + LOCKOUTS[Math.min(level, LOCKOUTS.length - 1)];
            level++;
            fails = 0;
        }
        attempts.put(ip, new Attempt(fails, now, until, level));
    }

    public synchronized void clear(String ip) { attempts.remove(ip); }
}

