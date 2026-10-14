// Animator (src/animator/, src/glass3d/): its preset and wiring, the Glass3D pieces (the LCG, the warp map), then a
// golden guard over a synthetic stream. The fixture (./golden/fixtures/animator.json) is the port's own output, written
// once the engine was verified frame-identical to the DLL. GOLDEN_UPDATE=1 npx vitest run tests/animator.test.ts
// rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Animator } from '../src/animator/index';
import { Lcg } from '../src/glass3d/lcg';
import { WarpMap, applyWarp } from '../src/glass3d/warp';
import { PRESETS, nativeSize } from '../src';
import { InputGen } from './golden/harness';

describe('Animator: preset and wiring', () => {
  it('one preset, Show, under its key AA7: between 3D Alchemy and Alchemy; the window\'s size', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('AA7')).toBeGreaterThan(keys.indexOf('3D-Alchemy'));
    expect(keys.indexOf('AA7')).toBeLessThan(keys.indexOf('Alchemy'));
    expect(PRESETS.filter((p) => p.vis === 'animator').map((p) => p.name)).toEqual(['Show']);
    expect(nativeSize('animator', 800, 600)).toEqual([800, 600]);
  });

  it('nothing for the first Renders (the thread starts on the second, draws from the fourth), then the music', () => {
    const gen = new InputGen();
    let f = 0;
    const a = new Animator({ width: 320, height: 240, options: { clock: () => 100000 + f * 50 } });
    let lit = 0;
    for (; f < 400; f++) {
      const s = a.render(gen.next())!;
      if (f === 2) expect(s.px.every((v) => v === 0)).toBe(true);
      if (f === 399) lit = s.px.filter((v) => v !== 0).length;
    }
    expect(lit).toBeGreaterThan(0);
  }, 60_000);
});

describe('the Glass3D pieces', () => {
  it('the MSVC rand', () => {
    const r = new Lcg();
    expect([r.rand(), r.rand(), r.rand()]).toEqual([41, 18467, 6334]);
    r.srand(100150);
    expect(r.rand()).toBe((((Math.imul(100150, 214013) + 2531011) >>> 0) >>> 16) & 0x7fff);
  });

  it('a map that moves nothing stays put, and the resample darkens by 31/32', () => {
    const m = new WarpMap((q) => q.x, (q) => q.y, [0, 0, 0, 0, 0], false, false);
    m.begin(8, 6); m.finish();
    expect(m.done && m.back).toBe(1);
    expect([...new Set(m.data)]).toEqual([0x7e07e0]);
    const stride = 12, bits = new Uint8Array(stride * 8).fill(255);
    applyWarp(bits, stride, 8, 6, m);
    expect([bits[0], bits[7], bits[5 * stride + 3]]).toEqual([247, 247, 247]);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'animator.json');
interface GRun { id: string; w: number; h: number; base: number; step: number; frames: number }
const RUNS: GRun[] = [
  { id: '640x480', w: 640, h: 480, base: 100000, step: 50, frames: 1200 },
  { id: '320x240-30fps', w: 320, h: 240, base: 7654321, step: 33, frames: 1200 },
];

function runGolden(r: GRun): string[] {
  const gen = new InputGen();
  let f = 0;
  const m = new Animator({ width: r.w, height: r.h, options: { clock: () => r.base + Math.floor(f * r.step) } });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (; f < r.frames; f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Animator: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${r.frames} frames`, () => {
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
