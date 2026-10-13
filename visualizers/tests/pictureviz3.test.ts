// Picture Viz 3D (Picture_Viz_III.dll, Alchemy.PictureViz3): presets, what drives it (the clock and the pictures,
// never the sound), rand use, the device swap; then a golden guard over the port's own output on synthetic pictures
// and a pinned clock: the Direct3D call stream (the trace device, every preset) and a few frames of pixels (the
// reference rasterizer). The fixture (./golden/fixtures/pictureviz3.json) was written once the engine was verified
// against the DLL: GOLDEN_UPDATE=1 npx vitest run tests/engine/pictureviz3.test.ts rewrites it.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../src/ns';
import '../src/rand';
import '../src/pictureviz/pv3/index';
import { TraceDevice } from '../src/d3d8/trace';
import type { Picture } from '../src/pictureviz/picture';
import { level } from './helpers-2';

const PV = A.PictureViz3;

/** synthetic pictures: a gradient, a checkerboard, rings (our own, deterministic) */
function pic(kind: number, w: number, h: number): Picture {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (kind === 0) { rgb[i] = (x * 255 / (w - 1)) | 0; rgb[i + 1] = (y * 255 / (h - 1)) | 0; rgb[i + 2] = ((x + y) * 255 / (w + h - 2)) | 0; }
    else if (kind === 1) { const k = ((x >> 3) + (y >> 3)) & 1; rgb[i] = k ? 230 : 20; rgb[i + 1] = k ? 40 : 200; rgb[i + 2] = k ? 40 : 240; }
    else { const d = Math.hypot(x - w / 2, y - h / 2), v = (127.5 + 127.5 * Math.sin(d / 3)) | 0; rgb[i] = v; rgb[i + 1] = 255 - v; rgb[i + 2] = (v * 3) & 255; }
  }
  return { w, h, rgb };
}
const PICS = [pic(0, 96, 72), pic(1, 60, 90), pic(2, 80, 80)];

const fnv = (h: number, b: Uint8Array | Uint32Array): number => {
  for (let i = 0; i < b.length; i++) { h = Math.imul(h ^ b[i]!, 16777619); h ^= h >>> 13; }
  return h;
};

/** the trace folded with the trace device's object addresses (a counter shared by every device in the process)
 *  replaced by their order of creation, so two engines' traces compare */
function traceKey(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), ptrs = new Map<number, number>();
  const map = (v: number): number => ptrs.get(v) ?? v;
  let h = 0x811c9dc5, o = 8;
  const mix = (v: number): void => { h = Math.imul(h ^ (v >>> 0), 16777619); h ^= h >>> 13; };
  while (o < b.length) {
    const id = dv.getUint32(o, true), n = dv.getUint32(o + 8, true);
    mix(id); mix(dv.getUint32(o + 4, true));
    for (let k = 0; k < n; k++) mix(map(dv.getUint32(o + 12 + k * 4, true)));
    o += 12 + n * 4;
    const nb = dv.getUint32(o, true); o += 4;
    for (let k = 0; k < nb; k++) {
      const len = dv.getUint32(o, true); o += 4;
      if (len === 4) {
        const v = dv.getUint32(o, true);
        if (v >= 0x10000 && !ptrs.has(v)) ptrs.set(v, 0x100 + ptrs.size);
        mix(map(v));
      } else h = fnv(h, b.subarray(o, o + len));
      o += len;
    }
  }
  return h >>> 0;
}

/** an engine on a pinned clock (100 ms a frame), with the trace device (fast: no pixels) unless `ref` */
function make(preset: number, opts: { w?: number; h?: number; seed?: number; ref?: boolean; pictures?: Picture[] } = {}) {
  const t = { now: 100000, f: 0 };
  const box: { dev: TraceDevice | null } = { dev: null };
  const options = opts.ref ? {} : { device: (w: number, h: number) => (box.dev = new TraceDevice(w, h)) };
  const e = new PV({ width: opts.w ?? 160, height: opts.h ?? 120, preset, pictures: opts.pictures ?? PICS, tick: () => t.now, options });
  e.seed(opts.seed ?? 1);
  const step = (L = level(2)) => { const s = e.render(L); t.now = (100000 + ++t.f * 100) | 0; return s; };
  const trace = (): Uint8Array => (box.dev ? box.dev.bytes() : new Uint8Array(0));
  return { e, step, trace };
}

describe('PictureViz3: presets', () => {
  it('the DLL\'s 30 presets in GetPresetTitle order', () => {
    expect(PV.PRESET_NAMES.length).toBe(30);
    expect(PV.PRESET_NAMES[0]).toBe('Favorite 3D Transitions');
    expect(PV.PRESET_NAMES[4]).toBe('Pop');
    expect(PV.PRESET_NAMES[29]).toBe('Volcanic');
    const e = new PV({ options: { device: (w, h) => new TraceDevice(w, h) } });
    expect(e.setPreset(29)).toBe(true);
    expect(e.setPreset(30)).toBe(false);
    expect(e.setPreset(-1)).toBe(false);
  });

  it('the first frame creates the device and presents nothing; then every frame presents the back buffer', () => {
    const { step } = make(4, { ref: true, w: 64, h: 48 });
    expect(step()).toBeNull();
    const s = step()!;
    expect([s.w, s.h, s.px.length]).toEqual([64, 48, 64 * 48]);
    expect(s.px.every((v) => v >>> 24 === 0)).toBe(true);
  }, 120_000);
});

describe('PictureViz3: input', () => {
  it('never reads the TimedLevel: silence and loud input make the same calls', () => {
    // (one after the other: rand's state is the CRT's, global, as in the DLL)
    const a = make(14);
    for (let f = 0; f < 60; f++) a.step();
    const b = make(14);
    for (let f = 0; f < 60; f++) {
      const M = level(2, (L) => { for (let i = 0; i < 1024; i++) { L.freq[0][i] = (i * 7 + f) & 255; L.wave[0][i] = (i + f * 3) & 255; } });
      M.state = f % 3;
      b.step(M);
    }
    expect(traceKey(b.trace())).toBe(traceKey(a.trace()));
  }, 120_000);

  it('rand: the water drops of Water Rain come from it (the seed changes them); Pop draws none', () => {
    const count = (preset: number, seed: number) => {
      let n = 0;
      const real = A.rand;
      A.rand = () => { n++; return real(); };
      try { const m = make(preset, { seed }); for (let f = 0; f < 60; f++) m.step(); return { n, h: traceKey(m.trace()) }; } finally { A.rand = real; }
    };
    expect(count(4, 1).n).toBe(0);
    const a = count(14, 1), b = count(14, 2);
    expect(a.n).toBeGreaterThan(0);
    expect(a.h).not.toBe(b.h);
  }, 120_000);
});

// ---- golden: the call stream (traceKey of the trace so far, every 40 frames over 120 frames: a picture change and its
// transition) of every preset; pixels (the reference rasterizer) of three presets for a few frames
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'fixtures', 'pictureviz3.json');
const TRACE_FRAMES = 120, PIXEL_FRAMES = 6;

function goldenTrace(preset: number): string[] {
  const { step, trace } = make(preset);
  const out: string[] = [];
  for (let f = 0; f < TRACE_FRAMES; f++) {
    step();
    if ((f + 1) % 40 === 0) out.push(traceKey(trace()).toString(16).padStart(8, '0'));
  }
  return out;
}
function goldenPixels(preset: number): string[] {
  const { step } = make(preset, { ref: true, w: 96, h: 72 });
  const out: string[] = [];
  for (let f = 0; f < PIXEL_FRAMES; f++) { const s = step(); out.push(s ? (fnv(0x811c9dc5, s.px) >>> 0).toString(16).padStart(8, '0') : '-'); }
  return out;
}

describe.skipIf(process.env.GOLDEN_UPDATE !== '1' && !existsSync(GOLDEN))('PictureViz3: golden', () => {
  const update = process.env.GOLDEN_UPDATE === '1';
  const want: Record<string, string[]> = update || !existsSync(GOLDEN) ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const got: Record<string, string[]> = {};
  for (let p = 0; p < 30; p++) {
    it(`trace p${p} ${PV.PRESET_NAMES[p]}`, () => {
      got[`trace-p${p}`] = goldenTrace(p);
      if (!update) expect(got[`trace-p${p}`]).toEqual(want[`trace-p${p}`]);
    }, 300_000);
  }
  for (const p of [4, 9, 14]) {
    it(`pixels p${p} ${PV.PRESET_NAMES[p]}`, () => {
      got[`pixels-p${p}`] = goldenPixels(p);
      if (!update) expect(got[`pixels-p${p}`]).toEqual(want[`pixels-p${p}`]);
    }, 300_000);
  }
  it('fixture', () => {
    if (update) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    expect(Object.keys(update ? got : want).length).toBe(33);
  });
});
