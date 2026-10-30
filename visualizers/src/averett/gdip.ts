// The GDI+ drawing Rhythm and Waves does every frame (0x100134a0): the equalizer picture, as the 32-bit gdiplus.dll
// 10.0.26100.9444 (SysWOW64 and the x86 WinSxS copies are byte-identical) produces it:
//   b1 = 212x52 PixelFormat32bppPARGB, cleared; FillRectangle(all, ARGB 0x007ea5d3) leaves it (alpha 0)
//   8 rules: DrawLine(pen ARGB 0x3c8ebce6, width 1) at x = 0xbe, 0xa5, 0x8b, 0x73, 0x5c, 0x43, 0x29, 0x11, y 0..51
//   per band b (1..17), cell k (1..7): FillRectangle(x_b, y_k, 4, 4) with ARGB (v, 0x8e, 0xd5, 0xff), lit (0xff, 0xff,
//   0xff, 0); over a transparent pixel SourceOver leaves the brush colour premultiplied: round(c * a / 255)
//   b2 = W x H PARGB; HighQualityBicubic DrawImageRectRect(b1, src (2, 2, 208, 48) -> (0, 0, W, H))
//   LockBits(b2, PixelFormat32bppARGB): colour * floor(0xff0000 / a) >> 16
// The bicubic span is the one the Picture Viz port re-derived (../pictureviz/gdip.ts, A/B-verified there on opaque
// pictures); here it runs on premultiplied pixels with alpha and on a source rectangle inside a larger bitmap.
const f32 = Math.fround;
const fix16 = (v: number): number => Math.floor(f32(f32(v * 65536) + 0.5));
const keys = (x: number, a: number): number => {
  x = Math.abs(x);
  return x <= 1 ? (a + 2) * x * x * x - (a + 3) * x * x + 1 : x < 2 ? a * (x * x * x - 5 * x * x + 8 * x - 4) : 0;
};
// cumulative kernel area, index -256..256 over the normalised support [-1, 1] (stored at +256)
const TABLE = ((): Int32Array => {
  const t = new Int32Array(513);
  let acc = 0;
  for (let i = -256; i <= 256; i++) { acc += keys(i / 128, -1); t[i + 256] = Math.round(acc * 512); }
  return t;
})();
const cum = (u: number): number => { const i = u >> 8; return i <= -256 ? 0 : i >= 256 ? 65536 : TABLE[i + 256]; };

interface Tap { j0: number; w: Int32Array; shift: 14 | 16 }
interface Axis { scale: number; width: number; inv: number; origin: number }

/** the span's 16.16 set-up for one axis: sn source pixels onto dn (see ../pictureviz/gdip.ts axis()) */
function axis(sn: number, dn: number, other: number, flip: boolean): Axis {
  const m = f32(dn / sn), t = f32(dn - f32(m * sn));
  const p0 = t, p1 = f32(f32(m * sn) + t);
  const det = f32(sn * other), rdet = f32(1 / det);
  const m2 = f32(f32(f32(other * p1) + f32(-other * p0)) * rdet), t2 = f32(f32(det * p0) * rdet);
  const dst0 = t2, ext = f32(f32(f32(m2 * sn) + t2) - t2);
  const scale = fix16(f32(sn / ext));
  let width = fix16(f32(f32(2 * sn) / ext));
  if (width < 0x20000) width = 0x20000;
  const origin = Math.floor(f32(f32((flip ? -dst0 : dst0) * scale) + 0.5));
  return { scale, width, inv: fix16(f32(65536 / width)), origin };
}

/** Both axes of the span for a source rectangle at (X, Y), W x H, onto (0, 0, dw, dh), the whole chain in float32
 *  (axis() above is the shortcut mp9 is verified with):
 *   - GdipDrawImageRectRect's source-to-destination matrix: scale d / s, translation anchored at the far corners,
 *     t = d - (d / s) * (X + W); the rectangle's corners go through it, so the near corner lands an ulp or so of d
 *     off 0, by an amount that depends on the ratio;
 *   - the driver re-infers a matrix from those three points and the rectangle (the general 3-point solve, X and Y
 *     in every term) and maps the corners through that;
 *   - the span rounds the near corner to 28.4, and its origin is fix16((corner - floor(corner)) * scale / 65536 + X)
 *     (vertically floor - corner, + Y), here returned relative to the rectangle. */
function rectAxes(X: number, Y: number, W: number, H: number, dw: number, dh: number): [Axis, Axis] {
  const mx = f32(dw / W), my = f32(dh / H), XW = f32(X + W), YH = f32(Y + H);
  const tx = f32(dw - f32(mx * XW)), ty = f32(dh - f32(my * YH));
  const x0 = f32(f32(mx * X) + tx), x1 = f32(f32(mx * XW) + tx), y0 = f32(f32(my * Y) + ty), y2 = f32(f32(my * YH) + ty);
  const det = f32(f32(f32(XW * YH) - f32(Y * X)) + f32(f32(-H * X) - f32(Y * W))), rdet = f32(1 / det);
  const A2 = f32(f32(YH * XW) - f32(X * Y)), XH = f32(-X * H), YWn = f32(-Y * W);
  const m11 = f32(f32(f32(H * x1) + f32(-H * x0)) * rdet), m22 = f32(f32(f32(W * y2) + f32(-W * y0)) * rdet);
  const tx2 = f32(f32(f32(f32(XH * x1) + f32(A2 * x0)) + f32(YWn * x0)) * rdet);
  const ty2 = f32(f32(f32(f32(XH * y0) + f32(A2 * y0)) + f32(YWn * y2)) * rdet);
  const one = (P: number, S: number, m: number, t: number, flip: boolean): Axis => {
    const c0 = f32(f32(m * P) + t), ext = f32(f32(f32(m * f32(P + S)) + t) - c0);
    const scale = fix16(f32(S / ext));
    let width = fix16(f32(f32(2 * S) / ext));
    if (width < 0x20000) width = 0x20000;
    const px = Math.floor(Math.floor(f32(f32(c0 * 16) + 0.5)) / 16), fr = flip ? f32(px - c0) : f32(c0 - px);
    const origin = fix16(f32(f32(f32(fr * scale) * 2 ** -16) + P)) - P * 65536;
    return { scale, width, inv: fix16(f32(65536 / width)), origin };
  };
  return [one(X, W, m11, tx2, false), one(Y, H, m22, ty2, true)];
}

/** taps for destination d; source pixels j (in the source rectangle's coordinates) exist for lo <= j < hi */
function taps(d: number, lo: number, hi: number, ax: Axis, mmx: boolean): Tap {
  const pos = ax.origin + d * ax.scale - 0x8000;
  const j0 = (pos - ax.width + 0xffff) >> 16, j1 = (pos + ax.width + 0xffff) >> 16;
  const w = new Int32Array(j1 - j0 + 1);
  let prev = 0;
  for (let j = j0; j <= j1; j++) {
    const c = cum(Math.floor(((j * 65536 - pos) * ax.inv) / 65536));
    w[j - j0] = j < lo || j >= hi ? 0 : mmx ? (c >> 2) - (prev >> 2) : c - prev;
    prev = c;
  }
  return { j0, w, shift: mmx ? 14 : 16 };
}

function horizontalTaps(lo: number, hi: number, dw: number, ax: Axis): Tap[] {
  const P = dw + 1;
  const pos0 = ax.origin - 0x8000;
  const L = Math.max(0, Math.trunc((ax.width - pos0 + ax.scale - 1 + lo * 65536) / ax.scale));
  const R = Math.min(P, Math.trunc(((hi - 1) * 65536 - pos0 - ax.width) / ax.scale));
  const n = R - L, posL = pos0 + L * ax.scale, firstL = (posL - ax.width + 0xffff) >> 16;
  const lastR = ((n - 1) * ax.scale + posL + ax.width) >> 16;
  const twoToOne = n >= 16 && (2 * n + 5 + firstL === lastR || 2 * n + 5 + firstL === lastR - 1);
  let w8: Int32Array | null = null;
  if (twoToOne) {
    const frac = (posL + 0x8000) & 0xffff;
    w8 = Int32Array.from({ length: 8 }, (_, k) => Math.round(65536 * keys((((frac >> 2) - 0x10000 + k * 0x4000) >> 9) / 64, -0.5)) >> 3);
  }
  const out: Tap[] = [];
  for (let x = 0; x < dw; x++) {
    const inside = x >= L && x < R;
    out.push(inside && w8 ? { j0: firstL + 2 * (x - L), w: w8, shift: 14 } : taps(x, lo, hi, ax, inside));
  }
  return out;
}

function pack(a: number, r: number, g: number, b: number, shift: number): number {
  const half = 1 << (shift - 1);
  a = (a + half) >> shift;
  a = a < 0 ? 0 : a > 255 ? 255 : a;
  const cl = (c: number): number => { c = (c + half) >> shift; return c < 0 ? 0 : c > a ? a : c; };
  return ((a << 24) | (cl(r) << 16) | (cl(g) << 8) | cl(b)) >>> 0;
}

/** HighQualityBicubic of the premultiplied (0xAARRGGBB) source rectangle (sx, sy, sw, sh) of an fw x fh bitmap to
 *  dw x dh, premultiplied. full: taps beyond the rectangle read the bitmap around it (else transparent).
 *  exact: the set-up through rectAxes() (Energy Bliss' panel), else axis() (mp9, Grind; unchanged). */
export function scaleHQ(src: Uint32Array, fw: number, fh: number, sx: number, sy: number, sw: number, sh: number,
  dw: number, dh: number, full = true, exact = false): Uint32Array {
  const out = new Uint32Array(dw * dh);
  if (sw === dw && sh === dh) {                  // 1:1 in both axes is a plain copy
    for (let y = 0; y < sh; y++) out.set(src.subarray((sy + y) * fw + sx, (sy + y) * fw + sx + sw), y * dw);
    return out;
  }
  const loX = full ? -sx : 0, hiX = full ? fw - sx : sw, loY = full ? -sy : 0, hiY = full ? fh - sy : sh;
  const [axX, axY] = exact ? rectAxes(sx, sy, sw, sh, dw, dh) : [axis(sw, dw, sh, false), axis(sh, dh, sw, true)];
  const Ht = horizontalTaps(loX, hiX, dw, axX);
  const mid = new Uint32Array(dw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < dw; x++) {
      const { j0, w, shift } = Ht[x];
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k];
        if (wk === 0) continue;
        const p = src[y * fw + sx + j0 + k];
        a += (p >>> 24) * wk; r += ((p >>> 16) & 255) * wk; g += ((p >>> 8) & 255) * wk; b += (p & 255) * wk;
      }
      mid[y * dw + x] = pack(a, r, g, b, shift);
    }
  }
  for (let y = 0; y < dh; y++) {
    const { j0, w } = taps(y, loY, hiY, axY, false);
    for (let x = 0; x < dw; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k] >> 2;
        if (wk === 0) continue;
        const p = mid[(sy + j0 + k) * dw + x];
        a += (p >>> 24) * wk; r += ((p >> 16) & 255) * wk; g += ((p >> 8) & 255) * wk; b += (p & 255) * wk;
      }
      out[y * dw + x] = pack(a, r, g, b, 14);
    }
  }
  return out;
}

/** premultiply as GDI+'s SourceOver onto transparent leaves a brush colour */
const pm = (argb: number): number => {
  const a = argb >>> 24, m = (c: number): number => Math.round(c * a / 255);
  return ((a << 24) | (m((argb >>> 16) & 255) << 16) | (m((argb >>> 8) & 255) << 8) | m(argb & 255)) >>> 0;
};
const RULES = [0xbe, 0xa5, 0x8b, 0x73, 0x5c, 0x43, 0x29, 0x11];
const YS = [0x2b, 0x26, 0x21, 0x16, 0x11, 0x0c, 0x07];

/** b1: the 212x52 premultiplied picture; cells[b * 8] = band b's x, cells[b * 8 + k] = cell k's value (b 1..17) */
export function eqSource(cells: Int32Array): Uint32Array {
  const b1 = new Uint32Array(212 * 52);
  const rule = pm(0x3c8ebce6);
  for (const x of RULES) for (let y = 0; y < 52; y++) b1[y * 212 + x] = rule;
  for (let b = 1; b < 18; b++) {
    const x = cells[b * 8];
    for (let k = 0; k < 7; k++) {
      const v = cells[b * 8 + 1 + k] & 0xff;
      if (v === 0) continue;
      const c = pm(v === 0xff ? 0xffffff00 : ((v << 24) | 0x8ed5ff) >>> 0);
      for (let y = YS[k]; y < YS[k] + 4; y++) for (let xx = x; xx < x + 4; xx++) if (xx >= 0 && xx < 212) b1[y * 212 + xx] = c;
    }
  }
  return b1;
}

/** the equalizer picture W x H as 0xAARRGGBB (straight alpha), as LockBits(ARGB) hands it to the DLL */
export function eqImage(cells: Int32Array, W: number, H: number): Uint32Array | null {
  const b1 = eqSource(cells);
  const b2 = scaleHQ(b1, 212, 52, 2, 2, 208, 48, W, H);
  for (let i = 0; i < b2.length; i++) {
    const p = b2[i], a = p >>> 24, m = a ? Math.floor(0xff0000 / a) : 0;
    b2[i] = ((a << 24) | ((((p >>> 16) & 255) * m >> 16) << 16) | ((((p >>> 8) & 255) * m >> 16) << 8) | ((p & 255) * m >> 16)) >>> 0;
  }
  return b2;
}

// Energy Bliss' equalizer panel (MediaPlayer_10, ./mp10/eqpanel.ts) adds three steps.

/** LockBits(PixelFormat32bppARGB, write) of straight-alpha pixels into a PARGB bitmap: GDI+'s premultiply */
export function premultiply(argb: Uint32Array): Uint32Array {
  const out = new Uint32Array(argb.length);
  for (let i = 0; i < argb.length; i++) out[i] = pm(argb[i]);
  return out;
}

/** LockBits(PixelFormat32bppARGB, read) of a PARGB bitmap, in place: colour * floor(0xff0000 / a) >> 16 */
export function unpremultiply(p: Uint32Array): Uint32Array {
  for (let i = 0; i < p.length; i++) {
    const v = p[i], a = v >>> 24, m = a ? Math.floor(0xff0000 / a) : 0;
    p[i] = ((a << 24) | ((((v >>> 16) & 255) * m >> 16) << 16) | ((((v >>> 8) & 255) * m >> 16) << 8) | ((v & 255) * m >> 16)) >>> 0;
  }
  return p;
}

/** DrawImageRectRectI(UnitPixel, no attributes) of an opaque sw x sh picture onto a PARGB fw x fh bitmap with the
 *  Graphics' default state. The source rectangle is clipped to the picture first and the destination shrinks with
 *  it. 1:1 is a copy. Otherwise the default interpolation, bilinear: destination pixel d samples source
 *  d * srw / dw (16.16, pixel centres on integers), its 8-bit fraction weighing the next pixel (sum + 128 >> 8,
 *  rows first, then between rows); pixels past the picture (not the rectangle) are transparent, so the far edges
 *  come out half transparent, and the result goes SourceOver onto the bitmap (d * (255 - a) / 255 rounded). */
export function drawOpaque(dst: Uint32Array, fw: number, fh: number, src: Uint32Array, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number, sx: number, sy: number, srw: number, srh: number): void {
  const cw = Math.min(srw, sw - sx), ch = Math.min(srh, sh - sy);
  if (cw <= 0 || ch <= 0) return;
  if (dw === srw && dh === srh) {
    for (let y = Math.max(0, -dy); y < ch && dy + y < fh; y++) {
      for (let x = Math.max(0, -dx); x < cw && dx + x < fw; x++) dst[(dy + y) * fw + dx + x] = (src[(sy + y) * sw + sx + x] | 0xff000000) >>> 0;
    }
    return;
  }
  // ponytail: exact when the scale ratios are powers of two (the hd reflections' 2x); other ratios start each axis
  // at 0, where GDI+ starts at a float residual of its inverse matrix (a few 1/65536 px, depends on the position)
  const stepX = Math.floor((srw / dw) * 65536 + 0.5), stepY = Math.floor((srh / dh) * 65536 + 0.5);
  const at = (x: number, y: number): number => (x < sw && y < sh ? (src[y * sw + x] | 0xff000000) >>> 0 : 0);
  const lerp = (p: number, q: number, w: number): number => {
    let o = 0;
    for (let s = 0; s < 32; s += 8) o |= ((((p >>> s) & 255) * (256 - w) + ((q >>> s) & 255) * w + 128) >> 8) << s;
    return o >>> 0;
  };
  const ow = Math.ceil((dw * cw) / srw), oh = Math.ceil((dh * ch) / srh);
  for (let j = Math.max(0, -dy); j < oh && dy + j < fh; j++) {
    const py = j * stepY, y0 = sy + (py >> 16), wy = (py >> 8) & 255;
    for (let i = Math.max(0, -dx); i < ow && dx + i < fw; i++) {
      const px = i * stepX, x0 = sx + (px >> 16), wx = (px >> 8) & 255;
      const c = lerp(lerp(at(x0, y0), at(x0 + 1, y0), wx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), wx), wy);
      const k = (dy + j) * fw + dx + i, inv = 255 - (c >>> 24);
      if (inv === 0) { dst[k] = c; continue; }
      let o = 0;
      for (let s = 0; s < 32; s += 8) {
        const t = ((dst[k] >>> s) & 255) * inv;
        o |= Math.min(255, ((c >>> s) & 255) + ((t + 128 + ((t + 128) >> 8)) >> 8)) << s;
      }
      dst[k] = o >>> 0;
    }
  }
}
