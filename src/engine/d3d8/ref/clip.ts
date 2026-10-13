// REF's clipper (RefClipper, RD+0x110e8): triangles whose vertices carry near/far/guard-band codes are clipped
// (0x41e21b, polygon clipper 0x41dc52) against the near plane, then the far and guard-band planes, Sutherland-Hodgman
// style (0x41c8c0, 0x41c776, 0x41c9fc, 0x41cb56, 0x41ccac, 0x41ce06), new vertices interpolated by 0x41c07c; the
// polygon gets fresh screen coordinates (0x41bb36) and is drawn as a fan. The guard band (+-32768) is always on, so
// vertices outside only the viewport's sides are drawn unclipped.
import type { Rasterizer, V } from './rast';
import * as E from './ext';
import { heap, kernel } from './kernel';
import { CODE, CW, CX, CY, CZ, DIF, FOG, type OutFvf, PSZ, RHW, SPE, ST, SX, SY, SZ, TEX, type VertexProcessor } from './vp';

const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
/** REF's "inside" test on a float distance: bits <= 0x80000000 (>= 0, or -0) */
const inside = (d: number): boolean => { F1[0] = d; return U1[0] <= 0x80000000; };

const MAXV = 64;
export class Clipper {
  /** vertex pool for copies and new vertices (in the kernel's memory when it is loaded) */
  private pool: Float64Array = new Float64Array(0);
  private poolOff = -1;
  /** draws one triangle of a clipped polygon (the pipeline's choice of rasterizer) */
  draw: (a: V, b: V, c: V) => void = (a, b, c) => this.rast.triangle(a, b, c);
  ensurePool(): void {
    if (this.poolOff < 0 && kernel()) { this.poolOff = heap.alloc(MAXV * ST * 8); this.pool = heap.f64(this.poolOff, MAXV * ST); }
    else if (this.poolOff >= 0 && this.pool.byteLength === 0) this.pool = heap.f64(this.poolOff, MAXV * ST);   // memory grew
    else if (this.pool.length === 0) this.pool = new Float64Array(MAXV * ST);
  }
  private next = 0;
  private bufA = new Int32Array(MAXV); private bufB = new Int32Array(MAXV);
  private savedD = new Float64Array(4); private savedS = new Float64Array(4);
  private interp = 0;
  private texDims: number[] = [];
  constructor(private vp: VertexProcessor, private rast: Rasterizer) {}

  /** per draw (0x41cf5c): what new vertices interpolate */
  begin(out: OutFvf, gouraud: boolean, ntexOut: number, texDims: number[]): void {
    this.interp = (gouraud ? 1 | (out.specular ? 2 : 0) : 0) | (ntexOut ? 4 : 0) | (out.psize ? 8 : 0);
    this.texDims = texDims.slice(0, ntexOut);
  }

  /** 0x41e21b */
  triangle(a: V, b: V, c: V, flat: boolean): void {
    const ca = a.f[a.o + CODE], cb = b.f[b.o + CODE], cc = c.f[c.o + CODE];
    if ((ca & cb & cc) !== 0) return;
    if (((ca | cb | cc) & 0xfff0) === 0) { this.draw(a, b, c); return; }
    this.ensurePool();
    const P = this.pool;
    this.next = 0;
    const ia = this.copy(a), ib = this.copy(b), ic = this.copy(c);
    for (const i of [ia, ib, ic]) P[i + CODE] = (P[i + CODE] | 0x40000) >>> 0;
    if (flat) for (let k = 0; k < 8; k++) { P[ib + DIF + k] = P[ia + DIF + k]; P[ic + DIF + k] = P[ia + DIF + k]; }
    for (let k = 0; k < 4; k++) { this.savedD[k] = P[ia + DIF + k]; this.savedS[k] = P[ia + SPE + k]; }
    let src = this.bufA, dst = this.bufB;
    src[0] = ia; src[1] = ib; src[2] = ic;
    let n = 3;
    let union = (ca | cb | cc) >>> 0;
    const vp = this.vp;
    if (union & 0x10) {
      n = this.plane(src, n, dst, 0x10000, (o) => P[o + CZ]);
      if (n < 3) return;
      [src, dst] = [dst, src];
      union = 0;
      for (let i = 0; i < n; i++) {
        const o = src[i];
        let code = P[o + CODE];
        if (code & 0x10000) code = this.recode(o);
        union = (union | code) >>> 0;
      }
    }
    const planes: [number, number, (o: number) => number][] = [
      [0x20, 0x20000, (o) => { E.ld(P[o + CW]); E.fsub(P[o + CZ]); return E.st32(); }],
      [0x1000, 0x1000, (o) => { E.ld(P[o + CW] * vp.K88); E.fsub(P[o + CX]); return -E.st32(); }],
      [0x2000, 0x2000, (o) => { E.ld(P[o + CW] * vp.K90); E.fsub(P[o + CX]); return E.st32(); }],
      [0x8000, 0x8000, (o) => { E.ld(P[o + CW] * vp.K8c); E.fsub(P[o + CY]); return -E.st32(); }],
      [0x4000, 0x4000, (o) => { E.ld(P[o + CW] * vp.K94); E.fsub(P[o + CY]); return E.st32(); }],
    ];
    for (const [bit, flag, dist] of planes) {
      if (!(union & bit)) continue;
      n = this.plane(src, n, dst, flag, dist);
      if (n < 3) return;
      [src, dst] = [dst, src];
    }
    this.screen(src, n);
    // draw as a fan: (v[i], v[i+1], v[0])
    const v0: V = { f: P, o: src[0] };
    for (let i = 1; i + 1 < n; i++) this.draw({ f: P, o: src[i] }, { f: P, o: src[i + 1] }, v0);
  }

  private copy(v: V): number {
    const o = this.next++ * ST;
    this.pool.set(v.f.subarray(v.o, v.o + ST), o);
    return o;
  }

  /** one clip plane (Sutherland-Hodgman, 0x41c8c0 and kin): edges prev -> cur starting from the last vertex */
  private plane(src: Int32Array, n: number, dst: Int32Array, flag: number, dist: (o: number) => number): number {
    const P = this.pool;
    let m = 0;
    let prev = src[n - 1], dPrev = dist(prev);
    for (let i = 0; i < n; i++) {
      const cur = src[i], dCur = dist(cur);
      if (inside(dPrev)) {
        dst[m++] = prev;
        if (!inside(dCur)) {
          const o = this.next++ * ST;
          this.interpolate(o, prev, cur, flag, dPrev, f32sub(dPrev, dCur));
          dst[m++] = o;
        }
      } else if (inside(dCur)) {
        const o = this.next++ * ST;
        this.interpolate(o, cur, prev, (P[prev + CODE] & 0x40000) | flag, dCur, f32sub(dCur, dPrev));
        dst[m++] = o;
      }
      prev = cur; dPrev = dCur;
    }
    return m;
  }

  /** 0x41c07c: new vertex from the inside vertex a toward the outside vertex b */
  private interpolate(o: number, a: number, b: number, flag: number, da: number, diff: number): void {
    const P = this.pool;
    E.ld(da); E.fdiv(diff); const t = E.st32();
    P[o + CODE] = ((P[a + CODE] & P[b + CODE] & 0xfffbffff) | flag) >>> 0;
    const lerp = (k: number): number => { E.ld(P[b + k]); E.fsub(P[a + k]); E.fmul(t); E.fadd(P[a + k]); return E.st32(); };
    for (let k = CX; k <= CW; k++) P[o + k] = lerp(k);
    for (let k = 0; k < 4; k++) { P[o + DIF + k] = this.savedD[k]; P[o + SPE + k] = this.savedS[k]; }
    if (this.interp & 1) for (let k = 0; k < 4; k++) P[o + DIF + k] = lerp(DIF + k);
    if (this.interp & 2) for (let k = 0; k < 4; k++) P[o + SPE + k] = lerp(SPE + k);
    if (this.interp & 4) {
      for (let s = 0; s < this.texDims.length; s++) for (let k = 0; k < this.texDims[s]; k++) P[o + TEX + s * 4 + k] = lerp(TEX + s * 4 + k);
    }
    if (this.interp & 8) P[o + PSZ] = lerp(PSZ);
    if (this.interp & 0x10) P[o + FOG] = lerp(FOG);
  }

  /** codes of a new near-plane vertex 0x41bcf7 (guard band and far) */
  private recode(o: number): number {
    const P = this.pool, vp = this.vp, x = P[o + CX], y = P[o + CY], z = P[o + CZ], w = P[o + CW];
    let c = 0;
    if (x < vp.K88 * w) c |= 0x1000;
    if (vp.K90 * w < x) c |= 0x2000;
    if (y < vp.K8c * w) c |= 0x8000;
    if (vp.K94 * w < y) c |= 0x4000;
    if (w < z) c |= 0x20;
    P[o + CODE] = ((P[o + CODE] & 0x50000) | c) >>> 0;
    return c;
  }

  /** post-clip screen mapping 0x41bb36 (note the multiply order: (c * scale) * (1/w)) */
  private screen(list: Int32Array, n: number): void {
    const P = this.pool, vp = this.vp;
    for (let i = 0; i < n; i++) {
      const o = list[i], code = P[o + CODE];
      if ((code & 0xfffbffff) === 0) continue;
      E.ld(1); E.fdiv(P[o + CW]); const ih = E.A[0], il = E.A[1];
      if ((code & 0x3000) === 0x1000) P[o + SX] = -32768;
      else if ((code & 0x3000) === 0x2000) P[o + SX] = 32767;
      else {
        E.ld(P[o + CX] * vp.scaleX); E.fmulE(ih, il); E.fadd(vp.offX); let s = E.st32();
        if (s < -32768) s = -32768;
        if (32767 < s) s = 32767;
        P[o + SX] = s;
      }
      if ((code & 0xc000) === 0x4000) P[o + SY] = -32768;
      else if ((code & 0xc000) === 0x8000) P[o + SY] = 32767;
      else {
        E.ld(P[o + CY] * vp.scaleY); E.fmulE(ih, il); E.fadd(vp.offY); let s = E.st32();
        if (s < -32768) s = -32768;
        if (32767 < s) s = 32767;
        P[o + SY] = s;
      }
      E.ld(P[o + CZ] * vp.scaleZ); E.fmulE(ih, il); E.fadd(vp.offZ); P[o + SZ] = E.st32();
      P[o + RHW] = E.toF32(ih, il);
    }
  }
}

function f32sub(a: number, b: number): number { E.ld(a); E.fsub(b); return E.st32(); }
