package dev.jriter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Component;

/**
 * Which version of a song went up and getting it there: a port of jriter/modules/youtube.py
 * (its docstrings carry the reasoning). The record of posts, the account file, both Google
 * sign-ins, and the one upload job that makes a video and sends it.
 */
@Component
public class YouTube {
    static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    static final String DEVICE_URL = "https://oauth2.googleapis.com/device/code";
    static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    static final String UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
    static final String CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
    static final String SCOPE = "https://www.googleapis.com/auth/youtube.upload";
    static final String RETURN_PATH = "/api/youtube/auth/return";
    static final List<String> STATUSES = List.of("draft", "scheduled", "published", "unlisted", "private", "removed");
    static final long AVATAR_MAX_AGE = 86400;
    static final List<String> AVATAR_HOSTS = List.of("ggpht.com", "googleusercontent.com");
    static final long KEEP_WORK = 7L * 24 * 3600;
    static final int[] BACKOFF = {1, 2, 4, 8, 16};
    static final int UPLOAD_COST = 1600;
    static final double FETCH_SHARE = 0.30;
    static final List<String> RUNNING = List.of("fetching", "encoding", "uploading");
    static final List<String> SHOWN = List.of("id", "song_id", "song_title", "version_id", "mix_digest", "state", "step",
            "at", "sent", "total", "video_id", "url", "privacy_asked", "privacy_got", "error", "fix", "log",
            "started_at", "finished_at");
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    private final Config config;
    private final Library library;
    private final Blobs blobs;
    private final Video video;
    private final Problems problems;

    private final Object lock = new Object();
    private Map<String, Object> job;

    /** Asked to stop while the bytes were moving: not a problem, so its own type. */
    static final class Stopped extends RuntimeException {
        Stopped() { super("stopped", null, false, false); }
    }

    public YouTube(Config config, Library library, Blobs blobs, Video video, Problems problems) {
        this.config = config;
        this.library = library;
        this.blobs = blobs;
        this.video = video;
        this.problems = problems;
    }

    // -- the record of posts -----------------------------------------------------

    Map<String, Object> getPost(Library.Db db, Object id) {
        Map<String, Object> row = db.one("SELECT * FROM youtube_posts WHERE id = ?", id);
        if (row == null) throw new ApiError("no YouTube entry with id " + id, 404);
        return row;
    }

    Map<String, Object> decorate(Library.Db db, Map<String, Object> row) {
        Object vid = row.get("version_id");
        if (vid == null || Boolean.FALSE.equals(vid) || Integer.valueOf(0).equals(vid) || "".equals(vid)) {
            row.put("version_n", null);
            return row;
        }
        Map<String, Object> v = db.one("SELECT n FROM versions WHERE id = ?", vid);
        row.put("version_n", v == null ? null : v.get("n"));
        row.put("version_missing", v == null);
        return row;
    }

    /** A post's link: empty, or https:// with a host. Anything else (javascript:, http:) is refused. */
    static String postUrl(Object v) {
        String s = stripped(v);
        if (s.isEmpty()) return "";
        String host = null;
        try { host = URI.create(s).getHost(); } catch (IllegalArgumentException e) { /* refused below */ }
        if (!s.toLowerCase(Locale.ROOT).startsWith("https://") || host == null || host.isBlank())
            throw new ApiError("A link has to start with https://");
        return s;
    }

    private static String stripped(Object v) {
        return v == null || Boolean.FALSE.equals(v) ? "" : String.valueOf(v).strip();
    }

    Map<String, Object> addPost(Library.Db db, long songId, Map<String, Object> f) {
        Object st = f.containsKey("status") ? f.get("status") : "published";
        if (!(st instanceof String s) || !STATUSES.contains(s))
            throw new ApiError("status must be one of: " + String.join(", ", STATUSES));
        double now = Accounts.now();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("song_id", songId);
        v.put("version_id", f.get("version_id"));
        v.put("url", postUrl(f.get("url")));
        v.put("title", stripped(f.get("title")));
        v.put("status", s);
        v.put("note", f.containsKey("note") ? f.get("note") : "");
        v.put("video_id", f.containsKey("video_id") ? f.get("video_id") : "");
        v.put("mix_digest", f.containsKey("mix_digest") ? f.get("mix_digest") : "");
        v.put("created_at", now);
        v.put("updated_at", now);
        long id = db.insert("youtube_posts", v);
        SongsController.touch(db, songId);
        return getPost(db, id);
    }

    // -- the account file --------------------------------------------------------

    Path accountFile(long acct) { return config.home(acct).resolve("youtube.json"); }

    private Path accountPath(long acct) { return accountFile(acct); }

    private Map<String, Object> readAccount(long acct) {
        try {
            Map<String, Object> m = JSON.readValue(accountPath(acct).toFile(), new TypeReference<Map<String, Object>>() {});
            return m == null ? new LinkedHashMap<>() : m;
        } catch (IOException | RuntimeException e) {
            return new LinkedHashMap<>();
        }
    }

    void saveAccount(long acct, Map<String, Object> data) {
        try {
            config.ensureHome(acct);
            Path path = accountPath(acct);
            Path tmp = Path.of(path + ".tmp");
            JSON.writeValue(tmp.toFile(), data);
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new ApiError("The YouTube account could not be saved: " + e.getMessage(), 500);
        }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> all(long acct) {
        Map<String, Object> held = readAccount(acct);
        if (!held.containsKey("accounts") && SoundController.truthy(held.get("refresh_token"), false)) {
            Map<String, Object> moved = new LinkedHashMap<>(held);
            Object ch = moved.get("channel");
            moved.put("name", SoundController.truthy(ch, false) ? ch : "your channel");
            held = new LinkedHashMap<>();
            Map<String, Object> accs = new LinkedHashMap<>();
            accs.put("first", moved);
            held.put("accounts", accs);
            held.put("chosen", "first");
            saveAccount(acct, held);
        }
        if (!(held.get("accounts") instanceof Map)) held.put("accounts", new LinkedHashMap<String, Object>());
        return held;
    }

    /** The chosen account: [key, entry], or null. */
    @SuppressWarnings("unchecked")
    Object[] chosen(long acct) {
        Map<String, Object> held = all(acct);
        Map<String, Object> accs = (Map<String, Object>) held.get("accounts");
        Object at = held.get("chosen");
        if (at instanceof String k && accs.containsKey(k)) return new Object[] {k, accs.get(k)};
        if (accs.size() == 1) {
            String only = accs.keySet().iterator().next();
            return new Object[] {only, accs.get(only)};
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> publicEntry(Map<String, Object> e) {
        Map<String, Object> m = new LinkedHashMap<>();
        Object name = SoundController.truthy(e.get("name"), false) ? e.get("name")
                : SoundController.truthy(e.get("channel"), false) ? e.get("channel") : "a channel";
        m.put("name", name);
        m.put("channel", e.get("channel"));
        m.put("has_avatar", SoundController.truthy(e.get("avatar_url"), false));
        m.put("connected_at", e.get("connected_at"));
        return m;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> accountState(long acct) {
        Map<String, Object> held = all(acct);
        Map<String, Object> accs = new TreeMap<>((Map<String, Object>) held.get("accounts"));
        List<Object> list = new ArrayList<>();
        for (Map.Entry<String, Object> e : accs.entrySet()) {
            Map<String, Object> p = publicEntry((Map<String, Object>) e.getValue());
            p.put("id", e.getKey());
            list.add(p);
        }
        Object[] c = chosen(acct);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("accounts", list);
        out.put("chosen", c == null ? null : c[0]);
        out.put("connected", !accs.isEmpty());
        out.put("unaudited", true);
        return out;
    }

    // -- Google ------------------------------------------------------------------

    record Resp(int code, byte[] body, Map<String, List<String>> headers) {
        String text() { return new String(body, StandardCharsets.UTF_8); }
        String header(String name) {
            for (Map.Entry<String, List<String>> e : headers.entrySet())
                if (e.getKey() != null && e.getKey().equalsIgnoreCase(name) && !e.getValue().isEmpty()) return e.getValue().get(0);
            return null;
        }
    }

    static Resp call(String method, String url, Map<String, String> headers, byte[] body, int timeoutSeconds) throws IOException {
        HttpURLConnection c = (HttpURLConnection) URI.create(url).toURL().openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(30000);
        c.setReadTimeout(timeoutSeconds * 1000);
        c.setRequestMethod(method);
        for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
        if (body != null) {
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = c.getOutputStream()) { out.write(body); }
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] data = in == null ? new byte[0] : in.readAllBytes();
        if (in != null) in.close();
        return new Resp(code, data, c.getHeaderFields());
    }

    static String form(Map<String, String> fields) {
        StringBuilder s = new StringBuilder();
        for (Map.Entry<String, String> e : fields.entrySet()) {
            if (s.length() > 0) s.append('&');
            s.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)).append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return s.toString();
    }

    /** POST a form; Google's "still waiting" is an HTTP error handed back with _status, not raised. */
    Map<String, Object> postForm(String url, Map<String, String> fields) {
        Resp r;
        try {
            r = call("POST", url, Map.of("Content-Type", "application/x-www-form-urlencoded"),
                    form(fields).getBytes(StandardCharsets.UTF_8), 30);
        } catch (IOException e) {
            throw new ApiError("Google could not be reached: " + e.getMessage(), 502);
        }
        try {
            Map<String, Object> said = JSON.readValue(r.body(), new TypeReference<Map<String, Object>>() {});
            if (r.code() >= 400) said.put("_status", r.code());
            return said;
        } catch (IOException | RuntimeException e) {
            if (r.code() < 400) throw new ApiError("Google sent a reply JR!TER could not read.", 502);
            Map<String, Object> said = new LinkedHashMap<>();
            String t = r.text();
            said.put("error", t.length() > 200 ? t.substring(0, 200) : t);
            said.put("_status", r.code());
            return said;
        }
    }

    /** The channel's name and picture address, or {null, null}. */
    String[] channel(String token) {
        if (token == null) return new String[] {null, null};
        try {
            Resp r = call("GET", CHANNEL_URL, Map.of("Authorization", "Bearer " + token), null, 20);
            if (r.code() >= 400) return new String[] {null, null};
            Map<String, Object> m = JSON.readValue(r.body(), new TypeReference<Map<String, Object>>() {});
            if (!(m.get("items") instanceof List<?> items) || items.isEmpty()) return new String[] {null, null};
            Map<?, ?> snippet = (Map<?, ?>) ((Map<?, ?>) items.get(0)).get("snippet");
            if (snippet == null) return new String[] {null, null};
            Map<?, ?> thumbs = snippet.get("thumbnails") instanceof Map<?, ?> t ? t : Map.of();
            String pic = null;
            if (thumbs.get("default") instanceof Map<?, ?> d && d.get("url") != null) pic = String.valueOf(d.get("url"));
            else if (thumbs.get("medium") instanceof Map<?, ?> d && d.get("url") != null) pic = String.valueOf(d.get("url"));
            Object title = snippet.get("title");
            return new String[] {title == null ? null : String.valueOf(title), pic};
        } catch (IOException | RuntimeException e) {
            return new String[] {null, null};
        }
    }

    @SuppressWarnings("unchecked")
    void forgetAccessToken(long acct) {
        Map<String, Object> held = all(acct);
        Object[] c = chosen(acct);
        if (c == null) return;
        Map<String, Object> entry = (Map<String, Object>) c[1];
        entry.remove("access_token");
        entry.put("expires_at", 0);
        ((Map<String, Object>) held.get("accounts")).put((String) c[0], entry);
        saveAccount(acct, held);
    }

    @SuppressWarnings("unchecked")
    String accessToken(long acct) {
        Map<String, Object> held = all(acct);
        Object[] c = chosen(acct);
        if (c == null) throw new ApiError("No YouTube account is chosen.", 409);
        Map<String, Object> entry = (Map<String, Object>) c[1];
        if (SoundController.truthy(entry.get("access_token"), false) && Accounts.dbl(entry.get("expires_at")) > Accounts.now())
            return (String) entry.get("access_token");
        Map<String, String> f = new LinkedHashMap<>();
        f.put("client_id", String.valueOf(entry.get("client_id")));
        f.put("client_secret", String.valueOf(entry.get("client_secret")));
        f.put("refresh_token", String.valueOf(entry.get("refresh_token")));
        f.put("grant_type", "refresh_token");
        Map<String, Object> said = postForm(TOKEN_URL, f);
        if (!said.containsKey("access_token")) {
            Object why = SoundController.truthy(said.get("error_description"), false) ? said.get("error_description")
                    : said.containsKey("error") ? said.get("error") : "no reason";
            throw new ApiError("That account needs connecting again: " + why, 401);
        }
        entry.put("access_token", said.get("access_token"));
        entry.put("expires_at", Accounts.now() + (said.get("expires_in") == null ? 3600 : Accounts.dbl(said.get("expires_in"))) - 60);
        ((Map<String, Object>) held.get("accounts")).put((String) c[0], entry);
        saveAccount(acct, held);
        return (String) entry.get("access_token");
    }

    /** Store a completed sign in (both flows): returns [key, channel]. */
    @SuppressWarnings("unchecked")
    Object[] landAccount(long acct, Map<String, Object> held, Map<String, Object> waiting, Map<String, Object> said) {
        String[] ch = channel((String) said.get("access_token"));
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("client_id", waiting.get("client_id"));
        entry.put("client_secret", waiting.get("client_secret"));
        entry.put("refresh_token", said.get("refresh_token"));
        entry.put("access_token", said.get("access_token"));
        entry.put("expires_at", Accounts.now() + (said.get("expires_in") == null ? 3600 : Accounts.dbl(said.get("expires_in"))) - 60);
        entry.put("connected_at", Accounts.now());
        entry.put("channel", ch[0]);
        Object wn = waiting.get("name");
        entry.put("name", SoundController.truthy(wn, false) ? wn : ch[0] != null && !ch[0].isEmpty() ? ch[0] : "a channel");
        entry.put("avatar_url", ch[1]);
        String key = (ch[0] != null && !ch[0].isEmpty() ? ch[0] : "account-" + (long) Accounts.now())
                .toLowerCase(Locale.ROOT).replace(" ", "-");
        if (key.length() > 60) key = key.substring(0, 60);
        ((Map<String, Object>) held.get("accounts")).put(key, entry);
        held.put("chosen", key);
        held.remove("pending");
        saveAccount(acct, held);
        return new Object[] {key, ch[0]};
    }

    // -- the avatar --------------------------------------------------------------

    static boolean mayFetch(String url) {
        try {
            URI u = URI.create(url == null ? "" : url);
            if (!"https".equals(u.getScheme()) || u.getHost() == null) return false;
            String host = u.getHost().toLowerCase(Locale.ROOT);
            for (String good : AVATAR_HOSTS) if (host.equals(good) || host.endsWith("." + good)) return true;
            return false;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    Path avatarCache(long acct, String key) {
        StringBuilder safe = new StringBuilder();
        for (char c : key.toCharArray()) safe.append(Character.isLetterOrDigit(c) || c == '-' || c == '_' ? c : '_');
        String s = safe.length() > 60 ? safe.substring(0, 60) : safe.toString();
        if (s.isEmpty()) s = "one";
        return config.home(acct).resolve("youtube").resolve("avatar-" + s);
    }

    /** The chosen channel's picture file (fetched and cached), or a 404. */
    @SuppressWarnings("unchecked")
    public Path avatar(long acct) {
        Object[] c = chosen(acct);
        if (c == null) throw new ApiError("no picture for this account", 404);
        Map<String, Object> entry = (Map<String, Object>) c[1];
        String url = entry.get("avatar_url") == null ? "" : String.valueOf(entry.get("avatar_url"));
        if (url.isEmpty() || !mayFetch(url)) throw new ApiError("no picture for this account", 404);
        Path cached = avatarCache(acct, (String) c[0]);
        boolean fresh = false;
        try {
            fresh = Files.isRegularFile(cached)
                    && Accounts.now() - Files.getLastModifiedTime(cached).toMillis() / 1000.0 < AVATAR_MAX_AGE;
        } catch (IOException ignored) { /* treated as stale */ }
        if (!fresh) {
            try {
                config.ensureHome(acct);
                Files.createDirectories(cached.getParent());
                Resp r = call("GET", url, Map.of("User-Agent", "JR!TER"), null, 15);
                if (r.code() != 200) throw new IOException("HTTP " + r.code());
                byte[] blob = r.body().length > 2 * 1024 * 1024 ? java.util.Arrays.copyOf(r.body(), 2 * 1024 * 1024) : r.body();
                Path tmp = Path.of(cached + ".tmp");
                Files.write(tmp, blob);
                Files.move(tmp, cached, StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException | RuntimeException e) {
                if (!Files.isRegularFile(cached)) throw new ApiError("the picture could not be fetched", 404);
            }
        }
        return cached;
    }

    // -- the job -----------------------------------------------------------------

    private Path workDir(long acct) { return config.home(acct).resolve("youtube").resolve("work"); }

    Map<String, Object> newJob(Map<String, Object> song, Object versionId, String digest) {
        synchronized (lock) {
            if (job != null && RUNNING.contains((String) job.get("state")))
                throw new ApiError("JR!TER is already uploading " + job.get("song_title") + ". One at a time.", 409);
            Map<String, Object> j = new LinkedHashMap<>();
            j.put("id", Long.toHexString(System.currentTimeMillis()));
            j.put("song_id", song.get("id"));
            j.put("song_title", song.get("title"));
            j.put("version_id", versionId);
            j.put("mix_digest", digest);
            j.put("state", "encoding");
            j.put("step", "making the video");
            j.put("at", 0.0);
            j.put("sent", 0L);
            j.put("total", 0L);
            j.put("video_id", "");
            j.put("url", "");
            j.put("privacy_asked", "");
            j.put("privacy_got", "");
            j.put("error", "");
            j.put("fix", "");
            j.put("log", new ArrayList<String>());
            j.put("session", "");
            j.put("started_at", Accounts.now());
            j.put("finished_at", 0.0);
            j.put("cancel", false);
            job = j;
            return new LinkedHashMap<>(j);
        }
    }

    /** Update the job; returns whether it has been asked to stop. */
    boolean note(Object... kv) {
        synchronized (lock) {
            if (job == null) return true;
            for (int i = 0; i < kv.length; i += 2) job.put((String) kv[i], kv[i + 1]);
            return Boolean.TRUE.equals(job.get("cancel"));
        }
    }

    @SuppressWarnings("unchecked")
    private void addLog(String... lines) {
        synchronized (lock) {
            if (job == null) return;
            List<String> log = new ArrayList<>((List<String>) job.get("log"));
            log.addAll(List.of(lines));
            job.put("log", log);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> publicJob() {
        synchronized (lock) {
            if (job == null) return null;
            Map<String, Object> out = new LinkedHashMap<>();
            for (String k : SHOWN) if (job.containsKey(k)) out.put(k, job.get(k));
            List<String> log = (List<String>) out.get("log");
            out.put("log", log.size() > 20 ? new ArrayList<>(log.subList(log.size() - 20, log.size())) : new ArrayList<>(log));
            return out;
        }
    }

    public Map<String, Object> cancelJob() {
        synchronized (lock) {
            if (job == null || !RUNNING.contains((String) job.get("state"))) throw new ApiError("Nothing is running.", 409);
            job.put("cancel", true);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("job", publicJob());
        return out;
    }

    private void stopped(Path room) {
        Video.deleteTree(room);
        note("state", "stopped", "step", "stopped", "error", "", "fix", "", "finished_at", Accounts.now());
    }

    @SuppressWarnings("unchecked")
    private void failed(String message, String fix, List<String> tail, Path room, boolean keep) {
        if (!keep) Video.deleteTree(room);
        List<String> log;
        synchronized (lock) {
            log = job == null ? new ArrayList<>() : new ArrayList<>((List<String>) job.get("log"));
        }
        log.addAll(tail);
        if (log.size() > 40) log = new ArrayList<>(log.subList(log.size() - 40, log.size()));
        note("state", "failed", "step", "stopped", "error", message, "fix", fix, "log", log, "finished_at", Accounts.now());
    }

    private void rememberOnDisk(long acct, String jobId) {
        Map<String, Object> n = new LinkedHashMap<>();
        synchronized (lock) {
            if (job == null) return;
            for (String k : List.of("id", "song_id", "song_title", "session", "sent", "total", "mix_digest")) n.put(k, job.get(k));
        }
        n.put("at", Accounts.now());
        try {
            Files.createDirectories(workDir(acct));
            JSON.writeValue(workDir(acct).resolve(jobId + ".json").toFile(), n);
        } catch (IOException ignored) { /* a note that cannot be written is not a reason to stop */ }
    }

    public void pruneOldWork(long acct) {
        Path room = workDir(acct);
        if (!Files.isDirectory(room)) return;
        long cutoff = System.currentTimeMillis() - KEEP_WORK * 1000;
        try (var s = Files.list(room)) {
            for (Path p : s.toList()) {
                try {
                    if (Files.getLastModifiedTime(p).toMillis() > cutoff) continue;
                    Video.deleteTree(p);
                } catch (IOException ignored) { /* skip */ }
            }
        } catch (IOException ignored) { /* nothing to prune */ }
    }

    static String googleSaid(int code, String raw) {
        Map<String, Object> said;
        try {
            Map<String, Object> m = JSON.readValue(raw, new TypeReference<Map<String, Object>>() {});
            Object e = m.get("error");
            said = e instanceof Map ? castMap(e) : new LinkedHashMap<>();
        } catch (IOException | RuntimeException ex) {
            return "YouTube answered " + code + ": " + (raw.length() > 200 ? raw.substring(0, 200) : raw);
        }
        List<String> reasons = new ArrayList<>();
        if (said.get("errors") instanceof List<?> l)
            for (Object o : l) reasons.add(o instanceof Map<?, ?> d && d.get("reason") != null ? String.valueOf(d.get("reason")) : "");
        if (reasons.contains("quotaExceeded") || reasons.contains("uploadLimitExceeded"))
            return "This Google project has used its upload quota for the day. A video costs " + UPLOAD_COST
                    + " of the 10000 units a project gets, so it is six a day, and it resets at midnight Pacific.";
        if (reasons.contains("youtubeSignupRequired")) return "That Google account has no YouTube channel on it yet.";
        Object msg = said.get("message");
        return "YouTube refused it: " + (SoundController.truthy(msg, false) ? msg : raw.length() > 200 ? raw.substring(0, 200) : raw);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object o) { return (Map<String, Object>) o; }

    /** Where uploads begin. Not final, and only a test moves it: a setting or an environment variable here would let a bearer token be sent anywhere. */
    static String uploadUrl = UPLOAD_URL;

    String begin(String token, long size, Map<String, Object> snippet, Map<String, Object> status) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("snippet", snippet);
        body.put("status", status);
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Authorization", "Bearer " + token);
        h.put("Content-Type", "application/json; charset=UTF-8");
        h.put("X-Upload-Content-Length", String.valueOf(size));
        h.put("X-Upload-Content-Type", "video/mp4");
        Resp r = call("POST", uploadUrl, h, new ObjectMapper().writeValueAsBytes(body), 60);
        if (r.code() >= 400) throw new ApiError(googleSaid(r.code(), r.text()), 502);
        String where = r.header("Location");
        if (where == null || where.isEmpty())
            throw new ApiError("YouTube agreed to the upload and did not say where to send it. Nothing has been uploaded. Try again.", 502);
        return where;
    }

    private static Map<String, Object> readable(byte[] raw) {
        Map<String, Object> v = null;
        try {
            v = JSON.readValue(raw, new TypeReference<Map<String, Object>>() {});
        } catch (IOException | RuntimeException ignored) { /* refuse to guess below */ }
        if (v == null || !SoundController.truthy(v.get("id"), false))
            throw new ApiError("YouTube says this upload finished and then sent a reply JR!TER could not read. "
                    + "Check your channel before uploading it again.", 502);
        return v;
    }

    /** Ask the session how much it has: {done, video} or {sent}. */
    private Object[] howFar(String uri, long total) throws IOException {
        HttpURLConnection c = (HttpURLConnection) URI.create(uri).toURL().openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(30000);
        c.setReadTimeout(60000);
        c.setRequestMethod("PUT");
        c.setRequestProperty("Content-Range", "bytes */" + total);
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode(0);
        c.getOutputStream().close();
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] body = in == null ? new byte[0] : in.readAllBytes();
        if (code == 200 || code == 201) return new Object[] {true, readable(body)};
        if (code == 308) {
            String got = c.getHeaderField("Range");
            if (got == null || got.isEmpty()) return new Object[] {false, 0L};
            return new Object[] {false, Long.parseLong(got.substring(got.lastIndexOf('-') + 1).strip()) + 1};
        }
        if (code == 404)
            throw new ApiError("YouTube has forgotten this upload, which sessions do after about a week. Nothing was published. Start it again.", 410);
        throw new ApiError(googleSaid(code, new String(body, StandardCharsets.UTF_8)), 502);
    }

    /** Send from `sent` to the end. Returns {code, body}. Throws Stopped when cancelled. */
    private Resp put(String uri, Path file, long sent, long total, String token, java.util.function.LongPredicate seen)
            throws IOException {
        HttpURLConnection c = (HttpURLConnection) URI.create(uri).toURL().openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(30000);
        c.setReadTimeout(900000);
        c.setRequestMethod("PUT");
        c.setRequestProperty("Content-Type", "video/mp4");
        c.setRequestProperty("Authorization", "Bearer " + token);
        if (sent > 0) c.setRequestProperty("Content-Range", "bytes " + sent + "-" + (total - 1) + "/" + total);
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode(total - sent);
        try (FileChannel ch = FileChannel.open(file, StandardOpenOption.READ); OutputStream out = c.getOutputStream()) {
            ch.position(sent);
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.allocate(65536);
            while (ch.read(buf) > 0) {
                buf.flip();
                int n = buf.remaining();
                out.write(buf.array(), 0, n);
                buf.clear();
                if (seen.test(n)) {
                    c.disconnect();
                    throw new Stopped();
                }
            }
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] body = in == null ? new byte[0] : in.readAllBytes();
        return new Resp(code, body, c.getHeaderFields());
    }

    Map<String, Object> uploadWithRetries(long acct, String uri, Path mp4, long total, String jobId,
                                                  double floor, double span) throws IOException {
        long sent = 0;
        for (int attempt = 0; attempt <= BACKOFF.length; attempt++) {
            if (attempt > 0) {
                try {
                    Thread.sleep(BACKOFF[attempt - 1] * 1000L);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new Stopped();
                }
            }
            try {
                String token = accessToken(acct);
                long[] box = {sent};
                Resp r = put(uri, mp4, sent, total, token, n -> {
                    box[0] += n;
                    return note("sent", box[0], "at", floor + span * (0.25 + 0.75 * (box[0] / (double) total)));
                });
                if (r.code() == 200 || r.code() == 201) {
                    Map<String, Object> v = null;
                    try {
                        v = JSON.readValue(r.body(), new TypeReference<Map<String, Object>>() {});
                    } catch (IOException | RuntimeException ignored) { /* below */ }
                    if (v == null || !SoundController.truthy(v.get("id"), false))
                        throw new ApiError("YouTube accepted the file and then sent a reply JR!TER could not read. "
                                + "Check your channel before uploading this again.", 502);
                    return v;
                }
                if (r.code() == 401) forgetAccessToken(acct);
                else if (r.code() != 500 && r.code() != 502 && r.code() != 503 && r.code() != 504)
                    throw new ApiError(googleSaid(r.code(), r.text()), 502);
            } catch (IOException e) {
                note("step", "the connection dropped, picking it up again");
            }
            rememberOnDisk(acct, jobId);
            Object[] where = howFar(uri, total);
            if (Boolean.TRUE.equals(where[0])) {
                @SuppressWarnings("unchecked") Map<String, Object> v = (Map<String, Object>) where[1];
                return v;
            }
            sent = (Long) where[1];
            note("sent", sent, "at", floor + span * (0.25 + 0.75 * (sent / (double) total)),
                    "step", "picking up at " + sent + " of " + total);
            rememberOnDisk(acct, jobId);
        }
        throw new ApiError("The upload kept breaking and JR!TER has stopped trying. Nothing was published. "
                + "Check the connection and start it again.", 502);
    }

    /** It is up. Write the row from what YouTube said, not from what was asked for. */
    @SuppressWarnings("unchecked")
    private void land(long acct, Map<String, Object> jobCopy, Map<String, Object> song, Map<String, Object> resource, Path room) {
        Object status = resource.get("status") instanceof Map<?, ?> s ? s.get("privacyStatus") : null;
        String got = SoundController.truthy(status, false) ? String.valueOf(status) : "private";
        String videoId = String.valueOf(resource.get("id"));
        String url = "https://www.youtube.com/watch?v=" + videoId;
        Object title = resource.get("snippet") instanceof Map<?, ?> s ? s.get("title") : null;
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("version_id", jobCopy.get("version_id"));
        f.put("url", url);
        f.put("title", SoundController.truthy(title, false) ? title : song.get("title"));
        f.put("status", got.equals("public") ? "published" : got);
        f.put("video_id", videoId);
        f.put("mix_digest", jobCopy.get("mix_digest"));
        Library.Db db = library.of(acct);
        addPost(db, Accounts.num(song.get("id")), f);
        note("state", "done", "at", 1.0, "step", "done", "video_id", videoId, "url", url, "privacy_got", got,
                "finished_at", Accounts.now());
        // the working files go, and so does the wav unless the library still points at those bytes
        Video.deleteTree(room);
        String digest = (String) jobCopy.get("mix_digest");
        Map<String, Object> still = db.one("SELECT id FROM versions WHERE digest = ? LIMIT 1", digest);
        if (still == null && db.tableExists("renders")) still = db.one("SELECT id FROM renders WHERE digest = ? LIMIT 1", digest);
        if (still == null) blobs.delete(acct, digest);
    }

    /** Runs on its own thread; nothing here touches a request. */
    public void work(long acct, Map<String, Object> jobCopy, Map<String, Object> song, Map<String, Object> want) {
        String jobId = (String) jobCopy.get("id");
        Path room = workDir(acct).resolve(jobId);
        double floor = 0.0, span = 1.0;
        try {
            Files.createDirectories(room);
            Map<String, Object> found = video.find(acct, false);
            if (!Boolean.TRUE.equals(found.get("found"))) {
                note("state", "fetching", "step", "getting ffmpeg", "at", 0.0, "sent", 0L, "total", Video.SIZE);
                String got = video.fetch((seen, total) -> note("sent", seen, "total", total,
                        "at", FETCH_SHARE * (seen / (double) (total == 0 ? 1 : total))));
                if (got.isEmpty()) {
                    stopped(room);
                    return;
                }
                found = video.find(acct, true);
                if (!Boolean.TRUE.equals(found.get("found"))) {
                    failed("JR!TER fetched ffmpeg to " + got + " and then could not find it.", "", List.of(), room, true);
                    return;
                }
                floor = FETCH_SHARE;
                span = 1.0 - FETCH_SHARE;
                addLog("fetched " + found.get("version"));
                note("sent", 0L, "total", 0L);
            }
            String tool = (String) found.get("path");
            Path wav = blobs.pathFor(acct, (String) jobCopy.get("mix_digest"));
            Path mp4 = room.resolve("video.mp4");
            double seconds = AudioMeta.probe(wav, ".wav").duration();
            String still = null;
            Path cover = stillFor(acct, Accounts.num(song.get("id")), room);
            if (cover != null) {
                Path flat = room.resolve("still.png");
                Video.Run r = video.run(Video.stillArgv(tool, cover.toString(), flat.toString()), 0, f -> { });
                if (r.ok() && Files.isRegularFile(flat)) still = flat.toString();
                else {
                    addLog("the artwork could not be read, so the video is a plain colour");
                    addLog(r.tail().subList(Math.max(0, r.tail().size() - 4), r.tail().size()).toArray(new String[0]));
                }
            }
            if (note("state", "encoding", "step", "making the video", "at", floor)) {
                stopped(room);
                return;
            }
            final double fl = floor, sp = span;
            Video.Run enc = video.run(Video.videoArgv(tool, still, wav.toString(), seconds, mp4.toString()), seconds,
                    f -> note("at", fl + sp * f * 0.25));
            if (!enc.ok()) {
                failed("ffmpeg could not make the video.", Video.whyItFailed(enc.tail()), enc.tail(), room, true);
                return;
            }
            long total = Files.size(mp4);
            note("state", "uploading", "step", "sending it to YouTube", "at", floor + span * 0.25, "total", total, "sent", 0L);
            String token = accessToken(acct);
            @SuppressWarnings("unchecked") String uri = begin(token, total, (Map<String, Object>) want.get("snippet"),
                    (Map<String, Object>) want.get("status"));
            note("session", uri);
            rememberOnDisk(acct, jobId);
            Map<String, Object> resource = uploadWithRetries(acct, uri, mp4, total, jobId, floor, span);
            land(acct, jobCopy, song, resource, room);
        } catch (Stopped e) {
            stopped(room);
        } catch (ApiError e) {
            failed(e.getMessage(), "", List.of(), room, true);
        } catch (Exception e) {
            String ref = problems.record("/api/youtube/upload", e, "POST");
            failed(e.getClass().getSimpleName() + ": " + e.getMessage(),
                    "The full error is in Settings under errors, reference " + ref + ".", List.of(), room, true);
        }
    }

    private Path stillFor(long acct, long songId, Path into) throws IOException {
        Map<String, Object> row = library.of(acct).one("SELECT * FROM artwork WHERE song_id = ? ORDER BY position, id LIMIT 1", songId);
        if (row == null) return null;
        Path source = blobs.pathFor(acct, (String) row.get("digest"));
        if (!Files.isRegularFile(source)) return null;
        Object ext = row.get("ext");
        Path landing = into.resolve("cover" + (SoundController.truthy(ext, false) ? ext : ".jpg"));
        Files.copy(source, landing, StandardCopyOption.REPLACE_EXISTING);
        return landing;
    }

    /** Start the worker thread. */
    public void start(long acct, Map<String, Object> jobCopy, Map<String, Object> song, Map<String, Object> want) {
        Thread t = new Thread(() -> work(acct, jobCopy, song, want), "youtube-upload");
        t.setDaemon(true);
        t.start();
    }
}
