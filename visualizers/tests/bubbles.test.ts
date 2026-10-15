// Bubbles (the Psychedelia Viz Pack's Bubbles.dll, Alchemy.Bubbles): presets, what drives it (the sound, rand),
// the D3DX math it relies on, then a golden guard over the port's own output on a synthetic stream: the draws (a
// recording stand-in for the device: shaders, textures, vertex constants, every preset) and a few frames of pixels
// (the reference device, our own artwork). The fixture (./golden/fixtures/bubbles.json) was written once the engine
// was verified against the DLL: GOLDEN_UPDATE=1 npx vitest run tests/bubbles.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/psychedelia/bubbles/index';
import type { Device9 } from '../src/d3d9/api';
import { lookAtRH, vec3Normalize } from '../src/psychedelia/d3dx9';
import { level } from './helpers-2';
import type { TimedLevel } from '../src/ns';

const B = A.Bubbles;
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

/** a stand-in device that folds every draw's shaders, textures (by content) and vertex constants into a hash */
function recorder(): { device: (w: number, h: number) => Device9; key: () => number } {
  let h = 0x811c9dc5;
  const make = (): Device9 => {
    const st = { vs: 0, ps: 0, tex: [0, 0, 0], c: new Uint32Array(28) };
    const surf = (t: { sum: number; px: Uint8Array }) => ({
      width: 256, height: 256, format: 21,
      lockRect: () => ({ data: t.px, pitch: 1024 }), unlockRect: () => { let s = 0x811c9dc5; for (let i = 0; i < t.px.length; i += 7) s = mix(s, t.px[i]!); t.sum = s; },
    });
    const bb = { width: 1, height: 1, format: 22, lockRect: () => ({ data: new Uint8Array(4), pitch: 4 }), unlockRect: () => {} };
    let shaders = 0;
    const dev = {
      createTexture: () => { const t = { sum: 0, px: new Uint8Array(256 * 1024) }, s = surf(t); return { width: 256, height: 256, levels: 0, format: 21, t, getSurfaceLevel: () => s, lockRect: s.lockRect, unlockRect: s.unlockRect }; },
      createVertexBuffer: (n: number) => { const b = new Uint8Array(n); return { length: n, lock: () => b, unlock: () => {} }; },
      createVertexDeclaration: () => 1,
      createVertexShader: (t: Uint32Array) => { h = mix(h, t.length); return ++shaders; },
      createPixelShader: (t: Uint32Array) => { h = mix(h, t.length); return ++shaders; },
      updateSurface: (src: { unlockRect(): void }, _r: unknown, dst: { lockRect(): { data: Uint8Array } }) => { dst.lockRect().data.set((src as unknown as { lockRect(): { data: Uint8Array } }).lockRect().data); (dst as unknown as { unlockRect(): void }).unlockRect(); },
      clear: () => { h = mix(h, 0xc1ea4); },
      beginScene: () => {}, endScene: () => {}, present: () => new Uint8Array(4),
      setStreamSource: () => {}, setVertexDeclaration: () => {}, setRenderState: () => {}, setSamplerState: () => {},
      setVertexShader: (x: number) => { st.vs = x; }, setPixelShader: (x: number) => { st.ps = x; },
      setTexture: (s: number, t: { t: { sum: number } } | null) => { st.tex[s] = t ? t.t.sum : 0; },
      setVertexShaderConstantF: (r: number, d: Float32Array, n: number) => { for (let k = 0; k < n * 4; k++) st.c[r * 4 + k] = bits(d[k]!); },
      setPixelShaderConstantF: () => {},
      drawPrimitive: (t: number, s: number, n: number) => {
        h = mix(mix(mix(mix(mix(h, t), s), n), st.vs), st.ps);
        for (const x of st.tex) h = mix(h, x);
        for (const x of st.c) h = mix(h, x);
      },
      getBackBuffer: () => bb,
    };
    return dev as unknown as Device9;
  };
  return { device: make, key: () => h >>> 0 };
}

describe('Bubbles: presets and input', () => {
  it('the DLL\'s four presets in GetPresetTitle order', () => {
    expect(B.PRESET_NAMES).toEqual(['Random', 'Centered', 'Gravity', 'Pop']);
    const e = new B({ options: { device: recorder().device } });
    expect(e.setPreset(3)).toBe(true);
    expect(e.setPreset(4)).toBe(false);
  });

  it('reads the sound: Gravity sizes each bubble by its band, silence and the stream draw differently', () => {
    const run = (loud: boolean): number => {
      const r = recorder(), e = new B({ width: 160, height: 120, preset: 2, options: { device: r.device } }).seed(7);
      for (let f = 0; f < 40; f++) e.render(loud ? stream(f) : level(2));
      return r.key();
    };
    expect(run(true)).not.toBe(run(false));
  });

  it('rand seeds the bubbles\' colours and first moves (srand at device creation)', () => {
    const run = (seed: number): number => {
      const r = recorder(), e = new B({ width: 160, height: 120, preset: 1, options: { device: r.device } }).seed(seed);
      for (let f = 0; f < 5; f++) e.render(stream(f));
      return r.key();
    };
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(2));
  });
});

describe('Bubbles: D3DX 9 math', () => {
  it('normalize keeps a unit-length vector and approximates 1/sqrt with its table (no Newton step)', () => {
    expect(Array.from(vec3Normalize(Float32Array.of(1, 0, 0)))).toEqual([1, 0, 0]);
    expect(bits(vec3Normalize(Float32Array.of(0, 0, 50))[2]!)).toBe(0x3f800008);
  });
  it('the view of the camera at (0, 0, 50)', () => {
    const v = lookAtRH(new Float32Array(16), [0, 0, 50], [0, 0, 0], [0, 1, 0]);
    expect([bits(v[0]!), bits(v[5]!), bits(v[10]!), v[14]]).toEqual([0x3f800008, 0x3f800010, 0x3f800008, -50.00004577636719]);
  });
});

// ---- golden: draws of every preset (key every 50 frames over 300), pixels of each preset for 3 frames at 96 x 72
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'bubbles.json');

function goldenDraws(preset: number): string[] {
  const r = recorder(), e = new B({ width: 320, height: 240, preset, options: { device: r.device } }).seed(1058270499);
  const out: string[] = [];
  for (let f = 0; f < 300; f++) { e.render(stream(f)); if ((f + 1) % 50 === 0) out.push(r.key().toString(16).padStart(8, '0')); }
  return out;
}
function goldenPixels(preset: number): string[] {
  const e = new B({ width: 96, height: 72, preset }).seed(1058270499);
  const out: string[] = [];
  for (let f = 0; f < 3; f++) {
    const s = e.render(stream(f))!;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.px.length; i++) h = mix(h, s.px[i]!);
    out.push((h >>> 0).toString(16).padStart(8, '0'));
  }
  return out;
}

describe.skipIf(process.env.GOLDEN_UPDATE !== '1' && !existsSync(GOLDEN))('Bubbles: golden', () => {
  const update = process.env.GOLDEN_UPDATE === '1';
  const want: Record<string, string[]> = update || !existsSync(GOLDEN) ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const got: Record<string, string[]> = {};
  for (let p = 0; p < 4; p++) {
    it(`draws p${p} ${B.PRESET_NAMES[p]}`, () => {
      got[`draws-p${p}`] = goldenDraws(p);
      if (!update) expect(got[`draws-p${p}`]).toEqual(want[`draws-p${p}`]);
    }, 120_000);
    it(`pixels p${p} ${B.PRESET_NAMES[p]}`, () => {
      got[`pixels-p${p}`] = goldenPixels(p);
      if (!update) expect(got[`pixels-p${p}`]).toEqual(want[`pixels-p${p}`]);
    }, 300_000);
  }
  it('fixture', () => {
    if (update) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    expect(Object.keys(update ? got : want).length).toBe(8);
  });
});
