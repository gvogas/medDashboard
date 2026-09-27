"""Draws public/wordmark.gif, the slow teal shimmer behind the "Rounds" wordmark on the
sign-in card (TextGif clips it to the letters). A seamless loop: every moving term below
is periodic over the frame count. Run: python scripts/make-wordmark-gif.py (needs Pillow).
"""
import math
from pathlib import Path

from PIL import Image

W, H = 240, 90
FRAMES = 28
FRAME_MS = 125  # 3.5 s a loop: slow enough to read as a shimmer, not a flicker
LEVELS = 48     # colours in the shared palette; smooth enough, and it compresses well

# Rounds teals, with a short pass through the blue; the last stop wraps to the first.
STOPS = [
    (0.00, "#0E7C74"),
    (0.22, "#17B3AE"),
    (0.40, "#7FD8CE"),
    (0.55, "#3FBFB2"),
    (0.72, "#1E628F"),
    (0.84, "#17B3AE"),
    (1.00, "#0E7C74"),
]


def rgb(hex_):
    return tuple(int(hex_[i:i + 2], 16) for i in (1, 3, 5))


def colour(u):
    """The cyclic gradient at u (wraps at 1), eased between stops."""
    u %= 1.0
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if a <= u <= b:
            t = (u - a) / (b - a)
            t = t * t * (3 - 2 * t)
            ca, cb = rgb(ca), rgb(cb)
            return tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))
    return rgb(STOPS[0][1])


palette = [colour(i / LEVELS) for i in range(LEVELS)]
flat = [c for p in palette for c in p] + [0] * (768 - 3 * LEVELS)

frames = []
for f in range(FRAMES):
    t = f / FRAMES
    img = Image.new("P", (W, H))
    img.putpalette(flat)
    px = img.load()
    for y in range(H):
        for x in range(W):
            # a diagonal band drifting one full cycle per loop, bent by a gentle wave
            u = (x + 0.9 * y) / 330 - t
            u += 0.06 * math.sin(2 * math.pi * (y / H * 0.8 + x / W * 0.5 + t))
            px[x, y] = int((u % 1.0) * LEVELS) % LEVELS
    frames.append(img)

out = Path(__file__).resolve().parent.parent / "public" / "wordmark.gif"
frames[0].save(out, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0,
               optimize=False, disposal=1)
print(f"{out} {out.stat().st_size / 1024:.1f} KB, {FRAMES} frames")
