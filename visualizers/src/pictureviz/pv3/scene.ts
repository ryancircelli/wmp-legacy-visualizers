// Picture Viz 3D's scene: the first-frame reset and the sprite table, the trig tables, the frame (which transition
// runs next: the favourites, the three random selections, or the preset's own), and the per-transition step that
// decides when the next picture comes and drives the transition. VAs and offsets as in core.ts.
import { A } from '../../ns';
import '../../rand';
import { type Core, def, vt, tick, unported } from './core';
import { fr } from '../pv2/mem';
import { fsinF, fcosF } from './d3dx';
import { f100073f0, tgaRes } from './frame';

/** vt+0x2bc 0x10033f20: the engine reset on the first Render: sprite and transform records, the spectrum
 *  buffers, the defaults */
function reset(c: Core): number {
  const I = c.m.I;
  I[0x30ee0 >> 2] = 32;                      // GetDeviceCaps(hdc, BITSPIXEL)
  I[0x31650 >> 2] = 9;
  I[0x1ca8 >> 2] = 10;
  I[0x1ca4 >> 2] = 0;
  do {
    for (I[0x3103c >> 2] = 0; I[0x3103c >> 2] < 0x7b; I[0x3103c >> 2]++) I[(0x96c >> 2) + I[0x1ca4 >> 2] * 0x7b + I[0x3103c >> 2]] = 0;
    for (I[0x3105c >> 2] = 0; I[0x3105c >> 2] < 0x38; I[0x3105c >> 2]++) I[(0xac >> 2) + I[0x3105c >> 2] + I[0x1ca4 >> 2] * 0x38] = 0;
    I[0x1ca4 >> 2]++;
  } while ((I[0x1ca4 >> 2] >>> 0) <= (I[0x31650 >> 2] >>> 0));
  const zero = (o: number, n: number): void => {
    for (I[0x3103c >> 2] = 0; I[0x3103c >> 2] < n; I[0x3103c >> 2]++) I[(o >> 2) + I[0x3103c >> 2]] = 0;
  };
  zero(0x30db4, 0x14); zero(0x2e1f4, 0x208); zero(0x2ea14, 0x208); zero(0x2f234, 0x208); zero(0x2e178, 9);
  for (const o of [0x1e80, 0x30e50, 0x30e60, 0x30ea4]) I[o >> 2] = 0;
  I[0x30ec8 >> 2] = 0xffffff; I[0x30f24 >> 2] = 0xff;
  for (const o of [0x30f20, 0x1e6c, 0x1ca4, 0x1e4c, 0x1e50, 0x1e54, 0x1e58]) I[o >> 2] = 0;
  I[0x1e5c >> 2] = 0xff;
  for (const o of [0x1e60, 0x1e64, 0x30f48]) I[o >> 2] = 0;
  I[0x1e34 >> 2] = 1;
  for (const o of [0x30f54, 0x30f64, 0x30f6c, 0x30fc0, 0x30fe0, 0x30fec]) I[o >> 2] = 0;
  I[0x31014 >> 2] = 400;
  for (const o of [0x1e8c, 0x31058, 0x31068, 0x3106c]) I[o >> 2] = 0;
  I[0x1ec8 >> 2] = 2;
  I[0x3107c >> 2] = 0;
  I[0x310a8 >> 2] = 0x13;
  for (const o of [0x310b8, 0x310bc, 0x310c0, 0x310c4, 0x310c8, 0x310d8]) I[o >> 2] = 0;
  I[0x310dc >> 2] = 0x15e; I[0x310e0 >> 2] = 0x140;
  for (const o of [0x310e4, 0x1e74, 0x1e70]) I[o >> 2] = 0;
  I[0x31128 >> 2] = 1; I[0x3112c >> 2] = 7;
  for (const o of [0x31138, 0x3113c, 0x31148, 0x31140, 0x1e94, 0x1e98, 0x1eb0]) I[o >> 2] = 0;
  I[0x1ec4 >> 2] = 3;
  for (const o of [0x31268, 0x3126c, 0x1e88]) I[o >> 2] = 0;
  I[0x31278 >> 2] = 0x100; I[0x3127c >> 2] = 0x100;
  for (const o of [0x1e68, 0x31308, 0x3130c, 0x31310, 0x31314, 0x31350, 0x31354, 0x31358, 0x3136c, 0x31368, 0x31370,
    0x31400, 0x31468, 0x3146c, 0x31634, 0x31674, 0x31678, 0x3167c, 0x316ac, 0x98]) I[o >> 2] = 0;
  const t = tick(c);
  I[0xa0 >> 2] = 0;
  I[0x9c >> 2] = t;
  return 0;
}

/** vt+0x284 0x100342d0: every sprite unused (-1); the TGA header (the DLL writes the floor's size into its own
 *  read-only resource, which Windows XP let through) */
function spriteTable(c: Core): number {
  const I = c.m.I;
  I[0x310b0 >> 2] = I[0x31264 >> 2] << 2;
  I[0x310ac >> 2] = I[0x3125c >> 2] << 2;
  I[0x1ca4 >> 2] = 0;
  do { I[(0x96c >> 2) + I[0x1ca4 >> 2] * 0x7b] = -1; I[0x1ca4 >> 2]++; } while ((I[0x1ca4 >> 2] >>> 0) <= (I[0x31650 >> 2] >>> 0));
  const p = tgaRes(c), H = c.m.B;          // the resource (frame.ts builds its header by code)
  c.m.I[0x30e70 >> 2] = p;
  H[p + 0xc] = I[0x39a8 >> 2] & 0xff; H[p + 0xd] = (I[0x39a8 >> 2] >> 8) & 0xff;
  H[p + 0xe] = I[0x39ac >> 2] & 0xff; H[p + 0xf] = (I[0x39ac >> 2] >> 8) & 0xff;
  return 0;
}

/** vt+0x28c 0x10034430: the scene every transition starts from (sprites 0..5) */
function scene(c: Core): number {
  vt(c, 0x22c);                              // free every sprite's buffers (0x1001fb20)
  let I = c.m.I;
  I[0x1ca4 >> 2] = 0;
  do {
    for (I[0x3103c >> 2] = 0; I[0x3103c >> 2] < 0x7b; I[0x3103c >> 2]++) I[I[0x1ca4 >> 2] * 0x7b + I[0x3103c >> 2] + 0x25b] = 0;
    for (I[0x3105c >> 2] = 0; I[0x3105c >> 2] < 0x38; I[0x3105c >> 2]++) I[I[0x3105c >> 2] + I[0x1ca4 >> 2] * 0x38 + 0x2b] = 0;
    I[0x1ca4 >> 2]++;
  } while ((I[0x1ca4 >> 2] >>> 0) <= (I[0x31650 >> 2] >>> 0));
  I[0xc5a0] = 0x5a; I[0xc59d] = 0; I[0xc5a1] = 0x17d8; I[0xc5a2] = 0x1989; I[0xc5a3] = -0x13e;
  I[0x797] = 0xff; I[0x794] = 0; I[0x795] = 0; I[0xc500] = 0; I[0x793] = 0; I[0x796] = 0; I[0x798] = 0; I[0x799] = 0;
  for (I[0xc59c] = 0; I[0xc59c] < 0x208; I[0xc59c]++) I[I[0xc59c] + 0xbe95] = 0;
  for (I[0xc59c] = 0; I[0xc59c] < 10; I[0xc59c]++) I[I[0xc59c] + 0xb873] = 0;
  I[0x2c4] = -1; I[0x25b] = 2; I[0x27f] = 0x479; I[0x27a] = 0x453; I[0x27b] = -0x1da; I[0x282] = 0; I[0x263] = 0;
  I[0x264] = 1; I[0x279] = 0; I[0x2d3] = 1; I[0x25f] = 2; I[0x729] = 0;
  vt(c, 0x280);                              // sprite 0 not bound to a table image (0x100109f0)
  I = c.m.I;
  I[0x2d6] = 2; I[0x2fa] = 0x58c; I[0x2f5] = 0x522; I[0x2f6] = -0x191; I[0x2fd] = 0; I[0x2de] = 0; I[0x2df] = 4;
  I[0x2f4] = -1; I[0x33f] = -1; I[0x2da] = 2; I[0x729] = 1;
  vt(c, 0x280);
  I = c.m.I;
  I[0x351] = 2; I[0x3ba] = -1; I[0x375] = 0x58c; I[0x370] = 0x453; I[0x371] = -0x1db; I[0x378] = 0; I[0x359] = 0;
  I[0x35a] = 10; I[0x36f] = -1; I[0xd1] = 0x40000000; I[0x3c9] = 1; I[0xbc] = 0x43960000; I[0xc5] = 0x3f800000;
  I[0xc6] = 0x3f000000; I[0x3c7] = 2; I[0x355] = 2; I[0x729] = 2;
  vt(c, 0x280);
  I = c.m.I;
  I[0x3cc] = 2; I[0x3f0] = 0x58c; I[0x3eb] = 0x524; I[0x3ec] = -0x191; I[0x3f3] = 0; I[0x3d4] = 0; I[0x3d5] = 0xb;
  I[0x3ea] = 0; I[0x444] = 1; I[0x729] = 3; I[0x435] = -1; I[0x3d0] = 2;
  vt(c, 0x280);
  I = c.m.I;
  I[0x447] = 2; I[0x46b] = 0x58c; I[0x466] = 0x524; I[0x467] = -0x191; I[0x46e] = 0; I[0x44f] = 0; I[0x450] = 0x23;
  I[0x465] = 0; I[0x4b0] = -1; I[0x44b] = 2; I[0x448] = -1; I[0x469] = 0; I[0x46a] = 0; I[0x453] = 0; I[0x729] = 4;
  I[0x454] = 0; I[0x451] = 0;
  vt(c, 0x280);
  I = c.m.I;
  I[0x53e] = -1; I[0x55f] = 0; I[0x560] = 0; I[0x549] = 0; I[0x54a] = 0; I[0x547] = 0; I[0x4c2] = 2; I[0x4e6] = 0x58c;
  I[0x4e1] = 0x4f5; I[0x4e2] = 0x35; I[0x4e9] = -0x2e; I[0x4ca] = 0; I[0x4cb] = 5; I[0x4e0] = -1; I[0x52b] = -1;
  I[0x4c6] = 2; I[0x729] = 5;
  vt(c, 0x280);
  return 0;
}

/** vt+0x288 0x10034860: sin / cos of whole degrees (FSIN/FCOS of i * (float)0.01745328, stored as float) */
function trigTables(c: Core): number {
  const F = c.m.F, k = fr(0.01745328);
  F[0x30814 >> 2] = 0;
  for (let i = 1; i < 360; i++) F[(0x30814 >> 2) + i] = fsinF(i * k);
  F[0x30274 >> 2] = 1;
  for (let i = 1; i < 360; i++) F[(0x30274 >> 2) + i] = fcosF(i * k);
  return 0;
}

/** IWMPEffects::DisplayPropertyPage 0x1000c740 (the options dialog), which the frame opens by itself when no
 *  favourite is checked or obj+0x2668 == 1: the app has no options dialog and its registry never gets there */
function propertyPage(): number { return unported(0x1000c740); }

/** vt+0x36c 0x1002f0e0: the frame: which transition runs next (favourites / random selections / the preset's
 *  own), then the scene (vt+0x2a4) and Render3DEnvironment (vt+0x168). The TimedLevel is not read. */
function frame(c: Core): number {
  let I = c.m.I;
  const fav = new Int32Array(27);
  if (I[0x31224 >> 2] === 1) {               // the favourites: Chk_PicIII_transition_1..26 = ids 5..30
    I[0x3103c >> 2] = 0;
    for (let k = 0; k < 26; k++) if (I[(0x2670 >> 2) + k] === 1) fav[I[0x3103c >> 2]++] = k + 5;
    const n = I[0x3103c >> 2];
    if (I[0x317b4 >> 2] !== 0 && n === 0 && I[0x266c >> 2] === 0) {
      I[0x266c >> 2] = 3;
      propertyPage();
      I[0x266c >> 2] = 1;
    } else if (n === 0) I[0x31270 >> 2] = 5;
    else if (n === 1) I[0x31270 >> 2] = fav[0];
    else {
      const busy = I[0x3166c >> 2] !== 4, fresh = I[0x31228 >> 2] === 0;
      if (busy && I[0x26d8 >> 2] !== 0 && n >= 2 && fresh) {      // Chk_PicIII_Favorite_Randomize
        if (n <= 3) I[0x3160c >> 2] = 3;
        else if (n <= 7) I[0x3160c >> 2] = 7;
        else if (n <= 0xf) I[0x3160c >> 2] = 0xf;
        else if (n <= 0x1f) I[0x3160c >> 2] = 0x1f;
        else if (n <= 0x3f) I[0x3160c >> 2] = 0x3f;
        else if (I[0x3160c >> 2] >= n) I[0x3160c >> 2] -= n;
        I[0x31228 >> 2] = 1;
        let r = A.rand() & I[0x3160c >> 2];
        I[0x3105c >> 2] = r;
        if (r >= n) I[0x3105c >> 2] = r - n;
        if (I[0x3105c >> 2] >= n) I[0x3105c >> 2] = 0;
        r = I[0x3105c >> 2];
        if (I[0x31270 >> 2] === fav[r]) { r++; I[0x3105c >> 2] = r; if (r >= n) I[0x3105c >> 2] = 0; }
        I[0x31270 >> 2] = fav[I[0x3105c >> 2]];
      } else if (busy && fresh) {                                  // in turn
        I[0x31228 >> 2] = 1;
        if (I[0x2664 >> 2] >= n) I[0x2664 >> 2] = 0;
        I[0x31270 >> 2] = fav[I[0x2664 >> 2]];
        I[0x2664 >> 2]++;
      }
    }
  }
  I = c.m.I;
  if (I[0x317b4 >> 2] !== 0 && I[0x2668 >> 2] === 1) { propertyPage(); I[0x2668 >> 2] = 0; }
  const ready = (): boolean => I[0x31228 >> 2] === 0 && I[0x3166c >> 2] !== 4;
  if (I[0x31224 >> 2] === 2 && ready()) {    // Random Selection - Basic 3D: ids 5..14
    I[0x31228 >> 2] = 1;
    const a = A.rand() & 7, b = A.rand() & 1;
    let k = b + a;
    I[0x3103c >> 2] = k;
    if (I[0x31270 >> 2] === k + 5) { k++; I[0x3103c >> 2] = k; if (k >= 8) I[0x3103c >> 2] = 0; }
    I[0x31270 >> 2] = I[0x3103c >> 2] + 5;
  }
  if (I[0x31224 >> 2] === 3 && ready()) {    // Random Selection - Liquid Transitions: ids 15..22
    I[0x31228 >> 2] = 1;
    let k = A.rand() & 7;
    I[0x3103c >> 2] = k;
    if (I[0x31270 >> 2] === k + 15) { k++; I[0x3103c >> 2] = k; if (k >= 7) I[0x3103c >> 2] = 0; }
    I[0x31270 >> 2] = I[0x3103c >> 2] + 15;
  }
  if (I[0x31224 >> 2] === 4 && ready()) {    // Random Selection - All Transitions: a step of 1..4 through 5..30
    I[0x31228 >> 2] = 1;
    const v = (I[0x31270 >> 2] + (A.rand() & 3) + 1) >>> 0;
    I[0x31270 >> 2] = v;
    if (v > 0x1e || v < 5) I[0x31270 >> 2] = (A.rand() & 1) + 5;
  }
  // TrackMouseEvent(TME_LEAVE) on the window, then PeekMessage: the A/B host's window is off-screen, so the
  // WM_MOUSELEAVE is always there; it only matters in the hover state 2, which needs the mouse (OnWindowMessage)
  if (I[0x317b4 >> 2] !== 0 && I[0x26f4 >> 2] === 2) { I[0x26f4 >> 2] = 1; I[0x26f8 >> 2] = 1; }
  if (c.m.F[0x38d0 >> 2] > 2 && I[0x26e0 >> 2] === 0 && I[0x26f4 >> 2] === 1) { I[0x26f4 >> 2] = 0; I[0x26f8 >> 2] = 1; }
  vt(c, 0x2a4);
  vt(c, 0x168);
  return 0;
}

/** vt+0x2a4 0x1001fab0 */
function step(c: Core): number {
  const I = c.m.I;
  if (I[0x25f] < 2 && I[0x2c4] !== -1) I[0x25f] = 2;
  if (I[0x355] < 2 && I[0x3ba] !== -1) I[0x355] = 3;
  vt(c, 0x1d8);
  return 0;
}

/** vt+0x1d8 0x100348f0: a new transition id restarts the scene */
function transitionCheck(c: Core): number {
  const I = c.m.I;
  if (I[0xc41b] !== I[0xc49c]) {
    I[0xc41b] = I[0xc49c];
    I[0xc3f8] = 0;
    I[0x7b3] = 0x40;
    I[0x808] = 0x3e800000;                   // 0.25
  }
  vt(c, 0x2a8);
  return 0;
}

/** vt+0x2a8 0x10034940: the scene start (state 0x30fe0 == 0) */
function sceneStart(c: Core): number {
  let I = c.m.I;
  if (I[0xc3f8] === 0) {
    vt(c, 0x28c);
    I = c.m.I;
    I[0xdca] = 0x41200000;                   // 10.0
    f100073f0(c);
    vt(c, 0x170);
    vt(c, 0x2d8);
    I = c.m.I;
    I[0x72a] = 9;
    for (const k of [0x2c4, 0x25b, 0x33f, 0x2d6, 0x3ba, 0x351, 0x435, 0x3cc, 0x52b, 0x4c2, 0x5a6, 0x53d, 0x621]) I[k] = -1;
    I[0xc5a1] = 0; I[0xc5a2] = 0; I[0xc5a3] = 0; I[0xc5a0] = 0;
    I[0x5b8] = 2; I[0x4b0] = 0; I[0x447] = 2; I[0x466] = 0; I[0x467] = 0; I[0x46e] = -0x32; I[0x465] = -2; I[0x4bd] = 1;
    I[0x480] = 0; I[0x47f] = 300;
  }
  vt(c, 0x2ac);
  return 0;
}

/** vt+0x1bc 0x10036890: the window size or the state asks for the scene again */
function sceneCheck(c: Core): number {
  let I = c.m.I;
  if (I[0xc499] !== I[0xc438] || I[0xc497] !== I[0xc437] || I[0xc3f8] === 1) {
    I[0xc3f8] = 2;
    vt(c, 0x2e0);
    I = c.m.I;
    I[0xc59b] = 3; I[0x968] = 1; I[0x96a] = 0;
    f100073f0(c);
    vt(c, 0x190);
    vt(c, 0x84);
  }
  return 0;
}

/** vt+0x2ac 0x10034a60: the transition's own step: the picture timer (0x2590 seconds since 0x2584 against the
 *  interval 0x36f4), the next picture (vt+0x28 / vt+0xf8), then the common step vt+0x80 */
function transitionStep(c: Core): number {
  let I = c.m.I;
  const id = I[0x31270 >> 2];
  if (id < 5 || id > 30) return 0;
  vt(c, 0xf4);
  I = c.m.I;
  if (I[0x30fe0 >> 2] === 0) return restart(c);
  I[0x31668 >> 2] = id + 0x15;               // the transition: vt+0x88 + 4 * (id - 5)
  if (id >= 15) I[0x1ecc >> 2] = 0x40;       // the liquid ones (and Electric, Crossing, ...)
  if (id === 23) I[0x2020 >> 2] = 0x3f333333;                     // 0.7
  if (id === 24) I[0x2020 >> 2] = 0x3e4ccccd;                     // 0.2
  if (id !== 5) return later(c, id);
  if ((I[0x25a0 >> 2] === 1 || I[0x3166c >> 2] === 2) && I[0x2660 >> 2] !== 1) I[0x2584 >> 2] = tick(c);
  I[0x2590 >> 2] = Math.floor(((tick(c) - I[0x2584 >> 2]) >>> 0) / 1000);
  vt(c, 0x1bc);
  I = c.m.I;
  if (I[0x30fe8 >> 2] === 1) return 0;
  if (I[0x2590 >> 2] > I[0x36f4 >> 2] || I[0x25a0 >> 2] === 1) {
    const st = I[0x3166c >> 2];
    if (st === 0 || st === 3) {
      I[0x1ca4 >> 2] = 4;
      if (vt(c, 0x28) === (0x80004005 | 0)) return 0;
      vt(c, 0xf8);
      I = c.m.I;
      if (I[0x2660 >> 2] === 1) { I[0x2660 >> 2] = 0; I[0x25a0 >> 2] = 0; return 0; }
      I[0x31228 >> 2] = 0; I[0x25a0 >> 2] = 0;
      I[0x2584 >> 2] = tick(c);
      I[0x2568 >> 2] = tick(c);
      if (I[0x25a8 >> 2] === 0) I[0x259c >> 2] = 0;
    }
  }
  I[0x1ca4 >> 2] = 4;
  vt(c, 0x80);
  return 0;
}
/** 0x10034a60's blocks for ids 6..30 after the transition fields: the same timer; the next picture's tail
 *  0x100361aa does not clear 0x31228 (Pop's does) and keeps the flag 0x25a8 in 0x259c; ids 15..25 and 28..30 set
 *  0x26dc first (0x10036073) */
function later(c: Core, id: number): number {
  let I = c.m.I;
  if ((I[0x25a0 >> 2] === 1 || I[0x3166c >> 2] === 2) && I[0x2660 >> 2] !== 1) I[0x2584 >> 2] = tick(c);
  I[0x2590 >> 2] = Math.floor(((tick(c) - I[0x2584 >> 2]) >>> 0) / 1000);
  vt(c, 0x1bc);
  I = c.m.I;
  if (I[0x30fe8 >> 2] === 1) return 0;
  if (I[0x2590 >> 2] > I[0x36f4 >> 2] || I[0x25a0 >> 2] === 1) {
    const st = I[0x3166c >> 2];
    if (st === 0 || st === 3) {
      I[0x1ca4 >> 2] = 4;
      if (vt(c, 0x28) === (0x80004005 | 0)) return 0;
      I = c.m.I;
      if (id >= 15 && id !== 26 && id !== 27) I[0x26dc >> 2] = 1;
      vt(c, 0xf8);
      I = c.m.I;
      if (I[0x2660 >> 2] === 1) { I[0x2660 >> 2] = 0; I[0x25a0 >> 2] = 0; return 0; }
      I[0x25a0 >> 2] = 0;
      I[0x2584 >> 2] = tick(c);
      I[0x2568 >> 2] = tick(c);
      I[0x259c >> 2] = I[0x25a8 >> 2] === 0 ? 0 : 1;
      I[0x112c >> 2] = 3;
    }
  }
  I[0x1ca4 >> 2] = 4;
  vt(c, 0x80);
  return 0;
}
/** 0x10036224: the scene asks to start over */
function restart(c: Core): number {
  const I = c.m.I;
  I[0x259c >> 2] = 0; I[0x30fe0 >> 2] = 1; I[0x25a0 >> 2] = 1; I[0x3166c >> 2] = 0; I[0x25a8 >> 2] = 0;
  return 0;
}

/** vt+0x80 0x100363e0: the common transition step: the first time (or state 3) reset the sprite and the water,
 *  then the transition 0x31668 (0x1a.. = vt+0x88..0xec) and the frame counter vt+0x7c */
function common(c: Core): number {
  let I = c.m.I;
  if (I[0xc59b] === 3 || I[0x96a] === 0) {
    I[0x96a] = 1;
    vt(c, 0x84);
    f100073f0(c);
    vt(c, 0x108);
  }
  I = c.m.I;
  const k = I[0xc59a];
  if (k >= 0x1a && k <= 0x33) { vt(c, 0x88 + (k - 0x1a) * 4); vt(c, 0x7c); }
  return 0;
}

/** vt+0x7c 0x10036a50: the transition's frame counter and frames-per-second estimate */
function frameCounter(c: Core): number {
  const I = c.m.I;
  if (I[0x2590 >> 2] === I[0x36f4 >> 2]) { I[0x2568 >> 2] = tick(c); I[0x257c >> 2] = 0; }
  const st = I[0x3166c >> 2];
  if (st === 1 || st === 2) I[0x256c >> 2] = (tick(c) - I[0x2568 >> 2]) | 0;
  const n = I[0x257c >> 2] + 1;
  I[0x257c >> 2] = n;
  if (I[0x3166c >> 2] === 1 && I[0x256c >> 2] !== 0) {
    I[0x257c >> 2] = n + 1;
    I[0x2580 >> 2] = Math.floor((Math.imul(n + 1, 1000) >>> 0) / (I[0x256c >> 2] >>> 0));
  }
  return 0;
}

/** vt+0x84 0x10036af0: the current sprite's transition fields and transform record back to rest */
function spriteRest(c: Core): number {
  const I = c.m.I, s = I[0x1ca4 >> 2] * 0x1ec;
  I[0x3166c >> 2] = 0;
  for (const o of [0xa80, 0xa84, 0xa50, 0xa8c, 0xa90, 0xa94, 0xafc, 0xae0, 0xadc, 0xad4, 0xad8, 0xa58, 0xa60, 0xa64,
    0xab8, 0xabc, 0xac0, 0xab4]) I[(s + o) >> 2] = 0;
  for (I[0x3105c >> 2] = 0; I[0x3105c >> 2] < 0x38; I[0x3105c >> 2]++) I[(0xac >> 2) + I[0x3105c >> 2] + I[0x1ca4 >> 2] * 0x38] = 0;
  return 0;
}

/** vt+0x88 0x10036cd0: Pop: the picture appears (state 1: once 0x256c ms have passed beyond the hold 0x2574, the
 *  floor texture is remade from the new picture) and leaves (state 2, after 0x2570 ms) */
function pop(c: Core): number {
  let I = c.m.I;
  if (I[0x259c >> 2] === 1) { I[0x259c >> 2] = 0; I[0x3166c >> 2] = 2; return 0; }
  if (I[0x2590 >> 2] === I[0x36f4 >> 2]) {
    I[(I[0x1ca4 >> 2] * 0xe0 + 0x164) >> 2] = 0;
    I[0x256c >> 2] = 0;
    I[0x3166c >> 2] = 1;
    return 0;
  }
  const F = c.m.F;
  if (I[0x3166c >> 2] === 1) {
    F[0x31534 >> 2] = (I[0x256c >> 2] >>> 0) / I[0x2574 >> 2];
    if ((I[0x256c >> 2] >>> 0) / I[0x2574 >> 2] > 0) {
      I[0x3166c >> 2] = 0; I[0x25c8 >> 2] = 0;
      vt(c, 0x140);
    }
  } else if (I[0x3166c >> 2] === 2) {
    F[0x31534 >> 2] = (I[0x256c >> 2] >>> 0) / I[0x2570 >> 2];
    I[(0xb10 + I[0x1ca4 >> 2] * 0x1ec) >> 2] = 0;
    if (F[0x31534 >> 2] > 0) {
      I[(I[0x1ca4 >> 2] * 0xe0 + 0x164) >> 2] = 0;
      I[0x31228 >> 2] = 0;
      vt(c, 0x84);
      I = c.m.I;
      I[0x3166c >> 2] = 0;
      vt(c, 0x108);
      vt(c, 0x140);
    }
  }
  return 0;
}

def({
  0x2bc: reset, 0x284: spriteTable, 0x28c: scene, 0x288: trigTables, 0x36c: frame, 0x2a4: step, 0x1d8: transitionCheck,
  0x2a8: sceneStart, 0x1bc: sceneCheck, 0x2ac: transitionStep, 0x80: common, 0x7c: frameCounter, 0x84: spriteRest,
  0x88: pop,
});
