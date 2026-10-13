// Alchemy.PictureViz3: "Picture Viz 3D: Spring Edition" (Picture_Viz_III.dll, the Creativity Fun Pack 2003), 30
// presets: four selections and 26 transitions between pictures, drawn with Direct3D 8: the picture is the floor
// under a rippling water surface. Engine in core.ts and the modules it registers.
//
// Wiring: the DLL renders its device at the window's client size; the frame is the back buffer at Present (blit
// 1:1, nearest). It never reads the TimedLevel: the pictures and the clock drive it, not the sound. Time is
// timeGetTime (cfg.tick, milliseconds; QueryPerformanceCounter follows it). rand() is the CRT LCG, seeded once by
// srand(time(NULL)) on the first frame (seed()). It draws through a Direct3D 8 device: by default the port of
// Microsoft's reference rasterizer (../../d3d8/ref.ts); options.device swaps in another (the A/B's trace device).
// In this app the "folder" is the playing song's cover art and Canvas stills (setPictures).
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import '../../rand';
import { Core, render, setPreset, type Env } from './core';
import type { Picture } from '../picture';
import type { Device } from '../../d3d8/api';
import { RefDevice } from '../../d3d8/ref';
import { gdipScale, ownParticle } from './art';
import './frame';
import './photo';
import './sprite';
import './scene';
import './tx3d';
import './txliquid';
import './txliquid2';

export interface PictureViz3Options {
  /** a device factory; the default is the reference rasterizer */
  device?: (w: number, h: number) => Device;
  /** the particle sprite, 128 x 128 X8R8G8B8 (BGRA bytes); the default is our own (art.ts) */
  particle?: () => Uint8Array;
}
export interface PictureViz3Config {
  width?: number;
  height?: number;
  options?: PictureViz3Options;
  preset?: number;
  pictures?: Picture[];
  /** timeGetTime(): milliseconds */
  tick?: () => number;
}

const PRESET_NAMES = ['Favorite 3D Transitions', 'Random Selection - Basic 3D', 'Random Selection - Liquid Transitions',
  'Random Selection - All Transitions', 'Pop', 'Transparency', 'Zoom', 'Store', 'Spiral', 'Spin', 'Turn', 'Flip',
  "Stack'm", 'Slide', 'Water Rain', 'Water Drop', 'Watery', 'Spiky Thing', 'Caldron', 'Tidal Pool', 'Wisp on water',
  'Plunk', 'Flower', 'Spatter', 'Burst', 'Blast-off', 'Electric', 'Crossing', 'Sundrops', 'Volcanic'];

class PictureViz3 {
  declare core: Core;
  declare env: Env;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: PictureViz3Options;
  declare seedVal: number;
  declare out: Surface;
  declare folders: number;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: PictureViz3Config) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const o = this.options;
    this.env = {
      tick: cfg.tick || (() => (Math.floor((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) + 1000000) | 0),
      pictures: cfg.pictures || [],
      createDevice: (w, h) => {
        const d = o.device ? o.device(w, h) : new RefDevice(w, h);
        const present = d.present.bind(d);
        d.present = () => { present(); this.core.presented = true; };
        return d;
      },
      scale: gdipScale,
      particle: o.particle || ownParticle,
    };
    this.seedVal = (Date.now() / 1000) | 0;
    this.folders = 0;
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.w = Math.max(1, (cfg.width || 640) | 0);
    this.h = Math.max(1, (cfg.height || 480) | 0);
    this.preset = cfg.preset ? cfg.preset | 0 : 0;
    this.build();
  }

  /** a fresh DLL object (WMP creates one per visualization switch) */
  private build(): void {
    this.core = new Core(this.env);
    this.core.seedVal = this.seedVal;
    // the key exists, naming the app's "folder" (a missing key is the DLL's first run, which also opens its options
    // property sheet); the DLL fills in every other value it misses with its defaults
    const r = this.core.reg;
    r.set('Use_pictures_in_this_folder', 'pictures#' + this.folders);
    r.set('New_folder_selected', 1);
    r.set('How_often_should_picture_be_changed', 2);
    this.frame = 0;
    setPreset(this.core, this.preset);
  }

  /** srand's seed (the DLL seeds with time(NULL) on its first frame) */
  seed(n: number): this {
    this.seedVal = n | 0;
    this.core.seedVal = n | 0;
    if (this.core.m.I[0x30fd8 >> 2] !== 0) A.srand(n | 0);
    return this;
  }

  /** a new "folder": the DLL counts it again and restarts at its first picture, as when its options dialog picks
   *  a new folder (the background folder stays unset: a plain background, as the DLL's A/B runs) */
  setPictures(p: Picture[]): void {
    this.env.pictures = p;
    const name = 'pictures#' + ++this.folders, r = this.core.reg;
    r.set('Use_pictures_in_this_folder', name);
    r.set('New_folder_selected', 1);
  }

  /** the DLL resets its device for a new client size; the port starts over at the new size */
  resize(w: number, h: number): void {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.build();
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return setPreset(this.core, n);
  }

  render(level: TimedLevel | null): Surface | null {
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
    const I = this.core.m.I;
    return { engine: 'PictureViz3', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, pictures: this.env.pictures.length, transition: I[0x31270 >> 2], device: !!this.core.dev };
  }
}

declare module '../../ns' {
  interface AlchemyNS {
    PictureViz3: typeof PictureViz3;
  }
}

A.PictureViz3 = PictureViz3;
export { PictureViz3 };
