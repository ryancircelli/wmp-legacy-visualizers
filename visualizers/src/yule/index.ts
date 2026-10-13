// Alchemy.YuleLog — Microsoft's "Yule Log" (yule.dll 1.0.0.1, 2001-11-29: Windows Media Bonus Pack for Windows
// XP, and the Winter Fun Packs), a Direct3D 8 visualization: a fireplace whose four flames burn to the music.
// IWMPEffects only (GetCapabilities 0x7), one preset, "Yule Log". WMP calls Render(levels, hdc, rect); the DLL
// finds its window with WindowFromDC, makes its own device (software vertex processing, multithreaded,
// FPU_PRESERVE) at the window's size, and presents into the window.
//
// The port issues the Direct3D 8 calls the DLL issues (./scene.ts), through a Device (../d3d8/api.ts): by default
// the reference-rasterizer port (../d3d8/ref.ts), whose back buffer is the frame; any other Device (a TraceDevice
// recording the calls) can be passed in. The art is the port's own (./art.ts) unless other assets are given.
import { A, type Surface, type TimedLevel } from '../ns';
import type { Device } from '../d3d8/api';
import { RefDevice } from '../d3d8/ref';
import { Scene, DEFAULT_PREFS, type YulePrefs } from './scene';
import type { YuleAssets } from './assets';
import { makeYuleArt } from './art';

declare module '../ns' {
  interface AlchemyNS {
    YuleLog: typeof YuleLog;
  }
}

const PRESET_NAMES: string[] = ['Yule Log'];

export interface YuleConfig {
  width?: number;
  height?: number;
  /** the Preset1 registry values (Sens, YRollOn, ...); defaults are the DLL's REGISTRY script's */
  options?: Partial<YulePrefs>;
  preset?: number;
  /** the device to draw through (default: a RefDevice of width x height) */
  device?: Device;
  /** the fire's images and meshes (default: the port's own, ./art.ts) */
  assets?: YuleAssets;
  /** QueryPerformanceCounter in microseconds (default: performance.now()) */
  now?: () => number;
}

class YuleLog {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  readonly dev: Device;
  private scene: Scene;
  private out: Surface | null = null;
  private frames = 0;

  constructor(cfg: YuleConfig = {}) {
    this.w = cfg.width || 320; this.h = cfg.height || 240;
    this.dev = cfg.device ?? new RefDevice(this.w, this.h);
    const now = cfg.now ?? ((): number => Math.floor(performance.now() * 1000));
    this.scene = new Scene(this.dev, { assets: cfg.assets ?? makeYuleArt(), prefs: { ...DEFAULT_PREFS, ...cfg.options }, now });
    if (cfg.preset) this.setPreset(cfg.preset);
  }

  /** the CRT's rand stream (only Init draws from it: the flames' periods and spectrum bands) */
  seed(n: number): this { A.srand(n | 0); return this; }

  /** the window's size: the next render Resets the device to it, as the DLL does when its window changes */
  resize(w: number, h: number): void { this.w = w | 0; this.h = h | 0; }

  setPreset(n: number): boolean { return (n | 0) === 0; }

  render(level: TimedLevel): Surface | null {
    this.scene.render(level, this.w, this.h);
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
    return { engine: 'YuleLog', preset: 0, presetName: PRESET_NAMES[0], size: this.w + 'x' + this.h, frames: this.frames, ...this.scene.debug() };
  }
}

A.YuleLog = YuleLog;
export { YuleLog };
