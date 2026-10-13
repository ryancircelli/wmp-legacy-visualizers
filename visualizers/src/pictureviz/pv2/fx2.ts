// PictureViz_II per-layer distortion kernels: the forward warp and the per-pixel coordinate kernels it
// dispatches to (stretch, shear, sine ripple, lens, tile/mirror, swirl), the spotlight, the blur, the melt
// (with its spiral search), the scroll, the mask and the taper. All are called through the engine vtable from
// the per-layer renderer (0x100089e0). Their ancestors are Musical Colors' warp / wave / swirl / melt /
// spiral / shift (musical/core.ts); the offsets and many details differ, so everything here is transliterated
// from the PV2 asm.
//
// Shared per-pixel state (the DLL's, in the object): 0x652c / 0x6530 = the pixel's offset from the warp
// centre (floats, the kernels' input and output), 0x614c = source pointer, 0x6118 = target pointer,
// 0x634c = pixel index, 0x6708 = the pixel, 0x68cc = the colour key. The float tables: cos of whole degrees
// at obj+0x5550, sin at obj+0x5af0 (right after it, so cos[360 - a] = F[0x16bc - a]).
//
// x87 compares: C0 = less or unordered, C3 = equal or unordered. `!(a >= b)` is TEST AH,0x1;
// `!(a > b)` is TEST AH,0x41; `!(a < b || a > b)` is TEST AH,0x40 (so NaN behaves as on the FPU).
// Only spiralMap allocates; everything else caches the heap views for the whole call.
import { type Core, lb, xb } from './core';
import { ftol, fr } from './mem';
import { def } from './vt';

const COS = 0x5550 >> 2;          // cos table, F[COS + degree]
const COS360 = 0x5af0 >> 2;       // F[COS360 - a] = cos[360 - a] = cos(a); a = 0 reads sin(0) = 0
const SIN360 = 0x6090 >> 2;       // F[SIN360 - a] = sin[360 - a] = sin(-a)
const K001 = 0.0010000000474974513;   // (float)0.001 at 0x10032480
const K01 = 0.009999999776482582;     // (float)0.01 at 0x10032478 / 0x100324a4
const K1E4 = 9.999999747378752e-05;   // (float)0.0001 at 0x10032474
const K1 = 0.10000000149011612;       // (float)0.1 at 0x10032470

function bswap(x: number): number {
  return ((x & 0xff) << 24 | (x & 0xff00) << 8 | (x >>> 8) & 0xff00 | x >>> 24) | 0;
}
/** ADD with the carry saturating the top byte (ADD; JNC; OR 0xff000000) */
function addSat(a: number, b: number): number {
  const s = (a >>> 0) + (b >>> 0);
  return s > 0xffffffff ? (s | 0) | 0xff000000 : s | 0;
}
/** a nonzero float as TEST AH,0x40 sees it (NaN counts as zero) */
function nz(v: number): boolean { return v < 0 || v > 0; }
/** an angle as the kernels fold it: |a|, then mod 360 (unsigned) when above 359 */
function fold(a: number): number {
  if (a < 0) a = -a | 0;
  return a > 0x167 ? ((a >>> 0) % 0x168) | 0 : a;
}

/** E+0x174 0x1000e750: the per-pixel forward warp. Fills the target with the key (0x68cc, or 0x65e4 when
 *  that is -1), derives every kernel's parameters from the transform (many scaled by cos of one of its two
 *  spin angles 0x18d0 / 0x18d8, picked per parameter by a layer selector = 1 or 2), then moves each opaque
 *  pixel by its offset from the centre (0x2230 / 0x2234 shift it) through the enabled kernels and lands it
 *  at the truncated result. Three loops: swirl only, ripple + swirl, or the full chain (which keeps the
 *  first pixel landing on each target spot unless the tile kernel cleared 0x62f0). */
export function warp(c: Core): number {
  const m = c.m, I = m.I, F = m.F, B = m.B, L = lb(c), X = xb(c);
  const w0 = I[(0x21a4 + L) >> 2], n = Math.imul(I[(0x21a8 + L) >> 2], w0);
  I[0x69a0 >> 2] = n;
  I[0x611c >> 2] = (I[0x60fc >> 2] + (n << 2)) | 0;
  var fill = I[0x68cc >> 2];
  if (fill === -1) fill = I[0x65e4 >> 2];
  I[0x694c >> 2] = fill;
  var d0 = I[0x60fc >> 2] >> 2;
  if (n > 0) I.fill(fill, d0, d0 + n);           // LOOP: n = 0 would run 2^32 times in the DLL
  const A1 = (0x18d0 + X) >> 2, A2 = (0x18d8 + X) >> 2;
  const t = (o: number): number => F[(o + X) >> 2];
  const cosA = (a: number): number => F[COS + ftol(F[a])];
  const sel = (o: number): number => I[(o + L) >> 2];
  I[0x6844 >> 2] = sel(0x2230);
  I[0x6848 >> 2] = sel(0x2234);
  if (sel(0x22f8) === 1) {
    I[0x6844 >> 2] = ftol(I[0x6844 >> 2] * cosA(A1));
    I[0x6848 >> 2] = ftol(I[0x6848 >> 2] * cosA(A1));
  }
  if (sel(0x22f8) === 2) {
    I[0x6844 >> 2] = ftol(I[0x6844 >> 2] * cosA(A2));
    I[0x6848 >> 2] = ftol(I[0x6848 >> 2] * cosA(A2));
  }
  I[0x61e0 >> 2] = (((I[(0x21a4 + L) >> 2] / 2) | 0) + I[0x6844 >> 2]) | 0;
  I[0x61e8 >> 2] = (((I[(0x21a8 + L) >> 2] / 2) | 0) + I[0x6848 >> 2]) | 0;
  I[0x689c >> 2] = I[(0x21a4 + L) >> 2];
  I[0x614c >> 2] = I[0x6124 >> 2];
  // shear (0x2c8): 0x68d4 / 0x68d8 from 0x18ac / 0x18b0, each with its own angle selector
  if (nz(t(0x18ac)) || nz(t(0x18b0))) {
    I[0x68d4 >> 2] = I[(0x18ac + X) >> 2];
    I[0x68d8 >> 2] = I[(0x18b0 + X) >> 2];
    F[0x68d0 >> 2] = t(0x18c4) * K001;
    if (sel(0x2278) === 1) F[0x68d4 >> 2] = cosA(A1) * F[0x68d4 >> 2];
    if (sel(0x2278) === 2) F[0x68d4 >> 2] = cosA(A2) * F[0x68d4 >> 2];
    if (sel(0x22e4) === 1) F[0x68d8 >> 2] = cosA(A1) * F[0x68d8 >> 2];
    if (sel(0x22e4) === 2) F[0x68d8 >> 2] = cosA(A2) * F[0x68d8 >> 2];
  }
  // stretch (0x2cc)
  if (nz(t(0x18b8)) || nz(t(0x18b4))) {
    I[0x6904 >> 2] = I[(0x18b4 + X) >> 2];
    I[0x6918 >> 2] = I[(0x18b8 + X) >> 2];
    F[0x6908 >> 2] = t(0x18c4) * K001;
    if (sel(0x227c) === 1) { F[0x6904 >> 2] = cosA(A1) * F[0x6904 >> 2]; F[0x6918 >> 2] = cosA(A1) * F[0x6918 >> 2]; }
    if (sel(0x227c) === 2) { F[0x6904 >> 2] = cosA(A2) * F[0x6904 >> 2]; F[0x6918 >> 2] = cosA(A2) * F[0x6918 >> 2]; }
  }
  // sine ripple (0x2d4): phases 0x67e4 / 0x67e8 are the spin angles themselves
  if (nz(t(0x18bc)) || nz(t(0x18c0))) {
    I[0x695c >> 2] = I[(0x18bc + X) >> 2];
    I[0x6960 >> 2] = I[(0x18c0 + X) >> 2];
    F[0x6958 >> 2] = t(0x18c4) * K001;
    I[0x67e4 >> 2] = 0;
    I[0x67e8 >> 2] = 0;
    if (sel(0x2284) === 1) I[0x67e4 >> 2] = I[A1];
    if (sel(0x2284) === 2) I[0x67e4 >> 2] = I[A2];
    if (sel(0x2288) === 1) I[0x67e8 >> 2] = I[A1];
    if (sel(0x2288) === 2) I[0x67e8 >> 2] = I[A2];
  }
  // lens (0x2d0): radius^2 and 90 / radius^2 (from the unrounded double)
  var d8 = t(0x18c8), dd = d8 * d8;
  dd = dd + dd;
  F[0x65d8 >> 2] = dd;
  F[0x65d4 >> 2] = 90 / dd;
  var e = I[(0x2294 + L) >> 2] * K01;
  F[0x68f8 >> 2] = e;
  if (sel(0x225c) === 1) F[0x68f8 >> 2] = e * cosA(A1);
  if (sel(0x225c) === 2) F[0x68f8 >> 2] = cosA(A2) * F[0x68f8 >> 2];
  // tile (0x2dc)
  var f0 = t(0x18e0), ff = f0 * f0;
  F[0x65e0 >> 2] = ff + ff;
  F[0x690c >> 2] = t(0x18f0) * K1E4;
  F[0x6910 >> 2] = t(0x18f4) * K1E4;
  F[0x6914 >> 2] = t(0x18f8) * K1E4;
  I[0x64d8 >> 2] = I[(0x18e4 + X) >> 2];
  I[0x64dc >> 2] = I[(0x18e8 + X) >> 2];
  I[0x64e0 >> 2] = I[(0x18ec + X) >> 2];
  F[0x683c >> 2] = 1;
  F[0x6678 >> 2] = 1;
  if (sel(0x229c) === 1) I[0x683c >> 2] = I[COS + ftol(F[A1])];
  if (sel(0x229c) === 2) I[0x683c >> 2] = I[COS + ftol(F[A2])];
  if (sel(0x22a0) === 1) I[0x6678 >> 2] = I[COS + ftol(F[A1])];
  if (sel(0x22a0) === 2) I[0x6678 >> 2] = I[COS + ftol(F[A2])];
  if (!(F[0x683c >> 2] >= 0)) F[0x683c >> 2] = -F[0x683c >> 2];
  if (!(F[0x6678 >> 2] >= 0)) F[0x6678 >> 2] = -F[0x6678 >> 2];
  F[0x64d8 >> 2] = F[0x64d8 >> 2] * F[0x683c >> 2];
  F[0x64dc >> 2] = F[0x64dc >> 2] * F[0x683c >> 2];
  F[0x64e0 >> 2] = F[0x683c >> 2] * F[0x64e0 >> 2];
  F[0x690c >> 2] = F[0x690c >> 2] * F[0x6678 >> 2];
  F[0x6910 >> 2] = F[0x6678 >> 2] * F[0x6910 >> 2];
  F[0x6914 >> 2] = F[0x6914 >> 2] * F[0x6678 >> 2];
  // swirl (0x2d8): spin rate 0x68ac, per-axis base angles 0x6680..0x6688
  F[0x68ac >> 2] = t(0x18c4) * K1;
  I[0x68b0 >> 2] = sel(0x223c);
  I[0x68b4 >> 2] = sel(0x2240);
  I[0x68b8 >> 2] = sel(0x2244);
  if (nz(F[0x68ac >> 2])) {
    if (sel(0x22a8) === 1) F[0x68ac >> 2] = cosA(A1) * F[0x68ac >> 2];
    if (sel(0x22a8) === 2) F[0x68ac >> 2] = cosA(A2) * F[0x68ac >> 2];
  }
  for (var j = 0; j < 3; j++) {
    var ax = (0x68b0 >> 2) + j;
    if (I[ax] === 0) continue;
    if (sel(0x22ac) === 1) I[ax] = ftol(F[A1]);
    if (sel(0x22ac) === 2) I[ax] = ftol(F[A2]);
    I[(0x6680 >> 2) + j] = I[ax];
  }
  // which loop
  const z = (o: number): boolean => !nz(t(o));
  const zf = z(0x18e0) || (z(0x18e4) && z(0x18e8) && z(0x18ec));
  const zd = I[(0x2294 + L) >> 2] === 0 || z(0x18c8);
  const spin = sel(0x223c) !== 0 || sel(0x2240) !== 0 || sel(0x2244) !== 0;
  var path: number;
  if (z(0x18ac) && z(0x18b0) && z(0x18b8) && z(0x18b4) && z(0x18bc) && z(0x18c0) && zd && zf) path = 0;
  else if ((zf && zd && spin && !z(0x18c0)) || (z(0x18b8) && z(0x18b0) && z(0x18ac) && !z(0x18bc) && z(0x18b4))) path = 1;
  else path = 2;
  I[0x634c >> 2] = 0;
  if (path === 2) B[0x62f0] = 1;
  const kShear = !z(0x18ac) || !z(0x18b0), kStretch = !z(0x18b8) || !z(0x18b4), kWave = !z(0x18bc) || !z(0x18c0);
  const kLens = !z(0x18c8) && I[(0x2294 + L) >> 2] !== 0;
  const kTile = !z(0x18e0) && (!z(0x18e4) || !z(0x18e8) || !z(0x18ec));
  for (var i = 0; i < I[0x69a0 >> 2]; i++) {
    var sp = I[0x614c >> 2], px = I[sp >> 2];
    pix: if (px !== I[0x68cc >> 2]) {
      I[0x6708 >> 2] = px;
      I[0x6350 >> 2] = i;
      var wu = I[0x689c >> 2] >>> 0, row = Math.floor((i >>> 0) / wu), col = (i >>> 0) - row * wu;
      I[0x6528 >> 2] = row;
      I[0x6524 >> 2] = col;
      F[0x652c >> 2] = (I[0x6524 >> 2] - I[0x61e0 >> 2]) | 0;
      F[0x6530 >> 2] = (I[0x6528 >> 2] - I[0x61e8 >> 2]) | 0;
      if (path === 0) swirl(c);                   // E+0x2d8
      else if (path === 1) { wave(c); swirl(c); }  // E+0x2d4, E+0x2d8
      else {
        if (kShear) shear(c);                     // E+0x2c8
        if (kStretch) stretch(c);                 // E+0x2cc
        if (kWave) wave(c);                       // E+0x2d4
        if (kLens) { lens(c); if (B[0x6300] === 1) break pix; }   // E+0x2d0
        if (kTile) { tile(c); if (B[0x6300] === 1) break pix; }   // E+0x2dc
        if (spin) swirl(c);
      }
      var x = (ftol(F[0x652c >> 2]) + I[0x61e0 >> 2]) | 0;
      I[0x66e4 >> 2] = x;
      var y = (ftol(F[0x6530 >> 2]) + I[0x61e8 >> 2]) | 0;
      I[0x66ec >> 2] = y;
      var w = I[(0x21a4 + L) >> 2];
      if (y >= I[(0x21a8 + L) >> 2] || x >= w || y < 0 || x < 0) break pix;
      var a = (I[0x60fc >> 2] + ((Math.imul(y, w) + x) << 2)) | 0;
      I[0x6118 >> 2] = a;
      if ((a >>> 0) >= (I[0x611c >> 2] >>> 0)) break pix;
      if (path === 2 && B[0x62f0] === 0 && I[a >> 2] !== I[0x68cc >> 2]) break pix;
      I[a >> 2] = I[0x6708 >> 2];
    }
    I[0x614c >> 2] = (sp + 4) | 0;
    I[0x634c >> 2] = i + 1;
  }
  return 0;
}

/** E+0x2d4 0x100112c0: the sine ripple. Amplitudes grow with the square of the position (0x6958, plus the
 *  integer 0x2290); 0x228c picks what drives each axis' phase (> 12: product amplitudes, 13 subtracted);
 *  x += cos(|drive_y| * 0x18bc + 0x67e4) * amp_x, y likewise with 0x18c0 / 0x67e8. */
export function wave(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var x = F[0x652c >> 2], y = F[0x6530 >> 2];
  I[0x6890 >> 2] = I[0x652c >> 2];
  I[0x6894 >> 2] = I[0x6530 >> 2];
  var md = I[(0x228c + L) >> 2], add = I[(0x2290 + L) >> 2], k = F[0x6958 >> 2];
  if (md <= 0xc) {
    I[0x6648 >> 2] = md;
    F[0x66d0 >> 2] = y * y * k + add;
    F[0x66d4 >> 2] = k * x * x + add;
  } else {
    var t = k * y;
    md = (md - 13) | 0;
    I[0x6648 >> 2] = md;
    F[0x66d0 >> 2] = t * x + add;
    F[0x66d4 >> 2] = t * y + add;
  }
  switch (md) {                                   // the plain copies of x / y the DLL also makes are no-ops
    case 1: F[0x6890 >> 2] = x * 0.5; break;
    case 2: F[0x6894 >> 2] = y * 0.5; break;
    case 3: F[0x6890 >> 2] = x * 0.5; F[0x6894 >> 2] = y * 0.5; break;
    case 4: F[0x6890 >> 2] = x * x; break;
    case 5: F[0x6894 >> 2] = y * y; break;
    case 6: F[0x6890 >> 2] = x * x; F[0x6894 >> 2] = y * y; break;
    case 7: F[0x6890 >> 2] = y * x; break;
    case 8: F[0x6894 >> 2] = y * x; break;
    case 9: F[0x6890 >> 2] = y * x; F[0x6894 >> 2] = y * x; break;
    case 10: F[0x6894 >> 2] = y * y / x; break;
    case 11: F[0x6890 >> 2] = x * x / y; break;
    case 12: F[0x6890 >> 2] = x * x / y; F[0x6894 >> 2] = y * y / x; break;
  }
  var a: number;
  if (nz(F[(0x18bc + X) >> 2])) {
    if (!(F[0x6894 >> 2] >= 0)) F[0x6894 >> 2] = -F[0x6894 >> 2];
    a = fold(ftol(F[0x6894 >> 2] * F[(0x18bc + X) >> 2] + F[0x67e4 >> 2]));
    I[0x641c >> 2] = a;
    F[0x652c >> 2] = F[COS + a] * F[0x66d0 >> 2] + F[0x652c >> 2];
  }
  if (nz(F[(0x18c0 + X) >> 2])) {
    if (!(F[0x6890 >> 2] >= 0)) F[0x6890 >> 2] = -F[0x6890 >> 2];
    a = fold(ftol(F[0x6890 >> 2] * F[(0x18c0 + X) >> 2] + F[0x67e8 >> 2]));
    I[0x6420 >> 2] = a;
    F[0x6530 >> 2] = F[COS + a] * F[0x66d4 >> 2] + F[0x6530 >> 2];
  }
  return 0;
}

/** E+0x2d8 0x10011d30: the swirl. With a spin rate (0x68ac) each enabled axis angle (0x223c / 0x2240 /
 *  0x2244 -> 0x68b0 / 0x68b4 / 0x68b8) is its base (0x6680..0x6688) minus r^2 * rate, folded into 0..359;
 *  then rotate by the third and scale y / x by the cos of the first / second. */
export function swirl(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  if (nz(F[0x68ac >> 2])) {
    var x = F[0x652c >> 2], y = F[0x6530 >> 2];
    var r2 = ftol(x * x + y * y);
    I[0x68fc >> 2] = r2;
    for (var j = 0; j < 3; j++) {
      if (I[(0x223c + L + j * 4) >> 2] === 0) continue;
      var v = (I[(0x6680 >> 2) + j] - ftol(r2 * F[0x68ac >> 2])) | 0;
      while (v < 0) v = (v + 0x168) | 0;
      if (v > 0x167) v = ((v >>> 0) % 0x168) | 0;
      I[(0x68b0 >> 2) + j] = v;
    }
  }
  I[0x6890 >> 2] = I[0x652c >> 2];
  var a = I[0x68b8 >> 2];
  if (a !== 0) {
    F[0x652c >> 2] = F[COS360 - a] * F[0x652c >> 2] - F[SIN360 - a] * F[0x6530 >> 2];
    F[0x6530 >> 2] = F[SIN360 - a] * F[0x6890 >> 2] + F[COS360 - a] * F[0x6530 >> 2];
  }
  if (I[(0x223c + L) >> 2] !== 0) F[0x6530 >> 2] = F[COS360 - I[0x68b0 >> 2]] * F[0x6530 >> 2];
  if (I[(0x2240 + L) >> 2] !== 0) F[0x652c >> 2] = F[COS360 - I[0x68b4 >> 2]] * F[0x652c >> 2];
  return 0;
}

/** E+0x2cc 0x10010da0: the stretch. Factors A (0x666c, from 0x6918) and B (0x6670, from 0x6904) grow with
 *  the square of the position (0x6908; 0x2280 > 9: product law, 10 subtracted); 0x2280 also picks the
 *  half-plane: "plus" x = (A + 1) * x, y += y * B; "minus" x -= A * x, y -= y * B. */
export function stretch(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  var x = F[0x652c >> 2], y = F[0x6530 >> 2];
  I[0x6890 >> 2] = I[0x652c >> 2];
  I[0x6894 >> 2] = I[0x6530 >> 2];
  var md = I[(0x2280 + L) >> 2], k = F[0x6908 >> 2];
  if (md <= 9) {
    I[0x6648 >> 2] = md;
    F[0x666c >> 2] = k * y * y + F[0x6918 >> 2];
    F[0x6670 >> 2] = k * x * x + F[0x6904 >> 2];
  } else {
    var t = k * y;
    md = (md - 10) | 0;
    I[0x6648 >> 2] = md;
    F[0x666c >> 2] = t * x + F[0x6918 >> 2];
    F[0x6670 >> 2] = t * y + F[0x6904 >> 2];
  }
  var A = F[0x666c >> 2], B = F[0x6670 >> 2];
  var plus = (): void => { F[0x652c >> 2] = (A + 1) * x; F[0x6530 >> 2] = y * B + F[0x6530 >> 2]; };
  var minus = (): void => { F[0x652c >> 2] = x - A * x; F[0x6530 >> 2] = F[0x6530 >> 2] - y * B; };
  switch (md) {
    case 0: plus(); break;
    case 1: if (!(y >= 0)) plus(); break;
    case 2: if (y > 0) plus(); break;
    case 3: if (y > 0) plus(); else minus(); break;
    case 4: if (!(y > 0)) plus(); else minus(); break;
    case 5: if (!(x >= 0)) plus(); break;
    case 6: if (x > 0) plus(); break;
    case 7: if (x > 0) plus(); else minus(); break;
    case 8: if (!(x > 0)) plus(); else minus(); break;
    case 9:
      F[0x652c >> 2] = !(y > 0) ? (B + 1) * x : x - A * x;
      if (!(F[0x6890 >> 2] > 0)) F[0x6530 >> 2] = y * B + F[0x6530 >> 2];
      else F[0x6530 >> 2] = F[0x6530 >> 2] - y * A;
      break;
  }
  return 0;
}

/** E+0x2c8 0x10011090: the shear. A (0x6634, from 0x68d4) and B (0x6638, from 0x68d8) grow with the
 *  square of the position (0x68d0; 0x2274 > 9: product law, 10 subtracted); 0x2274 picks the half-plane:
 *  "plus" x += y * A, y += x * B; "minus" x -= y * A, y -= x * B. */
export function shear(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  var x = F[0x652c >> 2], y = F[0x6530 >> 2];
  I[0x6890 >> 2] = I[0x652c >> 2];
  var md = I[(0x2274 + L) >> 2], k = F[0x68d0 >> 2];
  if (md <= 9) {
    I[0x6630 >> 2] = md;
    F[0x6634 >> 2] = y * y * k + F[0x68d4 >> 2];
    F[0x6638 >> 2] = x * x * k + F[0x68d8 >> 2];
  } else {
    var t = k * y;
    md = (md - 10) | 0;
    I[0x6630 >> 2] = md;
    F[0x6634 >> 2] = t * x + F[0x68d4 >> 2];
    F[0x6638 >> 2] = t * y + F[0x68d8 >> 2];
  }
  var A = F[0x6634 >> 2], B = F[0x6638 >> 2];
  var plus = (): void => { F[0x652c >> 2] = y * A + x; F[0x6530 >> 2] = x * B + F[0x6530 >> 2]; };
  var minus = (): void => { F[0x652c >> 2] = x - y * A; F[0x6530 >> 2] = F[0x6530 >> 2] - x * B; };
  switch (md) {
    case 0: plus(); break;
    case 1: if (!(y >= 0)) plus(); break;
    case 2: if (y > 0) plus(); break;
    case 3: if (y > 0) plus(); else minus(); break;
    case 4: if (!(y > 0)) plus(); else minus(); break;
    case 5: if (!(x >= 0)) plus(); break;
    case 6: if (x > 0) plus(); break;
    case 7: if (x > 0) plus(); else minus(); break;
    case 8: if (!(x > 0)) plus(); else minus(); break;
    case 9:
      F[0x652c >> 2] = !(y > 0) ? y * B + x : x - y * A;
      if (!(x > 0)) F[0x6530 >> 2] = x * B + F[0x6530 >> 2];
      else F[0x6530 >> 2] = F[0x6530 >> 2] - x * A;
      break;
  }
  return 0;
}

/** E+0x2d0 0x100116e0: the lens. Only inside (0x18c8 > 0) or outside (else) the radius^2 0x65d8: by
 *  0x2238, scale by 1 + cos(angle) * 0x68f8 (angle from r^2 and the position, 0 = cos, 1 = cos^3),
 *  scale by 1 + 0x68f8, or push out by 0x68f8 * 100. 0x6300 := 1 when the result left the lens. */
export function lens(c: Core): number {
  const I = c.m.I, F = c.m.F, B = c.m.B, L = lb(c), X = xb(c);
  B[0x6300] = 0;
  var x = F[0x652c >> 2], y = F[0x6530 >> 2], x2 = x * x, y2 = y * y;
  F[0x6890 >> 2] = x2;
  F[0x6894 >> 2] = y2;
  I[0x6648 >> 2] = I[(0x2238 + L) >> 2];
  var r2 = ftol(y2 + x2);
  I[0x68fc >> 2] = r2;
  var inside = F[(0x18c8 + X) >> 2] > 0;
  if (inside ? r2 > ftol(F[0x65d8 >> 2]) : r2 < ftol(F[0x65d8 >> 2])) return 0;
  var md = I[0x6648 >> 2];
  if (md === 0 || md === 1) {
    var v = ftol((F[(0x1898 + X) >> 2] * K01 + F[0x65d4 >> 2]) * r2 + F[(0x1894 + X) >> 2] * F[0x6530 >> 2] +
                 F[(0x1890 + X) >> 2] * F[0x652c >> 2]);
    var a = fold((v + I[(0x2260 + L) >> 2]) | 0);
    I[0x6990 >> 2] = a;
    var co = F[COS + a], s = md === 0 ? co * F[0x68f8 >> 2] : co * F[0x68f8 >> 2] * co * co;
    F[0x66c8 >> 2] = s;
    F[0x652c >> 2] = (s + 1) * F[0x652c >> 2];   // the double on the stack
    F[0x6530 >> 2] = (F[0x66c8 >> 2] + 1) * F[0x6530 >> 2];   // the stored float
  } else if (md === 2) {
    var g = F[0x68f8 >> 2] + 1;
    F[0x652c >> 2] = g * F[0x652c >> 2];
    F[0x6530 >> 2] = g * F[0x6530 >> 2];
  } else if (md === 3) {
    var d = F[0x68f8 >> 2] * 100;
    F[0x652c >> 2] = !(F[0x652c >> 2] >= 0) ? F[0x652c >> 2] - d : d + F[0x652c >> 2];
    F[0x6530 >> 2] = !(F[0x6530 >> 2] >= 0) ? F[0x6530 >> 2] - d : d + F[0x6530 >> 2];
  }
  x = F[0x652c >> 2];
  y = F[0x6530 >> 2];
  r2 = ftol(y * y + x * x);
  I[0x68fc >> 2] = r2;
  if (inside ? r2 > ftol(F[0x65d8 >> 2]) : r2 < ftol(F[0x65d8 >> 2])) B[0x6300] = 1;
  return 0;
}

/** E+0x2dc 0x10011a30: the tile / mirror. Scales (sx, sy) fall linearly with r^2 (0x64d8 / 0x64dc +
 *  0x64e0 minus r^2 times 0x690c / 0x6910 + 0x6914); x -= trunc(sx * x), y likewise. 0x2298 = 0: leave
 *  pixels outside the unit square (0x6300 := 1) or with a negative scale (0x62f0 := 0); 1 or 2: fold the
 *  scale into 0..1 (mirror). 0x62f0 := 0 when the pixel did not move. 0x2298 > 2: nothing (0x62f0 = 1). */
export function tile(c: Core): number {
  const I = c.m.I, F = c.m.F, B = c.m.B, L = lb(c), X = xb(c);
  B[0x62f0] = 1;
  var md = I[(0x2298 + L) >> 2];
  I[0x6648 >> 2] = md;
  if (md > 2) return 0;
  var x = F[0x652c >> 2], y = F[0x6530 >> 2];
  I[0x6890 >> 2] = I[0x652c >> 2];
  B[0x6300] = 0;
  I[0x6894 >> 2] = I[0x6530 >> 2];
  var r2 = ftol(x * x + y * y);
  I[0x68fc >> 2] = r2;
  if (F[(0x18e0 + X) >> 2] > 0) {
    if (r2 > ftol(F[0x65e0 >> 2])) return 0;
  } else if (r2 < ftol(F[0x65e0 >> 2])) { B[0x6300] = 1; return 0; }
  var zz = F[0x64e0 >> 2] - r2 * F[0x6914 >> 2];
  var sx = fr(F[0x64d8 >> 2] - r2 * F[0x690c >> 2] + zz);
  var sy = fr(F[0x64dc >> 2] - r2 * F[0x6910 >> 2] + zz);
  F[0x6878 >> 2] = sx;
  F[0x687c >> 2] = sy;
  if (md === 0) {
    if (!(sx >= 0) || !(sy >= 0)) { B[0x62f0] = 0; return 0; }
    if (sx > 1 || sy > 1) { B[0x6300] = 1; return 0; }
  } else if (md === 1 || md === 2) {
    if (!(sx >= 0)) F[0x6878 >> 2] = -sx;
    if (F[0x6878 >> 2] > 1) F[0x6878 >> 2] = 1 - (F[0x6878 >> 2] - ftol(F[0x6878 >> 2]));
    if (!(sy >= 0)) F[0x687c >> 2] = -sy;
    if (F[0x687c >> 2] > 1) F[0x687c >> 2] = 1 - (F[0x687c >> 2] - ftol(F[0x687c >> 2]));
  }
  F[0x652c >> 2] = F[0x652c >> 2] - ftol(F[0x6878 >> 2] * F[0x652c >> 2]);
  var yd = F[0x6530 >> 2] - ftol(F[0x687c >> 2] * F[0x6530 >> 2]);   // stays a double on the x87 stack
  F[0x6530 >> 2] = yd;
  if (ftol(F[0x6894 >> 2]) === ftol(yd) && ftol(F[0x6890 >> 2]) === ftol(F[0x652c >> 2])) B[0x62f0] = 0;
  return 0;
}

/** E+0x170 0x1000fc20: the spotlight. Per opaque pixel, inside the shape the transform describes around
 *  the centre (w/2 + 0x2254, h/2 + 0x2258; squared distance against 0x1878^2, a cut line 0x18a0, a
 *  star / ray test 0x189c, a spiral-order term 0x18a4 read from spiralMap's buffer), an intensity
 *  0x64e4 = (cos(angle) + 0x188c) * (r^2 * 0x1888 / 0x1878^2 + 0x226c / 100); then by 0x2268: 3 = alpha
 *  0x2270 - 0x2270 * intensity into the source colour, 1 = pull the colour toward 0x21f0 / 0x21f4 / 0x21f8,
 *  2 = add the blue byte into the SOURCE pixel's alpha; others (and pixels outside) get 0x2270 added into
 *  the alpha byte (saturating) when it is set. */
export function spotlight(c: Core): number {
  const m = c.m, L = lb(c), X = xb(c);
  var I = m.I, F = m.F;
  var w = I[(0x21a4 + L) >> 2], h = I[(0x21a8 + L) >> 2];
  I[0x69a0 >> 2] = Math.imul(h, w);
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x614c >> 2] = I[0x6124 >> 2];
  I[0x6930 >> 2] = I[(0x2270 + L) >> 2];
  F[0x64f0 >> 2] = I[(0x226c + L) >> 2] / 100;
  var rr = F[(0x1878 + X) >> 2];
  I[0x6900 >> 2] = ftol(rr * rr);
  I[0x692c >> 2] = I[(0x21f0 + L) >> 2];
  I[0x6928 >> 2] = I[(0x21f4 + L) >> 2];
  I[0x6920 >> 2] = I[(0x21f8 + L) >> 2];
  F[0x67fc >> 2] = I[0x692c >> 2];
  F[0x67f8 >> 2] = I[0x6928 >> 2];
  F[0x67f0 >> 2] = I[0x6920 >> 2];
  F[0x65d8 >> 2] = rr * rr + rr * rr;
  I[0x61e0 >> 2] = (((w / 2) | 0) + I[(0x2254 + L) >> 2]) | 0;
  I[0x61e8 >> 2] = (((h / 2) | 0) + I[(0x2258 + L) >> 2]) | 0;
  I[0x689c >> 2] = w;
  I[0x634c >> 2] = 0;
  I[0x67f4 >> 2] = 0;
  F[0x67c4 >> 2] = F[(0x18a8 + X) >> 2] * K001;
  if (nz(F[(0x18a4 + X) >> 2])) {
    spiralMap(c);                                 // E+0x148 (allocates)
    I = m.I;
    F = m.F;
  }
  const T = (o: number): number => F[(o + X) >> 2];
  do {
    var sp = I[0x614c >> 2], dp = I[0x6118 >> 2];
    I[0x6708 >> 2] = I[sp >> 2];
    I[0x66c4 >> 2] = I[0x6930 >> 2];
    var act = 0;                                  // 0: alpha tint then write (0x10010a64), 1: write, 2: done
    calc: {
      if (I[0x6708 >> 2] === I[0x68cc >> 2]) { act = 1; break calc; }
      I[0x6350 >> 2] = I[0x634c >> 2];
      var wu = I[0x689c >> 2] >>> 0, iu = I[0x6350 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x6528 >> 2] = row;
      I[0x6524 >> 2] = col;
      if (T(0x18a0) > 0) F[0x6924 >> 2] = I[0x6528 >> 2] * T(0x18a0);
      else F[0x6924 >> 2] = (-((I[(0x21a8 + L) >> 2] - I[0x6528 >> 2]) | 0) | 0) * T(0x18a0);
      I[0x6524 >> 2] = (I[0x6524 >> 2] - I[0x61e0 >> 2]) | 0;
      I[0x6528 >> 2] = (I[0x6528 >> 2] - I[0x61e8 >> 2]) | 0;
      var cx = I[0x6524 >> 2], cy = I[0x6528 >> 2];
      F[0x652c >> 2] = cx + cx * T(0x1884);
      F[0x6530 >> 2] = cy + cy * T(0x1880);
      var k = T(0x189c);
      if (nz(k) && nz(F[0x652c >> 2]) && nz(F[0x6530 >> 2])) {   // the ray test, off on the axes
        if (!(F[0x652c >> 2] >= 0)) F[0x652c >> 2] = -F[0x652c >> 2];
        if (!(F[0x6530 >> 2] >= 0)) F[0x6530 >> 2] = -F[0x6530 >> 2];
        F[0x6558 >> 2] = !(F[0x6530 >> 2] >= F[0x652c >> 2]) ? F[0x6530 >> 2] / F[0x652c >> 2] : F[0x652c >> 2] / F[0x6530 >> 2];
        if (k > 0) {
          F[0x6558 >> 2] = F[0x6558 >> 2] - ftol(F[0x6558 >> 2]);
          if (F[0x6558 >> 2] > k && 1 - F[0x6558 >> 2] > k) break calc;
        } else if (-k > F[0x6558 >> 2]) break calc;
      }
      F[0x652c >> 2] = F[0x652c >> 2] * F[0x652c >> 2];
      F[0x6530 >> 2] = F[0x6530 >> 2] * F[0x6530 >> 2];
      I[0x68fc >> 2] = ftol(F[0x652c >> 2] + F[0x6530 >> 2]);
      var lim = ftol(F[0x65d8 >> 2]);
      if (T(0x1878) > 0 ? I[0x68fc >> 2] > lim : I[0x68fc >> 2] < lim) break calc;
      if (nz(T(0x18a0)) && F[0x652c >> 2] > F[0x6924 >> 2]) break calc;
      if (nz(T(0x18a4))) {
        I[0x6290 >> 2] = I[((I[0x61d0 >> 2] + (Math.imul(I[0x697c >> 2], I[0x6528 >> 2]) << 2) + (I[0x6524 >> 2] << 2)) | 0) >> 2];
      }
      F[0x64e4 >> 2] = I[0x68fc >> 2] * T(0x1888) / I[0x6900 >> 2] + F[0x64f0 >> 2];
      I[0x6668 >> 2] = 0;
      F[0x67f4 >> 2] = F[0x67f4 >> 2] + F[0x67c4 >> 2];
      if (!(T(0x18a8) >= 0)) F[0x6668 >> 2] = I[0x68fc >> 2] * F[0x67f4 >> 2];
      else F[0x6668 >> 2] = F[0x652c >> 2] * F[0x67f4 >> 2];
      var v = ftol(F[0x652c >> 2] * T(0x1890) + F[0x6530 >> 2] * T(0x1894) + I[0x68fc >> 2] * T(0x1898) +
                   I[0x6290 >> 2] * T(0x18a4) + F[0x6668 >> 2]);
      var a = fold((I[(0x2260 + L) >> 2] + v) | 0);
      I[0x6990 >> 2] = a;
      F[0x64e4 >> 2] = (T(0x188c) + F[COS + a]) * F[0x64e4 >> 2];
      if (!(F[0x64e4 >> 2] > 0)) break calc;
      var al = (I[0x6930 >> 2] - ftol(I[0x6930 >> 2] * F[0x64e4 >> 2])) | 0;
      if (al > 0xff) al = 0xff;
      if (al < 0) al = 0;
      I[0x66c4 >> 2] = al;
      if (I[(0x2268 + L) >> 2] === 3) {
        I[dp >> 2] = (I[sp >> 2] & 0xffffff) | (I[0x66c4 >> 2] << 24);
        act = 2;
        break calc;
      }
      splitPixel(c);                              // inline in the DLL (the same code as E+0x280)
      F[0x67ec >> 2] = I[0x68a0 >> 2];
      F[0x67dc >> 2] = I[0x6808 >> 2];
      F[0x67c8 >> 2] = I[0x66f8 >> 2];
      if (I[0x692c >> 2] !== 0) F[0x67ec >> 2] = (F[0x67fc >> 2] - F[0x67ec >> 2]) * F[0x64e4 >> 2] + F[0x67ec >> 2];
      if (I[0x6928 >> 2] !== 0) F[0x67dc >> 2] = (F[0x67f8 >> 2] - F[0x67dc >> 2]) * F[0x64e4 >> 2] + F[0x67dc >> 2];
      if (I[0x6920 >> 2] !== 0) F[0x67c8 >> 2] = (F[0x67f0 >> 2] - F[0x67c8 >> 2]) * F[0x64e4 >> 2] + F[0x67c8 >> 2];
      if (!(F[0x67ec >> 2] >= 0)) I[0x67ec >> 2] = 0;
      if (!(F[0x67dc >> 2] >= 0)) I[0x67dc >> 2] = 0;
      if (!(F[0x67c8 >> 2] >= 0)) I[0x67c8 >> 2] = 0;
      if (F[0x67ec >> 2] > 255) F[0x67ec >> 2] = 255;
      if (F[0x67dc >> 2] > 255) F[0x67dc >> 2] = 255;
      if (F[0x67c8 >> 2] > 255) F[0x67c8 >> 2] = 255;
      I[0x68a0 >> 2] = ftol(F[0x67ec >> 2]);
      I[0x6808 >> 2] = ftol(F[0x67dc >> 2]);
      I[0x66f8 >> 2] = ftol(F[0x67c8 >> 2]);
      var md = I[(0x2268 + L) >> 2];
      if (md === 1) {
        I[0x6708 >> 2] = (((I[0x66c4 >> 2] << 8 | I[0x68a0 >> 2]) << 8 | I[0x6808 >> 2]) << 8) | I[0x66f8 >> 2];
        I[dp >> 2] = I[0x6708 >> 2];
        act = 2;
      } else if (md === 2) {
        I[0x6708 >> 2] = addSat(I[0x6708 >> 2], bswap(I[0x66f8 >> 2]));
        I[sp >> 2] = I[sp >> 2] | (I[0x6708 >> 2] & 0xff000000);
        act = 2;
      }
    }
    if (act === 0) {
      if (I[(0x2270 + L) >> 2] !== 0) I[0x6708 >> 2] = addSat(I[0x6708 >> 2], bswap(I[0x66c4 >> 2]));
      act = 1;
    }
    if (act === 1) I[dp >> 2] = I[0x6708 >> 2];
    I[0x614c >> 2] = (I[0x614c >> 2] + 4) | 0;
    I[0x6118 >> 2] = (I[0x6118 >> 2] + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  return 0;
}

/** E+0x148 0x10010b50: the spiral-order map the spotlight reads: an S x S (+1 row) buffer, S = max(w, h),
 *  rebuilt (old one freed) only when the layer outgrows the last one (0x6978 x 0x697c); each cell holds its
 *  step number along a square spiral from (S/2, S/2). 0x61d0 = the centre cell, 0x6404 = the block. */
export function spiralMap(c: Core): number {
  const m = c.m, L = lb(c);
  var I = m.I;
  if (!(I[(0x21a8 + L) >> 2] > I[0x6978 >> 2] || I[(0x21a4 + L) >> 2] > I[0x697c >> 2])) return 0;
  var old = I[0x6404 >> 2];
  I[0x6210 >> 2] = 0;
  I[0x6190 >> 2] = 1;
  I[0x620c >> 2] = 1;
  I[0x6724 >> 2] = 1;
  if (old !== 0) m.release(old);
  var h = I[(0x21a8 + L) >> 2], w = I[(0x21a4 + L) >> 2];
  I[0x6978 >> 2] = h;
  I[0x697c >> 2] = w;
  if (h < w) I[0x6978 >> 2] = w;
  else I[0x697c >> 2] = h;
  var p = m.malloc(Math.imul(Math.imul((I[0x697c >> 2] + 1) | 0, I[0x6978 >> 2]), 4));
  I = m.I;
  I[0x6404 >> 2] = p;
  if (p === 0) {
    I[0x62f4 >> 2] = 1;
    I[(0x18a4 + xb(c)) >> 2] = 0;
    return 0;
  }
  var s = I[0x697c >> 2], s2 = I[0x6978 >> 2];
  I[0x634c >> 2] = 1;
  var mid = ((Math.imul(s, s2) / 2) | 0) + ((s / 2) | 0);
  I[0x61d0 >> 2] = (p + (mid << 2)) | 0;
  I[0x61f4 >> 2] = (I[0x61d0 >> 2] - 4) | 0;
  I[0x69a8 >> 2] = Math.imul(s2, s);
  do {
    var dir = I[0x6210 >> 2];
    if ((dir >>> 0) <= 3) {
      var st = dir === 0 ? 4 : dir === 1 ? -I[0x697c >> 2] << 2 : dir === 2 ? -4 : I[0x697c >> 2] << 2;
      I[0x61f4 >> 2] = (I[0x61f4 >> 2] + st) | 0;
      I[I[0x61f4 >> 2] >> 2] = I[0x634c >> 2];
    }
    I[0x6724 >> 2] = (I[0x6724 >> 2] - 1) | 0;
    if (I[0x6724 >> 2] <= 0) {
      var nd = (I[0x6210 >> 2] + 1) | 0;
      I[0x6210 >> 2] = nd < 4 ? nd : 0;
      if (I[0x620c >> 2] === 0) {
        var g = (I[0x6190 >> 2] + 1) | 0;
        I[0x6190 >> 2] = g;
        I[0x620c >> 2] = g;
        I[0x6724 >> 2] = g;
      } else {
        I[0x6724 >> 2] = I[0x620c >> 2];
        I[0x620c >> 2] = 0;
      }
    }
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a8 >> 2]);
  return 0;
}

/** E+0x168 0x10011fa0: the cross blur. Each opaque pixel becomes the mean colour of itself and the opaque
 *  pixels up to 0x22b4 (scaled by cos of a spin angle when 0x22b0 = 1 / 2) to its right, left, up and down,
 *  with the alpha of the last one read. The right arm reaches the next row's first pixel and the down arm
 *  one row past the image, as in the DLL (raw heap reads there). */
export function blur(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var r0 = I[(0x22b4 + L) >> 2];
  I[0x6700 >> 2] = r0;
  if (I[(0x22b0 + L) >> 2] === 1) I[0x6700 >> 2] = ftol(r0 * F[COS + ftol(F[(0x18d0 + X) >> 2])]);
  if (I[(0x22b0 + L) >> 2] === 2) I[0x6700 >> 2] = ftol(I[0x6700 >> 2] * F[COS + ftol(F[(0x18d8 + X) >> 2])]);
  if (I[0x6700 >> 2] < 0) I[0x6700 >> 2] = -I[0x6700 >> 2] | 0;
  I[0x689c >> 2] = I[(0x21a4 + L) >> 2];
  I[0x69a0 >> 2] = Math.imul(I[(0x21a8 + L) >> 2], I[(0x21a4 + L) >> 2]);
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x614c >> 2] = I[0x6124 >> 2];
  I[0x634c >> 2] = 0;
  const take = (p: number): void => {           // one neighbour: add it when it is not the key
    I[0x6708 >> 2] = I[p >> 2];
    if (I[0x6708 >> 2] === I[0x68cc >> 2]) return;
    I[0x6564 >> 2] = (I[0x6564 >> 2] + 1) | 0;
    splitPixel(c);                                // E+0x280
    I[0x68a4 >> 2] = (I[0x68a4 >> 2] + I[0x68a0 >> 2]) | 0;
    I[0x680c >> 2] = (I[0x680c >> 2] + I[0x6808 >> 2]) | 0;
    I[0x66fc >> 2] = (I[0x66fc >> 2] + I[0x66f8 >> 2]) | 0;
  };
  do {
    var sp = I[0x614c >> 2];
    I[0x6708 >> 2] = I[sp >> 2];
    if (I[0x6708 >> 2] !== I[0x68cc >> 2]) {
      splitPixel(c);                              // E+0x280
      I[0x68a4 >> 2] = I[0x68a0 >> 2];
      I[0x680c >> 2] = I[0x6808 >> 2];
      I[0x66fc >> 2] = I[0x66f8 >> 2];
      I[0x6564 >> 2] = 1;
      I[0x6350 >> 2] = I[0x634c >> 2];
      var wu = I[0x689c >> 2] >>> 0, iu = I[0x6350 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x651c >> 2] = row;
      I[0x6514 >> 2] = col;
      I[0x6518 >> 2] = (I[(0x21a4 + L) >> 2] - col) | 0;
      I[0x650c >> 2] = (I[(0x21a8 + L) >> 2] - row) | 0;
      var rad = I[0x6700 >> 2];
      if (I[0x6514 >> 2] > rad) I[0x6514 >> 2] = rad;
      if (I[0x6518 >> 2] > rad) I[0x6518 >> 2] = rad;
      if (row > rad) I[0x651c >> 2] = rad;
      if (I[0x650c >> 2] > rad) I[0x650c >> 2] = rad;
      for (; I[0x6518 >> 2] !== 0; I[0x6518 >> 2] = (I[0x6518 >> 2] - 1) | 0) take((sp + (I[0x6518 >> 2] << 2)) | 0);
      for (; I[0x6514 >> 2] !== 0; I[0x6514 >> 2] = (I[0x6514 >> 2] - 1) | 0) take((sp - (I[0x6514 >> 2] << 2)) | 0);
      for (; I[0x651c >> 2] !== 0; I[0x651c >> 2] = (I[0x651c >> 2] - 1) | 0) {
        take((sp - (Math.imul(I[0x651c >> 2], I[0x689c >> 2]) << 2)) | 0);
      }
      for (; I[0x650c >> 2] !== 0; I[0x650c >> 2] = (I[0x650c >> 2] - 1) | 0) {
        take((sp + (Math.imul(I[0x650c >> 2], I[0x689c >> 2]) << 2)) | 0);
      }
      var n = I[0x6564 >> 2];
      I[0x68a0 >> 2] = (I[0x68a4 >> 2] / n) | 0;
      I[0x6808 >> 2] = (I[0x680c >> 2] / n) | 0;
      I[0x66f8 >> 2] = (I[0x66fc >> 2] / n) | 0;
      I[0x6708 >> 2] = (((I[0x66c4 >> 2] << 8 | I[0x68a0 >> 2]) << 8 | I[0x6808 >> 2]) << 8) | I[0x66f8 >> 2];
    }
    I[I[0x6118 >> 2] >> 2] = I[0x6708 >> 2];
    I[0x6118 >> 2] = (I[0x6118 >> 2] + 4) | 0;
    I[0x614c >> 2] = (sp + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  return 0;
}

/** E+0x280 0x100124b0: the pixel 0x6708 into its bytes: 0x66c4 alpha, 0x68a0 red, 0x6808 green, 0x66f8 blue */
export function splitPixel(c: Core): number {
  const I = c.m.I, p = I[0x6708 >> 2];
  I[0x66c4 >> 2] = p >>> 24;
  I[0x66f8 >> 2] = p & 0xff;
  I[0x6808 >> 2] = (p >>> 8) & 0xff;
  I[0x68a0 >> 2] = (p >>> 16) & 0xff;
  return 0;
}

/** E+0x180 0x10012500: the melt. Each key pixel takes the first opaque pixel along a square spiral of up
 *  to 0x2208 steps (spiralSearch), its alpha raised (saturating) by 0x22a4 - ring * 0x22b8 (0x22a4 is
 *  clamped to 255 first). */
export function melt(c: Core): number {
  const I = c.m.I, L = lb(c);
  var r = I[(0x2208 + L) >> 2];
  I[0x6828 >> 2] = r < 0 ? -r | 0 : r;
  if (I[(0x22a4 + L) >> 2] > 0xff) I[(0x22a4 + L) >> 2] = 0xff;
  I[0x689c >> 2] = I[(0x21a4 + L) >> 2];
  var n = Math.imul(I[(0x21a8 + L) >> 2], I[(0x21a4 + L) >> 2]);
  I[0x69a0 >> 2] = n;
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x614c >> 2] = I[0x6124 >> 2];
  I[0x6168 >> 2] = I[0x6124 >> 2];
  I[0x6164 >> 2] = (I[0x6124 >> 2] + (n << 2)) | 0;
  I[0x634c >> 2] = 0;
  do {
    I[0x6708 >> 2] = I[I[0x614c >> 2] >> 2];
    if (I[0x6708 >> 2] === I[0x68cc >> 2]) {
      spiralSearch(c);                            // E+0x26c
      if (I[0x6708 >> 2] !== I[0x68cc >> 2] && I[(0x22a4 + L) >> 2] !== 0) {
        var a = (I[(0x22a4 + L) >> 2] - Math.imul(I[0x6190 >> 2], I[(0x22b8 + L) >> 2])) | 0;
        I[0x6934 >> 2] = a > 0xff ? 0xff : a;
        I[0x6708 >> 2] = addSat(I[0x6708 >> 2], bswap(I[0x6934 >> 2]));
      }
    }
    I[I[0x6118 >> 2] >> 2] = I[0x6708 >> 2];
    I[0x6118 >> 2] = (I[0x6118 >> 2] + 4) | 0;
    I[0x614c >> 2] = (I[0x614c >> 2] + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  return 0;
}

/** E+0x26c 0x100127d0: from 0x614c, walk a square spiral (right, up, left, down; rows bounded by the
 *  current row's ends, the image by 0x6168..0x6164) for up to 0x2208 steps; the first pixel != the key
 *  goes to 0x6708. 0x6190 = the ring reached. */
export function spiralSearch(c: Core): number {
  const I = c.m.I, L = lb(c);
  var base = I[0x6168 >> 2], cur = I[0x614c >> 2], w = I[(0x21a4 + L) >> 2];
  var dir = 0, ring = 1, half = 1, left = 1, step = 1;
  var rs = (base + (Math.imul((((cur - base) | 0) >> 2) / w | 0, w) << 2)) | 0, re = (rs + (w << 2)) | 0;
  var max = (I[(0x2208 + L) >> 2] + 1) | 0, key = I[0x68cc >> 2];
  I[0x6374 >> 2] = 1;
  I[0x69a8 >> 2] = max;
  for (;;) {
    if ((dir >>> 0) <= 3) {
      var hit: boolean;
      if (dir === 0) { cur = (cur + 4) | 0; if ((cur >>> 0) >= (re >>> 0)) break; }
      else if (dir === 1) { cur = (cur + (-w << 2)) | 0; if ((cur >>> 0) <= (base >>> 0)) break; }
      else if (dir === 2) { cur = (cur - 4) | 0; if ((cur >>> 0) <= (rs >>> 0)) break; }
      else { cur = (cur + (w << 2)) | 0; if ((cur >>> 0) >= (I[0x6164 >> 2] >>> 0)) break; }
      hit = I[cur >> 2] !== key;
      if (hit) { I[0x6708 >> 2] = I[cur >> 2]; break; }
    }
    if (--left <= 0) {
      var nd = (dir + 1) | 0;
      dir = nd < 4 ? nd : 0;
      if (dir === 2 || dir === 0) {
        rs = (base + (Math.imul((((cur - base) | 0) >> 2) / w | 0, w) << 2)) | 0;
        re = (rs + (w << 2)) | 0;
      }
      if (half === 0) { ring = (ring + 1) | 0; half = ring; left = ring; }
      else { left = half; half = 0; }
    }
    if (++step >= max) break;
  }
  // every field the walk updates, as it left them
  I[0x61f4 >> 2] = cur;
  I[0x6210 >> 2] = dir;
  I[0x6190 >> 2] = ring;
  I[0x620c >> 2] = half;
  I[0x6724 >> 2] = left;
  I[0x6374 >> 2] = step;
  I[0x6158 >> 2] = rs;
  I[0x615c >> 2] = re;
  return 0;
}

/** E+0x188 0x10012a30: scroll the layer by (0x18fc, 0x1900) pixels (first folded into (-w, w) / (-h, h)),
 *  wrapping, or dropping what leaves the image when 1 <= 0x22f4 <= 3; 0x22f4 >= 3 starts from a copy of
 *  the image, else from the key colour; 0x22f4 = 2 / 3 keep only the fractional part of the offsets. */
export function shift(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var n = Math.imul(I[(0x21a8 + L) >> 2], I[(0x21a4 + L) >> 2]), i: number;
  I[0x69a0 >> 2] = n;
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x611c >> 2] = (I[0x60fc >> 2] + (n << 2)) | 0;
  I[0x614c >> 2] = I[0x6124 >> 2];
  I[0x6168 >> 2] = I[0x6124 >> 2];
  I[0x6164 >> 2] = (I[0x6124 >> 2] + (n << 2)) | 0;
  var d = I[0x6118 >> 2] >> 2, s = I[0x614c >> 2] >> 2;
  if (I[(0x22f4 + L) >> 2] >= 3) { for (i = 0; i < n; i++) I[d + i] = I[s + i]; }   // LOOP (n > 0)
  else if (n > 0) I.fill(I[0x68cc >> 2], d, d + n);
  var ox = (0x18fc + X) >> 2, oy = (0x1900 + X) >> 2;
  for (;;) {
    var W = I[(0x21a4 + L) >> 2], H = I[(0x21a8 + L) >> 2];
    if (!(W >= F[ox])) { F[ox] = F[ox] - W; continue; }
    if (-W > F[ox]) { F[ox] = W + F[ox]; continue; }
    if (!(H >= F[oy])) { F[oy] = F[oy] - H; continue; }
    if (-H > F[oy]) { F[oy] = H + F[oy]; continue; }
    break;
  }
  I[0x689c >> 2] = I[(0x21a4 + L) >> 2];
  I[0x6898 >> 2] = I[(0x21a8 + L) >> 2];
  var dx = ftol(F[ox]), dy = ftol(F[oy]);
  I[0x68c4 >> 2] = dx < 0 ? -dx | 0 : dx;
  I[0x68c8 >> 2] = dy < 0 ? -dy | 0 : dy;
  I[0x634c >> 2] = 0;
  do {
    var sp = I[0x614c >> 2];
    I[0x6708 >> 2] = I[sp >> 2];
    pix: if (I[0x6708 >> 2] !== I[0x68cc >> 2]) {
      I[0x6350 >> 2] = I[0x634c >> 2];
      var wu = I[0x689c >> 2] >>> 0, iu = I[0x6350 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x650c >> 2] = row;
      I[0x6514 >> 2] = col;
      I[0x6518 >> 2] = (I[(0x21a4 + L) >> 2] - col) | 0;
      I[0x651c >> 2] = (I[(0x21a8 + L) >> 2] - row) | 0;
      var dp = I[0x6118 >> 2];
      I[0x6148 >> 2] = dp;
      var md = I[(0x22f4 + L) >> 2], noWrap = md <= 3 && md >= 1, k = I[0x68c4 >> 2], ww = I[0x689c >> 2];
      if (k !== 0) {
        if (F[ox] > 0) {
          if (k < I[0x6518 >> 2]) I[0x6148 >> 2] = (dp + (k << 2)) | 0;
          else { if (noWrap) break pix; I[0x6148 >> 2] = (dp + ((k - ww) << 2)) | 0; }
        } else {
          if (!(k > I[0x6514 >> 2])) I[0x6148 >> 2] = (dp - (k << 2)) | 0;
          else { if (noWrap) break pix; I[0x6148 >> 2] = (dp + ((ww - k) << 2)) | 0; }
        }
      }
      k = I[0x68c8 >> 2];
      if (k !== 0) {
        var kw = Math.imul(k, ww), e: number;
        if (F[oy] > 0) {
          if (k < I[0x651c >> 2]) e = kw;
          else { if (noWrap) break pix; e = (kw - I[0x69a0 >> 2]) | 0; }
        } else {
          if (!(k > I[0x650c >> 2])) e = -kw | 0;
          else { if (noWrap) break pix; e = (I[0x69a0 >> 2] - kw) | 0; }
        }
        I[0x6148 >> 2] = (I[0x6148 >> 2] + (e << 2)) | 0;
      }
      I[I[0x6148 >> 2] >> 2] = I[0x6708 >> 2];
    }
    I[0x6118 >> 2] = (I[0x6118 >> 2] + 4) | 0;
    I[0x614c >> 2] = (sp + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  var m2 = I[(0x22f4 + L) >> 2];
  if (m2 === 3 || m2 === 2) {                     // keep only the fractional part
    if (F[oy] >= 1) F[oy] = F[oy] - ftol(F[oy]);
    if (F[ox] >= 1) F[ox] = F[ox] - ftol(F[ox]);
    if (!(F[oy] > -1)) F[oy] = F[oy] - ftol(F[oy]);
    if (!(F[ox] > -1)) F[ox] = F[ox] - ftol(F[ox]);
  }
  return 0;
}

/** E+0x128 0x10012ff0: mask by another layer (0x21e0, same size, not this one): the target starts as the
 *  key; each opaque pixel whose mask pixel (that layer's current buffer) is not that layer's key is copied,
 *  the mask's alpha byte added to its own (saturating). */
export function mask(c: Core): number {
  const I = c.m.I, L = lb(c);
  var k2 = I[(0x21e0 + L) >> 2], L2 = Math.imul(k2, 0x1ec);
  I[0x6834 >> 2] = k2;
  var w = I[(0x21a4 + L) >> 2], h = I[(0x21a8 + L) >> 2];
  if (I[(0x21a4 + L2) >> 2] !== w || I[(0x21a8 + L2) >> 2] !== h || k2 === I[0x6214 >> 2]) return 0;
  var n = Math.imul(w, h);
  I[0x6118 >> 2] = I[0x60fc >> 2];
  I[0x611c >> 2] = (I[0x60fc >> 2] + (n << 2)) | 0;
  I[0x614c >> 2] = I[0x6124 >> 2];
  I[0x6168 >> 2] = I[0x6124 >> 2];
  I[0x6164 >> 2] = (I[0x6124 >> 2] + (n << 2)) | 0;
  I[0x69a0 >> 2] = n;
  I[0x6830 >> 2] = I[(0x2194 + L2) >> 2];
  I[0x6160 >> 2] = I[(0x2144 + L2) >> 2];
  var sel = I[(0x21d4 + L2) >> 2], b: number;
  if (sel === 1) { b = I[(0x21d8 + L2) >> 2]; if (b !== 0) I[0x6160 >> 2] = b; }
  else if (sel === 2) { b = I[(0x22bc + L2) >> 2]; if (b !== 0) I[0x6160 >> 2] = b; }
  var d = I[0x6118 >> 2] >> 2;
  if (n > 0) I.fill(I[0x68cc >> 2], d, d + n);   // LOOP (n > 0)
  I[0x634c >> 2] = 0;
  do {
    var mp = I[I[0x6160 >> 2] >> 2];
    if (mp !== I[0x6830 >> 2]) {
      var px = I[I[0x614c >> 2] >> 2];
      if (px !== I[0x68cc >> 2]) {
        I[0x6708 >> 2] = px;
        I[0x682c >> 2] = mp;
        I[0x6708 >> 2] = addSat(px, mp & 0xff000000);
        I[I[0x6118 >> 2] >> 2] = I[0x6708 >> 2];
      }
    }
    I[0x6160 >> 2] = (I[0x6160 >> 2] + 4) | 0;
    I[0x6118 >> 2] = (I[0x6118 >> 2] + 4) | 0;
    I[0x614c >> 2] = (I[0x614c >> 2] + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  return 0;
}

/** E+0x184 0x10013210: the taper. Each opaque pixel's offset from the centre (w/2 + 0x2230, h/2 + 0x2234)
 *  is scaled, x by (bottom edge - row) * 0x190c / 100 and y by (right edge - col) * 0x1910 / 100 when
 *  those are set, and lands at the truncated result (onto a key-filled target). */
export function taper(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var n = Math.imul(I[(0x21a8 + L) >> 2], I[(0x21a4 + L) >> 2]);
  I[0x69a0 >> 2] = n;
  I[0x611c >> 2] = (I[0x60fc >> 2] + (n << 2)) | 0;
  I[0x614c >> 2] = I[0x6124 >> 2];
  var d = I[0x60fc >> 2] >> 2;
  if (n > 0) I.fill(I[0x68cc >> 2], d, d + n);   // LOOP (n > 0)
  I[0x61e0 >> 2] = (I[(0x2230 + L) >> 2] + ((I[(0x21a4 + L) >> 2] / 2) | 0)) | 0;
  I[0x61e8 >> 2] = (((I[(0x21a8 + L) >> 2] / 2) | 0) + I[(0x2234 + L) >> 2]) | 0;
  I[0x689c >> 2] = I[(0x21a4 + L) >> 2];
  F[0x6884 >> 2] = F[(0x190c + X) >> 2] * K01;
  F[0x6888 >> 2] = F[(0x1910 + X) >> 2] * K01;
  I[0x634c >> 2] = 0;
  do {
    I[0x6708 >> 2] = I[I[0x614c >> 2] >> 2];
    pix: if (I[0x6708 >> 2] !== I[0x68cc >> 2]) {
      I[0x6350 >> 2] = I[0x634c >> 2];
      var wu = I[0x689c >> 2] >>> 0, iu = I[0x6350 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x6528 >> 2] = row;
      I[0x6524 >> 2] = col;
      var cx = I[0x61e0 >> 2], a = (col - cx) | 0, b = (row - I[0x61e8 >> 2]) | 0, fb = fr(b);
      F[0x652c >> 2] = a;
      F[0x6530 >> 2] = b;
      if (nz(F[(0x190c + X) >> 2])) {
        F[0x652c >> 2] = ((I[(0x2234 + L) >> 2] + I[(0x21a8 + L) >> 2] - row) | 0) * a * F[0x6884 >> 2];
      }
      if (nz(F[(0x1910 + X) >> 2])) {
        F[0x6530 >> 2] = ((I[(0x2230 + L) >> 2] + I[(0x21a4 + L) >> 2] - col) | 0) * F[0x6888 >> 2] * fb;
      }
      var x = (cx + ftol(F[0x652c >> 2])) | 0;
      I[0x66e4 >> 2] = x;
      var y = (ftol(F[0x6530 >> 2]) + I[0x61e8 >> 2]) | 0;
      I[0x66ec >> 2] = y;
      var w = I[(0x21a4 + L) >> 2];
      if (y >= I[(0x21a8 + L) >> 2] || x >= w || y < 0 || x < 0) break pix;
      var t = (I[0x60fc >> 2] + ((Math.imul(y, w) + x) << 2)) | 0;
      I[0x6118 >> 2] = t;
      I[t >> 2] = I[0x6708 >> 2];
    }
    I[0x614c >> 2] = (I[0x614c >> 2] + 4) | 0;
    I[0x634c >> 2] = (I[0x634c >> 2] + 1) | 0;
  } while (I[0x634c >> 2] < I[0x69a0 >> 2]);
  return 0;
}

def({
  0x174: warp, 0x170: spotlight, 0x148: spiralMap, 0x2cc: stretch, 0x2c8: shear, 0x2d4: wave, 0x2d0: lens,
  0x2dc: tile, 0x2d8: swirl, 0x168: blur, 0x280: splitPixel, 0x180: melt, 0x26c: spiralSearch, 0x188: shift,
  0x128: mask, 0x184: taper,
});
