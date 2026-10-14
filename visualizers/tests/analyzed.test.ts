// Analyzed (src/analyzed, Alchemy.Analyzed): the presets, the options and sizes, what drives it (the spectrum, the
// waveform, the play state and the clock), the reference-rasterizer pieces with known answers, then a golden guard
// over the port's own output on a synthetic stream. The fixture (./golden/fixtures/analyzed.json) was written once
// the engine was verified frame-identical to the DLL: GOLDEN_UPDATE=1 npx vitest run tests/analyzed.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, type TimedLevel } from '../src/ns';
import '../src/rand';
import '../src/analyzed/index';
import { Blend, Ref9, type Target } from '../src/analyzed/ref9';
import { nativeSize, fixedSize, samplingOf, PRESETS } from '../src/index';
import { level } from './helpers-2';

const Az = A.Analyzed;

/** our own test signal: a drifting chord with a kick every 24 frames as wave and spectrum; state 2 unless told */
function stream(): (f: number, state?: number) => TimedLevel {
  const L = level(2);
  return (f, state = 2) => {
    const kick = f % 24 < 3 ? 1 - (f % 24) / 3 : 0;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 1024; i++) {
        const t = f * 512 + i;
        L.wave[c]![i] = Math.max(0, Math.min(255, 128 + Math.round(60 * Math.sin(t * (0.03 + 0.004 * c)) + 50 * kick * Math.sin(t * 0.002))));
        L.freq[c]![i] = Math.max(0, Math.min(255, Math.round(200 * Math.exp(-i / (90 + 60 * kick)) * (0.6 + 0.4 * Math.sin(f * 0.05 + i * 0.01)))));
      }
    }
    L.state = state;
    L.timeStamp = f * 166667;
    return L;
  };
}
/** a clock in microseconds that steps `ms` per frame */
const clock = (ms: number): { now: () => number; tick: () => void } => { let t = 0; return { now: () => t, tick: () => { t += ms * 1000; } }; };
const hash = (px: Uint32Array): number => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619); return h >>> 0; };

describe('Analyzed: shape', () => {
  it('eight presets under the Effects key Analyzed, after Ambience', () => {
    expect(Az.PRESET_NAMES).toEqual(['Line Bars', 'Mirror Bars', 'Digital Bars', 'Line Ghost Bars', 'Mirror Ghost Bars', 'Digital Ghost Bars', 'Bar Scope', 'Dot Scope']);
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('Analyzed')).toBe(keys.indexOf('Ambience') + 1);
    expect(PRESETS.filter((p) => p.vis === 'analyzed').length).toBe(8);
  });
  it('draws at its buffer size (512x384 by default, the Resolution option else), stretched smooth', () => {
    expect(nativeSize('analyzed', 1920, 1080)).toEqual([512, 384]);
    expect([0, 1, 2, 3].map((r) => nativeSize('analyzed', 1920, 1080, 0, { analyzedResolution: r }))).toEqual([[256, 192], [384, 288], [512, 384], [1024, 768]]);
    expect([fixedSize('analyzed'), samplingOf('analyzed')]).toEqual([true, 'smooth']);
    const e = new Az({ options: { analyzedResolution: 0 } });
    expect([e.render(stream()(0))!.w, e.render(stream()(1))!.h]).toEqual([256, 192]);
  });
});

describe('Analyzed: what drives it', () => {
  it('silence draws only the peaks on the floor; sound draws more', () => {
    const c = clock(16), quiet = new Az({ now: c.now }), loud = new Az({ now: c.now }), st = stream(), sil = level(2);
    let q = 0, l = 0;
    for (let f = 0; f < 60; f++) {
      c.tick();
      const a = quiet.render(sil)!.px, b = loud.render(st(f))!.px;
      if (f === 59) { q = a.reduce((n, p) => n + (p ? 1 : 0), 0); l = b.reduce((n, p) => n + (p ? 1 : 0), 0); }
    }
    expect(q).toBeGreaterThan(0);
    expect(l).toBeGreaterThan(q * 4);
  });
  it('paused (state 1) keeps easing to the last frame it had', () => {
    const c = clock(16), a = new Az({ now: c.now, options: { analyzedBlur: false } }), b = new Az({ now: c.now, options: { analyzedBlur: false } }), st = stream();
    for (let f = 0; f < 30; f++) { c.tick(); a.render(st(f)); b.render(st(f)); }
    const frozen = st(29);
    for (let f = 30; f < 60; f++) { c.tick(); expect(hash(a.render(st(f, 1))!.px)).toBe(hash(b.render(frozen)!.px)); }
  });
  it('runs on the clock: a slower clock is a different picture', () => {
    const c1 = clock(16), c2 = clock(33), a = new Az({ now: c1.now }), b = new Az({ now: c2.now }), st = stream();
    let same = true;
    for (let f = 0; f < 40; f++) { c1.tick(); c2.tick(); if (hash(a.render(st(f))!.px) !== hash(b.render(st(f))!.px)) same = false; }
    expect(same).toBe(false);
  });
  it('the colour schemes are the property page\'s (the background stays black)', () => {
    // the first bar's bottom row: blue, red or green most
    const main = (p: number): number => { const c = [(p >>> 16) & 255, (p >>> 8) & 255, p & 255]; return c.indexOf(Math.max(...c)); };
    for (const [color, ch] of [['blue', 2], ['red', 0], ['green', 1]] as const) {
      const c = clock(16), e = new Az({ now: c.now, options: { analyzedBlur: false, analyzedColor: color } }), st = stream();
      let px: Uint32Array = new Uint32Array(0);
      for (let f = 0; f < 30; f++) { c.tick(); px = e.render(st(f))!.px; }
      expect(px[0]).toBe(0);
      expect(main(px[381 * 512 + 3]!)).toBe(ch);
    }
  });
});

describe('Analyzed: the reference rasterizer', () => {
  const T = (w: number, h: number): Target => ({ w, h, px: new Uint32Array(w * h) });
  const quad = (l: number, t: number, r: number, b: number, c: number[], uv = true): [Float32Array, Uint32Array] => {
    const f = new Float32Array(42), u = new Uint32Array(f.buffer);
    const v = [[l, t, 0, 0], [r, t, 1, 0], [r, b, 1, 1], [r, b, 1, 1], [l, b, 0, 1], [l, t, 0, 0]], ci = [0, 1, 2, 2, 3, 0];
    v.forEach(([x, y, s, q], i) => { f[i * 7] = x! - 0.5; f[i * 7 + 1] = y! - 0.5; f[i * 7 + 2] = 0.5; f[i * 7 + 3] = 1; u[i * 7 + 4] = c[ci[i]!]!; f[i * 7 + 5] = uv ? s! : 0; f[i * 7 + 6] = uv ? q! : 0; });
    return [f, u];
  };
  it('a quad covers exactly its rectangle (top-left rule), a flat colour exactly', () => {
    const rt = T(8, 8), r = new Ref9(), [f, u] = quad(2, 1, 5, 4, [0xff336699, 0xff336699, 0xff336699, 0xff336699], false);
    r.draw(rt, f, u, 6, null, Blend.Over);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(rt.px[y * 8 + x]).toBe(x >= 2 && x < 5 && y >= 1 && y < 4 ? 0x336699 : 0);
  });
  it('the reverse-subtract fade takes alpha*255 off each channel', () => {
    const rt = T(4, 4), r = new Ref9();
    rt.px.fill(0x808080);
    const [f, u] = quad(0, 0, 4, 4, [0x0affffff, 0x0affffff, 0x0affffff, 0x0affffff], false);
    r.draw(rt, f, u, 6, null, Blend.Fade);
    expect(rt.px[5]).toBe(0x767676);
  });
  it('halving a texture averages each 2x2 block, in floats (a mean of 191.5 comes out 191)', () => {
    const src = T(4, 2), dst = T(2, 1), r = new Ref9();
    src.px.set([0x000000, 0x404040, 0x808080, 0xff0000, 0x000000, 0x404040, 0x808080, 0xff0000]);
    const [f, u] = quad(0, 0, 2, 1, [-1, -1, -1, -1]);
    r.draw(dst, f, u, 6, src, Blend.Over);
    expect([...dst.px]).toEqual([0x202020, 0xbf4040]);
  });
});

// ---- golden: per 100-frame block, a fold of every frame's surface, on the synthetic stream (with a paused
// stretch) at each preset with its defaults, and the other options on one preset each.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'analyzed.json');
interface GRun { id: string; preset: number; frames: number; ms: number; options?: object }
const RUNS: GRun[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((p) => ({ id: `analyzed-p${p}`, preset: p, frames: 300, ms: 16 })),
  { id: 'analyzed-p0-33ms', preset: 0, frames: 200, ms: 33 },
  { id: 'analyzed-p2-noblur-red', preset: 2, frames: 200, ms: 16, options: { analyzedBlur: false, analyzedColor: 'red' } },
  { id: 'analyzed-p6-256-green', preset: 6, frames: 200, ms: 16, options: { analyzedResolution: 0, analyzedColor: 'green' } },
];

function runGolden(r: GRun): string[] {
  const c = clock(r.ms), e = new Az({ preset: r.preset, now: c.now, options: r.options }), st = stream();
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < r.frames; f++) {
    c.tick();
    const px = e.render(st(f, f >= 150 && f < 180 ? 1 : 2))!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Analyzed: golden', () => {
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
