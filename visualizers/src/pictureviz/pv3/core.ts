// Picture_Viz_III.dll ("Picture Viz 3D: Spring Edition", the Creativity Fun Pack 2003, CLSID
// {24BD6812-8D7C-48ad-915A-2CB7866E70D5}): the engine object and its host side. Built on Averett & Associates'
// Direct3D 8 "Plugin framework" (the DirectX 8 SDK's CD3DApplication, its Water and PointSprites samples, D3DX)
// with the Picture Viz photo engine on top: the photo is the floor texture under a rippling water mesh, the
// transitions move it in 3-D or stir the water.
//
// The object: CComObject (operator new(0x317cc), 0x10033630) holding the main object at +8 (vtable 0x10083aa8 /
// 0x10083f4c, 220 virtual methods; constructor 0x1002e350), IWMPEffects2 at main+0x2024. The port keeps the main
// object in one flat heap at address 0 (pv2/mem.ts), fields named by their byte offset in it (an IWMPEffects
// method's `this` is main+0x2024, so its offsets read 0x2024 lower in the DLL), malloc'd blocks above it.
// Direct3D objects the object holds are small handles into `objs`.
//
// VAs are the DLL's (image base 0x10000000). Arithmetic: the x87 at 53-bit precision (the device is created with
// D3DCREATE_FPU_PRESERVE; control word 0x027F), so FMUL/FDIV/FADD are double ops, FSTP float is Math.fround and
// _ftol truncates (pv2/mem.ts ftol).
import { A } from '../../ns';
import '../../rand';
import { Mem } from '../pv2/mem';
import type { Picture } from '../picture';
import type { Device } from '../../d3d8/api';

/** the main object's size (the CComObject's 0x317cc less its 8-byte head) */
export const OBJ_SIZE = 0x317c4;

/** What the DLL gets from Windows */
export interface Env {
  /** timeGetTime(): milliseconds, wraps at 2^32. QueryPerformanceCounter is the same clock in microseconds
   *  (frequency 1,000,000), as the A/B host pins it. */
  tick(): number;
  /** the pictures, in the order the DLL would list the folder's files */
  pictures: Picture[];
  /** the device the DLL creates on its first frame (the reference rasterizer by default) */
  createDevice(w: number, h: number): Device;
  /** GDI+: the picture drawn with HighQualityBicubic at dw x dh into a bw x bh 32bppPARGB bitmap at (dx, dy) and
   *  read back as 32bppARGB; returns the bitmap as 0xAARRGGBB, top-down */
  scale(pic: Picture, dx: number, dy: number, dw: number, dh: number, bw: number, bh: number): Uint32Array;
  /** the particle sprite (the DLL's DATATABLE_Particle JPEG, decoded as D3DX gives it): 128 x 128 X8R8G8B8 BGRA */
  particle(): Uint8Array;
}

export type Method = (c: Core, ...a: number[]) => number;
/** the main vtable (0x10083f4c): `vt(c, 0x36c)` is the DLL's `call [eax+0x36c]`; each module fills its slots */
export const VT: (Method | undefined)[] = [];
export function vt(c: Core, off: number, ...a: number[]): number {
  const f = VT[off >> 2];
  if (!f) throw new Error('PictureViz3: unported engine method vt+0x' + off.toString(16));
  return f(c, ...a);
}
/** register methods: def({ 0x36c: frame, ... }) */
export function def(t: Record<number, Method>): void {
  for (const k in t) VT[+k >> 2] = t[k];
}
/** a path the presets never take (at any window size): the DLL's code at `va` is not ported */
export function unported(va: number): never {
  throw new Error('PictureViz3: unported path 0x' + (va >>> 0).toString(16));
}

export class Core {
  declare m: Mem;
  declare env: Env;
  /** HKCU\Software\Microsoft\MediaPlayer\PictureViz_II (shared with Picture Viz II) */
  declare reg: Map<string, number | string>;
  /** string fields of the object (folder names), by byte offset */
  declare str: Map<number, string>;
  /** the device (null until the first frame creates it) */
  declare dev: Device | null;
  /** D3D objects by handle (0 = null) */
  declare objs: unknown[];
  /** what srand(time(NULL)) gets on the first Render */
  declare seedVal: number;
  /** the picture the folder search stopped at (index into env.pictures), for the loaders */
  declare found: number;
  /** set by Present */
  declare presented: boolean;

  constructor(env: Env) {
    const m = new Mem(64 << 20);
    m.top = (OBJ_SIZE + 0xfff) & ~0xfff;
    this.m = m;
    this.env = env;
    this.reg = new Map();
    this.str = new Map();
    this.dev = null;
    this.objs = [null];
    this.seedVal = 1;
    this.found = 0;
    this.presented = false;
    construct(this);
  }
  handle(o: unknown): number { this.objs.push(o); return this.objs.length - 1; }
  obj<T>(off: number): T { return this.objs[this.m.I[off >> 2]] as T; }
  get d(): Device { return this.dev!; }
}

/** timeGetTime() */
export function tick(c: Core): number { return c.env.tick() | 0; }
/** byte delta of the current sprite's record (sprite obj+0x1ca4; records of 0x1ec bytes from obj+0x96c): field
 *  `off` (as sprite 0 has it) of the current sprite is I[(off + lb(c)) >> 2] */
export function lb(c: Core): number { return c.m.I[0x1ca4 >> 2] * 0x1ec; }
/** byte delta of the current sprite's transform record (records of 0xe0 bytes from obj+0xac) */
export function xb(c: Core): number { return c.m.I[0x1ca4 >> 2] * 0xe0; }

// ------------------------------------------------------------------------------------------------ the object
// What the constructor (0x1002e350, with the bases 0x1001dfb0 / 0x1001fe80 and the two CD3DFont constructors
// 0x10007b90) leaves non-zero, apart from pointers (vtables, two critical sections, the fonts) and the window.
const INIT_I: [number, number][] = [
  [0x24, 0x46], [0x28, 0x64], [0x88, 0x1], [0x90, 0x280], [0x94, 0x1e0], [0x1ce0, 0x1], [0x1e34, 0x1], [0x1e5c, 0xff],
  [0x1ebc, 0x578], [0x1ec0, 0x960], [0x1ecc, 0x40], [0x1f70, 0xa], [0x1fa4, 0x8], [0x1fa8, 0x2], [0x1fc4, 0x4],
  [0x2010, 0x8], [0x2014, 0x2], [0x2028, 0x4], [0x202c, 0xff], [0x2030, 0x4], [0x2570, 0xbb8], [0x2574, 0xbb8],
  [0x2578, 0x1388], [0x25ac, 0x4], [0x25c8, 0x1], [0x25d0, 0x1], [0x26e0, 0x1], [0x26f4, 0x1], [0x36fc, 0x1],
  [0x3990, 0x1], [0x3994, 0x10], [0x2dea4, 0x1], [0x2def0, 0x1], [0x2e128, 0x200], [0x2e12c, 0x800], [0x30ff8, 0x1],
  [0x31270, 0x5],
];
const INIT_F: [number, number][] = [
  [0x1e38, 0.1], [0x1f4c, 6], [0x1f50, 24], [0x1f54, 6], [0x1f68, 0.2], [0x1f74, 1], [0x1f78, 1], [0x1f7c, 1],
  [0x1f80, 1], [0x1f8c, 1], [0x1f90, 0.1], [0x1f94, -9.8], [0x1f98, 0.25], [0x1f9c, 1], [0x1fa0, 0.04], [0x1fac, 1],
  [0x1fb0, 0.15], [0x1fc0, 0.07], [0x1fc8, 6], [0x1fcc, 12], [0x1fd0, 6], [0x1fd8, 0.2], [0x1fe4, 0.2], [0x1fe8, 1],
  [0x1fec, 1], [0x1ff8, 0.5], [0x1ffc, 0.5], [0x2000, -9.8], [0x2004, 0.4], [0x2008, 1], [0x200c, 0.04], [0x2018, 1],
  [0x2020, 0.25], [0x3720, 1], [0x3728, 10], [0x2dec0, 0.5], [0x2dec4, -1], [0x2dec8, 1], [0x2ded0, 0.5],
  [0x2dedc, 1], [0x2def4, 1], [0x2def8, 1], [0x2e120, 0.03], [0x2e14c, 3], [0x2e150, -4], [0x2e164, 3], [0x2e168, -4],
];
/** matrices the constructor leaves as identity */
const INIT_IDENT = [0x2df44, 0x2e084, 0x2e0c4];

function construct(c: Core): void {
  const I = c.m.I, F = c.m.F;
  for (const [o, v] of INIT_I) I[o >> 2] = v;
  for (const [o, v] of INIT_F) F[o >> 2] = v;
  for (const o of INIT_IDENT) for (let k = 0; k < 16; k++) F[(o >> 2) + k] = k % 5 === 0 ? 1 : 0;
  I[0x2deac >> 2] = c.handle({});            // the two CD3DFont objects (only tested for null)
  I[0x2deb0 >> 2] = c.handle({});
  I[0x258c >> 2] = tick(c);                  // timeGetTime() at construction
  I[0x317b4 >> 2] = 1;                       // IWMPEffects2::Create(hwnd) 0x1002fe60: the window
  c.str.set(0x316b0, 'Picture_Viz_III Plugin');
}

/** IWMPEffects::SetCurrentPreset 0x1002fca0 (this = main+0x2024). Presets 0..3 are the selection modes 1..4
 *  (Favorites, Random Basic 3D / Liquid / All), 4..29 set the transition id n + 1 directly. */
export function setPreset(c: Core, n: number): boolean {
  if (n < 0 || n >= 0x1e) return false;
  const I = c.m.I, k = n + 1;
  if (k <= 4) {
    I[0x31228 >> 2] = 0;
    I[0x31224 >> 2] = k;
    I[0x30fe0 >> 2] = 0;
    I[0x31270 >> 2] = 1;
  } else {
    I[0x31224 >> 2] = 0;
    I[0x31270 >> 2] = k;
  }
  I[0x2030 >> 2] = n;
  return true;
}

/** IWMPEffects2::RenderWindowed 0x10030090 -> IWMPEffects::Render 0x1002ee60 with the client rect (0, 0, w, h).
 *  The TimedLevel goes on to the frame (vt+0x36c), which never reads it. */
export function render(c: Core, w: number, h: number): void {
  let I = c.m.I;
  I[0x30ee0 >> 2] = 32;                      // GetDeviceCaps(hdc, BITSPIXEL)
  I[0x30fe8 >> 2] = 0;
  I[0x31084 >> 2] = 1;                       // the HDC
  vt(c, 0x100);                              // settings 0x10028e80
  vt(c, 0x3c);                               // picture folder 0x1002db20
  vt(c, 0x40);                               // background folder 0x1002df40
  I = c.m.I;
  if (I[0x30fd8 >> 2] === 0) {
    vt(c, 0x2bc);                            // reset 0x10033f20
    vt(c, 0x104);                            // first photo indexes 0x10028d90
    I = c.m.I;
    I[0x30fd8 >> 2] = 1;
    I[0x3125c >> 2] = 0x15e; I[0x31264 >> 2] = 0x140;
    I[0x310dc >> 2] = 0x15e; I[0x310e0 >> 2] = 0x140;
    I[0x31278 >> 2] = 0x100; I[0x3127c >> 2] = 0x100;
    c.m.F[0x30f04 >> 2] = (I[0x3125c >> 2] / 2) | 0;
    A.srand(c.seedVal);                      // srand(time(NULL))
    vt(c, 0x284);                            // sprite table 0x100342d0
    vt(c, 0x28c);                            // scene 0x10034430
    vt(c, 0x288);                            // trig tables 0x10034860
    // [main+0xa8]->vt+0xc is 0x10020010 (returns 0); [main+8]->vt+0x10 only without a window
  }
  I = c.m.I;
  I[0x312a0 >> 2] = 0;
  I[0x31280 >> 2] = 0; I[0x31284 >> 2] = 0;  // rect.left, rect.top
  if (I[0x310dc >> 2] !== w || I[0x310e0 >> 2] !== h) {
    I[0x31128 >> 2] = 1;
    I[0x31230 >> 2] = 0;
    I[0x310e0 >> 2] = h;
    I[0x310dc >> 2] = w;
    // ponytail: a size change after the device exists resets it in the DLL (0x1002efe1: display mode, vt+0x17c);
    // the port's host builds a fresh engine on resize instead
    if (I[0x37ac >> 2] !== 0) unported(0x1002efe1);
    if (I[0x20 >> 2] !== 0) unported(0x1002f04c);
  } else I[0x31128 >> 2] = 0;
  I[0x313e4 >> 2] = I[0x11a4 >> 2];
  I[0x313d4 >> 2] = I[0x11a8 >> 2];
  I[0x3165c >> 2] = Math.imul(I[0x313e4 >> 2], I[0x313d4 >> 2]);
  vt(c, 0x118);                              // Direct3D, the first time 0x10001000
  vt(c, 0x24);                               // the debug overlay 0x10021300 (only with its window)
  vt(c, 0x36c);                              // the frame 0x1002f0e0
}
