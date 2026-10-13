// The D3DX 8 matrix and vector routines Yule Log calls, as yule.dll's statically linked D3DX runs them with
// DisableD3DXPSGP=1 (its portable x87 code, 53-bit precision): every product and sum is a double operation,
// every store to a D3DXMATRIX/D3DXVECTOR3 member a float rounding (Math.fround). FSIN/FCOS/FSINCOS results are
// the FPU's 64-bit values (../plenoptic/x87.ts), rounded once to float when stored.
// Matrices are 16 float32s, row-major as D3DXMATRIX (_11 _12 _13 _14 _21 ...).
import { sincos87 } from '../plenoptic/x87';

const f = Math.fround;
export type Mat = Float32Array;
export type Vec3 = Float32Array;

export function mat(): Mat { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
export function identity(out: Mat): Mat { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; }

const TA = new Float32Array(16), TB = new Float32Array(16);
/** D3DXMatrixMultiply (0x100342a6, installed over the default by 0x10034417): out = a * b, each element
 *  ((a0*b0 + a2*b2) + (a1*b1 + a3*b3)) in that order, rounded to float. out may alias a or b. */
export function multiply(out: Mat, a: Mat, b: Mat): Mat {
  TA.set(a); TB.set(b);
  for (let r = 0; r < 4; r++) {
    const a0 = TA[r * 4], a1 = TA[r * 4 + 1], a2 = TA[r * 4 + 2], a3 = TA[r * 4 + 3];
    for (let c = 0; c < 4; c++)
      out[r * 4 + c] = f((a0 * TB[c] + a2 * TB[8 + c]) + (a1 * TB[4 + c] + a3 * TB[12 + c]));
  }
  return out;
}

/** D3DXMatrixTranspose (0x1001345f) */
export function transpose(out: Mat, m: Mat): Mat {
  const t = m.slice();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = t[c * 4 + r];
  return out;
}

/** D3DXMatrixInverse (0x10013722): cofactors from 2x2 minors, in the DLL's exact order of operations (some
 *  minors stay in x87 registers as doubles, the others are stored as floats). Returns null when 1/det (as a
 *  float) is not finite (_finite 0x1005447b), leaving out untouched. */
export function inverse(out: Mat, det: Float32Array | null, m: Mat): Mat | null {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3], m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11], m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
  const A = f(m11 * m00 - m10 * m01), B = f(m21 * m00 - m20 * m01), C = f(m31 * m00 - m30 * m01);
  const D = f(m21 * m10 - m20 * m11), E = f(m31 * m10 - m30 * m11), F = f(m31 * m20 - m30 * m21);
  const r0 = f((m02 * D - m12 * B) + m22 * A);
  const r1 = f((m12 * C - m32 * A) - m02 * E);
  const r2 = f((m02 * F - m22 * C) + m32 * B);
  const r3 = f((m22 * E - m32 * D) - m12 * F);
  const r4 = f((B * m13 - A * m23) - D * m03);
  const r5 = f((E * m03 - C * m13) + A * m33);
  const r6 = f((C * m23 - B * m33) - F * m03);
  const r7 = f((F * m13 - E * m23) + D * m33);
  const A2 = f(m02 * m13 - m12 * m03), B2 = f(m02 * m23 - m22 * m03);
  const C2 = m02 * m33 - m32 * m03, D2 = m12 * m23 - m22 * m13;          // kept in registers: doubles
  const E2 = m12 * m33 - m32 * m13, F2 = m22 * m33 - m32 * m23;
  const r8 = f((B2 * m11 - A2 * m21) - D2 * m01);
  const r9 = f((E2 * m01 - C2 * m11) + A2 * m31);
  const r10 = f((C2 * m21 - B2 * m31) - F2 * m01);
  const r11 = f((F2 * m11 - E2 * m21) + D2 * m31);
  const r12 = f((D2 * m00 - B2 * m10) + A2 * m20);
  const r13 = f((C2 * m10 - A2 * m30) - E2 * m00);
  const r14 = f((m00 * F2 - C2 * m20) + B2 * m30);
  const r15 = f((E2 * m20 - D2 * m30) - F2 * m10);
  const d = ((r8 * m30 + r9 * m20) + r10 * m10) + r11 * m00;
  if (det) det[0] = d;
  const inv = f(1 / d);
  if (!isFinite(inv)) return null;
  const r = [r11, r10, r9, r8, r15, r14, r13, r12, r7, r6, r5, r4, r3, r2, r1, r0];
  for (let i = 0; i < 16; i++) out[i] = r[i] * inv;
  return out;
}

const SC = new Float64Array(4);
const NF = new Float32Array(1), NU = new Uint32Array(NF.buffer);
/** float(x) for an x87 64-bit value hi + lo (FSTP float of a register): one rounding, not two. hi + lo only
 *  rounds differently from hi when hi lies exactly halfway between two floats (lo is far below a double ulp). */
export function f32of64(hi: number, lo: number): number {
  const r = f(hi);
  if (lo === 0 || r === hi) return r;
  NF[0] = r; NU[0] += (hi > r) === (r > 0) ? 1 : -1;    // the other float around hi
  const nb = NF[0];
  if (hi - r !== nb - hi) return r;                     // not a tie: lo cannot move it
  return (lo > 0) === (nb > r) ? nb : r;
}

/** FSINCOS of a float, each result stored as a float: [sin, cos] */
export function sinCosF(a: number, out: Float64Array): void {
  sincos87(a, SC);
  out[0] = f32of64(SC[0], SC[1]); out[1] = f32of64(SC[2], SC[3]);
}

const SCF = new Float64Array(2);
/** D3DXMatrixRotationY (0x10013c87) */
export function rotationY(out: Mat, angle: number): Mat {
  sinCosF(f(angle), SCF);
  const s = SCF[0], c = SCF[1];
  out.fill(0);
  out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1;
  return out;
}

/** D3DXMatrixPerspectiveFovRH (the DLL's copy at 0x10014251): yScale = cos/sin of fovy/2 as floats */
export function perspectiveFovRH(out: Mat, fovy: number, aspect: number, zn: number, zf: number): Mat {
  const h = f(f(fovy) * 0.5);
  sinCosF(h, SCF);
  const cot = SCF[1] / SCF[0];                          // FLD cos_f / sin_f: a double
  out.fill(0);
  out[0] = f(cot / f(aspect));
  out[5] = f(cot);
  const q = f(zf) / (f(zn) - f(zf));
  out[10] = f(q); out[11] = -1;
  out[14] = f(q * f(zn));
  return out;
}

// D3DXVec3Normalize (0x100341dc, installed by 0x10034417): a reciprocal square root from a 512-entry
// (slope, intercept) table indexed by the low exponent bit and the top 8 mantissa bits of the squared length
// (segments of [0.5, 1) by 1/512 and of [1, 2) by 1/256), the exponent fixed up with integer arithmetic. The
// table is a chord per segment through the float values of 1/sqrt at its ends: slope = (g(x1) - g(x0)) / (x1 - x0)
// and intercept = g(x0) - slope * x0, both rounded to float, g(x) = float(1 / sqrt(x)) (all 512 pairs equal
// the DLL's 0x10071ac0 bit for bit).
const RSQ = new Float32Array(1024);
for (let i = 0; i < 512; i++) {
  const m = i & 0xff, x0 = i >> 8 ? 1 + m / 256 : 0.5 + m / 512, x1 = i >> 8 ? 1 + (m + 1) / 256 : 0.5 + (m + 1) / 512;
  const g0 = f(1 / Math.sqrt(x0)), g1 = f(1 / Math.sqrt(x1));
  const s = f((g1 - g0) / (x1 - x0));
  RSQ[i * 2] = s; RSQ[i * 2 + 1] = f(g0 - s * x0);
}
const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
export function vec3Normalize(out: Vec3, v: Vec3): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const l2 = (y * y + x * x) + z * z;                   // FXCH ST2; FADDP; FADDP
  FB[0] = l2; const bits = UB[0];
  if (bits === 0) { out[0] = out[1] = out[2] = 0; return out; }
  FB[0] = l2 - 1;
  if ((UB[0] & 0x7fffffff) <= 0x3727c5ac) { out[0] = x; out[1] = y; out[2] = z; return out; }   // |len2 - 1| tiny
  const idx = (bits >>> 15) & 0x1ff;
  UB[0] = (bits & 0xffffff) | 0x3f000000; const m = FB[0];
  UB[0] = ((0xbeffffff - bits) >>> 1) & 0xff800000; const sc = FB[0];
  const r = (m * RSQ[idx * 2] + RSQ[idx * 2 + 1]) * sc;
  out[0] = f(x * r); out[1] = f(y * r); out[2] = f(z * r);
  return out;
}

/** D3DXMatrixLookAtRH (0x10014109): z = normalize(eye - at), x = normalize(up x z), y = z x x (unnormalised,
 *  kept as doubles for the translation row) */
export function lookAtRH(out: Mat, eye: Vec3, at: Vec3, up: Vec3): Mat {
  const z = new Float32Array([f(eye[0] - at[0]), f(eye[1] - at[1]), f(eye[2] - at[2])]);
  vec3Normalize(z, z);
  const x = new Float32Array([f(z[2] * up[1] - z[1] * up[2]), f(z[0] * up[2] - z[2] * up[0]), f(z[1] * up[0] - z[0] * up[1])]);
  vec3Normalize(x, x);
  const yx = z[1] * x[2] - z[2] * x[1], yy = z[2] * x[0] - z[0] * x[2], yz = z[0] * x[1] - z[1] * x[0];
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[12] = f(-((x[0] * eye[0] + x[1] * eye[1]) + x[2] * eye[2]));
  out[1] = f(yx); out[5] = f(yy); out[9] = f(yz);
  out[13] = f(-((yx * eye[0] + yy * eye[1]) + yz * eye[2]));
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[14] = f(-((z[0] * eye[0] + z[1] * eye[1]) + z[2] * eye[2]));
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}
