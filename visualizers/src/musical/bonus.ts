// The WMP 7 Bonus Pack's and the Windows Media Bonus Pack for XP's visualizations on the Musical Colors engine
// (Averett & Associates, 2000-2001): Eclectic Colors, StarTime, SnowTime and Dungeon Siege. Like plus.ts each is
// core.ts's engine (`ver` 1: the 2000 builds) plus its presets and image table; field offsets below are wmpvis.dll's
// (the port keeps its object), VAs the DLL's own (image base 0x10000000).
import { A } from '../ns';
import type { Core, PlusDll } from './core';
import { LY, XF, lf, xf } from './core';
import type { MusicalImage } from './images';
import { family, head, setup, ls, gs, F } from './plus';
import { eclectImages } from './bonus-images';
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
      F_[XF(2) + xf(0x144)] = 0xf - ftolEl(F_[cosT + ftolEl(F_[XF(0) + xf(0xe0)])] * -10);
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

/** __ftol: truncation toward zero (x87 fistp with the C rounding the CRT sets) */
function ftolEl(v: number): number { return v < 0 ? -Math.floor(-v) : Math.floor(v); }

const EclecticColors: PlusClass = family('EclecticColors', ECLECT, ['Rolling Colors', 'Ribbon Rhythm', 'Night Fire']);

declare module '../ns' {
  interface AlchemyNS {
    EclecticColors: PlusClass;
  }
}

A.EclecticColors = EclecticColors;
export { EclecticColors };
void LY; void lf;
