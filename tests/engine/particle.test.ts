// @vitest-environment node
// Alchemy.Particle (WMP 7-10 "Particle", src/engine/particle/index.ts): presets, gradient, the simulation's
// fixed points, and a golden guard on the port's own output (./golden/fixtures/particle.json, written with
// GOLDEN_UPDATE=1 from the engine as verified bit-exact against the DLLs; npm run test:golden runs it in full).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/particle/index';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const Particle = A.Particle;
type Eng = InstanceType<typeof Particle>;

function fnv(px: Uint32Array, h: number): number {
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619);
  return h >>> 0;
}
function lit(px: Uint32Array): number { let n = 0; for (const v of px) if (v) n++; return n; }

describe('Particle: presets and gradient', () => {
  it('names, bounds, the DLL preset behind each', () => {
    expect(Particle.PRESET_NAMES).toEqual(['Particle', 'Rotating Particle', 'Particle (WMP 7-8)', 'Rotating Particle (WMP 7-8)']);
    const e = new Particle({ width: 64, height: 48 });
    expect(e.setPreset(4)).toBe(false);
    expect(e.setPreset(-1)).toBe(false);
    expect(e.preset).toBe(0);
    e.setPreset(3);
    expect([e.spinX, e.legacy]).toEqual([true, true]);
    e.setPreset(0);
    expect([e.spinX, e.spinY, e.spinZ, e.legacy]).toEqual([false, false, false, false]);
  });

  it('preset 0 ramps the five keys in truncated per-byte steps (0x07977ba9)', () => {
    const e = new Particle({ width: 64, height: 48 });
    // 0x0000ff -> 0xff00ff over 0..7: 9 steps, blue +28 each
    expect(e.pal[0]).toBe(0xff);
    expect(e.pal[1]).toBe(0x1c00ff);
    expect(e.pal[7]).toBe(0xc400ff);
    expect(e.pal[8]).toBe(0xff00ff);
    // 0xff00ff -> 0xff7070 over 8..17: 11 steps, red (0x70-0xff)/11 = -13, green +10
    expect(e.pal[9]).toBe(0xff0af2);
    expect(e.pal[38]).toBe(0xffff00);
    expect(e.pal[40]).toBe(0xffff00);
  });

  it('preset 1 has its own three-stop gradient and leaves the keys alone', () => {
    const e = new Particle({ width: 64, height: 48, preset: 1 });
    expect(e.pal[0]).toBe(0xf00080);
    expect(e.pal[8]).toBe(0xa000a0);
    expect(e.pal[0x19]).toBe(0xa0a000);
    expect(e.keys[4]).toBe(0xffff00);
  });
});

describe('Particle: simulation', () => {
  it('a new row starts at z = -25, heights (b >> 2)^2 * 0.015, bins 1, 2, 3 ... then x1.096', () => {
    const e = new Particle({ width: 64, height: 48 });
    e.channels = 0;
    const L = level(2, (l) => { for (let i = 0; i < 1024; i++) l.freq[0][i] = i & 255; });
    e.render(L);
    const g = e.grid;
    expect([g[0], g[2], g[3]]).toEqual([-25, -25, 1]);
    expect(g[1]).toBe(Math.fround((1 >> 2) * Math.fround(0.015) * (1 >> 2)));
    expect(g[5 * 49]).toBe(24);                          // x = i - 25
    // the row's bin cursor never repeats a bin
    expect(e.row).toBe(1);
  });

  it('stopped fills the background; paused freezes the dots but not the spin', () => {
    const e = new Particle({ width: 64, height: 48, preset: 1 });
    e.onTimer = () => {};
    const L = level(2);
    e.render(L); e.render(L);
    const row = e.row, nX = e.nX;
    L.state = 1; L.timeStamp += 166667;
    e.render(L);
    expect(e.row).toBe(row);
    expect(e.nX).toBe(nX + 1);
    L.state = 0;
    const s = e.render(L)!;
    expect(lit(s.px)).toBe(0);
    expect(e.nX).toBe(nX + 1);
  });

  it('responds to the sound: silence and a loud spectrum draw different frames', () => {
    const quiet = new Particle({ width: 160, height: 120 }), loud = new Particle({ width: 160, height: 120 });
    const Q = level(2), Ld = level(2, (l) => { l.freq[0].fill(250); l.freq[1].fill(250); });
    let a = 0, b = 0;
    for (let f = 0; f < 60; f++) {
      Q.timeStamp = Ld.timeStamp = f * 166667;
      a = fnv(quiet.render(Q)!.px, a); b = fnv(loud.render(Ld)!.px, b);
    }
    expect(a).not.toBe(b);
  });

  it('the timer nudges a property every 250 ms of stream time in preset 1 only', () => {
    const e = new Particle({ width: 64, height: 48, preset: 0 });
    e.clock = () => 1234; e.setPreset(1);
    let ticks = 0;
    const real = e.onTimer.bind(e);
    e.onTimer = () => { ticks++; real(); };
    const L = level(2);
    for (let f = 0; f <= 60; f++) { L.timeStamp = f * 166667; e.render(L); }
    expect(ticks).toBe(4);                                // frames 15, 30, 45, 60
    e.setPreset(0);
    for (let f = 61; f <= 120; f++) { L.timeStamp = f * 166667; e.render(L); }
    expect(ticks).toBe(5);                                // the first tick after preset 0 stops it
  });
});

// ---- golden guard: per 100-frame block, a hash of every frame's pixels and its rand() count
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'particle.json');
const UPDATE = !!process.env.GOLDEN_UPDATE, FULL = process.env.GOLDEN === 'full' || UPDATE;
const RUNS = [
  { id: 'p0-320x240', preset: 0, w: 320, h: 240, frames: 3000 },
  { id: 'p1-259x194', preset: 1, w: 259, h: 194, frames: 3000 },
  { id: 'p2-194x259', preset: 2, w: 194, h: 259, frames: 3000 },
  { id: 'p3-320x240', preset: 3, w: 320, h: 240, frames: 3000 }
];
function golden(run: (typeof RUNS)[number], frames: number): string[] {
  const e: Eng = new Particle({ width: run.w, height: run.h, preset: 0 });
  e.clock = () => 1700000000;
  e.setPreset(run.preset);
  const gen = new InputGen(0x5eed + run.preset);
  let randN = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  const out: string[] = [];
  try {
    let h = 2166136261;
    for (let f = 0; f < frames; f++) {
      const r0 = randN;
      h = fnv(e.render(gen.next())!.px, h);
      h = Math.imul(h ^ (randN - r0), 16777619) >>> 0;
      if (f % 100 === 99) { out.push(h.toString(16)); h = 2166136261; }
    }
  } finally { A.rand = realRand; }
  return out;
}
describe(`Particle golden (${FULL ? 'full' : 'short prefix'})`, () => {
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
