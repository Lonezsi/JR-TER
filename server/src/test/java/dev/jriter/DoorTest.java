package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DoorTest {
    Config config;
    Accounts accounts;
    Auth auth;

    @BeforeEach
    void fresh() throws Exception {
        Path tmp = Files.createTempDirectory("jriter-test");
        config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        accounts = new Accounts(config);
        auth = new Auth(config, accounts);
    }

    @Test
    void scryptMatchesPython() {
        assertEquals("o6nuri0UB0zAYtUPW1FsUcO86OUVadX+DXiUh65Fhto=", Accounts.hash("pw", "0123456789abcdef".getBytes()));
    }

    @Test
    void cookieRoundTripAndTamper() {
        accounts.create("owner", "pw", "", Accounts.OWNER);
        String c = auth.issue(1);
        assertEquals(1L, auth.whose(c));
        assertNull(auth.whose(c.substring(0, c.length() - 1) + (c.endsWith("0") ? "1" : "0")));
        assertNull(auth.whose("nonsense"));
        accounts.signOutEverywhere(1);
        assertNull(auth.whose(c), "rotating the account secret ends the session");
    }

    @Test
    void passwordCheck() {
        Map<String, Object> a = accounts.create("owner", "pw", "", Accounts.OWNER);
        assertTrue(accounts.check(a, "pw"));
        assertFalse(accounts.check(a, "nope"));
        assertFalse(accounts.check(null, "pw"));
    }

    @Test
    void shapeTurnsIdsIntoPlaceholders() {
        assertEquals("/api/songs/<id>/versions", Auth.shape("/api/songs/12/versions"));
        assertEquals("/api/songs", Auth.shape("/api/songs"));
    }

    @Test
    void addressCountedIsTheLastForwardedOneFromLoopbackOnly() {
        assertEquals("9.9.9.9", Auth.who("127.0.0.1", "1.1.1.1, 9.9.9.9"));
        assertEquals("5.5.5.5", Auth.who("5.5.5.5", "1.1.1.1"));
        assertEquals("127.0.0.1", Auth.who("127.0.0.1", ""));
    }

    @Test
    void sixFreeTriesThenALockout() {
        for (int i = 0; i < 6; i++) auth.noteFailure("a");
        assertEquals(0, auth.waitFor("a"));
        auth.noteFailure("a");
        assertTrue(auth.waitFor("a") > 0);
        assertEquals(0, auth.waitFor("b"));
        auth.clear("a");
        assertEquals(0, auth.waitFor("a"));
    }

    @Test
    void handlesAreTidiedWithTheSameWords() {
        assertEquals("abc", Accounts.tidyHandle("  ABC "));
        assertEquals("A handle can hold letters, digits, and - _ . only. Not: ! @",
                assertThrows(ApiError.class, () -> Accounts.tidyHandle("a!@")).getMessage());
        assertThrows(ApiError.class, () -> Accounts.tidyHandle("x".repeat(33)));
    }

    @Test
    void tokenScopes() {
        accounts.create("owner", "pw", "", Accounts.OWNER);
        String raw = auth.makeToken("laptop", "upload", 1);
        assertEquals(1L, auth.tokenAccount(raw, "GET", "/api/songs"));
        assertEquals(1L, auth.tokenAccount(raw, "POST", "/api/songs/7/versions"));
        assertNull(auth.tokenAccount(raw, "DELETE", "/api/songs/7"));
        assertNull(auth.tokenAccount("jt_wrong", "GET", "/api/songs"));
    }

    @Test
    void aDamagedAuthFileIsLeftAlone() throws Exception {
        Files.writeString(config.authJson(), "{ not json");
        assertNotNull(auth.damaged());
        assertEquals(503, assertThrows(ApiError.class, () -> auth.signOutEverywhere()).status);
        assertEquals("{ not json", Files.readString(config.authJson()));
    }
}
