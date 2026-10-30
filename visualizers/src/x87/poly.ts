// FSIN / FCOS for |r| < 1/4 (no table), as this FPU evaluates them (fitted from its measured output).
// z = T67(r r), w = T67(z T64(z)). The polynomial in z is split into an even part E = c0 + c2 w + c4 w^2 and an
// odd part O = c1 + c3 w + c5 w^2, each Horner with 67-bit truncated products of 64-bit multiplier inputs. O is
// truncated to 64 bits; E floored onto the 2^-64 grid (cos) or truncated to 64 bits (sin: its 2^-66 grid), and
// y = T67(z E64) + T67(w O64). cos: 1 + T67(y). sin: y64 = RN64(y), r + T67(r y64). Minimax coefficients, the
// higher ones fitted to the FPU's rounding decisions (0 mismatches on 10^6 random arguments each).
// T67/T64 = truncate toward zero to 67/64 significant bits.
import { FB, hexf, mul, rnd, rndAt } from './fix';

const t67 = (v: bigint) => rnd(v, 67, 'T'), t64 = (v: bigint) => rnd(v, 64, 'T');
const C0 = hexf('-0x1.fffffffffffffffd8p-2'), C2 = hexf('-0x1.6c16c16c16862869447621dd290cp-10');
const C4 = hexf('-0x1.27e4ebd87e1019ec2c4ce51e6b63p-22'), C1 = hexf('0x1.555555555555509ecp-5');
const C3 = hexf('0x1.a01a019d6d567beb0f7eea16c1fbp-16'), C5 = hexf('0x1.1e93c920fe208e70492528b9656bp-29');
const S0 = hexf('-0x1.55555555555555564p-3'), S2 = hexf('-0x1.a01a01a019dcf1deb04a0cada84p-13');
const S4 = hexf('-0x1.ae64448bbe6d01724637a97042b5p-26'), S1 = hexf('0x1.1111111111110f8e40552bc821c1p-7');
const S3 = hexf('0x1.71de3a53d4253a6aaa46cd1a957ap-19'), S5 = hexf('0x1.60c0fc11f6d375e68090107daf68p-33');

function zw(r: bigint): [bigint, bigint] { const z = t67(mul(r, r)); return [z, t67(mul(z, t64(z)))]; }

/** cos r (|r| < 1/4) before the final rounding */
export function polyCos(r: bigint): bigint {
  const [z, w] = zw(r);
  const E = C0 + t67(mul(w, t64(C2 + t67(mul(w, C4)))));
  const O = t64(C1 + t67(mul(w, t64(C3 + t67(mul(w, C5))))));
  return (1n << FB) + t67(t67(mul(z, rndAt(E, FB - 64n, 'F'))) + t67(mul(w, O)));
}

/** sin r (|r| < 1/4) before the final rounding */
export function polySin(r: bigint): bigint {
  const [z, w] = zw(r);
  const E = t64(S0 + t67(mul(w, t64(S2 + t67(mul(w, S4))))));
  const O = t64(S1 + t67(mul(w, t64(S3 + t67(mul(w, S5))))));
  const y = rnd(t67(mul(z, E)) + t67(mul(w, O)), 64, 'N');
  return r + t67(mul(r, y));
}
