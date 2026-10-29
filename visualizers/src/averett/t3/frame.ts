// T3's frame (vt+0x390 0x1002f2a0): Grind's without the audio step and the frame counter (T3 never reads the
// levels): which transition comes next and the sign's hover state (Grind's code), the scene step (vt+0x2c4), and
// Render3DEnvironment (vt+0x17c) only once the scene, its floor and its water are up.
import type { Core } from '../../pictureviz/pv3/core';
import { chooseTransition } from '../grind/frame';
import { gvt } from '../grind/core';
import { ti, tdef } from './core';

function frame(c: Core): number {
  chooseTransition(c);
  gvt(c, 0x2c4);
  if (ti(c, 0x2dfec) !== 0 && ti(c, 0x38bc) !== 0 && ti(c, 0x38b8) !== 0) gvt(c, 0x17c);
  return 0;
}

tdef({ 0x390: frame });
