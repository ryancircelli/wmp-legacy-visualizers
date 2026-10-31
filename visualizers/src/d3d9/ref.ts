// RefDevice9: the Direct3D 9 device as Microsoft's reference rasterizer draws it (Windows' d3dref9.dll
// 10.0.19041.685, driven by d3d9.dll with hardware vertex processing), bit for bit, for what the Psychedelia
// families use. VAs in comments are d3dref9.dll's (image base 0x10000000). This file holds the device: resources,
// state, clears, presents and the vertex stage (ProcessPrimitiveVVM 0x1003e051); ref/ holds the vertex shader VM,
// the rasterizer, the pixel shaders and the texture sampler.
import {
  type Buffer9, ClearFlag, type Device9, Fmt, type Point, type Pool, Prim, type Rect, Rs, type Ss, type Surface9, type Texture9,
  Ts, type Tss, type Viewport,
} from './api';
import * as E from '../d3d8/ref/ext';
import { PixelShader9, type Sampler, legacyShader } from './ref/ps';
import { Clipper } from './ref/clip';
import { Lighting, inverse3, normalize } from './ref/light';
import { Rasterizer9, TLVertex } from './ref/rast';
import { RefSurface9, RefTexture9, SamplerState, generateMips } from './ref/tex';
import { Reg, VertexShader9 } from './ref/vs';

import { prepareKernel9, refKernel9 } from './ref/kernel';

export { RefSurface9, RefTexture9, refKernel9 };

const fr = Math.fround;
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);

/** a D3DCOLOR byte as the fixed-function vertex stage converts it (MakeFLOAT4 0x1003de4d): f32(b / 255.0) at 64 bits */
const MAKEF = new Float64Array(256);
for (let i = 0; i < 256; i++) { E.ld(i); E.fdiv(255); MAKEF[i] = E.st32(); }
/** ... and as a declaration's D3DCOLOR element is read (Copy_D3DCOLOR 0x10046be0): f32(b * f32(1 / 255)) */
const COPYF = new Float64Array(256);
for (let i = 0; i < 256; i++) COPYF[i] = fr(i * 0.003921568859368563);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** RefVP::UpdateXformData 0x10049706: clip space x, y in [-w, w] -> [0, w] (0x106cc) */
const TCLIP = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1]);
/** RefVP::MatrixProduct 0x10049447: out = a * b, each element f32(((a1 b1 + a0 b0) + a2 b2) + a3 b3) at 64 bits */
function matMul(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] = E.sum32(a[i * 4 + 1] * b[4 + j], a[i * 4] * b[j], a[i * 4 + 2] * b[8 + j], a[i * 4 + 3] * b[12 + j]);
    }
  }
}
/** D3D9's texture stage state defaults (33 a stage) */
function tssDefaults(): Uint32Array {
  const t = new Uint32Array(8 * 33);
  for (let s = 0; s < 8; s++) {
    const o = s * 33;
    t[o + 1] = s === 0 ? 4 : 1; t[o + 2] = 2; t[o + 3] = 1; t[o + 4] = s === 0 ? 2 : 1; t[o + 5] = 2; t[o + 6] = 1;
    t[o + 11] = s; t[o + 26] = 1; t[o + 27] = 1; t[o + 28] = 1;
  }
  return t;
}
/** the declaration an FVF stands for (stream 0) */
function fvfDecl(fvf: number): DeclElement[] {
  const els: DeclElement[] = [];
  let o = 0;
  const pos = fvf & 0x400e;
  if (pos === 2) { els.push({ stream: 0, offset: 0, type: 2, usage: 0, index: 0 }); o = 12; }
  else if (pos === 4) { els.push({ stream: 0, offset: 0, type: 3, usage: 9, index: 0 }); o = 16; }
  else throw new Error('RefDevice9: FVF position ' + pos.toString(16) + ' is not implemented');
  if (fvf & 0x10) { els.push({ stream: 0, offset: o, type: 2, usage: 3, index: 0 }); o += 12; }
  if (fvf & 0x20) { els.push({ stream: 0, offset: o, type: 0, usage: 4, index: 0 }); o += 4; }
  if (fvf & 0x40) { els.push({ stream: 0, offset: o, type: 4, usage: 10, index: 0 }); o += 4; }
  if (fvf & 0x80) { els.push({ stream: 0, offset: o, type: 4, usage: 10, index: 1 }); o += 4; }
  const n = (fvf >> 8) & 0xf;
  for (let i = 0; i < n; i++) {
    const c = [2, 3, 4, 1][(fvf >>> (16 + 2 * i)) & 3];
    els.push({ stream: 0, offset: o, type: c - 1, usage: 5, index: i }); o += 4 * c;
  }
  return els;
}

export class RefBuffer9 implements Buffer9 {
  readonly data: Uint8Array;
  /** an index buffer of 32-bit indices (else 16-bit) */
  index32 = false;
  constructor(readonly length: number) { this.data = new Uint8Array(length); }
  lock(offset: number, size: number, _flags?: number): Uint8Array { return this.data.subarray(offset, offset + (size || this.length - offset)); }
  private dv: DataView | null = null;
  /** the little-endian float at byte offset o */
  f32At(o: number): number { this.dv ??= new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength); return this.dv.getFloat32(o, true); }
  unlock(): void { /* writes went straight into the buffer */ }
}

// Fast paths for x87 sequences at 64 bits (the pattern of ./ref/rast.ts): the double evaluation errs by well under
// 2^-50 of its operands' magnitudes, as does the 64-bit one, so when both ends of that interval round to one non-zero
// float it is the result; otherwise (or for a zero, whose sign the exact path decides) the emulation.
/** f32((a * b) * c + d) at 64 bits (a * b exact: floats) */
function mma32(a: number, b: number, c: number, d: number): number {
  const p = a * b * c, t = p + d, e = (Math.abs(p) + Math.abs(d)) * E.EPS, lo = fr(t - e);
  if (lo === fr(t + e) && lo !== 0) return lo;
  E.ldMul(a, b); E.fmul(c); E.fadd(d); return E.st32();
}
/** f32(f64(((a + b) + c) + d)) at 64 bits (exact products) */
function sum64to32(a: number, b: number, c: number, d: number): number {
  const t = ((a + b) + c) + d, e = (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d)) * E.EPS, lo = fr(t - e);
  if (lo === fr(t + e) && lo !== 0) return lo;
  E.ld(a); E.fadd(b); E.fadd(c); E.fadd(d); return fr(E.st64());
}
/** f32(1 / w) at 64 bits */
function recip32(w: number): number {
  const q = 1 / w, e = Math.abs(q) * E.EPS, lo = fr(q - e);
  if (lo === fr(q + e) && lo !== 0) return lo;
  E.ld(1); E.fdiv(w); return E.st32();
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
  /** texture stage states (Tss), 33 a stage */
  readonly tss = tssDefaults();
  /** transforms (Ts): absent = identity */
  readonly transforms = new Map<number, Float32Array>();
  private xformVer = 0; private xformDone = -1;
  /** the combined world * view * projection * TCLIP matrix (RefVP 0x43f0) */
  private wvp = new Float32Array(16);
  /** lighting: world * view (0x83f0) and its inverse's 3x3 (0xc3f0), the material, the lights (D3DLIGHT9 words) and
   *  the enabled ones in REF's list order */
  private wv = new Float32Array(16); private nrm = new Float32Array(16);
  private mat = new Float32Array(17);
  private lights: Uint32Array[] = []; private lightList: number[] = [];
  private lighting = new Lighting();
  private fvf = 0;
  private fvfDecls = new Map<number, DeclElement[]>();
  /** the render target (index 0) */
  private rt: RefSurface9;
  private vs: VertexShader9 | null = null;
  private ps: PixelShader9 | null = null;
  private streams: { vb: RefBuffer9 | null; offset: number; stride: number }[] = Array.from({ length: 16 }, () => ({ vb: null, offset: 0, stride: 0 }));
  /** viewport X, Y, Width, Height, MinZ, MaxZ */
  vp = { x: 0, y: 0, w: 0, h: 0, minZ: 0, maxZ: 1 };
  private rast = new Rasterizer9();
  private clipper = new Clipper();
  private tl: TLVertex[] = [];
  private ib: RefBuffer9 | null = null; private ib32 = false;
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
    this.rt = this.bb;
    const rs = this.rs, f = (x: number): number => { F1[0] = x; return U1[0]; };
    rs[Rs.ZENABLE] = 1; rs[8] = 3; rs[9] = 2; rs[Rs.ZWRITEENABLE] = 1; rs[16] = 1; rs[Rs.SRCBLEND] = 2; rs[Rs.DESTBLEND] = 1;
    rs[Rs.CULLMODE] = 3; rs[Rs.ZFUNC] = 4; rs[Rs.ALPHAFUNC] = 8; rs[36] = 0; rs[37] = f(1); rs[38] = f(1);
    rs[Rs.LIGHTING] = 1; rs[Rs.LOCALVIEWER] = 1; rs[136] = 1; rs[Rs.COLORWRITEENABLE] = 0xf; rs[Rs.BLENDOP] = 1; rs[60] = 0xffffffff;
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
  /** SetRenderTarget (Dp2SetRenderTarget 0x10010b71): index 0; the viewport becomes the whole surface */
  setRenderTarget(index: number, surface: Surface9): void {
    if (index !== 0) throw new Error('RefDevice9: multiple render targets are not implemented');
    const s = surface as RefSurface9;
    if (s.format !== Fmt.X8R8G8B8 && s.format !== Fmt.A8R8G8B8) throw new Error('RefDevice9: render target format ' + s.format);
    this.rt = s;
    this.vp = { x: 0, y: 0, w: s.width, h: s.height, minZ: 0, maxZ: 1 };
  }
  getRenderTarget(_index: number): Surface9 { return this.rt; }
  getDepthStencilSurface(): Surface9 { return this.depth; }
  setViewport(vp: Viewport): void { this.vp = { ...vp }; }
  getViewport(): Viewport { return { ...this.vp }; }
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
      const t = this.rt;
      t.planeDirty = true;
      const w = new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.byteLength >> 2), p = t.pitch >> 2;
      const v = (t.format === Fmt.X8R8G8B8 ? color & 0xffffff : color) >>> 0;
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
  createIndexBuffer(length: number, _usage: number, format: Fmt, _pool?: Pool): Buffer9 {
    if (format !== Fmt.INDEX16 && format !== Fmt.INDEX32) throw new Error('RefDevice9: index buffer format ' + format);
    const b = new RefBuffer9(length);
    b.index32 = format === Fmt.INDEX32;
    return b;
  }
  setIndices(ib: Buffer9 | null): void { this.ib = ib as RefBuffer9 | null; }
  setStreamSource(stream: number, vb: Buffer9 | null, offsetBytes: number, stride: number): void {
    this.streams[stream] = { vb: vb as RefBuffer9 | null, offset: offsetBytes, stride };
  }
  setVertexDeclaration(decl: number): void { this.decl = this.decls.get(decl) ?? null; this.fvf = 0; }
  setFVF(fvf: number): void {
    this.fvf = fvf;
    let d = this.fvfDecls.get(fvf);
    if (!d) { d = fvfDecl(fvf); this.fvfDecls.set(fvf, d); }
    this.decl = fvf ? d : null;
  }
  setTransform(state: Ts, m: Float32Array): void {
    if (state !== Ts.VIEW && state !== Ts.PROJECTION && state !== Ts.WORLD) throw new Error(`RefDevice9: transform ${String(state)} is not implemented`);
    this.transforms.set(state, Float32Array.from(m.subarray(0, 16)));
    this.xformVer++;
  }
  setMaterial(m: ArrayBuffer): void { this.mat = new Float32Array(m.slice(0, 68)); }
  setLight(index: number, light: ArrayBuffer): void { this.lights[index] = new Uint32Array(light.slice(0, 104)); }
  lightEnable(index: number, enable: boolean): void {
    // D3D9's default light for an index never set: directional
    if (!this.lights[index]) { const d = new Uint32Array(26), f = new Float32Array(d.buffer); d[0] = 3; f[1] = f[2] = f[3] = 1; f[18] = 1; this.lights[index] = d; }
    // ponytail: REF's light list order assumed head insertion on enable (as REF8's); matters only with two lights
    this.lightList = this.lightList.filter((i) => i !== index);
    if (enable) this.lightList.unshift(index);
  }
  setTextureStageState(stage: number, type: Tss, value: number): void { this.tss[stage * 33 + type] = value; }
  setVertexShader(shader: number): void { this.vs = this.vss.get(shader) ?? null; }
  setPixelShader(shader: number): void { this.ps = this.pss.get(shader) ?? null; }
  setVertexShaderConstantF(register: number, data: Float32Array, count: number): void { this.vsc.set(data.subarray(0, count * 4), register * 4); }
  setPixelShaderConstantF(register: number, data: Float32Array, count: number): void { this.psc.set(data.subarray(0, count * 4), register * 4); this.pscVersion++; }
  /** bumped by every SetPixelShaderConstantF (the rasterizer re-copies the constants only after a change) */
  private pscVersion = 0;

  // ---- drawing ----
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void {
    const n = type === Prim.TRIANGLELIST ? primitiveCount * 3 : primitiveCount + 2;
    this.draw(type, startVertex, n, null, n);
  }
  /** DrawDX9IndexedPrim 0x10045acd: the vertices base + min .. + numVertices processed, then the primitives through
   *  RefClipper::DrawOneIndexedPrimitive 0x100426b7 (vertex index base + index; lists (i0, i1, i2), strips and fans
   *  ordered as without indices) */
  drawIndexedPrimitive(type: Prim, baseVertexIndex: number, minVertexIndex: number, numVertices: number, startIndex: number, primCount: number): void {
    const ib = this.ib;
    if (!ib) throw new Error('RefDevice9: indexed draws need an index buffer');
    const n = type === Prim.TRIANGLELIST ? primCount * 3 : primCount + 2, w = ib.index32 ? 4 : 2;
    if ((startIndex + n) * w > ib.length) throw new Error('RefDevice9: indices past the end of the index buffer');
    const idx = this.idx.length >= n ? this.idx : (this.idx = new Int32Array(n));
    const d = ib.data;
    for (let k = 0; k < n; k++) {
      const o = (startIndex + k) * w;
      const i = (w === 4 ? (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0 : d[o] | (d[o + 1] << 8)) - minVertexIndex;
      if (i < 0 || i >= numVertices) throw new Error('RefDevice9: an index outside the draw\'s vertex range');
      idx[k] = i;
    }
    this.draw(type, baseVertexIndex + minVertexIndex, numVertices, idx, n);
  }
  private idx = new Int32Array(0); private pv: TLVertex[] = [];
  /** a draw of n vertices from startVertex; the primitives' np vertices are tl[idx[k]] (idx null: tl[k]) */
  private draw(type: Prim, startVertex: number, n: number, idx: Int32Array | null, np: number): void {
    const vs = this.vs, decl = this.decl;
    if (!decl) throw new Error('RefDevice9: draws need a vertex declaration or an FVF');
    while (this.tl.length < n) this.tl.push(new TLVertex());
    // DrawDX9Prim 0x10045f8a: a vertex shader runs unless the declaration is pre-transformed (POSITIONT / XYZRHW),
    // which goes straight to the clipper (DeclToRDVertex 0x1000aea0); no shader: the fixed-function vertex stage
    const pre = decl.some((e) => e.usage === 9);
    this.clipper.setViewport(this.vp);
    if (pre) {
      for (let i = 0; i < n; i++) this.tlVertex(decl, startVertex + i, this.tl[i]);
    } else if (vs) {
      for (let i = 0; i < n; i++) this.vertex(vs, decl, startVertex + i, this.tl[i]);
    } else {
      // RefVP::ProcessVertices 0x10043bf1 returns the clip codes' intersection: non-zero draws nothing
      let and = -1;
      this.ffBegin(decl);
      for (let i = 0; i < n; i++) { this.ffVertex(startVertex + i, this.tl[i]); and &= this.tl[i].code; }
      if (and) return;
    }
    let ps = this.ps;
    if (!ps) {
      let k = 0;
      while (k < 8 && this.tss[k * 33 + 1] !== 1) k++;
      ps = legacyShader(k);
    }
    const samplers = this.samplers;
    for (let i = 0; i < 16; i++) samplers[i].tex = this.textures[i];
    // the runtime has REF generate a dirty AUTOGENMIPMAP texture's sublevels ahead of the draw that uses it, at the
    // batch's precision (see generateMips): 64 bits once a draw has run since the last Present
    for (const t of this.textures) if (t?.dirty) generateMips(t, 2, this.rendering, this.rs[Rs.DITHERENABLE] !== 0);
    this.rast.begin(this.rs, this.rt, ps, this.psc, samplers, this.pscVersion, this.tss, this.depth);
    this.rt.planeDirty = true;
    const draw = (a: TLVertex, b: TLVertex, c: TLVertex): void => this.rast.triangle(a, b, c);
    const tri = (a: TLVertex, b: TLVertex, c: TLVertex): void => {
      // RefClipper::DrawTriangle 0x10042e83: all outside one plane -> nothing; outside the guard band -> clip
      if (a.code & b.code & c.code) return;
      if ((a.code | b.code | c.code) & 0xfff0) {
        // ponytail: pre-transformed vertices carry no clip-space position here (REF clips them in screen space)
        if (pre) throw new Error('RefDevice9: clipping pre-transformed vertices is not implemented');
        if (this.rs[Rs.SHADEMODE] === 1) throw new Error('RefDevice9: clipping flat-shaded triangles is not implemented');
        for (let i = 0; i < 8; i++) if (this.rs[Rs.WRAP0 + i]) throw new Error('RefDevice9: clipping with texture wrapping is not implemented');
        this.clipper.triangle(a, b, c, draw);
        return;
      }
      this.rast.triangle(a, b, c);
    };
    this.rendering = true;
    let v = this.tl;
    if (idx) {
      const pv = this.pv;
      for (let k = 0; k < np; k++) pv[k] = v[idx[k]];
      v = pv;
    }
    n = np;
    switch (type) {
      case Prim.TRIANGLELIST: for (let j = 0; j + 2 < n; j += 3) tri(v[j], v[j + 1], v[j + 2]); break;
      // (v0, v1, v2), (v1, v3, v2), (v2, v3, v4), ...
      case Prim.TRIANGLESTRIP: for (let j = 0; j + 2 < n; j++) { if (j & 1) tri(v[j], v[j + 2], v[j + 1]); else tri(v[j], v[j + 1], v[j + 2]); } break;
      // DrawOnePrimitive 0x10013b58: (v1, v2, v0), (v2, v3, v0), ... the centre last
      case Prim.TRIANGLEFAN: for (let j = 1; j + 1 < n; j++) tri(v[j], v[j + 1], v[0]); break;
      default: throw new Error(`RefDevice9: primitive type ${String(type)} is not implemented`);
    }
  }

  /** a pre-transformed vertex (DeclToRDVertex 0x1000aea0 / RDVertex::SetData 0x1003ecc2: Copy_FLOATn with missing
   *  components from (0, 0, 0, 1), Copy_D3DCOLOR) and its clip codes (RefClipper::ComputeClipCodesTL 0x10041d64:
   *  the viewport rect, the guard band) */
  private tlVertex(decl: DeclElement[], index: number, out: TLVertex): void {
    const col = out.col, tex = out.tex;
    col.fill(1, 0, 4); col.fill(0, 4, 8);
    for (let i = 0; i < 8; i++) { tex[4 * i] = 0; tex[4 * i + 1] = 0; tex[4 * i + 2] = 0; tex[4 * i + 3] = 1; }
    let x = 0, y = 0, z = 0, w = 1;
    const t = this.ftmp;
    for (const e of decl) {
      if (e.usage === 9) { this.fetchEl(e, index, t); x = t[0]; y = t[1]; z = t[2]; w = t[3]; }
      else if (e.usage === 10 && e.index < 2) { this.fetchEl(e, index, t, COPYF); col.set(t, e.index * 4); }
      else if (e.usage === 5 && e.index < 8) { this.fetchEl(e, index, t); tex.set(t, e.index * 4); }
    }
    out.x = x; out.y = y; out.z = z; out.rhw = w;
    const vp = this.vp;
    // ponytail: the z codes (0x10 / 0x20) depend on clipper flags REF sets for the fixed-function pipeline only; left
    // out, as is the clipper (a triangle needing it throws)
    const sx = w < 0 ? -x : x, sy = w < 0 ? -y : y;
    let code = sx < vp.x ? 1 : sx > fr(vp.x + vp.w) ? 2 : 0;
    code |= sy < vp.y ? 4 : sy > fr(vp.y + vp.h) ? 8 : 0;
    code |= sx < -32768 ? 0x1000 : sx > 32767 ? 0x2000 : 0;
    code |= sy < -32768 ? 0x4000 : sy > 32767 ? 0x8000 : 0;
    out.code = code;
  }
  private ftmp = new Float64Array(4);
  /** one element of a vertex into t (missing components from (0, 0, 0, 1)); D3DCOLOR through the byte table `cf` */
  private fetchEl(e: DeclElement, index: number, t: Float64Array, cf: Float64Array = COPYF): void {
    const s = this.streams[e.stream], vb = s.vb;
    if (!vb) throw new Error('RefDevice9: no vertex buffer on stream ' + e.stream);
    const b = s.offset + index * s.stride + e.offset;
    t[0] = 0; t[1] = 0; t[2] = 0; t[3] = 1;
    if (e.type <= 3) { for (let j = 0; j <= e.type; j++) t[j] = vb.f32At(b + j * 4); return; }
    if (e.type !== 4) throw new Error('RefDevice9: vertex element type ' + e.type + ' is not implemented');
    const d = vb.data;
    t[0] = cf[d[b + 2]]; t[1] = cf[d[b + 1]]; t[2] = cf[d[b]]; t[3] = cf[d[b + 3]];
  }

  /** one vertex of the fixed-function vertex stage without lighting (RefVP::ProcessVertices 0x10043bf1): position
   *  times the combined matrix (RefVP::UpdateXformData 0x10049706), clip codes, screen coordinates, the colours
   *  (MakeFLOAT4) and each stage's texture coordinate set (TEXCOORDINDEX) */
  private ffBegin(decl: DeclElement[]): void {
    const rs = this.rs, tss = this.tss;
    if (rs[Rs.FOGENABLE]) throw new Error('RefDevice9: fog is not implemented');
    if (this.xformDone !== this.xformVer) {
      // P' = P TCLIP, VP = View P', M = World VP (each RefVP::MatrixProduct)
      const P = new Float32Array(16), VP = new Float32Array(16);
      matMul(this.transforms.get(3) ?? IDENTITY, TCLIP, P);
      matMul(this.transforms.get(2) ?? IDENTITY, P, VP);
      matMul(this.transforms.get(256) ?? IDENTITY, VP, this.wvp);
      this.xformDone = this.xformVer;
    }
    this.ffPos = decl.find((e) => e.usage === 0 && e.index === 0) ?? null;
    this.lit = rs[Rs.LIGHTING] !== 0;
    if (this.lit) {
      if (decl.some((e) => e.usage === 10)) throw new Error('RefDevice9: vertex colours with lighting are not implemented');
      // UpdateWorld 0x1004967b, UpdateLightingData 0x10048ac2
      const view = this.transforms.get(2) ?? IDENTITY;
      matMul(this.transforms.get(256) ?? IDENTITY, view, this.wv);
      inverse3(this.wv, this.nrm);
      this.lighting.setup(this.mat, rs[Rs.AMBIENT], this.lightList.map((i) => this.lights[i]), view, rs[Rs.SPECULARENABLE] !== 0,
        rs[Rs.LOCALVIEWER] !== 0);
      this.ffNrm = decl.find((e) => e.usage === 3 && e.index === 0) ?? null;
    }
    this.ffCol = decl.filter((e) => e.usage === 10 && e.index < 2);
    for (let i = 0; i < 8; i++) {
      const tci = tss[i * 33 + 11];
      if (tss[i * 33 + 24]) throw new Error('RefDevice9: texture transforms are not implemented');
      if (tci > 7) throw new Error('RefDevice9: generated texture coordinates are not implemented');
      this.ffTex[i] = decl.find((d) => d.usage === 5 && d.index === tci) ?? null;
    }
  }
  /** the draw's position, colour and per-stage texture coordinate elements (ffBegin) */
  private lit = false; private ffNrm: DeclElement | null = null;
  private eye = new Float64Array(3); private eyeN = new Float64Array(3); private litCol = new Uint32Array(2);
  private ffPos: DeclElement | null = null; private ffCol: DeclElement[] = []; private ffTex: (DeclElement | null)[] = new Array<DeclElement | null>(8).fill(null);
  private ffVertex(index: number, out: TLVertex): void {
    const rs = this.rs, m = this.wvp, t = this.ftmp, col = out.col, tex = out.tex;
    let x = 0, y = 0, z = 0;
    col.fill(1, 0, 4); col.fill(0, 4, 8);
    if (this.ffPos) { this.fetchEl(this.ffPos, index, t); x = t[0]; y = t[1]; z = t[2]; }
    for (const e of this.ffCol) { this.fetchEl(e, index, t, MAKEF); col.set(t, e.index * 4); }
    if (this.lit) {
      // ProcessVertices 0x10043fb8: eye-space position (world * view) and normal (its inverse's rows), each
      // f32(sum * 1 + 0); NORMALIZENORMALS; then LightVertex's colours through MakeFLOAT4
      const w = this.wv, p = this.eye;
      p[0] = E.sum32(w[4] * y, w[0] * x, w[8] * z, w[12]) + 0; p[1] = E.sum32(w[5] * y, w[1] * x, w[9] * z, w[13]) + 0;
      p[2] = E.sum32(w[6] * y, w[2] * x, w[10] * z, w[14]) + 0;
      let n: Float64Array | null = null;
      if (this.ffNrm) {
        this.fetchEl(this.ffNrm, index, t);
        const N = this.nrm, nx = t[0], ny = t[1], nz = t[2];
        n = this.eyeN;
        n[0] = E.sum32x3(N[1] * ny, N[0] * nx, N[2] * nz) + 0; n[1] = E.sum32x3(N[4] * nx, N[5] * ny, N[6] * nz) + 0;
        n[2] = E.sum32x3(N[9] * ny, N[8] * nx, N[10] * nz) + 0;
        if (rs[Rs.NORMALIZENORMALS]) normalize(n);
      }
      const lc = this.litCol;
      this.lighting.vertex(p, n, lc);
      for (let k = 0; k < 2; k++) {
        const c = lc[k];
        col[4 * k] = MAKEF[(c >>> 16) & 0xff]; col[4 * k + 1] = MAKEF[(c >>> 8) & 0xff]; col[4 * k + 2] = MAKEF[c & 0xff]; col[4 * k + 3] = MAKEF[c >>> 24];
      }
    }
    for (let i = 0; i < 8; i++) {
      const e = this.ffTex[i];
      if (e) { this.fetchEl(e, index, t); tex.set(t, i * 4); }
      else { tex[4 * i] = 0; tex[4 * i + 1] = 0; tex[4 * i + 2] = 0; tex[4 * i + 3] = 1; }
    }
    // 0x1004434b: X = f32(((m00 x + m10 y) + m20 z) + m30) at 64 bits (then * 1 + 0: -0 becomes +0); W sums m13 y
    // first; Z is stored as a double before the float
    const X = E.sum32(m[0] * x, m[4] * y, m[8] * z, m[12]) + 0, Y = E.sum32(m[1] * x, m[5] * y, m[9] * z, m[13]) + 0;
    const Z = sum64to32(m[2] * x, m[6] * y, m[10] * z, m[14]) + 0;
    const Wc = E.sum32(m[7] * y, m[3] * x, m[11] * z, m[15]) + 0;
    let code = 0, rhw: number;
    out.cx = X; out.cy = Y; out.cz = Z; out.cw = Wc;
    if (rs[Rs.CLIPPING]) {
      code = this.clipper.codes(X, Y, Z, Wc);
      if (code !== 0 && (code & ~0xf) !== 0) { out.code = code; return; }   // the clipper's
      rhw = recip32(Wc);
    } else if (Wc === 0) rhw = 2097152;                    // 0x1000662c
    else rhw = recip32(Wc);
    out.code = code;
    this.screen(X, Y, Z, rhw, out);
  }
  /** screen coordinates from [0, w] clip space (0x100445d8, as ProcessPrimitiveVVM's 0x1003e71b): f32(rhw x W + X),
   *  f32(y rhw (-H) + (Y + H)), f32(z rhw (maxZ - minZ) + minZ), at 64 bits */
  private screen(xc: number, yc: number, z: number, rhw: number, out: TLVertex): void {
    const vp = this.vp;
    out.x = mma32(rhw, xc, vp.w, vp.x);
    out.y = mma32(yc, rhw, -vp.h, fr(vp.y + vp.h));
    out.z = mma32(z, rhw, fr(vp.maxZ - vp.minZ), vp.minZ);
    out.rhw = rhw;
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
    out.code = this.clipper.codes(xc, yc, z, w);
    out.cx = xc; out.cy = yc; out.cz = z; out.cw = w;
    // rhw = f32(1 / w), then the screen coordinates
    this.screen(xc, yc, z, fr(1 / w), out);
    // oD0 / oD1 clamped by their bits (0x1003e7a2): negative (not -0) -> 0, above 1 (or NaN) -> 1
    for (let j = 0; j < 8; j++) {
      F1[0] = vs.oD[j]; const u = U1[0];
      out.col[j] = u > 0x80000000 ? 0 : (u | 0) > 0x3f800000 ? 1 : vs.oD[j];
      vs.oD[j] = out.col[j];
    }
    out.tex.set(vs.oT);
  }
}

