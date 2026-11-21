"""A throwaway library to build the interface against.

    python tools/dev.py            a server on 7911 with a seeded library, no door
    python tools/dev.py --keep     use the same data directory as last time

Real libraries are never touched: JRITER_DATA is pointed at a temporary directory before
anything imports jriter, the same way the test suite does it. The door (auth) and the
updater are left out on purpose, the first so there is nothing to sign in to and the
second so a development server can never pull or restart itself.

The interface served is web/, which is what `npm run ship` in ui/ builds. For hot reload, run `npm run dev` in ui/ beside
this with JRITER_SERVER=http://127.0.0.1:7911 and open the address Vite prints.
"""
import argparse
import json
import math
import os
import struct
import sys
import tempfile
import threading
import urllib.request
import wave
import zlib
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PORT = 7911
KEPT = os.path.join(tempfile.gettempdir(), "jriter-dev-library")


def tone(seconds, notes, rate=22050, level=0.35):
    """A little tune as WAV bytes: enough to hear which file is which and to draw a
    waveform that is not a rectangle."""
    frames = bytearray()
    per = max(1, int(rate * seconds / len(notes)))
    for index, freq in enumerate(notes):
        for i in range(per):
            t = i / rate
            fade = min(1.0, i / (rate * 0.01), (per - i) / (rate * 0.05))
            swell = 0.55 + 0.45 * math.sin(math.pi * (index + i / per) / len(notes))
            value = (math.sin(2 * math.pi * freq * t)
                     + 0.35 * math.sin(2 * math.pi * freq * 2 * t)) * level * fade * swell
            frames += struct.pack("<h", int(max(-1, min(1, value)) * 32767))
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return out.getvalue()


def picture(size, top, bottom):
    """A diagonal gradient as PNG bytes, with nothing but zlib."""
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            f = (x + y) / (2 * size - 2)
            rows += bytes(int(top[c] + (bottom[c] - top[c]) * f) for c in range(3))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
            + chunk(b"IEND", b""))


class Client:
    def __init__(self, base):
        self.base = base

    def call(self, method, path, body=None, name=None):
        headers = {}
        data = None
        if name is not None:
            data = body
            headers["Content-Type"] = "application/octet-stream"
            headers["X-Filename"] = name
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8")
                return json.loads(text) if text else {}
        except Exception as e:                      # seeding is best effort, and says so
            detail = getattr(e, "read", lambda: b"")()
            print("  seed: %s %s failed: %s %s" % (method, path, e, detail[:200]))
            return {}


SCALE = [220.0, 246.9, 277.2, 293.7, 329.6, 370.0, 415.3, 440.0]

SONGS = [
    ("Ordinary Weather", 3, ((250, 120, 150), (40, 20, 90)),
     "Ordinary weather\n\nNothing on the radio but rain\nand the kettle counting down\n\nI kept the window open\nfor the sound of you not calling"),
    ("Late Bloomer", 2, ((90, 220, 170), (10, 40, 60)),
     "Late bloomer\n\nEverybody left the garden\nbefore the first one opened"),
    ("Glass Hours", 4, ((120, 160, 255), (30, 10, 70)), ""),
    ("Paper Moon Motel", 1, ((255, 190, 90), (90, 30, 20)),
     "Paper moon motel\n\nVacancy, in neon, half of it burnt out"),
    ("Tide Tables", 2, None, ""),
    ("A Song With No Renders", 0, None, ""),
]


def seed(base):
    api = Client(base)
    if api.call("GET", "/api/songs").get("songs"):
        print("  seed: the library already has songs, leaving it alone")
        return
    ids = []
    for n, (title, takes, colours, words) in enumerate(SONGS):
        song = api.call("POST", "/api/songs", {"title": title}).get("song")
        if not song:
            continue
        ids.append(song["id"])
        for take in range(takes):
            notes = [SCALE[(n + take + i * (2 + take)) % len(SCALE)] for i in range(8 + take * 2)]
            api.call("POST", "/api/songs/%d/versions" % song["id"],
                     tone(14 + n * 3 + take, notes), name="%s v%d.wav" % (title, take + 1))
        if colours:
            api.call("POST", "/api/songs/%d/artwork" % song["id"],
                     picture(256, *colours), name="cover.png")
        if words:
            api.call("POST", "/api/songs/%d/lyrics" % song["id"], {"text": words})

    album = api.call("POST", "/api/albums", {"title": "First Light", "year": "2026"}).get("album")
    if album:
        for song_id in ids[:4]:
            api.call("POST", "/api/albums/%d/songs" % album["id"], {"song_id": song_id})
        api.call("POST", "/api/albums/%d/cover" % album["id"],
                 picture(256, (255, 120, 200), (30, 20, 80)), name="cover.png")
    api.call("POST", "/api/albums", {"title": "Demos nobody asked for", "year": "2025"})

    playlist = api.call("POST", "/api/playlists", {"title": "Late takes"}).get("playlist")
    if playlist:
        for song_id in ids[1:4]:
            api.call("POST", "/api/playlists/%d/items" % playlist["id"], {"song_id": song_id})

    for i, name in enumerate(["Ordinary Weather master.wav", "untitled bounce 07.wav",
                              "Glass Hours (rough).wav", "idea 2026-11-02.wav"]):
        notes = [SCALE[(i * 3 + k * 2) % len(SCALE)] for k in range(6 + i)]
        api.call("POST", "/api/renders", tone(8 + i * 4, notes), name=name)
    print("  seed: %d songs, 2 albums, 1 playlist, 4 loose renders" % len(ids))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--keep", action="store_true", help="reuse last time's data directory")
    parser.add_argument("--door", action="store_true", help="leave the auth module on")
    args = parser.parse_args()

    data = KEPT if args.keep else tempfile.mkdtemp(prefix="jriter-dev-")
    os.makedirs(data, exist_ok=True)
    os.environ["JRITER_DATA"] = data

    from jriter import config, http, db, accounts, who   # noqa: E402  (after the env vars)

    leave_out = {"updater"} | (set() if args.door else {"auth"})
    config.MODULES = [m for m in config.MODULES if m not in leave_out]

    # Dev only: the audit scripts in tools/ are served at /__tools/ so they can be run in
    # the page with one line, instead of being pasted in again after every rebuild.
    plain_static = http.Handler._static

    def _static(self, path):
        if path.startswith("/__tools/"):
            full = os.path.join(ROOT, "tools", os.path.basename(path))
            if os.path.isfile(full):
                return self._file(full, "text/plain; charset=utf-8")
        return plain_static(self, path)

    http.Handler._static = _static

    server = http.serve("127.0.0.1", args.port)
    with who.acting_as(accounts.OWNER):
        config.ensure_home(accounts.OWNER)
    base = "http://127.0.0.1:%d" % args.port
    print("JR!TER dev   %s" % base)
    print("  data       %s" % data)
    print("  interface  %s" % config.WEB)
    threading.Thread(target=server.serve_forever, name="serve", daemon=True).start()
    try:
        seed(base)
        print("ready")
        sys.stdout.flush()
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.shutdown()
        db.shut_down()
    return 0


if __name__ == "__main__":
    sys.exit(main())
