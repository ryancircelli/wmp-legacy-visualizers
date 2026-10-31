// Ribbons' simulation: a camera and up to 250 ribbons wander through 3D Perlin noise; each ribbon's head follows the
// noise at its own walking point and drags a 51-segment tail of its past positions, turned to face the camera.
// RibbonsVis.dll, image base 0x0f300000; offsets in comments are from the C++ object (the IWMPEffects pointer + 8).
//
// Precision: the constructor runs in CoCreateInstance at the host's 53-bit x87 precision (doubles, rounded to float
// where stored); everything after IWMPEffects2::Create's CreateDevice runs at 24 bits (no FPU_PRESERVE): f() after
// each operation. The constants the code adds or multiplies by are doubles holding float values.
import { A } from '../../ns';
import '../../rand';
import { ftol } from '../../x86';
import { f } from '../d3dx9';

export const MAX = 250;                 // ribbons (+0x380, stride 0x9dc)
export const SEGS = 51;                 // vertex pairs per ribbon
const K = 2 ** -15;
const C1 = f(23.432), C2 = f(32.43), C3 = f(987.43), C4 = f(0.64), C5 = f(943.93), C6 = f(38.843);
const K102 = f(10.2), K02 = f(0.2), K001 = f(0.01), K0001 = f(0.0001), K095 = f(0.95);

/** Random's pick (Render when none is picked yet, MediaInfo 0x0f304c10 on a new song): 1..5 */
export const pick = (): number => 1 - ftol(f(f(A.rand() * -K) * 5));

/** modes 1..5's settings (Render's switch at 0x0f305b7d): ribbon count, width, embossed, field of view */
const MODES: [number, number, boolean, number][] = [
  [1, f(0.2), false, 1.5], [30, f(0.05), false, 1], [250, f(0.01), false, 0.5],
  [30, f(0.1), true, 1], [250, f(0.02), true, 0.5],
];

/** 3D gradient noise (Perlin's, FUN_0f30b6b0) over a 256-entry permutation, three octaves summed (FUN_0f30c050) */
export class Noise {
  constructor(public perm: Int32Array) {}

  private grad(h: number, x: number, y: number, z: number): number {
    switch (h) {            // FUN_0f30b460's jump table
      case 0: case 12: return f(x + y);
      case 1: case 13: return f(y - x);
      case 2: return f(x - y);
      case 3: return f(-x - y);
      case 4: return f(x + z);
      case 5: return f(z - x);
      case 6: return f(x - z);
      case 7: return f(-x - z);
      case 8: return f(y + z);
      case 9: case 14: return f(z - y);
      case 10: return f(y - z);
      default: return f(-y - z);
    }
  }

  private static fade(t: number): number {
    return f(f(t * f(t * t)) * f(f(f(f(t * t) * 6) - f(t * 15)) + 10));
  }

  noise3(x: number, y: number, z: number): number {
    const P = this.perm;
    // the integer part: truncation, one lower for a negative coordinate (also when it is a whole number)
    const X = ftol(x) - (x < 0 ? 1 : 0), Y = ftol(y) - (y < 0 ? 1 : 0), Z = ftol(z) - (z < 0 ? 1 : 0);
    const fx = f(x - X), fy = f(y - Y), fz = f(z - Z);
    const fx1 = f(fx - 1), fy1 = f(fy - 1), fz1 = f(fz - 1);
    let e = P[Z & 255] + Y, h = P[e & 255] + X;
    const g000 = this.grad(P[h & 255] & 15, fx, fy, fz), g100 = this.grad(P[(h + 1) & 255] & 15, fx1, fy, fz);
    h = P[(e + 1) & 255] + X;
    const g010 = this.grad(P[h & 255] & 15, fx, fy1, fz), g110 = this.grad(P[(h + 1) & 255] & 15, fx1, fy1, fz);
    e = P[(Z + 1) & 255] + Y; h = P[e & 255] + X;
    const g001 = this.grad(P[h & 255] & 15, fx, fy, fz1), g101 = this.grad(P[(h + 1) & 255] & 15, fx1, fy, fz1);
    h = P[(e + 1) & 255] + X;
    const g011 = this.grad(P[h & 255] & 15, fx, fy1, fz1), g111 = this.grad(P[(h + 1) & 255] & 15, fx1, fy1, fz1);
    const u = Noise.fade(fx), v = Noise.fade(fy), w = Noise.fade(fz);
    const iu = f(1 - u), iv = f(1 - v), iw = f(1 - w);
    const l1 = f(f(g110 * u) + f(g010 * iu)), l0 = f(f(g100 * u) + f(g000 * iu));
    const m0 = f(f(l1 * v) + f(l0 * iv));
    const l3 = f(f(g111 * u) + f(g011 * iu)), l2 = f(f(g001 * iu) + f(g101 * u));
    const m1 = f(f(l2 * iv) + f(l3 * v));
    return f(f(m0 * iw) + f(m1 * w));
  }

  /** three octaves, each at twice the frequency and half the weight */
  sum3(x: number, y: number, z: number): number {
    let s = 0, a = 1;
    for (let o = 0; o < 3; o++) {
      s = f(f(this.noise3(f(a * x), f(a * y), f(a * z)) / a) + s);
      a = f(a + a);
    }
    return s;
  }

  /** the three noise channels a walker reads at its point p, times k: x at p, y and z at fixed offsets */
  at(out: Float32Array, o: number, p: Float32Array, q: number, k: number): void {
    const x = p[q], y = p[q + 1], z = p[q + 2];
    out[o] = f(this.sum3(x, y, z) * k);
    out[o + 1] = f(this.sum3(f(x + C1), f(y + C2), f(z + C3)) * k);
    out[o + 2] = f(this.sum3(f(x + C4), f(y + C5), f(z - C6)) * k);
  }
}

/** a walk through the noise: the point moves by its velocity times a step; a coordinate past +-lim turns back with a
 *  new random speed in [lo, hi] (the camera also jumps back to 0 there, a ribbon does not). Velocities, point, limits
 *  in one array from `o`: p[0..2], v[3..5] */
function walk(s: Float32Array, p: number, v: number, step: number, lo: number, hi: number, lim: Float32Array, reset: boolean): void {
  const sx = f(s[v] * step), sy = f(s[v + 1] * step), sz = f(s[v + 2] * step);
  s[p] = f(s[p] + sx); s[p + 1] = f(s[p + 1] + sy); s[p + 2] = f(s[p + 2] + sz);
  for (let i = 0; i < 3; i++) {
    const vi = s[v + i], pi = s[p + i], l = lim[i];
    if (0 < vi ? l < pi : vi < 0 && pi < -l) {
      const n = f(f(f(hi - lo) * f(A.rand() * K)) + lo);
      s[v + i] = vi > 0 ? -n : n;
      if (reset) s[p + i] = 0;
    }
  }
}

/** the beat detector FUN_0f3050b0 (its state: function-local statics, process wide in the DLL): returns the beat and
 *  leaves the level (the last 19 frames' average) in `level` */
class Beat {
  long = new Float32Array(120); li = 0; lsum = 0;
  short = new Float32Array(3); si = 0; ssum = 0;
  lv = new Float32Array(19); vi = 0; vsum = 0;
  thr = 0; hold = 0; level = 0;
  test(freq: Uint8Array): boolean {
    let sum = 0;
    for (let i = 0; i < 700; i++) sum += freq[i];
    const v = f(sum * K0001);
    const ol = this.long[this.li]; this.long[this.li] = v; this.li = (this.li + 1) % 120;
    this.lsum = f(f(v - ol) + this.lsum);
    const avgL = f(this.lsum / 120);
    const os = this.short[this.si]; this.short[this.si] = v; this.si = (this.si + 1) % 3;
    this.ssum = f(f(v - os) + this.ssum);
    const avgS = f(this.ssum / 3);
    const ov = this.lv[this.vi]; this.lv[this.vi] = v; this.vi = (this.vi + 1) % 19;
    this.vsum = f(f(v - ov) + this.vsum);
    this.level = f(this.vsum / 19);
    const diff = f(f(avgS - avgL) * 100);
    const old = this.thr;
    if (this.hold !== 0 || diff <= this.thr || diff <= 10) {
      if (this.thr > 0) this.thr = f(this.thr * K095);
      if (this.hold !== 0) this.hold--;
      return false;
    }
    this.thr = diff;
    if (f(old * 1.5) < diff) { this.hold = 5; return true; }
    return false;
  }
}

/** one ribbon (FUN_0f303e60 builds it, FUN_0f3035a0 moves it). `vb` is its vertex buffer's image (+0x10): 51 pairs
 *  of vertices (xyz, diffuse, u, v), 6 dwords each, the head first */
export class Ribbon {
  vb = new Float32Array(SEGS * 12);
  vbu = new Uint32Array(this.vb.buffer);
  s = new Float32Array(9);        // +0x9a0 walking point, +0x9b8 velocity (s[3..5]), +0x9ac head (s[6..8])
  lim = Float32Array.of(6, 6, 6); // +0x9c4
  lo = f(0.002); hi = f(0.005);   // +0x9d0, +0x9d4
  width = 0;                      // +0x00
  color = 0;                      // +0x9d8

  /** the constructor, at 53 bits: a random point in +-5, speeds in [lo, hi] */
  construct(): void {
    const a = f(A.rand() * K), b = f(A.rand() * K), c = f(A.rand() * K), d = f(A.rand() * K), e = f(A.rand() * K), g = f(A.rand() * K);
    this.s[0] = f(f(e - g) * 5); this.s[1] = f(f(c - d) * 5); this.s[2] = f(f(a - b) * 5);
    const x = f(A.rand() * K), y = f(A.rand() * K), z = f(A.rand() * K);
    const span = this.hi - this.lo;      // kept in a register: not rounded
    this.s[3] = f(z * span + this.lo); this.s[4] = f(y * span + this.lo); this.s[5] = f(x * span + this.lo);
  }

  /** FUN_0f304690's loop (24 bits): a random hue, a tenth of full brightness, and the vertex buffer FUN_0f3033b0 */
  init(width: number): void {
    this.width = width;
    let b = f(A.rand() * K), g = f(A.rand() * K), r = f(A.rand() * K);
    let m = r; if (g < m) m = g; if (b < m) m = b;
    m = f(m * 0.5);
    r = f(r - m); g = f(g - m); b = f(b - m);
    let M = r; if (M < g) M = g; if (M < b) M = b;
    const ch = (x: number): number => (0 < x ? (x < 1 ? ftol(f(x * 256)) & 255 : 255) : 0);
    const c = this.color = ((0xff << 24) | (ch(f(f(r / M) / 10)) << 16) | (ch(f(f(g / M) / 10)) << 8) | ch(f(f(b / M) / 10))) >>> 0;
    const vb = this.vb, vu = this.vbu;
    vb.fill(0);
    for (let i = 0; i < SEGS; i++) {
      const al = (0xff - ftol(f(f(i * 255) / 50))) << 24;
      const s = f(f(f(i / 50) * 2) - 1);
      const u = f(f(f(s * f(s * s)) + 1) * 0.5);
      const o = i * 12;
      vu[o + 3] = (c | al) >>> 0; vb[o + 4] = u; vb[o + 5] = 0;
      vu[o + 9] = (Math.imul(c, 3) | al) >>> 0; vb[o + 10] = u; vb[o + 11] = 1;
    }
  }

  /** one frame: the tail moves down one place, the walking point steps by `amp`, the head goes to the noise there and
   *  the new pair straddles it, `width` either side across the plane of the head's motion and the camera's view */
  step(noise: Noise, d: Float32Array, amp: number): void {
    const vb = this.vb, s = this.s;
    for (let k = SEGS - 1; k > 0; k--) {
      const o = k * 12, p = o - 12;
      vb[o] = vb[p]; vb[o + 1] = vb[p + 1]; vb[o + 2] = vb[p + 2];
      vb[o + 6] = vb[p + 6]; vb[o + 7] = vb[p + 7]; vb[o + 8] = vb[p + 8];
    }
    walk(s, 0, 3, amp, this.lo, this.hi, this.lim, false);
    noise.at(s, 6, s, 0, 10);
    const mx = f(f(vb[0] + vb[6]) * 0.5), my = f(f(vb[1] + vb[7]) * 0.5), mz = f(f(vb[2] + vb[8]) * 0.5);
    const vx = f(s[6] - mx), vy = f(s[7] - my), vz = f(s[8] - mz);
    let nx = f(f(vy * d[2]) - f(vz * d[1])), ny = f(f(vz * d[0]) - f(vx * d[2])), nz = f(f(vx * d[1]) - f(vy * d[0]));
    const l = f(Math.sqrt(f(f(f(nx * nx) + f(ny * ny)) + f(nz * nz))));
    nx = f(nx / l); ny = f(ny / l); nz = f(nz / l);
    const w = this.width, wx = f(nx * w), wy = f(ny * w), wz = f(nz * w);
    vb[0] = f(s[6] - wx); vb[1] = f(s[7] - wy); vb[2] = f(s[8] - wz);
    vb[6] = f(s[6] + wx); vb[7] = f(s[7] + wy); vb[8] = f(s[8] + wz);
  }
}

export class Scene {
  // the camera (+0x314, FUN_0f302ed0): walking point, look-at target, up, fov, aspect, near, far, eye, view direction,
  // velocity, speed range, limits
  cam = new Float32Array(9);      // [0..2] walking point, [3..5] velocity, [6..8] eye
  at = new Float32Array(3);
  up = Float32Array.of(0, 1, 0);
  dir = new Float32Array(3);
  fov = 2; aspect = f(4 / 3);
  lo = f(0.0001); hi = f(0.005);
  lim = Float32Array.of(f(10.1), f(10.1), f(10.1));
  bi = 0;                         // 0x0f323b20: the velocity axis the next beat flips
  ribbons: Ribbon[] = [];
  mode = 0;                       // +0x30c: 1..5 (Random picks one)
  count = 10; width = f(0.02); emboss = false;
  beat = new Beat();
  noise: Noise;

  constructor(perm: Int32Array) { this.noise = new Noise(perm); }

  /** the constructor (FUN_0f305d60) after srand(time(NULL)) (FUN_0f30b210, under the camera's constructor): 256 rand()s
   *  fill a table Ribbons never reads, then the 250 ribbons */
  construct(): void {
    this.cam.fill(0); this.cam[2] = f(-0.9);
    this.cam[3] = this.cam[4] = this.cam[5] = 0.0025499998591840267;   // the DLL's float 0x3b271de6, a step below f(0.00255)
    this.dir[2] = f(0.9);
    for (let i = 0; i < 256; i++) A.rand();
    this.ribbons = [];
    for (let i = 0; i < MAX; i++) { const r = new Ribbon(); r.construct(); this.ribbons.push(r); }
  }

  /** IWMPEffects2::Create's FUN_0f304690 after its own srand(time(NULL)) and CreateDevice */
  init(): void { for (const r of this.ribbons) r.init(this.width); }

  /** one Render call (FUN_0f305b10) up to the draw: preset 0..5, the frame's frequency bytes, the client size */
  step(preset: number, freq: Uint8Array, w: number, h: number): void {
    if (preset === 0) { if (this.mode === 0) this.mode = pick(); }
    else this.mode = preset;
    const m = MODES[this.mode - 1];
    if (m) [this.count, this.width, this.emboss, this.fov] = m;
    this.aspect = f(w / h);
    const beat = this.beat.test(freq);
    this.camStep(beat, f(f(this.beat.level * K02) + 0.5));
    const n = this.count, stride = (800 / n) | 0;
    for (let i = 0; i < n; i++) {
      const r = this.ribbons[i];
      r.width = this.width;
      r.step(this.noise, this.dir, f(f(freq[10 + i * stride] / 100) + K001));
    }
  }

  /** FUN_0f303020: a beat reverses one axis of the camera's walk (in turn); the eye goes to the noise at the walking
   *  point (times 10.2) and looks at a fifth of it, rotated one axis */
  private camStep(beat: boolean, step: number): void {
    const c = this.cam;
    if (beat) { this.bi = (this.bi + 1) % 3; c[3 + this.bi] = -c[3 + this.bi]; }
    walk(c, 0, 3, step, this.lo, this.hi, this.lim, true);
    this.noise.at(c, 6, c, 0, K102);
    this.at[0] = f(c[7] * K02); this.at[1] = f(c[8] * K02); this.at[2] = f(K02 * c[6]);
    this.dir[0] = f(this.at[0] - c[6]); this.dir[1] = f(this.at[1] - c[7]); this.dir[2] = f(this.at[2] - c[8]);
  }

  get eye(): Float32Array { return this.cam.subarray(6, 9); }
}
