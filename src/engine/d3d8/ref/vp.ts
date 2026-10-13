// Fixed-function vertex processing as REF does it (tnl: ProcessPrimitive 0x420758, UpdateTLState 0x41f257,
// UpdateXformData 0x42223a, ProcessVertices 0x41f883, lighting 0x42169a / 0x42188a / 0x420e02): transform to REF's
// clip space (x' = (x+w)/2, y' = (y+w)/2, z, w), clip codes, screen mapping, lighting in 0..255 units packed to
// bytes, texture coordinates, point size. All arithmetic in the x87's 64-bit precision (./ext).
import { Fvf, Prim, Rs } from '../api';
import type { State } from '../ref';
import * as E from './ext';
import { f32, ftol } from './num';

/** TL vertex layout (RDVertex 0xd8, as doubles): clip x', y', z, w; screen x, y, z, rhw; diffuse RGBA; specular
 *  RGBA; fog; point size; 8 texcoord sets of 4; clip code */
export const CX = 0, CY = 1, CZ = 2, CW = 3, SX = 4, SY = 5, SZ = 6, RHW = 7, DIF = 8, SPE = 12, FOG = 16, PSZ = 17, TEX = 18,
  CODE = 50, ST = 52;
export const K255 = f32(1 / 255);   // 0x3b808081

/** TL vertices of one draw */
export class TLBuf {
  f = new Float64Array(0);
  n = 0;
  grow(n: number): void { if (this.f.length < n * ST) this.f = new Float64Array(Math.max(n, 64) * ST * 2); this.n = n; }
}

/** what the rasterizer needs to know about the TL vertices (the output FVF) */
export interface OutFvf {
  diffuse: boolean; specular: boolean; psize: boolean;
  /** texcoord set used by stage i, and its dimension (FVF TEXCOORDSIZE) */
  texSet: number[]; texDims: number[];
  /** dimension of each output texcoord set (what the clipper interpolates) */
  setDims: number[];
}

// ---- 4x4 matrices (float32 row-major) ----
// Mul 0x42200a: R[i][j] = f32(sum of A[i][k]*B[k][j]) in this k order (first two added, then the 3rd, the 4th)
const ORD = [3, 0, 2, 1, 1, 3, 2, 0, 3, 0, 2, 1, 3, 2, 0, 1, 3, 0, 1, 2, 2, 3, 1, 0, 1, 3, 0, 2, 1, 3, 2, 0, 3, 0, 1, 2, 3, 2, 1, 0,
  1, 0, 3, 2, 3, 2, 1, 0, 3, 0, 1, 2, 3, 2, 1, 0, 1, 0, 3, 2, 3, 2, 1, 0];
export function mul4(a: Float32Array, b: Float32Array, o: Float32Array): void {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const q = (i * 4 + j) * 4;
    let k = ORD[q]; E.ld(a[i * 4 + k] * b[k * 4 + j]);
    k = ORD[q + 1]; E.fadd(a[i * 4 + k] * b[k * 4 + j]);
    k = ORD[q + 2]; E.fadd(a[i * 4 + k] * b[k * 4 + j]);
    k = ORD[q + 3]; E.fadd(a[i * 4 + k] * b[k * 4 + j]);
    o[i * 4 + j] = E.st32();
  }
}
/** Inverse 0x421a76 (cofactors; the qword stores round to double): false (o untouched) if singular */
export function inv4(m: Float32Array, o: Float32Array): boolean {
  const a = (i: number, j: number): number => m[i * 4 + j];
  const d2 = (p: number, q: number, r: number, s: number): number => { E.ld(p * q); E.fsub(r * s); return E.st64(); };
  const s0 = d2(a(1, 1), a(0, 0), a(1, 0), a(0, 1)), s1 = d2(a(2, 1), a(0, 0), a(2, 0), a(0, 1));
  const s2 = d2(a(3, 1), a(0, 0), a(3, 0), a(0, 1)), s3 = d2(a(2, 1), a(1, 0), a(2, 0), a(1, 1));
  const s4 = d2(a(3, 1), a(1, 0), a(3, 0), a(1, 1)), s5 = d2(a(3, 1), a(2, 0), a(3, 0), a(2, 1));
  // (x*p - y*q) +/- z*r with double operands p, q, r: each product rounded to 64 bits
  const t3 = (x: number, p: number, y: number, q: number, sg: number, z: number, r: number): void => {
    E.ldMul(x, p); const h = E.H, l = E.L; E.ldMul(y, q); E.ldE(...negE(E.H, E.L)); E.faddE(h, l);
    const h2 = E.H, l2 = E.L; E.ldMul(z, r); if (sg < 0) { E.ldE(...negE(E.H, E.L)); } E.faddE(h2, l2);
  };
  t3(a(0, 2), s3, a(1, 2), s1, 1, a(2, 2), s0); const q0 = E.st64();
  t3(a(1, 2), s2, a(3, 2), s0, -1, a(0, 2), s4); const q1 = E.st64();
  t3(a(0, 2), s5, a(2, 2), s2, 1, a(3, 2), s1); const q2 = E.st64();
  t3(a(2, 2), s4, a(3, 2), s3, -1, a(1, 2), s5); const q3 = E.st64();
  t3(s1, a(1, 3), s0, a(2, 3), -1, s3, a(0, 3)); const q4 = E.st64();
  t3(s4, a(0, 3), s2, a(1, 3), 1, s0, a(3, 3)); const q5 = E.st64();
  t3(s2, a(2, 3), s1, a(3, 3), -1, s5, a(0, 3)); const q6 = E.st64();
  t3(s5, a(1, 3), s4, a(2, 3), 1, s3, a(3, 3)); const q7 = E.st64();
  const t0 = d2(a(0, 2), a(1, 3), a(1, 2), a(0, 3)), t1 = d2(a(0, 2), a(2, 3), a(2, 2), a(0, 3));
  E.ld(a(0, 2) * a(3, 3)); E.fsub(a(3, 2) * a(0, 3)); const t2h = E.H, t2l = E.L;
  E.ld(a(1, 2) * a(2, 3)); E.fsub(a(2, 2) * a(1, 3)); const t3h = E.H, t3l = E.L, t3d = E.st64();
  const t4 = d2(a(1, 2), a(3, 3), a(3, 2), a(1, 3)), t5 = d2(a(2, 2), a(3, 3), a(3, 2), a(2, 3));
  // c = (p*x - q*y) +/- r*z where p, q, r may be 64-bit values
  const c3 = (ph: number, pl: number, x: number, qh: number, ql: number, y: number, sg: number, rh: number, rl: number, z: number): number => {
    E.ldE(ph, pl); E.fmul(x); const h = E.H, l = E.L;
    E.ldE(qh, ql); E.fmul(y); E.ldE(...negE(E.H, E.L)); E.faddE(h, l); const h2 = E.H, l2 = E.L;
    E.ldE(rh, rl); E.fmul(z); if (sg < 0) E.ldE(...negE(E.H, E.L)); E.faddE(h2, l2);
    return E.st64();
  };
  const c30 = c3(t1, 0, a(1, 1), t0, 0, a(2, 1), -1, t3h, t3l, a(0, 1));
  const c20 = c3(t4, 0, a(0, 1), t2h, t2l, a(1, 1), 1, t0, 0, a(3, 1));
  const c10 = c3(t2h, t2l, a(2, 1), t1, 0, a(3, 1), -1, t5, 0, a(0, 1));
  const c00 = c3(t5, 0, a(1, 1), t4, 0, a(2, 1), 1, t3h, t3l, a(3, 1));
  E.ldMul(c30, a(3, 0)); let h = E.H, l = E.L;
  E.ldMul(c20, a(2, 0)); E.faddE(h, l); h = E.H; l = E.L;
  E.ldMul(c10, a(1, 0)); E.faddE(h, l); h = E.H; l = E.L;
  E.ldMul(c00, a(0, 0)); E.faddE(h, l);
  if (E.H === 0 && E.L === 0) return false;
  E.fdivr(1); const ih = E.H, il = E.L;
  const by = (x: number): number => { E.ldE(ih, il); E.fmul(x); return E.st32(); };
  o[0] = by(c00); o[1] = by(c10); o[2] = by(c20); o[3] = by(c30);
  const row = (p: number, x: number, q: number, y: number, sg: number, r: number, z: number): number => {
    t3(p, x, q, y, sg, r, z); E.fmulE(ih, il); return E.st32();
  };
  o[4] = row(t4, a(2, 0), t3d, a(3, 0), -1, t5, a(1, 0));
  o[5] = rowE(t5, a(0, 0), t2h, t2l, a(2, 0), 1, t1, a(3, 0), ih, il);
  o[6] = rowE(t2h, a(1, 0), t0, 0, a(3, 0), -1, t4, a(0, 0), ih, il, t2l);
  o[7] = row(t3d, a(0, 0), t1, a(1, 0), 1, t0, a(2, 0));
  o[8] = by(q7); o[9] = by(q6); o[10] = by(q5); o[11] = by(q4);
  o[12] = by(q3); o[13] = by(q2); o[14] = by(q1);
  E.ldE(ih, il); E.fmul(q0); o[15] = E.st32();
  return true;
}
function negE(h: number, l: number): [number, number] { return [-h, -l]; }
/** ((p*x - (qh,ql)*y) +/- r*z) * inv where p or q may be the 64-bit t2 (pl = low part of p) */
function rowE(p: number, x: number, qh: number, ql: number, y: number, sg: number, r: number, z: number, ih: number, il: number, pl = 0): number {
  E.ldE(p, pl); E.fmul(x); const h = E.H, l = E.L;
  E.ldE(qh, ql); E.fmul(y); E.ldE(-E.H, -E.L); E.faddE(h, l); const h2 = E.H, l2 = E.L;
  E.ldMul(r, z); if (sg < 0) E.ldE(-E.H, -E.L); E.faddE(h2, l2);
  E.fmulE(ih, il);
  return E.st32();
}

/** Normalize3 0x41eec3 (in place on v[0..2]) */
export function normalize3(v: Float64Array | number[], o = 0): void {
  E.ld(v[o] * v[o]); E.fadd(v[o + 1] * v[o + 1]); E.fadd(v[o + 2] * v[o + 2]); E.fsqrt();
  if (E.st32() === 0) { v[o] = 0; v[o + 1] = 0; v[o + 2] = 0; return; }
  E.fdivr(1); const ih = E.H, il = E.L;
  for (let i = 0; i < 3; i++) { E.ldE(ih, il); E.fmul(v[o + i]); v[o + i] = E.st32(); }
}

const T = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1]);
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return I1[0]; };
const signbit = (x: number): boolean => x < 0 || Object.is(x, -0);

interface Light { amb: number[]; dif: number[]; spe: number[]; ambMat: number[]; difMat: number[]; speMat: number[]; L: number[] }

export class VertexProcessor {
  private pp = new Float32Array(16); private vp = new Float32Array(16); private cur = new Float32Array(16);
  private toEye = new Float32Array(16); private toEyeInv = new Float32Array(16);
  private tmp = new Float32Array(16);
  /** specular threshold (persists when Power <= 0.001, as REF's) */
  private specThreshold = 0;
  isect = 0; union = 0;
  // viewport scale / offset (0x41b7e1)
  scaleX = 0; scaleY = 0; scaleZ = 0; offX = 0; offY = 0; offZ = 0;
  // guard band constants
  K78 = 0; K7c = 0; K80 = 0; K84 = 0; K88 = 0; K8c = 0; K90 = 0; K94 = 0;

  /** viewport and guard band (0x41b7e1) */
  viewport(st: State): void {
    const v = st.vp, W = v.w >>> 0, Hh = v.h >>> 0, X = v.x >>> 0, Y = v.y >>> 0;
    this.scaleX = f32(W); this.scaleY = f32(-Hh); this.scaleZ = f32(v.maxZ - v.minZ);
    this.offX = f32(X); this.offY = f32(Hh + Y); this.offZ = v.minZ;
    const GBl = -32768, GBr = 32767, GBt = -32768, GBb = 32767;
    const tw = f32(2 * f32(1 / W)), th = f32(2.0 / Hh);
    E.ld(GBl - X); E.fmul(tw); E.fsubr(1); const a = E.st32();
    E.ld(GBr - X); E.fmul(tw); E.fsub(1); const b = E.st32();
    E.ld(GBb - Y); E.fmul(th); E.fsub(1); const c = E.st32();
    E.ld(GBt - Y); E.fmul(th); E.fsubr(1); const dh = E.H, dl = E.L;
    E.ld(b); E.fadd(a); E.fdivr(2); const kx = E.st32(); this.K78 = kx;
    E.ld(a); E.fsub(1); E.fmul(kx); E.fmul(0.5); this.K80 = E.st32();
    E.ldE(dh, dl); E.fadd(c); E.fdivr(2); const kyh = E.H, kyl = E.L; this.K7c = E.st32();
    E.ld(c); E.fsub(1); E.fmulE(kyh, kyl); E.fmul(0.5); this.K84 = E.st32();
    E.ld(a); E.fsubr(1); E.fmul(0.5); this.K88 = E.st32();
    E.ld(b); E.fadd(1); E.fmul(0.5); this.K90 = E.st32();
    E.ld(c); E.fsubr(1); E.fmul(0.5); this.K8c = E.st32();
    E.ldE(dh, dl); E.fadd(1); E.fmul(0.5); this.K94 = E.st32();
  }

  /**
   * ProcessVertices: stream vertices start..start+n-1 of `fvf` into tl. Returns the output FVF description.
   * Sets isect (clip-code intersection; 0 if CLIPPING off) and union.
   */
  process(st: State, lights: number[], fvf: number, prim: Prim, data: Uint8Array, stride: number, start: number, n: number, tl: TLBuf,
    stageCount: number): OutFvf {
    const rs = st.rs;
    const tf = (t: number): Float32Array => st.tf.get(t) ?? IDENT;
    // matrices (UpdateXformData 0x42223a): P' = P*T, VP = V*P', Cur = W*VP
    mul4(tf(3), T, this.pp); mul4(tf(2), this.pp, this.vp); mul4(tf(256), this.vp, this.cur);
    const lighting = rs[Rs.LIGHTING] !== 0, clipping = rs[Rs.CLIPPING] !== 0, points = prim === Prim.POINTLIST;
    const pointScale = points && rs[Rs.POINTSCALEENABLE] !== 0;
    if (lighting || points) {
      mul4(tf(256), tf(2), this.toEye);
      inv4(this.toEye, this.toEyeInv);
    }
    this.viewport(st);
    // input layout
    const posBytes = (fvf & 0xe) === 4 /* XYZRHW */ ? 16 : 12;
    let off = posBytes;
    const nOff = fvf & Fvf.NORMAL ? off : -1; if (fvf & Fvf.NORMAL) off += 12;
    const pOff = fvf & Fvf.PSIZE ? off : -1; if (fvf & Fvf.PSIZE) off += 4;
    const dOff = fvf & Fvf.DIFFUSE ? off : -1; if (fvf & Fvf.DIFFUSE) off += 4;
    const sOff = fvf & Fvf.SPECULAR ? off : -1; if (fvf & Fvf.SPECULAR) off += 4;
    const ntex = (fvf >> 8) & 0xf, tOff: number[] = [], tDim: number[] = [];
    for (let t = 0; t < ntex; t++) { const d = texDims(fvf, t); tOff.push(off); tDim.push(d); off += d * 4; }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // output FVF
    const specEnable = rs[Rs.SPECULARENABLE] !== 0;
    const out: OutFvf = {
      diffuse: lighting || dOff >= 0, specular: lighting ? specEnable || sOff >= 0 : sOff >= 0,
      psize: points, texSet: [], texDims: [], setDims: [],
    };
    // texture sets: as the input's, or (any stage with a texture transform) set i = stage i (RefDev+0x19c90)
    let anyTT = false;
    for (let i = 0; i < stageCount; i++) if ((st.tss[i * 32 + 24] & ~0x100) !== 0) anyTT = true;
    for (let i = 0; i < 8; i++) {
      if (anyTT) {
        const ttf = st.tss[i * 32 + 24] & 0xff, src = st.tss[i * 32 + 11] & 0xffff;
        out.texSet.push(i); out.texDims.push(ttf >= 1 && ttf <= 4 ? ttf : src < ntex ? tDim[src] : 0);
      } else {
        const set = st.tss[i * 32 + 11] & 0xffff;
        out.texSet.push(set); out.texDims.push(set < ntex ? tDim[set] : 0);
      }
    }
    out.setDims = anyTT ? out.texDims.slice(0, stageCount) : tDim.slice();
    // lighting setup
    const L = lighting ? this.lightSetup(st, lights, fvf) : null;
    const pointSize = f32v(rs[Rs.POINTSIZE]), pMin = f32v(rs[Rs.POINTSIZE_MIN]);
    const pMaxRaw = f32v(rs[Rs.POINTSIZE_MAX]), pMax = pMaxRaw <= 64 ? pMaxRaw : 64;
    const pA = f32v(rs[Rs.POINT_SCALE_A]), pB = f32v(rs[Rs.POINT_SCALE_B]), pC = f32v(rs[Rs.POINT_SCALE_C]);
    const C = this.cur, Em = this.toEye, Im = this.toEyeInv;
    const needEye = lighting || points, needNormal = lighting && nOff >= 0;
    const normalize = rs[Rs.NORMALIZENORMALS] !== 0;
    tl.grow(n);
    const f = tl.f;
    let isect = -1, union = 0;
    const eye = [0, 0, 0], nrm = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      const b = (start + v) * stride, o = v * ST;
      const x = dv.getFloat32(b, true), y = dv.getFloat32(b + 4, true), z = dv.getFloat32(b + 8, true);
      // clip coordinates (0x41fe5b): (((C0j*x + C1j*y) + C2j*z) + C3j) * 1.0 + 0.0
      for (let j = 0; j < 4; j++) {
        f[o + j] = E.sum32(C[j] * x, C[4 + j] * y, C[8 + j] * z, C[12 + j]) + 0;
      }
      if (needEye) {
        eye[0] = E.sum32(Em[0] * x, Em[4] * y, Em[8] * z, Em[12]) + 0;
        eye[1] = E.sum32(Em[9] * z, Em[1] * x, Em[5] * y, Em[13]) + 0;
        eye[2] = E.sum32(Em[10] * z, Em[2] * x, Em[6] * y, Em[14]) + 0;
      }
      if (needNormal) {
        const nx = dv.getFloat32(b + nOff, true), ny = dv.getFloat32(b + nOff + 4, true), nz = dv.getFloat32(b + nOff + 8, true);
        nrm[0] = E.sum32x3(Im[2] * nz, Im[0] * nx, Im[1] * ny) + 0;
        nrm[1] = E.sum32x3(Im[6] * nz, Im[4] * nx, Im[5] * ny) + 0;
        nrm[2] = E.sum32x3(Im[10] * nz, Im[8] * nx, Im[9] * ny) + 0;
        if (normalize) normalize3(nrm);
      }
      // point size (0x41ff60)
      if (points) {
        E.ld(eye[2] * eye[2]); E.fadd(eye[1] * eye[1]); E.fadd(eye[0] * eye[0]); E.fsqrt();
        const d = E.st32();
        E.ld(pOff >= 0 ? dv.getFloat32(b + pOff, true) : pointSize);
        if (pointScale) {
          const sh = E.H, sl = E.L;
          E.ld(d * pC); E.fadd(pB); E.fmul(d); E.fadd(pA); E.fdivr(1); E.fsqrt(); E.fmul(st.vp.h >>> 0);
          E.fmulE(sh, sl);
        }
        if (cmpE(E.H, E.L, pMin) < 0) E.ld(pMin);
        if (cmpE(E.H, E.L, pMax) > 0) E.ld(pMax);
        f[o + PSZ] = E.st32();
      }
      // clip codes (0x41bf25) and screen mapping (0x420001)
      const cx = f[o], cy = f[o + 1], cz = f[o + 2], cw = f[o + 3];
      let code = 0, screen = true;
      if (clipping) {
        code = this.clipCode(cx, cy, cz, cw);
        if (code !== 0) { isect &= code; union |= code; } else isect = 0;
        f[o + CODE] = code;
        if (code !== 0 && (code & 0xfffffff0) !== 0) screen = false;
      }
      if (screen) {
        if (!clipping && (bits(cw) & 0x7fffffff) === 0) this.screen(f, o, 2097152, cx, cy, cz);
        else this.screen(f, o, 1 / cw, cx, cy, cz);
      }
      // colours
      let dw = dOff >= 0 ? dv.getUint32(b + dOff, true) : 0xffffffff;
      let sw = sOff >= 0 ? dv.getUint32(b + sOff, true) : 0;
      if (L) { const r = this.light(L, st, lights, fvf, dw, sw, eye, nrm, nOff >= 0, specEnable, sOff >= 0); dw = r[0]; sw = r[1]; }
      unpack(dw, f, o + DIF); unpack(sw, f, o + SPE);
      // texture coordinates (0x4201d7)
      if (!anyTT) {
        for (let t = 0; t < ntex; t++) for (let c = 0; c < tDim[t]; c++) f[o + TEX + t * 4 + c] = dv.getFloat32(b + tOff[t] + c * 4, true);
      } else {
        for (let i = 0; i < stageCount; i++) {
          const src = st.tss[i * 32 + 11] & 0xffff, q = o + TEX + i * 4;
          const dims = src < ntex ? tDim[src] : 0;
          const s4 = [0, 0, 0, 0];
          for (let c = 0; c < dims; c++) s4[c] = dv.getFloat32(b + tOff[src] + c * 4, true);
          if (dims < 4) s4[dims] = 1;
          if ((st.tss[i * 32 + 24] & ~0x100) !== 0) {
            const M = tf(16 + i), [s, t, r, qq] = s4;
            E.ld(qq * M[12]); E.fadd(r * M[8]); E.fadd(t * M[4]); E.fadd(s * M[0]); f[q] = E.st32();
            E.ld(qq * M[13]); E.fadd(t * M[5]); E.fadd(s * M[1]); E.fadd(r * M[9]); f[q + 1] = E.st32();
            E.ld(qq * M[14]); E.fadd(r * M[10]); E.fadd(t * M[6]); E.fadd(s * M[2]); f[q + 2] = E.st32();
            E.ld(qq * M[15]); E.fadd(r * M[11]); E.fadd(t * M[7]); E.fadd(s * M[3]); f[q + 3] = E.st32();
          } else for (let c = 0; c < 4; c++) f[q + c] = s4[c];
        }
      }
    }
    this.isect = clipping ? isect : 0; this.union = clipping ? union : 0;
    if (!clipping) { for (let v = 0; v < n; v++) f[v * ST + CODE] = 0; }
    return out;
  }

  /** screen mapping 0x420001 with 1/w kept at 64 bits: f32((invW * scale) * c + off), rhw = f32(invW). iw is
   *  1/w in double; the 64-bit path recomputes it */
  private screen(f: Float64Array, o: number, iw: number, cx: number, cy: number, cz: number): void {
    const ax = iw * this.scaleX * cx, ay = iw * this.scaleY * cy, az = iw * this.scaleZ * cz;
    const rx = ax + this.offX, ry = ay + this.offY, rz = az + this.offZ;
    const ex = (Math.abs(ax) + Math.abs(this.offX)) * E.EPS, ey = (Math.abs(ay) + Math.abs(this.offY)) * E.EPS;
    const ez = (Math.abs(az) + Math.abs(this.offZ)) * E.EPS, ew = Math.abs(iw) * E.EPS;
    const sx = Math.fround(rx - ex), sy = Math.fround(ry - ey), sz = Math.fround(rz - ez), w = Math.fround(iw - ew);
    if (sx === Math.fround(rx + ex) && sy === Math.fround(ry + ey) && sz === Math.fround(rz + ez) && w === Math.fround(iw + ew)) {
      f[o + SX] = sx; f[o + SY] = sy; f[o + SZ] = sz; f[o + RHW] = w; return;
    }
    let ih: number, il: number;
    if (iw === 2097152) { ih = iw; il = 0; } else { E.ld(1); E.fdiv(f[o + CW]); ih = E.H; il = E.L; }
    E.ldE(ih, il); E.fmul(this.scaleX); E.fmul(cx); E.fadd(this.offX); f[o + SX] = E.st32();
    E.ldE(ih, il); E.fmul(this.scaleY); E.fmul(cy); E.fadd(this.offY); f[o + SY] = E.st32();
    E.ldE(ih, il); E.fmul(this.scaleZ); E.fmul(cz); E.fadd(this.offZ); f[o + SZ] = E.st32();
    f[o + RHW] = E.toF32(ih, il);
  }

  /** ComputeClipCodes 0x41bf25 (guard band always on) */
  clipCode(cx: number, cy: number, cz: number, cw: number): number {
    let c = 0;
    if (signbit(cx)) c |= 1;
    if (signbit(f32d(cw, cx))) c |= 2;
    if (signbit(f32d(cw, cy))) c |= 4;
    if (signbit(cy)) c |= 8;
    if (signbit(cz)) c |= 0x10;
    if (signbit(f32d(cw, cz))) c |= 0x20;
    if (c === 0) return 0;
    E.ld(cx * this.K78); E.fadd(cw * this.K80); const gxh = E.H, gxl = E.L; const gx = E.st32();
    E.ld(cy * this.K7c); E.fadd(cw * this.K84); const gyh = E.H, gyl = E.L; const gy = E.st32();
    if (signbit(gx)) c |= 0x1000;
    E.ld(cw); E.fsubE(gxh, gxl); if (signbit(E.st32())) c |= 0x2000;
    E.ld(cw); E.fsubE(gyh, gyl); if (signbit(E.st32())) c |= 0x4000;
    if (signbit(gy)) c |= 0x8000;
    return c;
  }

  // ---- lighting ----
  private lightSetup(st: State, lights: number[], fvf: number): { lights: Light[]; ambSrc: number; difSrc: number; speSrc: number; emiSrc: number;
    matAmb: number[]; matDif: number[]; matSpe: number[]; matEmi: number[]; ambPre: number[]; rsAmb: number[]; difAlpha: number; speAlpha: number } {
    const rs = st.rs, m = st.mat;
    const m255 = (o: number): number[] => [f32(m[o] * 255), f32(m[o + 1] * 255), f32(m[o + 2] * 255)];
    const matDif = m255(0), matAmb = m255(4), matSpe = m255(8), matEmi = m255(12);
    const alphaDW = (a: number): number => { const v = ftol(a * 255); return a < 0 ? 0 : (v >>> 0) > 255 ? 0xff000000 : (v << 24) >>> 0; };
    const amb = rs[Rs.AMBIENT];
    const rsAmb = [f32(((amb >> 16) & 0xff) * K255), f32(((amb >> 8) & 0xff) * K255), f32((amb & 0xff) * K255)];
    const ambPre = [0, 1, 2].map((c) => fma32(rsAmb[c], matAmb[c], matEmi[c]));
    const power = m[16];
    if (power > f32(0.001)) { E.ld(1); E.fdiv(power); this.specThreshold = f32(Math.pow(0.001, E.H + E.L)); }
    // material sources (only with COLORVERTEX): 1 = vertex diffuse, 2 = vertex specular, 0 = material
    const cv = rs[Rs.COLORVERTEX] !== 0;
    const srcOf = (s: number): number => (!cv ? 0 : s === 1 && (fvf & Fvf.DIFFUSE) ? 1 : s === 2 && (fvf & Fvf.SPECULAR) ? 2 : 0);
    const view = st.tf.get(2) ?? IDENT;
    const ls: Light[] = [];
    for (const idx of lights) {
      const buf = st.lights[idx];
      if (!buf) continue;
      const lf = new Float32Array(buf.slice(0, 104));
      // D3DLIGHT8: Type, Diffuse(4..), Specular(20..), Ambient(36..), Position(52..), Direction(64..)
      const dif = [lf[1], lf[2], lf[3]], spe = [lf[5], lf[6], lf[7]], ambL = [lf[9], lf[10], lf[11]];
      const lm = (lc: number[], mo: number): number[] => [0, 1, 2].map((c) => { E.ld(lc[c] * m[mo + c]); E.fmul(255); return E.st32(); });
      const dx = lf[16], dy = lf[17], dz = lf[18], V = view;
      const d = [0, 0, 0];
      E.ld(V[8] * dz); E.fadd(V[4] * dy); E.fadd(V[0] * dx); d[0] = E.st32();
      E.ld(V[1] * dx); E.fadd(V[9] * dz); E.fadd(V[5] * dy); d[1] = E.st32();
      E.ld(V[2] * dx); E.fadd(V[10] * dz); E.fadd(V[6] * dy); d[2] = E.st32();
      normalize3(d);
      ls.push({ amb: ambL, dif, spe, ambMat: lm(ambL, 4), difMat: lm(dif, 0), speMat: lm(spe, 8), L: [-d[0], -d[1], -d[2]] });
    }
    return { lights: ls, ambSrc: srcOf(rs[Rs.AMBIENTMATERIALSOURCE]), difSrc: srcOf(rs[Rs.DIFFUSEMATERIALSOURCE]),
      speSrc: srcOf(rs[Rs.SPECULARMATERIALSOURCE]), emiSrc: srcOf(rs[Rs.EMISSIVEMATERIALSOURCE]),
      matAmb, matDif, matSpe, matEmi, ambPre, rsAmb, difAlpha: alphaDW(m[3]), speAlpha: alphaDW(m[11]) };
  }

  /** per-vertex lighting 0x42188a + directional light 0x420e02; returns packed diffuse and specular */
  private light(S: ReturnType<VertexProcessor['lightSetup']>, st: State, _l: number[], _fvf: number, dw: number, sw: number,
    eye: number[], n: number[], hasNormal: boolean, specEnable: boolean, hasSpec: boolean): [number, number] {
    const vtx = (c: number): number[] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    const src = (s: number, mat: number[]): number[] => (s === 1 ? vtx(dw) : s === 2 ? vtx(sw) : mat);
    const ambS = src(S.ambSrc, S.matAmb), difS = src(S.difSrc, S.matDif), speS = src(S.speSrc, S.matSpe), emiS = src(S.emiSrc, S.matEmi);
    const acc = S.ambSrc || S.emiSrc ? [0, 1, 2].map((c) => fma32(S.rsAmb[c], ambS[c], emiS[c])) : S.ambPre.slice();
    const spec = [0, 0, 0];
    const power = st.mat[16];
    for (const Lt of S.lights) {
      for (let c = 0; c < 3; c++) acc[c] = S.ambSrc ? fma32(Lt.amb[c], ambS[c], acc[c]) : f32(Lt.ambMat[c] + acc[c]);
      if (!hasNormal) continue;
      const L = Lt.L;
      E.ld(L[2] * n[2]); E.fadd(L[1] * n[1]); E.fadd(L[0] * n[0]);
      const dh = E.H, dl = E.L;
      if (bits(E.st32()) <= 0) continue;
      for (let c = 0; c < 3; c++) {
        if (!S.difSrc) { E.ldE(dh, dl); E.fmul(Lt.difMat[c]); E.fadd(acc[c]); } else { E.ld(Lt.dif[c] * difS[c]); E.fmulE(dh, dl); E.fadd(acc[c]); }
        acc[c] = E.st32();
      }
      if (specEnable) {
        const V = [0, 0, -1];
        if (st.rs[Rs.LOCALVIEWER]) { V[0] = f32(0 - eye[0]); V[1] = f32(0 - eye[1]); V[2] = f32(0 - eye[2]); normalize3(V); }
        const Hv = [f32(V[0] + L[0]), f32(V[1] + L[1]), f32(V[2] + L[2])];
        normalize3(Hv);
        E.ld(Hv[2] * n[2]); E.fadd(Hv[1] * n[1]); E.fadd(Hv[0] * n[0]);
        const d = E.st32();
        if (bits(d) <= 0 || bits(d) < bits(this.specThreshold)) continue;
        const p = Math.pow(d, power);   // msvcrt _CIpow (ext result)
        for (let c = 0; c < 3; c++) {
          if (!S.speSrc) { E.ld(p); E.fmul(Lt.speMat[c]); E.fadd(spec[c]); } else { E.ld(Lt.spe[c] * speS[c]); E.fmul(p); E.fadd(spec[c]); }
          spec[c] = E.st32();
        }
      }
    }
    const pack = (a: number[]): number => {
      let r = 0;
      for (let c = 0; c < 3; c++) { let v = rint(a[c]); v = v < 0 ? 0 : v > 255 ? 255 : v; r = r * 256 + v; }
      return r;
    };
    const difA = S.difSrc === 1 ? dw & 0xff000000 : S.difSrc === 2 ? sw & 0xff000000 : S.difAlpha;
    const speA = S.speSrc === 1 ? dw & 0xff000000 : S.speSrc === 2 ? sw & 0xff000000 : S.speAlpha;
    const outD = (pack(acc) + difA) >>> 0;
    const outS = specEnable ? (pack(spec) + speA) >>> 0 : hasSpec ? sw >>> 0 : speA >>> 0;
    return [outD, outS];
  }
}

const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const f32v = (u: number): number => { I1[0] = u; return F1[0]; };
/** f32(a - b) of two floats (ext difference, one rounding: exact in double then rounded once) */
const f32d = (a: number, b: number): number => f32(a - b);
/** f32(a*b + c) with a*b exact in double, the sum at 64 bits */
function fma32(a: number, b: number, c: number): number { E.ld(a * b); E.fadd(c); return E.st32(); }
/** compare a 64-bit value with a double */
function cmpE(h: number, l: number, x: number): number { return h < x ? -1 : h > x ? 1 : l < 0 ? -1 : l > 0 ? 1 : 0; }
/** FISTP: round to nearest even */
function rint(x: number): number { const fl = Math.floor(x), d = x - fl; return d < 0.5 ? fl : d > 0.5 ? fl + 1 : (fl % 2 === 0 ? fl : fl + 1); }
/** D3DCOLOR -> RGBA floats (0x406787): byte * f32(1/255), one rounding */
export function unpack(c: number, f: Float64Array, o: number): void {
  f[o] = f32(((c >>> 16) & 0xff) * K255); f[o + 1] = f32(((c >>> 8) & 0xff) * K255); f[o + 2] = f32((c & 0xff) * K255); f[o + 3] = f32((c >>> 24) * K255);
}
/** FVF texcoord set dimension (TEXCOORDSIZE bits: 0 -> 2, 1 -> 3, 2 -> 4, 3 -> 1) */
export function texDims(fvf: number, set: number): number { return [2, 3, 4, 1][(fvf >>> (16 + 2 * set)) & 3]; }
