// Picture Viz 3D: the Direct3D framework (Averett & Associates' Plugin framework over the DirectX 8 SDK's
// CD3DApplication, its Water sample (CWater, in the main object at 0x3718..0x3750), its PointSprites sample
// (CParticleSystem), two CD3DFonts and the "Water effect" through ID3DXEffect). Each function reproduces the DLL
// function at the VA in its comment; offsets are the main object's.
//
// Device objects the object holds as pointers hold handles here (Core.handle). IDirect3D8 enumeration and the
// device's Get*/Validate/TestCooperativeLevel calls are not traced: only their effect on the fields later code
// reads is reproduced. D3DX keeps state of its own (the effect's techniques and the vertex shader and textures it
// restores at End, ID3DXRenderToSurface's viewport block): `St` holds it, with the DLL's statics (DXUtil_Timer,
// the particle clock, the caustics shade table).
import { type Core, def, vt, tick, unported, lb } from './core';
import { ftol } from '../pv2/mem';
import {
  fr, fr64, matMul, translation, quatYawPitchRoll, matRotQuat, perspectiveFovRH, vec3Normalize, textureFromPixels,
} from './d3dx';
import { sincos87, mulExt } from '../../plenoptic/x87';
import { A } from '../../ns';
import '../../rand';
import {
  type Texture, type Surface, type Buffer, type StateBlock, Fmt, Pool, Usage, Lock, Prim, ClearFlag, Ts, Rs, Tss,
} from '../../d3d8/api';

// ------------------------------------------------------------------------------------------------ state
interface Font { tex?: Texture; vb?: Buffer; blocks?: StateBlock[] }
interface St {
  // DXUtil_Timer (0x10002f10) statics: QPC ticks (microseconds)
  tInit: boolean; tStopped: boolean; tStop: number; tLast: number; tBase: number;
  /** CParticleSystem's clock (static float 0x10098eb8) */
  ptime: number;
  /** the caustics' shades by triangle area (static 0x10098ef0) */
  shade: Uint32Array;
  /** the device's vertex shader and textures 0/1 as the port last set them (ID3DXEffect::Begin reads them back) */
  vs: number; tex0: Texture | null; tex1: Texture | null;
  saved: [number, Texture | null, Texture | null];
  /** the effect: technique 0's saved-state block and pass block, its texture parameters (handles) */
  effSaved: StateBlock; effPass: StateBlock; tFLR: number; tCAU: number;
  /** ID3DXRenderToSurface: its viewport block, the render target / depth it replaced */
  rtsBlock: StateBlock; rtsOld: Surface | null; rtsOldDs: Surface | null;
  /** the DATATABLE_tga resource (the 18-byte header the floor texture is built on) */
  tga: number;
}
const STATE = new WeakMap<Core, St>();
function st(c: Core): St {
  let s = STATE.get(c);
  if (!s) {
    s = {
      tInit: false, tStopped: true, tStop: 0, tLast: 0, tBase: 0, ptime: 0, shade: new Uint32Array(8),
      vs: 0, tex0: null, tex1: null, saved: [0, null, null], effSaved: 0, effPass: 0, tFLR: 0, tCAU: 0,
      rtsBlock: 0, rtsOld: null, rtsOldDs: null, tga: 0,
    };
    STATE.set(c, s);
  }
  return s;
}
const tex = (c: Core, h: number): Texture | null => (h ? c.objs[h] as Texture : null);
const mat = (c: Core, o: number): Float32Array => c.m.F.subarray(o >> 2, (o >> 2) + 16);
function setVS(c: Core, v: number): void { c.d.setVertexShader(v); st(c).vs = v; }
function setTex(c: Core, stage: number, t: Texture | null): void {
  c.d.setTexture(stage, t);
  if (stage === 0) st(c).tex0 = t; else if (stage === 1) st(c).tex1 = t;
}
/** a C string into the object */
function putStr(c: Core, off: number, s: string): void {
  const B = c.m.B;
  for (let i = 0; i < s.length; i++) B[off + i] = s.charCodeAt(i);
  B[off + s.length] = 0;
}
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** the DATATABLE_tga resource (Windows XP let the DLL write the floor's size into it): uncompressed true colour,
 *  32 bits, 8 alpha bits, bottom-up; its 4x4 sample image and footer are never read */
export function tgaRes(c: Core): number {
  const s = st(c);
  if (!s.tga) {
    const p = c.m.malloc(0x6c), B = c.m.B;
    B[p + 2] = 2; B[p + 12] = 4; B[p + 14] = 4; B[p + 16] = 0x20; B[p + 17] = 8;
    s.tga = p;
  }
  return s.tga;
}

// ------------------------------------------------------------------------------------------------ DXUtil_Timer
/** 0x10002f10 DXUtil_Timer(cmd): QueryPerformanceCounter at 1 MHz (timeGetTime * 1000). 0 reset, 1 start, 2 stop,
 *  3 advance, 4 absolute time, 5 app time, 6 elapsed time; times in seconds as x87 doubles */
export function f10002f10(c: Core, cmd: number): number {
  const s = st(c);
  s.tInit = true;
  const now = s.tStop !== 0 && cmd !== 1 && cmd !== 4 ? s.tStop : (tick(c) >>> 0) * 1000;
  switch (cmd) {
    case 6: { const e = now - s.tLast; s.tLast = now; return e / 1e6; }
    case 5: return (now - s.tBase) / 1e6;
    case 0: s.tBase = now; s.tLast = now; s.tStop = 0; s.tStopped = false; return 0;
    case 1:
      if (s.tStopped) s.tBase += now - s.tStop;
      s.tStop = 0; s.tLast = now; s.tStopped = false; return 0;
    case 2: s.tStop = now; s.tLast = now; s.tStopped = true; return 0;
    case 3: s.tStop += 100000; return 0;
    case 4: return now / 1e6;
  }
  return -1;
}

// ------------------------------------------------------------------------------------------------ device setup
/** vt+0x118 0x10001000 CD3DApplication::Create, the first time a frame has a window: Direct3DCreate8, the device
 *  list, the window's rects, the timer, OneTimeSceneInit, Initialize3DEnvironment */
function create(c: Core): number {
  let I = c.m.I;
  if (I[0x37ac >> 2] !== 0) return 0;
  if (I[0x317b4 >> 2] === 0 && I[0x20 >> 2] === 0) return 0;
  I[0x37ac >> 2] = c.handle({});              // IDirect3D8
  if (vt(c, 0x15c) < 0) unported(0x1000106b);
  I = c.m.I;
  const hwnd = I[0x20 >> 2] || I[0x317b4 >> 2];
  I[0x37a0 >> 2] = hwnd;
  // GetWindowLongA(GWL_STYLE), GetWindowRect, GetClientRect: the window is the client area at (0, 0)
  const w = I[0x310dc >> 2], h = I[0x310e0 >> 2];
  I[0x38ac >> 2] = 0;
  I[0x38b0 >> 2] = 0; I[0x38b4 >> 2] = 0; I[0x38b8 >> 2] = w; I[0x38bc >> 2] = h;
  I[0x38c0 >> 2] = 0; I[0x38c4 >> 2] = 0; I[0x38c8 >> 2] = w; I[0x38cc >> 2] = h;
  f10002f10(c, 1);
  if (vt(c, 0x11c) < 0) return 0;
  if (vt(c, 0x120) < 0) return 0;
  f100073f0(c);
  if (c.m.I[0x30fe0 >> 2] === 0) vt(c, 0x108);
  c.m.I[0x2de98 >> 2] = 1;
  return 0;
}

// the device list: adapter 0 at 0x3a48 (0x43a0 bytes), its devices from +0x440 (0xcac bytes), each device's modes
// from +0xe4 (0x14 bytes: width, height, format, behavior flags, depth format)
const ADP = 0x3a48, DEV0 = ADP + 0x440;
/** vt+0x15c 0x100018c0 BuildDeviceList, reduced to what Initialize3DEnvironment and the stats text read: one
 *  adapter (desktop X8R8G8B8, "Reference Rasterizer"), device 0 HAL windowed with the 640x480 mode, pure hardware
 *  vertex processing (ConfirmDevice accepts it) and the depth format FindDepthStencilFormat picks, device 1 REF;
 *  the first windowed device is selected. (The caps and the mode list the DLL copies from IDirect3D8 are not.) */
function buildDeviceList(c: Core): number {
  vt(c, 0x110, 0x50);                         // ConfirmDevice(caps, D3DCREATE_PUREDEVICE | HARDWARE_VERTEXPROCESSING)
  const depth = vt(c, 0x160);
  const I = c.m.I;
  putStr(c, ADP + 0x200, 'Reference Rasterizer');
  I[(ADP + 0x438) >> 2] = Fmt.X8R8G8B8;       // the desktop mode's format
  I[(ADP + 0x43c) >> 2] = 2;                  // devices
  I[DEV0 >> 2] = 1;                           // D3DDEVTYPE_HAL
  const m = DEV0 + 0xe4;
  I[m >> 2] = 640; I[(m + 4) >> 2] = 480; I[(m + 8) >> 2] = Fmt.X8R8G8B8; I[(m + 0xc) >> 2] = 0x50; I[(m + 0x10) >> 2] = depth;
  I[(DEV0 + 0xc9c) >> 2] = 0;                 // current mode
  I[(DEV0 + 0xca0) >> 2] = 1;                 // can run windowed
  I[(DEV0 + 0xcac) >> 2] = 2;                 // device 1: D3DDEVTYPE_REF
  I[(DEV0 + 0xcac + 0xca0) >> 2] = 1;
  I[(ADP + 0x439c) >> 2] = 0;                 // current device
  I[0x2de88 >> 2] = 1;                        // adapters
  I[0x2de8c >> 2] = 0;                        // current adapter
  I[0x2de90 >> 2] = 1;                        // windowed
  return 0;
}

/** vt+0x160 0x10001fe0 FindDepthStencilFormat by the minimum depth/stencil bits (0x3994, 0x3998): the first of D16,
 *  D15S1, D24X8, D24S8, D24X4S4, D32 the bit counts allow (the reference device supports them all). The DLL
 *  returns TRUE and stores the format; the port returns the format (0 = none) */
function findDepth(c: Core): number {
  const I = c.m.I, d = I[0x3994 >> 2] >>> 0, s = I[0x3998 >> 2] >>> 0;
  if (d < 0x11 && s === 0) return Fmt.D16;
  if (d < 0x10 && s < 2) return 0x49;
  if (d < 0x19 && s === 0) return 0x4d;
  if (d < 0x19 && s < 9) return Fmt.D24S8;
  if (d < 0x19 && s < 5) return 0x4f;
  if (d < 0x21 && s === 0) return Fmt.D32;
  return 0;
}

/** vt+0x120 0x10002240 Initialize3DEnvironment: the present parameters, CreateDevice (the host's device: REF,
 *  D3DCREATE_FPU_PRESERVE | PUREDEVICE | HARDWARE_VERTEXPROCESSING, X8R8G8B8, D16 auto depth), the caps, the
 *  device stats text, the back buffer's description, InitDeviceObjects and RestoreDeviceObjects */
function init3D(c: Core): number {
  let I = c.m.I;
  const base = ADP + I[0x2de8c >> 2] * 0x43a0;
  const dev = base + 0x440 + I[(base + 0x439c) >> 2] * 0xcac;
  const mode = dev + 0xe4 + I[(dev + 0xc9c) >> 2] * 0x14;
  for (let k = 0; k < 13; k++) I[(0x376c >> 2) + k] = 0;
  I[0x3788 >> 2] = I[(dev + 0xca0) >> 2];
  I[0x3778 >> 2] = 1; I[0x3794 >> 2] = 1;
  I[0x377c >> 2] = I[(dev + 0xca0) >> 2] ? I[(dev + 0xca4) >> 2] : I[(dev + 0xca8) >> 2];
  I[0x3780 >> 2] = 1;
  I[0x378c >> 2] = I[0x3990 >> 2];
  I[0x3790 >> 2] = I[(mode + 0x10) >> 2];
  I[0x3784 >> 2] = I[0x37a0 >> 2];
  if (I[0x2de90 >> 2]) {
    I[0x376c >> 2] = I[0x38c8 >> 2] - I[0x38c0 >> 2];
    I[0x3770 >> 2] = I[0x38cc >> 2] - I[0x38c4 >> 2];
    I[0x3774 >> 2] = I[(base + 0x438) >> 2];
  } else {
    I[0x376c >> 2] = I[mode >> 2]; I[0x3770 >> 2] = I[(mode + 4) >> 2]; I[0x3774 >> 2] = I[(mode + 8) >> 2];
  }
  if (I[(dev + 0x24) >> 2] & 0x1000) unported(0x1000236d);
  c.dev = c.env.createDevice(I[0x376c >> 2], I[0x3770 >> 2]);
  const hd = c.handle(c.dev);
  I = c.m.I;
  I[0x37b0 >> 2] = hd;
  if (!I[0x2de90 >> 2]) unported(0x100023c1);
  // GetDeviceCaps into 0x37b4: what is read of it: the device type and the largest texture
  I[0x37b4 >> 2] = 2; I[0x380c >> 2] = 4096; I[0x3810 >> 2] = 4096;
  I[0x39b0 >> 2] = I[0x380c >> 2];
  const beh = I[(mode + 0xc) >> 2], type = I[dev >> 2];
  I[0x38a8 >> 2] = beh;
  let txt = type === 2 ? 'REF' : type === 1 ? 'HAL' : type === 3 ? 'SW' : '';
  if ((beh & 0x40) && (beh & 0x10)) txt += type === 1 ? ' (pure hw vp)' : ' (simulated pure hw vp)';
  else if (beh & 0x40) txt += type === 1 ? ' (hw vp)' : ' (simulated hw vp)';
  else if (beh & 0x80) txt += type === 1 ? ' (mixed vp)' : ' (simulated mixed vp)';
  else if (beh & 0x20) txt += ' (sw vp)';
  if (type === 1) {
    let d = '';
    for (let o = base + 0x200; c.m.B[o]; o++) d += String.fromCharCode(c.m.B[o]);
    txt += ': ' + d;
  }
  putStr(c, 0x38dc, txt);
  c.d.getBackBuffer();
  backBufferDesc(c);
  if (vt(c, 0x124) < 0 || vt(c, 0x144) < 0) unported(0x10002565);
  c.m.I[0x2de94 >> 2] = 1;
  return 0;
}
/** IDirect3DSurface8::GetDesc of the back buffer into 0x3888 */
function backBufferDesc(c: Core): void {
  const I = c.m.I, w = c.d.width, h = c.d.height;
  I[0x3888 >> 2] = Fmt.X8R8G8B8; I[0x388c >> 2] = 1; I[0x3890 >> 2] = Usage.RENDERTARGET; I[0x3894 >> 2] = 0;
  I[0x3898 >> 2] = w * h * 4; I[0x389c >> 2] = 0; I[0x38a0 >> 2] = w; I[0x38a4 >> 2] = h;
}

/** vt+0x11c 0x10002220 OneTimeSceneInit: CWater::Initialize(64, 20) */
function oneTimeSceneInit(c: Core): number {
  const r = f10006160(c, 64, 20);
  return r < 0 ? r : 0;
}

/** vt+0x110 0x100330d0 ConfirmDevice: every device will do */
function confirmDevice(): number { return 0; }

/** vt+0x124 0x100034c0 InitDeviceObjects: the fonts, the floor texture (sprite 4), CWater's device */
function initDeviceObjects(c: Core): number {
  const I = c.m.I;
  I[0x2deec >> 2] = 1; I[0x2def0 >> 2] = 1;
  f10007bf0(c, 0x2deac);
  f10007bf0(c, 0x2deb0);
  c.m.I[0x1ca4 >> 2] = 4;
  vt(c, 0x140);
  return f100062c0(c, c.m.I[0x37b0 >> 2]);
}

/** 0x10007bf0 CD3DFont::InitDeviceObjects (font object handle at `off`): the glyph texture, 256 x 256 A4R4G4B4
 *  for these fonts' heights (<= 20), written while locked. ponytail: the glyphs (GDI's Arial) are not drawn into
 *  it: no font is ever drawn */
export function f10007bf0(c: Core, off: number): number {
  const f = c.obj<Font>(off);
  const t = c.d.createTexture(256, 256, 1, 0, Fmt.A4R4G4B4, Pool.MANAGED);
  t.lockRect(0, null, 0);
  t.unlockRect(0);
  f.tex = t;
  return 0;
}

/** 0x100062c0 CWater: keep the device */
export function f100062c0(c: Core, dev: number): number { c.m.I[0x3744 >> 2] = dev; return 0; }

// CD3DFont's two state blocks (d3dfont.cpp RestoreDeviceObjects)
const FONT_RS: [number, number][] = [[7, 0], [27, 1], [19, 5], [20, 6], [15, 1], [24, 8], [25, 7], [8, 3], [22, 3], [52, 0],
  [136, 1], [40, 0], [152, 0], [151, 0], [167, 0], [28, 0]];
const FONT_TSS: [number, number, number][] = [[0, 1, 4], [0, 2, 2], [0, 3, 0], [0, 4, 4], [0, 5, 2], [0, 6, 0], [0, 17, 1],
  [0, 16, 1], [0, 18, 0], [0, 11, 0], [0, 24, 0], [1, 1, 1], [1, 4, 1]];
/** 0x10007f80 CD3DFont::RestoreDeviceObjects: the vertex buffer, the saved and the drawing state blocks */
export function f10007f80(c: Core, off: number): number {
  const f = c.obj<Font>(off), d = c.d;
  f.vb = d.createVertexBuffer(0x20d0, Usage.WRITEONLY | Usage.DYNAMIC, 0, Pool.DEFAULT);
  f.blocks = [];
  for (let k = 0; k < 2; k++) {
    d.beginStateBlock();
    d.setTexture(0, f.tex || null);
    for (const [s, v] of FONT_RS) d.setRenderState(s, v);
    for (const [stg, s, v] of FONT_TSS) d.setTextureStageState(stg, s, v);
    f.blocks.push(d.endStateBlock());
  }
  return 0;
}

/** vt+0x144 0x10002850 RestoreDeviceObjects: fonts, light 0, the material, the render states, the caustics render
 *  target (128 x 128, the display's format) with its ID3DXRenderToSurface, the water effect, CWater's buffers */
function restoreDeviceObjects(c: Core): number {
  f10007f80(c, 0x2deac);
  f10007f80(c, 0x2deb0);
  const d = c.d, F = c.m.F;
  const L = new ArrayBuffer(104), lu = new Uint32Array(L), lf = new Float32Array(L);
  lu[0] = 3;                                  // D3DLIGHT_DIRECTIONAL
  lf[1] = F[0x2ded0 >> 2]; lf[2] = F[0x2ded4 >> 2]; lf[3] = F[0x2ded8 >> 2]; lf[4] = F[0x2dedc >> 2];
  lf[5] = 1; lf[6] = 1; lf[7] = 1;
  lf[16] = F[0x2dec0 >> 2]; lf[17] = F[0x2dec4 >> 2]; lf[18] = F[0x2dec8 >> 2];
  d.setLight(0, L);
  d.lightEnable(0, false);
  const M = new ArrayBuffer(68), mf = new Float32Array(M);
  mf[3] = 0.5; mf[7] = 0.1; mf[8] = 0.5; mf[9] = 0.5; mf[10] = 0.5; mf[16] = 20;
  d.setMaterial(M);
  setVS(c, 2);
  d.setTransform(Ts.VIEW, mat(c, 0x2df04));
  d.setTransform(Ts.WORLD, mat(c, 0x2df84));
  for (const [s, v] of [[Rs.LIGHTING, 0], [Rs.SPECULARENABLE, 0], [Rs.ZFUNC, 4], [Rs.CULLMODE, 2], [Rs.SHADEMODE, 2],
    [Rs.FILLMODE, 3]] as [Rs, number][]) d.setRenderState(s, v);
  for (const stg of [0, 1]) {
    for (const [s, v] of [[1, 1], [2, 2], [3, 1], [4, 1], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1], [11, 0]] as [Tss, number][]) {
      d.setTextureStageState(stg, s, v);
    }
  }
  // D3DXCreateTexture(128, 128, 1, D3DUSAGE_RENDERTARGET, display format, D3DPOOL_DEFAULT)
  const ct = d.createTexture(128, 128, 1, Usage.RENDERTARGET, Fmt.X8R8G8B8, Pool.DEFAULT);
  let h = c.handle(ct);
  c.m.I[0x2dee4 >> 2] = h;
  h = c.handle(ct.getSurfaceLevel(0));
  c.m.I[0x2dee8 >> 2] = h;
  h = c.handle({});                           // D3DXCreateRenderToSurface(128, 128, format, no depth)
  c.m.I[0x2debc >> 2] = h;
  f1003bc30(c);
  const s = st(c);
  s.tFLR = c.m.I[0x2dee0 >> 2];               // SetTexture("tFLR"), SetTexture("tCAU")
  s.tCAU = c.m.I[0x2dee4 >> 2];
  if (vt(c, 0x180, 0, 0) < 0) return -1;
  return f100062d0(c);
}

// ------------------------------------------------------------------------------------------------ the effect
// DATATABLE_sha ("Water effect"), technique T0, pass P0: what it sets, in the order D3DX records it
const P0_RS: [number, number][] = [[Rs.LIGHTING, 1], [Rs.SPECULARENABLE, 1]];
const P0_TSS0: [number, number][] = [[24, 2], [1, 2], [2, 2], [3, 1], [4, 10], [5, 2], [6, 0], [17, 2], [16, 2], [18, 1]];
const P0_TSS1: [number, number][] = [[24, 2], [1, 7], [2, 2], [3, 1], [4, 3], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1]];
const P0_TSS2: [number, number][] = [[1, 1], [4, 1]];
/** 0x1003bc30 D3DXCreateEffectFromResource(DATATABLE_sha): no device call but capability queries */
export function f1003bc30(c: Core): number {
  const h = c.handle({});
  c.m.I[0x2deb4 >> 2] = h;
  return 0;
}
/** ID3DXEffect::SetTechnique(T0): the pass recorded into the saved-state block (with its parameters), captured,
 *  then into the pass block */
function effTechnique(c: Core, t: number): void {
  if (t !== 0) unported(0x10001848);         // T1 / T2: only T0 validates on the devices the port has
  const d = c.d, s = st(c);
  d.beginStateBlock();
  d.setVertexShader(0x152);
  for (const [k, v] of P0_RS) d.setRenderState(k, v);
  d.setTexture(0, tex(c, s.tFLR)); d.setTransform(Ts.TEXTURE0, IDENT);
  for (const [k, v] of P0_TSS0) d.setTextureStageState(0, k, v);
  d.setTexture(1, tex(c, s.tCAU)); d.setTransform(Ts.TEXTURE0 + 1, IDENT);
  for (const [k, v] of P0_TSS1) d.setTextureStageState(1, k, v);
  for (const [k, v] of P0_TSS2) d.setTextureStageState(2, k, v);
  s.effSaved = d.endStateBlock();
  d.captureStateBlock(s.effSaved);
  d.beginStateBlock();
  d.setVertexShader(0x152);
  for (const [k, v] of P0_RS) d.setRenderState(k, v);
  for (const [k, v] of P0_TSS0) d.setTextureStageState(0, k, v);
  for (const [k, v] of P0_TSS1) d.setTextureStageState(1, k, v);
  for (const [k, v] of P0_TSS2) d.setTextureStageState(2, k, v);
  s.effPass = d.endStateBlock();
}
/** ID3DXEffect::Begin: the saved block captured, the vertex shader and textures read back */
function effBegin(c: Core): number {
  effSave(c);
  c.d.captureStateBlock(st(c).effSaved);
  return 1;
}
function effSave(c: Core): void { const s = st(c); s.saved = [s.vs, s.tex0, s.tex1]; }
/** ID3DXEffect::Pass(0) */
function effPass(c: Core): void {
  const s = st(c), d = c.d;
  setVS(c, 0x152);
  d.applyStateBlock(s.effPass);
  setTex(c, 0, tex(c, s.tFLR)); d.setTransform(Ts.TEXTURE0, IDENT);
  setTex(c, 1, tex(c, s.tCAU)); d.setTransform(Ts.TEXTURE0 + 1, IDENT);
}
/** ID3DXEffect::End */
function effEnd(c: Core): void {
  const s = st(c);
  setVS(c, s.saved[0]);
  setTex(c, 0, s.saved[1]);
  setTex(c, 1, s.saved[2]);
  c.d.applyStateBlock(s.effSaved);
}

/** vt+0x180 0x100017f0 (step, keep): the effect's technique, stepping by `step` through the three to the first
 *  that validates (the last one is taken as is) */
function selectTechnique(c: Core, step: number, keep: number): number {
  const I = c.m.I, n = 3;
  let t = (I[0x2deb8 >> 2] + step) | 0;
  if (t < 0) t = n - 1;
  if ((t >>> 0) >= n) t = 0;
  if (step !== 0 && t === I[0x2deb8 >> 2]) { effTechnique(c, I[0x2deb8 >> 2]); return 0x80004005 | 0; }
  for (;;) {
    effTechnique(c, t);
    if (keep !== 0 || t === n - 1) break;
    // ponytail: with the caustics off (0x2def0 = 0) the DLL first skips techniques that use tCAU; never off here
    if (c.m.I[0x2def0 >> 2] === 0) unported(0x10001862);
    // ValidateDevice between Pass(0) and End: T0 validates on the reference device
    effSave(c);
    effPass(c);
    effEnd(c);
    break;
  }
  c.m.I[0x2deb8 >> 2] = t;
  return 0;
}

// ------------------------------------------------------------------------------------------------ ID3DXRenderToSurface
function rtsBegin(c: Core, surf: Surface): void {
  const d = c.d, s = st(c);
  const vp = new ArrayBuffer(24), vv = new DataView(vp);
  vv.setUint32(8, 128, true); vv.setUint32(12, 128, true); vv.setFloat32(16, 0, true); vv.setFloat32(20, 1, true);
  if (!s.rtsBlock) { d.beginStateBlock(); d.setViewport(vp); s.rtsBlock = d.endStateBlock(); }
  d.captureStateBlock(s.rtsBlock);
  s.rtsOld = d.getRenderTarget(); s.rtsOldDs = d.getDepthStencilSurface();
  d.setRenderTarget(surf, null);
  d.setViewport(vp);
  d.beginScene();
}
function rtsEnd(c: Core): void {
  const d = c.d, s = st(c);
  d.endScene();
  d.setRenderTarget(s.rtsOld, s.rtsOldDs);
  d.applyStateBlock(s.rtsBlock);
}

// ------------------------------------------------------------------------------------------------ the floor texture
/** vt+0x140 0x10003530: sprite 4 (the photo) centred in a power-of-two square TGA (DATATABLE_tga's header) over
 *  the background colour, an optional drop shadow, through D3DXCreateTextureFromFileInMemoryEx (A8R8G8B8, full
 *  chain, box mips) as the effect's tFLR */
function floorTexture(c: Core): number {
  let I = c.m.I;
  I[0x311c4 >> 2] = 0; I[0x311c8 >> 2] = 0;
  const sw = I[0x11a4 >> 2], sh = I[0x11a8 >> 2];
  if (I[0x37ac >> 2] === 0 || sw === 0 || sh === 0 || I[0x37b0 >> 2] === 0) return 0;
  I[0x311c4 >> 2] = sw; I[0x311c8 >> 2] = sh;
  I[0x314d8 >> 2] = sw > sh ? sw : sh;
  I[0x39a8 >> 2] = 0x100; I[0x39ac >> 2] = 0;
  if (I[0x314d8 >> 2] > 0x100) {
    do I[0x39a8 >> 2] <<= 1; while (I[0x39a8 >> 2] < I[0x314d8 >> 2]);
  }
  I[0x39ac >> 2] = I[0x39a8 >> 2];
  if (I[0x39a8 >> 2] > I[0x39b0 >> 2]) return 0;
  c.objs[I[0x2dee0 >> 2]] = null;             // Release the old one (the handle's slot is never reused)
  I[0x2dee0 >> 2] = 0;
  const res = tgaRes(c);
  let B = c.m.B;
  B[res + 0xc] = I[0x39a8 >> 2] & 0xff; B[res + 0xd] = (I[0x39a8 >> 2] >> 8) & 0xff;
  B[res + 0xe] = I[0x39ac >> 2] & 0xff; B[res + 0xf] = (I[0x39ac >> 2] >> 8) & 0xff;
  const tw = I[0x39a8 >> 2], th = I[0x39ac >> 2], n = Math.imul(tw, th);
  const buf = c.m.malloc(n * 4 + 0x2c);
  I = c.m.I; B = c.m.B;
  B.copyWithin(buf, res, res + 0x2c);         // the 11 dwords of the resource's head
  I[0x30e70 >> 2] = res + 0x2c; I[0x30e38 >> 2] = buf + 0x2c; I[0x3103c >> 2] = 0xb;
  const pix = buf + 0x12, end = pix + n * 4;
  I[0x30e3c >> 2] = pix; I[0x30e40 >> 2] = end;
  const bg = I[0x2034 >> 2];
  for (let k = 0; k < n; k++) wr(c, pix + k * 4, bg);
  I[0x3103c >> 2] = n > 0 ? n : 0; I[0x30e38 >> 2] = pix + (n > 0 ? n : 0) * 4;
  const m = I[0x3166c >> 2];
  if (((m === 3 || m === 0) && I[0x12c0 >> 2] !== -1 || I[0x26dc >> 2] !== 0) && I[0x25e4 >> 2] === 1) {
    // the drop shadow: alpha 0x50 over the photo's rectangle moved 5 right and 5 up
    I[0x26dc >> 2] = 0;
    const dx = tw - sw;
    let ox = ((dx / 2) | 0) + 5, oy = (((th - sh) / 2) | 0) - 5;
    I[0x31504 >> 2] = ox; I[0x31508 >> 2] = oy;
    if (ox + sw > tw) { ox = dx; I[0x31504 >> 2] = ox; }
    if (oy < 0) { oy = 0; I[0x31508 >> 2] = 0; }
    const p0 = pix + (Math.imul(tw, oy) + ox) * 4;
    I[0x315f4 >> 2] = 0x50000000; I[0x3105c >> 2] = 0; I[0x30e38 >> 2] = p0;
    out: for (let y = 0; y < I[0x311c8 >> 2]; y = ++I[0x3105c >> 2]) {
      I[0x3103c >> 2] = 0;
      let p = p0 + Math.imul(y + 1, tw) * 4;
      I[0x30e38 >> 2] = p;
      if (I[0x311c4 >> 2] > 0) {
        for (;;) {
          wr(c, p, rd(c, p) | I[0x315f4 >> 2]);
          p += 4; I[0x30e38 >> 2] = p;
          if ((p >>> 0) >= (I[0x30e40 >> 2] >>> 0)) break out;
          if (++I[0x3103c >> 2] >= I[0x311c4 >> 2]) break;
        }
      }
    }
  }
  if (I[0x25ac >> 2] === 4) {
    // the photo, opaque, one row down from centre
    const ox = (tw - sw) / 2 | 0, oy = (th - sh) / 2 | 0;
    I[0x3105c >> 2] = 0; I[0x31508 >> 2] = oy; I[0x31504 >> 2] = ox;
    const p0 = I[0x30e3c >> 2] + (Math.imul(oy, tw) + ox) * 4;
    I[0x30e38 >> 2] = p0; I[0x30e3c >> 2] = p0;
    let src = I[0x1144 >> 2];
    I[0x30e70 >> 2] = src;
    for (let y = 0; y < I[0x311c8 >> 2]; y = ++I[0x3105c >> 2]) {
      I[0x3103c >> 2] = 0;
      let p = p0 + Math.imul(y + 1, tw) * 4;
      I[0x30e38 >> 2] = p;
      for (let x = 0; x < I[0x311c4 >> 2]; x = ++I[0x3103c >> 2]) {
        wr(c, p, rd(c, src) | 0xff000000);
        src += 4; p += 4;
        I[0x30e70 >> 2] = src; I[0x30e38 >> 2] = p;
      }
    }
  }
  // D3DXCreateTextureFromFileInMemoryEx(default size, full chain, A8R8G8B8, managed): the TGA is bottom-up
  const top = new Uint8Array(n * 4);
  B = c.m.B;
  for (let y = 0; y < th; y++) top.set(B.subarray(pix + (th - 1 - y) * tw * 4, pix + (th - y) * tw * 4), y * tw * 4);
  const t = textureFromPixels(c.d, top, tw, th, Fmt.A8R8G8B8);
  const h = c.handle(t);
  c.m.release(buf);
  c.m.I[0x2dee0 >> 2] = h;
  if (c.m.I[0x2deb4 >> 2]) st(c).tFLR = h;   // the effect's SetTexture("tFLR")
  return 0;
}
/** dword loads/stores at any address (the TGA's pixels start at +0x12) */
function rd(c: Core, a: number): number { return c.m.ld(a); }
function wr(c: Core, a: number, v: number): void {
  const B = c.m.B;
  B[a] = v & 0xff; B[a + 1] = (v >>> 8) & 0xff; B[a + 2] = (v >>> 16) & 0xff; B[a + 3] = v >>> 24;
}

// ------------------------------------------------------------------------------------------------ the frame
/** vt+0x164 0x100011b0: TestCooperativeLevel: 1 when the device can render (the port's device is never lost) */
function canRender(c: Core): number {
  const I = c.m.I;
  return I[0x37ac >> 2] === 0 || I[0x37b0 >> 2] === 0 ? 0 : 1;
}

/** vt+0x168 0x100048c0 Render3DEnvironment: the clocks, the matrices, the caustics, the water over the 2D layer,
 *  the particles, the stats text, Present */
function render3D(c: Core): number {
  if (vt(c, 0x164) === 0) return 0;
  const app = fr(f10002f10(c, 5));
  const el = f10002f10(c, 6);
  if (el === 0) return 0;
  const F = c.m.F;
  F[0x38d4 >> 2] = el;
  F[0x38d0 >> 2] = app;
  const d = c.d;
  d.setTextureStageState(0, Tss.COLOROP, 1); d.setTextureStageState(0, Tss.ALPHAOP, 1);
  d.setTextureStageState(1, Tss.COLOROP, 1); d.setTextureStageState(1, Tss.ALPHAOP, 1);
  d.setRenderState(Rs.SHADEMODE, 2);
  vt(c, 0x16c);
  d.setTransform(Ts.VIEW, mat(c, 0x2df44));
  if (vt(c, 0x170) < 0) return -1;
  d.setTransform(Ts.VIEW, mat(c, 0x2df04));
  if (vt(c, 0x148) < 0) return -1;
  vt(c, 0x174);
  vt(c, 0x178);
  if (c.m.I[0x317b4 >> 2] === 0) unported(0x10004a06);
  d.present();
  return 0;
}

/** 0x10004f50: identity */
export function f10004f50(m: Float32Array): void { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; }

/** vt+0x16c 0x10004a20: the matrices: 0x2df04 camera (rotation 0x1edc * translation 0x1ed0), 0x2df44 identity,
 *  0x2df84 water parent, 0x2dfc4 caustics world, 0x2e004 water world, 0x2e044 particles world */
function matrices(c: Core): number {
  const F = c.m.F;
  for (const o of [0x2df04, 0x2df44, 0x2df84, 0x2dfc4, 0x2e004, 0x2e044]) f10004f50(mat(c, o));
  F[0x1f08 >> 2] = -54; F[0x1f10 >> 2] = 1.600000023841858;
  const tr = (m: number, v: number): void => translation(mat(c, m), F[v >> 2], F[(v + 4) >> 2], F[(v + 8) >> 2]);
  tr(0x2df04, 0x1ed0); tr(0x2df84, 0x1ee8); tr(0x2dfc4, 0x1f00); tr(0x2e004, 0x1f18); tr(0x2e044, 0x1f30);
  const q = new Float32Array(4), M = new Float32Array(16);
  const rot = (v: number, m: number): void => {
    quatYawPitchRoll(q, F[v >> 2], F[(v + 4) >> 2], F[(v + 8) >> 2]);
    matRotQuat(M, q);
    matMul(mat(c, m), M, mat(c, m));
  };
  rot(0x1edc, 0x2df04); rot(0x1ef4, 0x2df84); rot(0x1f0c, 0x2dfc4);
  rot(0x1f24, 0x2e004);                      // (the DLL first sets the rotation to identity: rewritten whole)
  rot(0x1f3c, 0x2e044);
  matMul(mat(c, 0x2e004), mat(c, 0x2e004), mat(c, 0x2df84));
  matMul(mat(c, 0x2e044), mat(c, 0x2e044), mat(c, 0x2df84));
  return 0;
}

/** D3DXMatrixPerspectiveFovRH(pi/3, aspect, 0.1, 2000) into the object at `o`; aspect 0/0 is the x87's
 *  indefinite (0xffc00000), which propagates into _11 as such */
function projection(c: Core, o: number, aspect: number): void {
  perspectiveFovRH(mat(c, o), 1.0471975803375244, aspect, 0.10000000149011612, 2000);
  if (aspect !== aspect) c.m.U[o >> 2] = 0xffc00000;
}

/** vt+0x170 0x10004f90: CWater::Update (with the caustics when the effect uses tCAU), the water clock, the
 *  caustics drawn into the 128 x 128 target through ID3DXRenderToSurface */
function caustics(c: Core): number {
  let I = c.m.I;
  if (!(I[0x2deec >> 2] === 1 && I[0x2def0 >> 2] === 1)) return 0;
  const on = I[0x2def0 >> 2] !== 0;          // ID3DXEffect::IsParameterUsed("tCAU"): T0 uses it
  f10007480(c, 0, 0, 0, 0, 1, 0, on ? 1 : 0);
  const F = c.m.F;
  F[0x38d0 >> 2] = F[0x2defc >> 2] + F[0x38d0 >> 2];
  if (!on) return 0;
  const d = c.d;
  rtsBegin(c, c.obj<Surface>(0x2dee8));
  I = c.m.I;
  projection(c, 0x2e0c4, fr(I[0x39a8 >> 2] / I[0x39ac >> 2]));
  d.setTransform(Ts.PROJECTION, mat(c, 0x2e0c4));
  d.setTransform(Ts.WORLD, mat(c, 0x2dfc4));
  d.setTransform(Ts.PROJECTION, mat(c, 0x2e0c4));
  d.setTransform(Ts.WORLD, mat(c, 0x2dfc4));
  d.clear(null, ClearFlag.TARGET, 0xff000000, 0, 0);
  d.setRenderState(Rs.ZENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1);
  d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 1);
  f10007a80(c);
  d.setRenderState(Rs.CULLMODE, 2); d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.ZENABLE, 1);
  rtsEnd(c);
  return 0;
}

/** vt+0x148 0x100051e0: the scene into the back buffer: projection, the 2D layer (sprite 6) copied in by the CPU
 *  (or a clear to the background colour), Z cleared, the water through the effect */
function renderWater(c: Core): number {
  const d = c.d;
  d.beginScene();
  let I = c.m.I;
  const aspect = fr((I[0x38a0 >> 2] >>> 0) / I[0x38a4 >> 2]);
  c.m.F[0x2df00 >> 2] = aspect;
  projection(c, 0x2e084, aspect);
  d.setTransform(Ts.PROJECTION, mat(c, 0x2e084));
  d.setTransform(Ts.WORLD, mat(c, 0x2e004));
  I[0x1ca4 >> 2] = 6;
  if (vt(c, 0x128) === 0) d.clear(null, ClearFlag.TARGET, c.m.I[0x30ee4 >> 2] >>> 0, 1, 0);
  d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
  I = c.m.I;
  if (I[0x2deec >> 2] === 1) {
    d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
    const passes = effBegin(c);
    for (let k = 0; k < passes; k++) { effPass(c); f10007b10(c); }
    effEnd(c);
    vt(c, 0x130);
  }
  d.endScene();
  d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  return 0;
}

/** vt+0x128 0x100053b0: the current sprite (6: the 2D layer) copied row by row into the locked back buffer when
 *  it is window-sized; 1 if copied */
function copyLayer(c: Core): number {
  let I = c.m.I;
  const r = lb(c);
  const w = I[(0x9f4 + r) >> 2], h = I[(0x9f8 + r) >> 2];
  I[0x313e4 >> 2] = w; I[0x313d4 >> 2] = h;
  I[0x3165c >> 2] = Math.imul(w, h);
  if (I[(0x970 + r) >> 2] !== -1 || Math.imul(w, h) === 0) return 0;
  const bb = c.d.getBackBuffer();
  backBufferDesc(c);
  const L = bb.lockRect(null, Lock.NOSYSLOCK);
  I = c.m.I;
  const pitch = L.pitch >>> 2;
  I[0x2dea0 >> 2] = pitch;
  if (h !== I[0x38a4 >> 2] || w !== I[0x38a0 >> 2]) { bb.unlockRect(); return 0; }
  let src = I[(0x994 + r) >> 2];
  I[0x30e70 >> 2] = src;
  I[0x30e3c >> 2] = 0;                        // the locked bits (D3D memory: no address in the port's heap)
  if (I[0x30ee0 >> 2] !== 32) { vt(c, 0x138); bb.unlockRect(); return 1; }
  const u = new Uint32Array(L.data.buffer, L.data.byteOffset, L.data.byteLength >> 2);
  const U = c.m.U;
  I[0x3105c >> 2] = 0;
  for (let y = 0; y < h; y = ++I[0x3105c >> 2]) {
    I[0x3103c >> 2] = 0;
    if (w > 0) {
      u.set(U.subarray(src >> 2, (src >> 2) + w), y * pitch);
      src += w * 4;
      I[0x3103c >> 2] = w;
    }
  }
  I[0x30e70 >> 2] = src;
  I[0x30e38 >> 2] = 0;
  bb.unlockRect();
  return 1;
}

/** vt+0x130 0x10005c70 */
function after(): number { return 1; }

/** vt+0x174 0x10003ad0: the particles: the sprite texture (DATATABLE_Particle_1) the first time, the system's
 *  update (with the reference device's fixed 0.05 s step) and its point sprites */
function particles(c: Core): number {
  const d = c.d;
  if (c.m.I[0x2e140 >> 2] === 0) {
    const t = textureFromPixels(d, c.env.particle(), 128, 128, Fmt.X8R8G8B8);
    const h = c.handle(t);
    c.m.I[0x2e140 >> 2] = h;
  }
  if (c.m.I[0x37b4 >> 2] === 2) c.m.I[0x38d4 >> 2] = 0x3d4ccccd;
  if (f10003c90(c) < 0) unported(0x10003b31);
  d.setTransform(Ts.WORLD, mat(c, 0x2e044));
  d.beginScene();
  d.setRenderState(Rs.ZWRITEENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1);
  setTex(c, 0, c.obj<Texture>(0x2e140));
  d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.ALPHAOP, 4);
  d.setTextureStageState(1, Tss.COLOROP, 1); d.setTextureStageState(1, Tss.ALPHAOP, 1);
  d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 2); d.setRenderState(Rs.SHADEMODE, 1);
  f10004280(c);
  d.setRenderState(Rs.ZWRITEENABLE, 1); d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  d.endScene();
  d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  return 0;
}

const DEPTH_NAME: Record<number, string> = { 0x47: ' (D32)', 0x49: ' (D15S1)', 0x4b: ' (D24S8)', 0x4d: ' (D24X8)',
  0x4f: ' (D24X4S4)', 0x50: ' (D16)' };
/** vt+0x178 0x10001240: the frame-stats text at 0x3936: "<fps> fps (WxHxBPP)", the depth format, the
 *  multisampling (the adapter's display mode is X8R8G8B8) */
function frameStats(c: Core): number {
  const I = c.m.I, F = c.m.F;
  let s = F[0x38d8 >> 2].toFixed(2) + ' fps (' + I[0x38a0 >> 2] + 'x' + I[0x38a4 >> 2] + 'x32)';
  const base = ADP + I[0x2de8c >> 2] * 0x43a0;
  const dev = base + 0x440 + I[(base + 0x439c) >> 2] * 0xcac;
  if (I[0x3990 >> 2]) s += DEPTH_NAME[I[(dev + 0xf4 + I[(dev + 0xc9c) >> 2] * 0x14) >> 2]] || '';
  const ms = I[0x2de90 >> 2] ? I[(dev + 0xca4) >> 2] : I[(dev + 0xca8) >> 2];
  if (ms >= 2 && ms <= 16) s += ' (' + ms + 'x Multisample)';
  putStr(c, 0x3936, s);
  return 0;
}

/** vt+0x190 0x10004870: every live particle back to the free list, none allowed */
function clearParticles(c: Core): number {
  const I = c.m.I;
  for (let p = I[0x2e134 >> 2]; p !== 0; p = I[0x2e134 >> 2]) {
    I[0x2e134 >> 2] = I[(p + 0x5c) >> 2];
    I[(p + 0x5c) >> 2] = I[0x2e138 >> 2];
    I[0x2e138 >> 2] = p;
  }
  I[0x2e130 >> 2] = 0;
  I[0x1f48 >> 2] = 0;
  return 0;
}

/** vt+0x108 0x100014f0: the camera and object vectors (0x1ed0..0x1f44) reset: all 0 but the water parent's
 *  pitch 1.6 and the particles' pitch 0.2; then the camera distance */
function resetCamera(c: Core): number {
  const I = c.m.I, F = c.m.F;
  for (let o = 0x1ed0; o < 0x1f48; o += 4) I[o >> 2] = 0;
  F[0x1ef8 >> 2] = 1.600000023841858; F[0x1f34 >> 2] = 0.20000000298023224;
  return vt(c, 0x10c);
}

/** vt+0x10c 0x10001710: the camera's z (0x1ed8) from the window height and the floor texture's size, scaled by
 *  (1 - 0x39b4) */
function cameraZ(c: Core): number {
  const I = c.m.I, F = c.m.F;
  const v = (0x11c - I[0x310e0 >> 2] | 0) * -0.10700000077486038;   // -0.107
  const t = I[0x39ac >> 2];
  if (t === 0x100) F[0x1ed8 >> 2] = (v + 30.65999984741211) * -2;
  if (t === 0x200) F[0x1ed8 >> 2] = -(v + 30.65999984741211);
  if (t === 0x400) F[0x1ed8 >> 2] = -(v * 0.5 + 15.475000381469727);
  if (t === 0x800) F[0x1ed8 >> 2] = -(v * 0.25 + 7.737500190734863);
  if (t > 0x800) F[0x1ed8 >> 2] = -(v * 0.125 + 3.8687500953674316);
  const k = F[0x39b4 >> 2];
  if (k !== 0) F[0x1ed8 >> 2] = F[0x1ed8 >> 2] - (1 - k) * F[0x1ed8 >> 2];
  return 0;
}

/** vt+0x24 0x10021300: the debug window's text, only with its window (0x1cbc) and a pending update (0x1e2c) */
function debugOverlay(c: Core): number {
  const I = c.m.I;
  if (I[0x1cbc >> 2] !== 0 && I[0x1e2c >> 2] !== 0) unported(0x1002132c);
  return 0;
}

// ------------------------------------------------------------------------------------------------ CWater
// the refraction table (DLL static 0x10098f10: 256 copies of entry 0, then the 256 entries; the object keeps
// 0x10099b10, the first entry, at 0x3740): [r0, rn] per entry
const REFRACT = new Float32Array(512 * 2);
/** 0x10006160 CWater::Initialize(size, depth): sizes, the refraction table (water's index 1.333), the grid */
export function f10006160(c: Core, size: number, depth: number): number {
  let I = c.m.I;
  const F = c.m.F;
  F[0x3718 >> 2] = size; F[0x371c >> 2] = depth;
  I[0x3738 >> 2] = 0x1000; I[0x3734 >> 2] = 0x2000;
  F[0x3720 >> 2] = 1 / size;
  if (I[0x3740 >> 2] === 0) {
    I[0x3740 >> 2] = 0x10099b10;
    const k = 0.7501875758171082;
    for (let i = 0; i < 256; i++) {
      const t = i / 256;
      const s = Math.sqrt((1 + t) * (1 - t));         // FSIN(acos t)
      const sf = fr(s), s2 = s * k, s2f = fr(s2);
      const cc = Math.sqrt(1 - s2 * s2);               // FCOS(asin s2)
      REFRACT[(256 + i) * 2] = (sf / s2f) * cc - t;
      REFRACT[(256 + i) * 2 + 1] = -(s2f / sf);
      REFRACT[i * 2] = REFRACT[512]; REFRACT[i * 2 + 1] = REFRACT[513];
    }
  }
  if (I[0x373c >> 2] === 0) {
    const p = c.m.malloc(0x8000);
    I = c.m.I;
    I[0x373c >> 2] = p;
  }
  return 0;
}

/** 0x100073f0 CWater: clear the height/velocity grid (0x373c, 0x2000 dwords) */
export function f100073f0(c: Core): number {
  const p = c.m.I[0x373c >> 2];
  if (p) c.m.I.fill(0, p >> 2, (p >> 2) + 0x2000);
  return 0;
}

/** 0x100062d0 CWater::RestoreDeviceObjects: the spiral strip's index buffer, the vertex buffer (pos, normal,
 *  diffuse, uv) and the caustics vertex buffer (pos, diffuse) */
export function f100062d0(c: Core): number {
  const d = c.d;
  let I = c.m.I;
  if (I[0x3748 >> 2] === 0) {
    const n = I[0x3734 >> 2];
    const ib = d.createIndexBuffer(n * 2, 0, Fmt.INDEX16, Pool.DEFAULT);
    const L = ib.lock(0, n * 2, 0), idx = new Uint16Array(L.buffer, L.byteOffset, n);
    let o = 0, x = 0, y = 0;
    for (let m = 0x40; m !== 0; m -= 2) {
      for (let k = 0; k < m; k++) { idx[o++] = x + y * 64; idx[o++] = x + (y + 1) * 64; x++; }
      x--; y++;
      for (let k = 1; k < m; k++) { const v = y * 64 + x; idx[o++] = v; idx[o++] = v - 1; y++; }
      y--; x--;
      for (let k = 1; k < m; k++) { idx[o++] = x + y * 64; idx[o++] = x + (y + 0x3ff) * 64; x--; }
      x++; y--;
      for (let k = 2; k < m; k++) { const v = y * 64 + x; idx[o++] = v; idx[o++] = v + 1; y--; }
      y++; x++;
    }
    I = c.m.I;
    for (let k = 0; k < I[0x3734 >> 2]; k++) if (idx[k] >= (I[0x3738 >> 2] >>> 0)) idx[k] = 0;
    ib.unlock();
    const h = c.handle(ib);
    c.m.I[0x3748 >> 2] = h;
  }
  if (c.m.I[0x374c >> 2] === 0) {
    const h = c.handle(d.createVertexBuffer(c.m.I[0x3738 >> 2] * 0x24, Usage.DYNAMIC, 0x152, Pool.DEFAULT));
    c.m.I[0x374c >> 2] = h;
  }
  if (c.m.I[0x3750 >> 2] === 0) {
    const h = c.handle(d.createVertexBuffer(c.m.I[0x3738 >> 2] << 4, Usage.DYNAMIC | Usage.WRITEONLY, 0x42, Pool.DEFAULT));
    c.m.I[0x3750 >> 2] = h;
  }
  return 0;
}

/** 0x10007480 CWater::Update(eye position, light direction, caustics): the velocities (the framework's damping,
 *  the stiffness 0x2020), the heights less their average, the vertices (normals through D3DXVec3Normalize, the
 *  refracted floor coordinates), and the caustics' vertices shaded by their triangles' areas */
export function f10007480(c: Core, ex: number, ey: number, ez: number, lx: number, ly: number, lz: number, caust: number): number {
  const I = c.m.I, F = c.m.F;
  const S = I[0x373c >> 2] >> 2, k = F[0x2020 >> 2];
  const h = (i: number): number => F[S + i * 2];
  F[0x3724 >> 2] = 0;
  let cell = S;
  for (let yN = 0xfc0, y = 0, yP = 0x40; ;) {
    for (let xN = 0x3f, x = 0, xP = 1; ;) {
      const sA = ((h(x + yP) + h(y + xP)) + h(y + xN)) + h(x + yN);
      const sB = ((h(xP + yP) + h(xN + yP)) + h(xP + yN)) + h(xN + yN);
      const want = sA * 0.1666666716337204 + sB * 0.0833333358168602;
      F[0x31120 >> 2] = 20;
      if (F[cell + 1] > 20 || F[cell + 1] < -20) F[cell + 1] = F[cell + 1] * 0.8999999761581421;
      if (F[cell + 1] > F[0x31120 >> 2] || -F[0x31120 >> 2] > F[cell + 1]) F[cell + 1] = F[cell + 1] * 0.8999999761581421;
      const nv = (want - F[cell]) * k + F[cell + 1];
      F[cell + 1] = nv;
      F[0x3724 >> 2] = (nv + F[cell]) + F[0x3724 >> 2];
      cell += 2;
      xN = x; x = xP; xP = (xP + 1) & 0x3f;
      if (x === 0) break;
    }
    yN = y; y = yP; yP = (yP + 0x40) & 0xfc0;
    if (y === 0) break;
  }
  F[0x3724 >> 2] = F[0x3724 >> 2] / (I[0x3738 >> 2] >>> 0);
  const avg = F[0x3724 >> 2];
  const vb = c.obj<Buffer>(0x374c);
  const V = vb.lock(0, I[0x3738 >> 2] * 0x24, 0);
  const vf = new Float32Array(V.buffer, V.byteOffset, V.byteLength >> 2), vu = new Uint32Array(vf.buffer, vf.byteOffset, vf.length);
  const size = F[0x3718 >> 2], inc = fr(size * 0.01587301678955555), dep = F[0x3728 >> 2], scale = F[0x3720 >> 2];
  let fZ = fr(size * -0.5);
  const N = new Float32Array(3), E = new Float32Array(3);
  let o = 0;
  cell = S;
  for (let yN = 0xfc0, y = 0, yP = 0x40; ;) {
    let fX = fr(size * -0.5);
    for (let xN = 0x3f, x = 0, xP = 1; ;) {
      const hp = fr((F[cell + 1] + F[cell]) - avg);
      F[cell] = hp;
      const d1 = fr(h(xN + yN) - h(xP + yP));
      const e = fr((h(x + yN) - h(x + yP)) + d1);
      const d3 = h(xP + yN) - h(xN + yP);
      const nx1 = fr(d1 - d3), nz = fr(e + d3);
      const nx = fr((h(xN + y) - h(xP + y)) + nx1);
      vec3Normalize(N, 0, nx, 1, nz);
      vec3Normalize(E, 0, ex, ey, ez);
      const ri = (256 - ftol(((E[1] * N[1] + E[2] * N[2]) + E[0] * N[0]) * -255)) * 2;
      const r0 = REFRACT[ri], rn = REFRACT[ri + 1];
      vf[o] = fX; vf[o + 1] = hp; vf[o + 2] = fZ;
      vf[o + 3] = N[0]; vf[o + 4] = N[1]; vf[o + 5] = N[2];
      vu[o + 6] = ftol(F[0x4e4 >> 2]) << 24;
      const t6c = fr(fr(r0 * N[0]) + E[0]);
      const rz = (r0 * N[2] + E[2]) * rn;
      const t78 = fr(t6c * rn);
      vf[o + 7] = ((t78 * dep + fX) * scale) + 0.5;
      vf[o + 8] = ((rz * dep + fZ) * scale) + 0.5;
      fX = fr(fX + inc);
      o += 9; cell += 2;
      xN = x; x = xP; xP = (xP + 1) & 0x3f;
      if (x === 0) break;
    }
    fZ = fr(fZ + inc);
    yN = y; y = yP; yP = (yP + 0x40) & 0xfc0;
    if (y === 0) break;
  }
  if (caust) {
    const cb = c.obj<Buffer>(0x3750);
    const C = cb.lock(0, I[0x3738 >> 2] << 4, 0);
    const cf = new Float32Array(C.buffer, C.byteOffset, C.byteLength >> 2), cu = new Uint32Array(cf.buffer, cf.byteOffset, cf.length);
    const shade = st(c).shade;
    for (let e = 1; e <= 8; e++) shade[e - 1] = Math.imul(((I[0x1ecc >> 2] >>> 0) / e) >>> 0, 0x10101) >>> 0;
    let vo = 0, co = 0;
    for (let y = 0; y < 0x40; y++) {
      for (let x = 0; x < 0x40; x++) {
        const ri = (256 - ftol(vf[vo + 4] * -255)) * 2;
        const r0 = REFRACT[ri], rn = REFRACT[ri + 1];
        const a = fr(fr(r0 * vf[vo + 3]) + lx);
        const rz = (r0 * vf[vo + 5] + lz) * rn;
        const cc = fr(a * rn);
        cu[co + 1] = 0;
        cf[co] = cc * dep + vf[vo];
        cf[co + 2] = rz * dep + vf[vo + 2];
        if (x !== 0 && y !== 0) {
          let area = (cf[co - 0xfe] - cf[co + 2]) * (cf[co - 0x104] - cf[co]) - (cf[co - 0x102] - cf[co + 2]) * (cf[co - 0x100] - cf[co]);
          if (area < 0) area = -area;
          const kk = ftol(area * area * 4);
          cu[co + 3] = (kk >>> 0) < 8 ? shade[kk] : 0;
        }
        co += 4; vo += 9;
      }
      cu[co - 0x100 + 3] = cu[co - 1];
    }
    for (let e = 0; e < 0x40; e++) cu[e * 4 + 3] = cu[0x3f00 + e * 4 + 3];
    cb.unlock();
  }
  vb.unlock();
  return 0;
}

/** 0x10007a80 CWater::DrawCaustics */
export function f10007a80(c: Core): number {
  const d = c.d, I = c.m.I;
  setVS(c, 0x42);
  d.setStreamSource(0, c.obj<Buffer>(0x3750), 0x10);
  d.setIndices(c.obj<Buffer>(0x3748), 0);
  d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, I[0x3738 >> 2], 0, I[0x3734 >> 2] - 2);
  return 0;
}
/** 0x10007b10 CWater::DrawSurface */
export function f10007b10(c: Core): number {
  const d = c.d, I = c.m.I;
  d.setStreamSource(0, c.obj<Buffer>(0x374c), 0x24);
  d.setIndices(c.obj<Buffer>(0x3748), 0);
  d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, I[0x3738 >> 2], 0, I[0x3734 >> 2] - 2);
  return 0;
}

// ------------------------------------------------------------------------------------------------ CParticleSystem
// a particle (0x60 bytes, operator new): +0 spark, +4 position, +0x10 velocity, +0x1c initial position,
// +0x28 initial velocity, +0x34 birth time, +0x38 colour, +0x48 fade colour, +0x58 fade, +0x5c next
const SC = new Float64Array(4);
const RAND = 3.0518509447574615e-05;     // 1/32767 as a float
/** a particle from the free list (0x2e138) or new */
function newParticle(c: Core): number {
  const f = c.m.I[0x2e138 >> 2];
  if (f) { c.m.I[0x2e138 >> 2] = c.m.I[(f + 0x5c) >> 2]; return f; }
  return c.m.malloc(0x60);
}
/** the launch direction: a = rand * 2pi (float), b = rand * pi/4; x = cos a * kx * sin b, z = sin a * kz * sin b,
 *  y = cos b (x87 FSIN/FCOS: 64-bit results) */
function launch(c: Core, p: number, kx: number, kz: number): void {
  const a = fr(A.rand() * RAND * 6.2831854820251465);
  const b = A.rand() * RAND * 0.7853981852531433;
  sincos87(b, SC); const sbh = SC[0], sbl = SC[1], cbh = SC[2], cbl = SC[3];
  const F = c.m.F;
  sincos87(a, SC);
  F[(p + 0x28) >> 2] = mulExt(mulExt(kx, SC[2], SC[3]), sbh, sbl);
  F[(p + 0x30) >> 2] = mulExt(mulExt(kz, SC[0], SC[1]), sbh, sbl);
  F[(p + 0x2c) >> 2] = fr64(cbh, cbl);
}
/** 0x10003c90 CParticleSystem::Update(elapsed 0x38d4): ballistic motion; particles below the floor (or faded
 *  sparks) die, a dying particle bursts into 0x1fc4 sparks; up to 0x1f70 new particles a frame while fewer than
 *  0x1f48 live */
export function f10003c90(c: Core): number {
  const s = st(c);
  let I = c.m.I, F = c.m.F;
  s.ptime = fr(s.ptime + F[0x38d4 >> 2]);
  let pp = 0x2e134;
  for (let p = I[pp >> 2]; p !== 0; p = I[pp >> 2]) {
    I = c.m.I; F = c.m.F;
    const spark = I[p >> 2];
    const t = s.ptime - F[(p + 0x34) >> 2];
    const g = spark ? F[0x2000 >> 2] : F[0x1f94 >> 2], fd = spark ? F[0x2004 >> 2] : F[0x1f98 >> 2];
    F[(p + 0x58) >> 2] = F[(p + 0x58) >> 2] - fd * F[0x38d4 >> 2];
    const vy = fr(t * F[(p + 0x2c) >> 2]), vz = fr(t * F[(p + 0x30) >> 2]);
    F[(p + 4) >> 2] = t * F[(p + 0x28) >> 2] + F[(p + 0x1c) >> 2];
    F[(p + 8) >> 2] = vy + F[(p + 0x20) >> 2];
    F[(p + 0xc) >> 2] = vz + F[(p + 0x24) >> 2];
    const y = fr(t * t * (g * 0.5) + F[(p + 8) >> 2]);
    F[(p + 8) >> 2] = y;
    F[(p + 0x14) >> 2] = g * t + F[(p + 0x2c) >> 2];
    if (F[(p + 0x58) >> 2] < 0) I[(p + 0x58) >> 2] = 0;
    if (!(y < F[0x2e120 >> 2]) && !(spark && !(F[(p + 0x58) >> 2] > 0))) { pp = p + 0x5c; continue; }
    if (!spark) {
      for (let k = 0; k < c.m.I[0x1fc4 >> 2]; k++) {
        const q = newParticle(c);
        I = c.m.I; F = c.m.F;
        I[(q + 0x5c) >> 2] = I[(p + 0x5c) >> 2];
        I[(p + 0x5c) >> 2] = q;
        I[q >> 2] = 1;
        I[(q + 0x1c) >> 2] = I[(p + 4) >> 2];
        I[(q + 0x20) >> 2] = I[(p + 8) >> 2];
        I[(q + 0x24) >> 2] = I[(p + 0xc) >> 2];
        I[(q + 0x20) >> 2] = I[0x2e120 >> 2];
        F[(q + 0x1c) >> 2] = F[0x1fd4 >> 2] + F[(q + 0x1c) >> 2];
        F[(q + 0x20) >> 2] = F[0x1fd8 >> 2] + F[(q + 0x20) >> 2];
        F[(q + 0x24) >> 2] = F[0x1fdc >> 2] + F[(q + 0x24) >> 2];
        launch(c, q, F[0x1fc8 >> 2], F[0x1fd0 >> 2]);
        F[(q + 0x2c) >> 2] = A.rand() * RAND * F[0x1fcc >> 2] * F[(q + 0x2c) >> 2];
        for (let j = 0; j < 3; j++) { I[((q + 4) >> 2) + j] = I[((q + 0x1c) >> 2) + j]; I[((q + 0x10) >> 2) + j] = I[((q + 0x28) >> 2) + j]; }
        for (let j = 0; j < 4; j++) { I[((q + 0x38) >> 2) + j] = I[(0x1fe0 >> 2) + j]; I[((q + 0x48) >> 2) + j] = I[(0x1ff0 >> 2) + j]; }
        I[(q + 0x58) >> 2] = I[0x2008 >> 2];
        F[(q + 0x34) >> 2] = s.ptime;
      }
    }
    I = c.m.I;
    I[pp >> 2] = I[(p + 0x5c) >> 2];
    I[(p + 0x5c) >> 2] = I[0x2e138 >> 2];
    I[0x2e138 >> 2] = p;
    if (I[p >> 2] === 0) I[0x2e130 >> 2]--;
  }
  I = c.m.I;
  I[0x3103c >> 2] = I[0x1f70 >> 2];
  if (I[0x3103c >> 2] > 0) {
    while ((c.m.I[0x2e130 >> 2] >>> 0) < (c.m.I[0x1f48 >> 2] >>> 0)) {
      const q = newParticle(c);
      I = c.m.I; F = c.m.F;
      I[(q + 0x5c) >> 2] = I[0x2e134 >> 2];
      I[0x2e134 >> 2] = q;
      I[0x2e130 >> 2]++;
      I[0x3103c >> 2]--;
      const a = fr(A.rand() * RAND * 6.2831854820251465);
      const r2 = A.rand();
      I[q >> 2] = 0;
      const b = r2 * RAND * 0.7853981852531433;
      sincos87(b, SC); const sbh = SC[0], sbl = SC[1], cbh = SC[2], cbl = SC[3];
      sincos87(a, SC);
      F[(q + 0x28) >> 2] = mulExt(mulExt(F[0x1f4c >> 2], SC[2], SC[3]), sbh, sbl);
      F[(q + 0x30) >> 2] = mulExt(mulExt(F[0x1f54 >> 2], SC[0], SC[1]), sbh, sbl);
      F[(q + 0x2c) >> 2] = fr64(cbh, cbl);
      F[(q + 0x2c) >> 2] = A.rand() * RAND * F[0x1f50 >> 2] * F[(q + 0x2c) >> 2];
      for (let j = 0; j < 3; j++) I[((q + 0x10) >> 2) + j] = I[((q + 0x28) >> 2) + j];
      F[(q + 0x1c) >> 2] = F[0x1f64 >> 2];
      F[(q + 0x20) >> 2] = F[0x2e120 >> 2] + F[0x1f68 >> 2];
      F[(q + 0x24) >> 2] = F[0x1f6c >> 2];
      for (let j = 0; j < 3; j++) {
        const kf = F[(0x1f58 >> 2) + j], o = ((q + 0x1c) >> 2) + j;
        if (A.rand() & 1) F[o] = (A.rand() & 0x3f) * kf + F[o];
        else F[o] = F[o] - (A.rand() & 0x3f) * kf;
      }
      for (let j = 0; j < 3; j++) I[((q + 4) >> 2) + j] = I[((q + 0x1c) >> 2) + j];
      for (let j = 0; j < 4; j++) { I[((q + 0x38) >> 2) + j] = I[(0x1f74 >> 2) + j]; I[((q + 0x48) >> 2) + j] = I[(0x1f84 >> 2) + j]; }
      I[(q + 0x58) >> 2] = I[0x1f9c >> 2];
      F[(q + 0x34) >> 2] = s.ptime;
      if (!(I[0x3103c >> 2] > 0)) break;
    }
  }
  return 0;
}

/** a colour channel to a byte */
function chan(v: number): number { return v >= 1 ? 0xff : !(v > 0) ? 0 : ftol(v * 255 + 0.5); }
/** 0x10004280 CParticleSystem::Render: point sprites, each particle drawn as a trail (fewer points the faster),
 *  through the dynamic vertex buffer in chunks of 0x2e128 (DISCARD when it wraps) */
export function f10004280(c: Core): number {
  const d = c.d;
  let I = c.m.I;
  if (I[0x2e13c >> 2] === 0) {
    const h = c.handle(d.createVertexBuffer(I[0x2e12c >> 2] << 4, Usage.DYNAMIC | Usage.WRITEONLY | Usage.POINTS, 0x42, Pool.DEFAULT));
    I = c.m.I;
    I[0x2e13c >> 2] = h;
  }
  d.setRenderState(Rs.POINTSPRITEENABLE, 1); d.setRenderState(Rs.POINTSCALEENABLE, 1);
  d.setRenderState(Rs.POINTSIZE, I[0x1fb0 >> 2]); d.setRenderState(Rs.POINTSIZE_MIN, I[0x1fb4 >> 2]);
  d.setRenderState(Rs.POINT_SCALE_A, I[0x1fb8 >> 2]); d.setRenderState(Rs.POINT_SCALE_B, I[0x1fbc >> 2]);
  d.setRenderState(Rs.POINT_SCALE_C, I[0x1fc0 >> 2]);
  const vb = c.obj<Buffer>(0x2e13c);
  d.setStreamSource(0, vb, 0x10);
  setVS(c, 0x42);
  const flush = I[0x2e128 >> 2];
  const lock = (): DataView => {
    const b = I[0x2e124 >> 2];
    const u = vb.lock(b * 16, flush * 16, b ? Lock.NOOVERWRITE : Lock.DISCARD);
    return new DataView(u.buffer, u.byteOffset, u.byteLength);
  };
  I[0x2e124 >> 2] += flush;
  if ((I[0x2e124 >> 2] >>> 0) >= (I[0x2e12c >> 2] >>> 0)) I[0x2e124 >> 2] = 0;
  let V = lock(), vo = 0, cnt = 0;
  for (let p = I[0x2e134 >> 2]; p !== 0; p = c.m.I[(p + 0x5c) >> 2]) {
    I = c.m.I;
    const F = c.m.F;
    let px = F[(p + 4) >> 2], py = F[(p + 8) >> 2], pz = F[(p + 0xc) >> 2];
    let vx = F[(p + 0x10) >> 2], vy = F[(p + 0x14) >> 2], vz = F[(p + 0x18) >> 2];
    const len2 = (vz * vz + vy * vy) + vx * vx;
    const [mo, lo, ko] = I[p >> 2] === 0 ? [0x1fa4, 0x1fa8, 0x1fa0] : [0x2010, 0x2014, 0x200c];
    if (I[mo >> 2] < I[lo >> 2]) I[mo >> 2] = I[lo >> 2];
    let n = I[lo >> 2] - ftol(len2 * -0.25);
    if (n > I[mo >> 2]) n = I[mo >> 2];
    const sc = -(F[ko >> 2] / n);
    vx = fr(sc * vx); vy = fr(sc * vy); vz = fr(sc * vz);
    const f = F[(p + 0x58) >> 2];
    const ch = (o: number): number => chan(fr((F[(p + o) >> 2] - F[(p + o + 0x10) >> 2]) * f + F[(p + o + 0x10) >> 2]));
    const r = ch(0x38), g = ch(0x3c), b = ch(0x40), a = ch(0x44);
    const col = ((((a << 8 | r) << 8) | g) << 8 | b) >>> 0;
    I[0x3103c >> 2] = 0;
    for (let i = 0; i < n; i = ++c.m.I[0x3103c >> 2]) {
      V.setFloat32(vo, px, true); V.setFloat32(vo + 4, py, true); V.setFloat32(vo + 8, pz, true);
      V.setUint32(vo + 12, col, true);
      vo += 16;
      if (++cnt === flush) {
        vb.unlock();
        d.drawPrimitive(Prim.POINTLIST, I[0x2e124 >> 2], cnt);
        cnt = 0;
        I[0x2e124 >> 2] += flush;
        if ((I[0x2e124 >> 2] >>> 0) >= (I[0x2e12c >> 2] >>> 0)) I[0x2e124 >> 2] = 0;
        V = lock(); vo = 0;
      }
      px = fr(px + vx); py = fr(py + vy); pz = fr(pz + vz);
      const k = F[0x1fac >> 2];
      vx = fr(k * vx); vy = fr(k * vy); vz = fr(k * vz);
    }
  }
  vb.unlock();
  if (cnt) d.drawPrimitive(Prim.POINTLIST, c.m.I[0x2e124 >> 2], cnt);
  d.setRenderState(Rs.POINTSPRITEENABLE, 0); d.setRenderState(Rs.POINTSCALEENABLE, 0);
  return 0;
}

def({
  0x24: debugOverlay, 0x108: resetCamera, 0x10c: cameraZ, 0x110: confirmDevice, 0x118: create,
  0x11c: oneTimeSceneInit, 0x120: init3D, 0x124: initDeviceObjects, 0x128: copyLayer, 0x130: after, 0x140: floorTexture,
  0x144: restoreDeviceObjects, 0x148: renderWater, 0x15c: buildDeviceList, 0x160: findDepth, 0x164: canRender,
  0x168: render3D, 0x16c: matrices, 0x170: caustics, 0x174: particles, 0x178: frameStats, 0x180: selectTechnique,
  0x190: clearParticles,
});
