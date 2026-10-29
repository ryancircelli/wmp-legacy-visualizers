// Grind's transitions 31..33 (vt+0xf8, 0xfc, 0x100: 0x1003d950, 0x1003dcc0, 0x1003e030; T3's 0x1003c660,
// 0x1003c9d0, 0x1003cd40 are the same code). Grind's menu never offers them; T3 picks them by photo name. They are
// cut down from Volcanic (Picture Viz 3D's vt+0xec): on arrival the particle fountain is armed (0x1f94 50 a frame,
// the emitter params at 0x21c0.., 0x1f4c..) and the floor's sway set (0x1f30 / 0x1f38, the only thing the three
// differ in); the picture then fades in over 0x27b4 with no water rings, the fountain stopping at 0.4, and leaves
// as Volcanic does (from 100 degrees). Offsets are Grind's (core.ts).
import type { Core } from '../../pictureviz/pv3/core';
import { f100073f0 } from '../../pictureviz/pv3/frame';
import { ftol, fr } from '../../pictureviz/pv2/mem';
import { gvt, gi, si, gf, sf, cur } from './core';
import { o } from './layout';

/** ms since the change (0x27ac) over the duration at Grind offset d (FILD qword of the unsigned ms / FIDIV) */
const progress = (c: Core, d: number): number => (gi(c, 0x27ac) >>> 0) / gi(c, d);
/** (cos(deg) + 1) * 255 rounded to float, the cosine table at Grind 0x306ac */
const ease = (c: Core, deg: number): number => fr((c.m.F[(o(0x306ac) >> 2) + deg] + 1) * 255);

/** one fountain transition; (sway, tilt): the dwords it puts in 0x1f30 and 0x1f38 on arrival */
function fountain(c: Core, sway: number, tilt: number): number {
  const I = c.m.I, F = c.m.F;
  const fade = (cur(c) * 0xe0 + 0x164) >> 2, b10 = (cur(c) * 0x1ec + 0xb10) >> 2;
  if (gi(c, 0x27dc) === 1) { si(c, 0x27dc, 0); si(c, 0x31aa4, 2); si(c, 0x2e25c, 1); return 0; }
  if (gi(c, 0x27d0) === gi(c, 0x3a64)) {
    I[fade] = 0; si(c, 0x31aa4, 1); si(c, 0x27ac, 0);
    I[(cur(c) * 0xe0 + 0x114) >> 2] = 0x40a00000;                    // 5.0
    si(c, 0x21d4, 1);
    si(c, 0x1fac, 0); si(c, 0x1fb0, 0); si(c, 0x1fb4, 0); si(c, 0x1fb8, 0x3dcccccd);   // 0.1
    si(c, 0x21f0, 0); si(c, 0x1f20, 0); si(c, 0x1f94, 0x32);
    si(c, 0x21c0, 0x41200000);                                        // 10.0
    si(c, 0x21d0, 2);
    si(c, 0x21c4, 0x3ee66666);                                        // 0.45
    si(c, 0x1f30, sway); si(c, 0x1f38, tilt);
    si(c, 0x21e0, 0x3e99999a);                                        // 0.3
    si(c, 0x1f4c, 0x41a00000); si(c, 0x1f50, 0x42200000); si(c, 0x1f54, 0x41a00000);   // 20, 40, 20
    return 0;
  }
  const st = gi(c, 0x31aa4);
  if (st === 1) {
    si(c, 0x1ecc, 0x40); si(c, 0x1f48, 2000); si(c, 0x3a98, 0x41200000);
    const t = progress(c, 0x27b4);                                    // kept on the stack (FST)
    sf(c, 0x3196c, t);
    if (t >= fr(0.4)) si(c, 0x1f94, 0);
    F[fade] = ease(c, ftol(t * 90 + 180));
    if (!(gf(c, 0x3196c) >= 1)) return 0;
    I[fade] = 0x437f0000;                                             // 255.0
    si(c, 0x1ecc, 0x40); si(c, 0x31aa4, 0);
    I[b10] = -1;
    si(c, 0x2808, 0); si(c, 0x1f1c, 0); si(c, 0x1f20, 0); si(c, 0x2e25c, 0);
    f100073f0(c);                                                     // Grind 0x10007820
    gvt(c, 0x1a4);
  } else if (st === 2) {
    sf(c, 0x3196c, progress(c, 0x27b0));
    I[b10] = 0;
    F[fade] = ease(c, ftol(progress(c, 0x27b4) * 90 + 100));
    si(c, 0x3a98, 0x41200000);                                        // 10.0
    gvt(c, 0x11c);
    if (!(gf(c, 0x3196c) >= 1)) return 0;
    si(c, 0x31660, 0);
    gvt(c, 0x8c);
    si(c, 0x31aa4, 0);
    gvt(c, 0x11c);
  }
  return 0;
}

/** vt+0xf8 0x1003d950: sway 6, tilt -9 */
export const fountain31 = (c: Core): number => fountain(c, 0x40c00000, 0xc1100000 | 0);
/** vt+0xfc 0x1003dcc0: sway -6, tilt -8 */
export const fountain32 = (c: Core): number => fountain(c, 0xc0c00000 | 0, 0xc1000000 | 0);
/** vt+0x100 0x1003e030: sway 8, tilt -7 */
export const fountain33 = (c: Core): number => fountain(c, 0x41000000, 0xc0e00000 | 0);
