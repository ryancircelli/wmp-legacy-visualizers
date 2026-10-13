// The Plus builds' image tables (Blazing Colors / Pulsing Colors, Color Cubes, Trilogy I-III). The DLLs'
// DATATABLE resources hold Microsoft's originals; this is our own recreation, generated from a few parameters
// of what each image shows, the same method as Musical Colors (images.ts):
// - solid fills and short literals (all the flat sprites and canvases, the black and white fields, the single
//   colour columns): byte-identical to the originals;
// - colour ramps (the hue cycles and rainbow columns): key colours at a few rows per column, per-channel linear
//   interpolation (rounded); a column may repeat another. The keys were fitted by private tools (least-squares
//   linear splines, >= 99% of channel values within +-2 levels; the originals' dithering noise of +-1 is not
//   reproduced), so these are close, not byte-identical;
// - Color Cubes' 1 x 1024 random-looking palette (image 74): our own walk in hue / saturation / brightness
//   through 64 evenly spaced key colours (each a saturation-weighted local average, not any original entry).
// Index 1..n as the engine's table numbers them (index 0 unused).
import type { MusicalImage } from './images';

export type Col = number | number[];          // another column's index, or keys [row, 0xRRGGBB, row, 0xRRGGBB, ...]
export interface Ramp { w: number; h: number; c: Col[] }

const RAMPS: { [name: string]: Ramp } = {
  blaze2: { w: 3, h: 1024, c: [
    [0, 0xf0fe00, 34, 0xf0fe00, 61, 0xf1fe19, 196, 0xffffdb, 231, 0xffffff, 248, 0xefeeff, 307, 0x8685ff, 372, 0x1e27ff, 396, 0x040bff, 407, 0x0002ff, 426, 0x0700f0, 441, 0x1c00da, 501, 0x8a0375, 552, 0xe10012, 568, 0xf60103, 582, 0xff0900, 614, 0xff1d0e, 632, 0xff2d1e, 723, 0xfe8480, 776, 0xffe9e6, 794, 0xfffffd, 804, 0xf1ffff, 844, 0x80fefe, 863, 0x27fcff, 870, 0x0cfcff, 875, 0x02fbff, 887, 0x01faf7, 911, 0x16f8de, 980, 0x82ef7e, 999, 0xd2e82d, 1010, 0xfbe406, 1023, 0xffe400],
    [0, 0xf0fe00, 36, 0xf0fe01, 60, 0xf0fe18, 168, 0xfdffb2, 205, 0xffffe7, 233, 0xffffff, 264, 0xd4d4ff, 305, 0x8887ff, 372, 0x1e27ff, 396, 0x040bff, 412, 0x0000ff, 437, 0x1500e1, 505, 0x91036e, 552, 0xe10012, 569, 0xf70203, 580, 0xff0800, 607, 0xff1909, 634, 0xff2f20, 723, 0xfe8480, 776, 0xffe9e6, 795, 0xfffffe, 813, 0xd9ffff, 844, 0x80fefe, 865, 0x1efdff, 875, 0x00fbff, 891, 0x04faf3, 908, 0x12f8e2, 980, 0x81ef7e, 1000, 0xd8e728, 1013, 0xffe400, 1023, 0xfde403],
    1] },
  blaze5: { w: 3, h: 320, c: [
    [0, 0xff0900, 6, 0xff2200, 25, 0xff8600, 44, 0xfff300, 50, 0xfdff00, 60, 0xd2ff00, 94, 0x22ff00, 104, 0x00ff00, 111, 0x00ff23, 138, 0x00ffdb, 145, 0x00ffff, 149, 0x00fcff, 163, 0x00dcff, 195, 0x007fff, 214, 0x001eff, 221, 0x0003ff, 226, 0x0600ff, 268, 0xf200ff, 273, 0xff00ff, 280, 0xff00e3, 311, 0xff002d, 319, 0xff0006],
    [0, 0xff0b00, 5, 0xff1e00, 24, 0xff8000, 44, 0xfff300, 49, 0xfeff00, 53, 0xf4ff00, 99, 0x0aff00, 104, 0x00ff00, 111, 0x00ff23, 138, 0x00ffdb, 145, 0x00ffff, 154, 0x00f1ff, 164, 0x00daff, 198, 0x0074ff, 213, 0x0021ff, 222, 0x0001ff, 225, 0x0500ff, 234, 0x3100ff, 262, 0xd200ff, 272, 0xff00ff, 275, 0xff00f9, 281, 0xff00dd, 314, 0xff001c, 319, 0xff0007],
    [0, 0xff0800, 10, 0xff3700, 24, 0xff8100, 44, 0xfff200, 48, 0xffff00, 54, 0xf0ff00, 93, 0x28ff00, 99, 0x0dff00, 104, 0x00ff00, 111, 0x00ff22, 138, 0x00ffdb, 145, 0x00ffff, 157, 0x00edff, 195, 0x007fff, 219, 0x0007ff, 225, 0x0400ff, 233, 0x2c00ff, 268, 0xf300ff, 273, 0xff00ff, 282, 0xff00d8, 312, 0xff0027, 319, 0xff0006]] },
  cubes73: { w: 1, h: 255, c: [
    [0, 0xff0001, 7, 0xff002b, 31, 0xff00dd, 35, 0xff00f5, 38, 0xff00ff, 46, 0xda00ff, 81, 0x0600ff, 87, 0x0003ff, 128, 0x00e3ff, 136, 0x00ffff, 146, 0x00ffda, 163, 0x00ff81, 165, 0x00ff68, 170, 0x00ff11, 172, 0x00ff00, 177, 0x20ff00, 187, 0x7eff00, 207, 0xe2ff00, 214, 0xfcff00, 217, 0xfffc00, 223, 0xffdc00, 249, 0xff2800, 254, 0xff0b00]] },
  cubes75: { w: 1, h: 255, c: [
    [0, 0xff0504, 4, 0xff2323, 7, 0xff4444, 24, 0xfff0f0, 27, 0xfeffff, 30, 0xf3ffff, 47, 0x6dffff, 57, 0x12ffff, 62, 0x00ffff, 66, 0x08ffff, 88, 0xe6ffff, 91, 0xfbffff, 93, 0xffffff, 95, 0xfefff8, 99, 0xeaffe0, 113, 0x6dff6e, 124, 0x09ff08, 128, 0x00ff00, 132, 0x0aff0a, 135, 0x21ff21, 147, 0x8eff8e, 155, 0xdfffea, 159, 0xfdffff, 163, 0xfffffa, 167, 0xffffe9, 181, 0xffff81, 183, 0xffff6a, 189, 0xffff13, 192, 0xffff00, 195, 0xffff07, 198, 0xffff24, 203, 0xffff63, 213, 0xffffdc, 215, 0xfffff1, 217, 0xfffffe, 220, 0xfff9fd, 223, 0xffe8f3, 234, 0xff9091, 248, 0xff2121, 251, 0xff0d0e, 254, 0xff0000]] },
  cubes76: { w: 1, h: 320, c: [
    [0, 0xff0600, 24, 0xff8000, 44, 0xfff300, 48, 0xfefe00, 52, 0xf9ff00, 99, 0x0bff00, 104, 0x00ff00, 111, 0x00ff22, 138, 0x00ffdb, 145, 0x00ffff, 156, 0x00efff, 195, 0x0080ff, 215, 0x0019ff, 222, 0x0001ff, 225, 0x0500ff, 231, 0x2100ff, 268, 0xf200ff, 273, 0xff00ff, 281, 0xff00dd, 314, 0xff001c, 319, 0xff0007]] },
  trilogy5: { w: 3, h: 256, c: [
    [0, 0xff0a00, 5, 0xff2400, 19, 0xff8000, 35, 0xfff200, 40, 0xfdff00, 50, 0xc5ff00, 75, 0x22ff00, 83, 0x00ff00, 89, 0x00ff25, 111, 0x00ffe1, 116, 0x00ffff, 122, 0x00f4ff, 131, 0x00d9ff, 156, 0x007fff, 172, 0x0018ff, 178, 0x0000ff, 182, 0x0e00ff, 214, 0xf000ff, 218, 0xff00ff, 223, 0xff00e9, 249, 0xff002b, 255, 0xff0006],
    [0, 0xff0b00, 3, 0xff1800, 19, 0xff8000, 35, 0xfff200, 39, 0xfdff00, 42, 0xf6ff00, 77, 0x17ff00, 83, 0x00ff00, 88, 0x00ff1d, 111, 0x00ffe1, 116, 0x00ffff, 130, 0x00deff, 156, 0x007eff, 172, 0x0019ff, 178, 0x0000ff, 183, 0x1500ff, 214, 0xf000ff, 218, 0xff00ff, 220, 0xff00f9, 226, 0xff00d4, 252, 0xff0016, 255, 0xff0008],
    1] },
};

// Color Cubes image 74: key colours (hue 0..1, saturation, brightness) every 1023 / 63 rows, hue the short way round.
const PAL_H = [0.673, 0.6701, 0.8603, 0.5383, 0.2771, 0.5406, 0.8491, 0.1011, 0.1481, 0.0523, 0.9668, 0.0665, 0.0868, 0.681, 0.103, 0.9266, 0.6574, 0.0674, 0.0568, 0.115, 0.0901, 0.6792, 0.6666, 0.6667, 0.686, 0.077, 0.315, 0.5415, 0.4215, 0.5018, 0.5743, 0.4571, 0.4676, 0.3759, 0.4162, 0.5919, 0.6666, 0.6667, 0.6326, 0.4005, 0.209, 0.2172, 0.1991, 0.2287, 0.1222, 0.1532, 0.1829, 0.2217, 0.311, 0.0703, 0.9316, 0.9758, 0.0109, 0.1326, 0.3545, 0.5056, 0.394, 0.5, 0.5598, 0.3994, 0.436, 0.3404, 0.4294, 0.5567]
const PAL_S = [0.9811, 0.9758, 0.769, 0.8025, 0.6842, 0.6888, 0.6089, 0.6163, 0.4813, 0.9009, 0.9544, 0.8741, 0.7871, 0.5239, 0.6754, 0.4243, 0.6283, 0.6297, 0.5046, 0.8916, 0.706, 0.8172, 0.9861, 0.9848, 0.9098, 0.8217, 0.9269, 0.9897, 0.9899, 0.9897, 0.9881, 0.9859, 0.9849, 0.9876, 0.9889, 0.9893, 0.9863, 0.9848, 0.9738, 0.9745, 0.9198, 0.8473, 0.9101, 0.8587, 0.8511, 0.9127, 0.893, 0.9599, 0.9268, 0.8526, 0.9186, 0.9567, 0.9592, 0.9513, 0.8581, 0.902, 0.877, 0.9376, 0.7706, 0.7506, 0.841, 0.9581, 0.99, 0.9903]
const PAL_V = [0.4837, 0.631, 0.7418, 0.796, 0.7731, 0.7621, 0.7905, 0.7726, 0.5998, 0.7962, 0.9787, 0.9992, 0.8956, 0.8242, 0.9934, 0.8883, 0.7274, 0.8404, 0.764, 0.9412, 0.9719, 0.7642, 0.5933, 0.5453, 0.3531, 0.7386, 0.7234, 0.7583, 0.7748, 0.7615, 0.706, 0.5839, 0.5393, 0.666, 0.7106, 0.75, 0.5934, 0.5453, 0.3233, 0.4207, 0.8688, 0.9319, 0.9989, 0.9774, 0.9658, 0.9695, 0.8476, 0.959, 0.9896, 0.5405, 0.2789, 0.8281, 1.0, 0.9811, 0.7437, 0.8299, 0.8991, 0.8197, 0.6915, 0.6882, 0.6127, 0.8156, 0.8027, 0.8095]

export function fill(w: number, h: number, colour: number): Uint32Array { return new Uint32Array(w * h).fill(colour); }

/** keys [row, 0xRRGGBB, row, 0xRRGGBB, ...] -> one column, each channel linear between keys (rounded) */
function keyed(k: number[], h: number): Uint32Array {
  var out = new Uint32Array(h);
  for (var j = 0; j + 2 < k.length; j += 2) {
    var ya = k[j], yb = k[j + 2], a = k[j + 1], b = k[j + 3];
    for (var y = ya; y <= yb; y++) {
      var t = (y - ya) / (yb - ya), v = 0;
      for (var sh = 16; sh >= 0; sh -= 8) {
        var ca = a >> sh & 255, cb = b >> sh & 255;
        v = v << 8 | Math.floor(ca + (cb - ca) * t + 0.5);
      }
      out[y] = v >>> 0;
    }
  }
  return out;
}

function ramp(name: string): Uint32Array { return rampOf(RAMPS[name]); }
/** a ramp image from its key colours (our own parametrisation: bonus-images.ts uses it too) */
export function rampOf(r: Ramp): Uint32Array {
  var cols: Uint32Array[] = [], c: number;
  for (c = 0; c < r.w; c++) { var spec = r.c[c]; if (typeof spec !== 'number') cols[c] = keyed(spec, r.h); }
  for (c = 0; c < r.w; c++) { var sp2 = r.c[c]; if (typeof sp2 === 'number') cols[c] = cols[sp2].slice(); }
  var px = new Uint32Array(r.w * r.h);
  for (var y = 0; y < r.h; y++) for (c = 0; c < r.w; c++) px[y * r.w + c] = cols[c][y];
  return px;
}

function palette(): Uint32Array {
  var K = PAL_H.length, N = 1024, px = new Uint32Array(N), mod1 = (x: number): number => ((x % 1) + 1) % 1;
  for (var i = 0; i < N; i++) {
    var j = 0;
    while (j < K - 2 && Math.round((j + 1) * (N - 1) / (K - 1)) <= i) j++;
    var ra = Math.round(j * (N - 1) / (K - 1)), rb = Math.round((j + 1) * (N - 1) / (K - 1)), t = (i - ra) / (rb - ra);
    var dh = mod1(PAL_H[j + 1] - PAL_H[j] + 0.5) - 0.5;
    var h = mod1(PAL_H[j] + dh * t), s = PAL_S[j] + (PAL_S[j + 1] - PAL_S[j]) * t, v = PAL_V[j] + (PAL_V[j + 1] - PAL_V[j]) * t;
    var k = Math.floor(h * 6), f = h * 6 - k, p = v * (1 - s), q = v * (1 - s * f), u = v * (1 - s * (1 - f));
    var rgb = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][k % 6];
    px[i] = (Math.floor(rgb[0] * 255 + 0.5) << 16 | Math.floor(rgb[1] * 255 + 0.5) << 8 | Math.floor(rgb[2] * 255 + 0.5)) >>> 0;
  }
  return px;
}

var BLAZE: MusicalImage[] | null = null;
/** Blazing Colors and Pulsing Colors (DATATABLE_2): 6 images */
export function blazeImages(): MusicalImage[] {
  if (BLAZE) return BLAZE;
  var im: MusicalImage[] = [];
  var put = (id: number, w: number, h: number, px: Uint32Array): void => { im[id] = { type: 0x24, w, h, px }; };
  put(1, 352, 320, fill(352, 320, 0));
  put(2, 3, 1024, ramp('blaze2'));
  put(3, 1, 256, fill(1, 256, 0x0000ff));
  put(4, 1, 320, fill(1, 320, 0x1801fe));
  put(5, 3, 320, ramp('blaze5'));
  put(6, 352, 320, fill(352, 320, 0));
  BLAZE = im;
  return im;
}

var CUBES: MusicalImage[] | null = null;
/** Color Cubes (DATATABLE_3): 78 images. Ten flat sprites (sizes and colours) five times over, twenty 80 x 80 blue
 *  squares, two more sprites, four colour columns, the palette, a black canvas and a white square. */
export function colorCubesImages(): MusicalImage[] {
  if (CUBES) return CUBES;
  var im: MusicalImage[] = [];
  var put = (id: number, w: number, h: number, px: Uint32Array): void => { im[id] = { type: 0x24, w, h, px }; };
  var base = [[16, 86, 0x533ebb], [40, 80, 0xff0101], [42, 37, 0x195216], [60, 80, 0xfffc01], [72, 48, 0x01ff01],
    [80, 11, 0x4a489a], [80, 32, 0xb11923], [80, 80, 0x0000ff], [28, 51, 0x984619], [56, 28, 0x20942e]];
  for (var i = 1; i <= 50; i++) { var b = base[(i - 1) % 10]; put(i, b[0], b[1], fill(b[0], b[1], b[2])); }
  for (i = 51; i <= 70; i++) put(i, 80, 80, fill(80, 80, 0x0000ff));
  put(71, 28, 51, fill(28, 51, 0x984619));
  put(72, 56, 28, fill(56, 28, 0x20942e));
  put(73, 1, 255, ramp('cubes73'));
  put(74, 1, 1024, palette());
  put(75, 1, 255, ramp('cubes75'));
  put(76, 1, 320, ramp('cubes76'));
  put(77, 352, 320, fill(352, 320, 0));
  put(78, 200, 200, fill(200, 200, 0xffffff));
  CUBES = im;
  return im;
}

var TRILOGY: MusicalImage[] | null = null;
/** Trilogy I, II and III (DATATABLE_10): 5 images. Two black canvases, a colour column, a two-pixel literal
 *  (type 0x16) and a hue ramp. */
export function trilogyImages(): MusicalImage[] {
  if (TRILOGY) return TRILOGY;
  var im: MusicalImage[] = [];
  im[1] = { type: 0x24, w: 350, h: 320, px: fill(350, 320, 0) };
  im[2] = { type: 0x24, w: 350, h: 320, px: fill(350, 320, 0) };
  im[3] = { type: 0x24, w: 1, h: 320, px: fill(1, 320, 0x1801fe) };
  im[4] = { type: 0x16, w: 2, h: 1, px: Uint32Array.of(0xf8f800, 0x000000) };
  im[5] = { type: 0x24, w: 3, h: 256, px: ramp('trilogy5') };
  TRILOGY = im;
  return im;
}
