# JR!TER server (Spring)

The Java port of the Python server, module by module (see `../docs/REWORK.md`). It opens the
same SQLite files and blob folder, so the Python server stays the way back.

Ported so far: sound presets and sharing (shares, links, the guest proxy, guest edits and undo; `tools/parity_sharing.py`), the devlog, the display font, export/import/erase (	ools/parity_export.py), lyrics, arrange, artwork, vocals, albums and playlists (`tools/parity_media.py`), songs, versions, blobs and renders (`tools/parity_library.py`), and the door (accounts, sessions, invites, machine tokens, the guess limit, the
python tools/parity_sharing.py        # and for sound presets, shares, links, the guest proxy and undo
Foyer sign-in), `/api/health`, the page and bundle serving. Every other `/api/...` answers
404 "no such endpoint" until its module is ported.

    $env:JAVA_HOME='C:\Java\jdk-21'
    mvn -f server package                 # builds server/target/jriter.jar, runs the JUnit tests
    java -jar server/target/jriter.jar    # serves on 7900; run it on another port beside the live one
    python tools/parity_door.py           # checks the door against the Python modules on a scratch data dir
    python tools/parity_library.py        # the same for songs, versions, blobs and renders
    python tools/parity_media.py          # and for lyrics, arrange, artwork, vocals, albums, playlists
    python tools/parity_export.py         # and for the devlog, the display font, export, import and erase

Environment (same names as the Python server): `JRITER_DATA`, `JRITER_PORT`, `JRITER_HOST`,
`JRITER_GLASS`, `JRITER_GLASS_DEFS`, `JRITER_FOYER` (empty turns Foyer off), plus
`JRITER_HOME` (the repo, for `web/`; defaults to the folder holding `web/`) and `JRITER_WEB`.
