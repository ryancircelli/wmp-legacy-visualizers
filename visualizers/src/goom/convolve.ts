// Goom's "Bright Flash" visual (data 0x1000a390, apply 0x1000a510): the frame's brightness, then the
// brightness script, then the output copy (0x1000a250). The script (the DLL's own GoomSL text, compiled
// on the first frame) is run here as what it computes:
//   float goom = Sound.Goom_Detection; float factor = Bright_Flash.Factor;
//   (0.8 < goom)? factor = factor + Sound.Goom_Power * 1.5;
//   Bright_Flash.Factor = factor * 0.96;
// in the interpreter's float arithmetic (each operation rounded to a float).
import { f32, ftol } from './fpu';
import type { SoundInfo } from './sound';

export class Convolve {
  brightness = 100.0;   // +0x10 "Screen Brightness"
  flashIntensity = 100.0; // +0x3c "Flash Intensity"
  factor = 0.5;         // +0x68 "Factor"

  apply(src: Uint32Array, dst: Uint32Array, n: number, snd: SoundInfo): void {
    const iff = ftol((this.factor * this.flashIntensity + this.brightness) * 0.009999999776482582 * 256.0);
    // the script
    const goom = snd.lastGoomP;
    let factor = this.factor;
    if (f32(0.8) < goom) factor = f32(f32(snd.goomPowerP * 1.5) + factor);
    this.factor = f32(factor * f32(0.96));
    createOutputWithBrightness(src, dst, n, iff);
  }
}

/** 0x1000a250: a straight copy at 256, else every byte * iff >> 8 saturated, for pixels n-2 down to 0 (the
 *  last pixel keeps what it had) */
export function createOutputWithBrightness(src: Uint32Array, dst: Uint32Array, n: number, iff: number): void {
  if (iff === 256) { dst.set(src.subarray(0, n)); return; }
  const L = LUT;
  for (let v = 0; v < 256; v++) { const x = (v * iff) >> 8; L[v] = (x & ~255) ? 255 : x; }
  for (let i = n - 2; i >= 0; i--) {
    const s = src[i];
    dst[i] = (L[s & 255] | (L[(s >>> 8) & 255] << 8) | (L[(s >>> 16) & 255] << 16) | (L[s >>> 24] << 24)) >>> 0;
  }
}
const LUT = new Int32Array(256);
