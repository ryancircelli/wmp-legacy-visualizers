// The contract between Animator's engine (index.ts) and its warp-effect setups (effects-*.ts): what a setup may read
// and write. A setup is one of the six group pickers 0x100071b0 calls (0x10008650, 0x10009550, 0x1000a790, 0x1000eb20,
// 0x1000c640, 0x1000d740) and everything under it. Globals keep their DLL address in the name (gXXXXX = 0x100XXXXX).
import type { Lcg } from '../glass3d/lcg';
import type { WarpMap, WarpFn } from '../glass3d/warp';

export interface FxGlobals {
  /** 0x10028fd0: the drawing mode the next 0x1001339e takes (-1: pick at random) */
  g28fd0: number;
  /** 0x10028fc8, 0x10028fcc: drawing-style permissions 0x1001339e reads (1 = allowed) */
  g28fc8: number;
  g28fcc: number;
  /** 0x10028f14: the index the group picker drew */
  g28f14: number;
  /** 0x10028f98: forced blur kind (-1 none) */
  g28f98: number;
  /** 0x100ad3f0, 0x100ad3ec, 0x100ad3e8: blur permission / force / on */
  gad3f0: number;
  gad3ec: number;
  gad3e8: number;
  /** 0x1002cff0: the group 0x100071b0 picked; 0x1002cff4: effects so far; 0x1002cff8, 0x1002d008: setup scratch */
  g2cff0: number;
  g2cff4: number;
  g2cff8: number;
  g2d008: number;
  /** 0x100ad5ac, 0x100ad5a4: effect-change bookkeeping */
  gad5ac: number;
  gad5a4: number;
  /** any other 0x100xxxxx global a setup needs that the engine never reads: add it here as gXXXXX */
  [k: string]: number;
}

export interface FxCtx {
  rng: Lcg;
  /** 0x1000f7f0: ftol(rand() * n * (1/32767 as a double)), the product rounded once to a double */
  rnd(n: number): number;
  /** the picture size (0x100ad40c, 0x100ad410) */
  w: number;
  h: number;
  g: FxGlobals;
  /** 0x10014e10(p1..p5, polar, square, fn1, fn2): drop any pending map and start a new one (it is built a few rows
   *  at a time by the engine, then replaces the current map). Parameters are what the DLL stores: floats as
   *  Math.fround'ed numbers, ints as ints. */
  newMap(p: [number, number, number, number, number], polar: number, square: number, fn1: WarpFn, fn2: WarpFn): WarpMap;
}

/** a group picker: draws its index with ctx.rnd and sets the effect up */
export type FxGroup = (ctx: FxCtx) => void;
