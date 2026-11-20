package dev.jriter.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

/** Talks to a library, carrying this machine's token. */
public final class Library {
    public static class LibraryException extends RuntimeException {
        public LibraryException(String m) { super(m); }
    }

    private final String base;
    private final String token;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    public Library(String base, String token) {
        this.base = base.replaceAll("/+$", "");
        this.token = token == null ? "" : token;
    }

    public static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }

    /** Header values go out as plain ASCII (the JDK client cannot send more); anything else becomes '?'. */
    static String headerSafe(String v) {
        StringBuilder b = new StringBuilder();
        for (char c : v.toCharArray()) b.append(c < 127 && c >= 32 ? c : '?');
        return b.toString();
    }

    private HttpRequest.Builder req(String path, Map<String, String> headers, int seconds) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(seconds));
        if (!token.isEmpty()) b.header("X-Jriter-Token", token);
        if (headers != null) headers.forEach((k, v) -> {
            b.header(k, headerSafe(v));
            if (!headerSafe(v).equals(v)) b.header(k + "-Enc", enc(v));
        });
        return b;
    }

    private HttpResponse<String> send(HttpRequest r) {
        try {
            HttpResponse<String> res = http.send(r, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 300) {
                String msg = res.body();
                try { JsonNode n = Config.JSON.readTree(msg); if (n.has("error")) msg = n.get("error").asText(); }
                catch (IOException ignored) { }
                throw new LibraryException("JR!TER said no (" + res.statusCode() + "): " + (msg.length() > 300 ? msg.substring(0, 300) : msg));
            }
            return res;
        } catch (java.net.ConnectException | HttpTimeoutException e) {
            throw new LibraryException("Cannot reach JR!TER at " + base + ": " + e.getMessage());
        } catch (IOException e) {
            throw new LibraryException("Cannot reach JR!TER at " + base + ": " + e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LibraryException("Interrupted");
        }
    }

    private static JsonNode parse(String body) {
        try { return body == null || body.isBlank() ? Config.JSON.createObjectNode() : Config.JSON.readTree(body); }
        catch (IOException e) { throw new LibraryException("JR!TER sent something that is not JSON"); }
    }

    public JsonNode get(String path) {
        return parse(send(req(path, Map.of("Accept", "application/json"), 120).GET().build()).body());
    }

    public JsonNode postJson(String path, Object payload) {
        try {
            byte[] data = Config.JSON.writeValueAsBytes(payload);
            return parse(send(req(path, Map.of("Content-Type", "application/json"), 120)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(data)).build()).body());
        } catch (IOException e) { throw new LibraryException(e.toString()); }
    }

    public JsonNode upload(String path, Path file, Map<String, String> headers) {
        try {
            var h = new java.util.LinkedHashMap<String, String>();
            h.put("Content-Type", "application/octet-stream");
            if (headers != null) h.putAll(headers);
            return parse(send(req(path, h, 900).POST(HttpRequest.BodyPublishers.ofFile(file)).build()).body());
        } catch (IOException e) { throw new LibraryException("Cannot read " + file + ": " + e.getMessage()); }
    }

    /** Trade a password for an upload-scoped token; the password is not kept. */
    public static String login(String base, String handle, String password, String name) {
        Library anon = new Library(base, "");
        HttpResponse<String> res = anon.send(anon.req("/api/auth/login", Map.of("Content-Type", "application/json"), 30)
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"handle\":" + q(handle) + ",\"password\":" + q(password) + "}")).build());
        String cookie = res.headers().firstValue("Set-Cookie").orElse("").split(";")[0];
        HttpResponse<String> made = anon.send(anon.req("/api/auth/tokens",
                Map.of("Content-Type", "application/json", "Cookie", cookie), 30)
                .POST(HttpRequest.BodyPublishers.ofString("{\"name\":" + q(name) + ",\"scope\":\"upload\"}")).build());
        return parse(made.body()).path("token").asText();
    }

    private static String q(String s) {
        try { return Config.JSON.writeValueAsString(s); } catch (IOException e) { return "\"\""; }
    }
}


