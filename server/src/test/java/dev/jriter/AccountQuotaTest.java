package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** CONDOM 4b: an account keeps at most ACCOUNT_MOST bytes; a guest's uploads are the guest's. */
class AccountQuotaTest {
    Blobs blobs;
    Accounts accounts;
    VersionsController versions;
    ArtworkController artwork;
    long song;
    long oldTotal, oldAudio, oldImage;
    final Random rnd = new Random(7);

    @BeforeEach
    void fresh() throws Exception {
        oldTotal = Api.ACCOUNT_MOST;
        oldAudio = Api.AUDIO_MOST;
        oldImage = Api.IMAGE_MOST;
        Api.ACCOUNT_MOST = 1000;
        Api.AUDIO_MOST = 10_000;
        Api.IMAGE_MOST = 10_000;
        Path tmp = Files.createTempDirectory("jriter-test");
        Config config = new Config(tmp.resolve("data"), tmp.resolve("web"), tmp.resolve("glass.css"), "");
        Library lib = new Library(config);
        blobs = new Blobs(config);
        accounts = new Accounts(config);
        blobs.setAccounts(accounts);
        Grave grave = new Grave(blobs);
        versions = new VersionsController(lib, blobs, grave);
        artwork = new ArtworkController(lib, blobs, grave);
        song = lib.of(1).insert("songs", Map.of("title", "A", "created_at", 1.0, "updated_at", 1.0));
    }

    @AfterEach
    void restore() {
        Api.ACCOUNT_MOST = oldTotal;
        Api.AUDIO_MOST = oldAudio;
        Api.IMAGE_MOST = oldImage;
    }

    MockHttpServletRequest post(String name, int bytes, long guest) {
        MockHttpServletRequest r = new MockHttpServletRequest("POST", "/x");
        r.setAttribute(Door.WHO, 1L);
        if (guest != 0) r.setAttribute(Api.GUEST, guest);
        r.addHeader("X-Filename", name);
        byte[] b = new byte[bytes];
        rnd.nextBytes(b); // distinct bytes: blobs are shared by digest
        r.setContent(b);
        return r;
    }

    void mix(int bytes) throws Exception { versions.upload(post("x.wav", bytes, 0), "" + song); }

    void picture(int bytes, long guest) throws Exception { artwork.upload(post("x.png", bytes, guest), "" + song); }

    @Test
    void theOwnerStopsAtTheTotal() throws Exception {
        mix(600);
        ApiError e = assertThrows(ApiError.class, () -> mix(600));
        assertEquals(413, e.status);
        assertEquals(600, blobs.used(1));
    }

    @Test
    void aGuestIsBilledNotTheOwner() throws Exception {
        picture(600, 2);
        assertEquals(0, blobs.used(1));
        assertEquals(600, blobs.used(2));
        assertEquals(1, accounts.guestUploadsBy(2).size());
        mix(300); // the owner still has room
        assertEquals(300, blobs.used(1));
        ApiError e = assertThrows(ApiError.class, () -> picture(500, 2));
        assertEquals(413, e.status);
    }

    @Test
    void deletedFilesStopCounting() throws Exception {
        mix(600);
        String digest;
        try (var s = Files.walk(blobs.dir(1))) {
            digest = s.filter(Files::isRegularFile).findFirst().get().getFileName().toString();
        }
        assertTrue(blobs.delete(1, digest));
        assertEquals(0, blobs.used(1));
        mix(600);

        picture(700, 2);
        assertEquals(700, blobs.used(2));
        String theirs = (String) accounts.guestUploadsBy(2).get(0).get("digest");
        assertTrue(blobs.delete(1, theirs));
        assertEquals(0, blobs.used(2));
        assertEquals(0, accounts.guestUploadsBy(2).size());
    }
}
