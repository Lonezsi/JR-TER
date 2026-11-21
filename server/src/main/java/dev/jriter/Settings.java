package dev.jriter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Per-account settings.json with defaults: a port of jriter/config.py's settings(). */
@Component
public class Settings {
    private static final ObjectMapper JSON = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
    private final Config config;

    public Settings(Config config) { this.config = config; }

    /** What a setting is before anybody chooses (config._DEFAULTS), fresh copies each call. */
    public static Map<String, Object> defaults() {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("library_name", "JR!TER");
        d.put("accent", "#FAA8B8");
        d.put("adaptive", true);
        d.put("artwork_ground", true);
        d.put("effect_presets", new LinkedHashMap<String, Object>());
        d.put("pinned", new ArrayList<Object>());
        Map<String, Object> lv = new LinkedHashMap<>();
        lv.put("marks", true);
        lv.put("highlight", false);
        lv.put("structure", true);
        lv.put("warnings", true);
        lv.put("spellcheck", false);
        d.put("lyrics_view", lv);
        d.put("auto_update", true);
        d.put("sync_interval_minutes", 5);
        d.put("dust", 100);
        d.put("glass_edge", 100);
        d.put("dither", 60);
        d.put("ffmpeg_path", "");
        return d;
    }

    private Path path(long acct) { return config.home(acct).resolve("settings.json"); }

    private Map<String, Object> read(long acct) {
        try {
            return JSON.readValue(path(acct).toFile(), new TypeReference<Map<String, Object>>() {});
        } catch (IOException | RuntimeException e) {
            return new LinkedHashMap<>();
        }
    }

    public Map<String, Object> get(long acct) {
        Map<String, Object> out = defaults();
        out.putAll(read(acct));
        return out;
    }

    public synchronized Map<String, Object> save(long acct, Map<String, Object> patch) {
        Map<String, Object> current = read(acct);
        current.putAll(patch);
        config.ensureHome(acct);
        Path p = path(acct);
        Path tmp = Path.of(p + ".tmp");
        try {
            JSON.writeValue(tmp.toFile(), current);
            Files.move(tmp, p, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new ApiError("settings could not be saved: " + e.getMessage(), 500);
        }
        return get(acct);
    }

    static List<String> sorted(java.util.Collection<String> c) {
        List<String> l = new ArrayList<>(c);
        java.util.Collections.sort(l);
        return l;
    }
}
