// Ribbons (the Psychedelia Viz Pack's RibbonsVis.dll, Alchemy.Ribbons): presets, what drives it (the sound, rand), the
// D3DX math it relies on, then a golden guard over the port's own output on a synthetic stream: the calls (a recording
// stand-in for the device: every call and its numbers, vertex buffers by content) and a few frames of pixels (the
// reference device, our own artwork and permutation). The fixture (./golden/fixtures/ribbons.json) was written once
// the engine was verified against the DLL: GOLDEN_UPDATE=1 npx vitest run tests/ribbons.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/psychedelia/ribbons/index';
import type { Device9 } from '../src/d3d9/api';
import { perspectiveFovRH, rsqrtTable, xadd, xdiv, xmul } from '../src/psychedelia/d3dx9';
import { level } from './helpers-2';
import type { TimedLevel } from '../src/ns';

const R = A.Ribbons;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return U1[0]!; };
const mix = (h: number, v: number): number => { h = Math.imul(h ^ (v >>> 0), 16777619); return h ^ (h >>> 13); };

/** a synthetic stream: beats every 23 frames over a slow sweep (our own) */
function stream(f: number): TimedLevel {
  return level(2, (L) => {
    const beat = f % 23 < 3 ? 120 : 0;
    for (let i = 0; i < 1024; i++) L.freq[0][i] = Math.max(0, Math.min(255, (beat + 90 * (1 + Math.sin(i / 40 + f / 17)) - i / 8) | 0));
  });
}

/** a stand-in device that folds every call (its name, numbers, float arrays by bits, buffers by content) into a hash */
function recorder(): { device: (w: number, h: number) => Device9; key: () => number } {
  let h = 0x811c9dc5;
  const fold = (v: unknown): void => {
    if (typeof v === 'number') h = mix(h, bits(v));
    else if (v instanceof Float32Array) for (const x of v) h = mix(h, bits(x));
    else if (v instanceof Uint8Array) for (let i = 0; i < v.length; i += 3) h = mix(h, v[i]!);
  };
  const surface = () => {
    const data = new Uint8Array(128 * 512);
    return { width: 128, height: 128, format: 21, lockRect: () => ({ data, pitch: 512 }), unlockRect: () => fold(data) };
  };
  const make = (): Device9 => {
    const bb = surface();
    return new Proxy({}, {
      get: (_t, k: string) => {
        if (k === 'createTexture') return () => { const s = surface(); return { getSurfaceLevel: () => s }; };
        if (k === 'createVertexBuffer') return (n: number) => { const b = new Uint8Array(n); return { length: n, lock: () => b, unlock: () => fold(b) }; };
        if (k === 'getBackBuffer') return () => bb;
        if (k === 'present') return () => new Uint8Array(4);
        return (...args: unknown[]) => { for (let i = 0; i < k.length; i++) h = mix(h, k.charCodeAt(i)); args.forEach(fold); return 1; };
      },
    }) as unknown as Device9;
  };
  return { device: make, key: () => h >>> 0 };
}

describe('Ribbons: presets and input', () => {
  it('the DLL\'s six presets in GetPresetTitle order', () => {
    expect(R.PRESET_NAMES).toEqual(['Random', 'Mystify', 'Ribbons', 'Dense', 'Embossed', 'More Embossed']);
    const e = new R({ options: { device: recorder().device } });
    expect(e.setPreset(5)).toBe(true);
    expect(e.setPreset(6)).toBe(false);
  });

  it('reads the sound: each ribbon steps by its band, silence and the stream draw differently', () => {
    const run = (loud: boolean): number => {
      const r = recorder(), e = new R({ width: 160, height: 120, preset: 2, options: { device: r.device } }).seed(7);
      for (let f = 0; f < 40; f++) e.render(loud ? stream(f) : level(2));
      return r.key();
    };
    expect(run(true)).not.toBe(run(false));
  });

  it('rand seeds the ribbons\' colours and the walks (srand in the constructor and at device creation)', () => {
    const run = (seed: number): number => {
      const r = recorder(), e = new R({ width: 160, height: 120, preset: 1, options: { device: r.device } }).seed(seed);
      for (let f = 0; f < 5; f++) e.render(stream(f));
      return r.key();
    };
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(2));
  });
});

// one rounding to 24 bits of the exact x (x = n / d * 2^e, BigInts, n, d > 0), ties to even
function round24(n: bigint, d: bigint, e: number): number {
  let k = 0;
  while (n >= d << 24n) { d <<= 1n; k++; }
  while (n < d << 23n) { n <<= 1n; k--; }
  let q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q++;
  return Number(q) * 2 ** (e + k);
}
const D = new Float64Array(1), W = new BigUint64Array(D.buffer);
/** a positive double as [mantissa, exponent] */
function parts(x: number): [bigint, number] {
  D[0] = x;
  const b = W[0]!, ex = Number(b >> 52n);
  return ex ? [(b & 0xfffffffffffffn) | (1n << 52n), ex - 1075] : [b & 0xfffffffffffffn, -1074];
}

describe('x87 at 24 bits: one rounding where f(a op b) rounds twice', () => {
  it('xmul, xdiv, xadd round like the exact result does, on cases built to land on a float midpoint', () => {
    let s = 12345, hits = 0;
    const rnd = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32; };
    for (let i = 0; i < 5000; i++) {
      const m = Math.fround(1 + rnd()) + 2 ** -24;   // a midpoint between two floats in [1, 2)
      const a = Math.fround(1 + 7 * rnd());
      for (const [op, b, x] of [['*', m / a, xmul(a, m / a)], ['/', a / m, xdiv(a, a / m)], ['+', m - a + (rnd() - 0.5) * 2 ** -60, 0]] as [string, number, number][]) {
        const [ma, ea] = parts(a), [mb, eb] = parts(Math.abs(b));
        let want: number, got: number, dbl: number;
        if (op === '*') { want = round24(ma * mb, 1n, ea + eb); got = Math.fround(x); dbl = a * b; }
        else if (op === '/') { want = round24(ma << 64n, mb, ea - eb - 64); got = Math.fround(x); dbl = a / b; }
        else {
          // a + b with b > 0 or < 0: on a common exponent
          const e = Math.min(ea, eb), na = ma << BigInt(ea - e), nb = mb << BigInt(eb - e), n = b < 0 ? na - nb : na + nb;
          want = round24(n, 1n, e); got = Math.fround(xadd(a, b)); dbl = a + b;
        }
        expect(got).toBe(want);
        if (Math.fround(dbl) !== want) hits++;
      }
    }
    expect(hits).toBeGreaterThan(100);   // the plain f(a op b) gets these wrong
  }, 60_000);
});

describe('Ribbons: D3DX 9 math', () => {
  it('the rsqrt table: 1/sqrt to within a few ulps, exact at a segment start', () => {
    for (const x of [0.5, 1, 2, 3.7, 1234.5]) expect(Math.abs(rsqrtTable(x) - 1 / Math.sqrt(x)) * Math.sqrt(x)).toBeLessThan(1e-5);
    expect(rsqrtTable(4)).toBe(0.5);
  });
  it('the perspective of Mystify (fov 1.5, 4:3)', () => {
    const m = perspectiveFovRH(new Float32Array(16), 1.5, Math.fround(4 / 3), Math.fround(0.1), 300);
    expect([m[0], m[5], m[11]]).toEqual([Math.fround(0.805069566), Math.fround(1.07342613), -1]);
  });
});

// ---- golden: calls of every preset (key every 50 frames over 300), pixels of each preset for 3 frames at 96 x 72
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'ribbons.json');

function goldenCalls(preset: number): string[] {
  const r = recorder(), e = new R({ width: 320, height: 240, preset, options: { device: r.device } }).seed(1058270499);
  const out: string[] = [];
  for (let f = 0; f < 300; f++) { e.render(stream(f)); if ((f + 1) % 50 === 0) out.push(r.key().toString(16).padStart(8, '0')); }
  return out;
}
function goldenPixels(preset: number): string[] {
  const e = new R({ width: 96, height: 72, preset }).seed(1058270499);
  const out: string[] = [];
  for (let f = 0; f < 3; f++) {
    const s = e.render(stream(f))!;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.px.length; i++) h = mix(h, s.px[i]!);
    out.push((h >>> 0).toString(16).padStart(8, '0'));
  }
  return out;
}

describe.skipIf(process.env.GOLDEN_UPDATE !== '1' && !existsSync(GOLDEN))('Ribbons: golden', () => {
  const update = process.env.GOLDEN_UPDATE === '1';
  const want: Record<string, string[]> = update || !existsSync(GOLDEN) ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const got: Record<string, string[]> = {};
  for (let p = 0; p < 6; p++) {
    it(`calls p${p} ${R.PRESET_NAMES[p]}`, () => {
      got[`calls-p${p}`] = goldenCalls(p);
      if (!update) expect(got[`calls-p${p}`]).toEqual(want[`calls-p${p}`]);
    }, 120_000);
    it(`pixels p${p} ${R.PRESET_NAMES[p]}`, () => {
      got[`pixels-p${p}`] = goldenPixels(p);
      if (!update) expect(got[`pixels-p${p}`]).toEqual(want[`pixels-p${p}`]);
    }, 300_000);
  }
  it('fixture', () => {
    if (update) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    expect(Object.keys(update ? got : want).length).toBe(12);
  });
});
