// PixelTrip (src/pixeltrip/): its wiring, the frame-rate cap and the clock, the response to sound, then a golden guard
// over a synthetic stream with a pinned clock. The fixture (./golden/fixtures/pixeltrip.json) is the port's own output,
// written once the engine was verified frame-identical to the DLL. GOLDEN_UPDATE=1 npx vitest run tests/pixeltrip.test.ts
// rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PixelTrip } from '../src/pixeltrip/index';
import { Deck, Ctx } from '../src/pixeltrip/ctx';
import { PRESETS, makeLevel, nativeSize } from '../src';
import { InputGen } from './golden/harness';

const clocked = (w: number, h: number, step: number, base = 100000, options: Record<string, unknown> = {}) => {
  const st = { f: 0 };
  const m = new PixelTrip({ width: w, height: h, options: { clock: () => base + Math.floor(st.f * step), ...options } });
  return { m, st };
};
const fnv = (px: Uint32Array) => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619); return h >>> 0; };

describe('PixelTrip: wiring', () => {
  it('one preset under its key, between Picture Viz 3D and Plenoptic; the window\'s shape within 640x480 worth of pixels', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('PixelTrip')).toBe(keys.indexOf('Picture_Viz_III') + 1);
    expect(keys.indexOf('Plenoptic')).toBe(keys.indexOf('PixelTrip') + 1);
    expect(PRESETS.filter((p) => p.vis === 'pixeltrip').map((p) => p.name)).toEqual(['PixelTrip']);
    expect([nativeSize('pixeltrip', 320, 200), nativeSize('pixeltrip', 800, 600), nativeSize('pixeltrip', 1280, 960)]).toEqual([[320, 200], [640, 480], [640, 480]]);
  });

  it('the deck hands out every id before repeating one in the same order, and draws the first without rand at the end', () => {
    const c = new Ctx(); c.srand(7);
    const d = new Deck(c, 5), got: number[] = [];
    for (let i = 0; i < 5; i++) got.push(d.draw());
    expect([...got].sort()).toEqual([1, 2, 3, 4, 5]);
    const h = c.hold;
    expect(d.left).toBe(0);
    d.draw();
    expect(c.hold).toBe(h);
  });
});

describe('PixelTrip: behaviour', () => {
  it('the 30 fps cap: the first frame, nothing for a second, then catching up to 30 a second (as the DLL: 143 of 300)', () => {
    const { m, st } = clocked(64, 48, 16), gen = new InputGen();
    const drawn: number[] = [];
    for (; st.f < 300; st.f++) { m.render(gen.next()); drawn.push(m.debug().drawn as number); }
    expect([drawn[0], drawn[62], drawn[63], drawn[299]]).toEqual([1, 1, 2, 143]);   // 1000 ms after the first: 63 frames of 16 ms
  });

  it('no cap (desiredFps -1): a frame every render; stopped or paused (state 0, 1): none', () => {
    const { m, st } = clocked(64, 48, 16, 100000, { desiredFps: -1 }), gen = new InputGen();
    for (; st.f < 20; st.f++) m.render(gen.next());
    expect(m.debug().drawn).toBe(20);
    const L = gen.next();
    L.state = 1; m.render(L); L.state = 0; m.render(L);
    expect(m.debug().drawn).toBe(20);
  });

  it('a pinned clock gives the same frames; another clock, other frames', () => {
    const run = (base: number) => {
      const { m, st } = clocked(96, 72, 16, base, { desiredFps: -1 }), gen = new InputGen(7);
      let h = 0;
      for (; st.f < 400; st.f++) h = Math.imul(h ^ fnv(m.render(gen.next())!.px), 16777619);
      return h >>> 0;
    };
    expect(run(5000)).toBe(run(5000));
    expect(run(5000)).not.toBe(run(5001));
  }, 60_000);

  it('responds to sound: silence and a loud stream differ under the same clock', () => {
    const run = (loud: boolean) => {
      const { m, st } = clocked(96, 72, 16, 9000, { desiredFps: -1 }), gen = new InputGen(3);
      const silent = makeLevel();
      silent.state = 2;
      for (; st.f < 300; st.f++) m.render(loud ? gen.next() : silent);
      return fnv(m.render(loud ? gen.next() : silent)!.px);
    };
    expect(run(true)).not.toBe(run(false));
  }, 60_000);
});

// ---- golden: per 300-frame block, an FNV-style fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'pixeltrip.json');
interface GRun { id: string; w: number; h: number; step: number; base: number; options: Record<string, unknown> }
const RUNS: GRun[] = [
  { id: '320x240', w: 320, h: 240, step: 16, base: 100000, options: {} },
  { id: '256x192-nocap-always', w: 256, h: 192, step: 33, base: 7777777, options: { desiredFps: -1, motion: 2, bounce: 2 } },
];
const FRAMES = 1500;

function runGolden(r: GRun): string[] {
  const gen = new InputGen(), { m, st } = clocked(r.w, r.h, r.step, r.base, r.options);
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (; st.f < FRAMES; st.f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((st.f + 1) % 300 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('PixelTrip: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${FRAMES} frames`, () => {
      const got = runGolden(r);
      if (process.env.GOLDEN_UPDATE) { fresh[r.id] = got; return; }
      expect(want[r.id], 'no fixture entry').toBeDefined();
      const b = got.findIndex((h, i) => h !== want[r.id]![i]);
      expect(b === -1 ? null : `${r.id}: block ${b} (frames ${b * 300}..${b * 300 + 299}) ${got[b]} vs ${want[r.id]![b]}`).toBe(null);
    }, 120_000);
  }
  it.runIf(!!process.env.GOLDEN_UPDATE)('writes the fixture', () => {
    writeFileSync(GOLDEN, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
  });
});
