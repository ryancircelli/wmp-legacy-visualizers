// Microsoft's downloadable packs on the Musical Colors engine (src/musical/plus.ts): Blazing Colors,
// Color Cubes, Pulsing Colors, Trilogy I, II and III. Their presets and wiring, then a golden guard over a
// synthetic stream. The fixture (./golden/fixtures/plus.json) is the port's own output on its generated images
// (plus-images.ts), written once the engine was verified frame-identical to the DLLs on their original images;
// Trilogy's clock is pinned to 60 frames a second and its first-frame srand(time) to 1.
// GOLDEN_UPDATE=1 npx vitest run tests/plus.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import { BlazingColors, ColorCubes, PulsingColors, TrilogyI, TrilogyII, TrilogyIII, type PlusClass } from '../src/musical/plus';
import { PRESETS, nativeSize } from '../src';
import { InputGen } from './golden/harness';

const FAMS: Record<string, PlusClass> = { blazing: BlazingColors, colorcubes: ColorCubes, pulsing: PulsingColors,
  trilogy1: TrilogyI, trilogy2: TrilogyII, trilogy3: TrilogyIII };

describe('the packs: presets and wiring', () => {
  it("each pack's presets, in WMP's list by its registry key", () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    for (const k of ['BlazingColors', 'ColorCubes', 'PulsingColors', 'TrilogyI', 'TrilogyII', 'TrilogyIII']) expect(keys).toContain(k);
    expect(keys.indexOf('BlazingColors')).toBeGreaterThan(keys.indexOf('Battery'));
    // order, not adjacency: parallel ports keep adding families in between
    expect(keys.indexOf('TrilogyIII')).toBeLessThan(keys.indexOf('Wmp9_goom'));
    expect(keys.indexOf('Wmp9_goom')).toBeLessThan(keys.indexOf('WMPVis'));
    expect(TrilogyIII.PRESET_NAMES).toEqual(['Lava', 'Mystic Cloud', 'Undulation', 'Random Selection']);
    for (const [vis, C] of Object.entries(FAMS)) {
      expect(PRESETS.filter((p) => p.vis === vis).map((p) => p.name)).toEqual(C.PRESET_NAMES);
      expect(nativeSize(vis as never, 800, 600)).toEqual([800, 600]);
    }
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface and its rand() count
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'plus.json');
interface GRun { id: string; vis: string; preset: number; w: number; h: number; seed: number }
const RUNS: GRun[] = [
  ...Object.entries(FAMS).flatMap(([vis, C]) => C.PRESET_NAMES.map((_, preset): GRun => ({ id: `${vis}-p${preset}`, vis, preset, w: 320, h: 240, seed: 1 }))),
  { id: 'blazing-p1-640x480-s12345', vis: 'blazing', preset: 1, w: 640, h: 480, seed: 12345 },
  { id: 'trilogy2-p1-1280x1024', vis: 'trilogy2', preset: 1, w: 1280, h: 1024, seed: 1 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  let randN = 0, frame = -1;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    A.srand(r.seed);
    const options = { clock: () => (100000 + Math.floor((frame + 1) * (1000 / 60))) >>> 0, timeSeed: () => r.seed };
    const gen = new InputGen(), m = new FAMS[r.vis]!({ width: r.w, height: r.h, preset: r.preset, options });
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (let f = 0; f < FRAMES; f++) {
      const L = gen.next();
      frame = f;
      randN = 0;
      const px = m.render(L)!.px;
      for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
      bh = Math.imul(bh ^ randN, 16777619);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('the packs: golden', () => {
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
