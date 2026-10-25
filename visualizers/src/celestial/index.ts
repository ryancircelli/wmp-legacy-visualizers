// Alchemy.Celestial — Blackfly Studios' "Celestial" visualization for Windows Media Player (Celestial.dll 1.0.0.0,
// 2003, Delphi; CLSID 235C14A0-D423-11D7-BAB8-0080AD3BAD68, Effects key "Celestial"). Our own code, from the DLL's
// machine code (image base 0x00400000; the class TVizCelestial, VMT 0x41fa10).
//
// What it is: two window-sized 32-bit DIBs, the work surface W (obj+0x5c) and the last frame F (obj+0x58). Each Render
// (the base class's IWMPEffects::Render 0x41cf6c -> 0x41fa7c) clears W, draws the preset's shapes on it with GDI wide
// pens (the curves come from a smoothed waveform, the colours from three spectrum bins per channel), blends W into F at
// 8/256 (0x41ee48), then resamples F into W through a fixed radial zoom map (0x41f618, bilinear; the "tunnel" feedback),
// and shows W, which becomes the next F. Nothing reads a clock but Randomize (the first frame, seeding Delphi's Random
// for presets 8 and 9); the frame counter (obj+0x48, int64) drives presets 6, 8 and 9.
import { A, type Surface, type TimedLevel } from '../ns';
import { Gdi } from '../gdi';
import { extLiteral, mul53, div53, sub53, toFix, toNum, rint, rintTrigMul, trigF32 } from './x87';

declare module '../ns' {
  interface AlchemyNS {
    Celestial: typeof Celestial;
  }
}

/** GetPresetTitle's list (0x420fdc: one ';'-separated string) */
const PRESET_NAMES = ['Balance', 'Rhyme', 'Reflection', 'Harmony', 'Mandala', 'Synchronicity', 'Synergy', 'Serenity',
  'Transcendence', 'The coyote is laughing (he is)'];

// ---- the angle tables: everything below depends only on an index, so it is computed once, exactly, on the first
// Celestial made (BigInt arithmetic: not at import) ----
const f32 = Math.fround;
/** Balance's angle per smoothed level L (0x41fcc6): ((L / 255 * 2 - 1.004) * pi) / 3, stored as float */
const BAL_ANG = new Float64Array(256);
/** (i * 2pi) / n as a float, i = 0..n (presets 1, 3-9): FILD i; FLD TBYTE 2pi; FMULP; FDIV n; FSTP DWORD; and FSTP DWORD
 *  of FCOS / FSIN of it (presets 1, 3, 5-9) */
const R127 = new Float64Array(128), R255 = new Float64Array(256), R15 = new Float64Array(16);
const COS255 = new Float64Array(256), SIN255 = new Float64Array(256), COS127 = new Float64Array(128), SIN127 = new Float64Array(128);
const COS15 = new Float64Array(16), SIN15 = new Float64Array(16);
let tablesMade = false;
function makeTables(): void {
  if (tablesMade) return;
  tablesMade = true;
  // Delphi's extended literals (FLD TBYTE): 1.004 (0x420f50), 3.1415926535 (0x420f5c), 6.283185307 (0x420f74)
  const X1004 = extLiteral('1.004'), XPI = extLiteral('3.1415926535'), X2PI = extLiteral('6.283185307');
  // a double within 1e-12 of an exact value rounds to the same float unless it lies that near a float tie: the
  // doubles decide, BigInt only near a tie
  const near = (v: number): boolean => {
    const f = f32(v), ulp = Math.abs(f) * 2 ** -23;
    return Math.abs(Math.abs(v - f) - ulp / 2) <= Math.abs(v) * 1e-12;
  };
  const ring = (n: number, a: Float64Array, c: Float64Array, s: Float64Array): void => {
    for (let i = 0; i < a.length; i++) {
      const v = (i * 6.283185307) / n;
      a[i] = near(v) ? f32(toNum(div53(mul53(toFix(i), X2PI), toFix(n)))) : f32(v);
      const cs = Math.cos(a[i]), sn = Math.sin(a[i]);
      if (near(cs) || near(sn)) [s[i], c[i]] = trigF32(a[i]);
      else { c[i] = f32(cs); s[i] = f32(sn); }
    }
  };
  ring(127, R127, COS127, SIN127); ring(255, R255, COS255, SIN255); ring(15, R15, COS15, SIN15);
  for (let L = 0; L < 256; L++) {
    const q = toFix((L / 255) * 2);                       // FILD, FDIV 255, FMUL 2 at 53 bits
    BAL_ANG[L] = f32(toNum(div53(mul53(sub53(q, X1004), XPI), toFix(3))));
  }
}

interface Blob { px: number; py: number; rx: number; ry: number; r: number; g: number; b: number; level: number }

export interface CelestialConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

class Celestial {
  static PRESET_NAMES = PRESET_NAMES;

  options: Record<string, unknown>;
  preset = 0;
  w = 0;
  h = 0;
  /** the frames rendered (obj+0x48, int64; Render 0x41cfbc counts it after the frame) */
  frame = 0;
  /** Delphi's RandSeed (0x422008): Randomize (0x402a30) sets it from the time of day on the first frame */
  randSeed = 0;
  private seeded = false;
  /** the smoothed waveforms (obj+0x106c, +0x146c): (old + new) >> 1 per sample */
  private smooth = [new Uint8Array(1024), new Uint8Array(1024)];
  /** obj+0x64: the pen width presets 2 and 7 ease (shared by both) */
  private st = 0;
  /** presets 8 and 9's sixteen blobs (obj+0x186c, 0x18 bytes each) */
  private blobs: Blob[] = [];
  /** F (obj+0x58) and W (obj+0x5c), 0x00RRGGBB top row first */
  private last!: Uint32Array;
  private work!: Uint32Array;
  /** the zoom map (obj+0x68, 0x41f618): per pixel of W, the source pixel in F (-1: none) and four weights */
  private mapSrc!: Int32Array;
  private mapW!: Int32Array;
  private gdi!: Gdi;
  private xs0 = new Int32Array(257);
  private ys0 = new Int32Array(257);
  private xs1 = new Int32Array(257);
  private ys1 = new Int32Array(257);
  surface: Surface;

  constructor(cfg: CelestialConfig = {}) {
    makeTables();
    this.options = Object.assign({}, cfg.options);
    this.surface = { w: 1, h: 1, px: new Uint32Array(1) };
    this.setPreset(cfg.preset ?? 0);
    this.resize(cfg.width ?? 640, cfg.height ?? 480);
  }

  /** Randomize's seed: the DLL takes ((h * 60 + m) * 60 + s) * 1000 + ms of GetSystemTime (UTC) */
  seed(n: number): this { this.randSeed = n >>> 0; this.seeded = true; return this; }

  /** SetCurrentPreset 0x41d0b4 stores the number (obj+0x20); nothing is reset */
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return true;
  }

  /** 0x421070 (the base Render calls it when the rect's size changes): new black F and W, a new zoom map */
  resize(w: number, h: number): void {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.last = new Uint32Array(w * h);
    this.work = new Uint32Array(w * h);
    this.gdi = new Gdi(w, h, this.work);
    this.buildMap(0.8500000238418579);           // 0x3f59999a
    this.surface = { w, h, px: this.work };
  }

  /** Delphi's Random(n) (0x402f6c) */
  private random(n: number): number {
    this.randSeed = (Math.imul(this.randSeed, 0x08088405) + 1) >>> 0;
    return Math.floor((this.randSeed * n) / 4294967296);
  }

  /**
   * The zoom map 0x41f618 (factor 0.85, float): for each offset (i, j) from the centre (w>>1, h>>1), a scale
   * s = (1 - 0.85 / sqrt(i*i + j*j)) * 0.98 + 0.01 (0 within radius 1), and the four pixels around
   * (centre + (i, j) * s) in each quadrant with their bilinear weights in 1/65536 (X = trunc(i * s * 256) etc.).
   */
  private buildMap(k: number): void {
    const W = this.w, H = this.h, hx = W >>> 1, hy = H >>> 1;
    const src = (this.mapSrc = new Int32Array(W * H).fill(-1));
    const wt = (this.mapW = new Int32Array(4 * W * H));
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x);
    const put = (e: number, s: number, a: number, b: number, c: number, d: number): void => {
      src[e] = s; wt[4 * e] = a; wt[4 * e + 1] = b; wt[4 * e + 2] = c; wt[4 * e + 3] = d;
    };
    const f98 = f32(0.98), f01 = f32(0.01);
    for (let j = 0; j <= hy; j++) {
      for (let i = 0; i <= hx; i++) {
        const r = Math.sqrt(i * i + j * j);
        const s = r > 1 ? (1 - k / r) * f98 + f01 : 0;
        const X = Math.trunc(i * s * 256), Y = Math.trunc(j * s * 256);
        const X0 = X & ~0xff, Y0 = Y & ~0xff;
        const a30 = (X0 + 256 - X) * (Y0 + 256 - Y), a34 = (X0 + 256 - X) * (Y - Y0);
        const a38 = (X - X0) * (Y - Y0), a3c = (X - X0) * (Y0 + 256 - Y);
        const xi = Math.trunc(i * s), yi = Math.trunc(j * s);
        put((hy - j) * W + hx - i, at(hx - xi - 1, hy - yi - 1), a38, a3c, a30, a34);
        if (hx + i < W) put((hy - j) * W + hx + i, at(hx + xi, hy - yi - 1), a34, a30, a3c, a38);
        if (hy + j < H) {
          put((hy + j) * W + hx - i, at(hx - xi - 1, hy + yi), a3c, a38, a34, a30);
          put((hy + j) * W + hx + i, at(hx + xi, hy + yi), a30, a34, a38, a3c);
        }
      }
    }
  }

  render(L: TimedLevel | null): Surface | null {
    if (!L) return this.surface;
    const W = this.w, H = this.h;
    if (this.frame === 0) this.firstFrame();
    // 0x41fb59: the waveforms smoothed, (old + new) >> 1
    for (let c = 0; c < 2; c++) {
      const s = this.smooth[c], wv = L.wave[c];
      for (let i = 0; i < 1024; i++) s[i] = (s[i] + wv[i]) >> 1;
    }
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    const f0 = L.freq[0], f1 = L.freq[1];
    const m255 = (v: number): number => (v > 255 ? 255 : v);
    // the two colours (COLORREF): channel 0's bins 9, 49, 249 and channel 1's
    const c1 = m255(f0[9] * 8) | (m255(f0[49] * 4) << 8) | ((255 - m255(f0[249] * 8)) << 16);
    const c2 = (255 - m255(f1[9] * 8)) | (m255(f1[49] * 4) << 8) | (m255(f1[249] * 8) << 16);
    const c1x = c1 ^ 0xf0ff0, c2x = c2 ^ 0xf0ff0;
    this.work.fill(0);                                 // PatBlt BLACKNESS
    this.points(L, cx, cy);
    this.draw(L, cx, cy, c1, c2, c1x, c2x);
    this.blend();
    this.warp();
    this.last.set(this.work);                          // 0x41f2a4: BitBlt W to the HDC, then F := W
    this.frame++;
    return this.surface;
  }

  /** frame 0 (0x41fa8a): F from the HDC (black here, as the harness's fresh DIB), Randomize, the blobs */
  private firstFrame(): void {
    this.last.fill(0);
    if (!this.seeded) {
      const d = new Date();
      this.randSeed = (((d.getUTCHours() * 60 + d.getUTCMinutes()) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds()) >>> 0;
    }
    this.blobs = [];
    for (let b = 1; b <= 16; b++) {
      const px = this.random(40) + 20, py = this.random(40) + 20;
      this.blobs.push({ px, py, rx: 30, ry: 30, r: ((16 - b) * 12 + 75) & 0xff, g: (Math.abs(8 - b) * 32 + 75) & 0xff, b: (b * 12 + 75) & 0xff, level: 0 });
    }
  }

  /** the preset's points (0x41fca5..0x420741), into xs0/ys0 and xs1/ys1 */
  private points(L: TimedLevel, cx: number, cy: number): void {
    const W = this.w, H = this.h, s0 = this.smooth[0], s1 = this.smooth[1];
    const xs0 = this.xs0, ys0 = this.ys0, xs1 = this.xs1, ys1 = this.ys1;
    const f0 = L.freq[0], f1 = L.freq[1];
    let i: number, r: number, r2: number, l: number;
    switch (this.preset) {
      case 0:                                          // Balance: two fans of 128 points, angle from the level
        for (i = 1; i <= 128; i++) {
          r = f32((((i - 1) * W) / 127) / 2);
          let a = BAL_ANG[s0[8 * i - 1]];
          xs0[i] = rintTrigMul(a, r, 1) + cx; ys0[i] = rintTrigMul(a, r, 0) + cy;
          a = BAL_ANG[s1[8 * i - 1]];
          xs1[i] = cx - rintTrigMul(a, r, 1); ys1[i] = rintTrigMul(a, r, 0) + cy;
        }
        break;
      case 1:                                          // Rhyme: a waveform line and a level ellipse
        for (i = 1; i <= 128; i++) {
          l = (s0[8 * i - 1] >> 1) + 64;
          xs0[i] = rint(((i - 1) * W) / 127); ys0[i] = rint((H * l) / 255);
          l = s0[8 * i - 1];
          r = f32((((H * l * l) / 255) / 4) / 127);
          xs1[i] = rint(COS127[i - 1] * r * 2) + cx; ys1[i] = rint(SIN127[i - 1] * r) + cy;
        }
        break;
      case 2:                                          // Reflection: two mirrored waveform lines
        for (i = 1; i <= 128; i++) {
          xs0[i] = rint(((i - 1) * W) / 127);
          ys0[i] = rint(((128 - s0[8 * i - 1]) * H) / 255 / 2 - Math.abs(i - 64) / 3) + cy;
          xs1[i] = rint(((i - 1) * W) / 127);
          ys1[i] = rint(((s1[8 * i - 1] - 128) * H) / 255 / 2 + Math.abs(i - 64) / 3) + cy;
        }
        break;
      case 3:                                          // Harmony
        for (i = 1; i <= 256; i++) {
          r = f32((H * s0[4 * i - 1]) / 255 / 2);
          xs0[i] = rint(SIN255[i - 1] * r) + cx; ys0[i] = rint(COS255[i - 1] * r) + cy;
          r2 = f32((H * s1[4 * i - 1]) / 255 / 8);
          xs1[i] = rint(SIN255[i - 1] * r2) + cx; ys1[i] = rint(COS255[i - 1] * r2) + cy;
        }
        break;
      case 4:                                          // Mandala: FSIN/FCOS of the angle unstored
        for (i = 1; i <= 128; i++) {
          const a = R127[i - 1];
          r = f32((H * s0[8 * i - 1]) / 255 / 2);
          xs0[i] = rintTrigMul(a, r, 0) + cx; ys0[i] = rintTrigMul(a, r, 1) + cy;
          r2 = f32((H * s1[8 * i - 1]) / 255 / 5);
          xs1[i] = rintTrigMul(a, r2, 0) + cx; ys1[i] = rintTrigMul(a, r2, 1) + cy;
        }
        break;
      case 5:                                          // Synchronicity: the raw spectrum, mirrored
        for (i = 1; i <= 256; i++) {
          r = f32((H * f0[4 * i - 1]) / 255 / 2);
          xs0[i] = rint(COS255[i - 1] * r) + cx + 1; ys0[i] = rint(SIN255[i - 1] * r) + cy;
          r2 = f32((H * f1[4 * i - 1]) / 255 / 2);
          xs1[i] = cx - 1 - rint(COS255[i - 1] * r2); ys1[i] = cy - rint(SIN255[i - 1] * r2);
        }
        break;
      case 6: {                                        // Synergy: two rings wandering on the frame count
        const t = this.frame;
        const o1 = rintTrigMul(t / 37, 30, 1), o2 = rintTrigMul(t / 43, 30, 0);
        const o3 = rintTrigMul(t / 29, 30, 1), o4 = rintTrigMul(t / 23, 30, 0);
        for (i = 1; i <= 256; i++) {
          r = f32((H * s0[4 * i - 1]) / 255 / 3);
          xs0[i] = rint(SIN255[i - 1] * r) + cx + o1; ys0[i] = rint(COS255[i - 1] * r) + cy + o2;
          r2 = f32((H * s1[4 * i - 1]) / 255 / 3);
          xs1[i] = cx + o3 - rint(SIN255[i - 1] * r2); ys1[i] = cy + o4 - rint(COS255[i - 1] * r2);
        }
        break;
      }
      case 7:                                          // Serenity: both rings from channel 0
        for (i = 1; i <= 256; i++) {
          r = f32((H * s0[4 * i - 1]) / 255 / 6 + H / 3);
          xs0[i] = rint(COS255[i - 1] * r) + cx; ys0[i] = rint(SIN255[i - 1] * r) + cy;
          r2 = f32((H * s0[4 * i - 1]) / 255 / 8);
          xs1[i] = rint(COS255[i - 1] * r2) + cx; ys1[i] = rint(SIN255[i - 1] * r2) + cy;
        }
        break;
      case 8: case 9: {                                // the sixteen blobs (0x4205d7): 16-gons on the raw waveform
        const t = this.frame;
        for (let k = 1; k <= 2; k++) {
          const wv = L.wave[k - 1];
          for (let j = 1; j <= 8; j++) {
            const b = (k - 1) * 8 + j, B = this.blobs[b - 1];
            const ox = rintTrigMul(t / B.px, 30, 1), oy = rintTrigMul(t / B.py, 30, 0);
            for (i = 1; i <= 16; i++) {
              const idx = (b - 1) * 16 + i, rr = wv[4 * ((i - 1) * 16 + b) - 1] / 8;
              xs0[idx] = rint((rr + B.rx) * COS15[i - 1]) + cx + ox;
              ys0[idx] = rint((rr + B.ry) * SIN15[i - 1]) + cy + oy;
            }
          }
        }
        break;
      }
    }
  }

  /** the preset's GDI calls (0x420741..0x420f12) through the shared GDI rasterizer; colours are COLORREFs */
  private draw(L: TimedLevel, cx: number, cy: number, c1: number, c2: number, c1x: number, c2x: number): void {
    const g = this.gdi, f0 = L.freq[0], f1 = L.freq[1];
    const MERGE = 15, XOR = 7, COPY = 13;
    // the points P0 / P1 from index s, n of them (the DLL's arrays are 1-based)
    const x0 = (s: number, n: number) => this.xs0.subarray(s, s + n), y0 = (s: number, n: number) => this.ys0.subarray(s, s + n);
    const x1 = (n: number) => this.xs1.subarray(1, 1 + n), y1 = (n: number) => this.ys1.subarray(1, 1 + n);
    switch (this.preset) {
      case 0:
        g.rop = MERGE;
        g.polyline(x0(1, 128), y0(1, 128), c1, 3);
        g.polyline(x1(128), y1(128), c2, 3);
        g.rop = COPY;
        break;
      case 1:
        g.rop = MERGE;
        g.polyline(x0(1, 128), y0(1, 128), c1, 8);
        g.polygon(x1(128), y1(128), c2x, c2, 4);
        g.rop = COPY;
        break;
      case 2: {
        g.rop = MERGE;
        g.polyline(x0(1, 128), y0(1, 128), c1, 16);
        g.polyline(x1(128), y1(128), c2, 16);
        g.rop = COPY;
        let v = ((f0[255] + f1[255]) >> 4) + this.st * 7;
        if (v < 0) v += 7;
        this.st = (v >> 3) + 4;
        g.ellipse(cx - 20, cy - 20, cx + 20, cy + 20, c2x | 0xffff, c2x | 0xff, this.st);
        break;
      }
      case 3:
        g.rop = XOR;
        g.polygon(x0(1, 256), y0(1, 256), 0, c1, 6);
        g.polygon(x1(256), y1(256), c1 ^ 0xf0f00f, c2, 3);
        g.rop = COPY;
        break;
      case 4:
        g.polygon(x0(1, 128), y0(1, 128), 0, c1, 6);
        g.polygon(x1(128), y1(128), 0, c2, 4);
        break;
      case 5:
        g.rop = MERGE;
        g.polygon(x0(1, 256), y0(1, 256), c2x, c1, 4);
        g.polygon(x1(256), y1(256), c1x, c2, 4);
        g.rop = COPY;
        break;
      case 6:
        g.rop = MERGE;
        g.polygon(x0(1, 256), y0(1, 256), 0, c1, 5);
        g.polygon(x1(256), y1(256), 0, c2, 5);
        g.rop = COPY;
        break;
      case 7: {
        g.rop = XOR;
        g.polygon(x0(1, 256), y0(1, 256), c1 | 0xff0000, c2x | 0xff00ff, 6);
        let v = ((f0[255] + f1[255]) >> 3) + this.st * 7;
        if (v < 0) v += 7;
        this.st = (v >> 3) + 2;
        g.polygon(x1(256), y1(256), c1 ^ 0xf0f00f, c2, this.st);
        g.rop = COPY;
        break;
      }
      case 8: case 9: {
        // 8: brush 0, a 3-pixel pen in the blob's colour; 9: the NULL pen, a brush in the blob's colour
        g.rop = XOR;
        for (let b = 1; b <= 16; b++) {
          const B = this.blobs[b - 1];
          let v = B.level * 7 + (f0[56 * b - 1] + f1[56 * b - 1]) * 2;
          if (v < 0) v += 7;
          v >>= 3;
          B.level = v;
          const R = Math.min(255, ((B.r * v) / 255) | 0), G = Math.min(255, ((B.g * v) / 191) | 0), Bl = Math.min(255, ((B.b * v) / 127) | 0);
          const col = (R << 16) | (G << 8) | Bl;
          const s = (b - 1) * 16 + 1;
          if (this.preset === 8) g.polygon(x0(s, 16), y0(s, 16), 0, col, 3);
          else g.polygon(x0(s, 16), y0(s, 16), col, null);
        }
        g.rop = COPY;
        break;
      }
    }
  }

  /** 0x41ee48 (alpha 8): F = (W * 8 >> 8) + (F * 248 >> 8) per byte */
  private blend(): void {
    const s = this.work, d = this.last;
    for (let i = 0; i < s.length; i++) {
      const a = s[i], b = d[i];
      if (!(a | b)) continue;
      d[i] = ((((a >>> 16) & 0xff) >> 5) + ((((b >>> 16) & 0xff) * 248) >> 8)) << 16 |
        ((((a >>> 8) & 0xff) >> 5) + ((((b >>> 8) & 0xff) * 248) >> 8)) << 8 |
        (((a & 0xff) >> 5) + (((b & 0xff) * 248) >> 8));
    }
  }

  /** 0x41f504: W[p] = the bilinear blend of F's four pixels at map[p] (weights in 1/65536, truncated); none: kept */
  private warp(): void {
    const W = this.w, n = W * this.h, F = this.last, out = this.work, src = this.mapSrc, wt = this.mapW;
    for (let p = 0; p < n; p++) {
      const s = src[p];
      if (s < 0) continue;
      // ponytail: x + 1 / y + 1 past the last column / row read the next row / wrap as the DIB's memory would not;
      // the map never points there for any window wider and taller than a few pixels
      const s01 = s + W < n ? s + W : s, s10 = s + 1 < n ? s + 1 : s, s11 = s01 + 1 < n ? s01 + 1 : s01;
      const a = F[s], b = F[s01], c = F[s11], d = F[s10];
      if (!(a | b | c | d)) { out[p] = 0; continue; }
      const w0 = wt[4 * p], w1 = wt[4 * p + 1], w2 = wt[4 * p + 2], w3 = wt[4 * p + 3];
      const r = ((a >>> 16) & 0xff) * w0 + ((b >>> 16) & 0xff) * w1 + ((c >>> 16) & 0xff) * w2 + ((d >>> 16) & 0xff) * w3;
      const g = ((a >>> 8) & 0xff) * w0 + ((b >>> 8) & 0xff) * w1 + ((c >>> 8) & 0xff) * w2 + ((d >>> 8) & 0xff) * w3;
      const bl = (a & 0xff) * w0 + (b & 0xff) * w1 + (c & 0xff) * w2 + (d & 0xff) * w3;
      out[p] = ((r >>> 16) << 16) | ((g >>> 16) << 8) | (bl >>> 16);
    }
  }

  debug(): Record<string, unknown> {
    return { preset: this.preset, frame: this.frame, w: this.w, h: this.h, st: this.st, randSeed: this.randSeed };
  }
}

A.Celestial = Celestial;
export { Celestial };
