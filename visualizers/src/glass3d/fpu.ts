// Glass3D's plug-ins (Animator, Flashes) are MSVC 6 builds whose float code runs on the x87 at the default 53-bit
// precision: every FADD/FSUB/FMUL/FDIV/FSQRT rounds to a double (so plain JS arithmetic matches it), while
// FSIN/FCOS/FPATAN deliver a 64-bit mantissa and a `fstp float` rounds straight to 24 bits. These helpers cover the
// places a double does not: the transcendentals (Plenoptic's checked FSIN/FCOS model, Battery's FPATAN), the single
// rounding of a 64-bit value to a float, and _ftol.
import { sincos87, mulExt } from '../plenoptic/x87';
import { atan2_87 } from '../battery/x87';
export { sincos87, mulExt, atan2_87 };

/** _ftol (0x1001ad88): truncate toward zero; out of range or NaN gives 0x80000000 */
export function ftol(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}

export const f32 = Math.fround;

/** a 64-bit x87 value hi + lo (lo below half an ulp of hi) stored with `fstp float`: one rounding to 24 bits */
const FB = new Float32Array(1), IB = new Int32Array(FB.buffer);
export function f32x(hi: number, lo: number): number {
  const f = Math.fround(hi);
  if (lo === 0 || f === hi) return f;
  const d = hi - f;                                  // exact: hi and f are close doubles
  FB[0] = f; IB[0] += (d > 0) === (f > 0) ? 1 : -1;  // the float on hi's other side
  const other = FB[0];
  if (Math.abs(d) * 2 !== Math.abs(other - f)) return f;   // not a midpoint: fround(hi) is nearest either way
  return (lo > 0) === (d > 0) ? other : f;           // a tie in double, broken by lo
}

/** the x87 pair [sin, cos] of the double x, each rounded to a double (as an `fstp qword` would) */
const SC = new Float64Array(4);
export function sin87(x: number): number { sincos87(x, SC); return SC[0] + SC[1]; }
export function cos87(x: number): number { sincos87(x, SC); return SC[2] + SC[3]; }
/** FSIN/FCOS of x as [hi, lo] in out[0..1] (sin) and out[2..3] (cos) */
export function sincos87x(x: number, out: Float64Array): void { sincos87(x, out); }
