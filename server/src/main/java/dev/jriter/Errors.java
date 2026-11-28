package dev.jriter;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.LinkedHashMap;
import java.util.Map;

/** Errors as {"error": message}, the way every handler in Python answers them. */
@RestControllerAdvice
public class Errors {
    /** What anyone but the owner reads of a server fault (CONDOM 8). */
    static final String PLAIN = "Something went wrong on the server. If it keeps happening, tell the owner this reference.";

    private final Problems problems;

    public Errors(Problems problems) { this.problems = problems; }

    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Object> api(ApiError e, jakarta.servlet.http.HttpServletRequest req) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (e.status < 500) {
            body.put("error", e.getMessage());
            return ResponseEntity.status(e.status).body(body);
        }
        body.put("error", Api.isOwner(req) ? String.valueOf(e.getMessage()) : PLAIN);
        body.put("ref", problems.record(req.getRequestURI(), e, req.getMethod()));
        return ResponseEntity.status(e.status).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> other(Exception e, jakarta.servlet.http.HttpServletRequest req) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", Api.isOwner(req) ? e.getClass().getSimpleName() + ": " + e.getMessage() : PLAIN);
        body.put("ref", problems.record(req.getRequestURI(), e, req.getMethod()));
        e.printStackTrace();
        return ResponseEntity.status(500).body(body);
    }
}
