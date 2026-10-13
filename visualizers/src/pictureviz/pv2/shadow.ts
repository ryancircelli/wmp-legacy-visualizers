// Dressing the foreground picture (layer 4) once it is loaded: the photo edge (E+0xf0) and the drop shadow
// (E+0xfc). Layer 4's image is a bottom-up block (malloc'd, a 12-byte header w, h, 0 before the pixels).
//
// The drop shadow goes through GDI+. Its bitmaps live in GDI+'s heap, not the DLL's, so here they are plain
// arrays (top-down, stride = width, as GdipBitmapLockBits hands 32bpp data out); the object fields the DLL
// leaves pointing into them get the stand-in addresses below (dangling in the DLL too once it frees them).
// GDI+ (gdiplus.dll 10.0.26100.9444, x86) was measured over every (alpha, colour, destination) triple in each
// channel with the exact call sequence the DLL makes (agentB/oracle.ps1, verify.mjs) and is, bit for bit:
//   - UnlockBits of 32bppARGB data into a 32bppPARGB bitmap: each colour c -> round(c * a / 255), alpha kept;
//   - GdipDrawImageI PARGB onto an opaque PARGB bitmap (default Graphics, integer offset, clipped): per
//     channel out = s + round(d * (255 - a) / 255), alpha stays 255, no filtering (an opaque source is a copy);
//   - LockBits read as 32bppARGB of an opaque PARGB bitmap: the identity.
// The canvas here is opaque everywhere (the background bitmap covers it), so those three rules are all it needs.
import { type Core, lb } from './core';
import { ftol, fr } from './mem';
import { def, vt } from './vt';

const E_FAIL = 0x80004005 | 0;
// stand-in addresses for the Scan0 of GDI+'s locked bitmaps (canvas, background, shadow)
const SCAN1 = 0x7a000000, SCAN2 = 0x7b000000, SCAN3 = 0x7c000000;

/** round(x / 255) for 0 <= x <= 255 * 255, GDI+'s integer form */
const div255 = (x: number): number => (x + 128 + ((x + 128) >> 8)) >> 8;

/** GDI+: UnlockBits of the w x h ARGB shadow into its PARGB bitmap, then GdipDrawImageI of it at (x, y) onto
 *  the opaque W x H canvas (clipped). */
export function gdipDrawShadow(cv: Uint32Array, W: number, H: number, sh: Uint32Array, w: number, h: number,
  x: number, y: number): void {
  for (let i = 0; i < h; i++) {
    const cy = y + i;
    if (cy < 0 || cy >= H) continue;
    for (let j = 0; j < w; j++) {
      const cx = x + j;
      if (cx < 0 || cx >= W) continue;
      const s = sh[i * w + j], a = s >>> 24, k = 255 - a, d = cv[cy * W + cx];
      const ch = (n: number): number => div255(((s >>> n) & 255) * a) + div255(((d >>> n) & 255) * k);
      cv[cy * W + cx] = (0xff000000 | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
    }
  }
}

/** E+0xf0 0x10018760: the photo edge: renders layer 8 (the picture with the edge settings) onto the
 *  background under the picture, then makes that, flipped and without alpha, layer 4's image */
export function photoEdge(c: Core): number {
  const m = c.m;
  m.I[0x6214 >> 2] = 4;
  vt(c, 0x230);
  let I = m.I;
  I[0x6718 >> 2] = I[0x2958 >> 2];
  I[0x672c >> 2] = I[0x2954 >> 2];
  I[0x69a0 >> 2] = Math.imul(I[0x2954 >> 2], I[0x6718 >> 2]);
  const p = m.malloc((I[0x69a0 >> 2] << 2) + 12);         // (the DLL's out-of-memory exit is unreachable here)
  I = m.I;
  I[p >> 2] = I[0x2954 >> 2];
  I[(p + 4) >> 2] = I[0x2958 >> 2];
  I[(p + 8) >> 2] = 0;
  let q = p + 12;
  I[0x6118 >> 2] = q;
  I[0x67a8 >> 2] = q;
  if (I[0x640 >> 2] === 0 && I[0x63c >> 2] === 0) {
    // no background picture: the background colour (alpha byte as stored)
    I[0x6374 >> 2] = 0;
    const n = Math.imul(I[0x672c >> 2], I[0x6718 >> 2]), col = I[0x61bc >> 2];
    for (let i = 0; i < n; i++) { I[q >> 2] = col; q += 4; I[0x6374 >> 2] = i + 1; }
    I[0x6118 >> 2] = q;
  } else {
    // the background picture (layer 6) under the picture's rectangle, stride = layer 6's width
    const img = I[0x2ccc >> 2];
    I[0x614c >> 2] = img;
    if (img === 0) return E_FAIL;
    const s = (img + ((Math.imul(I[0x28e4 >> 2], I[0x2d2c >> 2]) + I[0x28e0 >> 2]) << 2)) | 0;
    I[0x614c >> 2] = I[0x6150 >> 2] = s;
    I[0x6374 >> 2] = 0;
    const rows = I[0x6718 >> 2], cols = I[0x672c >> 2], stride = I[0x2d2c >> 2];
    for (let i = 0; i < rows; i++) {
      let r = s + (Math.imul(i, stride) << 2), j = 0;
      for (; j < cols; j++) { I[q >> 2] = I[r >> 2]; q += 4; r += 4; }
      I[0x614c >> 2] = r; I[0x634c >> 2] = j; I[0x6374 >> 2] = i + 1;
    }
    I[0x6118 >> 2] = q;
  }
  I[0x6100 >> 2] = I[0x67a8 >> 2];
  I[0x69e8 >> 2] = 0;
  I[0x69fc >> 2] = 0;
  I[0x61a8 >> 2] = I[0x2954 >> 2];
  I[0x61a4 >> 2] = I[0x2958 >> 2];
  I[0x6214 >> 2] = 4;
  I[0x2974 >> 2] = 0;
  let L = lb(c);
  I[(0x2130 + L) >> 2] = 0;
  I[(0x21c8 + L) >> 2] = 0;
  I[(0x2134 + L) >> 2] = 0;
  // layer 8 (fields at layer 8's absolute offsets, as the asm writes them)
  I[0x308c >> 2] = 2;
  I[0x307c >> 2] = 2;
  I[0x3220 >> 2] = 0;
  I[0x3080 >> 2] = -1;
  I[0x3104 >> 2] = I[0x2954 >> 2];
  I[0x3108 >> 2] = I[0x2958 >> 2];
  I[0x30f4 >> 2] = -2;
  I[0x30ac >> 2] = I[0x28fc >> 2];
  I[0x30b0 >> 2] = I[0x2900 >> 2];
  I[0x6214 >> 2] = 8;
  I[0x3124 >> 2] = I[0x2974 >> 2];
  L = lb(c);
  I[(0x2130 + L) >> 2] = I[0x28e0 >> 2];
  I[(0x21c8 + L) >> 2] = I[0x2978 >> 2];
  I[(0x2134 + L) >> 2] = I[0x28e4 >> 2];
  I[(0x2144 + L) >> 2] = I[0x28f4 >> 2];
  const flat = I[0x670 >> 2];
  I[0x3160 >> 2] = I[0x65c >> 2];
  I[0x31a8 >> 2] = flat;
  if (flat === 1) {
    // "flat" edge: the settings themselves are rescaled, every time this runs
    const t = ftol(I[0x660 >> 2] * 0.8);
    I[0x660 >> 2] = t;
    I[0x66c >> 2] = ftol(I[0x66c >> 2] + I[0x66c >> 2]);
    if (t < 0) I[0x660 >> 2] = -t | 0;
  }
  let v = I[0x660 >> 2];
  I[0x315c >> 2] = v >= 50 ? (Math.imul(v, 5) - 250) << 1 : (Math.imul(v, 5) - 250) | 0;
  v = I[0x664 >> 2];
  if (v >= 50) { I[0x3188 >> 2] = 0; I[0x3184 >> 2] = ftol(((v - 50) | 0) * 5.1); }
  else { I[0x3188 >> 2] = ftol(((50 - v) | 0) * 5.1); I[0x3184 >> 2] = 0; }
  v = I[0x66c >> 2];
  if (v >= 50) { I[0x316c >> 2] = 100; I[0x3224 >> 2] = ftol(((v - 50) | 0) * 5.1); }
  else { I[0x3224 >> 2] = 0; I[0x316c >> 2] = v << 1; }
  const col = I[0x668 >> 2];
  I[0x325c >> 2] = col === 0 ? 1 : col === 0xffffff ? 2 : 0;
  I[0x3158 >> 2] = (col & 0xfe) | 1;                      // each channel forced odd
  I[0x308c >> 2] = 3;
  I[0x3150 >> 2] = ((col & 0xfe0000) | 0x10000) >> 16;
  I[0x3154 >> 2] = ((col & 0xfe00) | 0x100) >> 8;
  vt(c, 0x21c);
  I = m.I;
  I[0x6214 >> 2] = 8;
  I[0x30a4 >> 2] = 0;
  I[0x2120 >> 2] = 0;                                     // absolute: layer 0's field, as the asm has it
  vt(c, 0x1b0);
  I = m.I;
  I[0x308c >> 2] = 0;
  I[0x307c >> 2] = -1;
  I[0x3220 >> 2] = -1;
  I[0x6214 >> 2] = 4;
  for (const f of [0x325c, 0x3160, 0x315c, 0x3184, 0x3188, 0x3150, 0x3154, 0x3158, 0x316c, 0x3224, 0x31a8]) I[f >> 2] = 0;
  vt(c, 0x1b0);
  I = m.I;
  L = lb(c);
  I[(0x2120 + L) >> 2] = -1;
  I[(0x2144 + L) >> 2] = I[0x6100 >> 2];
  I[0x6718 >> 2] = I[0x2958 >> 2];
  I[0x672c >> 2] = I[0x2954 >> 2];
  I[0x69a0 >> 2] = Math.imul(I[0x2954 >> 2], I[0x6718 >> 2]);
  I[(0x2144 + lb(c)) >> 2] = I[0x6100 >> 2];
  I[0x6400 >> 2] = 0;
  const q2 = m.malloc((I[0x69a0 >> 2] << 2) + 12);
  I = m.I;
  I[0x6400 >> 2] = q2;
  // the rendered picture (now layer 4's image), flipped vertically, alpha cleared
  let src = I[0x28f4 >> 2];
  I[q2 >> 2] = I[0x61a8 >> 2];
  I[(q2 + 4) >> 2] = I[0x61a4 >> 2];
  I[(q2 + 8) >> 2] = 0;
  const base = q2 + 12, end = base + (I[0x69a0 >> 2] << 2);
  I[0x67a8 >> 2] = base;
  I[0x611c >> 2] = end;
  I[0x6374 >> 2] = 0;
  const rows = I[0x6718 >> 2], cols = I[0x672c >> 2];
  for (let i = 0; i < rows; i++) {
    let d = end - (Math.imul(i + 1, cols) << 2), j = 0;
    for (; j < cols; j++) { I[d >> 2] = I[src >> 2] & 0xffffff; d += 4; src += 4; }
    I[0x6118 >> 2] = d; I[0x614c >> 2] = src; I[0x634c >> 2] = j; I[0x6374 >> 2] = i + 1;
  }
  I[0x6214 >> 2] = 4;
  vt(c, 0x1b0);
  I = m.I;
  L = lb(c);
  I[(0x2120 + L) >> 2] = -1;
  I[(0x2144 + L) >> 2] = I[0x67a8 >> 2];
  I[0x6400 >> 2] = 0;
  return 0;
}

/** E+0xfc 0x10018f20: the drop shadow: through GDI+, the background under the picture's rectangle widened by
 *  the shadow offset, the soft-edged shadow over it, the picture pasted on top; the result, flipped and without
 *  alpha, becomes layer 4's image (its size grows to the canvas; its position fields are left alone) */
export function dropShadow(c: Core): number {
  const m = c.m;
  m.I[0x6214 >> 2] = 4;
  vt(c, 0x230);
  let I = m.I;
  const w = I[0x2954 >> 2], h = I[0x2958 >> 2];
  let x = I[0x28e0 >> 2], y = I[0x28e4 >> 2];
  const size = (((w + h) | 0) / 2) | 0;
  I[0x694c >> 2] = size;
  // canvas W x H at (x, y) on the window; the picture at (px, py) in it, the shadow at (sx, sy). The offsets
  // run 0..100 with 50 = none; offset = (setting - 50) * size / 260 (signed, truncated)
  let px: number, py: number, sx: number, sy: number, W: number, H: number;
  let v = I[0x688 >> 2];
  if (v >= 50) {
    const dx = (Math.imul((v - 50) | 0, size) / 260) | 0;
    px = 0; sx = dx; W = (dx + w) | 0;
  } else {
    const dx = (Math.imul((50 - v) | 0, size) / 260) | 0;
    x = (x - dx) | 0; px = dx; sx = x > 0 ? 0 : x; W = (dx + w) | 0;
  }
  v = I[0x68c >> 2];
  if (v >= 50) {
    const dy = (Math.imul((v - 50) | 0, size) / 260) | 0;
    py = 0; sy = dy; H = (dy + h) | 0;
  } else {
    const dy = (Math.imul((50 - v) | 0, size) / 260) | 0;
    y = (y - dy) | 0; py = dy; sy = y > 0 ? 0 : y; H = (dy + h) | 0;
  }
  if (x < 0) { px = (px + x) | 0; W = (px + w) | 0; x = 0; sx = 0; }
  if (((W + x) | 0) >= I[0x6590 >> 2]) { W = (I[0x6590 >> 2] - x) | 0; sx = (W - w) | 0; }   // >= (the asm's JL)
  if (y < 0) { py = (py + y) | 0; H = (h + py) | 0; y = 0; sy = 0; }
  if (((H + y) | 0) > I[0x6598 >> 2]) { H = (I[0x6598 >> 2] - y) | 0; sy = (H - h) | 0; }    // > (JLE)
  if (I[0x5e8 >> 2] === 0) I[0x5e8 >> 2] = 1;            // GdiplusStartup (token at obj+0x1850) done once
  // (W or H <= 0 would make GDI+ refuse the bitmaps; the picture always overlaps the window, so they are not)

  // bitmap 2 (W x H) locked for write as ARGB: the background, opaque; drawn at 0,0 onto the empty canvas
  // (bitmap 1) it is the canvas, exactly
  I[0x6118 >> 2] = SCAN2;
  I[0x672c >> 2] = W;
  I[0x6718 >> 2] = H;
  const cv = new Uint32Array(Math.max(Math.imul(W, H), 0));
  if (I[0x640 >> 2] === 0 && I[0x63c >> 2] === 0) {
    const n = Math.imul(I[0x6718 >> 2], I[0x672c >> 2]), col = (I[0x61bc >> 2] | 0xff000000) >>> 0;
    I[0x6374 >> 2] = 0;
    if (n > 0) { cv.fill(col, 0, n); I[0x6374 >> 2] = n; I[0x6118 >> 2] = SCAN2 + n * 4; }
  } else {
    const img = I[0x2ccc >> 2];
    I[0x614c >> 2] = img;
    // the background must be window-sized; otherwise the DLL unlocks and frees bitmap 2 and the Graphics
    // (leaking bitmap 1) and fails, the picture left as it was
    if (I[0x2d30 >> 2] !== I[0x6598 >> 2] || I[0x2d2c >> 2] !== I[0x6590 >> 2] || img === 0) return E_FAIL;
    const stride = I[0x2d2c >> 2], s = (img + ((Math.imul(stride, y) + x) << 2)) | 0;
    I[0x614c >> 2] = I[0x6150 >> 2] = s;
    I[0x6374 >> 2] = 0;
    let k = 0;
    for (let i = 0; i < H; i++) {
      let r = s + (Math.imul(stride, i) << 2), j = 0;
      for (; j < W; j++) { cv[k++] = (I[r >> 2] | 0xff000000) >>> 0; r += 4; }
      I[0x614c >> 2] = r; I[0x634c >> 2] = j; I[0x6374 >> 2] = i + 1;
    }
    I[0x6118 >> 2] = SCAN2 + k * 4;
  }

  // bitmap 3 (w x h, the picture's size) locked for write as ARGB: the shadow colour at the shadow's
  // transparency, alpha ramps along the edges, then an in-place alpha box blur
  const sh = new Uint32Array(Math.max(Math.imul(w, h), 0));
  const rgb = I[0x678 >> 2] & 0xffffff;
  I[0x614c >> 2] = SCAN3;
  I[0x694c >> 2] = (I[0x67c >> 2] << 24) | rgb;
  I[0x678 >> 2] = rgb;
  I[0x6374 >> 2] = 0;
  const wh = Math.imul(h, w);
  if (wh > 0) { sh.fill(I[0x694c >> 2] >>> 0); I[0x6374 >> 2] = wh; I[0x614c >> 2] = SCAN3 + wh * 4; }
  I[0x694c >> 2] = size;
  const edge = (Math.imul(I[0x680 >> 2], size) / 200) | 0;     // 0x51eb851f, SAR 6: / 200
  const t0 = I[0x684 >> 2];
  if (edge !== 0 && t0 <= I[0x67c >> 2]) {
    // alpha = t0 + k * step on the k-th row / column from each edge (rows overwrite, columns only lower it).
    // An edge wider than the picture (w or h < edge, panoramas) runs off the bitmap: the DLL writes outside
    // GDI+'s buffer there; here those writes are dropped.
    const step = fr((((I[0x67c >> 2] - t0) | 0) / edge) | 0);
    const ramp = (k: number): number => (((ftol(k * step) + t0) | 0) << 24) >>> 0;
    let p = wh - 1;
    for (let k = 0; k < edge; k++) {
      const A = ramp(k);
      for (let j = 0; j < w; j++) { sh[p] = ((sh[p] & 0xffffff) | A) >>> 0; p--; }
    }
    p = 0;
    for (let k = 0; k < edge; k++) {
      const A = ramp(k);
      for (let j = 0; j < w; j++) { sh[p] = ((sh[p] & 0xffffff) | A) >>> 0; p++; }
    }
    for (let k = 0; k < edge; k++) {
      const A = ramp(k);
      for (let j = 0, q = k; j < h; j++, q += w) if ((sh[q] & 0xff000000) >>> 0 > A) sh[q] = ((sh[q] & 0xffffff) | A) >>> 0;
    }
    for (let k = 0; k < edge; k++) {
      const A = ramp(k);
      for (let j = 0, q = w - k - 1; j < h; j++, q += w) if ((sh[q] & 0xff000000) >>> 0 > A) sh[q] = ((sh[q] & 0xffffff) | A) >>> 0;
    }
    // box blur of the alpha, radius obj+0x690 (set to 7 here), in place (left and upper neighbours are already
    // blurred), the centre counted twice (once rightwards, once leftwards), clipped taps not counted
    I[0x690 >> 2] = 7;
    const r = 7;
    let R = 0, Lt = 0, D = 0, U = 0, A = 0;
    p = 0;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++, p++) {
        let sum = 0;
        R = w - j > r ? r : w - j;
        for (let t = 0; t < R; t++) sum += (sh[p + t] >>> 8) & 0xff0000;
        Lt = j > r ? r : j;
        for (let t = 0; t < Lt; t++) sum += (sh[p - t] >>> 8) & 0xff0000;
        D = h - i > r ? r : h - i;
        for (let t = 0; t < D; t++) sum += (sh[p + t * w] >>> 8) & 0xff0000;
        U = i > r ? r : i;
        for (let t = 0; t < U; t++) sum += (sh[p - t * w] >>> 8) & 0xff0000;
        const avg = ((sum / (U + D + Lt + R)) | 0) & 0xffff0000;
        A = avg & 0xff000000 ? 0xff000000 | 0 : avg << 8;
        sh[p] = ((sh[p] & 0xffffff) | A) >>> 0;
      }
    }
    I[0x6150 >> 2] = SCAN3;
    I[0x614c >> 2] = SCAN3 + p * 4;
    I[0x634c >> 2] = h > 0 ? h : 0;
    if (h > 0) {
      I[0x6374 >> 2] = w > 0 ? w : 0;
      if (w > 0) {
        I[0x66c4 >> 2] = A; I[0x6518 >> 2] = R; I[0x6514 >> 2] = Lt; I[0x694 >> 2] = D; I[0x698 >> 2] = U;
        I[0x6354 >> 2] = U;
      }
    }
  }
  if (c.dbg) { c.dbg('shadow-bg', cv, W, H); c.dbg('shadow', sh, w, h); }
  gdipDrawShadow(cv, W, H, sh, w, h, sx, sy);
  if (c.dbg) c.dbg('shadow-composite', cv, W, H);

  // bitmap 1 locked for read as ARGB (the identity, it is opaque): the picture is pasted into that buffer
  // at (px, py), flipped, alpha cleared, and the whole buffer copied out flipped again, alpha cleared
  let src = I[(0x2144 + lb(c)) >> 2];
  const top = Math.imul((py + h) | 0, W) + px;
  I[0x611c >> 2] = SCAN1 + top * 4;
  I[0x6374 >> 2] = 0;
  for (let i = 0; i < h; i++) {
    let d = top - Math.imul(i + 1, W), j = 0;
    for (; j < w; j++) { cv[d++] = I[src >> 2] & 0xffffff; src += 4; }
    I[0x6118 >> 2] = SCAN1 + d * 4; I[0x614c >> 2] = src; I[0x634c >> 2] = j; I[0x6374 >> 2] = i + 1;
  }
  I[0x69a0 >> 2] = Math.imul(H, W);
  const q = m.malloc((I[0x69a0 >> 2] << 2) + 12);         // (the DLL's out-of-memory exit is unreachable here)
  m.I[0x6400 >> 2] = q;
  m.I[0x6214 >> 2] = 4;
  vt(c, 0x1b0);
  I = m.I;
  I[q >> 2] = W;
  I[(q + 4) >> 2] = H;
  I[(q + 8) >> 2] = 0;
  const base = q + 12, end = base + (I[0x69a0 >> 2] << 2);
  I[0x6118 >> 2] = base;
  I[0x67a8 >> 2] = base;
  I[0x611c >> 2] = end;
  I[0x614c >> 2] = SCAN1;
  I[0x6374 >> 2] = 0;
  const rows = I[0x6718 >> 2], cols = I[0x672c >> 2];
  let k = 0;
  for (let i = 0; i < rows; i++) {
    let d = end - (Math.imul(i + 1, cols) << 2), j = 0;
    for (; j < cols; j++) { I[d >> 2] = cv[k++] & 0xffffff; d += 4; }
    I[0x6118 >> 2] = d; I[0x614c >> 2] = SCAN1 + k * 4; I[0x634c >> 2] = j; I[0x6374 >> 2] = i + 1;
  }
  const L = lb(c);
  I[(0x2120 + L) >> 2] = -1;
  I[(0x21a4 + L) >> 2] = W;
  I[(0x21a8 + L) >> 2] = H;
  I[(0x214c + L) >> 2] = W;
  I[(0x2150 + L) >> 2] = H;
  I[(0x2144 + L) >> 2] = I[0x67a8 >> 2];
  I[0x6400 >> 2] = 0;
  return 0;
}

def({ 0xf0: photoEdge, 0xfc: dropShadow });
