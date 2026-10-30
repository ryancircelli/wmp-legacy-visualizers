// x87 FSIN / FCOS as this FPU computes them (measured on an i7-11370H), 64-bit results.
// Reduction (exact, checked on millions of doubles): P = pi/2 to 66 bits (0x3243F6A8885A308D3 / 2^65),
// k = round(x / P), r = x - k*P with no rounding (up to 65 significant bits), then the k = 0 evaluators S and C:
// sin x = [S, C, -S, -C](r)[k & 3], cos x = [C, -S, -C, S](r)[k & 3].
import { FB, fromNum, rnd, toPair } from './fix';
import { polyCos, polySin } from './poly';
import { tableEval } from './table';

const P = 0x3243F6A8885A308D3n << (FB - 65n);

const QUARTER = 1n << (FB - 2n);
/** the k = 0 evaluators (sin odd, cos even): the FPU's value before its final rounding */
function evalS(r: bigint): bigint {
  const a = r < 0n ? -r : r, v = a < QUARTER ? polySin(a) : tableEval(a, false);
  return r < 0n ? -v : v;
}
function evalC(r: bigint): bigint { const a = r < 0n ? -r : r; return a < QUARTER ? polyCos(a) : tableEval(a, true); }

function trig(x: number, wantCos: boolean, xl = 0): bigint {
  const X = xl === 0 ? fromNum(x) : fromNum(x) + fromNum(xl);   // a 64-bit argument as x + xl (double-double)
  let k = (2n * X + P) / (2n * P);                      // round(X / P): no double is a tie (ponytail: a 64-bit
                                                        // argument exactly on a multiple of P/2 would round up here)
  if (2n * X + P < 0n && (2n * X + P) % (2n * P) !== 0n) k--;
  const r = X - k * P, q = Number(((k % 4n) + 4n) % 4n) + (wantCos ? 1 : 0);
  const v = (q & 1) ? evalC(r) : evalS(r);
  return rnd((q & 2) ? -v : v, 64, 'N');
}

/** FSIN of x: o[at] + o[at + 1] is the 64-bit result exactly. x is a double, or a 64-bit register value x + xl (a
 *  double-double, |xl| <= ulp(x)/2: what a program at 64-bit precision control feeds FSIN) */
export function fsin87(x: number, o: Float64Array, at = 0, xl = 0): void { toPair(trig(x, false, xl), o, at); }
/** FCOS of x (x + xl as for fsin87) */
export function fcos87(x: number, o: Float64Array, at = 0, xl = 0): void { toPair(trig(x, true, xl), o, at); }
/** [sinHi, sinLo, cosHi, cosLo] (the shape Plenoptic's sincos87 returns) */
export function sincos87(x: number, o: Float64Array): void { fsin87(x, o, 0); fcos87(x, o, 2); }
