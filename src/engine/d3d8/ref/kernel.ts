// The WebAssembly rasterizer (./kernel-as.ts, embedded as ./kernel-wasm.ts) and its memory. The kernel runs rast.ts's
// arithmetic operation for operation, so a frame is the same whichever path draws it (tests/engine/d3d8-ref.test.ts
// renders every scene on both and on a path that alternates). The kernel draws in place: surfaces (textures, render
// targets, depth), the TL vertices and the clipper's vertices live in its memory (`heap`), handed out as views that
// are re-made whenever the memory grows (a grow detaches the old buffer).
//
// refKernel.mode: 'auto' (default) = the kernel when it is loaded, else JS; 'js' = always JS; 'wasm' = the kernel or
// throw (tests use it to prove the path ran). The module is about 21 KB: Node compiles it synchronously on first use;
// a browser main thread allows synchronous compiles of 4 KB only, so there RefDevice.prepare() (or the first device)
// starts an asynchronous compile, and JS draws until it lands. Resources made before the kernel loaded stay in JS
// memory, and draws touching them take the JS path.
import { REF_KERNEL_WASM } from './kernel-wasm';

interface Exports {
  memory: WebAssembly.Memory;
  heapBase(): number;
  stateBase(): number;
  init(): void;
  triangle(a: number, b: number, c: number): number;
  point(v: number): void;
}

export const refKernel = { mode: 'auto' as 'auto' | 'js' | 'wasm' };

let X: Exports | null = null, broken = false, pending: Promise<void> | null = null;
function bytes(): Uint8Array {
  const bin = atob(REF_KERNEL_WASM), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function start(m: WebAssembly.Module): void {

  X = new WebAssembly.Instance(m, {}).exports as unknown as Exports;
  X.init();
  heap.reset(X.heapBase());
}
/** compile asynchronously (browsers); resolves when the kernel is ready (or known unavailable) */
export function prepareKernel(): Promise<void> {
  if (X || broken) return Promise.resolve();
  pending ??= WebAssembly.compile(bytes() as BufferSource).then(start, () => { broken = true; });
  return pending;
}
/** the kernel, or null (not loaded yet / unavailable / mode 'js') */
export function kernel(): Exports | null {
  if (refKernel.mode === 'js') return null;
  if (!X && !broken && !pending) {
    try { start(new WebAssembly.Module(bytes() as BufferSource)); } catch { void prepareKernel(); }
  }
  if (!X && refKernel.mode === 'wasm') throw new Error('RefDevice: the WebAssembly rasterizer is unavailable here');
  return X;
}

/** first-fit allocator over the kernel's memory (16-byte aligned blocks), and views into it */
class Heap {
  private free: [number, number][] = [];   // [offset, size], sorted by offset
  private top = 0;
  buffer: ArrayBuffer | null = null;
  u8 = new Uint8Array(0);
  reset(base: number): void { this.top = (base + 15) & ~15; this.free = []; this.refresh(); }
  private refresh(): void { if (X && this.buffer !== X.memory.buffer) { this.buffer = X.memory.buffer; this.u8 = new Uint8Array(this.buffer); } }
  /** byte offset of n bytes, or -1 without the kernel */
  alloc(n: number): number {
    if (!X) return -1;
    n = (n + 15) & ~15;
    for (let i = 0; i < this.free.length; i++) {
      const [o, s] = this.free[i];
      if (s >= n) { if (s === n) this.free.splice(i, 1); else this.free[i] = [o + n, s - n]; this.u8.fill(0, o, o + n); return o; }
    }
    const o = this.top;
    this.top += n;
    const need = this.top - X.memory.buffer.byteLength;
    if (need > 0) X.memory.grow(Math.ceil(need / 65536));
    this.refresh();
    return o;
  }
  release(o: number, n: number): void {
    if (o < 0) return;
    this.free.push([o, (n + 15) & ~15]);
    this.free.sort((a, b) => a[0] - b[0]);
  }
  /** a byte view of [o, o + n), current after any grow */
  view(o: number, n: number): Uint8Array { this.refresh(); return new Uint8Array(this.u8.buffer, o, n); }
  f64(o: number, n: number): Float64Array { this.refresh(); return new Float64Array(this.u8.buffer, o, n); }
  get current(): ArrayBuffer | null { this.refresh(); return this.buffer; }
}
export const heap = new Heap();

/** the draw-state block (layout: kernel-as.ts) */
export function stateViews(): { i32: Int32Array; f64: Float64Array; base: number } {
  const b = X!.stateBase(), buf = heap.current!;
  return { i32: new Int32Array(buf, b, 2048 / 4 + 8 * 128), f64: new Float64Array(buf, b + 1024, 128), base: b };
}
