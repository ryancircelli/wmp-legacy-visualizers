// Grind's pictures, our own. The DLL reads film stills (Grind_Media\Foreground), a cast backdrop (Background) and the
// film's road sign with two buttons (Grind_logo), all the studio's art, plus a particle sprite from its resources.
// The port paints its own in their place: skate-park scenes (a sky, a ramp, the sun, a rider's arc of dots) as the
// photos, a halftone dusk as the backdrop, a diamond road sign bearing our own wheel mark, and two plain buttons.
// Sizes follow the DLL's media (photos 498 x 326, backdrop 221 x 174, sign and button sheets 150 x 155).
import type { Picture } from '../../pictureviz/picture';
import { ownParticle } from '../../pictureviz/pv3/art';
import type { ArgbPicture } from './core';
import type { GrindArt } from './index';

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** photo n of 8: a sky graded by the hour, a quarter-pipe, the sun and a rider's jump traced in dots */
function photo(n: number, w = 498, h = 326): Picture {
  const rgb = new Uint8Array(w * h * 3);
  const skyTop = [[40, 90, 170], [250, 140, 60], [90, 40, 120], [20, 120, 160]][n % 4];
  const skyLow = [[150, 200, 240], [255, 210, 150], [230, 120, 120], [170, 230, 220]][n % 4];
  const sunX = w * (0.2 + 0.08 * n), sunY = h * (0.22 + 0.03 * (n % 3)), sunR = h * 0.08;
  const rampL = n % 2 === 0, x0 = w * (0.15 + 0.05 * (n % 3)), jumpH = h * (0.25 + 0.04 * (n % 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, t = y / h;
    let r = mix(skyTop[0], skyLow[0], t), g = mix(skyTop[1], skyLow[1], t), b = mix(skyTop[2], skyLow[2], t);
    const ds = Math.hypot(x - sunX, y - sunY);
    if (ds < sunR) { r = 255; g = 240; b = 200; } else if (ds < sunR * 2) { const k = 1 - (ds - sunR) / sunR; r += (255 - r) * k * 0.4; g += (230 - g) * k * 0.4; }
    const u = (rampL ? x : w - 1 - x) / w;
    const ground = h * 0.78, curve = u < 0.3 ? ground - h * 0.35 * Math.pow(1 - u / 0.3, 2) : ground;
    if (y > curve) { const k = (y - curve) / h; r = 110 - 40 * k; g = 112 - 40 * k; b = 120 - 30 * k; if (Math.abs(y - curve) < 2) { r = 230; g = 230; b = 235; } }
    if (y > h * 0.93) { r = 60; g = 60; b = 66; }
    rgb[i] = clamp(r); rgb[i + 1] = clamp(g); rgb[i + 2] = clamp(b);
  }
  for (let k = 0; k <= 24; k++) {                         // the jump: a dotted parabola and the rider at its top
    const s = k / 24, px = x0 + s * w * 0.6, py = h * 0.72 - jumpH * 4 * s * (1 - s), rad = k === 12 ? 9 : 2.5;
    for (let y = Math.floor(py - rad); y <= py + rad; y++) for (let x = Math.floor(px - rad); x <= px + rad; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || Math.hypot(x - px, y - py) > rad) continue;
      const i = (y * w + x) * 3;
      rgb[i] = k === 12 ? 25 : 250; rgb[i + 1] = k === 12 ? 25 : 250; rgb[i + 2] = k === 12 ? 35 : 250;
    }
  }
  return { w, h, rgb };
}

/** the backdrop: a grey dusk under a halftone of dots growing toward the bottom */
function backdrop(w = 221, h = 174): Picture {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, t = y / h;
    const dot = Math.hypot((x % 9) - 4, (y % 9) - 4) < 0.5 + 3 * t ? 1 : 0;
    const v = clamp(mix(70, 150, t) + (dot ? 45 : 0) - 25 * Math.abs(x / w - 0.5));
    rgb[i] = v; rgb[i + 1] = v; rgb[i + 2] = clamp(v + 8);
  }
  return { w, h, rgb };
}

const SW = 150, SH = 155;
/** a 150 x 155 sheet with alpha: `paint(x, y)` gives [b, g, r, a] or null */
function sheet(paint: (x: number, y: number) => number[] | null): ArgbPicture {
  const bgra = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const c = paint(x, y);
    if (c) bgra.set(c, (y * SW + x) * 4);
  }
  return { w: SW, h: SH, bgra };
}
/** our mark: a yellow diamond sign with a dark rim and a spoked wheel */
function sign(): ArgbPicture {
  const cx = SW / 2, cy = 70, R = 68;
  return sheet((x, y) => {
    const d = (Math.abs(x - cx) + Math.abs(y - cy)) / R;
    if (d > 1) return null;
    if (d > 0.9) return [20, 20, 20, 255];
    const rr = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
    const wheel = (rr > 22 && rr < 28) || rr < 6 || (rr < 24 && Math.abs(Math.sin(a * 3)) < 0.12);
    return wheel ? [30, 30, 30, 255] : [0, clamp(200 - d * 30), 250, 255];
  });
}
/** a button on the sheet's lower part (row y0), lighter when hovered */
function button(y0: number, hover: boolean): ArgbPicture {
  return sheet((x, y) => {
    if (y < y0 || y > y0 + 13 || x < 45 || x > 104) return null;
    const edge = y === y0 || y === y0 + 13 || x === 45 || x === 104;
    const v = hover ? 255 : 220;
    return edge ? [0, 120, 0, 255] : [0, v, v, 255];
  });
}

export function ownArt(): GrindArt {
  const photos: Picture[] = [];
  for (let n = 0; n < 8; n++) photos.push(photo(n));
  return {
    photos, background: [backdrop()],
    logos: [sign(), button(98, false), button(98, true), button(115, false), button(115, true)],
    particle: ownParticle(),
  };
}
