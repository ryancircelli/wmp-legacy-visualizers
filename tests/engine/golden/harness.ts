// Golden guard for the engine's exact output (docs/EXACTNESS.md): renders every visualizer on a
// deterministic synthetic TimedLevel stream and folds, per block of BLOCK frames, a hash of every
// frame's pixels + its rand() count (+ Battery's 8-bit FRONT and whole palette state). The fixtures
// in ./fixtures were generated from the engine as verified byte-exact against the DLLs, so any
// mismatch means an output byte, a rand() draw or a palette entry moved.
// No vitest/node imports here, so a bench script can bundle it; the vitest glue is ./suite.ts.
import { A, type Surface, type TimedLevel } from '../../../src/engine/ns';
import '../../../src/engine/rand';
import '../../../src/engine/effect';
import '../../../src/engine/kernels';
import '../../../src/engine/shift';
import '../../../src/engine/draw';
import '../../../src/engine/alchemy';
import '../../../src/engine/bars';
import '../../../src/engine/battery/index';

export const BLOCK = 100;

// ---- rand() counting: the modules call A.rand() late-bound (ns.ts), so a wrapper sees every draw.
let randN = 0;
const realRand = A.rand;
A.rand = function () { randN++; return realRand(); };

// ---- deterministic input: seeded sections of silence / quiet noise / beats / sweeps / tones /
// loud bursts followed by sudden silence. Only integer ops and IEEE + - * /, so it is the same on
// every JS engine (no Math.sin/exp/log here).
function mulberry32(a: number): () => number {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
// Parabolic sine on a phase in [0,1): exact arithmetic only.
function psin(ph: number): number {
  ph -= Math.floor(ph);
  const x = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;   // triangle -1..1
  return x * (2 - Math.abs(x));
}
const clampB = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export class InputGen {
  readonly level: TimedLevel;
  private r: () => number;
  private kind = 0;
  private left = 0;
  private t = 0;
  private frame = 0;
  private stamp = 0;
  private period = 30;
  private kick = 0;
  private pos = 2;
  private tones: [number, number, number] = [0.01, 0.02, 0.03];
  constructor(seed = 0x5eed) {
    this.r = mulberry32(seed);
    const mk = () => new Uint8Array(1024);
    this.level = { freq: [mk(), mk()], wave: [mk(), mk()], state: 2, timeStamp: 0 };
  }
  private rnd(n: number): number { return this.r() % n; }
  private pick(): void {
    if (this.kind === 4) { this.kind = 5; this.left = 5 + this.rnd(40); }   // loud -> sudden silence
    else {
      this.kind = [0, 1, 2, 2, 3, 4, 6, 7][this.rnd(8)]!;
      const [base, span] = ([[30, 210], [60, 340], [120, 480], [120, 380], [20, 100], [0, 1], [100, 300], [60, 240]] as const)[this.kind]!;
      this.left = base + this.rnd(span);
    }
    this.t = 0;
    this.period = 18 + this.rnd(23);
    this.pos = 2 + this.rnd(8);
    this.tones = [(1 + this.rnd(60)) / 1024, (1 + this.rnd(120)) / 1024, (1 + this.rnd(250)) / 1024];
  }
  next(): TimedLevel {
    if (this.left <= 0) this.pick();
    this.left--;
    const L = this.level, [f0, f1] = L.freq, [w0, w1] = L.wave, t = this.t++;
    let i: number;
    switch (this.kind) {
      case 0: case 5:                                  // digital silence
        f0.fill(0); f1.fill(0); w0.fill(128); w1.fill(128);
        break;
      case 1:                                          // quiet noise
        for (i = 0; i < 1024; i++) {
          const top = 40 - (i >> 5);
          f0[i] = top > 0 ? this.rnd(top) : 0; f1[i] = top > 0 ? this.rnd(top) : 0;
          w0[i] = 122 + this.rnd(13); w1[i] = 122 + this.rnd(13);
        }
        break;
      case 2: case 6: {                                // kick + hat beat (6: fast and louder)
        const per = this.kind === 6 ? (this.period >> 1) + 4 : this.period;
        if (t % per === 0) this.kick = this.kind === 6 ? 255 : 200 + this.rnd(56);
        else this.kick = (this.kick * 0.72) | 0;
        const hat = t % per === (per >> 1) ? 120 + this.rnd(100) : 0;
        for (i = 0; i < 1024; i++) {
          const b = i < 14 ? this.kick - i * 6 : i > 600 && hat ? hat - ((i - 600) >> 3) : this.rnd(12);
          f0[i] = clampB(b + this.rnd(6)); f1[i] = clampB(b + this.rnd(6));
          const s = psin(i * (this.pos / 256) + t * 0.1) * (this.kick >> 1);
          w0[i] = clampB(128 + s + this.rnd(5) - 2); w1[i] = clampB(128 - s + this.rnd(5) - 2);
        }
        break;
      }
      case 3: {                                        // log sweep: a peak walking up the bins
        this.pos = this.pos * 1.012 + 0.05;
        if (this.pos > 1000) this.pos = 2;
        const p = this.pos;
        for (i = 0; i < 1024; i++) {
          const d = (i - p) / (4 + p * 0.05);
          const v = 255 - d * d * 40;
          f0[i] = clampB(v + this.rnd(8)); f1[i] = clampB(v * 0.8 + this.rnd(8));
          const s = psin(i * (p / 2048)) * 100;
          w0[i] = clampB(128 + s); w1[i] = clampB(128 + s * 0.6);
        }
        break;
      }
      case 4:                                          // loud burst, full-scale noise
        for (i = 0; i < 1024; i++) {
          const top = 255 - (i >> 3);
          f0[i] = top - this.rnd(80); f1[i] = top - this.rnd(80);
          w0[i] = this.rnd(256); w1[i] = this.rnd(256);
        }
        break;
      default: {                                       // 7: sustained chord
        const [a, b, c] = this.tones;
        for (i = 0; i < 1024; i++) {
          f0[i] = f1[i] = 0;
          w0[i] = clampB(128 + (psin(i * a + t * 0.03) * 50 + psin(i * b) * 30 + psin(i * c + t * 0.01) * 20));
          w1[i] = clampB(128 + (psin(i * a) * 40 + psin(i * c) * 40));
        }
        for (const tn of this.tones) {
          const bin = (tn * 1024 * 4) | 0;
          for (i = -3; i <= 3; i++) if (bin + i >= 0 && bin + i < 1024) {
            f0[bin + i] = 230 - Math.abs(i) * 30 - this.rnd(10); f1[bin + i] = 220 - Math.abs(i) * 30;
          }
        }
      }
    }
    // advancing timeStamp (100 ns units at 60 fps); 1 frame in 64 repeats it (Bars' skip frame)
    if (this.frame++ % 64 !== 63) this.stamp += 166667;
    L.timeStamp = this.stamp;
    L.state = 2;
    return L;
  }
}

// ---- hashing: murmur3-style word mixing (fast enough to hash every frame of every run).
function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
  h ^= k; h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}
function hash32(a: Uint32Array, h: number): number {
  for (let i = 0; i < a.length; i++) {
    let k = Math.imul(a[i]!, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return mix(h, a.length);
}
function hash8(b: Uint8Array, h: number): number {
  const n4 = b.length >> 2;
  if (b.byteOffset % 4 === 0) h = hash32(new Uint32Array(b.buffer, b.byteOffset, n4), h);
  else for (let i = 0; i < n4 * 4; i++) h = mix(h, b[i]!);
  for (let i = n4 * 4; i < b.length; i++) h = mix(h, b[i]!);
  return mix(h, b.length);
}

// ---- runs
export type Vis = 'alchemy' | 'bars' | 'battery';
export interface Run {
  id: string;
  vis: Vis;
  w: number;
  h: number;
  frames: number;        // full run
  short: number;         // the prefix `npm test` checks (a multiple of BLOCK)
  seed?: number;         // Alchemy / Battery pinned clock
  preset?: number;       // Bars / Battery
  intended?: boolean;    // Alchemy options.intended
}

const BATTERY_SHORT = new Set([0, 1, 5, 7, 20]);
export const RUNS: Run[] = [
  { id: 'alchemy-640x480-s1700000000', vis: 'alchemy', w: 640, h: 480, frames: 6000, short: 300, seed: 1700000000 },
  { id: 'alchemy-640x480-s1234567890', vis: 'alchemy', w: 640, h: 480, frames: 6000, short: 0, seed: 1234567890 },
  { id: 'alchemy-640x480-s1555000777', vis: 'alchemy', w: 640, h: 480, frames: 6000, short: 0, seed: 1555000777 },
  { id: 'alchemy-800x450-s42', vis: 'alchemy', w: 800, h: 450, frames: 2000, short: 100, seed: 42 },
  { id: 'alchemy-intended-360x640-s7', vis: 'alchemy', w: 360, h: 640, frames: 2000, short: 100, seed: 7, intended: true },
  // odd interior row counts (the blur pairs rows), odd widths
  { id: 'alchemy-640x479-s99', vis: 'alchemy', w: 640, h: 479, frames: 1000, short: 100, seed: 99 },
  { id: 'alchemy-intended-333x251-s5', vis: 'alchemy', w: 333, h: 251, frames: 1000, short: 0, seed: 5, intended: true },
  // retail portrait: the transition ramps are 2*W long and indexed by a row delta too, so they are
  // read past their end (spec 01 s2.5); and a retail size whose pixel count is not a multiple of 4,
  // where ShiftMoveBits only swaps the two surfaces
  { id: 'alchemy-360x640-s11', vis: 'alchemy', w: 360, h: 640, frames: 1500, short: 0, seed: 11 },
  { id: 'alchemy-642x481-s13', vis: 'alchemy', w: 642, h: 481, frames: 500, short: 0, seed: 13 },
  ...[0, 1, 2, 3].flatMap((p): Run[] => [
    { id: `bars-p${p}-354x345`, vis: 'bars', w: 354, h: 345, frames: 3000, short: 300, preset: p },
    { id: `bars-p${p}-1100x200`, vis: 'bars', w: 1100, h: 200, frames: 1500, short: 100, preset: p },
  ]),
  { id: 'battery-p0-384x288-s1700000000', vis: 'battery', w: 384, h: 288, frames: 6000, short: 300, seed: 1700000000, preset: 0 },
  { id: 'battery-p0-384x288-s1234567890', vis: 'battery', w: 384, h: 288, frames: 4000, short: 0, seed: 1234567890, preset: 0 },
  // the other two DLL resolutions, and a width that is not a multiple of 4
  { id: 'battery-p0-512x384-s1700000000', vis: 'battery', w: 512, h: 384, frames: 1000, short: 0, seed: 1700000000, preset: 0 },
  { id: 'battery-p7-256x192-s1700000000', vis: 'battery', w: 256, h: 192, frames: 1000, short: 0, seed: 1700000000, preset: 7 },
  { id: 'battery-p0-382x287-s1700000000', vis: 'battery', w: 382, h: 287, frames: 1000, short: 100, seed: 1700000000, preset: 0 },
  ...Array.from({ length: 25 }, (_, i): Run => ({
    id: `battery-p${i + 1}-384x288-s1700000000`, vis: 'battery', w: 384, h: 288, frames: 1500,
    short: BATTERY_SHORT.has(i + 1) ? 200 : 0, seed: 1700000000, preset: i + 1,
  })),
];

/** The WebAssembly kernels' path (A.moveBitsMode for Alchemy's gather + blur, A.batteryKernel for
 * Battery's blur/palette, A.barsKernel for Bars' drawing, A.trigMode for sin/cos/atan2): forced WASM,
 * forced JS, or flipping every 37 frames. */
export type MoveBitsPath = 'wasm' | 'js' | 'alternate';

function setPath(path: MoveBitsPath | undefined, f: number): void {
  if (!path) return;
  A.moveBitsMode = A.batteryKernel = A.barsKernel = A.trigMode = path === 'alternate' ? (((f / 37) | 0) % 2 ? 'js' : 'wasm') : path;
}

interface Renderer { render(L: TimedLevel): Surface | null; frameHash(s: Surface | null): number; }

function withClock<T>(seed: number, f: () => T): T {
  const now = Date.now;
  Date.now = () => seed * 1000;
  try { return f(); } finally { Date.now = now; }
}

function makeRenderer(run: Run): Renderer {
  A.srand(1);                                          // the CRT's start-of-process state
  if (run.vis === 'alchemy') {
    const e = withClock(run.seed!, () => new A.Engine({ width: run.w, height: run.h, options: { intended: !!run.intended } }));
    e.seed(run.seed!);
    return {
      render: (L) => e.render(L),
      frameHash: (s) => {
        let h = s ? hash32(s.px, 0x9747b28c) : 0;
        if (s !== e.A) h = hash32(e.A.px, h);
        return h;
      },
    };
  }
  if (run.vis === 'bars') {
    const e = new A.Bars({ width: run.w, height: run.h, preset: run.preset });
    return { render: (L) => e.render(L), frameHash: (s) => (s ? hash32(s.px, 0x9747b28c) : 0) };
  }
  const e = withClock(run.seed!, () => new A.Battery({ width: run.w, height: run.h, options: {} }));
  e.setPreset(run.preset!);
  return {
    render: (L) => e.render(L),
    frameHash: (s) => {
      let h = s ? hash32(s.px, 0x9747b28c) : 0;
      h = hash8(e.front, h);
      h = hash8(e.FROM, h); h = hash8(e.LIVE, h); h = hash8(e.TO, h);
      h = hash32(e.LIVE32, h);
      for (const v of [e.palettePaused, e.paletteAutoCycle, e.paletteChangeCountdown, e.paletteChangeRequested,
        e.paletteFading, e.paletteDirty, e.paletteFadeLen, e.paletteFadeCtr]) h = mix(h, +v);
      return h;
    },
  };
}

/** One entry per BLOCK frames: "<hash of the block's frame hashes + rand counts>:<rand() draws in the block>". */
export function runGolden(run: Run, frames: number, path?: MoveBitsPath): string[] {
  const gen = new InputGen();
  setPath(path, 0);                                    // Battery and Bars place their buffers at construction
  const r = makeRenderer(run);
  const out: string[] = [];
  let bh = 0, br = 0;
  for (let f = 0; f < frames; f++) {
    setPath(path, f);
    const L = gen.next();
    const r0 = randN;
    const s = r.render(L);
    const n = randN - r0;
    bh = mix(mix(bh, r.frameHash(s)), n);
    br += n;
    if ((f + 1) % BLOCK === 0 || f + 1 === frames) {
      out.push((bh >>> 0).toString(16).padStart(8, '0') + ':' + br);
      bh = 0; br = 0;
    }
  }
  A.moveBitsMode = A.batteryKernel = A.barsKernel = A.trigMode = 'auto';
  return out;
}

/** Describes the first diverging block, or null when `got` is a prefix-exact match of `want`. */
export function firstDivergence(run: Run, got: string[], want: string[] | undefined): string | null {
  if (!want) return `${run.id}: no fixture entry (run GOLDEN_UPDATE=1 npm run test:golden from a known-exact engine)`;
  for (let b = 0; b < got.length; b++) {
    if (got[b] !== want[b]) {
      const [gh, gr] = (got[b] ?? '').split(':'), [wh, wr] = (want[b] ?? '').split(':');
      return `${run.id}: frames ${b * BLOCK}..${Math.min((b + 1) * BLOCK, run.frames) - 1} (block ${b}) diverged — ` +
        (gr !== wr ? `rand() draws ${gr} vs ${wr}` : `hash ${gh} vs ${wh} (same rand() count)`);
    }
  }
  return null;
}
