package dev.jriter;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** What went wrong, kept in memory: a port of jriter/problems.py (read its docstring for why). */
@Component
public class Problems {
    static final int LIMIT = 200;
    private final List<Map<String, Object>> seen = new ArrayList<>();
    private long dropped = 0;

    public synchronized String record(String where, Throwable error, String method) {
        long now = System.currentTimeMillis();
        String ref = String.format("%03x", now & 0xFFF);
        StringWriter tb = new StringWriter();
        error.printStackTrace(new PrintWriter(tb));
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("ref", ref);
        e.put("at", now / 1000.0);
        e.put("where", where);
        e.put("method", method);
        e.put("kind", error.getClass().getSimpleName());
        e.put("message", String.valueOf(error.getMessage()));
        e.put("traceback", tb.toString());
        seen.add(e);
        while (seen.size() > LIMIT) {
            seen.remove(0);
            dropped++;
        }
        return ref;
    }

    /** Newest first. */
    public synchronized List<Map<String, Object>> recent(int limit) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = seen.size() - 1; i >= 0 && out.size() < Math.max(1, limit); i--) out.add(seen.get(i));
        return out;
    }

    public synchronized Map<String, Object> count() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kept", seen.size());
        m.put("dropped", dropped);
        return m;
    }

    public synchronized void clear() {
        seen.clear();
        dropped = 0;
    }
}
