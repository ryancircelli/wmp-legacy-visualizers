// goom_draw_text (0x1000c220): the song title, the idle credits and the fps counter, in the plug-in's
// bitmap font. The font is an image inside the DLL, so it is not part of this port: a GoomFont comes only
// from a copy of wmp9_goom.dll the user has (fontFromDll), and without one no text is drawn.
import { ftol } from './fpu';

export interface GoomGlyphs {
  /** per character code: rows of 0xAARRGGBB-ordered pixels as the DLL packs them, or null */
  chars: (Uint32Array[] | null)[];
  widths: Int32Array;
  heights: Int32Array;
}
export interface GoomFont { big: GoomGlyphs; small: GoomGlyphs }

/** What the user's own wmp9_goom.dll (249,856 bytes, SHA1 f7fafa66...) holds for the text: its font image
 *  (run-length coded at file offset 0x208c8, decoded the way the DLL's 0x1000bcf0 does) and its three idle
 *  credits (0x10002740's table: 0x2f0d0, the empty main-script text, 0x2f0b0). null for any other file. */
export function goomTextFromDll(dll: Uint8Array): { font: GoomFont; messages: string[] } | null {
  const cstr = (off: number): string => { let s = ''; for (let i = off; dll[i]; i++) s += String.fromCharCode(dll[i]); return s; };
  if (dll.length !== 249856 || !cstr(0x2f0d0).startsWith('What a GOOM! version 2k4')) return null;
  // decompress: a zero byte is followed by a run length of zeros, anything else is itself
  const STRIDE = 1277, img = new Uint8Array(0x1a304);
  for (let i = 0, o = 0; i < 0xc23d;) {
    const b = dll[0x208c8 + i];
    if (b === 0) { o += dll[0x208c8 + i + 1]; i += 2; } else { img[o++] = b; i++; }
  }
  const big: GoomGlyphs = { chars: new Array<Uint32Array[] | null>(256).fill(null), widths: new Int32Array(256), heights: new Int32Array(256) };
  const small: GoomGlyphs = { chars: new Array<Uint32Array[] | null>(256).fill(null), widths: new Int32Array(256), heights: new Int32Array(256) };
  const start = new Int32Array(256);
  // glyph boundaries: pairs of opaque pixels on the image's first row
  let cur = 32, run = 0;
  for (let x = 0; x < STRIDE; x++) {
    if (img[x * 4 + 3] === 0) { run = 0; continue; }
    if (++run !== 2) continue;
    big.widths[cur] = x - start[cur];
    small.widths[cur] = (big.widths[cur] / 2) | 0;
    cur++;
    start[cur] = x;
    big.heights[cur] = 19;
    small.heights[cur] = 9;
  }
  start[cur] = 0; big.heights[cur] = 0; small.heights[cur] = 0;
  const px = (o: number): number => ((img[o * 4 + 3] << 24) | (img[o * 4] << 16) | (img[o * 4 + 1] << 8) | img[o * 4 + 2]) >>> 0;
  for (let c = 33; c < cur; c++) {
    const W = big.widths[c], H = big.heights[c], rows: Uint32Array[] = [];
    for (let y = 0; y < H; y++) {
      const r = new Uint32Array(W);
      for (let x = 0; x < W; x++) r[x] = px((y + 2) * STRIDE + x + start[c]);
      rows.push(r);
    }
    big.chars[c] = rows;
    const srows: Uint32Array[] = [];
    for (let i = 0; i < ((H / 2) | 0); i++) {
      const r = new Uint32Array((W / 2) | 0);
      for (let j = 0; j < r.length; j++) {
        const a = start[c] + (3 + 2 * i) * STRIDE + 2 * j, b = start[c] + 2 * (i + 1) * STRIDE + 2 * j;
        const sum = (k: number): number => img[a * 4 + k] + img[a * 4 + 4 + k] + img[b * 4 + k] + img[b * 4 + 4 + k];
        r[j] = (((sum(3) >> 2) << 24) | ((sum(0) >> 2) << 16) | ((sum(1) >> 2) << 8) | (sum(2) >> 2)) >>> 0;
      }
      srows.push(r);
    }
    small.chars[c] = srows;
  }
  // characters without a glyph take '*''s; the space is 9 (4) wide and empty
  for (let c = 0; c < 256; c++) {
    if (big.chars[c]) continue;
    big.chars[c] = big.chars[42]; small.chars[c] = small.chars[42];
    big.widths[c] = big.widths[42]; start[c] = start[42]; big.heights[c] = big.heights[42];
    small.widths[c] = small.widths[42]; small.heights[c] = small.heights[42];
  }
  big.widths[32] = 9; small.widths[32] = 4; big.chars[32] = null; small.chars[32] = null;
  return { font: { big, small }, messages: [cstr(0x2f0d0), '', cstr(0x2f0b0)] };
}

export function drawText(font: GoomFont | null, buf: Uint32Array, resx: number, resy: number, x: number, y: number,
  str: string, charspace: number, center: number): void {
  if (!font) return;
  const F = resx > 320 ? font.big : font.small;
  const W = F.widths, Hh = F.heights;
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 255);
  let fx = x;
  if (center) {
    let lg = -charspace;
    for (const c of bytes) lg = lg + W[c] + charspace;
    fx = fx - lg * 0.5;
  }
  for (const c of bytes) {
    const xx = ftol(fx);
    const glyph = F.chars[c];
    if (glyph) {
      let xmax = W[c] + xx;
      const ytop = y - Hh[c];
      const xmin = xx < 0 ? 0 : xx;
      if (xmin >= resx - 1) return;
      if (xmax >= resx) xmax = resx - 1;
      const ymin = ytop < 0 ? 0 : ytop;
      let ymax = y;
      if (ymin <= resy - 1) {
        if (ymax >= resy - 1) ymax = resy - 1;
        for (let yy = ymin; yy < ymax; yy++) {
          const row = glyph[yy - ytop];
          for (let xi = xmin; xi < xmax; xi++) {
            const col = row[xi - xx];
            const a0 = col & 255;
            if (a0 === 0) continue;
            const p = yy * resx + xi;
            if (a0 === 255) { buf[p] = col; continue; }
            const tr = col >>> 24, o = buf[p], k = 255 - tr;
            const b2 = ((((o >>> 16) & 255) * k + ((col >>> 16) & 255) * tr) >>> 8) & 255;
            const b1 = ((((o >>> 8) & 255) * k + ((col >>> 8) & 255) * tr) >>> 8) & 255;
            const b0 = (((o & 255) * k + (col & 255) * tr) >>> 8) & 255;
            buf[p] = ((o & 0xff000000) | (b2 << 16) | (b1 << 8) | b0) >>> 0;
          }
        }
      }
    }
    fx = fx + W[c] + charspace;
  }
}
