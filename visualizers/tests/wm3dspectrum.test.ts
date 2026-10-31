// @vitest-environment node
// Alchemy.WM3DSpectrum (3D Spectrum Analyzer, src/wm3dspectrum), with a golden guard on the port's own output
// (./golden/fixtures/wm3dspectrum.json, written with GOLDEN_UPDATE=1 from the engine as verified bit-exact against the
// DLL; GOLDEN=full runs it in full).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import { spectrum, wvp } from '../src/wm3dspectrum/index';
import { InputGen } from './golden/harness';
import { level } from './helpers-2';

const WM3DSpectrum = A.WM3DSpectrum;

describe('3D Spectrum Analyzer', () => {
  it('eight presets; the window size is taken at the next render', () => {
    expect(WM3DSpectrum.PRESET_NAMES).toEqual(['Rose Garden', 'City Lights', 'Rose Garden Points', 'City Lights Points', 'Rose Garden - Smooth',
      'City Lights - Smooth', 'Rose Garden Points - Smooth', 'City Lights Points - Smooth']);
    const e = new WM3DSpectrum({ width: 40, height: 30 });
    expect([e.setPreset(8), e.setPreset(-1), e.setPreset(7)]).toEqual([false, false, true]);
    e.resize(64, 48);
    const s = e.render(level(2));
    expect([s.w, s.h, s.px.length, s.px.some((p) => p !== 0)]).toEqual([64, 48, 64 * 48, false]);   // silence: all black
  }, 60_000);
  it('the spectrum: bins paired with an 8-bit add, halved; Smooth a running mean of 20 over the replaced bins', () => {
    const f = new Uint8Array(1024), out = new Uint8Array(512);
    f[0] = 200; f[1] = 100; f[2] = 7; f[3] = 8;
    spectrum(f, out, false);
    expect([out[0], out[1], out[2]]).toEqual([22, 7, 0]);   // (300 & 255) >> 1
    f.fill(255);
    spectrum(f, out, true);
    expect([out[0], out[100], out[511]]).toEqual([127, 127, 127]);
    f.fill(0); f[2 * 300] = f[2 * 300 + 1] = 100;            // one bin of 100 at 300
    spectrum(f, out, true);
    expect([290, 291, 299, 300, 301, 310, 311].map((i) => out[i])).toEqual([0, 5, 7, 7, 2, 1, 0]);
  });
  it('the WebAssembly kernel draws every pixel the JavaScript does: each preset, a resize, a path switch mid-run', () => {
    const run = (preset: number, mode: (f: number) => 'js' | 'wasm'): Uint32Array[] => {
      const e = new WM3DSpectrum({ width: 97, height: 61, preset }), gen = new InputGen(0x3d5 + preset), out: Uint32Array[] = [];
      try {
        for (let f = 0; f < 60; f++) {
          A.wm3dKernel = mode(f);
          if (f === 40) e.resize(131, 89);
          if (f === 50) e.setPreset(preset ^ 1);   // the other palette
          const l = gen.next();
          if (f % 10 === 9) out.push(e.render(l).px.slice());
          else (e as unknown as { update(l: unknown): void }).update(l);
        }
      } finally { A.wm3dKernel = 'auto'; }
      return out;
    };
    let lit = 0;
    for (let p = 0; p < 8; p++) {
      const js = run(p, () => 'js');
      if (js.some((px) => px.some((c) => c !== 0))) lit++;
      expect(run(p, () => 'wasm'), `preset ${p}`).toEqual(js);
      expect(run(p, (f) => (f % 20 < 10 ? 'wasm' : 'js')), `preset ${p} switching`).toEqual(js);
    }
    expect(lit).toBeGreaterThan(4);   // (City Lights stays dark at low heights)
  }, 600_000);
  it('the camera: the effect constants the DLL sets at 320x240 (D3DX 9 on its x87 path)', () => {
    expect(Array.from(wvp(320, 240))).toEqual([-1.7405428886413574, 0, 0.4990004301071167, 0, -0.28384411334991455, 2.183493137359619, -0.9900649785995483, 0,
      -0.24925775825977325, -0.42662757635116577, -0.8694257736206055, 585.9156494140625, -0.24925276637077332, -0.4266190230846405, -0.869408369064331, 586.00390625]);
  });
});

// ---- golden guard: per 100-frame block, a hash of the height field after every frame and of every 25th frame's pixels
function fnv(a: Uint8Array | Uint32Array, h: number): number {
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i]!, 16777619);
  return h >>> 0;
}
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'wm3dspectrum.json');
const UPDATE = !!process.env.GOLDEN_UPDATE, FULL = process.env.GOLDEN === 'full' || UPDATE;
const RUNS = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => ({ id: `p${p}-160x120`, w: 160, h: 120, preset: p, frames: 400 }))
  .concat([{ id: 'p1-201x149', w: 201, h: 149, preset: 1, frames: 400 }]);
const SHORT = new Set(['p0-160x120', 'p3-160x120']);
function golden(run: (typeof RUNS)[number], frames: number): string[] {
  const e = new WM3DSpectrum({ width: run.w, height: run.h, preset: run.preset });
  const gen = new InputGen(0x5eed);
  const out: string[] = [];
  let h = 2166136261;
  for (let f = 0; f < frames; f++) {
    const l = gen.next();
    if (f % 25 === 24) h = fnv(e.render(l).px, h);
    else (e as unknown as { update(l: unknown): void }).update(l);
    h = fnv((e as unknown as { field: Uint8Array }).field, h);
    if (f % 100 === 99) { out.push(h.toString(16)); h = 2166136261; }
  }
  return out;
}
describe(`3D Spectrum Analyzer golden (${FULL ? 'full' : 'short prefix'})`, () => {
  const fixture: Record<string, string[]> = existsSync(FIX) ? (JSON.parse(readFileSync(FIX, 'utf8')) as Record<string, string[]>) : {};
  const fresh: Record<string, string[]> = {};
  for (const run of RUNS) {
    if (!FULL && !SHORT.has(run.id)) continue;
    const frames = FULL ? run.frames : 100;
    it(`${run.id} x ${frames} frames`, () => {
      const got = golden(run, frames);
      if (UPDATE) { fresh[run.id] = got; return; }
      expect(got).toEqual((fixture[run.id] || []).slice(0, got.length));
    }, 600_000);
  }
  it.runIf(UPDATE)('writes the fixture', () => {
    writeFileSync(FIX, JSON.stringify(fresh, null, 1) + '\n');
  });
});
