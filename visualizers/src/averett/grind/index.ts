// A.AverettGrind: Grind (Grind.dll, "Go BIG or Go Home"), shaped like A.Battery. Engine in core.ts and the modules it
// registers. Wiring: the DLL renders its device at the window's client size; the frame is the back buffer at Present
// (blit 1:1, nearest). Time is timeGetTime (options.clock, ms; QueryPerformanceCounter follows it). rand() is the CRT
// LCG, seeded once by srand(time(NULL)) on the first frame (seed()). It draws through a Direct3D 8 device: by default
// the port of Microsoft's reference rasterizer (../../d3d8/ref.ts); options.device swaps in another.
// The DLL's pictures (film stills, its backdrop, the film's sign) are not ours: art.ts draws our own in their place;
// the private A/B feeds the DLL's own (options.art).
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import '../../rand';
import type { Device } from '../../d3d8/api';
import { RefDevice } from '../../d3d8/ref';
import type { Picture } from '../../pictureviz/picture';
import { gdipScale } from '../../pictureviz/pv3/art';
import { GrindCore, render, setPreset, type ArgbPicture, type GrindEnv } from './core';
import { ownArt } from './art';
import './frame';
import './settings';
import './particles';
import './photo';
import './scene';

/** the pictures Grind reads from its Grind_Media folder (and its particle resource) */
export interface GrindArt {
  /** Grind_Media\Foreground: the photos, in the DLL's listing order (name order) */
  photos: Picture[];
  /** Grind_Media\Background: the backdrop */
  background: Picture[];
  /** Grind_Media\Grind_logo: Grind_Logo_0, _1, _1_hover, _3D, _3D_hover */
  logos: (ArgbPicture | null)[];
  /** Grind_Media\Foreground's file names (T3 reads each picture's transition from its name) */
  names?: string[];
  /** DATATABLE_PARTICLE_2 decoded as D3DX gives it: 128 x 128 X8R8G8B8 (BGRA bytes) */
  particle: Uint8Array;
}
export interface GrindOptions {
  /** timeGetTime in ms */
  clock?: () => number;
  /** time(NULL) at the first frame: srand's seed */
  seed?: number;
  /** a device factory; the default is the reference rasterizer */
  device?: (w: number, h: number) => Device;
  /** the pictures; the default is our own (art.ts) */
  art?: GrindArt;
  /** GetLocalTime: the clock the scene shows; the default is the machine's */
  localTime?: () => { h: number; m: number; s: number; ms: number };
}
export interface GrindConfig { width?: number; height?: number; options?: GrindOptions; preset?: number }

declare module '../../ns' {
  interface AlchemyNS {
    AverettGrind: typeof AverettGrind;
  }
}

export class AverettGrind {
  static PRESET_NAMES: string[] = ['Go BIG or Go Home'];
  static ENGINE = 'AverettGrind';
  declare w: number;
  declare h: number;
  declare core: GrindCore;
  declare frame: number;
  private declare opt: GrindOptions;
  private declare seedV: number;
  private declare env: GrindEnv;
  private declare out: Surface;

  constructor(cfg?: GrindConfig) {
    cfg = cfg || {};
    this.opt = Object.assign({}, cfg.options);
    this.w = Math.max(1, (cfg.width || 320) | 0); this.h = Math.max(1, (cfg.height || 240) | 0);
    this.seedV = this.opt.seed ?? Math.floor(Date.now() / 1000);
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.build();
  }
  /** a fresh DLL object (WMP creates one per visualization switch) */
  private build(): void {
    const o = this.opt, art = o.art || this.ownArt();
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const clock = o.clock || (() => (Math.floor((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) + 1000000) | 0);
    this.env = {
      tick: clock,
      pictures: art.photos,
      names: art.names,
      background: art.background,
      logos: art.logos,
      levels: new Uint8Array(4100),
      createDevice: (w, h) => {
        const d = o.device ? o.device(w, h) : new RefDevice(w, h);
        const present = d.present.bind(d);
        d.present = () => { present(); this.core.presented = true; };
        return d;
      },
      scale: gdipScale,
      particle: () => art.particle.slice(),
      localTime: o.localTime || (() => {
        const d = new Date();
        return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), ms: d.getMilliseconds() };
      }),
    };
    this.core = this.makeCore(this.env);
    this.core.seedVal = this.seedV;
    setPreset(this.core, 0);
    this.frame = 0;
  }
  /** the engine object (T3 builds its own on Grind's) */
  protected makeCore(env: GrindEnv): GrindCore { return new GrindCore(env); }
  /** our own pictures */
  protected ownArt(): GrindArt { return ownArt(); }
  seed(n: number): this { this.seedV = n | 0; this.build(); return this; }
  /** the DLL resets its device for a new client size; the port starts over at the new size */
  resize(w: number, h: number): void {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.build();
  }
  setPreset(n: number): boolean { return (n | 0) === 0; }

  render(L: TimedLevel | null): Surface | null {
    const lv = this.env.levels;
    if (L) {
      lv.set(L.freq[0].subarray(0, 1024), 0); lv.set(L.freq[1].subarray(0, 1024), 1024);
      lv.set(L.wave[0].subarray(0, 1024), 2048); lv.set(L.wave[1].subarray(0, 1024), 3072);
    } else lv.fill(0);
    const c = this.core;
    c.presented = false;
    render(c, this.w, this.h);
    this.frame++;
    if (!c.presented || !c.dev) return null;
    const bb = c.dev.getBackBuffer(), l = bb.lockRect(null, 0x10);
    if (this.out.w !== this.w || this.out.h !== this.h) this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    const px = this.out.px, d = l.data;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * l.pitch + x * 4;
      px[y * this.w + x] = (d[i + 2] << 16) | (d[i + 1] << 8) | d[i];
    }
    bb.unlockRect();
    return this.out;
  }

  debug(): Record<string, unknown> {
    const k = this.constructor as typeof AverettGrind;
    return { engine: k.ENGINE, preset: 0, presetName: k.PRESET_NAMES[0], size: this.w + 'x' + this.h,
      frame: this.frame, device: !!this.core.dev };
  }
}
A.AverettGrind = AverettGrind;
