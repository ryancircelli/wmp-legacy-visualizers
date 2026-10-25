// The D3DX 9 math the Psychedelia Viz Pack's DLLs call (d3dx9_29.dll / d3dx9_31.dll, Microsoft's DirectX
// redistributable), on the x87 path its dispatch table keeps when DisableD3DXPSGP is set (as the ground truth pins it):
// d3dx9_29's table setup 0x44573f copies the defaults, then 0x449cd2 puts its fast x87 routines over eight of them
// (multiply 0x449b53, normalize 0x449a82, ...) before the registry is read.
//
// Precision: the DLLs create their Direct3D 9 device without D3DCREATE_FPU_PRESERVE, so d3d9 leaves the thread's x87
// at 24-bit precision (control word 0x007F) from then on: every FMUL/FADD/FDIV/FSQRT result is rounded to a float's
// 24-bit mantissa. With float operands that is exactly Math.fround of the double result (a double holds every product
// and quotient of two floats to more than 2 * 24 + 2 bits), so this file and the scenes round after each operation.
// Matrices are 16 float32s, row-major as D3DMATRIX.
export const f = Math.fround;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return U1[0]; };
const float = (u: number): number => { U1[0] = u >>> 0; return F1[0]; };

/** D3DXMatrixMultiply, out = a * b (d3dx9_29 0x449b53): out[i][j] = (p0 + p2) + (p1 + p3), pk = a[i][k] * b[k][j] */
const T = new Float32Array(16);
export function matMul(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const p0 = f(a[i * 4] * b[j]), p1 = f(a[i * 4 + 1] * b[4 + j]), p2 = f(a[i * 4 + 2] * b[8 + j]), p3 = f(a[i * 4 + 3] * b[12 + j]);
      T[i * 4 + j] = f(f(p0 + p2) + f(p1 + p3));
    }
  }
  out.set(T);
  return out;
}

export function identity(out: Float32Array): Float32Array { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; }

/** D3DXMatrixOrthoRH (d3dx9_29 0x442118, plain x87) */
export function orthoRH(out: Float32Array, w: number, h: number, zn: number, zf: number): Float32Array {
  out.fill(0);
  out[0] = f(2 / w);
  out[5] = f(2 / h);
  out[10] = f(1 / f(zn - zf));
  out[14] = f(out[10] * zn);
  out[15] = 1;
  return out;
}

/** The reciprocal square root D3DX's fast x87 routines use: the squared length's mantissa m in [0.5, 2) (the
 *  exponent's low bit kept) times a slope plus an offset from a 512-entry table indexed by that bit and the top
 *  eight mantissa bits (no Newton step), times the halved exponent. The table is the secant of 1/sqrt over each of the
 *  512 segments ([0.5, 1) in 256 steps of 1/512, [1, 2) in 256 of 1/256) through its ends' values rounded to float;
 *  d3dx9_28, _29 and _31 hold the same one. */
const RSQ = new Float32Array(1024);
for (let i = 0; i < 512; i++) {
  const w = i < 256 ? 1 / 512 : 1 / 256, a = i < 256 ? 0.5 + i * w : 1 + (i - 256) * w;
  const fa = f(1 / Math.sqrt(a)), fb = f(1 / Math.sqrt(a + w)), sl = f((fb - fa) / w);
  RSQ[2 * i] = sl; RSQ[2 * i + 1] = fa - sl * a;
}
export function rsqrtTable(l2: number): number {
  const u = bits(l2), i = (u >>> 15) & 0x1ff;
  const m = float((u & 0xffffff) | 0x3f000000);
  const s = float(((0xbeffffff - u) >>> 1) & 0xff800000);
  return f(f(f(m * RSQ[2 * i]) + RSQ[2 * i + 1]) * s);
}

/** D3DXVec3Normalize (d3dx9_29 0x449a82): zero stays zero; unchanged when |squared length - 1| <= 1e-5 (0x3727c5ac);
 *  else times the table's reciprocal square root */
export function vec3Normalize(v: Float32Array): Float32Array {
  const l2 = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (bits(l2) === 0) { v.fill(0); return v; }
  if ((bits(f(l2 - 1)) & 0x7fffffff) <= 0x3727c5ac) return v;
  const r = rsqrtTable(l2);
  v[0] = f(v[0] * r); v[1] = f(v[1] * r); v[2] = f(v[2] * r);
  return v;
}

/** D3DXMatrixLookAtRH (d3dx9_29 0x441af6) */
export function lookAtRH(out: Float32Array, eye: ArrayLike<number>, at: ArrayLike<number>, up: ArrayLike<number>): Float32Array {
  const z = vec3Normalize(Float32Array.of(f(eye[0] - at[0]), f(eye[1] - at[1]), f(eye[2] - at[2])));
  const x = vec3Normalize(Float32Array.of(f(f(z[2] * up[1]) - f(z[1] * up[2])), f(f(z[0] * up[2]) - f(z[2] * up[0])),
    f(f(z[1] * up[0]) - f(z[0] * up[1]))));
  const y = Float32Array.of(f(f(z[1] * x[2]) - f(z[2] * x[1])), f(f(z[2] * x[0]) - f(z[0] * x[2])), f(f(z[0] * x[1]) - f(z[1] * x[0])));
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -f(f(f(x[0] * eye[0]) + f(x[1] * eye[1])) + f(x[2] * eye[2]));
  out[13] = -f(f(f(y[0] * eye[0]) + f(y[1] * eye[1])) + f(y[2] * eye[2]));
  out[14] = -f(f(f(z[0] * eye[0]) + f(z[1] * eye[1])) + f(z[2] * eye[2]));
  out[15] = 1;
  return out;
}
