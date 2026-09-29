// ShiftMoveBits' gather + blur in WebAssembly SIMD (assembly/movebits.ts, embedded as
// ./movebits-wasm.ts), with shift.ts's JavaScript as the fallback. Both run the same integer ops, so
// the output is identical whichever runs, frame by frame (tests/engine/golden runs every Alchemy
// fixture on each path and on a path that flips between them).
//
// A.moveBitsMode: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM
// or throw (tests use it to prove the path ran). Nothing touches WebAssembly until the first Shift
// frame. The module is under 1 KB, far below the 4 KB browsers allow for a synchronous compile on
// the main thread, so it compiles synchronously right there; any refusal (no WebAssembly, no SIMD,
// a CSP without wasm-unsafe-eval, memory.grow failing) leaves the JS path in charge for good.
//
// The kernel works on copies in its own memory: [src | dst | tab], each rounded up to 16 bytes.
// A.px and the warp table are copied in, the gathered image (B.px) and the blurred interior rows
// (A.px rows 1..H-2) are copied out; rows 0 and H-1 of A.px are left alone, as the JS leaves them.
// The copies cost ~0.2 ms a frame at 640x480, a fifth of the WASM path. Memory only grows;
// views are re-made whenever the buffer changes (a grow detaches the old one).
import { A } from './ns';
import { MOVEBITS_WASM } from './movebits-wasm';

export type MoveBitsMode = 'auto' | 'js' | 'wasm';

interface Kernel {
  memory: WebAssembly.Memory;
  heapBase(): number;
  moveBits(src: number, tab: number, dst: number, W: number, H: number): void;
}

A.moveBitsMode = 'auto';

let K: Kernel | null = null, broken = false, base = 0;
let u32 = new Uint32Array(0), i32 = new Int32Array(0);

function kernel(): Kernel | null {
  if (K || broken) return K;
  try {
    const bin = atob(MOVEBITS_WASM), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    K = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as Kernel;
    base = K.heapBase();
  } catch {
    broken = true;                                   // no WebAssembly / SIMD / CSP: JS from now on
  }
  return K;
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
  const n = W * H, stride = (n + 3) & ~3, k = kernel();
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
