// Ported from tests/trig.test.js — Alchemy.sin / cos / atan2 are clones of ucrtbase's (10.0.26100, FMA3 +
// AVX2 branch), which is what mpvis.DLL and wmp.dll call; they are NOT correctly rounded, and the
// engines truncate products that land exactly on their ulps (NOTES-battery-ab.md). This suite pins:
//   1. bit agreement with ucrtbase's own answers (tests/trig-ucrt.bin: 2500 sin, 2500 cos, 2250 atan2
//      evaluated by ucrtbase.dll on the capture machine) — two thirds of them engine arguments,
//      weighted to the ones where V8's Math.* disagrees, the rest random, near k*pi/4, tiny,
//      Payne-Hanek-sized (>= 2e7) and atan2's wide-exponent / subnormal-quotient edges;
//   2. Alchemy.fma (the emulated vfmadd every kernel step is built on) against a BigInt exact
//      reference, including constructed near-ties that need its round-to-odd step;
//   3. the WebAssembly sin/cos (assembly/trig.ts, A.trigMode) on all of the above and against the
//      JavaScript on a few million arguments, and the fallback when WebAssembly is missing or refused.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import { TRIG_WASM } from '../../src/engine/trig-wasm';

const here = path.dirname(fileURLToPath(import.meta.url));

const dv = new DataView(new ArrayBuffer(8));
const hex = (v: number): string => { dv.setFloat64(0, v); return dv.getBigUint64(0).toString(16).padStart(16, '0'); };
const same = (a: number, b: number): boolean => hex(a) === hex(b) || (a !== a && b !== b);

for (const mode of ['js', 'wasm'] as const) describe(`trig (${mode}): bit agreement with ucrtbase fixtures`, () => {
  beforeAll(() => { A.trigMode = mode; });
  afterAll(() => { A.trigMode = 'auto'; });
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

  it('sincos: the bits of sin and cos on every fixture argument and the branch edges', () => {
    const xs = [0, -0, NaN, Infinity, -Infinity, 3e7, -3e7, 1e-9, 1e-5];
    for (const p of [Math.PI / 4, 0.7853981633974483]) xs.push(p, -p, p * (1 + 2 ** -52), p * (1 - 2 ** -53));
    for (let i = 0; i < nS + nC; i++) xs.push(F[2 + 2 * i]!);   // the sin and cos fixture arguments
    const out = new Float64Array(2), failures: string[] = [];
    for (const x of xs) {
      A.sincos(x, out);
      if (!same(out[0]!, A.sin(x)) || !same(out[1]!, A.cos(x))) failures.push(hex(x));
    }
    expect(failures).toEqual([]);
  });
});

// The kernel's own fma (the one its sin/cos are built on), from an instance of the committed module.
const kernelFma = (new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(atob(TRIG_WASM), (c) => c.charCodeAt(0))), {})
  .exports as unknown as { fma(a: number, b: number, c: number): number }).fma;

for (const [what, fma] of [['js', A.fma], ['wasm', kernelFma]] as const) describe(`fma (${what}): exact BigInt reference`, () => {
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
      const g = fma(a, b, c), r = fmaRef(a, b, c);
      if (!(same(g, r) || (g === 0 && r === 0))) failures.push(`fma(${a},${b},${c}) = ${g}, exact ${r}`);
    }
    // a*b = 2^-53 (1 - 2^-2k) is not a double for 2k > 53, so the tail of c + a*b rounds, and with
    // c's last bit odd the naive tail lands exactly on a tie of the final rounding.
    for (let k = 27; k <= 45; k++) {
      for (let j = 0; j < 100; j++) {
        const sc = Math.pow(2, Math.floor(R() * 40 - 20)), sg = R() < 0.5 ? 1 : -1, up = R() < 0.5 ? 1 : -1;
        const a = (1 + up * Math.pow(2, -k)) * sc, b = sg * Math.pow(2, -53) * (1 - up * Math.pow(2, -k)) / sc;
        const c = sg * (1 + Math.floor(R() * 1048576) * Math.pow(2, -52)) * (R() < 0.5 ? 1 : 1 + Math.pow(2, -52));
        const g = fma(a, b, c), r = fmaRef(a, b, c);
        if (!same(g, r)) failures.push(`fma near-tie (${a},${b},${c}) = ${g}, exact ${r}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('trig: WebAssembly vs JavaScript', () => {
  afterEach(() => { A.trigMode = 'auto'; });

  // Engine-like angles (a few turns, k*pi/64 and its neighbours, atan2 outputs plus a spin), the
  // small-argument branches, the pi/4 edges, and the 2e7 hand-over to Payne-Hanek on both sides.
  function args(): Float64Array {
    let s = 99;
    const r = (): number => (s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0;
    const xs: number[] = [0, -0, 1e-300, 5e-324, 1e-9, 1e-5, 2 ** -13, 2 ** -27, NaN, Infinity, -Infinity,
      2e7, -2e7, 19999999.999999996, -19999999.999999996, 2.0000000000000004e7, 3e7, 1e300];
    for (const p of [Math.PI / 4, 0.7853981633974483]) xs.push(p, -p, p * (1 + 2 ** -52), p * (1 - 2 ** -53));
    for (let i = 0; i < 1500000; i++) {
      const k = r() % 4;
      xs.push(k === 0 ? (r() / 2 ** 32) * 20 - 10 : k === 1 ? (r() / 2 ** 32) * 1.6 - 0.8
        : k === 2 ? ((r() % 4000) - 2000) * Math.PI / 64 * (1 + ((r() % 5) - 2) * 2 ** -52)
        : Math.atan2((r() % 600) - 300, (r() % 600) - 300) + ((r() % 100) / 50 - 1));
    }
    return Float64Array.from(xs);
  }
  function run(mode: 'js' | 'wasm', xs: Float64Array): Float64Array {
    A.trigMode = mode;
    const out = new Float64Array(4 * xs.length), sc = new Float64Array(2);
    for (let i = 0; i < xs.length; i++) {
      out[4 * i] = A.sin(xs[i]!); out[4 * i + 1] = A.cos(xs[i]!);
      A.sincos(xs[i]!, sc); out[4 * i + 2] = sc[0]!; out[4 * i + 3] = sc[1]!;
    }
    return out;
  }

  it('the same bits for sin, cos and sincos on 1.5 million arguments', () => {
    const xs = args(), want = run('js', xs), got = run('wasm', xs);
    const failures: string[] = [];
    for (let i = 0; i < want.length; i++) if (!same(got[i]!, want[i]!) && failures.length < 10) failures.push(`${['sin', 'cos', 'sincos.sin', 'sincos.cos'][i & 3]}(${hex(xs[i >> 2]!)})`);
    expect(failures).toEqual([]);
  }, 60_000);

  it('atan2: the same bits on 2 million pairs (engine integers, wide exponents, subnormal quotients)', () => {
    let s = 4242;
    const r = (): number => (s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0;
    const ys: number[] = [], xs: number[] = [];
    for (const v of [0, -0, 1, -1, 5e-324, -5e-324, 1e-310, 1e308, -1e308, Infinity, -Infinity, NaN]) for (const w of [0, -0, 1, -3, 1e-310, 1e300, Infinity, NaN]) { ys.push(v); xs.push(w); }
    for (let i = 0; i < 2000000; i++) {
      const k = r() % 4;
      if (k === 0) { ys.push((r() % 4001) - 2000); xs.push((r() % 4001) - 2000); }              // pixel deltas
      else if (k === 1) { ys.push(((r() / 2 ** 32) - 0.5) * 2 ** ((r() % 80) - 40)); xs.push(((r() / 2 ** 32) - 0.5) * 2 ** ((r() % 80) - 40)); }
      else if (k === 2) { ys.push(((r() / 2 ** 32) - 0.5) * 2 ** ((r() % 2000) - 1000)); xs.push(((r() / 2 ** 32) - 0.5) * 2 ** ((r() % 2000) - 1000)); }
      else { const a = (r() / 2 ** 32) * 2 ** -1000, b = 2 ** ((r() % 60) + 1); ys.push(r() & 1 ? a : -a); xs.push(r() & 2 ? b : -b); }   // quotient below 2^-1022
    }
    const run2 = (mode: 'js' | 'wasm'): Float64Array => { A.trigMode = mode; return Float64Array.from(ys, (y, i) => A.atan2(y, xs[i]!)); };
    const want = run2('js'), got = run2('wasm'), failures: string[] = [];
    for (let i = 0; i < want.length; i++) if (!same(got[i]!, want[i]!) && failures.length < 10) failures.push(`atan2(${hex(ys[i]!)},${hex(xs[i]!)})`);
    expect(failures).toEqual([]);
  }, 60_000);

  it('sincosN: sincos of every element, both paths, in batches and past them', () => {
    const xs = args().subarray(0, 300000), failures: string[] = [];
    for (const mode of ['js', 'wasm'] as const) {
      const want = run(mode, xs), out = new Float64Array(2 * xs.length).fill(7);
      for (const n of [0, 1, 5, 2047, 2048, 2049, 5000, xs.length]) {
        A.sincosN(xs, n, out);
        for (let i = 0; i < 2 * n; i++) if (!same(out[i]!, want[4 * (i >> 1) + 2 + (i & 1)]!) && failures.length < 10) failures.push(`${mode} n=${n} ${i}`);
        if (out[2 * n] !== 7 && n < xs.length) failures.push(`${mode} n=${n} wrote past 2n`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('is small enough for a synchronous compile on a browser main thread (< 4 KB)', () => {
    expect(atob(TRIG_WASM).length).toBeLessThan(4096);
  });
});

describe('trig: fallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const refused = {
    'no WebAssembly': undefined,
    'compile refused (CSP)': { ...WebAssembly, Module: class { constructor() { throw new WebAssembly.CompileError('refused'); } } },
  };
  for (const [what, stub] of Object.entries(refused)) {
    it(`${what}: 'auto' answers from the JavaScript, 'wasm' throws`, async () => {
      const xs = [0.5, 1, 2.5, -7, 100.25, 1e5];
      A.trigMode = 'js';
      const want = xs.map((x) => [A.sin(x), A.cos(x)]);
      vi.stubGlobal('WebAssembly', stub);
      vi.resetModules();                             // a fresh module graph: the kernel is loaded (and refused) from scratch
      const fresh = (await import('../../src/engine/ns')).A;
      await import('../../src/engine/rand');
      const sc = new Float64Array(2);
      expect(xs.map((x) => { fresh.sincos(x, sc); return [fresh.sin(x), fresh.cos(x), sc[0], sc[1]]; }))
        .toEqual(want.map(([s, c]) => [s, c, s, c]));
      expect(fresh.trigMode).toBe('auto');
      expect(() => { fresh.trigMode = 'wasm'; }).toThrow(/WebAssembly/);
      A.trigMode = 'auto';
    });
  }
});
