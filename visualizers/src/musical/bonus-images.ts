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
