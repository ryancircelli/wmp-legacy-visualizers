// Shacojin (src/shacojin, the WMP 7 Bonus Pack's shacojin.dll): its presets and wiring, behaviour guards, then a golden
// over a synthetic stream. The fixture (./golden/fixtures/shacojin.json) is the port's own output, written once the port
// was verified frame-identical to the DLL over 30,000 frames of sound. GOLDEN_UPDATE=1 npx vitest run tests/shacojin.test.ts
// rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, type TimedLevel } from '../src/ns';
import '../src/rand';
import { Shacojin } from '../src/shacojin/index';
import { PRESETS, nativeSize } from '../src';
import { InputGen } from './golden/harness';

const level = (v = 0): TimedLevel => {
  const l: TimedLevel = { freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 2, timeStamp: 0 };
  l.freq[0].fill(v); l.freq[1].fill(v); l.wave[0].fill(128); l.wave[1].fill(128);
  return l;
};
const fold = (px: Uint32Array): number => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h = Math.imul(h ^ px[i]!, 16777619); h ^= h >>> 13; } return h >>> 0; };

describe('Shacojin: presets and wiring', () => {
  it('four presets, its own Effects key between those of Ripple and SnowTime, view-sized', () => {
    expect(Shacojin.PRESET_NAMES).toEqual(['Shacojin - mello', 'Shacojin - groove', 'Shacojin - chill', 'Shacojin - freak']);
    expect(A.Shacojin).toBe(Shacojin);
    const keys = [...new Set(PRESETS.map((p) => p.key))];
    expect(keys.indexOf('Shacojin')).toBe(keys.indexOf('Ripple') + 1);
    expect(keys.indexOf('SoftietheSnowman')).toBe(keys.indexOf('Shacojin') + 1);   // SnowTime's key
    expect(PRESETS.filter((p) => p.vis === 'shacojin').map((p) => p.group + ': ' + p.name)).toEqual(Shacojin.PRESET_NAMES.map((n) => 'Shacojin: ' + n));
    expect(nativeSize('shacojin', 800, 600)).toEqual([800, 600]);
  });
});

describe('Shacojin: behaviour', () => {
  it('preset numbers outside 0..3 are refused', () => {
    const k = new Shacojin({ width: 160, height: 120 });
    expect(k.setPreset(4)).toBe(false);
    expect(k.setPreset(-1)).toBe(false);
    expect(k.setPreset(3)).toBe(true);
    expect(k.preset).toBe(3);
  });
  it('the picture accumulates: nothing clears it but a beat after the fifth frame, which paints it one colour inside a black outline', () => {
    const k = new Shacojin({ width: 200, height: 150, preset: 3 });
    for (let i = 0; i < 5; i++) {
      const a = k.render(level(0))!;               // silence: hue 0, so every pen is black; no repaint before frame 5
      expect([a.w, a.h, a.px.length]).toEqual([200, 150, 30000]);
      expect(a.px.every((v) => v === 0)).toBe(true);
    }
    const b = k.render(level(40))!;                // bass well over its running level: a repaint
    const brush = b.px[1 + 200]!;
    expect(b.px[0]).toBe(0);                       // the outline (the DC's black pen)
    expect(brush).not.toBe(0);
    const c = k.render(level(0))!;                 // the next frames draw over it; the repaint stays
    expect(c.px[1 + 200]).toBe(brush);
    expect(c.px[75 * 200 + 100]).not.toBe(brush);  // coloured dots at the centre now (hue > 0)
  });
  it('a preset switch changes only the divisors (the picture and the running levels carry on)', () => {
    const go = (sw: boolean): number => {
      const k = new Shacojin({ width: 120, height: 90 });
      const gen = new InputGen();
      for (let f = 0; f < 40; f++) { if (sw && f === 20) k.setPreset(1); k.render(gen.next()); }
      return fold(k.render(gen.next())!.px);
    };
    expect(go(true)).not.toBe(go(false));
  });
});

// ---- golden: per 100-frame block, a fold of every frame's surface
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'shacojin.json');
interface GRun { id: string; preset: number; w: number; h: number }
const RUNS: GRun[] = [
  { id: 'mello-640x480', preset: 0, w: 640, h: 480 },
  { id: 'groove-640x480', preset: 1, w: 640, h: 480 },
  { id: 'chill-333x247', preset: 2, w: 333, h: 247 },
  { id: 'freak-640x480', preset: 3, w: 640, h: 480 },
  { id: 'freak-1280x720', preset: 3, w: 1280, h: 720 },
];
const FRAMES = 300;

function runGolden(r: GRun): string[] {
  const gen = new InputGen(), m = new Shacojin({ width: r.w, height: r.h, preset: r.preset });
  const out: string[] = [];
  let bh = 0x811c9dc5;
  for (let f = 0; f < FRAMES; f++) {
    const px = m.render(gen.next())!.px;
    for (let i = 0; i < px.length; i++) { bh = Math.imul(bh ^ px[i]!, 16777619); bh ^= bh >>> 13; }
    if ((f + 1) % 100 === 0) { out.push((bh >>> 0).toString(16).padStart(8, '0')); bh = 0x811c9dc5; }
  }
  return out;
}

describe('Shacojin: golden', () => {
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
