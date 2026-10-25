// Flashes (src/flashes/, src/glass3d/): its preset and wiring, the 16-bit DIB, then a golden guard over a synthetic
// stream. The fixture (./golden/fixtures/flashes.json) is the port's own output, written once the engine was verified
// frame-identical to the DLL. GOLDEN_UPDATE=1 npx vitest run tests/flashes.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flashes } from '../src/flashes/index';
import { Dib } from '../src/glass3d/dib';
import { Lcg } from '../src/glass3d/lcg';
import { PRESETS, nativeSize } from '../src';
import { InputGen } from './golden/harness';

describe('Flashes: preset and wiring', () => {
  it('one preset, Show, under its key Flashes: between Eclectic Colors and Googly Moogly!; the window\'s size', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('Flashes')).toBeGreaterThan(keys.indexOf('EclecticColors'));
    expect(keys.indexOf('Flashes')).toBeLessThan(keys.indexOf('GooglyMoogly'));
    expect(PRESETS.filter((p) => p.vis === 'flashes').map((p) => p.name)).toEqual(['Show']);
    expect(nativeSize('flashes', 800, 600)).toEqual([800, 600]);
  });

  it('a 16-bit DIB: two rows taller, its rows a word stride', () => {
    const d = new Dib<Uint16Array>(30, 20, new Lcg(), 16);
    expect(d.bits).toBeInstanceOf(Uint16Array);
    expect(d.bits.length).toBe(d.stride * 22);
  });

  it('black for the first Renders, then the music; black again when not playing', () => {
    const gen = new InputGen();
    let f = 0;
    const a = new Flashes({ width: 320, height: 240, options: { clock: () => 100000 + f * 50 } });
    let lit = 0;
    for (; f < 400; f++) {
      const s = a.render(gen.next())!;
      if (f === 1) expect(s.px.every((v) => v === 0)).toBe(true);
      if (f === 399) lit = s.px.filter((v) => v !== 0).length;
    }
    expect(lit).toBeGreaterThan(0);
    const lv = gen.next(); lv.state = 1;
    expect(a.render(lv)!.px.every((v) => v === 0)).toBe(true);
  }, 60_000);
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'flashes.json');
interface GRun { id: string; w: number; h: number; base: number; step: number; frames: number }
const RUNS: GRun[] = [
  { id: '640x480', w: 640, h: 480, base: 100000, step: 50, frames: 1500 },
  { id: '321x237-30fps', w: 321, h: 237, base: 7654321, step: 33, frames: 3000 },
];

function runGolden(r: GRun): string[] {
  const gen = new InputGen();
  let f = 0;
  const m = new Flashes({ width: r.w, height: r.h, options: { clock: () => r.base + Math.floor(f * r.step) } });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (; f < r.frames; f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Flashes: golden', () => {
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
