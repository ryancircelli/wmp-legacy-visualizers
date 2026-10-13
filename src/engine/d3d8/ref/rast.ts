// REF's rasterizer (RefRast, RD+0x12b18): triangle setup and culling (0x414000), top-left edge tests in 28.4 fixed
// point (0x418cc8 / 0x418d87), 2x2-quad scan anchored at the bounding box (0x418ac0), perspective-correct attribute
// planes (0x4183aa / 0x418148), texture sampling through the legacy pixel-shader micro-code (0x41ab11: LOD 0x413920,
// texel lists 0x412f97, fetch 0x4134f2), texture stage blending (0x41a4b2), and the pixel operations (0x419f5d):
// alpha test, D16 depth, alpha blending, the colour write. Points: DrawPoint 0x411209. All x87 work at 64 bits (./ext).
import { Fmt, Rs } from '../api';
import type { RefSurface, RefTexture, State } from '../ref';
import * as E from './ext';
import { f32, ftol } from './num';
import { DIF, type OutFvf, PSZ, RHW, SPE, SX, SY, SZ, TEX, K255 } from './vp';

const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return I1[0]; };
const fromBits = (u: number): number => { U1[0] = u >>> 0; return F1[0]; };
/** 1/255 as a double (0x402e48) */
const INV255D = 1 / 255;
/** truncate a 64-bit value (h, l) toward zero */
function truncE(h: number, l: number): number {
  const t = Math.trunc(h);
  if (t !== h || l === 0) return t;
  return h > 0 ? (l < 0 ? t - 1 : t) : (l > 0 ? t + 1 : t);
}
/** f32(a + b) at 64 bits, for doubles a, b */
function add32(a: number, b: number): number {
  const s = a + b;
  if (s - a === b && s - b === a) return f32(s);   // exact in double
  E.ld(a); E.fadd(b); return E.st32();
}
function clamp01(v: number): number { return v > 1 ? 1 : v >= 0 ? v : 0; }

/** a vertex reference: array + offset of a TL vertex */
export interface V { f: Float64Array; o: number }

/** per-stage texture state decoded for a draw */
interface Stage {
  tex: RefTexture | null; set: number; dims: number;
  minF: number; magF: number; mipF: number; needLod: number; bias: number; maxMip: number;
  addrU: number; addrV: number;
}

/** an attribute plane (A d/dx, B d/dy, C) per component */
class Plane { A = new Float64Array(4); B = new Float64Array(4); C = new Float64Array(4); flat = false; }

export class Rasterizer {
  // setup
  private X = new Int32Array(3); private Y = new Int32Array(3);
  private fX0 = 0; private fY0 = 0; private dX10 = 0; private dX02 = 0; private dY01 = 0; private dY20 = 0;
  private invDet = 0; private invDetH = 0; private invDetL = 0; private det = 0;
  private xmin = 0; private xmax = 0; private ymin = 0; private ymax = 0;
  private Arhw = 0; private Brhw = 0; private Crhw = 0;
  private eA = new Float64Array(4); private eB = new Float64Array(4); private eC = new Float64Array(4); private eI = new Uint8Array(4); private nEdges = 3;
  private pz = new Plane(); private pd = new Plane(); private ps = new Plane(); private pt: Plane[] = Array.from({ length: 8 }, () => new Plane());
  /** rotation code of the setup vertex order (R+8): which rotated vertex is the original first */
  private rot = 0;
  // per draw
  st!: State; rt!: RefSurface; ds: RefSurface | null = null; clip = { l: 0, t: 0, r: 0, b: 0 };
  out!: OutFvf; stages: Stage[] = []; nStages = 0;
  sprite = false;
  // per quad scratch
  private W = new Float64Array(4); private cov = new Uint8Array(4);
  private tu = new Float64Array(8 * 4); private tv = new Float64Array(8 * 4);
  private texc = new Float64Array(8 * 4 * 4);
  private dif = new Float64Array(4); private spe = new Float64Array(4);
  private cur = new Float64Array(4); private res = new Float64Array(4); private tmp = new Float64Array(4);
  private a1 = new Float64Array(4); private a2 = new Float64Array(4); private a0 = new Float64Array(4);

  /** per-draw state (RefRast's lazy update 0x40b9ae, active stages 0x40e0fd, filter decode 0x412c0d) */
  begin(st: State, rt: RefSurface, ds: RefSurface | null, out: OutFvf, nStages: number): void {
    this.st = st; this.rt = rt; this.ds = ds; this.out = out; this.nStages = nStages;
    const vp = st.vp;
    this.clip = { l: vp.x, t: vp.y, r: vp.x + vp.w - 1, b: vp.y + vp.h - 1 };
    this.stages = [];
    for (let i = 0; i < nStages; i++) {
      const t = st.tss, b = i * 32;
      const mn = t[b + 17] === 2 ? 2 : t[b + 17] === 3 ? 3 : 1;
      const mg = t[b + 16] === 2 || t[b + 16] === 4 || t[b + 16] === 5 ? 2 : t[b + 16] === 3 ? 3 : 1;
      const mp = t[b + 18] === 1 ? 1 : t[b + 18] === 2 ? 2 : 0;
      const tex = st.tex[i];
      this.stages.push({
        tex, set: out.texSet[i], dims: out.texDims[i], minF: mn, magF: mg, mipF: mp,
        needLod: mg === mn && mp === 0 ? 0 : mg === 3 ? 3 : 2, bias: fromBits(t[b + 19]), maxMip: t[b + 20],
        addrU: t[b + 13], addrV: t[b + 14],
      });
    }
  }

  // ---- triangles ----
  /** DrawTriangle 0x4114c7 */
  triangle(v0: V, v1: V, v2: V): void {
    // rotate: the vertex with the smallest x (then y) first
    let best = 0; const vs = [v0, v1, v2];
    for (let u = 1; u < 3; u++) {
      const a = vs[u], b = vs[best];
      if (a.f[a.o + SX] < b.f[b.o + SX] || (a.f[a.o + SX] === b.f[b.o + SX] && a.f[a.o + SY] < b.f[b.o + SY])) best = u;
    }
    let r0 = v0, r1 = v1, r2 = v2;
    if (best === 1) { r0 = v1; r1 = v2; r2 = v0; this.rot = 2; } else if (best === 2) { r0 = v2; r1 = v0; r2 = v1; this.rot = 1; } else this.rot = 0;
    if (this.setup(r0, r1, r2, this.st.rs[Rs.CULLMODE])) return;
    if (this.st.rs[Rs.FILLMODE] !== 3) throw new Error('RefDevice: only FILLMODE SOLID is implemented');
    const flip = this.det > 0;
    this.edge(0, flip, this.X[0], this.Y[0], this.X[1], this.Y[1]);
    this.edge(1, flip, this.X[1], this.Y[1], this.X[2], this.Y[2]);
    this.edge(2, flip, this.X[2], this.Y[2], this.X[0], this.Y[0]);
    this.nEdges = 3;
    this.attributes(r0, r1, r2, v0, v1, v2);
    this.scan();
  }

  /** setup 0x414000: snap, determinant, cull, bounding box, rhw plane; true = dropped */
  private setup(a: V, b: V, c: V, cull: number): boolean {
    const vs = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const v = vs[i];
      this.X[i] = snap(v.f[v.o + SX]); this.Y[i] = snap(v.f[v.o + SY]);
    }
    const [X0, X1, X2] = this.X, [Y0, Y1, Y2] = this.Y;
    const det = (Y2 - Y0) * (X1 - X0) - (Y0 - Y1) * (X0 - X2);
    this.det = det;
    if (det === 0 || (cull === 2 && det > 0) || (cull === 3 && det < 0)) return true;
    const xs = [a.f[a.o + SX], b.f[b.o + SX], c.f[c.o + SX]], ys = [a.f[a.o + SY], b.f[b.o + SY], c.f[c.o + SY]];
    const mnx = Math.min(xs[0], xs[1], xs[2]), mxx = Math.max(xs[0], xs[1], xs[2]);
    const mny = Math.min(ys[0], ys[1], ys[2]), mxy = Math.max(ys[0], ys[1], ys[2]);
    this.bbox(mnx, mxx, mny, mxy);
    this.fX0 = X0 * 0.0625; this.fY0 = Y0 * 0.0625;
    this.dX10 = (X1 - X0) * 0.0625; this.dX02 = (X0 - X2) * 0.0625; this.dY01 = (Y0 - Y1) * 0.0625; this.dY20 = (Y2 - Y0) * 0.0625;
    E.ld(det * 0.00390625); E.fdivr(1); this.invDetH = E.H; this.invDetL = E.L; this.invDet = E.st32();
    // rhw plane (0x414355)
    const w0 = a.f[a.o + RHW], w1 = b.f[b.o + RHW], w2 = c.f[c.o + RHW];
    E.ld(w1); E.fsub(w0); const d1 = E.st32();
    E.ld(w2); E.fsub(w0); const d2h = E.H, d2l = E.L;
    E.ldE(d2h, d2l); E.fmul(this.dY01); E.fadd(this.dY20 * d1); E.fmulE(this.invDetH, this.invDetL);
    this.Arhw = E.st32();
    E.ldE(d2h, d2l); E.fmul(this.dX10); E.fadd(this.dX02 * d1); E.fmulE(this.invDetH, this.invDetL);
    const bh = E.H, bl = E.L; this.Brhw = E.st32();
    E.ld(this.Arhw * this.fX0); E.fsubr(w0); const ch = E.H, cl = E.L;
    E.ldE(bh, bl); E.fmul(this.fY0); E.ldE(-E.H, -E.L); E.faddE(ch, cl);
    this.Crhw = E.st32();
    return false;
  }

  private bbox(mnx: number, mxx: number, mny: number, mxy: number): void {
    const c = this.clip;
    this.xmin = Math.max(ftol(mnx + 0.5), c.l); this.xmax = Math.min(ftol(mxx + 0.5), c.r);
    this.ymin = Math.max(ftol(mny + 0.5), c.t); this.ymax = Math.min(ftol(mxy + 0.5), c.b);
  }

  /** edge 0x418cc8 */
  private edge(k: number, flip: boolean, xa: number, ya: number, xb: number, yb: number): void {
    let A = ya - yb, B = xb - xa;
    if (flip) { A = -A; B = -B; }
    this.eA[k] = A; this.eB[k] = B; this.eC[k] = -(B * ya + A * xa);
    this.eI[k] = (A !== 0 ? A > 0 : B > 0) ? 1 : 0;
  }

  /** attribute setup 0x410f7d (a, b, c rotated; o0..o2 the original order for flat shading) */
  private attributes(a: V, b: V, c: V, o0: V, _o1: V, _o2: V): void {
    const st = this.st, rs = st.rs;
    const w = [a.f[a.o + RHW], b.f[b.o + RHW], c.f[c.o + RHW]];
    const ONE = [1, 1, 1];
    if (rs[Rs.ZENABLE]) this.plane(this.pz, 0, a.f[a.o + SZ], b.f[b.o + SZ], c.f[c.o + SZ], ONE);
    const flat = rs[Rs.SHADEMODE] === 1;
    // colours: bytes trunc(c*255) back to floats byte * (1/255 as a double)
    const col = (v: V, base: number, has: boolean, dflt: number, k: number): number => {
      if (!has) return f32(((dflt >>> [16, 8, 0, 24][k]) & 0xff) * INV255D);
      return f32((ftol(v.f[v.o + base + k] * 255) & 0xff) * INV255D);
    };
    const doSpec = rs[Rs.SPECULARENABLE] !== 0;
    for (let k = 0; k < 4; k++) {
      if (flat) {
        this.pd.flat = true; this.pd.C[k] = col(o0, DIF, this.out.diffuse, 0xffffffff, k);
        if (doSpec) { this.ps.flat = true; this.ps.C[k] = col(o0, SPE, this.out.specular, 0, k); }
      } else {
        this.pd.flat = false;
        this.plane(this.pd, k, col(a, DIF, this.out.diffuse, 0xffffffff, k), col(b, DIF, this.out.diffuse, 0xffffffff, k), col(c, DIF, this.out.diffuse, 0xffffffff, k), w);
        if (doSpec) { this.ps.flat = false; this.plane(this.ps, k, col(a, SPE, this.out.specular, 0, k), col(b, SPE, this.out.specular, 0, k), col(c, SPE, this.out.specular, 0, k), w); }
      }
    }
    // texture coordinates
    for (let i = 0; i < this.nStages; i++) {
      const s = this.stages[i];
      if (!s.tex) continue;
      const p = this.pt[i];
      if (this.sprite) {
        this.plane(p, 0, 0, 1, 0, w); this.plane(p, 1, 0, 0, 1, w);
      } else {
        const tc = (v: V, k: number): number => (k < s.dims ? v.f[v.o + TEX + s.set * 4 + k] : 0);
        this.plane(p, 0, tc(a, 0), tc(b, 0), tc(c, 0), w);
        this.plane(p, 1, tc(a, 1), tc(b, 1), tc(c, 1), w);
      }
    }
  }

  /** one component's plane 0x4183aa */
  private plane(p: Plane, i: number, a0: number, a1: number, a2: number, w: number[]): void {
    // fast path: doubles with error bounds (see evalW); the products w*a are exact
    {
      const p0 = w[0] * a0, x1 = w[1] * a1, x2 = w[2] * a2;
      const d1d = x1 - p0, d2 = x2 - p0, e1 = (Math.abs(x1) + Math.abs(p0)) * EPS;
      const d1 = Math.fround(d1d - e1);
      if (d1 === Math.fround(d1d + e1)) {
        const iv = this.invDet;
        // d2 is the 64-bit E(x2 - p0) to within (|x2| + |p0|) * 2^-53: carried in the bounds
        const e2 = (Math.abs(x2) + Math.abs(p0)) * EPS;
        const ta = d2 * this.dY01, tb = d1 * this.dY20;
        const ra = (ta + tb) * iv, ea = ((Math.abs(ta) + Math.abs(tb)) * EPS + e2 * Math.abs(this.dY01)) * Math.abs(iv);
        const A = Math.fround(ra - ea);
        if (A === Math.fround(ra + ea)) {
          const tc = d2 * this.dX10, td = d1 * this.dX02;
          const rb = (tc + td) * iv, eb = ((Math.abs(tc) + Math.abs(td)) * EPS + e2 * Math.abs(this.dX10)) * Math.abs(iv);
          const B = Math.fround(rb - eb);
          if (B === Math.fround(rb + eb)) {
            const pf = Math.fround(p0), u = this.fX0 * A, v = rb * this.fY0;
            const rc = pf - u - v, ec = (Math.abs(pf) + Math.abs(u) + Math.abs(v)) * EPS + eb * Math.abs(this.fY0);
            const C = Math.fround(rc - ec);
            if (C === Math.fround(rc + ec)) { p.A[i] = A; p.B[i] = B; p.C[i] = C; return; }
          }
        }
      }
    }
    E.ld(w[0] * a0); const p0h = E.H, p0l = E.L; const p0 = E.st32();
    E.ld(w[1] * a1); E.fsubE(p0h, p0l); const d1 = E.st32();
    E.ld(w[2] * a2); E.fsubE(p0h, p0l); const d2h = E.H, d2l = E.L;
    E.fmul(this.dY01); E.fadd(d1 * this.dY20); E.fmul(this.invDet); const A = E.st32();
    E.ldE(d2h, d2l); E.fmul(this.dX10); E.fadd(d1 * this.dX02); E.fmul(this.invDet); const bh = E.H, bl = E.L; const B = E.st32();
    E.ld(this.fX0 * A); E.fsubr(p0); const ch = E.H, cl = E.L;
    E.ldE(bh, bl); E.fmul(this.fY0); E.ldE(-E.H, -E.L); E.faddE(ch, cl);
    p.A[i] = A; p.B[i] = B; p.C[i] = E.st32();
  }

  /** plane value at (x, y) at 64 bits, left in E.H / E.L */
  private static evalE(p: Plane, i: number, x: number, y: number): void { E.ld(x * p.A[i]); E.fadd(y * p.B[i]); E.fadd(p.C[i]); }

  /** scan 0x418ac0 */
  private scan(): void {
    for (let y = this.ymin; y <= this.ymax; y += 2) {
      for (let x = this.xmin; x <= this.xmax; x += 2) {
        let any = 0;
        for (let k = 0; k < 4; k++) {
          const px = x + (k & 1), py = y + (k >> 1);
          let inn = px <= this.xmax && py <= this.ymax;
          for (let e = 0; inn && e < this.nEdges; e++) {
            const v = this.eA[e] * px * 16 + this.eB[e] * py * 16 + this.eC[e];
            inn = v < 0 || (v === 0 && this.eI[e] === 0);
          }
          this.cov[k] = inn ? 1 : 0; any |= this.cov[k];
        }
        if (any) this.quad(x, y);
      }
    }
  }

  /** a quad 0x4188d8 + 0x41ab11 + 0x419f5d */
  private quad(x: number, y: number): void {
    const st = this.st, rs = st.rs;
    for (let k = 0; k < 4; k++) {
      const xf = x + (k & 1), yf = y + (k >> 1);
      this.W[k] = recip(xf * this.Arhw, yf * this.Brhw, this.Crhw);
    }
    // texture coordinates for all 4 pixels, then sample
    for (let i = 0; i < this.nStages; i++) {
      const s = this.stages[i];
      if (!s.tex) continue;
      const p = this.pt[i];
      for (let k = 0; k < 4; k++) {
        const xf = x + (k & 1), yf = y + (k >> 1);
        this.tu[i * 4 + k] = evalW(xf * p.A[0], yf * p.B[0], p.C[0], this.W[k]);
        this.tv[i * 4 + k] = evalW(xf * p.A[1], yf * p.B[1], p.C[1], this.W[k]);
      }
      this.sample(i, s);
    }
    const zOn = rs[Rs.ZENABLE] !== 0 && this.ds !== null;
    for (let k = 0; k < 4; k++) {
      if (!this.cov[k]) continue;
      const px = x + (k & 1), py = y + (k >> 1);
      let zq = 0;
      if (zOn) {
        zq = depth16(px * this.pz.A[0], py * this.pz.B[0], this.pz.C[0]);
      }
      this.color(this.pd, this.dif, px, py, k);
      if (rs[Rs.SPECULARENABLE]) this.color(this.ps, this.spe, px, py, k);
      this.pixel(px, py, k, zq, zOn);
    }
  }

  private color(p: Plane, out: Float64Array, x: number, y: number, k: number): void {
    for (let i = 0; i < 4; i++) {
      if (p.flat) out[i] = clamp01(p.C[i]);
      else out[i] = clamp01(evalW(x * p.A[i], y * p.B[i], p.C[i], this.W[k]));
    }
  }

  // ---- texture sampling ----
  private sample(i: number, s: Stage): void {
    const tex = s.tex!;
    const u = this.tu, v = this.tv, b = i * 4;
    let levels = 1, l0 = 0, l1 = 0, w0 = 1, w1 = 0, mag = false;
    let filt = s.minF;
    if (s.needLod) {
      const W0 = tex.width, H0 = tex.height;
      const g0 = f32(W0 * f32(u[b + 1] - u[b])), g1 = f32(W0 * f32(u[b + 2] - u[b]));
      const g2 = f32(H0 * f32(v[b + 1] - v[b])), g3 = f32(H0 * f32(v[b + 2] - v[b]));
      lenE(g0, g2); const Lx = E.st32();
      lenE(g1, g3); const lyh = E.H, lyl = E.L;
      const m = (Lx > lyh || (Lx === lyh && 0 > lyl)) ? Lx : E.toF32(lyh, lyl);
      const lod = f32((bits(m) - 0x3f800000) * 1.1920928955078125e-7);
      E.ld(s.bias); E.fadd(lod); E.fadd(393216);
      const iLOD = (bits(E.st32()) << 16) >> 16;
      mag = iLOD <= 0;
      filt = mag ? s.magF : s.minF;
      const base = s.maxMip >>> 0, maxL = tex.levels - 1;
      const cl = (l: number): number => Math.min(Math.max(l, base), maxL);
      if (mag || s.mipF === 0) l0 = Math.min(Math.max(0, base), maxL);
      else if (s.mipF === 1) l0 = cl((iLOD + 16) >> 5);
      else {
        l0 = cl(iLOD >> 5); l1 = cl((iLOD >> 5) + 1);
        if (l0 !== l1 && (iLOD & 31) !== 0) { levels = 2; w1 = f32((iLOD & 31) * 0.03125); w0 = f32(1 - w1); }
      }
    }
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 4, out = this.texc;
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
      for (let l = 0; l < levels; l++) {
        const L = l === 0 ? l0 : l1, lw = l === 0 ? w0 : w1;
        const m = tex.mips[L], N = m.width, M = m.height;
        if (filt === 2) {
          const nu = linCoord(u[b + k], N), nv = linCoord(v[b + k], M);
          const iu = nu >> 5, iv = nv >> 5;
          const fu = f32((nu & 31) * 0.03125), fv = f32((nv & 31) * 0.03125), ou = f32(1 - fu), ov = f32(1 - fv);
          this.acc(out, o, m, iu, iv, s, f32(ov * ou * lw));
          this.acc(out, o, m, iu + 1, iv, s, f32(ov * fu * lw));
          this.acc(out, o, m, iu + 1, iv + 1, s, f32(fv * fu * lw));
          this.acc(out, o, m, iu, iv + 1, s, f32(ou * fv * lw));
        } else {
          this.acc(out, o, m, pointCoord(u[b + k], N), pointCoord(v[b + k], M), s, lw);
        }
      }
    }
  }

  /** fetch + address + accumulate one sample 0x4134f2 */
  private acc(out: Float64Array, o: number, m: RefSurface, iu: number, iv: number, s: Stage, w: number): void {
    if (w === 0) return;
    const N = m.width, M = m.height;
    iu = address(iu, N, s.addrU); iv = address(iv, M, s.addrV);
    const d = m.data, p = iv * m.pitch;
    let r: number, g: number, b: number, a: number;
    if (m.format === Fmt.A4R4G4B4) {
      const q = p + iu * 2, wd = d[q] | (d[q + 1] << 8);
      r = f32(((wd >> 8) & 15) * K15); g = f32(((wd >> 4) & 15) * K15); b = f32((wd & 15) * K15); a = f32((wd >> 12) * K15);
    } else {
      const q = p + iu * 4;
      b = f32(d[q] * K255); g = f32(d[q + 1] * K255); r = f32(d[q + 2] * K255);
      a = m.format === Fmt.X8R8G8B8 ? 1 : f32(d[q + 3] * K255);
    }
    out[o] = add32(r * w, out[o]); out[o + 1] = add32(g * w, out[o + 1]); out[o + 2] = add32(b * w, out[o + 2]); out[o + 3] = add32(a * w, out[o + 3]);
  }

  // ---- pixel ----
  private pixel(px: number, py: number, k: number, zq: number, zOn: boolean): void {
    const st = this.st, rs = st.rs, tss = st.tss;
    const cur = this.cur, res = this.res;
    cur.set(this.dif);
    const T = this.tmp; T[0] = 0; T[1] = 0; T[2] = 0; T[3] = 0;
    for (let c = 0; c < this.nStages; c++) {
      const b = c * 32, op = tss[b + 1];
      if (op === 1) break;
      if (op === 22 || op === 23) continue;
      const to = (c * 4 + k) * 4, tx = this.texc;
      const texA = this.stages[c].tex ? tx[to + 3] : 1;
      const tex = this.texv;
      if (this.stages[c].tex) { tex[0] = tx[to]; tex[1] = tx[to + 1]; tex[2] = tx[to + 2]; tex[3] = tx[to + 3]; } else { tex[0] = 0; tex[1] = 0; tex[2] = 0; tex[3] = 1; }
      this.arg(tss[b + 2], tex, this.a1); this.arg(tss[b + 3], tex, this.a2); this.arg(tss[b + 26], tex, this.a0);
      res[0] = 0; res[1] = 0; res[2] = 0; res[3] = 1;
      for (let ch = 0; ch < 3; ch++) res[ch] = colorOp(op, this.a1[ch], this.a2[ch], this.a0[ch], this.dif[3], texA, cur[3], rs[Rs.TEXTUREFACTOR]);
      const aop = tss[b + 4];
      const al1 = this.argA(tss[b + 5], tex), al2 = this.argA(tss[b + 6], tex);
      res[3] = alphaOp(aop, al1, al2, this.a1[3], this.a2[3], this.a0[3], this.dif[3], texA, cur[3], rs[Rs.TEXTUREFACTOR]);
      for (let ch = 0; ch < 4; ch++) res[ch] = clamp01(res[ch]);
      if (tss[b + 28] === 5) T.set(res); else cur.set(res);
    }
    const c = cur;
    if (rs[Rs.SPECULARENABLE]) {
      for (let ch = 0; ch < 3; ch++) c[ch] = add32(c[ch], this.spe[ch]);
      for (let ch = 0; ch < 4; ch++) if (c[ch] > 1) c[ch] = 1;
    }
    if (rs[Rs.ALPHATESTENABLE]) {
      const a8 = ftol(c[3] * 255) & 0xff, ref = rs[Rs.ALPHAREF] & 0xff;
      if (!cmpFunc(rs[Rs.ALPHAFUNC], a8, ref)) return;
    }
    // depth test
    const ds = this.ds;
    let zo = 0;
    if (zOn && ds) {
      zo = py * (ds.pitch >> 1) + px;
      const zd = ds.data[zo * 2] | (ds.data[zo * 2 + 1] << 8);
      if (!cmpFunc(rs[Rs.ZFUNC], zq, zd)) return;
    }
    const rt = this.rt, ro = py * rt.pitch + px * 4, d = rt.data;
    const cwe = rs[Rs.COLORWRITEENABLE] & 0xf;
    if (cwe !== 0xf || rs[Rs.ALPHABLENDENABLE]) {
      const dst = this.dstv;
      dst[0] = f32(d[ro + 2] * K255); dst[1] = f32(d[ro + 1] * K255); dst[2] = f32(d[ro] * K255); dst[3] = rt.format === Fmt.X8R8G8B8 ? 1 : f32(d[ro + 3] * K255);
      if (rs[Rs.ALPHABLENDENABLE]) blend(rs[Rs.SRCBLEND], rs[Rs.DESTBLEND], rs[Rs.BLENDOP], c, dst);
      if (!(cwe & 1)) c[0] = dst[0];
      if (!(cwe & 2)) c[1] = dst[1];
      if (!(cwe & 4)) c[2] = dst[2];
      if (!(cwe & 8)) c[3] = dst[3];
    }
    // WritePixel 0x40d7ae (dither off: offset 0.5)
    const off = rs[Rs.DITHERENABLE] ? DITHER[((px & 3) << 2) | (py & 3)] : 0.5;
    d[ro] = ftol(c[2] * 255 + off); d[ro + 1] = ftol(c[1] * 255 + off); d[ro + 2] = ftol(c[0] * 255 + off);
    d[ro + 3] = rt.format === Fmt.X8R8G8B8 ? 0 : ftol(c[3] * 255 + off);
    if (zOn && ds && rs[Rs.ZWRITEENABLE]) { ds.data[zo * 2] = zq & 0xff; ds.data[zo * 2 + 1] = zq >> 8; }
  }

  /** colour argument 0x41a419 */
  private texv = new Float64Array(4); private dstv = new Float64Array(4);
  private arg(a: number, tex: Float64Array, out: Float64Array): void {
    this.argSrc(a & 0xf, tex, out);
    if (a & 0x10) for (let i = 0; i < 4; i++) out[i] = f32(1 - out[i]);
    if (a & 0x20) { out[0] = out[3]; out[1] = out[3]; out[2] = out[3]; }
  }
  private argA(a: number, tex: Float64Array): number {
    this.argSrc(a & 0xf, tex, this.a0tmp);
    let v = this.a0tmp[3];
    if (a & 0x10) v = f32(1 - v);
    return v;
  }
  private a0tmp = new Float64Array(4);
  private argSrc(sel: number, tex: Float64Array, out: Float64Array): void {
    switch (sel) {
      case 0: out.set(this.dif); break;
      case 1: out.set(this.cur); break;
      case 2: out[0] = tex[0]; out[1] = tex[1]; out[2] = tex[2]; out[3] = tex[3]; break;
      case 3: { const t = this.st.rs[Rs.TEXTUREFACTOR]; out[0] = f32(((t >>> 16) & 0xff) * K255); out[1] = f32(((t >>> 8) & 0xff) * K255); out[2] = f32((t & 0xff) * K255); out[3] = f32((t >>> 24) * K255); break; }
      case 4: out.set(this.spe); break;
      case 5: out.set(this.tmp); break;
      default: out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
    }
  }

  // ---- points ----
  /** DrawPoint 0x411209 */
  point(v: V): void {
    const rs = this.st.rs, f = v.f, o = v.o;
    let size = this.out.psize ? f[o + PSZ] : fromBits(rs[Rs.POINTSIZE]);
    const mn = fromBits(rs[Rs.POINTSIZE_MIN]), mxr = fromBits(rs[Rs.POINTSIZE_MAX]);
    if (size < mn) size = mn;
    const m = 64 <= mxr ? 64 : mxr;
    if (m < size) size = m;
    E.ld(size); E.fmul(0.5); const hh = E.H, hl = E.L;
    const x = f[o + SX], y = f[o + SY];
    E.ld(x); E.faddE(hh, hl); const xR = E.st32();
    E.ld(y); E.faddE(hh, hl); const yB = E.st32();
    E.ld(x); E.fsubE(hh, hl); const xL = E.st32();
    E.ld(y); E.fsubE(hh, hl); const yT = E.st32();
    const c0 = this.corner(v, xL, yT), c1 = this.corner(v, xR, yT), c2 = this.corner(v, xL, yB);
    this.sprite = rs[Rs.POINTSPRITEENABLE] !== 0;
    this.rot = 0;
    if (!this.setup(c0, c1, c2, 1)) {
      const X3 = snap(xR), Y3 = snap(yB);
      const flip = this.det > 0;
      this.edge(0, flip, this.X[0], this.Y[0], this.X[1], this.Y[1]);
      this.edge(1, flip, this.X[1], this.Y[1], X3, Y3);
      this.edge(2, flip, X3, Y3, this.X[2], this.Y[2]);
      this.edge(3, flip, this.X[2], this.Y[2], this.X[0], this.Y[0]);
      this.nEdges = 4;
      this.attributes(c0, c1, c2, c0, c1, c2);
      this.scan();
    }
    this.sprite = false;
  }
  private cornerBuf = [new Float64Array(64), new Float64Array(64), new Float64Array(64)]; private ci = 0;
  private corner(v: V, x: number, y: number): V {
    const b = this.cornerBuf[this.ci++ % 3];
    b.set(v.f.subarray(v.o, v.o + 52));
    b[SX] = x; b[SY] = y;
    return { f: b, o: 0 };
  }
}

const K15 = f32(1 / 15);   // 0x3d888889
const DITHER = [0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625, 0.21875, 0.71875, 0.09375, 0.59375,
  0.96875, 0.46875, 0.84375, 0.34375];

// ---- per-pixel plane arithmetic: computed in doubles, checked against an error bound that covers both the
// double and the x87's 64-bit evaluation, and redone at 64 bits only when the result is too close to a rounding
// boundary to tell (rare) ----
const EPS = 8.881784197001252e-16;   // 2^-50
/** f32( E(E(a + b) + c) * W ) with a, b exact products */
function evalW(a: number, b: number, c: number, w: number): number {
  const r = (a + b + c) * w, e = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * Math.abs(w) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  E.ld(a); E.fadd(b); E.fadd(c); E.fmul(w); return E.st32();
}
/** f32( 1 / E(E(a + b) + c) ), 0 when the denominator is 0 (0x413a70) */
function recip(a: number, b: number, c: number): number {
  const s = a + b + c, d = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  if (Math.abs(s) > 4 * d) {
    const r = 1 / s, e = Math.abs(r) * (2 * d / Math.abs(s) + EPS);
    const lo = Math.fround(r - e);
    if (lo === Math.fround(r + e)) return lo;
  }
  E.ld(a); E.fadd(b); E.fadd(c);
  if (E.H === 0 && E.L === 0) return 0;
  E.fdivr(1); return E.st32();
}
/** the D16 value of z = f64(E(E(a + b) + c)): trunc(E(clamp01(z) * 65535) + 0.5) (0x41821c, 0x418849) */
function depth16(a: number, b: number, c: number): number {
  const z = a + b + c, d = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  if (z - d > 0 && z + d < 1) {
    const v = z * 65535 + 0.5, e = d * 65536 + v * EPS;
    const q = Math.floor(v - e);
    if (q === Math.floor(v + e)) return q;
  }
  E.ld(a); E.fadd(b); E.fadd(c);
  E.ld(clamp01(E.st64())); E.fmul(65535); E.fadd(0.5);
  return truncE(E.H, E.L);
}

/** snap to 28.4: f32(x + 786432f) and its low 22 mantissa bits, sign-extended */
function snap(x: number): number { E.ld(x); E.fadd(786432); return (bits(E.st32()) << 10) >> 10; }
/** len(a, b) 0x418fb5 = E(E(E(|a|+|b|) * 0.34375) + E(max(|a|,|b|) * 0.65625)), left in E.H / E.L */
function lenE(a: number, b: number): void {
  const x = Math.abs(a), y = Math.abs(b);
  E.ld(x); E.fadd(y); E.fmul(0.34375); const h = E.H, l = E.L;
  E.ld(Math.max(x, y) * 0.65625); E.faddE(h, l);
}
/** point-sampled texel index 0x41280d */
function pointCoord(c: number, size: number): number {
  const t = c * size - 0.5;
  return ftol(c < 0 ? t - 0.5 : t + 0.5);
}
/** bilinear coordinate 0x412ec6: rint(32 * (c*size - 0.5)) as the signed 22-bit field of f32(... + 393216) */
function linCoord(c: number, size: number): number {
  const p = c * size, t = (p - 0.5) + 393216, e = (Math.abs(p) + 393217) * EPS;
  const r = Math.fround(t - e);
  if (r === Math.fround(t + e)) return (bits(r) << 10) >> 10;
  E.ld(p); E.fsub(0.5); E.fadd(393216);
  return (bits(E.st32()) << 10) >> 10;
}
function address(i: number, n: number, mode: number): number {
  if (i >= 0 && i <= n - 1) return i;
  switch (mode) {
    case 3: return i < 0 ? 0 : n - 1;
    case 2: { if (i < 0) i = -1 - i; const r = i % n; return (Math.trunc(i / n) & 1) ? n - 1 - r : r; }
    case 5: if (i < 0) i = -1 - i; return i > n - 1 ? n - 1 : i;
    default: { i = i % n; return i < 0 ? i + n : i; }
  }
}
function cmpFunc(f: number, a: number, b: number): boolean {
  switch (f) {
    case 1: return false; case 2: return a < b; case 3: return a === b; case 4: return a <= b;
    case 5: return a > b; case 6: return a !== b; case 7: return a >= b; default: return true;
  }
}
/** the TFACTOR alpha as E(byte * f64(1/255)) (exact as a double-double) */
function tfAlpha(tf: number): [number, number] { const v = (tf >>> 24) * INV255D; return [v, exactErr(tf >>> 24, INV255D, v)]; }
function exactErr(a: number, b: number, p: number): number {
  const SPLIT = 134217729;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  return ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
/** COLOROP per channel 0x41a4b2 */
function colorOp(op: number, x1: number, x2: number, x0: number, difA: number, texA: number, curA: number, tf: number): number {
  switch (op) {
    case 2: case 17: return x1;
    case 3: return x2;
    case 4: return f32(x2 * x1);
    case 5: E.ld(x2 * 2); E.fmul(x1); return E.st32();
    case 6: E.ld(x2 * 4); E.fmul(x1); return E.st32();
    case 7: return add32(x2, x1);
    case 8: E.ld(x2); E.fadd(x1); E.fsub(0.5); return E.st32();
    case 9: E.ld(x2); E.fadd(x1); E.fsub(0.5); E.fmul(2); return E.st32();
    case 10: E.ld(1); E.fsub(x1); E.fadd(x2); E.fsubr(1); return E.st32();
    case 11: E.ld(1); E.fsub(x1); E.fmul(x2); E.fadd(x1); return E.st32();
    case 12: case 13: case 16: { const f = op === 12 ? difA : op === 13 ? texA : curA; E.ld(x1); E.fsub(x2); E.fmul(f); E.fadd(x2); return E.st32(); }
    case 14: { const [fh, fl] = tfAlpha(tf); E.ld(x1); E.fsub(x2); E.fmulE(fh, fl); E.fadd(x2); return E.st32(); }
    case 15: E.ld(1); E.fsub(texA); E.fmul(x2); E.fadd(x1); return E.st32();
    case 25: E.ld(x2 * x1); E.fadd(x0); return E.st32();
    case 26: E.ld(x1); E.fsub(x2); E.fmul(x0); E.fadd(x2); return E.st32();
    default: throw new Error('RefDevice: COLOROP ' + op + ' is not implemented');
  }
}
/** ALPHAOP 0x41a4b2 (MULTIPLYADD / LERP take the colour arguments' alphas) */
function alphaOp(op: number, a1: number, a2: number, c1: number, c2: number, c0: number, difA: number, texA: number, curA: number, tf: number): number {
  switch (op) {
    case 2: return a1;
    case 3: return a2;
    case 4: return f32(a2 * a1);
    case 5: return f32(a2 * a1 * 2);
    case 6: return f32(a2 * a1 * 4);
    case 7: return add32(a2, a1);
    case 8: E.ld(a2); E.fadd(a1); E.fsub(0.5); return E.st32();
    case 9: E.ld(a2); E.fadd(a1); E.fsub(0.5); E.fmul(2); return E.st32();
    case 10: E.ld(1); E.fsub(a1); E.fadd(a2); E.fsubr(1); return E.st32();
    case 11: E.ld(1); E.fsub(a1); E.fmul(a2); E.fadd(a1); return E.st32();
    case 12: case 13: case 16: { const f = op === 12 ? difA : op === 13 ? texA : curA; E.ld(a1); E.fsub(a2); E.fmul(f); E.fadd(a2); return E.st32(); }
    case 14: { const [fh, fl] = tfAlpha(tf); E.ld(a1); E.fsub(a2); E.fmulE(fh, fl); E.fadd(a2); return E.st32(); }
    case 15: E.ld(1); E.fsub(texA); E.fmul(a2); E.fadd(a1); return E.st32();
    case 25: E.ld(c2 * c1); E.fadd(c0); return E.st32();
    case 26: E.ld(c1); E.fsub(c2); E.fmul(c0); E.fadd(c2); return E.st32();
    default: return 1;
  }
}
/** alpha blend 0x419b7e (src in c, result in c) */
const FS = new Float64Array(4), SS = new Float64Array(4);
function blend(sb: number, db: number, op: number, c: Float64Array, d: Float64Array): void {
  if (op === 4 || op === 5) { for (let i = 0; i < 4; i++) c[i] = op === 4 ? Math.min(c[i], d[i]) : Math.max(c[i], d[i]); }
  else {
    const as = c[3], ad = d[3];
    // source factors, f32
    const fs = FS;
    for (let i = 0; i < 4; i++) fs[i] = factor(sb, i, c, d, as, ad, true);
    // destination factors: R and G stay at 64 bits (as double-doubles), B and A f32
    const S = SS;
    for (let i = 0; i < 4; i++) S[i] = f32(fs[i] * c[i]);
    // R
    factorE(db, 0, c, d, as, ad); E.fmul(d[0]); const DR = E.st32();
    factorE(db, 1, c, d, as, ad); E.fmul(d[1]); const gh = E.H, gl = E.L;
    const DB = f32(factor(db, 2, c, d, as, ad, false) * d[2]), DA = f32(factor(db, 3, c, d, as, ad, false) * d[3]);
    if (op === 2) { c[0] = add32(S[0], -DR); E.ld(S[1]); E.fsubE(gh, gl); c[1] = E.st32(); c[2] = add32(S[2], -DB); c[3] = add32(S[3], -DA); }
    else if (op === 3) { c[0] = add32(DR, -S[0]); E.ldE(gh, gl); E.fsub(S[1]); c[1] = E.st32(); c[2] = add32(DB, -S[2]); c[3] = add32(DA, -S[3]); }
    else { c[0] = add32(DR, S[0]); E.ldE(gh, gl); E.fadd(S[1]); c[1] = E.st32(); c[2] = add32(DB, S[2]); c[3] = add32(DA, S[3]); }
  }
  for (let i = 0; i < 4; i++) c[i] = clamp01(c[i]);
}
/** a blend factor rounded to f32 */
function factor(m: number, i: number, s: Float64Array, d: Float64Array, as: number, ad: number, src: boolean): number {
  switch (m) {
    case 1: return 0;
    case 2: return 1;
    case 3: return s[i];
    case 4: return f32(1 - s[i]);
    case 5: return as;
    case 6: return f32(1 - as);
    case 7: return ad;
    case 8: return f32(1 - ad);
    case 9: return d[i];
    case 10: return f32(1 - d[i]);
    case 11: return i === 3 ? 1 : Math.min(as, f32(1 - ad));
    case 12: return src ? as : f32(1 - as);
    case 13: return src ? f32(1 - as) : as;
    default: throw new Error('RefDevice: blend factor ' + m + ' is not implemented');
  }
}
/** the destination R/G factor as left on the FPU (unrounded 1 - x), into E.H / E.L */
function factorE(m: number, i: number, s: Float64Array, d: Float64Array, as: number, ad: number): void {
  switch (m) {
    // INVSRCALPHA / BOTHSRCALPHA / INVDESTALPHA: only the R factor is left unrounded
    case 6: case 12: if (i === 0) { E.ld(1); E.fsub(as); } else E.ld(f32(1 - as)); return;
    case 8: if (i === 0) { E.ld(1); E.fsub(ad); } else E.ld(f32(1 - ad)); return;
    case 4: E.ld(1); E.fsub(s[i]); return;
    case 10: E.ld(1); E.fsub(d[i]); return;
    default: E.ld(factor(m, i, s, d, as, ad, false));
  }
}
