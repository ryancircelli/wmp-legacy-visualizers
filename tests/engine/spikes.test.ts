// Spikes (WMP 7-10, wmp.dll 9 Render 0x0797f0a9): presets, the peak-hold level, the spoke colour, the
// Bresenham walk, mono mirroring and the stop/hold paths; then a golden guard over a synthetic stream.
// The golden fixture (./golden/fixtures/spikes.json) is the port's own output, written once the port was
// verified frame-identical to the DLLs; GOLDEN_UPDATE=1 npx vitest run tests/engine/spikes.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/spikes/index';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const Spikes = (A as any).Spikes;

function silence(ts: number, state = 2) {
  return level(state, (L) => { L.wave[0].fill(128); L.wave[1].fill(128); L.timeStamp = ts; });
}
function lit(px: Uint32Array): number { let n = 0; for (const v of px) if (v) n++; return n; }

describe('Spikes: presets', () => {
  it('names and the four properties SetCurrentPreset writes', () => {
    expect(Spikes.PRESET_NAMES).toEqual(['Spike', 'Amoeba']);
    const s = new Spikes({ width: 64, height: 48 });
    expect([s.preset, s.displayMode, s.fallbackSpeed, s.foregroundColor]).toEqual([0, 0, 3, 0x000001]);
    expect(s.setPreset(1)).toBe(true);
    expect([s.preset, s.displayMode, s.fallbackSpeed, s.foregroundColor]).toEqual([1, 1, 2, 0x10ff10]);
    expect(s.setPreset(2)).toBe(false);
    expect(s.setPreset(-1)).toBe(false);
    expect(s.preset).toBe(1);
  });
  it("the player's colour replaces both presets' own after every preset change (WMP 9-11's Now Playing)", () => {
    const s = new Spikes({ width: 64, height: 48, options: { foregroundColor: 0xa4eb0c } });
    expect(s.foregroundColor).toBe(0x0ceba4);            // 0xRRGGBB in, COLORREF (R low) inside
    s.setPreset(1);
    expect([s.displayMode, s.foregroundColor]).toEqual([1, 0x0ceba4]);
    s.options.foregroundColor = null;                     // back to the presets' own on the next change
    s.setPreset(0);
    expect(s.foregroundColor).toBe(0x000001);
  });
});

describe('Spikes: level and colour (0x0797ed47)', () => {
  it('peak-holds the halved waveform, returns the pre-fall level floored at 64, falls by fallbackSpeed', () => {
    const s = new Spikes({ width: 64, height: 48 });
    const w = new Uint8Array(1024);
    w[0] = 254;                                     // 127
    expect(s.value(w, 0, 0)).toBe(127);
    w[0] = 128;                                     // 64: not above the held 127
    expect(s.value(w, 0, 0)).toBe(127);
    expect(s.level[0]).toBe(124);
    for (let k = 0; k < 30; k++) s.value(w, 0, 0);
    expect(s.level[0]).toBe(64);                    // 124 - 20*3 = 64, then 64 replaces the decayed 61
    w[0] = 0;
    expect(s.value(w, 0, 0)).toBe(64);              // held 64 is returned (and decays to 61)
    expect(s.value(w, 0, 0)).toBe(64);              // 61 -> 58, still floored at 64
    s.level[0] = -3;
    expect(s.value(w, 0, 0)).toBe(0);               // a sample above the held level is returned as it is
    s.hold = true; s.level[0] = -2;
    expect(s.value(w, 0, 0)).toBe(-2);              // holding: the held level, unfloored, untouched
    expect(s.level[0]).toBe(-2);
  });

  it('non-zero channels become c + 4v - 180, capped at 255 but wrapped below 0', () => {
    const s = new Spikes({ width: 64, height: 48 });  // fg R=1
    expect(s.color(64)).toBe(77 << 16);
    expect(s.color(0)).toBe(77 << 16);              // 1 - 180 = -179 keeps its low byte, 77
    expect(s.color(127)).toBe(255 << 16);
    s.setPreset(1);                                 // R=0x10 G=0xFF B=0x10
    expect(s.color(64)).toBe((92 << 16) | (255 << 8) | 92);
    expect(s.color(10)).toBe((((16 + 40 - 180) & 255) << 16) | ((255 + 40 - 180) << 8) | ((16 + 40 - 180) & 255));
  });
});

describe('Spikes: drawing', () => {
  it('silence at 64x48, stereo: spoke 0 runs from the centre 12 px right in (1 + 4*64 - 180) red', () => {
    const s = new Spikes({ width: 64, height: 48 });
    const S = s.render(silence(1));
    expect(S.px[24 * 64 + 32]).toBe(77 << 16);
    expect(S.px[24 * 64 + 44]).toBe(77 << 16);     // rad = 48*64 >> 8 = 12
    expect(S.px[24 * 64 + 45]).toBe(0);
    expect(S.px[12 * 64 + 32]).toBe(77 << 16);     // the spoke near pi/2: sin rounds to 1.0
    expect(S.px[11 * 64 + 32]).toBe(0);
  });

  it('the line walk starts its error at half the minor delta', () => {
    // spoke 32 (a = pi/8) at rad 12: x = 32 + trunc(12 cos) = 43, y = 24 - trunc(12 sin) = 20, an
    // x-major line with adx 11, ady 4: err starts at 4 >> 1 = 2, so y steps at x = 34, 37, 40, 43.
    // (A textbook Bresenham, err from 11 >> 1, would step at 34 instead.)
    const s = new Spikes({ width: 64, height: 48, channels: 1 });
    s.level.fill(0);                                // every other spoke: rad 0, only the centre pixel
    s.level[32] = 64;
    const S = s.render(silence(0));                 // ts 0 == the initial last timestamp: holding
    const ys: number[] = [];
    for (let x = 33; x <= 43; x++) {
      let y = 0;
      while (!S.px[y * 64 + x]) y++;                // the upper line's pixel in this column
      ys.push(y);
    }
    expect(ys).toEqual([24, 24, 23, 23, 22, 22, 22, 21, 21, 21, 20]);
  });

  it('mono mirrors channel 0 top and bottom; stereo puts channel 1 below', () => {
    const mono = new Spikes({ width: 101, height: 77, channels: 0 });
    const L = level(2, (l) => { for (let i = 0; i < 1024; i++) { l.wave[0][i] = (i * 37) & 255; l.wave[1][i] = 128; } l.timeStamp = 1; });
    const M = mono.render(L);
    for (let y = 0; y < 77; y++) for (let x = 0; x < 101; x++) {
      const yy = 2 * 38 - y;
      if (yy >= 0 && yy < 77) expect(M.px[y * 101 + x] !== 0).toBe(M.px[yy * 101 + x] !== 0);
    }
    const st = new Spikes({ width: 101, height: 77, channels: 2 });
    const T = st.render(L);
    let below = 0;
    for (let y = 40; y < 77; y++) for (let x = 0; x < 101; x++) if (T.px[y * 101 + x]) below++;
    expect(below).toBeLessThan(lit(M.px) / 2);      // channel 1 is silence: short spokes below
  });

  it('Amoeba draws only the spoke tips', () => {
    const s = new Spikes({ width: 64, height: 48, preset: 1, channels: 0 });
    expect(lit(s.render(silence(1)).px)).toBeLessThanOrEqual(512);
  });

  it('stopped fills the background; a repeated timestamp or pause holds the levels', () => {
    const s = new Spikes({ width: 32, height: 32, options: { backgroundColor: 0x123456 } });
    expect(Array.from(new Set(s.render(silence(5, 0)).px))).toEqual([0x123456]);
    s.render(silence(7));
    const held = s.level.slice();
    s.render(silence(7));
    expect(s.hold).toBe(true);
    expect(s.level).toEqual(held);
    s.render(silence(8, 1));
    expect(s.hold).toBe(true);
    s.render(silence(9));
    expect(s.hold).toBe(false);
  });
});

// ---- golden: per 100-frame block, an FNV-style fold of every frame's pixels. InputGen's stream (silence,
// noise, beats, sweeps, bursts, chords; 1 timestamp in 64 repeated), plus stop/pause frames as the
// A/B host's -Mix makes them.
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'spikes.json');
const RUNS = [
  { id: 'spikes-p0-640x480-ch2', preset: 0, w: 640, h: 480, ch: 2 },
  { id: 'spikes-p1-640x480-ch2', preset: 1, w: 640, h: 480, ch: 2 },
  { id: 'spikes-p0-517x389-ch0', preset: 0, w: 517, h: 389, ch: 0 },
  { id: 'spikes-p1-389x517-ch0', preset: 1, w: 389, h: 517, ch: 0 },
];
const FRAMES = 600;

function runGolden(r: (typeof RUNS)[number]): string[] {
  const gen = new InputGen(), s = new Spikes({ width: r.w, height: r.h, preset: r.preset, channels: r.ch });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const L = gen.next();
    if (f % 97 < 2) L.state = 0; else if (f % 89 === 5) L.state = 1;
    const px: Uint32Array = s.render(L).px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }   // the shift: Spike's pixels are all R << 16
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Spikes: golden', () => {
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
