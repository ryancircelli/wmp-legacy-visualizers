// Googly Moogly! (src/googly/): its presets and wiring, the HLS and RoundRect pieces, then a golden guard over a synthetic
// stream. The fixture (./golden/fixtures/googly.json) is the port's own output, written once the engine was verified
// frame-identical to the DLL. GOLDEN_UPDATE=1 npx vitest run tests/googly.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GooglyMoogly } from '../src/googly/index';
import { hlsToRgb, roundRectMask } from '../src/googly/raster';
import { PRESETS, makeLevel, nativeSize } from '../src';
import { InputGen } from './golden/harness';

describe('Googly Moogly!: presets and wiring', () => {
  it('three presets under its key, after Eclectic Colors; the window\'s size, 32x32 at least', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('GooglyMoogly')).toBe(keys.indexOf('EclecticColors') + 1);
    expect(PRESETS.filter((p) => p.vis === 'googly').map((p) => p.name)).toEqual(['Googly Squares', 'Frequency', 'Waveform']);
    expect(nativeSize('googly', 800, 600)).toEqual([800, 600]);
    expect(nativeSize('googly', 4000, 20)).toEqual([1920, 32]);
  });

  it('silence: Frequency a flat line at y=5, Waveform one through the middle, the squares their dimmest', () => {
    const L = makeLevel(), at = (s: { w: number; px: Uint32Array }, x: number, y: number) => s.px[y * s.w + x];
    const f = new GooglyMoogly({ width: 64, height: 64, preset: 1 }).render(L)!;
    expect([at(f, 10, 5), at(f, 10, 4), at(f, 10, 6)]).toEqual([0x266dd9, 0, 0]);
    const w = new GooglyMoogly({ width: 64, height: 64, preset: 2 }).render(L)!;
    expect([at(w, 10, 32 - 254 + 256), at(w, 10, 33)]).toEqual([0x266dd9, 0]);
    const s = new GooglyMoogly({ width: 128, height: 128 }).render(L)!;   // 4x4 squares: at 64x64 the pen covers all of a 2x2
    expect(new Set(s.px)).toEqual(new Set([0, hlsToRgb(144 + 1, 15, 168)]));
  });
});

describe('the Windows pieces', () => {
  it('ColorHLSToRGB: the primaries, grey only at the undefined hue', () => {
    expect([hlsToRgb(0, 120, 240), hlsToRgb(80, 120, 240), hlsToRgb(160, 120, 240)].map((c) => c.toString(16))).toEqual(['ff0000', 'ff00', 'ff']);
    expect([hlsToRgb(160, 240, 0), hlsToRgb(160, 120, 0), hlsToRgb(0, 120, 0)]).toEqual([0xffffff, 0x7f7f7f, 0]);
  });

  it('RoundRect: the corners GDI draws, not left-right symmetric', () => {
    const m = roundRectMask(10, 18, 4, 7), rows: string[] = [];
    for (let y = 0; y < 3; y++) rows.push([...m.subarray(y * 10, y * 10 + 10)].map((v) => '.#o'[v]).join(''));
    expect(rows).toEqual(['..######..', '##oooooo#.', '#oooooooo#']);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'googly.json');
interface GRun { id: string; preset: number; w: number; h: number }
const RUNS: GRun[] = [
  { id: 'p0', preset: 0, w: 640, h: 480 }, { id: 'p1', preset: 1, w: 640, h: 480 }, { id: 'p2', preset: 2, w: 640, h: 480 },
  { id: 'p0-1001x737', preset: 0, w: 1001, h: 737 }, { id: 'p2-1280x720', preset: 2, w: 1280, h: 720 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  const gen = new InputGen(), m = new GooglyMoogly({ width: r.w, height: r.h, preset: r.preset });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Googly Moogly!: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${FRAMES} frames`, () => {
      const got = runGolden(r);
      if (process.env.GOLDEN_UPDATE) { fresh[r.id] = got; return; }
      expect(want[r.id], 'no fixture entry').toBeDefined();
      const b = got.findIndex((h, i) => h !== want[r.id]![i]);
      expect(b === -1 ? null : `${r.id}: block ${b} (frames ${b * 100}..${b * 100 + 99}) ${got[b]} vs ${want[r.id]![b]}`).toBe(null);
    }, 120_000);
  }
  it.runIf(!!process.env.GOLDEN_UPDATE)('writes the fixture', () => {
    writeFileSync(GOLDEN, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
  });
});
