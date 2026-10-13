// Goom (src/goom, Alchemy.Goom): the presets and sizes, what drives it (the samples, the play state and the
// seed, no clock), pieces with fixed behaviour (the line drawer, the brightness copy, the particles' direction
// tables), then a golden guard over the port's own output on a synthetic stream. The fixture
// (./golden/fixtures/goom.json) was written once the engine was verified frame-identical to the DLL:
// GOLDEN_UPDATE=1 npx vitest run tests/goom.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, type TimedLevel } from '../src/ns';
import '../src/rand';
import '../src/goom/index';
import { drawLine, addSat } from '../src/goom/draw';
import { createOutputWithBrightness } from '../src/goom/convolve';
import { nativeSize, fixedSize, samplingOf, PRESETS } from '../src/index';
import { level } from './helpers-2';

const G = A.Goom;

/** our own test signal: a drifting chord, a kick every 24 frames, some noise; state 2 unless told */
function stream(): (f: number, state?: number) => TimedLevel {
  const L = level(2);
  let s = 12345;
  return (f, state = 2) => {
    const kick = f % 24 < 3 ? 1 - (f % 24) / 3 : 0;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 1024; i++) {
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        const t = f * 512 + i;
        const v = 40 * Math.sin(t * (0.031 + 0.004 * c)) + 25 * Math.sin(t * 0.0071 + f * 0.01) + 90 * kick * Math.sin(t * 0.002)
          + ((s >>> 24) - 128) * 0.15;
        L.wave[c]![i] = Math.max(0, Math.min(255, 128 + Math.round(v)));
      }
    }
    L.state = state;
    L.timeStamp = f * 166667;
    return L;
  };
}

describe('Goom', () => {
  it('four presets, the resolutions, drawn at that size whatever the view, nearest', () => {
    expect(G.PRESET_NAMES).toEqual(['Goom at 320x240', 'Goom at 480x360', 'Goom at 640x480', 'Goom at 800x600']);
    expect([0, 1, 2, 3].map((p) => nativeSize('goom', 1920, 1080, p))).toEqual([[320, 240], [480, 360], [600, 480], [800, 600]]);
    expect([fixedSize('goom', 0), samplingOf('goom', 0)]).toEqual([true, 'nearest']);
    expect(PRESETS.filter((p) => p.vis === 'goom').map((p) => p.key)).toEqual(['Wmp9_goom', 'Wmp9_goom', 'Wmp9_goom', 'Wmp9_goom']);
    const g = new G({ preset: 2, seed: 1 });
    const s = g.render(stream()(0))!;
    expect([s.w, s.h, s.px.length]).toEqual([600, 480, 600 * 480]);
    expect(g.setPreset(3)).toBe(true);
    expect([g.render(stream()(1))!.w, g.setPreset(4)]).toEqual([800, false]);
  }, 60_000);

  it('the same seed and samples give the same frames; another seed or silence do not', () => {
    const run = (seed: number, silent: boolean) => {
      const g = new G({ seed }), st = stream(), sil = level(2, (l) => { l.wave[0].fill(128); l.wave[1].fill(128); });
      let h = 0;
      for (let f = 0; f < 150; f++) {
        const px = g.render(silent ? sil : st(f))!.px;
        for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i]!, 16777619);
      }
      return h >>> 0;
    };
    expect(run(5, false)).toBe(run(5, false));
    expect(run(5, false)).not.toBe(run(6, false));
    expect(run(5, false)).not.toBe(run(5, true));
  }, 180_000);

  it('output is 0x00RRGGBB', () => {
    const g = new G({ seed: 3 }), st = stream();
    let or = 0;
    for (let f = 0; f < 120; f++) { const px = g.render(st(f))!.px; for (let i = 0; i < px.length; i++) or |= px[i]!; }
    expect(or >>> 24).toBe(0);
    expect(or & 0xffffff).not.toBe(0);
  }, 120_000);

  it('the line drawer: a saturating add per byte; a line with an end off the buffer is not drawn at all', () => {
    expect(addSat(0x10f0fe01, 0x10203004).toString(16)).toBe('20ffff05');
    const p = new Uint32Array(8 * 8);
    drawLine(p, 1, 1, 6, 4, 0x40, 8, 8);
    expect(p.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(6);
    const q = new Uint32Array(8 * 8);
    drawLine(q, 1, 1, 8, 4, 0x40, 8, 8);
    drawLine(q, -1, 1, 4, 4, 0x40, 8, 8);
    expect(q.every((v) => v === 0)).toBe(true);
  });

  it('the brightness copy: a straight copy at 256, else every pixel but the last', () => {
    const src = new Uint32Array([0x102030, 0xffffff, 0x808080]), dst = new Uint32Array([1, 2, 3]);
    createOutputWithBrightness(src, dst, 3, 256);
    expect([...dst]).toEqual([...src]);
    const d2 = new Uint32Array([1, 2, 3]);
    createOutputWithBrightness(src, d2, 3, 512);
    expect([...d2]).toEqual([0x204060, 0xffffff, 3]);
  });
});

// ---- golden: per 100-frame block, a fold of every frame's surface, on the synthetic stream (with a stopped
// stretch, so the idle timer runs) at each preset; a second seed.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'goom.json');
interface GRun { id: string; preset: number; seed: number; frames: number }
const RUNS: GRun[] = [
  { id: 'goom-p0-s1', preset: 0, seed: 1, frames: 1200 },
  { id: 'goom-p0-s2026', preset: 0, seed: 2026, frames: 600 },
  { id: 'goom-p1-s1', preset: 1, seed: 1, frames: 300 },
  { id: 'goom-p2-s7', preset: 2, seed: 7, frames: 200 },
  { id: 'goom-p3-s1', preset: 3, seed: 1, frames: 200 },
];

function runGolden(r: GRun): string[] {
  const g = new G({ preset: r.preset, seed: r.seed }), st = stream();
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < r.frames; f++) {
    const px = g.render(st(f, f >= 400 && f < 520 ? 1 : 2))!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Goom: golden', () => {
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
