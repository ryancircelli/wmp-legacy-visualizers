// The Bonus Pack families' image tables (Eclectic Colors, StarTime, SnowTime, Dungeon Siege). The DLLs' DATATABLE
// resources hold Microsoft's (and, for Dungeon Siege, the game publisher's) originals; this is our own recreation,
// generated from a few parameters of what each image shows, by the method of plus-images.ts:
// - solid fills (the canvases and the single colour columns): byte-identical to the originals;
// - colour ramps: key colours at a few rows per column, per-channel linear interpolation (rounded), fitted by
//   private tools (least-squares linear splines, >= 99% of channel values within +-2 levels); close, not
//   byte-identical.
// Index 1..n as the engine's table numbers them (index 0 unused).
import type { MusicalImage } from './images';
import { fill, rampOf } from './plus-images';
import type { Ramp } from './plus-images';

const RAMPS: { [name: string]: Ramp } = {
  startime72: { w: 1, h: 320, c: [
    [0, 0xff0600, 24, 0xff8000, 44, 0xfff300, 48, 0xfefe00, 52, 0xf9ff00, 99, 0x0bff00, 104, 0x00ff00, 111, 0x00ff22, 138, 0x00ffdb, 145, 0x00ffff, 156, 0x00efff, 195, 0x0080ff, 215, 0x0019ff, 222, 0x0001ff, 225, 0x0500ff, 231, 0x2100ff, 268, 0xf200ff, 273, 0xff00ff, 281, 0xff00dd, 314, 0xff001c, 319, 0xff0007]] },
  eclect2: { w: 3, h: 256, c: [
    [0, 0x0000ff, 9, 0x2900ff, 43, 0xe000ff, 50, 0xfa00ff, 55, 0xff00ff, 57, 0xff06ff, 63, 0xe524ff, 75, 0x8a76ff, 100, 0x13ecff, 107, 0x00ffff, 114, 0x00ffd8, 141, 0x00ff04, 143, 0x00ff00, 148, 0x19ff00, 173, 0xdeff00, 177, 0xf8ff00, 179, 0xffff00, 187, 0xffea00, 207, 0xff9a00, 223, 0xfe4400, 229, 0xfe2d00, 243, 0xfe1d00, 255, 0xff0100],
    [0, 0x0000ff, 9, 0x2900ff, 45, 0xea00ff, 53, 0xff00ff, 55, 0xff00ff, 60, 0xf513ff, 65, 0xd731ff, 75, 0x8a76ff, 99, 0x17e8ff, 107, 0x00ffff, 110, 0x00fff2, 115, 0x00ffd1, 136, 0x00ff2a, 141, 0x00ff08, 143, 0x00ff00, 148, 0x19ff00, 172, 0xd7ff00, 176, 0xf2ff00, 179, 0xffff00, 188, 0xffe800, 212, 0xfe8300, 216, 0xfe6700, 224, 0xfe4100, 229, 0xfe2d00, 242, 0xfe1e00, 255, 0xff0100],
    [0, 0x20ff00, 8, 0x00ff03, 47, 0x00ffd1, 48, 0x00ffd1, 55, 0x00ffde, 57, 0x06ffdd, 63, 0x24ffc7, 75, 0x74ff78, 77, 0x91ff7f, 98, 0xfffe1c, 103, 0xffe70a, 107, 0xffdc00, 111, 0xffcc00, 137, 0xff0100, 140, 0xff0014, 147, 0xff0034, 173, 0xff00ff, 177, 0xe400ff, 191, 0xb900ff, 208, 0x7200ff, 223, 0x2200fe, 232, 0x0400fe, 243, 0x0004fe, 255, 0x0022ff]] },
  eclect5: { w: 3, h: 320, c: [
    [0, 0xff0900, 6, 0xff2200, 25, 0xff8600, 44, 0xfff300, 50, 0xfdff00, 60, 0xd2ff00, 94, 0x22ff00, 104, 0x00ff00, 111, 0x00ff23, 138, 0x00ffdb, 145, 0x00ffff, 149, 0x00fcff, 163, 0x00dcff, 195, 0x007fff, 214, 0x001eff, 221, 0x0003ff, 226, 0x0600ff, 268, 0xf200ff, 273, 0xff00ff, 280, 0xff00e3, 311, 0xff002d, 319, 0xff0006],
    [0, 0xff0b00, 5, 0xff1e00, 24, 0xff8000, 44, 0xfff300, 49, 0xfeff00, 53, 0xf4ff00, 99, 0x0aff00, 104, 0x00ff00, 111, 0x00ff23, 138, 0x00ffdb, 145, 0x00ffff, 154, 0x00f1ff, 164, 0x00daff, 198, 0x0074ff, 213, 0x0021ff, 222, 0x0001ff, 225, 0x0500ff, 234, 0x3100ff, 262, 0xd200ff, 272, 0xff00ff, 275, 0xff00f9, 281, 0xff00dd, 314, 0xff001c, 319, 0xff0007],
    [0, 0xff0800, 10, 0xff3700, 24, 0xff8100, 44, 0xfff200, 48, 0xffff00, 54, 0xf0ff00, 93, 0x28ff00, 99, 0x0dff00, 104, 0x00ff00, 111, 0x00ff22, 138, 0x00ffdb, 145, 0x00ffff, 157, 0x00edff, 195, 0x007fff, 219, 0x0007ff, 225, 0x0400ff, 233, 0x2c00ff, 268, 0xf300ff, 273, 0xff00ff, 282, 0xff00d8, 312, 0xff0027, 319, 0xff0006]] },
  eclect6: { w: 3, h: 256, c: [
    [0, 0xff00ff, 12, 0xff00ff, 14, 0xee10ee, 19, 0xa55aa6, 29, 0x1ae610, 32, 0x00ff00, 34, 0x00ff02, 39, 0x00ff1f, 48, 0x00fc75, 68, 0x00f7db, 77, 0x00f7fb, 82, 0x00f6ff, 88, 0x13f6f7, 109, 0x85fb7a, 123, 0xdcfe18, 128, 0xf5fe03, 131, 0xffff00, 133, 0xffff00, 140, 0xffff08, 148, 0xffff1e, 175, 0xfefe7e, 188, 0xfdffe7, 191, 0xfdfff7, 195, 0xfdfbfd, 202, 0xfde5ef, 224, 0xfe7d7d, 235, 0xff1111, 238, 0xff0000, 255, 0xff0000],
    0,
    0] },
  eclect8: { w: 3, h: 256, c: [
    [0, 0x01e8fc, 134, 0x00feee, 255, 0x01e6fd],
    0,
    [0, 0xddfdfe, 255, 0xddfdfe]] },
};

function table(): { im: MusicalImage[]; put: (id: number, w: number, h: number, px: Uint32Array) => void } {
  var im: MusicalImage[] = [];
  return { im, put: (id, w, h, px) => { im[id] = { type: 0x24, w, h, px }; } };
}

var ECLECT: MusicalImage[] | null = null;
/** Eclectic Colors (DATATABLE_4): 11 images. Two black canvases, four colour ramps and five flat columns. */
export function eclectImages(): MusicalImage[] {
  if (ECLECT) return ECLECT;
  var { im, put } = table();
  put(1, 352, 320, fill(352, 320, 0));
  put(2, 3, 256, rampOf(RAMPS.eclect2));
  put(3, 1, 256, fill(1, 256, 0x0000ff));
  put(4, 1, 320, fill(1, 320, 0x1801fe));
  put(5, 3, 320, rampOf(RAMPS.eclect5));
  put(6, 3, 256, rampOf(RAMPS.eclect6));
  put(7, 1, 31, fill(1, 31, 0x0000ff));
  put(8, 3, 256, rampOf(RAMPS.eclect8));
  put(9, 3, 256, fill(3, 256, 0x0000ff));
  put(10, 1, 1, fill(1, 1, 0xff8700));
  put(11, 352, 320, fill(352, 320, 0));
  ECLECT = im;
  return im;
}

// ---------------------------------------------------------------- StarTime (DATATABLE_5)
/** a one-channel radial glow: the blue byte falls linearly between keys [r, value, ...] of the distance from (cx, cy) */
function glow(w: number, h: number, cx: number, cy: number, keys: number[]): Uint32Array {
  var px = new Uint32Array(w * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var r = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)), v = 0;
      for (var i = 0; i + 2 < keys.length; i += 2) {
        if (r >= keys[i] && r <= keys[i + 2]) { v = keys[i + 1] + (keys[i + 3] - keys[i + 1]) * (r - keys[i]) / (keys[i + 2] - keys[i]); break; }
      }
      px[y * w + x] = Math.floor(v + 0.5);
    }
  }
  return px;
}

/** a small round blob: [d2, g, b] per squared distance from (cx, cy), elsewhere black */
function blob(w: number, h: number, cx: number, cy: number, t: number[]): Uint32Array {
  var px = new Uint32Array(w * h), cls = new Map<number, number>();
  for (var i = 0; i < t.length; i += 3) cls.set(t[i], (t[i + 1] << 8 | t[i + 2]) >>> 0);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) px[y * w + x] = cls.get((x - cx) * (x - cx) + (y - cy) * (y - cy)) || 0;
  return px;
}

/** An eight-ray star on 64 x 64 around (32, 31): four axis rays and four diagonals, each a line from the centre whose colour
 *  fades linearly (a quadratic term on the diagonals) towards its tip, with a taper on either side that widens towards the
 *  centre. p = [La, Ta, Ld, Td, kR, kG, kB, dR, dG, dB, qR, qG, qB, oR, oG, T2, o2]: the axis ray's length and the distance its taper begins
 *  at, the same for the diagonal (in steps), the colour slopes per pixel (axis, diagonal), the diagonal's curvature, the side's
 *  colour offsets, and the second side's taper and offset. The slopes of the tapers are the same in every star. */
function star(p: number[]): Uint32Array {
  var W = 64, img = new Uint32Array(W * W), cx = 32, cy = 31;
  var put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    var o = img[y * W + x];
    img[y * W + x] = (Math.max(o >>> 16 & 255, r) << 16 | Math.max(o >>> 8 & 255, g) << 8 | Math.max(o & 255, b)) >>> 0;
  };
  var cl = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : v;
  var La = p[0], Ta = p[1], Ld = p[2], Td = p[3], off = [p[13], p[14], 0];
  put(cx, cy, 253, 253, 254);
  var c = [0, 0, 0], k: number, cov: number, s: number[], d: number[][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var a = 0; a < 4; a++) {
    var sx = d[a][0], sy = d[a][1];
    for (k = 1; k <= 32 && k <= La; k++) {
      c = [cl(Math.floor(253 - p[4] * k + 0.5)), cl(Math.floor(253 - p[5] * k + 0.5)), cl(Math.floor(254 - p[6] * k + 0.5))];
      put(cx + sx * k, cy + sy * k, c[0], c[1], c[2]);
      cov = Math.min(1, Math.max(0, 0.0409 * (Ta - k)));
      if (cov > 0) {
        s = [0, 1, 2].map((j) => Math.floor(cov * Math.max(0, c[j] - off[j]) + 0.5));
        put(cx + sx * k + sy, cy + sy * k + sx, s[0], s[1], s[2]);
        put(cx + sx * k - sy, cy + sy * k - sx, s[0], s[1], s[2]);
      }
    }
  }
  for (var q = 0; q < 4; q++) {
    var ux = q & 1 ? -1 : 1, uy = q & 2 ? -1 : 1;
    for (k = 1; k <= 32 && k <= Ld; k++) {
      c = [0, 1, 2].map((j) => cl(Math.floor((j === 2 ? 254 : 253) - p[7 + j] * k - p[10 + j] * k * k + 0.5)));
      put(cx + ux * k, cy + uy * k, c[0], c[1], c[2]);
      cov = Math.min(1, Math.max(0, 0.0578 * (Td - k)));
      if (cov > 0) {
        s = [0, 1, 2].map((j) => Math.floor(cov * Math.max(0, c[j] - off[j]) + 0.5));
        put(cx + ux * k - ux, cy + uy * k, s[0], s[1], s[2]);
        put(cx + ux * k, cy + uy * k - uy, s[0], s[1], s[2]);
      }
      cov = Math.min(1, Math.max(0, 0.062 * (p[15] - k)));
      if (cov > 0) {
        s = [0, 1, 2].map((j) => Math.floor(cov * Math.max(0, c[j] - off[j] - p[16]) + 0.5));
        put(cx + ux * k + ux, cy + uy * k - uy, s[0], s[1], s[2]);
        put(cx + ux * k - ux, cy + uy * k + uy, s[0], s[1], s[2]);
      }
    }
  }
  return img;
}

/** the eight-ray stars 54..62 (the 63rd is four pixels): star()'s parameters */
const STARS: number[][] = [
  [32, 29, 31.822, 27.046, 4.701, 2.72, -0.003, 6.18, 2.813, 0.577, 0.03, 0.075, 0.048, 115.072, 65.458, 14.126, 57.522],
  [32, 29, 31.822, 27.046, 4.701, 2.72, -0.003, 6.18, 2.813, 0.577, 0.03, 0.075, 0.048, 115.072, 65.458, 14.126, 57.522],
  [32, 20.968, 30.339, 22.426, 6.225, 3.42, 0.705, 7.314, 4.384, 2.886, 0.064, 0.116, 0.112, 105.384, 71.296, 11.146, 112.766],
  [32, 13.126, 32, 17.122, 8.119, 6.84, 1.488, 12.118, 10.807, 8.648, -0.051, -0.049, -0.019, 118.665, 73.502, 9.575, 163.446],
  [36.239, 6.287, 33.363, 11.223, 10.107, 9.118, 6.392, 15.06, 15.192, 10.188, 0.001, -0.161, 0.015, 136.49, 73.9, 7.163, 132.475],
  [28.477, 4.089, 25, 7.121, 16.103, 12.839, 9.633, 20.225, 18.601, 13.193, -0.018, -0.208, 0.018, 151.959, 95.541, 5.337, 163.394],
  [21.497, 4.099, 18, 8.168, 16.227, 15.069, 14.441, 24.902, 22.554, 17.51, 0.065, -0.18, 0.033, 132.401, 72.746, 6.373, 125.06],
  [14.095, 5.114, 13, 8.242, 23.444, 21.671, 18.81, 37.059, 31.93, 24.704, -0.225, -0.255, 0.063, 128.893, 94.368, 5.3, 100.682],
  [5, 5.132, 5, 5.984, 48.917, 43.257, 22.474, 183.646, 142.823, 45.889, 6.003, 0.604, 0.622, 80.272, 81.902, 3.278, 75.123],
];


var STARTIME: MusicalImage[] | null = null;
/** StarTime (DATATABLE_5): 72 images. Three round blue glows, six flat 1 x 1 pixels, 44 black 64 x 64 sprites, ten eight-ray stars of
 *  falling size, eight small round blobs and a 1 x 320 colour column. */
export function starTimeImages(): MusicalImage[] {
  if (STARTIME) return STARTIME;
  var { im, put } = table(), i: number;
  put(1, 64, 64, glow(64, 64, 32, 31, [0, 255, 1.41, 242, 3.61, 211, 8.94, 122, 12.65, 49, 13.89, 27, 15.13, 9, 16, 0, 40, 0]));
  put(2, 64, 64, glow(64, 64, 32, 31, [0, 255, 4.12, 234, 9.43, 195, 18.25, 124, 27.86, 33, 30.68, 12, 32.98, 0, 40, 0]));
  put(3, 64, 64, glow(64, 64, 32, 31, [0, 255, 1, 184, 1.41, 148, 2, 126, 7.21, 104, 19.85, 44, 27.02, 16, 32.98, 0, 40, 0]));
  for (i = 4; i <= 9; i++) put(i, 1, 1, fill(1, 1, 0xff8700));
  for (i = 10; i <= 53; i++) put(i, 64, 64, fill(64, 64, 0));
  for (i = 0; i < STARS.length; i++) put(54 + i, 64, 64, star(STARS[i]));
  var four = new Uint32Array(64 * 64);
  four[31 * 64 + 31] = 0x414141; four[31 * 64 + 32] = 0x9f9f9f; four[32 * 64 + 31] = 0x171717; four[32 * 64 + 32] = 0x414141;
  put(63, 64, 64, four);
  put(64, 16, 16, blob(16, 16, 7, 8, [0, 162, 162, 1, 47, 98, 2, 19, 61]));
  put(65, 16, 16, blob(16, 16, 7, 8, [0, 178, 178, 1, 63, 114, 2, 35, 77, 4, 10, 42]));
  put(66, 16, 16, blob(16, 16, 7, 8, [0, 213, 213, 1, 98, 149, 2, 70, 112, 4, 45, 77, 5, 37, 66, 8, 21, 45, 9, 17, 39, 10, 13, 31]));
  put(67, 16, 16, blob(16, 16, 7, 8, [0, 234, 234, 1, 119, 170, 2, 91, 133, 4, 66, 98, 5, 58, 87, 8, 42, 66, 9, 38, 60, 10, 35, 56, 13, 27, 45, 16, 21, 36, 17, 15, 26]));
  put(68, 16, 16, blob(16, 16, 7, 8, [0, 153, 153, 1, 38, 89, 2, 10, 52]));
  put(69, 16, 16, blob(16, 16, 7, 8, [0, 161, 161, 1, 30, 88, 2, 0, 46]));
  put(70, 16, 16, blob(16, 16, 7, 8, [0, 143, 143, 1, 8, 68, 2, 0, 25]));
  put(71, 16, 16, blob(16, 16, 7, 8, [0, 122, 122, 1, 7, 58, 2, 0, 21]));
  put(72, 1, 320, rampOf(RAMPS.startime72));
  STARTIME = im;
  return im;
}
