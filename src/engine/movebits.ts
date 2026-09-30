// ShiftMoveBits' gather + blur, and _build3's transition ladder, in WebAssembly SIMD
// (assembly/movebits.ts, embedded as ./movebits-wasm.ts), with shift.ts's JavaScript as the fallback. Both run the same integer ops, so
// the output is identical whichever runs, frame by frame (tests/engine/golden runs every Alchemy
// fixture on each path and on a path that flips between them).
//
// A.moveBitsMode: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM
// or throw (tests use it to prove the path ran). Nothing touches WebAssembly until the first Shift
// frame. The module is under 1 KB, far below the 4 KB browsers allow for a synchronous compile on
// the main thread, so it compiles synchronously right there; any refusal (no WebAssembly, no SIMD,
// a CSP without wasm-unsafe-eval, memory.grow failing) leaves the JS path in charge for good.
//
// Resident: Shift keeps A.px, B.px and its warp tables (and the ladder's row and ramps) as views
// into an arena (newArena), a kernel instance of its own whose memory never grows after it is made,
// so the kernel works on them in place; the ladder only ever runs there (ladderWasm). Otherwise (arrays from anywhere else, e.g. a test's) the shared kernel works on copies in
// its memory, [src | dst | tab] each rounded up to 16 bytes: A.px and the table in, the gathered
// image (B.px) and the blurred interior rows (A.px rows 1..H-2) out, rows 0 and H-1 of A.px left
// alone as the JS leaves them. Those copies cost ~0.2 ms a frame at 640x480. The shared memory
// only grows; its views are re-made whenever the buffer changes (a grow detaches the old one).
import { A } from './ns';
import { MOVEBITS_WASM } from './movebits-wasm';

export type MoveBitsMode = 'auto' | 'js' | 'wasm';

interface Kernel {
  memory: WebAssembly.Memory;
  heapBase(): number;
  moveBits(src: number, tab: number, dst: number, W: number, H: number): void;
  ladder(row: number, ramp: number, L: number, tabs: number, o0: number, W: number, H: number): void;
}

A.moveBitsMode = 'auto';

let M: WebAssembly.Module | null = null, K: Kernel | null = null, broken = false, base = 0;
let u32 = new Uint32Array(0), i32 = new Int32Array(0);
const RESIDENT = new WeakMap<ArrayBuffer, Kernel>();   // arena memory -> its kernel

function instance(): Kernel {
  if (!M) {
    const bin = atob(MOVEBITS_WASM), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    M = new WebAssembly.Module(bytes);
  }
  return new WebAssembly.Instance(M, {}).exports as unknown as Kernel;
}

function kernel(): Kernel | null {
  if (K || broken) return K;
  try {
    K = instance();
    base = K.heapBase();
  } catch {
    broken = true;                                   // no WebAssembly / SIMD / CSP: JS from now on
  }
  return K;
}

/** `slots` arrays of n 32-bit words in a kernel instance's own memory, for moveBitsWasm to use in
 *  place, and the transition ladder's row and ramps for ladderWasm (a surface w x h). */
export interface Arena {
  n: number;
  w: number;
  buf: ArrayBuffer;
  u32(slot: number): Uint32Array;
  i32(slot: number): Int32Array;
  /** the ladder's row: ox, oy, iX, iY per pixel, filled by the caller */
  row: Int32Array;
  k: Kernel;
  ramps: Int16Array;                                 // room for 22 ramps of up to 2 * max(w, h)
  rampOf: Int16Array[] | null;                       // the ramps copied into it
  tabs: Uint32Array;                                 // the 22 tables' byte offsets
}

/** null in 'js' mode or without WebAssembly: the caller keeps plain arrays. */
export function newArena(n: number, slots: number, w: number, h: number): Arena | null {
  if (A.moveBitsMode === 'js' || broken) return null;
  try {
    const k = instance(), at = k.heapBase(), stride = ((n + 3) & ~3) * 4, row = at + slots * stride;
    const tabs = row + 16 * w, ramps = tabs + 96, cap = 22 * 2 * (w > h ? w : h), bytes = ramps + 2 * cap;
    const have = k.memory.buffer.byteLength;
    if (have < bytes) k.memory.grow(Math.ceil((bytes - have) / 65536));
    const buf = k.memory.buffer;                     // never grown again: views of it stay attached
    RESIDENT.set(buf, k);
    return {
      n, w, buf, u32: (s) => new Uint32Array(buf, at + s * stride, n), i32: (s) => new Int32Array(buf, at + s * stride, n),
      row: new Int32Array(buf, row, 4 * w), k, ramps: new Int16Array(buf, ramps, cap), rampOf: null, tabs: new Uint32Array(buf, tabs, 22),
    };
  } catch {
    broken = true;                                   // as kernel(): JS from now on
    return null;
  }
}

/** Room for three n-pixel arrays; false if the memory cannot grow (then JS for good). */
function fit(k: Kernel, bytes: number): boolean {
  const have = k.memory.buffer.byteLength;
  if (have < bytes) {
    try { k.memory.grow(Math.ceil((bytes - have) / 65536)); } catch { broken = true; K = null; return false; }
  }
  if (u32.buffer !== k.memory.buffer) { u32 = new Uint32Array(k.memory.buffer); i32 = new Int32Array(k.memory.buffer); }
  return true;
}

/**
 * dst = src[tab] (0 outside [0, n)), then src rows 1..H-2 = blur(dst), in WASM. Returns false when
 * the caller must run the JavaScript instead ('js' mode, or WASM unavailable in 'auto' mode).
 */
export function moveBitsWasm(src: Uint32Array, tab: Int32Array, dst: Uint32Array, W: number, H: number): boolean {
  const mode = A.moveBitsMode;
  if (mode === 'js') return false;
  const n = W * H, rk = RESIDENT.get(src.buffer as ArrayBuffer);
  if (rk && tab.buffer === src.buffer && dst.buffer === src.buffer && src.length === n && dst.length === n && tab.length === n) {
    rk.moveBits(src.byteOffset, tab.byteOffset, dst.byteOffset, W, H);   // in place, no copies
    return true;
  }
  const stride = (n + 3) & ~3, k = kernel();
  if (!k || src.length !== n || dst.length !== n || tab.length !== n || !fit(k, base + 12 * stride)) {
    if (mode === 'wasm') throw new Error('Alchemy: the WebAssembly moveBits path is unavailable here');
    return false;
  }
  const s = base >> 2, d = s + stride, t = d + stride, end = (H - 1) * W;
  u32.set(src, s);
  i32.set(tab, t);
  k.moveBits(s << 2, t << 2, d << 2, W, H);
  dst.set(u32.subarray(d, d + n));
  if (end > W) src.set(u32.subarray(s + W, s + end), W);
  return true;
}

/**
 * The transition ladder's entries o0 .. o0 + W - 1 of the 22 tables `cur`, from ar.row and `ramp`, in
 * WASM: the JavaScript loop in shift.ts _build3, the same entries. false when the caller must run that
 * loop ('js' mode, or a table or the row not in this arena).
 */
export function ladderWasm(ar: Arena, ramp: Int16Array[], cur: Int32Array[], o0: number, W: number, H: number): boolean {
  if (A.moveBitsMode === 'js' || ar.w !== W || ramp.length !== 22 || cur.length !== 22) return false;
  const L = ramp[0].length;
  if (22 * L > ar.ramps.length) return false;
  for (let k = 0; k < 22; k++) {
    const t = cur[k];
    if (t.buffer !== ar.buf || ramp[k].length !== L) return false;
    ar.tabs[k] = t.byteOffset;
  }
  if (ar.rampOf !== ramp) {                          // new ramps (init, or options.intended changed)
    for (let k = 0; k < 22; k++) ar.ramps.set(ramp[k], k * L);
    ar.rampOf = ramp;
  }
  ar.k.ladder(ar.row.byteOffset, ar.ramps.byteOffset, L, ar.tabs.byteOffset, o0, W, H);
  return true;
}
