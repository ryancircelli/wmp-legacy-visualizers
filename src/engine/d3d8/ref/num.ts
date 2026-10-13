// Number helpers for the REF pipeline: REF runs its draws with the x87 at 64-bit precision (it sets the control
// word's PC bits itself, 0x40b6e7); float stores round to float32 (f32), msvcrt _ftol truncates.
export const f32 = Math.fround;
/** msvcrt _ftol (0x42dd9a): truncate toward zero; out of range or NaN -> 0x80000000 */
export function ftol(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}
