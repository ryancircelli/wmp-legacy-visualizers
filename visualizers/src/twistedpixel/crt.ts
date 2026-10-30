// The DLL's statically linked CRT routines the engine calls, at the x87's 24-bit precision.
import { A } from '../ns';
import { f32x } from './fpu';

// ---- double-double helpers (for the x87's 64-bit transcendentals) ----
export function two(a: number, b: number, o: Float64Array): void { const s = a + b, bb = s - a; o[0] = s; o[1] = (a - (s - bb)) + (b - bb); }
function prod(a: number, b: number, o: Float64Array): void { const p = a * b; o[0] = p; o[1] = A.fma(a, b, -p); }
const T1 = new Float64Array(2), T2 = new Float64Array(2), T3 = new Float64Array(2);
function ddMul(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  prod(ah, bh, T1); two(T1[0], T1[1] + (ah * bl + al * bh), o);
}
function ddAdd(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  two(ah, bh, T1); two(T1[0], T1[1] + al + bl, o);
}
function ddDiv(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  const q = ah / bh;
  ddMul(q, 0, bh, bl, T3);
  const r = ((ah - T3[0]) - T3[1] + al) / bh;
  two(q, r, o);
}
/** round hi + lo to the x87's 64-bit significand (ties to even); result as hi + lo */
const BITS = new Float64Array(1), WB = new Uint32Array(BITS.buffer);
function round64(hi: number, lo: number, o: Float64Array): void {
  if (hi === 0 || lo === 0) { o[0] = hi; o[1] = lo; return; }
  BITS[0] = hi;
  let e = ((WB[1] >>> 20) & 0x7ff) - 1023;
  if (WB[0] === 0 && (WB[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;
  const g = Math.pow(2, e - 63), q = lo / g;
  let n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;
  two(hi, n * g, o);
}
// ln 2 and 1/ln 2 as double-doubles; LN2_64 is FLDLN2's 64-bit constant (0xB17217F7D1CF79AC / 2^64)
const LN2_HI = 0.6931471805599453, LN2_LO = 2.3190468138462996e-17;
const LG2E_HI = 1.4426950408889634, LG2E_LO = 2.0355273740931033e-17;
const LN2_64_HI = Number(0xB17217F7D1CF79ACn >> 11n) * Math.pow(2, -53), LN2_64_LO = Number(0xB17217F7D1CF79ACn & 0x7FFn) * Math.pow(2, -64);

/** log2(x) for a positive double, as a double-double good to ~100 bits */
const LG = new Float64Array(2), S = new Float64Array(2), S2 = new Float64Array(2), TT = new Float64Array(2), SUM = new Float64Array(2);
function log2dd(x: number, o: Float64Array): void {
  let e = Math.floor(Math.log2(x)), m = x / Math.pow(2, e);
  if (m >= 2) { m /= 2; e++; } else if (m < 1) { m *= 2; e--; }
  if (m > Math.SQRT2) { m /= 2; e++; }
  two(m, 1, T2);                                  // m + 1 exactly
  ddDiv(m - 1, 0, T2[0], T2[1], S);               // s = (m-1)/(m+1); ln m = 2 atanh s
  ddMul(S[0], S[1], S[0], S[1], S2);
  let th = S[0], tl = S[1], sh = S[0], sl = S[1];
  for (let k = 3; k < 80; k += 2) {
    ddMul(th, tl, S2[0], S2[1], TT); th = TT[0]; tl = TT[1];
    const qh = th / k, ql = (A.fma(-qh, k, th) + tl) / k;
    if (Math.abs(qh) < Math.abs(sh) * 1e-34) break;
    ddAdd(sh, sl, qh, ql, SUM); sh = SUM[0]; sl = SUM[1];
  }
  ddMul(2 * sh, 2 * sl, LG2E_HI, LG2E_LO, LG);    // ln m / ln 2
  ddAdd(LG[0], LG[1], e, 0, o);
}
/** 2^f - 1 for |f| <= 1 as a double-double (F2XM1's exact value) */
function exp2m1dd(f: number, o: Float64Array): void {
  ddMul(f, 0, LN2_HI, LN2_LO, S);                 // z = f ln 2
  let th = S[0], tl = S[1], sh = S[0], sl = S[1];
  for (let k = 2; k < 40; k++) {
    ddMul(th, tl, S[0], S[1], TT);
    th = TT[0] / k; tl = (A.fma(-th, k, TT[0]) + TT[1]) / k;
    if (Math.abs(th) < 1e-36) break;
    ddAdd(sh, sl, th, tl, SUM); sh = SUM[0]; sl = SUM[1];
  }
  o[0] = sh; o[1] = sl;
}

const PT = new Float64Array(2), PL = new Float64Array(2), PE = new Float64Array(2);
/** The static CRT's pow (0x10029022) as it runs at 24-bit precision, for x > 0 (and x = 0, y > 0):
 *  t = FYL2X(x, y) (64-bit), n = FRNDINT(t), f = t - n rounded to 24 bits, r = (1 + F2XM1(f)) rounded to 24 bits,
 *  result r * 2^n (FSCALE). Returns the x87 value (a 24-bit significand) as a number. */
export function pow87(x: number, y: number): number {
  if (x === 0) return 0;
  log2dd(x, PL);
  ddMul(PL[0], PL[1], y, 0, PT);
  round64(PT[0], PT[1], PT);                      // FYL2X's 64-bit result
  let n = Math.round(PT[0]);                      // FRNDINT: nearest, ties to even
  const d = (PT[0] - n) + PT[1];
  if (d > 0.5 || (d === 0.5 && (n & 1))) n++;
  else if (d < -0.5 || (d === -0.5 && (n & 1))) n--;
  two(PT[0] - n, PT[1], T2);                      // t - n (PT[0] - n is exact)
  const fr = f32x(T2[0], T2[1]);                  // FSUBR at 24 bits
  exp2m1dd(fr, PE);
  round64(PE[0], PE[1], PE);                      // F2XM1's 64-bit result
  two(PE[0], 1, T2);
  const r = f32x(T2[0], T2[1] + PE[1]);           // FLD1 / FADDP at 24 bits
  return r * Math.pow(2, n);
}

/** FYL2X(x, FLDLN2) = ln(x) to 64 bits */
export function ln87(x: number, o: Float64Array): void {
  log2dd(x, PL);
  ddMul(PL[0], PL[1], LN2_64_HI, LN2_64_LO, o);
  round64(o[0], o[1], o);
}

