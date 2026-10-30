// x87 F2XM1 (2^x - 1) as this FPU computes it (measured on an i7-11370H), 64-bit result, |x| <= 1/2.
// K = ln 2 rounded to 67 bits.
// |x| < 1/4: s = T67(x K); sh = s to 64 bits (ties away from zero); z = T67(s sh);
//            C = RN64(z (e^s - 1 - s - s^2/2) / s^2 + s^3 f(z) 2^-70), f the fitted gap between the FPU's own
//            polynomial and the series (its cubic coefficient is ~1/6 + 6.7 2^-66); B = RN64(z/2 + C); RNE64(s + B).
//            |x| < 2^-68: RN64(x K) of the exact product.
// |x| >= 1/4: j = floor(64 x), c = (j + 1/2)/64, r = x - c; s = RN64(r K), g = ulp64(s);
//            q = s + RN_g(E) + RN_g(O), O = sinh s - s, E = cosh s - 1 - a4 s^4 + a6 s^6 (the FPU's even polynomial
//            falls short of the series by these fitted amounts); T = RN64(2^c) (j = 30: one ulp up), Tm1 = RN67(2^c - 1);
//            result RNE64(Tm1 + T67(T q)).
// T67 = truncate to 67 significant bits. Not exact yet: the small region's C carries an extra error of ~+-2 of its
// last bit (the FPU's internal truncations, not identified): ~0.1% of results in [1/8, 1/4) one ulp off, ~0 below 2^-8.
import { FB, ONE, fromNum, lead, mul, rnd, rndAt, toNum, toPair } from './fix';

const LN2 = (() => { // ln 2 = 2 atanh(1/3)
  const t = ONE / 3n, t2 = mul(t, t); let s = 0n, p = t;
  for (let k = 1n; p !== 0n; k += 2n) { s += p / k; p = mul(p, t2); }
  return 2n * s;
})();
const K = rnd(LN2, 67, 'N');
const A4 = fromNum(1.8845886568454987e-13), A6 = fromNum(3.528928961335878e-09);

/** e^s - 1 - s - s^2/2 (exact series) */
function expTail3(s: bigint): bigint {
  let t = mul(mul(s, s), s) / 6n, sum = 0n;
  for (let n = 4n; t !== 0n; n++) { sum += t; t = mul(t, s) / n; }
  return sum;
}
/** [cosh s - 1, sinh s - s] */
function hyp(s: bigint): [bigint, bigint] {
  const s2 = mul(s, s); let e = 0n, o = 0n, t = s2 / 2n;
  for (let n = 3n; t !== 0n; n++) { if (n & 1n) e += t; else o += t; t = mul(t, s) / n; }
  // the loop alternates: t = s^2/2 (even), s^3/6 (odd), ...
  return [e, o];
}
/** 2^c for c = (j + 1/2)/64 */
function exp2(c: bigint): bigint {
  const z = mul(c, LN2); let s = ONE, t = ONE;
  for (let n = 1n; t !== 0n; n++) { t = mul(t, z) / n; s += t; }
  return s;
}
const T: bigint[] = [], TM1: bigint[] = [];
for (let j = 16; j <= 32; j++) for (const sg of [1, -1]) {
  const jj = sg > 0 ? j : -j - 1; if (jj < -32) continue;
  const e = exp2(((2n * BigInt(jj) + 1n) << FB) / 128n);
  let t = rnd(e, 64, 'N'); if (jj === 30) t += 1n << BigInt(lead(t) - 63);
  T[jj + 32] = t; TM1[jj + 32] = rnd(e - ONE, 67, 'N');
}

// f on t = 2 z/0.03 - 1 (Chebyshev, units of 2^-70), fitted to the FPU's rounding decisions
const FC = [12.8315, -27.5224, 25.0103, -20.8224, 15.7482, -8.5969, -0.2587, 0.25];
function cheb(t: number): number {
  let t0 = 1, t1 = t, f = FC[0] + FC[1] * t;
  for (let k = 2; k < FC.length; k++) { const t2 = 2 * t * t1 - t0; f += FC[k] * t2; t0 = t1; t1 = t2; }
  return f;
}
function small(x: bigint): bigint {
  const s = rnd(mul(x, K), 67, 'T');
  if (s === 0n) return 0n;
  const sh = rndAway64(s), z = rnd(mul(s, sh), 67, 'T');
  const zn = toNum(z) / 0.03, f = cheb(2 * zn - 1);
  const C = rnd((mul(z, expTail3(s)) << FB) / mul(s, s) + mul(mul(mul(s, s), s), fromNum(f * 2 ** -70)), 64, 'N');
  const B = rnd(z / 2n + C, 64, 'N');
  return s + B;
}
function rndAway64(v: bigint): bigint {
  const sh = BigInt(lead(v) - 63); if (sh <= 0n) return v;
  const a = v < 0n ? -v : v, g = 1n << sh, q = (a + (g >> 1n)) >> sh;
  return v < 0n ? -(q << sh) : q << sh;
}
function table(x: bigint): bigint {
  const j = Number((x * 64n) >> FB), c = ((2n * BigInt(j) + 1n) << FB) / 128n, r = x - c;
  const tm = TM1[j + 32], s = rnd(mul(r, K), 64, 'N');
  if (s === 0n) return tm;
  const gs = BigInt(lead(s) - 63), z = mul(s, s), [ch, sh] = hyp(s);
  const E = ch - mul(A4, mul(z, z)) + mul(A6, mul(mul(z, z), z));
  const q = s + rndAt(E, gs, 'N') + rndAt(sh, gs, 'N');
  return tm + rnd(mul(T[j + 32], q), 67, 'T');
}

/** F2XM1 of the double x (|x| <= 1/2): o[at] + o[at + 1] is the 64-bit result exactly */
export function f2xm187(x: number, o: Float64Array, at = 0): void {
  if (x === 0) { o[at] = x; o[at + 1] = 0; return; }
  const a = Math.abs(x);
  if (a < 2 ** -68) { // the exact product rounded once, computed scaled into [1, 2) (ponytail: hi/lo underflow below ~2^-960)
    const e = Math.floor(Math.log2(a)), v = rnd(mul(fromNum(x * 2 ** -e), K), 64, 'N');
    toPair(v, o, at); o[at] = o[at] * 2 ** e; o[at + 1] = o[at + 1] * 2 ** e; return;
  }
  const X = fromNum(x);
  toPair(rnd(a < 0.25 ? small(X) : table(X), 64, 'N'), o, at);
}
