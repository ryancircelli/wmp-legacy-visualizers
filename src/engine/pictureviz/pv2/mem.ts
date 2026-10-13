// PictureViz_II's memory: one flat little-endian heap whose first 0x6b20 bytes ARE the C++ object (address 0),
// malloc'd blocks after it, every "pointer" a byte address into it (Musical Colors' layout, musical/core.ts).
// Fields are named by their byte offset from the object's start (obj+0 = the engine vtable 0x10032784 in the
// gallery build; IWMPEffects methods see this = obj+0x98, so their offsets read 0x98 lower than here).
//
// The heap can grow (a bigger view): `m.I` etc. are replaced then, so code reads them through `m` after any
// call that may allocate, and caches them in locals only around loops that do not.

export const OBJ_SIZE = 0x6b20;
const HEAP0 = 0x8000;

/** MSVC _ftol / the CRT's 0x1002a3f8 (FISTP qword with truncation, low dword): truncate toward zero, low 32
 *  bits; out of the int64 range (and NaN) the FPU's "integer indefinite" 0x8000000000000000 -> low dword 0. */
export function ftol(x: number): number {
  if (x > -2147483649 && x < 2147483648) return x | 0;     // the common case: ToInt32 truncates the same way
  return x > -9.2e18 && x < 9.2e18 ? (x % 4294967296) | 0 : 0;
}
export const fr = Math.fround;

export class Mem {
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
  /** malloc: zero-filled (the A/B host makes HeapAlloc zero every block, and every block this engine asks for
   *  is above the CRT's small-block threshold, so it comes from HeapAlloc). Freed blocks are reused by size. */
  malloc(n: number): number {
    n = (n + 15) & ~15;
    if (n <= 0) n = 16;
    var l = this.free.get(n);
    if (l && l.length) {
      var q = l.pop()!;
      this.B.fill(0, q, q + n);
      return q;
    }
    var p = this.top;
    this.top += n + 16;                        // a gap like a heap block header: reads just past a block see 0
    if (this.top > this.buf.byteLength) {
      var nb = new ArrayBuffer(Math.max(this.top + (16 << 20), this.buf.byteLength * 2));
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
  /** 32-bit load at any byte address (the DLL walks some buffers by byte steps) */
  ld(a: number): number {
    return a & 3 ? (this.B[a] | this.B[a + 1] << 8 | this.B[a + 2] << 16 | this.B[a + 3] << 24) : this.I[a >> 2];
  }
}
