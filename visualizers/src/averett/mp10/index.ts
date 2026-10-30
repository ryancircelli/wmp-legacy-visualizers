// A.AverettMp10: Energy Bliss (MediaPlayer_10.dll, Windows Media Player 10's visualization), shaped like A.Battery.
// The DLL renders its device at the window's client size; the frame is the back buffer at Present. Time is
// timeGetTime (options.clock, ms; QueryPerformanceCounter follows it); rand() is the CRT LCG seeded once by
// srand(time(NULL)) on the first frame. It draws through a Direct3D 8 device: by default the port of Microsoft's
// reference rasterizer (../../d3d8/ref.ts); options.device swaps in another. The pictures (sky, clouds, the panel's
// buttons) are our own (art.ts, eqart.ts); the private A/B feeds the DLL's. The track panel needs
// IWMPEffects2::NotifyNewMedia, which a player without WMP's media objects never sends: it stays empty, as in the DLL.
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import type { Device } from '../../d3d8/api';
import { RefDevice } from '../../d3d8/ref';
import { Mp10Engine, type Mp10Art } from './engine';
import { ownArt } from './art';
import { makeEqPanel, type EqButtons } from './eqpanel';
import { eqButtons } from './eqart';

export interface Mp10Options {
  /** timeGetTime in ms */
  clock?: () => number;
  /** time(NULL) at the first frame: srand's seed */
  seed?: number;
  /** a device factory; the default is the reference rasterizer */
  device?: (w: number, h: number) => Device;
  /** the sky and cloud pictures; the default is our own (art.ts) */
  art?: Mp10Art;
  /** the equalizer's button pictures; the default is our own (eqart.ts) */
  buttons?: EqButtons;
}
export interface Mp10Config { width?: number; height?: number; options?: Mp10Options; preset?: number }

declare module '../../ns' {
  interface AlchemyNS {
    AverettMp10: typeof AverettMp10;
  }
}

export class AverettMp10 {
  static PRESET_NAMES: string[] = ['Energy Bliss'];
  w: number; h: number;
  eng!: Mp10Engine;
  private opt: Mp10Options;
  private dev: Device | null = null;
  private presented = false;
  private seedV: number;
  private lv = new Uint8Array(4112);
  private out: Surface = { w: 0, h: 0, px: new Uint32Array(0) };

  constructor(cfg?: Mp10Config) {
    cfg = cfg || {};
    this.opt = Object.assign({}, cfg.options);
    this.w = (cfg.width || 320) | 0; this.h = (cfg.height || 240) | 0;
    this.seedV = this.opt.seed ?? Math.floor(Date.now() / 1000);
    this.build();
  }
  private build(): void {
    const o = this.opt;
    const clock = o.clock || (typeof performance !== 'undefined' ? () => Math.floor(performance.now()) : () => Date.now());
    this.dev = null;
    this.eng = new Mp10Engine({
      art: o.art || ownArt, panel: makeEqPanel(o.buttons || eqButtons()), clock, seed: this.seedV,
      createDevice: (w, h) => {
        const d = o.device ? o.device(w, h) : new RefDevice(w, h);
        const present = d.present.bind(d);
        d.present = () => { present(); this.presented = true; };
        return (this.dev = d);
      },
    });
  }
  seed(n: number): this { this.seedV = n | 0; this.build(); return this; }
  /** the DLL resets its device for a new client size; the port starts over at the new size */
  resize(w: number, h: number): void {
    if ((w | 0) === this.w && (h | 0) === this.h) return;
    this.w = w | 0; this.h = h | 0; this.build();
  }
  setPreset(n: number): boolean { return (n | 0) === 0; }

  render(L: TimedLevel): Surface | null {
    const lv = this.lv;
    lv.set(L.freq[0].subarray(0, 1024), 0); lv.set(L.freq[1].subarray(0, 1024), 1024);
    lv.set(L.wave[0].subarray(0, 1024), 2048); lv.set(L.wave[1].subarray(0, 1024), 3072);
    new DataView(lv.buffer).setInt32(4096, L.state | 0, true);
    this.presented = false;
    this.eng.render(lv, this.w, this.h);
    if (!this.presented || !this.dev) return null;
    const bb = this.dev.getBackBuffer(), l = bb.lockRect(null, 0x10);
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
    const I = this.eng.I;
    return {
      engine: 'AverettMp10', preset: 0, presetName: AverettMp10.PRESET_NAMES[0], frame: this.eng.frame,
      level: I[0x1fe5], average: I[0x1fe7], device: !!this.dev,
    };
  }
}
A.AverettMp10 = AverettMp10;
