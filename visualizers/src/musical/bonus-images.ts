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
  dungeon20: { w: 3, h: 319, c: [
    [0, 0xff6d02, 25, 0xff8002, 90, 0xffc201, 130, 0xfff000, 141, 0xfff800, 142, 0xfffd00, 175, 0xfffd00, 176, 0xfffb00, 229, 0xffbc00, 302, 0xff7600, 318, 0xff6e00],
    [0, 0xff6e02, 25, 0xff8002, 88, 0xffc001, 118, 0xffe300, 148, 0xffff00, 171, 0xfffe00, 198, 0xffe200, 238, 0xffb100, 318, 0xff6900],
    [0, 0xf6fe01, 34, 0xf7e501, 88, 0xfbb101, 143, 0xfe7401, 167, 0xfe7201, 186, 0xfd8101, 286, 0xf7e901, 318, 0xf6ff01]] },
  snowtime1: { w: 1, h: 320, c: [
    [0, 0x1ebb01, 29, 0x28b306, 277, 0xe81264, 319, 0xfd006f]] },
  snowtime13: { w: 1, h: 256, c: [
    [0, 0xff0005, 35, 0xea0e11, 54, 0xd21e1d, 55, 0xd51c1c, 99, 0xf90404, 116, 0xff0000, 179, 0xd31d1d, 234, 0xfb0202, 255, 0xff0000]] },
  snowtime14: { w: 1, h: 30, c: [
    [0, 0x9b0104, 7, 0xed0005, 9, 0xff0006, 11, 0xf9000b, 17, 0xc30225, 19, 0xbb022a, 21, 0xc70222, 27, 0xf90004, 29, 0xff0000]] },
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

// ---------------------------------------------------------------- SnowTime / Softie the Snowman (DATATABLE_6)
/** an anti-aliased ellipse: `ink` over `paper`, the coverage falling linearly across the edge (k pixels of radius per unit of the
 *  normalised radius) */
function ellipse(w: number, h: number, cx: number, cy: number, rx: number, ry: number, k: number, ink: number, paper: number): Uint32Array {
  var px = new Uint32Array(w * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var rho = Math.sqrt(((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2), v = Math.min(1, Math.max(0, (1 - rho) * k + 0.5));
      px[y * w + x] = mix(paper, ink, v);
    }
  }
  return px;
}

/** the colour `a` taken to `b` by t (0..1), each channel rounded */
function mix(a: number, b: number, t: number): number {
  var out = 0;
  for (var sh = 16; sh >= 0; sh -= 8) out = out << 8 | Math.floor((a >> sh & 255) + ((b >> sh & 255) - (a >> sh & 255)) * t + 0.5);
  return out >>> 0;
}

/** a small black shape on white from its rows' runs [y, x0, x1] (inclusive) */
function runs(w: number, h: number, r: number[]): Uint32Array {
  var px = new Uint32Array(w * h).fill(0xffffff);
  for (var i = 0; i < r.length; i += 3) for (var x = r[i + 1]; x <= r[i + 2]; x++) px[r[i] * w + x] = 0;
  return px;
}

/** Softie's twig arms: a tapering zig-zag branch between two black mittens, on the colour the layer keys out */
function twig(): Uint32Array {
  var w = 156, h = 36, bg = 0x7e6b33, px = new Uint32Array(w * h).fill(bg);
  var pts = [[26, 25], [44, 19], [58, 27], [74, 15], [88, 25], [101, 20], [124, 18]], k = 0, x: number, y: number;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      var d = 99;
      for (k = 0; k + 1 < pts.length; k++) {
        var ax = pts[k][0], ay = pts[k][1], bx = pts[k + 1][0], by = pts[k + 1][1], dx = bx - ax, dy = by - ay;
        var t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
      var v = Math.min(1, Math.max(0, 3.6 - d + 0.5));
      if (v > 0) px[y * w + x] = mix(bg, 0x55404a, v);
    }
  }
  var hand = (cx: number, cy: number, rx: number, ry: number): void => {
    var e = ellipse(w, h, cx, cy, rx, ry, 8, 0, bg);
    for (var i = 0; i < px.length; i++) if (e[i] !== bg) px[i] = mix(px[i], 0, 1 - ((e[i] >> 16 & 255) / ((bg >> 16) & 255)));
  };
  hand(17, 14, 15, 11);
  hand(138, 16, 16, 12);
  return px;
}

/** the red brush stroke (a mouth): a slab under a sloping lower edge, bright in the middle, on white */
function brush(): Uint32Array {
  var w = 72, h = 22, px = new Uint32Array(w * h).fill(0xffffff);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var top = 1.5, bot = 19.5 - 0.11 * x, edge = Math.min(x + 1, w - x, 6) / 6;
      var c = Math.min(1, Math.max(0, Math.min(y + 0.5 - top, bot - y - 0.5) + 0.5)) * Math.min(1, edge * 3);
      var t = (y + 0.5 - top) / Math.max(1, bot - top), lum = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      if (c > 0) px[y * w + x] = mix(0xffffff, (Math.floor(255 * lum) << 16) >>> 0, c);
    }
  }
  return px;
}

/** the pink heart (point towards row 0, as the table has it), white in the middle, on white */
function heart(): Uint32Array {
  var w = 36, h = 36, px = new Uint32Array(w * h).fill(0xffffff);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var hx = (x + 0.5 - 18) / 15.5, hy = (y + 0.5 - 19.5) / 14;
      var f = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3;      // < 0 inside
      if (f < 0) px[y * w + x] = mix(0xffffff, 0xf2606a, Math.min(1, (-f) < 0.02 ? 1 - (-f) / 0.02 : 0) * 0.85);
    }
  }
  return px;
}


var SNOWTIME: MusicalImage[] | null = null;
/** SnowTime (DATATABLE_6): 19 images. The sky ramp (352 x 320), the snowman's three white ovals, his two eyes and four coals, a
 *  black canvas, the red brush stroke, two red columns, three buttons, the twig arms and a heart. */
export function snowTimeImages(): MusicalImage[] {
  if (SNOWTIME) return SNOWTIME;
  var { im, put } = table();
  var col = rampOf(RAMPS.snowtime1), bg = new Uint32Array(352 * 320);
  for (var y = 0; y < 320; y++) bg.fill(col[y], y * 352, (y + 1) * 352);
  put(1, 352, 320, bg);
  put(2, 84, 77, ellipse(84, 77, 42.01, 36.94, 37.93, 37.47, 29.49, 0xffffff, 0));
  put(3, 116, 82, ellipse(116, 82, 57.65, 39.99, 53.73, 40.25, 29.68, 0xffffff, 0));
  put(4, 136, 102, ellipse(136, 102, 68.64, 50.46, 65.46, 50.78, 30.84, 0xffffff, 0));
  var eye = new Uint32Array(12 * 11).fill(0xffffff);
  for (var yy = 0; yy < 11; yy++) for (var xx = 0; xx < 12; xx++) if ((xx - 5) * (xx - 5) + (yy - 5) * (yy - 5) <= 20 && yy >= 1) eye[yy * 12 + xx] = 0;
  put(5, 12, 11, eye);
  put(6, 12, 11, eye.slice());
  put(7, 12, 12, ellipse(12, 12, 6.42, 6.09, 5.21, 4.38, 29.61, 0, 0xffffff));
  put(8, 12, 12, ellipse(12, 12, 6.3, 6.12, 4.82, 4.4, 30.29, 0, 0xffffff));
  put(9, 12, 12, ellipse(12, 12, 5.95, 5.96, 5.16, 5.21, 30.49, 0, 0xffffff));
  put(10, 12, 12, ellipse(12, 12, 5.7, 5.63, 4.55, 5.54, 29.2, 0, 0xffffff));
  put(11, 352, 320, fill(352, 320, 0));
  put(12, 72, 22, brush());
  put(13, 1, 256, rampOf(RAMPS.snowtime13));
  put(14, 1, 30, rampOf(RAMPS.snowtime14));
  put(15, 8, 8, runs(8, 8, [1, 2, 3, 2, 2, 5, 3, 1, 6, 4, 1, 6, 5, 2, 5, 6, 3, 4]));
  put(16, 8, 8, runs(8, 8, [1, 3, 4, 2, 2, 5, 3, 1, 6, 4, 1, 6, 5, 2, 6, 6, 4, 5]));
  put(17, 8, 8, runs(8, 8, [2, 3, 5, 3, 1, 5, 4, 1, 5, 5, 2, 5, 6, 2, 4]));
  put(18, 156, 36, twig());
  put(19, 36, 36, heart());
  SNOWTIME = im;
  return im;
}

// ---------------------------------------------------------------- Dungeon Siege (DATATABLE_9)
// The DLL's table holds the game publisher's artwork (a portrait, the title, fire photographs). This is our own: the same 32
// slots and sizes, and the same conventions the program relies on (black or white is the colour key, a blue picture is a mask, the
// images are stored bottom-up), drawn from a few shapes, a seeded noise and a fire palette. The pictures are not copies of the
// originals; only the ramp (image 20) and the flat fills (3, 4, 19, 21) are fitted or exact.

/** a small seeded generator (mulberry32) */
function rng(seed: number): () => number {
  var a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** smooth value noise in 2D, one lattice per seed */
function noise2(seed: number): (x: number, y: number) => number {
  var r = rng(seed), g = new Float32Array(64 * 64);
  for (var i = 0; i < g.length; i++) g[i] = r();
  var at = (ix: number, iy: number): number => g[(iy & 63) * 64 + (ix & 63)];
  return (x, y) => {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
  };
}

/** fractal noise: n octaves, 0..1 */
function fbm(n: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  var s = 0, a = 0.5, tot = 0;
  for (var o = 0; o < oct; o++) { s += a * n(x, y); tot += a; x *= 2; y *= 2; a *= 0.5; }
  return s / tot;
}

var clamp01 = (v: number): number => v < 0 ? 0 : v > 1 ? 1 : v;
var smooth = (a: number, b: number, v: number): number => { var t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
var lerpc = (a: number, b: number, t: number): number => mix(a, b, clamp01(t));

/** the fire palette: black, deep red, orange, yellow, white (t 0..1) */
function fire(t: number): number {
  var K = [[0, 0x000000], [0.22, 0x5c0800], [0.45, 0xd23200], [0.68, 0xff9c00], [0.86, 0xffea5a], [1, 0xffffff]];
  t = clamp01(t);
  for (var i = 1; i < K.length; i++) if (t <= K[i][0]) return lerpc(K[i - 1][1], K[i][1], (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]));
  return 0xffffff;
}

/** rows reversed: the table stores its pictures bottom-up */
function flip(w: number, h: number, px: Uint32Array): Uint32Array {
  var o = new Uint32Array(w * h);
  for (var y = 0; y < h; y++) o.set(px.subarray(y * w, (y + 1) * w), (h - 1 - y) * w);
  return o;
}

/** a picture from a per-pixel function of the upright picture (x, y from the top left) */
function paint(w: number, h: number, f: (x: number, y: number) => number): Uint32Array {
  var px = new Uint32Array(w * h);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) px[y * w + x] = f(x, y) & 0xffffff;
  return flip(w, h, px);
}

/** the flame intensity of a column (w x h): strongest down the middle, torn into tongues by the noise */
function flameField(w: number, h: number, seed: number): (x: number, y: number) => number {
  var n = noise2(seed);
  return (x, y) => {
    var u = (x + 0.5) / w - 0.5, col = Math.exp(-(u * u) / 0.06);
    return clamp01(col * (0.25 + 1.15 * fbm(n, x * 0.09, y * 0.045, 4)) - 0.1);
  };
}
/** a flame column on white (the white is its colour key) */
function flameColumn(w: number, h: number, seed: number): Uint32Array {
  var f = flameField(w, h, seed);
  return paint(w, h, (x, y) => { var v = f(x, y); return v < 0.05 ? 0xffffff : lerpc(0xffffff, fire(0.28 + 0.5 * v), Math.min(1, v * 2.2)); });
}
/** the blue mask of a flame column (its blue byte is the alpha: dark where the flame is thick) */
function flameMask(w: number, h: number, seed: number): Uint32Array {
  var f = flameField(w, h, seed);
  return paint(w, h, (x, y) => 255 - Math.round(210 * f(x, y)));
}
/** a full-bleed fire texture (a) or its mask (b) */
function fireField(w: number, h: number, seed: number, mask: boolean): Uint32Array {
  var n = noise2(seed);
  return paint(w, h, (x, y) => {
    var v = clamp01(fbm(n, x * 0.05, y * 0.07, 5) * 1.5 - 0.2);
    return mask ? 255 - Math.round(200 * v) : fire(0.22 + 0.56 * v);
  });
}
/** a flame sprite on black: lobes of fire with torn edges */
function fireBlob(w: number, h: number, seed: number): Uint32Array {
  var n = noise2(seed), r = rng(seed ^ 0x9e37), lobes: number[][] = [];
  for (var i = 0; i < 4; i++) lobes.push([0.3 + 0.4 * r(), 0.3 + 0.4 * r(), 0.22 + 0.2 * r()]);
  return paint(w, h, (x, y) => {
    var u = (x + 0.5) / w, v = (y + 0.5) / h, m = 0;
    for (var l of lobes) { var d = Math.hypot((u - l[0]) * w, (v - l[1]) * h) / (l[2] * Math.max(w, h)); m = Math.max(m, 1 - d); }
    var edge = smooth(0, 0.7, m) * (0.55 + 0.9 * fbm(n, x * 0.07, y * 0.07, 4));
    return edge < 0.05 ? 0 : fire(0.1 + 0.72 * Math.min(1, edge));
  });
}

// the title: our own 5 x 7 letters, enlarged, bevelled in steel, on black
var GLYPH: { [c: string]: string[] } = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'], G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
};
function titleText(): Uint32Array {
  var w = 280, h = 164, sc = 6, cov = new Float32Array(w * h);
  var word = (txt: string, x0: number, y0: number): void => {
    for (var k = 0; k < txt.length; k++) {
      var g = GLYPH[txt[k]];
      for (var y = 0; y < 7 * sc; y++) {
        for (var x = 0; x < 5 * sc; x++) {
          var gx = (x + 0.5) / sc - 0.5, gy = (y + 0.5) / sc - 0.5, ix = Math.floor(gx), iy = Math.floor(gy), s = 0;
          for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) {
            var px = Math.min(4, Math.max(0, ix + dx)), py = Math.min(6, Math.max(0, iy + dy));
            s += (g[py][px] === '1' ? 1 : 0) * (dx ? gx - ix : 1 - (gx - ix)) * (dy ? gy - iy : 1 - (gy - iy));
          }
          cov[(y0 + y) * w + x0 + k * 6 * sc + x] = smooth(0.35, 0.65, s);
        }
      }
    }
  };
  word('DUNGEON', 14, 22);
  word('SIEGE', 96, 84);
  return paint(w, h, (x, y) => {
    var c = cov[y * w + x];
    if (c <= 0) return 0;
    var up = y > 0 ? cov[(y - 1) * w + x] : 0, lit = clamp01(0.55 + (c - up) * 1.4 + 0.25 * Math.sin(y * 0.55));
    return lerpc(0x3a3a40, 0xe8eaf0, lit * c);
  });
}

/** eyelids and eyes: a skin wedge under a curved lid line on black (w x h), `open` the white of an eye */
function lid(w: number, h: number, curve: number, eye: boolean): Uint32Array {
  return paint(w, h, (x, y) => {
    var u = (x + 0.5) / w, edge = h * (0.15 + curve * Math.sin(Math.PI * u));
    if (y > edge + 1) return 0;
    if (y > edge - 1.2) return 0x2a1408;
    if (eye) return Math.hypot((u - 0.55) * w, y - h * 0.35) < h * 0.3 ? 0x1c0c04 : lerpc(0xffffff, 0xe69a50, u * u);
    return lerpc(0xf3c19a, 0xb06a38, (y / h) * 1.2 + u * 0.2);
  });
}

/** the portrait (216 x 320): hair, face, steel shoulder with spikes, the sword at the right */
function portrait(): Uint32Array {
  var w = 216, h = 320, n = noise2(11);
  var ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => smooth(1, 0.82, Math.hypot((x - cx) / rx, (y - cy) / ry));
  return paint(w, h, (x, y) => {
    var c = 0, hair = Math.max(ell(x, y, 130, 70, 62, 70), ell(x, y, 150, 40, 40, 44), ell(x, y, 100, 130, 40, 90) * 0.9);
    if (hair > 0) c = lerpc(0x701000, 0xff5a10, 0.5 + 0.7 * fbm(n, x * 0.06, y * 0.04, 3) + (130 - y) * 0.002);
    var face = ell(x, y, 118, 100, 36, 48);
    if (face > 0) c = lerpc(c, lerpc(0x8a3c22, 0xf0b08a, 0.45 + (x - 100) * 0.006 - (y - 100) * 0.003), face);
    if (Math.abs(y - 92) < 2 && Math.abs(x - 108) < 14 || Math.abs(y - 92) < 2 && Math.abs(x - 134) < 12) c = 0x3a1a10;
    if (Math.abs(y - 128) < 2 && Math.abs(x - 120) < 10) c = 0x8c2a22;
    var body = Math.max(ell(x, y, 100, 270, 110, 100), ell(x, y, 40, 215, 48, 40));
    if (body > 0) {
      var steel = 0.35 + 0.45 * fbm(n, x * 0.1, y * 0.1, 3) + 0.2 * Math.sin((x + y) * 0.09);
      c = lerpc(c, lerpc(0x2a2a30, 0xc8ccd6, steel), body);
    }
    for (var s = 0; s < 3; s++) { var sx = 20 + s * 26, sy = 168 + s * 6; if (Math.abs(x - sx) < (sy - y) * 0.16 && y < sy && y > sy - 34) c = 0xb8bcc8; }
    var blade = smooth(8, 3, Math.abs(x - (190 + (y - 40) * 0.01))) * (y > 6 ? 1 : 0);
    if (blade > 0) c = lerpc(c, lerpc(0xffc050, 0xffffff, 1 - Math.abs(x - 190) / 8), blade);
    return c;
  });
}

/** the sword and its glow (76 x 215) */
function swordGlow(): Uint32Array {
  var w = 76, h = 215, n = noise2(23);
  return paint(w, h, (x, y) => {
    var d = Math.abs((x + 0.5) / w - 0.52), gl = Math.exp(-(d * d) / 0.045), core = smooth(0.1, 0.03, d), c = lerpc(0x120800, 0xa8a800, gl * (0.85 + 0.3 * fbm(n, x * 0.1, y * 0.05, 3)));
    c = lerpc(c, 0xfff6c0, core);
    if (y < 34) { var wing = smooth(0.46, 0.2, d + y * 0.004) * smooth(0, 14, y); c = lerpc(c, lerpc(0x8a4a10, 0xf8e8c0, 1 - y / 34), wing * 0.9); }
    if (x < 14) c = lerpc(c, 0x7a2a08, 0.7 * smooth(14, 0, x));
    return c;
  });
}

/** the dragon's two glowing slits (132 x 198) */
function slitEyes(): Uint32Array {
  return paint(132, 198, (x, y) => {
    var best = 0;
    for (var e = 0; e < 2; e++) {
      var cx = e ? 98 : 34, u = (x - cx) / 20, v = (y - 126 + (e ? (x - cx) * 0.2 : -(x - cx) * 0.2)) / 6;
      best = Math.max(best, 1 - Math.hypot(u, v * 1.8));
    }
    return best <= 0 ? 0 : fire(0.55 + 0.45 * smooth(0, 0.7, best));
  });
}

/** the dragon's head: a dark spiky shape with fire on its rim (132 x 198) */
function dragonHead(): Uint32Array {
  var n = noise2(31);
  return paint(132, 198, (x, y) => {
    var dx = (x - 66) / 62, dy = (y - 110) / 84, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    var spike = 0.62 + 0.3 * Math.abs(Math.sin(th * 3.5)) ** 2 + 0.06 * fbm(n, x * 0.1, y * 0.1, 3);
    var e = smooth(spike + 0.04, spike - 0.04, r);
    if (e <= 0) return 0;
    var rim = smooth(spike - 0.22, spike, r);
    return lerpc(0x120604, fire(0.35 + 0.5 * rim), rim * e);
  });
}

var DUNGEON: MusicalImage[] | null = null;
/** Dungeon Siege's 32 images, in the table's order and sizes: the portrait (2), the sword's glow (8), two flame columns on white
 *  (5, 7) and their blue mask (6), the eyes' lids (1, 9, 10, 12, 18), the dragon's slits (11) and head (13), two fire fields (14, 15)
 *  and their mask (16), the title (17), the flame sprites (22..32), a black canvas (19), the colour ramp (20) and its dark twin (21) */
export function dungeonImages(): MusicalImage[] {
  if (DUNGEON) return DUNGEON;
  var { im, put } = table();
  put(1, 16, 7, lid(16, 7, 0.45, false));
  put(2, 216, 320, portrait());
  put(3, 1, 1, fill(1, 1, 0xff8700));
  put(4, 1, 1, fill(1, 1, 0xff8700));
  put(5, 76, 221, flameColumn(76, 221, 5));
  put(6, 76, 221, flameMask(76, 221, 5));
  put(7, 76, 221, flameColumn(76, 221, 7));
  put(8, 76, 215, swordGlow());
  put(9, 48, 14, lid(48, 14, 0.5, false));
  put(10, 48, 14, lid(48, 14, 0.4, false));
  put(11, 132, 198, slitEyes());
  put(12, 16, 9, lid(16, 9, 0.4, false));
  put(13, 132, 198, dragonHead());
  put(14, 200, 140, fireField(200, 140, 14, false));
  put(15, 200, 140, fireField(200, 140, 15, false));
  put(16, 200, 140, fireField(200, 140, 14, true));
  put(17, 280, 164, titleText());
  put(18, 40, 14, lid(40, 14, 0.5, true));
  put(19, 350, 320, fill(350, 320, 0));
  put(20, 3, 319, rampOf(RAMPS.dungeon20));
  put(21, 3, 319, fill(3, 319, 0));
  var SPR = [[108, 125], [112, 115], [88, 86], [140, 64], [84, 118], [92, 134], [84, 85], [120, 164], [140, 78], [120, 167], [100, 76]];
  for (var i = 0; i < SPR.length; i++) put(22 + i, SPR[i][0], SPR[i][1], fireBlob(SPR[i][0], SPR[i][1], 100 + i));
  DUNGEON = im;
  return im;
}
