# The JR!TER rework: the shape

Decided 2026-11-21 (Wh;le, from the card on Invent;ry). This is the plan the rework tasks
follow. Change it here if the plan changes, so the plan and the work don't drift apart.

## What it becomes

One server and one desktop app, with nothing in Python:

| part      | now                                  | after                                          |
|-----------|--------------------------------------|------------------------------------------------|
| server    | Python stdlib, `server.py`, `jriter/` | Spring Boot 3, Java 21, one jar, `server/`     |
| interface | vanilla JS in `web/js`, Svelte 5 in `ui/` on the owner's PC | the Svelte 5 + TypeScript rebuild, `ui/` |
| PC side   | `client/*.py` (watcher, FL renders, agent token) | a Tauri 2 desktop app, `desktop/`, same Svelte UI |
| data      | SQLite per account + blobs on disk   | the **same files**, unchanged                  |

### Server: Spring Boot, but not JQZZ's database

Like JQZZ: Spring Boot, a Maven build, `mvn spring-boot:run` in dev, one jar on the host.
Unlike JQZZ: no JPA and no H2. The server opens the SQLite files JR!TER already keeps
(sqlite-jdbc + `JdbcTemplate`, the same tables and columns as `jriter/db.py` makes today) and
the same blob folder. That gives three things for free:

- every library comes over intact, because nothing moves (task 12 becomes "prove it");
- the old Python server stays a way back: stop the jar, start `server.py`, same data (task 13);
- the plain-text library file (`docs/library-format.md`, `library.json` v2) stays the export
  and import, byte for byte.

Schema changes wait until the Python server is retired, so the way back keeps working.

The API keeps its paths and JSON shapes, so the interface doesn't care which server answers.
Port one module at a time, in this order: accounts/auth (with the Foyer sign-in through
`http://127.0.0.1:7000/api/account`), songs, versions, blobs, renders, lyrics, albums,
playlists, sharing, search (the query language), the grave, the timetable, then the rest.
Each module is done when the existing Python tests for it pass against the Spring server
over HTTP. Keep the security fixes already made (owner-only host import, last
X-Forwarded-For from loopback only, the sign-in limit).

### Interface: keep the Svelte rebuild

The Svelte 5 rebuild is the new interface. It doesn't switch to React to match JQZZ: what
JQZZ and JR!TER share is the backend style and the look, not the UI framework, and the
rebuild is already under way. Spring serves the built files the same way `server.py` does.

Our web style means Foyer's glass and spacing: read `../foyer/shared/glass.css` and
`glass-defs.html` off disk as today, never a copy. The CD cases, stickers, stacks, grave,
undo, j/k, search language, light mode and guest library all come along; nothing the
4.x line shipped is dropped.

First step, before anything else: the rebuild is only on the owner's PC. It gets committed
to this repo as `ui/` so the rest of the rework can see it.

### Desktop app: Tauri

A real PC app replaces `client/jriter_client.py`, `jriter_app.py`, `jriter_shell.py` and
`flrender.py`: a tray app that watches the song folders, picks up FL Studio renders and
uploads them, and holds the agent token. Tauri 2, because it reuses the Svelte interface
(the app is JR!TER in a window plus the watcher) and makes a small Windows installer. The
Rust side stays small: folder watching, starting FL Studio's render, the token in the
Windows credential store.

## Order

1. Commit the Svelte rebuild (`ui/`) from the owner's PC.
2. `server/`: Spring skeleton serving `web/` and the API module by module (task 9).
3. Run it beside the Python server on another port against a copy of the data, until every
   test passes and every library reads the same (task 12).
4. New look finished in `ui/` (task 11).
5. `desktop/` replaces `client/` (task 10).
6. Switch the host: the "JRITER Server" task starts the jar on 7900; `server.py` kept as the
   way back until it hasn't been needed for a month (task 13).
