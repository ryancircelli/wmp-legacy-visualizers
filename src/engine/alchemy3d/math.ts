// 3D Alchemy's matrix and vector math: the D3DX 8 routines statically linked into mpvis3d.dll (9.00.00.2980,
// x86, image base 0x00400000), as the copy running on an SSE2 CPU executes them. D3DX dispatches through a
// table (0x0044c820, filled once by 0x00428dcd from CPUID): with SSE2, MatrixMultiply, Vec3Normalize and
// Vec3TransformCoord are its SSE2 versions (single precision throughout, the reciprocals from RCPPS/RSQRTSS
// plus one Newton step); Translation, Scaling, RotationX/Y/Z and RotationAxis stay the x87 versions (FSINCOS),
// as do LookAtLH and PerspectiveFovLH (called directly). The DLL's own scene code is VC7 x87 at 53-bit
// precision: double arithmetic with a float store where it writes memory.
//
// RCPSS / RSQRTSS are approximations whose bits the CPU defines. Measured on the reference Intel CPU over every
// float in [1, 4), they are exactly the reciprocal (square root) of the MIDPOINT of the input's 2^-11 (2^-10)
// mantissa bucket, rounded to nearest at 13 significant bits; rcp()/rsqrt() below compute that, verified
// against all 2^24 inputs of that range.
export const fr = Math.fround;

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
function bitsOf(v: number): number { F32[0] = v; return U32[0]; }
function fromBits(u: number): number { U32[0] = u; return F32[0]; }
function round13(v: number): number {                     // v in (0.25, 1]: nearest at 13 significant bits
  const s = v >= 0.5 ? 8192 : 16384;
  return Math.round(v * s) / s;
}
/** RCPSS of a finite normal float (the scene never feeds it anything else). */
export function rcp(x: number): number {
  const u = bitsOf(x), sign = u & 0x80000000, e = (u >>> 23) & 0xff;
  const mid = fromBits(0x3f800000 | (u & 0x7ff000) | 0x800);   // [1,2): bucket of 2^12 ulps, its midpoint
  const r = round13(1 / mid);                                  // in (0.5, 1]
  const v = r * Math.pow(2, 127 - e);
  return sign ? -v : v;
}
/** RSQRTSS of a positive finite normal float. */
export function rsqrt(x: number): number {
  const u = bitsOf(x), e = ((u >>> 23) & 0xff) - 127, odd = e & 1;
  const mid = fromBits((0x3f800000 + (odd << 23)) | (u & 0x7fe000) | 0x1000);   // [1,4): bucket of 2^13 ulps
  return round13(1 / Math.sqrt(mid)) * Math.pow(2, -(e - odd) / 2);
}

export type Mat = Float32Array;                             // 16 floats, row major (D3DMATRIX)
export const mat = (): Mat => new Float32Array(16);
export type Vec3 = Float32Array;
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => Float32Array.of(x, y, z);

/** D3DXMatrixMultiply, SSE2 (0x0043a8b0): out row i = ((a[i][0]*B0 + a[i][1]*B1) + a[i][2]*B2) + a[i][3]*B3,
 *  every product and sum rounded to float. All inputs are read before out is written (aliasing is fine). */
export function matMul(out: Mat, a: Mat, b: Mat): Mat {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const a0 = a[4 * i], a1 = a[4 * i + 1], a2 = a[4 * i + 2], a3 = a[4 * i + 3];
    for (let j = 0; j < 4; j++) {
      let s = fr(a0 * b[j]);
      s = fr(s + fr(a1 * b[4 + j]));
      s = fr(s + fr(a2 * b[8 + j]));
      r[4 * i + j] = fr(s + fr(a3 * b[12 + j]));
    }
  }
  out.set(r);
  return out;
}

/** D3DXVec3Normalize, SSE2 (0x0043aa00): s = (x*x + y*y) + z*z in float; below 1.4210855e-14 the zero vector;
 *  else r = RSQRTSS(s), k = (0.5*r) * (3 - (s*r)*r), out = v * k. */
export function vec3Normalize(out: Vec3, v: ArrayLike<number>): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const s = fr(fr(fr(x * x) + fr(y * y)) + fr(z * z));
  if (s < 1.4210854715202004e-14) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const r = rsqrt(s);
  const k = fr(fr(0.5 * r) * fr(3 - fr(fr(s * r) * r)));
  out[0] = fr(k * x); out[1] = fr(k * y); out[2] = fr(k * z);
  return out;
}

/** D3DXVec3Normalize, x87 (0x0041cb38): what the dispatch thunk runs on the very first call through the table,
 *  before it has switched the table to SSE2 (0x00428dcd). s = F((x*x + y*y) + z*z); within 2^-23 of 1 the vector
 *  is returned as it is; else v * (1/sqrt(s)) at 53 bits, stored as floats. */
export function vec3NormalizeX87(out: Vec3, v: ArrayLike<number>): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const s = fr((x * x + y * y) + z * z), d = s - 1;
  if (d >= -1.1920928955078125e-7 && d <= 1.1920928955078125e-7) { out[0] = x; out[1] = y; out[2] = z; return out; }
  if (!(s > 1.1754943508222875e-38)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const k = 1 / Math.sqrt(s);
  out[0] = fr(k * x); out[1] = fr(k * y); out[2] = fr(k * z);
  return out;
}

/** D3DXVec3TransformCoord, SSE2 (0x0043a6f0): p = (x*M0 + y*M1) + (z*M2 + M3) as floats, then out = p.xyz *
 *  (2r - (r*w)*r) with r = RCPPS(w). */
export function vec3TransformCoord(out: Vec3, v: ArrayLike<number>, m: Mat): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const p = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) p[j] = fr(fr(fr(x * m[j]) + fr(y * m[4 + j])) + fr(fr(z * m[8 + j]) + m[12 + j]));
  const r = rcp(p[3]);
  const k = fr(fr(r + r) - fr(fr(r * p[3]) * r));
  out[0] = fr(p[0] * k); out[1] = fr(p[1] * k); out[2] = fr(p[2] * k);
  return out;
}

// ---- FSIN / FCOS / FSINCOS rounded to float -------------------------------------------------------------------
// The x87 gives a 64-bit result (precision control does not apply to it) that the DLL stores as a float. A
// double from Math.sin/cos rounds to the same float except when it lies next to the midpoint between two
// floats; there the value is recomputed here in BigInt fixed point (2^-160), reduced by Intel's 66-bit pi,
// rounded to 64 bits and then to 24 (the model x86.ts uses for Alchemy's Pythagorean points).
const FB = 160n, ONE = 1n << FB;
function atanInv(n: bigint): bigint {
  let x = ONE / n, s = x, k = 1n, sg = -1n;
  const n2 = n * n;
  while (x !== 0n) { x /= n2; s += sg * (x / (2n * k + 1n)); sg = -sg; k++; }
  return s;
}
const PIX = 4n * (4n * atanInv(5n) - atanInv(239n));
const PI66 = (PIX >> (FB - 64n)) << (FB - 64n);
const F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
function toFix(v: number): bigint {
  if (v === 0) return 0n;
  F64[0] = v;
  const b = U64[0], e = Number((b >> 52n) & 0x7ffn), m = (b & 0xfffffffffffffn) | (1n << 52n);
  const sh = BigInt(e - 1075) + FB, a = sh >= 0n ? m << sh : m >> -sh;
  return (b >> 63n) ? -a : a;
}
function roundBits(v: bigint, bits: number): bigint {
  if (v === 0n) return 0n;
  const neg = v < 0n;
  let a = neg ? -v : v;
  const sh = a.toString(2).length - bits;
  if (sh > 0) {
    const s = BigInt(sh), q = a >> s, r = a - (q << s), h = 1n << (s - 1n);
    a = (r > h || (r === h && (q & 1n)) ? q + 1n : q) << s;
  }
  return neg ? -a : a;
}
function fixToNum(v: bigint): number { const n = Number(v < 0n ? -v : v) / Math.pow(2, Number(FB)); return v < 0n ? -n : n; }
function sincosFix(x: bigint): [bigint, bigint] {
  const half = PI66 / 2n;
  let q = (x + half / 2n) / half;
  if (x + half / 2n < 0n && (x + half / 2n) % half !== 0n) q--;
  const r = x - q * half;
  let s = r, c = ONE, t = r, tc = ONE, k = 1n;
  for (;;) {
    t = -t * r / ONE * r / ONE / ((2n * k) * (2n * k + 1n));
    tc = -tc * r / ONE * r / ONE / ((2n * k - 1n) * (2n * k));
    if (t === 0n && tc === 0n) break;
    s += t; c += tc; k++;
  }
  switch (Number(((q % 4n) + 4n) % 4n)) { case 0: return [s, c]; case 1: return [c, -s]; case 2: return [-s, -c]; default: return [-c, s]; }
}
function nearMidpoint(v: number): boolean {
  const f = fr(v);
  if (f === v || v === 0) return false;
  const g = v > f ? fr(f + Math.abs(f) * 1.2e-7 + 1e-45) : fr(f - Math.abs(f) * 1.2e-7 - 1e-45);
  const mid = (f + g) / 2, ulp = Math.abs(v) * 2.3e-16;
  return Math.abs(v - mid) <= 4 * ulp;
}
/** FSINCOS of an angle (a float or a 53-bit value), each result stored as a float */
export function sincosF(a: number): [number, number] {
  let s = Math.sin(a), c = Math.cos(a);
  const ns = nearMidpoint(s), nc = nearMidpoint(c);
  if (ns || nc) {
    // the store rounds the 64-bit register straight to 24 bits
    const [S, C] = sincosFix(toFix(a));
    if (ns) s = fixToNum(roundBits(roundBits(S, 64), 24));
    if (nc) c = fixToNum(roundBits(roundBits(C, 64), 24));
  }
  return [fr(s), fr(c)];
}

/** D3DXMatrixTranslation (x87 0x0041b999). */
export function matTranslation(out: Mat, x: number, y: number, z: number): Mat {
  out.fill(0); out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}
/** D3DXMatrixScaling (x87 0x0041b937). */
export function matScaling(out: Mat, x: number, y: number, z: number): Mat {
  out.fill(0); out[0] = x; out[5] = y; out[10] = z; out[15] = 1;
  return out;
}
// D3DX's SSE2 sine/cosine (0x00442cf0, d3dxtrigsse2): quadrant q = rint(|a| * 2/pi) by the 2^23 trick, the
// remainder by a four-part pi/2 (Cody-Waite), polynomials in r^2, every step a float. It works on four lanes
// that start from the same angle but subtract the four parts of pi/2 in rotated orders, and the cosine takes
// its polynomial from lane 1 and its r^2 from lane 0: kept here as the SSE code has it.
const SC_PI2 = [fbits(0x3fc90000), fbits(0x39fda000), fbits(0x33a22000), fbits(0x2c34611a)];
const SC_C4 = [fbits(0xb94ca1f0), fbits(0x37ccf5ce)], SC_C3 = [fbits(0x3c08839d), fbits(0xbab6061a)];
const SC_C2 = [fbits(0xbe2aaaa3), fbits(0x3d2aaaa5)], SC_C1 = [1, -0.5];
const TWO_OVER_PI = fbits(0x3f22f983), TWO23 = 8388608;
function fbits(u: number): number { U32[0] = u; return F32[0]; }
/** [cos, sin] of a float angle as D3DX's SSE2 code computes them */
export function sincosSSE(a: number): [number, number] {
  const A = Math.abs(a);
  const qb = fr(fr(A * TWO_OVER_PI) + TWO23), q = fr(qb - TWO23);
  const P = SC_PI2.map((c) => fr(q * c));
  const rl = [0, 1].map((i) => { let r = A; for (let k = 0; k < 4; k++) r = fr(r - P[(i + k) & 3]); return r; });
  const r2 = [fr(rl[0] * rl[0]), fr(rl[1] * rl[1])];
  // lane 0 (sine polynomial, its own r^2) and lane 1 (cosine polynomial on lane 1's r^2)
  const poly = (j: number, x2: number) => fr(fr(fr(fr(fr(fr(SC_C4[j] * x2) + SC_C3[j]) * x2) + SC_C2[j]) * x2) + SC_C1[j]);
  const sinP = fr(poly(0, r2[0]) * rl[0]);
  const cosP = fr(fr(poly(1, r2[1]) * r2[0]) + 1);
  const qi = (bitsOf(qb) & 0x7fffff) | 0, odd = qi & 1;
  let c = odd ? sinP : cosP, s = odd ? cosP : sinP;
  if (((qi + odd) & 2) !== 0) c = -c;
  if ((((qi - odd) & 2) !== 0) !== (a < 0 || Object.is(a, -0))) s = -s;
  return [c, s];
}

/** D3DXMatrixRotationX, SSE2 (0x0043af20). */
export function matRotationX(out: Mat, a: number): Mat {
  const [c, s] = sincosSSE(fr(a));
  out.fill(0); out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[15] = 1;
  return out;
}
/** D3DXMatrixRotationY, SSE2 (0x0043afa0). */
export function matRotationY(out: Mat, a: number): Mat {
  const [c, s] = sincosSSE(fr(a));
  out.fill(0); out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1;
  return out;
}
/** D3DXMatrixRotationZ (x87 0x0041bafc). */
export function matRotationZ(out: Mat, a: number): Mat {
  const [s, c] = sincosF(fr(a));
  out.fill(0); out[0] = c; out[1] = s; out[4] = -s; out[5] = c; out[10] = 1; out[15] = 1;
  return out;
}

/** D3DXMatrixRotationAxis (x87 0x0041bb7e): sin, cos and 1 - cos stored as floats, the axis normalized (SSE2),
 *  then 53-bit arithmetic with float stores, transcribed from 0x41bbbf..0x41bc57. */
export function matRotationAxis(out: Mat, axis: ArrayLike<number>, angle: number): Mat {
  const [s, c] = sincosF(fr(angle));
  const omc = fr(1 - c);
  const v = vec3Normalize(vec3(), axis);
  const x = v[0], y = v[1], z = v[2];
  const t0 = fr((y * x) * omc);                            // fstp [ebp+0x10]
  const A = (z * y) * omc, B = (z * x) * omc;              // x87 stack
  const C = z * s, D = y * s, E = x * s;
  out[0] = fr((x * x) * omc + c);
  out[1] = fr(t0 + C);
  out[2] = fr(B - D);
  out[3] = 0;
  out[4] = fr(t0 - C);
  out[5] = fr((y * y) * omc + c);
  out[6] = fr(E + A);
  out[7] = 0;
  out[8] = fr(fr(D) + B);                                  // D reloaded from its float store (fst [ebp+0xc])
  out[9] = fr(A - E);
  out[10] = fr((z * z) * omc + c);
  out[11] = 0; out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/** D3DXMatrixLookAtLH (x87 0x0041d657). */
export function matLookAtLH(out: Mat, eye: ArrayLike<number>, at: ArrayLike<number>, up: ArrayLike<number>): Mat {
  const zs = vec3(fr(at[0] - eye[0]), fr(at[1] - eye[1]), fr(at[2] - eye[2]));
  const z = vec3Normalize(vec3(), zs);
  const xs = vec3(fr(z[2] * up[1] - z[1] * up[2]), fr(z[0] * up[2] - z[2] * up[0]), fr(z[1] * up[0] - z[0] * up[1]));
  const x = vec3Normalize(vec3(), xs);
  // y = cross(z, x) kept at 53 bits on the stack, stored into the matrix as floats
  const y0 = z[1] * x[2] - z[2] * x[1];
  const y1 = z[2] * x[0] - z[0] * x[2];
  const y2 = z[0] * x[1] - z[1] * x[0];
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[12] = fr(-((x[1] * eye[1] + x[0] * eye[0]) + x[2] * eye[2]));
  out[1] = fr(y0); out[5] = fr(y1); out[9] = fr(y2);
  out[13] = fr(-((y1 * eye[1] + y0 * eye[0]) + y2 * eye[2]));
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[14] = fr(-((z[1] * eye[1] + z[0] * eye[0]) + z[2] * eye[2]));
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/** D3DXMatrixPerspectiveFovLH (x87 0x0041be4b): the half angle and FSINCOS results stored as floats, cot =
 *  cos/sin at 53 bits; Q = zf/(zf-zn) stored, but -Q*zn uses the unrounded Q. */
export function matPerspectiveFovLH(out: Mat, fovy: number, aspect: number, zn: number, zf: number): Mat {
  const half = fr(fovy * 0.5);
  const [s, c] = sincosF(half);
  const cot = c / s;
  out.fill(0);
  out[0] = fr(cot / aspect);
  out[5] = fr(cot);
  const q = zf / (zf - zn);
  out[10] = fr(q);
  out[11] = 1;
  out[14] = fr(-(q * zn));
  return out;
}
