// Ambience (src/engine/ambience): a few structural checks, then the golden guard: every preset (and the
// two larger surfaces) rendered on the synthetic stream of ./golden/harness.ts, one FNV-1a per 100-frame
// block over the 8-bit surface, the palette and the rand() count of every frame. The fixture
// (ambience.golden.json) was generated from the port once it was verified bit-exact against the DLL;
// GOLDEN_UPDATE=1 npx vitest run tests/engine/ambience.test.ts rewrites it.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/ambience/index';
import { trigTrunc } from '../../src/engine/ambience/maps';
import { InputGen } from './golden/harness';
import { level, mirror } from './helpers-2';

const Ambience = (A as any).Ambience;
// Random seeds the CRT from the clock at SetCurrentPreset and again on the first Render (as the DLL
// does), so the clock stays pinned for the whole file.
vi.spyOn(Date, 'now').mockReturnValue(1700000000 * 1000);

function make(preset: number, w = 256, h = 192): any {
  A.srand(1);
  return new Ambience({ preset, width: w, height: h });
}

describe('Ambience: tables', () => {
  it('decay and fade LUTs (0x0796cd01 / 0x0796cd42)', () => {
    const e = make(1);
    e.render(level(2));
    // Swirl: d = 4 below 0x80, 2 above, floored at 1; fade = LUT[sum/5]
    expect(e.lut[1]).toBe(1); expect(e.lut[5]).toBe(1); expect(e.lut[6]).toBe(2);
    expect(e.lut[0x7f]).toBe(0x7b); expect(e.lut[0x80]).toBe(0x7e); expect(e.lut[0xfe]).toBe(0xfc);
    expect(e.fade[5 * 0x7f]).toBe(0x7b);
    e.setPreset(2);                               // Warp: plain average, kept within 1..254
    expect(e.fade[0]).toBe(1); expect(e.fade[5 * 200 + 4]).toBe(200); expect(e.fade[1279]).toBe(254);
  });

  it('the palette is two 127-step gradients; 0 and 255 stay black', () => {
    const e = make(1), p = e.pal32;
    expect(p[0]).toBe(0); expect(p[255]).toBe(0);
    expect(p[1]).toBe(0x000060);                   // set 0's c0 0x600000 (B=0x60) as 0x00RRGGBB
    expect(p[128]).toBe(0x000060);
    expect(p[254] & 0xff).toBe(0xfd);              // c3 white, 126/127 of the way: 0x60 + trunc(126*159/127)
  });

  it('the DDA compares the error with the major delta (0x07987993)', () => {
    const e = make(1);
    e.render(level(2));
    e.cur.fill(0);
    e.line(0, 0, 4, 1, 9);                         // the row step would come after the 5th pixel: never drawn
    const row = (y: number) => Array.from(e.cur.subarray(y * 256, y * 256 + 5));
    expect(row(0)).toEqual([9, 9, 9, 9, 9]);
    expect(row(1)).toEqual([0, 0, 0, 0, 0]);
    e.cur.fill(0);
    e.line(0, 0, 2, 4, 7);
    let n = 0;
    for (let i = 0; i < e.cur.length; i++) if (e.cur[i] === 7) n++;
    expect(n).toBe(5);                             // y-major: dy + 1 pixels
  });

  it('a group change fades to a new set at once: rand()%500, then a 200-Render fade, rand()%13 + 13', () => {
    const e = make(2);
    const r = mirror(1);
    e.render(level(2));                            // creates the surfaces, then Warp's first Render
    const c = r() % 500 + 100, i = r() % 13 + 13;
    expect(e.palCountdown).toBe(c);
    expect(e.fading).toBe(true);
    expect(e.fadeStep).toBe(Math.fround(1 / 200));
    expect(e.target[1]).toBe([0x7090ff, 0x70ff90, 0xff9070, 0xff70ff, 0xffff70, 0x70ffff, 0xa0a0a0,
      0x0000ff, 0x00ff00, 0xff0000, 0xff00ff, 0xffff00, 0x00ffff][i - 13]);
  });

  it('x87 trig products: 64-bit cos times r rounded once (Bubble at 512x384, pixel (172,157))', () => {
    const a = Math.atan2(35, 84), r = 68.25;                    // r = 91 - 91^3/182^2; cos = 12/13
    expect(Math.trunc(Math.cos(a) * r)).toBe(62);               // JS rounds cos to double first: 62.99999999999999
    expect(trigTrunc(false, a, r)).toBe(63);                    // the DLL's map entry
    expect(trigTrunc(true, a, r)).toBe(26);
    expect(trigTrunc(true, 1.25, 100)).toBe(Math.trunc(Math.sin(1.25) * 100));
  });

  it('the preset list: WMP 10 first, the older builds\' variants after', () => {
    expect(Ambience.PRESET_NAMES.length).toBe(24);
    expect(Ambience.PRESET_NAMES[13]).toBe('Thingus');
    expect(Ambience.PRESET_NAMES[14]).toBe('Random (WMP 7)');
    let e = make(17);
    expect([e.base, e.v9, e.oldNiagara]).toEqual([1, true, false]);
    e = make(23);
    expect([e.base, e.v9, e.oldNiagara]).toEqual([9, false, true]);
    e = make(14);
    expect([e.base, e.rndN]).toEqual([0, 12]);
  });

  it('a stopped stream fades for 299 Renders, then shows palette entry 1', () => {
    const e = make(2);                             // Warp's fade has no decay: a flat field stays put
    e.render(level(2));
    e.cur.fill(200);
    let s: any;
    for (let i = 0; i < 299; i++) s = e.render(level(0));
    expect(s.px.every((v: number) => v === e.pal32[1])).toBe(false);
    s = e.render(level(0));
    expect(s.px.every((v: number) => v === e.pal32[1])).toBe(true);
  });
});

// ---------------------------------------------------------------- golden
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'ambience.golden.json');
const UPDATE = !!process.env.GOLDEN_UPDATE;
const fixture: Record<string, string[]> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const fresh: Record<string, string[]> = {};

function fnv(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619);
  return h;
}

function golden(preset: number, frames: number, w: number, h: number): string[] {
  const e = make(preset, w, h), gen = new InputGen(0x5eed + preset);
  const real = A.rand;
  let n = 0;
  A.rand = function () { n++; return real(); };
  const out: string[] = [];
  let acc = 2166136261;
  try {
    for (let f = 0; f < frames; f++) {
      n = 0;
      e.render(gen.next());
      acc = fnv(fnv(Math.imul(acc ^ n, 16777619), e.cur), e.pal);
      if (f % 100 === 99) { out.push((acc >>> 0).toString(16)); acc = 2166136261; }
    }
  } finally { A.rand = real; }
  return out;
}

const RUNS: [string, number, number, number, number][] = Ambience.PRESET_NAMES.map(
  (_: string, p: number): [string, number, number, number, number] => ['p' + p, p, p === 0 || (p >= 14 && p <= 16) || p === 9 || p === 23 ? 1500 : 600, 256, 192]);
RUNS.push(['p0-384x288', 0, 600, 384, 288], ['p12-512x384', 12, 300, 512, 384], ['p9-512x384', 9, 300, 512, 384]);

describe('Ambience: golden', () => {
  for (const [id, p, frames, w, h] of RUNS) {
    it(`${id} x ${frames}`, () => {
      const got = golden(p, frames, w, h);
      if (UPDATE) { fresh[id] = got; return; }
      expect(got).toEqual(fixture[id]);
    }, 120_000);
  }
  afterAll(() => {
    if (UPDATE) writeFileSync(FILE, '{\n' + Object.entries(fresh).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
  });
});
