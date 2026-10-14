// @vitest-environment node
// Alchemy.Ripple (Blackfly Studios' Ripple, src/blackfly/ripple.ts) and the Blackfly framework (src/blackfly/common.ts):
// the Delphi RTL pieces, the blend, the rings, and a golden guard on the port's own output (./golden/fixtures/ripple.json,
// written with GOLDEN_UPDATE=1 from the engine as verified bit-exact against the DLL; GOLDEN=full runs it in full).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/blackfly/ripple';
import { DelphiRandom, blend, delphiRound } from '../src/blackfly/common';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const Ripple = A.Ripple;

describe('Blackfly framework', () => {
  it('Random is Delphi\'s LCG, the range scaled by the high half', () => {
    const r = new DelphiRandom();
    expect([r.random(640), r.seed]).toEqual([0, 1]);
    expect([r.random(640), r.seed]).toEqual([Math.floor((0x08088406 * 640) / 2 ** 32), 0x08088406]);
    r.seed = 0xffffffff;
    // 0xffffffff * 0x08088405 + 1 = 0xf7f77bfc mod 2^32; with a range near 2^31 the product needs all 63 bits
    expect(r.random(0x7fffffff)).toBe(Number((0xf7f77bfcn * 0x7fffffffn) >> 32n));
  });
  it('Round takes halves to even', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 2.4999, 2.5001].map(delphiRound)).toEqual([0, 2, 2, -0, -2, -2, 2, 3]);
  });
  it('blend: per byte, back * a >> 8 plus front * (256 - a) >> 8, the back\'s top byte', () => {
    const back = new Uint32Array([0x00ff8040]), front = new Uint32Array([0xff102030]);
    blend(back, front, 0xe0);
    const ch = (s: number, d: number) => ((s * 0xe0) >> 8) + ((d * 0x20) >> 8);
    expect(front[0]).toBe(((ch(0xff, 0x10) << 16) | (ch(0x80, 0x20) << 8) | ch(0x40, 0x30)) >>> 0);
  });
});

describe('Ripple', () => {
  it('eight presets; size taken at the next render, both buffers black', () => {
    expect(Ripple.PRESET_NAMES).toEqual(['Plaid', 'Pool', 'Acid', 'Haze', 'Hulk', 'Solvent', 'Vomit', 'Slime']);
    const e = new Ripple({ width: 40, height: 30 });
    expect(e.setPreset(8)).toBe(false);
    e.resize(64, 48);
    const s = e.render(level(2));
    expect([s.w, s.h, s.px.length]).toEqual([64, 48, 64 * 48]);
    // silence: radii 0, every pixel on the wave; the first frame is 31/256 of it over black
    expect(e.debug()).toMatchObject({ frame: 1, fade: 30, radius: [0, 0, 0] });
  });
  it('centres from Random every 256 frames; a level jump restarts a ring', () => {
    const e = new Ripple({ width: 100, height: 80 });
    const l = level(2);
    e.render(l);
    const r = new DelphiRandom();
    const want = [0, 1, 2, 3, 4, 5].map((i) => r.random(i & 1 ? 80 : 100));   // x, y per ring, in that order
    expect([e.cx, e.cy]).toEqual([[want[0], want[2], want[4]], [want[1], want[3], want[5]]]);
    l.freq[0].fill(255, 4, 15);                        // band 1: (11 * 255) / 20 = 140 > 0 + 48: ring restarts
    e.render(l);
    expect(e.radius[0]).toBe(0);
    e.render(l);                                       // steady: grows by 140 >> 5
    expect(e.radius[0]).toBe(4);
    const c0 = [...e.cx];
    for (let i = 3; i < 256; i++) e.render(l);
    expect(e.cx).toEqual(c0);
    e.render(l);
    expect(e.debug()).toMatchObject({ frame: 257, fade: 30 });
  });
});

// ---- golden guard: per 100-frame block, a hash of every frame's pixels
function fnv(px: Uint32Array, h: number): number {
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619);
  return h >>> 0;
}
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'ripple.json');
const UPDATE = !!process.env.GOLDEN_UPDATE, FULL = process.env.GOLDEN === 'full' || UPDATE;
// 1300 wide: distances past 511 (the DLL's table left them 0) and past 1203 (its own root)
const RUNS = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => ({ id: `p${p}-160x120`, preset: p, w: 160, h: 120, seed: 0, frames: 1000 }))
  .concat([{ id: 'p0-1300x40-s7', preset: 0, w: 1300, h: 40, seed: 7, frames: 600 }]);
function golden(run: (typeof RUNS)[number], frames: number): string[] {
  const e = new Ripple({ width: run.w, height: run.h, preset: run.preset, seed: run.seed });
  const gen = new InputGen(0x5eed + run.preset);
  const out: string[] = [];
  let h = 2166136261;
  for (let f = 0; f < frames; f++) {
    h = fnv(e.render(gen.next()).px, h);
    if (f % 100 === 99) { out.push(h.toString(16)); h = 2166136261; }
  }
  return out;
}
describe(`Ripple golden (${FULL ? 'full' : 'short prefix'})`, () => {
  const fixture: Record<string, string[]> = existsSync(FIX) ? (JSON.parse(readFileSync(FIX, 'utf8')) as Record<string, string[]>) : {};
  const fresh: Record<string, string[]> = {};
  for (const run of RUNS) {
    const frames = FULL ? run.frames : 300;
    it(`${run.id} x ${frames} frames`, () => {
      const got = golden(run, frames);
      if (UPDATE) { fresh[run.id] = got; return; }
      expect(got).toEqual((fixture[run.id] || []).slice(0, got.length));
    }, 600_000);
  }
  it.runIf(UPDATE)('writes the fixture', () => {
    writeFileSync(FIX, JSON.stringify(fresh, null, 1) + '\n');
  });
});
