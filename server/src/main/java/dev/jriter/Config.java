package dev.jriter;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Where things are, read the way jriter/config.py reads them. */
@Component
public class Config {
    public final Path data;
    public final Path web;
    /** The repo (or install) folder; jriter/devlog.json lives under it. */
    public final Path repo;
    public final Path glass;
    public final Path glassDefs;
    /** Foyer's address, or "" for off. */
    public final String foyer;

    @Autowired
    public Config() {
        Path repo = repoRoot();
        this.repo = repo;
        this.data = Path.of(first(env("JRITER_DATA"), env("JONG_DATA"), repo.resolve("data").toString()));
        this.web = Path.of(first(env("JRITER_WEB"), repo.resolve("web").toString()));
        Path parent = repo.toAbsolutePath().getParent();
        this.glass = Path.of(first(env("JRITER_GLASS"),
                (parent == null ? repo : parent).resolve("foyer").resolve("shared").resolve("glass.css").toString()));
        this.glassDefs = Path.of(first(env("JRITER_GLASS_DEFS"),
                glass.getParent().resolve("glass-defs.html").toString()));
        String f = System.getenv("JRITER_FOYER");
        this.foyer = f == null ? "http://127.0.0.1:7000" : f.trim();
    }

    public Config(Path data, Path web, Path glass, String foyer) {
        this.data = data;
        this.repo = web.toAbsolutePath().getParent();
        this.web = web;
        this.glass = glass;
        this.glassDefs = glass.getParent().resolve("glass-defs.html");
        this.foyer = foyer;
    }

    private static String env(String name) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? null : v;
    }

    private static String first(String... values) {
        for (String v : values) if (v != null) return v;
        return null;
    }

    private static Path repoRoot() {
        String given = env("JRITER_HOME");
        if (given != null) return Path.of(given).toAbsolutePath().normalize();
        Path cwd = Path.of("").toAbsolutePath();
        if (Files.isDirectory(cwd.resolve("web"))) return cwd;
        if (cwd.getParent() != null && Files.isDirectory(cwd.getParent().resolve("web"))) return cwd.getParent();
        return cwd;
    }

    public Path accountsDb() { return data.resolve("accounts.db"); }
    public Path authJson() { return data.resolve("auth.json"); }
    public Path setupCode() { return data.resolve("setup-code.txt"); }

    public Path home(long account) { return data.resolve("accounts").resolve(Long.toString(account)); }

    public Path ensureHome(long account) {
        try {
            Path h = home(account);
            Files.createDirectories(h.resolve("blobs"));
            return h;
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
