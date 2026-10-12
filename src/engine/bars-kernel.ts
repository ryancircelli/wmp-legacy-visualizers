// Bars and Waves' bar drawing and trail sink in WebAssembly (assembly/bars.ts, embedded as
// ./bars-wasm.ts), with bars.ts's JavaScript as the fallback. Both run the same integer ops in the
// same order, so the output is identical whichever runs, frame by frame (tests/engine/golden runs
// every Bars fixture on each path and on a path that flips between them).
//
// A.barsKernel: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM or
// throw (tests use it to prove the path ran). A Bars' surface, trail history, trail palettes and
// per-bar level/peak values live in an arena (newArena): a kernel instance of its own whose memory
// is sized once, at resize, and never grown, so the kernel works on them in place, no copies. A
// surface from anywhere else (a test's) takes the JS ('wasm' mode refuses it). The module is under
// 2 KB, so it compiles synchronously; any refusal (no WebAssembly, no SIMD, a CSP without
// wasm-unsafe-eval, memory.grow failing) leaves the JS in charge for good.
import { A } from './ns';
import { BARS_WASM } from './bars-wasm';

interface Kernel {
  memory: WebAssembly.Memory;
  heapBase(): number;
  draw(px: number, W: number, H: number, hist: number, lt: number, pt: number, lv: number, pk: number,
    n: number, barW: number, spacing: number, xoff: number, trail: number, head: number, term: number, peaks: number): void;
  sink(hist: number, n: number, H: number): void;
}

/** One Bars' buffers in its kernel's memory. */
export interface Arena {
  k: Kernel;
  px: Uint32Array;
  history: Int32Array;
  levelTrail: Int32Array;
  peakTrail: Int32Array;
  lv: Int32Array;
  pk: Int32Array;
}

A.barsKernel = 'auto';

let M: WebAssembly.Module | null = null, broken = false;
const RESIDENT = new WeakMap<ArrayBufferLike, Arena>();

/** null in 'js' mode or without WebAssembly: the caller keeps plain arrays. */
export function newArena(n: number): Arena | null {
  if (A.barsKernel === 'js' || broken) return null;
  try {
    if (!M) {
      const bin = atob(BARS_WASM), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      M = new WebAssembly.Module(bytes);
    }
    const k = new WebAssembly.Instance(M, {}).exports as unknown as Kernel;
    const at = k.heapBase(), s = (n + 3) & ~3;       // [px | history 2048x16 | 2 x 16 trails | lv | pk]
    const bytes = at + 4 * (s + 32768 + 32 + 2048);
    const have = k.memory.buffer.byteLength;
    if (have < bytes) k.memory.grow(Math.ceil((bytes - have) / 65536));
    const buf = k.memory.buffer;                     // never grown again: views of it stay attached
    const i32 = (o: number, len: number) => new Int32Array(buf, at + 4 * o, len);
    const ar: Arena = {
      k,
      px: new Uint32Array(buf, at, n),
      history: i32(s, 32768),
      levelTrail: i32(s + 32768, 16),
      peakTrail: i32(s + 32784, 16),
      lv: i32(s + 32800, 1024),
      pk: i32(s + 33824, 1024),
    };
    RESIDENT.set(buf, ar);
    return ar;
  } catch {
    broken = true;                                   // no WebAssembly / SIMD / CSP: JS from now on
    return null;
  }
}

/** The arena `a` lives in, or null when the JS must run ('js' mode, or not resident in 'auto'). */
export function arenaOf(a: ArrayLike<number>): Arena | null {
  const mode = A.barsKernel;
  if (mode === 'js') return null;
  const buf = (a as Partial<Uint32Array>).buffer;
  const ar = (buf && RESIDENT.get(buf)) || null;
  if (!ar && mode === 'wasm') throw new Error('Bars: the WebAssembly kernel is unavailable here');
  return ar;
}
