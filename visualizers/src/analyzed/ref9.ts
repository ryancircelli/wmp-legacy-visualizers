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
    E.ld(s.dY20 * d1); E.fadd(s.dY01 * d2); E.fmul(s.invDet); this.A = E.st32();
    E.ld(s.dX10 * d2); E.fadd(s.dX02 * d1); E.fmul(s.invDet); this.B = E.st32();
    E.ld(a0); E.fsub(this.A * s.fX0); E.fsub(this.B * s.fY0); this.C = E.st32();
  }
  /** 0x10028dc7: f32((y*B + x*A) + C) (times W = 1) */
  at(x: number, y: number): number { return E.sum32x3(y * this.B, x * this.A, this.C); }
}
interface Setup { fX0: number; fY0: number; dX10: number; dX02: number; dY01: number; dY20: number; invDet: number }

const clamp01 = (v: number): number => (v > 1 ? 1 : v >= 0 ? v : 0);

export class Ref9 {
  private s: Setup = { fX0: 0, fY0: 0, dX10: 0, dX02: 0, dY01: 0, dY20: 0, invDet: 0 };
  private col = [new Plane(), new Plane(), new Plane(), new Plane()];
  private uv = [new Plane(), new Plane()];
  private eA = new Float64Array(3); private eB = new Float64Array(3); private eC = new Float64Array(3); private eI = new Uint8Array(3);
  private c = new Float64Array(4);
  private t = new Float64Array(4);
  /** with no texture bound the stage does not run (the stage count stops at it): the colour is the diffuse */
  noTexStageRuns = false;

  clear(rt: Target, color: number): void { rt.px.fill(color & 0xffffff); }

  /** n vertices (a triangle list) of x, y, z, rhw, D3DCOLOR, u, v (f32 words; the colour's bits in vu) */
  draw(rt: Target, vf: Float32Array, vu: Uint32Array, n: number, tex: Target | null, blend: Blend): void {
    for (let i = 0; i + 2 < n; i += 3) this.triangle(rt, vf, vu, i * 7, i * 7 + 7, i * 7 + 14, tex, blend);
  }

  /** 0x10023262 */
  private triangle(rt: Target, vf: Float32Array, vu: Uint32Array, o0: number, o1: number, o2: number, tex: Target | null, blend: Blend): void {
    // the vertex with the smallest x (then y) first, the order rotated
    const o = [o0, o1, o2];
    let b = 0;
    for (let k = 1; k < 3; k++) {
      if (vf[o[k]] < vf[o[b]] || (vf[o[k]] === vf[o[b]] && vf[o[k] + 1] < vf[o[b] + 1])) b = k;
    }
    const a = o[b], c1 = o[(b + 1) % 3], c2 = o[(b + 2) % 3];
    const X0 = snap(vf[a]), Y0 = snap(vf[a + 1]), X1 = snap(vf[c1]), Y1 = snap(vf[c1 + 1]), X2 = snap(vf[c2]), Y2 = snap(vf[c2 + 1]);
    const X10 = X1 - X0, Y20 = Y2 - Y0, X02 = X0 - X2, Y01 = Y0 - Y1;
    const det = Y20 * X10 - Y01 * X02;
    if (det <= 0) return;                 // degenerate, or counter-clockwise: CULLMODE CCW (the default)
    // bounding box (trunc(min + 0.5) .. trunc(max + 0.5)) in the target
    const xs = [vf[a], vf[c1], vf[c2]], ys = [vf[a + 1], vf[c1 + 1], vf[c2 + 1]];
    const x0 = Math.max(0, Math.trunc(Math.min(...xs) + 0.5)), x1 = Math.min(rt.w - 1, Math.trunc(Math.max(...xs) + 0.5));
    const y0 = Math.max(0, Math.trunc(Math.min(...ys) + 0.5)), y1 = Math.min(rt.h - 1, Math.trunc(Math.max(...ys) + 0.5));
    if (x0 > x1 || y0 > y1) return;
    const s = this.s;
    s.fX0 = X0 * 0.0625; s.fY0 = Y0 * 0.0625;
    s.dX10 = X10 * 0.0625; s.dX02 = X02 * 0.0625; s.dY01 = Y01 * 0.0625; s.dY20 = Y20 * 0.0625;
    s.invDet = f32(1 / f32(f32(det) * 0.00390625));
    // edges 0x1002891d (det > 0: flipped)
    this.edge(0, X0, Y0, X1, Y1); this.edge(1, X1, Y1, X2, Y2); this.edge(2, X2, Y2, X0, Y0);
    // planes: diffuse R, G, B, A as bytes * f32(1/255) floats, then u, v
    const ca = vu[a + 4], cb = vu[c1 + 4], cc = vu[c2 + 4];
    for (let k = 0; k < 4; k++) {
      const sh = k === 3 ? 24 : 16 - 8 * k;
      this.col[k].set(B255[(ca >>> sh) & 255], B255[(cb >>> sh) & 255], B255[(cc >>> sh) & 255], s);
    }
    if (tex) { this.uv[0].set(vf[a + 5], vf[c1 + 5], vf[c2 + 5], s); this.uv[1].set(vf[a + 6], vf[c1 + 6], vf[c2 + 6], s); }
    // pixels (the scan's 2x2 quads only order the work: each pixel stands alone here)
    const px = rt.px, w = rt.w;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(0, x, y) || !this.inside(1, x, y) || !this.inside(2, x, y)) continue;
        this.shade(x, y, tex);
        const i = y * w + x;
        px[i] = this.blendWrite(px[i], blend);
      }
    }
  }

  private edge(k: number, xa: number, ya: number, xb: number, yb: number): void {
    const A = -(ya - yb), B = -(xb - xa);
    this.eA[k] = A; this.eB[k] = B; this.eC[k] = -(ya * B + xa * A);
    this.eI[k] = (A !== 0 ? A > 0 : B > 0) ? 1 : 0;
  }
  /** 0x10028ae3 at the pixel centre (x*16, y*16): the top-left rule */
  private inside(k: number, x: number, y: number): boolean {
    const e = y * 16 * this.eB[k] + x * 16 * this.eA[k] + this.eC[k];
    return e < 0 || (e === 0 && this.eI[k] === 0);
  }

  /** diffuse (clamped), the texture sample, the stage (MODULATE) */
  private shade(x: number, y: number, tex: Target | null): void {
    const c = this.c;
    for (let k = 0; k < 4; k++) c[k] = clamp01(this.col[k].at(x, y));
    if (!tex) {
      if (this.noTexStageRuns) { c[0] = 0; c[1] = 0; c[2] = 0; }
      return;
    }
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
