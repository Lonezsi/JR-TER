package dev.jriter;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.LinkedHashMap;
import java.util.Map;

/** Errors as {"error": message}, the way every handler in Python answers them. */
@RestControllerAdvice
public class Errors {
    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Object> api(ApiError e) {
        return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> other(Exception e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
        e.printStackTrace();
        return ResponseEntity.status(500).body(body);
    }
}
