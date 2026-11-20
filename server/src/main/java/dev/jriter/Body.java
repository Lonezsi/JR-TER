package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** A request body as a JSON object, read once; complaining the way wire.Request.json does. */
final class Body {
    private static final ObjectMapper JSON = new ObjectMapper();

    private Body() {}

    @SuppressWarnings("unchecked")
    static Map<String, Object> json(HttpServletRequest req) {
        Object cached = req.getAttribute("jriter.body");
        if (cached != null) return (Map<String, Object>) cached;
        Map<String, Object> out;
        try {
            byte[] raw = req.getInputStream().readAllBytes();
            if (raw.length == 0) out = new HashMap<>();
            else {
                Object v = JSON.readValue(raw, Object.class);
                if (!(v instanceof Map)) throw new ApiError("expected a JSON object");
                out = (Map<String, Object>) v;
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiError("that request body is not JSON");
        } catch (IOException e) {
            throw new ApiError("that request body is not JSON");
        }
        req.setAttribute("jriter.body", out);
        return out;
    }

    static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v instanceof String ? (String) v : v == null ? "" : String.valueOf(v);
    }

    static String need(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v == null || (v instanceof String s && s.isBlank())) throw new ApiError(key + " is required");
        return v instanceof String s ? s.strip() : String.valueOf(v);
    }
}
