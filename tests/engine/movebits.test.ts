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
        expect([W, H, intended, Buffer.from(got[0]!.buffer).equals(Buffer.from(want[0]!.buffer))]).toEqual([W, H, intended, true]);
        expect([W, H, intended, Buffer.from(got[1]!.buffer).equals(Buffer.from(want[1]!.buffer))]).toEqual([W, H, intended, true]);
      }
    }
  });

  it('is small enough for a synchronous compile on a browser main thread (< 4 KB)', () => {
    expect(atob(MOVEBITS_WASM).length).toBeLessThan(4096);
  });

  it('src/engine/movebits-wasm.ts is what assembly/movebits.ts compiles to', () => {
    execFileSync(process.execPath, [join(ROOT, 'tools/build-wasm.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  }, 60_000);
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
      expect(Buffer.from(got[0]!.buffer).equals(Buffer.from(want[0]!.buffer))).toBe(true);
      expect(Buffer.from(got[1]!.buffer).equals(Buffer.from(want[1]!.buffer))).toBe(true);
      fresh.A.moveBitsMode = 'wasm';
      expect(() => moveBits(fresh.Shift, 64, 48, 7, false)).toThrow(/WebAssembly/);
    });
  }
});
