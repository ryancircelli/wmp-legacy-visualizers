// TwistedPixel creates its Direct3D 8 device without FPU_PRESERVE, so Direct3D leaves the x87 control word at 0x007F:
// 24-bit precision. From then on every FADD/FSUB/FMUL/FDIV/FSQRT in the DLL (the engine, its math functions for
// scripts, the static CRT) rounds its exact result to a 24-bit significand, while loads keep their precision (a
// double constant or a 64-bit FSIN/FPATAN result enters at full width) and the transcendentals deliver 64 bits.
// These helpers give each operation's exact result rounded once to 24 bits. Both operands may be doubles: the
// exact result is formed as a double-double first, so no double rounding creeps in.
import { A } from '../ns';
import { f32x, ftol } from '../glass3d/fpu';
export { f32x, ftol };

const f = Math.fround;

/** a + b at 24-bit precision */
export function add24(a: number, b: number): number {
  const s = a + b, bb = s - a, e = (a - (s - bb)) + (b - bb);
  return e === 0 ? f(s) : f32x(s, e);
}
/** a - b at 24-bit precision */
export function sub24(a: number, b: number): number { return add24(a, -b); }
/** a * b at 24-bit precision */
export function mul24(a: number, b: number): number {
  const p = a * b, e = A.fma(a, b, -p);
  return e === 0 ? f(p) : f32x(p, e);
}
/** a / b at 24-bit precision (b != 0) */
export function div24(a: number, b: number): number {
  const q = a / b;
  if (!isFinite(q)) return f(q);
  const r = A.fma(-q, b, a);
  return r === 0 ? f(q) : f32x(q, r / b);
}
/** sqrt(a) at 24-bit precision */
export function sqrt24(a: number): number {
  const s = Math.sqrt(a);
  if (!(s > 0) || !isFinite(s)) return f(s);
  const r = A.fma(-s, s, a);
  return r === 0 ? f(s) : f32x(s, r / (2 * s));
}
/** (hi + lo) * b at 24-bit precision: a 64-bit x87 value (FSIN, FPATAN...) times b */
export function mulx24(hi: number, lo: number, b: number): number {
  const p = hi * b, e = A.fma(hi, b, -p) + lo * b;
  return e === 0 ? f(p) : f32x(p, e);
}
/** (hi + lo) + b at 24-bit precision */
export function addx24(hi: number, lo: number, b: number): number {
  const s = hi + b, bb = s - hi, e = (hi - (s - bb)) + (b - bb) + lo;
  return e === 0 ? f(s) : f32x(s, e);
}
