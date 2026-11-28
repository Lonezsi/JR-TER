package dev.jriter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Every request passes here first: the same order as jriter/http.py's _route. A broken
 * auth.json shuts everything but /api/health; /orarend becomes a fragment redirect; then
 * the door, by cookie, Foyer, or a scoped machine token. Puts the account in WHO. The security
 * headers (Csp) go on first, so every answer carries them.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class Door extends OncePerRequestFilter {
    public static final String WHO = "jriter.who";
    /** The same list as OPEN_PAGES in jriter/http.py. /glass.css is the shared look: without it the sign-in
     *  page (and every page, for anyone not signed in yet) draws with no glass at all. */
    static final Set<String> OPEN_PAGES = Set.of("/login", "/legal", "/jriter.css", "/glass.css", "/favicon.ico");
    static final Set<String> OPEN_API = Set.of("/api/auth/state", "/api/auth/login", "/api/auth/setup",
            "/api/health", "/api/auth/signup", "/api/appearance/font");
    static final String[] OPEN_API_UNDER = {"/api/shares/invitation/"};
    static final Map<String, String> PRETTY = Map.of("/orarend", "/#/orarend");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Auth auth;
    private final Csp csp;

    public Door(Auth auth, Csp csp) {
        this.auth = auth;
        this.csp = csp;
    }

    /** The account this request is, or null. */
    public static Long who(HttpServletRequest req) { return (Long) req.getAttribute(WHO); }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String path = req.getRequestURI();
        String method = req.getMethod();
        Csp.secure(res, csp.policy(path)); // first, so redirects and 401s carry the headers too

        String broken = auth.damaged();
        if (broken != null && !path.equals("/api/health")) {
            String body = "JR!TER will not open. " + broken
                    + "\n\nNothing has been changed or overwritten. Repair or restore "
                    + "data/auth.json and this message goes away without a restart.";
            if (path.startsWith("/api/")) json(res, 503, Map.of("error", body, "locked", true));
            else send(res, 503, body, "text/plain; charset=utf-8");
            return;
        }

        if (method.equals("GET") && PRETTY.containsKey(path)) {
            res.setStatus(303);
            res.setHeader("Location", PRETTY.get(path));
            res.setContentLength(0);
            return;
        }

        String cookies = req.getHeader("Cookie");
        Long who = auth.accountFor(cookies);
        req.setAttribute(WHO, who);
        if (!isOpen(path) && who == null) {
            String raw = req.getHeader("X-Jriter-Token");
            if (raw == null || raw.isBlank()) raw = req.getHeader("X-Jong-Token");
            Long owner = auth.tokenAccount(raw, method, path);
            if (owner == null) {
                if (path.startsWith("/api/")) json(res, 401, Map.of("error", "Sign in to use this library."));
                else {
                    res.setStatus(303);
                    res.setHeader("Location", "/login");
                    res.setContentLength(0);
                }
                return;
            }
            req.setAttribute(WHO, owner);
        }
        chain.doFilter(req, res);
    }

    static boolean isOpen(String path) {
        if (OPEN_PAGES.contains(path) || OPEN_API.contains(path)) return true;
        for (String under : OPEN_API_UNDER) if (path.startsWith(under) && path.length() > under.length()) return true;
        return false;
    }

    static void json(HttpServletResponse res, int status, Object body) throws IOException {
        send(res, status, JSON.writeValueAsString(body), "application/json");
    }

    static void send(HttpServletResponse res, int status, String body, String type) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        res.setStatus(status);
        res.setContentType(type);
        res.setContentLength(b.length);
        res.getOutputStream().write(b);
    }
}
