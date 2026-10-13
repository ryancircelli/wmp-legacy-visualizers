// What Picture Viz 3D takes from outside the engine: GDI+'s picture scaling (the Picture Viz family's clone) and
// the particle sprite. The DLL's sprite is a JPEG resource; it does not ship here: the public build draws its own
// round glow, the private A/B hands the engine the DLL's own decoded pixels (options.particle).
import type { Picture } from '../picture';
import { gdipScaleHQ } from '../gdip';
import { gdipDrawClipped } from '../pv2/gdip-clip';

/** GDI+'s step as the Picture Viz family runs it (see Env.scale): HighQualityBicubic at dw x dh at (dx, dy) into a
 *  bw x bh bitmap that starts transparent black, read back as ARGB */
export function gdipScale(pic: Picture, dx: number, dy: number, dw: number, dh: number, bw: number, bh: number): Uint32Array {
  if (dx === 0 && dy === 0 && dw === bw && dh === bh) return gdipScaleHQ(pic.rgb, pic.w, pic.h, dw, dh);
  return gdipDrawClipped(pic.rgb, pic.w, pic.h, dx, dy, dw, dh, bw, bh);
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 128 x 128 X8R8G8B8 (BGRA bytes): a soft white round glow */
export function ownParticle(): Uint8Array {
  const o = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const d = Math.hypot(x - 63.5, y - 63.5) / 64, k = d >= 1 ? 0 : (1 - d) * (1 - d);
    const i = (y * 128 + x) * 4;
    o[i] = clamp(255 * k); o[i + 1] = clamp(245 * k); o[i + 2] = clamp(230 * k); o[i + 3] = 0xff;
  }
  return o;
}
