// AssemblyScript source of src/engine/trig-wasm.ts (npm run build:wasm regenerates it).
// The ucrtbase sin/cos clone of src/engine/rand.ts (its FMA3 branch: Cody-Waite reduction, the two
// polynomials, the emulated vfmadd), op for op in f64: WebAssembly's f64 + - * / and comparisons
// round exactly as JavaScript's do, so every function here returns the bits rand.ts's JavaScript
// returns (tests/engine/rand.test.ts runs the ucrtbase fixtures and a few million arguments on both).
// Only |x| < 2e7 comes here: the Payne-Hanek reduction stays in the JavaScript (rand.ts checks), and
// so do NaN and the infinities. Names follow rand.ts; the addresses are in its comments.
// Results leave through the double(s) at a byte offset in this module's memory (sincos), or as the
// f64 return value (sin, cos).

// ---- fma(a, b, c) = RN(a*b + c): Dekker's exact product + Boldo-Melquiond round-to-odd (rand.ts)
const SPLIT: f64 = 134217729;
const PHI: f64 = 1.1102230246251568e-16;

@inline function fmaTie(s: f64, z: f64, ze: f64): f64 {
  let b = reinterpret<u64>(z);
  if ((b & 1) == 0) {                                 // round the tail to odd
    if ((ze > 0) == (z > 0)) b++;                     // away from zero
    else b--;                                         // towards (the borrow is rand.ts's U32[1]--)
    z = reinterpret<f64>(b);
  }
  return s + z;
}
function fmaExact(a: f64, b: f64, c: f64): f64 {
  const p = a * b;
  const t = SPLIT * a, ah = t - (t - a), al = a - ah;
  const u = SPLIT * b, bh = u - (u - b), bl = b - bh;
  const pe = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  const s = c + p;
  let v = s - c;
  const se = (c - (s - v)) + (p - v);
  const z = se + pe;
  v = z - se;
  const ze = (se - (z - v)) + (pe - v);
  const r = s + z;
  if (ze == 0) return r;
  v = r - s;
  const re = (s - (r - v)) + (z - v);
  return r + re * 1.0000000000000002 == r ? r : fmaTie(s, z, ze);
}
/** Exported for tests/engine/rand.test.ts's BigInt reference, as rand.ts exports A.fma. */
export function fma(a: f64, b: f64, c: f64): f64 {
  const p = a * b, s = c + p;
  const as = abs<f64>(s);
  if (as > 1e-290) {
    const v = s - c, se = (c - (s - v)) + (p - v);
    const e = PHI * as;
    let du = (as + e) - as;
    const dd = as - (as - e);
    if (dd < du) du = dd;
    if (abs<f64>(se) + abs<f64>(p) * PHI < du * 0.49999999999999) return s;
  }
  return fmaExact(a, b, c);
}

// ---- Cody-Waite reduction and the two polynomials (0x1800ab910, 0x1800abebf, 0x1800abf20)
const S1: f64 = -0.16666666666666666, S2: f64 = 0.00833333333333095, S3: f64 = -0.00019841269836761127,
      S4: f64 = 2.7557316103728802e-06, S5: f64 = -2.5051132068021698e-08, S6: f64 = 1.5918144304485914e-10;
const C1: f64 = 0.041666666666666664, C2: f64 = -0.0013888888888887398, C3: f64 = 2.4801587298767044e-05,
      C4: f64 = -2.755731727234489e-07, C5: f64 = 2.0876146382372144e-09, C6: f64 = -1.138263981623609e-11;
const PIO4: f64 = 0.7853981633974483, TWO_M13: f64 = 0.0001220703125, TWO_M27: f64 = 7.450580596923828e-09;
const TWOBYPI: f64 = 0.6366197723675814, SHIFTER: f64 = 6755399441055744, PIO2_1T: f64 = 6.123233995736757e-17, PIO2_2T: f64 = 8.478427660368898e-32;
const P1H: f64 = 1.5707963109016418, P1L: f64 = 1.5893254712295857e-08, T1H: f64 = 6.123233932053594e-17, T1L: f64 = 6.368316315668184e-25;

let RR: f64 = 0;
let REG: i32 = 0;
function reduce(x: f64): f64 {
  const q = x * TWOBYPI;
  let n = (q + SHIFTER) - SHIFTER;
  let h = q - n;
  if (h < 0) h = -h;
  if (h > 0.5 - q * 2.3e-16 && h < 0.5 + q * 2.3e-16) n = fma(x, TWOBYPI, SHIFTER) - SHIFTER;
  REG = <i32>n & 3;
  const rh = (x - n * P1H) - n * P1L;
  const t = n * PIO2_1T;
  const terr = (n * T1H - t) + n * T1L;
  const r5 = rh - t;
  const e4 = (rh - r5) - t;
  const r = fma(-n, PIO2_1T, rh);
  RR = fma(-n, PIO2_2T, ((r5 - r) + e4) - terr);
  return r;
}
@inline function sinPoly(r: f64, rr: f64): f64 {
  const x2 = r * r;
  const p = fma(fma(fma(fma(S6, x2, S5), x2, S4), x2, S3), x2, S2);
  const x3 = r * x2;
  const t = x2 * (rr * 0.5 - x3 * p) - rr;
  return r - fmaExact(-x3, S1, t);
}
@inline function cosPoly(r: f64, rr: f64): f64 {
  const x2 = r * r, h = x2 * 0.5;
  const t = 1 - h;
  const c = fmaExact(-r, rr, ((1 - t) - h));
  const p = fma(fma(fma(fma(fma(C6, x2, C5), x2, C4), x2, C3), x2, C2), x2, C1);
  return fmaExact(p, x2 * x2, c) + t;
}
function sinSmall(x: f64, ax: f64): f64 {
  if (ax >= TWO_M13) {
    const x2 = x * x;
    return fmaExact(x * x2, fma(fma(fma(fma(fma(S6, x2, S5), x2, S4), x2, S3), x2, S2), x2, S1), x);
  }
  if (ax >= TWO_M27) return fmaExact(-(x * x * x), 0.16666666666666666, x);
  return x;
}
function cosSmall(x: f64, ax: f64): f64 {
  if (ax >= TWO_M13) {
    const x2 = x * x;
    const p = fma(fma(fma(fma(fma(C6, x2, C5), x2, C4), x2, C3), x2, C2), x2, C1);
    return fmaExact(fma(p, x2, -0.5), x2, 1);
  }
  if (ax >= TWO_M27) return fmaExact(-(x * 0.5), x, 1);
  return 1;
}

// ---- sin 0x1800aba70, cos 0x1800a7730, and the pair rand.ts's A.sincos computes
function sinR(x: f64, ax: f64): f64 {               // PIO4 <= ax < 2e7
  const r = reduce(ax), q = REG;
  const y = (q & 1) ? cosPoly(r, RR) : sinPoly(r, RR);
  return ((q & 2) != 0) != (x < 0) ? -y : y;
}
function cosR(ax: f64): f64 {                       // PIO4 < ax < 2e7
  const r = reduce(ax), q = REG;
  const y = (q & 1) ? sinPoly(r, RR) : cosPoly(r, RR);
  return ((q + 1) & 2) ? -y : y;
}
/** |x| < 2e7 and not NaN, here and below: the caller checks. */
export function sin(x: f64): f64 {
  const ax = abs<f64>(x);
  return ax < PIO4 ? sinSmall(x, ax) : sinR(x, ax);
}
export function cos(x: f64): f64 {
  const ax = abs<f64>(x);
  return ax <= PIO4 ? cosSmall(x, ax) : cosR(ax);
}
/** sin(x), cos(x) to the two doubles at byte offset `out`: one reduction for both, as A.sincos. */
export function sincos(x: f64, out: usize): void {
  const ax = abs<f64>(x);
  if (ax > PIO4) {
    const r = reduce(ax), q = REG, rr = RR;
    const s = sinPoly(r, rr), c = cosPoly(r, rr);
    const ys = (q & 1) ? c : s, yc = (q & 1) ? s : c;
    store<f64>(out, ((q & 2) != 0) != (x < 0) ? -ys : ys);
    store<f64>(out, ((q + 1) & 2) ? -yc : yc, 8);
  } else {
    store<f64>(out, ax < PIO4 ? sinSmall(x, ax) : sinR(x, ax));
    store<f64>(out, cosSmall(x, ax), 8);
  }
}

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize { return (__heap_base + 15) & ~(<usize>15); }
