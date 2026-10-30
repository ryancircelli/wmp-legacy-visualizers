// @vitest-environment node
// TwistedPixel (src/twistedpixel/): its wiring, our own presets, then a golden guard over a synthetic stream with a
// pinned clock. The fixture (./golden/fixtures/twistedpixel.json) is the port's own output, written once the port
// was verified frame-identical to the DLL running these same presets. GOLDEN_UPDATE=1 npx vitest run
// tests/twistedpixel.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TwistedPixel } from '../src/twistedpixel/index';
import { OWN } from '../src/twistedpixel/own/index';
import { PRESETS } from '../src';
import { InputGen } from './golden/harness';

describe('TwistedPixel: wiring', () => {
  it('one preset under its key, between Trilogy III and Better Bars (by Effects key)', () => {
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('TwistedPixel')).toBe(keys.indexOf('TrilogyIII') + 1);
    expect(keys.indexOf('Visualizationone')).toBe(keys.indexOf('TwistedPixel') + 1);
    expect(PRESETS.filter((p) => p.vis === 'twistedpixel').map((p) => p.name)).toEqual(['TwistedPixel Preset Vis']);
  });

  it('our own presets: twelve, CRLF, ASCII', () => {
    expect(Object.keys(OWN)).toHaveLength(12);
    for (const [n, s] of Object.entries(OWN)) {
      expect(/[^\r]\n/.test(s), n).toBe(false);
      expect(/[^\t\r\n -~]/.test(s), n).toBe(false);
    }
  });
});

// ---- golden: per 150-frame block, an FNV-style fold of every drawn frame (silent frames draw nothing)
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'twistedpixel.json');
interface GRun { id: string; w: number; h: number; step: number }
const RUNS: GRun[] = [
  { id: '160x120-34ms', w: 160, h: 120, step: 34 },
  { id: '133x97-400ms', w: 133, h: 97, step: 400 },    // a preset every few dozen frames
];
const FRAMES = 450, BLOCK = 150;

function runGolden(r: GRun): { blocks: string[]; shown: number } {
  const gen = new InputGen();
  let f = 0;
  const m = new TwistedPixel({ width: r.w, height: r.h, options: { clock: () => 100000 + f * r.step } });
  const out: string[] = [], shown = new Set<string>();
  let bh = 0x811c9dc5;
  for (; f < FRAMES; f++) {
    const s = m.render(gen.next());
    if (s) for (let i = 0; i < s.px.length; i++) { bh = Math.imul(bh ^ s.px[i]!, 16777619); bh ^= bh >>> 13; }
    shown.add(m.debug().preset as string);
    if ((f + 1) % BLOCK === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return { blocks: out, shown: shown.size };
}

describe('TwistedPixel: golden', () => {
  const want: Record<string, string[]> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
  const fresh: Record<string, string[]> = {};
  for (const r of RUNS) {
    it(`${r.id} x ${FRAMES} frames`, () => {
      const { blocks: got, shown } = runGolden(r);
      expect(shown).toBeGreaterThan(1);
      if (process.env.GOLDEN_UPDATE) { fresh[r.id] = got; return; }
      expect(want[r.id], 'no fixture entry').toBeDefined();
      const b = got.findIndex((h, i) => h !== want[r.id]![i]);
      expect(b === -1 ? null : `${r.id}: block ${b} ${got[b]} vs ${want[r.id]![b]}`).toBe(null);
    }, 600_000);
  }
  it.runIf(!!process.env.GOLDEN_UPDATE)('writes the fixture', () => {
    writeFileSync(GOLDEN, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
  });
});
