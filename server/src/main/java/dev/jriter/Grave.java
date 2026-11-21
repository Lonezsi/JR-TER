package dev.jriter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.stereotype.Component;

/**
 * The grave, a port of jriter/modules/grave.py: deleted things are copied here row for row
 * (the same JSON Python writes, so either server can bring back what the other buried) and
 * stay KEEP_DAYS. Their files are never deleted while something here still needs them.
 */
@Component
public class Grave {
    static final int KEEP_DAYS = 30;
    static final List<String> ORDER = List.of("songs", "song_titles", "albums", "album_songs", "playlists", "versions",
            "renders", "lyric_sheets", "lyric_revisions", "artwork", "sound_presets", "arrangements", "playlist_items",
            "vocal_takes", "youtube_posts");
    static final Map<String, String> POINTS_AT = new LinkedHashMap<>();
    static final Map<String, List<String>> BLOB_COLUMNS = new LinkedHashMap<>();
    static final Map<String, String> KIND_SAID = Map.of("song", "Song", "album", "Album", "playlist", "Playlist",
            "version", "Render", "sheet", "Words", "image", "Picture", "render", "Inbox render", "take", "Vocal take");
    static final String[][] POINTERS = {{"versions", "digest"}, {"renders", "digest"}, {"artwork", "digest"},
            {"vocal_takes", "digest"}, {"albums", "cover_digest"}};
    private static final ObjectMapper JSON = new ObjectMapper();

    static {
        POINTS_AT.put("song_id", "songs");
        POINTS_AT.put("album_id", "albums");
        POINTS_AT.put("sheet_id", "lyric_sheets");
        POINTS_AT.put("playlist_id", "playlists");
        POINTS_AT.put("render_id", "renders");
        POINTS_AT.put("version_id", "versions");
        POINTS_AT.put("current_version_id", "versions");
        BLOB_COLUMNS.put("versions", List.of("digest"));
        BLOB_COLUMNS.put("renders", List.of("digest"));
        BLOB_COLUMNS.put("artwork", List.of("digest"));
        BLOB_COLUMNS.put("vocal_takes", List.of("digest"));
        BLOB_COLUMNS.put("albums", List.of("cover_digest"));
    }

    private final Blobs blobs;

    public Grave(Blobs blobs) { this.blobs = blobs; }

    // -- reading ----------------------------------------------------------------------

    private static List<Map<String, Object>> rows(Library.Db db, String table, String where, Object... args) {
        if (!db.tableExists(table)) return new ArrayList<>();
        return db.query("SELECT * FROM " + table + " WHERE " + where, args);
    }

    private static List<Object> ids(List<Map<String, Object>> rows) {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> r : rows) if (r.containsKey("id")) out.add(r.get("id"));
        return out;
    }

    private static String in(String col, List<Object> ids) {
        return ids.isEmpty() ? "0" : col + " IN (" + String.join(",", Collections.nCopies(ids.size(), "?")) + ")";
    }

    private static String text(List<Map<String, Object>> rows, String key) {
        if (rows.isEmpty()) return "";
        Object v = rows.get(0).get(key);
        return v == null ? "" : String.valueOf(v);
    }

    private long bury(Library.Db db, long account, String kind, String title, Map<String, List<Map<String, Object>>> all) {
        Map<String, List<Map<String, Object>>> tables = new LinkedHashMap<>();
        for (Map.Entry<String, List<Map<String, Object>>> e : all.entrySet())
            if (!e.getValue().isEmpty()) tables.put(e.getKey(), e.getValue());
        Set<String> digests = new TreeSet<>();
        for (Map.Entry<String, List<String>> bc : BLOB_COLUMNS.entrySet())
            for (Map<String, Object> row : tables.getOrDefault(bc.getKey(), List.of()))
                for (String c : bc.getValue())
                    if (row.get(c) != null && !String.valueOf(row.get(c)).isEmpty()) digests.add(String.valueOf(row.get(c)));
        forgetOld(db, account);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("kind", kind);
        v.put("title", title == null ? "" : title);
        v.put("deleted_at", Accounts.now());
        try {
            v.put("tables", JSON.writeValueAsString(tables));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        v.put("digests", String.join(" ", digests));
        return db.insert("grave", v);
    }

    private static Map<String, List<Map<String, Object>>> map(Object... kv) {
        Map<String, List<Map<String, Object>>> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>) kv[i + 1];
            m.put((String) kv[i], rows);
        }
        return m;
    }

    public long burySong(Library.Db db, long account, Object songId) {
        List<Object> id = List.of(songId);
        List<Map<String, Object>> songs = rows(db, "songs", in("id", id), id.toArray());
        List<Map<String, Object>> sheets = rows(db, "lyric_sheets", in("song_id", id), id.toArray());
        List<Object> sheetIds = ids(sheets);
        return bury(db, account, "song", text(songs, "title"), map(
                "songs", songs,
                "song_titles", rows(db, "song_titles", in("song_id", id), id.toArray()),
                "album_songs", rows(db, "album_songs", in("song_id", id), id.toArray()),
                "versions", rows(db, "versions", in("song_id", id), id.toArray()),
                "renders", rows(db, "renders", in("song_id", id), id.toArray()),
                "lyric_sheets", sheets,
                "lyric_revisions", rows(db, "lyric_revisions", in("sheet_id", sheetIds), sheetIds.toArray()),
                "artwork", rows(db, "artwork", in("song_id", id), id.toArray()),
                "sound_presets", rows(db, "sound_presets", in("song_id", id), id.toArray()),
                "arrangements", rows(db, "arrangements", in("song_id", id), id.toArray()),
                "playlist_items", rows(db, "playlist_items", in("song_id", id), id.toArray()),
                "vocal_takes", rows(db, "vocal_takes", in("song_id", id), id.toArray()),
                "youtube_posts", rows(db, "youtube_posts", in("song_id", id), id.toArray())));
    }

    public long buryAlbum(Library.Db db, long account, Object albumId) {
        List<Map<String, Object>> albums = rows(db, "albums", "id = ?", albumId);
        List<Map<String, Object>> lists = rows(db, "playlists", "album_id = ?", albumId);
        List<Object> listIds = ids(lists);
        return bury(db, account, "album", text(albums, "title"), map(
                "albums", albums,
                "album_songs", rows(db, "album_songs", "album_id = ?", albumId),
                "playlists", lists,
                "playlist_items", rows(db, "playlist_items", in("playlist_id", listIds), listIds.toArray())));
    }

    public long buryPlaylist(Library.Db db, long account, Object playlistId) {
        List<Map<String, Object>> lists = rows(db, "playlists", "id = ?", playlistId);
        return bury(db, account, "playlist", text(lists, "title"), map(
                "playlists", lists,
                "playlist_items", rows(db, "playlist_items", "playlist_id = ?", playlistId)));
    }

    public long buryVersion(Library.Db db, long account, Object versionId) {
        List<Map<String, Object>> v = rows(db, "versions", "id = ?", versionId);
        String title = "";
        if (!v.isEmpty()) {
            String song = text(rows(db, "songs", "id = ?", v.get(0).get("song_id")), "title");
            title = "v" + v.get(0).get("n") + " of " + (song.isEmpty() ? "a song" : song);
        }
        return bury(db, account, "version", title, map("versions", v));
    }

    public long burySheet(Library.Db db, long account, Object sheetId) {
        List<Map<String, Object>> sheets = rows(db, "lyric_sheets", "id = ?", sheetId);
        return bury(db, account, "sheet", text(sheets, "name"), map(
                "lyric_sheets", sheets,
                "lyric_revisions", rows(db, "lyric_revisions", "sheet_id = ?", sheetId)));
    }

    public long buryImage(Library.Db db, long account, Object imageId) {
        List<Map<String, Object>> r = rows(db, "artwork", "id = ?", imageId);
        String caption = text(r, "caption");
        return bury(db, account, "image", caption.isEmpty() ? "A picture" : caption, map("artwork", r));
    }

    public long buryRender(Library.Db db, long account, Object renderId) {
        List<Map<String, Object>> r = rows(db, "renders", "id = ?", renderId);
        String name = text(r, "filename");
        return bury(db, account, "render", name.isEmpty() ? "A render" : name, map("renders", r));
    }

    public long buryTake(Library.Db db, long account, Object takeId) {
        List<Map<String, Object>> r = rows(db, "vocal_takes", "id = ?", takeId);
        String name = text(r, "name");
        return bury(db, account, "take", name.isEmpty() ? "A take" : name, map("vocal_takes", r));
    }

    // -- the files --------------------------------------------------------------------

    /** Whether anything in the grave still needs this file. */
    public static boolean holds(Library.Db db, String digest) {
        if (digest == null || digest.isEmpty() || !db.tableExists("grave")) return false;
        return db.one("SELECT 1 FROM grave WHERE ' ' || digests || ' ' LIKE ? LIMIT 1", "% " + digest + " %") != null;
    }

    private void release(Library.Db db, long account, List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            String digests = (String) row.get("digests");
            if (digests == null) continue;
            for (String digest : digests.split("\\s+")) {
                if (digest.isEmpty() || holds(db, digest)) continue;
                boolean used = false;
                for (String[] p : POINTERS)
                    if (db.tableExists(p[0]) && db.one("SELECT 1 FROM " + p[0] + " WHERE " + p[1] + " = ? LIMIT 1", digest) != null) used = true;
                if (!used) blobs.delete(account, digest);
            }
        }
    }

    int leave(Library.Db db, long account, String where, Object... args) {
        List<Map<String, Object>> rows = db.query("SELECT id, digests FROM grave WHERE " + where, args);
        if (!rows.isEmpty()) {
            db.run("DELETE FROM grave WHERE " + where, args);
            release(db, account, rows);
        }
        return rows.size();
    }

    void forgetOld(Library.Db db, long account) {
        leave(db, account, "deleted_at < ?", Accounts.now() - KEEP_DAYS * 86400.0);
    }

    // -- bringing back ----------------------------------------------------------------

    private static Long key(Object o) { return o instanceof Number n ? Long.valueOf(n.longValue()) : null; }

    int restore(Library.Db db, String tablesJson) {
        Map<String, List<Map<String, Object>>> tables;
        try {
            tables = JSON.readValue(tablesJson, new TypeReference<Map<String, List<Map<String, Object>>>>() {});
        } catch (JsonProcessingException e) {
            throw new ApiError("that grave entry is damaged", 500);
        }
        Map<String, Map<Long, Long>> fresh = new HashMap<>();
        for (String t : ORDER) fresh.put(t, new HashMap<>());
        List<Object[]> late = new ArrayList<>();
        int back = 0;
        for (String table : ORDER) {
            if (!tables.containsKey(table) || !db.tableExists(table)) continue;
            Set<String> have = new HashSet<>(db.columns(table));
            for (Map<String, Object> row : tables.get(table)) {
                Map<String, Object> values = new LinkedHashMap<>();
                for (Map.Entry<String, Object> e : row.entrySet()) if (have.contains(e.getKey())) values.put(e.getKey(), e.getValue());
                for (Map.Entry<String, String> p : POINTS_AT.entrySet()) {
                    String col = p.getKey();
                    if (!values.containsKey(col) || values.get(col) == null) continue;
                    if (table.equals("songs") && col.equals("current_version_id")) {
                        late.add(new Object[] {table, row.get("id"), col, values.remove(col)});
                        continue;
                    }
                    Long mapped = fresh.get(p.getValue()).get(key(values.get(col)));
                    if (mapped != null) values.put(col, mapped);
                }
                Object oldId = values.get("id");
                if (oldId != null && db.one("SELECT 1 FROM " + table + " WHERE id = ?", oldId) != null) values.remove("id");
                long made;
                try {
                    made = db.insert(table, values);
                } catch (Exception e) {
                    continue; // links to something that is itself gone: this row stays out
                }
                back++;
                if (oldId != null) fresh.get(table).put(key(oldId), values.get("id") != null ? key(values.get("id")) : made);
            }
        }
        for (Object[] l : late) {
            String table = (String) l[0];
            Long rid = fresh.get(table).get(key(l[1]));
            Long target = fresh.get("versions").get(key(l[3]));
            db.run("UPDATE " + table + " SET " + l[2] + " = ? WHERE id = ?", target != null ? target : l[3], rid != null ? rid : l[1]);
        }
        return back;
    }
}
