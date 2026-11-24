package dev.jriter;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Expected numbers come from jriter/audio_meta.py run on the same generated file. */
class AudioMetaTest {
    static Path wav() throws Exception {
        ByteBuffer pcm = ByteBuffer.allocate(2400 * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 2400; i++) {
            pcm.putShort((short) ((i * 37 % 20000) - 10000));
            pcm.putShort((short) ((i * 91 % 30000) - 15000));
        }
        ByteBuffer h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        h.put("RIFF".getBytes()).putInt(36 + pcm.capacity()).put("WAVE".getBytes()).put("fmt ".getBytes())
                .putInt(16).putShort((short) 1).putShort((short) 2).putInt(8000).putInt(8000 * 4)
                .putShort((short) 4).putShort((short) 16).put("data".getBytes()).putInt(pcm.capacity());
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(h.array());
        o.write(pcm.array());
        Path p = Files.createTempFile("jriter-test", ".wav");
        Files.write(p, o.toByteArray());
        return p;
    }

    @Test
    void wavProbeMatchesPython() throws Exception {
        AudioMeta.Probe p = AudioMeta.probe(wav(), ".wav");
        assertEquals(0.3, p.duration(), 1e-9);
        assertEquals(256, p.bitrate());
    }

    @Test
    void wavPeaksMatchPython() throws Exception {
        AudioMeta.Peaks r = AudioMeta.peaks(wav(), ".wav");
        assertEquals(120, r.peaks().size());
        assertEquals(List.of(77, 72, 66, 60, 54, 49, 43, 37, 31, 25, 20, 14), r.peaks().subList(0, 12));
        assertEquals(List.of(26, 20, 15), r.peaks().subList(117, 120));
        assertEquals(4943, r.peaks().stream().mapToInt(Integer::intValue).sum());
        assertEquals(-10.31, r.peakDb(), 1e-9);
        assertFalse(r.silent());
        assertFalse(r.unreadable());
    }

    @Test
    void garbageIsUnreadableNotAnError() throws Exception {
        Path p = Files.createTempFile("jriter-test", ".wav");
        Files.write(p, "not a wav at all".getBytes());
        assertTrue(AudioMeta.peaks(p, ".wav").unreadable());
        assertEquals(0.0, AudioMeta.probe(p, ".wav").duration());
        assertTrue(AudioMeta.peaks(p, ".mp3").peaks().isEmpty());
    }

    @Test
    void similarMatchesDifflib() {
        assertEquals(0.866667, Similar.ratio("halfway under v18", "halfway under"), 1e-6);
        assertEquals(0.470588, Similar.ratio("song final 3", "songs"), 1e-6);
        assertEquals(0.833333, Similar.ratio("abcabc", "cabcab"), 1e-6);
        assertEquals(0.0, Similar.ratio("x", ""), 1e-9);
    }
}
