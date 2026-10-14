// Blackfly Studios' visualization framework (2003-2006): the Delphi units every Blackfly plug-in links
// (Effects, DIB, VizDIB; Ripple, Clarify, Celestial and Fire Dancer), as our own TypeScript. Written from
// Ripple.dll's machine code (VAs below are Ripple.dll's, image base 0x400000); the other DLLs carry the same
// units at other addresses.
//
// What it covers:
//  - Delphi's System.Random (RandSeed LCG) and Round (x87 FISTP, round half to even)
//  - TVizShell (unit Effects), the COM object behind IWMPEffects: Render keeps the window rect, calls the
//    resize hook when the rect's size changed, then the draw hook, then counts the frame (int64 at +0x48);
//    SetCurrentPreset stores the preset (+0x20) and calls a preset hook (empty in Ripple)
//  - TVizDIB32Double (unit VizDIB): two 32-bit DIB sections the window's size, front (+0x5c) and back
//    (+0x58), both black when made; Render BitBlts the front to the window, then copies it to the back
//  - TDIB.Blend (unit DIB, 0x41ecc0): per byte, back*a/256 + front*(256-a)/256 into the front
import type { Surface, TimedLevel } from '../ns';

/** System.Random (0x402ef4): RandSeed = RandSeed * 0x08088405 + 1, result (RandSeed * range) >> 32. RandSeed
 *  starts at 0 and nothing in the DLLs calls Randomize. */
export class DelphiRandom {
  seed = 0;
  random(range: number): number {
    this.seed = (Math.imul(this.seed, 0x08088405) + 1) >>> 0;
    // the 64-bit product's high half, from 16-bit halves (every partial product exact in a double)
    const t = (this.seed >>> 16) * range + Math.floor(((this.seed & 0xffff) * range) / 65536);
    return Math.floor(t / 65536);
  }
}

/** System.Round (0x402a44): FISTP under the default control word, halves to even. */
export function delphiRound(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r & 1 ? r - 1 : r;
}

/** TDIB.Blend (0x41ecc0) over two DIBs of one size: each of B, G, R becomes (back * (a & 255) >> 8) +
 *  (front * ((256 - a) & 255) >> 8), the bytes added with 8-bit wrap; the top byte is the back's. */
export function blend(back: Uint32Array, front: Uint32Array, alpha: number): void {
  const a = alpha & 255, b = (256 - alpha) & 255;
  for (let i = 0; i < front.length; i++) {
    const s = back[i], d = front[i];
    front[i] = ((s & 0xff000000) |
      (((((s >>> 16) & 255) * a) >> 8) + ((((d >>> 16) & 255) * b) >> 8) & 255) << 16 |
      (((((s >>> 8) & 255) * a) >> 8) + ((((d >>> 8) & 255) * b) >> 8) & 255) << 8 |
      ((((s & 255) * a) >> 8) + (((d & 255) * b) >> 8) & 255)) >>> 0;
  }
}

export interface BlackflyConfig {
  width?: number;
  height?: number;
  options?: object;
  preset?: number;
  seed?: number;
}

/** TVizShell + TVizDIB32Double. A plug-in overrides draw() (its Render, which draws into the front and ends
 *  in the inherited Render: this class's present step). Pixels are 0x00RRGGBB, rows top-down. */
export abstract class BlackflyViz {
  declare options: object;
  declare preset: number;
  declare w: number;
  declare h: number;
  /** the window size the next Render sees (the DLL learns it from Render's RECT) */
  declare viewW: number;
  declare viewH: number;
  /** TVizShell's frame counter (+0x48): Renders so far */
  declare frame: number;
  declare rnd: DelphiRandom;
  declare front: Uint32Array;
  declare back: Uint32Array;

  constructor(cfg: BlackflyConfig, readonly presetCount: number) {
    this.options = cfg.options || {};
    this.preset = 0;
    this.w = this.h = 0;
    this.viewW = cfg.width || 640;
    this.viewH = cfg.height || 480;
    this.frame = 0;
    this.rnd = new DelphiRandom();
    this.rnd.seed = (cfg.seed || 0) >>> 0;
    this.front = this.back = new Uint32Array(0);
    this.setPreset(cfg.preset || 0);
  }

  /** IWMPEffects::Render (TVizShell, 0x41ced4) */
  render(level: TimedLevel): Surface {
    if (this.viewW !== this.w || this.viewH !== this.h) {
      this.w = this.viewW;
      this.h = this.viewH;
      this.resized();
    }
    this.draw(level);
    // TVizDIB32Double.Render (0x41f11c): BitBlt the front, then front -> back
    this.back.set(this.front);
    this.frame++;
    return { w: this.w, h: this.h, px: this.front };
  }

  /** TVizDIB32Double's resize hook (0x41f19c): both DIBs made anew, black (PatBlt BLACKNESS) */
  protected resized(): void {
    this.front = new Uint32Array(this.w * this.h);
    this.back = new Uint32Array(this.w * this.h);
  }

  protected abstract draw(level: TimedLevel): void;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** IWMPEffects::SetCurrentPreset (0x41d01c); WMP offers 0..count-1 */
  setPreset(n: number): boolean {
    if (!(n >= 0 && n < this.presetCount)) return false;
    this.preset = n | 0;
    return true;
  }

  /** RandSeed: the DLL's starts at 0 when it loads */
  seed(n: number): void {
    this.rnd.seed = n >>> 0;
  }

  debug(): Record<string, unknown> {
    return { preset: this.preset, w: this.w, h: this.h, frame: this.frame, randSeed: this.rnd.seed };
  }
}
