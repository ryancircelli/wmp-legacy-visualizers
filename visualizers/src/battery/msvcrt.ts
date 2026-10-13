// msvcrt.dll's sin, cos, tan and atan2 as WMP 11's Battery reaches them (_CIsin/_CIcos/_CItan/_CIatan2), on the
// harness's 32-bit msvcrt.dll 7.0.26100.9444.
//
// Which path runs: each _CI entry takes the SSE2 routine only when msvcrt's flag 0x100bfcec is set, and only
// _set_SSE2_enable(1) sets it (0x100a4100; DLL init stores the CPU check in 0x100bfce8, not there). Neither
// PowerShell nor WMP 11's wmp.dll/wmploc.dll call it (read back in-process: 0 after loading both), so the harness
// runs the x87 path:
//   sin/cos/tan  FSIN/FCOS/FPTAN of the st(0) argument (0x10099698, 0x10098ef8, 0x10099888; |x| >= 2^63 is first
//                reduced by FPREM1, see arg87).
//   atan2        the trandisp dispatcher (0x100a53b1) at 64-bit precision: r = FPATAN(|y|, |x|), then FLDPI;
//                FSUBRP (r = pi64 - r, rounded to 64 bits) when x < 0, FCHS when y < 0 (0x100a6000). Zeros,
//                infinities and NaNs go to the table at 0x100bcbb0: y = 0 or x = inf -> +-0 or +-pi64 by the sign of
//                x; x = 0 or y = inf -> +-pi64/2; both infinite -> NaN.
// All four return the 64-bit-mantissa st(0). WMP 11 stores it (fstp), rounds it to float (fstps) or uses it in the
// next x87 op at 53-bit precision (faddl after atan2, fmull after sin/cos), so the Ext functions give that value as
// [hi, lo] (hi + lo exact, hi the double a store makes) and the plain ones the stored double.
//
// Exactness, against this machine's FPU (i7-11370H) through the _CI entries on 2.9M arguments per function
// (tests/battery-msvcrt.test.ts holds a sample):
//   FSIN/FCOS/FPTAN are not correctly rounded (FSIN: ~3 % of 64-bit results are one unit off the exact value of
//   the 66-bit-pi reduction, with no pattern), so nothing closed-form reproduces them. These use the Plenoptic
//   FSIN/FCOS model and the battery FPTAN model (./x87): stored double wrong ~2e-5 of the time for sin/cos, ~1.5e-4
//   for tan, for |x| < 2^20; never on integer x in +-400. Past 2^20 approximate (arg87).
//   FPATAN(|y|, |x|) is modelled as the correctly rounded atan: ~3 % of 64-bit results and ~1e-5 of stored doubles
//   miss. The fixups are exact. On Battery's own domain, integer y, x in +-400, a table of the FPU's corrections
//   makes atan2 exact to the last of the 64 bits (all 641,601 pairs).
import { sincos87, tan87 } from './x87';

const SPLIT = 134217729;   // 2^27 + 1
const PI64_LO = 565 * 2 ** -62;   // FLDPI = 0xC90FDAA22168C235 * 2^-62 = Math.PI + PI64_LO
const PIO2_LO = 6.123233995736766e-17;   // pi/2 - Math.PI/2

var BITS = new Float64Array(1), W = new Uint32Array(BITS.buffer);
function dd(hex: string): Float64Array {
  var h = hex.split(' '), o = new Float64Array(h.length);
  for (var i = 0; i < h.length; i++) { W[1] = parseInt(h[i].slice(0, 8), 16); W[0] = parseInt(h[i].slice(8), 16); o[i] = BITS[0]; }
  return o;
}
// atan(k/64), k = 0..64, as double-double (hi, lo)
const ATAN64 = dd(
  '0000000000000000 0000000000000000 3f8fff555bbb729b bc2220c39d4dff50 3f9ffd55bba97625 bc35ec431444912c ' +
  '3fa7fb818430da2a bc086ef8f794f105 3faff55bb72cfdea bc3c934d86d23f1d 3fb3f59f0e7c559d 3c5ac4ce285df847 ' +
  '3fb7ee182602f10f bc5cfb654c0c3d98 3fbbe39ebe6f07c3 3c5f7b8f29a05987 3fbfd5ba9aac2f6e bc4cd37686760c17 ' +
  '3fc1e1fafb043727 bc4b485914dacf8c 3fc3d6eee8c6626c 3c661a3b0ce9281b 3fc5c9811e3ec26a bc5054ab2c010f3d ' +
  '3fc7b97b4bce5b02 3c5347b0b4f881ca 3fc9a6a8e96c8626 3c4cf601e7b4348e 3fcb90d7529260a2 3c217b10d2e0e5ab ' +
  '3fcd77d5df205736 3c6c648d1534597e 3fcf5b75f92c80dd 3c68ab6e3cf7afbd 3fd09dc597d86362 3c762e47390cb865 ' +
  '3fd18bf5a30bf178 3c630ca4748b1bf9 3fd278372057ef46 bc7077cdd36dfc81 3fd362773707ebcc bc6963a544b672d8 ' +
  '3fd44aa436c2af0a bc75d5e43c55b3ba 3fd530ad9951cd4a bc62566480884082 3fd614840309cfe2 bc7a725715711f00 ' +
  '3fd6f61941e4def1 bc7c63aae6f6e918 3fd7d5604b63b3f7 3c769c885c2b249a 3fd8b24d394a1b25 3c7b6d0ba3748fa8 ' +
  '3fd98cd5454d6b18 3c79e6c988fd0a77 3fda64eec3cc23fd bc724dec1b50b7ff 3fdb3a911da65c6c 3c7ae187b1ca5040 ' +
  '3fdc0db4c94ec9f0 bc7cc1ce70934c34 3fdcde53432c1351 bc7a2cfa4418f1ad 3fddac670561bb4f 3c7a2b7f222f65e2 ' +
  '3fde77eb7f175a34 3c70e53dc1bf3435 3fdf40dd0b541418 bc6a3992dc382a23 3fe0039c73c1a40c bc8b32c949c9d593 ' +
  '3fe0657e94db30d0 bc7d5b495f6349e6 3fe0c6145b5b43da 3c5974fa13b5404f 3fe1255d9bfbd2a9 bc52bdaee1c0ee35 ' +
  '3fe1835a88be7c13 3c8c621cec00c301 3fe1e00babdefeb4 bc5928df287a668f 3fe23b71e2cc9e6a 3c6c421c9f38224e ' +
  '3fe2958e59308e31 bc709e73b0c6c087 3fe2ee628406cbca 3c8c5d5e9ff0cf8d 3fe345f01cce37bb 3c81021137c71102 ' +
  '3fe39c391cd4171a bc82304331d8bf46 3fe3f13fb89e96f4 3c7ecf8b492644f0 3fe445065b795b56 bc7f76d0163f79c8 ' +
  '3fe4978fa3269ee1 3c72419a87f2a458 3fe4e8de5bb6ec04 3c84a33dbeb3796c 3fe538f57b89061f bc81bb74abda520c ' +
  '3fe587d81f732fbb bc75e5c9d8c5a950 3fe5d58987169b18 3c60028e4bc5e7ca 3fe6220d115d7b8e bc62b785350ee8c1 ' +
  '3fe66d663923e087 bc76ea6febe8bbba 3fe6b798920b3d99 bc8a80386188c50e 3fe700a7c5784634 bc78c34d25aadef6 ' +
  '3fe748978fba8e0f 3c47b2a6165884a1 3fe78f6bbd5d315e 3c8406a089803740 3fe7d528289fa093 3c8560821e2f3aa9 ' +
  '3fe819d0b7158a4d bc7bf76229d3b917 3fe85d69576cc2c5 3c66b66e7fc8b8c3 3fe89ff5ff57f1f8 bc855b9a5e177a1b ' +
  '3fe8e17aa99cc05e bc7ec182ab042f61 3fe921fb54442d18 3c81a62633145c07');

var TP = new Float64Array(2), TS = new Float64Array(2);
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

/** atan(p / q) for 0 < p <= q, as double-double (error ~2^-88 relative): table at k/64, then the series in u */
function atanDD(p: number, q: number, o: Float64Array): void {
  var th = p / q;
  twoProd(th, q, TP);
  var tl = ((p - TP[0]) - TP[1]) / q;                 // p/q = th + tl
  var k = Math.round(th * 64), c = k / 64, uh = th, ul = tl;
  if (k !== 0) {                                      // u = (t - c) / (1 + t c), |u| <= 1/128
    twoSum(th - c, tl, TS);                           // th - c is exact (Sterbenz)
    var n0 = TS[0], n1 = TS[1];
    twoProd(th, c, TP);
    twoSum(1, TP[0], TS);
    var d0 = TS[0], d1 = TS[1] + TP[1] + tl * c;
    uh = n0 / d0;
    twoProd(uh, d0, TP);
    ul = (((n0 - TP[0]) - TP[1]) + n1 - uh * d1) / d0;
  }
  // atan u = u - u^3/3 + u^5 (1/5 - u^2/7 + u^4/9 - u^6/11 + u^8/13); u^3/3 in double-double
  twoProd(uh, uh, TP);
  var s0 = TP[0], s1 = TP[1] + 2 * uh * ul;
  twoProd(s0, uh, TP);
  var c0 = TP[0], c1 = TP[1] + s1 * uh + s0 * ul;
  var t3 = c0 / 3;
  twoProd(t3, 3, TP);
  var t3l = (((c0 - TP[0]) - TP[1]) + c1) / 3;
  var u2 = s0, tail = u2 * s0 * uh * (1 / 5 - u2 * (1 / 7 - u2 * (1 / 9 - u2 * (1 / 11 - u2 / 13))));
  twoSum(uh, -t3, TS);
  var a0 = TS[0], a1 = TS[1] + (ul - t3l + tail);
  twoSum(ATAN64[2 * k], a0, TS);
  var b1 = TS[1] + ATAN64[2 * k + 1] + a1;
  twoSum(TS[0], b1, o);
}

// The FPU's FPATAN(a, b) - round64(atan(a / b)) for integers 1 <= a, b <= 400 where it is not 0 (always +-1 unit;
// it depends on a / b only, so coprime pairs): sorted keys (a * 401 + b) * 2 + (delta > 0), as 12-bit gaps in
// base64. Read off the FPU through _CIatan2 (all 641,601 pairs in +-400); rebuild it if the model changes.
const FIX = new Map<number, number>();
(function () {
  var s =
  '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';
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', k = 0;
  for (var i = 0; i < s.length; i += 2) {
    k += (A.indexOf(s[i]) << 6) | A.indexOf(s[i + 1]);
    FIX.set(k >> 1, k & 1 ? 1 : -1);
  }
})();
function fpuFix(a: number, b: number): number {
  if (a > 400 || b > 400 || a !== Math.floor(a) || b !== Math.floor(b)) return 0;
  var g = a, h = b;
  while (h) { var t = g % h; g = h; h = t; }
  return FIX.get((a / g) * 401 + b / g) || 0;
}

/** hi + lo (normalised, hi normal) rounded to a 64-bit mantissa, ties to even, plus d units; renormalised into o */
function round64(hi: number, lo: number, d: number, o: Float64Array): void {
  BITS[0] = hi;
  var e = ((W[1] >>> 20) & 0x7ff) - 1023;
  if (W[0] === 0 && (W[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;   // hi = 2^e, value below it
  var g = Math.pow(2, e - 63), q = lo / g, n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;                                         // Math.round is half-up
  twoSum(hi, (n + d) * g, o);
}

// pi64 - r rounded to 64 bits (FSUBRP at 64-bit precision), r a 64-bit value in [0, pi/2]: exact in BigInt
const PI64_M = 0xc90fdaa22168c235n << 66n;          // pi64 in units of 2^-128
function piMinus(rh: number, rl: number, o: Float64Array): void {
  if (rh < 2 ** -64) { o[0] = Math.PI; o[1] = PI64_LO; return; }   // below half a unit: pi64 itself
  var d = PI64_M - BigInt(rh * 2 ** 128) - BigInt(rl * 2 ** 128);  // both exact multiples of 2^-128 here
  var sh = d >= 1n << 129n ? 66n : 65n, m = d >> sh, rem = d - (m << sh), half = 1n << (sh - 1n);   // d has 129/130 bits
  if (rem > half || (rem === half && (m & 1n))) m++;
  var scale = 2 ** (Number(sh) - 128), mh = m >> 11n;
  twoSum(Number(mh << 11n) * scale, Number(m - (mh << 11n)) * scale, o);
}

var R = new Float64Array(2), SC = new Float64Array(4);

/** _CIatan2(y, x): the 64-bit st(0) as out = [hi, lo] */
export function atan2Ext32(y: number, x: number, out: Float64Array): void {
  var ny = y < 0 || Object.is(y, -0), nx = x < 0 || Object.is(x, -0), ay = Math.abs(y), ax = Math.abs(x);
  var h: number, l: number;
  if (y !== y || x !== x || (ay === Infinity && ax === Infinity)) { h = NaN; l = 0; }
  else if (ay === 0 || ax === Infinity) { h = nx ? Math.PI : 0; l = nx ? PI64_LO : 0; }
  else if (ax === 0 || ay === Infinity) { h = Math.PI / 2; l = PI64_LO / 2; }
  // atan(t) = t to 2^-2000: pi64 - t rounds to pi64; +-t is t rounded to 53 bits, and when that is denormal the
  // underflow path (0x100a6205: scale by 2^1536, store, hand to the error handler) chops it to the denormal grid
  else if (ay / ax < 2 ** -1000) {
    var t = (ay * 2 ** 600) / ax;                     // t * 2^600, normal
    h = nx ? Math.PI : t < 2 ** -422 ? Math.trunc(t * 2 ** 474) * 2 ** -600 * 2 ** -474 : t * 2 ** -600;
    l = nx ? PI64_LO : 0;
  }
  else {
    // scale the pair so the larger is in [1, 2): twoProd's split overflows past 2^996 and drops its low parts near
    // the denormals (exact: the quotient is >= 2^-1000 here, so the smaller one stays normal)
    var p = Math.min(ay, ax), q = Math.max(ay, ax);
    if (q < 2 ** -500) { p *= 2 ** 600; q *= 2 ** 600; }
    BITS[0] = q;
    var sc = 2 ** (1023 - ((W[1] >>> 20) & 0x7ff));
    atanDD(p * sc, q * sc, R);
    if (ay > ax) { twoSum(Math.PI / 2, -R[0], TS); twoSum(TS[0], TS[1] + (PIO2_LO - R[1]), R); }
    round64(R[0], R[1], fpuFix(ay, ax), R);
    if (nx) piMinus(R[0], R[1], R);
    h = R[0]; l = R[1];
  }
  out[0] = ny ? -h : h; out[1] = ny ? -l : l;
}
// Large arguments, reduced exactly in BigInt and handed to the models as a double, so approximate (Battery never
// gets there): from 2^20 the models' own reduction (k * pi/2 exact for k < 2^20) runs out, so take x mod 2pi66 (4x
// the FPU's 66-bit pi/2: the same reduced argument); from 2^63 (FSIN's limit) msvcrt first takes FPREM1 by
// 0xC90FDAA22168C235 = pi64 * 2^62 (the 80-bit constant at 0x10023e5a), leaving an integer below 2^63.
const PI66X4 = 0x3243f6a8885a308d3n << 2n;            // * 2^-65
const PI64_2_62 = 0xc90fdaa22168c235n << 65n;         // * 2^-65
function remNear(X: bigint, M: bigint): bigint {     // X - n M, n nearest X / M, ties to even
  if (X < 0n) return -remNear(-X, M);
  var n = X / M, r = X - n * M;
  return 2n * r > M || (2n * r === M && (n & 1n)) ? r - M : r;
}
function arg87(x: number): number {
  var ax = Math.abs(x);
  if (!(ax >= 2 ** 20) || ax === Infinity) return x;
  BITS[0] = ax;
  var e = ((W[1] >>> 20) & 0x7ff) - 1075, X = BigInt(ax / 2 ** e) << BigInt(e + 65);
  if (ax >= 2 ** 63) X = remNear(X, PI64_2_62);
  var r = Number(remNear(X, PI66X4)) * 2 ** -65;
  return x < 0 ? -r : r;
}
/** _CIsin(x): FSIN, out = [hi, lo] */
export function sinExt32(x: number, out: Float64Array): void {
  // x - x^3/6 rounds to x below 2^-32 (and the model can't take denormals); x * 0 keeps -0's sign through hi + lo
  if (Math.abs(x) < 2 ** -32) { out[0] = x; out[1] = x * 0; return; }
  sincos87(arg87(x), SC); out[0] = SC[0]; out[1] = SC[1];
}
/** _CIcos(x): FCOS, out = [hi, lo] */
export function cosExt32(x: number, out: Float64Array): void { sincos87(arg87(x), SC); out[0] = SC[2]; out[1] = SC[3]; }
/** _CItan(x): FPTAN, out = [hi, lo] */
export function tanExt32(x: number, out: Float64Array): void {
  if (Math.abs(x) < 2 ** -32) { out[0] = x; out[1] = x * 0; return; }   // x + x^3/3 rounds to x
  tan87(arg87(x), out);
}

var E = new Float64Array(2);
/** atan2(y, x) stored to a double */
export function atan2_32(y: number, x: number): number { atan2Ext32(y, x, E); return E[0] + E[1]; }
/** sin(x) stored to a double */
export function sin32(x: number): number { sinExt32(x, E); return E[0] + E[1]; }
/** cos(x) stored to a double */
export function cos32(x: number): number { cosExt32(x, E); return E[0] + E[1]; }
/** tan(x) stored to a double */
export function tan32(x: number): number { tanExt32(x, E); return E[0] + E[1]; }
/** a 64-bit st(0) value hi + lo stored to a float (fstps): one rounding, not via the double */
export function f32Ext(hi: number, lo: number): number {
  var f = Math.fround(hi);
  if (lo === 0 || f === hi) return f;
  var g = hi + (hi - f);                              // the float on hi's other side, if hi is a float tie
  if (Math.fround(g) !== g) return f;
  return (lo > 0) === (g > f) ? g : f;
}
