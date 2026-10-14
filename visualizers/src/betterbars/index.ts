// Alchemy.BetterBars — "Better Bars" (BetterBars2.dll, Rob Styles, 2004-04-04; a third-party WMP 9 plug-in, CLSID
// {72DF7C63-C477-41AE-92FD-38A717543546}, Effects key "Visualizationone"). Our own code, written from the shipped
// binary (image base 0x10000000) alone. Render 0x10001b00 picks the preset's draw: Bars 0x100013f0, Stereo Scope
// 0x10001720, Scan 0x10001970. Plain GDI on a 32bpp memory DC; no rand, no clock: only freq[0] and the two waveforms.
//
// A window taller than 300 gives up its bottom 24 rows to a credit line ("... by Rob Styles", DrawTextA in the DC's
// default System font). That font is Windows', so the port leaves those rows black; everything above them is exact.
// Two DLL faults the port leaves out: Scan's "make the bitmap" flag (obj+0x18) is never initialised, so on a heap
// where it reads 0 Scan stays black (the port is the working case); and Scan leaks a brush a frame in a window over
// 300 high, so after ~10,000 frames the process's GDI quota runs out and its picture freezes.
import { A, type Surface, type TimedLevel } from '../ns';

declare module '../ns' {
  interface AlchemyNS {
    BetterBars: typeof BetterBars;
  }
}

const PRESET_NAMES: string[] = ['Bars', 'Stereo Scope', 'Scan'];

/** 0x100012c0: a band's level, max(trunc(sqrt(sum(b*b) / n)), max(b)) over freq bytes [i*n, i*n+n). The RMS never
 *  exceeds the max, so it is the max. */
function band(f: Uint8Array, i: number, n: number): number {
  let m = 0;
  for (let k = i * n, e = k + n; k < e; k++) if (f[k] > m) m = f[k]!;
  return m;
}

/** GDI's cosmetic 1-px LineTo between integer points, the end pixel excluded: along the major axis, the minor
 *  offset k*minor/major rounded to nearest, a tie rounded away from the start only for x-major lines going up. */
function line(px: Uint32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: number): void {
  const dx = x1 - x0, dy = y1 - y0, ax = Math.abs(dx), ay = Math.abs(dy);
  const xMajor = ax > ay, maj = xMajor ? ax : ay, min = xMajor ? ay : ax;
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const up = (dy <= 0 && dx < 0) || (dy <= 0 && dx > 0 && xMajor) || (dy > 0 && dx <= 0 && !xMajor) ? 1 : 0;
  for (let k = 0; k < maj; k++) {
    const m = Math.floor((2 * min * k + maj - 1 + up) / (2 * maj));
    const x = xMajor ? x0 + sx * k : x0 + sx * m, y = xMajor ? y0 + sy * m : y0 + sy * k;
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c;
  }
}

/** A CreatePen(PS_SOLID, 8) LineTo between (x, m) and (x, m+1), either way: the pixels it lights, by row m-3..m+4
 *  (first and last column offset; measured on GDI with tools of our own). */
const PEN_L = [-2, -3, -3, -4, -4, -3, -3, -2], PEN_R = [2, 3, 3, 3, 3, 3, 3, 2];

/** StretchBlt's source span for each destination pixel along one axis, 256 -> d, in the DC's default
 *  BLACKONWHITE mode: lo[i]..hi[i] (a reduction ANDs a span; an enlargement repeats one pixel). */
function spans(d: number): [Int32Array, Int32Array] {
  const a = Math.ceil(2 ** 32 * 256 / d), end = (i: number) =>
    d === 255 ? i : d === 257 ? Math.min(i, 255) : Math.floor((i * a + Math.floor(a / 2)) / 2 ** 32);
  const lo = new Int32Array(d), hi = new Int32Array(d);
  for (let i = 0; i < d; i++) {
    hi[i] = end(i);
    lo[i] = d < 256 ? (i ? end(i - 1) + 1 : 0) : hi[i];
  }
  return [lo, hi];
}

export interface BetterBarsConfig { width?: number; height?: number; preset?: number; options?: Record<string, unknown> }

class BetterBars {
  static PRESET_NAMES = PRESET_NAMES;

  options: Record<string, unknown>;
  preset = 0;
  w = 1;
  h = 1;
  surface: Surface = { w: 1, h: 1, px: new Uint32Array(1) };
  /** Bars' cell levels, [col][row] (the DLL's two module arrays 0x1001ea28 / 0x10016a28, 64 x 128 ints) */
  cells = new Int32Array(64 * 128);
  /** Scan's 256x256 bitmap (obj+0x14, made on its first frame, never cleared), 0x00RRGGBB */
  scan = new Uint32Array(256 * 256);
  private sx: [Int32Array, Int32Array] = spans(1);
  private sy: [Int32Array, Int32Array] = spans(1);

  constructor(cfg: BetterBarsConfig = {}) {
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0 }, cfg.options);
    this.setPreset(cfg.preset ?? 0);
    this.resize(cfg.width || 640, cfg.height || 480);
  }

  seed(_n: number): this { return this; }   // no rand()

  /** SetCurrentPreset 0x10001b90: 0..2, nothing else reset */
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return true;
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.surface = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    this.sx = spans(this.w);
    this.sy = spans(this.h > 300 ? this.h - 24 : this.h);
  }

  /** the drawing height: a window over 300 high keeps its bottom 24 rows for the credit line */
  private get dh(): number { return this.h > 300 ? this.h - 24 : this.h; }

  render(L: TimedLevel): Surface {
    const S = this.surface;
    if (this.preset === 0) this.bars(S.px, L.freq[0]);
    else if (this.preset === 1) this.scope(S.px, L.wave[0], L.wave[1]);
    else this.scanFrame(S.px, L.freq[0]);
    return S;
  }

  // 0x100013f0: a grid of up to 64 x 128 cells (0x100011f0 shrinks the counts until cells of at least 1 px with
  // 1-px gaps fit), each column the max of its 1024/cols frequency bins; a lit cell is 255, an unlit one fades
  // (over 160: -48, over 32: -32, else 0). Green, yellow over 75% of the rows, red over 85%.
  private bars(px: Uint32Array, f: Uint8Array): void {
    px.fill(0);
    const W = this.w, H = this.dh;
    let cols = 64, rows = 128, cw = 0, ch = 0;
    for (;;) {
      cw = Math.trunc((W - cols) / cols); if (cw < 2) cw = 1;
      ch = Math.trunc((H - rows) / rows); if (ch < 2) ch = 1;
      const ox = (cw + 1) * cols > W, oy = (ch + 1) * rows > H;
      if (ox) cols--;
      if (oy) rows--;
      if (!ox && !oy) break;
    }
    const red = rows * 0.85, yellow = rows * 0.75, n = Math.trunc(1024 / cols);
    for (let c = 0; c < cols; c++) {
      const lit = Math.trunc((rows * band(f, c, n)) / 255), l = (cw + 1) * c;
      for (let r = 0; r < rows; r++) {
        const k = c * 128 + r;
        let v = this.cells[k];
        v = v > 160 ? v - 48 : v > 32 ? v - 32 : 0;
        if (r < lit) v = 255;
        this.cells[k] = v;
        const col = r > red ? v << 16 : r > yellow ? (v << 16) | (v << 8) : v << 8;
        const b = H - r * (ch + 1);
        for (let y = Math.max(0, b - ch); y < b; y++) px.fill(col, y * W + l, y * W + Math.min(W, l + cw));
      }
    }
  }

  // 0x10001720: each channel's 1024 waveform bytes as a green polyline, point i at x = (i+1)*w/1024 and
  // y = wave*h/512 (the right channel h/2 lower); both truncated.
  private scope(px: Uint32Array, w0: Uint8Array, w1: Uint8Array): void {
    px.fill(0);
    const W = this.w, H = this.dh, xs = W / 1024, ys = H / 512, half = Math.trunc(H / 2);
    for (const [wv, off] of [[w0, 0], [w1, half]] as const) {
      let x0 = 0, y0 = Math.trunc(wv[0] * ys + off);
      for (let i = 1; i < 1024; i++) {
        const x = Math.trunc((i + 1) * xs), y = Math.trunc(wv[i] * ys + off);
        line(px, W, this.h, x0, y0, x, y, 0x00ff00);
        x0 = x; y0 = y;
      }
    }
  }

  // 0x10001970: the 256x256 bitmap scrolls a pixel left (BitBlt onto itself from x=1: column 255 stays), then an
  // 8-px pen walks column 255 from y=255 to 256 and up to 1, one unit LineTo per band of 4 bins, green at the
  // band's level; StretchBlt to the window (BLACKONWHITE).
  private scanFrame(px: Uint32Array, f: Uint8Array): void {
    const s = this.scan;
    for (let y = 0; y < 256; y++) s.copyWithin(y * 256, y * 256 + 1, y * 256 + 256);
    let cy = 255;
    for (let i = 0; i < 256; i++) {
      const c = band(f, i, 4) << 8, y1 = 256 - i, m = Math.min(cy, y1);
      for (let r = 0; r < 8; r++) {
        const y = m - 3 + r;
        if (y >= 0 && y < 256) s.fill(c, y * 256 + 255 + PEN_L[r], y * 256 + 256 + Math.min(0, PEN_R[r]));
      }
      cy = y1;
    }
    const W = this.w, [xl, xh] = this.sx, [yl, yh] = this.sy;
    px.fill(0);
    for (let y = 0; y < yl.length; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0xffffffff;
        for (let sy = yl[y]; sy <= yh[y]; sy++) for (let sx = xl[x]; sx <= xh[x]; sx++) v &= s[sy * 256 + sx];
        px[y * W + x] = v >>> 0;
      }
    }
  }

  debug() {
    return { engine: 'BetterBars', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h };
  }
}

A.BetterBars = BetterBars;
export { BetterBars };
