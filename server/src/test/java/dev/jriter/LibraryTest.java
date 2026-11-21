package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LibraryTest {
    @Test
    void opensEmptyAndReopensWithoutChange() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        Library lib = new Library(config);
        Library.Db db = lib.of(1);
        long id = db.insert("songs", Map.of("title", "A", "created_at", 1.0, "updated_at", 1.0));
        assertEquals("A", db.one("SELECT title FROM songs WHERE id = ?", id).get("title"));
        assertEquals(0, ((Number) db.one("SELECT opened FROM songs WHERE id = ?", id).get("opened")).intValue());
        assertTrue(db.tableExists("versions"));
        for (String t : new String[] {"artwork", "lyric_sheets", "lyric_revisions", "arrangements", "vocal_takes",
                "albums", "album_songs", "playlists", "playlist_items"})
            assertTrue(db.tableExists(t), t);
        // a second Library over the same folder runs the schema again and keeps the row
        Library.Db again = new Library(config).of(1);
        assertEquals(1, again.query("SELECT * FROM songs").size());
        // foreign keys cascade, through every table that hangs off a song
        db.run("INSERT INTO song_titles (song_id, title, changed_at) VALUES (?, 'old', 1)", id);
        db.run("INSERT INTO lyric_sheets (song_id, created_at) VALUES (?, 1)", id);
        db.run("INSERT INTO lyric_revisions (sheet_id, created_at) VALUES (1, 1)");
        db.run("INSERT INTO artwork (song_id, digest, created_at) VALUES (?, 'x', 1)", id);
        db.run("INSERT INTO arrangements (song_id, updated_at) VALUES (?, 1)", id);
        db.run("INSERT INTO albums (title, created_at, updated_at) VALUES ('Al', 1, 1)");
        db.run("INSERT INTO album_songs (album_id, song_id) VALUES (1, ?)", id);
        db.run("INSERT INTO playlists (title, album_id, created_at, updated_at) VALUES ('Al', 1, 1, 1)");
        db.run("INSERT INTO playlist_items (playlist_id, position, song_id, added_at) VALUES (1, 1, ?, 1)", id);
        db.run("DELETE FROM songs WHERE id = ?", id);
        for (String t : new String[] {"song_titles", "lyric_sheets", "lyric_revisions", "artwork", "arrangements",
                "album_songs", "playlist_items"})
            assertEquals(0, db.query("SELECT * FROM " + t).size(), t);
        assertEquals(1, db.query("SELECT * FROM albums").size());
    }

    @Test
    void blobsLandAtTheFanOutPath() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        Blobs blobs = new Blobs(config);
        byte[] bytes = "hello".getBytes();
        Blobs.Stored s = blobs.putStream(1, new java.io.ByteArrayInputStream(bytes), bytes.length);
        assertEquals("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", s.digest());
        assertTrue(s.added());
        assertTrue(Files.isRegularFile(blobs.pathFor(1, s.digest())));
        assertFalse(blobs.putStream(1, new java.io.ByteArrayInputStream(bytes), bytes.length).added());
        assertTrue(blobs.delete(1, s.digest()));
    }

    @Test
    void foldCaseFolds() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-test");
        Library.Db db = new Library(new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "")).of(1);
        assertEquals("árvíz strasse", db.one("SELECT fold('ÁRVÍZ Straße') AS f").get("f"));
    }
}
