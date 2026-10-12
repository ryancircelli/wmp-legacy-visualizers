// MSVC CRT shims. The DLLs call the C runtime for randomness and for sin/cos/atan2; all of it is
// observable in the output, so all of it lives here. Never use Math.random or Math.sin/cos/atan2
// in engine code.
// Wrapped verbatim from src/00-rand.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from './ns';
import { TRIG_WASM } from './trig-wasm';
var seed = 1; // MSVC starts at 1

A.srand = function (s) { seed = s | 0; };

A.rand = function () {
  seed = (Math.imul(seed, 214013) + 2531011) | 0;
  return (seed >>> 16) & 0x7fff;
};

// Escape hatch for effects that save/restore the stream (WMP does this in places).
A.randSeed = function (s) { if (arguments.length) seed = s! | 0; return seed; };

// ---------------------------------------------------------------- sin / cos
// ucrtbase's sin/cos (10.0.26100) are NOT correctly rounded: on the engines' own arguments
// they differ from the correctly rounded result by 1 ulp on ~2.7 % (sin) / ~3.5 % (cos), and
// those ulps land on cvttsd2si boundaries (NOTES-battery-ab.md).  So this is not an accurate
// sin/cos, it is ucrtbase's: the FMA3 branch (taken whenever the CPU has FMA3+AVX2, i.e. on
// every machine the DLL runs on today: _get_FMA3_enable() == 1) of sin 0x1800aba70 /
// cos 0x1800a7730, their Cody-Waite reduction 0x1800ab910 and Payne-Hanek reduction
// 0x1800ab710, instruction for instruction.  Every vfmadd is one rounding, so it is an exact
// fma here (fma() below); every other op is plain double arithmetic, which JS does identically.
// Globals are captured once: a per-call global lookup is slow wherever the host makes globals
// slow (node vm sandboxes: the private A/B harness), and Math.abs is branch-free where `x < 0 ? -x : x` is not.
var abs = Math.abs, floor = Math.floor;
var SPLIT = 134217729;                                          // 2^27 + 1 (Veltkamp)
var F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);   // little-endian: U32[0] = low word
// fma(a,b,c) = RN(a*b + c), one rounding.  Dekker's exact product, then Boldo-Melquiond: the
// error terms are summed with round-to-odd, which makes the final round-to-nearest exact.
// Valid while nothing over/underflows, which holds for every operand the kernels see.
var PHI = 1.1102230246251568e-16;                             // 2^-53 + 2^-105: RN(x + PHI*|x|) = succ(x)
function fma(a: number, b: number, c: number): number {
  var p = a * b, s = c + p;
  // Screen (Rump-Zimmermann-Boldo-Melquiond successor trick, no bit access): a*b + c =
  // s + se + pe with |pe| <= PHI*|p|.  If that tail is under half the spacing to s's nearer
  // neighbour, the correctly rounded answer is s itself, and the Dekker product is skipped.
  var as = abs(s);
  if (as > 1e-290) {
    var v = s - c, se = (c - (s - v)) + (p - v);
    var e = PHI * as, du = (as + e) - as, dd = as - (as - e);
    if (dd < du) du = dd;                                       // below a power of two the gap halves
    if (abs(se) + abs(p) * PHI < du * 0.49999999999999) return s;   // (margin for this line's own roundings)
  }
  return fmaExact(a, b, c);
}
function fmaExact(a: number, b: number, c: number): number {
  var p = a * b;
  var t = SPLIT * a, ah = t - (t - a), al = a - ah;
  var u = SPLIT * b, bh = u - (u - b), bl = b - bh;
  var pe = ((ah * bh - p) + ah * bl + al * bh) + al * bl;       // a*b = p + pe exactly
  var s = c + p, v = s - c;
  var se = (c - (s - v)) + (p - v);                             // c + p = s + se exactly
  var z = se + pe;                                              // the exact tail, rounded once
  v = z - se;
  var ze = (se - (z - v)) + (pe - v);                           // ...and what that rounding lost
  var r = s + z;
  if (ze === 0) return r;
  // z's rounding can only matter if s + z sits exactly on a tie of the final rounding
  // (rounding is monotone and the tie point is representable at z's scale).  Cheap screen:
  // the error of s + z is (within 2^-52 relative) half an ulp of r.
  v = r - s;
  var re = (s - (r - v)) + (z - v);
  return r + re * 1.0000000000000002 === r ? r : fmaTie(s, z, ze);
}
// Near-tie: round the tail to odd (Boldo-Melquiond), after which round-to-nearest is exact.
// Out of line so the two above stay small enough for V8 to inline.
function fmaTie(s: number, z: number, ze: number): number {
  F64[0] = z;
  if ((U32[0] & 1) === 0) {
    if ((ze > 0) === (z > 0)) U32[0]++;                         // away from zero (lo is even: no carry)
    else if (U32[0] === 0) { U32[0] = 0xffffffff; U32[1]--; } else U32[0]--;
    z = F64[0];
  }
  return s + z;
}
A.fma = fma;

// Coefficients, 0x18010af10.. (sin) and 0x18010aeb0.. (cos).
var S1 = -0.16666666666666666, S2 = 0.00833333333333095, S3 = -0.00019841269836761127,
    S4 = 2.7557316103728802e-06, S5 = -2.5051132068021698e-08, S6 = 1.5918144304485914e-10;
var C1 = 0.041666666666666664, C2 = -0.0013888888888887398, C3 = 2.4801587298767044e-05,
    C4 = -2.755731727234489e-07, C5 = 2.0876146382372144e-09, C6 = -1.138263981623609e-11;
var PIO4 = 0.7853981633974483, TWO_M13 = 0.0001220703125, TWO_M27 = 7.450580596923828e-09;
var TWOBYPI = 0.6366197723675814, SHIFTER = 6755399441055744,  // 0x1.8p52
    PIO2_1 = 1.5707963267948966, PIO2_1T = 6.123233995736757e-17, PIO2_2T = 8.478427660368898e-32;
// Reduction results (r + rr = |x| - region*pi/2), returned through module vars.
// (rr lives in a typed array: a double in a closure variable is a heap allocation per write)
var RR = new Float64Array(1), reg_ = 0;

// 26+27-bit splits of pi/2 and its first tail: n < 2^24 here, so n times either half is exact.
var P1H = 1.5707963109016418, P1L = 1.5893254712295857e-08,
    T1H = 6.123233932053594e-17, T1L = 6.368316315668184e-25;
function reduce(x: number): number {                            // x = |arg|, finite, >= pi/4
  if (x >= 2e7) return reduceBig(x);
  // n = fma(x, 2/pi, 0x1.8p52) - 0x1.8p52 (0x1800ab924): x*2/pi rounded to an integer.  The
  // plain product only decides differently within 2^-52 relative of a half-integer.
  var q = x * TWOBYPI, n = (q + SHIFTER) - SHIFTER, h = q - n;
  if (h < 0) h = -h;
  if (h > 0.5 - q * 2.3e-16 && h < 0.5 + q * 2.3e-16) n = fma(x, TWOBYPI, SHIFTER) - SHIFTER;
  reg_ = n & 3;
  var rh = (x - n * P1H) - n * P1L;                             // fma(-n, pi/2, x): both products exact, x - n*P1H exact (Sterbenz)
  var t = n * PIO2_1T;
  var terr = (n * T1H - t) + n * T1L;                           // fma(n, PIO2_1T, -t): Dekker with n unsplit
  var r5 = rh - t;
  var e4 = (rh - r5) - t;
  var r = fma(-n, PIO2_1T, rh);
  RR[0] = fma(-n, PIO2_2T, ((r5 - r) + e4) - terr);               // 0x1800ab979
  return r;
}

// 0x1800ab710: Payne-Hanek, |x| >= 2e7, on 64-bit words of 2/pi (0x180107360).  Emulated
// with BigInt; the engines never get here (their arguments are angles within a few turns).
// atan(p/q) * 2^bits, a little under (every term truncated): Euler's series, sum over n of
// 2^2n (n!)^2 / (2n+1)! * x^(2n+1) / (1+x^2)^(n+1), each term the last times 2n/(2n+1) * x^2/(1+x^2).
function atanFix(p: bigint, q: bigint, bits: bigint): bigint {
  var d = p * p + q * q, t = (p * q << bits) / d, s = t;
  for (var n = 1n; t > 0n; n++) { t = t * 2n * n * p * p / ((2n * n + 1n) * d); s += t; }
  return s;
}
// The 2/pi table, built on first use: floor(2/pi * 2^1197) shifted up 5 bits, little-endian, then 8 zero
// bytes (159 bytes). pi by Machin's formula, 16 atan(1/5) - 4 atan(1/239), to 1300 bits.
function tpiTable(): Uint8Array {
  var B = 1300n, pi = 16n * atanFix(1n, 5n, B) - 4n * atanFix(1n, 239n, B);
  var v = ((1n << (1198n + B)) / pi) << 5n, t = new Uint8Array(159);
  for (var k = 0; k < 151; k++) t[k] = Number((v >> BigInt(8 * k)) & 255n);
  return t;
}
var TPI: Uint8Array | null = null, M64 = (1n << 64n) - 1n;
function q64(off: number): bigint {                              // little-endian qword at byte off
  var v = 0n;
  for (var k = 7; k >= 0; k--) v = (v << 8n) | BigInt(TPI![off + k]);
  return v;
}
function bsr(v: bigint): number { return v.toString(2).length - 1; }
function toD(bits: bigint): number { var dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, bits); return dv.getFloat64(0); }
function reduceBig(x: number): number {
  if (!TPI) TPI = tpiTable();
  var dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x);
  var bits = dv.getBigUint64(0);
  var e = Number(bits >> 52n) - 0x3ff;
  var off = 0x86 - (e >> 3);
  var m = (bits & ((1n << 52n) - 1n)) | (1n << 52n);
  var p0 = q64(off) * m, p1 = q64(off + 8) * m, p2 = q64(off + 16) * m;
  var r8 = p0 & M64, mid = p1 + (p0 >> 64n);
  var r9 = mid & M64, r10 = ((mid >> 64n) + p2) & M64;
  var e7 = BigInt(e & 7), sh = 54n - e7;
  var ip = r10 >> sh, sign = 0n;
  if ((r10 >> (sh - 1n)) & 1n) {                                // fraction >= 1/2: take the complement
    r10 ^= M64; r9 ^= M64; r8 ^= M64; sign = 1n << 63n; ip += 1n;
  }
  reg_ = Number(ip & 3n);
  var c = e7 + 10n;
  r10 = ((r10 << c) & M64) >> c;
  var r11 = c - 64n, rc: bigint;
  if (r10 === 0n) { r10 = r9; r9 = r8; r8 = 0n; r11 -= 64n; }
  rc = r10 === 0n ? 0n : BigInt(bsr(r10));                      // (both words zero: not reachable for finite x)
  r11 += rc; rc -= 52n;
  if (rc > 0n) {
    var sv = r10; r10 >>= rc; r9 >>= rc; r9 |= (sv << (64n - rc)) & M64;
  } else if (rc < 0n) {
    var ls = -rc, ax = r9;
    r10 = (r10 << ls) & M64; r9 = (r9 << ls) & M64;
    r10 |= ax >> (64n - ls); r9 |= r8 >> (64n - ls);
  }
  r11 += 0x3ffn;
  var hiBits = (r10 & ~(1n << 52n)) | sign | ((r11 << 52n) & M64);
  // bsr of a zero r9 leaves rcx unchanged in hardware (= r11 << 52 here); mirror it.
  var msb = r9 === 0n ? ((r11 << 52n) & M64) : BigInt(bsr(r9));
  rc = (64n - msb) & M64;
  r9 = ((r9 << (rc & 63n)) & M64) >> 12n;
  rc = (rc + 52n) & M64;
  var loBits = (r9 | sign | (((r11 - rc) << 52n) & M64)) & M64;
  var hi = toD(hiBits), lo = toD(loBits);
  dv.setFloat64(0, hi); dv.setBigUint64(0, dv.getBigUint64(0) & 0xfffffffff8000000n);
  var hh = dv.getFloat64(0), hl = hi - hh;
  var P1 = 1.5707963109016418, P2 = 1.5893254712295857e-08;
  var r5 = hi * PIO2_1;
  var r3 = hh * P1 - r5;
  r3 = fma(hl, P1, r3); r3 = fma(hh, P2, r3); r3 = fma(hl, P2, r3);
  var r4 = fma(hi, 6.123233995736765e-17, lo * PIO2_1);
  r3 += r4;
  var r = r5 + r3;
  RR[0] = (r5 - r) + r3;
  return r;
}

// Horner steps go through fma() (its screen almost always settles them); the product-dominated
// steps, where the screen cannot help, go straight to fmaExact().
function sinPoly(r: number, rr: number): number {                                       // 0x1800abebf
  var x2 = r * r;
  var p = fma(fma(fma(fma(S6, x2, S5), x2, S4), x2, S3), x2, S2);
  var x3 = r * x2;
  var t = x2 * (rr * 0.5 - x3 * p) - rr;
  return r - fmaExact(-x3, S1, t);
}
function cosPoly(r: number, rr: number): number {                                       // 0x1800abf20
  var x2 = r * r, h = x2 * 0.5;
  var t = 1 - h;
  var c = fmaExact(-r, rr, ((1 - t) - h));
  var p = fma(fma(fma(fma(fma(C6, x2, C5), x2, C4), x2, C3), x2, C2), x2, C1);
  return fmaExact(p, x2 * x2, c) + t;
}

// ---------------------------------------------------------------- atan2 (ucrtbase clone)
// 0x18004d420, the AVX2+FMA3 branch of ucrtbase!atan2 (taken when the dispatch word
// 0x180139e60 == 3, i.e. the CPU has AVX2).  Table of atan(i/256), i = 16..256, as hi + lo: the value
// truncated to 74 significant bits, split into its top 21 (hi) and the other 53 (lo, exact); filled below.
var ATN_HI = new Float64Array(241), ATN_LO = new Float64Array(241);
var P2H = 1.5707963267948966, P2L = 6.123233995736766e-17, PH = 3.1415926218032837, PL = 3.178650954705639e-08;
function hi32(v: number): number { F64[0] = v; U32[0] = 0; return F64[0]; }                 // clear the low 32 bits
var POW2 = new Float64Array(2046);                                          // 2^-1022 .. 2^1023, exact
POW2[1022] = 1; for (var k = 1; k <= 1023; k++) { POW2[1022 + k] = POW2[1021 + k] * 2; if (k < 1023) POW2[1022 - k] = POW2[1023 - k] / 2; }
function pow2(e: number): number { return POW2[e + 1022]; }
// atan(i/256) to 120 bits, each the last plus atan(1/256 / (1 + i(i+1)/65536)) (a few terms each).
for (var atn = atanFix(16n, 256n, 120n), i = 16; i <= 256; atn += atanFix(256n, BigInt(65536 + i * (i + 1)), 120n), i++) {
  const sh = bsr(atn) - 73, top = atn >> BigInt(sh);                                    // its top 74 bits
  ATN_HI[i - 16] = Number(top >> 53n) * pow2(sh - 67);
  ATN_LO[i - 16] = Number(top & ((1n << 53n) - 1n)) * pow2(sh - 120);
}
function expo(v: number): number { F64[0] = v; return (U32[1] >>> 20) & 0x7ff; }
var TWO512 = 1.3407807929942597e+154;
// 0x1800f3ee8 + 0x1800937b4: q = y*2^100/x, then q*2^-100 by hand -- a shift with round-half-up.
function subTail(q: number): number {
  var e = expo(q), aq = abs(q);
  if (e > 100) return q * 7.888609052210118e-31;                            // stays normal: exact
  var k = 0, sh = 0x65 - e;
  if (sh <= 0x36) {
    var m = aq * pow2(600) * pow2(475 - e);                                  // the 53-bit mantissa, as an integer
    var t = floor(m / Math.pow(2, 100 - e));                              // m >> (100-e)
    k = floor(t / 2) + (t % 2);
  }
  k *= 5e-324;
  return q < 0 ? -k : k;
}
function ucrtAtan2(y: number, x: number): number {
  if (x === 0 || y === 0 || x - x !== 0 || y - y !== 0) return Math.atan2(y, x);
  var ex = expo(x), ey = expo(y);
  if (ex < 0x3fd && ey < 0x3fd) {                                            // 0x18004def0: *2^1024, exact
    x = x * TWO512 * TWO512; y = y * TWO512 * TWO512; ex = expo(x); ey = expo(y);
  }
  var d = ey - ex;
  if (d > 56) return y < 0 ? -P2H : P2H;
  if (d < -28 && x > 0) return d < -1074 ? y * 0 : d < -1022 ? subTail(y * 1.2676506002282294e30 / x) : y / x;
  if (d < -56 && x < 0) return y < 0 ? -3.141592653589793 : 3.141592653589793;
  var neg = y < 0, xneg = x < 0;
  var big = xneg ? -x : x, sml = neg ? -y : y, swp = false;
  if (sml > big) { var t = big; big = sml; sml = t; swp = true; }
  var u = sml / big, h = 0, l;
  if (u > 0.0625) {                                                          // 0x18004d571
    var c0 = (u * 256 + 0.5) | 0, i = c0 - 16;                     // u*256 is exact, so this is the fma
    h = ATN_HI[i];
    var c = c0 * 0.00390625;
    var e = 0x3ff - expo(big), e1 = (e / 2) | 0, e2 = e - e1;
    var s1 = pow2(e1), s2 = pow2(e2);
    var B = s1 * big * s2, S = s1 * sml * s2;
    var Bh = floor(B * 33554432) / 33554432;               // B in [1,2): its low 27 bits cleared
    var num = (S - Bh * c) - (B - Bh) * c;                      // c has 9 bits: both products exact
    var v = num / fmaExact(S, c, B);
    var v2 = v * v;
    l = fma(-v, fma(-v2, 0.19999918038989142, 0.33333333333224097) * v2, v + ATN_LO[i]);
  } else if (u < 1e-8) {
    l = u;
  } else {                                                                   // 0x18004d731
    // Every step here is homogeneous in (big, sml), so normalise big to [1,2) first: exact, and it
    // keeps Dekker's split in fma() from overflowing on the 2^1024-scaled operands.
    var ne = 0x3ff - expo(big), sa = pow2(ne >> 1), sb = pow2(ne - (ne >> 1));
    big = big * sa * sb; sml = sml * sa * sb;
    var u2 = u * u, bh = floor(big * 1048576) / 1048576, uh = hi32(u);   // low 32 bits cleared
    var r = fmaExact(-big, u - uh, (sml - bh * uh) - uh * (big - bh));   // 21x21 and 21x32-bit products: exact
    var p = fma(-fma(-fma(-fma(-0.09002981028544979, u2, 0.11110736283514526), u2, 0.1428571356180717), u2,
                0.19999999999393223), u2, 0.3333333333333317);
    l = fmaExact(-(u2 * u), p, r / big) + u;
  }
  if (swp) { h = P2H - h; l = P2L - l; }
  if (xneg) { h = PH - h; l = PL - l; }
  var res = h + l;
  return neg ? -res : res;
}

function ucrtSin(x: number): number {
  var ax = abs(x);
  if (ax < PIO4) {
    if (ax >= TWO_M13) {                                        // 0x1800abe40
      var x2 = x * x;
      return fmaExact(x * x2, fma(fma(fma(fma(fma(S6, x2, S5), x2, S4), x2, S3), x2, S2), x2, S1), x);
    }
    if (ax >= TWO_M27) return fmaExact(-(x * x * x), 0.16666666666666666, x);
    return x;
  }
  if (!(ax <= 1.7976931348623157e308)) return x - x;          // inf, NaN -> NaN
  var r = reduce(ax), q = reg_;
  var y = (q & 1) ? cosPoly(r, RR[0]) : sinPoly(r, RR[0]);
  return ((q & 2) !== 0) !== (x < 0) ? -y : y;
}

function ucrtCos(x: number): number {
  var ax = abs(x);
  if (ax <= PIO4) {
    if (ax >= TWO_M13) {                                        // 0x1800a7b25
      var x2 = x * x;
      var p = fma(fma(fma(fma(fma(C6, x2, C5), x2, C4), x2, C3), x2, C2), x2, C1);
      return fmaExact(fma(p, x2, -0.5), x2, 1);
    }
    if (ax >= TWO_M27) return fmaExact(-(x * 0.5), x, 1);
    return 1;
  }
  if (!(ax <= 1.7976931348623157e308)) return x - x;          // inf, NaN -> NaN
  var r = reduce(ax), q = reg_;
  var y = (q & 1) ? sinPoly(r, RR[0]) : cosPoly(r, RR[0]);
  return ((q + 1) & 2) ? -y : y;
}

// out[0] = sin(x), out[1] = cos(x), bit for bit what A.sin / A.cos return: where both reduce
// (|x| > pi/4), they reduce identically and each takes one of the same two polynomials on the
// same (r, rr), so one reduction and one evaluation of each polynomial serve both. The results go
// out through a typed array: a double returned from a call that is not inlined is a heap
// allocation, and these run per pixel of a stroke.
function ucrtSincos(x: number, out: Float64Array): void {
  var ax = abs(x);
  if (ax > PIO4 && ax <= 1.7976931348623157e308) {
    var r = reduce(ax), q = reg_, rr = RR[0];
    var s = sinPoly(r, rr), c = cosPoly(r, rr);
    var ys = (q & 1) ? c : s, yc = (q & 1) ? s : c;
    out[0] = ((q & 2) !== 0) !== (x < 0) ? -ys : ys;
    out[1] = ((q + 1) & 2) ? -yc : yc;
  } else {
    out[0] = ucrtSin(x); out[1] = ucrtCos(x);
  }
}

// ---------------------------------------------------------------- the same clones in WebAssembly
// assembly/trig.ts (embedded as ./trig-wasm.ts) is sin, cos and atan2 above, op for op: the same f64
// arithmetic and the same emulated fma, so it returns the same bits, in about half the time; and its
// doubles stay unboxed where the JavaScript's, returned from calls V8 does not inline, are heap
// allocations. Only |x| < 2e7 goes to its sin/cos: the Payne-Hanek reduction, NaN and the
// infinities stay here.
//
// A.trigMode: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM or throw
// (tests use it to prove the path ran). The engines hoist A.sin, A.cos, A.sincos, A.sincosN and
// A.atan2 once, so these stay the same functions and read the mode per call. The module (under 4 KB)
// compiles synchronously on the first call that wants it; any refusal (no WebAssembly, a CSP without wasm-unsafe-eval) leaves
// the JavaScript in charge for good.
interface TrigKernel {
  memory: WebAssembly.Memory;
  heapBase: () => number;
  sin: (x: number) => number;
  cos: (x: number) => number;
  sincos: (x: number, out: number) => void;
  sincosN: (src: number, dst: number, n: number) => number;
  atanInit: (tables: number) => void;
  atan2: (y: number, x: number) => number;
}
var trigMode: 'auto' | 'js' | 'wasm' = 'auto', K: TrigKernel | null = null, tried = false, on = false;
var ksin = ucrtSin, kcos = ucrtCos, ksc: TrigKernel['sincos'] = function () {}, KO = 0, KF = F64;
// sincosN's batches: CAP arguments at KX, their 2*CAP results at KS, after the sincos slot (one page)
var CAP = 2048, ksn: TrigKernel['sincosN'] = function () { return 0; }, KXo = 0, KSo = 0, KX = F64, KS = F64;
var katan2 = ucrtAtan2;                             // after the batches: ATN_HI then ATN_LO (241 each)
function trigKernel(): TrigKernel | null {
  if (tried) return K;
  tried = true;
  try {
    var bin = atob(TRIG_WASM), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var k = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as TrigKernel;
    KO = k.heapBase();
    if (k.memory.buffer.byteLength < KO + 16) k.memory.grow(1);         // it starts empty; never grown again
    KF = new Float64Array(k.memory.buffer, KO, 2);
    KXo = KO + 16; KSo = KXo + 8 * CAP;
    KX = new Float64Array(k.memory.buffer, KXo, CAP); KS = new Float64Array(k.memory.buffer, KSo, 2 * CAP);
    var atn = KSo + 16 * CAP;
    new Float64Array(k.memory.buffer, atn, 241).set(ATN_HI); new Float64Array(k.memory.buffer, atn + 1928, 241).set(ATN_LO);
    k.atanInit(atn);
    ksin = k.sin; kcos = k.cos; ksc = k.sincos; ksn = k.sincosN; katan2 = k.atan2; K = k;
  } catch {
    K = null;                                        // no WebAssembly / CSP: JS from now on
  }
  return K;
}
function settle(): void { on = trigMode !== 'js' && trigKernel() !== null; }
Object.defineProperty(A, 'trigMode', {
  enumerable: true,
  get: function () { return trigMode; },
  set: function (m: 'auto' | 'js' | 'wasm') {
    if (m === 'wasm' && !trigKernel()) throw new Error('trig: the WebAssembly sin/cos is unavailable here');
    trigMode = m; settle();
  },
});

A.sin = function (x) {
  if (on) { if (x < 2e7 && x > -2e7) return ksin(x); }
  else if (!tried && trigMode !== 'js') settle();
  return ucrtSin(x);
};
A.cos = function (x) {
  if (on) { if (x < 2e7 && x > -2e7) return kcos(x); }
  else if (!tried && trigMode !== 'js') settle();
  return ucrtCos(x);
};
A.sincos = function (x, out) {
  if (on) {
    if (x < 2e7 && x > -2e7) { ksc(x, KO); out[0] = KF[0]; out[1] = KF[1]; return; }
  } else if (!tried && trigMode !== 'js') settle();
  ucrtSincos(x, out);
};

// out[2i] = sin(x[i]), out[2i + 1] = cos(x[i]) for i < n: A.sincos over an array, the same bits. On
// the WASM path a batch is one call (CAP at a time), so a loop of them pays no call per argument, and
// no double of it is ever boxed.
var SCT = new Float64Array(2);
A.sincosN = function (x, n, out) {
  var i: number;
  if (!on && !tried && trigMode !== 'js') settle();
  if (!on) {
    for (i = 0; i < n; i++) { ucrtSincos(x[i], SCT); out[2 * i] = SCT[0]; out[2 * i + 1] = SCT[1]; }
    return;
  }
  for (var i0 = 0; i0 < n; i0 += CAP) {
    var m = n - i0 < CAP ? n - i0 : CAP, k: number;
    for (k = 0; k < m; k++) KX[k] = x[i0 + k];
    var left = ksn(KXo, KSo, m);
    for (k = 0; k < 2 * m; k++) out[2 * i0 + k] = KS[k];
    if (left > 0) {                                  // |x| >= 2e7, NaN, infinities: the JavaScript
      for (k = 0; k < m; k++) {
        var v = x[i0 + k];
        if (!(v < 2e7 && v > -2e7)) { ucrtSincos(v, SCT); out[2 * (i0 + k)] = SCT[0]; out[2 * (i0 + k) + 1] = SCT[1]; }
      }
    }
  }
};

// atan2 likewise: assembly/trig.ts has it op for op, on this file's own tables; zeros, infinities and
// NaN go to Math.atan2 here, as ucrtAtan2 sends them.
A.atan2 = function (y, x) {
  if (on) { if (x !== 0 && y !== 0 && x - x === 0 && y - y === 0) return katan2(y, x); }
  else if (!tried && trigMode !== 'js') settle();
  return ucrtAtan2(y, x);
};

export { ATN_HI, ATN_LO, tpiTable };
