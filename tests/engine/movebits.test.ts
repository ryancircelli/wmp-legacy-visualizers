// @vitest-environment node
// Shift's gather + blur on the WebAssembly path (src/engine/movebits.ts) against the JavaScript path,
// on arbitrary 32-bit pixels, odd sizes and out-of-range warp-table entries; the fallback when
// WebAssembly is missing or refused; and that the committed module is what its source compiles to.
// The golden guard (tests/engine/golden) covers whole engine runs on both paths.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/effect';
import { Shift } from '../../src/engine/shift';
import { MOVEBITS_WASM } from '../../src/engine/movebits-wasm';
import { ladderWasm, newArena } from '../../src/engine/movebits';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0;
}

// Random pixels (all 32 bits, so the masks are exercised) and a table of mostly in-range indexes
// plus the out-of-range kinds a JS typed array reads as 0: negative, n, and far beyond.
function inputs(W: number, H: number, seed: number): { px: Uint32Array; tab: Int32Array } {
  const r = lcg(seed), n = W * H, px = new Uint32Array(n), tab = new Int32Array(n);
  for (let i = 0; i < n; i++) px[i] = r();
  for (let i = 0; i < n; i++) tab[i] = r() % n;
  const bad = [-1, n, n + 5, 0x7fffffff, -0x80000000];
  for (let k = 0; k < bad.length && k < n; k++) tab[r() % n] = bad[k]!;
  return { px, tab };
}

// Three frames of _moveBits, feeding the output back in; returns A.px and B.px.
function moveBits(S: typeof Shift, W: number, H: number, seed: number, intended: boolean): Uint32Array[] {
  const { px, tab } = inputs(W, H, seed);
  const s = new S();
  const ctx = {
    w: W, h: H, bgColor: 0x123456, options: { intended },
    A: { w: W, h: H, px }, B: { w: W, h: H, px: new Uint32Array(W * H).fill(0xdeadbeef) },
  };
  const t = { buf: tab, dirty: false, cursorY: 0 };
  for (let f = 0; f < 3; f++) (s as unknown as { _moveBits(t: unknown, c: unknown, i: boolean): void })._moveBits(t, ctx, intended);
  return [ctx.A.px, ctx.B.px];
}

// A surface can be a view into a kernel's memory (Shift keeps them resident): compare its own bytes.
const bytes = (a: Uint32Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

const SIZES: [number, number][] = [[1, 1], [2, 2], [3, 1], [1, 5], [5, 2], [7, 3], [13, 5], [16, 9], [33, 17],
  [640, 480], [641, 3], [9, 4], [333, 251], [4, 4]];   // grows, then small again on the grown memory

afterEach(() => { A.moveBitsMode = 'auto'; });

describe('movebits: WebAssembly vs JavaScript', () => {
  it('same A.px and B.px on every size, including table entries outside [0, n)', () => {
    for (const [W, H] of SIZES) {
      for (const intended of [true, false]) {
        if (!intended && (W * H) % 4 !== 0) continue;    // the %4 bail-out never reaches the kernel
        A.moveBitsMode = 'js';
        const want = moveBits(Shift, W, H, W * 31 + H, intended);
        A.moveBitsMode = 'wasm';
        const got = moveBits(Shift, W, H, W * 31 + H, intended);
        expect([W, H, intended, bytes(got[0]!).equals(bytes(want[0]!))]).toEqual([W, H, intended, true]);
        expect([W, H, intended, bytes(got[1]!).equals(bytes(want[1]!))]).toEqual([W, H, intended, true]);
      }
    }
  });

  it('an Engine resized mid-run (surfaces and tables move to a new arena) matches the JS path', async () => {
    await import('../../src/engine/alchemy');
    const { InputGen } = await import('./golden/harness');
    const run = (mode: 'js' | 'wasm'): Uint32Array[] => {
      A.moveBitsMode = mode;
      A.srand(1);
      const e = new A.Engine({ width: 64, height: 48 }), gen = new InputGen(), out: Uint32Array[] = [];
      e.seed(5);
      for (const [w, h] of [[64, 48], [80, 60], [64, 48]] as const) {
        e.resize(w, h);
        for (let f = 0; f < 150; f++) e.render(gen.next());
        out.push(e.A.px.slice());
        expect(e.A.px.buffer.byteLength > e.A.px.byteLength).toBe(mode === 'wasm');   // resident only on WASM
      }
      return out;
    };
    const want = run('js'), got = run('wasm');
    for (let k = 0; k < want.length; k++) expect(bytes(got[k]!).equals(bytes(want[k]!))).toBe(true);
  });

  it('is small enough for a synchronous compile on a browser main thread (< 4 KB)', () => {
    expect(atob(MOVEBITS_WASM).length).toBeLessThan(4096);
  });

  it('src/engine/movebits-wasm.ts is what assembly/movebits.ts compiles to', () => {
    execFileSync(process.execPath, [join(ROOT, 'tools/build-wasm.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  }, 60_000);
});

describe('movebits: the transition ladder', () => {
  // shift.ts _build3's JavaScript for one row, as the reference
  function ladderJS(row: Int32Array, ramp: Int16Array[], cur: Int32Array[], o0: number, W: number, H: number): void {
    const rowOff = Int32Array.from({ length: H + 1 }, (_, y) => y * W);
    for (let k = 0; k < 22; k++) {
      const r = ramp[k]!, b = cur[k]!;
      for (let x = 0, q = 0, o = o0; x < W; x++, q += 4, o++) b[o] = rowOff[row[q + 1]! + (r[row[q + 3]!]! | 0)]! + row[q]! + (r[row[q + 2]!]! | 0);
    }
  }
  it('WASM rows match the JavaScript, ramp overruns and rows off the surface included', () => {
    for (const [W, H, half] of [[64, 48, 64], [36, 64, 36], [36, 64, 64], [5, 3, 5]] as const) {
      const n = W * H, ar = newArena(n, 26, W, H)!, r = lcg(W * 7 + H);
      const ramp = Array.from({ length: 22 }, (_, k) => Int16Array.from({ length: 2 * half }, (_, i) => Math.trunc((i - half) * Math.fround(Math.fround(k + 1) * Math.fround(0.04347826)))));
      const cur = Array.from({ length: 22 }, (_, k) => ar.i32(4 + k).fill(-7)), want = cur.map((t) => t.slice());
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ox = r() % W, oy = r() % H, sx = r() % W, sy = r() % H, q = 4 * x;
          ar.row[q] = ox; ar.row[q + 1] = oy; ar.row[q + 2] = half + (sx - ox); ar.row[q + 3] = half + (sy - oy);
          if (r() % 9 === 0) ar.row[q + 3] = r() % 2 ? -1 - (r() % 5) : 2 * half + (r() % 5);   // off a ramp
          if (r() % 11 === 0) { ar.row[q + 1] = H - 1; ar.row[q + 3] = 2 * half - 1; }        // below the last row
        }
        ladderJS(ar.row, ramp, want, y * W, W, H);
        expect(ladderWasm(ar, ramp, cur, y * W, W, H)).toBe(true);
      }
      for (let k = 0; k < 22; k++) expect([W, H, k, Buffer.from(cur[k]!.buffer, cur[k]!.byteOffset, 4 * n).equals(Buffer.from(want[k]!.buffer))]).toEqual([W, H, k, true]);
    }
  });
});

describe('movebits: fallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  // A fresh engine module graph, so the kernel is loaded (and refused) from scratch.
  async function freshShift(): Promise<{ A: typeof A; Shift: typeof Shift }> {
    vi.resetModules();
    const ns = await import('../../src/engine/ns');
    await import('../../src/engine/rand');
    await import('../../src/engine/effect');
    const sh = await import('../../src/engine/shift');
    return { A: ns.A, Shift: sh.Shift };
  }

  const refused = {
    'no WebAssembly': undefined,
    'compile refused (CSP)': { ...WebAssembly, Module: class { constructor() { throw new WebAssembly.CompileError('refused'); } } },
  };
  for (const [what, stub] of Object.entries(refused)) {
    it(`${what}: 'auto' renders the identical frame on the JS path, 'wasm' throws`, async () => {
      A.moveBitsMode = 'js';
      const want = moveBits(Shift, 64, 48, 7, false);
      vi.stubGlobal('WebAssembly', stub);
      const fresh = await freshShift();
      const got = moveBits(fresh.Shift, 64, 48, 7, false);
      expect(bytes(got[0]!).equals(bytes(want[0]!))).toBe(true);
      expect(bytes(got[1]!).equals(bytes(want[1]!))).toBe(true);
      fresh.A.moveBitsMode = 'wasm';
      expect(() => moveBits(fresh.Shift, 64, 48, 7, false)).toThrow(/WebAssembly/);
    });
  }
});
