"""Builds the word lists the rhyme tools read (ui/public/lexicon/*.txt) from Hunspell
dictionaries.

    python tools/build_lexicon.py [DICTIONARY_DIR]

DICTIONARY_DIR holds hu_HU.dic and en_US.dic. It defaults to TeXstudio's, which ships
both. A Hunspell .dic is one stem per line with its affix flags after a slash and, in the
Hungarian one, morphology after a tab; only the stem is kept. Proper nouns (a capital
first letter), abbreviations, multi-word entries and anything with digits or apostrophes
are left out: a rhyme list is for words that go at the end of a line.

The output is one word per line, sorted, UTF-8, plus a header line naming where it came
from. Licences: the Hungarian list is Magyarispell (Németh László and others, tri-licensed
GPL/LGPL/MPL); the English one is SCOWL (Kevin Atkinson, a permissive BSD-style licence).
Both allow this; ui/public/lexicon/NOTICE.txt carries the attribution.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "ui", "public", "lexicon")
DEFAULT = r"C:\Program Files\texstudio\dictionaries"

WORD = {
    "hu": re.compile(r"^[a-záéíóöőúüű]+$"),
    "en": re.compile(r"^[a-z]+$"),
}


def words(path, lang):
    out = set()
    with io.open(path, encoding="utf-8", errors="replace") as f:
        first = True
        for line in f:
            if first:                       # the entry count
                first = False
                if line.strip().isdigit():
                    continue
            stem = line.split("\t", 1)[0].split("/", 1)[0].strip()
            if len(stem) < 2 or not WORD[lang].match(stem):
                continue
            out.add(stem)
    return sorted(out)


def hungarian_nouns(src):
    """Hungarian stems that are nouns or adjectives, for rhymes made on an ending (fában,
    ágban): a verb, an abbreviation or a name with -ban on it is not a word anybody sings.
    Each entry's number after the tab points at an AM line of the .aff, which carries the
    part of speech (po:noun, po:adj...)."""
    am = []
    with io.open(os.path.join(src, "hu_HU.aff"), encoding="utf-8", errors="replace") as f:
        seen_header = False
        for line in f:
            if line.startswith("AM "):
                if not seen_header:
                    seen_header = True          # "AM <count>"
                    continue
                am.append(line[3:].strip())
    keep = set()
    with io.open(os.path.join(src, "hu_HU.dic"), encoding="utf-8", errors="replace") as f:
        next(f, None)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            stem = parts[0].split("/", 1)[0].strip()
            if len(parts) < 2 or not parts[1].strip().isdigit() or not WORD["hu"].match(stem) or len(stem) < 2:
                continue
            k = int(parts[1].strip()) - 1
            if 0 <= k < len(am) and re.search(r"po:(noun|adj)(\s|$)", am[k]):
                keep.add(stem)
    return sorted(keep)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    os.makedirs(OUT, exist_ok=True)
    for lang, name in (("hu", "hu_HU.dic"), ("en", "en_US.dic")):
        listed = words(os.path.join(src, name), lang)
        with io.open(os.path.join(OUT, lang + ".txt"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(listed) + "\n")
        print(lang, len(listed), "words")
    nouns = hungarian_nouns(src)
    with io.open(os.path.join(OUT, "hu-nouns.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(nouns) + "\n")
    print("hu nouns and adjectives", len(nouns))


if __name__ == "__main__":
    main()
