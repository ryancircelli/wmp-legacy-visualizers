// Alchemy.PlusVis — Microsoft's "Plus! 3-D Visualizations" (plusvis.dll, Microsoft Plus! for Windows XP, 2001), a
// Direct3D 8 visualization of three presets on one engine (the Craniac engine Yule Log also uses): "Oddworld:
// Munch's Oddysee" (a skinned character dancing its matrix-animated series), "Maxx's Kingdom" (a vertex-animated
// creature) and "Undersea Wonders" (drifting jellyfish), each in a sky box, a camera wandering spline paths, the
// light and colours driven by the spectrum. WMP calls Render(levels, hdc, rect); the DLL draws through its own
// device at the window's size.
//
// The port issues the Direct3D 8 calls the DLL issues (./scene.ts and the presets), through a Device
// (../d3d8/api.ts): by default the reference-rasterizer port (../d3d8/ref.ts), whose back buffer is the frame. The
// art is the port's own (./art.ts) unless other assets are given.
import { A, type Surface, type TimedLevel } from '../ns';
import type { Device } from '../d3d8/api';
import { RefDevice } from '../d3d8/ref';
import type { Plus3DAssets } from './assets';
import { PlusVis as Runner, type Preset } from './scene';
import { Munch } from './munch';
import { Blobby } from './blobby';
import { Jelly } from './jelly';
import { makePlus3DArt } from './art';

declare module '../ns' {
  interface AlchemyNS {
    PlusVis: typeof PlusVis;
  }
}

/** GetPresetTitle, in the DLL's order */
const PRESET_NAMES: string[] = ['Oddworld: Munch\'s Oddysee', 'Maxx\'s Kingdom', 'Undersea Wonders'];
const MAKE: ((dev: Device, a: Plus3DAssets) => Preset)[] = [
  (d, a) => new Munch(d, a), (d, a) => new Blobby(d, a), (d, a) => new Jelly(d, a),
];

export interface PlusVisConfig {
  width?: number;
  height?: number;
  preset?: number;
  /** the device to draw through (default: a RefDevice of width x height, a new one per preset) */
  device?: Device;
  /** the models, textures, ANL and BEH files (default: the port's own, ./art.ts) */
  assets?: Plus3DAssets;
  /** QueryPerformanceCounter in microseconds (default: performance.now()) */
  now?: () => number;
  /** time(NULL) for the seed Init takes (default: the wall clock) */
  time?: () => number;
}

class PlusVis {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  dev!: Device;
  private run!: Runner;
  private out: Surface | null = null;
  private frames = 0;
  private assets: Plus3DAssets | null;
  private readonly now: () => number;

  constructor(private cfg: PlusVisConfig = {}) {
    this.w = cfg.width || 320; this.h = cfg.height || 240;
    this.assets = cfg.assets ?? null;
    this.now = cfg.now ?? ((): number => Math.floor(performance.now() * 1000));
    this.start(cfg.preset ?? 0);
  }

  /** a preset from scratch, as the DLL's preset object is made anew when WMP switches to it */
  private start(n: number): void {
    this.preset = n;
    this.assets ??= makePlus3DArt();
    this.dev = this.cfg.device ?? new RefDevice(this.w, this.h);
    const p = MAKE[n](this.dev, this.assets);
    if (this.cfg.time) p.time = this.cfg.time;
    this.run = new Runner(p, this.now);
  }

  /** the CRT's rand stream (Init reseeds it with time(), after shuffling the series) */
  seed(n: number): this { A.srand(n | 0); return this; }

  /** the window's size: the next render Resets the device to it, as the DLL does when its window changes */
  resize(w: number, h: number): void { this.w = w | 0; this.h = h | 0; }

  setPreset(n: number): boolean {
    n |= 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    if (n !== this.preset) this.start(n);
    return true;
  }

  render(level: TimedLevel): Surface | null {
    this.run.render(level, this.w, this.h);
    this.frames++;
    return this.frame();
  }

  /** the back buffer as presented, as 0x00RRGGBB, when the device is the reference rasterizer */
  private frame(): Surface | null {
    if (!(this.dev instanceof RefDevice)) return null;
    const bb = this.dev.getBackBuffer(), w = bb.width, h = bb.height;
    if (!this.out || this.out.w !== w || this.out.h !== h) this.out = { w, h, px: new Uint32Array(w * h) };
    const l = bb.lockRect(null, 0x10), px = this.out.px;
    const src = new Uint32Array(l.data.buffer, l.data.byteOffset, (l.pitch >> 2) * h);
    for (let y = 0; y < h; y++) {
      const s = y * (l.pitch >> 2), d = y * w;
      for (let x = 0; x < w; x++) px[d + x] = src[s + x] & 0xffffff;
    }
    bb.unlockRect();
    return this.out;
  }

  debug(): Record<string, unknown> {
    return { engine: 'PlusVis', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frames: this.frames };
  }
}

A.PlusVis = PlusVis;
export { PlusVis };
