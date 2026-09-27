#!/usr/bin/env python3
"""Render assets/icon.svg's artwork to assets/icon.ico (the exe icon).

Drawn with PIL rather than rasterised from the SVG: this machine has no SVG rasteriser
(no cairosvg, no rsvg-convert, and ImageMagick's built-in MSVG mangles radial gradients).
The geometry below is the same 256-unit box the SVG uses, so the two stay in step.

    python3 assets/make_icon.py
"""
from PIL import Image, ImageDraw, ImageFilter

SS = 8                      # supersample: one 2048 px master, downscaled to every size
BOX = 256
SIZES = [16, 24, 32, 48, 64, 128, 256]
OUT = __file__.rsplit("/", 1)[0]

C = 128, 128                # orb centre
R = 120                     # orb radius
FOCUS = 90, 82              # where the highlight sits (35%, 32%), as in the SVG
STOPS = [(0.0, (0xBF, 0xDD, 0xFF)), (0.25, (0x6B, 0xA9, 0xF5)),
         (0.60, (0x2A, 0x6F, 0xE0)), (1.0, (0x12, 0x41, 0x7F))]
RIM = (0x08, 0x23, 0x4F)
RING = (0x8F, 0xC4, 0xFF)
TRIANGLE = [(108, 84), (108, 172), (184, 128)]   # white play arrow, right of centre


def at(t):
    """The gradient colour at 0..1."""
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = 0 if b == a else (t - a) / (b - a)
            return tuple(round(x + (y - x) * k) for x, y in zip(ca, cb))
    return STOPS[-1][1]


def px(p, s=SS):
    return tuple(v * s for v in p)


def master():
    s = BOX * SS
    orb = Image.new("RGB", (s, s), at(1.0))
    d = ImageDraw.Draw(orb)
    fx, fy = px(FOCUS)
    far = int(((fx - C[0] * SS) ** 2 + (fy - C[1] * SS) ** 2) ** 0.5) + R * SS
    for r in range(far, 0, -1):   # concentric circles about the focus = a radial gradient
        d.ellipse([fx - r, fy - r, fx + r, fy + r], fill=at(r / far))

    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse(
        [(C[0] - R) * SS, (C[1] - R) * SS, (C[0] + R) * SS, (C[1] + R) * SS], fill=255)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(orb, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # Darker rim, then the thin lighter ring just inside it.
    d.ellipse([(C[0] - R) * SS, (C[1] - R) * SS, (C[0] + R) * SS, (C[1] + R) * SS],
              outline=RIM + (255,), width=3 * SS)
    d.ellipse([(C[0] - 104) * SS, (C[1] - 104) * SS, (C[0] + 104) * SS, (C[1] + 104) * SS],
              outline=RING + (150,), width=2 * SS)

    # The XP gloss: a soft white cap over the top third, blurred so it has no edge of its own.
    gloss = Image.new("L", (s, s), 0)
    ImageDraw.Draw(gloss).ellipse([36 * SS, 20 * SS, 220 * SS, 124 * SS], fill=110)
    gloss = gloss.filter(ImageFilter.GaussianBlur(6 * SS))
    img.paste(Image.new("RGBA", (s, s), (255, 255, 255, 255)),
              (0, 0), Image.composite(gloss, Image.new("L", (s, s), 0), mask))

    ImageDraw.Draw(img).polygon([px(p) for p in TRIANGLE], fill=(255, 255, 255, 255))
    return img


if __name__ == "__main__":
    m = master()
    pngs = [m.resize((n, n), Image.LANCZOS) for n in SIZES]
    for n, p in zip(SIZES, pngs):
        p.save(f"{OUT}/icon-{n}.png")
    pngs[-1].save(f"{OUT}/icon.ico", sizes=[(n, n) for n in SIZES])
    print("wrote icon.ico", SIZES)
