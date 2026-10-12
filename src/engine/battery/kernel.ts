// Battery's blur and palette passes in WebAssembly (assembly/battery.ts, embedded as
// ./kernel-wasm.ts), with index.ts's JavaScript as the fallback. Both run the same integer ops, so
// the output is identical whichever runs, frame by frame (tests/engine/golden runs every Battery
// fixture on each path and on a path that flips between them).
//
// A.batteryKernel: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM
// or throw (tests use it to prove the path ran). A Battery's front/back buffers and its surface
// live in an arena (newArena): a kernel instance of its own whose memory is sized once, at resize,
// and never grown, so the passes work on them in place. Arrays from anywhere else (the tests'
// internals calls) take the JS ('wasm' mode refuses them). The palette (1 KB) is copied in per pass.
// The module is under 1 KB, so it compiles synchronously; any refusal (no WebAssembly, no SIMD, a
// CSP without wasm-unsafe-eval, memory.grow failing) leaves the JS in charge for good.
import { A } from '../ns';
import { BATTERY_WASM } from './kernel-wasm';

interface Kernel {
  memory: WebAssembly.Memory;
  heapBase(): number;
  blur(src: number, dst: number, w: number, h: number): void;
  palette(src: number, pal: number, dst: number, n: number): void;
}

/** One Battery's buffers in its kernel's memory. */
export interface Arena {
  k: Kernel;
  front: Uint8Array;
  back: Uint8Array;
  px: Uint32Array;
  pal: Uint32Array;
}

A.batteryKernel = 'auto';

let M: WebAssembly.Module | null = null, broken = false;
const RESIDENT = new WeakMap<ArrayBuffer, Arena>();

/** null in 'js' mode or without WebAssembly: the caller keeps plain arrays. */
export function newArena(n: number): Arena | null {
  if (A.batteryKernel === 'js' || broken) return null;
  try {
    if (!M) {
      const bin = atob(BATTERY_WASM), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      M = new WebAssembly.Module(bytes);
    }
    const k = new WebAssembly.Instance(M, {}).exports as unknown as Kernel;
    const s8 = (n + 15) & ~15, at = k.heapBase(), bytes = at + 2 * s8 + 4 * s8 + 1024;
    const have = k.memory.buffer.byteLength;
    if (have < bytes) k.memory.grow(Math.ceil((bytes - have) / 65536));
    const buf = k.memory.buffer;                     // never grown again: views of it stay attached
    const ar: Arena = {
      k,
      front: new Uint8Array(buf, at, n),
      back: new Uint8Array(buf, at + s8, n),
      px: new Uint32Array(buf, at + 2 * s8, n),
      pal: new Uint32Array(buf, at + 6 * s8, 256),
    };
    RESIDENT.set(buf, ar);
    return ar;
  } catch {
    broken = true;                                   // no WebAssembly / SIMD / CSP: JS from now on
    return null;
  }
}

/** The arena `a` lives in, or null when the JS must run ('js' mode, or not resident in 'auto'). */
function arenaOf(a: ArrayBufferView): Arena | null {
  const mode = A.batteryKernel;
  if (mode === 'js') return null;
  const ar = RESIDENT.get(a.buffer as ArrayBuffer) || null;
  if (!ar && mode === 'wasm') throw new Error('Battery: the WebAssembly kernel is unavailable here');
  return ar;
}

/** blur's rows 1..h-2 (src -> dst) in WASM; false when the caller must run the JavaScript. */
export function blurWasm(src: Uint8Array, dst: Uint8Array, w: number, h: number): boolean {
  const ar = arenaOf(src);
  if (!ar || dst.buffer !== src.buffer) return false;
  ar.k.blur(src.byteOffset, dst.byteOffset, w, h);
  return true;
}

/** px = pal[src] in WASM; false when the caller must run the JavaScript. */
export function paletteWasm(src: Uint8Array, pal: Uint32Array, px: Uint32Array, n: number): boolean {
  const ar = arenaOf(src);
  if (!ar || px.buffer !== src.buffer) return false;
  ar.pal.set(pal);
  ar.k.palette(src.byteOffset, ar.pal.byteOffset, px.byteOffset, n);
  return true;
}
