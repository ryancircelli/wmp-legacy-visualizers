// PictureViz_II transition steps E+0xa4..E+0xe4 (Toaster .. Radial): one call per picture-logic tick from
// E+0x74 (0x10023ad0) on the current layer (4, the picture). Every one has the same shape:
//   obj+0x608 = 1        a new picture was just loaded: set the arrival's fields, layer 0x22c0 = 0 (shown),
//                        state (obj+0x69b0) 2;
//   obj+0x600 = 0x1838   the picture's time is up: set the departure's fields, state 1;
//   state 1              step the departure; when done, layer 0x22c0 = -1 (hidden) and state 0;
//   state 2              step the arrival (most then call E+0x154); when done, E+0x78 resets the layer's
//                        transition fields and the state goes to 0, or to 4 (the drop-shadow reload, E+0x100)
//                        for the transitions that draw the picture without its shadow.
// Float compares follow FCOMP/FNSTSW/TEST: an unordered (NaN) compare sets C0, so "AH & 1 set" is written
// !(a >= b) and "AH & 0x41 set" !(a > b).
// They only set layer / transform fields; the per-layer renderer turns them into pixels. All return 0.
// Float stores go through the Float32Array (= FSTP float of the x87's double); integer-valued float constants
// are written as their bit patterns where the DLL does (MOV dword).
import { Core, lb, xb } from './core';
import { ftol, fr } from './mem';
import { def, vt } from './vt';

const F0_2 = fr(0.2);             // float 0x10033068
const F0_01 = fr(0.01);           // float 0x10032478

/** the arrival's common start: layer shown (0x22c0 = 0), moved (0x212c = 3), state 2 */
function arriveStart(I: Int32Array, l: number): number {
  I[(0x22c0 + l) >> 2] = 0;
  I[(0x212c + l) >> 2] = 3;
  I[0x69b0 >> 2] = 2;
  return 0;
}
/** the departure's common start: 0x212c = 3, state 1 */
function leaveStart(I: Int32Array, l: number): number {
  I[(0x212c + l) >> 2] = 3;
  I[0x69b0 >> 2] = 1;
  return 0;
}
/** the departure is over: layer hidden (0x22c0 = -1), state 0 */
function leaveDone(I: Int32Array, l: number): number {
  I[(0x22c0 + l) >> 2] = -1;
  I[0x69b0 >> 2] = 0;
  return 0;
}
/** the arrival is over: 0x6554 = 0, E+0x78; state 0, or 4 when `shadow` and Flag_Show_Photo_drop_shadow
 *  (obj+0x644) is 1 (the DEC/NEG/SBB/AND/ADD idiom) */
function arriveDone(c: Core, shadow: boolean): number {
  c.m.I[0x6554 >> 2] = 0;
  vt(c, 0x78);
  const I = c.m.I;
  I[0x69b0 >> 2] = shadow && I[0x644 >> 2] === 1 ? 4 : 0;
  return 0;
}
/** obj+0x694c = the larger of the layer's width and height (signed); transform 0x1878 = half of it (CDQ/SUB/SAR:
 *  truncated toward zero), FILD / FSTP float */
function radius(I: Int32Array, F: Float32Array, l: number, x: number): void {
  const w = I[(0x21a4 + l) >> 2], h = I[(0x21a8 + l) >> 2];
  I[0x694c >> 2] = w > h ? w : h;
  F[(0x1878 + x) >> 2] = (I[0x694c >> 2] / 2) | 0;
}

/** E+0xa4 0x100256a0 (Toaster): the picture slides along transform 0x1900 from -height */
export function toaster(c: Core): number {
  const I = c.m.I, F = c.m.F, l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x1900 + x) >> 2] = -I[(0x21a8 + l) >> 2];
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) return leaveStart(I, l);
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    F[(0x1900 + x) >> 2] = F[(0x1900 + x) >> 2] * 1.2 - I[(0x21a8 + l) >> 2] * 0.1;
    I[(0x212c + l) >> 2] = 3;
    // FCOMP + TEST AH,0x41 / JNZ: done when h * -0.96 > the offset
    if (I[(0x21a8 + l) >> 2] * -0.96 > F[(0x1900 + x) >> 2]) return leaveDone(I, l);
  } else if (s === 2) {
    F[(0x1900 + x) >> 2] = F[(0x1900 + x) >> 2] * 0.5;
    I[(0x212c + l) >> 2] = 3;
    // FCOMPP of h * 0.2 against -offset, TEST AH,0x41 / JNZ: done when h * 0.2 > -offset
    if (I[(0x21a8 + l) >> 2] * 0.2 > -F[(0x1900 + x) >> 2]) {
      F[(0x1900 + x) >> 2] = 0;
      return arriveDone(c, true);
    }
  }
  return 0;
}

/** Swipe / Curtains / WetGlass state 1: layer 0x2200 grows by *1.1 - size * k (state 2 shrinks it by
 *  *(10/11)) while 0x21fc moves by +10 / -0x18 */
function sweepIn(I: Int32Array, l: number, size: number, k: number): void {
  const a = ftol(size * k);
  const b = ftol(I[(0x2200 + l) >> 2] * 1.1);
  I[(0x2200 + l) >> 2] = (b - a) | 0;
  I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] + 10) | 0;
}

/** E+0xa8 0x100258e0 (Swipe) */
export function swipe(c: Core): number {
  let I = c.m.I;
  let l = lb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a4 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x190;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 4;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0xd7;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    sweepIn(I, l, I[(0x21a4 + l) >> 2], -0.07);
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > I[(0x21a4 + l) >> 2]) return leaveDone(I, l);
  } else if (s === 2) {
    I[(0x2200 + l) >> 2] = ftol(I[(0x2200 + l) >> 2] * 0.9090909090909091);
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] - 0x18) | 0;
    I[(0x212c + l) >> 2] = 3;
    vt(c, 0x154);
    I = c.m.I; l = lb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x21fc + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** E+0xac 0x10025b80 (Rotate): transform spin 0x18d0 from 90 down by 8 (arrival) / from 1 up by 8 (departure);
 *  E+0x194 adds 0x18d4 to it every tick */
export function rotate(c: Core): number {
  const I = c.m.I, F = c.m.F, l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x18d4 + x) >> 2] = -8;
    F[(0x18d0 + x) >> 2] = 90;
    I[(0x2240 + l) >> 2] = 1;
    I[(0x22ac + l) >> 2] = 1;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    F[(0x18d4 + x) >> 2] = 8;
    F[(0x18d0 + x) >> 2] = 1;
    I[(0x2240 + l) >> 2] = 1;
    I[(0x22ac + l) >> 2] = 1;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x212c + l) >> 2] = 3;
    if (F[(0x18d0 + x) >> 2] > 90) return leaveDone(I, l);          // TEST AH,0x41 / JNZ
  } else if (s === 2) {
    I[(0x212c + l) >> 2] = 3;
    if (!(F[(0x18d0 + x) >> 2] >= 0)) {                          // TEST AH,1 / JZ (C0: less or unordered)
      I[(0x2240 + l) >> 2] = 0;
      return arriveDone(c, true);
    }
  }
  return 0;
}

/** E+0xb0 0x10025de0 (Spin): Rotate's spin with the layer flags 0x223c / 0x2240 / 0x2244 / 0x2208 */
export function spin(c: Core): number {
  const I = c.m.I, F = c.m.F, l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    F[(0x18d4 + x) >> 2] = -8;
    F[(0x18d0 + x) >> 2] = 90;
    I[(0x223c + l) >> 2] = 1;
    I[(0x2240 + l) >> 2] = 1;
    I[(0x2244 + l) >> 2] = 1;
    I[(0x2208 + l) >> 2] = 1;
    I[(0x22ac + l) >> 2] = 1;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    F[(0x18d4 + x) >> 2] = 8;
    F[(0x18d0 + x) >> 2] = 1;
    I[(0x2208 + l) >> 2] = 1;
    I[(0x22ac + l) >> 2] = 1;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x223c + l) >> 2] = 1;
    I[(0x2240 + l) >> 2] = 1;
    I[(0x2244 + l) >> 2] = 1;
    I[(0x212c + l) >> 2] = 3;
    if (F[(0x18d0 + x) >> 2] > 90) {
      I[(0x2200 + l) >> 2] = 0;
      return leaveDone(I, l);
    }
  } else if (s === 2) {
    I[(0x212c + l) >> 2] = 3;
    if (!(F[(0x18d0 + x) >> 2] >= 0)) {
      I[(0x223c + l) >> 2] = 0;
      I[(0x2240 + l) >> 2] = 0;
      I[(0x2244 + l) >> 2] = 0;
      return arriveDone(c, true);
    }
  }
  return 0;
}

/** E+0xb4 0x10026110 (Curtains): Swipe with mode 0xc, up to half the width */
export function curtains(c: Core): number {
  let I = c.m.I;
  let l = lb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a4 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x320;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 0xc;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x320;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    sweepIn(I, l, I[(0x21a4 + l) >> 2], -0.03);
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > ((I[(0x21a4 + l) >> 2] / 2) | 0)) return leaveDone(I, l);
  } else if (s === 2) {
    I[(0x2200 + l) >> 2] = ftol(I[(0x2200 + l) >> 2] * 0.9090909090909091);
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] - 0x18) | 0;
    I[(0x212c + l) >> 2] = 3;
    vt(c, 0x154);
    I = c.m.I; l = lb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x21fc + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** Undulation / Flourish / Disperse / SeaGrass state 1: 0x2200 = ftol(0x2200 * 1.1) - ftol(size * -0.01) + 3,
 *  0x21fc += 10 */
function growIn(I: Int32Array, l: number, size: number): void {
  const a = ftol(size * -0.01);
  const b = ftol(I[(0x2200 + l) >> 2] * 1.1);
  I[(0x2200 + l) >> 2] = (b - a + 3) | 0;
  I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] + 10) | 0;
}
/** their state 2 start: 0x2200 *= 0.85 (ftol), 0x21fc -= 0x18, 0x212c = 3 */
function shrinkOut(I: Int32Array, l: number): void {
  I[(0x2200 + l) >> 2] = ftol(I[(0x2200 + l) >> 2] * 0.85);
  I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] - 0x18) | 0;
  I[(0x212c + l) >> 2] = 3;
}

/** E+0xb8 0x100270c0 (Undulation): the reveal with the wave amplitude 0x2290 (up 1 to 20 / down 2 to 0) */
export function undulation(c: Core): number {
  let I = c.m.I;
  const F = c.m.F;
  let l = lb(c);
  const x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a4 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x12c;
    I[(0x2290 + l) >> 2] = 0x18;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 0xc;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x64;
    F[(0x18bc + x) >> 2] = 4;
    F[(0x18c0 + x) >> 2] = 4;
    I[(0x2208 + l) >> 2] = 7;
    I[(0x2284 + l) >> 2] = 0;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x2290 + l) >> 2] = 0;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    growIn(I, l, I[(0x21a4 + l) >> 2]);
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] + 1) | 0;
    if (I[(0x2290 + l) >> 2] > 0x14) I[(0x2290 + l) >> 2] = 0x14;
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > ftol(I[(0x21a4 + l) >> 2] * 1.2)) return leaveDone(I, l);
  } else if (s === 2) {
    shrinkOut(I, l);
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] - 2) | 0;
    if (I[(0x2290 + l) >> 2] < 0) I[(0x2290 + l) >> 2] = 0;
    vt(c, 0x154);
    I = c.m.I; l = lb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x21fc + l) >> 2] = 0;
      I[(0x2290 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** Flourish / Disperse: the arrival starts with the random helper E+0xa0 */
function scatterOut(c: Core): number {
  let I = c.m.I;
  let l = lb(c);
  I[0x608 >> 2] = 0;
  I[(0x2200 + l) >> 2] = I[(0x21a4 + l) >> 2];
  I[(0x21fc + l) >> 2] = 0x12c;
  vt(c, 0xa0);
  I = c.m.I; l = lb(c);
  return arriveStart(I, l);
}
/** Flourish / Disperse states 1 and 2: transform 0x18c4 -3 per tick leaving, (0x21fc - 50) * -0.2 arriving */
function scatterStep(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    growIn(I, l, I[(0x21a4 + l) >> 2]);
    F[(0x18c4 + x) >> 2] = F[(0x18c4 + x) >> 2] - 3;
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > ftol(I[(0x21a4 + l) >> 2] * 1.2)) return leaveDone(I, l);
  } else if (s === 2) {
    shrinkOut(I, l);
    F[(0x18c4 + x) >> 2] = ((I[(0x21fc + l) >> 2] - 0x32) | 0) * -0.2;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x21fc + l) >> 2] = 0;
      F[(0x18c4 + x) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** E+0xbc 0x100274d0 (Flourish) */
export function flourish(c: Core): number {
  let I = c.m.I;
  if (I[0x608 >> 2] === 1) return scatterOut(c);
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    let l = lb(c);
    const F = c.m.F, x = xb(c);
    I[(0x2220 + l) >> 2] = 1;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x64;
    F[(0x18bc + x) >> 2] = 4;
    F[(0x18c0 + x) >> 2] = 4;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x228c + l) >> 2] = 0;
    vt(c, 0xa0);
    I = c.m.I; l = lb(c);
    return leaveStart(I, l);
  }
  return scatterStep(c);
}

/** E+0xc0 0x10027880 (Disperse) */
export function disperse(c: Core): number {
  let I = c.m.I;
  if (I[0x608 >> 2] === 1) return scatterOut(c);
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    let l = lb(c);
    const x = xb(c);
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x64;
    I[(0x18bc + x) >> 2] = 0x3dcccccd;     // 0.1f
    I[(0x18c0 + x) >> 2] = 0x3ca3d70a;     // 0.02f
    I[(0x18d4 + x) >> 2] = 0x3cf5c28f;     // 0.03f
    I[(0x228c + l) >> 2] = 0xa;
    vt(c, 0xa0);
    I = c.m.I; l = lb(c);
    return leaveStart(I, l);
  }
  return scatterStep(c);
}

/** E+0xc4 0x10027c20 (SeaGrass): the reveal down the height, with the sway 0x18c4 and the offset 0x2234 */
export function seaGrass(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a8 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x12c;
    I[(0x2234 + l) >> 2] = -((I[(0x21a8 + l) >> 2] / 2) | 0) | 0;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2220 + l) >> 2] = 1;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0x64;
    F[(0x18bc + x) >> 2] = 4;
    F[(0x18c0 + x) >> 2] = 8;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x2234 + l) >> 2] = -((I[(0x21a8 + l) >> 2] / 4) | 0) | 0;
    I[(0x228c + l) >> 2] = 4;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    growIn(I, l, I[(0x21a8 + l) >> 2]);
    I[(0x2288 + l) >> 2] = 1;
    if (ftol(F[(0x18c4 + x) >> 2]) === 0) I[(0x18c4 + x) >> 2] = 0x3f4ccccd;     // 0.8f
    F[(0x18c4 + x) >> 2] = F[(0x18c4 + x) >> 2] + F0_2;
    I[(0x2234 + l) >> 2] = (I[(0x2234 + l) >> 2] + (-1 - ftol(I[(0x21a8 + l) >> 2] * 0.01))) | 0;
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > ftol(I[(0x21a8 + l) >> 2] * 1.2)) return leaveDone(I, l);
  } else if (s === 2) {
    shrinkOut(I, l);
    I[(0x18c4 + x) >> 2] = 0x4099999a;                                            // 4.8f, overwritten next
    F[(0x18c4 + x) >> 2] = ((I[(0x21fc + l) >> 2] - 0x32) | 0) * -0.02;
    I[(0x2234 + l) >> 2] = (I[(0x2234 + l) >> 2] + (1 - ftol(I[(0x21a8 + l) >> 2] * -0.01))) | 0;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x21fc + l) >> 2] = 0;
      F[(0x18c4 + x) >> 2] = 0;
      I[(0x2234 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** E+0xc8 0x100280f0 (Dematerialize): the level 0x2210 (256 = whole) and the grain 0x2290 */
export function dematerialize(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2210 + l) >> 2] = 0x100;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    F[(0x18bc + x) >> 2] = 4;
    F[(0x18c0 + x) >> 2] = 4;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x2234 + l) >> 2] = 0;
    I[(0x228c + l) >> 2] = 0x13;
    I[(0x2214 + l) >> 2] = 0x2bc;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2210 + l) >> 2] = (1 - ftol(I[(0x2210 + l) >> 2] * -1.3)) | 0;
    F[(0x18c4 + x) >> 2] = 1;
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] + 1) | 0;
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2210 + l) >> 2] > 0x100) return leaveDone(I, l);
  } else if (s === 2) {
    I[(0x2210 + l) >> 2] = ftol(I[(0x2210 + l) >> 2] * 0.8);
    I[(0x2290 + l) >> 2] = ftol(I[(0x2210 + l) >> 2] * 0.1);
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x2210 + l) >> 2] < 0x14) {
      I[(0x2210 + l) >> 2] = 0;
      F[(0x18c4 + x) >> 2] = 0;
      I[(0x2290 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** E+0xcc 0x100283f0 (WetGlass): Swipe down the height with the ripple 0x2290 */
export function wetGlass(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x2200 + l) >> 2] = I[(0x21a8 + l) >> 2];
    I[(0x21fc + l) >> 2] = 0x190;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    F[(0x18bc + x) >> 2] = 4;
    F[(0x18c0 + x) >> 2] = 4;
    F[(0x18d4 + x) >> 2] = 8;
    I[(0x2234 + l) >> 2] = 0;
    I[(0x228c + l) >> 2] = 0x13;
    I[(0x2208 + l) >> 2] = 0x11;
    I[(0x2220 + l) >> 2] = 1;
    I[(0x2200 + l) >> 2] = 1;
    I[(0x21fc + l) >> 2] = 0xd7;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    sweepIn(I, l, I[(0x21a8 + l) >> 2], -0.07);
    F[(0x18c4 + x) >> 2] = 1;
    I[(0x2290 + l) >> 2] = (I[(0x2290 + l) >> 2] + 1) | 0;
    I[(0x212c + l) >> 2] = 3;
    if (I[(0x2200 + l) >> 2] > I[(0x21a8 + l) >> 2]) return leaveDone(I, l);
  } else if (s === 2) {
    // no 0x212c write on this path
    I[(0x2200 + l) >> 2] = ftol(I[(0x2200 + l) >> 2] * 0.9090909090909091);
    I[(0x21fc + l) >> 2] = (I[(0x21fc + l) >> 2] - 0x18) | 0;
    I[(0x2290 + l) >> 2] = ftol(((I[(0x21fc + l) >> 2] - 0x32) | 0) * 0.05);
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (I[(0x21fc + l) >> 2] < 0x32) {
      I[(0x2210 + l) >> 2] = 0;          // 0x10028768: clears 0x2210, not 0x21fc
      F[(0x18c4 + x) >> 2] = 0;
      I[(0x2290 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** E+0xd0 0x100287c0 (SpotLight): the circle radius 0x1878 */
export function spotLight(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    I[(0x1878 + x) >> 2] = 0x41a00000;     // 20.0f
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    I[(0x2268 + l) >> 2] = 0;
    radius(I, F, l, x);
    I[(0x226c + l) >> 2] = 0x64;
    I[(0x2270 + l) >> 2] = 0xff;
    F[(0x1888 + x) >> 2] = -0.5;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2268 + l) >> 2] = 3;
    F[(0x1878 + x) >> 2] = F[(0x1878 + x) >> 2] * 0.9 - 7;
    I[(0x212c + l) >> 2] = 3;
    if (!(F[(0x1878 + x) >> 2] >= 10)) return leaveDone(I, l);      // TEST AH,1 / JZ
  } else if (s === 2) {
    I[(0x212c + l) >> 2] = 3;
    F[(0x1878 + x) >> 2] = F[(0x1878 + x) >> 2] * 0.3 + F[(0x1878 + x) >> 2] + 7;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    const w = I[(0x21a4 + l) >> 2], h = I[(0x21a8 + l) >> 2];
    I[0x694c >> 2] = w > h ? w : h;
    if (!(I[0x694c >> 2] * 0.9 >= F[(0x1878 + x) >> 2])) {      // TEST AH,1 / JZ
      I[(0x2268 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

/** SquareS / BullsEye / Variegate / Pattern: the shape scale 0x188c (arrival: from -1 up by 0.2 to past 2;
 *  departure: from 2, *0.9 - 0.2 to -1); the departure also sets one transform field `field` to the bits `bits` */
function shape(c: Core, field: number, bits: number, shadow: boolean): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    radius(I, F, l, x);
    I[(0x188c + x) >> 2] = 0xbf800000 | 0;   // -1.0f
    I[(0x2264 + l) >> 2] = 0x14;
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    radius(I, F, l, x);
    I[(0x2268 + l) >> 2] = 0;
    I[(0x226c + l) >> 2] = 0x64;
    I[(0x2270 + l) >> 2] = 0xff;
    I[(0x2264 + l) >> 2] = -0x14;
    F[(0x188c + x) >> 2] = 2;
    I[(field + x) >> 2] = bits;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2268 + l) >> 2] = 3;
    F[(0x188c + x) >> 2] = F[(0x188c + x) >> 2] * 0.9 - F0_2;
    I[(0x212c + l) >> 2] = 3;
    if (!(F[(0x188c + x) >> 2] > -1)) return leaveDone(I, l);       // TEST AH,0x41 / JZ
  } else if (s === 2) {
    I[(0x212c + l) >> 2] = 3;
    F[(0x188c + x) >> 2] = F[(0x188c + x) >> 2] + F0_2;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (F[(0x188c + x) >> 2] > 2) {                               // TEST AH,0x41 / JNZ
      I[(0x2268 + l) >> 2] = 0;
      return arriveDone(c, shadow);
    }
  }
  return 0;
}

/** E+0xd4 0x10028ac0 (SquareS) */
export function squareS(c: Core): number { return shape(c, 0x18a4, 0x3d75c28f, true); }      // 0.06f
/** E+0xd8 0x10028e60 (BullsEye) */
export function bullsEye(c: Core): number { return shape(c, 0x1898, 0x3d75c28f, true); }     // 0.06f
/** E+0xdc 0x10029200 (Variegate) */
export function variegate(c: Core): number { return shape(c, 0x18a4, 0x40000000, false); }   // 2.0f
/** E+0xe0 0x10029580 (Pattern) */
export function pattern(c: Core): number { return shape(c, 0x18a8, 0xbe0f5c29 | 0, false); } // -0.14f

/** E+0xe4 0x10029910 (Radial): the scale 0x189c (arrival: from 0.01, *1.5 to 0.5; departure: from 0.5,
 *  *0.7 to 0.01) */
export function radial(c: Core): number {
  let I = c.m.I, F = c.m.F;
  let l = lb(c), x = xb(c);
  if (I[0x608 >> 2] === 1) {
    I[0x608 >> 2] = 0;
    radius(I, F, l, x);
    I[(0x189c + x) >> 2] = 0x3c23d70a;     // 0.01f
    return arriveStart(I, l);
  }
  if (I[0x600 >> 2] === I[0x1838 >> 2]) {
    radius(I, F, l, x);
    I[(0x2268 + l) >> 2] = 0;
    I[(0x226c + l) >> 2] = 0x64;
    I[(0x2270 + l) >> 2] = 0xff;
    I[(0x2264 + l) >> 2] = -0x14;
    F[(0x188c + x) >> 2] = 2;
    F[(0x189c + x) >> 2] = 0.5;
    return leaveStart(I, l);
  }
  const s = I[0x69b0 >> 2];
  if (s === 1) {
    I[(0x2268 + l) >> 2] = 3;
    F[(0x189c + x) >> 2] = F[(0x189c + x) >> 2] * 0.7;
    I[(0x212c + l) >> 2] = 3;
    // both comparisons are evaluated (0x188c <= -1 via AH&0x41, 0x189c < 0.01f via AH&1), then OR'd
    if (!(F[(0x188c + x) >> 2] > -1) || !(F[(0x189c + x) >> 2] >= F0_01)) return leaveDone(I, l);
  } else if (s === 2) {
    I[(0x212c + l) >> 2] = 3;
    F[(0x189c + x) >> 2] = F[(0x189c + x) >> 2] * 1.5;
    vt(c, 0x154);
    I = c.m.I; F = c.m.F; l = lb(c); x = xb(c);
    if (F[(0x189c + x) >> 2] >= 0.5) {                            // TEST AH,1 / JNZ
      I[(0x2268 + l) >> 2] = 0;
      return arriveDone(c, false);
    }
  }
  return 0;
}

def({
  0xa4: toaster, 0xa8: swipe, 0xac: rotate, 0xb0: spin, 0xb4: curtains, 0xb8: undulation, 0xbc: flourish,
  0xc0: disperse, 0xc4: seaGrass, 0xc8: dematerialize, 0xcc: wetGlass, 0xd0: spotLight, 0xd4: squareS,
  0xd8: bullsEye, 0xdc: variegate, 0xe0: pattern, 0xe4: radial,
});
