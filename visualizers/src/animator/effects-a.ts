// Animator 2.2's warp-effect groups 0-2 (pickers 0x10008650, 0x10009550, 0x1000a790), their leaf setups and the
// per-pixel callbacks those start maps with. Setups are fx_<va>, callbacks cb<va> (the DLL's addresses). Map fields:
// x, y (+0, +4), r, theta (+8, +0xc), p1..p5 (+0x10..+0x20). Floats come in exact; every op below is the asm's, with
// FSIN/FCOS/FPATAN kept at 64 bits until the next op rounds them (see ../glass3d/fpu.ts).
import type { FxCtx, FxGroup } from './fx';
import type { WarpMap } from '../glass3d/warp';
import { f32, ftol, sincos87, mulExt, atan2_87 } from '../glass3d/fpu';
import { fma } from '../battery/x87';

const F = (m: WarpMap): FxCtx => m.ctx as FxCtx;
const F01 = f32(0.01);

/** 0x10007170: rand() * f32(x) * (1/32767 as a float), each product rounded to a double */
function rndf(c: FxCtx, x: number): number { return (c.rng.rand() * f32(x)) * 3.0518509447574615e-05; }
/** 0x10007190 */
function rnd7190(c: FxCtx): number { return c.rng.rand() * 6.103701895199438e-07 - 0.01; }

// 64-bit x87 values as hi + lo, and the double the next op leaves
const SC = new Float64Array(4), AT = new Float64Array(2);
/** a + (hi + lo) rounded once (FADD of a 64-bit register and a double)
 *  ponytail: TwoSum then one more add; can miss the correct rounding only within ~2^-64 of a tie */
function addE(a: number, hi: number, lo: number): number {
  const s = hi + a, bb = s - hi, e = (hi - (s - bb)) + (a - bb);
  return s + (e + lo);
}
const sinMul = (x: number, k: number): number => { sincos87(x, SC); return mulExt(k, SC[0], SC[1]); };
const cosMul = (x: number, k: number): number => { sincos87(x, SC); return mulExt(k, SC[2], SC[3]); };
const sin1 = (x: number): number => { sincos87(x, SC); return addE(1.0, SC[0], SC[1]); };   // FSIN; FADD 1.0
/** FSIN(a) + FSIN(b), both 64-bit, rounded once */
function sinSum(a: number, b: number): number {
  sincos87(a, SC); const h = SC[0], l = SC[1];
  sincos87(b, SC);
  const s = h + SC[0], bb = s - h, e = (h - (s - bb)) + (SC[0] - bb);
  return s + (e + l + SC[1]);
}
/** FSIN(a) * FCOS(a), both 64-bit, rounded once */
function sinCos(a: number): number { sincos87(a, SC); return fma(SC[0], SC[2], SC[0] * SC[3] + SC[1] * SC[2]); }
/** 0x10007150 on a float */
const pos = (v: number): number => (v > 0 ? v : 0);

// ---- callbacks: polar maps read r, theta; the rest x, y. "p5 == 0" picks the jittered variant.
const cb7370 = (m: WarpMap): number => m.theta - 0.001;
const cb7980 = (m: WarpMap): number => m.theta + 0.005;
const cb8550 = (m: WarpMap): number => m.theta - 0.01;
const cbc9e0 = (m: WarpMap): number => m.theta + 0.0175;
const cb9070 = (m: WarpMap): number => m.theta;
const cb76f0 = (m: WarpMap): number => m.p1 * m.r;
/** (rndf(.01) + v) - rndf(.01): the common jitter, v computed between the draws */
function jit(m: WarpMap, v: number): number {
  if (m.p5 !== 0) return v;
  const c = F(m), a = rndf(c, F01) + v;
  return a - rndf(c, F01);
}
const cbc980 = (m: WarpMap): number => jit(m, m.r * 0.93);
const cbcba0 = (m: WarpMap): number => jit(m, m.x * 0.96);
const cb79e0 = (m: WarpMap): number => jit(m, m.y * 0.93);
const cb7a80 = (m: WarpMap): number => jit(m, m.x * 0.93);
const cb7ae0 = (m: WarpMap): number => jit(m, m.y * 0.98);
const cb7da0 = (m: WarpMap): number => jit(m, m.theta);
const cbcee0 = (m: WarpMap): number => { sincos87(m.p1 * m.theta, SC); return jit(m, (addE(1.0, SC[2], SC[3]) * 0.05 + 0.93) * m.r); };
const cb7b80 = (m: WarpMap): number => jit(m, (sin1(m.p1 * m.theta) * 0.03 + 0.92) * m.r);
const cb73c0 = (m: WarpMap): number => sinMul(m.x, 0.01) + m.x;
const cb73e0 = (m: WarpMap): number => sinMul(m.x, 0.01) + m.y;
const cb7460 = (m: WarpMap): number => { const a = rndf(F(m), F01); return (a + sinMul(m.x, 0.03)) + m.x; };
const cb7490 = (m: WarpMap): number => { const a = rndf(F(m), F01); sincos87(m.y, SC); return addE(a, SC[0], SC[1]) * 0.03 + m.y; };
/** sin(v)*0.06 + v*k, jittered as ((a + s) + v*k) - b */
function sinLin(m: WarpMap, v: number, k: number): number {
  if (m.p5 !== 0) return sinMul(v, 0.06) + v * k;
  const c = F(m), a = rndf(c, F01), t = (a + sinMul(v, 0.06)) + v * k;
  return t - rndf(c, F01);
}
const cb74f0 = (m: WarpMap): number => sinLin(m, m.x, 0.93);
const cb7560 = (m: WarpMap): number => sinLin(m, m.y, 0.93);
const cb7620 = (m: WarpMap): number => sinLin(m, m.x, 0.98);
const cb7690 = (m: WarpMap): number => sinMul(m.y, 0.06) + m.y * 0.98;
const cb7700 = (m: WarpMap): number => m.theta - pos(f32(1.0 - m.r)) * 0.035;
const cb7770 = (m: WarpMap): number => sinSum(m.y * m.y, m.x) * 0.01 + m.x;
const cb7790 = (m: WarpMap): number => sinSum(m.y * m.y, m.x) * 0.01 + m.y;
/** 0.01 / (|ftol(v)| + 1) + v*0.93, jittered as ((a + q) + v*0.93) - b */
function stepLin(m: WarpMap, v: number): number {
  const c = F(m), a = m.p5 !== 0 ? 0 : rndf(c, F01);
  const q = 0.01 / (Math.abs(ftol(v)) + 1);
  if (m.p5 !== 0) return q + v * 0.93;
  const t = (a + q) + v * 0.93;
  return t - rndf(c, F01);
}
const cb7800 = (m: WarpMap): number => stepLin(m, m.x);
const cb78a0 = (m: WarpMap): number => stepLin(m, m.y);
const cb84c0 = (m: WarpMap): number => { atan2_87(0.55 - m.r * 0.5, 1, AT); return (mulExt(0.16, AT[0], AT[1]) + 1.0) * m.r; };
const cb7c60 = (m: WarpMap): number => { const a = rndf(F(m), 80); return (sin1(a * m.r) * 0.05 + 0.93) * m.r; };
const cb7cd0 = (m: WarpMap): number => (sin1(m.p1 * m.r) * 0.03 + 0.92) * m.r;

const cb8aa0 = (m: WarpMap): number => (sin1(m.p2 * m.r) * m.p1 + 0.92) * m.r;
/** v, or rnd7190() + v (drawn first) when p5 == 0 */
const add7190 = (m: WarpMap, f: () => number): number => {
  if (m.p5 !== 0) return f();
  const a = rnd7190(F(m));
  return a + f();
};
const cb8ad0 = (m: WarpMap): number => add7190(m, () => m.theta);
const cb8b60 = (m: WarpMap): number => add7190(m, () => (m.p1 + 0.92) * m.x);
const cb8ba0 = (m: WarpMap): number => add7190(m, () => (m.p1 + 0.92) * m.y);
const cb92e0 = (m: WarpMap): number => add7190(m, () => (sin1(m.p1 * m.theta) * 0.03 + 0.92) * m.r);
const cb8ee0 = (m: WarpMap): number => add7190(m, () => sinMul(m.p2 * m.r, m.p1)) + m.theta;
const cb8dd0 = (m: WarpMap): number => add7190(m, () => sinMul((m.p2 * m.r) * m.r, m.p1)) + m.theta;
const cb8c20 = (m: WarpMap): number => ((m.r - m.p3) * 0.13 + 1.0) * m.r;
const cb8d00 = (m: WarpMap): number => ((m.r - m.p3) * 0.03 + 1.0) * m.r;
const cb8f80 = (m: WarpMap): number => (sin1(m.p3 * m.theta) * 0.03 + 0.92) * m.r;
const cb8fb0 = (m: WarpMap): number => sinMul(m.p2 * m.r, m.p1) + m.theta;

const cb9850 = (m: WarpMap): number => sinMul(m.p1 * m.y, m.p3) + m.x * 0.97;
const cb9870 = (m: WarpMap): number => cosMul(m.p2 * m.x, m.p3) + m.y * 0.97;
const nrm = (m: WarpMap): number => Math.sqrt(m.x * m.x + m.y * m.y + 0.1);
const cb9970 = (m: WarpMap): number => sinMul(m.p1 * m.y / nrm(m), 0.01) + m.x;
const cb98f0 = (m: WarpMap): number => cosMul(m.p1 * m.x / nrm(m), 0.01) + m.y;
const cb99b0 = (m: WarpMap): number => cosMul(m.p2 * m.x / nrm(m), 0.01) + m.y;
const cb9ac0 = (m: WarpMap): number => m.x - sinMul(m.p1 * m.y / nrm(m), 0.01);
const cb9a30 = (m: WarpMap): number => m.y - cosMul(m.p2 * m.x / nrm(m), 0.01);
const cb9b00 = (m: WarpMap): number => m.y - cosMul(m.p1 * m.x / nrm(m), 0.01);
const cb9bd0 = (m: WarpMap): number => sinMul((m.p1 * m.y) * m.y, 0.01) + m.x;
const cbcb10 = (m: WarpMap): number => cosMul((m.p2 * m.x) * m.x, 0.01) + m.y;
const cb9c40 = (m: WarpMap): number => sinMul((m.p1 * m.x) * m.x, 0.01) + m.x;
const cb9cb0 = (m: WarpMap): number => cosMul((m.p2 * m.y) * m.y, 0.01) + m.y;
const cb9e00 = (m: WarpMap): number => sinCos(Math.sqrt(m.x * m.x + m.y * m.y) * m.p1) * 0.02 + m.x;
const cb9d70 = (m: WarpMap): number => sinCos(Math.sqrt(m.x * m.x + m.y * m.y) * m.p2) * 0.02 + m.y;

// ---- leaf setups. Draw order is the DLL's push order (p5 first, then p4..p1).
/** what a table lookup past its end reads: the picker's return address into 0x100071b0 (rnd(n) == n, 1 in 32768) */
const RET = 0x100072ad;
const pol = (c: FxCtx, p1: number, p5: number, fn1: (m: WarpMap) => number, fn2: (m: WarpMap) => number, polar = 1, square = 1): void => {
  c.newMap([p1, 0, 0, 0, p5], polar, square, fn1, fn2);
};

export const fx_10007380: FxGroup = (c) => pol(c, 0, c.rnd(2), cbc980, cb7370);
export const fx_10007400: FxGroup = (c) => {
  c.newMap([0, 0, 0, 0, 0], 0, 0, cb73c0, cb73e0);
  c.g.g28fc8 = 0; c.g.g28fd0 = [0, 14, 4, RET][c.rnd(3)];
};
export const fx_100074c0: FxGroup = (c) => { c.newMap([0, 0, 0, 0, 0], 0, 0, cb7460, cb7490); };
export const fx_100075e0: FxGroup = (c) => pol(c, 0, c.rnd(2), cb74f0, cb7560, 0, 0);
export const fx_100076b0: FxGroup = (c) => pol(c, 0, c.rnd(2), cb7620, cb7690, 0, 0);
export const fx_10007730: FxGroup = (c) => pol(c, f32(rndf(c, 0.06) + 0.95), 0, cb76f0, cb7700);
export const fx_100077b0: FxGroup = (c) => {
  c.newMap([0, 0, 0, 0, 0], 0, 0, cb7770, cb7790);
  c.g.g28fd0 = [0, 8, RET][c.rnd(2)];
};
export const fx_10007940: FxGroup = (c) => pol(c, 0, c.rnd(2), cb7800, cb78a0, 0, 0);
export const fx_100084f0: FxGroup = (c) => pol(c, 0, 0, cb84c0, cb8550);
export const fx_10007990: FxGroup = (c) => { const p5 = c.rnd(2); pol(c, f32((rndf(c, 2.1) + 1.0) * 3.141592653), p5, cbcee0, cb7980); };
export const fx_10007a40: FxGroup = (c) => pol(c, 0, c.rnd(2), cbcba0, cb79e0, 0, 0);
export const fx_10007b40: FxGroup = (c) => pol(c, 0, c.rnd(2), cb7a80, cb7ae0, 0, 0);
export const fx_10007c10: FxGroup = (c) => { const p5 = c.rnd(2); pol(c, f32((rndf(c, 5) + 28.0) * 3.141592653), p5, cb7b80, cb9070, 1, 0); };
export const fx_10007c90: FxGroup = (c) => pol(c, 0, c.rnd(2), cb7c60, cb7da0);
export const fx_10007d00: FxGroup = (c) => { const p5 = c.rnd(2); pol(c, f32(rndf(c, 120)), p5, cb7cd0, cb7da0); };
/** also run by group 5 (0x1000d740) */
export const fx_10008380: FxGroup = (c) => { pol(c, 0, c.rnd(2), cbc980, cbc9e0); c.g.g28fd0 = 9; };

const G0 = [fx_10007380, fx_10007400, fx_100074c0, fx_100075e0, fx_100076b0, fx_10007730, fx_100077b0, fx_10007940,
  fx_100084f0, fx_10007990, fx_10007a40, fx_10007b40, fx_10007c10, fx_10007c90, fx_10007c90, fx_10007d00, fx_10007d00];
/** 0x10008650: rnd(16), so only cases 0..16 of its 32-way switch are reachable */
export const GROUP0: FxGroup = (c) => { const i = c.rnd(16); c.g.g28f14 = i; G0[i](c); };

/** p5 = rnd(2), then p3, p2, p1 as drawn */
function g1(c: FxCtx, polar: number, square: number, fn1: (m: WarpMap) => number, fn2: (m: WarpMap) => number,
  p3: (c: FxCtx) => number, p2: (c: FxCtx) => number, p1: (c: FxCtx) => number): void {
  const p5 = c.rnd(2), q3 = p3(c), q2 = p2(c), q1 = p1(c);
  c.newMap([q1, q2, q3, 0, p5], polar, square, fn1, fn2);
}
const Z = (): number => 0;
const R = (k: number, add = 0) => (c: FxCtx): number => f32(rndf(c, k) + add);
const PI8 = (c: FxCtx): number => f32((rndf(c, 5) + 8.0) * 3.141592653);
export const fx_10008b00: FxGroup = (c) => { g1(c, 1, 1, cb8aa0, cb8ad0, Z, R(80), R(0.15)); c.g.g28fd0 = 0xc; };
export const fx_10008be0: FxGroup = (c) => g1(c, 0, 0, cb8b60, cb8ba0, Z, Z, R(0.07));
export const fx_10008c40: FxGroup = (c) => g1(c, 1, 0, cb8c20, cb8ee0, R(0.3, 0.9), R(7, 3), R(0.08));
export const fx_10008ca0: FxGroup = (c) => g1(c, 1, 1, cb8c20, cb8ee0, R(0.3, 0.9), R(7, 3), R(0.08));
export const fx_10008d20: FxGroup = (c) => g1(c, 1, 1, cb8d00, cb8ee0, R(0.3, 1.6), R(7, 3), R(0.05));
export const fx_10008d80: FxGroup = (c) => g1(c, 1, 0, cb92e0, cb9070, Z, Z, PI8);
export const fx_10008e20: FxGroup = (c) => g1(c, 1, 1, cb8d00, cb8dd0, R(0.3, 1.6), R(1000, 7), R(0.05));
export const fx_10008e80: FxGroup = (c) => g1(c, 1, 1, cb8c20, cb8ee0, R(0.3, 0.9), R(1000), R(0.08));
export const fx_10008f20: FxGroup = (c) => g1(c, 1, 0, cb8c20, cb8ee0, R(0.3, 0.6), R(1000), R(0.08));
export const fx_10008fd0: FxGroup = (c) => {
  const p3 = PI8(c), p2 = R(100)(c), p1 = R(0.02)(c);
  c.newMap([p1, p2, p3, 0, 0], 1, 1, cb8f80, cb8fb0);
};

const G1 = [fx_10008b00, fx_10008b00, fx_10008b00, fx_10008be0, fx_10008be0, fx_10008c40, fx_10008ca0, fx_10008d20,
  fx_10008d80, fx_10008e20, fx_10008e80, fx_10008f20, fx_10008fd0];
/** 0x10009550: rnd(12), cases 0..12 of 24 reachable */
export const GROUP1: FxGroup = (c) => { const i = c.rnd(12); c.g.g28f14 = i; G1[i](c); };

/** square = rnd(2), then p2, p1 (rndf(k) + add each) */
function g2(c: FxCtx, fn1: (m: WarpMap) => number, fn2: (m: WarpMap) => number, k: number, add: number): void {
  const sq = c.rnd(2), p2 = R(k, add)(c), p1 = R(k, add)(c);
  c.newMap([p1, p2, 0, 0, 0], 0, sq, fn1, fn2);
}
export const fx_10009890: FxGroup = (c) => {
  const sq = c.rnd(2), p3 = f32(rnd7190(c)), p2 = R(50, 5)(c), p1 = R(50, 5)(c);
  c.newMap([p1, p2, p3, 0, 0], 0, sq, cb9850, cb9870);
};
export const fx_10009930: FxGroup = (c) => { c.newMap([R(100, 5)(c), 0, 0, 0, 0], 0, 0, cb9970, cb98f0); };
export const fx_100099f0: FxGroup = (c) => { c.newMap([R(50, 50)(c), 3, 0, 0, 0], 0, 0, cb9970, cb99b0); };
export const fx_10009a70: FxGroup = (c) => {
  c.newMap([7, R(25, 25)(c), 0, 0, 0], 0, 0, cb9ac0, cb9a30);
  c.g.g28fd0 = 0xd; c.g.g28fc8 = 0;
};
export const fx_10009b40: FxGroup = (c) => { c.newMap([R(100, 5)(c), 0, 0, 0, 0], 0, 0, cb9ac0, cb9b00); };
export const fx_10009b80: FxGroup = (c) => g2(c, cb9bd0, cbcb10, 50, 5);
export const fx_10009bf0: FxGroup = (c) => {
  const sq = c.rnd(2);
  c.newMap([R(50, 50)(c), 3, 0, 0, 0], 0, sq, cb9bd0, cbcb10);
  c.g.g28fd0 = 0xd;
};
export const fx_10009c60: FxGroup = (c) => g2(c, cb9c40, cbcb10, 50, 50);
export const fx_10009cd0: FxGroup = (c) => g2(c, cb9bd0, cb9cb0, 50, 5);
export const fx_10009d20: FxGroup = (c) => g2(c, cb9e00, cb9d70, 50, 50);
export const fx_10009db0: FxGroup = (c) => g2(c, cb9e00, cb9d70, 27, 3);
export const fx_10009e40: FxGroup = (c) => g2(c, cb9e00, cb9d70, 7, 3);

const G2 = [fx_10009890, fx_10009890, fx_10009890, fx_10009890, fx_10009930, fx_100099f0, fx_10009a70, fx_10009b40,
  fx_10009b80, fx_10009bf0, fx_10009c60, fx_10009cd0, fx_10009d20, fx_10009db0, fx_10009e40];
/** 0x1000a790: rnd(14), cases 0..14 of 28 reachable */
export const GROUP2: FxGroup = (c) => { const i = c.rnd(14); c.g.g28f14 = i; G2[i](c); };
