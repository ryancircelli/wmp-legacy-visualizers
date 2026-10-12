// The x87 transcendentals WMP 8-10's Battery runs inline, for the variant presets (index.ts GROUPS). FSIN, FCOS,
// FPATAN and FPTAN deliver a 64-bit-mantissa result whatever the precision control says; the next arithmetic op
// (at the process's 53-bit precision) or a store rounds it. Results here are [hi, lo] with hi + lo that 64-bit
// value exactly: storing it to a double is hi + lo, multiplying it by a double at 53 bits is mulExt(m, hi, lo).
// FSIN/FCOS are Plenoptic's model (../plenoptic/x87.ts, checked against the FPU); FPATAN and FPTAN are built on it:
// a double estimate refined once in double-double, then rounded to 64 bits.
import { A } from '../ns';
import '../rand';
import { sincos87, mulExt } from '../plenoptic/x87';
export { sincos87, mulExt };

const SPLIT = 134217729;   // 2^27 + 1
function twoProd(a: number, b: number, o: Float64Array): void {
  var p = a * b;
  var t = SPLIT * a, ah = t - (t - a), al = a - ah;
  var u = SPLIT * b, bh = u - (u - b), bl = b - bh;
  o[0] = p; o[1] = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
function twoSum(a: number, b: number, o: Float64Array): void {
  var s = a + b, bb = s - a;
  o[0] = s; o[1] = (a - (s - bb)) + (b - bb);
}
var BITS = new Float64Array(1), W = new Uint32Array(BITS.buffer);
/** hi + lo (|lo| <= ulp(hi)/2) rounded to a 64-bit mantissa, ties to even; o = [hi, lo'] */
function round64(hi: number, lo: number, o: Float64Array): void {
  if (hi === 0) { o[0] = 0; o[1] = 0; return; }
  BITS[0] = hi;
  var e = ((W[1] >>> 20) & 0x7ff) - 1023;
  if (W[0] === 0 && (W[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;
  var g = Math.pow(2, e - 63);
  var q = lo / g, n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;
  o[0] = hi; o[1] = n * g;
}

var PI64_LO = 565 * Math.pow(2, -62);
var SC = new Float64Array(4), P = new Float64Array(2), Q = new Float64Array(2), R = new Float64Array(2);
/** FPATAN of (y, x) = atan2(y, x), as [hi, lo] (64-bit) */
export function atan2_87(y: number, x: number, out: Float64Array): void {
  var t0 = Math.atan2(y, x);
  // on the negative x axis FPATAN returns pi to 64 bits (0xC90FDAA22168C235), 565 * 2^-62 above the double pi
  if (y === 0 && x < 0) { out[0] = t0; out[1] = t0 < 0 ? -PI64_LO : PI64_LO; return; }
  if (y === 0 || x === 0 || !isFinite(t0)) { out[0] = t0; out[1] = 0; return; }
  sincos87(t0, SC);                                   // sin, cos of the estimate to 64 bits
  var s = SC[0] + SC[1], sl = SC[1] - (s - SC[0]), c = SC[2] + SC[3], cl = SC[3] - (c - SC[2]);
  // tan(theta - t0) = (y cos t0 - x sin t0) / (x cos t0 + y sin t0); the numerator cancels, so exactly
  twoProd(y, c, P); twoProd(x, s, Q);
  var num = ((P[0] - Q[0]) + (P[1] - Q[1])) + (y * cl - x * sl);
  var den = x * c + y * s;
  twoSum(t0, num / den, R);
  round64(R[0], R[1], out);
}

/** FPTAN of x = tan x, as [hi, lo] (64-bit) */
export function tan87(x: number, out: Float64Array): void {
  sincos87(x, SC);
  var sh = SC[0], sl = SC[1], ch = SC[2], cl = SC[3];
  var q1 = sh / ch;
  twoProd(q1, ch, P);
  var rem = ((sh - P[0]) - P[1]) + sl - q1 * cl;
  twoSum(q1, rem / ch, R);
  round64(R[0], R[1], out);
}

/** the 64-bit value stored to a double (fstp qword): round-to-nearest of hi + lo */
export function store53(v: Float64Array, i?: number): number { var k = i || 0; return v[k] + v[k + 1]; }

/** m * (hi + lo) with ONE rounding to 53 bits: an x87 fmul of a 64-bit register by a double at PC53 */
export function mul87(m: number, hi: number, lo: number): number { return mulExt(m, hi, lo); }

/** fused multiply-add, one rounding (rand.ts's) */
export function fma(a: number, b: number, c: number): number { return A.fma(a, b, c); }
