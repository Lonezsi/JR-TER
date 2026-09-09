"""Draw web/favicon.ico.

Run by hand, never at startup and never as part of a build:

    python web/img/make-favicon.py            # writes web/favicon.ico
    python web/img/make-favicon.py --preview  # and a big PNG to look at

The mark is a quarter rest and an exclamation, cut out of a green tile, because that is
the joke the whole name is built on: a rest is the instruction to play nothing, and it is
standing next to the loudest punctuation there is. An icon for a music workspace that says
"silence!" is the point, and an icon that is only the exclamation throws it away.

The rest is not a typed glyph. Nothing in the display stack carries U+1D13D, least of all a
face somebody uploaded themselves, so a text glyph is a notdef box on a machine you cannot
test. It is the same path the wordmark in the rail draws, sampled from the same numbers, so
the two marks cannot drift apart. Cut heavier here: the wordmark is nine pixels wide beside
23 pixel text and wants a hairline, and a tab icon at sixteen wants a stroke you can see.

Standard library, like everything else here. An ICO is a small header followed by whole
files, and since Vista those files may be PNGs, so this writes four PNGs with zlib and
staples a header on the front. That is the entire format.

Committed as a binary because it is one, but this file is why it looks the way it does, and
regenerating it is one command rather than an image editor and a guess at the green.
"""
import os
import sys
import zlib
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, "favicon.ico")
PREVIEW = os.path.join(HERE, "favicon-preview.png")

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

#: How many samples per pixel per axis. The mark is all curves and diagonals, and a hard
#: edged 16px icon looks like a mistake next to every other tab.
SUPER = 4

# ── the rest, from the wordmark ──────────────────────────────────────────────
#
# The path in index.html, in its own 12 by 30 viewBox: a three legged zigzag, then a hook
# off the bottom of it made of two cubics. Written out as numbers rather than parsed,
# because a path parser to read one path is a parser to maintain.
ZIGZAG = [(8.5, 2.0), (3.5, 9.5), (8.5, 15.0), (3.5, 21.0)]
HOOK = [
    # start,        control 1,     control 2,     end
    ((3.5, 21.0), (6.7, 21.6), (8.4, 23.4), (8.4, 25.6)),
    ((8.4, 25.6), (8.4, 27.2), (7.4, 28.2), (6.0, 28.2)),
]

# ── and the same rest cut for sixteen pixels ────────────────────────────────
#
# Three legs and a curl do not fit in twelve pixels of height. Measured, before drawing
# anything: the path above travels 5.0 across against 26.2 down, so at 78 per cent of a
# 16px tile that is 12.4 tile units of horizontal swing against a 13 unit stroke. The
# wiggle is narrower than the line that draws it, the legs fill into each other, and what
# comes out is a bar. Nothing about the stroke weight fixes that; the shape has to change.
#
# Two legs, swinging 11.0 across instead of 5.0, and a hook shortened to a stub that turns
# once and stops. Fewer, larger, further apart, which is the only drawing that survives
# this size.
ZIGZAG_SMALL = [(10.0, 2.0), (2.0, 11.5), (10.0, 21.0)]
HOOK_SMALL = [
    ((10.0, 21.0), (7.2, 23.0), (5.4, 25.4), (4.2, 28.2)),
]

#: Where the two glyphs sit, in a 100 wide tile.
#:
#: Both numbers were chosen by looking at the thing: the rest is the taller and more
#: distinctive of the two so it gets the height, and the gap is small enough that they read
#: as one mark rather than two marks sharing a tile.
REST_TOP, REST_BOTTOM = 11.0, 89.0
REST_MID_X = 36.5
REST_STROKE = 13.0          # the heavy cut: 13 per cent of the tile, so 2.1px at 16
HOOK_STROKE = 11.0          # the wordmark thins the hook too, in the same proportion

#: The small cut's own weights and placing.
#:
#: Thinner rather than heavier, which is the opposite of what it looks like it should want:
#: the legs are what have to stay apart, and at 16 a heavier stroke closes the gap between
#: them again. Pushed left as well, because swinging twice as wide runs it into the bang.
REST_STROKE_SMALL = 11.5
HOOK_STROKE_SMALL = 10.5
REST_MID_X_SMALL = 32.0

BANG_MID_X = 69.0
BANG_W = 15.5
BANG_TOP, BANG_BOTTOM = 18.0, 63.0
DOT_Y, DOT_R = 80.5, 8.5


def _cubic(seg, steps=24):
    """A cubic Bezier as points. Sampled rather than solved: the stroke is a distance to a
    polyline, and at this many steps the error is far below one pixel of a 256px icon."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
    out = []
    for i in range(steps + 1):
        t = i / float(steps)
        u = 1.0 - t
        out.append((u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                    u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3))
    return out


def _rest_path(small=False):
    """The rest's centreline in tile coordinates, as two polylines with their widths.

    Scaled from the viewBox by height, so the mark keeps the proportions the rail draws,
    and centred on REST_MID_X by its own bounding box rather than by the viewBox, which has
    slack on both sides.

    With small, the two legged version and the numbers that go with it. It is the same
    function because the scaling and centring are the part that must not differ: only the
    path and three constants change.
    """
    zigzag = ZIGZAG_SMALL if small else ZIGZAG
    segments = HOOK_SMALL if small else HOOK
    stroke = REST_STROKE_SMALL if small else REST_STROKE
    hook_stroke = HOOK_STROKE_SMALL if small else HOOK_STROKE
    mid_x = REST_MID_X_SMALL if small else REST_MID_X

    hook = []
    for seg in segments:
        hook.extend(_cubic(seg))
    lines = [(zigzag, stroke), (hook, hook_stroke)]

    every = [p for line, _ in lines for p in line]
    top = min(y for _, y in every)
    bottom = max(y for _, y in every)
    left = min(x for x, _ in every)
    right = max(x for x, _ in every)

    # Height is set by the outside of the stroke, not the centreline, or the mark comes out
    # taller than asked for by half a stroke at each end.
    scale = ((REST_BOTTOM - REST_TOP) - stroke) / (bottom - top)
    mid = (left + right) / 2.0
    # The widths are already in tile units, so only the centreline is scaled.
    out = []
    for line, width in lines:
        out.append(([(mid_x + (x - mid) * scale,
                      REST_TOP + stroke / 2.0 + (y - top) * scale) for x, y in line],
                    width))
    return out


#: Worked out once, not per pixel. At 256 with four times supersampling this function is
#: asked about a million points, and the rest is the same rest every time.
REST = _rest_path()
REST_SMALL = _rest_path(small=True)

#: Below this, the two legged rest. The 32 carries three legs and a curl; the 16 does not.
SMALL_AT = 20


def _near(px, py, line, half):
    """Is this point within half a stroke of a polyline. Round joins and caps, which is
    what the wordmark asks for and what keeps the zigzag from growing spikes."""
    for i in range(len(line) - 1):
        ax, ay = line[i]
        bx, by = line[i + 1]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        if span <= 0:
            t = 0.0
        else:
            t = ((px - ax) * dx + (py - ay) * dy) / span
            t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
        ox, oy = px - (ax + t * dx), py - (ay + t * dy)
        if ox * ox + oy * oy <= half * half:
            return True
    return False


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
    """The rest and the exclamation, in a unit square scaled to size.

    Returns a colour or None. Laid out against a 100 wide grid and scaled, so the
    proportions are the same at every size rather than drifting as the pixels get coarser.
    """
    u = 100.0 / size
    gx, gy = x * u, y * u

    for line, width in (REST_SMALL if size < SMALL_AT else REST):
        if _near(gx, gy, line, width / 2.0):
            return INK

    # The bar tapers very slightly, which is what keeps it from reading as a rectangle
    # somebody forgot to shape.
    if BANG_TOP <= gy <= BANG_BOTTOM:
        share = (gy - BANG_TOP) / (BANG_BOTTOM - BANG_TOP)
        half = (BANG_W / 2.0) * (1.0 - 0.12 * share)
        if abs(gx - BANG_MID_X) <= half:
            return INK
    if (gx - BANG_MID_X) ** 2 + (gy - DOT_Y) ** 2 <= DOT_R * DOT_R:
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


def _png_any(rows, width, height):
    """Rows of RGBA tuples as a PNG. Any rectangle: the icons are square, the preview
    strip is not."""
    raw = bytearray()
    for row in rows:
        raw.append(0)                     # filter: none, on every scanline
        for px in row:
            raw += bytes(px)

    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    return (bytes([137, 80, 78, 71, 13, 10, 26, 10])
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def _png(rows):
    return _png_any(rows, len(rows), len(rows))

def main():
    icons = [(size, _png(_pixels(size))) for size in SIZES]

    # ICONDIR, then one ICONDIRENTRY each, then the files. Offsets are from the top of the
    # file, so they depend on how many entries there are.
    head = struct.pack("<HHH", 0, 1, len(icons))
    offset = len(head) + 16 * len(icons)
    entries, blobs = b"", b""
    for size, data in icons:
        entries += struct.pack("<BBBBHHII",
                               0 if size >= 256 else size,   # 0 means 256
                               0 if size >= 256 else size,
                               0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)

    with open(OUT, "wb") as f:
        f.write(head + entries + blobs)
    print("wrote %s, %d bytes, sizes %s"
          % (os.path.relpath(OUT, os.path.join(HERE, os.pardir, os.pardir)),
             len(head + entries + blobs), ", ".join(str(s) for s in SIZES)))

    if "--preview" in sys.argv:
        # Something to actually look at: the big one, and the two small ones blown up
        # nearest neighbour beside it, so a decision about sixteen pixels is made by
        # looking at sixteen pixels rather than at a drawing of them.
        panels = [_pixels(256)]
        for small in (32, 16):
            grid = _pixels(small)
            k = 256 // small
            panels.append([[grid[py // k][px // k] for px in range(256)]
                           for py in range(256)])

        gap = 16
        dark = (0, 0, 0, 255)
        width = 256 * len(panels) + gap * (len(panels) - 1)
        rows = []
        for py in range(256):
            row = []
            for i, panel in enumerate(panels):
                if i:
                    row += [dark] * gap
                row += panel[py]
            rows.append(row)
        with open(PREVIEW, "wb") as f:
            f.write(_png_any(rows, width, 256))
        print("wrote %s (256, then 32 and 16 blown up)"
              % os.path.relpath(PREVIEW, os.path.join(HERE, os.pardir, os.pardir)))


if __name__ == "__main__":
    main()
