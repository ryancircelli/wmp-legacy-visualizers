// @vitest-environment node
// Alchemy.FireDancer (Blackfly Studios' Fire Dancer, src/blackfly/firedancer.ts), with a golden guard on the port's own
// output (./golden/fixtures/firedancer.json, written with GOLDEN_UPDATE=1 from the engine as verified bit-exact against the
// DLL; GOLDEN=full runs it in full).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/blackfly/firedancer';
import { DelphiRandom } from '../src/blackfly/common';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const FireDancer = A.FireDancer;

describe('Fire Dancer', () => {
  it('one preset; the window size is taken at the next render', () => {
    expect(FireDancer.PRESET_NAMES).toEqual(['Fire Dancer']);
    const e = new FireDancer({ width: 40, height: 30 });
    expect(e.setPreset(1)).toBe(false);
    e.resize(64, 48);
    const s = e.render(level(2));
    expect([s.w, s.h, s.px.length]).toEqual([64, 48, 64 * 48]);
  });
  it('Random with no range: RandSeed stepped, then divided by 2^32', () => {
    const r = new DelphiRandom();
    r.seed = 0;
    expect(r.randomFloat()).toBe(1 / 4294967296);
    expect(r.seed).toBe(1);
  });
  it('the same seed draws the same frames; another seed does not', () => {
    const run = (seed: number) => {
      const e = new FireDancer({ width: 80, height: 96, seed });
      const gen = new InputGen(7);
      let px: Uint32Array = new Uint32Array(0);
      for (let f = 0; f < 8; f++) px = e.render(gen.next()).px.slice();
      return px;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  }, 120_000);
});

// ---- golden guard: per 100-frame block, a hash of every frame's pixels
function fnv(px: Uint32Array, h: number): number {
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619);
  return h >>> 0;
}
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'firedancer.json');
const UPDATE = !!process.env.GOLDEN_UPDATE, FULL = process.env.GOLDEN === 'full' || UPDATE;
// 160x120: under 384 high, GDI's HALFTONE stretch; 401x403: odd, COLORONCOLOR
const RUNS = [{ id: 'p0-160x120', w: 160, h: 120, seed: 12345, frames: 1000 }, { id: 'p0-401x403', w: 401, h: 403, seed: 4242, frames: 600 }];
function golden(run: (typeof RUNS)[number], frames: number): string[] {
  const e = new FireDancer({ width: run.w, height: run.h, seed: run.seed });
  const gen = new InputGen(0x5eed);
  const out: string[] = [];
  let h = 2166136261;
  for (let f = 0; f < frames; f++) {
    h = fnv(e.render(gen.next()).px, h);
    if (f % 100 === 99) { out.push(h.toString(16)); h = 2166136261; }
  }
  return out;
}
describe(`Fire Dancer golden (${FULL ? 'full' : 'short prefix'})`, () => {
  const fixture: Record<string, string[]> = existsSync(FIX) ? (JSON.parse(readFileSync(FIX, 'utf8')) as Record<string, string[]>) : {};
  const fresh: Record<string, string[]> = {};
  for (const run of RUNS) {
    const frames = FULL ? run.frames : 200;
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
