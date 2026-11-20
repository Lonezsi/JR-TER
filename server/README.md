# JR!TER server (Spring)

The Java port of the Python server, module by module (see `../docs/REWORK.md`). It opens the
same SQLite files and blob folder, so the Python server stays the way back.

Ported so far: the door (accounts, sessions, invites, machine tokens, the guess limit, the
Foyer sign-in), `/api/health`, the page and bundle serving. Every other `/api/...` answers
404 "no such endpoint" until its module is ported.

    $env:JAVA_HOME='C:\Java\jdk-21'
    mvn -f server package                 # builds server/target/jriter.jar, runs the JUnit tests
    java -jar server/target/jriter.jar    # serves on 7900; run it on another port beside the live one
    python tools/parity_door.py           # checks it against the Python modules on a scratch data dir

Environment (same names as the Python server): `JRITER_DATA`, `JRITER_PORT`, `JRITER_HOST`,
`JRITER_GLASS`, `JRITER_GLASS_DEFS`, `JRITER_FOYER` (empty turns Foyer off), plus
`JRITER_HOME` (the repo, for `web/`; defaults to the folder holding `web/`) and `JRITER_WEB`.
