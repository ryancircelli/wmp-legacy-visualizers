// REF9's clipper (RefClipper, d3dref9.dll) with the guard band on (the RefClipper constructor 0x1003fa58: -32768 ..
// 32767 pixels): clip codes (ComputeClipCodes 0x10041bfc), the guard-band planes (UpdateViewData 0x1004349d) and
// ClipSingleTriangle 0x1004147f (front plane, then back and the guard-band planes; Interpolate 0x10043109;
// ComputeScreenCoordinates 0x10041f3b). x87 work at 64 bits through ../../d3d8/ref/ext.
import type { Viewport } from '../api';
import * as E from '../../d3d8/ref/ext';
import { TLVertex } from './rast';

const fr = Math.fround;
const GB0 = -32768, GB1 = 32767;   // 0xc7000000, 0x46fffe00 (x and y alike)
/** the sign bit (a negative number or -0) */
const sign = (x: number): boolean => x < 0 || Object.is(x, -0);

export class Clipper {
  private vp: Viewport | null = null;
  private vx = 0; private vyh = 0; private vw = 0; private vnh = 0; private dz = 0; private z0 = 0;
  /** the guard band in clip space: code planes (0x78 .. 0x84) and clipping planes (0x88 .. 0x94) */
  private c78 = 0; private c7c = 0; private c80 = 0; private c84 = 0;
  private c88 = 0; private c8c = 0; private c90 = 0; private c94 = 0;
  private pool: TLVertex[] = [];
  private used = 0;
  private bufA: TLVertex[] = [];
  private bufB: TLVertex[] = [];

  /** UpdateViewData 0x1004349d: the viewport's values, the guard band's planes */
  setViewport(vp: Viewport): void {
    if (this.vp && this.vp.x === vp.x && this.vp.y === vp.y && this.vp.w === vp.w && this.vp.h === vp.h &&
      this.vp.minZ === vp.minZ && this.vp.maxZ === vp.maxZ) return;
    this.vp = { ...vp };
    const X = vp.x, Y = vp.y, W = vp.w, H = vp.h;
    this.vx = X; this.vw = W; this.vnh = -H; this.vyh = fr(Y + H);
    this.dz = fr(vp.maxZ - vp.minZ); this.z0 = vp.minZ;
    E.ld(2); E.fdiv(W); const a = E.st32();
    E.ld(2); E.fdiv(H); const b = E.st32();
    E.ld(GB1 - X); E.fmul(a); E.fsub(1); const f6 = E.st32();
    E.ldMul(GB0 - X, a); E.fsubr(1); const f9 = E.st32();
    E.ld(f9); E.fadd(f6); E.fdivr(2); this.c78 = E.st32();
    E.ld(f9 - 1); E.fmul(this.c78); E.fmul(0.5); this.c80 = E.st32();
    E.ldMul(GB0 - Y, b); E.fsubr(1); const f7 = E.st32();
    E.ldMul(GB1 - Y, b); E.fsub(1); const f4 = E.st32();
    E.ld(f4); E.fadd(f7); E.fdivr(2); this.c7c = E.st32();
    E.ld(f4 - 1); E.fmul(this.c7c); E.fmul(0.5); this.c84 = E.st32();
    this.c88 = fr((1 - f9) * 0.5); this.c90 = fr((f6 + 1) * 0.5);
    this.c8c = fr((1 - f4) * 0.5); this.c94 = fr((f7 + 1) * 0.5);
  }

  /** ComputeClipCodes 0x10041bfc for [0, w] clip space: the sign bits of x, w - x, w - y, y, z, w - z; with any set,
   *  the guard band's: f32(c78 x + c80 w), f32(y c7c + c84 w) against 0 and w */
  codes(x: number, y: number, z: number, w: number): number {
    let code = (sign(x) ? 1 : 0) | (sign(fr(w - x)) ? 2 : 0) | (sign(fr(w - y)) ? 4 : 0) | (sign(y) ? 8 : 0) |
      (sign(z) ? 0x10 : 0) | (sign(fr(w - z)) ? 0x20 : 0);
    if (code === 0) return 0;
    E.ld(this.c78 * x); E.fadd(this.c80 * w); const gx = E.st32();
    E.ld(y * this.c7c); E.fadd(this.c84 * w); const gy = E.st32();
    if (sign(gx)) code |= 0x1000;
    if (sign(fr(w - gx))) code |= 0x2000;
    if (sign(fr(w - gy))) code |= 0x4000;
    if (sign(gy)) code |= 0x8000;
    return code;
  }

  private vertex(): TLVertex {
    if (this.used === this.pool.length) this.pool.push(new TLVertex());
    return this.pool[this.used++];
  }

  /** RefClipper::DrawTriangle 0x10042e83's clipping branch: copies of the three vertices (flag 0x40000), clipped
   *  (ClipSingleTriangle), drawn as a fan (RefDev::DrawOnePrimitive 0x10013b58: (v1, v2, v0), ...) */
  triangle(a: TLVertex, b: TLVertex, c: TLVertex, draw: (a: TLVertex, b: TLVertex, c: TLVertex) => void): void {
    this.used = 0;
    let poly = this.bufA;
    poly.length = 0;
    for (const v of [a, b, c]) { const n = this.vertex(); copy(v, n); n.code |= 0x40000; poly.push(n); }
    let or = a.code | b.code | c.code;
    if (or & 0xfc0) throw new Error('RefDevice9: user clip planes are not implemented');
    if (or & 0x10) {
      poly = this.clip(poly, 0x10000);
      if (poly.length < 3) return;
      // the new vertices' codes (ComputeClipCodeGB 0x10041afa)
      or = 0;
      for (const v of poly) {
        if (v.code & 0x10000) {
          const w = v.cw;
          let k = 0;
          if (v.cx < this.c88 * w) k = 0x1000;
          if (this.c90 * w < v.cx) k |= 0x2000;
          if (v.cy < this.c8c * w) k |= 0x8000;
          if (this.c94 * w < v.cy) k |= 0x4000;
          if (w < v.cz) k |= 0x20;
          v.code = (v.code & 0x50000) | k;
        }
        or |= v.code;
      }
    }
    for (const p of [0x20, 0x1000, 0x2000, 0x8000, 0x4000]) {
      if (!(or & p)) continue;
      poly = this.clip(poly, p);
      if (poly.length < 3) return;
    }
    for (const v of poly) if (v.code & ~0x40000) this.screen(v);
    for (let j = 1; j + 1 < poly.length; j++) draw(poly[j], poly[j + 1], poly[0]);
  }

  /** a plane's distance as the Clip* functions store it (a float; < 0 outside, -0 inside) */
  private dist(v: TLVertex, p: number): number {
    switch (p) {
      case 0x10000: return v.cz;                                              // ClipFront 0x100400d5
      case 0x20: return fr(v.cw - v.cz);                                      // ClipBack 0x1003fbac
      case 0x1000: E.ld(v.cw * this.c88); E.fsub(v.cx); return -E.st32();     // ClipLeftGB 0x10040347
      case 0x2000: E.ld(v.cw * this.c90); E.fsub(v.cx); return E.st32();      // ClipRightGB 0x1004115b
      case 0x8000: E.ld(v.cw * this.c8c); E.fsub(v.cy); return -E.st32();     // ClipBottomGB 0x1003fe20
      default: E.ld(v.cw * this.c94); E.fsub(v.cy); return E.st32();          // ClipTopGB 0x1004192f
    }
  }

  /** one plane (Sutherland-Hodgman from the last vertex; a new vertex interpolated from the inside one) */
  private clip(poly: TLVertex[], p: number): TLVertex[] {
    const out = poly === this.bufA ? this.bufB : this.bufA;
    out.length = 0;
    let prev = poly[poly.length - 1], dp = this.dist(prev, p);
    for (const cur of poly) {
      const dc = this.dist(cur, p);
      if (!(dp < 0)) {
        out.push(prev);
        if (dc < 0) out.push(this.lerp(prev, cur, p, dp, fr(dp - dc)));
      } else if (!(dc < 0)) {
        out.push(this.lerp(cur, prev, (prev.code & 0x40000) | p, dc, fr(dc - dp)));
      }
      prev = cur; dp = dc;
    }
    return out;
  }

  /** Interpolate 0x10043109: t = f32(d / diff); each value f32((out - in) t + in) at 64 bits (the position attribute
   *  is left to ComputeScreenCoordinates) */
  private lerp(i: TLVertex, o: TLVertex, flag: number, d: number, diff: number): TLVertex {
    const n = this.vertex();
    E.ld(d); E.fdiv(diff); const t = E.st32();
    const l = (a: number, b: number): number => { E.ld(b); E.fsub(a); E.fmul(t); E.fadd(a); return E.st32(); };
    n.code = (i.code & o.code & ~0x40000) | flag;
    n.cx = l(i.cx, o.cx); n.cy = l(i.cy, o.cy); n.cz = l(i.cz, o.cz); n.cw = l(i.cw, o.cw);
    for (let k = 0; k < 8; k++) n.col[k] = l(i.col[k], o.col[k]);
    for (let k = 0; k < 32; k++) n.tex[k] = l(i.tex[k], o.tex[k]);
    return n;
  }

  /** ComputeScreenCoordinates 0x10041f3b: rhw = f32(1 / w); x = f32((x W) rhw + X), y = f32((y (-H)) rhw + (Y + H)),
   *  each snapped to a guard-band edge its code names, else clamped to the guard band; z = f32((z dz) rhw + minZ) */
  private screen(v: TLVertex): void {
    E.ld(1); E.fdiv(v.cw); const rhw = E.st32();
    const cx = v.code & 0x3000, cy = v.code & 0xc000;
    if (cx === 0x1000) v.x = GB0;
    else if (cx === 0x2000) v.x = GB1;
    else { E.ld(v.cx); E.fmul(this.vw); E.fmul(rhw); E.fadd(this.vx); v.x = Math.min(Math.max(E.st32(), GB0), GB1); }
    if (cy === 0x4000) v.y = GB0;
    else if (cy === 0x8000) v.y = GB1;
    else { E.ld(v.cy); E.fmul(this.vnh); E.fmul(rhw); E.fadd(this.vyh); v.y = Math.min(Math.max(E.st32(), GB0), GB1); }
    E.ld(v.cz); E.fmul(this.dz); E.fmul(rhw); E.fadd(this.z0); v.z = E.st32();
    v.rhw = rhw;
  }
}

function copy(s: TLVertex, d: TLVertex): void {
  d.x = s.x; d.y = s.y; d.z = s.z; d.rhw = s.rhw; d.code = s.code;
  d.cx = s.cx; d.cy = s.cy; d.cz = s.cz; d.cw = s.cw;
  d.col.set(s.col); d.tex.set(s.tex);
}
