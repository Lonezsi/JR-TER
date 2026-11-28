package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** CONDOM 4a: a file over the cap is refused with a 413 before any bytes are stored. */
class UploadCapTest {
    Blobs blobs;
    RendersController renders;
    VersionsController versions;
    ArtworkController artwork;
    AlbumsController albums;
    YouTubeController youtube;
    long song, album;
    long oldAudio, oldImage;

    @BeforeEach
    void fresh() throws Exception {
        oldAudio = Api.AUDIO_MOST;
        oldImage = Api.IMAGE_MOST;
        Api.AUDIO_MOST = 1000;
        Api.IMAGE_MOST = 100;
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        Library lib = new Library(config);
        blobs = new Blobs(config);
        Grave grave = new Grave(blobs);
        versions = new VersionsController(lib, blobs, grave);
        renders = new RendersController(lib, blobs, versions, grave);
        artwork = new ArtworkController(lib, blobs, grave);
        albums = new AlbumsController(lib, blobs, grave);
        youtube = new YouTubeController(null, lib, blobs, null, 0);
        song = lib.of(1).insert("songs", Map.of("title", "A", "created_at", 1.0, "updated_at", 1.0));
        album = lib.of(1).insert("albums", Map.of("title", "A", "created_at", 1.0, "updated_at", 1.0));
    }

    @AfterEach
    void restore() {
        Api.AUDIO_MOST = oldAudio;
        Api.IMAGE_MOST = oldImage;
    }

    MockHttpServletRequest post(String name, int bytes) {
        MockHttpServletRequest r = new MockHttpServletRequest("POST", "/x");
        r.setAttribute(Door.WHO, 1L);
        r.addHeader("X-Filename", name);
        r.setContent(new byte[bytes]);
        return r;
    }

    int stored() throws Exception {
        Path dir = blobs.dir(1);
        if (!Files.isDirectory(dir)) return 0;
        try (Stream<Path> s = Files.walk(dir)) {
            return (int) s.filter(Files::isRegularFile).count();
        }
    }

    void tooBig(Runnable call) throws Exception {
        ApiError e = assertThrows(ApiError.class, call::run);
        assertEquals(413, e.status);
        assertEquals(0, stored());
    }

    @Test
    void audioOverTheCapIsRefused() throws Exception {
        tooBig(() -> { try { renders.upload(post("x.wav", 1001)); } catch (java.io.IOException e) { fail(e); } });
        tooBig(() -> { try { versions.upload(post("x.wav", 1001), "" + song); } catch (java.io.IOException e) { fail(e); } });
        tooBig(() -> { try { youtube.receiveMix(post("x.wav", 1001), "" + song); } catch (java.io.IOException e) { fail(e); } });
    }

    @Test
    void imagesOverTheCapAreRefused() throws Exception {
        tooBig(() -> { try { artwork.upload(post("x.png", 101), "" + song); } catch (java.io.IOException e) { fail(e); } });
        tooBig(() -> { try { albums.uploadCover(post("x.png", 101), "" + album); } catch (java.io.IOException e) { fail(e); } });
    }

    @Test
    void aGuestIsHeldToTheSameCap() throws Exception {
        MockHttpServletRequest r = post("x.png", 101);
        r.setAttribute(Api.GUEST, 2L);
        tooBig(() -> { try { artwork.upload(r, "" + song); } catch (java.io.IOException e) { fail(e); } });
    }

    @Test
    void underTheCapIsKept() throws Exception {
        Object out = artwork.upload(post("x.png", 100), "" + song);
        assertInstanceOf(Map.class, out);
        assertEquals(1, stored());
    }
}