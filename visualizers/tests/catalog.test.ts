// The visualizations by family and WMP version (src/catalog.ts), derived from PRESETS' names.
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/index';
import { CATALOG, parseName, versionLabel } from '../src/catalog';

describe('the catalog', () => {
  it('holds every preset exactly once, under its own family', () => {
    const seen = CATALOG.flatMap((f) => [f.current, ...f.older].flatMap((g) => g.items.map((i) => f.vis + ':' + i.preset)));
    expect(seen.sort()).toEqual(PRESETS.map((p) => p.vis + ':' + p.preset).sort());
    expect(new Set(seen).size).toBe(PRESETS.length);
    for (const f of CATALOG) {
      for (const g of [f.current, ...f.older]) for (const i of g.items) {
        const p = PRESETS.find((x) => x.vis === f.vis && x.preset === i.preset)!;
        expect([p.group, p.key, parseName(p.name).name]).toEqual([f.group, f.key, i.name]);
      }
    }
  });

  it('the families in WMP\'s order, each its current version\'s count, then its older versions\' newest first', () => {
    const shape = CATALOG.map((f) => [f.group, f.current.label + ' ' + f.current.items.length, ...f.older.map((g) => g.label + ' ' + g.items.length)].join(', '));
    expect(shape).toEqual([
      '3D Alchemy, WMP 9 6',
      'Alchemy, WMP 12 1, WMP 11 1, WMP 10 1, WMP 9 1',
      'Ambience, WMP 10 14, WMP 9 1, WMP 7–9 6, WMP 8 1, WMP 7–8 1, WMP 7 1',
      'Bars and Waves, WMP 12 4, WMP 10 2, WMP 7–10 2, WMP 9 2, WMP 7–8 2',
      'Battery, WMP 12 26, WMP 11 22, WMP 9–11 4, WMP 10 9, WMP 9–10 5, WMP 8–10 8, WMP 9 6, WMP 8–9 3, WMP 8 15',
      'Blazing Colors, WMP 7–8 3',
      'Color Cubes, WMP 7–8 3',
      'Particle, WMP 10 2, WMP 7–8 2',
      'Dungeon Siege, WMP 8 2',
      'Eclectic Colors, WMP 7–8 3',
      'Picture Viz, WMP 8 7',
      'Picture Viz II, WMP 9 62',
      'Plenoptic, WMP 10 7, WMP 8 2, WMP 7 7',
      'Pulsing Colors, WMP 7–8 3',
      'SnowTime, WMP 7–8 1',
      'Spikes, WMP 10 2',
      'StarTime, WMP 7–8 3',
      'Trilogy I, WMP 7–8 4',
      'Trilogy II, WMP 7–8 4',
      'Trilogy III, WMP 7–8 4',
      'Goom, WMP 9 4',
      'Musical Colors, WMP 7–8 20, WMP 7 1',
      'Yule Log, WMP 8–10 1',
    ]);
  });

  it('labels: a suffix parses to its name and versions; a range takes an en dash', () => {
    expect(parseName('Swirl (WMP 7-9)')).toEqual({ name: 'Swirl', versions: [7, 9] });
    expect(parseName('Random (WMP 11)')).toEqual({ name: 'Random', versions: [11, 11] });
    expect(parseName('X Marks the Spot')).toEqual({ name: 'X Marks the Spot', versions: null });
    expect([versionLabel([7, 8]), versionLabel([12, 12])]).toEqual(['WMP 7–8', 'WMP 12']);
    expect(CATALOG.find((f) => f.vis === 'battery')!.older.find((g) => g.label === 'WMP 8')!.items[1]).toEqual({ name: 'brightsphere', preset: 27 });
  });
});
