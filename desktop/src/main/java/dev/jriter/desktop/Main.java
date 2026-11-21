package dev.jriter.desktop;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** jriter-cli commands, and the tray app when started with none (or --minimised). */
public final class Main {
    public static void main(String[] argv) {
        System.exit(run(argv, System.out));
    }

    static boolean yes(List<String> a) { return a.remove("--yes") | a.remove("-y"); }

    static String opt(List<String> a, String name) {
        int i = a.indexOf(name);
        if (i < 0 || i + 1 >= a.size()) return null;
        String v = a.get(i + 1);
        a.remove(i + 1); a.remove(i);
        return v;
    }

    static boolean ask(String q) {
        System.out.print("  " + q + " [Y/n] ");
        System.out.flush();
        try {
            String line = new java.util.Scanner(System.in).nextLine().trim().toLowerCase();
            return line.isEmpty() || line.equals("y") || line.equals("yes");
        } catch (NoSuchElementException e) { return false; }
    }

    static int run(String[] argv, java.io.PrintStream out) {
        List<String> a = new ArrayList<>(Arrays.asList(argv));
        Config cfg = Config.load();
        Log log = new Log(cfg.dir());
        if (a.isEmpty() || a.get(0).equals("--minimised")) return tray(a.contains("--minimised"), cfg, log);
        String cmd = a.remove(0);
        try {
            switch (cmd) {
                case "help", "--help", "-h": return help(out);
                case "add": {
                    Path p = Path.of(a.get(0)).toAbsolutePath().normalize();
                    if (!Files.isDirectory(p)) { out.println("There is no folder at " + p); return 1; }
                    if (cfg.folders().contains(p.toString())) { out.println("Already watching " + p); return 0; }
                    cfg.addFolder(p.toString()).save();
                    out.println("Watching " + p);
                    return 0;
                }
                case "folders": {
                    if (cfg.folders().isEmpty()) out.println("No folders yet. Add one with `add <path>`.");
                    cfg.folders().forEach(f -> out.println("  " + f + (Files.isDirectory(Path.of(f)) ? "" : "   (missing)")));
                    out.println("\nServer: " + cfg.server());
                    out.println("Config: " + cfg.path());
                    return 0;
                }
                case "server": {
                    cfg.set("server", a.get(0).replaceAll("/+$", "")).save();
                    out.println("Server set to " + cfg.server());
                    return 0;
                }
                case "flpath": {
                    cfg.set("fl_path", a.get(0)).save();
                    out.println("FL Studio set to " + a.get(0));
                    return 0;
                }
                case "login": return login(cfg, a, out);
                case "scan": {
                    Library lib = new Library(cfg.server(), cfg.token());
                    Survey.Result r = Survey.run(cfg, lib);
                    out.println(r.known().size() + " file(s) already in the library");
                    if (r.fresh().isEmpty()) { out.println("Nothing new."); return 0; }
                    out.println("\n" + r.fresh().size() + " new file(s):");
                    for (Survey.Found f : r.fresh()) {
                        String name = f.path().getFileName().toString();
                        var s = lib.get("/api/songs/match?name=" + Library.enc(name)).path("suggest");
                        out.println("  " + name);
                        out.println("      " + (s.isObject() ? "looks like a new render of " + s.path("title").asText() : "no obvious match, would be a new song"));
                    }
                    out.println("\nRun `push` to send them.");
                    return 0;
                }
                case "push": {
                    boolean y = yes(a);
                    Library lib = new Library(cfg.server(), cfg.token());
                    Survey.Result r = Survey.run(cfg, lib);
                    if (r.fresh().isEmpty()) { out.println("Nothing new. " + r.known().size() + " file(s) already in the library."); return 0; }
                    int sent = 0, skipped = 0;
                    for (Survey.Found f : r.fresh()) {
                        if (Send.one(lib, cfg, f.path(), y, Main::ask, t -> out.println("      " + t))) sent++; else skipped++;
                    }
                    out.println("\n" + sent + " sent, " + skipped + " skipped, " + r.known().size() + " already held.");
                    return 0;
                }
                case "push-file": {
                    boolean y = yes(a);
                    Path p = Path.of(a.get(0)).toAbsolutePath();
                    if (!Files.isRegularFile(p)) { out.println("There is no file at " + p); return 1; }
                    if (!Survey.isAudio(p)) { out.println(p.getFileName() + " is not audio JR!TER handles."); return 1; }
                    out.println("JR!TER at " + cfg.server());
                    return Send.one(new Library(cfg.server(), cfg.token()), cfg, p, y, Main::ask, t -> out.println("  " + t)) ? 0 : 1;
                }
                case "push-folder": {
                    boolean y = yes(a);
                    Path folder = Path.of(a.get(0)).toAbsolutePath();
                    if (!Files.isDirectory(folder)) { out.println("There is no folder at " + folder); return 1; }
                    out.println("JR!TER at " + cfg.server());
                    out.println("Looking in " + folder);
                    List<Path> files = Survey.walk(List.of(folder.toString()));
                    if (files.isEmpty()) { out.println("  no sound files in there."); return 0; }
                    out.println("  " + files.size() + " sound file(s).");
                    if (!(y || ask("Send all of them?"))) return 0;
                    Library lib = new Library(cfg.server(), cfg.token());
                    int sent = 0, failed = 0;
                    for (Path f : files) {
                        try { if (Send.one(lib, cfg, f, true, Main::ask, t -> out.println("  " + t))) sent++; }
                        catch (RuntimeException | IOException e) { out.println("  could not send " + f.getFileName() + ": " + e.getMessage()); failed++; }
                    }
                    out.println("\n" + sent + " sent, " + failed + " could not be sent.");
                    return failed > 0 && sent == 0 ? 1 : 0;
                }
                case "render": return render(cfg, a, out);
                case "plugins": return plugins(a, out);
                case "watch": {
                    boolean once = a.contains("--once");
                    out.println("Watching " + cfg.folders().size() + " folder(s), every " + cfg.intervalMinutes() + " minute(s). Ctrl-C to stop.");
                    while (true) {
                        try { Watcher.once(Config.load(), (k, t) -> { out.println("[" + k + "] " + t); log.line(t); }); }
                        catch (Library.LibraryException e) { out.println(e.getMessage()); }
                        if (once) return 0;
                        Thread.sleep(cfg.intervalMinutes() * 60_000L);
                    }
                }
                case "shell": {
                    if (a.isEmpty() || a.get(0).equals("install")) {
                        Path icon = cfg.dir().resolve("jriter.ico");
                        int n = Windows.installMenu(Windows.cliExe(), Files.exists(icon) ? icon : null);
                        out.println("Added " + n + " entries under HKEY_CURRENT_USER.");
                    } else { Windows.removeMenu(); out.println("Removed."); }
                    return 0;
                }
                case "autostart": {
                    boolean on = a.isEmpty() || a.get(0).equals("on");
                    Path exe = Windows.cliExe().resolveSibling("JRITER.exe");
                    Windows.autostart(on, exe);
                    out.println(on ? "JR!TER will start at logon." : "JR!TER will not start at logon.");
                    return 0;
                }
                default:
                    out.println("Unknown command: " + cmd);
                    help(out);
                    return 2;
            }
        } catch (Library.LibraryException e) {
            out.println(e.getMessage());
            return 1;
        } catch (IndexOutOfBoundsException e) {
            out.println("`" + cmd + "` needs an argument. Try `help`.");
            return 2;
        } catch (IOException | InterruptedException e) {
            out.println(e.toString());
            return 1;
        }
    }

    static int login(Config cfg, List<String> a, java.io.PrintStream out) throws IOException {
        String handle = Optional.ofNullable(opt(a, "--handle")).orElse("").trim();
        String name = opt(a, "--name");
        String password = opt(a, "--password");
        if (name == null) name = Optional.ofNullable(System.getenv("COMPUTERNAME")).filter(s -> !s.isBlank()).orElse("a machine");
        if (password == null) {
            java.io.Console c = System.console();
            if (c == null) { out.println("No console to ask for the password: pass --password."); return 1; }
            char[] pw = c.readPassword("Password for %s: ", cfg.server());
            password = pw == null ? "" : new String(pw);
        }
        if (password.isEmpty()) { out.println("Nothing entered."); return 1; }
        cfg.set("token", Library.login(cfg.server(), handle, password, name)).save();
        out.println("This machine can now reach " + cfg.server() + " as \"" + name + "\".");
        out.println("It can upload renders and read the library. It cannot delete anything.");
        return 0;
    }

    static int render(Config cfg, List<String> a, java.io.PrintStream out) {
        Path path = Path.of(a.get(0)).toAbsolutePath();
        Optional<Path> fl = FlRender.find(cfg.flPath());
        if (fl.isEmpty()) { out.println("FL Studio was not found. Set it once with:\n    jriter-cli flpath \"C:\\Program Files\\Image-Line\\FL Studio 2024\\FL64.exe\""); return 1; }
        out.println("Using " + fl.get());
        out.println("FL will open while it renders. It is not a silent process, and on some\nversions the export dialog waits for Start to be pressed.\n");
        List<Path> projects = Files.isDirectory(path) ? FlRender.projectsIn(path) : List.of(path);
        if (!Files.exists(path)) { out.println("There is nothing at " + path); return 1; }
        Path outDir = cfg.renderOut().isBlank() ? null : Path.of(cfg.renderOut());
        Library lib = new Library(cfg.server(), cfg.token());
        List<String> failed = new ArrayList<>();
        int done = 0;
        for (Path p : projects) {
            try {
                FlRender.Rendered r = FlRender.render(p, outDir, cfg.renderFormat(), cfg.flPath(), 1800, 4.0, t -> out.println("  " + t));
                done++;
                try {
                    boolean added = Send.render(lib, r.audio(), r.projectAt(), r.renderedAt(), true);
                    out.println("  " + r.audio().getFileName() + (added ? " is waiting in Renders" : " was already there"));
                } catch (RuntimeException e) { out.println("  could not send " + r.audio().getFileName() + ": " + e.getMessage()); }
            } catch (FlRender.RenderException e) {
                out.println("  " + e.getMessage());
                failed.add(p.getFileName() + ": " + e.getMessage());
            }
        }
        out.println("\n" + done + " rendered.");
        if (!failed.isEmpty()) { out.println("\n" + failed.size() + " did not render:"); failed.forEach(f -> out.println("  " + f)); }
        return done == 0 && !failed.isEmpty() ? 1 : 0;
    }

    static int plugins(List<String> a, java.io.PrintStream out) {
        boolean json = a.remove("--json");
        Path path = Path.of(a.get(0)).toAbsolutePath();
        if (!Files.exists(path)) { out.println("There is nothing at " + path); return 1; }
        List<Path> projects = Files.isDirectory(path) ? FlRender.projectsIn(path) : List.of(path);
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var all = mapper.createArrayNode();
        int read = 0;
        for (Path p : projects) {
            try {
                List<FlProject.Plugin> pl = FlProject.plugins(p);
                read++;
                if (json) {
                    var o = all.addObject();
                    o.put("project", p.getFileName().toString());
                    var arr = o.putArray("plugins");
                    for (FlProject.Plugin x : pl) {
                        var po = arr.addObject();
                        po.put("kind", x.kind()); po.put("name", x.name()); po.put("vendor", x.vendor());
                        po.put("path", x.path()); po.put("uses", x.uses());
                    }
                } else {
                    out.println(p.getFileName());
                    if (pl.isEmpty()) out.println("  no plugins found");
                    for (FlProject.Plugin x : pl)
                        out.println("  " + String.format("%-5s", x.kind().toUpperCase()) + " " + x.name()
                                + (x.vendor().isEmpty() ? "" : "  (" + x.vendor() + ")") + (x.uses() > 1 ? "  x" + x.uses() : ""));
                }
            } catch (IOException | RuntimeException e) {
                if (!json) { out.println(p.getFileName()); out.println("  could not read: " + e.getMessage()); }
            }
        }
        if (json) out.println(all.toString());
        if (projects.isEmpty() && !json) out.println("no .flp files there.");
        return read == 0 && !projects.isEmpty() ? 1 : 0;
    }

    static int tray(boolean minimised, Config cfg, Log log) {
        if (!Windows.firstInstance()) {
            if (!minimised) Windows.openWindow(cfg.server());
            return 0;
        }
        Tray.run(cfg, log);
        if (!minimised) Windows.openWindow(cfg.server());
        try { Thread.currentThread().join(); } catch (InterruptedException ignored) { }
        return 0;
    }

    static int help(java.io.PrintStream out) {
        out.println("""
                JR!TER desktop

                  jriter-cli server URL         where the library is
                  jriter-cli login [--handle H] [--name N] [--password P]
                  jriter-cli add FOLDER         watch a folder for renders
                  jriter-cli folders
                  jriter-cli scan               what is new, sending nothing
                  jriter-cli push [--yes]       send what is new onto songs
                  jriter-cli push-file FILE [--yes]
                  jriter-cli push-folder FOLDER [--yes]
                  jriter-cli render FLP_OR_FOLDER   render with FL Studio, send to Renders
                  jriter-cli plugins FLP_OR_FOLDER [--json]   which plugins a project uses
                  jriter-cli flpath FL64.EXE
                  jriter-cli watch [--once]     keep sending new renders
                  jriter-cli shell install|remove    right-click menu
                  jriter-cli autostart on|off   start the tray at logon
                  JRITER.exe [--minimised]      the tray app""");
        return 0;
    }
}
