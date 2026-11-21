package dev.jriter.desktop;

import static dev.jriter.desktop.FlProjectTest.*;
import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VstFoldersTest {
    @TempDir Path tmp;

    Path installed() throws Exception {
        Path root = tmp.resolve("plugins");
        Files.createDirectories(root.resolve("VST3/Serum.vst3"));
        Files.createDirectories(root.resolve("VST2/sub"));
        Files.writeString(root.resolve("VST2/Sylenth1_x64.dll"), "x");
        Files.writeString(root.resolve("VST2/sub/OTT.dll"), "x");
        return root;
    }

    @Test void normIgnoresArchAndPunctuation() {
        assertEquals("serum", VstFolders.norm("Serum_x64"));
        assertEquals("serum", VstFolders.norm("Serum (x64)"));
        assertEquals("serum", VstFolders.norm("Serum"));
    }

    @Test void matchesByNameFileNameAndKind() throws Exception {
        var in = VstFolders.scan(List.of(installed()));
        assertTrue(VstFolders.has(in, new FlProject.Plugin("vst3", "Serum", "", "C:\\elsewhere\\Serum.vst3", 1)));
        assertTrue(VstFolders.has(in, new FlProject.Plugin("vst2", "Sylenth1", "", "", 1)));
        assertTrue(VstFolders.has(in, new FlProject.Plugin("vst2", "Something", "", "C:\\x\\OTT.dll", 1)));
        assertFalse(VstFolders.has(in, new FlProject.Plugin("vst3", "Massive X", "", "C:\\x\\Massive X.vst3", 1)));
        assertTrue(VstFolders.has(in, new FlProject.Plugin("fl", "Sytrus", "", "", 1)));
    }

    @Test void commandMarksMissing() throws Exception {
        var e = events();
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(10, "Serum", "Xfer", "C:\\elsewhere\\Serum.vst3"));
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(10, "Massive X", "NI", "C:\\elsewhere\\Massive X.vst3"));
        Path f = tmp.resolve("Song.flp");
        Files.write(f, flp(e.toByteArray()));
        Config cfg = new Config(tmp.resolve("c.json"));
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        Main.plugins(cfg, new ArrayList<>(List.of(f.toString(), "--vst-folder", installed().toString())), new PrintStream(buf, true));
        String s = buf.toString();
        for (String line : s.split("\\R")) {
            if (line.contains("Massive X")) assertTrue(line.contains("missing here"), s);
            if (line.contains("Serum")) assertFalse(line.contains("missing here"), s);
        }
        assertTrue(s.contains("1 VST(s) missing here"), s);
        buf.reset();
        Main.plugins(cfg, new ArrayList<>(List.of(f.toString(), "--json", "--vst-folder", installed().toString())), new PrintStream(buf, true));
        String j = buf.toString();
        assertTrue(j.contains("\"installed\":true") && j.contains("\"installed\":false"), j);
    }
}
