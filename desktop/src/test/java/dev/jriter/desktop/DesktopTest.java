package dev.jriter.desktop;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class DesktopTest {
    @TempDir Path tmp;
    HttpServer server;
    List<String> seen = new CopyOnWriteArrayList<>();
    Map<String, String> lastHeaders = new HashMap<>();
    Set<String> have = new HashSet<>();

    @BeforeEach void up() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            seen.add(ex.getRequestMethod() + " " + ex.getRequestURI());
            ex.getRequestHeaders().forEach((k, v) -> lastHeaders.put(k.toLowerCase(), v.get(0)));
            ex.getRequestBody().readAllBytes();
            String path = ex.getRequestURI().getPath();
            String body = "{}";
            if (path.equals("/api/versions/have")) {
                StringBuilder b = new StringBuilder("{\"have\":{");
                String q = ex.getRequestURI().getRawQuery();
                String[] ds = java.net.URLDecoder.decode(q.substring(q.indexOf('=') + 1), "UTF-8").split(",");
                boolean first = true;
                for (String d : ds) if (have.contains(d)) { b.append(first ? "" : ",").append('"').append(d).append("\":{\"n\":1,\"title\":\"T\"}"); first = false; }
                body = b.append("}}").toString();
            } else if (path.equals("/api/renders")) body = "{\"added\":true}";
            byte[] out = body.getBytes();
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
    }
    @AfterEach void down() { server.stop(0); }
    String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    @Test void configKeepsUnknownKeysAndDefaults() throws Exception {
        Path f = tmp.resolve("client.json");
        Files.writeString(f, "{\"server\":\"http://x:1\",\"folders\":[\"a\"],\"token\":\"t\",\"mystery\":7}");
        Config c = Config.load(f);
        assertEquals("http://x:1", c.server());
        assertEquals(List.of("a"), c.folders());
        c.addFolder("b").save();
        String text = Files.readString(f);
        assertTrue(text.contains("mystery"));
        assertEquals(List.of("a", "b"), Config.load(f).folders());
        assertEquals("http://127.0.0.1:7900", Config.load(tmp.resolve("none.json")).server());
        assertEquals(5, Config.load(tmp.resolve("none.json")).intervalMinutes());
    }

    @Test void surveyWalksAudioAndSkipsDotDirs() throws Exception {
        Files.createDirectories(tmp.resolve("a/.hidden"));
        Files.writeString(tmp.resolve("a/one.WAV"), "x");
        Files.writeString(tmp.resolve("a/note.txt"), "x");
        Files.writeString(tmp.resolve("a/.hidden/two.wav"), "x");
        List<Path> p = Survey.walk(List.of(tmp.resolve("a").toString(), tmp.resolve("missing").toString()));
        assertEquals(1, p.size());
        assertEquals("one.WAV", p.get(0).getFileName().toString());
        assertEquals("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881", Survey.digest(tmp.resolve("a/note.txt")));
    }

    @Test void surveyAsksInBatchesOf400() throws Exception {
        Path dir = Files.createDirectories(tmp.resolve("many"));
        for (int i = 0; i < 401; i++) Files.writeString(dir.resolve("f" + i + ".wav"), "n" + i);
        Config c = new Config(tmp.resolve("c.json")).set("server", url());
        c.addFolder(dir.toString());
        Survey.Result r = Survey.run(c, new Library(url(), ""));
        assertEquals(401, r.fresh().size());
        assertEquals(2, seen.stream().filter(s -> s.contains("/api/versions/have")).count());
        have.add(r.fresh().get(0).digest());
        assertEquals(1, Survey.run(c, new Library(url(), "")).known().size());
    }

    @Test void renderUploadCarriesHeadersAndToken() throws Exception {
        Path f = tmp.resolve("Józsi dal.wav");
        Files.writeString(f, "audio");
        assertTrue(Send.render(new Library(url(), "tok"), f, 1732150000.5, 1732150100.0, true));
        assertEquals("tok", lastHeaders.get("x-jriter-token"));
        assertEquals("fl", lastHeaders.get("x-origin"));
        assertEquals("1.7321500005E9", lastHeaders.get("x-project-at"));
        assertEquals("J%C3%B3zsi%20dal.wav", lastHeaders.get("x-filename-enc"));
    }

    @Test void flRankPrefers64BitThenNewest() {
        List<Path> l = new ArrayList<>(List.of(Path.of("C:/IL/FL Studio 20/FL.exe"), Path.of("C:/IL/FL Studio 20/FL64.exe"), Path.of("C:/IL/FL Studio 2024/FL64.exe")));
        l.sort(FlRender.RANK);
        assertEquals(Path.of("C:/IL/FL Studio 2024/FL64.exe"), l.get(0));
        assertEquals(Path.of("C:/IL/FL Studio 20/FL.exe"), l.get(2));
    }

    @Test void renderWithAFakeFl() throws Exception {
        Assumptions.assumeTrue(System.getProperty("os.name").toLowerCase().contains("win"));
        Path fl = tmp.resolve("fakefl.cmd");
        Files.writeString(fl, "@echo off\r\nset t=%1\r\nset t=%t:~2%\r\necho RIFFfakeaudio> \"%t%\"\r\n");
        Path proj = tmp.resolve("Song.flp");
        Files.writeString(proj, "flp");
        Path out = tmp.resolve("out");
        var r = FlRender.render(proj, out, "wav", fl.toString(), 30, 1.0, t -> { });
        assertTrue(Files.isRegularFile(out.resolve("Song.wav")));
        assertTrue(r.projectAt() > 0 && r.renderedAt() > 0);
        assertThrows(FlRender.RenderException.class, () -> FlRender.render(tmp.resolve("x.txt"), null, "wav", fl.toString(), 5, 1, t -> { }));
    }

    @Test void windowsCommandLines() {
        var w = Windows.windowCommand("http://h", "edge.exe", Path.of("P"));
        assertTrue(w.contains("--app=http://h") && w.contains("--no-first-run"));
        assertEquals("cmd /s /c \"\"C:\\Pr F\\jriter-cli.exe\" push-file \"%1\" & pause\"",
                Windows.commandLine(Path.of("C:\\Pr F\\jriter-cli.exe"), "push-file", "%1"));
        assertEquals(5, Windows.entries().size());
    }
}

