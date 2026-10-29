// T3's particle side where it differs from Grind's (../grind/particles.ts). Offsets are T3's (o3); slots Grind's.
//
// T3's CParticleSystem is not Grind's but Picture Viz 3D's, unchanged (../../pictureviz/pv3/frame.ts): the same
// code at the same VAs (0x10003ad0 particles, 0x10003c90 update, 0x10004280 render, 0x10004870 clear), the 0x60-byte
// particle with its next pointer at +0x5c, the system-wide gravity / fade / trail parameters and the fields at
// Picture Viz 3D's own offsets. So T3 runs Picture Viz 3D's methods (VT, its table under Grind's). Emission is
// update's own: 0x1f70 particles a frame while fewer than the limit 0x1f48 live; the limit is 0 until a fountain
// transition raises it, and every clear (the scene's size check, the fountain transitions) drops it back to 0.
import type { Core } from '../../pictureviz/pv3/core';
import { VT } from '../../pictureviz/pv3/core';
import { gvt } from '../grind/core';
import { tdef, tsi, tsf } from './core';
import { o3 } from './layout';

/** vt+0x11c 0x100014f0: Grind's camera reset (0x10001500), which also sets the particles' vectors: 0x1f30 (0, 0.2, 0)
 *  and 0x1f3c (0, 0, 0) */
function resetCamera(c: Core): number {
  for (let t = 0x1ed0; t < 0x1f48; t += 4) tsi(c, t, 0);
  tsf(c, 0x1ef8, 1.600000023841858);
  tsf(c, 0x1f34, 0.20000000298023224);
  return gvt(c, 0x120);
}

/** vt+0x188 0x10003ad0: Picture Viz 3D's particles (vt+0x174 there). Every field its update / render reads sits at
 *  the same heap offset in T3's object but the emitter position (T3 0x1f64..0x1f6c), which T3's layout keeps where
 *  Grind moved it; it is lent to Picture Viz 3D's offset for the call (that heap slot is Grind's 0x2190.., a field
 *  T3's code never names) and the slot restored after */
const EMIT = 0x1f64 >> 2;
function particles(c: Core): number {
  const I = c.m.I, e = o3(0x1f64) >> 2;
  const keep = I.slice(EMIT, EMIT + 3);
  I.copyWithin(EMIT, e, e + 3);
  const r = VT[0x174 >> 2]!(c);
  c.m.I.set(keep, EMIT);
  return r;
}

/** vt+0x1a4 0x10004870: Picture Viz 3D's clear (vt+0x190): every live particle to the free list and the limit 0x1f48
 *  to 0 (Grind's keeps the limit) */
const clearParticles = (c: Core): number => VT[0x190 >> 2]!(c);

tdef({ 0x11c: resetCamera, 0x188: particles, 0x1a4: clearParticles });
