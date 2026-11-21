package dev.jriter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What changed, release by release: /api/devlog, a port of jriter/modules/devlog.py. Reads
 * jriter/devlog.json, the same file the Python server loads, so the two can't drift.
 */
@RestController
public class DevlogController {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Path file;
    private long stamp = -1;
    private List<Map<String, Object>> cache = List.of();

    public DevlogController(Config config) {
        this.file = config.repo.resolve("jriter").resolve("devlog.json");
    }

    private synchronized List<Map<String, Object>> entries() {
        try {
            long m = Files.getLastModifiedTime(file).toMillis();
            if (m != stamp) {
                cache = JSON.readValue(file.toFile(), new TypeReference<List<Map<String, Object>>>() {});
                stamp = m;
            }
        } catch (IOException e) {
            throw new ApiError("The release notes can't be read: " + e.getMessage(), 500);
        }
        return cache;
    }

    /** The version is the top of the devlog, not a number of its own. */
    String version() {
        List<Map<String, Object>> all = entries();
        return all.isEmpty() ? "" : String.valueOf(all.get(0).get("version"));
    }

    /** Python's devlog.parse: 1 to 4 whole-number parts, else null. */
    static long[] parse(Object version) {
        String s = version == null ? "" : String.valueOf(version);
        String[] parts = s.split("\\.", -1);
        if (parts.length > 4) return null;
        long[] out = new long[parts.length];
        try {
            for (int i = 0; i < parts.length; i++) out[i] = Long.parseLong(parts[i].strip());
        } catch (NumberFormatException e) {
            return null;
        }
        return out;
    }

    /** Tuple comparison: element by element, a shorter prefix is smaller. */
    static int compare(long[] a, long[] b) {
        for (int i = 0; i < Math.min(a.length, b.length); i++)
            if (a[i] != b[i]) return Long.compare(a[i], b[i]);
        return Integer.compare(a.length, b.length);
    }

    @GetMapping("/api/devlog")
    public Object list(HttpServletRequest req) {
        List<Map<String, Object>> all = entries();
        String mark = req.getParameter("since");
        List<Map<String, Object>> listing = new ArrayList<>();
        if (mark == null || mark.isEmpty()) {
            listing.addAll(all);
        } else {
            long[] m = parse(mark);
            if (m != null)
                for (Map<String, Object> e : all) {
                    long[] v = parse(e.get("version"));
                    if (compare(v == null ? new long[0] : v, m) > 0) listing.add(e);
                }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("entries", listing);
        out.put("releases", all.size());
        return out;
    }
}
