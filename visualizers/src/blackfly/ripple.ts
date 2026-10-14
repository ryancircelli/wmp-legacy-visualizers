// Alchemy.Ripple: Blackfly Studios' "Ripple" (Ripple.dll, 2003; CLSID D0D32C40-D743-11D7-BAB8-0080AD3BAD68,
// Effects key Ripple), our own implementation of what that binary does, written from its machine code; frame
// for frame the same pixels. VAs are Ripple.dll's (TVizRipple, VMT 0x41f2a0, on ./common.ts's framework).
//
// Three rings spread from three random centres, one per band of the spectrum (bins 4-14, 44-54, 244-254,
// both channels): each frame a ring's radius grows by its band's level (/32, /16, /8) and starts again from 0
// when the level jumps by more than 48. Every pixel takes a cosine wave of its distance outside each ring;
// the preset mixes the three into a colour, and the frame is blended over the last one (224/256 of the old).
// Every 256 frames the centres move and the new picture fades in over 31 frames. Surface: the window's size,
// copied 1:1 (BitBlt). Input: the frequency bytes only. Randomness: Delphi's Random, RandSeed 0 at load.
import { A, type TimedLevel } from '../ns';
import { BlackflyViz, blend, type BlackflyConfig } from './common';

const PRESET_NAMES = ['Plaid', 'Pool', 'Acid', 'Haze', 'Hulk', 'Solvent', 'Vomit', 'Slime'];

/** 0x41f990 (unit initialisation): 3600 steps of a cosine, 128 + Round(127 cos(i pi / 1800)), with pi as the
 *  DLL writes it (3.1415926535) */
const WAVE = new Uint8Array(3600);
for (let i = 0; i < 3600; i++) WAVE[i] = (Math.round(Math.cos((i * 3.1415926535) / 1800) * 127) + 128) & 255;

/** 0x41f9e4 fills a 1204x1204 table of Round(Sqrt(dx*dx + dy*dy)) for dx, dy below 512 only: the rest of it
 *  stays 0, so inside 1204 but past 511 a pixel is at distance 0. From 1204 on Render takes the root itself. */
function dist(dx: number, dy: number): number {
  if (dx < 1204 && dy < 1204 && (dx >= 512 || dy >= 512)) return 0;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

class Ripple extends BlackflyViz {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  /** ring radius (+0x78..), last band level (+0x84..), centre (+0x60..) per band; fade-in frames left (+0x90) */
  radius = [0, 0, 0];
  level = [0, 0, 0];
  cx = [0, 0, 0];
  cy = [0, 0, 0];
  fade = 0;
  private maps = [new Uint16Array(0), new Uint16Array(0), new Uint16Array(0)];
  private mapKey = '';
  /** wave value by distance: distances stay under 65536 (Uint16 maps; a 46000-pixel-wide window would not) */
  private luts = [new Uint8Array(65536), new Uint8Array(65536), new Uint8Array(65536)];

  constructor(cfg?: BlackflyConfig) {
    super(cfg || {}, PRESET_NAMES.length);
  }

  /** TVizRipple.Render (0x41f300) */
  protected draw(tl: TimedLevel): void {
    const [f0, f1] = tl.freq, { w, h } = this;
    for (let k = 0; k < 3; k++) {
      const lo = [4, 44, 244][k];
      let s = 0;
      for (let i = lo; i < lo + 11; i++) s += f0[i] + f1[i];
      const cur = (s / 20) | 0;
      if (cur > this.level[k] + 48) this.radius[k] = 0;
      else this.radius[k] += cur >> (5 - k);
      this.level[k] = cur;
      this.radius[k] &= 255;
    }
    if (this.frame % 256 === 0) {
      for (let k = 0; k < 3; k++) {
        this.cx[k] = this.rnd.random(w);
        this.cy[k] = this.rnd.random(h);
      }
      this.fade = 31;
      this.mapKey = '';
    }
    // each pixel's distance from each centre only changes with the centres: kept per band (dist(), as
    // Render computes it per pixel), and the wave value per distance made once a frame
    const n = w * h;
    if (this.mapKey !== `${w}x${h}`) {
      this.mapKey = `${w}x${h}`;
      for (let k = 0; k < 3; k++) {
        const m = this.maps[k].length === n ? this.maps[k] : (this.maps[k] = new Uint16Array(n));
        const cx = this.cx[k], cy = this.cy[k];
        for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++) m[i++] = dist(Math.abs(x - cx), Math.abs(y - cy));
      }
    }
    const dmax = Math.min(65536, Math.ceil(Math.hypot(w, h)) + 1);
    for (let k = 0; k < 3; k++) {
      const r = this.radius[k], sh = 5 - k, lut = this.luts[k];
      for (let d = 0; d < dmax; d++) lut[d] = d < r ? 255 : WAVE[(((d - r) * 1800) >> sh) % 3600];
    }
    const [m1, m2, m3] = this.maps as [Uint16Array, Uint16Array, Uint16Array];
    const [l1, l2, l3] = this.luts as [Uint8Array, Uint8Array, Uint8Array];
    const px = this.front, p = this.preset;
    for (let i = 0; i < n; i++) {
      const v1 = l1[m1[i]], v2 = l2[m2[i]], v3 = l3[m3[i]];
      const m = (v1 * 4 + v2 * 3 + v3) >> 3;
      let c: number;
      if (p === 0) c = (v3 >> 1) | ((v2 & 0xfe) << 7) | ((v1 & 0xfe) << 15);
      else if (p === 1) { const t = Math.min(255, 0x13f - m); c = (t << 8) | 0xff | (t << 16); }
      else if (p === 2) c = m | ((255 - m) << 16);
      else if (p === 3) c = (m - (v1 >> 3)) | ((m - (v2 >> 3)) << 16);
      else if (p === 4) { const lo = Math.min(v1, v2, v3); c = lo | ((255 - lo) << 8) | (lo << 16); }
      else if (p === 5) c = 0x80 - m;
      else if (p === 6) c = (0xe0 - 2 * m) << 8;
      else c = (m + 0xc0) << 8;
      px[i] = c;
    }
    // 0x41f8b2: the last frame over this one, all but fully while a new picture fades in
    blend(this.back, px, this.fade > 0 ? 0xe0 + this.fade-- : 0xe0);
  }

  debug(): Record<string, unknown> {
    return { ...super.debug(), radius: [...this.radius], cx: [...this.cx], cy: [...this.cy], fade: this.fade };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    Ripple: typeof Ripple;
  }
}
A.Ripple = Ripple;
