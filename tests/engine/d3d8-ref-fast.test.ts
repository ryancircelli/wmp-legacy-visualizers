// The fast paths of RefDevice's rasterizer (src/engine/d3d8/ref/rast.ts, ext.ts): each computes in doubles and
// falls back to the 64-bit x87 emulation only when an error bound cannot rule out a different float32 rounding.
// Here every fast helper is checked against the plain 64-bit evaluation on random inputs, many of them built to
// land on or next to a float32 rounding boundary (where a wrong bound would show).
import { describe, expect, it } from 'vitest';
import * as E from '../../src/engine/d3d8/ref/ext';
import { depth16, evalW, lerp32, linCoord, recip, subtract32 } from '../../src/engine/d3d8/ref/rast';

const f32 = Math.fround;
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const F = new Float32Array(1), I = new Int32Array(F.buffer);
const bits = (x: number): number => { F[0] = x; return I[0]!; };
/** a float32 in -scale..scale, often much smaller */
const rf = (r: () => number, scale: number): number => f32((r() - 0.5) * 2 * scale * Math.pow(2, -Math.floor(r() * 12)));
/** a float32 midpoint (half way between two adjacent floats) near x */
function midpoint(x: number): number { F[0] = f32(x); const a = F[0]; I[0]! += 1; return (a + F[0]) / 2; }

// the 64-bit references (the operation order of each helper's fallback)
const evalWRef = (a: number, b: number, c: number, w: number): number => { E.ld(a); E.fadd(b); E.fadd(c); E.fmul(w); return E.st32(); };
const recipRef = (a: number, b: number, c: number): number => {
  E.ld(a); E.fadd(b); E.fadd(c);
  if (E.A[0] === 0 && E.A[1] === 0) return 0;
  E.fdivr(1); return E.st32();
};
function depthRef(a: number, b: number, c: number): number {
  E.ld(a); E.fadd(b); E.fadd(c); const z = E.st64();
  E.ld(z > 1 ? 1 : z >= 0 ? z : 0); E.fmul(65535); E.fadd(0.5);
  const h = E.A[0], l = E.A[1], t = Math.trunc(h!);
  return t !== h || l === 0 ? t : (l! < 0 ? t - 1 : t);
}
const linRef = (c: number, n: number): number => { E.ld(c * n); E.fsub(0.5); E.fadd(393216); return (bits(E.st32()) << 10) >> 10; };
const subRef = (x1: number, x2: number): number => { E.ld(1); E.fsub(x1); E.fadd(x2); E.fsubr(1); return E.st32(); };
const lerpRef = (x1: number, x2: number, f: number): number => { E.ld(x1); E.fsub(x2); E.fmul(f); E.fadd(x2); return E.st32(); };
const add32Ref = (a: number, b: number): number => { E.ld(a); E.fadd(b); return E.st32(); };
const sumRef = (a: number, b: number, c: number, d: number): number => { E.ld(a); E.fadd(b); E.fadd(c); E.fadd(d); return E.st32(); };

describe('RefDevice fast paths agree with the 64-bit evaluation', () => {
  it('plane evaluation, reciprocal W and the D16 depth', () => {
    const r = lcg(1);
    for (let i = 0; i < 20000; i++) {
      const x = Math.floor(r() * 640), y = Math.floor(r() * 480), A = rf(r, 1), B = rf(r, 1);
      let C = rf(r, 4), w = rf(r, 2);
      const a = x * A, b = y * B;
      if (i % 3 === 0) C = f32(midpoint(a + b + C) - a - b);           // the sum on (or next to) a float32 midpoint
      if (i % 5 === 0) w = 1;
      expect(evalW(a, b, C, w)).toBe(evalWRef(a, b, C, w));
      expect(recip(a, b, C)).toBe(recipRef(a, b, C));
      const zA = f32((r() - 0.5) * 1e-3), zB = f32((r() - 0.5) * 1e-3);
      let zc = f32(r());
      if (i % 4 === 0) zc = f32((Math.floor(r() * 65535) + 0.5) / 65535 - x * zA - y * zB);   // next to a D16 step
      expect(depth16(x * zA, y * zB, zc)).toBe(depthRef(x * zA, y * zB, zc));
    }
  }, 60000);
  it('bilinear texel coordinates', () => {
    const r = lcg(2);
    for (let i = 0; i < 20000; i++) {
      const n = [1, 2, 16, 64, 128, 256, 512, 1024][i & 7];
      let c = rf(r, 3);
      if (i % 3 === 0) c = f32((Math.round(r() * 2 * n! * 32) / 32 + 1 / 64 + 0.5) / n!);   // c*n - 0.5 on a 1/64 tie
      expect(linCoord(c, n!)).toBe(linRef(c, n!));
    }
  }, 60000);
  it('decides the cases only the 64-bit evaluation gets right', () => {
    // a float32 midpoint plus an offset below double precision but within 64 bits: a double sum rounds the offset
    // away and ties to even, the x87 keeps it and rounds the other way. A fast path whose bound were too tight
    // would return the double's answer here (this is the sabotage check: set rast.ts's EPS to 0 and it fails).
    const r = lcg(4);
    let decided = 0;
    for (let i = 0; i < 2000; i++) {
      const m = midpoint(f32(1 + r())), d = (r() < 0.5 ? -1 : 1) * Math.pow(2, -56 - Math.floor(r() * 6));
      if (f32(m + d) !== add32Ref(m, d)) decided++;
      expect(evalW(m, d, 0, 1)).toBe(evalWRef(m, d, 0, 1));
      expect(evalW(0, m, d, 1)).toBe(evalWRef(0, m, d, 1));
      expect(E.add32(m, d)).toBe(add32Ref(m, d));
      expect(E.sum32(m, 0, d, 0)).toBe(sumRef(m, 0, d, 0));
    }
    expect(decided).toBeGreaterThan(500);   // the inputs do tell the two evaluations apart
  }, 60000);
  it('stage ops and the 64-bit sums', () => {
    const r = lcg(3);
    for (let i = 0; i < 20000; i++) {
      const x1 = f32(r()), x2 = f32(r() * (i & 1 ? 1 : 1e-6)), f = f32(r());
      expect(subtract32(x1, x2)).toBe(subRef(x1, x2));
      expect(subtract32(x1, x1)).toBe(subRef(x1, x1));
      expect(lerp32(x1, x2, f)).toBe(lerpRef(x1, x2, f));
      const a = x1 * f, b = i % 3 === 0 ? f32(midpoint(a) - a) : x2;
      expect(E.add32(a, b)).toBe(add32Ref(a, b));
      const p = rf(r, 1) * rf(r, 1), q = rf(r, 1) * rf(r, 1), s = rf(r, 1) * rf(r, 1);
      const t = i % 3 === 0 ? f32(midpoint(p + q + s) - p - q - s) : rf(r, 1);
      expect(E.sum32(p, q, s, t)).toBe(sumRef(p, q, s, t));
    }
  }, 60000);
});
