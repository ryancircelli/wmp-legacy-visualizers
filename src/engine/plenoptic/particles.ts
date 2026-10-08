// Plenoptic's particle list and 3D camera (WMP 10 wmp.dll; WMP 9's VAs in brackets), shared by Flame,
// Fountain and Spyro. Every sum and product is written in the DLL's operand order: the x87 runs at
// 53-bit precision there, so each operation rounds exactly as a JS double operation does.
import { sincos87, mulExt } from './x87';

/** A particle, 0x58 bytes: position, velocity, acceleration (3 doubles each), age, life. */
export const P_SIZE = 11;
export const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AX = 6, AY = 7, AZ = 8, AGE = 9, LIFE = 10;

/** normalize, 0x78762bd [0x797c645]: v *= 1/sqrt((x*x + y*y) + z*z). WMP 7-8 (`div`) divide by the length instead. */
export function normalize(a: Float64Array, o: number, div?: boolean): void {
  var x = a[o], y = a[o + 1], z = a[o + 2];
  var len = Math.sqrt(x * x + y * y + z * z);
  if (div) { a[o] = x / len; a[o + 1] = y / len; a[o + 2] = z / len; return; }
  var inv = 1 / len;
  a[o] = inv * x;
  a[o + 1] = inv * y;
  a[o + 2] = inv * z;
}

/** length, 0x78762f6 [0x797c67e] */
export function length3(a: Float64Array, o: number): number {
  var x = a[o], y = a[o + 1], z = a[o + 2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** scale, 0x7876284 [0x797c60e]: v = s * v */
export function scale3(a: Float64Array, o: number, s: number): void {
  a[o] = s * a[o];
  a[o + 1] = s * a[o + 1];
  a[o + 2] = s * a[o + 2];
}

/** The list (cap particles, count used), 0x78764de reserve / 0x787653e add / 0x787657b remove [0x797c86d,
 *  0x797d9ab, 0x797c8a5]. remove() moves the last particle into the hole, so the order is the DLL's. */
export class PList {
  a: Float64Array = new Float64Array(0);
  count = 0;
  cap = 0;

  reserve(n: number): void {
    this.a = new Float64Array(n * P_SIZE);
    this.count = 0;
    this.cap = n;
  }

  add(p: Float64Array): void {
    if (this.count === this.cap) return;
    this.a.set(p, this.count * P_SIZE);
    this.count++;
  }

  remove(i: number): void {
    var n = this.count;
    if (i >= n || n === 0) return;
    if (i !== n - 1) this.a.copyWithin(i * P_SIZE, (n - 1) * P_SIZE, n * P_SIZE);
    this.count--;
  }

  /** step, 0x787666b [0x797c988]: from the last particle down, v += a*dt, p += v*dt, age += dt; dead ones (age > life) removed */
  step(dt: number): void {
    var a = this.a;
    for (var i = this.count; i-- > 0;) {
      var o = i * P_SIZE;
      a[o + AGE] = dt + a[o + AGE];
      var tx = dt * a[o + AX], ty = dt * a[o + AY], tz = dt * a[o + AZ];
      a[o + VX] = tx + a[o + VX];
      a[o + VY] = ty + a[o + VY];
      a[o + VZ] = tz + a[o + VZ];
      tx = dt * a[o + VX]; ty = dt * a[o + VY]; tz = dt * a[o + VZ];
      a[o + PX] = tx + a[o + PX];
      a[o + PY] = ty + a[o + PY];
      a[o + PZ] = tz + a[o + PZ];
      if (a[o + AGE] > a[o + LIFE]) this.remove(i);
    }
  }

  /** cull, 0x78765c9 [0x797c8ea]: make room for n more by removing the oldest (every particle of the
   *  greatest age at once), as many rounds as it takes */
  cull(n: number): void {
    var free = (this.cap - this.count) >>> 0;
    if (free >= n >>> 0) return;
    var need = (this.count - this.cap + n) | 0, a = this.a;
    while (need !== 0) {
      if (this.count === 0) return;
      var max = 0, i;
      for (i = 0; i < this.count; i++) {
        var g = a[i * P_SIZE + AGE];
        if (g > max) max = g;
      }
      for (i = 0; i < this.count;) {
        if (a[i * P_SIZE + AGE] === max) { this.remove(i); if (need !== 0) need--; }
        else i++;
      }
    }
  }

  /** bounce, 0x787645c [0x797c7ed], on particle i: a slow particle at the plane stops; one past y = b
   *  is mirrored back with its velocity's y flipped and the whole velocity halved */
  bounce(i: number, b: number): void {
    var a = this.a, o = i * P_SIZE;
    if (length3(a, o + VX) < 0.01 && Math.abs(a[o + PY] - b) < 0.1) { a[o + VX] = 0; a[o + VY] = 0; a[o + VZ] = 0; }
    if (a[o + PY] > b) {
      a[o + PY] = (b + b) - a[o + PY];
      a[o + VY] = -a[o + VY];
      scale3(a, o + VX, 0.5);
    }
  }
}

/** Euler rotation of the 4x4 matrix's three rows in place, 0x7878996 [0x797eba3]: x, then y, then z.
 *  Three of the six sines and cosines stay in x87 registers (64-bit mantissas) and the products with them
 *  round from there (x87.ts): sin x, cos x and sin y in WMP 9-10; cos x, cos y and cos z in WMP 7-8 (`old`,
 *  WMP 8 SP1 wmpui.dll 0x591d9588). The rest go through memory as doubles. */
var SC1 = new Float64Array(4), SC2 = new Float64Array(4), SC3 = new Float64Array(4);
export function rotate(m: Float64Array, o: number, ax: number, ay: number, az: number, old?: boolean): void {
  sincos87(ax, SC1); sincos87(ay, SC2); sincos87(az, SC3);
  var saH = SC1[0], saL = SC1[1], caH = SC1[2], caL = SC1[3];
  var sbH = SC2[0], sbL = SC2[1], cbH = SC2[2], cbL = SC2[3];
  var scH = SC3[0], scL = SC3[1], ccH = SC3[2], ccL = SC3[3];
  var sa = saH + saL, sb = sbH + sbL, sc = scH + scL, cb = cbH + cbL, cc = ccH + ccL;   // stored: doubles
  for (var r = 0; r < 3; r++, o += 4) {
    var m0 = m[o], m1 = m[o + 1], m2 = m[o + 2], n2, n1, z, n0;
    if (old) {
      n2 = mulExt(m2, caH, caL) + m1 * sa;
      n1 = mulExt(m1, caH, caL) - m2 * sa;
      z = mulExt(n2, cbH, cbL) + m0 * sb * -1;
      n0 = mulExt(m0, cbH, cbL) + n2 * sb;
      m[o] = mulExt(n0, ccH, ccL) - n1 * sc;
      m[o + 1] = mulExt(n1, ccH, ccL) + n0 * sc;
    } else {
      n2 = mulExt(m2, caH, caL) + mulExt(m1, saH, saL);
      n1 = mulExt(m1, caH, caL) - mulExt(m2, saH, saL);
      z = n2 * cb + mulExt(m0, sbH, sbL) * -1;
      n0 = m0 * cb + mulExt(n2, sbH, sbL);
      m[o] = cc * n0 - n1 * sc;
      m[o + 1] = n1 * cc + n0 * sc;
    }
    m[o + 2] = z;
  }
}

/** The camera, 0x7878724 [0x797e946]: P (+0), V (+0x80), V*P (+0x100, unused), the eye (+0x180), an
 *  offset added to every point first (+0x198), and the viewport (+0x1c8.. offset/scale x, offset/scale y). */
export class Camera {
  P = new Float64Array(16);
  V = new Float64Array(16);
  eye = new Float64Array(3);
  off = new Float64Array(3);
  ox = 0.5; sx = 1; oy = 0; sy = 1;
  private t = new Float64Array(3);
  out = new Float64Array(3);
  /** WMP 7-8's arithmetic (wmpui.dll): x/z and y/z, and the older matrix * vector sum order */
  old = false;

  /** setViewport, 0x78787ed [0x797ea0d]: P from fptan(1.2f), fptan(1.05f) and 30/29; V = identity */
  setViewport(w: number, h: number): void {
    var P = this.P, V = this.V;
    P.fill(0);
    P[0] = Math.tan(1.2000000476837158);                 // fptan of these two rounds to the same doubles (checked on the FPU)
    P[5] = Math.tan(1.0499999523162842);
    P[10] = 1.0344827586206897;
    P[11] = -1.0344827586206897;
    P[14] = 1;
    V.fill(0); V[0] = V[5] = V[10] = V[15] = 1;
    this.ox = w * 0.5; this.sx = w * 0.5;
    this.oy = h * 0.5; this.sy = h * 0.5;
  }

  /** project, 0x78788c8 [0x797eadb]: (V(p + off) - eye) through P, divided by z (unless 0: WMP 10's
   *  guard), then the viewport. Leaves (x, y, z) in out. */
  project(px: number, py: number, pz: number): Float64Array {
    var t = this.t, o = this.out;
    t[0] = this.off[0] + px; t[1] = this.off[1] + py; t[2] = this.off[2] + pz;
    var mul = this.old ? mulVecOld : mulVec;
    mul(this.V, t);
    t[0] = t[0] - this.eye[0]; t[1] = t[1] - this.eye[1]; t[2] = t[2] - this.eye[2];
    mul(this.P, t);
    var x = t[0], y = t[1], z = t[2];
    if (z !== 0) {
      if (this.old) { x = x / z; y = y / z; }
      else { var inv = 1 / z; x = x * inv; y = inv * y; }
    }
    o[0] = x * this.sx + this.ox;
    o[1] = y * this.sy + this.oy;
    o[2] = z;
    return o;
  }
}

/** matrix * vector, 0x787864c [0x797e874], rows of four with the fourth column added; the x row sums in
 *  a different order from the y and z rows, as there */
function mulVec(m: Float64Array, v: Float64Array): void {
  var x = v[0], y = v[1], z = v[2];
  v[2] = m[10] * z + m[8] * x + m[9] * y + m[11];
  v[1] = m[6] * z + m[4] * x + m[5] * y + m[7];
  v[0] = m[2] * z + m[1] * y + x * m[0] + m[3];
}

/** WMP 7-8's matrix * vector (WMP 8 SP1 wmpui.dll 0x591d951f): every row summed as (b + a) + c + d, from y */
function mulVecOld(m: Float64Array, v: Float64Array): void {
  var x = v[0], y = v[1], z = v[2];
  v[0] = m[1] * y + m[2] * z + x * m[0] + m[3];
  v[1] = m[5] * y + m[4] * x + m[6] * z + m[7];
  v[2] = m[9] * y + m[8] * x + m[10] * z + m[11];
}
