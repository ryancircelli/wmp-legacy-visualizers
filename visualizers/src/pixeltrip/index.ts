// Alchemy.PixelTrip — "PixelTrip" (PixelTripWMP.dll 1.0.0.1, Brian Spangler / Visolu, 2002-2005: a free third-party
// visualization for WMP 7-10, ported from the binary). One preset. Every frame the last picture is pulled through a
// vector field (one of 23 swirls, pulls and ripples, changed every 15-18 s and built a row a frame in the background),
// faded a little, and the effects of the moment draw over it: rings riding Lissajous and rose paths, the waveform as a
// line, a ring or a spiral, wire globes, dot grids; with nothing else up, the waveform straight across the window.
// The DLL's clock (GetTickCount) drives everything: effect lifetimes, the frame-rate cap ("Desired FPS", 30 unless set)
// and its rand's seed. Its settings (PixelTrip.ini next to the DLL) are the options: desiredFps (-1: no cap), motion
// and bounce (0 never, 1 sometimes, 2 always), beat (0 or 1) and sensitivity (1-100), with the DLL's defaults;
// options.clock (milliseconds) stands in for GetTickCount.
//
// The windowed path only (Render 0x100023a0 with an HDC; the DLL's full-screen DirectDraw mode is not ported). Its
// buffer is the window's size and goes to the window 1:1 (DrawDibDraw, 32 bpp), so the native size is the view's.
import { A, type Surface, type TimedLevel } from '../ns';
import { Ctx } from './ctx';
import { Engine, type Settings } from './scene';

declare module '../ns' {
  interface AlchemyNS {
    PixelTrip: typeof PixelTrip;
  }
}

const PRESET_NAMES: string[] = ['PixelTrip'];

export interface PixelTripOptions {
  desiredFps: number; motion: number; bounce: number; beat: number; sensitivity: number;
  clock: (() => number) | null;
}

export interface PixelTripConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

class PixelTrip {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: Record<string, unknown> & PixelTripOptions;
  private c = new Ctx();
  private engine: Engine | null = null;
  private px: Uint32Array;
  private frames = 0;
  private drawn = 0;

  constructor(cfg: PixelTripConfig = {}) {
    this.w = Math.max(16, cfg.width || 640); this.h = Math.max(16, cfg.height || 480);
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000, desiredFps: 30, motion: 1, bounce: 1, beat: 1,
      sensitivity: 62, clock: null }, cfg.options);
    this.px = new Uint32Array(this.w * this.h);
  }

  /** the DLL seeds its rand from the clock when it builds its engine; nothing else to seed */
  seed(_n: number): this { return this; }

  /** a new size rebuilds the engine on the next frame, as the DLL's Render does when the rectangle changes */
  resize(w: number, h: number): void {
    w = Math.max(16, w | 0); h = Math.max(16, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.px = new Uint32Array(w * h);
    this.engine = null;
  }

  setPreset(n: number): boolean { return n === 0; }

  private now(): number {
    const clock = this.options.clock;
    if (clock) return clock() >>> 0;
    return Math.floor(typeof performance !== 'undefined' ? performance.now() : Date.now()) >>> 0;
  }

  render(level: TimedLevel): Surface | null {
    this.c.tick = this.now();
    if (!this.engine) {
      const o = this.options, s: Settings = { fps: o.desiredFps, motion: o.motion, bounce: o.bounce, beat: o.beat, sensitivity: o.sensitivity };
      this.engine = new Engine(this.c, this.w, this.h, s);
    }
    this.frames++;
    if (level.state !== 0 && level.state !== 1) {
      const e = this.engine;
      e.scene.analyze(level.wave[0], level.wave[1], level.freq[0], level.freq[1]);
      const out = e.frame();
      if (out) {
        this.drawn++;
        const px = this.px;
        for (let i = 0, n = px.length; i < n; i++) px[i] = out[i] & 0xffffff;
      }
    }
    return { w: this.w, h: this.h, px: this.px };
  }

  debug(): Record<string, unknown> {
    const e = this.engine;
    return { engine: 'PixelTrip', size: this.w + 'x' + this.h, frames: this.frames, drawn: this.drawn, rand: this.c.hold >>> 0,
      fps: e ? e.fps : 0, slots: e ? e.scene.slots.filter(Boolean).length : 0 };
  }
}

A.PixelTrip = PixelTrip;
export { PixelTrip };
