// The part of Microsoft's Direct3D 9 reference rasterizer (d3dref9.dll, 10.0.19041.685, Windows' own: the device
// D3DDEVTYPE_REF) that Analyzed's frames go through, bit for bit: pre-transformed triangles (rhw 1) with Gouraud
// diffuse and one texture stage (MODULATE texture by diffuse, bilinear, clamped), alpha blending
// (SRCALPHA/INVSRCALPHA add, SRCALPHA/ONE reverse subtract), into X8R8G8B8 targets. Its arithmetic is the D3D 8
// reference's (../d3d8/ref) with the FPU at 64 bits, but with more of its intermediates stored as floats; VAs in
// the comments are d3dref9.dll's (image base 0x10000000).
import * as E from '../d3d8/ref/ext';

const f32 = Math.fround;
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return I1[0]; };
/** ConvertFrom X8R8G8B8 (0x1001dac0): f32(byte * f32(1/255)) */
const B255 = new Float64Array(256);
for (let i = 0; i < 256; i++) B255[i] = f32(i * f32(1 / 255));

/** trunc(B255[b] * 255 + 0.5) === b for every byte (the write after a one-tap sample) */
const BYTE_ID = B255.every((v, b) => Math.trunc(v * 255 + 0.5) === b);

/** a render target or texture: 0x00RRGGBB pixels */
export interface Target { w: number; h: number; px: Uint32Array }
export const enum Blend { Over = 0, Fade = 1 }

/** 28.4 fixed point (0x1002701f): the low 22 mantissa bits of f32(x + 786432) */
const snap = (x: number): number => (bits(f32(x + 786432)) << 10) >> 10;

/** one attribute component's plane (0x10028ee1) with every vertex at rhw 1 */
class Plane {
  A = 0; B = 0; C = 0;
  set(a0: number, a1: number, a2: number, s: Setup): void {
    const d2 = f32(a2 - a0), d1 = f32(a1 - a0);
    // a flat plane: A and B are the triangle's zero gradients (signed zeros, the same for every flat plane of it),
    // and C = a0 exactly unless a0 is 0 (the zero's sign then comes from the 64-bit arithmetic)
    if (d1 === 0 && d2 === 0 && a0 !== 0) {
      if (!s.flatOk) { s.flatOk = true; ZERO.slow(0, 0, 0, s); s.flatA = ZERO.A; s.flatB = ZERO.B; }
      this.A = s.flatA; this.B = s.flatB; this.C = a0;
      return;
    }
    this.slow(a0, d1, d2, s);
  }
  slow(a0: number, d1: number, d2: number, s: Setup): void {
    E.ld(s.dY20 * d1); E.fadd(s.dY01 * d2); E.fmul(s.invDet); this.A = E.st32();
    E.ld(s.dX10 * d2); E.fadd(s.dX02 * d1); E.fmul(s.invDet); this.B = E.st32();
    E.ld(a0); E.fsub(this.A * s.fX0); E.fsub(this.B * s.fY0); this.C = E.st32();
  }
  /** 0x10028dc7: f32((y*B + x*A) + C) (times W = 1) */
  at(x: number, y: number): number { return E.sum32x3(y * this.B, x * this.A, this.C); }
}
/** scratch for the flat planes' gradients */
const ZERO = new Plane();
interface Setup {
  fX0: number; fY0: number; dX10: number; dX02: number; dY01: number; dY20: number; invDet: number;
  /** the flat planes' A and B, worked out once per triangle */
  flatOk: boolean; flatA: number; flatB: number;
}

/** one channel (at bit sh) of four texels as REF's bilinear sums it, fractions ku/32, kv/32: f32(w * B255[byte] + sum)
 *  per tap of weight w != 0, then the write's trunc(c * 255 + 0.5). Integers in and out: a double argument to a call
 *  that is not inlined would be boxed. */
function chain(sh: number, pa: number, pb: number, pc: number, pd: number, ku: number, kv: number): number {
  const fu = ku * 0.03125, gu = 1 - fu, fv = kv * 0.03125, gv = 1 - fv;
  let r = 0, wt: number;
  wt = gv * gu; if (wt !== 0) r = f32(wt * B255[(pa >>> sh) & 255] + r);
  wt = gv * fu; if (wt !== 0) r = f32(wt * B255[(pb >>> sh) & 255] + r);
  wt = fv * fu; if (wt !== 0) r = f32(wt * B255[(pc >>> sh) & 255] + r);
  wt = gu * fv; if (wt !== 0) r = f32(wt * B255[(pd >>> sh) & 255] + r);
  return Math.trunc(r * 255 + 0.5);
}

const clamp01 = (v: number): number => (v > 1 ? 1 : v >= 0 ? v : 0);

export class Ref9 {
  private s: Setup = { fX0: 0, fY0: 0, dX10: 0, dX02: 0, dY01: 0, dY20: 0, invDet: 0, flatOk: false, flatA: 0, flatB: 0 };
  private col = [new Plane(), new Plane(), new Plane(), new Plane()];
  private uv = [new Plane(), new Plane()];
  private eA = new Float64Array(3); private eB = new Float64Array(3); private eC = new Float64Array(3); private eI = new Uint8Array(3);
  private c = new Float64Array(4);
  private t = new Float64Array(4);

  clear(rt: Target, color: number): void { rt.px.fill(color & 0xffffff); }

  /** n vertices (a triangle list) of x, y, z, rhw, D3DCOLOR, u, v (f32 words; the colour's bits in vu) */
  draw(rt: Target, vf: Float32Array, vu: Uint32Array, n: number, tex: Target | null, blend: Blend): void {
    for (let i = 0; i + 2 < n; i += 3) this.triangle(rt, vf, vu, i * 7, i * 7 + 7, i * 7 + 14, tex, blend);
  }

  /** 0x10023262 */
  private triangle(rt: Target, vf: Float32Array, vu: Uint32Array, o0: number, o1: number, o2: number, tex: Target | null, blend: Blend): void {
    // the vertex with the smallest x (then y) first, the order rotated
    let a = o0, c1 = o1, c2 = o2;
    if (vf[o1] < vf[a] || (vf[o1] === vf[a] && vf[o1 + 1] < vf[a + 1])) { a = o1; c1 = o2; c2 = o0; }
    if (vf[o2] < vf[a] || (vf[o2] === vf[a] && vf[o2 + 1] < vf[a + 1])) { a = o2; c1 = o0; c2 = o1; }
    const X0 = snap(vf[a]), Y0 = snap(vf[a + 1]), X1 = snap(vf[c1]), Y1 = snap(vf[c1 + 1]), X2 = snap(vf[c2]), Y2 = snap(vf[c2 + 1]);
    const X10 = X1 - X0, Y20 = Y2 - Y0, X02 = X0 - X2, Y01 = Y0 - Y1;
    const det = Y20 * X10 - Y01 * X02;
    if (det <= 0) return;                 // degenerate, or counter-clockwise: CULLMODE CCW (the default)
    // bounding box (trunc(min + 0.5) .. trunc(max + 0.5)) in the target
    const xa = vf[a], xb = vf[c1], xc = vf[c2], ya = vf[a + 1], yb = vf[c1 + 1], yc = vf[c2 + 1];
    const x0 = Math.max(0, Math.trunc(Math.min(xa, xb, xc) + 0.5)), x1 = Math.min(rt.w - 1, Math.trunc(Math.max(xa, xb, xc) + 0.5));
    const y0 = Math.max(0, Math.trunc(Math.min(ya, yb, yc) + 0.5)), y1 = Math.min(rt.h - 1, Math.trunc(Math.max(ya, yb, yc) + 0.5));
    if (x0 > x1 || y0 > y1) return;
    const s = this.s;
    s.fX0 = X0 * 0.0625; s.fY0 = Y0 * 0.0625;
    s.dX10 = X10 * 0.0625; s.dX02 = X02 * 0.0625; s.dY01 = Y01 * 0.0625; s.dY20 = Y20 * 0.0625;
    s.invDet = f32(1 / f32(f32(det) * 0.00390625));
    s.flatOk = false;
    // edges 0x1002891d (det > 0: flipped)
    this.edge(0, X0, Y0, X1, Y1); this.edge(1, X1, Y1, X2, Y2); this.edge(2, X2, Y2, X0, Y0);
    // planes: diffuse R, G, B, A as bytes * f32(1/255) floats, then u, v
    const ca = vu[a + 4], cb = vu[c1 + 4], cc = vu[c2 + 4];
    for (let k = 0; k < 4; k++) {
      const sh = k === 3 ? 24 : 16 - 8 * k;
      this.col[k].set(B255[(ca >>> sh) & 255], B255[(cb >>> sh) & 255], B255[(cc >>> sh) & 255], s);
    }
    if (tex) { this.uv[0].set(vf[a + 5], vf[c1 + 5], vf[c2 + 5], s); this.uv[1].set(vf[a + 6], vf[c1 + 6], vf[c2 + 6], s); }
    // pixels (the scan's 2x2 quads only order the work: each pixel stands alone here). The same arithmetic, sped up
    // where a plane is flat in x or y (every quad Analyzed draws is axis-aligned): a colour per row, a texture
    // coordinate per column and per row, a blend table per destination byte for a flat colour.
    const cp = this.col;
    const flat = cp[0].A === 0 && cp[0].B === 0 && cp[1].A === 0 && cp[1].B === 0 && cp[2].A === 0 && cp[2].B === 0 && cp[3].A === 0 && cp[3].B === 0;
    if (tex) {
      if (flat && blend === Blend.Over && cp[0].C === 1 && cp[1].C === 1 && cp[2].C === 1 && cp[3].C === 1 && this.uv[0].B === 0 && this.uv[1].A === 0) {
        this.copyFiltered(rt, tex, x0, x1, y0, y1);
        return;
      }
    } else if (flat && (x1 - x0 + 1) * (y1 - y0 + 1) >= 1024) {
      this.flatTable(rt, blend, x0, x1, y0, y1);
      return;
    }
    const rowCol = cp[0].A === 0 && cp[1].A === 0 && cp[2].A === 0 && cp[3].A === 0;
    const px = rt.px, w = rt.w;
    for (let y = y0; y <= y1; y++) {
      const perRow = rowCol && !tex;
      if (perRow) this.colour(0, y);
      if (!this.span(y, x0, x1)) continue;
      // an opaque colour over SRCALPHA/INVSRCALPHA: the destination's factor is 0, so the row is one value
      if (perRow && blend === Blend.Over && this.c[3] === 1) { px.fill(this.blendWrite(0, blend), y * w + this.sx0, y * w + this.sx1 + 1); continue; }
      for (let x = this.sx0; x <= this.sx1; x++) {
        if (!perRow) this.shade(x, y, tex);
        const i = y * w + x;
        px[i] = this.blendWrite(px[i], blend);
      }
    }
  }

  /** the row's covered pixels, sx0..sx1 within x0..x1 (false: none): the three edges' tests (0x10028ae3) solved for x.
   *  The edge values are integers below 2^41, so the quotient is exact when it is an integer and otherwise at least
   *  2^-20 from one: floor/ceil of the double quotient are the integer answers. */
  private sx0 = 0; private sx1 = 0;
  private span(y: number, x0: number, x1: number): boolean {
    let lo = x0, hi = x1;
    for (let k = 0; k < 3; k++) {
      const A = this.eA[k] * 16, K = y * 16 * this.eB[k] + this.eC[k], incl = this.eI[k] !== 0;
      if (A === 0) { if (!(K < 0 || (K === 0 && !incl))) return false; continue; }
      const t = -K / A, exact = Number.isInteger(t);
      if (A > 0) { const m = exact && !incl ? t : Math.ceil(t) - 1; if (m < hi) hi = m; }
      else { const m = exact && !incl ? t : Math.floor(t) + 1; if (m > lo) lo = m; }
    }
    this.sx0 = lo; this.sx1 = hi;
    return lo <= hi;
  }
  /** the diffuse at (x, y), clamped (0x10028dc7) */
  private colour(x: number, y: number): void {
    const c = this.c;
    for (let k = 0; k < 4; k++) c[k] = clamp01(this.col[k].at(x, y));
  }

  /** a flat colour: the blend's result per destination byte, then a lookup per pixel */
  private lut = new Uint8Array(768);
  private flatTable(rt: Target, blend: Blend, x0: number, x1: number, y0: number, y1: number): void {
    this.colour(0, 0);
    const lut = this.lut;
    for (let b = 0; b < 256; b++) {
      const v = this.blendWrite((b << 16) | (b << 8) | b, blend);
      lut[b] = v >>> 16; lut[256 + b] = (v >>> 8) & 255; lut[512 + b] = v & 255;
    }
    const px = rt.px, w = rt.w;
    let pd = -1, pr = 0;   // the last destination colour and its result (runs of one colour are common)
    for (let y = y0; y <= y1; y++) {
      if (!this.span(y, x0, x1)) continue;
      for (let x = this.sx0; x <= this.sx1; x++) {
        const i = y * w + x, d = px[i];
        if (d !== pd) { pd = d; pr = (lut[(d >>> 16) & 255] << 16) | (lut[256 + ((d >>> 8) & 255)] << 8) | lut[512 + (d & 255)]; }
        px[i] = pr;
      }
    }
  }

  /** a texture drawn with white opaque diffuse and SRCALPHA/INVSRCALPHA: the filtered texel itself (alpha sums to 1,
   *  so the destination's factor is 0), u per column and v per row. Each sum of a weight times a texel and a float
   *  is exact in a double here (the weights are multiples of 1/1024), so f32 of it is the 64-bit result's. */
  private ca = new Int32Array(0); private cb = new Int32Array(0); private rv = new Int32Array(0);
  /** the fractions in 32nds (u per column, v per row) */
  private cn = new Int32Array(0); private rn = new Int32Array(0);
  private copyFiltered(rt: Target, tex: Target, x0: number, x1: number, y0: number, y1: number): void {
    const W = tex.w, H = tex.h, nx = x1 - x0 + 1, ny = y1 - y0 + 1;
    if (this.ca.length < nx) { this.ca = new Int32Array(nx); this.cb = new Int32Array(nx); this.cn = new Int32Array(nx); }
    if (this.rv.length < ny) { this.rv = new Int32Array(ny); this.rn = new Int32Array(ny); }
    const ca = this.ca, cb = this.cb, rv = this.rv, cn = this.cn, rn = this.rn;
    for (let x = x0; x <= x1; x++) {
      const n = (bits(f32(f32(this.uv[0].at(x, 0) * W - 0.5) + 393216)) << 10) >> 10;
      const i0 = n >> 5;
      ca[x - x0] = i0 < 0 ? 0 : i0 > W - 1 ? W - 1 : i0; cb[x - x0] = i0 + 1 < 0 ? 0 : i0 + 1 > W - 1 ? W - 1 : i0 + 1;
      cn[x - x0] = n & 31;
    }
    for (let y = y0; y <= y1; y++) {
      const n = (bits(f32(f32(this.uv[1].at(0, y) * H - 0.5) + 393216)) << 10) >> 10;
      rv[y - y0] = n >> 5; rn[y - y0] = n & 31;
    }
    const px = rt.px, w = rt.w, tp = tex.px, H1 = H - 1;
    // texel centres (every fraction 0): one tap of weight 1, so each channel is its byte through trunc(B255*255 + 0.5),
    // which gives the byte back (BYTE_ID): a copy
    if (BYTE_ID && cn.subarray(0, nx).every((v) => v === 0) && rn.subarray(0, ny).every((v) => v === 0)) {
      let run = true;   // consecutive texels for consecutive columns
      for (let i = 1; i < nx; i++) if (ca[i] !== ca[0] + i) { run = false; break; }
      for (let y = y0; y <= y1; y++) {
        if (!this.span(y, x0, x1)) continue;
        const j = rv[y - y0], ja = (j < 0 ? 0 : j > H1 ? H1 : j) * W, o = y * w, s0 = this.sx0, s1 = this.sx1;
        // the targets' pixels have no high byte (every write is 0x00RRGGBB), so a run of columns is a row copy
        if (run) px.set(tp.subarray(ja + ca[s0 - x0], ja + ca[s1 - x0] + 1), o + s0);
        else for (let x = s0; x <= s1; x++) px[o + x] = tp[ja + ca[x - x0]] & 0xffffff;
      }
      return;
    }
    // The bilinear sum in integers. The weights are k/1024 (fractions in 32nds), so with bytes a..d the exact
    // value of sum(w * byte) * 255 + 0.5 is N/1024, N = sum(1024w * byte) + 512. The float chain (texels B255[byte],
    // four f32 roundings) is off from it by under 1e-4 (B255[b]*255 is within 3.1e-5 of b; the roundings add at
    // most 4 * 2^-25 * 255), and N/1024 is 1/1024 or more from an integer unless N is a multiple of 1024: so the
    // byte is N >> 10, and only at those ties is the chain worked out, for that channel.
    for (let y = y0; y <= y1; y++) {
      const j0 = rv[y - y0], kv = rn[y - y0];
      const ja = (j0 < 0 ? 0 : j0 > H1 ? H1 : j0) * W, jb = (j0 + 1 < 0 ? 0 : j0 + 1 > H1 ? H1 : j0 + 1) * W;
      if (!this.span(y, x0, x1)) continue;
      const o = y * w;
      for (let x = this.sx0; x <= this.sx1; x++) {
        const ku = cn[x - x0], ia = ca[x - x0], ib = cb[x - x0];
        const w0 = (32 - kv) * (32 - ku), w1 = (32 - kv) * ku, w2 = kv * ku, w3 = (32 - ku) * kv;
        const pa = tp[ja + ia], pb = tp[ja + ib], pc = tp[jb + ib], pd = tp[jb + ia];
        let r = w0 * ((pa >>> 16) & 255) + w1 * ((pb >>> 16) & 255) + w2 * ((pc >>> 16) & 255) + w3 * ((pd >>> 16) & 255) + 512;
        let g = w0 * ((pa >>> 8) & 255) + w1 * ((pb >>> 8) & 255) + w2 * ((pc >>> 8) & 255) + w3 * ((pd >>> 8) & 255) + 512;
        let b = w0 * (pa & 255) + w1 * (pb & 255) + w2 * (pc & 255) + w3 * (pd & 255) + 512;
        if ((r & 1023) === 0 || (g & 1023) === 0 || (b & 1023) === 0) {   // a tie: those channels by the chain
          r = (r & 1023) === 0 ? chain(16, pa, pb, pc, pd, ku, kv) : r >> 10;
          g = (g & 1023) === 0 ? chain(8, pa, pb, pc, pd, ku, kv) : g >> 10;
          b = (b & 1023) === 0 ? chain(0, pa, pb, pc, pd, ku, kv) : b >> 10;
          px[o + x] = (r << 16) | (g << 8) | b;
        } else px[o + x] = ((r >> 10) << 16) | ((g >> 10) << 8) | (b >> 10);
      }
    }
  }

  private edge(k: number, xa: number, ya: number, xb: number, yb: number): void {
    const A = -(ya - yb), B = -(xb - xa);
    this.eA[k] = A; this.eB[k] = B; this.eC[k] = -(ya * B + xa * A);
    this.eI[k] = (A !== 0 ? A > 0 : B > 0) ? 1 : 0;
  }


  /** diffuse (clamped), the texture sample, the stage (MODULATE) */
  private shade(x: number, y: number, tex: Target | null): void {
    const c = this.c;
    for (let k = 0; k < 4; k++) c[k] = clamp01(this.col[k].at(x, y));
    if (!tex) return;   // no texture: the stage count stops before the stage (TEXTURE is its first argument)
    const t = this.sample(tex, this.uv[0].at(x, y), this.uv[1].at(x, y));
    for (let k = 0; k < 4; k++) c[k] = f32(t[k] * c[k]);
  }

  /** bilinear at level 0 (0x1001e166 coordinates, 0x100217ce weights, 0x100211ea clamp, fetch and sum) */
  private sample(tex: Target, u: number, v: number): Float64Array {
    const W = tex.w, H = tex.h;
    const nu = (bits(f32(f32(u * W - 0.5) + 393216)) << 10) >> 10, nv = (bits(f32(f32(v * H - 0.5) + 393216)) << 10) >> 10;
    const iu = nu >> 5, iv = nv >> 5;
    const fu = f32((nu & 31) * 0.03125), fv = f32((nv & 31) * 0.03125), gu = f32(1 - fu), gv = f32(1 - fv);
    const t = this.t; t[0] = 0; t[1] = 0; t[2] = 0; t[3] = 0;
    this.tap(tex, iu, iv, gv * gu);
    this.tap(tex, iu + 1, iv, gv * fu);
    this.tap(tex, iu + 1, iv + 1, fv * fu);
    this.tap(tex, iu, iv + 1, gu * fv);
    return t;
  }
  private tap(tex: Target, i: number, j: number, wt: number): void {
    if (wt === 0) return;
    i = i < 0 ? 0 : i > tex.w - 1 ? tex.w - 1 : i;
    j = j < 0 ? 0 : j > tex.h - 1 ? tex.h - 1 : j;
    const p = tex.px[j * tex.w + i], t = this.t;
    t[0] = E.add32(wt * B255[(p >>> 16) & 255], t[0]);
    t[1] = E.add32(wt * B255[(p >>> 8) & 255], t[1]);
    t[2] = E.add32(wt * B255[p & 255], t[2]);
    t[3] = E.add32(wt, t[3]);
  }

  /** alpha blend 0x10024947 (each product a float, one rounding for the sum), clamp, write trunc(c*255 + 0.5) */
  private blendWrite(dst: number, blend: Blend): number {
    const c = this.c, as = c[3];
    const d0 = B255[(dst >>> 16) & 255], d1 = B255[(dst >>> 8) & 255], d2 = B255[dst & 255];
    let r: number, g: number, b: number;
    if (blend === Blend.Over) {
      const fd = f32(1 - as);
      r = f32(f32(c[0] * as) + f32(d0 * fd)); g = f32(f32(c[1] * as) + f32(d1 * fd)); b = f32(f32(c[2] * as) + f32(d2 * fd));
    } else {
      r = f32(d0 - f32(c[0] * as)); g = f32(d1 - f32(c[1] * as)); b = f32(d2 - f32(c[2] * as));
    }
    return (Math.trunc(clamp01(r) * 255 + 0.5) << 16) | (Math.trunc(clamp01(g) * 255 + 0.5) << 8) | Math.trunc(clamp01(b) * 255 + 0.5);
  }
}
