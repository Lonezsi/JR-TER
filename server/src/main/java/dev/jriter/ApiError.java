package dev.jriter;

/** Raised to answer with a status and a message: {"error": message}. */
public class ApiError extends RuntimeException {
    public final int status;

    public ApiError(String message) { this(message, 400); }

    public ApiError(String message, int status) {
        super(message);
        this.status = status;
    }
}
