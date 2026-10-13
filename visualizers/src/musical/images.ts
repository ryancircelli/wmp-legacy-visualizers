// Musical Colors' 42 layer images (the DLL's DATATABLE resource holds Microsoft's originals; this is our
// own recreation). Each image is generated from a few parameters of what it shows:
// - solid fills, short literals and run lists (14 images, byte-identical to the originals);
// - colour ramps (3 x 256, and the 1 x 1024 hue cycle): key colours at a few rows per column with
//   per-channel linear interpolation (rounded), a column may repeat another; the "spray" ramps get our own
//   seeded sparkles (the originals' count and colour per column, our positions);
// - the Star Power starburst: a 14-point star distance (radius times a triangle wave in the angle) through
//   a piecewise-linear brightness curve;
// - Star Power's background palette: our own walk in hue / saturation / brightness through 16 key colours.
// The key colours were fitted by private tools (least-squares linear splines within +-2 levels at 99% of
// channel values; the originals' dithering noise is not reproduced). The private A/B twin can still load
// the original resource (MusicalColors options.datatable) to prove the rest of the engine exact.

/** one decoded image as the engine's table holds it: type (0x16 or 0x24), size, 0x00RRGGBB pixels */
export interface MusicalImage { type: number; w: number; h: number; px: Uint32Array }

type Col = number | number[];          // another column's index, or keys [row, 0xRRGGBB, row, 0xRRGGBB, ...]
interface Ramp { w: number; h: number; c: Col[]; s?: number[] }   // s: [column, count, colour, ...]

const RAMPS: { [id: number]: Ramp } = {
  4: { w: 3, h: 256, c: [
    [0, 0x01e6fd, 120, 0x00feee, 255, 0x01e8fc],
    0,
    [0, 0xddfdfe, 255, 0xddfdfe]] },
  6: { w: 3, h: 256, c: [
    [0, 0xff6e02, 18, 0xff7e02, 72, 0xffc201, 108, 0xfff600, 132, 0xffff00, 153, 0xffeb00, 183, 0xffbc00, 231, 0xff8200, 255, 0xff6c00],
    0,
    [0, 0xf6ff01, 66, 0xfab901, 105, 0xfd7f01, 120, 0xfe7301, 135, 0xfe7001, 228, 0xf7e601, 255, 0xf6ff01]] },
  7: { w: 3, h: 256, c: [
    [0, 0x0200ff, 6, 0x1800ff, 24, 0x7b00ff, 45, 0xe900ff, 51, 0xfc00ff, 57, 0xff04ff, 63, 0xe524ff, 75, 0x8a75ff, 96, 0x24dbff, 105, 0x03fbff, 108, 0x00fffd, 114, 0x00ffd8, 141, 0x00ff04, 144, 0x02ff00, 150, 0x28ff00, 171, 0xcfff00, 177, 0xf9ff00, 180, 0xfffd00, 186, 0xffee00, 207, 0xff9a00, 222, 0xfe4900, 231, 0xfe2900, 243, 0xfe1d00, 255, 0xff0100],
    0,
    [0, 0x20ff00, 6, 0x08ff00, 9, 0x00ff06, 21, 0x00ff4a, 33, 0x00ff86, 42, 0x00ffb8, 51, 0x00ffda, 57, 0x05ffdc, 60, 0x14ffd5, 66, 0x37ffb4, 75, 0x76ff78, 78, 0x96ff7b, 96, 0xf7ff25, 99, 0xfff918, 105, 0xffe103, 108, 0xffda00, 114, 0xffb500, 129, 0xff4100, 135, 0xff0e00, 138, 0xff0008, 147, 0xff0034, 171, 0xff00ef, 174, 0xf900ff, 177, 0xe200ff, 186, 0xcb00ff, 207, 0x7700ff, 225, 0x1900fe, 231, 0x0800fe, 237, 0x0000fe, 243, 0x0005fe, 255, 0x0022ff]] },
  8: { w: 3, h: 256, c: [
    [0, 0x1982eb, 6, 0x3581d3, 18, 0x847f8e, 27, 0x9b7d7b, 36, 0xb67a64, 45, 0xce784f, 54, 0xe3783d, 60, 0xed7d33, 66, 0xf68e26, 78, 0xf5bd1b, 99, 0xffe40b, 117, 0xffff00, 120, 0xfbff00, 126, 0xdaff00, 150, 0x2eff00, 156, 0x09ff00, 159, 0x00ff00, 165, 0x00ff14, 186, 0x00ff88, 192, 0x00ffc2, 198, 0x00fff2, 201, 0x00ffff, 207, 0x00f2ff, 213, 0x00e0ff, 234, 0x0093ff, 237, 0x0082ff, 246, 0x0042ff, 252, 0x0020ff, 255, 0x0000ff],
    [0, 0x0065ce, 6, 0x1864b6, 18, 0x676272, 51, 0xc15a25, 60, 0xd16016, 66, 0xd97109, 78, 0xd7a000, 93, 0xe1bb00, 105, 0xe3d200, 120, 0xe1e400, 126, 0xbce200, 150, 0x11e200, 153, 0x00e200, 165, 0x00e200, 168, 0x00e206, 186, 0x00e26b, 195, 0x00e2bf, 201, 0x00e2e3, 210, 0x00cde2, 234, 0x0076e2, 252, 0x0002e2, 255, 0x0000e2],
    0] },
  9: { w: 3, h: 256, c: [
    [0, 0xfffefe, 9, 0xffd8e1, 21, 0xff92ac, 42, 0xff2859, 51, 0xff013b, 57, 0xf0003b, 66, 0xe60045, 72, 0xe60058, 75, 0xe6006a, 79, 0xe8009a, 82, 0xf500ee, 83, 0xe500f8, 85, 0x9d01ff, 86, 0x7b05ff, 87, 0x4303ff, 89, 0x0009ff, 93, 0x0064f4, 96, 0x008fe5, 99, 0x00ace3, 105, 0x00c2e1, 114, 0x00c7da, 120, 0x00ccdb, 126, 0x00cad8, 147, 0x00aaba, 153, 0x00a3b3, 171, 0x008c97, 177, 0x008691, 183, 0x00838f, 189, 0x00919f, 195, 0x00a8b8, 207, 0x00e4fb, 210, 0x10eaff, 225, 0x62f1ff, 243, 0xc7f9ff, 252, 0xf0ffff, 255, 0xfaffff],
    [0, 0xfffeff, 9, 0xffd8e1, 24, 0xff81a0, 33, 0xff567e, 42, 0xff2858, 51, 0xff013b, 57, 0xf1003b, 63, 0xe90040, 69, 0xe6004c, 75, 0xe50069, 78, 0xe6008b, 81, 0xef00ce, 82, 0xf500ef, 84, 0xc501fe, 88, 0x2306ff, 89, 0x0007ff, 93, 0x0066f3, 96, 0x008fe5, 99, 0x00a9e3, 105, 0x00c2e0, 120, 0x00cbda, 129, 0x00c7d5, 144, 0x00adbe, 177, 0x008690, 183, 0x008390, 189, 0x00909e, 201, 0x00c4d7, 207, 0x00e7fe, 225, 0x62f1ff, 246, 0xd7fcff, 255, 0xfafeff],
    [0, 0xffffff, 9, 0xfff1f4, 27, 0xffcdd9, 30, 0xffc9d6, 39, 0xffb8c8, 48, 0xffaabd, 57, 0xff9fb7, 66, 0xff9cbb, 72, 0xff9cc1, 78, 0xff9cd7, 81, 0xff9ff3, 84, 0xeca5ff, 87, 0xbda5ff, 90, 0xa2adff, 96, 0x9ddcff, 99, 0x9be5ff, 105, 0x9af2ff, 117, 0x98f8ff, 126, 0x97f8ff, 165, 0x84f4ff, 174, 0x7ff7ff, 183, 0x7df4ff, 192, 0x87f5ff, 237, 0xdffcff, 240, 0xe6fdff, 255, 0xfefeff]] },
  12: { w: 3, h: 256, c: [
    [0, 0xf9fff9, 9, 0xdaffd9, 24, 0x96fe95, 33, 0x71fe6f, 48, 0x25fd29, 60, 0x01fd00, 66, 0x0dfd00, 78, 0x61fc00, 81, 0x71fe00, 105, 0xc2ff00, 114, 0xd7fd00, 129, 0xe1e616, 144, 0xe5c537, 171, 0xe98376, 174, 0xea7f7b, 201, 0xfb07e3, 213, 0xff00ff, 222, 0xff33ff, 231, 0xff71fa, 255, 0xfffaff],
    0,
    [0, 0xffffff, 54, 0xbefebf, 66, 0xbcfeb9, 78, 0xd7ffba, 120, 0xf8febb, 174, 0xf9dcdc, 204, 0xfebafa, 213, 0xffbbff, 255, 0xfffefe]] },
  13: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfbffff, 6, 0xcafcfb, 9, 0x97fbf6, 11, 0x76f8f4, 12, 0x95f2f8, 15, 0xafebfc, 18, 0xbbe9fd, 21, 0xaceefe, 24, 0x8efbfd, 25, 0xa1fdfd, 26, 0xbbfefe, 27, 0xcbfefe, 30, 0xe8fefe, 32, 0xfaffff, 33, 0x8dfef8, 34, 0x000000, 95, 0x000000, 96, 0xfdffff, 99, 0xf4fefe, 102, 0xe8fefd, 105, 0xdafdfc, 111, 0xbffcfa, 114, 0xa5fbf8, 117, 0x80fbf4, 120, 0x7ff6f5, 123, 0xa0effa, 126, 0xa8edfa, 129, 0xb3eafc, 132, 0xb9e9fd, 135, 0xb8eafe, 138, 0xafedfd, 141, 0xa8f1fd, 144, 0x91f8fd, 147, 0x94fdfd, 150, 0xc0fdfe, 153, 0xd2fefe, 156, 0xe0fefe, 162, 0xfaffff, 164, 0xffffff, 165, 0x000000, 192, 0x000000, 193, 0xfcfffe, 195, 0xf4fefe, 201, 0xcefdfb, 204, 0xbcfcf9, 207, 0x87fbf5, 210, 0x82f6f6, 213, 0xa7eefa, 216, 0xb2eafc, 219, 0xbbe9fd, 222, 0xb3ecfe, 225, 0xa5f2fd, 228, 0x8afcfd, 231, 0xbdfefe, 234, 0xd7fefe, 237, 0xebfeff, 240, 0xfbffff, 241, 0x000000, 255, 0x000000],
    0], s: [0, 12, 0xffffff, 2, 10, 0xffffff] },
  14: { w: 3, h: 256, c: [
    [0, 0x000000, 2, 0x000000, 3, 0x80fdf7, 33, 0xf5fffe, 45, 0xffffff, 51, 0xe6ffff, 68, 0x72fdfe, 69, 0x000000, 112, 0x000000, 113, 0xffffff, 126, 0xdafefd, 147, 0x89fdf8, 148, 0x000000, 211, 0x000000, 212, 0xf6ffff, 219, 0xf2ffff, 228, 0x8afdfe, 255, 0xd4ffff],
    [0, 0x81fdf7, 2, 0x88fdf8, 3, 0x000000, 255, 0x000000],
    [0, 0x000000, 255, 0x000000]], s: [0, 6, 0xffffff, 1, 8, 0xffffff, 2, 8, 0xffffff] },
  15: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfef900, 6, 0xfee600, 21, 0xfe9d00, 30, 0xff4700, 33, 0xff4000, 39, 0xfd5a00, 48, 0xfba001, 63, 0xf8f701, 66, 0xf7ff01, 67, 0x000000, 109, 0x000000, 110, 0xfefa00, 120, 0xfea800, 126, 0xff4300, 129, 0xfe4b00, 141, 0xf8e201, 145, 0xf7ff01, 146, 0x000000, 208, 0x000000, 209, 0xfefe00, 225, 0xff9400, 228, 0xff6000, 231, 0xff4300, 234, 0xff4300, 243, 0xfb9f01, 255, 0xf7ff01],
    0], s: [0, 10, 0xffff02, 1, 6, 0xffff02, 2, 8, 0xff8800] },
  16: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfefb00, 3, 0xfeeb00, 12, 0xff9300, 15, 0xff4e00, 18, 0xff4100, 30, 0xf8df01, 34, 0xf7ff01, 35, 0x000000, 95, 0x000000, 96, 0xfefc00, 105, 0xfeda00, 117, 0xffa200, 120, 0xff8c00, 126, 0xff5100, 129, 0xff4000, 135, 0xfe4e00, 144, 0xfc9200, 162, 0xf7f801, 165, 0xf7fe01, 166, 0x000000, 192, 0x000000, 193, 0xfefc00, 207, 0xffa500, 213, 0xff5500, 216, 0xff3f00, 219, 0xfe4c00, 228, 0xfaa700, 237, 0xf8f001, 240, 0xf7ff01, 241, 0x000000, 255, 0x000000],
    0], s: [0, 13, 0xffff02, 2, 11, 0xff8400] },
  17: { w: 3, h: 256, c: [
    [0, 0xfffdfd, 18, 0xfff0ea, 84, 0xff9d7a, 108, 0xff5b22, 123, 0xff4100, 138, 0xff4605, 156, 0xff622b, 183, 0xff9874, 237, 0xffebe5, 255, 0xfffefe],
    0,
    0] },
  18: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xffdd00, 15, 0xff0300, 18, 0xf0000b, 29, 0x52007e, 30, 0x000000, 63, 0x000000, 64, 0xf50007, 65, 0xff0400, 72, 0xffe700, 74, 0xffff00, 75, 0x000000, 92, 0x000000, 93, 0x0500b5, 123, 0xda001b, 129, 0xfe0000, 132, 0xff0600, 141, 0xff4100, 142, 0x000000, 216, 0x000000, 217, 0xff0000, 237, 0xffe600, 241, 0xffff00, 242, 0x000000, 255, 0x000000],
    0] },
  19: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0x0c00b0, 27, 0xde0018, 33, 0xff0000, 36, 0xff0c00, 49, 0xff7200, 50, 0x000000, 86, 0x000000, 87, 0xffff00, 90, 0xffed00, 104, 0xff1e00, 105, 0x000000, 145, 0x000000, 146, 0xfff900, 162, 0xff1d00, 165, 0xff0000, 171, 0xbe002f, 172, 0x000000, 226, 0x000000, 227, 0xff1e00, 231, 0xff0000, 234, 0xeb000e, 255, 0x0800b3],
    0] },
  21: { w: 3, h: 256, c: [
    [0, 0xffffff, 24, 0xe9ffff, 66, 0xb0fdfe, 102, 0x7cfdfe, 117, 0x1afafc, 123, 0x03fafc, 129, 0x00fafc, 135, 0x1afbfc, 147, 0x70fcfd, 150, 0x7ffdfe, 207, 0xcefefe, 237, 0xf2ffff, 255, 0xffffff],
    0,
    0] },
  22: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfefb00, 3, 0xfeeb00, 12, 0xff9300, 15, 0xff4e00, 18, 0xff4100, 30, 0xf8df01, 34, 0xf7ff01, 35, 0x000000, 95, 0x000000, 96, 0xfefc00, 105, 0xfeda00, 117, 0xffa200, 120, 0xff8c00, 126, 0xff5100, 129, 0xff4000, 135, 0xfe4e00, 144, 0xfc9200, 162, 0xf7f801, 165, 0xf7fe01, 166, 0x000000, 192, 0x000000, 193, 0xfefc00, 207, 0xffa500, 213, 0xff5500, 216, 0xff3f00, 219, 0xfe4c00, 228, 0xfaa700, 237, 0xf8f001, 240, 0xf7ff01, 241, 0x000000, 255, 0x000000],
    0] },
  23: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfef900, 6, 0xfee600, 21, 0xfe9d00, 30, 0xff4700, 33, 0xff4000, 39, 0xfd5a00, 48, 0xfba001, 63, 0xf8f701, 66, 0xf7ff01, 67, 0x000000, 88, 0x000000, 89, 0xfefa00, 99, 0xfea700, 105, 0xff4300, 108, 0xfe4800, 114, 0xfc9a00, 120, 0xf8df01, 124, 0xf7ff01, 125, 0x000000, 148, 0x000000, 149, 0xfefa00, 159, 0xfea700, 165, 0xff4300, 168, 0xfe4800, 174, 0xfc9a00, 180, 0xf8df01, 184, 0xf7ff01, 185, 0x000000, 208, 0x000000, 209, 0xfef800, 213, 0xfee700, 225, 0xff9200, 228, 0xff6000, 231, 0xff4300, 234, 0xff4300, 243, 0xfb9f01, 255, 0xf7ff01],
    0] },
  24: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfdf9f0, 2, 0xf6e9c5, 3, 0xf2dfaa, 6, 0xe8c462, 9, 0xe3ab14, 12, 0xc18b00, 14, 0x906901, 15, 0xffffff, 18, 0xe5f4ff, 21, 0xb1d5ee, 30, 0x2c8bcc, 33, 0x2788cc, 34, 0x000000, 93, 0x000000, 94, 0xffffff, 96, 0xfdfaf3, 99, 0xf9f1d7, 105, 0xeed693, 117, 0xdea70f, 120, 0xd89d00, 126, 0x9d7200, 128, 0x8f6800, 129, 0xb79f5c, 130, 0xffffff, 132, 0xfaffff, 138, 0xd7ecfe, 144, 0xa9d0ec, 150, 0x82bae1, 159, 0x4498d3, 164, 0x2b8acd, 165, 0x000000, 191, 0x000000, 192, 0xfdfcf7, 195, 0xf8edce, 198, 0xf0d99c, 204, 0xe3b73c, 207, 0xdfa70d, 210, 0xcb9300, 214, 0x906801, 215, 0xaa8f41, 216, 0xfeffff, 219, 0xeef9ff, 222, 0xd0e8fc, 225, 0xafd3ed, 237, 0x3992d0, 240, 0x2889cc, 241, 0x000000, 255, 0x000000],
    0], s: [0, 12, 0xffffff, 2, 10, 0xffffff] },
  25: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xfdfaf2, 3, 0xf9efd5, 9, 0xeed58f, 21, 0xdda408, 24, 0xd29800, 30, 0x946b00, 31, 0x906900, 32, 0xb89f5c, 33, 0xffffff, 36, 0xf4fcff, 39, 0xe3f3ff, 48, 0x9fcbe9, 63, 0x3892d0, 66, 0x2b8acd, 67, 0x000000, 108, 0x000000, 109, 0x2f8dce, 111, 0x4398d2, 117, 0x93c4e5, 123, 0xe8f6ff, 126, 0xffffff, 127, 0x8f6800, 129, 0xb88500, 132, 0xdfa507, 138, 0xedd289, 141, 0xf7eccd, 144, 0xffffff, 145, 0x000000, 206, 0x000000, 207, 0x318ece, 219, 0xa1cce9, 225, 0xe1f1ff, 228, 0xf8feff, 230, 0xffffff, 231, 0x8c6700, 237, 0xda9f00, 240, 0xe0ac20, 252, 0xfaf3df, 255, 0xffffff],
    0], s: [0, 8, 0xffffff, 1, 6, 0xffffff, 2, 8, 0xffffff] },
  28: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0xf0f2ff, 3, 0xdddfff, 9, 0xaab0ff, 12, 0x9aa1ff, 15, 0xdadcff, 18, 0xffffff, 21, 0xfefeff, 24, 0xfcfcff, 25, 0x000000, 47, 0x000000, 48, 0xf1f2ff, 51, 0xd7daff, 54, 0xb7bcff, 57, 0xc5c9ff, 63, 0xf1f2ff, 65, 0xfbfbff, 66, 0x000000, 82, 0x000000, 83, 0xffffff, 95, 0xffffff, 96, 0x000000, 107, 0x000000, 108, 0xfafaff, 114, 0xc5caff, 117, 0xbcc1ff, 120, 0xc3c7ff, 123, 0xbfc3ff, 126, 0xc6caff, 129, 0xc0c4ff, 132, 0xabb2ff, 135, 0xe2e4ff, 138, 0xfbfbff, 141, 0xf5f5ff, 144, 0xf5f6ff, 145, 0xfafaff, 146, 0x000000, 172, 0x000000, 173, 0xffffff, 184, 0xffffff, 185, 0x000000, 205, 0x000000, 206, 0xffffff, 207, 0xfafbff, 210, 0xe9ebff, 216, 0xb7bdff, 219, 0xa0a6ff, 222, 0xadb2ff, 225, 0xcbceff, 228, 0xe3e5ff, 231, 0xfcfcff, 234, 0xfafbff, 236, 0xe3e5ff, 237, 0xc5c9ff, 238, 0x000000, 255, 0x000000],
    0] },
  29: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0x000000, 11, 0x000000, 12, 0xf5f6ff, 15, 0xf2f3ff, 18, 0xe7e9ff, 21, 0xadb3ff, 24, 0x8d96ff, 27, 0xb3b9ff, 30, 0xe2e4ff, 33, 0xffffff, 34, 0xffffff, 35, 0x000000, 54, 0x000000, 55, 0xffffff, 67, 0xffffff, 68, 0x000000, 96, 0x000000, 97, 0xf6f7ff, 99, 0xecedff, 105, 0xbdc2ff, 108, 0xafb4ff, 114, 0xf4f5ff, 115, 0xf0f1ff, 116, 0x000000, 128, 0x000000, 129, 0xf3f4ff, 132, 0xffffff, 135, 0xfdfdff, 138, 0xf0f1ff, 141, 0xcbcfff, 144, 0x9ca2ff, 147, 0x878fff, 150, 0x939bff, 159, 0xdee0ff, 162, 0xf1f1ff, 165, 0xffffff, 166, 0x000000, 191, 0x000000, 192, 0xf3f3ff, 195, 0xd6d9ff, 198, 0xc9cdff, 202, 0xf7f8ff, 203, 0x000000, 228, 0x000000, 229, 0x8790ff, 237, 0xe2e4ff, 241, 0xffffff, 242, 0x000000, 255, 0x000000],
    0] },
  30: { w: 3, h: 256, c: [
    [0, 0xff0900, 6, 0xff2b00, 21, 0xff8d00, 30, 0xffd000, 36, 0xfff600, 39, 0xffff00, 48, 0xd2ff00, 75, 0x23ff00, 81, 0x05ff00, 84, 0x00ff02, 90, 0x00ff2e, 111, 0x00ffe0, 114, 0x00fff4, 117, 0x00ffff, 129, 0x00e1ff, 156, 0x007fff, 171, 0x001eff, 177, 0x0002ff, 180, 0x0700ff, 183, 0x1500ff, 210, 0xd500ff, 216, 0xf900ff, 219, 0xff00fd, 225, 0xff00db, 249, 0xff002b, 255, 0xff0006],
    [0, 0xff0600, 21, 0xff8d00, 36, 0xfff900, 42, 0xf7ff00, 72, 0x36ff00, 81, 0x03ff00, 84, 0x00ff05, 87, 0x00ff16, 114, 0x00fff8, 117, 0x00ffff, 129, 0x00e1ff, 156, 0x007eff, 174, 0x000dff, 180, 0x0100ff, 210, 0xd400ff, 216, 0xf900ff, 219, 0xff00fe, 225, 0xff00db, 252, 0xff0016, 255, 0xff0008],
    0] },
  34: { w: 3, h: 256, c: [
    [0, 0x000000, 255, 0x000000],
    [0, 0x000000, 108, 0x000000, 109, 0x0b02aa, 110, 0x0600a9, 112, 0x7c78d1, 117, 0xfaf9fc, 120, 0xfaf9fe, 125, 0x7f7ada, 127, 0x0800b7, 129, 0x0c02b8, 130, 0x000000, 255, 0x000000],
    0] },
  35: { w: 3, h: 256, c: [
    [0, 0xff00ff, 12, 0xff00ff, 15, 0xe21de2, 21, 0x877888, 24, 0x609f5e, 27, 0x35ca2c, 30, 0x0ef106, 33, 0x00ff00, 39, 0x00ff1e, 45, 0x00ff58, 48, 0x00fb75, 66, 0x00f7d1, 75, 0x00f7f7, 81, 0x00f6ff, 84, 0x05f6fe, 87, 0x10f7f7, 93, 0x2df7dc, 105, 0x70fa8f, 108, 0x7ffa81, 123, 0xdcfe18, 129, 0xfaff00, 132, 0xffff00, 141, 0xffff0a, 153, 0xffff2e, 168, 0xfffe67, 174, 0xfefd7b, 177, 0xfefe8a, 186, 0xfdffda, 192, 0xfdfffb, 195, 0xfdfafc, 201, 0xfde8f2, 210, 0xfdc0c8, 219, 0xfe9495, 222, 0xfe8788, 225, 0xfe7576, 231, 0xfe3636, 237, 0xff0202, 240, 0xff0000, 255, 0xff0000],
    [0, 0xff00ff, 12, 0xff00ff, 15, 0xe21de1, 21, 0x877887, 24, 0x609f5e, 27, 0x35ca2c, 30, 0x0ef107, 33, 0x00ff00, 39, 0x00ff1e, 48, 0x00fc75, 66, 0x00f7d0, 72, 0x00f7eb, 78, 0x00f6fc, 81, 0x00f6ff, 84, 0x05f6ff, 90, 0x1df6ec, 93, 0x2df7db, 105, 0x70fa8f, 111, 0x90fb6e, 120, 0xcbfd2c, 126, 0xecfe0a, 129, 0xf9ff02, 132, 0xffff00, 141, 0xffff0a, 153, 0xffff2e, 165, 0xfffe5c, 174, 0xfefd7b, 177, 0xfeff8b, 186, 0xfdffda, 192, 0xfdfffc, 198, 0xfdf2f9, 204, 0xfddce6, 225, 0xfe7876, 228, 0xfe5555, 234, 0xff1a1a, 237, 0xff0303, 240, 0xff0000, 255, 0xff0000],
    [0, 0xff00ff, 12, 0xff00ff, 15, 0xe21de2, 21, 0x877887, 24, 0x609f5d, 27, 0x35ca2c, 30, 0x0ff106, 33, 0x00ff00, 36, 0x00ff0c, 39, 0x00ff20, 45, 0x00ff58, 48, 0x00fb75, 69, 0x00f7df, 75, 0x00f7f6, 81, 0x00f6ff, 84, 0x05f6fe, 90, 0x1df7ed, 111, 0x91fb6d, 120, 0xcbfd2c, 126, 0xecfe0a, 129, 0xf9ff01, 132, 0xffff00, 135, 0xffff01, 144, 0xffff11, 153, 0xfffe2f, 171, 0xfffe72, 174, 0xfefd79, 177, 0xfefe8b, 186, 0xfeffd9, 192, 0xfdfffc, 198, 0xfdf2fa, 204, 0xfddce5, 210, 0xfdc0c7, 225, 0xfe7776, 231, 0xfe3535, 237, 0xff0303, 240, 0xff0000, 255, 0xff0000]] },
  37: { w: 1, h: 1024, c: [
    [0, 0xff3a00, 9, 0xff4800, 75, 0xffe800, 90, 0xffff00, 105, 0xdeff20, 123, 0xa5ff59, 138, 0x78fa85, 168, 0x1bf7ec, 180, 0x01f6fc, 186, 0x00f6fa, 198, 0x00f7e0, 219, 0x00fa91, 234, 0x00fb62, 252, 0x00fe1d, 267, 0x00ff00, 276, 0x00ff02, 288, 0x00fe19, 327, 0x01fa8f, 357, 0x00f7f1, 369, 0x00f6fe, 378, 0x10f6f8, 387, 0x27f7e0, 423, 0x93fb6b, 444, 0xdcfe23, 459, 0xf9ff05, 468, 0xf6ff09, 480, 0xe3fe1c, 510, 0x8bfb74, 522, 0x6dfa92, 549, 0x1df7e2, 558, 0x0af6f5, 567, 0x00f6ff, 579, 0x03f6fc, 588, 0x0df7f2, 600, 0x22f7dd, 645, 0x86fb79, 666, 0xd4ff2a, 681, 0xffff00, 702, 0xffea00, 732, 0xffb800, 765, 0xff7e0a, 771, 0xff660b, 783, 0xff280f, 795, 0xff0012, 804, 0xff0312, 816, 0xff370e, 828, 0xff7a09, 885, 0xffe003, 912, 0xffff00, 930, 0xfffb00, 942, 0xffe100, 960, 0xffb100, 999, 0xff6400, 1023, 0xff4000]] },
  42: { w: 3, h: 256, c: [
    [0, 0x1eff00, 3, 0x23ff00, 12, 0x48ff00, 24, 0x83ff00, 48, 0xecff00, 54, 0xfdff00, 57, 0xffff09, 60, 0xffff1e, 72, 0xffff91, 78, 0xffffdb, 81, 0xfffff8, 84, 0xfffaff, 87, 0xffeeff, 105, 0xff77ff, 117, 0xff16ff, 120, 0xff05ff, 126, 0xff00ff, 129, 0xff09ff, 135, 0xff27ff, 150, 0xff85ff, 162, 0xffe7ff, 165, 0xfff8ff, 168, 0xfcffff, 174, 0xd7ffff, 189, 0x60ffff, 195, 0x20ffff, 198, 0x0bffff, 201, 0x00ffff, 204, 0x06fff3, 207, 0x25ffd6, 213, 0x76ff97, 222, 0xdfff3b, 225, 0xfcff22, 228, 0xfff416, 231, 0xffd910, 237, 0xff9611, 252, 0xff1402, 255, 0xff0500],
    [0, 0x1dff00, 6, 0x2dff00, 24, 0x83ff00, 48, 0xecff00, 54, 0xfdff00, 57, 0xffff08, 60, 0xffff1e, 72, 0xffff91, 78, 0xffffdb, 81, 0xfffff8, 84, 0xfffaff, 87, 0xffecff, 93, 0xffc8ff, 102, 0xff8aff, 105, 0xff78ff, 117, 0xff14ff, 123, 0xff00ff, 126, 0xff02ff, 132, 0xff15ff, 150, 0xff84ff, 159, 0xffcfff, 165, 0xfffaff, 168, 0xfcffff, 174, 0xd6ffff, 186, 0x7affff, 195, 0x22ffff, 198, 0x0bffff, 201, 0x00ffff, 204, 0x06fff3, 207, 0x25ffd6, 213, 0x76ff97, 222, 0xe0ff3b, 225, 0xfbff22, 228, 0xfff415, 231, 0xffd911, 237, 0xff9811, 240, 0xff7b0e, 252, 0xff1502, 255, 0xff0401],
    1] },
};

const STAR = {
  cx: 175.0, cy: 159.0, q: -0.2616, phi: 1.184651,
  knots: [0, 6, 12, 24, 60, 120, 160, 168, 174, 178, 182, 186, 190, 194, 198, 210, 400],
  t: [5.05, 6.77, 12.51, 30.61, 77.43, 155.32, 207.38, 217.74, 226.42, 233.64, 241.58, 248.69, 253.58, 253.71, 254.84, 255.03, 254.78],
};

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

function ramp(id: number, r: Ramp): Uint32Array {
  var cols: Uint32Array[] = [], c: number;
  for (c = 0; c < r.w; c++) { var spec = r.c[c]; if (typeof spec !== 'number') cols[c] = keyed(spec, r.h); }
  for (c = 0; c < r.w; c++) { var sp2 = r.c[c]; if (typeof sp2 === 'number') cols[c] = cols[sp2].slice(); }
  var s = r.s || [];
  for (var j = 0; j < s.length; j += 3) {           // our own sparkles: count rows picked from the black ones
    var col = cols[s[j]], n = s[j + 1], colour = s[j + 2], x = (id * 8 + s[j]) >>> 0, free: number[] = [];
    for (var y = 0; y < r.h; y++) if (col[y] === 0) free.push(y);
    for (var k = 0; k < n && free.length; k++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      col[free.splice((x >>> 8) % free.length, 1)[0]] = colour;
    }
  }
  var px = new Uint32Array(r.w * r.h);
  for (var yy = 0; yy < r.h; yy++) for (c = 0; c < r.w; c++) px[yy * r.w + c] = cols[c][yy]!;
  return px;
}

function starburst(): Uint32Array {
  var W = 350, H = 320, px = new Uint32Array(W * H), K = STAR.knots, T = STAR.t;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var dx = x - STAR.cx, dy = y - STAR.cy, th = Math.atan2(dy, dx);
    var rho = Math.hypot(dx, dy) * (1 + STAR.q * (2 / Math.PI) * Math.asin(Math.sin(14 * th - STAR.phi)));
    var j = K.length - 2, a = 0, b = 1;
    for (var i = 0; i < K.length - 1; i++) {
      if (K[i] <= rho && rho < K[i + 1]) { j = i; b = (rho - K[i]) / (K[i + 1] - K[i]); a = 1 - b; break; }
    }
    px[y * W + x] = Math.min(255, Math.max(0, Math.floor(T[j] * a + T[j + 1] * b + 0.5)));
  }
  return px;
}

// Star Power's background colours, our own: a walk in hue / saturation / brightness through 16 evenly spaced
// key colours. Each key is a saturation-weighted average of the original palette around that index (so a
// range keeps the look of its colourful entries), not any entry of it; hue runs the short way round.
const PAL_H = [0.1263, 0.8123, 0.5139, 0.1211, 0.0087, 0.5915, 0.3475, 0.073, 0.8203, 0.5971, 0.5167, 0.4259, 0.179, 0.0738, 0.9799, 0.91];
const PAL_S = [0.5271, 0.5298, 0.7865, 0.6735, 0.3241, 0.2969, 0.2967, 0.334, 0.5445, 0.7319, 0.9008, 0.8406, 0.831, 0.7898, 0.7102, 0.7885];
const PAL_V = [0.2994, 0.4304, 0.3577, 0.4376, 0.575, 0.7004, 0.7235, 0.8122, 0.7304, 0.7127, 0.6688, 0.6509, 0.8163, 0.8773, 0.8044, 0.701];
function palette(): Uint32Array {
  var px = new Uint32Array(255), K = PAL_H.length, mod1 = (x: number): number => ((x % 1) + 1) % 1;
  for (var i = 0; i < 255; i++) {
    var j = 0;
    while (j < K - 2 && Math.round((j + 1) * 254 / (K - 1)) <= i) j++;
    var ra = Math.round(j * 254 / (K - 1)), rb = Math.round((j + 1) * 254 / (K - 1)), t = (i - ra) / (rb - ra);
    var dh = mod1(PAL_H[j + 1] - PAL_H[j] + 0.5) - 0.5;
    var h = mod1(PAL_H[j] + dh * t), s = PAL_S[j] + (PAL_S[j + 1] - PAL_S[j]) * t, v = PAL_V[j] + (PAL_V[j + 1] - PAL_V[j]) * t;
    var k = Math.floor(h * 6), f = h * 6 - k, p = v * (1 - s), q = v * (1 - s * f), u = v * (1 - s * (1 - f));
    var rgb = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][k % 6];
    px[i] = (Math.floor(rgb[0] * 255 + 0.5) << 16 | Math.floor(rgb[1] * 255 + 0.5) << 8 | Math.floor(rgb[2] * 255 + 0.5)) >>> 0;
  }
  return px;
}

function fill(w: number, h: number, colour: number): Uint32Array { return new Uint32Array(w * h).fill(colour); }
function runs(w: number, h: number, colour: number, rs: number[]): Uint32Array {
  var px = new Uint32Array(w * h);                  // [column, first row, last row, ...] on black
  for (var j = 0; j < rs.length; j += 3) for (var y = rs[j + 1]; y <= rs[j + 2]; y++) px[y * w + rs[j]] = colour;
  return px;
}

var CACHE: MusicalImage[] | null = null;
/** the 42 images, index 1..42 (as the engine's table numbers them) */
export function musicalImages(): MusicalImage[] {
  if (CACHE) return CACHE;
  var im: MusicalImage[] = [], BLUE = 0x0000ff;
  var put = (id: number, w: number, h: number, px: Uint32Array, type = 0x24): void => { im[id] = { type, w, h, px }; };
  put(1, 350, 320, fill(350, 320, 0)); put(10, 350, 320, fill(350, 320, 0));
  put(2, 2, 1, Uint32Array.of(0xf8f800, 0), 0x16); put(3, 3, 1, Uint32Array.of(0xff6600, 0xffbb00, 0xff6600));
  put(5, 1, 1, Uint32Array.of(0xff8700)); put(11, 3, 256, fill(3, 256, BLUE)); put(31, 1, 5, fill(1, 5, BLUE));
  put(33, 3, 3, fill(3, 3, BLUE)); put(38, 1, 5, fill(1, 5, BLUE)); put(40, 1, 9, fill(1, 9, BLUE)); put(41, 1, 31, fill(1, 31, BLUE));
  put(20, 3, 256, runs(3, 256, 0x00fc08, [1, 10, 62, 1, 78, 110, 1, 149, 244]));
  put(26, 3, 256, runs(3, 256, 0xffffff, [0, 105, 105, 0, 202, 202, 1, 5, 10, 1, 28, 30, 1, 49, 49, 1, 73, 74, 1, 92, 92,
    1, 111, 111, 1, 132, 132, 1, 149, 154, 1, 184, 184, 1, 217, 221, 1, 246, 249, 2, 170, 170]));
  put(27, 3, 256, runs(3, 256, 0xffffff, [0, 85, 85, 1, 6, 9, 1, 34, 38, 1, 71, 71, 1, 101, 106, 1, 123, 123, 1, 144, 144,
    1, 163, 163, 1, 181, 182, 1, 206, 206, 1, 225, 227, 1, 245, 250, 2, 53, 53, 2, 150, 150]));
  for (var id in RAMPS) { var r = RAMPS[id]; put(+id, r.w, r.h, ramp(+id, r)); }
  put(32, 3, 256, im[8].px.slice());               // the original 32 is image 8 again
  put(36, 350, 320, starburst());
  put(39, 1, 255, palette());
  CACHE = im;
  return im;
}
