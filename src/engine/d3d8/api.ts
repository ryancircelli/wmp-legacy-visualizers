// The Direct3D 8 device the D3D families (Yule Log, Rhythm and Waves, Energy Bliss, Ice Storm, Snow and Softie,
// Grind, T3, Looney Tunes) draw through. Their DLLs called IDirect3DDevice8; the ports call this, with the same
// methods, arguments and binary structures, so that:
//   - ref.ts implements it as a software rasterizer that matches Microsoft's reference rasterizer (the DirectX 8.1
//     SDK's d3dref8.dll) bit for bit, which is what the ports are measured against;
//   - trace.ts implements it as a recorder writing the same call trace the private harness records from the real
//     DLLs, so a port's calls can be compared with its DLL's before any pixel is drawn.
// Structures are passed as their D3D binary layouts (little-endian, floats as float32 bits) so that nothing is
// rounded on the way: a matrix is 16 float32s, a light 104 bytes, a material 68, a viewport 24.
// Only what the eight DLLs use is here.

/** D3DFORMAT values in use */
export const enum Fmt {
  R8G8B8 = 20, A8R8G8B8 = 21, X8R8G8B8 = 22, R5G6B5 = 23, X1R5G5B5 = 24, A1R5G5B5 = 25, A4R4G4B4 = 26, A8 = 28,
  L8 = 50, D16 = 80, D24S8 = 75, D32 = 71, INDEX16 = 101, INDEX32 = 102,
  DXT1 = 0x31545844, DXT3 = 0x33545844, DXT5 = 0x35545844,
}
export const enum Pool { DEFAULT = 0, MANAGED = 1, SYSTEMMEM = 2 }
export const enum Usage { RENDERTARGET = 1, DEPTHSTENCIL = 2, WRITEONLY = 8, SOFTWAREPROCESSING = 0x10, DONOTCLIP = 0x20, POINTS = 0x40, DYNAMIC = 0x200 }
export const enum Lock { READONLY = 0x10, DISCARD = 0x2000, NOOVERWRITE = 0x1000, NOSYSLOCK = 0x800, NO_DIRTY_UPDATE = 0x8000 }
export const enum Prim { POINTLIST = 1, LINELIST = 2, LINESTRIP = 3, TRIANGLELIST = 4, TRIANGLESTRIP = 5, TRIANGLEFAN = 6 }
export const enum ClearFlag { TARGET = 1, ZBUFFER = 2, STENCIL = 4 }
/** D3DTRANSFORMSTATETYPE: VIEW 2, PROJECTION 3, TEXTURE0..7 16..23, WORLD 256 (+n for WORLDMATRIX(n)) */
export const enum Ts { VIEW = 2, PROJECTION = 3, TEXTURE0 = 16, WORLD = 256 }
/** D3DFVF bits */
export const enum Fvf {
  XYZ = 0x2, XYZRHW = 0x4, XYZB1 = 0x6, NORMAL = 0x10, PSIZE = 0x20, DIFFUSE = 0x40, SPECULAR = 0x80,
  TEXCOUNT_SHIFT = 8, TEXCOUNT_MASK = 0xf00,
}
/** D3DRENDERSTATETYPE */
export const enum Rs {
  ZENABLE = 7, FILLMODE = 8, SHADEMODE = 9, ZWRITEENABLE = 14, ALPHATESTENABLE = 15, LASTPIXEL = 16, SRCBLEND = 19,
  DESTBLEND = 20, CULLMODE = 22, ZFUNC = 23, ALPHAREF = 24, ALPHAFUNC = 25, DITHERENABLE = 26, ALPHABLENDENABLE = 27,
  FOGENABLE = 28, SPECULARENABLE = 29, ZVISIBLE = 30, FOGCOLOR = 34, FOGTABLEMODE = 35, FOGSTART = 36, FOGEND = 37,
  FOGDENSITY = 38, EDGEANTIALIAS = 40, ZBIAS = 47, RANGEFOGENABLE = 48, STENCILENABLE = 52, STENCILFAIL = 53,
  STENCILZFAIL = 54, STENCILPASS = 55, STENCILFUNC = 56, STENCILREF = 57, STENCILMASK = 58, STENCILWRITEMASK = 59,
  TEXTUREFACTOR = 60, WRAP0 = 128, CLIPPING = 136, LIGHTING = 137, AMBIENT = 139, FOGVERTEXMODE = 140,
  COLORVERTEX = 141, LOCALVIEWER = 142, NORMALIZENORMALS = 143, DIFFUSEMATERIALSOURCE = 145,
  SPECULARMATERIALSOURCE = 146, AMBIENTMATERIALSOURCE = 147, EMISSIVEMATERIALSOURCE = 148, VERTEXBLEND = 151,
  CLIPPLANEENABLE = 152, SOFTWAREVERTEXPROCESSING = 153, POINTSIZE = 154, POINTSIZE_MIN = 155,
  POINTSPRITEENABLE = 156, POINTSCALEENABLE = 157, POINT_SCALE_A = 158, POINT_SCALE_B = 159, POINT_SCALE_C = 160,
  MULTISAMPLEANTIALIAS = 161, MULTISAMPLEMASK = 162, PATCHEDGESTYLE = 163, PATCHSEGMENTS = 164, POINTSIZE_MAX = 166,
  INDEXEDVERTEXBLENDENABLE = 167, COLORWRITEENABLE = 168, TWEENFACTOR = 170, BLENDOP = 171,
}
/** D3DTEXTURESTAGESTATETYPE */
export const enum Tss {
  COLOROP = 1, COLORARG1 = 2, COLORARG2 = 3, ALPHAOP = 4, ALPHAARG1 = 5, ALPHAARG2 = 6, BUMPENVMAT00 = 7,
  BUMPENVMAT01 = 8, BUMPENVMAT10 = 9, BUMPENVMAT11 = 10, TEXCOORDINDEX = 11, ADDRESSU = 13, ADDRESSV = 14,
  BORDERCOLOR = 15, MAGFILTER = 16, MINFILTER = 17, MIPFILTER = 18, MIPMAPLODBIAS = 19, MAXMIPLEVEL = 20,
  MAXANISOTROPY = 21, BUMPENVLSCALE = 22, BUMPENVLOFFSET = 23, TEXTURETRANSFORMFLAGS = 24, ADDRESSW = 25,
  COLORARG0 = 26, ALPHAARG0 = 27, RESULTARG = 28,
}

export interface Rect { left: number; top: number; right: number; bottom: number }
/** A locked range: `data` views the resource's own memory from the rect's (or offset's) first byte; rows are
 *  `pitch` bytes apart. Writes land when the matching unlock is called. */
export interface Locked { data: Uint8Array; pitch: number }

export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly format: Fmt;
  lockRect(rect: Rect | null, flags: number): Locked;
  unlockRect(): void;
}
export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  readonly format: Fmt;
  getSurfaceLevel(level: number): Surface;
  lockRect(level: number, rect: Rect | null, flags: number): Locked;
  unlockRect(level: number): void;
}
export interface Buffer {
  readonly length: number;
  /** size 0 = to the end of the buffer */
  lock(offset: number, size: number, flags: number): Uint8Array;
  unlock(): void;
}

/** A state block token (BeginStateBlock/EndStateBlock or CreateStateBlock) */
export type StateBlock = number;
/** A vertex shader: an FVF code (bit 0 clear) or a handle CreateVertexShader returned (bit 0 set) */
export type VertexShader = number;

export interface Device {
  readonly width: number;
  readonly height: number;
  createTexture(width: number, height: number, levels: number, usage: number, format: Fmt, pool: Pool): Texture;
  createVertexBuffer(length: number, usage: number, fvf: number, pool: Pool): Buffer;
  createIndexBuffer(length: number, usage: number, format: Fmt, pool: Pool): Buffer;
  createRenderTarget(width: number, height: number, format: Fmt, lockable: boolean): Surface;
  createDepthStencilSurface(width: number, height: number, format: Fmt): Surface;
  createImageSurface(width: number, height: number, format: Fmt): Surface;
  getBackBuffer(): Surface;
  getRenderTarget(): Surface;
  getDepthStencilSurface(): Surface | null;
  setRenderTarget(target: Surface | null, depth: Surface | null): void;
  copyRects(src: Surface, rects: Rect[] | null, dst: Surface, points: { x: number; y: number }[] | null): void;
  updateTexture(src: Texture, dst: Texture): void;

  beginScene(): void;
  endScene(): void;
  /** returns the back buffer as presented (the frame) */
  present(): void;
  clear(rects: Rect[] | null, flags: number, color: number, z: number, stencil: number): void;

  /** 16 float32s, row-major as D3DMATRIX (_11 _12 _13 _14 _21 ...) */
  setTransform(type: number, m: Float32Array): void;
  multiplyTransform(type: number, m: Float32Array): void;
  /** D3DVIEWPORT8: X, Y, Width, Height (u32), MinZ, MaxZ (f32) */
  setViewport(vp: ArrayBuffer): void;
  /** D3DMATERIAL8, 68 bytes */
  setMaterial(m: ArrayBuffer): void;
  /** D3DLIGHT8, 104 bytes */
  setLight(index: number, light: ArrayBuffer): void;
  lightEnable(index: number, enable: boolean): void;
  setClipPlane(index: number, plane: Float32Array): void;
  /** value as the DWORD the DLL passed (a float state is its float32 bits) */
  setRenderState(state: Rs, value: number): void;
  setTextureStageState(stage: number, type: Tss, value: number): void;
  setTexture(stage: number, tex: Texture | null): void;

  beginStateBlock(): void;
  endStateBlock(): StateBlock;
  createStateBlock(type: number): StateBlock;
  applyStateBlock(token: StateBlock): void;
  captureStateBlock(token: StateBlock): void;
  deleteStateBlock(token: StateBlock): void;

  /** declaration and function as their DWORD token streams (function null for a fixed-function declaration) */
  createVertexShader(declaration: Uint32Array, fn: Uint32Array | null, usage: number): VertexShader;
  setVertexShader(shader: VertexShader): void;
  deleteVertexShader(shader: VertexShader): void;
  setVertexShaderConstant(register: number, data: Float32Array, count: number): void;
  createPixelShader(fn: Uint32Array): number;
  setPixelShader(shader: number): void;
  deletePixelShader(shader: number): void;
  setPixelShaderConstant(register: number, data: Float32Array, count: number): void;

  setStreamSource(stream: number, vb: Buffer | null, stride: number): void;
  setIndices(ib: Buffer | null, baseVertexIndex: number): void;
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void;
  drawIndexedPrimitive(type: Prim, minIndex: number, numVertices: number, startIndex: number, primitiveCount: number): void;
  drawPrimitiveUP(type: Prim, primitiveCount: number, vertices: Uint8Array, stride: number): void;
  drawIndexedPrimitiveUP(type: Prim, minIndex: number, numVertices: number, primitiveCount: number,
    indices: Uint8Array, indexFormat: Fmt, vertices: Uint8Array, stride: number): void;
}

/** vertices a primitive count needs (D3DPRIMITIVETYPE) */
export function primVertices(type: Prim, count: number): number {
  switch (type) {
    case Prim.POINTLIST: return count;
    case Prim.LINELIST: return count * 2;
    case Prim.LINESTRIP: return count + 1;
    case Prim.TRIANGLELIST: return count * 3;
    default: return count + 2;
  }
}
