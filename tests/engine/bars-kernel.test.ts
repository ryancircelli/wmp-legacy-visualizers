// @vitest-environment node
// Bars' drawing on the WebAssembly path (src/engine/bars-kernel.ts) against the JavaScript path, frame
// by frame, on what the golden fixtures do not cover: more than 1024 columns, a width whose last bar
// lands on column W-1, tiny surfaces, a resize and a background change mid-run, wide bars without
// spacing, peaks off; the fallback when WebAssembly is missing or refused; and the module's size.
// The golden guard (tests/engine/golden) covers whole engine runs on both paths.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/effect';
import '../../src/engine/bars';
import { InputGen } from './golden/harness';
import { BARS_WASM } from '../../src/engine/bars-wasm';

type BarsT = InstanceType<typeof A.Bars>;
const bytes = (a: Uint32Array | Int32Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

// Two Bars, one made on each path, fed the same frames and the same rand() stream; every frame's
// pixels and the trail history must match.
function lockstep(w: number, h: number, preset: number, frames: number, tweak?: (b: BarsT, f: number) => void): void {
  A.barsKernel = 'js';
  const js = new A.Bars({ width: w, height: h, preset });
  A.barsKernel = 'wasm';
  const wasm = new A.Bars({ width: w, height: h, preset });
  expect(bytes(wasm.surface.px).length < wasm.surface.px.buffer.byteLength).toBe(true);   // resident
  const gen = new InputGen();
  A.srand(1);
  for (let f = 0; f < frames; f++) {
    const L = gen.next(), seed = A.randSeed();
    A.barsKernel = 'js'; tweak?.(js, f); js.render(L);
    const drawn = A.randSeed();
    A.randSeed(seed);
    A.barsKernel = 'wasm'; tweak?.(wasm, f); wasm.render(L);
    expect(A.randSeed()).toBe(drawn);
    if (!bytes(wasm.surface.px).equals(bytes(js.surface.px)) || !bytes(wasm.history).equals(bytes(js.history)))
      expect.fail(`${w}x${h} preset ${preset}: frame ${f} differs`);
  }
}

afterEach(() => { A.barsKernel = 'auto'; });

describe('bars kernel: WebAssembly vs JavaScript', () => {
  it('every preset on sizes the fixtures do not cover', () => {
    for (const [w, h] of [[1280, 720], [775, 529], [1025, 40], [3, 2], [1, 1], [2, 300]] as const)
      for (let p = 0; p < 4; p++) lockstep(w, h, p, 150);
  }, 60_000);

  it('a resize, a background change, wide unspaced bars and peaks off, mid-run', () => {
    for (let p = 0; p < 3; p++) {
      lockstep(300, 200, p, 400, (b, f) => {
        if (f === 100) b.resize(517, 130);
        if (f === 200) b.options.backgroundColor = 0x203040;
        if (f === 250) { b.levelWidth = 7; b.horizontalSpacing = 0; }
        if (f === 300) b.showPeaks = false;
      });
    }
  }, 60_000);

  it("'wasm' refuses a surface outside an arena; 'js' makes none", () => {
    const b = new A.Bars({ width: 64, height: 48, preset: 1 });
    b.surface = { w: 64, h: 48, px: new Uint32Array(64 * 48) };
    A.barsKernel = 'wasm';
    const L = new InputGen().next();
    L.timeStamp = 1;
    expect(() => b.render(L)).toThrow(/WebAssembly/);
    A.barsKernel = 'js';
    const j = new A.Bars({ width: 64, height: 48 });
    expect(j.surface.px.buffer.byteLength).toBe(64 * 48 * 4);
  });

  it('is small enough for a synchronous compile on a browser main thread (< 4 KB)', () => {
    expect(atob(BARS_WASM).length).toBeLessThan(4096);
  });
});

describe('bars kernel: fallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const refused = {
    'no WebAssembly': undefined,
    'compile refused (CSP)': { ...WebAssembly, Module: class { constructor() { throw new WebAssembly.CompileError('refused'); } } },
  };
  for (const [what, stub] of Object.entries(refused)) {
    it(`${what}: 'auto' renders the identical frames on the JS path, 'wasm' throws`, async () => {
      const run = (NS: typeof A): Buffer => {
        NS.srand(1);
        const b = new NS.Bars({ width: 97, height: 61, preset: 2 }), gen = new InputGen();
        for (let f = 0; f < 60; f++) b.render(gen.next());
        return bytes(b.surface.px);
      };
      A.barsKernel = 'js';
      const want = run(A);
      vi.stubGlobal('WebAssembly', stub);
      vi.resetModules();
      const fresh = (await import('../../src/engine/ns')).A;
      await import('../../src/engine/rand');
      await import('../../src/engine/effect');
      await import('../../src/engine/bars');
      expect(run(fresh).equals(want)).toBe(true);
      fresh.barsKernel = 'wasm';
      expect(() => run(fresh)).toThrow(/WebAssembly/);
    });
  }
});
