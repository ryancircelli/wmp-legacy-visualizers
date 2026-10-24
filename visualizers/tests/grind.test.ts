import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/averett/grind/index';
import { o } from '../src/averett/grind/layout';
import { TraceDevice } from '../src/d3d8/trace';
import { InputGen } from './golden/harness';

const AverettGrind = A.AverettGrind;
const noon = (): { h: number; m: number; s: number; ms: number } => ({ h: 12, m: 0, s: 0, ms: 0 });

describe('grind: the layout', () => {
  it('fields Picture Viz 3D also has land on its offsets; the sprite records stay put', () => {
    expect(o(0x96c)).toBe(0x96c);
    expect(o(0x1ca4)).toBe(0x1ca4);
    expect(o(0x31aa4)).toBe(0x3166c);          // the transition state
    expect(o(0x316a8)).toBe(0x31270);          // the transition id
    expect(o(0x28ac)).toBe(0x2670);            // Chk_PicIII_transition_1
  });
});

/** a frame's records (from byte o): the calls and every blob but 4-byte ones (the trace device's object addresses) */
function digest(b: Uint8Array, at: number): string {
  const h = createHash('sha1'), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (at === 0) at = 8;
  while (at < b.length) {
    const id = dv.getUint32(at, true), n = dv.getUint32(at + 8, true);
    h.update(String(id));
    at += 12 + 4 * n;
    const nb = dv.getUint32(at, true); at += 4;
    for (let k = 0; k < nb; k++) { const l = dv.getUint32(at, true); at += 4; if (l !== 4) h.update(b.subarray(at, at + l)); at += l; }
  }
  return h.digest('hex').slice(0, 12);
}

describe('grind: Go BIG or Go Home through the trace device, on our own art', () => {
  it('names one preset, creates its device on its second frame and presents from its third', () => {
    expect(AverettGrind.PRESET_NAMES).toEqual(['Go BIG or Go Home']);
    const gen = new InputGen(1);
    let f = 0, dev: TraceDevice | null = null;
    const eng = new AverettGrind({ options: { clock: () => 100000 + f * 33, seed: 1, localTime: noon, device: (w, h) => (dev = new TraceDevice(w, h)) } });
    const shown: boolean[] = [];
    for (; f < 3; f++) { shown.push(!!eng.render(gen.next())); if (f === 0) expect(dev).toBe(null); }
    expect(dev).not.toBe(null);
    expect(shown).toEqual([false, false, true]);
  }, 120000);
  it('golden: the port\'s own call stream per frame', () => {
    const gen = new InputGen(0x6a1d);
    let f = 0, dev: TraceDevice | null = null, last = 0;
    const got: string[] = [];
    const eng = new AverettGrind({
      options: { clock: () => 100000 + f * 33, seed: 1, localTime: noon, device: (w, h) => (dev = new TraceDevice(w, h)) },
    });
    for (f = 0; f < 40; f++) {
      eng.render(gen.next());
      const b = dev ? (dev as TraceDevice).bytes() : new Uint8Array(0);
      got.push(digest(b, last));
      last = b.length;
    }
    const p = join(dirname(fileURLToPath(import.meta.url)), 'golden/fixtures/averett-grind.json');
    if (process.env.GOLDEN_UPDATE || !existsSync(p)) writeFileSync(p, JSON.stringify(got, null, 0) + '\n');
    expect(got).toEqual(JSON.parse(readFileSync(p, 'utf8')) as string[]);
  }, 300000);
});

describe('grind: through the reference rasterizer', () => {
  it('answers the music: silence and a loud stream differ', () => {
    const run = (loud: boolean): Uint32Array => {
      const gen = new InputGen(7), quiet = gen.next();
      quiet.freq[0].fill(0); quiet.freq[1].fill(0); quiet.wave[0].fill(128); quiet.wave[1].fill(128);
      let f = 0, px = new Uint32Array(0);
      const eng = new AverettGrind({ width: 96, height: 72, options: { clock: () => 100000 + f * 33, seed: 1, localTime: noon } });
      for (f = 0; f < 14; f++) { const s = eng.render(loud ? gen.next() : quiet); if (s) px = s.px.slice(); }
      return px;
    };
    const a = run(false), b = run(true);
    expect(a.length).toBe(96 * 72);
    expect(a.some((p) => p !== a[0])).toBe(true);
    expect(a.some((p, i) => p !== b[i])).toBe(true);
  }, 300000);
});
