"""The search language: what you can type into any search box.

Plain words find things, the way they always did. On top of that:

  "two words"        the words together, in that order
  -word              not this
  is:song            only songs (also album, playlist, render, lyric, artwork)
  album:"First Light"  songs on that album (part of the name is enough)
  has:words          songs with lyrics (also renders, art, notes)
  renders:>3         songs with more than three renders (also <, >=, <=, =)
  length:<3:30       the current render is shorter than 3:30 (seconds or m:ss)
  touched:<7d        changed in the last seven days (d, w, m for months, y)
  made:>2026-01      started after January 2026 (a date, or a month)

Anything that isn't one of those keys is read as plain words, so a lyric with a colon in
it is still found. The same language is implemented in ui/src/lib/query.ts for the guest
library in the browser; the two are kept in step by tests/test_query.py.

  parse(text)            -> Query
  Query.text             the plain words and phrases, for the modules' own search
  Query.allows(kind, hit, facts) -> bool   whether a hit survives the filters
"""
import re
import time

KINDS = {"song", "album", "playlist", "render", "lyric", "artwork"}
#: Kind words people type, and the kind a search group calls itself.
KIND_ALIASES = {"songs": "song", "albums": "album", "playlists": "playlist", "renders": "render",
                "words": "lyric", "lyrics": "lyric", "art": "artwork", "pictures": "artwork"}
KEYS = {"is", "album", "has", "renders", "length", "touched", "made"}

TOKEN = re.compile(r'(-?)(?:(\w+):)?("([^"]*)"|\S+)')
CMP = re.compile(r"^(>=|<=|>|<|=)?(.+)$")


class Query:
    def __init__(self):
        self.words = []       # plain words and phrases, all must be in the hit
        self.nots = []        # words that must not be
        self.kinds = set()    # is:
        self.filters = []     # (key, op, value, negated)

    @property
    def text(self):
        """What the modules' own text search gets: the words, the longest first, since a
        module searches one term. The rest are checked against the hit afterwards."""
        return max(self.words, key=len) if self.words else ""

    @property
    def narrowed(self):
        return bool(self.kinds or self.filters or self.nots or len(self.words) > 1)

    def allows(self, kind, hit, facts=None):
        """Whether one hit passes. `facts` is what a song hit needs looked up (albums,
        has words, has art); it is only asked for when a filter needs it."""
        kind = KIND_ALIASES.get(kind, kind)
        if self.kinds and kind not in self.kinds:
            return False
        hay = " ".join(str(hit.get(k) or "") for k in ("title", "sub", "line", "text", "name")).casefold()
        # The module matched the longest word itself (on whatever it searches); the others
        # have to be somewhere in what the hit shows.
        rest = [w for w in self.words if w != self.text]
        if not all(w.casefold() in hay for w in rest):
            return False
        if any(n.casefold() in hay for n in self.nots):
            return False
        for key, op, value, neg in self.filters:
            ok = _check(key, op, value, kind, hit, facts)
            if ok is None:          # the filter doesn't apply to this kind: it can't match
                ok = False
            if ok == neg:
                return False
        return True


def parse(text):
    q = Query()
    for m in TOKEN.finditer((text or "").strip()):
        neg, key, raw, quoted = m.group(1) == "-", (m.group(2) or "").lower(), m.group(3), m.group(4)
        value = quoted if quoted is not None else raw
        if key and key in KEYS:
            if key == "is":
                kind = KIND_ALIASES.get(value.lower(), value.lower())
                if kind in KINDS:
                    q.kinds.add(kind)
                continue
            op, val = CMP.match(value).groups() if key not in ("album", "has") else ("=", value)
            q.filters.append((key, op or "=", val, neg))
            continue
        word = ("%s:%s" % (key, value)) if key else value
        if not word:
            continue
        (q.nots if neg else q.words).append(word)
    return q


def _num(op, have, want):
    if have is None:
        return False
    return {"=": have == want, ">": have > want, "<": have < want,
            ">=": have >= want, "<=": have <= want}[op]


def seconds(value):
    """3:30 or 210 -> 210."""
    if ":" in value:
        m, s = value.split(":", 1)
        return int(m) * 60 + float(s)
    return float(value)


def when(value, now=None):
    """7d / 2w / 3m / 1y -> a moment that long ago; 2026-01 or 2026-01-15 -> that date."""
    now = now or time.time()
    m = re.match(r"^(\d+)([dwmy])$", value)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        return now - n * {"d": 86400, "w": 7 * 86400, "m": 30 * 86400, "y": 365 * 86400}[unit]
    parts = [int(p) for p in value.split("-")]
    year, month, day = (parts + [1, 1])[:3]
    return time.mktime((year, month, day, 0, 0, 0, 0, 0, -1))


def _check(key, op, value, kind, hit, facts):
    """True, False, or None when the key says nothing about this kind of thing."""
    try:
        if key == "renders":
            if kind != "song":
                return None
            return _num(op, hit.get("version_count") or hit.get("versions") or 0, float(value))
        if key == "length":
            have = hit.get("duration")
            return None if have is None and kind not in ("song", "render") else _num(op, have, seconds(value))
        if key in ("touched", "made"):
            have = hit.get("updated_at" if key == "touched" else "created_at")
            if have is None:
                return None
            moment = when(value)
            relative = bool(re.match(r"^\d+[dwmy]$", value))
            # touched:<7d means "less than seven days ago", i.e. after that moment.
            if relative:
                op = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}.get(op, op)
            if op == "=":
                return have >= moment and have < moment + 86400 * (31 if value.count("-") == 1 else 1)
            return _num(op, have, moment)
        if key == "album":
            if kind != "song":
                return None
            albums = (facts or {}).get("albums") if facts else None
            if albums is None:
                return None
            return any(value.casefold() in a.casefold() for a in albums)
        if key == "has":
            if kind != "song":
                return None
            what = value.lower()
            if what in ("renders", "audio"):
                return bool(hit.get("version_count") or hit.get("versions"))
            if what == "notes":
                return bool((hit.get("notes") or "").strip())
            return bool((facts or {}).get("has_" + {"words": "words", "lyrics": "words", "art": "art",
                                                     "artwork": "art", "cover": "art"}.get(what, what)))
    except (ValueError, KeyError, OverflowError):
        return False
    return None


def song_facts_needed(q):
    return any(k in ("album", "has") for k, _o, _v, _n in q.filters)
