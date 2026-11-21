package dev.jriter.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.LinkedHashMap;
import java.util.Map;

/** Putting files into the library. */
public final class Send {
    public interface Asker { boolean ask(String question); }

    /** A fresh render goes to the Renders list, never straight onto a song. True if it was new there. */
    public static boolean render(Library lib, Path file, double projectAt, double renderedAt, boolean fl) {
        return render(lib, file, projectAt, renderedAt, fl, "");
    }

    /** The plugin list as an X-Plugins header value: pure-ASCII JSON, at most 6000 chars (Tomcat allows 8 KB per header). */
    public static String pluginsHeader(java.util.List<FlProject.Plugin> pl, VstFolders.Installed inst) {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        mapper.getFactory().configure(com.fasterxml.jackson.core.json.JsonWriteFeature.ESCAPE_NON_ASCII.mappedFeature(), true);
        var arr = mapper.createArrayNode();
        for (FlProject.Plugin x : pl) {
            var o = arr.addObject();
            o.put("kind", x.kind()); o.put("name", x.name()); o.put("vendor", x.vendor()); o.put("uses", x.uses());
            if (inst != null && !x.kind().equals("fl")) o.put("installed", VstFolders.has(inst, x));
        }
        try {
            String s = mapper.writeValueAsString(arr);
            while (s.length() > 6000 && arr.size() > 0) { arr.remove(arr.size() - 1); s = mapper.writeValueAsString(arr); }
            return arr.size() == 0 ? "" : s;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) { return ""; }
    }

    /** Same, with the project's plugin list (see docs/VST.md step 2); plugins may be blank. */
    public static boolean render(Library lib, Path file, double projectAt, double renderedAt, boolean fl, String plugins) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("X-Filename", file.getFileName().toString());
        h.put("X-Source-Path", file.toAbsolutePath().toString());
        if (fl) h.put("X-Origin", "fl");
        if (projectAt > 0) h.put("X-Project-At", Double.toString(projectAt));
        if (renderedAt > 0) h.put("X-Rendered-At", Double.toString(renderedAt));
        if (plugins != null && !plugins.isBlank()) h.put("X-Plugins", plugins);
        return lib.upload("/api/renders", file, h).path("added").asBoolean(false);
    }

    /** One file onto a song, asking which. Returns false if skipped. */
    public static boolean one(Library lib, Config cfg, Path file, boolean yes, Asker asker, java.util.function.Consumer<String> say) throws IOException {
        String name = file.getFileName().toString();
        String digest = Survey.digest(file);
        JsonNode held = lib.get("/api/versions/have?digest=" + digest).path("have").path(digest);
        if (!held.isMissingNode() && !held.isNull()) {
            say.accept("already here as v" + held.path("n").asText() + " of " + held.path("title").asText());
            return true;
        }
        JsonNode suggest = lib.get("/api/songs/match?name=" + Library.enc(name)).path("suggest");
        long songId = -1;
        if (suggest.isObject() && (yes || asker.ask("Is " + name + " a new render of " + suggest.path("title").asText() + "?")))
            songId = suggest.path("song_id").asLong();
        if (songId < 0) {
            String title = name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name;
            if (!(yes || cfg.autoNewSongs()) && !asker.ask("Add " + name + " as a new song called " + title + "?")) {
                say.accept("skipped");
                return false;
            }
            songId = lib.postJson("/api/songs", Map.of("title", title)).path("song").path("id").asLong();
        }
        say.accept("sending " + name);
        JsonNode r = lib.upload("/api/songs/" + songId + "/versions", file,
                Map.of("X-Filename", name, "X-Source-Path", file.toAbsolutePath().toString()));
        say.accept((r.path("duplicate").asBoolean() ? "already there" : "stored") + " as v" + r.path("version").path("n").asText());
        return true;
    }
}
