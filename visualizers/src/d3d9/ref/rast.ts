// REF9's rasterizer (RefRast, d3dref9.dll) for triangles drawn with a ps_2_0 shader: DrawTriangle 0x10023262
// (rotation), PerTriangleSetup 0x1002701f (28.4 snap, determinant, cull, bounding box, the rhw plane), RDEdge::Set
// 0x1002891d / Test 0x10028ae3 (top-left rule), RDAttribute::Setup 0x10028ee1 (attribute planes), DoScanCnvTri
// 0x10029b8d (2x2 quads), DoScanCnvGenPixels 0x100296b3 (W per pixel, SampleAndInvertRHW 0x100275eb), EVAL
// (RDAttribute::SampleEx 0x10028dc7), the D16 depth test (depthTest), ExecShader (./ps.ts) and DoPixels 0x100251ab
// (ClampToRange, DoAlphaBlend 0x10024947, WritePixel 0x10025fc8 / ConvertTo 0x10020043). x87 work at 64 bits through
// ../../d3d8/ref/ext.
import { Fmt, Rs } from '../api';
import * as E from '../../d3d8/ref/ext';
import { PS_LEGACY, PS_OC, PS_REGS, PS_T, PS_V, type PixelShader9, type Sampler } from './ps';
import { B255, DITHER, type RefSurface9 } from './tex';
import { K9, heap, kernel9, refKernel9 } from './kernel';
import { Reg } from './vs';

const fr = Math.fround;
/** the PS inputs per shader (see Rasterizer9.inputs) */
/** The kernel's alpha kill: with SRCALPHA / INVSRCALPHA blending (ADD, every colour written) a pixel whose output
 *  alpha is 0 (+-0) blends to the target's own colour: f32(f32(s * 0) + f32(d * f32(1 - 0))) = d, clamped d, and
 *  trunc(d * 255 + 0.5) gives d's byte back (all 256 checked); an X8 target's byte 3 is written 0 as before. When
 *  oC0.w comes straight from a texld's .w (mov oC0, rX with .w from rX, the texld the last writer of rX.w), that texld
 *  runs as early as its dependences allow (an independent instruction: the same values) and the pixels whose alpha it
 *  gives 0 skip the rest (with texld coordinates from inputs only, no later DSX/DSY reads their registers). */
interface KillPlan { order: number[]; kill: number; reg: number }
const PLANS = new WeakMap<PixelShader9, KillPlan>();
function killPlan(ps: PixelShader9): KillPlan {
  let plan = PLANS.get(ps);
  if (plan) return plan;
  const prog = ps.prog, order = prog.map((_, i) => i);
  plan = { order, kill: -1, reg: 0 };
  PLANS.set(ps, plan);
  if (!ps.inputCoords) return plan;
  let m = -1;
  for (let i = 0; i < prog.length; i++) if (prog[i].dst === PS_OC) m = i;
  if (m < 0) return plan;
  const M = prog[m];
  if (M.op !== 1 || M.na || M.sat || !(M.mask & 8) || (M.a3 & 3) !== 3) return plan;
  const R = M.a3 - 3;
  let t = -1;
  for (let i = 0; i < m; i++) if (prog[i].dst === R && prog[i].mask & 8) t = i;
  if (t < 0 || prog[t].op !== 66 || prog[t].sat) return plan;
  const reads = (I: (typeof prog)[number]): number[] => (I.op === 66 ? [I.a0, I.a1] : [I.a0, I.a1, I.a2, I.a3, I.b0, I.b1, I.b2, I.b3, I.c0, I.c1, I.c2, I.c3]).map((x) => x & ~3);
  let pos = t;
  while (pos > 0 && prog[pos - 1].dst !== R && !reads(prog[pos - 1]).includes(R)) pos--;
  order.splice(t, 1); order.splice(pos, 0, t);
  plan.kill = pos; plan.reg = R + 3;
  return plan;
}

/** the shader and constants version whose constants the kernel's register files hold (one kernel per page) */
let kBound: PixelShader9 | null = null, kBoundVer = -1;
/** a PS input component: register offset in a pixel's file, vertex array (0 = col, 1 = tex) and index, whether a
 *  texld reads it as coordinates, whether EVAL clamps it to [0, 1] */
interface Input { reg: number; src: number; idx: number; coord: boolean; clamp: boolean }
/** per shader: its inputs [without, with] the specular colour (the legacy shader reads it only for SPECULARENABLE or a
 *  stage argument SPECULAR) */
const INPUTS = new WeakMap<PixelShader9, Input[][]>();
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);

/** D16 depth (RDDepth, format 0x50): a depth value d gives u = ftol2(clamp(d) * 65535 + 0.5) (operator unsigned
 *  0x100143c0) and reads back as invScale * u, invScale = dGetCnvInvScale 0x100169e3 (a hair under 1 / 65535); the
 *  snapped pixel depth (SnapDepth 0x1002a2fe) and the buffer's (ReadPixelDepth 0x10016286) both take that form, so
 *  DepthCloser 0x1002481f compares their u, and WritePixelDepth 0x100166cd stores u again (invScale * u * 65535 lies
 *  within 2^-30 of u, the + 0.5 rounds it back) */

/** a transformed vertex: screen x, y, z, rhw (floats), colours (diffuse rgba, specular rgba), texcoords t0..t7 */
export class TLVertex {
  x = 0; y = 0; z = 0; rhw = 1;
  col = new Float64Array(8);
  tex = new Float64Array(32);
  /** clip codes (ComputeClipCodes 0x10041bfc) */
  code = 0;
  /** [0, w] clip-space position (vertex-processed vertices; what the clipper interpolates) */
  cx = 0; cy = 0; cz = 0; cw = 1;
}

/** DoTextureBlendStage 0x1002d0cd: one component of a texture op on floats a1 (argument 1), a2 (argument 2); the
 *  products of floats are exact at 64 bits, so each result is one float rounding */
function legacyOp(op: number, a1: number, a2: number): number {
  switch (op) {
    case 2: return a1;                         // SELECTARG1
    case 3: return a2;                         // SELECTARG2
    case 4: return fr(a2 * a1);                // MODULATE (* 1.0)
    case 5: return fr(a2 * a1 * 2);            // MODULATE2X
    case 6: return fr(a2 * a1 * 4);            // MODULATE4X
    case 7: return fr(a2 + a1);                // ADD
    case 11: return addSmooth(a1, a2);         // ADDSMOOTH
    default: throw new Error('RefDevice9: texture op ' + op + ' is not implemented');
  }
}


/** ADDSMOOTH (0x1002d31f): f32((1 - a1) * a2 + a1) at 64 bits, three roundings; the double result errs by less than
 *  2^-51 (|p| + |a1|) and the 64-bit one less, so when both ends of that interval round to one float it is the result,
 *  else ext.ts's exact path */
function addSmooth(a1: number, a2: number): number {
  const p = (1 - a1) * a2, r = p + a1, e = (Math.abs(p) + Math.abs(a1)) * E.EPS, lo = fr(r - e);
  if (lo === fr(r + e)) return lo;
  E.ld(1); E.fsub(a1); E.fmul(a2); E.fadd(a1); return E.st32();
}

/** one attribute plane value*rhw = A x + B y + C (RDAttribute + 0x18..0x20) */
interface Plane { A: number; B: number; C: number; K: number }

export class Rasterizer9 {
  // per draw
  rs!: Uint32Array;
  rt!: RefSurface9;
  ps!: PixelShader9;
  consts!: Float32Array;
  samplers!: Sampler[];
  /** the PS inputs as (register offset in a pixel's file, vertex array 0 = col / 1 = tex, its index) per component */
  private inputs: Input[] = [];
  /** the texture stage states (Tss, 33 a stage) for the legacy shader */
  private tss!: Uint32Array;
  private legacy = false;
  private planes: Plane[] = [];
  // setup
  private X = new Int32Array(3); private Y = new Int32Array(3);
  private det = 0; private invDet = 0;
  private fX0 = 0; private fY0 = 0; private dX10 = 0; private dX02 = 0; private dY01 = 0; private dY20 = 0;
  private xmin = 0; private xmax = 0; private ymin = 0; private ymax = 0;
  private rhw: Plane = { A: 0, B: 0, C: 0, K: NaN };
  /** depth: ZFUNC (0 = no depth), the D16 buffer, its pitch in texels, ZWRITEENABLE, the z plane */
  private zfunc = 0; private ds: RefSurface9 | null = null; private zbuf: Uint16Array = new Uint16Array(0); private zpitch = 0; private zw = false;
  private zp: Plane = { A: 0, B: 0, C: 0, K: NaN };
  private eA = new Float64Array(3); private eB = new Float64Array(3); private eC = new Float64Array(3); private eI = new Uint8Array(3);
  private regs = new Float64Array(4 * PS_REGS);

  /** bind a draw: the PS inputs it evaluates (SetAttributeFunctions 0x100238da: v# = the colour attributes 0x20..,
   *  t# = the texture coordinates; every attribute perspective-correct (RDAttribute::Init 0x10028c5b sets +0x10)) */
  begin(rs: Uint32Array, rt: RefSurface9, ps: PixelShader9, consts: Float32Array, samplers: Sampler[], constVersion = -1, tss?: Uint32Array, ds: RefSurface9 | null = null): void {
    this.constVersion = constVersion;
    this.rs = rs; this.rt = rt; this.ps = ps; this.consts = consts; this.samplers = samplers;
    if (rt.format !== Fmt.X8R8G8B8 && rt.format !== Fmt.A8R8G8B8) throw new Error('RefDevice9: render target format');
    // depth (ZENABLE TRUE with a depth surface): ZFUNC on the pixel's u, ZWRITEENABLE writing it
    this.zfunc = 0;
    if (rs[Rs.ZENABLE] && ds) {
      if (rs[Rs.ZENABLE] !== 1) throw new Error('RefDevice9: W-buffering is not implemented');
      if (ds.format !== Fmt.D16) throw new Error('RefDevice9: depth format ' + ds.format);
      if (rs[Rs.DEPTHBIAS] || rs[Rs.SLOPESCALEDEPTHBIAS]) throw new Error('RefDevice9: depth bias is not implemented');
      this.zfunc = rs[Rs.ZFUNC] >= 1 && rs[Rs.ZFUNC] <= 7 ? rs[Rs.ZFUNC] : 8;
      this.ds = ds;
      this.zbuf = new Uint16Array(ds.data.buffer, ds.data.byteOffset, ds.data.byteLength >> 1);
      this.zpitch = ds.pitch >> 1;
      this.zw = rs[Rs.ZWRITEENABLE] !== 0;
    }
    if (rs[Rs.ALPHATESTENABLE]) throw new Error('RefDevice9: alpha testing is not implemented');
    this.dither = rs[Rs.DITHERENABLE] !== 0;
    if (rs[9] !== 2) throw new Error('RefDevice9: only GOURAUD shading is implemented');
    this.legacy = ps.version === PS_LEGACY;
    let spec = 0;
    if (this.legacy) {
      if (!tss) throw new Error('RefDevice9: the legacy pixel path needs the texture stage states');
      this.tss = tss;
      if (rs[Rs.FOGENABLE]) throw new Error('RefDevice9: fog is not implemented');
      spec = rs[Rs.SPECULARENABLE] ? 1 : 0;
      for (let s = 0; s < 8 && tss[s * 33 + 1] !== 1; s++) {
        for (const a of [2, 3, 5, 6, 26, 27]) if ((tss[s * 33 + a] & 0xf) === 4) spec = 1;
      }
    }
    let cached = INPUTS.get(ps);
    if (!cached) { cached = []; INPUTS.set(ps, cached); }
    if (cached[spec]) this.inputs = cached[spec];
    else {
      const inputs: Input[] = [];
      const add = (isCol: boolean, num: number, mask: number): void => {
        for (let j = 0; j < 4; j++) {
          if ((mask >> j) & 1) inputs.push({ reg: (isCol ? PS_V : PS_T) + num * 4 + j, src: isCol ? 0 : 1, idx: num * 4 + j, coord: ps.coordInputs.has((isCol ? PS_V : PS_T) + num * 4), clamp: isCol && ps.v1 });
        }
      };
      for (const d of ps.dcls) {
        if (d.type === Reg.SAMPLER) continue;
        const isCol = d.type === Reg.INPUT;
        if (!isCol && d.type !== 3) throw new Error('RefDevice9: pixel shader input type ' + d.type);
        add(isCol, d.num, d.mask);
      }
      // the legacy path's diffuse and specular (DoScanCnvGenPixels 0x100296b3: SampleEx clamped, into 0xdc8 / 0xe08)
      if (this.legacy) { add(true, 0, 0xf); if (spec) add(true, 1, 0xf); }
      cached[spec] = this.inputs = inputs;
    }
    while (this.planes.length < this.inputs.length) this.planes.push({ A: 0, B: 0, C: 0, K: NaN });
    if (constVersion < 0 || this.jsBound !== ps || this.jsBoundVer !== constVersion) { ps.bindConstants(this.regs, consts); this.jsBound = ps; this.jsBoundVer = constVersion; }
    this.live0 = ps.inputCoords ? 0 : 0xf;
    const blend = rs[Rs.ALPHABLENDENABLE] !== 0, cwe = rs[Rs.COLORWRITEENABLE] & 0xf;
    if (blend && rs[Rs.BLENDOP] !== 1) throw new Error('RefDevice9: only BLENDOP ADD is implemented');
    this.blend = blend; this.cwe = cwe; this.readDst = blend || cwe !== 0xf;
    this.sb = rs[Rs.SRCBLEND]; this.db = rs[Rs.DESTBLEND];
    if (blend) { this.factor(this.sb, 0); this.factor(this.db, 0); }   // unsupported factors throw here (pixel() inlines the rest)
    this.useK = this.upload();
    if (!this.useK && refKernel9.mode === 'wasm') throw new Error('RefDevice9: this draw cannot take the WebAssembly kernel');
  }
  /** the shader and constants version whose constants this.regs holds (-1 version: unknown, always copy) */
  private jsBound: PixelShader9 | null = null; private jsBoundVer = -1; private constVersion = -1;
  /** the draw goes through the WebAssembly kernel (./kernel-as.ts) */
  private useK = false;

  /** write the draw into the kernel's memory (layout: kernel-as.ts); false = the JS path (no kernel, or a surface in
   *  JS memory, or more than the kernel's tables hold) */
  private upload(): boolean {
    const K = kernel9(), ps = this.ps, rt = this.rt;
    if (!K || rt.heapOff < 0 || this.inputs.length > 16 || ps.prog.length > 64 || (this.zfunc && this.ds!.heapOff < 0)) return false;
    for (const I of ps.prog) {
      if (I.op !== 66) continue;
      const t = this.samplers[I.sampler].tex;
      if (I.sampler > 15 || (t && (t.mips.length > 12 || t.mips.some((m) => m.heapOff < 0)))) return false;
    }
    // the texel planes first (making one may grow the memory)
    for (const I of ps.prog) if (I.op === 66) for (const m of this.samplers[I.sampler].tex?.mips ?? []) m.planeFor();
    heap.refresh();
    const i32 = heap.i32, f64 = heap.f64, SI = K9.SI >> 2;
    i32[SI + 7] = this.live0; i32[SI + 9] = rt.heapOff; i32[SI + 10] = rt.pitch;
    i32[SI + 11] = rt.format === Fmt.X8R8G8B8 ? 1 : 0; i32[SI + 12] = this.readDst ? 1 : 0; i32[SI + 13] = this.blend ? 1 : 0;
    i32[SI + 14] = this.sb; i32[SI + 15] = this.db; i32[SI + 16] = this.cwe; i32[SI + 17] = ps.prog.length;
    const plan = killPlan(ps), kill = this.blend && this.sb === 5 && this.db === 6 && this.cwe === 15 && plan.kill >= 0;
    i32[SI + 18] = kill ? plan.kill : -1; i32[SI + 19] = plan.reg;
    i32[SI + 20] = ps.out; i32[SI + 21] = this.legacy ? 1 : 0; i32[SI + 22] = this.rs[Rs.SPECULARENABLE] ? 1 : 0;
    i32[SI + 23] = this.zfunc; i32[SI + 27] = this.dither ? 1 : 0;
    // a draw sampling its own target: the kernel keeps the target's plane current as it writes (JS reads the surface)
    const self = ps.prog.some((I) => I.op === 66 && this.samplers[I.sampler].tex?.mips.includes(rt));
    i32[SI + 28] = self ? rt.planeFor() : 0; i32[SI + 29] = rt.width;
    if (this.zfunc) { i32[SI + 24] = this.ds!.heapOff; i32[SI + 25] = this.zpitch; i32[SI + 26] = this.zw ? 1 : 0; }
    if (this.legacy) {
      // the stages up to the first COLOROP DISABLE; an op or argument legacyBlend would throw for takes the JS path
      const tss = this.tss, ops = (o: number): boolean => (o >= 2 && o <= 7) || o === 11, arg = (a: number): boolean => (a & 0xf) <= 5 && (a & 0xf) !== 3;
      let s = 0;
      for (; s < 8 && tss[s * 33 + 1] !== 1; s++) {
        const t = s * 33, o = (K9.SI >> 2) + 64 + 8 * s;
        if (!ops(tss[t + 1]) || !ops(tss[t + 4]) || !arg(tss[t + 2]) || !arg(tss[t + 3]) || !arg(tss[t + 5]) || !arg(tss[t + 6])) return false;
        i32[o] = tss[t + 1]; i32[o + 1] = tss[t + 4]; i32[o + 2] = tss[t + 2]; i32[o + 3] = tss[t + 3];
        i32[o + 4] = tss[t + 5]; i32[o + 5] = tss[t + 6]; i32[o + 6] = tss[t + 28];
      }
      if (s < 8) i32[(K9.SI >> 2) + 64 + 8 * s] = 1;
    }
    const prog = ps.prog;
    for (let n = 0; n < prog.length; n++) {
      const I = prog[kill ? plan.order[n] : n], o = (K9.PROG >> 2) + n * 24;
      i32[o] = I.op; i32[o + 1] = I.dst; i32[o + 2] = I.mask; i32[o + 3] = I.sat ? 1 : 0; i32[o + 4] = I.sampler;
      i32[o + 5] = I.a0; i32[o + 6] = I.a1; i32[o + 7] = I.a2; i32[o + 8] = I.a3; i32[o + 9] = I.na ? 1 : 0;
      i32[o + 10] = I.b0; i32[o + 11] = I.b1; i32[o + 12] = I.b2; i32[o + 13] = I.b3; i32[o + 14] = I.nb ? 1 : 0;
      i32[o + 15] = I.c0; i32[o + 16] = I.c1; i32[o + 17] = I.c2; i32[o + 18] = I.c3; i32[o + 19] = I.nc ? 1 : 0;
      if (I.op !== 66) continue;
      const sm = this.samplers[I.sampler], t = sm.tex, so = (K9.SAMP >> 2) + I.sampler * 64, st = sm.st;
      i32[so] = t ? 1 : 0;
      if (!t) continue;
      i32[so + 1] = t.mips.length; i32[so + 2] = st[5]; i32[so + 3] = st[6]; i32[so + 4] = st[7]; i32[so + 5] = st[8];
      i32[so + 6] = st[9]; i32[so + 7] = st[1]; i32[so + 8] = st[2]; i32[so + 9] = t.format;
      for (let l = 0; l < t.mips.length; l++) {
        const m = t.mips[l];
        i32[so + 16 + 4 * l] = m.heapOff; i32[so + 17 + 4 * l] = m.width; i32[so + 18 + 4 * l] = m.height; i32[so + 19 + 4 * l] = m.plane;
      }
    }
    if (this.constVersion < 0 || kBound !== ps || kBoundVer !== this.constVersion) {
      ps.bindConstants(f64.subarray(K9.REGS >> 3, (K9.REGS >> 3) + 4 * PS_REGS), this.consts);
      kBound = ps; kBoundVer = this.constVersion;
    }
    return true;
  }
  /** the pixels the shader must compute beyond the covered ones (0 when uncovered pixels can be skipped) */
  private live0 = 0xf;
  private dither = false;
  private blend = false; private readDst = false; private cwe = 0xf; private sb = 2; private db = 1;
  /** W when the rhw plane is constant (A = B = 0), else NaN */
  private wConst = NaN;

  /** DrawTriangle 0x10023262 */
  triangle(v0: TLVertex, v1: TLVertex, v2: TLVertex): void {
    // the vertex with the smallest x (then y) first
    let best = 0, bx = v0.x, by = v0.y;
    if (v1.x < bx || (v1.x === bx && v1.y < by)) { best = 1; bx = v1.x; by = v1.y; }
    if (v2.x < bx || (v2.x === bx && v2.y < by)) best = 2;
    const a = best === 0 ? v0 : best === 1 ? v1 : v2, b = best === 0 ? v1 : best === 1 ? v2 : v0, c = best === 0 ? v2 : best === 1 ? v0 : v1;
    if (this.setup(a, b, c)) return;
    const flip = this.det > 0, X = this.X, Y = this.Y;
    this.edge(0, flip, X[0], Y[0], X[1], Y[1]);
    this.edge(1, flip, X[1], Y[1], X[2], Y[2]);
    this.edge(2, flip, X[2], Y[2], X[0], Y[0]);
    for (let i = 0; i < this.inputs.length; i++) {
      const s = this.inputs[i], f = s.src === 0 ? 'col' : 'tex';
      this.plane(this.planes[i], a[f][s.idx], b[f][s.idx], c[f][s.idx], a.rhw, b.rhw, c.rhw);
    }
    // the z plane (SetAttributeFunctions 0x100238da: RDAttribute + 0x7ec, not perspective-correct: weights 1, d1 =
    // f32(z1 - z0), d2 = f32(z2 - z0), the rest as plane())
    if (this.zfunc) this.plane(this.zp, a.z, b.z, c.z, 1, 1, 1);
    // constant planes: W = f32(1 / C) everywhere (0 for C = 0); an attribute with A = B = 0 then evaluates to
    // f32(f32(C) * W) at every pixel (sum32x3(0, 0, C) = C, a float)
    const rh = this.rhw;
    this.wConst = rh.A === 0 && rh.B === 0 ? (rh.C === 0 ? 0 : fr(1 / rh.C)) : NaN;
    for (let i = 0; i < this.inputs.length; i++) {
      const p = this.planes[i];
      let K = this.wConst === this.wConst && p.A === 0 && p.B === 0 ? fr(p.C * this.wConst) : NaN;
      if (this.inputs[i].clamp && K === K) K = K > 1 ? 1 : K >= 0 ? K : 0;
      p.K = K;
    }
    if (this.useK) this.scanK(); else this.scan();
  }

  /** the triangle into the kernel's memory, then its scan */
  private scanK(): void {
    const K = kernel9()!;
    heap.refresh();
    const i32 = heap.i32, f64 = heap.f64, SI = K9.SI >> 2, SF = K9.SF >> 3, I = this.eI;
    i32[SI] = this.xmin; i32[SI + 1] = this.xmax; i32[SI + 2] = this.ymin; i32[SI + 3] = this.ymax;
    i32[SI + 4] = I[0]; i32[SI + 5] = I[1]; i32[SI + 6] = I[2];
    for (let k = 0; k < 3; k++) { f64[SF + k] = this.eA[k]; f64[SF + 3 + k] = this.eB[k]; f64[SF + 6 + k] = this.eC[k]; }
    f64[SF + 9] = this.wConst; f64[SF + 10] = this.rhw.A; f64[SF + 11] = this.rhw.B; f64[SF + 12] = this.rhw.C;
    f64[SF + 13] = this.zp.A; f64[SF + 14] = this.zp.B; f64[SF + 15] = this.zp.C;
    // the constant inputs go straight into the four pixels' registers (the same at every pixel: quad() would store
    // K each time), the others into the kernel's input table
    let n = 0;
    const R = K9.REGS >> 3;
    for (let i = 0; i < this.inputs.length; i++) {
      const p = this.planes[i], inp = this.inputs[i];
      if (p.K === p.K) { for (let k = 0; k < 4; k++) f64[R + k * PS_REGS + inp.reg] = p.K; continue; }
      const o = SF + 16 + 4 * n;
      f64[o] = p.A; f64[o + 1] = p.B; f64[o + 2] = p.C; f64[o + 3] = p.K;
      i32[SI + 32 + 2 * n] = inp.reg; i32[SI + 33 + 2 * n] = (inp.coord ? 1 : 0) | (inp.clamp ? 2 : 0);
      n++;
    }
    i32[SI + 8] = n;
    K.scan();
  }

  /** PerTriangleSetup 0x1002701f; true = nothing to draw */
  private setup(a: TLVertex, b: TLVertex, c: TLVertex): boolean {
    const snap = (v: number): number => { F1[0] = v + 786432; return (I1[0] << 10) >> 10; };   // f32(v + 786432): v float, sum exact
    const X0 = snap(a.x), Y0 = snap(a.y), X1 = snap(b.x), Y1 = snap(b.y), X2 = snap(c.x), Y2 = snap(c.y);
    const X = this.X, Y = this.Y;
    X[0] = X0; X[1] = X1; X[2] = X2; Y[0] = Y0; Y[1] = Y1; Y[2] = Y2;
    const dX10 = X1 - X0, dY20 = Y2 - Y0, dX02 = X0 - X2, dY01 = Y0 - Y1;
    const det = dY20 * dX10 - dY01 * dX02;
    this.det = det;
    const cull = this.rs[Rs.CULLMODE];
    if (det === 0 || (cull === 2 /* CW */ && det > 0) || (cull === 3 /* CCW */ && det < 0)) return true;
    // bounding box: trunc(min + 0.5) .. trunc(max + 0.5) of the float positions, clamped to the target
    const r = this.rt;
    this.xmin = Math.max(Math.trunc(Math.min(a.x, b.x, c.x) + 0.5), 0); this.xmax = Math.min(Math.trunc(Math.max(a.x, b.x, c.x) + 0.5), r.width - 1);
    this.ymin = Math.max(Math.trunc(Math.min(a.y, b.y, c.y) + 0.5), 0); this.ymax = Math.min(Math.trunc(Math.max(a.y, b.y, c.y) + 0.5), r.height - 1);
    this.fX0 = X0 * 0.0625; this.fY0 = Y0 * 0.0625;
    this.dX10 = dX10 * 0.0625; this.dX02 = dX02 * 0.0625; this.dY01 = dY01 * 0.0625; this.dY20 = dY20 * 0.0625;
    // 1 / f32(f32(det) / 256): the determinant is rounded to float first (fildll; fstps)
    this.invDet = fr(1 / (fr(det) * 0.00390625));
    // rhw plane (0x100274eb): d1, d2 rounded to float
    const w0 = a.rhw, d1 = fr(b.rhw - w0), d2 = fr(c.rhw - w0), p = this.rhw;
    E.ld(this.dY20 * d1); E.fadd(this.dY01 * d2); E.fmul(this.invDet); p.A = E.st32();
    E.ld(this.dX10 * d2); E.fadd(this.dX02 * d1); E.fmul(this.invDet); p.B = E.st32();
    E.ld(w0); E.fsub(p.A * this.fX0); E.fsub(p.B * this.fY0); p.C = E.st32();
    return false;
  }

  /** RDEdge::Set 0x1002891d */
  private edge(k: number, flip: boolean, xa: number, ya: number, xb: number, yb: number): void {
    let A = ya - yb, B = xb - xa;
    if (flip) { A = -A; B = -B; }
    this.eA[k] = A; this.eB[k] = B; this.eC[k] = -(ya * B + xa * A);
    this.eI[k] = (A !== 0 ? A > 0 : B > 0) ? 1 : 0;
  }

  /** RDAttribute::Setup 0x10028ee1 (perspective, no wrap): p0 = a0*w0 kept at 64 bits; d1 = f32(a1 w1 - p0),
   *  d2 = f32(a2 w2 - p0); A = f32((dY20 d1 + dY01 d2) * invDet), B = f32((dX02 d1 + dX10 d2) * invDet),
   *  C = f32((p0 - A fX0) - B fY0) */
  private plane(p: Plane, a0: number, a1: number, a2: number, w0: number, w1: number, w2: number): void {
    const p0 = a0 * w0;   // exact
    E.ld(a2 * w2); E.fsub(p0); const d2 = E.st32();
    E.ld(a1 * w1); E.fsub(p0); const d1 = E.st32();
    // fast path: every operand below is an exact double product, each result two 64-bit roundings of a sum of
    // them (and a product with invDet); the double evaluation and the 64-bit one both lie within 2^-50 of the
    // operands' magnitudes of the exact value, so when the float rounding of that interval is one non-zero value it
    // is the result (a zero, whose sign the double-double path decides, takes that path)
    const inv = this.invDet, x = this.dY20 * d1, y = this.dY01 * d2, u = this.dX02 * d1, v = this.dX10 * d2;
    let t = (x + y) * inv, e = (Math.abs(x) + Math.abs(y)) * Math.abs(inv) * 8.881784197001252e-16;
    let A = fr(t - e);
    if (A !== fr(t + e) || A === 0) { E.ld(x); E.fadd(y); E.fmul(inv); A = E.st32(); }
    t = (u + v) * inv; e = (Math.abs(u) + Math.abs(v)) * Math.abs(inv) * 8.881784197001252e-16;
    let B = fr(t - e);
    if (B !== fr(t + e) || B === 0) { E.ld(u); E.fadd(v); E.fmul(inv); B = E.st32(); }
    const ax = A * this.fX0, by = B * this.fY0;
    t = (p0 - ax) - by; e = (Math.abs(p0) + Math.abs(ax) + Math.abs(by)) * 8.881784197001252e-16;
    let C = fr(t - e);
    if (C !== fr(t + e) || C === 0) { E.ld(p0); E.fsub(ax); E.fsub(by); C = E.st32(); }
    p.A = A; p.B = B; p.C = C;
  }

  /** DoScanCnvTri 0x10029b8d + EvalPixelPosition 0x1002670c: edge e at pixel (x, y) is v = 16 B y + 16 A x + C (exact
   *  integers), inside iff v < 0 or (v = 0 and not inclusive), i.e. v - (incl ? 0 : 1) < 0; stepped incrementally */
  private scan(): void {
    const A = this.eA, B = this.eB, C = this.eC, I = this.eI;
    const a0 = A[0] * 16, a1 = A[1] * 16, a2 = A[2] * 16, b0 = B[0] * 16, b1 = B[1] * 16, b2 = B[2] * 16;
    const xmin = this.xmin, xmax = this.xmax, ymax = this.ymax;
    for (let y = this.ymin; y <= ymax; y += 2) {
      const d = y + 1 <= ymax;
      // edge values at (xmin, y), less one when not inclusive
      let e0 = b0 * y + a0 * xmin + C[0] - (I[0] ? 0 : 1), e1 = b1 * y + a1 * xmin + C[1] - (I[1] ? 0 : 1), e2 = b2 * y + a2 * xmin + C[2] - (I[2] ? 0 : 1);
      for (let x = xmin; x <= xmax; x += 2) {
        const r = x + 1 <= xmax;
        let cov = (e0 < 0 && e1 < 0 && e2 < 0) ? 1 : 0;
        if (r && e0 + a0 < 0 && e1 + a1 < 0 && e2 + a2 < 0) cov |= 2;
        if (d && e0 + b0 < 0 && e1 + b1 < 0 && e2 + b2 < 0) cov |= 4;
        if (r && d && e0 + a0 + b0 < 0 && e1 + a1 + b1 < 0 && e2 + a2 + b2 < 0) cov |= 8;
        if (cov) this.quad(x, y, cov);
        e0 += 2 * a0; e1 += 2 * a1; e2 += 2 * a2;
      }
    }
  }

  /** DoScanCnvGenPixels 0x100296b3 + ExecShader + DoPixels 0x100251ab for the quad at (x, y); cov = covered pixels */
  private quad(x: number, y: number, cov: number): void {
    if (this.zfunc) { cov = this.depthTest(x, y, cov); if (!cov) return; }
    const regs = this.regs, rh = this.rhw, wc = this.wConst, live = cov | this.live0, inputs = this.inputs, planes = this.planes;
    for (let k = 0; k < 4; k++) {
      const lk = (live >> k) & 1;
      if (!lk && k === 3) continue;
      const px = x + (k & 1), py = y + (k >> 1), b = k * PS_REGS;
      // SampleAndInvertRHW: f32(1 / f32((A x + B y) + C)), 0 for a zero rhw
      let W = wc;
      if (W !== W) { const r = E.sum32x3(rh.A * px, rh.B * py, rh.C); W = r === 0 ? 0 : fr(1 / r); }
      // EVAL (SampleEx): f32(f32((A x + B y) + C) * W); for a dead pixel only the texld coordinates (DSX/DSY read them)
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i];
        if (!lk && !inp.coord) continue;
        const p = planes[i], K = p.K;
        if (K === K) { regs[b + inp.reg] = K; continue; }
        // E.sum32x3 inline (a call would box the doubles): the products are exact; the double sum errs by <= 2^-52 of
        // the operands' magnitudes, the 64-bit one less, so equal float roundings of both ends decide it
        const xa = p.A * px, yb = p.B * py, C = p.C, sm = (xa + yb) + C, e = (Math.abs(xa) + Math.abs(yb) + Math.abs(C)) * E.EPS;
        const lo = fr(sm - e);
        let v = lo;
        if (lo !== fr(sm + e)) {
          // both additions exact (the common case when the bound straddles: cancelling terms): the float of the
          // exact sum, else the 64-bit path
          const ab = xa + yb;
          v = ab - xa === yb && ab - yb === xa && sm - ab === C && sm - C === ab ? fr(sm) : E.sum32x3(xa, yb, C);
        }
        v = fr(v * W);
        // SampleEx 0x10028dc7: the clamp flag (ps_1_x / legacy colours)
        regs[b + inp.reg] = inp.clamp ? (v > 1 ? 1 : v >= 0 ? v : 0) : v;
      }
    }
    this.ps.run(regs, live, this.samplers);
    const out = this.ps.out;
    for (let k = 0; k < 4; k++) {
      if (!((cov >> k) & 1)) continue;
      if (this.legacy) this.legacyBlend(k * PS_REGS);
      this.pixel(x + (k & 1), y + (k >> 1), k * PS_REGS + out);
    }
  }

  /** the quad's depth test: the covered pixels that pass, writing their u for ZWRITEENABLE (DoScanCnvGenPixels
   *  0x100296b3: z = RDAttribute::Sample 0x10028da6 = f32((B y + A x) + C) at 64 bits, u = ftol2(clamp(z) * 65535 +
   *  0.5), exact; DoPixels 0x100251ab tests after the shader and writes neither colour nor depth for a failing pixel, so a
   *  pixel that fails here is left out of the writes, the shader still running on the quad's other pixels) */
  private depthTest(x: number, y: number, cov: number): number {
    const zp = this.zp, zb = this.zbuf, zf = this.zfunc;
    let pass = 0;
    for (let k = 0; k < 4; k++) {
      if (!((cov >> k) & 1)) continue;
      const px = x + (k & 1), py = y + (k >> 1);
      const z = E.sum32x3(zp.B * py, zp.A * px, zp.C);
      const u = Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 65535 + 0.5), o = py * this.zpitch + px, b = zb[o];
      const ok = zf === 2 ? u < b : zf === 3 ? u === b : zf === 4 ? u <= b : zf === 5 ? u > b : zf === 6 ? u !== b : zf === 7 ? u >= b : zf !== 1;
      if (ok) { pass |= 1 << k; if (this.zw) zb[o] = u; }
    }
    return pass;
  }

  private cur = new Float64Array(4); private tmpc = new Float64Array(4); private a1 = new Float64Array(4); private a2 = new Float64Array(4);
  /** DoPixels 0x100251ab's legacy stages: DoTextureBlendStage 0x1002d0cd per stage up to COLOROP DISABLE (current
   *  starts as the diffuse colour, temp as 0; each stage clamped, RDColor::Clamp, into current or, RESULTARG TEMP,
   *  temp), then SPECULARENABLE's specular add (saturated); the result into oC0 of the pixel's file at b */
  private legacyBlend(b: number): void {
    const regs = this.regs, tss = this.tss, cur = this.cur, tmp = this.tmpc, A1 = this.a1, A2 = this.a2;
    for (let j = 0; j < 4; j++) { cur[j] = regs[b + PS_V + j]; tmp[j] = 0; }
    for (let s = 0; s < 8; s++) {
      const o = s * 33, cop = tss[o + 1], aop = tss[o + 4];
      if (cop === 1) break;
      if (cop === 0x16 || cop === 0x17) throw new Error('RefDevice9: bump mapping is not implemented');
      // colour: arguments 1 and 2 (ComputeTextureBlendArg 0x1002cffd), the op on r, g, b (x87 at 64 bits, floats)
      this.arg(tss[o + 2], false, b, s, A1); this.arg(tss[o + 3], false, b, s, A2);
      const c0 = legacyOp(cop, A1[0], A2[0]), c1 = legacyOp(cop, A1[1], A2[1]), c2 = legacyOp(cop, A1[2], A2[2]);
      this.arg(tss[o + 5], true, b, s, A1); this.arg(tss[o + 6], true, b, s, A2);
      const c3 = legacyOp(aop, A1[3], A2[3]);
      const d = tss[o + 28] === 5 ? tmp : cur;
      d[0] = c0 > 1 ? 1 : c0 >= 0 ? c0 : 0; d[1] = c1 > 1 ? 1 : c1 >= 0 ? c1 : 0;
      d[2] = c2 > 1 ? 1 : c2 >= 0 ? c2 : 0; d[3] = c3 > 1 ? 1 : c3 >= 0 ? c3 : 0;
    }
    if (this.rs[Rs.SPECULARENABLE]) {
      for (let j = 0; j < 3; j++) { const v = fr(cur[j] + regs[b + PS_V + 4 + j]); cur[j] = v > 1 ? 1 : v >= 0 ? v : 0; }
    }
    for (let j = 0; j < 4; j++) regs[b + PS_OC + j] = cur[j];
  }
  /** ComputeTextureBlendArg 0x1002cffd into out (r, g, b, a) */
  private arg(code: number, alpha: boolean, b: number, stage: number, out: Float64Array): void {
    const regs = this.regs;
    let src: Float64Array | null = null, o = 0;
    switch (code & 0xf) {
      case 0: src = regs; o = b + PS_V; break;                 // DIFFUSE
      case 1: src = this.cur; break;                            // CURRENT
      case 2: src = regs; o = b + PS_T + stage * 4; break;      // TEXTURE (the stage's tex tN)
      case 4: src = regs; o = b + PS_V + 4; break;              // SPECULAR
      case 5: src = this.tmpc; break;                           // TEMP
      default: throw new Error('RefDevice9: texture argument ' + code + ' is not implemented');
    }
    for (let j = 0; j < 4; j++) out[j] = src[o + j];
    if (code & 0x10) {                                          // COMPLEMENT: f32(1 - x)
      out[3] = fr(1 - out[3]);
      if (!alpha) { out[0] = fr(1 - out[0]); out[1] = fr(1 - out[1]); out[2] = fr(1 - out[2]); }
    }
    if (!alpha && code & 0x20) { out[0] = out[3]; out[1] = out[3]; out[2] = out[3]; }   // ALPHAREPLICATE
  }

  /** DoPixels 0x100251ab for one covered pixel with the shader's oC0 at regs[o] */
  private pixel(px: number, py: number, o: number): void {
    const regs = this.regs;
    // ClampToRange 0x1001dd02: [0, 1] for 8-bit targets
    let v = regs[o], r = v > 1 ? 1 : v >= 0 ? v : 0;
    v = regs[o + 1]; let g = v > 1 ? 1 : v >= 0 ? v : 0;
    v = regs[o + 2]; let b = v > 1 ? 1 : v >= 0 ? v : 0;
    v = regs[o + 3]; let a = v > 1 ? 1 : v >= 0 ? v : 0;
    const rt = this.rt, ro = py * rt.pitch + px * 4, d = rt.data, x8 = rt.format === Fmt.X8R8G8B8;
    if (this.readDst) {
      // ReadPixelColor: the target's bytes (X8: alpha 1)
      const tr = B255[d[ro + 2]], tg = B255[d[ro + 1]], tb = B255[d[ro]], ta = x8 ? 1 : B255[d[ro + 3]];
      if (this.blend) {
        // DoAlphaBlend 0x10024947: f32(f32(s * sf) + f32(d * df)), each product stored to float
        const sb = this.sb, db = this.db;
        const sf = sb === 5 ? a : sb === 6 ? fr(1 - a) : sb === 2 ? 1 : 0, df = db === 6 ? fr(1 - a) : db === 5 ? a : db === 2 ? 1 : 0;
        r = fr(fr(r * sf) + fr(tr * df)); g = fr(fr(g * sf) + fr(tg * df)); b = fr(fr(b * sf) + fr(tb * df)); a = fr(fr(a * sf) + fr(ta * df));
      }
      const cwe = this.cwe;
      if (!(cwe & 1)) r = tr;
      if (!(cwe & 2)) g = tg;
      if (!(cwe & 4)) b = tb;
      if (!(cwe & 8)) a = ta;
      r = r > 1 ? 1 : r >= 0 ? r : 0; g = g > 1 ? 1 : g >= 0 ? g : 0; b = b > 1 ? 1 : b >= 0 ? b : 0; a = a > 1 ? 1 : a >= 0 ? a : 0;
    }
    // WritePixel / ConvertTo 0x10020043: trunc(c * 255 + h), exact in double; h = 0.5, or with DITHERENABLE
    // (WritePixelColor 0x10016572) the 4x4 table's entry for (x & 3, y & 3)
    const h = this.dither ? DITHER[((px & 3) << 2) | (py & 3)] : 0.5;
    d[ro] = (b * 255 + h) | 0; d[ro + 1] = (g * 255 + h) | 0; d[ro + 2] = (r * 255 + h) | 0;
    d[ro + 3] = x8 ? 0 : (a * 255 + h) | 0;
  }

  /** a blend factor of the source alpha kind (0x10024947: 1 - x stored to float) */
  private factor(m: number, sa: number): number {
    switch (m) {
      case 1 /* ZERO */: return 0;
      case 2 /* ONE */: return 1;
      case 5 /* SRCALPHA */: return sa;
      case 6 /* INVSRCALPHA */: return fr(1 - sa);
      default: throw new Error('RefDevice9: blend factor ' + m + ' is not implemented');
    }
  }
}
