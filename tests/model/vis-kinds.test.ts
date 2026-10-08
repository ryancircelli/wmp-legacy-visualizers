// The model's visualizer kinds and preset limits (model/settings.ts VIS_PRESET_MAX) against the engine's own
// preset list: a family added to one and not the other, or a preset count that drifts, fails here.
import { expect, it } from 'vitest';
import { PRESETS, presetMax } from '../../src/engine';
import { VIS_PRESET_MAX, normalize } from '../../src/model/settings';

it("keeps the model's preset limits in step with the engine's presets", () => {
  const kinds = [...new Set(PRESETS.map((p) => p.vis))].sort();
  expect(Object.keys(VIS_PRESET_MAX).sort()).toEqual(kinds);
  for (const k of kinds) expect(VIS_PRESET_MAX[k]).toBe(presetMax(k));
});

it("lists the families in WMP's order: by registry key, so Particle (\"Dotplane\") comes after Battery", () => {
  const byKey = new Map(PRESETS.map((p) => [p.vis, p.key]));
  expect(Object.fromEntries(byKey)).toMatchObject({ alchemy: 'Alchemy', bars: 'Bars', battery: 'Battery', particle: 'Dotplane', spikes: 'Spikes' });
  const keys = [...new Set(PRESETS.map((p) => p.key))];
  expect(keys).toEqual([...keys].sort((a, b) => (a.toUpperCase() < b.toUpperCase() ? -1 : 1)));
  // each family in one run, its presets in their own order
  expect(PRESETS.map((p) => p.key + p.preset)).toEqual(keys.flatMap((k) => PRESETS.filter((p) => p.key === k).map((_, i) => k + i)));
  const known = ['Alchemy', 'Bars and Waves', 'Battery', 'Particle', 'Spikes'];
  expect([...new Set(PRESETS.map((p) => p.group as string))].filter((g) => known.includes(g))).toEqual(known);
});

it('keeps a saved new visualizer and clamps its preset', () => {
  expect(normalize({ vis: 'spikes', preset: 9 })).toMatchObject({ vis: 'spikes', preset: 1 });
  expect(normalize({ vis: 'nonesuch', preset: 2 })).toMatchObject({ vis: 'alchemy', preset: 0 });
});

it("gives Spikes the player's colour unless one is given", async () => {
  const { createEngine, SPIKES_COLOR } = await import('../../src/engine');
  const canvas = { width: 16, height: 16, getContext: () => null } as unknown as HTMLCanvasElement;
  expect(createEngine('spikes', canvas).options.foregroundColor).toBe(SPIKES_COLOR);
  expect(createEngine('spikes', canvas, { options: { foregroundColor: null } }).options.foregroundColor).toBe(null);
});

it("lets the shell set every family's options live, whatever the port keeps", async () => {
  const { createEngine, PRESETS } = await import('../../src/engine');
  const canvas = { width: 16, height: 16, getContext: () => null } as unknown as HTMLCanvasElement;
  for (const k of new Set(PRESETS.map((p) => p.vis))) {
    const eng = createEngine(k, canvas);
    expect(() => { eng.options.alpha = 'luma'; eng.options.tint = [255, 0, 0]; eng.options.backgroundColor = 0x102030; }, k).not.toThrow();
    expect(eng.options.alpha, k).toBe('luma');
  }
});

it('draws a fixed-size family at its own size at every scale (else present() drew nothing)', async () => {
  const { createEngine } = await import('../../src/engine');
  const canvas = { width: 16, height: 16, clientWidth: 900, clientHeight: 600, getContext: () => null } as unknown as HTMLCanvasElement;
  for (const scale of ['original', 'auto', 1, 0.5] as const) {
    const eng = createEngine('plenoptic', canvas, { scale });
    eng.resize();
    expect([eng.width, eng.height], String(scale)).toEqual([256, 192]);
  }
});
