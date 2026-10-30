// Energy Bliss' equalizer panel (MediaPlayer_10 0x10015bd0, and 0x10016dc0 for windows over 800x600 at a good frame
// rate): 36 bars of button pictures over a backdrop, drawn by GDI+ and shrunk to the window's width.
//   b1 = f11f x f120 PARGB (hd: f118 x f119), the backdrop written in with LockBits(ARGB, UserInputBuffer)
//   per band b = 1..38 except 19 and 20 (the gap in the middle): the level falls by 5% a call (or jumps to the
//   spectrum), up to six buttons stack from y 75 up by 12-13 rows, each lit (1A..6A) when the raw level passes its
//   threshold and dim (1B) when not; three reflections (R1..R3) below; a peak button falls back from the top of the
//   stack (y = peak - 8, the peak grows by *1.015 + 0.7 a call up to 83, where a reflected peak shows too)
//   every button is DrawImageRectRectI at the 1A button's size; b2 = f116 x f117 PARGB, HighQualityBicubic of
//   b1 (2, 2, w-4, h-4); the result is LockBits(ARGB) -> BGRA bytes.
// The hd variant draws the 2x buttons (hd_*) at twice the spacing; its reflections are the normal 10x8 pictures
// drawn 2x by the default (bilinear) interpolation (gdip.ts drawOpaque). The engine runs it from the resize handler
// at the first frame, before it resets the levels and peaks, so with music already playing it draws bars too.
// The low frame rate warning (I[0xf131] = 1: two DrawString calls in Tahoma) is not drawn: it needs GDI+'s font
// rasteriser, and a host stepping the clock at under 100 ms a frame never measures 10 fps or less.
import type { EqPanelCall, EqPanelDraw } from './eqpanel-api';
import { drawOpaque, premultiply, scaleHQ, unpremultiply } from '../gdip';
import { fr, ftol } from '../heap';

/** one button picture: w x h BGRA bytes (alpha ignored: GDI+ loads the DLL's 24-bit bitmaps opaque) */
export interface EqSprite { w: number; h: number; px: Uint8Array }
export const EQ_SPRITES = ['1A', '2A', '3A', '4A', '5A', '6A', '1B', 'R1', 'R2', 'R3', 'Peak', 'R_Peak',
  'hd_1A', 'hd_2A', 'hd_3A', 'hd_4A', 'hd_5A', 'hd_6A', 'hd_1B', 'hd_Peak'] as const;
/** the DLL's DATATABLE_Button_<name> / DATATABLE_hd_Button_<name> pictures, by <name> / hd_<name> */
export type EqButtons = Record<(typeof EQ_SPRITES)[number], EqSprite>;

const DECAY = fr(0.949999988079071), GROW = fr(1.0149999856948853), STEP = fr(0.699999988079071);
// the stack: y of each button (normal size), the level it needs, the raw level that lights it, the peak's cap
const ROWS: [number, number, number, number][] = [[75, 4, 40, 70], [63, 39, 80, 57], [50, 79, 100, 45],
  [38, 119, 110, 33], [26, 149, 120, 21], [14, 179, 130, 10]];
const HD_Y = [150, 126, 100, 76, 52, 28];

const u32 = (b: Uint8Array): Uint32Array => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);

export function makeEqPanel(art: EqButtons): EqPanelDraw {
  const pic = (k: keyof EqButtons): { w: number; h: number; px: Uint32Array } => ({ ...art[k], px: u32(art[k].px) });
  const N = Object.fromEntries(EQ_SPRITES.map((k) => [k, pic(k)])) as Record<keyof EqButtons, ReturnType<typeof pic>>;
  return ({ heap, src, hd }: EqPanelCall): Uint8Array => {
    const { I, F } = heap;
    if (I[0x1f82] === 0) I[0x1f82] = 1;           // GdiplusStartup (its token would go to I[0x241e])
    const W = hd ? I[0xf118] : I[0xf11f], H = hd ? I[0xf119] : I[0xf120], OW = I[0xf116], OH = I[0xf117];
    const b1 = premultiply(u32(src).subarray(0, W * H));
    const p = hd ? 'hd_' : '';
    const lit = [N[`${p}1A` as keyof EqButtons], N[`${p}2A` as keyof EqButtons], N[`${p}3A` as keyof EqButtons],
      N[`${p}4A` as keyof EqButtons], N[`${p}5A` as keyof EqButtons], N[`${p}6A` as keyof EqButtons]];
    const dim = N[`${p}1B` as keyof EqButtons], peak = N[`${p}Peak` as keyof EqButtons];
    const bw = lit[0].w, bh = lit[0].h;
    I[0xd8d6] = bw; I[0xd8d5] = bh;
    // a button at (x, y), bw x bh from the picture's (0, 0, bw, bh); hd reflections: (0, 0, bw/2, bh/2) stretched
    const put = (s: ReturnType<typeof pic>, x: number, y: number, half = false): void =>
      drawOpaque(b1, W, H, s.px, s.w, s.h, x, y, bw, bh, 0, 0, half ? (bw / 2) | 0 : bw, half ? (bh / 2) | 0 : bh);
    const refl = [N.R1, N.R2, N.R3], reflY = hd ? [180, 200, 220] : [90, 100, 110], reflAt = [4, 79, 99];
    for (let b = 1; b < 39; b++) {
      I[0xd89f] = b;
      if (b < 19) {
        I[0xd89d] = b * 9 + 1;
        let v = I[0xcf86 + I[0xd89d]];
        if (I[0x241e + b] > v) v = ftol(I[0x241e + b] * DECAY);
        I[0x241e + b] = v;
        I[0x2446 + b] = I[0xcf86 + I[0xd89d]];
      }
      I[0x2431] = 0; I[0x2432] = 0; I[0x2459] = 0; I[0x245a] = 0;
      if (b > 20) {
        I[0xd89d] = 0x162 - b * 9;
        let v = I[0xd18e + I[0xd89d]];
        if (I[0x241e + b] > v) v = ftol(I[0x2446 + b] * DECAY);   // sic: the right half decays from the raw level
        I[0x241e + b] = v;
        I[0x2446 + b] = I[0xd18e + I[0xd89d]];
      }
      const lv = I[0xd8f8] = I[0x241e + b];
      const x = hd ? b * 30 + 2 : b * 15 + 2;
      if (lv > 4) {
        for (let r = 0; r < 3 && lv > reflAt[r]; r++) put(refl[r], x, reflY[r], hd);
        for (let r = 0; r < 6 && lv > ROWS[r][1]; r++) {
          const [y, , on, cap] = ROWS[r];
          put(I[0x2446 + b] < on ? dim : lit[r], x, hd ? HD_Y[r] : y);
          if (F[0x246e + b] > cap) F[0x246e + b] = cap;
        }
      }
      F[0x246e + b] = F[0x246e + b] >= 83 ? 83 : F[0x246e + b] * GROW + STEP;
      const py = I[0xd8ec] = ftol(F[0x246e + b]) - 8;
      if (py > -4 && (b > 20 || b < 19)) {
        put(peak, x, hd ? py * 2 : py);
        if (F[0x246e + b] === 83) put(N.R_Peak, x, reflY[0], hd);
      }
    }
    I[0xd89f] = 39;
    // I[0xf131] === 1: the frame rate warning would be drawn here (see the header)
    const out = unpremultiply(scaleHQ(b1, W, H, 2, 2, W - 4, H - 4, OW, OH, true, true));
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  };
}
