package dev.jriter.desktop;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.*;
import java.util.*;

/** Everything Windows-specific: right-click menu, start at logon, one copy, the app window. */
public final class Windows {
    static final String KEY_ROOT = "HKCU\\Software\\Classes";
    static final List<String> AUDIO_EXT = List.of(".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus");
    static final String RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    public record Entry(String name, List<String> parents, String label, String command, String arg) { }

    static List<Entry> entries() {
        List<String> audio = AUDIO_EXT.stream().map(e -> "SystemFileAssociations\\" + e + "\\shell").toList();
        return List.of(
                new Entry("JriterUpload", audio, "Upload to JR!TER", "push-file", "%1"),
                new Entry("JriterRenderFlp", List.of("SystemFileAssociations\\.flp\\shell"), "Render and send to JR!TER", "render", "%1"),
                new Entry("JriterPushFolder", List.of("Directory\\shell", "Directory\\Background\\shell"), "Upload every sound file in here", "push-folder", "%V"),
                new Entry("JriterRenderFolder", List.of("Directory\\shell", "Directory\\Background\\shell"), "Render every FL project in here", "render", "%V"),
                new Entry("JriterWatchFolder", List.of("Directory\\shell"), "Watch this folder with JR!TER", "add", "%V"));
    }

    /** The exact string for the registry; /s keeps the quotes of a path with a space. */
    static String commandLine(Path cli, String command, String arg) {
        return "cmd /s /c \"\"" + cli + "\" " + command + " \"" + arg + "\" & pause\"";
    }

    /** The window command: a Chromium browser in --app mode with a profile of its own. */
    static List<String> windowCommand(String url, String exe, Path profile) {
        return List.of(exe, "--app=" + url, "--user-data-dir=" + profile, "--window-size=1180,860",
                "--no-first-run", "--no-default-browser-check");
    }

    static final List<String> BROWSERS = List.of(
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe");

    public static Optional<String> findBrowser() {
        return BROWSERS.stream().filter(p -> Files.isRegularFile(Path.of(p))).findFirst();
    }

    public static void openWindow(String url) {
        try {
            Optional<String> exe = findBrowser();
            String local = Optional.ofNullable(System.getenv("LOCALAPPDATA")).orElse(System.getProperty("java.io.tmpdir"));
            if (exe.isPresent()) {
                Path profile = Path.of(local, "JRITER", "window");
                Files.createDirectories(profile);
                new ProcessBuilder(windowCommand(url, exe.get(), profile)).start();
            } else if (java.awt.Desktop.isDesktopSupported()) {
                java.awt.Desktop.getDesktop().browse(java.net.URI.create(url));
            }
        } catch (IOException ignored) { }
    }

    private static final List<Object> HELD = new ArrayList<>();

    /** True if this is the only copy running for this person. */
    public static boolean firstInstance() {
        try {
            String local = Optional.ofNullable(System.getenv("LOCALAPPDATA")).orElse(System.getProperty("java.io.tmpdir"));
            Path lock = Path.of(local, "JRITER", "app.lock");
            Files.createDirectories(lock.getParent());
            FileChannel ch = FileChannel.open(lock, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
            FileLock l = ch.tryLock();
            if (l == null) return false;
            HELD.add(ch); HELD.add(l);
            return true;
        } catch (IOException | java.nio.channels.OverlappingFileLockException e) {
            return e instanceof java.nio.channels.OverlappingFileLockException ? false : true;
        }
    }

    /** The cli launcher beside the running exe, or the running exe itself. */
    public static Path cliExe() {
        Path self = ProcessHandle.current().info().command().map(Path::of).orElse(Path.of("jriter-cli.exe"));
        Path sibling = self.resolveSibling("jriter-cli.exe");
        return Files.isRegularFile(sibling) ? sibling : self;
    }

    static int reg(String... args) {
        List<String> cmd = new ArrayList<>(List.of("reg"));
        cmd.addAll(Arrays.asList(args));
        try {
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            p.getInputStream().readAllBytes();
            return p.waitFor();
        } catch (IOException e) { return 1; } catch (InterruptedException e) { Thread.currentThread().interrupt(); return 1; }
    }

    public static int installMenu(Path cli, Path icon) {
        removeMenu();
        int n = 0;
        for (Entry e : entries()) for (String parent : e.parents()) {
            String key = KEY_ROOT + "\\" + parent + "\\" + e.name();
            reg("add", key, "/ve", "/d", e.label(), "/f");
            if (icon != null) reg("add", key, "/v", "Icon", "/d", icon.toString(), "/f");
            reg("add", key + "\\command", "/ve", "/d", commandLine(cli, e.command(), e.arg()), "/f");
            n++;
        }
        return n;
    }

    public static void removeMenu() {
        for (Entry e : entries()) for (String parent : e.parents())
            reg("delete", KEY_ROOT + "\\" + parent + "\\" + e.name(), "/f");
    }

    public static void autostart(boolean on, Path exe) {
        if (on) reg("add", RUN_KEY, "/v", "JRITER", "/d", "\"" + exe + "\" --minimised", "/f");
        else reg("delete", RUN_KEY, "/v", "JRITER", "/f");
    }
}
