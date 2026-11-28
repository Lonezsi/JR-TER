package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** CONDOM legal 3: the owner's week is read by the owner and by the owner's Foyer friends only. A
 *  stand-in Foyer knows one friend of the owner and one stranger. */
class OrarendAccessTest {
    static final String FRIEND = "fri.end.cookie", STRANGER = "stra.nger.cookie";
    HttpServer foyer;
    Accounts accounts;
    OrarendController ctl;
    long anna;

    @BeforeEach
    void fresh() throws Exception {
        foyer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        foyer.createContext("/api/account", ex -> {
            String cookie = ex.getRequestHeaders().getFirst("Cookie");
            String body = ("foyer=" + FRIEND).equals(cookie)
                    ? "{\"account\":{\"id\":\"f-anna\",\"handle\":\"Anna\",\"name\":\"\",\"owner\":false,\"ownerFriend\":true}}"
                    : ("foyer=" + STRANGER).equals(cookie)
                    ? "{\"account\":{\"id\":\"f-who\",\"handle\":\"who\",\"name\":\"\",\"owner\":false,\"ownerFriend\":false}}"
                    : "{\"account\":null}";
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        foyer.start();
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"),
                "http://127.0.0.1:" + foyer.getAddress().getPort());
        accounts = new Accounts(config);
        accounts.create("owner", "pw", "", Accounts.OWNER);
        anna = Accounts.num(accounts.create("anna", "her password", "", null).get("id"));
        config.ensureHome(Accounts.OWNER);
        Files.writeString(config.home(Accounts.OWNER).resolve("orarend.json"),
                "[{\"id\":1,\"name\":\"Algoritmusok\",\"day\":1,\"at\":\"10:00\",\"to\":\"11:30\",\"kind\":\"ea\"}]");
        ctl = new OrarendController(new Library(config), config, accounts, new Auth(config, accounts));
    }

    @AfterEach
    void stop() { foyer.stop(0); }

    @SuppressWarnings("unchecked")
    Map<String, Object> get(long who, String cookie) {
        MockHttpServletRequest r = new MockHttpServletRequest("GET", "/api/orarend");
        r.setAttribute(Door.WHO, who);
        if (cookie != null) r.addHeader("Cookie", cookie);
        return (Map<String, Object>) ctl.week(r);
    }

    void refused(long who, String cookie) {
        ApiError e = assertThrows(ApiError.class, () -> get(who, cookie));
        assertEquals(403, e.status);
    }

    @Test
    void theOwnerReadsItAndMayEdit() {
        Map<String, Object> w = get(Accounts.OWNER, null);
        assertEquals(false, w.get("readonly"));
        assertEquals(1, ((List<?>) w.get("classes")).size());
    }

    @Test
    void anAccountWithNoFoyerTieIsRefused() {
        refused(anna, null);
        refused(anna, "foyer=" + FRIEND);
    }

    @Test
    void aTiedFriendOfTheOwnerReadsItReadOnly() {
        accounts.linkFoyer("f-anna", "Anna", anna);
        Map<String, Object> w = get(anna, "foyer=" + FRIEND);
        assertEquals(true, w.get("readonly"));
        assertEquals(1, ((List<?>) w.get("classes")).size());
    }

    @Test
    void aTieWithoutTheFoyerSignInIsRefused() {
        accounts.linkFoyer("f-anna", "Anna", anna);
        refused(anna, null);
        refused(anna, "foyer=" + STRANGER);
    }

    @Test
    void aTieToANonFriendIsRefused() {
        accounts.linkFoyer("f-who", "who", anna);
        refused(anna, "foyer=" + STRANGER);
    }
}
