package dev.jriter;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.BiPredicate;
import java.util.function.DoubleConsumer;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.springframework.stereotype.Component;

/**
 * Turning a mix and a picture into a video when the machine has ffmpeg: a port of jriter/video.py
 * (read its docstrings for the reasoning, which is not repeated here). Finding ffmpeg, fetching a
 * pinned build and checking its SHA-256 before anything is run, and the two ffmpeg command lines.
 */
@Component
public class Video {
    static final String VERSION = "7.1";
    static final String URL = "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip";
    static final String SHA256 = "fa7d4d7e795db0e2503f49f105f46ed5852386f0cfdd819899be3b65ebde24fc";
    static final long SIZE = 92100272L;
    static final String MEMBER = "bin/ffmpeg.exe";
    static final long MOST = 400L * 1024 * 1024;
    static final int CHUNK = 1024 * 1024;
    static final int WIDTH = 1280, HEIGHT = 720, FPS = 2, GOP = FPS * 10, TAIL = 40;
    static final String GROUND = "0x101014";
    static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    static final String MISSING = "JR!TER cannot find ffmpeg on this machine, so it cannot turn the mix into a "
            + "video. Install ffmpeg and restart JR!TER, or put the full path to ffmpeg.exe in Settings.";

    private final Settings settings;
    private volatile Map<String, Object> found;

    public Video(Settings settings) { this.settings = settings; }

    // -- finding -----------------------------------------------------------------

    static Path toolsDir() {
        String told = System.getenv("JRITER_TOOLS");
        if (told != null && !told.isBlank()) return Path.of(told.trim());
        if (WINDOWS) {
            String pd = System.getenv("ProgramData");
            return Path.of(pd == null || pd.isBlank() ? "C:\\ProgramData" : pd, "JRITER", "tools");
        }
        return Path.of(System.getProperty("user.home"), ".local", "share", "jriter", "tools");
    }

    static Path managedPath() {
        return toolsDir().resolve("ffmpeg-" + VERSION).resolve(WINDOWS ? "ffmpeg.exe" : "ffmpeg");
    }

    private static List<String> whichAll() {
        List<String> out = new ArrayList<>();
        String path = System.getenv("PATH");
        if (path == null) return out;
        for (String dir : path.split(File.pathSeparator)) {
            if (dir.isBlank()) continue;
            for (String n : WINDOWS ? new String[] {"ffmpeg.exe", "ffmpeg.cmd", "ffmpeg.bat"} : new String[] {"ffmpeg"}) {
                Path p = Path.of(dir.replace("\"", ""), n);
                if (Files.isRegularFile(p)) {
                    out.add(p.toString());
                    return out;
                }
            }
        }
        return out;
    }

    private static List<Path> children(Path dir) {
        try (var s = Files.list(dir)) {
            return s.sorted().toList();
        } catch (IOException | RuntimeException e) {
            return List.of();
        }
    }

    private static void findNamed(Path dir, int depth, List<String> out) {
        for (Path p : children(dir)) {
            if (Files.isDirectory(p) && depth > 0) findNamed(p, depth - 1, out);
            else if (p.getFileName().toString().equalsIgnoreCase("ffmpeg.exe")) out.add(p.toString());
        }
    }

    List<String> candidates(long acct) {
        List<String> out = new ArrayList<>();
        Object told = settings.get(acct).get("ffmpeg_path");
        if (told instanceof String s && !s.strip().isEmpty()) out.add(s.strip());
        out.addAll(whichAll());
        out.add(managedPath().toString());
        if (WINDOWS) {
            for (Path user : children(Path.of("C:\\Users"))) {
                for (Path pkg : children(user.resolve("AppData\\Local\\Microsoft\\WinGet\\Packages")))
                    if (pkg.getFileName().toString().toLowerCase(Locale.ROOT).contains("ffmpeg")) findNamed(pkg, 6, out);
                out.add(user.resolve("scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe").toString());
                for (Path prog : children(user.resolve("AppData\\Local\\Programs")))
                    if (prog.getFileName().toString().toLowerCase(Locale.ROOT).contains("ffmpeg"))
                        out.add(prog.resolve("bin\\ffmpeg.exe").toString());
            }
            out.add("C:\\ffmpeg\\bin\\ffmpeg.exe");
            out.add("C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe");
            out.add("C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe");
        } else {
            out.add("/usr/bin/ffmpeg");
            out.add("/usr/local/bin/ffmpeg");
            out.add("/opt/homebrew/bin/ffmpeg");
        }
        return out;
    }

    /** A path that exists is not a program that runs: the version line, or null. */
    static String runs(String path) {
        if (path == null || path.isEmpty() || !Files.isRegularFile(Path.of(path))) return null;
        try {
            Process p = new ProcessBuilder(path, "-hide_banner", "-version").redirectErrorStream(false)
                    .redirectInput(ProcessBuilder.Redirect.from(nullDevice())).start();
            byte[][] bufs = new byte[2][];
            Thread t1 = new Thread(() -> bufs[0] = readAll(p.getInputStream()));
            Thread t2 = new Thread(() -> bufs[1] = readAll(p.getErrorStream()));
            t1.start();
            t2.start();
            if (!p.waitFor(15, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            t1.join();
            t2.join();
            String first = new String(bufs[0], StandardCharsets.UTF_8).lines().findFirst().orElse("");
            if (p.exitValue() != 0 || !first.startsWith("ffmpeg version")) return null;
            return first.strip();
        } catch (IOException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private static byte[] readAll(InputStream in) {
        try {
            return in.readAllBytes();
        } catch (IOException e) {
            return new byte[0];
        }
    }

    private static File nullDevice() { return new File(WINDOWS ? "NUL" : "/dev/null"); }

    /** found, path, version, why. Cached until forget() or again. */
    public Map<String, Object> find(long acct, boolean again) {
        Map<String, Object> cached = found;
        if (cached != null && !again) return cached;
        for (String path : candidates(acct)) {
            String version = runs(path);
            if (version != null) return found = result(true, path, version, "");
        }
        return found = result(false, "", "", MISSING);
    }

    private static Map<String, Object> result(boolean ok, String path, String version, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("found", ok);
        m.put("path", path);
        m.put("version", version);
        m.put("why", why);
        return m;
    }

    public void forget() { found = null; }

    /** Whether fetch() has anything to try, and a sentence when it does not: [ok, why]. */
    public Object[] canInstall() {
        if (!WINDOWS)
            return new Object[] {false, "On this machine JR!TER does not fetch ffmpeg for itself. Install "
                    + "it with the system's package manager and restart JR!TER."};
        return new Object[] {true, ""};
    }

    // -- fetching ----------------------------------------------------------------

    /** Take exactly one file out of the zip. No name from the archive is ever joined to a path. */
    static void extract(Path archive, Path into) throws IOException {
        String tail = "/" + MEMBER;
        try (ZipFile z = new ZipFile(archive.toFile())) {
            ZipEntry member = null;
            for (var en = z.entries(); en.hasMoreElements();) {
                ZipEntry e = en.nextElement();
                if (!e.isDirectory() && e.getName().replace('\\', '/').endsWith(tail)) {
                    member = e;
                    break;
                }
            }
            if (member == null)
                throw new ApiError("That archive has no " + MEMBER + " in it, so JR!TER has not run anything out of it.", 502);
            if (member.getSize() > MOST)
                throw new ApiError(MEMBER + " says it unpacks to " + member.getSize() + " bytes, which the pinned build does not.", 502);
            Files.createDirectories(into.getParent());
            try (InputStream src = z.getInputStream(member); OutputStream dst = Files.newOutputStream(into)) {
                src.transferTo(dst);
            }
        }
        if (!WINDOWS) into.toFile().setExecutable(true);
    }

    /** Download hashing on the way past. Returns {size, digest}, or null when asked to stop. */
    private static Object[] download(Path into, BiPredicate<Long, Long> say) throws IOException {
        HttpURLConnection c = (HttpURLConnection) URI.create(URL).toURL().openConnection();
        c.setConnectTimeout(60000);
        c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "JR!TER");
        MessageDigest h = Blobs.sha256();
        long got = 0;
        long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : SIZE;
        try (InputStream in = c.getInputStream(); OutputStream out = Files.newOutputStream(into)) {
            byte[] buf = new byte[CHUNK];
            int n;
            while ((n = in.read(buf)) > 0) {
                got += n;
                if (got > MOST)
                    throw new ApiError("That download is past " + MOST + " bytes and the pinned build is not that big. Nothing has been run.", 502);
                h.update(buf, 0, n);
                out.write(buf, 0, n);
                if (say.test(got, total)) return null;
            }
        }
        return new Object[] {got, Blobs.hex(h.digest())};
    }

    /** Get an ffmpeg onto this machine. Returns its path, or "" if asked to stop. */
    public String fetch(BiPredicate<Long, Long> say) {
        Path landing = managedPath();
        Path room = landing.getParent();
        Path archive = room.resolve("ffmpeg-" + VERSION + ".zip.unchecked");
        Path incoming = Path.of(landing + ".unchecked");
        try {
            Files.createDirectories(room);
            try {
                Object[] got = download(archive, say);
                if (got == null) return "";
                long size = (Long) got[0];
                String digest = (String) got[1];
                if (!digest.equals(SHA256))
                    throw new ApiError("The file that arrived is not the ffmpeg JR!TER expected. The pinned build hashes to "
                            + SHA256.substring(0, 16) + " and " + size + " bytes arrived hashing to " + digest.substring(0, 16)
                            + ". Nothing has been unpacked, nothing has been run, and the download has been deleted.", 502);
                extract(archive, incoming);
            } finally {
                Files.deleteIfExists(archive);
            }
            if (runs(incoming.toString()) == null)
                throw new ApiError("The ffmpeg JR!TER fetched matched its checksum and then would not run on this machine. "
                        + "It has been left at " + incoming + ".", 502);
            Files.move(incoming, landing, StandardCopyOption.REPLACE_EXISTING);
            sweep(room);
            forget();
            return landing.toString();
        } catch (IOException e) {
            throw new ApiError("Could not fetch ffmpeg: " + e.getMessage(), 502);
        }
    }

    /** Every fetched copy but the one named. */
    static int sweep(Path keep) {
        int gone = 0;
        for (Path p : children(toolsDir())) {
            if (!p.getFileName().toString().startsWith("ffmpeg-")) continue;
            if (keep != null && p.toAbsolutePath().normalize().equals(keep.toAbsolutePath().normalize())) continue;
            deleteTree(p);
            gone++;
        }
        return gone;
    }

    static void deleteTree(Path p) {
        try {
            if (Files.isDirectory(p)) for (Path c : children(p)) deleteTree(c);
            Files.deleteIfExists(p);
        } catch (IOException ignored) { /* best effort */ }
    }

    // -- the command lines -------------------------------------------------------

    static List<String> stillArgv(String tool, String source, String out) {
        return List.of(tool, "-hide_banner", "-nostdin", "-y", "-i", source, "-frames:v", "1", "-vf",
                "scale=" + WIDTH + ":" + HEIGHT + ":force_original_aspect_ratio=decrease,pad=" + WIDTH + ":" + HEIGHT
                        + ":(ow-iw)/2:(oh-ih)/2:color=" + GROUND,
                out);
    }

    static List<String> videoArgv(String tool, String still, String wav, double seconds, String out) {
        List<String> a = new ArrayList<>(List.of(tool, "-hide_banner", "-nostdin", "-y"));
        if (still != null) a.addAll(List.of("-loop", "1", "-framerate", String.valueOf(FPS), "-i", still));
        else a.addAll(List.of("-f", "lavfi", "-i", "color=c=" + GROUND + ":s=" + WIDTH + "x" + HEIGHT + ":r=" + FPS));
        a.addAll(List.of("-i", wav, "-t", String.format(Locale.ROOT, "%.3f", seconds), "-shortest",
                "-c:v", "libx264", "-preset", "veryslow", "-tune", "stillimage",
                "-crf", "20", "-pix_fmt", "yuv420p", "-r", String.valueOf(FPS), "-g", String.valueOf(GOP),
                "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart",
                "-progress", "pipe:1", "-nostats", out));
        return a;
    }

    public record Run(boolean ok, List<String> tail) {}

    /** Run one ffmpeg reporting progress (0..1, about twice a second). stderr is folded into stdout. */
    public Run run(List<String> argv, double seconds, DoubleConsumer say) {
        List<String> tail = new ArrayList<>();
        try {
            Process p = new ProcessBuilder(argv).redirectErrorStream(true)
                    .redirectInput(ProcessBuilder.Redirect.from(nullDevice())).start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (line.startsWith("out_time_ms=") && seconds > 0) {
                        try {
                            double done = Long.parseLong(line.substring(12).strip()) / 1000000.0;
                            say.accept(Math.max(0.0, Math.min(1.0, done / seconds)));
                        } catch (NumberFormatException ignored) { /* N/A before the first frame */ }
                    } else if (!line.contains("=") || line.startsWith("[")) {
                        tail.add(line);
                        while (tail.size() > TAIL) tail.remove(0);
                    }
                }
            }
            return new Run(p.waitFor() == 0, tail);
        } catch (IOException e) {
            tail.add(String.valueOf(e.getMessage()));
            return new Run(false, tail);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Run(false, tail);
        }
    }

    static String whyItFailed(List<String> tail) {
        String said = String.join("\n", tail);
        if (said.contains("Unknown encoder") && said.contains("libx264"))
            return "The ffmpeg on this machine was built without libx264, so it cannot write an MP4. "
                    + "Install a full build and point Settings at it.";
        if (said.contains("not divisible by 2"))
            return "libx264 refused the picture size. That should not happen, because the still is padded to "
                    + "1280x720 first: the still pass probably failed and was skipped.";
        return "";
    }
}
