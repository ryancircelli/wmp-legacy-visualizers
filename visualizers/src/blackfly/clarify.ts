// Alchemy.Clarify: Blackfly Studios' "Clarify" (Clarify.dll, 2003; CLSID 0C7E3EA7-2EBA-4C93-A9F9-92A5D406BA98,
// Effects key Clarify), our own implementation of what that binary does, written from its machine code; frame for
// frame the same pixels. VAs are Clarify.dll's (TVizQuest, VMT 0x41fbac, on ./common.ts's framework).
//
// The spectrum drawn as rings: every pixel of an 8-bit DIB takes the frequency bin at its rounded distance from a
// centre (bins past 1023 leave the pixel as it was), and the DIB's colour table is a ramp from black to a colour
// made of three bins (10, 50, 250). Lucid draws both channels averaged from the middle; Vivid, Focus and Epiphany
// draw the left channel, then XOR the right one over it, from the middle (Vivid), 10 pixels either side (Focus) or
// two centres circling on the frame count (Epiphany). Then the new frame goes 10/256 over the last one and the
// result is drawn back in toward the middle (TRadialSmear, amount 0.5), the trails that make the zoom.
// Surface: the window's size, copied 1:1 (BitBlt). Input: the frequency bytes only. No randomness, no clock.
import { A, type TimedLevel } from '../ns';
import { BlackflyViz, RadialSmear, blend, delphiRound, rampPalette, type BlackflyConfig } from './common';

const PRESET_NAMES = ['Lucid', 'Vivid', 'Focus', 'Epiphany'];

const min255 = (v: number) => (v > 255 ? 255 : v);

class Clarify extends BlackflyViz {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  /** +0x60: the 8-bit DIB the rings are drawn in (kept between frames) */
  dib8 = new Uint8Array(0);
  /** +0x64: TRadialSmear over the back DIB */
  smear: RadialSmear | null = null;
  /** Round(Sqrt(dx*dx + dy*dy)) by |dx|, |dy|; dx stays within (w >> 1) + 21 for any centre the presets use */
  private dist = new Uint16Array(0);
  private dw = 0;
  private bins = new Uint8Array(1024);

  constructor(cfg?: BlackflyConfig) {
    super(cfg || {}, PRESET_NAMES.length);
  }

  /** TVizQuest's resize hook (0x420200): the inherited one (front and back, black), then the 8-bit DIB
   *  (black) and the smear over the new back */
  protected resized(): void {
    super.resized();
    const { w, h } = this;
    this.dib8 = new Uint8Array(w * h);
    this.smear = new RadialSmear(w, h, 0.5);
    const dw = (this.dw = (w >> 1) + 22), dh = (h >> 1) + 22;
    this.dist = new Uint16Array(dw * dh);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) this.dist[y * dw + x] = Math.round(Math.sqrt(x * x + y * y));
  }

  /** one ring pass (0x41fcaf / 0x41fee2 / 0x42002b): the 8-bit DIB from `bins` round (cx, cy), then its colours
   *  into the front, copied (SRCCOPY) or XORed (SRCINVERT) */
  private rings(cx: number, cy: number, bins: Uint8Array, color: number, xor: boolean): void {
    const { w, h, dib8, dist, dw } = this, px = this.front, pal = rampPalette(color);
    for (let y = 0, i = 0; y < h; y++) {
      const row = Math.abs(cy - y) * dw;
      for (let x = 0; x < w; x++, i++) {
        const r = dist[row + Math.abs(cx - x)];
        if (r < 1024) dib8[i] = bins[r];
      }
    }
    if (xor) for (let i = 0; i < px.length; i++) px[i] ^= pal[dib8[i]];
    else for (let i = 0; i < px.length; i++) px[i] = pal[dib8[i]];
  }

  /** TVizQuest.Render (0x41fc14). (On the first frame it copies the window into the back: black here, as in a
   *  fresh window.) */
  protected draw(tl: TimedLevel): void {
    const [f0, f1] = tl.freq, cx = this.w >> 1, cy = this.h >> 1, p = this.preset;
    if (p === 0) {
      const b = this.bins;
      for (let i = 0; i < 1024; i++) b[i] = (f0[i] + f1[i]) >> 1;
      this.rings(cx, cy, b, min255(f0[9] + f1[9]) | min255(((f0[49] + f1[49]) * 3) >> 1) << 8 | min255((f0[249] + f1[249]) * 2) << 16, false);
    } else {
      // centre offsets: Vivid none, Focus 10 pixels apart either way, Epiphany on the frame count (x87 fcos/fsin)
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      if (p === 2) { x0 = 10; x1 = -10; }
      else if (p === 3) {
        const f = this.frame;
        x0 = delphiRound(Math.cos(f / 37) * 20); y0 = delphiRound(Math.sin(f / 43) * 20);
        x1 = delphiRound(Math.cos(f / 29) * 20); y1 = delphiRound(Math.sin(f / 23) * 20);
      }
      this.rings(cx + x0, cy + y0, f0, (255 - min255(f0[9] * 2)) | min255(f0[49] * 3) << 8 | min255(f0[249] * 4) << 16, false);
      this.rings(cx + x1, cy + y1, f1, min255(f1[9] * 2) | min255(f1[49] * 3) << 8 | (255 - min255(f1[249] * 4)) << 16, true);
    }
    // 0x42013f: the front 10/256 over the back, then the back smeared into the front
    blend(this.front, this.back, 10);
    this.smear!.apply(this.back, this.front);
  }
}

declare module '../ns' {
  interface AlchemyNS {
    Clarify: typeof Clarify;
  }
}
A.Clarify = Clarify;
