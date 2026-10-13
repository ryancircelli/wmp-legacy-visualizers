// PictureViz_II per-layer effect kernels: the edge-distance map, the draw onto the target and its blend /
// fade / alpha-copy variants, the per-pixel colour work and the alpha ring. All are called through the engine
// vtable from the per-layer renderer (0x100089e0). The ancestors are Musical Colors' edgeDistance, draw,
// blend, fade, ripple and glowRing (musical/core.ts); the offsets and several details differ, so everything
// here is transliterated from the PV2 asm.
//
// Images are stored bottom-up: the target row pointer starts at the sprite's last row and walks up.
// None of these allocate, so the heap views are cached for the whole call. Per-pixel scratch fields the DLL
// leaves in the object are written back once, with the values the last pixel left there.
import { Core, lb, xb } from './core';
import { ftol, fr } from './mem';
import { def, vt } from './vt';

const TAB = 0x5550 >> 2;          // obj+0x5550: the float table (cosine by degree) the colour work indexes

/** the target address of the sprite's bottom row: ((0x6738 + 0x62b0 - 0x69fc - 1) * 0x61a8 * 4) +
 *  (0x6730 - 0x69e8) * 4 + 0x6100 (MUL: the low dword, as imul) */
function target(I: Int32Array): number {
  return (Math.imul((I[0x6738 >> 2] + I[0x62b0 >> 2] - I[0x69fc >> 2] - 1) | 0, I[0x61a8 >> 2] << 2) +
          ((I[0x6730 >> 2] - I[0x69e8 >> 2]) << 2) + I[0x6100 >> 2]) | 0;
}

/** E+0x1dc 0x1000b040: the edge-distance map (0x6120, low 16 bits per pixel) of the layer image 0x6124:
 *  how far each pixel != the colour key (0x2194) is from the shape's edge, 1..255, by up to four directional
 *  passes (0x2220 bits: 8 left-to-right, 4 right-to-left, 2 top-down, 1 bottom-up; 0 = all); the first key
 *  pixel after a run gets 0xffff OR'd in. 0x2304 := the largest distance. */
export function edgeDistance(c: Core): number {
  const m = c.m, I = m.I, U = m.U, L = lb(c);
  let md = I[(0x2220 + L) >> 2];
  I[0x6610 >> 2] = md;
  md &= 0xf;
  if (md === 0) md = 0xf;
  I[0x6610 >> 2] = md;
  const key = I[(0x2194 + L) >> 2] >>> 0;
  I[0x68cc >> 2] = key;
  const w = I[(0x21a4 + L) >> 2], h = I[(0x21a8 + L) >> 2], n = Math.imul(w, h), nn = n >>> 0;
  I[0x69a0 >> 2] = n;
  I[0x699c >> 2] = n << 2;
  I[0x62a8 >> 2] = w;
  I[0x679c >> 2] = w;
  const srcA = I[0x6124 >> 2], dstA = I[0x6120 >> 2], src = srcA >> 2, dst = dstA >> 2;
  I[0x62a0 >> 2] = (srcA + (n << 2) - 4) | 0;
  I[0x629c >> 2] = (dstA + (n << 2) - 4) | 0;
  let mx = 0, e = 0, cnt = 0, i = 0, q = 0, r = 0, col = 0;
  if ((md & 8) === 0) {
    for (i = 0; i < nn; i++) if (U[src + i] !== key) U[dst + i] = 0xfffe;   // the whole dword
  } else {
    cnt = w;
    for (i = 0; i < nn; i++) {
      if (U[src + i] !== key) {
        if (++e > 0xff) e = 0xff;
        U[dst + i] = ((U[dst + i] & 0xffff0000) | e) >>> 0;
        if (e > mx) mx = e;
      } else {
        if (e !== 0) e = 0xffff;
        U[dst + i] = (U[dst + i] | e) >>> 0;
        e = 0;
      }
      if (--cnt === 0) { e = 0; cnt = w; }
    }
  }
  // passes 4, 2, 1: the distance only ever shortens (0x1000b282)
  const lower = (k: number): void => {
    if (U[src + k] !== key) {
      if (++e > 0xff) e = 0xff;
      const v = U[dst + k] & 0xffff;
      if (v > e) { U[dst + k] = ((U[dst + k] & 0xffff0000) | e) >>> 0; if (e > mx) mx = e; }
    } else {
      if (e !== 0) e = 0xffff;
      U[dst + k] = (U[dst + k] | e) >>> 0;
      e = 0;
    }
  };
  if (md & 4) {
    e = 0; cnt = w;
    for (i = nn - 1; i >= 0; i--) {
      lower(i);
      if (--cnt === 0) { e = 0; cnt = w; }
    }
  }
  I[0x62a4 >> 2] = h;
  I[0x6798 >> 2] = h;
  I[0x679c >> 2] = w << 2;
  if (md & 2) {
    e = 0;
    for (col = 0; col < w; col++) {
      for (r = 0, q = col; r < h; r++, q += w) lower(q);
      e = 0;
    }
    I[0x678c >> 2] = (dstA + (w << 2)) | 0;
    I[0x67a8 >> 2] = (srcA + (w << 2)) | 0;
  }
  I[0x62a8 >> 2] = w;
  I[0x62a4 >> 2] = h;
  I[0x6798 >> 2] = h;
  I[0x679c >> 2] = w << 2;
  if (md & 1) {
    e = 0;
    for (col = 0; col < w; col++) {
      for (r = 0, q = nn - 1 - col; r < h; r++, q -= w) lower(q);
      e = 0;
    }
    I[0x629c >> 2] = (I[0x629c >> 2] - (w << 2)) | 0;
    I[0x62a0 >> 2] = (I[0x62a0 >> 2] - (w << 2)) | 0;
    I[0x62a8 >> 2] = 0;
  }
  I[0x63a0 >> 2] = mx;
  I[(0x2304 + L) >> 2] = mx;
  return 0;
}

/** E+0x1e0 0x1000b580: the layer image (0x6124, 0x62b4 x 0x62b0) onto the target (0x6100, 0x61a8 wide).
 *  0x21e0 == 1 first grabs the background under the key pixels (E+0x1e4) and recolours it (E+0x17c). Any
 *  colour / alpha effect goes through the blend (E+0x1ec); a transform alpha (0x1914) through the alpha
 *  copy (E+0x1e8); else a plain copy, colour-keyed unless the key is -1. */
export function draw(c: Core): number {
  let I = c.m.I;
  if (I[0x62b4 >> 2] === 0 || I[0x6124 >> 2] === 0 || I[0x62b0 >> 2] === 0) return 0;
  I[0x62b8 >> 2] = I[0x62b4 >> 2] << 2;
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  let L = lb(c);
  if (I[(0x21e0 + L) >> 2] === 1) {
    vt(c, 0x1e4);
    I = c.m.I; L = lb(c);
    if (I[(0x21e4 + L) >> 2] !== 0 || I[(0x21e8 + L) >> 2] !== 0 || I[(0x21ec + L) >> 2] !== 0 ||
        I[(0x220c + L) >> 2] !== 0 || I[(0x2218 + L) >> 2] !== 0) {
      I[0x67b8 >> 2] = I[0x62b4 >> 2];
      I[0x67ac >> 2] = I[0x62b0 >> 2];
      I[0x60fc >> 2] = I[0x6124 >> 2];
      vt(c, 0x17c);
      I = c.m.I;
    }
  }
  L = lb(c);
  const X = xb(c), F = c.m.F;
  I[0x69e0 >> 2] = 0;
  const v2268 = I[(0x2268 + L) >> 2];
  const blend = (I[(0x22a4 + L) >> 2] !== 0 && I[(0x2208 + L) >> 2] !== 0) ||
    (I[(0x2214 + L) >> 2] !== 0 && I[(0x2210 + L) >> 2] !== 0) ||
    (I[(0x2200 + L) >> 2] !== 0 && I[(0x21fc + L) >> 2] !== 0) ||
    (I[(0x2270 + L) >> 2] !== 0 && v2268 === 1) ||
    ftol(F[(0x1934 + X) >> 2]) !== 0 || I[(0x22fc + L) >> 2] !== 0 || I[(0x2248 + L) >> 2] > 1 ||
    v2268 === 3 || v2268 === 2;
  if (blend) { vt(c, 0x1ec); return 0; }
  if (F[(0x1914 + X) >> 2] !== 0) { vt(c, 0x1e8); return 0; }   // FCOMP + TEST AH,0x40: NaN counts as 0
  const U = c.m.U, key = I[0x68cc >> 2] >>> 0, w = I[0x62b4 >> 2] >>> 0;
  let rows = I[0x62b0 >> 2], si = I[0x6124 >> 2] >> 2, di = target(I) >> 2, i = 0;
  const up = (I[0x62b8 >> 2] + I[0x61ac >> 2]) >> 2;
  if (key !== 0xffffffff) {
    do {
      for (i = 0; i < w; i++) { const px = U[si++]; if (px !== key) U[di] = px; di++; }
      di -= up;
    } while (--rows !== 0);
  } else {
    do {
      for (i = 0; i < w; i++) U[di++] = U[si++];
      di -= up;
    } while (--rows !== 0);
  }
  return 0;
}

/** E+0x1ec 0x1000b850: per pixel by its alpha byte: 0 = copy, 255 = keep the target, else
 *  src*(1-a)+dst*a (+ the layer's biases 0x2224 / 0x2228), optionally pulled toward the tint
 *  0x21f0/0x21f4/0x21f8 by 0x22c4; the source alpha is kept. 0x22fc 1 / 2 hand over to the fades.
 *  obj+0x69e0 = extra source bytes per row. */
export function blend(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c);
  const mode = I[(0x22fc + L) >> 2];
  if (mode === 1) { vt(c, 0x2b8); return 0; }
  if (mode === 2) { vt(c, 0x2bc); return 0; }
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  const w = I[0x62b4 >> 2], h = I[0x62b0 >> 2];
  I[0x67b8 >> 2] = w;
  I[0x67ac >> 2] = h;
  F[0x6790 >> 2] = I[(0x2224 + L) >> 2] / 255;
  F[0x6794 >> 2] = I[(0x2228 + L) >> 2] / 255;
  F[0x67a0 >> 2] = I[(0x22c4 + L) >> 2] / 255;
  const tr = I[0x692c >> 2] = I[(0x21f0 + L) >> 2];
  const tg = I[0x6928 >> 2] = I[(0x21f4 + L) >> 2];
  const tb = I[0x6920 >> 2] = I[(0x21f8 + L) >> 2];
  const bias1 = F[0x6790 >> 2], bias2 = F[0x6794 >> 2], kt = F[0x67a0 >> 2], tint = I[(0x22c4 + L) >> 2] !== 0;
  const key = I[0x68cc >> 2] >>> 0, up = (w + (I[0x61ac >> 2] >> 2)) | 0, skip = I[0x69e0 >> 2];
  let di = target(I) >> 2, sa = I[0x6124 >> 2], rows = h, cnt = w, lastD = 0, lastS = 0, any = false;
  let a = 0, sr = 0, sg = 0, sb = 0, dr = 0, dg = 0, db = 0, r = 0, g = 0, b = 0, t10 = 0, t14 = 0;
  for (;;) {
    lastD = di; lastS = sa;
    const px = U[sa >> 2];
    if (px !== key) {
      const top = px >>> 24;
      if (top === 0) U[di] = px;
      else if (top !== 0xff) {
        a = top; any = true;
        sb = px & 0xff; sg = (px >>> 8) & 0xff; sr = (px >>> 16) & 0xff;
        const dd = U[di];
        db = dd & 0xff; dg = (dd >>> 8) & 0xff; dr = (dd >>> 16) & 0xff;
        t10 = fr(a / 255);
        t14 = fr(1 - t10);
        t10 = fr(t10 + bias1);
        t14 = fr(t14 + bias2);
        r = ftol(sr * t14 + dr * t10);
        b = ftol(sb * t14 + db * t10);
        g = ftol(sg * t14 + dg * t10);
        if (tint) {
          if (tr !== 0) r = (r + ftol(((tr - r) | 0) * kt * t10)) | 0;
          if (tb !== 0) b = (b + ftol(((tb - b) | 0) * kt * t10)) | 0;
          if (tg !== 0) g = (g + ftol(((tg - g) | 0) * kt * t10)) | 0;
          if (r > 0xff) r = 0xff;
          if (b > 0xff) b = 0xff;
          if (g > 0xff) g = 0xff;
        }
        if (r < 0) r = 0;
        if (b < 0) b = 0;
        if (g < 0) g = 0;
        U[di] = ((a << 24) | (r > 0xff ? 0xff : r) << 16 | (g > 0xff ? 0xff : g) << 8 | (b > 0xff ? 0xff : b)) >>> 0;
      }
    }
    sa += 4; di++;
    if (--cnt !== 0) continue;
    cnt = w;
    di -= up;
    sa = (sa + skip) | 0;
    if (--rows === 0) break;
  }
  I[0x657c >> 2] = lastD << 2;
  I[0x6580 >> 2] = lastS;
  I[0x67ac >> 2] = 0;
  if (any) {
    I[0x6934 >> 2] = a; I[0x6938 >> 2] = a << 24;
    I[0x68a0 >> 2] = r; I[0x66f8 >> 2] = b; I[0x6808 >> 2] = g;
    I[0x6640 >> 2] = db; I[0x6674 >> 2] = dg; I[0x667c >> 2] = dr;
    F[0x64c8 >> 2] = t10; F[0x64cc >> 2] = t14;
  }
  return 0;
}

/** the two fades' shared loop: f maps a pixel with alpha 1..254 (alpha byte kept) */
function fadeLoop(c: Core, full: number, f: (px: number, a: number) => number): void {
  const m = c.m, I = m.I, U = m.U;
  const w = I[0x62b4 >> 2];
  I[0x67b8 >> 2] = w;
  I[0x61ac >> 2] = (I[0x61a8 >> 2] + w) << 2;
  I[0x67ac >> 2] = I[0x62b0 >> 2];
  const key = I[0x68cc >> 2] >>> 0, up = I[0x61ac >> 2] >> 2, ww = w >>> 0;
  let di = target(I) >> 2, si = I[0x6124 >> 2] >> 2, rows = I[0x62b0 >> 2];
  do {
    for (let i = 0; i < ww; i++, si++, di++) {
      const px = U[si];
      if (px === key) continue;
      const a = px >>> 24;
      if (a === 0) U[di] = px;
      else if (a !== 0xff) U[di] = f(px, a);
      else if (full >= 0) U[di] = full;
    }
    di -= up;
  } while (--rows !== 0);
  I[0x67ac >> 2] = 0;
}

/** E+0x2b8 0x1000be00: subtract the alpha byte from each channel (saturating at 0), alpha kept; alpha 255
 *  leaves the target. */
export function fadeSub(c: Core): number {
  fadeLoop(c, -1, (px, a) => {
    const r = ((px >>> 16) & 0xff) - a, g = ((px >>> 8) & 0xff) - a, b = (px & 0xff) - a;
    return ((a << 24) | (r < 0 ? 0 : r) << 16 | (g < 0 ? 0 : g) << 8 | (b < 0 ? 0 : b)) >>> 0;
  });
  return 0;
}

/** E+0x2bc 0x1000bef0: add the alpha byte to each channel (saturating at 255), alpha kept; alpha 255
 *  writes 0xffffffff. */
export function fadeAdd(c: Core): number {
  fadeLoop(c, 0xffffffff, (px, a) => {
    const r = ((px >>> 16) & 0xff) + a, g = ((px >>> 8) & 0xff) + a, b = (px & 0xff) + a;
    return ((a << 24) | (r > 0xff ? 0xff : r) << 16 | (g > 0xff ? 0xff : g) << 8 | (b > 0xff ? 0xff : b)) >>> 0;
  });
  return 0;
}

/** E+0x1e8 0x1000bff0: the layer onto the target at the transform's alpha 0x1914 (clamped to 0..255; 255 =
 *  invisible, nothing drawn): src*(1-a)+dst*a + the biases 0x2224 / 0x2228, colour-keyed. The result's top
 *  byte is its red (BSWAP of r,r). */
export function alphaCopy(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c), X = xb(c);
  if (F[(0x1914 + X) >> 2] < 0) F[(0x1914 + X) >> 2] = 0;
  if (!(F[(0x1914 + X) >> 2] < 255)) { F[(0x1914 + X) >> 2] = 255; return 0; }
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  const a = I[0x6934 >> 2] = ftol(F[(0x1914 + X) >> 2]);
  const w = I[0x62b4 >> 2];
  I[0x67b8 >> 2] = w;
  I[0x67ac >> 2] = I[0x62b0 >> 2];
  F[0x6790 >> 2] = I[(0x2224 + L) >> 2] / 255;
  F[0x6794 >> 2] = I[(0x2228 + L) >> 2] / 255;
  F[0x64c8 >> 2] = a / 255;
  F[0x64cc >> 2] = 1 - F[0x64c8 >> 2];
  F[0x64c8 >> 2] = F[0x64c8 >> 2] + F[0x6790 >> 2];
  F[0x64cc >> 2] = F[0x64cc >> 2] + F[0x6794 >> 2];
  const t10 = F[0x64c8 >> 2], t14 = F[0x64cc >> 2], key = I[0x68cc >> 2] >>> 0;
  const up = (w + (I[0x61ac >> 2] >> 2)) | 0, ww = w >>> 0;
  let di = target(I) >> 2, si = I[0x6124 >> 2] >> 2, rows = I[0x62b0 >> 2], any = false;
  let r = 0, g = 0, b = 0, dr = 0, dg = 0, db = 0, nr = false, ng = false, nb = false;
  do {
    for (let i = 0; i < ww; i++, si++, di++) {
      const px = U[si];
      if (px === key) continue;
      any = true;
      const dd = U[di];
      db = dd & 0xff; dg = (dd >>> 8) & 0xff; dr = (dd >>> 16) & 0xff;
      r = ftol(((px >>> 16) & 0xff) * t14 + dr * t10);
      b = ftol((px & 0xff) * t14 + db * t10);
      g = ftol(((px >>> 8) & 0xff) * t14 + dg * t10);
      // 0x1000c2e3: the "< 0" clamps store 0 into 0x67ec / 0x67c8 / 0x67dc, not into the channels, so a
      // negative channel reaches the unsigned "> 0xff" clamp and becomes 0xff
      if (r < 0) nr = true;
      if (b < 0) nb = true;
      if (g < 0) ng = true;
      const R = (r >>> 0) > 0xff ? 0xff : r, G = (g >>> 0) > 0xff ? 0xff : g, B = (b >>> 0) > 0xff ? 0xff : b;
      U[di] = ((R << 24) | (R << 16) | (G << 8) | B) >>> 0;
    }
    di -= up;
  } while (--rows !== 0);
  I[0x67ac >> 2] = 0;
  if (nr) I[0x67ec >> 2] = 0;
  if (nb) I[0x67c8 >> 2] = 0;
  if (ng) I[0x67dc >> 2] = 0;
  if (any) {
    I[0x68a0 >> 2] = r; I[0x66f8 >> 2] = b; I[0x6808 >> 2] = g;
    I[0x6640 >> 2] = db; I[0x6674 >> 2] = dg; I[0x667c >> 2] = dr;
  }
  if (ww !== 0) {
    I[0x657c >> 2] = (di + up - 1) << 2;       // the last pixel's addresses
    I[0x6580 >> 2] = (si - 1) << 2;
  }
  return 0;
}

/** E+0x1e4 0x1000c3c0: the reverse copy: every non-key pixel of the layer image (all of them when the key
 *  is -1) takes the target pixel under it (rows walking up the target, as the draws do). */
export function grabBackground(c: Core): number {
  const m = c.m, I = m.I, U = m.U;
  I[0x61ac >> 2] = I[0x61a8 >> 2] << 2;
  const key = I[0x68cc >> 2] >>> 0, w = I[0x62b4 >> 2] >>> 0, up = (I[0x62b4 >> 2] + (I[0x61ac >> 2] >> 2)) | 0;
  let di = target(I) >> 2, si = I[0x6124 >> 2] >> 2, rows = I[0x62b0 >> 2], i = 0;
  if (key !== 0xffffffff) {
    do {
      for (i = 0; i < w; i++, si++, di++) if (U[si] !== key) U[si] = U[di];
      di -= up;
    } while (--rows !== 0);
  } else {
    do {
      for (i = 0; i < w; i++) U[si++] = U[di++];
      di -= up;
    } while (--rows !== 0);
  }
  return 0;
}

/** E+0x17c 0x1000c490: per-pixel colour work from 0x6124 into 0x60fc (0x67b8 x 0x67ac pixels): a hue
 *  turn (0x21e4: channel swap by quadrant, then a cos blend of the channels), a brightness bias (0x21e8),
 *  a pull toward the tint 0x21f0/0x21f4/0x21f8 by 0x21ec %, a ring-shaped tint by edge distance (0x220c,
 *  0x2200) and a thresholded tint (0x2210, 0x2218); 0x22cc 1 / 2 scale the hue and brightness by cos of the
 *  transform's spin angle 0x18d0 / 0x18d8, 0x222c the tints by cos of a fixed angle. Alpha is kept. */
export function colourWork(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, B8 = m.B, L = lb(c), X = xb(c);
  const Lf = (o: number): number => I[(o + L) >> 2];
  const hv = Lf(0x21e4), spin = Lf(0x22cc);
  if (hv !== 0) {
    let t = hv;
    if (spin === 1) t = ftol(t * F[TAB + ftol(F[(0x18d0 + X) >> 2])]);
    if (spin === 2) t = ftol(t * F[TAB + ftol(F[(0x18d8 + X) >> 2])]);
    if (t < 0) t = -t | 0;
    while (t > 0x5a) t -= 0x5a;
    I[0x681c >> 2] = t;
  }
  if ((Lf(0x21ec) | Lf(0x220c) | Lf(0x2218)) !== 0) {
    I[0x692c >> 2] = Lf(0x21f0); I[0x6928 >> 2] = Lf(0x21f4); I[0x6920 >> 2] = Lf(0x21f8);
    F[0x67fc >> 2] = I[0x692c >> 2]; F[0x67f8 >> 2] = I[0x6928 >> 2]; F[0x67f0 >> 2] = I[0x6920 >> 2];
    F[0x6800 >> 2] = Lf(0x2210) > 0 ? (0xff - Lf(0x2210)) | 0 : -Lf(0x2210) | 0;
    F[0x64e4 >> 2] = Lf(0x21ec) / 100;
    F[0x64ec >> 2] = Lf(0x2218) / 100;
    F[0x64e4 >> 2] = F[0x64e4 >> 2] * F[TAB + Lf(0x222c)];
    F[0x64ec >> 2] = F[0x64ec >> 2] * F[TAB + Lf(0x222c)];
  }
  const ring = I[0x6510 >> 2] = Lf(0x2200);
  if (ring !== 0) {
    I[0x6298 >> 2] = (I[0x6120 >> 2] + Math.imul(Math.imul(I[0x62b4 >> 2] << 2, I[0x62b0 >> 2]), 4)) | 0;
    F[0x63b0 >> 2] = Lf(0x220c);
    if (F[0x63b0 >> 2] < 0) F[0x63b0 >> 2] = -F[0x63b0 >> 2];
    F[0x6268 >> 2] = F[0x63b0 >> 2] / ring;
    F[0x63b0 >> 2] = F[0x63b0 >> 2] + F[0x6268 >> 2];
  }
  const src = I[0x6124 >> 2], dst = I[0x60fc >> 2];
  I[0x610c >> 2] = src;
  I[0x6110 >> 2] = dst;
  const n = Math.imul(I[0x67b8 >> 2], I[0x67ac >> 2]);
  I[0x6508 >> 2] = n;
  F[0x67cc >> 2] = Lf(0x21e8);
  if (Lf(0x21e8) !== 0) {
    if (spin === 1) F[0x67cc >> 2] = F[0x67cc >> 2] * F[TAB + ftol(F[(0x18d0 + X) >> 2])];
    if (spin === 2) F[0x67cc >> 2] = F[0x67cc >> 2] * F[TAB + ftol(F[(0x18d8 + X) >> 2])];
  }
  // loop invariants (nothing in the loop writes them)
  const key = I[0x68cc >> 2] >>> 0, cosH = F[TAB + I[0x681c >> 2]], bright = Lf(0x21e8) !== 0, kB = F[0x67cc >> 2];
  const anyT = (I[0x692c >> 2] | I[0x6928 >> 2] | I[0x6920 >> 2]) !== 0;
  const onR = I[0x692c >> 2] !== 0, onG = I[0x6928 >> 2] !== 0, onB = I[0x6920 >> 2] !== 0;
  const tR = F[0x67fc >> 2], tG = F[0x67f8 >> 2], tB = F[0x67f0 >> 2], k64e4 = F[0x64e4 >> 2], k64ec = F[0x64ec >> 2];
  const pct = Lf(0x21ec) !== 0, ringOn = Lf(0x220c) !== 0 && ring !== 0, ringPos = Lf(0x220c) > 0;
  const r63b0 = F[0x63b0 >> 2], r6268 = F[0x6268 >> 2], cosT = F[TAB + Lf(0x222c)], ringU = ring >>> 0;
  const thrOn = Lf(0x2210) !== 0 && Lf(0x2218) !== 0, thrHi = Lf(0x2210) > 0, thr = F[0x6800 >> 2];
  const edge = I[0x6120 >> 2];
  let R = 0, G = 0, Bc = 0, a = 0, r = 0, g = 0, b = 0, any = false, ringHit = false, v6208 = 0, k64e8 = 0;
  let p64 = 0, p60 = 0, p5c = 0, pa8 = 0, pa4 = 0, pa0 = 0, hue = false;
  for (let i = 0, nn = n >>> 0; i < nn; i++) {
    const sp = (src + i * 4) | 0, dp = (dst + i * 4) | 0, px = U[sp >> 2];
    if (px === key) { if (dp !== sp) U[dp >> 2] = px; continue; }
    any = true;
    a = px >>> 24; b = px & 0xff; g = (px >>> 8) & 0xff; r = (px >>> 16) & 0xff;
    R = r; G = g; Bc = b;
    if (hv !== 0) {
      hue = true;
      if (hv >= 0x5a || hv <= -0xb4) { R = g; Bc = r; G = b; }          // 0x1000cb9c
      else if (hv <= -0x5a) { R = b; Bc = g; G = r; }                     // 0x1000cb61
      p64 = fr(R * cosH); p60 = fr(G * cosH); p5c = fr(Bc * cosH);
      pa8 = fr(R - p64); pa4 = fr(G - p60); pa0 = fr(Bc - p5c);
      if (hv < 0) { R = fr(p64 + pa0); G = fr(p60 + pa8); Bc = fr(p5c + pa4); }
      else { R = fr(p64 + pa4); G = fr(p60 + pa0); Bc = fr(p5c + pa8); }
    }
    if (bright) { R = fr(R + kB); G = fr(G + kB); Bc = fr(Bc + kB); }
    if (anyT) {
      if (pct) {
        if (onR) R = fr((tR - R) * k64e4 + R);
        if (onG) G = fr((tG - G) * k64e4 + G);
        if (onB) Bc = fr((tB - Bc) * k64e4 + Bc);
      }
      ring: if (ringOn) {
        const d = B8[(edge - (src - sp)) | 0];             // word load AND 0xff: the low byte
        if (ringPos) {
          if (d > ringU) break ring;
          v6208 = d;
        } else {
          v6208 = 1;
          if (d < ringU) v6208 = (ring - d) | 0;
        }
        ringHit = true;
        k64e8 = fr((r63b0 - v6208 * r6268) / 100);
        k64e8 = fr(k64e8 * cosT);
        if (onR) R = fr((tR - R) * k64e8 + R);
        if (onG) G = fr((tG - G) * k64e8 + G);
        if (onB) Bc = fr((tB - Bc) * k64e8 + Bc);
      }
      if (thrOn) {
        if (onR && (thrHi ? !(R < thr) : R < thr)) R = fr((tR - R) * k64ec + R);
        if (onG && (thrHi ? !(G < thr) : G < thr)) G = fr((tG - G) * k64ec + G);
        if (onB && (thrHi ? !(Bc < thr) : Bc < thr)) Bc = fr((tB - Bc) * k64ec + Bc);
      }
    }
    if (R < 0) R = 0;
    if (G < 0) G = 0;
    if (Bc < 0) Bc = 0;
    if (R > 255) R = 255;
    if (G > 255) G = 255;
    if (Bc > 255) Bc = 255;
    r = ftol(R); g = ftol(G); b = ftol(Bc);
    U[dp >> 2] = ((((a << 8 | r) << 8 | g) << 8) | b) >>> 0;
  }
  I[0x610c >> 2] = (src + n * 4) | 0;
  I[0x6110 >> 2] = (dst + n * 4) | 0;
  I[0x6508 >> 2] = 0;
  if (any) {
    I[0x66c4 >> 2] = a; I[0x68a0 >> 2] = r; I[0x6808 >> 2] = g; I[0x66f8 >> 2] = b;
    F[0x67ec >> 2] = R; F[0x67dc >> 2] = G; F[0x67c8 >> 2] = Bc;
  }
  if (hue) {
    F[0x6664 >> 2] = p64; F[0x6660 >> 2] = p60; F[0x665c >> 2] = p5c;
    F[0x66a8 >> 2] = pa8; F[0x66a4 >> 2] = pa4; F[0x66a0 >> 2] = pa0;
  }
  if (ringHit) { I[0x6208 >> 2] = v6208; F[0x64e8 >> 2] = k64e8; }
  return 0;
}

/** the mask-layer alpha (0x1000e3d7 / 0x1000de75): 0x2248 = k in 2..0x6994 takes layer k's image (0x2144;
 *  0x21d4 1 / 2: its work buffers 0x21d8 / 0x22bc, none = stop) as an alpha mask: alpha = (keep ? alpha : 0)
 *  + 255 - the mask pixel's blue, saturating. Skipped when this layer has more pixels than layer k. */
function maskAlpha(c: Core, keep: boolean): void {
  const m = c.m, I = m.I, U = m.U, L = lb(c);
  const k = I[(0x2248 + L) >> 2];
  if (!(k > 1 && k <= I[0x6994 >> 2])) return;
  I[0x634c >> 2] = k;
  const K = Math.imul(k, 0x1ec), n = Math.imul(I[0x67b8 >> 2], I[0x67ac >> 2]);
  I[0x6508 >> 2] = n;
  if (n > Math.imul(I[(0x21a4 + K) >> 2], I[(0x21a8 + K) >> 2])) return;
  I[0x66b8 >> 2] = I[(0x2144 + K) >> 2];
  const sel = I[(0x21d4 + K) >> 2];
  if (sel === 1 || sel === 2) {
    const p = I[((sel === 1 ? 0x21d8 : 0x22bc) + K) >> 2];
    if (p === 0) return;
    I[0x66b8 >> 2] = p;
  }
  const key = I[0x68cc >> 2] >>> 0, src = I[0x6124 >> 2] >> 2, mk = I[0x66b8 >> 2] >> 2;
  for (let i = 0, nn = n >>> 0; i < nn; i++) {
    const px = U[src + i];
    if (px === key) continue;
    const add = 0xff - (U[mk + i] & 0xff);
    const top = (keep ? px >>> 24 : 0) + add;
    U[src + i] = ((top > 0xff ? 0xff : top) << 24 | (px & 0xffffff)) >>> 0;
  }
  I[0x6508 >> 2] = 0;
}

/** E+0x1d0 0x1000d530: the alpha byte of the layer image 0x6124, in place: a ring of width 0x2200 round the
 *  shape's edge (the edge-distance map 0x6120) fading by 0x21fc, a brightness term (0x2214 / 0x2210), on
 *  top of the transform's base alpha 0x1914, then the mask-layer alpha (0x2248 > 1). Skipped while the
 *  parameter signature stored in the dword before the pixels is unchanged (0x2300 == 2: once, unchecked). */
export function alphaRing(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c), X = xb(c);
  const Lf = (o: number): number => I[(o + L) >> 2];
  if (Lf(0x2300) === 2) I[(0x2300 + L) >> 2] = 1;
  else {
    const sig = (Lf(0x2200) + Math.imul(Lf(0x21fc), 0xff) + (Lf(0x2214) << 9) + Lf(0x2210) + ftol(F[(0x1914 + X) >> 2]) +
                 Math.imul(Lf(0x22a4), 3) + Lf(0x2248) + Lf(0x224c) + 1) | 0;
    I[0x6170 >> 2] = sig;
    const sp = (I[0x6124 >> 2] - 4) >> 2;
    if (I[sp] === sig) return 0;
    I[sp] = sig;
  }
  const n = Math.imul(I[0x67b8 >> 2], I[0x67ac >> 2]);
  I[0x6508 >> 2] = n;
  const ring = I[0x6510 >> 2] = Lf(0x2200);
  I[0x68a8 >> 2] = I[(0x1914 + X) >> 2];          // MOV: the float's bits
  I[0x6940 >> 2] = 0;
  I[0x693c >> 2] = 0;
  if (ring !== 0) {
    I[0x63a0 >> 2] = Lf(0x2304);
    I[0x68f0 >> 2] = Lf(0x21fc);
    I[0x6934 >> 2] = Lf(0x21fc) < 0 ? -Lf(0x21fc) | 0 : Lf(0x21fc);
    F[0x63b4 >> 2] = I[0x6934 >> 2];
    F[0x624c >> 2] = F[0x63b4 >> 2] / ring;
    const r3 = (ring / 3) | 0;
    if (I[0x63a0 >> 2] < r3) F[0x63b4 >> 2] = ((r3 - I[0x63a0 >> 2]) | 0) * F[0x624c >> 2] + F[0x63b4 >> 2];
  }
  const key = I[0x68cc >> 2] >>> 0, src = I[0x6124 >> 2] >> 2, edge = I[0x6120 >> 2] >> 2, nn = n >>> 0;
  const b0 = F[(0x1914 + X) >> 2] === 0, mode = Lf(0x2248);   // FCOMP + TEST AH,0x40: NaN counts as 0
  let i = 0;
  if (Lf(0x2214) === 0 && Lf(0x2210) === 0 && b0 && mode === 0 && ring !== 0 && Lf(0x21fc) > 0) {
    // 0x1000e07c: only the ring. (Its mask-layer block, 0x1000e0cc, needs 0x2248 > 1: unreachable here.)
    const a0 = I[0x6934 >> 2] = ftol(F[0x63b4 >> 2]), ringU = ring >>> 0, a0u = a0 >>> 0;
    for (i = 0; i < nn; i++) {
      const px = U[src + i];
      if (px === key) continue;
      const d = U[edge + i] & 0xffff;
      if (d > ringU) continue;
      const p = d * a0u;                                   // MUL / DIV: exact unsigned
      let q = Math.floor(p / ringU);
      if (q * ringU > p) q--;
      let v = (a0 - q) >>> 0;
      if (v > 0xff) v = 0xff;
      U[src + i] = ((px & 0xffffff) | (v << 24)) >>> 0;
    }
    I[0x6508 >> 2] = 0;
    return 0;
  }
  if (Lf(0x2214) === 0 && Lf(0x2210) === 0 && mode > 1 && b0) {
    maskAlpha(c, false);                                    // 0x1000de75: the mask's alpha replaces it
    return 0;
  }
  const bright = Lf(0x2214) !== 0 && Lf(0x2210) !== 0;
  if (bright) {
    let t = Lf(0x2210);
    t = t < 0 ? -t | 0 : (0xff - t) | 0;
    I[0x6954 >> 2] = t;
    I[0x68f4 >> 2] = Lf(0x2214);
    F[0x63c0 >> 2] = I[0x68f4 >> 2];
    F[0x6250 >> 2] = F[0x63c0 >> 2] / 255;
  }
  const ringU = ring >>> 0, neg = I[0x68f0 >> 2] < 0, base = F[0x68a8 >> 2];
  const ra = F[0x63b4 >> 2], rk = F[0x624c >> 2], half = fr(F[0x63b4 >> 2] / 2);
  const lim = I[0x6954 >> 2], bA = F[0x63c0 >> 2], bk = F[0x6250 >> 2], pos = Lf(0x2210) >= 0;
  const m224c = Lf(0x224c), br2 = fr((Lf(0x2214) - (Lf(0x2214) >> 31)) >> 1), br1 = fr(Lf(0x2214));
  let v = 0, mx = 0, a = 0, gotV = false, gotMx = false, any = false;
  for (i = 0; i < nn; i++) {
    const px = U[src + i];
    if (px === key) continue;
    any = true;
    let f40 = 0, f3c = 0;
    if (ring !== 0) {
      const e = U[edge + i] & 0xffff;
      v = e > ringU ? 0 : neg ? (ring - e) | 0 : e;        // 0x1000daa6
      gotV = true;
      if (v !== 0) {
        if (mode === 0) f40 = fr(ra - v * rk);
        if (mode === 1) f40 = ring !== v ? ra : half;
        if (mode > 1) f40 = fr(ra - v * rk);
      }
    }
    if (bright) {
      const bb = px & 0xff, gg = (px >>> 8) & 0xff, rr = (px >>> 16) & 0xff;
      mx = rr; if (mx < gg) mx = gg; if (mx < bb) mx = bb;
      gotMx = true;
      if (m224c === 0) {
        if (pos) { if (mx > lim) f3c = fr(bA - (0xff - mx) * bk); }
        else if (mx < lim) f3c = fr(bA - mx * bk);
      }
      if (m224c === 1) {
        if (lim === mx) f3c = br2;
        else if (pos) { if (mx > lim) f3c = br1; }
        else if (mx < lim) f3c = br1;
      }
    }
    a = ftol(base + f40 + f3c);
    if (a > 0xff) a = 0xff;
    // BSWAP / AND 0xffffff00 / OR a / BSWAP: a negative a smears into the colour bytes
    U[src + i] = bswap(((bswap(px) & 0xffffff00) | a) >>> 0);
  }
  I[0x6508 >> 2] = 0;
  I[0x6580 >> 2] = (src + nn) << 2;
  I[0x657c >> 2] = (edge + nn) << 2;
  if (gotV) I[0x6208 >> 2] = v;
  if (gotMx) I[0x63bc >> 2] = mx;
  if (any) I[0x6934 >> 2] = a;
  maskAlpha(c, true);                                       // 0x1000e3d7: the mask's alpha is added
  return 0;
}

function bswap(x: number): number {
  return ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
}

def({
  0x1dc: edgeDistance,
  0x1e0: draw,
  0x1ec: blend,
  0x2b8: fadeSub,
  0x2bc: fadeAdd,
  0x1e8: alphaCopy,
  0x1e4: grabBackground,
  0x17c: colourWork,
  0x1d0: alphaRing,
});
