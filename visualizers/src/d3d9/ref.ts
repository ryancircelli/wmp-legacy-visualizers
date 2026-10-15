// RefDevice9: the Direct3D 9 device as Microsoft's reference rasterizer draws it (Windows' d3dref9.dll
// 10.0.19041.685, driven by d3d9.dll with hardware vertex processing), bit for bit, for what the Psychedelia
// families use. VAs in comments are d3dref9.dll's (image base 0x10000000). This file holds the device: resources,
// state, clears, presents and the vertex stage (ProcessPrimitiveVVM 0x1003e051); ref/ holds the vertex shader VM,
// the rasterizer, the pixel shaders and the texture sampler.
import {
  type Buffer9, ClearFlag, type Device9, Fmt, type Point, type Pool, Prim, type Rect, Rs, type Ss, type Surface9, type Texture9,
} from './api';
import * as E from '../d3d8/ref/ext';
import { PixelShader9, type Sampler } from './ref/ps';
import { Rasterizer9, TLVertex } from './ref/rast';
import { RefSurface9, RefTexture9, SamplerState, generateMips } from './ref/tex';
import { Reg, VertexShader9 } from './ref/vs';

import { prepareKernel9, refKernel9 } from './ref/kernel';

export { RefSurface9, RefTexture9, refKernel9 };

const fr = Math.fround;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);

export class RefBuffer9 implements Buffer9 {
  readonly data: Uint8Array;
  constructor(readonly length: number) { this.data = new Uint8Array(length); }
  lock(offset: number, size: number, _flags?: number): Uint8Array { return this.data.subarray(offset, offset + (size || this.length - offset)); }
  private dv: DataView | null = null;
  /** the little-endian float at byte offset o */
  f32At(o: number): number { this.dv ??= new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength); return this.dv.getFloat32(o, true); }
  unlock(): void { /* writes went straight into the buffer */ }
}

/** a vertex declaration: its elements (D3DVERTEXELEMENT9) */
interface DeclElement { stream: number; offset: number; type: number; usage: number; index: number }

export class RefDevice9 implements Device9 {
  readonly bb: RefSurface9;
  readonly depth: RefSurface9;
  /** render states (D3D9's defaults) */
  readonly rs = new Uint32Array(256);
  readonly samplerStates: SamplerState[] = Array.from({ length: 16 }, () => new SamplerState());
  readonly textures: (RefTexture9 | null)[] = new Array<RefTexture9 | null>(16).fill(null);
  readonly vsc = new Float32Array(256 * 4);
  readonly psc = new Float32Array(32 * 4);
  private decls = new Map<number, DeclElement[]>();
  private vss = new Map<number, VertexShader9>();
  private pss = new Map<number, PixelShader9>();
  private next = 1;
  private decl: DeclElement[] | null = null;
  private vs: VertexShader9 | null = null;
  private ps: PixelShader9 | null = null;
  private streams: { vb: RefBuffer9 | null; offset: number; stride: number }[] = Array.from({ length: 16 }, () => ({ vb: null, offset: 0, stride: 0 }));
  /** viewport X, Y, Width, Height, MinZ, MaxZ */
  vp = { x: 0, y: 0, w: 0, h: 0, minZ: 0, maxZ: 1 };
  private rast = new Rasterizer9();
  private tl: TLVertex[] = [];
  private samplers: Sampler[] = Array.from({ length: 16 }, (_, i) => ({ tex: null, st: this.samplerStates[i].s }));
  /** per vertex shader and declaration: the inputs it fetches (register offset, stream, byte offset, type) */
  private fetch = new WeakMap<VertexShader9, { decl: DeclElement[]; f: number[] }>();
  /** a drawing token has run in the current DrawPrimitives2 batch (BeginRendering 0x100143ea: x87 at 64 bits) */
  private rendering = false;

  /** load the WebAssembly kernel asynchronously (a browser's main thread cannot compile it synchronously); devices
   *  and surfaces created after this resolves draw with it */
  static prepare(): Promise<void> { return prepareKernel9(); }

  constructor(readonly width: number, readonly height: number) {
    this.bb = new RefSurface9(width, height, Fmt.X8R8G8B8);
    this.depth = new RefSurface9(width, height, Fmt.D16);
    this.vp = { x: 0, y: 0, w: width, h: height, minZ: 0, maxZ: 1 };
    const rs = this.rs, f = (x: number): number => { F1[0] = x; return U1[0]; };
    rs[Rs.ZENABLE] = 1; rs[8] = 3; rs[9] = 2; rs[Rs.ZWRITEENABLE] = 1; rs[16] = 1; rs[Rs.SRCBLEND] = 2; rs[Rs.DESTBLEND] = 1;
    rs[Rs.CULLMODE] = 3; rs[Rs.ZFUNC] = 4; rs[Rs.ALPHAFUNC] = 8; rs[36] = 0; rs[37] = f(1); rs[38] = f(1);
    rs[Rs.LIGHTING] = 1; rs[136] = 1; rs[Rs.COLORWRITEENABLE] = 0xf; rs[Rs.BLENDOP] = 1; rs[60] = 0xffffffff;
  }

  // ---- resources ----
  createTexture(width: number, height: number, levels: number, usage: number, format: Fmt, _pool?: Pool): Texture9 {
    if (format !== Fmt.A8R8G8B8 && format !== Fmt.X8R8G8B8) throw new Error('RefDevice9: texture format ' + format);
    return new RefTexture9(width, height, levels, usage, format);
  }
  createVertexBuffer(length: number, _usage?: number, _fvf?: number, _pool?: Pool): Buffer9 { return new RefBuffer9(length); }
  createVertexDeclaration(elements: Uint8Array): number {
    const dv = new DataView(elements.buffer, elements.byteOffset, elements.byteLength), els: DeclElement[] = [];
    for (let o = 0; o + 8 <= elements.byteLength; o += 8) {
      const stream = dv.getUint16(o, true);
      if (stream === 0xff) break;
      els.push({ stream, offset: dv.getUint16(o + 2, true), type: elements[o + 4], usage: elements[o + 6], index: elements[o + 7] });
    }
    const h = this.next++;
    this.decls.set(h, els);
    return h;
  }
  createVertexShader(tokens: Uint32Array): number { const h = this.next++; this.vss.set(h, new VertexShader9(tokens)); return h; }
  createPixelShader(tokens: Uint32Array): number { const h = this.next++; this.pss.set(h, new PixelShader9(tokens)); return h; }
  getBackBuffer(): Surface9 { return this.bb; }
  /** UpdateSurface: a copy (an AUTOGENMIPMAP destination regenerates its sublevels when next sampled) */
  updateSurface(src: Surface9, srcRect: Rect | null, dst: Surface9, dstPoint: Point | null): void {
    const s = src as RefSurface9, d = dst as RefSurface9;
    const r = srcRect ?? { left: 0, top: 0, right: s.width, bottom: s.height }, px = dstPoint ? dstPoint.x : 0, py = dstPoint ? dstPoint.y : 0;
    const n = (r.right - r.left) * 4;
    for (let y = r.top; y < r.bottom; y++) {
      const so = y * s.pitch + r.left * 4;
      d.data.set(s.data.subarray(so, so + n), (py + y - r.top) * d.pitch + px * 4);
    }
    d.unlockRect();
  }

  // ---- frame ----
  beginScene(): void { /* nothing to do */ }
  endScene(): void { /* nothing to do */ }
  present(): Uint8Array { this.rendering = false; return this.bb.data; }
  /** Clear 0x10014794: the rects (or the viewport) clipped to the viewport; X8R8G8B8 takes the colour's bytes with
   *  byte 3 = 0 (RDColor -> ConvertTo gives each byte back), D16 = trunc(z * 65535 + 0.5) */
  clear(rects: Rect[] | null, flags: number, color: number, z: number, _stencil?: number): void {
    const vp = this.vp, vr = { left: vp.x, top: vp.y, right: vp.x + vp.w, bottom: vp.y + vp.h }, area: Rect[] = [];
    for (const r of rects ?? [vr]) {
      const a = { left: Math.max(r.left, vr.left), top: Math.max(r.top, vr.top), right: Math.min(r.right, vr.right), bottom: Math.min(r.bottom, vr.bottom) };
      if (a.left < a.right && a.top < a.bottom) area.push(a);
    }
    if (flags & ClearFlag.TARGET) {
      const t = this.bb, w = new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.byteLength >> 2), p = t.pitch >> 2;
      const v = (color & 0xffffff) >>> 0;
      for (const a of area) for (let y = a.top; y < a.bottom; y++) w.fill(v, y * p + a.left, y * p + a.right);
    }
    if (flags & ClearFlag.ZBUFFER) {
      const t = this.depth, w = new Uint16Array(t.data.buffer, t.data.byteOffset, t.data.byteLength >> 1), p = t.pitch >> 1;
      const v = Math.trunc(Math.min(Math.max(z, 0), 1) * 65535 + 0.5);
      for (const a of area) for (let y = a.top; y < a.bottom; y++) w.fill(v, y * p + a.left, y * p + a.right);
    }
  }

  // ---- state ----
  setRenderState(state: Rs, value: number): void { this.rs[state] = value; }
  setSamplerState(sampler: number, type: Ss, value: number): void { this.samplerStates[sampler].s[type] = value; }
  setTexture(stage: number, tex: Texture9 | null): void { this.textures[stage] = tex as RefTexture9 | null; }
  setStreamSource(stream: number, vb: Buffer9 | null, offsetBytes: number, stride: number): void {
    this.streams[stream] = { vb: vb as RefBuffer9 | null, offset: offsetBytes, stride };
  }
  setVertexDeclaration(decl: number): void { this.decl = this.decls.get(decl) ?? null; }
  setVertexShader(shader: number): void { this.vs = this.vss.get(shader) ?? null; }
  setPixelShader(shader: number): void { this.ps = this.pss.get(shader) ?? null; }
  setVertexShaderConstantF(register: number, data: Float32Array, count: number): void { this.vsc.set(data.subarray(0, count * 4), register * 4); }
  setPixelShaderConstantF(register: number, data: Float32Array, count: number): void { this.psc.set(data.subarray(0, count * 4), register * 4); this.pscVersion++; }
  /** bumped by every SetPixelShaderConstantF (the rasterizer re-copies the constants only after a change) */
  private pscVersion = 0;

  // ---- drawing ----
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void {
    const vs = this.vs, ps = this.ps, decl = this.decl;
    if (!vs || !ps || !decl) throw new Error('RefDevice9: draws need a vertex declaration, a vertex shader and a pixel shader');
    const n = type === Prim.TRIANGLELIST ? primitiveCount * 3 : primitiveCount + 2;
    while (this.tl.length < n) this.tl.push(new TLVertex());
    for (let i = 0; i < n; i++) this.vertex(vs, decl, startVertex + i, this.tl[i]);
    const samplers = this.samplers;
    for (let i = 0; i < 16; i++) samplers[i].tex = this.textures[i];
    // the runtime has REF generate a dirty AUTOGENMIPMAP texture's sublevels ahead of the draw that uses it, at the
    // batch's precision (see generateMips): 64 bits once a draw has run since the last Present
    for (const t of this.textures) if (t?.dirty) generateMips(t, 2, this.rendering);
    this.rast.begin(this.rs, this.bb, ps, this.psc, samplers, this.pscVersion);
    const tri = (a: TLVertex, b: TLVertex, c: TLVertex): void => {
      // RefClipper::DrawTriangle 0x10042e83: all outside one plane -> nothing; outside the guard band -> clip
      if (a.code & b.code & c.code) return;
      if ((a.code | b.code | c.code) & 0xfff0) throw new Error('RefDevice9: clipping is not implemented');
      this.rast.triangle(a, b, c);
    };
    this.rendering = true;
    const v = this.tl;
    switch (type) {
      case Prim.TRIANGLELIST: for (let j = 0; j + 2 < n; j += 3) tri(v[j], v[j + 1], v[j + 2]); break;
      // (v0, v1, v2), (v1, v3, v2), (v2, v3, v4), ...
      case Prim.TRIANGLESTRIP: for (let j = 0; j + 2 < n; j++) { if (j & 1) tri(v[j], v[j + 2], v[j + 1]); else tri(v[j], v[j + 1], v[j + 2]); } break;
      // DrawOnePrimitive 0x10013b58: (v1, v2, v0), (v2, v3, v0), ... the centre last
      case Prim.TRIANGLEFAN: for (let j = 1; j + 1 < n; j++) tri(v[j], v[j + 1], v[0]); break;
      default: throw new Error(`RefDevice9: primitive type ${String(type)} is not implemented`);
    }
  }

  /** one vertex of ProcessPrimitiveVVM 0x1003e051: fetch (Copy_FLOATn: missing components from (0, 0, 0, 1)), the
   *  shader, then clip space -> screen */
  private vertex(vs: VertexShader9, decl: DeclElement[], index: number, out: TLVertex): void {
    const v = vs.v;
    let fe = this.fetch.get(vs);
    if (!fe || fe.decl !== decl) {
      // (register offset, stream, element offset, type) per declared input; -1 stream: not in the declaration
      const f: number[] = [];
      for (const d of vs.dcls) {
        if (d.type !== Reg.INPUT) continue;
        const el = decl.find((e) => e.usage === d.usage && e.index === d.index);
        if (el && el.type > 3) throw new Error('RefDevice9: vertex element type ' + el.type + ' is not implemented');
        f.push(d.num * 4, el ? el.stream : -1, el ? el.offset : 0, el ? el.type : 0);
      }
      fe = { decl, f };
      this.fetch.set(vs, fe);
    }
    const f = fe.f;
    for (let i = 0; i < f.length; i += 4) {
      const o = f[i];
      v[o] = 0; v[o + 1] = 0; v[o + 2] = 0; v[o + 3] = 1;
      if (f[i + 1] < 0) continue;
      const s = this.streams[f[i + 1]], vb = s.vb;
      if (!vb) throw new Error('RefDevice9: no vertex buffer on stream ' + f[i + 1]);
      const b = s.offset + index * s.stride + f[i + 2];
      for (let j = 0; j <= f[i + 3]; j++) v[o + j] = vb.f32At(b + j * 4);
    }
    vs.run(this.vsc);
    const P = vs.oPos, w = P[3];
    // clip space [0, w] (0x1003e642): x' = f32((x + w) * 0.5), y' = f32((y + w) * 0.5) at 64 bits
    E.ld(P[0]); E.fadd(w); E.fmul(0.5); const xc = E.st32();
    E.ld(P[1]); E.fadd(w); E.fmul(0.5); const yc = E.st32();
    const z = P[2];
    // ComputeClipCodes 0x10041bfc: the sign bits of x', w - x', y', w - y', z, w - z (-0 counts as outside)
    const neg = (x: number): number => (x < 0 || Object.is(x, -0) ? 1 : 0);
    let code = neg(xc) | neg(fr(w - xc)) << 1 | neg(fr(w - yc)) << 2 | neg(yc) << 3 | neg(z) << 4 | neg(fr(w - z)) << 5;
    if (code !== 0 && (code & ~0xf) === 0) {
      // the guard band (RefClipper 0x1003fa58: -32768 .. 32767 pixels)
      const sx = xc / w * this.vp.w + this.vp.x, sy = -yc / w * this.vp.h + this.vp.y + this.vp.h;
      // ponytail: the guard-band planes evaluated in doubles, not REF's float plane test; only decides whether a
      // triangle needs the (unported) clipper, which throws
      if (!(sx >= -32768 && sx <= 32767 && sy >= -32768 && sy <= 32767)) code |= 0x1000;
    }
    out.code = code;
    // rhw = f32(1 / w); screen (0x1003e71b): f32(rhw x' W + X), f32(y' rhw (-H) + (Y + H)),
    // f32(z rhw (maxZ - minZ) + minZ), all at 64 bits
    const rhw = fr(1 / w);
    const vp = this.vp;
    E.ldMul(rhw, xc); E.fmul(vp.w); E.fadd(vp.x); out.x = E.st32();
    E.ldMul(yc, rhw); E.fmul(-vp.h); E.fadd(fr(vp.y + vp.h)); out.y = E.st32();
    E.ldMul(z, rhw); E.fmul(fr(vp.maxZ - vp.minZ)); E.fadd(vp.minZ); out.z = E.st32();
    out.rhw = rhw;
    // oD0 / oD1 clamped by their bits (0x1003e7a2): negative (not -0) -> 0, above 1 (or NaN) -> 1
    for (let j = 0; j < 8; j++) {
      F1[0] = vs.oD[j]; const u = U1[0];
      out.col[j] = u > 0x80000000 ? 0 : (u | 0) > 0x3f800000 ? 1 : vs.oD[j];
      vs.oD[j] = out.col[j];
    }
    out.tex.set(vs.oT);
  }
}
