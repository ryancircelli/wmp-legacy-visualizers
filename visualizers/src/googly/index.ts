// Alchemy.GooglyMoogly — "Googly Moogly!" (GooglyMoogly.dll 1.0, n matlock / dfInteractive, 2005-07: a free third-party
// visualization for WMP 9 and 10). Render (0x0f301600) makes a memory DC the window's size, fills it black and draws
// one of three pictures with plain GDI, then BitBlts it to the window. No clock, no rand: each frame is the TimedLevel's
// first channel and nothing else.
//
//  - Googly Squares (draw mode 0): a 32x32 grid of rounded squares (0x0f301510), the window cut into 32 columns and
//    rows, centred; it walks the grid as a spiral from the bottom-left corner inwards (up, right, down, left), giving
//    the k-th square frequency bin k and waveform sample k: its luminance from the bin, its hue the base colour's
//    swung by the sample (shlwapi's 0-240 HLS).
//  - Frequency (mode 2) and Waveform (mode 3): one polyline in the base colour across the first 1023 columns, the
//    spectrum drawn downwards from y=5, the waveform about the middle at twice its scale.
//
// The DLL lists only Googly Squares (GetPresetCount says 1, and SetCurrentPreset 0x0f301a00 refuses anything but 0),
// so WMP never showed the other two; their names are its resource strings 103 and 104 and their drawing is Render's
// own, reached here as presets 1 and 2. Settings: the DLL's defaults (its registry read 0x0f301280 never finds the
// values it writes): base colour 0xd96d26, luminance variation 0.53, start 15, no wrap, hue variation 1.75.
import { A, type Surface, type TimedLevel } from '../ns';
import { Gdi } from '../gdi';

// ---- shlwapi ColorHLSToRGB (hue, luminance, saturation on 0..240): RGB as 0x00RRGGBB
function hueToRgb(n1: number, n2: number, h: number): number {
  if (h < 0) h += 240;
  if (h > 240) h -= 240;
  if (h < 40) return n1 + Math.trunc(((n2 - n1) * h + 20) / 40);
  if (h < 120) return n2;
  if (h < 160) return n1 + Math.trunc(((n2 - n1) * (160 - h) + 20) / 40);
  return n1;
}
export function hlsToRgb(h: number, l: number, s: number): number {
  // grey only for the "undefined" hue 160; any other hue at saturation 0 gives black
  if (s === 0) { const v = h === 160 ? Math.trunc((l * 255) / 240) : 0; return (v << 16) | (v << 8) | v; }
  const m2 = l <= 120 ? Math.trunc((l * (240 + s) + 120) / 240) : l + s - Math.trunc((l * s + 120) / 240);
  const m1 = 2 * l - m2;
  const c = (hh: number) => Math.trunc((hueToRgb(m1, m2, hh) * 255 + 120) / 240) & 255;
  return (c(h + 80) << 16) | (c(h) << 8) | c(h - 80);
}

/** a RoundRect's brush pixels (1) in its w x h box, drawn by the shared GDI (white brush, black pen) */
export function roundRectMask(w: number, h: number, ew: number, eh: number): Uint8Array {
  const g = new Gdi(w, h);
  g.roundRect(0, 0, w, h, ew, eh, 0xffffff, 0);
  return Uint8Array.from(g.px, (v) => (v === 0xffffff ? 1 : 0));
}

declare module '../ns' {
  interface AlchemyNS {
    GooglyMoogly: typeof GooglyMoogly;
  }
}

const PRESET_NAMES: string[] = ['Googly Squares', 'Frequency', 'Waveform'];

/** the base colour COLORREF 0xd96d26 (R 0x26, G 0x6d, B 0xd9), and its ColorRGBToHLS hue and saturation */
const BASE_COLORREF = 0xd96d26, BASE_HUE = 144, BASE_SAT = 168;
const LUM_VAR = 0.53, LUM_LOW = 15, HUE_VAR = 1.75;

export interface GooglyMooglyConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

class GooglyMoogly {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: Record<string, unknown>;
  private g: Gdi;
  private mask: Uint8Array | null = null;
  private frames = 0;

  constructor(cfg: GooglyMooglyConfig = {}) {
    this.w = Math.max(32, cfg.width || 640); this.h = Math.max(32, cfg.height || 480);
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.g = new Gdi(this.w, this.h);
    if (cfg.preset) this.setPreset(cfg.preset);
  }

  /** no randomness to seed */
  seed(_n: number): this { return this; }

  /** ponytail: at least 32x32, so every square has a size (the DLL would draw zero-width ones) */
  resize(w: number, h: number): void {
    w = Math.max(32, w | 0); h = Math.max(32, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.g = new Gdi(w, h);
    this.mask = null;
  }

  setPreset(n: number): boolean {
    if (n < 0 || n > 2) return false;
    this.preset = n | 0;
    return true;
  }

  render(level: TimedLevel): Surface | null {
    this.g.px.fill(0);                              // FillRect with the object's CreateSolidBrush(0)
    if (this.preset === 0) this.squares(level.freq[0], level.wave[0]);
    else if (this.preset === 1) this.polyline((i) => ((this.h * level.freq[0][i]) >> 8) + 5);
    else this.polyline((i) => ((this.h - (this.h >> 31)) >> 1) - 254 + 2 * level.wave[0][i]);
    this.frames++;
    return { w: this.w, h: this.h, px: this.g.px };
  }

  /** mode 0: the spiral of rounded squares (Render 0x0f3017b4) */
  private squares(freq: Uint8Array, wave: Uint8Array): void {
    const W = this.w, H = this.h, cw = W >> 5, ch = H >> 5;
    // every square is RoundRect(x, y, x+cw, y+ch, cw/2.5, ch/2.5): one shape, its pen black on black
    const m = this.mask ??= roundRectMask(cw, ch, Math.trunc(cw / 2.5), Math.trunc(ch / 2.5));
    const px = this.g.px;
    let i = 0;
    const cell = (x: number, y: number): void => {
      // 0x0f301510: luminance = bin * 0.53 + 15 (capped at 240), hue = base + (sample - 127) * 1.75, wrapped into 0..240
      let l = Math.trunc(freq[i] * LUM_VAR) + LUM_LOW;
      if (l > 240) l = 240;
      let hu = Math.trunc((wave[i] - 127) * HUE_VAR) + BASE_HUE;
      if (hu < 0) hu += 240;
      if (hu > 240) hu -= 240;
      i++;
      const rgb = hlsToRgb(hu, l, BASE_SAT);
      for (let r = 0, o = y * W + x, k = 0; r < ch; r++, o += W) {
        for (let c = 0; c < cw; c++, k++) if (m[k]) px[o + c] = rgb;
      }
    };
    let x = (W - cw * 32) >> 1, y = H - ((H - ch * 32) >> 1) - ch;
    for (let n = 32; n > 0; n -= 2) {
      for (let k = 0; k < n; k++) { cell(x, y); y -= ch; }
      y += ch; x += cw;
      for (let k = 0; k < n - 2; k++) { cell(x, y); x += cw; }
      for (let k = 0; k < n; k++) { cell(x, y); y += ch; }
      x -= cw;
      for (let k = 0; k < n - 2; k++) { cell(x, y - ch); x -= cw; }
      x += cw; y -= 2 * ch;
    }
  }

  /** modes 2 and 3: MoveToEx(0, y(0)), then LineTo(x, y(x+1)) for x < min(width, 1023), a cosmetic pen in the base colour */
  private polyline(yAt: (i: number) => number): void {
    const n = Math.min(this.w, 0x3ff);
    this.g.moveTo(0, yAt(0));
    for (let x = 0; x < n; x++) this.g.lineTo(x, yAt(x + 1), BASE_COLORREF);
  }

  debug(): Record<string, unknown> {
    return { engine: 'GooglyMoogly', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frames: this.frames };
  }
}

A.GooglyMoogly = GooglyMoogly;
export { GooglyMoogly };
