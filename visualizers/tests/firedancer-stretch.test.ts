// @vitest-environment node
// Fire Dancer's present (src/blackfly/stretch.ts): the fast tables against a direct, per-pixel reading of the same
// rules, plus the layout (bars, clipping) and the special cases. Synthetic images only.
import { describe, expect, it } from 'vitest';
import { stretchPresent } from '../src/blackfly/stretch';
import { delphiRound } from '../src/blackfly/common';

let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const noise = () => Uint8Array.from({ length: 320 * 384 }, () => (rnd() * 256) | 0);
const palette = () => Uint32Array.from({ length: 256 }, () => (rnd() * 2 ** 24) >>> 0);
const run = (idx: Uint8Array, pal: Uint32Array, W: number, H: number) => {
  const out = new Uint32Array(W * H).fill(0xabcdef);
  stretchPresent(idx, pal, W, H, out);
  return out;
};
const layout = (W: number, H: number) => {
  const dw = delphiRound((320 * H) / 384);
  return { dw, dx: Math.trunc((W - dw) / 2) };
};

/** the HALFTONE rules written out per pixel, straight from the comment in stretch.ts */
function halftoneRef(idx: Uint8Array, pal: Uint32Array, W: number, H: number): Uint32Array {
  const { dw, dx } = layout(W, H), out = new Uint32Array(W * H);
  const w = (s: number, d: number, S: number, D: number) => {
    const E = (t: number) => Math.floor((t * D * 8192) / S);
    return Math.max(0, Math.min((d + 1) * 8192, E(s + 1)) - Math.max(d * 8192, E(s)));
  };
  const hs = new Map<number, number>();
  const h = (c: number, sy: number, d: number) => {           // a source row averaged across, an integer
    const k = (c * 384 + sy) * dw + d;
    let r = hs.get(k);
    if (r === undefined) {
      r = 4096;
      for (let sx = 0; sx < 320; sx++) r += w(sx, d, 320, dw) * ((pal[idx[sy * 320 + sx]!]! >> (16 - 8 * c)) & 255);
      hs.set(k, (r >>= 13));
    }
    return r;
  };
  const v = (c: number, y: number, d: number) => {           // then down, 1/8192 units
    let sum = 0;
    for (let sy = 0; sy < 384; sy++) {
      const wy = w(sy, y, 384, H);
      if (wy) sum += wy * h(c, sy, d);
    }
    return sum;
  };
  for (let y = 0; y < H; y++) for (let x = Math.max(0, dx); x < Math.min(W, dx + dw); x++) {
    const d = x - dx;
    let px = 0;
    for (let c = 0; c < 3; c++) {
      const q = Math.floor((12 * v(c, y, d) - v(c, Math.max(0, y - 1), d) - v(c, Math.min(H - 1, y + 1), d)
        - v(c, y, Math.max(0, d - 1)) - v(c, y, Math.min(dw - 1, d + 1))) / 65536);
      px |= Math.min(255, Math.max(0, q)) << (16 - 8 * c);
    }
    out[y * W + x] = px;
  }
  return out;
}

describe('Fire Dancer stretch', () => {
  it('fills every pixel, bars black, for both modes and clipped widths', () => {
    const idx = noise(), pal = palette();
    pal[idx[0]!] = 0xffffff;
    for (const [W, H] of [[400, 300], [200, 300], [640, 480], [300, 1000], [1001, 737], [100, 75]] as const) {
      const out = run(idx, pal, W, H), { dw, dx } = layout(W, H);
      expect(out.includes(0xabcdef)).toBe(false);
      for (let y = 0; y < H; y += 7) {
        if (dx > 0) expect(out[y * W + dx - 1]).toBe(0);
        if (dx + dw < W) expect(out[y * W + dx + dw]).toBe(0);
      }
    }
  });

  it('COLORONCOLOR: 512x384 is the frame copied 1:1 between 96-pixel bars', () => {
    const idx = noise(), pal = palette(), out = run(idx, pal, 512, 384);
    for (let y = 0; y < 384; y += 5) for (let x = 0; x < 320; x++) expect(out[y * 512 + 96 + x]).toBe(pal[idx[y * 320 + x]!]);
  });

  it('COLORONCOLOR: centre sampling, one extra pixel repeats the last source pixel', () => {
    const idx = new Uint8Array(320 * 384), pal = Uint32Array.from({ length: 256 }, (_, i) => i);
    for (let y = 0; y < 384; y++) for (let x = 0; x < 320; x++) idx[y * 320 + x] = (x + 3 * y) & 255;
    const at = (out: Uint32Array, W: number, x: number, y: number) => out[y * W + x]!;
    const o385 = run(idx, pal, 400, 385), { dx } = layout(400, 385);   // dw 321, H 385: S + 1 both ways
    expect([at(o385, 400, dx + 320, 0), at(o385, 400, dx + 319, 0)]).toEqual([319 & 255, 319 & 255]);
    expect(at(o385, 400, dx, 384)).toBe((3 * 383) & 255);
    const o480 = run(idx, pal, 640, 480);                               // 384 -> 480: floor((2d + 1) 0.4)
    expect([0, 1, 2, 3, 4].map((y) => at(o480, 640, 120, y))).toEqual([0, 3, 6, 6, 9]);
  });

  it('HALFTONE keeps a flat colour', () => {
    const idx = new Uint8Array(320 * 384).fill(7), pal = palette();
    const out = run(idx, pal, 400, 300);
    for (let x = 75; x < 325; x++) expect(out[150 * 400 + x]).toBe(pal[7]! & 0xffffff);
  });

  it('HALFTONE tables match the per-pixel rules (dyadic and non-dyadic scales, clipped)', () => {
    for (const [W, H] of [[60, 50], [40, 37], [30, 50]] as const) {
      const idx = noise(), pal = palette();
      expect(run(idx, pal, W, H)).toEqual(halftoneRef(idx, pal, W, H));
    }
  }, 60_000);
});
