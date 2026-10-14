// The x87 arithmetic Celestial.dll (Delphi) does, reproduced exactly. The DLL runs at the precision control its
// host thread has (0x27F, 53 bits: every FADD/FMUL/FDIV/FSQRT rounds to a double, as JS does); what doubles cannot
// do is its three 64-bit constants (Delphi's extended literals 1.004, 3.1415926535 and 6.283185307, FLD TBYTE) and
// FSIN/FCOS, whose results are 64-bit. Those go through BigInt fixed point (2^-160) here: the constants rounded to
// 64 bits from their decimal literals, sin/cos reduced by Intel's 66-bit pi as the FPU does, correctly rounded to
// 64 bits.

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

/** a double as fixed point (exact for |v| >= 2^-100) */
export function toFix(v: number): bigint {
  if (v === 0) return 0n;
  F64[0] = v;
  const b = U64[0], e = Number((b >> 52n) & 0x7ffn), m = (b & 0xfffffffffffffn) | (1n << 52n);
  const sh = BigInt(e - 1075) + FB, a = sh >= 0n ? m << sh : m >> -sh;
  return (b >> 63n) ? -a : a;
}
/** round to `bits` significant bits, nearest-even.
 *  ponytail: the fixed point's own truncation (2^-160) could fake an exact tie; none occurs for these values. */
export function roundBits(v: bigint, bits: number): bigint {
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
/** fixed point -> double (exact when it has <= 53 significant bits) */
export function toNum(v: bigint): number {
  const n = Number(v < 0n ? -v : v) / Math.pow(2, Number(FB));
  return v < 0n ? -n : n;
}
/** a decimal literal as Delphi's extended constant (64 significant bits) */
export function extLiteral(s: string): bigint {
  const [ip, fp = ''] = s.split('.');
  return roundBits((BigInt(ip + fp) * ONE) / 10n ** BigInt(fp.length), 64);
}
export const mul53 = (a: bigint, b: bigint): bigint => roundBits((a * b) / ONE, 53);
export const div53 = (a: bigint, b: bigint): bigint => roundBits((a * ONE) / b, 53);
export const sub53 = (a: bigint, b: bigint): bigint => roundBits(a - b, 53);

/** [sin, cos] of x (fixed point) as FSIN/FCOS compute them: reduced by pi/2 at 66 bits, rounded to 64 bits */
export function sincos64(x: bigint): [bigint, bigint] {
  const half = PI66 / 2n;
  let q = (x + half / 2n) / half;
  if (x + half / 2n < 0n && (x + half / 2n) % half !== 0n) q--;
  const r = x - q * half;
  let s = r, c = ONE, t = r, tc = ONE, k = 1n;
  for (;;) {
    t = (((-t * r) / ONE) * r) / ONE / ((2n * k) * (2n * k + 1n));
    tc = (((-tc * r) / ONE) * r) / ONE / ((2n * k - 1n) * (2n * k));
    if (t === 0n && tc === 0n) break;
    s += t; c += tc; k++;
  }
  let o: [bigint, bigint];
  switch (Number(((q % 4n) + 4n) % 4n)) {
    case 0: o = [s, c]; break;
    case 1: o = [c, -s]; break;
    case 2: o = [-s, -c]; break;
    default: o = [-c, s];
  }
  return [roundBits(o[0], 64), roundBits(o[1], 64)];
}

/** FISTP at round-to-nearest-even */
export function rint(v: number): number {
  let r = Math.round(v);
  if (r - v === 0.5 && (r & 1)) r -= 1;
  return r;
}

/** rint(fl53(trig64(a) * r)): FLD a; FCOS (which 1) / FSIN (which 0); FMUL r; FISTP. The doubles decide unless the
 *  product lies within 1e-9 of a half, where the 64-bit FSIN/FCOS result is taken exactly. */
export function rintTrigMul(a: number, r: number, which: 0 | 1): number {
  const v = (which ? Math.cos(a) : Math.sin(a)) * r;
  if (Math.abs(Math.abs(v - Math.trunc(v)) - 0.5) >= 1e-9) return rint(v);
  return rint(toNum(mul53(sincos64(toFix(a))[which], toFix(r))));
}

/** [FSTP DWORD of FSIN a, of FCOS a]: the 64-bit results rounded once to float */
export function trigF32(a: number): [number, number] {
  const [s, c] = sincos64(toFix(a));
  return [toNum(roundBits(s, 24)), toNum(roundBits(c, 24))];
}
