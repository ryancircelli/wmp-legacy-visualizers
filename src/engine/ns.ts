// The engine's shared namespace: what `window.Alchemy` was. Every engine module attaches its exports to
// it and calls the others through it late-bound (`A.rand()`, `A.Effect`, `A.BatteryDraws[name]`), which
// is what lets the A/B tools (tools/js_*.js) count rand() draws and the tests swap in fakes. Keep it so.
import type { Effect, WarpKernel } from './effect';
import type { Shift } from './shift';
import type { Kernels } from './kernels';
import type { Draw } from './draw';
import type { Engine } from './alchemy';
import type { Bars } from './bars';
import type { BatteryWarps } from './battery/warps';
import type { BatteryDrawsNS } from './battery/draws';
import type { Battery } from './battery/index';

/** 0x00RRGGBB little-endian, as the DLLs store it: px[i] = (r << 16) | (g << 8) | b, alpha byte 0. */
export interface Surface {
  w: number;
  h: number;
  px: Uint32Array;
}

/** One WMP Render() call's audio. state 2 = playing (WMP's value); wave bytes centred on 128. */
export interface TimedLevel {
  freq: [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];
  wave: [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];
  state: number;
  timeStamp: number;
}

export interface AlchemyNS {
  // rand.ts — MSVC CRT LCG and ucrtbase's sin/cos/atan2 clones
  srand(s: number): void;
  rand(): number;
  randSeed(s?: number): number;
  fma(a: number, b: number, c: number): number;
  sin(x: number): number;
  cos(x: number): number;
  /** out[0] = sin(x), out[1] = cos(x), exactly as sin()/cos() */
  sincos(x: number, out: Float64Array): void;
  atan2(y: number, x: number): number;
  // effect.ts
  makeSurface(w: number, h: number, fill?: number): Surface;
  Effect: typeof Effect;
  WarpKernel: typeof WarpKernel;
  // Alchemy (mpvis.DLL)
  /** Shift's gather + blur: 'auto' = WebAssembly when available, else JS (movebits.ts). */
  moveBitsMode: 'auto' | 'js' | 'wasm';
  Shift: typeof Shift;
  Kernels: typeof Kernels;
  Draw: typeof Draw;
  Engine: typeof Engine;
  // Bars and Waves, Battery (wmp.dll)
  /** Battery's blur and palette passes: 'auto' = WebAssembly when available, else JS (battery/kernel.ts). */
  batteryKernel: 'auto' | 'js' | 'wasm';
  Bars: typeof Bars;
  BatteryWarps: typeof BatteryWarps;
  BatteryDraws: BatteryDrawsNS;
  Battery: typeof Battery;
}

export const A = {} as AlchemyNS;
