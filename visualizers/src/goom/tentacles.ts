// Goom's "3D Tentacles" (visual data 0x100139e0, apply 0x10013ab0 -> 0x10013c30): six wire grids of
// vertices whose rows are pushed by random samples, rotated about the vertical axis by a slowly chasing
// camera (0x10014060), projected (0x10014310) and drawn column by column into both buffers.
import { f32, ftol, cos87f, sin87f, sinMul } from './fpu';
import type { Crt, GoomRandom } from './random';
import { drawLine } from './draw';
import { lighten } from './lines';
import { sincos87 } from '../plenoptic/x87';

class Grid3d {
  vertex: Float32Array;   // +0x00 surf: x y z per vertex
  svertex: Float32Array;  // +0x04 transformed
  nbvertex: number;       // +0x08
  cx: number; cy: number; cz: number;  // +0x0c..0x14 center
  defx: number;           // +0x18
  sizex: number;          // +0x1c
  defz: number;           // +0x20
  sizez: number;          // +0x24
  mode = 0;               // +0x28

  /** 0x100135f0 grid3d_new */
  constructor(sizex: number, defx: number, sizez: number, defz: number, cx: number, cy: number, cz: number) {
    this.nbvertex = defx * defz;
    this.vertex = new Float32Array(this.nbvertex * 3);
    this.svertex = new Float32Array(this.nbvertex * 3);
    this.defx = defx; this.sizex = sizex; this.defz = defz; this.sizez = sizez;
    this.cx = cx; this.cy = cy; this.cz = cz;
    for (let z = defz - 1; z >= 0; z--) {
      const vz = ((z - ((defz / 2) | 0)) * sizez) / defz;
      for (let x = defx - 1; x >= 0; x--) {
        const i = (z * defx + x) * 3;
        this.vertex[i] = ((x - ((defx / 2) | 0)) * sizex) / defx;
        this.vertex[i + 1] = 0;
        this.vertex[i + 2] = vz;
      }
    }
  }

  /** 0x10013860 grid3d_update */
  update(angle: number, vals: Float32Array, dist: number): void {
    const V = this.vertex, S = this.svertex, n = this.nbvertex, defx = this.defx;
    const cz = f32(this.cz + dist);
    sincos87(angle * 0.23255813121795654, SC);
    const cy = f32((SC[0] + SC[1]) * 2 + this.cy);
    const sina = sin87f(angle), cosa = cos87f(angle);
    if (this.mode === 0) {
      for (let i = 0; i < defx; i++) V[i * 3 + 1] = vals[i] * 0.8 + V[i * 3 + 1] * 0.2;
      for (let i = defx; i < n; i++) {
        V[i * 3 + 1] = V[i * 3 + 1] * 0.2549999952316284;
        V[i * 3 + 1] = V[(i - defx) * 3 + 1] * 0.7770000100135803 + V[i * 3 + 1];
      }
    }
    for (let i = 0; i < n * 3; i += 3) {
      S[i] = sina * V[i] - cosa * V[i + 2];
      S[i + 2] = sina * V[i + 2] + cosa * V[i];
      S[i + 1] = V[i + 1];
      S[i] = this.cx + S[i];
      S[i + 1] = cy + S[i + 1];
      S[i + 2] = cz + S[i + 2];
    }
  }

  /** 0x10013720 draw: columns into a with colour ca and into b with colour cb */
  draw(a: Uint32Array, ca: number, b: Uint32Array, cb: number, dist: number, W: number, H: number): void {
    const S = this.svertex, n = this.nbvertex, P = new Int32Array(n * 2), fd = dist;
    for (let i = 0; i < n; i++) {
      const z = S[i * 3 + 2];
      if (!(z > 2.0)) { P[i * 2] = -666; P[i * 2 + 1] = -666; continue; }
      const yp = ftol((fd / z) * S[i * 3 + 1]);
      const xp = ftol((S[i * 3] / z) * fd);
      P[i * 2] = xp + (W >> 1);
      P[i * 2 + 1] = (H >> 1) - yp;
    }
    for (let x = 0; x < this.defx; x++) {
      let px = P[x * 2], py = P[x * 2 + 1];
      for (let z = 1; z < this.defz; z++) {
        const k = (this.defx * z + x) * 2, nx = P[k], ny = P[k + 1];
        if ((nx !== -666 || ny !== -666) && (px !== -666 || py !== -666)) {
          drawLine(a, px, py, nx, ny, ca, W, H);
          drawLine(b, px, py, nx, ny, cb, W, H);
        }
        px = nx; py = ny;
      }
    }
  }
}
const SC = new Float64Array(4);

/** 0x10014020 evolutecolor */
function evolute(src: number, dest: number, mask: number, incr: number): number {
  let c = (src & mask) >>> 0;
  const d = (dest & mask) >>> 0;
  if (c !== mask && c < d) c += incr;
  if (c > d) c -= incr;
  return ((c & mask) | (src & ~mask)) >>> 0;
}

export class Tentacles {
  enabled = 1;
  cycle = 0;                 // +0x3c float
  grids: Grid3d[] = [];      // +0x40
  vals = new Float32Array(35); // +0x58
  colors = [0x184c2f, 0x482c6f, 0x583c0f]; // +0x5c
  col = 0x282c5f;            // +0x68
  dstcol = 0;                // +0x6c
  lig = f32(1.15);           // +0x70
  ligs = f32(0.1);           // +0x74
  distt = 10.0;              // +0x78
  distt2 = 0;                // +0x7c
  rot = 0;                   // +0x80
  happens = 0;               // +0x84
  rotation = 0;              // +0x88
  lock = 0;                  // +0x8c

  /** 0x100139e0 / 0x10013b60: six grids, three CRT rand() each */
  constructor(private rnd: GoomRandom, crt: Crt) {
    let y = -17.0;
    for (let i = 0; i < 6; i++) {
      const sizez = crt.rand() % 30 + 45;
      const sizex = crt.rand() % 5 + 85;
      const defz = crt.rand() % 10 + 45;
      this.grids.push(new Grid3d(sizex, 15, sizez, defz, 0, y, f32(sizez)));
      y = f32(y + 8.0);
    }
  }

  /** 0x10014060 pretty_move: the camera's distance, height and turn */
  private prettyMove(cycle: number): void {
    const R = this.rnd;
    if (this.happens) this.happens--;
    else if (this.lock === 0) {
      if (R.irand(200) !== 0) { this.happens = 0; this.lock = 0; }
      else { this.happens = R.irand(60) + 100; this.lock = ((this.happens * 3) / 2) | 0; }
    } else this.lock--;
    const target = this.happens ? 8.0 : 0.0;
    this.distt2 = f32((this.distt2 * 15.0 + target) * 0.0625);
    let t = 286.0 - (sinMul(cycle * 0.949999988079071, 1) + 1.0) * 90.0;
    if (this.happens) t = t * 0.6000000238418579;
    this.distt = f32((this.distt * 3.0 + t) * 0.25);
    let rt: number;
    if (this.happens === 0) {
      rt = sinMul(cycle, 0.09817477042468094) + 4.712388980384685;
    } else {
      this.rotation = R.irand(500) === 0 ? R.irand(2) : this.rotation;
      const r = cycle * (this.rotation ? 6.28318530717958 : -3.14159265358979);
      rt = r - Math.floor(r * 0.1591549430918955) * 6.28318530717958;
    }
    const a = Math.abs(ftol(rt - this.rot));
    const rp = this.rot + 6.28318530717958;
    if (a > Math.abs(ftol(rt - rp))) {
      const v = (rp * 15.0 + rt) * 0.0625;
      this.rot = v > 6.28318530717958 ? f32(v - 6.28318530717958) : f32(v);
      return;
    }
    const rm = this.rot - 6.28318530717958;
    if (a > Math.abs(ftol(rt - rm))) {
      const v = (rm * 15.0 + rt) * 0.0625;
      this.rot = v < 0 ? f32(v + 6.28318530717958) : f32(v);
      return;
    }
    this.rot = f32((this.rot * 15.0 + rt) * 0.0625);
  }

  /** 0x10013c30 tentacle_update: a gets colour B's lines, b colour A's */
  apply(a: Uint32Array, b: Uint32Array, W: number, H: number, data: Int16Array, rapport: number, drawit: number): void {
    const R = this.rnd;
    if (!drawit && this.ligs > 0) this.ligs = f32(-this.ligs);
    const lg = this.lig + this.ligs;
    this.lig = f32(lg);
    if (!(lg > 1.0099999904632568)) {
      this.lig = f32(1.05);
      if (this.ligs < 0) this.ligs = f32(-this.ligs);
      this.prettyMove(this.cycle);
      const c = this.cycle + 0.10000000149011612;
      this.cycle = f32(c);
      if (c > 1000.0) this.cycle = 0;
      return;
    }
    if (lg > 10.0 || lg < 1.100000023841858) this.ligs = f32(-this.ligs);
    if (this.lig < 6.300000190734863 && R.irand(30) === 0) this.dstcol = R.irand(3);
    const dest = this.colors[this.dstcol];
    this.col = evolute(this.col, dest, 0xff, 1);
    this.col = evolute(this.col, dest, 0xff00, 0x100);
    this.col = evolute(this.col, dest, 0xff0000, 0x10000);
    this.col = evolute(this.col, dest, 0xff000000, 0x1000000);
    const colA = lighten(this.col, f32((this.lig + 1.0) * 2));
    const colB = lighten(this.col, f32(this.lig * 0.3333333432674408 + 0.6700000166893005));
    let rap = f32(((rapport - 1.0) * 2 + 1.0) * 1.2000000476837158);
    if (((rapport - 1.0) * 2 + 1.0) * 1.2000000476837158 > 1.1200000047683716) rap = 1.1200000047683716;
    this.prettyMove(this.cycle);
    const dist = this.distt2, rotangle = this.rot, distt = this.distt;
    for (let g = 0; g < 6; g++) {
      for (let k = 0; k < 15; k++) {
        let v: number;
        if (data[R.irand(511)] < 0) v = -((-data[R.irand(511)]) >> 10);
        else v = data[R.irand(511)] >> 10;
        this.vals[k] = v * rap;
      }
      this.grids[g].update(rotangle, this.vals, dist);
    }
    this.cycle = f32(this.cycle + 0.009999999776482582);
    const d = ftol(distt);
    for (let g = 0; g < 6; g++) this.grids[g].draw(a, colB, b, colA, d, W, H);
  }
}
