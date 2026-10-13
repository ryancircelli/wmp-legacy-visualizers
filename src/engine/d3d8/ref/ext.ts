// x87 extended precision (64-bit mantissa, round to nearest even) in JS doubles. REF sets the precision control to
// 64 bits for every draw and clear (0x40b6e7, 0x40c49f), so a value it keeps on the FPU stack across operations is
// a 64-bit-mantissa number: here a double-double (hi, lo) rounded to 64 significant bits. Each operation returns
// hi and leaves lo in `lo` (no allocation): `const h = add(a, 0, b, 0), l = lo;`. Operands are double-doubles;
// a plain double is (x, 0). Exact for |values| in the normal double range; the double-double arithmetic before the
// final 64-bit rounding errs by < 2^-104 relative, which changes the rounding only within that of a tie.
export let lo = 0;

const SPLIT = 134217729;   // 2^27 + 1
let eh = 0, el = 0;        // scratch result before rounding

function twoProd(a: number, b: number): void {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  eh = p; el = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
function renorm(): void { const s = eh + el; el = el - (s - eh); eh = s; }

const BITS = new Float64Array(1), W = new Uint32Array(BITS.buffer);
/** round eh + el (normalized) to 64 significant bits; result in (return, lo) */
function round64(): number {
  const h = eh, l = el;
  if (l === 0 || h === 0 || !isFinite(h)) { lo = 0; return h + l; }
  BITS[0] = h;
  let e = ((W[1] >>> 20) & 0x7ff) - 1023;           // exponent of h (h normal: values here never are subnormal)
  if (W[0] === 0 && (W[1] & 0xfffff) === 0 && (l < 0) !== (h < 0)) e--;   // h a power of two, value just below it
  const q = Math.pow(2, e - 63);                      // the 64th bit's weight
  const x = l / q;                                    // exact (power-of-two scaling)
  const f = Math.floor(x), d = x - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);   // h / q is even, so parity is r's
  const nl = r * q;
  const s = h + nl;
  lo = nl - (s - h);
  return s;
}

/** a + b, rounded to 64 bits */
export function add(ah: number, al: number, bh: number, bl: number): number {
  let s = ah + bh, bb = s - ah, e = (ah - (s - bb)) + (bh - bb);
  const t = al + bl; bb = t - al; const f = (al - (t - bb)) + (bl - bb);
  e += t;
  let u = s + e; e = e - (u - s); s = u;
  e += f;
  u = s + e; e = e - (u - s);
  eh = u; el = e;
  return round64();
}
/** a - b, rounded to 64 bits */
export function sub(ah: number, al: number, bh: number, bl: number): number { return add(ah, al, -bh, -bl); }
/** a * b, rounded to 64 bits */
export function mul(ah: number, al: number, bh: number, bl: number): number {
  twoProd(ah, bh);
  el += ah * bl + al * bh;
  renorm();
  return round64();
}
/** a / b, rounded to 64 bits */
export function div(ah: number, al: number, bh: number, bl: number): number {
  const q1 = ah / bh;
  twoProd(q1, bh); let rh = ah - eh, rl = al - el - q1 * bl;
  let s = rh + rl; rl = rl - (s - rh); rh = s;
  const q2 = rh / bh;
  twoProd(q2, bh); rh = rh - eh; rl = rl - el - q2 * bl;
  const q3 = (rh + rl) / bh;
  s = q1 + q2; let e = q2 - (s - q1);
  e += q3;
  eh = s + e; el = e - (eh - s);
  return round64();
}
/** sqrt(a), rounded to 64 bits */
export function sqrt(ah: number, al: number): number {
  if (ah <= 0) { lo = 0; return Math.sqrt(ah); }
  const r = Math.sqrt(ah);
  twoProd(r, r);
  const d = ((ah - eh) - el + al) / (2 * r);
  eh = r + d; el = d - (eh - r);
  return round64();
}
/** round an exact double-double (e.g. a product of two doubles: twoProd) to 64 bits */
export function ext(h: number, l: number): number { eh = h + l; el = l - (eh - h); return round64(); }

/** a 64-bit value (h, l) stored to float32 (FSTP dword): correctly rounded */
export function toF32(h: number, l: number): number {
  const r = Math.fround(h);
  if (l === 0 || r === h) return r;
  // h lies strictly between two floats; only an exact midpoint can be decided by l
  const other = r < h ? nextUp32(r) : nextDown32(r);
  const mid = (r + other) / 2;                         // exact in double
  if (h !== mid) return r;
  return (l > 0) === (other > r) ? other : r;
}
const F1 = new Float32Array(1), U1 = new Int32Array(F1.buffer);
function nextUp32(x: number): number { F1[0] = x; if (x === 0) return 1.401298464324817e-45; U1[0] += x > 0 ? 1 : -1; return F1[0]; }
function nextDown32(x: number): number { return -nextUp32(-x); }

// ---- an accumulator in the style of the x87 code: ld, then fadd/fsub/fmul/fdiv, then st32 / st64 ----
/** the accumulator (ST0): H + L */
export let H = 0, L = 0;
export function ld(x: number): void { H = x; L = 0; }
export function ldE(h: number, l: number): void { H = h; L = l; }
/** load a product of two doubles, rounded to 64 bits */
export function ldMul(a: number, b: number): void { H = mul(a, 0, b, 0); L = lo; }
export function fadd(x: number): void { H = add(H, L, x, 0); L = lo; }
export function fsub(x: number): void { H = add(H, L, -x, 0); L = lo; }
/** x - ST0 */
export function fsubr(x: number): void { H = add(x, 0, -H, -L); L = lo; }
export function fmul(x: number): void { H = mul(H, L, x, 0); L = lo; }
export function fdiv(x: number): void { H = div(H, L, x, 0); L = lo; }
/** x / ST0 */
export function fdivr(x: number): void { H = div(x, 0, H, L); L = lo; }
export function faddE(h: number, l: number): void { H = add(H, L, h, l); L = lo; }
export function fsubE(h: number, l: number): void { H = add(H, L, -h, -l); L = lo; }
export function fmulE(h: number, l: number): void { H = mul(H, L, h, l); L = lo; }
export function fsqrt(): void { H = sqrt(H, L); L = lo; }
/** FSTP dword */
export function st32(): number { return toF32(H, L); }
/** FSTP qword (H is already the value rounded to double) */
export function st64(): number { return H; }

// ---- fast paths: the same results computed in doubles where an error bound shows the f32 rounding cannot differ
// from the 64-bit evaluation's (falling back to the 64-bit arithmetic when it can) ----
/** 2^-50: bounds the relative error of a few double or 64-bit operations together */
export const EPS = 8.881784197001252e-16;
/** f32(((a + b) + c) + d) at 64 bits, for doubles a..d (e.g. exact float products) */
export function sum32(a: number, b: number, c: number, d: number): number {
  const r = ((a + b) + c) + d, e = (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d)) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  ld(a); fadd(b); fadd(c); fadd(d); return st32();
}
/** f32((a + b) + c) at 64 bits */
export function sum32x3(a: number, b: number, c: number): number {
  const r = (a + b) + c, e = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  ld(a); fadd(b); fadd(c); return st32();
}
