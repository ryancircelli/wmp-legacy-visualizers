// Picture Viz (PictureViz.dll, the Windows Media Bonus Pack for Windows XP; Render 0x10010f80): presets, the
// native size (the view), what the frame reads (freq[0] and the clock), the pictures (the app's, in place of
// the photo folder), then a golden guard over a synthetic stream on generated pictures. The fixture
// (./golden/fixtures/pictureviz.json) is the port's own output, written once the engine was verified
// frame-identical to the DLL over 30,000 frames on the same kind of pictures:
// GOLDEN_UPDATE=1 npx vitest run tests/pictureviz.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/pictureviz/index';
import { pictureFromRGBA, type Picture } from '../src/pictureviz/picture';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const PV = A.PictureViz;

/** A synthetic picture: gradients and rings, k shifting the colours (no black, which is the colour key). */
function picture(w: number, h: number, k: number): Picture {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, dx = x - w / 2, dy = y - h / 2, r = Math.floor(Math.sqrt(dx * dx + dy * dy));
    rgba[i] = 1 + ((x * 254) / w + k * 70) % 255;
    rgba[i + 1] = 1 + ((y * 254) / h) % 255;
    rgba[i + 2] = 1 + ((r * 6 + k * 40) % 255);
    rgba[i + 3] = 255;
  }
  return pictureFromRGBA(w, h, rgba);
}
/** a square cover (scaled by the GDI+ step) and a picture already at its fitted size for 640 x 480 */
const PICS = (): Picture[] => [picture(300, 300, 0), picture(576, 324, 1)];

function loud(f: number) {
  return level(2, (L) => { for (let i = 0; i < 1024; i++) L.freq[0][i] = (i * 7 + f * 13) % 256; });
}
const same = (a: Uint32Array, b: Uint32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
/** a run on its own (rand is the one CRT state every instance shares), the clock at 60 frames a second */
function run(preset: number, frames: number, lv: (f: number) => ReturnType<typeof level>, w = 320, h = 240, pics = PICS()): Uint32Array[] {
  let f = 0;
  const v = new PV({ width: w, height: h, preset, pictures: pics, tick: () => 1000000 + Math.floor(((f + 1) * 50) / 3) });
  v.seed(1);
  const out: Uint32Array[] = [];
  for (; f < frames; f++) out.push(v.render(lv(f))!.px.slice());
  return out;
}

describe('PictureViz: presets and size', () => {
  it('the six transitions and Random', () => {
    expect(PV.PRESET_NAMES).toEqual(['Pop Transition', 'Transparency Transition', 'Zoom Transition', 'Squirt Transition',
      'Twirl Transition', 'Dissolve Transition', 'Random']);
    const v = new PV({});
    expect(v.setPreset(6)).toBe(true);
    expect(v.setPreset(7)).toBe(false);
    expect(v.setPreset(-1)).toBe(false);
    expect(v.preset).toBe(6);
  });

  it('the surface is the view, 0x00RRGGBB, and a picture shows', () => {
    const px = run(0, 200, loud, 400, 300)[199]!;
    expect(px.length).toBe(400 * 300);
    expect(px.every((p) => p >>> 24 === 0)).toBe(true);
    expect(px.filter((p) => p !== 0).length).toBeGreaterThan(400 * 300 * 0.4);
  }, 120_000);

  it('no pictures: it renders black and asks for no folder', () => {
    const px = run(2, 200, loud, 320, 240, [])[199]!;
    expect(px.every((p) => p === 0)).toBe(true);
  }, 120_000);
});

describe('PictureViz: input', () => {
  it('reads only freq[0]: wave, freq[1], the state and the timestamp change nothing', () => {
    const a = run(3, 400, loud);
    const b = run(3, 400, (f) => {
      const L = loud(f);
      L.freq[1].fill(f); L.wave[0].fill(255 - f); L.wave[1].fill(f); L.state = [2, 3, 1][f % 3]!; L.timeStamp = f * 99991;
      return L;
    });
    expect(a.findIndex((px, f) => !same(px, b[f]!))).toBe(-1);
  }, 120_000);

  it('new pictures come at once, as a newly chosen folder does', () => {
    let f = 0;
    const v = new PV({ width: 320, height: 240, preset: 0, pictures: [picture(200, 200, 0)], tick: () => 1000000 + f * 17 });
    v.seed(1);
    for (; f < 100; f++) v.render(loud(f));
    const before = v.render(loud(f++))!.px.slice();
    v.setPictures([picture(200, 200, 2)]);
    let after = before;
    for (let n = 0; n < 200; n++, f++) after = v.render(loud(f))!.px.slice();
    expect(same(after, before)).toBe(false);
  }, 120_000);
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's surface and its rand() count, on
// InputGen's stream, the clock at 60 frames a second, srand(seed) first.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'pictureviz.json');
interface GRun { id: string; preset: number; w: number; h: number; seed: number; sw?: [number, number]; one?: boolean }
const RUNS: GRun[] = [
  ...PV.PRESET_NAMES.map((_, preset): GRun => ({ id: `pictureviz-p${preset}`, preset, w: 640, h: 480, seed: 1 })),
  { id: 'pictureviz-p3-one-800x600-s12345', preset: 3, w: 800, h: 600, seed: 12345, one: true },
  { id: 'pictureviz-p6-320x240-s7', preset: 6, w: 320, h: 240, seed: 7 },
  // over 3x the DLL's 352 x 320 canvas: the canvas is doubled before it is scaled (0x1000f7d0)
  { id: 'pictureviz-p1-one-1280x720', preset: 1, w: 1280, h: 720, seed: 1, one: true },
  { id: 'pictureviz-p4-switch-to-5', preset: 4, w: 640, h: 480, seed: 1, sw: [250, 5] },
];
const FRAMES = 600;

function runGolden(r: GRun): string[] {
  let randN = 0, f = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    const gen = new InputGen();
    const v = new PV({ width: r.w, height: r.h, preset: r.preset, pictures: r.one ? [picture(300, 300, 3)] : PICS(),
      tick: () => 1000000 + Math.floor(((f + 1) * 50) / 3) });
    v.seed(r.seed);
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (; f < FRAMES; f++) {
      const L = gen.next();
      if (r.sw && f === r.sw[0]) v.setPreset(r.sw[1]);
      randN = 0;
      const px = v.render(L)!.px;
      for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
      bh = Math.imul(bh ^ randN, 16777619);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('PictureViz: golden', () => {
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
