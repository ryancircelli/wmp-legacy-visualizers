// Gigertron 3D's scene: a 50 x 50 field of bars (2,500 boxes of 24 vertices), its height table and its cameras.
//
// The height table holds 50 rows of 50: each frame one row takes the spectrum (every 20th byte of freq[0] from 10),
// and the field draws the rows as rings of bars, the newest first. Presets differ in what they redraw (just the
// current ring, or all fifty), where the camera sits, how the table ages (decay, fall) and how the rings turn.
//
// Precision: the plug-in sets the field up before it creates its Direct3D device, at the host's 53-bit x87 precision,
// and steps it afterwards at the 24 bits Direct3D leaves the thread in; with these operands both come out as
// Math.fround after each operation (see ../d3dx9.ts).
import { A } from '../../ns';
import '../../rand';
import { f, xmul } from '../d3dx9';

export const BARS = 2500, VERTS = BARS * 24, RING = 1200, STRIDE = 36, VB_BYTES = VERTS * STRIDE;

const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return U1[0]; };
/** FISTP with chop, the low 32 bits (NaN and overflow give 0) */
const trunc = (x: number): number => Math.trunc(x) | 0;

/** a box's 24 corners: which x side (0 = left), which y side, which z side (1 = +) */
const CORNERS = [
  0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0,
  1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1,
  1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1,
];
/** the faces' normals (four corners each) */
const NORMALS = [-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1];
const UV = [1, 1, 1, 0, 0, 0, 0, 1];

/** per preset: eye, look-at point, field of view, the roll step per frame */
const CAMERAS: number[][] = [
  [150, -145, 90, 150, 100, 30, 1.5, 0],
  [0, -250, 175, 10, 0, 0, 2, 0.1],
  [-20, -100, 150, 10, 30, -75, 2, -0.11560001],
  [-20, -100, -200, 10, 30, 175, 2, -0.11560001],
  [-20, -300, 200, 10, 30, -100, 1.5, -0.11560001],
  [0, -300, 200, 0, 30, -100, 1.5, -0.11560001],
  [-20, -400, 100, 10, 30, 75, 1.5, -0.11560001],
  [-20, -150, 150, 10, 30, -175, 2, 0.02],
  [-20, -250, 250, 10, 30, -100, 1.5, 0.02],
  [0, -250, 175, 10, 0, 0, 2, 0.1],
];

export class Scene {
  /** the vertex buffer's bytes: position, normal, diffuse colour, texture coordinates */
  vb = new Uint8Array(VB_BYTES);
  fv = new Float32Array(this.vb.buffer);
  uv = new Uint32Array(this.vb.buffer);
  /** the heights, 50 rows of 50, and one word past them that the reversed presets read on their last ring */
  table = new Float32Array(BARS + 1);
  tbits = new Uint32Array(this.table.buffer);
  row = 0;
  /** the bars' width; nudged by the frame time while at most 5 */
  width = 5;
  roll = 0;
  pitch = 0;
  yaw = 0;
  /** the ring spin's scale (Guybrush 0.1, Dragons 1) */
  speed = 0;
  /** draw the fifty rings separately, each turned (else the first ring alone) */
  rings = false;
  eye = new Float32Array(3);
  at = new Float32Array(3);
  up = Float32Array.of(0, 0, 1);
  fov = 2;
  aspect = 1;
  lastMs = 0;

  /** the plug-in's Create: srand(seed), random heights 0..10, every bar built, random colours over them all */
  init(preset: number, seed: number): void {
    A.srand(seed);
    for (let i = 0; i < BARS; i++) this.table[i] = f(f(A.rand() * 2 ** -15) * 10);
    this.tbits[BARS] = 0xffffffff;                        // a field the plug-in sets to -1 just past the table
    const fv = this.fv;
    for (let v = 0; v < VERTS; v++) {
      const k = v % 24, n = (k >> 2) * 3, o = v * 9;
      fv[o + 3] = NORMALS[n]; fv[o + 4] = NORMALS[n + 1]; fv[o + 5] = NORMALS[n + 2];
      if (k < 16) { fv[o + 7] = UV[(k & 3) * 2]; fv[o + 8] = UV[(k & 3) * 2 + 1]; } else { fv[o + 7] = 0; fv[o + 8] = f(0.001); }
    }
    this.build(preset, true);
    for (let v = 0; v < VERTS; v++) {
      const b = trunc(f(A.rand() * 2 ** -15) * 255), g = trunc(f(A.rand() * 2 ** -15) * 255), r = trunc(f(A.rand() * 2 ** -15) * 255);
      this.uv[v * 9 + 6] = (0xff000000 | (r & 255) << 16 | (g & 255) << 8 | (b & 255)) >>> 0;
    }
  }

  /** one bar's 24 corners: x from a to b, y from ym to yp, z = +-h (by bits, so a NaN height keeps its payload) */
  private box(v: number, a: number, b: number, ym: number, yp: number, hb: number, color: number): void {
    const fv = this.fv, uv = this.uv;
    for (let k = 0; k < 24; k++, v++) {
      const o = v * 9;
      fv[o] = CORNERS[k * 3] ? b : a;
      fv[o + 1] = CORNERS[k * 3 + 1] ? yp : ym;
      uv[o + 2] = CORNERS[k * 3 + 2] ? hb : (hb ^ 0x80000000) >>> 0;
      uv[o + 6] = color;
    }
  }

  /** the bars (0x0f3013c0): all fifty rings from the current row on (`all`), else the current row's ring alone (the
   *  plain spectrum: its own colours, and the bars as wide as tall) */
  build(preset: number, all: boolean): void {
    const half = f(this.width * 0.5), t = this.table;
    if (!all) {
      const row = this.row, w = this.width;
      for (let j = 0; j < 50; j++) {
        const h = t[row * 50 + j], c0 = trunc(h) >>> 0, c = c0 > 254 ? 255 : c0, inv = 255 - c;
        const x = inv === 255 ? 1e6 : j * 6;
        this.box((row * 50 + j) * 24, f(x - half), f(half + x), -w, w, this.tbits[row * 50 + j],
          ((inv >>> 2) << 24 | (c >>> 1) << 16 | (inv >>> 3) << 8 | inv >>> 2) >>> 0);
      }
      return;
    }
    const w2 = preset === 1 || preset === 9 ? f(this.width * 2) : this.width;
    const reversed = preset === 8 || preset === 5 || preset === 4;
    let row = this.row;
    for (let ring = 0; ring < 50; ring++) {
      const off = preset === 1 ? ring * 6 - 75 : preset === 9 ? ring * 9 - 75 : 0;
      for (let j = 0; j < 50; j++) {
        const src = reversed ? row * 50 + 50 - j : row * 50 + j;
        let h = t[src];
        const hi = trunc(h);
        if (h >= 255) h = 255;
        const hc = trunc(h), inv = (255 - hc) >>> 0;
        const x = inv > 254 ? 1e6 : j * 6;
        const hv = preset === 6 ? f(h * 4) : h, hb = hv !== hv ? this.tbits[src] : bits(hv);
        const zw = preset === 1 ? w2 : f(f(2 * j * w2) / 50);
        const alpha = preset === 0 ? 0xfa : (inv >>> 2) & 255;
        this.box((ring * 50 + j) * 24, f(x - half), f(half + x), f(off - zw), f(off + zw), hb,
          (alpha << 24 | ((hi >>> 2) & 255) << 16 | ((hc >>> 4) & 255) << 8 | ((inv >>> 3) & 255)) >>> 0);
      }
      row = row === 49 ? 0 : row + 1;
    }
  }

  /** Render's scene part (0x0f304620): the frame time nudges the width, the preset ages the table, sets the camera and
   *  turns the field, the current row takes the spectrum, the bars are rebuilt; then the row moves back one. Returns
   *  how many bytes of the vertex buffer to upload (from the start). */
  step(preset: number, freq: Uint8Array, ms: number, w: number, h: number): number {
    const now = ms % 1000;
    let d = now - this.lastMs;
    if (d < 0) d += 1000;
    d = d < 0 ? 0 : d > 160 ? 160 : d;
    let k = f((80 - d) / 800);
    k = k <= 0.5 ? (k < -0.5 ? -0.5 : k) : 0.5;
    this.lastMs = now;
    if (this.width <= 5 && this.width > 0.1) this.width = f(f(k + 1) * this.width);
    const cam = CAMERAS[preset], t = this.table;
    if (preset === 3) for (let i = 0; i < BARS; i++) t[i] = f(t[i] * f(0.99));
    if (preset === 4) for (let i = 0; i < BARS; i++) t[i] = f(t[i] - 1);
    this.rings = preset !== 0 && preset !== 7 && preset !== 8;
    if (preset === 1) this.speed = f(0.1);
    if (preset === 9) this.speed = 1;
    if (!this.rings) this.row = 0;
    this.eye.set(cam.slice(0, 3)); this.at.set(cam.slice(3, 6)); this.fov = cam[6];
    if (preset === 0) this.roll = this.pitch = this.yaw = 0;
    else this.roll = f(this.roll + f(cam[7]));
    for (let i = 0; i < 50; i++) t[this.row * 50 + i] = freq[10 + 20 * i];
    this.build(preset, preset !== 0);
    let upload = VB_BYTES;
    if (preset === 8) { this.row = 0; upload = RING * STRIDE; }
    this.row = this.row === 0 ? 49 : this.row - 1;
    this.aspect = f(-w / h);
    return upload;
  }

  /** the turn of ring k (of the separate rings): around z by its place in the circle plus the roll; Guybrush and
   *  Dragons also tilt and twist each ring by the speed */
  ringAngles(preset: number, k: number): [number, number, number] {
    // 6.28, 0.213, 0.154, 0.1 and 1.3 are double constants (not float values): xmul makes f() round once, as the x87
    const a = f(f(xmul(k, 6.28)) / 50);
    if (preset === 1 || preset === 9) {
      const s = f(a * 5), sp = this.speed, r = this.roll;
      return [f(f(f(f(xmul(sp, 0.213)) * r) + this.yaw) + f(f(xmul(sp, 0.154)) * s)),
        f(f(f(xmul(sp, 0.1)) * r) + f(f(xmul(sp, 1.3)) * s)), f(f(s + r) * sp)];
    }
    return [this.yaw, this.pitch, f(a + this.roll)];
  }
}

/** the index buffer: two triangles per face, (0 1 2) (0 2 3), 32-bit */
export function indices(): Uint8Array {
  const ix = new Uint32Array(VERTS / 4 * 6);
  for (let q = 0, i = 0; q < VERTS; q += 4) { ix[i++] = q; ix[i++] = q + 1; ix[i++] = q + 2; ix[i++] = q; ix[i++] = q + 2; ix[i++] = q + 3; }
  return new Uint8Array(ix.buffer);
}

/** D3DXMatrixRotationYawPitchRoll (d3dx9_28: the quaternion of the three half-angles, FSINCOS each, then the
 *  quaternion's matrix), at 24-bit precision */
export function rotationYawPitchRoll(out: Float32Array, yaw: number, pitch: number, roll: number): Float32Array {
  const hr = f(roll * 0.5), hp = f(pitch * 0.5), hy = f(yaw * 0.5);
  const cr = f(Math.cos(hr)), sr = f(Math.sin(hr)), cp = f(Math.cos(hp)), sp = f(Math.sin(hp));
  const cy = f(Math.cos(hy)), sy = f(Math.sin(hy));
  const a = f(sy * cp), b = f(cy * sp), g = f(cy * cp), hh = f(sy * sp);
  const x = f(f(cr * b) + f(a * sr)), y = f(f(a * cr) - f(b * sr));
  const z = f(f(g * sr) - f(hh * cr)), w = f(f(hh * sr) + f(g * cr));
  const x2 = f(x * 2), y2 = f(y * 2), z2 = f(z * 2);
  const wx = f(x2 * w), wy = f(y2 * w), wz = f(z2 * w), xx = f(x2 * x), xy = f(y2 * x), xz = f(z2 * x);
  const yy = f(y2 * y), yz = f(z2 * y), zz = f(z2 * z), t = f(1 - xx);
  out[0] = f(f(1 - yy) - zz); out[1] = f(xy + wz); out[2] = f(xz - wy); out[3] = 0;
  out[4] = f(xy - wz); out[5] = f(t - zz); out[6] = f(yz + wx); out[7] = 0;
  out[8] = f(xz + wy); out[9] = f(yz - wx); out[10] = f(t - yy); out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}
