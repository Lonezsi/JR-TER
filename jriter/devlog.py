"""What changed, release by release.

The list is the release. The newest entry's version is what jriter.__version__ reports,
what the banner prints and what the rail shows, so shipping is one edit here rather than a
number bumped in one file and notes written in another. Those two drift, and the one that
gets forgotten is always the notes.

This imports nothing from the rest of JR!TER on purpose, for the same reason wire.py does
not: jriter/__init__.py reads this file to know its own version, so anything imported here
would be imported before the package has finished loading.

Every entry carries the name the project had at the time. It was called J-ong for the
first four days and the whole of the 1.x line, and a release history that quietly renames
its own past is a history you cannot use to work out what you were running.

Newest first. Keep the notes to a few plain lines. They are read in a small dialog by one
person who was in the middle of doing something else.
"""

JONG = "project JONG"
JRITER = "JR!TER"

ENTRIES = [
    {
        "version": "2.2.0",
        "date": "2026-09-06",
        "name": JRITER,
        "title": "It fetches ffmpeg itself, and the upload has been run",
        "notes": [
            "Sending a mix on a machine with no ffmpeg now fetches one: a pinned build, "
            "checked against a digest written into the source before anything is "
            "unpacked or run, on the same bar as the encode and the upload.",
            "The video step has been run for real. A ten second mix comes out as h264 "
            "yuv420p at 1280x720 with AAC at the mix's own sample rate.",
            "The upload has been run end to end against a stand in that speaks YouTube's "
            "resumable protocol, which found three real faults. Pressing Stop did not "
            "stop an upload, it let it finish and then published the song. A token that "
            "died halfway was replaced with the same dead token six times. And the note "
            "a restart would resume from always said nought.",
            "The dust and the colour fringing on the glass are settings now, nought to a "
            "hundred, and both start stronger.",
            "The dust is white, drifts a third as fast, and only shows inside the glass. "
            "A song with artwork behind it still has none at all.",
        ],
    },
    {
        "version": "2.1.0",
        "date": "2026-09-06",
        "name": JRITER,
        "title": "It sends the video itself, and the box finds everything",
        "notes": [
            "The upload page makes an MP4 out of the mix and the artwork and sends it to "
            "YouTube. It needs ffmpeg on the machine, which JR!TER does not carry and "
            "will not install: without it the page still renders the mix and hands you "
            "the file, and says so rather than showing a dead button.",
            "The search box finds everything, in categories with a rule between them: "
            "songs by any name they have ever had, the words themselves, albums, "
            "playlists, takes, renders and captions.",
            "Searching stopped being ASCII only, so a lower case accented title finds "
            "itself, and a search for 100% stopped returning the whole library.",
            "The rail and the player are glass that takes the colours apart slightly at "
            "the edges.",
            "A page with no artwork behind it has a very quiet drift of dust in it.",
        ],
    },
    {
        "version": "2.0.0",
        "date": "2026-09-06",
        "name": JRITER,
        "title": "The new name, and everything that came with it",
        "notes": [
            "project JONG is JR!TER now, and the mark is a quarter rest with an "
            "exclamation mark beside it.",
            "Your library comes with it. The database, the name at the top of the rail, "
            "the sign in cookie, the desktop agent's folders and token: all carried "
            "across on the first start, none of it retyped.",
            "The rail shows a version rather than the commit it was built from, and "
            "after an update JR!TER says what changed.",
            "Every release is written down, back to the first day, under the name the "
            "project had at the time.",
        ],
    },
    {
        "version": "1.4.0",
        "date": "2026-09-06",
        "name": JONG,
        "title": "Back leaves the words, and A and B hold their own sound",
        "notes": [
            "Back or Escape leaves a lyric edit without keeping it. Clicking away still "
            "keeps it, and clicking into a song with no words and backing out no longer "
            "leaves an empty card behind.",
            "The renders row reads left to right: what it is, the one thing the row is "
            "for, then the tools. Add to a song stopped looking like a disabled button, "
            "and the name renames instead of quietly making a second song.",
            "Choosing or editing an equaliser lands on whichever of A and B is selected, "
            "whether or not anything is playing, and the chips say which.",
        ],
    },
    {
        "version": "1.3.0",
        "date": "2026-09-05",
        "name": JONG,
        "title": "The exported file is the mix you heard",
        "notes": [
            "What comes out of the upload page is what you approved. The offline pass was "
            "building its limiter with the browser's defaults rather than the settings "
            "you listened through.",
            "Every render is looked at when it arrives, so a bounce that is silent or "
            "will not play is flagged in red before you press anything.",
            "A rough shape of the audio sits behind each render, in the list and in every "
            "menu where a render is chosen.",
            "Sorting the library sorts what plays as well. The rows came from the sorted "
            "copy and the queue from the raw one.",
        ],
    },
    {
        "version": "1.2.0",
        "date": "2026-09-04",
        "name": JONG,
        "title": "A page for sending a mix out",
        "notes": [
            "A screen of its own for sending a mix to YouTube, because it is the one "
            "thing here that leaves the building.",
            "The equaliser, the limiter and the arrangement are on that page, live, so "
            "you can move one band without going back and forth.",
            "Sign in with a short code, the way a television does, and keep more than one "
            "channel connected.",
            "It says plainly that the last step does not exist yet: YouTube takes video, "
            "and turning audio into video is still to build.",
        ],
    },
    {
        "version": "1.1.1",
        "date": "2026-09-04",
        "name": JONG,
        "title": "The things that were already wrong",
        "notes": [
            "The host stops appearing to crash. Every idle connection was parking a "
            "thread until the process died.",
            "Two uploads at once can no longer destroy each other's audio.",
            "Swiping works on a phone. Nothing had told the browser to leave sideways "
            "drags alone.",
            "The limiter can make things louder and the meters tell the truth. Existing "
            "presets get louder by the difference.",
            "Choosing artwork no longer shuffles the tiles under your finger.",
        ],
    },
    {
        "version": "1.1.0",
        "date": "2026-09-04",
        "name": JONG,
        "title": "Running orders, and an equaliser that had stopped working",
        "notes": [
            "Line up songs and loose renders in one running order and listen straight "
            "through. An album gets one automatically.",
            "The equaliser works again. It had been calling into something that went away "
            "when A and B became two chains, so every drag died on its first line.",
            "A and B are selectable, and putting a take in the other slot forks the "
            "preset, so shaping B no longer reshapes A.",
            "Renders carry the age of the project they came from, and every list can be "
            "sorted.",
        ],
    },
    {
        "version": "1.0.0",
        "date": "2026-09-03",
        "name": JONG,
        "title": "Right click anything, and glass that bends what is behind it",
        "notes": [
            "Right click anything that is a thing: songs, albums, renders, folders, lyric "
            "cards, sections, presets, artwork, and whatever is playing.",
            "Shortcuts are printed beside the entries that have them, so the menu is also "
            "where you find them out.",
            "Press play and the bar is there in a few milliseconds instead of nearly four "
            "hundred.",
            "The ground is black, and the rail, the bar and the player are glass that "
            "actually bends what scrolls behind them.",
            "Swipe sideways to open or close the rail.",
        ],
    },
    {
        "version": "0.6.1",
        "date": "2026-09-03",
        "name": JONG,
        "title": "Fewer presses, and it comes back on its own",
        "notes": [
            "Open Arrange in one press instead of three, and a fresh layout sounds exactly "
            "like the render it came from.",
            "Press ? for the keyboard shortcuts. Five of them existed with nowhere to find "
            "out.",
            "A song with nothing to play no longer shows a dead Play button.",
            "The library restarts itself, checked every three minutes by asking whether it "
            "answers rather than whether a process is alive.",
        ],
    },
    {
        "version": "0.6.0",
        "date": "2026-09-03",
        "name": JONG,
        "title": "Nearly black, lit from above, and the small things",
        "notes": [
            "The whole app is nearly black and lit from one direction, so a card reads as "
            "a card without a border.",
            "Moving between screens shows a shape rather than a blank, and keeps your "
            "place after an edit.",
            "Open a song by clicking its title. It used to be a double click, which does "
            "not exist on a phone.",
            "Typing in the search box no longer blinks the list away and back on every "
            "keystroke.",
        ],
    },
    {
        "version": "0.5.0",
        "date": "2026-09-03",
        "name": JONG,
        "title": "Arrange, and the reasons it felt slow",
        "notes": [
            "Cut four bars out of an intro, or send the chorus round twice so the words "
            "fit. The render on disk is never rewritten.",
            "The tempo and the sections are worked out for you, and it says that it "
            "guessed.",
            "Point a lyric card at a section and it lights up when that section arrives.",
            "Press play and the player is there. It used to decode forty five megabytes "
            "first, which was two and a half seconds of nothing happening.",
        ],
    },
    {
        "version": "0.4.0",
        "date": "2026-09-03",
        "name": JONG,
        "title": "The desktop side, and renders that wait to be told what they are",
        "notes": [
            "Send an audio file to the library from the right click menu in Explorer, "
            "without opening the browser.",
            "Right click an flp to render it and send it, or a folder to render every "
            "project in it.",
            "Bounce forty things and file them later. A render lands in a list, playable, "
            "keeping the name of the project it came from.",
            "The same bytes arriving twice from two places are one entry, and attaching a "
            "render to a song copies nothing.",
        ],
    },
    {
        "version": "0.3.0",
        "date": "2026-09-03",
        "name": JONG,
        "title": "The song page, read downward",
        "notes": [
            "Read a song top to bottom: what it is, then the words, then the sound, then "
            "the takes. No tabs.",
            "Click the title to rename it and click a thumbnail to make it the cover.",
            "Write lyrics in Markdown where the first line is the name, and swipe between "
            "sets of words as cards.",
            "Watch the limiter instead of reading numbers. The threshold and the ceiling "
            "are two lines you drag.",
        ],
    },
    {
        "version": "0.2.0",
        "date": "2026-09-02",
        "name": JONG,
        "title": "A door, and a machine that keeps it open",
        "notes": [
            "The library goes on the internet behind one password, with no rules about "
            "what it may be. Six wrong guesses and that address waits.",
            "Choose the first password with a code the server prints at startup, so "
            "whoever finds the address first cannot claim the library.",
            "It starts at boot on the host and answers on the tailnet and through the "
            "funnel at the same time.",
            "A fix arrives when you reload rather than the next day. Pages were being "
            "cached for twenty four hours.",
        ],
    },
    {
        "version": "0.1.0",
        "date": "2026-09-02",
        "name": JONG,
        "title": "A library where the thing you work with is a song",
        "notes": [
            "Keep every bounce of one song together and numbered, instead of a folder of "
            "files with dates in their names.",
            "Put two takes in A and B and switch mid bar, with no gap and no fade.",
            "Shape the sound with a curve rather than a bank of sliders. The file you "
            "uploaded is never touched.",
            "Keep several sets of words for one song, each with its own history.",
            "Turn a feature off by taking its name out of one list, and it leaves the "
            "interface as well as the server.",
        ],
    },
]


def parse(version):
    """A version as numbers, so two of them can be compared. None when it is not one.

    Comparing them as text is the trap: "0.10.0" sorts before "0.9.0", so the tenth
    release would quietly stop being newer than the ninth and the popup would stop
    appearing, with nothing to show for it.
    """
    parts = str(version or "").split(".")
    if not parts or len(parts) > 4:
        return None
    try:
        return tuple(int(part) for part in parts)
    except ValueError:
        return None


def latest():
    return ENTRIES[0]


def since(version):
    """Every entry newer than a version, newest first.

    A version this cannot read answers with nothing rather than with everything. Whoever
    asked is holding a value we do not understand, and handing them every release note
    there has ever been is the one outcome worth avoiding.
    """
    mark = parse(version)
    if mark is None:
        return []
    return [entry for entry in ENTRIES if (parse(entry["version"]) or ()) > mark]
