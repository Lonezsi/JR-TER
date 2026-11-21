package dev.jriter;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Component;
import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteDataSource;

/**
 * One account's library: data/accounts/ID/jriter.db, the file jriter/db.py opens. The CREATE
 * statements are the ones in the Python modules' SCHEMA lists, character for character in
 * effect, and every one is IF NOT EXISTS, so opening a library Python made changes nothing.
 * The migrations table is not touched: Python owns that record while it is the way back.
 *
 * shortcut: no "fold" SQL function yet. Only search uses it, and search is slice 9d.
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
        {"vocal_takes", "fx", "INTEGER NOT NULL DEFAULT 1"},
        {"albums", "opened", "INTEGER NOT NULL DEFAULT 0"},
        {"albums", "stickers", "TEXT NOT NULL DEFAULT ''"},
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
            SQLiteDataSource ds = new SQLiteDataSource(c);
            ds.setUrl("jdbc:sqlite:" + path);
            t = new JdbcTemplate(ds);
            for (String s : SCHEMA) t.execute(s);
            for (String[] a : ADDED) addColumn(a[0], a[1], a[2]);
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
