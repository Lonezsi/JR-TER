package dev.jriter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The upload loop against a stand in on a local socket: nothing here can reach Google. */
class YouTubeUploadTest {
    @Test
    void aDroppedUploadIsAskedAboutAndPickedUp() throws Exception {
        Path root = Files.createTempDirectory("jriter-yt");
        Config config = new Config(root.resolve("data"), root.resolve("web"), root.resolve("glass.css"), "");
        Library library = new Library(config);
        Blobs blobs = new Blobs(config);
        YouTube yt = new YouTube(config, library, blobs, new Video(new Settings(config)), new Problems());

        // a chosen account whose token is good for an hour: no refresh, so no Google
        Map<String, Object> entry = new java.util.LinkedHashMap<>();
        entry.put("client_id", "id");
        entry.put("client_secret", "secret");
        entry.put("refresh_token", "refresh");
        entry.put("access_token", "tok");
        entry.put("expires_at", System.currentTimeMillis() / 1000.0 + 3600);
        Map<String, Object> accs = new java.util.LinkedHashMap<>();
        accs.put("chan", entry);
        Map<String, Object> held = new java.util.LinkedHashMap<>();
        held.put("accounts", accs);
        held.put("chosen", "chan");
        yt.saveAccount(1, held);

        byte[] video = new byte[300000];
        Path mp4 = root.resolve("video.mp4");
        Files.write(mp4, video);

        List<String> seen = new ArrayList<>();
        int[] puts = {0};
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        int port = server.getAddress().getPort();
        server.createContext("/begin", ex -> {
            seen.add("begin " + ex.getRequestHeaders().getFirst("Authorization"));
            ex.getRequestBody().readAllBytes();
            ex.getResponseHeaders().add("Location", "http://127.0.0.1:" + port + "/session");
            ex.sendResponseHeaders(200, -1);
            ex.close();
        });
        server.createContext("/session", ex -> {
            String range = ex.getRequestHeaders().getFirst("Content-Range");
            ex.getRequestBody().readAllBytes();
            seen.add("put " + range);
            puts[0]++;
            if (puts[0] == 1) {                       // the first send dies with a 503
                ex.sendResponseHeaders(503, -1);
            } else if ("bytes */300000".equals(range)) {   // "how much do you have?" : 100 bytes
                ex.getResponseHeaders().add("Range", "bytes=0-99");
                ex.sendResponseHeaders(308, -1);
            } else {
                byte[] body = "{\"id\":\"vid123\",\"status\":{\"privacyStatus\":\"private\"},\"snippet\":{\"title\":\"T\"}}"
                        .getBytes(StandardCharsets.UTF_8);
                ex.sendResponseHeaders(200, body.length);
                ex.getResponseBody().write(body);
            }
            ex.close();
        });
        server.start();
        String saved = YouTube.uploadUrl;
        try {
            YouTube.uploadUrl = "http://127.0.0.1:" + port + "/begin";
            String uri = yt.begin("tok", video.length, Map.of("title", "T"), Map.of("privacyStatus", "private"));
            assertEquals("http://127.0.0.1:" + port + "/session", uri);
            yt.newJob(Map.of("id", 1L, "title", "S"), null, "d");
            Map<String, Object> got = yt.uploadWithRetries(1, uri, mp4, video.length, "j1", 0.0, 1.0);
            assertEquals("vid123", got.get("id"));
        } finally {
            YouTube.uploadUrl = saved;
            server.stop(0);
        }
        assertEquals("begin Bearer tok", seen.get(0));
        assertEquals("put null", seen.get(1));
        assertEquals("put bytes */300000", seen.get(2));
        assertEquals("put bytes 100-299999/300000", seen.get(3));
        assertTrue(seen.size() == 4, seen.toString());
    }
}
