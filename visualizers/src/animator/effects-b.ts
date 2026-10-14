// Animator 2.2's warp-effect groups 3, 4 and 5 (pickers 0x1000eb20, 0x1000c640, 0x1000d740) and every leaf setup and
// callback of theirs above 0x1000a790. Ported from the asm: setups draw their parameters in push order (the last
// parameter first), and each callback returns the double its last x87 op left.
import type { FxCtx, FxGroup } from './fx';
import type { WarpMap, WarpFn } from '../glass3d/warp';
import { f32, ftol, sincos87, mulExt, atan2_87 } from '../glass3d/fpu';
import { A } from '../ns';
import { fx_10008380 } from './effects-a';

/** 0x100246d8: 1/32767 as a float */
const K15 = 3.0518509447574615e-05;
/** 0x10007170: rand() * x * (1/32767), each product rounded to a double; x is a float argument */
const rndf = (c: FxCtx, x: number): number => c.rng.rand() * f32(x) * K15;
/** 0x10007150: a float clamped below at 0 */
const pos = (x: number): number => (x > 0 ? x : 0);
const PI = 3.141592653;   // 0x10024760
const cx = (m: WarpMap): FxCtx => m.ctx as FxCtx;

// FSIN/FCOS results are 64-bit; the next op rounds once. hi + lo of SC holds them.
const SC = new Float64Array(4);
/** k * sin(a) (FSIN; FMUL k) */
const ks = (k: number, a: number): number => { sincos87(a, SC); return mulExt(k, SC[0], SC[1]); };
const kc = (k: number, a: number): number => { sincos87(a, SC); return mulExt(k, SC[2], SC[3]); };
/** c + the 64-bit hi + lo, rounded to a double */
function addExt(c: number, hi: number, lo: number): number {
  if (lo === 0) return c + hi;
  const s = c + hi, bb = s - c, e = (c - (s - bb)) + (hi - bb);
  return s + (e + lo);   // ponytail: double rounding only when e + lo lands on a tie
}
/** c + sin(a), c + cos(a) (FSIN; FADD c) */
const as = (c: number, a: number): number => { sincos87(a, SC); return addExt(c, SC[0], SC[1]); };
const ac = (c: number, a: number): number => { sincos87(a, SC); return addExt(c, SC[2], SC[3]); };
/** sin(a) + sin(b) / cos(a) + cos(b): two 64-bit values added at 53 bits */
function ss(a: number, b: number): number {
  sincos87(a, SC); const h = SC[0], l = SC[1];
  sincos87(b, SC); return addExt(h, SC[0], SC[1] + l);
}
function cc(a: number, b: number): number {
  sincos87(a, SC); const h = SC[2], l = SC[3];
  sincos87(b, SC); return addExt(h, SC[2], SC[3] + l);
}
/** the polar callbacks' jitter when p5 == 0: (j1 + v) - j2, j1 drawn before v is computed */
function jit(m: WarpMap, v: (m: WarpMap) => number): number {
  if (m.p5 !== 0) return v(m);
  const c = cx(m), j1 = rndf(c, 0.01), a = j1 + v(m);
  return a - rndf(c, 0.01);
}
const pick = (c: FxCtx, a: number[]): number => a[c.rnd(a.length)];
/** 0x10007190: rand() * 6.103701895199438e-07 - 0.01 */
const rnd2 = (c: FxCtx): number => c.rng.rand() * 6.103701895199438e-07 - 0.01;
/** ftol(rndf(n)): which of n warps a pixel takes */
const which = (m: WarpMap, n: number): number => ftol(rndf(cx(m), n));

// ---- callbacks in 0x10007170..0x1000a790 (the other agent's range) that these setups use
const cb_10007980: WarpFn = (m) => m.theta + 0.005;
const cb_10007b80: WarpFn = (m) => jit(m, (m) => (as(1, m.p1 * m.theta) * 0.03 + 0.92) * m.r);
const cb_10007da0: WarpFn = (m) => {
  if (m.p5 !== 0) return m.theta;
  const c = cx(m), a = rndf(c, 0.01) + m.theta;
  return a - rndf(c, 0.01);
};
const cb_10008070: WarpFn = (m) => pos(f32(m.r - m.p3)) * 0.97;
const cb_10009070: WarpFn = (m) => m.theta;
const cb_10009bd0: WarpFn = (m) => ks(0.01, m.p1 * m.y * m.y) + m.x;
const cb_1000a4a0: WarpFn = (m) => { const a = m.p1 * m.y; return ss(a * m.x, a) * 0.01 + m.x * 0.97; };
const cb_1000a4d0: WarpFn = (m) => cc(m.y * m.x * m.p2, m.x * m.p2) * 0.01 + m.y * 0.97;

// ---- group 5 leaves and callbacks
const cb_1000c900: WarpFn = (m) => m.x - ks(0.01, m.p1 * m.y);
const cb_1000c920: WarpFn = (m) => m.y - kc(0.01, m.p1 * m.x);
export function fx_1000c940(c: FxCtx): void {
  c.newMap([f32(rndf(c, 50) + 5), 0, 0, 0, 0], 0, 0, cb_1000c900, cb_1000c920);
  c.g.g28fd0 = 12;
}

export function fx_1000c9f0(c: FxCtx): void {
  const p5 = c.rnd(2);
  c.newMap([f32(rndf(c, 5) * PI + 8), 0, 0, 0, p5], 1, 0, cb_10007b80, cb_10009070);
  c.g.g28fd0 = 13;
}

const cb_1000ca50: WarpFn = (m) => (m.p3 + 0.92) * m.x - ks(0.01, m.p1 * m.y);
const cb_1000ca80: WarpFn = (m) => (m.p3 + 0.92) * m.y - kc(0.01, m.p2 * m.x);
export function fx_1000cab0(c: FxCtx): void {
  const p3 = f32(rndf(c, 0.16)), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, p3, 0, 0], 0, 0, cb_1000ca50, cb_1000ca80);
  c.g.g28fd0 = 11;
}

const cb_1000cb10: WarpFn = (m) => kc(0.01, m.p2 * m.x * m.x) + m.y;
export function fx_1000cb30(c: FxCtx): void {
  const p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 0, cb_10009bd0, cb_1000cb10);
  c.g.g28fd0 = pick(c, [9, 12, 20]);
}

const cb_1000cba0: WarpFn = (m) => jit(m, (m) => m.x * 0.96);
const cb_1000cc00: WarpFn = (m) => jit(m, (m) => (m.p1 + 0.92) * m.y);
export function fx_1000cc60(c: FxCtx): void {
  const p5 = c.rnd(2);
  c.newMap([f32(rndf(c, 0.13)), 0, 0, 0, p5], 0, 0, cb_1000cba0, cb_1000cc00);
  c.g.g28fd0 = 16;
}

export function fx_1000ccb0(c: FxCtx): void {
  const p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 1, cb_1000a4a0, cb_1000a4d0);
  c.g.g28fd0 = 11; c.g.g28fc8 = 0;
}

const cb_1000cd10: WarpFn = (m) => (rndf(cx(m), 0.05) + 0.93) * m.x - ks(0.01, m.p1 * m.y);
const cb_1000cd40: WarpFn = (m) => (rndf(cx(m), 0.05) + 0.93) * m.y - kc(0.01, m.p2 * m.x);
export function fx_1000cd70(c: FxCtx): void {
  const p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 0, cb_1000cd10, cb_1000cd40);
  c.g.g28fd0 = 8;
}

const cb_1000cdc0: WarpFn = (m) => (as(1, m.p1 * m.r) * 0.05 + 0.93) * m.r;
export function fx_1000cdf0(c: FxCtx): void {
  const p5 = c.rnd(2);
  c.newMap([f32(rndf(c, 80)), 0, 0, 0, p5], 1, 1, cb_1000cdc0, cb_10007da0);
  c.g.g28fd0 = 2;
}

const cb_1000ce40: WarpFn = (m) => ks(0.05, m.p1 * m.y) + m.x;
const cb_1000ce60: WarpFn = (m) => (kc(0.05, m.p2 * m.x) + m.y) + 0.03;
export function fx_1000ce80(c: FxCtx): void {
  const p2 = f32(rndf(c, 10) + 5), p1 = f32(rndf(c, 10) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 1, cb_1000ce40, cb_1000ce60);
  c.g.g28fd0 = 13; c.g.g28fc8 = 0;
}

const cb_1000cee0: WarpFn = (m) => jit(m, (m) => (ac(1, m.p1 * m.theta) * 0.05 + 0.93) * m.r);
export function fx_1000cf70(c: FxCtx): void {
  const p5 = c.rnd(2);
  c.newMap([f32((rndf(c, 2.1) + 1) * PI), 0, 0, 0, p5], 1, 1, cb_1000cee0, cb_10007980);
  c.g.g28fd0 = 11;
}

const F99 = 99;   // 0x10024830 (float)
const cb_1000cfd0: WarpFn = (m) => ks(0.01, m.y * F99) + m.x * 0.99;
const cb_1000d000: WarpFn = (m) => m.y * 0.99 - kc(0.01, m.x * F99);
export function fx_1000d030(c: FxCtx): void {
  const p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 0, cb_1000cfd0, cb_1000d000);
  c.g.g28fd0 = 9; c.g.g28fc8 = 0;
}

const cb_1000d090: WarpFn = (m) => {
  if (m.p5 !== 0) return m.r * 0.97;
  const c = cx(m), j1 = rndf(c, 0.01);
  return (rndf(c, 0.01) + j1) + m.r * 0.97;
};
const cb_1000d0f0: WarpFn = (m) => m.theta - 0.025;
export function fx_1000d100(c: FxCtx): void {
  c.newMap([0, 0, 0, 0, c.rnd(2)], 1, 1, cb_1000d090, cb_1000d0f0);
  c.g.g28fd0 = pick(c, [19, 3]);
  c.g.g28fc8 = 0;
}

const cb_1000d170: WarpFn = (m) => { const a = m.x * 0.97; return a - ks(0.01, (rndf(cx(m), 3) + 1) * m.y); };
const cb_1000d1b0: WarpFn = (m) => { const a = m.y * 0.97; return a - kc(0.01, (rndf(cx(m), 3) + 1) * m.x); };
export function fx_1000d1f0(c: FxCtx): void {
  c.newMap([0, 0, 0, 0, 0], 0, 1, cb_1000d170, cb_1000d1b0);
  c.g.g28fd0 = 11;
}

const cb_1000d220: WarpFn = (m) => ks(0.05, m.p1 * m.y) + m.x * 0.98;
export function fx_1000d240(c: FxCtx): void {
  const p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, 0, 0, 0], 0, 1, cb_1000d220, cb_1000ddf0);
  c.g.g28fd0 = 5; c.g.g28fcc = 0;
}

const cb_1000d2a0: WarpFn = (m) => ks(m.p2, m.p1 * m.r) + m.theta;
export function fx_1000d2c0(c: FxCtx): void {
  const p5 = c.rnd(2);
  const p3 = f32(rndf(c, 0.006) + 0.002), p2 = f32(rndf(c, 0.03) + 0.01), p1 = f32(rndf(c, 16) + 2);
  c.newMap([p1, p2, p3, 0, p5], 1, 1, cb_10008070, cb_1000d2a0);
  c.g.g28fd0 = 10;
}

const cb_1000d330: WarpFn = (m) => (as(1, (m.p2 + 50) * m.r) * m.p1 + 0.92) * m.r;
/** sets no drawing mode */
export function fx_1000d360(c: FxCtx): void {
  const p5 = c.rnd(2);
  const p2 = f32(rndf(c, 180)), p1 = f32(rndf(c, 0.07));
  c.newMap([p1, p2, 0, 0, p5], 1, 1, cb_1000d330, cb_10007da0);
}

const cb_1000ab40: WarpFn = (m) =>
  cx(m).rnd(2) !== 0 ? (m.p3 + 0.92) * m.x - ks(0.01, m.p1 * m.y) : cb_1000a4a0(m);
const cb_1000d3b0: WarpFn = (m) =>
  cx(m).rnd(2) !== 0 ? (m.p3 + 0.92) * m.y - kc(0.01, m.p2 * m.x) : cb_1000a4d0(m);
export function fx_1000d410(c: FxCtx): void {
  const p3 = f32(rndf(c, 0.16)), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 50) + 5);
  c.newMap([p1, p2, p3, 0, 0], 0, 1, cb_1000ab40, cb_1000d3b0);
  c.g.g28fc8 = 0;
  c.g.g28fd0 = pick(c, [1, 3, 9, 15, 16]);
}

/** rndf(|(x, y)|) < 0.2 */
const near = (m: WarpMap): boolean => rndf(cx(m), f32(Math.sqrt(m.x * m.x + m.y * m.y))) < 0.2;
const cb_1000d4b0: WarpFn = (m) => (near(m) ? m.r * 0.93 : (as(1, m.p1 * m.theta) * 0.03 + 0.92) * m.r);
const cb_1000d540: WarpFn = (m) => (near(m) ? m.theta + 0.0175 : m.theta - 0.0175);
/** sets no drawing mode */
export function fx_1000aba0(c: FxCtx): void {
  const p5 = c.rnd(2);
  c.newMap([f32(rndf(c, 5) * PI + 8), 0, 0, 0, p5], 1, 0, cb_1000d4b0, cb_1000d540);
  c.g.g28fc8 = 0;
}

// 0x1000d5c0 draws which of three warps a pixel gets into 0x1002d008; 0x1000d630 reads it back
const cb_1000d5c0: WarpFn = (m) => {
  const g = cx(m).g, k = g.g2d008 = ftol(rndf(cx(m), 3));
  if (k === 0) return (m.p4 + 0.95) * m.x;
  if (k === 1) return ks(0.03, m.p3 * m.y) + m.p1 * m.x;
  if (k === 2) return ks(0.03, m.p2 * m.y) + m.p1 * m.x;
  return 0;
};
const cb_1000d630: WarpFn = (m) => {
  const k = cx(m).g.g2d008;
  if (k === 0) return (m.p4 + 0.95) * m.y;
  if (k === 1) return kc(0.03, m.p3 * m.x) + m.p1 * m.y;
  if (k === 2) return kc(0.03, m.p2 * m.x) + m.p1 * m.y;
  return 0;
};
/** 0x1000d690 (inline in the picker as case 19) */
export function fx_1000d690(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.04)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000d5c0, cb_1000d630);
  c.g.g28fcc = 0; c.g.gad3f0 = 0;
  c.g.g28fd0 = pick(c, [8, 10, 11, 21, 22]);
}

const G5 = [fx_1000c940, fx_10008380, fx_1000c9f0, fx_1000cab0, fx_1000cb30, fx_1000cc60, fx_1000ccb0, fx_1000cd70,
  fx_1000cdf0, fx_1000ce80, fx_1000cf70, fx_1000d030, fx_1000d100, fx_1000d1f0, fx_1000d240, fx_1000d2c0, fx_1000d360,
  fx_1000d410, fx_1000aba0, fx_1000d690];
/** draws rnd(10): leaves 10..19 are never picked */
export const GROUP5: FxGroup = (c) => { const i = c.g.g28f14 = c.rnd(10); G5[i]?.(c); };

// ---- group 4 leaves and callbacks. 0x1002cff8 carries the warp fn1 drew for this pixel over to fn2.
const cb_1000ac00: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  return k !== 0 ? (m.p3 + 0.95) * m.x : ks(0.03, m.p2 * m.y) + m.p1 * m.x;
};
const cb_1000ac50: WarpFn = (m) =>
  cx(m).g.g2cff8 !== 0 ? (m.p3 + 0.95) * m.y : kc(0.03, m.p2 * m.x) + m.p1 * m.y;
/** sets no globals */
export function fx_1000ac90(c: FxCtx): void {
  const p3 = f32(rndf(c, 0.04)), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, 0, 0], 0, 0, cb_1000ac00, cb_1000ac50);
}

const cb_1000ace0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  return ks(0.03, (k !== 0 ? m.p3 : m.p2) * m.y) + m.p1 * m.x;
};
const cb_1000ad20: WarpFn = (m) => kc(0.03, (cx(m).g.g2cff8 !== 0 ? m.p3 : m.p2) * m.x) + m.p1 * m.y;
/** p4 is drawn but unused; sets no globals */
export function fx_1000ad50(c: FxCtx): void {
  const p4 = f32(rndf(c, 50) + 50), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5);
  const p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000ace0, cb_1000ad20);
}

// 0x1000adc0/0x1000ae30: 0x1000d5c0/0x1000d630 with 0x1002cff8 as the carrier
const cb_1000adc0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return (m.p4 + 0.95) * m.x;
  if (k === 1) return ks(0.03, m.p3 * m.y) + m.p1 * m.x;
  if (k === 2) return ks(0.03, m.p2 * m.y) + m.p1 * m.x;
  return 0;
};
const cb_1000ae30: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (k === 0) return (m.p4 + 0.95) * m.y;
  if (k === 1) return kc(0.03, m.p3 * m.x) + m.p1 * m.y;
  if (k === 2) return kc(0.03, m.p2 * m.x) + m.p1 * m.y;
  return 0;
};
/** 0x1000d690's map without its globals */
export function fx_1000ae90(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.04)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000adc0, cb_1000ae30);
}

/** (ftol(v * 100) & 1) * 2: stripes, 0 or 2 */
const stripe = (v: number): number => (ftol(v * 100) & 1) * 2;
const cb_1000aef0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3), e = stripe(m.x);
  if (k === 0) return (m.p4 + (e === 0 ? 0.94 : e === 1 ? 0.96 : 0.98)) * m.x;
  if (k === 1) return ks(0.01, m.p3 * m.y) + m.p1 * m.x;
  if (k === 2) return ks(0.03, m.p2 * m.y) + m.p1 * m.x;
  return 0;
};
const cb_1000afb0: WarpFn = (m) => {
  const e = stripe(m.y), k = cx(m).g.g2cff8;
  if (k === 0) return (m.p4 + (e === 0 ? 0.95 : e === 1 ? 0.96 : 0.97)) * m.y;
  if (k === 1) return kc(0.01, m.p3 * m.x) + m.p1 * m.y;
  if (k === 2) return kc(0.03, m.p2 * m.x) + m.p1 * m.y;
  return 0;
};
export function fx_1000b060(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.02)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000aef0, cb_1000afb0);
}

/** k * (a * sin(b)): FSIN; FMUL float a; FMUL k */
const aks = (k: number, a: number, b: number): number => { sincos87(b, SC); return mulExt(a, SC[0], SC[1]) * k; };
const akc = (k: number, a: number, b: number): number => { sincos87(b, SC); return mulExt(a, SC[2], SC[3]) * k; };
/** 0x1000b0c0 (k1, k2 = 2e-5, 1e-4) and 0x1000b250 (0.03, 6e-5) */
const xs = (k1: number, k2: number): WarpFn => (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return (m.p4 + 0.98) * m.x;
  if (k === 1) return aks(k1, m.x, m.p3 * m.y) + m.p1 * m.x;
  if (k === 2) return aks(k2, m.x, m.p2 * m.y) + m.p1 * m.x;
  return 0;
};
/** 0x1000b140 and 0x1000b2d0 */
const yc = (k1: number, k2: number): WarpFn => (m) => {
  const e = stripe(m.y), k = cx(m).g.g2cff8;
  if (k === 0) return (m.p4 + (e === 0 ? 0.95 : e === 1 ? 0.96 : 0.97)) * m.y;
  if (k === 1) return akc(k1, m.y, m.p3 * m.x) + m.p1 * m.y;
  if (k === 2) return akc(k2, m.y, m.p2 * m.x) + m.p1 * m.y;
  return 0;
};
const cb_1000b0c0 = xs(2e-5, 0.0001), cb_1000b140 = yc(2e-5, 0.0001);
export function fx_1000b1f0(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.02)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.96);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000b0c0, cb_1000b140);
}

const cb_1000b250 = xs(0.03, 6e-5), cb_1000b2d0 = yc(0.03, 6e-5);
export function fx_1000b380(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.02)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000b250, cb_1000b2d0);
}

const F002 = f32(0.02);   // 0x10024870
const cb_1000b3e0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return (m.p4 + 0.95) * m.x;
  if (k === 1) { const j = rndf(cx(m), 0.02); return (j + kc(0.03, m.p3 * m.y)) + m.p1 * m.x; }
  if (k === 2) return (ks(0.03, m.p2 * m.y) + m.p1 * m.x) + m.y * F002;
  return 0;
};
const cb_1000b470: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (k === 0) return (m.p4 + 0.95) * m.y;
  if (k === 1) { const j = rndf(cx(m), 0.02); return (j + ks(0.03, m.p3 * m.x)) + m.p1 * m.y; }
  if (k === 2) return (kc(0.03, m.p2 * m.x) + m.p1 * m.y) + m.x * F002;
  return 0;
};
export function fx_1000b4f0(c: FxCtx): void {
  const p4 = f32(rndf(c, 0.04)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5), p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, 0], 0, 0, cb_1000b3e0, cb_1000b470);
}

const cb_1000b550: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return Math.abs(m.y + 1) * (m.p4 - 0.03) + m.x;
  if (k === 1) { const j = rndf(cx(m), 0.02); return (j + kc(0.03, m.p3 * m.y)) + m.p1 * m.x; }
  if (k === 2) return (ks(0.03, m.p2 * m.y) + m.p1 * m.x) + m.y * F002;
  return 0;
};
const cb_1000b5f0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (k === 0) return m.y * 0.96 + m.p5;
  if (k === 1) { const j = rndf(cx(m), 0.02); return (j + ks(0.03, m.p3 * m.x)) + m.p1 * m.y; }
  if (k === 2) return (kc(0.035, m.p2 * m.x) + m.p1 * m.y) + m.x * F002;
  return 0;
};
export function fx_1000b670(c: FxCtx): void {
  const p5 = f32(rndf(c, 0.03)), p4 = f32(rndf(c, 0.06)), p3 = f32(rndf(c, 50) + 5), p2 = f32(rndf(c, 50) + 5);
  const p1 = f32(rndf(c, 0.03) + 0.97);
  c.newMap([p1, p2, p3, p4, p5], 0, 0, cb_1000b550, cb_1000b5f0);
}

// polar ripples: ((sin(f * r) + 1) * a + 0.92) * r with (f, a) = (p2, p1) or (p4, p3)
const rip = (m: WarpMap, f: number, a: number): number => (as(1, f * m.r) * a + 0.92) * m.r;
/** ((r - (2 * a + 0.9)) * 0.13 + 1) * r */
const bulge = (m: WarpMap, a: number): number => ((m.r - (a + a + 0.9)) * 0.13 + 1) * m.r;
/** theta, jittered by 0x10007190 when p5 == 0 */
const th = (m: WarpMap): number => (m.p5 !== 0 ? m.theta : rnd2(cx(m)) + m.theta);
/** max(f32(1 - r), 0) */
const edge = (m: WarpMap): number => pos(f32(1 - m.r));
/** theta (jittered when p5 == 0) minus edge(r) * 0.035 */
const twist = (m: WarpMap): number => { const a = th(m); return a - edge(m) * 0.035; };
/** p1 * sin(p2 * r) + theta, jittered when p5 == 0 */
const swirl = (m: WarpMap): number => {
  if (m.p5 !== 0) return ks(m.p1, m.p2 * m.r) + m.theta;
  const j = rnd2(cx(m));
  return (j + ks(m.p1, m.p2 * m.r)) + m.theta;
};
const in12 = (k: number): boolean => k > 0 && k <= 2;
/** 0x1000b6e0, 0x1000b810, 0x1000b9c0 */
const cb_1000b6e0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  return k === 0 ? rip(m, m.p2, m.p1) : in12(k) ? rip(m, m.p4, m.p3) : 0;
};
const cb_1000b750: WarpFn = (m) => { const k = cx(m).g.g2cff8; return k === 0 || in12(k) ? th(m) : 0; };
/** p5 = rnd(2) (or rndf(0.1) when !p5i), p4 = rndf(40) + 40, p3 = rndf(p3k), p2 = rndf(40), p1 = rndf(p1k) */
function ripples(c: FxCtx, fn1: WarpFn, fn2: WarpFn, p3k: number, p1k: number, p5i: boolean): void {
  const p5 = p5i ? c.rnd(2) : f32(rndf(c, 0.1));
  const p4 = f32(rndf(c, 40) + 40), p3 = f32(rndf(c, p3k)), p2 = f32(rndf(c, 40)), p1 = f32(rndf(c, p1k));
  c.newMap([p1, p2, p3, p4, p5], 1, 1, fn1, fn2);
}
const cb_1000b880: WarpFn = (m) => { const k = cx(m).g.g2cff8; return k === 0 ? th(m) : in12(k) ? twist(m) : 0; };
const cb_1000ba30: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (in12(k)) return twist(m);
  if (k !== 0) return 0;
  if (m.p5 !== 0) return edge(m) * 0.035 + m.theta;
  const t = edge(m) * 0.035;
  return (rnd2(cx(m)) + t) + m.theta;
};
const cb_1000bba0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return rip(m, m.p2, m.p1);
  if (k === 1) return rip(m, m.p4, m.p3);
  if (k === 2 || k === 3) return (m.p5 + 0.93) * m.r;
  return 0;
};
const cb_1000bc40: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (k === 0) return th(m);
  if (k === 1) { const a = th(m); return a - edge(m) * m.p1 * 0.2; }
  if (k === 2 || k === 3) return m.r * f32(0.01) + m.theta;
  return 0;
};
const cb_1000bda0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0) return rip(m, m.p2, m.p1);
  if (k >= 1 && k <= 3) return bulge(m, m.p3);
  return 0;
};
/** 0x1000be30 and 0x1000c050 */
const cb_1000be30: WarpFn = (m) => {
  const k = cx(m).g.g2cff8;
  if (k === 0) return th(m);
  if (k === 1) return twist(m);
  if (k === 2 || k === 3) return swirl(m);
  return 0;
};
const cb_1000bfc0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 3);
  if (k === 0 || k === 1) return rip(m, m.p4, m.p3);
  if (k === 2 || k === 3) return bulge(m, m.p3);
  return 0;
};
const cb_1000c1e0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  return k === 0 ? rip(m, m.p4, m.p3) : in12(k) ? bulge(m, m.p3) : 0;
};
const cb_1000c260: WarpFn = (m) => { const k = cx(m).g.g2cff8; return k === 0 ? twist(m) : in12(k) ? swirl(m) : 0; };
export const fx_1000b7a0 = (c: FxCtx): void => ripples(c, cb_1000b6e0, cb_1000b750, 0.15, 0.15, true);
export const fx_1000b950 = (c: FxCtx): void => ripples(c, cb_1000b6e0, cb_1000b880, 0.15, 0.15, true);
export const fx_1000bb30 = (c: FxCtx): void => ripples(c, cb_1000b6e0, cb_1000ba30, 0.15, 0.15, true);
export const fx_1000bd40 = (c: FxCtx): void => ripples(c, cb_1000bba0, cb_1000bc40, 0.15, 0.15, false);
export const fx_1000bf50 = (c: FxCtx): void => ripples(c, cb_1000bda0, cb_1000be30, 0.1, 0.08, true);
export const fx_1000c170 = (c: FxCtx): void => ripples(c, cb_1000bfc0, cb_1000be30, 0.1, 0.08, true);
export const fx_1000c340 = (c: FxCtx): void => ripples(c, cb_1000c1e0, cb_1000c260, 0.1, 0.08, true);

const cb_1000c3b0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  return k === 0 || in12(k) ? (ks(0.03, (k === 0 ? m.p1 : m.p2) * m.theta) + 0.95) * m.r : 0;
};
/** 0x1000c410 (q = 0.005) and 0x1000c570 (0.01): theta + p3 * q / r - p4 * r * q */
const spiral = (q: number): WarpFn => (m) => {
  const g = cx(m).g;
  if (m.r === 0) { g.g2cff8 = 0; return m.theta; }
  const k = g.g2cff8;
  if (k === 0) return m.theta;
  return in12(k) ? (m.p3 * q / m.r + m.theta) - m.p4 * m.r * q : 0;
};
const cb_1000c410 = spiral(0.005);
export function fx_1000c470(c: FxCtx): void {
  c.g.g2d000 = 0; c.g.g2d004 = 0;
  const p5 = c.rnd(2);
  const p4 = f32(rndf(c, 2)), p3 = f32(rndf(c, 3)), p2 = f32(rndf(c, 45) + 5), p1 = f32(rndf(c, 5) + 5);
  c.newMap([p1, p2, p3, p4, p5], 1, 1, cb_1000c3b0, cb_1000c410);
}

const cb_1000c4f0: WarpFn = (m) => {
  const k = cx(m).g.g2cff8 = which(m, 2);
  if (in12(k)) return (ks(0.03, m.p2 * m.theta) + 0.95) * m.r;
  if (k !== 0) return 0;
  const j = rnd2(cx(m));
  return j + ((m.r - (m.p1 + m.p1 + 0.9)) * m.p5 + 1) * m.r;
};
const cb_1000c570 = spiral(0.01);
export function fx_1000c5d0(c: FxCtx): void {
  const p5 = f32(rndf(c, 0.3) + 0.03), p4 = f32(rndf(c, 2)), p3 = f32(rndf(c, 3)), p2 = f32(rndf(c, 15) + 5);
  const p1 = f32(rndf(c, 0.01));
  c.newMap([p1, p2, p3, p4, p5], 1, 0, cb_1000c4f0, cb_1000c570);
}

const G4 = [fx_1000d410, fx_1000aba0, fx_1000ac90, fx_1000ad50, fx_1000ae90, fx_1000b060, fx_1000b1f0, fx_1000b380,
  fx_1000b4f0, fx_1000b670, fx_1000b7a0, fx_1000b950, fx_1000bb30, fx_1000bd40, fx_1000bf50, fx_1000c170, fx_1000c340,
  fx_1000c470, fx_1000c5d0];
/** draws rnd(9): leaves 9..18 are never picked */
export const GROUP4: FxGroup = (c) => { const i = c.g.g28f14 = c.rnd(9); G4[i]?.(c); };

// ---- group 3: the setups are inline in the picker (case n at the jump table's n-th target); all square maps
// 64-bit FSIN/FCOS/FPATAN values as [hi, lo], combined at 53 bits by FADDP/FMULP
const E1 = new Float64Array(2), E2 = new Float64Array(2);
const sinx = (a: number, o: Float64Array): Float64Array => { sincos87(a, SC); o[0] = SC[0]; o[1] = SC[1]; return o; };
const cosx = (a: number, o: Float64Array): Float64Array => { sincos87(a, SC); o[0] = SC[2]; o[1] = SC[3]; return o; };
/** FLD a; FLD1; FPATAN: atan(a) */
const atnx = (a: number, o: Float64Array): Float64Array => { atan2_87(a, 1, o); return o; };
const add2 = (p: Float64Array, q: Float64Array): number => addExt(p[0], q[0], q[1] + p[1]);
const mul2 = (p: Float64Array, q: Float64Array): number => A.fma(p[0], q[0], p[0] * q[1] + p[1] * q[0]);
/** FLDL2E; FMULP; ...; FSCALE: e^v rounded to a double (log2(e) is the FPU's 64-bit constant) */
const exp87 = (v: number): number => Math.pow(2, mulExt(v, 1.4426950408889634, 2.0383000842727483e-17));
// ponytail: Math.pow(2, t) stands for 1 + F2XM1(frac) rounded, then FSCALE; equal unless pow misrounds

const cb_1000da20: WarpFn = (m) => ks(0.01, m.p1 * m.y * m.x) + m.x * 0.97;
const cb_1000da50: WarpFn = (m) => kc(0.01, m.p2 * m.y * m.x) + m.y * 0.97;
const cb_1000dad0: WarpFn = (m) => ks(0.01, m.p1 * m.y * m.x) + m.x;
const cb_1000daf0: WarpFn = (m) => kc(0.01, m.p2 * m.y * m.x) + m.y;
const cb_1000db60: WarpFn = (m) => { const c = cx(m), a = rndf(c, 0.01) + m.x; return a - rndf(c, 0.01); };
const cb_1000db90: WarpFn = (m) => { const c = cx(m), a = rndf(c, 0.01) + m.y; return a - rndf(c, 0.01); };
const cb_1000dbf0: WarpFn = (m) => m.x;
const cb_1000dc00: WarpFn = (m) => m.y;
const cb_1000dca0: WarpFn = (m) => kc(0.05, m.p2 * m.x) + m.y;
const cb_1000dd60: WarpFn = (m) => ks(0.01, m.p1 * m.y) + m.x * 0.98;
const cb_1000dd80: WarpFn = (m) => (kc(0.01, m.p2 * m.x) + m.y) + 0.03;
function cb_1000ddf0(m: WarpMap): number { return (kc(0.05, m.p2 * m.x) + m.x * 0.01) + m.y; }
const cb_1000ded0: WarpFn = (m) => ks(0.05, m.p1 * m.y * m.x) + m.x * 0.98;
const cb_1000df00: WarpFn = (m) => (kc(0.05, m.p2 * m.x * m.x) + m.x * 0.01) + m.y;
const cb_1000df80: WarpFn = (m) => ks(0.05, m.p1 * m.y * m.x * m.x) + m.x * 0.98;
const cb_1000dfb0: WarpFn = (m) => (kc(0.05, m.p2 * m.y * m.y * m.x) + m.x * 0.01) + m.y;
const cb_1000e030: WarpFn = (m) => ks(0.05, m.p1 * m.x * m.x) + m.x * 0.98;
const cb_1000e050: WarpFn = (m) => (kc(0.05, m.p2 * m.y * m.y) + m.x * 0.01) + m.y;
const cb_1000e0d0: WarpFn = (m) => { atnx(m.p1 * m.y, E1); return mulExt(0.05, E1[0], E1[1]) + m.x * 0.98; };
const cb_1000e100: WarpFn = (m) => { atnx(m.p2 * m.x, E1); return (mulExt(0.05, E1[0], E1[1]) + m.x * 0.01) + m.y; };
const cb_1000e1d0: WarpFn = (m) => (exp87(m.y) * 0.01 + 0.98) * m.x;
const cb_1000e200: WarpFn = (m) => exp87(m.y) * m.x * 0.01 + m.y;
const cb_1000e350: WarpFn = (m) => add2(sinx(m.p1 * m.x, E1), atnx(m.y, E2)) * 0.01 + m.x * 0.97;
const cb_1000e3d0: WarpFn = (m) => add2(sinx(m.p2 * m.y, E1), atnx(m.x, E2)) * 0.01 + m.y * 0.97;
const cb_1000e450: WarpFn = (m) => { const a = m.p1 * m.x; return add2(sinx(a, E1), cosx(a, E2)) * 0.003 + m.x * 0.97; };
const cb_1000e480: WarpFn = (m) => { const a = m.p2 * m.y; return add2(sinx(a, E1), cosx(a, E2)) * 0.003 + m.y * 0.97; };
const cb_1000e500: WarpFn = (m) => add2(atnx(m.p2 * m.y, E1), sinx(m.p1 * m.x, E2)) * 0.01 + m.x * 0.97;
const cb_1000e530: WarpFn = (m) => add2(sinx(m.p2 * m.y, E1), atnx(m.p1 * m.x, E2)) * 0.01 + m.y * 0.97;
const cb_1000e5d0: WarpFn = (m) => add2(cosx(m.p2 * m.y, E1), sinx(m.p1 * m.x, E2)) * 0.01 + m.x * 0.97;
const cb_1000e650: WarpFn = (m) => add2(cosx(m.p2 * m.x, E1), sinx(m.p1 * m.x, E2)) * 0.01 + m.x * 0.97;
const cb_1000e680: WarpFn = (m) => add2(sinx(m.p2 * m.y, E1), cosx(m.p1 * m.y, E2)) * 0.01 + m.y * 0.97;
const cb_1000e700: WarpFn = (m) => mul2(cosx(m.p2 * m.y, E1), sinx(m.p1 * m.x, E2)) * 0.01 + m.x * 0.97;
const cb_1000e730: WarpFn = (m) => mul2(sinx(m.p2 * m.y, E1), cosx(m.p1 * m.x, E2)) * 0.01 + m.y * 0.97;
const cb_1000e7b0: WarpFn = (m) => jit(m, (m) => (as(1, m.p1 * m.theta) * 0.03 + 0.93) * m.r);
const cb_1000e840: WarpFn = (m) => m.r * 0.015 + m.theta;
const cb_1000e950: WarpFn = (m) => add2(sinx(m.p2 * m.y, E1), cosx(m.p1 * m.x, E2)) * 0.01 + m.y * 0.97;
const cb_1000ea20: WarpFn = (m) => mul2(cosx(m.p2 * m.y, E1), sinx(m.p1 * m.x, E2)) * 0.01 + m.x * 0.99;
const cb_1000eaa0: WarpFn = (m) => mul2(sinx(m.p2 * m.y, E1), cosx(m.p1 * m.x, E2)) * 0.01 + m.y * 0.99;

/** a square cartesian map with p2 = rndf(k2) + a2 (drawn first), p1 = rndf(k1) + a1 */
function sq2(c: FxCtx, fn1: WarpFn, fn2: WarpFn, k2: number, a2: number, k1: number, a1: number): void {
  const p2 = f32(rndf(c, k2) + a2), p1 = f32(rndf(c, k1) + a1);
  c.newMap([p1, p2, 0, 0, 0], 0, 1, fn1, fn2);
}
const sq0 = (c: FxCtx, fn1: WarpFn, fn2: WarpFn): void => { c.newMap([0, 0, 0, 0, 0], 0, 1, fn1, fn2); };
const G3: ((c: FxCtx) => void)[] = [
  (c) => sq2(c, cb_1000da20, cb_1000da50, 100, 5, 100, 5),
  (c) => sq2(c, cb_1000dad0, cb_1000daf0, 100, 5, 100, 5),
  (c) => sq0(c, cb_1000db60, cb_1000db90),
  (c) => { sq0(c, cb_1000dbf0, cb_1000dc00); c.g.g28fd0 = pick(c, [17, 0, 8, 4, 9, 10, 3, 11, 13, 21]); },
  (c) => sq2(c, cb_1000ce40, cb_1000dca0, 100, 5, 100, 5),
  (c) => sq2(c, cb_1000ce40, cb_1000ce60, 10, 5, 10, 5),
  (c) => sq2(c, cb_1000dd60, cb_1000dd80, 10, 5, 10, 5),
  (c) => {
    sq2(c, cb_1000d220, cb_1000ddf0, 5, 2, 5, 2);
    c.g.g28fd0 = pick(c, [17, 8, 11, 9, 13, 10, 15, 19, 3, 1, 21]);
  },
  (c) => sq2(c, cb_1000ded0, cb_1000df00, 50, 5, 50, 5),
  (c) => sq2(c, cb_1000df80, cb_1000dfb0, 50, 5, 50, 5),
  (c) => sq2(c, cb_1000e030, cb_1000e050, 50, 5, 50, 5),
  (c) => {
    sq2(c, cb_1000e0d0, cb_1000e100, 50, 5, 50, 5);
    c.g.gad3ec = 1; c.g.g28f98 = 3;
    c.g.g28fd0 = pick(c, [9, 10, 11, 18, 19, 21]);
  },
  (c) => sq0(c, cb_1000e1d0, cb_1000e200),
  (c) => sq2(c, cb_1000e350, cb_1000e3d0, 100, 5, 100, 5),
  (c) => sq2(c, cb_1000e350, cb_1000e3d0, 5, 5, 5, 5),
  // rnd(15) never picks the rest
  (c) => sq2(c, cb_1000e350, cb_1000e3d0, 100, 100, 100, 100),
  (c) => sq2(c, cb_1000e350, cb_1000e3d0, 5, 5, 100, 100),
  (c) => sq2(c, cb_1000e350, cb_1000e3d0, 100, 100, 5, 5),
  (c) => sq2(c, cb_1000e450, cb_1000e480, 50, 5, 50, 5),
  (c) => { sq2(c, cb_1000e500, cb_1000e530, 100, 5, 100, 5); c.g.g28fd0 = pick(c, [9, 10, 11]); },
  (c) => sq2(c, cb_1000e5d0, cb_1000e950, 100, 5, 100, 5),
  (c) => sq2(c, cb_1000e650, cb_1000e680, 100, 5, 100, 5),
  (c) => sq2(c, cb_1000e700, cb_1000e730, 100, 5, 100, 5),
  (c) => { const p5 = c.rnd(2); c.newMap([f32((rndf(c, 5) + 8) * PI), 0, 0, 0, p5], 1, 0, cb_1000e7b0, cb_1000e840); },
  (c) => sq2(c, cb_1000e5d0, cb_1000e950, 100, 100, 100, 100),
  (c) => sq2(c, cb_1000e5d0, cb_1000e950, 5, 5, 100, 100),
  (c) => sq2(c, cb_1000e5d0, cb_1000e950, 100, 100, 5, 5),
  (c) => sq2(c, cb_1000e700, cb_1000e730, 100, 100, 100, 100),
  (c) => sq2(c, cb_1000ea20, cb_1000eaa0, 5, 5, 100, 100),
  (c) => sq2(c, cb_1000ea20, cb_1000eaa0, 100, 100, 5, 5),
];
/** draws rnd(15): setups 15..29 are never picked */
export const GROUP3: FxGroup = (c) => { const i = c.g.g28f14 = c.rnd(15); G3[i]?.(c); };
/** the group-3 setups by index, for tests */
export const fx3 = G3;
