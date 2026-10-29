// Fixed-point helpers for the x87 transcendental models: values are BigInt multiples of 2^-FB, which holds every
// intermediate the FPU forms for arguments the ports use (|x| <= ~2^4, results down to ~2^-200) exactly.

export const FB = 320n;
export const ONE = 1n << FB;
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);

/** a finite double as fixed point (exact for |v| >= 2^-(FB - 53)) */
export function fromNum(v: number): bigint {
  if (v === 0) return 0n;
  F64[0] = v;
  const b = U64[0], e = Number((b >> 52n) & 0x7ffn);
  const m = e ? (b & 0xfffffffffffffn) | (1n << 52n) : b & 0xfffffffffffffn;
  const sh = BigInt((e || 1) - 1075) + FB, a = sh >= 0n ? m << sh : m >> -sh;
  return b >> 63n ? -a : a;
}

/** floor(log2(|v|)) in fixed-point units (v != 0): the position of the leading bit */
export function lead(v: bigint): number {
  const a = v < 0n ? -v : v;
  let b = Math.floor(Math.log2(Number(a)));
  if (b > 0 && (1n << BigInt(b)) > a) b--;
  else if ((1n << BigInt(b + 1)) <= a) b++;
  return b;
}

/** v rounded to p significant bits: 'N' nearest-even, 'T' toward zero, 'F' floor, 'C' ceiling */
export function rnd(v: bigint, p: number, mode: 'N' | 'T' | 'F' | 'C'): bigint {
  if (v === 0n) return 0n;
  const sh = lead(v) + 1 - p;
  return sh > 0 ? rndAt(v, BigInt(sh), mode) : v;
}

/** v rounded to a multiple of 2^sh fixed-point units */
export function rndAt(v: bigint, sh: bigint, mode: 'N' | 'T' | 'F' | 'C'): bigint {
  if (sh <= 0n) return v;
  const g = 1n << sh, f = v >> sh, r = v - (f << sh);            // v = f*g + r, 0 <= r < g (floor)
  if (r === 0n) return v;
  let q = f;
  if (mode === 'C' || (mode === 'T' && v < 0n)) q = f + 1n;
  else if (mode === 'N') { const h = g >> 1n; if (r > h || (r === h && (f & 1n))) q = f + 1n; }
  return q << sh;
}

/** v (a value with at most 64 significant bits) as [hi, lo]: hi the nearest double, hi + lo == v exactly */
export function toPair(v: bigint, o: Float64Array, at = 0): void {
  if (v === 0n) { o[at] = 0; o[at + 1] = 0; return; }
  const hi = toNum(v);
  o[at] = hi; o[at + 1] = toNum(v - fromNum(hi));
}

/** fixed point -> nearest double (ties even), for |v| well inside the double range */
export function toNum(v: bigint): number {
  if (v === 0n) return 0;
  const neg = v < 0n, a = neg ? -v : v, sh = lead(a) - 52;
  let m: bigint, e: number;
  if (sh > 0) { m = rndAt(a, BigInt(sh), 'N') >> BigInt(sh); e = sh; } else { m = a; e = 0; }
  const n = Number(m) * Math.pow(2, e - Number(FB));
  return neg ? -n : n;
}

/** a * b in fixed point (truncated below 2^-FB: callers keep their operands' bits well above that) */
export const mul = (a: bigint, b: bigint): bigint => (a * b) >> FB;

/** a C hex-float literal ("-0x1.8p-3") as fixed point (exact when its bits lie above 2^-FB) */
export function hexf(s: string): bigint {
  const m = /^(-?)0x([0-9a-f]+)\.?([0-9a-f]*)p([+-]?\d+)$/i.exec(s);
  if (!m) throw new Error('bad hex float ' + s);
  const e = BigInt(m[4]) - BigInt(4 * m[3].length) + FB, v = BigInt('0x' + m[2] + m[3]);
  const a = e >= 0n ? v << e : v >> -e;
  return m[1] ? -a : a;
}
