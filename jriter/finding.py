"""Matching text the way a person means it, in one place.

Every module that can be searched needs the same three answers, and writing them seven
times would mean seven slightly different ideas of what a good hit is. Here rather than
in a module, because a module can be switched off and this has to be there for whichever
ones are left.
"""

MAX_TERM = 80
#: Below this, a text search matches nearly every sheet in the library, which is slow
#: and tells you nothing. Titles are still searched from one character.
MIN_TEXT = 2


def pattern(term):
    """A LIKE pattern that matches the term and nothing clever.

    Searching for "100%" used to return the entire library and "w_nter" used to find
    "winter": % and _ are LIKE's own wildcards and the term was dropped between two more
    of them untouched. The backslash goes first, or escaping it afterwards would undo
    the other two.
    """
    safe = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return "%" + safe + "%"


def rank(term, field):
    """How good a hit is, four down to zero. Crude on purpose.

    4 the field is the term, 3 it starts with it, 2 a word inside it starts with it,
    1 it is in there somewhere, 0 not in this field at all, which is what a hit found
    by something secondary scores. Enough to keep an exact title above a lyric that
    happens to contain the word, which is the only ordering anybody notices.
    """
    want = (term or "").casefold()
    have = (field or "").casefold()
    if not want:
        return 0
    if have == want:
        return 4
    if have.startswith(want):
        return 3
    at = have.find(want)
    if at > 0 and not have[at - 1].isalnum():
        return 2
    return 1 if at >= 0 else 0


def line_around(text, term, width=110):
    """The line the match is on, so a lyric hit shows the words rather than the file.

    A whole line rather than a window of characters, because a lyric is written in lines
    and half a line reads as damage. Only a very long line is cut, which in practice
    means prose somebody pasted in.
    """
    want = (term or "").casefold()
    for line in (text or "").splitlines():
        at = line.casefold().find(want)
        if at < 0:
            continue
        line = line.strip()
        if len(line) <= width:
            return line
        start = max(0, at - width // 3)
        cut = line[start:start + width].strip()
        return ("... " if start else "") + cut + " ..."
    return ""
