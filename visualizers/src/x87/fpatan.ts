// Model of x87 FPATAN (measured on an i7-11370H), 64-bit result.
// fpatan87(y, x, out): out[0] = nearest double to the 80-bit result, out[1] = exact remainder
// (out[0] + out[1] is the 80-bit value exactly). Inputs: finite doubles. Precision control is
// ignored by FPATAN, so this holds for CW 0x027F and 0x037F alike.
//
// Model (all values exact unless stated):
//  1. n0 = min(|y|,|x|), d0 = max(|y|,|x|) (swap when |y| > |x|).
//  2. j = round-half-even(32*n0/d0), exactly.
//  3. j <= 1:  S = trunc67(n0/d0);  I = polyI(S) (below); I = S when S < 2^-40
//     j >= 2:  S = trunc67(|n0 - d0*j/32| / (d0 + n0*j/32));
//              c = S*z*(C3 + z*(C5 + z*(C7 + z*C9))), z = S*S       (fitted coefficients below)
//              G = 2^(ilogb(S + c) - 66);  A = S + floor(c/G)*G;  I = T[j] +/- A  (sign of the numerator)
//              T[j] = atan(j/32) rounded to nearest-even at 67 bits.
//  4. octant 0 (x > 0, no swap): r = I
//     otherwise I' = trunc67(I);  r = PIO2 - I' (x > 0, swapped) | PI - I' (x <= 0, not swapped)
//                                    | PIO2 + I' (x <= 0, swapped);  PIO2, PI rounded to nearest at 67 bits.
//  5. result = round-to-nearest-even at 64 bits of r, sign of y.
// trunc67 = truncate to 67 significant bits.

import { FB, hexf, mul, rnd } from './fix';

const FP = 160n; // fixed-point fraction bits for the polynomials
const TWO66 = 1n << 66n;

function dec(s: string): bigint { // decimal string -> round(value * 2^FP)
  const neg = s[0] === '-';
  const t = neg ? s.slice(1) : s;
  const dot = t.indexOf('.');
  const digits = BigInt(t.replace('.', ''));
  const den = 10n ** BigInt(dot < 0 ? 0 : t.length - dot - 1);
  const v = ((digits << (FP + 1n)) / den + 1n) >> 1n;
  return neg ? -v : v;
}
const C3 = dec('-0.3333333333333333060521106836095467887209');
const C5 = dec('0.1999999999989655747712548804990625918332');
const C7 = dec('-0.1428571306567178210804088574339760103945');
const C9 = dec('0.1110543957005887152829442524722304060466');

// 67-bit constants: mantissa, exponent (value = m * 2^e)
const PIO2_M = 0x6487ed5110b4611a6n, PIO2_E = -66, PI_E = -65;
const TM: bigint[] = [0n, 0n, 0x7fd56edcb3f7a71b6n, 0x5fb860980bc43a305n, 0x7f56ea6ab0bdb7196n, 0x4f5bbba31989b161an,
  0x5ee5ed2f396c089a4n, 0x6e435d4a498288118n, 0x7d6dd7e4b203758abn, 0x462fd68c2fc5e0986n, 0x4d89dcdc1faf2f34en,
  0x54c2b6654735276d5n, 0x5bd86507937bc239cn, 0x62c934e5286c95b6dn, 0x6993bb0f308ff2db2n, 0x7036d3253b27be33en,
  0x76b19c1586ed3da2bn, 0x7d03742d50505f2e3n, 0x4195fa536cc33f152n, 0x4495766fef4aa3da8n, 0x47802eaf7bfacfcdbn,
  0x4a563964c238c37b1n, 0x4d17c07338deed102n, 0x4fc4fee27a5bd0f68n, 0x525e3e8c9a7b84921n, 0x54e3d5ee24187ae45n,
  0x5756261c5a6c60401n, 0x59b598e48f821b48bn, 0x5c029f15e118cf39en, 0x5e3daef574c579407n, 0x606742dc562933204n,
  0x627fd7fd5fc7deaa4n, 0x6487ed5110b4611a6n];
const TE: number[] = [0, 0, -71, -70, -70, -69, -69, -69, -69, -68, -68, -68, -68, -68, -68, -68, -68, -68,
  -67, -67, -67, -67, -67, -67, -67, -67, -67, -67, -67, -67, -67, -67, -67];

// j <= 1 polynomial: the minimax of (atan(s)/s - 1)/z (absolute error of atan(s)/s - 1) on (0, 3/64], k1 to 67 bits,
// k2..k6 to 64. z = T67(S S); Horner with T67 products and RN64 sums; I = S + T67(T64(S) T67(t z)).
const K = ['-0x1.5555555555555550cp-2', '0x1.9999999999985ed4p-3', '-0x1.2492492484215474p-3', '0x1.c71c71313fdb470ep-4',
  '-0x1.745b861def688df8p-4', '0x1.39031c98b3469ebcp-4'].map(hexf);
function polyI(S: bigint): bigint {
  const z = rnd(mul(S, S), 67, 'T');
  let t = rnd(mul(K[5], z), 67, 'T');
  for (let i = 4; i >= 0; i--) { t = rnd(t + K[i], 64, 'N'); if (i) t = rnd(mul(t, z), 67, 'T'); }
  return S + rnd(mul(rnd(S, 64, 'T'), rnd(mul(t, z), 67, 'T')), 67, 'T');
}

const dv = new DataView(new ArrayBuffer(8));
let splitE = 0;
function split(d: number): bigint { // d > 0 finite: returns mantissa, sets splitE (d = m * 2^splitE)
  dv.setFloat64(0, d);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const be = (hi >>> 20) & 0x7ff;
  const mh = hi & 0xfffff;
  if (be === 0) { splitE = -1074; return (BigInt(mh) << 32n) | BigInt(lo); }
  splitE = be - 1075;
  return (BigInt(mh | 0x100000) << 32n) | BigInt(lo);
}
function ilog2(m: bigint): number { // floor(log2(m)), m > 0
  const n = Number(m);
  let b: number;
  if (n < 2 ** 1023) { dv.setFloat64(0, n); b = ((dv.getUint32(0) >>> 20) & 0x7ff) - 1023; }
  else b = m.toString(2).length - 1;
  if ((1n << BigInt(b)) > m) b--;
  return b;
}
function shl(m: bigint, k: number): bigint { return k >= 0 ? m << BigInt(k) : m >> BigInt(-k); }

// truncate a/b (a, b > 0) to 67 bits: returns r in [2^66, 2^67), sets qE so that value = r * 2^(qE)
let qE = 0;
function trunc67div(a: bigint, b: bigint): bigint {
  let sh = 66 - (ilog2(a) - ilog2(b));
  let r = sh >= 0 ? (a << BigInt(sh)) / b : a / (b << BigInt(-sh));
  if (r < TWO66) { sh++; r = sh >= 0 ? (a << BigInt(sh)) / b : a / (b << BigInt(-sh)); }
  qE = -sh;
  return r;
}

// exact sign-preserving result of the x87 op for finite y, x
export function fpatan87(y: number, x: number, out: Float64Array): void {
  const neg = y < 0 || Object.is(y, -0);
  const ay = Math.abs(y), ax = Math.abs(x);
  const xpos = x > 0;
  if (ay === 0) { // atan2(+-0, x): +-0 for x > 0 or x = +0, +-pi for x < 0 or x = -0
    if (xpos || Object.is(x, 0)) { out[0] = neg ? -0 : 0; out[1] = 0; return; }
    finish(PIO2_M, PI_E, neg, out); return;
  }
  const sw = ay > ax;
  if (ax === 0) { finish(PIO2_M, PIO2_E, neg, out); return; } // +-pi/2 (I = 0)
  const n0 = sw ? ax : ay, d0 = sw ? ay : ax;
  const Mn = split(n0), en = splitE, Md = split(d0), ed = splitE;

  // j = round-half-even(32*n0/d0)
  let j: number;
  const t = 32 * (n0 / d0);
  const fr = t - Math.floor(t);
  if (Math.abs(fr - 0.5) > 1e-6) j = Math.round(t);
  else { // exact: compare 64*n0 with (2k+1)*d0
    const k = Math.floor(t);
    const e0 = Math.min(en, ed);
    const lhs = shl(Mn, en - e0) << 6n, rhs = shl(Md, ed - e0) * BigInt(2 * k + 1);
    j = lhs > rhs ? k + 1 : lhs < rhs ? k : (k % 2 === 0 ? k : k + 1);
  }

  let Im: bigint, Ie: number; // I = Im * 2^Ie, Im > 0
  if (j <= 1) {
    const r = trunc67div(Mn, Md), eS = qE + en - ed;
    if (eS + 66 < -40) { Im = r; Ie = eS; } // measured: no correction below 2^-40
    else { Im = polyI(r << BigInt(eS + Number(FB))); Ie = -Number(FB); }
  } else {
    const e0 = Math.min(en, ed);
    const N = shl(Mn, en - e0), D = shl(Md, ed - e0), J = BigInt(j);
    const num = (N << 5n) - J * D, den = (D << 5n) + J * N;
    const Tm = TM[j], Te = TE[j];
    if (num === 0n) { Im = Tm; Ie = Te; }
    else {
      const r = trunc67div(num < 0n ? -num : num, den), eS = qE;
      const zf = shl(r * r, 2 * eS + Number(FP));
      const p = C3 + ((zf * (C5 + ((zf * (C7 + ((zf * C9) >> FP))) >> FP))) >> FP);
      const cz = r * zf * p; // c / 2^eS = cz / 2^(2 FP)
      let k = cz >> (2n * FP);
      let Am: bigint, Ae: number;
      if (r + k < TWO66) { k = cz >> (2n * FP - 1n); Am = (r << 1n) + k; Ae = eS - 1; }
      else { Am = r + k; Ae = eS; }
      // I = T +/- A, aligned at the smaller exponent
      const e = Math.min(Te, Ae);
      const a = shl(Am, Ae - e), tt = shl(Tm, Te - e);
      Im = num < 0n ? tt - a : tt + a; Ie = e;
    }
  }

  if (xpos && !sw) { finish(Im, Ie, neg, out); return; }
  // I' = trunc67(I)
  const b = ilog2(Im);
  if (b > 66) { Im >>= BigInt(b - 66); Ie += b - 66; }
  const Ke = xpos || sw ? PIO2_E : PI_E;
  const e = Math.min(Ke, Ie);
  const K = shl(PIO2_M, Ke - e), Iv = shl(Im, Ie - e);
  finish(xpos ? K - Iv : sw ? K + Iv : K - Iv, e, neg, out);
}

// out = RNE64(m * 2^e) split as double + exact remainder, with sign
function finish(m: bigint, e: number, neg: boolean, out: Float64Array): void {
  const b = ilog2(m);
  if (b > 63) {
    const sh = BigInt(b - 63);
    let q = m >> sh;
    const rem = m - (q << sh), half = 1n << (sh - 1n);
    if (rem > half || (rem === half && (q & 1n))) q++;
    m = q; e += b - 63;
  }
  // m <= 2^64: nearest double (Number(bigint) rounds to nearest-even) + exact remainder
  const hn = Number(m);
  const hi = scale(hn, e), l = scale(Number(m - BigInt(hn)), e);
  out[0] = neg ? -hi : hi; out[1] = neg ? -l : l;
}
// v * 2^e; two steps so tiny results reach the subnormal range (ponytail: double rounding there, |result| < 2^-1022 only)
function scale(v: number, e: number): number { return e < -1000 ? v * 2 ** (e + 200) * 2 ** -200 : v * 2 ** e; }
