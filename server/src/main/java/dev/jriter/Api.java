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

    static String audioType(String ext) {
        return AUDIO_TYPES.getOrDefault(ext == null ? "" : ext.toLowerCase(Locale.ROOT), "application/octet-stream");
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
        String v = req.getHeader(name);
        return v == null ? "" : v.strip();
    }
}
