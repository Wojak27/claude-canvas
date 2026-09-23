#!/usr/bin/env python3
"""Crop the raw captures down to the parts of the board each shot is about."""
import os, sys
from PIL import Image

work, out = sys.argv[1], sys.argv[2]


def trim_bottom(img, bg_tol=6):
    """Drop the empty background strip under the last card."""
    w, h = img.size
    px = img.convert("RGB").load()
    bg = px[w - 2, h - 2]
    last = h - 1
    for y in range(h - 1, 0, -1):
        row_bg = all(abs(px[x, y][c] - bg[c]) <= bg_tol for x in range(0, w, 7) for c in range(3))
        if not row_bg:
            last = y
            break
    return img.crop((0, 0, w, min(h, last + 24)))


hero = trim_bottom(Image.open(os.path.join(work, "hero.png")))
hero.save(os.path.join(out, "board.png"))

light = trim_bottom(Image.open(os.path.join(work, "light.png")))
light.save(os.path.join(out, "board-light.png"))

def gaps(img, tol=6):
    """Rows that are page background all the way across — the seams between blocks."""
    w, h = img.size
    px = img.convert("RGB").load()
    bg = px[w - 2, h - 2]
    return [y for y in range(h)
            if all(abs(px[x, y][c] - bg[c]) <= tol for x in range(2, w - 2, 9) for c in range(3))]


def snap(gs, target, lo, hi):
    """Nearest seam to `target`, within [lo, hi]."""
    inrange = [g for g in gs if lo <= g <= hi]
    return min(inrange, key=lambda g: abs(g - target)) if inrange else target


s = hero.size[0] / 485.0            # device px per CSS px
gs = gaps(hero)

# Tasks block on its own: top down to the seam under it
end = snap(gs, int(360 * s), int(330 * s), int(420 * s))
hero.crop((0, 0, hero.size[0], end)).save(os.path.join(out, "tasks.png"))

# The feed: from the seam above the first card to the seam after the second
top = snap(gs, int(520 * s), int(470 * s), int(560 * s))
bot = snap(gs, int(1180 * s), int(1100 * s), int(1320 * s))
hero.crop((0, top, hero.size[0], min(hero.size[1], bot))).save(os.path.join(out, "cards.png"))

# Animation frames, all padded to the tallest so the GIF does not jump
frames = [trim_bottom(Image.open(os.path.join(work, "frame%d.png" % i))) for i in range(5)]
H = max(f.size[1] for f in frames)
W = frames[0].size[0]
bg = frames[0].convert("RGB").load()[W - 2, frames[0].size[1] - 2]
order = [0, 1, 2, 3, 4, 4]  # hold the final state a beat longer
for n, idx in enumerate(order):
    canvas = Image.new("RGB", (W, H), bg)
    canvas.paste(frames[idx], (0, 0))
    canvas.save(os.path.join(work, "anim%d.png" % n))
print("cropped %d stills + %d frames" % (4, len(order)))
