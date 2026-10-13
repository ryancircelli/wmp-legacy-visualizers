// Picture Viz 3D's basic transitions (ids 6..14: Transparency, Zoom, Store, Spiral, Spin, Turn, Flip, Stack'm,
// Slide), vt+0x8c..0xac. Each is a small state machine on obj+0x3166c (1 = the picture arrives, 2 = it leaves),
// timed by 0x256c (ms since the change) against 0x2574 / 0x2570, easing through the cosine table (obj+0x30274) and
// moving the floor (the camera / object fields the frame's matrices are built from). Pop (id 5) is in scene.ts.
import { type Core, def, vt } from './core';
import { fr, ftol } from '../pv2/mem';

const COS = 0x30274 >> 2;

/** the first two branches every basic transition shares: the flag 0x259c hands over to state 2; the interval's
 *  end starts state 1. Returns true when it handled the frame. `onStart` runs after state 1 is set. */
function enter(c: Core, leave?: () => void, arrive?: () => void): boolean {
  const I = c.m.I;
  if (I[0x259c >> 2] === 1) {
    I[0x259c >> 2] = 0; I[0x3166c >> 2] = 2;
    if (leave) leave();
    return true;
  }
  if (I[0x2590 >> 2] === I[0x36f4 >> 2]) {
    I[(I[0x1ca4 >> 2] * 0xe0 + 0x164) >> 2] = 0;
    I[0x3166c >> 2] = 1; I[0x256c >> 2] = 0;
    if (arrive) arrive();
    return true;
  }
  return false;
}
/** ms since the change over the duration at `d`, as FILD qword / FIDIV dword leave it on the FPU */
const progress = (c: Core, d: number): number => (c.m.I[0x256c >> 2] >>> 0) / c.m.I[d >> 2];
/** the current sprite's fade (transform record +0xb8) */
const fadeAt = (c: Core): number => (c.m.I[0x1ca4 >> 2] * 0xe0 + 0x164) >> 2;
/** (cos(index) + 1) * 255 as float */
const ease = (c: Core, idx: number): number => fr((c.m.F[COS + idx] + 1) * 255);

/** vt+0x8c 0x10036e60: Transparency: the picture fades in and out (state 2 eases from 100 degrees) */
function transparency(c: Core): number {
  if (enter(c)) return 0;
  const I = c.m.I, F = c.m.F, s = I[0x1ca4 >> 2] * 0x1ec;
  if (I[0x3166c >> 2] === 1) {
    F[fadeAt(c)] = ease(c, ftol(progress(c, 0x2574) * 90 + 180));
    if (ftol(F[fadeAt(c)]) > 0xf5) {
      I[fadeAt(c)] = 0x437f0000;
      I[0x3166c >> 2] = 0; I[(0xb10 + s) >> 2] = -1; I[0x25c8 >> 2] = 0;
      vt(c, 0x140);
    }
  } else if (I[0x3166c >> 2] === 2) {
    I[(0xb10 + s) >> 2] = 0;
    F[fadeAt(c)] = ease(c, ftol(progress(c, 0x2574) * 90 + 100));
    if (ftol(F[fadeAt(c)]) < 10) {
      I[fadeAt(c)] = 0;
      I[0x31228 >> 2] = 0;
      vt(c, 0x84);
      c.m.I[0x3166c >> 2] = 0;
      vt(c, 0x108);
      vt(c, 0x140);
    }
  }
  return 0;
}

/** vt+0x90 0x100370a0: Zoom: fades in while the camera (0x1ed8) closes in by t^3 * 250; leaves backwards by
 *  (1 - t)^4 * 255 */
function zoom(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    const tf = F[0x31534 >> 2];
    F[0x1ed8 >> 2] = F[0x1ed8 >> 2] - tf * tf * tf * 250;
    if (F[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
    const v = 1 - c.m.F[0x31534 >> 2];
    c.m.F[0x1ed8 >> 2] = c.m.F[0x1ed8 >> 2] - v * v * v * v * 255;
  }
  return 0;
}

/** state 2's end for the zooming ones: rest, the next picture's scene (and the floor again when 0x25e4) */
function leaveEnd(c: Core): void {
  const I = c.m.I;
  I[fadeAt(c)] = 0;
  I[0x31228 >> 2] = 0; I[0x3166c >> 2] = 0;
  vt(c, 0x84);
  vt(c, 0x108);
  if (c.m.I[0x25e4 >> 2] === 1) vt(c, 0x140);
}
/** state 1's end: fully shown, the sprite bound to the floor (0xb10 = -1) */
function arriveEnd(c: Core): void {
  const I = c.m.I;
  I[fadeAt(c)] = 0x437f0000;
  I[0x3166c >> 2] = 0; I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = -1; I[0x25c8 >> 2] = 0;
}
const leaveStart = (c: Core): void => { c.m.I[0x4e4 >> 2] = 0; vt(c, 0x140); };
const arriveStart = (c: Core): void => { if (c.m.I[0x25e4 >> 2] === 1) vt(c, 0x140); };

/** vt+0x94 0x10037370: Store: Zoom with the floor tilted (0x1f28 = cos * 1.6) as it comes, the camera by
 *  x^2 * t * 50 with x the tilt; leaves tilting back ((cos + 1) * -1.6) and receding by (1 - t)^4 * 155 */
function store(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    const x = G[COS - ftol((t2 + 1) * -90)] * 1.6;
    G[0x1f28 >> 2] = x;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - x * x * t2 * 50;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
    const G = c.m.F, tf = G[0x31534 >> 2];
    G[0x1f28 >> 2] = (G[COS - ftol((tf + 1) * -90)] + 1) * -1.6;
    const v = 1 - tf;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - v * v * v * v * 155;
  }
  return 0;
}

/** vt+0x98 0x100376c0: Spiral: Store with a second angle (0x1f24 = x^2 * cos * 4) and the camera by
 *  y^2 * t * 20; leaves with both angles (cos + 1) * -1.5, fading from 100 degrees */
function spiral(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    const cs = G[COS - ftol((t2 + 1) * -90)];
    const x = cs * 1.6;
    G[0x1f28 >> 2] = x;
    const y = x * x * cs * 4;
    G[0x1f24 >> 2] = y;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - y * y * t2 * 20;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 100));
    vt(c, 0x108);
    const G = c.m.F, tf = G[0x31534 >> 2];
    const cs = G[COS - ftol((tf + 1) * -90)];
    G[0x1f28 >> 2] = (cs + 1) * -1.5;
    G[0x1f24 >> 2] = (cs + 1) * -1.5;
    const v = 1 - tf;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - v * v * v * v * 155;
  }
  return 0;
}

/** vt+0x9c 0x10037a40: Spin: the floor turns in (0x1f24 = cos * 3) with the camera by x^3 * t * -250; leaves
 *  turning ((cos + 1) * -3) and receding by (cos + 1) * a^2 * 155 */
function spin(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    const x = G[COS - ftol((t2 + 1) * -90)] * 3;
    G[0x1f24 >> 2] = x;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - x * x * x * t2 * -250;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
    const G = c.m.F, tf = G[0x31534 >> 2];
    const cs = G[COS - ftol((tf + 1) * -90)];
    const a = (cs + 1) * -3;
    G[0x1f24 >> 2] = a;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - (cs + 1) * a * a * 155;
  }
  return 0;
}

/** Turn (vt+0xa0 0x10037d90, angle 0x1f2c) and Flip (vt+0xa4 0x100380a0, angle 0x1f28): the floor swings in
 *  (cos * 1.6) and out ((cos + 1) * 1.6) about one axis, the camera still */
function swing(c: Core, angle: number): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    G[angle >> 2] = G[COS - ftol((t2 + 1) * -90)] * 1.6;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
    const G = c.m.F, tf = G[0x31534 >> 2];
    G[angle >> 2] = (G[COS - ftol((tf + 1) * -90)] + 1) * 1.6;
  }
  return 0;
}

/** vt+0xa8 0x100383b0: Stack'm: three angles (cos * 1.3, * -1.5, * -1.6) and the camera by t * angle2 * 50 as
 *  it comes; it leaves by fading ((1 - t)^4 * 255) without moving */
function stackm(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    const cs = G[COS - ftol((t2 + 1) * -90)];
    G[0x1f28 >> 2] = cs * 1.3; G[0x1f2c >> 2] = cs * -1.5; G[0x1f24 >> 2] = cs * -1.6;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - t2 * G[0x1f2c >> 2] * 50;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    F[0x31534 >> 2] = progress(c, 0x2574);
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    if (F[0x31534 >> 2] >= 1) {
      I[fadeAt(c)] = 0;
      I[0x31228 >> 2] = 0; I[0x3166c >> 2] = 0;
      vt(c, 0x84);
      arriveStart(c);
      return 0;
    }
    const v = 1 - F[0x31534 >> 2];
    F[fadeAt(c)] = v * v * v * v * 255;
    vt(c, 0x108);
  }
  return 0;
}

/** vt+0xac 0x100386a0: Slide: the floor slides in on one angle (cos * -1.6, the camera by angle * t * 60) and
 *  leaves on two ((cos + 1) * -1.5 and * -1.6) receding by (1 - t)^4 * 155 */
function slide(c: Core): number {
  if (enter(c, () => leaveStart(c), () => arriveStart(c))) return 0;
  const I = c.m.I, F = c.m.F;
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[fadeAt(c)] = ease(c, ftol(t * 90 + 180));
    vt(c, 0x108);
    const t2 = progress(c, 0x2574), G = c.m.F;
    const x = G[COS - ftol((t2 + 1) * -90)] * -1.6;
    G[0x1f2c >> 2] = x;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - x * t2 * 60;
    if (G[0x31534 >> 2] >= 1) arriveEnd(c);
  } else if (st === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) { leaveEnd(c); return 0; }
    F[fadeAt(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
    const G = c.m.F, tf = G[0x31534 >> 2];
    const cs = G[COS - ftol((tf + 1) * -90)];
    G[0x1f28 >> 2] = (cs + 1) * -1.5;
    G[0x1f24 >> 2] = (cs + 1) * -1.6;
    const v = 1 - tf;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - v * v * v * v * 155;
  }
  return 0;
}

def({ 0xac: slide, 0xa8: stackm, 0x8c: transparency, 0x90: zoom, 0x94: store, 0x98: spiral, 0x9c: spin, 0xa0: (c) => swing(c, 0x1f2c),
  0xa4: (c) => swing(c, 0x1f28) });
