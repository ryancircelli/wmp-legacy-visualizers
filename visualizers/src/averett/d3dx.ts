// The parts of D3DX 8.1 the Averett DLLs link statically and whose results reach the device: the x87 math the
// dispatch table (0x1007b558 in MediaPlayer_9) holds with DisableD3DXPSGP=1 (the default table 0x1007b640 patched by
// 0x10046745), the box mip filter, and the call sequences of ID3DXEffect (Begin/Pass/End over state blocks) and
// ID3DXRenderToSurface. Matrices are 16 float32s, row-major as D3DMATRIX.
import { fr, fr64, fsincos } from './heap';
import { type Device, type Texture, type Surface, Fmt, Pool, Lock } from '../d3d8/api';

const SC = new Float64Array(4);

/** D3DXMatrixMultiply (x87, 0x100465d4): out = a * b, each element ((p0 + p2) + (p1 + p3)) at 53 bits */
export function matMul(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const A = Float64Array.from(a), B = Float64Array.from(b);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const p0 = A[i * 4] * B[j], p1 = A[i * 4 + 1] * B[4 + j], p2 = A[i * 4 + 2] * B[8 + j], p3 = A[i * 4 + 3] * B[12 + j];
    out[i * 4 + j] = (p0 + p2) + (p1 + p3);
  }
}
export function identity(out: Float32Array): void { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; }
/** D3DXMatrixTranslation (0x1002a36a) */
export function translation(out: Float32Array, x: number, y: number, z: number): void {
  identity(out); out[12] = x; out[13] = y; out[14] = z;
}
/** D3DXQuaternionRotationYawPitchRoll (0x1002ac37): FSINCOS of float32(angle * 0.5), sin/cos stored to float, the
 *  products and sums on the FPU */
export function quatYawPitchRoll(q: Float32Array, yaw: number, pitch: number, roll: number): void {
  fsincos(fr(roll * 0.5), SC); const sr = fr64(SC[0], SC[1]), cr = fr64(SC[2], SC[3]);
  fsincos(fr(pitch * 0.5), SC); const sp = fr64(SC[0], SC[1]), cp = fr64(SC[2], SC[3]);
  fsincos(fr(yaw * 0.5), SC); const sy = fr64(SC[0], SC[1]), cy = fr64(SC[2], SC[3]);
  const t1 = sy * cp, t2 = cy * sp, t3 = cy * cp, t4 = sy * sp;
  q[0] = cr * t2 + t1 * sr;
  q[1] = t1 * cr - t2 * sr;
  q[2] = t3 * sr - t4 * cr;
  q[3] = t4 * sr + t3 * cr;
}
/** D3DXMatrixRotationQuaternion (0x1002a6c0): 2x, 2y and the products with x and y stored to float, 2z and the
 *  products with w and z kept on the FPU */
export function matRotQuat(out: Float32Array, q: Float32Array): void {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = fr(x * 2), y2 = fr(y * 2), z2 = 2 * z;
  const wx = x2 * w, wy = y2 * w, wz = z2 * w;
  const xx = fr(x2 * x), xy = fr(y2 * x), xz = fr(z2 * x), yy = fr(y2 * y), yz = fr(z2 * y), zz = z2 * z;
  const oneXx = 1 - xx;
  out[0] = (1 - yy) - zz; out[1] = xy + wz; out[2] = xz - wy; out[3] = 0;
  out[4] = xy - wz; out[5] = oneXx - zz; out[6] = yz + wx; out[7] = 0;
  out[8] = xz + wy; out[9] = yz - wx; out[10] = fr(oneXx) - yy; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}
/** D3DXMatrixPerspectiveFovRH (0x1002a8ee); args are float32: h = cot(fovy/2) from float sin/cos, _11 = h/aspect,
 *  _33 = zf/(zn - zf), _34 = -1, _43 = _33 * zn with _33 unrounded */
export function perspectiveFovRH(out: Float32Array, fovy: number, aspect: number, zn: number, zf: number): void {
  fsincos(fr(fovy * 0.5), SC);
  const s = fr64(SC[0], SC[1]), c = fr64(SC[2], SC[3]);
  const h = c / s;
  out.fill(0);
  out[0] = h / aspect; out[5] = h;
  const q = zf / (zn - zf);
  out[10] = q; out[11] = -1; out[14] = q * zn;
}

// ---- the reciprocal square root D3DXVec3Normalize uses (0x1004650a) ----
// A 512-entry table of (slope, intercept) pairs (0x1007e420) over the float's last exponent bit and top 8 mantissa
// bits, i.e. 256 chords of 1/sqrt(m) on [0.5, 1) and 256 on [1, 2), then the exponent halved. Each chord runs
// through the float32 values of 1/sqrt at its ends: slope = (F(m1) - F(m0)) / width, intercept = F(m0) - slope * m0,
// both rounded to float (this reproduces all 1024 entries).
const RSQ = ((): Float32Array => {
  const t = new Float32Array(1024);
  for (let k = 0; k < 512; k++) {
    const w = k < 256 ? 1 / 512 : 1 / 256, m0 = k < 256 ? 0.5 + k / 512 : 1 + (k - 256) / 256;
    const f0 = fr(1 / Math.sqrt(m0)), f1 = fr(1 / Math.sqrt(m0 + w));
    const s = fr((f1 - f0) / w);
    t[2 * k] = s; t[2 * k + 1] = fr(f0 - s * m0);
  }
  return t;
})();
const NF = new Float32Array(1), NU = new Uint32Array(NF.buffer);
/** D3DXVec3Normalize (0x1004650a) of (x, y, z) float32s into out[o..o+2] */
export function vec3Normalize(out: Float32Array, o: number, x: number, y: number, z: number): void {
  const l2d = (x * x + y * y) + z * z;
  const l2 = fr(l2d);
  if (l2 === 0) { out[o] = out[o + 1] = out[o + 2] = 0; return; }
  const d = fr(l2d - 1);
  NF[0] = d;
  if ((NU[0] & 0x7fffffff) <= 0x3727c5ac) { out[o] = x; out[o + 1] = y; out[o + 2] = z; return; }
  NF[0] = l2; const bits = NU[0];
  const idx = ((bits >>> 12) & 0xff8) >> 2;
  NU[0] = (bits & 0xffffff) | 0x3f000000; const m = NF[0];
  NU[0] = (((0xbeffffff - bits) >>> 1) & 0xff800000) >>> 0; const e = NF[0];
  const r = (m * RSQ[idx] + RSQ[idx + 1]) * e;
  out[o] = x * r; out[o + 1] = y * r; out[o + 2] = z * r;
}

/** D3DX's box mip filter (D3DXFilterTexture, D3DX_FILTER_BOX) on 32-bit pixels: (a + b + c + d + 2) >> 2 per byte */
export function boxMip(src: Uint8Array, sw: number, sh: number): Uint8Array {
  const dw = Math.max(1, sw >> 1), dh = Math.max(1, sh >> 1), o = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) for (let c = 0; c < 4; c++) {
    const y0 = Math.min(2 * y, sh - 1), y1 = Math.min(2 * y + 1, sh - 1), x0 = Math.min(2 * x, sw - 1), x1 = Math.min(2 * x + 1, sw - 1);
    o[(y * dw + x) * 4 + c] = (src[(y0 * sw + x0) * 4 + c] + src[(y0 * sw + x1) * 4 + c] + src[(y1 * sw + x0) * 4 + c] + src[(y1 * sw + x1) * 4 + c] + 2) >> 2;
  }
  return o;
}

function writeLevel(s: Surface, px: Uint8Array, w: number, h: number, flags: number): void {
  const l = s.lockRect(null, flags);
  for (let y = 0; y < h; y++) l.data.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * l.pitch);
  s.unlockRect();
}
/** D3DXCreateTextureFromFileInMemory / FromResource of a 32-bit image as the DLLs use it: CreateTexture (full chain,
 *  managed), level 0 written through its surface, then D3DXFilterTexture's box filter level by level (the source
 *  level locked read-only, the next written), with the surface calls in D3DX's order. */
export function textureFromPixels(dev: Device, px: Uint8Array, w: number, h: number, fmt: Fmt, levels = 0): Texture {
  const t = dev.createTexture(w, h, levels, 0, fmt, Pool.MANAGED);
  let src = t.getSurfaceLevel(0);
  writeLevel(src, px, w, h, Lock.NOSYSLOCK);
  let cur = px, cw = w, ch = h;
  for (let i = 1; i < t.levels; i++) {
    if (i === 1) src = t.getSurfaceLevel(0);
    const dst = t.getSurfaceLevel(i);
    src.lockRect(null, Lock.NOSYSLOCK | Lock.READONLY);
    const next = boxMip(cur, cw, ch);
    cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
    writeLevel(dst, next, cw, ch, Lock.NOSYSLOCK);
    src.unlockRect();
    src = dst; cur = next;
  }
  return t;
}
