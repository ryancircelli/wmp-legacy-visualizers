// Picture Viz 3D's liquid transitions (ids 15..30, vt+0xb0..0xec): the picture fades like Transparency while the
// water (CWater's height/velocity grid, 64 x 64 cells of two floats at the block obj+0x373c points to) is struck by
// drops, rain, rings or waves (the helpers 0x10006520..0x10007410 below).
import { A } from '../../ns';
import '../../rand';
import { type Core, def, vt } from './core';
import { fr, ftol } from '../pv2/mem';
import { f100073f0 } from './frame';

const COS = 0x30274 >> 2;
const rand = (): number => A.rand();

/** the velocity of cell i (x | y << 6), as a float index into the heap */
const vel = (c: Core, i: number): number => (c.m.I[0x373c >> 2] + i * 8 + 4) >> 2;
const sub = (c: Core, i: number, d: number): void => { const k = vel(c, i); c.m.F[k] = c.m.F[k] - d; };

/** 0x10006520: one drop at a random cell: -0.25 there, -0.125 on its four sides, -0.0625 on the diagonals */
function drop(c: Core): void {
  const r1 = rand(), r2 = rand();
  const x = r1 & 0x3f, y = (r2 & 0x3f) << 6, l = (r1 - 1) & 0x3f, r = (r1 + 1) & 0x3f;
  const u = ((r2 << 6) - 0x40) & 0xfc0, d = ((r2 + 1) & 0x3f) << 6;
  sub(c, x | y, 0.25); sub(c, l | y, 0.125); sub(c, r | y, 0.125); sub(c, u | x, 0.125); sub(c, d | x, 0.125);
  sub(c, u | l, 0.0625); sub(c, d | r, 0.0625); sub(c, u | r, 0.0625); sub(c, d | l, 0.0625);
}
/** 0x10006660: the same shape, -0.5 at the centre cell (32, 32) */
function centreDrop(c: Core): void {
  const x = 32, y = 32 << 6;
  sub(c, x | y, 0.5); sub(c, (x - 1) | y, 0.125); sub(c, (x + 1) | y, 0.125);
  sub(c, x | (y - 0x40), 0.125); sub(c, x | (y + 0x40), 0.125);
  sub(c, (x - 1) | (y - 0x40), 0.0625); sub(c, (x + 1) | (y + 0x40), 0.0625);
  sub(c, (x + 1) | (y - 0x40), 0.0625); sub(c, (x - 1) | (y + 0x40), 0.0625);
}
/** 0x10006740 (80 cells, -0.04) / 0x10006f30 (10 cells, -17.04): random single strikes */
function strikes(c: Core, n: number, d: number): void {
  for (let k = 0; k < n; k++) { const r1 = rand(), r2 = rand(); sub(c, ((r2 & 0x3f) << 6) | (r1 & 0x3f), d); }
}
/** 0x10006f70: 20 drops whose strength halves at every ring (from -10.04, carried from one drop to the next) */
function fadingDrops(c: Core): void {
  let L = fr(-10.04);
  for (let k = 0; k < 20; k++) {
    const r1 = rand(), r2 = rand();
    const x = r1 & 0x3f, y = (r2 & 0x3f) << 6, l = (r1 - 1) & 0x3f, r = (r1 + 1) & 0x3f;
    const u = ((r2 << 6) - 0x40) & 0xfc0, d = ((r2 + 1) << 6) & 0xfc0;
    sub(c, x | y, L);
    const h = L * 0.5;
    sub(c, l | y, h); sub(c, r | y, h); sub(c, u | x, h); sub(c, d | x, h);
    L = fr(h * 0.5);
    sub(c, u | l, L); sub(c, d | r, L); sub(c, u | r, L); sub(c, d | l, L);
  }
}
/** 0x100070d0: rows 10..41 set to a cosine wave (cos(300 + 30 * row) * 0.01), columns 1..62 */
function wave(c: Core): void {
  const I = c.m.I;
  for (let a = 300, y = 10; a < 0x4ec; a += 0x1e, y++) {
    for (let x = 1; x < 0x3f; x++) {
      I[0x3160c >> 2] = a;
      while (I[0x3160c >> 2] >= 0x168) I[0x3160c >> 2] -= 0x168;
      c.m.F[vel(c, ((y & 0x3f) << 6) | (x & 0x3f))] = c.m.F[COS + I[0x3160c >> 2]] * 0.01;
    }
  }
}

/** the template of 0x10038a00 and its siblings: Transparency's fade with the water struck when the picture
 *  arrives (and, for `every`, on every arriving frame); full at ftol(fade) >= `full`; both ends reset the water
 *  (0x100073f0) and the camera (vt+0x108). `spiky`: 0x100390b0's 0x1ecc = 0xff while arriving, 0x40 after. */
function liquid(c: Core, strike: (c: Core) => void, every: boolean, full: number, spiky = false): number {
  let I = c.m.I;
  if (I[0x259c >> 2] === 1) { I[0x259c >> 2] = 0; I[0x3166c >> 2] = 2; return 0; }
  const fadeAt = (I[0x1ca4 >> 2] * 0xe0 + 0x164) >> 2;
  if (I[0x2590 >> 2] === I[0x36f4 >> 2]) {
    I[fadeAt] = 0; I[0x3166c >> 2] = 1; I[0x256c >> 2] = 0;
    strike(c);
    return 0;
  }
  const t = (I[0x256c >> 2] >>> 0) / I[0x2574 >> 2];
  if (I[0x3166c >> 2] === 1) {
    c.m.F[fadeAt] = fr((c.m.F[COS + ftol(t * 90 + 180)] + 1) * 255);
    if (every) strike(c);
    I = c.m.I;
    if (spiky) I[0x1ecc >> 2] = 0xff;
    if (ftol(c.m.F[fadeAt]) < full) return 0;
    I[fadeAt] = 0x437f0000;
    I[0x3166c >> 2] = 0; I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = -1; I[0x25c8 >> 2] = 0;
    if (spiky) I[0x1ecc >> 2] = 0x40;
  } else if (I[0x3166c >> 2] === 2) {
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    c.m.F[fadeAt] = fr((c.m.F[COS + ftol(t * 90 + 100)] + 1) * 255);
    if (ftol(c.m.F[fadeAt]) >= 10) return 0;
    I[fadeAt] = 0;
    I[0x31228 >> 2] = 0;
    vt(c, 0x84);
    c.m.I[0x3166c >> 2] = 0;
  } else return 0;
  f100073f0(c);
  vt(c, 0x108);
  return 0;
}

def({
  0xb0: (c) => liquid(c, drop, true, 0xf6),                                 // 0x10038a00 Water Rain
  0xb4: (c) => liquid(c, centreDrop, true, 0xf6),                           // 0x10038c40 Water Drop
  0xb8: (c) => liquid(c, (k) => strikes(k, 0x50, fr(0.04)), false, 0xf6),   // 0x10038e80 Watery
  0xbc: (c) => liquid(c, (k) => strikes(k, 10, fr(17.04)), false, 0xff, true),  // 0x100390b0 Spiky Thing
  0xc0: (c) => liquid(c, fadingDrops, false, 0xff),                         // 0x10039300 Caldron
  0xc4: (c) => liquid(c, wave, false, 0xff),                                // 0x10039530 Tidal Pool
});
