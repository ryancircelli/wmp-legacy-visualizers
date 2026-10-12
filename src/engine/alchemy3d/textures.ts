// The bitmap resources 3D Alchemy's scenes texture with, made here. The museum floor's checkerboards
// (BITMAP 201-203) are recreated exactly. The other pictures are Microsoft's artwork and stay out of this
// build: WM Museum's five framed screenshots of Windows Media Player versions (RCDATA 150-154, JPEG) and
// Monoliths' "Windows Media 9 Series" logo (BITMAP 155) are stood in for by plain generated panels.
import { D3D, Texture } from './device';

/** BITMAP 201 / 202 / 203 (128, 256, 512 square, 1 bit: white and black): a two-by-two checkerboard whose
 *  bands are S/4, S/2 - S/128 and the rest, the same across and down (the dark band in the middle) */
export function checkerIndex(S: number, x: number, y: number): number {
  const a = S >> 2, b = (S >> 1) - (S >> 7);
  const band = (p: number) => (p >= a && p < a + b ? 1 : 0);
  return band(x) ^ band(y);
}

/** a resource as D3DXCreateTextureFromResourceEx loads it for the scenes: size x size, A8R8G8B8, 4 levels
 *  with point-filtered mips (0x004467f9) */
export function resourceTexture(resId: number, size: number): Texture | null {
  const t = new Texture(size, size, D3D.A8R8G8B8, 4);
  const px = t.px;
  if (resId >= 0xc9 && resId <= 0xcb) {
    // the floor: the checkerboard the Alchemy texture's width picks, scaled to `size` (exact at 256 from 202)
    const S = 128 << (resId - 0xc9);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = checkerIndex(S, Math.floor(x * S / size), Math.floor(y * S / size));
      px[y * size + x] = i ? 0xff000000 : 0xffffffff;
    }
  } else if (resId >= 0x96 && resId <= 0x9a) {
    // a museum picture: a wooden frame round a dark canvas, a different tint per picture
    const tint = [0x2a4c7a, 0x3a3a3a, 0x24506a, 0x1c3c64, 0x2e2e46][resId - 0x96];
    const fw = Math.max(4, size >> 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const e = Math.min(x, y, size - 1 - x, size - 1 - y);
      let c: number;
      if (e < fw) {
        const grain = ((x * 7 + y * 13) ^ (x >> 2)) & 15;
        const k = 0.55 + 0.45 * (e / fw);
        c = (Math.min(255, ((0x8a + grain) * k) | 0) << 16) | (Math.min(255, ((0x5a + grain) * k) | 0) << 8) | Math.min(255, ((0x2a + grain) * k) | 0);
      } else c = e < fw + 2 ? 0x101010 : tint;
      px[y * size + x] = (0xff000000 | c) >>> 0;
    }
  } else if (resId === 0x9b) {
    // the logo panel
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const g = 0xd8 + (((x + y) >> 4) & 7);
      px[y * size + x] = (0xff000000 | (g << 16) | (g << 8) | Math.min(255, g + 8)) >>> 0;
    }
  } else return null;
  t.pointMips();
  return t;
}
