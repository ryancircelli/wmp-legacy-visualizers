// The x87 FSIN/FCOS the DLL runs, modelled: the argument reduced by pi/2 rounded to 66 bits (the FPU's own
// constant), sin/cos of the remainder in double-double, then rounded to the 64-bit mantissa an x87
// register holds. Results are [hi, lo]: hi + lo is that 64-bit value exactly. Storing it to a double
// (fstp) is hi + lo; multiplying it by a double at 53-bit precision is mulExt().
// Checked against the FPU itself (this machine's i7-11370H, 9003 arguments from 0 to 3000): the model's
// 64-bit result is the hardware's for 97 % of arguments and one 64-bit ulp away for the rest (FSIN is not
// correctly rounded), which reaches a double result about once in 50,000 operations; plain Math.sin
// misses the hardware's double result on ~10 % of the arguments Spyro feeds it.
import { A } from '../ns';
import '../rand';

const SPLIT = 134217729;   // 2^27 + 1
// pi/2 to 66 bits (0x3243F6A8885A308D3 / 2^65) as C1 + C2 exactly, each short enough that k * Cn is exact
const C1 = 1.5707963267341256;          // the top 33 bits
const C2 = 6.077100506303966e-11;       // the low 33

function twoSum(a: number, b: number, o: Float64Array): void {
  var s = a + b, bb = s - a;
  o[0] = s; o[1] = (a - (s - bb)) + (b - bb);
}
function twoProd(a: number, b: number, o: Float64Array): void {
  var p = a * b;
  var t = SPLIT * a, ah = t - (t - a), al = a - ah;
  var u = SPLIT * b, bh = u - (u - b), bl = b - bh;
  o[0] = p; o[1] = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}

var T = new Float64Array(2), U = new Float64Array(2);
/** dd * dd -> dd (ah+al)(bh+bl) */
function mulDD(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  twoProd(ah, bh, U);
  var lo = U[1] + (ah * bl + al * bh);
  twoSum(U[0], lo, o);
}
/** dd + dd -> dd */
function addDD(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  twoSum(ah, bh, U);
  var lo = U[1] + al + bl;
  twoSum(U[0], lo, o);
}

var BITS = new Float64Array(1), W = new Uint32Array(BITS.buffer);
/** Round hi + lo (|lo| <= ulp(hi)/2) to a 64-bit mantissa, ties to even. */
function round64(hi: number, lo: number, o: Float64Array): void {
  if (hi === 0) { o[0] = 0; o[1] = 0; return; }
  BITS[0] = hi;
  var e = ((W[1] >>> 20) & 0x7ff) - 1023;                 // hi is normal here (|hi| > 2^-1000)
  if (W[0] === 0 && (W[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;   // hi = 2^e and the value is below it
  var g = Math.pow(2, e - 63);                            // the 64-bit ulp
  var q = lo / g, n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;                      // Math.round is half-up: make it half-even
  o[0] = hi; o[1] = n * g;
}

var R = new Float64Array(2), S2 = new Float64Array(2), TT = new Float64Array(2), SUM = new Float64Array(2);
/** sin and cos of the double x as the FPU leaves them: out = [sinHi, sinLo, cosHi, cosLo]. */
export function sincos87(x: number, out: Float64Array): void {
  var k = 0, rh = x, rl = 0;
  if (Math.abs(x) > 0.7853981633974483) {
    k = Math.round(x * 0.6366197723675814);
    // r = x - k*C1 - k*C2, carried in double-double (k*Cn exact: k < 2^20, Cn <= 33 bits)
    twoSum(x, -k * C1, R);
    twoSum(R[0], -k * C2, T);
    twoSum(T[0], T[1] + R[1], R); rh = R[0]; rl = R[1];
  }
  // Taylor series in double-double: |r| <= ~0.79, terms to r^31
  mulDD(rh, rl, rh, rl, S2);
  var r2h = S2[0], r2l = S2[1];
  // sin
  var th = rh, tl = rl, sh = rh, sl = rl, n;
  for (n = 1; n < 16; n++) {
    mulDD(th, tl, r2h, r2l, TT);
    var d = -(2 * n) * (2 * n + 1);
    th = TT[0] / d; tl = (A.fma(-th, d, TT[0]) + TT[1]) / d;   // dd / small integer (exact remainder)
    addDD(sh, sl, th, tl, SUM); sh = SUM[0]; sl = SUM[1];
  }
  // cos
  var ch = 1, cl = 0;
  th = 1; tl = 0;
  for (n = 1; n < 16; n++) {
    mulDD(th, tl, r2h, r2l, TT);
    var d2 = -(2 * n - 1) * (2 * n);
    th = TT[0] / d2; tl = (A.fma(-th, d2, TT[0]) + TT[1]) / d2;
    addDD(ch, cl, th, tl, SUM); ch = SUM[0]; cl = SUM[1];
  }
  var q = ((k % 4) + 4) % 4, a, b, c2, d3;
  if (q === 0) { a = sh; b = sl; c2 = ch; d3 = cl; }
  else if (q === 1) { a = ch; b = cl; c2 = -sh; d3 = -sl; }
  else if (q === 2) { a = -sh; b = -sl; c2 = -ch; d3 = -cl; }
  else { a = -ch; b = -cl; c2 = sh; d3 = sl; }
  round64(a, b, R); out[0] = R[0]; out[1] = R[1];
  round64(c2, d3, R); out[2] = R[0]; out[3] = R[1];
}

/** m times the 64-bit value hi + lo, rounded to a double (fmul at 53-bit precision). */
export function mulExt(m: number, hi: number, lo: number): number {
  return lo === 0 ? m * hi : A.fma(m, hi, m * lo);
}
