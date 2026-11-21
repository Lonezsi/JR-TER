package dev.jriter;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Component;
import org.sqlite.Function;
import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteConnection;
import org.sqlite.SQLiteDataSource;

/**
 * One account's library: data/accounts/ID/jriter.db, the file jriter/db.py opens. The CREATE
 * statements are the ones in the Python modules' SCHEMA lists, character for character in
 * effect, and every one is IF NOT EXISTS, so opening a library Python made changes nothing.
 * The migrations table is not touched: Python owns that record while it is the way back.
 *
 * Every connection gets a "fold" SQL function (Python registers str.casefold under that name),
 * which search matches with.
 */
@Component
public class Library {
    static final String[] SCHEMA = {
        "CREATE TABLE IF NOT EXISTS songs (id INTEGER PRIMARY KEY, title TEXT NOT NULL,"
            + " notes TEXT NOT NULL DEFAULT '', current_version_id INTEGER,"
            + " created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS songs_title ON songs(title)",
        "CREATE TABLE IF NOT EXISTS song_titles (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " title TEXT NOT NULL, changed_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS song_titles_song ON song_titles(song_id, id DESC)",
        "CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " n INTEGER NOT NULL, digest TEXT NOT NULL, ext TEXT NOT NULL DEFAULT '.mp3',"
            + " size INTEGER NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0,"
            + " bitrate INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '',"
            + " filename TEXT NOT NULL DEFAULT '', source_path TEXT NOT NULL DEFAULT '',"
            + " created_at REAL NOT NULL, project_at REAL NOT NULL DEFAULT 0,"
            + " rendered_at REAL NOT NULL DEFAULT 0, peaks TEXT NOT NULL DEFAULT '',"
            + " peak_db REAL, trouble TEXT NOT NULL DEFAULT '')",
        "CREATE INDEX IF NOT EXISTS versions_song ON versions(song_id, n DESC)",
        "CREATE INDEX IF NOT EXISTS versions_digest ON versions(digest)",
        "CREATE TABLE IF NOT EXISTS renders (id INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE,"
            + " ext TEXT NOT NULL DEFAULT '.wav', size INTEGER NOT NULL DEFAULT 0,"
            + " duration REAL NOT NULL DEFAULT 0, bitrate INTEGER NOT NULL DEFAULT 0,"
            + " filename TEXT NOT NULL DEFAULT '', source_path TEXT NOT NULL DEFAULT '',"
            + " origin TEXT NOT NULL DEFAULT 'upload', created_at REAL NOT NULL,"
            + " used_at REAL NOT NULL DEFAULT 0, project_at REAL NOT NULL DEFAULT 0,"
            + " rendered_at REAL NOT NULL DEFAULT 0, peaks TEXT NOT NULL DEFAULT '',"
            + " peak_db REAL, trouble TEXT NOT NULL DEFAULT '', song_id INTEGER, version_id INTEGER)",
        "CREATE INDEX IF NOT EXISTS renders_waiting ON renders(used_at, created_at DESC)",
        // lyrics
        "CREATE TABLE IF NOT EXISTS lyric_sheets (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " name TEXT NOT NULL DEFAULT 'Alternative', position INTEGER NOT NULL DEFAULT 0,"
            + " is_current INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL)",
        "CREATE TABLE IF NOT EXISTS lyric_revisions (id INTEGER PRIMARY KEY,"
            + " sheet_id INTEGER NOT NULL REFERENCES lyric_sheets(id) ON DELETE CASCADE,"
            + " text TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS sheets_song ON lyric_sheets(song_id, position)",
        "CREATE INDEX IF NOT EXISTS revisions_sheet ON lyric_revisions(sheet_id, id DESC)",
        // arrange
        "CREATE TABLE IF NOT EXISTS arrangements (song_id INTEGER PRIMARY KEY"
            + " REFERENCES songs(id) ON DELETE CASCADE, version_id INTEGER,"
            + " bpm REAL NOT NULL DEFAULT 120, offset REAL NOT NULL DEFAULT 0,"
            + " per_bar INTEGER NOT NULL DEFAULT 4, enabled INTEGER NOT NULL DEFAULT 0,"
            + " data TEXT NOT NULL DEFAULT '{}', updated_at REAL NOT NULL)",
        // artwork
        "CREATE TABLE IF NOT EXISTS artwork (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " digest TEXT NOT NULL, ext TEXT NOT NULL DEFAULT '.jpg',"
            + " position INTEGER NOT NULL DEFAULT 0, caption TEXT NOT NULL DEFAULT '',"
            + " created_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS artwork_song ON artwork(song_id, position)",
        // vocals
        "CREATE TABLE IF NOT EXISTS vocal_takes (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " author INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', digest TEXT NOT NULL,"
            + " ext TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0,"
            + " offset REAL NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,"
            + " gain REAL NOT NULL DEFAULT 1, chain TEXT NOT NULL DEFAULT '[]',"
            + " created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS vocal_takes_song ON vocal_takes(song_id, id)",
        // albums
        "CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY, title TEXT NOT NULL,"
            + " year INTEGER, notes TEXT NOT NULL DEFAULT '', cover_digest TEXT NOT NULL DEFAULT '',"
            + " cover_ext TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE TABLE IF NOT EXISTS album_songs (album_id INTEGER NOT NULL"
            + " REFERENCES albums(id) ON DELETE CASCADE, song_id INTEGER NOT NULL"
            + " REFERENCES songs(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0,"
            + " PRIMARY KEY (album_id, song_id))",
        "CREATE INDEX IF NOT EXISTS album_songs_order ON album_songs(album_id, position)",
        // playlists
        "CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, title TEXT NOT NULL,"
            + " album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,"
            + " created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE TABLE IF NOT EXISTS playlist_items (id INTEGER PRIMARY KEY,"
            + " playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,"
            + " position REAL NOT NULL, song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,"
            + " render_id INTEGER REFERENCES renders(id) ON DELETE CASCADE, added_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS playlist_items_order ON playlist_items(playlist_id, position)",
        "CREATE UNIQUE INDEX IF NOT EXISTS playlists_album ON playlists(album_id)"
            + " WHERE album_id IS NOT NULL",
        // sound (sound.py) and youtube (youtube.py): the grave and sharing read them
        "CREATE TABLE IF NOT EXISTS sound_presets (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,"
            + " name TEXT NOT NULL DEFAULT 'Current', is_current INTEGER NOT NULL DEFAULT 0,"
            + " data TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS presets_song ON sound_presets(song_id)",
        "CREATE TABLE IF NOT EXISTS youtube_posts (id INTEGER PRIMARY KEY,"
            + " song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE, version_id INTEGER,"
            + " url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',"
            + " status TEXT NOT NULL DEFAULT 'published', note TEXT NOT NULL DEFAULT '',"
            + " created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS youtube_song ON youtube_posts(song_id)",
        // grave (grave.py)
        "CREATE TABLE IF NOT EXISTS grave (id INTEGER PRIMARY KEY, kind TEXT NOT NULL,"
            + " title TEXT NOT NULL DEFAULT '', deleted_at REAL NOT NULL, tables TEXT NOT NULL,"
            + " digests TEXT NOT NULL DEFAULT '')",
        // orarend notes (orarend.py)
        "CREATE TABLE IF NOT EXISTS orarend_notes (id INTEGER PRIMARY KEY, subject TEXT NOT NULL UNIQUE,"
            + " absences INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE TABLE IF NOT EXISTS orarend_pages (id INTEGER PRIMARY KEY,"
            + " note_id INTEGER NOT NULL REFERENCES orarend_notes(id) ON DELETE CASCADE,"
            + " position INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL DEFAULT '',"
            + " created_at REAL NOT NULL, updated_at REAL NOT NULL)",
        "CREATE INDEX IF NOT EXISTS orarend_pages_note ON orarend_pages(note_id, position)",
        // sharing (sharing.py): what guests changed, so the owner can undo it
        "CREATE TABLE IF NOT EXISTS guest_edits (id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL,"
            + " account INTEGER NOT NULL, share_id INTEGER NOT NULL, what TEXT NOT NULL,"
            + " route TEXT NOT NULL, before TEXT NOT NULL, created_at REAL NOT NULL,"
            + " updated_at REAL NOT NULL, undone_at REAL NOT NULL DEFAULT 0)",
        "CREATE INDEX IF NOT EXISTS guest_edits_song ON guest_edits(song_id, id DESC)",
        "CREATE TABLE IF NOT EXISTS sync_folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,"
            + " enabled INTEGER NOT NULL DEFAULT 1, last_scan REAL NOT NULL DEFAULT 0,"
            + " created_at REAL NOT NULL, kind TEXT NOT NULL DEFAULT 'collector')",
        "CREATE TABLE IF NOT EXISTS sync_seen (path TEXT PRIMARY KEY, digest TEXT NOT NULL,"
            + " size INTEGER NOT NULL, mtime REAL NOT NULL, checked_at REAL NOT NULL)",
    };

    /** Columns older libraries may lack: table, name, declaration (as the Python migrations). */
    static final String[][] ADDED = {
        {"songs", "opened", "INTEGER NOT NULL DEFAULT 0"},
        {"versions", "project_at", "REAL NOT NULL DEFAULT 0"},
        {"versions", "rendered_at", "REAL NOT NULL DEFAULT 0"},
        {"versions", "peaks", "TEXT NOT NULL DEFAULT ''"},
        {"versions", "peak_db", "REAL"},
        {"versions", "trouble", "TEXT NOT NULL DEFAULT ''"},
        {"renders", "project_at", "REAL NOT NULL DEFAULT 0"},
        {"renders", "rendered_at", "REAL NOT NULL DEFAULT 0"},
        {"renders", "peaks", "TEXT NOT NULL DEFAULT ''"},
        {"renders", "peak_db", "REAL"},
        {"renders", "trouble", "TEXT NOT NULL DEFAULT ''"},
        {"renders", "plugins", "TEXT NOT NULL DEFAULT ''"},
        {"versions", "plugins", "TEXT NOT NULL DEFAULT ''"},
        {"vocal_takes", "fx", "INTEGER NOT NULL DEFAULT 1"},
        {"albums", "opened", "INTEGER NOT NULL DEFAULT 0"},
        {"albums", "stickers", "TEXT NOT NULL DEFAULT ''"},
        {"songs", "shared_from", "TEXT DEFAULT ''"},
        {"sync_folders", "kind", "TEXT NOT NULL DEFAULT 'collector'"},
    };

    private final Config config;
    private final Map<Long, Db> open = new ConcurrentHashMap<>();

    public Library(Config config) { this.config = config; }

    /** This account's library, opened and made ready once. */
    public Db of(long account) {
        return open.computeIfAbsent(account, a -> new Db(config.ensureHome(a).resolve("jriter.db").toAbsolutePath().toString()));
    }

    public static final class Db {
        private final JdbcTemplate t;

        Db(String path) {
            SQLiteConfig c = new SQLiteConfig();
            c.setJournalMode(SQLiteConfig.JournalMode.WAL);
            c.setSynchronous(SQLiteConfig.SynchronousMode.NORMAL);
            c.setBusyTimeout(30000);
            c.enforceForeignKeys(true);
            SQLiteDataSource ds = new SQLiteDataSource(c) {
                @Override
                public SQLiteConnection getConnection(String user, String pass) throws SQLException {
                    SQLiteConnection conn = super.getConnection(user, pass);
                    withFold(conn);
                    return conn;
                }
            };
            ds.setUrl("jdbc:sqlite:" + path);
            t = new JdbcTemplate(ds);
            for (String s : SCHEMA) t.execute(s);
            for (String[] a : ADDED) addColumn(a[0], a[1], a[2]);
        }

        /** fold(x): the case-folded text, as Python's str.casefold (the name Python registers). */
        static Connection withFold(Connection conn) throws SQLException {
            Function.create(conn, "fold", new Function() {
                @Override
                protected void xFunc() throws SQLException {
                    String v = value_text(0);
                    if (v == null) result();
                    else result(v.toUpperCase(Locale.ROOT).toLowerCase(Locale.ROOT));
                }
            });
            return conn;
        }

        void addColumn(String table, String name, String decl) {
            for (Map<String, Object> r : t.queryForList("PRAGMA table_info(" + table + ")"))
                if (name.equals(r.get("name"))) return;
            t.execute("ALTER TABLE " + table + " ADD COLUMN " + name + " " + decl);
        }

        public List<Map<String, Object>> query(String sql, Object... args) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : t.queryForList(sql, args)) out.add(new LinkedHashMap<>(r));
            return out;
        }

        public Map<String, Object> one(String sql, Object... args) {
            List<Map<String, Object>> rows = query(sql, args);
            return rows.isEmpty() ? null : rows.get(0);
        }

        public int run(String sql, Object... args) { return t.update(sql, args); }

        /** The column names of a table, in order. */
        public List<String> columns(String table) {
            List<String> out = new ArrayList<>();
            for (Map<String, Object> r : t.queryForList("PRAGMA table_info(" + table + ")")) out.add((String) r.get("name"));
            return out;
        }

        public boolean tableExists(String name) {
            return one("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name) != null;
        }

        /** INSERT of the given columns, returning the new row id. */
        public long insert(String table, Map<String, Object> values) {
            StringBuilder cols = new StringBuilder(), marks = new StringBuilder();
            for (String k : values.keySet()) {
                if (cols.length() > 0) { cols.append(", "); marks.append(", "); }
                cols.append(k);
                marks.append("?");
            }
            String sql = "INSERT INTO " + table + " (" + cols + ") VALUES (" + marks + ")";
            Object[] args = values.values().toArray();
            GeneratedKeyHolder keys = new GeneratedKeyHolder();
            t.update(con -> {
                PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
                for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
                return ps;
            }, keys);
            return keys.getKey().longValue();
        }

        /** UPDATE the given columns of one row by id. */
        public void update(String table, long id, Map<String, Object> values) {
            if (values.isEmpty()) return;
            StringBuilder set = new StringBuilder();
            List<Object> args = new ArrayList<>();
            for (Map.Entry<String, Object> e : values.entrySet()) {
                if (set.length() > 0) set.append(", ");
                set.append(e.getKey()).append(" = ?");
                args.add(e.getValue());
            }
            args.add(id);
            t.update("UPDATE " + table + " SET " + set + " WHERE id = ?", args.toArray());
        }
    }
}
