// PictureViz_II's background loader (0x1001b740) draws the picture at its cover size (dw x dh, at least the
// window) centred in a window-sized 32bppPARGB bitmap: GDI+ draws a translated, clipped destination. That
// differs from gdip.ts's unclipped draw (the foreground loader's case, which gdipScaleHQ covers) in where the
// span's 16.16 positions start: the same Keys-cubic separable stretch, area-weighted taps and MMX precisions as
// gdip.ts (whose model this file mirrors and extends), but
//   - the destination matrix is anchored at the far corner with the translation in it (t = (off + dn) - m * sn,
//     float32), so the span's start is round(dst0) and its origin the float32 residual of dst0;
//   - with rows clipped off the top, the first visible row samples at origin + (row - start) * step, and the
//     rows after it continue from fix16((rows clipped + 1) * src/dst) (float32) + k * step: the stepper is
//     re-seeded from float once the clip is applied, a few 1/65536 pixel away from the integer product.
// Verified against the DLL's own GDI+ read-backs (host9-pictureviz2.ps1 -LoaderLocks) for every background
// crop of the A/B runs (tools/pictureviz2_ab.sh in the private repo).

const f32 = Math.fround;
const fix16 = (v: number): number => Math.floor(f32(f32(v * 65536) + 0.5));
const keys = (x: number, a: number): number => {
  x = Math.abs(x);
  return x <= 1 ? (a + 2) * x * x * x - (a + 3) * x * x + 1 : x < 2 ? a * (x * x * x - 5 * x * x + 8 * x - 4) : 0;
};
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

interface Axis { scale: number; width: number; inv: number; origin: number; start: number }

/** one axis: sn source pixels onto dn destination pixels starting at off; flip = the vertical axis */
function axis(sn: number, dn: number, other: number, flip: boolean, off: number): Axis {
  const m = f32(dn / sn), t = f32(f32(off + dn) - f32(m * sn));
  const p0 = t, p1 = f32(f32(m * sn) + t);
  const det = f32(sn * other), rdet = f32(1 / det);
  const m2 = f32(f32(f32(other * p1) + f32(-other * p0)) * rdet), t2 = f32(f32(det * p0) * rdet);
  const ext = f32(f32(f32(m2 * sn) + t2) - t2);
  const scale = fix16(f32(sn / ext));
  let width = fix16(f32(f32(2 * sn) / ext));
  if (width < 0x20000) width = 0x20000;
  const start = Math.round(t2), r = t2 - start;
  const origin = Math.floor(f32(f32((flip ? -r : r) * scale) + 0.5));
  return { scale, width, inv: fix16(f32(65536 / width)), origin, start };
}

/** taps at 16.16 position pos (already - 0.5); mmx: 14-bit differenced weights */
function tapsAt(pos: number, sn: number, ax: Axis, mmx: boolean): { j0: number; w: Int32Array } {
  const j0 = (pos - ax.width + 0xffff) >> 16, j1 = (pos + ax.width + 0xffff) >> 16;
  const w = new Int32Array(j1 - j0 + 1);
  let prev = 0;
  for (let j = j0; j <= j1; j++) {
    const c = cum(Math.floor(((j * 65536 - pos) * ax.inv) / 65536));
    w[j - j0] = j < 0 || j >= sn ? 0 : mmx ? (c >> 2) - (prev >> 2) : c - prev;
    prev = c;
  }
  return { j0, w };
}

function pack(a: number, r: number, g: number, b: number, shift: number): number {
  const half = 1 << (shift - 1);
  a = (a + half) >> shift;
  a = a < 0 ? 0 : a > 255 ? 255 : a;
  const cl = (c: number): number => { c = (c + half) >> shift; return c < 0 ? 0 : c > a ? a : c; };
  return ((a << 24) | (cl(r) << 16) | (cl(g) << 8) | cl(b)) >>> 0;
}

/** An opaque RGB picture (sw x sh) drawn HighQualityBicubic at (dx, dy, dw, dh) into a bw x bh bitmap that starts
 *  transparent black, read back as 32bppARGB: bw x bh pixels 0x00RRGGBB, top-down. */
export function gdipDrawClipped(src: Uint8Array, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number,
  bw: number, bh: number): Uint32Array {
  const out = new Uint32Array(bw * bh);
  const x0 = Math.max(0, dx), x1 = Math.min(bw, dx + dw), y0 = Math.max(0, dy), y1 = Math.min(bh, dy + dh);
  if (x1 <= x0 || y1 <= y0) return out;
  const hx = axis(sw, dw, sh, false, dx), vy = axis(sh, dh, sw, true, dy);
  const n = x1 - x0, P0 = hx.origin + (x0 - hx.start) * hx.scale - 0x8000;
  // the visible columns whose taps all lie inside the row: 14-bit weights (and, over 16+ columns stepping
  // exactly 2 source pixels, gdip.ts's 8-tap half-pixel Keys a = -0.5 kernel)
  const L = Math.max(0, Math.trunc((hx.width - P0 + hx.scale - 1) / hx.scale));
  const R = Math.min(n + 1, Math.trunc(((sw - 1) * 65536 - P0 - hx.width) / hx.scale));
  const nIn = R - L, posL = P0 + L * hx.scale, firstL = (posL - hx.width + 0xffff) >> 16;
  const lastR = ((nIn - 1) * hx.scale + posL + hx.width) >> 16;
  let w8: Int32Array | null = null;
  if (nIn >= 16 && (2 * nIn + 5 + firstL === lastR || 2 * nIn + 5 + firstL === lastR - 1)) {
    const frac = (posL + 0x8000) & 0xffff;
    w8 = Int32Array.from({ length: 8 }, (_, k) => Math.round(65536 * keys((((frac >> 2) - 0x10000 + k * 0x4000) >> 9) / 64, -0.5)) >> 3);
  }
  const H: { j0: number; w: Int32Array; shift: number }[] = [];
  for (let i = 0; i < n; i++) {
    const inside = i >= L && i < R;
    if (inside && w8) H.push({ j0: firstL + 2 * (i - L), w: w8, shift: 14 });
    else { const t = tapsAt(P0 + i * hx.scale, sw, hx, inside); H.push({ j0: t.j0, w: t.w, shift: inside ? 14 : 16 }); }
  }
  const mid = new Uint32Array(n * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 3;
    for (let i = 0; i < n; i++) {
      const { j0, w, shift } = H[i];
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k];
        if (wk === 0) continue;
        const s = row + (j0 + k) * 3;
        a += 255 * wk; r += src[s] * wk; g += src[s + 1] * wk; b += src[s + 2] * wk;
      }
      mid[y * n + i] = pack(a, r, g, b, shift);
    }
  }
  const reseed = y0 > dy ? fix16(f32((y0 + 1 - dy) * f32(sh / dh))) : 0;
  for (let y = y0; y < y1; y++) {
    const pos = y0 > dy && y > y0 ? vy.origin + reseed + (y - y0 - 1) * vy.scale - 0x8000
      : vy.origin + (y - vy.start) * vy.scale - 0x8000;
    const { j0, w } = tapsAt(pos, sh, vy, false);
    for (let i = 0; i < n; i++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < w.length; k++) {
        const wk = w[k] >> 2;
        if (wk === 0) continue;
        const p = mid[(j0 + k) * n + i];
        a += (p >>> 24) * wk; r += ((p >> 16) & 255) * wk; g += ((p >> 8) & 255) * wk; b += (p & 255) * wk;
      }
      const p = pack(a, r, g, b, 14);
      const al = p >>> 24, m = al ? Math.floor(0xff0000 / al) : 0;
      out[y * bw + x0 + i] = ((((p >> 16) & 255) * m >> 16) << 16) | ((((p >> 8) & 255) * m >> 16) << 8) | ((p & 255) * m >> 16);
    }
  }
  return out;
}
