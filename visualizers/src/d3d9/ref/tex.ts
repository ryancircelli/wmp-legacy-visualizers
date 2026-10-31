// REF9's surfaces, textures and texture sampler (CTextureSampler, d3dref9.dll): mip LOD from the quad derivatives
// (ComputeTextureCoverage 0x1001e82e, ComputeMipCoverage 0x1001e268, ComputePerLODControls 0x1001e404), bilinear
// sample lists (ComputeLinearSampleCoords 0x1001e166, SetupLinearSample 0x100217ce), fetch/address/accumulate
// (SampleTexture 0x100211ea, ReadColor 0x10020a77, RDColor::operator= 0x1001dac0) and the reference device's own mip
// generation (Dp2GenerateMipSubLevels 0x1000ff29).
import { Address, Filter, Fmt, type Locked, type Rect, Ss, type Surface9, type Texture9, Usage } from '../api';
import * as E from '../../d3d8/ref/ext';
import { heap, kernel9 } from './kernel';

const fr = Math.fround;
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
function bits(x: number): number { F1[0] = x; return I1[0]; }

/** a texel byte as REF reads it: f32(byte * f32(1/255)) (the product is exact in double) */
export const B255 = new Float64Array(256);
for (let i = 0; i < 256; i++) B255[i] = fr(i * 0.003921568859368563);

/** gives a collected surface's kernel memory back */
const RELEASE = typeof FinalizationRegistry === 'undefined' ? null : new FinalizationRegistry<[number, number]>(([o, n]) => heap.release(o, n));

export class RefSurface9 implements Surface9 {
  readonly pitch: number;
  readonly size: number;
  /** byte offset in the WebAssembly kernel's memory (./kernel), or -1 for JS memory */
  readonly heapOff: number;
  private buf: Uint8Array;
  private w32: Uint32Array;
  /** set when the texture owning this level must regenerate its sublevels (AUTOGENMIPMAP) */
  owner: RefTexture9 | null = null;
  /** the kernel's copy of the texels as doubles (r, g, b, a: the values REF's sampler reads, X8's alpha 1), 32 bytes a
   *  texel, made when the kernel first samples this surface and remade after its texels change (heap offset, -1 none) */
  plane = -1;
  planeDirty = true;
  constructor(readonly width: number, readonly height: number, readonly format: Fmt) {
    this.pitch = width * (format === Fmt.D16 ? 2 : 4);
    this.size = this.pitch * height;
    this.heapOff = kernel9() ? heap.alloc(this.size) : -1;
    this.buf = this.heapOff >= 0 ? new Uint8Array(heap.u8.buffer, this.heapOff, this.size) : new Uint8Array(this.size);
    this.w32 = new Uint32Array(this.buf.buffer, this.buf.byteOffset, this.size >> 2);
    if (this.heapOff >= 0) RELEASE?.register(this, [this.heapOff, this.size]);
  }
  /** the pixels (a view into the kernel's memory is re-made after the memory grew: the old one is detached) */
  get data(): Uint8Array {
    if (this.heapOff >= 0 && this.buf.byteLength === 0) {
      heap.refresh();
      this.buf = new Uint8Array(heap.u8.buffer, this.heapOff, this.size);
      this.w32 = new Uint32Array(heap.u8.buffer, this.heapOff, this.size >> 2);
    }
    return this.buf;
  }
  /** the same memory as 32-bit words (a texel of a 4-byte format: B | G << 8 | R << 16 | A << 24) */
  get u32(): Uint32Array { if (this.heapOff >= 0 && this.w32.byteLength === 0) void this.data; return this.w32; }
  lockRect(rect: Rect | null, _flags?: number): Locked {
    const off = rect ? rect.top * this.pitch + rect.left * (this.format === Fmt.D16 ? 2 : 4) : 0;
    return { data: this.data.subarray(off), pitch: this.pitch };
  }
  unlockRect(): void {
    this.planeDirty = true;
    if (this.owner && this.owner.mips[0] === this) this.owner.dirty = true;
  }
  /** the texel plane for the kernel (heap offset), made / remade here */
  planeFor(): number {
    if (this.plane < 0) {
      this.plane = heap.alloc(this.width * this.height * 32);
      RELEASE?.register(this, [this.plane, this.width * this.height * 32]);
      this.planeDirty = true;
    }
    if (this.planeDirty) {
      const d = this.u32, f = heap.f64, o = this.plane >> 3, x8 = this.format === Fmt.X8R8G8B8;
      for (let i = 0; i < d.length; i++) {
        const t = d[i], q = o + i * 4;
        f[q] = B255[(t >>> 16) & 255]; f[q + 1] = B255[(t >>> 8) & 255]; f[q + 2] = B255[t & 255]; f[q + 3] = x8 ? 1 : B255[t >>> 24];
      }
      this.planeDirty = false;
    }
    return this.plane;
  }
}

export class RefTexture9 implements Texture9 {
  /** the whole chain REF holds (an AUTOGENMIPMAP texture has every level although the application sees one) */
  readonly mips: RefSurface9[] = [];
  readonly levels: number;
  readonly autogen: boolean;
  /** level 0 changed since the sublevels were generated */
  dirty = false;
  constructor(readonly width: number, readonly height: number, levels: number, usage: number, readonly format: Fmt) {
    this.autogen = (usage & Usage.AUTOGENMIPMAP) !== 0;
    let w = width, h = height;
    const max = levels === 0 || this.autogen ? 32 : levels;
    while (this.mips.length < max) {
      const s = new RefSurface9(w, h, format);
      s.owner = this.autogen ? this : null;
      this.mips.push(s);
      if (w === 1 && h === 1) break;
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    this.levels = this.autogen ? 1 : this.mips.length;
  }
  getSurfaceLevel(level: number): Surface9 { return this.mips[level]; }
  lockRect(level: number, rect: Rect | null, _flags?: number): Locked { return this.mips[level].lockRect(rect); }
  unlockRect(level: number): void { this.mips[level].unlockRect(); }
}

/** the sampler states REF's texture controls derive from (UpdateTextureControlsForStage 0x10021ccf) */
export class SamplerState {
  s = new Uint32Array(14);
  constructor() { this.reset(); }
  reset(): void {
    const s = this.s;
    s.fill(0);
    s[Ss.ADDRESSU] = Address.WRAP; s[Ss.ADDRESSV] = Address.WRAP; s[Ss.ADDRESSW] = Address.WRAP;
    s[Ss.MAGFILTER] = Filter.POINT; s[Ss.MINFILTER] = Filter.POINT; s[Ss.MIPFILTER] = Filter.NONE;
    s[Ss.MAXANISOTROPY] = 1;
  }
}

/** what the sampler reads of a texture: its levels (a texture, or one level seen as a texture by mip generation) */
export interface MipChain { readonly mips: RefSurface9[] }

/** the per-sampler controls of one texld: levels and weights (CTextureSampler + 0x4c * sampler), and the inputs they
 *  were computed from (each texld keeps its own: the result depends only on the derivatives, the texture and the
 *  states, so it is reused while they repeat, as they mostly do between neighbouring quads of a triangle) */
export class LodControls {
  filter = 0; n = 1; l0 = 0; l1 = 0; w0 = 1; w1 = 1;
  tex: MipChain | null = null; st: Uint32Array | null = null;
  readonly key = new Float64Array(9).fill(NaN);
}

function filterOf(v: number): number { return v < 1 || (v > 3 && v - 6 > 2) ? 1 : v; }

/** ComputeTextureCoverage 0x1001e82e + ComputeMipCoverage 0x1001e268 (exact path: no legacy approximations) +
 *  ComputePerLODControls 0x1001e404. d[0..3] = du/dx, du/dy, dv/dx, dv/dy (the DSX/DSY results). */
export function lodControls(tex: MipChain, st: Uint32Array, d: Float64Array, out: LodControls): void {
  const k = out.key;
  if (out.tex === tex && out.st === st && k[0] === d[0] && k[1] === d[1] && k[2] === d[2] && k[3] === d[3] &&
      k[4] === st[Ss.MAGFILTER] && k[5] === st[Ss.MINFILTER] && k[6] === st[Ss.MIPFILTER] && k[7] === st[Ss.MIPMAPLODBIAS] && k[8] === st[Ss.MAXMIPLEVEL]) return;
  lodCompute(tex, st, d, out);
  out.tex = tex; out.st = st; k[0] = d[0]; k[1] = d[1]; k[2] = d[2]; k[3] = d[3];
  k[4] = st[Ss.MAGFILTER]; k[5] = st[Ss.MINFILTER]; k[6] = st[Ss.MIPFILTER]; k[7] = st[Ss.MIPMAPLODBIAS]; k[8] = st[Ss.MAXMIPLEVEL];
}
/** fdlibm's __ieee754_log, V8's Math.log (bit for bit on 26M test values), here so that every engine, and the
 *  WebAssembly kernel (kernel-as.ts flog), computes the same LOD */
const LF = new Float64Array(1), LU = new Uint32Array(LF.buffer);
export function flog(x: number): number {
  LF[0] = x; let hx = LU[1] | 0;
  const lx = LU[0];
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= 1.80143985094819840000e+16; LF[0] = x; hx = LU[1] | 0;
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  LF[0] = x; LU[1] = hx | (i0 ^ 0x3ff00000); x = LF[0];
  k += i0 >> 20;
  const f = x - 1.0, ln2hi = 6.93147180369123816490e-01, ln2lo = 1.90821492927058770002e-10;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : k * ln2hi + k * ln2lo;
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    return k === 0 ? f - R : k * ln2hi - ((R - k * ln2lo) - f);
  }
  const s = f / (2.0 + f), z = s * s, w = z * z;
  const i = (hx - 0x6147a) | (0x6b851 - hx);
  const t1 = w * (3.999999999940941908e-01 + w * (2.222219843214978396e-01 + w * 1.531383769920937332e-01));
  const t2 = z * (6.666666666666735130e-01 + w * (2.857142874366239149e-01 + w * (1.818357216161805012e-01 + w * 1.479819860511658591e-01)));
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : k * ln2hi - ((hfsq - (s * (hfsq + R) + k * ln2lo)) - f);
  }
  return k === 0 ? f - s * (f - R) : k * ln2hi - ((s * (f - R) - k * ln2lo) - f);
}

/** LOG2E as the double REF multiplies by (0x10003f78) */
const LOG2E = 1.4426950408889634;

function lodCompute(tex: MipChain, st: Uint32Array, d: Float64Array, out: LodControls): void {
  const mag0 = st[Ss.MAGFILTER], min0 = st[Ss.MINFILTER], mip0 = st[Ss.MIPFILTER];
  const needLod = mip0 === 1 || mip0 === 2 || mag0 !== min0;
  const magF = filterOf(mag0), minF = filterOf(min0), mip = mip0 > 2 ? 0 : mip0;
  out.n = 1; out.l0 = 0; out.l1 = 0; out.w0 = 1; out.w1 = 1;
  if (!needLod) { out.filter = minF; return; }
  // texel-space derivatives at level 0 (stored as floats), their lengths and log2 (all at 64 bits, stored to f32)
  const W = tex.mips[0].width, H = tex.mips[0].height;
  const g0 = fr(W * d[0]), g1 = fr(W * d[1]), g2 = fr(H * d[2]), g3 = fr(H * d[3]);
  const lx = fr(Math.sqrt(E.add32(g2 * g2, g0 * g0))), ly = fr(Math.sqrt(E.add32(g3 * g3, g1 * g1)));
  const m = ly < lx ? lx : ly;
  // ponytail: msvcrt _CIlog is FYL2X at 64 bits; fdlibm's log stands in (differs only next to a float midpoint)
  const ln = fr(flog(m));
  // f32(ln * LOG2E) at 64 bits: the double product errs by < 2^-53 relative, the 64-bit one by < 2^-64, so both lie
  // within e = 2^-51 |p| of p (p - e and p + e are exact: p scaled by 1 -+ 2^-51); when the float rounding of
  // [p - e, p + e] is one value it is the 64-bit result's (fast path), else the double-double product
  const p = ln * LOG2E, e = Math.abs(p) * 4.440892098500626e-16;
  let lod = fr(p - e);
  if (lod !== fr(p + e)) { E.ldMul(ln, LOG2E); lod = E.st32(); }
  lodFromValue(tex, st, lod, magF, minF, mip, out);
}

/** ComputePerLODControls 0x1001e404 for a LOD value (also DoTextureLookup's given LOD) */
export function lodFromValue(tex: MipChain, st: Uint32Array, lod0: number, magF: number, minF: number, mip: number, out: LodControls): void {
  I1[0] = st[Ss.MIPMAPLODBIAS];
  const lod = fr(F1[0] + lod0);
  const iLOD = (bits(fr(lod + 393216)) << 16) >> 16;    // 1/32 units
  const mag = iLOD <= 0;
  out.filter = mag ? magF : minF;
  out.n = 1; out.w0 = 1;
  const base = st[Ss.MAXMIPLEVEL] | 0, maxL = tex.mips.length - 1;
  if (mip === 0) { out.l0 = 0; return; }
  let l0: number;
  if (mag) l0 = Math.max(0, base);
  else if (mip === 1) l0 = Math.max((iLOD + 16) >> 5, base);
  else l0 = Math.max(iLOD >> 5, base);
  out.l0 = maxL <= l0 ? maxL : l0;
  if (mag || mip === 1) return;
  let l1 = Math.max((iLOD >> 5) + 1, base);
  l1 = maxL <= l1 ? maxL : l1;
  out.l1 = l1;
  if (out.l0 === l1 || (iLOD & 31) === 0) return;
  const f = (iLOD & 31) * 0.03125;
  out.n = 2; out.w1 = f; out.w0 = 1 - f;    // exact
}

/** clamp/wrap a texel coordinate as SampleTexture 0x100211ea does (mode 3 CLAMP, 1 WRAP, 2 MIRROR) */
function address(i: number, n: number, mode: number): number {
  if (i >= 0 && i <= n - 1) return i;
  if (mode === 3 /* CLAMP */) return i < 0 ? 0 : n - 1;
  if (mode === 1 /* WRAP */) { const r = i % n; return r < 0 ? r + n : r; }
  if (mode === 2 /* MIRROR */) { const u = i < 0 ? ~i : i, r = u % n; return ((u / n) | 0) & 1 ? n - 1 - r : r; }
  throw new Error('RefDevice9: texture address mode ' + mode + ' is not implemented');
}

/** ComputeLinearSampleCoords 0x1001e166: the 1/32 fixed-point texel coordinate bits(f32(f32(size*c - 0.5) + 393216)) */
export function linCoord(c: number, size: number): number { return (bits(fr(fr(size * c - 0.5) + 393216)) << 10) >> 10; }

/** sample `tex` at (u, v) with the controls `lc`, accumulating into out[o..o+3] (r, g, b, a) per SampleTexture: the
 *  components start at 0 and each sample adds f32(w * texel + acc). Every product and sum is exact in double (texels
 *  are multiples of f32(1/255)'s 2^-31, weights of 2^-15), so one fround is REF's rounding. */
export function sample(tex: MipChain, st: Uint32Array, lc: LodControls, uv: Float64Array, ou: number, ov: number, out: Float64Array, o: number): void {
  if (lc.filter !== 2 /* LINEAR */) throw new Error('RefDevice9: only LINEAR texture filtering is implemented');
  out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
  const au = st[Ss.ADDRESSU], av = st[Ss.ADDRESSV];
  level(tex.mips[lc.l0], lc, 0, uv, ou, ov, au, av, out, o);
  if (lc.n === 2) level(tex.mips[lc.l1], lc, 1, uv, ou, ov, au, av, out, o);
}
/** one level's four samples of SetupLinearSample in order: (i0, j0), (i1, j0), (i1, j1), (i0, j1). A zero weight
 *  adds an exact 0 (REF skips it: the same value). Doubles come in through arrays and objects only: as arguments
 *  of a call V8 does not inline they would be boxed (an allocation each). */
function level(m: RefSurface9, lc: LodControls, which: number, uv: Float64Array, ou: number, ov: number, au: number, av: number, out: Float64Array, o: number): void {
  const N = m.width, M = m.height, lw = which ? lc.w1 : lc.w0;
  F1[0] = fr(N * uv[ou] - 0.5) + 393216; const nu = (I1[0] << 10) >> 10;   // linCoord inline
  F1[0] = fr(M * uv[ov] - 0.5) + 393216; const nv = (I1[0] << 10) >> 10;
  const i0 = nu >> 5, j0 = nv >> 5;
  const fu = (nu & 31) * 0.03125, fv = (nv & 31) * 0.03125, gu = 1 - fu, gv = 1 - fv;
  const ws0 = gv * gu * lw, ws1 = gv * fu * lw, ws2 = fv * fu * lw, ws3 = gu * fv * lw;
  let x0 = i0, x1 = i0 + 1, y0 = j0, y1 = j0 + 1;
  if (x0 < 0 || x1 > N - 1) { x0 = address(x0, N, au); x1 = address(x1, N, au); }
  if (y0 < 0 || y1 > M - 1) { y0 = address(y0, M, av); y1 = address(y1, M, av); }
  const d = m.u32, r0 = y0 * N, r1 = y1 * N, am = m.format === Fmt.X8R8G8B8 ? 0 : 255, a1 = am ? 0 : 1;
  let r = out[o], g = out[o + 1], b = out[o + 2], a = out[o + 3], t: number;
  t = d[r0 + x0]; r = fr(B255[(t >>> 16) & 255] * ws0 + r); g = fr(B255[(t >>> 8) & 255] * ws0 + g); b = fr(B255[t & 255] * ws0 + b); a = fr((B255[(t >>> 24) & am] + a1) * ws0 + a);
  t = d[r0 + x1]; r = fr(B255[(t >>> 16) & 255] * ws1 + r); g = fr(B255[(t >>> 8) & 255] * ws1 + g); b = fr(B255[t & 255] * ws1 + b); a = fr((B255[(t >>> 24) & am] + a1) * ws1 + a);
  t = d[r1 + x1]; r = fr(B255[(t >>> 16) & 255] * ws2 + r); g = fr(B255[(t >>> 8) & 255] * ws2 + g); b = fr(B255[t & 255] * ws2 + b); a = fr((B255[(t >>> 24) & am] + a1) * ws2 + a);
  t = d[r1 + x0]; r = fr(B255[(t >>> 16) & 255] * ws3 + r); g = fr(B255[(t >>> 8) & 255] * ws3 + g); b = fr(B255[t & 255] * ws3 + b); a = fr((B255[(t >>> 24) & am] + a1) * ws3 + a);
  out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
}

/** WritePixelColor 0x10016572's dither offsets (0x10059530), by (x & 3) * 4 + (y & 3) */
export const DITHER = [1, 17, 5, 21, 25, 9, 29, 13, 7, 23, 3, 19, 31, 15, 27, 11].map((k) => k / 32);

const GEN_ST = new SamplerState().s;
GEN_ST[Ss.ADDRESSU] = Address.CLAMP; GEN_ST[Ss.ADDRESSV] = Address.CLAMP;
const GEN_LC = new LodControls();
const GEN_UV = new Float64Array(2);
const GEN_C = new Float64Array(4);

/** Dp2GenerateMipSubLevels 0x1000ff29: each level from the one above through a fresh sampler (MIN = `filter`, MAG
 *  and MIP NONE, CLAMP), LOD 1.0, at the level's texel centres u = f32((x + 0.5) / W); WritePixel (ConvertTo
 *  0x10020043): byte = trunc(c * 255 + 0.5).
 *  The x87 precision is whatever the DrawPrimitives2 batch has: BeginRendering 0x100143ea sets 64 bits only when the
 *  batch's first drawing token runs, so a GENERATEMIPSUBLEVELS ahead of it runs at the application's precision
 *  (Bubbles: 24 bits, CW 0x007F). At 24 bits every step of this path rounds as its float store does, except
 *  ConvertTo's c * 255 and + 0.5, which round to 24 bits before the truncation.
 *  WritePixel goes through the device's render target writer, so DITHERENABLE (RefDev+0x10d6f0) dithers the levels
 *  too: + DITHER[(x & 3) * 4 + (y & 3)] at the level's texel in place of + 0.5 (Distortion). */
export function generateMips(tex: RefTexture9, filter: number, pc64: boolean, dither: boolean): void {
  GEN_ST[Ss.MINFILTER] = filter;
  const x8 = tex.format === Fmt.X8R8G8B8;
  let h = 0.5;
  const cv = pc64 ? (c: number): number => (c * 255 + h) | 0 : (c: number): number => fr(fr(c * 255) + h) | 0;
  for (let L = 1; L < tex.mips.length; L++) {
    const src: MipChain = { mips: [tex.mips[L - 1]] }, dst = tex.mips[L], W = dst.width, H = dst.height, d = dst.data;
    lodFromValue(src, GEN_ST, 1, Filter.NONE, filterOf(filter), 0, GEN_LC);
    for (let y = 0; y < H; y++) {
      GEN_UV[1] = fr((y + 0.5) / H);
      for (let x = 0; x < W; x++) {
        GEN_UV[0] = fr((x + 0.5) / W);
        sample(src, GEN_ST, GEN_LC, GEN_UV, 0, 1, GEN_C, 0);
        if (dither) h = DITHER[((x & 3) << 2) | (y & 3)];
        const q = y * dst.pitch + x * 4;
        d[q] = cv(GEN_C[2]); d[q + 1] = cv(GEN_C[1]); d[q + 2] = cv(GEN_C[0]); d[q + 3] = x8 ? 0 : cv(GEN_C[3]);
      }
    }
    dst.planeDirty = true;
  }
  tex.dirty = false;
}
