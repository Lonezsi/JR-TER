package dev.jriter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Stream;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * A copy of the library, and getting rid of it: a port of jriter/modules/export.py.
 *
 * WHAT IS TAKEN is named table by table and column by column (TAKEN), never "everything minus
 * a list to hide", so a table or column added later is not exported until somebody has said so.
 * NEVER in it: the password hash and salt, the session key, Google secrets, machine token
 * digests (those live in auth.json, youtube.json and one column of auth_tokens). The audio is
 * only included when asked. Differences from Python: settings.json in the zip is the stored
 * file as it is, without the defaults filled in.
 */
@RestController
public class ExportController {
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private static final ObjectMapper PLAIN = new ObjectMapper();

    static final Map<String, String[]> TAKEN = new LinkedHashMap<>();
    static {
        TAKEN.put("songs", new String[] {"id", "title", "notes", "current_version_id", "created_at", "updated_at", "opened"});
        TAKEN.put("song_titles", new String[] {"id", "song_id", "title", "changed_at"});
        TAKEN.put("versions", new String[] {"id", "song_id", "n", "digest", "ext", "size", "duration", "bitrate",
                "label", "filename", "source_path", "created_at", "project_at", "rendered_at", "peak_db", "trouble", "plugins"});
        TAKEN.put("renders", new String[] {"id", "digest", "ext", "size", "duration", "bitrate", "filename",
                "source_path", "origin", "created_at", "used_at", "project_at", "rendered_at", "peak_db", "trouble", "plugins",
                "song_id", "version_id"});
        TAKEN.put("lyric_sheets", new String[] {"id", "song_id", "name", "position", "is_current", "created_at"});
        TAKEN.put("lyric_revisions", new String[] {"id", "sheet_id", "text", "created_at"});
        TAKEN.put("albums", new String[] {"id", "title", "year", "notes", "cover_digest", "cover_ext", "stickers",
                "created_at", "updated_at", "opened"});
        TAKEN.put("album_songs", new String[] {"album_id", "song_id", "position"});
        TAKEN.put("playlists", new String[] {"id", "title", "album_id", "created_at", "updated_at"});
        TAKEN.put("playlist_items", new String[] {"id", "playlist_id", "position", "song_id", "render_id", "added_at"});
        TAKEN.put("artwork", new String[] {"id", "song_id", "digest", "ext", "position", "caption", "created_at"});
        TAKEN.put("sound_presets", new String[] {"id", "song_id", "name", "is_current", "data", "created_at", "updated_at"});
        TAKEN.put("arrangements", new String[] {"song_id", "version_id", "bpm", "offset", "per_bar", "enabled", "data", "updated_at"});
        TAKEN.put("samples", new String[] {"id", "name", "folder", "digest", "ext", "size", "duration", "created_at", "deleted_at"});
        TAKEN.put("daw_projects", new String[] {"song_id", "text", "rev", "updated_at", "updated_by"});
        TAKEN.put("youtube_posts", new String[] {"id", "song_id", "version_id", "url", "title", "status", "note",
                "created_at", "updated_at", "video_id", "mix_digest"});
        TAKEN.put("sync_folders", new String[] {"id", "path", "enabled", "last_scan", "created_at"});
        TAKEN.put("orarend_notes", new String[] {"id", "subject", "absences", "created_at", "updated_at"});
        TAKEN.put("orarend_pages", new String[] {"id", "note_id", "position", "text", "created_at", "updated_at"});
        // Never `digest` of a token: that column is what the token is checked against.
        TAKEN.put("auth_tokens", new String[] {"id", "name", "scope", "created_at", "last_used"});
        // Not `before`: every one of those rows is already in this export in its own table.
        TAKEN.put("guest_edits", new String[] {"id", "song_id", "account", "share_id", "what", "route", "created_at",
                "updated_at", "undone_at"});
        TAKEN.put("vocal_takes", new String[] {"id", "song_id", "author", "name", "digest", "ext", "size", "duration",
                "offset", "enabled", "gain", "chain", "created_at", "updated_at"});
    }

    static final Map<String, String> SKIPPED = new LinkedHashMap<>();
    static {
        SKIPPED.put("migrations", "bookkeeping: which schema steps have run");
        SKIPPED.put("sync_seen", "a cache of every file ever scanned, rebuilt by the next scan");
        SKIPPED.put("grave", "deleted things kept for a while; bring them back first to have them in a copy");
    }

    static final String FORMAT = "jriter-library";
    static final int VERSION = 2;
    static final String ABOUT = "Every row this library keeps, table by table. Ids are this library's own; every "
            + "*_id column points at a row in another table here. Audio and pictures are named by "
            + "the SHA-256 of their bytes (digest) and, when included, sit in audio/<digest>.<ext>. "
            + "Import adds these rows to a library with new ids; it never deletes anything.";

    static final Map<String, String[]> BLOB_COLUMNS = new LinkedHashMap<>();
    static {
        BLOB_COLUMNS.put("versions", new String[] {"digest", "ext"});
        BLOB_COLUMNS.put("renders", new String[] {"digest", "ext"});
        BLOB_COLUMNS.put("artwork", new String[] {"digest", "ext"});
        BLOB_COLUMNS.put("vocal_takes", new String[] {"digest", "ext"});
        BLOB_COLUMNS.put("samples", new String[] {"digest", "ext"});
        BLOB_COLUMNS.put("albums", new String[] {"cover_digest", "cover_ext"});
    }

    static final String INSIDE = """
            This is a JR!TER library: everything it holds about your songs, as text.

              library.json            every row it keeps, table by table (format "jriter-library",
                                      version 2). This is the part JR!TER reads back in.
              settings.json           your settings
              songs/<title>/words.md  each song's current words, as you typed them
              songs/<title>/song.txt  the song in plain words: renders, arrangement, sound
              audio/<digest>.<ext>    the audio and pictures, if this copy was taken with audio
              README.txt              this file

            To bring it back, into this library or any other: Settings, Library, Bring a library in.
            That adds what is in here; it never replaces or deletes anything. The format is written
            down in docs/library-format.md in JR!TER's source.

            WHAT IS NOT IN HERE

            Unless this copy was taken with audio: the audio and the artwork. Every render and version
            in library.json names the SHA-256 of its bytes under "digest". The file itself is in your
            data directory at

                data/blobs/<first two characters>/<next two>/<the whole digest>

            Copy that folder and you have the sound as well.

            Your password hash and salt, the session signing key, and any Google client secret or
            refresh token. Those are left out on purpose: a copy of your library that also opens the
            door is not a copy, it is a second key.

            Taken %s from %s.
            """;

    static final List<String> IMPORTED = List.of("songs", "song_titles", "albums", "album_songs", "versions", "renders",
            "lyric_sheets", "lyric_revisions", "artwork", "sound_presets", "arrangements", "daw_projects",
            "playlists", "playlist_items", "vocal_takes", "samples");
    static final Map<String, String> POINTS_AT = Map.of("song_id", "songs", "album_id", "albums",
            "sheet_id", "lyric_sheets", "playlist_id", "playlists", "render_id", "renders",
            "version_id", "versions", "current_version_id", "versions");
    static final long MAX_IMPORT = 4L * 1024 * 1024 * 1024;

    private final Library library;
    private final Blobs blobs;
    private final Accounts accounts;
    private final Config config;

    public ExportController(Library library, Blobs blobs, Accounts accounts, Config config) {
        this.library = library;
        this.blobs = blobs;
        this.accounts = accounts;
        this.config = config;
    }

    // -- settings ---------------------------------------------------------------------

    private Map<String, Object> settings(long acct) {
        try {
            Path p = config.home(acct).resolve("settings.json");
            if (Files.isRegularFile(p)) {
                Map<String, Object> m = PLAIN.readValue(p.toFile(), new TypeReference<Map<String, Object>>() {});
                return m == null ? new LinkedHashMap<>() : m;
            }
        } catch (IOException ignored) { /* a broken settings file reads as none, like config._read */ }
        return new LinkedHashMap<>();
    }

    private String libraryName(long acct) {
        Object n = settings(acct).get("library_name");
        return n == null || String.valueOf(n).isEmpty() ? "JR!TER" : String.valueOf(n);
    }

    // -- python formatting helpers ----------------------------------------------------

    /** Python's "%s" of a number or string. */
    static String pyStr(Object o) {
        if (o == null) return "None";
        if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) return Double.isNaN(d) ? "nan" : d > 0 ? "inf" : "-inf";
            String s = BigDecimal.valueOf(d).toPlainString();
            return s.contains(".") ? s : s + ".0";
        }
        if (o instanceof Boolean b) return b ? "True" : "False";
        return String.valueOf(o);
    }

    private static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof Number n) return n.doubleValue() != 0;
        if (o instanceof String s) return !s.isEmpty();
        if (o instanceof Boolean b) return b;
        return true;
    }

    private static double num(Object o) { return o instanceof Number n ? n.doubleValue() : 0; }

    private static String clock(Object t) {
        if (!truthy(t)) return "?";
        return LocalDateTime.ofInstant(Instant.ofEpochMilli((long) (num(t) * 1000)), ZoneId.systemDefault())
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
    }

    static String slug(Object title, int n) {
        String t = truthy(title) ? String.valueOf(title) : "untitled";
        StringBuilder keep = new StringBuilder();
        for (char c : t.toCharArray())
            keep.append(Character.isLetterOrDigit(c) || " -_()'".indexOf(c) >= 0 ? c : ' ');
        String joined = String.join(" ", keep.toString().strip().split("\\s+"));
        String s = String.format("%03d %s", n, joined);
        if (s.length() > 80) s = s.substring(0, 80);
        return s.strip();
    }

    // -- the rows ---------------------------------------------------------------------

    private Map<String, Object> rows(Library.Db db) {
        Map<String, Object> out = new TreeMap<>();
        for (Map.Entry<String, String[]> e : TAKEN.entrySet()) {
            if (!db.tableExists(e.getKey())) continue;
            Set<String> have = new HashSet<>(db.columns(e.getKey()));
            List<String> wanted = new ArrayList<>();
            for (String c : e.getValue()) if (have.contains(c)) wanted.add(c);
            if (wanted.isEmpty()) continue;
            List<Map<String, Object>> picked = new ArrayList<>();
            for (Map<String, Object> r : db.query("SELECT " + String.join(", ", wanted) + " FROM " + e.getKey())) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (String c : wanted) row.put(c, r.get(c));
                picked.add(row);
            }
            out.put(e.getKey(), picked);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> by(Map<String, Object> tables, String name) {
        Object v = tables.get(name);
        return v == null ? List.of() : (List<Map<String, Object>>) v;
    }

    private static long id(Map<String, Object> r, String key) {
        Object v = r.get(key);
        return v instanceof Number n ? n.longValue() : 0;
    }

    private static boolean sameId(Object a, Object b) {
        return a instanceof Number x && b instanceof Number y && x.longValue() == y.longValue();
    }

    /** songs/<title>/words.md and song.txt: the library for people, written from the rows. */
    private static Map<String, String> songFiles(Map<String, Object> tables) {
        Map<String, String> out = new LinkedHashMap<>();
        List<Map<String, Object>> songs = new ArrayList<>(by(tables, "songs"));
        songs.sort(Comparator.comparingLong(r -> id(r, "id")));
        int n = 0;
        for (Map<String, Object> song : songs) {
            n++;
            Object sid = song.get("id");
            String folder = "songs/" + slug(song.get("title"), n) + "/";
            List<Map<String, Object>> sheets = new ArrayList<>();
            for (Map<String, Object> s : by(tables, "lyric_sheets")) if (sameId(s.get("song_id"), sid)) sheets.add(s);
            Map<String, Object> current = null;
            for (Map<String, Object> s : sheets) if (truthy(s.get("is_current"))) { current = s; break; }
            if (current == null && !sheets.isEmpty()) current = sheets.get(0);
            if (current != null) {
                Map<String, Object> latest = null;
                for (Map<String, Object> r : by(tables, "lyric_revisions")) {
                    if (!sameId(r.get("sheet_id"), current.get("id"))) continue;
                    if (latest == null || num(r.get("created_at")) > num(latest.get("created_at"))
                            || (num(r.get("created_at")) == num(latest.get("created_at")) && id(r, "id") >= id(latest, "id")))
                        latest = r;
                }
                if (latest != null) out.put(folder + "words.md", truthy(latest.get("text")) ? String.valueOf(latest.get("text")) : "");
            }
            List<String> lines = new ArrayList<>();
            lines.add(truthy(song.get("title")) ? String.valueOf(song.get("title")) : "untitled");
            lines.add("");
            if (truthy(song.get("notes")) && !String.valueOf(song.get("notes")).strip().isEmpty()) {
                lines.add(String.valueOf(song.get("notes")).strip());
                lines.add("");
            }
            lines.add("Started " + clock(song.get("created_at")) + ", last touched " + clock(song.get("updated_at")) + ".");
            List<Map<String, Object>> versions = new ArrayList<>();
            for (Map<String, Object> v : by(tables, "versions")) if (sameId(v.get("song_id"), sid)) versions.add(v);
            versions.sort(Comparator.comparingDouble(v -> num(v.get("n"))));
            if (!versions.isEmpty()) {
                lines.add("");
                lines.add("Renders");
                for (Map<String, Object> v : versions) {
                    String mark = sameId(v.get("id"), song.get("current_version_id")) ? " (current)" : "";
                    long secs = (long) Math.floor(num(v.get("duration")));
                    String label = truthy(v.get("label")) ? pyStr(v.get("label"))
                            : truthy(v.get("filename")) ? pyStr(v.get("filename")) : "";
                    lines.add(String.format("  v%s  %s  %d:%02d  %s.%s%s", pyStr(v.get("n")), label,
                            Math.floorDiv(secs, 60), Math.floorMod(secs, 60), pyStr(v.get("digest")), pyStr(v.get("ext")), mark));
                }
            }
            Map<String, Object> arr = null;
            for (Map<String, Object> a : by(tables, "arrangements")) if (sameId(a.get("song_id"), sid)) { arr = a; break; }
            if (arr != null) {
                lines.add("");
                lines.add("Arrangement");
                lines.add("  " + pyStr(arr.get("bpm")) + " bpm, beat one at " + pyStr(arr.get("offset")) + "s, "
                        + pyStr(arr.get("per_bar")) + " beats a bar, " + (truthy(arr.get("enabled")) ? "on" : "off"));
                try {
                    String raw = truthy(arr.get("data")) ? String.valueOf(arr.get("data")) : "{}";
                    Object data = PLAIN.readValue(raw, Object.class);
                    if (data instanceof Map<?, ?> m && m.get("clips") instanceof List<?> clips)
                        for (Object c : clips)
                            if (c instanceof Map<?, ?> clip)
                                lines.add("  " + pyStr(clip.get("beats")) + " beats from beat " + pyStr(clip.get("from")));
                } catch (IOException | RuntimeException ignored) { /* damaged arrangement data is left out */ }
            }
            List<Map<String, Object>> presets = new ArrayList<>();
            for (Map<String, Object> p : by(tables, "sound_presets")) if (sameId(p.get("song_id"), sid)) presets.add(p);
            if (!presets.isEmpty()) {
                lines.add("");
                lines.add("Sound presets");
                for (Map<String, Object> p : presets) {
                    lines.add("  " + pyStr(p.get("name")) + (truthy(p.get("is_current")) ? " (current)" : ""));
                    lines.add("    " + (truthy(p.get("data")) ? String.valueOf(p.get("data")) : "{}"));
                }
            }
            out.put(folder + "song.txt", String.join("\n", lines) + "\n");
        }
        return out;
    }

    private static Map<String, String> blobsIn(Map<String, Object> tables) {
        Map<String, String> seen = new LinkedHashMap<>();
        for (Map.Entry<String, String[]> e : BLOB_COLUMNS.entrySet())
            for (Map<String, Object> row : by(tables, e.getKey()))
                if (truthy(row.get(e.getValue()[0])))
                    seen.put(String.valueOf(row.get(e.getValue()[0])),
                            truthy(row.get(e.getValue()[1])) ? String.valueOf(row.get(e.getValue()[1])) : "bin");
        return seen;
    }

    // -- routes -----------------------------------------------------------------------

    /** The whole library as text, in a zip, written straight to the response. */
    @GetMapping("/api/export")
    public ResponseEntity<StreamingResponseBody> take(HttpServletRequest req) {
        long acct = Api.acct(req);
        Library.Db db = library.of(acct);
        String audio = req.getParameter("audio");
        boolean withAudio = audio != null && (audio.equals("1") || audio.equals("true") || audio.equals("yes"));
        String when = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        String name = libraryName(acct);
        Map<String, Object> tables = rows(db);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("format", FORMAT);
        body.put("version", VERSION);
        body.put("about", ABOUT);
        body.put("taken_at", System.currentTimeMillis() / 1000.0);
        body.put("library", name);
        body.put("tables", tables);
        body.put("left_out", SKIPPED);
        Map<String, Object> settings = settings(acct);
        Map<String, String> files = songFiles(tables);
        Map<String, String> audioFiles = withAudio ? blobsIn(tables) : Map.of();

        StreamingResponseBody stream = (OutputStream out) -> {
            ZipOutputStream z = new ZipOutputStream(out, StandardCharsets.UTF_8);
            put(z, "library.json", JSON.writeValueAsString(body));
            put(z, "settings.json", JSON.writeValueAsString(settings));
            put(z, "README.txt", INSIDE.formatted(when, name));
            for (Map.Entry<String, String> f : files.entrySet()) put(z, f.getKey(), f.getValue());
            for (Map.Entry<String, String> a : audioFiles.entrySet()) {
                String digest = a.getKey();
                if (digest.length() < 4) continue;
                Path p = blobs.pathFor(acct, digest);
                if (!Files.isRegularFile(p)) continue;
                z.setLevel(Deflater.NO_COMPRESSION);   // audio is already compressed: stored
                z.putNextEntry(new ZipEntry("audio/" + digest + "." + a.getValue()));
                Files.copy(p, z);
                z.closeEntry();
                z.setLevel(Deflater.DEFAULT_COMPRESSION);
            }
            z.finish();
            z.flush();
        };
        String file = "jriter-" + java.time.LocalDate.now() + ".zip";
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file + "\"")
                .body(stream);
    }

    private static void put(ZipOutputStream z, String name, String text) throws IOException {
        z.putNextEntry(new ZipEntry(name));
        z.write(text.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }

    private static Map<String, Object> weigh(Path path, String how) {
        long total = 0;
        if (Files.isRegularFile(path)) {
            try { total = Files.size(path); } catch (IOException ignored) { /* counts as 0 */ }
        } else if (Files.isDirectory(path)) {
            try (Stream<Path> s = Files.walk(path)) {
                for (Path f : (Iterable<Path>) s.filter(Files::isRegularFile)::iterator) {
                    try { total += Files.size(f); } catch (IOException ignored) { /* skip */ }
                }
            } catch (IOException ignored) { /* skip */ }
        } else {
            return null;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("path", path.toString());
        m.put("bytes", total);
        m.put("how", how);
        return m;
    }

    /** What Erase would remove, before it removes it, with the sizes. */
    @GetMapping("/api/export/erase")
    public Object whatEraseTakes(HttpServletRequest req) {
        long acct = Api.acct(req);
        Path home = config.home(acct);
        List<Map<String, Object>> goes = new ArrayList<>();
        for (Map<String, Object> g : List.of(
                orEmpty(weigh(home.resolve("jriter.db"), "every row inside it, then the file is compacted to empty")),
                orEmpty(weigh(home.resolve("blobs"), "every file in it")),
                orEmpty(weigh(home.resolve("settings.json"), "deleted"))))
            if (!g.isEmpty()) goes.add(g);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("library", libraryName(acct));
        out.put("goes", goes);
        return out;
    }

    private static Map<String, Object> orEmpty(Map<String, Object> m) { return m == null ? Map.of() : m; }

    /** Everything, after the library's name is typed. */
    @PostMapping("/api/export/erase")
    public Object erase(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        String said = Body.str(Body.json(req), "confirm");
        String want = libraryName(acct);
        if (!said.strip().equals(want)) throw new ApiError("Type the library's name, " + want + ", to erase it.", 400);

        List<String> gone = new ArrayList<>();
        // Every open share first: an erased library numbers its songs from 1 again.
        int takenBack = accounts.revokeSharesFor(acct, null);
        if (takenBack > 0) gone.add(takenBack + " open share" + (takenBack == 1 ? "" : "s"));

        Library.Db db = library.of(acct);
        List<String> tables = new ArrayList<>();
        for (Map<String, Object> r : db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
            if (!"migrations".equals(r.get("name"))) tables.add((String) r.get("name"));
        // Foreign keys are enforced here, so a parent can refuse to go before its children:
        // keep going round until every table is empty.
        List<String> left = new ArrayList<>(tables);
        for (int pass = 0; pass < tables.size() + 1 && !left.isEmpty(); pass++) {
            List<String> next = new ArrayList<>();
            for (String t : left) {
                try {
                    db.run("DELETE FROM " + t);
                } catch (RuntimeException e) {
                    next.add(t);
                    continue;
                }
                if (pass == 0 || !gone.contains("every row of " + t)) gone.add("every row of " + t);
            }
            left = next;
        }
        if (!left.isEmpty()) throw new ApiError("Could not empty " + String.join(", ", left) + ".", 500);
        db.run("VACUUM");

        Path blobDir = config.home(acct).resolve("blobs");
        if (Files.isDirectory(blobDir)) {
            try (Stream<Path> s = Files.walk(blobDir)) {
                for (Path f : (Iterable<Path>) s.filter(Files::isRegularFile)::iterator) {
                    try { Files.delete(f); } catch (IOException ignored) { /* best effort, like Python */ }
                }
            }
            gone.add("every file under " + blobDir);
        }
        Path settingsFile = config.home(acct).resolve("settings.json");
        if (Files.deleteIfExists(settingsFile)) gone.add(settingsFile.toString());
        config.ensureHome(acct);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("gone", gone);
        out.put("left", List.of(
                "Your password, so the door still works. Change it in Settings.",
                "Any Google account is disconnected from this machine only. Revoking it is "
                        + "done at Google, on your account's third party access page.",
                "The desktop agent's own file on whichever machine runs it. Revoke its token "
                        + "in Settings, which is what actually stops it working."));
        return out;
    }

    // -- bringing a library in --------------------------------------------------------

    /** Add the songs, albums, playlists and everything about them from a library file. */
    @PostMapping("/api/import")
    public Object bringIn(HttpServletRequest req) throws IOException {
        long acct = Api.acct(req);
        long length = req.getContentLengthLong();
        if (length <= 0) throw new ApiError("That upload had no file in it.");
        if (length > MAX_IMPORT) throw new ApiError("That file is bigger than a library file can be.", 413);
        Path tmp = Files.createTempFile("jriter-import-", ".zip");
        try {
            try (InputStream in = req.getInputStream(); OutputStream out = Files.newOutputStream(tmp)) {
                byte[] buf = new byte[1 << 20];
                long left = length;
                while (left > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    left -= n;
                }
            }
            ZipFile z;
            try {
                z = new ZipFile(tmp.toFile());
            } catch (java.util.zip.ZipException e) {
                throw new ApiError("That isn't a JR!TER library file (it isn't a zip).");
            }
            try (z) {
                ZipEntry lib = z.getEntry("library.json");
                if (lib == null) throw new ApiError("That zip has no library.json, so it isn't a JR!TER library file.");
                Map<String, Object> body;
                try (InputStream in = z.getInputStream(lib)) {
                    body = PLAIN.readValue(in, new TypeReference<Map<String, Object>>() {});
                } catch (IOException | RuntimeException e) {
                    throw new ApiError("The library.json in that file is damaged.");
                }
                Object fmt = body.getOrDefault("format", FORMAT);
                long ver;
                try {
                    ver = body.get("version") == null ? 1 : ((Number) body.get("version")).longValue();
                } catch (ClassCastException e) {
                    throw new ApiError("The library.json in that file is damaged.");
                }
                if (!FORMAT.equals(fmt) || ver > VERSION)
                    throw new ApiError("That library file is from a newer JR!TER than this one. Update first.");
                Object t = body.get("tables");
                @SuppressWarnings("unchecked")
                Map<String, Object> tables = t instanceof Map ? (Map<String, Object>) t : new HashMap<>();
                return bringInTables(acct, tables, z);
            }
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    private boolean haveBlob(long acct, ZipFile z, Object digestO, Object extO) throws IOException {
        if (!truthy(digestO)) return true;
        String digest = String.valueOf(digestO);
        if (digest.length() >= 4 && Files.isRegularFile(blobs.pathFor(acct, digest))) return true;
        ZipEntry e = z.getEntry("audio/" + digest + "." + (truthy(extO) ? String.valueOf(extO) : "bin"));
        if (e == null) return false;
        try (InputStream in = z.getInputStream(e)) {
            return blobs.putStream(acct, in, e.getSize()).digest().equals(digest);
        }
    }

    private Object bringInTables(long acct, Map<String, Object> tables, ZipFile z) throws IOException {
        Library.Db db = library.of(acct);
        Map<String, Map<Long, Long>> newIds = new HashMap<>();
        for (String t : IMPORTED) newIds.put(t, new HashMap<>());
        Map<String, Object> counts = new LinkedHashMap<>();
        for (String k : List.of("songs", "albums", "playlists", "renders", "lyrics", "missing_audio")) counts.put(k, 0);
        List<Object[]> later = new ArrayList<>();      // {table, new id, column, old value}
        Map<String, String> countKey = Map.of("songs", "songs", "albums", "albums", "playlists", "playlists",
                "versions", "renders", "renders", "renders", "lyric_sheets", "lyrics");

        for (String table : IMPORTED) {
            if (!db.tableExists(table) || !(tables.get(table) instanceof List<?> list)) continue;
            Set<String> have = new HashSet<>(db.columns(table));
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> raw)) continue;
                Map<String, Object> row = new LinkedHashMap<>();
                for (Map.Entry<?, ?> en : raw.entrySet()) row.put(String.valueOf(en.getKey()), en.getValue());
                String[] blob = BLOB_COLUMNS.get(table);
                if (blob != null && !haveBlob(acct, z, row.get(blob[0]), row.get(blob[1]))) {
                    if (table.equals("albums")) {
                        row.put(blob[0], null);
                        row.put(blob[1], null);
                    } else {
                        counts.merge("missing_audio", 1, (a, b) -> (Integer) a + 1);
                        continue;
                    }
                }
                Map<String, Object> values = new LinkedHashMap<>();
                List<Object[]> mine = new ArrayList<>();
                boolean skip = false;
                for (Map.Entry<String, Object> en : row.entrySet()) {
                    String col = en.getKey();
                    Object value = en.getValue();
                    if (col.equals("id") || !have.contains(col)) continue;
                    String target = POINTS_AT.get(col);
                    if (target != null && value != null) {
                        Long mapped = value instanceof Number n ? newIds.get(target).get(n.longValue()) : null;
                        if (mapped == null) {
                            if (target.equals("versions") && table.equals("songs")) {
                                mine.add(new Object[] {table, null, col, value});
                                continue;
                            }
                            if (col.equals("song_id") || col.equals("sheet_id") || col.equals("playlist_id")
                                    || (col.equals("album_id") && table.equals("album_songs"))) {
                                skip = true;      // its owner didn't come in
                                break;
                            }
                            value = null;         // an optional link to something that didn't
                        } else {
                            value = mapped;
                        }
                    }
                    values.put(col, value);
                }
                if (skip || values.isEmpty()) continue;
                long newId = db.insert(table, values);
                if (row.containsKey("id") && row.get("id") instanceof Number n) newIds.get(table).put(n.longValue(), newId);
                for (Object[] m : mine) { m[1] = newId; later.add(m); }
                String key = countKey.get(table);
                if (key != null) counts.merge(key, 1, (a, b) -> (Integer) a + 1);
            }
        }
        // A song's current render points at a render made after the song.
        for (Object[] l : later) {
            Long mapped = l[3] instanceof Number n ? newIds.get("versions").get(n.longValue()) : null;
            if (l[1] != null && mapped != null) db.update((String) l[0], (Long) l[1], Map.of((String) l[2], mapped));
        }
        return counts;
    }
}
