"""The words that used to be paragraphs, and have to be somewhere.

Several screens used to explain themselves in paragraphs that sat under their headings for
ever. Those explanations are worth having once and are in the way every time after, so they
were moved behind a question mark, and the rebuilt interface keeps them in notes and
disclosures instead.

The risk that creates is the reason this file exists: it is very easy for "moved out of the
way" to quietly become "deleted", and nobody would notice, because the screen looks the way
it was meant to look either way. So what is checked here is that the places the paragraphs
came from still hand some words over.

(The question-mark helper itself, the song page's two columns and the lyric deck's
backdrop-filter rule belonged to the previous interface and have no counterpart.)
"""
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = os.path.join(HERE, "ui", "src", "views")


def test_the_screens_that_lost_paragraphs_still_explain_themselves():
    """Each of these had a paragraph on screen. It has to be somewhere."""
    wanted = {
        os.path.join("inbox", "Sources.svelte"): ["reads</b> these folders and never writes",
                                                   "never show up as renders"],
        os.path.join("song", "YouTubePanel.svelte"): ["Posted it by hand? Paste the link."],
        os.path.join("song", "SoundTab.svelte"): ["Playback only. Your file never changes."],
    }
    for name, phrases in wanted.items():
        source = open(os.path.join(VIEWS, name), encoding="utf-8").read()
        for phrase in phrases:
            assert phrase in source, \
                "%s no longer says %r anywhere: the paragraph was deleted rather " \
                "than moved" % (name, phrase)
