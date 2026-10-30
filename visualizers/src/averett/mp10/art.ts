// Our own pictures for the public build of Energy Bliss. The DLL decodes JPEG resources (its sky backdrop and two
// clouds) and lays them out with GDI+; none of them ship here. These are drawn by our own code at the sizes the engine
// lays them out at: a sky from deep blue to a pale horizon glow, the strip behind the equalizer panel scaled from it,
// and two soft cloud banks, white on black (the engine turns brightness into the clouds' alpha, as the DLL does).
import type { Mp10Art, Mp10Picture } from './engine';

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** the sky: w x h BGRA (alpha 0xff), a vertical gradient with a warm glow low in the middle */
function sky(w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / w, dy = t - 0.78, g = Math.exp(-(dx * dx * 6 + dy * dy * 18));
      const i = (y * w + x) * 4;
      o[i] = clamp(120 + 110 * t + 40 * g);            // b
      o[i + 1] = clamp(40 + 150 * t + 70 * g);          // g
      o[i + 2] = clamp(18 + 120 * t * t + 120 * g);     // r
      o[i + 3] = 255;
    }
  }
  return o;
}
/** rows [y0, y0 + sh) of a w-wide picture scaled to dw x dh (bilinear) */
function strip(src: Uint8Array, w: number, y0: number, sh: number, dw: number, dh: number): Uint8Array {
  const o = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const fx = Math.min(w - 1, (x + 0.5) * w / dw - 0.5), fy = Math.min(sh - 1, (y + 0.5) * sh / dh - 0.5);
    const x0 = Math.max(0, Math.floor(fx)), y0b = Math.max(0, Math.floor(fy)), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(sh - 1, y0b + 1);
    const ax = Math.max(0, fx - x0), ay = Math.max(0, fy - y0b);
    for (let c = 0; c < 4; c++) {
      const p = (yy: number, xx: number): number => src[((y0 + yy) * w + xx) * 4 + c];
      const v = (p(y0b, x0) * (1 - ax) + p(y0b, x1) * ax) * (1 - ay) + (p(y1, x0) * (1 - ax) + p(y1, x1) * ax) * ay;
      o[(y * dw + x) * 4 + c] = Math.round(v);
    }
  }
  return o;
}

/** value noise on a 2D lattice, smooth, in 0..1 */
function noise(seed: number): (x: number, y: number) => number {
  const hash = (i: number, j: number): number => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;
  };
}
const CLOUD = 500;
/** cloud k: 500 x 500 (half: 500 x 250, the same picture squashed), white puffs fading to black at the edges */
function cloud(k: number, half: boolean): Mp10Picture {
  const n = noise(k), w = CLOUD, h = half ? CLOUD >> 1 : CLOUD, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = (half ? y * 2 : y) / CLOUD;
    let f = 0, a = 0.5, s = 4;
    for (let o = 0; o < 5; o++, a *= 0.5, s *= 2) f += a * n(u * s + k * 7, v * s);
    const r = Math.hypot(u - 0.5, (v - 0.5) * 1.6) * 2;           // 0 at the middle, 1 at the edge
    const e = Math.max(0, 1 - r * r);
    const c = clamp(Math.round(255 * Math.min(1, Math.max(0, (f - 0.42) * 2.6) * e)));
    const i = (y * w + x) * 4;
    px[i] = c; px[i + 1] = c; px[i + 2] = c; px[i + 3] = 255;
  }
  return { w, h, px };
}

const memo = new Map<string, Mp10Picture>();
export const ownArt: Mp10Art = {
  background(w, h) {
    const s = sky(w, h), rows = Math.min(h, Math.max(1, Math.round(122 / 600 * w)));
    return { sky: s, band: strip(s, w, h - rows, rows, 600, 122), bandHd: strip(s, w, h - rows, rows, 1200, 244) };
  },
  cloud(k, half) {
    const key = `${k}${half}`;
    let p = memo.get(key);
    if (!p) memo.set(key, (p = cloud(k, half)));
    return p;
  },
};
