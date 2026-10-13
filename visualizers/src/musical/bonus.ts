// The WMP 7 Bonus Pack's and the Windows Media Bonus Pack for XP's visualizations on the Musical Colors engine
// (Averett & Associates, 2000-2001): Eclectic Colors, StarTime, SnowTime and Dungeon Siege. Like plus.ts each is
// core.ts's engine (`ver` 1: the 2000 builds) plus its presets and image table; field offsets below are wmpvis.dll's
// (the port keeps its object), VAs the DLL's own (image base 0x10000000).
import { A } from '../ns';
import type { Core, PlusDll } from './core';
import { LY, XF, lf, xf, ftol, TR_FPS } from './core';
import type { MusicalImage } from './images';
import { family, head, setup, ls, gs, F } from './plus';
import { eclectImages, starTimeImages, snowTimeImages, dungeonImages } from './bonus-images';
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

/** the six default layers of StarTime (table 4, image 5) and SnowTime (table 5, image 7): all on one small image */
function starScene(tbl: number, img: number): number[][] {
  return [
    [0x910, 0, 0x76c, 2, 0x7fc, 0x479, 0x7e8, 0x453, 0x7ec, -0x1da, 0x808, 0, 0x78c, tbl, 0x790, img, 0x7e4, 0, 0x94c, 1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x522, 0x7ec, -0x191, 0x808, 0, 0x78c, tbl, 0x790, img, 0x7e4, -1, 0x77c, 2],
    [0x76c, 2, 0x910, 0, 0x7fc, 0x58c, 0x7e8, 0x453, 0x7ec, -0x1db, 0x808, 0, 0x78c, tbl, 0x790, img, 0x7e4, -1, 0x144, F(2),
      0x94c, 1, 0xf0, F(300), 0x114, F(1), 0x118, F(0.5), 0x944, 2, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x808, 0, 0x78c, tbl, 0x790, img, 0x7e4, 0, 0x94c, 1, 0x910, -1, 0x77c, 2],
    [0x808, 0, 0x7e4, 0, 0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x78c, tbl, 0x790, img, 0x910, -1, 0x77c, 2],
    [0x76c, 2, 0x7fc, 0x58c, 0x7e8, 0x4f5, 0x7ec, 0x35, 0x808, -0x2e, 0x78c, tbl, 0x790, img, 0x7e4, -1, 0x910, -1, 0x77c, 2],
  ];
}

const STARTIME: PlusDll = {
  ver: 1, presets: 3, stepLayer: 0, bars: false, table: 4, star: true,
  scene: starScene(4, 5),
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

// ---------------------------------------------------------------- SnowTime / Softie the Snowman (snowtime.dll, 2000-10-20)
// StarTime's build plus Trilogy's warp and spectrum smoothing and the bars with their last step (a strip of layer 1's picture
// at a row of the spectrum): one preset, the snowman of layers 4..25, his eyes, arms and legs moved by the spectrum's bins and
// the last ten levels, the snow the bars' layer 3. Program 0x10016ba0. A field of its own: the blink countdown.
const SN_BFD4 = 0x4fa0;

const SNOWTIME: PlusDll = {
  ver: 1, presets: 1, stepLayer: 0, bars: true, table: 5, star: true, tri: true, short: true,
  scene: starScene(5, 7),
  images: (): MusicalImage[] => snowTimeImages(),
  program(c: Core): void {                       // 0x10016ba0
    var s = head(c), id = s[0x47bc >> 2];
    if (id !== 1) return;
    var g = (k: number, o: number): number => s[LY(k) + lf(o)];
    var p = (k: number, o: number, v: number): void => { s[LY(k) + lf(o)] = v | 0; };
    if (s[0x4574 >> 2] === 0) {                    // the first frame
      s[0x4574 >> 2] = 1;
      gs(s, [0x4efc, 0x0]);
      gs(s, [0x4f00, 0x0]);
      gs(s, [0x4f04, 0x0]);
      gs(s, [0x4ef8, 0x0]);
      canvasTo(c, 0x160, 0x140); s = c.m.I;
      gs(s, [0x463c, 0x1e]);
      gs(s, [0x457c, 0x1]);
      ls(s, 1, [0x910, -0x1]);
      ls(s, 2, [0x910, -0x1, 0x76c, -0x1]);
      ls(s, 3, [0x910, -0x1]);
      gs(s, [0x47f8, 0x7]);
      gs(s, [0x44c8, 0xa]);
      gs(s, [0x44bc, 0x14]);
      gs(s, [0x44c0, 0x1a]);
      gs(s, [0x44cc, 0xb2]);
      gs(s, [0x44d0, 0x37]);
      ls(s, 0, [0x7e8, -0x1, 0x7ec, -0x12c, 0x808, -0x12c, 0x78c, 0x5, 0x790, 0xb, 0x870, 0x0, 0x850, 0x5, 0x84c, 0xfa, 0x94c, 0x0]);
      ls(s, 1, [0x78c, 0x5, 0x790, 0xd, 0x7e8, 0x156, 0x7ec, 0x64, 0x808, 0x28, 0x118, F(19)]);
      ls(s, 3, [0x7e8, 0x14d, 0x7ec, 0x12c, 0x808, 0x24, 0x7e4, -0x1, 0x78c, 0x5, 0x790, 0xe, 0x77c, 0x2]);
      s[0x44a8 >> 2] = 3;
      c.bindImage(); s = c.m.I;
      ls(s, 4, [0x7e8, 0x86, 0x7ec, 0x1a, 0x808, -0x39, 0x78c, 0x5, 0x790, 0x2, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0x0, 0x850, 0x3, 0x84c, 0xd7, 0x840, 0x44, 0x844, 0x64, 0x848, 0x78, 0x8b8, 0x1, 0x88, F(50), 0x8bc, 0x1, 0x98, F(0.39)]);
      ls(s, 5, [0x7e8, 0x77, 0x7ec, 0x15, 0x808, -0x7f, 0x78c, 0x5, 0x790, 0x3, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0x0, 0x850, 0x3, 0x84c, 0xd7, 0x8b8, 0x1, 0x8bc, 0x1]);
      ls(s, 6, [0x8b8, 0x1, 0x8bc, 0x1]);
      ls(s, 5, [0x840, 0x44, 0x844, 0x64, 0x848, 0x78, 0x88, F(50), 0x98, F(0.39)]);
      ls(s, 6, [0x76c, 0x2, 0x7e8, 0x6b, 0x7ec, 0x0, 0x808, -0xdb, 0x78c, 0x5, 0x790, 0x4, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0x0, 0x850, 0x3, 0x84c, 0xd7, 0x840, 0x44, 0x844, 0x64, 0x848, 0x78, 0x88, F(50), 0x98, F(0.39)]);
      ls(s, 7, [0x76c, 0x2, 0x7e8, 0x9b, 0x7ec, 0x64, 0x808, -0xa, 0x78c, 0x5, 0x790, 0x5, 0x77c, 0x3, 0x870, 0x3, 0x850, 0x0, 0x84c, 0x3e8, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 8, [0x76c, 0x2, 0x7e8, 0xbb, 0x7ec, 0x64, 0x808, -0xa, 0x78c, 0x5, 0x790, 0x6, 0x77c, 0x3, 0x870, 0x3, 0x850, 0x0, 0x84c, 0x3e8, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 9, [0x76c, 0x2, 0x7e8, 0xa9, 0x7ec, 0x64, 0x808, -0x49, 0x78c, 0x5, 0x790, 0x7, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 10, [0x76c, 0x2, 0x7e8, 0xa8, 0x7ec, 0x64, 0x808, -0x63, 0x78c, 0x5, 0x790, 0x8, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 11, [0x76c, 0x2, 0x7e8, 0xa9, 0x7ec, 0x64, 0x808, -0x94, 0x78c, 0x5, 0x790, 0x9, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 12, [0x76c, 0x2, 0x7e8, 0xa8, 0x7ec, 0x64, 0x808, -0xb3, 0x78c, 0x5, 0x790, 0xa, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 13, [0x7e8, -0x1, 0x7ec, -0x12c, 0x808, -0x12c, 0x78c, 0x5, 0x790, 0x1, 0x7e4, -0x1, 0x77c, 0x2]);
      ls(s, 14, [0x76c, 0x2, 0x7e8, 0x8a, 0x7ec, 0x64, 0x808, -0x25, 0x850, 0x2, 0x84c, 0xf5, 0x78c, 0x5, 0x790, 0xc, 0x7e4, 0xffffff, 0x77c, 0x2]);
      ls(s, 15, [0x76c, 0x2, 0x7e8, 0x97, 0x7ec, 0x64, 0x808, -0x1c, 0x78c, 0x5, 0x790, 0xf, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 16, [0x76c, 0x2, 0x7e8, 0x9c, 0x7ec, 0x64, 0x808, -0x20, 0x78c, 0x5, 0x790, 0x10, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 17, [0x76c, 0x2, 0x7e8, 0xa3, 0x7ec, 0x64, 0x808, -0x23, 0x78c, 0x5, 0x790, 0x11, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 18, [0x76c, 0x2, 0x7e8, 0xa9, 0x7ec, 0x64, 0x808, -0x24, 0x78c, 0x5, 0x790, 0x10, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 19, [0x76c, 0x2, 0x7e8, 0xb1, 0x7ec, 0x64, 0x808, -0x24, 0x78c, 0x5, 0x790, 0xf, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 20, [0x76c, 0x2, 0x7e8, 0xb8, 0x7ec, 0x64, 0x808, -0x23, 0x78c, 0x5, 0x790, 0x11, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 21, [0x76c, 0x2, 0x7e8, 0xbd, 0x7ec, 0x64, 0x808, -0x20, 0x78c, 0x5, 0x790, 0x10, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 22, [0x76c, 0x2, 0x7e8, 0xc3, 0x7ec, 0x64, 0x808, -0x1c, 0x78c, 0x5, 0x790, 0xf, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0xffffff]);
      ls(s, 23, [0x76c, 0x2, 0x7e8, 0xa5, 0x7ec, -0x1, 0x808, -0xad, 0x78c, 0x5, 0x790, 0x12, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0x7e6b33]);
      ls(s, 24, [0x76c, 0x2, 0x7e8, 0x23, 0x7ec, -0x1, 0x808, -0xaf, 0x78c, 0x5, 0x790, 0x12, 0x77c, 0x3, 0x910, 0x0, 0x7e4, 0x7e6b33]);
      ls(s, 25, [0x76c, 0x2, 0x7e8, 0xb7, 0x7ec, 0x64, 0x808, -0x41, 0x78c, 0x5, 0x790, 0x13, 0x850, 0xa, 0x84c, 0xf0, 0x77c, 0x3, 0x910, -0x1, 0x7e4, 0xffffff, 0x7d0, 0x14]);
      gs(s, [SN_BFD4, 0x14]);
      return;
    }
    s[0x44a8 >> 2] = 0;
    c.markLayer();
    var sp = (bin: number): number => s[(0x1740 >> 2) + bin], hist = (i: number): number => s[(0x1718 >> 2) + i];
    var lv = (): number => s[0x4494 >> 2];
    // the body's countdowns: layer 4's pose (l_7cc), layer 23's arm swing, layer 25's blink
    var d4 = g(4, 0x7d0);
    if (d4 === 0) {
      var r = rand() & 7;
      s[0x4e78 >> 2] = r;
      var u3 = g(4, 0x7cc);
      if (u3 === r) { p(4, 0x7cc, u3 + 1); d4 = (rand() & 7) + 10; } else { p(4, 0x7cc, r); d4 = (rand() & 7) + 10; }
    } else d4--;
    p(4, 0x7d0, d4);
    if (lv() < 0x46) p(4, 0x7cc, 0);
    var d17 = g(0x17, 0x7d0);
    if (d17 === 0) {
      p(0x17, 0x7cc, rand() & 7);
      p(0x17, 0x7d0, (rand() & 3) + 10);
      p(0x17, 0x7d4, 0);
      if (lv() < 0x6e) p(0x17, 0x7cc, 0);
    } else p(0x17, 0x7d0, d17 - 1);
    var d19 = g(0x19, 0x7d0);
    if (d19 === 0) { p(0x19, 0x7cc, rand() & 3); d19 = (rand() & 0xf) + 3; } else d19--;
    p(0x19, 0x7d0, d19);
    p(4, 0x7e8, 0x86); p(4, 0x808, -0x39);
    p(5, 0x7e8, 0x77); p(5, 0x808, -0x7f);
    p(6, 0x7e8, 0x6b); p(6, 0x808, -0xdb);
    if (lv() < 10) { p(5, 0x890, 0); p(6, 0x890, 0); }
    // the arm swing: layers 4 and 5 move along x (poses 1 and 2) or y (pose 3) by the swing's counter (l_7d4, up to l_7d0)
    var m17 = g(0x17, 0x7cc), t: number, u: number;
    if (m17 === 1 || m17 === 2) {
      var sg = m17 === 1 ? 7 : -7;
      u = g(0x17, 0x7d0); t = g(0x17, 0x7d4);
      if (t < u) { t++; p(0x17, 0x7d4, t); u = t; }
      var a4 = g(4, 0x7e8) + u * sg;
      p(4, 0x7e8, a4);
      if (m17 === 1 ? 0x9e < a4 : a4 < 0x6e) p(4, 0x7e8, m17 === 1 ? 0x9e : 0x6e);
      var a5 = g(5, 0x7e8) + u * sg;
      p(5, 0x7e8, a5);
      if (m17 === 1 ? 0x88 < a5 : a5 < 0x66) p(5, 0x7e8, m17 === 1 ? 0x88 : 0x66);
    }
    if (m17 === 3) {
      u = g(0x17, 0x7d0); t = g(0x17, 0x7d4);
      if (t < u) { t++; p(0x17, 0x7d4, t); u = t; }
      var b4 = g(4, 0x808) + u * -6;
      p(4, 0x808, b4);
      if (b4 < -0x4d) p(4, 0x808, -0x4d);
      var b5 = g(5, 0x808) + u * -6;
      p(5, 0x808, b5);
      if (b5 < -0x8e) p(5, 0x808, -0x8e);
    }
    // the parts follow layers 4 and 5
    p(0x17, 0x7e8, g(5, 0x7e8) + 0x2e); p(0x17, 0x808, g(5, 0x808) - 0x2e);
    p(0x18, 0x7e8, g(5, 0x7e8) - 0x54); p(0x18, 0x808, g(5, 0x808) - 0x30);
    p(9, 0x7e8, g(5, 0x7e8) + 0x32); p(9, 0x808, g(5, 0x808) + 0x38);
    p(10, 0x7e8, g(5, 0x7e8) + 0x32); p(10, 0x808, g(5, 0x808) + 0x1a);
    p(0x19, 0x7e8, g(5, 0x7e8) + 0x3e); p(0x19, 0x808, g(5, 0x808) + 0x3a);
    var rel: number[][] = [[7, 0x15, 0x2f], [8, 0x35, 0x2f], [0xe, 4, 0x14], [0xf, 0x11, 0x1d], [0x10, 0x16, 0x19], [0x11, 0x1d, 0x16], [0x12, 0x23, 0x15],
      [0x13, 0x2b, 0x15], [0x14, 0x32, 0x16], [0x15, 0x37, 0x19], [0x16, 0x3d, 0x1d]];
    for (var q = 0; q < rel.length; q++) { p(rel[q][0], 0x7e8, g(4, 0x7e8) + rel[q][1]); p(rel[q][0], 0x808, g(4, 0x808) + rel[q][2]); }
    var y4 = g(4, 0x808), v: number, w: number;
    v = ((sp(40) / 8) | 0) + 0x1d + y4; p(0xf, 0x808, v); if (y4 + 0x25 <= v) p(0xf, 0x808, -0x16);
    v = ((sp(80) / 8) | 0) + 0x1d + y4; p(0x16, 0x808, v); w = y4 + 0x25; if (w <= v) p(0x16, 0x808, w);
    v = ((sp(55) / 10) | 0) + 0x19 + y4; p(0x10, 0x808, v); w = y4 + 0x1c; if (w <= v) p(0x10, 0x808, w);
    v = ((sp(65) / 10) | 0) + 0x19 + y4; p(0x15, 0x808, v); w = y4 + 0x1c; if (w <= v) p(0x15, 0x808, w);
    v = y4 - ((sp(50) / 11) | 0) + 0x16; p(0x11, 0x808, v); w = y4 + 0x14; if (v <= w) p(0x11, 0x808, w);
    v = y4 - ((sp(60) / 11) | 0) + 0x16; p(0x14, 0x808, v); w = y4 + 0x14; if (v <= w) p(0x14, 0x808, w);
    v = y4 - ((sp(40) / 8) | 0) + 0x15; p(0x12, 0x808, v); w = y4 + 0xe; if (v <= w) p(0x12, 0x808, w);
    v = y4 - ((sp(35) / 8) | 0) + 0x15; p(0x13, 0x808, v); w = y4 + 0xe; if (v <= w) p(0x13, 0x808, w);
    var hx = s[0x4410 >> 2];
    if (hx < 10) {                                 // against the level before it: a rise opens the eyes, a fall swings the limbs
      var hp = hx - 1;
      if (hx === 0) hp = 9;
      s[0x45cc >> 2] = hp;
      var rise = hist(hp) < hist(hx), fall = hist(hx) < hist(hp);
      p(5, 0x890, rise ? 0x1b : 0); p(5, 0x77c, 3);
      p(6, 0x890, fall ? 0x1e : 0); p(6, 0x77c, 3);
      if (lv() < 0x3c) p(6, 0x890, 0);
      if (lv() < 0x1e) p(5, 0x890, 0);
      p(0x17, 0x7e8, g(5, 0x7e8) + (g(5, 0x890) === 0 ? 0x33 : 0x2e));
      p(0x18, 0x7e8, g(5, 0x7e8) - (g(5, 0x890) === 0 ? 0x59 : 0x54));
      var mm = g(0x17, 0x7cc), tt = g(0x17, 0x7d0);
      if (tt !== 0 && (mm === 3 || mm === 2 || mm === 1)) {
        var dd = (tt & 1) !== 0 ? -10 : 10;
        p(0x17, 0x7e8, g(0x17, 0x7e8) + dd); p(0x18, 0x7e8, g(0x18, 0x7e8) + dd);
      }
      var rb = rand();
      if ((rb & 7) === 0 && s[SN_BFD4 >> 2] === 0) { s[SN_BFD4 >> 2] = 0xe; p(7, 0x850, 5); p(8, 0x850, 5); }
      else { if (s[SN_BFD4 >> 2] !== 0) s[SN_BFD4 >> 2]--; p(7, 0x850, 0); p(8, 0x850, 0); }
      var add = (k: number, dx: number, dy: number): void => { if (dx) p(k, 0x7e8, g(k, 0x7e8) + dx); if (dy) p(k, 0x808, g(k, 0x808) + dy); };
      var m4 = g(4, 0x7cc);
      if (m4 === 1 && fall) { add(4, 4, -3); add(0xe, 3, 0); }
      if (m4 === 2 && fall) { add(4, -4, -3); add(0xe, -3, 0); }
      if (m4 === 3) { if (rise) { add(4, 4, -3); add(0xe, 3, 0); } else { add(4, -4, -3); add(0xe, -3, 0); } }
      if (m4 === 4 && fall) { add(7, 4, 4); add(8, 4, -4); add(0xf, -1, 7); add(0x16, -1, -7); add(0x10, -2, 6); add(0x15, -2, -6); add(0x11, -3, 4); add(0x14, -3, -4); add(0x12, -3, 0); add(0x13, -3, 0); }
      if (m4 === 5 && fall) { add(7, -4, -4); add(8, -4, 4); add(0xf, 1, -7); add(0x16, 1, 7); add(0x10, 2, -6); add(0x15, 2, 6); add(0x11, 3, -4); add(0x14, 3, 4); add(0x12, 3, 0); add(0x13, 3, 0); }
      if (5 < m4 && fall) { add(7, 0, 4); add(8, 0, 4); add(0xf, 0, 7); add(0x16, 0, 7); add(0x10, 0, 6); add(0x15, 0, 6); add(0x11, 0, 4); add(0x14, 0, 4); add(0x12, 0, 4); add(0x13, 0, 4); }
      if (g(0x19, 0x7cc) === 1) {
        p(0x19, 0x910, 0); p(7, 0x850, 5); p(8, 0x850, 5);
        if (g(0x19, 0x890) === 0) { p(0x19, 0x890, 0x1b); p(0x19, 0x88c, 0x1b); } else { p(0x19, 0x890, 0); p(0x19, 0x88c, 0); }
        p(0x19, 0x77c, 3);
        return;
      }
      p(0x19, 0x910, -1);
    }
  },
};

// ---------------------------------------------------------------- Dungeon Siege (dungeon.dll, 2001)
// Trilogy I's engine (`ver` 2: the fps clock, the 2001 bars) with 55 layer records, a presetStep of its own (step layer 3), a
// default scene on table 8 and a program of two presets (Poster; Lurking in the dark lies an enemy...), each moved by the sound and,
// in the second, by a story of whole seconds on the real clock (timeGetTime). Program 0x10017650. Fields of its own, kept above the
// object: the time and speed scales (obj+0xcbc4 = 3 / (fps + 1), obj+0xcbc0 = (fps + 1) / 3), a countdown (+0x23c, 0x14 from the
// constructor) and the story's state with its limit and stamps (+0x244..0x254).
const DG_CBC4 = 0x4fa0, DG_CBC0 = 0x4fa4, DG_23C = 0x4fa8, DG_244 = 0x4fac, DG_248 = 0x4fb0, DG_24C = 0x4fb4, DG_250 = 0x4fb8,
  DG_254 = 0x4fbc;

/** vt+0x90 0x10003b10: the current layer's picture without alpha (every pixel & 0xffffff, w * h + 1 of them as the DLL's <= loop
 *  has it), obj+0x43ec and obj+0x45cc left where that loop ended. The byte before the pixels is cleared too: it is the low byte
 *  of glowRing's parameter signature, so the ring is worked out again over the stripped picture. */
function stripAlpha(c: Core): void {
  var s = c.m.I, b = LY(s[0x44a8 >> 2]), n = Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f4)]);
  if (n === 0) return;
  var p = s[b + lf(0x794)] >> 2, i = 0;
  s[0x43ec >> 2] = s[b + lf(0x794)];
  c.m.B[s[b + lf(0x794)] - 4] = 0;
  if (n >= 0) for (; i <= n; i++) c.m.U[p + i] &= 0xffffff;
  s[0x43ec >> 2] = (p + i) << 2;
  s[0x45cc >> 2] = i;
}

const DUNGEON: PlusDll = {
  ver: 2, presets: 2, stepLayer: 3, bars: true, table: 8, layers: 0x37, zeroClock: true, noSpec: true,
  scene: [
    [0x910, 0x0, 0x76c, 0x2, 0x7fc, 0x479, 0x7e8, 0x453, 0x7ec, -0x1da, 0x808, 0x0, 0x78c, 0x0, 0x790, 0x8, 0x7e4, 0x1, 0x94c, 0x1, 0x77c, 0x2],
    [0x76c, 0x2, 0x7fc, 0x58c, 0x7e8, 0x522, 0x7ec, -0x191, 0x808, 0x0, 0x78c, 0x8, 0x790, 0x1, 0x7e4, -0x1, 0x77c, 0x2],
    [0x76c, 0x2, 0x910, 0x0, 0x7fc, 0x58c, 0x7e8, 0x453, 0x7ec, -0x1db, 0x808, 0x0, 0x78c, 0x8, 0x790, 0x1, 0x7e4, -0x1, 0x144, F(2), 0x94c, 0x1, 0xf0, F(300), 0x114, F(1), 0x118, F(0.5), 0x944, 0x2, 0x77c, 0x2],
    [0x76c, 0x2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x808, 0x0, 0x78c, 0x8, 0x790, 0x1, 0x7e4, 0x0, 0x94c, 0x1, 0x910, -0x1, 0x77c, 0x2],
    [0x808, 0x0, 0x7e4, 0x0, 0x76c, 0x2, 0x7fc, 0x58c, 0x7e8, 0x524, 0x7ec, -0x191, 0x78c, 0x8, 0x790, 0x1, 0x910, -0x1, 0x77c, 0x2],
    [0x76c, 0x2, 0x7fc, 0x58c, 0x7e8, 0x4f5, 0x7ec, 0x35, 0x808, -0x2e, 0x78c, 0x8, 0x790, 0x1, 0x7e4, -0x1, 0x910, -0x1, 0x77c, 0x2],
  ],
  ctor: (c: Core): void => { c.m.I[DG_23C >> 2] = 0x14; },
  images: (): MusicalImage[] => dungeonImages(),
  program(c: Core): void {                       // 0x10017650
    var s = head(c), fv = c.m.F, id = s[0x47bc >> 2], v = 0, r = 0, q = 0, now = 0;
    if (id === 1) {
      if (s[0x4574 >> 2] === 0) {
        gs(s, [0x4574, 1]);
        c.canvasPlus(); s = c.m.I; fv = c.m.F;
        gs(s, [0x463c, 0x14, 0x457c, 0, 0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
        ls(s, 0, [0x7e8, 0x87, 0x7ec, 0, 0x78c, 3, 0x790, 1]);
        ls(s, 1, [0x910, -1, 0x76c, -1]);
        ls(s, 2, [0x910, -1, 0x76c, -1]);
        ls(s, 3, [0x910, -1, 0x76c, -1]);
        ls(s, 4, [0x910, 0, 0x76c, 2]);
        ls(s, 5, [0x910, 0, 0x76c, 2]);
        ls(s, 6, [0x910, -1, 0x76c, -1]);
        ls(s, 7, [0x910, 0, 0x76c, 2]);
        ls(s, 4, [0x7e8, 0x87, 0x7ec, 0, 0x78c, 8, 0x790, 2]);
        ls(s, 5, [0x7e8, 0, 0x7ec, 0x9c, 0x808, 0x9d, 0x78c, 8, 0x790, 0x11, 0x7e4, 0]);
        ls(s, 7, [0x7e8, 0x113, 0x7ec, 100, 0x808, 0x7c, 0x7e4, 0xffffff, 0x78c, 8, 0x790, 5, 0x870, 3, 0x830, 8, 0x850, 0x50, 0x84c, 0x100, 0x118, 0x40000000, 0x77c, 3]);
        gs(s, [0x44a8, 7]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 8, [0x7e8, 8, 0x7ec, 0, 0x808, 0, 0x78c, 8, 0x790, 6, 0x76c, 2, 0x7e4, -1, 0x910, -1, 0x77c, 2]);
        gs(s, [0x44a8, 8]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        c.alphaFromBlue(); s = c.m.I; fv = c.m.F;
        ls(s, 9, [0x76c, 2, 0x7e8, 0x113, 0x7ec, 100, 0x808, 0x7c, 0x78c, 8, 0x830, 8]);
        gs(s, [0x44a8, 9]);
        ls(s, 9, [0x7e4, 0xffffff, 0x790, 7, 0x870, 3, 0x850, 0x50, 0x84c, 0x100, 0x118, 0x40c00000]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 10, [0x7ec, 0x69, 0x808, 0x69]);
        ls(s, 9, [0x77c, 3]);
        ls(s, 10, [0x76c, 2, 0x7e8, 0x113, 0x7e4, 0xffffff, 0x78c, 8, 0x790, 8, 0x77c, 3]);
        ls(s, 0xb, [0x76c, 2, 0x7e8, 0x102, 0x7ec, 0x132, 0x808, 0xca, 0x7e4, 0, 0x78c, 8, 0x790, 9, 0x77c, 3]);
        ls(s, 0xc, [0x76c, 2, 0x7ec, -0xb7, 0x7e4, 0, 0x78c, 8, 0x790, 0xb, 0x77c, 3, 0x7cc, -4, 0x124, 0x437f0000, 0x870, 3, 0x850, 1, 0x84c, 200]);
        r = rand();
        s[LY(0xc) + lf(0x7d4)] = (r & 3) + 1;
        r = rand();
        s[LY(0xc) + lf(0x808)] = -0x78 - (r & 0x7f);
        r = rand();
        v = (r & 0xff) - 0x41;
        s[LY(0xc) + lf(0x7e8)] = v;
        if (100 < v) {
          s[LY(0xc) + lf(0x7e8)] = (r & 0xff) - 0xa5;
        }
        ls(s, 0xd, [0x76c, 2]);
        s[LY(0xd) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        ls(s, 0xd, [0x7ec, -0x7c]);
        s[LY(0xd) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x2a;
        ls(s, 0xd, [0x7e4, -1, 0x78c, 8, 0x790, 0xe, 0x910, -1, 0x77c, 3, 0x0e4, 0x41200000, 0x830, 0xf, 0x870, 3, 0x850, 1, 0x84c, 1, 0x118, 0x41200000]);
        gs(s, [0x44a8, 0xd]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 0xe, [0x76c, 2]);
        s[LY(0xe) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        ls(s, 0xe, [0x7ec, -0xb7]);
        s[LY(0xe) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x75;
        ls(s, 0xe, [0x7e4, -1, 0x78c, 8, 0x790, 0xf, 0x910, -1, 0x830, 0xf, 0x77c, 3, 0x870, 3, 0x850, 1, 0x84c, 1, 0x118, 0x41600000]);
        gs(s, [0x44a8, 0xe]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 0xf, [0x76c, 2, 0x7e8, 0, 0x7ec, -0xb7, 0x808, -0xbe, 0x7e4, -1, 0x78c, 8, 0x790, 0x10, 0x910, -1, 0x77c, 2]);
        gs(s, [0x44a8, 0xf]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        c.alphaFromBlue(); s = c.m.I; fv = c.m.F;
        ls(s, 0x10, [0x76c, 2]);
        s[LY(0x10) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)];
        ls(s, 0x10, [0x7ec, -0xb7]);
        s[LY(0x10) + lf(0x808)] = s[LY(0xc) + lf(0x808)];
        ls(s, 0x10, [0x7e4, 0, 0x78c, 8, 0x790, 0xd, 0x77c, 3, 0x870, 2, 0x850, 0x23, 0x84c, 0x100, 0x124, 0x437f0000, 0x910, -1]);
        ls(s, 0x11, [0x76c, 2, 0x7e8, 0x16, 0x7ec, -0xfa, 0x808, -0x32, 0x78c, 8]);
        r = rand();
        s[LY(0x11) + lf(0x790)] = (r & 7) + 0x16;
        ls(s, 0x11, [0x7e4, 0]);
        r = rand();
        s[LY(0x11) + lf(0x7cc)] = (r & 0x3f) + 0x28;
        ls(s, 0x11, [0x0e4, 0, 0x0e0, 0x42c80000]);
        ls(s, 0x12, [0x76c, 2, 0x7e8, 0x135, 0x7ec, 0x131, 0x808, 0x4e, 0x7e4, 0, 0x78c, 8, 0x790, 0x12, 0x910, -1, 0x77c, 2]);
        gs(s, [0x44cc, 0xaf, 0x44c0, 5, 0x44bc, 0x3c, 0x44c8, 1, 0x44d0, 0x14]);
        return;
      }
      fv[DG_CBC4 >> 2] = (3.0 / (s[TR_FPS >> 2] + 1));
      fv[DG_CBC0 >> 2] = ((s[TR_FPS >> 2] + 1) * 0.3333333333333333);
      fv[XF(0xd) + xf(0x0e4)] = (fv[DG_CBC4 >> 2] * 10.0);
      fv[XF(0xe) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 14.0);
      fv[XF(0xd) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 10.0);
      fv[XF(9) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 6.0);
      fv[XF(7) + xf(0x118)] = (fv[DG_CBC4 >> 2] + fv[DG_CBC4 >> 2]);
      if (s[0x440c >> 2] < 0x29) {
        ls(s, 0x12, [0x910, -1]);
      } else {
        v = s[LY(0x12) + lf(0x7d0)];
        if (v === 0) {
          v = s[LY(0x12) + lf(0x7d4)];
          if (v === 0) {
            q = ftol((rand() & 0x1f) * fv[DG_CBC0 >> 2] + 20);
            s[LY(0x12) + lf(0x7d0)] = q;
            r = rand();
            s[0x4e78 >> 2] = r & 3;
            if ((r & 3) === 0) {
              q = ftol((rand() & 0x1f) * fv[DG_CBC0 >> 2] + 7);
              s[LY(0x12) + lf(0x7d4)] = q;
              ls(s, 0x12, [0x790, 1, 0x7e8, 0x102, 0x7ec, 0x13c, 0x808, 0xda]);
            }
            v = s[0x4e78 >> 2];
            if (1 < v) {
              q = ftol((rand() & 0xf) * fv[DG_CBC0 >> 2] + 17);
              s[LY(0x12) + lf(0x7d4)] = q;
              ls(s, 0x12, [0x790, 0xc, 0x7e8, 0x10a, 0x7ec, 0x137, 0x808, 0xb0]);
              v = s[0x4e78 >> 2];
            }
            if (v === 1) {
              q = ftol((rand() & 0x7f) * fv[DG_CBC0 >> 2] + 60);
              s[LY(0x12) + lf(0x7d4)] = q;
              ls(s, 0x12, [0x790, 0x12, 0x7e8, 0x131, 0x7ec, 0x132, 0x808, 0x4b]);
            }
          } else {
            s[LY(0x12) + lf(0x7d4)] = v + -1;
            if (s[0x440c >> 2] < s[LY(0x12) + lf(0x7cc)]) {
              ls(s, 0x12, [0x910, -1]);
            } else {
              ls(s, 0x12, [0x910, 0]);
            }
          }
          s[LY(0x12) + lf(0x7cc)] = s[0x440c >> 2];
          if (s[LY(0x12) + lf(0x790)] === 0xc) {
            ls(s, 0x12, [0x7cc, 0]);
          }
        } else {
          s[LY(0x12) + lf(0x7d0)] = v + -1;
          ls(s, 0x12, [0x910, -1]);
        }
      }
      v = s[LY(7) + lf(0x850)];
      if (s[0x440c >> 2] < 0xb) {
        if (v < 0xa1) {
          s[LY(7) + lf(0x850)] = v + 4;
          v = s[LY(9) + lf(0x850)];
          ls(s, 7, [0x910, 0]);
          s[LY(9) + lf(0x850)] = v + 4;
          ls(s, 9, [0x910, 0]);
          ls(s, 7, [0x77c, 3]);
          ls(s, 9, [0x77c, 3]);
        } else {
          ls(s, 7, [0x910, -1]);
          ls(s, 9, [0x910, -1]);
          ls(s, 10, [0x910, -1]);
          ls(s, 0xb, [0x790, 9, 0x910, 0]);
        }
      } else if (v === 9) {
        ls(s, 10, [0x910, 0]);
      } else {
        s[LY(7) + lf(0x850)] = v + -1;
        s[LY(9) + lf(0x850)] = s[LY(9) + lf(0x850)] + -1;
        if (v + -1 < 9) {
          ls(s, 7, [0x850, 9]);
          ls(s, 9, [0x850, 9]);
        }
      }
      v = s[LY(7) + lf(0x7cc)];
      if (v === 0) {
        ls(s, 7, [0x910, 0]);
        ls(s, 9, [0x910, 0]);
      } else {
        s[LY(7) + lf(0x7cc)] = v + -1;
      }
      ls(s, 7, [0x77c, 3]);
      ls(s, 9, [0x77c, 3]);
      v = (s[0x17e0 >> 2] + (s[0x17e0 >> 2] >> 0x1f & 3)) >> 2;
      s[LY(7) + lf(0x874)] = v;
      if (0xf < v) {
        ls(s, 7, [0x874, 0xf]);
      }
      v = (s[0x17b8 >> 2] / 3) | 0;
      s[LY(9) + lf(0x878)] = v;
      if (0xf < v) {
        ls(s, 9, [0x878, 0xf]);
      }
      v = ((s[0x440c >> 2] + (s[0x440c >> 2] >> 0x1f & 0xf)) >> 4) * 0x20;
      s[0x4e78 >> 2] = v;
      if (0xff < v) {
        gs(s, [0x4e78, 0xff]);
      }
      fv[XF(10) + xf(0x124)] = (0xff - s[0x4e78 >> 2]);
      ls(s, 10, [0x77c, 3]);
      if (fv[XF(0x11) + xf(0x124)] < 200.0) {
        if (s[LY(0x11) + lf(0x7d0)] === 1) {
          q = ftol(fv[DG_CBC0 >> 2] * 20);
          s[LY(0x11) + lf(0x7cc)] = q;
        } else {
          v = s[LY(0x11) + lf(0x7cc)];
          if (v === 0) {
            fv[XF(0x11) + xf(0x0e4)] = (fv[DG_CBC4 >> 2] * 5.0);
            s[LY(0x11) + lf(0x7e8)] = 0x41 - ((s[LY(0x11) + lf(0x7f4)] / 2) | 0);
            s[LY(0x11) + lf(0x808)] = ((s[LY(0x11) + lf(0x7f8)] / 2) | 0) - 0x1ea;
            v = s[LY(0x11) + lf(0x7f8)];
            if (0x85 < v) {
              s[LY(0x11) + lf(0x808)] = ((v / 2) | 0) - 0x1ea;
            }
            v = s[LY(0x11) + lf(0x7f8)];
            if (v < 0x69) {
              s[LY(0x11) + lf(0x808)] = ((v + (v >> 0x1f & 3)) >> 2) + -0x1ef;
            }
            if (180.0 <= fv[XF(0x11) + xf(0x0e0)]) {
              fv[XF(0x11) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 5.0);
              if (fv[XF(0x11) + xf(0x124)] < 100.0) {
                ls(s, 0x11, [0x0e0, 0x43340000]);
              }
            } else {
              ls(s, 0x11, [0x124, 0, 0x128, 0]);
            }
            q = ftol((fv[(0x37d8 >> 2) + ftol(fv[XF(0x11) + xf(0xe0)])] + 1) * s[LY(0x11) + lf(0x7f8)]);
            s[LY(0x11) + lf(0x808)] = s[LY(0x11) + lf(0x808)] - q;
            ls(s, 0x11, [0x910, 0, 0x77c, 3]);
            if (s[LY(0xd) + lf(0x910)] === -1) {
              gs(s, [0x44a8, 0xd]);
              stripAlpha(c); s = c.m.I; fv = c.m.F;
              gs(s, [0x44a8, 0xe]);
              stripAlpha(c); s = c.m.I; fv = c.m.F;
            }
            ls(s, 0xd, [0x7e8, -0x22, 0x7ec, 0xc3, 0x808, -0x28, 0x124, 0x429c0000]);
            ls(s, 0xe, [0x124, 0]);
            ls(s, 0xd, [0x910, 0]);
            ls(s, 0xe, [0x7e8, -0x2b, 0x7ec, -0xb7, 0x808, -0x1cb, 0x910, 0]);
            ls(s, 0xd, [0x77c, 3]);
            ls(s, 0xe, [0x77c, 3]);
            if (130.0 < fv[XF(0x11) + xf(0x124)]) {
              q = ftol(fv[XF(0x11) + xf(0x124)] - 130);
              s[LY(0xd) + lf(0x808)] = -0x28 - q;
              q = ftol(fv[XF(0x11) + xf(0x124)] - 130);
              s[LY(0xe) + lf(0x808)] = -0x1cb - q;
            }
          } else {
            s[LY(0x11) + lf(0x7cc)] = v + -1;
          }
        }
      } else {
        ls(s, 0x11, [0x124, 0, 0x128, 0, 0x910, -1]);
        q = ftol((rand() & 0x1f) * fv[DG_CBC0 >> 2] + 20);
        s[LY(0x11) + lf(0x7cc)] = q;
        ls(s, 0x11, [0x0e0, 0x42c80000, 0x0e4, 0]);
        ls(s, 0xd, [0x910, -1]);
        ls(s, 0xe, [0x910, -1]);
        r = rand();
        v = s[LY(0x11) + lf(0x790)] + (r & 3) + 1;
        s[LY(0x11) + lf(0x790)] = v;
        if (0x1f < v) {
          r = rand();
          s[LY(0x11) + lf(0x790)] = (r & 1) + 0x16;
        }
      }
      l1851c: {
        v = s[LY(0xb) + lf(0x7cc)];
        if (v === 0) {
          if (s[DG_23C >> 2] === 0) {
            q = ftol(((rand() & 0x3f) + 0x18) * fv[DG_CBC0 >> 2]);
            s[DG_23C >> 2] = q;
            ls(s, 0xb, [0x910, 0]);
          } else {
            s[DG_23C >> 2] = s[DG_23C >> 2] + -1;
            ls(s, 0xb, [0x910, -1]);
            if (5 < s[0x440c >> 2]) break l1851c;
            q = ftol(((rand() & 0x3f) + 0x18) * fv[DG_CBC0 >> 2]);
            s[DG_23C >> 2] = q;
            ls(s, 0xb, [0x910, 0]);
          }
        } else {
          s[LY(0xb) + lf(0x7cc)] = v + -1;
          ls(s, 0xb, [0x910, 0]);
          ls(s, 10, [0x910, 0]);
        }
        if ((s[LY(7) + lf(0x910)] === -1) && (s[LY(10) + lf(0x910)] === 0)) {
          ls(s, 0xb, [0x910, -1]);
        } else if (s[LY(10) + lf(0x910)] !== -1 && fv[XF(10) + xf(0x124)] <= 180.0) {
          ls(s, 0xb, [0x790, 10]);
        } else {
          ls(s, 0xb, [0x790, 9]);
        }
      }
      if (s[LY(0x10) + lf(0x910)] === 0) {
        ls(s, 7, [0x910, -1]);
        ls(s, 9, [0x910, -1]);
        ls(s, 10, [0x910, -1]);
        ls(s, 0xb, [0x790, 9, 0x910, 0, 0x7cc, 10]);
        ls(s, 7, [0x7cc, 0x11]);
        ls(s, 0x12, [0x910, -1]);
      }
      if (s[XF(0xc) + xf(0x124)] === 0x437f0000) {
        ls(s, 0xc, [0x910, -1]);
      } else {
        ls(s, 0xc, [0x910, 0]);
        s[LY(0xc) + lf(0x850)] = ((0xff - s[0x440c >> 2]) / 0x32) | 0;
        gs(s, [0x44a8, 0xc]);
        ls(s, 0xc, [0x77c, 3]);
        stripAlpha(c); s = c.m.I; fv = c.m.F;
      }
      if (s[XF(0xe) + xf(0x124)] === 0x437f0000) {
        ls(s, 0xe, [0x910, -1]);
        ls(s, 0x11, [0x7d0, 0]);
      }
      if (s[XF(0x10) + xf(0x124)] === 0x437f0000) {
        ls(s, 0x10, [0x910, -1]);
      }
      if (fv[XF(0x10) + xf(0x124)] < 100.0 && fv[XF(0x10) + xf(0x128)] < 0.0) {
        ls(s, 0x10, [0x128, 0]);
      }
      if (fv[XF(0xe) + xf(0x124)] === 0.0 && s[LY(0xe) + lf(0x910)] === 0) {
        if (s[LY(0xd) + lf(0x910)] === -1) {
          ls(s, 0xd, [0x910, 0]);
          gs(s, [0x44a8, 0xd]);
          stripAlpha(c); s = c.m.I; fv = c.m.F;
          ls(s, 0xd, [0x0e0, 0]);
          fv[XF(0x10) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -20.0);
          ls(s, 0x10, [0x910, 0]);
        }
        if (s[LY(0x11) + lf(0x910)] === -1) {
          if (350.0 <= fv[XF(0xd) + xf(0x0e0)]) {
            ls(s, 0xd, [0x910, -1]);
            ls(s, 0xc, [0x7d0, 0]);
            fv[XF(0xe) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 10.0);
            fv[XF(0x10) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 10.0);
          } else {
            q = ftol(fv[XF(0xd) + xf(0xe0)]);
            fv[XF(0xd) + xf(0x124)] = ((fv[(0x37d8 >> 2) + q] + 1.0) * 128.0);
            ls(s, 0xd, [0x77c, 3]);
          }
        }
      }
      v = s[LY(0xc) + lf(0x7d0)];
      if (v !== 0) {
        s[LY(0xc) + lf(0x7d0)] = v + -1;
        return;
      }
      fv[XF(0xc) + xf(0x124)] = (s[LY(0xc) + lf(0x7cc)] + fv[XF(0xc) + xf(0x124)]);
      ls(s, 0xc, [0x77c, 3]);
      ls(s, 0x10, [0x77c, 3]);
      if (fv[XF(0xc) + xf(0x124)] <= 0.0) {
        ls(s, 0xc, [0x124, 0]);
        q = ftol((((rand() >> 2) & 0xf) + 3) * fv[DG_CBC0 >> 2]);
        s[LY(0xc) + lf(0x7cc)] = q;
        q = ftol((rand() & 0xf) * fv[DG_CBC0 >> 2] + 10);
        s[LY(0xc) + lf(0x7d0)] = q;
        v = s[LY(0xc) + lf(0x7d4)];
        if (v !== 0) {
          s[LY(0xc) + lf(0x7d4)] = v + -1;
          return;
        }
        if (0x40 < s[LY(0xc) + lf(0x7e8)]) {
          return;
        }
        if (-0xfb < s[LY(0xc) + lf(0x808)]) {
          return;
        }
        if (s[LY(0xd) + lf(0x910)] !== -1) {
          return;
        }
        if (s[LY(0xe) + lf(0x910)] !== -1) {
          return;
        }
        if (s[LY(0x11) + lf(0x910)] !== -1) {
          return;
        }
        ls(s, 0x11, [0x7d0, 1]);
        r = rand();
        s[LY(0xc) + lf(0x7d4)] = (r & 3) + 3;
        ls(s, 0xe, [0x124, 0x43020000]);
        fv[XF(0xe) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -25.0);
        gs(s, [0x44a8, 0xe]);
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 0xe, [0x910, 0, 0x77c, 3]);
      }
      if (fv[XF(0xc) + xf(0x124)] < 255.0 || s[LY(0x10) + lf(0x910)] !== -1) {
        return;
      }
      ls(s, 0xc, [0x124, 0x437f0000]);
      q = ftol((-3 - ((rand() >> 2) & 0xf)) * fv[DG_CBC4 >> 2]);
      s[LY(0xc) + lf(0x7cc)] = q;
      q = ftol((rand() & 0xf) * fv[DG_CBC0 >> 2] + 20);
      s[LY(0xc) + lf(0x7d0)] = q;
      if ((((s[LY(0xc) + lf(0x7d4)] < 1) && (s[LY(0xd) + lf(0x910)] === -1)) && (s[LY(0xe) + lf(0x910)] === -1)) &&
      (s[LY(0x11) + lf(0x910)] === -1)) {
        r = rand();
        s[LY(0xc) + lf(0x808)] = -0x122 - (r & 0x3f);
        r = rand();
        s[LY(0xc) + lf(0x7e8)] = (r & 0x3f) - 0x14;
        ls(s, 0x11, [0x7d0, 1]);
      } else {
        r = rand();
        s[LY(0xc) + lf(0x808)] = -0x78 - (r & 0x7f);
        r = rand();
        v = (r & 0xff) - 0x41;
        s[LY(0xc) + lf(0x7e8)] = v;
        if (100 < v) {
          s[LY(0xc) + lf(0x7e8)] = (r & 0xff) - 0xa5;
        }
      }
      if (s[LY(0x11) + lf(0x910)] !== 0) {
        s[LY(0xd) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        ls(s, 0xd, [0x7ec, -0x7c]);
        s[LY(0xd) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x2a;
        s[LY(0xe) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        s[LY(0xe) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x75;
      }
      s[LY(0x10) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)];
      s[LY(0x10) + lf(0x808)] = s[LY(0xc) + lf(0x808)];
      return;
    }
    if (id === 2) {
      if (s[0x4574 >> 2] === 0) {
        gs(s, [0x4574, 1, 0x4efc, 0, 0x4f00, 0, 0x4f04, 0, 0x4ef8, 0]);
        c.canvasPlus(); s = c.m.I; fv = c.m.F;
        gs(s, [0x463c, 0x14, 0x457c, 1, 0x44cc, 0x15e, 0x44bc, 0x32, 0x44d0, 0x43, 0x44d4, 2, 0x44c0, 5]);
        s[DG_244 >> 2] = 0;
        ls(s, 0, [0x910, 0, 0x76c, 2]);
        ls(s, 1, [0x910, -1, 0x76c, 2]);
        ls(s, 2, [0x910, -1, 0x76c, -1]);
        ls(s, 3, [0x910, -1, 0x76c, 2]);
        ls(s, 4, [0x910, -1, 0x76c, 2]);
        ls(s, 5, [0x910, 0, 0x76c, 2]);
        ls(s, 0x13, [0x910, -1]);
        ls(s, 0, [0x7e8, 0, 0x7ec, 0, 0x870, 1, 0x850, 0x74, 0x84c, 0xfa, 0x78c, 8, 0x790, 0x13, 0x7e4, -1, 0x85c, 100, 0x840, 0xff, 0x844, 1, 0x848, 0x41]);
        ls(s, 1, [0x7e8, 0x154, 0x7ec, 1, 0x808, 2, 0x78c, 8, 0x790, 0x14]);
        ls(s, 3, [0x7e8, 0x159, 0x7ec, 1, 0x808, 2, 0x78c, 8, 0x790, 0x15]);
        ls(s, 4, [0x7e8, 0x87, 0x7ec, 0, 0x78c, 8, 0x124, 0x437f0000, 0x790, 2]);
        ls(s, 5, [0x7e8, 0x2c, 0x7ec, 0x9c, 0x808, 0x79, 0x78c, 8, 0x790, 0x11, 0x7e4, 0, 0x870, 3, 0x124, 0x437f0000, 0x128, 0]);
        ls(s, 7, [0x7e8, 0x113, 0x7ec, 100, 0x808, 0x7c, 0x7e4, 0xffffff, 0x78c, 8, 0x790, 5, 0x870, 3, 0x830, 8, 0x850, 0x50, 0x84c, 0x100, 0x118, 0x40000000, 0x910, -1]);
        gs(s, [0x44a8, 7]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 7, [0x77c, 3]);
        ls(s, 8, [0x7e8, 8, 0x7ec, 0, 0x808, 0, 0x78c, 8, 0x790, 6, 0x76c, 2, 0x7e4, -1, 0x910, -1, 0x77c, 2]);
        gs(s, [0x44a8, 8]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        c.alphaFromBlue(); s = c.m.I; fv = c.m.F;
        ls(s, 9, [0x76c, 2, 0x7e8, 0x113, 0x7ec, 100, 0x808, 0x7c, 0x7e4, 0xffffff, 0x78c, 8, 0x790, 7, 0x870, 3, 0x830, 8, 0x850, 0x50, 0x84c, 0x100, 0x118, 0x40c00000, 0x910, -1]);
        gs(s, [0x44a8, 9]);
        ls(s, 9, [0x77c, 3]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 10, [0x7ec, 0x69, 0x808, 0x69, 0x76c, 2, 0x7e8, 0x113, 0x7e4, 0xffffff, 0x78c, 8, 0x790, 8, 0x910, -1, 0x77c, 3]);
        ls(s, 0xb, [0x76c, 2, 0x7e8, 0x102, 0x7ec, 0x132, 0x808, 0xca, 0x7e4, 0, 0x78c, 8, 0x790, 9, 0x910, -1, 0x77c, 3]);
        ls(s, 0xc, [0x76c, 2, 0x7e8, 0, 0x7ec, -0xb7, 0x808, -0x108, 0x7e4, 0, 0x78c, 8, 0x790, 0xb, 0x77c, 3, 0x124, 0x437f0000, 0x870, 3, 0x850, 1, 0x84c, 200]);
        r = rand();
        s[LY(0xc) + lf(0x7d4)] = (r & 3) + 1;
        ls(s, 0xc, [0x910, -1]);
        ls(s, 0xd, [0x76c, 2]);
        s[LY(0xd) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        ls(s, 0xd, [0x7ec, -0x7c]);
        s[LY(0xd) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x2a;
        ls(s, 0xd, [0x7e4, -1, 0x78c, 8, 0x790, 0xe, 0x910, -1, 0x77c, 3, 0x0e4, 0x41200000, 0x830, 0xf, 0x870, 3, 0x850, 1, 0x84c, 1, 0x118, 0x41200000]);
        gs(s, [0x44a8, 0xd]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 0xe, [0x76c, 2]);
        s[LY(0xe) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
        ls(s, 0xe, [0x7ec, -0xb7]);
        s[LY(0xe) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x75;
        ls(s, 0xe, [0x7e4, -1, 0x78c, 8, 0x790, 0xf, 0x910, -1, 0x830, 0xf, 0x77c, 3, 0x870, 3, 0x850, 1, 0x84c, 1, 0x118, 0x41600000]);
        gs(s, [0x44a8, 0xe]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        ls(s, 0xf, [0x76c, 2, 0x7e8, 0, 0x7ec, -0xb7, 0x808, -0xbe, 0x7e4, -1, 0x78c, 8, 0x790, 0x10, 0x910, -1, 0x77c, 2]);
        gs(s, [0x44a8, 0xf]);
        c.bindImage(); s = c.m.I; fv = c.m.F;
        stripAlpha(c); s = c.m.I; fv = c.m.F;
        c.alphaFromBlue(); s = c.m.I; fv = c.m.F;
        ls(s, 0x10, [0x76c, 2]);
        s[LY(0x10) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)];
        ls(s, 0x10, [0x7ec, -0xb7]);
        s[LY(0x10) + lf(0x808)] = s[LY(0xc) + lf(0x808)];
        ls(s, 0x10, [0x7e4, 0, 0x78c, 8, 0x790, 0xd, 0x77c, 3, 0x870, 2, 0x850, 0x23, 0x84c, 0x100, 0x124, 0x437f0000, 0x910, -1]);
        ls(s, 0x11, [0x76c, 2, 0x7e8, 0x6e, 0x7ec, 0x6e, 0x808, -0xa0, 0x78c, 8, 0x790, 0x16, 0x7e4, 0, 0x124, 0x437f0000, 0x910, -1]);
        ls(s, 0x12, [0x76c, 2, 0x7e8, 0x135, 0x7ec, 0x131, 0x808, 0x4e, 0x7e4, 0, 0x78c, 8, 0x790, 0x12, 0x910, -1, 0x77c, 2]);
        r = rand();
        s[DG_248 >> 2] = (r & 3) + 5;
        now = c.clock();
        s[DG_250 >> 2] = now;
        ls(s, 0x10, [0x7cc, 0]);
        return;
      }
      fv[DG_CBC4 >> 2] = (3.0 / (s[TR_FPS >> 2] + 1));
      fv[DG_CBC0 >> 2] = ((s[TR_FPS >> 2] + 1) * 0.3333333333333333);
      fv[XF(0xd) + xf(0x0e4)] = (fv[DG_CBC4 >> 2] * 10.0);
      fv[XF(0xe) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 14.0);
      fv[XF(0xd) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 10.0);
      fv[XF(9) + xf(0x118)] = (fv[DG_CBC4 >> 2] * 6.0);
      fv[XF(7) + xf(0x118)] = (fv[DG_CBC4 >> 2] + fv[DG_CBC4 >> 2]);
      if (s[DG_244 >> 2] === 0) {
        gs(s, [0x44a8, 0]);
        c.markLayer(); s = c.m.I; fv = c.m.F;
        ls(s, 0, [0x94c, 1]);
        ls(s, 5, [0x910, -1]);
        ls(s, 0, [0x910, 0]);
        if (s[XF(0xc) + xf(0x124)] === 0x437f0000) {
          ls(s, 0xc, [0x910, -1, 0x7cc, 0]);
        } else {
          fv[XF(0xc) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 20.0);
        }
        v = s[LY(0) + lf(0x850)];
        if (v < 0x75) {
          ls(s, 0, [0x850, 0x74]);
        } else {
          s[LY(0) + lf(0x850)] = v + -0x14;
        }
        v = s[LY(0) + lf(0x84c)];
        if (v < 0xfb) {
          ls(s, 0, [0x84c, 0xfa]);
        } else {
          s[LY(0) + lf(0x84c)] = v + -0x14;
        }
        now = c.clock();
        s[DG_254 >> 2] = now;
        v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
        s[DG_24C >> 2] = v;
        if (s[DG_248 >> 2] <= v) {
          s[DG_244 >> 2] = 1;
          ls(s, 5, [0x124, 0x437f0000]);
          fv[XF(5) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -15.0);
          ls(s, 5, [0x910, 0, 0x7e8, 0x2c, 0x808, 0x91, 0x850, 0, 0x77c, 3]);
        }
      }
      if (s[DG_244 >> 2] === 1) {
        gs(s, [0x44a8, 0]);
        c.markLayer(); s = c.m.I; fv = c.m.F;
        if (fv[XF(5) + xf(0x124)] === 0.0) {
          s[DG_244 >> 2] = 2;
          r = rand();
          s[DG_248 >> 2] = (r & 3) + 5;
          now = c.clock();
          s[DG_250 >> 2] = now;
        }
      }
      if (s[DG_244 >> 2] === 2) {
        gs(s, [0x44a8, 0]);
        c.markLayer(); s = c.m.I; fv = c.m.F;
        now = c.clock();
        s[DG_254 >> 2] = now;
        v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
        s[DG_24C >> 2] = v;
        if (s[DG_248 >> 2] <= v) {
          s[DG_244 >> 2] = 3;
          fv[XF(5) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 15.0);
          ls(s, 5, [0x77c, 3]);
        }
      }
      if (s[DG_244 >> 2] === 3) {
        gs(s, [0x44a8, 0]);
        c.markLayer(); s = c.m.I; fv = c.m.F;
        if (s[LY(0x10) + lf(0x7cc)] !== 3) {
          s[LY(0) + lf(0x850)] = s[LY(0) + lf(0x850)] + 7;
          s[LY(0) + lf(0x84c)] = s[LY(0) + lf(0x84c)] + 7;
        }
        if ((230.0 <= fv[XF(5) + xf(0x124)]) && (s[LY(0x10) + lf(0x7cc)] === 3)) {
          ls(s, 5, [0x910, -1]);
          s[DG_244 >> 2] = 8;
        }
        if (230.0 <= fv[XF(5) + xf(0x124)] && 0x15d < s[LY(0) + lf(0x850)]) {
          s[DG_244 >> 2] = 4;
          r = rand();
          s[DG_248 >> 2] = (r & 3) + 7;
          now = c.clock();
          s[DG_250 >> 2] = now;
          ls(s, 0xc, [0x7cc, -0x14]);
          if (s[LY(0x10) + lf(0x7cc)] === 0) {
            ls(s, 0xc, [0x128, 0]);
            s[DG_244 >> 2] = 4;
          }
          v = s[LY(0x10) + lf(0x7cc)];
          if ((v === 1) || (v === 2)) {
            s[DG_244 >> 2] = 5;
            ls(s, 5, [0x808, 0x6d, 0x124, 0x43660000, 0x850, 0, 0x77c, 3]);
          }
        }
      }
      if (s[DG_244 >> 2] === 4) {
        ls(s, 0, [0x910, -1]);
        ls(s, 5, [0x910, -1]);
        if (s[XF(0xc) + xf(0x124)] === 0x437f0000) {
          ls(s, 0xc, [0x910, -1]);
        } else {
          ls(s, 0xc, [0x910, 0]);
          s[LY(0xc) + lf(0x850)] = ((0xff - s[0x440c >> 2]) / 0x32) | 0;
          gs(s, [0x44a8, 0xc]);
          ls(s, 0xc, [0x77c, 3]);
          stripAlpha(c); s = c.m.I; fv = c.m.F;
        }
        if (s[XF(0xe) + xf(0x124)] === 0x437f0000) {
          ls(s, 0xe, [0x910, -1]);
        }
        if (s[XF(0x10) + xf(0x124)] === 0x437f0000) {
          ls(s, 0x10, [0x910, -1]);
        }
        if (fv[XF(0x10) + xf(0x124)] < 100.0 && fv[XF(0x10) + xf(0x128)] < 0.0) {
          ls(s, 0x10, [0x128, 0]);
        }
        if (fv[XF(0xe) + xf(0x124)] === 0.0 && s[LY(0xe) + lf(0x910)] === 0) {
          if (s[LY(0xd) + lf(0x910)] === -1) {
            ls(s, 0xd, [0x910, 0, 0x0e0, 0]);
            fv[XF(0x10) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -20.0);
            ls(s, 0x10, [0x910, 0]);
          }
          if (350.0 <= fv[XF(0xd) + xf(0x0e0)]) {
            ls(s, 0xd, [0x910, -1]);
            ls(s, 0xc, [0x7d0, 0]);
            ls(s, 0x10, [0x7cc, 1]);
            fv[XF(0xe) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 10.0);
            fv[XF(0x10) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 10.0);
          } else {
            q = ftol(fv[XF(0xd) + xf(0xe0)]);
            fv[XF(0xd) + xf(0x124)] = ((fv[(0x37d8 >> 2) + q] + 1.0) * 128.0);
            ls(s, 0xd, [0x77c, 3]);
          }
        }
        l198ca: {
          v = s[LY(0xc) + lf(0x7d0)];
          if (v === 0) {
            fv[XF(0xc) + xf(0x124)] = (s[LY(0xc) + lf(0x7cc)] * fv[DG_CBC4 >> 2] + fv[XF(0xc) + xf(0x124)]);
            ls(s, 0xc, [0x77c, 3]);
            ls(s, 0x10, [0x77c, 3]);
            if (fv[XF(0xc) + xf(0x124)] <= 0.0) {
              ls(s, 0xc, [0x124, 0]);
              r = rand();
              s[LY(0xc) + lf(0x7cc)] = (r & 0xf) + 0x14;
              r = rand();
              s[LY(0xc) + lf(0x7d0)] = (r & 7) + 7;
              v = s[LY(0xc) + lf(0x7d4)];
              if (v !== 0) {
                s[LY(0xc) + lf(0x7d4)] = v + -1;
                break l198ca;
              }
              r = rand();
              s[LY(0xc) + lf(0x7d4)] = (r & 1) + 2;
              ls(s, 0xe, [0x124, 0x43020000]);
              fv[XF(0xe) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -25.0);
              ls(s, 0xe, [0x910, 0, 0x77c, 3]);
            }
            if (255.0 <= fv[XF(0xc) + xf(0x124)] && s[LY(0x10) + lf(0x910)] === -1) {
              ls(s, 0xc, [0x124, 0x437f0000]);
              r = rand();
              s[LY(0xc) + lf(0x7cc)] = -0x14 - (r & 0xf);
              r = rand();
              s[LY(0xc) + lf(0x7d0)] = (r & 7) + 7;
              r = rand();
              s[LY(0xc) + lf(0x7e8)] = r & 0xff;
              r = rand();
              s[LY(0xc) + lf(0x808)] = -0x7c - (r & 0xff);
              s[LY(0xd) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
              s[LY(0xd) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x2a;
              s[LY(0xe) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)] + -0x1d;
              s[LY(0xe) + lf(0x808)] = s[LY(0xc) + lf(0x808)] + -0x75;
              s[LY(0x10) + lf(0x7e8)] = s[LY(0xc) + lf(0x7e8)];
              s[LY(0x10) + lf(0x808)] = s[LY(0xc) + lf(0x808)];
              if (s[LY(0x10) + lf(0x7cc)] === 1) {
                ls(s, 0x10, [0x7cc, 2]);
                ls(s, 0xc, [0x910, -1]);
                ls(s, 0xd, [0x910, -1]);
                ls(s, 0xe, [0x910, -1]);
                ls(s, 0xf, [0x910, -1]);
                ls(s, 0x10, [0x910, -1]);
              }
            }
          } else {
            s[LY(0xc) + lf(0x7d0)] = v + -1;
          }
        }
        if (s[LY(0x10) + lf(0x7cc)] === 2) {
          now = c.clock();
          s[DG_254 >> 2] = now;
          v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
          s[DG_24C >> 2] = v;
          if (s[DG_248 >> 2] <= v) {
            s[DG_244 >> 2] = 0;
            r = rand();
            s[DG_248 >> 2] = (r & 7) + 0x14;
            now = c.clock();
            s[DG_250 >> 2] = now;
          }
        }
      }
      if (s[DG_244 >> 2] === 5) {
        ls(s, 0, [0x910, -1]);
        ls(s, 5, [0x910, 0]);
        v = s[LY(5) + lf(0x7e8)];
        if (v < 1) {
          ls(s, 5, [0x124, 0]);
        } else {
          s[LY(5) + lf(0x7e8)] = v + -1;
          s[LY(5) + lf(0x808)] = s[LY(5) + lf(0x808)] + 1;
        }
        if (fv[XF(5) + xf(0x124)] === 0.0) {
          now = c.clock();
          s[DG_254 >> 2] = now;
          v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
          s[DG_24C >> 2] = v;
          if (s[DG_248 >> 2] <= v) {
            s[DG_244 >> 2] = 6;
            r = rand();
            s[DG_248 >> 2] = (r & 7) + 200;
            now = c.clock();
            s[DG_250 >> 2] = now;
            fv[XF(4) + xf(0x128)] = (fv[DG_CBC4 >> 2] * -6.0);
            ls(s, 4, [0x910, 0]);
          }
        } else {
          ls(s, 5, [0x128, -0x3f400000]);
        }
      }
      if (s[DG_244 >> 2] === 6) {
        if (s[0x440c >> 2] < 0x29) {
          ls(s, 0x12, [0x910, -1]);
        } else {
          v = s[LY(0x12) + lf(0x7d0)];
          if (v === 0) {
            v = s[LY(0x12) + lf(0x7d4)];
            if (v === 0) {
              r = rand();
              s[LY(0x12) + lf(0x7d0)] = (r & 0x1f) + 0x14;
              r = rand();
              s[0x4e78 >> 2] = r & 3;
              if ((r & 3) === 0) {
                r = rand();
                s[LY(0x12) + lf(0x7d4)] = (r & 0x1f) + 7;
                ls(s, 0x12, [0x790, 1, 0x7e8, 0x102, 0x7ec, 0x13c, 0x808, 0xda]);
              }
              v = s[0x4e78 >> 2];
              if (1 < v) {
                r = rand();
                s[LY(0x12) + lf(0x7d4)] = (r & 0xf) + 0x11;
                ls(s, 0x12, [0x790, 0xc, 0x7e8, 0x10a, 0x7ec, 0x137, 0x808, 0xb0]);
                v = s[0x4e78 >> 2];
              }
              if (v === 1) {
                r = rand();
                s[LY(0x12) + lf(0x7d4)] = (r & 0x7f) + 0x3c;
                ls(s, 0x12, [0x790, 0x12, 0x7e8, 0x131, 0x7ec, 0x132, 0x808, 0x4b]);
              }
            } else {
              s[LY(0x12) + lf(0x7d4)] = v + -1;
              if (s[0x440c >> 2] < s[LY(0x12) + lf(0x7cc)]) {
                ls(s, 0x12, [0x910, -1]);
              } else {
                ls(s, 0x12, [0x910, 0]);
              }
            }
            s[LY(0x12) + lf(0x7cc)] = s[0x440c >> 2];
            if (s[LY(0x12) + lf(0x790)] === 0xc) {
              ls(s, 0x12, [0x7cc, 0]);
            }
          } else {
            s[LY(0x12) + lf(0x7d0)] = v + -1;
            ls(s, 0x12, [0x910, -1]);
          }
        }
        v = s[LY(7) + lf(0x850)];
        if (s[0x440c >> 2] < 0xb) {
          if (v < 0xa1) {
            s[LY(7) + lf(0x850)] = v + 4;
            v = s[LY(9) + lf(0x850)];
            ls(s, 7, [0x910, 0]);
            s[LY(9) + lf(0x850)] = v + 4;
            ls(s, 9, [0x910, 0]);
            ls(s, 7, [0x77c, 3]);
            ls(s, 9, [0x77c, 3]);
          } else {
            ls(s, 7, [0x910, -1]);
            ls(s, 9, [0x910, -1]);
            ls(s, 10, [0x910, -1]);
            ls(s, 0xb, [0x790, 9, 0x910, 0]);
          }
        } else if (v === 9) {
          ls(s, 10, [0x910, 0]);
        } else {
          s[LY(7) + lf(0x850)] = v + -1;
          s[LY(9) + lf(0x850)] = s[LY(9) + lf(0x850)] + -1;
          if (v + -1 < 9) {
            ls(s, 7, [0x850, 9]);
            ls(s, 9, [0x850, 9]);
          }
        }
        v = s[LY(7) + lf(0x7cc)];
        if (v === 0) {
          ls(s, 7, [0x910, 0]);
          ls(s, 9, [0x910, 0]);
        } else {
          s[LY(7) + lf(0x7cc)] = v + -1;
        }
        ls(s, 7, [0x77c, 3]);
        ls(s, 9, [0x77c, 3]);
        v = (s[0x17e0 >> 2] + (s[0x17e0 >> 2] >> 0x1f & 3)) >> 2;
        s[LY(7) + lf(0x874)] = v;
        if (0xf < v) {
          ls(s, 7, [0x874, 0xf]);
        }
        v = (s[0x17b8 >> 2] / 3) | 0;
        s[LY(9) + lf(0x878)] = v;
        if (0xf < v) {
          ls(s, 9, [0x878, 0xf]);
        }
        v = ((s[0x440c >> 2] + (s[0x440c >> 2] >> 0x1f & 0xf)) >> 4) * 0x20;
        s[0x4e78 >> 2] = v;
        if (0xff < v) {
          gs(s, [0x4e78, 0xff]);
        }
        fv[XF(10) + xf(0x124)] = (0xff - s[0x4e78 >> 2]);
        ls(s, 10, [0x77c, 3]);
        var sel = true;
        v = s[LY(0xb) + lf(0x7cc)];
        if (v !== 0) {
          s[LY(0xb) + lf(0x7cc)] = v + -1;
          ls(s, 0xb, [0x910, 0]);
          ls(s, 10, [0x910, 0]);
        } else if (s[DG_23C >> 2] === 0) {
          s[DG_23C >> 2] = (rand() & 0x3f) + 0x18;
          ls(s, 0xb, [0x910, 0]);
        } else {
          s[DG_23C >> 2] = s[DG_23C >> 2] + -1;
          ls(s, 0xb, [0x910, -1]);
          if (s[0x440c >> 2] < 6) {
            s[DG_23C >> 2] = (rand() & 0x3f) + 0x18;
            ls(s, 0xb, [0x910, 0]);
          } else sel = false;
        }
        if (sel) {
          if (s[LY(10) + lf(0x910)] !== -1 && fv[XF(10) + xf(0x124)] <= 180.0) ls(s, 0xb, [0x790, 10]);
          else ls(s, 0xb, [0x790, 9]);
        }
        if (fv[XF(4) + xf(0x124)] !== 0.0) {
          ls(s, 7, [0x910, -1]);
          ls(s, 9, [0x910, -1]);
          ls(s, 10, [0x910, -1]);
          ls(s, 0xb, [0x790, 9, 0x910, -1]);
          ls(s, 7, [0x7cc, 0x11]);
          ls(s, 0x12, [0x910, -1]);
        }
        if (fv[XF(4) + xf(0x124)] === 0.0) {
          now = c.clock();
          s[DG_254 >> 2] = now;
          v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
          s[DG_24C >> 2] = v;
          if (s[DG_248 >> 2] <= v) {
            s[DG_244 >> 2] = 7;
            r = rand();
            s[DG_248 >> 2] = (r & 7) + 0x14;
            now = c.clock();
            s[DG_250 >> 2] = now;
            fv[XF(5) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 6.0);
            fv[XF(4) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 6.0);
            ls(s, 7, [0x910, -1]);
            ls(s, 9, [0x910, -1]);
            ls(s, 10, [0x910, -1]);
            ls(s, 0xb, [0x790, 9, 0x910, -1]);
            ls(s, 7, [0x7cc, 0x11]);
            ls(s, 0x12, [0x910, -1]);
          }
        }
      }
      if ((s[DG_244 >> 2] === 7) && (230.0 <= fv[XF(5) + xf(0x124)])) {
        ls(s, 0x10, [0x7cc, 3]);
        s[DG_244 >> 2] = 0;
        ls(s, 4, [0x910, -1]);
        ls(s, 5, [0x910, -1]);
        r = rand();
        s[DG_248 >> 2] = (r & 3) + 0x14;
        now = c.clock();
        s[DG_250 >> 2] = now;
      }
      if (s[DG_244 >> 2] === 8) {
        gs(s, [0x44a8, 0]);
        c.markLayer(); s = c.m.I; fv = c.m.F;
        s[DG_244 >> 2] = 9;
        r = rand();
        s[DG_248 >> 2] = (r & 7) + 0x32;
        now = c.clock();
        s[DG_250 >> 2] = now;
      }
      if (s[DG_244 >> 2] !== 9) {
        return;
      }
      gs(s, [0x44a8, 0]);
      c.markLayer(); s = c.m.I; fv = c.m.F;
      ls(s, 0, [0x94c, 0]);
      ls(s, 0x11, [0x910, 0, 0x77c, 3]);
      if (fv[XF(0x11) + xf(0x124)] < 230.0) {
        q = ftol(fv[DG_CBC4 >> 2] * 13);
        v = s[LY(0x11) + lf(0x808)] + q;
        s[LY(0x11) + lf(0x808)] = v;
        if (-0x82 < v - s[LY(0x11) + lf(0x7f8)]) {
          fv[XF(0x11) + xf(0x128)] = (fv[DG_CBC4 >> 2] * 23.0);
        }
      } else {
        ls(s, 0x11, [0x124, 0, 0x128, 0, 0x808, -0xa0]);
        r = rand();
        s[LY(0x11) + lf(0x7e8)] = r & 0xff;
        r = rand();
        v = s[LY(0x11) + lf(0x790)] + (r & 3) + 1;
        s[LY(0x11) + lf(0x790)] = v;
        if (0x1f < v) {
          r = rand();
          s[LY(0x11) + lf(0x790)] = (r & 1) + 0x16;
        }
      }
      now = c.clock();
      s[DG_254 >> 2] = now;
      v = ((((now - s[DG_250 >> 2]) | 0) / 1000) | 0);
      s[DG_24C >> 2] = v;
      if (s[DG_248 >> 2] <= v) {
        if (s[LY(0x11) + lf(0x808)] !== -0xa0) {
          return;
        }
        ls(s, 0x11, [0x910, -1]);
        s[DG_244 >> 2] = 0;
        ls(s, 0x10, [0x7cc, 0]);
        return;
      }
      return;
    }
  },
};

const EclecticColors: PlusClass = family('EclecticColors', ECLECT, ['Rolling Colors', 'Ribbon Rhythm', 'Night Fire']);
const StarTime: PlusClass = family('StarTime', STARTIME, ['Starlight', 'Star Clouds', 'Star Glow']);
const SnowTime: PlusClass = family('SnowTime', SNOWTIME, ['Softie the Snowman']);
const DungeonSiege: PlusClass = family('DungeonSiege', DUNGEON, ['Poster', 'Lurking in the dark lies an enemy...']);

declare module '../ns' {
  interface AlchemyNS {
    EclecticColors: PlusClass;
    StarTime: PlusClass;
    SnowTime: PlusClass;
    DungeonSiege: PlusClass;
  }
}

A.EclecticColors = EclecticColors;
A.StarTime = StarTime;
A.SnowTime = SnowTime;
A.DungeonSiege = DungeonSiege;
export { EclecticColors, StarTime, SnowTime, DungeonSiege };
