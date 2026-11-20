package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** /api/health, the pages and bundles (jriter/http.py's _static), and the honest 404s. */
@RestController
public class WebController {
    static final Map<String, String> TYPES = Map.ofEntries(
            Map.entry(".html", "text/html; charset=utf-8"), Map.entry(".css", "text/css; charset=utf-8"),
            Map.entry(".js", "application/javascript; charset=utf-8"), Map.entry(".json", "application/json"),
            Map.entry(".svg", "image/svg+xml"), Map.entry(".png", "image/png"), Map.entry(".jpg", "image/jpeg"),
            Map.entry(".jpeg", "image/jpeg"), Map.entry(".webp", "image/webp"), Map.entry(".gif", "image/gif"),
            Map.entry(".avif", "image/avif"), Map.entry(".ico", "image/x-icon"), Map.entry(".woff2", "font/woff2"),
            Map.entry(".mp3", "audio/mpeg"), Map.entry(".wav", "audio/wav"), Map.entry(".flac", "audio/flac"),
            Map.entry(".m4a", "audio/mp4"), Map.entry(".aac", "audio/aac"), Map.entry(".ogg", "audio/ogg"),
            Map.entry(".opus", "audio/opus"), Map.entry(".txt", "text/plain; charset=utf-8"));
    private static final long STARTED = System.currentTimeMillis();

    private final Config config;
    private final Accounts accounts;
    private final Auth auth;

    public WebController(Config config, Accounts accounts, Auth auth) {
        this.config = config;
        this.accounts = accounts;
        this.auth = auth;
    }

    @GetMapping("/api/health")
    public Object health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("uptime", Math.round((System.currentTimeMillis() - STARTED) / 100.0) / 10.0);
        try {
            probe();
        } catch (Exception e) {
            out.put("ok", false);
            out.put("degraded", List.of("the database did not answer: " + e.getMessage()));
            return out;
        }
        // shortcut: no problems log or module registry yet, so only the door can be degraded.
        String door = auth.damaged();
        if (door != null) out.put("degraded", List.of(door));
        return out;
    }

    /** One query against the owner's library, if there is one. */
    private void probe() throws Exception {
        if (accounts.count() == 0) return;
        Path db = config.home(Accounts.OWNER).resolve("jriter.db");
        if (!Files.exists(db)) return;
        try (Connection c = DriverManager.getConnection("jdbc:sqlite:" + db.toAbsolutePath());
             Statement s = c.createStatement()) {
            s.executeQuery("SELECT 1 AS one").close();
        }
    }

    // -- the shared glass and the bundles -------------------------------------------
    byte[] sharedGlass() {
        try {
            byte[] f = Files.readAllBytes(config.glass);
            return concat(("/* shared glass, from " + config.glass + " */\n").getBytes(StandardCharsets.UTF_8), f);
        } catch (IOException e) {
            System.err.println("the shared glass is missing: " + config.glass + " (" + e + ")");
            return ("/* THE SHARED GLASS IS MISSING.\n"
                    + "   Looked for it at: " + config.glass + "\n"
                    + "   That file holds every colour, radius and space this app uses, so\n"
                    + "   without it nothing below has anything to work with. Check out foyer\n"
                    + "   beside this repo, or set JRITER_GLASS to wherever it is. */\n"
                    + "body::before {\n"
                    + "  content: 'The shared stylesheet is missing. See the console.';\n"
                    + "  position: fixed; inset: 0 0 auto 0; z-index: 99999;\n"
                    + "  padding: 10px 14px; font: 14px system-ui;\n"
                    + "  background: #7f1d1d; color: #fff;\n"
                    + "}\n").getBytes(StandardCharsets.UTF_8);
        }
    }

    static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] p : parts) o.writeBytes(p);
        return o.toByteArray();
    }

    /** Every file of one kind in a directory, by filename, joined like http.bundle. */
    byte[] bundle(Path dir, String ext) {
        List<byte[]> parts = new ArrayList<>();
        if (ext.equals(".css")) parts.add(sharedGlass());
        List<String> names;
        try (Stream<Path> s = Files.list(dir)) {
            names = s.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(ext)).sorted().toList();
        } catch (IOException e) {
            return new byte[0];
        }
        try {
            for (String n : names)
                parts.add(concat(("/* " + n + " */\n").getBytes(StandardCharsets.UTF_8), Files.readAllBytes(dir.resolve(n))));
        } catch (IOException e) {
            return new byte[0];
        }
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) o.writeBytes("\n\n".getBytes(StandardCharsets.UTF_8));
            o.writeBytes(parts.get(i));
        }
        return o.toByteArray();
    }

    ResponseEntity<byte[]> bundled(HttpServletRequest req, String dir, String ext) throws Exception {
        byte[] body = bundle(config.web.resolve(dir), ext);
        byte[] sum = MessageDigest.getInstance("SHA-256").digest(body);
        String etag = "\"" + Accounts.hex(sum).substring(0, 16) + "\"";
        if (etag.equals(req.getHeader("If-None-Match")))
            return ResponseEntity.status(304).header(HttpHeaders.ETAG, etag).build();
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-cache").header(HttpHeaders.ETAG, etag)
                .contentType(MediaType.parseMediaType(TYPES.get(ext))).body(body);
    }

    @GetMapping("/jriter.css")
    public ResponseEntity<byte[]> css(HttpServletRequest req) throws Exception { return bundled(req, "css", ".css"); }

    @GetMapping("/jriter.js")
    public ResponseEntity<byte[]> js(HttpServletRequest req) throws Exception { return bundled(req, "js", ".js"); }

    ResponseEntity<byte[]> file(Path p) throws IOException {
        String name = p.getFileName().toString();
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? "application/octet-stream"
                : TYPES.getOrDefault(name.substring(dot).toLowerCase(), "application/octet-stream");
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type)).body(Files.readAllBytes(p));
    }

    private static ResponseEntity<byte[]> notFound(String message) {
        return ResponseEntity.status(404).contentType(MediaType.APPLICATION_JSON)
                .body(("{\"error\": \"" + message + "\"}").getBytes(StandardCharsets.UTF_8));
    }

    /** Everything not matched above: the API that is not ported yet, the pages, the app. */
    @RequestMapping("/**")
    public ResponseEntity<byte[]> rest(HttpServletRequest req) throws IOException {
        String path = req.getRequestURI();
        if (path.startsWith("/api/")) {
            String safe = path.replace("\\", "\\\\").replace("\"", "\\\"");
            return ResponseEntity.status(404).contentType(MediaType.APPLICATION_JSON).body(
                    ("{\"error\": \"no such endpoint\", \"path\": \"" + safe + "\"}").getBytes(StandardCharsets.UTF_8));
        }
        if (!req.getMethod().equals("GET")) return notFound("not found");
        if (path.equals("/login")) return file(config.web.resolve("login.html"));
        if (path.equals("/legal")) return file(config.web.resolve("legal.html"));
        String rel = path.equals("/") ? "index.html" : path.substring(1);
        Path web = config.web.toAbsolutePath().normalize();
        Path full = web.resolve(rel).normalize();
        if (!full.startsWith(web)) return notFound("not found");
        if (Files.isRegularFile(full)) return file(full);
        Path index = web.resolve("index.html");
        if (Files.isRegularFile(index)) return file(index);
        return notFound("not found");
    }
}
