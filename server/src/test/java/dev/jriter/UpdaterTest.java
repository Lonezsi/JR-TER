package dev.jriter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class UpdaterTest {
    @Test
    void serverChangesNeedARebuild() {
        assertTrue(Updater.needsRebuild(List.of("README.md", "server/src/main/java/dev/jriter/App.java")));
        assertTrue(Updater.needsRebuild(List.of("server\\pom.xml")));
    }

    @Test
    void followsTheLiveBranch() {
        assertEquals("live-4.3.0", Updater.pickBranch(null, "live-4.3.0"));
        assertEquals("main", Updater.pickBranch("", "main"));
        assertEquals("main", Updater.pickBranch(null, "feature-x"));
        assertEquals("main", Updater.pickBranch("main", "live-4.3.0"));
        assertEquals("main", Updater.pickBranch(null, null));
    }

    @Test
    void webAndDevlogDoNot() {
        assertFalse(Updater.needsRebuild(List.of("web/js/app.js", "jriter/devlog.json", "docs/REWORK.md")));
        assertFalse(Updater.needsRebuild(List.of()));
        assertFalse(Updater.needsRebuild(List.of("desktop/server/x")));
    }

    @Test
    void aTakenNameGetsANumber() throws Exception {
        Path dir = Files.createTempDirectory("jriter-free");
        assertEquals("kick.wav", SyncController.freeName(dir, "kick.wav"));
        Files.writeString(dir.resolve("kick.wav"), "x");
        assertEquals("kick 2.wav", SyncController.freeName(dir, "kick.wav"));
        Files.writeString(dir.resolve("kick 2.wav"), "x");
        assertEquals("kick 3.wav", SyncController.freeName(dir, "kick.wav"));
    }

    @Test
    void unquoteKeepsPlusAndBadEscapes() {
        assertEquals("my kick #1.wav", SyncController.unquote("my%20kick%20%231.wav"));
        assertEquals("a+b.wav", SyncController.unquote("a+b.wav"));
        assertEquals("100%.wav", SyncController.unquote("100%.wav"));
    }
}
