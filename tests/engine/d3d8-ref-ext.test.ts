// The 64-bit-mantissa arithmetic RefDevice models the x87 with (src/engine/d3d8/ref/ext.ts), checked against exact
// rational arithmetic in BigInt.
import { describe, expect, it } from 'vitest';
import * as E from '../../src/engine/d3d8/ref/ext';

// exact value as (m, e): v = m * 2^e
type X = { m: bigint; e: number };
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
function exact(v: number): X {
  F64[0] = v;
  const b = U64[0], ex = Number((b! >> 52n) & 0x7ffn), frac = b! & 0xfffffffffffffn;
  const m = ex ? frac | (1n << 52n) : frac, e = (ex || 1) - 1075;
  return { m: (b! >> 63n) ? -m : m, e };
}
function addX(a: X, b: X): X { const e = Math.min(a.e, b.e); return { m: (a.m << BigInt(a.e - e)) + (b.m << BigInt(b.e - e)), e }; }
function mulX(a: X, b: X): X { return { m: a.m * b.m, e: a.e + b.e }; }
/** round to `bits` significant bits, nearest even; returns the exact value as a number pair (hi, lo) */
function roundX(a: X, bits: number): X {
  if (a.m === 0n) return a;
  const neg = a.m < 0n; let m = neg ? -a.m : a.m, e = a.e;
  const sh = m.toString(2).length - bits;
  if (sh > 0) {
    const s = BigInt(sh), q = m >> s, r = m - (q << s), h = 1n << (s - 1n);
    m = r > h || (r === h && (q & 1n)) ? q + 1n : q; e += sh;
  }
  return { m: neg ? -m : m, e };
}
/** a / b to `bits` bits: long division with enough extra bits and a sticky bit */
function divX(a: X, b: X, bits: number): X {
  const neg = (a.m < 0n) !== (b.m < 0n);
  const am = a.m < 0n ? -a.m : a.m, bm = b.m < 0n ? -b.m : b.m;
  const k = bits + 4 + bm.toString(2).length;
  const n = am << BigInt(k), q = n / bm, r = n - q * bm;
  const m = (q << 1n) | (r ? 1n : 0n);
  const x = roundX({ m: neg ? -m : m, e: a.e - b.e - k - 1 }, bits);
  return x;
}
function toNum(x: X): [number, number] {
  // split into a double-double: hi = the value rounded to 53 bits
  const h = roundX(x, 53), hn = Number(h.m) * Math.pow(2, h.e);
  const rest = addX(x, { m: -h.m, e: h.e });
  const ln = Number(rest.m) * Math.pow(2, rest.e);
  return [hn, ln];
}
function rnd(r: () => number): number {
  const m = (r() - 0.5) * 2, e = Math.floor(r() * 40) - 20;
  return Math.fround(m * Math.pow(2, e));
}
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

describe('ref/ext 64-bit arithmetic', () => {
  it('add, mul and div of doubles and of 64-bit values round like the x87 at 64 bits', () => {
    const r = lcg(7);
    for (let i = 0; i < 4000; i++) {
      const a = rnd(r) * (1 + r() * 1e-7), b = rnd(r) / 3, c = rnd(r);
      // a + b
      let h = E.add(a, 0, b, 0), l = E.lo();
      expect([h, l]).toEqual(toNum(roundX(addX(exact(a), exact(b)), 64)));
      // (a * b) then + c, every step at 64 bits
      const p = roundX(mulX(exact(a), exact(b)), 64);
      h = E.mul(a, 0, b, 0); l = E.lo();
      expect([h, l]).toEqual(toNum(p));
      const [ph, pl] = toNum(p);
      h = E.add(ph, pl, c, 0); l = E.lo();
      expect([h, l]).toEqual(toNum(roundX(addX(p, exact(c)), 64)));
      // 1 / a
      h = E.div(1, 0, a, 0); l = E.lo();
      expect([h, l]).toEqual(toNum(divX(exact(1), exact(a), 64)));
      // f32 of a 64-bit value
      expect(E.toF32(ph, pl)).toBe(Math.fround(Number(roundX(p, 24).m) * Math.pow(2, roundX(p, 24).e)));
    }
  });
  it('breaks an f32 tie with the low part', () => {
    const mid = 1 + Math.pow(2, -24);                  // halfway between 1 and the next float
    expect(E.toF32(mid, 1e-30)).toBe(Math.fround(1 + Math.pow(2, -23)));
    expect(E.toF32(mid, -1e-30)).toBe(1);
    expect(E.toF32(mid, 0)).toBe(1);
  });
});
