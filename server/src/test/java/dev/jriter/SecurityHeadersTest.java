package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** Condom 6: every answer carries the policy; inline scripts run by hash only. */
class SecurityHeadersTest {
    Door door;
    Csp csp;
    Path web;

    @BeforeEach
    void fresh() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-csp");
        web = Files.createDirectories(tmp.resolve("web"));
        Files.copy(Path.of("..", "ui", "index.html"), web.resolve("index.html"));
        Files.copy(Path.of("..", "ui", "public", "login.html"), web.resolve("login.html"));
        Files.copy(Path.of("..", "web", "daw.html"), web.resolve("daw.html"));
        Config config = new Config(tmp.resolve("data"), web, tmp.resolve("glass.css"), "");
        Accounts accounts = new Accounts(config);
        csp = new Csp(config);
        door = new Door(new Auth(config, accounts), csp);
    }

    @Test
    void everyInlineScriptIsAllowedByHash() throws Exception {
        String p = csp.policy("/login");
        for (String f : new String[] {"index.html", "login.html", "daw.html"}) {
            var found = Csp.hashesIn(Files.readString(web.resolve(f), StandardCharsets.UTF_8));
            assertFalse(found.isEmpty(), f + " has an inline script");
            for (String h : found) assertTrue(p.contains("'" + h + "'"), f + " " + h);
        }
    }

    @Test
    void lineEndingsDoNotChangeTheHash() {
        String lf = "<script>\nvar a = 1;\nvar b = 2;\n</script>";
        assertEquals(Csp.hashesIn(lf), Csp.hashesIn(lf.replace("\n", "\r\n")));
        assertTrue(Csp.hashesIn("<script src=\"/x.js\"></script>").isEmpty());
    }

    @Test
    void noUnsafeScriptsAndOnlyTheDawTakesPlugins() {
        for (String path : new String[] {"/", "/login", "/legal", "/daw.html"}) {
            String p = csp.policy(path);
            String scripts = p.substring(p.indexOf("script-src"), p.indexOf(";", p.indexOf("script-src")));
            assertFalse(scripts.contains("unsafe"), scripts);
            assertTrue(p.contains("frame-ancestors 'none'"));
            assertTrue(p.contains("https://i.ytimg.com"));
            assertTrue(p.contains("worker-src 'self' blob:"));
        }
        String plain = csp.policy("/");
        assertFalse(plain.substring(plain.indexOf("script-src"), plain.indexOf(";", plain.indexOf("script-src"))).contains("https:"));
        assertFalse(plain.contains("googleapis"));
        String daw = csp.policy("/daw.html");
        assertTrue(daw.contains("script-src 'self' blob: https:"));
    }

    private MockHttpServletResponse call(String path) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        req.setRequestURI(path);
        MockHttpServletResponse res = new MockHttpServletResponse();
        door.doFilter(req, res, new MockFilterChain());
        return res;
    }

    private static void carries(MockHttpServletResponse res) {
        assertTrue(res.getHeader("Content-Security-Policy").contains("frame-ancestors 'none'"));
        assertEquals("DENY", res.getHeader("X-Frame-Options"));
        assertEquals("nosniff", res.getHeader("X-Content-Type-Options"));
    }

    @Test
    void redirectsAndRefusalsCarryThemToo() throws Exception {
        MockHttpServletResponse redirect = call("/");
        assertEquals(303, redirect.getStatus());
        carries(redirect);
        MockHttpServletResponse refused = call("/api/songs");
        assertEquals(401, refused.getStatus());
        carries(refused);
        carries(call("/login"));
    }
}
