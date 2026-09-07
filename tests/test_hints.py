"""The question marks, and the words that moved behind them.

Several screens used to explain themselves in paragraphs that sat under their headings for
ever. Those explanations are worth having once and are in the way every time after, so they
are behind a mark now.

The risk that creates is the reason this file exists: it is very easy for "moved behind a
question mark" to quietly become "deleted". A hint with no text is a mark that opens
nothing, and nobody would notice, because the screen looks the way it was meant to look
either way. So what is checked here is that every hint still carries words, and that the
places the paragraphs came from still hand some over.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(HERE, "web", "js")


def _sources():
    return {name: open(os.path.join(JS, name), encoding="utf-8").read()
            for name in sorted(os.listdir(JS)) if name.endswith(".js")}


def test_the_hint_helper_is_there_and_is_a_button():
    source = open(os.path.join(JS, "18-hint.js"), encoding="utf-8").read()
    assert 'type="button"' in source, \
        "a bare button inside a form submits it, and hints live inside forms"
    assert 'aria-label="What is this?"' in source
    # Not a title attribute: those take a second, and a thumb cannot hover.
    assert "title=" not in source.split("function mark")[1].split("}")[0]


def test_every_hint_is_given_something_to_say():
    """A hint with nothing behind it is a mark that opens nothing.

    Nobody would notice from the screen, because the screen looks the same either way,
    which is exactly why it is worth a test.
    """
    empty = []
    for name, source in _sources().items():
        if name == "18-hint.js":
            continue
        for at in [m.start() for m in re.finditer(r"J\.hint\(", source)]:
            # Whatever is between the bracket and the end of that call's first argument.
            after = source[at + len("J.hint("):at + 400].lstrip()
            if not after.startswith('"') and not after.startswith("'") \
                    and not after.startswith("`"):
                empty.append("%s at %d" % (name, at))
    assert not empty, "these hints are given no text: %s" % empty


def test_the_screens_that_lost_paragraphs_still_explain_themselves():
    """Each of these had a paragraph on screen. It has to be somewhere."""
    sources = _sources()
    wanted = {
        "74-view-sync.js": ["reads these and never", "never offered as renders"],
        "67-panel-youtube.js": ["turns it into a video"],
        "68-panel-playlists.js": ["loose renders together"],
        "66-panel-sound.js": ["equaliser and the limiter together"],
    }
    for name, phrases in wanted.items():
        source = sources[name]
        for phrase in phrases:
            assert phrase in source, \
                "%s no longer says %r anywhere: the paragraph was deleted rather " \
                "than moved" % (name, phrase)


def test_the_folders_screen_no_longer_says_it_twice():
    """It used to explain each kind in a paragraph and then again in the empty state
    underneath, which is most of what made that page feel long."""
    source = open(os.path.join(JS, "74-view-sync.js"), encoding="utf-8").read()
    body = source[source.index("function draw()"):]
    body = body[:body.index("${summary ?")]
    # The long form is in a hint now, not sitting in a paragraph of its own.
    assert '<p class="faint" style="margin-top:0">' not in body, \
        "the folders screen still carries a standing paragraph"
    assert body.count("J.hint(") == 2, "each kind of folder should explain itself once"


def test_the_song_page_is_two_columns():
    source = open(os.path.join(JS, "60-view-song.js"), encoding="utf-8").read()
    assert 'class="song-grid"' in source
    assert 'class="song-main"' in source and 'class="song-side"' in source
    # The things you work in on one side, the facts on the other.
    main = source[source.index('class="song-main"'):source.index('class="song-side"')]
    assert "lyricsBlock" in main and "soundBlock" in main
    side = source[source.index('class="song-side"'):]
    for block in ("artworkBlock", "songPlaylistsBlock", "youtubeBlock"):
        assert block in side[:2000], "%s should be in the narrow column" % block


def test_nothing_glassy_wraps_the_lyric_deck():
    """The constraint that is easy to break and impossible to see in the markup.

    A backdrop-filter flattens its children whatever transform-style says. The lyric cards
    are a real 3D stack, so the column holding them must not become a pane: it would look
    fine and the cards would stop turning.
    """
    source = open(os.path.join(JS, "60-view-song.js"), encoding="utf-8").read()
    main = source[source.index('class="song-main"'):source.index('class="song-side"')]
    assert "pane" not in main, \
        "the column holding the lyric deck has been given a backdrop-filter, which " \
        "flattens the cards' 3D"

    css = open(os.path.join(HERE, "web", "css", "19-panes.css"), encoding="utf-8").read()
    # The rule, not the comment above .pane that also names it. Matching the bare selector
    # found that comment first and then read .pane's body, which is a test that fails on
    # the very thing it exists to permit.
    rule = css[css.index(".song-main {"):]
    rule = rule[:rule.index("}")]
    assert "backdrop-filter" not in rule
