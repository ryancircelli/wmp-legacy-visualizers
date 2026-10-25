// Alchemy.Shacojin — "Shacojin" (shacojin.dll 1.0.0.1, 2000-04: the Windows Media Player 7 Bonus Pack), four presets,
// "mello", "groove", "chill" and "freak": rings of arcs sized by the spectrum and three passes of a wandering line,
// in thick to thin pens, drawn with plain GDI calls straight onto the player's DC. Nothing clears the picture except
// the beat: a loud enough frame repaints it with one solid rectangle. IWMPEffects only, no rand, no clock.
//
// The numbers in the comments are the DLL's own addresses (0x1000xxxx) and its object's offsets from the IWMPEffects
// pointer: the constructor 0x10001000, Render 0x10001080, SetCurrentPreset 0x10001b10. ../gdi is the GDI
// rasterizer it draws through.
import { A, type Surface, type TimedLevel } from '../ns';
import { Gdi } from '../gdi';
import { sin87, cos87, ftol } from '../goom/fpu';
import { mulExt } from '../plenoptic/x87';

declare module '../ns' {
  interface AlchemyNS {
    Shacojin: typeof Shacojin;
  }
}

const PRESET_NAMES: string[] = ['Shacojin - mello', 'Shacojin - groove', 'Shacojin - chill', 'Shacojin - freak'];
/** SetCurrentPreset's table: the angle divisor (+0x40), the colour divisor (+0x30), the beat divisor (+0x44) */
const PRESETS: [number, number, number][] = [[160, 200, 8], [60, 300, 7], [300, 400, 8], [2, 10, 6]];

export interface ShacojinConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

// ---- FLDLN2; FILD n; FYL2X: ln n as the x87 leaves it. FYL2X is not correctly rounded: ln 2 rounded to 64 bits
// times log2 n, rounded to 64 bits, is the CPU's (an i7-11370H) for every n = 2..256 but FYL2X_LOW, where the CPU's
// result is one 64-bit ulp lower. Built once in BigInt fixed point as [hi, lo] doubles (hi + lo exact); checked
// against the CPU for every n, and the Render sequence that uses it for every view size up to 4000.
const FB = 192n, ONE = 1n << FB;
function atanh(p: bigint, q: bigint): bigint {       // atanh(p / q), p / q <= 1/3
  let t = (ONE * p) / q, s = t, k = 1n;
  while (t !== 0n) { t = (t * p * p) / (q * q); s += t / (2n * k + 1n); k++; }
  return s;
}
function round64(v: bigint): bigint {                // nearest-even to 64 significant bits (v > 0)
  const sh = BigInt(v.toString(2).length - 64);
  if (sh <= 0n) return v;
  const q = v >> sh, r = v - (q << sh), h = 1n << (sh - 1n);
  return (r > h || (r === h && (q & 1n)) ? q + 1n : q) << sh;
}
const toNum = (v: bigint): number => Number(v) / 2 ** Number(FB);   // exact for <= 53 significant bits
const FYL2X_LOW = [21, 42, 88, 115, 148, 183, 185, 193, 213, 227, 233, 238, 242];
const LN_HI = new Float64Array(257), LN_LO = new Float64Array(257);
{
  const ln2 = 2n * atanh(1n, 3n), ln2x = round64(ln2);
  for (let n = 2; n <= 256; n++) {
    const k = 31 - Math.clz32(n), p = 1 << k;
    const ln = BigInt(k) * ln2 + 2n * atanh(BigInt(n - p), BigInt(n + p));
    let v = round64((ln2x * ((ln * ONE) / ln2)) / ONE);
    if (FYL2X_LOW.includes(n)) v -= 1n << BigInt(v.toString(2).length - 64);
    const sh = BigInt(v.toString(2).length - 53), hi = sh > 0n ? (v >> sh) << sh : v;
    LN_HI[n] = toNum(hi); LN_LO[n] = toNum(v - hi);
  }
}

class Shacojin {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: Record<string, unknown>;
  private gdi: Gdi;
  // the DLL's object (offsets from the IWMPEffects pointer), as its constructor leaves it
  private frame = 0;            // +0x10: frames since the last repaint
  private lastR = 0;            // +0x24, +0x28: the view's right and bottom at the last Render
  private lastB = 0;
  private hue = 0;              // +0x2c: the colour phase, 0..2294
  private hueDiv = 90;          // +0x30
  private angle = 120;          // +0x34: degrees
  private bass = 0;             // +0x3c: running bass level
  private angDiv = 200;         // +0x40
  private beatDiv = 8;          // +0x44
  private kx = 1;               // +0x4c: right * 0.00125
  private ky = 1;               // +0x54: bottom * 0.00125
  private frames = 0;

  constructor(cfg: ShacojinConfig = {}) {
    this.w = cfg.width || 640; this.h = cfg.height || 480;
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.gdi = new Gdi(this.w, this.h);
    // the player calls SetCurrentPreset before the first Render (the constructor's divisors are no preset's)
    this.setPreset(cfg.preset ?? 0);
  }

  /** no rand: kept for the engine interface */
  seed(_n: number): this { return this; }

  /** a new DC: the picture starts black again (the DLL notices the size on its next Render) */
  resize(w: number, h: number): void {
    w = w | 0; h = h | 0;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.gdi = new Gdi(w, h);
  }

  /** SetCurrentPreset (0x10001b10): the three divisors only, nothing else is reset */
  setPreset(n: number): boolean {
    if (n < 0 || n > 3) return false;
    this.preset = n | 0;
    [this.angDiv, this.hueDiv, this.beatDiv] = PRESETS[n];
    return true;
  }

  /** Render (0x10001080) */
  render(level: TimedLevel): Surface | null {
    const g = this.gdi, f = level.freq[0], R = this.w, B = this.h;
    if (B !== this.lastB || R !== this.lastR) {
      this.lastR = R; this.lastB = B; this.bass = 0;
      this.kx = R * 0.00125; this.ky = B * 0.00125;
    }
    const b3 = 3 * (f[0] + f[1]);
    const v1 = (f[2] + f[3] + 2 * (f[5] + f[10])) >> 2;      // all sums >= 0: C's / 4 is a shift
    const v2 = (b3 + 10 * (f[50] + f[200])) >> 2;
    this.bass = (this.bass + b3) >> 1;
    this.hue = (((v2 / this.hueDiv) | 0) + this.hue) % 2295;
    const a = v1 / this.angDiv + this.angle;
    this.angle = a > 360 ? a - 360 : a;
    const rad = 3.1415926535 * this.angle * 0.005555555555555556;
    const sin = sin87(rad), cos = cos87(rad);
    const cx = R >> 1, cy = B >> 1;                          // view sizes are >= 0
    const c = this.hue;

    // the beat: one solid rectangle in the hue's colour, outlined by the DC's own pen (black)
    if ((b3 - this.bass > ((this.bass / this.beatDiv) | 0) || this.bass === 0) && this.frame > 4) {
      g.rectangle(0, 0, R, B, ((((23 * c) % 240) + 15) << 16) | (((((c / 5) | 0) % 240) + 15) << 8) | ((c % 240) + 15), 0);
      this.frame = 0;
    }

    let sx = 1, sy = 1, x = cx, y = cy, scale = 0.6, dx = 0, dy = 0;
    for (let it = 5; it <= 15; it += 5) {
      const s = 255 / ((15 - it) * 4 + 255);
      const pen = ((ftol((c % 255) * s) & 0xff) << 16) | ((ftol((((c / 3) | 0) % 255) * s) & 0xff) << 8) |
        (ftol((((c / 9) | 0) % 255) * s) & 0xff);
      const width = it === 5 ? 5 : 7 - ((2 * it / 5) | 0);
      // Arc(x1, y1, 2cx - x1, 2cy - y1) with both radials at (x1, y1): a full ellipse from its top-left
      for (let i = 25; i < 250; i += 25) {
        const p = f[i], q = f[i + 256];
        if (p === q) continue;
        const x1 = ftol(cx - mulExt(this.kx, LN_HI[p + 1], LN_LO[p + 1]) * 10);
        const y1 = ftol(cy - mulExt(this.ky, LN_HI[q + 1], LN_LO[q + 1]) * 10);
        g.arc(x1, y1, 2 * cx - x1, 2 * cy - y1, pen, width);
      }
      for (let i = 0; i < 250; i++) {
        const fx = f[i + 256 * (i & 1)], fy = f[i + 256 * ((i + 1) & 1)];
        if (i % 10 === 0) sx = -sx;
        if (i % 15 === 0) sy = -sy;
        if (i % 50 === 0) {
          g.moveTo(cx, cy);
          scale = 0.6;
          x = ftol(fx * sx * sin * 0.6 + cx);
          y = ftol(fy * sy * cos * 0.6 + cy);
          dx = sx * sin; dy = sy * cos;
        } else {
          if (i % 10 === 0) sx = -sx;
          if (i % 12 === 0) sy = -sy;
          const ox = x, oy = y;
          x = ftol(fx * sx * scale * dx + ox);
          y = ftol(fy * sy * scale * dy + oy);
          if (x !== ox) dx = (x - ox) / Math.sqrt((y - oy) * (y - oy) + (x - ox) * (x - ox));
          if (y !== oy) dy = (y - oy) / Math.sqrt((y - oy) * (y - oy) + (x - ox) * (x - ox));
        }
        g.wideLineTo(x, y, pen, width);
        scale *= 0.8333333333333334;
      }
    }
    this.frame++;
    this.frames++;
    return { w: R, h: B, px: g.px };
  }

  debug(): Record<string, unknown> {
    return { engine: 'Shacojin', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frames: this.frames };
  }
}

A.Shacojin = Shacojin;
export { Shacojin };
