package dev.jriter.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Releasing an album: the web page (/release.html) saves a release card and the files into the
 * Downloads folder and opens jriter://release/ID; this starts Claude Code on that card, in a
 * terminal on this PC, where the owner can sign in to RouteNote themselves.
 * Only digits ever reach the command line: the id is the one thing that comes from the link.
 */
final class Release {
    private Release() { }

    static final Pattern URL = Pattern.compile("^jriter://release/(\\d{1,9})/?$");

    /** The album id in a jriter:// link, or empty for anything else. */
    static Optional<String> parseUrl(String url) {
        if (url == null) return Optional.empty();
        Matcher m = URL.matcher(url.trim());
        return m.matches() ? Optional.of(m.group(1)) : Optional.empty();
    }

    static String cardName(String id) { return "jriter-release-" + id + ".json"; }

    static String prompt(String id) {
        return "Read " + cardName(id) + " in this folder and do what its about field says. "
                + "Never press RouteNote's final submit without my OK here.";
    }

    /** cmd /c start "title" /D folder claude "prompt": a new terminal window that stays with claude. */
    static List<String> command(Path folder, String id) {
        return List.of("cmd", "/c", "start", "JR!TER release", "/D", folder.toString(), "claude", prompt(id));
    }

    static Path defaultFolder() {
        return Path.of(System.getProperty("user.home"), "Downloads");
    }

    /** The files the card names, so we can wait until the browser has finished saving them. */
    static List<String> filesNamed(JsonNode card) {
        List<String> out = new ArrayList<>();
        String cover = card.path("cover").path("file").asText("");
        if (!cover.isEmpty()) out.add(cover);
        for (JsonNode t : card.path("tracks")) {
            String f = t.path("file").asText("");
            if (!f.isEmpty()) out.add(f);
        }
        return out;
    }

    /** True if a name from the card is a plain file name that cannot leave the folder. */
    static boolean plain(String name) {
        return !name.isEmpty() && name.equals(Path.of(name).getFileName().toString()) && !name.contains("..");
    }

    static boolean hasClaude() {
        String path = System.getenv("PATH");
        if (path == null) return false;
        for (String dir : path.split(java.io.File.pathSeparator))
            for (String n : List.of("claude.exe", "claude.cmd", "claude.bat"))
                if (!dir.isBlank() && Files.isRegularFile(Path.of(dir, n))) return true;
        return false;
    }

    static boolean ready(Path folder, String id) throws IOException {
        Path card = folder.resolve(cardName(id));
        if (!Files.isRegularFile(card)) return false;
        JsonNode j;
        try { j = Config.JSON.readTree(card.toFile()); } catch (IOException e) { return false; } // half written
        for (String f : filesNamed(j)) {
            if (!plain(f)) throw new IOException("the card names a file outside its folder: " + f);
            if (!Files.isRegularFile(folder.resolve(f)) || Files.exists(folder.resolve(f + ".crdownload"))) return false;
        }
        return true;
    }

    static int run(String id, Path folder, int waitSeconds, boolean launch, PrintStream out) {
        try {
            if (launch && !hasClaude()) {
                out.println("Claude Code (claude) is not on this PC's PATH. Install it from https://claude.com/claude-code and try again.");
                return 1;
            }
            out.println("Looking for " + cardName(id) + " in " + folder);
            long end = System.currentTimeMillis() + waitSeconds * 1000L;
            while (!ready(folder, id)) {
                if (System.currentTimeMillis() > end) {
                    out.println("The release card and its files are not all in " + folder + ". Use Download on the release page first.");
                    return 1;
                }
                Thread.sleep(1000);
            }
            if (launch) {
                new ProcessBuilder(command(folder, id)).start();
                out.println("Started Claude Code. Sign in to RouteNote yourself when it asks.");
            }
            return 0;
        } catch (IOException | InterruptedException e) {
            out.println(e.getMessage());
            return 1;
        }
    }
}
