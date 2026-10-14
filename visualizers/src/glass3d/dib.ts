// The 8-bit DIB Glass3D's plug-ins draw into (Animator 2.2: object 0x2284fc bytes made by 0x10014ae0 ->
// 0x100150f0 / 0x100152d0 / 0x10015290). Memory row 0 is the picture's bottom (a bottom-up DIB), rows are
// `stride` = width rounded up to 4, plus 4, bytes apart, and there are height + 2 of them. Drawing is clipped to
// (1, 1, w - 2, h - 2). The object keeps 65,536 rand() values (filled at creation) that the "sparkle" drawing
// thresholds against. The 16- and 32-bit paths of the DLL are dead here (the DIB is always 8-bit) and not ported.
import type { Lcg } from './lcg';

/** the line code's first step: bits 30 and 31 of a coordinate both become its sign */
const fold = (v: number): number => ((v >> 1) & 0xc0000000) | (v & 0x3fffffff);

export class Dib {
  /** +0x40004: width rounded up to 4; +0x40008: height; +0x40018: bytes per row (+0x40014, bytes per pixel, is 1) */
  readonly w: number;
  readonly h: number;
  readonly stride: number;
  /** the pixels, stride * (h + 2) bytes, memory row 0 = bottom */
  readonly bits: Uint8Array;
  /** +4: rand() values, 65,536 of them (in the DLL the last is then overwritten by the DC handle; nothing reads it) */
  readonly rt = new Int32Array(65536);
  /** +0x4000c..+0x40012: the clip rectangle (shorts) */
  clipL: number; clipT: number; clipR: number; clipB: number;
  /** +0x40020: brush width 1..32 */
  brush = 1;
  /** +0x4001c: the sparkle fill's colour (never changed after creation) */
  colour = 0;
  /** the sparkle threshold: a pixel of a thick line or a fill is painted when its rand() value is below it, and
   *  0xffff or more paints solid (Animator: global 0x10029358, initially 0xffff, set by 0x10014d30) */
  thresh = 0xffff;
  /** the colour table SetDIBColorTable got (BGRX) */
  readonly palette = new Uint8Array(1024);

  /** 0x10014ae0(0, width, height, 8): the rand() table first, then the bitmap and the clip */
  constructor(width: number, height: number, private readonly rng: Lcg) {
    for (let i = 0; i < 65536; i++) this.rt[i] = rng.rand();
    if (width < 0) width = 0;
    if (height < 0) height = 0;
    this.w = ((width + 3) >> 2) * 4;
    this.h = height;
    this.stride = this.w + 4;
    this.bits = new Uint8Array(this.stride * (height + 2));
    // 0x10015240(null) then 0x10015290(1, 1, w - 2, h - 2): the intersection (0x10019cd0)
    this.clipL = 1; this.clipT = 1;
    this.clipR = Math.min(width - 2, this.w);
    this.clipB = Math.min(height - 2, height);
  }

  /** 0x10015430 (SetDIBColorTable, 256 entries) */
  setPalette(p: Uint8Array): void {
    this.palette.set(p.subarray(0, 1024));
    for (let i = 0; i < 256; i++) this.p32[i] = (p[4 * i + 2] << 16) | (p[4 * i + 1] << 8) | p[4 * i];
  }
  private readonly p32 = new Uint32Array(256);
  /** the colour table as 0xRRGGBB */
  pal32(): Uint32Array { return this.p32; }

  /** 0x100156b0 */
  setBrush(n: number): void { this.brush = n < 1 ? 1 : n > 32 ? 32 : n; }

  /** 0x10016190: the line (x0, y0)-(x1, y1) in colour c, `brush` wide, picture y up. A wide line starts with a
   *  round cap at whichever end lies inside the clip (none inside: nothing drawn), then sweeps a span `lw` pixels
   *  across the major axis; below `thresh` 0xffff each pixel is kept only where its rand() table entry is below
   *  the threshold, the entries read in sequence from a rand() start. One rand() per line drawn. */
  line(px0: number, py0: number, px1: number, py1: number, c: number): void {
    const x0 = fold(px0 | 0), y0 = fold(py0 | 0), x1 = fold(px1 | 0), y1 = fold(py1 | 0);
    const W = this.brush;
    let lw = W;
    if (W > 3) {
      // diagonal lines get wider (up to 183/128) so they look as thick as straight ones
      const dx2 = Math.imul(x1 - x0, x1 - x0), dy2 = Math.imul(y1 - y0, y1 - y0);
      if (dx2 > 0 && dx2 >= dy2) lw = ((Math.imul(dy2, 55) / dx2) | 0) + 128;
      else if (dy2 > 0 && dy2 > dx2) lw = ((Math.imul(dx2, 55) / dy2) | 0) + 128;
      if (dx2 > 0 || dy2 > 0) lw = (Math.imul(W, lw) + 64) >> 7;
    }
    const hw = lw >> 1, L = this.clipL + hw, T = this.clipT + hw, R = this.clipR - hw, B = this.clipB - hw;
    let sx: number, sy: number, ex: number, ey: number;
    if (x0 >= L && x0 < R && y0 >= T && y0 < B) { sx = x0; sy = y0; ex = x1; ey = y1; }
    else if (x1 >= L && x1 < R && y1 >= T && y1 < B) { sx = x1; sy = y1; ex = x0; ey = y0; }
    else return;
    const st = this.stride, bits = this.bits, rt = this.rt;
    // nx, ny: steps left before the far end or the clip edge; xs, ys: the pointer steps
    let adx = (ex - sx) | 0, ady = (ey - sy) | 0, nx: number, ny: number, xs: number, ys: number;
    if (adx < 0) {
      adx = -adx; nx = adx; xs = -1;
      if (sx - adx < L) nx = sx - L;
    } else {
      nx = adx;
      if (adx > 0) { if (adx + sx >= R) nx = R - sx - 1; xs = 1; } else xs = 0;
    }
    if (ady < 0) {
      ady = -ady; ny = ady; ys = st;
      if (sy - ady < T) ny = sy - T;
    } else {
      ny = ady; ys = -st;
      if (ady + sy >= B) ny = B - sy - 1;
    }
    let p = (this.h - sy - 1) * st + sx;
    let tp = this.rng.rand();
    let e = 0;
    if (lw < 2) {
      if (adx < ady) {
        while (ny >= 0) {
          if (nx < 0) return;
          bits[p] = c; e += adx; p += ys;
          if (e >= ady) { e -= ady; p += xs; nx--; }
          ny--;
        }
      } else if (nx >= 0) {
        while (ny >= 0) {
          bits[p] = c; e += ady; p += xs;
          if (e >= adx) { e -= adx; p += ys; ny--; }
          if (--nx < 0) return;
        }
      }
      return;
    }
    const thr = this.thresh, sparkle = thr < 0xffff;
    // the cap: a disc `W` wide (row r spans [inset, W - inset)) centred on the start
    const hb = W >> 1;
    for (let r = 0; r < W; r++) {
      const inset = capInset(W, r), end = W - inset;
      if (inset >= end) continue;
      const q = p + st * (r - hb) - hb;
      if (sparkle) {
        let k = tp;
        tp += end - inset;
        for (let j = inset; j < end; j++) if (rt[k++] < thr) bits[q + j] = c;
      } else bits.fill(c, q + inset, q + end);
    }
    if (ady < adx) {
      // x-major: a vertical span lw pixels high per column
      if (nx < 0) return;
      while (ny >= 0) {
        let q = p - st * hw;
        for (let j = 0; j < lw; j++, q += st) if (!sparkle || rt[tp + j] < thr) bits[q] = c;
        if (sparkle) tp += lw;
        p += xs; e += ady;
        if (e >= adx) { e -= adx; p += ys; ny--; }
        if (--nx < 0) return;
      }
    } else {
      if (ny < 0) return;
      let q = p - hw;
      while (nx >= 0) {
        if (sparkle) { for (let j = 0; j < lw; j++) if (rt[tp + j] < thr) bits[q + j] = c; tp += lw; }
        else bits.fill(c, q, q + lw);
        e += adx; q += ys;
        if (e >= ady) { e -= ady; q += xs; nx--; }
        if (--ny < 0) return;
      }
    }
  }

  /** 0x10014d40 -> 0x10016b20: sparkle-fill the rectangle [l, r] x [t, b] (picture y up, clipped; null = the
   *  whole clip) with `colour` at threshold thr: one rand() per row picks where in the table the row starts */
  sparkle(rect: readonly [number, number, number, number] | null, thr: number): void {
    let l: number, t: number, r: number, b: number;
    if (rect === null) { l = this.clipL; t = this.clipT; r = this.clipR; b = this.clipB; }
    else {
      const cl = this.clipL, ct = this.clipT, cr = this.clipR, cb = this.clipB;
      l = rect[0] < cl ? cl : rect[0] > cr ? cr : rect[0];
      t = rect[1] < ct ? ct : rect[1] > cb ? cb : rect[1];
      r = rect[2] < cl ? cl : rect[2] > cr ? cr : rect[2];
      b = rect[3] < ct ? ct : rect[3] > cb ? cb : rect[3];
    }
    const st = this.stride, n = r - l;
    let p = (this.h - b) * st + l;
    for (let y = b - t; y >= 0; y--, p += st) {
      const k = this.rng.rand();
      for (let j = 0; j <= n; j++) if (this.rt[k + j] < thr) this.bits[p + j] = this.colour;
    }
  }
}

/** the round cap's per-row inset (the DLL's tables at 0x10029380.. for widths 2..11, FSQRT above). The small
 *  widths are the pixels whose centre has |(2r - W + 1, 2j - W + 1)|^2 <= W*W - 2 (W*W - 6 for width 11, whose
 *  hand-drawn table is a little rounder). */
function capInset(W: number, r: number): number {
  if (W >= 12) {
    const h = W >> 1, d = r - h;
    return h - Math.trunc(Math.sqrt(h * h - d * d));
  }
  const di = (2 * r - W + 1) ** 2, lim = W * W - (W === 11 ? 6 : 2);
  let j = 0;
  while (j < W && di + (2 * j - W + 1) ** 2 > lim) j++;
  return j === W ? (W + 1) >> 1 : j;
}
