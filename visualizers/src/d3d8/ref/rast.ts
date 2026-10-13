// REF's rasterizer (RefRast, RD+0x12b18): triangle setup and culling (0x414000), top-left edge tests in 28.4 fixed
// point (0x418cc8 / 0x418d87), 2x2-quad scan anchored at the bounding box (0x418ac0), perspective-correct attribute
// planes (0x4183aa / 0x418148), texture sampling through the legacy pixel-shader micro-code (0x41ab11: LOD 0x413920,
// texel lists 0x412f97, fetch 0x4134f2), texture stage blending (0x41a4b2), and the pixel operations (0x419f5d):
// alpha test, D16 depth, alpha blending, the colour write. Points: DrawPoint 0x411209. All x87 work at 64 bits (./ext).
import { Fmt, Rs } from '../api';
import type { RefSurface, RefTexture, State } from '../ref';
import * as E from './ext';
import { stateViews } from './kernel';
import { f32, ftol } from './num';
import { DIF, type OutFvf, PSZ, RHW, SPE, SX, SY, SZ, TEX } from './vp';

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
  /** BORDERCOLOR, what an out-of-range texel is under BORDER addressing */
  border: number;
}

/** an attribute plane (A d/dx, B d/dy, C) per component */
class Plane {
  A = new Float64Array(4); B = new Float64Array(4); C = new Float64Array(4); flat = false;
  /** per component: (|A|*X + |B|*Y + |C|) * EPS over the triangle's bounding box (a bound for the fast paths) */
  M = new Float64Array(4);
  /** constant over the triangle (A = B = 0 and a constant W): the clamped values */
  konst = false; K = new Float64Array(4);
}

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
  // per-draw decoded state for the pixel loop
  /** per stage: COLOROP, COLORARG1, COLORARG2, COLORARG0, ALPHAOP, ALPHAARG1, ALPHAARG2, RESULTARG */
  private prog = new Int32Array(8 * 8);
  private zOn = false; private zWrite = false; private zFunc = 0; private specOn = false; private aTest = false;
  private aFunc = 0; private aRef = 0; private cwe = 0xf; private blendMode = 0; private rtX8 = true; private dither = false;
  private tfA = 0;

  /** per-draw state (RefRast's lazy update 0x40b9ae, active stages 0x40e0fd, filter decode 0x412c0d) */
  begin(st: State, rt: RefSurface, ds: RefSurface | null, out: OutFvf, nStages: number): void {
    this.st = st; this.rt = rt; this.ds = ds; this.out = out; this.nStages = nStages;
    const vp = st.vp;
    this.clip = { l: vp.x, t: vp.y, r: vp.x + vp.w - 1, b: vp.y + vp.h - 1 };
    const rs = st.rs;
    this.zOn = rs[Rs.ZENABLE] !== 0 && ds !== null; this.zWrite = this.zOn && rs[Rs.ZWRITEENABLE] !== 0; this.zFunc = rs[Rs.ZFUNC];
    this.specOn = rs[Rs.SPECULARENABLE] !== 0; this.aTest = rs[Rs.ALPHATESTENABLE] !== 0; this.aFunc = rs[Rs.ALPHAFUNC];
    this.aRef = rs[Rs.ALPHAREF] & 0xff; this.cwe = rs[Rs.COLORWRITEENABLE] & 0xf; this.rtX8 = rt.format === Fmt.X8R8G8B8;
    this.dither = rs[Rs.DITHERENABLE] !== 0;
    const tf = rs[Rs.TEXTUREFACTOR]; this.tfA = tf;
    this.tfv[0] = B255[(tf >>> 16) & 0xff]; this.tfv[1] = B255[(tf >>> 8) & 0xff]; this.tfv[2] = B255[tf & 0xff]; this.tfv[3] = B255[tf >>> 24];
    const sb = rs[Rs.SRCBLEND], db = rs[Rs.DESTBLEND], bo = rs[Rs.BLENDOP];
    this.blendMode = !rs[Rs.ALPHABLENDENABLE] ? 0 : bo !== 1 ? 4 : sb === 5 && db === 6 ? 1 : sb === 2 && db === 2 ? 2 : sb === 2 && db === 1 ? 0 : 4;
    for (let i = 0; i < 8; i++) {
      const t = st.tss, b = i * 32, q = i * 8;
      this.prog[q] = t[b + 1]; this.prog[q + 1] = t[b + 2]; this.prog[q + 2] = t[b + 3]; this.prog[q + 3] = t[b + 26];
      this.prog[q + 4] = t[b + 4]; this.prog[q + 5] = t[b + 5]; this.prog[q + 6] = t[b + 6]; this.prog[q + 7] = t[b + 28];
    }
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
        addrU: t[b + 13], addrV: t[b + 14], border: t[b + 15],
      });
    }
  }

  /** write this draw's state into the WebAssembly rasterizer (layout: kernel-as.ts); false = the kernel cannot take
   *  it (a surface outside its memory, a format or op it does not have) and rast.ts draws */
  toKernel(): boolean {
    const rs = this.st.rs, rt = this.rt, ds = this.ds;
    if (rt.heapOff < 0 || (ds && ds.heapOff < 0) || rs[Rs.FILLMODE] !== 3) return false;
    if (rt.format !== Fmt.X8R8G8B8 && rt.format !== Fmt.A8R8G8B8) return false;
    if (this.blendMode === 4) {
      const sb = rs[Rs.SRCBLEND], db = rs[Rs.DESTBLEND], bo = rs[Rs.BLENDOP];
      if (sb < 1 || sb > 13 || db < 1 || db > 13 || bo < 1 || bo > 5) return false;
    }
    const { i32, f64 } = stateViews(), P = this.prog;
    for (let c = 0; c < this.nStages; c++) {
      const op = P[c * 8], aop = P[c * 8 + 4];
      if (!KOPS.has(op) || !(KOPS.has(aop) || aop === 1)) return false;
      const s = this.stages[c], tex = s.tex;
      if (tex && (s.addrU === 4 || s.addrV === 4)) return false;      // the kernel has no BORDER addressing
      if (tex && (tex.mips.some((m) => m.heapOff < 0) || (tex.format !== Fmt.A8R8G8B8 && tex.format !== Fmt.X8R8G8B8 && tex.format !== Fmt.A4R4G4B4))) return false;
    }
    const c = this.clip;
    i32[0] = c.l; i32[1] = c.t; i32[2] = c.r; i32[3] = c.b; i32[4] = rs[Rs.CULLMODE]; i32[5] = rs[Rs.SHADEMODE] === 1 ? 1 : 0;
    i32[6] = this.zOn ? 1 : 0; i32[7] = this.zWrite ? 1 : 0; i32[8] = this.zFunc; i32[9] = this.specOn ? 1 : 0;
    i32[10] = this.aTest ? 1 : 0; i32[11] = this.aFunc; i32[12] = this.aRef; i32[13] = this.cwe; i32[14] = this.blendMode;
    i32[15] = rs[Rs.SRCBLEND]; i32[16] = rs[Rs.DESTBLEND]; i32[17] = rs[Rs.BLENDOP]; i32[18] = this.rtX8 ? 1 : 0;
    i32[19] = this.dither ? 1 : 0; i32[20] = this.tfA | 0; i32[21] = this.nStages; i32[22] = this.out.diffuse ? 1 : 0;
    i32[23] = this.out.specular ? 1 : 0; i32[24] = this.out.psize ? 1 : 0; i32[25] = rt.heapOff; i32[26] = rt.pitch;
    i32[27] = ds ? ds.heapOff : 0; i32[28] = ds ? ds.pitch : 0; i32[29] = rs[Rs.ZENABLE] ? 1 : 0;
    i32[30] = rs[Rs.POINTSPRITEENABLE] ? 1 : 0; i32[31] = rs[Rs.POINTSIZE] | 0; i32[32] = rs[Rs.POINTSIZE_MIN] | 0;
    i32[33] = rs[Rs.POINTSIZE_MAX] | 0; i32[34] = rs[Rs.FILLMODE];
    for (let k = 0; k < 64; k++) i32[40 + k] = P[k];
    // the kernel's fast stage chain (stagesFast): the common ops and plain arguments only
    let fast = 1;
    for (let c = 0; c < this.nStages; c++) {
      const q = c * 8, op = P[q];
      if (op === 1) break;
      const plain = (a: number): boolean => a >= 0 && a <= 3;
      if (!(op === 2 || op === 3 || op === 4 || op === 7) || !(P[q + 4] === 1 || P[q + 4] === 2 || P[q + 4] === 3 || P[q + 4] === 4 || P[q + 4] === 10) ||
        !plain(P[q + 1]) || !plain(P[q + 2]) || !plain(P[q + 5]) || !plain(P[q + 6]) || P[q + 7] === 5) fast = 0;
    }
    i32[35] = fast;
    f64[0] = this.tfv[0]; f64[1] = this.tfv[1]; f64[2] = this.tfv[2]; f64[3] = this.tfv[3];
    for (let i = 0; i < this.nStages; i++) {
      const s = this.stages[i], b = (2048 + 512 * i) >> 2, tex = s.tex;
      i32[b] = tex ? 1 : 0;
      if (!tex) continue;
      i32[b + 1] = s.set; i32[b + 2] = s.dims; i32[b + 3] = s.minF; i32[b + 4] = s.magF; i32[b + 5] = s.mipF; i32[b + 6] = s.needLod;
      i32[b + 7] = s.maxMip; i32[b + 8] = s.addrU; i32[b + 9] = s.addrV; i32[b + 10] = tex.width; i32[b + 11] = tex.height;
      i32[b + 12] = tex.levels; i32[b + 13] = tex.format;
      f64[(2048 + 512 * i + 64 - 1024) >> 3] = s.bias;
      for (let l = 0; l < tex.levels && l < 16; l++) {
        const m = tex.mips[l], q = b + 32 + l * 4;
        i32[q] = m.heapOff; i32[q + 1] = m.width; i32[q + 2] = m.height; i32[q + 3] = m.pitch;
      }
    }
    return true;
  }

  // ---- triangles ----
  /** DrawTriangle 0x4114c7 */
  triangle(v0: V, v1: V, v2: V): void {
    // rotate: the vertex with the smallest x (then y) first
    const x0 = v0.f[v0.o + SX], y0 = v0.f[v0.o + SY], x1 = v1.f[v1.o + SX], y1 = v1.f[v1.o + SY], x2 = v2.f[v2.o + SX], y2 = v2.f[v2.o + SY];
    let best = 0, bx = x0, by = y0;
    if (x1 < bx || (x1 === bx && y1 < by)) { best = 1; bx = x1; by = y1; }
    if (x2 < bx || (x2 === bx && y2 < by)) best = 2;
    let r0 = v0, r1 = v1, r2 = v2;
    if (best === 1) { r0 = v1; r1 = v2; r2 = v0; this.rot = 2; } else if (best === 2) { r0 = v2; r1 = v0; r2 = v1; this.rot = 1; } else this.rot = 0;
    if (this.setup(r0, r1, r2, this.st.rs[Rs.CULLMODE])) return;
    if (this.st.rs[Rs.FILLMODE] !== 3) throw new Error('RefDevice: only FILLMODE SOLID is implemented');
    const flip = this.det > 0, X = this.X, Y = this.Y;
    this.edge(0, flip, X[0], Y[0], X[1], Y[1]);
    this.edge(1, flip, X[1], Y[1], X[2], Y[2]);
    this.edge(2, flip, X[2], Y[2], X[0], Y[0]);
    this.nEdges = 3;
    this.wConst = this.Arhw === 0 && this.Brhw === 0 ? recip(0, 0, this.Crhw) : NaN;
    this.Mrhw = (Math.abs(this.Arhw) * this.bx + Math.abs(this.Brhw) * this.by + Math.abs(this.Crhw)) * EPS;
    this.attributes(r0, r1, r2, v0, v1, v2);
    this.scan();
  }
  /** W when the rhw plane is constant (A = B = 0), else NaN */
  private wConst = NaN;
  /** the rhw plane's bound, as Plane.M */
  private Mrhw = 0;
  private konst(p: Plane): void {
    const wc = this.wConst, A = p.A, B = p.B;
    p.konst = !p.flat && wc === wc && A[0] === 0 && B[0] === 0 && A[1] === 0 && B[1] === 0 && A[2] === 0 && B[2] === 0 && A[3] === 0 && B[3] === 0;
    if (p.konst) for (let i = 0; i < 4; i++) p.K[i] = clamp01(evalW(0, 0, p.C[i], wc));
  }

  /** setup 0x414000: snap, determinant, cull, bounding box, rhw plane; true = dropped */
  private setup(a: V, b: V, c: V, cull: number): boolean {
    const ax = a.f[a.o + SX], ay = a.f[a.o + SY], bx = b.f[b.o + SX], by = b.f[b.o + SY], cx = c.f[c.o + SX], cy = c.f[c.o + SY];
    // snap inline (see snap)
    const fr = Math.fround;
    F1[0] = fr(ax + 786432); const X0 = (I1[0] << 10) >> 10; F1[0] = fr(ay + 786432); const Y0 = (I1[0] << 10) >> 10;
    F1[0] = fr(bx + 786432); const X1 = (I1[0] << 10) >> 10; F1[0] = fr(by + 786432); const Y1 = (I1[0] << 10) >> 10;
    F1[0] = fr(cx + 786432); const X2 = (I1[0] << 10) >> 10; F1[0] = fr(cy + 786432); const Y2 = (I1[0] << 10) >> 10;
    const X = this.X, Y = this.Y;
    X[0] = X0; X[1] = X1; X[2] = X2; Y[0] = Y0; Y[1] = Y1; Y[2] = Y2;
    const det = (Y2 - Y0) * (X1 - X0) - (Y0 - Y1) * (X0 - X2);
    this.det = det;
    if (det === 0 || (cull === 2 && det > 0) || (cull === 3 && det < 0)) return true;
    this.bbox(Math.min(ax, bx, cx), Math.max(ax, bx, cx), Math.min(ay, by, cy), Math.max(ay, by, cy));
    const fX0 = X0 * 0.0625, fY0 = Y0 * 0.0625;
    const dX10 = (X1 - X0) * 0.0625, dX02 = (X0 - X2) * 0.0625, dY01 = (Y0 - Y1) * 0.0625, dY20 = (Y2 - Y0) * 0.0625;
    this.fX0 = fX0; this.fY0 = fY0; this.dX10 = dX10; this.dX02 = dX02; this.dY01 = dY01; this.dY20 = dY20;
    // invDet = f32(E(1 / (det / 256))); the 64-bit quotient also feeds the rhw plane
    const q = det * 0.00390625, iv = 1 / q, ei = Math.abs(iv) * EPS;
    let invDet = Math.fround(iv - ei);
    if (invDet !== Math.fround(iv + ei)) { E.ld(q); E.fdivr(1); invDet = E.st32(); }
    this.invDet = invDet;
    // rhw plane (0x414355)
    const w0 = a.f[a.o + RHW], w1 = b.f[b.o + RHW], w2 = c.f[c.o + RHW];
    if (w0 === w1 && w1 === w2) { this.Arhw = 0; this.Brhw = 0; this.Crhw = w0; return false; }
    // fast path as in plane(), the double 1/q standing in for the 64-bit one (its error is inside the bounds)
    {
      const d1d = w1 - w0, d2 = w2 - w0;
      const d1 = Math.fround(d1d);
      if (twoErr(w1, -w0, d1d) === 0) {                   // w1 - w0 exact in double (floats close together)
        const e2 = twoErr(w2, -w0, d2) === 0 ? 0 : (Math.abs(w2) + Math.abs(w0)) * EPS;
        const ta = d2 * dY01, tb = dY20 * d1;
        const ra = (tb + ta) * iv, ea = ((Math.abs(ta) + Math.abs(tb)) * EPS + e2 * Math.abs(dY01)) * Math.abs(iv) * 2;
        const A = Math.fround(ra - ea);
        if (A === Math.fround(ra + ea)) {
          const tc = d2 * dX10, td = dX02 * d1;
          const rb = (td + tc) * iv, eb = ((Math.abs(tc) + Math.abs(td)) * EPS + e2 * Math.abs(dX10)) * Math.abs(iv) * 2;
          const B = Math.fround(rb - eb);
          if (B === Math.fround(rb + eb)) {
            const u = A * fX0, v = rb * fY0;
            const rc = w0 - u - v, ec = (Math.abs(w0) + Math.abs(u) + Math.abs(v)) * EPS + eb * Math.abs(fY0);
            const C = Math.fround(rc - ec);
            if (C === Math.fround(rc + ec)) { this.Arhw = A; this.Brhw = B; this.Crhw = C; return false; }
          }
        }
      }
    }
    E.ld(q); E.fdivr(1); const ih = E.A[0], il = E.A[1];
    E.ld(w1); E.fsub(w0); const d1 = E.st32();
    E.ld(w2); E.fsub(w0); const d2h = E.A[0], d2l = E.A[1];
    E.ldE(d2h, d2l); E.fmul(dY01); E.fadd(dY20 * d1); E.fmulE(ih, il);
    this.Arhw = E.st32();
    E.ldE(d2h, d2l); E.fmul(dX10); E.fadd(dX02 * d1); E.fmulE(ih, il);
    const bh = E.A[0], bl = E.A[1]; this.Brhw = E.st32();
    E.ld(this.Arhw * fX0); E.fsubr(w0); const ch = E.A[0], cl = E.A[1];
    E.ldE(bh, bl); E.fmul(fY0); E.ldE(-E.A[0], -E.A[1]); E.faddE(ch, cl);
    this.Crhw = E.st32();
    return false;
  }

  /** the largest |pixel coordinate| a quad of the bbox reaches */
  private bx = 0; private by = 0;
  private bbox(mnx: number, mxx: number, mny: number, mxy: number): void {
    const c = this.clip;
    this.xmin = Math.max(ftol(mnx + 0.5), c.l); this.xmax = Math.min(ftol(mxx + 0.5), c.r);
    this.ymin = Math.max(ftol(mny + 0.5), c.t); this.ymax = Math.min(ftol(mxy + 0.5), c.b);
    this.bx = Math.max(Math.abs(this.xmin), Math.abs(this.xmax + 1)); this.by = Math.max(Math.abs(this.ymin), Math.abs(this.ymax + 1));
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
    const w = this.wv; w[0] = a.f[a.o + RHW]; w[1] = b.f[b.o + RHW]; w[2] = c.f[c.o + RHW];
    const pa = this.pa;
    if (rs[Rs.ZENABLE]) { pa[0] = a.f[a.o + SZ]; pa[1] = b.f[b.o + SZ]; pa[2] = c.f[c.o + SZ]; this.plane(this.pz, 0, ONES); }
    const flat = rs[Rs.SHADEMODE] === 1;
    // colours: bytes trunc(c*255) back to floats byte * (1/255 as a double); no DIFFUSE = 0xffffffff, no SPECULAR = 0
    const col = colByte;
    const doSpec = rs[Rs.SPECULARENABLE] !== 0;
    for (let k = 0; k < 4; k++) {
      const hd = this.out.diffuse, hs = this.out.specular;
      if (flat) {
        this.pd.flat = true; this.pd.C[k] = col(o0, DIF, hd, 1, k);
        if (doSpec) { this.ps.flat = true; this.ps.C[k] = col(o0, SPE, hs, 0, k); }
      } else {
        this.pd.flat = false;
        this.cols(a, b, c, DIF, hd, 1, k); this.plane(this.pd, k, w);
        if (doSpec) { this.ps.flat = false; this.cols(a, b, c, SPE, hs, 0, k); this.plane(this.ps, k, w); }
      }
    }
    this.konst(this.pd);
    if (doSpec) this.konst(this.ps);
    // texture coordinates
    for (let i = 0; i < this.nStages; i++) {
      const s = this.stages[i];
      if (!s.tex) continue;
      const p = this.pt[i];
      if (this.sprite) {
        pa[0] = 0; pa[1] = 1; pa[2] = 0; this.plane(p, 0, w); pa[0] = 0; pa[1] = 0; pa[2] = 1; this.plane(p, 1, w);
      } else {
        const t = TEX + s.set * 4, d0 = s.dims > 0, d1 = s.dims > 1;
        pa[0] = d0 ? a.f[a.o + t] : 0; pa[1] = d0 ? b.f[b.o + t] : 0; pa[2] = d0 ? c.f[c.o + t] : 0; this.plane(p, 0, w);
        pa[0] = d1 ? a.f[a.o + t + 1] : 0; pa[1] = d1 ? b.f[b.o + t + 1] : 0; pa[2] = d1 ? c.f[c.o + t + 1] : 0; this.plane(p, 1, w);
      }
    }
  }

  /** one component's plane 0x4183aa */
  private wv = new Float64Array(3);
  /** the three vertex values for plane() (a scratch array: double arguments to a call are boxed) */
  private pa = new Float64Array(3);
  /** pa = the three vertices' colour component k as the rasterizer takes it (colByte) */
  private cols(a: V, b: V, c: V, base: number, has: boolean, dflt: number, k: number): void {
    const pa = this.pa;
    if (!has) { pa[0] = dflt; pa[1] = dflt; pa[2] = dflt; return; }
    pa[0] = f32((ftol(a.f[a.o + base + k] * 255) & 0xff) * INV255D);
    pa[1] = f32((ftol(b.f[b.o + base + k] * 255) & 0xff) * INV255D);
    pa[2] = f32((ftol(c.f[c.o + base + k] * 255) & 0xff) * INV255D);
  }
  private plane(p: Plane, i: number, w: Float64Array): void {
    const a0 = this.pa[0], a1 = this.pa[1], a2 = this.pa[2];
    // fast path: doubles with error bounds (see evalW); the products w*a are exact
    {
      const p0 = w[0] * a0, x1 = w[1] * a1, x2 = w[2] * a2;
      const d1d = x1 - p0, d2 = x2 - p0;
      // d1 = f32(E(x1 - p0)): exact differences (the common case, incl. 0) round once; else the bound decides
      let d1 = Math.fround(d1d);
      if (twoErr(x1, -p0, d1d) !== 0) { const e1 = (Math.abs(x1) + Math.abs(p0)) * EPS; d1 = Math.fround(d1d - e1); if (d1 !== Math.fround(d1d + e1)) d1 = NaN; }
      if (d1 === d1) {
        const iv = this.invDet;
        // d2 is the 64-bit E(x2 - p0) to within (|x2| + |p0|) * 2^-53 (0 when exact): carried in the bounds
        const e2 = twoErr(x2, -p0, d2) === 0 ? 0 : (Math.abs(x2) + Math.abs(p0)) * EPS;
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
            if (C === Math.fround(rc + ec)) { p.A[i] = A; p.B[i] = B; p.C[i] = C; p.M[i] = (Math.abs(A) * this.bx + Math.abs(B) * this.by + Math.abs(C)) * EPS; return; }
          }
        }
      }
    }
    E.ld(w[0] * a0); const p0h = E.A[0], p0l = E.A[1]; const p0 = E.st32();
    E.ld(w[1] * a1); E.fsubE(p0h, p0l); const d1 = E.st32();
    E.ld(w[2] * a2); E.fsubE(p0h, p0l); const d2h = E.A[0], d2l = E.A[1];
    E.fmul(this.dY01); E.fadd(d1 * this.dY20); E.fmul(this.invDet); const A = E.st32();
    E.ldE(d2h, d2l); E.fmul(this.dX10); E.fadd(d1 * this.dX02); E.fmul(this.invDet); const bh = E.A[0], bl = E.A[1]; const B = E.st32();
    E.ld(this.fX0 * A); E.fsubr(p0); const ch = E.A[0], cl = E.A[1];
    E.ldE(bh, bl); E.fmul(this.fY0); E.ldE(-E.A[0], -E.A[1]); E.faddE(ch, cl);
    p.A[i] = A; p.B[i] = B; p.C[i] = E.st32();
    p.M[i] = (Math.abs(A) * this.bx + Math.abs(B) * this.by + Math.abs(p.C[i])) * EPS;
  }

  /** plane value at (x, y) at 64 bits, left in E.A[0] / E.A[1] */
  private static evalE(p: Plane, i: number, x: number, y: number): void { E.ld(x * p.A[i]); E.fadd(y * p.B[i]); E.fadd(p.C[i]); }

  /** scan 0x418ac0 */
  private scan(): void {
    // edge e at pixel (px, py): v = A*16*px + B*16*py + C (exact integers); inside iff v < 0 || (v == 0 && !incl),
    // i.e. v - (incl ? 0 : 1) < 0 for integer v
    const n = this.nEdges, A = this.eA, B = this.eB, C = this.eC, I = this.eI, cov = this.cov;
    const x0 = this.xmin, x1 = this.xmax, y1 = this.ymax;
    const a0 = A[0] * 16, b0 = B[0] * 16, c0 = C[0] - (I[0] ? 0 : 1);
    const a1 = A[1] * 16, b1 = B[1] * 16, c1 = C[1] - (I[1] ? 0 : 1);
    const a2 = A[2] * 16, b2 = B[2] * 16, c2 = C[2] - (I[2] ? 0 : 1);
    const a3 = n > 3 ? A[3] * 16 : 0, b3 = n > 3 ? B[3] * 16 : 0, c3 = n > 3 ? C[3] - (I[3] ? 0 : 1) : -1;
    for (let y = this.ymin; y <= y1; y += 2) {
      const lastRow = y + 1 > y1;
      for (let x = x0; x <= x1; x += 2) {
        let any = 0;
        for (let k = 0; k < 4; k++) {
          const px = x + (k & 1), py = y + (k >> 1);
          const inn = px <= x1 && !(lastRow && k > 1) &&
            a0 * px + b0 * py + c0 < 0 && a1 * px + b1 * py + c1 < 0 && a2 * px + b2 * py + c2 < 0 && a3 * px + b3 * py + c3 < 0;
          cov[k] = inn ? 1 : 0; any |= cov[k];
        }
        if (any) this.quad(x, y);
      }
    }
  }

  /** a quad 0x4188d8 + 0x41ab11 + 0x419f5d. Hot path: the arithmetic of evalW / recip / depth16 / linCoord is written
   *  inline here (a double passed to or returned from a call that V8 does not inline is boxed: an allocation per
   *  value); the helpers stay as the 64-bit fallbacks and as the readable definition. */
  private quad(x: number, y: number): void {
    const fr = Math.fround, abs = Math.abs;
    const W = this.W, wc = this.wConst;
    if (wc === wc) { W[0] = wc; W[1] = wc; W[2] = wc; W[3] = wc; }
    else {
      const Ar = this.Arhw, Br = this.Brhw, Cr = this.Crhw, d = this.Mrhw;
      for (let k = 0; k < 4; k++) {
        const a = (x + (k & 1)) * Ar, b = (y + (k >> 1)) * Br;
        const s = a + b + Cr;
        let v = NaN;
        if (abs(s) > 4 * d) { const r = 1 / s, e = abs(r) * (2 * d / abs(s) + EPS); v = fr(r - e); if (v !== fr(r + e)) v = NaN; }
        W[k] = v === v ? v : recip(a, b, Cr);
      }
    }
    // texture coordinates for all 4 pixels, then sample
    const tu = this.tu, tv = this.tv;
    for (let i = 0; i < this.nStages; i++) {
      const st = this.stages[i];
      if (!st.tex) continue;
      const p = this.pt[i], A = p.A, B = p.B, C = p.C, b = i * 4;
      const Au = A[0], Bu = B[0], Cu = C[0], Av = A[1], Bv = B[1], Cv = C[1], Mu = p.M[0], Mv = p.M[1];
      for (let k = 0; k < 4; k++) {
        const xf = x + (k & 1), yf = y + (k >> 1), w = W[k], aw = abs(w);
        let xa = xf * Au, yb = yf * Bu, r = (xa + yb + Cu) * w, e = Mu * aw;
        let v = fr(r - e);
        tu[b + k] = v === fr(r + e) || (r === 0 && sum3Exact(xa, yb, Cu)) ? fr(r) : evalW(xa, yb, Cu, w);
        xa = xf * Av; yb = yf * Bv; r = (xa + yb + Cv) * w; e = Mv * aw;
        v = fr(r - e);
        tv[b + k] = v === fr(r + e) || (r === 0 && sum3Exact(xa, yb, Cv)) ? fr(r) : evalW(xa, yb, Cv, w);
      }
      this.sample(i, st);
    }
    const zOn = this.zOn, spec = this.specOn, cov = this.cov;
    const pz = this.pz, Az = pz.A[0], Bz = pz.B[0], Cz = pz.C[0];
    for (let k = 0; k < 4; k++) {
      if (!cov[k]) continue;
      const px = x + (k & 1), py = y + (k >> 1), w = W[k];
      let zq = 0;
      if (zOn) {
        const a = px * Az, b = py * Bz, ab = a + b, z = ab + Cz;
        if (ab - a === b && ab - b === a && z - ab === Cz && z - Cz === ab && fr(z) === z && z >= 0 && z <= 1) zq = Math.floor(z * 65535 + 0.5);
        else zq = depth16(a, b, Cz);
      }
      this.color(this.pd, this.dif, px, py, w);
      if (spec) this.color(this.ps, this.spe, px, py, w);
      this.pixel(px, py, k, zq);
    }
  }

  /** a colour plane at a pixel (RDAttribute::Eval 0x418148 with the [0,1] clamp), evalW inline */
  private color(p: Plane, out: Float64Array, x: number, y: number, w: number): void {
    const C = p.C;
    if (p.konst) { const K = p.K; out[0] = K[0]; out[1] = K[1]; out[2] = K[2]; out[3] = K[3]; return; }
    if (p.flat) { out[0] = clamp01(C[0]); out[1] = clamp01(C[1]); out[2] = clamp01(C[2]); out[3] = clamp01(C[3]); return; }
    const fr = Math.fround, abs = Math.abs, A = p.A, B = p.B, M = p.M, aw = abs(w);
    for (let i = 0; i < 4; i++) {
      const xa = x * A[i], yb = y * B[i], c = C[i], r = (xa + yb + c) * w, e = M[i] * aw;
      let v = fr(r - e);
      if (v !== fr(r + e)) v = r === 0 && sum3Exact(xa, yb, c) ? r : evalW(xa, yb, c, w);
      out[i] = v > 1 ? 1 : v >= 0 ? v : 0;
    }
  }

  // ---- texture sampling ----
  private sample(i: number, s: Stage): void {
    const tex = s.tex!, fr = Math.fround, abs = Math.abs;
    const u = this.tu, v = this.tv, b = i * 4;
    let levels = 1, l0 = 0, l1 = 0, w0 = 1, w1 = 0;
    let filt = s.minF;
    if (s.needLod) {
      const iLOD = lodOf(tex.width, tex.height, u, v, b, s);
      const mag = iLOD <= 0;
      filt = mag ? s.magF : s.minF;
      const base = s.maxMip >>> 0, maxL = tex.levels - 1;
      if (mag || s.mipF === 0) l0 = Math.min(Math.max(0, base), maxL);
      else if (s.mipF === 1) l0 = Math.min(Math.max((iLOD + 16) >> 5, base), maxL);
      else {
        l0 = Math.min(Math.max(iLOD >> 5, base), maxL); l1 = Math.min(Math.max((iLOD >> 5) + 1, base), maxL);
        if (l0 !== l1 && (iLOD & 31) !== 0) { levels = 2; w1 = fr((iLOD & 31) * 0.03125); w0 = fr(1 - w1); }
      }
    }
    const out = this.texc, cov = this.cov;
    for (let k = 0; k < 4; k++) {
      if (!cov[k]) continue;   // an uncovered pixel's texel is never used (its coordinates fed the LOD already)
      const o = (b + k) * 4;
      let r = 0, g = 0, bb = 0, a = 0;
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
      for (let l = 0; l < levels; l++) {
        const m = tex.mips[l === 0 ? l0 : l1], lw = l === 0 ? w0 : w1;
        if (filt === 2 && m.format !== Fmt.A4R4G4B4 && s.addrU !== 4 && s.addrV !== 4) {
          // bilinear on a 32-bit format, the four samples of 0x412909 in order (s0 (u0,v0), s1 (u1,v0), s2 (u1,v1),
          // s3 (u0,v1)); a zero weight adds nothing, so every sample is accumulated (see acc for the exactness).
          // linCoord inline: rint(32 * (c*size - 0.5)) through f32(... + 393216)
          const N = m.width, M = m.height;
          let pu = u[b + k] * N, t = (pu - 0.5) + 393216, e = (abs(pu) + 393217) * EPS, q = fr(t - e);
          const nu = q === fr(t + e) ? (bits(q) << 10) >> 10 : linCoord(u[b + k], N);
          pu = v[b + k] * M; t = (pu - 0.5) + 393216; e = (abs(pu) + 393217) * EPS; q = fr(t - e);
          const nv = q === fr(t + e) ? (bits(q) << 10) >> 10 : linCoord(v[b + k], M);
          let u0 = nu >> 5, v0 = nv >> 5, u1 = u0 + 1, v1 = v0 + 1;
          if (u0 < 0 || u1 >= N) { u0 = address(u0, N, s.addrU); u1 = address(u1, N, s.addrU); }
          if (v0 < 0 || v1 >= M) { v0 = address(v0, M, s.addrV); v1 = address(v1, M, s.addrV); }
          const fu = (nu & 31) * 0.03125, fv = (nv & 31) * 0.03125, ou = 1 - fu, ov = 1 - fv;   // exact in float
          const d = m.data, p0 = v0 * m.pitch, p1 = v1 * m.pitch, x8 = m.format === Fmt.X8R8G8B8;
          const q0 = p0 + u0 * 4, q1 = p0 + u1 * 4, q2 = p1 + u1 * 4, q3 = p1 + u0 * 4;
          const w0s = ov * ou * lw, w1s = ov * fu * lw, w2s = fv * fu * lw, w3s = ou * fv * lw;
          r = fr(B255[d[q0 + 2]] * w0s + r); g = fr(B255[d[q0 + 1]] * w0s + g); bb = fr(B255[d[q0]] * w0s + bb); a = fr((x8 ? 1 : B255[d[q0 + 3]]) * w0s + a);
          r = fr(B255[d[q1 + 2]] * w1s + r); g = fr(B255[d[q1 + 1]] * w1s + g); bb = fr(B255[d[q1]] * w1s + bb); a = fr((x8 ? 1 : B255[d[q1 + 3]]) * w1s + a);
          r = fr(B255[d[q2 + 2]] * w2s + r); g = fr(B255[d[q2 + 1]] * w2s + g); bb = fr(B255[d[q2]] * w2s + bb); a = fr((x8 ? 1 : B255[d[q2 + 3]]) * w2s + a);
          r = fr(B255[d[q3 + 2]] * w3s + r); g = fr(B255[d[q3 + 1]] * w3s + g); bb = fr(B255[d[q3]] * w3s + bb); a = fr((x8 ? 1 : B255[d[q3 + 3]]) * w3s + a);
          out[o] = r; out[o + 1] = g; out[o + 2] = bb; out[o + 3] = a;
        } else if (filt === 2) {
          const N = m.width, M = m.height;
          const nu = linCoord(u[b + k], N), nv = linCoord(v[b + k], M);
          const iu = nu >> 5, iv = nv >> 5;
          const fu = (nu & 31) * 0.03125, fv = (nv & 31) * 0.03125, ou = 1 - fu, ov = 1 - fv;   // exact in float
          this.acc(out, o, m, iu, iv, s, ov * ou * lw);
          this.acc(out, o, m, iu + 1, iv, s, ov * fu * lw);
          this.acc(out, o, m, iu + 1, iv + 1, s, fv * fu * lw);
          this.acc(out, o, m, iu, iv + 1, s, ou * fv * lw);
          r = out[o]; g = out[o + 1]; bb = out[o + 2]; a = out[o + 3];
        } else {
          this.acc(out, o, m, pointCoord(u[b + k], m.width), pointCoord(v[b + k], m.height), s, lw);
          r = out[o]; g = out[o + 1]; bb = out[o + 2]; a = out[o + 3];
        }
      }
    }
  }

  /** fetch + address + accumulate one sample 0x4134f2: out.c = f32(E(texel.c * w) + out.c). The product is exact
   *  (a 24-bit texel >= 1/255 (or 0) times a weight in multiples of 2^-15), and so is its double sum with the f32
   *  running total (<= 1): every bit lies between 2^0 and 2^-46, so one fround is REF's single rounding */
  private acc(out: Float64Array, o: number, m: RefSurface, iu: number, iv: number, s: Stage, w: number): void {
    if (w === 0) return;
    const N = m.width, M = m.height;
    if (iu < 0 || iu >= N) iu = address(iu, N, s.addrU);
    if (iv < 0 || iv >= M) iv = address(iv, M, s.addrV);
    const d = m.data, p = iv * m.pitch;
    let r: number, g: number, b: number, a: number;
    if (iu < 0 || iv < 0) {                       // BORDER: the border colour, whatever the format
      const c = s.border;
      r = B255[(c >>> 16) & 255]; g = B255[(c >>> 8) & 255]; b = B255[c & 255]; a = B255[c >>> 24];
    } else if (m.format === Fmt.A4R4G4B4) {
      const q = p + iu * 2, wd = d[q] | (d[q + 1] << 8);
      r = B15[(wd >> 8) & 15]; g = B15[(wd >> 4) & 15]; b = B15[wd & 15]; a = B15[wd >> 12];
    } else {
      const q = p + iu * 4;
      b = B255[d[q]]; g = B255[d[q + 1]]; r = B255[d[q + 2]];
      a = m.format === Fmt.X8R8G8B8 ? 1 : B255[d[q + 3]];
    }
    out[o] = f32(r * w + out[o]); out[o + 1] = f32(g * w + out[o + 1]); out[o + 2] = f32(b * w + out[o + 2]); out[o + 3] = f32(a * w + out[o + 3]);
  }

  // ---- pixel ----
  private pixel(px: number, py: number, k: number, zq: number): void {
    const cur = this.cur, res = this.res;
    cur[0] = this.dif[0]; cur[1] = this.dif[1]; cur[2] = this.dif[2]; cur[3] = this.dif[3];
    const T = this.tmp; T[0] = 0; T[1] = 0; T[2] = 0; T[3] = 0;
    const tex = this.texv, tx = this.texc, P = this.prog;
    for (let c = 0; c < this.nStages; c++) {
      const q = c * 8, op = P[q];
      if (op === 1) break;
      if (op === 22 || op === 23) continue;
      if (this.stages[c].tex) { const to = (c * 4 + k) * 4; tex[0] = tx[to]; tex[1] = tx[to + 1]; tex[2] = tx[to + 2]; tex[3] = tx[to + 3]; }
      else { tex[0] = 0; tex[1] = 0; tex[2] = 0; tex[3] = 1; }
      const x1 = this.arg(P[q + 1], this.a1), x2 = this.arg(P[q + 2], this.a2);
      const texA = tex[3];
      switch (op) {
        case 2: res[0] = x1[0]; res[1] = x1[1]; res[2] = x1[2]; break;
        case 3: res[0] = x2[0]; res[1] = x2[1]; res[2] = x2[2]; break;
        case 4: res[0] = f32(x2[0] * x1[0]); res[1] = f32(x2[1] * x1[1]); res[2] = f32(x2[2] * x1[2]); break;
        case 7: res[0] = add32(x2[0], x1[0]); res[1] = add32(x2[1], x1[1]); res[2] = add32(x2[2], x1[2]); break;
        default: {
          const x0 = this.arg(P[q + 3], this.a0);
          for (let ch = 0; ch < 3; ch++) res[ch] = colorOp(op, x1[ch], x2[ch], x0[ch], this.dif[3], texA, cur[3], this.tfA);
        }
      }
      // alpha arguments (argA inline: a double returned from a call is boxed)
      const aop = P[q + 4], m1 = P[q + 5], m2 = P[q + 6];
      let al1 = this.argSrc(m1 & 0xf)[3], al2 = this.argSrc(m2 & 0xf)[3];
      if (m1 & 0x10) al1 = f32(1 - al1);
      if (m2 & 0x10) al2 = f32(1 - al2);
      if (aop === 2) res[3] = al1;
      else if (aop === 3) res[3] = al2;
      else if (aop === 4) res[3] = f32(al2 * al1);
      else if (aop === 1) res[3] = 1;
      else if (aop === 10) {
        const uu = 1 - al1, vv = uu + al2, rr = 1 - vv, ee = (1 + Math.abs(uu) + Math.abs(al2) + Math.abs(vv)) * EPS, lo = f32(rr - ee);
        res[3] = lo === f32(rr + ee) || (uu + al1 === 1 && vv - uu === al2 && vv - al2 === uu && rr + vv === 1) ? f32(rr) : subtract32(al1, al2);
      } else {
        const x0 = this.arg(P[q + 3], this.a0);
        res[3] = alphaOp(aop, al1, al2, x1[3], x2[3], x0[3], this.dif[3], texA, cur[3], this.tfA);
      }
      const dst = P[q + 7] === 5 ? T : cur;
      dst[0] = clamp01(res[0]); dst[1] = clamp01(res[1]); dst[2] = clamp01(res[2]); dst[3] = clamp01(res[3]);
    }
    const c = cur;
    if (this.specOn) {
      c[0] = add32(c[0], this.spe[0]); c[1] = add32(c[1], this.spe[1]); c[2] = add32(c[2], this.spe[2]);
      for (let ch = 0; ch < 4; ch++) if (c[ch] > 1) c[ch] = 1;
    }
    if (this.aTest && !cmpFunc(this.aFunc, ftol(c[3] * 255) & 0xff, this.aRef)) return;
    // depth test
    const ds = this.ds;
    let zo = 0;
    if (this.zOn) {
      zo = (py * (ds!.pitch >> 1) + px) * 2;
      if (!cmpFunc(this.zFunc, zq, ds!.data[zo] | (ds!.data[zo + 1] << 8))) return;
    }
    const rt = this.rt, ro = py * rt.pitch + px * 4, d = rt.data;
    const cwe = this.cwe;
    if (cwe !== 0xf || this.blendMode) {
      const dst = this.dstv;
      dst[0] = B255[d[ro + 2]]; dst[1] = B255[d[ro + 1]]; dst[2] = B255[d[ro]]; dst[3] = this.rtX8 ? 1 : B255[d[ro + 3]];
      if (this.blendMode === 1) blendSrcAlpha(c, dst);
      else if (this.blendMode === 2) { c[0] = add32(dst[0], c[0]); c[1] = add32(dst[1], c[1]); c[2] = add32(dst[2], c[2]); c[3] = add32(dst[3], c[3]); clamp4(c); }
      else if (this.blendMode === 4) blend(this.st.rs[Rs.SRCBLEND], this.st.rs[Rs.DESTBLEND], this.st.rs[Rs.BLENDOP], c, dst);
      if (!(cwe & 1)) c[0] = dst[0];
      if (!(cwe & 2)) c[1] = dst[1];
      if (!(cwe & 4)) c[2] = dst[2];
      if (!(cwe & 8)) c[3] = dst[3];
    }
    // WritePixel 0x40d7ae: trunc(c * 255 + offset), exact in double
    const off = this.dither ? DITHER[((px & 3) << 2) | (py & 3)] : 0.5;
    d[ro] = (c[2] * 255 + off) | 0; d[ro + 1] = (c[1] * 255 + off) | 0; d[ro + 2] = (c[0] * 255 + off) | 0;
    d[ro + 3] = this.rtX8 ? 0 : (c[3] * 255 + off) | 0;
    if (this.zWrite) { ds!.data[zo] = zq & 0xff; ds!.data[zo + 1] = zq >> 8; }
  }

  /** colour argument 0x41a419: the source itself, or (with modifiers) a copy in `scratch` */
  private texv = new Float64Array(4); private dstv = new Float64Array(4); private tfv = new Float64Array(4);
  private k0001 = new Float64Array([0, 0, 0, 1]);
  private arg(a: number, scratch: Float64Array): Float64Array {
    const s = this.argSrc(a & 0xf);
    if (!(a & 0x30)) return s;
    if (a & 0x10) for (let i = 0; i < 4; i++) scratch[i] = f32(1 - s[i]); else scratch.set(s);
    if (a & 0x20) { scratch[0] = scratch[3]; scratch[1] = scratch[3]; scratch[2] = scratch[3]; }
    return scratch;
  }
  private argA(a: number): number {
    const v = this.argSrc(a & 0xf)[3];
    return a & 0x10 ? f32(1 - v) : v;
  }
  private argSrc(sel: number): Float64Array {
    switch (sel) {
      case 0: return this.dif;
      case 1: return this.cur;
      case 2: return this.texv;
      case 3: return this.tfv;
      case 4: return this.spe;
      case 5: return this.tmp;
      default: return this.k0001;
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
    E.ld(size); E.fmul(0.5); const hh = E.A[0], hl = E.A[1];
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
      this.wConst = this.Arhw === 0 && this.Brhw === 0 ? recip(0, 0, this.Crhw) : NaN;
      this.Mrhw = (Math.abs(this.Arhw) * this.bx + Math.abs(this.Brhw) * this.by + Math.abs(this.Crhw)) * EPS;
      this.attributes(c0, c1, c2, c0, c1, c2);
      this.scan();
    }
    this.sprite = false;
  }
  private cornerV: V[] = [0, 1, 2].map(() => ({ f: new Float64Array(64), o: 0 })); private ci = 0;
  private corner(v: V, x: number, y: number): V {
    const c = this.cornerV[this.ci++ % 3], b = c.f, f = v.f, o = v.o;
    for (let i = 0; i < 52; i++) b[i] = f[o + i];
    b[SX] = x; b[SY] = y;
    return c;
  }
}

/** the stage ops the kernel has (rast.ts's colorOp / alphaOp cases) */
const KOPS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 22, 23, 25, 26]);
const DITHER = [0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625, 0.21875, 0.71875, 0.09375, 0.59375,
  0.96875, 0.46875, 0.84375, 0.34375];

// ---- per-pixel plane arithmetic: computed in doubles, checked against an error bound that covers both the
// double and the x87's 64-bit evaluation, and redone at 64 bits only when the result is too close to a rounding
// boundary to tell (rare) ----
const EPS = 8.881784197001252e-16;   // 2^-50
/** f32( E(E(a + b) + c) * W ) with a, b exact products */
export function evalW(a: number, b: number, c: number, w: number): number {
  const r = (a + b + c) * w, e = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * Math.abs(w) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  if (r === 0 && sum3Exact(a, b, c)) return r;    // an exact zero (the bound straddles 0)
  E.ld(a); E.fadd(b); E.fadd(c); E.fmul(w); return E.st32();
}
/** f32( 1 / E(E(a + b) + c) ), 0 when the denominator is 0 (0x413a70) */
export function recip(a: number, b: number, c: number): number {
  const s = a + b + c, d = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  if (Math.abs(s) > 4 * d) {
    const r = 1 / s, e = Math.abs(r) * (2 * d / Math.abs(s) + EPS);
    const lo = Math.fround(r - e);
    if (lo === Math.fround(r + e)) return lo;
  }
  E.ld(a); E.fadd(b); E.fadd(c);
  if (E.A[0] === 0 && E.A[1] === 0) return 0;
  E.fdivr(1); return E.st32();
}
/** the D16 value of z = f64(E(E(a + b) + c)): trunc(E(clamp01(z) * 65535) + 0.5) (0x41821c, 0x418849) */
export function depth16(a: number, b: number, c: number): number {
  const ab = a + b, z = ab + c;
  // exact sums (e.g. a constant z) of a float-sized z: z * 65535 + 0.5 is exact too, one floor gives the value
  if (twoErr(a, b, ab) === 0 && twoErr(ab, c, z) === 0 && Math.fround(z) === z && z >= 0 && z <= 1) return Math.floor(z * 65535 + 0.5);
  const d = (Math.abs(a) + Math.abs(b) + Math.abs(c)) * EPS;
  if (z - d > 0 && z + d < 1) {
    const v = z * 65535 + 0.5, e = d * 65536 + v * EPS;
    const q = Math.floor(v - e);
    if (q === Math.floor(v + e)) return q;
  }
  E.ld(a); E.fadd(b); E.fadd(c);
  E.ld(clamp01(E.st64())); E.fmul(65535); E.fadd(0.5);
  return truncE(E.A[0], E.A[1]);
}

/** snap to 28.4: f32(x + 786432f) and its low 22 mantissa bits, sign-extended */
function snap(x: number): number {
  // x is a float: x + 786432 is exact in double unless |x| < 2^-10, and then it cannot be near a 1/32 tie
  return (bits(Math.fround(x + 786432)) << 10) >> 10;
}
/** len(a, b) 0x418fb5 = E(E(E(|a|+|b|) * 0.34375) + E(max(|a|,|b|) * 0.65625)), left in E.A[0] / E.A[1] */
function lenE(a: number, b: number): void {
  const x = Math.abs(a), y = Math.abs(b);
  E.ld(x); E.fadd(y); E.fmul(0.34375); const h = E.A[0], l = E.A[1];
  E.ld(Math.max(x, y) * 0.65625); E.faddE(h, l);
}
const ONES = new Float64Array([1, 1, 1]);
/** a TL vertex colour component k (R, G, B, A) as the rasterizer takes it: trunc(c * 255) as a byte, times
 *  f64(1/255) (0x410df3, 0x418563); without the colour in the FVF every byte is `dflt` * 255 */
function colByte(v: V, base: number, has: boolean, dflt: number, k: number): number {
  return has ? f32((ftol(v.f[v.o + base + k] * 255) & 0xff) * INV255D) : dflt;
}
/** (a + b) + c computed exactly in double (each sum checked: the difference from the larger operand is exact) */
function sum3Exact(a: number, b: number, c: number): boolean {
  const ab = a + b, s = ab + c;
  return ab - a === b && ab - b === a && s - ab === c && s - c === ab;
}
/** the rounding error of s = a + b (TwoSum): 0 iff the double sum is exact */
function twoErr(a: number, b: number, s: number): number { const bb = s - a; return (a - (s - bb)) + (b - bb); }
/** byte -> f32(byte * f32(1/255)) and nibble -> f32(nibble * f32(1/15)) (ConvertFrom 0x41052d) */
const B255 = new Float64Array(256), B15 = new Float64Array(16);
for (let i = 0; i < 256; i++) B255[i] = Math.fround(i * Math.fround(1 / 255));
for (let i = 0; i < 16; i++) B15[i] = Math.fround(i * Math.fround(1 / 15));
function clamp4(c: Float64Array): void { for (let i = 0; i < 4; i++) c[i] = clamp01(c[i]); }

/** the stage's LOD in 1/32 (0x413920 GRAD + 0x41372b + 0x412d35), from the quad's texcoords at pixels 0, 1 (right) and 2
 *  (below) */
function lodOf(W0: number, H0: number, u: Float64Array, v: Float64Array, b: number, s: Stage): number {
  // arrays and the stage in, not 9 doubles (a double argument to a call V8 does not inline is boxed)
  const u0 = u[b], u1 = u[b + 1], u2 = u[b + 2], v0 = v[b], v1 = v[b + 1], v2 = v[b + 2], bias = s.bias;
  const g0 = f32(W0 * add32(u1, -u0)), g1 = f32(W0 * add32(u2, -u0));
  const g2 = f32(H0 * add32(v1, -v0)), g3 = f32(H0 * add32(v2, -v0));
  // approximate lengths in doubles with error bounds
  let x = Math.abs(g0), y = Math.abs(g2);
  const rx = (x + y) * 0.34375 + Math.max(x, y) * 0.65625, ex = (x + y + rx) * EPS;
  x = Math.abs(g1); y = Math.abs(g3);
  const ry = (x + y) * 0.34375 + Math.max(x, y) * 0.65625, ey = (x + y + ry) * EPS;
  const Lx = Math.fround(rx - ex);
  let m = NaN;
  if (Lx === Math.fround(rx + ex)) {
    if (Lx > ry + ey) m = Lx;
    else if (Lx < ry - ey) { const my = Math.fround(ry - ey); if (my === Math.fround(ry + ey)) m = my; }
  }
  if (m !== m) {
    lenE(g0, g2); const lx = E.st32();
    lenE(g1, g3); const lyh = E.A[0], lyl = E.A[1];
    m = (lx > lyh || (lx === lyh && 0 > lyl)) ? lx : E.toF32(lyh, lyl);
  }
  const lod = f32((bits(m) - 0x3f800000) * 1.1920928955078125e-7);
  const t = (bias + lod) + 393216, e = (Math.abs(bias) + Math.abs(lod) + 393216) * EPS;
  let r = Math.fround(t - e);
  if (r !== Math.fround(t + e)) { E.ld(bias); E.fadd(lod); E.fadd(393216); r = E.st32(); }
  return (bits(r) << 16) >> 16;
}

/** alpha blend SRCALPHA / INVSRCALPHA / ADD (0x419b7e): S = f32(As*src) (exact products); the R destination factor
 *  is the unrounded 1 - As and its product is rounded once; the G product stays at 64 bits into the sum; B and A
 *  use f32(1 - As) with exact products */
function blendSrcAlpha(c: Float64Array, d: Float64Array): void {
  const as = c[3], om = 1 - as, omf = f32(om);
  const s0 = f32(as * c[0]), s1 = f32(as * c[1]), s2 = f32(as * c[2]), s3 = f32(as * as);
  // R: f32(E(om * dR)); om is exact in double unless As is below 2^-29
  let dr: number;
  const pr = om * d[0], er = Math.abs(pr) * EPS;
  if (1 - om === as && Math.fround(pr - er) === Math.fround(pr + er)) dr = Math.fround(pr);
  else { E.ld(1); E.fsub(as); E.fmul(d[0]); dr = E.st32(); }
  // the sums: exact in double (checked) is one rounding, else add32 (the G product, omf * dG, is exact in double)
  let x = dr, y = s0, t = x + y;
  c[0] = clamp01(t - x === y && t - y === x ? f32(t) : add32(x, y));
  x = omf * d[1]; y = s1; t = x + y;
  c[1] = clamp01(t - x === y && t - y === x ? f32(t) : add32(x, y));
  x = f32(omf * d[2]); y = s2; t = x + y;
  c[2] = clamp01(t - x === y && t - y === x ? f32(t) : add32(x, y));
  x = f32(omf * d[3]); y = s3; t = x + y;
  c[3] = clamp01(t - x === y && t - y === x ? f32(t) : add32(x, y));
}
/** point-sampled texel index 0x41280d */
function pointCoord(c: number, size: number): number {
  const t = c * size - 0.5;
  return ftol(c < 0 ? t - 0.5 : t + 0.5);
}
/** bilinear coordinate 0x412ec6: rint(32 * (c*size - 0.5)) as the signed 22-bit field of f32(... + 393216) */
export function linCoord(c: number, size: number): number {
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
    case 4: return -1;                            // BORDER: no texel
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
/** D3DTOP_SUBTRACT: f32(E(1 - E(E(1 - x1) + x2))) */
export function subtract32(x1: number, x2: number): number {
  const u = 1 - x1, v = u + x2, r = 1 - v, e = (1 + Math.abs(u) + Math.abs(x2) + Math.abs(v)) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  if (u + x1 === 1 && v - u === x2 && v - x2 === u && r + v === 1) return Math.fround(r);   // every step exact
  E.ld(1); E.fsub(x1); E.fadd(x2); E.fsubr(1); return E.st32();
}
/** the BLEND*ALPHA ops: f32(E(E(E(x1 - x2) * f) + x2)) */
export function lerp32(x1: number, x2: number, f: number): number {
  const dd = x1 - x2, r = dd * f + x2, e = ((Math.abs(x1) + Math.abs(x2)) * Math.abs(f) + Math.abs(x2) + Math.abs(r)) * EPS;
  const lo = Math.fround(r - e);
  if (lo === Math.fround(r + e)) return lo;
  E.ld(x1); E.fsub(x2); E.fmul(f); E.fadd(x2); return E.st32();
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
    case 10: return subtract32(x1, x2);
    case 11: E.ld(1); E.fsub(x1); E.fmul(x2); E.fadd(x1); return E.st32();
    case 12: case 13: case 16: return lerp32(x1, x2, op === 12 ? difA : op === 13 ? texA : curA);
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
    case 10: return subtract32(a1, a2);
    case 11: E.ld(1); E.fsub(a1); E.fmul(a2); E.fadd(a1); return E.st32();
    case 12: case 13: case 16: return lerp32(a1, a2, op === 12 ? difA : op === 13 ? texA : curA);
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
    factorE(db, 1, c, d, as, ad); E.fmul(d[1]); const gh = E.A[0], gl = E.A[1];
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
/** the destination R/G factor as left on the FPU (unrounded 1 - x), into E.A[0] / E.A[1] */
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
