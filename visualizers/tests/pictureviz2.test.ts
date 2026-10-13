// PictureViz_II ("Picture It! Visualization 2", Alchemy.PictureViz2): presets and variants, the native size (the
// view), what drives it (the clock and the pictures, never the sound), the folder semantics of setPictures, rand
// use; then a golden guard over the port's own output on synthetic pictures and a pinned clock. The fixture
// (./golden/fixtures/pictureviz2.json) was written once the engine was verified frame-identical to the DLLs:
// GOLDEN_UPDATE=1 npx vitest run tests/pictureviz2.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/pictureviz/pv2/index';
import type { Picture } from '../src/pictureviz/picture';
import { level } from './helpers-2';

const PV = A.PictureViz2;

/** synthetic pictures: a gradient, a checkerboard, rings (our own, deterministic) */
function pic(kind: number, w: number, h: number): Picture {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (kind === 0) { rgb[i] = (x * 255 / (w - 1)) | 0; rgb[i + 1] = (y * 255 / (h - 1)) | 0; rgb[i + 2] = ((x + y) * 255 / (w + h - 2)) | 0; }
    else if (kind === 1) { const k = ((x >> 3) + (y >> 3)) & 1; rgb[i] = k ? 230 : 20; rgb[i + 1] = k ? 40 : 200; rgb[i + 2] = k ? 40 : 240; }
    else { const d = Math.hypot(x - w / 2, y - h / 2), v = (127.5 + 127.5 * Math.sin(d / 3)) | 0; rgb[i] = v; rgb[i + 1] = 255 - v; rgb[i + 2] = (v * 3) & 255; }
  }
  return { w, h, rgb };
}
const PICS = [pic(0, 96, 72), pic(1, 60, 90), pic(2, 80, 80)];
const COVER = [pic(2, 64, 64)];

/** an engine on a pinned clock: tick() returns `t.now`, advanced 50/3 ms a frame (60 fps) */
function make(preset: number, w = 160, h = 120, pictures: Picture[] = PICS, seed = 1) {
  const t = { now: 1000000, f: 0 };
  const e = new PV({ width: w, height: h, preset, pictures, tick: () => t.now });
  e.seed(seed);
  const step = (L = level(2)) => { t.now = (1000000 + Math.floor(++t.f * 50 / 3)) | 0; return e.render(L)!; };
  return { e, step };
}

describe('PictureViz2: presets and size', () => {
  it('the 31 presets of the gallery build, then the Winter Edition as variants', () => {
    expect(PV.PRESET_NAMES.length).toBe(62);
    expect(PV.PRESET_NAMES[0]).toBe('Favorite Transitions');
    expect(PV.PRESET_NAMES[5]).toBe('Basic - Pop Transition');
    expect(PV.PRESET_NAMES[30]).toBe('Radial');
    expect(PV.PRESET_NAMES[36]).toBe('Basic - Pop Transition (Winter Edition)');
    const e = new PV({});
    expect(e.setPreset(61)).toBe(true);
    expect(e.setPreset(62)).toBe(false);
    expect(e.setPreset(-1)).toBe(false);
  });

  it('the surface is the view, pixels 0x00RRGGBB; the picture sits in a frame on the background picture', () => {
    const { step } = make(5, 200, 150);
    let s = step();
    for (let f = 0; f < 20; f++) s = step();
    expect([s.w, s.h, s.px.length]).toEqual([200, 150, 200 * 150]);
    expect(s.px.every((v) => v >>> 24 === 0)).toBe(true);
    expect(new Set(s.px).size).toBeGreaterThan(100);
  }, 60_000);

  it('the Winter Edition differs (its frame is red by default)', () => {
    const a = make(5), b = make(36);
    let sa = a.step(), sb = b.step();
    for (let f = 0; f < 20; f++) { sa = a.step(); sb = b.step(); }
    expect(Array.from(sa.px)).not.toEqual(Array.from(sb.px));
  }, 60_000);
});

describe('PictureViz2: input', () => {
  it('never reads the TimedLevel: silence and loud input render the same', () => {
    const a = make(9), b = make(9);
    for (let f = 0; f < 200; f++) {
      const M = level(2, (L) => { for (let i = 0; i < 1024; i++) { L.freq[0][i] = (i * 7 + f) & 255; L.wave[0][i] = (i + f * 3) & 255; } });
      M.state = f % 3;
      expect(Array.from(b.step(M).px)).toEqual(Array.from(a.step().px));
    }
  }, 120_000);

  it('the clock drives it: the picture changes after How_often_should_picture_be_changed (2 s) and more', () => {
    const { step } = make(5);
    let s = step();
    for (let f = 0; f < 20; f++) s = step();
    const first = Array.from(s.px);
    for (let f = 0; f < 60; f++) s = step();
    expect(Array.from(s.px)).toEqual(first);                // one second later: the same picture
    for (let f = 0; f < 320; f++) s = step();
    expect(Array.from(s.px)).not.toEqual(first);            // (the gallery build shows the second for one tick at ~3 s, then the first again until ~6 s)
  }, 60_000);

  it('no pictures: a plain background, no error; setPictures makes the DLL count its "folder" again', () => {
    const { e, step } = make(5, 160, 120, []);
    let s = step();
    for (let f = 0; f < 30; f++) s = step();
    expect(s.px.every((v) => v === s.px[0])).toBe(true);
    e.setPictures(COVER);
    for (let f = 0; f < 30; f++) s = step();
    expect(new Set(s.px).size).toBeGreaterThan(50);
  }, 60_000);

  it('rand: none for a single transition; the random selections draw once a picture', () => {
    const count = (preset: number) => {
      let n = 0;
      const real = A.rand;
      A.rand = () => { n++; return real(); };
      try { const { step } = make(preset); for (let f = 0; f < 400; f++) step(); } finally { A.rand = real; }
      return n;
    };
    expect(count(5)).toBe(0);
    expect(count(1)).toBeGreaterThan(0);
  }, 120_000);
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface, on the pinned clock and the
// synthetic pictures; every preset at 160 x 120 (the gallery build, a few of the Winter Edition), a single
// cover, another size and seed.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'pictureviz2.json');
interface GRun { id: string; preset: number; w: number; h: number; seed: number; cover?: boolean }
const RUNS: GRun[] = [
  ...PV.PRESET_NAMES.slice(0, 31).map((_, preset): GRun => ({ id: `pv2-p${preset}`, preset, w: 160, h: 120, seed: 1 })),
  ...[31, 36, 46, 57].map((preset): GRun => ({ id: `pv2-p${preset}`, preset, w: 160, h: 120, seed: 1 })),
  { id: 'pv2-p4-cover-s7', preset: 4, w: 160, h: 120, seed: 7, cover: true },
  { id: 'pv2-p22-320x200', preset: 22, w: 320, h: 200, seed: 1 },
];
const FRAMES = 500;

function runGolden(r: GRun): string[] {
  const { step } = make(r.preset, r.w, r.h, r.cover ? COVER : PICS, r.seed);
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px = step().px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('PictureViz2: golden', () => {
  const update = process.env.GOLDEN_UPDATE === '1' || !existsSync(GOLDEN);
  const want: Record<string, string[]> = update ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const got: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(r.id, () => {
      got[r.id] = runGolden(r);
      if (!update) expect(got[r.id]).toEqual(want[r.id]);
    }, 300_000);
  }
  it('fixture', () => {
    if (update) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    expect(Object.keys(update ? got : want).length).toBe(RUNS.length);
  });
});
