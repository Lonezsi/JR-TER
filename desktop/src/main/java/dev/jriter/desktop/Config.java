package dev.jriter.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;

/** The agent's settings: the same client.json the Python client kept, unknown keys preserved. */
public final class Config {
    static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private final Path path;
    private ObjectNode node;

    public Config(Path path) { this.path = path; this.node = JSON.createObjectNode(); }

    public static Path defaultPath() {
        String env = System.getenv("JRITER_CLIENT_CONFIG");
        if (env != null && !env.isBlank()) return Path.of(env);
        String appdata = System.getenv("APPDATA");
        Path base = appdata != null ? Path.of(appdata) : Path.of(System.getProperty("user.home"), ".config");
        return base.resolve("jriter").resolve("client.json");
    }

    public static Config load() { return load(defaultPath()); }

    public static Config load(Path path) {
        Config c = new Config(path);
        try {
            if (Files.exists(path) && JSON.readTree(Files.readAllBytes(path)) instanceof ObjectNode o) c.node = o;
        } catch (IOException ignored) { /* falls back to defaults, as the Python client did */ }
        return c;
    }

    public Path path() { return path; }
    public Path dir() { return path.toAbsolutePath().getParent(); }

    public String server() {
        String s = node.path("server").asText("http://127.0.0.1:7900");
        return s.isBlank() ? "http://127.0.0.1:7900" : s;
    }
    public String token() { return node.path("token").asText(""); }
    public String flPath() { return node.path("fl_path").asText(""); }
    public String renderFormat() { return node.path("render_format").asText("wav"); }
    public String renderOut() { return node.path("render_out").asText(""); }
    public boolean autoNewSongs() { return node.path("auto_new_songs").asBoolean(false); }
    public int intervalMinutes() { return Math.max(1, node.path("interval_minutes").asInt(5)); }

    public List<String> folders() {
        List<String> out = new ArrayList<>();
        node.path("folders").forEach(f -> out.add(f.asText()));
        return out;
    }

    public Config set(String key, String value) { node.put(key, value); return this; }
    public Config addFolder(String folder) {
        ArrayNode a = node.withArrayProperty("folders");
        a.add(folder);
        return this;
    }

    public void save() throws IOException {
        Files.createDirectories(dir());
        Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
        Files.write(tmp, JSON.writeValueAsBytes(node));
        Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
