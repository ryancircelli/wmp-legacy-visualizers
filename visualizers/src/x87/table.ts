// FSIN / FCOS for 1/4 <= r <= ~pi/4 (r >= 0; both are symmetric), as this FPU evaluates them (fitted from its output).
// xj = nearest odd/32 (r < 1/2) or odd/16, d = r - xj exactly; S, C = sin xj, cos xj rounded to 67 bits.
// z = T67(d d); sd = RN64(d + T67(d T67(ts z))), cm = RN64(tc z), ts / tc = Horner(k4..k1; z) with T67 products and
// RN64 sums on the FPU's own (minimax) coefficients. sin: S + T67(T67(C sd) + T67(S cm)); cos: C + T67(T67(-S sd) +
// T67(C cm)); each rounded once to 64 bits by the caller. s2..s4 and c2..c4 are fitted to the CPU's rounding
// decisions, not exact: about 1 result in 10^6 is one ulp off.
import { FB, ONE, hexf, mul, rnd } from './fix';

/** exact sin and cos of fixed-point r (|r| < 1), to the fixed point's last bit */
export function sinCosExact(r: bigint): [bigint, bigint] {
  const r2 = mul(r, r);
  let s = r, c = ONE, ts = r, tc = ONE;
  for (let n = 1n; ; n++) {
    ts = -mul(ts, r2) / ((2n * n) * (2n * n + 1n));
    tc = -mul(tc, r2) / ((2n * n - 1n) * (2n * n));
    if (ts === 0n && tc === 0n) break;
    s += ts; c += tc;
  }
  return [s, c];
}

const t67 = (v: bigint) => rnd(v, 67, 'T'), n64 = (v: bigint) => rnd(v, 64, 'N');
const SK = ['-0x1.5555555555555512p-3', '0x1.1111111110e95302p-7', '-0x1.a01a0182ef260ffap-13', '0x1.71d5cb2d5b305678p-19'].map(hexf);
const CK = ['-0x1.fffffffffffffe8ap-2', '0x1.5555555554e73ebep-5', '-0x1.6c16c143cc6f1632p-10', '0x1.a00e6235e69ee0bcp-16'].map(hexf);
const TS: bigint[] = [], TC: bigint[] = [];               // by 32 xj (odd/32 and odd/16 points)
for (let i = 9; i <= 27; i++) { const [s, c] = sinCosExact(BigInt(i) << (FB - 5n)); TS[i] = rnd(s, 67, 'N'); TC[i] = rnd(c, 67, 'N'); }

function horner(k: bigint[], z: bigint): bigint {
  let t = n64(t67(mul(k[3], z)) + k[2]);
  t = n64(t67(mul(t, z)) + k[1]);
  return n64(t67(mul(t, z)) + k[0]);
}

/** sin r (cos r if wantCos) for 1/4 <= r <= ~pi/4, before the final rounding */
export function tableEval(r: bigint, wantCos: boolean): bigint {
  const half = r < (1n << (FB - 1n));
  const i = half ? Number(r >> (FB - 4n)) * 2 + 1 : (Number(r >> (FB - 3n)) * 2 + 1) * 2;   // 32 xj
  const d = r - (BigInt(i) << (FB - 5n)), S = TS[i], C = TC[i];
  let sd = 0n, cm = 0n;
  if (d !== 0n) {
    const z = t67(mul(d, d));
    sd = n64(d + t67(mul(d, t67(mul(horner(SK, z), z)))));
    cm = n64(mul(horner(CK, z), z));
  }
  const [T0, A, B] = wantCos ? [C, -S, C] : [S, C, S];
  return T0 + t67(t67(mul(A, sd)) + t67(mul(B, cm)));
}
