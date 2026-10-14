// The Averett "Plugin framework" DLLs (Rhythm and Waves, Energy Bliss, Ice Storm, Snow and Softie, Grind, T3, Looney
// Tunes) are one C++ object of ~200 KB whose ~170 virtual methods share all their state through it and walk malloc'd
// pixel buffers with pointer arithmetic. As in the Musical Colors port (../musical/core.ts, the same company's
// earlier engine), the port keeps that shape: one flat little-endian heap whose first bytes ARE the object (address
// 0), malloc'd blocks after it, every "pointer" a byte address into the heap, and fields named by their byte offset
// in the object (the numbers the code uses). Direct3D objects the object holds are small handles into a side table.
//
// Arithmetic: the x87 runs at 53-bit precision (control word 0x027F; the DLLs create their devices with
// D3DCREATE_FPU_PRESERVE), so a double op is the x87 op, `FSTP float` is Math.fround, and _ftol truncates.
// FSIN/FCOS/FSINCOS/FPATAN deliver 64-bit mantissas whatever the precision control says: sincos87 (../plenoptic/x87).
import { sincos87 } from '../plenoptic/x87';

export const fr = Math.fround;

/** MSVC _ftol (fistp qword after truncation), low 32 bits */
export function ftol(x: number): number {
  return x > -9.2e18 && x < 9.2e18 ? (Math.trunc(x) % 4294967296) | 0 : 0;
}

const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
export const f2u = (x: number): number => { F1[0] = x; return U1[0]; };
export const u2f = (u: number): number => { U1[0] = u; return F1[0]; };

/** hi + lo (a 64-bit x87 value) rounded straight to float32, as FSTP float does */
export function fr64(hi: number, lo: number): number {
  const r = fr(hi);
  if (lo === 0 || r === hi) return r;
  // hi is not a float: lo can only matter when hi sits exactly halfway between the two floats around it
  const up = r < hi ? nextUp(r) : r, down = r < hi ? r : nextDown(r);
  if (hi !== (up + down) / 2) return r;
  return lo > 0 ? up : down;
}
function nextUp(f: number): number { F1[0] = f; U1[0] += f >= 0 ? 1 : -1; return F1[0]; }
function nextDown(f: number): number { F1[0] = f; U1[0] += f > 0 ? -1 : 1; return F1[0]; }

const SC = new Float64Array(4);
/** FSIN / FCOS of a double, stored to float */
export function fsinF(x: number): number { sincos87(x, SC); return fr64(SC[0], SC[1]); }
export function fcosF(x: number): number { sincos87(x, SC); return fr64(SC[2], SC[3]); }
/** FSINCOS: [sin, cos] as 64-bit [hi, lo] pairs in out[0..3] */
export function fsincos(x: number, out: Float64Array): void { sincos87(x, out); }

/** The flat heap: the object at 0, then malloc'd blocks (freed blocks reused by exact size). */
export class Heap {
  buf!: ArrayBuffer;
  I!: Int32Array;
  U!: Uint32Array;
  F!: Float32Array;
  B!: Uint8Array;
  H!: Uint16Array;
  private top: number;
  private free = new Map<number, number[]>();
  private sizes = new Map<number, number>();
  constructor(readonly objSize: number, bytes = 8 << 20) {
    this.top = (objSize + 0xfff) & ~0xfff;
    this.views(new ArrayBuffer(bytes));
  }
  private views(buf: ArrayBuffer): void {
    this.buf = buf;
    this.I = new Int32Array(buf); this.U = new Uint32Array(buf); this.F = new Float32Array(buf);
    this.B = new Uint8Array(buf); this.H = new Uint16Array(buf);
  }
  /** malloc: 16-byte aligned, zero-filled (the DLL's blocks are always filled before use) */
  malloc(n: number): number {
    n = Math.max(16, (n + 15) & ~15);
    const l = this.free.get(n);
    let p: number;
    if (l && l.length) { p = l.pop()!; this.B.fill(0, p, p + n); }
    else {
      p = this.top; this.top += n;
      if (this.top > this.buf.byteLength) {
        const nb = new ArrayBuffer(Math.max(this.top + (8 << 20), this.buf.byteLength * 2));
        new Uint8Array(nb).set(this.B); this.views(nb);
      }
    }
    this.sizes.set(p, n);
    return p;
  }
  release(p: number): void {
    const n = this.sizes.get(p);
    if (!p || n === undefined) return;
    this.sizes.delete(p);
    const l = this.free.get(n);
    if (l) l.push(p); else this.free.set(n, [p]);
  }
}
