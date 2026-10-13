// Picture Viz ("Picture It!", PictureViz.dll 1.0.0.5 of the Windows Media Bonus Pack for Windows XP, class
// CPictureViz, CLSID {9ADDD4A4-762E-11d5-A8AF-00105AC582C2}): the engine.
//
// The DLL is built on the same engine framework as WMP 7-8's Musical Colors (src/musical/core.ts): one
// C++ object (0xdb48 bytes past its COM header) whose ~160 virtual methods share all of their state through
// it, layer records of 0x7b ints, transform records of 0x38 ints, a canvas scaled out to the window by its
// own 8.8 DDA. So the port keeps the same shape: one flat little-endian heap (`Mem`) whose first 0xdb48 bytes
// ARE the object (address 0 = the engine's `this`, i.e. the IWMPEffects pointer minus 0x94), malloc'd
// buffers after it, every "pointer" a byte address into that heap, fields named by their byte offset in the
// object. A layer field is named by its offset in layer 0's record (L(k, 0x3b08) = layer k's copy of the
// field at 0x3b08; records are 0x1ec bytes from 0x3af8); a transform field likewise (T(k, 0xb50); records of
// 0xe0 bytes from 0xad8). VAs are the DLL's (image base 0x10000000); "vt+0xNN" is the engine vtable slot
// (table at 0x100238e0) a call goes through.
//
// Arithmetic: the x87 runs at 53-bit precision (control word 0x027F in the host), so FMUL/FDIV/FADD are JS
// double operations, `FSTP float` is Math.fround, the CRT's _ftol (0x1001b580) truncates (ftol below).
// rand() is the CRT LCG (rand.ts), seeded once with srand(time(NULL)) at the first Render (seed()).
// timeGetTime() is cfg.tick (milliseconds).
import { A } from '../ns';
import '../rand';
import { sincos87 } from '../plenoptic/x87';
import type { Picture } from './picture';

const fr = Math.fround;
/** MSVC _ftol: truncate toward zero to int64, return the low 32 bits. */
export function ftol(x: number): number {
  return x > -9.2e18 && x < 9.2e18 ? (x % 4294967296) | 0 : 0;
}
/** x86 BSWAP. */
function bswap(x: number): number {
  return ((x & 0xff) << 24 | (x & 0xff00) << 8 | (x >>> 8) & 0xff00 | x >>> 24) >>> 0;
}
function rgb555(v: number): number {
  var u = v << 6;
  return ((u & 0x1f0000) << 3 | (v & 0x1f) << 3 | u & 0xf800) >>> 0;
}

export const OBJ_SIZE = 0xdb48;
const HEAP0 = 0xdb50;

/** The flat heap: the object at 0, then malloc'd blocks. Freed blocks are reused by exact size. */
export class Mem {
  declare buf: ArrayBuffer;
  declare I: Int32Array;
  declare U: Uint32Array;
  declare F: Float32Array;
  declare B: Uint8Array;
  declare top: number;
  declare free: Map<number, number[]>;
  declare sizes: Map<number, number>;
  constructor(bytes: number) {
    this.top = HEAP0;
    this.free = new Map();
    this.sizes = new Map();
    this.views(new ArrayBuffer(bytes));
  }
  views(buf: ArrayBuffer): void {
    this.buf = buf;
    this.I = new Int32Array(buf);
    this.U = new Uint32Array(buf);
    this.F = new Float32Array(buf);
    this.B = new Uint8Array(buf);
  }
  /** malloc: zero-filled (the A/B host zero-fills HeapAlloc, so freshly allocated memory reads 0 there too). */
  malloc(n: number): number {
    n = (n + 15) & ~15;
    if (n <= 0) n = 16;
    var l = this.free.get(n), p: number;
    if (l && l.length) {
      p = l.pop()!;
      this.B.fill(0, p, p + n);
      return p;
    }
    p = this.top;
    this.top += n;
    if (this.top > this.buf.byteLength) {
      var nb = new ArrayBuffer(Math.max(this.top + (8 << 20), this.buf.byteLength * 2));
      new Uint8Array(nb).set(this.B);
      this.views(nb);
    }
    this.sizes.set(p, n);
    return p;
  }
  release(p: number): void {
    if (!p) return;
    var n = this.sizes.get(p);
    if (n === undefined) return;
    var l = this.free.get(n);
    if (l) l.push(p); else this.free.set(n, [p]);
  }
}

/** layer k's copy of the layer-0 field at byte offset `off` (records of 0x1ec bytes from 0x3af8), as an int index */
export function L(k: number, off: number): number { return (off >> 2) + k * 0x7b; }
/** transform k's copy of the field at byte offset `off` (records of 0xe0 bytes from 0xad8), as an int index */
export function T(k: number, off: number): number { return (off >> 2) + k * 0x38; }

function unported(va: number): never {
  throw new Error('Picture Viz: 0x' + va.toString(16) + ' is not ported (no shipped preset reaches it)');
}

export interface CoreConfig {
  /** timeGetTime(): milliseconds */
  tick: () => number;
  /** the DLL's DATATABLE_11 resource (its MSN Photos logo); without it no logo is drawn */
  datatable?: Uint8Array | null;
  /** the GDI+ step: picture -> its fitted size, 0x00RRGGBB top-down (gdip.ts) */
  scale: (p: Picture, dw: number, dh: number) => Uint32Array;
}

export class Core {
  declare m: Mem;
  declare cfg: CoreConfig;
  /** the DC the DLL draws into (Render's HDC), 0x00RRGGBB, persistent between frames */
  declare dc: Uint32Array;
  declare dcW: number;
  declare dcH: number;
  /** the TimedLevel's freq[0] (1024 bytes) as Render modifies it in place */
  declare freq: Uint8Array;
  /** the "folder": what FindFirstFile/FindNextFile would list, in that order */
  declare pictures: Picture[];
  /** FindFirstFile's cursor (the DLL keeps the find handle at obj+0xd490) */
  declare findPos: number;
  /** the DATATABLE resource, copied into the heap on first use */
  declare res: Uint8Array | null;
  /** "New_folder_selected": the next picture load starts the folder over and comes at once */
  declare newFolder: boolean;
  /** which of the DLL's six patterns the pictures answer (0 *.tga .. 5 *.exif): 1 (*.jpg) for album art */
  declare ext: number;

  constructor(cfg: CoreConfig) {
    this.cfg = cfg;
    this.m = new Mem(32 << 20);
    this.freq = new Uint8Array(1024);
    this.dcW = this.dcH = 0;
    this.dc = new Uint32Array(0);
    this.pictures = [];
    this.findPos = -1;
    this.newFolder = true;
    this.ext = 1;
    this.res = cfg.datatable ? cfg.datatable : null;
    this.ctor();
  }

  /** The folder's contents changed (another song): like picking a new folder in the DLL's options, the listing
   *  starts over and the next picture comes at once. */
  setPictures(p: Picture[], ext?: number): void {
    this.pictures = p.slice();
    if (ext !== undefined) this.ext = ext;
    this.newFolder = true;
  }

  /** CComObject ctor 0x10015330 -> 0x10010df0: the few fields the constructor sets (operator new's block is
   *  otherwise taken as zeros; the host zero-fills HeapAlloc). */
  ctor(): void {
    var s = this.m.I;
    s[0x74 >> 2] = 1;            // 0x100101e0 on obj+4 (the window part: unused while WMP owns the window)
    s[0x7c >> 2] = 0x280;
    s[0x80 >> 2] = 0x1e0;
    s[0x9c >> 2] = 0xff;
    s[0xabc >> 2] = 1;
    s[0xd454 >> 2] = 1;
  }

  // ---------------------------------------------------------------- IWMPEffects
  /** SetCurrentPreset 0x10011b10 (this = obj+0x94): 0..5 = the transitions 1..6, 6 = Random. */
  setPreset(n: number): boolean {
    if (n < 0 || n > 6) return false;
    var s = this.m.I;
    if (n === 6) {
      s[0xd678 >> 2] = 0;
      s[0xd674 >> 2] = 1;
    } else {
      s[0xd674 >> 2] = 0;
      s[0xd6d0 >> 2] = n + 1;
    }
    s[0xa0 >> 2] = n;
    return true;
  }

  /** IWMPEffects::Render 0x10010f80. freq0 = the TimedLevel's freq[0]; the DC is w x h. */
  render(freq0: Uint8Array, w: number, h: number): void {
    var m = this.m, s = m.I;
    if (w !== this.dcW || h !== this.dcH) {
      this.dc = new Uint32Array(w * h);             // a fresh DIB is black
      this.dcW = w; this.dcH = h;
    }
    if (s[0xd6d0 >> 2] === 0x1e) return;
    s[0xd440 >> 2] = 0;
    s[0xd4e8 >> 2] = 1;                             // the HDC
    this.registry();                                // vt+0x34 0x10001e10
    if (s[0xd424 >> 2] === 0) {
      this.init();                                  // vt+0x1ac 0x10016840
      s = m.I;
      s[0xd424 >> 2] = 1;
      s[0xd6b4 >> 2] = 0x15e;                       // canvas 350 x 320
      s[0xd6bc >> 2] = 0x140;
      s[0xd548 >> 2] = 0x15e;
      s[0xd54c >> 2] = 0x140;
      s[0xd6f4 >> 2] = 0x100;                       // scale 1.0 (8.8)
      s[0xd6f8 >> 2] = 0x100;
      m.F[0xd324 >> 2] = (s[0xd6b4 >> 2] / 2) | 0;
      A.srand(this.time());                         // srand(time(NULL)) 0x1001b97e
      s[0xd4e0 >> 2] = 10;
      this.loadTable();                             // vt+0x150 0x10016d30
      this.strides();                               // vt+0x154 0x10016de0
      this.defaultScene();                          // vt+0x15c 0x10016ef0
      this.trigTables();                            // vt+0x158 0x100172e0
      s = m.I;
      s[0xd494 >> 2] = 1;                           // GetForegroundWindow(): never read
    }
    s = m.I;
    s[0xd4e0 >> 2] = 10;
    this.loadTable();
    s = m.I;
    if (s[0xd440 >> 2] === 1) { s[0xd424 >> 2] = 0; return; }
    s[0xd724 >> 2] = 0;
    s[0xd6fc >> 2] = 0;                             // rect.left
    s[0xd700 >> 2] = 0;                             // rect.top
    if (s[0xd548 >> 2] !== w || s[0xd54c >> 2] !== h) {
      s[0xd598 >> 2] = 1;
      s[0xd680 >> 2] = 0;
      s[0xd54c >> 2] = h;
      s[0xd548 >> 2] = w;
    } else s[0xd598 >> 2] = 0;
    if (s[0xd680 >> 2] > 0xf) { s[0xd680 >> 2] = 0; s[0xd598 >> 2] = 1; } else s[0xd680 >> 2]++;
    this.freq.set(freq0.subarray(0, 1024));
    this.levels();                                  // vt+0x278 0x10011170
  }

  /** srand's argument: time(NULL) at the first Render; the A/B pins rand's state instead (seed()). */
  time(): number { return (Date.now() / 1000) | 0; }

  /** vt+0x34 0x10001e10, every frame: HKCU\Software\Microsoft\MediaPlayer\PictureViz1. The key exists here
   *  (the folder is the app's), so this is the read path with the DLL's own first-run values: change the picture
   *  every 2 s, 90% of the canvas, in folder order. */
  registry(): void {
    var s = this.m.I;
    s[0xab8 >> 2] = 0x5a;                           // How_big_should_picture_be
    s[0xab4 >> 2] = 2;                              // How_often_should_picture_be_changed
    s[0x22c >> 2] = 0;                              // Randomize_picture
  }

  // ---------------------------------------------------------------- the levels (vt+0x278 0x10011170)
  /** Render's second half: freq[0]'s first 256 bytes become the max of each group of four (in place); seven
   *  frames with bins 0x32..0x3b unchanged count as a stall and zero the spectrum; the collapsed spectrum
   *  into obj+0xa5dc and the level; Random's transition draw; then the frame. */
  levels(): void {
    var m = this.m, s = m.I, fq = this.freq, i: number;
    for (i = 0; i < 0x100; i++) {
      var c = fq[i * 4];
      if (c < fq[i * 4 + 1]) c = fq[i * 4 + 1];
      if (c < fq[i * 4 + 2]) c = fq[i * 4 + 2];
      if (c < fq[i * 4 + 3]) c = fq[i * 4 + 3];
      fq[i] = c;
    }
    s[0xd5dc >> 2]++;
    for (i = 0; i <= 9; i++) {
      if (s[(0xd5e0 >> 2) + i] !== fq[i + 0x32]) { s[(0xd5e0 >> 2) + i] = fq[i + 0x32]; s[0xd5dc >> 2] = 0; }
    }
    s[0xd498 >> 2] = 10;
    if (s[0xd5dc >> 2] >= 7) {
      s[0xd5dc >> 2] = 7;
      for (i = 0; i <= 0xfe; i++) fq[i + 1] = 0;
      s[0xd498 >> 2] = 0xff;
    }
    if (s[0xd888 >> 2] === 0 || s[0xd378 >> 2] === 0) this.spectrumIn();
    s[0xd888 >> 2] = s[0xd888 >> 2] === 0 ? s[0xd378 >> 2] : s[0xd888 >> 2] - 1;
    if (s[0xd674 >> 2] !== 0 && s[0xd678 >> 2] === 0) {
      // Random: a transition 1..6 (1..8 folded onto 1..4), drawn again up to twice if it repeats the last
      s[0xd678 >> 2] = 1;
      var t = 0;
      for (var tries = 0; tries < 3; tries++) {
        if (tries > 0 && t !== s[0xd6d0 >> 2]) break;
        t = (A.rand() & 7) + 1;
        if (t >= 7) t = (A.rand() & 3) + 1;
        s[0xda8c >> 2] = t;
      }
      s[0xd6d0 >> 2] = t;
    }
    this.frame();                                   // vt+0x174 0x10010a30
  }

  /** 0x100111de..0x1001170b: the collapsed spectrum into obj+0xa5dc[0..254], the level and its 10-frame mean. */
  spectrumIn(): void {
    var s = this.m.I, fq = this.freq, i: number;
    s[0xd340 >> 2] = 0;
    s[0xd348 >> 2] = 0xff;
    s[0xd2bc >> 2] = 0;
    s[0xa9d8 >> 2] = 0;
    var row = s[0xd340 >> 2] * 0x208;
    for (i = 0; i <= 0xfe; i++) {
      s[0xdafc >> 2] = i;
      if (s[0xd37c >> 2] === 2) {
        s[(0xa9d8 >> 2) + row - i] = fq[i + 1];
      } else if (s[0xd388 >> 2] === 0) {
        s[(0xa5dc >> 2) + row + i] = fq[i + 1];
      } else {
        var r = A.rand() & 0xff;
        s[0xd670 >> 2] = r;
        s[(0xa5dc >> 2) + row + i] = fq[r];
      }
      s[0xd2bc >> 2] += fq[i];
    }
    s[0xdafc >> 2] = 0xff;
    var lv = (s[0xd2bc >> 2] / 0x6a) | 0;
    s[0xd2bc >> 2] = lv > 0xff ? 0xff : lv;
    if (++s[0xd2c0 >> 2] > 9) s[0xd2c0 >> 2] = 0;
    s[(0xa5b4 >> 2) + s[0xd2c0 >> 2]] = s[0xd2bc >> 2];
    s[0xd2c4 >> 2] = 0;
    for (i = 0; i <= 9; i++) s[0xd2c4 >> 2] += s[(0xa5b4 >> 2) + i];
    s[0xdafc >> 2] = 10;
    s[0xd2c4 >> 2] = (s[0xd2c4 >> 2] / 10) | 0;
    var md = s[0xd388 >> 2];
    if (md === 2 || md === 3 || md === 4) this.spectrumRuns(md);
    this.spectrumProcess();                         // vt+0x1f8 0x10016190
  }

  /** 0x1001140f / 0x100114c0 / 0x100115ec: obj+0xd388 modes 2..4, the spectrum rebuilt from random runs of
   *  bins (mode 2: 1..16 bins anywhere; 3 and 4: 7..22 / 5..12 bins of the low half, three in four of them
   *  replaced by twice as many zeros). */
  spectrumRuns(md: number): void {
    var s = this.m.I, fq = this.freq, row = s[0xd340 >> 2] * 0x208, n = 0;
    s[0xdafc >> 2] = 0;
    for (;;) {
      var start = A.rand() & (md === 2 ? 0xff : 0x7f);
      s[0xd670 >> 2] = start;
      var len = md === 2 ? A.rand() & 0xf : md === 3 ? (A.rand() & 0xf) + 7 : (A.rand() & 7) + 5;
      s[0xd498 >> 2] = len;
      if (len + start >= 0xff) s[0xd670 >> 2] = len;
      var zero = md !== 2 && (A.rand() & 3) !== 0;
      s[0xd49c >> 2] = 0;
      if (zero) {
        len = len << 1;
        s[0xd498 >> 2] = len;
        if (len < 0) continue;
      } else if (len < 0) continue;
      for (var j = 0; ; j++) {
        s[0xd49c >> 2] = j;
        s[(0xa5dc >> 2) + row + n] = zero ? 0 : fq[s[0xd670 >> 2] + j];
        n++;
        s[0xdafc >> 2] = n;
        if (n >= 0xff) return;
        if (j + 1 > s[0xd498 >> 2]) { s[0xd49c >> 2] = j + 1; break; }
      }
    }
  }

  // ---------------------------------------------------------------- spectrum (vt+0x1f8 0x10016190)
  spectrumProcess(): void {
    this.specMirror();                              // vt+0x1f0 0x100161e0
    this.specResample();                            // vt+0x204 0x100163e0
    this.specCopyBack();                            // vt+0x200 0x10016340
    this.specOffset();                              // vt+0x1f4 0x100166a0
    this.specSmooth();                              // vt+0x208 0x10016560
    this.specBlend();                               // vt+0x1fc 0x10016750
  }
  /** 0x100161e0: modes 1, 3..9 mirror the 255 bins into a 512-wide buffer at 0xadfc; mode 10 a halved mirror. */
  specMirror(): void {
    var s = this.m.I, md = s[0xd37c >> 2], i: number;
    if (md === 9 || md === 8 || md === 7 || md === 6 || md === 5 || md === 4 || md === 3 || md === 1) {
      for (i = 0; i < s[0xd348 >> 2]; i++) {
        s[(0xb1f8 >> 2) + i] = s[(0xa5dc >> 2) + i];
        s[(0xadfc >> 2) + i] = s[0x2a76 - i];
      }
      s[0xd498 >> 2] = i;
      s[0xd340 >> 2] = 1;
      s[0xd348 >> 2] = 0x200;
    }
    if (s[0xd37c >> 2] === 10) {
      s[0xd348 >> 2] -= 0x1e;
      for (i = 0; i < s[0xd348 >> 2]; i++) s[(0xadfc >> 2) + i] = (s[0x2a76 - i] / 2) | 0;
      for (i = 0; i < 10; i++) s[(0xadfc >> 2) + i] = 0;
      s[0xd498 >> 2] = 10;
      s[0xd340 >> 2] = 1;
    }
  }
  /** 0x100163e0: resample to obj+0xd380/256 of the width (DDA on the carry of a 32-bit sum). */
  specResample(): void {
    var s = this.m.I, k = s[0xd380 >> 2], st = s[0xd340 >> 2], src: number, dst: number;
    if (k === 0xff) return;
    if (st === 0) { s[0xd340 >> 2] = 1; src = 0xa5dc; dst = 0xadfc; }
    else if (st === 1) { s[0xd340 >> 2] = 2; src = 0xadfc; dst = 0xb61c; }
    else if (st === 2) { s[0xd340 >> 2] = 1; src = 0xb61c; dst = 0xadfc; }
    else return;
    s[0xd2b4 >> 2] = src; s[0xd274 >> 2] = dst;
    var n: number, step: number, acc = 0, a = src >> 2, b = dst >> 2, cnt = 0, t: number;
    if (k < 0xff) {
      n = s[0xd348 >> 2];
      s[0xd348 >> 2] = 0;
      step = bswap((0x100 - k) >>> 0);
      for (;;) {
        s[0xd348 >> 2] = ++cnt;
        s[b++] = s[a++];
        for (;;) {
          if (--n === 0) return;
          t = acc + step; acc = t >>> 0;
          if (t < 4294967296) break;                // no carry: copy the next one
          a++;                                      // carry: skip a source bin
        }
      }
    }
    if (s[0xd348 >> 2] >= 0x200) return;
    if (k > 0x200) s[0xd380 >> 2] = 0x200;
    if (s[0xd380 >> 2] > 0x200) return;
    n = s[0xd348 >> 2];
    s[0xd348 >> 2] = 0;
    step = bswap((0x200 - s[0xd380 >> 2]) >>> 0);
    for (;;) {
      s[0xd348 >> 2] = ++cnt;
      if ((cnt >>> 0) >= 0x200) return;
      var v = s[a] >>> 0;
      s[b++] = v; a++;
      if (--n === 0) return;
      t = acc + step; acc = t >>> 0;
      if (t >= 4294967296) continue;                // carry: next source bin
      s[0xd348 >> 2] = ++cnt;
      if ((cnt >>> 0) > 0x1ff) return;
      s[b++] = ((v + (s[a + 1] >>> 0)) >>> 0) >>> 1;   // (src[k] + src[k+2]) / 2, as the asm reads it
    }
  }
  /** 0x10016340: the resampled buffer back into 0xa5dc (513 entries). */
  specCopyBack(): void {
    var s = this.m.I, st = s[0xd340 >> 2], i: number;
    if (st === 0) return;
    if (st === 1) {
      for (i = 0; i <= 0x200; i++) s[(0xa5dc >> 2) + i] = s[(0xadfc >> 2) + i];
      s[0xdafc >> 2] = i;
      s[0xd340 >> 2] = 0;
    }
    if (s[0xd340 >> 2] === 2) {
      for (i = 0; i <= 0x200; i++) s[(0xa5dc >> 2) + i] = s[(0xb61c >> 2) + i];
      s[0xdafc >> 2] = i;
      s[0xd340 >> 2] = 0;
    }
  }
  /** 0x100166a0: add obj+0xd370 to every non-zero bin, clamp 0..255. */
  specOffset(): void {
    var s = this.m.I, o = s[0xd370 >> 2];
    if (o === 0) return;
    for (var i = 0; i < s[0xd348 >> 2]; i++) {
      var j = (0xa5dc >> 2) + i, v = s[j];
      if (v !== 0) s[j] = v = (v + s[0xd370 >> 2]) | 0;
      if (v < 0) s[j] = v = 0;
      if (v > 0xff) s[j] = 0xff;
    }
    s[0xd498 >> 2] = i;
  }
  /** 0x10016560: running box filter of obj+0xd374 + 1 bins (clamped at the last bin), in place (it reads what
   *  it just wrote); a zero sum after bin 0 takes 0.05 of the previous bin; then clamp to 255. */
  specSmooth(): void {
    var s = this.m.I, S = 0xa5dc >> 2;
    if (s[0xd374 >> 2] === 0 || s[0xd348 >> 2] <= 0) return;
    var i = 0;
    s[0xd498 >> 2] = 0;
    do {
      var win = s[0xd374 >> 2];
      s[0xd4bc >> 2] = 0;
      s[0xd820 >> 2] = s[S + i];
      if (win >= 0) {
        var j = 0;
        do {
          var q = j + i;
          s[0xd49c >> 2] = q;
          if (q >= s[0xd348 >> 2]) s[0xd49c >> 2] = q = s[0xd348 >> 2] - 1;
          var sum = (s[0xd820 >> 2] + s[S + q]) | 0, r: number;
          s[0xd820 >> 2] = sum;
          if (i !== 0 && sum === 0) {
            r = ftol(s[S + i - 1] * fr(0.05000000074505806));
            s[0xd820 >> 2] = r;
          } else r = (sum / (win + 1)) | 0;
          s[S + i] = r;
          s[0xd4bc >> 2] = ++j;
          win = s[0xd374 >> 2];
        } while (j <= win);
      }
      if (s[S + i] > 0xff) s[S + i] = 0xff;
      s[0xd498 >> 2] = ++i;
    } while (i < s[0xd348 >> 2]);
  }
  /** 0x10016750: blend with the previous frame's spectrum (obj+0xbe3c) by obj+0xd384 percent. */
  specBlend(): void {
    var s = this.m.I, F = this.m.F;
    if (s[0xd384 >> 2] === 0) return;
    if (s[0xd384 >> 2] > 100) s[0xd384 >> 2] = 100;
    if (s[0xd384 >> 2] < 0) s[0xd384 >> 2] = 0;
    var k = s[0xd384 >> 2], c = fr(0.009999999776482582);
    s[0xd498 >> 2] = 0;
    F[0xd460 >> 2] = k * c;
    F[0xd45c >> 2] = (100 - k) * c;
    if (s[0xd348 >> 2] < 0) return;
    var i = 0;
    do {
      var j = (0xa5dc >> 2) + i;
      s[j] = ftol(s[(0xbe3c >> 2) + i] * F[0xd460 >> 2] + s[j] * F[0xd45c >> 2]);
      s[(0xbe3c >> 2) + i] = s[(0xa5dc >> 2) + s[0xd340 >> 2] * 0x208 + i];
      s[0xd498 >> 2] = ++i;
    } while (i <= s[0xd348 >> 2]);
  }

  // ---------------------------------------------------------------- one frame (vt+0x174 0x10010a30)
  frame(): void {
    var s = this.m.I;
    if (s[0x3b08 >> 2] < 2 && s[0x3c9c >> 2] !== -1) s[0x3b08 >> 2] = 2;
    if (s[0x3ee0 >> 2] < 2 && s[0x4074 >> 2] !== -1) s[0x3ee0 >> 2] = 3;
    this.animateLayers();                           // vt+0x4c 0x10015a70 -> vt+0x60 0x10015a80
    this.presetSelect();                            // vt+0x90 0x10017370
    s = this.m.I;
    if (s[0x214 >> 2] === 0) {
      s[0xd430 >> 2] = 1;
      this.compose();                               // vt+0x8c 0x100020f0
    } else s[0x214 >> 2]--;
  }

  /** 0x10015a80: animate every used layer (vt+0xdc 0x10015ad0). */
  animateLayers(): void {
    var s = this.m.I, k = 0;
    do {
      s[0xd35c >> 2] = k;
      if (s[L(k, 0x3af8)] !== -1) { this.animateLayer(); s = this.m.I; }
      k++;
    } while ((k >>> 0) < (s[0xd504 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }

  /** 0x10015ad0: per-frame motion of the current layer: two spin angles (wrap past 359), the fade (0..255), an
   *  integer spin, the zoom (while smaller than the image's diagonal) with its spin, a drift, a phase. Each
   *  change marks the layer dirty (0x3af8 = 2, its old rect saved by vt+0x24c, 0x3b08 = 3). */
  animateLayer(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2];
    if (F[T(k, 0xb50)] !== 0) {
      F[T(k, 0xb4c)] = F[T(k, 0xb50)] + F[T(k, 0xb4c)];
      if (F[T(k, 0xb4c)] > 359) F[T(k, 0xb4c)] = F[T(k, 0xb4c)] - 359;
      s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
    }
    if (F[T(k, 0xb58)] !== 0) {
      F[T(k, 0xb54)] = F[T(k, 0xb58)] + F[T(k, 0xb54)];
      if (F[T(k, 0xb54)] > 359) F[T(k, 0xb54)] = F[T(k, 0xb54)] - 359;
      s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
    }
    if (F[T(k, 0xb94)] !== 0) {
      F[T(k, 0xb90)] = F[T(k, 0xb94)] + F[T(k, 0xb90)];
      if (F[T(k, 0xb90)] > 255) F[T(k, 0xb90)] = 255;
      if (F[T(k, 0xb90)] < 0) F[T(k, 0xb90)] = 0;
      s[L(k, 0x3af8)] = 2; this.saveRect();
    }
    if (s[L(k, 0x3c2c)] !== 0) {
      s[L(k, 0x3c08)] = (s[L(k, 0x3c08)] + s[L(k, 0x3c2c)]) | 0;
      if (s[L(k, 0x3c08)] > 0x167) s[L(k, 0x3c08)] -= 0x167;
      s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
    }
    if (s[L(k, 0x3c44)] === 1) {
      var w = s[L(k, 0x3b80)], h = s[L(k, 0x3b84)], z = F[T(k, 0xaf4)];
      if (F[T(k, 0xaf8)] !== 0 && ((Math.imul(w, w) + Math.imul(h, h)) | 0) > z * z) {
        F[T(k, 0xaf4)] = F[T(k, 0xaf8)] + F[T(k, 0xaf4)];
        this.saveRect(); s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
      }
      if (s[L(k, 0x3c40)] !== 0) {
        s[L(k, 0x3c3c)] = (s[L(k, 0x3c3c)] + s[L(k, 0x3c40)]) | 0;
        if (s[L(k, 0x3c3c)] < 0) s[L(k, 0x3c3c)] += 0x167;
        if (s[L(k, 0x3c3c)] > 0x167) s[L(k, 0x3c3c)] -= 0x167;
        this.saveRect(); s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
      }
    }
    if (F[T(k, 0xb80)] !== 0 || F[T(k, 0xb84)] !== 0) {
      F[T(k, 0xb78)] = F[T(k, 0xb80)] + F[T(k, 0xb78)];
      F[T(k, 0xb7c)] = F[T(k, 0xb84)] + F[T(k, 0xb7c)];
      this.saveRect(); s[L(k, 0x3af8)] = 2; this.saveRect(); s[L(k, 0x3b08)] = 3;
    }
    if (F[T(k, 0xbb4)] !== 0) {
      if (!(F[T(k, 0xbb0)] < 1)) F[T(k, 0xbb0)] = F[T(k, 0xbb0)] - ftol(F[T(k, 0xbb0)]);
      F[T(k, 0xbb0)] = F[T(k, 0xbb4)] + F[T(k, 0xbb0)];
    }
  }

  /** vt+0x24c 0x10002af0: before a drawn layer (0x3b08 = 1) first moves, keep the rect it covered. */
  saveRect(): void {
    var s = this.m.I, k = s[0xd35c >> 2];
    if (s[L(k, 0x3b08)] !== 1 || s[L(k, 0x3b30)] === 2) return;
    s[0xd870 >> 2] = s[L(k, 0x3b0c)];
    s[0xd878 >> 2] = s[L(k, 0x3b10)];
    if (s[0xd870 >> 2] > s[0xd6b4 >> 2]) s[0xd870 >> 2] = 0;
    if (s[0xd878 >> 2] > s[0xd6bc >> 2]) s[0xd878 >> 2] = 0;
    s[L(k, 0x3b34)] = s[0xd870 >> 2];
    s[L(k, 0x3b38)] = s[0xd878 >> 2];
    s[L(k, 0x3cac)] = s[L(k, 0x3b24)];
    s[L(k, 0x3b48)] = s[L(k, 0x3b28)];
    s[L(k, 0x3b4c)] = s[L(k, 0x3b2c)];
    s[L(k, 0x3b44)] = s[L(k, 0x3b1c)];
    s[L(k, 0x3b40)] = s[L(k, 0x3b18)];
    s[L(k, 0x3b30)] = 2;
  }

  // ---------------------------------------------------------------- the picture cycle
  /** vt+0x90 0x10017370: a new transition (SetCurrentPreset) restarts the cycle; else step it while layer 0
   *  has an image. */
  presetSelect(): void {
    var s = this.m.I;
    if (s[0xd4cc >> 2] !== s[0xd6d0 >> 2]) {
      s[0xd4cc >> 2] = s[0xd6d0 >> 2];
      if (s[0xd674 >> 2] === 0) s[0xd434 >> 2] = 0;
      this.presetStep();
      return;
    }
    s[0xd35c >> 2] = 0;
    if (s[0x3b20 >> 2] !== 0) this.presetStep();
  }

  /** vt+0x178 0x10017440: the transition's first call sets the scene up (layers 1.., the canvas, the spectrum
   *  shaping, the timers); later calls time the picture: once it has shown longer than the setting
   *  (obj+0xab4 s, whole seconds of timeGetTime), the next picture loads (vt+0x13c) and the transition runs
   *  (vt+0x17c). obj+0xdae8 = transition - 1 (0 = Pop: no animation). */
  presetStep(): void {
    var m = this.m, s = m.I, F = m.F;
    if (s[0xd434 >> 2] === 0) {
      s[0xd304 >> 2] = 0;
      this.defaultScene();                          // vt+0x15c
      s = m.I;
      s[0xd70c >> 2] = 1;
      s[0x4074 >> 2] = 0;
      s[0xd43c >> 2] = 1;
    }
    var t = s[0xd6d0 >> 2];
    if (t < 1 || t > 6) return;
    if (s[0xd434 >> 2] === 0) {
      s[0xd434 >> 2] = 1;
      this.canvasFixed();                           // vt+0x1c8 0x1000f9e0
      s = m.I; F = m.F;
      store(s, FIRST_CALL);
      s[0x3af8 >> 2] = t === 2 ? 0 : -1;
      var r = A.rand() & 0x7f;
      F[0xc5c >> 2] = r;
      F[0xc64 >> 2] = 6;
      s[0x4324 >> 2] = 0;
      s[0x4328 >> 2] = 0;
      s[0x4344 >> 2] = -50;
      if (t === 4) {
        s[0x4488 >> 2] = 1;
        s[0x438c >> 2] = 6;
        s[0x4388 >> 2] = 0xd7;
        s[0x4320 >> 2] = -2;
      }
      store(s, FIRST_CALL_END);
      return;
    }
    s[0xdae8 >> 2] = t - 1;
    if ((t !== 1 && s[0xdaec >> 2] === 2) || s[0x228 >> 2] === 1) s[0x21c >> 2] = this.cfg.tick() | 0;
    s[0x220 >> 2] = Math.floor((((this.cfg.tick() | 0) - s[0x21c >> 2]) >>> 0) / 1000);
    this.checkCanvas();                             // vt+0x74 0x10019870
    s = m.I;
    if (s[0xd440 >> 2] === 1) return;
    if (s[0x230 >> 2] === 0 || s[0xdaec >> 2] === 3) { this.logoLayer(); s = m.I; }   // vt+0x70 0x100194e0
    if (s[0x220 >> 2] > s[0xab4 >> 2] || s[0x228 >> 2] === 1) {
      if (s[0xdaec >> 2] === 0 || s[0xdaec >> 2] === 3) {
        s[0xd35c >> 2] = 4;
        if (this.nextPicture() === E_FAIL) return;  // vt+0x13c 0x10018160
        s = m.I;
        if (t === 1) s[0xd678 >> 2] = 0;
        s[0x228 >> 2] = 0;
        s[0x21c >> 2] = this.cfg.tick() | 0;
        s[0x218 >> 2] = this.cfg.tick() | 0;
        if (t !== 1) {
          s[0x224 >> 2] = s[0x230 >> 2] === 0 ? 0 : 1;
          s[0x42b8 >> 2] = 3;
        }
      }
    }
    s[0xd35c >> 2] = 4;
    this.transitionStep();                          // vt+0x17c 0x10019a10
  }

  /** vt+0x1c8 0x1000f9e0: a 352 x 320 canvas (until checkCanvas makes it the window's size). */
  canvasFixed(): void {
    var m = this.m, s = m.I;
    if (s[0xd6b4 >> 2] !== 0x160 || s[0xd6bc >> 2] !== 0x140) {
      m.release(s[0xd524 >> 2]);
      s[0xd6b4 >> 2] = 0x160;
      s[0xd6bc >> 2] = 0x140;
      var p = m.malloc(0x6e000);
      m.I[0xd524 >> 2] = p;
    }
  }

  /** vt+0x1d0 0x1000fae0: the canvas becomes the window (obj+0xd548 x obj+0xd54c). */
  canvasWindow(): void {
    var m = this.m, s = m.I;
    if (s[0xd6b4 >> 2] !== s[0xd548 >> 2] || s[0xd6bc >> 2] !== s[0xd54c >> 2]) {
      m.release(s[0xd524 >> 2]);
      s[0xd6b4 >> 2] = s[0xd548 >> 2];
      s[0xd6bc >> 2] = s[0xd54c >> 2];
      var p = m.malloc(Math.imul(s[0xd548 >> 2], s[0xd54c >> 2]) * 4);
      m.I[0xd524 >> 2] = p;
    }
  }

  /** vt+0x74 0x10019870: a window of another size (or the transition's first frame) resizes the canvas and
   *  restarts the picture (obj+0xdaec = 3: load now). */
  checkCanvas(): void {
    var s = this.m.I;
    if (s[0xd6bc >> 2] !== s[0xd54c >> 2] || s[0xd6b4 >> 2] !== s[0xd548 >> 2] || s[0xd434 >> 2] === 1) {
      s[0xd434 >> 2] = 2;
      this.canvasWindow();
      s = this.m.I;
      s[0xdaec >> 2] = 3;
      s[0x228 >> 2] = 1;
      s[0x230 >> 2] = 0;
    }
  }

  /** vt+0x17c 0x10019a10: a new picture resets its layer (vt+0x184), then the transition's own step and the
   *  end-of-transition timing (vt+0x180). */
  transitionStep(): void {
    var s = this.m.I;
    if (s[0xdaec >> 2] === 3 || s[0x230 >> 2] === 0) {
      s[0x230 >> 2] = 1;
      this.resetLayer();                            // vt+0x184 0x10019bf0
      s = this.m.I;
    }
    switch (s[0xdae8 >> 2]) {
      case 1: this.transparency(); break;           // vt+0x188 0x10019de0
      case 2: this.zoom(); break;                   // vt+0x198 0x1001a020
      case 3: this.squirt(); break;                 // vt+0x190 0x1001a430
      case 4: this.twirl(); break;                  // vt+0x194 0x1001aa30
      case 5: this.dissolve(); break;               // vt+0x18c 0x1001ae80
      default: return;
    }
    this.transitionEnd();                           // vt+0x180 0x10019ae0
  }

  /** vt+0x180 0x10019ae0: a transition in state 1 (running) ends 3 s after it began, state 2 likewise; both
   *  reset the layer. obj+0x23c = the end is due. */
  transitionEnd(): void {
    var s = this.m.I;
    if (s[0x220 >> 2] === s[0xab4 >> 2]) s[0x218 >> 2] = this.cfg.tick() | 0;
    var st = s[0xdaec >> 2];
    // states other than 1 and 2 compare the DLL's object pointer (always far above 3000) instead
    var d = st === 1 || st === 2 ? (((this.cfg.tick() | 0) - s[0x218 >> 2]) >>> 0) : 0xffffffff;
    if (d > 3000 && st === 1) {
      s[0xdaec >> 2] = 0;
      s[0x23c >> 2] = 1;
      this.resetLayer();
      s = this.m.I;
      s[L(s[0xd35c >> 2], 0x3c9c)] = -1;
      return;
    }
    if (d < 3000 && st === 1) s[0x23c >> 2] = 0;
    if (s[0x23c >> 2] === 1 || (d > 3000 && st === 2)) {
      s[0x23c >> 2] = 0;
      s[0xd678 >> 2] = 0;
      s[0xdaec >> 2] = 0;
      this.resetLayer();
      s = this.m.I;
      s[L(s[0xd35c >> 2], 0x3c9c)] = 0;
    }
  }

  /** vt+0x184 0x10019bf0: the current layer's motion, fade and effect fields back to 0. */
  resetLayer(): void {
    var s = this.m.I, k = s[0xd35c >> 2];
    s[0xdaec >> 2] = 0;
    s[L(k, 0x3c0c)] = 0; s[L(k, 0x3c10)] = 0;
    s[T(k, 0xb50)] = 0; s[T(k, 0xb4c)] = 0; s[T(k, 0xb58)] = 0; s[T(k, 0xb54)] = 0; s[T(k, 0xb90)] = 0;
    s[L(k, 0x3bdc)] = 0; s[L(k, 0x3c18)] = 0; s[L(k, 0x3c1c)] = 0;
    s[T(k, 0xb5c)] = 0; s[T(k, 0xb68)] = 0; s[T(k, 0xb74)] = 0;
    s[L(k, 0x3be4)] = 0;
    s[T(k, 0xba4)] = 0; s[T(k, 0xb98)] = 0;
    s[L(k, 0x3c1c)] = 0;
    s[T(k, 0xb40)] = 0;
    s[L(k, 0x3bec)] = 0; s[L(k, 0x3bf0)] = 0;
  }

  // ---------------------------------------------------------------- compose (vt+0x8c 0x100020f0)
  /** Clear the canvas, place and clip the layers, draw them back to front, blit. (obj+0xd6c0 is 3 from
   *  init on, so only the direct path runs: the canvas is drawn straight and handed to the blit.) */
  compose(): void {
    var m = this.m, s = m.I;
    s[0xd6b8 >> 2] = s[0xd6b4 >> 2] * 4;
    s[0xd32c >> 2] = (s[0xd510 >> 2] / 2) | 0;
    s[0xd334 >> 2] = (s[0xd514 >> 2] / 2) | 0;
    if (s[0xd524 >> 2] === 0) {
      var p = m.malloc(Math.imul(Math.imul(s[0xd6bc >> 2], s[0xd6b4 >> 2]), 4));
      s = m.I;
      s[0xd524 >> 2] = p;
    }
    var d = s[0xd524 >> 2] >> 2, n = Math.imul(s[0xd6bc >> 2], s[0xd6b4 >> 2]);
    m.I.fill(s[0xd304 >> 2], d, d + n);
    this.placeLayers();                             // vt+0x250 0x10004f20
    this.clipLayers();                              // vt+0x68 0x100028f0
    s = m.I;
    if (s[0xd6c0 >> 2] === 0) unported(0x100021e9);
    s[0xd24c >> 2] = s[0xd524 >> 2];
    s[0xdb24 >> 2] = 0;
    s[0xdb38 >> 2] = 0;
    s[0xd2f0 >> 2] = s[0xd6b4 >> 2];
    s[0xd2ec >> 2] = s[0xd6bc >> 2];
    this.drawLayers();                              // vt+0x140 0x10003160
    s = m.I;
    if (s[0xd430 >> 2] !== 0) this.blit();          // vt+0xe4 0x10002380
    m.I[0xd4b8 >> 2] = 0;
  }

  /** vt+0x250 0x10004f20: bind and project every used layer that is due (0x3b08 >= 2, or 0). */
  placeLayers(): void {
    var s = this.m.I, k = 0;
    do {
      s[0xd35c >> 2] = k;
      if (s[L(k, 0x3af8)] !== -1) {
        var due = true;
        if (s[0xd6c0 >> 2] !== 0) {
          var v = s[L(k, 0x3b08)];
          if (v < 2) { if (v !== 0) { s[L(k, 0x3b08)] = 2; } }
        }
        if (s[0xd6c0 >> 2] === 0 || s[L(k, 0x3b08)] !== 0) due = s[L(k, 0x3b08)] >= 2;
        if (due && !(s[L(k, 0x3afc)] !== -1 && this.bindImage() === 0)) { this.project(); }
        s = this.m.I;
      }
      k = s[0xd35c >> 2] + 1;
    } while ((k >>> 0) < (s[0xd504 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }

  /** vt+0x19c 0x10004fe0: the layer's screen position, size scale (8.8 at obj+0xd8e4 / L 0x3b24) and
   *  height from its 3-D place (Musical Colors' project). */
  project(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0xd35c >> 2];
    var hh = s[L(k, 0x3bf8)] === 2 ? (s[L(k, 0x3b94)] + s[L(k, 0x3b84)]) | 0 : s[L(k, 0x3b84)];
    s[0xd950 >> 2] = hh;
    s[0xd2f8 >> 2] = (s[L(k, 0x3b78)] + hh) | 0;
    this.projectPos();                              // vt+0x1a0 0x10005400
    var dz = s[0xd880 >> 2], foc = s[0xd470 >> 2];
    var t1 = (foc + dz) | 0, t2 = (s[0xdb18 >> 2] + foc) | 0, t3 = (s[0xdb18 >> 2] + foc + dz) | 0;
    F[0xd474 >> 2] = t1;
    F[0xd47c >> 2] = t2;
    F[0xd478 >> 2] = t3;
    if (!(t2 > 1)) F[0xd47c >> 2] = 1;
    if (!(t1 > 1)) F[0xd474 >> 2] = 1;
    if (!(fr(t3) > 1)) F[0xd478 >> 2] = 1;
    var q = (foc << 8) / F[0xd47c >> 2] * foc / F[0xd474 >> 2];
    F[0xd860 >> 2] = q;
    s[L(k, 0x3b24)] = (ftol(q) - s[L(k, 0x3b90)]) | 0;
    s[0xd8e4 >> 2] = (ftol(F[0xd860 >> 2]) - s[L(k, 0x3b90)]) | 0;
    if (s[L(k, 0x3b24)] < 0) { s[L(k, 0x3b24)] = 1; s[0xd8e4 >> 2] = 1; }
    if (s[0xd448 >> 2] === 0) this.scaleSize();     // vt+0x114 0x10005550
    s = m.I; F = m.F; k = s[0xd35c >> 2];
    foc = s[0xd470 >> 2];
    var ffoc = fr(foc);
    var v = foc * F[0xd3c4 >> 2] / F[0xd474 >> 2];
    F[0xd3c4 >> 2] = v;
    var yp = s[0xdb3c >> 2] - v;
    F[0xd830 >> 2] = yp;
    var fx = s[0xd824 >> 2];
    F[0xd828 >> 2] = fx;
    var w2 = fr((foc << 8) / F[0xd47c >> 2]);
    F[0xd784 >> 2] = w2;
    var x = fx * w2 * fr(0.003921568859368563) - s[0xdb10 >> 2], xf = fr(x);
    F[0xd874 >> 2] = xf;
    var yv = yp * w2 * fr(0.003921568859368563) - s[0xdb14 >> 2];
    F[0xd87c >> 2] = yv;
    if (s[0xd450 >> 2] === 0) {
      var q2 = (F[0xd324 >> 2] - xf) * ffoc / F[0xd474 >> 2];
      F[0xd3bc >> 2] = q2;
      F[0xd874 >> 2] = F[0xd324 >> 2] - q2;
    }
    if (s[0xd448 >> 2] === 1) {
      s[0xd870 >> 2] = ftol(F[0xd874 >> 2]);
      s[0xd878 >> 2] = ftol(yv);
      return;
    }
    var half = (s[L(k, 0x3b28)] / 2) | 0;
    F[0xd874 >> 2] = F[0xd874 >> 2] - half;
    var h2 = (s[L(k, 0x3b94)] + s[L(k, 0x3b84)]) | 0;
    F[0xd87c >> 2] = yv - (h2 * (F[0xd860 >> 2] * 0.00390625) + 1);
    s[L(k, 0x3b0c)] = ftol(F[0xd874 >> 2] + 0.5);
    s[L(k, 0x3b10)] = ftol(F[0xd87c >> 2] + 0.5);
    s[L(k, 0x3ba0)] = s[L(k, 0x3b0c)];
    s[L(k, 0x3ba4)] = s[L(k, 0x3b10)];
  }

  /** vt+0x1a0 0x10005400: rotate the layer centre (relative to the canvas centre) by angle obj+0xdb00 in the
   *  screen plane, then depth / height from angle obj+0xdb0c. */
  projectPos(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0xd35c >> 2];
    var cx0 = s[0xd32c >> 2], a = s[0xdb00 >> 2];
    var cx = (((s[L(k, 0x3b80)] / 2) | 0) + s[L(k, 0x3b74)]) | 0;
    s[0xd824 >> 2] = cx;
    var dx = (cx - cx0) | 0, dy = (s[0xd2f8 >> 2] - s[0xd334 >> 2]) | 0;
    s[0xd658 >> 2] = dx;
    s[0xd65c >> 2] = dy;
    var c = F[(0xc65c >> 2) + a], sn = F[(0xcbfc >> 2) + a];
    s[0xd3b8 >> 2] = ftol(dx * c - dy * sn);
    s[0xd3c0 >> 2] = ftol(dy * c + dx * sn);
    s[0xd824 >> 2] = (cx0 + s[0xd3b8 >> 2]) | 0;
    var y = (s[0xd334 >> 2] + s[0xd3c0 >> 2]) | 0;
    s[0xd82c >> 2] = y;
    s[L(k, 0x3b7c)] = y;
    s[0xdb3c >> 2] = s[0xd510 >> 2] < s[0xd514 >> 2] ? s[0xd514 >> 2] : s[0xd510 >> 2];
    var a2 = s[0xdb0c >> 2], z = (s[0xdb3c >> 2] - y) | 0;
    s[0xd65c >> 2] = z;
    s[0xd880 >> 2] = ftol(z * F[(0xcbfc >> 2) + a2]);
    F[0xd3c4 >> 2] = z * F[(0xc65c >> 2) + a2];
    s[L(k, 0x3b14)] = s[0xd880 >> 2];
  }

  /** vt+0x114 0x10005550: the layer's on-canvas size at scale obj+0xd8e4 (8.8). */
  scaleSize(): void {
    var s = this.m.I, k = s[0xd35c >> 2];
    s[0xd404 >> 2] = s[L(k, 0x3b80)];
    s[0xd400 >> 2] = s[L(k, 0x3b84)];
    var v = s[L(k, 0x3b94)], neg = v < 0;
    s[0xd980 >> 2] = neg ? -v | 0 : v;
    this.scaleDims();                               // vt+0x80 0x1000e470
    s[L(k, 0x3ba8)] = s[0xd404 >> 2];
    s[L(k, 0x3bac)] = s[0xd400 >> 2];
    s[L(k, 0x3b28)] = s[0xd404 >> 2];
    s[L(k, 0x3b2c)] = s[0xd400 >> 2];
    s[L(k, 0x3b98)] = neg ? -s[0xd980 >> 2] | 0 : s[0xd980 >> 2];
  }

  /** vt+0x80 0x1000e470: scale obj+0xd404 / 0xd400 by obj+0xd8e4 (0, 0xfe..0x102 = unscaled; no picture or
   *  logo layer is ever scaled any other way). */
  scaleDims(): void {
    var s = this.m.I, v = s[0xd8e4 >> 2];
    if (v === 0 || (v >= 0xfe && v <= 0x102)) return;
    unported(0x1000e4b0);
  }

  /** vt+0x84 0x1000e510: obj+0xda8c := its length at scale obj+0xd8e4 (8.8). */
  scaleLen(): void {
    var s = this.m.I, v = s[0xd8e4 >> 2];
    if (v === 0x100) return;
    if (v > 0x200 && v > 0x300) { s[0xd8e4 >> 2] = 0x300; v = 0x300; }
    s[0xda8c >> 2] = scaledCount(s[0xda8c >> 2], v, v < 0x100 ? 0 : v < 0x201 ? 1 : 2);
  }

  /** vt+0x68 0x100028f0: clip every layer to the canvas. k runs 0..obj+0xd504 INCLUSIVE (one record past the
   *  last used layer). */
  clipLayers(): void {
    var s = this.m.I, k = 0;
    do {
      s[0xd35c >> 2] = k;
      this.clipLayer();
      k = s[0xd35c >> 2] + 1;
    } while ((k >>> 0) <= (s[0xd504 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }
  /** vt+0x6c 0x10002930 */
  clipLayer(): void {
    var s = this.m.I, k = s[0xd35c >> 2];
    if (s[L(k, 0x3af8)] === -1) return;
    if (s[0xd6c0 >> 2] === 0 && s[L(k, 0x3b08)] < 2) return;
    var off = (): void => { s[L(k, 0x3b08)] = 0; s[L(k, 0x3cc8)] = 1; };
    if (s[L(k, 0x3b24)] < s[0xd5a0 >> 2]) { off(); return; }
    s[L(k, 0x3cc8)] = 0;
    s[L(k, 0x3b9c)] = 0;
    var y = s[L(k, 0x3b10)];
    if (y >= s[0xd6bc >> 2]) { off(); return; }
    var x = s[L(k, 0x3b0c)], W = s[0xd6b4 >> 2];
    if (x >= W) { off(); return; }
    if (((s[L(k, 0x3b80)] - 1 + x) | 0) < 0) { off(); return; }
    if (((s[L(k, 0x3b84)] - 1 + y) | 0) < 0) { off(); return; }
    if (x < 0) {
      var e = (x + s[L(k, 0x3b28)]) | 0;
      s[L(k, 0x3b28)] = W < e ? W : e;
      s[L(k, 0x3b9c)] = 1;
    } else if (W < ((x + s[L(k, 0x3b28)]) | 0)) {
      s[L(k, 0x3b28)] = W - x;
      s[L(k, 0x3b9c)] = 1;
    }
    y = s[L(k, 0x3b10)];
    var H = s[0xd6bc >> 2];
    if (y < 0) {
      var t = (s[L(k, 0x3b2c)] + y) | 0;
      s[L(k, 0x3b2c)] = H < t ? H : t;
    } else {
      if (((y + s[L(k, 0x3b2c)]) | 0) <= H) return;
      s[L(k, 0x3b2c)] = H - y;
    }
    s[L(k, 0x3b9c)] = 1;
  }

  /** vt+0x140 0x10003160: depth-sort, then render each listed layer back to front. */
  drawLayers(): void {
    var s = this.m.I;
    this.sortLayers();                              // vt+0x270 0x100032b0
    s = this.m.I;
    s[0xdb44 >> 2] = 0;
    var k = s[0xa4ac >> 2];
    s[0xd35c >> 2] = k;
    while (k !== -1) {
      if (s[L(k, 0x3b30)] === 2) s[L(k, 0x3b30)] = 1;
      this.renderLayer();                           // vt+0x16c 0x100037c0
      s = this.m.I;
      s[0xdb44 >> 2]++;
      k = s[(0xa4ac >> 2) + s[0xdb44 >> 2]];
      s[0xd35c >> 2] = k;
    }
  }
  /** vt+0x270 0x100032b0: the draw-order list at 0xa4ac, by depth (0x3b7c + 10000) ascending, the layers with
   *  state 0 first, then states 1 and 2; -1 terminated. */
  sortLayers(): void {
    var s = this.m.I;
    s[0xdb44 >> 2] = 0; s[0xd6c4 >> 2] = 0; s[0xd6c8 >> 2] = 0; s[0xdab4 >> 2] = 0;
    for (var pass = 0; pass < 2; pass++) {
      if (pass) { s[0xd6c4 >> 2] = 1; s[0xd6c8 >> 2] = 2; s[0xdab4 >> 2] = 0; }
      for (;;) {
        s[0xd3ac >> 2] = s[0xd2e8 >> 2];
        this.nextDepth();                           // vt+0x1d8 0x100035c0
        if (s[0xd3ac >> 2] === s[0xd2e8 >> 2]) break;
        this.collectDepth();                        // vt+0x160 0x100036c0
        s[0xdab4 >> 2]++;
      }
    }
    s[(0xa4ac >> 2) + s[0xdb44 >> 2]] = -1;
  }
  /** 0x100035c0: obj+0xdab4 += the smallest (depth - obj+0xdab4) >= 0 among the candidates */
  nextDepth(): void {
    var s = this.m.I, k = 0;
    s[0xd7d0 >> 2] = 0;
    do {
      s[0xd35c >> 2] = k;
      var st = s[L(k, 0x3af8)];
      if (s[L(k, 0x3b08)] !== 0 && st !== -1) {
        var p0 = s[0xd6c4 >> 2];
        if (st === p0 || st === s[0xd6c8 >> 2]) {
          var z = (s[L(k, 0x3b7c)] + 10000) | 0;
          s[0xd878 >> 2] = z;
          if (z < 0) s[0xd878 >> 2] = 0;
          if (p0 === 0 || p0 === 1 || p0 === 2) s[0xd7d0 >> 2] = s[0xd878 >> 2];
          var c = s[0xdab4 >> 2], d = s[0xd7d0 >> 2];
          if (c <= d && ((d - c) | 0) < s[0xd3ac >> 2]) s[0xd3ac >> 2] = (d - c) | 0;
        }
      }
      k++;
    } while ((k >>> 0) < (s[0xd504 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
    s[0xdab4 >> 2] = (s[0xdab4 >> 2] + s[0xd3ac >> 2]) | 0;
  }
  /** 0x100036c0: append the candidates at depth obj+0xdab4 */
  collectDepth(): void {
    var s = this.m.I, k = 0;
    do {
      s[0xd35c >> 2] = k;
      var st = s[L(k, 0x3af8)];
      if (s[L(k, 0x3b08)] !== 0 && st !== -1) {
        var p0 = s[0xd6c4 >> 2];
        if (st === p0 || st === s[0xd6c8 >> 2]) {
          var z = (s[L(k, 0x3b7c)] + 10000) >>> 0;
          s[0xd878 >> 2] = z;
          if (z > 0x80000000) s[0xd878 >> 2] = 0;
          if (p0 === 0 || p0 === 1 || p0 === 2) s[0xd7d0 >> 2] = s[0xd878 >> 2];
          if (s[0xdab4 >> 2] === s[0xd7d0 >> 2]) { s[(0xa4ac >> 2) + s[0xdb44 >> 2]] = k; s[0xdb44 >> 2]++; }
        }
      }
      k++;
    } while ((k >>> 0) < (s[0xd504 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }

  // ---------------------------------------------------------------- one layer (vt+0x16c 0x100037c0)
  /** Render the current layer: its effects chain (only when it is dirty 3), the clip, then the draw onto the
   *  canvas (obj+0xd24c, obj+0xd2f0 wide). */
  renderLayer(): void {
    var m = this.m, s = m.I, k = s[0xd35c >> 2];
    s[0xd404 >> 2] = s[L(k, 0x3b80)];
    s[0xd5d4 >> 2] = s[L(k, 0x3b80)];
    s[0xd400 >> 2] = s[L(k, 0x3b84)];
    s[0xd5d0 >> 2] = s[L(k, 0x3b84)];
    s[0xd270 >> 2] = s[L(k, 0x3b20)];
    s[0xd290 >> 2] = s[L(k, 0x3b20)];
    s[0xd26c >> 2] = s[L(k, 0x3bb8)];
    s[0xd248 >> 2] = s[L(k, 0x3bb4)];
    if (s[0xd404 >> 2] === 0 || s[0xd400 >> 2] === 0 || s[0xd270 >> 2] === 0) { this.layerDone(); return; }
    s[0xda0c >> 2] = s[L(k, 0x3b70)];
    var h: number;
    if (s[L(k, 0x3b9c)] === 1) {
      s[0xd870 >> 2] = s[L(k, 0x3ba0)];
      s[0xd878 >> 2] = s[L(k, 0x3ba4)];
      s[0xd404 >> 2] = s[L(k, 0x3ba8)];
      h = s[L(k, 0x3bac)];
    } else {
      s[0xd870 >> 2] = s[L(k, 0x3b0c)];
      s[0xd878 >> 2] = s[L(k, 0x3b10)];
      s[0xd404 >> 2] = s[L(k, 0x3b28)];
      h = s[L(k, 0x3b2c)];
    }
    s[0xd400 >> 2] = h;
    s[0xdb2c >> 2] = s[0xd404 >> 2];
    s[0xdb28 >> 2] = h;
    this.clipRect();                                // vt+0x54 0x10004440
    if (s[0xd4a0 >> 2] === 0) { this.layerDone(); return; }
    k = s[0xd35c >> 2];
    s[0xd8f8 >> 2] = s[L(k, 0x3b80)];
    s[0xd8ec >> 2] = s[L(k, 0x3b84)];
    var ok = true;
    if (s[L(k, 0x3cdc)] === 3) {
      s[L(k, 0x3cdc)] = 2;
      if (s[0xd26c >> 2] === 0) { this.allocEdge(); s = m.I; }     // vt+0x104 0x100049f0
      if (s[0xd26c >> 2] === 0) ok = false; else { this.edgeDistance(); s = m.I; }   // vt+0x128 0x10005e40
    } else if (s[L(k, 0x3bdc)] !== 0 && s[0xd26c >> 2] === 0) {
      this.allocEdge(); s = m.I;
      if (s[0xd26c >> 2] === 0) ok = false; else { this.edgeDistance(); s = m.I; }
    }
    if (ok) {
      k = s[0xd35c >> 2];
      if ((s[L(k, 0x3bf0)] !== 0 && s[L(k, 0x3bec)] !== 0) || (s[L(k, 0x3bdc)] !== 0 && s[L(k, 0x3bd8)] !== 0) ||
          s[L(k, 0x3c80)] !== 0 || s[L(k, 0x3c24)] > 1) { this.alphaEdge(); s = m.I; }   // vt+0x118 0x10008320
      k = s[0xd35c >> 2];
      if (s[L(k, 0x3b08)] === 3) ok = this.effects();
    }
    if (ok) {
      s = m.I; k = s[0xd35c >> 2];
      var v = s[L(k, 0x3bb0)];
      if (v === 1) { if (s[L(k, 0x3bb4)] === 0) ok = false; else s[0xd270 >> 2] = s[L(k, 0x3bb4)]; }
      else if (v === 2) { if (s[L(k, 0x3c98)] === 0) ok = false; else s[0xd270 >> 2] = s[L(k, 0x3c98)]; }
      else if (v === 3) { if (s[L(k, 0x3bb8)] === 0) ok = false; else { s[0xd270 >> 2] = s[L(k, 0x3bb8)]; s[0xda0c >> 2] = -1; } }
      if (ok && s[L(k, 0x3c9c)] !== -1 && s[L(k, 0x3c9c)] !== 1) {
        var q = s[L(k, 0x3b24)];
        s[0xd8e4 >> 2] = q;
        if (q === 0 || (q >= 0xfe && q <= 0x102)) {
          if (s[0xd3e4 >> 2] === 1) {
            s[0xd404 >> 2] = s[0xdb2c >> 2]; s[0xd400 >> 2] = s[0xdb28 >> 2];
            this.clipCopy();                        // vt+0xb0 0x10004670
            s = m.I;
            if (s[0xd440 >> 2] === 1) ok = false;
            else if (s[0xd26c >> 2] !== 0 && s[L(k, 0x3bbc)] === 1) {
              s[0xd404 >> 2] = s[0xdb2c >> 2]; s[0xd400 >> 2] = s[0xdb28 >> 2];
              s[0xd7f8 >> 2] = s[0xd270 >> 2]; s[0xd270 >> 2] = s[0xd26c >> 2];
              this.clipCopy();
              s = m.I;
              if (s[0xd440 >> 2] === 1) ok = false;
              else { s[0xd26c >> 2] = s[0xd270 >> 2]; s[0xd270 >> 2] = s[0xd7f8 >> 2]; }
            }
          }
        } else if (s[0xd3e4 >> 2] === 0) {
          unported(0x1000e630);                     // vt+0x7c: a scaled layer, unclipped
        } else {
          unported(0x1000e570);                     // vt+0xd4: a scaled layer, clipped
        }
        if (ok) this.draw();                        // vt+0x12c 0x10006380
      }
    }
    s = m.I;
    if (s[0xd338 >> 2] === 0) s[L(s[0xd35c >> 2], 0x3b08)] = 1;
    this.layerDone();
  }
  /** renderLayer's end (0x1000424d): the four scratch buffers free again. */
  layerDone(): void {
    var s = this.m.I;
    s[0xd8f4 >> 2] = 0; s[0xd794 >> 2] = 0; s[0xd7d8 >> 2] = 0; s[0xd7f0 >> 2] = 0;
  }

  /** renderLayer's effect chain for a dirty-3 layer (0x10003a2a..0x10003e0e); false = a buffer was missing. */
  effects(): boolean {
    var m = this.m, s = m.I, F = m.F, k = s[0xd35c >> 2];
    s[L(k, 0x3bb0)] = 0;
    if (F[T(k, 0xb7c)] !== 0 || F[T(k, 0xb78)] !== 0) { if (!this.swapBuffers()) return false; unported(0x1000ded0 + 0); }
    s = m.I; F = m.F; k = s[0xd35c >> 2];
    if ((((s[L(k, 0x3c70)] !== 0 && F[T(k, 0xb44)] !== 0) || F[T(k, 0xb68)] !== 0 || F[T(k, 0xb64)] !== 0 || F[T(k, 0xb60)] !== 0) &&
         F[T(k, 0xb5c)] !== 0) || s[L(k, 0x3c20)] !== 0 || s[L(k, 0x3c1c)] !== 0 || s[L(k, 0x3c18)] !== 0 ||
        F[T(k, 0xb28)] !== 0 || F[T(k, 0xb2c)] !== 0 || F[T(k, 0xb3c)] !== 0 || F[T(k, 0xb38)] !== 0 ||
        F[T(k, 0xb34)] !== 0 || F[T(k, 0xb30)] !== 0) {
      if (!this.swapBuffers()) return false;        // vt+0xec 0x10004280
      this.warp();                                  // vt+0xbc 0x10009510
    }
    s = m.I; F = m.F; k = s[0xd35c >> 2];
    if (s[L(k, 0x3c90)] !== 0) { if (!this.swapBuffers()) return false; unported(0x1000cc70); }
    s = m.I; F = m.F; k = s[0xd35c >> 2];
    var a = s[L(k, 0x3bd0)], b = s[L(k, 0x3bd4)], c = s[L(k, 0x3bcc)], f = ftol(F[T(k, 0xaf4)]);
    if (s[L(k, 0x3c44)] === 1 && (b !== 0 || a !== 0 || c !== 0) && f !== 0 && s[L(k, 0x3c48)] !== 0) {
      if (!this.swapBuffers()) return false;
      unported(0x1000a9f0);
    }
    s = m.I; k = s[0xd35c >> 2];
    if (s[L(k, 0x3bc0)] !== 0 || s[L(k, 0x3bc4)] !== 0 || s[L(k, 0x3bc8)] !== 0 || s[L(k, 0x3be8)] !== 0 || s[L(k, 0x3bf4)] !== 0) {
      if (!this.swapBuffers()) return false;
      unported(0x10007280);
    }
    if (s[L(k, 0x3bbc)] > 1) { if (!this.swapBuffers()) return false; unported(0x1000dcb0); }
    F = m.F;
    if (F[T(k, 0xb8c)] !== 0 || F[T(k, 0xb88)] !== 0) { if (!this.swapBuffers()) return false; unported(0x1000ded0); }
    s = m.I; k = s[0xd35c >> 2];
    if (s[L(k, 0x3be4)] !== 0) {
      if (!this.swapBuffers()) return false;
      this.melt();                                  // vt+0xc8 0x1000d1c0
    }
    s = m.I; k = s[0xd35c >> 2];
    if (s[L(k, 0x3cc4)] > 0 && s[L(k, 0x3cc4)] <= s[0xdad4 >> 2]) { if (!this.swapBuffers()) return false; unported(0x1000e1b0); }
    return true;
  }

  /** vt+0x54 0x10004440: clip the layer's rect (obj+0xd870, 0xd878, 0xd404 x 0xd400) to the target rect
   *  (obj+0xdb24, 0xdb38, 0xd2f0 x 0xd2ec); obj+0xd4a0 = visible, 0xd3e4 = clipped, the four cut sizes. */
  clipRect(): void {
    var s = this.m.I;
    store(s, [0xd4a0, 0, 0xd3e4, 0, 0xd5c4, 0, 0xd5c8, 0, 0xd5cc, 0, 0xd5c0, 0, 0xd3b4, 0, 0xd38c, 0, 0xd3a8, 0, 0xd39c, 0]);
    s[0xd86c >> 2] = s[0xd404 >> 2];
    s[0xd858 >> 2] = s[0xd400 >> 2];
    var u = (o: number): number => s[o >> 2] >>> 0;
    var x = u(0xd870);
    if (x >= 0x80000000) {
      s[0xd870 >> 2] = 0; s[0xd86c >> 2] = (x + s[0xd404 >> 2]) | 0; s[0xd39c >> 2] = -x | 0; s[0xd5c4 >> 2] = 1;
      if (s[0xdb24 >> 2] === 0) s[0xd3e4 >> 2] = 1;
    }
    var y = u(0xd878);
    if (y >= 0x80000000) {
      s[0xd878 >> 2] = 0; s[0xd858 >> 2] = (y + s[0xd400 >> 2]) | 0; s[0xd3b4 >> 2] = -y | 0; s[0xd5cc >> 2] = 1;
      if (s[0xdb38 >> 2] === 0) s[0xd3e4 >> 2] = 1;
    }
    var tx = u(0xdb24), ty = u(0xdb38);
    if (u(0xd870) >= ((tx + s[0xd2f0 >> 2]) >>> 0)) return;
    if (((u(0xd870) + s[0xd86c >> 2]) >>> 0) <= tx) return;
    if (u(0xd878) >= ((ty + s[0xd2ec >> 2]) >>> 0)) return;
    if (((u(0xd878) + s[0xd858 >> 2]) >>> 0) <= ty) return;
    s[0xd4a0 >> 2] = 1;
    var r = (tx + s[0xd2f0 >> 2]) >>> 0, sx = u(0xd870), e = (sx + s[0xd86c >> 2]) >>> 0;
    if (r < e) { s[0xd3a8 >> 2] = (e - r) | 0; s[0xd5c8 >> 2] = 1; s[0xd3e4 >> 2] = 1; }
    if (sx < tx) { s[0xd870 >> 2] = tx | 0; s[0xd39c >> 2] = (s[0xd39c >> 2] + (tx - sx)) | 0; s[0xd5c4 >> 2] = 1; s[0xd3e4 >> 2] = 1; }
    var bt = (ty + s[0xd2ec >> 2]) >>> 0, ey = (u(0xd878) + s[0xd858 >> 2]) >>> 0;
    if (bt < ey) { s[0xd38c >> 2] = (ey - bt) | 0; s[0xd5c0 >> 2] = 1; s[0xd3e4 >> 2] = 1; }
    var sy = u(0xd878);
    if (sy < ty) { s[0xd3b4 >> 2] = (s[0xd3b4 >> 2] + (ty - sy)) | 0; s[0xd5cc >> 2] = 1; s[0xd3e4 >> 2] = 1; }
  }

  /** vt+0xb0 0x10004670: cut the visible part of the layer image into a scratch buffer. */
  clipCopy(): void {
    var m = this.m, s = m.I;
    if (s[0xd5cc >> 2] === 1) { s[0xd878 >> 2] = s[0xdb38 >> 2]; s[0xd400 >> 2] -= s[0xd3b4 >> 2]; }
    if (s[0xd5c0 >> 2] === 1) {
      var h = (s[0xd400 >> 2] - s[0xd38c >> 2]) | 0;
      s[0xd400 >> 2] = h;
      s[0xd878 >> 2] = (s[0xdb38 >> 2] + s[0xd2ec >> 2] - h) | 0;
      s[0xd270 >> 2] = (s[0xd270 >> 2] + Math.imul(Math.imul(s[0xd404 >> 2], s[0xd38c >> 2]), 4)) | 0;
    }
    if (s[0xd5c8 >> 2] !== 1 && s[0xd5c4 >> 2] !== 1) return;
    s[0xd5bc >> 2] = s[0xd404 >> 2];
    s[0xd404 >> 2] = (s[0xd404 >> 2] - s[0xd3a8 >> 2] - s[0xd39c >> 2]) | 0;
    this.scratch();                                 // vt+0x108 0x100047d0
    s = m.I;
    if (s[0xd440 >> 2] === 1) return;
    var U = m.U;
    s[0xd3a0 >> 2] = s[0xd39c >> 2] << 2;
    var rows = s[0xd400 >> 2], skip = s[0xd3a8 >> 2] << 2, a = s[0xd270 >> 2], d = s[0xd594 >> 2] >> 2, w = s[0xd404 >> 2];
    do {
      a = (a + s[0xd3a0 >> 2]) | 0;
      var i = w;
      do { U[d++] = U[a >> 2]; a += 4; } while (--i !== 0);
      a = (a + skip) | 0;
    } while (--rows !== 0);
    s[0xd5b8 >> 2] = s[0xd270 >> 2];
    s[0xd270 >> 2] = s[0xd594 >> 2];
    this.scratchRelease();                          // vt+0x1a8 0x10004b90
  }

  /** vt+0x108 0x100047d0: the first free of four scratch buffers, grown to obj+0xd404 x 0xd400 pixels, into
   *  obj+0xd594 (none free: keep it; no memory: obj+0xd440 = 1). */
  scratch(): void {
    var m = this.m, s = m.I, need = Math.imul(Math.imul(s[0xd400 >> 2], s[0xd404 >> 2]), 4);
    var take = (ptr: number, size: number, used: number): boolean => {
      if (s[size >> 2] < need) {
        if (s[ptr >> 2] !== 0) m.release(s[ptr >> 2]);
        s[size >> 2] = need;
        var p = m.malloc(need);
        s = m.I;
        s[ptr >> 2] = p;
      }
      if (s[ptr >> 2] === 0) return false;
      s[0xd594 >> 2] = s[ptr >> 2];
      s[used >> 2] = 1;
      return true;
    };
    if (s[0xd8f4 >> 2] === 0) { if (take(0xd8f0, 0xd78c, 0xd8f4)) return; }
    else if (s[0xd794 >> 2] === 0) { if (take(0xd790, 0xd798, 0xd794)) return; }
    else if (s[0xd7d8 >> 2] !== 0) {
      if (s[0xd7f0 >> 2] !== 0 || take(0xd7ec, 0xd7f4, 0xd7f0)) return;
    } else if (take(0xd7d4, 0xd7dc, 0xd7d8)) return;
    s[0xd594 >> 2] = 0;
    s[0xd440 >> 2] = 1;
  }
  /** vt+0x1a8 0x10004b90: the buffer obj+0xd5b8 free again (when it is one of the four). */
  scratchRelease(): void {
    var s = this.m.I, p = s[0xd5b8 >> 2];
    if (p === s[0xd8f0 >> 2]) s[0xd8f4 >> 2] = 0;
    else if (p === s[0xd790 >> 2]) s[0xd794 >> 2] = 0;
    else if (p === s[0xd7d4 >> 2]) s[0xd7d8 >> 2] = 0;
    else if (p === s[0xd7ec >> 2]) s[0xd7f0 >> 2] = 0;
  }

  /** vt+0x12c 0x10006380: the layer onto the canvas, bottom row first (the images are stored bottom-up): the
   *  blended draw (vt+0x138) for a layer with any colour effect, the faded one (vt+0x134) while it fades in,
   *  else a plain or colour-keyed (obj+0xda0c) copy. */
  draw(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U;
    if (s[0xd404 >> 2] === 0 || s[0xd270 >> 2] === 0 || s[0xd400 >> 2] === 0) return;
    s[0xd408 >> 2] = s[0xd404 >> 2] << 2;
    s[0xd2f4 >> 2] = s[0xd2f0 >> 2] << 2;
    var k = s[0xd35c >> 2];
    if (s[L(k, 0x3bbc)] === 1) unported(0x100071b0);
    s[0xdb1c >> 2] = 0;
    if ((s[L(k, 0x3c4c)] !== 0 && s[L(k, 0x3c44)] === 1) || (s[L(k, 0x3c80)] !== 0 && s[L(k, 0x3be4)] !== 0) ||
        (s[L(k, 0x3bf0)] !== 0 && s[L(k, 0x3bec)] !== 0) || (s[L(k, 0x3bdc)] !== 0 && s[L(k, 0x3bd8)] !== 0) ||
        ftol(F[T(k, 0xbb0)]) !== 0 || s[L(k, 0x3cd8)] !== 0 || s[L(k, 0x3c24)] > 1) { this.blend(); return; }   // vt+0x138
    if (F[T(k, 0xb90)] !== 0) { this.fadeDraw(); return; }       // vt+0x134 0x10006de0
    var d = (Math.imul((s[0xd878 >> 2] + s[0xd400 >> 2] - s[0xdb38 >> 2] - 1) | 0, s[0xd2f0 >> 2] << 2) +
             ((s[0xd870 >> 2] - s[0xdb24 >> 2]) << 2) + s[0xd24c >> 2]) | 0;
    var a = s[0xd270 >> 2] >> 2, w = s[0xd404 >> 2] >>> 0, rows = s[0xd400 >> 2], key = s[0xda0c >> 2] >>> 0;
    var up = (s[0xd408 >> 2] + s[0xd2f4 >> 2]) >> 2, di = d >> 2, i: number;
    if (key !== 0xffffffff) {
      do {
        for (i = 0; i < w; i++) { var px = U[a++]; if (px !== key) U[di] = px; di++; }
        di -= up;
      } while (--rows !== 0);
    } else {
      do {
        for (i = 0; i < w; i++) U[di++] = U[a++];
        di -= up;
      } while (--rows !== 0);
    }
  }

  // ---------------------------------------------------------------- the pictures
  /** vt+0x13c 0x10018160: the next file of the folder (FindFirstFile/FindNextFile over *.tga, *.jpg, *.png,
   *  *.bmp, *.tif, *.exif, wrapping), loaded into layer 4 (vt+0x28). E_FAIL when the folder has none.
   *  (Randomize_picture is 0: its draws never run.) */
  nextPicture(): number {
    var s = this.m.I;
    if (this.newFolder) {                           // "New_folder_selected" = 1 in the registry: read, then 0
      this.newFolder = false;
      s[0x234 >> 2] = 0;
      s[0x104 >> 2] = 3;
      s[0x228 >> 2] = 1;
      s[0xd668 >> 2] = 0;
      s[0x21c >> 2] = this.cfg.tick() | 0;
      if (s[0xd490 >> 2] !== 0) { s[0xd490 >> 2] = 0; this.findPos = -1; }   // FindClose
    }
    if (s[0x104 >> 2] === 0) s[0x104 >> 2] = 3;     // "Use_pictures_in_this_folder" read
    if (s[0x104 >> 2] !== 3) {
      // no folder: the folder browser (blocked), then the empty current directory
      if (s[0x104 >> 2] === 4 || s[0x104 >> 2] === 0) s[0x104 >> 2] = 2;
    }
    for (;;) {
      if (s[0xd490 >> 2] === 0) {
        var any = s[0x104 >> 2] === 3 && this.pictures.length > 0 && s[0xd414 >> 2] === this.ext;
        if (!any) {
          if (++s[0xd414 >> 2] < 6) continue;
          if (s[0x210 >> 2] !== 0) { s[0x210 >> 2] = 0; s[0xd414 >> 2] = 0; continue; }
          if (s[0x104 >> 2] === 3 || s[0x104 >> 2] === 0) s[0x104 >> 2] = 4;
          s[0xd414 >> 2] = 0;
          return E_FAIL;
        }
        s[0xd490 >> 2] = 1;                         // the find handle
        this.findPos = 0;
        s[0x210 >> 2] = 1;
        break;
      }
      if (s[0xdaec >> 2] === 3) break;              // the canvas restarted: the same file again
      if (this.findPos + 1 < this.pictures.length) { this.findPos++; break; }
      s[0xd490 >> 2] = 0;                           // ERROR_NO_MORE_FILES: FindClose, the next pattern
      if (++s[0xd414 >> 2] < 6) continue;
      s[0xd414 >> 2] = 0;
    }
    if (s[0xd414 >> 2] === 0) unported(0x10018630);  // a .tga (never: the app's pictures are jpg/png)
    this.loadPicture();                             // vt+0x28 0x10018f00
    return 0;
  }

  /** vt+0x28 0x10018f00: the file through GDI+ (scaled to the fitted size with HighQualityBicubic, gdip.ts)
   *  into a fresh bottom-up image {w, h, 0, pixels} owned by the current layer. */
  loadPicture(): number {
    var m = this.m, s = m.I, pic = this.pictures[this.findPos];
    s[0x20c >> 2] = 1;                              // GdiplusStartup done
    s[0xd86c >> 2] = pic.w;
    s[0xd858 >> 2] = pic.h;
    this.fitPicture();                              // vt+0x48 0x10019740
    this.freeLayer();                               // vt+0xf4
    s = m.I;
    var w = s[0xd3d0 >> 2], h = s[0xd3d4 >> 2], n = Math.imul(w, h);
    s[0xdadc >> 2] = n;
    var p = m.malloc(n * 4 + 0xc);
    s = m.I;
    var U = m.U;
    s[0xd540 >> 2] = p;
    U[p >> 2] = w; U[(p >> 2) + 1] = h; U[(p >> 2) + 2] = 0;
    s[0xd8e8 >> 2] = p + 12;
    var px = this.cfg.scale(pic, w, h);             // top-down 0x00RRGGBB, already & 0xffffff
    var end = (p + 12) >> 2;
    end += n;                                       // the rows are written bottom-up
    for (var y = 0; y < h; y++) {
      var d = end - (y + 1) * w, a = y * w;
      for (var x = 0; x < w; x++) U[d + x] = px[a + x] & 0xffffff;
    }
    s[0xd268 >> 2] = (p + 12 + n * 4) | 0;
    s[0xd264 >> 2] = (p + 12 + w * 4) | 0;
    s[0xd298 >> 2] = 0;                             // (LockBits' scan0, past its end)
    s[0xd4bc >> 2] = h; s[0xd498 >> 2] = w;
    s[0xd86c >> 2] = w; s[0xd858 >> 2] = h;
    var k = s[0xd35c >> 2];
    s[L(k, 0x3afc)] = -1;
    s[L(k, 0x3b80)] = w;
    s[L(k, 0x3b84)] = h;
    s[L(k, 0x3b28)] = w;
    s[L(k, 0x3b2c)] = h;
    s[L(k, 0x3b20)] = s[0xd8e8 >> 2];
    s[0xd540 >> 2] = 0;
    return 0;
  }

  /** vt+0x48 0x10019740: fit the picture (obj+0xd86c x 0xd858) into How_big percent of the canvas, keeping its
   *  aspect; centre it (x at layer field 0x3b74, y, negated, at 0x3b94). */
  fitPicture(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0xd35c >> 2], cw = s[0xd6b4 >> 2];
    var big = s[0xab8 >> 2] * 0.01;                 // FILD * double 0.01, kept in ST(1)
    F[0xd610 >> 2] = big;
    F[0xd614 >> 2] = big;
    var w = ftol(cw * big);
    s[0xd3d0 >> 2] = w;
    var fh = fr(s[0xd858 >> 2]), fw = fr(s[0xd86c >> 2]);
    var h = ftol(w * fh / fw);
    s[0xd3d4 >> 2] = h;
    var hmax = ftol(s[0xd6bc >> 2] * big);
    if (h > hmax) {
      s[0xd3d4 >> 2] = hmax;
      s[0xd3d0 >> 2] = ftol(hmax * fw / fh);
    }
    s[L(k, 0x3b74)] = ((cw - s[0xd3d0 >> 2]) / 2) | 0;
    s[L(k, 0x3b94)] = -(((s[0xd6bc >> 2] - s[0xd3d4 >> 2]) / 2) | 0) | 0;
    if (s[0xd3d0 >> 2] < 0x10 || s[0xd3d4 >> 2] < 0x10) { s[0xd3d0 >> 2] = 0x10; s[0xd3d4 >> 2] = 0x10; }
  }

  /** vt+0x70 0x100194e0: layer 7, the DATATABLE's image 3 (the MSN Photos logo), fitted to the window as it
   *  would be on an 800 x 600 one and placed bottom right. */
  logoLayer(): void {
    var m = this.m, s = m.I;
    s[0xd35c >> 2] = 7;
    this.freeLayer();
    this.bindImage();
    s = m.I;
    var w = s[L(7, 0x3b80)], h = s[L(7, 0x3b84)];
    s[0xd86c >> 2] = w;
    s[0xd858 >> 2] = h;
    if (w === 0 || h === 0) return;
    var cw = s[0xd6b4 >> 2], ch = s[0xd6bc >> 2];
    if (ch * fr(0.0016666667070239782) < cw * fr(0.0012499999720603228)) {
      s[0xd3d4 >> 2] = (Math.imul(ch, h) / 600) | 0;
      s[0xd3d0 >> 2] = ftol(s[0xd3d4 >> 2] * w / h);
    } else {
      s[0xd3d0 >> 2] = (Math.imul(cw, w) / 800) | 0;
      s[0xd3d4 >> 2] = ftol(s[0xd3d0 >> 2] * h / w);
    }
    this.logoCopy();                                // vt+0x1bc 0x100198f0
    s = m.I;
    s[L(7, 0x3b74)] = (s[0xd548 >> 2] - s[L(7, 0x3b80)]) | 0;
    s[L(7, 0x3b94)] = (s[L(7, 0x3b84)] - s[0xd54c >> 2] + 1000) | 0;
    s[L(7, 0x3c9c)] = 0;
    s[L(7, 0x3b08)] = 3;
  }

  /** vt+0x1bc 0x100198f0: the current layer's table image copied out (& 0xffffff), then resized (vt+0x1b4). */
  logoCopy(): void {
    var m = this.m, s = m.I, k = s[0xd35c >> 2];
    if (s[L(k, 0x3b18)] === 0 || s[L(k, 0x3b1c)] === 0) return;
    this.freeLayer();
    this.bindImage();
    s = m.I;
    var n = Math.imul(s[0xd86c >> 2], s[0xd858 >> 2]);
    s[0xdadc >> 2] = n;
    var p = m.malloc(n * 4 + 0xc);
    s = m.I;
    var U = m.U;
    s[0xd540 >> 2] = p;
    var a = s[L(k, 0x3b20)] >> 2, d = p >> 2;
    for (var i = 0; i < n; i++) U[d + i] = U[a + i] & 0xffffff;
    s[0xd264 >> 2] = p + n * 4;
    s[0xd298 >> 2] = s[L(k, 0x3b20)] + n * 4;
    s[0xd498 >> 2] = n;
    this.resizeImage();                             // vt+0x1b4 0x100189c0
  }

  /** vt+0x1b4 0x100189c0: the image at obj+0xd540 (obj+0xd86c x 0xd858) scaled to obj+0xd3d0 x 0xd3d4 by the
   *  canvas scaler (scaleOut, the canvas fields swapped for the image's), into a fresh layer image. */
  resizeImage(): void {
    var m = this.m, s = m.I;
    var saveH = s[0xd54c >> 2], saveW = s[0xd548 >> 2], saveCW = s[0xd6b4 >> 2], saveCH = s[0xd6bc >> 2];
    var iw = s[0xd86c >> 2], ih = s[0xd858 >> 2];
    s[0xd24c >> 2] = s[0xd540 >> 2];
    s[0xd548 >> 2] = s[0xd3d0 >> 2];
    s[0xd2f0 >> 2] = iw; s[0xd6b4 >> 2] = iw;
    s[0xd2ec >> 2] = ih; s[0xd6bc >> 2] = ih;
    s[0xd54c >> 2] = s[0xd3d4 >> 2];
    if (s[0xd528 >> 2] !== 0) { m.release(s[0xd528 >> 2]); s[0xd528 >> 2] = 0; }
    s[0xd528 >> 2] = s[0xd540 >> 2];
    s[0xd458 >> 2] = 1;
    this.scaleOut();                                // vt+0x1b0 0x1000f2c0
    s = m.I;
    s[0xd458 >> 2] = 0;
    s[0xd528 >> 2] = 0;
    s[0xd540 >> 2] = s[0xd24c >> 2];
    var w = s[0xd2f0 >> 2], h = s[0xd2ec >> 2], n = Math.imul(h, w);
    s[0xd858 >> 2] = h;
    s[0xd86c >> 2] = w;
    s[0xd6b4 >> 2] = saveCW;
    s[0xdadc >> 2] = n;
    s[0xd6bc >> 2] = saveCH;
    s[0xd548 >> 2] = saveW;
    s[0xd54c >> 2] = saveH;
    if (s[0xd440 >> 2] === 1) return;
    var p = m.malloc(n * 4 + 0xc);
    s = m.I;
    var U = m.U;
    s[0xd53c >> 2] = p;
    U[p >> 2] = w; U[(p >> 2) + 1] = h; U[(p >> 2) + 2] = 0;
    s[0xd8e8 >> 2] = p + 12;
    U.copyWithin((p + 12) >> 2, s[0xd540 >> 2] >> 2, (s[0xd540 >> 2] >> 2) + n);
    s[0xd264 >> 2] = p + 12 + n * 4;
    s[0xd298 >> 2] = s[0xd540 >> 2] + n * 4;
    s[0xd498 >> 2] = n;
    var k = s[0xd35c >> 2];
    s[L(k, 0x3afc)] = -1;
    s[L(k, 0x3b80)] = w;
    s[L(k, 0x3b84)] = h;
    s[L(k, 0x3b28)] = w;
    s[L(k, 0x3b2c)] = h;
    s[L(k, 0x3b20)] = s[0xd8e8 >> 2];
    if (s[0xd540 >> 2] !== 0) { m.release(s[0xd540 >> 2]); s[0xd540 >> 2] = 0; }
    s[0xd53c >> 2] = 0;
  }

  // ---------------------------------------------------------------- out (vt+0xe4 0x10002380)
  /** scaleOut (the canvas to the window: 1:1 now that the canvas is the window), then BitBlt at the rect's
   *  origin. */
  blit(): void {
    var m = this.m, s = m.I;
    if (s[0xd454 >> 2] === 1) { this.scaleOut(); s = m.I; }
    if (s[0xd440 >> 2] === 1) return;
    s[0xd954 >> 2] = s[0xd4e8 >> 2];
    if (s[0xd454 >> 2] === 1) { s[0xdb24 >> 2] = s[0xd6fc >> 2]; s[0xdb38 >> 2] = s[0xd700 >> 2]; }
    if (s[0xd278 >> 2] === 0) {
      var bi = m.malloc(0x34);
      s = m.I;
      s[0xd278 >> 2] = bi; s[0xd27c >> 2] = bi; s[0xd48c >> 2] = 0x28; s[0xd280 >> 2] = bi + 0xa0;
      m.I[bi >> 2] = 0x28;
    }
    var hdr = s[0xd27c >> 2] >> 2;
    m.I[hdr + 5] = Math.imul(s[0xd2ec >> 2], s[0xd2f0 >> 2]);
    m.I[hdr + 1] = s[0xd2f0 >> 2];
    m.I[hdr + 2] = -s[0xd2ec >> 2];
    var w = s[0xd2f0 >> 2], h = s[0xd2ec >> 2], x0 = s[0xdb24 >> 2], y0 = s[0xdb38 >> 2];
    var src = s[0xd24c >> 2] >> 2, U = m.U, dc = this.dc, W = this.dcW, H = this.dcH;
    var xa = x0 < 0 ? -x0 : 0, xb = x0 + w > W ? W - x0 : w;   // BitBlt clips to the DIB
    for (var y = y0 < 0 ? -y0 : 0; y < h && y0 + y < H; y++) {
      var a = src + y * w + xa, o = (y0 + y) * W + x0 + xa;
      for (var x = xa; x < xb; x++) dc[o++] = U[a++] & 0xffffff;
    }
    s[0xd4c0 >> 2] = w;
    s[0xd4c4 >> 2] = h;
    s[0xd4c8 >> 2] = s[0xd24c >> 2];
  }

  /** vt+0x1b0 0x1000f2c0: the buffer obj+0xd24c (obj+0xd6b4 x 0xd6bc) scaled by the 8.8 factors that take it
   *  to obj+0xd548 x 0xd54c (halving the source step while a factor would pass 3) into a fresh buffer; when the
   *  window changed (obj+0xd598) and the result is not exactly its size, padded into one that is. */
  scaleOut(): void {
    var m = this.m, s = m.I;
    s[0xd9fc >> 2] = s[0xd6b4 >> 2];
    s[0xda00 >> 2] = s[0xd6bc >> 2];
    for (;;) {
      var sx = ftol(s[0xd548 >> 2] * 256 / s[0xd9fc >> 2]);
      s[0xd6f4 >> 2] = sx;
      var sy = ftol(s[0xd54c >> 2] * 256 / s[0xda00 >> 2]);
      s[0xd6f8 >> 2] = sy;
      if (sx <= 0x300 && sy <= 0x300) break;
      this.double2x();                              // vt+0xe0 0x1000f7d0: a target over 3x the source
      s = m.I;
      s[0xd9fc >> 2] <<= 1;
      s[0xda00 >> 2] <<= 1;
    }
    s[0xd5d4 >> 2] = s[0xd2f0 >> 2];
    s[0xd5d0 >> 2] = s[0xd2ec >> 2];
    s[0xd270 >> 2] = s[0xd24c >> 2];
    s[0xd8e4 >> 2] = s[0xd6f4 >> 2];
    s[0xda8c >> 2] = s[0xd9fc >> 2];
    this.scaleLen();                                // vt+0x84
    s[0xd2f0 >> 2] = s[0xda8c >> 2];
    s[0xd8e4 >> 2] = s[0xd6f8 >> 2];
    s[0xda8c >> 2] = s[0xda00 >> 2];
    this.scaleLen();
    s[0xd2ec >> 2] = s[0xda8c >> 2];
    this.rowPad();                                  // vt+0x170 0x10002ff0
    s[0xd2f0 >> 2] += s[0xd244 >> 2];
    var p = m.malloc(Math.imul(s[0xd2f0 >> 2], s[0xd2ec >> 2]) * 4);
    s = m.I;
    s[0xd52c >> 2] = p;
    s[0xd24c >> 2] = p;
    s[0xd594 >> 2] = p;
    this.scaleRows();                               // vt+0x1b8 0x1000e870
    s[0xd270 >> 2] = s[0xd594 >> 2];
    if (s[0xd528 >> 2] !== 0) { m.release(s[0xd528 >> 2]); s[0xd528 >> 2] = 0; }
    s[0xd528 >> 2] = s[0xd52c >> 2];
    if (s[0xd2ec >> 2] > s[0xd54c >> 2]) s[0xd2ec >> 2] = s[0xd54c >> 2];
    if (s[0xd300 >> 2] === 8) s[0xd598 >> 2] = 1;
    var h0 = s[0xd2ec >> 2], w0 = s[0xd2f0 >> 2];
    if (s[0xd598 >> 2] === 1 && (s[0xd54c >> 2] !== h0 || s[0xd548 >> 2] !== w0)) {
      s[0xd404 >> 2] = w0; s[0xd400 >> 2] = h0; s[0xd408 >> 2] = w0 * 4;
      if (w0 < s[0xd548 >> 2]) s[0xd2f0 >> 2] = s[0xd548 >> 2];
      if (h0 < s[0xd54c >> 2]) s[0xd2ec >> 2] = s[0xd54c >> 2];
      if (s[0xd404 >> 2] > s[0xd2f0 >> 2]) s[0xd2f0 >> 2] = s[0xd404 >> 2];
      s[0xd2f4 >> 2] = s[0xd2f0 >> 2] << 2;
      this.rowPad();
      s[0xd2f0 >> 2] += s[0xd244 >> 2];
      s[0xd2f4 >> 2] = s[0xd2f0 >> 2] * 4;
      var q = m.malloc(Math.imul(s[0xd2f0 >> 2], s[0xd2ec >> 2]) * 4);
      s = m.I;
      var U = m.U;
      s[0xd52c >> 2] = q;
      s[0xd24c >> 2] = q;
      var n = Math.imul(s[0xd2f0 >> 2], s[0xd2ec >> 2]);
      s[0xdadc >> 2] = n;
      U.fill(s[0xd724 >> 2] >>> 0, q >> 2, (q >> 2) + n);
      var a = s[0xd270 >> 2] >> 2, d = q >> 2, rw = s[0xd404 >> 2], stride = s[0xd2f0 >> 2];
      for (var r = 0; r < s[0xd400 >> 2]; r++) {
        for (var c = 0; c < rw; c++) U[d + c] = U[a++];
        d += stride;
      }
      s[0xd298 >> 2] = a << 2; s[0xd264 >> 2] = d << 2; s[0xdafc >> 2] = s[0xd400 >> 2]; s[0xd49c >> 2] = rw;
      s[0xd270 >> 2] = s[0xd594 >> 2];
      if (s[0xd528 >> 2] !== 0) { m.release(s[0xd528 >> 2]); s[0xd528 >> 2] = 0; }
      s[0xd528 >> 2] = s[0xd52c >> 2];
      s[0xd52c >> 2] = 0;
    }
  }

  /** vt+0xe0 0x1000f7d0: the buffer obj+0xd24c (obj+0xd2f0 x 0xd2ec) doubled in both directions, each pixel
   *  a 2 x 2 block, into a fresh one that replaces obj+0xd528. */
  double2x(): void {
    var m = this.m, s = m.I, w = s[0xd2f0 >> 2], h = s[0xd2ec >> 2];
    s[0xd270 >> 2] = s[0xd24c >> 2];
    s[0xd400 >> 2] = h; s[0xd404 >> 2] = w; s[0xd408 >> 2] = w * 4;
    var p = m.malloc(Math.imul(h, w) * 16);
    s = m.I;
    var U = m.U;
    s[0xd52c >> 2] = p;
    s[0xd24c >> 2] = p;
    var a = s[0xd270 >> 2] >> 2, d = p >> 2;
    for (var r = 0; r < h; r++, a += w) {
      for (var c = 0; c < w; c++) { U[d++] = U[a + c]; U[d++] = U[a + c]; }
      for (c = 0; c < w; c++) { U[d++] = U[a + c]; U[d++] = U[a + c]; }
    }
    if (s[0xd528 >> 2] !== 0) { m.release(s[0xd528 >> 2]); s[0xd528 >> 2] = 0; }
    s[0xd2f0 >> 2] = w << 1;
    s[0xd2ec >> 2] = h << 1;
    s[0xd528 >> 2] = p;
    s[0xd52c >> 2] = 0;
  }

  /** vt+0x170 0x10002ff0: row padding to a DWORD for 8/16/24 bpp: none at 32 bpp (and none while scaling an
   *  image, obj+0xd458). */
  rowPad(): void {
    this.m.I[0xd244 >> 2] = 0;
  }

  /** vt+0x1b8 0x1000e870: DDA scale of obj+0xd270 (obj+0xd5d4 x 0xd5d0) into obj+0xd594 by obj+0xd6f4 /
   *  0xd6f8 (8.8): 0..1x drops pixels and rows on the carry, 1..2x and 2..3x repeat them. */
  scaleRows(): void {
    var m = this.m, s = m.I, U = m.U, sx = s[0xd6f4 >> 2], sy = s[0xd6f8 >> 2];
    s[0xd76c >> 2] = 0;
    if (sx < 0x100) s[0xda28 >> 2] = 0x100; else if (sx < 0x201) s[0xda28 >> 2] = 0x200; else if (sx < 0x301) s[0xda28 >> 2] = 0x2ff;
    if (sy < 0x100) s[0xda2c >> 2] = 0x100; else if (sy < 0x201) s[0xda2c >> 2] = 0x200; else if (sy <= 0x300) s[0xda2c >> 2] = 0x2ff;
    else return;
    var usx = sx >>> 0, usy = sy >>> 0;
    s[0xd5d8 >> 2] = s[0xd5d4 >> 2] << 2;
    var si = s[0xd270 >> 2] >> 2, di = s[0xd594 >> 2] >> 2;
    s[0xd858 >> 2] = s[0xd5d0 >> 2];
    var e = (s[0xda2c >> 2] - sy) >>> 0;
    if (usy > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
    var stepY = bswap(e);
    s[0xd754 >> 2] = stepY;
    e = (s[0xda28 >> 2] - sx) >>> 0;
    if (usx > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
    var stepX = bswap(e), srcW = s[0xd5d4 >> 2] >>> 0, outW = s[0xd2f0 >> 2] >>> 0;
    var accY = 0, t: number, n: number, acc: number, px: number, i: number;
    for (;;) {
      // one source row (0x1000e97b)
      n = srcW; acc = 0;
      if (usx < 0x101) {
        for (;;) {
          U[di++] = U[si++];
          for (;;) { if (--n === 0) break; t = acc + stepX; acc = t >>> 0; if (t > 0xffffffff) { si++; continue; } break; }
          if (n === 0) break;
        }
      } else if (usx < 0x201) {
        for (;;) {
          px = U[si]; U[di++] = px; si++;
          if (--n === 0) break;
          t = acc + stepX; acc = t >>> 0;
          if (t <= 0xffffffff) U[di++] = px;
        }
      } else {
        for (;;) {
          px = U[si]; U[di++] = px; U[di++] = px; si++;
          if (--n === 0) break;
          t = acc + stepX; acc = t >>> 0;
          if (t <= 0xffffffff) U[di++] = px;
        }
      }
      var pad = s[0xd244 >> 2];
      for (i = 0; i < pad; i++) U[di++] = s[0xd724 >> 2] >>> 0;
      // rows (0x1000e9e5)
      if (usy < 0x101) {
        var next = false;
        for (;;) {
          if (--s[0xd858 >> 2] === 0) { s[0xd76c >> 2] = accY; return; }
          t = accY + stepY; accY = t >>> 0;
          if (t <= 0xffffffff) { next = true; break; }
          si += srcW;                               // carry: drop a source row
        }
        s[0xd76c >> 2] = accY;
        if (next) continue;
      } else if (usy < 0x201) {
        if (--s[0xd858 >> 2] === 0) { s[0xd76c >> 2] = accY; return; }
        t = accY + stepY; accY = t >>> 0;
        s[0xd76c >> 2] = accY;
        if (t > 0xffffffff) continue;
        U.copyWithin(di, di - outW, di); di += outW;
      } else {
        U.copyWithin(di, di - outW, di); di += outW;
        if (--s[0xd858 >> 2] === 0) { s[0xd76c >> 2] = accY; return; }
        t = accY + stepY; accY = t >>> 0;
        s[0xd76c >> 2] = accY;
        if (t > 0xffffffff) continue;
        U.copyWithin(di, di - outW, di); di += outW;
      }
    }
  }

  /** vt+0x118 0x10008320: the layer image's alpha bytes (what blend reads): the fade (T 0xb90) plus an edge
   *  term (distance from the colour-keyed edge, L 0x3bdc / 0x3bd8) plus a brightness term (pixels brighter or
   *  darker than a threshold, L 0x3bf0 / 0x3bec); or another layer's image as the mask (L 0x3c24). Skipped
   *  when the parameters' checksum (kept in the dword before the image) is unchanged. */
  alphaEdge(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0xd35c >> 2];
    if (s[L(k, 0x3cdc)] === 2) s[L(k, 0x3cdc)] = 1;
    else {
      var sum = (s[L(k, 0x3bdc)] + Math.imul(s[L(k, 0x3bd8)], 0xff) + (s[L(k, 0x3bf0)] << 9) + s[L(k, 0x3bec)] +
                 ftol(F[T(k, 0xb90)]) + Math.imul(s[L(k, 0x3c80)], 3) + s[L(k, 0x3c24)] + s[L(k, 0x3c28)] + 1) | 0;
      s[0xd2b8 >> 2] = sum;
      var at = (s[0xd270 >> 2] - 4) >> 2;
      if (s[at] === sum) return;
      s[at] = sum;
    }
    s[0xd63c >> 2] = Math.imul(s[0xd8f8 >> 2], s[0xd8ec >> 2]);
    s[0xd644 >> 2] = s[L(k, 0x3bdc)];
    s[0xd9e8 >> 2] = s[T(k, 0xb90)];
    s[0xda80 >> 2] = 0; s[0xda7c >> 2] = 0;
    if (s[L(k, 0x3bdc)] !== 0) {
      s[0xd4e4 >> 2] = s[L(k, 0x3ce0)];
      s[0xda30 >> 2] = s[L(k, 0x3bd8)];
      s[0xda74 >> 2] = s[L(k, 0x3bd8)] < 0 ? -s[L(k, 0x3bd8)] | 0 : s[L(k, 0x3bd8)];
      F[0xd4f8 >> 2] = s[0xda74 >> 2];
      F[0xd394 >> 2] = F[0xd4f8 >> 2] / s[0xd644 >> 2];
      var third = (s[0xd644 >> 2] / 3) | 0;
      if (s[0xd4e4 >> 2] < third) F[0xd4f8 >> 2] = (third - s[0xd4e4 >> 2]) * F[0xd394 >> 2] + F[0xd4f8 >> 2];
    }
    var b3bf0 = s[L(k, 0x3bf0)], b3bec = s[L(k, 0x3bec)], fade0 = F[T(k, 0xb90)] === 0;
    if (b3bf0 === 0 && b3bec === 0 && fade0 && s[L(k, 0x3bdc)] !== 0 && s[L(k, 0x3bd8)] !== 0) { this.alphaFromEdge(); return; }
    if (b3bf0 === 0 && b3bec === 0 && fade0) { this.alphaFromLayer(true); return; }
    if (b3bf0 !== 0 && b3bec !== 0) {
      s[0xda94 >> 2] = b3bec < 0 ? -b3bec | 0 : (0xff - b3bec) | 0;
      s[0xda34 >> 2] = b3bf0;
      F[0xd500 >> 2] = b3bf0;
      F[0xd398 >> 2] = F[0xd500 >> 2] / 255;
    }
    var src = s[0xd270 >> 2], e = s[0xd26c >> 2], key = s[0xda0c >> 2] >>> 0, c3c24 = s[L(k, 0x3c24)], c3c28 = s[L(k, 0x3c28)];
    var bright = b3bf0 !== 0 && b3bec !== 0;
    do {
      var p = U[src >> 2];
      if (p !== key) {
        if (s[0xd644 >> 2] !== 0) {
          var v = U[e >> 2] & 0xffff;
          if ((s[0xda30 >> 2] >>> 0) >= 0x80000000) v = (s[0xd4e4 >> 2] - v + 1) | 0;
          s[0xd350 >> 2] = (v >>> 0) <= (s[0xd644 >> 2] >>> 0) ? v : 0;
          if (s[0xd350 >> 2] !== 0) {
            if (c3c24 === 0) F[0xda80 >> 2] = F[0xd4f8 >> 2] - s[0xd350 >> 2] * F[0xd394 >> 2];
            if (c3c24 === 1) {
              if (s[0xd644 >> 2] !== s[0xd350 >> 2]) s[0xda80 >> 2] = s[0xd4f8 >> 2];
              else F[0xda80 >> 2] = F[0xd4f8 >> 2] / 2;
            }
            if (c3c24 > 1) F[0xda80 >> 2] = F[0xd4f8 >> 2] - s[0xd350 >> 2] * F[0xd394 >> 2];
          }
        }
        if (bright) {
          var px = U[src >> 2], mx = (px >>> 16) & 0xff, g = (px >>> 8) & 0xff, bl = px & 0xff;
          if (mx < g) mx = g;
          if (mx < bl) mx = bl;
          s[0xd4fc >> 2] = mx;
          var done = false;
          if (c3c28 === 0) {
            if (b3bec >= 0) { if (mx > s[0xda94 >> 2]) F[0xda7c >> 2] = F[0xd500 >> 2] - (0xff - mx) * F[0xd398 >> 2]; }
            else if (mx < s[0xda94 >> 2]) F[0xda7c >> 2] = F[0xd500 >> 2] - mx * F[0xd398 >> 2];
          }
          if (c3c28 === 1) {
            if (s[0xda94 >> 2] === mx) { F[0xda7c >> 2] = (b3bf0 / 2) | 0; done = true; }
            else if (b3bec >= 0) { if (mx > s[0xda94 >> 2]) F[0xda7c >> 2] = b3bf0; }
            else if (mx < s[0xda94 >> 2]) F[0xda7c >> 2] = b3bf0;
          }
          void done;
        }
        var a = ftol(F[0xd9e8 >> 2] + F[0xda80 >> 2] + F[0xda7c >> 2]);
        s[0xda80 >> 2] = 0; s[0xda7c >> 2] = 0;
        if (a > 0xff) a = 0xff;
        s[0xda74 >> 2] = a;
        U[src >> 2] = bswap(((bswap(U[src >> 2]) & 0xffffff00) | a) >>> 0);
      }
      src += 4; e += 4;
    } while (--s[0xd63c >> 2] !== 0);
    s[0xd6a4 >> 2] = src; s[0xd6a0 >> 2] = e;
    this.alphaFromLayer(false);
  }

  /** 0x10008c2c / 0x1000918e: another layer's image (L 0x3c24) as the mask: alpha += 255 - its blue (carry
   *  saturates to 0xff000000). `masked`: the 0x10008c2c variant adds to the colour without its alpha byte. */
  alphaFromLayer(masked: boolean): boolean {
    var m = this.m, s = m.I, U = m.U, k = s[0xd35c >> 2], j = s[L(k, 0x3c24)];
    if (!(j > 1 && j <= s[0xdad4 >> 2])) return true;
    s[0xd498 >> 2] = j;
    s[0xd63c >> 2] = Math.imul(s[0xd8f8 >> 2], s[0xd8ec >> 2]);
    if (s[0xd63c >> 2] > Math.imul(s[L(j, 0x3b80)], s[L(j, 0x3b84)])) return true;
    s[0xd7f8 >> 2] = s[L(j, 0x3b20)];
    if (s[L(j, 0x3bb0)] === 1) { if (s[L(j, 0x3bb4)] === 0) return false; s[0xd7f8 >> 2] = s[L(j, 0x3bb4)]; }
    else if (s[L(j, 0x3bb0)] === 2) { if (s[L(j, 0x3c98)] === 0) return false; s[0xd7f8 >> 2] = s[L(j, 0x3c98)]; }
    var src = s[0xd270 >> 2] >> 2, o = s[0xd7f8 >> 2] >> 2, key = s[0xda0c >> 2] >>> 0;
    do {
      var p = U[src];
      if (p !== key) {
        var t = ((0xff - (U[o] & 0xff)) << 24) >>> 0, base = masked ? (p & 0xffffff) : p, v = t + base;
        U[src] = v > 0xffffffff ? ((v >>> 0) | 0xff000000) >>> 0 : v;
      }
      src++; o++;
    } while (--s[0xd63c >> 2] !== 0);
    return true;
  }

  /** 0x10008e33: no brightness, no fade, an edge: the mask layer (as alphaFromLayer, masked) then the edge
   *  alpha a - v * a / range added (0x10009058); without a mask layer, the edge alpha replaces it (0x100090f4). */
  alphaFromEdge(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0xd35c >> 2], j = s[L(k, 0x3c24)], add = false;
    if (j > 1 && j <= s[0xdad4 >> 2]) {
      s[0xd498 >> 2] = j;
      s[0xd63c >> 2] = Math.imul(s[0xd8f8 >> 2], s[0xd8ec >> 2]);
      if (s[0xd63c >> 2] <= Math.imul(s[L(j, 0x3b80)], s[L(j, 0x3b84)])) {
        if (!this.alphaFromLayer(true)) return;
      }
      s = m.I;
      s[0xd63c >> 2] = Math.imul(s[0xd8f8 >> 2], s[0xd8ec >> 2]);
      add = true;
    }
    var a = ftol(F[0xd4f8 >> 2]);
    s[0xda74 >> 2] = a;
    s[0xd63c >> 2] = Math.imul(s[0xd8f8 >> 2], s[0xd8ec >> 2]);
    var src = s[0xd270 >> 2] >> 2, e = s[0xd26c >> 2] >> 2, key = s[0xda0c >> 2] >>> 0, range = s[0xd644 >> 2] >>> 0;
    do {
      var p = U[src];
      if (p !== key) {
        var v = U[e] & 0xffff;
        if (v <= range) {
          var t = ((a >>> 0) - Math.floor(v * (a >>> 0) / range)) >>> 0;   // MUL / DIV, unsigned
          if (t > 0xff) t = 0xff;
          if (add) {
            var w = p + ((t << 24) >>> 0);
            U[src] = w > 0xffffffff ? ((w >>> 0) | 0xff000000) >>> 0 : w;
          } else U[src] = ((p & 0xffffff) | (t << 24)) >>> 0;
        }
      }
      src++; e++;
    } while (--s[0xd63c >> 2] !== 0);
  }
  /** vt+0xec 0x10004280: the next effect reads obj+0xd270 and writes obj+0xd248, ping-ponging between the
   *  layer's image and its two work buffers (L 0x3bb4, 0x3c98; allocated on first use). false = no memory. */
  swapBuffers(): boolean {
    var s = this.m.I, k = s[0xd35c >> 2], v = s[L(k, 0x3bb0)];
    if (v === 0) {
      s[0xd270 >> 2] = s[L(k, 0x3b20)];
      if (s[L(k, 0x3bb4)] === 0) {
        this.allocWork(0x3bb4);                     // vt+0x100 0x10004ab0
        s = this.m.I;
        if (s[0xd248 >> 2] === 0) return false;
      }
      s[0xd248 >> 2] = s[L(k, 0x3bb4)];
      s[L(k, 0x3bb0)] = 1;
      return true;
    }
    if (v === 1) {
      s[0xd270 >> 2] = s[L(k, 0x3bb4)];
      if (s[L(k, 0x3c98)] === 0) {
        this.allocWork(0x3c98);                     // vt+0xfc 0x10004b20
        s = this.m.I;
        if (s[0xd248 >> 2] === 0) return false;
      }
      s[0xd248 >> 2] = s[L(k, 0x3c98)];
      s[L(k, 0x3bb0)] = 2;
      return true;
    }
    if (v === 2) {
      s[0xd270 >> 2] = s[L(k, 0x3c98)];
      if (s[L(k, 0x3bb4)] === 0) {
        this.allocWork(0x3bb4);
        s = this.m.I;
        if (s[0xd248 >> 2] === 0) return false;
      }
      s[0xd248 >> 2] = s[L(k, 0x3bb4)];
      s[L(k, 0x3bb0)] = 1;
      return true;
    }
    return false;
  }
  /** vt+0x100 0x10004ab0 / vt+0xfc 0x10004b20: a work buffer the size of the layer image (+ 8) at L field. */
  allocWork(field: number): void {
    var m = this.m, s = m.I, k = s[0xd35c >> 2];
    var p = m.malloc(Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]) * 4 + 8);
    s = m.I;
    s[0xd248 >> 2] = p;
    s[L(k, field)] = p;
  }

  /** vt+0xbc 0x10009510: the layer image (obj+0xd270) displaced pixel by pixel into obj+0xd248 (pre-filled
   *  with the colour key, or the background colour when there is none): each pixel's offset from the centre
   *  (plus a drift, L 0x3c0c / 0x3c10) goes through the enabled kernels, the last one the spin/scale (vt+0x264);
   *  out-of-bounds results are dropped. Three loops: spin only, the mixed waves (never with the shipped
   *  presets), and the general one (only an empty target pixel taken, per obj+0xd438). */
  warp(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0xd35c >> 2];
    var cosA = (fi: number): number => F[(0xc65c >> 2) + ftol(F[fi])];
    var n = Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]);
    s[0xdadc >> 2] = n;
    s[0xd268 >> 2] = (s[0xd248 >> 2] + n * 4) | 0;
    var key = s[0xda0c >> 2];
    if (key === -1) key = s[0xd724 >> 2];
    s[0xda8c >> 2] = key;
    U.fill(key >>> 0, s[0xd248 >> 2] >> 2, (s[0xd248 >> 2] >> 2) + n);
    s[0xd984 >> 2] = s[L(k, 0x3c0c)];
    s[0xd988 >> 2] = s[L(k, 0x3c10)];
    var b4c = T(k, 0xb4c), b54 = T(k, 0xb54);
    if (s[L(k, 0x3cd4)] === 1) {
      s[0xd984 >> 2] = ftol(s[0xd984 >> 2] * cosA(b4c));
      s[0xd988 >> 2] = ftol(s[0xd988 >> 2] * cosA(b4c));
    }
    if (s[L(k, 0x3cd4)] === 2) {
      s[0xd984 >> 2] = ftol(s[0xd984 >> 2] * cosA(b54));
      s[0xd988 >> 2] = ftol(s[0xd988 >> 2] * cosA(b54));
    }
    var w = s[L(k, 0x3b80)], h = s[L(k, 0x3b84)];
    s[0xd328 >> 2] = (((w / 2) | 0) + s[0xd984 >> 2]) | 0;
    s[0xd330 >> 2] = (((h / 2) | 0) + s[0xd988 >> 2]) | 0;
    s[0xd9dc >> 2] = w;
    s[0xd298 >> 2] = s[0xd270 >> 2];
    var P = (o: number): number => F[T(k, o)];
    var c408 = fr(0.0010000000474974513);
    if (P(0xb28) !== 0 || P(0xb2c) !== 0) {
      s[0xda14 >> 2] = s[T(k, 0xb28)];
      s[0xda18 >> 2] = s[T(k, 0xb2c)];
      F[0xda10 >> 2] = P(0xb40) * c408;
      if (s[L(k, 0x3c54)] === 1) F[0xda14 >> 2] = cosA(b4c) * F[0xda14 >> 2];
      if (s[L(k, 0x3c54)] === 2) F[0xda14 >> 2] = cosA(b54) * F[0xda14 >> 2];
      if (s[L(k, 0x3cc0)] === 1) F[0xda18 >> 2] = cosA(b4c) * F[0xda18 >> 2];
      if (s[L(k, 0x3cc0)] === 2) F[0xda18 >> 2] = cosA(b54) * F[0xda18 >> 2];
    }
    if (P(0xb34) !== 0 || P(0xb30) !== 0) {
      s[0xda44 >> 2] = s[T(k, 0xb30)];
      s[0xda58 >> 2] = s[T(k, 0xb34)];
      F[0xda48 >> 2] = P(0xb40) * c408;
      if (s[L(k, 0x3c58)] === 1) { F[0xda44 >> 2] = cosA(b4c) * F[0xda44 >> 2]; F[0xda58 >> 2] = cosA(b4c) * F[0xda58 >> 2]; }
      if (s[L(k, 0x3c58)] === 2) { F[0xda44 >> 2] = cosA(b54) * F[0xda44 >> 2]; F[0xda58 >> 2] = cosA(b54) * F[0xda58 >> 2]; }
    }
    if (P(0xb38) !== 0 || P(0xb3c) !== 0) {
      s[0xda9c >> 2] = s[T(k, 0xb38)];
      s[0xdaa0 >> 2] = s[T(k, 0xb3c)];
      F[0xda98 >> 2] = P(0xb40) * c408;
      s[0xd924 >> 2] = 0; s[0xd928 >> 2] = 0;
      if (s[L(k, 0x3c60)] === 1) s[0xd924 >> 2] = s[b4c];
      if (s[L(k, 0x3c60)] === 2) s[0xd924 >> 2] = s[b54];
      if (s[L(k, 0x3c64)] === 1) s[0xd928 >> 2] = s[b4c];
      if (s[L(k, 0x3c64)] === 2) s[0xd928 >> 2] = s[b54];
    }
    var v44 = P(0xb44), dd = v44 * v44 + v44 * v44;   // (v*v then doubled, in the FPU)
    F[0xd718 >> 2] = dd;
    F[0xd714 >> 2] = 90 / dd;
    var e38 = s[L(k, 0x3c70)] * fr(0.009999999776482582);
    F[0xda38 >> 2] = e38;
    if (s[L(k, 0x3c38)] === 1) F[0xda38 >> 2] = e38 * cosA(b4c);     // the unrounded product, still on the stack
    if (s[L(k, 0x3c38)] === 2) F[0xda38 >> 2] = cosA(b54) * F[0xda38 >> 2];
    var v5c = P(0xb5c);
    F[0xd720 >> 2] = v5c * v5c + v5c * v5c;
    var c3fc = fr(9.999999747378752e-05);
    F[0xda4c >> 2] = P(0xb6c) * c3fc;
    F[0xda50 >> 2] = P(0xb70) * c3fc;
    F[0xda54 >> 2] = P(0xb74) * c3fc;
    s[0xd618 >> 2] = s[T(k, 0xb60)];
    s[0xd61c >> 2] = s[T(k, 0xb64)];
    s[0xd620 >> 2] = s[T(k, 0xb68)];
    F[0xd97c >> 2] = 1; F[0xd7b8 >> 2] = 1;
    if (s[L(k, 0x3c78)] === 1) F[0xd97c >> 2] = cosA(b4c);
    if (s[L(k, 0x3c78)] === 2) F[0xd97c >> 2] = cosA(b54);
    if (s[L(k, 0x3c7c)] === 1) F[0xd7b8 >> 2] = cosA(b4c);
    if (s[L(k, 0x3c7c)] === 2) F[0xd7b8 >> 2] = cosA(b54);
    if (F[0xd97c >> 2] < 0) F[0xd97c >> 2] = -F[0xd97c >> 2];
    if (F[0xd7b8 >> 2] < 0) F[0xd7b8 >> 2] = -F[0xd7b8 >> 2];
    F[0xd618 >> 2] = F[0xd97c >> 2] * F[0xd618 >> 2];
    F[0xd61c >> 2] = F[0xd97c >> 2] * F[0xd61c >> 2];
    F[0xd620 >> 2] = F[0xd97c >> 2] * F[0xd620 >> 2];
    F[0xda4c >> 2] = F[0xda4c >> 2] * F[0xd7b8 >> 2];
    F[0xda50 >> 2] = F[0xda50 >> 2] * F[0xd7b8 >> 2];
    F[0xda54 >> 2] = F[0xda54 >> 2] * F[0xd7b8 >> 2];
    F[0xd9ec >> 2] = P(0xb40) * fr(0.10000000149011612);
    s[0xd9f0 >> 2] = s[L(k, 0x3c18)];
    s[0xd9f4 >> 2] = s[L(k, 0x3c1c)];
    s[0xd9f8 >> 2] = s[L(k, 0x3c20)];
    if (F[0xd9ec >> 2] !== 0) {
      if (s[L(k, 0x3c84)] === 1) F[0xd9ec >> 2] = cosA(b4c) * F[0xd9ec >> 2];
      if (s[L(k, 0x3c84)] === 2) F[0xd9ec >> 2] = cosA(b54) * F[0xd9ec >> 2];
    }
    var sel88 = s[L(k, 0x3c88)];
    for (var j = 0; j < 3; j++) {                   // 0xd9f0 / 0xd9f4 / 0xd9f8 -> 0xd7c0 / 0xd7c4 / 0xd7c8
      if (s[(0xd9f0 >> 2) + j] === 0) continue;
      if (sel88 === 1) s[(0xd9f0 >> 2) + j] = ftol(F[b4c]);
      if (sel88 === 2) s[(0xd9f0 >> 2) + j] = ftol(F[b54]);
      s[(0xd7c0 >> 2) + j] = s[(0xd9f0 >> 2) + j];
    }
    var z = (o: number): boolean => P(o) === 0;
    var noShear = z(0xb5c) || (z(0xb60) && z(0xb64) && z(0xb68));
    var noRad = s[L(k, 0x3c70)] === 0 || z(0xb44);
    var spin = s[L(k, 0x3c18)] !== 0 || s[L(k, 0x3c1c)] !== 0 || s[L(k, 0x3c20)] !== 0;
    var path: number;
    if (z(0xb28) && z(0xb2c) && z(0xb34) && z(0xb30) && z(0xb38) && z(0xb3c) && noRad && noShear) path = 0;
    else if ((noShear && noRad && spin && !z(0xb3c)) || (z(0xb34) && z(0xb2c) && z(0xb28) && !z(0xb38) && z(0xb30))) path = 1;
    else path = 2;
    if (path === 1) unported(0x1000a325);           // (the waves: vt+0x260, never with the shipped presets)
    if (path === 2) m.B[0xd438] = 1;
    var cx = s[0xd328 >> 2], cy = s[0xd330 >> 2], src = s[0xd298 >> 2], end = s[0xd268 >> 2] >>> 0, okey = s[0xda0c >> 2] >>> 0;
    var dst = s[0xd248 >> 2], wu = w >>> 0, i = 0;
    for (; i < n; i++, src += 4) {
      var px = U[src >> 2];
      if (px === okey) continue;
      s[0xd848 >> 2] = px;
      var row = ((i >>> 0) / wu) >>> 0, col = ((i >>> 0) % wu) >>> 0;
      s[0xd65c >> 2] = row; s[0xd658 >> 2] = col;
      F[0xd660 >> 2] = (col - cx) | 0;
      F[0xd664 >> 2] = (row - cy) | 0;
      if (path === 0) this.spinKernel();            // vt+0x264 0x1000ca00
      else {
        if (P(0xb28) !== 0 || P(0xb2c) !== 0) unported(0x1000bd60);
        if (P(0xb34) !== 0 || P(0xb30) !== 0) unported(0x1000ba70);
        if (P(0xb38) !== 0 || P(0xb3c) !== 0) unported(0x1000bf90);
        if (P(0xb44) !== 0 && s[L(k, 0x3c70)] !== 0) { unported(0x1000c3b0); if (m.B[0xd44c] === 1) continue; }
        if (P(0xb5c) !== 0 && (P(0xb60) !== 0 || P(0xb64) !== 0 || P(0xb68) !== 0)) {
          this.shearKernel();                       // vt+0x268 0x1000c700
          if (m.B[0xd44c] === 1) continue;
        }
        if (spin) this.spinKernel();
      }
      var X = (ftol(F[0xd660 >> 2]) + cx) | 0;
      s[0xd824 >> 2] = X;
      var Y = (ftol(F[0xd664 >> 2]) + cy) | 0;
      s[0xd82c >> 2] = Y;
      if (Y >= h || X >= w || Y < 0 || X < 0) continue;
      var t = (dst + (Math.imul(Y, w) + X) * 4) >>> 0;
      s[0xd264 >> 2] = t | 0;
      if (t >= end) continue;
      if (path === 0 || m.B[0xd438] !== 0) U[t >> 2] = px;
      else if (U[t >> 2] === okey) U[t >> 2] = px;
    }
    s[0xd498 >> 2] = i;
    s[0xd298 >> 2] = src;
  }

  /** vt+0x264 0x1000ca00: spin by distance (angle -= r^2 * obj+0xd9ec, per axis L 0x3c18 / 0x3c1c / 0x3c20),
   *  rotate by the third angle, scale y by cos of the first and x by cos of the second. The (360 - a) lookups
   *  read the table before the sine one: cos(a), and -sin(a) (a = 0 reads sin(0)). */
  spinKernel(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2];
    if (F[0xd9ec >> 2] !== 0) {
      var X = F[0xd660 >> 2], Y = F[0xd664 >> 2];
      var r2 = ftol(X * X + Y * Y);
      s[0xda3c >> 2] = r2;
      var axes = [0x3c18, 0x3c1c, 0x3c20], base = [0xd7c0, 0xd7c4, 0xd7c8], out = [0xd9f0, 0xd9f4, 0xd9f8];
      for (var j = 0; j < 3; j++) {
        if (s[L(k, axes[j])] === 0) continue;
        var v = (s[base[j] >> 2] - ftol(r2 * F[0xd9ec >> 2])) | 0;
        while (v < 0) v = (v + 0x168) | 0;
        if (v > 0x167) v = (v >>> 0) % 0x168;
        s[out[j] >> 2] = v;
      }
    }
    s[0xd9d0 >> 2] = s[0xd660 >> 2];
    var a = s[0xd9f8 >> 2];
    if (a !== 0) {
      F[0xd660 >> 2] = F[0x32ff - a] * F[0xd660 >> 2] - F[0x3467 - a] * F[0xd664 >> 2];
      F[0xd664 >> 2] = F[0x3467 - a] * F[0xd9d0 >> 2] + F[0x32ff - a] * F[0xd664 >> 2];
    }
    if (s[L(k, 0x3c18)] !== 0) F[0xd664 >> 2] = F[0x32ff - s[0xd9f0 >> 2]] * F[0xd664 >> 2];
    if (s[L(k, 0x3c1c)] !== 0) F[0xd660 >> 2] = F[0x32ff - s[0xd9f4 >> 2]] * F[0xd660 >> 2];
  }

  /** vt+0x268 0x1000c700: the radial pull: inside (T 0xb5c > 0) or outside (< 0) the radius sqrt(T 0xd720),
   *  each coordinate shrinks by its own factor 1 - r^2 * k (L 0x3c74 = 0: dropped past the rim or past 1; 1 / 2:
   *  folded back into 0..1). obj+0xd44c = drop the pixel; obj+0xd438 = 0: the pixel did not move, so it only
   *  fills an empty target. */
  shearKernel(): void {
    var m = this.m, s = m.I, F = m.F, B = m.B, k = s[0xd35c >> 2];
    B[0xd438] = 1;
    var md = s[L(k, 0x3c74)];
    s[0xd788 >> 2] = md;
    if (md > 2) return;
    var X = F[0xd660 >> 2], Y = F[0xd664 >> 2];
    var r2 = ftol(X * X + Y * Y);
    s[0xd9d0 >> 2] = s[0xd660 >> 2];
    s[0xd9d4 >> 2] = s[0xd664 >> 2];
    B[0xd44c] = 0;
    s[0xda3c >> 2] = r2;
    var lim = ftol(F[0xd720 >> 2]);
    if (F[T(k, 0xb5c)] > 0) { if (r2 > lim) return; }
    else if (r2 < lim) { B[0xd44c] = 1; return; }
    var t1 = F[0xd620 >> 2] - r2 * F[0xda54 >> 2];
    var sx = fr(F[0xd618 >> 2] - r2 * F[0xda4c >> 2] + t1);
    var sy = fr(F[0xd61c >> 2] - r2 * F[0xda50 >> 2] + t1);
    F[0xd9b8 >> 2] = sx;
    F[0xd9bc >> 2] = sy;
    if (md === 0) {
      if (sx < 0 || sy < 0) { B[0xd438] = 0; return; }
      if (sx > 1 || sy > 1) { B[0xd44c] = 1; return; }
    }
    if (md === 1 || md === 2) {
      if (sx < 0) F[0xd9b8 >> 2] = -sx;
      if (F[0xd9b8 >> 2] > 1) F[0xd9b8 >> 2] = 1 - (F[0xd9b8 >> 2] - ftol(F[0xd9b8 >> 2]));
      if (sy < 0) F[0xd9bc >> 2] = -sy;
      if (F[0xd9bc >> 2] > 1) F[0xd9bc >> 2] = 1 - (F[0xd9bc >> 2] - ftol(F[0xd9bc >> 2]));
    }
    F[0xd660 >> 2] = F[0xd660 >> 2] - ftol(F[0xd9b8 >> 2] * F[0xd660 >> 2]);
    var ny = F[0xd664 >> 2] - ftol(F[0xd9bc >> 2] * F[0xd664 >> 2]);   // kept unrounded on the stack
    F[0xd664 >> 2] = ny;
    if (ftol(F[0xd9d4 >> 2]) === ftol(ny) && ftol(F[0xd9d0 >> 2]) === ftol(F[0xd660 >> 2])) B[0xd438] = 0;
  }

  /** vt+0x98 0x10004e40: the layer image's alpha bytes cleared (and the low byte of its checksum dword). */
  maskImage(): void {
    var s = this.m.I, U = this.m.U, k = s[0xd35c >> 2], n = Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]);
    if (n === 0) return;
    var p = s[L(k, 0x3b20)];
    s[0xd298 >> 2] = p;
    this.m.B[p - 4] = 0;
    s[0xd498 >> 2] = 0;
    if (n <= 0) return;
    for (var i = 0; i < n; i++) U[(p >> 2) + i] &= 0xffffff;
    s[0xd298 >> 2] = p + n * 4;
    s[0xd498 >> 2] = n;
  }

  /** vt+0x1a4 0x10019640: a random drift (L 0x3c0c / 0x3c10) of up to half the layer's size, either sign. */
  drift(): void {
    var s = this.m.I, k = s[0xd35c >> 2];
    s[0xdaa4 >> 2] = (s[L(k, 0x3b28)] / ((A.rand() & 7) + 2)) | 0;
    s[0xdaa8 >> 2] = (s[L(k, 0x3b2c)] / ((A.rand() & 7) + 2)) | 0;
    s[L(k, 0x3c0c)] = (A.rand() & 1) === 0 ? s[0xdaa4 >> 2] : -s[0xdaa4 >> 2] | 0;
    s[L(k, 0x3c10)] = (A.rand() & 1) === 0 ? s[0xdaa8 >> 2] : -s[0xdaa8 >> 2] | 0;
  }

  /** vt+0x104 0x100049f0: the layer's edge-distance buffer (L 0x3bb8), zeroed. */
  allocEdge(): void {
    var m = this.m, s = m.I, k = s[0xd35c >> 2], n = Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]);
    var p = m.malloc(n * 4 + 8);
    s = m.I;
    s[0xd26c >> 2] = p;
    s[L(k, 0x3bb8)] = p;
    s[0xdadc >> 2] = n;
    m.U.fill(0, p >> 2, (p >> 2) + n);
  }

  /** vt+0x128 0x10005e40: the edge-distance map (obj+0xd26c, low 16 bits a pixel): how far each pixel that is
   *  not the colour key lies from the shape's edge, 1..255, by up to four directional passes (L 0x3bfc bits: 8
   *  left-to-right, 4 right-to-left, 2 top-down, 1 bottom-up; 0 = all); the first key pixel after a run gets
   *  0xffff OR'd in. L 0x3ce0 := the largest distance. (Musical Colors' edgeDistance.) */
  edgeDistance(): void {
    var m = this.m, s = m.I, U = m.U, k = s[0xd35c >> 2];
    var md = s[L(k, 0x3bfc)] & 0xf;
    if (md === 0) md = 0xf;
    s[0xd750 >> 2] = md;
    var key = s[L(k, 0x3b70)] >>> 0;
    s[0xda0c >> 2] = key | 0;
    var w = s[L(k, 0x3b80)], h = s[L(k, 0x3b84)], n = Math.imul(w, h);
    s[0xdadc >> 2] = n;
    s[0xdad8 >> 2] = n << 2;
    s[0xd3f8 >> 2] = w;
    s[0xd8dc >> 2] = w;
    var src = s[0xd270 >> 2] >> 2, dst = s[0xd26c >> 2] >> 2;
    s[0xd3f0 >> 2] = (s[0xd270 >> 2] + (n << 2) - 4) | 0;
    s[0xd3ec >> 2] = (s[0xd26c >> 2] + (n << 2) - 4) | 0;
    var mx = 0, i: number, e: number, cnt: number, d: number, v: number, c: number, r: number;
    if ((md & 8) === 0) {
      for (i = 0; i < (n >>> 0); i++) if (U[src + i] !== key) U[dst + i] = 0xfffe;
    } else {
      e = 0; cnt = w;
      for (i = 0; i < (n >>> 0); i++) {
        if (U[src + i] !== key) {
          if (++e > 0xff) e = 0xff;
          U[dst + i] = ((U[dst + i] & 0xffff0000) | e) >>> 0;
          if (e > mx) mx = e;
        } else {
          if (e !== 0) e = 0xffff;
          U[dst + i] = (U[dst + i] | e) >>> 0;
          e = 0;
        }
        if (--cnt === 0) { e = 0; cnt = w; }
      }
    }
    var lower = (q: number): void => {              // the "only if shorter" update of passes 4, 2 and 1
      if (U[src + q] !== key) {
        if (++e > 0xff) e = 0xff;
        v = U[dst + q] & 0xffff;
        if (e < v) { U[dst + q] = ((U[dst + q] & 0xffff0000) | e) >>> 0; if (e > mx) mx = e; }
      } else {
        if (e !== 0) e = 0xffff;
        U[dst + q] = (U[dst + q] | e) >>> 0;
        e = 0;
      }
    };
    s[0xd8dc >> 2] = w;
    if (md & 4) {
      e = 0; cnt = w;
      for (i = (n >>> 0) - 1; i >= 0; i--) {
        lower(i);
        if (--cnt === 0) { e = 0; cnt = w; }
      }
    }
    s[0xd3f4 >> 2] = h; s[0xd8d8 >> 2] = h; s[0xd8dc >> 2] = w << 2;
    if (md & 2) {
      e = 0;
      for (c = 0; c < w; c++) {
        for (r = 0, d = c; r < h; r++, d += w) lower(d);
        e = 0;
      }
    }
    s[0xd3f8 >> 2] = w; s[0xd3f4 >> 2] = h; s[0xd8d8 >> 2] = h; s[0xd8dc >> 2] = w << 2;
    if (md & 1) {
      e = 0;
      for (c = 0; c < w; c++) {
        for (r = 0, d = (n >>> 0) - 1 - c; r < h; r++, d -= w) lower(d);
        e = 0;
      }
    }
    s[0xd4e4 >> 2] = mx;
    s[L(k, 0x3ce0)] = mx;
  }

  /** vt+0xc8 0x1000d1c0: every key-coloured pixel takes the nearest opaque one a square spiral finds within
   *  L 0x3be4 steps (vt+0x1dc), its alpha raised by L 0x3c80 less the ring's number times L 0x3c94. */
  melt(): void {
    var m = this.m, s = m.I, U = m.U, k = s[0xd35c >> 2];
    s[0xd968 >> 2] = s[L(k, 0x3be4)] < 0 ? -s[L(k, 0x3be4)] | 0 : s[L(k, 0x3be4)];
    if (s[L(k, 0x3c80)] > 0xff) s[L(k, 0x3c80)] = 0xff;
    s[0xd9dc >> 2] = s[L(k, 0x3b80)];
    var n = Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]);
    s[0xdadc >> 2] = n;
    s[0xd264 >> 2] = s[0xd248 >> 2];
    s[0xd298 >> 2] = s[0xd270 >> 2];
    s[0xd2b0 >> 2] = s[0xd270 >> 2];
    s[0xd2ac >> 2] = (s[0xd270 >> 2] + n * 4) | 0;
    var key = s[0xda0c >> 2] >>> 0, i = 0;
    do {
      s[0xd498 >> 2] = i;
      var p = U[s[0xd298 >> 2] >> 2];
      s[0xd848 >> 2] = p;
      if (p === key) {
        this.spiralSearch();                        // vt+0x1dc 0x1000d490
        if ((s[0xd848 >> 2] >>> 0) !== key && s[L(k, 0x3c80)] !== 0) {
          var a = (s[L(k, 0x3c80)] - Math.imul(s[0xd2d8 >> 2], s[L(k, 0x3c94)])) | 0;
          if (a > 0xff) a = 0xff;
          s[0xda74 >> 2] = a;
          var t = (s[0xd848 >> 2] >>> 0) + bswap(a);
          s[0xd848 >> 2] = t > 0xffffffff ? ((t >>> 0) | 0xff000000) : t | 0;
        }
      }
      U[s[0xd264 >> 2] >> 2] = s[0xd848 >> 2];
      s[0xd264 >> 2] += 4;
      s[0xd298 >> 2] += 4;
      i++;
    } while (i < n);
    s[0xd498 >> 2] = i;
  }

  /** vt+0x1dc 0x1000d490: a square spiral out from the current pixel (right, up, left, down; arms 1, 1, 2, 2,
   *  3, 3, ...; rows clamp at the image's sides) for L 0x3be4 steps; the first pixel that is not the colour key
   *  goes to obj+0xd848. obj+0xd2d8 = the arm length reached. */
  spiralSearch(): void {
    var s = this.m.I, U = this.m.U, k = s[0xd35c >> 2];
    var base = s[0xd2b0 >> 2] >>> 0, w = s[L(k, 0x3b80)], key = s[0xda0c >> 2] >>> 0, p: number;
    s[0xd33c >> 2] = s[0xd298 >> 2];
    s[0xd358 >> 2] = 0;
    s[0xd2d8 >> 2] = 1; s[0xd354 >> 2] = 1; s[0xd864 >> 2] = 1;
    var rowOf = (): void => {
      var row = (((s[0xd33c >> 2] - base) >> 2) / w) | 0;
      s[0xd2a0 >> 2] = (base + Math.imul(row, w) * 4) | 0;
      s[0xd2a4 >> 2] = (s[0xd2a0 >> 2] + w * 4) | 0;
    };
    rowOf();
    s[0xdae4 >> 2] = s[L(k, 0x3be4)] + 1;
    s[0xd4bc >> 2] = 1;
    for (;;) {
      var dir = s[0xd358 >> 2] >>> 0;
      if (dir <= 3) {
        p = s[0xd33c >> 2] >>> 0;
        if (dir === 0) { p = (p + 4) >>> 0; s[0xd33c >> 2] = p; if (p >= (s[0xd2a4 >> 2] >>> 0)) return; }
        else if (dir === 1) { p = (p - w * 4) >>> 0; s[0xd33c >> 2] = p; if (p <= base) return; }
        else if (dir === 2) { p = (p - 4) >>> 0; s[0xd33c >> 2] = p; if (p <= (s[0xd2a0 >> 2] >>> 0)) return; }
        else { p = (p + w * 4) >>> 0; s[0xd33c >> 2] = p; if (p >= (s[0xd2ac >> 2] >>> 0)) return; }
        if (U[p >> 2] !== key) { s[0xd848 >> 2] = U[p >> 2]; return; }
      }
      if (--s[0xd864 >> 2] <= 0) {
        var nd = dir + 1;
        if (nd >= 4) nd = 0;
        s[0xd358 >> 2] = nd;
        if (nd === 2 || nd === 0) rowOf();
        if (s[0xd354 >> 2] === 0) {
          var a = s[0xd2d8 >> 2] + 1;
          s[0xd2d8 >> 2] = a; s[0xd354 >> 2] = a; s[0xd864 >> 2] = a;
        } else {
          s[0xd864 >> 2] = s[0xd354 >> 2];
          s[0xd354 >> 2] = 0;
        }
      }
      if (++s[0xd4bc >> 2] >= s[0xdae4 >> 2]) return;
    }
  }
  /** vt+0x138 0x10006640: per pixel by its alpha byte: 0 = copy, 255 = keep the canvas, else src*(1-a)+dst*a
   *  (+ the layer's two biases), optionally pulled toward a tint (L 0x3ca0, colours L 0x3bcc/0x3bd0/0x3bd4);
   *  the result keeps the source's alpha byte on top. L 0x3cd8 picks the subtract (vt+0x244) variant. */
  blend(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0xd35c >> 2];
    if (s[L(k, 0x3cd8)] === 1) { this.fade(); return; }   // vt+0x244 0x10006bf0
    if (s[L(k, 0x3cd8)] === 2) unported(0x10006ce0);
    s[0xd2f4 >> 2] = s[0xd2f0 >> 2] << 2;
    s[0xd8f8 >> 2] = s[0xd404 >> 2];
    s[0xd8ec >> 2] = s[0xd400 >> 2];
    F[0xd8d0 >> 2] = s[L(k, 0x3c00)] / 255;
    F[0xd8d4 >> 2] = s[L(k, 0x3c04)] / 255;
    F[0xd8e0 >> 2] = s[L(k, 0x3ca0)] / 255;
    s[0xda6c >> 2] = s[L(k, 0x3bcc)];
    s[0xda68 >> 2] = s[L(k, 0x3bd0)];
    s[0xda60 >> 2] = s[L(k, 0x3bd4)];
    var d = (Math.imul((s[0xd878 >> 2] + s[0xd400 >> 2] - s[0xdb38 >> 2] - 1) | 0, s[0xd2f0 >> 2] << 2) +
             ((s[0xd870 >> 2] - s[0xdb24 >> 2]) << 2) + s[0xd24c >> 2]) | 0;
    var a = s[0xd270 >> 2], w = s[0xd404 >> 2], key = s[0xda0c >> 2] >>> 0, back = (w * 4 + s[0xd2f4 >> 2]) | 0;
    var tint = s[L(k, 0x3ca0)] !== 0, tr = s[0xda6c >> 2], tb = s[0xda60 >> 2], tg = s[0xda68 >> 2];
    var b1 = F[0xd8d0 >> 2], b2 = F[0xd8d4 >> 2], kt = F[0xd8e0 >> 2], rows = s[0xd400 >> 2], skip = s[0xdb1c >> 2];
    var last = -1, lq = 0, f608 = 0, f60c = 0, r = 0, g = 0, b = 0;
    do {
      var n = w;
      do {
        var p = U[a >> 2];
        if (p !== key) {
          var al = (p & 0xff000000) >>> 0;
          if (al === 0) U[d >> 2] = p;
          else if (al !== 0xff000000) {
            var q = U[d >> 2];
            f608 = fr((p >>> 24) / 255);
            f60c = fr(1 - f608);
            f608 = fr(f608 + b1);
            f60c = fr(f60c + b2);
            r = ftol(((p >>> 16) & 0xff) * f60c + ((q >>> 16) & 0xff) * f608);
            b = ftol((p & 0xff) * f60c + (q & 0xff) * f608);
            g = ftol(((p >>> 8) & 0xff) * f60c + ((q >>> 8) & 0xff) * f608);
            if (tint) {
              if (tr !== 0) r = (r + ftol((tr - r) * kt * f608)) | 0;
              if (tb !== 0) b = (b + ftol((tb - b) * kt * f608)) | 0;
              if (tg !== 0) g = (g + ftol((tg - g) * kt * f608)) | 0;
              if (r > 0xff) r = 0xff;
              if (b > 0xff) b = 0xff;
              if (g > 0xff) g = 0xff;
            }
            if (r < 0) r = 0;
            if (b < 0) b = 0;
            if (g < 0) g = 0;
            U[d >> 2] = ((r << 16 | g << 8 | b) | al) >>> 0;
            last = p; lq = q;
          }
        }
        a += 4; d += 4;
      } while (--n !== 0);
      d = (d - back) | 0;
      a = (a + skip) | 0;
    } while (--rows !== 0);
    s[0xd8f8 >> 2] = w;
    s[0xd8ec >> 2] = 0;
    if (last !== -1) {                              // the per-pixel fields as the last blended pixel left them
      s[0xda74 >> 2] = last >>> 24; s[0xda78 >> 2] = (last & 0xff000000) | 0;
      s[0xd780 >> 2] = lq & 0xff; s[0xd7b4 >> 2] = (lq >>> 8) & 0xff; s[0xd7bc >> 2] = (lq >>> 16) & 0xff;
      F[0xd608 >> 2] = f608; F[0xd60c >> 2] = f60c;
      s[0xd9e0 >> 2] = r; s[0xd838 >> 2] = b; s[0xd948 >> 2] = g;
    }
  }

  /** vt+0x244 0x10006bf0: subtract the alpha byte from each channel (saturating, keeping the alpha byte); 255 =
   *  keep the canvas. */
  fade(): void {
    var m = this.m, s = m.I, U = m.U;
    s[0xd8f8 >> 2] = s[0xd404 >> 2];
    s[0xd2f4 >> 2] = (s[0xd2f0 >> 2] + s[0xd404 >> 2]) << 2;
    s[0xd8ec >> 2] = s[0xd400 >> 2];
    var di = (Math.imul((s[0xd878 >> 2] + s[0xd400 >> 2] - s[0xdb38 >> 2] - 1) | 0, s[0xd2f0 >> 2] << 2) +
              ((s[0xd870 >> 2] - s[0xdb24 >> 2]) << 2) + s[0xd24c >> 2]) >> 2;
    var si = s[0xd270 >> 2] >> 2, key = s[0xda0c >> 2] >>> 0, w = s[0xd404 >> 2], up = s[0xd2f4 >> 2] >> 2;
    do {
      for (var i = 0; i < w; i++) {
        var px = U[si++];
        if (px !== key) {
          var a = px >>> 24;
          if (a === 0) U[di] = px;
          else if (a !== 0xff) {
            var r = ((px >>> 16) & 0xff) - a, g = ((px >>> 8) & 0xff) - a, bl = (px & 0xff) - a;
            U[di] = ((r < 0 ? 0 : r) << 16 | (g < 0 ? 0 : g) << 8 | (bl < 0 ? 0 : bl) | (a << 24)) >>> 0;
          }
        }
        di++;
      }
      di -= up;
    } while (--s[0xd8ec >> 2] !== 0);
  }

  /** vt+0x134 0x10006de0: the layer faded onto the canvas: out = src * (1 - a) + dst * a per channel, a =
   *  T 0xb90 / 255 (plus the layer's two biases, L 0x3c00 / 0x3c04 / 255), each truncated and clamped
   *  (unsigned: a negative one is 255); the result's top byte is its red. a >= 255 draws nothing. */
  fadeDraw(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0xd35c >> 2];
    if (F[T(k, 0xb90)] < 0) F[T(k, 0xb90)] = 0;
    if (!(F[T(k, 0xb90)] < 255)) { F[T(k, 0xb90)] = 255; return; }
    s[0xd2f4 >> 2] = s[0xd2f0 >> 2] << 2;
    s[0xda74 >> 2] = ftol(F[T(k, 0xb90)]);
    s[0xd8f8 >> 2] = s[0xd404 >> 2];
    s[0xd8ec >> 2] = s[0xd400 >> 2];
    F[0xd8d0 >> 2] = s[L(k, 0x3c00)] / 255;
    F[0xd8d4 >> 2] = s[L(k, 0x3c04)] / 255;
    F[0xd608 >> 2] = s[0xda74 >> 2] / 255;
    F[0xd60c >> 2] = 1 - F[0xd608 >> 2];
    F[0xd608 >> 2] = F[0xd608 >> 2] + F[0xd8d0 >> 2];
    F[0xd60c >> 2] = F[0xd60c >> 2] + F[0xd8d4 >> 2];
    var fs = F[0xd60c >> 2], fd = F[0xd608 >> 2], key = s[0xda0c >> 2] >>> 0;
    var d = (Math.imul((s[0xd878 >> 2] + s[0xd400 >> 2] - s[0xdb38 >> 2] - 1) | 0, s[0xd2f0 >> 2] << 2) +
             ((s[0xd870 >> 2] - s[0xdb24 >> 2]) << 2) + s[0xd24c >> 2]) | 0;
    var a = s[0xd270 >> 2], w = s[0xd404 >> 2], back = (w * 4 + s[0xd2f4 >> 2]) | 0;
    var rows = s[0xd400 >> 2], r = 0, g = 0, b = 0, q = 0, seen = false;
    do {
      var n = w;
      do {
        var p = U[a >> 2];
        if (p !== key) {
          q = U[d >> 2];
          r = ftol(((p >>> 16) & 0xff) * fs + ((q >>> 16) & 0xff) * fd);
          b = ftol((p & 0xff) * fs + (q & 0xff) * fd);
          g = ftol(((p >>> 8) & 0xff) * fs + ((q >>> 8) & 0xff) * fd);
          seen = true;
          if (r < 0) s[0xd92c >> 2] = 0;            // (the DLL clears unrelated fields here)
          if (b < 0) s[0xd908 >> 2] = 0;
          if (g < 0) s[0xd91c >> 2] = 0;
          var r8 = (r >>> 0) > 0xff ? 0xff : r, b8 = (b >>> 0) > 0xff ? 0xff : b, g8 = (g >>> 0) > 0xff ? 0xff : g;
          U[d >> 2] = (r8 << 24 | r8 << 16 | g8 << 8 | b8) >>> 0;
        }
        a += 4; d += 4;
      } while (--n !== 0);
      d = (d - back) | 0;
    } while (--rows !== 0);
    if (seen) {                                     // the per-pixel fields as the last blended pixel left them
      s[0xd9e0 >> 2] = r; s[0xd838 >> 2] = b; s[0xd948 >> 2] = g;
      s[0xd780 >> 2] = q & 0xff; s[0xd7b4 >> 2] = (q >>> 8) & 0xff; s[0xd7bc >> 2] = (q >>> 16) & 0xff;
    }
    s[0xd8f8 >> 2] = w;
    s[0xd8ec >> 2] = 0;
  }

  /** vt+0x188 0x10019de0: Transparency. A new picture (obj+0x224) fades in over 100..360 degrees of a cosine
   *  (T 0xb4c, 15 degrees a frame), state 2; once the picture has shown its time the fade runs from 180 (state
   *  1) and ends at 100 or past 230 of opacity. T 0xb90 = (cos + 1) * 255 is the fade fadeDraw reads. */
  transparency(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2], a: number;
    if (s[0x224 >> 2] === 1) {
      s[0x224 >> 2] = 0;
      F[T(k, 0xb50)] = 15; F[T(k, 0xba4)] = 15; F[T(k, 0xb4c)] = 100;
      s[0xdaec >> 2] = 2;
      return;
    }
    if (s[0x220 >> 2] === s[0xab4 >> 2]) {
      F[T(k, 0xb90)] = 0;
      s[0xdaec >> 2] = 1;
      F[T(k, 0xb50)] = 15; F[T(k, 0xba4)] = 15; F[T(k, 0xb4c)] = 180;
      return;
    }
    if (s[0xdaec >> 2] === 1) {
      a = ftol(F[T(k, 0xb4c)]);
      F[T(k, 0xb90)] = (F[(0xc65c >> 2) + a] + 1) * 255;
      if (ftol(F[T(k, 0xb4c)]) < 0x64 || F[T(k, 0xb90)] > 230) {
        F[T(k, 0xb90)] = 255;
        s[0xdaec >> 2] = 0;
      }
      return;
    }
    if (s[0xdaec >> 2] === 2) {
      a = ftol(F[T(k, 0xb4c)]);
      F[T(k, 0xb90)] = (F[(0xc65c >> 2) + a] + 1) * 255;
      if (ftol(F[T(k, 0xb4c)]) > 0xb4) {
        F[T(k, 0xb90)] = 0;
        s[0xd678 >> 2] = 0;
        s[0xdaec >> 2] = 0;
      }
    }
  }
  /** vt+0x198 0x1001a020: Zoom. Transparency's fade, and both axes scaled by cos of L 0x3c18 / 0x3c1c =
   *  (cos(T 0xb4c) + 1) * 90 degrees (the warp's spin kernel), so the picture grows out of / shrinks into
   *  its centre. */
  zoom(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2];
    if (s[0x224 >> 2] === 1) {
      s[0x224 >> 2] = 0;
      F[T(k, 0xb50)] = 15; F[T(k, 0xba4)] = 15; F[T(k, 0xb4c)] = 100;
      s[0xdaec >> 2] = 2;
      return;
    }
    if (s[0x220 >> 2] === s[0xab4 >> 2]) {
      F[T(k, 0xb90)] = 0;
      s[0xdaec >> 2] = 1;
      F[T(k, 0xb50)] = 15; F[T(k, 0xba4)] = 15; F[T(k, 0xb4c)] = 180;
      return;
    }
    var st = s[0xdaec >> 2];
    if (st !== 1 && st !== 2) return;
    var c = (): number => F[(0xc65c >> 2) + ftol(F[T(k, 0xb4c)])];
    F[T(k, 0xb90)] = (c() + 1) * 255;
    s[L(k, 0x3c18)] = ftol((c() + 1) * 90);
    s[L(k, 0x3c1c)] = ftol((c() + 1) * 90);
    if (st === 1) {
      if (ftol(F[T(k, 0xb4c)]) < 0x64 || F[T(k, 0xb90)] > 230) {
        F[T(k, 0xb90)] = 255;
        s[L(k, 0x3c18)] = 0x5a; s[L(k, 0x3c1c)] = 0x5a; s[L(k, 0x3e04)] = 0x5a; s[L(k, 0x3e08)] = 0x5a;
        s[0xdaec >> 2] = 0;
      }
      return;
    }
    if (ftol(F[T(k, 0xb4c)]) > 0x96) {
      F[T(k, 0xb90)] = 0;
      s[0xd678 >> 2] = 0;
      s[L(k, 0x3c18)] = 0; s[L(k, 0x3c1c)] = 0; s[L(k, 0x3e04)] = 0; s[L(k, 0x3e08)] = 0;
      s[0xdaec >> 2] = 0;
    }
  }
  /** vt+0x190 0x1001a430: Squirt. A random drift (vt+0x1a4), the radial pull (T 0xb5c = 10000, the y factor
   *  T 0xb68 = (cos(T 0xb4c) + 1) * 5), the melt (L 0x3be4 steps) and an edge fade (width L 0x3bdc = (cos + 1)
   *  * the picture's width, alpha L 0x3bd8 = (cos + 1) * 600). Fading out ends once fewer than a fifth of the
   *  pixels are left. */
  squirt(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0xd35c >> 2];
    var cosOf = (o: number): number => F[(0xc65c >> 2) + ftol(F[T(k, o)])];
    if (s[0x224 >> 2] === 1 || s[0x220 >> 2] === s[0xab4 >> 2]) {
      if (s[0x224 >> 2] === 1) {
        s[0x224 >> 2] = 0;
        s[0xdaec >> 2] = 2;
        F[T(k, 0xb90)] = 0;
        F[T(k, 0xb5c)] = 10000; F[T(k, 0xb74)] = 1;
        s[L(k, 0x3be4)] = 0x1b;
        F[T(k, 0xb50)] = 15; F[T(k, 0xba4)] = 15; F[T(k, 0xb4c)] = 90;
        s[L(k, 0x3bdc)] = (s[L(k, 0x3b80)] / 3) | 0;
      } else {
        s[0xdaec >> 2] = 1;
        F[T(k, 0xb5c)] = 10000; F[T(k, 0xb74)] = 1;
        s[L(k, 0x3be4)] = 0x1c;
        F[T(k, 0xb50)] = 10; F[T(k, 0xba4)] = 10; F[T(k, 0xb4c)] = 180;
        s[L(k, 0x3bdc)] = 0;
      }
      s[L(k, 0x3bd8)] = 0xd7;
      this.drift();
      return;
    }
    var st = s[0xdaec >> 2];
    if (st !== 1 && st !== 2) return;
    F[T(k, 0xb68)] = (cosOf(0xb4c) + 1) * 5;
    s[L(k, 0x3bdc)] = ftol((cosOf(0xb4c) + 1) * s[L(k, 0x3b80)]);
    s[L(k, 0x3bd8)] = ftol((cosOf(0xb4c) + 1) * 600);
    this.maskImage();                               // vt+0x98 0x10004e40
    s = m.I; F = m.F;
    s[L(k, 0x3b08)] = 3;
    s[L(k, 0x3c9c)] = 0;
    if (st === 2) {
      if (ftol(F[T(k, 0xb4c)]) > 0x96) {
        s[0xd678 >> 2] = 0;
        this.resetLayer();
        m.I[0xdaec >> 2] = 0;
      }
      return;
    }
    if (F[T(k, 0xb68)] > 3) F[T(k, 0xb74)] = F[T(k, 0xb74)] * 0.5;
    if (ftol(F[T(k, 0xb4c)]) >= 0x64) {
      if (!(F[T(k, 0xb68)] > 1)) return;
      var img = s[L(k, 0x3b20)];
      if (s[L(k, 0x3bb0)] === 1) img = s[L(k, 0x3bb4)];
      if (s[L(k, 0x3bb0)] === 2) img = s[L(k, 0x3c98)];
      var U = m.U, n = Math.imul(s[L(k, 0x3b84)], s[L(k, 0x3b80)]), key = s[L(k, 0x3b70)] >>> 0, c = 0;
      s[0xdadc >> 2] = n;
      for (var i = 0; i < n; i++) if (U[(img >> 2) + i] !== key) c++;
      s[0xd4bc >> 2] = c;
      s[0xd498 >> 2] = n > 0 ? n : 0;
      s[0xd298 >> 2] = img + (n > 0 ? n : 0) * 4;
      if (c >= ((n / 5) | 0)) return;
    }
    s[0xdaec >> 2] = 0;
    s[L(k, 0x3bdc)] = 0;
    s[L(k, 0x3c9c)] = -1;
  }
  /** vt+0x194 0x1001aa30: Twirl. Transparency's fade, and the spin kernel's distance twist T 0xb40 =
   *  -(cos(T 0xb54) + 1) (x squeezed by L 0x3c1c's angle, 2 then 1 degrees). */
  twirl(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2];
    var cosOf = (o: number): number => F[(0xc65c >> 2) + ftol(F[T(k, o)])];
    if (s[0x224 >> 2] === 1) {
      s[0x224 >> 2] = 0;
      s[0xdaec >> 2] = 2;
      s[L(k, 0x3c1c)] = 2;
      F[T(k, 0xb50)] = 15; F[T(k, 0xb58)] = 4; F[T(k, 0xba4)] = 15; F[T(k, 0xb98)] = 4;
      F[T(k, 0xb4c)] = 100; F[T(k, 0xb54)] = 110;
      return;
    }
    if (s[0x220 >> 2] === s[0xab4 >> 2]) {
      s[0xdaec >> 2] = 1;
      F[T(k, 0xb50)] = 0; F[T(k, 0xb58)] = 3; F[T(k, 0xba4)] = 0; F[T(k, 0xb98)] = 3;
      F[T(k, 0xb4c)] = 195; F[T(k, 0xb54)] = 195;
      return;
    }
    var st = s[0xdaec >> 2];
    if (st === 1) {
      s[L(k, 0x3c1c)] = 1;
      F[T(k, 0xb40)] = (cosOf(0xb54) + 1) * -1;
      F[T(k, 0xb90)] = (cosOf(0xb4c) + 1) * 255;
      s[L(k, 0x3b08)] = 3;
      s[L(k, 0x3c9c)] = 0;
      if (F[T(k, 0xb54)] > 230) F[T(k, 0xb50)] = 10;
      if (F[T(k, 0xb90)] > 230 || F[T(k, 0xb54)] < 100) {
        s[L(k, 0x3c9c)] = -1;
        s[0xdaec >> 2] = 0;
      }
      return;
    }
    if (st !== 2) return;
    F[T(k, 0xb40)] = (cosOf(0xb54) + 1) * -1;
    F[T(k, 0xb90)] = (cosOf(0xb4c) + 1) * 255;
    if (F[T(k, 0xb4c)] > 180) { F[T(k, 0xb50)] = 0; F[T(k, 0xb90)] = 0; }
    s[L(k, 0x3b08)] = 3;
    s[L(k, 0x3c9c)] = 0;
    if (F[T(k, 0xb54)] > 165) {
      s[0xd678 >> 2] = 0;
      s[0xdaec >> 2] = 0;
      this.resetLayer();
    }
  }
  /** vt+0x18c 0x1001ae80: Dissolve. The picture's pixels appear (state 2) / vanish (state 1) by brightness: the
   *  threshold L 0x3bec = (cos(T 0xb4c) + 1) * 127.5 and the alpha span L 0x3bf0 = (cos(T 0xb54) + 1) * 350,
   *  two cosines turning at 7 and 15 (or 5) degrees a frame. */
  dissolve(): void {
    var s = this.m.I, F = this.m.F, k = s[0xd35c >> 2];
    if (s[0x224 >> 2] === 1) {
      s[0x224 >> 2] = 0;
      s[0xdaec >> 2] = 2;
      s[L(k, 0x3bf0)] = 0x2bc;
      F[T(k, 0xb50)] = 7; F[T(k, 0xb58)] = 15; F[T(k, 0xba4)] = 7; F[T(k, 0xb98)] = 15;
      F[T(k, 0xb4c)] = 70; F[T(k, 0xb54)] = 10;
      return;
    }
    if (s[0x220 >> 2] === s[0xab4 >> 2]) {
      s[0xdaec >> 2] = 1;
      s[L(k, 0x3bf0)] = 0x2bc;
      F[T(k, 0xb50)] = 7; F[T(k, 0xb58)] = 5; F[T(k, 0xba4)] = 7; F[T(k, 0xb98)] = 5;
      F[T(k, 0xb4c)] = 180; F[T(k, 0xb54)] = 180;
      return;
    }
    var st = s[0xdaec >> 2];
    if (st !== 1 && st !== 2) return;
    s[L(k, 0x3bec)] = ftol((F[(0xc65c >> 2) + ftol(F[T(k, 0xb4c)])] + 1) * 127.5);
    s[L(k, 0x3bf0)] = ftol((F[(0xc65c >> 2) + ftol(F[T(k, 0xb54)])] + 1) * 350);
    if (st === 1) {
      if (F[T(k, 0xb54)] < 100) F[T(k, 0xb54)] = 360;
      s[L(k, 0x3b08)] = 3;
      s[L(k, 0x3c9c)] = 0;
      if (F[T(k, 0xb4c)] > 310 || F[T(k, 0xb4c)] < 100) {
        s[L(k, 0x3c9c)] = -1;
        s[0xdaec >> 2] = 0;
      }
      return;
    }
    if (F[T(k, 0xb54)] > 180) F[T(k, 0xb54)] = 180;
    s[L(k, 0x3b08)] = 3;
    s[L(k, 0x3c9c)] = 0;
    if (F[T(k, 0xb4c)] > 180) {
      s[0xdaec >> 2] = 0;
      s[0xd678 >> 2] = 0;
      this.resetLayer();
    }
  }

  // ---------------------------------------------------------------- first Render
  /** vt+0x1ac 0x10016840: 0x37 layer and transform records zeroed, the defaults. */
  init(): void {
    var s = this.m.I, i: number, k: number;
    s[0xdad4 >> 2] = 0x36;                          // last layer index
    s[0xd504 >> 2] = 0x37;                          // layer count
    for (k = 0; k <= 0x36; k++) {
      for (i = 0; i < 0x7b; i++) s[L(k, 0x3af8) + i] = 0;
      for (i = 0; i < 0x38; i++) s[T(k, 0xad8) + i] = 0;
    }
    s[0xd498 >> 2] = 0x7b; s[0xd4bc >> 2] = 0x38; s[0xd35c >> 2] = 0x37;
    for (i = 0; i < 0x14; i++) s[(0xd1dc >> 2) + i] = 0;
    for (i = 0; i < 0x208; i++) { s[(0xa5dc >> 2) + i] = 0; s[(0xadfc >> 2) + i] = 0; s[(0xb61c >> 2) + i] = 0; }
    for (i = 0; i < 9; i++) s[(0xa4ac >> 2) + i] = 0;
    s[0xd498 >> 2] = 9;
    store(s, INIT1);
    s[0xd634 >> 2] = (s[0xd510 >> 2] / 2) | 0;
    s[0xd638 >> 2] = s[0xd514 >> 2];
    store(s, INIT2);
    s[0x88 >> 2] = this.cfg.tick() | 0;             // timeGetTime()
    s[0x8c >> 2] = 0;
  }

  /** vt+0x150 0x10016d30: the bitmap table of index obj+0xd4e0 (only 10, DATATABLE_11, exists), decoded once
   *  and cached at obj+0xd1dc[index]; obj+0xd288 = it or 0. */
  loadTable(): void {
    var s = this.m.I;
    s[0xd300 >> 2] = 32;                            // GetDeviceCaps(hdc, BITSPIXEL)
    var t = s[(0xd1dc >> 2) + s[0xd4e0 >> 2]];
    s[0xd288 >> 2] = t;
    if (t !== 0 || s[0xd4e0 >> 2] !== 10) return;
    s[0xd530 >> 2] = this.resource();               // FindResource/LoadResource/LockResource "DATATABLE_11"
    this.decodeTable();                             // vt+0x168 0x10005b10
    s = this.m.I;
    s[(0xd1dc >> 2) + s[0xd4e0 >> 2]] = s[0xd530 >> 2];
    s[0xd288 >> 2] = s[0xd530 >> 2];
  }

  /** The resource bytes in the heap: the DLL's own DATATABLE_11 when given (its logo images), else the same
   *  table with only its first two images (2 x 1, black: the placeholders every layer starts with). */
  resource(): number {
    var r = this.res;
    if (!r) {
      r = new Uint8Array(8 + 8 + 2 * 18);
      var v = new DataView(r.buffer);
      v.setUint32(0, 8 + 2 * 16 + 2 * 2 * 4, true);   // the decoded size (header + 2 records), as the DLL's table
      v.setUint32(4, 2, true);
      v.setUint32(8, 16, true); v.setUint32(12, 34, true);
      for (var j = 0; j < 2; j++) { v.setUint32(16 + j * 18, 0x24, true); v.setUint32(20 + j * 18, 2, true); v.setUint32(24 + j * 18, 1, true); }
      this.res = r;
    }
    var p = this.m.malloc(r.length + 4);            // + slack for the 24-bit reads
    this.m.B.set(r, p);
    return p;
  }

  /** vt+0x168 0x10005b10 + vt+0x164 0x10005c60: expand every image of the resource into one block:
   *  {size, count, offsets[]} then per image {type 0x16|0x24, w, h, flags byte, pixels 0x00RRGGBB}. */
  decodeTable(): void {
    var m = this.m, s = m.I, res = s[0xd530 >> 2];
    var n = m.I[(res >> 2) + 1], total = (m.I[res >> 2] + n * 4) | 0;
    s[0xd6f0 >> 2] = total;
    s[0xd508 >> 2] = n;
    var p = m.malloc(total);
    s = m.I;
    var U = m.U, B = m.B;
    s[0xd520 >> 2] = p;
    U[p >> 2] = U[res >> 2];
    U[(p >> 2) + 1] = n;
    var cur = 0;
    for (var i = 1; i <= n; i++) {
      s[0xd34c >> 2] = i;
      if (i === 1) cur = p + n * 4 + 8;
      U[(p >> 2) + 1 + i] = cur - p;
      var src = res + U[(res >> 2) + 1 + i], type = rd32(B, src);
      s[0xd254 >> 2] = src;
      s[0xd844 >> 2] = type;
      var w = rd32(B, src + 4), h = rd32(B, src + 8), cnt: number, c: number, run: number, d = cur >> 2;
      U[d] = (type === 0x16 || type === 0xc16) ? 0x16 : 0x24;
      U[d + 1] = w; U[d + 2] = h; B[cur + 12] = 0;
      s[0xd404 >> 2] = w; s[0xd400 >> 2] = h;
      d += 4;
      cnt = Math.imul(w, h) >>> 0;
      var q = src + 12;
      if (type === 0x16 || type === 0xc16) {
        // 5:5:5 words; 0xffff, colour, run (u32) is a run
        outer16: for (;;) {
          var vv: number;
          while ((vv = B[q] | B[q + 1] << 8) === 0xffff) {
            c = rgb555(B[q + 2] | B[q + 3] << 8);
            U[d++] = c;
            run = ((B[q + 4] | B[q + 5] << 8 | B[q + 6] << 16 | B[q + 7] << 24) - 1) >>> 0;
            q += 8;
            if (--cnt === 0) break outer16;
            do { U[d] = c; if (--cnt === 0) { d++; break outer16; } d++; run = (run - 1) >>> 0; } while (run !== 0);
          }
          U[d++] = rgb555(vv);
          q += 2;
          if (--cnt === 0) break;
        }
      } else if (type === 0x24) {
        do { U[d++] = rd24(B, q); q += 3; } while (--cnt !== 0);
      } else {
        // 8:8:8 triplets; ffffff ffffff, colour, run (24-bit) is a run
        outer24: for (;;) {
          while (rd24(B, q) === 0xffffff && rd24(B, q + 3) === 0xffffff) {
            c = rd24(B, q + 6);
            U[d++] = c;
            run = (rd24(B, q + 9) - 1) >>> 0;
            q += 12;
            if (--cnt === 0) break outer24;
            do { U[d] = c; if (--cnt === 0) { d++; break outer24; } d++; run = (run - 1) >>> 0; } while (run !== 0);
          }
          U[d++] = rd24(B, q);
          q += 3;
          if (--cnt === 0) break;
        }
      }
      cur = d << 2;
      s[0xd250 >> 2] = cur;
    }
    s[0xd34c >> 2] = n + 1;
    s[0xd530 >> 2] = p;
    s[0xd520 >> 2] = 0;
  }

  /** vt+0x154 0x10016de0: canvas strides; every layer starts unused. */
  strides(): void {
    var s = this.m.I;
    s[0xd514 >> 2] = s[0xd6bc >> 2] << 2;
    s[0xd510 >> 2] = s[0xd6b4 >> 2] << 2;
    var k = 0;
    do { s[L(k, 0x3af8)] = -1; k++; } while ((k >>> 0) <= (s[0xdad4 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }

  /** vt+0x158 0x100172e0: sin and cos of whole degrees as float32, x87 FSIN/FCOS of d * (float)0.01745328. */
  trigTables(): void {
    var F = this.m.F, D = fr(0.017453279346227646), o = new Float64Array(4);
    F[0xcbfc >> 2] = 0;
    F[0xc65c >> 2] = 1;
    for (var d = 1; d < 360; d++) {
      sincos87(d * D, o);                           // [sinHi, sinLo, cosHi, cosLo]: the FPU's 64-bit results
      F[(0xcbfc >> 2) + d] = o[0];
      F[(0xc65c >> 2) + d] = o[2];
    }
  }

  /** vt+0x15c 0x10016ef0: the scene every picture starts from (layers 0..5, all on DATATABLE_11's image 1). */
  defaultScene(): void {
    var s = this.m.I, i: number, k: number;
    this.freeAllLayers();                           // vt+0xf8 0x10010ad0
    for (k = 0; (k >>> 0) <= (s[0xdad4 >> 2] >>> 0); k++) {
      for (i = 0; i < 0x7b; i++) s[L(k, 0x3af8) + i] = 0;
      for (i = 0; i < 0x38; i++) s[T(k, 0xad8) + i] = 0;
      s[0xd498 >> 2] = 0x7b; s[0xd4bc >> 2] = 0x38;
    }
    s[0xd35c >> 2] = k;
    store(s, SCENE0);
    for (i = 0; i < 0x208; i++) s[(0xbe3c >> 2) + i] = 0;
    for (i = 0; i < 10; i++) s[(0xa5b4 >> 2) + i] = 0;
    s[0xdafc >> 2] = 10;
    for (k = 0; k < 6; k++) {
      store(s, SCENE_LAYERS[k]);
      this.bindImage();                             // vt+0x14c 0x10002ce0
      s = this.m.I;
    }
  }

  /** vt+0xf8 0x10010ad0: vt+0xf4 for every layer. */
  freeAllLayers(): void {
    var s = this.m.I, k = 0;
    s[0xd35c >> 2] = 0;
    do { s[0xd35c >> 2] = k; this.freeLayer(); s = this.m.I; k++; } while ((k >>> 0) <= (s[0xdad4 >> 2] >>> 0));
    s[0xd35c >> 2] = k;
  }

  /** vt+0xf4 0x10010b10: the current layer's picture (when it owns one) and its three work buffers. */
  freeLayer(): void {
    var m = this.m, s = m.I, k = s[0xd35c >> 2], p: number;
    if (s[L(k, 0x3afc)] === -1 && (p = s[L(k, 0x3b20)]) !== 0) {
      m.release(p - 0xc);
      s[L(k, 0x3afc)] = 0;
      s[L(k, 0x3b20)] = 0;
    }
    s[L(k, 0x3bb0)] = 0;
    if ((p = s[L(k, 0x3bb8)]) !== 0) { m.release(p); s[L(k, 0x3bb8)] = 0; }
    if ((p = s[L(k, 0x3bb4)]) !== 0) { m.release(p); s[L(k, 0x3bb4)] = 0; }
    if ((p = s[L(k, 0x3c98)]) !== 0) { m.release(p); s[L(k, 0x3c98)] = 0; }
  }

  /** vt+0x14c 0x10002ce0: point the current layer at image L(k,0x3b1c) of table L(k,0x3b18); 1 = bound (or it
   *  owns a picture already: L(k,0x3afc) = -1), 0 = no such image (the layer is dropped). */
  bindImage(): number {
    var m = this.m, s = m.I, k = s[0xd35c >> 2];
    if (s[L(k, 0x3afc)] === -1) return 1;
    s[0xd4e0 >> 2] = s[L(k, 0x3b18)];
    this.loadTable();
    s = m.I;
    if (s[0xd288 >> 2] !== 0) {
      var id = s[L(k, 0x3b1c)];
      s[0xd4dc >> 2] = id;
      var t = s[0xd288 >> 2];
      if (id !== 0 && (id >>> 0) <= (m.U[(t >> 2) + 1] >>> 0)) {
        var rec = (m.U[(t >> 2) + 1 + id] + t) | 0;
        s[0xd8e8 >> 2] = rec + 0x10;
        s[0xd844 >> 2] = s[rec >> 2];
        s[0xd86c >> 2] = s[(rec >> 2) + 1];
        s[0xd858 >> 2] = s[(rec >> 2) + 2];
        if (s[L(k, 0x3b80)] !== s[0xd86c >> 2] || s[L(k, 0x3b84)] !== s[0xd858 >> 2]) {
          var p: number;
          if ((p = s[L(k, 0x3bb8)]) !== 0) { m.release(p); s[L(k, 0x3bb8)] = 0; }
          if ((p = s[L(k, 0x3bb4)]) !== 0) { m.release(p); s[L(k, 0x3bb4)] = 0; }
          s[L(k, 0x3bb0)] = 0;
        }
        s[L(k, 0x3b80)] = s[0xd86c >> 2];
        s[L(k, 0x3b84)] = s[0xd858 >> 2];
        s[L(k, 0x3b28)] = s[0xd86c >> 2];
        s[L(k, 0x3b2c)] = s[0xd858 >> 2];
        s[L(k, 0x3b20)] = s[0xd8e8 >> 2];
        return 1;
      }
    }
    s[L(k, 0x3af8)] = -1;
    s[L(k, 0x3b20)] = 0;
    return 0;
  }
}

/** The DDA output count of n source samples at 8.8 scale v (f = 0: v < 0x100, 1: < 0x201, 2: above), as
 *  0x1000eae0 / 0x1000eb20 / 0x1000eb60 count it. */
function scaledCount(n: number, v: number, f: number): number {
  var e = f === 0 ? (0x100 - v) >>> 0 : f === 1 ? (0x200 - v) >>> 0 : ((0x2ff - v + 1) >>> 0);
  if (f === 2 && e > 0xff) e = 0;
  var step = bswap(e), acc = 0, out = f === 2 ? 2 : 1, t: number;
  n = n >>> 0;
  for (;;) {
    if (--n === 0) return out;                      // (n == 0 on entry wraps, as the asm's DEC/JZ would)
    t = acc + step; acc = t >>> 0;
    if (t > 0xffffffff) { if (f !== 0) out += f === 2 ? 2 : 1; continue; }
    out += f === 0 ? 1 : f === 1 ? 2 : 3;
  }
}

function store(s: Int32Array, t: readonly number[]): void {
  for (var i = 0; i < t.length; i += 2) s[t[i] >> 2] = t[i + 1];
}
function rd24(b: Uint8Array, q: number): number { return b[q] | b[q + 1] << 8 | b[q + 2] << 16; }
function rd32(b: Uint8Array, q: number): number { return b[q] | b[q + 1] << 8 | b[q + 2] << 16 | b[q + 3] << 24; }

const E_FAIL = 0x80004005 | 0;

// ---- presetStep 0x10017440: a transition's first call (0x3af8 and the transition's own extras aside)
const FIRST_CALL = [
  0xd504, 8, 0xdb10, 0, 0xdb14, 0, 0xdb18, 0, 0xdb0c, 0, 0xd37c, 8, 0xd370, 0x28, 0xd374, 5,
  0xd380, 0xae, 0xd384, 0, 0xd378, 0, 0xd388, 0, 0xd43c, 0, 0x3c9c, -1, 0x3e88, -1, 0x3ce4, -1,
  0x4074, -1, 0x3ed0, -1, 0x4260, -1, 0x40bc, -1, 0x444c, 0, 0x42a8, 2, 0x4638, -1, 0x4494, -1,
  0x4824, -1, 0x4680, -1, 0x4a10, -1, 0x486c, 2, 0x3d04, 0xa, 0x3d08, 4, 0x3d60, 4, 0x3d64, 0xe,
  0x3d80, 7, 0xc30, 0x3f800000,
];
const FIRST_CALL_END = [
  0x224, 0, 0xdaec, 0, 0x230, 0, 0x488c, 0xa, 0x4890, 3, 0x48e8, 4, 0x48ec, 0x3e8, 0x4908, 0x3e8,
  0x487c, 3, 0x228, 1,
];

// ---- init 0x10016840's constant stores, in order (the loop counters it leaves behind included)
const INIT1 = [
  0xd19c, 0x11, 0xd1a0, 0x34, 0xd1a4, 0x82, 0xd1a8, 0x87, 0xd1ac, 0xc0, 0xd1b0, 0xc5,
  0xd1b4, 0xe1, 0xd1b8, 0xe6, 0xd1bc, 0xed, 0xd1c0, 0x9a, 0xd1c4, 0xec, 0xd1c8, 0x9a, 0xd1cc, 0x93, 0xd1d0, 0,
  0xd1d4, 0xd8, 0xd1d8, 0xfe, 0xd23c, 0, 0xd278, 0, 0xd288, 0, 0xd2c4, 0, 0xd2c8, 0, 0xd2e8, 0xffffff,
  0xd2d8, 1, 0xd304, 0, 0xd308, 0, 0xd30c, 0, 0xd338, 0, 0xd348, 0xff, 0xd340, 0, 0xd344, 0,
  0xd354, 1, 0xd358, 0, 0xd35c, 0, 0xd370, 0, 0xd374, 0, 0xd378, 0, 0xd37c, 0, 0xd380, 0xff,
  0xd384, 0, 0xd388, 0, 0xd38c, 0, 0xd390, 1, 0xd39c, 0, 0xd3ac, 0, 0xd3b4, 0, 0xd410, 0,
  0xfc, 0, 0xd428, 0, 0xd42c, 0, 0xd43c, 0, 0xd430, 1, 0xd434, 0, 0xd450, 1, 0xd448, 0,
  0xd470, 0x190, 0xd4b4, 0, 0xd4b0, 0, 0xd4b8, 0, 0xd4c8, 0, 0xd4cc, 0, 0xd4d0, 5, 0xd4d8, 2,
  0xd4e0, 0, 0xd50c, 0x13, 0xd518, 0x578, 0xd51c, 0x578, 0xd524, 0, 0xd528, 0, 0xd52c, 0, 0xd530, 0,
  0xd534, 0, 0xd544, 0, 0xd548, 0x15e, 0xd54c, 0x140, 0xd550, 0, 0xd564, 0, 0xd590, 0, 0xd598, 1,
  0xd5a0, 7, 0xd5ac, 0, 0xd5b0, 0, 0xd5b4, 0, 0xd5bc, 0,
];
const INIT2 = [
  0xd6a8, 0, 0xd6ac, 0, 0xd710, 0,
  0xd6c0, 3, 0xd6c4, 0, 0xd6c8, 0, 0xd6cc, 0, 0xd6f4, 0x100, 0xd6f8, 0x100, 0xd704, 0, 0xd70c, 0x14,
  0xd71c, 0, 0xd864, 1, 0xd78c, 0, 0xd790, 0, 0xd794, 0, 0xd798, 0, 0xd7d4, 0, 0xd7d8, 0,
  0xd7dc, 0, 0xd7f0, 0, 0xd7ec, 0, 0xd7f4, 0, 0xd888, 0, 0xd8f0, 0, 0xd8f4, 0, 0xdab8, 0,
  0xdab4, 0, 0xdabc, 0, 0xdb00, 0, 0xdb04, 0, 0xdb08, 0, 0xdb44, 0, 0x84, 0,
];
// ---- defaultScene 0x10016ef0: the globals, then per layer 0..5 its fields (each followed by bindImage)
const SCENE0 = [
  0xdb0c, 0x5a, 0xdb00, 0, 0xdb10, 0x17d8, 0xdb14, 0x1989, 0xdb18, -0x13e,
  0xd380, 0xff, 0xd374, 0, 0xd378, 0, 0xd888, 0, 0xd370, 0, 0xd37c, 0, 0xd384, 0, 0xd388, 0,
];
const SCENE_LAYERS = [
  [0x3c9c, 0, 0x3af8, 2, 0x3b88, 0x479, 0x3b74, 0x453, 0x3b78, -0x1da, 0x3b94, 0,
    0x3b18, 0xa, 0x3b1c, 1, 0x3b70, 0, 0x3cd8, 1, 0x3b08, 2, 0xd35c, 0],
  [0x3ce4, 2, 0x3d74, 0x58c, 0x3d60, 0x522, 0x3d64, -0x191, 0x3d80, 0, 0x3d04, 0xa, 0x3d08, 1, 0x3d5c, -0x1, 0x3cf4, 2, 0xd35c, 1],
  [0x3ed0, 2, 0x4074, 0, 0x3f60, 0x58c, 0x3f4c, 0x453, 0x3f50, -0x1db, 0x3f6c, 0, 0x3ef0, 0xa, 0x3ef4, 1,
    0x3f48, -0x1, 0xd70, 0x40000000, 0x40b0, 1, 0xd1c, 0x43960000, 0xd40, 0x3f800000, 0xd44, 0x3f000000, 0x40a8, 2, 0x3ee0, 2,
    0xd35c, 2],
  [0xd35c, 3, 0x40bc, 2, 0x414c, 0x58c, 0x4138, 0x524, 0x413c, -0x191, 0x4158, 0, 0x40dc, 0xa,
    0x40e0, 1, 0x4134, 0, 0x429c, 1, 0x4260, -0x1, 0x40cc, 2],
  [0x4320, 0, 0xd35c, 4, 0x42a8, 2,
    0x4338, 0x58c, 0x4324, 0x524, 0x4328, -0x191, 0x4344, 0xa, 0x42c8, 0xa, 0x42cc, 1, 0x444c, -0x1, 0x42b8, 2],
  [0xd35c, 5, 0x4494, 2, 0x4524, 0x58c, 0x4510, 0x4f5, 0x4514, 0x35, 0x4530, -0x2e, 0x44b4, 0xa, 0x44b8, 1,
    0x450c, -0x1, 0x4638, -0x1, 0x44a4, 2],
];
