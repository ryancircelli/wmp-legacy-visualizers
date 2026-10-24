// Grind (Grind.dll 1.0.0.6, "Grind(2003)", one preset "Go BIG or Go Home"; Averett & Associates' Plugin framework,
// a single download from Microsoft's visualization gallery, unsigned): the engine object and its host side.
//
// Grind is Picture Viz 3D's engine (Picture_Viz_III.dll, ../../pictureviz/pv3) built again for a film promotion:
// the same CD3DApplication / CWater / CParticleSystem / photo framework with fields added and moved, its folders
// fixed (Grind_Media\Foreground: the photos, Grind_Media\Background: the backdrop, Grind_Media\Grind_logo: the sign
// and its buttons), the spectrum read every frame (the audio step of Windows Media 9 Series, 0x100157d0 there) and
// steering the transitions and the particles. The port runs Picture Viz 3D's engine on Picture Viz 3D's layout and
// replaces or adds Grind's own functions (frame.ts, scene.ts, photo.ts, particles.ts, tx.ts). Those are written
// against Grind's own offsets: o() (layout.ts) turns each into its home in the heap.
//
// The object: CComObject (operator new(0x31c04), 0x10026450) with the main object at +8 (vtable 0x10087f08, 229
// methods; constructor 0x10020b20), IWMPEffects2 at main+0x2258. VAs are Grind.dll's (image base 0x10000000).
import { A } from '../../ns';
import '../../rand';
import { Core, VT, vt, type Env, type Method } from '../../pictureviz/pv3/core';
import type { Picture } from '../../pictureviz/picture';
import { o, SLOT, GRIND_END } from './layout';
import '../../pictureviz/pv3/frame';
import '../../pictureviz/pv3/photo';
import '../../pictureviz/pv3/sprite';
import '../../pictureviz/pv3/scene';
import '../../pictureviz/pv3/tx3d';
import '../../pictureviz/pv3/txliquid';
import '../../pictureviz/pv3/txliquid2';

/** A picture with alpha (the logo PNGs): BGRA bytes, top-down */
export interface ArgbPicture { w: number; h: number; bgra: Uint8Array }

/** What Grind gets from Windows beyond Picture Viz 3D's Env */
export interface GrindEnv extends Env {
  /** Grind_Media\Background (the backdrop), in the order the DLL lists the folder */
  background: Picture[];
  /** Grind_Media\Grind_logo: Grind_Logo_0 (the sign), _1, _1_hover, _3D, _3D_hover; null where a file is missing */
  logos: (ArgbPicture | null)[];
  /** this frame's levels: 1024 spectrum bytes per channel then the waveform (WMP's TimedLevel layout, 4100 bytes) */
  levels: Uint8Array;
  /** GetLocalTime (the clock in the scene); the A/B host pins 12:00:00.000 */
  localTime?: () => { h: number; m: number; s: number; ms: number };
}

export class GrindCore extends Core {
  declare genv: GrindEnv;
  constructor(env: GrindEnv) {
    super(env);
    this.genv = env;
    this.vtab = VT.slice();
    for (const [k, f] of OWN) this.vtab[k >> 2] = f;
    construct(this);
  }
}

// ------------------------------------------------------------------------------------------------ the vtable
/** Grind's own methods by Grind slot (registered at 0x1000 + slot, and at the twin's Picture Viz 3D slot so that
 *  Picture Viz 3D's code calling that slot reaches Grind's) */
const OWN = new Map<number, Method>();
export function gdef(t: Record<number, Method>): void {
  for (const k in t) {
    const g = +k;
    OWN.set(0x1000 + g, t[k]);
    const p = SLOT.get(g);
    if (p !== undefined) OWN.set(p, t[k]);
  }
}
/** Grind's `call [eax + slot]`: its own method, else the twin's in Picture Viz 3D's table */
export function gvt(c: Core, g: number, ...a: number[]): number {
  if (c.vtab![(0x1000 + g) >> 2]) return vt(c, 0x1000 + g, ...a);
  const p = SLOT.get(g);
  if (p === undefined) throw new Error('Grind: unported engine method vt+0x' + g.toString(16));
  return vt(c, p, ...a);
}
/** a path Go BIG or Go Home never takes: the DLL's code at `va` is not ported */
export function unported(va: number): never {
  throw new Error('Grind: unported path 0x' + (va >>> 0).toString(16));
}

// ------------------------------------------------------------------------------------------------ fields
/** Grind's dword field at byte offset g (main object) */
export const gi = (c: Core, g: number): number => c.m.I[o(g) >> 2];
export const si = (c: Core, g: number, v: number): void => { c.m.I[o(g) >> 2] = v; };
export const gf = (c: Core, g: number): number => c.m.F[o(g) >> 2];
export const sf = (c: Core, g: number, v: number): void => { c.m.F[o(g) >> 2] = v; };
/** timeGetTime() */
export const tick = (c: Core): number => c.env.tick() | 0;
/** the current sprite (Grind 0x1ca4, as Picture Viz 3D) and its record / transform record deltas */
export const cur = (c: Core): number => c.m.I[0x1ca4 >> 2];

// ------------------------------------------------------------------------------------------------ the object
// What Grind's constructor (0x10020b20) leaves that Picture Viz 3D's does not, from the DLL's object before frame
// 0 (pointers, the critical sections and the window aside), at Grind offsets; and Picture Viz 3D's values Grind
// does not have.
const INIT_I: [number, number][] = [
  [0x27b0, 6000], [0x27b4, 6000], [0x2270, 1], [0x2930, 1], [0x2960, 1],
];
const INIT_F: [number, number][] = [
  [0x1f80, 0.2],
];
/** identity matrices (Grind offsets) */
const INIT_IDENT = [0x2e2b4, 0x2e3f4, 0x2e434];
/** Picture Viz 3D's constructor values Grind's object has as 0 (heap offsets) */
const PV3_ONLY = [0x1f68];

function construct(c: GrindCore): void {
  const I = c.m.I, F = c.m.F;
  if (c.m.top < GRIND_END) throw new Error('Grind: heap starts inside the object');
  for (const p of PV3_ONLY) I[p >> 2] = 0;
  for (const [g, v] of INIT_I) I[o(g) >> 2] = v;
  for (const [g, v] of INIT_F) F[o(g) >> 2] = v;
  for (const g of INIT_IDENT) for (let k = 0; k < 16; k++) F[(o(g) >> 2) + k] = k % 5 === 0 ? 1 : 0;
  si(c, 0x27cc, tick(c));                    // timeGetTime() at construction
  c.str.set(o(0x31ae8), 'Picture_Viz_III Plugin');
}

/** the folder the DLL sits in (Grind_Media\Foreground etc. are below it); only its name's identity matters here */
export const MODULE_DIR = 'Visualizations';
export const FOREGROUND = MODULE_DIR + '\\Grind_Media\\Foreground';
export const BACKGROUND = MODULE_DIR + '\\Grind_Media\\Background';

/** IWMPEffects::SetCurrentPreset 0x10022790 (this = main+0x2258): one preset, selection mode 1 (the favourites) */
export function setPreset(c: Core, n: number): boolean {
  if (n !== 0) return false;
  si(c, 0x31660, 0); si(c, 0x3165c, 1); si(c, 0x31418, 0); si(c, 0x316a8, 1); si(c, 0x2264, 0);
  return true;
}

/** IWMPEffects::Render 0x10021670 (IWMPEffects2::RenderWindowed passes the client rect (0, 0, w, h)) */
export function render(c: GrindCore, w: number, h: number): void {
  si(c, 0x31318, 32);                        // GetDeviceCaps(hdc, BITSPIXEL)
  si(c, 0x31420, 0);
  si(c, 0x314bc, 1);                         // the HDC
  // the first time: the module's folder (GetModuleFileNameA less "Grind.dll") into 0x3960; Grind_Media hangs off it
  if (gi(c, 0x31410) === 0) c.str.set(o(0x3960), MODULE_DIR);
  gvt(c, 0x114);                             // the settings (0x10030150)
  gvt(c, 0x44);                              // the photo folder (0x10034ec0)
  gvt(c, 0x48);                              // the backdrop folder (0x100352f0)
  if (gi(c, 0x31410) === 0) {
    gvt(c, 0x2e0);                           // the reset (0x10035710)
    gvt(c, 0x118);                           // the first photo numbers (0x10030040)
    si(c, 0x31410, 1);
    si(c, 0x31694, 0x15e); si(c, 0x3169c, 0x140);
    si(c, 0x31514, 0x15e); si(c, 0x31518, 0x140);
    si(c, 0x316b0, 0x100); si(c, 0x316b4, 0x100);
    sf(c, 0x3133c, (gi(c, 0x31694) / 2) | 0);
    A.srand(c.seedVal);                      // srand(time(NULL))
    gvt(c, 0x2a4);                           // the sprite table
    gvt(c, 0x2ac);                           // the scene
    gvt(c, 0x2a8);                           // the trig tables
    // [main+0xa8]->vt+0xc returns 0; [main+8]->vt+0x10 only without a window
  }
  si(c, 0x316d8, 0);
  si(c, 0x316b8, 0); si(c, 0x316bc, 0);      // rect.left, rect.top
  if (gi(c, 0x31518) !== h || gi(c, 0x31514) !== w) {
    si(c, 0x31560, 1);
    si(c, 0x31668, 0);
    si(c, 0x31518, h); si(c, 0x31514, w);
    gvt(c, 0x1a4);
    // ponytail: the device reset on a size change (0x100218fd) never runs: the port's host builds a fresh engine
    if (gi(c, 0x3b1c) !== 0) unported(0x10021905);
  } else si(c, 0x31560, 0);
  si(c, 0x3181c, gi(c, 0x11a4));
  si(c, 0x3180c, gi(c, 0x11a8));
  si(c, 0x31a94, Math.imul(gi(c, 0x3181c), gi(c, 0x11a8)));
  if (gi(c, 0x1120) === -1 && Math.imul(gi(c, 0x11a8), gi(c, 0x11a4)) !== 0) gvt(c, 0x12c);   // Direct3D (0x10001010)
  gvt(c, 0x24);                              // the debug overlay (only with its window)
  gvt(c, 0x390);                             // the frame (0x10021a30)
}
