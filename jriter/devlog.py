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
        "version": "3.3.2",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "A list that unrolls, and a tag that stays put",
        "notes": [
            "The history under a set of lyrics opens downwards and the entries arrive one "
            "after another, top to bottom. Closing is the same thing backwards: the last "
            "row leaves first, the list folds up from the bottom, and only then does the "
            "panel close.",
            "The section tag sits on the floor of the lyrics card. It used to be in the "
            "flow straight after the words, so on a card with two lines in it the tag "
            "landed a third of the way down with a lot of nothing underneath, and it "
            "moved every time the words got longer.",
            "Pressing the chosen take in the compare row opens its list, anywhere on it "
            "rather than only on the little arrow. The one that is not chosen still "
            "chooses when pressed, because that is the thing it has left to do.",
        ],
    },
    {
        "version": "3.3.1",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "The glass is the glass again",
        "notes": [
            "The refraction is back. Taking it out everywhere was the wrong call: it is "
            "what this app looks like, and I removed it from the machines that can draw it "
            "in order to fix the ones that cannot. It is asked for again, inside a block "
            "gated on the engine, and the flat readable version is now what Safari and "
            "anything else that cannot refract falls back to. It has to be the engine "
            "rather than a feature test, because WebKit reports the reference supported "
            "and then never renders it.",
            "Scrolling a page while it is still loading no longer throws you back to the "
            "top. The skeleton is on screen and scrollable long before the content lands, "
            "and the jump to the top ran after it: you would open a song on a phone, start "
            "reading down, and get pulled back a second later.",
            "A dropdown's scrollbar stays inside its rounded corners. The thumb runs the "
            "whole height of the track, so on a list with just a little more than fits, "
            "its ends sat inside the curve and crossed it. The track is inset from each "
            "end by the panel's own radius now.",
        ],
    },
    {
        "version": "3.3.0",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "Glass you can read, on a browser I do not own",
        "notes": [
            "The icon is a quarter rest and an exclamation again. A rest is the "
            "instruction to play nothing and it is standing next to the loudest "
            "punctuation there is, which is the joke the whole name is built on, and an "
            "icon that is only the exclamation throws it away. Same shape as the mark in "
            "the sidebar, drawn from the same numbers, cut heavier so it survives being "
            "sixteen pixels wide in a tab.",
            "Every glass surface is readable in Safari. It was not: dialogs, dropdowns "
            "and the menu on a phone were a five per cent white film with the page's own "
            "text sharp underneath, and you had to work out which words were which. One "
            "cause for all three. The glass asked for an SVG refraction as the first item "
            "in its filter, one unsupported item invalidates the whole declaration, and "
            "WebKit accepts that reference and then never draws it, so there was no way "
            "for a stylesheet to find out. The blur is plain filter functions now, and "
            "the tint is dark enough to be a surface even with no blur at all.",
            "The colour picker in Settings works. Its handler had been wired to the "
            "folders screen, which does not have a colour picker on it, so nothing "
            "happened when you used it. The accent also previews as you choose it, the "
            "way dust and chromatic and dither already did.",
            "Leaving Settings without saving puts the room back. It used to leave the "
            "preview on: the form came back showing the saved numbers over an app wearing "
            "the unsaved ones, and the first slider you touched snapped everything at "
            "once. There is also a Back to normal button now.",
            "Repeat has three states: off, this one, and the whole list. It only ever did "
            "one song, while wearing the icon that means the whole list everywhere else, "
            "so the player read as the opposite of what it did. The one track state has a "
            "1 in the loop.",
            "Anything tinted with the accent follows the accent. Ten rules and two "
            "canvas fills had the green written out as numbers, so a pink accent gave you "
            "a pink button with a green halo and a pink equaliser over green bands.",
            "No more \"no song with id 28\" while you are listening. A queue holds songs "
            "or loose renders, and Next worked out which by looking at what happened to "
            "be playing; a playlist can hold both, so there was a real way to be wrong, "
            "and a wrong answer handed a render's number to the songs endpoint. Four of "
            "those stacked up in the report. The same message twice is now one message "
            "with a count on it.",
            "Deleting every word out of a set of lyrics takes its title with it. The "
            "heading is the first line of the words, and it was only rewritten when there "
            "was a line to read, so emptying one left the old title sitting on the card: "
            "it read as the previous words with the body missing, over a revision the "
            "history correctly called nought characters.",
            "Switching between old versions of a lyric no longer moves the card you are "
            "reading. The bar saying which version you are looking at was above the card, "
            "so the first click pushed it down and every switch after that nudged it "
            "again. It is under the card now, right above the list you clicked in.",
            "An arrow over the app, an I-beam over the words. Every label, count and "
            "heading used to offer to be edited, which matters here because the song "
            "title genuinely is a line you click into and it looked no different. "
            "Selecting and copying is untouched.",
            "Playlists have their own way in. The heading is in the sidebar whether you "
            "have any or not, with a plus on it: making one used to be reachable only "
            "through a song, and with none yet the section was not there at all.",
            "Pressing a button that opened a menu closes it again. It used to close and "
            "reopen on the same press, so the only way to be rid of one was to press "
            "something else, which on a phone is the whole vocabulary: there is no Escape "
            "key and no right button.",
            "Room under the arrangement, which was touching the heading below it. The "
            "Scan and Take stock buttons are absent rather than greyed out when there is "
            "no folder to use them on. The two folder panels wrap their headings the same "
            "way. Tools that only appeared on hover appear without one, on a screen that "
            "has no hover.",
        ],
    },
    {
        "version": "3.2.4",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "Dragging a section moves the section",
        "notes": [
            "Dragging a block in the arrangement moves the block. It used to scroll the "
            "strip instead: the browser owned the sideways drag, and a moment in it took "
            "the gesture away, so the block started to move and then stopped following "
            "your finger. It now stays under your finger to the pixel, the whole way, "
            "including across the moment it changes places with its neighbour.",
            "Because dragging the background is no longer how you get along a long "
            "arrangement, the scrollbar under the strip is thick enough to be a control: "
            "fourteen pixels, and sixteen on a phone.",
            "Pressing a block no longer rebuilds the strip. Every section draws its own "
            "waveform onto its own canvas, and a press threw all of them away and painted "
            "them again to show the picture that was already there. That flicker was what "
            "a press felt like.",
            "Whichever section is chosen carries two buttons on its top right corner: "
            "duplicate, and take it out. Both were a right click or a Backspace away, and "
            "neither of those is a thing a phone can do. They stay on screen when the "
            "section is wider than the strip.",
            "Nothing flashes at the edges of the lyric card any more. A card has walls, "
            "because it turns in three dimensions when you throw it, and the rule said "
            "they belong to every card that is not the front one. The card arriving takes "
            "the front the instant you let go and then fades up from nothing, so for the "
            "length of that fade it was a card appearing with its walls already lit. Only "
            "a card that is actually leaving has thickness now.",
        ],
    },
    {
        "version": "3.2.3",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "An account page, and three things put back where they were",
        "notes": [
            "There is an account page, and the row at the foot of the sidebar goes to it "
            "rather than to settings. It says who you are, whether Google is connected, "
            "how many songs have been shared with you, and lists everybody else with an "
            "account on this server. Names, handles and when they joined, and nothing "
            "else: each account is a separate database and there is no way to ask one "
            "what is in another.",
            "Nothing shows at the edges of the card you are reading. The card has walls, "
            "because it turns in three dimensions when you swipe it, and they were "
            "catching three pixels of light down each side while it sat still. They only "
            "exist now while a card is actually turning.",
            "The take and preset picker is back on one row with Compare, Arrange and "
            "Share on a phone. Giving it a row of its own in 3.2.1 made that area worse, "
            "not better.",
            "Prev, play and next are in the middle of the player again and the position "
            "slider is back underneath them, on a phone as well as everywhere else. The "
            "slimmer bar stays: a smaller cover, no volume slider on a device with keys "
            "for it, and repeat and up next out of the way on the right.",
        ],
    },
    {
        "version": "3.2.2",
        "date": "2026-09-08",
        "name": JRITER,
        "title": "Cards that leave whole, and one place to act on the words",
        "notes": [
            "A card thrown off the deck is no longer sliced off at the edge of its frame. "
            "It was being eaten by an invisible wall on the way out; it leaves whole now.",
            "History, Add version and the bin are one pill sitting on the bottom right "
            "corner of the card. They were in three places: two up in the heading and one "
            "down at the foot of the card, all three acting on the same set of words.",
        ],
    },
    {
        "version": "3.2.1",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Lyrics that are actually readable",
        "notes": [
            "Nothing shows through the card you are reading. The other sets of words used "
            "to sit behind it at 55 and 26 per cent, at the same size and place as the "
            "lines you were reading, so every card had somebody else's verse ghosting "
            "through it. They are off the frame now: the ones you have read to the left, "
            "the ones still to come to the right.",
            "A card has a floor of 320 pixels, so a two line chorus is still a card rather "
            "than a strip, and the block stops changing height every time you swipe.",
            "Swiping lands straight away. It used to throw the card, wait for it to leave, "
            "then rebuild the whole deck: measured at seven hundred to eleven hundred "
            "milliseconds between letting go and the next card being there. Now the card "
            "you threw carries on out of the frame while the next one arrives from the "
            "other side, both at once, and the index moves the moment you let go.",
            "On a phone the take and preset picker gets its own row. It was sharing one "
            "with Compare, Arrange and Share, which left it 67 pixels wide with \"v1 · "
            "Wide master\" squeezed out of it entirely.",
        ],
    },
    {
        "version": "3.2.0",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Two columns, glass all the way down, and a question mark",
        "notes": [
            "The song page is two columns. On the left the two things you work in, the "
            "words and the sound. On the right the facts about it: artwork, playlists, "
            "YouTube, and what you can do to the song. It used to be six full width "
            "sections stacked in whatever order the modules loaded, most of them empty "
            "and each explaining itself in a paragraph. Eighteen hundred pixels of scroll "
            "on a nine hundred pixel screen; it is twelve hundred now.",
            "Folders is two panes side by side rather than two tall sections, each of "
            "which said the same thing twice: once in a paragraph and again in the empty "
            "state underneath it.",
            "Nothing was cut. The explanations moved behind a small question mark next to "
            "the heading they belong to. Press it and the paragraph appears where you are "
            "looking. It is worth reading once and it was in the way every time after.",
            "The main panel is properly glass now. It always had the blur, but the ground "
            "under it was 78 per cent, so beside a rail and a player made of white at 5 "
            "it read as the one solid thing on the screen. It is about half that now: not "
            "all the way, because everything you read sits on it and a pale cover behind "
            "clear glass takes the small print with it.",
            "Empty states, album cards, list rows and the home page's cards are glass too, "
            "rather than matte rectangles laid on a sheet of it.",
        ],
    },
    {
        "version": "3.1.0",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "A share button you can see, and a shorter player",
        "notes": [
            "Sharing is a button on the song, next to Compare and Arrange, instead of an "
            "item hiding in the menu on the title. It is there on every song, including "
            "ones with no renders yet.",
            "Shared with me is always in the sidebar now rather than appearing only once "
            "somebody has shared something. Nobody can be told to look somewhere that "
            "does not exist yet.",
            "The foot of the sidebar always says who you are. Signed into Google it shows "
            "that account's picture and name with your JR!TER account underneath; "
            "otherwise your JR!TER account and a note that Google is not connected. It "
            "gets the whole width, because two lines beside a button had eighty eight "
            "pixels and the second line needed a hundred and nine.",
            "Swiping the lyrics follows your finger again. The card is what a thumb lands "
            "on and it had never been told that sideways belongs to it, so the browser "
            "took the gesture a moment in and decided it was a scroll.",
            "The player is shorter. Repeat and keep playing moved out of the transport, "
            "which is for the three things you press while listening rather than the two "
            "you set once. On a phone it is one row with the position as a line along the "
            "top edge: sixty six pixels instead of a hundred and sixteen.",
        ],
    },
    {
        "version": "3.0.2",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "The about arrow is a button now",
        "notes": [
            "Hold the panel out past its stop, the arrow appears, press it. It used to "
            "open the page when you let go instead, which meant the arrow itself could "
            "not be pressed: pressing needs a finger, and the finger was the one holding "
            "the gesture open.",
            "It also only ever worked on a clean release, and holding a thumb still near "
            "the left edge is exactly what a phone browser decides was an edge swipe: it "
            "took the gesture back and the arrow vanished with the thumb still down. The "
            "offer survives that now.",
            "It takes itself away after two seconds if you do not press it, counted from "
            "when you let go rather than from when it appears.",
        ],
    },
    {
        "version": "3.0.1",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Updating actually updates",
        "notes": [
            "A folder of backups sitting beside the code counted as somebody having edited "
            "JR!TER, so every update since the day it was made had been refused. Only "
            "changes to files git is tracking count now. An untracked file is not work a "
            "pull can throw away.",
            "Settings asks about updates when you open it, rather than waiting to be "
            "asked. Pressing \"Update ready\" in the top bar used to land you on a screen "
            "that said it had not checked, with nothing on it to press.",
            "When an update cannot be applied, the reason is on the screen next to it. It "
            "was only ever shown when there was no release name to show instead, which is "
            "never.",
            "There is a Restart the server button. An update lands on disk while the "
            "running server keeps the code it started with, so until something restarts "
            "it a perfectly successful update looks exactly like nothing happening.",
        ],
    },
    {
        "version": "3.0.0",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Your friends can have accounts",
        "notes": [
            "Somebody else can have an account on this server, with a library of their "
            "own. Nothing shows one person another's songs, renders, samples or lyrics, "
            "and that is not a permission check: every account is a separate database "
            "file and a separate folder of audio, so a query cannot reach rows that are "
            "not in the file it opened.",
            "Signing up needs an invite. Make one in Settings, under People, and send "
            "them the code. Without that, an open form on a public address is an offer to "
            "whoever finds it.",
            "You can share one song. They can play it, read the words and work on the "
            "equaliser and the limiter, and anything they save becomes their own copy "
            "rather than a change to yours. Give them a name on the share and their edits "
            "carry it, so a preset comes back as \"the original, edited by them\". They "
            "cannot see anything else of yours or post anything anywhere, and you can "
            "take it back whenever you like.",
            "Your own library is now account one. Your password, your songs, your audio "
            "and your machine credentials all carried across, and there is nothing to do "
            "about it: sign in the way you always have.",
            "One thing said plainly: this is a wall inside the app, not a wall against "
            "whoever runs the machine. Their computer, their files. The privacy notice "
            "says the same.",
        ],
    },
    {
        "version": "2.7.0",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "A front door, and a player that keeps going",
        "notes": [
            "Pressing the name in the rail opens a front page instead of the library: "
            "what this is in a sentence, the songs and albums you keep opening, and what "
            "changed lately. The release notes moved there out of Settings.",
            "The player has two new buttons. Repeat plays the same thing again. The other "
            "one keeps it going when the queue runs out, choosing from your own library "
            "rather than stopping dead: the same album counts for most, then how often "
            "you open something, then how recently you touched it, then chance. Both are "
            "remembered per browser and either can be switched off.",
            "The account you have connected shows at the foot of the rail, and on a phone "
            "the search box now shrinks away as the panel comes over it rather than "
            "sitting half covered behind it.",
        ],
    },
    {
        "version": "2.6.0",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Cards with thickness, and two kinds of watched folder",
        "notes": [
            "The lyrics are a stack now and the front one is thrown off rather than slid "
            "past. It tilts under your thumb, turns enough to bring one of its side walls "
            "into view, and the cards behind it show through as a stack. The walls are "
            "real faces, not a drawn bevel: the old lit line along the top border stayed "
            "put while the card turned, which is what looked wrong about it.",
            "Watched folders are two things: a render collector for the folders your "
            "bounces land in, and simple sync for sample libraries. A library is never "
            "offered as a render now, even when it sits inside a collector, which it did "
            "and which is how a folder of one shots ended up as a list of new versions.",
            "Simple sync takes stock of what a library holds so two machines can be "
            "compared. It does not move files between them yet, and the screen says so.",
            "Dust starts at what used to be the top of its dial and reaches two hundred, "
            "the same as the chromatic aberration.",
            "One soft blob of light on the black behind everything, so the glass has "
            "something to bend on the screens with no artwork.",
            "The white buttons on a render row are softer and a little smaller.",
        ],
    },
    {
        "version": "2.5.2",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "The whole panel is glass, and the renders are in columns",
        "notes": [
            "The main panel is glass now, not just the rail and the player. On a song "
            "page the artwork bends through it instead of stopping dead at its edge.",
            "The renders list is in real columns. The name is the only thing that "
            "stretches, so the duration and the size start at the same place on every "
            "row and you can read down them, and the date sits under the name in small "
            "text as year, month, day, which is the order that sorts by eye.",
            "The waveform is behind the row again, filling it, in the render's own "
            "colour instead of grey. It is under the glass rather than on it now, so the "
            "row blurs and bends it: it is in the pane rather than painted on it, and "
            "that is also what keeps the name readable over the top.",
            "The letter tile went: it was made from the name it was sitting next to. Add "
            "is smaller than Play, because two white discs a row is ten of the brightest "
            "things on the screen arguing with the words.",
            "The About shortcut is on the left now, on the same edge as the rail, and "
            "letting go slides the two of them out of frame together before the page "
            "changes.",
            "The About page has a picture and something written on it.",
        ],
    },
    {
        "version": "2.4.1",
        "date": "2026-09-07",
        "name": JRITER,
        "title": "Renders on one line, a deck that turns, and a way out of the library",
        "notes": [
            "Renders are one row each: cover, a white play disc with the triangle cut out "
            "of it, the name, and when it arrived. They were three decks deep. The date "
            "shows for everything now, not only for renders that came through the client, "
            "and it leads the line because the end of a line is what a narrow screen "
            "takes away.",
            "The waveform is carved into the glass rather than printed on it: grey, "
            "blended so it modulates the surface instead of sitting on it, with one pixel "
            "of near white underneath, which is the lit lower lip an engraved edge has.",
            "Pull the rail past its stop on a phone and hold. A second later it buzzes, a "
            "bubble arrives from the right edge, and letting go takes you to the page "
            "behind the library. There is nothing written on it yet.",
            "The rail slides over the whole song page now. It used to refuse anything "
            "pressable, which on a song page is nearly everything. What it still refuses "
            "is measured rather than listed: a deck with more than one card, a strip that "
            "actually overflows, and canvases, sliders and text boxes, where a sideways "
            "drag already means something.",
            "The lyric deck turns instead of sliding past. The cards behind are pushed "
            "back and hinged away on the edge nearest the front one.",
            "The sound panel says which deck it is shaping, with the same A and B as the "
            "hero, and the equaliser and the limiter are drawn inside the preset instead "
            "of beside it, because a preset holds both and the old layout read as though "
            "it were an equaliser setting.",
            "Sign in with Google for the upload, one press instead of a typed code. The "
            "code is still there and is still the better one when the server is on "
            "another machine. You still need your own Google client; that part cannot be "
            "removed.",
            "The dither is a real dither now. The first one blended with overlay, which "
            "multiplies, so the amount of noise was proportional to how bright a pixel "
            "already was: on a near black app that is almost nothing, exactly where the "
            "banding is worst. Measured against a dark ramp it left half the bands "
            "standing. It adds now, so two levels is two levels in the darkest corner "
            "and on the brightest cover, and the noise is generated one speck per pixel "
            "of your screen and never resampled on the way there.",
            "Chromatic aberration is what the fringing setting is called, it starts at "
            "the hundred the dial used to stop at, and it goes to two hundred. Dither is "
            "new, for the banding a wide blur leaves in a smooth gradient. The specks are "
            "bigger and no longer sliced in half at the edge of a panel.",
            "Required fields are marked, optional ones are not, and placeholders went "
            "back to being examples. The update light is a sentence you can press.",
        ],
    },
    {
        "version": "2.3.0",
        "date": "2026-09-06",
        "name": JRITER,
        "title": "Terms, a privacy notice, and your library as a zip",
        "notes": [
            "There are terms and a privacy notice now, at /legal, and they are as small "
            "as they could honestly be: no banner, no box to tick, nothing to agree to. "
            "The notice names every address this program can reach and says when and why, "
            "and a test reads those addresses out of the source and fails until the page "
            "names them, so it cannot go quietly out of date.",
            "It is readable without signing in. The person it is most for is the one "
            "deciding whether to hand anything over, and they do not have a password yet.",
            "Take a copy, in Settings, gives you a zip of every row JR!TER keeps, table by "
            "table, with your settings and a note saying where the audio is. What is in it "
            "is a named list rather than everything minus what to hide, because the second "
            "kind is wrong the day somebody adds a table. Nothing that opens the door is "
            "in it.",
            "Erase this library, beside it, empties everything after you type the "
            "library's name. It says what it will take first and names afterwards the "
            "three things it cannot reach. The first version deleted the database file, "
            "which silently does nothing on Windows while another thread holds it open: it "
            "reported success and erased nothing.",
        ],
    },
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
