package dev.jriter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/** A YouTube post's link is saved only as empty or https:// with a host (CONDOM 9). */
class YouTubePostUrlTest {
    @Test
    void onlyHttpsLinksPass() {
        assertEquals("", YouTube.postUrl(null));
        assertEquals("", YouTube.postUrl("  "));
        assertEquals("HTTPS://YouTu.be/x", YouTube.postUrl(" HTTPS://YouTu.be/x "));
        assertEquals("https://youtu.be/abc123", YouTube.postUrl("https://youtu.be/abc123"));
        for (String bad : new String[] {"javascript:alert(1)", "http://youtu.be/x", "https://", "data:text/html,x", "https://a b"})
            assertThrows(ApiError.class, () -> YouTube.postUrl(bad), bad);
    }
}
