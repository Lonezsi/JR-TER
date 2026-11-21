package dev.jriter;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The search language, a port of jriter/query.py (the docstring there lists what you can type):
 * plain words, "phrases", -not, is:, album:, has:, renders:, length:, touched:, made:.
 */
final class Query {
    static final Set<String> KINDS = Set.of("song", "album", "playlist", "render", "lyric", "artwork");
    static final Map<String, String> KIND_ALIASES = Map.of("songs", "song", "albums", "album", "playlists", "playlist",
            "renders", "render", "words", "lyric", "lyrics", "lyric", "art", "artwork", "pictures", "artwork");
    static final Set<String> KEYS = Set.of("is", "album", "has", "renders", "length", "touched", "made");
    private static final Pattern TOKEN = Pattern.compile("(-?)(?:(\\w+):)?(\"([^\"]*)\"|\\S+)", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern CMP = Pattern.compile("^(>=|<=|>|<|=)?(.+)$", Pattern.DOTALL);
    private static final Pattern RELATIVE = Pattern.compile("^(\\d+)([dwmy])$");

    record Filter(String key, String op, String value, boolean negated) {}

    final List<String> words = new ArrayList<>();
    final List<String> nots = new ArrayList<>();
    final Set<String> kinds = new HashSet<>();
    final List<Filter> filters = new ArrayList<>();

    /** What the modules' own text search gets: the longest word (the first, on a tie). */
    String text() {
        String best = "";
        for (String w : words) if (w.length() > best.length()) best = w;
        return best;
    }

    boolean narrowed() { return !kinds.isEmpty() || !filters.isEmpty() || !nots.isEmpty() || words.size() > 1; }

    boolean songFactsNeeded() {
        for (Filter f : filters) if (f.key().equals("album") || f.key().equals("has")) return true;
        return false;
    }

    static String kindOf(String kind) { return KIND_ALIASES.getOrDefault(kind, kind); }

    static Query parse(String text) {
        Query q = new Query();
        Matcher m = TOKEN.matcher(text == null ? "" : text.strip());
        while (m.find()) {
            boolean neg = m.group(1).equals("-");
            String key = m.group(2) == null ? "" : m.group(2).toLowerCase();
            String value = m.group(4) != null ? m.group(4) : m.group(3);
            if (!key.isEmpty() && KEYS.contains(key)) {
                if (key.equals("is")) {
                    String kind = kindOf(value.toLowerCase());
                    if (KINDS.contains(kind)) q.kinds.add(kind);
                    continue;
                }
                String op = "=", val = value;
                if (!key.equals("album") && !key.equals("has")) {
                    Matcher c = CMP.matcher(value);
                    if (c.matches()) {
                        op = c.group(1) == null ? "=" : c.group(1);
                        val = c.group(2);
                    }
                }
                q.filters.add(new Filter(key, op, val, neg));
                continue;
            }
            String word = key.isEmpty() ? value : key + ":" + value;
            if (word.isEmpty()) continue;
            (neg ? q.nots : q.words).add(word);
        }
        return q;
    }

    private static String said(Object v) {
        if (v == null || Boolean.FALSE.equals(v) || (v instanceof Number n && n.doubleValue() == 0)) return "";
        return String.valueOf(v);
    }

    /** Whether one hit passes the filters; facts is what a song hit needs looked up. */
    boolean allows(String kind, Map<String, Object> hit, Map<String, Object> facts) {
        kind = kindOf(kind);
        if (!kinds.isEmpty() && !kinds.contains(kind)) return false;
        StringBuilder sb = new StringBuilder();
        for (String k : new String[] {"title", "sub", "line", "text", "name"}) sb.append(sb.length() > 0 ? " " : "").append(said(hit.get(k)));
        // (Python joins all five, empty ones too; the extra spaces never change a substring match.)
        String hay = Finding.fold(sb.toString());
        String own = text();
        for (String w : words) if (!w.equals(own) && !hay.contains(Finding.fold(w))) return false;
        for (String n : nots) if (hay.contains(Finding.fold(n))) return false;
        for (Filter f : filters) {
            Boolean ok = check(f.key(), f.op(), f.value(), kind, hit, facts);
            boolean res = ok != null && ok;
            if (res == f.negated()) return false;
        }
        return true;
    }

    private static boolean num(String op, Double have, double want) {
        if (have == null) return false;
        return switch (op) {
            case "=" -> have == want;
            case ">" -> have > want;
            case "<" -> have < want;
            case ">=" -> have >= want;
            default -> have <= want;
        };
    }

    static double seconds(String value) {
        int i = value.indexOf(':');
        if (i >= 0) return Integer.parseInt(value.substring(0, i).strip()) * 60 + Double.parseDouble(value.substring(i + 1).strip());
        return Double.parseDouble(value.strip());
    }

    /** 7d / 2w / 3m / 1y: that long ago; 2026-01 or 2026-01-15: that date (local midnight). */
    static double when(String value, double now) {
        Matcher m = RELATIVE.matcher(value);
        if (m.matches()) {
            long n = Long.parseLong(m.group(1));
            long unit = switch (m.group(2)) { case "d" -> 86400L; case "w" -> 7 * 86400L; case "m" -> 30 * 86400L; default -> 365 * 86400L; };
            return now - n * unit;
        }
        String[] p = value.split("-");
        int year = Integer.parseInt(p[0]), month = p.length > 1 ? Integer.parseInt(p[1]) : 1, day = p.length > 2 ? Integer.parseInt(p[2]) : 1;
        return LocalDate.of(year, month, day).atStartOfDay(ZoneId.systemDefault()).toEpochSecond();
    }

    private static Double asDouble(Object o) { return o instanceof Number n ? n.doubleValue() : null; }

    private static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof Number n) return n.doubleValue() != 0;
        if (o instanceof Boolean b) return b;
        return !String.valueOf(o).isEmpty();
    }

    /** True, False, or null when the key says nothing about this kind of thing. */
    private static Boolean check(String key, String op, String value, String kind, Map<String, Object> hit, Map<String, Object> facts) {
        try {
            switch (key) {
                case "renders": {
                    if (!kind.equals("song")) return null;
                    Object have = truthy(hit.get("version_count")) ? hit.get("version_count") : truthy(hit.get("versions")) ? hit.get("versions") : 0;
                    return num(op, asDouble(have), Double.parseDouble(value.strip()));
                }
                case "length": {
                    Double have = asDouble(hit.get("duration"));
                    if (have == null && !kind.equals("song") && !kind.equals("render")) return null;
                    return num(op, have, seconds(value));
                }
                case "touched":
                case "made": {
                    Double have = asDouble(hit.get(key.equals("touched") ? "updated_at" : "created_at"));
                    if (have == null) return null;
                    double moment = when(value, System.currentTimeMillis() / 1000.0);
                    if (RELATIVE.matcher(value).matches())
                        op = switch (op) { case "<" -> ">"; case ">" -> "<"; case "<=" -> ">="; case ">=" -> "<="; default -> op; };
                    if (op.equals("=")) {
                        int dashes = value.length() - value.replace("-", "").length();
                        return have >= moment && have < moment + 86400 * (dashes == 1 ? 31 : 1);
                    }
                    return num(op, have, moment);
                }
                case "album": {
                    if (!kind.equals("song")) return null;
                    if (facts == null || facts.isEmpty()) return null;
                    @SuppressWarnings("unchecked")
                    List<String> albums = (List<String>) facts.get("albums");
                    if (albums == null) return null;
                    for (String a : albums) if (Finding.fold(a).contains(Finding.fold(value))) return true;
                    return false;
                }
                case "has": {
                    if (!kind.equals("song")) return null;
                    String what = value.toLowerCase();
                    if (what.equals("renders") || what.equals("audio")) return truthy(hit.get("version_count")) || truthy(hit.get("versions"));
                    if (what.equals("notes")) return !said(hit.get("notes")).strip().isEmpty();
                    String mapped = switch (what) { case "words", "lyrics" -> "words"; case "art", "artwork", "cover" -> "art"; default -> what; };
                    return facts != null && truthy(facts.get("has_" + mapped));
                }
                default:
                    return null;
            }
        } catch (RuntimeException e) {
            return false;
        }
    }
}
