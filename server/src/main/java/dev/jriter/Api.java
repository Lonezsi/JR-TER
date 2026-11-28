package dev.jriter;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import java.util.Map;

/** Small helpers every library controller shares. */
final class Api {
    private Api() {}

    /** The account the door let in. */
    static long acct(HttpServletRequest req) {
        Long who = Door.who(req);
        if (who == null) throw new ApiError("Sign in to use this library.", 401);
        return who;
    }

    /** Request attribute: the guest account, when a shared request runs in the owner's library. */
    static final String GUEST = "jriter.guest";

    /** The guest a shared request is for, or 0 when it is nobody's but the caller's. */
    static long guest(HttpServletRequest req) {
        Object g = req.getAttribute(GUEST);
        return g == null ? 0 : (Long) g;
    }

    /** Who is actually doing this: the guest when it came through a share, else the library's account. */
    static long actor(HttpServletRequest req) {
        long g = guest(req);
        return g != 0 ? g : acct(req);
    }

    /**
     * A whole number from the query. Missing or empty gives the default. (Python's as_int is
     * called as as_int(value, default) in a few handlers, which makes a missing value an
     * error naming the default; this does what those handlers meant.)
     */
    static int queryInt(HttpServletRequest req, String name, int def) {
        String raw = req.getParameter(name);
        if (raw == null || raw.isEmpty()) return def;
        try {
            return Integer.parseInt(raw.strip());
        } catch (NumberFormatException e) {
            throw new ApiError(name + " must be a whole number");
        }
    }

    static final Map<String, String> AUDIO_TYPES = Map.of(
            ".mp3", "audio/mpeg", ".wav", "audio/wav", ".flac", "audio/flac", ".m4a", "audio/mp4",
            ".aac", "audio/aac", ".ogg", "audio/ogg", ".opus", "audio/opus");
    static final java.util.List<String> AUDIO_EXT =
            java.util.List.of(".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus");

    /** Per-file upload caps (CONDOM 4a). Not final so a test can lower them. */
    static long AUDIO_MOST = 300L * 1024 * 1024;
    static long IMAGE_MOST = 20L * 1024 * 1024;

    /** The most one account keeps, all files together (CONDOM 4b). Not final so a test can lower it. */
    static long ACCOUNT_MOST = 20L * 1024 * 1024 * 1024;

    static String gb(long bytes) {
        return bytes >= 1073741824L ? (bytes / 1073741824L) + " GB" : mb(bytes);
    }

    static String mb(long bytes) {
        return (bytes / 1048576) + " MB";
    }

    static String audioType(String ext) {
        return AUDIO_TYPES.getOrDefault(ext == null ? "" : ext.toLowerCase(Locale.ROOT), "application/octet-stream");
    }

    static final Map<String, String> IMAGE_TYPES = Map.of(
            ".jpg", "image/jpeg", ".jpeg", "image/jpeg", ".png", "image/png", ".webp", "image/webp",
            ".gif", "image/gif", ".avif", "image/avif");

    /** A stored file as a response (Spring answers Range itself); 410 with the given words if gone. */
    static org.springframework.http.ResponseEntity<org.springframework.core.io.Resource> serve(
            java.nio.file.Path path, String type, String downloadName, String missing) {
        if (!java.nio.file.Files.isRegularFile(path)) throw new ApiError(missing, 410);
        org.springframework.http.ResponseEntity.BodyBuilder b = org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.parseMediaType(type));
        if (downloadName != null)
            b.header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + downloadName + "\"");
        return b.body(new org.springframework.core.io.FileSystemResource(path));
    }

    /** Python's "%s" of a list of ints, e.g. [5, 9]. */
    static String listRepr(java.util.List<?> items) {
        StringBuilder s = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) s.append(", ");
            Object o = items.get(i);
            s.append(o instanceof String ? "'" + o + "'" : o == null ? "None" : String.valueOf(o));
        }
        return s.append("]").toString();
    }

    /** The extension of a file name, lower case, with the dot ("" if none). */
    static String extOf(String name) {
        int dot = name.lastIndexOf('.');
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        // like os.path.splitext: no dot after the last slash, or a leading dot only, is no extension
        if (dot < 0 || dot < slash || dot == slash + 1) return "";
        return name.substring(dot).toLowerCase(Locale.ROOT);
    }

    /** Header as a trimmed string, "" when absent. */
    static String header(HttpServletRequest req, String name) {
        // The desktop app (Java) cannot put non-ASCII bytes in a header value, so it also sends
        // "<name>-Enc" with the value percent-encoded as UTF-8. Python clients just send the raw value.
        String enc = req.getHeader(name + "-Enc");
        if (enc != null) {
            try { return java.net.URLDecoder.decode(enc.replace("+", "%2B"), java.nio.charset.StandardCharsets.UTF_8).strip(); }
            catch (IllegalArgumentException ignored) { /* fall through to the plain header */ }
        }
        String v = req.getHeader(name);
        return v == null ? "" : v.strip();
    }
}
