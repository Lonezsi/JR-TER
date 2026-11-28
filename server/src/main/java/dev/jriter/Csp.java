package dev.jriter;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;

/**
 * The Content-Security-Policy for every response (Condom 6). Scripts run only from this server or by
 * sha256 hash of an inline script in a page the server itself serves: the hashes are read off the
 * web/*.html files on disk, so editing a page cannot silently break it and nothing else can add one.
 * The DAW page alone may add what plugins need: WAM modules are scripts from sites the person allowed.
 */
@Component
public class Csp {
    private static final Pattern INLINE = Pattern.compile("<script\\b(?![^>]*\\bsrc\\s*=)[^>]*>([\\s\\S]*?)</script>",
            Pattern.CASE_INSENSITIVE);
    private final Config config;
    private String hashes = "";
    private long seen = -1;
    private long checked = 0;

    public Csp(Config config) { this.config = config; }

    public String policy(String path) {
        boolean daw = "/daw.html".equals(path);
        String more = daw ? " https:" : "";
        return "default-src 'self'; script-src 'self'" + (daw ? " blob: https:" : "") + hashes()
                + "; style-src 'self' 'unsafe-inline'" + more
                + "; img-src 'self' https://i.ytimg.com blob: data:" + more
                + "; media-src 'self' blob:" + more
                + "; font-src 'self' data:" + more
                + "; connect-src 'self'" + (daw ? " blob: data: https:" : "")
                + "; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    }

    static void secure(HttpServletResponse res, String policy) {
        res.setHeader("Content-Security-Policy", policy);
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "same-origin");
    }

    /** ' 'sha256-..' ...' for every inline script in web/*.html; rescanned when the pages change. */
    synchronized String hashes() {
        long now = System.currentTimeMillis();
        if (now - checked < 2000 && seen >= 0) return hashes;
        checked = now;
        long stamp = 0;
        TreeSet<String> out = new TreeSet<>();
        try (Stream<Path> s = Files.list(config.web)) {
            for (Path p : (Iterable<Path>) s.filter(f -> f.toString().endsWith(".html")).sorted()::iterator)
                stamp = stamp * 31 + Files.getLastModifiedTime(p).toMillis() + p.getFileName().hashCode();
        } catch (IOException e) {
            return hashes = "";
        }
        if (stamp == seen) return hashes;
        try (Stream<Path> s = Files.list(config.web)) {
            for (Path p : (Iterable<Path>) s.filter(f -> f.toString().endsWith(".html"))::iterator)
                out.addAll(hashesIn(Files.readString(p, StandardCharsets.UTF_8)));
        } catch (IOException e) {
            return hashes = "";
        }
        StringBuilder b = new StringBuilder();
        for (String h : out) b.append(" '").append(h).append("'");
        seen = stamp;
        return hashes = b.toString();
    }

    static TreeSet<String> hashesIn(String html) {
        TreeSet<String> out = new TreeSet<>();
        Matcher m = INLINE.matcher(html);
        while (m.find()) {
            String code = m.group(1).replace("\r\n", "\n").replace('\r', '\n');
            if (code.isBlank()) continue;
            try {
                byte[] d = MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8));
                out.add("sha256-" + Base64.getEncoder().encodeToString(d));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return out;
    }
}
