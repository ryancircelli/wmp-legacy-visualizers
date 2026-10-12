// The Direct3D 8 device 3D Alchemy draws through, reduced to what mpvis3d.dll calls: state (transforms, render
// and texture-stage states, material, lights, textures, stream source, indices), resources (textures, vertex and
// index buffers), and the draws, which raster.ts carries out. It also keeps, when `recording` is set, the DLL's
// call stream as the private A/B host logs it (each call: 0xC0DE0000 | its d3d8.h vtable slot, then its
// arguments as 32-bit words; textures and buffers as ids by first use; each draw's vertex and index bytes as an
// FNV-1a), so the port's scene can be compared call for call with the DLL's.
import { rasterize, type Target } from './raster';

export const D3D = {
  // transform states
  VIEW: 2, PROJECTION: 3, WORLD: 256,
  // render states
  ZENABLE: 7, CULLMODE: 22, SPECULARENABLE: 29, WRAP0: 128, LIGHTING: 137, AMBIENT: 139,
  DIFFUSEMATERIALSOURCE: 145, SPECULARMATERIALSOURCE: 146, AMBIENTMATERIALSOURCE: 147,
  // texture stage states
  COLOROP: 1, COLORARG1: 2, COLORARG2: 3, MAGFILTER: 16, MINFILTER: 17, MIPFILTER: 18,
  // primitive types
  POINTLIST: 1, TRIANGLELIST: 4, TRIANGLESTRIP: 5,
  // formats
  A8R8G8B8: 21, X8R8G8B8: 22,
  // FVFs
  FVF_XYZ_DIFFUSE: 0x42, FVF_MESH: 0x1d2,
} as const;

export class Texture {
  /** level 0, 0xAARRGGBB; the scene's textures have one level or the D3DX mip chain the DLL asked for */
  levels: Uint32Array[];
  constructor(public w: number, public h: number, public fmt: number, nLevels = 1, fill = 0) {
    this.levels = [];
    for (let i = 0, lw = w, lh = h; i < nLevels; i++, lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) this.levels.push(new Uint32Array(lw * lh).fill(fill));
  }
  get px(): Uint32Array { return this.levels[0]; }
  /** each level from the one above, 2x2 point (D3DX_FILTER_POINT mip filter: the top-left texel) */
  pointMips(): void {
    for (let i = 1; i < this.levels.length; i++) {
      const sw = Math.max(1, this.w >> (i - 1)), dw = Math.max(1, this.w >> i), dh = Math.max(1, this.h >> i);
      const s = this.levels[i - 1], d = this.levels[i];
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) d[y * dw + x] = s[(2 * y) * sw + 2 * x];
    }
  }
}

export class VertexBuffer {
  bytes: Uint8Array;
  f32: Float32Array;
  u32: Uint32Array;
  constructor(public length: number, public fvf: number) {
    this.bytes = new Uint8Array(length);
    this.f32 = new Float32Array(this.bytes.buffer);
    this.u32 = new Uint32Array(this.bytes.buffer);
  }
}

export class IndexBuffer {
  idx: Uint16Array;
  constructor(count: number) { this.idx = new Uint16Array(count); }
}

/** D3DMATERIAL8: diffuse rgba, ambient rgba, specular rgba, emissive rgba, power */
export type Material = Float32Array;
/** D3DLIGHT8 as 26 words: Type, then diffuse, specular, ambient (rgba), position, direction, range, falloff,
 *  attenuation 0/1/2, theta, phi as floats (the Type word is stored as its integer value) */
export type Light = Float32Array;

function fnvBytes(b: Uint8Array, off: number, n: number): number {
  let h = 0x811c9dc5 | 0;                    // an int32 from the start: the loop stays on small integers
  for (let i = off, e = off + n; i < e; i++) h = Math.imul(h ^ b[i], 16777619);
  return h >>> 0;
}
const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const fbits = (v: number): number => { F1[0] = v; return U1[0]; };

export class Device {
  // ---- state
  transforms = new Map<number, Float32Array>();
  rs = new Map<number, number>();
  tss = new Map<number, number>();
  textures: (Texture | null)[] = [null];
  material: Material = new Float32Array(17);
  lights = new Map<number, Light>();
  lightOn = new Map<number, boolean>();
  vb: VertexBuffer | null = null;
  stride = 0;
  ib: IndexBuffer | null = null;
  fvf = 0;
  target: Target;
  /** D3DCAPS8.TextureFilterCaps the DLL reads (0x447350): the reference GPU's, anisotropic magnification */
  textureFilterCaps = 0x07030700;

  /** draw the pixels (raster.ts); off, only the state and the call stream are kept */
  raster = true;
  // ---- the A/B call stream
  recording = false;
  words: number[] = [];
  private ids = { tex: new Map<object, number>(), vb: new Map<object, number>(), ib: new Map<object, number>() };

  constructor(width: number, height: number) {
    this.target = { w: width, h: height, color: new Uint32Array(width * height), z: new Float32Array(width * height) };
    // D3D8's defaults where the scene relies on them
    this.rs.set(D3D.ZENABLE, 1); this.rs.set(D3D.CULLMODE, 3); this.rs.set(D3D.LIGHTING, 1);
    this.rs.set(D3D.AMBIENT, 0); this.rs.set(D3D.SPECULARENABLE, 0); this.rs.set(D3D.WRAP0, 0);
    this.rs.set(D3D.DIFFUSEMATERIALSOURCE, 1); this.rs.set(D3D.SPECULARMATERIALSOURCE, 2); this.rs.set(D3D.AMBIENTMATERIALSOURCE, 0);
    this.tss.set(D3D.COLOROP, 4); this.tss.set(D3D.COLORARG1, 2); this.tss.set(D3D.COLORARG2, 1);
    this.tss.set(D3D.MAGFILTER, 1); this.tss.set(D3D.MINFILTER, 1); this.tss.set(D3D.MIPFILTER, 0);
  }

  resize(width: number, height: number): void {
    this.target = { w: width, h: height, color: new Uint32Array(width * height), z: new Float32Array(width * height) };
  }

  private rec(slot: number): void { this.words.push((0xc0de0000 | slot) >>> 0); }
  private w(v: number): void { this.words.push(v >>> 0); }
  private id(kind: 'tex' | 'vb' | 'ib', o: object | null): number {
    if (!o) return 0;
    const m = this.ids[kind];
    let v = m.get(o);
    if (v === undefined) { v = m.size + 1; m.set(o, v); }
    return v;
  }
  /** the frame's stream so far, as bytes, and empty it */
  takeStream(): Uint8Array {
    const out = new Uint8Array(new Uint32Array(this.words).buffer);
    this.words.length = 0;
    return out;
  }

  // ---- the calls
  clear(flags: number, color: number, z: number, stencil: number): void {
    if (this.recording) { this.rec(36); this.w(0); this.w(flags); this.w(color); this.w(fbits(z)); this.w(stencil); }
    const t = this.target;
    if (!this.raster) return;
    if (flags & 1) t.color.fill(color & 0xffffff);
    if (flags & 2) t.z.fill(z);
  }
  updateTexture(src: Texture, dst: Texture): void {
    if (this.recording) { this.rec(29); this.w(this.id('tex', src)); this.w(this.id('tex', dst)); }
    for (let i = 0; i < dst.levels.length && i < src.levels.length; i++) dst.levels[i].set(src.levels[i]);
  }
  beginScene(): void { if (this.recording) this.rec(34); }
  endScene(): void { if (this.recording) this.rec(35); }
  present(): void { if (this.recording) this.rec(15); }
  setTransform(state: number, m: Float32Array): void {
    if (this.recording) { this.rec(37); this.w(state); for (let i = 0; i < 16; i++) this.w(fbits(m[i])); }
    this.transforms.set(state, Float32Array.from(m));
  }
  setRenderState(state: number, v: number): void {
    if (this.recording) { this.rec(50); this.w(state); this.w(v); }
    this.rs.set(state, v >>> 0);
  }
  getRenderState(state: number): number { return this.rs.get(state) ?? 0; }
  setTextureStageState(stage: number, type: number, v: number): void {
    if (this.recording) { this.rec(63); this.w(stage); this.w(type); this.w(v); }
    if (stage === 0) this.tss.set(type, v >>> 0);
  }
  setTexture(stage: number, t: Texture | null): void {
    if (this.recording) {
      this.rec(61); this.w(stage); this.w(this.id('tex', t));
      if (t) { this.w(t.fmt); this.w(t.w); this.w(t.h); this.w(t.levels.length); }
    }
    this.textures[stage] = t;
  }
  getTexture(stage: number): Texture | null { return this.textures[stage] ?? null; }
  setMaterial(m: Material): void {
    if (this.recording) { this.rec(42); for (let i = 0; i < 17; i++) this.w(fbits(m[i])); }
    this.material = Float32Array.from(m);
  }
  getMaterial(): Material { return Float32Array.from(this.material); }
  setLight(index: number, l: Light): void {
    if (this.recording) { this.rec(44); this.w(index); this.w(l[0]); for (let i = 1; i < 26; i++) this.w(fbits(l[i])); }
    this.lights.set(index, Float32Array.from(l));
  }
  lightEnable(index: number, on: boolean): void {
    if (this.recording) { this.rec(46); this.w(index); this.w(on ? 1 : 0); }
    this.lightOn.set(index, on);
  }
  setStreamSource(stream: number, vb: VertexBuffer, stride: number): void {
    if (this.recording) { this.rec(83); this.w(stream); this.w(this.id('vb', vb)); this.w(stride); }
    this.vb = vb; this.stride = stride;
  }
  setVertexShader(fvf: number): void {
    if (this.recording) { this.rec(76); this.w(fvf); }
    this.fvf = fvf;
  }
  setIndices(ib: IndexBuffer, base: number): void {
    if (this.recording) { this.rec(85); this.w(this.id('ib', ib)); this.w(base); }
    this.ib = ib;
  }
  private vbHash(first: number, n: number): number {
    const vb = this.vb!;
    return fnvBytes(vb.bytes, first * this.stride, n * this.stride);
  }
  drawPrimitive(type: number, start: number, count: number): void {
    if (this.recording) {
      this.rec(70); this.w(type); this.w(start); this.w(count);
      // a POINTLIST from its second vertex: the DLL's starfield never writes its first point (heap garbage)
      this.w(type === D3D.POINTLIST ? this.vbHash(start + 1, count - 1) : this.vbHash(start, vertsOf(type, count)));
    }
    if (this.raster) rasterize(this, type, start, count, null, 0);
  }
  drawIndexedPrimitive(type: number, minIdx: number, numV: number, startIdx: number, primCount: number): void {
    if (this.recording) {
      this.rec(71); this.w(type); this.w(minIdx); this.w(numV); this.w(startIdx); this.w(primCount);
      // the 1x1 grid (Draco's room's floor): the DLL never clears that path's normal sums (0x00446cf7), so its
      // normals are heap garbage; the A/B hashes it without them
      if (numV === 4 && primCount === 2 && this.stride === 40) {
        const b = this.vb!.bytes.slice(minIdx * 40, (minIdx + 4) * 40);
        for (let v = 0; v < 4; v++) b.fill(0, v * 40 + 12, v * 40 + 24);
        this.w(fnvBytes(b, 0, b.length));
      } else this.w(this.vbHash(minIdx, numV));
      const ib = this.ib!;
      this.w(fnvBytes(new Uint8Array(ib.idx.buffer), startIdx * 2, vertsOf(type, primCount) * 2));
    }
    if (this.raster) rasterize(this, type, startIdx, primCount, this.ib, minIdx);
  }
}

export function vertsOf(type: number, pc: number): number {
  switch (type) { case 1: return pc; case 2: return 2 * pc; case 3: return pc + 1; case 4: return 3 * pc; default: return pc + 2; }
}
