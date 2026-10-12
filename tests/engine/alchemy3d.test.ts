// 3D Alchemy (mpvis3d.dll 9.00.00.2980): presets, the texture size rule, the SSE reciprocal emulation, the
// recreated checkerboards, what the frame reads (the play state; sound through the 2D engine), the call
// stream's determinism; then a golden guard over a synthetic stream. The fixture (./golden/fixtures/alchemy3d.json)
// is the port's own output (pixels, rand() count and Direct3D call stream per frame), written once the port was
// verified call-for-call identical to the DLL: GOLDEN_UPDATE=1 npx vitest run tests/engine/alchemy3d.test.ts
// rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/alchemy3d/index';
import { textureSize } from '../../src/engine/alchemy3d/index';
import { rcp, rsqrt } from '../../src/engine/alchemy3d/math';
import { checkerIndex } from '../../src/engine/alchemy3d/textures';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const A3 = A.Alchemy3D;
const fnv = (h: number, v: number) => Math.imul(h ^ v, 16777619);

describe('3D Alchemy: presets and sizes', () => {
  it('has the six scenes, Draco\'s room last', () => {
    expect(A3.PRESET_NAMES).toEqual(['Classic', 'Kaleidoscope', 'Monoliths', 'Strange world', 'WM Museum', "Draco's room"]);
  });
  it('refuses presets out of range', () => {
    const v = new A3({ width: 64, height: 48 });
    expect(v.setPreset(6)).toBe(false);
    expect(v.setPreset(-1)).toBe(false);
    expect(v.setPreset(1.5)).toBe(false);
    expect(v.setPreset(5)).toBe(true);
    expect(v.preset).toBe(5);
  });
  it('picks the texture size from the window area and the preset', () => {
    expect(textureSize(640, 480, 0)).toBe(512);   // 307200 > 240000, Classic
    expect(textureSize(640, 480, 2)).toBe(256);   // the others stop at 256
    expect(textureSize(490, 490, 0)).toBe(512);
    expect(textureSize(480, 320, 0)).toBe(256);   // 153600: not under
    expect(textureSize(479, 320, 0)).toBe(128);
    expect(new A3({ width: 640, height: 480, preset: 0 }).texSize).toBe(512);
    expect(new A3({ width: 640, height: 480, preset: 3 }).texSize).toBe(256);
    expect(new A3({ width: 320, height: 240, preset: 0 }).texSize).toBe(128);
  });
});

describe('3D Alchemy: arithmetic', () => {
  it('RCPSS / RSQRTSS: 12-bit-accurate, piecewise constant on their mantissa buckets', () => {
    for (const x of [1, 1.5, 2, 3, 0.1, 7.25, 1234.5, 1e-10, -4]) {
      expect(Math.abs(rcp(x) * x - 1)).toBeLessThan(1.5 * 2 ** -12);
      if (x > 0) expect(Math.abs(rsqrt(x) * Math.sqrt(x) - 1)).toBeLessThan(1.5 * 2 ** -12);
    }
    // one bucket: 2^12 float ulps for rcp, 2^13 for rsqrt in [1, 4)
    expect(rcp(1 + 2 ** -11 - 2 ** -23)).toBe(rcp(1));
    expect(rcp(1 + 2 ** -11)).not.toBe(rcp(1));
    expect(rsqrt(1 + 2 ** -10 - 2 ** -23)).toBe(rsqrt(1));
    expect(rcp(1)).toBe(0.999755859375);
    expect(rcp(2)).toBe(rcp(1) / 2);
    expect(rsqrt(4)).toBe(rsqrt(1) / 2);
  });
  it('recreates the museum floor\'s checkerboards (BITMAP 201-203)', () => {
    for (const S of [128, 256, 512]) {
      const a = S / 4, b = S / 2 - S / 128;
      let dark = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) dark += checkerIndex(S, x, y);
      expect(dark).toBe(2 * b * (S - b));
      expect(checkerIndex(S, a - 1, a)).toBe(1);
      expect(checkerIndex(S, a, a)).toBe(0);
      expect(checkerIndex(S, a + b, 0)).toBe(0);
    }
  });
});

describe('3D Alchemy: frames', () => {
  const sum = (px: Uint32Array) => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) h = fnv(h, px[i]!); return h >>> 0; };
  it('draws nothing while stopped or paused, and the clock still runs', () => {
    const v = new A3({ width: 64, height: 48 });
    const a = sum(v.render(level(0))!.px);
    expect(sum(v.render(level(1))!.px)).toBe(a);
    expect(v.frame).toBe(2);
  });
  it('every scene draws, and responds to sound', () => {
    // the 2D engine seeds rand() from time() when made (as the DLL does): seed after. Silence and music from
    // the same seed, one run after the other (rand() is shared), frame by frame.
    const run = (p: number, input: () => ReturnType<InputGen['next']>) => {
      const v = new A3({ width: 160, height: 120, preset: p }).seed(1), out: number[] = [];
      let lit = false;
      for (let f = 0; f < 120; f++) { const px = v.render(input())!.px; out.push(sum(px)); lit ||= px.some((c) => (c & 0xffffff) !== 0); }
      return { out, lit };
    };
    for (let p = 0; p < A3.PRESET_NAMES.length; p++) {
      const quiet = run(p, () => level(3)), gen = new InputGen(), loud = run(p, () => gen.next());
      expect(loud.lit, A3.PRESET_NAMES[p]).toBe(true);
      expect(loud.out.filter((h, i) => h !== quiet.out[i]).length, A3.PRESET_NAMES[p]).toBeGreaterThan(30);
    }
  }, 120_000);
  it('the call stream depends only on the input, the seed and the clock', () => {
    const stream = (clockStep: number) => {
      let t = 0;
      const v = new A3({ width: 320, height: 240, preset: 2, options: { clock: () => (t += clockStep) } }).seed(5);
      v.dev.raster = false; v.dev.recording = true;
      const gen = new InputGen();
      let h = 0x811c9dc5;
      for (let f = 0; f < 60; f++) { v.render(gen.next()); for (const b of v.dev.takeStream()) h = fnv(h, b); }
      return h >>> 0;
    };
    expect(stream(166667)).toBe(stream(166667));
    expect(stream(333333)).not.toBe(stream(166667));
  });
});

// ---- golden: per 100-frame block, a fold of every frame's pixels, its rand() count and its Direct3D call
// stream, on InputGen's stream, srand(seed) once the visualizer is made. Every preset at 320 x 240 (128 texture), Classic at 640 x 480
// (512), Strange world at 640 x 480 (256), and a live preset switch.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'alchemy3d.json');
interface GRun { id: string; preset: number; w: number; h: number; seed: number; frames: number; sw?: [number, number] }
const RUNS: GRun[] = [
  ...A3.PRESET_NAMES.map((_, preset): GRun => ({ id: `alchemy3d-p${preset}`, preset, w: 320, h: 240, seed: 1, frames: 300 })),
  { id: 'alchemy3d-p0-640x480-s12345', preset: 0, w: 640, h: 480, seed: 12345, frames: 200 },
  { id: 'alchemy3d-p3-640x480', preset: 3, w: 640, h: 480, seed: 1, frames: 200 },
  { id: 'alchemy3d-p2-switch-to-4', preset: 2, w: 320, h: 240, seed: 1, frames: 300, sw: [150, 4] },
];

function runGolden(r: GRun): string[] {
  let randN = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    const gen = new InputGen(), v = new A3({ width: r.w, height: r.h, preset: r.preset }).seed(r.seed);
    v.dev.recording = true;
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (let f = 0; f < r.frames; f++) {
      const L = gen.next();
      if (r.sw && f === r.sw[0]) { v.setPreset(r.sw[1]); v.dev.recording = true; }
      randN = 0;
      const px = v.render(L)!.px;
      for (let i = 0; i < px.length; i++) { bh = fnv(bh, px[i]!); bh ^= bh >>> 13; }
      for (const b of v.dev.takeStream()) bh = fnv(bh, b);
      bh = fnv(bh, randN);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('3D Alchemy: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${r.frames} frames`, () => {
      const got = runGolden(r);
      if (process.env.GOLDEN_UPDATE) { fresh[r.id] = got; return; }
      expect(want[r.id], 'no fixture entry').toBeDefined();
      const b = got.findIndex((h, i) => h !== want[r.id]![i]);
      expect(b === -1 ? null : `${r.id}: block ${b} (frames ${b * 100}..${b * 100 + 99}) ${got[b]} vs ${want[r.id]![b]}`).toBe(null);
    }, 300_000);
  }
  it.runIf(!!process.env.GOLDEN_UPDATE)('writes the fixture', () => {
    writeFileSync(GOLDEN, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
  });
});
