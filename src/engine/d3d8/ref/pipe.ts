// The pipeline of RefDevice (../ref.ts): clears and draws (RefDev::ProcessPrimitive 0x420758 and the primitive
// assembly of 0x40ab50 / 0x40adea / 0x41e5d6 / 0x41e86c).
import { ClearFlag, Fmt, Prim, type Rect, Rs, primVertices } from '../api';
import type { RefDevice } from '../ref';
import { Clipper } from './clip';
import { ftol } from './num';
import { Rasterizer, type V } from './rast';
import { CODE, ST, TLBuf, VertexProcessor } from './vp';
import { VertexShaderVM } from './vs';

export interface UserVerts { data: Uint8Array; stride: number }

export class Pipeline {
  private vp = new VertexProcessor();
  private tl = new TLBuf();
  private rast = new Rasterizer();
  private clipper = new Clipper(this.vp, this.rast);
  readonly vm = new VertexShaderVM();
  constructor(private dev: RefDevice) {}

  /** Clear 0x40c31d: the rects (or the viewport) clipped to the viewport */
  clear(rects: Rect[] | null, flags: number, color: number, z: number): void {
    const d = this.dev, vp = d.st.vp;
    const area: Rect[] = [];
    const vr = { left: vp.x, top: vp.y, right: vp.x + vp.w, bottom: vp.y + vp.h };
    for (const r of rects ?? [vr]) {
      const a = { left: Math.max(r.left, vr.left), top: Math.max(r.top, vr.top), right: Math.min(r.right, vr.right), bottom: Math.min(r.bottom, vr.bottom) };
      if (a.left < a.right && a.top < a.bottom) area.push(a);
    }
    if (flags & ClearFlag.TARGET) {
      const t = d.rt, w = new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.byteLength >> 2), p = t.pitch >> 2;
      // 0x40ba7b: D3DCOLOR -> RDColor -> bytes gives the colour's bytes back exactly; X8R8G8B8's 4th byte is 0
      const v = (t.format === Fmt.X8R8G8B8 ? color & 0xffffff : color) >>> 0;
      for (const a of area) for (let y = a.top; y < a.bottom; y++) w.fill(v, y * p + a.left, y * p + a.right);
    }
    if ((flags & ClearFlag.ZBUFFER) && d.ds) {
      const t = d.ds, w = new Uint16Array(t.data.buffer, t.data.byteOffset, t.data.byteLength >> 1), p = t.pitch >> 1;
      const v = ftol(Math.min(Math.max(z, 0), 1) * 65535 + 0.5);   // 0x40b824 (z is a float: the product is exact)
      for (const a of area) for (let y = a.top; y < a.bottom; y++) w.fill(v, y * p + a.left, y * p + a.right);
    }
  }

  /** a draw: DrawPrimitive (indices null; base = start vertex), DrawIndexedPrimitive (base = BaseVertexIndex, nverts =
   *  MinIndex + NumVertices), or their UP forms (up = the user's vertices) */
  draw(type: Prim, count: number, indices: Uint8Array | null, isz: number, base: number, nverts: number, up: UserVerts | null): void {
    const d = this.dev, st = d.st;
    const sh = st.vs & 1 ? d.shader(st.vs) : undefined;
    if (st.vs & 1 && !sh?.fn) throw new Error('RefDevice: declaration-only vertex shaders are not implemented');
    const fvf = st.vs;
    if (!sh && (fvf & 0xe) === 4 /* XYZRHW */) throw new Error('RefDevice: pre-transformed vertices are not implemented');
    const nIdx = primVertices(type, count);
    const n = indices ? nverts : nIdx;
    const data = up ? up.data : st.streams[0].vb?.data, stride = up ? up.stride : st.streams[0].stride;
    if (!data || n <= 0) return;
    if (sh && up) throw new Error('RefDevice: UP draws with a vertex shader are not implemented');
    // active texture stages (0x40e0fd)
    let ns = 0;
    while (ns < 8) {
      const b = ns * 32;
      if (st.tss[b + 1] === 1 || (!st.tex[ns] && st.tss[b + 2] === 2)) break;
      ns++;
    }
    const vp = this.vp, tl = this.tl;
    const out = sh ? this.vm.process(st, sh, vp, base, n, tl) : vp.process(st, d.lightList, fvf, type, data, stride, up ? 0 : base, n, tl, ns);
    if (type !== Prim.POINTLIST && vp.isect !== 0) return;
    const rs = st.rs;
    this.rast.begin(st, d.rt, d.ds, out, ns);
    this.clipper.begin(out, rs[Rs.SHADEMODE] === 2, out.setDims.length, out.setDims);
    const needClip = vp.union !== 0, flat = rs[Rs.SHADEMODE] === 1;
    const f = tl.f;
    const idx = indices ? new DataView(indices.buffer, indices.byteOffset, indices.byteLength) : null;
    const at = (j: number): V => ({ f, o: (idx ? (isz === 4 ? idx.getUint32(j * 4, true) : idx.getUint16(j * 2, true)) : j) * ST });
    const tri = (a: V, b: V, c: V): void => { if (needClip) this.clipper.triangle(a, b, c, flat); else this.rast.triangle(a, b, c); };
    switch (type) {
      case Prim.POINTLIST:
        for (let j = 0; j < nIdx; j++) { const v = at(j); if (!needClip || (f[v.o + CODE] & 0xfff0) === 0) this.rast.point(v); }
        break;
      case Prim.TRIANGLELIST:
        for (let j = 0; j + 2 < nIdx; j += 3) tri(at(j), at(j + 1), at(j + 2));
        break;
      case Prim.TRIANGLESTRIP:
        for (let j = 0; j + 2 < nIdx; j++) { if (j & 1) tri(at(j), at(j + 2), at(j + 1)); else tri(at(j), at(j + 1), at(j + 2)); }
        break;
      case Prim.TRIANGLEFAN:
        for (let j = 1; j + 1 < nIdx; j++) tri(at(j), at(j + 1), at(0));
        break;
      default: throw new Error('RefDevice: lines are not implemented');
    }
  }
}
