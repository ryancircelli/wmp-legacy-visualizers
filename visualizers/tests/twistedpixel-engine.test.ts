// @vitest-environment node
// TwistedPixel's engine (audio, timing, preset schedule) against golden values of the port's own output, taken once
// it matched the DLL frame for frame in the private harness. The frames are synthetic (integer formulas, two silent
// stretches) so the test can rebuild them; they run at 320x240 with the clocks pinned to 100000 + 34 ms per frame and probe presets that set tp_fDuration / tp_nWaveMode /
// tp_nBeatDetectionSensitivity / mesh size from their position in the list (the `cfg` below).
import { describe, expect, it } from 'vitest';
import { A, type TimedLevel } from '../src/ns';
import '../src/rand';
import { Engine, type PresetCtx } from '../src/twistedpixel/engine';
import { PresetList } from '../src/twistedpixel/presets';

/** 333 preset files in directory order, as the plug-in ships (their names don't matter, only their places) */
const NAMES = Array.from({ length: 333 }, (_, i) => `p${String(i).padStart(3, '0')}.vbs`);
import { VARS, V } from '../src/twistedpixel/vars';
import { BANDS } from '../src/twistedpixel/audio';
import { pow87 } from '../src/twistedpixel/crt';
import { div24, ftol, mul24 } from '../src/twistedpixel/fpu';

const bits = (v: number): number => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v, true); return b.getUint32(0, true); };

function frame(f: number): TimedLevel {
  const silent = f < 3 || (f >= 150 && f < 153);
  const fl = new Uint8Array(1024), fr = new Uint8Array(1024), wl = new Uint8Array(1024), wr = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    fl[i] = silent ? 0 : (i * 7 + f * 13 + ((i * i) >> 5)) & 255;
    fr[i] = silent ? 0 : (i * 5 + f * 29 + ((i * f) >> 4)) & 255;
    for (const [c, w] of [[0, wl], [1, wr]] as const) {
      const t = (i * (3 + c + (f % 5)) + f * 37) & 255, tri = t < 128 ? t : 255 - t;
      w[i] = silent ? 128 : (Math.floor(((tri * 2 - 127) * ((f % 9) + 1)) / 9) + 128) & 255;
    }
  }
  return { freq: [fl, fr], wave: [wl, wr], state: 2, timeStamp: f * 166667 };
}

/** the probe presets: what each one's PresetInitialize sets, by its index in NAMES */
function cfg(k: number) {
  const dur = k % 4 === 0 ? 0 : k % 97 === 50 ? -1 : 0.5 + (k % 3) * 0.25;
  const wm = k % 5 === 1 ? 9 : k % 11 === 3 ? -1 : k % 13 === 7 ? -2 : k % 8;
  return { dur, wm, sens: [192, 62, 30, 100, 0][k % 5]!, mesh: k % 17 === 5 };
}
class Probe implements PresetCtx {
  vars = Float32Array.from(VARS, (d) => d.def);
  saved = new Float32Array(VARS.length);
  active = false; nextPreset = ''; time = 0; waveColor = 0;
  load(name: string): boolean {
    const v = this.vars, c = cfg(NAMES.indexOf(name));
    v.set(VARS.map((d) => d.def));
    v[V.fDuration] = c.dur; v[V.nWaveMode] = c.wm; v[V.nBeatDetectionSensitivity] = c.sens;
    if (c.mesh) { v[V.meshx] = 16; v[V.meshy] = 12; }
    this.saved.set(v);
    return true;
  }
  resetFrame(): void { VARS.forEach((d, i) => { if (d.kind & 3) this.vars[i] = this.saved[i]!; }); }
  perFrame(): void {}
}

// host frame -> [rand state, tp_fps, tp_time, switch tick, fading, w1, w2, spectrum means L/R, smoothed mono[100],
// specL[5], specR[300], scaledL[10]] after the frame (floats as bits)
const DUMP: [number, number[]][] = [
  [0, [0xa3c298ff, 0x41f00000, 0, 0x18a88, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [2, [0xa3c298ff, 0x41f00000, 0, 0x18a88, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [3, [0xa3c298ff, 0x41f00000, 0x3d088889, 0x18a88, 0, 0, 0, 0x47, 0x6d, 0xbdd80000, 0x392396ff, 0x3cbbe1ba, 1]],
  [4, [0xa3c298ff, 0x41efffff, 0x3d888889, 0x18a88, 0, 0, 0, 0x54, 0x8b, 0xbca00000, 0x381a63db, 0x3a262679, 4]],
  [60, [0x907f8fc6, 0x41eb6094, 0x3ffbb9b7, 0x19a0b, 1, 0x3f3de910, 0x3e842de0, 0x2c, 0x8c, 0xbe480000, 0x3a3007d7, 0x3a21b4d3, 3]],
  [149, [0x907f8fc6, 0x41eb4c2f, 0x409fbe92, 0x19d14, 0, 0x3ae83880, 0x3f7f8be4, 0xb1, 0x6d, 0x3d400000, 0x3abbbdd1, 0x3a1ea5be, 6]],
  [150, [0x907f8fc6, 0x41eb4c2f, 0x409fbe92, 0x19d14, 0, 0x3ae83880, 0x3f7f8be4, 0xb1, 0x6d, 0x3d400000, 0x3abbbdd1, 0x3a1ea5be, 6]],
  [152, [0x907f8fc6, 0x41eb4c2f, 0x409fbe92, 0x19d14, 0, 0x3ae83880, 0x3f7f8be4, 0xb1, 0x6d, 0x3d400000, 0x3abbbdd1, 0x3a1ea5be, 6]],
  [153, [0x907f8fc6, 0x41e8d12b, 0x40a0d518, 0x19d14, 0, 0x3ae83880, 0x3f7f8be4, 0xcb, 0x96, 0x3d000000, 0x391d4ace, 0x3d2ff416, 0]],
  [154, [0x907f8fc6, 0x41e6a8b4, 0x40a1ee96, 0x19d14, 0, 0x3ae83880, 0x3f7f8be4, 0xa5, 0xb3, 0x3d700000, 0x3979f8b9, 0x399202e2, 0]],
  [200, [0xe02a8771, 0x41e9263e, 0x40d70e6d, 0x1b525, 1, 0x3f55655f, 0x3e2a6a84, 0x48, 0x90, 0x3d980000, 0x3af5d1a0, 0x38d03212, 1]],
  [250, [0xe02a8771, 0x41eb4aba, 0x4106c433, 0x1b525, 1, 0x3f0e63a9, 0x3ee338ae, 0xd2, 0x94, 0x3e680000, 0x3a2081e2, 0x3a063f08, -2]],
  [299, [0xe02a8771, 0x41eb4a9a, 0x41216c37, 0x1b525, 1, 0x3e919b01, 0x3f373280, 0x4f, 0x7c, 0x3db00000, 0x3a80e45f, 0x39e91b95, 0]],
];
// tp_frame -> what the current preset's ProcessPerFrame read: tp_time, tp_fps, tp_progress, bass, mid, treb,
// bass_att, mid_att, treb_att, volume, bBeatDetected (bits)
const LOG: [number, number[]][] = [
  [1, [0x3d888889, 0x41efffff, 0x3e0b4394, 0x3e2492c1, 0x3fc2e803, 0x3f32da33, 0x3f19da8f, 0x3fa50e1c, 0x3f53bc15, 0x3f4b44f8, 0x3edf0000]],
  [2, [0x3dccccce, 0x41ef0cab, 0x3e2e147c, 0x404bc4cb, 0x3ef0663f, 0x3eda81a1, 0x3ffb8906, 0x3f880c92, 0x3f376990, 0x3fae1686, 0x3f048000]],
  [50, [0x3fdd45e8, 0x41eb63ad, 0xc00ad0e5, 0x3e30ef3c, 0x4015506b, 0x3f8d233e, 0x3f4afc4d, 0x4006552f, 0x3f628832, 0x3f99f5ff, 0x3ef60000]],
  [120, [0x40837584, 0x41eb5552, 0x3e581064, 0x3e2b3064, 0x3feaec72, 0x3f6036d3, 0x3f2b5d7d, 0x3fce4524, 0x3f2d4a67, 0x3f759e9b, 0x3eb90000]],
  [146, [0x409fbe92, 0x41eb4c2f, 0x3db9af70, 0x3e33e360, 0x3feb27b6, 0x3f6c62ed, 0x3f192dc6, 0x3fc2c91b, 0x3f685e00, 0x3f7a8e66, 0x3f0f0000]],
  [147, [0x40a0d518, 0x41e8d12b, 0x3e8b4396, 0x3e1b9ede, 0x3e909309, 0x3e1dbe49, 0x3ef2211e, 0x3f9633e4, 0x3f3225e5, 0x3e48d668, 0x3f308000]],
  [148, [0x40a1ee96, 0x41e6a8b4, 0x3ea27984, 0x3e281dab, 0x3f1e9eee, 0x3eab9f80, 0x3ec54edb, 0x3f8219e2, 0x3f17f746, 0x3ebef966, 0x3f2c0000]],
  [200, [0x40dda0bb, 0x41ea5d4a, 0xc0b147ae, 0x3e5365eb, 0x4002bebd, 0x3f0e5260, 0x3fe989f3, 0x3fe2c7c8, 0x3f30edc8, 0x3f6f6246, 0x3f1e0000]],
  [250, [0x410a07cb, 0x41eb4ae4, 0xc0517e4c, 0x3e394258, 0x3f8f9f3d, 0x3e9bc9d0, 0x3f9203e3, 0x3f804ef8, 0x3ec9d92c, 0x3f0926a8, 0x3e7c0000]],
  [290, [0x411fca6b, 0x41eb4a9a, 0xbfbae148, 0x3e53678f, 0x400256d5, 0x3f08f318, 0x3fe96ad9, 0x3fe2412c, 0x3f30916d, 0x3f6d0d70, 0x3eb30000]],
];

describe('TwistedPixel engine', () => {
  it('deals the presets in order (srand 100000, the VC6 shuffle over the NTFS-ordered names)', () => {
    A.srand(100000);
    const l = new PresetList(NAMES);
    const got = [NAMES.indexOf(l.current)];
    for (let i = 0; i < 8; i++) got.push(NAMES.indexOf(l.next()));
    expect(got).toEqual([59, 79, 30, 1, 316, 261, 164, 87, 73]);
  });

  it('has the band edges the CRT pow gives at 24-bit precision', () => {
    expect([0, 1, 2, 3].map((k) => ftol(mul24(pow87(div24(k, 3), Math.fround(2.1)), 256)))).toEqual(BANDS);
  });

  it('keeps its golden values frame by frame on synthetic sound with silent stretches', () => {
    let ms = 100000;
    const clock = { tick: () => ms >>> 0, qpc: () => ms * 1000, qpf: 1e6 };
    const noop = (): void => {};
    const loads: number[] = [];
    const eng = new Engine({
      width: 320, height: 240, clock, names: [...NAMES], source: () => '',
      makeCtx: () => { const p = new Probe(); const l = p.load.bind(p); p.load = (n) => { loads.push(NAMES.indexOf(n)); return l(n); }; return p; },
      waves: { setNextMode: (v, r) => { if (v !== -1 && (v < 0 || v > 7)) r(); }, commitMode: noop, update: noop },
      canvas: { mesh: { count: 0 } as never, message: noop, rebuildMesh: noop, clearInfo: noop },
      render: noop,
    });
    const dump = new Map(DUMP), log = new Map(LOG);
    const gotDump: [number, number[]][] = [], gotLog: [number, number[]][] = [];
    for (let f = 0; f < 300; f++) {
      ms = 100000 + f * 34;
      if (eng.render(frame(f)) && log.has(eng.frame - 1)) {
        const v = eng.cur.vars;
        gotLog.push([eng.frame - 1, [V.time, V.fps, V.progress, V.bass, V.mid, V.treb, V.bass_att, V.mid_att, V.treb_att,
          V.volume, V.bBeatDetected].map((i) => bits(v[i]!))]);
      }
      if (dump.has(f)) {
        const a = eng.audio;
        gotDump.push([f, [A.randSeed() >>> 0, bits(eng.fps), bits(eng.time), eng.target >>> 0, eng.fading ? 1 : 0, bits(eng.w1),
          bits(eng.w2), a.avgL, a.avgR, bits(a.waveMono[100]!), bits(a.specL[5]!), bits(a.specR[300]!), a.scaledL[10]!]]);
      }
    }
    expect(loads).toEqual([59, 79, 30]);
    expect(gotDump).toEqual(DUMP);
    expect(gotLog).toEqual(LOG);
  });
});
