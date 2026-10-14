// Better Bars (BetterBars2.dll, Render 0x10001b00): the grid fit and cell fade, the scope's points, Scan's scroll, pen
// and stretch; then a golden guard over a synthetic stream. The golden fixture (./golden/fixtures/betterbars.json) is
// the port's own output, written once the port was verified frame-identical to the DLL;
// GOLDEN_UPDATE=1 npx vitest run tests/betterbars.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/betterbars/index';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const BB = A.BetterBars;
const at = (s: { w: number; px: Uint32Array }, x: number, y: number) => s.px[y * s.w + x]!;

describe('Better Bars: presets', () => {
  it('three presets; SetCurrentPreset rejects the rest', () => {
    expect(BB.PRESET_NAMES).toEqual(['Bars', 'Stereo Scope', 'Scan']);
    const b = new BB({ width: 64, height: 48 });
    expect(b.setPreset(2)).toBe(true);
    expect(b.setPreset(3)).toBe(false);
    expect(b.setPreset(-1)).toBe(false);
    expect(b.preset).toBe(2);
  });
});

describe('Better Bars: Bars (0x100013f0)', () => {
  it('fits 64 x 128 cells of 9x1 with 1-px gaps in 640x256; a full column lights every row, red at the top', () => {
    const b = new BB({ width: 640, height: 256 });
    const L = level(2, (l) => l.freq[0].fill(255, 0, 16));        // column 0 only
    const s = b.render(L);
    expect(at(s, 0, 255)).toBe(0x00ff00);      // row 0: green
    expect(at(s, 8, 255)).toBe(0x00ff00);      // 9 px wide
    expect(at(s, 9, 255)).toBe(0);              // the gap
    expect(at(s, 0, 254)).toBe(0);              // the row gap
    expect(at(s, 0, 255 - 2 * 100)).toBe(0xffff00);   // row 100 > 128 * 0.75: yellow
    expect(at(s, 0, 255 - 2 * 127)).toBe(0xff0000);   // row 127 > 128 * 0.85: red
    expect(at(s, 10, 255)).toBe(0);             // column 1 silent
  });
  it('an unlit cell fades 255 -> 207 -> 159 -> 127 -> 95 -> 63 -> 31 -> 0', () => {
    const b = new BB({ width: 640, height: 256 });
    b.render(level(2, (l) => l.freq[0].fill(255, 0, 16)));
    const seen = [];
    for (let k = 0; k < 7; k++) seen.push(at(b.render(level(2)), 0, 255) >> 8);
    expect(seen).toEqual([207, 159, 127, 95, 63, 31, 0]);
  });
  it('a window over 300 high leaves its bottom 24 rows black (the credit line is not drawn)', () => {
    const b = new BB({ width: 640, height: 408 });
    const s = b.render(level(2, (l) => l.freq[0].fill(255)));
    expect(at(s, 0, 383)).toBe(0x00ff00);
    for (let y = 384; y < 408; y++) expect(at(s, 0, y)).toBe(0);
  });
});

describe('Better Bars: Stereo Scope (0x10001720)', () => {
  it('silence: the left channel at y = 128*h/512, the right h/2 lower, across the window', () => {
    const b = new BB({ width: 256, height: 200, preset: 1 });
    const s = b.render(level(2, (l) => { l.wave[0].fill(128); l.wave[1].fill(128); }));
    for (const x of [0, 100, 255]) { expect(at(s, x, 50)).toBe(0x00ff00); expect(at(s, x, 150)).toBe(0x00ff00); }
    expect(s.px.filter((v) => v).length).toBe(2 * 256);   // unit steps; the last ends at x = 256, off the window
  });
});

describe('Better Bars: Scan (0x10001970)', () => {
  it('at 256x256 (no stretch) the walk paints x 251..255 and scrolls a pixel left a frame', () => {
    const b = new BB({ width: 256, height: 256, preset: 2 });
    const s = b.render(level(2, (l) => l.freq[0].fill(200)));
    expect(at(s, 255, 128)).toBe(200 << 8);
    expect(at(s, 252, 128)).toBe(200 << 8);
    expect(at(s, 250, 128)).toBe(0);
    b.render(level(2));
    expect(at(s, 250, 128)).toBe(200 << 8);    // last frame's column 251, moved left
    expect(at(s, 251, 128)).toBe(0);            // repainted by this frame's (silent) walk
  });
  it('a 128-wide window ANDs source pairs (BLACKONWHITE); 512 repeats each pixel twice', () => {
    const b = new BB({ width: 128, height: 256, preset: 2 }), big = new BB({ width: 512, height: 256, preset: 2 });
    const L = level(2, (l) => l.freq[0].fill(0x0f));
    b.render(L); big.render(L);
    const L2 = level(2, (l) => l.freq[0].fill(0xfc));
    const s = b.render(L2), t = big.render(L2);
    expect(at(s, 125, 128)).toBe(0x0c << 8);   // source 250 (0x0f, scrolled) & 251 (0xfc)
    expect([at(t, 502, 128), at(t, 503, 128)]).toEqual([0xfc << 8, 0xfc << 8]);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's pixels, over InputGen's stream
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'betterbars.json');
const RUNS = [
  { id: 'betterbars-p0-640x480', preset: 0, w: 640, h: 480 },
  { id: 'betterbars-p1-517x389', preset: 1, w: 517, h: 389 },
  { id: 'betterbars-p2-400x300', preset: 2, w: 400, h: 300 },
  { id: 'betterbars-p2-200x150', preset: 2, w: 200, h: 150 },
];
const FRAMES = 600;

function runGolden(r: (typeof RUNS)[number]): string[] {
  const gen = new InputGen(), b = new BB({ width: r.w, height: r.h, preset: r.preset });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px = b.render(gen.next()).px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Better Bars: golden', () => {
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
