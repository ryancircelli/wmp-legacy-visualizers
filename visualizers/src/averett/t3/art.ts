// T3's pictures, our own. The DLL reads film stills (T3_Media\Foreground, one of them also the backdrop in
// \Background) and a button with its hover picture (T3_logo), all the studio's art, plus a particle sprite from its
// resources. The port paints its own: machine-age scenes (a night skyline under a burning sky, a floor grid running
// to the horizon, a chrome sphere with a red eye of light) as the photos and the backdrop, and a steel button.
// Each photo's name carries the transition the DLL's matching still names ("_T3_Trnn"), in the DLL's order; two of
// the DLL's names carry none (Transparency).
import type { Picture } from '../../pictureviz/picture';
import { ownParticle } from '../../pictureviz/pv3/art';
import type { ArgbPicture } from '../grind/core';
import type { GrindArt } from '../grind/index';

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** the transitions of the DLL's 13 stills, in their order (0: none) */
const TRANSITIONS = [26, 17, 33, 11, 27, 25, 30, 28, 24, 0, 31, 32, 0];

/** photo n: a sky from ember to night, a skyline of towers with lit windows, a perspective floor grid, a chrome
 *  sphere with a red light */
function photo(n: number, w = 400, h = n % 3 === 2 ? 300 : 320): Picture {
  const rgb = new Uint8Array(w * h * 3);
  const hor = h * (0.55 + 0.04 * (n % 3));
  const top = [[10, 12, 30], [30, 8, 10], [5, 20, 35]][n % 3], low = [[240, 90, 30], [200, 40, 20], [255, 150, 60]][n % 3];
  const sx = w * (0.25 + 0.06 * (n % 8)), sy = hor - h * 0.18, sr = h * (0.1 + 0.01 * (n % 4));
  let seed = 1 + n * 7919;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const towers: [number, number, number][] = [];         // x0, x1, top
  for (let x = 0; x < w;) { const tw = 12 + rnd() * 30; towers.push([x, x + tw, hor - h * (0.08 + rnd() * 0.3)]); x += tw + 2; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    let r: number, g: number, b: number;
    if (y < hor) {
      const t = Math.pow(y / hor, 1.6);
      r = mix(top[0], low[0], t); g = mix(top[1], low[1], t); b = mix(top[2], low[2], t);
      for (const [x0, x1, ty] of towers) {
        if (x < x0 || x >= x1 || y < ty) continue;
        const lit = (Math.floor((x - x0) / 4) + Math.floor(y / 6) * 3 + n) % 7 === 0 && (x - x0) % 4 < 2 && y % 6 < 3;
        r = lit ? 255 : 18; g = lit ? 200 : 16; b = lit ? 120 : 22;
        break;
      }
    } else {
      const d = (y - hor) / (h - hor), z = 1 / (d + 0.02);
      const gx = Math.abs((((x - w / 2) * d * 0.08) % 1 + 1) % 1 - 0.5) < 0.06, gz = Math.abs(((z * 0.6) % 1) - 0.5) < 0.08 * d + 0.02;
      const v = 20 + 30 * d;
      r = gx || gz ? 255 * (0.3 + 0.7 * d) : v; g = gx || gz ? 60 * d : v * 0.6; b = gx || gz ? 40 * d : v * 0.8;
    }
    const ds = Math.hypot(x - sx, y - sy);
    if (ds < sr) {                                         // the sphere: a lit chrome ball and its eye
      const nx = (x - sx) / sr, ny = (y - sy) / sr, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const l = Math.max(0, -0.5 * nx - 0.6 * ny + 0.62 * nz), sp = Math.pow(l, 24);
      const env = ny < 0 ? 60 + 120 * (1 + ny) : 40;
      r = env * 0.6 + 180 * l + 255 * sp; g = env * 0.6 + 170 * l + 255 * sp; b = env * 0.7 + 190 * l + 255 * sp;
      const de = Math.hypot(nx - 0.15, ny + 0.05);
      if (de < 0.18) { const k = 1 - de / 0.18; r = mix(r, 255, k); g = mix(g, 20, k); b = mix(b, 10, k); }
    }
    rgb[i] = clamp(r); rgb[i + 1] = clamp(g); rgb[i + 2] = clamp(b);
  }
  return { w, h, rgb };
}

/** the button, 214 x 66 like the DLL's: brushed steel with a red bar and a rim, the hover lit */
function button(hover: boolean, w = 214, h = 66): ArgbPicture {
  const bgra = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, rim = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
    const steel = 120 + 60 * Math.sin(y * 0.35) * 0.3 + 40 * (1 - y / h) + ((x * 7 + y * 13) % 11) - 5;
    const bar = y > h * 0.4 && y < h * 0.6 && x > w * 0.12 && x < w * 0.88;
    let r = steel, g = steel, b = steel + 8;
    if (bar) { r = hover ? 255 : 190; g = hover ? 70 : 30; b = hover ? 50 : 20; }
    if (rim) { r = 30; g = 30; b = 34; }
    bgra[i] = clamp(b); bgra[i + 1] = clamp(g); bgra[i + 2] = clamp(r); bgra[i + 3] = 255;
  }
  return { w, h, bgra };
}

export function ownArt(): GrindArt {
  const photos = TRANSITIONS.map((_, n) => photo(n));
  const names = TRANSITIONS.map((t, n) => 'Machine' + String(n + 1).padStart(2, '0') + (t ? '_T3_Tr' + t : '') + '.jpg');
  return { photos, names, background: [photo(1)], logos: [button(false), button(true)], particle: ownParticle() };
}
