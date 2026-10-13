// gdipScaleHQ (src/pictureviz/gdip.ts) is a clone of the GDI+ HighQualityBicubic scaling step the
// Picture Viz DLLs run on every picture; the private harness A/B-tests it pixel for pixel against
// gdiplus.dll. This suite pins properties of the port's own output and a golden table of hashes of its output
// on synthetic pictures generated here (the same pictures were checked against gdiplus.dll before the hashes
// were recorded).
import { describe, expect, it } from 'vitest';
import { gdipScaleHQ } from '../src/pictureviz/gdip';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
}
/** Synthetic pictures: 'noise' (uniform random bytes) or 'gradient' (smooth ramps plus a hard edge). */
function picture(kind: 'noise' | 'gradient', w: number, h: number, seed: number): Uint8Array {
  const o = new Uint8Array(w * h * 3);
  if (kind === 'noise') { const r = lcg(seed); for (let i = 0; i < o.length; i++) o[i] = r(); return o; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    o[i] = Math.round((255 * x) / Math.max(1, w - 1));
    o[i + 1] = Math.round((255 * y) / Math.max(1, h - 1));
    o[i + 2] = x < w / 2 ? 40 : 220;
  }
  return o;
}
function fnv(px: Uint32Array): string {
  let h = 0x811c9dc5;
  for (const v of px) for (const s of [0, 8, 16]) { h ^= (v >>> s) & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// [kind, sw, sh, dw, dh, seed] -> fnv-1a of the output's B,G,R bytes
const GOLDEN: [string, number, number, number, number, number, string][] = [
  ['noise', 200, 300, 192, 288, 1, 'dbdb8c4a'], // the DLL's own fits
  ['noise', 512, 512, 288, 288, 2, '55a50e67'],
  ['gradient', 640, 480, 350, 262, 3, 'b6e0f506'],
  ['noise', 7, 5, 350, 250, 4, '2cd9aabf'], // extreme up
  ['gradient', 16, 16, 300, 300, 5, 'f530bcdb'],
  ['noise', 700, 700, 16, 16, 6, '6ea314f0'], // extreme down
  ['noise', 1, 1, 16, 16, 7, 'ffbfb6d7'], // one-pixel sources
  ['noise', 1, 300, 16, 288, 8, 'c70f63c8'],
  ['noise', 300, 1, 288, 16, 9, '267aabb2'],
  ['noise', 100, 100, 99, 101, 10, '40580f6c'], // near 1:1
  ['noise', 576, 120, 288, 60, 11, 'd0cd8452'], // exact 2:1 (the 8-tap routine)
  ['noise', 577, 90, 288, 45, 12, '44c26d07'], // near 2:1, also the 8-tap routine, at a phase
  ['noise', 568, 364, 164, 315, 13, '5357cfd5'], // float32 residual origins
  ['noise', 200, 470, 53, 137, 14, '1d99b2b9'],
  ['gradient', 406, 332, 204, 191, 15, '4f9b8925'],
  ['noise', 333, 17, 333, 160, 16, 'bf295651'], // one axis 1:1
  ['gradient', 40, 250, 16, 250, 17, '3173833f'],
  ['noise', 64, 64, 32, 32, 18, 'b15dde13'],
];

describe('gdipScaleHQ', () => {
  it('copies the picture when the size does not change', () => {
    const src = picture('noise', 37, 23, 1);
    const out = gdipScaleHQ(src, 37, 23, 37, 23);
    for (let i = 0; i < 37 * 23; i++) expect(out[i]).toBe((src[i * 3]! << 16) | (src[i * 3 + 1]! << 8) | src[i * 3 + 2]!);
  });

  it('keeps a flat colour exactly away from the edges, up and down', () => {
    const sizes: [number, number, number, number][] = [[40, 30, 150, 100], [300, 200, 64, 40], [90, 90, 45, 45], [50, 70, 50, 33]];
    for (const [sw, sh, dw, dh] of sizes) {
      const src = new Uint8Array(sw * sh * 3);
      for (let i = 0; i < src.length; i += 3) { src[i] = 200; src[i + 1] = 17; src[i + 2] = 99; }
      const out = gdipScaleHQ(src, sw, sh, dw, dh);
      // inside: every tap within the picture (the right and bottom edges sample past it, so stay clear)
      const mx = Math.ceil((3 * dw) / sw) + 2, my = Math.ceil((3 * dh) / sh) + 2;
      for (let y = my; y < dh - my; y++) for (let x = mx; x < dw - mx; x++) expect(out[y * dw + x]).toBe(0xc81163);
    }
  });

  it('treats the three channels alike (grey stays grey, swapping channels swaps the output)', () => {
    const rgb = picture('noise', 61, 47, 5);
    const grey = new Uint8Array(rgb.length), swapped = new Uint8Array(rgb.length);
    for (let i = 0; i < rgb.length; i += 3) {
      grey[i] = grey[i + 1] = grey[i + 2] = rgb[i]!;
      swapped[i] = rgb[i + 2]!; swapped[i + 1] = rgb[i + 1]!; swapped[i + 2] = rgb[i]!;
    }
    const g = gdipScaleHQ(grey, 61, 47, 200, 30);
    for (const v of g) { expect(v >> 16).toBe(v & 255); expect((v >> 8) & 255).toBe(v & 255); }
    const a = gdipScaleHQ(rgb, 61, 47, 200, 30), b = gdipScaleHQ(swapped, 61, 47, 200, 30);
    for (let i = 0; i < a.length; i++) { const v = a[i]!; expect(b[i]).toBe(((v & 255) << 16) | (v & 0xff00) | (v >> 16)); }
  });

  it('gives black for a black picture, edges included', () => {
    expect(Array.from(gdipScaleHQ(new Uint8Array(3), 1, 1, 16, 16)).every((v) => v === 0)).toBe(true);
    expect(Array.from(gdipScaleHQ(new Uint8Array(30 * 3), 30, 1, 16, 40)).every((v) => v === 0)).toBe(true);
  });

  it('matches the golden table', () => {
    expect(GOLDEN.length).toBeGreaterThan(0);
    for (const [kind, sw, sh, dw, dh, seed, hash] of GOLDEN) {
      const out = gdipScaleHQ(picture(kind as 'noise' | 'gradient', sw, sh, seed), sw, sh, dw, dh);
      expect(`${kind} ${sw}x${sh}->${dw}x${dh} ${fnv(out)}`).toBe(`${kind} ${sw}x${sh}->${dw}x${dh} ${hash}`);
    }
  });
});
