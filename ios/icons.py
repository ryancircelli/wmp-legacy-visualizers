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
from PIL import Image

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

# ---- chrome: the orb as polished, inflated chrome (the owner, 2026-10-05: "more metallic", "anodized/coloured
# chrome", a chrome star for "this kind of shinyness", then "no peaks… rubber on top… blowing it up like a
# balloon", "more chrome", "true color", "decrease the background brightness", the lines 15% thinner, and
# the reflections of a real studio). Made once from the source and laid over every colour.
STUDIO = os.path.join(ROOT, 'icon-studio.hdr')   # Poly Haven's "photo_studio_loft_hall", 1k, CC0 (polyhaven.com)
THIN = 4.6          # px off each side of the lines (74, 62 and 49 px thick at 1024: about 15% thinner)
INFLATE = 120       # the balloon's height, px
YAW, EXPOSURE = 0.25, 10.0   # the studio turned a quarter, and how bright it is
GROUND = 0.35       # the tile round the orb, toward black
INF = 1e12

def edt1d(f):
    """Felzenszwalb-Huttenlocher squared distance transform of one row"""
    n = len(f); d = [0.0] * n; v = [0] * n; z = [0.0] * (n + 1); k = 0; z[0], z[1] = -INF, INF
    for q in range(1, n):
        while True:
            p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p)
            if s <= z[k]: k -= 1; continue
            break
        k += 1; v[k] = q; z[k] = s; z[k + 1] = INF
    k = 0
    for q in range(n):
        while z[k + 1] < q: k += 1
        d[q] = (q - v[k]) ** 2 + f[v[k]]
    return d

def inside_distance(mask, n):
    """each pixel's distance (px) to the nearest pixel outside `mask`"""
    f = [INF if m else 0.0 for m in mask]
    for y in range(n): f[y * n:(y + 1) * n] = edt1d(f[y * n:(y + 1) * n])
    for x in range(n):
        col = edt1d(f[x::n])
        for y in range(n): f[y * n + x] = col[y]
    return [math.sqrt(v) for v in f]

def blur(a, n, r, passes=2):
    """box blurs in floats (about a Gaussian): an 8-bit blur's steps showed as lines in the reflections"""
    for _ in range(passes):
        b = [0.0] * (n * n)
        for y in range(n):
            c = [0.0]
            for v in a[y * n:(y + 1) * n]: c.append(c[-1] + v)
            for x in range(n):
                lo, hi = max(0, x - r), min(n, x + r + 1); b[y * n + x] = (c[hi] - c[lo]) / (hi - lo)
        a = [0.0] * (n * n)
        for x in range(n):
            c = [0.0]
            for y in range(n): c.append(c[-1] + b[y * n + x])
            for y in range(n):
                lo, hi = max(0, y - r), min(n, y + r + 1); a[y * n + x] = (c[hi] - c[lo]) / (hi - lo)
    return a

def inflate(region, n):
    """A rubber sheet held at 0 on every edge of `region` and blown up by an even pressure: Poisson's
    equation, solved coarse to fine (SOR). Smooth everywhere, highest midway between edges: no ridges."""
    def down(a, m, f):
        out = [0.0] * ((m // f) ** 2); k = m // f
        for y in range(k):
            for x in range(k):
                out[y * k + x] = sum(a[yy * m + xx] for yy in range(y * f, (y + 1) * f) for xx in range(x * f, (x + 1) * f)) / (f * f)
        return out
    def up(a, m):
        k = 2 * m; out = [0.0] * (k * k)
        for y in range(k):
            fy = (y + 0.5) / 2 - 0.5; y0 = max(0, min(m - 1, math.floor(fy))); y1 = min(m - 1, y0 + 1); ty = max(0.0, min(1.0, fy - y0))
            for x in range(k):
                fx = (x + 0.5) / 2 - 0.5; x0 = max(0, min(m - 1, math.floor(fx))); x1 = min(m - 1, x0 + 1); tx = max(0.0, min(1.0, fx - x0))
                out[y * k + x] = (a[y0 * m + x0] * (1 - tx) + a[y0 * m + x1] * tx) * (1 - ty) + (a[y1 * m + x0] * (1 - tx) + a[y1 * m + x1] * tx) * ty
        return out
    h = None
    for m, f, sweeps in ((n // 8, 8, 400), (n // 4, 4, 160), (n // 2, 2, 70), (n, 1, 20)):
        inside = [v > 0.5 for v in (down(region, n, f) if f > 1 else region)]
        h = [0.0] * (m * m) if h is None else up(h, m // 2)
        idx = [i for i in range(m * m) if inside[i] and m <= i < m * m - m and 0 < i % m < m - 1]
        for i in range(m * m):
            if not inside[i]: h[i] = 0.0
        for _ in range(sweeps):
            for i in idx: h[i] += 1.85 * ((h[i - 1] + h[i + 1] + h[i - m] + h[i + m] + f * f) * 0.25 - h[i])
    return h

def read_hdr(path):
    """Radiance RGBE (new run-length scanlines) -> (width, height, luminance per pixel)"""
    data = open(path, 'rb').read(); i = 0
    while True:
        j = data.index(b'\n', i); line = data[i:j]; i = j + 1
        if not line.strip(): break
    j = data.index(b'\n', i); res = data[i:j].split(); i = j + 1
    h, w = int(res[1]), int(res[3]); lum = [0.0] * (w * h)
    for y in range(h):
        i += 4; ch = [bytearray(w) for _ in range(4)]
        for c in range(4):
            x = 0
            while x < w:
                n = data[i]; i += 1
                if n > 128: n -= 128; ch[c][x:x + n] = bytes([data[i]]) * n; i += 1
                else: ch[c][x:x + n] = data[i:i + n]; i += n
                x += n
        r, g, b, e = ch
        for x in range(w):
            if e[x]: lum[y * w + x] = (0.2126 * r[x] + 0.7152 * g[x] + 0.0722 * b[x]) * math.ldexp(1.0, e[x] - 136)
    return w, h, lum

def chrome_map(src):
    """(the orb's mask, its chrome 0..255): the orb with its lines thinned, inflated, and mirroring the studio"""
    n = int(math.sqrt(len(src))); cx = cy = n / 2
    lines = [0] * (n * n)
    for i, p in enumerate(src):
        h, l, s = colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)
        lines[i] = 1 if (l < 0.30 and s < 0.35 and math.hypot(i % n - cx, i // n - cy) < 0.97 * 409 * n / 1024) else 0
    rad = 409 * n / 1024                       # the orb's radius in the source drawing
    thin = [max(0.0, min(1.0, d - THIN + 0.5)) for d in inside_distance(lines, n)]   # the thinner lines, antialiased
    circ = [max(0.0, min(1.0, rad - math.hypot(i % n - cx, i // n - cy) + 0.5)) for i in range(n * n)]
    region = [1.0 if c > 0.5 and t < 0.5 else 0.0 for c, t in zip(circ, thin)]
    h = inflate(region, n); top = max(h)
    h = blur([INFLATE * (max(0.0, v) / top) ** 0.5 for v in h], n, 2)    # the square root rounds its edges
    ew, eh, env = read_hdr(STUDIO)
    env = blur_env(env, ew, eh, 2)
    out = [0] * (n * n)
    for y in range(1, n - 1):
        for x in range(1, n - 1):
            i = y * n + x
            gx, gy = (h[i + 1] - h[i - 1]) * 0.5, (h[i + n] - h[i - n]) * 0.5
            k = math.sqrt(gx * gx + gy * gy + 1); nx, ny, nz = -gx / k, -gy / k, 1 / k
            X, Y, Z = 2 * nz * nx, -2 * nz * ny, 2 * nz * nz - 1        # the view mirrored off the surface
            u = (math.atan2(X, -Z) / (2 * math.pi) + 0.5 + YAW) % 1.0
            v = 0.5 - math.asin(max(-1.0, min(1.0, Y))) / math.pi
            q = env[min(eh - 1, int(v * eh)) * ew + min(ew - 1, int(u * ew))] * EXPOSURE
            out[i] = round(255 * (q / (1 + q)) ** (1 / 1.2))
    mask, g = Image.new('L', (n, n)), Image.new('L', (n, n))
    mask.putdata([round(255 * c * (1 - t)) for c, t in zip(circ, thin)]); g.putdata(out)
    return mask, g

def blur_env(env, w, h, r):
    """the studio a little soft (polished, not a perfect mirror); wraps round in longitude"""
    for _ in range(2):
        b = [sum(env[y * w + (x + d) % w] for d in range(-r, r + 1)) / (2 * r + 1) for y in range(h) for x in range(w)]
        env = [0.0] * (w * h)
        for y in range(h):
            for x in range(w):
                ys = [yy for yy in range(y - r, y + r + 1) if 0 <= yy < h]
                env[y * w + x] = sum(b[yy * w + x] for yy in ys) / len(ys)
    return env

def chrome(base, mask, g, h, s, l):
    """`base` with its orb in chrome of the colour itself (its full saturation, a little paler only in the
    brightest light; the chrome's light scaled round the colour's own value), the tile round it darker"""
    r, gr, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    hh, ss, vv = colorsys.rgb_to_hsv(r, gr, b)
    sat = g.point(lambda q: round(255 * ss * (1 - 0.45 * max(0.0, (q / 255 - 0.82) / 0.18))))
    val = g.point(lambda q: round(255 * min(1.0, 0.02 + q / 255 * (0.10 + 1.15 * vv) + 0.25 * max(0.0, (q / 255 - 0.86) / 0.14))))
    orb = Image.merge('HSV', (Image.new('L', base.size, round(255 * hh)), sat, val)).convert('RGB')
    return Image.composite(orb, base.point(lambda c: round(c * GROUND)), mask)

def main():
    im = Image.open(SRC).convert('RGB')
    src = list(im.getdata())
    # the source orb's own colour: the median of its well coloured pixels
    hls = sorted(colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255) for p in src[::97])
    col = [x for x in hls if x[2] > 0.5]
    mid = lambda i: sorted(x[i] for x in col)[len(col) // 2]
    ref = (mid(0) * 360, mid(2) * 100, mid(1) * 100)
    mask, g = chrome_map(src)
    want = {name: (h, min(100, s * LOOK), min(72, l * LOOK)) for name, (h, s, l) in presets().items()}
    for h in HUES:
        for l in LIGHTS: want['c-h%03d-l%d' % (h, l)] = (h, 80, l)
    for l in GREYS: want['c-grey-l%d' % l] = (0, 0, l)
    for name, (h, s, l) in list(want.items()) + [('', want['green'])]:   # '': the app's own icon, the default colour's
        d = os.path.join(ASSETS, 'Icon-%s.appiconset' % name if name else 'AppIcon.appiconset')
        os.makedirs(d, exist_ok=True)
        out = Image.new('RGB', im.size)
        out.putdata(recolour(src, ref, h, s, l))
        out = chrome(out, mask, g, h, s, l)
        out.save(os.path.join(d, 'icon-1024.png'), optimize=True)
        json.dump({'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
                   'info': {'author': 'xcode', 'version': 1}}, open(os.path.join(d, 'Contents.json'), 'w'), indent=2)
    print('icons: %d from %s (the orb at %.0f° %.0f%% %.0f%%)' % (len(want), os.path.basename(SRC), *ref))
    return 0

if __name__ == '__main__':
    sys.exit(main())
