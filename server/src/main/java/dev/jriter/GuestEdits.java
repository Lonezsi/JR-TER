package dev.jriter;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What a guest changed on somebody's song, and how to put it back: the snapshot, difference,
 * merge and put-back of jriter/modules/sharing.py. The stored "before" has the same JSON shape
 * ({"rows": {table: [row]}, "made": {table: [key]}, "revisions": [lo, hi]}) so Python and
 * Spring can undo each other's records.
 */
final class GuestEdits {
    private GuestEdits() {}

    /** What a song is: table, and how its rows belong to the song. */
    static final String[][] SONG_TABLES = {
        {"songs", "id = ?"},
        {"lyric_sheets", "song_id = ?"},
        {"sound_presets", "song_id = ?"},
        {"artwork", "song_id = ?"},
        {"versions", "song_id = ?"},
        {"arrangements", "song_id = ?"},
    };

    /** Saves in a row from one person closer together than this (seconds) are one change. */
    static final double SITTING = 120;

    static String key(String table) { return table.equals("arrangements") ? "song_id" : "id"; }

    static long num(Object o) { return o == null ? 0 : ((Number) o).longValue(); }

    static Map<String, Object> snapshot(Library.Db db, long songId) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String[] t : SONG_TABLES)
            if (db.tableExists(t[0])) out.put(t[0], db.query("SELECT * FROM " + t[0] + " WHERE " + t[1], songId));
        if (db.tableExists("lyric_revisions")) {
            Map<String, Object> top = db.one("SELECT MAX(r.id) AS m FROM lyric_revisions r JOIN lyric_sheets s "
                    + "ON s.id = r.sheet_id WHERE s.song_id = ?", songId);
            out.put("lyric_revisions_max", top == null ? 0L : num(top.get("m")));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> difference(Map<String, Object> before, Map<String, Object> after) {
        Map<String, List<Object>> rows = new LinkedHashMap<>();
        Map<String, List<Object>> made = new LinkedHashMap<>();
        for (String[] t : SONG_TABLES) {
            String table = t[0];
            if (!after.containsKey(table)) continue;
            String key = key(table);
            Map<Long, Map<String, Object>> was = new LinkedHashMap<>();
            for (Map<String, Object> r : (List<Map<String, Object>>) before.getOrDefault(table, List.of()))
                was.put(num(r.get(key)), r);
            for (Map<String, Object> row : (List<Map<String, Object>>) after.get(table)) {
                Map<String, Object> old = was.get(num(row.get(key)));
                if (old == null) made.computeIfAbsent(table, k -> new ArrayList<>()).add(num(row.get(key)));
                else if (!old.equals(row)) rows.computeIfAbsent(table, k -> new ArrayList<>()).add(old);
            }
        }
        long lo = num(before.get("lyric_revisions_max")), hi = num(after.get("lyric_revisions_max"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("made", made);
        out.put("revisions", hi > lo ? List.of(lo, hi) : List.of());
        return out;
    }

    static boolean empty(Map<String, Object> touched) {
        return ((Map<?, ?>) touched.get("rows")).isEmpty() && ((Map<?, ?>) touched.get("made")).isEmpty()
                && ((List<?>) touched.get("revisions")).isEmpty();
    }

    /** One sitting's worth of saves as one change: the earliest before, everything made. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> merge(Map<String, Object> first, Map<String, Object> then) {
        Map<String, List<Object>> fRows = (Map<String, List<Object>>) first.computeIfAbsent("rows", k -> new LinkedHashMap<>());
        Map<String, List<Object>> fMade = (Map<String, List<Object>>) first.computeIfAbsent("made", k -> new LinkedHashMap<>());
        for (Map.Entry<String, List<Object>> e : ((Map<String, List<Object>>) then.get("rows")).entrySet()) {
            String table = e.getKey();
            String key = key(table);
            Set<Long> have = new HashSet<>();
            for (Object r : fRows.getOrDefault(table, List.of())) have.add(num(((Map<String, Object>) r).get(key)));
            Set<Long> madeSet = new HashSet<>();
            for (Object k : fMade.getOrDefault(table, List.of())) madeSet.add(num(k));
            for (Object r : e.getValue()) {
                long k = num(((Map<String, Object>) r).get(key));
                if (!have.contains(k) && !madeSet.contains(k)) fRows.computeIfAbsent(table, x -> new ArrayList<>()).add(r);
            }
        }
        for (Map.Entry<String, List<Object>> e : ((Map<String, List<Object>>) then.get("made")).entrySet()) {
            List<Object> into = fMade.computeIfAbsent(e.getKey(), k -> new ArrayList<>());
            Set<Long> have = new HashSet<>();
            for (Object k : into) have.add(num(k));
            for (Object k : e.getValue()) if (!have.contains(num(k))) into.add(k);
        }
        List<Object> thenRev = (List<Object>) then.get("revisions");
        if (!thenRev.isEmpty()) {
            List<Object> firstRev = (List<Object>) first.get("revisions");
            if (firstRev != null && !firstRev.isEmpty()) first.put("revisions", List.of(num(firstRev.get(0)), num(thenRev.get(1))));
            else first.put("revisions", thenRev);
        }
        return first;
    }

    /** Undo one change: its rows back as they were, its new rows and words taken away. */
    @SuppressWarnings("unchecked")
    static void putBack(Library.Db db, long songId, Map<String, Object> change) {
        Set<String> allowed = new HashSet<>();
        for (String[] t : SONG_TABLES) allowed.add(t[0]);
        Object rowsObj = change.get("rows");
        if (rowsObj instanceof Map<?, ?> rows)
            for (Map.Entry<String, Object> e : ((Map<String, Object>) rows).entrySet()) {
                String table = e.getKey();
                if (!allowed.contains(table) || !db.tableExists(table)) continue;
                String key = key(table);
                List<String> real = db.columns(table);
                for (Object o : (List<Object>) e.getValue()) {
                    Map<String, Object> row = (Map<String, Object>) o;
                    List<String> cols = new ArrayList<>();
                    for (String c : row.keySet()) if (!c.equals(key) && real.contains(c)) cols.add(c);
                    if (cols.isEmpty() || db.one("SELECT 1 FROM " + table + " WHERE " + key + " = ?", row.get(key)) == null) continue;
                    StringBuilder set = new StringBuilder();
                    List<Object> args = new ArrayList<>();
                    for (String c : cols) {
                        if (set.length() > 0) set.append(", ");
                        set.append(c).append(" = ?");
                        args.add(row.get(c));
                    }
                    args.add(row.get(key));
                    db.run("UPDATE " + table + " SET " + set + " WHERE " + key + " = ?", args.toArray());
                }
            }
        Object madeObj = change.get("made");
        if (madeObj instanceof Map<?, ?> made)
            for (Map.Entry<String, Object> e : ((Map<String, Object>) made).entrySet()) {
                String table = e.getKey();
                if (!allowed.contains(table) || !db.tableExists(table)) continue;
                for (Object k : (List<Object>) e.getValue())
                    db.run("DELETE FROM " + table + " WHERE " + key(table) + " = ?", num(k));
            }
        Object spanObj = change.get("revisions");
        if (spanObj instanceof List<?> span && !span.isEmpty() && db.tableExists("lyric_revisions"))
            db.run("DELETE FROM lyric_revisions WHERE id > ? AND id <= ? AND sheet_id IN "
                    + "(SELECT id FROM lyric_sheets WHERE song_id = ?)", num(span.get(0)), num(span.get(1)), songId);
    }
}
