package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The display face, when you would rather use your own: a port of
 * jriter/modules/appearance.py. The font is never part of the repository; it lives in the
 * account's own folder (appearance/display.ttf, with its given name beside it) and is served
 * only from there.
 */
@RestController
public class AppearanceController {
    static final Map<String, String> FONT_EXT = Map.of(
            ".ttf", "font/ttf", ".otf", "font/otf", ".woff", "font/woff", ".woff2", "font/woff2");
    static final long MAX_BYTES = 8L * 1024 * 1024;
    private static final List<byte[]> SIGNATURES = List.of(
            new byte[] {0, 1, 0, 0}, "OTTO".getBytes(StandardCharsets.US_ASCII),
            "true".getBytes(StandardCharsets.US_ASCII), "ttcf".getBytes(StandardCharsets.US_ASCII),
            "wOFF".getBytes(StandardCharsets.US_ASCII), "wOF2".getBytes(StandardCharsets.US_ASCII));

    private final Config config;

    public AppearanceController(Config config) { this.config = config; }

    private Path dir(long acct) { return config.home(acct).resolve("appearance"); }

    private Path find(long acct) {
        try (Stream<Path> s = Files.list(dir(acct))) {
            return s.filter(p -> FONT_EXT.containsKey(Api.extOf(p.getFileName().toString())))
                    .sorted().findFirst().orElse(null);
        } catch (IOException e) {
            return null;
        }
    }

    private static String givenName(Path font, String fallback) {
        try {
            String given = Files.readString(Path.of(font + ".name"), StandardCharsets.UTF_8).strip();
            return given.isEmpty() ? fallback : given;
        } catch (IOException e) {
            return fallback;
        }
    }

    Map<String, Object> state(long acct) {
        Path p = find(acct);
        Map<String, Object> out = new LinkedHashMap<>();
        if (p == null) {
            out.put("custom_font", false);
            return out;
        }
        String name = p.getFileName().toString();
        out.put("custom_font", true);
        out.put("font_name", givenName(p, name));
        out.put("font_format", FONT_EXT.get(Api.extOf(name)));
        try {
            out.put("uploaded_at", Files.getLastModifiedTime(p).toMillis() / 1000.0);
        } catch (IOException e) {
            out.put("uploaded_at", 0.0);
        }
        return out;
    }

    /** The typeface, which the login page asks for before anyone has signed in: then the owner's. */
    @GetMapping("/api/appearance/font")
    public ResponseEntity<Resource> getFont(HttpServletRequest req) {
        Long who = Door.who(req);
        long acct = who == null ? 1 : who;
        Path p = find(acct);
        if (p == null) throw new ApiError("no display font has been uploaded", 404);
        return Api.serve(p, FONT_EXT.get(Api.extOf(p.getFileName().toString())), null, "no display font has been uploaded");
    }

    @PostMapping("/api/appearance/font")
    public Object upload(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("no font in that upload");
        if (length > MAX_BYTES)
            throw new ApiError("a display font over " + (MAX_BYTES / 1048576) + " MB is not a display font");
        String filename = Api.header(req, "X-Filename");
        if (filename.isEmpty()) filename = "display.ttf";
        String ext = Api.extOf(filename);
        if (!FONT_EXT.containsKey(ext))
            throw new ApiError("JR!TER takes .ttf, .otf, .woff or .woff2, not " + (ext.isEmpty() ? filename : ext));

        byte[] body;
        try (InputStream in = req.getInputStream()) {
            body = in.readNBytes((int) length);
        }
        byte[] head = Arrays.copyOf(body, Math.min(4, body.length));
        boolean known = false;
        for (byte[] sig : SIGNATURES) if (Arrays.equals(head, sig)) known = true;
        if (!known) throw new ApiError("that file does not look like a font. Is it still inside a zip?");

        Path d = dir(acct);
        Files.createDirectories(d);
        try (Stream<Path> s = Files.list(d)) {
            for (Path old : (Iterable<Path>) s::iterator) {
                try { Files.deleteIfExists(old); } catch (IOException ignored) { /* one at a time */ }
            }
        }
        Path safe = d.resolve("display" + ext);
        Files.write(safe, body);
        String base = filename.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        if (base.length() > 120) base = base.substring(0, 120);
        Files.writeString(Path.of(safe + ".name"), base, StandardCharsets.UTF_8);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("font", state(acct));
        return out;
    }

    @DeleteMapping("/api/appearance/font")
    public Object clear(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        Path p = find(acct);
        if (p != null) {
            Files.deleteIfExists(p);
            Files.deleteIfExists(Path.of(p + ".name"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("font", state(acct));
        return out;
    }
}
