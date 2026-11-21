package dev.jriter;

import java.util.Locale;

/** Matching text the way a person means it: a port of jriter/finding.py. */
final class Finding {
    private Finding() {}

    static final int MAX_TERM = 80;
    /** Below this a text search matches nearly every sheet, so it is not run. */
    static final int MIN_TEXT = 2;

    /** Python's str.casefold, near enough (the same folding the SQL fold() does). */
    static String fold(String s) { return s == null ? "" : s.toUpperCase(Locale.ROOT).toLowerCase(Locale.ROOT); }

    /** A LIKE pattern matching the term and nothing clever (the backslash goes first). */
    static String pattern(String term) {
        String safe = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + safe + "%";
    }

    /** How good a hit is, four down to zero. */
    static int rank(String term, String field) {
        String want = fold(term), have = fold(field);
        if (want.isEmpty()) return 0;
        if (have.equals(want)) return 4;
        if (have.startsWith(want)) return 3;
        int at = have.indexOf(want);
        if (at > 0 && !Character.isLetterOrDigit(have.charAt(at - 1))) return 2;
        return at >= 0 ? 1 : 0;
    }

    /** The line the match is on, a very long one cut around the match. */
    static String lineAround(String text, String term) {
        int width = 110;
        String want = fold(term);
        for (String line : (text == null ? "" : text).split("\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085  ]", -1)) {
            int at = fold(line).indexOf(want);
            if (at < 0) continue;
            line = line.strip();
            if (line.length() <= width) return line;
            int start = Math.max(0, at - width / 3);
            String cut = line.substring(Math.min(start, line.length()), Math.min(start + width, line.length())).strip();
            return (start > 0 ? "... " : "") + cut + " ...";
        }
        return "";
    }
}
