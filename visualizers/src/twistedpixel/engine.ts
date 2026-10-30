// TwistedPixel's engine (0x10011a40) and its frame (0x10001e00 -> 0x10012d60): audio, preset scheduling and
// cross-fades, the fps estimate and tp_time, in the DLL's order. The preset contexts (ctx.ts), the waves, the canvas
// and the frame's drawing are reached through the interfaces below. Only the windowed Direct3D path is modelled
// (Enable D3D = 1, the default).
//
// One frame, every side effect in order (after sample() found sound; a silent frame does none of it):
//   audio.process(cur.vars)                           bass..volume, bBeatDetected into cur only (next keeps 1.0s)
//   if tick > target (unsigned):
//     not fading: [load next: list.next() (reshuffle rands at the wrap), next.load (PresetTerminate,
//                 PresetInitialize), waves.setNextMode (one rand if the mode is not -1 / 0..7)]
//                 fading = 1; fadeLen = rand() * 3500 / 32767 + 3500; target = tick + fadeLen
//     fading:     fading = 0; swap (waves.commitMode into the outgoing context, contexts swapped, mesh defaults /
//                 rebuild, mesh fade, duration: fDuration * 1000, 120000 for -1, else rand() * 5000 / 32767 + 10000;
//                 target = tick + duration)
//   if fading: weights w1 = (target - tick) / fadeLen, w2 = 1 - w1 (clamped)
//   cur.resetFrame(); if fading and cur active: next.resetFrame()
//   timing (fps estimate, tp_time += 1 / old fps)
//   cur.time = tp_time; tp_time (each context's own) / tp_fps / tp_frame / tp_progress into cur, and next if fading
//   cur.perFrame(next | null, eng)    (ProcessPerFrame, next's, the blend, the warp)
//   waves.update(...); parts.render(eng) (the scene); frame counter += 1
import { A, type TimedLevel } from '../ns';
import '../rand';
import { add24, sub24, mul24, div24, ftol } from './fpu';
import { V } from './vars';
import { Audio } from './audio';
import { PresetList } from './presets';
import type { Mesh } from './canvas';

const f = Math.fround;
const F_0001 = f(0.001);          // tp_progress when there is no schedule to measure (0x3a83126f)
const DT_DEFAULT = f(1 / 30);     // 0x3d088889

/** One preset's script context (0x1000ee90): ctx.ts's PresetContext. */
export interface PresetCtx {
  /** the 112 vars (vars.ts order) */
  vars: Float32Array;
  /** +0x22c: 1 for the current preset, 0 for the incoming one; set by the engine at each swap */
  active: boolean;
  /** tp_NextPreset (+0x1e4; 0x10025650 writes eng.cur's): a file name in the presets folder, '' for the list */
  nextPreset: string;
  /** +0x230: tp_time as of the last frame this context was the current one (0 before that). The engine sets it
   *  for the current context only, so an incoming preset sees a stale tp_time. */
  time: number;
  /** +0x224: the wave colour the waves' update takes */
  waveColor: number;
  /** 0x1000f140: compile the file `name` (`source`: its text, null if unreadable), reset every var to its default,
   *  run PresetInitialize, keep the post-init values. */
  load(name: string, source: string | null): boolean;
  /** 0x10026780: put the kind-1/3 vars back to their post-PresetInitialize values (before ProcessPerFrame) */
  resetFrame(): void;
  /** 0x1000f780 after its first four stores (the engine's globals()): ProcessPerFrame, then (next given: fading)
   *  next's ProcessPerFrame and the blend with eng.w1/w2, then the per-vertex pass (0x1000f330). */
  perFrame(next: PresetCtx | null, eng: Engine): void;
}

/** What the engine needs of the waveform object (0x10017a40): waves.ts's Waves. */
export interface Waves {
  /** 0x10017ba0 at load, with ftol of the incoming tp_nWaveMode */
  setNextMode(v: number, rand: () => number): void;
  /** 0x10017b80 at swap, with the outgoing context's vars */
  commitMode(cur: Float32Array): void;
  /** vtable +8 after the presets' frame code */
  update(cur: Float32Array, color: number, time: number, transition: boolean, w7c: number, w78: number): void;
}

/** What the engine needs of the canvas (0x10018b50): canvas.ts's Canvas. */
export interface Canvas {
  readonly mesh: Mesh;
  /** vtable +0x1c: the "Failed to load next Preset..." text */
  message(text: string): void;
  /** 0x10013910, when a swapped-in preset's tp_meshx/tp_meshy differ from the mesh's */
  rebuildMesh(w: number, h: number): void;
  /** 0x10014540's first lines: the script error / DebugOut text and both its flags go */
  clearInfo(): void;
}

/** The DLL's three clocks, all pinned to one millisecond count in the harness. */
export interface Clock {
  /** GetTickCount (uint32 ms) */
  tick(): number;
  /** QueryPerformanceCounter */
  qpc(): number;
  /** QueryPerformanceFrequency (nonzero) */
  qpf: number;
}

/** TwistedPixel.ini values that change output (0x10015fd0 -> 0x10012bb0/0x10012cc0; mesh 0x1000de10). */
export interface Settings {
  meshSize: number;            // MeshSize = 24
  desiredFps: number;          // DesiredFPS = 30
  disablePresetFps: boolean;   // Disable Preset FPS = 0
  useBeatDetection: boolean;   // UseBeatDetection = 1
}
export const DEFAULT_SETTINGS: Settings = { meshSize: 24, desiredFps: 30, disablePresetFps: false, useBeatDetection: true };

/** 0x1000de10 / 0x1000de80: MeshSize -> the mesh's columns x rows */
export function meshDims(size: number): [number, number] {
  switch (size) {
    case 9: return [8, 6];
    case 16: return [16, 12];
    case 32: return [32, 24];
    case 40: return [40, 30];
    case 48: return [48, 36];
    case 64: return [64, 48];
    case 96: return [96, 72];
    default: return [24, 18];
  }
}

/** 0x10013890 with TextureSize = -1: 512, or 256 / 128 when the window is smaller */
export function textureDims(w: number, h: number): [number, number] {
  const p = (v: number) => (v < 128 ? 128 : v < 256 ? 256 : 512);
  return [p(w), p(h)];
}

export interface EngineParts {
  width: number;
  height: number;
  clock: Clock;
  names: string[];                       // presets.ts NAMES, or any list in FindFirstFile order
  source(name: string): string | null;   // the preset file's text (null: unreadable)
  /** a context (called twice: current, then incoming); the load-time fix-ups (0x100266a0) go to eng.cur */
  makeCtx(eng: Engine): PresetCtx;
  waves: Waves;
  canvas: Canvas;
  /** the frame's scene after the waves' update (canvas.render with the shapes and waves as overlays) */
  render(eng: Engine): void;
  settings?: Settings;
}

export class Engine {
  readonly audio = new Audio();
  readonly list: PresetList;
  readonly clock: Clock;
  readonly waves: Waves;
  readonly canvas: Canvas;
  readonly width: number;
  readonly height: number;
  readonly texW: number;
  readonly texH: number;
  readonly halfWH: number;              // +0x270
  private readonly parts: EngineParts;
  /** +0x280 current (also DAT_10067264: the engine ctor sets it after both contexts exist, swap after the
   *  exchange), +0x284 incoming */
  cur: PresetCtx;
  next: PresetCtx;

  // timing (0x10013210)
  frame = 0;                            // +0x2a8 (float), also tp_frame (DAT_10043204)
  fpsEst = 30;                          // +0x2ac
  fps = 30;                             // DAT_1003e418, tp_fps; the audio's att rates use it
  time = 0;                             // DAT_10043208, tp_time
  readonly ring = new Float32Array(128);  // +0x28 cumulative frame times
  ringIdx = 0;                          // +0x228
  prevQpc = 0;                          // +0x20 (double)

  // scheduling
  target = 0;                           // DAT_10067268 (uint32 tick)
  fading = false;                       // DAT_10067274
  fadeLen = 10000;                      // +0x2b4
  duration = 12000;                     // DAT_1003e444
  w1 = 0;                               // DAT_10067278: weight of the outgoing preset
  w2 = 0;                               // DAT_1006727c: weight of the incoming one
  pendingName = '';                     // DAT_100431e8
  curName = '';                         // DAT_100431f4
  readonly durBase = 10000;             // +0x288
  readonly durRand = 5000;              // +0x28c

  // settings
  meshW: number; meshH: number;         // DAT_1003e420/424: the mesh as built
  readonly iniMeshW: number; readonly iniMeshH: number;   // DAT_1003e428/42c: what tp_meshx/y = 0 becomes
  readonly desiredFps: number;          // DAT_1003e41c: what tp_fDesiredFPS = 0 becomes
  readonly disablePresetFps: boolean;   // +0x2b0
  readonly beatOn: boolean;             // +0x294

  get mesh(): Mesh { return this.canvas.mesh; }
  gtc(): number { return this.clock.tick() >>> 0; }

  /** 0x10011a40 (rand seeded first: srand(GetTickCount())), then the plug-in's settings (0x10015fd0). */
  constructor(p: EngineParts) {
    const s = p.settings || DEFAULT_SETTINGS;
    this.parts = p;
    this.width = p.width; this.height = p.height;
    this.halfWH = (p.width + p.height) >> 1;
    this.clock = p.clock; this.waves = p.waves; this.canvas = p.canvas;
    [this.iniMeshW, this.iniMeshH] = meshDims(s.meshSize);
    this.meshW = this.iniMeshW; this.meshH = this.iniMeshH;
    this.desiredFps = f(s.desiredFps); this.disablePresetFps = s.disablePresetFps; this.beatOn = s.useBeatDetection;
    A.srand(p.clock.tick() >>> 0);
    [this.texW, this.texH] = textureDims(p.width, p.height);
    const a = p.makeCtx(this), b = p.makeCtx(this);  // each context's ctor points DAT_10067264 at itself;
    this.cur = a; this.next = b;                       // 0x10011c62 then sets it to +0x280
    this.list = new PresetList(p.names);               // the shuffle: names.length - 1 rand draws
    const first = this.list.current;
    if (first !== '') { this.load(first); this.swap(); }
    this.curName = first; this.pendingName = '';
    this.cur.active = true; this.next.active = false;
  }

  /** One IWMPEffects2::RenderWindowed call. False: silence, nothing happened. */
  render(tl: TimedLevel): boolean {
    if (!this.audio.sample(tl)) return false;
    this.audio.process(this.cur.vars, this.fps, this.beatOn, this.halfWH);
    this.step();
    return true;
  }

  /** 0x10012d60 */
  step(): void {
    const tick = this.gtc();
    if (tick > (this.target >>> 0)) {
      if (!this.fading) {
        if (this.pendingName === '') {
          this.load('');
          if (this.pendingName === '') this.load('');
        }
        if (this.pendingName === '') this.canvas.message('Failed to load next Preset...');
        else {
          this.fading = true;
          this.fadeLen = ((A.rand() * 3500) / 32767 | 0) + 3500;
          this.target = (this.clock.tick() + this.fadeLen) >>> 0;
        }
      } else {
        this.fading = false;
        this.swap();
      }
    }
    if (this.fading) this.weights();
    const next = this.fading ? this.next : null;
    this.cur.resetFrame();                                    // 0x1000f270
    if (this.cur.active && next) next.resetFrame();
    this.timing();
    this.cur.time = this.time;                                // 0x1000f300
    this.globals(this.cur);                                   // 0x1000f780's first stores
    if (this.cur.active && next) this.globals(next);
    this.cur.perFrame(next, this);
    const c = this.cur;
    this.waves.update(c.vars, c.waveColor, c.time, this.fading, this.w2, this.w1);
    this.parts.render(this);
    this.frame = add24(this.frame, 1);
  }

  /** tp_time, tp_fps, tp_frame, tp_progress as 0x1000f780 stores them */
  private globals(c: PresetCtx): void {
    const v = c.vars;
    v[V.time] = c.time; v[V.fps] = this.fps; v[V.frame] = this.frame;
    let p = F_0001;
    const d = sub24(f(this.target | 0), this.gtc());   // (float)(int)target - (uint64)tick
    if (d !== 0 && this.duration !== 0 && c.active) p = sub24(1, div24(d, this.duration));
    v[V.progress] = p;
  }

  /** 0x100149d0 */
  private weights(): void {
    const w = div24((this.target - this.clock.tick()) >>> 0, this.fadeLen);   // FILD of a qword whose high dword is 0: unsigned
    this.w1 = w < 0 ? 0 : w;
    const w2 = sub24(1, w);
    this.w2 = w2 > 1 ? 1 : w2;
  }

  /** 0x10014a50: load `name` ('' = the next one: tp_NextPreset, else the shuffled list) into the incoming context */
  load(name: string): void {
    if (name === '') {
      if (this.cur.nextPreset !== '') this.pendingName = this.cur.nextPreset;
      else {
        this.pendingName = this.list.next();
        if (this.pendingName === '') { this.duration = 120000; this.target = (this.clock.tick() + 120000) >>> 0; }
      }
      name = this.pendingName;
    }
    // the DLL always has a path here (folder + "\" + name), so an empty list still "loads" the folder itself
    this.next.load(name, name === '' ? null : this.parts.source(name));
    this.waves.setNextMode(ftol(this.next.vars[V.nWaveMode]), () => A.rand());   // 0x10017ba0
  }

  /** 0x10014540: the incoming preset becomes the current one */
  swap(): void {
    this.canvas.clearInfo();
    this.waves.commitMode(this.cur.vars);                   // 0x10017b80: var 0 of DAT_10067264, still the outgoing one
    const t = this.cur; this.cur = this.next; this.next = t;
    this.cur.active = true; this.next.active = false;
    this.curName = this.pendingName;
    const v = this.cur.vars;
    if (v[V.meshx] === 0) v[V.meshx] = this.iniMeshW;
    if (v[V.meshy] === 0) v[V.meshy] = this.iniMeshH;
    const mx = ftol(v[V.meshx]), my = ftol(v[V.meshy]);
    if (mx !== this.meshW || my !== this.meshH) { this.meshW = mx; this.meshH = my; this.canvas.rebuildMesh(mx, my); }
    if (this.mesh.count) this.mesh.fade(v[V.fDecay]);       // every vertex colour = clamp(fDecay * 255 - 0.5) gray
    const fd = v[V.fDuration];
    if (fd > 0) this.duration = ftol(mul24(fd, 1000));
    else this.duration = ((A.rand() * this.durRand) >>> 0) / 0x7fff + this.durBase | 0;
    if (fd === -1) this.duration = 120000;
    this.target = (this.clock.tick() + this.duration) >>> 0;
    this.pendingName = '';
  }

  /** 0x10013210 (the QueryPerformanceCounter path) */
  private timing(): void {
    if (this.frame === 0) { this.fpsEst = 30; this.time = 0; this.ringIdx = 0; }
    const q = this.clock.qpc();
    let dt = f(div24(sub24(q, this.prevQpc), this.clock.qpf));
    this.prevQpc = q;
    this.time = add24(div24(1, this.fpsEst), this.time);
    const fr = this.frame, fps = this.fpsEst, ring = this.ring, idx = this.ringIdx;
    if (fr > 128) {
      let cnt = 64;
      if (fps < 60) cnt = ftol(mul24(add24(mul24(mul24(fps, 0.01666666753590107), 0.8999999761581421), 0.10000000149011612), 64));
      if (div24(5, fps) < dt || dt > 1 || dt < 0) dt = DT_DEFAULT;
      const old = ring[(idx - cnt + 128) & 127];
      const now = add24(dt, ring[(idx + 127) & 127]);
      ring[idx] = now; this.ringIdx = (idx + 1) & 127;
      const inst = div24(cnt, sub24(now, old));
      const k = 0.8700000047683716;
      if (Math.abs(sub24(fps, inst)) > 3) this.fpsEst = inst;
      else this.fpsEst = add24(mul24(sub24(1, k), inst), mul24(k, fps));
    } else {
      const k = 0.6000000238418579;
      if (fr < 2) dt = DT_DEFAULT;
      else if (dt > 1 || dt < 0) dt = div24(1, fps);
      const b0 = ring[0];
      const now = add24(dt, ring[(idx + 127) & 127]);
      ring[idx] = now; this.ringIdx = (idx + 1) & 127;
      if (fr > 0) this.fpsEst = add24(mul24(div24(fr, sub24(now, b0)), sub24(1, k)), mul24(k, fps));
    }
    this.fps = this.fpsEst;
  }
}
