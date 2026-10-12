// Musical Colors (WMP 7 / 7.1 / 8 wmpvis.dll; Render 0x55c0d71c): presets, the native size (the view;
// the DLL scales its 350 x 320 canvas itself, at most 3x), what the frame reads (freq[0] and, in WMP 8, the
// play state), rand use, the generated images, the version variant; then a golden guard over a synthetic
// stream. The fixture (./golden/fixtures/musical.json) is the port's own output on its generated images
// (images.ts), written once the engine was verified frame-identical to the DLL on the original images:
// GOLDEN_UPDATE=1 npx vitest run tests/engine/musical.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/musical/index';
import { ftol } from '../../src/engine/musical/core';
import { musicalImages } from '../../src/engine/musical/images';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const MC = A.MusicalColors;

function loud(f: number) {
  return level(2, (L) => { for (let i = 0; i < 1024; i++) L.freq[0][i] = (i * 7 + f * 13) % 256; });
}
function countRand(fn: () => void): number {
  let n = 0;
  const real = A.rand;
  A.rand = () => { n++; return real(); };
  try { fn(); } finally { A.rand = real; }
  return n;
}

describe('MusicalColors: presets and size', () => {
  it("WMP 8 SP1's 20 presets, then WMP 7's own 20th as a variant", () => {
    expect(MC.PRESET_NAMES.length).toBe(21);
    expect(MC.PRESET_NAMES[0]).toBe('Night Lights');
    expect(MC.PRESET_NAMES[19]).toBe('Ice Crystals');
    expect(MC.PRESET_NAMES[20]).toBe('WinMe 3D (WMP 7)');
    const m = new MC({});
    expect(m.setPreset(20)).toBe(true);
    expect(m.setPreset(21)).toBe(false);
    expect(m.setPreset(-1)).toBe(false);
    expect(m.preset).toBe(20);
  }, 120_000);

  it('the default is a real preset (WMP always calls SetCurrentPreset; id 0 would draw nothing)', () => {
    const m = new MC({ width: 350, height: 320 });
    let s = m.render(loud(0))!;
    for (let f = 1; f < 20; f++) s = m.render(loud(f))!;
    expect(s.px.some((v) => v !== 0)).toBe(true);
  }, 120_000);

  it('the surface is the view; the canvas is scaled at most 3x and the rest stays black', () => {
    const m = new MC({ width: 1280, height: 1024, preset: 7 });
    let s = m.render(loud(0))!;
    for (let f = 1; f < 40; f++) s = m.render(loud(f))!;
    expect([s.w, s.h, s.px.length]).toEqual([1280, 1024, 1280 * 1024]);
    let inside = 0, outside = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1280; x++) {
      const v = s.px[y * 1280 + x]!;
      if (x < 1050 && y < 960) { if (v) inside++; } else if (v) outside++;
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBe(0);
    m.resize(200, 150);
    s = m.render(loud(41))!;
    expect([s.w, s.h]).toEqual([200, 150]);
  }, 120_000);

  it('pixels are 0x00RRGGBB', () => {
    const m = new MC({ width: 320, height: 240, preset: 6 });
    let s = m.render(loud(0))!;
    for (let f = 1; f < 30; f++) s = m.render(loud(f))!;
    expect(s.px.every((v) => v >>> 24 === 0)).toBe(true);
  }, 120_000);
});

describe('MusicalColors: input', () => {
  it('reads only freq[0] (and the play state): wave, freq[1] and timestamp change nothing', () => {
    const a = new MC({ width: 320, height: 240, preset: 2 }), b = new MC({ width: 320, height: 240, preset: 2 });
    for (let f = 0; f < 60; f++) {
      const L = loud(f), M = loud(f);
      M.freq[1].fill(f); M.wave[0].fill(255 - f); M.wave[1].fill(f); M.state = [2, 3, -1][f % 3]!; M.timeStamp = f * 99991;
      expect(Array.from(b.render(M)!.px)).toEqual(Array.from(a.render(L)!.px));
    }
  }, 120_000);

  it('WMP 8: stopped / paused clears the view and holds the animation; WMP 7 ignores the state', () => {
    for (const [p, v8] of [[7, true], [20, false]] as const) {
      const a = new MC({ width: 320, height: 240, preset: p }), b = new MC({ width: 320, height: 240, preset: p });
      let sa = a.render(loud(0))!, sb = b.render(loud(0))!;
      for (let f = 1; f < 30; f++) {
        sa = a.render(loud(f))!;
        const M = loud(f);
        M.state = f >= 10 && f < 15 ? f % 2 : 2;
        sb = b.render(M)!;
        if (v8 && M.state < 2) expect(sb.px.every((v) => v === 0)).toBe(true);
      }
      const same = Array.from(sa.px).every((v, i) => v === sb.px[i]);
      expect(same).toBe(!v8);                    // WMP 8 skipped five frames' work, WMP 7 did not
    }
  }, 120_000);

  it('responds to sound: silence and music diverge', () => {
    const a = new MC({ width: 320, height: 240, preset: 0 }), b = new MC({ width: 320, height: 240, preset: 0 });
    let sa = a.render(level(2))!, sb = b.render(loud(0))!;
    for (let f = 1; f < 40; f++) { sa = a.render(level(2))!; sb = b.render(loud(f))!; }
    expect(Array.from(sa.px)).not.toEqual(Array.from(sb.px));
  }, 120_000);

  it('rand: none in Night Lights; Soft Fire scrambles the spectrum with it every frame', () => {
    const a = new MC({ width: 320, height: 240, preset: 0 }), b = new MC({ width: 320, height: 240, preset: 6 });
    a.render(loud(0)); b.render(loud(0));
    expect(countRand(() => { for (let f = 1; f < 10; f++) a.render(loud(f)); })).toBe(0);
    expect(countRand(() => b.render(loud(10)))).toBeGreaterThan(255);
  }, 120_000);

  it('_ftol truncates toward zero and keeps the low dword', () => {
    expect([ftol(2.9), ftol(-2.9), ftol(4294967298.5), ftol(NaN), ftol(1e300)]).toEqual([2, -2, 2, 0, 0]);
  }, 120_000);
});

describe('MusicalColors: generated images', () => {
  it('42 images at the sizes the presets bind; solid fills where the originals are solid', () => {
    const im = musicalImages();
    expect(im.length).toBe(43);
    const size = (i: number) => im[i]!.w + 'x' + im[i]!.h;
    expect([1, 10, 36].map(size)).toEqual(['350x320', '350x320', '350x320']);
    expect(size(37)).toBe('1x1024');
    expect(size(39)).toBe('1x255');
    expect(size(40)).toBe('1x9');
    for (const i of [4, 6, 9, 12, 13, 20, 21, 30, 35, 42]) expect(size(i)).toBe('3x256');
    expect(im[2]!.type).toBe(0x16);
    expect(Array.from(im[11]!.px).every((v) => v === 0x0000ff)).toBe(true);
    expect(Array.from(im[1]!.px).every((v) => v === 0)).toBe(true);
    for (let i = 1; i <= 42; i++) expect(Array.from(im[i]!.px).every((v) => v >>> 24 === 0)).toBe(true);
  });

  it('the starburst rises from its centre outward', () => {
    const s = musicalImages()[36]!.px;
    expect(s[159 * 350 + 175]!).toBeLessThan(12);
    expect(s[0]!).toBe(255);
  });
});

describe('MusicalColors: versions', () => {
  it("Ice Crystals (8) and WinMe 3D (7) differ; switching between them rebuilds the scene", () => {
    const run = (p: number) => {
      const m = new MC({ width: 320, height: 240, preset: p });
      let s = m.render(loud(0))!;
      for (let f = 1; f < 30; f++) s = m.render(loud(f))!;
      return Array.from(s.px);
    };
    const ice = run(19), winme = run(20);
    expect(ice).not.toEqual(winme);
    const m = new MC({ width: 320, height: 240, preset: 19 });
    for (let f = 0; f < 10; f++) m.render(loud(f));
    m.setPreset(20);
    let s = m.render(loud(0))!;
    for (let f = 1; f < 30; f++) s = m.render(loud(f))!;
    expect(s.px.some((v) => v !== 0)).toBe(true);
  }, 120_000);
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface and its rand() count, on
// InputGen's stream, srand(seed) first. Every preset at 320 x 240, a few at other sizes, a preset switch
// mid-run (WMP switches live) and the WMP 7 variant.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'musical.json');
interface GRun { id: string; preset: number; w: number; h: number; seed: number; sw?: [number, number] }
const RUNS: GRun[] = [
  ...MC.PRESET_NAMES.map((_, preset): GRun => ({ id: `musical-p${preset}`, preset, w: 320, h: 240, seed: 1 })),
  { id: 'musical-p4-640x480-s12345', preset: 4, w: 640, h: 480, seed: 12345 },
  { id: 'musical-p15-1280x1024', preset: 15, w: 1280, h: 1024, seed: 1 },
  { id: 'musical-p6-200x150-s7', preset: 6, w: 200, h: 150, seed: 7 },
  { id: 'musical-p1-switch-to-11', preset: 1, w: 320, h: 240, seed: 1, sw: [150, 11] },
  { id: 'musical-p19-switch-to-20', preset: 19, w: 320, h: 240, seed: 1, sw: [120, 20] },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  let randN = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    A.srand(r.seed);
    const gen = new InputGen(), m = new MC({ width: r.w, height: r.h, preset: r.preset });
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (let f = 0; f < FRAMES; f++) {
      const L = gen.next();
      if (r.sw && f === r.sw[0]) m.setPreset(r.sw[1]);
      randN = 0;
      const px = m.render(L)!.px;
      for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
      bh = Math.imul(bh ^ randN, 16777619);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('MusicalColors: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${FRAMES} frames`, () => {
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
