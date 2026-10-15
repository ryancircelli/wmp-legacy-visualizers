// The Direct3D 9 device the Psychedelia families (Bubbles first) draw through. Their DLLs called IDirect3DDevice9
// (through D3DX9 effects); the ports call this, with the same methods, argument order and binary structures, and
// ref.ts implements it as a software rasterizer matching Microsoft's reference rasterizer (d3dref9.dll) bit for bit.
// Structures are passed in their D3D binary layouts: a vertex declaration as its D3DVERTEXELEMENT9 bytes, shaders as
// their DWORD token streams, shader constants as float32s. Only what the ports use is here.

/** D3DFORMAT values in use */
export const enum Fmt { A8R8G8B8 = 21, X8R8G8B8 = 22, D16 = 80 }
export const enum Pool { DEFAULT = 0, MANAGED = 1, SYSTEMMEM = 2 }
export const enum Usage { RENDERTARGET = 1, DEPTHSTENCIL = 2, WRITEONLY = 8, DYNAMIC = 0x200, AUTOGENMIPMAP = 0x400 }
export const enum Prim { TRIANGLELIST = 4, TRIANGLESTRIP = 5, TRIANGLEFAN = 6 }
export const enum ClearFlag { TARGET = 1, ZBUFFER = 2, STENCIL = 4 }
/** D3DRENDERSTATETYPE (the ones the reference device honours here) */
export const enum Rs {
  ZENABLE = 7, ZWRITEENABLE = 14, ALPHATESTENABLE = 15, SRCBLEND = 19, DESTBLEND = 20, CULLMODE = 22, ZFUNC = 23,
  ALPHAREF = 24, ALPHAFUNC = 25, DITHERENABLE = 26, ALPHABLENDENABLE = 27, LIGHTING = 137, COLORWRITEENABLE = 168,
  BLENDOP = 171,
}
/** D3DSAMPLERSTATETYPE */
export const enum Ss {
  ADDRESSU = 1, ADDRESSV = 2, ADDRESSW = 3, BORDERCOLOR = 4, MAGFILTER = 5, MINFILTER = 6, MIPFILTER = 7,
  MIPMAPLODBIAS = 8, MAXMIPLEVEL = 9, MAXANISOTROPY = 10, SRGBTEXTURE = 11, ELEMENTINDEX = 12,
}
/** D3DTEXTUREFILTERTYPE / D3DTEXTUREADDRESS / D3DBLEND / D3DCULL values in use */
export const enum Filter { NONE = 0, POINT = 1, LINEAR = 2 }
export const enum Address { WRAP = 1, MIRROR = 2, CLAMP = 3, BORDER = 4 }
export const enum Blend { ZERO = 1, ONE = 2, SRCALPHA = 5, INVSRCALPHA = 6 }
export const enum Cull { NONE = 1, CW = 2, CCW = 3 }

export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Point { x: number; y: number }
/** A locked range: `data` views the resource's memory from the rect's first byte; rows are `pitch` bytes apart */
export interface Locked { data: Uint8Array; pitch: number }

export interface Surface9 {
  readonly width: number;
  readonly height: number;
  readonly format: Fmt;
  lockRect(rect: Rect | null, flags: number): Locked;
  unlockRect(): void;
}
export interface Texture9 {
  readonly width: number;
  readonly height: number;
  /** the level count the application sees (1 for an AUTOGENMIPMAP texture, as GetLevelCount) */
  readonly levels: number;
  readonly format: Fmt;
  getSurfaceLevel(level: number): Surface9;
  lockRect(level: number, rect: Rect | null, flags: number): Locked;
  unlockRect(level: number): void;
}
export interface Buffer9 {
  readonly length: number;
  /** size 0 = to the end of the buffer */
  lock(offset: number, size: number, flags: number): Uint8Array;
  unlock(): void;
}

export interface Device9 {
  readonly width: number;
  readonly height: number;
  createTexture(width: number, height: number, levels: number, usage: number, format: Fmt, pool: Pool): Texture9;
  createVertexBuffer(length: number, usage: number, fvf: number, pool: Pool): Buffer9;
  /** D3DVERTEXELEMENT9 bytes (8 per element) including the D3DDECL_END element */
  createVertexDeclaration(elements: Uint8Array): number;
  /** a vs_1_1 / ps_2_0 token stream (version token first, 0x0000FFFF last) */
  createVertexShader(tokens: Uint32Array): number;
  createPixelShader(tokens: Uint32Array): number;
  getBackBuffer(): Surface9;
  updateSurface(src: Surface9, srcRect: Rect | null, dst: Surface9, dstPoint: Point | null): void;

  beginScene(): void;
  endScene(): void;
  /** the back buffer as presented: X8R8G8B8 (bytes B, G, R, 0), `width * 4` bytes a row */
  present(): Uint8Array;
  clear(rects: Rect[] | null, flags: number, color: number, z: number, stencil: number): void;

  setRenderState(state: Rs, value: number): void;
  setSamplerState(sampler: number, type: Ss, value: number): void;
  setTexture(stage: number, tex: Texture9 | null): void;
  setStreamSource(stream: number, vb: Buffer9 | null, offsetBytes: number, stride: number): void;
  setVertexDeclaration(decl: number): void;
  setVertexShader(shader: number): void;
  setPixelShader(shader: number): void;
  setVertexShaderConstantF(register: number, data: Float32Array, count: number): void;
  setPixelShaderConstantF(register: number, data: Float32Array, count: number): void;
  drawPrimitive(type: Prim, startVertex: number, primitiveCount: number): void;
}
