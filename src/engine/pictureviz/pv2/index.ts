// Alchemy.PictureViz2: "Picture It! Visualization 2" (PictureViz_II.dll, Microsoft's visualization gallery
// 1.0.0.5; the Winter Fun Pack 2002's 1.0.0.1 is the "(Winter Edition)" variants), 31 presets: the favourites,
// four random selections and 26 transitions between pictures, each shown on a background picture with a
// frame and a drop shadow. Engine in core.ts and the modules it registers.
//
// Wiring: the DLL draws into the whole window it is given (the native surface is the view; blit 1:1,
// nearest). It never reads the TimedLevel: the pictures and the clock drive it, not the sound. Time is
// timeGetTime (cfg.tick, milliseconds); the picture logic runs at most 11 times a second, the compositor on
// every render(). rand() is the CRT LCG, seeded once by srand(time(NULL)) on the first frame (seed()).
// In this app the "folder" is the playing song's cover art and Canvas stills (setPictures).
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import '../../rand';
import { Core, render, setPreset, type Env } from './core';
import type { Picture } from '../picture';
import { gdipScaleHQ } from '../gdip';
import { gdipDrawClipped } from './gdip-clip';
import './compose';
import './fx';
import './fx2';
import './shadow';
import './tx';
import './tx2';

/** GDI+'s step (see Env.scale) */
export type Scaler = Env['scale'];

/** GDI+'s step as PictureViz_II runs it: the picture drawn HighQualityBicubic at dw x dh (gdip.ts) at (dx, dy) into
 *  a bw x bh bitmap that starts transparent black, read back as ARGB, alpha dropped. The foreground loader's
 *  bitmap is exactly dw x dh; the background loader's is the window, the picture centred and cropped. */
export function gdipScale(pic: Picture, dx: number, dy: number, dw: number, dh: number, bw: number, bh: number): Uint32Array {
  if (dx === 0 && dy === 0 && dw === bw && dh === bh) return gdipScaleHQ(pic.rgb, pic.w, pic.h, dw, dh);
  return gdipDrawClipped(pic.rgb, pic.w, pic.h, dx, dy, dw, dh, bw, bh);    // the background loader's centred crop
}

export interface PictureViz2Config {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
  pictures?: Picture[];
  /** timeGetTime(): milliseconds */
  tick?: () => number;
}

export interface PictureViz2DebugInfo {
  engine: string;
  preset: number;
  presetName: string;
  size: string;
  frame: number;
  pictures: number;
}

const GALLERY = ['Favorite Transitions', 'Random Selection - Basic Transitions',
  'Random Selection - Geometric Transitions', 'Random Selection - Particle Transitions',
  'Random Selection - All Transitions', 'Basic - Pop Transition', 'Basic - Transparency Transition',
  'Basic - Zoom Transition', 'Basic - Curtains', 'Basic - Dissolve Transition', 'Basic - Toaster', 'Basic - Swipe',
  'Basic - Rotate', 'Pattern', 'WetGlass', 'Spiral', 'Flourish', 'Undulation', 'SpotLight', 'Twirl Transition',
  'Disperse', 'SeaGrass', 'Ripple', 'SquareS', 'Transport', 'Variegate', 'Suck Transition', 'Dematerialize', 'Spin',
  'BullsEye', 'Radial'];
// The Winter Fun Pack 2002's build (1.0.0.1) as variants: the same transitions, but a red frame by default, and its
// picture search steps through the folder without the gallery build's reload hiccup on the first change.
const N_GALLERY = GALLERY.length;
const PRESET_NAMES = GALLERY.concat(GALLERY.map((n) => n + ' (Winter Edition)'));

class PictureViz2 {
  declare core: Core;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare surface: Surface;
  declare options: Record<string, unknown>;
  declare env: Env;
  declare folders: number;
  declare folder: string;
  declare seedVal: number;

  static PRESET_NAMES: string[] = PRESET_NAMES;
  /** the default GDI+ scaling step (Env.scale) */
  static gdipScale: Scaler = gdipScale;

  constructor(cfg?: PictureViz2Config) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const scale = this.options.scale;
    this.env = {
      tick: cfg.tick || (() => (Math.floor((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) + 1000000) | 0),
      pictures: cfg.pictures || [],
      scale: typeof scale === 'function' ? (scale as Scaler) : gdipScale,
    };
    this.folders = 0;
    this.folder = 'pictures';
    this.seedVal = (Date.now() / 1000) | 0;
    this.core = this.newCore(false);
    this.frame = 0;
    this.preset = 0;
    this.resize(cfg.width || 640, cfg.height || 480);
    this.setPreset(cfg.preset ? cfg.preset | 0 : 0);
  }

  /** a fresh DLL object (WMP creates one per visualization switch); the two builds are different DLLs */
  newCore(winter: boolean): Core {
    const c = new Core(this.env, this.folder, winter);
    c.seedVal = this.seedVal;
    return c;
  }

  /** srand's seed (the DLL seeds with time(NULL) on its first frame) */
  seed(n: number): this {
    this.seedVal = n | 0;
    this.core.seedVal = n | 0;
    if (this.core.m.I[0x62dc >> 2] !== 0) A.srand(n | 0);
    return this;
  }

  /** a new "folder": the DLL counts it again, restarts at its first picture and reloads the background, as
   *  when its options dialog picks a new folder */
  setPictures(p: Picture[]): void {
    this.env.pictures = p;
    const name = 'pictures#' + ++this.folders, r = this.core.reg;
    this.folder = name;
    r.set('Use_pictures_in_this_folder', name);
    r.set('temp_Use_pictures_in_this_folder', name);
    r.set('Bkg_picture_in_this_folder', name);
    r.set('temp_Bkg_picture_in_this_folder', name);
    r.set('New_folder_selected', 1);
    r.set('New_Bkg_effect', 1);
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    const winter = n >= N_GALLERY;
    if (winter !== this.core.winter) this.core = this.newCore(winter);
    setPreset(this.core, n % N_GALLERY);
    this.preset = n;
    return true;
  }

  render(level: TimedLevel | null): Surface | null {
    const c = this.core;
    render(c, this.w, this.h);
    this.frame++;
    if (!this.surface || this.surface.px !== c.dc) this.surface = { w: c.dcW, h: c.dcH, px: c.dc };
    return this.surface;
  }

  debug(): PictureViz2DebugInfo {
    return { engine: 'PictureViz2', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, pictures: this.env.pictures.length };
  }
}

declare module '../../ns' {
  interface AlchemyNS {
    PictureViz2: typeof PictureViz2;
  }
}

A.PictureViz2 = PictureViz2;
export { PictureViz2 };
