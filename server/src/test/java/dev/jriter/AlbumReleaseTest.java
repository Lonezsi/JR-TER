package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** RouteNote 4a: an album remembers when it was released, its store link and its UPC. */
class AlbumReleaseTest {
    AlbumsController ctl;
    long id;

    @BeforeEach
    void fresh() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        Library lib = new Library(config);
        Blobs blobs = new Blobs(config);
        ctl = new AlbumsController(lib, blobs, new Grave(blobs));
        id = lib.of(1).insert("albums", Map.of("title", "A", "created_at", 1.0, "updated_at", 1.0));
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> patch(String json) {
        MockHttpServletRequest r = new MockHttpServletRequest("PATCH", "/api/albums/" + id);
        r.setAttribute(Door.WHO, 1L);
        r.setContentType("application/json");
        r.setContent(json.getBytes(StandardCharsets.UTF_8));
        return (Map<String, Object>) ((Map<String, Object>) ctl.update(r, String.valueOf(id))).get("album");
    }

    void refused(String json) {
        ApiError e = assertThrows(ApiError.class, () -> patch(json), json);
        assertEquals(400, e.status);
    }

    @Test
    void startsEmpty() {
        Map<String, Object> a = patch("{\"title\":\"A\"}");
        for (String k : new String[] {"released_at", "store_link", "upc"}) assertEquals("", a.get(k), k);
    }

    @Test
    void savesValidValues() {
        Map<String, Object> a = patch("{\"released_at\":\"2026-11-27\",\"store_link\":\"https://routenote.com/x?a=1\",\"upc\":\"0123 4567 8901\"}");
        assertEquals("2026-11-27", a.get("released_at"));
        assertEquals("https://routenote.com/x?a=1", a.get("store_link"));
        assertEquals("012345678901", a.get("upc"));
        assertEquals("0123456789012", patch("{\"upc\":\"0123456789012\"}").get("upc"));
    }

    @Test
    void refusesBadValues() {
        for (String v : new String[] {"http://x.com", "javascript:alert(1)", "https://", "https://a b.com", "ftp://x.com"})
            refused("{\"store_link\":\"" + v + "\"}");
        for (String v : new String[] {"12345", "12345678901234", "abc123456789"}) refused("{\"upc\":\"" + v + "\"}");
        for (String v : new String[] {"27/11/2026", "2026-13-40", "2026-02-30"}) refused("{\"released_at\":\"" + v + "\"}");
    }

    @Test
    void emptyClearsAndOtherEditsKeep() {
        patch("{\"released_at\":\"2026-11-27\",\"store_link\":\"https://a.com\",\"upc\":\"012345678901\"}");
        Map<String, Object> kept = patch("{\"title\":\"B\"}");
        assertEquals("2026-11-27", kept.get("released_at"));
        assertEquals("https://a.com", kept.get("store_link"));
        Map<String, Object> cleared = patch("{\"released_at\":\"\",\"store_link\":\"\",\"upc\":null}");
        for (String k : new String[] {"released_at", "store_link", "upc"}) assertEquals("", cleared.get(k), k);
    }
}
