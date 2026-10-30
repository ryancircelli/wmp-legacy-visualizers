// TwistedPixel's script host functions: the methods of its "MilkdropVars" dispatch object (dispids 141-195) that
// presets call (above, pow, rand, iif, ...), computed the way TwistedPixel.dll computes them.
//
// The DLL calls each through DispCallFunc as cdecl fn(object, args...) (thunk 0x10005810); a Single result is left
// in ST0 and stored with `fstp dword` (one rounding of the x87 register to float32), Integer/Long results are EAX.
// All of it runs at the x87 control word 0x007F (24-bit precision, see fpu.ts):
// - inline code (0x100258e0-0x10025ec0): FADD/FSUB/FMUL/FDIV/FSQRT round to 24 bits but keep the register's
//   exponent range (no float overflow or denormal in between: r24 below); FPATAN, FYL2X and F2XM1 deliver 64 bits.
// - the statically linked CRT: acos, asin and _CIpow keep the caller's precision control (0x1002d3c5), so they
//   compute at 24 bits too; sinh/cosh/tanh (0x1002d180) and _hypot switch to 64-bit precision; floor and ceil
//   switch to 64 bits with directed rounding (exact). acos, asin, sinh, cosh and tanh leave through the CRT's
//   precision-exception check (0x1002d45b, 0x1002f44a): the x87 precision flag is sticky, so it is always set by
//   then, and the handler stores the result to a double and reloads it: those return float(double(x87 value)).
// - _ftol (0x10028820) truncates with FISTP qword and returns the low dword: out-of-int32 values wrap, NaN and
//   |x| >= 2^63 give 0.
// NaN results are plain JS NaN (the DLL's payloads and signs are not kept).
import { A } from '../ns';
import '../rand';
import { f32x } from './fpu';
import { atan2_87 } from '../battery/x87';

const f = Math.fround;
const E48 = Math.pow(2, -48);

// ---------------------------------------------------------------- 24-bit precision with the x87 exponent range
const T127 = Math.pow(2, 127), T125 = Math.pow(2, -125);
/** v * 2^k (exact while the result stays a normal double) */
function scl(v: number, k: number): number {
  while (k > 1000) { v *= Math.pow(2, 1000); k -= 1000; }
  while (k < -1000) { v *= Math.pow(2, -1000); k += 1000; }
  return v * Math.pow(2, k);
}
/** v rounded to a 24-bit significand, any exponent (an x87 register at precision control 24) */
export function r24(v: number): number {
  const a = Math.abs(v);
  if ((a < T127 && a >= T125) || a === 0 || a === Infinity || a !== a) return f(v);
  const e = Math.floor(Math.log2(a));
  return scl(f(scl(v, -e)), e);
}
/** hi + lo (|lo| <= ulp(hi) / 2) rounded once to a 24-bit significand, any exponent */
export function r24x(hi: number, lo: number): number {
  const a = Math.abs(hi);
  if ((a < T127 && a >= T125) || a === 0 || a === Infinity || a !== a) return f32x(hi, lo);
  const e = Math.floor(Math.log2(a));
  return scl(f32x(scl(hi, -e), scl(lo, -e)), e);
}

// ---------------------------------------------------------------- double-double helpers (results in H, L)
let H = 0, L = 0;
function twoSum(a: number, b: number): void { const s = a + b, bb = s - a; H = s; L = (a - (s - bb)) + (b - bb); }
function ddAdd(ah: number, al: number, bh: number, bl: number): void { twoSum(ah, bh); const l = L + al + bl; twoSum(H, l); }
function ddMul(ah: number, al: number, bh: number, bl: number): void {
  const p = ah * bh, e = A.fma(ah, bh, -p) + (ah * bl + al * bh);
  twoSum(p, e);
}
function ddDiv(ah: number, al: number, bh: number, bl: number): void {
  const q = ah / bh;
  ddMul(q, 0, bh, bl);
  const r = ((ah - H) - L + al) / bh;
  twoSum(q, r);
}
const BITS = new Float64Array(1), W = new Uint32Array(BITS.buffer);
/** H, L := hi + lo rounded to a 64-bit significand, ties to even (an x87 register at full precision) */
function round64(hi: number, lo: number): void {
  twoSum(hi, lo); hi = H; lo = L;
  if (hi === 0 || !isFinite(hi)) { H = hi; L = 0; return; }
  BITS[0] = hi;
  let e = ((W[1] >>> 20) & 0x7ff) - 1023;
  if (e === -1023) { H = hi; L = 0; return; }                // a double denormal: below every 64-bit ulp we meet
  if (W[0] === 0 && (W[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;
  const g = Math.pow(2, e - 63), q = lo / g;
  let n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;
  H = hi; L = n * g;
}

// x87 constants, 64-bit (FLDLN2, FLDLG2, FLDL2E) as hi + lo exactly; LN2 and LOG2E to double-double precision
const LN2_64H = 0.6931471805599453, LN2_64L = 2.3201926491189795e-17;
const LG2_64H = 0.3010299956639812, LG2_64L = -2.791820594150174e-18;
const L2E_64H = 1.4426950408889634, L2E_64L = 2.0383000842727483e-17;
const LN2H = 0.6931471805599453, LN2L = 2.3190468138462996e-17;
const LOG2EH = 1.4426950408889634, LOG2EL = 2.0355273740931033e-17;

/** H, L := ln(y) to ~100 bits, y > 0 finite */
function lnDD(y: number): void {
  BITS[0] = y;
  let e = ((W[1] >>> 20) & 0x7ff) - 1023, m: number;
  if (e === -1023) { BITS[0] = y * Math.pow(2, 64); e = ((W[1] >>> 20) & 0x7ff) - 1023 - 64; }
  W[1] = (W[1] & 0x800fffff) | (1023 << 20); m = BITS[0];        // m in [1, 2)
  if (m > Math.SQRT2) { m /= 2; e++; }
  // ln m = 2 atanh(s), s = (m - 1) / (m + 1); m - 1 and m + 1 are exact for m of up to 52 bits
  const nu = m - 1, de = m + 1;
  const sh = nu / de, sl = A.fma(-sh, de, nu) / de;
  ddMul(sh, sl, sh, sl); const zh = H, zl = L;
  let ph = 1 / 45, pl = A.fma(-ph, 45, 1) / 45;
  for (let k = 21; k >= 0; k--) {
    ddMul(ph, pl, zh, zl);
    const d = 2 * k + 1, ch = 1 / d, cl = A.fma(-ch, d, 1) / d;
    ddAdd(H, L, ch, cl); ph = H; pl = L;
  }
  ddMul(ph, pl, sh, sl); const th = 2 * H, tl = 2 * L;
  ddMul(LN2H, LN2L, e, 0);
  ddAdd(H, L, th, tl);
}
/** H, L := FYL2X with ST1 = c (64-bit, hi + lo) and ST0 = y: c * log2(y), rounded to 64 bits */
function fyl2x(ch: number, cl: number, y: number): void {
  if (!(y > 0) || y === Infinity || y === 1 || ch === 0) {
    const l = y === 1 ? 0 : Math.log2(y);                        // NaN, -inf, inf; 0 * log2 keeps the signs
    H = l === 0 ? ((ch < 0) !== Object.is(l, -0) ? -0 : 0) : ch * l; L = 0;
    if (y === 1) H = ch < 0 ? -0 : 0;
    return;
  }
  lnDD(y); const lh = H, ll = L;
  ddMul(ch, cl, LOG2EH, LOG2EL);
  ddMul(lh, ll, H, L);
  round64(H, L);
}
/** H, L := F2XM1(x) = 2^x - 1 for |x| <= 1, rounded to 64 bits */
function f2xm1(x: number): void {
  if (x === 0) { H = x; L = 0; return; }
  ddMul(x, 0, LN2H, LN2L);
  const zh = H, zl = L;
  let th = zh, tl = zl, sh = zh, sl = zl;
  for (let k = 2; k < 30; k++) {
    ddMul(th, tl, zh, zl);
    th = H / k; tl = (A.fma(-th, k, H) + L) / k;
    ddAdd(sh, sl, th, tl); sh = H; sl = L;
    if (Math.abs(th) < Math.abs(sh) * 1e-34) break;
  }
  round64(sh, sl);
}
/** round to an integer, ties to even (FRNDINT at round-to-nearest) */
function rint(v: number): number {
  const n = Math.round(v);
  return (n - v === 0.5 && (n & 1)) ? n - 1 : n;
}
/** fround(v) when everything within 2^-48 relative of v rounds to the same float (else NaN: take the exact path) */
function sure(v: number): number {
  const a = f(v * (1 - E48)), b = f(v * (1 + E48));
  return a === b ? a : NaN;
}

/** the CRT's log (0x1002e754) for x > 0: FLDLN2, FYL2X (64 bits), stored to a double */
export function ln87(x: number): number { fyl2x(LN2_64H, LN2_64L, x); return H + L; }

// ---------------------------------------------------------------- the CRT pieces
/** _ftol (0x10028820): truncate, low dword of the 64-bit integer; NaN and |v| >= 2^63 give 0 */
export function ftol(v: number): number {
  return Math.abs(v) < 9223372036854775808 ? Math.trunc(v) | 0 : 0;
}

/** round24(2^fr) for |fr| <= 0.5: F2XM1 then FLD1/FADDP at 24-bit precision (exp and _CIpow's tail) */
function exp2frac(fr: number): number {
  if (fr === 0) return 1;
  const h = sure(Math.exp(fr * Math.LN2));
  if (h === h) return h;
  f2xm1(fr);
  twoSum(1, H); const sh = H, sl = L + 0;
  twoSum(sh, sl);
  return r24x(H, L);
}
/** h * 2^n as the x87 FSCALE leaves it (h has 24 bits), saturated to inf / 0 far outside the double range */
function scale(h: number, n: number): number {
  if (n > 2000) return h * Infinity;
  if (n < -2000) return h * 0;
  if (n > 1000) return h * Math.pow(2, 1000) * Math.pow(2, n - 1000);
  if (n < -1000) return h * Math.pow(2, -1000) * Math.pow(2, n + 1000);
  return h * Math.pow(2, n);
}

/**
 * _CIpow (0x10029000) at 24-bit precision: x^y as the x87 register holds it on return (a 24-bit significand times a
 * power of two; the caller's fstp/fmul does the rest). y log2|x| by FYL2X (64 bits), n = FRNDINT of it, the
 * remainder rounded to 24 bits by the FSUBR, then F2XM1, +1 at 24 bits, FSCALE by n; negated for a negative x and
 * an odd integer y; a negative x with a non-integer y is a domain error (NaN).
 */
export function ciPow(x: number, y: number): number {
  if (y !== y || x !== x) return NaN;
  if (y === 0) return 1;
  let neg = false, ax = x;
  if (x < 0 || Object.is(x, -0)) {
    const yi = rint(y) === y, odd = yi && rint(y * 0.5) !== y * 0.5;
    if (x === 0) {                                               // -0
      if (y > 0) return odd ? -0 : 0;
      return odd ? -Infinity : Infinity;
    }
    neg = odd; ax = -x;
    if (ax === Infinity) return powSpecial(x, y, neg);           // checked before the integer test
    if (!yi) return NaN;
  }
  if (ax === 0) return y > 0 ? 0 : Infinity;
  if (ax === Infinity || y === Infinity || y === -Infinity) return powSpecial(x, y, neg);
  if (ax === 1) return neg ? -1 : 1;
  // t = y log2|x| (64 bits); n = rint(t); fr = round24(t - n)
  let n = 0, fr = NaN;
  const est = y * Math.log2(ax), err = Math.abs(est) * E48 + 1e-300;
  if (Math.abs(est) > 1e12) return neg ? -scale(1, est) : scale(1, est);   // far beyond the float range either way
  n = rint(est);
  if (rint(est - err) === n && rint(est + err) === n) {
    const d = est - n, lo = r24(d - err), hi = r24(d + err);
    if (lo === hi) fr = lo;
  }
  if (fr !== fr) {
    fyl2x(y, 0, ax); const th = H, tl = L;
    n = rint(th);
    twoSum(th - n, tl);                                          // th - n is exact
    if (H > 0.5 || (H === 0.5 && L > 0)) { n++; twoSum(H - 1, L); }
    else if (H < -0.5 || (H === -0.5 && L < 0)) { n--; twoSum(H + 1, L); }
    fr = r24x(H, L);
  }
  const h = exp2frac(fr), r = scale(h, n);
  if (!neg) return r;
  // A double underflow goes to the CRT handler (0x1002d4ea): it rescales by 2^1536 and, when that is still below
  // DBL_MIN (|r| < 2^-2558), keeps the signed zero; otherwise the handler returns +0 unless |r| >= 2^-1075.
  const lg = n + Math.log2(h);
  return lg < -1075 && lg >= -2558 ? 0 : -r;
}
/** _CIpow with an infinite operand (0x1002d53c): C99 rules */
function powSpecial(x: number, y: number, neg: boolean): number {
  const ax = Math.abs(x);
  if (y === Infinity) return ax > 1 ? Infinity : ax === 1 ? NaN : 0;
  if (y === -Infinity) return ax > 1 ? 0 : ax === 1 ? NaN : Infinity;
  // |x| = inf, y finite and nonzero
  const r = y > 0 ? Infinity : 0;
  return neg ? -r : r;
}

/** FPATAN of (y, x) stored to a float: one rounding of the 64-bit result */
const AT = new Float64Array(2);
function atan2f(y: number, x: number): number {
  const r = sure(Math.atan2(y, x));
  if (r === r || y !== y || x !== x) return r === r ? r : NaN;
  atan2_87(y, x, AT);
  return f32x(AT[0], AT[1]);
}
/** FPATAN of (y, x) through the CRT's double store, then to a float */
function atan2d(y: number, x: number): number {
  const r = sure(Math.atan2(y, x));
  if (r === r) return r;
  atan2_87(y, x, AT);
  return f(AT[0] + AT[1]);
}
/** acos (0x10029390) and asin (0x10029460): sqrt((1 + x)(1 - x)) at 24 bits, FPATAN, double, float */
function acosf(x: number): number {
  const ax = Math.abs(x);
  if (!(ax <= 1)) return NaN;
  if (ax === 1) return x > 0 ? 0 : f(Math.PI);
  const s = f(Math.sqrt(f(f(1 + x) * f(1 - x))));
  return atan2d(s, x);
}
function asinf(x: number): number {
  const ax = Math.abs(x);
  if (!(ax <= 1)) return NaN;
  if (ax === 1) return x > 0 ? f(Math.PI / 2) : -f(Math.PI / 2);
  const s = f(Math.sqrt(f(f(1 + x) * f(1 - x))));
  return atan2d(x, s);
}
/** FLDLN2 (or FLDLG2), FYL2X of u, stored to a float */
function lnf(u: number, ch: number, cl: number): number {
  if (u > 0 && u < Infinity && u !== 1) {
    const r = sure(Math.log2(u) * ch);
    if (r === r) return r;
  }
  fyl2x(ch, cl, u);
  return f32x(H, L);
}

// sinh, cosh, tanh (0x1002f280 / 0x1002f2d2 / 0x1002f299 behind the dispatcher 0x1002d180, 64-bit precision)
function add64(ah: number, al: number, bh: number, bl: number): void { ddAdd(ah, al, bh, bl); round64(H, L); }
function mul64(ah: number, al: number, bh: number, bl: number): void { ddMul(ah, al, bh, bl); round64(H, L); }
function div64(ah: number, al: number, bh: number, bl: number): void { ddDiv(ah, al, bh, bl); round64(H, L); }
let EH = 0, EL = 0, BH = false, EN = 0;
/** 0x1002f328: E = e^x (BH) or e^x - 1 (!BH, when the integer part is 0); false on overflow (|x log2 e| >= 32767.5) */
function expParts(x: number): boolean {
  mul64(x, 0, L2E_64H, L2E_64L); const uh = H, ul = L;
  if (Math.abs(uh + ul) >= 32767.5) return false;
  let n = rint(uh);
  twoSum(uh - n, ul);
  if (H > 0.5 || (H === 0.5 && L > 0)) { n++; twoSum(H - 1, L); }
  else if (H < -0.5 || (H === -0.5 && L < 0)) { n--; twoSum(H + 1, L); }
  const rh = H, rl = L;
  EN = n;
  f2xm1abs(rh, rl);
  let gh = H, gl = L;
  if (rh < 0) { add64(1, 0, gh, gl); div64(gh, gl, -H, -L); gh = H; gl = L; }   // 2^r - 1 = -g / (1 + g)
  if (n !== 0) { add64(1, 0, gh, gl); EH = H * Math.pow(2, n); EL = L * Math.pow(2, n); BH = true; }
  else { EH = gh; EL = gl; BH = false; }
  return true;
}
/** F2XM1 of |rh + rl| where rh + rl is a 64-bit value (|.| <= 0.5) */
function f2xm1abs(rh: number, rl: number): void {
  if (rh < 0) { rh = -rh; rl = -rl; }
  if (rl === 0) { f2xm1(rh); return; }
  // 2^(rh + rl) - 1 = (2^rh - 1) + 2^rh (2^rl - 1)
  f2xm1(rh); const gh = H, gl = L;
  const t = rl * Math.LN2;                                       // |rl| < 2^-53: 2^rl - 1 = rl ln2 to the precision needed
  ddMul(1 + gh, gl - ((1 + gh) - 1 - gh), t, 0);
  ddAdd(gh, gl, H, L);
  round64(H, L);
}
/** 0x1002f36b: e^-x (BH) or e^-x - 1 (!BH) */
function expNeg(): void {
  if (BH) div64(1, 0, EH, EL);
  else { add64(1, 0, EH, EL); div64(EH, EL, -H, -L); }
}
function sinhf(x: number): number {
  if (x === 0 || x !== x) return x;
  if (Math.abs(x) === Infinity) return x;
  // |n| >= 200: (e^x - e^-x) / 2 is far beyond the float range (and the double-double helpers would overflow)
  if (!expParts(x) || Math.abs(EN) >= 200) return x > 0 ? Infinity : -Infinity;
  expNeg(); add64(EH, EL, -H, -L);
  return f((H + L) * 0.5);
}
function coshf(x: number): number {
  if (x !== x) return x;
  if (x === 0) return 1;
  if (Math.abs(x) === Infinity) return Infinity;
  if (!expParts(x) || Math.abs(EN) >= 200) return Infinity;
  expNeg(); add64(EH, EL, H, L);
  if (!BH) { add64(H, L, 1, 0); add64(H, L, 1, 0); }
  return f((H + L) * 0.5);
}
const TANH_BIG = 19.06154747;
function tanhf(x: number): number {
  if (x === 0 || x !== x) return x;
  if (!(Math.abs(x) < TANH_BIG)) return x > 0 ? 1 : -1;
  if (!expParts(x)) return x > 0 ? 1 : -1;
  expNeg(); const mh = H, ml = L;
  add64(EH, EL, mh, ml);
  if (!BH) { add64(H, L, 1, 0); add64(H, L, 1, 0); }
  const ch = H, cl = L;
  add64(EH, EL, -mh, -ml);
  div64(H, L, ch, cl);
  return f(H + L);
}

/** _hypot (0x10029f9c) at 64-bit precision; the host passes its first argument twice (0x10025cb0) */
function hypotSame(a: number): number {
  const m = Math.abs(a);
  if (m === 0) return 0;
  if (m !== m) return NaN;
  if (m === Infinity) return Infinity;
  BITS[0] = m;
  const e = ((W[1] >>> 20) & 0x7ff) - 1022;                      // m = mm * 2^e, mm in [0.5, 1)
  W[1] = (W[1] & 0x800fffff) | (1022 << 20); const mm = BITS[0];
  // frexp(sqrt 2) = 0.7071067811865476 * 2^1; the mantissas multiply at 64 bits, the product is stored as a double
  const SM = 0.7071067811865476;
  const p = SM * mm, pe = A.fma(SM, mm, -p);
  round64(p, pe);
  return f((H + L) * Math.pow(2, e + 1));
}

// ---------------------------------------------------------------- the host functions
/** what the host functions need from the engine */
export interface HostEnv {
  /** the CRT rand() of the DLL's single thread: the stream the engine draws from too (A.rand) */
  rand(): number;
  /** tp_TextureWidth / tp_TextureHeight: globals 0x1003e430 / 0x1003e434 (512 x 512 until the device sets them) */
  texW: number;
  texH: number;
  /**
   * tp_NextPreset = s (0x10025650): the string (converted to the ANSI code page) replaces the CString at +0x1e4 of
   * the preset context being scripted (the one 0x10067264 points to). When the preset switch comes (0x10014a65),
   * a non-empty string there names the next preset file instead of a random pick.
   */
  nextPreset(name: string): void;
  /**
   * DebugOut s (0x100257a0): ignored while a script error message is up (0x10067270 = 1); otherwise s (ANSI)
   * replaces the on-screen message string 0x100431ec and its show flag 0x1006726c becomes (s <> ""): the frame's
   * text pass (0x10019771) draws it until the next preset switch clears the flag (0x1001464f). Returns 0.
   */
  debugOut(text: string): void;
}
export interface HostFn {
  name: string;
  dispid: number;
  /** 'put': a property-put-only function (assignment) */
  kind: 'method' | 'put';
  /** VARIANT types of the parameters (4 Single, 3 Long, 8 String) */
  params: number[];
  /** VARIANT type of the result (4 Single, 2 Integer, 3 Long; 8 for a put) */
  vt: number;
  call(env: HostEnv, args: (number | string)[]): unknown;
}

const n = (a: unknown) => a as number;
const C_DEG2RAD = 0.01745329238474369, C_RAD2DEG = 57.2957763671875, C_INV7FFF = 3.0518509447574615e-05;
const L2E64 = [L2E_64H, L2E_64L];

/** exp (0x10025c30): x log2 e (24 bits), FRNDINT, F2XM1 of the rest, +1 (24 bits), FSCALE, stored to a float */
export function expf(x: number): number {
  const p = x * L2E64[0], pe = A.fma(x, L2E64[0], -p) + x * L2E64[1];
  const t = isFinite(p) ? r24x(p, pe) : p;
  if (!isFinite(t)) return NaN;                                  // inf - inf: invalid
  const k = rint(t);
  return f(scale(exp2frac(t - k), k));
}

function M(name: string, dispid: number, params: number[], vt: number, call: (env: HostEnv, a: (number | string)[]) => unknown): HostFn {
  return { name, dispid, kind: 'method', params, vt, call };
}
const S = [4], SS = [4, 4];
const nan0 = (v: number) => v !== v;

export const HOST_FNS: HostFn[] = [
  M('above', 141, SS, 4, (_, a) => n(a[0]) > n(a[1]) ? 1 : 0),
  M('acos', 142, S, 4, (_, a) => acosf(n(a[0]))),
  M('acosh', 143, S, 4, (_, a) => {
    const x = n(a[0]);
    if (!(x >= 1)) return NaN;                                   // FYL2X of -1: invalid
    return lnf(r24(r24(Math.sqrt(r24(r24(x * x) - 1))) + x), LN2_64H, LN2_64L);
  }),
  M('asin', 144, S, 4, (_, a) => asinf(n(a[0]))),
  M('asinh', 145, S, 4, (_, a) => {
    const x = n(a[0]);
    if (!(x >= 1)) return 0;                                     // FYL2X of 1.0: the DLL returns +0 below 1
    return lnf(r24(r24(Math.sqrt(r24(r24(x * x) + 1))) + x), LN2_64H, LN2_64L);
  }),
  M('atan', 146, S, 4, (_, a) => atan2f(n(a[0]), 1)),
  M('atan2', 147, SS, 4, (_, a) => atan2f(n(a[0]), n(a[1]))),
  M('atanh', 148, S, 4, (_, a) => {
    const x = n(a[0]);
    const p = r24(x + 1), q = r24(1 - x);
    let t: number;
    if (q === 0 || !isFinite(p) || !isFinite(q)) t = p / q;
    else { const d = p / q, r = A.fma(-d, q, p); t = r === 0 ? r24(d) : r24x(d, r / q); }
    if (!(t > 0) || t === Infinity || t === 1) { fyl2x(LN2_64H, LN2_64L, t); return f(H * 0.5); }
    const v = sure(Math.log2(t) * LN2_64H * 0.5);
    if (v === v) return v;
    fyl2x(LN2_64H, LN2_64L, t);
    return f(r24x(H, L) * 0.5);
  }),
  M('band', 149, SS, 4, (_, a) => (n(a[0]) === 0 || nan0(n(a[0])) || n(a[1]) === 0 || nan0(n(a[1]))) ? 0 : 1),
  M('bor', 150, SS, 4, (_, a) => ((n(a[0]) !== 0 && !nan0(n(a[0]))) || (n(a[1]) !== 0 && !nan0(n(a[1])))) ? 1 : 0),
  M('bnot', 151, S, 4, (_, a) => (n(a[0]) === 0 || nan0(n(a[0]))) ? 1 : 0),
  M('below', 152, SS, 4, (_, a) => (n(a[0]) < n(a[1]) || nan0(n(a[0])) || nan0(n(a[1]))) ? 1 : 0),
  // besselJ0 .. besselYn (153-158, the CRT _j0/_j1/_jn/_y0/_y1/_yn) are not in this table yet
  M('deg2rad', 159, S, 4, (_, a) => f(r24(n(a[0]) * C_DEG2RAD))),
  M('ceil', 160, S, 4, (_, a) => Math.ceil(n(a[0]))),
  M('chgsign', 161, S, 4, (_, a) => -n(a[0])),
  M('copysign', 162, SS, 4, (_, a) => {
    // the sign bit of y; a NaN y counts as negative (the x87 default NaN ffc00000; NaN signs are not carried)
    const x = Math.abs(n(a[0])), y = n(a[1]);
    return (y < 0 || Object.is(y, -0) || y !== y) ? -x : x;
  }),
  M('cosh', 163, S, 4, (_, a) => coshf(n(a[0]))),
  M('exp', 164, S, 4, (_, a) => expf(n(a[0]))),
  M('equal', 165, SS, 4, (_, a) => (n(a[0]) === n(a[1]) || nan0(n(a[0])) || nan0(n(a[1]))) ? 1 : 0),
  M('floor', 166, S, 4, (_, a) => Math.floor(n(a[0]))),
  M('frac', 167, S, 4, (_, a) => {
    const x = n(a[0]), k = ftol(x);
    twoSum(x, -k);
    return f(r24x(H, L));
  }),
  M('hypot', 168, SS, 4, (_, a) => hypotSame(n(a[0]))),
  M('iif', 169, [4, 4, 4], 4, (_, a) => (n(a[0]) === 0 || nan0(n(a[0]))) ? n(a[2]) : n(a[1])),
  M('int', 170, S, 4, (_, a) => f(ftol(n(a[0])))),
  M('log10', 171, S, 4, (_, a) => lnf(n(a[0]), LG2_64H, LG2_64L)),
  M('max', 172, SS, 4, (_, a) => n(a[0]) > n(a[1]) ? n(a[0]) : n(a[1])),
  M('min', 173, SS, 4, (_, a) => (n(a[0]) < n(a[1]) || nan0(n(a[0])) || nan0(n(a[1]))) ? n(a[0]) : n(a[1])),
  M('pow', 174, SS, 4, (_, a) => f(ciPow(n(a[0]), n(a[1])))),
  M('rand', 175, S, 4, (env, a) => {
    const r = env.rand();                                        // drawn first, then the argument truncated
    return (Math.imul(r, ftol(n(a[0]))) / 32767) | 0;                // integer divide: never -0
  }),
  M('randf', 176, S, 4, (env, a) => f(r24(r24(env.rand() * n(a[0])) * C_INV7FFF))),
  M('rad2deg', 177, S, 4, (_, a) => f(r24(n(a[0]) * C_RAD2DEG))),
  M('roundval', 178, S, 4, (_, a) => { const x = n(a[0]); return (x < 0 || x !== x) ? Math.floor(x) : Math.ceil(x); }),
  M('sign', 179, S, 4, (_, a) => { const x = n(a[0]); return (x < 0 || x !== x) ? -1 : x === 0 ? 0 : 1; }),
  M('sinh', 180, S, 4, (_, a) => sinhf(n(a[0]))),
  M('pow2', 181, S, 4, (_, a) => f(r24(n(a[0]) * n(a[0])))),
  M('tanh', 182, S, 4, (_, a) => tanhf(n(a[0]))),
  M('trunc', 183, S, 4, (_, a) => Math.trunc(n(a[0]))),
  { name: 'tp_NextPreset', dispid: 184, kind: 'put', params: [8], vt: 8, call: (env, a) => { env.nextPreset(String(a[0])); return undefined; } },
  M('tp_TextureWidth', 185, [], 2, (env) => (env.texW << 16) >> 16),
  M('tp_TextureHeight', 186, [], 2, (env) => (env.texH << 16) >> 16),
  M('DebugOut', 192, [8], 2, (env, a) => { env.debugOut(String(a[0])); return 0; }),
  M('bitAnd', 193, SS, 3, (_, a) => ftol(n(a[0])) & ftol(n(a[1]))),
  M('bitOr', 194, SS, 3, (_, a) => ftol(n(a[0])) | ftol(n(a[1]))),
  M('bitXor', 195, SS, 3, (_, a) => ftol(n(a[0])) ^ ftol(n(a[1]))),
];
HOST_FNS.sort((p, q) => p.dispid - q.dispid);
