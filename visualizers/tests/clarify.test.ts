// @vitest-environment node
// Alchemy.Clarify (Blackfly Studios' Clarify, src/blackfly/clarify.ts) and the framework pieces it added to
// src/blackfly/common.ts (the palette ramp, TRadialSmear), with a golden guard on the port's own output
// (./golden/fixtures/clarify.json, written with GOLDEN_UPDATE=1 from the engine as verified bit-exact against the DLL;
// GOLDEN=full runs it in full).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/blackfly/clarify';
import { RadialSmear, rampPalette } from '../src/blackfly/common';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const Clarify = A.Clarify;

describe('Blackfly framework (Clarify\'s additions)', () => {
  it('rampPalette: black to the COLORREF in 256 truncated steps, as 0x00RRGGBB', () => {
    const p = rampPalette(0x00ff8001);                 // blue 255, green 128, red 1
    expect([p[0], p[255], p[128]]).toEqual([0, 0x0180ff, (0 << 16) | (64 << 8) | 128]);
  });
  it('RadialSmear: weights sum to 65536; the centre samples itself, the corners pull inward', () => {
    const s = new RadialSmear(9, 7, 0.5);
    for (let e = 0; e < s.t.length; e += 5) expect(s.t[e]! + s.t[e + 1]! + s.t[e + 2]! + s.t[e + 3]!).toBe(65536);
    const at = (x: number, y: number) => s.t[(y * 9 + x) * 5 + 4];
    expect(at(4, 3)).toBe(3 * 9 + 4);
    expect(at(0, 0)).toBe(0);                          // (-4,-3): d 5, f 0.892, 3 and 2 in, from (0, 0) and its right and lower neighbours
    const src = new Uint32Array(63).fill(0x00808080), dst = new Uint32Array(63);
    s.apply(src, dst);
    expect([...new Set(dst)]).toEqual([0x00808080]);
  });
});

describe('Clarify', () => {
  it('four presets; size taken at the next render; silence is black', () => {
    expect(Clarify.PRESET_NAMES).toEqual(['Lucid', 'Vivid', 'Focus', 'Epiphany']);
    const e = new Clarify({ width: 40, height: 30 });
    expect(e.setPreset(4)).toBe(false);
    e.resize(64, 48);
    const s = e.render(level(2));
    expect([s.w, s.h, s.px.length, Math.max(...s.px)]).toEqual([64, 48, 64 * 48, 0]);
  });
  it('Lucid: a pixel at distance r shows bin r in the ramp colour', () => {
    const e = new Clarify({ width: 64, height: 48 });
    const l = level(2);
    l.freq[0][9] = l.freq[1][9] = 100;                // red 200, distance 9 from (32, 24): bin 9 = 100
    e.render(l);
    expect(e.dib8[24 * 64 + 41]).toBe(100);
    expect(e.dib8[24 * 64 + 40]).toBe(0);
  });
});

// ---- golden guard: per 100-frame block, a hash of every frame's pixels
function fnv(px: Uint32Array, h: number): number {
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619);
  return h >>> 0;
}
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'clarify.json');
const UPDATE = !!process.env.GOLDEN_UPDATE, FULL = process.env.GOLDEN === 'full' || UPDATE;
// 2100 wide: distances past 1023 keep the 8-bit DIB's old pixels; 161x121: odd sizes
const RUNS = [0, 1, 2, 3].map((p) => ({ id: `p${p}-160x120`, preset: p, w: 160, h: 120, frames: 1000 }))
  .concat([{ id: 'p3-161x121', preset: 3, w: 161, h: 121, frames: 600 }, { id: 'p0-2100x24', preset: 0, w: 2100, h: 24, frames: 300 }]);
function golden(run: (typeof RUNS)[number], frames: number): string[] {
  const e = new Clarify({ width: run.w, height: run.h, preset: run.preset });
  const gen = new InputGen(0x5eed + run.preset);
  const out: string[] = [];
  let h = 2166136261;
  for (let f = 0; f < frames; f++) {
    h = fnv(e.render(gen.next()).px, h);
    if (f % 100 === 99) { out.push(h.toString(16)); h = 2166136261; }
  }
  return out;
}
describe(`Clarify golden (${FULL ? 'full' : 'short prefix'})`, () => {
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
