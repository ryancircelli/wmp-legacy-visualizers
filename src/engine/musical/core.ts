// Musical Colors (WMP 7.0 / 7.1 / 8 wmpvis.dll, class "WMPVis"): the engine.
//
// The DLL is one C++ object (0x4f34 bytes) whose ~120 virtual methods share all of their state through
// that object, hand pointers to its own fields around (spectrum buffers, scratch cursors) and walk
// malloc'd pixel buffers with pointer arithmetic. So the port keeps the same shape: one flat little-endian
// heap (`Mem`) whose first 0x4f34 bytes ARE the object (address 0), malloc'd buffers after it, and every
// "pointer" a byte address into that heap. Fields are named by their byte offset in the object (the
// numbers the asm uses), e.g. `s[0x4540 >> 2]`; a layer record (8 of them, 0x1ec bytes from 0x76c) or a
// transform record (8, 0xe0 bytes from 0x6c) is addressed by its base plus the field offset of layer 0.
// VAs are WMP 7.1's (image base 0x55c00000); 7.0 is the same code, address for address. WMP 8 / 8 SP1
// (base 0x590d0000, the same code as each other) differ in a few places, marked `v8` below.
//
// Arithmetic: the x87 runs at 53-bit precision (control word 0x027F in the host process), so every
// FMUL/FDIV/FADD is a JS double operation; `FSTP float` is Math.fround; MSVC's _ftol (0x55c15c90) is
// ftol() below (truncate, low 32 bits). The only transcendental use is the sin/cos tables (0x55c15ab4).
import { A } from '../ns';
import '../rand';
import { musicalImages } from './images';

const fr = Math.fround;
/** MSVC _ftol: truncate toward zero to int64, return the low 32 bits (0 for NaN/out of range). */
export function ftol(x: number): number {
  return x > -9.2e18 && x < 9.2e18 ? (x % 4294967296) | 0 : 0;
}
/** x86 BSWAP. */
function bswap(x: number): number {
  return ((x & 0xff) << 24 | (x & 0xff00) << 8 | (x >>> 8) & 0xff00 | x >>> 24) >>> 0;
}

export const OBJ_SIZE = 0x4f34;
/** the dword after a work buffer: a Windows heap block header (see allocWork), as one real run had it */
const HEAP_NEXT = 0x115c8962;
const HEAP0 = 0x5000;            // first malloc'd byte; everything below is the object

/** The flat heap: the object at 0, then malloc'd blocks. Freed blocks are reused by exact size. */
class Mem {
  declare buf: ArrayBuffer;
  declare I: Int32Array;
  declare U: Uint32Array;
  declare F: Float32Array;
  declare B: Uint8Array;
  declare H: Uint16Array;
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
    this.H = new Uint16Array(buf);
  }
  malloc(n: number): number {
    n = (n + 15) & ~15;
    if (n <= 0) n = 16;
    var l = this.free.get(n);
    if (l && l.length) return l.pop()!;
    var p = this.top;
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

// ---------------------------------------------------------------- record layout
/** layer k's base (int index): 8 records of 0x7b ints from obj+0x76c */
export function LY(k: number): number { return 0x1db + k * 0x7b; }
/** transform record k's base (int index): 8 records of 0x38 ints from obj+0x6c */
export function XF(k: number): number { return 0x1b + k * 0x38; }
/** layer field: byte offset as layer 0 has it (0x76c..0x957) -> int offset in the record */
const lf = (byteOff: number): number => (byteOff - 0x76c) >> 2;
/** transform field: byte offset as record 0 has it (0x6c..0x14b) -> int offset in the record */
const xf = (byteOff: number): number => (byteOff - 0x6c) >> 2;
export { lf, xf };

export class Core {
  declare m: Mem;
  /** host-visible: the DC the DLL draws into (Render's HDC), 0x00RRGGBB, persistent between frames */
  declare dc: Uint32Array;
  declare dcW: number;
  declare dcH: number;
  declare freq: Uint8Array;        // the TimedLevel's freq[0] as Render modifies it in place
  declare rcLeft: number;
  declare rcTop: number;
  /** WMP 8 / 8 SP1's wmpvis.dll (true) or WMP 7.0 / 7.1's (false). Same engine; 8 differs in preset 20
   *  (Ice Crystals instead of WinMe 3D), Star Power's layer 3 and presetStep's background fill. */
  declare v8: boolean;
  /** the DLL's DATATABLE resource when the caller supplies one (exact images); else the generated ones */
  declare res: Uint8Array | null;

  constructor(res?: Uint8Array | null) {
    this.m = new Mem(24 << 20);
    this.freq = new Uint8Array(1024);
    this.dcW = this.dcH = 0;
    this.dc = new Uint32Array(0);
    this.rcLeft = this.rcTop = 0;
    this.v8 = true;
    this.res = null;
    if (res) { this.res = new Uint8Array(res.length + 4); this.res.set(res); }   // + slack for the 24-bit reads
    // CComObject ctor 0x55c0d6f1 zeroes a handful of fields; the rest of the operator-new block is what
    // the heap handed over, and the port takes it as zeros. One read of it shows: clipLayers' "layer 8"
    // reads obj+0x16f8 (never initialised) as its scale and, when that is >= 7, clips and writes spectrum
    // bin 12 (obj+0x1770). Only Ice Crystals, which reuses a held spectrum, then draws differently; the
    // real DLL does so too in the runs where the heap left stale bytes there (zeros = this port).
  }

  // ---------------------------------------------------------------- IWMPEffects
  /** SetCurrentPreset 0x55c0dc3a (this = obj+4): obj+0x47bc = n + 1, obj+0xc = n. */
  setPreset(n: number): boolean {
    if (n < 0 || n > 0x13) return false;
    var s = this.m.I;
    s[0x47bc >> 2] = n + 1;
    s[0xc >> 2] = n;
    return true;
  }

  /** IWMPEffects::Render 0x55c0d71c (WMP 8: 0x590dd8a3). freq0 = the TimedLevel's freq[0] (1024 bytes),
   *  state its play state; the DC is w x h. */
  render(freq0: Uint8Array, w: number, h: number, state: number): void {
    var m = this.m, s = m.I;
    if (w !== this.dcW || h !== this.dcH) {
      var nd = new Uint32Array(w * h);           // a fresh DIB is black
      this.dc = nd; this.dcW = w; this.dcH = h;
    }
    if (this.v8 && (state === 0 || state === 1)) {  // WMP 8: stopped or paused = FillRect(rect, black), nothing moves
      this.dc.fill(0);
      return;
    }
    s[0x4b34 >> 2] = 0;
    if (s[0x455c >> 2] === 0) {
      this.init();                                 // vt+0x1cc 0x55c1510e
      s[0x455c >> 2] = 1;
      s[0x47a0 >> 2] = 0x15e;                      // canvas 350 x 320
      s[0x47a8 >> 2] = 0x140;
      s[0x467c >> 2] = 0x15e;
      s[0x4680 >> 2] = 0x140;
      s[0x47e0 >> 2] = 0x100;                      // scale 1.0 (8.8)
      s[0x47e4 >> 2] = 0x100;
      m.F[0x4470 >> 2] = fr((s[0x47a0 >> 2] / 2) | 0);
      s[0x4618 >> 2] = 0;
      this.loadTable();                            // vt+0x168 0x55c15597
      this.strides();                              // vt+0x16c 0x55c1563d
      this.defaultScene();                         // vt+0x184 0x55c15726
      this.trigTables();                           // vt+0x170 0x55c15ab4
      s[0x45c0 >> 2] = 1;                          // GetForegroundWindow(): never read
    }
    if (this.v8) {                                 // WMP 8 reloads the (cached) table every frame and starts over
      s[0x4618 >> 2] = 0;                          // when that ran out of memory (its flag obj+0x4580; never here)
      this.loadTable();
    }
    s[0x47e8 >> 2] = this.rcLeft;
    s[0x47ec >> 2] = this.rcTop;
    if (s[0x4680 >> 2] !== h || s[0x467c >> 2] !== w) {
      s[0x46cc >> 2] = 1;
      s[0x4770 >> 2] = 0;
      s[0x4680 >> 2] = h;
      s[0x467c >> 2] = w;
    } else s[0x46cc >> 2] = 0;
    if (s[0x4770 >> 2] > 0xf) { s[0x4770 >> 2] = 0; s[0x46cc >> 2] = 1; } else s[0x4770 >> 2]++;
    // freq[0]: each of the first 256 bytes becomes the max of its group of four (in place, as the DLL
    // writes into the host's TimedLevel)
    var fq = this.freq;
    fq.set(freq0.subarray(0, 1024));
    for (var i = 0; i < 0x100; i++) {
      var c = fq[i * 4];
      if (c < fq[i * 4 + 1]) c = fq[i * 4 + 1];
      if (c < fq[i * 4 + 2]) c = fq[i * 4 + 2];
      if (c < fq[i * 4 + 3]) c = fq[i * 4 + 3];
      fq[i] = c;
    }
    s[0x45cc >> 2] = 0x100;
    if (s[0x4c8c >> 2] === 0 || s[0x44c4 >> 2] === 0) this.spectrumIn();
    s[0x4c8c >> 2] = s[0x4c8c >> 2] === 0 ? s[0x44c4 >> 2] : s[0x4c8c >> 2] - 1;
    s[0x4620 >> 2] = 1;                            // the HDC (non-zero = there is one)
    this.frame();                                  // vt+0x1ac 0x55c0d452
  }

  /** Render 0x55c0d8d5..0x55c0daf8: the collapsed spectrum into obj+0x1740[0..254], the level. */
  spectrumIn(): void {
    var s = this.m.I, fq = this.fq();
    s[0x448c >> 2] = 0;
    s[0x4494 >> 2] = 0xff;
    s[0x440c >> 2] = 0;
    var row = s[0x448c >> 2] * 0x208;              // always 0 here
    s[(0x1b3c >> 2) + row] = 0;
    for (var i = 0; i <= 0xfe; i++) {
      s[0x4ee8 >> 2] = i;
      if (s[0x44c8 >> 2] === 2) {
        s[(0x1b3c >> 2) + row - i] = fq[i + 1];      // reversed: [0x1b3c + (row - i)*4]
      } else if (s[0x44d4 >> 2] === 0) {
        s[(0x1740 >> 2) + row + i] = fq[i + 1];
      } else {
        var r = A.rand() & 0xff;
        s[0x4768 >> 2] = r;
        s[(0x1740 >> 2) + row + i] = fq[r];
      }
      s[0x440c >> 2] += fq[i];
    }
    s[0x4ee8 >> 2] = 0xff;
    var lv = (s[0x440c >> 2] / 0x6a) | 0;
    s[0x440c >> 2] = lv > 0xff ? 0xff : lv;
    s[0x4410 >> 2]++;
    if (s[0x4410 >> 2] > 9) s[0x4410 >> 2] = 0;
    s[(0x1718 >> 2) + s[0x4410 >> 2]] = s[0x440c >> 2];
    s[0x4414 >> 2] = 0;
    for (i = 0; i <= 9; i++) s[0x4414 >> 2] += s[(0x1718 >> 2) + i];
    s[0x4ee8 >> 2] = 10;
    s[0x4414 >> 2] = (s[0x4414 >> 2] / 10) | 0;
    if (s[0x44d4 >> 2] === 2) {
      // random runs of 1..16 consecutive bins (0x55c0da3f)
      var n = 0;
      s[0x4ee8 >> 2] = 0;
      for (;;) {
        var r1 = A.rand() & 0xff;
        s[0x4768 >> 2] = r1;
        var len = A.rand() & 0xf;
        s[0x45cc >> 2] = len;
        if (len + r1 >= 0xff) s[0x4768 >> 2] = len;
        s[0x45d0 >> 2] = 0;
        var done = false;
        for (var j = 0; ; j++) {
          s[0x45d0 >> 2] = j;
          var v = fq[s[0x4768 >> 2] + j];
          s[(0x1740 >> 2) + row + n] = v;
          s[0x4c7c >> 2] = v;
          n++;
          s[0x4ee8 >> 2] = n;
          if (n >= 0xff) { done = true; break; }
          if (j + 1 > len) { s[0x45d0 >> 2] = j + 1; break; }
        }
        if (done) break;
      }
    }
    this.spectrumProcess();                        // vt+0x204 0x55c12e65
  }
  fq(): Uint8Array { return this.freq; }

  // ---------------------------------------------------------------- spectrum (vt+0x204 0x55c12e65)
  spectrumProcess(): void {
    this.specMirror();                             // vt+0x1fc 0x55c12ea9
    this.specResample();                           // vt+0x210 0x55c12fcd
    this.specCopyBack();                           // vt+0x20c 0x55c12f48
    this.specOffset();                             // vt+0x200 0x55c13254
    this.specSmooth();                             // vt+0x214 0x55c1315b
    this.specBlend();                              // vt+0x208 0x55c132e6
  }
  /** 0x55c12ea9: modes 1, 3, 4, 5 mirror the 255 bins into a 512-wide buffer at 0x1f60. */
  specMirror(): void {
    var s = this.m.I, md = s[0x44c8 >> 2];
    if (md === 5 || md === 4 || md === 3 || md === 1) {
      for (var i = 0; i < s[0x4494 >> 2]; i++) {
        s[0x45cc >> 2] = i;
        s[(0x235c >> 2) + i] = s[(0x1740 >> 2) + i];
        s[(0x1f60 >> 2) + i] = s[0x6cf - i];
      }
      s[0x45cc >> 2] = i;
      s[0x448c >> 2] = 1;
      s[0x4494 >> 2] = 0x200;
    }
  }
  /** 0x55c12fcd: resample to obj+0x44cc/256 of the width (DDA on the carry of a 32-bit sum). */
  specResample(): void {
    var s = this.m.I, k = s[0x44cc >> 2], st = s[0x448c >> 2], src: number, dst: number;
    if (k === 0xff) return;
    if (st === 0) { s[0x448c >> 2] = 1; src = 0x1740; dst = 0x1f60; }
    else if (st === 1) { s[0x448c >> 2] = 2; src = 0x1f60; dst = 0x2780; }
    else if (st === 2) { s[0x448c >> 2] = 1; src = 0x2780; dst = 0x1f60; }
    else return;
    s[0x4404 >> 2] = src; s[0x43a0 >> 2] = dst;
    var n: number, step: number, acc = 0, a = src >> 2, b = dst >> 2, cnt = 0, t: number;
    if (k < 0xff) {
      n = s[0x4494 >> 2];
      step = bswap((0x100 - s[0x44cc >> 2]) >>> 0);
      for (;;) {
        cnt++;
        s[b++] = s[a++];
        for (;;) {
          if (--n === 0) { s[0x4494 >> 2] = cnt; return; }
          t = acc + step; acc = t >>> 0;
          if (t < 4294967296) break;               // no carry: copy the next one
          a++;                                     // carry: skip a source bin
        }
      }
    }
    if (s[0x4494 >> 2] >= 0x200) return;
    if (k > 0x200) s[0x44cc >> 2] = 0x200;
    if (s[0x44cc >> 2] > 0x200) return;
    n = s[0x4494 >> 2];
    step = bswap((0x200 - s[0x44cc >> 2]) >>> 0);
    for (;;) {
      cnt++;
      if ((cnt >>> 0) >= 0x200) break;
      var v = s[a] >>> 0;
      s[b++] = v; a++;
      if (--n === 0) break;
      t = acc + step; acc = t >>> 0;
      if (t >= 4294967296) continue;               // carry: next source bin
      cnt++;
      if ((cnt >>> 0) >= 0x200) break;
      s[b++] = ((v + (s[a + 1] >>> 0)) >>> 0) >>> 1;   // (src[k] + src[k+2]) / 2, as the asm reads it
    }
    s[0x4494 >> 2] = cnt;
  }
  /** 0x55c12f48: the resampled buffer back into 0x1740 (513 entries). */
  specCopyBack(): void {
    var s = this.m.I, st = s[0x448c >> 2], i: number;
    if (st === 0) return;
    if (st === 1) {
      for (i = 0; i <= 0x200; i++) s[(0x1740 >> 2) + i] = s[(0x1f60 >> 2) + i];
      s[0x4ee8 >> 2] = i;
      s[0x448c >> 2] = 0;
    }
    if (s[0x448c >> 2] === 2) {
      for (i = 0; i <= 0x200; i++) s[(0x1740 >> 2) + i] = s[(0x2780 >> 2) + i];
      s[0x4ee8 >> 2] = i;
      s[0x448c >> 2] = 0;
    }
  }
  /** 0x55c13254: add obj+0x44bc to every non-zero bin, clamp 0..255. */
  specOffset(): void {
    var s = this.m.I, o = s[0x44bc >> 2];
    if (o === 0) return;
    for (var i = 0; i < s[0x4494 >> 2]; i++) {
      var j = (0x1740 >> 2) + i, v = s[j];
      if (v !== 0) s[j] = v = (v + o) | 0;
      if (v < 0) s[j] = v = 0;
      if (v > 0xff) s[j] = 0xff;
    }
    s[0x45cc >> 2] = i;
  }
  /** 0x55c1315b: running box filter of obj+0x44c0 + 1 bins, in place (it reads what it just wrote). */
  specSmooth(): void {
    var s = this.m.I, F = this.m.F, win = s[0x44c0 >> 2], S = 0x1740 >> 2;
    if (win === 0) return;
    for (var i = 0; i < s[0x4494 >> 2]; i++) {
      s[0x45cc >> 2] = i;
      s[0x4c28 >> 2] = s[S + i];
      s[0x45f0 >> 2] = 0;
      if (win < 0) continue;
      for (var j = 0; j <= s[0x44c0 >> 2]; j++) {
        s[0x45f0 >> 2] = j;
        var q = j + i;
        s[0x45d0 >> 2] = q;
        if (q >= s[0x4494 >> 2]) s[0x45d0 >> 2] = q = i;
        var sum = (s[0x4c28 >> 2] + s[S + q]) | 0, r: number;
        s[0x4c28 >> 2] = sum;
        if (i !== 0 && sum === 0) {
          r = ftol(s[S + i - 1] * fr(0.05000000074505806));
          s[0x4c28 >> 2] = r;
        } else r = (sum / (s[0x44c0 >> 2] + 1)) | 0;
        s[S + i] = r;
      }
      s[0x45f0 >> 2] = j;
      void F;
    }
    s[0x45cc >> 2] = i;
  }
  /** 0x55c132e6: blend with the previous frame's spectrum (obj+0x2fa0) by obj+0x44d0 percent. */
  specBlend(): void {
    var s = this.m.I, F = this.m.F;
    if (s[0x44d0 >> 2] === 0) return;
    if (s[0x44d0 >> 2] > 100) s[0x44d0 >> 2] = 100;
    if (s[0x44d0 >> 2] < 0) s[0x44d0 >> 2] = 0;
    var k = s[0x44d0 >> 2], c = fr(0.009999999776482582);
    s[0x45cc >> 2] = 0;
    F[0x4598 >> 2] = k * c;
    F[0x4594 >> 2] = (100 - k) * c;
    for (var i = 0; i <= s[0x4494 >> 2]; i++) {
      s[0x45cc >> 2] = i;
      var j = (0x1740 >> 2) + i;
      s[j] = ftol(s[(0x2fa0 >> 2) + i] * F[0x4598 >> 2] + s[j] * F[0x4594 >> 2]);
      var q = s[0x448c >> 2] * 0x208 + i;
      s[(0x2fa0 >> 2) + q] = s[(0x1740 >> 2) + q];
    }
    s[0x45cc >> 2] = i;
  }

  // ---------------------------------------------------------------- one frame (vt+0x1ac 0x55c0d452)
  frame(): void {
    var s = this.m.I;
    if (s[0x77c >> 2] < 2 && s[0x910 >> 2] !== -1) s[0x77c >> 2] = 2;
    if (s[0xb54 >> 2] < 2 && s[0xce8 >> 2] !== -1) s[0xb54 >> 2] = 3;
    this.animateLayers();                          // vt+0x28 0x55c133bc -> vt+0x40 0x55c13610
    this.presetStep();                             // vt+0x70 0x55c10ad4
    s[0x4570 >> 2] = 1;
    this.compose();                                // vt+0x64 0x55c0105e
  }

  /** 0x55c13610: animate every used, dirty layer (vt+0xb8 0x55c13662). */
  animateLayers(): void {
    var s = this.m.I;
    for (var k = 0; (k >>> 0) < (s[0x463c >> 2] >>> 0); k++) {
      s[0x44a8 >> 2] = k;
      if (s[LY(k)] !== -1 && s[LY(k) + lf(0x77c)] !== 0) this.animateLayer();
    }
    s[0x44a8 >> 2] = k;
  }

  /** 0x55c13662: per-frame motion of the current layer: two spin angles (wrap at 359), the fade
   *  (0..255), an integer spin, the zoom (while it is smaller than the image's diagonal) and a drift. */
  animateLayer(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0x44a8 >> 2], x = XF(k), b = LY(k);
    var touch = (): void => {                      // state 2, remember the old rect, dirty 3
      s[LY(s[0x44a8 >> 2])] = 2;
      this.saveRect();
      s[LY(s[0x44a8 >> 2]) + lf(0x77c)] = 3;
    };
    if (F[x + xf(0xe4)] !== 0) {
      F[x + xf(0xe0)] = F[x + xf(0xe0)] + F[x + xf(0xe4)];
      if (359 < F[x + xf(0xe0)]) F[x + xf(0xe0)] = F[x + xf(0xe0)] - 359;
      touch();
    }
    if (F[x + xf(0xec)] !== 0) {
      F[x + xf(0xe8)] = F[x + xf(0xec)] + F[x + xf(0xe8)];
      if (359 < F[x + xf(0xe8)]) F[x + xf(0xe8)] = F[x + xf(0xe8)] - 359;
      touch();
    }
    if (F[x + xf(0x128)] !== 0) {
      F[x + xf(0x124)] = F[x + xf(0x128)] + F[x + xf(0x124)];
      if (255 < F[x + xf(0x124)]) F[x + xf(0x124)] = 255;
      if (F[x + xf(0x124)] < 0) F[x + xf(0x124)] = 0;
      touch();
    }
    if (s[b + lf(0x8a0)] !== 0) {
      s[b + lf(0x87c)] = (s[b + lf(0x87c)] + s[b + lf(0x8a0)]) | 0;
      if (s[b + lf(0x87c)] > 0x167) s[b + lf(0x87c)] -= 0x167;
      touch();
    }
    if (s[b + lf(0x8b8)] === 1) {
      var z = F[x + xf(0x88)], d = (Math.imul(s[b + lf(0x7f4)], s[b + lf(0x7f4)]) + Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f8)])) | 0;
      if (F[x + xf(0x8c)] !== 0 && z * z < d) {
        F[x + xf(0x88)] = F[x + xf(0x8c)] + F[x + xf(0x88)];
        this.saveRect();
        touch();
      }
      if (s[b + lf(0x8b4)] !== 0) {
        s[b + lf(0x8b0)] = (s[b + lf(0x8b0)] + s[b + lf(0x8b4)]) | 0;
        if (s[b + lf(0x8b0)] < 0) s[b + lf(0x8b0)] += 0x167;
        if (s[b + lf(0x8b0)] > 0x167) s[b + lf(0x8b0)] -= 0x167;
        this.saveRect();
        touch();
      }
    }
    if (F[x + xf(0x114)] !== 0 || F[x + xf(0x118)] !== 0) {
      F[x + xf(0x10c)] = F[x + xf(0x10c)] + F[x + xf(0x114)];
      F[x + xf(0x110)] = F[x + xf(0x118)] + F[x + xf(0x110)];
      this.saveRect();
      touch();
    }
  }

  /** vt+0x254 0x55c01992: the first time a dirty layer moves, remember where it was (for the erase). */
  saveRect(): void {
    var s = this.m.I, b = LY(s[0x44a8 >> 2]);
    if (s[b + lf(0x77c)] === 1 && s[b + lf(0x7a4)] !== 2) {
      s[0x4c74 >> 2] = s[b + lf(0x780)];
      s[0x4c7c >> 2] = s[b + lf(0x784)];
      if (s[0x47a0 >> 2] < s[0x4c74 >> 2]) s[0x4c74 >> 2] = 0;
      if (s[0x47a8 >> 2] < s[0x4c7c >> 2]) s[0x4c7c >> 2] = 0;
      s[b + lf(0x7a8)] = s[0x4c74 >> 2];
      s[b + lf(0x7ac)] = s[0x4c7c >> 2];
      s[b + lf(0x920)] = s[b + lf(0x798)];
      s[b + lf(0x7bc)] = s[b + lf(0x79c)];
      s[b + lf(0x7c0)] = s[b + lf(0x7a0)];
      s[b + lf(0x7b8)] = s[b + lf(0x790)];
      s[b + lf(0x7b4)] = s[b + lf(0x78c)];
      s[b + lf(0x7a4)] = 2;
    }
  }

  /** vt+0x70 0x55c10ad4: the preset's per-frame work, or a reset when the preset changed; then the
   *  preset program (vt+0x1b8 0x55c11738). */
  presetStep(): void {
    var s = this.m.I;
    if (s[0x4600 >> 2] === s[0x47bc >> 2]) {
      s[0x44a8 >> 2] = 0;
      if (s[0x794 >> 2] === 0) return;
      var md = s[0x457c >> 2];
      if (!this.v8) {
        if (s[0xce8 >> 2] === -1) this.fillLayerBg(); // vt+0x74 0x55c112ce
        else this.spectrumToLayer2();                  // vt+0x15c 0x55c10b3f
      } else if (s[0xce8 >> 2] === -1 || (md !== 2 && md !== 1)) {   // WMP 8 0x590e0bb5
        if (s[0x910 >> 2] !== -1) this.fillLayerBg();
      } else this.spectrumToLayer2();
      if (md === 1) this.bars();                       // vt+0x180 0x55c10cbc
      if (this.v8 && md === 2) unported(0x590e0f2c)(); // WMP 8's single-strip mode: no shipped preset sets it
    } else {
      s[0x4574 >> 2] = 0;
      s[0x4600 >> 2] = s[0x47bc >> 2];
    }
    this.presetProgram();                              // vt+0x1b8 0x55c11738
  }

  // ---------------------------------------------------------------- the preset programs (0x55c11738)
  /** vt+0x1b8 0x55c11738. obj+0x4574 = "this preset is set up": the first call builds the scene (fields
   *  and images per preset), later calls do the preset's per-frame work. obj+0x4414 = the 10-frame
   *  average level (0..255). Preset ids are SetCurrentPreset's index + 1; only 1..20 are reachable. */
  presetProgram(): void {
    var m = this.m, s = m.I, F = m.F;
    if (s[0x4574 >> 2] === 0) {
      this.defaultScene();
      s[0x4458 >> 2] = 0;
      s[0x44a8 >> 2] = 0; this.clearLayerImage();  // vt+0x14c 0x55c1132c
      s[0x44a8 >> 2] = 2; this.clearLayerImage();
      s[0x47f8 >> 2] = 1;
      s[0xce8 >> 2] = 0;
      s[0x457c >> 2] = 1;
    }
    var first = s[0x4574 >> 2] === 0, id = s[0x47bc >> 2], lv: number;
    var tail11a69 = (): void => { s[0x44a8 >> 2] = 0; this.markLayer(); };   // vt+0x1b4 0x55c113a6
    var tail12dee = (): void => {
      store(s, [0xdb0, 0x2d, 0xda8, -1, 0xed4, -1, 0xd40, 2, 0x44a8, 3]);
      this.bindImage();
    };
    var tail12692 = (): void => {                  // layer 2 tilts with angle 0xe0; layer 0's 0x8e0 follows the level
      s[0xd18 >> 2] = 0xf - ftol(F[(0x37d8 >> 2) + ftol(F[0xe0 >> 2])] * -10);
      var v = s[0x4414 >> 2] + 0xe;
      s[0x8e0 >> 2] = v > 0x96 ? 0x96 : v;
      F[0xe4 >> 2] = (s[0x4414 >> 2] / 10) | 0;
    };
    var tail12e5a = (): void => {
      s[0xd18 >> 2] = 0xf - ftol(F[(0x37d8 >> 2) + ftol(F[0xe0 >> 2])] * -10);
      F[0xec >> 2] = (s[0x4414 >> 2] / 100) | 0;
    };
    var levelBias = (): void => {                  // LAB_55c11a54
      lv = s[0x4414 >> 2];
      s[0x44d0 >> 2] = lv < 0xa0 ? ((0x100 - lv) * 0x50 / 0x100) | 0 : 0;
      tail11a69();
    };
    var r: number;
    switch (id) {
      case 1:
        if (first) { store(s, P1); s[0x44c8 >> 2] = 1; } else tail11a69();
        return;
      case 2:
        if (first) {
          store(s, P2a);
          F[0xe0 >> 2] = A.rand() & 0xff;
          F[0xe8 >> 2] = A.rand() & 0xff;
          store(s, P2b);
          store(s, T11921);
          tail12dee();
          return;
        }
        if (++s[0x44b8 >> 2] < 300) return;
        s[0x44b8 >> 2] = 0;
        r = A.rand();
        s[0x4768 >> 2] = r;
        s[0x88c >> 2] = r & 1 ? 1 : 0;
        s[0x890 >> 2] = r & 2 ? 1 : 0;
        s[0x894 >> 2] = (r & 4) === 0 && (s[0x890 >> 2] !== 0 || s[0x88c >> 2] !== 0) ? 0 : 1;
        return;
      case 3:
        if (first) store(s, P3); else levelBias();
        return;
      case 4:
        if (first) { store(s, P4); tail12dee(); } else tail12e5a();
        return;
      case 5:
        if (first) this.preset5Setup(); else this.starStep();
        return;
      case 6:
        if (first) store(s, P6); else levelBias();
        return;
      case 7:
        if (first) store(s, P7); else tail11a69();
        return;
      case 8:
        if (first) store(s, P8);
        return;
      case 9:
        if (first) { store(s, P9); return; }
        s[0xa20 >> 2] = (s[0xa20 >> 2] + s[0x9bc >> 2]) | 0;
        s[0x968 >> 2] = 3;
        if (s[0xa20 >> 2] < -0x10e) { s[0xa20 >> 2] = -0x10e; s[0x9bc >> 2] = -s[0x9bc >> 2]; }
        if (0x10e < s[0xa20 >> 2]) { s[0xa20 >> 2] = 0x10e; s[0x9bc >> 2] = -s[0x9bc >> 2]; }
        if (0 < s[0x9bc >> 2] && s[0xa20 >> 2] === 0x5a) s[0xa20 >> 2] = 0x5b;
        if (s[0x9bc >> 2] < 0 && s[0xa20 >> 2] === -0x5a) s[0xa20 >> 2] = -0x5b;
        tail11a69();
        return;
      case 10:
        if (first) { store(s, P10); s[0x44c8 >> 2] = 1; }
        return;
      case 11:
        if (first) { store(s, P11); store(s, T122de); } else s[0x97c >> 2] = (s[0x97c >> 2] !== 0xe ? 1 : 0) + 0xd;
        return;
      case 12:
        if (first) store(s, P12);
        return;
      case 13:
        if (first) { store(s, P13); s[0x44c8 >> 2] = 3; return; }
        s[0x97c >> 2] = (s[0x97c >> 2] === 0x18 ? 1 : 0) + 0x18;
        tail11a69();
        return;
      case 14:
        if (first) { store(s, P14); store(s, T122de); return; }
        s[0x97c >> 2] = (s[0x97c >> 2] === 0x16 ? 1 : 0) + 0x16;
        tail11a69();
        return;
      case 15:
        if (first) store(s, P15);
        return;
      case 16:
        if (first) { store(s, P16); s[0x44c8 >> 2] = 1; } else tail11a69();
        return;
      case 17:
        if (first) { store(s, P17); store(s, T11921); tail12dee(); }
        return;
      case 18:
        if (first) store(s, P18); else tail11a69();
        return;
      case 19:
        if (first) { store(s, P19); this.bindImage(); }
        tail12692();
        return;
      case 20:                                     // WMP 7: WinMe 3D; WMP 8: Ice Crystals (7's id 26, + 0x910, 0xbe0)
        if (first) store(s, this.v8 ? P20_8 : P20); else this.crystals();   // vt+0x24c 0x55c10e14
        return;
      default:                                     // id 0 (no SetCurrentPreset yet) lands here
        tail12692();
    }
  }

  // ---------------------------------------------------------------- preset helpers
  /** byte-addressed 32-bit load (the bar copies walk their source by a byte step, misaligned) */
  ld(a: number): number {
    var m = this.m;
    return (a & 3) === 0 ? m.U[a >> 2] : (m.B[a] | m.B[a + 1] << 8 | m.B[a + 2] << 16 | m.B[a + 3] << 24) >>> 0;
  }
  /** vt+0x14c 0x55c1132c: fill the current layer's image with obj+0x4b34 (0). */
  clearLayerImage(): void {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]);
    if (s[b + lf(0x794)] === 0) return;
    s[0x4c70 >> 2] = s[b + lf(0x7f4)];
    s[0x4c5c >> 2] = s[b + lf(0x7f8)];
    s[0x4ce4 >> 2] = s[b + lf(0x794)];
    var n = Math.imul(s[0x4c70 >> 2], s[0x4c5c >> 2]) >>> 0, p = s[0x4ce4 >> 2] >> 2;
    m.U.fill(s[0x4b34 >> 2] >>> 0, p, p + n);
  }
  /** vt+0x1b4 0x55c113a6: the current layer needs a full redraw (0x950 = 3, dirty = 3). */
  markLayer(): void {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]);
    s[b + lf(0x950)] = 3;
    s[b + lf(0x77c)] = 3;
    s[0x4c08 >> 2] = s[b + lf(0x794)];
    m.B[s[0x4c08 >> 2] - 4] = 0;
  }
  /** vt+0x74 0x55c112ce: layer 0's image := its background colour (0x7e4). */
  fillLayerBg(): void {
    var m = this.m, s = m.I;
    s[0x44a8 >> 2] = 0;
    s[0x4ec4 >> 2] = Math.imul(s[0x7f8 >> 2], s[0x7f4 >> 2]);
    s[0x4b8c >> 2] = s[0x794 >> 2];
    s[0x4df4 >> 2] = s[0x7e4 >> 2];
    var p = s[0x4b8c >> 2] >> 2;
    m.U.fill(s[0x4df4 >> 2] >>> 0, p, p + (s[0x4ec4 >> 2] >>> 0));
  }
  /** vt+0x15c 0x55c10b3f: move layer 0's drawn pixels into layer 2 (layer 0 back to its background),
   *  then age layer 2 into its image: alpha += obj+0xd18 each frame, a pixel whose alpha overflows is
   *  gone (layer 2's background). The trails of most presets. */
  spectrumToLayer2(): void {
    var m = this.m, s = m.I, U = m.U, i: number;
    s[0x4b8c >> 2] = s[0x794 >> 2];
    s[0x4df4 >> 2] = s[0x7e4 >> 2];
    var sel = s[0x824 >> 2], pf = sel === 1 ? 0x828 : sel === 2 ? 0x90c : 0;
    if (pf) {
      if (s[pf >> 2] === 0) return;
      this.fillLayerBg();
      s[0x4b8c >> 2] = s[pf >> 2];
    }
    s[0x44a8 >> 2] = 2;
    s[0x4c08 >> 2] = s[0xb6c >> 2];
    sel = s[0xbfc >> 2];
    if (sel === 1 || sel === 2) {
      var v = s[(sel === 1 ? 0xc00 : 0xce4) >> 2];
      if (v === 0) return;
      s[0x4c08 >> 2] = v;
    }
    var n = Math.imul(s[0xbd0 >> 2], s[0xbcc >> 2]) >>> 0;
    s[0x4ec4 >> 2] = n;
    s[0x4c54 >> 2] = ftol(m.F[0x2e4 >> 2]);
    var a = s[0x4b8c >> 2] >> 2, d = s[0x4c08 >> 2] >> 2, bg = s[0x4df4 >> 2] >>> 0;
    for (i = 0; i < n; i++) {
      var px = U[a + i];
      if (px !== bg) { U[d + i] = px; U[a + i] = bg; }
    }
    var b = LY(s[0x44a8 >> 2]);
    s[0x439c >> 2] = s[b + lf(0x794)];
    s[0x4c54 >> 2] = s[b + lf(0x940)];
    s[0x4df4 >> 2] = s[b + lf(0x7e4)];
    var src = s[0x4c08 >> 2] >> 2, dst = s[0x439c >> 2] >> 2, bg2 = s[0x4df4 >> 2] >>> 0, st = bswap(s[0x4c54 >> 2] >>> 0);
    for (i = 0; i < n; i++) {
      var q = U[src + i];
      if (q !== bg2) { var t = q + st; q = t > 0xffffffff ? bg2 : t; }
      U[dst + i] = q;
    }
    s[b + lf(0x824)] = 0;
  }
  /** vt+0x180 0x55c10cbc: one column per spectrum bin: layer 3 (a strip cut from layer 1's colour ramp,
   *  as long as the bin is loud) drawn at x = bin, y from the bin (obj+0x44c8 picks how). */
  bars(): void {
    var s = this.m.I;
    s[0xed4 >> 2] = 0;
    if (s[0x47f8 >> 2] === 1) this.rampScroll();   // vt+0x1dc 0x55c110ff
    s[0x4444 >> 2] = s[0x7f4 >> 2];
    for (s[0x4ee8 >> 2] = 0; s[0x4ee8 >> 2] < s[0x4494 >> 2]; s[0x4ee8 >> 2]++) {
      var i = s[0x4ee8 >> 2];
      s[0xd44 >> 2] = i;
      if (i > s[0x4444 >> 2] || i < 0) continue;
      if (s[0x47f8 >> 2] !== 1) this.barStrip();    // vt+0x24 0x55c10f98
      var md = s[0x44c8 >> 2], v = s[(0x1740 >> 2) + i];
      if (md <= 2) s[0xd48 >> 2] = v - 0xff;
      if (md === 3) s[0xd48 >> 2] = 0x140 - v;
      if (md === 4) s[0xd48 >> 2] = v + 0x40;
      if (md === 5) { s[0xd48 >> 2] = v; if (v < 3) continue; }
      s[0x4444 >> 2] = s[0x7f4 >> 2];
      s[0x4440 >> 2] = s[0x7f8 >> 2];
      s[0x4378 >> 2] = s[0x794 >> 2];
      s[0x4f10 >> 2] = 0;
      s[0x4f24 >> 2] = 0;
      s[0x44a8 >> 2] = 3;
      this.renderLayer();                          // vt+0x19c 0x55c02b33
    }
    s[0xed4 >> 2] = -1;
  }
  /** layer 1's image or the work buffer it selects (0xa10) */
  layer1Src(): number {
    var s = this.m.I, p = s[0x980 >> 2];
    if (s[0xa10 >> 2] === 1) p = s[0xa14 >> 2];
    if (s[0xa10 >> 2] === 2) p = s[0xaf8 >> 2];
    return p;
  }
  /** vt+0x24 0x55c10f98: layer 3 := the strip of layer 1 that ends at row spec[bin], read upward by
   *  obj+0x47f8 BYTES per row (so for small steps the reads straddle neighbouring pixels). */
  barStrip(): void {
    var m = this.m, s = m.I, U = m.U, bin = s[0x4ee8 >> 2];
    s[(0x1740 >> 2) + bin] &= 0xff;
    s[0x44a8 >> 2] = 1;
    s[0x4b5c >> 2] = this.layer1Src();
    s[0x4c08 >> 2] = s[0xd58 >> 2];
    var v = s[(0x1740 >> 2) + bin];
    s[0x4b8c >> 2] = s[0x4b5c >> 2];
    s[0x4b5c >> 2] = (s[0x4b5c >> 2] + Math.imul(s[0x9e0 >> 2], v) * 4) | 0;
    var n = v + 1;
    s[0x4ec4 >> 2] = n;
    s[0x4c70 >> 2] = s[0xdb8 >> 2];
    if (n > s[0xdbc >> 2]) s[0x4ec4 >> 2] = n = s[0xdbc >> 2];
    var d = s[0x4c08 >> 2], a = (s[0x4b5c >> 2] + s[0x47f8 >> 2]) >>> 0, st = s[0x47f8 >> 2], lo = s[0x4b8c >> 2] >>> 0;
    m.B[d - 4] = 0;
    var w = s[0x4c70 >> 2] >>> 0;
    d >>= 2;
    do {
      if (w > 2) {
        U[d++] = this.ld(a); U[d++] = this.ld(a + 4); U[d++] = this.ld(a + 8);
        a = (a + 8 - st) >>> 0;
      } else if (w === 2) {
        U[d++] = this.ld(a); U[d++] = this.ld(a + 4);
        a = (a + 4 - st) >>> 0;
      } else {
        U[d++] = this.ld(a);
        a = (a - st) >>> 0;
      }
      if (a < lo) a = lo;
    } while (--n !== 0);
  }
  /** vt+0x1dc 0x55c110ff: layer 3 := layer 1's ramp rotated by obj+0x441c rows (+8 per frame). */
  rampScroll(): void {
    var m = this.m, s = m.I, U = m.U;
    s[0x4c08 >> 2] = s[0xd58 >> 2];
    s[0x4b5c >> 2] = this.layer1Src();
    s[0x441c >> 2] += 8;
    var h = s[0xdbc >> 2];
    s[0x4b8c >> 2] = s[0x4b5c >> 2];
    if (s[0x441c >> 2] >= h) s[0x441c >> 2] = 0;
    var off = s[0x441c >> 2];
    s[0x4ec4 >> 2] = h - off;
    s[0x4c70 >> 2] = s[0xdb8 >> 2];
    s[0x4b5c >> 2] = (s[0x4b5c >> 2] + off * 12) | 0;
    var d = s[0x4c08 >> 2];
    m.B[d - 4] = 0;
    d >>= 2;
    var a = s[0x4b5c >> 2] >> 2, n = Math.imul(s[0x4ec4 >> 2], s[0x4c70 >> 2]) >>> 0, i: number;
    for (i = 0; i < n; i++) U[d++] = U[a++];
    a = s[0x4b8c >> 2] >> 2;
    n = Math.imul(s[0x4c70 >> 2], off) >>> 0;
    for (i = 0; i < n; i++) U[d++] = U[a++];
  }
  /** vt+0x24c 0x55c10e14 (WinMe 3D): layer 5 is a 1x1 dot; one at every silent bin, then four more. */
  crystals(): void {
    var m = this.m, s = m.I;
    s[0x4444 >> 2] = s[0x7f4 >> 2];
    s[0x4440 >> 2] = s[0x7f8 >> 2];
    s[0x4f10 >> 2] = 0;
    s[0x4f24 >> 2] = 0;
    s[0x4378 >> 2] = s[0x794 >> 2];
    if (s[0x1190 >> 2] !== 1 || s[0x1194 >> 2] !== 1) {
      s[0x1128 >> 2] = 0; s[0x112c >> 2] = 5; s[0x44a8 >> 2] = 5;
      this.bindImage();
    }
    s[0x12ac >> 2] = 0;
    s[0x4c08 >> 2] = s[0x1130 >> 2];
    s[0x4c50 >> 2] = s[0x47bc >> 2] === (this.v8 ? 0x1a : 0x14) ? 0x6060ff : 0xffffff;   // WinMe 3D's dots are blue
    s[s[0x4c08 >> 2] >> 2] = s[0x4c50 >> 2];
    for (s[0x4ee8 >> 2] = 0; s[0x4ee8 >> 2] < s[0x4494 >> 2]; s[0x4ee8 >> 2]++) {
      if (s[(0x1740 >> 2) + s[0x4ee8 >> 2]] === 0) {
        s[0x111c >> 2] = s[0x4ee8 >> 2]; s[0x1120 >> 2] = 0; s[0x44a8 >> 2] = 5;
        this.renderLayer();
      }
    }
    for (var i = 0; i < 4; i++) {
      s[0x4ee8 >> 2] = i;
      s[0x111c >> 2] = s[0x4494 >> 2] + i;
      s[0x1120 >> 2] = 0;
      s[0x4e64 >> 2] = (i + 1) * 0x32;
      s[s[0x4c08 >> 2] >> 2] |= bswap(s[0x4e64 >> 2]);
      s[0x44a8 >> 2] = 5;
      this.renderLayer();
    }
    s[0x4ee8 >> 2] = 4;
    s[0x12ac >> 2] = -1;
  }
  /** 0x55c11738 id 5 (Star Power), first call: the starburst map (image 0x24) recoloured each frame. */
  preset5Setup(): void {
    var m = this.m, s = m.I;
    store(s, [0x4574, 1, 0x457c, 0, 0x47f8, 1, 0x97c, 0x27, 0xafc, 0, 0x44c0, 0x28, 0x44bc, 0x55, 0x44d0, 0x25]);
    s[0x445c >> 2] = s[(0x4318 >> 2) + (A.rand() & 0xf)];
    store(s, this.v8 ? [0xd54, 0x25, 0xdb0, -0x495, 0x44a8, 3] : [0xd54, 0x25, 0x44a8, 3]);
    this.bindImage();
    store(s, [0x1184, 0x453, 0x1188, -0x1d3, 0x11a4, -3, 0x112c, 0x24, 0x12ac, -1, 0x11ec, 1, 0x11e8, 0x37, 0x44a8, 5]);
    this.bindImage();
    this.markLayer();
    s = m.I;
    var b = LY(s[0x44a8 >> 2]);
    s[b + lf(0x950)] = 0;
    s[0x4c70 >> 2] = s[b + lf(0x7f4)];
    s[0x4c5c >> 2] = s[b + lf(0x7f8)];
    s[0x4ce4 >> 2] = s[b + lf(0x794)];
    var n = Math.imul(s[0x4c70 >> 2], s[0x4c5c >> 2]) >>> 0, p = s[0x4ce4 >> 2] >> 2;
    for (var i = 0; i < n; i++) m.U[p + i] &= 0xffffff;
    if (s[0x4660 >> 2] === 0) { var c = m.malloc(Math.imul(s[0x47a8 >> 2], s[0x47a0 >> 2]) * 4); s = m.I; s[0x4660 >> 2] = c; }
    s[0x4378 >> 2] = s[0x4660 >> 2];
    if (s[0x4660 >> 2] === 0) return;
    s[0x4f10 >> 2] = 0;
    s[0x4444 >> 2] = s[0x47a0 >> 2];
    s[0x4440 >> 2] = s[0x47a8 >> 2];
    s[0x4f24 >> 2] = 0;
    s[b + lf(0x910)] = -1;
    this.renderLayer();
    this.alphaFromBlue();                          // vt+0x13c 0x55c11403
    this.starColours();                            // vt+0x190 0x55c11499
    s = m.I;
    s[0xafc >> 2] = -1; s[0x910 >> 2] = -1; s[0xce8 >> 2] = -1;
    if (this.v8) s[0xed4 >> 2] = -1;                // WMP 8 also hides layer 3 (no visible change)
    s[0x12ac >> 2] = -1;
  }
  /** id 5 per frame (0x55c12ccc) */
  starStep(): void {
    var s = this.m.I;
    s[0x44a8 >> 2] = 5;
    s[0x12ac >> 2] = 0;
    this.starColours();
    this.starBackground();                         // vt+0x134 0x55c1166a
  }
  /** vt+0x13c 0x55c11403: alpha byte := blue byte (saturating add; blue 255 -> alpha 255). */
  alphaFromBlue(): void {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]), U = m.U;
    if (s[b + lf(0x794)] === 0) return;
    s[0x4c70 >> 2] = s[b + lf(0x7f4)];
    s[0x4c5c >> 2] = s[b + lf(0x7f8)];
    s[0x4ce4 >> 2] = s[b + lf(0x794)];
    var n = Math.imul(s[0x4c70 >> 2], s[0x4c5c >> 2]) >>> 0, p = s[0x4ce4 >> 2] >> 2;
    for (var i = 0; i < n; i++) {
      var v = U[p + i], lo = v & 0xff;
      if (lo >= 0xff) v = (v | 0xff000000) >>> 0;
      else { var t = v + lo * 0x1000000; v = t > 0xffffffff ? ((t >>> 0) | 0xff000000) >>> 0 : t; }
      U[p + i] = v;
    }
  }
  /** vt+0x190 0x55c11499: the 255-entry palette (layer 3's ramp, rotated +10 per frame, entry i dimmed by
   *  the spectrum) into layer 3's work buffer, then layer 5 (the starburst) mapped through it. */
  starColours(): void {
    var m = this.m, s = m.I, U = m.U;
    s[0x44a8 >> 2] = 3;
    if (!this.swapBuffers()) return;               // vt+0xd8 0x55c033e1
    s = m.I; U = m.U;
    var lv = s[0x4414 >> 2], d = lv - ftol(lv * fr(0.949999988079071));
    s[0x4c28 >> 2] = d < 1 ? 1 : d;
    s[0x116c >> 2] += 0xa;
    if (s[0x116c >> 2] > 0xff) s[0x116c >> 2] = 0;
    for (var i = 0; i < 0xff; i++) {
      s[0x4ee8 >> 2] = i;
      s[0x4b5c >> 2] = s[0xd58 >> 2];
      var v = s[(0x1740 >> 2) + i];
      s[0x4c0c >> 2] = ((0xff - v) / s[0x4c28 >> 2]) | 0;
      var ix = (v + s[0x116c >> 2]) | 0;
      if (ix > 0x400) ix -= 0x400;
      s[0x4b68 >> 2] = ix;
      s[0x4b5c >> 2] = (s[0xd58 >> 2] + ix * 4) | 0;
      U[s[0x4374 >> 2] >> 2] = (bswap(s[0x4c0c >> 2] >>> 0) | U[s[0x4b5c >> 2] >> 2]) >>> 0;
      s[0x4374 >> 2] += 4;
    }
    s[0x4ee8 >> 2] = 0xff;
    var n = Math.imul(s[0x1194 >> 2], s[0x1190 >> 2]);
    s[0x4ec4 >> 2] = n;
    if (n === 0) return;
    s[0x4ce4 >> 2] = s[0x1130 >> 2];
    s[0x44a8 >> 2] = 5;
    if (!this.swapBuffers()) return;
    s = m.I; U = m.U;
    var pal = s[0xd58 >> 2];
    if (s[0xde8 >> 2] === 1) pal = s[0xdec >> 2];
    if (s[0xde8 >> 2] === 2) pal = s[0xed0 >> 2];
    s[0x4b5c >> 2] = pal;
    var dd = s[0x4374 >> 2] >> 2, src = s[0x4ce4 >> 2] >> 2;
    pal >>= 2;
    n >>>= 0;
    for (i = 0; i < n; i++) {
      var b = U[src + i], hi = (b & 0xff000000) >>> 0, t = U[pal + (b & 0xff)] + hi;
      U[dd + i] = t > 0xffffffff ? ((t >>> 0) | 0xff000000) >>> 0 : t;
    }
    s[0x4ce4 >> 2] = (s[0x4ce4 >> 2] + n * 4) | 0;
  }
  /** vt+0x134 0x55c1166a: background colour := layer 1's pixel obj+0x445c, re-rolled (rand & 0xff) when
   *  the level leaves 70..130 % of its average, at most every 46 frames; black when nearly silent. */
  starBackground(): void {
    var m = this.m, s = m.I;
    s[0x4b5c >> 2] = s[0x980 >> 2];
    if (s[0x980 >> 2] === 0) return;
    var avg = s[0x4414 >> 2], cur = s[0x440c >> 2];
    var hi = ftol(avg * fr(1.2999999523162842)), lo = ftol(avg * fr(0.699999988079071));
    if (s[0x4460 >> 2] > 0x2d && (cur > hi || cur < lo)) {
      s[0x4460 >> 2] = 0;
      s[0x445c >> 2] = A.rand() & 0xff;
    }
    s[0x4460 >> 2]++;
    if (s[0x445c >> 2] > 0xff) s[0x445c >> 2] = 0;
    if (s[0x440c >> 2] < 3) s[0x4458 >> 2] = 0;
    else s[0x4458 >> 2] = m.I[(s[0x4b5c >> 2] >> 2) + s[0x445c >> 2]];
  }

  // ---------------------------------------------------------------- compose + blit (vt+0x64 0x55c0105e)
  compose(): void {
    var m = this.m, s = m.I;
    s[0x47a4 >> 2] = s[0x47a0 >> 2] << 2;
    s[0x4478 >> 2] = (s[0x464c >> 2] / 2) | 0;
    s[0x4480 >> 2] = (s[0x4650 >> 2] / 2) | 0;
    if (s[0x4660 >> 2] === 0) { var c = m.malloc(Math.imul(s[0x47a8 >> 2], s[0x47a0 >> 2]) * 4); s = m.I; s[0x4660 >> 2] = c; }
    var n = Math.imul(s[0x47a8 >> 2], s[0x47a0 >> 2]) >>> 0, cv = s[0x4660 >> 2] >> 2;
    m.U.fill(s[0x4458 >> 2] >>> 0, cv, cv + n);   // the canvas := background colour
    this.placeLayers();                            // vt+0x258 0x55c03e34
    this.clipLayers();                             // vt+0x48 0x55c0180b
    if (s[0x47ac >> 2] === 0) throw new Error('musical: the dirty-rectangle compose (0x55c0115b) is not ported');
    s[0x4378 >> 2] = s[0x4660 >> 2];
    s[0x4444 >> 2] = s[0x47a0 >> 2];
    s[0x4440 >> 2] = s[0x47a8 >> 2];
    s[0x4f10 >> 2] = 0;
    s[0x4f24 >> 2] = 0;
    this.drawLayers();                             // vt+0x158 0x55c020c2
    s = m.I;
    if (s[0x4570 >> 2] !== 0) this.blit();         // vt+0xc4 0x55c0140e
    m.I[0x45ec >> 2] = 0;
  }

  /** 0x55c03e34: bind and project every used layer (only dirty ones when 0x47ac == 0). */
  placeLayers(): void {
    var s = this.m.I;
    for (var k = 0; ; ) {
      s[0x44a8 >> 2] = k;
      var b = LY(k), bind = false;
      if (s[b] !== -1) {
        var d = s[b + lf(0x77c)];
        if (s[0x47ac >> 2] !== 0 && d < 2 && d === 0) bind = true;      // dirty 0: no "< 2" test
        else {
          if (s[0x47ac >> 2] !== 0 && d < 2) s[b + lf(0x77c)] = 2;
          bind = s[b + lf(0x77c)] >= 2;
        }
        if (bind && s[b + lf(0x770)] !== -1 && this.bindImage() !== 0) this.project();
      }
      s = this.m.I;
      k = s[0x44a8 >> 2] + 1;
      s[0x44a8 >> 2] = k;
      if ((k >>> 0) >= (s[0x463c >> 2] >>> 0)) break;
    }
  }

  /** vt+0x1c0 0x55c03ed2: perspective. Projects the layer's centre through the two rotations
   *  (projectPos), scales its size by focal / (focal + depth) and sets its top-left (0x780/0x784). */
  project(): void {
    var m = this.m, s = m.I, F = m.F, b = LY(s[0x44a8 >> 2]);
    var hh = s[b + lf(0x86c)] === 2 ? (s[b + lf(0x808)] + s[b + lf(0x7f8)]) | 0 : s[b + lf(0x7f8)];
    s[0x4d4c >> 2] = hh;
    s[0x444c >> 2] = (s[b + lf(0x7ec)] + hh) | 0;
    this.projectPos();                             // vt+0x1c4 0x55c04288
    var dz = s[0x4c84 >> 2], foc = s[0x45a8 >> 2];
    var t1 = (foc + dz) | 0, t2 = (s[0x4f04 >> 2] + foc) | 0, t3 = (s[0x4f04 >> 2] + foc + dz) | 0;
    F[0x45ac >> 2] = t1;
    F[0x45b4 >> 2] = t2;
    F[0x45b0 >> 2] = t3;
    if (!(t2 > 1)) F[0x45b4 >> 2] = 1;
    if (!(t1 > 1)) F[0x45ac >> 2] = 1;
    if (!(fr(t3) > 1)) F[0x45b0 >> 2] = 1;
    var q = (foc << 8) / F[0x45b4 >> 2] * foc / F[0x45ac >> 2];
    F[0x4c64 >> 2] = q;
    s[b + lf(0x798)] = (ftol(q) - s[b + lf(0x804)]) | 0;
    s[0x4ce0 >> 2] = (ftol(F[0x4c64 >> 2]) - s[b + lf(0x804)]) | 0;
    if (s[b + lf(0x798)] < 0) { s[b + lf(0x798)] = 1; s[0x4ce0 >> 2] = 1; }
    if (s[0x4584 >> 2] === 0) this.scaleSize();    // vt+0x11c 0x55c043cc
    s = m.I; F = m.F; b = LY(s[0x44a8 >> 2]);
    foc = s[0x45a8 >> 2];
    var ffoc = fr(foc);
    var v = ffoc * F[0x4510 >> 2] / F[0x45ac >> 2];
    F[0x4510 >> 2] = v;
    var yp = s[0x4f28 >> 2] - v;
    F[0x4c38 >> 2] = yp;
    var fx = fr(s[0x4c2c >> 2]);
    F[0x4c30 >> 2] = fx;
    var w2 = (foc << 8) / F[0x45b4 >> 2];
    F[0x4b94 >> 2] = w2;
    var x = fr(fx * w2 * fr(0.003921568859368563) - s[0x4efc >> 2]);
    F[0x4c78 >> 2] = x;
    var yv = yp * w2 * fr(0.003921568859368563) - s[0x4f00 >> 2];
    F[0x4c80 >> 2] = yv;
    if (s[0x458c >> 2] === 0) {
      var q2 = (F[0x4470 >> 2] - x) * ffoc / F[0x45ac >> 2];
      F[0x4508 >> 2] = q2;
      F[0x4c78 >> 2] = F[0x4470 >> 2] - q2;
    }
    if (s[0x4584 >> 2] === 1) {
      s[0x4c74 >> 2] = ftol(F[0x4c78 >> 2]);
      s[0x4c7c >> 2] = ftol(yv);
      return;
    }
    var half = (s[b + lf(0x79c)] / 2) | 0;
    F[0x4c78 >> 2] = F[0x4c78 >> 2] - half;
    var h2 = (s[b + lf(0x808)] + s[b + lf(0x7f8)]) | 0;
    F[0x4c80 >> 2] = yv - (h2 * (F[0x4c64 >> 2] * 0.00390625) + 1);
    s[b + lf(0x780)] = ftol(F[0x4c78 >> 2] + fr(0.5));
    s[b + lf(0x784)] = ftol(F[0x4c80 >> 2] + fr(0.5));
    s[b + lf(0x814)] = s[b + lf(0x780)];
    s[b + lf(0x818)] = s[b + lf(0x784)];
  }

  /** vt+0x1c4 0x55c04288: rotate the layer centre (relative to the canvas centre) by angle 0x4eec in
   *  the screen plane, then derive depth / height from angle 0x4ef8. */
  projectPos(): void {
    var m = this.m, s = m.I, F = m.F, b = LY(s[0x44a8 >> 2]);
    var cx0 = s[0x4478 >> 2];
    var cx = (((s[b + lf(0x7f4)] / 2) | 0) + s[b + lf(0x7e8)]) | 0;
    s[0x4c2c >> 2] = cx;
    var dx = (cx - cx0) | 0, dy = (s[0x444c >> 2] - s[0x4480 >> 2]) | 0;
    s[0x4758 >> 2] = dx;
    s[0x475c >> 2] = dy;
    var a = s[0x4eec >> 2], c = F[(0x37d8 >> 2) + a], sn = F[(0x3d78 >> 2) + a];
    s[0x4504 >> 2] = ftol(dx * c - dy * sn);
    s[0x450c >> 2] = ftol(dy * c + dx * sn);
    s[0x4c2c >> 2] = (cx0 + s[0x4504 >> 2]) | 0;
    var y = (s[0x4480 >> 2] + s[0x450c >> 2]) | 0;
    s[0x4c34 >> 2] = y;
    s[b + lf(0x7f0)] = y;
    s[0x4f28 >> 2] = s[0x464c >> 2] < s[0x4650 >> 2] ? s[0x4650 >> 2] : s[0x464c >> 2];
    var a2 = s[0x4ef8 >> 2], z = (s[0x4f28 >> 2] - y) | 0;
    s[0x475c >> 2] = z;
    s[0x4c84 >> 2] = ftol(z * F[(0x3d78 >> 2) + a2]);
    F[0x4510 >> 2] = z * F[(0x37d8 >> 2) + a2];
    s[b + lf(0x788)] = s[0x4c84 >> 2];
  }

  /** vt+0x11c 0x55c043cc: the layer's on-canvas size at scale 0x4ce0 (8.8). */
  scaleSize(): void {
    var s = this.m.I, b = LY(s[0x44a8 >> 2]);
    s[0x4540 >> 2] = s[b + lf(0x7f4)];
    s[0x453c >> 2] = s[b + lf(0x7f8)];
    var v = s[b + lf(0x808)], neg = v < 0;
    s[0x4d70 >> 2] = neg ? -v | 0 : v;
    this.scaleDims();                              // vt+0x58 0x55c0bdd9
    s[b + lf(0x81c)] = s[0x4540 >> 2];
    s[b + lf(0x820)] = s[0x453c >> 2];
    s[b + lf(0x79c)] = s[0x4540 >> 2];
    s[b + lf(0x7a0)] = s[0x453c >> 2];
    s[b + lf(0x80c)] = neg ? -s[0x4d70 >> 2] | 0 : s[0x4d70 >> 2];
  }

  /** vt+0x58 0x55c0bdd9: scale 0x4540 / 0x453c / 0x4d70 by 0x4ce0 (0, 0xfe..0x102 = unscaled). */
  scaleDims(): void {
    var s = this.m.I, v = s[0x4ce0 >> 2];
    if (v === 0 || (v >= 0xfe && v <= 0x102)) return;
    s[0x4cf4 >> 2] = s[0x4540 >> 2];
    s[0x4ce8 >> 2] = s[0x453c >> 2];
    if (v > 0x300) { s[0x4ce0 >> 2] = 0x300; v = 0x300; }
    var f = v < 0x100 ? 0 : v < 0x201 ? 1 : 2;
    s[0x4540 >> 2] = scaledCount(s[0x4540 >> 2], v, f);
    s[0x453c >> 2] = scaledCount(s[0x453c >> 2], v, f);
    if (s[0x4d70 >> 2] !== 0) s[0x4d70 >> 2] = scaledCount(s[0x4d70 >> 2], v, f);
  }

  /** 0x55c0180b: clip every layer to the canvas. k runs 0..8 INCLUSIVE: "layer 8" is the memory after
   *  layer 7 (the draw-order list at 0x16cc onward), read and written as if it were one. */
  clipLayers(): void {
    var s = this.m.I;
    for (var k = 0; ; ) {
      s[0x44a8 >> 2] = k;
      this.clipLayer();
      k = s[0x44a8 >> 2] + 1;
      s[0x44a8 >> 2] = k;
      if ((k >>> 0) > (s[0x463c >> 2] >>> 0)) break;
    }
  }
  /** vt+0x4c 0x55c0183a */
  clipLayer(): void {
    var s = this.m.I, b = LY(s[0x44a8 >> 2]);
    if (s[b] === -1) return;
    if (s[0x47ac >> 2] === 0 && s[b + lf(0x77c)] < 2) return;
    var off = (): void => { s[b + lf(0x77c)] = 0; };
    if (s[b + lf(0x798)] < s[0x46d4 >> 2]) { off(); return; }
    s[b + lf(0x810)] = 0;
    var y = s[b + lf(0x784)];
    if (y >= s[0x47a8 >> 2]) { off(); return; }
    var x = s[b + lf(0x780)], W = s[0x47a0 >> 2];
    if (x >= W) { off(); return; }
    var e = (x + s[b + lf(0x79c)]) | 0;
    if (e - 1 < 0) { off(); return; }
    if (((s[b + lf(0x7a0)] + y) | 0) - 1 < 0) { off(); return; }
    if (x < 0) {
      s[b + lf(0x79c)] = e > W ? W : e;
      s[b + lf(0x810)] = 1;
    } else if (e > W) {
      s[b + lf(0x79c)] = W - x;
      s[b + lf(0x810)] = 1;
    }
    y = s[b + lf(0x784)];
    var H = s[0x47a8 >> 2];
    if (y < 0) {
      var t = (s[b + lf(0x7a0)] + y) | 0;
      s[b + lf(0x7a0)] = t > H ? H : t;
    } else {
      if (((y + s[b + lf(0x7a0)]) | 0) <= H) return;
      s[b + lf(0x7a0)] = H - y;
    }
    s[b + lf(0x810)] = 1;
  }

  /** vt+0x158 0x55c020c2: depth-sort, then render each layer back to front. */
  drawLayers(): void {
    var s = this.m.I;
    this.sortLayers();                             // vt+0x27c 0x55c024bd
    s[0x4f30 >> 2] = 0;
    for (;;) {
      s = this.m.I;
      var k = s[(0x16cc >> 2) + s[0x4f30 >> 2]];
      s[0x44a8 >> 2] = k;
      if (k === -1) break;
      if (s[LY(k) + lf(0x7a4)] === 2) s[LY(k) + lf(0x7a4)] = 1;
      this.renderLayer();
      s = this.m.I;
      s[0x4f30 >> 2]++;
    }
  }
  /** 0x55c024bd: the draw-order list at 0x16cc, by depth (0x7f0 + 10000) ascending, state 0 layers first
   *  then states 1 and 2; -1 terminated. */
  sortLayers(): void {
    var s = this.m.I;
    s[0x4f30 >> 2] = 0; s[0x47b0 >> 2] = 0; s[0x47b4 >> 2] = 0; s[0x4e90 >> 2] = 0;
    for (var pass = 0; pass < 2; pass++) {
      if (pass) { s[0x47b0 >> 2] = 1; s[0x47b4 >> 2] = 2; s[0x4e90 >> 2] = 0; }
      for (;;) {
        s[0x44f8 >> 2] = s[0x443c >> 2];
        this.nextDepth();                          // vt+0x1e0 0x55c02788
        if (s[0x44f8 >> 2] === s[0x443c >> 2]) break;
        this.collectDepth();                       // vt+0x18c 0x55c0295c
        s[0x4e90 >> 2]++;
      }
    }
    s[(0x16cc >> 2) + s[0x4f30 >> 2]] = -1;
  }
  /** 0x55c02788: obj+0x4e90 += the smallest (depth - 0x4e90) >= 0 among the candidates */
  nextDepth(): void {
    var s = this.m.I;
    s[0x44a8 >> 2] = 0;
    s[0x4be0 >> 2] = 0;
    for (var k = 0; ; ) {
      var b = LY(k);
      if (s[b + lf(0x77c)] !== 0 && s[b] !== -1) {
        var st = s[b], p0 = s[0x47b0 >> 2];
        if (st === p0 || st === s[0x47b4 >> 2]) {
          var z = (s[b + lf(0x7f0)] + 0x2710) | 0;
          s[0x4c7c >> 2] = z;
          if (z < 0) s[0x4c7c >> 2] = 0;
          if (p0 === 0 || p0 === 1 || p0 === 2) s[0x4be0 >> 2] = s[0x4c7c >> 2];
          var c = s[0x4e90 >> 2], d = s[0x4be0 >> 2];
          if (c <= d && ((d - c) | 0) < s[0x44f8 >> 2]) s[0x44f8 >> 2] = (d - c) | 0;
        }
      }
      k++;
      s[0x44a8 >> 2] = k;
      if ((k >>> 0) >= (s[0x463c >> 2] >>> 0)) break;
    }
    s[0x4e90 >> 2] = (s[0x4e90 >> 2] + s[0x44f8 >> 2]) | 0;
  }
  /** 0x55c0295c: append the candidates at depth obj+0x4e90 */
  collectDepth(): void {
    var s = this.m.I;
    s[0x44a8 >> 2] = 0;
    for (var k = 0; ; ) {
      var b = LY(k);
      if (s[b + lf(0x77c)] !== 0 && s[b] !== -1) {
        var st = s[b], p0 = s[0x47b0 >> 2];
        if (st === p0 || st === s[0x47b4 >> 2]) {
          var z = (s[b + lf(0x7f0)] + 0x2710) >>> 0;
          s[0x4c7c >> 2] = z;
          if (z > 0x80000000) s[0x4c7c >> 2] = 0;
          if (p0 === 0 || p0 === 1 || p0 === 2) s[0x4be0 >> 2] = s[0x4c7c >> 2];
          if (s[0x4e90 >> 2] === s[0x4be0 >> 2]) { s[(0x16cc >> 2) + s[0x4f30 >> 2]] = k; s[0x4f30 >> 2]++; }
        }
      }
      k++;
      s[0x44a8 >> 2] = k;
      if ((k >>> 0) >= (s[0x463c >> 2] >>> 0)) break;
    }
  }

  /** vt+0xc4 0x55c0140e: scale the canvas to the window (scaleOut) and BitBlt it at the rect's origin. */
  blit(): void {
    var m = this.m, s: Int32Array;
    this.scaleOut();                               // vt+0x1d0 0x55c0cb97
    s = m.I;
    s[0x68 >> 2] = s[0x4620 >> 2];
    s[0x4f10 >> 2] = s[0x47e8 >> 2];
    s[0x4f24 >> 2] = s[0x47ec >> 2];
    var w = s[0x4444 >> 2], h = s[0x4440 >> 2], x0 = s[0x4f10 >> 2], y0 = s[0x4f24 >> 2];
    var src = s[0x4378 >> 2] >> 2, U = m.U, dc = this.dc, W = this.dcW, H = this.dcH;
    var xa = x0 < 0 ? -x0 : 0, xb = x0 + w > W ? W - x0 : w;   // BitBlt clips to the DIB
    for (var y = y0 < 0 ? -y0 : 0; y < h && y0 + y < H; y++) {
      var a = src + y * w + xa, o = (y0 + y) * W + x0 + xa;
      for (var x = xa; x < xb; x++) dc[o++] = U[a++] & 0xffffff;
    }
    s[0x45f4 >> 2] = w;
    s[0x45f8 >> 2] = h;
    s[0x45fc >> 2] = s[0x4378 >> 2];
  }

  /** vt+0x1d0 0x55c0cb97: the 350 x 320 canvas scaled to the window (8.8 factors, at most 3x) into a
   *  fresh buffer; when the window changed size, or every 17th frame, padded to the window with black. */
  scaleOut(): void {
    var m = this.m, s = m.I, cw = s[0x47a0 >> 2];
    s[0x47e0 >> 2] = ftol(s[0x467c >> 2] * 256 / cw);
    s[0x47e4 >> 2] = ftol(s[0x4680 >> 2] * 256 / s[0x47a8 >> 2]);
    if (s[0x47e0 >> 2] > 0x300) s[0x47e0 >> 2] = 0x300;
    if (s[0x47e4 >> 2] > 0x300) s[0x47e4 >> 2] = 0x300;
    s[0x4708 >> 2] = s[0x4444 >> 2];
    s[0x4704 >> 2] = s[0x4440 >> 2];
    s[0x439c >> 2] = s[0x4378 >> 2];
    s[0x4ce0 >> 2] = s[0x47e0 >> 2];
    s[0x4e78 >> 2] = cw;
    this.scaleLen();                               // vt+0x5c 0x55c0be6c
    s[0x4444 >> 2] = s[0x4e78 >> 2];
    s[0x4ce0 >> 2] = s[0x47e4 >> 2];
    s[0x4e78 >> 2] = s[0x47a8 >> 2];
    this.scaleLen();
    s[0x4440 >> 2] = s[0x4e78 >> 2];
    s[0x4370 >> 2] = 0;                            // vt+0x1a8 0x55c0202d: no row padding at 32 bpp
    s[0x4444 >> 2] += s[0x4370 >> 2];
    var p = m.malloc(Math.imul(s[0x4440 >> 2], s[0x4444 >> 2]) * 4);
    s = m.I;
    s[0x4668 >> 2] = p; s[0x4378 >> 2] = p; s[0x46c8 >> 2] = p;
    this.scaleRows();                              // vt+0x1d4 0x55c0c197
    s[0x439c >> 2] = s[0x46c8 >> 2];
    if (s[0x4664 >> 2]) { m.release(s[0x4664 >> 2]); s[0x4664 >> 2] = 0; }
    var ww = s[0x4444 >> 2], wh = s[0x4440 >> 2];
    s[0x4664 >> 2] = s[0x4668 >> 2];
    if (s[0x46cc >> 2] === 1 && (s[0x4680 >> 2] !== wh || s[0x467c >> 2] !== ww)) {
      s[0x4540 >> 2] = ww; s[0x453c >> 2] = wh;
      s[0x4544 >> 2] = ww << 2; s[0x4448 >> 2] = s[0x467c >> 2] << 2;
      s[0x4444 >> 2] = s[0x467c >> 2]; s[0x4440 >> 2] = s[0x4680 >> 2];
      if (ww > s[0x467c >> 2]) s[0x4444 >> 2] = ww;
      if (s[0x453c >> 2] > s[0x4680 >> 2]) s[0x4440 >> 2] = s[0x453c >> 2];
      s[0x4448 >> 2] = s[0x4444 >> 2] << 2;
      var q = m.malloc(Math.imul(s[0x4440 >> 2], s[0x4444 >> 2]) * 4);
      s = m.I;
      var U = m.U;
      s[0x4668 >> 2] = q; s[0x4378 >> 2] = q;
      var n = Math.imul(s[0x4680 >> 2], s[0x467c >> 2]) >>> 0, d = q >> 2;
      U.fill(s[0x4b34 >> 2] >>> 0, d, d + n);
      var a = s[0x439c >> 2] >> 2, rows = s[0x453c >> 2], cols = s[0x4540 >> 2], stride = s[0x4448 >> 2] >> 2;
      for (var r = 0; r < rows; r++) for (var c2 = 0; c2 < cols; c2++) U[d + r * stride + c2] = U[a++];
      s[0x439c >> 2] = s[0x46c8 >> 2];
      if (s[0x4664 >> 2]) { m.release(s[0x4664 >> 2]); s[0x4664 >> 2] = 0; }
      s[0x4664 >> 2] = s[0x4668 >> 2];
      s[0x4668 >> 2] = 0;
    }
  }

  /** vt+0x5c 0x55c0be6c: 0x4e78 := its length at scale 0x4ce0 */
  scaleLen(): void {
    var s = this.m.I, v = s[0x4ce0 >> 2];
    if (v === 0x100) return;
    if (v > 0x200 && v > 0x300) { s[0x4ce0 >> 2] = 0x300; v = 0x300; }
    s[0x4e78 >> 2] = scaledCount(s[0x4e78 >> 2], v, v < 0x100 ? 0 : v < 0x201 ? 1 : 2);
  }

  /** vt+0x1d4 0x55c0c197: DDA scale of 0x439c (0x4708 x 0x4704) into 0x46c8 by 0x47e0 / 0x47e4. */
  scaleRows(): void {
    var m = this.m, s = m.I, U = m.U, sx = s[0x47e0 >> 2] >>> 0, sy = s[0x47e4 >> 2] >>> 0;
    s[0x4b7c >> 2] = 0;
    if (sx <= 0xff) s[0x4e10 >> 2] = 0x100; else if (sx <= 0x200) s[0x4e10 >> 2] = 0x200; else if (sx <= 0x300) s[0x4e10 >> 2] = 0x2ff;
    if (sy <= 0xff) s[0x4e14 >> 2] = 0x100; else if (sy <= 0x200) s[0x4e14 >> 2] = 0x200; else if (sy <= 0x300) s[0x4e14 >> 2] = 0x2ff;
    else return;
    s[0x4b7c >> 2] = 0;
    s[0x470c >> 2] = s[0x4708 >> 2] << 2;
    var si = s[0x439c >> 2] >> 2, di = s[0x46c8 >> 2] >> 2;
    var rows = s[0x4704 >> 2] >>> 0;
    var e = (s[0x4e14 >> 2] - sy) >>> 0;
    if (sy > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
    var stepY = bswap(e);
    s[0x4b64 >> 2] = stepY;
    e = (s[0x4e10 >> 2] - sx) >>> 0;
    if (sx > 0x200) { e = (e + 1) >>> 0; if (e > 0xff) e = 0; }
    var stepX = bswap(e), pad = s[0x4370 >> 2] >>> 0, srcW = s[0x4708 >> 2] >>> 0, outW = s[0x4444 >> 2] >>> 0;
    var accY = 0, t: number, n: number, acc: number, px: number, i: number;
    for (;;) {
      // one source row (0x55c0c29f)
      n = srcW; acc = 0;
      if (sx <= 0x100) {
        for (;;) {
          U[di++] = U[si++];
          for (;;) { if (--n === 0) break; t = acc + stepX; acc = t >>> 0; if (t > 0xffffffff) { si++; continue; } break; }
          if (n === 0) break;
        }
      } else if (sx <= 0x200) {
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
      for (i = 0; i < pad; i++) U[di++] = s[0x4b34 >> 2] >>> 0;
      // rows (0x55c0c321)
      if (sy <= 0x100) {
        var next = false;
        for (;;) {
          if (--rows === 0) { s[0x4c5c >> 2] = 0; s[0x4b7c >> 2] = accY; return; }
          t = accY + stepY; accY = t >>> 0;
          if (t <= 0xffffffff) { next = true; break; }
          si += srcW;                              // carry: drop a source row
        }
        if (next) continue;
      } else if (sy <= 0x200) {
        if (--rows === 0) { s[0x4c5c >> 2] = 0; s[0x4b7c >> 2] = accY; return; }
        t = accY + stepY; accY = t >>> 0;
        if (t > 0xffffffff) continue;
        U.copyWithin(di, di - outW, di); di += outW;
      } else {
        U.copyWithin(di, di - outW, di); di += outW;
        if (--rows === 0) { s[0x4c5c >> 2] = 0; s[0x4b7c >> 2] = accY; return; }
        t = accY + stepY; accY = t >>> 0;
        if (t > 0xffffffff) continue;
        U.copyWithin(di, di - outW, di); di += outW;
      }
    }
  }

  // ---------------------------------------------------------------- one layer (vt+0x19c 0x55c02b33)
  /** Render the current layer (obj+0x44a8): its effects chain (ping-ponging between the layer's two
   *  work buffers, only when it is dirty 3), the scale to its projected size, the clip, then the draw
   *  onto the target (obj+0x4378, 0x4444 wide; the canvas, or a layer image for the bar presets). */
  renderLayer(): void {
    var m = this.m, s = m.I, F = m.F, k = s[0x44a8 >> 2], b = LY(k), x = XF(k);
    s[0x4540 >> 2] = s[b + lf(0x7f4)];
    s[0x4708 >> 2] = s[b + lf(0x7f4)];
    s[0x453c >> 2] = s[b + lf(0x7f8)];
    s[0x4704 >> 2] = s[b + lf(0x7f8)];
    s[0x439c >> 2] = s[b + lf(0x794)];
    s[0x43bc >> 2] = s[b + lf(0x794)];
    s[0x4398 >> 2] = s[b + lf(0x82c)];
    s[0x4374 >> 2] = s[b + lf(0x828)];
    var self = this, fail = false;
    var fx = function (fn: () => void): boolean {   // swapBuffers, then the effect; false = abandon the layer
      if (!self.swapBuffers()) { fail = true; return false; }
      fn();
      return true;
    };
    doit: {
      if (s[0x439c >> 2] === 0) { fail = true; break doit; }
      s[0x4df4 >> 2] = s[b + lf(0x7e4)];
      if (s[b + lf(0x810)] === 1) {
        s[0x4c74 >> 2] = s[b + lf(0x814)]; s[0x4c7c >> 2] = s[b + lf(0x818)];
        s[0x4540 >> 2] = s[b + lf(0x81c)]; s[0x453c >> 2] = s[b + lf(0x820)];
      } else {
        s[0x4c74 >> 2] = s[b + lf(0x780)]; s[0x4c7c >> 2] = s[b + lf(0x784)];
        s[0x4540 >> 2] = s[b + lf(0x79c)]; s[0x453c >> 2] = s[b + lf(0x7a0)];
      }
      s[0x4f18 >> 2] = s[0x4540 >> 2];
      s[0x4f14 >> 2] = s[0x453c >> 2];
      this.clipRect();                             // vt+0x30 0x55c0356c
      if (s[0x45d4 >> 2] === 0) break doit;        // off the target: straight to the tail (no dirty := 1)
      s[0x4cf4 >> 2] = s[b + lf(0x7f4)];
      s[0x4ce8 >> 2] = s[b + lf(0x7f8)];
      var glow = false;
      if (s[b + lf(0x950)] === 3) { s[b + lf(0x950)] = 2; glow = true; }
      else if (s[b + lf(0x850)] !== 0 && s[0x4398 >> 2] === 0) glow = true;
      if (glow) {
        if (s[0x4398 >> 2] === 0) {
          this.allocEdge();                        // vt+0x10c 0x55c03b47
          s = m.I;
          if (s[0x4398 >> 2] === 0) { fail = true; break doit; }
        }
        this.edgeDistance();                       // vt+0x140 0x55c04c2c
      }
      s = m.I; F = m.F;
      if ((s[b + lf(0x864)] !== 0 && s[b + lf(0x860)] !== 0) || (s[b + lf(0x850)] !== 0 && s[b + lf(0x84c)] !== 0) ||
          s[b + lf(0x8f4)] !== 0) this.glowRing();  // vt+0x12c 0x55c06f06
      s = m.I; F = m.F;
      if (s[b + lf(0x77c)] === 3) {
        s[b + lf(0x824)] = 0;
        if (F[x + xf(0x10c)] !== 0 || F[x + xf(0x110)] !== 0) { if (!fx(() => this.shift())) break doit; }   // 0x55c0b2ce
        s = m.I; F = m.F;
        var r0 = F[x + xf(0xf0)] !== 0, r1 = F[x + xf(0xf4)] !== 0, r2 = F[x + xf(0xf8)] !== 0, r3 = F[x + xf(0xfc)] !== 0;
        if (((r3 || r2 || r1) && r0) || (s[b + lf(0x8e4)] !== 0 && F[x + xf(0xd8)] !== 0) || s[b + lf(0x894)] !== 0 ||
            s[b + lf(0x890)] !== 0 || s[b + lf(0x88c)] !== 0 || F[x + xf(0xbc)] !== 0 || F[x + xf(0xc0)] !== 0 ||
            F[x + xf(0xd0)] !== 0 || F[x + xf(0xcc)] !== 0 || F[x + xf(0xc8)] !== 0 || F[x + xf(0xc4)] !== 0) {
          if (!fx(() => this.warp())) break doit;          // vt+0x94 0x55c07811
        }
        s = m.I; F = m.F;
        if (s[b + lf(0x904)] !== 0) { if (!fx(unported(0x55c0a9d8))) break doit; }
        s = m.I; F = m.F;
        if ((s[b + lf(0x848)] !== 0 || s[b + lf(0x844)] !== 0 || s[b + lf(0x840)] !== 0) && ftol(F[x + xf(0x88)]) !== 0 &&
            s[b + lf(0x8bc)] !== 0 && s[b + lf(0x8b8)] === 1) { if (!fx(unported(0x55c089e8))) break doit; }
        s = m.I;
        if (s[b + lf(0x834)] !== 0 || s[b + lf(0x838)] !== 0 || s[b + lf(0x83c)] !== 0 || s[b + lf(0x85c)] !== 0 ||
            s[b + lf(0x868)] !== 0) { if (!fx(() => this.ripple())) break doit; }   // vt+0x9c 0x55c0601a
        s = m.I;
        if (s[b + lf(0x830)] >= 2) { if (!fx(unported(0x55c0b7f0))) break doit; }
        s = m.I; F = m.F;
        if (F[x + xf(0x11c)] !== 0 || F[x + xf(0x120)] !== 0) { if (!fx(unported(0x55c0b9bc))) break doit; }
        s = m.I;
        if (s[b + lf(0x858)] !== 0) { if (!fx(() => this.melt())) break doit; }   // vt+0xa0 0x55c0ae1e
      }
      s = m.I;
      var sel = s[b + lf(0x824)], buf: number;
      if (sel === 1 || sel === 2) {
        buf = s[b + lf(sel === 1 ? 0x828 : 0x90c)];
        if (buf === 0) { fail = true; break doit; }
        s[0x439c >> 2] = buf;
      } else if (sel === 3) {
        buf = s[b + lf(0x82c)];
        if (buf === 0) { fail = true; break doit; }
        s[0x4df4 >> 2] = -1;
        s[0x439c >> 2] = buf;
      }
      if (s[b + lf(0x910)] === -1 || s[b + lf(0x910)] === 1) { fail = true; break doit; }
      var sc = s[b + lf(0x798)];
      s[0x4ce0 >> 2] = sc;
      var swapped = false;
      if (sc === 0 || (sc >= 0xfe && sc <= 0x102)) {
        if (s[0x4520 >> 2] === 1) {
          s[0x4540 >> 2] = s[0x4f18 >> 2]; s[0x453c >> 2] = s[0x4f14 >> 2];
          this.clipCopy();                         // vt+0x8c 0x55c03790
          s = m.I;
          if (s[b + lf(0x830)] === 1 && s[0x4398 >> 2] !== 0) {
            s[0x4540 >> 2] = s[0x4f18 >> 2]; s[0x453c >> 2] = s[0x4f14 >> 2];
            s[0x4c08 >> 2] = s[0x439c >> 2]; s[0x439c >> 2] = s[0x4398 >> 2];
            this.clipCopy();
            swapped = true;
          }
        }
      } else if (s[0x4520 >> 2] === 0) {
        this.scaleSprite();                        // vt+0x54 0x55c0bf7a
        s = m.I;
        if (s[0x4398 >> 2] !== 0) {
          s[0x4c08 >> 2] = s[0x439c >> 2]; s[0x439c >> 2] = s[0x4398 >> 2];
          this.scaleSprite();
          swapped = true;
        }
      } else {
        s[0x4540 >> 2] = (s[0x4f18 >> 2] - s[0x44f4 >> 2] - s[0x44e8 >> 2]) | 0;
        s[0x453c >> 2] = (s[0x4f14 >> 2] - s[0x4500 >> 2] - s[0x44d8 >> 2]) | 0;
        if (s[0x4700 >> 2] === 1) s[0x4c7c >> 2] = s[0x4f24 >> 2];
        else if (s[0x46f4 >> 2] === 1) s[0x4c7c >> 2] = (s[0x4f24 >> 2] + s[0x4440 >> 2] - s[0x453c >> 2]) | 0;
        this.scaleSpriteClipped();                 // vt+0xb0 0x55c0bec4
        s = m.I;
        if (s[0x4398 >> 2] !== 0) {
          s[0x4540 >> 2] = (s[0x4f18 >> 2] - s[0x44f4 >> 2] - s[0x44e8 >> 2]) | 0;
          s[0x453c >> 2] = (s[0x4f14 >> 2] - s[0x4500 >> 2] - s[0x44d8 >> 2]) | 0;
          s[0x4c08 >> 2] = s[0x439c >> 2]; s[0x439c >> 2] = s[0x4398 >> 2];
          this.scaleSpriteClipped();
          swapped = true;
        }
      }
      s = m.I;
      if (swapped) { s[0x4398 >> 2] = s[0x439c >> 2]; s[0x439c >> 2] = s[0x4c08 >> 2]; }
      if (s[0x456c >> 2] === 1) { unported(0x55c05162)(); break doit; }
      this.draw();                                 // vt+0x144 0x55c052c6
      fail = true;                                 // falls into the dirty := 1 tail
    }
    s = m.I;
    if (fail && s[0x4484 >> 2] === 0) s[LY(s[0x44a8 >> 2]) + lf(0x77c)] = 1;
    s[0x4cf0 >> 2] = 0; s[0x4ba4 >> 2] = 0; s[0x4be8 >> 2] = 0; s[0x4c00 >> 2] = 0;
  }

  /** vt+0xd8 0x55c033e1: next work buffer: obj+0x439c = what the last effect wrote, obj+0x4374 = where
   *  the next one writes (the layer's two buffers 0x828 / 0x90c, allocated on first use). */
  swapBuffers(): boolean {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]), sel = s[b + lf(0x824)];
    if (sel === 0 || sel === 2) {
      s[0x439c >> 2] = s[b + lf(sel === 0 ? 0x794 : 0x90c)];
      if (s[b + lf(0x828)] === 0) {
        this.allocWork(0x828);                     // vt+0x108 0x55c03bdf
        s = m.I;
        if (s[0x4374 >> 2] === 0) return false;
      }
      s[0x4374 >> 2] = s[b + lf(0x828)];
      s[b + lf(0x824)] = 1;
      return true;
    }
    if (sel === 1) {
      s[0x439c >> 2] = s[b + lf(0x828)];
      if (s[b + lf(0x90c)] === 0) {
        this.allocWork(0x90c);                     // vt+0x104 0x55c03c35
        s = m.I;
        if (s[0x4374 >> 2] === 0) return false;
      }
      s[0x4374 >> 2] = s[b + lf(0x90c)];
      s[b + lf(0x824)] = 2;
      return true;
    }
    return false;
  }
  /** 0x55c03bdf / 0x55c03c35: a layer work buffer (w*h*4 + 8, not cleared). The dword just past it is, in
   *  the DLL, the Windows heap's header of the next block, and barStrip reads it as a pixel (a bin at 255
   *  over a 3 x 256 ramp in a work buffer: Rhythmic Colors, Neon Highway). That header is encoded with a
   *  per-process random key, so the real DLL differs from run to run there; HEAP_NEXT stands in (what one
   *  real run had). Written into this block's padding, which nothing else touches. */
  allocWork(field: number): void {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]);
    var n = Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f4)]) * 4 + 8;
    var p = m.malloc(n);
    s = m.I;
    s[0x4374 >> 2] = p;
    if (p) {
      s[b + lf(field)] = p;
      if (((n + 15) & ~15) - n >= 4) m.U[(p + n) >> 2] = HEAP_NEXT;
    }
  }
  /** vt+0x10c 0x55c03b47: the edge-distance buffer (0x82c), cleared */
  allocEdge(): void {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]);
    var n = Math.imul(s[b + lf(0x7f8)], s[b + lf(0x7f4)]);
    var p = m.malloc(n * 4 + 8);
    s = m.I;
    s[0x4398 >> 2] = p;
    if (p) {
      s[b + lf(0x82c)] = p;
      s[0x4ec4 >> 2] = n;
      m.U.fill(0, p >> 2, (p >> 2) + (n >>> 0));
    }
  }
  /** vt+0x110 0x55c0397b: one of four scratch buffers (>= 0x453c * 0x4540 * 4) into obj+0x46c8 */
  scratch(): void {
    var m = this.m, s = m.I, need = Math.imul(Math.imul(s[0x453c >> 2], s[0x4540 >> 2]), 4);
    var slots = [[0x4cf0, 0x4b9c, 0x4cec], [0x4ba4, 0x4ba8, 0x4ba0], [0x4be8, 0x4bec, 0x4be4], [0x4c00, 0x4c04, 0x4bfc]];
    for (var i = 0; i < 4; i++) {
      var f = slots[i][0] >> 2, c = slots[i][1] >> 2, p = slots[i][2] >> 2;
      if (s[f] !== 0) continue;
      if (s[c] < need) {
        if (s[p]) m.release(s[p]);
        s[c] = need;
        var q = m.malloc(need);
        s = m.I;
        s[p] = q;
      }
      s[f] = 1;
      s[0x46c8 >> 2] = s[p];
      return;
    }
  }
  /** vt+0x1c8 0x55c03c8b: free the scratch slot whose buffer is obj+0x46ec */
  scratchRelease(): void {
    var s = this.m.I, v = s[0x46ec >> 2];
    if (v === s[0x4cec >> 2]) s[0x4cf0 >> 2] = 0;
    else if (v === s[0x4ba0 >> 2]) s[0x4ba4 >> 2] = 0;
    else if (v === s[0x4be4 >> 2]) s[0x4be8 >> 2] = 0;
    else if (v === s[0x4bfc >> 2]) s[0x4c00 >> 2] = 0;
  }

  /** vt+0x30 0x55c0356c: clip the sprite rect (0x4c74, 0x4c7c, 0x4540 x 0x453c) to the target rect
   *  (0x4f10, 0x4f24, 0x4444 x 0x4440), unsigned as the asm compares. 0x45d4 = visible. */
  clipRect(): void {
    var s = this.m.I;
    store(s, [0x45d4, 0, 0x4520, 0, 0x46f8, 0, 0x46fc, 0, 0x4700, 0, 0x46f4, 0, 0x4500, 0, 0x44d8, 0, 0x44f4, 0, 0x44e8, 0]);
    s[0x4c70 >> 2] = s[0x4540 >> 2];
    s[0x4c5c >> 2] = s[0x453c >> 2];
    var u = (o: number): number => s[o >> 2] >>> 0;
    var x = u(0x4c74);
    if (x >= 0x80000000) {
      s[0x4c74 >> 2] = 0; s[0x4c70 >> 2] = (x + s[0x4540 >> 2]) | 0; s[0x44e8 >> 2] = -x | 0; s[0x46f8 >> 2] = 1;
      if (s[0x4f10 >> 2] === 0) s[0x4520 >> 2] = 1;
    }
    var y = u(0x4c7c);
    if (y >= 0x80000000) {
      s[0x4c7c >> 2] = 0; s[0x4c5c >> 2] = (y + s[0x453c >> 2]) | 0; s[0x4500 >> 2] = -y | 0; s[0x4700 >> 2] = 1;
      if (s[0x4f24 >> 2] === 0) s[0x4520 >> 2] = 1;
    }
    var tx = u(0x4f10), ty = u(0x4f24);
    if (u(0x4c74) >= ((tx + s[0x4444 >> 2]) >>> 0)) return;
    if (((u(0x4c74) + s[0x4c70 >> 2]) >>> 0) <= tx) return;
    if (u(0x4c7c) >= ((ty + s[0x4440 >> 2]) >>> 0)) return;
    if (((u(0x4c7c) + s[0x4c5c >> 2]) >>> 0) <= ty) return;
    s[0x45d4 >> 2] = 1;
    var r = (tx + s[0x4444 >> 2]) >>> 0, sx = u(0x4c74), e = (sx + s[0x4c70 >> 2]) >>> 0;
    if (r < e) { s[0x44f4 >> 2] = (e - r) | 0; s[0x46fc >> 2] = 1; s[0x4520 >> 2] = 1; }
    if (tx > sx) { s[0x4c74 >> 2] = tx | 0; s[0x44e8 >> 2] = (s[0x44e8 >> 2] + (tx - sx)) | 0; s[0x46f8 >> 2] = 1; s[0x4520 >> 2] = 1; }
    var bt = (ty + s[0x4440 >> 2]) >>> 0, ey = (u(0x4c7c) + s[0x4c5c >> 2]) >>> 0;
    if (bt < ey) { s[0x44d8 >> 2] = (ey - bt) | 0; s[0x46f4 >> 2] = 1; s[0x4520 >> 2] = 1; }
    var sy = u(0x4c7c);
    if (sy < ty) { s[0x4500 >> 2] = (s[0x4500 >> 2] + (ty - sy)) | 0; s[0x4700 >> 2] = 1; s[0x4520 >> 2] = 1; }
  }

  /** vt+0x8c 0x55c03790: cut the visible part of the sprite into a scratch buffer. */
  clipCopy(): void {
    var m = this.m, s = m.I, U: Uint32Array;
    if (s[0x4700 >> 2] === 1) { s[0x4c7c >> 2] = s[0x4f24 >> 2]; s[0x453c >> 2] -= s[0x4500 >> 2]; }
    if (s[0x46f4 >> 2] === 1) {
      var c = s[0x44d8 >> 2];
      s[0x453c >> 2] -= c;
      var y = (s[0x4f24 >> 2] + s[0x4440 >> 2] - s[0x453c >> 2]) | 0;
      s[0x439c >> 2] = (s[0x439c >> 2] + Math.imul(s[0x4540 >> 2], c) * 4) | 0;
      s[0x4c7c >> 2] = y;
    }
    if (s[0x46fc >> 2] !== 1 && s[0x46f8 >> 2] !== 1) return;
    s[0x46f0 >> 2] = s[0x4540 >> 2];
    s[0x4540 >> 2] = (s[0x4540 >> 2] - s[0x44f4 >> 2] - s[0x44e8 >> 2]) | 0;
    this.scratch();
    s = m.I; U = m.U;
    s[0x44ec >> 2] = s[0x44e8 >> 2] << 2;
    var b = LY(s[0x44a8 >> 2]), skip = s[0x44f4 >> 2] << 2;
    if (s[b + lf(0x770)] === -1) {
      var k2 = s[b + lf(0x918)];
      s[0x4420 >> 2] = k2;
      s[0x4f08 >> 2] = (s[LY(k2) + lf(0x7f4)] - s[b + lf(0x7f4)]) << 2;
      s[0x439c >> 2] = (s[b + lf(0x794)] + Math.imul(s[LY(k2) + lf(0x7f4)], s[0x44d8 >> 2]) * 4) | 0;
      skip = (skip + s[0x4f08 >> 2]) | 0;
    }
    var a = s[0x439c >> 2], d = s[0x46c8 >> 2] >> 2, w = s[0x4540 >> 2], rows = s[0x453c >> 2];
    do {
      a = (a + s[0x44ec >> 2]) | 0;
      for (var i = 0; i < w; i++) { U[d++] = U[a >> 2]; a += 4; }
      a = (a + skip) | 0;
    } while (--rows !== 0);
    s[0x46ec >> 2] = s[0x439c >> 2];
    s[0x439c >> 2] = s[0x46c8 >> 2];
    this.scratchRelease();
  }

  /** vt+0x144 0x55c052c6: the layer onto the target, bottom row first (the images are stored bottom-up):
   *  a plain colour-keyed copy, or the blended draw (0x55c05562) when the layer has any colour effect. */
  draw(): void {
    var m = this.m, s = m.I, U = m.U;
    if (s[0x4540 >> 2] === 0 || s[0x439c >> 2] === 0 || s[0x453c >> 2] === 0) return;
    s[0x4544 >> 2] = s[0x4540 >> 2] << 2;
    s[0x4448 >> 2] = s[0x4444 >> 2] << 2;
    var k = s[0x44a8 >> 2], b = LY(k);
    if (s[b + lf(0x830)] === 1) {
      unported(0x55c05f4c)();
      if (s[b + lf(0x834)] !== 0 || s[b + lf(0x838)] !== 0 || s[b + lf(0x83c)] !== 0 || s[b + lf(0x85c)] !== 0 || s[b + lf(0x868)] !== 0) {
        s[0x4cf4 >> 2] = s[0x4540 >> 2]; s[0x4ce8 >> 2] = s[0x453c >> 2]; s[0x4374 >> 2] = s[0x439c >> 2];
        this.ripple();
        s = m.I; U = m.U;
      }
    }
    s[0x4f08 >> 2] = 0;
    var v918 = s[b + lf(0x918)];
    if ((s[b + lf(0x8c0)] !== 0 && s[b + lf(0x8b8)] === 1) || (s[b + lf(0x8f4)] !== 0 && s[b + lf(0x858)] !== 0) ||
        (s[b + lf(0x864)] !== 0 && s[b + lf(0x860)] !== 0) || (s[b + lf(0x850)] !== 0 && s[b + lf(0x84c)] !== 0) ||
        s[b + lf(0x940)] !== 0 || v918 === -1) { this.blend(); return; }
    if (s[b + lf(0x770)] === -1) {
      if (s[0x4520 >> 2] === 0) {
        s[0x4420 >> 2] = v918;
        s[0x4f08 >> 2] = (s[LY(v918) + lf(0x7f4)] - s[0x4540 >> 2]) << 2;
      } else s[0x4f08 >> 2] = 0;
      this.blend();                                // vt+0x154 0x55c05562
      return;
    }
    if (m.F[XF(k) + xf(0x124)] !== 0) { unported(0x55c05b99)(); return; }
    var d = (Math.imul((s[0x4c7c >> 2] + s[0x453c >> 2] - s[0x4f24 >> 2] - 1) | 0, s[0x4444 >> 2] << 2) +
             ((s[0x4c74 >> 2] - s[0x4f10 >> 2]) << 2) + s[0x4378 >> 2]) | 0;
    var a = s[0x439c >> 2] >> 2, w = s[0x4540 >> 2] >>> 0, rows = s[0x453c >> 2], key = s[0x4df4 >> 2] >>> 0;
    var up = (s[0x4544 >> 2] + s[0x4448 >> 2]) >> 2, di = d >> 2, i: number;
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

  /** vt+0x154 0x55c05562: per pixel by its alpha byte: 0 = copy, 255 = keep the target, else
   *  src*(1-a)+dst*a (+ the layer's two biases), optionally pulled toward a tint; the result's top byte is
   *  its red (BSWAP of r,r). obj+0x4f08 = extra source bytes per row. */
  blend(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, b = LY(s[0x44a8 >> 2]);
    if (s[b + lf(0x94c)] !== 0) { this.fade(); return; }   // vt+0x250 0x55c05ab7
    s[0x4448 >> 2] = s[0x4444 >> 2] << 2;
    s[0x4cf4 >> 2] = s[0x4540 >> 2];
    s[0x4ce8 >> 2] = s[0x453c >> 2];
    var c255 = 255;
    F[0x4ccc >> 2] = s[b + lf(0x874)] / c255;
    F[0x4cd0 >> 2] = s[b + lf(0x878)] / c255;
    F[0x4cdc >> 2] = s[b + lf(0x914)] / c255;
    s[0x4e58 >> 2] = s[b + lf(0x840)];
    s[0x4e54 >> 2] = s[b + lf(0x844)];
    s[0x4e4c >> 2] = s[b + lf(0x848)];
    var di = (Math.imul((s[0x4c7c >> 2] + s[0x453c >> 2] - s[0x4f24 >> 2] - 1) | 0, s[0x4444 >> 2] << 2) +
              ((s[0x4c74 >> 2] - s[0x4f10 >> 2]) << 2) + s[0x4378 >> 2]) >> 2;
    var si = s[0x439c >> 2];
    var key = s[0x4df4 >> 2] >>> 0, tint = s[b + lf(0x914)] !== 0;
    var tr = s[0x4e58 >> 2], tg = s[0x4e54 >> 2], tb = s[0x4e4c >> 2];
    var bias1 = F[0x4ccc >> 2], bias2 = F[0x4cd0 >> 2], kt = F[0x4cdc >> 2];
    for (;;) {
      var src = U[si >> 2];
      if (src !== key) {
        var a = (src & 0xff000000) >>> 0, out: number;
        if (a === 0) out = src;
        else if (a === 0xff000000) out = U[di];
        else {
          var sb = src & 0xff, sg = (src >>> 8) & 0xff, sr = (src >>> 16) & 0xff, dd = U[di];
          var db = dd & 0xff, dg = (dd >>> 8) & 0xff, dr = (dd >>> 16) & 0xff;
          var t10 = fr((src >>> 24) / c255), t14 = fr(1 - t10);
          t10 = fr(t10 + bias1);
          t14 = fr(t14 + bias2);
          var r = ftol(sr * t14 + dr * t10), bb = ftol(sb * t14 + db * t10), g = ftol(sg * t14 + dg * t10);
          if (tint) {
            if (tr !== 0) r = (r + ftol((tr - r) * kt * t10)) | 0;
            if (tb !== 0) bb = (bb + ftol((tb - bb) * kt * t10)) | 0;
            if (tg !== 0) g = (g + ftol((tg - g) * kt * t10)) | 0;
            if (r > 0xff) r = 0xff;
            if (bb > 0xff) bb = 0xff;
            if (g > 0xff) g = 0xff;
          }
          if (r < 0) r = 0;
          if (bb < 0) bb = 0;
          if (g < 0) g = 0;
          out = ((r << 24) | (r << 16) | (g << 8) | bb) >>> 0;
        }
        U[di] = out;
      }
      si += 4; di++;
      if (--s[0x4cf4 >> 2] !== 0) continue;
      var w = s[0x4540 >> 2];
      s[0x4cf4 >> 2] = w;
      di -= w + (s[0x4448 >> 2] >> 2);
      si = (si + s[0x4f08 >> 2]) | 0;
      if (--s[0x4ce8 >> 2] === 0) break;
    }
  }

  /** vt+0x250 0x55c05ab7: subtract the alpha byte from each channel (saturating); 255 = skip. */
  fade(): void {
    var m = this.m, s = m.I, U = m.U;
    s[0x4cf4 >> 2] = s[0x4540 >> 2];
    s[0x4448 >> 2] = (s[0x4444 >> 2] + s[0x4540 >> 2]) << 2;
    s[0x4ce8 >> 2] = s[0x453c >> 2];
    var di = (Math.imul((s[0x4c7c >> 2] + s[0x453c >> 2] - s[0x4f24 >> 2] - 1) | 0, s[0x4444 >> 2] << 2) +
              ((s[0x4c74 >> 2] - s[0x4f10 >> 2]) << 2) + s[0x4378 >> 2]) >> 2;
    var si = s[0x439c >> 2] >> 2, key = s[0x4df4 >> 2] >>> 0, w = s[0x4540 >> 2], up = s[0x4448 >> 2] >> 2;
    do {
      for (var i = 0; i < w; i++) {
        var px = U[si++];
        if (px !== key) {
          var a = px >>> 24;
          if (a === 0) U[di] = px;
          else if (a !== 0xff) {
            var r = ((px >>> 16) & 0xff) - a, g = ((px >>> 8) & 0xff) - a, bl = (px & 0xff) - a;
            U[di] = ((r < 0 ? 0 : r) << 16 | (g < 0 ? 0 : g) << 8 | (bl < 0 ? 0 : bl)) >>> 0;
          }
        }
        di++;
      }
      di -= up;
    } while (--s[0x4ce8 >> 2] !== 0);
  }

  /** vt+0xa8 0x55c0b2ce: scroll the layer by (0x10c, 0x110) pixels, wrapping (0x944 < 1 or > 3) or not;
   *  0x944 >= 3 starts from the image, else from its background colour. */
  shift(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0x44a8 >> 2], b = LY(k), x = XF(k);
    var w = s[b + lf(0x7f4)], h = s[b + lf(0x7f8)], n = Math.imul(h, w);
    s[0x4ec4 >> 2] = n;
    s[0x4390 >> 2] = s[0x4374 >> 2];
    s[0x4394 >> 2] = (s[0x4374 >> 2] + n * 4) | 0;
    s[0x43ec >> 2] = s[0x439c >> 2];
    s[0x4400 >> 2] = s[0x439c >> 2];
    s[0x43fc >> 2] = (s[0x439c >> 2] + n * 4) | 0;
    var dst = s[0x4390 >> 2] >> 2, src = s[0x43ec >> 2] >> 2, i: number, mode = s[b + lf(0x944)];
    if (mode >= 3) for (i = 0; i < (n >>> 0); i++) U[dst + i] = U[src + i];
    else U.fill(s[0x4df4 >> 2] >>> 0, dst, dst + (n >>> 0));
    var ox = x + xf(0x10c), oy = x + xf(0x110);
    for (;;) {                                     // offsets into (-w, w) and (-h, h)
      var W = w, H = h;
      if (W < F[ox]) { F[ox] = F[ox] - W; continue; }
      if (-W > F[ox]) { F[ox] = W + F[ox]; continue; }
      if (H < F[oy]) { F[oy] = F[oy] - H; continue; }
      if (-H > F[oy]) { F[oy] = H + F[oy]; continue; }
      break;
    }
    s[0x4dcc >> 2] = w;
    s[0x4dc8 >> 2] = h;
    var dx = ftol(F[ox]), dy = ftol(F[oy]);
    if (dx < 0) dx = -dx | 0;
    if (dy < 0) dy = -dy | 0;
    s[0x4dec >> 2] = dx; s[0x4df0 >> 2] = dy;
    var key = s[0x4df4 >> 2] >>> 0, noWrap = mode >= 1 && mode <= 3, pos = F[ox] > 0, posY = F[oy] > 0;
    var dyw = Math.imul(dy, w), row = 0, col = 0;
    for (i = 0; i < n; i++, col++) {
      if (col === w) { col = 0; row++; }           // i / w, i % w
      var px = U[src + i];
      if (px === key) continue;
      var t = dst + i;
      if (dx !== 0) {
        if (pos) {
          if (dx < w - col) t += dx;
          else if (noWrap) continue;
          else t += dx - w;
        } else {
          if (dx <= col) t -= dx;
          else if (noWrap) continue;
          else t += w - dx;
        }
      }
      if (dy !== 0) {
        if (posY) {
          if (dy < h - row) t += dyw;
          else if (noWrap) continue;
          else t += dyw - n;
        } else {
          if (dy <= row) t -= dyw;
          else if (noWrap) continue;
          else t += n - dyw;
        }
      }
      U[t] = px;
    }
    s[0x45cc >> 2] = n;
    s[0x4390 >> 2] = (s[0x4374 >> 2] + n * 4) | 0;
    s[0x43ec >> 2] = (s[0x439c >> 2] + n * 4) | 0;
    if (mode === 3 || mode === 2) {                // keep only the fractional part
      if (F[oy] >= 1) F[oy] = F[oy] - ftol(F[oy]);
      if (F[ox] >= 1) F[ox] = F[ox] - ftol(F[ox]);
      if (!(F[oy] > -1)) F[oy] = F[oy] - ftol(F[oy]);
      if (!(F[ox] > -1)) F[ox] = F[ox] - ftol(F[ox]);
    }
  }

  // ---------------------------------------------------------------- effects
  /** vt+0x140 0x55c04c2c: the edge-distance map (0x4398, low 16 bits per pixel): how far each opaque
   *  pixel (!= the colour key) is from the shape's edge, 1..255, by up to four directional passes
   *  (0x870 bits: 8 left-to-right, 4 right-to-left, 2 top-down, 1 bottom-up; 0 = all); the first key
   *  pixel after a run gets 0xffff OR'd in. 0x954 := the largest distance. */
  edgeDistance(): void {
    var m = this.m, s = m.I, U = m.U, b = LY(s[0x44a8 >> 2]);
    var md = s[b + lf(0x870)] & 0xf;
    if (md === 0) md = 0xf;
    s[0x4b60 >> 2] = md;
    var key = s[b + lf(0x7e4)] >>> 0;
    s[0x4df4 >> 2] = key;
    var w = s[b + lf(0x7f4)], h = s[b + lf(0x7f8)], n = Math.imul(w, s[b + lf(0x7f8)]);
    s[0x4ec4 >> 2] = n;
    s[0x4ec0 >> 2] = n << 2;
    s[0x4534 >> 2] = w;
    s[0x4cd8 >> 2] = w;
    var src = s[0x439c >> 2] >> 2, dst = s[0x4398 >> 2] >> 2;
    s[0x452c >> 2] = (s[0x439c >> 2] + (n << 2) - 4) | 0;
    s[0x4528 >> 2] = (s[0x4398 >> 2] + (n << 2) - 4) | 0;
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
    var lower = (q: number): void => {           // the "only if shorter" update of passes 4, 2 and 1
      if (U[src + q] !== key) {
        if (++e > 0xff) e = 0xff;
        v = U[dst + q] & 0xffff;
        if (v > e) { U[dst + q] = ((U[dst + q] & 0xffff0000) | e) >>> 0; if (e > mx) mx = e; }
      } else {
        if (e !== 0) e = 0xffff;
        U[dst + q] = (U[dst + q] | e) >>> 0;
        e = 0;
      }
    };
    s[0x4cd8 >> 2] = w;
    if (md & 4) {
      e = 0; cnt = w;
      for (i = (n >>> 0) - 1; i >= 0; i--) {
        lower(i);
        if (--cnt === 0) { e = 0; cnt = w; }
      }
    }
    s[0x4530 >> 2] = h; s[0x4cd4 >> 2] = h; s[0x4cd8 >> 2] = w << 2;
    if (md & 2) {
      e = 0;
      for (c = 0; c < w; c++) {
        for (r = 0, d = c; r < h; r++, d += w) lower(d);
        e = 0;
      }
    }
    s[0x4534 >> 2] = w; s[0x4530 >> 2] = h; s[0x4cd4 >> 2] = h; s[0x4cd8 >> 2] = w << 2;
    if (md & 1) {
      e = 0;
      for (c = 0; c < w; c++) {
        for (r = 0, d = (n >>> 0) - 1 - c; r < h; r++, d -= w) lower(d);
        e = 0;
      }
    }
    s[0x461c >> 2] = mx;
    s[b + lf(0x954)] = mx;
  }

  /** vt+0x12c 0x55c06f06: the alpha byte of the layer's image, in place: a ring of width 0x850 around
   *  the shape's edge (from the edge-distance map) fading by 0x84c, plus a brightness term (0x864 /
   *  0x860), on top of the transform's base alpha (0x124). Skipped while the parameter signature stored
   *  just before the pixels is unchanged. */
  glowRing(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0x44a8 >> 2], b = LY(k), x = XF(k), i: number;
    if (s[b + lf(0x950)] === 2) s[b + lf(0x950)] = 1;
    else {
      var sig = (s[b + lf(0x850)] + Math.imul(s[b + lf(0x84c)], 0xff) + (s[b + lf(0x864)] << 9) + s[b + lf(0x860)] +
                 ftol(F[x + xf(0x124)]) + Math.imul(s[b + lf(0x8f4)], 3) + s[b + lf(0x898)] + s[b + lf(0x89c)] + 1) | 0;
      s[0x4408 >> 2] = sig;
      var sp = (s[0x439c >> 2] - 4) >> 2;
      if (s[sp] === sig) return;
      s[sp] = sig;
    }
    var n = Math.imul(s[0x4cf4 >> 2], s[0x4ce8 >> 2]);
    s[0x473c >> 2] = n;
    var ring = s[b + lf(0x850)];
    s[0x4744 >> 2] = ring;
    F[0x4dd8 >> 2] = F[x + xf(0x124)];
    F[0x4e6c >> 2] = 0;
    F[0x4e68 >> 2] = 0;
    if (ring !== 0) {
      s[0x461c >> 2] = s[b + lf(0x954)];
      s[0x4e18 >> 2] = s[b + lf(0x84c)];
      s[0x4e64 >> 2] = s[b + lf(0x84c)] < 0 ? -s[b + lf(0x84c)] | 0 : s[b + lf(0x84c)];
      F[0x4630 >> 2] = s[0x4e64 >> 2];
      F[0x44e0 >> 2] = F[0x4630 >> 2] / ring;
      var r3 = (ring / 3) | 0;
      if (s[0x461c >> 2] < r3) F[0x4630 >> 2] = (r3 - s[0x461c >> 2]) * F[0x44e0 >> 2] + F[0x4630 >> 2];
    }
    var src = s[0x439c >> 2] >> 2, edge = s[0x4398 >> 2] >> 2, key = s[0x4df4 >> 2] >>> 0;
    if (s[b + lf(0x864)] === 0 && s[b + lf(0x860)] === 0 && F[x + xf(0x124)] === 0 && s[b + lf(0x84c)] >= 0 &&
        ring !== 0 && s[b + lf(0x84c)] !== 0) {
      var a0 = ftol(F[0x4630 >> 2]);                // 0x55c0777e: alpha = a0 * (1 - distance / ring)
      s[0x4e64 >> 2] = a0;
      for (i = 0; i < (n >>> 0); i++) {
        var p0 = U[src + i];
        if (p0 === key) continue;
        var d0 = U[edge + i] & 0xffff;
        if (d0 > (ring >>> 0)) continue;
        var q = (a0 - Math.floor((d0 * (a0 >>> 0)) / (ring >>> 0))) >>> 0;
        if (q > 0xff) q = 0xff;
        U[src + i] = ((p0 & 0xffffff) | (q << 24)) >>> 0;
      }
      s[0x473c >> 2] = 0;
      return;
    }
    var bright = s[b + lf(0x864)] !== 0 && s[b + lf(0x860)] !== 0;
    if (bright) {
      var t = s[b + lf(0x860)];
      s[0x4e7c >> 2] = t < 0 ? -t | 0 : 0xff - t;
      s[0x4e1c >> 2] = s[b + lf(0x864)];
      F[0x4638 >> 2] = s[0x4e1c >> 2];
      F[0x44e4 >> 2] = F[0x4638 >> 2] / 255;
    }
    var neg = s[0x4e18 >> 2] < 0, mode898 = s[b + lf(0x898)], mode89c = s[b + lf(0x89c)];
    for (i = 0; i < (n >>> 0); i++) {
      var px = U[src + i];
      if (px === key) continue;
      if (s[0x4744 >> 2] !== 0) {
        var d = U[edge + i] & 0xffff;
        if (neg) d = (s[0x461c >> 2] - d + 1) >>> 0;
        var v = d <= (s[0x4744 >> 2] >>> 0) ? d : 0;
        s[0x449c >> 2] = v;
        if (v !== 0) {
          if (mode898 === 0) F[0x4e6c >> 2] = F[0x4630 >> 2] - v * F[0x44e0 >> 2];
          if (mode898 === 1) F[0x4e6c >> 2] = s[0x4744 >> 2] !== v ? F[0x4630 >> 2] : F[0x4630 >> 2] / 2;
        }
      }
      if (bright) {
        var bb = px & 0xff, gg = (px >>> 8) & 0xff, rr = (px >>> 16) & 0xff, mx = rr;
        if (mx < gg) mx = gg;
        if (mx < bb) mx = bb;
        s[0x4634 >> 2] = mx;
        var lim = s[0x4e7c >> 2], pos = s[b + lf(0x860)] >= 0;
        if (mode89c === 0) {
          if (pos) { if (mx > lim) F[0x4e68 >> 2] = F[0x4638 >> 2] - (0xff - mx) * F[0x44e4 >> 2]; }
          else if (mx < lim) F[0x4e68 >> 2] = F[0x4638 >> 2] - mx * F[0x44e4 >> 2];
        }
        if (mode89c === 1) {
          if (lim === mx) F[0x4e68 >> 2] = (s[b + lf(0x864)] / 2) | 0;
          else if (pos) { if (mx > lim) F[0x4e68 >> 2] = s[b + lf(0x864)]; }
          else if (mx < lim) F[0x4e68 >> 2] = s[b + lf(0x864)];
        }
      }
      var a = ftol(F[0x4dd8 >> 2] + F[0x4e6c >> 2] + F[0x4e68 >> 2]);
      F[0x4e6c >> 2] = 0;
      F[0x4e68 >> 2] = 0;
      if (a > 0xff) a = 0xff;
      s[0x4e64 >> 2] = a;
      U[src + i] = bswap(((bswap(px) & 0xffffff00) | a) >>> 0);   // a < 0 smears into the colour, as the asm does
    }
    s[0x473c >> 2] = 0;
  }

  /** vt+0x94 0x55c07811: the per-pixel forward warp. Every opaque pixel's offset from the layer centre
   *  (0x880 / 0x884 shift it, optionally scaled by cos of a spin angle) goes through the enabled
   *  sub-transforms, then lands at the rounded-down result (out-of-image pixels are dropped). Many
   *  parameters can be multiplied by cos of one of the layer's two spin angles (0x8c8..0x8fc = 1 or 2).
   *  Note the loops run i = 0..n INCLUSIVE: one pixel past the image is warped too, as in the DLL. */
  warp(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, k = s[0x44a8 >> 2], b = LY(k), x = XF(k), i: number;
    var w = s[b + lf(0x7f4)], h = s[b + lf(0x7f8)], n = Math.imul(h, w);
    s[0x4ec4 >> 2] = n;
    s[0x4394 >> 2] = (s[0x4374 >> 2] + n * 4) | 0;
    var dst = s[0x4374 >> 2] >> 2, key = s[0x4df4 >> 2] >>> 0;
    U.fill(key, dst, dst + (n >>> 0));
    var A1 = x + xf(0xe0), A2 = x + xf(0xe8);
    var cosA = (fi: number): number => F[(0x37d8 >> 2) + ftol(F[fi])];
    var byAngle = (sel: number): number => sel === 1 ? A1 : sel === 2 ? A2 : -1;
    s[0x4d74 >> 2] = s[b + lf(0x880)];
    s[0x4d78 >> 2] = s[b + lf(0x884)];
    var ai = byAngle(s[b + lf(0x948)]);
    if (ai >= 0) {
      s[0x4d74 >> 2] = ftol(s[0x4d74 >> 2] * cosA(ai));
      s[0x4d78 >> 2] = ftol(s[0x4d78 >> 2] * cosA(ai));
    }
    s[0x4474 >> 2] = (((w / 2) | 0) + s[0x4d74 >> 2]) | 0;
    s[0x447c >> 2] = (((h / 2) | 0) + s[0x4d78 >> 2]) | 0;
    s[0x4dcc >> 2] = w;
    s[0x43ec >> 2] = s[0x439c >> 2];
    var c001 = fr(0.0010000000474974513);
    var P = (o: number): number => F[x + xf(o)];
    if (P(0xbc) !== 0 || P(0xc0) !== 0) {
      s[0x4dfc >> 2] = s[x + xf(0xbc)];
      F[0x4e00 >> 2] = P(0xc0);
      F[0x4df8 >> 2] = P(0xd4) * c001;
      ai = byAngle(s[b + lf(0x8c8)]);
      if (ai >= 0) { F[0x4dfc >> 2] = cosA(ai) * F[0x4dfc >> 2]; F[0x4e00 >> 2] = cosA(ai) * F[0x4e00 >> 2]; }
    }
    if (P(0xc8) !== 0 || P(0xc4) !== 0) {
      s[0x4e2c >> 2] = s[x + xf(0xc4)];
      F[0x4e40 >> 2] = P(0xc8);
      F[0x4e30 >> 2] = P(0xd4) * c001;
      ai = byAngle(s[b + lf(0x8cc)]);
      if (ai >= 0) { F[0x4e2c >> 2] = cosA(ai) * F[0x4e2c >> 2]; F[0x4e40 >> 2] = cosA(ai) * F[0x4e40 >> 2]; }
    }
    if (P(0xcc) !== 0 || P(0xd0) !== 0) {
      s[0x4e84 >> 2] = s[x + xf(0xcc)];
      F[0x4e88 >> 2] = P(0xd0);
      F[0x4e80 >> 2] = P(0xd4) * c001;
      F[0x4d20 >> 2] = 0;
      F[0x4d24 >> 2] = 0;
      ai = byAngle(s[b + lf(0x8d4)]);
      if (ai >= 0) F[0x4d20 >> 2] = F[ai];
      ai = byAngle(s[b + lf(0x8d8)]);
      if (ai >= 0) F[0x4d24 >> 2] = F[ai];
    }
    var d8 = P(0xd8), dd = d8 * d8 + d8 * d8;
    F[0x4804 >> 2] = dd;
    F[0x4800 >> 2] = 90 / dd;
    var e20 = s[b + lf(0x8e4)] * fr(0.009999999776482582);
    F[0x4e20 >> 2] = e20;
    if (s[b + lf(0x8ac)] === 1) F[0x4e20 >> 2] = e20 * cosA(A1);
    if (s[b + lf(0x8ac)] === 2) F[0x4e20 >> 2] = cosA(A2) * F[0x4e20 >> 2];
    var f0 = P(0xf0);
    F[0x4b30 >> 2] = f0 * f0 + f0 * f0;
    var c1e4 = fr(9.999999747378752e-05);
    F[0x4e34 >> 2] = P(0x100) * c1e4;
    F[0x4e38 >> 2] = P(0x104) * c1e4;
    F[0x4e3c >> 2] = P(0x108) * c1e4;
    s[0x4718 >> 2] = s[x + xf(0xf4)];
    s[0x471c >> 2] = s[x + xf(0xf8)];
    s[0x4720 >> 2] = s[x + xf(0xfc)];
    F[0x4d6c >> 2] = 1;
    F[0x4bc8 >> 2] = 1;
    ai = byAngle(s[b + lf(0x8ec)]);
    if (ai >= 0) F[0x4d6c >> 2] = cosA(ai);
    ai = byAngle(s[b + lf(0x8f0)]);
    if (ai >= 0) F[0x4bc8 >> 2] = cosA(ai);
    if (F[0x4d6c >> 2] < 0) F[0x4d6c >> 2] = -F[0x4d6c >> 2];
    if (F[0x4bc8 >> 2] < 0) F[0x4bc8 >> 2] = -F[0x4bc8 >> 2];
    F[0x4718 >> 2] = F[0x4718 >> 2] * F[0x4d6c >> 2];
    F[0x471c >> 2] = F[0x471c >> 2] * F[0x4d6c >> 2];
    F[0x4720 >> 2] = F[0x4d6c >> 2] * F[0x4720 >> 2];
    F[0x4e34 >> 2] = F[0x4e34 >> 2] * F[0x4bc8 >> 2];
    F[0x4e38 >> 2] = F[0x4bc8 >> 2] * F[0x4e38 >> 2];
    F[0x4e3c >> 2] = F[0x4e3c >> 2] * F[0x4bc8 >> 2];
    F[0x4ddc >> 2] = P(0xd4) * fr(0.10000000149011612);
    s[0x4de0 >> 2] = s[b + lf(0x88c)];
    s[0x4de4 >> 2] = s[b + lf(0x890)];
    s[0x4de8 >> 2] = s[b + lf(0x894)];
    if (F[0x4ddc >> 2] !== 0) {
      ai = byAngle(s[b + lf(0x8f8)]);
      if (ai >= 0) F[0x4ddc >> 2] = cosA(ai) * F[0x4ddc >> 2];
    }
    var sel8fc = s[b + lf(0x8fc)], j: number;
    for (j = 0; j < 3; j++) {                      // 0x4de0 / 0x4de4 / 0x4de8 -> 0x4bd0 / 0x4bd4 / 0x4bd8
      if (s[(0x4de0 >> 2) + j] === 0) continue;
      if (sel8fc === 1) s[(0x4de0 >> 2) + j] = ftol(F[A1]);
      if (sel8fc === 2) s[(0x4de0 >> 2) + j] = ftol(F[A2]);
      s[(0x4bd0 >> 2) + j] = s[(0x4de0 >> 2) + j];
    }
    var z = (o: number): boolean => P(o) === 0;
    var fz = z(0xf0) || (z(0xf4) && z(0xf8) && z(0xfc));
    var dz = s[b + lf(0x8e4)] === 0 || z(0xd8);
    var spin = s[b + lf(0x88c)] !== 0 || s[b + lf(0x890)] !== 0 || s[b + lf(0x894)] !== 0;
    var path: number;
    if (z(0xbc) && z(0xc0) && z(0xc8) && z(0xc4) && z(0xcc) && z(0xd0) && dz && fz) path = 0;     // swirl only
    else if ((fz && dz && !z(0xd0) && spin) || (!z(0xcc) && z(0xc4) && z(0xc8) && z(0xc0) && z(0xbc))) path = 1;
    else path = 2;
    s[0x45cc >> 2] = 0;
    if (path === 2) m.B[0x4578] = 1;
    var srcp = s[0x43ec >> 2] >> 2, cx = s[0x4474 >> 2], cy = s[0x447c >> 2], wu = w >>> 0, end = s[0x4394 >> 2] >>> 0;
    for (i = 0; i <= n; i++) {
      var px = U[srcp + i];
      if (px === key) continue;
      s[0x4c50 >> 2] = px;
      var row = ((i >>> 0) / wu) >>> 0, col = ((i >>> 0) % wu) >>> 0;
      s[0x475c >> 2] = row; s[0x4758 >> 2] = col;
      F[0x4760 >> 2] = (col - cx) | 0;
      F[0x4764 >> 2] = (row - cy) | 0;
      if (path === 0) this.swirl();                 // vt+0x26c 0x55c0a7b5
      else if (path === 1) { this.wave(); this.swirl(); }   // vt+0x268 0x55c09e5f
      else {
        if (P(0xbc) !== 0 || P(0xc0) !== 0) unported(0x55c09c48)();
        if (P(0xc8) !== 0 || P(0xc4) !== 0) unported(0x55c099b2)();
        if (P(0xcc) !== 0 || P(0xd0) !== 0) this.wave();
        if (P(0xd8) !== 0 && s[b + lf(0x8e4)] !== 0) unported(0x55c0a239)();
        if (P(0xf0) !== 0 && (P(0xf4) !== 0 || P(0xf8) !== 0 || P(0xfc) !== 0)) unported(0x55c0a528)();
        if (spin) this.swirl();
      }
      var X = (ftol(F[0x4760 >> 2]) + cx) | 0;
      s[0x4c2c >> 2] = X;
      var Y = (ftol(F[0x4764 >> 2]) + s[0x447c >> 2]) | 0;
      s[0x4c34 >> 2] = Y;
      if (Y >= h || X >= w || Y < 0 || X < 0) continue;
      var t = (s[0x4374 >> 2] + (Math.imul(Y, w) + X) * 4) >>> 0;
      s[0x4390 >> 2] = t | 0;
      if (t >= end) continue;
      if (path === 2 && m.B[0x4578] === 0 && U[t >> 2] !== key) continue;
      U[t >> 2] = px;
    }
    s[0x45cc >> 2] = i;
    s[0x43ec >> 2] = (s[0x439c >> 2] + i * 4) | 0;
  }

  /** vt+0x26c 0x55c0a7b5: spin by distance (angle -= r^2 * 0x4ddc, per axis 0x88c / 0x890 / 0x894),
   *  then rotate by the third and scale each axis by the cos of the other two. The sin/cos lookups at
   *  (360 - a) read 0x3d78 - 4a / 0x4318 - 4a, i.e. cos(a) and sin(-a); a = 0 reads sin(0) = 0. */
  swirl(): void {
    var s = this.m.I, F = this.m.F, b = LY(s[0x44a8 >> 2]);
    if (F[0x4ddc >> 2] !== 0) {
      var X = F[0x4760 >> 2], Y = F[0x4764 >> 2];
      var r2 = ftol(X * X + Y * Y);
      s[0x4e24 >> 2] = r2;
      var axes = [0x88c, 0x890, 0x894], base = [0x4bd0, 0x4bd4, 0x4bd8], out = [0x4de0, 0x4de4, 0x4de8];
      for (var j = 0; j < 3; j++) {
        if (s[b + lf(axes[j])] === 0) continue;
        var v = (s[base[j] >> 2] - ftol(r2 * F[0x4ddc >> 2])) | 0;
        while (v < 0) v = (v + 0x168) | 0;
        if (v > 0x167) v = (v >>> 0) % 0x168;
        s[out[j] >> 2] = v;
      }
    }
    var x0 = F[0x4760 >> 2];
    s[0x4dc0 >> 2] = s[0x4760 >> 2];
    var a = s[0x4de8 >> 2];
    if (a !== 0) {
      F[0x4760 >> 2] = F[0xf5e - a] * F[0x4760 >> 2] - F[0x10c6 - a] * F[0x4764 >> 2];
      F[0x4764 >> 2] = F[0x10c6 - a] * F[0x4dc0 >> 2] + F[0xf5e - a] * F[0x4764 >> 2];
    }
    void x0;
    if (s[b + lf(0x88c)] !== 0) F[0x4764 >> 2] = F[0xf5e - s[0x4de0 >> 2]] * F[0x4764 >> 2];
    if (s[b + lf(0x890)] !== 0) F[0x4760 >> 2] = F[0xf5e - s[0x4de4 >> 2]] * F[0x4760 >> 2];
  }

  /** vt+0x268 0x55c09e5f: the sine-ripple: each axis displaced by cos(|f(other axis)| * 0xcc + phase)
   *  times an amplitude that grows with the square of the position (0x8dc picks f; >12 changes the
   *  amplitude law too). */
  wave(): void {
    var s = this.m.I, F = this.m.F, k = s[0x44a8 >> 2], b = LY(k), x = XF(k);
    var X = F[0x4760 >> 2], Y = F[0x4764 >> 2];
    s[0x4dc0 >> 2] = s[0x4760 >> 2];
    s[0x4dc4 >> 2] = s[0x4764 >> 2];
    var md = s[b + lf(0x8dc)], add = s[b + lf(0x8e0)], k80 = F[0x4e80 >> 2];
    if (md <= 0xc) {
      s[0x4b98 >> 2] = md;
      F[0x4c18 >> 2] = Y * Y * k80 + add;
      F[0x4c1c >> 2] = k80 * X * X + add;
    } else {
      md = (md - 13) | 0;
      s[0x4b98 >> 2] = md;
      var t = k80 * Y;
      F[0x4c18 >> 2] = t * X + add;
      F[0x4c1c >> 2] = t * Y + add;
    }
    var h5 = fr(0.5);
    switch (md) {
      case 0: s[0x4dc0 >> 2] = s[0x4760 >> 2]; s[0x4dc4 >> 2] = s[0x4764 >> 2]; break;
      case 1: F[0x4dc0 >> 2] = X * h5; break;
      case 2: F[0x4dc4 >> 2] = Y * h5; break;
      case 3: F[0x4dc0 >> 2] = X * h5; F[0x4dc4 >> 2] = Y * h5; break;
      case 4: F[0x4dc0 >> 2] = X * X; break;
      case 5: F[0x4dc4 >> 2] = Y * Y; break;
      case 6: F[0x4dc0 >> 2] = X * X; F[0x4dc4 >> 2] = Y * Y; break;
      case 7: F[0x4dc0 >> 2] = Y * X; break;
      case 8: F[0x4dc4 >> 2] = Y * X; break;
      case 9: F[0x4dc0 >> 2] = Y * X; F[0x4dc4 >> 2] = Y * X; break;
      case 10: F[0x4dc4 >> 2] = Y * Y / X; break;
      case 11: F[0x4dc0 >> 2] = X * X / Y; break;
      case 12: F[0x4dc0 >> 2] = X * X / Y; F[0x4dc4 >> 2] = Y * Y / X; break;
    }
    var a: number;
    if (F[x + xf(0xcc)] !== 0) {
      if (F[0x4dc4 >> 2] < 0) F[0x4dc4 >> 2] = -F[0x4dc4 >> 2];
      a = ftol(F[0x4dc4 >> 2] * F[x + xf(0xcc)] + F[0x4d20 >> 2]);
      if (a < 0) a = -a | 0;
      if (a > 0x167) a = (a >>> 0) % 0x168;
      s[0x4690 >> 2] = a;
      F[0x4760 >> 2] = F[(0x37d8 >> 2) + a] * F[0x4c18 >> 2] + F[0x4760 >> 2];
    }
    if (F[x + xf(0xd0)] !== 0) {
      if (F[0x4dc0 >> 2] < 0) F[0x4dc0 >> 2] = -F[0x4dc0 >> 2];
      a = ftol(F[0x4dc0 >> 2] * F[x + xf(0xd0)] + F[0x4d24 >> 2]);
      if (a < 0) a = -a | 0;
      if (a > 0x167) a = (a >>> 0) % 0x168;
      s[0x4694 >> 2] = a;
      F[0x4764 >> 2] = F[(0x37d8 >> 2) + a] * F[0x4c1c >> 2] + F[0x4764 >> 2];
    }
  }

  /** vt+0x54 0x55c0bf7a / vt+0xb0 0x55c0bec4: scale the sprite (0x439c, 0x4708 x 0x4704) by 0x4ce0
   *  (8.8) into a scratch buffer, whole or (clipped) skipping 0x44e8 output columns / 0x44d8 rows; the
   *  result replaces 0x439c. */
  scaleSprite(): void { this.scaleSpriteAny(false); }
  scaleSpriteClipped(): void { this.scaleSpriteAny(true); }
  scaleSpriteAny(clipped: boolean): void {
    var s = this.m.I, v = s[0x4ce0 >> 2];
    if (v === 0 || (v >= 0xfe && v <= 0x102)) return;
    this.scratch();
    s = this.m.I;
    v = s[0x4ce0 >> 2];
    var f: number;
    if (v < 0x100) f = 0;
    else if (v < 0x201) f = 1;
    else { if (v > 0x300) s[0x4ce0 >> 2] = 0x300; f = 2; }
    if (clipped) this.ddaClipped(f); else this.ddaSprite(f);
    s[0x46ec >> 2] = s[0x439c >> 2];
    s[0x439c >> 2] = s[0x46c8 >> 2];
    this.scratchRelease();
  }
  /** 0x55c0c4b1 / 0x55c0c536 / 0x55c0c5c5 (f = 0 / 1 / 2), register for register */
  ddaSprite(f: number): void {
    var s = this.m.I, U = this.m.U, v = s[0x4ce0 >> 2];
    s[0x4b7c >> 2] = 0;
    if (f === 0) s[0x470c >> 2] = s[0x4708 >> 2] << 2;
    var esi = s[0x439c >> 2] >>> 0, edi = s[0x46c8 >> 2] >>> 0, rows = s[0x4704 >> 2] >>> 0;
    var e = f === 0 ? (0x100 - v) >>> 0 : f === 1 ? (0x200 - v) >>> 0 : (0x2ff - v + 1) >>> 0;
    if (f === 2 && e > 0xff) e = 0;
    var edx = bswap(e), ebx: number, ecx: number, eax: number, t: number, acc = 0, i: number;
    var dup = (): void => {                        // copy the last output row (0x4540 pixels) below itself
      var nn = s[0x4540 >> 2], bb = nn * 4;
      edi = (edi - bb) >>> 0;
      for (i = 0; i < nn; i++) { U[(edi + bb) >> 2] = U[edi >> 2]; edi = (edi + 4) >>> 0; }
      edi = (edi + bb) >>> 0;
    };
    for (;;) {
      ecx = s[0x4708 >> 2] >>> 0; ebx = 0;
      if (f === 0) {
        row0: for (;;) {
          U[edi >> 2] = U[esi >> 2]; edi += 4;
          for (;;) {
            esi += 4;
            if (--ecx === 0) break row0;
            t = ebx + edx; ebx = t >>> 0;
            if (t <= 0xffffffff) break;
          }
        }
        for (;;) {                                 // 0x55c0c514
          if (--rows === 0) { s[0x4c5c >> 2] = 0; s[0x4b7c >> 2] = acc; return; }
          t = acc + edx; acc = t >>> 0;
          if (t <= 0xffffffff) break;
          esi += s[0x470c >> 2];
        }
        continue;
      }
      for (;;) {
        eax = U[esi >> 2];
        U[edi >> 2] = eax; edi += 4;
        if (f === 2) { U[edi >> 2] = eax; edi += 4; }
        esi += 4;
        if (--ecx === 0) break;
        t = ebx + edx; ebx = t >>> 0;
        if (t > 0xffffffff) continue;
        U[edi >> 2] = eax; edi += 4;
      }
      if (f === 2) dup();
      if (--rows === 0) { s[0x4c5c >> 2] = 0; s[0x4b7c >> 2] = acc; return; }
      t = acc + edx; acc = t >>> 0;
      if (t > 0xffffffff) continue;
      dup();
    }
  }
  /** 0x55c0c681 / 0x55c0c75c / 0x55c0c8e9 (f = 0 / 1 / 2): the same scale, emitting only output rows
   *  past 0x44d8 and columns past 0x44e8, 0x4540 x 0x453c of them. Transliterated label by label. */
  ddaClipped(f: number): void {
    var s = this.m.I, U = this.m.U, v = s[0x4ce0 >> 2];
    s[0x4514 >> 2] = 0; s[0x460c >> 2] = 0; s[0x4b7c >> 2] = 0;
    s[0x4c94 >> 2] = s[0x44d8 >> 2];
    if (f === 0) s[0x470c >> 2] = s[0x4708 >> 2] << 2;
    if (f === 2) s[0x4c5c >> 2] = s[0x4704 >> 2];
    var esi = s[0x439c >> 2] >>> 0, edi = s[0x46c8 >> 2] >>> 0;
    var e = f === 0 ? (0x100 - v) >>> 0 : f === 1 ? (0x200 - v) >>> 0 : (0x2ff - v + 1) >>> 0;
    if (f === 2 && e > 0xff) e = 0;
    var edx = bswap(e), ebx = 0, ecx = 0, eax = 0, t: number, saved = 0, i: number;
    var u = (o: number): number => s[o >> 2] >>> 0;
    var inc = (o: number): void => { s[o >> 2] = (s[o >> 2] + 1) | 0; };
    var dupRow = (): void => {
      var nn = s[0x4540 >> 2], bb = nn * 4;
      edi = (edi - bb) >>> 0;
      for (i = 0; i < nn; i++) { U[(edi + bb) >> 2] = U[edi >> 2]; edi = (edi + 4) >>> 0; }
      edi = (edi + bb) >>> 0;
    };
    var acc = (): boolean => { t = u(0x4b7c) + edx; s[0x4b7c >> 2] = t | 0; return t > 0xffffffff; };
    var pc = 0;
    if (f === 0) {
      // 0x55c0c681
      for (;;) switch (pc) {
        case 0:                                    // 6d6
          inc(0x460c);
          if (u(0x4c94) >= u(0x460c)) { pc = 0x734; continue; }
          if (u(0x453c) <= u(0x4514)) return;
          inc(0x4514);
          saved = esi; ebx = 0; eax = u(0x44e8);
          if (eax === 0) { pc = 0x71a; continue; }
          pc = 0x711; continue;
        case 0x70e: eax = (eax - 1) >>> 0; if (eax === 0) { pc = 0x71a; continue; } pc = 0x711; continue;
        case 0x711: esi += 4; t = ebx + edx; ebx = t >>> 0; pc = t > 0xffffffff ? 0x711 : 0x70e; continue;
        case 0x71a: ecx = u(0x4540); pc = 0x720; continue;
        case 0x720: U[edi >> 2] = U[esi >> 2]; edi += 4; ecx = (ecx - 1) >>> 0; if (ecx === 0) { pc = 0x733; continue; } pc = 0x72a; continue;
        case 0x72a: esi += 4; t = ebx + edx; ebx = t >>> 0; pc = t > 0xffffffff ? 0x72a : 0x720; continue;
        case 0x733: esi = saved; pc = 0x734; continue;
        case 0x734: esi += u(0x4708) * 4; pc = 0x742; continue;
        case 0x742: if (!acc()) { pc = 0; continue; } esi += u(0x470c); pc = 0x742; continue;
      }
    }
    // the shared "emit one row from source row esi, skipping 0x44e8 output columns" of c75c / c8e9
    var emit = (): void => {
      saved = esi;
      ebx = 0; ecx = u(0x4540); eax = u(0x44e8);
      var q = eax === 0 ? 3 : 1;
      if (f === 1) {
        for (;;) switch (q) {
          case 1:                                  // 7e1
            eax = (eax - 1) >>> 0; if (eax === 0) { q = 4; continue; }
            t = ebx + edx; ebx = t >>> 0; if (t > 0xffffffff) { q = 0; continue; }
            eax = (eax - 1) >>> 0; if (eax !== 0) { q = 0; continue; }
            esi += 4; q = 3; continue;
          case 0: esi += 4; q = 1; continue;       // 7de
          case 4: eax = U[esi >> 2]; esi += 4; q = 5; continue;   // 7f0 -> 804
          case 3:                                  // 7f7
            eax = U[esi >> 2]; U[edi >> 2] = eax; edi += 4; esi += 4;
            ecx = (ecx - 1) >>> 0; if (ecx === 0) { esi = saved; return; }
            q = 5; continue;
          case 5:                                  // 804
            t = ebx + edx; ebx = t >>> 0; if (t > 0xffffffff) { q = 3; continue; }
            U[edi >> 2] = eax; edi += 4;
            ecx = (ecx - 1) >>> 0; if (ecx !== 0) { q = 3; continue; }
            esi = saved; return;
        }
      }
      // f === 2: c983..c9be
      q = eax === 0 ? 3 : 1;
      for (;;) switch (q) {
        case 1:                                    // 983
          eax = (eax - 1) >>> 0; if (eax === 0) { eax = U[esi >> 2]; q = 7; continue; }    // 995 -> 9a7
          eax = (eax - 1) >>> 0; if (eax === 0) { eax = U[esi >> 2]; q = 8; continue; }    // 999 -> 9af
          esi += 4; t = ebx + edx; ebx = t >>> 0; if (t > 0xffffffff) { q = 1; continue; }
          eax = (eax - 1) >>> 0; if (eax === 0) { q = 3; continue; }
          q = 1; continue;
        case 3:                                    // 99d
          eax = U[esi >> 2]; U[edi >> 2] = eax; edi += 4;
          ecx = (ecx - 1) >>> 0; if (ecx === 0) { esi = saved; return; }
          q = 7; continue;
        case 7:                                    // 9a7
          U[edi >> 2] = eax; edi += 4;
          ecx = (ecx - 1) >>> 0; if (ecx === 0) { esi = saved; return; }
          q = 8; continue;
        case 8:                                    // 9af
          esi += 4; t = ebx + edx; ebx = t >>> 0; if (t > 0xffffffff) { q = 3; continue; }
          U[edi >> 2] = eax; edi += 4;
          ecx = (ecx - 1) >>> 0; if (ecx !== 0) { q = 3; continue; }
          esi = saved; return;
      }
    };
    if (f === 1) {
      // 0x55c0c75c
      for (;;) {
        if (!(u(0x4c94) > u(0x460c))) {            // 7a2
          if (u(0x453c) <= u(0x4514)) return;
          inc(0x4514);
          emit();
        }
        ecx = u(0x4708); esi += ecx * 4;           // 811
        inc(0x460c);
        if (acc()) continue;
        inc(0x460c);
        if (u(0x4c94) >= u(0x460c)) continue;
        if (u(0x453c) <= u(0x4514)) return;
        inc(0x4514);
        if (s[0x4514 >> 2] === 1) { var keep = esi; esi -= ecx * 4; emit(); esi = keep; }   // PUSH ESI ... POP ESI
        else dupRow();
      }
    }
    // f === 2: 0x55c0c8e9
    for (;;) {
      if (!(u(0x4c94) > u(0x460c))) {              // 949
        if (u(0x453c) <= u(0x4514)) return;
        inc(0x4514);
        emit();
      }
      ecx = u(0x4708); esi += ecx * 4;             // 9bf
      inc(0x460c); inc(0x460c);
      if (!(u(0x4c94) >= u(0x460c))) {
        if (s[0x4514 >> 2] === 0) {
          esi -= ecx * 4;                          // a32: the previous source row, emitted once
          if (u(0x453c) <= u(0x4514)) return;
          inc(0x4514);
          emit();
          esi += u(0x4708) * 4;
        } else {
          if (u(0x453c) <= u(0x4514)) return;
          inc(0x4514);
          dupRow();
        }
      }
      if (acc()) continue;                         // aa8
      inc(0x460c);
      if (u(0x4c94) >= u(0x460c)) continue;
      if (s[0x4514 >> 2] === 0) {
        esi -= ecx * 4;                            // b16
        if (u(0x453c) <= u(0x4514)) return;
        inc(0x4514);
        emit();
        esi += u(0x4708) * 4;
      } else {
        if (u(0x453c) <= u(0x4514)) return;
        inc(0x4514);
        dupRow();
      }
    }
  }

  /** vt+0x9c 0x55c0601a: per-pixel colour work: a hue turn (0x834: channel swap by quadrant, then a
   *  cos blend of the channels), a brightness bias (0x838), a pull toward the tint 0x840/0x844/0x848 by
   *  0x83c %, a ring-shaped tint by edge distance (0x85c, 0x850) and a thresholded tint (0x860, 0x868).
   *  0x55c06080's tint fields keep their last values when this layer sets none (the DLL's quirk). */
  ripple(): void {
    var m = this.m, s = m.I, F = m.F, U = m.U, H = m.H, b = LY(s[0x44a8 >> 2]);
    var cosT = 0x37d8 >> 2, c100 = 100, L = (o: number): number => s[b + lf(o)];
    if (L(0x834) !== 0) {
      var r0 = L(0x834);
      if (r0 < 0) r0 = -r0 | 0;
      while (r0 > 0x5a) r0 -= 0x5a;
      s[0x4d54 >> 2] = r0;
    }
    if ((L(0x83c) | L(0x85c) | L(0x868)) !== 0) {
      s[0x4e58 >> 2] = L(0x840); s[0x4e54 >> 2] = L(0x844); s[0x4e4c >> 2] = L(0x848);
      F[0x4d38 >> 2] = s[0x4e58 >> 2]; F[0x4d34 >> 2] = s[0x4e54 >> 2]; F[0x4d2c >> 2] = s[0x4e4c >> 2];
      F[0x4d3c >> 2] = L(0x860) > 0 ? 0xff - L(0x860) : -L(0x860) | 0;
      F[0x4724 >> 2] = L(0x83c) / c100;
      F[0x472c >> 2] = L(0x868) / c100;
      F[0x4724 >> 2] = F[0x4724 >> 2] * F[cosT + L(0x87c)];
      F[0x472c >> 2] = F[0x472c >> 2] * F[cosT + L(0x87c)];
    }
    s[0x4744 >> 2] = L(0x850);
    if (L(0x850) !== 0) {
      s[0x4524 >> 2] = (s[0x4398 >> 2] + Math.imul(Math.imul(s[0x4540 >> 2] << 2, s[0x453c >> 2]), 4)) | 0;
      F[0x462c >> 2] = L(0x85c);
      if (F[0x462c >> 2] < 0) F[0x462c >> 2] = -F[0x462c >> 2];
      F[0x44fc >> 2] = F[0x462c >> 2] / s[0x4744 >> 2];
      F[0x462c >> 2] = F[0x462c >> 2] + F[0x44fc >> 2];
    }
    s[0x4384 >> 2] = s[0x439c >> 2];
    s[0x4388 >> 2] = s[0x4374 >> 2];
    var n = Math.imul(s[0x4cf4 >> 2], s[0x4ce8 >> 2]);
    s[0x473c >> 2] = n;
    F[0x4d08 >> 2] = L(0x838);
    var key = s[0x4df4 >> 2] >>> 0, src = s[0x439c >> 2], dst = s[0x4374 >> 2];
    var R = 0x4d28 >> 2, G = 0x4d18 >> 2, B = 0x4d04 >> 2;
    var tR = 0x4d38 >> 2, tG = 0x4d34 >> 2, tB = 0x4d2c >> 2;
    for (var i = 0; i < (n >>> 0); i++) {
      var sp = src + i * 4, dp = dst + i * 4, px = U[sp >> 2];
      if (px === key) { if (dp !== sp) U[dp >> 2] = px; continue; }
      var a = px >>> 24, pb = px & 0xff, pg = (px >>> 8) & 0xff, pr = (px >>> 16) & 0xff;
      s[0x4c0c >> 2] = a; s[0x4c40 >> 2] = pb; s[0x4d44 >> 2] = pg; s[0x4dd0 >> 2] = pr;
      F[R] = pr; F[G] = pg; F[B] = pb;
      var hv = L(0x834);
      if (hv !== 0) {
        if (hv >= 0x5a || hv <= -0xb4) { F[R] = pg; F[B] = pr; F[G] = pb; }           // 0x55c0659e
        else if (hv <= -0x5a) { F[R] = pb; F[B] = pg; F[G] = pr; }                     // 0x55c06563
        var c = F[cosT + s[0x4d54 >> 2]];
        F[0x4bb4 >> 2] = F[R] * c; F[0x4bb0 >> 2] = F[G] * c; F[0x4bac >> 2] = F[B] * c;
        F[0x4bf8 >> 2] = F[R] - F[0x4bb4 >> 2]; F[0x4bf4 >> 2] = F[G] - F[0x4bb0 >> 2]; F[0x4bf0 >> 2] = F[B] - F[0x4bac >> 2];
        if (hv < 0) {
          F[R] = F[0x4bb4 >> 2] + F[0x4bf0 >> 2]; F[G] = F[0x4bb0 >> 2] + F[0x4bf8 >> 2]; F[B] = F[0x4bac >> 2] + F[0x4bf4 >> 2];
        } else {
          F[R] = F[0x4bb4 >> 2] + F[0x4bf4 >> 2]; F[G] = F[0x4bb0 >> 2] + F[0x4bf0 >> 2]; F[B] = F[0x4bac >> 2] + F[0x4bf8 >> 2];
        }
      }
      if (L(0x838) !== 0) { F[R] = F[R] + F[0x4d08 >> 2]; F[G] = F[G] + F[0x4d08 >> 2]; F[B] = F[B] + F[0x4d08 >> 2]; }
      if ((s[0x4e58 >> 2] | s[0x4e54 >> 2] | s[0x4e4c >> 2]) !== 0) {
        var pull = (k: number): void => {
          if (s[0x4e58 >> 2] !== 0) F[R] = (F[tR] - F[R]) * F[k] + F[R];
          if (s[0x4e54 >> 2] !== 0) F[G] = (F[tG] - F[G]) * F[k] + F[G];
          if (s[0x4e4c >> 2] !== 0) F[B] = (F[tB] - F[B]) * F[k] + F[B];
        };
        if (L(0x83c) !== 0) pull(0x4724 >> 2);
        ring: if (L(0x85c) !== 0 && L(0x850) !== 0) {
          var d = H[(s[0x4398 >> 2] + (sp - s[0x439c >> 2])) >> 1] & 0xff, lim = s[0x4744 >> 2] >>> 0;
          if (L(0x85c) > 0) {
            if (d > lim) break ring;
            s[0x449c >> 2] = d;
          } else {
            s[0x449c >> 2] = 1;
            if (d < lim) s[0x449c >> 2] = (lim - d) | 0;
          }
          F[0x4728 >> 2] = (F[0x462c >> 2] - s[0x449c >> 2] * F[0x44fc >> 2]) / c100;
          F[0x4728 >> 2] = F[0x4728 >> 2] * F[cosT + L(0x87c)];
          pull(0x4728 >> 2);
        }
        if (L(0x860) !== 0 && L(0x868) !== 0) {
          var thr = F[0x4d3c >> 2], hi = L(0x860) > 0, k2 = F[0x472c >> 2];
          if (s[0x4e58 >> 2] !== 0 && (hi ? !(F[R] < thr) : F[R] < thr)) F[R] = (F[tR] - F[R]) * k2 + F[R];
          if (s[0x4e54 >> 2] !== 0 && (hi ? !(F[G] < thr) : F[G] < thr)) F[G] = (F[tG] - F[G]) * k2 + F[G];
          if (s[0x4e4c >> 2] !== 0 && (hi ? !(F[B] < thr) : F[B] < thr)) F[B] = (F[tB] - F[B]) * k2 + F[B];
        }
      }
      if (F[R] < 0) F[R] = 0;
      if (F[G] < 0) F[G] = 0;
      if (F[B] < 0) F[B] = 0;
      if (F[R] > 255) F[R] = 255;
      if (F[G] > 255) F[G] = 255;
      if (F[B] > 255) F[B] = 255;
      var r = ftol(F[R]), g = ftol(F[G]), bb = ftol(F[B]);
      s[0x4dd0 >> 2] = r; s[0x4d44 >> 2] = g; s[0x4c40 >> 2] = bb;
      U[dp >> 2] = ((((a << 8 | r) << 8 | g) << 8) | bb) >>> 0;
    }
    s[0x4384 >> 2] = (src + n * 4) | 0;
    s[0x4388 >> 2] = (dst + n * 4) | 0;
    s[0x473c >> 2] = 0;
  }

  /** vt+0xa0 0x55c0ae1e: fill transparent (key) pixels from the nearest opaque one along a square
   *  spiral of up to 0x858 steps (0x55c0b0e0), its alpha raised by 0x8f4 - ring * 0x908. */
  melt(): void {
    var m = this.m, s = m.I, U = m.U, b = LY(s[0x44a8 >> 2]);
    var md = s[b + lf(0x858)];
    s[0x4d58 >> 2] = md < 0 ? -md | 0 : md;
    if (s[b + lf(0x8f4)] > 0xff) s[b + lf(0x8f4)] = 0xff;
    var w = s[b + lf(0x7f4)], n = Math.imul(s[b + lf(0x7f8)], w);
    s[0x4dcc >> 2] = w;
    s[0x4ec4 >> 2] = n;
    s[0x4390 >> 2] = s[0x4374 >> 2];
    s[0x43ec >> 2] = s[0x439c >> 2];
    s[0x4400 >> 2] = s[0x439c >> 2];
    s[0x43fc >> 2] = (s[0x439c >> 2] + n * 4) | 0;
    var key = s[0x4df4 >> 2] >>> 0;
    for (var i = 0; i < n; i++) {
      var px = U[(s[0x439c >> 2] >> 2) + i];
      if (px !== key) { U[(s[0x4374 >> 2] >> 2) + i] = px; continue; }
      s[0x45cc >> 2] = i;
      s[0x43ec >> 2] = (s[0x439c >> 2] + i * 4) | 0;
      s[0x4c50 >> 2] = px;
      {
        this.spiral();                             // vt+0x1e8 0x55c0b0e0
        if ((s[0x4c50 >> 2] >>> 0) !== key && s[b + lf(0x8f4)] !== 0) {
          var a = (s[b + lf(0x8f4)] - Math.imul(s[0x442c >> 2], s[b + lf(0x908)])) | 0;
          if (a > 0xff) a = 0xff;
          s[0x4e64 >> 2] = a;
          var t = (s[0x4c50 >> 2] >>> 0) + bswap(a >>> 0);
          s[0x4c50 >> 2] = t > 0xffffffff ? (t | 0xff000000) : t | 0;
        }
      }
      U[(s[0x4374 >> 2] >> 2) + i] = s[0x4c50 >> 2];
    }
    if (n > 0) { s[0x4c50 >> 2] = U[(s[0x4374 >> 2] >> 2) + n - 1]; s[0x45cc >> 2] = n; }
    s[0x4390 >> 2] = (s[0x4374 >> 2] + Math.max(n, 0) * 4) | 0;
    s[0x43ec >> 2] = (s[0x439c >> 2] + Math.max(n, 0) * 4) | 0;
  }
  /** 0x55c0b0e0 (locals in the loop; every field it leaves behind is stored on the way out) */
  spiral(): void {
    var s = this.m.I, U = this.m.U, b = LY(s[0x44a8 >> 2]), w = s[b + lf(0x7f4)], key = s[0x4df4 >> 2] >>> 0;
    var base = s[0x4400 >> 2], end = s[0x43fc >> 2] >>> 0, w4 = w * 4, ub = base >>> 0;
    var cur = s[0x43ec >> 2], dir = 0, ring = 1, half = 1, left = 1, step = 1;
    var r0 = (((cur - base) >> 2) / w) | 0;
    var rs = (base + Math.imul(r0, w) * 4) | 0, re = (rs + w4) | 0;
    var max = s[b + lf(0x858)] + 1, found = -1;
    for (;;) {
      var c: number;
      if (dir === 0) { cur = (cur + 4) | 0; if ((cur >>> 0) >= (re >>> 0)) break; }
      else if (dir === 1) { cur = (cur - w4) | 0; if ((cur >>> 0) <= ub) break; }
      else if (dir === 2) { cur = (cur - 4) | 0; if ((cur >>> 0) <= (rs >>> 0)) break; }
      else { cur = (cur + w4) | 0; if ((cur >>> 0) >= end) break; }
      c = U[cur >>> 2];
      if (c !== key) { found = c; break; }
      if (--left <= 0) {
        dir = dir === 3 ? 0 : dir + 1;
        if (dir === 2 || dir === 0) {
          var r = (((cur - base) >> 2) / w) | 0;
          rs = (base + Math.imul(r, w) * 4) | 0;
          re = (rs + w4) | 0;
        }
        if (half === 0) { ring++; half = ring; left = ring; }
        else { left = half; half = 0; }
      }
      if (++step >= max) break;
    }
    if (found !== -1) s[0x4c50 >> 2] = found;
    s[0x44a4 >> 2] = dir; s[0x4488 >> 2] = cur; s[0x442c >> 2] = ring; s[0x44a0 >> 2] = half;
    s[0x4c68 >> 2] = left; s[0x45f0 >> 2] = step; s[0x43f0 >> 2] = rs; s[0x43f4 >> 2] = re; s[0x4ec8 >> 2] = max;
  }

  // ---------------------------------------------------------------- one-time setup
  /** vt+0x1cc 0x55c1510e: clear the layer and transform records and the spectrum buffers, defaults. */
  init(): void {
    var s = this.m.I, i: number;
    s[0x4ebc >> 2] = 7;                            // last layer index
    s[0x463c >> 2] = 8;                            // layer count
    for (var k = 0; k <= 7; k++) {
      for (i = 0; i < 0x7b; i++) s[LY(k) + i] = 0;
      for (i = 0; i < 0x38; i++) s[XF(k) + i] = 0;
      s[0x45cc >> 2] = 0x7b; s[0x45f0 >> 2] = 0x38;
    }
    s[0x44a8 >> 2] = 8;
    for (i = 0; i < 10; i++) s[(0x43c0 >> 2) + i] = 0;
    for (i = 0; i < 0x208; i++) { s[(0x1740 >> 2) + i] = 0; s[(0x1f60 >> 2) + i] = 0; s[(0x2780 >> 2) + i] = 0; }
    for (i = 0; i < 9; i++) s[(0x16cc >> 2) + i] = 0;
    s[0x45cc >> 2] = 9;
    store(s, INIT_FIELDS);
    s[0x4734 >> 2] = (s[0x464c >> 2] / 2) | 0;
    s[0x4738 >> 2] = s[0x4650 >> 2];
    store(s, INIT_FIELDS2);
  }

  /** vt+0x168 0x55c15597: the bitmap table, decoded once (cached per table index at obj+0x43c0). */
  loadTable(): void {
    var s = this.m.I;
    s[0x16f0 >> 2] = s[0x4810 >> 2];
    s[0x4454 >> 2] = s[0x4620 >> 2] ? 32 : 0;      // GetDeviceCaps(hdc, BITSPIXEL); 0 before the 1st HDC
    var t = s[(0x43c0 >> 2) + s[0x4618 >> 2]];
    s[0x43b4 >> 2] = t;
    if (t === 0) {
      this.decodeTable();                          // vt+0x198 0x55c04910
      s[(0x43c0 >> 2) + s[0x4618 >> 2]] = s[0x466c >> 2];
      s[0x43b4 >> 2] = s[0x466c >> 2];
    }
  }

  /** vt+0x198 0x55c04910 + vt+0x194 0x55c04a51: expand every image of the DATATABLE resource into one
   *  block: {count, offsets[]} then per image {type 0x16|0x24, w, h, flags byte, pixels 0x00RRGGBB}. */
  decodeTable(): void {
    if (!this.res) { this.buildTable(); return; }
    var m = this.m, res = this.res, rv = new DataView(res.buffer, res.byteOffset, res.byteLength);
    var n = rv.getInt32(4, true), total = (rv.getInt32(0, true) + n * 4) | 0;
    var s = m.I;
    s[0x47dc >> 2] = total;
    s[0x4640 >> 2] = n;
    var p = m.malloc(total);
    s = m.I;
    var U = m.U, B = m.B, H = m.H;
    s[0x465c >> 2] = p;
    U[p >> 2] = rv.getUint32(0, true);
    U[(p >> 2) + 1] = n;
    var cur = p + n * 4 + 8;
    for (var i = 1; i <= n; i++) {
      s[0x4498 >> 2] = i;
      U[(p >> 2) + 1 + i] = cur - p;
      var src = rv.getInt32(4 + i * 4, true), type = rv.getInt32(src, true);
      var w = rv.getInt32(src + 4, true), h = rv.getInt32(src + 8, true), cnt: number, c: number, run: number;
      s[0x4c4c >> 2] = type;
      s[0x4540 >> 2] = w; s[0x453c >> 2] = h;
      var d = cur >> 2;
      U[d] = (type === 0x16 || type === 0xc16) ? 0x16 : 0x24;
      U[d + 1] = w; U[d + 2] = h; B[cur + 12] = 0;
      d += 4;
      cnt = Math.imul(w, h) >>> 0;
      var q = src + 12;
      if (type === 0x16 || type === 0xc16) {
        // 5:5:5 words; 0xffff, colour, run (u32) is a run
        outer16: for (;;) {
          var v: number;
          while ((v = rv.getUint16(q, true)) === 0xffff) {
            c = rgb555(rv.getUint16(q + 2, true));
            U[d++] = c;
            run = (rv.getUint32(q + 4, true) - 1) >>> 0;
            q += 8;
            if (--cnt === 0) break outer16;
            do { U[d] = c; if (--cnt === 0) { d++; break outer16; } d++; run = (run - 1) >>> 0; } while (run !== 0);
          }
          U[d++] = rgb555(v);
          q += 2;
          if (--cnt === 0) break;
        }
      } else if (type === 0x24) {
        do { U[d++] = rd24(res, q); q += 3; } while (--cnt !== 0);
      } else {
        // 8:8:8 triplets; ffffff ffffff, colour, run (24-bit) is a run
        outer24: for (;;) {
          while (rd24(res, q) === 0xffffff && rd24(res, q + 3) === 0xffffff) {
            c = rd24(res, q + 6);
            U[d++] = c;
            run = (rd24(res, q + 9) - 1) >>> 0;
            q += 12;
            if (--cnt === 0) break outer24;
            do { U[d] = c; if (--cnt === 0) { d++; break outer24; } d++; run = (run - 1) >>> 0; } while (run !== 0);
          }
          U[d++] = rd24(res, q);
          q += 3;
          if (--cnt === 0) break;
        }
      }
      cur = d << 2;
      void H; void B;
    }
    s[0x437c >> 2] = cur;
    s[0x465c >> 2] = 0;
    s[0x466c >> 2] = p;
  }

  /** decodeTable's block from the generated images (images.ts): {size, count, offsets[]} then per image
   *  {type, w, h, flags byte, pixels}, laid out exactly as the decoder lays out the resource's. */
  buildTable(): void {
    var m = this.m, im = musicalImages(), n = im.length - 1, i: number, total = 8 + n * 4;
    for (i = 1; i <= n; i++) total += 16 + im[i].w * im[i].h * 4;
    var s = m.I;
    s[0x47dc >> 2] = total;
    s[0x4640 >> 2] = n;
    var p = m.malloc(total);
    s = m.I;
    var U = m.U;
    s[0x465c >> 2] = p;
    U[p >> 2] = total - n * 4;
    U[(p >> 2) + 1] = n;
    var cur = p + n * 4 + 8;
    for (i = 1; i <= n; i++) {
      var g = im[i];
      s[0x4498 >> 2] = i;
      U[(p >> 2) + 1 + i] = cur - p;
      s[0x4c4c >> 2] = g.type;
      s[0x4540 >> 2] = g.w; s[0x453c >> 2] = g.h;
      var d = cur >> 2;
      U[d] = g.type; U[d + 1] = g.w; U[d + 2] = g.h; m.B[cur + 12] = 0;
      U.set(g.px, d + 4);
      cur = (d + 4 + g.px.length) << 2;
    }
    s[0x437c >> 2] = cur;
    s[0x465c >> 2] = 0;
    s[0x466c >> 2] = p;
  }

  /** vt+0x16c 0x55c1563d: canvas strides; every layer starts unused. */
  strides(): void {
    var s = this.m.I;
    s[0x464c >> 2] = s[0x47a0 >> 2] << 2;
    s[0x4650 >> 2] = s[0x47a8 >> 2] << 2;
    for (var k = 0; k <= s[0x4ebc >> 2]; k++) s[LY(k)] = -1;
    s[0x44a8 >> 2] = s[0x4ebc >> 2] + 1;
  }

  /** vt+0x170 0x55c15ab4: sin and cos of whole degrees as float32, x87 FSIN/FCOS of d * (float)0.01745328. */
  trigTables(): void {
    var F = this.m.F, D = fr(0.017453279346227646);
    F[0x3d78 >> 2] = 0;
    F[0x37d8 >> 2] = 1;
    for (var d = 1; d < 360; d++) { F[(0x3d78 >> 2) + d] = Math.sin(d * D); F[(0x37d8 >> 2) + d] = Math.cos(d * D); }
  }

  /** vt+0x184 0x55c15726: the scene every preset starts from (layers 0..5). */
  defaultScene(): void {
    var s = this.m.I, i: number;
    this.freeLayerBufs();                          // vt+0x100 0x55c0d4c6
    for (var k = 0; k <= s[0x4ebc >> 2]; k++) {
      for (i = 0; i < 0x7b; i++) s[LY(k) + i] = 0;
      for (i = 0; i < 0x38; i++) s[XF(k) + i] = 0;
      s[0x45cc >> 2] = 0x7b; s[0x45f0 >> 2] = 0x38;
    }
    s[0x44a8 >> 2] = s[0x4ebc >> 2] + 1;
    store(s, SCENE0);
    for (i = 0; i < 0x208; i++) s[(0x2fa0 >> 2) + i] = 0;
    for (i = 0; i < 10; i++) s[(0x1718 >> 2) + i] = 0;
    s[0x4ee8 >> 2] = 10;
    for (k = 0; k < 6; k++) {
      store(s, SCENE_LAYERS[k]);
      this.bindImage();                            // vt+0x164 0x55c01b3d
    }
  }

  /** vt+0x100 0x55c0d4c6: free every layer's three work buffers. */
  freeLayerBufs(): void {
    var m = this.m, s = m.I;
    for (var k = 0; k <= s[0x4ebc >> 2]; k++) {
      var b = LY(k);
      s[b + lf(0x824)] = 0;
      if (s[b + lf(0x82c)]) { m.release(s[b + lf(0x82c)]); s[b + lf(0x82c)] = 0; }
      if (s[b + lf(0x828)]) { m.release(s[b + lf(0x828)]); s[b + lf(0x828)] = 0; }
      if (s[b + lf(0x90c)]) { m.release(s[b + lf(0x90c)]); s[b + lf(0x90c)] = 0; }
    }
    s[0x45cc >> 2] = s[0x4ebc >> 2] + 1;
  }

  /** vt+0x164 0x55c01b3d: point the current layer (obj+0x44a8) at its table image; 0 = no such image
   *  (the layer is switched off). A changed size frees the layer's work buffers. */
  bindImage(): number {
    var m = this.m, s = m.I, b = LY(s[0x44a8 >> 2]);
    if (s[b + lf(0x770)] === -1) return 1;
    s[0x4618 >> 2] = s[b + lf(0x78c)];
    this.loadTable();
    s = m.I;
    var t = s[0x43b4 >> 2];
    if (t !== 0) {
      var idx = s[b + lf(0x790)];
      s[0x4614 >> 2] = idx;
      if (idx !== 0 && (idx >>> 0) <= (m.U[(t >> 2) + 1])) {
        var e = (m.I[(t >> 2) + 1 + idx] + t) | 0;
        s[0x4ce4 >> 2] = e + 16;
        s[0x4c4c >> 2] = s[e >> 2];
        s[0x4c70 >> 2] = s[(e >> 2) + 1];
        s[0x4c5c >> 2] = s[(e >> 2) + 2];
        if (s[b + lf(0x7f4)] !== s[0x4c70 >> 2] || s[b + lf(0x7f8)] !== s[0x4c5c >> 2]) {
          if (s[b + lf(0x82c)]) { m.release(s[b + lf(0x82c)]); s[b + lf(0x82c)] = 0; }
          if (s[b + lf(0x828)]) { m.release(s[b + lf(0x828)]); s[b + lf(0x828)] = 0; }
          s[b + lf(0x824)] = 0;
        }
        s[b + lf(0x7f4)] = s[0x4c70 >> 2];
        s[b + lf(0x7f8)] = s[0x4c5c >> 2];
        s[b + lf(0x79c)] = s[0x4c70 >> 2];
        s[b + lf(0x7a0)] = s[0x4c5c >> 2];
        s[b + lf(0x794)] = s[0x4ce4 >> 2];
        return 1;
      }
    }
    s[b] = -1;
    s[b + lf(0x794)] = 0;
    return 0;
  }
}

/** a code path no shipped preset was seen to reach in the coverage runs: fail loudly */
function unported(va: number): () => void {
  return function () { throw new Error('musical: 0x' + va.toString(16) + ' is not ported'); };
}

/** the DDA counts of 0x55c0c030 / 0x55c0c0a0 / 0x55c0c113 (and their one-value twins 0x55c0c3fb,
 *  0x55c0c432, 0x55c0c46a): how many output samples n input samples become at 8.8 scale v. */
function scaledCount(n: number, v: number, f: number): number {
  var e = f === 0 ? (0x100 - v) >>> 0 : f === 1 ? (0x200 - v) >>> 0 : ((0x2ff - v + 1) >>> 0);
  if (f === 2 && e > 0xff) e = 0;
  var step = bswap(e), acc = 0, out = f === 2 ? 2 : 1, t: number;
  n = n >>> 0;
  for (;;) {
    if (--n === 0) return out;                     // (n == 0 on entry wraps, as the asm's DEC/JZ would)
    t = acc + step; acc = t >>> 0;
    if (t > 0xffffffff) { if (f !== 0) out += f === 2 ? 2 : 1; continue; }
    out += f === 0 ? 1 : f === 1 ? 2 : 3;
  }
}

/** [byteOffset, value, ...] stores into the object */
function store(s: Int32Array, t: number[]): void {
  for (var i = 0; i < t.length; i += 2) s[t[i] >> 2] = t[i + 1];
}
function rgb555(v: number): number {
  var u = v << 6;
  return ((u & 0x1f0000) << 3 | (v & 0x1f) << 3 | u & 0xf800) >>> 0;
}
function rd24(b: Uint8Array, q: number): number { return b[q] | b[q + 1] << 8 | b[q + 2] << 16; }

// ---- 0x55c11738's first-call stores per preset id, in order
const P1 = [0x4574, 1, 0x97c, 0x15, 0x47f8, 1, 0xce8, -1, 0x870, 1, 0x850, 0xa2, 0x84c, 0x100, 0xdb0, -0x14,
  0x44cc, 0xaf, 0x44c0, 9, 0x44bc, 0x1e];
const P2a = [0x4574, 1, 0x97c, 0x1e, 0x47f8, 0x14, 0x8fc, 1, 0x880, 0x2d, 0x884, 0x70, 0x948, 1, 0xd4, -0x425c28f6,
  0x8f8, 2, 0xe4, 0x3f000000, 0xec, 0x3f800000];
const P2b = [0x890, 1, 0x894, 1, 0xbc0, 0x453, 0x2d4, 0x3f000000, 0x2d8, 0x3f800000, 0xd18, 5, 0x44c8, 4,
  0x44bc, 0x14, 0x44c0, 3, 0x44cc, 0xae, 0x44d0, 0x5f, 0x44b8, 0];
const T11921 = [0xe34, 2, 0xe14, 4, 0xe10, 200, 0xd54, 0x1f];
const P3 = [0x4574, 1, 0x97c, 0x11, 0x47f8, 1, 0xce8, -1, 0x870, 3, 0x850, 0x53, 0x84c, 0x100, 0x808, 0x32,
  0x44cc, 0x178, 0x44c0, 0x25, 0x44bc, 0x57, 0x44d0, 0x3c];
const P4 = [0x4574, 1, 0x97c, 0x23, 0x1f8, 0x40c00000, 0xb30, 4, 0x47f8, 0x14, 0x88c, 1, 0x8fc, 1, 0x880, 0xa0,
  0x884, -0x3c, 0x948, 1, 0xd4, -0x41f0a3d7, 0x8f8, 2, 0xe4, 0x3f800000, 0xec, 0x3f000000, 0xbc0, 0x453,
  0x2d4, 0x3f000000, 0x2d8, 0x3f800000, 0xd18, 5, 0x44c8, 5, 0x44bc, 0x14, 0x44c0, 3, 0x44cc, 0xae,
  0x44d0, 0x5f, 0x44b8, 0, 0xe34, 3, 0xe14, 5, 0xe10, 0xb4, 0xd54, 0x28];
const P6 = [0x4574, 1, 0x97c, 0x14, 0x47f8, 1, 0xce8, -1, 0x870, 3, 0x850, 0x26, 0x84c, 0x100, 0x808, 0x28,
  0x44cc, 0x178, 0x44c0, 0x25, 0x44bc, 0x57, 0x44d0, 10];
const P7 = [0x4574, 1, 0x97c, 6, 0x47f8, 1, 0xce8, -1, 0x870, 1, 0x850, 0x74, 0x84c, 0xfa, 0xdb0, -0x1b,
  0x44cc, 0x15e, 0x44bc, 0x32, 0x44d0, 0x43, 0x85c, 100, 0x840, 0xff, 0x844, 1, 0x848, 0x41, 0x44d4, 2,
  0x44c0, 5];
const P8 = [0x4574, 1, 0x97c, 9, 0x47f8, 1, 0xd18, 0x13, 0x44cc, 0x15e, 0x44c0, 0x28, 0x7e8, 0x453, 0x44bc, 0x46];
const P9 = [0x4574, 1, 0x97c, 4, 0x47f8, 1, 0xce8, -1, 0x870, 3, 0x850, 0x23, 0x84c, 0x82, 0x44c8, 4,
  0x44c0, 8, 0x44cc, 0xae, 0x9bc, 1, 0x44d0, 0x1f];
const P10 = [0x4574, 1, 0x97c, 0xf, 0x47f8, 1, 0x808, -0x1e, 0x2d4, 0, 0x2d8, -0x3f6a8f5c, 0xd18, 10,
  0x44cc, 0xa2, 0xc64, 0x21, 0xc5c, 0x52, 0xd20, 1, 0x2a4, 0x40980000, 0x44c0, 2];
const P11 = [0x4574, 1, 0x97c, 0xe, 0x47f8, 1, 0x2d4, 0, 0x2d8, -0x3f6a8f5c];
const T122de = [0xd18, 10, 0x44cc, 0x164, 0x44c0, 2];
const P12 = [0x4574, 1, 0x97c, 0xc, 0x47f8, 1, 0xd18, 0x1e, 0xc6c, 5, 0xc5c, -0x4b, 0xd20, 1, 0xc30, 1,
  0x2a4, 0x40a00000, 0xc68, 0x20, 0xcd4, 2, 0x2ac, 0x40400000, 0x44cc, 0x164];
const P13 = [0x4574, 1, 0x97c, 0x18, 0x47f8, 1, 0xce8, -1, 0x870, 0xb, 0x850, 0xc, 0x84c, 0xfa, 0x44bc, 0x32,
  0x44d0, 0x28, 0x44cc, 0xae, 0xd1c, 3, 0x44c0, 2];
const P14 = [0x4574, 1, 0x97c, 0x16, 0x47f8, 1, 0x2d4, 0, 0x2d8, -0x3f000000, 0x870, 1, 0x850, 0x10, 0x84c, 0x100];
const P15 = [0x4574, 1, 0x97c, 6, 0x47f8, 1, 0xd18, 0x1e, 0x44cc, 0x154, 0x44d0, 0x32, 0xc6c, 5, 0xc5c, -0x4b,
  0xd20, 1, 0xc30, 1, 0x2a4, 0x40a00000, 0x44c0, 3];
const P16 = [0x4574, 1, 0x97c, 0x1e, 0x47f8, 1, 0x808, 0x38, 0x870, 3, 0x850, 0x5a, 0x84c, 0xff, 0x890, 0xf,
  0x884, 0xd4, 0xd4, -0x435c28f6, 0x2d4, 0x3f800000, 0x44c4, 0, 0xbe0, 0x38, 0x2d8, 0x3f800000, 0xd18, 0x16,
  0x44cc, 0xae, 0x858, 3, 0xd0, 0x40e3d70a, 0x8e0, 0x16, 0xd1c, 3, 0x44c0, 3];
const P17 = [0x4574, 1, 0x97c, 0x23, 0x47f8, 0x14, 0xbc0, 0x453, 0x2d4, 0, 0x2d8, -0x40800000, 0xd18, 2,
  0x44c8, 4, 0x44bc, 0x14, 0x44c0, 3, 0x44cc, 0xae, 0x2a4, 0x3f800000, 0xc68, 0x37, 0xcd4, 1, 0x294, -0x435c28f6,
  0xcd0, 1, 0xd90, 0x20, 0x44d0, 0x32];
const P18 = [0x4574, 1, 0x97c, 0x1e, 0xd18, 2, 0xbc0, 0x453, 0x910, -1, 0x47f8, 1, 0x870, 3, 0x850, 0x1f,
  0x84c, 0xb2, 0x44c8, 4, 0x44c0, 8, 0x44cc, 0xae, 0x44d0, 0x1f, 0x44bc, 0];
const P19 = [0x4574, 1, 0x97c, 0x2a, 0x1f8, 0x40c00000, 0xb30, 4, 0x47f8, 0x14, 0xbc0, 0x453, 0x2d4, 0x3f000000,
  0x2d8, 0x3f800000, 0xd18, 5, 0x44c8, 5, 0x44bc, 0xf, 0x44c0, 3, 0x44cc, 0xae, 0x44d0, 10, 0xcc, 0x40400000,
  0x8d4, 1, 0xe34, 3, 0xe14, 5, 0xe10, 0xb4, 0xd54, 0x28, 0xdb0, 0x2d, 0xda8, -1, 0xed4, -1, 0xd40, 2,
  0x44a8, 3, 0x8e0, 0x37];
const P20_8 = [0x910, -1, 0x4574, 1, 0x47f8, 1, 0x97c, 4, 0xd18, 2, 0xbe0, -3, 0x44c4, 1, 0x44bc, 0x14];
const P20 = [0x910, -1, 0x4574, 1, 0x97c, 8, 0xd18, 2, 0x47f8, 0x14, 0x44d0, 0x55, 0xbe0, -3, 0x44bc, 0x32];

// 0x55c1510e's stores, in order (the x87/derived ones are in init())
const INIT_FIELDS = [
  0x4318, 0x11, 0x431c, 0x34, 0x4320, 0x82, 0x4324, 0x87, 0x4328, 0xc0, 0x432c, 0xc5, 0x4330, 0xe1,
  0x4334, 0xe6, 0x4338, 0xed, 0x433c, 0x9a, 0x4340, 0xec, 0x4344, 0x9a, 0x4348, 0x93, 0x434c, 0,
  0x4350, 0xd8, 0x4354, 0xfe, 0x4810, 1, 0x4368, 0, 0x43a4, 0, 0x43b4, 0, 0x441c, 0, 0x443c, 0xffffff,
  0x442c, 1, 0x4458, 0, 0x445c, 0, 0x4460, 0, 0x47b4, 0, 0x4484, 0, 0x4494, 0xff, 0x448c, 0, 0x4490, 0,
  0x44a0, 1, 0x44a4, 0, 0x44a8, 0, 0x44ac, 0, 0x44bc, 0, 0x44c0, 0, 0x44c4, 0, 0x44c8, 0, 0x44cc, 0xff,
  0x44d0, 0, 0x44d4, 0, 0x44d8, 0, 0x44dc, 1, 0x44e8, 0, 0x44f8, 0, 0x4500, 0, 0x454c, 0, 0x4560, 0,
  0x4564, 0, 0x4568, 0, 0x457c, 0, 0x456c, 0, 0x4570, 1, 0x4574, 0, 0x458c, 1, 0x4584, 0, 0x45a8, 400,
  0x45c4, -1, 0x45c8, -1, 0x45e8, 0, 0x45e4, 0, 0x45ec, 0, 0x45fc, 0, 0x4600, 0, 0x4604, 5, 0x4610, 2,
  0x4618, 0, 0x4644, 3, 0x4648, 0x15, 0x4654, 0x578, 0x4658, 0x578, 0x4660, 0, 0x4664, 0, 0x4668, 0,
  0x46d4, 7, 0x466c, 0, 0x4670, 0, 0x4674, 0, 0x4678, 0, 0x467c, 0x15e, 0x4680, 0x140, 0x4684, 0,
  0x4698, 0, 0x46c4, 0, 0x46cc, 1, 0x46e0, 0, 0x46e4, 0, 0x46e8, 0, 0x46f0, 0,
];
const INIT_FIELDS2 = [
  0x4798, 0, 0x479c, 0, 0x47fc, 0, 0x47a0, 400, 0x47a8, 400, 0x47ac, 3, 0x47b0, 0, 0x47b4, 0, 0x47b8, 0,
  0x47e0, 0x100, 0x47e4, 0x100, 0x47f0, 0, 0x47f8, 0x14, 0x480c, 0, 0x4c68, 1, 0x4b9c, 0, 0x4ba0, 0,
  0x4ba4, 0, 0x4ba8, 0, 0x4be4, 0, 0x4be8, 0, 0x4bec, 0, 0x4c00, 0, 0x4bfc, 0, 0x4c04, 0, 0x4c8c, 0,
  0x4cec, 0, 0x4cf0, 0, 0x4e94, 0, 0x4e90, 0, 0x4e98, 0, 0x4eec, 0, 0x4ef0, 0, 0x4ef4, 0, 0x4f30, 0,
];
// 0x55c15726: globals, then per layer the stores before each bindImage (the current-layer field 0x44a8
// is among them)
const SCENE0 = [
  0x4ef8, 0x5a, 0x4eec, 0, 0x4efc, 0x17d8, 0x4f00, 0x1989, 0x4f04, -0x13e, 0x44cc, 0xff, 0x44c0, 0,
  0x44c4, 0, 0x4c8c, 0, 0x44bc, 0, 0x44c8, 0, 0x44d0, 0, 0x44d4, 0,
];
const SCENE_LAYERS = [
  [0x910, 0, 0x76c, 2, 0x7fc, 0x479, 0x7e8, 0x453, 0x7ec, -0x1da, 0x808, 0, 0x78c, 0, 0x790, 1, 0x7e4, 0,
    0x94c, 1, 0x77c, 2, 0x44a8, 0],
  [0x958, 2, 0x9e8, 0x58c, 0x9d4, 0x522, 0x9d8, -0x191, 0x9f4, 0, 0x978, 0, 0x97c, 4, 0x9d0, -1, 0xafc, -1,
    0x968, 2, 0x44a8, 1],
  [0xb44, 2, 0xce8, 0, 0xbd4, 0x58c, 0xbc0, 0x453, 0xbc4, -0x1db, 0xbe0, 0, 0xb64, 0, 0xb68, 10, 0xbbc, -1,
    0xd18, 2, 0xd24, 1, 0x2b0, 0x43960000, 0x2d4, 0x3f800000, 0x2d8, 0x3f000000, 0xd1c, 2, 0x44a8, 2, 0xb54, 2],
  [0xed4, -1, 0x44a8, 3, 0xd30, 2, 0xdc0, 0x58c, 0xdac, 0x524, 0xdb0, -0x191, 0xdcc, 0, 0xd50, 0, 0xd54, 0xb,
    0xda8, 0, 0xd40, 2],
  [0xf94, -1, 0x10c0, -1, 0x44a8, 4, 0xf1c, 2, 0xfac, 0x58c, 0xf98, 0x3df, 0xf9c, -0x112, 0xfb8, -0x2bf,
    0xf3c, 0, 0xf40, 9, 0xf2c, 2],
  [0x1180, -1, 0x12ac, -1, 0x1108, 2, 0x1198, 0x58c, 0x112c, 5, 0x44a8, 5, 0x1184, 0x4f5, 0x1188, 0x35,
    0x11a4, -0x2e, 0x1128, 0, 0x1118, 2],
];
