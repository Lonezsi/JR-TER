# JR!TER

*please post for the world to see*

A personal, self-hosted music workspace where the thing you work with is a **song**, not a file.

A song holds every render you have made of it, the lyrics and their alternatives, artwork,
album membership, and its own playback settings. The website is where you browse, listen,
compare mixes and organise. The desktop agent watches the folder your exports land in and
puts new renders where they belong.

The server is standard library Python with no dependencies. The interface is Svelte 5 and
TypeScript in `ui/`, built once into `web/` (`cd ui && npm run ship`); the server only ever
serves the built files, so running JR!TER needs Python and nothing else.

## Install it

On Windows, one line in PowerShell. It finds or installs Python, fetches the code, puts
JR!TER on your desktop and in the Start menu, sets it to start when you log on, and adds the
right click menu to your folders.

```powershell
irm https://raw.githubusercontent.com/Lonezsi/JR-TER/main/install.ps1 | iex
```

Nothing there needs an administrator, and running the same line again updates in place
without touching your `data` directory. To take the wiring back off:

```powershell
python client\jriter_client.py uninstall
```

You end up with two shortcuts, because a machine can be two different things:

| | what it is |
|---|---|
| **JR!TER** | the desktop app. Watches your render folders, sends what lands in them, and is the icon on your taskbar. Starts at logon. |
| **JR!TER Server** | the library itself. One machine somewhere runs this; the app's **Open library** goes to wherever that is. |

If you would rather do it yourself, or you are not on Windows, there is nothing to install:

```
python server.py --open
```

Then open http://127.0.0.1:7900.

On a Mac or Linux, one line too (it asks, optionally, whether to open it to your home
network and whether to set up Tailscale; neither is needed):

```
curl -fsSL https://raw.githubusercontent.com/Lonezsi/JR-TER/main/install.sh | bash
```

### Right click menu

On a **folder**:

* **Upload every sound file in here** sends what is in there now, once
* **Render every FL project in here** renders each `.flp` and sends the results
* **Watch this folder with JR!TER** is the standing arrangement, for the folder your
  bounces always land in

On an **audio file**: *Upload to JR!TER*. On an **`.flp`**: *Render and send to JR!TER*.

### Always on, reachable from your phone

For the machine that holds the library, so it serves with nobody logged in and gets a public
HTTPS address through Tailscale Funnel:

```powershell
powershell -ExecutionPolicy Bypass -File hostsetup\Install-JriterHost.ps1
```

---

## Several people, one server

Your friends can have accounts here. Each one gets a library of its own: separate database,
separate audio, separate settings. Nothing in the app shows one person another's songs,
renders, samples or lyrics, and that is structural rather than a permission check, because
each library is a different file on disk.

Signing up needs an invite. Make one in **Settings → People**, send them the code, and they
choose their own handle and password. Without that, an open signup form on a public address
is an offer to whoever finds it.

**Sharing one song.** On a song's title menu, *Share with somebody*. They can play it, read
the words, and work on the equaliser and the limiter. Anything they save becomes their own
copy in their own library; yours is untouched. Give them a name on the share and their edits
are labelled with it, so `Wide master` comes back as `Wide master, edited by Jozsef`. They
cannot see your other songs, your samples or your renders, and cannot post anything. Take it
back whenever you like: what they made stays theirs, because it was always in their library.

Your friends can run the desktop agent against their own library too. It signs in with a
handle:

```bash
python client\jriter_client.py login --handle jozsef
```

Leave `--handle` off if the library is yours: an empty handle means the owner, which is what
it has always meant.

One thing worth being plain about: this is a wall inside the application, not a wall against
whoever runs the machine. If it is your computer, you have everybody's files, the same as you
would with any other program's data. The privacy notice says so too.

---

## What each part is for

Features are easy to list and harder to place. This is the job each one does, written as
the moment you are actually in when you want it.

**You just bounced a mix and want to know if it is better than the last one.**
Drop it on the song. It becomes v14 and v13 stays exactly where it was. On the song's
**Sound** tab put them in A and B and press `X`: both play at once with one silent, so the
switch lands on the same bar of the other mix with no gap and no fade. Once B holds
something, the player says which one you're hearing.

**You bounced forty things and have no idea what half of them are.**
They go in the **Inbox** and wait. A render arrives knowing the name of the project it
came out of and nothing else; which song it belongs to is a question for later. Play one
from the list before deciding. Nothing is filed until you file it.

**The exports folder is where the renders are and you do not want to carry them.**
Point **Folders** (in the Inbox) at it. JR!TER notices new bounces arriving, reads that
folder and never writes to it, and imports nothing until you say so.

**The mix sounds right on headphones and wrong in the car.**
**Sound** is a chain of effects you build yourself (EQ, compressor, drive, delay, reverb,
width, gain, limiter), each with its own presets, and a preset per song for each place you
check mixes. It exists only while you listen: nothing is ever written into the file.

**The words do not fit the section.**
Open **Arrange**. JR!TER listens to the render, works out the tempo and splits it into
sections, laid out as it already is. Drag an edge to take four bars out of the intro;
double click a section to send the chorus round twice. It answers "what if that part were
shorter", and the render on disk is never rewritten.

**You're writing and want the words to land.**
The **Words** tab marks the vowels of every line, gives each line its rhyme letter, and
checks each verse against the shape it's closest to (ABAB, AABB and the rest), in
Hungarian and English, even mixed in one line. Press the rhyme button (or `Alt R`) on a
line and it works out what that line should rhyme with, lights that word up and lists
rhymes for it; click another word to rhyme with that one instead. A line ending in `//`
is left alone: no warnings. Text in `()`, `<>`, `{}` and `[]` is an aside, drawn dimmer
and left out of the rhyme. All of it runs in the browser, no AI, nothing sent anywhere.

**You are rewriting a verse and do not want to lose the one you have.**
A song holds several sets of words at once, and each keeps its own history. The first line
is the title, so there is nothing to name.

**You have a hundred songs and a shelf of grey rectangles.**
Give them **artwork**. The library is the place you scan quickly, and the picture is what
you scan by. Pin the ones you're working on and they sit at the top of the sidebar.

**The face used for titles is not the one you want.**
Upload your own in **Settings › Appearance**. JR!TER ships Orbitron because a licensed font
cannot live in a public repository; yours stays in your own data directory.

---

## What it does

**Renders.** Every render of a song is kept and numbered. Upload one and it becomes v14;
the ones before it stay where they were. Storage is content addressed, so the same bytes
arriving twice are one file, and attaching an inbox render to a song copies nothing.

**A/B.** Two slots on the Sound tab, each a render and a sound. Both decks play at once
with one silent, so the switch is a gain change on the next audio block. `X` swaps.

**Sound.** A rack of effects per preset, in the order you drag them into. The EQ is a real
one: double click to add a band, drag it, wheel for Q. The curve is the actual response of
the filter chain, with a spectrum behind it. Playback only; the file never changes.

**Words.** Several sets per song, each with history. Rhyme marks, letters, verse shapes and
warnings, a rhyme finder over shipped Hungarian and English word lists (`ui/public/lexicon`,
built by `tools/build_lexicon.py`), all local.

**Arrange.** One track, every edge on a beat, guessed from the render and then yours.

**Vocals.** Record over the song (the mic and the output are picked next to Record), or
upload takes. Takes are vocals; renders are mixes.

**Albums and playlists.** An album is a cover, a year and an order; a song can sit on
several. A playlist can hold songs and loose renders together.

**Release.** Render the song through its sound and arrangement and upload it to YouTube
(the account is connected once, in Settings), or record a link you posted by hand.

**The grave.** Deleting has Undo, and what you delete waits in the Grave for 30 days:
bring it back whole (a song returns with its renders, words, artwork and its places on
albums and in playlists), or let it go. Its audio stays until it leaves the grave for good.

**Accounts.** Without one, JR!TER is a guest library kept in your browser, everything
included. On a machine that also runs Foyer, a Foyer handle and password work on the sign
in page, and `data/foyer-owner.txt` (one line, a Foyer handle) names which Foyer account
is the owner.

**Light and dark.** Settings, Appearance, Theme: the glass at night, a soft neumorphic
look by day.

**DAW.** `/daw.html` is a MIDI player and a very simple piano-roll editor: open a `.mid`
(or drop one on the page), add notes by clicking, drag to move, drag the right edge to
resize, right-click to delete, and play it with built-in browser instruments (piano, pad,
bass, pluck, drums). Space plays, `L` loops, `j`/`k` change track, `N` adds one, `Ctrl+Z`
undoes. Save as `.mid` or as a plain-text `.json` that explains itself. It is plain ES
modules in `web/daw/` (no build step); it becomes a song tab once the Svelte `ui/` is here.

**Phone.** The sidebar follows your thumb from the edge, Back closes whatever is on top,
and the player grows out of the mini bar.

---

## The desktop agent

> **New:** the PC side is being replaced by a desktop app with no Python in it, in desktop/
> (Java 21, built by desktop\build.ps1 into JRITER.exe for the tray and jriter-cli.exe for the
> commands, which have the same names as below: jriter-cli server/login/add/scan/push/watch/render/shell).
> It reads the same client.json. See desktop/README.md. The Python client below stays as the way
> back until the app has had real use.
> `jriter-cli plugins X.flp` lists the VSTs a project uses; the plan for the rest is in docs/VST.md.

```
cd client
python jriter_client.py install --server http://127.0.0.1:7900 --folder "C:\Users\you\Music\Renders"
python jriter_client.py scan      # what is new, without sending anything
python jriter_client.py push      # send it
python jriter_client.py watch     # keep doing that
```

It reads those folders and never writes to them. When it finds something new it asks the
library which song it looks like a new render of, and offers that rather than making a
second song every time you export.

### On "only send the changes"

Every file is hashed locally and the server is asked which of those hashes it already
holds. Anything it has is skipped without a byte leaving the machine, so a folder of two
hundred unchanged renders costs one small request.

What JR!TER deliberately does **not** do is store binary deltas between renders. Two MP3s
of the same song share essentially no bytes, because re-encoding rewrites the whole
stream, so a delta would save close to nothing while making every read depend on a chain
of patches. Deduplication by content is the honest version of the same idea, and it is
what the storage does: identical bytes are stored once, whatever they are called and
whichever song they belong to.

---

## On your machine

```
cd client
python jriter_client.py install --server http://127.0.0.1:7900 --folder "C:\Users\you\Music\Renders"
```

That does three things, none of which needs an administrator:

- the folder watcher runs at logon
- a **right click menu** appears on audio files, on `.flp` projects, and on folders
- a daily task pulls a newer JR!TER from GitHub at 05:00

You can also run it without the flags if you have already set the server and folders:

```
cd client
python jriter_client.py install
```

The right click entries are:

| where | what it says |
|---|---|
| an mp3, wav, flac, m4a, ogg | **Upload to JR!TER** |
| an `.flp` | **Render and send to JR!TER** |
| a folder | **Render every FL project in here** |
| a folder | **Watch this folder with JR!TER** |

All of it is written under `HKEY_CURRENT_USER`, so it belongs to you rather than the
machine, no file associations are touched (an mp3 still opens with whatever opened it
before), and `jriter_client.py shell remove` takes it away completely.

---

## Rendering FL Studio projects

```
python jriter_client.py render "C:\Users\you\Projects"
```

**FL Studio's command line render is not headless, and this does not pretend otherwise.**
FL takes a `/R` switch that renders a project, and it works, but launching it opens the
application: you see its window, it loads the project, and on some versions the export
dialog waits for Start to be pressed. Image-Line's own forum has people asking about
exactly this and not getting a better answer. So JR!TER tells you that before it starts
rather than leaving you to discover it.

What it does do reliably: it finds FL for you, copies each project somewhere without
spaces first (FL's command line has a long history of mishandling quoted paths), waits
for the audio to appear and stop growing, finds the file even when FL writes it under a
different name, skips FL's own `Backup` folders, and hands each finished render to the
library with the usual "is this a new render of X?" question.

Waiting on the file rather than on FL's window title is deliberate. Title watching is
what most scripts do and it breaks on a different language, a different version, and
anywhere the window is not visible. A file that has stopped growing is the same fact
everywhere.

If FL is somewhere unusual:

```
python jriter_client.py flpath "C:\Program Files\Image-Line\FL Studio 2024\FL64.exe"
```

---

## Updating itself

Settings has a **Check for updates** button. It compares this checkout against the branch
on GitHub and, if it is behind, offers a fast forward pull. It refuses when there are
uncommitted changes rather than throwing them away, and it says plainly when it could not
reach GitHub instead of reporting that you are up to date.

Python has already imported the running code, so after an update that touches `.py` files
the app tells you to restart. It does not pretend a reload was enough.

The client has the same thing: `python jriter_client.py update`.

---

## The password

One password for the whole library, and **no rules about what it may be**. Length limits
and "must contain a symbol" mostly push people towards one bad password reused everywhere,
and this library has one user who already knows what it is worth.

What guards it instead is a limit on guessing: six wrong answers from an address and that
address waits, for 30 seconds, then 2 minutes, 10, 30, an hour. A limit like that costs
the person who knows the password nothing and makes even a very short one impractical to
brute force. Each address is counted separately, so somebody else guessing badly cannot
lock you out of your own library.

The password is never stored. It goes through scrypt, which is deliberately slow and
memory hungry, and only the result is kept, salted per library.

**The first password.** A fresh library has none, and the server prints a one time setup
code at startup. That code has to be presented to choose the first password, which is what
stops the first stranger who finds a public JR!TER from choosing it for you. The code stops
existing the moment a password is set.

Changing the password signs every device out. Settings has both buttons.

To run with no door at all, which is what you want on a machine only you can reach, take
`"auth"` out of `MODULES`.

---

## Everything is a module

Each feature is a file in `jriter/modules/` listed in `jriter/config.py`:

```python
MODULES = [
    "core", "auth", "appearance", "songs", "versions", "artwork",
    "lyrics", "albums", "sound", "sync", "updater",
]
```

A module owns its own tables and its own routes. Take a name out of that list and the
feature is gone: its tables stop being created, its endpoints stop existing, and the
**web interface stops drawing it**, because the front end asks `/api/state` what is
switched on rather than assuming. No dead buttons that return 404.

A module that fails to load is named out loud at startup and in the interface, and the
rest of the library still opens.

The browser side works the same way. `web/css/*.css` and `web/js/*.js` are concatenated in
filename order into `/jriter.css` and `/jriter.js`, so a feature is a file, the numeric prefix
is the load order, and deleting the file removes the feature. There is no bundler.

To add a feature, write `jriter/modules/yours.py` with `SCHEMA` and `ROUTES()`, add a
`web/js/NN-view-yours.js` that registers `J.views.yours`, and put the name in the list.

---

## Where things live

```
server.py              start it
jriter/
  config.py            paths, the module list, settings defaults
  db.py                sqlite, one connection per thread
  blobs.py             content addressed storage
  http.py              routing, static files, byte ranges for audio
  registry.py          loads whichever modules are switched on
  devlog.py            loads the release notes (devlog.json) and compares versions
  modules/             one file per feature
ui/                    the interface: Svelte 5 + TypeScript, built with Vite
  src/shell/           sidebar, phone drawer, player, search, Now Playing
  src/views/           one folder or file per screen
  src/lib/             player and audio engine, rhyme engine (lib/lyrics), glass
  src/ui/              shared controls (Dropdown, Segmented, Slider, menus, sheets)
  public/lexicon/      the word lists the rhyme finder uses
web/                   what `npm run ship` builds; the server serves this
client/                the desktop agent
tools/                 build_lexicon.py and other one-off builders
tests/                 python -m pytest -q; node --test tests/daw/*.test.mjs
data/                  your library. Not in git.
```

`data/` holds the database and every file you have uploaded, so a backup is one copy of
one directory.

---

## Keyboard

| | |
|---|---|
| `Ctrl` `K` | search, or jump to anything (`>` for commands) |
| `Space` | play or pause |
| `X` | swap A and B |
| `Shift` `←` `→` | previous or next song |
| `←` `→`, `0`-`9` | move through the song |
| `Q` | the queue |
| `R` | repeat |
| `N` | new song |
| `G` then `L` `I` `S` `P` | go to Library, Inbox, Settings, the song playing |
| `Alt` `1`-`6` | song tabs |
| `Alt` `R` | rhymes for this line (in the words) |
| `F2` | rename |
| `[` | show or hide the sidebar |
| `?` | every shortcut |
| `Esc` | close the top thing |

None of it shows on a phone.

---

## Settings

`JRITER_DATA` moves the library. `JRITER_PORT` and `JRITER_HOST` move the server.
`JRITER_REPO` and `JRITER_BRANCH` point the updater somewhere else. With no `JRITER_BRANCH`, a checkout that is on a `live-*` branch updates from that branch.

The accent colour and the library name are in Settings. Everything in the interface
derives from the one accent value.
