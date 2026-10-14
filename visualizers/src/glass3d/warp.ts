// Glass3D's warp map (Animator 2.2: object 0x6c bytes made by 0x100147a0/0x10014840, rows built by 0x100148c0, applied
// by 0x10019a60/0x10019940). For every pixel a pair of callbacks maps the pixel's normalised position (x, y in about
// [-1, 1], or polar r, theta) to where its colour comes from; the map stores that source as a 1/32-pixel offset,
// and each frame the 8-bit picture is resampled through it bilinearly and darkened by 31/32.
//
// Entry layout (24 bits, the DLL keeps them 3 bytes apart): bits 0-11 = row offset + 63 px, bits 12-23 = column offset
// + 63 px, both in 1/32 px (so 0x7e07e0 = "stay"). The border rows and columns are always "stay"; offsets are
// clamped so the source stays inside the picture.
import { f32, ftol, sincos87, atan2_87, f32x, mulExt } from './fpu';

/** a callback: reads m.x, m.y (floats) or m.r, m.theta (polar maps) and the parameters, returns the new x (or r)
 *  for fn1 and the new y (or theta) for fn2, as the double its last x87 op left (the caller rounds where the DLL
 *  does). A callback whose last op is FSIN/FCOS/FPATAN may set m.lo to the 64-bit remainder (else leave it 0). */
export type WarpFn = (m: WarpMap) => number;

const STAY = 0x7e07e0;
const ATN = new Float64Array(2), SC = new Float64Array(4);

export class WarpMap {
  // +0x00..+0x0c: the current pixel, floats
  x = 0; y = 0; r = 0; theta = 0;
  // +0x10..+0x20: the effect's five parameters (floats or ints as the setup passed them)
  p1 = 0; p2 = 0; p3 = 0; p4 = 0; p5 = 0;
  /** +0x48: callbacks take (r, theta) and return (r', theta') */
  polar: boolean;
  /** +0x4c: square pixels (both scales = the larger of 2/W, 2/H) */
  square: boolean;
  /** extended remainder of a callback's return value (see WarpFn) */
  lo = 0;
  /** +0x24, +0x28 */
  w = 0; h = 0;
  /** +0x34: rows built so far; +0x38: the most negative row offset (1/32 px); +0x64: rows of look-back the apply needs */
  row = -1; minDy = 0; back = 0;
  /** +0x3c, +0x40: per-pixel scales (sy negative: memory row 0 is the picture's bottom) */
  sx = 0; sy = 0;
  data: Int32Array = new Int32Array(0);
  /** anything a family wants to hang on the map for its callbacks (Animator: its engine state) */
  ctx: unknown = null;

  constructor(public fn1: WarpFn, public fn2: WarpFn, p: number[], polar: boolean, square: boolean) {
    this.p1 = p[0]; this.p2 = p[1]; this.p3 = p[2]; this.p4 = p[3]; this.p5 = p[4];
    this.polar = polar; this.square = square;
  }

  /** 0x10014840: size it to the picture and start at row 0 */
  begin(w: number, h: number): void {
    this.w = w; this.h = h;
    if (this.data.length < w * h) this.data = new Int32Array(w * h);
    const kx = 2 / w;
    this.sx = f32(kx);
    this.sy = f32(2 / h);
    if (this.square) { if (this.sy <= kx) this.sy = this.sx; else this.sx = this.sy; }
    this.sy = f32(this.sy * -1);
    this.row = 0; this.minDy = 0;
  }

  get done(): boolean { return this.row === this.h; }

  /** 0x100148c0: build one row (no-op once complete) */
  step(): void {
    const w = this.w, h = this.h, row = this.row, d = this.data;
    let o = row * w;
    if (row === 0 || row === h - 1) {
      for (let i = 0; i < w; i++) d[o + i] = STAY;
      this.row++;
    } else if (row > 0 && row < h - 1) {
      this.y = f32((h - 2 * row) * this.sy * 0.5);
      const ix = f32(32 / this.sx), iy = f32(32 / this.sy);
      d[o++] = STAY;
      for (let i = 1; i < w - 1; i++) {
        const v = (2 * i - w) * this.sx * 0.5;
        this.x = f32(v);
        let X: number, Y: number;
        this.lo = 0;
        if (this.polar) {
          const y = this.y;
          this.r = f32(Math.sqrt(v * v + y * y));
          atan2_87(y, v, ATN); this.theta = f32x(ATN[0], ATN[1]);
          const r1 = f32x(this.fn1(this), this.lo);
          this.lo = 0;
          const t1 = this.fn2(this);
          sincos87(t1 + this.lo, SC);   // ponytail: FCOS/FSIN of a 64-bit theta' taken at 53 bits; exact when lo = 0
          X = f32(mulExt(r1, SC[2], SC[3]));
          Y = mulExt(r1, SC[0], SC[1]);
        } else {
          X = f32x(this.fn1(this), this.lo);
          this.lo = 0;
          Y = this.fn2(this);
          Y += this.lo;                 // ponytail: y - Y' then rounds twice when fn2 leaves a 64-bit value
        }
        let ex = ftol((X - this.x) * ix);
        let ey = ftol((this.y - Y) * iy);
        const cx = (ex >> 5) + i;
        if (cx >= w - 1) ex = (w - i - 1) * 32; else if (cx < 0) ex = -i * 32;
        const cy = (ey >> 5) + row;
        if (cy >= h - 1) ey = (h - row - 1) * 32; else if (cy < 0) ey = -row * 32;
        if (ey < this.minDy) this.minDy = ey;
        d[o++] = ((ex + 0x7e0) << 12 | (ey + 0x7e0)) & 0xffffff;
      }
      d[o] = STAY;
      this.row++;
    }
    if (this.row === h) this.back = 1 - (this.minDy >> 5);
  }

  /** 0x10014810: finish every remaining row */
  finish(): void { if (this.row >= 0) while (this.row !== this.h) this.step(); }
}

let tmp = new Uint8Array(0);
/** 0x10019a60: resample the w x h 8-bit picture (rows `stride` bytes apart, row 0 first in memory) through the map.
 *  The DLL works in place with a ring of `back` rows; no source row is ever one it has already written, so this
 *  reads a copy instead. */
export function applyWarp(bits: Uint8Array, stride: number, w: number, h: number, m: WarpMap): void {
  const n = stride * (h + 2);
  if (tmp.length < n) tmp = new Uint8Array(n);
  tmp.set(bits.subarray(0, n));
  const d = m.data, mw = m.w;
  for (let r = 0; r < h; r++) {
    const base = (r - 63) * stride - 63, out = r * stride;
    let e = r * mw;
    for (let c = 0; c < w; c++) {
      const v = d[e++];
      const fy = v & 31, fx = (v >> 12) & 31;
      const p = base + ((v >> 17) & 0x7f) + c + ((v & 0xfff) >> 5) * stride;
      bits[out + c] = (((tmp[p + stride] * fy + tmp[p] * (32 - fy)) * (32 - fx) +
        (tmp[p + stride + 1] * fy + tmp[p + 1] * (32 - fy)) * fx) * 31) >> 15;
    }
  }
}
