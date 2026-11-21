package dev.jriter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;

class VideoTest {
    @Test
    void stillCommand() {
        assertEquals(List.of("ff", "-hide_banner", "-nostdin", "-y", "-i", "cover.png", "-frames:v", "1", "-vf",
                "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x101014",
                "out.png"), Video.stillArgv("ff", "cover.png", "out.png"));
    }

    @Test
    void videoCommandWithAndWithoutAStill() {
        List<String> tail = List.of("-i", "mix.wav", "-t", "12.500", "-shortest", "-c:v", "libx264", "-preset", "veryslow",
                "-tune", "stillimage", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "2", "-g", "20", "-c:a", "aac",
                "-b:a", "320k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "o.mp4");
        List<String> with = Video.videoArgv("ff", "still.png", "mix.wav", 12.5, "o.mp4");
        assertEquals(List.of("ff", "-hide_banner", "-nostdin", "-y", "-loop", "1", "-framerate", "2", "-i", "still.png"),
                with.subList(0, 10));
        assertEquals(tail, with.subList(10, with.size()));
        List<String> plain = Video.videoArgv("ff", null, "mix.wav", 12.5, "o.mp4");
        assertEquals(List.of("ff", "-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=0x101014:s=1280x720:r=2"),
                plain.subList(0, 8));
        assertEquals(tail, plain.subList(8, plain.size()));
    }

    @Test
    void failureSentences() {
        assertTrue(Video.whyItFailed(List.of("Unknown encoder 'libx264'")).contains("built without libx264"));
        assertTrue(Video.whyItFailed(List.of("height not divisible by 2")).contains("refused the picture size"));
        assertEquals("", Video.whyItFailed(List.of("something else")));
    }

    private static Path zip(Path dir, String... names) throws Exception {
        Path z = dir.resolve("a.zip");
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(z))) {
            for (String n : names) {
                out.putNextEntry(new ZipEntry(n));
                out.write("PAYLOAD".getBytes());
                out.closeEntry();
            }
        }
        return z;
    }

    @Test
    void extractTakesOnlyTheNamedMember() throws Exception {
        Path dir = Files.createTempDirectory("jriter-zip");
        Path z = zip(dir, "..\\..\\evil\\bin\\ffmpeg.exe.txt", "x/doc/readme.txt", "ffmpeg-7.1-essentials_build/bin/ffmpeg.exe");
        Path into = dir.resolve("out").resolve("ffmpeg.exe.unchecked");
        Video.extract(z, into);
        assertEquals("PAYLOAD", Files.readString(into));
        try (var s = Files.walk(dir)) {
            assertEquals(List.of("a.zip", "ffmpeg.exe.unchecked"),
                    s.filter(Files::isRegularFile).map(p -> p.getFileName().toString()).sorted().toList());
        }
    }

    @Test
    void extractRefusesAZipWithoutIt() throws Exception {
        Path dir = Files.createTempDirectory("jriter-zip");
        Path z = zip(dir, "x/readme.txt", "../../evil.exe");
        ApiError e = assertThrows(ApiError.class, () -> Video.extract(z, dir.resolve("o").resolve("f")));
        assertEquals(502, e.status);
        assertFalse(Files.exists(dir.resolve("o")));
    }

    @Test
    void onlyGooglePicturesAreFetched() {
        assertTrue(YouTube.mayFetch("https://yt3.ggpht.com/abc=s88"));
        assertTrue(YouTube.mayFetch("https://lh3.googleusercontent.com/x"));
        assertTrue(YouTube.mayFetch("https://ggpht.com/x"));
        assertFalse(YouTube.mayFetch("http://yt3.ggpht.com/abc"));
        assertFalse(YouTube.mayFetch("https://evilggpht.com/abc"));
        assertFalse(YouTube.mayFetch("https://ggpht.com.evil.example/abc"));
        assertFalse(YouTube.mayFetch("file:///C:/secret"));
        assertFalse(YouTube.mayFetch(""));
        assertFalse(YouTube.mayFetch(null));
    }

    @Test
    void googleWordsBecomeSentences() {
        assertTrue(YouTube.googleSaid(403, "{\"error\":{\"errors\":[{\"reason\":\"quotaExceeded\"}]}}").contains("six a day"));
        assertTrue(YouTube.googleSaid(401, "{\"error\":{\"errors\":[{\"reason\":\"youtubeSignupRequired\"}]}}").contains("no YouTube channel"));
        assertEquals("YouTube refused it: bad thing", YouTube.googleSaid(400, "{\"error\":{\"message\":\"bad thing\"}}"));
        assertEquals("YouTube answered 502: <html>", YouTube.googleSaid(502, "<html>"));
    }

    @Test
    void quoteLikePython() {
        assertEquals("Nothing%20was%20waiting%3A%20a/b~c", YouTubeController.quote("Nothing was waiting: a/b~c"));
    }
}
