// The WMP 7 Bonus Pack's and the Windows Media Bonus Pack for XP's visualizations on the Musical Colors engine
// (Averett & Associates, 2000-2001): Eclectic Colors, StarTime, SnowTime and Dungeon Siege. Like plus.ts each is
// core.ts's engine (`ver` 1: the 2000 builds) plus its presets and image table; field offsets below are wmpvis.dll's
// (the port keeps its object), VAs the DLL's own (image base 0x10000000).
import { A } from '../ns';
import type { Core, PlusDll } from './core';
import { LY, XF, lf, xf, ftol } from './core';
import type { MusicalImage } from './images';
import { family, head, setup, ls, gs, F } from './plus';
import { eclectImages, starTimeImages } from './bonus-images';
import type { PlusClass } from './plus';

// ---------------------------------------------------------------- Eclectic Colors (ECLECT.dll, 2000-09-21)
// Pulsing Colors' build with 7 layer and transform records, the 2001 bars' y law 9 and hidden layer 3, a scene of
// its own on DATATABLE_4 (table index 3). Program 0x10016360.
const ECLECT: PlusDll = {
  ver: 1, presets: 3, stepLayer: 0, bars: true, table: 3, layers: 7, tri: true,
  scene: [
    [0x910, 0, 0x76c, 2, 0x7fc, 0x479, 0x7e8, 0x453, 0x7ec, -0x1da, 0x808, 0, 0x78c, 3, 0x790, 1, 0x7e4, 0, 0x94c, 1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x522, 0x7ec, -0x191, 0x808, 0, 0x78c, 3, 0x790, 8, 0x7e4, -1, 0x910, -1, 0x77c, 2],
    [0x76c, 2, 0x910, 0, 0x7fc, 0x58c, 0x7e8, 0x453, 0x7ec, -0x1db, 0x808, 0, 0x78c, 3, 0x790, 0xb, 0x7e4, -1, 0x144, F(2),
      0x94c, 1, 0xf0, F(300), 0x114, F(1), 0x118, F(0.5), 0x944, 2, 0x77c, 2],
    [0x78c, 3, 0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x808, 0, 0x790, 9, 0x7e4, 0, 0x94c, 1, 0x910, -1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x808, 0, 0x78c, 3, 0x790, 6, 0x7e4, 0, 0x910, -1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x4f5, 0x7ec, 0x35, 0x808, -0x2e, 0x78c, 3, 0x790, 10, 0x7e4, -1, 0x910, -1, 0x77c, 2],
  ],
  images: (): MusicalImage[] => eclectImages(),
  program(c: Core): void {                       // 0x10016360
    var s = head(c), id = s[0x47bc >> 2];
    if (id === 1) {                                // Rolling Colors
      if (s[0x4574 >> 2] === 0) {
        s = setup(c, 1);
        ls(s, 1, [0x78c, 3, 0x790, 2]);
        ls(s, 2, [0x884, 0xba, 0x88c, 10, 0xe4, F(2), 0x948, 1, 0x144, F(4)]);
        gs(s, [0x44cc, 300, 0x44c0, 10]);
        return;
      }
      ls(s, 0, [0x910, 0]);
      ls(s, 2, [0x910, 0]);
      if (s[0x4414 >> 2] < 5) { ls(s, 0, [0x910, -1]); ls(s, 2, [0x910, -1]); }
      return;
    }
    if (id === 2) {                                // Ribbon Rhythm
      if (s[0x4574 >> 2] === 0) {
        s = setup(c, 0x14);
        ls(s, 1, [0x78c, 3, 0x790, 6, 0x118, F(6), 0x944, 4, 0x870, 3, 0x850, 0x8c, 0x84c, 0xb4]);
        ls(s, 0, [0x88c, 1, 0x8fc, 1, 0x880, 0xa0, 0x884, -0x3c, 0x948, 1, 0xd4, -0x41f0a3d7, 0x8f8, 2, 0xe4, F(2), 0xec, F(0.5)]);
        ls(s, 2, [0x7e8, 0x453, 0x144, F(5)]);
        gs(s, [0x44c0, 10, 0x44cc, 0xae, 0x44bc, 0x14]);
        ls(s, 3, [0x77c, 2]);
        s[0x44a8 >> 2] = 3;
        ls(s, 2, [0x114, F(0.5), 0x118, F(1)]);
        gs(s, [0x44c8, 9, 0x44d0, 0x3c]);
        ls(s, 3, [0x870, 3, 0x850, 5, 0x84c, 0xb4, 0x78c, 3, 0x790, 7, 0x7ec, 0x2d, 0x7e4, -1, 0x910, -1]);
        c.bindImage();
        return;
      }
      var F_ = c.m.F, cosT = 0x37d8 >> 2;
      // layer 2's trail: 15 - ftol(10 * -cos... ) read from the cosine table at layer 0's angle (x87: fld, __ftol twice)
      F_[XF(2) + xf(0x144)] = 0xf - ftol(F_[cosT + ftol(F_[XF(0) + xf(0xe0)])] * -10);
      F_[XF(0) + xf(0xec)] = Math.fround(s[0x4414 >> 2] * Math.fround(0.02));
      s[0x44a8 >> 2] = 1;
      c.markLayer();
      return;
    }
    if (id !== 3) return;
    if (s[0x4574 >> 2] === 0) {                    // Night Fire
      s = setup(c, 5);
      ls(s, 1, [0x78c, 3, 0x790, 5, 0x118, F(8), 0x944, 4]);
      ls(s, 2, [0x910, -1]);
      ls(s, 0, [0x910, 0, 0x78c, 3]);
      ls(s, 3, [0x78c, 3, 0x77c, 3]);
      gs(s, [0x44cc, 0xba, 0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
      ls(s, 0, [0x7e8, -1, 0x7ec, 0, 0x870, 0xd, 0x850, 0x73, 0x84c, 0xea]);
      ls(s, 1, [0x7e8, 0x158, 0x7ec, 0]);
      ls(s, 2, [0x76c, -1]);
      ls(s, 0, [0x790, 1]);
      ls(s, 3, [0x7e8, 0x15c, 0x7ec, 0, 0x790, 4]);
      gs(s, [0x44c0, 0x1e, 0x44bc, 0x5a, 0x44c8, 8, 0x44d0, 10]);
      return;
    }
    s[0x44a8 >> 2] = 0;
    c.markLayer();
  },
};



// ---------------------------------------------------------------- StarTime (StarTime.dll, 2000-09-27)
// 43 star sprites (layers 9..51) over layer 0's picture, drawn each frame through layers 6 and 7's warps, their sizes
// from the spectrum. PlusDll.star: the build's own bits of engine (core.ts). Program 0x10016790. Fields of its own
// (no wmpvis.dll counterpart), kept past wmpvis.dll's object.
const ST_BFD0 = 0x4fa0, ST_BFD4 = 0x4fa4, ST_C4A0 = 0x4fa8, ST_C020 = 0x4fb0, ST_C024 = 0x4fb4;
const rand = (): number => A.rand();

/** vt+0x1b0 / 0x1b8 / 0x1bc (0x1000edd0 / 0x1000ee50 / 0x1000eed0): a w x h canvas buffer (obj+0x4660), made again only when
 *  the size changed */
function canvasTo(c: Core, w: number, h: number): void {
  var m = c.m, s = m.I;
  if (s[0x47a0 >> 2] === w && s[0x47a8 >> 2] === h) return;
  if (s[0x4660 >> 2]) m.release(s[0x4660 >> 2]);
  s[0x47a0 >> 2] = w;
  s[0x47a8 >> 2] = h;
  var p = m.malloc(Math.imul(w, h) * 4);
  m.I[0x4660 >> 2] = p;
}

/** vt+0x14c 0x10016210: the current layer drawn onto layer 0's picture */
function drawOnLayer0(c: Core): void {
  var s = c.m.I, b0 = LY(0), k = s[0x44a8 >> 2], b = LY(k);
  s[0x4444 >> 2] = s[b0 + lf(0x7f4)];
  s[0x4378 >> 2] = s[b0 + lf(0x794)];
  s[0x4440 >> 2] = s[b0 + lf(0x7f8)];
  s[0x4f10 >> 2] = 0;
  s[0x4f24 >> 2] = 0;
  s[b + lf(0x910)] = 0;
  if (s[b + lf(0x93c)] === 0) c.renderLayer();
  s = c.m.I;
  s[LY(s[0x44a8 >> 2]) + lf(0x910)] = -1;
}

/** vt+0x124 0x10016670: the current layer's colour := layer 1's pixel at row obj+0x4e78, column 0 (each pixel's alpha byte kept) */
function rampFill(c: Core): void {
  var m = c.m, s = m.I, U = m.U, b1 = LY(1), k = s[0x44a8 >> 2], b = LY(k);
  var src = s[b1 + lf(0x794)], sel = s[b1 + lf(0x824)];
  if (sel === 1) src = s[b1 + lf(0x828)];
  if (sel === 2) src = s[b1 + lf(0x90c)];
  s[0x43ec >> 2] = src;
  var dst = s[b + lf(0x794)];
  s[0x4390 >> 2] = dst;
  if (src !== 0 && dst !== 0) {
    var colour = U[(src >> 2) + Math.imul(s[0x4e78 >> 2], s[b1 + lf(0x7f4)])];
    s[0x4c50 >> 2] = colour;
    var n = Math.imul(s[b + lf(0x7f4)], s[b + lf(0x7f8)]);
    s[0x4ec4 >> 2] = n;
    s[b + lf(0x77c)] = 2;
    for (var i = 0; i < n; i++) U[(dst >> 2) + i] = ((U[(dst >> 2) + i] & 0xff000000) | colour) >>> 0;
    s[0x4390 >> 2] = dst + Math.max(n, 0) * 4;
    s[0x4ee8 >> 2] = Math.max(n, 0);
  }
}

/** vt+0x154 0x100089b0: layer ST_C020's picture copied into layer ST_C024's (the same size, both with pixels) */
function copyLayer(c: Core): void {
  var m = c.m, s = m.I, U = m.U, a = s[ST_C020 >> 2], z = s[ST_C024 >> 2], ba = LY(a), bz = LY(z);
  var wa = s[ba + lf(0x7f4)], wz = s[bz + lf(0x7f4)], ha = s[ba + lf(0x7f8)];
  if (ha === s[bz + lf(0x7f8)] && wa === wz && s[ba + lf(0x794)] !== 0 && s[bz + lf(0x7f8)] !== 0 && ha !== 0 && wz !== 0 &&
      wa !== 0 && s[bz + lf(0x794)] !== 0) {
    var n = Math.imul(ha, wa);
    s[0x4ec4 >> 2] = n;
    U.copyWithin(s[bz + lf(0x794)] >> 2, s[ba + lf(0x794)] >> 2, (s[ba + lf(0x794)] >> 2) + n);
    s[0x43ec >> 2] = s[ba + lf(0x794)] + n * 4;
    s[0x4390 >> 2] = s[bz + lf(0x794)] + n * 4;
    s[0x45cc >> 2] = n + 1;
  }
}

/** layer 0 made again as a w x h picture of its own, cleared (the program's resize path) */
function newLayer0(c: Core, w: number, h: number): void {
  var m = c.m, s = m.I, b = LY(0);
  if (s[b + lf(0x770)] === -1 && s[b + lf(0x794)] !== 0) { m.release(s[b + lf(0x794)]); s[b + lf(0x794)] = 0; }
  if (s[b + lf(0x82c)] !== 0) { m.release(s[b + lf(0x82c)]); s[b + lf(0x82c)] = 0; }
  if (s[b + lf(0x828)] !== 0) { m.release(s[b + lf(0x828)]); s[b + lf(0x828)] = 0; }
  s[b + lf(0x824)] = 0;
  s[b + lf(0x770)] = 0;
  var p = m.malloc(Math.imul(w, h) * 4);
  s = m.I;
  s[0x4378 >> 2] = p;
  var n = Math.imul(w, h);
  s[b + lf(0x7f4)] = w; s[b + lf(0x81c)] = w; s[b + lf(0x79c)] = w;
  s[b + lf(0x770)] = -1;
  s[b + lf(0x794)] = p;
  s[b + lf(0x7f8)] = h; s[b + lf(0x820)] = h; s[b + lf(0x7a0)] = h;
  s[b + lf(0x77c)] = 2;
  s[0x4ec4 >> 2] = n;
  m.U.fill(0, p >> 2, (p >> 2) + n);
  s[0x4390 >> 2] = p + n * 4;
  s[0x45cc >> 2] = n + 1;
}

/** the first stars on layer 0: layer 5 bound to sprites 64..71 (the clouds skip 66 and 67, which are not stars) and drawn
 *  over a jittered grid; w x h the picture's size */
function seedStars(c: Core, w: number, h: number, skip: boolean): void {
  var s = c.m.I, b5 = LY(5), y = 0, x: number;
  s[b5 + lf(0x808)] = 0;
  s[0x44a8 >> 2] = 5;
  s[b5 + lf(0x898)] = 0;
  s[b5 + lf(0x78c)] = 4;
  s[b5 + lf(0x780)] = rand() & 0xf;
  do {
    do {
      var idx = (rand() & 7) + 0x40;
      s[b5 + lf(0x790)] = idx;
      if (skip && (idx === 0x43 || idx === 0x42)) s[b5 + lf(0x790)] = idx + 4;
      s[0x44a8 >> 2] = 5;
      c.bindImage();
      s = c.m.I;
      var bk = LY(s[0x44a8 >> 2]);
      s[bk + lf(0x814)] = s[bk + lf(0x780)];
      s[bk + lf(0x818)] = s[bk + lf(0x784)];
      s[bk + lf(0x81c)] = s[bk + lf(0x79c)];
      s[bk + lf(0x820)] = s[bk + lf(0x7a0)];
      c.clipLayer();
      drawOnLayer0(c);
      s = c.m.I;
      s[b5 + lf(0x780)] = (s[b5 + lf(0x780)] + (rand() & 0x1f) + 3) | 0;
      x = s[b5 + lf(0x780)];
      s[b5 + lf(0x784)] = ((rand() & 0x1f) + y) | 0;
    } while (x < w);
    s[b5 + lf(0x780)] = rand() & 0xf;
    y = (y + (rand() & 0x1f) + 3) | 0;
  } while (y < h);
}

/** layers 9..51 on a jittered grid of dx x dy (columns of 7); the clouds also pick each star's brightness layer (l_898 6 / 7) */
function scatterStars(c: Core, dx: number, dy: number, pick: boolean): void {
  var s = c.m.I, mx = 0xffff, my = 0xffff;
  s[0x4c98 >> 2] = dx;
  s[0x4ca0 >> 2] = dy;
  if (dx < mx) do { mx >>= 1; } while (dx < mx);
  if (dy < my) do { my >>= 1; } while (dy < my);
  for (var k = 9; k < 0x34; k++) {
    var q = ((k - 9) / 7) | 0, X = (k - q * 7 - 9) * dx - 0x14, Y = q * dy - 0x14;
    X = (rand() & 1) === 0 ? X - (rand() & mx) : X + (rand() & mx);
    Y = (rand() & 1) === 0 ? Y - (rand() & my) : Y + (rand() & my);
    var b = LY(k);
    s[b + lf(0x7e8)] = X;
    s[b + lf(0x808)] = -Y;
    s[b + lf(0x77c)] = 2;
    if (pick) s[b + lf(0x898)] = (rand() & 1) === 0 ? 6 : 7;
  }
  s[0x44a8 >> 2] = 0x34;
}

/** a preset's scatter loop: the stars thrown once at a resize; a quiet passage (level < 5, once) throws them again; layer 5's
 *  l_7d0 (1 = already thrown, 2 = a loud passage) is the memory. `skip`: the first pass jumps to the level test. */
function scatterLoop(c: Core, dx: () => number, dy: () => number, pick: boolean, skip: boolean): void {
  var b5 = LY(5);
  for (;;) {
    if (!skip) scatterStars(c, dx(), dy(), pick);
    skip = false;
    var s = c.m.I;
    if (10 < s[0x4414 >> 2]) s[b5 + lf(0x7d0)] = 2;
    if (s[b5 + lf(0x7d0)] === 1 || 4 < s[0x4414 >> 2]) break;
    s[b5 + lf(0x7d0)] = 1;
  }
}

/** the frame's last loop over layers 9..51: each star takes the spectrum bin (`stride` apart) of its place in a window that slips
 *  every 41 frames; Starlight picks its sprite by the bin (a big bin, a bigger star), the clouds paint it the ramp's colour */
function starFrame(c: Core, stride: number, sprites: boolean): void {
  var s = c.m.I;
  if (0x28 < s[ST_BFD4 >> 2]) { s[ST_BFD0 >> 2] = rand() & 0x1f; s[ST_BFD4 >> 2] = 0; }
  s[ST_BFD4 >> 2]++;
  for (var k = 9; k < 0x34; k++) {
    s[0x44a8 >> 2] = k;
    var i = k - 4 + s[ST_BFD0 >> 2];
    if (0x2a < i) i -= 0x25;
    s[0x45cc >> 2] = i;
    var v = s[(0x1740 >> 2) + i * stride], b = LY(k);
    s[0x4e78 >> 2] = v;
    if (sprites) {
      var b5 = LY(5);
      s[b5 + lf(0x790)] = v < 5 ? 0x3f : 0x3e - ((v / 0x1d) | 0);
      s[0x44a8 >> 2] = 5;
      c.bindImage();
      s = c.m.I;
      s[0x44a8 >> 2] = k;
      s[b + lf(0x898)] = s[b5 + lf(0x790)] < 0x3a ? 7 : 6;
      s[ST_C020 >> 2] = 5;
      s[ST_C024 >> 2] = k;
      copyLayer(c);
    } else {
      c.m.F[XF(k) + xf(0x124)] = 0xff - v;
      rampFill(c);
    }
    s = c.m.I;
    s[b + lf(0x950)] = 2;
    s[b + lf(0x77c)] = 3;
  }
  s[0x44a8 >> 2] = 0x34;
}

/** each star layer 9..51 on its sprite (images 10..52 of the table), shown, 52 layers on; the clouds' stars use layer 898 = 7 */
function starLayers(c: Core, brightness: boolean): void {
  var s = c.m.I;
  s[ST_C4A0 >> 2] = 10;
  for (var k = 9; k < 0x34; k++) {
    s[0x44a8 >> 2] = k;
    ls(s, k, [0x78c, 4, 0x790, s[ST_C4A0 >> 2], 0x76c, 2, 0x910, 0]);
    s[ST_C4A0 >> 2]++;
    if (brightness) ls(s, k, [0x898, 7]);
    c.bindImage();
    s = c.m.I;
  }
  s[0x44a8 >> 2] = 0x34;
  s[ST_BFD4 >> 2] = 0;
  s[ST_BFD0 >> 2] = rand() & 0x1f;
}

/** the globals every preset's first frame sets, and layers 0 and 5 */
function starBase(s: Int32Array, g: number[]): void {
  gs(s, [0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0, ...g, 0x44d4, 0, 0x457c, 0]);
  ls(s, 0, [0x76c, 0, 0x7e8, -2, 0x7ec, 0, 0x808, 0, 0x7e4, -1, 0x94c, 0, 0x910, 0]);
  ls(s, 5, [0x7e8, 0x3e, 0x7ec, 0, 0x78c, 4, 0x790, 0x37, 0x77c, 3, 0x910, -1, 0x7e4, 0]);
}

const STARTIME: PlusDll = {
  ver: 1, presets: 3, stepLayer: 0, bars: false, table: 4, star: true,
  scene: [
    [0x910, 0, 0x76c, 2, 0x7fc, 0x479, 0x7e8, 0x453, 0x7ec, -0x1da, 0x808, 0, 0x78c, 4, 0x790, 5, 0x7e4, 0, 0x94c, 1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x522, 0x7ec, -0x191, 0x808, 0, 0x78c, 4, 0x790, 5, 0x7e4, -1, 0x77c, 2],
    [0x76c, 2, 0x910, 0, 0x7fc, 0x58c, 0x7e8, 0x453, 0x7ec, -0x1db, 0x808, 0, 0x78c, 4, 0x790, 5, 0x7e4, -1, 0x144, F(2),
      0x94c, 1, 0xf0, F(300), 0x114, F(1), 0x118, F(0.5), 0x944, 2, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x808, 0, 0x78c, 4, 0x790, 5, 0x7e4, 0, 0x94c, 1, 0x910, -1, 0x77c, 2],
    [0x808, 0, 0x7e4, 0, 0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x78c, 4, 0x790, 5, 0x910, -1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x4f5, 0x7ec, 0x35, 0x808, -0x2e, 0x78c, 4, 0x790, 5, 0x7e4, -1, 0x910, -1, 0x77c, 2],
  ],
  images: (): MusicalImage[] => starTimeImages(),
  program(c: Core): void {                       // 0x10016790
    var s = head(c), id = s[0x47bc >> 2], b5 = LY(5);
    if (id < 1 || id > 3) return;
    if (s[0x4574 >> 2] === 0) {                    // the preset's first frame
      s[0x4574 >> 2] = 1;
      if (id === 1) canvasTo(c, 0x160, 0x140); else canvasTo(c, 0xb4, 0x78);
      s = c.m.I;
      s[0x463c >> 2] = 0x34;
      if (id === 1) {                              // Starlight: a window-sized picture of sprites, the layers 6 and 7 warping it
        starBase(s, [0x44bc, 0x41, 0x44c0, 0, 0x44d0, 0x14]);
        for (var k = 1; k <= 4; k++) ls(s, k, [0x910, -1, 0x76c, -1]);
        ls(s, 6, [0x7e8, 0, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 1, 0x77c, 3, 0xbc, 0x3f400000, 0xc0, 0x3f11eb85, 0x8c8, 1, 0x934, 2,
          0xe4, 0x42200000, 0xec, 0x41200000, 0x858, 1, 0x910, -1]);
        ls(s, 7, [0x7e8, 0x46, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 2, 0x77c, 3, 0xbc, 0x3f400000, 0xc0, 0x3f11eb85, 0x8c8, 1, 0x934, 2,
          0xe4, 0x420c0000, 0xec, 0x40e00000, 0x858, 1, 0x910, -1]);
        starLayers(c, false);
      } else {
        var cloud = id === 2;
        starBase(s, cloud ? [0x44bc, 200, 0x44c0, 0x5f, 0x44d0, 0x3c] : [0x44bc, 0x8c, 0x44c0, 0, 0x44d0, 0x3c]);
        ls(s, 1, [0x910, -1]);
        for (k = 2; k <= 4; k++) ls(s, k, [0x910, -1, 0x76c, -1]);
        ls(s, 1, [0x7e8, 0xaf, 0x7ec, 0, 0x78c, 4, 0x790, 0x48, 0x118, cloud ? F(3) : F(2), 0x944, 4]);
        if (cloud) {                               // Star Clouds: the stars waved and swirled
          ls(s, 6, [0x7e8, 0, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 2, 0x77c, 3, 0xcc, 0x41600000, 0xd0, 0x3e8a3d71, 0x8e0, 4, 0x8d4, 1,
            0x8d8, 2, 0xe4, 0x41a00000, 0xec, 0x41000000, 0x858, 1, 0x910, -1]);
          ls(s, 7, [0x7e8, 0x46, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 2, 0x77c, 3, 0xcc, 0x40e00000, 0xd0, -0x4175c28f, 0x8e0, 3, 0x8d4, 1,
            0x8d8, 2, 0xe4, 0x41200000, 0xec, 0x40400000, 0x858, 1, 0x910, -1]);
        } else {
          ls(s, 6, [0x7e8, 0, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 3, 0x77c, 3, 0x910, -1]);
          ls(s, 7, [0x7e8, 0x46, 0x7ec, 0, 0x808, 0, 0x78c, 4, 0x790, 3, 0x77c, 3, 0x910, -1]);
        }
        starLayers(c, true);
      }
      return;
    }
    if (id === 1) {                                // Starlight, every later frame
      var same = s[0x47a8 >> 2] === s[0x4680 >> 2] && s[0x47a0 >> 2] === s[0x467c >> 2];
      if (!same) {                                 // the window changed: its picture, its stars
        canvasTo(c, s[0x467c >> 2], s[0x4680 >> 2]);
        newLayer0(c, c.m.I[0x47a0 >> 2], c.m.I[0x47a8 >> 2]);
        seedStars(c, c.m.I[0x47a0 >> 2], c.m.I[0x47a8 >> 2], false);
      }
      scatterLoop(c, () => (c.m.I[0x47a0 >> 2] / 7) | 0, () => (c.m.I[0x47a8 >> 2] / 6) | 0, false, same);
      starFrame(c, 4, true);
      return;
    }
    var fixed = s[LY(0) + lf(0x7f8)] === 0x78 && s[LY(0) + lf(0x7f4)] === 0xb4;   // the clouds: a 180 x 120 picture
    if (!fixed) {
      newLayer0(c, 0xb4, 0x78);
      seedStars(c, 0x160, 0x140, true);
    }
    scatterLoop(c, () => 0x19, () => 0x12, true, fixed);
    starFrame(c, 3, false);
    void b5;
  },
};

const EclecticColors: PlusClass = family('EclecticColors', ECLECT, ['Rolling Colors', 'Ribbon Rhythm', 'Night Fire']);
const StarTime: PlusClass = family('StarTime', STARTIME, ['Starlight', 'Star Clouds', 'Star Glow']);

declare module '../ns' {
  interface AlchemyNS {
    EclecticColors: PlusClass;
    StarTime: PlusClass;
  }
}

A.EclecticColors = EclecticColors;
A.StarTime = StarTime;
export { EclecticColors, StarTime };
