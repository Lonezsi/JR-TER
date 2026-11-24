package dev.jriter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Keeping JR!TER up to date from its GitHub repository: a port of jriter/modules/updater.py.
 *
 * What differs from Python: the server is a jar, so a pull is not enough. When the pull
 * changed anything under server/, the jar is rebuilt with Maven, and only a good build asks for
 * a restart. A failed build leaves the running jar alone and says so. Changes to web/ or
 * jriter/devlog.json are read from disk and need no restart.
 *
 * The restart is the process ending; hostsetup/Start-JriterJar.ps1 (the watchdog task) starts
 * the new jar. It runs a copy of target/jriter.jar so Maven can rewrite target/ while the
 * server is up.
 */
@Component
public class Updater {
    static final int TIMEOUT_SECONDS = 25;
    static final int BUILD_MINUTES = 10;
    static final long STOP_AFTER_MS = 600;
    static final long EVERY_MS = 15 * 60 * 1000L;
    static final long FIRST_AFTER_MS = 120 * 1000L;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Config config;
    private final ApplicationContext context;
    private final ReentrantLock busy = new ReentrantLock();
    private volatile String commit;

    /** Swapped by a test so ending the process is not what the test does. */
    Runnable stopper = this::exitProcess;

    public Updater(Config config, ApplicationContext context) {
        this.config = config;
        this.context = context;
    }

    String repoName() { return env("JRITER_REPO", "Lonezsi/JR-TER"); }

    /** JRITER_BRANCH if set; else the checkout's branch when it is live-*; else main. Same rule as updater.py _branch(). */
    static String pickBranch(String fromEnv, String onBranch) {
        if (fromEnv != null && !fromEnv.isBlank()) return fromEnv.trim();
        String here = onBranch == null ? "" : onBranch.strip();
        return here.startsWith("live-") ? here : "main";
    }

    String branch() {
        String fromEnv = System.getenv("JRITER_BRANCH");
        if (fromEnv != null && !fromEnv.isBlank()) return fromEnv.trim();
        return pickBranch(null, git("rev-parse", "--abbrev-ref", "HEAD")[0]);
    }

    private static String env(String name, String def) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? def : v.trim();
    }

    // -- the pure part -----------------------------------------------------------

    /** Does a change to these files (repo-relative, forward slashes) mean the jar must be rebuilt? */
    static boolean needsRebuild(List<String> files) {
        for (String f : files) if (f.replace('\\', '/').startsWith("server/")) return true;
        return false;
    }

    // -- git ---------------------------------------------------------------------

    /** Output of a command, or an error text. out[0] = stdout, out[1] = error (null when fine). */
    String[] run(List<String> command, int seconds) {
        try {
            Process p = new ProcessBuilder(command).directory(config.repo.toFile()).redirectErrorStream(false).start();
            // read both streams on threads so a chatty build can't fill a pipe and hang
            byte[][] bufs = new byte[2][];
            Thread t1 = new Thread(() -> bufs[0] = readAll(p.getInputStream()));
            Thread t2 = new Thread(() -> bufs[1] = readAll(p.getErrorStream()));
            t1.start();
            t2.start();
            if (!p.waitFor(seconds, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return new String[] {null, "timed out after " + seconds + " seconds"};
            }
            t1.join();
            t2.join();
            String out = new String(bufs[0], StandardCharsets.UTF_8).strip();
            String err = new String(bufs[1], StandardCharsets.UTF_8).strip();
            if (p.exitValue() != 0) return new String[] {null, err.isEmpty() ? out : err};
            return new String[] {out, null};
        } catch (IOException e) {
            return new String[] {null, String.valueOf(e.getMessage())};
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new String[] {null, "interrupted"};
        }
    }

    private static byte[] readAll(java.io.InputStream in) {
        try {
            return in.readAllBytes();
        } catch (IOException e) {
            return new byte[0];
        }
    }

    String[] git(String... args) {
        List<String> c = new ArrayList<>();
        c.add("git");
        c.addAll(List.of(args));
        return run(c, TIMEOUT_SECONDS);
    }

    boolean isRepo() {
        String[] r = git("rev-parse", "--is-inside-work-tree");
        return "true".equals(r[0]);
    }

    /** Changes to tracked files only: an untracked folder must never block an update. */
    String trackedChanges() {
        String[] r = git("status", "--porcelain", "--untracked-files=no");
        return r[0] == null ? "" : r[0];
    }

    // -- check -------------------------------------------------------------------

    Map<String, Object> remoteHead() throws IOException, InterruptedException {
        String url = "https://api.github.com/repos/" + repoName() + "/commits/" + branch();
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS)).build();
        HttpRequest rq = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                .header("Accept", "application/vnd.github+json").header("User-Agent", "JR!TER").build();
        HttpResponse<String> res = client.send(rq, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) throw new IOException("HTTP " + res.statusCode());
        Map<String, Object> payload = JSON.readValue(res.body(), new TypeReference<Map<String, Object>>() {});
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sha", payload.get("sha") == null ? "" : payload.get("sha"));
        String message = "", date = "";
        if (payload.get("commit") instanceof Map<?, ?> commit) {
            Object m = commit.get("message");
            if (m != null) message = String.valueOf(m).split("\n", -1)[0];
            if (commit.get("committer") instanceof Map<?, ?> who && who.get("date") != null)
                date = String.valueOf(who.get("date"));
        }
        out.put("message", message);
        out.put("date", date);
        return out;
    }

    public Map<String, Object> check() {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!isRepo()) {
            out.put("can_update", false);
            out.put("why", "This copy of JR!TER is not a git checkout, so it cannot update itself.");
            return out;
        }
        String[] local = git("rev-parse", "HEAD");
        if (local[1] != null) {
            out.put("can_update", false);
            out.put("why", "git could not be read: " + local[1]);
            return out;
        }
        Map<String, Object> remote;
        try {
            remote = remoteHead();
        } catch (IOException | RuntimeException e) {
            out.put("can_update", false);
            out.put("local", local[0]);
            out.put("checked", false);
            out.put("why", "GitHub could not be reached: " + e.getMessage());
            return out;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            out.put("can_update", false);
            out.put("local", local[0]);
            out.put("checked", false);
            out.put("why", "GitHub could not be reached: interrupted");
            return out;
        }
        boolean dirty = !trackedChanges().isEmpty();
        String sha = (String) remote.get("sha");
        boolean behind = !sha.isEmpty() && !sha.equals(local[0]);
        out.put("checked", true);
        out.put("local", local[0]);
        out.put("remote", sha);
        out.put("message", remote.get("message"));
        out.put("date", remote.get("date"));
        out.put("update_available", behind);
        out.put("can_update", behind && !dirty);
        out.put("dirty", dirty);
        out.put("why", behind && dirty ? "There are uncommitted changes here, so the update was not applied." : "");
        out.put("repo", repoName());
        out.put("branch", branch());
        return out;
    }

    // -- pull and rebuild --------------------------------------------------------

    String mavenCommand() {
        String given = System.getenv("JRITER_MVN");
        if (given != null && !given.isBlank()) return given.trim();
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win") ? "mvn.cmd" : "mvn";
    }

    /** Build the jar; returns "" on success, else the tail of what Maven said. */
    String build() {
        List<String> c = List.of(mavenCommand(), "-q", "-f", "server/pom.xml", "package", "-DskipTests");
        String[] r = run(c, BUILD_MINUTES * 60);
        if (r[1] == null) return "";
        String why = r[1];
        return why.length() > 2000 ? why.substring(why.length() - 2000) : why;
    }

    /** Fast forward pull, then a rebuild if server/ changed. Throws ApiError when it can't start. */
    Map<String, Object> pull() {
        commit = null;
        if (!isRepo()) throw new ApiError("This copy of JR!TER is not a git checkout, so it cannot update itself.", 409);
        if (!trackedChanges().isEmpty())
            throw new ApiError("There are uncommitted changes to JR!TER's own files here. Commit or "
                    + "discard them first, then update.", 409);
        String before = git("rev-parse", "HEAD")[0];
        String[] pulled = git("pull", "--ff-only", "origin", branch());
        if (pulled[1] != null) throw new ApiError("The pull did not succeed: " + pulled[1], 502);
        String after = git("rev-parse", "HEAD")[0];
        boolean changed = before != null && !before.equals(after);
        List<String> names = new ArrayList<>();
        if (changed) {
            String listing = git("diff", "--name-only", before, after)[0];
            if (listing != null && !listing.isEmpty()) names.addAll(List.of(listing.split("\\R")));
        }
        boolean rebuilt = false;
        String buildError = "";
        if (changed && needsRebuild(names)) {
            buildError = build();
            rebuilt = buildError.isEmpty();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("updated", changed);
        out.put("before", before);
        out.put("after", after);
        out.put("files", names);
        out.put("rebuilt", rebuilt);
        out.put("build_error", buildError);
        out.put("restart_required", rebuilt);
        String message;
        if (!changed) message = "Already up to date.";
        else if (!buildError.isEmpty())
            message = "The new code was pulled but the server did not build, so it is still running the old version.";
        else if (rebuilt) message = "Updated and rebuilt. Restart JR!TER to run the new version.";
        else message = "Updated.";
        out.put("message", message);
        return out;
    }

    /** One update at a time. Returns the pull result, restarting afterwards if it asks. */
    public Map<String, Object> updateNow() {
        if (!busy.tryLock()) throw new ApiError("An update is already under way.", 409);
        Map<String, Object> result;
        try {
            result = pull();
        } finally {
            busy.unlock();
        }
        boolean restarting = Boolean.TRUE.equals(result.get("restart_required"));
        result.put("restarting", restarting);
        if (restarting) stopSoon();
        return result;
    }

    public Map<String, Object> apply() {
        return pull();
    }

    public Map<String, Object> restart() {
        stopSoon();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("restarting", true);
        out.put("note", "Stopping now. If this machine runs the watchdog task it will be back within a few minutes.");
        return out;
    }

    void stopSoon() {
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(STOP_AFTER_MS);
            } catch (InterruptedException e) {
                return;
            }
            stopper.run();
        }, "restart");
        t.setDaemon(true);
        t.start();
    }

    private void exitProcess() {
        int code = 0;
        try {
            code = SpringApplication.exit(context, () -> 0);
        } catch (RuntimeException ignored) { /* leave anyway */ }
        System.exit(code);
    }

    /** Short commit of what this process runs, for /api/state later: null when not a checkout. */
    public String commit() {
        if (commit == null) {
            if (!isRepo()) commit = "";
            else {
                String r = git("rev-parse", "--short", "HEAD")[0];
                commit = r == null || r.isEmpty() ? "unknown" : r;
            }
        }
        return commit.isEmpty() ? null : commit;
    }

    // -- on its own --------------------------------------------------------------

    private boolean autoUpdateOff() {
        Path p = config.home(Accounts.OWNER).resolve("settings.json");
        try {
            if (Files.isRegularFile(p)) {
                Map<String, Object> m = JSON.readValue(p.toFile(), new TypeReference<Map<String, Object>>() {});
                return m != null && Boolean.FALSE.equals(m.get("auto_update"));
            }
        } catch (IOException ignored) { /* a broken settings file reads as none */ }
        return false;
    }

    /** One look, and one update if there is one. Returns what happened, for the log. */
    String autoOnce() {
        if (!isRepo()) return "not a checkout";
        if (autoUpdateOff()) return "switched off";
        String onBranch = git("rev-parse", "--abbrev-ref", "HEAD")[0];
        if (onBranch != null && !onBranch.strip().equals(branch())) return "on " + onBranch.strip() + ", not " + branch();
        if (!busy.tryLock()) return "busy";
        Map<String, Object> result;
        try {
            Map<String, Object> info = check();
            if (!Boolean.TRUE.equals(info.get("update_available")))
                return Boolean.TRUE.equals(info.get("checked")) ? "up to date" : String.valueOf(info.get("why"));
            if (!Boolean.TRUE.equals(info.get("can_update"))) {
                String why = String.valueOf(info.get("why"));
                return why.isEmpty() ? "cannot update" : why;
            }
            result = pull();
        } catch (ApiError e) {
            return e.getMessage();
        } finally {
            busy.unlock();
        }
        String after = String.valueOf(result.get("after"));
        String shortSha = after.substring(0, Math.min(7, after.length()));
        if (!String.valueOf(result.get("build_error")).isEmpty())
            return "pulled " + shortSha + " but the build failed; still on the old jar";
        if (Boolean.TRUE.equals(result.get("restart_required"))) {
            stopSoon();
            return "updated to " + shortSha + ", rebuilt, restarting";
        }
        return "updated to " + shortSha;
    }

    /** Only where something starts the server again (the host launcher sets JRITER_WATCHDOG). */
    @EventListener(ApplicationReadyEvent.class)
    public void startAuto() {
        if (!"1".equals(System.getenv("JRITER_WATCHDOG"))) return;
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(FIRST_AFTER_MS);
                while (true) {
                    String said;
                    try {
                        said = autoOnce();
                    } catch (Exception e) {      // never let the loop die
                        said = e.getClass().getSimpleName() + ": " + e.getMessage();
                    }
                    // stdout: the host launcher turns stderr lines into errors
                    System.out.println("  update    " + said);
                    System.out.flush();
                    Thread.sleep(EVERY_MS);
                }
            } catch (InterruptedException e) {
                // shutting down
            }
        }, "auto-update");
        t.setDaemon(true);
        t.start();
    }
}
