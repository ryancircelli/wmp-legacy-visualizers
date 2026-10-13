// Plus! 3-D Visualizations (src/plus3d): the port's own output on its own art (./art.ts). Each preset's call stream
// is checked through TraceDevice (the D3T1 records the private harness compares with the DLL's): it sets up after
// the splash frame, draws every frame after, is deterministic, and answers the sound (a silent stream against a
// loud one); the character preset switches series (a matrix-animation blend) on its seven-second timer.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { A } from '../src/ns';
import '../src/rand';
import { TraceDevice } from '../src/d3d8/trace';
import { PlusVis, type Preset } from '../src/plus3d/scene';
import { Munch } from '../src/plus3d/munch';
import { Blobby } from '../src/plus3d/blobby';
import { Jelly } from '../src/plus3d/jelly';
import { makePlus3DArt } from '../src/plus3d/art';
import type { Device } from '../src/d3d8/api';

interface Rec { id: number; args: number[]; blobs: Uint8Array[] }
function records(b: Uint8Array): Rec[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Rec[] = [];
  let o = 8;
  while (o < b.length) {
    const id = dv.getUint32(o, true), n = dv.getUint32(o + 8, true); o += 12;
    const args = Array.from({ length: n }, (_, i) => dv.getUint32(o + i * 4, true)); o += n * 4;
    const nb = dv.getUint32(o, true); o += 4;
    const blobs: Uint8Array[] = [];
    for (let i = 0; i < nb; i++) { const len = dv.getUint32(o, true); o += 4; blobs.push(b.slice(o, o + len)); o += len; }
    out.push({ id, args, blobs });
  }
  return out;
}
function frame(rs: Rec[], f: number): Rec[] {
  const a = rs.findIndex((r) => r.id === 0xf000 && r.args[0] === f), b = rs.findIndex((r) => r.id === 0xf100 && r.args[0] === f);
  return rs.slice(a + 1, b);
}

const art = makePlus3DArt();
const PRESETS: [string, (d: Device) => Preset][] = [
  ['Munch', (d) => new Munch(d, art)], ['Maxx\'s Kingdom', (d) => new Blobby(d, art)], ['Undersea Wonders', (d) => new Jelly(d, art)],
];
function level(loud: number, f: number) {
  const fr = new Uint8Array(1024), fr2 = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const v = loud * (220 - i * 0.2) * (0.5 + 0.5 * Math.sin(f * 0.9 + i * 0.03));
    fr[i] = Math.max(0, Math.min(255, Math.round(v))); fr2[i] = fr[(i + 5) % 1024]!;
  }
  return { freq: [fr, fr2] as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>],
    wave: [new Uint8Array(1024).fill(128), new Uint8Array(1024).fill(128)] as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>],
    state: 2, timeStamp: f * 166667 };
}
/** n frames, step ms apart, recording only the frames in keep */
function run(make: (d: Device) => Preset, n: number, loud: number, step = 33, keep = (f: number) => f < 8): Rec[] {
  A.randSeed(1);
  const dev = new TraceDevice(320, 240, 0x46), rec0 = dev.rec.bind(dev);
  let f = 0;
  dev.rec = (id, self, args, blobs, result) => { if (keep(f)) rec0(id, self, args, blobs, result); };
  const p = make(dev);
  p.time = () => 1058270400;
  const vis = new PlusVis(p, () => (100000 + f * step) * 1000);
  for (f = 0; f < n; f++) {
    if (keep(f)) dev.frameStart(f);
    vis.render(level(loud, f), 320, 240);
    if (keep(f)) dev.frameEnd(f);
  }
  return records(dev.bytes());
}
const count = (rs: Rec[], slot: number): number => rs.filter((r) => r.id === slot).length;
// what the calls carry (states, constants, draws, every lock's bytes), not object addresses
const KEEP = new Set([50, 63, 71, 79, 1 << 8 | 17, 2 << 8 | 10, 3 << 8 | 12, 4 << 8 | 12]);
const digest = (rs: Rec[]): string => createHash('sha1').update(JSON.stringify(rs.filter((r) => KEEP.has(r.id))
  .map((r) => [r.id, r.args.slice(1), r.blobs.map((x) => createHash('sha1').update(x).digest('hex'))]))).digest('hex');

// generous timeouts: each run draws nothing but builds the scenes and walks hundreds of frames
describe('Plus! 3-D Visualizations', { timeout: 60_000 }, () => {
  for (const [name, make] of PRESETS) {
    describe(name, () => {
      const loud = run(make, 8, 1), quiet = run(make, 8, 0);
      it('shows the splash first, sets up on the second call, then draws and presents every frame', () => {
        expect(frame(loud, 0).length).toBe(0);
        expect(count(frame(loud, 1), 75)).toBeGreaterThanOrEqual(2);              // the vertex shaders
        for (const f of [2, 5, 7]) {
          expect(count(frame(loud, f), 15)).toBe(1);
          expect(count(frame(loud, f), 71)).toBeGreaterThan(6);                  // the sky box's six faces and the models
        }
      });
      it('is deterministic', () => { expect(digest(run(make, 6, 1))).toBe(digest(run(make, 6, 1))); });
      it('answers the sound: the light colour (c21) follows the spectrum', () => {
        const c21 = (rs: Rec[], f: number): number[] => Array.from(new Float32Array(frame(rs, f).find((r) => r.id === 79 && r.args[1] === 21)!.blobs[0]!.buffer));
        expect(c21(loud, 6)).not.toEqual(c21(quiet, 6));
      });
    });
  }

  it('Munch switches dance series on its timer, blending out of the frozen pose without a jump', () => {
    // 33 ms frames: the first switch comes after 7 s (frame ~212); record around it
    const rs = run(PRESETS[0]![1], 230, 1, 33, (f) => f >= 200);
    const worlds = (f: number) => frame(rs, f).filter((r) => r.id === 79 && r.args[1] === 51).map((r) => Array.from(new Float32Array(r.blobs[0]!.buffer)));
    let moved = 0;
    for (let f = 201; f < 230; f++) {
      const a = worlds(f - 1)[0]!, b = worlds(f)[0]!;
      const d = Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
      expect(d).toBeLessThan(0.5);                                          // no frame jumps
      if (d > 0) moved++;
    }
    expect(moved).toBeGreaterThan(20);
  });
});
