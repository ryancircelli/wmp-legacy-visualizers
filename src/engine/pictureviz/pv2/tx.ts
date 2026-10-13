// PictureViz_II transition steps (one per picture-logic tick, dispatched by E+0x74 on obj+0x69ac, layer 4 = the
// picture), and the two random-drift helpers. Each step has the same shape: obj+0x608 = 1 starts the out-
// transition (state 2), obj+0x600 == How_often_should_picture_be_changed starts the in-transition (state 1),
// then states 1 / 2 drive the layer and transform fields from phase angles the animator (E+0x194) advances,
// through the cosine table at obj+0x5550 (float per whole degree).
//
// x87: every `(cos + 1) * k` is evaluated in double (float table entry, float or double constant) and either
// stored as float (fr) or truncated by _ftol. Float compares are against float constants, exact in float.
import { A } from '../../ns';
import '../../rand';
import { Core, lb, xb } from './core';
import { ftol, fr } from './mem';
import { def, vt } from './vt';

const COS = 0x5550 >> 2;

/** (cos[ftol(angle)] + 1) as the x87 has it: float table entry + float 1.0, double */
function cos1(F: Float32Array, angle: number): number {
  return F[COS + ftol(angle)] + 1;
}

/** E+0x9c 0x10023570 / E+0xa0 0x10023670: a random drift: obj+0x6964 = layer 0x214c / ((rand & m) + k),
 *  obj+0x6968 = layer 0x2150 / ((rand & m) + k), then each stored in 0x2230 / 0x2234 with a random sign
 *  (four rand calls) */
function drift(c: Core, mask: number, add: number): number {
  let I = c.m.I;
  let r = A.rand();
  I[0x6964 >> 2] = (I[(0x214c + lb(c)) >> 2] / ((r & mask) + add)) | 0;
  r = A.rand();
  I[0x6968 >> 2] = (I[(0x2150 + lb(c)) >> 2] / ((r & mask) + add)) | 0;
  r = A.rand();
  I = c.m.I;
  I[(0x2230 + lb(c)) >> 2] = (r & 1) === 0 ? I[0x6964 >> 2] : -I[0x6964 >> 2] | 0;
  r = A.rand();
  I[(0x2234 + lb(c)) >> 2] = (r & 1) === 0 ? I[0x6968 >> 2] : -I[0x6968 >> 2] | 0;
  return 0;
}
/** E+0x9c 0x10023570: drift by 1/2 .. 1/9 of layer 0x214c / 0x2150 */
export function drift29(c: Core): number { return drift(c, 7, 2); }
/** E+0xa0 0x10023670: drift by 1/4 .. 1/7 of layer 0x214c / 0x2150 */
export function drift47(c: Core): number { return drift(c, 3, 4); }

/** obj+0x69b0 after an out-transition that ends in the drop-shadow reload (Zoom, Transport): 4 when
 *  Flag_Show_Photo_drop_shadow (obj+0x644) is 1, else 0 */
function endState(I: Int32Array): number { return I[0x644 >> 2] === 1 ? 4 : 0; }

/** E+0x7c 0x100240f0 (Transparency): fade (transform 0x1914) by the cosine of phase 0x18d0 */
export function transparency(c: Core): number {
  let I = c.m.I, F = c.m.F;
  const l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x18d4 + x) >> 2] = 15;
    F[(0x1928 + x) >> 2] = 15;
    F[(0x18d0 + x) >> 2] = 100;
    I[0x69b0 >> 2] = 2;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    F[(0x1914 + x) >> 2] = 0;
    I[0x69b0 >> 2] = 1;
    F[(0x18d4 + x) >> 2] = 15;
    F[(0x1928 + x) >> 2] = 15;
    F[(0x18d0 + x) >> 2] = 180;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    // 0x10024269: done when the phase is below 100 degrees or the fade is above 230
    if (ftol(F[(0x18d0 + x) >> 2]) < 100 || F[(0x1914 + x) >> 2] > 230) {
      F[(0x1914 + x) >> 2] = 255;
      I[0x69b0 >> 2] = 0;
      I[(0x22c0 + l) >> 2] = -1;
    }
  } else if (s === 2) {
    I[(0x22c0 + l) >> 2] = 0;
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    if (ftol(F[(0x18d0 + x) >> 2]) > 0xb4) {
      F[(0x1914 + x) >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
      I = c.m.I; F = c.m.F;
      I[0x69b0 >> 2] = 0;
    }
  }
  return 0;
}

/** E+0x80 0x10025200 (Dissolve): layer 0x2210 / 0x2214 (the dissolve amounts) from phases 0x18d0 / 0x18d8 */
export function dissolve(c: Core): number {
  let I = c.m.I, F = c.m.F;
  const l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[0x69b0 >> 2] = 2;
    I[(0x2214 + l) >> 2] = 0xfd;
    F[(0x18d4 + x) >> 2] = 7;
    F[(0x18dc + x) >> 2] = 15;
    F[(0x1928 + x) >> 2] = 7;
    F[(0x191c + x) >> 2] = 15;
    F[(0x18d0 + x) >> 2] = 70;
    F[(0x18d8 + x) >> 2] = 10;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[0x69b0 >> 2] = 1;
    I[(0x2214 + l) >> 2] = 0xfd;
    F[(0x18d4 + x) >> 2] = 7;
    F[(0x18dc + x) >> 2] = 5;
    F[(0x1928 + x) >> 2] = 7;
    F[(0x191c + x) >> 2] = 5;
    F[(0x18d0 + x) >> 2] = 180;
    F[(0x18d8 + x) >> 2] = 180;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2210 + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 127.5);
    I[(0x2214 + l) >> 2] = ftol(cos1(F, F[(0x18d8 + x) >> 2]) * 350);
    if (!(F[(0x18d8 + x) >> 2] >= 100)) F[(0x18d8 + x) >> 2] = 360;    // TEST AH,1: below 100 or NaN
    I[(0x212c + l) >> 2] = 3;
    I[(0x22c0 + l) >> 2] = 0;
    const p = F[(0x18d0 + x) >> 2];
    // 0x100254ec: FCOMP 310 (TEST 0x41) then FCOMP 100 (TEST 1): a NaN phase ends it too
    if (p > 310 || !(p >= 100)) {
      I[(0x22c0 + l) >> 2] = -1;
      I[0x69b0 >> 2] = 0;
    }
  } else if (s === 2) {
    I[(0x2210 + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 127.5);
    I[(0x2214 + l) >> 2] = ftol(cos1(F, F[(0x18d8 + x) >> 2]) * 350);
    if (I[(0x2214 + l) >> 2] >= 0xfd) I[(0x2214 + l) >> 2] = 0xfd;
    if (F[(0x18d8 + x) >> 2] > 180) F[(0x18d8 + x) >> 2] = 180;
    I[(0x212c + l) >> 2] = 3;
    I[(0x22c0 + l) >> 2] = 0;
    if (F[(0x18d0 + x) >> 2] >= 180) {
      I[0x6554 >> 2] = 0;
      I[0x69b0 >> 2] = 0;
      vt(c, 0x78);
    }
  }
  return 0;
}

/** E+0x84 0x100247c0 (Suck): layer 0x2200 / 0x21fc and transform 0x18ec from phase 0x18d0, the warp E+0x154,
 *  a random drift (E+0x9c) at each start; the in-transition ends when fewer than a fifth of the image's
 *  pixels differ from the colour key 0x2194 */
export function suck(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1 || I[0x600 >> 2] === I[0x1838 >> 2]) {
    if (I[0x608 >> 2] === 1) {
      I[0x608 >> 2] = 0;
      I[0x69b0 >> 2] = 2;
      F[(0x1914 + x) >> 2] = 0;
      F[(0x18e0 + x) >> 2] = 10000;
      F[(0x18f8 + x) >> 2] = 1;
      I[(0x2208 + l) >> 2] = 0x1b;
      F[(0x18d4 + x) >> 2] = 15;
      F[(0x1928 + x) >> 2] = 15;
      F[(0x18d0 + x) >> 2] = 90;
      I[(0x2200 + l) >> 2] = (I[(0x21a4 + l) >> 2] / 3) | 0;
    } else {
      I[0x69b0 >> 2] = 1;
      F[(0x18e0 + x) >> 2] = 10000;
      F[(0x18f8 + x) >> 2] = 1;
      I[(0x2208 + l) >> 2] = 0x1c;
      F[(0x18d4 + x) >> 2] = 10;
      F[(0x1928 + x) >> 2] = 10;
      F[(0x18d0 + x) >> 2] = 180;
      I[(0x2200 + l) >> 2] = 0;
    }
    I[(0x21fc + l) >> 2] = 0xd7;
    vt(c, 0x9c);
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s !== 1 && s !== 2) return 0;
  F[(0x18ec + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 5;
  I[(0x2200 + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * I[(0x21a4 + l) >> 2]);   // FIMUL
  I[(0x21fc + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 600);
  vt(c, 0x154);
  I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
  I[(0x212c + l) >> 2] = 3;
  I[(0x22c0 + l) >> 2] = 0;
  if (s === 2) {
    if (ftol(F[(0x18d0 + x) >> 2]) > 0x96) {
      vt(c, 0x78);
      I = c.m.I;
      I[0x6554 >> 2] = 0;
      I[0x69b0 >> 2] = 0;
    }
    return 0;
  }
  if (F[(0x18ec + x) >> 2] > 3) F[(0x18f8 + x) >> 2] = F[(0x18f8 + x) >> 2] * 0.5;
  if (ftol(F[(0x18d0 + x) >> 2]) >= 100) {
    if (!(F[(0x18ec + x) >> 2] > 1)) return 0;
    // 0x10024b71: count the pixels of the layer's current image (0x2144, or 0x21d8 / 0x22bc by 0x21d4) that
    // are not the colour key
    let p = I[(0x2144 + l) >> 2];
    I[0x614c >> 2] = p;
    if (I[(0x21d4 + l) >> 2] === 1) { p = I[(0x21d8 + l) >> 2]; I[0x614c >> 2] = p; }
    if (I[(0x21d4 + l) >> 2] === 2) { p = I[(0x22bc + l) >> 2]; I[0x614c >> 2] = p; }
    const n = Math.imul(I[(0x21a8 + l) >> 2], I[(0x21a4 + l) >> 2]);
    I[0x69a0 >> 2] = n;
    const key = I[(0x2194 + l) >> 2];
    let cnt = 0, k = 0;
    if (n > 0) {
      do {
        if (c.m.ld(p) !== key) cnt++;
        p = (p + 4) | 0;
        k++;
      } while (k < n);
    }
    I[0x6374 >> 2] = cnt;
    I[0x634c >> 2] = k;
    I[0x614c >> 2] = p;
    if (cnt >= ((n / 5) | 0)) return 0;
  }
  I[0x69b0 >> 2] = 0;
  I[(0x2200 + l) >> 2] = 0;
  I[(0x22c0 + l) >> 2] = -1;
  return 0;
}

/** E+0x88 0x10024db0 (Twirl): fade 0x1914 from phase 0x18d0, transform 0x18c4 (the twirl) from phase 0x18d8 */
export function twirl(c: Core): number {
  let I = c.m.I, F = c.m.F;
  const l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[0x69b0 >> 2] = 2;
    I[(0x2240 + l) >> 2] = 2;
    F[(0x18d4 + x) >> 2] = 15;
    F[(0x18dc + x) >> 2] = 4;
    F[(0x1928 + x) >> 2] = 15;
    F[(0x191c + x) >> 2] = 4;
    F[(0x18d0 + x) >> 2] = 100;
    F[(0x18d8 + x) >> 2] = 110;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[0x69b0 >> 2] = 1;
    F[(0x18d4 + x) >> 2] = 0;
    F[(0x18dc + x) >> 2] = 3;
    F[(0x1928 + x) >> 2] = 0;
    F[(0x191c + x) >> 2] = 3;
    F[(0x18d0 + x) >> 2] = 195;
    F[(0x18d8 + x) >> 2] = 195;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2240 + l) >> 2] = 1;
    F[(0x18c4 + x) >> 2] = cos1(F, F[(0x18d8 + x) >> 2]) * -1;
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    I[(0x212c + l) >> 2] = 3;
    I[(0x22c0 + l) >> 2] = 0;
    if (F[(0x18d8 + x) >> 2] > 230) F[(0x18d4 + x) >> 2] = 10;
    // 0x10025071: FCOMP 230 (TEST 0x41) then FCOMP 100 (TEST 1): a NaN phase ends it too
    if (F[(0x1914 + x) >> 2] > 230 || !(F[(0x18d8 + x) >> 2] >= 100)) {
      I[(0x22c0 + l) >> 2] = -1;
      I[0x69b0 >> 2] = 0;
    }
  } else if (s === 2) {
    F[(0x18c4 + x) >> 2] = cos1(F, F[(0x18d8 + x) >> 2]) * -1;
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    if (F[(0x18d0 + x) >> 2] > 180) {
      F[(0x18d4 + x) >> 2] = 0;
      F[(0x1914 + x) >> 2] = 0;
    }
    I[(0x212c + l) >> 2] = 3;
    I[(0x22c0 + l) >> 2] = 0;
    if (F[(0x18d8 + x) >> 2] > 165) {
      I[0x69b0 >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
    }
  }
  return 0;
}

/** E+0x8c 0x10024360 (Zoom): fade 0x1914 and layer 0x223c / 0x2240 (zoom angles) from phase 0x18d0. The ends
 *  also write 0x2428 / 0x242c of the record (0x30c on: the next layer's 0x223c / 0x2240), as the DLL does. */
export function zoom(c: Core): number {
  let I = c.m.I;
  const F = c.m.F, l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x18d4 + x) >> 2] = 15;
    F[(0x1928 + x) >> 2] = 15;
    F[(0x18d0 + x) >> 2] = 100;
    I[0x69b0 >> 2] = 2;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (I[0x600 >> 2] === I[0x1838 >> 2] && s === 0) {
    F[(0x1914 + x) >> 2] = 0;
    I[0x69b0 >> 2] = 1;
    F[(0x18d4 + x) >> 2] = 15;
    F[(0x1928 + x) >> 2] = 15;
    F[(0x18d0 + x) >> 2] = 180;
    return 0;
  }
  if (s === 1) {
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    I[(0x223c + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 90);
    I[(0x2240 + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 90);
    if (ftol(F[(0x18d0 + x) >> 2]) < 100 || F[(0x1914 + x) >> 2] > 230) {
      F[(0x1914 + x) >> 2] = 255;
      I[(0x223c + l) >> 2] = 0x5a;
      I[(0x2240 + l) >> 2] = 0x5a;
      I[(0x2428 + l) >> 2] = 0x5a;
      I[(0x242c + l) >> 2] = 0x5a;
      I[0x69b0 >> 2] = 0;
      I[(0x22c0 + l) >> 2] = -1;
    }
  } else if (s === 2) {
    I[(0x22c0 + l) >> 2] = 0;
    F[(0x1914 + x) >> 2] = cos1(F, F[(0x18d0 + x) >> 2]) * 255;
    I[(0x223c + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 90);
    I[(0x2240 + l) >> 2] = ftol(cos1(F, F[(0x18d0 + x) >> 2]) * 90);
    if (ftol(F[(0x18d0 + x) >> 2]) > 0x96) {
      F[(0x1914 + x) >> 2] = 0;
      I[(0x223c + l) >> 2] = 0;
      I[(0x2240 + l) >> 2] = 0;
      I[(0x2428 + l) >> 2] = 0;
      I[(0x242c + l) >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
      I = c.m.I;
      I[0x69b0 >> 2] = endState(I);
    }
  }
  return 0;
}

/** E+0x90 0x100263c0 (Transport): layer 0x2200 / 0x21fc / 0x2290 (beam size, spread, steps) and the warp
 *  E+0x154 on the way out */
export function transport(c: Core): number {
  let I = c.m.I;
  const F = c.m.F;
  let l = lb(c);
  const x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a8 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x12c;
    I[(0x228c + l) >> 2] = 6;
    I[(0x2290 + l) >> 2] = 0x11;
    I[(0x2288 + l) >> 2] = 1;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x22c0 + l) >> 2] = 0;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 2;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 3;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0xe6;
    I[(0x228c + l) >> 2] = 6;
    I[(0x2288 + l) >> 2] = 1;
    F[(0x18c0 + x) >> 2] = 17;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 1;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    let a = ftol(I[(0x21a8 + l) >> 2] * -0.08);
    I[(0x2200 + l) >> 2] = (ftol(I[(0x2200 + l) >> 2] * 0.95) - a) | 0;
    a = ftol(I[(0x21a8 + l) >> 2] * -0.06);
    I[(0x21fc + l) >> 2] = (ftol(I[(0x21fc + l) >> 2] * 0.95) - a) | 0;
    I[(0x212c + l) >> 2] = 3;
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] + 2) | 0;
    if (I[(0x2290 + l) >> 2] > 0x11) I[(0x2290 + l) >> 2] = 0x11;
    if (I[(0x2200 + l) >> 2] > ((I[(0x21a8 + l) >> 2] / 2) | 0)) {
      I[(0x22c0 + l) >> 2] = -1;
      I[0x69b0 >> 2] = 0;
    }
  } else if (s === 2) {
    I[(0x2200 + l) >> 2] = ftol(I[(0x2200 + l) >> 2] * 0.6666666666666666);
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] / 2) | 0;
    if (I[(0x2200 + l) >> 2] < I[(0x2290 + l) >> 2]) I[(0x2200 + l) >> 2] = I[(0x2290 + l) >> 2];
    if (I[(0x21fc + l) >> 2] < 0xc8) I[(0x21fc + l) >> 2] = 0xc8;
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] - 1) | 0;
    I[(0x212c + l) >> 2] = 3;
    vt(c, 0x154);
    I = c.m.I; l = lb(c);
    if (I[(0x2290 + l) >> 2] <= 0) {
      I[(0x21fc + l) >> 2] = 0;
      I[(0x2290 + l) >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
      I = c.m.I;
      I[0x69b0 >> 2] = endState(I);
    }
  }
  return 0;
}

/** E+0x94 0x10026840 (Ripple): layer 0x2200 (ripple radius) and transform 0x1900 (the vertical drift), the warp
 *  E+0x154 on the way out */
export function ripple(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x1900 + x) >> 2] = I[(0x21a8 + l) >> 2] * 0.7;
    I[(0x2200 + l) >> 2] = ftol(I[(0x21a4 + l) >> 2] * 0.85);
    I[(0x21fc + l) >> 2] = 0x100;
    I[(0x2290 + l) >> 2] = 5;
    I[(0x2284 + l) >> 2] = 1;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x22c0 + l) >> 2] = 0;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 2;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 0;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x100;
    I[(0x2284 + l) >> 2] = 1;
    F[(0x18bc + x) >> 2] = 27;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 1;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    const a = ftol(I[(0x21a4 + l) >> 2] * -0.03);
    I[(0x2200 + l) >> 2] = (I[(0x2200 + l) >> 2] + ((1 - a) | 0)) | 0;
    I[(0x2290 + l) >> 2] = 5;
    // 0x10026abd: ((v - h * 0.01) + v * 0.7) - 1, all on the stack
    const v = F[(0x1900 + x) >> 2];
    F[(0x1900 + x) >> 2] = (v - I[(0x21a8 + l) >> 2] * 0.01) + v * 0.7 - 1;
    I[(0x212c + l) >> 2] = 3;
    const up = !(F[(0x1900 + x) >> 2] >= I[(0x21a8 + l) >> 2] * -0.9);   // FCOMPP, TEST AH,1: below or NaN
    if (I[(0x2200 + l) >> 2] > ftol(I[(0x21a4 + l) >> 2] * 0.8) || up) {
      I[0x69b0 >> 2] = 0;
      I[(0x22c0 + l) >> 2] = -1;
    }
  } else if (s === 2) {
    const v = F[(0x1900 + x) >> 2];
    I[(0x2200 + l) >> 2] = ftol(v);
    // 0x10026bd2: v - (h * 0.05 + v * 0.15)
    F[(0x1900 + x) >> 2] = v - (I[(0x21a8 + l) >> 2] * 0.05 + v * 0.15);
    I[(0x212c + l) >> 2] = 3;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x21a8 + l) >> 2] * 0.05 > F[(0x1900 + x) >> 2]) {
      F[(0x1900 + x) >> 2] = 0;
      I[(0x21fc + l) >> 2] = 0;
      I[(0x2290 + l) >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
      c.m.I[0x69b0 >> 2] = 0;
    }
  }
  return 0;
}

/** E+0x98 0x10026ca0 (Spiral): layer 0x2200 / 0x21fc / 0x2244 and transform 0x18c4 (the spiral turn), sized by
 *  obj+0x694c = the image's larger side; the warp E+0x154 on the way out */
export function spiral(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  const w = I[(0x21a4 + l) >> 2], h = I[(0x21a8 + l) >> 2];
  I[0x694c >> 2] = w > h ? w : h;
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[0x694c >> 2];
    I[(0x21fc + l) >> 2] = 0x12c;
    I[(0x2244 + l) >> 2] = 1;
    F[(0x18c4 + x) >> 2] = -1;
    I[(0x2208 + l) >> 2] = 7;
    I[(0x22c0 + l) >> 2] = 0;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 2;
    return 0;
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = I[(0x21a4 + l) >> 2] > I[(0x21a8 + l) >> 2] ? 3 : 0xc;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0xc8;
    I[(0x2208 + l) >> 2] = 7;
    I[(0x212c + l) >> 2] = 3;
    I[0x69b0 >> 2] = 1;
    return 0;
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    const a = ftol(I[0x694c >> 2] * 0.05);
    I[(0x2200 + l) >> 2] = (ftol(a + I[(0x2200 + l) >> 2] * 1.1) + 5) | 0;
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] + 0x14) | 0;
    I[(0x2244 + l) >> 2] = 1;
    F[(0x18c4 + x) >> 2] = F[(0x18c4 + x) >> 2] - fr(0.07);
    I[(0x212c + l) >> 2] = 3;
    if (I[0x694c >> 2] * 0.5 < I[(0x2200 + l) >> 2]) {
      I[(0x22c0 + l) >> 2] = -1;
      I[0x69b0 >> 2] = 0;
    }
  } else if (s === 2) {
    const b = ftol(I[(0x2200 + l) >> 2] * -0.9090909090909091);
    I[(0x2200 + l) >> 2] = (ftol(I[0x694c >> 2] * -0.05) - b) | 0;
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] - 0x18) | 0;
    I[(0x212c + l) >> 2] = 3;
    F[(0x18c4 + x) >> 2] = ((I[(0x21fc + l) >> 2] - 0x32) | 0) * fr(-0.0033333334140479565);
    if (F[(0x18c4 + x) >> 2] > 0) F[(0x18c4 + x) >> 2] = 0;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x2244 + l) >> 2] = 0;
      I[(0x21fc + l) >> 2] = 0;
      F[(0x18c4 + x) >> 2] = 0;
      I[0x6554 >> 2] = 0;
      vt(c, 0x78);
      c.m.I[0x69b0 >> 2] = 0;
    }
  }
  return 0;
}

def({
  0x7c: transparency, 0x80: dissolve, 0x84: suck, 0x88: twirl, 0x8c: zoom, 0x90: transport, 0x94: ripple,
  0x98: spiral, 0x9c: drift29, 0xa0: drift47,
});
