// Picture Viz 3D's other liquid transitions (ids 21..30, vt+0xc8..0xec: Wisp on water, Plunk, Flower, Spatter,
// Burst, Blast-off, Electric, Crossing, Sundrops, Volcanic): the picture fades in and out (state 1 / 2 on
// obj+0x3166c, as in txliquid.ts) while the water is struck along a path, in rings from the centre, at random spots,
// or the camera (0x1ed8, the angles 0x1f24..0x1f2c) and the particle fountain (0x1f1c.., 0x2deec) move with it.
// The grid is CWater's (64 x 64 cells of [height, velocity] floats at the block obj+0x373c points to); the
// transition's own numbers live in the current sprite's transform record (0xe0 bytes from obj+0xac: +0x00..+0x0c
// the wisp's step and position, +0x68 the ring strength, +0xb8 the fade).
import { A } from '../../ns';
import '../../rand';
import { type Core, def, vt, lb, xb } from './core';
import { fr, ftol } from '../pv2/mem';
import { f100073f0 } from './frame';

const COS = 0x30274 >> 2;
const rand = (): number => A.rand();
/** x87 FCOM "below" (C0): a < b, or unordered */
const lt = (a: number, b: number): boolean => !(a >= b);

/** float index of field `o` (its offset as sprite 0 has it, 0xac..0x18c) of the current sprite's transform record */
const tr = (c: Core, o: number): number => (xb(c) + o) >> 2;
/** the current sprite's fade (transform record +0xb8) */
const fade = (c: Core): number => tr(c, 0x164);
/** the current sprite record's 0xb10 (-1: bound to the floor) */
const b10 = (c: Core): number => (lb(c) + 0xb10) >> 2;
/** ms since the change over the duration at `d` (FILD qword of the unsigned ms / FIDIV dword) */
const progress = (c: Core, d: number): number => (c.m.I[0x256c >> 2] >>> 0) / c.m.I[d >> 2];
/** (cos(index) + 1) * 255 as float */
const ease = (c: Core, idx: number): number => fr((c.m.F[COS + idx] + 1) * 255);
/** cos of -ftol((t + 1) * -90), the easing the leaving halves use */
const cosBack = (c: Core, t: number): number => c.m.F[COS - ftol((t + 1) * -90)];

/** float index of cell i's height (o = 0) or velocity (o = 4) */
const cell = (c: Core, i: number, o: number): number => (c.m.I[0x373c >> 2] + i * 8 + o) >> 2;
const sub = (c: Core, i: number, o: number, d: number): void => { const k = cell(c, i, o); c.m.F[k] = c.m.F[k] - d; };

/** the flag 0x259c hands over to state 2 (Sundrops and Volcanic also restart the fountain, 0x2deec) */
function handoff(c: Core, fountain = false): boolean {
  const I = c.m.I;
  if (I[0x259c >> 2] !== 1) return false;
  I[0x259c >> 2] = 0; I[0x3166c >> 2] = 2;
  if (fountain) I[0x2deec >> 2] = 1;
  return true;
}
const arrived = (c: Core): boolean => c.m.I[0x2590 >> 2] === c.m.I[0x36f4 >> 2];
/** state 1 starts: faded out, the clock at 0 */
function start(c: Core): void {
  const I = c.m.I;
  I[fade(c)] = 0; I[0x3166c >> 2] = 1; I[0x256c >> 2] = 0;
}
/** state 1's end: fully shown, the sprite bound to the floor */
function shown(c: Core): void {
  const I = c.m.I;
  I[fade(c)] = 0x437f0000;
  I[0x3166c >> 2] = 0; I[b10(c)] = -1; I[0x25c8 >> 2] = 0;
}
/** the fade in: ease(t * 90 + 180) with t over 0x2574; returns t */
function fadeIn(c: Core): number {
  const t = progress(c, 0x2574);
  c.m.F[fade(c)] = ease(c, ftol(t * 90 + 180));
  return t;
}

/** one ring around (x, y) on the grid's `o` field: -a at the cell, -b on its four sides, -d on the diagonals */
function ring(c: Core, o: number, x: number, y: number, a: number, b: number, d: number): void {
  const xc = x & 0x3f, row = (y & 0x3f) << 6, l = (x - 1) & 0x3f, r = (x + 1) & 0x3f;
  const u = ((y << 6) - 0x40) & 0xfc0, dn = ((y + 1) << 6) & 0xfc0;
  sub(c, xc | row, o, a); sub(c, l | row, o, b); sub(c, r | row, o, b); sub(c, u | xc, o, b); sub(c, dn | xc, o, b);
  sub(c, u | l, o, d); sub(c, dn | r, o, d); sub(c, u | r, o, d); sub(c, dn | l, o, d);
}

/** 0x10007170: the wisp's ring at (0x313e8, 0x313f0) on the velocities: -0.5 / -0.125 / -0.0625 */
export function f10007170(c: Core): number {
  ring(c, 4, c.m.I[0x313e8 >> 2], c.m.I[0x313f0 >> 2], 0.5, 0.125, 0.0625);
  return 0;
}
/** 0x100072b0: Plunk's stone near the centre (30..33 each way) on the heights: -12.04 / -6.02 / -3.01 */
export function f100072b0(c: Core): number {
  const x = (rand() & 3) + 0x1e, y = (rand() & 3) + 0x1e;
  ring(c, 0, x, y, fr(12.04), fr(6.02), fr(3.01));
  return 0;
}
/** 0x10006780: the centre cell (32, 32) and 27 rings' corners and sides (the 8 directions, 1..27 cells out) lowered
 *  by the ring strength (transform +0x68, kept in 0x31120; the counter in 0x3103c) */
export function f10006780(c: Core): number {
  const I = c.m.I, F = c.m.F;
  const L = F[tr(c, 0x114)];
  F[0x31120 >> 2] = L;
  sub(c, 0x820, 0, L);
  for (I[0x3103c >> 2] = 1; I[0x3103c >> 2] < 0x1c; I[0x3103c >> 2]++) {
    const i = I[0x3103c >> 2], d = F[0x31120 >> 2], lo = -0x20 - i, hi = i - 0x20, a = 0x20 - i, b = i + 0x20;
    sub(c, (lo & 0x3f) | 0x800, 0, d);
    sub(c, (hi & 0x3f) | 0x800, 0, d);
    sub(c, ((lo << 6) & 0xfc0) | 0x20, 0, d);
    sub(c, ((hi << 6) & 0xfc0) | 0x20, 0, d);
    sub(c, ((a << 6) & 0xfc0) | (a & 0x3f), 0, d);
    sub(c, ((b << 6) & 0xfc0) | (b & 0x3f), 0, d);
    sub(c, ((lo << 6) & 0xfc0) | (hi & 0x3f), 0, d);
    sub(c, ((hi << 6) & 0xfc0) | (lo & 0x3f), 0, d);
  }
  return 0;
}
/** 0x10006940: the centre cell lowered by the strength, then 9 random spots each with its 8 neighbours i cells
 *  out (i = 1..9) lowered the same */
export function f10006940(c: Core): number {
  const I = c.m.I, F = c.m.F;
  const L = F[tr(c, 0x114)];
  F[0x31120 >> 2] = L;
  sub(c, 0x820, 0, L);
  for (I[0x3103c >> 2] = 1; I[0x3103c >> 2] < 10; I[0x3103c >> 2]++) {
    const a = rand(), b = rand(), i = I[0x3103c >> 2], d = F[0x31120 >> 2];
    const row = (b & 0x3f) << 6, col = a & 0x3f, l = (a - i) & 0x3f, r = (a + i) & 0x3f;
    const u = ((b - i) << 6) & 0xfc0, dn = ((b + i) << 6) & 0xfc0;
    sub(c, row | l, 0, d); sub(c, row | r, 0, d); sub(c, u | col, 0, d); sub(c, dn | col, 0, d);
    sub(c, u | l, 0, d); sub(c, dn | r, 0, d); sub(c, u | r, 0, d); sub(c, dn | l, 0, d);
  }
  return 0;
}
/** 0x10006b10: the centre's height set to the strength and its 8 neighbours' velocities to 0.9 of it, then one
 *  random spot: its sides lowered by a tenth of it and its corners by a hundredth (0x31120 ends at the hundredth) */
export function f10006b10(c: Core): number {
  const I = c.m.I, F = c.m.F, p = I[0x373c >> 2];
  const L = F[tr(c, 0x114)];
  F[0x31120 >> 2] = L;
  F[(p + 0x4100) >> 2] = L;
  for (const o of [0x40fc, 0x410c, 0x3f04, 0x4304, 0x3efc, 0x430c, 0x3f0c, 0x42fc]) F[(p + o) >> 2] = F[0x31120 >> 2] * fr(0.9);
  for (I[0x3103c >> 2] = 1; I[0x3103c >> 2] < 2; I[0x3103c >> 2]++) {
    const a = rand(), b = rand(), i = I[0x3103c >> 2];
    const row = (b & 0x3f) << 6, col = a & 0x3f, l = (a - i) & 0x3f, r = (a + i) & 0x3f;
    const u = ((b - i) << 6) & 0xfc0, dn = ((b + i) << 6) & 0xfc0;
    let q = F[0x31120 >> 2] * fr(0.1);       // FST float keeps the product on the stack for the first cell
    F[0x31120 >> 2] = q;
    sub(c, row | l, 0, q); sub(c, row | r, 0, F[0x31120 >> 2]);
    sub(c, u | col, 0, F[0x31120 >> 2]); sub(c, dn | col, 0, F[0x31120 >> 2]);
    q = F[0x31120 >> 2] * fr(0.1);
    F[0x31120 >> 2] = q;
    sub(c, u | l, 0, q); sub(c, dn | r, 0, F[0x31120 >> 2]);
    sub(c, u | r, 0, F[0x31120 >> 2]); sub(c, dn | l, 0, F[0x31120 >> 2]);
  }
  return 0;
}
/** 0x10006db0: one random spot (16..47 each way): its height set to the strength (a dword copy), its 8 neighbours'
 *  velocities to 0.9 of it */
export function f10006db0(c: Core): number {
  const I = c.m.I, F = c.m.F;
  I[0x31120 >> 2] = I[tr(c, 0x114)];
  for (I[0x3103c >> 2] = 1; I[0x3103c >> 2] < 2; I[0x3103c >> 2]++) {
    const x = (rand() & 0x1f) + 0x10, y = (rand() & 0x1f) + 0x10;
    const xc = x & 0x3f, row = (y & 0x3f) << 6, l = (x - 1) & 0x3f, r = (x + 1) & 0x3f;
    const u = ((y << 6) - 0x40) & 0xfc0, dn = ((y + 1) << 6) & 0xfc0;
    I[cell(c, xc | row, 0)] = I[0x31120 >> 2];
    for (const k of [l | row, r | row, u | xc, dn | xc, u | l, dn | r, u | r, dn | l]) F[cell(c, k, 4)] = F[0x31120 >> 2] * fr(0.9);
  }
  return 0;
}
/** 0x10007410: the water calms: every height and velocity times 1 - t^3 (t = 0x31534), once the device exists */
export function f10007410(c: Core): number {
  const I = c.m.I;
  if (I[0x37b0 >> 2] === 0 || I[0x37ac >> 2] === 0) return 0;
  const F = c.m.F;
  for (let n = 0, p = I[0x373c >> 2] >> 2; n < 0x1000; n++, p += 2) {
    let t = F[0x31534 >> 2];
    F[p + 1] = (1 - t * t * t) * F[p + 1];
    t = F[0x31534 >> 2];
    F[p] = (1 - t * t * t) * F[p];
  }
  return 0;
}

/** Wisp on water (vt+0xc8 0x10039760) and Crossing (vt+0xe4 0x1003aef0): a point starts at one edge (x = 0 or 64
 *  stepping +-3, y random) and drifts across, ringing the water where it passes (0x10007170); Crossing rings its
 *  mirror image too, tilts the fountain (0x1f18, 0x1f20) for the first two thirds and ends on t >= 1, Wisp on the
 *  fade */
function wisp(c: Core, cross: boolean): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    I[fade(c)] = 0; I[0x3166c >> 2] = 1; I[0x256c >> 2] = 10;
    I[(lb(c) + 0x9d0) >> 2] = 0;
    I[tr(c, 0xb4)] = 0; I[tr(c, 0xb8)] = 0; F[tr(c, 0xac)] = 3; I[tr(c, 0xb0)] = 0;
    const r = rand() & 1;
    I[0x3160c >> 2] = r;
    if (r === 0) F[tr(c, 0xac)] = 3;
    else { F[tr(c, 0xac)] = -3; F[tr(c, 0xb4)] = 64; }
    F[tr(c, 0xb8)] = rand() & 0x3f;
    const k = 0x20 - ftol(F[tr(c, 0xb8)]);
    I[0x3160c >> 2] = k;
    F[0x31478 >> 2] = k * 0.015625;
    F[tr(c, 0xb0)] = k * fr(0.1);
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    if (cross) F[0x31534 >> 2] = t;
    F[fade(c)] = ease(c, ftol(t * 90 + 180));
    F[tr(c, 0xb4)] = F[tr(c, 0xac)] + F[tr(c, 0xb4)];
    F[tr(c, 0xb8)] = F[tr(c, 0xb0)] + F[tr(c, 0xb8)];
    I[0x313e8 >> 2] = ftol(F[tr(c, 0xb4)]);
    I[0x313f0 >> 2] = ftol(F[tr(c, 0xb8)]);
    const inside = (): boolean => {
      const x = I[0x313e8 >> 2], y = I[0x313f0 >> 2];
      return x < 0x40 && x > 0 && y < 0x40 && y > 0;
    };
    if (cross) F[0x3728 >> 2] = 160;
    if (inside()) f10007170(c);
    if (cross) {
      I[0x313e8 >> 2] = 0x40 - I[0x313e8 >> 2];
      if (inside()) f10007170(c);
      if (lt(F[0x31534 >> 2], fr(0.67))) {
        F[0x1f20 >> 2] = F[0x1f20 >> 2] - fr(0.2);
        F[0x1f18 >> 2] = F[0x1f18 >> 2] - fr(0.075);
      }
      if (lt(F[0x31534 >> 2], 1)) return 0;
    } else if (ftol(F[fade(c)]) < 0xff) return 0;
    shown(c);
  } else if (st === 2) {
    I[b10(c)] = 0;
    F[fade(c)] = ease(c, ftol(progress(c, 0x2574) * 90 + 100));
    if (ftol(F[fade(c)]) >= 10) return 0;
    I[fade(c)] = 0;
    I[0x31228 >> 2] = 0;
    vt(c, 0x84);
    c.m.I[0x3166c >> 2] = 0;
  } else return 0;
  f100073f0(c);
  vt(c, 0x108);
  return 0;
}

/** vt+0xcc 0x10039bb0: Plunk: a stone near the centre (0x100072b0) when the picture arrives; the floor tilts
 *  (0x1f28 = cos(t * 35 + 90) * 5, no lower than -1.3) and the camera closes in by t * 10; it leaves over 0x2570 */
function plunk(c: Core): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F, st = I[0x3166c >> 2];
  if (arrived(c) && st !== 1) { start(c); f100072b0(c); return 0; }
  if (st === 1) {
    F[0x31534 >> 2] = fadeIn(c);
    vt(c, 0x108);
    const G = c.m.F;
    const a = G[COS + ftol(G[0x31534 >> 2] * 35 + 90)] * 5;
    G[0x1f28 >> 2] = a;
    if (lt(a, -1.3)) c.m.I[0x1f28 >> 2] = 0xbfa66666 | 0;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - progress(c, 0x2574) * 10;
    if (ftol(G[fade(c)]) < 0xff) return 0;
    shown(c);
    f100073f0(c);
    vt(c, 0x108);
  } else if (st === 2) {
    I[b10(c)] = 0;
    F[fade(c)] = ease(c, ftol(progress(c, 0x2570) * 90 + 100));
    if (ftol(F[fade(c)]) >= 10) return 0;
    I[fade(c)] = 0;
    I[0x31228 >> 2] = 0; I[0x3166c >> 2] = 0;
    vt(c, 0x84);
    vt(c, 0x108);
  }
  return 0;
}

/** vt+0xd0 0x10039e80: Flower: rings from the centre (0x10006780) growing by 1.07 every frame from 2, the water
 *  calmed by 1 - 0.7^3 each frame (0x10007410) */
function flower(c: Core): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    I[fade(c)] = 0; F[tr(c, 0x114)] = 2; I[0x3166c >> 2] = 1; I[0x256c >> 2] = 0;
    f100073f0(c);
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    F[0x31534 >> 2] = fadeIn(c);
    vt(c, 0x108);
    const J = c.m.I, G = c.m.F;
    J[0x1ecc >> 2] = 0xff;
    if (G[0x31534 >> 2] >= 1) {
      J[fade(c)] = 0x437f0000;
      J[0x3166c >> 2] = 0; J[tr(c, 0x114)] = 0; J[b10(c)] = -1; J[0x25c8 >> 2] = 0;
      f100073f0(c);
    }
    J[0x3160c >> 2] = ftol(G[tr(c, 0x114)]);
    G[tr(c, 0x114)] = G[tr(c, 0x114)] * fr(1.07);
    f10006780(c);
    J[0x31534 >> 2] = 0x3f333333;            // 0.7
    f10007410(c);
  } else if (st === 2) {
    I[b10(c)] = 0;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    if (t >= 1) {
      I[fade(c)] = 0;
      I[0x31228 >> 2] = 0; I[0x3166c >> 2] = 0; I[tr(c, 0x114)] = 0; I[0x1ecc >> 2] = 0x40;
      vt(c, 0x84);
      vt(c, 0x108);
      return 0;
    }
    F[fade(c)] = ease(c, -ftol((t + 1) * -90));
    vt(c, 0x108);
  }
  return 0;
}

/** Spatter / Burst / Blast-off / Electric leaving: the fade back over 0x2574 (Electric's from the unrounded t and
 *  without calming the water), then rest; the last two swing the floor back (0x1f28) and recede by
 *  (1 - t)^4 * 155 and redo the floor texture (vt+0x140) when 0x25e4 */
function leave(c: Core, kind: 'spatter' | 'blast' | 'electric'): number {
  const I = c.m.I;
  const F = c.m.F;
  I[b10(c)] = 0;
  if (kind !== 'spatter') F[0x3728 >> 2] = 10;
  const t = progress(c, 0x2574);
  F[0x31534 >> 2] = t;
  if (kind !== 'electric') f10007410(c);
  const tt = kind === 'electric' ? t : F[0x31534 >> 2];
  if (tt >= 1) {
    I[fade(c)] = 0;
    if (kind === 'spatter') I[0x1ecc >> 2] = 0x40;
    I[0x31228 >> 2] = 0; I[0x3166c >> 2] = 0; I[tr(c, 0x114)] = 0;
    f100073f0(c);
    vt(c, 0x84);
    vt(c, 0x108);
    if (kind !== 'spatter' && c.m.I[0x25e4 >> 2] === 1) vt(c, 0x140);
    return 0;
  }
  F[fade(c)] = ease(c, -ftol((tt + 1) * -90));
  vt(c, 0x108);
  if (kind === 'spatter') return 0;
  const G = c.m.F, tf = G[0x31534 >> 2];
  G[0x1f28 >> 2] = (cosBack(c, tf) + 1) * -1.5;
  const v = 1 - tf;
  G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - v * v * v * v * 155;
  return 0;
}

/** Spatter (vt+0xd4 0x1003a190) and Burst (vt+0xd8 0x1003a4a0): random ring bursts (0x10006940) every frame;
 *  Spatter's strength (from 1.4) grows by 1.09 for the first fifth (the water's depth 0x3728 = 60) and it ends on
 *  t >= 1; Burst's stays 12 and it ends on the fade. Grind's and T3's Spatter: from `start` 0.5, growing by `grow` 1.13 */
export function spatter(c: Core, burst: boolean, start = fr(1.4), grow = fr(1.09)): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    I[fade(c)] = 0; F[tr(c, 0x114)] = burst ? 12 : start; I[0x256c >> 2] = 0; I[0x3166c >> 2] = 1;
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    const t = progress(c, 0x2574);
    if (!burst) F[0x31534 >> 2] = t;
    F[fade(c)] = ease(c, ftol(t * 90 + 180));
    I[0x1ecc >> 2] = 0xff;
    vt(c, 0x108);
    const J = c.m.I, G = c.m.F;
    if (burst) {
      J[0x3160c >> 2] = ftol(G[tr(c, 0x114)]);
      f10006940(c);
      if (ftol(G[fade(c)]) <= 0xf5) return 0;
    } else {
      if (lt(G[0x31534 >> 2], fr(0.2))) {
        G[0x3728 >> 2] = 60;
        J[0x3160c >> 2] = ftol(G[tr(c, 0x114)]);
        G[tr(c, 0x114)] = G[tr(c, 0x114)] * grow;
        f10006940(c);
      }
      if (lt(G[0x31534 >> 2], 1)) return 0;
    }
    shown(c);
  } else if (st === 2) leave(c, 'spatter');
  return 0;
}

/** vt+0xdc 0x1003a770: Blast-off: a jet from the centre (0x10006b10, strength from 2 growing by 1.08) under a
 *  deep pool (0x3728 = 31), the floor tilting (0x1f28 = cos * 1.5). `spark`: Grind's and T3's jet (0x100070f0) */
export function blastOff(c: Core, spark: (c: Core) => number = f10006b10): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    I[fade(c)] = 0; F[tr(c, 0x114)] = 2; I[0x256c >> 2] = 0; I[0x3166c >> 2] = 1;
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    fadeIn(c);
    I[0x1ecc >> 2] = 0x80;
    vt(c, 0x108);
    const J = c.m.I, G = c.m.F;
    G[0x3728 >> 2] = 31;
    J[0x3160c >> 2] = ftol(G[tr(c, 0x114)]);
    G[tr(c, 0x114)] = G[tr(c, 0x114)] * fr(1.08);
    spark(c);
    G[0x1f28 >> 2] = cosBack(c, progress(c, 0x2574)) * 1.5;
    if (ftol(G[fade(c)]) <= 0xf5) return 0;
    J[fade(c)] = 0x437f0000;
    J[0x1ecc >> 2] = 0x40;
    J[0x3166c >> 2] = 0; J[b10(c)] = -1; J[0x25c8 >> 2] = 0;
    f100073f0(c);
  } else if (st === 2) leave(c, 'blast');
  return 0;
}

/** vt+0xe0 0x1003ab40: Electric: a random spark (0x10006db0, strength from 4 growing by 1.035), the floor turning
 *  (0x1f2c = cos * 1.6) and the camera closing in by t * 50 */
function electric(c: Core): number {
  if (handoff(c)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    I[fade(c)] = 0; F[tr(c, 0x114)] = 4; I[0x256c >> 2] = 0; I[0x3166c >> 2] = 1;
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    I[0x1ecc >> 2] = 0xff;
    F[0x31534 >> 2] = fadeIn(c);
    vt(c, 0x108);
    const J = c.m.I, G = c.m.F;
    G[0x3728 >> 2] = 10;
    J[0x3160c >> 2] = ftol(G[tr(c, 0x114)]);
    G[tr(c, 0x114)] = G[tr(c, 0x114)] * fr(1.035);
    f10006db0(c);
    G[0x1f2c >> 2] = cosBack(c, G[0x31534 >> 2]) * 1.6;
    G[0x1ed8 >> 2] = G[0x1ed8 >> 2] - G[0x31534 >> 2] * 50;
    if (ftol(G[fade(c)]) <= 0xf5) return 0;
    J[fade(c)] = 0x437f0000;
    J[0x1ecc >> 2] = 0x40;
    J[0x3166c >> 2] = 0; J[b10(c)] = -1; J[0x25c8 >> 2] = 0;
    f100073f0(c);
  } else if (st === 2) leave(c, 'electric');
  return 0;
}

/** Sundrops / Volcanic leaving: the fade from 100 degrees over 0x2574 while t runs over 0x2570 */
function leaveFountain(c: Core): void {
  const I = c.m.I, F = c.m.F;
  F[0x31534 >> 2] = progress(c, 0x2570);
  I[b10(c)] = 0;
  F[fade(c)] = ease(c, ftol(progress(c, 0x2574) * 90 + 100));
  F[0x3728 >> 2] = 10;
  vt(c, 0x108);
  if (lt(c.m.F[0x31534 >> 2], 1)) return;
  c.m.I[0x31228 >> 2] = 0;
  vt(c, 0x84);
  c.m.I[0x3166c >> 2] = 0;
  vt(c, 0x108);
}
/** state 1's end for Sundrops / Volcanic: shown, the water cleared and the fountain reset (vt+0x190) */
function shownFountain(c: Core): void {
  const I = c.m.I;
  I[fade(c)] = 0x437f0000;
  I[0x1ecc >> 2] = 0x40;
  I[0x3166c >> 2] = 0; I[b10(c)] = -1; I[0x25c8 >> 2] = 0;
}

/** the fountain's parameters both fountain transitions start from (0x1f84.. its colour, 0x1f94 gravity, ...) */
function fountain(c: Core): void {
  const I = c.m.I;
  I[0x1fa8 >> 2] = 1;
  I[0x1f84 >> 2] = 0; I[0x1f88 >> 2] = 0; I[0x1f8c >> 2] = 0; I[0x1f90 >> 2] = 0x3dcccccd;   // 0.1
  I[0x1fc4 >> 2] = 0; I[0x1f20 >> 2] = 0;
  I[0x1f94 >> 2] = 0xc0a00000 | 0;           // -5
  I[0x1fa4 >> 2] = 2;
}

/** vt+0xe8 0x1003b3d0: Sundrops: rings from the centre (strength from 5 growing by 1.1) with the particle
 *  fountain rising (0x1f1c falls by 1 a frame, by 1.24x after 0.3; 0x1f20 grows after 0.8; 0x1f70 stops at 0.4) */
function sundrops(c: Core): number {
  if (handoff(c, true)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    start(c);
    F[tr(c, 0x114)] = 5;
    fountain(c);
    I[0x1f70 >> 2] = 0x32;
    I[0x1f98 >> 2] = 0x3ee66666;              // 0.45
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    I[0x1ecc >> 2] = 0xff;
    I[0x1f48 >> 2] = 1000;
    F[0x3728 >> 2] = 31;
    I[0x31120 >> 2] = 0x3f8ccccd;             // 1.1
    F[0x31534 >> 2] = progress(c, 0x2574);
    F[0x1f1c >> 2] = F[0x1f1c >> 2] - 1;
    F[tr(c, 0x114)] = F[tr(c, 0x114)] * fr(1.1);
    f10006780(c);
    if (F[0x31534 >> 2] >= fr(0.4)) I[0x1f70 >> 2] = 0;
    if (F[0x31534 >> 2] >= fr(0.3)) F[0x1f1c >> 2] = F[0x1f1c >> 2] * fr(1.24);
    if (F[0x31534 >> 2] >= fr(0.8)) F[0x1f20 >> 2] = F[0x1f20 >> 2] + 1;
    fadeIn(c);
    if (lt(F[0x31534 >> 2], 1)) return 0;
    shownFountain(c);
    I[0x1f1c >> 2] = 0; I[0x1f20 >> 2] = 0; I[0x2deec >> 2] = 0;
    f100073f0(c);
    vt(c, 0x190);
  } else if (st === 2) leaveFountain(c);
  return 0;
}

/** vt+0xec 0x1003b7c0: Volcanic: Sundrops' rings (from 10) under an erupting fountain (0x1f1c falls by t^3 * 100,
 *  by 80 more after 0.6; the floor tilts, 0x1f28 = cos * 1.6; the fountain stops at 0.9). Grind's and T3's
 *  (`stop` false) never clear the fountain flag 0x2deec at 0.9 */
export function volcanic(c: Core, stop = true): number {
  if (handoff(c, true)) return 0;
  const I = c.m.I, F = c.m.F;
  if (arrived(c)) {
    start(c);
    F[tr(c, 0x114)] = 10;
    F[0x1f4c >> 2] = 7; F[0x1f54 >> 2] = 7; F[0x1f50 >> 2] = 27;
    fountain(c);
    I[0x1f48 >> 2] = 1000; I[0x1f70 >> 2] = 900;
    I[0x1fb4 >> 2] = 0x3d8f5c29;              // 0.07
    I[0x1f40 >> 2] = 0xbfcccccd | 0;          // -1.6
    I[0x1f98 >> 2] = 0x3eb851ec;              // 0.36
    F[0x1f38 >> 2] = 256 / I[0x39ac >> 2] * I[0x311c8 >> 2] * 0.12 + 1;
    return 0;
  }
  const st = I[0x3166c >> 2];
  if (st === 1) {
    I[0x1ecc >> 2] = 0xff;
    const t = progress(c, 0x2574);
    F[0x31534 >> 2] = t;
    F[0x1f1c >> 2] = F[0x1f1c >> 2] - t * t * t * 100;
    F[0x1f28 >> 2] = cosBack(c, t) * 1.6;
    I[0x3160c >> 2] = ftol(F[tr(c, 0x114)]);
    F[tr(c, 0x114)] = F[tr(c, 0x114)] * fr(1.1);
    f10006780(c);
    if (F[0x31534 >> 2] >= fr(0.4)) I[0x1f70 >> 2] = 0;
    if (stop && F[0x31534 >> 2] >= fr(0.9)) I[0x2deec >> 2] = 0;
    if (F[0x31534 >> 2] >= fr(0.6)) {
      F[0x1f1c >> 2] = F[0x1f1c >> 2] - 80;
      F[0x1f20 >> 2] = F[0x1f20 >> 2] + 5;
    }
    fadeIn(c);
    if (lt(F[0x31534 >> 2], 1)) return 0;
    shownFountain(c);
    f100073f0(c);
    vt(c, 0x190);
  } else if (st === 2) leaveFountain(c);
  return 0;
}

def({
  0xc8: (c) => wisp(c, false),               // 0x10039760 Wisp on water
  0xcc: plunk,                               // 0x10039bb0 Plunk
  0xd0: flower,                              // 0x10039e80 Flower
  0xd4: (c) => spatter(c, false),            // 0x1003a190 Spatter
  0xd8: (c) => spatter(c, true),             // 0x1003a4a0 Burst
  0xdc: (c) => blastOff(c),                  // 0x1003a770 Blast-off
  0xe0: electric,                            // 0x1003ab40 Electric
  0xe4: (c) => wisp(c, true),                // 0x1003aef0 Crossing
  0xe8: sundrops,                            // 0x1003b3d0 Sundrops
  0xec: (c) => volcanic(c),                  // 0x1003b7c0 Volcanic
});
