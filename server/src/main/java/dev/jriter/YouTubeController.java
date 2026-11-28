package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** /api/youtube/* and a song's YouTube entries: the routes of jriter/modules/youtube.py. */
@RestController
public class YouTubeController {
    private static final java.security.SecureRandom RNG = new java.security.SecureRandom();

    private final YouTube yt;
    private final Library library;
    private final Blobs blobs;
    private final Video video;
    private final int port;

    public YouTubeController(YouTube yt, Library library, Blobs blobs, Video video, @Value("${server.port}") int port) {
        this.yt = yt;
        this.library = library;
        this.blobs = blobs;
        this.video = video;
        this.port = port;
    }

    // -- posts -------------------------------------------------------------------

    @GetMapping("/api/songs/{id}/youtube")
    public Object listPosts(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        List<Object> posts = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT * FROM youtube_posts WHERE song_id = ? ORDER BY id DESC", song.get("id")))
            posts.add(yt.decorate(db, r));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("posts", posts);
        return out;
    }

    @PostMapping("/api/songs/{id}/youtube")
    public Object createPost(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> post = yt.addPost(db, Accounts.num(song.get("id")), Body.json(req));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("post", yt.decorate(db, post));
        return out;
    }

    @PatchMapping("/api/youtube/{id}")
    public Object updatePost(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> post = yt.getPost(db, id);
        Map<String, Object> data = Body.json(req);
        Map<String, Object> patch = new LinkedHashMap<>();
        for (String f : List.of("url", "title", "note"))
            if (data.containsKey(f)) {
                Object v = data.get(f);
                if (f.equals("url")) patch.put(f, YouTube.postUrl(v));
                else patch.put(f, v == null || Boolean.FALSE.equals(v) || "".equals(v) ? "" : String.valueOf(v).strip());
            }
        if (data.containsKey("version_id")) patch.put("version_id", data.get("version_id"));
        if (data.containsKey("status")) {
            if (!(data.get("status") instanceof String s) || !YouTube.STATUSES.contains(s))
                throw new ApiError("status must be one of: " + String.join(", ", YouTube.STATUSES));
            patch.put("status", s);
        }
        patch.put("updated_at", Accounts.now());
        db.update("youtube_posts", Accounts.num(post.get("id")), patch);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("post", yt.decorate(db, yt.getPost(db, post.get("id"))));
        return out;
    }

    @DeleteMapping("/api/youtube/{id}")
    public Object deletePost(HttpServletRequest req, @PathVariable String id) {
        Library.Db db = library.of(Api.acct(req));
        Map<String, Object> post = yt.getPost(db, id);
        db.run("DELETE FROM youtube_posts WHERE id = ?", post.get("id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("deleted", post.get("id"));
        return out;
    }

    // -- the account -------------------------------------------------------------

    @GetMapping("/api/youtube/account")
    public Object account(HttpServletRequest req) { return yt.accountState(Api.acct(req)); }

    @PostMapping("/api/youtube/account/choose")
    @SuppressWarnings("unchecked")
    public Object choose(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> held = yt.all(acct);
        String want = Body.need(Body.json(req), "id");
        if (!((Map<String, Object>) held.get("accounts")).containsKey(want))
            throw new ApiError("no account with id " + want, 404);
        held.put("chosen", want);
        yt.saveAccount(acct, held);
        return yt.accountState(acct);
    }

    @DeleteMapping("/api/youtube/account")
    public Object disconnectAll(HttpServletRequest req) {
        long acct = Api.acct(req);
        return disconnect(acct, null);
    }

    @DeleteMapping("/api/youtube/account/{id}")
    public Object disconnectOne(HttpServletRequest req, @PathVariable String id) {
        return disconnect(Api.acct(req), id);
    }

    @SuppressWarnings("unchecked")
    private Object disconnect(long acct, String want) {
        if (want != null && !want.isEmpty()) {
            Map<String, Object> held = yt.all(acct);
            Map<String, Object> accs = (Map<String, Object>) held.get("accounts");
            accs.remove(want);
            if (want.equals(held.get("chosen"))) held.put("chosen", accs.isEmpty() ? null : accs.keySet().iterator().next());
            yt.saveAccount(acct, held);
        } else {
            try {
                Files.deleteIfExists(yt.accountFile(acct));
            } catch (IOException ignored) { /* as Python: a missing file is fine */ }
        }
        return yt.accountState(acct);
    }

    @GetMapping("/api/youtube/avatar")
    public ResponseEntity<Resource> avatar(HttpServletRequest req) throws IOException {
        Path file = yt.avatar(Api.acct(req));
        byte[] head = new byte[4];
        try (var in = Files.newInputStream(file)) { in.readNBytes(head, 0, 4); }
        boolean png = head[1] == 'P' && head[2] == 'N' && head[3] == 'G';
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(png ? "image/png" : "image/jpeg"))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600").body(new FileSystemResource(file));
    }

    // -- signing in --------------------------------------------------------------

    /** The address the browser making this request would come back to (from Host, never written down). */
    static String returnTo(HttpServletRequest req) {
        String host = req.getHeader("Host") == null ? "" : req.getHeader("Host").strip();
        if (host.isEmpty() || host.contains("/") || host.contains("\\"))
            throw new ApiError("This request carried no usable address to come back to.");
        String said = req.getHeader("X-Forwarded-Proto") == null ? "" : req.getHeader("X-Forwarded-Proto").toLowerCase();
        String scheme;
        if (said.equals("http") || said.equals("https")) scheme = said;
        else {
            String bare = host.split(":", -1)[0].toLowerCase();
            scheme = bare.equals("127.0.0.1") || bare.equals("localhost") || bare.equals("[::1]") ? "http" : "https";
        }
        return scheme + "://" + host + YouTube.RETURN_PATH;
    }

    @GetMapping("/api/youtube/auth/addresses")
    public Object addresses(HttpServletRequest req) {
        String here = returnTo(req);
        List<String> register = new ArrayList<>(List.of(here));
        for (String guess : List.of("http://127.0.0.1:" + port + YouTube.RETURN_PATH, "http://localhost:" + port + YouTube.RETURN_PATH))
            if (!register.contains(guess)) register.add(guess);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("here", here);
        out.put("register", register);
        out.put("path", YouTube.RETURN_PATH);
        return out;
    }

    @PostMapping("/api/youtube/auth/start")
    public Object authStart(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> data = Body.json(req);
        String clientId = Body.need(data, "client_id").strip();
        String clientSecret = Body.need(data, "client_secret").strip();
        String back = returnTo(req);
        Map<String, Object> held = yt.all(acct);
        byte[] raw = new byte[24];
        RNG.nextBytes(raw);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Map<String, Object> pending = new LinkedHashMap<>();
        pending.put("kind", "redirect");
        pending.put("state", state);
        pending.put("client_id", clientId);
        pending.put("client_secret", clientSecret);
        pending.put("redirect_uri", back);
        pending.put("started_at", Accounts.now());
        pending.put("name", Body.str(data, "name").strip());
        held.put("pending", pending);
        yt.saveAccount(acct, held);
        Map<String, String> q = new LinkedHashMap<>();
        q.put("client_id", clientId);
        q.put("redirect_uri", back);
        q.put("response_type", "code");
        q.put("scope", YouTube.SCOPE);
        q.put("state", state);
        q.put("access_type", "offline");
        q.put("prompt", "consent");
        q.put("include_granted_scopes", "true");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("url", YouTube.AUTH_URL + "?" + YouTube.form(q));
        out.put("redirect_uri", back);
        return out;
    }

    /** urllib.parse.quote: only letters, digits and _.-~ stay; "/" stays too. */
    static String quote(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20").replace("*", "%2A")
                .replace("%7E", "~").replace("%2F", "/");
    }

    private static ResponseEntity<Void> backToPage(String message) {
        return ResponseEntity.status(302).header(HttpHeaders.LOCATION, "/#/?connect=" + quote(message)).build();
    }

    @GetMapping("/api/youtube/auth/return")
    @SuppressWarnings("unchecked")
    public ResponseEntity<Void> authReturn(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> held = yt.all(acct);
        Map<String, Object> waiting = held.get("pending") instanceof Map ? (Map<String, Object>) held.get("pending") : new LinkedHashMap<>();
        if (!"redirect".equals(waiting.get("kind"))) return backToPage("Nothing was waiting to be connected. Start again.");
        String said = req.getParameter("state") == null ? "" : req.getParameter("state");
        String code = req.getParameter("code") == null ? "" : req.getParameter("code");
        String refused = req.getParameter("error") == null ? "" : req.getParameter("error");
        held.remove("pending");
        yt.saveAccount(acct, held);
        String want = waiting.get("state") == null ? "" : String.valueOf(waiting.get("state"));
        boolean ok = !want.isEmpty() && MessageDigest.isEqual(said.getBytes(StandardCharsets.UTF_8), want.getBytes(StandardCharsets.UTF_8));
        if (!ok) return backToPage("That sign in did not match the one this library started.");
        if (!refused.isEmpty()) return backToPage("Google refused: " + refused);
        if (code.isEmpty()) return backToPage("Google came back without a code.");
        Map<String, String> f = new LinkedHashMap<>();
        f.put("client_id", String.valueOf(waiting.get("client_id")));
        f.put("client_secret", String.valueOf(waiting.get("client_secret")));
        f.put("code", code);
        f.put("grant_type", "authorization_code");
        f.put("redirect_uri", String.valueOf(waiting.get("redirect_uri")));
        Map<String, Object> got = yt.postForm(YouTube.TOKEN_URL, f);
        if (!got.containsKey("refresh_token")) {
            Object why = SoundController.truthy(got.get("error_description"), false) ? got.get("error_description")
                    : SoundController.truthy(got.get("error"), false) ? got.get("error") : "that did not complete";
            return backToPage(String.valueOf(why));
        }
        yt.landAccount(acct, held, waiting, got);
        return backToPage("connected");
    }

    @PostMapping("/api/youtube/connect")
    public Object connect(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> data = Body.json(req);
        String clientId = Body.need(data, "client_id").strip();
        String clientSecret = Body.need(data, "client_secret").strip();
        Map<String, String> f = new LinkedHashMap<>();
        f.put("client_id", clientId);
        f.put("scope", YouTube.SCOPE);
        Map<String, Object> said = yt.postForm(YouTube.DEVICE_URL, f);
        if (!said.containsKey("device_code")) {
            Object why = SoundController.truthy(said.get("error_description"), false) ? said.get("error_description")
                    : said.containsKey("error") ? said.get("error") : "no reason given";
            throw new ApiError("Google refused those credentials: " + why);
        }
        Map<String, Object> held = yt.all(acct);
        Map<String, Object> pending = new LinkedHashMap<>();
        pending.put("client_id", clientId);
        pending.put("client_secret", clientSecret);
        pending.put("device_code", said.get("device_code"));
        pending.put("started_at", Accounts.now());
        pending.put("name", Body.str(data, "name").strip());
        held.put("pending", pending);
        yt.saveAccount(acct, held);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user_code", said.get("user_code"));
        out.put("verification_url", SoundController.truthy(said.get("verification_url"), false)
                ? said.get("verification_url") : said.get("verification_uri"));
        out.put("expires_in", said.get("expires_in") == null ? 900 : said.get("expires_in"));
        return out;
    }

    @PostMapping("/api/youtube/finish")
    @SuppressWarnings("unchecked")
    public Object finish(HttpServletRequest req) {
        long acct = Api.acct(req);
        Map<String, Object> held = yt.all(acct);
        if (!(held.get("pending") instanceof Map<?, ?>) || ((Map<?, ?>) held.get("pending")).isEmpty())
            throw new ApiError("Nothing is waiting to be connected. Start again.");
        Map<String, Object> waiting = (Map<String, Object>) held.get("pending");
        if ("redirect".equals(waiting.get("kind")))
            throw new ApiError("That sign in is happening in the browser. Finish it there.", 409);
        Map<String, String> f = new LinkedHashMap<>();
        f.put("client_id", String.valueOf(waiting.get("client_id")));
        f.put("client_secret", String.valueOf(waiting.get("client_secret")));
        f.put("device_code", String.valueOf(waiting.get("device_code")));
        f.put("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
        Map<String, Object> said = yt.postForm(YouTube.TOKEN_URL, f);
        if ("authorization_pending".equals(said.get("error")))
            throw new ApiError("Google has not seen the code yet. Enter it, then try again.", 409);
        if (!said.containsKey("refresh_token")) {
            Object why = SoundController.truthy(said.get("error_description"), false) ? said.get("error_description")
                    : said.containsKey("error") ? said.get("error") : "no reason";
            throw new ApiError("That did not complete: " + why);
        }
        Object[] landed = yt.landAccount(acct, held, waiting, said);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connected", true);
        out.put("channel", landed[1]);
        out.put("id", landed[0]);
        return out;
    }

    // -- sending one out ---------------------------------------------------------

    @PostMapping("/api/songs/{id}/youtube/mix")
    public Object receiveMix(HttpServletRequest req, @PathVariable String id) throws IOException {
        long acct = Api.acct(req);
        SongsController.getSong(library.of(acct), id);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no file in that upload");
        if (length > Api.AUDIO_MOST) throw new ApiError("That mix is over " + Api.mb(Api.AUDIO_MOST) + ", too big to keep here.", 413);
        Blobs.Stored s = blobs.putUpload(req, acct, length);
        AudioMeta.Probe meta = AudioMeta.probe(blobs.pathFor(acct, s.digest()), ".wav");
        if (meta.duration() == 0) throw new ApiError("That did not arrive as a readable wav. Render it again.", 400);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("digest", s.digest());
        out.put("size", s.size());
        out.put("seconds", meta.duration());
        return out;
    }

    @PostMapping("/api/songs/{id}/youtube/upload")
    public Object startUpload(HttpServletRequest req, @PathVariable String id) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        Map<String, Object> song = SongsController.getSong(db, id);
        Map<String, Object> data = Body.json(req);
        String digest = Body.need(data, "digest");
        if (!digest.matches("[0-9a-f]{64}") || !Files.isRegularFile(blobs.pathFor(acct, digest)))
            throw new ApiError("That mix is not on the server. Render it and send it again.", 409);
        Map<String, Object> tool = video.find(acct, false);
        if (!Boolean.TRUE.equals(tool.get("found"))) {
            Object[] can = video.canInstall();
            if (!Boolean.TRUE.equals(can[0])) {
                String why = (String) can[1];
                throw new ApiError(why.isEmpty() ? (String) tool.get("why") : why, 409);
            }
        }
        if (yt.chosen(acct) == null)
            throw new ApiError("No YouTube account is chosen, so there is nowhere to send it.", 409);

        Object given = data.get("title");
        String title = (SoundController.truthy(given, false) ? String.valueOf(given) : String.valueOf(song.get("title"))).strip();
        if (title.isEmpty()) throw new ApiError("A title is needed.");
        if (title.length() > 100)
            throw new ApiError("YouTube allows 100 characters in a title. That one is " + title.length() + ".");
        if (title.contains("<") || title.contains(">")) throw new ApiError("YouTube will not take < or > in a title.");
        Object d = data.get("description");
        String description = SoundController.truthy(d, false) ? String.valueOf(d) : "";
        if (description.length() > 5000) description = description.substring(0, 5000);
        Object privacy = data.containsKey("privacy") ? data.get("privacy") : "private";
        if (privacy == null || !List.of("private", "unlisted", "public").contains(privacy))
            throw new ApiError("privacy must be private, unlisted or public");

        Map<String, Object> snippet = new LinkedHashMap<>();
        snippet.put("title", title);
        snippet.put("description", description);
        snippet.put("categoryId", "10");
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("privacyStatus", privacy);
        status.put("selfDeclaredMadeForKids", false);
        Map<String, Object> want = new LinkedHashMap<>();
        want.put("snippet", snippet);
        want.put("status", status);

        yt.pruneOldWork(acct);
        Map<String, Object> job = yt.newJob(song, data.get("version_id"), digest);
        yt.note("privacy_asked", privacy);
        yt.start(acct, job, song, want);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("job", yt.publicJob());
        return out;
    }

    @GetMapping("/api/youtube/job")
    public Object jobState(HttpServletRequest req) {
        Api.acct(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("job", yt.publicJob());
        return out;
    }

    @PostMapping("/api/youtube/job/cancel")
    public Object cancel(HttpServletRequest req) {
        Api.acct(req);
        return yt.cancelJob();
    }

    @GetMapping("/api/youtube/tool")
    public Object tool(HttpServletRequest req) {
        Map<String, Object> found = video.find(Api.acct(req), false);
        Object[] can = video.canInstall();
        Map<String, Object> out = new LinkedHashMap<>(found);
        out.put("unaudited", true);
        out.put("can_install", Boolean.TRUE.equals(can[0]) && !Boolean.TRUE.equals(found.get("found")));
        out.put("install_why", can[1]);
        out.put("install_size", Video.SIZE);
        out.put("install_version", Video.VERSION);
        return out;
    }
}
