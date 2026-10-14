// Phthalo's Corona (src/corona/): its presets and wiring, the x87 pieces, then a golden guard over a synthetic stream. The
// fixture (./golden/fixtures/corona.json) is the port's own output, written once the engine was verified frame-identical to
// the DLL. GOLDEN_UPDATE=1 npx vitest run tests/corona.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Corona, exp87, fpatan } from '../src/corona/index';
import { PRESETS, makeLevel, nativeSize } from '../src';
import { InputGen } from './golden/harness';

const SEED = 1700000000;

describe('Phthalo\'s Corona: presets and wiring', () => {
  it('two presets under its key, between Color Cubes and Particle (Dotplane); the window\'s size', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('Corona')).toBe(keys.indexOf('ColorCubes') + 1);
    expect(PRESETS.filter((p) => p.vis === 'corona').map((p) => p.name)).toEqual(['Corona', 'Blaze']);
    expect(nativeSize('corona', 800, 600)).toEqual([800, 600]);
  });

  it('the picture is 4/5 of the height, its mirror the next quarter of that, the rest black', () => {
    const m = new Corona({ width: 64, height: 101, seed: SEED }), L = makeLevel();
    let s = m.render(L)!;
    for (let f = 0; f < 60; f++) s = m.render(L)!;
    const row = (y: number) => s.px.subarray(y * 64, y * 64 + 64);
    expect(row(80).some((v) => v !== 0)).toBe(true);    // 101 * 4 / 5 = 80 rows, then 20 mirrored: rows 80..99
    expect(row(100).every((v) => v === 0)).toBe(true);
  });

  it('responds to the sound: silence and a stream part ways', () => {
    const a = new Corona({ seed: SEED }), b = new Corona({ seed: SEED }), gen = new InputGen(), L = makeLevel();
    let differ = 0;
    for (let f = 0; f < 100; f++) {
      const sa = a.render(L)!, sb = b.render(gen.next())!;
      if (sa.px.some((v, i) => v !== sb.px[i])) differ++;
    }
    expect(differ).toBeGreaterThan(50);
  }, 120_000);
});

describe('the x87 pieces', () => {
  it('FPATAN to 64 bits; F2XM1-based e^x rounded as the FPU does', () => {
    const o = new Float64Array(2);
    fpatan(1, 1, o);
    expect([o[0], o[1]]).toEqual([Math.PI / 4, 565 * 2 ** -64]);
    expect([exp87(-1), exp87(-0.5), exp87(0)]).toEqual([0.5, Math.SQRT1_2, 1]);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'corona.json');
interface GRun { id: string; preset: number; w: number; h: number }
const RUNS: GRun[] = [
  { id: 'p0', preset: 0, w: 640, h: 480 }, { id: 'p1', preset: 1, w: 640, h: 480 }, { id: 'p1-400x300', preset: 1, w: 400, h: 300 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  const gen = new InputGen(), m = new Corona({ width: r.w, height: r.h, preset: r.preset, seed: SEED });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Phthalo\'s Corona: golden', () => {
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
