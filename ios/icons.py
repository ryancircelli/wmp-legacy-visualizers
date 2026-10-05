#!/usr/bin/env python3
"""The app's icons, one per body colour, drawn from the one source icon, ios/icon-source.png (the owner, 2026-10-03:
"have the icon change with theme color… shouldn't hardcode these images"). iOS takes alternate icons
only from the bundle, never drawn at run time, so they are made here at build time (ios.yml, before
xcodegen): each preset of src/skins/ipod/settings.ts COLORS (read from the file: no second table), and
for Custom a grid the page snaps to (src/skins/ipod/icon.ts: the same HUES, LIGHTS and GREYS).

  python3 ios/icons.py            writes ios/WmpSpotify/Assets.xcassets/Icon-<name>.appiconset/ and, in the
                                  default body colour (green), AppIcon.appiconset's own
Needs Pillow."""
import colorsys, json, math, os, re, sys
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'WmpSpotify', 'Assets.xcassets')
SRC = os.path.join(ROOT, 'icon-source.png')   # the one drawing every icon is a recolouring of (the owner's, 2026-10-03)
LOOK = 1.15                       # settings.ts LOOK: a preset's numbers are its base, lifted by the lights
HUES = range(0, 360, 30)          # Custom's grid: icon.ts has the same
LIGHTS = (35, 55)
GREYS = (25, 50, 72)

def presets():
    ts = open(os.path.join(ROOT, '..', 'src', 'skins', 'ipod', 'settings.ts')).read()
    body = ts[ts.index('export const COLORS'):]
    body = body[:body.index('};')]
    return {m[0]: (int(m[1]), int(m[2]), int(m[3])) for m in re.findall(r'(\w+): \[(\d+), (\d+), (\d+)\]', body)}

def recolour(src, ref, h, s, l):
    """The icon in another colour: each pixel keeps its own light and shade; its hue becomes h, its
    saturation and lightness scale by the target's over the source orb's, by how coloured it is (the white
    play mark, the highlight's core and the dark ground stay as they are)."""
    rs, rl, l = ref[1], ref[2] / 100, l / 100
    memo, out = {}, []
    for p in src:
        if p not in memo:
            ph, pl, ps = colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)
            w = min(1.0, ps / 0.4)
            # darker than the orb's own tone: scaled down with it; lighter: the room left above it scaled,
            # so a light colour's highlight keeps its shape (a plain multiply burnt it to a white blob)
            tl = pl * (l / rl) if pl <= rl or l <= rl else 1 - (1 - pl) * ((1 - l) / (1 - rl))
            nl = pl * (1 - w) + min(1.0, tl) * w
            ns = min(1.0, ps * (s / rs))
            r, g, b = colorsys.hls_to_rgb(h / 360, nl, ns)
            memo[p] = (round(r * 255), round(g * 255), round(b * 255))
        out.append(memo[p])
    return out

def chrome_map(w):
    """The orb as coloured chrome (the owner, 2026-10-05: "more metallic", "anodized/colored chrome"): the
    lightness a polished dome takes from what it mirrors, 0..255 over the orb (`w`, its mask): a sky
    brightest at the top fading to a horizon bowed by the dome, the darkest band just under it, a ground
    lit again toward the rim, a window's reflection right of centre in the sky, a shade at the rim and a
    glint upper left. Position only, so made once and laid over every colour."""
    l, t, r, b = w.point(lambda v: 255 if v > 128 else 0).getbbox()
    cx, cy, rad = (l + r) / 2, (t + b) / 2, (r - l) / 2
    n, out = w.size[0], []
    for y in range(n):
        v = (y - cy) / rad
        for x in range(n):
            u = (x - cx) / rad
            r2, e = u * u + v * v, v - 0.14 + 0.35 * u * u          # e > 0: below the horizon
            g = 0.60 + 0.30 * min(1.0, -e) ** 0.6 + 0.25 * math.exp(-((u - 0.52) / 0.09) ** 2) if e < 0 \
                else 0.20 + 0.52 * min(1.0, e / 0.85) ** 0.8
            if r2 > 0.72: g *= 1 - 0.35 * (r2 - 0.72) / 0.28
            g += 0.5 * math.exp(-(((u + 0.38) / 0.22) ** 2 + ((v + 0.42) / 0.10) ** 2))
            out.append(round(255 * max(0.0, min(1.0, g))))
    m = Image.new('L', w.size)
    m.putdata(out)
    return m.filter(ImageFilter.GaussianBlur(1.2))

def chrome(base, w, g, h, s, l):
    """`base` with its orb in chrome of the colour: its hue throughout (anodized: the glints tinted too, paler
    only at their brightest), its lightness the chrome's, scaled to the colour's own value."""
    r, gr, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    hh, ss, vv = colorsys.rgb_to_hsv(r, gr, b)
    sat = g.point(lambda q: round(255 * ss * (1 - 0.55 * max(0.0, (q / 255 - 0.8) / 0.2))))
    val = g.point(lambda q: round(255 * min(1.0, 0.04 + q / 255 * (0.35 + 0.95 * vv))))
    lay = Image.merge('HSV', (Image.new('L', base.size, round(255 * hh)), sat, val)).convert('RGB')
    return Image.composite(lay, base, w)

def main():
    im = Image.open(SRC).convert('RGB')
    src = list(im.getdata())
    # the source orb's own colour: the median of its well coloured pixels
    hls = sorted(colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255) for p in src[::97])
    col = [x for x in hls if x[2] > 0.5]
    mid = lambda i: sorted(x[i] for x in col)[len(col) // 2]
    ref = (mid(0) * 360, mid(2) * 100, mid(1) * 100)
    # the orb: where the source is coloured, weighted as recolour weights it
    w = Image.new('L', im.size)
    w.putdata([round(255 * min(1.0, colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)[2] / 0.4)) for p in src])
    g = chrome_map(w)
    want = {name: (h, min(100, s * LOOK), min(72, l * LOOK)) for name, (h, s, l) in presets().items()}
    for h in HUES:
        for l in LIGHTS: want['c-h%03d-l%d' % (h, l)] = (h, 80, l)
    for l in GREYS: want['c-grey-l%d' % l] = (0, 0, l)
    for name, (h, s, l) in list(want.items()) + [('', want['green'])]:   # '': the app's own icon, the default colour's
        d = os.path.join(ASSETS, 'Icon-%s.appiconset' % name if name else 'AppIcon.appiconset')
        os.makedirs(d, exist_ok=True)
        out = Image.new('RGB', im.size)
        out.putdata(recolour(src, ref, h, s, l))
        out = chrome(out, w, g, h, s, l)
        out.save(os.path.join(d, 'icon-1024.png'), optimize=True)
        json.dump({'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
                   'info': {'author': 'xcode', 'version': 1}}, open(os.path.join(d, 'Contents.json'), 'w'), indent=2)
    print('icons: %d from %s (the orb at %.0f° %.0f%% %.0f%%)' % (len(want), os.path.basename(SRC), *ref))
    return 0

if __name__ == '__main__':
    sys.exit(main())
