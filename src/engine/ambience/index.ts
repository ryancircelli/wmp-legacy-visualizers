// Alchemy.Ambience — Windows Media Player 7-10's "Ambience" visualization (internally "Assault"; WMP 10
// wmp.dll creator 0x0786d2d9 -> CAssault 0x0786cf1f, WMP 9 0x07971e9f -> 0x07971b5f). Bit-exact port of
// WMP 10 (presets 0-13). The older builds differ in three places, ported as extra presets (14-23): WMP 7-9
// keep the ring scopes' trig in doubles (see ringScope; "Swirl (WMP 7-9)" etc.), WMP 7-8 draw one more
// rand() in Niagara's last phase ("Niagara (WMP 7-8)"), and WMP 7/7.1 has no Thingus, so its Random picks
// among 12. WMP 11 ships no Ambience code.
// VAs: WMP 10 first, WMP 9 in brackets.
//
// One 8-bit surface pair (default 256x192, the "Assault_Resolution" setting 0; 384x288 and 512x384 are the
// others), ping-ponged through: a per-preset displacement map (maps.ts), a 5-tap average through a
// 1280-entry fade LUT, an edge LUT, and audio draws (scopes, rings, lines, sparkles). A 254-entry palette
// (entries 1..254; 0 and 255 stay black) is two 127-step gradients between four colours, cross-faded
// between 26 fixed sets. The DIB is bottom-up: the surfaces are kept in memory order (row 0 = bottom)
// and flipped only when the frame is handed out.
//
// No clock: animation is per Render. rand() (MSVC LCG, rand.ts) drives the palette scheduler, beats'
// side effects and Random's preset choice; Random alone seeds it, srand(time(NULL)) in its init.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';
import { swirlMap, zoomMap, falloffMap, rippleMap, bubbleMap, dizzyMap, niagaraMap, blenderMap, thingusMap, trigTrunc } from './maps';

const F = Math.fround;
const sin = Math.sin, cos = Math.cos;
const F256 = 0.00390625;                       // float 1/256
const F255 = F(1 / 255);                       // float 0x3b808081
const K127 = F(1 / 127);                       // [0x0785b83c] 0.007874015718698502
const PI_F = F(3.14159);                       // 0x077460e4 [0x0785ea6c] 3.141590118408203
const HALF_PI_F = F(1.570795);                 // 1.5707950592041016
const QUARTER_PI_BITS = new Float32Array(new Uint32Array([0x3f490fd0]).buffer)[0];

const PRESET_NAMES = ['Random', 'Swirl', 'Warp', 'Anon', 'Falloff', 'Water', 'Bubble', 'Dizzy', 'Windmill',
  'Niagara', 'Blender', 'X Marks the Spot', 'Down the Drain', 'Thingus',
  'Random (WMP 7)', 'Random (WMP 8)', 'Random (WMP 9)', 'Swirl (WMP 7-9)', 'Warp (WMP 7-9)', 'Anon (WMP 7-9)',
  'Water (WMP 7-9)', 'Bubble (WMP 7-9)', 'Dizzy (WMP 7-9)', 'Niagara (WMP 7-8)'];
/** preset index -> [the DLL's preset, WMP 7-9 double trig, WMP 7-8 Niagara, how many presets Random picks among] */
type Variant = [number, boolean, boolean, number];
const VARIANTS: Variant[] = PRESET_NAMES.map((_, i): Variant =>
  i < 14 ? [i, false, false, 13]
    : i === 14 ? [0, true, true, 12] : i === 15 ? [0, true, true, 13] : i === 16 ? [0, true, false, 13]
      : i === 23 ? [9, false, true, 13] : [[1, 2, 3, 5, 6, 7][i - 17], true, false, 13]);

/** "Assault_Resolution" 0..2, 0x079a4c98 [0x07a60cf0]. */
const RESOLUTIONS = [[256, 192], [384, 288], [512, 384]];

// The 26 colour sets, 4 x 0x00BBGGRR (byte 0 = red): entries 1..127 run c0 -> c1, 128..254 c2 -> c3.
// Presets fade within 0..12 (Swirl) or 13..25 (all the others; Water, Bubble, Niagara switch between).
const PALS = new Uint32Array([
  0x600000, 0xff9070, 0x600000, 0xffffff, 0x006000, 0x70ff90, 0x006000, 0xffffff,
  0x000060, 0x7090ff, 0x000060, 0xffffff, 0x600060, 0xff70ff, 0x600060, 0xffffff,
  0x606000, 0xffff70, 0x606000, 0xffffff, 0x006060, 0x70ffff, 0x006060, 0xffffff,
  0x606060, 0xffffff, 0x606060, 0xffffff, 0x000000, 0x0000ff, 0x000000, 0xffffff,
  0x000000, 0x00ff00, 0x000000, 0xffffff, 0x000000, 0xff0000, 0x000000, 0xffffff,
  0x000000, 0xff00ff, 0x000000, 0xffffff, 0x000000, 0xffff00, 0x000000, 0xffffff,
  0x000000, 0x00ffff, 0x000000, 0xffffff, 0x000060, 0x7090ff, 0x7090ff, 0xffffff,
  0x006000, 0x70ff90, 0x70ff90, 0xffffff, 0x600000, 0xff9070, 0xff9070, 0xffffff,
  0x600060, 0xff70ff, 0xff70ff, 0xffffff, 0x606000, 0xffff70, 0xffff70, 0xffffff,
  0x006060, 0x70ffff, 0x70ffff, 0xffffff, 0x606060, 0xa0a0a0, 0xa0a0a0, 0xffffff,
  0x000000, 0x0000ff, 0x0000ff, 0xffffff, 0x000000, 0x00ff00, 0x00ff00, 0xffffff,
  0x000000, 0xff0000, 0xff0000, 0xffffff, 0x000000, 0xff00ff, 0xff00ff, 0xffffff,
  0x000000, 0xffff00, 0xffff00, 0xffffff, 0x000000, 0x00ffff, 0x00ffff, 0xffffff,
]);

/** LerpColor 0x0759bf08 [0x07798052]: per byte a + trunc((b - a) * t), t float; byte 3 cleared. */
function lerpColor(a: number, b: number, t: number): number {
  let o = 0;
  for (let s = 16; s >= 0; s -= 8) {
    const ca = (a >>> s) & 255, d = ((((b >>> s) & 255) - ca) * t) | 0;
    o |= ((ca + d) & 255) << s;
  }
  return o;
}

export interface AmbienceConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
  /** what IWMPEffects::MediaInfo reported (WMP passes the stream's channel count; 2 for stereo) */
  channels?: number;
}

class Ambience {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  static RESOLUTIONS: number[][] = RESOLUTIONS;
  declare presetNames: string[];

  options: Record<string, unknown>;
  channels: number;
  preset = 0;                                  // index into PRESET_NAMES
  base = 0;                                    // the DLL's preset it runs (obj+0x6a8)
  v9 = false;                                  // WMP 7-9 ring trig
  oldNiagara = false;                          // WMP 7-8 Niagara
  rndN = 13;                                   // Random's choices
  w = 0; h = 0; cx = 0; cy = 0;
  cur!: Uint8Array; other!: Uint8Array;       // obj+0xc64 / +0xc68: the surface Render blits / its twin
  pending = true;                              // surfaces not created yet (the DLL does it in the 1st Render)
  // palette, obj+0x83c: the blit BITMAPINFO's RGBQUADs (B, G, R, 0)
  pal = new Uint8Array(1024);
  pal32 = new Uint32Array(256);
  lerp = new Uint32Array(4);                   // +0x800 the colours of the fade in progress
  snap = new Uint32Array(4);                   // +0x810 their copy when a fade is interrupted
  target: Uint32Array; from: Uint32Array;     // +0x820 / +0x824
  fadeT = 0; fadeStep = 0; fading = false;     // +0x828 float, +0x82c float, +0x830
  palCountdown = 200; palBase = 0;             // +0x834, +0x838
  lut = new Uint8Array(256);                   // +0x117c edge / decay LUT
  lut2 = new Uint8Array(256);                  // +0x1545 Dizzy's copy
  fade = new Uint8Array(1280);                 // +0xc7c the blur's sum-of-5 LUT
  peak0 = 0xff; peak1 = 0xff;                  // +0x127c/d beat A
  hist = new Int32Array(80); histPos = 0;      // +0x1284/+0x1280 beat B
  stopCount = 300;                             // +0x7f0
  maps: Record<string, Int32Array> = {};
  mapKey = '';
  // Random, +0x13c4/+0x13c8/+0x13cc
  rndCount = 0; rndLimit = 0; rndSub = 1;
  // per preset
  anonFlag = 1; waterFlag = 1; bubbleFlag = 1; dizzyFlag = 1; blendFlag = 1; xFlag = 1; drainFlag = 1;
  windAngle = 0; xAngle = 0; thingAngle = 0;
  niaMode = 0; niaPos = 0; niaFlag = 1;
  drainK = 0.75; drainAngle = 0; drainGrid = 0;
  frame = 0;
  last: Surface | null = null;
  out: Uint32Array = new Uint32Array(0);

  constructor(cfg?: AmbienceConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.channels = cfg.channels === undefined ? 2 : cfg.channels | 0;
    this.target = this.from = PALS.subarray(0, 4);
    // CAssault ctor 0x0786c350 [0x07970fa4]: palette from set 0, the plain LUT and fade
    this.buildPalette(this.target);
    this.decayLut(1, 0xfe, 1);
    this.fadeLut(false);
    this.setSize(cfg.width || RESOLUTIONS[0][0], cfg.height || RESOLUTIONS[0][1]);
    // WMP calls SetCurrentPreset once before the first Render; Random seeds the CRT there
    this.setPreset(cfg.preset ? cfg.preset | 0 : 0);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  setSize(w: number, h: number): void {
    this.w = Math.max(16, w | 0); this.h = Math.max(16, h | 0);
    this.cx = this.w >> 1; this.cy = this.h >> 1;
    this.out = new Uint32Array(this.w * this.h);
  }

  /** SetResolution 0x0786bfa5 [0x07970c3b]: new surfaces, both filled with 1, the preset re-initialised. */
  resize(w: number, h: number): void {
    this.setSize(w, h);
    this.create();
  }

  create(): void {
    this.cur = new Uint8Array(this.w * this.h).fill(1);
    this.other = new Uint8Array(this.w * this.h).fill(1);
    this.pending = false;
    this.initPreset(this.base);
  }

  /** SetCurrentPreset 0x0786bf75 [0x07970c0f]: an out-of-range index is refused (E_INVALIDARG), else the preset's init runs. */
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    [this.base, this.v9, this.oldNiagara, this.rndN] = VARIANTS[n]!;
    this.initPreset(this.base);
    return true;
  }

  // ---------------------------------------------------------------- palette
  /** 0x07867db9 [0x0796ca18]: entries 1..127 c0 -> c1, 128..254 c2 -> c3, i*(b-a)/127 truncated. */
  buildPalette(c: Uint32Array): void {
    const P = this.pal;
    for (let seg = 0; seg < 2; seg++) {
      const a = c[seg * 2], b = c[seg * 2 + 1];
      const d0 = ((b & 255) - (a & 255)) * K127;
      const d1 = (((b >> 8) & 255) - ((a >> 8) & 255)) * K127;
      const d2 = (((b >> 16) & 255) - ((a >> 16) & 255)) * K127;
      for (let i = 0; i < 127; i++) {
        const o = (1 + seg * 127 + i) * 4;
        P[o] = (i * d2 | 0) + (a >> 16);
        P[o + 1] = (i * d1 | 0) + (a >> 8);
        P[o + 2] = (i * d0 | 0) + a;
      }
    }
    for (let i = 0; i < 256; i++) this.pal32[i] = (P[i * 4 + 2] << 16) | (P[i * 4 + 1] << 8) | P[i * 4];
  }

  /** 0x07867d5c [0x0796c9bf]: start a fade to set `to` over `dur` Renders. */
  startFade(to: Uint32Array, dur: number): void {
    if (this.fading) { this.snap.set(this.lerp); this.from = this.snap; } else this.from = this.target;
    this.fadeT = 0;
    this.target = to;
    this.fading = true;
    this.fadeStep = F(1 / dur);
  }

  /** 0x07869f8e [0x0796ec3e], once per playing Render while a fade runs. The end test sees the
   *  unrounded sum, the lerp the float it was stored as. */
  fadeStepRender(): void {
    const s = this.fadeStep + this.fadeT;
    this.fadeT = F(s);
    if (!(s < 1)) {
      this.fadeT = 1; this.fading = false;
      this.buildPalette(this.target);
      return;
    }
    const t = this.fadeT, o = this.from, n = this.target, L = this.lerp;
    L[0] = lerpColor(o[0], n[0], t); L[2] = lerpColor(o[2], n[2], t);
    L[1] = lerpColor(o[1], n[1], t); L[3] = lerpColor(o[3], n[3], t);
    this.buildPalette(L);
  }

  /** The palette scheduler 0x07869efa [0x0796ebaf], top of every preset: a new set from base..base+count-1
   *  at once when the preset's group changes, else every rand()%500+100 Renders between fades. */
  schedulePalette(base: number, count: number): void {
    if (this.palBase === base) {
      if (this.fading) return;
      if (--this.palCountdown > 0) return;
    }
    this.palCountdown = A.rand() % 500 + 100;
    const dur = this.palBase === base ? A.rand() % 800 + 200 : 200;
    const i = A.rand() % count + base;
    this.startFade(PALS.subarray(i * 4, i * 4 + 4), dur);
    this.palBase = base;
  }

  // ---------------------------------------------------------------- LUTs
  /** 0x07868076 [0x0796cd01]: lut[i] = max(1, i - d) for lo..hi. */
  decayLut(lo: number, hi: number, d: number): void {
    for (let i = lo; i <= hi; i++) this.lut[i] = i - d < 1 ? 1 : (i - d) & 255;
  }

  /** 0x078680b9 [0x0796cd42]: fade[sum] = sum/5 (through the decay LUT), kept within 1..254. */
  fadeLut(useLut: boolean): void {
    for (let j = 0; j < 1280; j++) {
      let v = (j / 5) | 0;
      if (useLut) v = this.lut[v];
      v &= 255;
      this.fade[j] = v === 0 ? 1 : v === 255 ? 254 : v;
    }
  }

  // ---------------------------------------------------------------- beats
  /** 0x07867f6b [0x0796cbd7]: freq[0][1], freq[0][2] against slowly decaying peaks (bytes, +10 wraps). */
  beatA(L: TimedLevel): boolean {
    if (this.peak0 > 200) this.peak0--;
    if (this.peak1 > 170) this.peak1--;
    const a = L.freq[0][1], b = L.freq[0][2];
    if (this.peak0 < a) this.peak0 = a;
    if (this.peak1 < b) this.peak1 = b;
    if (this.peak0 === a && this.peak1 === b) {
      this.peak1 = (this.peak1 + 10) & 255; this.peak0 = (this.peak0 + 10) & 255;
      return true;
    }
    return false;
  }

  /** 0x07867ff4 [0x0796cc80]: sum of freq[0][1..16] above more than 60 of the last 80 sums. */
  beatB(L: TimedLevel): boolean {
    const f = L.freq[0];
    let s = 0, n = 0, hit = false;
    for (let i = 1; i <= 16; i++) s += f[i];
    for (let i = 0; i < 80; i++) if (s > this.hist[i] && ++n > 60) { hit = true; break; }
    this.hist[this.histPos] = s;
    if (++this.histPos === 80) this.histPos = 0;
    return hit;
  }

  // ---------------------------------------------------------------- surface passes
  swap(): void { const t = this.cur; this.cur = this.other; this.other = t; }

  /** 0x07883b3c [0x07987a36]: dst[i] = src[map[i]]. */
  warp(src: Uint8Array, dst: Uint8Array, m: Int32Array): void {
    for (let i = 0, n = m.length; i < n; i++) dst[i] = src[m[i]];
  }

  /** 0x07883ba9 [0x07987a95]: interior pixels = fade[sum of the 5-point cross]; the border is not written. */
  blur(src: Uint8Array, dst: Uint8Array): void {
    const w = this.w, h = this.h, T = this.fade;
    for (let y = 1; y < h - 1; y++) {
      for (let i = y * w + 1, e = y * w + w - 1; i < e; i++)
        dst[i] = T[src[i + 1] + src[i - w] + src[i + w] + src[i - 1] + src[i]];
    }
  }

  /** 0x07883c71 [0x07987b4f]: the border through a LUT, in place. */
  edges(s: Uint8Array, T: Uint8Array): void {
    const w = this.w, h = this.h;
    for (let x = 0; x < w; x++) s[x] = T[s[x]];
    for (let y = 1; y < h - 1; y++) { s[y * w] = T[s[y * w]]; s[y * w + w - 1] = T[s[y * w + w - 1]]; }
    for (let i = (h - 1) * w; i < h * w; i++) s[i] = T[s[i]];
  }

  put(x: number, y: number, c: number): void { this.cur[y * this.w + x] = c; }

  /** 0x07883a91 [0x07987993]: the DLL's DDA (error compared against the major delta, not twice it). */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const s = this.cur, w = this.w;
    let p = y0 * w + x0, dy = y1 - y0, sy = w, dx = x1 - x0, sx = 1, e = 0, n: number;
    if (dy < 0) { dy = -dy; sy = -w; }
    if (dx < 0) { dx = -dx; sx = -1; }
    if (dy < dx) {
      for (n = dx + 1; n > 0; n--) { s[p] = c; e += dy; p += sx; if (dx < e) { e -= dx; p += sy; } }
    } else {
      for (n = dy + 1; n > 0; n--) { s[p] = c; e += dx; p += sy; if (dy < e) { e -= dy; p += sx; } }
    }
  }

  /** 0x07883d90 [0x07987c6a]: the line with both ends clamped to the surface (x0 arrives in EDX). */
  lineClamped(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const w = this.w, h = this.h;
    if (x0 < 0) x0 = 0; else if (x0 >= w) x0 = w - 1;
    if (y0 < 0) y0 = 0; else if (y0 >= h) y0 = h - 1;
    if (x1 < 0) x1 = 0; else if (x1 >= w) x1 = w - 1;
    if (y1 < 0) y1 = 0; else if (y1 >= h) y1 = h - 1;
    this.line(x0, y0, x1, y1, c & 255);
  }

  border(c: number): void {
    const w = this.w, h = this.h;
    this.line(0, 0, w - 1, 0, c); this.line(0, h - 1, w - 1, h - 1, c);
    this.line(0, 0, 0, h - 1, c); this.line(w - 1, 0, w - 1, h - 1, c);
  }

  wave2(L: TimedLevel): Uint8Array { return this.channels === 2 ? L.wave[1] : L.wave[0]; }

  // ---------------------------------------------------------------- draws
  /** Circle scope 0x07868efb [0x0796db6a]: 255 spokes around the centre, radius rIn + (rOut-rIn)*s,
   *  colour lo + (hi-lo+1)*s, alternately a dot and a line from the centre (dots off when lineOnly);
   *  channel 1 above the centre on screen (the DIB is bottom-up), channel 2 mirrored below. WMP 10 keeps
   *  the spoke's cos/sin as floats, WMP 7-9 as doubles; channel 1's y uses the unrounded sin in both. */
  ringScope(L: TimedLevel, rOut: number, rIn: number, lo: number, hi: number, lineOnly: boolean): void {
    const wa = L.wave[0], wb = this.wave2(L), cx = this.cx, cy = this.cy, hh = (this.h / 2) | 0;
    const crf = F((hi & 255) - (lo & 255) + 1), rrf = F(rOut - rIn), v9 = this.v9;
    let dot = true;
    for (let i = 1; i < 256; i++) {
      const ang = i * F256 * PI_F;
      const sn = wa[i - 1] * F256;
      const col = ((crf * sn) | 0) + lo;
      const rad = ((rrf * sn) | 0) + rIn;
      const c = v9 ? cos(ang) : F(cos(ang)), se = sin(ang), ss = v9 ? se : F(se);
      const x = ((c * rad) | 0) + cx, y = trigTrunc(true, ang, rad) + cy;
      if (dot && !lineOnly) this.put(x, y, col & 255); else this.lineClamped(cx, cy, x, y, col);
      const sn2 = wb[i - 1] * F256;
      const col2 = ((crf * sn2) | 0) + lo;
      const rad2 = ((rrf * sn2) | 0) + rIn;
      const x2 = ((c * rad2) | 0) + cx, y2 = hh - ((ss * rad2) | 0);
      if (dot && !lineOnly) this.put(x2, y2, col2 & 255); else this.lineClamped(cx, cy, x2, y2, col2);
      dot = !dot;
    }
  }

  /** Ring 0x07869260 [0x0796df24]: a closed-ish polyline of radius r0 + R*s, coloured lo + (hi-lo)*s;
   *  the same float/double split as ringScope. */
  ring(L: TimedLevel, R: number, r0: number, lo: number, hi: number): void {
    const wa = L.wave[0], wb = this.wave2(L), cx = this.cx, cy = this.cy, hh = (this.h / 2) | 0;
    const Rf = F(R), span = (hi - lo) & 255, v9 = this.v9;
    let px1 = 0, py1 = 0, px2 = 0, py2 = 0;
    for (let i = 1; i < 256; i++) {
      const ang = i * F256 * PI_F;
      const sn = wa[i - 1] * F256;
      const rad = ((Rf * sn) | 0) + r0;
      const c = v9 ? cos(ang) : F(cos(ang)), se = sin(ang), ss = v9 ? se : F(se);
      const x = ((c * rad) | 0) + cx, y = trigTrunc(true, ang, rad) + cy;
      if (i !== 1) this.lineClamped(px1, py1, x, y, ((span * sn) | 0) + lo);
      py1 = y; px1 = x;
      const sn2 = wb[i - 1] * F256;
      const rad2 = ((Rf * sn2) | 0) + r0;
      const x2 = ((c * rad2) | 0) + cx, y2 = hh - ((ss * rad2) | 0);
      if (i !== 1) this.lineClamped(px2, py2, x2, y2, ((span * sn2) | 0) + lo);
      px2 = x2; py2 = y2;
    }
  }

  /** Waveform 0x078690f1 [0x0796dd90]: a horizontal scope from x0 to x1 around yc, amplitude A. Up to
   *  256 columns it steps through the samples with a float accumulator (the index from the unrounded
   *  sum), wider it plots 255 samples spread over the span. */
  waveLine(wave: Uint8Array, yc: number, x0: number, x1: number, amp: number, c: number): void {
    const scale = F(amp * F256), base = yc - (amp >> 1);
    let py = ((wave[0] * scale) | 0) + base;
    if (this.w <= 256) {
      const step = F(256 / (x1 - x0) * F256);
      let acc = 0;
      for (let x = x0 + 1; x < x1; x++) {
        const s = step + acc;
        acc = F(s);
        const y = ((wave[(s * 256) | 0] * scale) | 0) + base;
        this.line(x - 1, py, x, y, c);
        py = y;
      }
    } else {
      const span = F(x1 - x0);
      let px = x0;
      for (let i = 1; i < 256; i++) {
        const x = ((i * F256 * span) | 0) + x0, y = ((wave[i] * scale) | 0) + base;
        this.line(px, py, x, y, c);
        px = x; py = y;
      }
    }
  }

  /** Line scope 0x07869403 [0x0796e0c5]: 256 samples along (x0,y0)->(x1,y1), displaced across it. */
  lineScope(wave: Uint8Array, x0: number, y0: number, x1: number, y1: number, amp: number, c: number): void {
    const dy = y1 - y0, dx = x1 - x0;
    const ang = Math.atan2(dy, dx) + HALF_PI_F;
    const cs = F(cos(ang)), sn = F(sin(ang));
    const half = Math.sqrt(dx * dx + dy * dy) * 0.5;
    const step = half * F256 / half;
    const ampf = F(amp), hA = amp >> 1;
    let v = ((wave[0] * F255 * ampf) | 0) - hA;
    let px = ((cs * v) | 0) - ((dx * 0) | 0) + x0, py = ((v * sn) | 0) - ((dy * 0) | 0) + y0;
    let t = step;
    for (let i = 1; i < 256; i++) {
      v = ((wave[i] * F255 * ampf) | 0) - hA;
      const x = ((dx * t) | 0) + ((cs * v) | 0) + x0;
      const y = ((dy * t) | 0) + ((v * sn) | 0) + y0;
      this.lineClamped(px, py, x, y, c);
      px = x; py = y;
      t = t + step;
    }
  }

  /** 0x0786a056 [0x0796ecfa]: lineScope through (cx', cy') at angle a (float), len long. */
  spinScope(wave: Uint8Array, a: number, len: number, cx: number, cy: number, amp: number, c: number): void {
    const a2 = a + PI_F, half = len >> 1;
    const y1 = cy + trigTrunc(true, a2, half), x1 = cx + trigTrunc(false, a2, half);
    const y0 = cy + trigTrunc(true, a, half), x0 = cx + trigTrunc(false, a, half);
    this.lineScope(wave, x0, y0, x1, y1, amp, c);
  }

  /** Windmill, X Marks, Thingus: n = w*h*k little crosses scattered around the centre. */
  sparkles(k: number): void {
    const w = this.w, h = this.h, cx = this.cx, cy = this.cy;
    for (let i = 0; i < ((w * h * k) | 0); i++) {
      const rx = A.rand() % (w - 2) - cx, ry = A.rand() % (h - 2) - cy;
      const X = ((A.rand() % 10 * 0.1 * rx) | 0) + cx;
      const Y = ((A.rand() % 10 * 0.1 * ry) | 0) + cy;
      this.put(X - 1, Y, 0xb4); this.put(X, Y - 1, 0xb4); this.put(X, Y + 1, 0xb4);
      this.put(X + 1, Y, 0xb4); this.put(X, Y, 0xfe);
    }
  }

  // ---------------------------------------------------------------- presets
  map(key: string, build: () => Int32Array): void {
    if (!this.maps[key]) this.maps[key] = build();
  }

  /** Per-preset init 0x0786a0d1 [0x0796ed7a] (SetCurrentPreset, a resolution change, Random's pick). */
  initPreset(n: number): void {
    if (n === 0) {                               // 0x078695a8 [0x0796e2a0]
      A.srand((Date.now() / 1000) | 0);
      this.rndCount = this.rndLimit + 1;
      return;
    }
    if (this.pending) return;                    // the maps need the surface stride; rebuilt on create()
    const w = this.w, h = this.h, s = this.w, key = w + 'x' + h;
    if (key !== this.mapKey) { this.maps = {}; this.mapKey = key; }
    switch (n) {
      case 1: this.decayLut(1, 0x7f, 4); this.decayLut(0x80, 0xfe, 2); this.fadeLut(true);
        this.map('swirl', () => swirlMap(w, h, s, F(0.07), 1)); break;
      case 2: this.decayLut(1, 0xfe, 1); this.fadeLut(false);
        this.map('warp', () => zoomMap(w, h, s, F(-0.07), F(w * F(0.05)))); break;
      case 3: this.decayLut(1, 0xfe, 2); this.fadeLut(true);
        this.map('anonA', () => zoomMap(w, h, s, F(0.04), F(w * F(0.05))));
        this.map('anonB', () => zoomMap(w, h, s, F(-0.04), F(w * F(0.05))));
        this.anonFlag = 1; break;
      case 4: this.decayLut(1, 0xfe, 2); this.fadeLut(true);
        this.map('falloff', () => falloffMap(w, h, s, F(-0.05), F(-(w * F(0.01))))); break;
      case 5: this.decayLut(1, 0xfe, 1); this.fadeLut(true);
        this.map('water', () => rippleMap(w, h, s, F(-0.005), F(h * F(0.1))));
        this.waterFlag = 1; break;
      case 6: this.decayLut(1, 0xfe, 2); this.fadeLut(true);
        this.map('bubble', () => bubbleMap(w, h, s, 0));
        this.bubbleFlag = 1; break;
      case 7: this.decayLut(1, 0xfe, 8); this.lut2.set(this.lut); this.decayLut(1, 0xfe, 1); this.fadeLut(true);
        this.map('dizzyA', () => dizzyMap(w, h, s, F(-0.05)));
        this.map('dizzyB', () => dizzyMap(w, h, s, F(0.05)));
        this.dizzyFlag = 1; break;
      case 8: this.decayLut(1, 0xfe, 3); this.fadeLut(true);
        this.map('windmill', () => zoomMap(w, h, s, F(-0.03), F(w * F(0.04))));
        this.windAngle = 0; break;
      case 9: this.decayLut(1, 0xfe, 5); this.fadeLut(false);
        this.map('niagara', () => niagaraMap(w, h, s, (h * 0.025) | 0, (0.06 * h) | 0));
        this.niaMode = 0; this.niaPos = 0; this.niaFlag = 1; break;
      case 10: this.decayLut(1, 0xfe, 2); this.fadeLut(true);
        this.map('blendA', () => blenderMap(w, h, s, F(-0.08), 1, (h * F(0.1)) | 0));
        this.map('blendB', () => blenderMap(w, h, s, F(0.08), 1, (h * F(0.1)) | 0));
        this.blendFlag = 1; break;
      case 11: this.decayLut(1, 0xfe, 2); this.fadeLut(true);
        this.map('xA', () => zoomMap(w, h, s, F(0.03), F(w * F(0.01))));
        this.map('xB', () => zoomMap(w, h, s, F(-0.03), F(w * F(0.01))));
        this.xFlag = 1; this.xAngle = QUARTER_PI_BITS; break;
      case 12: this.decayLut(1, 0xfe, 0xff); this.fadeLut(false);
        this.map('drain', () => zoomMap(w, h, s, F(0.02), F(-(w * (w > 500 ? F(0.005) : F(0.01))))));
        this.drainGrid = 0; this.drainAngle = 0; this.drainK = 0.75; this.drainFlag = 1; break;
      case 13: this.decayLut(1, 0xfe, 1); this.fadeLut(true);
        this.thingAngle = QUARTER_PI_BITS;
        this.map('thingus', () => thingusMap(w, h, s, F(0.2), w >> 3)); break;
    }
  }

  /** warp cur -> other through a map, then swap */
  warpSwap(key: string): void { this.warp(this.cur, this.other, this.maps[key]); this.swap(); }
  /** blur cur -> other, then swap */
  blurSwap(): void { this.blur(this.cur, this.other); this.swap(); }

  swirl(L: TimedLevel): void {                   // 0x0786a181 [0x0796ee25]
    const w = this.w, h = this.h, cx = this.cx, cy = this.cy;
    this.schedulePalette(0, 13);
    if (this.beatA(L)) {
      this.cur.fill(0xfe);
      this.line(0, 0, w - 1, 0, 0x7f); this.line(0, h - 1, w - 1, h - 1, 0x7f);
      this.line(0, 0, 0, h - 1, 0x7f); this.line(w - 1, 0, w - 1, h - 1, 0x7f);
    }
    this.warpSwap('swirl');
    this.ringScope(L, cx - (cx >> 2), cx >> 2, 1, 0x7f, false);
    this.blurSwap();
    this.edges(this.cur, this.lut);
    this.waveLine(L.wave[0], cy >> 1, 3, w - 4, cy >> 2, 0x7f);
    this.waveLine(this.wave2(L), (cy >> 1) + cy, 3, w - 4, cy >> 2, 0x7f);
  }

  warpPreset(L: TimedLevel): void {              // 0x0786a32c [0x0796efce]
    const R = this.cy >> 3;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      this.ring(L, R, R - 2, 200, 0xfe); this.ring(L, R, R - 4, 200, 0xfe); this.ring(L, R, R - 6, 200, 0xfe);
    }
    this.ring(L, R, R, 1, 0xfe);
    this.warpSwap('warp');
    this.blurSwap();
    const s = this.cur, w = this.w, o = this.cy * w + this.cx;
    s[o] = 1; s[o - 1] = 1; s[o - w - 1] = 1; s[o - w] = 1;
    this.edges(s, this.lut);
  }

  anon(L: TimedLevel): void {                    // 0x0786a4ce [0x0796f170]
    const w = this.w, cy = this.cy;
    this.schedulePalette(13, 13);
    this.ringScope(L, cy >> 1, 0, 1, 0xfe, false);
    this.warpSwap(this.anonFlag ? 'anonB' : 'anonA');
    this.waveLine(L.wave[0], cy, 3, w - 4, cy >> 1, 0xfe);
    if (this.beatA(L)) {
      this.waveLine(L.wave[0], cy + 2, 3, w - 4, cy >> 1, 0xfe);
      this.waveLine(L.wave[0], cy - 2, 3, w - 4, cy >> 1, 0xfe);
      this.anonFlag = this.anonFlag ? 0 : 1;
    }
    this.blurSwap();
    this.edges(this.cur, this.lut);
  }

  falloff(L: TimedLevel): void {                 // 0x0786a649 [0x0796f2e9]
    const w = this.w, h = this.h, cy = this.cy;
    this.schedulePalette(13, 13);
    this.warpSwap('falloff');
    if (this.beatB(L)) this.waveLine(L.wave[0], cy, 3, w - 4, cy, 0xfe);
    if (this.beatA(L)) {
      this.waveLine(L.wave[0], cy + 2, 3, w - 4, cy, 0xfe);
      this.waveLine(L.wave[0], cy - 2, 3, w - 4, cy, 0xfe);
    }
    this.blurSwap();
    this.line(0, 0, w - 1, 0, 0xfe); this.line(0, h - 1, w - 1, h - 1, 0xfe);
    this.line(0, 0, 0, h - 1, 0xfe); this.line(1, 0, 1, h - 1, 0xfe); this.line(2, 0, 2, h - 1, 0xfe);
    this.line(w - 1, 0, w - 1, h - 1, 0xfe); this.line(w - 2, 0, w - 2, h - 1, 0xfe);
    this.line(w - 3, 0, w - 3, h - 1, 0xfe);
  }

  water(L: TimedLevel): void {                   // 0x0786a867 [0x0796f505]
    const cy = this.cy;
    this.schedulePalette(this.waterFlag ? 13 : 0, 13);
    if (this.beatA(L) && !this.fading) {
      const f = this.waterFlag;
      if (A.rand() % (f ? 4 : 2) === 0) { this.waterFlag = f ? 0 : 1; this.cur.fill(0xfe); }
    }
    this.waveLine(L.wave[0], cy, 3, this.w - 4, cy >> 2, this.waterFlag ? 0xfe : 0x7f);
    this.ring(L, cy - 1, 0, 0x7f, 0x7f);
    this.warpSwap('water');
    this.blurSwap();
    this.edges(this.cur, this.lut);
  }

  bubble(L: TimedLevel): void {                  // 0x0786a9a4 [0x0796f640]
    const cy = this.cy;
    this.schedulePalette(this.bubbleFlag ? 13 : 0, 13);
    if (this.beatA(L) && !this.fading) {
      const f = this.bubbleFlag;
      if (A.rand() % (f ? 2 : 1) === 0) this.bubbleFlag = f ? 0 : 1;
    }
    this.ring(L, (cy >> 1) - (cy >> 3), 0, 0xfe, 0xfe);
    this.ring(L, cy >> 3, 0, 1, 1);
    this.warpSwap('bubble');
    this.blurSwap();
    this.border(1);
  }

  dizzy(L: TimedLevel): void {                   // 0x0786ab25 [0x0796f7bf]
    const w = this.w, h = this.h, cy = this.cy;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      this.dizzyFlag = this.dizzyFlag ? 0 : 1;
      this.line(0, 0, w - 1, 0, 0xfe); this.line(0, h - 1, w - 1, h - 1, 0xfe);
    }
    this.edges(this.cur, this.lut2);
    this.waveLine(L.wave[0], cy - (cy >> 1), 3, w - 4, cy - 2, 0xfe);
    this.waveLine(this.wave2(L), (cy >> 1) + cy, 3, w - 4, cy - 2, 0xfe);
    this.ringScope(L, cy >> 2, 0, 1, 0xfe, false);
    this.warpSwap(this.dizzyFlag ? 'dizzyA' : 'dizzyB');
    this.blurSwap();
  }

  windmill(L: TimedLevel): void {                // 0x0786acbd [0x0796f953]
    const w = this.w, cx = this.cx, cy = this.cy;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      if (!this.fading && A.rand() % 8 === 0) this.cur.fill(0xfe);
      this.sparkles(0.001);
    }
    this.spinScope(L.wave[0], this.windAngle, w, cx, cy - (cy >> 2), cy >> 1, 0xfe);
    this.spinScope(this.wave2(L), this.windAngle, w, cx, (cy >> 2) + cy, cy >> 1, 0xfe);
    this.windAngle = F(this.windAngle + F(0.005));
    this.warpSwap('windmill');
    this.blurSwap();
    this.border(1);
  }

  niagara(L: TimedLevel): void {                 // 0x0786afe5 [0x0796fc78]
    const w = this.w, h = this.h;
    this.schedulePalette(this.niaFlag ? 13 : 0, 13);
    const hm1 = h - 1, amp = (w >> 3) + 1;
    let x = 0, y0 = 0;
    if (this.niaMode === 0) {                    // a curtain dropping in from above
      x = w >> 1; y0 = this.niaPos - h;
      if (++this.niaPos >= h) { this.niaMode = 1; this.niaPos = 0; }
    } else if (this.niaMode === 1) {             // ...then parting outward
      x = (w >> 1) - this.niaPos; y0 = 1; this.niaPos++;
      if (x <= (w >> 4) + 2) this.niaMode = 2;
    } else if (this.niaMode === 2) { x = (w >> 4) + 2; y0 = 1; }
    if (this.beatA(L)) {
      for (let k = 0, xx = x + 4; k < 8; k++, xx++) {
        this.lineScope(L.wave[0], xx, y0, xx, hm1 + y0, amp, 0xfe);
        this.lineScope(this.wave2(L), w - xx, y0, w - xx, hm1 + y0, amp, 0xfe);
      }
      for (let n = A.rand() % 10 + 1; n > 0; n--) {
        this.put(0, A.rand() % h, 0xfe);
        this.put(A.rand() % w, h - 1, 0xfe);
        this.put(A.rand() % w, h - 1, 0xfe);
        this.put(w - 1, A.rand() % h, 0xfe);
      }
      if (this.niaMode === 2) {
        if (this.oldNiagara) A.rand();           // WMP 7-8 (7.1 0x52539790): a draw that goes nowhere
        if (A.rand() % 16 === 0) this.cur.fill(A.rand() % 127 + 127);
        if (A.rand() % 4 === 0) { this.line(0, y0, 0, hm1, 0xfe); this.line(w - 1, y0, w - 1, hm1, 0xfe); }
        if (A.rand() % 4 === 0) this.niaFlag = this.niaFlag ? 0 : 1;
      }
    }
    this.edges(this.cur, this.lut);
    if (this.beatB(L)) {
      for (let k = 0, xx = x; k < 3; k++, xx++) {
        this.lineScope(L.wave[0], xx, y0, xx, y0 + hm1, amp, 0xfe);
        this.lineScope(this.wave2(L), w - xx, y0, w - xx, y0 + hm1, amp, 0xfe);
      }
    }
    this.warpSwap('niagara');
    this.blurSwap();
  }

  blender(L: TimedLevel): void {                 // 0x0786b3ff [0x0797009f]
    const w = this.w, cy = this.cy;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) this.blendFlag = this.blendFlag ? 0 : 1;
    this.blurSwap();
    this.warpSwap(this.blendFlag ? 'blendA' : 'blendB');
    this.waveLine(L.wave[0], cy - 1, 3, w - 4, cy >> 1, 0xfe);
    this.waveLine(L.wave[0], cy, 3, w - 4, cy >> 1, 0xfe);
    this.waveLine(L.wave[0], cy + 1, 3, w - 4, cy >> 1, 0xfe);
  }

  xMarks(L: TimedLevel): void {                  // 0x0786b538 [0x079701d6]
    const w = this.w, cx = this.cx, cy = this.cy;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      if (A.rand() % 20 === 0) this.cur.fill(0xfe);
      if (A.rand() % 5 === 0) this.xFlag = this.xFlag ? 0 : 1;
      if (A.rand() % 5 === 0) this.sparkles(0.004);
    }
    this.blurSwap();
    if (this.xFlag) { this.warp(this.cur, this.other, this.maps.xB); this.xAngle = F(this.xAngle + F(0.01)); }
    else { this.warp(this.cur, this.other, this.maps.xA); this.xAngle = F(this.xAngle - F(0.01)); }
    this.swap();
    if (this.beatB(L)) {
      this.spinScope(L.wave[0], this.xAngle, w, cx, cy, cy >> 1, 0xfe);
      this.spinScope(this.wave2(L), F(this.xAngle + HALF_PI_F), w, cx, cy, cy >> 1, 0xfe);
    }
    this.border(1);
  }

  drain(L: TimedLevel): void {                   // 0x0786b8ca [0x0797056a]
    const w = this.w, h = this.h, cx = this.cx, cy = this.cy, k = this.drainK;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      if ((k >= F(0.75) || k <= F(-0.75)) && A.rand() % 5 === 0) this.drainFlag = this.drainFlag ? 0 : 1;
      if (A.rand() % 10 === 0) this.drainGrid += 20;
    }
    if (this.drainFlag) { if (k < F(0.75)) this.drainK = F(k + F(0.01)); }
    else if (k > F(-0.75)) this.drainK = F(k - F(0.01));
    this.blurSwap();
    this.edges(this.cur, this.lut);
    this.warpSwap('drain');
    const a = this.drainAngle, a2 = F(a + HALF_PI_F);
    const r = cy * this.drainK;
    this.spinScope(L.wave[0], a2, h, w - trigTrunc(false, a, r) - cx, h - trigTrunc(true, a, r) - cy, cy >> 2, 0xfe);
    this.spinScope(this.wave2(L), a2, h, trigTrunc(false, a, r) - cx + w, trigTrunc(true, a, r) - cy + h, cy >> 2, 0xfe);
    this.edges(this.cur, this.lut);
    if (this.drainGrid) {
      for (let x = 25; x < w - 2; x += 25) {
        for (let y = 25; y < h - 2; y += 25) {
          this.put(x - 1, y, 0xfe); this.put(x + 1, y, 0xfe); this.put(x, y, 0xfe);
          this.put(x, y - 1, 0xfe); this.put(x, y + 1, 0xfe);
        }
      }
      this.drainGrid--;
    }
    this.drainAngle = F(a + F(0.01));
  }

  thingus(L: TimedLevel): void {                 // 0x0786bc46 [0x079708e2]
    const w = this.w, cx = this.cx, cy = this.cy;
    this.schedulePalette(13, 13);
    if (this.beatA(L)) {
      if (A.rand() % 15 === 0) this.cur.fill(0xfe);
      this.sparkles(0.004);
    }
    this.blurSwap();
    this.warp(this.cur, this.other, this.maps.thingus);
    this.thingAngle = F(this.thingAngle - F(0.03));
    this.swap();
    if (this.beatB(L)) {
      this.spinScope(L.wave[0], this.thingAngle, w, cx, cy, cy >> 1, 0xfe);
      this.spinScope(this.wave2(L), F(this.thingAngle + HALF_PI_F), w, cx, cy, cy >> 1, 0xfe);
    }
    this.border(1);
  }

  /** Random 0x0786c1be [0x07970e51]: another preset (never the same one twice) every 400..1499 Renders;
   *  WMP 7's (wmpui.dll 7.1 0x52538340) draws rand() % 12. */
  random(L: TimedLevel): void {
    if (++this.rndCount >= this.rndLimit) {
      const prev = this.rndSub;
      this.rndCount = 0;
      do this.rndSub = A.rand() % this.rndN + 1; while (this.rndSub === prev);
      this.rndLimit = A.rand() % 1100 + 400;
      this.initPreset(this.rndSub);
    }
    this.run(this.rndSub, L);
  }

  run(n: number, L: TimedLevel): void {
    switch (n) {
      case 0: this.random(L); break;
      case 1: this.swirl(L); break;
      case 2: this.warpPreset(L); break;
      case 3: this.anon(L); break;
      case 4: this.falloff(L); break;
      case 5: this.water(L); break;
      case 6: this.bubble(L); break;
      case 7: this.dizzy(L); break;
      case 8: this.windmill(L); break;
      case 9: this.niagara(L); break;
      case 10: this.blender(L); break;
      case 11: this.xMarks(L); break;
      case 12: this.drain(L); break;
      case 13: this.thingus(L); break;
    }
  }

  // ---------------------------------------------------------------- Render 0x0786c6b8 [0x079712fc]
  render(L: TimedLevel): Surface | null {
    if (!L) return this.last;
    if (this.pending) this.create();
    if (L.state === 0) {                         // stopped: fade out, then a flat fill of entry 1
      if (--this.stopCount < 1) {
        this.out.fill(this.pal32[1]);
        return (this.last = { w: this.w, h: this.h, px: this.out });
      }
      this.blurSwap();
      this.border(1);
    } else if (L.state === 2) {
      if (this.fading) this.fadeStepRender();
      this.stopCount = 300;
      this.frame++;
      this.run(this.base, L);
    }
    // StretchDIBits of the bottom-up DIB with COLORONCOLOR: flip rows, expand through the palette
    const w = this.w, h = this.h, s = this.cur, p = this.pal32, o = this.out;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w, dst = y * w;
      for (let x = 0; x < w; x++) o[dst + x] = p[s[src + x]];
    }
    return (this.last = { w, h, px: o });
  }

  debug(): Record<string, unknown> {
    return {
      engine: 'Ambience', preset: this.preset, presetName: PRESET_NAMES[this.preset],
      random: this.base === 0 ? PRESET_NAMES[this.rndSub] + ' ' + this.rndCount + '/' + this.rndLimit : null,
      size: this.w + 'x' + this.h, frame: this.frame,
      palette: this.fading ? 'fade ' + this.fadeT.toFixed(3) : 'next in ' + this.palCountdown,
    };
  }
}

Ambience.prototype.presetNames = PRESET_NAMES;

declare module '../ns' {
  interface AlchemyNS {
    Ambience: typeof Ambience;
  }
}

A.Ambience = Ambience;
export { Ambience };
