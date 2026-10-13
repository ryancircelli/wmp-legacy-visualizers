// Alchemy.MusicalColors — WMP 7 / 7.1 / 8's "Musical Colors" (wmpvis.dll, class WMPVis), 20 presets.
// Engine in core.ts; this is the AlchemyNS-facing wrapper with Battery's shape.
//
// Wiring: the DLL draws its 350 x 320 canvas scaled (its own 8.8 DDA, at most 3x) to the window it is
// given, so the native surface is the view itself: render at the view's size and blit 1:1 (nearest).
// It reads only freq[0] of the TimedLevel and, in WMP 8, its play state: stopped or paused (state 0 / 1)
// clears the view to black and holds the animation (WMP 7's 'WinMe 3D' variant ignores the state). No
// waveform, no clock: one animation step per render() call. rand() is the CRT LCG (srand never called:
// seed 1 on a fresh thread). WMP always calls SetCurrentPreset before rendering; with no preset set the
// DLL draws nothing, so the default here is preset 0 (Night Lights).
import { A } from '../ns';
import type { Surface, TimedLevel } from '../ns';
import '../rand';
import { Core } from './core';

export interface MusicalConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

export interface MusicalDebugInfo {
  engine: string;
  preset: number;
  presetName: string;
  size: string;
  frame: number;
}

// WMP 8 SP1's list (the newest wmpvis.dll), then WMP 7.0 / 7.1's own 20th preset, which 8 replaced.
// The other 19 render identically in 7.0, 7.1, 8 and 8 SP1.
const PRESET_NAMES = ['Night Lights', 'Colors in Motion', 'Aurora', 'Rhythmic Colors', 'Star Power',
  'Electric Green', 'Soft Fire', 'Silky Wave', 'CutOut', 'Rolling Fire', 'Water Spray', 'Acid Rock',
  'Hard Rock', 'Hot Spray', 'Yellow Swirl', 'Blue Flame', 'Critter Rock', 'Electric Rainbow',
  'Neon Highway', 'Ice Crystals', 'WinMe 3D (WMP 7)'];

class MusicalColors {
  declare core: Core;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare surface: Surface;
  declare options: Record<string, unknown>;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: MusicalConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    // options.datatable: the RCDATA "DATATABLE" resource of the user's own wmpvis.dll (WMP 7, 7.1, 8 and 8 SP1
    // ship it identical) for the original images; without it the images are generated (images.ts)
    var dt = this.options.datatable;
    this.core = new Core(dt instanceof Uint8Array ? dt : null);
    this.frame = 0;
    this.preset = 0;
    this.resize(cfg.width || 640, cfg.height || 480);
    this.setPreset(cfg.preset ? cfg.preset | 0 : 0);
  }

  /** the CRT seed (the DLL never seeds: a fresh thread's 1) */
  seed(n: number): this { A.srand(n | 0); return this; }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    var v8 = n < 20, dll = v8 ? n : 19, c = this.core;
    if (c.v8 !== v8) { c.v8 = v8; c.m.I[0x4600 >> 2] = -1; }   // same DLL index, other version: rebuild the scene
    c.setPreset(dll);
    this.preset = n;
    return true;
  }

  render(level: TimedLevel): Surface | null {
    if (!level) return this.surface || null;
    this.core.render(level.freq[0], this.w, this.h, level.state);
    this.frame++;
    var c = this.core;
    if (!this.surface || this.surface.px !== c.dc) this.surface = { w: c.dcW, h: c.dcH, px: c.dc };
    return this.surface;
  }

  debug(): MusicalDebugInfo {
    return { engine: 'MusicalColors', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frame: this.frame };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    MusicalColors: typeof MusicalColors;
  }
}

A.MusicalColors = MusicalColors;
export { MusicalColors };
