#!/usr/bin/env python3
"""The app's icons, one per body colour, drawn from the one source icon, ios/icon-source.png (the owner, 2026-10-03:
"have the icon change with theme color… shouldn't hardcode these images"). iOS takes alternate icons
only from the bundle, never drawn at run time, so they are made here at build time (ios.yml, before
xcodegen): each preset of src/skins/ipod/settings.ts COLORS (read from the file: no second table), and
for Custom a grid the page snaps to (src/skins/ipod/icon.ts: the same HUES, LIGHTS and GREYS).

  python3 ios/icons.py            writes ios/WmpSpotify/Assets.xcassets/Icon-<name>.appiconset/ and, in the
                                  default body colour (green), AppIcon.appiconset's own
Needs Pillow."""
import colorsys, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'WmpSpotify', 'Assets.xcassets')
SRC = os.path.join(ROOT, 'icon-source.png')   # the one drawing every icon is a recolouring of (the owner's, 2026-10-03)
LOOK = 1.15                       # settings.ts LOOK: a preset's numbers are its base, lifted by the lights
HUES = range(0, 360, 30)          # Custom's grid: icon.ts has the same
LIGHTS = (35, 55)
GREYS = (25, 50, 72)
# An alternate icon is only ever drawn at these sizes (iPhone and iPad: notifications, Settings, Spotlight, the
# home screen; points × scale). Handed the one 1024 px image instead, the asset compiler kept that copy beside
# them in every set: 0.7 MB a colour, 27 of the app's 36 MB (build 60). The app's own icon keeps its 1024 (the
# App Store's), drawn from it at every size by the compiler.
ALT = [('iphone', '20x20', 2), ('iphone', '20x20', 3), ('iphone', '29x29', 2), ('iphone', '29x29', 3),
       ('iphone', '40x40', 2), ('iphone', '40x40', 3), ('iphone', '60x60', 2), ('iphone', '60x60', 3),
       ('ipad', '20x20', 2), ('ipad', '29x29', 2), ('ipad', '40x40', 2), ('ipad', '76x76', 2), ('ipad', '83.5x83.5', 2)]

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

def main():
    im = Image.open(SRC).convert('RGB')
    src = list(im.getdata())
    # the source orb's own colour: the median of its well coloured pixels
    hls = sorted(colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255) for p in src[::97])
    col = [x for x in hls if x[2] > 0.5]
    mid = lambda i: sorted(x[i] for x in col)[len(col) // 2]
    ref = (mid(0) * 360, mid(2) * 100, mid(1) * 100)
    want = {name: (h, min(100, s * LOOK), min(72, l * LOOK)) for name, (h, s, l) in presets().items()}
    for h in HUES:
        for l in LIGHTS: want['c-h%03d-l%d' % (h, l)] = (h, 80, l)
    for l in GREYS: want['c-grey-l%d' % l] = (0, 0, l)
    for name, (h, s, l) in list(want.items()) + [('', want['green'])]:   # '': the app's own icon, the default colour's
        d = os.path.join(ASSETS, 'Icon-%s.appiconset' % name if name else 'AppIcon.appiconset')
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):                       # a set made before (another size list) goes whole
            if f.endswith('.png'): os.remove(os.path.join(d, f))
        out = Image.new('RGB', im.size)
        out.putdata(recolour(src, ref, h, s, l))
        if not name:
            out.save(os.path.join(d, 'icon-1024.png'), optimize=True)
            images = [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}]
        else:
            images = []
            for idiom, size, scale in ALT:
                px = round(float(size.split('x')[0]) * scale)
                f = 'icon-%d.png' % px                    # one file per pixel size, shared by the slots that take it
                if not os.path.exists(os.path.join(d, f)):
                    out.resize((px, px), Image.LANCZOS).save(os.path.join(d, f), optimize=True)
                images.append({'filename': f, 'idiom': idiom, 'scale': '%dx' % scale, 'size': size})
        json.dump({'images': images, 'info': {'author': 'xcode', 'version': 1}}, open(os.path.join(d, 'Contents.json'), 'w'), indent=2)
    print('icons: %d from %s (the orb at %.0f° %.0f%% %.0f%%)' % (len(want), os.path.basename(SRC), *ref))
    return 0

if __name__ == '__main__':
    sys.exit(main())
