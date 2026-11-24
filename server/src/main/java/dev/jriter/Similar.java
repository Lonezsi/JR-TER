package dev.jriter;

/**
 * Python's difflib.SequenceMatcher(None, a, b).ratio() for short strings (no junk, and the
 * autojunk heuristic only applies from 200 characters, which a title never reaches).
 * Longest matching block first, earliest in a then in b on ties, then recurse either side.
 */
final class Similar {
    private Similar() {}

    static double ratio(String a, String b) {
        int total = a.length() + b.length();
        if (total == 0) return 1.0;
        return 2.0 * matches(a, 0, a.length(), b, 0, b.length()) / total;
    }

    private static int matches(String a, int alo, int ahi, String b, int blo, int bhi) {
        if (alo >= ahi || blo >= bhi) return 0;
        int bestI = alo, bestJ = blo, bestSize = 0;
        int[] prev = new int[bhi - blo + 1];
        for (int i = alo; i < ahi; i++) {
            int[] cur = new int[bhi - blo + 1];
            for (int j = blo; j < bhi; j++) {
                if (a.charAt(i) == b.charAt(j)) {
                    int k = prev[j - blo] + 1;
                    cur[j - blo + 1] = k;
                    if (k > bestSize) { bestI = i - k + 1; bestJ = j - k + 1; bestSize = k; }
                }
            }
            prev = cur; // cur[j - blo + 1] holds the run ending at j, so prev[j - blo] is the diagonal
        }
        if (bestSize == 0) return 0;
        return bestSize + matches(a, alo, bestI, b, blo, bestJ)
                + matches(a, bestI + bestSize, ahi, b, bestJ + bestSize, bhi);
    }
}
