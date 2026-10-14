// Blackfly Studios' visualization framework (2003-2006): the Delphi units every Blackfly plug-in links
// (Effects, DIB, VizDIB; Ripple, Clarify, Celestial and Fire Dancer), as our own TypeScript. Written from
// Ripple.dll's machine code (VAs below are Ripple.dll's, image base 0x400000); the other DLLs carry the same
// units at other addresses.
//
// What it covers:
//  - Delphi's System.Random (RandSeed LCG) and Round (x87 FISTP, round half to even)
//  - TVizShell (unit Effects), the COM object behind IWMPEffects: Render keeps the window rect, calls the
//    resize hook when the rect's size changed, then the draw hook, then counts the frame (int64 at +0x48);
//    SetCurrentPreset stores the preset (+0x20) and calls a preset hook (empty in Ripple)
//  - TVizDIB32Double (unit VizDIB): two 32-bit DIB sections the window's size, front (+0x5c) and back
//    (+0x58), both black when made; Render BitBlts the front to the window, then copies it to the back
//  - TDIB.Blend (unit DIB, 0x41ecc0): per byte, src*a/256 + dst*(256-a)/256 into dst (Ripple: the back over the
//    front; Clarify: the front over the back)
//  - from Clarify.dll (its VAs, image base 0x400000; its VizDIB is a later one than Ripple's): TDIB8's grey-ramp
//    palette in one colour (rampPalette, 0x41f120) and TRadialSmear (VMT 0x41f5e4), the zoom toward the centre
import type { Surface, TimedLevel } from '../ns';

/** System.Random (0x402ef4): RandSeed = RandSeed * 0x08088405 + 1, result (RandSeed * range) >> 32. RandSeed
 *  starts at 0 and nothing in the DLLs calls Randomize. */
export class DelphiRandom {
  seed = 0;
  random(range: number): number {
    this.seed = (Math.imul(this.seed, 0x08088405) + 1) >>> 0;
    // the 64-bit product's high half, from 16-bit halves (every partial product exact in a double)
    const t = (this.seed >>> 16) * range + Math.floor(((this.seed & 0xffff) * range) / 65536);
    return Math.floor(t / 65536);
  }
}

/** System.Round (0x402a44): FISTP under the default control word, halves to even. */
export function delphiRound(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r & 1 ? r - 1 : r;
}

/** TDIB.Blend (0x41ecc0), Self = src, over two DIBs of one size: each of B, G, R of dst becomes
 *  (src * (a & 255) >> 8) + (dst * ((256 - a) & 255) >> 8), the bytes added with 8-bit wrap; the top byte is src's. */
export function blend(src: Uint32Array, dst: Uint32Array, alpha: number): void {
  const a = alpha & 255, b = (256 - alpha) & 255;
  for (let i = 0; i < dst.length; i++) {
    const s = src[i], d = dst[i];
    dst[i] = ((s & 0xff000000) |
      (((((s >>> 16) & 255) * a) >> 8) + ((((d >>> 16) & 255) * b) >> 8) & 255) << 16 |
      (((((s >>> 8) & 255) * a) >> 8) + ((((d >>> 8) & 255) * b) >> 8) & 255) << 8 |
      ((((s & 255) * a) >> 8) + (((d & 255) * b) >> 8) & 255)) >>> 0;
  }
}

/** Clarify 0x41f120: an 8-bit DIB's colour table, black to the COLORREF `color` (0x00BBGGRR) in 256 steps,
 *  entry i = channel * i / 255 truncated; returned as the 0x00RRGGBB pixels a BitBlt to 32 bits makes of them. */
export function rampPalette(color: number): Uint32Array {
  const r = color & 255, g = (color >>> 8) & 255, b = (color >>> 16) & 255, pal = new Uint32Array(256);
  for (let i = 0; i < 256; i++) pal[i] = (((r * i) / 255) << 16) | (((g * i) / 255) << 8) | ((b * i) / 255);
  return pal;
}

/** TRadialSmear (Clarify, VMT 0x41f5e4): every pixel of a w x h DIB takes a bilinear sample of a source DIB
 *  (the back) nearer the centre (w >> 1, h >> 1), at f(d) of its offset, f(d) = (1 - amount / d) * 0.98f + 0.01f
 *  past distance 1, else 0. The table (0x41f7b4, built once a size) holds per pixel four weights in 1/65536
 *  and the sample's top-left pixel, -1 where that falls outside the DIB (the DLL's nil: the pixel is left alone). */
export class RadialSmear {
  /** per pixel: weights of (x, y), (x, y + 1), (x + 1, y + 1), (x + 1, y), then the source index */
  readonly t: Int32Array;
  constructor(readonly w: number, readonly h: number, amount: number) {
    const t = (this.t = new Int32Array(w * h * 5));
    for (let k = 4; k < t.length; k += 5) t[k] = -1;
    const cx = w >>> 1, cy = h >>> 1, k98 = Math.fround(0.98), k01 = Math.fround(0.01);
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);   // 0x41eb4c
    const put = (e: number, a: number, b: number, c: number, d: number, src: number) => {
      // entries are addressed (row * w + x) * 5 unchecked: x = w wraps to the next row (rewritten later
      // by that row's own left quarter), past the last row it is outside the table (typed arrays drop it)
      e *= 5;
      t[e] = a; t[e + 1] = b; t[e + 2] = c; t[e + 3] = d; t[e + 4] = src;
    };
    for (let j = 0; j <= cy; j++) {
      for (let i = 0; i <= cx; i++) {
        const dist = Math.sqrt(i * i + j * j);
        const f = dist > 1 ? (1 - amount / dist) * k98 + k01 : 0;
        const sx = Math.trunc(i * f * 256), sy = Math.trunc(j * f * 256), fx = sx & 255, fy = sy & 255;
        const A = (256 - fx) * (256 - fy), B = (256 - fx) * fy, C = fx * fy, D = fx * (256 - fy);
        const ix = Math.trunc(i * f), iy = Math.trunc(j * f);
        put((cy - j) * w + cx - i, C, D, A, B, at(cx - ix - 1, cy - iy - 1));
        if (cx + i < w) put((cy - j) * w + cx + i, B, A, D, C, at(cx + ix, cy - iy - 1));
        if (cy + j < h) {
          put((cy + j) * w + cx - i, D, C, B, A, at(cx - ix - 1, cy + iy));
          put((cy + j) * w + cx + i, A, B, C, D, at(cx + ix, cy + iy));
        }
      }
    }
  }

  /** 0x41f6a0: dst[p] = the weighted sum of its four source pixels >> 16, per channel */
  apply(src: Uint32Array, dst: Uint32Array): void {
    const t = this.t, w = this.w, n = dst.length;
    for (let p = 0, e = 0; p < n; p++, e += 5) {
      const s = t[e + 4];
      if (s < 0) continue;
      const a = src[s], b = src[s + w], c = src[s + w + 1], d = src[s + 1];
      const wa = t[e], wb = t[e + 1], wc = t[e + 2], wd = t[e + 3];
      dst[p] = ((((a >>> 16) & 255) * wa + ((b >>> 16) & 255) * wb + ((c >>> 16) & 255) * wc + ((d >>> 16) & 255) * wd) >>> 16) << 16 |
        ((((a >>> 8) & 255) * wa + ((b >>> 8) & 255) * wb + ((c >>> 8) & 255) * wc + ((d >>> 8) & 255) * wd) >>> 16) << 8 |
        (((a & 255) * wa + (b & 255) * wb + (c & 255) * wc + (d & 255) * wd) >>> 16);
    }
  }
}

export interface BlackflyConfig {
  width?: number;
  height?: number;
  options?: object;
  preset?: number;
  seed?: number;
}

/** TVizShell + TVizDIB32Double. A plug-in overrides draw() (its Render, which draws into the front and ends
 *  in the inherited Render: this class's present step). Pixels are 0x00RRGGBB, rows top-down. */
export abstract class BlackflyViz {
  declare options: object;
  declare preset: number;
  declare w: number;
  declare h: number;
  /** the window size the next Render sees (the DLL learns it from Render's RECT) */
  declare viewW: number;
  declare viewH: number;
  /** TVizShell's frame counter (+0x48): Renders so far */
  declare frame: number;
  declare rnd: DelphiRandom;
  declare front: Uint32Array;
  declare back: Uint32Array;

  constructor(cfg: BlackflyConfig, readonly presetCount: number) {
    this.options = cfg.options || {};
    this.preset = 0;
    this.w = this.h = 0;
    this.viewW = cfg.width || 640;
    this.viewH = cfg.height || 480;
    this.frame = 0;
    this.rnd = new DelphiRandom();
    this.rnd.seed = (cfg.seed || 0) >>> 0;
    this.front = this.back = new Uint32Array(0);
    this.setPreset(cfg.preset || 0);
  }

  /** IWMPEffects::Render (TVizShell, 0x41ced4) */
  render(level: TimedLevel): Surface {
    if (this.viewW !== this.w || this.viewH !== this.h) {
      this.w = this.viewW;
      this.h = this.viewH;
      this.resized();
    }
    this.draw(level);
    // TVizDIB32Double.Render (0x41f11c): BitBlt the front, then front -> back
    this.back.set(this.front);
    this.frame++;
    return { w: this.w, h: this.h, px: this.front };
  }

  /** TVizDIB32Double's resize hook (0x41f19c): both DIBs made anew, black (PatBlt BLACKNESS) */
  protected resized(): void {
    this.front = new Uint32Array(this.w * this.h);
    this.back = new Uint32Array(this.w * this.h);
  }

  protected abstract draw(level: TimedLevel): void;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** IWMPEffects::SetCurrentPreset (0x41d01c); WMP offers 0..count-1 */
  setPreset(n: number): boolean {
    if (!(n >= 0 && n < this.presetCount)) return false;
    this.preset = n | 0;
    return true;
  }

  /** RandSeed: the DLL's starts at 0 when it loads */
  seed(n: number): void {
    this.rnd.seed = n >>> 0;
  }

  debug(): Record<string, unknown> {
    return { preset: this.preset, w: this.w, h: this.h, frame: this.frame, randSeed: this.rnd.seed };
  }
}
