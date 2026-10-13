// Goom's IFS fractal (visual data 0x10012460, apply 0x10011a70 -> 0x10011ac0): 2-5 similitudes eased
// along a cubic between random sets, iterated in 4096 fixed point to a point cloud, which brightens the
// destination by a slowly wandering colour. The colour wander's state is static in the DLL (0x100308c4..,
// shared by every instance and kept across re-inits).
import { f32, ftol } from './fpu';
import type { Crt, GoomRandom } from './random';
import { sincos87, mulExt } from '../plenoptic/x87';
import { addSat } from './draw';

const NSIMI = 30;   // Components: five blocks of nbSimi similitudes in 30 slots
// float fields per simi: c_x c_y r r2 A A2; integer fields: Ct St Ct2 St2 Cx Cy R R2
const CX = 0, CY = 1, RR = 2, RR2 = 3, AA = 4, AA2 = 5;
const ICT = 0, IST = 1, ICT2 = 2, IST2 = 3, ICX = 4, ICY = 5, IR = 6, IR2 = 7;

class Fractal {
  nbSimi = 0;
  f = new Float32Array(NSIMI * 6);
  i = new Int32Array(NSIMI * 8);
  depth = 0; col = 0; count = 0; speed = 6;
  width = 0; height = 0; lx = 0; ly = 0;
  rMean = 0; drMean = 0; dr2Mean = 0;
  curPt = 0; maxPt = 0;
  buffer1 = new Int32Array(0); buffer2 = new Int32Array(0);
}

const SC = new Float64Array(4);

export class Ifs {
  private F: Fractal | null = null;
  private initialized = 0;
  // the trace's write cursor (the visual data's Buf and Cur_Pt)
  private buf = new Int32Array(0);
  private bufPos = 0;
  private curPt = 0;
  // 0x100308c4..: couleur, v[4], col[4], mode; 0x100991bc justChanged, 0x100991c0 cycle
  couleur = 0xc0c0c0c0;
  v = [2, 4, 3, 2];
  colv = [2, 4, 3, 2];
  mode = 2;
  justChanged = 0;
  cycle = 0;

  constructor(private rnd: GoomRandom, private crt: Crt) {}

  /** the visual's re-init (0x10012460 after goom_set_resolution): a fresh fractal on the next apply */
  reset(): void { this.F = null; this.initialized = 0; }

  /** 0x10011300 Gauss_Rand / 0x100113a0 Half_Gauss_Rand */
  private gauss(c: number, A: number, S: number, half: boolean): number {
    const y = (this.rnd.raw() & 0x7fffffff) * 5.91398858773573e-08;
    const e1 = exp87(-(y * y * S) * Math.LOG2E);
    const e2 = exp87(-S * Math.LOG2E);
    const r = ((1.0 - e1) * A) / (1.0 - e2);
    if (half) return r + c;
    return (this.rnd.raw() & 0x7fffffff) & 1 ? r + c : c - r;
  }

  /** 0x10011230 Random_Simis */
  private randomSimis(F: Fractal, at: number, n: number): void {
    const f = F.f;
    for (let k = at; k < at + n; k++) {
      f[k * 6 + CX] = this.gauss(0, 0.800000011920929, 4.0, false);
      f[k * 6 + CY] = this.gauss(0, 0.800000011920929, 4.0, false);
      f[k * 6 + RR] = this.gauss(F.rMean, F.drMean, 3.0, false);
      f[k * 6 + RR2] = this.gauss(0, F.dr2Mean, 2.0, true);
      f[k * 6 + AA] = this.gauss(0, 360.0, 4.0, false) * 0.017453292519943278;
      f[k * 6 + AA2] = this.gauss(0, 360.0, 4.0, false) * 0.017453292519943278;
    }
  }

  /** 0x10011020 init_ifs */
  private init(w: number, h: number): void {
    if (!this.F) this.F = new Fractal();
    const F = this.F;
    F.buffer1 = new Int32Array(0); F.buffer2 = new Int32Array(0);
    const i = this.rnd.raw() & 3;
    if (i === 1) { F.depth = 6; F.rMean = f32(0.6); F.drMean = f32(0.4); F.dr2Mean = f32(0.3); }
    else if (i === 2) { F.depth = 4; F.rMean = 0.5; F.drMean = f32(0.4); F.dr2Mean = f32(0.3); }
    else if (i === 3) { F.depth = 2; F.rMean = 0.5; F.drMean = f32(0.4); F.dr2Mean = f32(0.3); }
    else { F.depth = 10; F.rMean = f32(0.7); F.drMean = f32(0.3); F.dr2Mean = f32(0.4); }
    F.nbSimi = i + 2;
    F.maxPt = i + 1;
    if (F.depth + 2 >= 0) for (let k = F.depth + 3; k > 0; k--) F.maxPt *= F.nbSimi;
    F.buffer1 = new Int32Array(F.maxPt * 2);
    F.buffer2 = new Int32Array(F.maxPt * 2);
    F.speed = 6;
    F.width = w; F.height = h;
    F.lx = ((w - 1) / 2) | 0; F.ly = ((h - 1) / 2) | 0;
    F.curPt = 0; F.count = 0;
    F.col = this.crt.rand() % (h * w);
    this.randomSimis(F, 0, NSIMI);
  }

  /** 0x100118c0 Transform: simi k applied to (xo, yo) -> TX, TY */
  private transform(F: Fractal, k: number, xo: number, yo: number): void {
    const I = F.i, b = k * 8, Cx = I[b + ICX], Cy = I[b + ICY], R = I[b + IR], R2 = I[b + IR2];
    xo = Math.imul(xo - Cx, R) >> 12;
    yo = Math.imul(yo - Cy, R) >> 12;
    const xx = Math.imul(xo - Cx, R2) >> 12;
    const yy = -Math.imul(Cy + yo, R2) >> 12;
    TX = ((Math.imul(I[b + ICT], xo) - Math.imul(I[b + IST], yo) - Math.imul(I[b + IST2], yy) + Math.imul(I[b + ICT2], xx)) >> 12) + Cx;
    TY = ((Math.imul(I[b + ICT], yo) + Math.imul(I[b + IST], xo) + Math.imul(I[b + ICT2], yy) + Math.imul(I[b + IST2], xx)) >> 12) + Cy;
  }

  /** 0x10011970 Trace */
  private trace(F: Fractal, xo: number, yo: number): void {
    for (let k = 0; k < F.nbSimi; k++) {
      this.transform(F, k, xo, yo);
      const x = TX, y = TY;
      this.buf[this.bufPos] = (Math.imul(F.lx, x) >> 13) + F.lx;
      this.buf[this.bufPos + 1] = F.ly - (Math.imul(F.ly, y) >> 13);
      this.bufPos += 2;
      this.curPt++;
      if (F.depth && ((x - xo) & ~15) && ((y - yo) & ~15)) {
        F.depth--;
        this.trace(F, x, y);
        F.depth++;
      }
    }
  }

  /** 0x10011750 Draw_Fractal */
  private drawFractal(F: Fractal): void {
    const f = F.f, I = F.i;
    for (let k = 0; k < F.nbSimi; k++) {
      const b = k * 8, a = k * 6;
      I[b + ICX] = ftol(f[a + CX] * 4096.0);
      I[b + ICY] = ftol(f[a + CY] * 4096.0);
      sincos87(f[a + AA], SC);
      I[b + ICT] = ftol(mulExt(4096.0, SC[2], SC[3]));
      I[b + IST] = ftol(mulExt(4096.0, SC[0], SC[1]));
      sincos87(f[a + AA2], SC);
      I[b + ICT2] = ftol(mulExt(4096.0, SC[2], SC[3]));
      I[b + IST2] = ftol(mulExt(4096.0, SC[0], SC[1]));
      I[b + IR] = ftol(f[a + RR] * 4096.0);
      I[b + IR2] = ftol(f[a + RR2] * 4096.0);
    }
    this.curPt = 0;
    this.buf = F.buffer2; this.bufPos = 0;
    for (let i = 0; i < F.nbSimi; i++) {
      const xo = I[i * 8 + ICX], yo = I[i * 8 + ICY];
      for (let j = 0; j < F.nbSimi; j++) {
        if (i === j) continue;
        this.transform(F, j, xo, yo);
        this.trace(F, TX, TY);
      }
    }
    F.curPt = this.curPt;
    const t = F.buffer1; F.buffer1 = F.buffer2; F.buffer2 = t;
  }

  /** 0x10011480 draw_ifs: the point list (the previous frame's, as the DLL returns it) and its count */
  private drawIfs(): Int32Array {
    const F = this.F!;
    const nb = F.nbSimi, f = F.f;
    const u = F.count * F.speed * 0.001;
    const uu = 1.0 - u;
    const u0 = f32(uu * uu * uu);
    const u1 = f32(u * (uu * uu) * 3.0);
    const u2 = f32(u * u * uu * 3.0);
    const u3 = f32(u * u * u);
    const S1 = nb, S2 = 2 * nb, S3 = 3 * nb, S4 = 4 * nb;
    for (let k = 0; k < nb; k++) {
      const c = k * 6, s1 = (S1 + k) * 6, s2 = (S2 + k) * 6, s3 = (S3 + k) * 6, s4 = (S4 + k) * 6;
      f[c] = u1 * f[s2] + u0 * f[s1] + u3 * f[s4] + u2 * f[s3];
      for (let q = 1; q < 6; q++) f[c + q] = u3 * f[s4 + q] + u2 * f[s3 + q] + u1 * f[s2 + q] + u0 * f[s1 + q];
    }
    this.drawFractal(F);
    if (F.count < ((1000 / F.speed) | 0)) F.count++;
    else {
      for (let k = 0; k < nb; k++) {
        const s1 = (S1 + k), s2 = (S2 + k) * 6, s3 = (S3 + k) * 6, s4 = (S4 + k);
        for (let q = 0; q < 6; q++) f[s2 + q] = f[s4 * 6 + q] * 2 - f[s3 + q];
        f.copyWithin(s1 * 6, s4 * 6, s4 * 6 + 6);
        F.i.copyWithin(s1 * 8, s4 * 8, s4 * 8 + 8);
      }
      this.randomSimis(F, S3, nb);
      this.randomSimis(F, S4, nb);
      F.count = 0;
    }
    F.col++;
    return F.buffer2;
  }

  /** 0x10011a70 / 0x10011ac0 ifs_update: dst[pt] = src[pt] + colour, saturating */
  apply(dst: Uint32Array, src: Uint32Array, w: number, h: number, increment: number): void {
    if (!this.initialized) { this.initialized = 1; this.init(w, h); }
    this.cycle++;
    let shift: number;
    if (this.cycle >= 80) { this.cycle = 0; shift = 0; }
    else if (this.cycle < 40) shift = (this.cycle / 10) | 0;
    else shift = 7 - ((this.cycle / 10) | 0);
    const c = this.couleur;
    const color = ((c & 255) >>> shift) | ((((c >>> 8) & 255) >>> shift) << 8) | ((((c >>> 16) & 255) >>> shift) << 16)
      | (((c >>> 24) >>> shift) << 24);
    const pts = this.drawIfs();
    const nbpt = this.curPt;
    for (let i = 0; i < nbpt - 1; i += increment) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      if (x < w && y < h && x > 0 && y > 0) { const p = y * w + x; dst[p] = addSat(src[p], color); }
    }
    this.updateColour();
  }

  private updateColour(): void {
    const R = this.rnd, v = this.v, col = this.colv;
    this.justChanged--;
    const c = this.couleur;
    col[3] = c >>> 24; col[2] = (c >>> 16) & 255; col[1] = (c >>> 8) & 255; col[0] = c & 255;
    let changed = false;
    if (this.mode === 0) {
      col[0] += v[0];
      if (col[0] > 255) { col[0] = 255; v[0] = -1 - (R.raw() & 3); }
      if (col[0] < 32) { col[0] = 32; v[0] = (R.raw() & 3) + 1; }
      col[1] += v[1];
      if (col[1] > 200) { col[1] = 200; v[1] = -2 - R.raw() % 3; }
      if (col[1] > col[0]) { col[1] = col[0]; v[1] = v[0]; }
      if (col[1] < 32) { col[1] = 32; v[1] = R.raw() % 3 + 2; }
      col[2] += v[2];
      if (col[2] > 64) { col[2] = 64; v[2] = -1 - (R.raw() & 3); }
      if (col[2] < 0) { col[2] = 0; v[2] = (R.raw() & 3) + 1; }
      col[3] += v[3];
      if (col[3] > 0) { col[3] = 0; v[3] = -1 - (R.raw() & 3); }
      if (col[3] < 0) { col[3] = 0; v[3] = (R.raw() & 3) + 1; }
      if (col[1] > 32 && col[2] < col[1] + 40 && col[1] < col[2] + 20 && col[0] < 64
        && R.raw() % 20 === 0 && this.justChanged < 0) {
        this.mode = R.raw() % 3 !== 0 ? 1 : 2;
        changed = true;
      }
    } else if (this.mode === 2) {
      col[0] += v[0];
      if (col[0] > 128) { col[0] = 128; v[0] = -1 - (R.raw() & 3); }
      if (col[0] < 16) { col[0] = 16; v[0] = (R.raw() & 3) + 1; }
      col[1] += v[1];
      if (col[1] > 200) { col[1] = 200; v[1] = -2 - R.raw() % 3; }
      if (col[1] > col[3]) { col[1] = col[3]; v[1] = v[3]; }
      if (col[1] < 32) { col[1] = 32; v[1] = R.raw() % 3 + 2; }
      col[2] += v[2];
      if (col[2] > 128) { col[2] = 128; v[2] = -1 - (R.raw() & 3); }
      if (col[2] < 0) { col[2] = 0; v[2] = (R.raw() & 3) + 1; }
      col[3] += v[3];
      if (col[3] > 255) { col[3] = 255; v[3] = -1 - (R.raw() & 3); }
      if (col[3] < 0) { col[3] = 0; v[3] = (R.raw() & 3) + 1; }
      if (col[1] > 32 && col[2] < col[1] + 40 && col[1] < col[2] + 20 && col[0] <= 63
        && R.raw() % 20 === 0 && this.justChanged < 0) {
        this.mode = R.raw() % 3 !== 0 ? 1 : 0;
        changed = true;
      }
    } else if (this.mode === 1) {
      col[0] += v[0];
      if (col[0] > 64) { col[0] = 64; v[0] = -1 - (R.raw() & 3); }
      if (col[0] < 0) { col[0] = 0; v[0] = (R.raw() & 3) + 1; }
      col[1] += v[1];
      if (col[1] > 200) { col[1] = 200; v[1] = -2 - R.raw() % 3; }
      if (col[1] > col[2] + 20) {
        col[1] = col[2] + 20;
        v[1] = -2 - R.raw() % 3;
        v[2] = (R.raw() & 3) + 1;
        v[0] = (R.raw() & 3) + 1;
      }
      if (col[1] < 0) { col[1] = 0; v[1] = R.raw() % 3 + 2; }
      col[2] += v[2];
      if (col[2] > 255) { col[2] = 255; v[2] = -1 - (R.raw() & 3); }
      if (col[2] > col[1] + 40) { col[2] = col[1] + 40; v[2] = -1 - (R.raw() & 3); }
      if (col[2] < 0) { col[2] = 0; v[2] = (R.raw() & 3) + 1; }
      col[3] += v[3];
      if (col[3] > 0) { col[3] = 0; v[3] = -1 - (R.raw() & 3); }
      if (col[3] < 0) { col[3] = 0; v[3] = (R.raw() & 3) + 1; }
      if (col[2] <= 63 && col[1] > 32 && col[0] > col[1] && col[0] > 32
        && R.raw() % 20 === 0 && this.justChanged < 0) {
        this.mode = (R.raw() & 1) ? 0 : 2;
        changed = true;
      }
    }
    if (changed) this.justChanged = 250;
    this.couleur = (((((col[3] << 8) | col[2]) << 8) | col[1]) << 8 | col[0]) >>> 0;
  }
}
let TX = 0, TY = 0;

/** FLDL2E-scaled 2^t as the DLL computes e^x: FRNDINT (to nearest even), F2XM1, FLD1 FADDP, FSCALE */
function exp87(t: number): number {
  let k = Math.round(t);
  if (k - t === 0.5 && (k & 1)) k--;   // ties to even
  return Math.pow(2, t - k) * Math.pow(2, k);
}
