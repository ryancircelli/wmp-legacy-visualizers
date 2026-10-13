// RefDevice: the Direct3D 8 device as Microsoft's reference rasterizer draws it (the DirectX 8.1 SDK's d3dref8.dll,
// 5.1.2600.881, driven by d3d8.dll with hardware vertex processing), bit for bit, for the features the eight D3D
// families use. VAs in comments are d3dref8.dll's (image base 0x400000). This file holds the device: resources,
// locks, state, state blocks, clears, presents; ref/ holds the pipeline (vertex processing, clipping, rasterizer,
// texture sampling, vertex shaders).
import {
  type Buffer, type Device, Fmt, type Locked, type Prim, type Rect, Rs, type StateBlock, type Surface, type Texture,
  type Tss, type VertexShader,
} from './api';
import { bytesPerPixel } from './trace';
import { Pipeline } from './ref/pipe';

export class RefSurface implements Surface {
  readonly pitch: number;
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, readonly format: Fmt, data?: Uint8Array, pitch?: number) {
    const bpp = bytesPerPixel(format);
    this.pitch = pitch ?? (bpp < 0 ? Math.max(1, (width + 3) >> 2) * -bpp : width * bpp);
    this.data = data ?? new Uint8Array(this.pitch * (bpp < 0 ? Math.max(1, (height + 3) >> 2) : height));
  }
  lockRect(rect: Rect | null): Locked {
    const bpp = bytesPerPixel(this.format);
    const off = rect ? (bpp < 0 ? (rect.top >> 2) * this.pitch + (rect.left >> 2) * -bpp : rect.top * this.pitch + rect.left * bpp) : 0;
    return { data: this.data.subarray(off), pitch: this.pitch };
  }
  unlockRect(): void { /* writes went straight into the surface */ }
}

export class RefTexture implements Texture {
  readonly mips: RefSurface[] = [];
  readonly levels: number;
  constructor(readonly width: number, readonly height: number, levels: number, readonly format: Fmt) {
    let w = width, h = height;
    const max = levels || 32;
    while (this.mips.length < max) {
      this.mips.push(new RefSurface(w, h, format));
      if (w === 1 && h === 1) break;
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    this.levels = this.mips.length;
  }
  getSurfaceLevel(level: number): Surface { return this.mips[level]; }
  lockRect(level: number, rect: Rect | null): Locked { return this.mips[level].lockRect(rect); }
  unlockRect(): void { /* as RefSurface */ }
}

export class RefBuffer implements Buffer {
  readonly data: Uint8Array;
  constructor(readonly length: number, readonly fvfOrFormat: number) { this.data = new Uint8Array(length); }
  lock(offset: number, size: number): Uint8Array { return this.data.subarray(offset, offset + (size || this.length - offset)); }
  unlock(): void { /* as RefSurface */ }
}

/** a vertex shader made by createVertexShader */
export interface RefShader { decl: Uint32Array; fn: Uint32Array | null }

/** The device state the pipeline reads (one object, plain fields, so the pipeline reads it without indirection) */
export class State {
  rs = new Uint32Array(256);
  /** stage * 32 + D3DTEXTURESTAGESTATETYPE */
  tss = new Uint32Array(8 * 32);
  /** D3DTRANSFORMSTATETYPE -> 16 float32s */
  tf = new Map<number, Float32Array>();
  /** X, Y, Width, Height, MinZ, MaxZ */
  vp = { x: 0, y: 0, w: 0, h: 0, minZ: 0, maxZ: 1 };
  /** D3DMATERIAL8 as 17 float32s: diffuse rgba, ambient rgba, specular rgba, emissive rgba, power */
  mat: Float32Array = new Float32Array(17);
  /** D3DLIGHT8 as its 104 bytes */
  lights: (ArrayBuffer | undefined)[] = [];
  lightOn: boolean[] = [];
  clip: Float32Array[] = [];
  tex: (RefTexture | null)[] = new Array<RefTexture | null>(8).fill(null);
  vs: VertexShader = 0;
  vsc = new Float32Array(96 * 4);
  streams: { vb: RefBuffer | null; stride: number }[] = Array.from({ length: 16 }, () => ({ vb: null, stride: 0 }));
  ib: RefBuffer | null = null;
  baseVertex = 0;

  constructor() { this.reset(); }

  /** D3D8's defaults (the runtime's and REF's: d3d8.dll sets every render state at device creation) */
  reset(): void {
    const rs = this.rs, f = (x: number): number => { F[0] = x; return U[0]; };
    rs.fill(0);
    rs[Rs.ZENABLE] = 1; rs[Rs.FILLMODE] = 3; rs[Rs.SHADEMODE] = 2; rs[Rs.ZWRITEENABLE] = 1; rs[Rs.LASTPIXEL] = 1;
    rs[Rs.SRCBLEND] = 2; rs[Rs.DESTBLEND] = 1; rs[Rs.CULLMODE] = 3; rs[Rs.ZFUNC] = 4; rs[Rs.ALPHAFUNC] = 8;
    rs[Rs.FOGTABLEMODE] = 0; rs[Rs.FOGEND] = f(1); rs[Rs.FOGDENSITY] = f(1); rs[Rs.STENCILFAIL] = 1;
    rs[Rs.STENCILZFAIL] = 1; rs[Rs.STENCILPASS] = 1; rs[Rs.STENCILFUNC] = 8; rs[Rs.STENCILMASK] = 0xffffffff;
    rs[Rs.STENCILWRITEMASK] = 0xffffffff; rs[Rs.TEXTUREFACTOR] = 0xffffffff; rs[Rs.CLIPPING] = 1; rs[Rs.LIGHTING] = 1;
    rs[Rs.COLORVERTEX] = 1; rs[Rs.LOCALVIEWER] = 1; rs[Rs.DIFFUSEMATERIALSOURCE] = 1; rs[Rs.SPECULARMATERIALSOURCE] = 2;
    rs[Rs.POINTSIZE] = f(1); rs[Rs.POINTSIZE_MIN] = f(0); rs[Rs.POINT_SCALE_A] = f(1); rs[Rs.MULTISAMPLEANTIALIAS] = 1;
    rs[Rs.MULTISAMPLEMASK] = 0xffffffff; rs[Rs.POINTSIZE_MAX] = f(64); rs[Rs.COLORWRITEENABLE] = 0xf; rs[Rs.BLENDOP] = 1;
    rs[Rs.PATCHSEGMENTS] = f(1);
    const t = this.tss;
    t.fill(0);
    for (let s = 0; s < 8; s++) {
      const b = s * 32;
      t[b + 1] = s === 0 ? 4 : 1; t[b + 2] = 2; t[b + 3] = 1; t[b + 4] = s === 0 ? 2 : 1; t[b + 5] = 2; t[b + 6] = 1;
      t[b + 11] = s; t[b + 13] = 1; t[b + 14] = 1; t[b + 16] = 1; t[b + 17] = 1; t[b + 18] = 0; t[b + 20] = 0;
      t[b + 21] = 1; t[b + 25] = 1; t[b + 26] = 1; t[b + 27] = 1; t[b + 28] = 1;
    }
    this.tf.clear();
    this.mat.fill(0);
    this.lights = []; this.lightOn = []; this.clip = [];
    this.tex.fill(null);
    this.vs = 0; this.vsc.fill(0);
    for (const s of this.streams) { s.vb = null; s.stride = 0; }
    this.ib = null; this.baseVertex = 0;
  }
}
const F = new Float32Array(1), U = new Uint32Array(F.buffer);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** A state block: what it records, by key ("rs:7", "tss:0:1", "tf:256", ...) -> value */
type Block = Map<string, unknown>;

export class RefDevice implements Device {
  width: number;
  height: number;
  readonly st = new State();
  private bb: RefSurface;
  private depth: RefSurface | null;
  rt: RefSurface;
  ds: RefSurface | null;
  private shaders = new Map<number, RefShader>();
  private nextHandle = 1;
  private blocks = new Map<number, Block>();
  private nextBlock = 1;
  private recording: Block | null = null;
  private pipe: Pipeline;
  /** the active lights, in REF's list order (0x421571 pushes an enabled light at the front; a light array that
   *  grows (CREATELIGHT 0x42161f) rebuilds the list in descending index order) */
  lightList: number[] = [];

  constructor(width: number, height: number, private depthFormat: Fmt | null = Fmt.D16) {
    this.width = width; this.height = height;
    this.bb = new RefSurface(width, height, Fmt.X8R8G8B8);
    this.depth = depthFormat === null ? null : new RefSurface(width, height, depthFormat);
    this.rt = this.bb; this.ds = this.depth;
    this.st.vp = { x: 0, y: 0, w: width, h: height, minZ: 0, maxZ: 1 };
    this.pipe = new Pipeline(this);
  }

  /** IDirect3DDevice8::Reset with the same formats: a new back buffer and depth buffer (0 = keep the size), every
   *  state back to its default, the viewport the whole target */
  reset(width = 0, height = 0): void {
    if (width) this.width = width;
    if (height) this.height = height;
    this.bb = new RefSurface(this.width, this.height, Fmt.X8R8G8B8);
    this.depth = this.depthFormat === null ? null : new RefSurface(this.width, this.height, this.depthFormat);
    this.rt = this.bb; this.ds = this.depth;
    this.st.reset();
    this.lightList = [];
    this.pipe.vm.clear();
    this.st.vp = { x: 0, y: 0, w: this.width, h: this.height, minZ: 0, maxZ: 1 };
    this.recording = null;
  }

  shader(h: number): RefShader | undefined { return this.shaders.get(h); }
  transform(type: number): Float32Array { return this.st.tf.get(type) ?? IDENTITY; }

  createTexture(width: number, height: number, levels: number, _usage: number, format: Fmt): Texture {
    return new RefTexture(width, height, levels, format);
  }
  createVertexBuffer(length: number, _usage: number, fvf: number): Buffer { return new RefBuffer(length, fvf); }
  createIndexBuffer(length: number, _usage: number, format: Fmt): Buffer { return new RefBuffer(length, format); }
  createRenderTarget(width: number, height: number, format: Fmt): Surface { return new RefSurface(width, height, format); }
  createDepthStencilSurface(width: number, height: number, format: Fmt): Surface { return new RefSurface(width, height, format); }
  createImageSurface(width: number, height: number, format: Fmt): Surface { return new RefSurface(width, height, format); }
  getBackBuffer(): Surface { return this.bb; }
  getRenderTarget(): Surface { return this.rt; }
  getDepthStencilSurface(): Surface | null { return this.ds; }
  setRenderTarget(target: Surface | null, depth: Surface | null): void {
    // the runtime's SetRenderTarget resets the viewport to the whole new target
    if (target) this.rt = target as RefSurface;
    this.ds = depth as RefSurface | null;
    this.st.vp = { x: 0, y: 0, w: this.rt.width, h: this.rt.height, minZ: 0, maxZ: 1 };
  }
  copyRects(src: Surface, rects: Rect[] | null, dst: Surface, points: { x: number; y: number }[] | null): void {
    const s = src as RefSurface, d = dst as RefSurface, bpp = bytesPerPixel(s.format);
    const rs = rects ?? [{ left: 0, top: 0, right: s.width, bottom: s.height }];
    rs.forEach((r, i) => {
      const px = points ? points[i].x : r.left, py = points ? points[i].y : r.top, n = (r.right - r.left) * bpp;
      for (let y = r.top; y < r.bottom; y++) {
        const so = y * s.pitch + r.left * bpp;
        d.data.set(s.data.subarray(so, so + n), (py + y - r.top) * d.pitch + px * bpp);
      }
    });
  }
  updateTexture(src: Texture, dst: Texture): void {
    const s = src as RefTexture, d = dst as RefTexture;
    for (let i = 0; i < d.levels; i++) d.mips[i].data.set(s.mips[i + s.levels - d.levels].data);
  }

  beginScene(): void { /* nothing to do */ }
  endScene(): void { /* nothing to do */ }
  present(): void { /* windowed REF: Present copies the back buffer out and leaves it as it is */ }

  clear(rects: Rect[] | null, flags: number, color: number, z: number, _stencil: number): void {
    this.pipe.clear(rects, flags, color, z);
  }

  // ---- state (recorded instead of set while a state block records) ----
  private set(key: string, value: unknown): boolean {
    if (!this.recording) return false;
    this.recording.set(key, value);
    return true;
  }
  setTransform(type: number, m: Float32Array): void {
    const v = new Float32Array(m.subarray(0, 16));
    if (!this.set('tf:' + type, v)) this.st.tf.set(type, v);
  }
  multiplyTransform(type: number, m: Float32Array): void {
    // M = M * m in float32 (d3d8.dll's MultiplyTransform; not in the traces)
    const a = this.transform(type), o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[i * 4 + j] = a[i * 4] * m[j] + a[i * 4 + 1] * m[4 + j] + a[i * 4 + 2] * m[8 + j] + a[i * 4 + 3] * m[12 + j];
    }
    this.setTransform(type, o);
  }
  setViewport(vp: ArrayBuffer): void {
    const dv = new DataView(vp);
    const v = { x: dv.getUint32(0, true), y: dv.getUint32(4, true), w: dv.getUint32(8, true), h: dv.getUint32(12, true),
      minZ: dv.getFloat32(16, true), maxZ: dv.getFloat32(20, true) };
    if (!this.set('vp', v)) this.st.vp = v;
  }
  setMaterial(m: ArrayBuffer): void {
    const v = new Float32Array(m.slice(0, 68));
    if (!this.set('mat', v)) this.st.mat = v;
  }
  setLight(index: number, light: ArrayBuffer): void {
    const v = light.slice(0, 104);
    if (this.set('light:' + index, v)) return;
    if (index >= this.st.lights.length) {
      // ponytail: REF's array grows on a new index; assumed to reallocate (and so rebuild the list) every time
      this.lightList = [];
      for (let i = 0; i < this.st.lights.length; i++) if (this.st.lightOn[i]) this.lightList.unshift(i);
    }
    this.st.lights[index] = v;
  }
  lightEnable(index: number, enable: boolean): void {
    if (this.set('le:' + index, enable)) return;
    if (enable && !this.st.lightOn[index]) this.lightList.unshift(index);
    if (!enable && this.st.lightOn[index]) this.lightList = this.lightList.filter((i) => i !== index);
    this.st.lightOn[index] = enable;
    // enabling a light that was never set gives it D3D8's default light (a white directional light down +z)
    if (enable && !this.st.lights[index]) this.st.lights[index] = defaultLight();
  }
  setClipPlane(index: number, plane: Float32Array): void {
    const v = new Float32Array(plane.subarray(0, 4));
    if (!this.set('cp:' + index, v)) this.st.clip[index] = v;
  }
  setRenderState(state: Rs, value: number): void { if (!this.set('rs:' + state, value >>> 0)) this.st.rs[state] = value; }
  setTextureStageState(stage: number, type: Tss, value: number): void {
    if (!this.set('tss:' + (stage * 32 + type), value >>> 0)) this.st.tss[stage * 32 + type] = value;
  }
  setTexture(stage: number, tex: Texture | null): void { if (!this.set('tex:' + stage, tex)) this.st.tex[stage] = tex as RefTexture | null; }
  setVertexShader(shader: VertexShader): void {
    if (this.set('vs', shader)) return;
    this.st.vs = shader;
    const sh = shader & 1 ? this.shaders.get(shader) : undefined;
    if (sh?.fn) this.pipe.vm.bind(sh, this.st.vsc);
  }
  setVertexShaderConstant(register: number, data: Float32Array, count: number): void {
    const v = new Float32Array(data.subarray(0, count * 4));
    if (this.set('vsc:' + register, v)) return;
    this.st.vsc.set(v, register * 4);
  }
  setStreamSource(stream: number, vb: Buffer | null, stride: number): void {
    if (this.set('ss:' + stream, [vb, stride])) return;
    this.st.streams[stream] = { vb: vb as RefBuffer | null, stride };
  }
  setIndices(ib: Buffer | null, baseVertexIndex: number): void {
    if (this.set('ib', [ib, baseVertexIndex])) return;
    this.st.ib = ib as RefBuffer | null; this.st.baseVertex = baseVertexIndex;
  }

  // ---- state blocks (d3d8.dll's: recorded Set* calls are not applied; Apply sets them, Capture re-reads them) ----
  beginStateBlock(): void { this.recording = new Map(); }
  endStateBlock(): StateBlock {
    const t = this.nextBlock++;
    this.blocks.set(t, this.recording ?? new Map<string, unknown>());
    this.recording = null;
    return t;
  }
  createStateBlock(type: number): StateBlock {
    // D3DSBT_ALL 1, PIXELSTATE 2, VERTEXSTATE 3: every state of the kind, captured now (not in the traces)
    const b: Block = new Map();
    for (let i = 0; i < 256; i++) b.set('rs:' + i, 0);
    for (let i = 0; i < 8 * 32; i++) b.set('tss:' + i, 0);
    if (type !== 2) { for (const k of this.st.tf.keys()) b.set('tf:' + k, null); b.set('vp', null); b.set('mat', null); b.set('vs', null); }
    if (type === 1) for (let i = 0; i < 8; i++) b.set('tex:' + i, null);
    const t = this.nextBlock++;
    this.blocks.set(t, b);
    this.captureStateBlock(t);
    return t;
  }
  applyStateBlock(token: StateBlock): void {
    const b = this.blocks.get(token);
    if (!b) return;
    for (const [k, v] of b) {
      const [kind, a] = k.split(':'), n = Number(a);
      switch (kind) {
        case 'rs': this.st.rs[n] = v as number; break;
        case 'tss': this.st.tss[n] = v as number; break;
        case 'tf': this.st.tf.set(n, v as Float32Array); break;
        case 'vp': this.st.vp = { ...(v as State['vp']) }; break;
        case 'mat': this.st.mat = v as Float32Array; break;
        case 'light': this.st.lights[n] = v as ArrayBuffer; break;
        case 'le': this.lightEnable(n, v as boolean); break;
        case 'cp': this.st.clip[n] = v as Float32Array; break;
        case 'tex': this.st.tex[n] = v as RefTexture | null; break;
        case 'vs': this.setVertexShader(v as number); break;
        case 'vsc': this.st.vsc.set(v as Float32Array, n * 4); break;
        case 'ss': { const [vb, stride] = v as [RefBuffer | null, number]; this.st.streams[n] = { vb, stride }; break; }
        case 'ib': { const [ib, base] = v as [RefBuffer | null, number]; this.st.ib = ib; this.st.baseVertex = base; break; }
      }
    }
  }
  captureStateBlock(token: StateBlock): void {
    const b = this.blocks.get(token);
    if (!b) return;
    for (const k of b.keys()) {
      const [kind, a] = k.split(':'), n = Number(a);
      switch (kind) {
        case 'rs': b.set(k, this.st.rs[n]); break;
        case 'tss': b.set(k, this.st.tss[n]); break;
        case 'tf': b.set(k, this.transform(n)); break;
        case 'vp': b.set(k, { ...this.st.vp }); break;
        case 'mat': b.set(k, this.st.mat); break;
        case 'light': b.set(k, this.st.lights[n]); break;
        case 'le': b.set(k, !!this.st.lightOn[n]); break;
        case 'cp': b.set(k, this.st.clip[n]); break;
        case 'tex': b.set(k, this.st.tex[n]); break;
        case 'vs': b.set(k, this.st.vs); break;
        case 'vsc': b.set(k, this.st.vsc.slice(n * 4, n * 4 + (b.get(k) as Float32Array).length)); break;
        case 'ss': b.set(k, [this.st.streams[n].vb, this.st.streams[n].stride]); break;
        case 'ib': b.set(k, [this.st.ib, this.st.baseVertex]); break;
      }
    }
  }
  deleteStateBlock(token: StateBlock): void { this.blocks.delete(token); }

  // ---- shaders ----
  createVertexShader(declaration: Uint32Array, fn: Uint32Array | null): VertexShader {
    const h = this.nextHandle; this.nextHandle += 2;
    this.shaders.set(h, { decl: declaration.slice(), fn: fn ? fn.slice() : null });
    return h;
  }
  deleteVertexShader(shader: VertexShader): void { this.shaders.delete(shader); }
  createPixelShader(): number { throw new Error('RefDevice: pixel shaders are not used by the D3D families'); }
  setPixelShader(shader: number): void { if (shader) throw new Error('RefDevice: pixel shaders are not used'); }
  deletePixelShader(): void { /* none exist */ }
  setPixelShaderConstant(): void { /* no pixel shaders */ }

  // ---- drawing ----
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void {
    this.pipe.draw(type, primitiveCount, null, 0, startVertex, 0, null);
  }
  drawIndexedPrimitive(type: Prim, minIndex: number, numVertices: number, startIndex: number, primitiveCount: number): void {
    const ib = this.st.ib!;
    const isz = ib.fvfOrFormat === 102 /* INDEX32 */ ? 4 : 2;
    this.pipe.draw(type, primitiveCount, ib.data.subarray(startIndex * isz), isz, this.st.baseVertex, minIndex + numVertices, null);
  }
  drawPrimitiveUP(type: Prim, primitiveCount: number, vertices: Uint8Array, stride: number): void {
    this.pipe.draw(type, primitiveCount, null, 0, 0, 0, { data: vertices, stride });
  }
  drawIndexedPrimitiveUP(type: Prim, minIndex: number, numVertices: number, primitiveCount: number,
    indices: Uint8Array, indexFormat: Fmt, vertices: Uint8Array, stride: number): void {
    this.pipe.draw(type, primitiveCount, indices, indexFormat === Fmt.INDEX32 ? 4 : 2, 0, minIndex + numVertices, { data: vertices, stride });
  }
}

/** D3D8's default light: directional, diffuse white, direction (0, 0, 1) */
function defaultLight(): ArrayBuffer {
  const l = new ArrayBuffer(104), dv = new DataView(l);
  dv.setUint32(0, 3, true);
  for (let i = 0; i < 3; i++) dv.setFloat32(4 + i * 4, 1, true);
  dv.setFloat32(72, 1, true);
  return l;
}
