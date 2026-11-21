package dev.jriter.desktop;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FlProjectTest {
    @TempDir Path tmp;

    static ByteArrayOutputStream events() { return new ByteArrayOutputStream(); }

    static void filler(ByteArrayOutputStream o) { o.write(5); o.write(1); o.write(70); o.write(1); o.write(2); o.write(130); o.writeBytes(new byte[]{1, 2, 3, 4}); }

    static void textEvent(ByteArrayOutputStream o, int id, byte[] payload) {
        o.write(id);
        int n = payload.length;
        do { int b = n & 0x7f; n >>>= 7; o.write(n > 0 ? b | 0x80 : b); } while (n > 0);
        o.writeBytes(payload);
    }

    static byte[] ascii(String s) { return (s + "\0").getBytes(StandardCharsets.ISO_8859_1); }
    static byte[] utf16(String s) { return (s + "\0").getBytes(StandardCharsets.UTF_16LE); }

    static byte[] le(long v, int n) {
        ByteBuffer b = ByteBuffer.allocate(n).order(ByteOrder.LITTLE_ENDIAN);
        if (n == 4) b.putInt((int) v); else b.putLong(v);
        return b.array();
    }

    static byte[] vstBlob(int type, String name, String vendor, String path) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.writeBytes(le(type, 4));
        Object[][] recs = {{50L, new byte[3]}, {56L, vendor.getBytes(StandardCharsets.UTF_8)},
                {54L, name.getBytes(StandardCharsets.UTF_8)}, {55L, path.getBytes(StandardCharsets.UTF_8)}};
        for (Object[] r : recs) {
            byte[] data = (byte[]) r[1];
            o.writeBytes(le((Long) r[0], 4));
            o.writeBytes(le(data.length, 8));
            o.writeBytes(data);
        }
        return o.toByteArray();
    }

    static byte[] flp(byte[] ev) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.writeBytes("FLhd".getBytes());
        o.writeBytes(le(6, 4));
        o.writeBytes(new byte[]{0, 0, 2, 0, (byte) 0xc0, 0});
        o.writeBytes("FLdt".getBytes());
        o.writeBytes(le(ev.length, 4));
        o.writeBytes(ev);
        return o.toByteArray();
    }

    @Test void vstAndFlPlugin() throws Exception {
        var e = events();
        filler(e);
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(10, "Serum", "Xfer Records", "C:\\VST3\\Serum.vst3"));
        textEvent(e, 201, utf16("Fruity Limiter"));
        textEvent(e, 213, new byte[8]);
        List<FlProject.Plugin> p = FlProject.plugins(flp(e.toByteArray()));
        assertEquals(2, p.size());
        assertEquals(new FlProject.Plugin("vst3", "Serum", "Xfer Records", "C:\\VST3\\Serum.vst3", 1), p.get(0));
        assertEquals("fl", p.get(1).kind());
        assertEquals("Fruity Limiter", p.get(1).name());
    }

    @Test void sameVstTwiceCountsUses() throws Exception {
        var e = events();
        for (int i = 0; i < 2; i++) {
            textEvent(e, 201, ascii("Fruity Wrapper"));
            textEvent(e, 213, vstBlob(8, "Massive", "NI", "C:\\VST\\Massive.dll"));
        }
        List<FlProject.Plugin> p = FlProject.plugins(flp(e.toByteArray()));
        assertEquals(1, p.size());
        assertEquals(2, p.get(0).uses());
        assertEquals("vst2", p.get(0).kind());
    }

    @Test void longEventNeedsTwoByteVarint() throws Exception {
        var e = events();
        textEvent(e, 203, new byte[300]);
        textEvent(e, 201, ascii("Sytrus"));
        textEvent(e, 213, new byte[200]);
        List<FlProject.Plugin> p = FlProject.plugins(flp(e.toByteArray()));
        assertEquals("Sytrus", p.get(0).name());
    }

    @Test void truncatedFileKeepsWhatCameBefore() throws Exception {
        var e = events();
        textEvent(e, 201, ascii("Sytrus"));
        textEvent(e, 213, new byte[8]);
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(10, "Serum", "Xfer", "x.vst3"));
        byte[] full = flp(e.toByteArray());
        byte[] cut = java.util.Arrays.copyOf(full, full.length - 20);
        List<FlProject.Plugin> p = FlProject.plugins(cut);
        assertEquals(2, p.size());
        assertEquals("Sytrus", p.get(1).name());
        assertEquals("unknown VST", p.get(0).name());
    }

    @Test void badHeaderThrows() {
        assertThrows(IOException.class, () -> FlProject.plugins("not a project at all".getBytes()));
    }

    @Test void strangeVstTypeFallsBack() throws Exception {
        var e = events();
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(3, "Hidden", "V", "a.dll"));
        assertEquals("unknown VST", FlProject.plugins(flp(e.toByteArray())).get(0).name());
    }

    @Test void commandPrintsPlugins() throws Exception {
        var e = events();
        textEvent(e, 201, ascii("Fruity Wrapper"));
        textEvent(e, 213, vstBlob(10, "Serum", "Xfer Records", "Serum.vst3"));
        Path f = tmp.resolve("Song.flp");
        Files.write(f, flp(e.toByteArray()));
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int code = Main.plugins(new java.util.ArrayList<>(List.of(f.toString())), new PrintStream(buf, true));
        assertEquals(0, code);
        String s = buf.toString();
        assertTrue(s.contains("Serum") && s.contains("VST3"), s);
        buf.reset();
        Main.plugins(new java.util.ArrayList<>(List.of(f.toString(), "--json")), new PrintStream(buf, true));
        assertTrue(buf.toString().contains("\"name\":\"Serum\""), buf.toString());
    }
}
