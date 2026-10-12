// Plenoptic (WMP 7-10; wmp.dll 10 Render 0x07873e8d): presets, the native size, the surface primitives'
// quirks (truncation, the blur's run, vgrad's alpha byte), the beat detector, the particle list, the
// stop fade; then a golden guard over a synthetic stream. The fixture (./golden/fixtures/plenoptic.json)
// is the port's own output, written once the port was verified frame-identical to the DLL:
// GOLDEN_UPDATE=1 npx vitest run tests/engine/plenoptic.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/plenoptic/index';
import { Surf, ftol, gradient } from '../../src/engine/plenoptic/surf';
import { PList, P_SIZE, AGE, LIFE, PY, VY } from '../../src/engine/plenoptic/particles';
import { sincos87 } from '../../src/engine/plenoptic/x87';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const Plenoptic = (A as any).Plenoptic;

function clock(step = 50 / 3) {
  let f = 0;
  return { tick: () => Math.floor(f * step), next: () => { f++; } };
}
function silence(state = 2) {
  return level(state, (L) => { L.wave[0].fill(128); L.wave[1].fill(128); });
}

describe('Plenoptic: presets and size', () => {
  it("names: WMP 10's seven, then the older builds' that draw other frames", () => {
    expect(Plenoptic.PRESET_NAMES).toEqual(['Random', 'Smokey Circles', 'Smokey Lines', 'Vox', 'Flame', 'Fountain', 'Spyro',
      'Random (WMP 8)', 'Spyro (WMP 8)',
      'Random (WMP 7)', 'Smokey Circles (WMP 7)', 'Smokey Lines (WMP 7)', 'Vox (WMP 7)', 'Flame (WMP 7)', 'Fountain (WMP 7)', 'Spyro (WMP 7)']);
    const p = new Plenoptic({});
    expect(p.setPreset(15)).toBe(true);
    expect([p.dll, p.f.ver]).toEqual([6, 7]);
    expect(p.setPreset(8)).toBe(true);
    expect([p.dll, p.f.ver]).toEqual([6, 8]);
    expect(p.setPreset(6)).toBe(true);
    expect([p.dll, p.f.ver]).toEqual([6, 10]);
    expect(p.setPreset(16)).toBe(false);
    expect(p.setPreset(-1)).toBe(false);
    expect(p.preset).toBe(6);
    expect(new Plenoptic({ preset: 3, version: 7 }).f.ver).toBe(7);   // the A/B twin's way: a DLL preset and a version
  });

  it('a variant preset draws exactly what its DLL preset does under its version', () => {
    const names: string[] = Plenoptic.PRESET_NAMES;
    for (let i = 7; i < names.length; i++) {
      const base = names.indexOf(names[i]!.replace(/ \(WMP \d\)$/, '')), ver = +/WMP (\d)/.exec(names[i]!)![1]!;
      const run = (cfg: object) => {
        A.srand(5);
        const gen = new InputGen(), c = clock(), p = new Plenoptic({ ...cfg, tick: c.tick });
        let h = 0;
        for (let f = 0; f < 120; f++) {
          const L = gen.next();
          if (f >= 100 && f < 110) L.state = 1;
          c.next(); p.render(L);
          for (const v of p.scr.px) h = Math.imul(h ^ v, 16777619);
        }
        return h;
      };
      expect(run({ preset: i }), names[i]).toBe(run({ preset: base, version: ver }));
    }
  }, 120_000);

  it('the native surface comes from the resolution setting, never the window', () => {
    for (const [r, w, h] of [[0, 256, 192], [1, 320, 200], [2, 320, 240], [3, 384, 288], [4, 512, 384], [5, 640, 480]] as const) {
      const c = clock(), p = new Plenoptic({ width: 999, height: 111, resolution: r, tick: c.tick });
      const s = p.render(silence());
      expect([s.w, s.h, s.px.length]).toEqual([w, h, w * h]);
    }
  });
});

describe('Plenoptic: primitives', () => {
  it('ftol truncates toward zero and keeps the low dword', () => {
    expect([ftol(2.9), ftol(-2.9), ftol(-0.5), ftol(4294967298.5), ftol(NaN), ftol(1e300)]).toEqual([2, -2, 0, 2, 0, 0]);
  });

  it('gradient steps each byte by (c1 - c0)/n from c0, truncated, c1 never reached', () => {
    const g = gradient(0xff0000ff, 0xffffff00, 512);
    expect(g[0]).toBe(0xff0000ff);
    expect(g[1]).toBe(0xff0000fe);                  // B 255 - 255/512 = 254.5 -> 254, R/G 0.498 -> 0
    expect(g[511]).toBe(0xfffefe00);
  });

  it('lines take 0..1 coordinates scaled by (w-1, h-1); the border frame touches every edge pixel', () => {
    const s = new Surf();
    s.alloc(8, 6);
    const c = 0xff000000 | 0;
    s.line(0, 0, 1, 0, c); s.line(1, 0, 1, 1, c); s.line(1, 1, 0, 1, c); s.line(0, 1, 0, 0, c);
    let n = 0;
    for (const v of s.px) if (v) n++;
    expect(n).toBe(2 * 8 + 2 * 4);
  });

  it('blur runs over (h-2)*w - 2 pixels from (1, 1), rows as one run, minus the decay', () => {
    const s = new Surf(), d = new Surf();
    s.alloc(4, 4); d.alloc(4, 4);
    s.px.fill(0x00404040);
    s.decay = 4;
    s.blur(d);
    const v = 0x40 - 4;
    const want = new Uint32Array(16);
    for (let i = 5; i < 5 + 6; i++) want[i] = (v << 16) | (v << 8) | v;
    expect(Array.from(d.px)).toEqual(Array.from(want));
  });

  it('the two-lane blur equals the per-byte one, in place and not, any decay', () => {
    const ref = (src: Uint8Array, dst: Uint8Array, w: number, h: number, dec: number) => {
      const w4 = w * 4, end = (h - 1) * w * 4 - 4;
      for (let o = (w + 1) * 4; o < end; o++) {
        const v = ((src[o - w4]! + src[o + w4]! + src[o - 4]! + src[o + 4]!) >> 2) - dec;
        dst[o] = v < 0 ? 0 : v;
      }
    };
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 0;
    for (const [w, h, dec] of [[17, 9, 4], [8, 8, 0], [33, 5, 255], [12, 7, 12]] as const) {
      const a = new Surf(), b = new Surf();
      a.alloc(w, h); b.alloc(w, h);
      for (let i = 0; i < a.px.length; i++) a.px[i] = rnd();
      a.decay = dec;
      const r1 = a.b.slice(), r2 = new Uint8Array(r1.length);
      ref(r1, r2, w, h, dec);
      a.blur(b);
      expect(Array.from(b.b)).toEqual(Array.from(r2));
      const inplace = a.b.slice();
      ref(inplace, inplace, w, h, dec);
      a.blur(a);
      expect(Array.from(a.b)).toEqual(Array.from(inplace));
    }
  });

  it("vgrad plots every other pixel; its alpha is the top byte of B1 - B0", () => {
    const s = new Surf();
    s.alloc(1, 9);
    s.vgrad(0, 0, 8, 0xffffa000 | 0, 0xffffff00 | 0);
    expect(Array.from(s.px).map((v) => v >>> 24)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([0, 2, 4, 6].map((y) => s.px[y] !== 0)).toEqual([true, true, true, true]);
    expect(s.px[1]).toBe(0);
    s.px.fill(0);
    s.vgrad(0, 0, 4, 0x000000ff, 0x00000000);
    expect(s.px[0]! >>> 24).toBe(0xff);
  });
});

describe('Plenoptic: the x87 FSIN/FCOS model', () => {
  it('stores what the FPU stores, where Math.sin does not (66-bit pi reduction)', () => {
    const o = new Float64Array(4);
    // [x, fsin, fcos] as an x87 at 53-bit precision leaves them in memory (fstp qword)
    for (const [x, s, c] of [[3.141592653589793, 1.2246063538223773e-16, -1], [2.5, 0.59847214410395655, -0.8011436155469337],
      [3000.123, 0.097827464131671801, -0.99520338989654089], [0.7, 0.64421768723769102, 0.7648421872844885]] as const) {
      sincos87(x, o);
      expect([o[0]! + o[1]!, o[2]! + o[3]!]).toEqual([s, c]);
    }
    expect(Math.sin(2.5)).not.toBe(0.59847214410395655);
  });
});

describe('Plenoptic: beat and particles', () => {
  it('a beat is a rise then a fall of the truncated RMS by more than twice its trough', () => {
    const p = new Plenoptic({});
    const f = p.f;
    const amp = (a: number) => { f.wave0.fill(128 + a); f.wave1.fill(128 + a); f.detect(); return f.beat; };
    expect([amp(0), amp(10), amp(40), amp(5)]).toEqual([false, false, false, true]);   // trough 0, peak 40
    expect([amp(30), amp(31), amp(20)]).toEqual([false, false, true]);                 // trough 5, peak 31: 26 > 10
    expect([amp(40), amp(30)]).toEqual([false, false]);                                // trough 20, peak 40: 20 > 40 is not
  });

  it('remove moves the last particle into the hole; step drops age > life; cull removes the oldest batch', () => {
    const L = new PList();
    L.reserve(4);
    const p = new Float64Array(P_SIZE);
    for (let i = 0; i < 4; i++) { p[PY] = i; p[LIFE] = 1; p[AGE] = i * 0.1; L.add(p); }
    L.add(p);                                       // full: ignored
    expect(L.count).toBe(4);
    L.remove(1);
    expect([0, 1, 2].map((i) => L.a[i * P_SIZE + PY])).toEqual([0, 3, 2]);
    L.a[2 * P_SIZE + AGE] = 0.5;
    L.cull(2);                                      // 1 free, need 1: the oldest (age 0.5) goes
    expect(L.count).toBe(2);
    L.a[0 * P_SIZE + AGE] = 2;
    L.step(0);
    expect(L.count).toBe(1);
    L.a[PY] = 0.25; L.a[VY] = 1;
    L.bounce(0, 0);                                 // past the plane: mirrored, vy flipped and halved
    expect([L.a[PY], L.a[VY]]).toEqual([-0.25, -0.5]);
  });
});

describe('Plenoptic: stopped and paused', () => {
  it('64 frames of in-place blur after the music stops, then a black window (the DIB is kept)', () => {
    const c = clock(), p = new Plenoptic({ preset: 3, tick: c.tick });
    const loud = level(2, (L) => { L.freq[0].fill(200); L.freq[1].fill(200); L.wave[0].fill(128); L.wave[1].fill(128); });
    for (let i = 0; i < 20; i++) { p.render(loud); c.next(); }
    const before = p.scr.px.slice();
    expect(p.render(silence(0)).px.some((v: number) => v !== 0)).toBe(true);
    expect(p.scr.px).not.toEqual(before);           // blurred in place, nothing drawn
    for (let i = 1; i < 64; i++) { p.render(silence(i & 1)); c.next(); }
    expect(p.fade).toBe(0);
    const kept = p.scr.px.slice();
    expect(p.render(silence(1)).px.every((v: number) => v === 0)).toBe(true);
    expect(p.scr.px).toEqual(kept);
    p.render(silence(2));
    expect(p.fade).toBe(64);
  }, 60_000);
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's native surface (alpha included)
// and its rand() count. InputGen's stream with a 60 fps clock (16/17 ms ticks), srand(1) first, plus
// stop/pause frames for the fade path.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'plenoptic.json');
interface GRun { id: string; preset: number; res: number; ch: number; seed: number; stops?: boolean; version?: number; switchTo?: number }
const RUNS: GRun[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((preset): GRun => ({ id: `plenoptic-p${preset}-r0`, preset, res: 0, ch: 0, seed: 1 })),
  { id: 'plenoptic-p0-r5-s777-stops', preset: 0, res: 5, ch: 0, seed: 777, stops: true },
  { id: 'plenoptic-p5-r3-ch1', preset: 5, res: 3, ch: 1, seed: 12345 },
  { id: 'plenoptic-p6-r2-stops', preset: 6, res: 2, ch: 0, seed: 1, stops: true },
  { id: 'plenoptic-p6-r0-v8', preset: 6, res: 0, ch: 0, seed: 1, version: 8 },
  { id: 'plenoptic-p4-r0-v9', preset: 4, res: 0, ch: 0, seed: 3, version: 9 },
  { id: 'plenoptic-p3-r0-v7-stops', preset: 3, res: 0, ch: 0, seed: 1, version: 7, stops: true },
  // the variant presets by index, one switched in mid-run (frame 150) on the same object
  { id: 'plenoptic-p15-r0-stops', preset: 15, res: 0, ch: 0, seed: 1, stops: true },
  { id: 'plenoptic-p6-to-p8-r0', preset: 6, res: 0, ch: 0, seed: 1, switchTo: 8 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  let randN = 0;
  const realRand = A.rand;
  A.rand = () => { randN++; return realRand(); };
  try {
    A.srand(r.seed);
    const gen = new InputGen(), c = clock();
    const p = new Plenoptic({ preset: r.preset, resolution: r.res, channels: r.ch, version: r.version, tick: c.tick });
    const out: string[] = [];
    let bh = 0x811c9dc5;
    for (let f = 0; f < FRAMES; f++) {
      const L = gen.next();
      if (r.stops && f % 151 >= 140) L.state = f % 2 ? 0 : 1;
      if (r.switchTo !== undefined && f === 150) p.setPreset(r.switchTo);
      c.next();
      randN = 0;
      p.render(L);
      const px: Uint32Array = p.scr.px;
      for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
      bh = Math.imul(bh ^ randN, 16777619);
      if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
    }
    return out;
  } finally { A.rand = realRand; }
}

describe('Plenoptic: golden', () => {
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
