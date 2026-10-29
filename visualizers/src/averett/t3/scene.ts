// T3's scene: the start without Grind's clock (vt+0x2cc 0x10034a30), the size check that always clears the particles
// (vt+0x1d8 0x100372e0), and the transition step (vt+0x2d0 0x10034b50): out of a transition, the transition comes from the picture's file
// name (the find data's cFileName, copied to 0x2ff0): "T3_Tr05" .. "T3_Tr33" name transitions 5..33 (the last match
// wins; none: Transparency, 6). The rest is Grind's (../grind/scene.ts runTransition); T3 has no music in it.
import { type Core, VT } from '../../pictureviz/pv3/core';
import { SLOT } from '../grind/layout';
import { runTransition, sceneSetup } from '../grind/scene';
import { gvt } from '../grind/core';
import { f100073f0 } from '../../pictureviz/pv3/frame';
import { o3 } from './layout';
import { ti, tsi, tdef } from './core';

function sceneStart(c: Core): number {
  sceneSetup(c);
  gvt(c, 0x2d0);
  return 0;
}

function sceneCheck(c: Core): number {
  if (ti(c, 0x31370) !== ti(c, 0x311ec) || ti(c, 0x31368) !== ti(c, 0x311e8) || ti(c, 0x310ec) === 1) {
    tsi(c, 0x310ec, 2);
    gvt(c, 0x304);
    tsi(c, 0x31778, 3); tsi(c, 0x26b0, 1); tsi(c, 0x26b8, 0);
    f100073f0(c);
    tsi(c, 0x2038, 1);
    gvt(c, 0x1a4);
    gvt(c, 0x8c);
  }
  return 0;
}

function transitionStep(c: Core): number {
  if (ti(c, 0x31778) === 0) {
    const name = c.str.get(o3(0x285c)) ?? '';
    c.str.set(o3(0x2ff0), name);
    tsi(c, 0x3137c, 6);
    for (let n = 5; n <= 33; n++) if (name.includes('T3_Tr' + String(n).padStart(2, '0'))) tsi(c, 0x3137c, n);
  }
  return runTransition(c);
}

tdef({ 0x2cc: sceneStart, 0x1d8: sceneCheck, 0x2d0: transitionStep });

// Transparency, Zoom, Store, Spiral, Spin, Stack'm and Slide: Picture Viz 3D's own (T3 has neither Grind's
// drop-shadow condition nor its camera pull-back to -11000)
const PV3_TX = [0x94, 0x98, 0x9c, 0xa0, 0xa4, 0xb0, 0xb4];
tdef(Object.fromEntries(PV3_TX.map((g) => [g, VT[SLOT.get(g)! >> 2]!])));
