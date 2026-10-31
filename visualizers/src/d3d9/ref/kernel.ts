// RefDevice9's WebAssembly quad kernel (./kernel-as.ts, embedded as ./kernel-wasm.ts) and its memory, after
// ../../d3d8/ref/kernel.ts. The kernel runs rast.ts / ps.ts / tex.ts's per-quad arithmetic operation for operation,
// so a frame is the same whichever path draws it (tests/d3d9.test.ts renders on both). Surfaces live in the
// kernel's memory (`heap`), handed out as views that are re-made whenever the memory grows.
//
// refKernel9.mode: 'auto' (default) = the kernel when it is loaded, else JS; 'js' = always JS; 'wasm' = the kernel
// or throw. Node compiles the module (about 7 KB) synchronously on first use; a browser main thread allows
// synchronous compiles of 4 KB only, so there RefDevice9.prepare() (or the first device) starts an asynchronous
// compile and JS draws until it lands. Surfaces made before the kernel loaded stay in JS memory, and draws touching
// them take the JS path.
import { REF9_KERNEL_WASM } from './kernel-wasm';

interface Exports {
  memory: WebAssembly.Memory;
  heapBase(): number;
  stateBase(): number;
  init(): void;
  scan(): void;
}

export const refKernel9 = { mode: 'auto' as 'auto' | 'js' | 'wasm' };

let X: Exports | null = null, broken = false, pending: Promise<void> | null = null;
function bytes(): Uint8Array {
  const bin = atob(REF9_KERNEL_WASM), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function start(m: WebAssembly.Module): void {
  // pow2: ps.ts pow's exp (Math.pow), which the kernel imports
  X = new WebAssembly.Instance(m, { 'kernel-as': { pow2: (x: number) => Math.pow(2, x) } }).exports as unknown as Exports;
  X.init();
  heap.reset(X.heapBase());
}
/** compile asynchronously (browsers); resolves when the kernel is ready (or known unavailable) */
export function prepareKernel9(): Promise<void> {
  if (X || broken) return Promise.resolve();
  pending ??= WebAssembly.compile(bytes() as BufferSource).then(start, () => { broken = true; });
  return pending;
}
/** the kernel, or null (not loaded yet / unavailable / mode 'js') */
export function kernel9(): Exports | null {
  if (refKernel9.mode === 'js') return null;
  if (!X && !broken && !pending) {
    try { start(new WebAssembly.Module(bytes() as BufferSource)); } catch { void prepareKernel9(); }
  }
  if (!X && refKernel9.mode === 'wasm') throw new Error('RefDevice9: the WebAssembly kernel is unavailable here');
  return X;
}

/** first-fit allocator over the kernel's memory (16-byte aligned blocks), and views into it */
class Heap {
  private free: [number, number][] = [];   // [offset, size], sorted by offset
  private top = 0;
  buffer: ArrayBuffer | null = null;
  u8 = new Uint8Array(0);
  i32 = new Int32Array(0);
  f64 = new Float64Array(0);
  reset(base: number): void { this.top = (base + 15) & ~15; this.free = []; this.refresh(); }
  /** re-make the views after a grow (a grow detaches the old buffer) */
  refresh(): void {
    if (X && this.buffer !== X.memory.buffer) {
      this.buffer = X.memory.buffer;
      this.u8 = new Uint8Array(this.buffer); this.i32 = new Int32Array(this.buffer); this.f64 = new Float64Array(this.buffer);
    }
  }
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
}
export const heap = new Heap();

/** the layout of kernel-as.ts (byte offsets) */
export const K9 = { SI: 1024, SF: 2048, SAMP: 4096, PROG: 8192, PROGF: 14336, REGS: 24576 } as const;
