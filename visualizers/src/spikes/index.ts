// Alchemy.Spikes — Windows Media Player 7-10's "Spikes" (CLSID 4B657E70-08EF-11D3-9447-00A0C92A2F2D).
// Ported from WMP 9's wmp.dll (9.00.00.2980, x86, image base 0x07680000): object map creator 0x0797ff68,
// IWMPEffects vtable 0x07743dac, Render 0x0797f0a9. WMP 7.0/7.1 (wmpui.dll) and WMP 10 (wmp.dll) render the
// same pixels (checked frame by frame against all four DLLs).
//
// What it is: every Render clears its own window-sized DIB to the background colour and draws 256 spokes
// from the centre over a half turn, one per waveform sample 0..255, each as long as that sample's
// peak-held level; then BitBlts the DIB 1:1 to the HDC (capabilities 0: no surface of WMP's). No rand, no
// clock: the only inputs are the waveform bytes, the TimedLevel state and timestamp, the channel count
// MediaInfo gave, and the window size. "Spike" draws Bresenham lines, "Amoeba" only the spoke tips.
import { A, type Surface, type TimedLevel } from '../ns';

declare module '../ns' {
  interface AlchemyNS {
    Spikes: typeof Spikes;
  }
}

var PRESET_NAMES: string[] = ['Spike', 'Amoeba'];

// SetCurrentPreset 0x0797f868 sets four ISpikesEffect properties (the type library's names) through the
// object's own setters: displayMode 0x0797fb60 (obj+0x254c: 0 lines, 1 dots), fallbackSpeed 0x0797fbe6
// (float obj+0x2534), foregroundColor 0x0797fadd (obj+0x2540, an HTML colour string -> COLORREF, R in the
// low byte) and backgroundColor 0x0797fa5a (obj+0x2538: "#000000" in both presets).
// foregroundColor "#010000" (0x0797f9a0) / "#10FF10" (0x0797f9b4); fallbackSpeed 3.0 (0x0797f9b0) / 2.0 (0x077b5680).
var PRESETS = [
  { displayMode: 0, fallbackSpeed: 3.0, foregroundColor: 0x000001 },
  { displayMode: 1, fallbackSpeed: 2.0, foregroundColor: 0x10ff10 },
];

// The spoke angles: a double starting at 0.0 (0x07731f80) plus pi/256 (0x0797f860) per spoke, rounded to
// double each step (FADD / FSTP qword, 0x0797f591). The DLL takes FSIN/FCOS of it on the x87 and truncates
// (msvcrt _ftol) the product with the radius; for every radius up to 2048 no product lies within 1e-9 of an
// integer except at a = 0 and the spoke near pi/2 (sin rounds to exactly 1.0 either way), so the doubles
// below truncate identically.
var COS = new Float64Array(256), SIN = new Float64Array(256);
(function () {
  for (var i = 0, a = 0.0; i < 256; i++, a += 0.012271846303085117) { COS[i] = Math.cos(a); SIN[i] = Math.sin(a); }
})();

export interface SpikesOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
  /** 0xRRGGBB the player sets after every preset change, or null for the presets' own (red Spike, green
   *  Amoeba: what WMP 7 and 8 drew). WMP 9-11's Now Playing script (VIZ.JS SynchEffectColor) sets
   *  `foregroundColor` to the theme's item-playing colour on both presets: #89E116 in WMP 9, #A4EB0C in
   *  WMP 10 and 11 (their default themes). */
  foregroundColor?: number | null;
}

export interface SpikesConfig {
  width?: number;
  height?: number;
  options?: Partial<SpikesOptions>;
  preset?: number;
  /** MediaInfo's channel count (obj+0x1c): > 1 draws channel 0 on the upper half-turn and channel 1 on
   *  the lower; otherwise channel 0 mirrored top and bottom. 2 = what WMP passes for stereo media. */
  channels?: number;
}

// One DIB pixel (0x0797edd4 32 bpp: bytes B, G, R from the COLORREF), as Surface's 0x00RRGGBB.
function px32(colorref: number): number {
  return ((colorref & 0xff) << 16) | (colorref & 0xff00) | ((colorref >>> 16) & 0xff);
}

// 0x0797ef64: the end point is clamped into the DIB (the start, the centre, never needs it), then a
// Bresenham walk whose error term starts at HALF THE MINOR delta (not the major one) and steps the minor
// axis when it reaches the major delta.
function line(S: Surface, x0: number, y0: number, x1: number, y1: number, c: number): void {
  var W = S.w, H = S.h, px = S.px;
  if (x1 >= W) x1 = W - 1;
  if (x1 < 0) x1 = 0;
  if (y1 >= H) y1 = H - 1;
  if (y1 < 0) y1 = 0;
  var dx = x1 - x0, dy = y1 - y0;
  var adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
  var sx = dx < 0 ? -1 : dx > 0 ? 1 : 0, sy = dy < 0 ? -1 : dy > 0 ? 1 : 0;
  var x = x0, y = y0, e, k;
  px[y * W + x] = c;
  if (adx >= ady) {
    for (e = ady >> 1, k = adx; k > 0; k--) {
      e += ady;
      if (e >= adx) { e -= adx; y += sy; }
      x += sx;
      px[y * W + x] = c;
    }
  } else {
    for (e = adx >> 1, k = ady; k > 0; k--) {
      e += adx;
      if (e >= ady) { e -= ady; x += sx; }
      y += sy;
      px[y * W + x] = c;
    }
  }
}

class Spikes {
  static PRESET_NAMES = PRESET_NAMES;

  options: SpikesOptions;
  preset = 0;
  channels: number;
  /** 0 = lines (Spike), 1 = dots (Amoeba); obj+0x254c */
  displayMode = 0;
  /** how far a held level falls per frame, float32 at obj+0x2534 (ctor 3.0) */
  fallbackSpeed = 3.0;
  /** COLORREF, obj+0x2540 (ctor 0x10, before any SetCurrentPreset) */
  foregroundColor = 0x10;
  /** the peak-held levels, float32 [channel][1024] at obj+0x534 (only 0..255 are used), ctor 64.0 */
  level = new Float32Array(2048).fill(64);
  /** the last Render's TimedLevel timestamp (obj+0x2558), ctor 0 */
  lastTimeStamp = 0;
  /** obj+0x2550: no new audio this frame (paused, or the same timestamp again): levels are read, not updated */
  hold = false;
  frame = 0;
  w = 1;
  h = 1;
  surface: Surface;

  constructor(cfg?: SpikesConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.channels = cfg.channels ?? 2;
    this.surface = { w: 1, h: 1, px: new Uint32Array(1) };
    this.setPreset((cfg.preset as number) | 0);
    this.resize(cfg.width || 640, cfg.height || 480);
  }

  seed(n: number): this { return this; }   // no rand() anywhere in the class

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESETS.length) return false;     // E_INVALIDARG
    var p = PRESETS[n];
    this.preset = n;
    this.displayMode = p.displayMode; this.fallbackSpeed = p.fallbackSpeed; this.foregroundColor = p.foregroundColor;
    // then the player's colour, as WMP 9-11 set it after SetCurrentPreset (put_foregroundColor: COLORREF)
    var fg = this.options.foregroundColor;
    if (fg != null) this.foregroundColor = ((fg & 0xff) << 16) | (fg & 0xff00) | ((fg >>> 16) & 0xff);
    return true;                                         // levels and timestamp are kept
  }

  /** IWMPEffects::MediaInfo 0x0797ee62: only the channel count is kept. */
  mediaInfo(channels: number): void { this.channels = channels | 0; }

  // The DLL re-creates its DIB (0x076c2b5b) when the rect or the display depth changes; nothing else resets.
  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.surface = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
  }

  // 0x0797ed47: the waveform byte halved (0..127, silence 64), peak-held: a higher sample replaces the held
  // level and is returned; otherwise the held level (truncated, at least 64) is returned, then falls by
  // fallbackSpeed (FSUB / FSTP dword: float32).
  // Holding (no new audio), the held level is returned as it is, below 64 too.
  value(wave: Uint8Array, ch: number, i: number): number {
    var k = ch * 1024 + i, held = this.level[k];
    if (this.hold) return held | 0;
    var v = wave[i] >> 1;
    if (v > held) { this.level[k] = v; return v; }
    this.level[k] = Math.fround(held - this.fallbackSpeed);
    var r = held | 0;
    return r < 64 ? 64 : r;
  }

  // The spoke colour: each foreground channel that is not 0 becomes channel + 4v - 180, capped at 255 but
  // not floored (a negative one keeps its low byte, as MOV BH,AL / MOVZX do); channels that are 0 stay 0.
  color(v: number): number {
    var fg = this.foregroundColor, r = fg & 0xff, g = (fg >> 8) & 0xff, b = (fg >> 16) & 0xff;
    r = r ? r + 4 * v - 180 : 0; g = g ? g + 4 * v - 180 : 0; b = b ? b + 4 * v - 180 : 0;
    if (r >= 255) r = 255;
    if (g >= 255) g = 255;
    if (b >= 255) b = 255;
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  }

  // Amoeba's tip (0x0797edd4 called directly): no clipping in the DLL; |radius| < min(w, h) / 2 keeps it
  // inside for every level the class can hold (-fallbackSpeed..127). The guard only matters for a hand-set
  // fallbackSpeed.
  dot(x: number, y: number, c: number): void {
    var S = this.surface;
    if (x >= 0 && x < S.w && y >= 0 && y < S.h) S.px[y * S.w + x] = c;
  }

  // ---- Render 0x0797f0a9 ----
  render(L: TimedLevel | null): Surface | null {
    var S = this.surface;
    if (!L) return S;
    var bg = this.options.backgroundColor & 0xffffff;    // the presets' "#000000" unless the shell picks one
    if (L.state === 0) { S.px.fill(bg); return S; }      // stopped: FillRect(bg) on the HDC and return
    this.hold = L.state === 1 || L.timeStamp === this.lastTimeStamp;
    this.frame++;
    var W = this.w, H = this.h, m = W < H ? W : H;
    var cx = W >> 1, cy = H >> 1, dots = this.displayMode !== 0, i, v, c, rad, x, t;
    S.px.fill(bg);                                       // 0x077156d4: the whole DIB to the background colour
    if (this.channels > 1) {
      for (i = 0; i < 256; i++) {
        v = this.value(L.wave[0], 0, i); c = this.color(v); rad = (m * v) >> 8;
        x = cx + ((COS[i] * rad) | 0); t = (SIN[i] * rad) | 0;
        if (dots) this.dot(x, cy - t, c); else line(S, cx, cy, x, cy - t, c);
        // channel 1 at -a (FCHS, 0x0797f4d2): cos(-a) = cos(a), sin(-a) = -sin(a)
        v = this.value(L.wave[1], 1, i); c = this.color(v); rad = (m * v) >> 8;
        x = cx + ((COS[i] * rad) | 0); t = (SIN[i] * rad) | 0;
        if (dots) this.dot(x, cy + t, c); else line(S, cx, cy, x, cy + t, c);
      }
    } else {
      for (i = 0; i < 256; i++) {
        v = this.value(L.wave[0], 0, i); c = this.color(v); rad = (m * v) >> 8;
        x = cx + ((COS[i] * rad) | 0); t = (SIN[i] * rad) | 0;
        if (dots) { this.dot(x, cy - t, c); this.dot(x, cy + t, c); }
        else { line(S, cx, cy, x, cy - t, c); line(S, cx, cy, x, cy + t, c); }
      }
    }
    this.lastTimeStamp = L.timeStamp;
    return S;
  }

  debug() {
    return {
      engine: 'Spikes', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      channels: this.channels, displayMode: this.displayMode, fallbackSpeed: this.fallbackSpeed,
      foregroundColor: '#' + ('000000' + px32(this.foregroundColor).toString(16)).slice(-6),
      frame: this.frame, hold: this.hold, level0: this.level[0], level1: this.level[1024],
    };
  }
}

A.Spikes = Spikes;
export { Spikes };
