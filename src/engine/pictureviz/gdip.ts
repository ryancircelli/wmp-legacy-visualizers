// The GDI+ scaling step every Picture Viz DLL runs on each picture it loads (PictureViz.dll VA 0x10018f00):
//   DrawImage(src -> dw x dh PARGB bitmap, InterpolationModeHighQualityBicubic, no ImageAttributes),
//   DrawImage(that -> a second PARGB bitmap, defaults), LockBits(PixelFormat32bppARGB), pixel & 0xFFFFFF.
// Re-derived from, and A/B-verified bit for bit against, the 32-bit gdiplus.dll 10.0.26100.9444 (the
// SysWOW64 copy and both x86 WinSxS assemblies are byte-identical). In that build:
//   - HighQualityBicubic under a scale-only transform takes the separable stretch span (vtable 0x1000279c,
//     set-up 0x1004db73): each source row (24bpp, read as PARGB with alpha 255) is filtered horizontally
//     into an 8-bit premultiplied ARGB row (0x100908d0), then those rows are filtered vertically
//     (0x10092ad9). 1:1 in both axes is a plain copy instead.
//   - Filter: the Keys cubic with a = -1 (|x|^3 - 2|x|^2 + 1, -|x|^3 + 5|x|^2 - 8|x| + 4 on [1, 2)), its
//     support (2 source pixels a side) widened to 2 * src/dst when shrinking. A tap's weight is not a point
//     sample but the kernel's area over that source pixel: a 513-entry cumulative table over the normalised
//     support [-1, 1] (16.16; the kernel summed in 1/128 steps), tap j weighing table[u_j] - table[u_{j-1}],
//     the first tap's predecessor 0, the area past the last tap dropped.
//   - Positions: destination pixel d samples source d * src/dst (pixel centres on integers in both spaces,
//     PixelOffsetModeNone), so the right and bottom edges look past the image. In 16.16,
//     pos = origin + d * scale - 0.5 and the taps run from ceil(pos - support) to ceil(pos + support); the
//     origin is a float32 residual of a few 1/65536 pixel, see axis().
//   - Outside the image the source is transparent black (wrap mode clamp, colour 0): those taps spend their
//     weight on nothing, so the edges come out partly transparent (premultiplied).
//   - Precision, as the build runs on any x86 with MMX (a feature-flagged SSE4.1 twin with full 16.16
//     weights is off): horizontally, destination pixels with every tap inside the row use 14-bit weights
//     (table >> 2, differenced), sum + 0x2000 >> 14; those whose taps reach outside the row use 16.16
//     weights, sum + 0x8000 >> 16; vertically every row weight is the 16.16 weight >> 2, sum + 0x2000 >> 14.
//     Each pass then clamps alpha to [0, 255] and each colour to [0, alpha].
//   - When the inside run is at least 16 pixels and its taps span what a 2-pixel step would (an exact 2:1
//     shrink, or one close enough, whose drift is then ignored), the horizontal pass uses an 8-tap kernel
//     for that run instead (0x1009274f): Keys a = -0.5 sampled every half pixel, 14-bit, at the run's
//     starting phase, stepping exactly 2 source pixels.
//   - Set-up arithmetic is float32: fix16(v) = floor(float32(float32(v * 65536) + 0.5)).
// The second DrawImage is an exact 1:1 copy. LockBits to ARGB unpremultiplies each colour as
// (c * floor(0xFF0000 / a)) >> 16 (a = 0 gives 0).

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
  for (let i = -256; i <= 256; i++) {
    acc += keys(i / 128, -1);
    t[i + 256] = Math.round(acc * 512);
  }
  return t;
})();
const cum = (u: number): number => {
  const i = u >> 8;
  return i <= -256 ? 0 : i >= 256 ? 65536 : TABLE[i + 256];
};

interface Tap { j0: number; w: Int32Array; shift: 14 | 16 }
/** One axis of the span: 16.16 source step, kernel half-width and its reciprocal, origin. */
interface Axis { scale: number; width: number; inv: number; origin: number }

/**
 * The span's set-up for one axis (sn source pixels onto dn). The destination extent and origin the span
 * sees are not exactly dn and 0: GdipDrawImageRectRect builds the source-to-destination matrix with the
 * translation anchored at the far corner (0x100417a0: m = dn/sn, t = dn - m*sn, float32), the driver
 * re-infers a matrix from the transformed points (0x10042370) and maps the source corners through it, and
 * the span (0x1004db73) turns the resulting float32 rect into its 16.16 step, support and origin. The
 * residuals are an ulp or so of dn, which moves the origin by a few 1/65536 of a pixel: enough to flip a
 * table index now and then.
 * flip: the vertical axis takes the origin with the opposite sign (the span computes it as y0 - dsty).
 */
function axis(sn: number, dn: number, other: number, flip: boolean): Axis {
  const m = f32(dn / sn), t = f32(dn - f32(m * sn));
  const p0 = t, p1 = f32(f32(m * sn) + t); // the points' coordinate at source 0 and sn
  const det = f32(sn * other), rdet = f32(1 / det);
  const m2 = f32(f32(f32(other * p1) + f32(-other * p0)) * rdet), t2 = f32(f32(det * p0) * rdet);
  const dst0 = t2, ext = f32(f32(f32(m2 * sn) + t2) - t2);
  const scale = fix16(f32(sn / ext));
  let width = fix16(f32(f32(2 * sn) / ext));
  if (width < 0x20000) width = 0x20000;
  // dst0 is within an ulp of 0, so the span's integer start is 0 and the origin is the residual
  const origin = Math.floor(f32(f32((flip ? -dst0 : dst0) * scale) + 0.5));
  return { scale, width, inv: fix16(f32(65536 / width)), origin };
}

/** Taps for destination index d of an axis; mmx: 14-bit differenced weights (all taps inside). */
function taps(d: number, sn: number, ax: Axis, mmx: boolean): Tap {
  const pos = ax.origin + d * ax.scale - 0x8000;
  const j0 = (pos - ax.width + 0xffff) >> 16, j1 = (pos + ax.width + 0xffff) >> 16;
  const w = new Int32Array(j1 - j0 + 1);
  let prev = 0;
  for (let j = j0; j <= j1; j++) {
    // u = (j - pos) / support in 16.16; the product exceeds 32 bits, the DLL takes it 64-bit
    const c = cum(Math.floor(((j * 65536 - pos) * ax.inv) / 65536));
    w[j - j0] = j < 0 || j >= sn ? 0 : mmx ? (c >> 2) - (prev >> 2) : c - prev;
    prev = c;
  }
  return { j0, w, shift: mmx ? 14 : 16 };
}

function horizontalTaps(sw: number, dw: number, ax: Axis): Tap[] {
  const P = dw + 1; // the span is dw + 1 wide
  const pos0 = ax.origin - 0x8000;
  // [L, R): destination pixels whose taps all lie inside the row
  const L = Math.max(0, Math.trunc((ax.width - pos0 + ax.scale - 1) / ax.scale));
  const R = Math.min(P, Math.trunc(((sw - 1) * 65536 - pos0 - ax.width) / ax.scale));
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
    out.push(inside && w8 ? { j0: firstL + 2 * (x - L), w: w8, shift: 14 } : taps(x, sw, ax, inside));
  }
  return out;
}

/** A pass's sums to a premultiplied ARGB pixel: round, alpha to [0, 255], colours to [0, alpha]. */
function pack(a: number, r: number, g: number, b: number, shift: number): number {
  const half = 1 << (shift - 1);
  a = (a + half) >> shift;
  a = a < 0 ? 0 : a > 255 ? 255 : a;
  const cl = (c: number): number => { c = (c + half) >> shift; return c < 0 ? 0 : c > a ? a : c; };
  return ((a << 24) | (cl(r) << 16) | (cl(g) << 8) | cl(b)) >>> 0;
}

/**
 * Scale an opaque RGB picture (sw*sh*3 bytes, top-down, no padding) to dw x dh exactly as the Picture Viz
 * DLLs receive it from GDI+: dw*dh pixels 0x00RRGGBB, top-down.
 */
export function gdipScaleHQ(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint32Array {
  const out = new Uint32Array(dw * dh);
  if (sw === dw && sh === dh) {
    for (let i = 0; i < out.length; i++) out[i] = (src[i * 3] << 16) | (src[i * 3 + 1] << 8) | src[i * 3 + 2];
    return out;
  }
  const H = horizontalTaps(sw, dw, axis(sw, dw, sh, false));
  const mid = new Uint32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 3;
    for (let x = 0; x < dw; x++) {
      const { j0, w, shift } = H[x];
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k];
        if (wk === 0) continue;
        const s = row + (j0 + k) * 3;
        a += 255 * wk; r += src[s] * wk; g += src[s + 1] * wk; b += src[s + 2] * wk;
      }
      mid[y * dw + x] = pack(a, r, g, b, shift);
    }
  }
  const ax = axis(sh, dh, sw, true);
  for (let y = 0; y < dh; y++) {
    const { j0, w } = taps(y, sh, ax, false);
    for (let x = 0; x < dw; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k] >> 2;
        if (wk === 0) continue;
        const p = mid[(j0 + k) * dw + x];
        a += (p >>> 24) * wk; r += ((p >> 16) & 255) * wk; g += ((p >> 8) & 255) * wk; b += (p & 255) * wk;
      }
      const p = pack(a, r, g, b, 14);
      const al = p >>> 24, m = al ? Math.floor(0xff0000 / al) : 0;
      out[y * dw + x] = ((((p >> 16) & 255) * m >> 16) << 16) | ((((p >> 8) & 255) * m >> 16) << 8) | ((p & 255) * m >> 16);
    }
  }
  return out;
}
