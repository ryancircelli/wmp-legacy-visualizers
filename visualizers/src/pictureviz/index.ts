// Alchemy.PictureViz — "Picture Viz" ("Picture It!", PictureViz.dll of the Windows Media Bonus Pack for Windows
// XP), 7 presets. Engine in core.ts; this is the AlchemyNS-facing wrapper with Battery's shape plus
// setPictures().
//
// Wiring: the DLL's canvas becomes the window (its own 352 x 320 one only for a transition's first frame), so
// the native surface is the view itself: render at the view's size and blit 1:1 (nearest). It reads only
// freq[0] of the TimedLevel (not even the play state), and timeGetTime() for the picture timing (cfg.tick).
// rand() is the CRT LCG, srand(time(NULL)) at the first render (seed() pins it). The pictures are the
// app's (the playing song's cover art); each is scaled once, when it loads, by the GDI+ step the DLL runs.
import { A } from '../ns';
import type { Surface, TimedLevel } from '../ns';
import '../rand';
import { Core } from './core';
import { gdipScaleHQ } from './gdip';
import type { Picture } from './picture';

export type { Picture } from './picture';

export interface PictureVizConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
  pictures?: Picture[];
  /** timeGetTime(): milliseconds, any origin (default performance.now()) */
  tick?: () => number;
  /** the picture scaler (the DLL's GDI+ HighQualityBicubic step); default: gdip.ts */
  scale?: (p: Picture, dw: number, dh: number) => Uint32Array;
}

// The DLL's own list order (GetPresetTitle; the names carry a leading space there)
const PRESET_NAMES = ['Pop Transition', 'Transparency Transition', 'Zoom Transition', 'Squirt Transition',
  'Twirl Transition', 'Dissolve Transition', 'Random'];

const gdip = (p: Picture, dw: number, dh: number): Uint32Array => gdipScaleHQ(p.rgb, p.w, p.h, dw, dh);

class PictureViz {
  declare core: Core;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare surface: Surface;
  declare options: Record<string, unknown>;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: PictureVizConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    // options.datatable: the DATATABLE_11 resource of the user's own PictureViz.dll (its logo images); without
    // it there is no logo (it is MSN's)
    var dt = this.options.datatable;
    var tick = cfg.tick || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.core = new Core({ tick: tick, datatable: dt instanceof Uint8Array ? dt : null, scale: cfg.scale || gdip });
    if (cfg.pictures) this.core.setPictures(cfg.pictures);
    this.frame = 0;
    this.preset = 0;
    this.resize(cfg.width || 640, cfg.height || 480);
    this.setPreset(cfg.preset ? cfg.preset | 0 : 0);
  }

  /** the CRT state srand(time(NULL)) leaves at the first render */
  seed(n: number): this { this.core.time = () => n | 0; A.srand(n | 0); return this; }

  /** The pictures to show (the song's cover art, its Canvas still), in the order the DLL would list them. */
  setPictures(p: Picture[]): void { this.core.setPictures(p); }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.core.setPreset(n);
    this.preset = n;
    return true;
  }

  render(level: TimedLevel): Surface | null {
    if (!level) return this.surface || null;
    this.core.render(level.freq[0], this.w, this.h);
    this.frame++;
    var c = this.core;
    if (!this.surface || this.surface.px !== c.dc) this.surface = { w: c.dcW, h: c.dcH, px: c.dc };
    return this.surface;
  }

  debug(): Record<string, unknown> {
    return { engine: 'PictureViz', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, pictures: this.core.pictures.length };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    PictureViz: typeof PictureViz;
  }
}

A.PictureViz = PictureViz;
export { PictureViz };
