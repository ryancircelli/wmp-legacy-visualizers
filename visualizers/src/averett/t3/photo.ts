// T3's photo functions that differ from Grind's (../grind/photo.ts): its one sign, the backdrop's timer that draws
// it, and the picture's fit under it. Offsets are T3's (o3, layout.ts); vtable slots are Grind's.
import type { Core } from '../../pictureviz/pv3/core';
import { ftol, fr } from '../../pictureviz/pv2/mem';
import { gvt, tick } from '../grind/core';
import { sign } from '../grind/photo';
import { tdef, ti, tsi } from './core';

const E_FAIL = 0x80004005 | 0;
/** the current sprite's record field (sprite 0's offset f) */
const rs = (c: Core, f: number, v: number): void => tsi(c, f + ti(c, 0x1ca4) * 0x1ec, v);
const resized = (c: Core): boolean => ti(c, 0x31370) !== ti(c, 0x311ec) || ti(c, 0x31368) !== ti(c, 0x311e8);

/** vt+0x108 0x1002b170: Grind's backdrop timer (0x10032400) without its third sign: the timer
 *  (How_often_should_Bkg_picture_be_changed 0x2764), a size change, New_Bkg_effect, a scene rebuild or a hover
 *  change (0x2804) gives a new backdrop, then the sign (T3_Logo, state 0x2800) when it is on (0x27ec), its hover
 *  changed, the size changed or it has no width yet */
function backgroundTimer(c: Core): number {
  const s = ((((tick(c) - ti(c, 0x269c)) >>> 0) / 1000) >>> 0) | 0, bk = ti(c, 0x2764);
  tsi(c, 0x26a8, s);
  if (!((bk < s && ti(c, 0x12c0) !== -1 && ti(c, 0x31778) === 0 && ti(c, 0x26f0) !== 0) || resized(c) ||
      ti(c, 0x26f8) !== 0 || ti(c, 0x310ec) === 1 || ti(c, 0x2804) === 1)) return 0;
  if (bk < s) { tsi(c, 0x26e0, 0); tsi(c, 0x269c, tick(c)); tsi(c, 0x26a8, 0); }
  tsi(c, 0x31778, 3); tsi(c, 0x26b0, 1); tsi(c, 0x26b8, 0); tsi(c, 0x276c, 1);
  tsi(c, 0x1ca4, 6);
  tsi(c, 0x14f4, 2);
  rs(c, 0x9e8, 0); rs(c, 0x9ec, -2000); rs(c, 0xa08, -2000); rs(c, 0x9e4, -2);
  gvt(c, 0x250);
  if (ti(c, 0x26f0) === 0) gvt(c, 0x104);
  else if (gvt(c, 0x2c) === E_FAIL) gvt(c, 0x104);
  const on = ti(c, 0x27ec) === 1;
  if (on && ti(c, 0x2800) === 0) tsi(c, 0x2800, 1);
  if ((ti(c, 0x2804) === 1 && ti(c, 0x27ec) === 0 && ti(c, 0x2800) > 1) || resized(c) || ti(c, 0x27f8) === 0 || on) {
    gvt(c, 0x34);
  } else tsi(c, 0x2800, 0);
  tsi(c, 0x2804, 0);
  return 0;
}

/** vt+0x1b8 0x10037230: with the sign up (its height 0x27fc, at y 0x27f4), the picture takes the window's height
 *  less twice (the sign's y + height + 10), no wider than 0.9 of the window; else How_big = 90 */
function fitUnderSign(c: Core): number {
  const bh = ti(c, 0x27fc);
  if (bh === 0) { tsi(c, 0x3804, 0x5a); return 0; }
  const w = ti(c, 0x314f0), h = ti(c, 0x314e0);
  const nh = (ti(c, 0x311ec) - ((ti(c, 0x27f4) + bh + 10) << 1)) | 0;
  tsi(c, 0x2700, nh);
  const nw = ftol(nh * w / h);
  tsi(c, 0x26fc, nw);
  const lim = ftol(ti(c, 0x311e8) * fr(0.9));
  if (nw > lim) { tsi(c, 0x26fc, lim); tsi(c, 0x2700, ftol(lim * h / w)); }
  return 0;
}

tdef({
  // vt+0x34 0x1001f450: T3_Logo.jpg / _hover.jpg by the state 0x2800, at (5, 5), How_big 30 (Grind offsets: T3 0x2800,
  // 0x27f0 and 0x27fc are Grind's 0x2948, 0x2950 and 0x2944)
  0x34: (c) => sign(c, 0, 1, 0x2948, 0x2950, 0x1e, 5, 0x2944),
  0x108: backgroundTimer, 0x1b8: fitUnderSign,
});
