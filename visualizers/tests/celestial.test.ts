// Celestial (Blackfly Studios, Celestial.dll 1.0.0.0): presets, Delphi's Random, the zoom map, the GDI wide-pen model
// (pens, outlines, fills), then a golden guard over a synthetic stream. The golden fixture
// (./golden/fixtures/celestial.json) is the port's own output, written once the port was verified frame-identical to the
// DLL; GOLDEN_UPDATE=1 npx vitest run tests/celestial.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/celestial/index';
import { Gdi, penRecord, widen, fillSpans } from '../src/celestial/gdi';
import { rint, extLiteral, toNum } from '../src/celestial/x87';
import { InputGen } from './golden/harness';

const Celestial = A.Celestial;

describe('Celestial: presets and state', () => {
  it('ten presets; SetCurrentPreset keeps everything else', () => {
    expect(Celestial.PRESET_NAMES).toHaveLength(10);
    expect(Celestial.PRESET_NAMES[9]).toBe('The coyote is laughing (he is)');
    const c = new Celestial({ width: 64, height: 48 });
    expect(c.setPreset(9)).toBe(true);
    expect(c.setPreset(10)).toBe(false);
    expect(c.preset).toBe(9);
  });
  it("Delphi's Random: RandSeed * 0x08088405 + 1, the high dword of seed * n", () => {
    const c = new Celestial({ width: 16, height: 16, preset: 8 }).seed(12345);
    const L = new InputGen().next();
    c.render(L);                                       // the first frame draws sixteen blob periods: 32 Random(40)
    let s = 12345;
    for (let k = 0; k < 32; k++) s = (Math.imul(s, 0x08088405) + 1) >>> 0;
    expect(c.randSeed).toBe(s);
  });
});

describe('Celestial: x87 helpers', () => {
  it('FISTP rounds half to even', () => {
    expect([rint(0.5), rint(1.5), rint(2.5), rint(-0.5), rint(-1.5), rint(2.4999), rint(-2.5000001)]).toEqual([0, 2, 2, -0, -2, 2, -3]);
  });
  it("Delphi's extended literals carry 64 significant bits", () => {
    const pi = toNum(extLiteral('3.1415926535'));
    expect(Math.abs(pi - 3.1415926535)).toBeLessThan(1e-15);
  });
});

describe('Celestial: the zoom map', () => {
  it('the four weights of every pixel sum to 65536, and the centre is a straight copy', () => {
    const c = new Celestial({ width: 97, height: 61 });
    const m = c as unknown as { mapW: Int32Array; mapSrc: Int32Array };
    for (let p = 0; p < 97 * 61; p++) {
      if (m.mapSrc[p]! < 0) continue;
      expect(m.mapW[4 * p]! + m.mapW[4 * p + 1]! + m.mapW[4 * p + 2]! + m.mapW[4 * p + 3]!).toBe(65536);
    }
  });
});

describe('Celestial: the GDI wide pen', () => {
  it('pens are centrally symmetric half polygons whose ends overlap the other half', () => {
    for (const w of [1, 2, 3, 4, 5, 6, 7, 8, 16, 40, 79]) {
      const P = penRecord(w), n = P.length >> 1;
      expect(P[0]! + P[2 * (n - 2)]! === 0 && P[1]! + P[2 * (n - 2) + 1]! === 0, `w=${w} start`).toBe(true);
      expect(P[2 * (n - 1)]! + P[2]! === 0 && P[2 * (n - 1) + 1]! + P[3]! === 0, `w=${w} end`).toBe(true);
    }
  });
  it('a dot is a round blob within its pen width that grows with the width', () => {
    let last = 0;
    for (let w = 2; w <= 30; w++) {
      const px = new Uint32Array(64 * 64), g = new Gdi(px, 64, 64);
      g.pen(0xffffff, w);
      g.polyline([32, 32], [32, 32], 0, 2);
      let n = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (px[y * 64 + x]) {
        n++;
        expect((x - 32) ** 2 + (y - 32) ** 2, `w=${w} (${x},${y})`).toBeLessThanOrEqual((w / 2) ** 2);
      }
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect(last).toBeGreaterThan(600);
  });
  it('a closed figure widens into two loops whose winding leaves the inside open', () => {
    const q = [0, 0, 320, 0, 320, 320, 0, 320];
    const figs = widen(4, q, true);
    expect(figs).toHaveLength(2);
    let inside = 0;
    fillSpans(figs, true, 40, 40, (y, x0, x1) => { if (y === 10) for (let x = x0; x < x1; x++) if (x > 3 && x < 17) inside++; });
    expect(inside).toBe(0);
  });
  it('XOR fills a polygon once: the outline and the interior never overlap', () => {
    const px = new Uint32Array(64 * 64), g = new Gdi(px, 64, 64);
    g.rop = 7; g.brush(0x0000ff); g.pen(0xff0000, 5);
    g.polygon([10, 50, 30], [10, 12, 50], 0, 3);
    for (const v of px) expect(v === 0 || v === 0x0000ff || v === 0xff0000).toBe(true);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's pixels. InputGen's stream.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'celestial.json');
const RUNS = Array.from({ length: 10 }, (_, p) => ({ id: `celestial-p${p}-160x120`, preset: p, w: 160, h: 120 }));
RUNS.push({ id: 'celestial-p8-213x97', preset: 8, w: 213, h: 97 }, { id: 'celestial-p2-97x213', preset: 2, w: 97, h: 213 });
const FRAMES = 400;

function runGolden(r: (typeof RUNS)[number]): string[] {
  const gen = new InputGen(), c = new Celestial({ width: r.w, height: r.h, preset: r.preset }).seed(4321);
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px: Uint32Array = c.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Celestial: golden', () => {
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
