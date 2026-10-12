// Plenoptic's surface object (WMP 10 wmp.dll; VAs are WMP 10's, WMP 9's in brackets): a 32bpp pixel
// buffer plus the per-surface drawing state every primitive reads. Memory order is the DLL's: row 0 is
// the BOTTOM row of the picture (the screen surface is a bottom-up DIB), x runs left to right.
// Pixels are 0xAARRGGBB little-endian (bytes B, G, R, A). The DLL takes the MMX paths (cpuid bit 23,
// 0x7876115 [0x797c4cc]), which also carry the alpha byte along; it is kept here so nothing differs.

import { sincos87, mulExt } from './x87';

/** circleWave's 1025 angles i*2pi/1024 never change: their fsin/fcos once, [sinHi, sinLo, cosHi, cosLo] each */
var CIRCLE: Float64Array | null = null;
function circleTable(): Float64Array {
  if (CIRCLE) return CIRCLE;
  var t = new Float64Array(1025 * 4), sc = new Float64Array(4);
  for (var i = 0; i <= 1024; i++) {
    sincos87(i * 6.283185307179586 * 0.0009765625, sc);
    t.set(sc, i * 4);
  }
  return (CIRCLE = t);
}

/** _ftol (msvcrt, 0x7539155): truncation toward zero, the low dword of the int64; NaN or out of int64 range -> 0. */
export function ftol(v: number): number {
  if (v > -2147483649 && v < 2147483648) return v | 0;
  if (!(v > -9223372036854775808 && v < 9223372036854775808)) return 0;
  var t = Math.trunc(v);
  return (t - Math.floor(t / 4294967296) * 4294967296) | 0;
}

/** The 256x256 scaling table each surface builds in its constructor (0x78731fc [0x797957a]): MUL[a*256+b] = a*b >> 8. */
export const MUL = new Uint8Array(65536);
for (var a = 0; a < 256; a++) for (var b = 0; b < 256; b++) MUL[a * 256 + b] = (a * b) >> 8;

export class Surf {
  w = 0;
  h = 0;
  px: Uint32Array = new Uint32Array(0);
  b: Uint8Array = new Uint8Array(0);
  /** +0x380: how plot/line/blit combine with what is there: 0 store, 1 add (saturating), 2 average */
  mode = 0;
  /** +0x384 / +0x388..: setLut's per-channel scale (B, G, R bytes of the colour), applied by blit */
  lutOn = false;
  lutB = 0;
  lutG = 0;
  lutR = 0;
  /** +0x1038c: subtracted from every channel by blur() */
  decay = 0;

  /** setSize + setBpp(32) + alloc (0x78731b4, 0x78731db, 0x78747e6). The DLL's buffer is fresh heap; zeroed here. */
  alloc(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
    this.b = new Uint8Array(this.px.buffer);
  }

  /** reset, 0x7874737 [0x797aab1]: mode, LUT flag and decay back to 0 (the LUT bytes are left as they were) */
  reset(): void {
    this.mode = 0;
    this.lutOn = false;
    this.decay = 0;
  }

  /** match, 0x7875aa7 [0x797bc26]: take src's size, reallocating only when it differs */
  match(src: Surf): void {
    if (this.w !== src.w || this.h !== src.h) this.alloc(src.w, src.h);
  }

  /** setLut, 0x7876373 [0x797c6f5]: colour 0 turns the table off */
  setLut(c: number): void {
    if ((c | 0) === 0) { this.lutOn = false; return; }
    this.lutB = c & 255;
    this.lutG = (c >>> 8) & 255;
    this.lutR = (c >>> 16) & 255;
    this.lutOn = true;
  }

  /** fill, 0x7874ca6 [0x797b01f] (32bpp) */
  fill(c: number): void {
    this.px.fill(c >>> 0);
  }

  /** plot, 0x7874da6 [0x797b11e]: no clipping, exactly as the DLL */
  plot(x: number, y: number, c: number): void {
    var i = this.w * y + x;
    var m = this.mode;
    if (m === 0) { this.px[i] = c; return; }
    var b = this.b, o = i << 2, v;
    if (m === 1) {                                   // paddusb, all four bytes
      v = b[o] + (c & 255); b[o] = v > 255 ? 255 : v;
      v = b[o + 1] + ((c >>> 8) & 255); b[o + 1] = v > 255 ? 255 : v;
      v = b[o + 2] + ((c >>> 16) & 255); b[o + 2] = v > 255 ? 255 : v;
      v = b[o + 3] + (c >>> 24); b[o + 3] = v > 255 ? 255 : v;
    } else if (m === 2) {
      b[o] = (b[o] + (c & 255)) >> 1;
      b[o + 1] = (b[o + 1] + ((c >>> 8) & 255)) >> 1;
      b[o + 2] = (b[o + 2] + ((c >>> 16) & 255)) >> 1;
    }
  }

  /** line, 0x7875422 [0x797b7b7]: endpoints in 0..1, scaled by (w-1, h-1) and truncated; Bresenham */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    var wm = this.w - 1, hm = this.h - 1;
    var X0 = ftol(x0 * wm), X1 = ftol(x1 * wm), Y0 = ftol(y0 * hm), Y1 = ftol(y1 * hm);
    var dx = X1 - X0, dy = Y1 - Y0;
    var ax = (dx < 0 ? -dx : dx) * 2, ay = (dy < 0 ? -dy : dy) * 2;
    var sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
    var x = X0, y = Y0, e;
    if (ax > ay) {
      e = ay - (ax >> 1);
      this.plot(x, y, c);
      while (x !== X1) {
        if (e >= 0) { y += sy; e -= ax; }
        x += sx; e += ay;
        this.plot(x, y, c);
      }
    } else {
      e = ax - (ay >> 1);
      this.plot(x, y, c);
      while (y !== Y1) {
        if (e >= 0) { x += sx; e -= ay; }
        y += sy; e += ax;
        this.plot(x, y, c);
      }
    }
  }

  /** blur, 0x7874af9 [0x797ae73]: dst[i] = (up + down + left + right) / 4 - this.decay per byte, for
   *  i from w+1 over (h-2)*w - 2 pixels, rows treated as one run. dst may be this (in place, in order).
   *  The DLL's MMX loop works a pixel at a time; here a pixel's four bytes go two lanes at a time. */
  blur(dst: Surf): void {
    var s = this.px, d = dst.px, w = this.w, dec = this.decay, D = dec | (dec << 16), M = 0x00ff00ff;
    var i = w + 1, end = i + (((this.h - 1) * w - 1) * 4 - (w + 1) * 4) / 4 | 0;
    for (; i < end; i++) {
      var u = s[i - w], n = s[i + w], l = s[i - 1], r = s[i + 1];
      var a = ((((u & M) + (n & M) + (l & M) + (r & M)) >>> 2) & M | 0x01000100) - D;          // B, R (+ guard bits)
      var b = (((((u >>> 8) & M) + ((n >>> 8) & M) + ((l >>> 8) & M) + ((r >>> 8) & M)) >>> 2) & M | 0x01000100) - D;   // G, A
      a &= ((a >>> 8) & 0x00010001) * 0xff;                // lanes that went below the guard: 0
      b &= ((b >>> 8) & 0x00010001) * 0xff;
      d[i] = (a & M | (b & M) << 8) >>> 0;
    }
  }

  /** zoom, 0x787498c [0x797ad08]: dst = this scaled by z about the centre, 21.11 fixed point, nearest */
  zoom(dst: Surf, z: number): void {
    var w = this.w, h = this.h;
    var inv = 1 / z;
    var x0 = (w / -2) | 0, x1 = w >> 1, y0 = (h / -2) | 0, y1 = h >> 1;
    var step = ftol(inv * 2048);
    var fx = ftol(x0 * inv * 2048 + x1 * 2048) + 1024;
    var fy = ftol(y0 * inv * 2048 + y1 * 2048) + 1024;
    var s = this.px, d = dst.px, k = 0;
    for (var y = y0; y < y1; y++) {                       // fx, fy, step and acc stay well inside int32
      var row = (fy >> 11) * w, acc = fx;
      for (var x = x0; x < x1; x++) {
        d[k++] = s[row + (acc >> 11)];
        acc += step;
      }
      fy += step;
    }
  }

  /** circleWave, 0x7875ae5 [0x797bc5f]: 1024 segments, radius wave[i]*r/256 about (cx, cy); fcos/fsin
   *  multiplied in the register (x87.ts) */
  circleWave(cx: number, cy: number, r: number, wave: Uint8Array, c: number): void {
    var px = 0, py = 0, t = circleTable();
    for (var i = 0, k = 0; i <= 1024; i++, k += 4) {
      var rr = wave[i & 0x3ff] * r * 0.00390625;
      var x = mulExt(rr, t[k + 2], t[k + 3]) + cx, y = mulExt(rr, t[k], t[k + 1]) + cy;
      if (i !== 0) this.line(px, py, x, y, c);
      px = x; py = y;
    }
  }

  /** lineWave, 0x7875bbf [0x797bd51]: 1024 segments across width w from cx - w/2, height wave[i]*h/256 */
  lineWave(cx: number, cy: number, w: number, h: number, wave: Uint8Array, c: number): void {
    var x0 = cx - w * 0.5, yo = cy * 0.5, px = 0, py = 0;
    for (var i = 0; i <= 1024; i++) {
      var x = i * 0.0009765625 * w + x0;
      var y = wave[i & 0x3ff] * h * 0.00390625 + cy - yo;
      if (i !== 0) this.line(px, py, x, y, c);
      px = x; py = y;
    }
  }

  /** vgrad, 0x7875586 [0x797b919]: every other pixel from (x, y0) towards y1, |y1-y0|/2 of them, the
   *  colour stepping from c0 by (c1-c0)/(|y1-y0|/2) per channel (truncated). The alpha byte is what the
   *  reused argument slot holds by then, the top byte of the int B1 - B0: 0, or 0xff when B falls. */
  vgrad(x: number, y0: number, y1: number, c0: number, c1: number, div?: boolean): void {
    if (y1 === y0) return;
    var dir = y1 >= y0 ? 1 : -1, d = y1 - y0;
    if (d < 0) d = -d;
    var R0 = (c0 >>> 16) & 255, G0 = (c0 >>> 8) & 255, B0 = c0 & 255;
    var r = R0, g = G0, bl = B0, dR, dG, dB;
    if (div) {                                             // WMP 7-8 (wmpui.dll 0x591d899c): divided by |dy|/2
      var hd = d * 0.5;
      dR = (((c1 >>> 16) & 255) - R0) / hd; dG = (((c1 >>> 8) & 255) - G0) / hd; dB = ((c1 & 255) - B0) / hd;
    } else {
      var inv = 1 / (d * 0.5);
      dR = (((c1 >>> 16) & 255) - R0) * inv; dG = (((c1 >>> 8) & 255) - G0) * inv; dB = ((c1 & 255) - B0) * inv;
    }
    var a = (c1 & 255) - B0 < 0 ? 0xff000000 : 0, y = y0, step = dir * 2;
    for (var n = d >> 1; n !== 0; n--) {
      this.plot(x, y, a | (ftol(r) & 255) << 16 | (ftol(g) & 255) << 8 | (ftol(bl) & 255));
      y += step;
      r = dR + r; g = dG + g; bl = dB + bl;
    }
  }

  /** spectrum, 0x7875c9e [0x797be4f]: from the column at cx, bars out to the left (freq[0]) and right
   *  (freq[1]), each mirrored about the row at cy with vgrad, height freq*h*H/512 (WMP 7.0/7.1: /2048,
   *  `ver` 7). `ver` < 9: vgrad divides. */
  spectrum(cx: number, cy: number, sw: number, sh: number, f0: Uint8Array, f1: Uint8Array, c0: number, c1: number, ver = 10): void {
    var W = this.w, H = this.h, div = ver < 9;
    var ys = H * sh * (ver < 8 ? 0.00048828125 : 0.001953125), fs = 2048 / (W * sw), half = sw * 0.5, wm = W - 1;
    var xl = ftol((cx - half) * wm), xr = ftol((half + cx) * wm), xc = ftol(wm * cx);
    var yc = ftol((H - 1) * cy), ycd = yc, x, k, d, a, b;
    for (x = xc, k = 0; x > xl; x--, k++) {
      d = f0[ftol(k * fs) + 1] * ys;
      a = ftol(ycd + d); b = ftol(ycd - d);
      if (a !== b) { this.vgrad(x, yc, a, c0, c1, div); this.vgrad(x, yc, b, c0, c1, div); }
    }
    for (x = xc, k = 0; x < xr; x++, k++) {
      d = f1[ftol(k * fs) + 1] * ys;
      a = ftol(ycd + d); b = ftol(ycd - d);
      if (a !== b) { this.vgrad(x, yc, a, c0, c1, div); this.vgrad(x, yc, b, c0, c1, div); }
    }
  }

  /** blit, 0x7874efb [0x797b277]: this (a sprite) onto dst with its corner at (x*dst.w, y*dst.h), clipped.
   *  Mode 0 copies whole pixels; mode 1 adds (saturating) src, or src scaled by the LUT when one is set;
   *  mode 2 averages with the LUT-scaled src, set or not. B, G, R only for 1 and 2. */
  blit(dst: Surf, x: number, y: number): void {
    var top = ftol(dst.h * y), left = ftol(dst.w * x);
    var l = left > 0 ? left : 0, t = top > 0 ? top : 0;
    var r = left + this.w, bt = top + this.h;
    if (r > dst.w) r = dst.w;
    if (bt > dst.h) bt = dst.h;
    if (l >= r || t >= bt) return;                         // IntersectRect: empty
    var sw = this.w, dw = dst.w, m = this.mode;
    if (m === 0) {
      for (var row = t; row < bt; row++)
        dst.px.set(this.px.subarray((row - top) * sw + l - left, (row - top) * sw + r - left), row * dw + l);
      return;
    }
    if (m !== 1 && m !== 2) return;
    var sb = this.b, db = dst.b, v;
    var LB = this.lutB << 8, LG = this.lutG << 8, LR = this.lutR << 8, lut = m === 2 || this.lutOn;
    for (var row2 = t; row2 < bt; row2++) {
      var so = ((row2 - top) * sw + l - left) * 4, d0 = (row2 * dw + l) * 4, d1 = (row2 * dw + r) * 4;
      for (var o = d0; o < d1; o += 4, so += 4) {
        var b0 = sb[so], g0 = sb[so + 1], r0 = sb[so + 2];
        if (lut) { b0 = MUL[LB + b0]; g0 = MUL[LG + g0]; r0 = MUL[LR + r0]; }
        if (m === 1) {
          v = db[o] + b0; db[o] = v > 255 ? 255 : v;
          v = db[o + 1] + g0; db[o + 1] = v > 255 ? 255 : v;
          v = db[o + 2] + r0; db[o + 2] = v > 255 ? 255 : v;
        } else {
          db[o] = (b0 + db[o]) >> 1;
          db[o + 1] = (g0 + db[o + 1]) >> 1;
          db[o + 2] = (r0 + db[o + 2]) >> 1;
        }
      }
    }
  }

  /** radial, 0x7876799 [0x797caaf]: black, then 255*(1 - d/r) grey inside the inscribed circle (store mode) */
  radial(): void {
    var w = this.w, h = this.h, cx = (w / 2) | 0, cy = (h / 2) | 0;
    this.fill(0);
    var rmin = cx < cy ? cx : cy;
    for (var i = 0, xi = -cx; i < w; i++, xi++) {
      for (var j = 0, yj = -cy; j < h; j++, yj++) {
        var q = Math.sqrt(yj * yj + xi * xi) / rmin;
        if (q <= 1) {
          var v = ftol(255 - q * 255) & 255;
          this.plot(i, j, v | (v << 8) | (v << 16));
        }
      }
    }
  }
}

/** gradient, 0x787613e [0x797c4f3]: n colours from c0 towards c1 (exclusive), per byte, truncated */
export function gradient(c0: number, c1: number, n: number): Uint32Array {
  var out = new Uint32Array(n);
  var B0 = c0 & 255, G0 = (c0 >>> 8) & 255, R0 = (c0 >>> 16) & 255, A0 = c0 >>> 24;
  var dR = (((c1 >>> 16) & 255) - R0) / n, dG = (((c1 >>> 8) & 255) - G0) / n;
  var dB = ((c1 & 255) - B0) / n, dA = ((c1 >>> 24) - A0) / n;
  var r = R0, g = G0, bl = B0, al = A0;
  for (var i = 0; i < n; i++) {
    out[i] = ((ftol(al) & 255) << 24 | (ftol(r) & 255) << 16 | (ftol(g) & 255) << 8 | (ftol(bl) & 255)) >>> 0;
    r += dR; g += dG; bl += dB; al += dA;
  }
  return out;
}
