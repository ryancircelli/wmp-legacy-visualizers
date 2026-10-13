// Microsoft's downloadable visualizations built on the Musical Colors engine (Averett & Associates, 2000-2001):
// Blazing Colors, Pulsing Colors, Color Cubes and Trilogy I, II, III. Each DLL is that engine (core.ts, `ver` 1 / 2:
// the differences from wmpvis.dll are switched there) plus its own presets and image table. Field offsets below are
// wmpvis.dll's (the port keeps its object), with layer and transform records relocated (core.ts, LY / XF); VAs are
// the DLL's own (image base 0x10000000).
import { A } from '../ns';
import type { Surface, TimedLevel } from '../ns';
import '../rand';
import { Core, LY, XF, lf, xf, ftol, PLUS_SCENE, TR_COUNT, TR_FPS, TR_RANDOM, TR_RCOUNT, type PlusDll } from './core';
import type { MusicalImage } from './images';
import { blazeImages, colorCubesImages, trilogyImages } from './plus-images';

/** layer k's fields (offsets as layer 0 has them, >= 0x76c) or its transform record's (as record 0 has them) */
function ls(s: Int32Array, k: number, t: number[]): void {
  for (var i = 0; i < t.length; i += 2) {
    var f = t[i];
    if (f >= 0x76c) s[LY(k) + lf(f)] = t[i + 1];
    else s[XF(k) + xf(f)] = t[i + 1];
  }
}
/** globals: [offset, value, ...] */
function gs(s: Int32Array, t: number[]): void {
  for (var i = 0; i < t.length; i += 2) s[t[i] >> 2] = t[i + 1];
}
const F = (v: number): number => new Int32Array(new Float32Array([v]).buffer)[0];

/** the program's head, every Plus build (Blazing Colors 0x10016340): a preset not yet set up first clears the trails
 *  (when the last one was in bar mode), rebuilds the default scene and turns bar mode on */
function head(c: Core): Int32Array {
  var s = c.m.I;
  if (s[0x4574 >> 2] === 0) {
    s[0x4458 >> 2] = 0;
    if (s[0x457c >> 2] !== 0) {
      s[0x44a8 >> 2] = 0; c.clearLayerImage();
      s[0x44a8 >> 2] = 2; c.clearLayerImage();
    }
    c.defaultScene();
    s = c.m.I;
    s[0x47f8 >> 2] = 1;
    s[LY(2) + lf(0x910)] = 0;
    s[0x457c >> 2] = 1;
  }
  return s;
}
/** a preset's first frame: set up, 352 x 320 canvas, five layers, the camera at the origin */
function setup(c: Core, step: number): Int32Array {
  var s = c.m.I;
  s[0x4574 >> 2] = 1;
  c.canvasPlus();
  s = c.m.I;
  s[0x463c >> 2] = 5;
  s[0x47f8 >> 2] = step;
  return s;
}
/** the per-frame tail: layer 0 redrawn, layers 1 and 3 (the ramp and the strip) hidden again */
function redraw(c: Core, s: Int32Array, hide3: boolean): void {
  s[0x44a8 >> 2] = 0;
  s[LY(1) + lf(0x910)] = -1;
  if (hide3) s[LY(3) + lf(0x910)] = -1;
  c.markLayer();
}

// ---------------------------------------------------------------- Blazing Colors (blaze.dll, 2000-06-22)
const BLAZE: PlusDll = {
  ver: 1, presets: 3, stepLayer: 1, bars: true, table: 1,
  images: (): MusicalImage[] => blazeImages(),
  program(c: Core): void {                       // 0x10016340
    var s = head(c), id = s[0x47bc >> 2];
    if (id === 1 || id === 2) {
      if (s[0x4574 >> 2] !== 0) { redraw(c, s, true); return; }
      s = setup(c, id === 1 ? 4 : 2);
      gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
      if (id === 1) {                              // Burning Dance
        ls(s, 0, [0x7e8, -1, 0x7ec, 0]);
        ls(s, 1, [0x7e8, 0x158, 0x7ec, -0x2c2]);
        ls(s, 3, [0x7e8, 0x15c, 0x7ec, 0x40]);
        ls(s, 1, [0x910, -1, 0x78c, 1, 0x790, 2, 0x118, F(-1), 0x110, F(-285), 0x944, 4]);
        ls(s, 2, [0x910, -1]);
        ls(s, 0, [0x870, 1, 0x850, 0x5d, 0x84c, 0xe9, 0x78c, 1, 0x790, 1, 0x838, 0x50]);
        ls(s, 3, [0x910, -1, 0x870, 1, 0x850, 0xea, 0x84c, 0xf4, 0x78c, 1, 0x790, 3]);
        gs(s, [0x44cc, 0xaf, 0x44c0, 5, 0x44bc, 0x3c, 0x44c8, 1, 0x44d0, 0x14]);
      } else {                                     // Firey Colors
        ls(s, 0, [0x7e8, -1, 0x7ec, 0]);
        ls(s, 1, [0x7ec, 0]);
        ls(s, 3, [0x7ec, 0]);
        ls(s, 1, [0x7e8, 0x158, 0x78c, 1, 0x790, 5, 0x118, F(-8), 0x944, 4, 0x910, -1]);
        ls(s, 2, [0x910, -1]);
        ls(s, 0, [0x870, 1, 0x850, 0x37, 0x84c, 0x100, 0x78c, 1, 0x790, 1]);
        ls(s, 3, [0x910, -1, 0x7e8, 0x15c, 0x78c, 1, 0x790, 4, 0x110, F(55), 0x870, 2, 0x850, 7, 0x84c, 0x46, 0x77c, 3]);
        gs(s, [0x44cc, 0xaf, 0x44c0, 5, 0x44bc, 0x24, 0x44c8, 6, 0x44d0, 0x14]);
      }
      return;
    }
    if (id !== 3) return;
    if (s[0x4574 >> 2] === 0) {                    // Paint Can
      s = setup(c, 3);
      gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
      ls(s, 0, [0x7e8, -1, 0x7ec, 0]);
      ls(s, 1, [0x7ec, 0]);
      ls(s, 0, [0x910, 0]);
      ls(s, 3, [0x7ec, 0, 0x850, 0]);
      ls(s, 1, [0x7e8, 0x158, 0x910, -1, 0x78c, 1, 0x790, 5, 0x118, F(8), 0x944, 4]);
      ls(s, 2, [0x910, -1]);
      ls(s, 0, [0x870, 0xc, 0x850, 0xb0, 0x84c, 200, 0x78c, 1, 0x790, 1]);
      ls(s, 3, [0x910, -1, 0x7e8, 0x15c, 0x78c, 1, 0x790, 4, 0x110, F(30), 0x870, 2, 0x84c, 0xf3, 0x77c, 3]);
      gs(s, [0x44cc, 0xaf, 0x44c0, 4, 0x44bc, 0x24, 0x44c8, 7, 0x44d0, 99]);
      return;
    }
    // the paint runs out in quiet passages: the ring (layer 3's 0x850) shrinks, the blend (0x44d0) rises, and once
    // both are spent layer 0 is hidden; a loud frame refills them
    var b3 = LY(3) + lf(0x850), r = s[b3], bl = s[0x44d0 >> 2];
    if (s[0x4414 >> 2] < 5) {
      if (0 < r) s[b3] = r - 1;
      if (bl <= 0x62) s[0x44d0 >> 2] = bl + 2;
    } else {
      if (r < 0x10) { s[LY(0) + lf(0x910)] = 0; s[b3] = r + 4; s[0x44d0 >> 2] = 99; }
      if (0 < s[0x44d0 >> 2]) s[0x44d0 >> 2]--;
    }
    s[LY(0) + lf(0x910)] = s[b3] === 0 && 0x59 < s[0x44d0 >> 2] ? -1 : 0;
    redraw(c, s, true);
  },
};

// ---------------------------------------------------------------- Pulsing Colors (Pulsing.dll, 2000)
const PULSING: PlusDll = {
  ver: 1, presets: 3, stepLayer: 0, bars: true, table: 1,
  images: (): MusicalImage[] => blazeImages(),     // the same table as Blazing Colors (DATATABLE_2, byte-identical)
  program(c: Core): void {                       // 0x10016410
    var s = head(c), id = s[0x47bc >> 2];
    if (id < 1 || id > 3) return;
    if (s[0x4574 >> 2] !== 0) { redraw(c, s, id !== 3); return; }
    s = setup(c, id === 2 ? 6 : 5);
    ls(s, 1, [0x790, 5]);
    gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
    if (id === 1) {                                // Lip Sink
      ls(s, 0, [0x7ec, 0]); ls(s, 1, [0x7ec, 0]); ls(s, 0, [0x910, 0]); ls(s, 3, [0x7ec, 0]);
      ls(s, 0, [0x7e8, -1, 0x870, 3, 0x850, 0x48, 0x84c, 0x142]);
      ls(s, 1, [0x7e8, 0x158, 0x910, -1, 0x78c, 1, 0x118, F(8), 0x944, 4]);
      ls(s, 2, [0x910, -1]);
      ls(s, 0, [0x78c, 1, 0x790, 1]);
      ls(s, 3, [0x7e8, 0x15c, 0x78c, 1, 0x790, 4, 0x77c, 3]);
      gs(s, [0x44cc, 0xb6, 0x44c0, 0x14, 0x44bc, 0x50, 0x44c8, 8, 0x44d0, 10]);
    } else if (id === 2) {                         // Musical Island
      ls(s, 0, [0x7ec, 0, 0x870, 0]); ls(s, 1, [0x7ec, 0]); ls(s, 0, [0x910, 0]); ls(s, 3, [0x7ec, 0]);
      gs(s, [0x44d0, 0]);
      ls(s, 0, [0x7e8, -1, 0x850, 6, 0x84c, 0xff]);
      ls(s, 1, [0x7e8, 0x158, 0x910, -1, 0x78c, 1, 0x118, F(1), 0x944, 4]);
      ls(s, 2, [0x910, -1]);
      ls(s, 0, [0x78c, 1, 0x790, 1]);
      ls(s, 3, [0x910, -1, 0x7e8, 0x15c, 0x78c, 1, 0x790, 4, 0x77c, 3]);
      gs(s, [0x44cc, 0xb4, 0x44c0, 9, 0x44bc, 0x46, 0x44c8, 8]);
    } else {                                       // Steel Rhythm
      ls(s, 0, [0x7ec, 0]); ls(s, 1, [0x7ec, 0]); ls(s, 3, [0x7ec, 0]);
      ls(s, 0, [0x7e8, -1]);
      ls(s, 1, [0x7e8, 0x158, 0x910, -1, 0x78c, 1, 0x118, F(8), 0x944, 4]);
      ls(s, 2, [0x910, -1]);
      ls(s, 0, [0x78c, 1, 0x790, 1, 0x870, 3, 0x850, 0x10, 0x84c, 0x6f]);
      ls(s, 3, [0x7e8, 0x15c, 0x78c, 1, 0x790, 4, 0x77c, 3]);
      gs(s, [0x44cc, 0xb4, 0x44c0, 0x14, 0x44bc, 0x3c, 0x44c8, 8, 0x44d0, 10]);
    }
  },
};

// ---------------------------------------------------------------- Color Cubes (ColorCub.dll, 2000-06-25)
// Up to 50 cube sprites (layers 2..51, images of DATATABLE_3 at table index 2) placed in depth, each recoloured every
// frame from layer 1's colour ramp by a spectrum bin. Fields of its own (no wmpvis.dll counterpart), kept past
// wmpvis.dll's object: the bin offset the squares follow (rerolled every so often) and the frame counter for that.
const CC_TARGET = 0x4f40, CC_COUNT = 0x4f44;
/** layer / transform stores: [layer, field, value, ...] (raw 32-bit values; floats as their bits) */
function lks(s: Int32Array, t: number[]): void {
  for (var i = 0; i < t.length; i += 3) {
    var k = t[i], f = t[i + 1];
    if (f >= 0x76c) s[LY(k) + lf(f)] = t[i + 2];
    else s[XF(k) + xf(f)] = t[i + 2];
  }
}
/** the sprites k = 2..last-1: images ix, ix+1, ... of table 2 at the origin, unblended (0x910 = -1); then `after` */
function cubes(c: Core, last: number, ix: number, after: (k: number) => void): void {
  for (var k = 2; k < last; k++) {
    var s = c.m.I;
    s[0x44a8 >> 2] = k;
    ls(s, k, [0x78c, 2, 0x790, ix++, 0x7e8, 0, 0x7ec, 0, 0x808, 0, 0x76c, 2, 0x7e4, -1, 0x910, -1]);
    after(k);
  }
  c.m.I[0x44a8 >> 2] = last;
}
/** each sprite's image without alpha (& 0xffffff), w * h pixels, or one more when `over` (the DLL's <= loop) */
function opaque(c: Core, last: number, over: boolean): void {
  for (var k = 2; k < last; k++) {
    var s = c.m.I;
    s[0x44a8 >> 2] = k;
    if (c.bindImage() === 0) continue;
    s = c.m.I;
    var b = LY(k), p = s[b + lf(0x794)] >> 2, n = Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f4)]), i = 0;
    if (over) { if (n >= 0) for (; i <= n; i++) c.m.U[p + i] &= 0xffffff; }
    else for (; i < n; i++) c.m.U[p + i] &= 0xffffff;
    s[0x43ec >> 2] = (p + i) << 2;
    s[0x45cc >> 2] = i;
  }
  c.m.I[0x44a8 >> 2] = last;
}
/** layer `k`'s image or the work buffer it selects (into obj+0x43ec) */
function source(s: Int32Array, k: number): number {
  var b = LY(k), sel = s[b + lf(0x824)];
  var p = sel === 1 ? s[b + lf(0x828)] : sel === 2 ? s[b + lf(0x90c)] : s[b + lf(0x794)];
  s[0x43ec >> 2] = p;
  return p;
}
/** sprite k's pixels := colour, alpha kept; dirty 2 */
function paint(c: Core, k: number, colour: number): void {
  var s = c.m.I, U = c.m.U, b = LY(k), p = s[b + lf(0x794)] >> 2;
  s[0x4c50 >> 2] = colour;
  var n = Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f4)]), i = 0;
  s[0x4ec4 >> 2] = n;
  s[b + lf(0x77c)] = 2;
  for (; i < n; i++) U[p + i] = ((U[p + i] & 0xff000000) | colour) >>> 0;
  s[0x4ee8 >> 2] = i;
  s[0x4390 >> 2] = (p + i) << 2;
}
/** the bin a sprite follows: k + 3 + the target offset, wrapped into 3..60, times 3 */
function follow(s: Int32Array, k: number): number {
  var q = k + 3 + s[CC_TARGET >> 2];
  if (q > 0x3c) q -= 0x32;
  s[0x45cc >> 2] = q;
  return s[(0x1740 >> 2) + q * 3];
}
/** a Color Cubes preset's first frame: set up, 352 x 320 canvas, n layers, the camera at the origin */
function setupCubes(c: Core, n: number): Int32Array {
  var s = c.m.I;
  s[0x4574 >> 2] = 1;
  c.canvasPlus();
  s = c.m.I;
  s[0x463c >> 2] = n;
  gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
  return s;
}
const SCALE = Math.fround(0.003921568859368563);

const COLORCUB: PlusDll = {
  ver: 1, presets: 3, stepLayer: 1, bars: false, table: 2,
  // wmpvis.dll's own default layers (images on table 0, so none binds)
  scene: PLUS_SCENE.map((t, k) => t.map((v, i) => (i & 1 && t[i - 1] === 0x78c ? 0 : i & 1 && t[i - 1] === 0x790 ? [1, 4, 10, 0xb, 0x23, 5][k] : v))),
  images: (): MusicalImage[] => colorCubesImages(),
  program(c: Core): void {                       // 0x10015ae0
    var s = c.m.I, k: number, v: number, src: number;
    if (s[0x4574 >> 2] === 0) {
      s[0x4458 >> 2] = 0;
      c.defaultScene();
      s = c.m.I;
      s[0x47f8 >> 2] = 1;
      s[LY(2) + lf(0x910)] = 0;
      s[0x457c >> 2] = 1;
    }
    var id = s[0x47bc >> 2];
    if (id === 2) {                                // Rhythmic Squares
      if (s[0x4574 >> 2] !== 0) {
        for (k = 2; k < 0x34; k++) ls(s, k, [0x850, 9, 0x84c, 100, 0x76c, 2]);
        s[0x44a8 >> 2] = 0x34;
        if (s[CC_COUNT >> 2] > 0x32) { s[CC_TARGET >> 2] = A.rand() & 0x1f; s[CC_COUNT >> 2] = 0; }
        s[CC_COUNT >> 2]++;
        src = source(s, 1);                        // vt+0x114 0x10015570
        for (k = 2; k < 0x34; k++) {
          s[0x44a8 >> 2] = k;
          s[0x4390 >> 2] = s[LY(k) + lf(0x794)];
          var px = c.m.U[src >> 2];
          s[0x4c50 >> 2] = px;
          v = follow(s, k);
          if (s[0x4414 >> 2] < 5) { s[LY(k) + lf(0x910)] = -1; continue; }
          s[LY(k) + lf(0x910)] = 0;
          s[0x4e78 >> 2] = v;
          var sc = (v * 2 + 0x5a) * SCALE;           // x87: compared unrounded, stored as a float
          c.m.F[0x4724 >> 2] = sc > 1 ? 1 : sc;
          var f = c.m.F[0x4724 >> 2];
          var bl = ftol((px & 0xff) * f), gr = ftol(((px >>> 8) & 0xff) * f), rd = ftol(((px >>> 16) & 0xff) * f);
          s[0x4c40 >> 2] = bl; s[0x4d44 >> 2] = gr; s[0x4dd0 >> 2] = rd;
          paint(c, k, ((rd << 16) | (gr << 8) | bl) & 0xffffff);
          s = c.m.I;
        }
        s[0x44a8 >> 2] = 0x34;
        return;
      }
      s = setupCubes(c, 0x34);
      gs(s, [0x44bc, 0, 0x44c0, 3, 0x44d0, 0x1e, 0x44d4, 0]);
      ls(s, 0, [0x910, -1, 0x76c, -1]);
      s[0x457c >> 2] = 0;
      cubes(c, 0x34, 1, (kk) => { c.bindImage(); ls(c.m.I, kk, [0x77c, 3, 0x850, 0x1e, 0x84c, 100, 0x94c, 1]); });
      ls(c.m.I, 0x32, [0x790, 0x33]);
      opaque(c, 0x33, true);
      lks(c.m.I, RS);
      s = c.m.I;
      s[CC_TARGET >> 2] = A.rand() & 0x3f;
      s[CC_COUNT >> 2] = 0;
      return;
    }
    if (id === 1) {                                // Flower Boxes
      if (s[0x4574 >> 2] !== 0) {
        for (k = 2; k < 0x16; k++) ls(s, k, [0x850, 0x11]);
        for (k = 2; k < 0x17; k++) {               // vt+0x11c 0x10015950
          s[0x44a8 >> 2] = k;
          src = source(s, 1);
          var img = s[LY(k) + lf(0x794)];
          s[0x4390 >> 2] = img;
          if (img === 0 || src === 0) return;
          if (s[0x4414 >> 2] < 5) { s[LY(k) + lf(0x910)] = -1; continue; }
          s[LY(k) + lf(0x910)] = 0;
          v = k === 0x16 ? s[0x4414 >> 2] : s[(0x1740 >> 2) + k + 50];
          s[0x4e78 >> 2] = v;
          paint(c, k, c.m.U[((src + Math.imul(s[LY(1) + lf(0x7f4)], v) * 4) | 0) >> 2]);
          s = c.m.I;
        }
        s[0x44a8 >> 2] = 0x17;
        return;
      }
      s = setupCubes(c, 0x17);
      c.m.F[XF(2) + xf(0x144)] = 0;
      gs(s, [0x44bc, 0, 0x44c0, 0, 0x44d0, 0, 0x44d4, 0]);
      s[0x457c >> 2] = 0;
      ls(s, 0, [0x910, -1, 0x76c, -1]);
      cubes(c, 0x17, 0x33, (kk) => { ls(c.m.I, kk, [0x94c, 0]); });
      lks(c.m.I, FB_PRE);
      opaque(c, 0x17, false);
      s = c.m.I;
      for (k = 2; k < 0x16; k++) ls(s, k, [0x77c, 3, 0x850, 0x2a, 0x84c, 0xfa]);
      s[0x44a8 >> 2] = 0x16;
      lks(s, FB);
      return;
    }
    if (id !== 3) return;                          // (the DLL jumps into Flower Boxes' setup loop here; no preset has it)
    if (s[0x4574 >> 2] === 0) {                    // Sheer Delight
      s = setupCubes(c, 0x34);
      gs(s, [0x44bc, 0, 0x44c0, 10, 0x44d0, 0x50, 0x44d4, 0]);
      s[0x457c >> 2] = 0;
      cubes(c, 0x34, 1, (kk) => { c.bindImage(); ls(c.m.I, kk, [0x77c, 3, 0x850, 0x28, 0x84c, 100]); });
      s = c.m.I;
      ls(s, 0x32, [0x790, 0x33]);
      ls(s, 0x13, [0x790, 0x47]);
      opaque(c, 0x33, true);
      lks(c.m.I, SD1);
      c.m.F[XF(0) + xf(0x110)] = A.rand() & 0x7f;
      lks(c.m.I, SD2);
      s = c.m.I;
      s[CC_TARGET >> 2] = 0;
      s[CC_COUNT >> 2] = 0;
      return;
    }
    for (k = 2; k < 0x34; k++) ls(s, k, [0x850, 2, 0x84c, 200]);
    s[0x44a8 >> 2] = 0x34;
    if (s[CC_COUNT >> 2] > 100) { s[CC_TARGET >> 2] = A.rand() & 0x3f; s[CC_COUNT >> 2] = 0; }
    s[CC_COUNT >> 2]++;
    src = source(s, 1);                            // vt+0x118 0x100157b0
    for (k = 2; k < 0x34; k++) {
      s[0x44a8 >> 2] = k;
      s[0x4390 >> 2] = s[LY(k) + lf(0x794)];
      v = follow(s, k);
      if (s[0x4414 >> 2] < 5) { s[LY(k) + lf(0x910)] = -1; continue; }
      s[LY(k) + lf(0x910)] = 0;
      s[0x4e78 >> 2] = v;
      paint(c, k, v < 5 ? v * 10 + 0x60c39 : c.m.U[((src + Math.imul(s[LY(1) + lf(0x7f4)], v) * 4) | 0) >> 2]);
      s = c.m.I;
    }
    s[0x44a8 >> 2] = 0x34;
    var bg = source(s, 0);                         // the background follows layer 0's first pixel while there is sound
    s[0x4458 >> 2] = s[0x4414 >> 2] > 4 ? c.m.I[bg >> 2] : 0;
  },
};
// the presets' sprite positions and other layers' setups (0x10015ae0; [layer, field, value, ...], floats as bits)
const RS = [1, 0x910, -0x1, 1, 0x76c, 0x2, 1, 0x7e8, 0x157, 1, 0x7ec, 0x0, 1, 0x808, 0x0, 1, 0x78c, 0x2, 1, 0x790, 0x49,
  1, 0x118, -0x40800000, 1, 0x944, 0x4, 2, 0x7e8, 0xda, 2, 0x808, -0x54, 2, 0x114, 0x0, 2, 0x118, 0x0, 3, 0x7e8, 0xc2,
  3, 0x808, -0x14, 4, 0x7e8, 0xda, 4, 0x808, -0xa0, 5, 0x7e8, 0xe8, 5, 0x808, -0xf, 6, 0x7e8, 0x108, 6, 0x808, -0x35,
  7, 0x7e8, 0x100, 7, 0x808, -0x20, 8, 0x7e8, 0x100, 8, 0x808, -0xd1, 9, 0x7e8, 0xda, 9, 0x808, -0xb5, 10, 0x7e8, 0xe9,
  10, 0x7ec, -0x28, 10, 0x808, -0xc1, 11, 0x7e8, 0x118, 11, 0x808, -0x65, 12, 0x7e8, 0x140, 12, 0x808, -0x81,
  13, 0x7e8, 0x118, 13, 0x808, -0x81, 14, 0x7e8, 0xbb, 14, 0x808, -0x64, 15, 0x7e8, 0x114, 19, 0x808, -0xd2,
  20, 0x808, -0xd2, 15, 0x808, -0xde, 16, 0x7e8, 0xe9, 16, 0x7ec, -0x2a, 16, 0x808, -0xb4, 17, 0x7e8, 0xc5,
  17, 0x808, -0x105, 18, 0x7e8, 0xc9, 18, 0x808, -0x5f, 19, 0x7e8, 0x76, 20, 0x7e8, 0xbe, 21, 0x7e8, 0xe9,
  21, 0x808, -0x73, 22, 0x7e8, 0xac, 22, 0x808, -0x42, 23, 0x7e8, 0xb2, 23, 0x808, -0x89, 24, 0x7e8, 0x98,
  24, 0x808, -0x3f, 25, 0x7e8, 0x7b, 25, 0x808, -0x82, 26, 0x7e8, 0x65, 26, 0x808, -0x52, 27, 0x7e8, 0x4c,
  27, 0x808, -0x121, 28, 0x7e8, 0x14, 28, 0x808, -0x18, 29, 0x7e8, 0x7a, 29, 0x7ec, -0x4e, 29, 0x808, -0x5b,
  30, 0x7e8, 0x1e, 30, 0x808, -0xfb, 31, 0x7e8, 0x19, 31, 0x808, -0x117, 32, 0x7e8, 0x113, 32, 0x808, -0xde,
  33, 0x7e8, 0x12, 33, 0x808, -0xc, 34, 0x7e8, 0x12, 34, 0x808, -0x5c, 35, 0x7e8, 0x9b, 35, 0x7ec, -0x15,
  35, 0x808, -0xfc, 36, 0x7e8, 0xcd, 36, 0x7ec, -0x3c, 36, 0x808, -0x13f, 37, 0x7e8, 0x2b, 37, 0x808, -0xe,
  38, 0x7e8, 0x12, 38, 0x808, -0xd4, 39, 0x7e8, 0x12, 39, 0x7ec, -0x4e, 39, 0x808, -0x128, 40, 0x7e8, 0x64,
  40, 0x808, -0x14, 41, 0x7e8, 0x12, 41, 0x808, -0x7b, 42, 0x7e8, 0x12, 42, 0x808, -0x7e, 43, 0x7e8, 0x51,
  43, 0x7ec, -0x65, 43, 0x808, -0x147, 44, 0x7e8, 0x3a, 44, 0x808, -0x37, 45, 0x7e8, 0x114, 45, 0x7ec, -0x74,
  45, 0x808, -0x87, 46, 0x7e8, 0x19, 46, 0x808, -0xc4, 47, 0x7e8, 0x22, 47, 0x808, -0x97, 48, 0x7e8, 0x22,
  48, 0x808, -0xa2, 49, 0x7e8, 0x2c, 49, 0x7ec, -0x4e, 49, 0x808, -0x95, 50, 0x7e8, 0x22, 50, 0x7ec, -0x4e,
  50, 0x808, -0xe0, 51, 0x7e8, 0x70, 51, 0x7ec, -0x72, 51, 0x808, -0x109, 51, 0x790, 0x1];
const FB_PRE = [22, 0x78c, 0x2, 22, 0x790, 0x4e, 22, 0x7e8, 0x49, 22, 0x7ec, -0xc8, 22, 0x808, -0x102];
const FB = [22, 0x77c, 0x3, 22, 0x950, 0x3, 22, 0x850, 0x64, 22, 0x84c, 0xaa, 22, 0x94c, 0x1, 1, 0x910, -0x1, 1, 0x76c, 0x2,
  1, 0x7e8, 0x157, 1, 0x7ec, 0x0, 1, 0x808, 0x0, 1, 0x78c, 0x2, 1, 0x790, 0x4c, 1, 0x118, -0x3ef00000, 1, 0x944, 0x4,
  1, 0x77c, 0x3, 2, 0x7e8, 0x106, 2, 0x808, -0x77, 2, 0x114, 0x0, 2, 0x118, 0x0, 3, 0x7e8, 0xfa, 3, 0x808, -0x94,
  4, 0x7e8, 0xe8, 4, 0x808, -0xb3, 5, 0x7e8, 0xce, 5, 0x808, -0xcc, 6, 0x7e8, 0xaa, 6, 0x808, -0xe0, 7, 0x7e8, 0x87,
  7, 0x808, -0xed, 8, 0x7e8, 0x60, 8, 0x808, -0xe0, 9, 0x7e8, 0x40, 9, 0x808, -0xcc, 18, 0x7e8, 0xaa, 10, 0x7e8, 0x25,
  10, 0x808, -0xb3, 11, 0x7e8, 0x11, 11, 0x808, -0x94, 12, 0x7e8, 0x7, 12, 0x808, -0x77, 13, 0x7e8, 0x11, 13, 0x808, -0x5c,
  14, 0x7e8, 0x25, 14, 0x808, -0x39, 15, 0x7e8, 0x40, 15, 0x808, -0x1e, 16, 0x7e8, 0x60, 16, 0x808, -0x11, 17, 0x7e8, 0x87,
  17, 0x808, -0x4, 18, 0x7ec, -0x2, 18, 0x808, -0x13, 19, 0x7e8, 0xce, 19, 0x7ec, -0x2, 19, 0x808, -0x26, 20, 0x7e8, 0xe8,
  20, 0x7ec, -0x2, 20, 0x808, -0x3f, 21, 0x7e8, 0xfa, 21, 0x7ec, -0x2, 21, 0x808, -0x57];
const SD1 = [0, 0x910, -0x1, 0, 0x76c, 0x2, 0, 0x7e8, 0x15b, 0, 0x7ec, 0x0, 0, 0x808, -0x40, 0, 0x78c, 0x2, 0, 0x790, 0x4b,
  0, 0x118, -0x41666666];
const SD2 = [0, 0x944, 0x4, 0, 0x77c, 0x3, 1, 0x910, -0x1, 1, 0x76c, 0x2, 1, 0x7e8, 0x157, 1, 0x7ec, 0x0, 1, 0x808, 0x2c6,
  1, 0x78c, 0x2, 1, 0x790, 0x4a, 1, 0x118, -0x40800000, 1, 0x944, 0x4, 1, 0x77c, 0x3, 2, 0x7e8, 0x14c, 2, 0x808, -0x132,
  2, 0x114, 0x0, 2, 0x118, 0x0, 3, 0x7e8, 0x131, 3, 0x808, -0x12b, 4, 0x7e8, 0x124, 4, 0x808, -0x11c, 5, 0x7e8, 0xfc,
  5, 0x808, -0x129, 6, 0x7e8, 0xe5, 6, 0x808, -0x111, 7, 0x7e8, 0xcb, 7, 0x7ec, -0xae, 7, 0x808, -0xfe, 8, 0x7e8, 0xc8,
  8, 0x808, -0xff, 9, 0x7e8, 0xa0, 9, 0x808, -0xf1, 10, 0x7e8, 0xf5, 10, 0x7ec, 0x26, 10, 0x808, -0xe7, 11, 0x7e8, 0xb3,
  11, 0x808, -0xe7, 12, 0x7e8, 0xc4, 12, 0x808, -0xf9, 13, 0x7e8, 0x8c, 13, 0x808, -0xfa, 14, 0x7e8, 0x1, 14, 0x808, -0x11c,
  15, 0x7e8, 0xb, 15, 0x808, -0x131, 16, 0x7e8, 0x16, 16, 0x808, -0x12a, 17, 0x7e8, 0x53, 17, 0x7ec, 0x58, 17, 0x808, -0xdf,
  18, 0x7e8, 0x0, 18, 0x808, -0x121, 19, 0x7e8, 0x17, 19, 0x7ec, 0x14, 19, 0x808, -0xab, 20, 0x7e8, 0x64, 20, 0x808, -0x11d,
  21, 0x7e8, 0x64, 21, 0x808, -0x12a, 22, 0x7e8, 0x6e, 22, 0x7ec, 0xa, 22, 0x808, -0xfc, 23, 0x7e8, 0x65, 23, 0x7ec, -0xab,
  23, 0x808, -0x1ad, 24, 0x7e8, 0x23, 24, 0x7ec, -0x75, 24, 0x808, -0x177, 25, 0x7e8, 0x43, 25, 0x7ec, -0xa1,
  25, 0x808, -0x194, 26, 0x7e8, 0x5e, 26, 0x7ec, -0x95, 26, 0x808, -0x167, 27, 0x7e8, 0x66, 27, 0x808, -0xc8, 28, 0x7e8, 0x96,
  28, 0x7ec, -0x60, 28, 0x808, -0x13b, 29, 0x7e8, 0xc0, 29, 0x7ec, -0x91, 29, 0x808, -0x140, 30, 0x7e8, 0xa3, 30, 0x7ec, -0x28,
  30, 0x808, -0xd0, 31, 0x7e8, 0x2d, 31, 0x7ec, -0x85, 31, 0x808, -0x16a, 32, 0x7e8, 0x110, 32, 0x7ec, -0xc4,
  32, 0x808, -0x19d, 33, 0x7e8, 0x34, 33, 0x7ec, -0xd3, 33, 0x808, -0x18d, 34, 0x7e8, 0xd7, 34, 0x808, -0x8a,
  35, 0x7e8, 0x116, 35, 0x7ec, -0xd0, 35, 0x808, -0x1b3, 36, 0x7e8, 0xb, 36, 0x7ec, -0xab, 36, 0x808, -0x19e,
  37, 0x7e8, 0x10c, 37, 0x7ec, -0xab, 37, 0x808, -0x184, 38, 0x7e8, 0x0, 38, 0x7ec, -0xc5, 38, 0x808, -0x1a3, 39, 0x7e8, 0x3c,
  39, 0x7ec, -0x124, 39, 0x808, -0x1bb, 40, 0x7e8, 0x12d, 40, 0x7ec, -0xf4, 40, 0x808, -0x1ae, 41, 0x7e8, 0x39,
  41, 0x7ec, -0xd6, 41, 0x808, -0x181, 42, 0x7e8, 0x100, 42, 0x7ec, -0x100, 42, 0x808, -0x15b, 43, 0x7e8, 0x56,
  43, 0x7ec, -0x160, 43, 0x808, -0x1c5, 44, 0x7e8, 0x109, 44, 0x808, -0xb5, 45, 0x7e8, 0x1a, 45, 0x7ec, -0x178,
  45, 0x808, -0x1e4, 46, 0x7e8, 0xe0, 46, 0x7ec, -0xf8, 46, 0x808, -0x153, 47, 0x7e8, 0x10, 47, 0x7ec, -0x138,
  47, 0x808, -0x19a, 48, 0x7e8, 0x101, 48, 0x7ec, -0x187, 48, 0x808, -0x222, 49, 0x7e8, 0x6, 49, 0x7ec, -0x226,
  49, 0x808, -0x2cc, 50, 0x7e8, 0x10f, 50, 0x7ec, -0x4e, 50, 0x808, -0x98, 51, 0x7e8, 0x76, 51, 0x7ec, -0x3, 51, 0x808, -0x43,
  51, 0x78c, 0x2, 51, 0x790, 0x1];

// ---------------------------------------------------------------- Trilogy I, II, III (2001, "Le Software")
// The 2001 build (core.ts `ver` 2): DATATABLE_10 at table index 9, four layers, mirrored strips (step 5), the layers'
// spins scaled by the measured frames per second (TR_FPS, from timeGetTime), and a fourth preset, Random Selection,
// that switches between the other three. The presets' ids are 1..3 (each DLL's program also carries unreachable
// cases 10..80 of other presets, not ported).
/** SetCurrentPreset (Trilogy I 0x10010630): the last preset turns Random Selection on, the others set the id */
function trilogyPreset(c: Core, n: number): void {
  var s = c.m.I;
  if (n === 3) { s[TR_RCOUNT >> 2] = 0; s[TR_RANDOM >> 2] = 1; }
  else { s[TR_RANDOM >> 2] = 0; s[0x47bc >> 2] = n + 1; }
  s[0xc >> 2] = n;
}
/** a Trilogy preset's first frame: set up, 352 x 320 canvas, four layers, the camera at the origin, bars mirrored
 *  (0x44c8 = 8) from mirrored strips */
function setupTrilogy(c: Core, g: number[]): Int32Array {
  var s = c.m.I;
  s[0x4574 >> 2] = 1;
  c.canvasPlus();
  s = c.m.I;
  s[0x463c >> 2] = 4;
  gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0, 0x44c8, 8]);
  gs(s, g);
  s[0x47f8 >> 2] = 5;
  return s;
}
/** the presets' common tail: layer 1's scroll starts at a random row (0..127) */
function scrollStart(c: Core, s: Int32Array): void {
  var r = A.rand();
  ls(s, 1, [0x118, F(3)]);
  c.m.F[XF(1) + xf(0x110)] = r & 0x7f;
}
/** layer 3, the strip, and the frame counter */
function stripLayer(c: Core): void {
  var s = c.m.I;
  ls(s, 3, [0x7e8, 0x15b, 0x7ec, 0x46, 0x808, 0x47, 0x78c, 9, 0x790, 3, 0x7e4, -1, 0x910, -1, 0x77c, 2]);
  s[0x44a8 >> 2] = 3;
  c.bindImage();
  c.m.I[TR_COUNT >> 2] = 0;
}
/** f = frames per second + 1 (a float), as the speeds divide by it */
const fps1 = (s: Int32Array): number => Math.fround(s[TR_FPS >> 2] + 1);
/** the frame counter's period: (fps + 1) * n / 3 frames */
const period = (s: Int32Array, n: number): number => ((s[TR_FPS >> 2] + 1) * n / 3) | 0;
/** Pulsar's set up (Trilogy I id 1); Trilogy II's Musical Sine adds layer 2's `extra` */
function pulsar(c: Core, extra: number[]): void {
  var s = setupTrilogy(c, [0x44bc, 0x28, 0x44c0, 5, 0x44cc, 0xae, 0x44d0, 0]);
  ls(s, 1, [0x910, -1]); ls(s, 3, [0x910, -1]); ls(s, 4, [0x910, -1]);
  s[0x44d4 >> 2] = 4;
  ls(s, 4, [0x76c, -1]); ls(s, 5, [0x910, -1, 0x76c, -1]);
  ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x43, 0x84c, 0xfa, 0x7e8, 0, 0x7ec, 2, 0x808, 2]);
  ls(s, 1, [0x78c, 9, 0x790, 5, 0x7e8, 0x154, 0x7ec, 0x46, 0x808, 7]);
  s[0x44c4 >> 2] = 0;
  ls(s, 1, [0xe4, F(1)]);
  scrollStart(c, s);
  ls(s, 2, [0xec, F(2), 0x88c, 0x32]);
  ls(s, 2, [0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0xe4, F(6), 0xe0, F(180), 0x114, 0, 0x118, 0, 0x144, 0, 0x890, 0, 0x884, 0]);
  ls(s, 2, extra);
  stripLayer(c);
}
/** Trilogy I's Pulsar / II's Musical Sine per frame: the scroll and layer 2's two spins */
function pulsarFrame(c: Core, s: Int32Array): void {
  s[0x44a8 >> 2] = 0; c.markLayer();
  var f = fps1(s), F_ = c.m.F;
  F_[XF(1) + xf(0x118)] = 12 / f;
  F_[XF(2) + xf(0xe4)] = 24 / f;
  F_[XF(2) + xf(0xec)] = 8 / f;
}
/** the hidden layers every Trilogy II / III preset starts with (layer 2 and 3 as `h2`, `h3`) */
function hides(s: Int32Array, h2: boolean, h3: boolean): void {
  ls(s, 1, [0x910, -1]);
  if (h3) ls(s, 3, [0x910, -1]);
  if (h2) ls(s, 2, [0x910, -1, 0x76c, -1]);
  ls(s, 4, [0x910, -1, 0x76c, -1]); ls(s, 5, [0x910, -1, 0x76c, -1]);
}
const SCROLL = [0x78c, 9, 0x790, 5, 0x7e8, 0x154, 0x7ec, 0x46, 0x808, 7];

const TRILOGY1: PlusDll = {
  ver: 2, presets: 4, stepLayer: 0, bars: true, table: 9,
  scene: PLUS_SCENE.map((t, k) => t.map((v, i) => (i & 1 && t[i - 1] === 0x78c ? 9 : i & 1 && t[i - 1] === 0x790 ? 4 : i & 1 && t[i - 1] === 0x808 && k === 1 ? 9 : v))),
  setPreset: trilogyPreset,
  images: (): MusicalImage[] => trilogyImages(),
  program(c: Core): void {                       // 0x10017fc0 (ids 1..3)
    var s = head(c), id = s[0x47bc >> 2], F_ = c.m.F, f: number;
    if (id === 1) {                                // Pulsar
      if (s[0x4574 >> 2] !== 0) { pulsarFrame(c, s); return; }
      pulsar(c, []);
      return;
    }
    if (id === 2) {                                // Wings
      if (s[0x4574 >> 2] !== 0) {
        s[0x44a8 >> 2] = 0; c.markLayer();
        f = fps1(s);
        F_[XF(1) + xf(0x118)] = 12 / f;
        F_[XF(0) + xf(0xe4)] = 40 / f;
        F_[XF(0) + xf(0xec)] = 8 / f;
        return;
      }
      s = setupTrilogy(c, [0x44bc, 0x28, 0x44c0, 3, 0x44cc, 0xae, 0x44d0, 0]);
      ls(s, 1, [0x910, -1]); ls(s, 3, [0x910, -1]); ls(s, 2, [0x910, -1, 0x76c, -1]); ls(s, 4, [0x910, -1, 0x76c, -1]);
      ls(s, 5, [0x910, -1, 0x76c, -1]);
      ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x6c, 0x84c, 0xfa, 0x7e8, 0, 0x7ec, 2, 0x808, 2, 0x884, 0]);
      ls(s, 1, [0x78c, 9, 0x790, 5, 0x7e8, 0x154, 0x7ec, 0x46, 0x808, 7]);
      gs(s, [0x44c4, 0, 0x44d4, 0]);
      ls(s, 0, [0xcc, 0, 0xd0, 0x3f9851ec, 0x8e0, 0x46, 0x8d4, 0, 0x8d8, 1, 0x88c, 0, 0x890, 0, 0xe4, F(10), 0xec, F(2), 0xe0, F(180)]);
      ls(s, 1, [0xe4, F(1)]);
      scrollStart(c, s);
      ls(s, 2, [0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0x114, 0, 0x118, 0, 0x144, 0, 0x910, -1]);
      stripLayer(c);
      return;
    }
    if (id !== 3) return;
    if (s[0x4574 >> 2] === 0) {                    // Twirling
      s = setupTrilogy(c, [0x44bc, 0x28, 0x44c0, 0, 0x44cc, 0xae, 0x44d0, 0x14]);
      ls(s, 1, [0x910, -1]); ls(s, 3, [0x910, -1]); ls(s, 2, [0x910, -1, 0x76c, -1]); ls(s, 4, [0x910, -1, 0x76c, -1]);
      ls(s, 5, [0x910, -1, 0x76c, -1]);
      ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x32, 0x84c, 0xfa, 0x7e8, 0, 0x7ec, 2, 0x808, 2, 0x884, 100, 0x948, 2, 0x8fc, 1]);
      ls(s, 1, [0x78c, 9, 0x790, 5, 0x7e8, 0x154, 0x7ec, 0x46, 0x808, 7]);
      gs(s, [0x44c4, 0, 0x44d4, 0]);
      ls(s, 0, [0xcc, F(1), 0xd0, F(5), 0x8e0, 0x46, 0x8d4, 2, 0x8d8, 1, 0x88c, 0, 0x890, 0x32, 0xe4, F(1), 0xec, F(2),
        0xe0, F(180), 0xd4, 0x3e570a3d, 0x8f8, 1]);
      ls(s, 1, [0xe4, F(1)]);
      scrollStart(c, s);
      ls(s, 2, [0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0x114, 0, 0x118, 0, 0x144, 0, 0x910, -1]);
      stripLayer(c);
      return;
    }
    s[0x44a8 >> 2] = 0; c.markLayer();
    f = fps1(s);
    F_[XF(1) + xf(0x118)] = 12 / f;
    F_[XF(0) + xf(0xe4)] = 4 / f;
    F_[XF(0) + xf(0xec)] = 8 / f;
    var a = ftol(F_[XF(0) + xf(0xe0)]);           // at 90 and 270 degrees the wave's x amplitude toggles 1 / 0
    if (a !== 270 && a !== 90) return;
    s[XF(0) + xf(0xcc)] = s[XF(0) + xf(0xcc)] !== F(1) ? F(1) : 0;
  },
};

/** Trilogy II: Trilogy I's engine and scene, its own program (0x10017fd0) */
const TRILOGY2: PlusDll = {
  ...TRILOGY1,
  program(c: Core): void {
    var s = head(c), id = s[0x47bc >> 2], F_ = c.m.F, f: number, n: number;
    if (id === 1) {                                // Musical Sine: Pulsar with layer 2's wave on
      if (s[0x4574 >> 2] !== 0) { pulsarFrame(c, s); return; }
      pulsar(c, [0x8d4, 0, 0x8d8, 1, 0x8e0, 0x4c, 0xcc, 0, 0xd0, 0x40970a3d]);
      return;
    }
    if (id === 2) {                                // 4th Dimension
      if (s[0x4574 >> 2] === 0) {
        s = setupTrilogy(c, [0x44bc, 0x14, 0x44c0, 5, 0x44cc, 0xae, 0x44d0, 0, 0x44d4, 4]);
        hides(s, false, true);
        ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x43, 0x84c, 0xfa, 0x7e8, 0, 0x7ec, 2, 0x808, 2]);
        ls(s, 1, SCROLL);
        ls(s, 1, [0xe4, F(1)]);
        scrollStart(c, s);
        ls(s, 2, [0x88c, 0x14, 0x890, 0x14, 0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0xe0, F(180), 0x114, 0, 0x118, 0,
          0x144, 0, 0x884, 0x46, 0xd4, 0x3db851ec]);
        stripLayer(c);
        return;
      }
      s[0x44a8 >> 2] = 0; c.markLayer();
      f = fps1(s);
      F_[XF(2) + xf(0xe4)] = 4 / f;
      n = ++s[TR_COUNT >> 2];
      F_[XF(1) + xf(0x118)] = 12 / f;
      if (period(s, 0x5a) > n) return;
      s[TR_COUNT >> 2] = 0;                        // every 30 s layer 2's wave speed steps 0.09 / -0.05 / -0.03 at random
      var d = XF(2) + xf(0xd4), v = s[d];
      if (v === 0x3db851ec) s[d] = (A.rand() & 1) === 0 ? -0x42b33333 : -0x430a3d71;
      else if (v === -0x42b33333) s[d] = (A.rand() & 1) !== 0 ? -0x430a3d71 : 0x3db851ec;
      else if (v === -0x430a3d71) s[d] = (A.rand() & 1) === 0 ? -0x42b33333 : 0x3db851ec;
      return;
    }
    if (id !== 3) return;
    if (s[0x4574 >> 2] === 0) {                    // Mathical Music
      s = setupTrilogy(c, [0x44bc, 0x37, 0x44c0, 0, 0x44cc, 0xae, 0x44d0, 0, 0x44d4, 0]);
      hides(s, false, true);
      ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x34, 0x84c, 200, 0x7e8, 0, 0x7ec, 2, 0x808, 2, 0x910, -1]);
      ls(s, 1, SCROLL);
      ls(s, 1, [0xe4, F(1)]);
      scrollStart(c, s);
      ls(s, 2, [0x88c, 0x14, 0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0xe4, F(1), 0xe0, F(180), 0x114, 0, 0x118, 0,
        0x144, 0, 0x890, 0x14, 0x894, 1, 0xd4, -0x42333333, 0x8fc, 1]);
      stripLayer(c);
      return;
    }
    f = fps1(s);
    F_[XF(2) + xf(0xe4)] = 4 / f;
    s[0x44a8 >> 2] = 0; c.markLayer();
    n = ++s[TR_COUNT >> 2];
    F_[XF(1) + xf(0x118)] = 12 / f;
    if (period(s, 0x32) > n) return;
    s[TR_COUNT >> 2] = 0;                          // every 50/3 s: layer 2's three wave amounts re-rolled, its speed flipped
    var L = LY(2);
    for (var o of [0x88c, 0x890, 0x894]) s[L + lf(o)] = (A.rand() & 1) === 0 ? 0 : A.rand() & 0x7f;
    if (s[L + lf(0x890)] === 0 && s[L + lf(0x88c)] === 0) {
      s[L + lf(0x88c)] = A.rand() & 0x7f;
      s[L + lf(0x894)] = A.rand() & 0x7f;
    }
    var w = XF(2) + xf(0xd4);
    s[w] = s[w] === -0x42333333 ? -0x41b33333 : -0x42333333;
  },
};

/** Trilogy III: Trilogy I's engine and scene, its own program (0x10017fc0) */
const TRILOGY3: PlusDll = {
  ...TRILOGY1,
  program(c: Core): void {
    var s = head(c), id = s[0x47bc >> 2], F_ = c.m.F, f: number, n: number;
    if (id === 2) {                                // Mystic Cloud
      if (s[0x4574 >> 2] !== 0) {
        F_[XF(1) + xf(0xe4)] = 4 / fps1(s);
        var cos = 0x37d8 >> 2;                     // the scroll's speed falls with the level, its phase with layer 1's angle
        F_[XF(1) + xf(0x110)] = s[0x4414 >> 2] / ((F_[cos + ftol(F_[XF(1) + xf(0xe0)])] + 1) * 5 + 1);
        ls(s, 1, [0x77c, 3]);
        s[0x44a8 >> 2] = 0; c.markLayer();
        s[0x44d0 >> 2] = ftol((F_[cos + ftol(F_[XF(2) + xf(0xe0)])] + 1) * 30);
        return;
      }
      s = setupTrilogy(c, [0x44bc, 0x14, 0x44c0, 5, 0x44cc, 0xae, 0x44d0, 0]);
      hides(s, false, false);
      ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x34, 0x84c, 0x8e, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0x910, -1]);
      ls(s, 1, SCROLL);
      ls(s, 1, [0xe4, F(1)]);
      ls(s, 2, [0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 0, 0x808, 0x2d, 0xe4, F(1), 0xe0, F(180), 0x114, F(1), 0x118, F(-1),
        0x144, 0x40066666]);
      stripLayer(c);
      return;
    }
    if (id === 3) {                                // Undulation
      if (s[0x4574 >> 2] === 0) {
        s = setupTrilogy(c, [0x44bc, 0x1e, 0x44c0, 0, 0x44cc, 0xae, 0x44d0, 0x28]);
        hides(s, true, true);
        ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x34, 0x84c, 0x8e, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0x8fc, 1, 0x880, 0x2d,
          0x884, 0x70, 0x948, 2, 0xd4, F(3), 0x8f8, 2, 0xe4, F(3), 0xec, F(2)]);
        F_ = c.m.F;
        F_[XF(0) + xf(0xe0)] = A.rand() & 0xff;
        F_[XF(0) + xf(0xe8)] = A.rand() & 0xff;
        ls(s, 0, [0x8d8, 1, 0xcc, F(3), 0xd0, F(1), 0x8e0, 0x5a, 0x8d4, 2]);
        ls(s, 1, SCROLL);
        ls(s, 1, [0xe4, F(1), 0x118, F(2)]);
        F_[XF(1) + xf(0x110)] = A.rand() & 0x7f;
        stripLayer(c);
        c.m.I[TR_COUNT >> 2] = 300;
        return;
      }
      s[0x44a8 >> 2] = 0; c.markLayer();
      n = ++s[TR_COUNT >> 2];
      f = fps1(s);
      F_[XF(1) + xf(0x118)] = 8 / f;
      if (period(s, 300) > n) return;
      s[TR_COUNT >> 2] = 0;                        // every 100 s layer 0's two spins swap
      var on = s[LY(0) + lf(0x7cc)] === 0;
      s[LY(0) + lf(0x7cc)] = on ? 1 : 0;
      F_[XF(0) + xf(0xe4)] = (on ? 8 : 12) / f;
      F_[XF(0) + xf(0xec)] = (on ? 12 : 8) / f;
      return;
    }
    if (id !== 1) return;
    if (s[0x4574 >> 2] !== 0) {                    // Lava
      s[0x44a8 >> 2] = 0; c.markLayer();
      f = fps1(s);
      s[0x44c4 >> 2] = Math.max(1, ((s[TR_FPS >> 2] + 1) / 3) | 0);
      F_[XF(1) + xf(0x118)] = 12 / f;
      F_[XF(2) + xf(0xe4)] = 36 / f;
      F_[XF(2) + xf(0xec)] = 8 / f;
      return;
    }
    s = setupTrilogy(c, [0x44bc, 0x28, 0x44c0, 5, 0x44cc, 0xae, 0x44d0, 0, 0x44d4, 4]);
    hides(s, false, true);
    ls(s, 0, [0x78c, 9, 0x790, 1, 0x870, 3, 0x850, 0x43, 0x84c, 0xfa, 0x7e8, 0, 0x7ec, 2, 0x808, 2]);
    ls(s, 1, SCROLL);
    s[0x44c4 >> 2] = 1;
    ls(s, 1, [0xe4, F(1)]);
    scrollStart(c, s);
    ls(s, 2, [0x88c, 0x32, 0x8e0, 0x32, 0x78c, 9, 0x790, 2, 0x7e8, 0, 0x7ec, 1, 0x808, 1, 0xe4, F(9), 0xe0, F(180), 0x114, 0,
      0x118, 0, 0x144, 0, 0xec, F(2), 0x890, 0, 0x884, 0, 0xcc, 0x4081eb85, 0xd0, 0x3f9d70a4, 0x8d4, 1, 0x8d8, 2]);
    stripLayer(c);
  },
};

export interface PlusConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

/** One family: the AlchemyNS-facing wrapper (MusicalColors' shape). options.datatable = the DLL's own image table
 *  (RCDATA DATATABLE_n) for the original artwork; else our generated images. */
function family(name: string, dll: PlusDll, presetNames: string[]): PlusClass {
  return class extends PlusFamily {
    static PRESET_NAMES: string[] = presetNames;
    constructor(cfg?: PlusConfig) { super(name, dll, presetNames, cfg); }
  };
}

export class PlusFamily {
  declare core: Core;
  declare name: string;
  declare names: string[];
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare surface: Surface;
  declare options: Record<string, unknown>;

  constructor(name: string, dll: PlusDll, names: string[], cfg?: PlusConfig) {
    cfg = cfg || {};
    this.name = name;
    this.names = names;
    this.options = Object.assign({}, cfg.options);
    var dt = this.options.datatable;
    this.core = new Core(dt instanceof Uint8Array ? dt : null, dll);
    // Trilogy's clock (ms, as winmm timeGetTime) and its first frame's srand seed (as time(NULL)), when given
    if (typeof this.options.clock === 'function') this.core.clock = this.options.clock as () => number;
    if (typeof this.options.timeSeed === 'function') this.core.timeSeed = this.options.timeSeed as () => number;
    this.frame = 0;
    this.preset = 0;
    this.resize(cfg.width || 640, cfg.height || 480);
    this.setPreset(cfg.preset ? cfg.preset | 0 : 0);
  }

  /** the CRT seed (the DLLs link the CRT statically and never call srand: a fresh thread's 1) */
  seed(n: number): this { A.srand(n | 0); return this; }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= this.names.length) return false;
    this.core.setPreset(n);
    this.preset = n;
    return true;
  }

  render(level: TimedLevel): Surface | null {
    if (!level) return this.surface || null;
    this.core.render(level.freq[0], this.w, this.h, level.state);
    this.frame++;
    var c = this.core;
    if (!this.surface || this.surface.px !== c.dc) this.surface = { w: c.dcW, h: c.dcH, px: c.dc };
    return this.surface;
  }

  debug(): { engine: string; preset: number; presetName: string; size: string; frame: number } {
    return { engine: this.name, preset: this.preset, presetName: this.names[this.preset], size: this.w + 'x' + this.h, frame: this.frame };
  }
}

export type PlusClass = { new (cfg?: PlusConfig): PlusFamily; PRESET_NAMES: string[] };
const BlazingColors: PlusClass = family('BlazingColors', BLAZE, ['Burning Dance', 'Firey Colors', 'Paint Can']);
const PulsingColors: PlusClass = family('PulsingColors', PULSING, ['Lip Sink', 'Musical Island', 'Steel Rhythm']);
const ColorCubes: PlusClass = family('ColorCubes', COLORCUB, ['Flower Boxes', 'Rhythmic Squares', 'Sheer Delight']);
const TrilogyI: PlusClass = family('TrilogyI', TRILOGY1, ['Pulsar', 'Wings', 'Twirling', 'Random Selection']);
const TrilogyII: PlusClass = family('TrilogyII', TRILOGY2, ['Musical Sine', '4th Dimension', 'Mathical Music', 'Random Selection']);
const TrilogyIII: PlusClass = family('TrilogyIII', TRILOGY3, ['Lava', 'Mystic Cloud', 'Undulation', 'Random Selection']);

declare module '../ns' {
  interface AlchemyNS {
    BlazingColors: PlusClass;
    PulsingColors: PlusClass;
    ColorCubes: PlusClass;
    TrilogyI: PlusClass;
    TrilogyII: PlusClass;
    TrilogyIII: PlusClass;
  }
}

A.BlazingColors = BlazingColors;
A.PulsingColors = PulsingColors;
A.ColorCubes = ColorCubes;
A.TrilogyI = TrilogyI;
A.TrilogyII = TrilogyII;
A.TrilogyIII = TrilogyIII;
export { BlazingColors, PulsingColors, ColorCubes, TrilogyI, TrilogyII, TrilogyIII };
