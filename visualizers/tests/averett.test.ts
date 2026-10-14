// The Averett Plugin framework port, Rhythm and Waves (src/averett): the D3DX math it reproduces, the
// equalizer picture's GDI+ steps, and the engine's call stream through the trace device. The golden guard
// (./golden/fixtures/averett-mp9.json) is the port's own trace, per frame, on a synthetic stream, written once the port
// was verified call-identical to the DLL: GOLDEN_UPDATE=1 npx vitest run tests/averett.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/averett/index';
import { TraceDevice } from '../src/d3d8/trace';
import { vec3Normalize, matMul, matRotQuat, quatYawPitchRoll, perspectiveFovRH, boxMip } from '../src/averett/d3dx';
import { eqSource, eqImage, scaleHQ } from '../src/averett/gdip';
import { fr64, ftol } from '../src/averett/heap';
import { InputGen } from './golden/harness';

const AverettMp9 = A.AverettMp9;

describe('averett: x87 and D3DX helpers', () => {
  it('ftol truncates and fr64 rounds a 64-bit value straight to float', () => {
    expect([ftol(2.9), ftol(-2.9), ftol(1e20)]).toEqual([2, -2, 0]);
    const mid = 1 + Math.pow(2, -24);                       // halfway between 1 and the next float
    expect(fr64(mid, 1e-30)).toBe(Math.fround(1 + Math.pow(2, -23)));
    expect(fr64(mid, -1e-30)).toBe(1);
    expect(fr64(mid, 0)).toBe(1);                           // ties to even
  });
  it('D3DXVec3Normalize: zero stays zero, unit length is copied, others land within the table chord error', () => {
    const o = new Float32Array(3);
    vec3Normalize(o, 0, 0, 0, 0); expect([...o]).toEqual([0, 0, 0]);
    vec3Normalize(o, 0, 0.6, 0.8, 0); expect([...o]).toEqual([Math.fround(0.6), Math.fround(0.8), 0]);
    for (const v of [[3, 1, 4], [0.01, 1, -0.02], [100, -7, 2]]) {
      vec3Normalize(o, 0, v[0], v[1], v[2]);
      expect(Math.abs(Math.hypot(o[0], o[1], o[2]) - 1)).toBeLessThan(2e-6);
    }
  });
  it('matrices: multiply order, quaternion rotation, the right-handed projection the water uses', () => {
    const a = new Float32Array(16), b = new Float32Array(16), c = new Float32Array(16);
    a.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]); b.set([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    matMul(c, a, b); expect([...c.subarray(0, 4)]).toEqual([2, 1, 3, 4]);
    const q = new Float32Array(4), m = new Float32Array(16);
    quatYawPitchRoll(q, 0, 0, 0); matRotQuat(m, q);
    expect([...m]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    perspectiveFovRH(m, Math.fround(Math.PI / 3), Math.fround(320 * 0.2 / 240), Math.fround(0.1), 2000);
    expect(m[11]).toBe(-1); expect(m[10]).toBeCloseTo(-1.00005, 5); expect(m[5]).toBeCloseTo(1.73205, 5);
  });
  it('the box mip filter rounds (a + b + c + d + 2) >> 2 per byte', () => {
    const src = new Uint8Array(16).fill(0); src[0] = 1; src[4] = 2; src[8] = 2; src[12] = 2;
    expect(boxMip(src, 2, 2)[0]).toBe(2);
  });
});

describe('averett: the equalizer picture (GDI+)', () => {
  it('rules and cells are premultiplied as SourceOver leaves them on a transparent bitmap', () => {
    const cells = new Int32Array(18 * 8);
    cells[8] = 0xcc; cells[9] = 0xff; cells[10] = 0x80;     // band 1 at x 0xcc: cell 1 lit, cell 2 half
    const b1 = eqSource(cells);
    expect(b1[10 * 212 + 0xbe].toString(16)).toBe('3c212c36');           // pen 0x3c8ebce6
    expect(b1[0x2b * 212 + 0xcc].toString(16)).toBe('ffffff00');         // lit: opaque yellow
    expect(b1[0x26 * 212 + 0xcc].toString(16)).toBe('80476b80');         // round(c * 0x80 / 255)
    expect(b1[0]).toBe(0);
  });
  it('the shrink keeps the picture inside 0..alpha and a 1:1 copy is exact', () => {
    const cells = new Int32Array(18 * 8);
    for (let b = 1; b < 18; b++) { cells[b * 8] = 0xcc - b * 11; for (let k = 1; k < 8; k++) cells[b * 8 + k] = (b * 37 + k * 11) & 0xff; }
    const b1 = eqSource(cells);
    const copy = scaleHQ(b1, 212, 52, 2, 2, 208, 48, 208, 48);
    expect(copy[0]).toBe(b1[2 * 212 + 2]); expect(copy[47 * 208 + 207]).toBe(b1[49 * 212 + 209]);
    const small = scaleHQ(b1, 212, 52, 2, 2, 208, 48, 95, 23);
    expect(small.every((p) => ((p >>> 16) & 255) <= p >>> 24 && ((p >>> 8) & 255) <= p >>> 24 && (p & 255) <= p >>> 24)).toBe(true);
    const img = eqImage(cells, 159, 39)!;
    expect(img.length).toBe(159 * 39);
    expect(img.some((p) => p >>> 24 === 0xff)).toBe(true);
  });
});

/** a frame's records (from byte o): the calls and every blob but 4-byte ones (the trace device's object addresses,
 *  which depend on what else the process created), so the digest is the port's own output only */
function digest(b: Uint8Array, o: number): string {
  const h = createHash('sha1'), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (o === 0) o = 8;
  while (o < b.length) {
    const id = dv.getUint32(o, true), n = dv.getUint32(o + 8, true);
    h.update(String(id));
    o += 12 + 4 * n;
    const nb = dv.getUint32(o, true); o += 4;
    for (let k = 0; k < nb; k++) { const l = dv.getUint32(o, true); o += 4; if (l !== 4) h.update(b.subarray(o, o + l)); o += l; }
  }
  return h.digest('hex').slice(0, 12);
}

function runTrace(frames: number): string[] {
  const gen = new InputGen(0xa11e);
  let f = 0, dev: TraceDevice | null = null, last = 0;
  const out: string[] = [];
  const eng = new AverettMp9({
    width: 320, height: 240,
    options: { clock: () => 100000 + f * 16, seed: 1058284800, device: (w, h) => (dev = new TraceDevice(w, h)) },
  });
  for (f = 0; f < frames; f++) {
    eng.render(gen.next());
    const b = dev ? (dev as TraceDevice).bytes() : new Uint8Array(0);
    out.push(digest(b, last));
    last = b.length;
  }
  return out;
}

describe('averett: Rhythm and Waves through the trace device', () => {
  it('names one preset and creates its device on frame 1, drawing from frame 2', () => {
    expect(AverettMp9.PRESET_NAMES).toEqual(['Rhythm and Waves']);
    const gen = new InputGen(1);
    let f = 0, dev: TraceDevice | null = null;
    const eng = new AverettMp9({ options: { clock: () => 100000 + f * 16, seed: 1, device: (w, h) => (dev = new TraceDevice(w, h)) } });
    eng.render(gen.next()); expect(dev).toBe(null);
    f = 1; eng.render(gen.next()); expect(dev).not.toBe(null);
    f = 2; eng.render(gen.next());
    expect(eng.debug().horizon).toBe(240);                 // the trace device draws nothing: no row is lit
  });
  it('golden: the port\'s own call stream per frame', () => {
    const got = runTrace(30);
    const p = join(dirname(fileURLToPath(import.meta.url)), 'golden/fixtures/averett-mp9.json');
    if (process.env.GOLDEN_UPDATE || !existsSync(p)) writeFileSync(p, JSON.stringify(got, null, 0) + '\n');
    const want = JSON.parse(readFileSync(p, 'utf8')) as string[];
    expect(got).toEqual(want);
  }, 300000);
});

describe('averett: Rhythm and Waves through the reference rasterizer, on our own art', () => {
  it('draws from frame 2 and answers the music: silence and a loud stream differ', () => {
    const run = (loud: boolean): Uint32Array => {
      const gen = new InputGen(7), quiet = gen.next();
      quiet.freq[0].fill(0); quiet.freq[1].fill(0); quiet.wave[0].fill(128); quiet.wave[1].fill(128);
      let f = 0, px = new Uint32Array(0);
      const eng = new AverettMp9({ width: 64, height: 48, options: { clock: () => 100000 + f * 16, seed: 1058284800 } });
      for (f = 0; f < 12; f++) { const s = eng.render(loud ? gen.next() : quiet); if (s) px = s.px.slice(); }
      return px;
    };
    const a = run(false), b = run(true);
    expect(a.length).toBe(64 * 48);
    expect(a.some((p) => p !== a[0])).toBe(true);
    expect(a.some((p, i) => p !== b[i])).toBe(true);
  }, 120000);
});
