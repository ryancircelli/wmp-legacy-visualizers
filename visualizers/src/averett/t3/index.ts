// A.AverettT3: T3 (T3.dll, "Rise of the Machines"), Grind's wrapper (../grind/index.ts) on T3's engine object.
// The DLL's pictures (film stills, its backdrop, the film's sign) are not ours: art.ts draws our own in their place;
// the private A/B feeds the DLL's own (options.art: photos, background, logos = [T3_Logo, T3_Logo_hover]).
import { A } from '../../ns';
import { AverettGrind, type GrindArt } from '../grind/index';
import type { GrindCore, GrindEnv } from '../grind/core';
import { T3Core } from './core';
import { ownArt } from './art';
import './settings';
import './frame';
import './scene';
import './photo';
import './particles';

declare module '../../ns' {
  interface AlchemyNS {
    AverettT3: typeof AverettT3;
  }
}

export class AverettT3 extends AverettGrind {
  static PRESET_NAMES: string[] = ['Rise of the Machines'];
  static ENGINE = 'AverettT3';
  protected makeCore(env: GrindEnv): GrindCore { return new T3Core(env); }
  protected ownArt(): GrindArt { return ownArt(); }
}
A.AverettT3 = AverettT3;
