// The D3DX 8 matrix and vector routines plusvis.dll calls (its D3DX is an earlier build than Yule Log's: plain x87
// code called directly, no CPU-specific dispatch), at the x87's 53-bit precision: every product and sum a double
// operation, every store to a D3DXMATRIX/D3DXVECTOR3 member a float rounding. Multiply, Transpose and
// PerspectiveFovRH are the same code as Yule Log's (../yule/math.ts); Inverse, LookAtRH and Vec3Normalize differ.
import { multiply, perspectiveFovRH, sinCosF, transpose, mat, identity, type Mat, type Vec3 } from '../yule/math';

const f = Math.fround;
export { multiply, perspectiveFovRH, transpose, mat, identity, type Mat, type Vec3 };

const SC = new Float64Array(2);

/** D3DXMatrixRotationX (0x100195af): FSINCOS of the float angle, both stored as floats */
export function rotationX(out: Mat, angle: number): Mat {
  sinCosF(f(angle), SC);
  const s = SC[0], c = SC[1];
  out.fill(0);
  out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[15] = 1;
  return out;
}

/** D3DXMatrixRotationY (0x10019629): the same pattern about y */
export function rotationY(out: Mat, angle: number): Mat {
  sinCosF(f(angle), SC);
  const s = SC[0], c = SC[1];
  out.fill(0);
  out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1;
  return out;
}

/** D3DXMatrixTranslation (0x10019553) */
export function translation(out: Mat, x: number, y: number, z: number): Mat {
  identity(out); out[12] = x; out[13] = y; out[14] = z; return out;
}

/** D3DXMatrixScaling (0x100194f7) */
export function scaling(out: Mat, x: number, y: number, z: number): Mat {
  out.fill(0); out[0] = x; out[5] = y; out[10] = z; out[15] = 1; return out;
}

/** D3DXMatrixInverse (0x1001916a): 2x2 minors of the first two columns stored as floats, the 3x3 cofactors of the
 *  last two partly kept in registers, in the DLL's exact order. Returns null (out untouched) when 1/det, as a float,
 *  is not finite. */
export function inverse(out: Mat, det: Float32Array | null, m: Mat): Mat | null {
  const q1 = f(m[5] * m[0] - m[4] * m[1]);
  const q2 = f(m[9] * m[0] - m[8] * m[1]);
  const q3 = f(m[13] * m[0] - m[12] * m[1]);
  const q4 = f(m[9] * m[4] - m[8] * m[5]);
  const q5 = f(m[13] * m[4] - m[12] * m[5]);
  const q6 = f(m[13] * m[8] - m[12] * m[9]);
  const q11 = f((m[2] * q4 - m[6] * q2) + m[10] * q1);
  const q12 = f((m[6] * q3 - m[14] * q1) - m[2] * q5);
  const q13 = f((m[2] * q6 - m[10] * q3) + m[14] * q2);
  const q14 = f((m[10] * q5 - m[14] * q4) - m[6] * q6);
  const q15 = f((q2 * m[7] - q1 * m[11]) - q4 * m[3]);
  const q16 = f((q5 * m[3] - q3 * m[7]) + q1 * m[15]);
  const q17 = f((q3 * m[11] - q2 * m[15]) - q6 * m[3]);
  const q18 = f((q6 * m[7] - q5 * m[11]) + q4 * m[15]);
  const q19 = f(m[2] * m[7] - m[6] * m[3]);
  const q20 = f(m[2] * m[11] - m[10] * m[3]);
  const a = m[6] * m[11] - m[10] * m[7];          // registers: doubles
  const b = m[6] * m[15] - m[14] * m[7];
  const c = m[2] * m[15] - m[14] * m[3];
  const d = m[10] * m[15] - m[14] * m[11];
  const q21 = f((q20 * m[5] - q19 * m[9]) - a * m[1]);
  const q22 = f((b * m[1] - c * m[5]) + q19 * m[13]);
  const q23 = f((c * m[9] - q20 * m[13]) - d * m[1]);
  const q24 = f((d * m[5] - b * m[9]) + a * m[13]);
  const q25 = f((a * m[0] - q20 * m[4]) + q19 * m[8]);
  const q26 = f((c * m[4] - q19 * m[12]) - b * m[0]);
  const q27 = f((m[0] * d - c * m[8]) + q20 * m[12]);
  const q28 = f((b * m[8] - a * m[12]) - d * m[4]);
  const dd = ((q21 * m[12] + q22 * m[8]) + q23 * m[4]) + q24 * m[0];
  if (det) det[0] = dd;
  const inv = f(1 / dd);
  if (!isFinite(inv)) return null;
  const r = [q24, q23, q22, q21, q28, q27, q26, q25, q18, q17, q16, q15, q14, q13, q12, q11];
  for (let i = 0; i < 16; i++) out[i] = r[i] * inv;
  return out;
}

/** D3DXVec3Normalize (0x10019a6c): length^2 = (x x + y y) + z z; within 1e-5 of 1 the vector is copied, below 1e-10
 *  it is zero, else times 1 / sqrt (a double) */
export function vec3Normalize(out: Vec3, v: ArrayLike<number>): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const l2 = (x * x + y * y) + z * z, e = l2 - 1;
  if (!(-9.999999747378752e-6 > e) && !(e > 9.999999747378752e-6)) { out[0] = x; out[1] = y; out[2] = z; return out; }
  if (!(l2 > 9.999999439624929e-11)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const r = 1 / Math.sqrt(l2);
  out[0] = x * r; out[1] = y * r; out[2] = z * r;
  return out;
}

/** D3DXVec4Normalize (0x10019be3): Vec3Normalize's tests on (x x + y y) + z z) + w w, but the length is stored as a
 *  float before 1 / length (0x10018fed) */
export function vec4Normalize(out: Float32Array, v: ArrayLike<number>): Float32Array {
  const x = v[0], y = v[1], z = v[2], w = v[3];
  const l2 = ((x * x + y * y) + z * z) + w * w, e = l2 - 1;
  if (!(-9.999999747378752e-6 > e) && !(e > 9.999999747378752e-6)) { out[0] = x; out[1] = y; out[2] = z; out[3] = w; return out; }
  if (!(l2 > 9.999999439624929e-11)) { out.fill(0, 0, 4); return out; }
  const r = 1 / f(Math.sqrt(l2));
  out[0] = r * x; out[1] = r * y; out[2] = r * z; out[3] = r * w;
  return out;
}

/** D3DXVec3Cross (0x1001981a) */
export function cross(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

const Z = new Float32Array(3), X = new Float32Array(3), Y = new Float32Array(3);
/** D3DXMatrixLookAtRH (0x10019daa): z = normalize(eye - at), x = normalize(up x z), y = z x x (floats) */
export function lookAtRH(out: Mat, eye: ArrayLike<number>, at: ArrayLike<number>, up: ArrayLike<number>): Mat {
  Z[0] = eye[0] - at[0]; Z[1] = eye[1] - at[1]; Z[2] = eye[2] - at[2];
  vec3Normalize(Z, Z);
  cross(X, up, Z); vec3Normalize(X, X);
  cross(Y, Z, X);
  out[0] = X[0]; out[4] = X[1]; out[8] = X[2];
  out[1] = Y[0]; out[5] = Y[1]; out[9] = Y[2];
  out[2] = Z[0]; out[6] = Z[1]; out[10] = Z[2];
  out[12] = -((X[0] * eye[0] + X[1] * eye[1]) + X[2] * eye[2]);
  out[13] = -((Y[0] * eye[0] + Y[1] * eye[1]) + Y[2] * eye[2]);
  out[14] = -((Z[0] * eye[0] + Z[1] * eye[1]) + Z[2] * eye[2]);
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

