// Alchemy.Goom — "What a GOOM! 2k4" as the Windows Media Player 9 plug-in shipped it (wmp9_goom.dll, iOS
// Software, 2004; CLSID F6007847-E1CE-4c53-AAF4-52169C304783, Effects key Wmp9_goom). Our own
// implementation of what that binary does, written from its machine code; frame for frame the same pixels.
//
// The plug-in's four presets are goom's working resolution: 320x240, 480x360, 600x480 (titled "640x480",
// the DLL sets 600) and 800x600. The engine renders at that size whatever the view, and the player
// stretches it (the DLL's own Render stretched its 320x240 buffer to the window with StretchDIBits).
// Input: the first 512 waveform bytes of each channel, as int16 ((b ^ 0x80) << 8), and the play state
// (100 frames after playback stops the credits roll; they need the user's own DLL for their text and
// font, see text.ts). Randomness: the DLL's CRT rand() and goom's random table, seeded once at start-up
// with a heap address in the DLL; seed(n) is that number here.
import { A, type Surface, type TimedLevel } from '../ns';
import { GoomCore } from './core';
import { goomTextFromDll, type GoomFont } from './text';

const PRESET_NAMES = ['Goom at 320x240', 'Goom at 480x360', 'Goom at 640x480', 'Goom at 800x600'];
const SIZES: [number, number][] = [[320, 240], [480, 360], [600, 480], [800, 600]];

/** Goom's own settings, read from the options object the shell hands every engine (and keeps for its own
 *  output settings: alpha, tint ...) */
export interface GoomOptions {
  /** the plug-in's "Show Song Title At Start" (registry showtitle, on by default) */
  showTitle?: boolean;
  /** the user's own wmp9_goom.dll: its font and credits for the title and idle text (text.ts); without
   *  it no text is drawn */
  dll?: Uint8Array | null;
}

export interface GoomConfig {
  width?: number;
  height?: number;
  /** the shell's engine options object (kept as this.options), read for GoomOptions' fields */
  options?: object;
  preset?: number;
  seed?: number;
}

class Goom {
  declare core: GoomCore;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: GoomOptions;
  declare surface: Surface;
  declare samples: Int16Array;
  declare seedValue: number;
  declare pendingTitle: string | null;
  declare idleCount: number;
  declare idleIndex: number;
  declare font: GoomFont | null;
  declare messages: string[] | null;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: GoomConfig) {
    cfg = cfg || {};
    this.options = cfg.options || {};
    const text = this.options.dll ? goomTextFromDll(this.options.dll) : null;
    this.font = text ? text.font : null;
    this.messages = text ? text.messages : null;
    this.samples = new Int16Array(1024);
    this.seedValue = cfg.seed === undefined ? 1 : cfg.seed >>> 0;
    this.preset = cfg.preset ? Math.min(3, Math.max(0, cfg.preset | 0)) : 0;
    this.resize(cfg.width || 320, cfg.height || 240);
    this.start();
  }

  /** SetCore: goom_init at 256x256, then the preset's resolution */
  private start(): void {
    this.core = new GoomCore(256, 256, this.seedValue);
    this.core.font = this.font;
    const [w, h] = SIZES[this.preset];
    this.core.setResolution(w, h);
    this.surface = { w, h, px: new Uint32Array(w * h) };
    this.frame = 0;
    this.pendingTitle = null;
    this.idleCount = 0;
    this.idleIndex = 0;
  }

  /** the random table's seed (what the DLL's heap address was); restarts the engine */
  seed(n: number): this { this.seedValue = n >>> 0; this.start(); return this; }

  /** the view's size: the engine draws at the preset's own size regardless */
  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    const [w, h] = SIZES[n];
    if (this.core.w !== w || this.core.h !== h) {
      this.core.setResolution(w, h);
      this.surface = { w, h, px: new Uint32Array(w * h) };
    }
    return true;
  }

  /** MediaInfo's title: shown from the next frame for 200 frames when showTitle */
  setTitle(title: string | null): void { this.pendingTitle = title; }

  /** 0x10002740: the credits' timer, counting only while not playing */
  private idleMessage(state: number): string | null {
    let msg: string | null = null;
    if (state === 2 && this.idleCount > 0x780) this.idleCount = 0;
    else if (this.idleCount === 0) this.idleCount = 0x7e4;
    else if (this.idleCount === 0x780) {
      const m = this.messages;
      msg = m ? m[this.idleIndex] : null;
      this.idleIndex = (this.idleIndex + 1) % 3;
    }
    if (this.idleCount > 0) this.idleCount--;
    return msg;
  }

  render(level: TimedLevel): Surface | null {
    if (!level) return this.surface || null;
    const s = this.samples, w0 = level.wave[0], w1 = level.wave[1];
    for (let i = 0; i < 512; i++) {
      s[i] = ((w0[i] ^ 0x80) << 24) >> 16;
      s[512 + i] = ((w1[i] ^ 0x80) << 24) >> 16;
    }
    const title = this.options.showTitle !== false ? this.pendingTitle : null;
    this.pendingTitle = null;
    const msg = this.idleMessage(level.state);
    const out = this.core.update(s, 0, -1.0, title, msg);
    const px = this.surface.px;
    for (let i = 0; i < out.length; i++) px[i] = out[i] & 0xffffff;
    this.frame++;
    return this.surface;
  }

  debug(): { engine: string; preset: number; presetName: string; size: string; frame: number; seed: number } {
    return { engine: 'Goom', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.surface.w + 'x' + this.surface.h, frame: this.frame, seed: this.seedValue };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    Goom: typeof Goom;
  }
}

A.Goom = Goom;
export { Goom };
