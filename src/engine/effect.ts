// Shared base classes (see CONTRACT.md). Do not add behaviour here; modules extend these.
// Wrapped verbatim from src/15-effect.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from './ns';
import type { Surface, TimedLevel } from './ns';

// The ctx object built by Engine's constructor (src/engine/alchemy.ts) and threaded through
// every render()/hardInit()/altRender() call. One instance per Engine, mutated in place per frame.
export interface EffectCtx {
  level: TimedLevel | null;
  frame: number;
  beat: boolean;
  bigBeat: boolean;
  framesSinceBeat: number;
  framesSinceBigBeat: number;
  bass: number;
  bassDelta: number;
  w: number;
  h: number;
  A: Surface | null;
  B: Surface | null;
  C: Surface | null;
  target: Surface | null;
  surfaces: Surface[] | null;
  bgColor: number;
  destRect: { left: number; top: number; right: number; bottom: number };
  bassHistory: Float64Array;
  bassIdx: number;
  resized: boolean;
  paused: boolean;
  useAltRender: boolean;
  newAudio: boolean;
  options: { intended: boolean; [key: string]: unknown };
}

// p = {x, y} ints (destination); WarpKernel.map() mutates it in place to the source coordinate.
export interface WarpPoint {
  x: number;
  y: number;
}

A.makeSurface = function (w, h, fill) {
  const px = new Uint32Array(w * h);
  if (fill) px.fill(fill >>> 0);
  return { w, h, px };
};
// Effect base — mirrors the DLL's base object (ctor FUN_18000ad94). Field names are used by the scheduler.
export class Effect {
  declare prob: number;          // +0x20 selection probability vs rand()/32767
  declare chosen: boolean;       // +0x24
  declare state: number;         // +0x28 0 steady, 1 fading in, 2 fading out
  declare stateFrames: number;   // +0x2c
  declare transitionLen: number; // +0x30
  declare nameId: number;        // +0x34 MUI string id
  declare name: string;
  declare hasAlt: boolean;       // +0x40
  declare traceId: number;       // +0x44
  declare category: number;      // +0x48
  declare weight: number;        // pool weight (registration arg)
  declare w: number;
  declare h: number;
  constructor() {
    this.prob = 1.0;          // +0x20 selection probability vs rand()/32767
    this.chosen = false;      // +0x24
    this.state = 0;           // +0x28 0 steady, 1 fading in, 2 fading out
    this.stateFrames = 1;     // +0x2c
    this.transitionLen = 1;   // +0x30
    this.nameId = 0;          // +0x34 MUI string id
    this.name = 'Unnamed Effect';
    this.hasAlt = false;      // +0x40
    this.traceId = 6;         // +0x44
    this.category = 5;        // +0x48
    this.weight = 1.0;        // pool weight (registration arg)
    this.w = 0; this.h = 0;
  }
  setSize(w: number, h: number) { this.w = w; this.h = h; }   // vt+0x18
  hardInit(ctx: EffectCtx) {}                            // vt+0x20 (never runs in retail)
  randomize() {}                              // vt+0x28
  altRender(ctx: EffectCtx) {}                           // vt+0x30
  render(ctx: EffectCtx) {}                              // vt+0x38
}
// Warp kernel base — the shift sub-effects (base ctor FUN_18000c774, vtable 0x180020658).
export class WarpKernel extends Effect {
  declare chainable: boolean;          // +0x50: may be the 2nd kernel of a chain
  declare instantTransition: boolean;  // +0x51: force 1-frame transition
  declare identityFallback: boolean;   // +0x52: out-of-range -> keep dst coord (else fallbackX/Y)
  declare fallbackX: number;
  declare fallbackY: number;
  constructor() {
    super();
    this.chainable = true;          // +0x50: may be the 2nd kernel of a chain
    this.instantTransition = false; // +0x51: force 1-frame transition
    this.identityFallback = true;   // +0x52: out-of-range -> keep dst coord (else fallbackX/Y)
    this.fallbackX = 0; this.fallbackY = 0;
  }
  // p = {x, y} ints (destination); mutate in place to the source coordinate. Integer semantics per spec 03.
  map(p: WarpPoint) {}
}
A.Effect = Effect;
A.WarpKernel = WarpKernel;
