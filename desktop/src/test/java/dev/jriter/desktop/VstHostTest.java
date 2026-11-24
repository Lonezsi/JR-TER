package dev.jriter.desktop;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import javax.sound.midi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VstHostTest {
    @TempDir Path tmp;

    static Path midi(Path f) throws Exception {
        Sequence s = new Sequence(Sequence.PPQ, 480);
        Track t = s.createTrack();
        t.add(new MidiEvent(new ShortMessage(ShortMessage.NOTE_ON, 0, 60, 100), 0));
        t.add(new MidiEvent(new ShortMessage(ShortMessage.NOTE_OFF, 0, 60, 0), 960));
        MidiSystem.write(s, 0, f.toFile());
        return f;
    }

    @Test void commandOrder() {
        var c = VstHost.command(Path.of("p.exe"), Path.of("a.vst3"), Path.of("in.wav"), Path.of("m.mid"), Path.of("o.wav"), List.of("Cutoff:0.5"));
        assertEquals(List.of("p.exe", "process", "--plugin=a.vst3", "--input=in.wav", "--midiInput=m.mid", "--output=o.wav", "--overwrite", "--param=Cutoff:0.5"), c);
        assertFalse(VstHost.command(Path.of("p"), Path.of("a"), Path.of("i"), null, Path.of("o"), List.of()).stream().anyMatch(s -> s.startsWith("--midiInput")));
    }

    @Test void installedAndResolve() throws Exception {
        Path bundle = Files.createDirectories(tmp.resolve("v3/Foo Synth.vst3/Contents/x64"));
        Files.writeString(bundle.resolve("Foo Synth.vst3"), "x");
        Files.writeString(Files.createDirectories(tmp.resolve("v2")).resolve("bar.dll"), "x");
        Files.writeString(tmp.resolve("v2/notes.txt"), "x");
        var found = VstHost.installed(List.of(tmp.resolve("v3"), tmp.resolve("v2")));
        assertEquals(2, found.size());
        assertEquals("bar.dll", found.get(0).getFileName().toString());
        assertEquals("Foo Synth.vst3", found.get(1).getFileName().toString());
        assertTrue(Files.isDirectory(found.get(1)));
        assertEquals(found.get(1), VstHost.resolve("foo-synth", List.of(tmp.resolve("v3"))).orElseThrow());
        assertEquals(found.get(0), VstHost.resolve("BAR", List.of(tmp.resolve("v2"))).orElseThrow());
        assertTrue(VstHost.resolve("nothing", List.of(tmp.resolve("v2"))).isEmpty());
        assertEquals(found.get(0), VstHost.resolve(found.get(0).toString(), List.of()).orElseThrow());
    }

    @Test void midiLengthAndSilence() throws Exception {
        Path m = midi(tmp.resolve("a.mid"));
        double s = VstHost.midiSeconds(m);
        assertEquals(1.0, s, 0.05);
        Path w = tmp.resolve("s.wav");
        VstHost.writeSilentWav(w, 1.5, 44100);
        var in = javax.sound.sampled.AudioSystem.getAudioInputStream(w.toFile());
        assertEquals(2, in.getFormat().getChannels());
        assertEquals(16, in.getFormat().getSampleSizeInBits());
        assertEquals(66150, in.getFrameLength());
        in.close();
    }

    @Test void renderWithFakeHost() throws Exception {
        Path m = midi(tmp.resolve("a.mid"));
        Path out = tmp.resolve("out.wav");
        final long[] frames = { 0 };
        VstHost.Runner fake = cmd -> {
            String in = cmd.stream().filter(s -> s.startsWith("--input=")).findFirst().get().substring(8);
            String o = cmd.stream().filter(s -> s.startsWith("--output=")).findFirst().get().substring(9);
            assertTrue(cmd.stream().anyMatch(s -> s.startsWith("--midiInput=")));
            Files.copy(Path.of(in), Path.of(o), StandardCopyOption.REPLACE_EXISTING);
            try (var ai = javax.sound.sampled.AudioSystem.getAudioInputStream(Path.of(o).toFile())) { frames[0] = ai.getFrameLength(); }
            catch (javax.sound.sampled.UnsupportedAudioFileException e) { throw new IOException(e); }
            return new VstHost.Result(0, "ok");
        };
        Path made = VstHost.render(fake, Path.of("p.exe"), Path.of("a.vst3"), null, m, out, 2, List.of());
        assertEquals(out, made);
        assertEquals(44100 * 3, frames[0], 2000); // about 1 s of MIDI plus 2 s tail
        try (var s = Files.list(Path.of(System.getProperty("java.io.tmpdir")))) {
            assertTrue(s.noneMatch(p -> p.getFileName().toString().startsWith("jriter-vst") && Files.exists(p.resolve("silence.wav"))));
        }
    }

    @Test void failingHostSaysWhy() throws Exception {
        Path m = midi(tmp.resolve("a.mid"));
        VstHost.Runner bad = cmd -> new VstHost.Result(1, "line1\nCould not load plugin");
        var e = assertThrows(IOException.class, () -> VstHost.render(bad, Path.of("p"), Path.of("a"), null, m, tmp.resolve("o.wav"), 1, List.of()));
        assertTrue(e.getMessage().contains("exit 1") && e.getMessage().contains("Could not load plugin"));
        assertThrows(IOException.class, () -> VstHost.render(bad, Path.of("p"), Path.of("a"), null, null, tmp.resolve("o.wav"), 1, List.of()));
    }
}
