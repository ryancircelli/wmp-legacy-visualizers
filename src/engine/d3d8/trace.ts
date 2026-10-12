// A Device that draws nothing and records every call in the D3T1 trace format (the format the private harness
// records from the real DLLs), so a port's calls can be checked against its DLL's before the rasterizer is in
// the loop. Resources hold real memory: locks hand out views of it, and each unlock writes the locked range into
// the trace, as the harness dumps it.
//   D3T1: "D3T1", u32 version 1, then records: u32 id (kind << 8 | slot), u32 result, u32 nargs, u32 args[nargs]
//   (args[0] = the object called), u32 nblobs, { u32 length, bytes } per blob. Kinds: 0 device (slot = the
//   IDirect3DDevice8 vtable slot), 1 texture, 2 surface, 3 vertex buffer, 4 index buffer, 0xF0 frame start,
//   0xF1 frame end, 0xF2 device created. A lock dump is a 32-byte header (format, width, height, left, top,
//   right, bottom, pitch as u32) and the rows of the rect.
import {
  type Buffer, type Device, Fmt, type Locked, type Prim, type Rect, type Rs, type StateBlock, type Surface, type Texture, type Tss,
  type VertexShader, primVertices, Lock,
} from './api';

/** bytes per pixel, or for a block-compressed format minus the bytes per 4x4 block */
export function bytesPerPixel(f: Fmt): number {
  switch (f) {
    case Fmt.R8G8B8: return 3;
    case Fmt.R5G6B5: case Fmt.X1R5G5B5: case Fmt.A1R5G5B5: case Fmt.A4R4G4B4: case Fmt.D16: return 2;
    case Fmt.A8: case Fmt.L8: return 1;
    case Fmt.DXT1: return -8;
    case Fmt.DXT3: case Fmt.DXT5: return -16;
    default: return 4;
  }
}

class Writer {
  private buf = new Uint8Array(1 << 20);
  private dv = new DataView(this.buf.buffer);
  len = 0;
  constructor() { this.bytes(new Uint8Array([0x44, 0x33, 0x54, 0x31])); this.u32(1); }
  private room(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let c = this.buf.length * 2;
    while (c < this.len + n) c *= 2;
    const b = new Uint8Array(c); b.set(this.buf.subarray(0, this.len));
    this.buf = b; this.dv = new DataView(b.buffer);
  }
  u32(v: number): void { this.room(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; }
  bytes(b: Uint8Array): void { this.room(b.length); this.buf.set(b, this.len); this.len += b.length; }
  out(): Uint8Array { return this.buf.slice(0, this.len); }
}

const u8 = (b: ArrayBuffer | ArrayBufferView): Uint8Array =>
  b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const f32bits = (x: number): number => { F[0] = x; return U[0]; };
const F = new Float32Array(1), U = new Uint32Array(F.buffer);

let nextPtr = 0x10000;
interface Obj { readonly ptr: number }

class Mem implements Surface, Obj {
  readonly ptr = nextPtr += 0x40;
  readonly pitch: number;
  readonly data: Uint8Array;
  private lockRectArg: Rect | null = null;
  private lockFlags = 0;
  constructor(private rec: TraceDevice, readonly width: number, readonly height: number, readonly format: Fmt,
              readonly kind: number, data?: Uint8Array, pitch?: number) {
    const bpp = bytesPerPixel(format);
    this.pitch = pitch ?? (bpp < 0 ? Math.max(1, (width + 3) >> 2) * -bpp : width * bpp);
    this.data = data ?? new Uint8Array(this.pitch * (bpp < 0 ? Math.max(1, (height + 3) >> 2) : height));
  }
  view(rect: Rect | null): Locked {
    const bpp = bytesPerPixel(this.format);
    const off = rect ? (bpp < 0 ? (rect.top >> 2) * this.pitch + (rect.left >> 2) * -bpp : rect.top * this.pitch + rect.left * bpp) : 0;
    return { data: this.data.subarray(off), pitch: this.pitch };
  }
  dump(rect: Rect | null): Uint8Array {
    const r = rect ?? { left: 0, top: 0, right: this.width, bottom: this.height };
    const bpp = bytesPerPixel(this.format), blk = bpp < 0;
    const rows = blk ? (r.bottom - r.top + 3) >> 2 : r.bottom - r.top, rowBytes = blk ? ((r.right - r.left + 3) >> 2) * -bpp : (r.right - r.left) * bpp;
    const o = new Uint8Array(32 + rows * rowBytes), dv = new DataView(o.buffer);
    [this.format, this.width, this.height, r.left, r.top, r.right, r.bottom, this.pitch].forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
    const v = this.view(rect);
    for (let y = 0; y < rows; y++) o.set(v.data.subarray(y * this.pitch, y * this.pitch + rowBytes), 32 + y * rowBytes);
    return o;
  }
  lockRect(rect: Rect | null, flags: number): Locked {
    this.lockRectArg = rect; this.lockFlags = flags;
    this.rec.rec(2 << 8 | 9, this.ptr, [0, 0, flags], rect ? [rectBytes(rect)] : [new Uint8Array(0)]);
    return this.view(rect);
  }
  unlockRect(): void {
    const dump = (this.lockFlags & Lock.READONLY) ? null : this.dump(this.lockRectArg);
    this.rec.rec(2 << 8 | 10, this.ptr, [], dump ? [dump] : []);
  }
}

function rectBytes(r: Rect): Uint8Array {
  const o = new Uint8Array(16), dv = new DataView(o.buffer);
  [r.left, r.top, r.right, r.bottom].forEach((v, i) => dv.setInt32(i * 4, v, true));
  return o;
}

class Tex implements Texture, Obj {
  readonly ptr = nextPtr += 0x40;
  readonly mips: Mem[] = [];
  private surfs: Mem[] = [];
  private locks: { rect: Rect | null; flags: number }[] = [];
  readonly levels: number;
  constructor(private rec: TraceDevice, readonly width: number, readonly height: number, levels: number, readonly format: Fmt) {
    let n = 0, w = width, h = height;
    const max = levels || 32;
    while (n < max) { this.mips.push(new Mem(rec, w, h, format, 1)); n++; if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    this.levels = n;
  }
  getSurfaceLevel(level: number): Surface {
    const m = this.mips[level];
    const s = this.surfs[level] ??= new Mem(this.rec, m.width, m.height, m.format, 2, m.data, m.pitch);
    this.rec.rec(1 << 8 | 15, this.ptr, [level, 0], [this.rec.ptrBlob(s.ptr)]);
    return s;
  }
  lockRect(level: number, rect: Rect | null, flags: number): Locked {
    this.locks[level] = { rect, flags };
    this.rec.rec(1 << 8 | 16, this.ptr, [level, 0, 0, flags], [rect ? rectBytes(rect) : new Uint8Array(0)]);
    return this.mips[level].view(rect);
  }
  unlockRect(level: number): void {
    const l = this.locks[level];
    const dump = l && !(l.flags & Lock.READONLY) ? this.mips[level].dump(l.rect) : null;
    this.rec.rec(1 << 8 | 17, this.ptr, [level], dump ? [dump] : []);
  }
}

class Buf implements Buffer, Obj {
  readonly ptr = nextPtr += 0x40;
  readonly data: Uint8Array;
  private off = 0; private size = 0; private flags = 0;
  constructor(private rec: TraceDevice, readonly length: number, readonly kind: 3 | 4, readonly fmt: number) { this.data = new Uint8Array(length); }
  lock(offset: number, size: number, flags: number): Uint8Array {
    this.off = offset; this.size = size || this.length - offset; this.flags = flags;
    this.rec.rec(this.kind << 8 | 11, this.ptr, [offset, size, 0, flags], []);
    return this.data.subarray(offset, offset + this.size);
  }
  unlock(): void {
    let dump: Uint8Array | null = null;
    if (!(this.flags & Lock.READONLY)) {
      dump = new Uint8Array(32 + this.size);
      const dv = new DataView(dump.buffer);
      dv.setUint32(0, this.fmt >>> 0, true); dv.setUint32(4, this.length, true); dv.setUint32(12, this.off, true);
      dump.set(this.data.subarray(this.off, this.off + this.size), 32);
    }
    this.rec.rec(this.kind << 8 | 12, this.ptr, [], dump ? [dump] : []);
  }
}

export class TraceDevice implements Device {
  private w = new Writer();
  readonly ptr = 0x8000;
  private bb: Mem;
  private depth: Mem | null;
  private rt: Surface;
  private ds: Surface | null;
  private nextHandle = 1;   // vertex/pixel shader handles: odd, as D3D8's (an FVF has bit 0 clear)
  private nextBlock = 1;

  constructor(readonly width: number, readonly height: number, behaviourFlags = 0x52, depthFormat: Fmt | null = Fmt.D16) {
    this.bb = new Mem(this, width, height, Fmt.X8R8G8B8, 2);
    this.depth = depthFormat === null ? null : new Mem(this, width, height, depthFormat, 2);
    this.rt = this.bb; this.ds = this.depth;
    const pp = new Uint8Array(52), dv = new DataView(pp.buffer);
    [width, height, Fmt.X8R8G8B8, 1, 0, 1, 0, 1, depthFormat === null ? 0 : 1, depthFormat ?? 0, 1, 0, 0].forEach((v, i) => dv.setUint32(i * 4, v, true));
    this.rec(0xF2 << 8, this.ptr, [behaviourFlags, width, height], [pp]);
  }

  /** the trace so far */
  bytes(): Uint8Array { return this.w.out(); }
  frameStart(f: number): void { this.rec(0xF0 << 8, f, [], []); }
  frameEnd(f: number): void { this.rec(0xF1 << 8, f, [], []); }

  ptrBlob(p: number): Uint8Array { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, p, true); return o; }
  /** one record; args after the object called */
  rec(id: number, self: number, args: number[], blobs: Uint8Array[], result = 0): void {
    this.w.u32(id); this.w.u32(result); this.w.u32(args.length + 1); this.w.u32(self);
    for (const a of args) this.w.u32(a);
    this.w.u32(blobs.length);
    for (const b of blobs) { this.w.u32(b.length); this.w.bytes(b); }
  }
  private dev(slot: number, args: number[], blobs: Uint8Array[] = []): void { this.rec(slot, this.ptr, args, blobs); }
  private p(o: Obj | null): number { return o ? o.ptr : 0; }

  createTexture(width: number, height: number, levels: number, usage: number, format: Fmt, pool: number): Texture {
    const t = new Tex(this, width, height, levels, format);
    this.dev(20, [width, height, levels, usage, format, pool, 0], [this.ptrBlob(t.ptr)]);
    return t;
  }
  createVertexBuffer(length: number, usage: number, fvf: number, pool: number): Buffer {
    const b = new Buf(this, length, 3, fvf);
    this.dev(23, [length, usage, fvf, pool, 0], [this.ptrBlob(b.ptr)]);
    return b;
  }
  createIndexBuffer(length: number, usage: number, format: Fmt, pool: number): Buffer {
    const b = new Buf(this, length, 4, format);
    this.dev(24, [length, usage, format, pool, 0], [this.ptrBlob(b.ptr)]);
    return b;
  }
  createRenderTarget(width: number, height: number, format: Fmt, lockable: boolean): Surface {
    const s = new Mem(this, width, height, format, 2);
    this.dev(25, [width, height, format, 0, lockable ? 1 : 0, 0], [this.ptrBlob(s.ptr)]);
    return s;
  }
  createDepthStencilSurface(width: number, height: number, format: Fmt): Surface {
    const s = new Mem(this, width, height, format, 2);
    this.dev(26, [width, height, format, 0, 0], [this.ptrBlob(s.ptr)]);
    return s;
  }
  createImageSurface(width: number, height: number, format: Fmt): Surface {
    const s = new Mem(this, width, height, format, 2);
    this.dev(27, [width, height, format, 0], [this.ptrBlob(s.ptr)]);
    return s;
  }
  getBackBuffer(): Surface { this.dev(16, [0, 0, 0], [this.ptrBlob(this.bb.ptr)]); return this.bb; }
  getRenderTarget(): Surface { this.dev(32, [0], [this.ptrBlob(this.p(this.rt as Mem))]); return this.rt; }
  getDepthStencilSurface(): Surface | null { this.dev(33, [0], [this.ptrBlob(this.p(this.ds as Mem | null))]); return this.ds; }
  setRenderTarget(target: Surface | null, depth: Surface | null): void {
    if (target) this.rt = target;
    this.ds = depth;
    this.dev(31, [this.p(target as Mem | null), this.p(depth as Mem | null)]);
  }
  copyRects(src: Surface, rects: Rect[] | null, dst: Surface, points: { x: number; y: number }[] | null): void {
    const rb = new Uint8Array(16 * (rects?.length ?? 0)); rects?.forEach((r, i) => rb.set(rectBytes(r), i * 16));
    const pb = new Uint8Array(8 * (points?.length ?? 0)), dv = new DataView(pb.buffer);
    points?.forEach((q, i) => { dv.setInt32(i * 8, q.x, true); dv.setInt32(i * 8 + 4, q.y, true); });
    this.dev(28, [this.p(src as Mem), rects ? 1 : 0, rects?.length ?? 0, this.p(dst as Mem), points ? 1 : 0], [rb, pb]);
  }
  updateTexture(src: Texture, dst: Texture): void { this.dev(29, [this.p(src as Tex), this.p(dst as Tex)]); }
  beginScene(): void { this.dev(34, []); }
  endScene(): void { this.dev(35, []); }
  present(): void { this.dev(15, [0, 0, 0, 0]); }
  clear(rects: Rect[] | null, flags: number, color: number, z: number, stencil: number): void {
    const rb = new Uint8Array(16 * (rects?.length ?? 0)); rects?.forEach((r, i) => rb.set(rectBytes(r), i * 16));
    this.dev(36, [rects?.length ?? 0, rects ? 1 : 0, flags, color, f32bits(z), stencil], [rb]);
  }
  setTransform(type: number, m: Float32Array): void { this.dev(37, [type, 0], [u8(m.slice(0, 16))]); }
  multiplyTransform(type: number, m: Float32Array): void { this.dev(39, [type, 0], [u8(m.slice(0, 16))]); }
  setViewport(vp: ArrayBuffer): void { this.dev(40, [0], [u8(vp.slice(0, 24))]); }
  setMaterial(m: ArrayBuffer): void { this.dev(42, [0], [u8(m.slice(0, 68))]); }
  setLight(index: number, light: ArrayBuffer): void { this.dev(44, [index, 0], [u8(light.slice(0, 104))]); }
  lightEnable(index: number, enable: boolean): void { this.dev(46, [index, enable ? 1 : 0]); }
  setClipPlane(index: number, plane: Float32Array): void { this.dev(48, [index, 0], [u8(plane.slice(0, 4))]); }
  setRenderState(state: Rs, value: number): void { this.dev(50, [state, value]); }
  setTextureStageState(stage: number, type: Tss, value: number): void { this.dev(63, [stage, type, value]); }
  setTexture(stage: number, tex: Texture | null): void { this.dev(61, [stage, this.p(tex as Tex | null)]); }
  beginStateBlock(): void { this.dev(52, []); }
  endStateBlock(): StateBlock { const t = this.nextBlock++; this.dev(53, [0], [this.ptrBlob(t)]); return t; }
  createStateBlock(type: number): StateBlock { const t = this.nextBlock++; this.dev(57, [type, 0], [this.ptrBlob(t)]); return t; }
  applyStateBlock(token: StateBlock): void { this.dev(54, [token]); }
  captureStateBlock(token: StateBlock): void { this.dev(55, [token]); }
  deleteStateBlock(token: StateBlock): void { this.dev(56, [token]); }
  createVertexShader(declaration: Uint32Array, fn: Uint32Array | null, usage: number): VertexShader {
    const hnd = this.nextHandle; this.nextHandle += 2;
    this.dev(75, [1, fn ? 1 : 0, 0, usage], [u8(declaration), fn ? u8(fn) : new Uint8Array(0), this.ptrBlob(hnd)]);
    return hnd;
  }
  setVertexShader(shader: VertexShader): void { this.dev(76, [shader]); }
  deleteVertexShader(shader: VertexShader): void { this.dev(78, [shader]); }
  setVertexShaderConstant(register: number, data: Float32Array, count: number): void { this.dev(79, [register, 0, count], [u8(data.slice(0, count * 4))]); }
  createPixelShader(fn: Uint32Array): number { const hnd = this.nextHandle; this.nextHandle += 2; this.dev(87, [1, 0], [u8(fn), this.ptrBlob(hnd)]); return hnd; }
  setPixelShader(shader: number): void { this.dev(88, [shader]); }
  deletePixelShader(shader: number): void { this.dev(90, [shader]); }
  setPixelShaderConstant(register: number, data: Float32Array, count: number): void { this.dev(91, [register, 0, count], [u8(data.slice(0, count * 4))]); }
  setStreamSource(stream: number, vb: Buffer | null, stride: number): void { this.dev(83, [stream, this.p(vb as Buf | null), stride]); }
  setIndices(ib: Buffer | null, baseVertexIndex: number): void { this.dev(85, [this.p(ib as Buf | null), baseVertexIndex]); }
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void { this.dev(70, [type, startVertex, primitiveCount]); }
  drawIndexedPrimitive(type: Prim, minIndex: number, numVertices: number, startIndex: number, primitiveCount: number): void {
    this.dev(71, [type, minIndex, numVertices, startIndex, primitiveCount]);
  }
  drawPrimitiveUP(type: Prim, primitiveCount: number, vertices: Uint8Array, stride: number): void {
    this.dev(72, [type, primitiveCount, 1, stride], [vertices.slice(0, primVertices(type, primitiveCount) * stride)]);
  }
  drawIndexedPrimitiveUP(type: Prim, minIndex: number, numVertices: number, primitiveCount: number,
    indices: Uint8Array, indexFormat: Fmt, vertices: Uint8Array, stride: number): void {
    const isz = indexFormat === Fmt.INDEX32 ? 4 : 2;
    this.dev(73, [type, minIndex, numVertices, primitiveCount, 1, indexFormat, 1, stride],
      [indices.slice(0, primVertices(type, primitiveCount) * isz), vertices.slice(0, (minIndex + numVertices) * stride)]);
  }
}
