// T3 (T3.dll 1.0.0.1, "T3", one preset "Rise of the Machines"; Averett & Associates' Plugin framework, a single
// download from Microsoft's visualization gallery for the film): the engine object.
//
// T3 is Grind's engine (Grind.dll, ../grind) built again for another film: the same CD3DApplication / CWater /
// CParticleSystem / photo framework, its folders T3_Media\Foreground, \Background and \T3_logo, one sign (a button
// with its hover picture) where Grind has three, its own particles and transition schedule. The port runs Grind's
// engine and replaces Grind's functions where T3's differ; those are written against T3's own offsets, which o3()
// (layout.ts) turns into the heap's.
//
// The object: CComObject (operator new(0x318d8)) with the main object at +8 (226 methods; constructor 0x1002e400),
// IWMPEffects2 at main+0x2024. VAs are T3.dll's (image base 0x10000000); vtable slots are named by Grind's.
import type { Method } from '../../pictureviz/pv3/core';
import type { Core } from '../../pictureviz/pv3/core';
import { GrindCore, gdef, type GrindEnv } from '../grind/core';
import { o3 } from './layout';

/** T3's methods by Grind slot, over Grind's own */
const OWN = new Map<number, Method>();
export function tdef(t: Record<number, Method>): void { gdef(t, OWN); }

export class T3Core extends GrindCore {
  constructor(env: GrindEnv) {
    super(env, OWN);
    construct(this);
  }
}

/** T3's dword field at byte offset t (main object) */
export const ti = (c: Core, t: number): number => c.m.I[o3(t) >> 2];
export const tsi = (c: Core, t: number, v: number): void => { c.m.I[o3(t) >> 2] = v; };
export const tf = (c: Core, t: number): number => c.m.F[o3(t) >> 2];
export const tsf = (c: Core, t: number, v: number): void => { c.m.F[o3(t) >> 2] = v; };

/** what T3's constructor (0x1002e400) leaves that Grind's does not (T3 offsets) */
const INIT_I: [number, number][] = [
  [0x2680, 3000], [0x2684, 3000],
];
function construct(c: T3Core): void {
  for (const [t, v] of INIT_I) tsi(c, t, v);
}
