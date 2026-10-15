// Kid Drawing (src/kiddraw, the WMP 7 Bonus Pack's Dance.dll): its presets and wiring, behaviour guards, then a golden
// over a synthetic stream. The fixture (./golden/fixtures/kiddraw.json) is the port's own output, written once the port
// was verified frame-identical to the DLL over 30,000 frames of sound. GOLDEN_UPDATE=1 npx vitest run tests/kiddraw.test.ts
// rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, type TimedLevel } from '../src/ns';
import '../src/rand';
import { KidDrawing } from '../src/kiddraw/index';
import { PRESETS, nativeSize } from '../src';
import { InputGen } from './golden/harness';

const silence = (state = 2): TimedLevel => {
  const l: TimedLevel = { freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state, timeStamp: 0 };
  l.wave[0].fill(128); l.wave[1].fill(128);
  return l;
};
const fold = (px: Uint32Array): number => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h = Math.imul(h ^ px[i]!, 16777619); h ^= h >>> 13; } return h >>> 0; };

describe('Kid Drawing: presets and wiring', () => {
  it('two presets, its own Effects key after Eclectic Colors and before Picture Viz, view-sized', () => {
    expect(KidDrawing.PRESET_NAMES).toEqual(['Solo Dance', 'Surfing']);
    expect(A.KidDrawing).toBe(KidDrawing);
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('KidDrawing')).toBeGreaterThan(keys.indexOf('EclecticColors'));
    expect(keys.indexOf('PictureViz')).toBeGreaterThan(keys.indexOf('KidDrawing'));
    expect(PRESETS.filter((p) => p.vis === 'kiddraw').map((p) => p.group + ': ' + p.name)).toEqual(['Kid Drawing: Solo Dance', 'Kid Drawing: Surfing']);
    expect(nativeSize('kiddraw', 800, 600)).toEqual([800, 600]);
  });
});

describe('Kid Drawing: behaviour', () => {
  it('preset numbers outside 0..1 are refused and a switch starts the figure over', () => {
    const k = new KidDrawing({ width: 160, height: 120 });
    expect(k.setPreset(2)).toBe(false);
    expect(k.setPreset(-1)).toBe(false);
    expect(k.setPreset(1)).toBe(true);
    expect(k.preset).toBe(1);
  });
  it('Solo Dance draws six rand() a frame (the three rings) and seven more when the joints take new modes (frame 0 and every 50th while playing)', () => {
    const real = A.rand;
    let n = 0;
    A.rand = () => { n++; return real(); };
    try {
      A.srand(1);
      const k = new KidDrawing({ width: 320, height: 240 });
      k.render(silence());
      expect(n).toBe(6 + 7);                       // three rings, then the joints' modes (frame 0)
      n = 0; k.render(silence());
      expect(n).toBe(6);
      n = 0; k.render(silence(1));                 // not playing: no kicks
      k.render(silence(0));
      expect(n).toBe(12);
    } finally { A.rand = real; }
  });
  it('the surface is the window and is redrawn from black each frame; the wave moves the picture', () => {
    for (const preset of [0, 1]) {
      A.srand(1);
      const k = new KidDrawing({ width: 200, height: 150, preset });
      const quiet = silence(), loud = silence();
      for (let i = 0; i < 1024; i++) loud.wave[0][i] = i & 1 ? 255 : 0;
      const a = k.render(quiet)!;
      expect([a.w, a.h, a.px.length]).toEqual([200, 150, 30000]);
      expect(a.px.some((v) => v !== 0)).toBe(true);
      const hq = fold(a.px);
      A.srand(1);
      const k2 = new KidDrawing({ width: 200, height: 150, preset });
      expect(fold(k2.render(loud)!.px)).not.toBe(hq);
    }
  });
});

// ---- golden: per 100-frame block, a fold of every frame's surface and its rand() count
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'kiddraw.json');
interface GRun { id: string; preset: number; w: number; h: number; seed: number }
const RUNS: GRun[] = [
  { id: 'solo-640x480', preset: 0, w: 640, h: 480, seed: 1 },
  { id: 'surfing-640x480', preset: 1, w: 640, h: 480, seed: 1 },
  { id: 'solo-321x241-s12345', preset: 0, w: 321, h: 241, seed: 12345 },
  { id: 'surfing-321x241-s12345', preset: 1, w: 321, h: 241, seed: 12345 },
  { id: 'surfing-1280x720', preset: 1, w: 1280, h: 720, seed: 1 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  let randN = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    A.srand(r.seed);
    const gen = new InputGen(), m = new KidDrawing({ width: r.w, height: r.h, preset: r.preset });
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (let f = 0; f < FRAMES; f++) {
      const L = gen.next();
      randN = 0;
      const px = m.render(L)!.px;
      for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
      bh = Math.imul(bh ^ randN, 16777619);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('Kid Drawing: golden', () => {
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
