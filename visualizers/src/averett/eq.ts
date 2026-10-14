// Rhythm and Waves' equalizer (MediaPlayer_9 0x100134a0), drawn into the back buffer right after the 2D layer: 17
// bands of 7 cells that light yellow up to the band's level and fade blue as they fall, painted by GDI+ into a
// 212x52 premultiplied bitmap with 8 faint vertical rules, shrunk with HighQualityBicubic to the EQ size and blended
// over the water's horizon at the right edge.
import { ftol, fr } from './heap';
import { eqImage } from './gdip';

/** what drawEq needs of the engine: its heap views */
export interface EqHost { I: Int32Array; F: Float32Array }

const A0 = 0x2de10 >> 2;     // cells: band b (1..17), cell k (0..7) at A0 + b*8 + k; cell 0 holds the band's x
// band -> the spectrum bin it watches (0x2e0a4 + 4*bin) and its x in the 212-wide picture
const BANDS: [number, number][] = [[5, 0xcc], [10, 0xc5], [15, 0xb4], [20, 0xad], [30, 0x9a], [40, 0x93], [55, 0x81],
  [70, 0x7a], [85, 0x6a], [95, 0x63], [105, 0x51], [115, 0x4a], [125, 0x38], [135, 0x31], [145, 0x1f], [155, 0x18], [165, 8]];

/** 0x100134a0: update the cells, render them, and blend them into the locked back buffer (u, pitch in pixels) */
export function drawEq(e: EqHost, u: Uint32Array, pitch: number): void {
  const I = e.I;
  const horizon = I[0x36f0 >> 2];
  const size = I[0x36c4 >> 2];
  if (horizon === 0 || size <= 5) return;
  const W = ftol(size * fr(0.009999999776482582) * I[0x36e8 >> 2]);
  const H = ftol(W * fr(0.24528302252292633));
  if (H > horizon) return;
  // fall
  for (let b = 1; b < 0x12; b++) {
    for (let k = 1; k < 7; k++) {
      const i = A0 + b * 8 + k;
      if (I[i] === 0xff && I[i + 1] === 0xff) I[i] = 0;
      if (I[i] === 0xff) I[i] = 0xfe;
    }
    if (I[A0 + b * 8 + 7] === 0xff) I[A0 + b * 8 + 7] = 0xfe;
    I[A0 + b * 8 + 1] >>= 1;
    for (let k = 2; k < 8; k++) {
      const i = A0 + b * 8 + k, v = I[i];
      if (v === 0xfe) { I[i - 1] = 0xfe; I[i] >>= 1; }
      else I[i] = v < 0x14 ? v >> 1 : v - 0x14;
    }
  }
  // rise to the level
  for (let b = 1; b < 0x12; b++) {
    const [bin, x] = BANDS[b - 1];
    const lv = I[(0x2e0a4 >> 2) + bin];
    I[0x310bc >> 2] = lv;
    const n = lv >= 0x82 ? 7 : lv > 0x77 ? 6 : lv > 0x6d ? 5 : lv > 99 ? 4 : lv > 0x4f ? 3 : lv > 0x27 ? 2 : lv > 4 ? 1 : 0;
    if (n === 0) continue;
    I[0x30de8 >> 2] = n;
    I[A0 + b * 8] = x;
    for (let k = 1; k <= n; k++) I[A0 + b * 8 + k] = 0xff;
  }
  I[0x31038 >> 2] = 0x11;
  const img = eqImage(I.subarray(A0, A0 + 0x12 * 8), W, H);
  if (!img) return;
  // blend: x from the right edge (2% margin), rows just above the horizon
  const sw = I[0x36e8 >> 2];
  const x0 = sw - ftol(sw * fr(0.019999999552965164)) - W - 2;
  const y0 = horizon + 2 > H ? horizon - H + 2 : horizon + 2;
  for (let r = 0; r < H; r++) {
    let d = (y0 + r + 1) * pitch + x0;
    for (let c = 0; c < W; c++, d++) {
      const s = img[r * W + c], a = s >>> 24;
      if (a === 0) continue;
      if (a === 0xff) { u[d] = s; continue; }
      const A = a * fr(0.003921568859368563), B = 1 - A, t = u[d];
      const R = ftol(((t >>> 16) & 255) * B + ((s >>> 16) & 255) * A);
      const Bl = ftol((t & 255) * B + (s & 255) * A);
      const G = ftol(((t >>> 8) & 255) * B + ((s >>> 8) & 255) * A);
      u[d] = (0xff000000 | (R << 16) | (G << 8) | Bl) >>> 0;
    }
  }
}
