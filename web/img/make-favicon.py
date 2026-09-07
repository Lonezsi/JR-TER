"""Draw web/favicon.ico.

Run by hand, never at startup and never as part of a build:

    python web/img/make-favicon.py

The mark is the exclamation out of JR!TER: a bar and a dot cut out of a green tile, which
is what the icon already was. Only the exclamation, without the J the SVG also drew: this
has to survive being sixteen pixels across in a browser tab and a taskbar, and two glyphs
at that size are four grey smudges.

Standard library, like everything else here. An ICO is a small header followed by whole
files, and since Vista those files may be PNGs, so this writes four PNGs with zlib and
staples a header on the front. That is the entire format.

Committed as a binary because it is one, but this file is why it looks the way it does, and
regenerating it is one command rather than an image editor and a guess at the green.
"""
import os
import zlib
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, "favicon.ico")

#: The colours the mark already had.
#:
#: index.html carried this icon as an inline SVG data URI, which the tab could use and a
#: Windows shortcut could not, and login.html and legal.html had no icon at all. This is
#: the same mark as a real file, so there is one of it: green ground, dark glyph, the way
#: it already was. Not the other way round, however much a dark tile suits the app, because
#: an icon that changes is an icon people stop recognising.
GROUND = (84, 179, 122)      # --accent
GROUND_HI = (116, 211, 152)  # --accent-hi
INK = (15, 19, 17)           # the near black the SVG used

#: Every size Windows and browsers actually reach for. 256 is what File Explorer shows at
#: its largest, 48 is the desktop, 32 the taskbar, 16 the tab.
SIZES = (16, 32, 48, 256)

#: How many samples per pixel per axis. The mark is all curves and straight edges at small
#: sizes, and a hard edged 16px icon looks like a mistake next to every other tab.
SUPER = 4


def _rounded(x, y, w, h, r):
    """Is this point inside a rounded rectangle. Coordinates are floats in pixel space."""
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    # The corner circles, one quadrant each. Anywhere outside both corner boxes is a
    # straight edge and therefore inside.
    cx = r if x < r else (w - r if x > w - r else x)
    cy = r if y < r else (h - r if y > h - r else y)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _mark(x, y, size):
    """The exclamation, in a unit square scaled to size. Returns a colour or None.

    Laid out against a 100 wide grid and scaled, so the proportions are the same at every
    size rather than drifting as the pixels get coarser.
    """
    u = size / 100.0
    bar_w = 15 * u
    # The bar tapers very slightly, which is what keeps it from reading as a rectangle
    # somebody forgot to shape.
    top, bottom = 20 * u, 62 * u
    if top <= y <= bottom:
        share = (y - top) / (bottom - top)
        half = (bar_w / 2.0) * (1.0 - 0.12 * share)
        if abs(x - size / 2.0) <= half:
            return INK
    dot_y, dot_r = 79 * u, 8.5 * u
    if (x - size / 2.0) ** 2 + (y - dot_y) ** 2 <= dot_r * dot_r:
        return INK
    return None


def _pixels(size):
    """One icon, as rows of RGBA tuples."""
    rows = []
    step = 1.0 / SUPER
    corner = size * 0.22
    for py in range(size):
        row = []
        for px in range(size):
            # Supersample: average SUPER x SUPER points inside the pixel.
            r = g = b = a = 0.0
            for sy in range(SUPER):
                for sx in range(SUPER):
                    x = px + (sx + 0.5) * step
                    y = py + (sy + 0.5) * step
                    if not _rounded(x, y, size, size, corner):
                        continue
                    ink = _mark(x, y, size)
                    # Lit from above, like every other surface in this app. On the tile
                    # rather than on the glyph: the glyph is a hole in it.
                    t = y / float(size)
                    ground = tuple(int(GROUND_HI[i] + (GROUND[i] - GROUND_HI[i]) * t)
                                   for i in range(3))
                    colour = ink if ink else ground
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += 255.0
            n = float(SUPER * SUPER)
            if a <= 0:
                row.append((0, 0, 0, 0))
                continue
            # Averaged over the covered samples for colour and over all of them for alpha,
            # or the edge pixels come out darker than the fill: a half covered pixel is the
            # same colour as a full one, it is only less of it.
            covered = a / 255.0
            row.append((int(r / covered), int(g / covered), int(b / covered),
                        int(a / n)))
        rows.append(row)
    return rows


def _png(rows):
    size = len(rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)                     # filter: none, on every scanline
        for px in row:
            raw += bytes(px)

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def main():
    images = [_png(_pixels(size)) for size in SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    # The directory comes before the images and has to say where each one starts, so the
    # offset of the first is however long the header and the whole directory are.
    offset = len(header) + 16 * len(images)
    directory = b""
    for size, blob in zip(SIZES, images):
        # 256 is written as 0: the field is one byte and the format says 0 means 256.
        directory += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32,
                                 len(blob), offset)
        offset += len(blob)
    with open(OUT, "wb") as f:
        f.write(header + directory + b"".join(images))
    print("wrote %s (%d bytes, sizes %s)"
          % (os.path.normpath(OUT), offset, ", ".join(str(s) for s in SIZES)))


if __name__ == "__main__":
    main()
