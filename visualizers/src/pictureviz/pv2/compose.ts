// PictureViz_II's per-frame compositor (E+0x14c 0x10007280) and what it reaches, except the per-layer effect
// kernels (fx.ts / fx2.ts, called through vt()): the canvas fill (background colour or picture), the
// projection and clipping of every layer, the depth sort, the per-layer renderer (effects chain, scale,
// clip, draw), the canvas-to-window scale and the blit into Render's DC. The ancestors are Musical Colors'
// compose / placeLayers / project / clipLayer / sortLayers / renderLayer / scaleOut / DDA scalers
// (musical/core.ts); offsets and several details differ, so everything is transliterated from the PV2 asm.
//
// Canvas: obj+0x63e4, 0x6590 x 0x6598 (stride 0x6594 bytes). The draw target: obj+0x6100 (0x61a8 x 0x61a4)
// at (0x69e8, 0x69fc) of the canvas. 0x659c != 0: redraw everything every frame; 0 = the dirty-rectangle
// path (only moved layers, rect by rect). 0x62f4 = out of memory (never here).
import type { Core } from './core';
import { lb, xb } from './core';
import { ftol, fr } from './mem';
import { def, vt } from './vt';

const M32 = 4294967296;
/** FCOMP float 0.0 (0x100323d0) + TEST AH,0x40: "not equal" (an unordered NaN sets C3 too: counts as equal) */
const nz = (f: number): boolean => f < 0 || f > 0;
/** 8.8 scales the DLL treats as 1.0 (no scaling): 0 and 0xfe..0x102 */
const unscaled = (v: number): boolean => v === 0 || (v >= 0xfe && v <= 0x102);
function bswap(x: number): number {
  return ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
}
/** free(obj+off) if set, then obj+off = 0 */
function freeField(c: Core, off: number): void {
  const I = c.m.I, p = I[off >> 2];
  if (p !== 0) { c.m.release(p); I[off >> 2] = 0; }
}

// ---------------------------------------------------------------- the frame

/** E+0x14c 0x10007280: one frame: the canvas := background colour 0x61bc (or the background picture 0x2ccc
 *  when it is on and canvas-sized), place and clip every layer, then either draw all layers and blit
 *  (0x659c != 0) or, rect by rect, redraw the old and new rects of every moved layer. */
export function frame(c: Core): number {
  const m = c.m;
  let I = m.I;
  I[0x6594 >> 2] = I[0x6590 >> 2] << 2;
  I[0x61e4 >> 2] = (I[0x63d0 >> 2] / 2) | 0;
  I[0x61ec >> 2] = (I[0x63d4 >> 2] / 2) | 0;
  if (I[0x63e4 >> 2] === 0) {
    const p = m.malloc(Math.imul(I[0x6598 >> 2], I[0x6590 >> 2]) << 2);
    I = m.I;
    I[0x63e4 >> 2] = p;
    if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  }
  const w = I[0x6590 >> 2], h = I[0x6598 >> 2], bg = I[0x2ccc >> 2], cv = I[0x63e4 >> 2];
  const fill = (I[0x640 >> 2] === 0 && I[0x63c >> 2] === 0) || I[0x2d30 >> 2] !== h || I[0x2d2c >> 2] !== w || bg === 0;
  const n = Math.imul(h, w);
  if (!fill) I[0x614c >> 2] = bg;
  I[0x6118 >> 2] = cv;
  I[0x69a0 >> 2] = n;
  I[0x634c >> 2] = 0;
  if (n > 0) {                                    // the loops leave their cursors behind
    if (fill) m.U.fill(m.U[0x61bc >> 2], cv >> 2, (cv >> 2) + n);
    else { m.U.copyWithin(cv >> 2, bg >> 2, (bg >> 2) + n); I[0x614c >> 2] = (bg + (n << 2)) | 0; }
    I[0x6118 >> 2] = (cv + (n << 2)) | 0;
    I[0x634c >> 2] = n;
  }
  vt(c, 0x2c4);                                   // place (project) the layers
  vt(c, 0x12c);                                   // clip them to the canvas
  I = m.I;
  if (I[0x659c >> 2] !== 0) {
    I[0x6100 >> 2] = I[0x63e4 >> 2];
    I[0x69e8 >> 2] = 0;
    I[0x69fc >> 2] = 0;
    I[0x61a8 >> 2] = I[0x6590 >> 2];
    I[0x61a4 >> 2] = I[0x6598 >> 2];
    vt(c, 0x1f0);                                 // draw every layer, back to front
    if (m.I[0x62e8 >> 2] !== 0) vt(c, 0x19c);     // blit
    m.I[0x6370 >> 2] = 0;
    return 0;
  }
  I[0x6370 >> 2] = 1;
  freeField(c, 0x63e8);
  vt(c, 0x120);                                   // the old rects of moved layers
  if (!dirtyPass(c, 0x120, 0x62d4)) return 0;
  vt(c, 0x11c);                                   // the new rects
  dirtyPass(c, 0x11c, 0x62d0);
  return 0;
}

/** 0x100074c3 / 0x10007546: while the rect finder (next) has a rect (done flag != 1): copy the rect out of
 *  the canvas, draw the layers into it, blit it, free it, find the next. false = out of memory. */
function dirtyPass(c: Core, next: number, done: number): boolean {
  const m = c.m;
  while (m.I[done >> 2] !== 1) {
    let I = m.I;
    const p = m.malloc(Math.imul(I[0x61a8 >> 2], I[0x61a4 >> 2]) << 2);
    I = m.I;
    I[0x63e8 >> 2] = p;
    if (p === 0) { I[0x62f4 >> 2] = 1; return false; }
    I[0x6100 >> 2] = p;
    vt(c, 0x1d8);
    vt(c, 0x1fc);
    vt(c, 0x19c);
    freeField(c, 0x63e8);
    vt(c, next);
  }
  return true;
}

// ---------------------------------------------------------------- blit

/** E+0x19c 0x10007610: scale the draw target to the window (0x6308 = 1, always), convert it to the display
 *  depth 0x61b8, then CreateDIBitmap (BITMAPINFOHEADER at 0x6130, top-down) + BitBlt SRCCOPY onto Render's
 *  DC (0x63a4) at (0x69e8, 0x69fc) := the window rect's origin (0x65bc, 0x65c0). Written into c.dc. */
export function blit(c: Core): number {
  const m = c.m;
  let I = m.I;
  if (I[0x6308 >> 2] === 1) vt(c, 0x240);
  I = m.I;
  if (I[0x62f4 >> 2] === 1) return 0;
  // obj+0x50 is the DirectDraw surface of the full-screen path (GetDC / ReleaseDC / Flip on it): 0 windowed
  I[0x6814 >> 2] = I[0x63a4 >> 2];
  const bpp = I[0x61b8 >> 2];
  if (bpp === 24 || bpp === 16) vt(c, 0x15c);
  I = m.I;
  if (I[0x6308 >> 2] === 1) {
    I[0x69e8 >> 2] = I[0x65bc >> 2];
    I[0x69fc >> 2] = I[0x65c0 >> 2];
  }
  if (I[0x612c >> 2] === 0) {
    const p = m.malloc(0x34);
    I = m.I;
    I[0x612c >> 2] = p;
    if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
    I[0x6130 >> 2] = p;
    I[0x6340 >> 2] = 0x28;
    I[0x6134 >> 2] = p + 0xa0;
    I[p >> 2] = 0x28;                             // biSize
    I[(p + 4) >> 2] = 0;
    I[(p + 8) >> 2] = 0;
    m.H[(p + 0xc) >> 1] = 1;                      // biPlanes
    m.H[(p + 0xe) >> 1] = I[0x61b8 >> 2];
    I[(p + 0x10) >> 2] = 0;                       // BI_RGB
    I[(p + 0x18) >> 2] = 0;
    I[(p + 0x1c) >> 2] = 0;
    I[(p + 0x20) >> 2] = 0;
    I[(p + 0x24) >> 2] = 0;
  }
  const bi = I[0x6130 >> 2];
  m.H[(bi + 0xe) >> 1] = I[0x61b8 >> 2];
  I[(bi + 0x14) >> 2] = Math.imul(I[0x61a4 >> 2], I[0x61a8 >> 2]);
  I[(bi + 4) >> 2] = I[0x61a8 >> 2];
  I[(bi + 8) >> 2] = -I[0x61a4 >> 2] | 0;
  // 8 bpp: StretchDIBits of a 32-bit DIB onto a palette display; not a configuration the port models
  if (bpp === 8) throw new Error('PictureViz2: blit to an 8-bit display (0x100077f3) is not ported');
  blitToDC(c, bpp);
  I = m.I;
  I[0x6378 >> 2] = I[0x61a8 >> 2];
  I[0x637c >> 2] = I[0x61a4 >> 2];
  I[0x6380 >> 2] = I[0x6100 >> 2];
  return 0;
}

/** the DIB (0x6100, 0x61a8 x 0x61a4, top-down, bpp bits per pixel, rows padded to 4 bytes) BitBlt'ed onto
 *  c.dc at (0x69e8, 0x69fc), clipped to the DC */
function blitToDC(c: Core, bpp: number): void {
  const m = c.m, I = m.I, U = m.U, B = m.B, dc = c.dc, W = c.dcW, H = c.dcH;
  const w = I[0x61a8 >> 2], h = I[0x61a4 >> 2], x0 = I[0x69e8 >> 2], y0 = I[0x69fc >> 2], src = I[0x6100 >> 2];
  const xa = x0 < 0 ? -x0 : 0, xe = x0 + w > W ? W - x0 : w;
  const ya = y0 < 0 ? -y0 : 0, ye = y0 + h > H ? H - y0 : h;
  if (bpp === 32) {
    for (let y = ya; y < ye; y++) {
      let s = (src >> 2) + y * w + xa, d = (y0 + y) * W + x0 + xa;
      for (let x = xa; x < xe; x++) dc[d++] = U[s++] & 0xffffff;
    }
  } else if (bpp === 24) {
    const stride = (w * 3 + 3) & ~3;
    for (let y = ya; y < ye; y++) {
      let s = src + y * stride + xa * 3, d = (y0 + y) * W + x0 + xa;
      for (let x = xa; x < xe; x++, s += 3) dc[d++] = B[s] | B[s + 1] << 8 | B[s + 2] << 16;
    }
  } else {
    // 16 bpp (x555): GDI's 5-to-8-bit expansion assumed to replicate the top bits
    const stride = (w * 2 + 3) & ~3;
    for (let y = ya; y < ye; y++) {
      let s = src + y * stride + xa * 2, d = (y0 + y) * W + x0 + xa;
      for (let x = xa; x < xe; x++, s += 2) {
        const v = B[s] | B[s + 1] << 8, r = (v >> 10) & 31, g = (v >> 5) & 31, b = v & 31;
        dc[d++] = (r << 3 | r >> 2) << 16 | (g << 3 | g >> 2) << 8 | (b << 3 | b >> 2);
      }
    }
  }
}

/** E+0x15c 0x10007ef0: the draw target to the display depth, in place: 24 bpp (packed BGR, one dword stored
 *  every 3 bytes) or 16 bpp (x555). */
export function toDisplayDepth(c: Core): number {
  const m = c.m, I = m.I, U = m.U, B = m.B, Hw = m.H;
  const n = Math.imul(I[0x61a8 >> 2], I[0x61a4 >> 2]) >>> 0;
  let s = I[0x6100 >> 2], d = s;
  if (I[0x61b8 >> 2] === 24) {
    for (let i = 0; i < n; i++, s += 4, d += 3) {
      const v = U[s >> 2];
      B[d] = v; B[d + 1] = v >>> 8; B[d + 2] = v >>> 16; B[d + 3] = v >>> 24;
    }
  } else {
    for (let i = 0; i < n; i++, s += 4, d += 2) {
      let v = U[s >> 2] >>> 3;
      const lo = v & 0x1f;
      v >>>= 3;
      const mid = v & 0x3e0;
      v >>>= 3;
      Hw[d >> 1] = (v & 0x7c00) | lo | mid;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- canvas -> window

/** E+0x240 0x10014610: the draw target scaled to the window (0x6408 x 0x640c) by 8.8 factors
 *  (0x65b4, 0x65b8; doubled first while either is > 3x), rows padded (0x60f8); then, when it still differs
 *  from the window (and 0x6458 = 1), copied top-left into a window-sized buffer filled with 0x65e4. The
 *  result is the new 0x6100 (owned by 0x63e8). */
export function scaleToWindow(c: Core): number {
  const m = c.m;
  let I = m.I;
  I[0x68bc >> 2] = I[0x6590 >> 2];
  let hh = I[0x6598 >> 2], sx: number;
  for (;;) {
    I[0x68c0 >> 2] = hh;
    sx = ftol(I[0x6408 >> 2] * 256 / I[0x68bc >> 2]);
    I[0x65b4 >> 2] = sx;
    I[0x65b8 >> 2] = ftol(I[0x640c >> 2] * 256 / I[0x68c0 >> 2]);
    if (sx <= 0x300 && I[0x65b8 >> 2] <= 0x300) break;
    vt(c, 0x198);                                 // 2x the target first
    I = m.I;
    I[0x68bc >> 2] = I[0x68bc >> 2] << 1;
    hh = I[0x68c0 >> 2] << 1;
  }
  I[0x6494 >> 2] = I[0x61a8 >> 2];
  I[0x6490 >> 2] = I[0x61a4 >> 2];
  I[0x6124 >> 2] = I[0x6100 >> 2];
  I[0x67a4 >> 2] = sx;
  I[0x694c >> 2] = I[0x68bc >> 2];
  vt(c, 0x144);
  I = m.I;
  I[0x61a8 >> 2] = I[0x694c >> 2];
  I[0x67a4 >> 2] = I[0x65b8 >> 2];
  I[0x694c >> 2] = I[0x68c0 >> 2];
  vt(c, 0x144);
  I = m.I;
  I[0x61a4 >> 2] = I[0x694c >> 2];
  vt(c, 0x220);
  I = m.I;
  I[0x61a8 >> 2] = (I[0x61a8 >> 2] + I[0x60f8 >> 2]) | 0;
  let p = m.malloc(Math.imul(I[0x61a8 >> 2], I[0x61a4 >> 2]) << 2);
  I = m.I;
  I[0x63ec >> 2] = p;
  if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  I[0x6100 >> 2] = p;
  I[0x6454 >> 2] = p;
  vt(c, 0x248);
  I = m.I;
  I[0x6124 >> 2] = I[0x6454 >> 2];
  freeField(c, 0x63e8);
  I[0x63e8 >> 2] = I[0x63ec >> 2];
  const wh = I[0x640c >> 2];
  if (I[0x61a4 >> 2] > wh) I[0x61a4 >> 2] = wh;
  if (I[0x61b8 >> 2] === 8) I[0x6458 >> 2] = 1;
  const ch = I[0x61a4 >> 2], ww = I[0x6408 >> 2], cw = I[0x61a8 >> 2];
  if (!(I[0x6458 >> 2] === 1 && (wh !== ch || ww !== cw))) return 0;
  // 0x1001480a: into a window-sized buffer (at least the scaled size), background 0x65e4, top-left
  I[0x62b4 >> 2] = cw;
  I[0x62b0 >> 2] = ch;
  I[0x62b8 >> 2] = cw << 2;
  if (cw < ww) I[0x61a8 >> 2] = ww;
  if (ch < wh) I[0x61a4 >> 2] = wh;
  if (I[0x62b4 >> 2] > I[0x61a8 >> 2]) I[0x61a8 >> 2] = I[0x62b4 >> 2];
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  vt(c, 0x220);
  I = m.I;
  I[0x61a8 >> 2] = (I[0x61a8 >> 2] + I[0x60f8 >> 2]) | 0;
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  p = m.malloc(Math.imul(I[0x61a8 >> 2], I[0x61a4 >> 2]) << 2);
  I = m.I;
  I[0x63ec >> 2] = p;
  if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  const U = m.U;
  I[0x6100 >> 2] = p;
  const n = Math.imul(I[0x61a8 >> 2], I[0x61a4 >> 2]);
  I[0x69a0 >> 2] = n;
  if (n > 0) U.fill(U[0x65e4 >> 2], p >> 2, (p >> 2) + n);
  const rows = I[0x62b0 >> 2], cols = I[0x62b4 >> 2], dw = I[0x61a8 >> 2];
  let s = I[0x6124 >> 2], d = p;
  for (let r = 0; r < rows; r++) {
    I[0x6354 >> 2] = 0;
    if (cols > 0) {
      U.copyWithin(d >> 2, s >> 2, (s >> 2) + cols);
      s += cols << 2; d += cols << 2;
      I[0x6354 >> 2] = cols;
    }
    d += (dw - cols) << 2;
  }
  I[0x614c >> 2] = s;
  I[0x6118 >> 2] = d;
  I[0x69c0 >> 2] = rows > 0 ? rows : 0;
  I[0x6124 >> 2] = I[0x6454 >> 2];
  freeField(c, 0x63e8);
  I[0x63e8 >> 2] = I[0x63ec >> 2];
  I[0x63ec >> 2] = 0;
  return 0;
}

/** E+0x198 0x10014b20: 2x the draw target (each pixel twice, each row twice) into a new buffer. */
export function double2x(c: Core): number {
  const m = c.m;
  let I = m.I;
  I[0x6124 >> 2] = I[0x6100 >> 2];
  const w = I[0x61a8 >> 2], h = I[0x61a4 >> 2];
  I[0x62b0 >> 2] = h;
  I[0x62b4 >> 2] = w;
  I[0x62b8 >> 2] = w << 2;
  const p = m.malloc(Math.imul(h, w) << 4);
  I = m.I;
  I[0x63ec >> 2] = p;
  if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  I[0x6100 >> 2] = p;
  const U = m.U;
  let s = I[0x6124 >> 2] >> 2, d = p >> 2, i: number, v: number;
  for (let r = h; ; ) {
    for (i = 0; i < w; i++) { v = U[s++]; U[d++] = v; U[d++] = v; }
    s -= w;
    for (i = 0; i < w; i++) { v = U[s++]; U[d++] = v; U[d++] = v; }
    if (--r === 0) break;
  }
  freeField(c, 0x63e8);
  I[0x61a8 >> 2] = w << 1;
  I[0x61a4 >> 2] = h << 1;
  I[0x63e8 >> 2] = I[0x63ec >> 2];
  I[0x63ec >> 2] = 0;
  return 0;
}

/** E+0x220 0x10008210: 0x60f8 := the pixels that pad a row of 0x61a8 to the DIB's dword alignment at the
 *  display depth (0x61b8; the DirectDraw surface's obj+0x8 when there is one). 32 bpp windowed: none. */
export function rowPad(c: Core): number {
  const I = c.m.I, w = I[0x61a8 >> 2];
  I[0x60f8 >> 2] = 0;
  if (I[0x630c >> 2] === 1) return 0;
  if (I[0x50 >> 2] === 0) {
    const d = I[0x61b8 >> 2];
    if (d === 8 || d === 24) { if (w & 3) I[0x60f8 >> 2] = 4 - (w & 3); }
    else if (d === 16) { if (w & 1) I[0x60f8 >> 2] = 1; }
  } else {
    const d = I[0x8 >> 2];
    if (d === 8 || d === 16 || d === 24 || d === 32) { if (w & 3) I[0x60f8 >> 2] = 4 - (w & 3); }
  }
  return 0;
}

/** E+0x248 0x10013bc0: DDA scale of 0x6124 (0x6494 x 0x6490) into 0x6454 by 0x65b4 / 0x65b8 (8.8),
 *  rows of the scaled width padded with 0x60f8 pixels of 0x65e4; duplicated rows are 0x61a8 wide. */
export function scaleRows(c: Core): number {
  const I = c.m.I, sx = I[0x65b4 >> 2], sy = I[0x65b8 >> 2];
  I[0x662c >> 2] = 0;
  if (sx <= 0xff) I[0x68e8 >> 2] = 0x100;
  else if (sx <= 0x200) I[0x68e8 >> 2] = 0x200;
  else if (sx <= 0x300) I[0x68e8 >> 2] = 0x2ff;
  if (sy <= 0xff) I[0x68ec >> 2] = 0x100;
  else if (sy <= 0x200) I[0x68ec >> 2] = 0x200;
  else if (sy <= 0x300) I[0x68ec >> 2] = 0x2ff;
  else return 0;
  I[0x662c >> 2] = 0;
  I[0x6498 >> 2] = I[0x6494 >> 2] << 2;
  I[0x6718 >> 2] = I[0x6490 >> 2];
  const ux = sx >>> 0, uy = sy >>> 0;
  let e = (I[0x68ec >> 2] - sy) >>> 0;
  if (uy > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
  const stepY = bswap(e);
  I[0x6614 >> 2] = stepY;
  e = (I[0x68e8 >> 2] - sx) >>> 0;
  if (ux > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
  const xm = ux <= 0x100 ? 0 : ux <= 0x200 ? 1 : 2, ym = uy <= 0x100 ? 0 : uy <= 0x200 ? 1 : 2;
  ddaRows(c, xm, ym, bswap(e), stepY, 0x61a8, I[0x60f8 >> 2]);
  return 0;
}

/** The row DDA shared by scaleRows and the sprite scalers 0x10013f00 / 0x10013f90 / 0x10014030: source
 *  0x6124 (0x6494 wide, 0x6718 rows), destination 0x6454. Columns (xm): 0 = shrink (a carry of the 32-bit
 *  sum skips a source pixel), 1 = up to 2x (no carry: the pixel twice), 2 = up to 3x (twice, no carry:
 *  three times). Rows (ym) the same, by whole rows: 0 skips a source row (0x6498 bytes) on a carry, 1 and 2
 *  copy the output row just written (dupOff wide) below itself. Then pad pixels of 0x65e4. 0x662c is the
 *  row accumulator. */
function ddaRows(c: Core, xm: number, ym: number, stepX: number, stepY: number, dupOff: number, pad: number): void {
  const I = c.m.I, U = c.m.U;
  const srcW = I[0x6494 >> 2], skip = I[0x6498 >> 2] >> 2, padV = U[0x65e4 >> 2], dupW = I[dupOff >> 2];
  let si = I[0x6124 >> 2] >> 2, di = I[0x6454 >> 2] >> 2, rows = I[0x6718 >> 2], accY = I[0x662c >> 2] >>> 0;
  let n: number, acc: number, px: number, i: number;
  for (;;) {
    n = srcW; acc = 0;
    if (xm === 0) {
      row: for (;;) {
        U[di++] = U[si];
        for (;;) {
          si++;
          if (--n === 0) break row;
          acc += stepX;
          if (acc < M32) break;
          acc -= M32;
        }
      }
    } else if (xm === 1) {
      for (;;) {
        px = U[si++]; U[di++] = px;
        if (--n === 0) break;
        acc += stepX;
        if (acc >= M32) acc -= M32; else U[di++] = px;
      }
    } else {
      for (;;) {
        px = U[si++]; U[di++] = px; U[di++] = px;
        if (--n === 0) break;
        acc += stepX;
        if (acc >= M32) acc -= M32; else U[di++] = px;
      }
    }
    for (i = 0; i < pad; i++) U[di++] = padV;
    if (ym === 0) {
      for (;;) {
        if (--rows === 0) { I[0x6718 >> 2] = 0; I[0x662c >> 2] = accY | 0; return; }
        accY += stepY;
        if (accY < M32) break;
        accY -= M32;
        si += skip;
      }
      continue;
    }
    if (ym === 2) { U.copyWithin(di, di - dupW, di); di += dupW; }
    if (--rows === 0) { I[0x6718 >> 2] = 0; I[0x662c >> 2] = accY | 0; return; }
    accY += stepY;
    if (accY >= M32) { accY -= M32; continue; }
    U.copyWithin(di, di - dupW, di); di += dupW;
  }
}

// ---------------------------------------------------------------- 8.8 sizes

/** the DDA counts of 0x10013a40 / 0x10013ab0 / 0x10013b30 and 0x10013e30 / 0x10013e70 / 0x10013eb0 (f = 0, 1,
 *  2): how many output samples n input samples become at 8.8 scale 0x67a4 */
function scaledCount(n: number, step: number, f: number): number {
  let out = f === 2 ? 2 : 1, acc = 0;
  for (;;) {
    if (--n === 0) return out;
    acc += step;
    if (acc >= M32) { acc -= M32; if (f !== 0) out += f; continue; }
    out += f + 1;
  }
}
/** the DDA step of scale 0x67a4 for count/scale variant f */
function stepOf(I: Int32Array, f: number): number {
  const v = I[0x67a4 >> 2];
  if (f === 0) return bswap((0x100 - v) >>> 0);
  if (f === 1) return bswap((0x200 - v) >>> 0);
  let e = (0x2ff - v + 1) >>> 0;
  if (e > 0xff) e = 0;
  return bswap(e);
}
/** 0x10013a40 / 0x10013ab0 / 0x10013b30: 0x62b4, 0x62b0 and (when non-zero) 0x6840 at scale 0x67a4 */
function dimsAt(c: Core, f: number): number {
  const I = c.m.I, st = stepOf(I, f);
  I[0x62b4 >> 2] = scaledCount(I[0x62b4 >> 2], st, f);
  I[0x62b0 >> 2] = scaledCount(I[0x62b0 >> 2], st, f);
  if (I[0x6840 >> 2] !== 0) I[0x6840 >> 2] = scaledCount(I[0x6840 >> 2], st, f);
  return 0;
}
/** 0x10013e30 / 0x10013e70 / 0x10013eb0: 0x694c at scale 0x67a4 */
function lenAt(c: Core, f: number): number {
  const I = c.m.I;
  I[0x694c >> 2] = scaledCount(I[0x694c >> 2], stepOf(I, f), f);
  return 0;
}

/** E+0x140 0x100137c0: the sprite size 0x62b4 x 0x62b0 (and 0x6840) at scale 0x67a4 (kept in 0x67b8/0x67ac) */
export function scaleDims(c: Core): number {
  const I = c.m.I, v = I[0x67a4 >> 2];
  if (unscaled(v)) return 0;
  I[0x67b8 >> 2] = I[0x62b4 >> 2];
  I[0x67ac >> 2] = I[0x62b0 >> 2];
  if (v <= 0xff) return vt(c, 0x2a0);
  if (v <= 0x200) return vt(c, 0x2a8);
  if (v > 0x300) I[0x67a4 >> 2] = 0x300;
  vt(c, 0x2b0);
  return 0;
}
/** E+0x144 0x10013860: 0x694c at scale 0x67a4 */
export function scaleLen(c: Core): number {
  const I = c.m.I, v = I[0x67a4 >> 2];
  if (v === 0x100) return 0;
  if (v <= 0xff) return vt(c, 0x2a4);
  if (v <= 0x200) return vt(c, 0x2ac);
  if (v > 0x300) I[0x67a4 >> 2] = 0x300;
  vt(c, 0x2b4);
  return 0;
}

// ---------------------------------------------------------------- place, project, clip

/** E+0x2c4 0x1000a130: bind and project every used layer (only dirty ones (>= 2) when 0x659c == 0; a
 *  dirty-1 layer counts as dirty in the redraw-all mode, a dirty-0 one is projected without the test). */
export function placeLayers(c: Core): number {
  const m = c.m;
  m.I[0x6214 >> 2] = 0;
  do {
    const I = m.I, b = lb(c);
    if (I[(0x211c + b) >> 2] !== -1) {
      let go: boolean;
      if (I[0x659c >> 2] !== 0 && I[(0x212c + b) >> 2] < 2 && I[(0x212c + b) >> 2] === 0) go = true;
      else {
        if (I[0x659c >> 2] !== 0 && I[(0x212c + b) >> 2] < 2) I[(0x212c + b) >> 2] = 2;
        go = I[(0x212c + b) >> 2] >= 2;
      }
      // no image to bind (0x2120 == -1): projected as it is; else bind it (0x200) and project if that worked
      if (go && (I[(0x2120 + b) >> 2] === -1 || vt(c, 0x200) !== 0)) vt(c, 0x230);
    }
    m.I[0x6214 >> 2] = (m.I[0x6214 >> 2] + 1) | 0;
  } while ((m.I[0x6214 >> 2] >>> 0) < (m.I[0x63c4 >> 2] >>> 0));
  return 0;
}

const K255 = fr(0.003921568859368563);           // 0x10032408 (1/255 as a float)

/** E+0x230 0x1000a1f0: perspective. The layer centre through the two rotations (projectPos), the scale
 *  focal / (focal + depth) (8.8, minus 0x21b4) into 0x2148 and 0x67a4, the size (scaleSize), the top-left
 *  0x2130 / 0x2134 (also 0x21c4 / 0x21c8); 0x62fc == 1: only the projected centre into 0x6730 / 0x6738. */
export function project(c: Core): number {
  const m = c.m;
  let I = m.I, F = m.F, b = lb(c);
  const hh = I[(0x221c + b) >> 2] === 2 ? (I[(0x21b8 + b) >> 2] + I[(0x21a8 + b) >> 2]) | 0 : I[(0x21a8 + b) >> 2];
  I[0x6810 >> 2] = hh;
  I[0x61b0 >> 2] = (I[(0x219c + b) >> 2] + hh) | 0;
  vt(c, 0x234);
  I = m.I; F = m.F; b = lb(c);
  const dz = I[0x6740 >> 2], foc = I[0x6324 >> 2];
  const t1 = (foc + dz) | 0, t2 = (I[0x69dc >> 2] + foc) | 0, t3 = (I[0x69dc >> 2] + foc + dz) | 0;
  F[0x6328 >> 2] = t1;
  F[0x6330 >> 2] = t2;
  F[0x632c >> 2] = t3;
  if (!(t2 > 1)) F[0x6330 >> 2] = 1;              // the exact ints still on the x87 stack
  if (!(t1 > 1)) F[0x6328 >> 2] = 1;
  if (!(fr(t3) > 1)) F[0x632c >> 2] = 1;          // reloaded from its float copy
  const q = (foc << 8) / F[0x6330 >> 2] * foc / F[0x6328 >> 2];
  F[0x6720 >> 2] = q;
  I[(0x2148 + b) >> 2] = (ftol(q) - I[(0x21b4 + b) >> 2]) | 0;          // of the unrounded double
  I[0x67a4 >> 2] = (ftol(F[0x6720 >> 2]) - I[(0x21b4 + b) >> 2]) | 0;   // of its float copy
  if (I[(0x2148 + b) >> 2] < 0) { I[(0x2148 + b) >> 2] = 1; I[0x67a4 >> 2] = 1; }
  if (I[0x62fc >> 2] === 0) vt(c, 0x1cc);
  I = m.I; F = m.F;
  const fo = I[0x6324 >> 2], ffo = fr(fo);
  const v = fo * F[0x627c >> 2] / F[0x6328 >> 2];
  F[0x627c >> 2] = v;
  const yp = I[0x6a00 >> 2] - v;
  F[0x66f0 >> 2] = yp;
  const cx = I[0x66e4 >> 2];
  F[0x66e8 >> 2] = cx;
  const w2 = fr((fo << 8) / F[0x6330 >> 2]);
  F[0x6644 >> 2] = w2;
  const xs = fr(cx * w2 * K255 - I[0x69d4 >> 2]);   // cx: the exact int (FILD), not its float copy
  F[0x6734 >> 2] = xs;
  const yv = yp * w2 * K255 - I[0x69d8 >> 2];
  F[0x673c >> 2] = yv;
  if (I[0x6304 >> 2] === 0) {
    const q2 = (F[0x61dc >> 2] - xs) * ffo / F[0x6328 >> 2];
    F[0x6274 >> 2] = q2;
    F[0x6734 >> 2] = F[0x61dc >> 2] - q2;
  }
  if (I[0x62fc >> 2] === 1) {
    I[0x6730 >> 2] = ftol(F[0x6734 >> 2]);
    I[0x6738 >> 2] = ftol(yv);                    // the double still on the stack
    return 0;
  }
  b = lb(c);
  F[0x6734 >> 2] = F[0x6734 >> 2] - ((I[(0x214c + b) >> 2] / 2) | 0);
  const h2 = (I[(0x21b8 + b) >> 2] + I[(0x21a8 + b) >> 2]) | 0;
  F[0x673c >> 2] = yv - (h2 * (F[0x6720 >> 2] * 0.00390625) + 1);
  I[(0x2130 + b) >> 2] = ftol(F[0x6734 >> 2] + 0.5);
  I[(0x2134 + b) >> 2] = ftol(F[0x673c >> 2] + 0.5);
  I[(0x21c4 + b) >> 2] = I[(0x2130 + b) >> 2];
  I[(0x21c8 + b) >> 2] = I[(0x2134 + b) >> 2];
  return 0;
}

/** E+0x234 0x1000a600: the layer centre relative to the canvas centre (0x61e4, 0x61ec) rotated by angle 0x69c4
 *  (cos table obj+0x5550, sin table obj+0x5af0, by degree), then depth 0x6740 and height 0x627c from angle
 *  0x69d0 over the distance to the bottom (0x6a00 = the larger canvas dimension). */
export function projectPos(c: Core): number {
  const I = c.m.I, F = c.m.F, b = lb(c);
  const cx0 = I[0x61e4 >> 2], a = I[0x69c4 >> 2];
  const cx = (((I[(0x21a4 + b) >> 2] / 2) | 0) + I[(0x2198 + b) >> 2]) | 0;
  I[0x66e4 >> 2] = cx;
  const dx = (cx - cx0) | 0, dy = (I[0x61b0 >> 2] - I[0x61ec >> 2]) | 0;
  I[0x6524 >> 2] = dx;
  I[0x6528 >> 2] = dy;
  const co = F[(0x5550 >> 2) + a], sn = F[(0x5af0 >> 2) + a];
  const rx = ftol(dx * co - dy * sn), ry = ftol(dy * co + dx * sn);
  I[0x6270 >> 2] = rx;
  I[0x6278 >> 2] = ry;
  I[0x66e4 >> 2] = (cx0 + rx) | 0;
  const y = (I[0x61ec >> 2] + ry) | 0;
  I[0x66ec >> 2] = y;
  I[(0x21a0 + b) >> 2] = y;
  I[0x6a00 >> 2] = I[0x63d0 >> 2] < I[0x63d4 >> 2] ? I[0x63d4 >> 2] : I[0x63d0 >> 2];
  const a2 = I[0x69d0 >> 2], z = (I[0x6a00 >> 2] - y) | 0;
  I[0x6528 >> 2] = z;
  I[0x6740 >> 2] = ftol(z * F[(0x5af0 >> 2) + a2]);
  F[0x627c >> 2] = z * F[(0x5550 >> 2) + a2];
  I[(0x2138 + b) >> 2] = I[0x6740 >> 2];
  return 0;
}

/** E+0x1cc 0x1000a750: the layer's on-canvas size at scale 0x67a4 into 0x214c / 0x2150 (and 0x21cc /
 *  0x21d0); its 0x21b8 (sign kept) into 0x21bc. */
export function scaleSize(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  I[0x62b4 >> 2] = I[(0x21a4 + b) >> 2];
  I[0x62b0 >> 2] = I[(0x21a8 + b) >> 2];
  const v = I[(0x21b8 + b) >> 2], neg = v < 0;
  I[0x6840 >> 2] = neg ? -v | 0 : v;
  vt(c, 0x140);
  I = m.I; b = lb(c);
  I[(0x21cc + b) >> 2] = I[0x62b4 >> 2];
  I[(0x21d0 + b) >> 2] = I[0x62b0 >> 2];
  I[(0x214c + b) >> 2] = I[0x62b4 >> 2];
  I[(0x2150 + b) >> 2] = I[0x62b0 >> 2];
  I[(0x21bc + b) >> 2] = neg ? -I[0x6840 >> 2] | 0 : I[0x6840 >> 2];
  return 0;
}

/** E+0x12c 0x10007b80: clip every layer. The index runs to 0x63c4 INCLUSIVE: "layer 10" is the memory after
 *  the last record (the draw-order list at obj+0x3454 onward), read and written as if it were one. */
export function clipLayers(c: Core): number {
  const m = c.m;
  m.I[0x6214 >> 2] = 0;
  do {
    vt(c, 0x130);
    m.I[0x6214 >> 2] = (m.I[0x6214 >> 2] + 1) | 0;
  } while ((m.I[0x6214 >> 2] >>> 0) <= (m.I[0x63c4 >> 2] >>> 0));
  return 0;
}

/** E+0x130 0x10007bc0: clip the current layer's projected rect to the canvas (0x21c0 = clipped). Off the
 *  canvas (or scaled below 0x6460): dirty := 0, 0x22ec := 1. The off-canvas tests use the image size
 *  (0x21a4 / 0x21a8), the clip the projected size (0x214c / 0x2150). */
export function clipLayer(c: Core): number {
  const I = c.m.I, b = lb(c);
  if (I[(0x211c + b) >> 2] === -1) return 0;
  if (I[(0x212c + b) >> 2] < 2 && I[0x659c >> 2] === 0) return 0;
  off: {
    if (I[(0x2148 + b) >> 2] < I[0x6460 >> 2]) break off;
    I[(0x22ec + b) >> 2] = 0;
    I[(0x21c0 + b) >> 2] = 0;
    const y = I[(0x2134 + b) >> 2], x = I[(0x2130 + b) >> 2], W = I[0x6590 >> 2], H = I[0x6598 >> 2];
    if (y >= H || x >= W) break off;
    if (((I[(0x21a4 + b) >> 2] + x - 1) | 0) < 0) break off;
    if (((I[(0x21a8 + b) >> 2] + y - 1) | 0) < 0) break off;
    const e = (x + I[(0x214c + b) >> 2]) | 0;
    if (x < 0) {
      I[(0x214c + b) >> 2] = e > W ? W : e;
      I[(0x21c0 + b) >> 2] = 1;
    } else if (e > W) {
      I[(0x214c + b) >> 2] = (W - x) | 0;
      I[(0x21c0 + b) >> 2] = 1;
    }
    const ey = (y + I[(0x2150 + b) >> 2]) | 0;
    if (y < 0) {
      I[(0x2150 + b) >> 2] = ey > H ? H : ey;
    } else {
      if (ey <= H) return 0;
      I[(0x2150 + b) >> 2] = (H - y) | 0;
    }
    I[(0x21c0 + b) >> 2] = 1;
    return 0;
  }
  I[(0x212c + b) >> 2] = 0;
  I[(0x22ec + b) >> 2] = 1;
  return 0;
}

// ---------------------------------------------------------------- depth order, draw loops

/** E+0x1f0 0x10008380: depth-sort (all layers), then render each, back to front (an old-rect state 2 becomes 1). */
export function drawLayers(c: Core): number {
  const m = c.m;
  vt(c, 0x2e4);
  m.I[0x6a08 >> 2] = 0;
  m.I[0x6214 >> 2] = m.I[0x3454 >> 2];
  while (m.I[0x6214 >> 2] !== -1) {
    const I = m.I, b = lb(c);
    if (I[(0x2154 + b) >> 2] === 2) I[(0x2154 + b) >> 2] = 1;
    vt(c, 0x21c);
    const J = m.I, k = (J[0x6a08 >> 2] + 1) | 0;
    J[0x6a08 >> 2] = k;
    J[0x6214 >> 2] = J[(0x3454 >> 2) + k];
  }
  return 0;
}

/** E+0x1fc 0x10008410: the dirty-rect draw: depth-sort (0x2e8), render each, back to front. */
export function drawDirtyLayers(c: Core): number {
  const m = c.m;
  vt(c, 0x2e8);
  m.I[0x6a08 >> 2] = 0;
  m.I[0x6214 >> 2] = m.I[0x3454 >> 2];
  while (m.I[0x6214 >> 2] !== -1) {
    vt(c, 0x21c);
    const J = m.I, k = (J[0x6a08 >> 2] + 1) | 0;
    J[0x6a08 >> 2] = k;
    J[0x6214 >> 2] = J[(0x3454 >> 2) + k];
  }
  return 0;
}

/** the "next depth / collect it" loop of the sorts: until nextDepth finds nothing (0x6264 stays 0x61a0) */
function sortPass(c: Core): void {
  const m = c.m;
  m.I[0x6264 >> 2] = m.I[0x61a0 >> 2];
  vt(c, 0x268);
  while (m.I[0x6264 >> 2] !== m.I[0x61a0 >> 2]) {
    vt(c, 0x210);
    m.I[0x6974 >> 2] = (m.I[0x6974 >> 2] + 1) | 0;
    m.I[0x6264 >> 2] = m.I[0x61a0 >> 2];
    vt(c, 0x268);
  }
}

/** E+0x2e4 0x100084d0: the draw-order list at obj+0x3454 by depth (0x21a0 + 10000) ascending: state-0
 *  layers first, then states 1 and 2; -1 terminated. */
export function sortLayers(c: Core): number {
  const I = c.m.I;
  I[0x6a08 >> 2] = 0;
  I[0x65a0 >> 2] = 0;
  I[0x65a4 >> 2] = 0;
  I[0x6974 >> 2] = 0;
  sortPass(c);
  const J = c.m.I;
  J[0x65a0 >> 2] = 1;
  J[0x65a4 >> 2] = 2;
  J[0x6974 >> 2] = 0;
  sortPass(c);
  c.m.I[(0x3454 >> 2) + c.m.I[0x6a08 >> 2]] = -1;
  return 0;
}

/** E+0x2e8 0x10008700: the dirty-rect sort: only when some state-2 layer exists, the states 1 and 2 by depth
 *  (0x6974 keeps what the probe added). */
export function sortDirtyLayers(c: Core): number {
  const m = c.m, I = m.I;
  I[0x6a08 >> 2] = 0;
  I[0x6974 >> 2] = 0;
  I[0x65a0 >> 2] = 2;
  I[0x65a4 >> 2] = 2;
  I[0x6264 >> 2] = I[0x61a0 >> 2];
  vt(c, 0x268);
  if (m.I[0x6264 >> 2] !== m.I[0x61a0 >> 2]) {
    m.I[0x65a0 >> 2] = 1;
    m.I[0x65a4 >> 2] = 2;
    sortPass(c);
  }
  m.I[(0x3454 >> 2) + m.I[0x6a08 >> 2]] = -1;
  return 0;
}

/** E+0x268 0x100087e0: 0x6974 += the smallest (depth - 0x6974) >= 0 among the candidates (dirty, state
 *  0x65a0 or 0x65a4) into 0x6264 (unchanged = none) */
export function nextDepth(c: Core): number {
  const I = c.m.I, n = I[0x63c4 >> 2] >>> 0;
  I[0x6214 >> 2] = 0;
  I[0x6690 >> 2] = 0;
  let k = 0;
  do {
    const b = k * 0x1ec;
    const st = I[(0x211c + b) >> 2], p0 = I[0x65a0 >> 2];
    if (I[(0x212c + b) >> 2] !== 0 && st !== -1 && (st === p0 || st === I[0x65a4 >> 2])) {
      const z = (I[(0x21a0 + b) >> 2] + 0x2710) | 0;
      I[0x6738 >> 2] = z < 0 ? 0 : z;
      if (p0 === 0 || p0 === 1 || p0 === 2) I[0x6690 >> 2] = I[0x6738 >> 2];
      const cur = I[0x6974 >> 2], d = I[0x6690 >> 2];
      if (cur <= d) {
        const diff = (d - cur) | 0;
        if (I[0x6264 >> 2] > diff) I[0x6264 >> 2] = diff;
      }
    }
    k = (k + 1) | 0;
    I[0x6214 >> 2] = k;
  } while ((k >>> 0) < n);
  I[0x6974 >> 2] = (I[0x6974 >> 2] + I[0x6264 >> 2]) | 0;
  return 0;
}

/** E+0x210 0x100088e0: append the candidates at depth 0x6974 to the list (0x6a08 = its length) */
export function collectDepth(c: Core): number {
  const I = c.m.I;
  I[0x6214 >> 2] = 0;
  let k = 0;
  do {
    const b = k * 0x1ec;
    const st = I[(0x211c + b) >> 2], p0 = I[0x65a0 >> 2];
    if (I[(0x212c + b) >> 2] !== 0 && st !== -1 && (st === p0 || st === I[0x65a4 >> 2])) {
      const z = (I[(0x21a0 + b) >> 2] + 0x2710) | 0;
      I[0x6738 >> 2] = (z >>> 0) > 0x80000000 ? 0 : z;
      if (p0 === 0 || p0 === 1 || p0 === 2) I[0x6690 >> 2] = I[0x6738 >> 2];
      if (I[0x6974 >> 2] === I[0x6690 >> 2]) {
        I[(0x3454 >> 2) + I[0x6a08 >> 2]] = k;
        I[0x6a08 >> 2] = (I[0x6a08 >> 2] + 1) | 0;
      }
    }
    k = (I[0x6214 >> 2] + 1) | 0;
    I[0x6214 >> 2] = k;
  } while ((k >>> 0) < (I[0x63c4 >> 2] >>> 0));
  return 0;
}

// ---------------------------------------------------------------- one layer

const FAIL = 0, SKIP = 1, RET = 2;

/** E+0x21c 0x100089e0: render the current layer (0x6214): clip its rect to the target, the edge map, then
 *  (dirty 3 only) its effects chain, each effect after a work-buffer swap (0x1a4), then the scale to its
 *  projected size (or the plain clip copy), then the draw (0x1e0). Every exit but a scaler's out-of-memory
 *  clears the four scratch-slot flags; a failure or a draw leaves dirty := 1 unless 0x61f0. */
export function renderLayer(c: Core): number {
  const m = c.m, I = m.I, b = lb(c);
  I[0x62b4 >> 2] = I[(0x21a4 + b) >> 2];
  I[0x6494 >> 2] = I[(0x21a4 + b) >> 2];
  I[0x62b0 >> 2] = I[(0x21a8 + b) >> 2];
  I[0x6490 >> 2] = I[(0x21a8 + b) >> 2];
  I[0x6124 >> 2] = I[(0x2144 + b) >> 2];
  I[0x6144 >> 2] = I[(0x2144 + b) >> 2];
  I[0x6120 >> 2] = I[(0x21dc + b) >> 2];
  I[0x60fc >> 2] = I[(0x21d8 + b) >> 2];
  const t = renderBody(c);
  const J = m.I;
  if (t === RET) return 0;
  if (t === FAIL && J[0x61f0 >> 2] === 0) J[(0x212c + lb(c)) >> 2] = 1;
  J[0x67b4 >> 2] = 0;
  J[0x6654 >> 2] = 0;
  J[0x6698 >> 2] = 0;
  J[0x66b0 >> 2] = 0;
  return 0;
}

/** swap the work buffers (0x1a4), then the effect; false = abandon the layer */
function fx(c: Core, off: number): boolean {
  if (vt(c, 0x1a4) === 0) return false;
  vt(c, off);
  return true;
}

function renderBody(c: Core): number {
  const m = c.m;
  let I = m.I, F = m.F, b = lb(c), x: number;
  if (I[0x62b4 >> 2] === 0 || I[0x62b0 >> 2] === 0 || I[0x6124 >> 2] === 0) return FAIL;
  I[0x68cc >> 2] = I[(0x2194 + b) >> 2];         // the colour key
  let h: number;
  if (I[(0x21c0 + b) >> 2] === 1) {               // clipped: the clipped rect
    I[0x6730 >> 2] = I[(0x21c4 + b) >> 2];
    I[0x6738 >> 2] = I[(0x21c8 + b) >> 2];
    I[0x62b4 >> 2] = I[(0x21cc + b) >> 2];
    h = I[(0x21d0 + b) >> 2];
  } else {
    I[0x6730 >> 2] = I[(0x2130 + b) >> 2];
    I[0x6738 >> 2] = I[(0x2134 + b) >> 2];
    I[0x62b4 >> 2] = I[(0x214c + b) >> 2];
    h = I[(0x2150 + b) >> 2];
  }
  I[0x62b0 >> 2] = h;
  I[0x69f0 >> 2] = I[0x62b4 >> 2];
  I[0x69ec >> 2] = h;
  vt(c, 0x118);
  I = m.I; b = lb(c);
  if (I[0x6358 >> 2] === 0) return SKIP;          // off the target
  I[0x67b8 >> 2] = I[(0x21a4 + b) >> 2];
  I[0x67ac >> 2] = I[(0x21a8 + b) >> 2];
  if (I[(0x2300 + b) >> 2] === 3) {
    I[(0x2300 + b) >> 2] = 2;
    if (I[0x6120 >> 2] === 0) {
      vt(c, 0x1bc);
      if (m.I[0x6120 >> 2] === 0) return FAIL;
    }
    vt(c, 0x1dc);                                 // the edge-distance map
  } else if (I[(0x2200 + b) >> 2] !== 0 && I[0x6120 >> 2] === 0) {
    vt(c, 0x1bc);
    if (m.I[0x6120 >> 2] === 0) return FAIL;
    vt(c, 0x1dc);
  }
  I = m.I; b = lb(c);
  if ((I[(0x2214 + b) >> 2] !== 0 && I[(0x2210 + b) >> 2] !== 0) || (I[(0x2200 + b) >> 2] !== 0 && I[(0x21fc + b) >> 2] !== 0) ||
      I[(0x22a4 + b) >> 2] !== 0 || I[(0x2248 + b) >> 2] > 1) vt(c, 0x1d0);
  I = m.I; b = lb(c);
  if (I[(0x212c + b) >> 2] === 3) {
    I[(0x21d4 + b) >> 2] = 0;
    x = xb(c);
    if (nz(F[(0x18fc + x) >> 2]) || nz(F[(0x1900 + x) >> 2])) { if (!fx(c, 0x188)) return FAIL; }
    I = m.I; F = m.F; b = lb(c); x = xb(c);
    const t = (o: number): boolean => nz(F[(o + x) >> 2]);
    if (((t(0x18ec) || t(0x18e8) || t(0x18e4)) && t(0x18e0)) || (I[(0x2294 + b) >> 2] !== 0 && t(0x18c8)) ||
        I[(0x2244 + b) >> 2] !== 0 || I[(0x2240 + b) >> 2] !== 0 || I[(0x223c + b) >> 2] !== 0 ||
        t(0x18ac) || t(0x18b0) || t(0x18c0) || t(0x18bc) || t(0x18b8) || t(0x18b4)) {
      if (!fx(c, 0x174)) return FAIL;
    }
    I = m.I; b = lb(c);
    if (I[(0x22b4 + b) >> 2] !== 0) { if (!fx(c, 0x168)) return FAIL; }
    I = m.I; F = m.F; b = lb(c); x = xb(c);
    const md = I[(0x2268 + b) >> 2];
    if ((((I[(0x21f8 + b) >> 2] !== 0 || I[(0x21f4 + b) >> 2] !== 0 || I[(0x21f0 + b) >> 2] !== 0) && md <= 2 && md >= 1) || md === 3) &&
        ftol(F[(0x1878 + x) >> 2]) !== 0 && I[(0x226c + b) >> 2] !== 0) {
      if (!fx(c, 0x170)) return FAIL;
    }
    I = m.I; b = lb(c);
    if (I[(0x21e4 + b) >> 2] !== 0 || I[(0x21e8 + b) >> 2] !== 0 || I[(0x21ec + b) >> 2] !== 0 || I[(0x220c + b) >> 2] !== 0 ||
        I[(0x2218 + b) >> 2] !== 0) { if (!fx(c, 0x17c)) return FAIL; }
    I = m.I; b = lb(c);
    if (I[(0x21e0 + b) >> 2] >= 2) { if (!fx(c, 0x128)) return FAIL; }
    F = m.F; x = xb(c);
    if (nz(F[(0x190c + x) >> 2]) || nz(F[(0x1910 + x) >> 2])) { if (!fx(c, 0x184)) return FAIL; }
    I = m.I; b = lb(c);
    if (I[(0x2208 + b) >> 2] !== 0) { if (!fx(c, 0x180)) return FAIL; }
    I = m.I; b = lb(c);
    const pl = I[(0x22e8 + b) >> 2];
    if (pl > 0 && pl <= I[0x6994 >> 2]) { if (!fx(c, 0x1f4)) return FAIL; }
  }
  I = m.I; b = lb(c);
  const sel = I[(0x21d4 + b) >> 2];
  if (sel === 1 || sel === 2 || sel === 3) {      // what the last effect wrote
    const buf = I[((sel === 1 ? 0x21d8 : sel === 2 ? 0x22bc : 0x21dc) + b) >> 2];
    if (buf === 0) return FAIL;
    I[0x6124 >> 2] = buf;
    if (sel === 3) I[0x68cc >> 2] = -1;
  }
  const hid = I[(0x22c0 + b) >> 2];
  if (hid === -1 || hid === 1) return FAIL;
  const sc = I[(0x2148 + b) >> 2];
  I[0x67a4 >> 2] = sc;
  if (unscaled(sc)) {
    if (I[0x6294 >> 2] === 1) {                   // clipped: cut the visible part
      I[0x62b4 >> 2] = I[0x69f0 >> 2];
      I[0x62b0 >> 2] = I[0x69ec >> 2];
      vt(c, 0x16c);
      I = m.I;
      if (I[0x62f4 >> 2] === 1) return FAIL;
      const e = I[0x6120 >> 2];
      if (I[(0x21e0 + lb(c)) >> 2] === 1 && e !== 0) {   // and of the edge map
        I[0x62b4 >> 2] = I[0x69f0 >> 2];
        I[0x62b0 >> 2] = I[0x69ec >> 2];
        I[0x66b8 >> 2] = I[0x6124 >> 2];
        I[0x6124 >> 2] = e;
        vt(c, 0x16c);
        I = m.I;
        if (I[0x62f4 >> 2] === 1) return FAIL;
        I[0x6120 >> 2] = I[0x6124 >> 2];
        I[0x6124 >> 2] = I[0x66b8 >> 2];
      }
    }
  } else if (I[0x6294 >> 2] === 0) {              // scaled, whole
    vt(c, 0x13c);
    I = m.I;
    if (I[0x62f4 >> 2] === 1) return RET;
    const e = I[0x6120 >> 2];
    if (e !== 0) {
      I[0x66b8 >> 2] = I[0x6124 >> 2];
      I[0x6124 >> 2] = e;
      vt(c, 0x13c);
      I = m.I;
      if (I[0x62f4 >> 2] === 1) return RET;
      I[0x6120 >> 2] = I[0x6124 >> 2];
      I[0x6124 >> 2] = I[0x66b8 >> 2];
    }
  } else {                                        // scaled, clipped
    clippedSize(I);
    if (I[0x648c >> 2] === 1) I[0x6738 >> 2] = I[0x69fc >> 2];
    else if (I[0x6480 >> 2] === 1) I[0x6738 >> 2] = (I[0x69fc >> 2] + I[0x61a4 >> 2] - I[0x62b0 >> 2]) | 0;
    vt(c, 0x18c);
    I = m.I;
    if (I[0x62f4 >> 2] === 1) return RET;
    const e = I[0x6120 >> 2];
    if (e !== 0) {
      clippedSize(I);
      I[0x66b8 >> 2] = I[0x6124 >> 2];
      I[0x6124 >> 2] = e;
      vt(c, 0x18c);
      I = m.I;
      if (I[0x62f4 >> 2] === 1) return RET;
      I[0x6120 >> 2] = I[0x6124 >> 2];
      I[0x6124 >> 2] = I[0x66b8 >> 2];
    }
  }
  vt(c, 0x1e0);                                   // the draw
  return FAIL;                                    // falls into the dirty := 1 tail
}
/** 0x1000934c: the visible size: projected size minus the clipped columns / rows */
function clippedSize(I: Int32Array): void {
  I[0x62b4 >> 2] = (I[0x69f0 >> 2] - I[0x6260 >> 2] - I[0x6254 >> 2]) | 0;
  I[0x62b0 >> 2] = (I[0x69ec >> 2] - I[0x626c >> 2] - I[0x6244 >> 2]) | 0;
}

/** E+0x1a4 0x100094b0: next work buffer: 0x6124 = what the last effect wrote, 0x60fc = where the next one
 *  writes (the layer's two buffers 0x21d8 / 0x22bc, allocated on first use); 0x21d4 = which. 0 = none. */
export function swapBuffers(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  const sel = I[(0x21d4 + b) >> 2];
  if (sel === 0 || sel === 2) {
    I[0x6124 >> 2] = I[((sel === 0 ? 0x2144 : 0x22bc) + b) >> 2];
    if (I[(0x21d8 + b) >> 2] === 0) {
      vt(c, 0x1b8);
      if (m.I[0x60fc >> 2] === 0) return 0;
    }
    I = m.I; b = lb(c);
    I[0x60fc >> 2] = I[(0x21d8 + b) >> 2];
    I[(0x21d4 + b) >> 2] = 1;
    return 1;
  }
  if (sel === 1) {
    I[0x6124 >> 2] = I[(0x21d8 + b) >> 2];
    if (I[(0x22bc + b) >> 2] === 0) {
      vt(c, 0x1b4);
      if (m.I[0x60fc >> 2] === 0) return 0;
    }
    I = m.I; b = lb(c);
    I[0x60fc >> 2] = I[(0x22bc + b) >> 2];
    I[(0x21d4 + b) >> 2] = 2;
    return 1;
  }
  return 0;
}

/** a layer-sized buffer (w*h*4 + 8, from malloc) into 0x60fc and the layer field off */
function allocLayerBuf(c: Core, off: number): number {
  const m = c.m;
  let I = m.I;
  const b = lb(c);
  const p = m.malloc((Math.imul(I[(0x21a8 + b) >> 2], I[(0x21a4 + b) >> 2]) << 2) + 8);
  I = m.I;
  I[0x60fc >> 2] = p;
  if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  I[(off + lb(c)) >> 2] = p;
  return 0;
}
/** E+0x1b8 0x10009ce0: the layer's first work buffer (0x21d8) */
export function allocWork1(c: Core): number { return allocLayerBuf(c, 0x21d8); }
/** E+0x1b4 0x10009d50: the layer's second work buffer (0x22bc) */
export function allocWork2(c: Core): number { return allocLayerBuf(c, 0x22bc); }

/** E+0x1bc 0x10009c20: the layer's edge-distance buffer (0x21dc = 0x6120), cleared */
export function allocEdge(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  const p = m.malloc((Math.imul(I[(0x21a8 + b) >> 2], I[(0x21a4 + b) >> 2]) << 2) + 8);
  I = m.I;
  I[0x6120 >> 2] = p;
  if (p === 0) { I[0x62f4 >> 2] = 1; return 0; }
  b = lb(c);
  I[(0x21dc + b) >> 2] = p;
  const n = Math.imul(I[(0x21a8 + b) >> 2], I[(0x21a4 + b) >> 2]);
  I[0x69a0 >> 2] = n;
  m.U.fill(0, p >> 2, (p >> 2) + (n >>> 0));
  return 0;
}

const SLOTS = [[0x67b4, 0x664c, 0x67b0], [0x6654, 0x6658, 0x6650], [0x6698, 0x669c, 0x6694], [0x66b0, 0x66b4, 0x66ac]];

/** E+0x1c0 0x10009a00: the first free one of four scratch buffers (in-use flag, capacity, pointer), grown to
 *  0x62b0 * 0x62b4 * 4 when smaller, into 0x6454. All four in use: nothing. */
export function scratch(c: Core): number {
  const m = c.m;
  let I = m.I;
  for (const [f, cap, ptr] of SLOTS) {
    if (I[f >> 2] !== 0) continue;
    const need = Math.imul(I[0x62b0 >> 2], I[0x62b4 >> 2]) << 2;
    if (I[cap >> 2] < need) {
      if (I[ptr >> 2] !== 0) m.release(I[ptr >> 2]);
      I[cap >> 2] = need;
      const q = m.malloc(need);
      I = m.I;
      I[ptr >> 2] = q;
    }
    const p = I[ptr >> 2];
    if (p === 0) { I[0x6454 >> 2] = 0; I[0x62f4 >> 2] = 1; return 0; }
    I[0x6454 >> 2] = p;
    I[f >> 2] = 1;
    return 0;
  }
  return 0;
}

/** E+0x238 0x10009dc0: free the scratch slot whose buffer is 0x6478 */
export function scratchRelease(c: Core): number {
  const I = c.m.I, v = I[0x6478 >> 2];
  for (const [f, , ptr] of SLOTS) if (v === I[ptr >> 2]) { I[f >> 2] = 0; break; }
  return 0;
}

/** E+0x118 0x10009670: clip the sprite rect (0x6730, 0x6738, 0x62b4 x 0x62b0) to the target rect (0x69e8,
 *  0x69fc, 0x61a8 x 0x61a4), unsigned as the asm compares. 0x6358 = visible, 0x6294 = clipped; cut columns
 *  0x6254 (left) / 0x6260 (right), rows 0x626c (top) / 0x6244 (bottom), each with its flag. */
export function clipRect(c: Core): number {
  const I = c.m.I;
  const ch = I[0x62b0 >> 2];
  for (const o of [0x6358, 0x6294, 0x6484, 0x6488, 0x648c, 0x6480, 0x626c, 0x6244, 0x6260, 0x6254]) I[o >> 2] = 0;
  I[0x672c >> 2] = I[0x62b4 >> 2];
  I[0x6718 >> 2] = ch;
  const u = (o: number): number => I[o >> 2] >>> 0;
  const x = u(0x6730);
  if (x >= 0x80000000) {
    I[0x6730 >> 2] = 0;
    I[0x672c >> 2] = (x + I[0x62b4 >> 2]) | 0;
    I[0x6254 >> 2] = -x | 0;
    I[0x6484 >> 2] = 1;
    if (I[0x69e8 >> 2] === 0) I[0x6294 >> 2] = 1;
  }
  const y = u(0x6738);
  if (y >= 0x80000000) {
    I[0x6738 >> 2] = 0;
    I[0x6718 >> 2] = (y + I[0x62b0 >> 2]) | 0;
    I[0x626c >> 2] = -y | 0;
    I[0x648c >> 2] = 1;
    if (I[0x69fc >> 2] === 0) I[0x6294 >> 2] = 1;
  }
  const tx = u(0x69e8), ty = u(0x69fc);
  if (u(0x6730) >= ((tx + I[0x61a8 >> 2]) >>> 0)) return 0;
  if (((u(0x6730) + I[0x672c >> 2]) >>> 0) <= tx) return 0;
  if (u(0x6738) >= ((ty + I[0x61a4 >> 2]) >>> 0)) return 0;
  if (((u(0x6738) + I[0x6718 >> 2]) >>> 0) <= ty) return 0;
  I[0x6358 >> 2] = 1;
  const r = (tx + I[0x61a8 >> 2]) >>> 0, sx = u(0x6730), e = (sx + I[0x672c >> 2]) >>> 0;
  if (r < e) { I[0x6260 >> 2] = (e - r) | 0; I[0x6488 >> 2] = 1; I[0x6294 >> 2] = 1; }
  if (tx > sx) {
    I[0x6730 >> 2] = I[0x69e8 >> 2];
    I[0x6254 >> 2] = (I[0x6254 >> 2] + (tx - sx)) | 0;
    I[0x6484 >> 2] = 1;
    I[0x6294 >> 2] = 1;
  }
  const bt = (ty + I[0x61a4 >> 2]) >>> 0, ey = (u(0x6738) + I[0x6718 >> 2]) >>> 0;
  if (bt < ey) { I[0x6244 >> 2] = (ey - bt) | 0; I[0x6480 >> 2] = 1; I[0x6294 >> 2] = 1; }
  const sy = u(0x6738);
  if (sy < ty) {
    I[0x626c >> 2] = (I[0x626c >> 2] + (ty - sy)) | 0;
    I[0x648c >> 2] = 1;
    I[0x6294 >> 2] = 1;
  }
  return 0;
}

/** E+0x16c 0x100098a0: the unscaled clipped sprite: drop the cut rows (top: move to the target's top;
 *  bottom: the sprite is stored bottom-up, so skip that many rows of 0x6124), then, when columns were cut,
 *  copy the visible columns into a scratch buffer, which becomes 0x6124. */
export function clipCopy(c: Core): number {
  const m = c.m;
  let I = m.I;
  if (I[0x648c >> 2] === 1) {
    I[0x6738 >> 2] = I[0x69fc >> 2];
    I[0x62b0 >> 2] = (I[0x62b0 >> 2] - I[0x626c >> 2]) | 0;
  }
  if (I[0x6480 >> 2] === 1) {
    const cut = I[0x6244 >> 2];
    I[0x62b0 >> 2] = (I[0x62b0 >> 2] - cut) | 0;
    I[0x6738 >> 2] = (I[0x69fc >> 2] + I[0x61a4 >> 2] - I[0x62b0 >> 2]) | 0;
    I[0x6124 >> 2] = (I[0x6124 >> 2] + (Math.imul(I[0x62b4 >> 2], cut) << 2)) | 0;
  }
  if (I[0x6488 >> 2] !== 1 && I[0x6484 >> 2] !== 1) return 0;
  I[0x647c >> 2] = I[0x62b4 >> 2];
  I[0x62b4 >> 2] = (I[0x62b4 >> 2] - I[0x6260 >> 2] - I[0x6254 >> 2]) | 0;
  vt(c, 0x1c0);
  I = m.I;
  if (I[0x62f4 >> 2] === 1) return 0;
  I[0x6258 >> 2] = I[0x6254 >> 2] << 2;
  const U = m.U, w = I[0x62b4 >> 2], left = I[0x6254 >> 2], right = I[0x6260 >> 2];
  let s = I[0x6124 >> 2] >> 2, d = I[0x6454 >> 2] >> 2;
  for (let r = I[0x62b0 >> 2]; ; ) {
    s += left;
    U.copyWithin(d, s, s + w);
    s += w; d += w;
    s += right;
    if (--r === 0) break;
  }
  I[0x6478 >> 2] = I[0x6124 >> 2];
  I[0x6124 >> 2] = I[0x6454 >> 2];
  vt(c, 0x238);
  return 0;
}

// ---------------------------------------------------------------- sprite scalers

/** E+0x13c 0x10013980: scale the sprite 0x6124 (0x6494 x 0x6490) by 0x67a4 into a scratch buffer (0x62b4
 *  wide), which becomes 0x6124 */
export function scaleSprite(c: Core): number { return scaleSpriteVia(c, 0x294); }
/** E+0x18c 0x100138c0: the same, emitting only the visible part (rows past 0x6244, columns past 0x6254,
 *  0x62b4 x 0x62b0 of them) */
export function scaleSpriteClipped(c: Core): number { return scaleSpriteVia(c, 0x288); }
function scaleSpriteVia(c: Core, base: number): number {
  const m = c.m;
  if (unscaled(m.I[0x67a4 >> 2])) return 0;
  vt(c, 0x1c0);
  const I = m.I;
  if (I[0x62f4 >> 2] === 1) return 0;
  const v = I[0x67a4 >> 2];
  if (v <= 0xff) vt(c, base);
  else if (v <= 0x200) vt(c, base + 4);
  else {
    if (v > 0x300) I[0x67a4 >> 2] = 0x300;
    vt(c, base + 8);
  }
  const J = m.I;
  J[0x6478 >> 2] = J[0x6124 >> 2];
  J[0x6124 >> 2] = J[0x6454 >> 2];
  vt(c, 0x238);
  return 0;
}

/** 0x10013f00 / 0x10013f90 / 0x10014030 (f = 0 / 1 / 2): the whole sprite, one step for both axes */
function ddaSprite(c: Core, f: number): number {
  const I = c.m.I;
  I[0x662c >> 2] = 0;
  if (f === 0) I[0x6498 >> 2] = I[0x6494 >> 2] << 2;
  I[0x6718 >> 2] = I[0x6490 >> 2];
  const st = stepOf(I, f);
  ddaRows(c, f, f, st, st, 0x62b4, 0);
  return 0;
}

/** 0x100140f0 / 0x100141d0 / 0x10014360 (f = 0 / 1 / 2): the same scale, emitting only output rows past
 *  0x6750 (= 0x6244) and columns past 0x6254, 0x62b4 x 0x62b0 of them. Source rows seen 0x6390, rows
 *  emitted 0x6288, row accumulator 0x662c. */
function ddaClipped(c: Core, f: number): number {
  const I = c.m.I, U = c.m.U;
  I[0x6288 >> 2] = 0;
  I[0x6390 >> 2] = 0;
  I[0x662c >> 2] = 0;
  I[0x6750 >> 2] = I[0x6244 >> 2];
  if (f === 0) I[0x6498 >> 2] = I[0x6494 >> 2] << 2;
  if (f === 2) I[0x6718 >> 2] = I[0x6490 >> 2];
  const step = stepOf(I, f), srcW = I[0x6494 >> 2], skipRows = I[0x6750 >> 2] >>> 0, outRows = I[0x62b0 >> 2] >>> 0;
  const skipCols = I[0x6254 >> 2] >>> 0, outW = I[0x62b4 >> 2], rowSkip = I[0x6498 >> 2] >> 2;
  let si = I[0x6124 >> 2] >> 2, di = I[0x6454 >> 2] >> 2, seen = 0, emitted = 0, accY = 0;
  // one output row from source row s, the first skipCols output columns dropped (0x1001416e / 0x1001423d /
  // 0x100143e7, label for label)
  const emit = (s: number): void => {
    let ebx = 0, eax = skipCols, ecx = outW, px = 0, t: number;
    if (f === 0) {
      if (eax !== 0) {
        for (;;) {
          s++;
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) continue;
          if (--eax === 0) break;
        }
      }
      for (;;) {
        U[di++] = U[s];
        if (--ecx === 0) return;
        for (;;) { s++; t = ebx + step; ebx = t >= M32 ? t - M32 : t; if (t < M32) break; }
      }
    }
    let st = 0;                                   // 0: load + store (A), 1: store again (B), 2: step (C)
    if (eax !== 0) {
      if (f === 1) {
        for (;;) {
          if (--eax === 0) { px = U[s]; s++; st = 2; break; }
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) { s++; continue; }
          if (--eax !== 0) { s++; continue; }
          s++; st = 0; break;
        }
      } else {
        for (;;) {
          if (--eax === 0) { px = U[s]; st = 1; break; }
          if (--eax === 0) { px = U[s]; st = 2; break; }
          s++;
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) continue;
          if (--eax === 0) { st = 0; break; }
        }
      }
    }
    if (f === 1) {
      for (;;) {
        if (st === 0) { px = U[s]; U[di++] = px; s++; if (--ecx === 0) return; }
        t = ebx + step; ebx = t >= M32 ? t - M32 : t;
        st = 0;
        if (t >= M32) continue;
        U[di++] = px;
        if (--ecx === 0) return;
      }
    }
    for (;;) {
      if (st === 0) { px = U[s]; U[di++] = px; if (--ecx === 0) return; st = 1; }
      if (st === 1) { U[di++] = px; if (--ecx === 0) return; }
      s++;
      t = ebx + step; ebx = t >= M32 ? t - M32 : t;
      st = 0;
      if (t >= M32) continue;
      U[di++] = px;
      if (--ecx === 0) return;
    }
  };
  const dup = (): void => { U.copyWithin(di, di - outW, di); di += outW; };
  const nextAcc = (): boolean => { accY += step; if (accY >= M32) { accY -= M32; return true; } return false; };
  if (f === 0) {
    for (;;) {
      seen++;
      if (!(skipRows >= seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      while (nextAcc()) si += rowSkip;
    }
  } else if (f === 1) {
    for (;;) {
      if (!(skipRows > seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      seen++;
      if (nextAcc()) continue;
      seen++;
      if (skipRows >= seen) continue;
      if (outRows <= emitted) break;
      emitted++;
      if (emitted === 1) emit(si - srcW); else dup();
    }
  } else {
    let done = false;
    const extra = (): void => {                   // 0x10014462 / 0x10014543: a repeated output row
      if (outRows <= emitted) { done = true; return; }
      emitted++;
      if (emitted === 1) emit(si - srcW); else dup();
    };
    for (;;) {
      if (!(skipRows > seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      seen += 2;
      if (!(skipRows >= seen)) { extra(); if (done) break; }
      if (nextAcc()) continue;
      seen++;
      if (skipRows >= seen) continue;
      extra();
      if (done) break;
    }
  }
  I[0x6288 >> 2] = emitted;
  I[0x6390 >> 2] = seen;
  I[0x662c >> 2] = accY | 0;
  return 0;
}

/** E+0x1f4 0x10013500: the layer through a palette: each pixel (except the key 0x68cc) := entry (its alpha
 *  byte) of layer 0x22e8's image (or its current work buffer), alpha kept; 0x6124 -> 0x60fc. */
export function paletteFromLayer(c: Core): number {
  const I = c.m.I, U = c.m.U, b = lb(c);
  const n = Math.imul(I[(0x21a8 + b) >> 2], I[(0x21a4 + b) >> 2]);
  I[0x69a0 >> 2] = n;
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x614c >> 2] = I[0x6124 >> 2];
  const k = I[(0x22e8 + b) >> 2], kb = k * 0x1ec;
  I[0x6728 >> 2] = k;
  I[0x6154 >> 2] = I[(0x2144 + kb) >> 2];
  if (I[(0x21d4 + kb) >> 2] === 1) I[0x6154 >> 2] = I[(0x21d8 + kb) >> 2];
  if (I[(0x21d4 + kb) >> 2] === 2) I[0x6154 >> 2] = I[(0x22bc + kb) >> 2];
  if (I[0x6154 >> 2] === 0) return 0;
  const pal = I[0x6154 >> 2] >> 2;
  const key = I[0x68cc >> 2], d = I[0x6118 >> 2] >> 2, s = I[0x614c >> 2] >> 2, nn = n >>> 0;
  for (let i = 0; i < nn; i++) {
    const v = U[s + i];
    if ((v & 0xffffff) !== key) U[d + i] = (U[pal + (v >>> 24)] | (v & 0xff000000)) >>> 0;
  }
  I[0x614c >> 2] = (I[0x614c >> 2] + (n << 2)) | 0;
  return 0;
}

// ---------------------------------------------------------------- the dirty-rectangle path

/** E+0x274 0x10015320: 0x6214 := the first state-2 layer whose old rect is pending (0x2154 == 2); 1 = found */
export function findMovedLayer(c: Core): number { return findLayer(c, 0x2154, true); }
/** E+0x270 0x10015380: 0x6214 := the first state-2 layer that is dirty (0x212c >= 2); 1 = found */
export function findDirtyLayer(c: Core): number { return findLayer(c, 0x212c, false); }
function findLayer(c: Core, f: number, eq: boolean): number {
  const I = c.m.I;
  I[0x6214 >> 2] = 0;
  let k = 0;
  do {
    const b = k * 0x1ec, v = I[(f + b) >> 2];
    if ((eq ? v === 2 : v >= 2) && I[(0x211c + b) >> 2] === 2) return 1;
    k = (k + 1) | 0;
    I[0x6214 >> 2] = k;
  } while ((k >>> 0) < (I[0x63c4 >> 2] >>> 0));
  return 0;
}

/** E+0x120 0x10014ec0: the next old rect to redraw (0x62d4 = 1: none): a moved layer's saved rect (0x2158,
 *  0x215c, 0x216c x 0x2170, clamped to >= 0), merged with every rect it touches, dword-aligned. */
export function nextOldRect(c: Core): number {
  if (vt(c, 0x274) === 0) { c.m.I[0x62d4 >> 2] = 1; return 0; }
  const I = c.m.I, b = lb(c);
  I[0x62d4 >> 2] = 0;
  I[(0x2154 + b) >> 2] = 1;
  rectFrom(I, b, 0x2158, 0x215c, 0x216c, 0x2170);
  vt(c, 0x27c);
  vt(c, 0x278);
  vt(c, 0x114);
  return 0;
}
/** E+0x11c 0x10014f90: the next new rect to draw (0x62d0 = 1: none): a dirty layer's rect, merged, aligned */
export function nextNewRect(c: Core): number {
  if (vt(c, 0x270) === 0) { c.m.I[0x62d0 >> 2] = 1; return 0; }
  const I = c.m.I, b = lb(c);
  I[0x62d0 >> 2] = 0;
  rectFrom(I, b, 0x2130, 0x2134, 0x214c, 0x2150);
  vt(c, 0x278);
  vt(c, 0x114);
  return 0;
}
function rectFrom(I: Int32Array, b: number, fx: number, fy: number, fw: number, fh: number): void {
  I[0x69e8 >> 2] = I[(fx + b) >> 2];
  I[0x69fc >> 2] = I[(fy + b) >> 2];
  if (I[0x69e8 >> 2] < 0) I[0x69e8 >> 2] = 0;
  if (I[0x69fc >> 2] < 0) I[0x69fc >> 2] = 0;
  I[0x61a8 >> 2] = I[(fw + b) >> 2];
  I[0x61a4 >> 2] = I[(fh + b) >> 2];
}

/** E+0x27c 0x10015040: grow the rect over every pending old rect it overlaps (each found visible is marked
 *  done, 0x2154 := 1); a growth restarts the scan. */
export function mergeOldRects(c: Core): number { return mergeRects(c, true); }
/** E+0x278 0x10015140: grow the rect over every dirty layer's rect it partly overlaps; a growth restarts. */
export function mergeNewRects(c: Core): number { return mergeRects(c, false); }
function mergeRects(c: Core, old: boolean): number {
  const m = c.m;
  m.I[0x6214 >> 2] = 0;
  for (;;) {
    const I = m.I, b = lb(c);
    if ((old ? I[(0x2154 + b) >> 2] === 2 : I[(0x212c + b) >> 2] >= 2) && I[(0x211c + b) >> 2] === 2) {
      I[0x6730 >> 2] = I[((old ? 0x2158 : 0x2130) + b) >> 2];
      I[0x6738 >> 2] = I[((old ? 0x215c : 0x2134) + b) >> 2];
      if (old) {
        I[0x62b4 >> 2] = I[(0x216c + b) >> 2];
        I[0x62b0 >> 2] = I[(0x2170 + b) >> 2];
      }
      if (I[0x6730 >> 2] < 0) I[0x6730 >> 2] = 0;
      if (I[0x6738 >> 2] < 0) I[0x6738 >> 2] = 0;
      if (!old) {
        I[0x62b4 >> 2] = I[(0x214c + b) >> 2];
        I[0x62b0 >> 2] = I[(0x2150 + b) >> 2];
      }
      vt(c, 0x118);
      const J = m.I;
      if (old && J[0x6358 >> 2] === 1) J[(0x2154 + lb(c)) >> 2] = 1;
      if (J[0x6294 >> 2] === 1) {
        vt(c, 0x1a0);
        m.I[0x6214 >> 2] = 0;
        continue;
      }
    }
    const J = m.I;
    J[0x6214 >> 2] = (J[0x6214 >> 2] + 1) | 0;
    if ((J[0x6214 >> 2] >>> 0) >= (J[0x63c4 >> 2] >>> 0)) return 0;
  }
}

/** E+0x1a0 0x10015210: grow the rect (0x69e8, 0x69fc, 0x61a8 x 0x61a4) by what clipRect cut off, origin
 *  clamped to >= 0 */
export function growRect(c: Core): number {
  const I = c.m.I;
  if (I[0x648c >> 2] === 1) {
    I[0x69fc >> 2] = (I[0x69fc >> 2] - I[0x626c >> 2]) | 0;
    I[0x61a4 >> 2] = (I[0x61a4 >> 2] + I[0x626c >> 2]) | 0;
  }
  if (I[0x6480 >> 2] === 1) I[0x61a4 >> 2] = (I[0x61a4 >> 2] + I[0x6244 >> 2]) | 0;
  if (I[0x6488 >> 2] === 1) I[0x61a8 >> 2] = (I[0x61a8 >> 2] + I[0x6260 >> 2]) | 0;
  if (I[0x6484 >> 2] === 1) {
    I[0x69e8 >> 2] = (I[0x69e8 >> 2] - I[0x6254 >> 2]) | 0;
    I[0x61a8 >> 2] = (I[0x61a8 >> 2] + I[0x6254 >> 2]) | 0;
  }
  if (I[0x69e8 >> 2] < 0) I[0x69e8 >> 2] = 0;
  if (I[0x69fc >> 2] < 0) I[0x69fc >> 2] = 0;
  return 0;
}

/** E+0x114 0x100152d0: the rect's width up to a multiple of 4 (moved left when that passes the canvas) */
export function alignRect(c: Core): number {
  const I = c.m.I, r = I[0x61a8 >> 2] & 3;
  if (r !== 0) {
    const p = 4 - r;
    I[0x61a8 >> 2] = (I[0x61a8 >> 2] + p) | 0;
    if (((I[0x69e8 >> 2] + I[0x61a8 >> 2]) >>> 0) > (I[0x6590 >> 2] >>> 0)) I[0x69e8 >> 2] = (I[0x69e8 >> 2] - p) | 0;
  }
  return 0;
}

/** E+0x1d8 0x100153e0: the rect's part of the canvas into the draw target 0x6100 (0x60f0 != 0: its first and
 *  last column white) */
export function copyRect(c: Core): number {
  const I = c.m.I, U = c.m.U;
  const cw = I[0x6590 >> 2], w = I[0x61a8 >> 2], x0 = I[0x69e8 >> 2];
  I[0x62b0 >> 2] = I[0x6598 >> 2];
  I[0x62b4 >> 2] = cw;
  I[0x6260 >> 2] = (cw - w - x0) | 0;
  I[0x6730 >> 2] = 0;
  I[0x6738 >> 2] = 0;
  I[0x6124 >> 2] = (I[0x63e4 >> 2] + ((Math.imul(I[0x69fc >> 2], cw) + x0) << 2)) | 0;
  const border = I[0x60f0 >> 2] !== 0, stride = I[0x6594 >> 2] >> 2;
  let s = I[0x6124 >> 2] >> 2, d = I[0x6100 >> 2] >> 2;
  for (let r = I[0x61a4 >> 2]; ; ) {
    if (!border) U.copyWithin(d, s, s + w);
    else {
      U[d] = 0xffffff;
      if (w !== 1) { U.copyWithin(d + 1, s + 1, s + w); U[d + w - 1] = 0xffffff; }
    }
    d += w;
    s += stride;
    if (--r === 0) break;
  }
  return 0;
}

def({
  0x14c: frame,
  0x19c: blit,
  0x15c: toDisplayDepth,
  0x240: scaleToWindow,
  0x198: double2x,
  0x220: rowPad,
  0x248: scaleRows,
  0x140: scaleDims,
  0x144: scaleLen,
  0x2a0: (c: Core) => dimsAt(c, 0),
  0x2a8: (c: Core) => dimsAt(c, 1),
  0x2b0: (c: Core) => dimsAt(c, 2),
  0x2a4: (c: Core) => lenAt(c, 0),
  0x2ac: (c: Core) => lenAt(c, 1),
  0x2b4: (c: Core) => lenAt(c, 2),
  0x2c4: placeLayers,
  0x230: project,
  0x234: projectPos,
  0x1cc: scaleSize,
  0x12c: clipLayers,
  0x130: clipLayer,
  0x1f0: drawLayers,
  0x1fc: drawDirtyLayers,
  0x2e4: sortLayers,
  0x2e8: sortDirtyLayers,
  0x268: nextDepth,
  0x210: collectDepth,
  0x21c: renderLayer,
  0x1a4: swapBuffers,
  0x1b8: allocWork1,
  0x1b4: allocWork2,
  0x1bc: allocEdge,
  0x1c0: scratch,
  0x238: scratchRelease,
  0x118: clipRect,
  0x16c: clipCopy,
  0x13c: scaleSprite,
  0x18c: scaleSpriteClipped,
  0x294: (c: Core) => ddaSprite(c, 0),
  0x298: (c: Core) => ddaSprite(c, 1),
  0x29c: (c: Core) => ddaSprite(c, 2),
  0x288: (c: Core) => ddaClipped(c, 0),
  0x28c: (c: Core) => ddaClipped(c, 1),
  0x290: (c: Core) => ddaClipped(c, 2),
  0x1f4: paletteFromLayer,
  0x274: findMovedLayer,
  0x270: findDirtyLayer,
  0x120: nextOldRect,
  0x11c: nextNewRect,
  0x27c: mergeOldRects,
  0x278: mergeNewRects,
  0x1a0: growRect,
  0x114: alignRect,
  0x1d8: copyRect,
});
