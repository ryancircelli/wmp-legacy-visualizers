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
// slow (node vm sandboxes: every A/B tool), and Math.abs is branch-free where `x < 0 ? -x : x` is not.
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
var TPI_HEX = 'e0f11bc10c582174357ec47eedafa94b4a29dee71cf4ecc597af1feb9ed4b5a87f799afd183ddd262c9f3cfbd9b47db4' +
  '29682d46bcbc3f601678ff5fe27feca0e4f72e7e1172d2e74c0de65847e604f97dd19ac071a61312edbad4d708a2fb9ca6c472ac77f8' +
  '73484627a8bb2419804b3709e9b891dc8615ef7aaf8e45f907410ef164568a6d0377d3d4475f9df0a7541039b90de68b020000000000000000';
var TPI: Uint8Array | null = null, M64 = (1n << 64n) - 1n;
function q64(off: number): bigint {                              // little-endian qword at byte off
  var v = 0n;
  for (var k = 7; k >= 0; k--) v = (v << 8n) | BigInt(TPI![off + k]);
  return v;
}
function bsr(v: bigint): number { return v.toString(2).length - 1; }
function toD(bits: bigint): number { var dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, bits); return dv.getFloat64(0); }
function reduceBig(x: number): number {
  if (!TPI) { TPI = new Uint8Array(TPI_HEX.length / 2); for (var k = 0; k < TPI.length; k++) TPI[k] = parseInt(TPI_HEX.substr(2 * k, 2), 16); }
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
// 0x180139e60 == 3, i.e. the CPU has AVX2).  Table of atan(i/256) as hi (few-bit) + lo.
// eslint-disable-next-line no-loss-of-precision -- exact CRT table constants; toPrecision() round-trip quirks on a few entries, not real precision loss (all round-trip via Number(x).toString() === x)
var ATN_HI = new Float64Array([0.06241878867149353,0.06630885601043701,0.07019692659378052,0.07408291101455688,0.07796663045883179,0.08184796571731567,0.08572685718536377,0.08960312604904175,0.09347677230834961,0.09734755754470825,0.1012154221534729,0.105080246925354,0.10894191265106201,0.11280035972595215,0.11665540933609009,0.12050700187683105,0.12435495853424072,0.12819921970367432,0.13203966617584229,0.13587629795074463,0.1397087574005127,0.14353728294372559,0.1473613977432251,0.15118122100830078,0.15499663352966309,0.15880751609802246,0.16261374950408936,0.16641521453857422,0.17021191120147705,0.1740034818649292,0.17779016494750977,0.1815716028213501,0.18534791469573975,0.18911874294281006,0.19288420677185059,0.19664418697357178,0.20039844512939453,0.2041471004486084,0.20788991451263428,0.21162676811218262,0.21535766124725342,0.21908247470855713,0.2228010892868042,0.22651350498199463,0.23021948337554932,0.2339191436767578,0.23761224746704102,0.24129879474639893,0.24497854709625244,0.2486516237258911,0.2523179054260254,0.25597715377807617,0.259629487991333,0.2632746696472168,0.26691293716430664,0.27054381370544434,0.2741672992706299,0.2777836322784424,0.28139233589172363,0.28499364852905273,0.2885873317718506,0.2921731472015381,0.29575157165527344,0.29932212829589844,0.3028848171234131,0.3064393997192383,0.3099863529205322,0.3135249614715576,0.31705570220947266,0.32057809829711914,0.32409238815307617,0.32759833335876465,0.33109593391418457,0.33458518981933594,0.33806610107421875,0.3415381908416748,0.3450021743774414,0.34845709800720215,0.35190367698669434,0.35534143447875977,0.35877060890197754,0.36219072341918945,0.3656022548675537,0.3690047264099121,0.37239837646484375,0.37578296661376953,0.37915849685668945,0.3825252056121826,0.3858826160430908,0.38923096656799316,0.39257001876831055,0.39590001106262207,0.39922070503234863,0.40253210067749023,0.4058341979980469,0.40912699699401855,0.41241025924682617,0.41568422317504883,0.4189488887786865,0.42220401763916016,0.4254496097564697,0.42868566513061523,0.4319121837615967,0.43512916564941406,0.4383363723754883,0.44153428077697754,0.44472241401672363,0.44790077209472656,0.45106959342956543,0.45422863960266113,0.45737791061401367,0.46051764488220215,0.46364760398864746,0.4667675495147705,0.4698779582977295,0.4729785919189453,0.47606921195983887,0.47915005683898926,0.4822211265563965,0.48528242111206055,0.48833394050598145,0.4913754463195801,0.49440693855285645,0.49742889404296875,0.5004405975341797,0.5034427642822266,0.5064349174499512,0.5094170570373535,0.5123891830444336,0.5153517723083496,0.5183043479919434,0.5212469100952148,0.5241794586181641,0.527101993560791,0.5300149917602539,0.5329179763793945,0.5358109474182129,0.538693904876709,0.541567325592041,0.5444307327270508,0.5472841262817383,0.5501275062561035,0.5529613494873047,0.5557851791381836,0.5585989952087402,0.5614032745361328,0.5641975402832031,0.5669817924499512,0.569756031036377,0.5725207328796387,0.5752758979797363,0.5780210494995117,0.5807561874389648,0.5834817886352539,0.5861973762512207,0.5889034271240234,0.5915994644165039,0.5942859649658203,0.5969629287719727,0.5996298789978027,0.6022872924804688,0.6049346923828125,0.6075730323791504,0.610201358795166,0.6128201484680176,0.6154289245605469,0.6180286407470703,0.6206188201904297,0.6231989860534668,0.625770092010498,0.628331184387207,0.6308832168579102,0.6334257125854492,0.6359586715698242,0.6384820938110352,0.640995979309082,0.643500804901123,0.64599609375,0.6484823226928711,0.6509590148925781,0.6534261703491211,0.6558842658996582,0.6583328247070312,0.6607723236083984,0.6632027626037598,0.665623664855957,0.6680359840393066,0.6704387664794922,0.6728324890136719,0.6752166748046875,0.6775922775268555,0.6799588203430176,0.6823163032531738,0.6846647262573242,0.6870040893554688,0.6893348693847656,0.6916565895080566,0.6939692497253418,0.6962728500366211,0.6985678672790527,0.7008543014526367,0.7031316757202148,0.7054004669189453,0.7076601982116699,0.7099113464355469,0.7121539115905762,0.7143878936767578,0.7166132926940918,0.7188296318054199,0.7210378646850586,0.7232375144958496,0.725428581237793,0.7276110649108887,0.7297854423522949,0.7319507598876953,0.7341084480285645,0.7362570762634277,0.7383975982666016,0.7405300140380859,0.7426543235778809,0.7447700500488281,0.7468776702880859,0.7489767074584961,0.751068115234375,0.7531509399414062,0.7552261352539062,0.7572927474975586,0.7593517303466797,0.7614026069641113,0.7634453773498535,0.7654800415039062,0.7675070762634277,0.7695260047912598,0.7715373039245605,0.7735409736633301,0.7755365371704102,0.7775239944458008,0.7795042991638184,0.7814764976501465,0.7834410667419434,0.785398006439209]);
var ATN_LO = new Float64Array([2.132446381820054e-08,3.8909386476171276e-08,4.4478090000943745e-08,1.1534476846011275e-08,3.372710519453953e-09,2.4085760873610986e-08,1.858538104506238e-08,5.143582999692251e-08,8.850239854129525e-09,1.5942515421435843e-08,1.9513993773775575e-08,2.6490975527354432e-08,4.433880378812311e-08,2.1475707242182127e-08,2.6104979267075422e-08,7.814393506744663e-09,3.60125207123751e-08,6.152762381793438e-08,9.543879646411843e-08,3.0278956685150275e-08,1.1688865094987086e-07,1.0758095646865334e-08,8.334542653795354e-08,1.1079027927262953e-07,1.0839427789636621e-07,9.221760861268411e-08,7.909385921990488e-08,8.664454071642931e-08,1.4083997353709244e-08,1.190704385073076e-07,6.404516630517162e-08,1.0833868207634367e-07,3.5299955018792274e-08,1.0598327393004308e-07,1.0548612407825955e-07,5.821677322817765e-08,1.0869648398340394e-07,4.4733508612237754e-08,1.2689628716261572e-08,4.065344715891514e-08,3.84504846300557e-08,3.607150064048073e-08,6.447259031655227e-08,3.6374924997640946e-08,1.0390129441383391e-07,6.253797563021679e-08,6.639843023684888e-08,3.218445989715483e-08,1.1603061171276583e-07,1.1746462214234773e-07,7.54604017965809e-08,1.4923492935620656e-07,1.4141692452321743e-07,2.133080656174835e-07,5.042309379333023e-08,5.458749222816555e-08,1.5184902891478687e-07,3.090043087037693e-08,9.675745481847383e-08,4.025082855293222e-08,3.012222680968611e-08,2.361898606700793e-07,1.1409515811108089e-07,7.423490897465735e-08,5.125155831962304e-08,2.1929039182876392e-07,3.832635121875539e-08,1.6151348628409052e-07,5.099967435355899e-08,1.2369403786124677e-07,8.233679553511238e-08,1.075917662130537e-07,1.4278994752463182e-07,1.3234712302471188e-07,2.1762606731659815e-08,2.344548669230443e-07,2.829663702617669e-09,2.2930091989090763e-07,1.4842827045026128e-07,1.8793740857431398e-07,6.13685946813334e-08,1.9858502273358382e-07,7.68394131623753e-08,1.2811905231243675e-07,7.021191047192365e-08,9.879547938206363e-08,1.7217675238103499e-07,1.128772251461697e-08,5.3354982955585174e-08,2.1383327571081652e-08,1.1624351804829056e-07,6.299264083690559e-08,6.45429039328022e-08,8.640019228142819e-08,9.507675722023258e-08,5.8085149750812114e-08,1.8235056113502477e-07,1.989486805873906e-07,7.835486634501977e-08,3.043742344867986e-08,2.761357256297974e-08,4.3261010545420307e-08,5.1710751532412726e-08,2.8239832787584144e-08,1.874824695241956e-07,2.974818916627141e-08,9.944215708435843e-09,1.0705621073039185e-07,6.255895804668812e-08,9.566410138694646e-08,1.8805630714835544e-07,8.388506893795579e-08,5.012158655276741e-09,1.741660959985221e-07,9.967795743953636e-08,5.984320263683215e-09,1.1836292236688758e-07,1.8608683328415422e-07,1.9767145725134894e-07,1.4244716071719924e-07,1.0550424078554657e-08,3.133352183716392e-08,1.9651841890191454e-07,2.1769203503917354e-08,2.1561311442652998e-07,5.682710983004412e-08,1.7033145582336912e-08,9.175900280957096e-08,2.7726630411291657e-07,9.37041937614657e-08,1.561163463683168e-08,4.139674338083827e-08,1.7016474918582162e-07,4.017087885456001e-07,2.5966353922605055e-07,2.2200748765502747e-07,2.905422508096441e-07,4.677205376666289e-07,2.7979980395677255e-07,2.0734455232743255e-07,2.547056986927352e-07,4.2684858953954845e-07,2.525067236335522e-07,2.146841299338497e-07,3.201348222015965e-07,9.935375657498557e-08,3.7079294482791725e-08,1.417727493690837e-07,4.224466014901988e-07,4.118184337248015e-07,1.199763815026053e-07,3.437030785715209e-08,1.6612870555545327e-07,5.00499610023283e-08,1.7510513994120806e-07,7.708071467290303e-08,2.4591860752689584e-07,2.183590209586262e-07,8.443428879764453e-09,1.0750614868788863e-07,5.365449543168209e-08,3.391091015183966e-07,2.600987202939206e-08,8.426789916646215e-08,5.3697223747018363e-08,4.281925581719217e-07,2.7153549148395514e-07,7.840949981450758e-08,3.4388059913411743e-07,1.3287806506036648e-07,4.1804680262796763e-07,2.65042411765766e-07,1.7038369534751864e-07,1.5409649725961352e-07,2.3654340241245981e-07,4.3841635010687674e-07,3.038921613399278e-07,3.311367716056649e-07,6.494942945265907e-08,4.1042342988718135e-09,1.7083164086911385e-07,1.1081151265790918e-07,3.236777247497836e-07,3.556627342591927e-07,2.3010233348973822e-07,4.4742900400073863e-07,7.781671356173296e-08,9.903452919085354e-08,5.858009131431137e-08,4.5785906241087184e-07,3.6799306972339093e-07,2.908364643229773e-07,2.516215742501314e-07,2.757898247406528e-07,3.889857762503144e-07,1.4021408018376802e-07,3.234514322235505e-08,9.159791807306084e-08,3.4437140249864047e-07,3.404018972150595e-07,1.0643181345370795e-07,1.4620423893233885e-07,9.94610376972039e-09,2.0171152809268177e-07,2.7202797798619157e-07,2.4840260251169376e-07,1.5848001121924962e-07,3.003728281133687e-08,3.67816204583542e-07,2.461697930323438e-07,1.7008046827020425e-07,1.6780671776387291e-07,2.6771562200690794e-07,2.1441134255029917e-08,4.1122822128366907e-07,3.5231175239674966e-08,3.527180003973678e-07,4.3885738799291113e-07,3.2257460675348254e-07,3.287303711828043e-08,7.566724706076393e-08,3.267501553163697e-09,3.217244453620953e-07,1.0663942737177657e-07,3.410207881395247e-07,1.0058283863123255e-07,3.6843943385927664e-07,2.20403078342388e-07,1.6284146709829814e-07,2.2532534829668073e-07,4.374622382264216e-07,3.520558805550407e-07,4.756143984947818e-07,3.609983990332153e-07,3.7929243461151395e-08,1.298590155285493e-08,3.159275469854749e-07,2.2853367988737967e-08,1.1722254182355313e-07,1.5199120840546442e-07,1.5695823932524066e-07]);
var P2H = 1.5707963267948966, P2L = 6.123233995736766e-17, PH = 3.1415926218032837, PL = 3.178650954705639e-08;
function hi32(v: number): number { F64[0] = v; U32[0] = 0; return F64[0]; }                 // clear the low 32 bits
var POW2 = new Float64Array(2046);                                          // 2^-1022 .. 2^1023, exact
POW2[1022] = 1; for (var k = 1; k <= 1023; k++) { POW2[1022 + k] = POW2[1021 + k] * 2; if (k < 1023) POW2[1022 - k] = POW2[1023 - k] / 2; }
function pow2(e: number): number { return POW2[e + 1022]; }
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
A.atan2 = function (y, x) {
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
};

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

// ---------------------------------------------------------------- the same sin/cos in WebAssembly
// assembly/trig.ts (embedded as ./trig-wasm.ts) is the clone above, op for op: the same f64
// arithmetic and the same emulated fma, so it returns the same bits, in about half the time; and its
// doubles stay unboxed where the JavaScript's, returned from calls V8 does not inline, are heap
// allocations. Only |x| < 2e7 goes there: the Payne-Hanek reduction, NaN and the infinities stay here.
//
// A.trigMode: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM or throw
// (tests use it to prove the path ran). The engines hoist A.sin/A.cos/A.sincos once, so these three
// stay the same functions and read the mode per call. The module (2 KB) compiles synchronously on
// the first call that wants it; any refusal (no WebAssembly, a CSP without wasm-unsafe-eval) leaves
// the JavaScript in charge for good.
interface TrigKernel {
  memory: WebAssembly.Memory;
  heapBase: () => number;
  sin: (x: number) => number;
  cos: (x: number) => number;
  sincos: (x: number, out: number) => void;
}
var trigMode: 'auto' | 'js' | 'wasm' = 'auto', K: TrigKernel | null = null, tried = false, on = false;
var ksin = ucrtSin, kcos = ucrtCos, ksc: TrigKernel['sincos'] = function () {}, KO = 0, KF = F64;
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
    ksin = k.sin; kcos = k.cos; ksc = k.sincos; K = k;
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
