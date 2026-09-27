// Ported from tests/trig.test.js — Alchemy.sin / cos / atan2 are clones of ucrtbase's (10.0.26100, FMA3 +
// AVX2 branch), which is what mpvis.DLL and wmp.dll call; they are NOT correctly rounded, and the
// engines truncate products that land exactly on their ulps (NOTES-battery-ab.md). This suite pins:
//   1. bit agreement with ucrtbase's own answers (tests/trig-ucrt.bin: 2500 sin, 2500 cos, 2250 atan2
//      evaluated by ucrtbase.dll on the capture machine) — two thirds of them engine arguments,
//      weighted to the ones where V8's Math.* disagrees, the rest random, near k*pi/4, tiny,
//      Payne-Hanek-sized (>= 2e7) and atan2's wide-exponent / subnormal-quotient edges;
//   2. Alchemy.fma (the emulated vfmadd every kernel step is built on) against a BigInt exact
//      reference, including constructed near-ties that need its round-to-odd step.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';

const here = path.dirname(fileURLToPath(import.meta.url));

const dv = new DataView(new ArrayBuffer(8));
const hex = (v: number): string => { dv.setFloat64(0, v); return dv.getBigUint64(0).toString(16).padStart(16, '0'); };
const same = (a: number, b: number): boolean => hex(a) === hex(b) || (a !== a && b !== b);

describe('trig: bit agreement with ucrtbase fixtures', () => {
  const buf = fs.readFileSync(path.join(here, '..', 'trig-ucrt.bin'));
  const F = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const header = new Uint32Array(F.buffer, 0, 3);
  const nS = header[0]!, nC = header[1]!, nA = header[2]!;
  let o = 2;
  let v8 = 0;

  it(`sin: ${nS} ucrtbase fixtures`, () => {
    const failures: string[] = [];
    for (let i = 0; i < nS; i++, o += 2) {
      const x = F[o]!, want = F[o + 1]!;
      const got = A.sin(x);
      if (!same(got, want)) failures.push(`sin(${hex(x)}) = ${hex(got)}, ucrtbase ${hex(want)}`);
      if (!same(Math.sin(x), want)) v8++;
    }
    expect(failures).toEqual([]);
  });

  it(`cos: ${nC} ucrtbase fixtures`, () => {
    const failures: string[] = [];
    for (let i = 0; i < nC; i++, o += 2) {
      const x = F[o]!, want = F[o + 1]!;
      const got = A.cos(x);
      if (!same(got, want)) failures.push(`cos(${hex(x)}) = ${hex(got)}, ucrtbase ${hex(want)}`);
      if (!same(Math.cos(x), want)) v8++;
    }
    expect(failures).toEqual([]);
  });

  it(`atan2: ${nA} ucrtbase fixtures`, () => {
    const failures: string[] = [];
    for (let i = 0; i < nA; i++, o += 3) {
      const y = F[o]!, x = F[o + 1]!, want = F[o + 2]!;
      const got = A.atan2(y, x);
      if (!same(got, want)) failures.push(`atan2(${hex(y)},${hex(x)}) = ${hex(got)}, ucrtbase ${hex(want)}`);
      if (!same(Math.atan2(y, x), want)) v8++;
    }
    expect(failures).toEqual([]);
  });

  it('fixture still discriminates (V8 Math.* disagrees on plenty of them)', () => {
    expect(v8).toBeGreaterThan(2000);
  });
});

describe('fma: exact BigInt reference', () => {
  function dec(x: number): [bigint, number] {
    dv.setFloat64(0, x);
    const b = dv.getBigUint64(0), e = Number((b >> 52n) & 0x7ffn);
    let m = b & ((1n << 52n) - 1n);
    if (e) m |= 1n << 52n;
    return [b >> 63n ? -m : m, e ? e - 1075 : -1074];
  }
  function rn(N: bigint, ex: number): number {                 // N * 2^ex to double, ties-to-even
    if (N === 0n) return 0;
    const neg = N < 0n;
    if (neg) N = -N;
    const sh = N.toString(2).length - 53;
    if (sh > 0) {
      const rem = N & ((1n << BigInt(sh)) - 1n), half = 1n << BigInt(sh - 1);
      N >>= BigInt(sh); ex += sh;
      if (rem > half || (rem === half && (N & 1n))) N += 1n;
    }
    const v = Number(N) * Math.pow(2, ex);
    return neg ? -v : v;
  }
  function fmaRef(a: number, b: number, c: number): number {
    const [ma, ea] = dec(a), [mb, eb] = dec(b), [mc, ec] = dec(c), ep = ea + eb, E = Math.min(ep, ec);
    return rn((ma * mb << BigInt(ep - E)) + (mc << BigInt(ec - E)), E);
  }

  // One test: the near-tie section (below) deliberately continues the same LCG stream the
  // random-operand loop leaves off at (the original script never resets `seed`), so both live
  // in one `it` to share that state honestly rather than replaying the first loop to catch up.
  it('random/cancelling/c>>a*b operands, then constructed near-ties needing round-to-odd', () => {
    let seed = 99;
    const R = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const failures: string[] = [];

    for (let i = 0; i < 40000; i++) {                // random, cancelling and c >> a*b operands
      const a = (R() - 0.5) * Math.pow(2, Math.floor(R() * 40 - 20));
      const b = (R() - 0.5) * Math.pow(2, Math.floor(R() * 40 - 20));
      const p = a * b, k = i % 3;
      const c = k === 0 ? (R() - 0.5) * Math.pow(2, Math.floor(R() * 60 - 30))
              : k === 1 ? -p * (1 + (R() - 0.5) * Math.pow(2, -Math.floor(R() * 52)))
              : p * Math.pow(2, Math.floor(R() * 60 + 1)) * (R() < 0.5 ? 1 : -1);
      if (!c) continue;
      const g = A.fma(a, b, c), r = fmaRef(a, b, c);
      if (!(same(g, r) || (g === 0 && r === 0))) failures.push(`fma(${a},${b},${c}) = ${g}, exact ${r}`);
    }
    // a*b = 2^-53 (1 - 2^-2k) is not a double for 2k > 53, so the tail of c + a*b rounds, and with
    // c's last bit odd the naive tail lands exactly on a tie of the final rounding.
    for (let k = 27; k <= 45; k++) {
      for (let j = 0; j < 100; j++) {
        const sc = Math.pow(2, Math.floor(R() * 40 - 20)), sg = R() < 0.5 ? 1 : -1, up = R() < 0.5 ? 1 : -1;
        const a = (1 + up * Math.pow(2, -k)) * sc, b = sg * Math.pow(2, -53) * (1 - up * Math.pow(2, -k)) / sc;
        const c = sg * (1 + Math.floor(R() * 1048576) * Math.pow(2, -52)) * (R() < 0.5 ? 1 : 1 + Math.pow(2, -52));
        const g = A.fma(a, b, c), r = fmaRef(a, b, c);
        if (!same(g, r)) failures.push(`fma near-tie (${a},${b},${c}) = ${g}, exact ${r}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
