package dev.jriter.desktop;

import java.nio.file.Path;
import java.util.function.BiConsumer;

/** The scan-and-send loop on its own thread. Renders go to the Renders list, never onto a guess. */
public final class Watcher extends Thread {
    private final Log log;
    private final BiConsumer<String, String> say;
    private final Object gate = new Object();
    private volatile boolean stop, paused, poke;

    public Watcher(Log log, BiConsumer<String, String> say) {
        super("jriter-watcher");
        setDaemon(true);
        this.log = log;
        this.say = say;
    }

    public void checkNow() { synchronized (gate) { poke = true; gate.notifyAll(); } }
    public void pause(boolean p) { paused = p; if (!p) checkNow(); }
    public boolean paused() { return paused; }
    public void quit() { synchronized (gate) { stop = true; gate.notifyAll(); } }

    private void tell(String kind, String text) { log.line(text); say.accept(kind, text); }

    /** One pass. Returns how many renders were sent. */
    public static int once(Config cfg, BiConsumer<String, String> tell) {
        if (cfg.folders().isEmpty()) { tell.accept("idle", "No folders watched yet."); return 0; }
        Library lib = new Library(cfg.server(), cfg.token());
        Survey.Result r = Survey.run(cfg, lib);
        if (r.fresh().isEmpty()) { tell.accept("ok", "Nothing new. " + r.known().size() + " file(s) already in the library."); return 0; }
        tell.accept("work", r.fresh().size() + " new file(s).");
        int sent = 0;
        for (Survey.Found f : r.fresh()) {
            try {
                Send.render(lib, f.path(), 0, 0, false);
                sent++;
                tell.accept("sent", f.path().getFileName().toString());
            } catch (RuntimeException e) {
                tell.accept("bad", f.path().getFileName() + ": " + e.getMessage());
            }
        }
        tell.accept("ok", sent + " render(s) waiting in the library.");
        return sent;
    }

    @Override public void run() {
        while (!stop) {
            Config cfg = Config.load();
            if (!paused) {
                try { once(cfg, this::tell); }
                catch (Library.LibraryException e) { tell("bad", e.getMessage().lines().findFirst().orElse("")); }
                catch (Exception e) { tell("bad", e.getClass().getSimpleName() + ": " + e.getMessage()); }
            }
            synchronized (gate) {
                if (!poke && !stop) {
                    try { gate.wait(cfg.intervalMinutes() * 60_000L); } catch (InterruptedException e) { return; }
                }
                poke = false;
            }
        }
    }
}
