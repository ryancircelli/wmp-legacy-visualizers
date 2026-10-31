// Gigertron 3D (the Psychedelia Viz Pack's ThreeDBars.dll, Alchemy.Gigertron): presets, what drives it (the sound,
// rand, the frame time), the bars and the turn, Syntax's rare clear, then a golden guard over the port's own output on a
// synthetic stream: the calls (a recording stand-in for the device) and a few frames of pixels (the reference device,
// our own texture). Only Cubetro, Syntax and Northern are checked against the DLL (the others crash the reference
// device), so the golden covers those three. GOLDEN_UPDATE=1 npx vitest run tests/gigertron.test.ts rewrites the fixture.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/psychedelia/gigertron/index';
import { Scene, rotationYawPitchRoll } from '../src/psychedelia/gigertron/scene';
import type { Device9 } from '../src/d3d9/api';
import { level } from './helpers-2';
import type { TimedLevel } from '../src/ns';

const GT = A.Gigertron;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return U1[0]!; };
const mix = (h: number, v: number): number => { h = Math.imul(h ^ (v >>> 0), 16777619); return h ^ (h >>> 13); };
const f = Math.fround;

/** a synthetic stream: beats every 23 frames over a slow sweep (our own) */
function stream(fr: number): TimedLevel {
  return level(2, (L) => {
    const beat = fr % 23 < 3 ? 120 : 0;
    for (let i = 0; i < 1024; i++) L.freq[0][i] = Math.max(0, Math.min(255, (beat + 90 * (1 + Math.sin(i / 40 + fr / 17)) - i / 8) | 0));
  });
}

/** a stand-in device that folds every call (its name, numbers, float arrays by bits, buffers by content) into a hash */
function recorder(quiet = false): { device: (w: number, h: number) => Device9; key: () => number; clears: () => number } {
  let h = 0x811c9dc5, clears = 0;
  const fold = (v: unknown): void => {
    if (typeof v === 'number') h = mix(h, bits(v));
    else if (v instanceof Float32Array) for (const x of v) h = mix(h, bits(x));
    else if (v instanceof Uint8Array) for (let i = 0; i < v.length; i += 7) h = mix(h, v[i]!);
  };
  const surface = () => {
    const data = new Uint8Array(256 * 1024);
    return { width: 256, height: 256, format: 21, lockRect: () => ({ data, pitch: 1024 }), unlockRect: () => fold(data) };
  };
  const buffer = (n: number) => { const b = new Uint8Array(n); return { length: n, lock: () => b, unlock: () => { if (!quiet) fold(b); } }; };
  const make = (): Device9 => {
    const bb = surface();
    return new Proxy({}, {
      get: (_t, k: string) => {
        if (k === 'createTexture') return () => { const s = surface(); return { getSurfaceLevel: () => s }; };
        if (k === 'createVertexBuffer' || k === 'createIndexBuffer') return buffer;
        if (k === 'getBackBuffer') return () => bb;
        if (k === 'present') return () => new Uint8Array(4);
        return (...args: unknown[]) => {
          if (k === 'clear') clears++;
          for (let i = 0; i < k.length; i++) h = mix(h, k.charCodeAt(i));
          args.forEach(fold);
          return 1;
        };
      },
    }) as unknown as Device9;
  };
  return { device: make, key: () => h >>> 0, clears: () => clears };
}

describe('Gigertron 3D: presets and input', () => {
  it('the menu holds the three presets the original runs on the reference device', () => {
    expect(GT.PRESET_NAMES).toEqual(['Cubetro', 'Syntax', 'Northern']);
    const e = new GT({ options: { device: recorder().device } });
    expect(e.setPreset(2)).toBe(true);
    expect(e.setPreset(3)).toBe(false);
  });

  it('reads the sound: silence and the stream draw differently', () => {
    const run = (loud: boolean): number => {
      const r = recorder(), e = new GT({ width: 160, height: 120, preset: 0, options: { device: r.device } }).seed(7);
      for (let fr = 0; fr < 10; fr++) e.render(loud ? stream(fr) : level(2));
      return r.key();
    };
    expect(run(true)).not.toBe(run(false));
  });

  it('Syntax clears only on its 402nd frame and every 402 after; Cubetro every frame', () => {
    const count = (preset: number, n: number): number => {
      const r = recorder(true), e = new GT({ width: 32, height: 24, preset, options: { device: r.device } }).seed(1);
      for (let fr = 0; fr < n; fr++) e.render(null);
      return r.clears();
    };
    expect(count(1, 401)).toBe(0);
    expect(count(1, 402)).toBe(1);
    expect(count(1, 804)).toBe(2);
    expect(count(0, 5)).toBe(5);
  }, 60_000);
});

describe('Gigertron 3D: the field', () => {
  it('Create: heights rand() * 10 / 32768, bars 6 apart and 5 wide, opaque random colours', () => {
    const s = new Scene();
    s.init(0, 1);
    A.srand(1);
    expect(s.table[0]).toBe(f(f(A.rand() * 2 ** -15) * 10));
    // bar j of the first ring spans x 6j -+ 2.5, z -+ its height; zero-height bars are sent off to x = 1e6
    for (const j of [3, 17]) {
      const h = s.table[j]!, v = j * 24 * 9;
      if (h >= 1) {
        expect(s.fv[v]).toBe(6 * j - 2.5);
        expect(s.fv[v + 2]).toBe(h);
        expect(s.fv[(j * 24 + 4) * 9]).toBe(6 * j + 2.5);
      }
    }
    for (let v = 0; v < 1000; v++) expect(s.uv[v * 9 + 6]! >>> 24).toBe(0xff);
  });

  it('the first frame widens the bars to 5.5 (frame time 0 ms), then they stay; the spectrum lands in row 0', () => {
    const s = new Scene(), freq = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) freq[i] = i & 255;
    s.init(7, 1);
    s.step(7, freq, 0, 320, 240);
    expect(s.width).toBe(5.5);
    expect(s.table[1]).toBe(30);
    expect(s.row).toBe(49);
    expect(s.roll).toBe(f(0.02));
    s.step(7, freq, 16, 320, 240);
    expect(s.width).toBe(5.5);
    expect(s.roll).toBe(f(f(0.02) + f(0.02)));
    expect(s.aspect).toBe(f(-4 / 3));
  });

  it('yaw-pitch-roll with only a roll turns about z', () => {
    const m = rotationYawPitchRoll(new Float32Array(16), 0, 0, 0.5);
    expect(m[0]).toBeCloseTo(Math.cos(0.5), 6);
    expect(m[1]).toBeCloseTo(Math.sin(0.5), 6);
    expect(m[4]).toBeCloseTo(-Math.sin(0.5), 6);
    expect([m[2], m[8], m[9], m[10], m[15]]).toEqual([0, 0, 0, 1, 1]);
  });
});

// ---- golden: calls of the three checked presets (key every 30 frames over 120), pixels for 3 frames at 96 x 72
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'gigertron.json');
/** menu index -> the DLL's preset number (the fixture's keys) */
const CHECKED = [[0, 0], [1, 7], [2, 8]];

function goldenCalls(preset: number): string[] {
  const r = recorder(), e = new GT({ width: 320, height: 240, preset, options: { device: r.device } }).seed(1058270499);
  const out: string[] = [];
  for (let fr = 0; fr < 120; fr++) { e.render(stream(fr)); if ((fr + 1) % 30 === 0) out.push(r.key().toString(16).padStart(8, '0')); }
  return out;
}
function goldenPixels(preset: number): string[] {
  const e = new GT({ width: 96, height: 72, preset }).seed(1058270499);
  const out: string[] = [];
  for (let fr = 0; fr < 3; fr++) {
    const s = e.render(stream(fr))!;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.px.length; i++) h = mix(h, s.px[i]!);
    out.push((h >>> 0).toString(16).padStart(8, '0'));
  }
  return out;
}

describe.skipIf(process.env.GOLDEN_UPDATE !== '1' && !existsSync(GOLDEN))('Gigertron 3D: golden', () => {
  const update = process.env.GOLDEN_UPDATE === '1';
  const want: Record<string, string[]> = update || !existsSync(GOLDEN) ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const got: Record<string, string[]> = {};
  for (const [m, p] of CHECKED) {
    it(`calls p${p} ${GT.PRESET_NAMES[m!]}`, () => {
      got[`calls-p${p}`] = goldenCalls(m!);
      if (!update) expect(got[`calls-p${p}`]).toEqual(want[`calls-p${p}`]);
    }, 120_000);
    it(`pixels p${p} ${GT.PRESET_NAMES[m!]}`, () => {
      got[`pixels-p${p}`] = goldenPixels(m!);
      if (!update) expect(got[`pixels-p${p}`]).toEqual(want[`pixels-p${p}`]);
    }, 120_000);
  }
  it('fixture', () => {
    if (update) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    expect(Object.keys(update ? got : want).length).toBe(6);
  });
});
