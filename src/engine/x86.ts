// Alchemy's x86 builds (WMP 9 and 10: VC7, x87 at 53 bits; WMP 11: VC8): the arithmetic they share and the x64
// build (WMP 12) does not, for the "(WMP 9)", "(WMP 10)" and "(WMP 11)" presets (alchemy.ts PRESET_VERSIONS).
import { A } from './ns';
import './rand';

/** _ftol: truncate; out of range or NaN -> 0x80000000 */
export function ftol(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}
/** RoundToInt (WMP 10 0x743c9c1, WMP 9 0x75aca9f, WMP 11 0xd787e78): +-0.5 added in double, never rounded to
 *  float (WMP 12's ADDSS rounds the sum to float), then truncated */
export function round53(v: number): number { return ftol(v <= 0 ? v - 0.5 : v + 0.5); }
/** WMP 9/10's RandDouble (WMP 10 0x743b5a7, WMP 9 0x75ab85d): rand() * (1/32767 as a double) * (hi - lo) + lo at
 *  53 bits; WMP 11 and 12 divide by 32767.0 instead. Every random double of WMP 9/10 is one. */
export function randDouble(lo: number, hi: number): number { return A.rand() * (1 / 32767) * (hi - lo) + lo; }

// ---- x87 FSIN/FCOS/FPATAN at Pythagorean points --------------------------------------------------------------
// Shift O' Scope's mirror, Stretch, the Scope spin and SuperStar's points truncate trig(a) * r. When the point is
// a Pythagorean triple, the exact product is a whole number: the x87's 64-bit FSIN/FCOS (Intel's 66-bit pi
// reduction) lands on it, the port's ucrtbase doubles can land an ulp below and truncate to n - 1. So a double
// product within 1e-9 of an integer is recomputed here exactly, in BigInt fixed point (2^-160): correct rounding
// to 64 bits, as this model matched the CPU's FSIN/FCOS/FPATAN in 97% of 11,000 sampled inputs (the rest 1 ulp
// of 64 bits off). Only near integers, so its speed is irrelevant.
const FB = 160n, ONE = 1n << FB;
function atanInv(n: bigint): bigint {
  let x = ONE / n, s = x, k = 1n, sg = -1n;
  const n2 = n * n;
  while (x !== 0n) { x /= n2; s += sg * (x / (2n * k + 1n)); sg = -sg; k++; }
  return s;
}
const PI = 4n * (4n * atanInv(5n) - atanInv(239n));
const PI66 = (PI >> (FB - 64n)) << (FB - 64n);            // pi to 66 significant bits (2 integer bits + 64)
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
function toFix(v: number): bigint {                        // exact for |v| >= 2^-100
  if (v === 0) return 0n;
  F64[0] = v;
  const b = U64[0], e = Number((b >> 52n) & 0x7ffn), m = (b & 0xfffffffffffffn) | (1n << 52n);
  const sh = BigInt(e - 1075) + FB, a = sh >= 0n ? m << sh : m >> -sh;
  return (b >> 63n) ? -a : a;
}
function roundBits(v: bigint, bits: number): bigint {      // nearest-even to `bits` significant bits (still fixed point)
  if (v === 0n) return 0n;
  const neg = v < 0n;
  let a = neg ? -v : v;
  const sh = a.toString(2).length - bits;
  if (sh > 0) {
    const s = BigInt(sh), q = a >> s, r = a - (q << s), h = 1n << (s - 1n);
    a = (r > h || (r === h && (q & 1n)) ? q + 1n : q) << s;
  }
  return neg ? -a : a;
}
function fixToNum(v: bigint): number {                     // exact when v has <= 53 significant bits
  const n = Number(v < 0n ? -v : v) / Math.pow(2, Number(FB));
  return v < 0n ? -n : n;
}
function sincosFix(x: bigint): [bigint, bigint] {
  const half = PI66 / 2n;
  let q = (x + half / 2n) / half;
  if (x + half / 2n < 0n && (x + half / 2n) % half !== 0n) q--;
  const r = x - q * half;
  let s = r, c = ONE, t = r, tc = ONE, k = 1n;
  for (;;) {
    t = -t * r / ONE * r / ONE / ((2n * k) * (2n * k + 1n));
    tc = -tc * r / ONE * r / ONE / ((2n * k - 1n) * (2n * k));
    if (t === 0n && tc === 0n) break;
    s += t; c += tc; k++;
  }
  switch (Number(((q % 4n) + 4n) % 4n)) { case 0: return [s, c]; case 1: return [c, -s]; case 2: return [-s, -c]; default: return [-c, s]; }
}
function atanFix(x: bigint): bigint {                      // |x| <= ONE: halve the argument until small, then Taylor
  let n = 0n;
  // integer sqrt: Newton from above (start above the float estimate), stop when it no longer decreases
  const sq = (v: bigint): bigint => {
    if (v <= 0n) return 0n;
    let z = BigInt(Math.ceil(Math.sqrt(Number(v)) * (1 + 1e-12))) + 1n;
    for (;;) { const y = (z + v / z) >> 1n; if (y >= z) return z; z = y; }
  };
  while ((x < 0n ? -x : x) > (ONE >> 3n)) { x = x * ONE / (ONE + sq(ONE * ONE + x * x)); n++; }
  let s = x, t = x, k = 1n;
  const x2 = x * x / ONE;
  for (;;) { t = -t * x2 / ONE; const d = t / (2n * k + 1n); if (d === 0n) break; s += d; k++; }
  return s << n;
}
function atan2Fix(dy: number, dx: number): bigint {        // FPATAN's exact value (dy, dx are whole numbers)
  if (dx === 0) return dy > 0 ? PI / 2n : -PI / 2n;
  if (Math.abs(dy) <= Math.abs(dx)) {
    const a = atanFix(BigInt(dy) * ONE / BigInt(dx));
    return dx < 0 ? a + (dy >= 0 ? PI : -PI) : a;
  }
  return (dy > 0 ? PI / 2n : -PI / 2n) - atanFix(BigInt(dx) * ONE / BigInt(dy));
}
/** r53(round64(trig(a)) * r); which: 0 = sin, 1 = cos */
function trigMul(a: bigint, r: number, which: number): number {
  return fixToNum(roundBits(roundBits(sincosFix(a)[which], 64) * toFix(r) / ONE, 53));
}

/** (int)(trig(a) * r) with the x87's FSIN/FCOS of the double a (SuperStar; WMP 11's Stretch, spin and mirror):
 *  c = the port's sin or cos of a, which = 0 for sin, 1 for cos */
export function truncTrig(c: number, a: number, r: number, which: number): number {
  const v = c * r;
  return Math.abs(v - Math.round(v)) >= 1e-9 ? ftol(v) : ftol(trigMul(toFix(a), r, which));
}
/** WMP 9/10's Stretch, spin and mirror: (int)(trig(atan2(dy, dx) + add) * r) with FPATAN's 64-bit result fed
 *  straight to FCOS/FSIN (add = 0), or that plus add rounded to 53 bits. c = the port's sin or cos of the angle. */
export function truncAtan2Trig(c: number, dy: number, dx: number, add: number, r: number, which: number): number {
  const v = c * r;
  if (Math.abs(v - Math.round(v)) >= 1e-9) return ftol(v);
  const a = roundBits(atan2Fix(dy, dx), 64);
  return ftol(trigMul(add === 0 ? a : roundBits(a + toFix(add), 53), r, which));
}
