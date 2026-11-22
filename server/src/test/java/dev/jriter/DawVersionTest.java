package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class DawVersionTest {
    @Test void acceptsADawProject() {
        assertDoesNotThrow(() -> DawController.checkText("{\"format\":\"jriter-daw\",\"tracks\":[]}"));
    }

    @Test void refusesGarbageAndOversize() {
        assertThrows(ApiError.class, () -> DawController.checkText("nope"));
        assertThrows(ApiError.class, () -> DawController.checkText("{\"a\":1}"));
        assertThrows(ApiError.class, () -> DawController.checkText(5));
        assertThrows(ApiError.class, () -> DawController.checkText("x".repeat(DawController.MAX_TEXT + 1)));
    }
}
