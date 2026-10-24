// Grind's frame: the audio step (the spectrum, its stale-input gate, the average level and its 67-step history),
// which transition runs next (Picture Viz 3D's favourites and random selections), the hover state, the frame
// counter, then the scene step (vt+0x2c4) and Render3DEnvironment (vt+0x17c). Offsets are Grind's (core.ts).
import { A } from '../../ns';
import '../../rand';
import { type GrindCore, gdef, gvt, gi, si, gf, tick } from './core';
import { o } from './layout';
import type { Core } from '../../pictureviz/pv3/core';

/** the spectrum buffers (3 of 0x208 dwords from 0x2e62c), the level history (0x43 dwords from 0x2e604) */
const SPEC = 0x2e62c, HIST = 0x2e604;

/** vt+0x390 0x10021a30: the frame (the levels: WMP's TimedLevel, frequency bytes first) */
function frame(c: Core): number {
  const g = c as GrindCore, lv = g.genv.levels;
  let I = c.m.I;
  const k = o(0x31474) >> 2;                 // the loop counter the DLL keeps in the object
  // each of the first 256 bins: the largest of 4 frequency bytes, in place
  for (I[k] = 0; I[k] < 0x100; I[k]++) {
    const i = I[k];
    let m = lv[i * 4];
    if (m < lv[i * 4 + 1]) m = lv[i * 4 + 1];
    if (m < lv[i * 4 + 2]) m = lv[i * 4 + 2];
    if (m < lv[i * 4 + 3]) m = lv[i * 4 + 3];
    lv[i] = m;
  }
  // the stale-input gate: bins 0x32..0x3b unchanged for 7 frames zero the spectrum
  si(c, 0x315a0, gi(c, 0x315a0) + 1);
  for (I[k] = 0; I[k] < 10; I[k]++) {
    const v = lv[I[k] + 0x32], f = o(0x315a4 + I[k] * 4) >> 2;
    if (I[f] !== v) { I[f] = v; si(c, 0x315a0, 0); }
  }
  if (gi(c, 0x315a0) > 6) {
    si(c, 0x315a0, 7);
    for (I[k] = 0; I[k] < 0xff; I[k]++) lv[1 + I[k]] = 0;
  }
  if (gi(c, 0x1e54) === 0 || gi(c, 0x31838) === 0) {
    si(c, 0x31358, 0); si(c, 0x3135c, 0xff); si(c, 0x312d4, 0);
    const spec = o(SPEC) >> 2, j = o(0x31aa8) >> 2;
    I[spec + gi(c, 0x31358) * 0x208 + 0xff] = 0;                 // [0xba8a + set * 0x208]
    I[k] = 0;
    for (I[j] = 0; I[j] < 0xff; I[j]++) {
      const i = I[j], set = gi(c, 0x31358) * 0x208;
      if (gi(c, 0x1e58) === 2) I[spec + set + 0xff - i] = lv[i];
      else if (gi(c, 0x1e64) === 0) I[spec + set + i] = lv[i];
      else {
        const r = A.rand() & 0xff;
        I = c.m.I;
        si(c, 0x31640, r);
        I[spec + set + i] = lv[r];
      }
      if (lv[i] !== 0) { si(c, 0x312d4, gi(c, 0x312d4) + lv[i]); I[k]++; }
    }
    // the average of the bins that are not 0
    si(c, 0x312d4, I[k] === 0 ? 0 : (gi(c, 0x312d4) / I[k]) | 0);
    si(c, 0x2268, I[k]);
    if (gi(c, 0x312d4) > 0xff) si(c, 0x312d4, 0xff);
    let h = gi(c, 0x312d8) + 1;
    if (h > 0x42) h = 0;
    si(c, 0x312d8, h);
    I[(o(HIST) >> 2) + h] = gi(c, 0x312d4);
    // its history over 0x43 steps, summed and divided by 0x44
    let s = 0;
    for (I[j] = 0; I[j] < 0x43; I[j]++) s = (s + I[(o(HIST) >> 2) + I[j]]) | 0;
    si(c, 0x312dc, (s / 0x44) | 0);
  }
  I = c.m.I;
  // which transition comes next (selection mode 0x3165c: 1 the favourites, 2..4 the random selections)
  const fav = new Int32Array(27);
  if (gi(c, 0x3165c) === 1) {
    I[k] = 0;
    for (let n = 0; n < 26; n++) if (gi(c, 0x28ac + n * 4) === 1) fav[I[k]++] = n + 5;
    const n = I[k];
    if (n === 0 && gi(c, 0x28a8) === 0 && gi(c, 0x31bec) !== 0) {
      si(c, 0x28a8, 3); propertyPage(); si(c, 0x28a8, 1);
    } else if (n === 0) si(c, 0x316a8, 5);
    else if (n === 1) si(c, 0x316a8, fav[0]);
    else if (gi(c, 0x31aa4) === 4 || gi(c, 0x2914) === 0 || n < 2 || gi(c, 0x31660) !== 0) {
      if (gi(c, 0x31aa4) !== 4 && gi(c, 0x31660) === 0) {           // in turn
        si(c, 0x31660, 1);
        if (n <= gi(c, 0x28a0)) si(c, 0x28a0, 0);
        si(c, 0x316a8, fav[gi(c, 0x28a0)]);
        si(c, 0x28a0, gi(c, 0x28a0) + 1);
      }
    } else {                                                         // Chk_PicIII_Favorite_Randomize
      if (n < 4) si(c, 0x31a44, 3);
      else if (n < 8) si(c, 0x31a44, 7);
      else if (n < 0x10) si(c, 0x31a44, 0xf);
      else if (n < 0x20) si(c, 0x31a44, 0x1f);
      else if (n < 0x40) si(c, 0x31a44, 0x3f);
      else if (n <= gi(c, 0x31a44)) si(c, 0x31a44, gi(c, 0x31a44) - n);
      si(c, 0x31660, 1);
      const r = A.rand() & gi(c, 0x31a44);
      si(c, 0x31494, r);
      if (n <= r) si(c, 0x31494, r - n);
      if (n <= gi(c, 0x31494)) si(c, 0x31494, 0);
      if (gi(c, 0x316a8) === fav[gi(c, 0x31494)]) {
        si(c, 0x31494, gi(c, 0x31494) + 1);
        if (n <= gi(c, 0x31494)) si(c, 0x31494, 0);
      }
      si(c, 0x316a8, fav[gi(c, 0x31494)]);
    }
  }
  if (gi(c, 0x31bec) !== 0 && gi(c, 0x28a4) === 1) { propertyPage(); si(c, 0x28a4, 0); }
  const ready = (): boolean => gi(c, 0x31660) === 0 && gi(c, 0x31aa4) !== 4;
  if (gi(c, 0x3165c) === 2 && ready()) {     // Random Selection - Basic 3D: ids 5..14
    si(c, 0x31660, 1);
    const a = A.rand() & 7, b = A.rand() & 1;
    let x = b + a;
    si(c, 0x31474, x);
    if (gi(c, 0x316a8) === x + 5) { x++; si(c, 0x31474, x); if (x > 7) si(c, 0x31474, 0); }
    si(c, 0x316a8, gi(c, 0x31474) + 5);
  }
  if (gi(c, 0x3165c) === 3 && ready()) {     // Random Selection - Liquid Transitions: ids 15..22
    si(c, 0x31660, 1);
    let x = A.rand() & 7;
    si(c, 0x31474, x);
    if (gi(c, 0x316a8) === x + 15) { x++; si(c, 0x31474, x); if (x > 6) si(c, 0x31474, 0); }
    si(c, 0x316a8, gi(c, 0x31474) + 15);
  }
  if (gi(c, 0x3165c) === 4 && ready()) {     // Random Selection - All Transitions: a step of 1..4 through 5..30
    si(c, 0x31660, 1);
    const v = (gi(c, 0x316a8) + (A.rand() & 3) + 1) >>> 0;
    si(c, 0x316a8, v);
    if (v > 0x1e || v < 5) si(c, 0x316a8, (A.rand() & 1) + 5);
  }
  // TrackMouseEvent(TME_LEAVE) then PeekMessage: the A/B host's window is off-screen, so WM_MOUSELEAVE is there
  if (gi(c, 0x31bec) !== 0 && gi(c, 0x2948) === 2) { si(c, 0x2948, 1); si(c, 0x294c, 1); }
  if (gf(c, 0x3c40) > 2 && gi(c, 0x291c) === 0 && gi(c, 0x2948) === 1) { si(c, 0x2948, 0); si(c, 0x294c, 1); }
  // frames per second
  const t = tick(c);
  if ((t - gi(c, 0x9c)) >>> 0 > 1000) {
    si(c, 0xa0, Math.floor((Math.imul(gi(c, 0x98), 1000) >>> 0) / ((t - gi(c, 0x9c)) >>> 0)));
    si(c, 0x9c, tick(c));
    si(c, 0x98, 0);
  }
  si(c, 0x98, gi(c, 0x98) + 1);
  gvt(c, 0x2c4);
  gvt(c, 0x17c);
  return 0;
}

/** IWMPEffects::DisplayPropertyPage (the options dialog): the app has none; the registry the port keeps never asks */
function propertyPage(): never { throw new Error('Grind: the options dialog (DisplayPropertyPage) is not ported'); }

/** vt+0x2c4 0x10026d30 */
function step(c: Core): number {
  const I = c.m.I;
  if (I[0x25f] < 2 && I[0x2c4] !== -1) I[0x25f] = 2;
  if (I[0x355] < 2 && I[0x3ba] !== -1) I[0x355] = 3;
  gvt(c, 0x1f4);
  return 0;
}

gdef({ 0x390: frame, 0x2c4: step });
