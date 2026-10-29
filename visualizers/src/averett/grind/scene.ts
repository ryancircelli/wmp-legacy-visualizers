// Grind's scene: the sprite table, the scene start (with the clock hands and the spectrum fountains, vt+0x208), the
// size check, the transition step (which picture comes when, and the music's say: a quiet stretch turns the next
// change into a plain fade), the common step that dispatches the 29 transitions, and Grind's versions of Picture Viz
// 3D's transitions (the camera pulled back to -11000 when a picture leaves). Offsets are Grind's (core.ts).
import { type Core, VT, xb } from '../../pictureviz/pv3/core';
import { blastOff, spatter, volcanic } from '../../pictureviz/pv3/txliquid2';
import { f100073f0 } from '../../pictureviz/pv3/frame';
import { fr64 } from '../../pictureviz/pv3/d3dx';
import { sincos87, mulExt } from '../../plenoptic/x87';
import { ftol, fr } from '../../pictureviz/pv2/mem';
import { type GrindCore, gdef, gvt, gi, si, gf, sf, tick, cur } from './core';
import { o } from './layout';
import { f10004320 } from './particles';
import { fountain31, fountain32, fountain33 } from './txfountain';

const E_FAIL = 0x80004005 | 0;

/** vt+0x2a4 0x10035ac0: every sprite unused (-1). (Grind leaves its DATATABLE_tga resource alone, unlike Picture Viz
 *  3D's 0x100342d0.) */
function spriteTable(c: Core): number {
  const I = c.m.I;
  si(c, 0x314e8, gi(c, 0x3169c) << 2);
  si(c, 0x314e4, gi(c, 0x31694) << 2);
  I[0x1ca4 >> 2] = 0;
  do { I[(0x96c >> 2) + cur(c) * 0x7b] = -1; I[0x1ca4 >> 2]++; } while ((cur(c) >>> 0) <= (gi(c, 0x31a88) >>> 0));
  return 0;
}

/** vt+0x2cc 0x100360e0: the scene start (state 0x31418 == 0), then the clock and fountains (vt+0x208) and the
 *  transition step (vt+0x2d0) */
function sceneStart(c: Core): number {
  sceneSetup(c);
  gvt(c, 0x208);
  gvt(c, 0x2d0);
  return 0;
}
/** 0x100360e0's scene start (state 0x31418 == 0), shared with T3's (which has no clock) */
export function sceneSetup(c: Core): void {
  if (gi(c, 0x31418) === 0) {
    gvt(c, 0x2ac);
    si(c, 0x3a98, 0x41200000);               // 10.0
    f100073f0(c);
    gvt(c, 0x184);
    gvt(c, 0x2fc);
    const I = c.m.I;
    I[0x72a] = 9;
    for (const k of [0x2c4, 0x25b, 0x33f, 0x2d6, 0x3ba, 0x351, 0x435, 0x3cc, 0x52b, 0x4c2, 0x5a6, 0x53d, 0x621]) I[k] = -1;
    si(c, 0x31abc, 0); si(c, 0x31ac0, 0); si(c, 0x31ac4, 0); si(c, 0x31ab8, 0);
    I[0x5b8] = 2; I[0x4b0] = 0; I[0x447] = 2; I[0x466] = 0; I[0x467] = 0; I[0x46e] = -0x32; I[0x465] = -2; I[0x4bd] = 1;
    I[0x480] = 0; I[0x47f] = 300;
  }
}

/** vt+0x1d8 0x10038540: the canvas size or the state asks for the scene again (the particles are cleared only when
 *  the size changed) */
function sceneCheck(c: Core): number {
  const changed = (): boolean => gi(c, 0x31694) !== gi(c, 0x31514) || gi(c, 0x3169c) !== gi(c, 0x31518);
  if (changed() || gi(c, 0x31418) === 1) {
    si(c, 0x31418, 2);
    gvt(c, 0x304);
    si(c, 0x31aa4, 3); si(c, 0x27e0, 1); si(c, 0x27e8, 0);
    f100073f0(c);
    const ch = changed();
    si(c, 0x226c, 1);
    if (ch) gvt(c, 0x1a4);
    gvt(c, 0x8c);
  }
  return 0;
}

/** vt+0x2d0 0x10036200: the transition's step. Out of a transition, a quiet stretch (the level's 0x43-step average
 *  0x312dc at most 10) makes the next one Transparency (id 6). Then Picture Viz 3D's step (its 0x10034a60) for ids
 *  5..33: the picture timer (0x27d0 seconds since 0x27c4 against the interval 0x3a64), the next picture (vt+0x28 /
 *  vt+0x10c), the common step vt+0x88. */
function transitionStep(c: Core): number {
  if (gi(c, 0x31aa4) === 0) {
    c.str.set(o(0x3150), c.str.get(o(0x29bc)) ?? '');      // lstrcpyA
    if (gi(c, 0x312dc) <= 10) si(c, 0x316a8, 6);
  }
  return runTransition(c);
}
/** the rest of 0x10036200, from the transition id on (T3's step differs only before it) */
export function runTransition(c: Core): number {
  const id = gi(c, 0x316a8);
  if (id < 5 || id > 33) return 0;
  gvt(c, 0x108);
  if (gi(c, 0x31418) === 0) return restart(c);
  si(c, 0x31aa0, id + 0x15);                 // the transition: vt+0x90 + 4 * (id - 5)
  if (id >= 15) si(c, 0x1ecc, 0x40);
  if (id === 23) si(c, 0x2254, 0x3f333333);  // 0.7
  if (id === 24) si(c, 0x2254, 0x3e4ccccd);  // 0.2
  if ((gi(c, 0x27e0) === 1 || gi(c, 0x31aa4) === 2) && gi(c, 0x289c) !== 1) si(c, 0x27c4, tick(c));
  si(c, 0x27d0, Math.floor(((tick(c) - gi(c, 0x27c4)) >>> 0) / 1000));
  gvt(c, 0x1d8);
  if (gi(c, 0x31420) === 1) return 0;
  if (gi(c, 0x27d0) > gi(c, 0x3a64) || gi(c, 0x27e0) === 1) {
    const st = gi(c, 0x31aa4);
    if (st === 0 || st === 3) {
      c.m.I[0x1ca4 >> 2] = 4;
      if (gvt(c, 0x28) === E_FAIL) return 0;
      if (id >= 15 && id !== 26 && id !== 27) si(c, 0x2918, 1);
      gvt(c, 0x10c);
      if (gi(c, 0x289c) === 1) { si(c, 0x289c, 0); si(c, 0x27e0, 0); return 0; }
      if (id === 5) {
        si(c, 0x31660, 0); si(c, 0x27e0, 0);
        si(c, 0x27c4, tick(c)); si(c, 0x27a8, tick(c));
        if (gi(c, 0x27e8) === 0) si(c, 0x27dc, 0);
      } else {
        si(c, 0x27e0, 0);
        si(c, 0x27c4, tick(c)); si(c, 0x27a8, tick(c));
        si(c, 0x27dc, gi(c, 0x27e8) === 0 ? 0 : 1);
        si(c, 0x112c, 3);
      }
    }
  }
  c.m.I[0x1ca4 >> 2] = 4;
  gvt(c, 0x88);
  return 0;
}
/** 0x10037c49: the scene asks to start over */
function restart(c: Core): number {
  si(c, 0x27dc, 0); si(c, 0x31418, 1); si(c, 0x27e0, 1); si(c, 0x31aa4, 0); si(c, 0x27e8, 0);
  return 0;
}

/** vt+0x88 0x10037de0: the common step: the first time (or state 3) reset the sprite, the water, the caustics and
 *  the camera; then the transition 0x31aa0 (0x1a.. = vt+0x90..0x100) and the frame counter vt+0x84 */
function common(c: Core): number {
  if (gi(c, 0x31aa4) === 3 || gi(c, 0x27e8) === 0) {
    si(c, 0x27e8, 1);
    gvt(c, 0x8c);
    f100073f0(c);
    gvt(c, 0x184);
    gvt(c, 0x11c);
  }
  const k = gi(c, 0x31aa0);
  if (k >= 0x1a && k <= 0x36) { gvt(c, 0x90 + (k - 0x1a) * 4); gvt(c, 0x84); }
  return 0;
}

// ------------------------------------------------------------------------------------------------ transitions
/** Picture Viz 3D's transition at its slot (the port's own function, not Grind's) */
const pv3 = (slot: number) => VT[slot >> 2]!;
/** Zoom, Store, Spiral, Spin, Stack'm, Slide: Picture Viz 3D's, but the picture leaving (0x27dc) also puts the
 *  camera back at -11000 */
function farOnLeave(slot: number) {
  const f = pv3(slot);
  return (c: Core): number => {
    if (gi(c, 0x27dc) === 1) { f(c); si(c, 0x1ed8, 0xc62be000 | 0); return 0; }
    return f(c);
  };
}
const COS = 0x306ac;
/** vt+0x94 0x10038b40: Transparency: the picture fades in and out (state 2 eases from 100 degrees); at its end the
 *  floor texture is remade only with the drop shadow flag 0x2824 (Picture Viz 3D's always remakes it) */
function transparency(c: Core): number {
  const I = c.m.I, F = c.m.F, fade = (cur(c) * 0xe0 + 0x164) >> 2;
  if (gi(c, 0x27dc) === 1) { si(c, 0x27dc, 0); si(c, 0x31aa4, 2); return 0; }
  if (gi(c, 0x27d0) === gi(c, 0x3a64)) { I[fade] = 0; si(c, 0x27ac, 0); si(c, 0x31aa4, 1); return 0; }
  const t = (gi(c, 0x27ac) >>> 0) / gi(c, 0x27b4);
  const ease = (deg: number): number => fr((c.m.F[(o(COS) >> 2) + deg] + 1) * 255);   // the cosine table by degree
  if (gi(c, 0x31aa4) === 1) {
    F[fade] = ease(ftol(t * 90 + 180));
    if (ftol(c.m.F[fade]) > 0xf5) {
      c.m.I[fade] = 0x437f0000;
      si(c, 0x31aa4, 0); c.m.I[(0xb10 + cur(c) * 0x1ec) >> 2] = -1; si(c, 0x2808, 0);
      gvt(c, 0x154);
    }
  } else if (gi(c, 0x31aa4) === 2) {
    I[(0xb10 + cur(c) * 0x1ec) >> 2] = 0;
    F[fade] = ease(ftol(t * 90 + 100));
    if (ftol(c.m.F[fade]) < 10) {
      c.m.I[fade] = 0;
      si(c, 0x31660, 0);
      gvt(c, 0x8c);
      si(c, 0x31aa4, 0);
      gvt(c, 0x11c);
      if (gi(c, 0x2824) === 1) gvt(c, 0x154);
    }
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ the fountains
const SC = new Float64Array(4), SC2 = new Float64Array(4);
/** a - (hi + lo) rounded once to a double (FSUB with a 64-bit operand at 53-bit precision) */
function subExt(a: number, hi: number, lo: number): number {
  const s = a - hi, bb = s - a, e = (a - (s - bb)) + (-hi - bb);
  return s + (e - lo);
}
/** GetLocalTime as the clock reads it (the A/B host pins it to 12:00:00.000) */
function localTime(c: Core): { h: number; m: number; s: number; ms: number } {
  const lt = (c as GrindCore).genv.localTime;
  return lt ? lt() : { h: 12, m: 0, s: 0, ms: 0 };
}
/** one hand: (r, g, b) at 0x1f9c.., 0x2e4e8 = k, angle a (the FPU's double), emitter at (cos a * near, 4, sin a *
 *  near) moving (cos a * far, sin a * far): the hands share this shape with their own constants */
/** vt+0x208 0x1003e3a0: every frame: the clock (hour, minute and second hands as particle fountains, from
 *  GetLocalTime), the floor's sway with the music (0x1f30..0x1f44: grows while the 0x43-step level average is above
 *  5, decays below), and with a loud enough average (20 or more) a ring of fountains whose count, heights and
 *  colours follow the spectrum */
function fountains(c: Core): number {
  const H = c.m.H;
  if (gi(c, 0x2e4ec) === 0) {
    si(c, 0x2e4ec, 1);
    const init: [number, number][] = [
      [0x1f30, 0], [0x1f34, 0x3e4ccccd], [0x1f38, 0], [0x1f3c, 0], [0x1f40, 0], [0x1f44, 0], [0x1f48, 3000],
      [0x21dc, 0x3f19999a], [0x21d0, 2], [0x21d4, 10], [0x224c, 1], [0x1f94, 0], [0x21f0, 0], [0x1f74, 0], [0x1f70, 0],
      [0x1f78, 0], [0x1f68, 0], [0x1f64, 0], [0x1f6c, 0], [0x21c0, 0], [0x1f9c, 0], [0x1fa0, 0x3e3851ec],
      [0x1fa4, 0x3f800000], [0x1fa8, 0x3f800000], [0x1fac, 0], [0x1fb0, 0], [0x1fb4, 0], [0x1fb8, 0x3f800000],
      [0x21c4, 0x3c343958], [0x21c8, 0x3dd0e560], [0x1f4c, 0x404ccccd], [0x1f50, 0], [0x1f54, 0x3ecccccd],
      [0x1f58, 0xc1a26666 | 0], [0x1f5c, 0x41600000], [0x1f60, 0x3e99999a], [0x21d8, 0x3fa2f1aa], [0x21cc, 0x3e4ccccd],
      [0x220c, 0x3f800000], [0x2210, 0x3f800000], [0x2214, 0], [0x2218, 0x3f800000], [0x223c, 8], [0x221c, 0],
      [0x2240, 0x16], [0x2244, 0x3fae147b], [0x2220, 0], [0x2224, 0], [0x2228, 0x3f000000], [0x222c, 0],
      [0x2230, 0x3f800000], [0x2234, 0x3f4ccccd], [0x2238, 0x3f800000], [0x21f4, 0x41400000], [0x21f8, 0x41400000],
      [0x21fc, 0x41400000],
    ];
    for (const [g, v] of init) si(c, g, v);
  }
  si(c, 0x21c4, 0x3c343958); si(c, 0x21c8, 0x3dd0e560); si(c, 0x21d8, 0x3fa2f1aa); si(c, 0x21cc, 0x3e4ccccd);
  const t = localTime(c);
  H[(o(0x2e4f0) >> 1) + 1] = t.m;           // 0x2e4f2
  H[o(0x2e4f4) >> 1] = t.s;
  H[o(0x2e4f0) >> 1] = t.h;
  const msf = t.ms * fr(0.001);
  sf(c, 0x2e500, msf);
  const secA = (msf + (t.s + 15)) * fr(0.105);
  sf(c, 0x2e504, secA);
  if (t.h > 12) H[o(0x2e4f0) >> 1] = t.h - 12;
  // the second hand: angle 4x (st0 kept at 53 bits), green-white
  const a1 = secA * 4;
  sf(c, 0x31558, a1);
  si(c, 0x1f5c, 0x40800000);                // 4.0
  hand(c, a1, [0x3f000000, 0x3f000000, 0, 0x3f800000], 0xbfc00000 | 0, fr(-1.5), fr(-3.5), true);
  // the minute hand from the second's angle (float), then the minutes'
  const a2 = gf(c, 0x2e504);
  hand(c, a2, [0x3e051eb8, 0x3e4ccccd, 0x3f800000, 0x3f800000], 0xbf428f5c | 0, fr(-0.76), fr(-2.76), false);
  const a3 = (H[(o(0x2e4f0) >> 1) + 1] + 15) * fr(0.105);
  sf(c, 0x31558, a3);
  hand(c, a3, [0, 0x3e3851ec, 0x3f800000, 0x3f800000], 0xbf851eb8 | 0, fr(-1.04), fr(-3.04), true);
  // the hour hand: the minute angle (float) * 0.066 + (hour + 3) * 5 * 0.105
  si(c, 0x2e4e8, 0xbecccccd | 0); si(c, 0x1f98, 1);
  const a4 = ((H[o(0x2e4f0) >> 1] + 3) * 5) * fr(0.105) + gf(c, 0x31558) * fr(0.066);
  sf(c, 0x31558, a4);
  sincos87(a4, SC);
  const c4 = fr64(SC[2], SC[3]);
  sf(c, 0x1f58, mulExt(fr(-0.4), SC[2], SC[3]));
  sf(c, 0x1f60, mulExt(fr(-0.4), SC[0], SC[1]));
  sf(c, 0x1f4c, c4 * fr(-2.4));
  sf(c, 0x1f54, mulExt(fr(-2.4), SC[0], SC[1]));
  si(c, 0x21c0, 0);
  f10004320(c);
  // the floor's sway with the level
  for (const g of [0x2e590, 0x2e594, 0x2e598, 0x2e59c, 0x2e5a0]) si(c, g, 0);
  if (gi(c, 0x312dc) > 5) {
    const w = gf(c, 0x2e4f8) + fr(0.004);
    sf(c, 0x2e4f8, w);
    sf(c, 0x1f3c, gf(c, 0x1f3c) + fr(0.025));
    sf(c, 0x1f40, gf(c, 0x1f40) + fr(0.01));
    sf(c, 0x1f44, gf(c, 0x1f44) + fr(0.005));
    if (gf(c, 0x1f38) < 9) { sincos87(w, SC); sf(c, 0x1f38, mulExt(20, SC[0], SC[1])); }
    sincos87(gf(c, 0x2e4f8) * 0.5, SC); sf(c, 0x1f30, mulExt(5, SC[0], SC[1]));
    sincos87(gf(c, 0x2e4f8) * 5, SC); sf(c, 0x1f34, mulExt(10, SC[0], SC[1]) + 15);
  } else {
    sf(c, 0x1f3c, gf(c, 0x1f3c) * fr(0.85)); sf(c, 0x1f40, gf(c, 0x1f40) * fr(0.85)); sf(c, 0x1f44, gf(c, 0x1f44) * fr(0.85));
    sf(c, 0x1f30, gf(c, 0x1f30) * fr(0.95)); sf(c, 0x1f34, gf(c, 0x1f34) * fr(0.95)); sf(c, 0x1f38, gf(c, 0x1f38) * fr(0.95));
  }
  // the ring of spectrum fountains
  if (gi(c, 0x2268) === 0 || gi(c, 0x312dc) < 0x14) return 0;
  sincos87(gf(c, 0x2e504), SC);
  si(c, 0x21c8, 0x3e0b4396);
  sf(c, 0x21d8, fr(0.973) - subExt(1, SC[2], SC[3]));       // FSUBR 1.0, FSUBR 0.973 on the 64-bit cosine
  si(c, 0x21cc, 0x3eab020c);
  const lvl = gi(c, 0x312d4);
  let n = ftol(Math.imul(lvl, lvl) * fr(0.0018));
  if (n > 0x14) n = 0x14;
  si(c, 0x2e5a0, 1);
  if (n <= 1) return 0;
  const spec = o(0x2e62c) >> 2, I = c.m.I;
  for (let i = 1; i < n; i = gi(c, 0x2e5a0)) {
    const v = I[spec + 2 + i * 3];                          // [0x2e634 + 12 i]
    sincos87(v * fr(0.45) * gf(c, 0x2e504), SC);
    sf(c, 0x21c0, mulExt(v, SC[0], SC[1]) * fr(0.19));
    const b = gf(c, 0x2e504) + 60;
    const ang = ((((((i + 0x11) * i * i) * fr(0.005)) * gi(c, 0x312dc)) * b) * b) * b * fr(1.4e-7);
    sf(c, 0x31558, ang);
    const k = -v * fr(0.08);
    sf(c, 0x2e4e8, k);
    sincos87(ang, SC2);
    const cf = fr64(SC2[2], SC2[3]);
    sf(c, 0x1f58, mulExt(k, SC2[2], SC2[3]));
    sf(c, 0x1f60, mulExt(gf(c, 0x2e4e8), SC2[0], SC2[1]));
    sf(c, 0x1f4c, (gf(c, 0x2e4e8) - 6) * cf);
    sf(c, 0x1f54, mulExt(gf(c, 0x2e4e8) - 6, SC2[0], SC2[1]));
    let h = v * fr(0.00038);
    sf(c, 0x2e5a4, h);
    if (h > fr(0.05)) si(c, 0x2e5a4, 0x3d4ccccd);
    h = gf(c, 0x2e5a4);
    const r = gi(c, 0x2e590) + 1;
    si(c, 0x2e594, 0); si(c, 0x2e598, 0); si(c, 0x2e590, r);
    sf(c, 0x21c4, fr(0.077) - h);
    si(c, 0x2e59c, 0);
    // the colour turns through six pairs of components, each from another bin
    const bin = (k2: number): number => I[spec + 2 + i * 10 + k2] * fr(0.01);
    if (r === 1) { si(c, 0x2e59c, 0x3f800000); sf(c, 0x2e594, bin(0)); }
    else if (r === 2) { si(c, 0x2e59c, 0x3f800000); sf(c, 0x2e598, bin(8)); }
    else if (r === 3) { si(c, 0x2e598, 0x3f800000); sf(c, 0x2e594, bin(13)); }
    else if (r === 4) { si(c, 0x2e598, 0x3f800000); sf(c, 0x2e59c, bin(18)); }
    else if (r === 5) { si(c, 0x2e594, 0x3f800000); sf(c, 0x2e59c, bin(23)); }
    else if (r === 6) { si(c, 0x2e594, 0x3f800000); si(c, 0x2e590, 0); sf(c, 0x2e598, bin(28)); }
    for (const g of [0x2e594, 0x2e598, 0x2e59c]) if (gf(c, g) > 1) si(c, g, 0x3f800000);
    sf(c, 0x1f9c, gf(c, 0x2e594)); sf(c, 0x1fa0, gf(c, 0x2e598)); si(c, 0x1f98, 1);
    sf(c, 0x1fa4, gf(c, 0x2e59c)); si(c, 0x1fa8, 0x3f800000);
    f10004320(c);
    si(c, 0x2e5a0, gi(c, 0x2e5a0) + 1);
  }
  return 0;
}
/** a hand of the clock: colour (dwords at 0x1f9c.. after 0x1f98 = 1), 0x2e4e8, the fountain's place and push from
 *  the angle's cosine / sine (64-bit) by `near` and `far`; `stored`: the cosine times `far` is taken from the
 *  cosine as stored to float (the DLL's FST to a local), else from the register */
function hand(c: Core, a: number, rgba: number[], k: number, near: number, far: number, stored: boolean): void {
  sincos87(a, SC);
  si(c, 0x1f9c, rgba[0]); si(c, 0x1fa0, rgba[1]); si(c, 0x1fa4, rgba[2]); si(c, 0x1fa8, rgba[3]);
  si(c, 0x2e4e8, k); si(c, 0x1f98, 1);
  const cs = fr64(SC[2], SC[3]);
  sf(c, 0x1f58, mulExt(near, SC[2], SC[3]));
  sf(c, 0x1f60, mulExt(near, SC[0], SC[1]));
  if (stored) { sf(c, 0x1f4c, cs * far); sf(c, 0x1f54, mulExt(far, SC[0], SC[1])); }
  else { sf(c, 0x1f4c, mulExt(far, SC[2], SC[3])); sf(c, 0x1f54, fr64(SC[0], SC[1]) * far); }
  si(c, 0x21c0, 0);
  f10004320(c);
}

/** 0x100070f0: Blast-off's jet, Picture Viz 3D's (0x10006b10) without the random spot and off centre: the water cell
 *  at row 25, column 31 (cells of height, velocity; 64 a row) set to the strength, its 8 neighbours' velocities to
 *  0.9 of it */
function jet(c: Core): number {
  const I = c.m.I, F = c.m.F, p = I[0x373c >> 2];
  F[0x31120 >> 2] = F[(xb(c) + 0x114) >> 2];
  F[(p + 0x32f8) >> 2] = F[0x31120 >> 2];
  for (const k of [0x32f4, 0x3304, 0x30fc, 0x34fc, 0x30f4, 0x3504, 0x3104, 0x34f4]) F[(p + k) >> 2] = F[0x31120 >> 2] * fr(0.9);
  return 0;
}

gdef({
  0x2a4: spriteTable, 0x2cc: sceneStart, 0x1d8: sceneCheck, 0x2d0: transitionStep, 0x88: common, 0x208: fountains,
  0x94: transparency, 0x98: farOnLeave(0x90), 0x9c: farOnLeave(0x94), 0xa0: farOnLeave(0x98), 0xa4: farOnLeave(0x9c),
  0xb0: farOnLeave(0xa8), 0xb4: farOnLeave(0xac), 0xdc: (c) => spatter(c, false, 0.5, fr(1.13)), 0xe4: (c) => blastOff(c, jet),
  0xf4: (c) => volcanic(c, false),
  0xf8: fountain31, 0xfc: fountain32, 0x100: fountain33,   // ids 31..33: only T3 picks them (txfountain.ts)
});
