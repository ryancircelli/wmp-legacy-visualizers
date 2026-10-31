// 3D Spectrum Analyzer's per-frame work in WebAssembly (assembly/wm3dspectrum.ts, embedded as ./kernel-wasm.ts):
// the vertex stage and the triangles or points, the same operations as index.ts's vertices() and raster.ts in the
// same order, so the pixels are identical whichever runs (tests/wm3dspectrum.test.ts compares the two paths).
//
// A.wm3dKernel: 'auto' (default) = WASM when it loads, else JS; 'js' = always JS; 'wasm' = WASM or throw. An engine's
// buffers live in its own kernel instance's memory (an arena), where the JavaScript path works on them too:
// the height field, the sampling tables, the effect constants, the vertex arrays, both palettes, then the target,
// which grows the memory when the window does (every view is made again then). Any refusal (no WebAssembly, a CSP
// without wasm-unsafe-eval, memory.grow failing) leaves the JavaScript in charge.
import { A } from '../ns';
import { WM3D_WASM } from './kernel-wasm';

export interface Kernel {
  memory: WebAssembly.Memory;
  heapBase(): number;
  bind(field: number, iu: number, jv: number, c: number, vx: number, vy: number, vz: number, vw: number,
    vxs: number, vys: number, vs: number, px: number, zb: number, tw: number, th: number): void;
  palette(cols: number): void;
  vertices(head: number, W: number, H: number): void;
  triangles(): void;
  points(): void;
}

/** an engine's kernel and the byte offsets of its buffers (the target's is last: it grows with the window) */
export interface Arena {
  k: Kernel;
  field: number; iu: number; jv: number; c: number; verts: number; cols: [number, number]; target: number;
}

A.wm3dKernel = 'auto';
let M: WebAssembly.Module | null = null, broken = false;

/** a kernel for vertex arrays of nv and palettes of nc floats; null in 'js' mode or without WebAssembly */
export function newArena(nv: number, nc: number): Arena | null {
  if (A.wm3dKernel === 'js' || broken) return null;
  try {
    if (!M) {
      const bin = atob(WM3D_WASM), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      M = new WebAssembly.Module(bytes);
    }
    const k = new WebAssembly.Instance(M, {}).exports as unknown as Kernel;
    let at = k.heapBase();
    const take = (n: number): number => { const p = at; at += (n + 15) & ~15; return p; };
    const ar: Arena = { k, field: take(nv), iu: take(12 * 1024), jv: take(12 * 1024), c: take(64), verts: take(28 * nv),
      cols: [take(4 * nc), take(4 * nc)], target: at };
    reserve(ar, 0);
    return ar;
  } catch {
    broken = true;
    return null;
  }
}

/** room for a target of n pixels; true when the memory grew (its old views are detached) */
export function reserve(ar: Arena, n: number): boolean {
  const need = ar.target + 8 * n, have = ar.k.memory.buffer.byteLength;
  if (have >= need) return false;
  ar.k.memory.grow(Math.ceil((need - have) / 65536));
  return true;
}
