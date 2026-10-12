// @vitest-environment node
// Battery's blur/palette on the WebAssembly path (src/engine/battery/kernel.ts) against the
// JavaScript in src/engine/battery/index.ts, on random and saturated bytes and odd sizes. The golden guard (tests/engine/golden) covers whole engine runs on both paths.
import { afterEach, describe, expect, it } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/battery/index';
import { newArena, paletteWasm } from '../../src/engine/battery/kernel';

type Internals = { BLUR_LUT: Uint8Array; blur(s: Uint8Array, d: Uint8Array, w: number, h: number): void };
const I = (A.Battery as unknown as { internals: Internals }).internals;

function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0;
}

const SIZES: [number, number][] = [[2, 2], [3, 3], [5, 2], [7, 3], [16, 3], [17, 5], [33, 9], [382, 287], [384, 288], [512, 384]];

afterEach(() => { A.batteryKernel = 'auto'; });

describe('battery kernel: WebAssembly vs JavaScript', () => {
  it('blur: floor(s/5) as q15mulr(s - 2, 6554) gives the LUT for every 5-tap sum', () => {
    for (let s = 0; s <= 5 * 255; s++) {
      const q = (((s - 2) * 6554 + 0x4000) >> 15) - 1;
      expect([s, q < 1 ? 1 : q > 254 ? 254 : q]).toEqual([s, I.BLUR_LUT[s]]);
    }
  });

  it('blur and palette give the JS bytes on every size', () => {
    for (const [w, h] of SIZES) {
      const n = w * h, r = lcg(w * 31 + h), ar = newArena(n)!;
      for (const fill of [() => r() & 255, () => 255, () => 0, (i: number) => (i & 1) * 255]) {
        const src = new Uint8Array(n), pal = new Uint32Array(256);
        for (let i = 0; i < n; i++) src[i] = fill(i);
        for (let i = 0; i < 256; i++) pal[i] = r() & 0xffffff;

        A.batteryKernel = 'js';
        const jsBlur = new Uint8Array(n), jsPx = new Uint32Array(n);
        I.blur(src, jsBlur, w, h);
        for (let i = 0; i < n; i++) jsPx[i] = pal[src[i]!]!;

        A.batteryKernel = 'wasm';
        ar.back.set(src);
        I.blur(ar.back, ar.front, w, h);
        expect([w, h, Buffer.from(ar.front).equals(Buffer.from(jsBlur))]).toEqual([w, h, true]);
        ar.front.set(src);
        expect(paletteWasm(ar.front, pal, ar.px, n)).toBe(true);
        expect([w, h, Buffer.from(ar.px.buffer, ar.px.byteOffset, 4 * n).equals(Buffer.from(jsPx.buffer))]).toEqual([w, h, true]);
      }
    }
  });

  it("'wasm' refuses arrays outside an arena; 'js' makes no arena", () => {
    A.batteryKernel = 'wasm';
    expect(() => I.blur(new Uint8Array(16), new Uint8Array(16), 4, 4)).toThrow(/WebAssembly/);
    A.batteryKernel = 'js';
    expect(newArena(16)).toBe(null);
  });
});
