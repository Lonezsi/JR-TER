package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

/** CONDOM 3: a password sign-in never ties a Foyer account; only Settings does, and a password change or
 *  "sign out everywhere" untie it. A stand-in Foyer answers /api/account for one stranger cookie. */
class FoyerTieTest {
    static final String STRANGER = "stra.nger.cookie";
    HttpServer foyer;
    Path tmp;
    Accounts accounts;
    Auth auth;
    AuthController ctl;
    long anna;

    @BeforeEach
    void fresh() throws Exception {
        foyer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        foyer.createContext("/api/account", ex -> {
            String cookie = ex.getRequestHeaders().getFirst("Cookie");
            String body = ("foyer=" + STRANGER).equals(cookie)
                    ? "{\"account\":{\"id\":\"f-who\",\"handle\":\"who\",\"name\":\"\",\"owner\":false,\"ownerFriend\":false}}"
                    : "{\"account\":null}";
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        foyer.start();
        tmp = Files.createTempDirectory("jriter-test");
        open();
        accounts.create("owner", "pw", "", Accounts.OWNER);
        anna = Accounts.num(accounts.create("anna", "her password", "", null).get("id"));
    }

    void open() {
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"),
                "http://127.0.0.1:" + foyer.getAddress().getPort());
        accounts = new Accounts(config);
        auth = new Auth(config, accounts);
        ctl = new AuthController(auth, accounts, config);
    }

    @AfterEach
    void stop() { foyer.stop(0); }

    MockHttpServletRequest post(String cookie, String json) {
        MockHttpServletRequest r = new MockHttpServletRequest("POST", "/x");
        r.setRemoteAddr("127.0.0.1");
        if (cookie != null) r.addHeader("Cookie", cookie);
        r.setContent(json.getBytes(StandardCharsets.UTF_8));
        return r;
    }

    String session() { return Auth.COOKIE + "=" + auth.issue(anna); }

    @SuppressWarnings("unchecked")
    Map<String, Object> state(String cookie) {
        MockHttpServletRequest r = new MockHttpServletRequest("GET", "/api/auth/state");
        r.setRemoteAddr("127.0.0.1");
        r.addHeader("Cookie", cookie);
        return (Map<String, Object>) ctl.state(r);
    }

    @Test
    void aPasswordSignInTiesNothing() {
        ResponseEntity<Object> res = ctl.login(post("foyer=" + STRANGER,
                "{\"handle\":\"anna\",\"password\":\"her password\"}"));
        assertEquals(200, res.getStatusCode().value());
        assertNull(accounts.foyerOf(anna));
        assertNull(auth.accountFor("foyer=" + STRANGER));
    }

    @Test
    void settingsTiesAndShowsTheHandle() {
        ctl.foyerConnect(post(session() + "; foyer=" + STRANGER, "{}"));
        assertEquals(anna, auth.accountFor("foyer=" + STRANGER));
        assertEquals("who", state(session() + "; foyer=" + STRANGER).get("foyer_tied_as"));
    }

    @Test
    void changingThePasswordUntiesFoyer() {
        ctl.foyerConnect(post(session() + "; foyer=" + STRANGER, "{}"));
        ctl.change(post(session(), "{\"current\":\"her password\",\"new\":\"another\"}"));
        assertNull(accounts.foyerOf(anna));
        assertNull(auth.accountFor("foyer=" + STRANGER));
    }

    @Test
    void signOutEverywhereUntiesFoyerAndEndsTheSession() {
        String cookie = session();
        ctl.foyerConnect(post(cookie + "; foyer=" + STRANGER, "{}"));
        ResponseEntity<Object> res = ctl.everywhere(post(cookie, "{}"));
        assertTrue(res.getHeaders().getFirst(HttpHeaders.SET_COOKIE).contains("Max-Age=0"));
        assertNull(accounts.foyerOf(anna));
        assertNull(auth.accountFor(cookie));
        assertNull(auth.accountFor("foyer=" + STRANGER));
    }

    @Test
    void anOldDatabaseWithoutTheHandleColumnStillOpens() throws Exception {
        accounts.linkFoyer("f-who", "who", anna);
        try (Connection c = DriverManager.getConnection("jdbc:sqlite:" + tmp.resolve("data").resolve("accounts.db"));
                Statement s = c.createStatement()) {
            s.execute("ALTER TABLE foyer_links DROP COLUMN handle");
        }
        open();
        assertEquals("", accounts.foyerHandleOf(anna), "tied before handles were kept");
        assertEquals("f-who", accounts.foyerOf(anna));
    }
}
