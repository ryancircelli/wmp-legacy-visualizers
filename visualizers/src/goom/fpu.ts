// The x87 arithmetic Goom's DLL runs (MSVC 6, x87 at the process's 53-bit precision): every FADD/FMUL/FDIV
// rounds to a double, so plain JS doubles are the register values; FST/FSTP float is Math.fround. FSIN/FCOS
// leave a 64-bit result (Plenoptic's model, ../plenoptic/x87.ts); the next arithmetic op rounds it.
import { sincos87, mulExt } from '../plenoptic/x87';

export const f32 = Math.fround;

/** MSVC _ftol: truncate toward zero (out of range: 0x80000000) */
export function ftol(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}

const SC = new Float64Array(4);
/** FSIN of the double a, then FMUL by the double m (one 53-bit rounding of the 64-bit sine times m) */
export function sinMul(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[0], SC[1]); }
/** FCOS of the double a, then FMUL by the double m */
export function cosMul(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[2], SC[3]); }
/** FSIN of a as the double an FST qword (or the next op at 53 bits with an exact operand) leaves */
export function sin87(a: number): number { sincos87(a, SC); return SC[0] + SC[1]; }
export function cos87(a: number): number { sincos87(a, SC); return SC[2] + SC[3]; }
/** FSIN of a stored straight to a float (FSTP float): the 64-bit value rounded once to 24 bits */
export function sin87f(a: number): number { sincos87(a, SC); return round24(SC[0], SC[1]); }
export function cos87f(a: number): number { sincos87(a, SC); return round24(SC[2], SC[3]); }

/** hi + lo (a 64-bit x87 value) rounded once to a float */
export function round24(hi: number, lo: number): number {
  const r = f32(hi);
  if (lo === 0 || r === hi) return r;
  // only when hi lies exactly halfway between two floats does lo decide (Math.fround sees hi alone and
  // picks the even one): the other float is r's neighbour on hi's side
  F[0] = r;
  I[0] += (hi > r) === (r > 0) ? 1 : -1;
  const n = F[0];
  if (n - hi !== hi - r) return r;
  return (lo > 0) === (n > r) ? n : r;
}
const F = new Float32Array(1), I = new Int32Array(F.buffer);

/** FLDLG2; FYL2X: log10(x) (x > 0), as a double. The DLL multiplies it by an integer at 53 bits and
 *  truncates (lighten, the zoom speed): only a product within an ulp of a whole number could tell the
 *  64-bit result from this one. */
export function log10_87(x: number): number { return Math.log10(x); }
