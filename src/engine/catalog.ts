// The visualizations by family and WMP version, for a menu that pages through them: PRESETS (WMP's own
// flat order, which its menu and next/previous walk keep) regrouped, each family's current presets (its
// newest version's: the names without a version) first, then one group per older version its names give,
// newest first ("Particle (WMP 7-8)" is Particle in WMP 7–8's group). Derived from the names alone.
import { PRESETS, type PresetEntry, type VisKind } from './index';

/** the first and last WMP a version label covers ("WMP 7-9": [7, 9]; "WMP 11": [11, 11]) */
export type Versions = readonly [number, number];
/** one preset: its name without the version, and its number in its family (PresetEntry.preset) */
export interface CatalogItem { name: string; preset: number }
export interface VersionGroup { label: string; versions: Versions; items: CatalogItem[] }
export interface CatalogFamily {
  group: PresetEntry['group'];
  vis: VisKind;
  /** the family's registry key (PresetEntry.key) */
  key: string;
  current: VersionGroup;
  older: VersionGroup[];
}

/** The WMP whose presets each family's unversioned names are: the newest that ships it (README's Fidelity):
 *  WMP 12's Alchemy, Bars and Waves and Battery; WMP 10's Spikes, Particle, Plenoptic and Ambience; Musical
 *  Colors only ever in WMP 7 and 8; 3D Alchemy is WMP 9's (the Creativity Fun Pack for WMP 9 Series);
 *  Picture Viz, a Bonus Pack's, WMP 8 (Windows XP's);
 *  Picture Viz II, the Winter Fun Pack 2002's and the gallery's, WMP 9. */
const CURRENT: Record<VisKind, Versions> = {
  alchemy: [12, 12], bars: [12, 12], battery: [12, 12],
  spikes: [10, 10], particle: [10, 10], plenoptic: [10, 10], ambience: [10, 10],
  musical: [7, 8],
  blazing: [7, 8], colorcubes: [7, 8], pulsing: [7, 8], trilogy1: [7, 8], trilogy2: [7, 8], trilogy3: [7, 8],
  alchemy3d: [9, 9],
  pictureviz: [8, 8], pictureviz2: [9, 9],
};

/** A preset's name as its name and the versions its suffix gives ("Swirl (WMP 7-9)": Swirl, [7, 9]); none: null. */
export function parseName(name: string): { name: string; versions: Versions | null } {
  const m = /^(.*) \(WMP (\d+)(?:-(\d+))?\)$/.exec(name);
  return m ? { name: m[1], versions: [Number(m[2]), Number(m[3] ?? m[2])] } : { name, versions: null };
}
/** "WMP 12", "WMP 7–8" (an en dash, as a range is written) */
export const versionLabel = ([a, b]: Versions): string => 'WMP ' + (a === b ? a : a + '–' + b);

/** The catalog of a PRESETS-shaped list, its families in the list's order. */
export function catalogOf(presets: readonly Pick<PresetEntry, 'vis' | 'preset' | 'group' | 'name' | 'key'>[]): CatalogFamily[] {
  const fams = new Map<string, CatalogFamily>();
  for (const p of presets) {
    let f = fams.get(p.group);
    if (!f) {
      const v = CURRENT[p.vis];
      fams.set(p.group, f = { group: p.group, vis: p.vis, key: p.key, current: { label: versionLabel(v), versions: v, items: [] }, older: [] });
    }
    const { name, versions } = parseName(p.name), label = versions ? versionLabel(versions) : f.current.label;
    let g = label === f.current.label ? f.current : f.older.find((x) => x.label === label);
    if (!g) f.older.push(g = { label, versions: versions!, items: [] });
    g.items.push({ name, preset: p.preset });
  }
  // newest first: by the last version, then the first ("WMP 10" before "WMP 7–10" before "WMP 9")
  for (const f of fams.values()) f.older.sort((a, b) => b.versions[1] - a.versions[1] || b.versions[0] - a.versions[0]);
  return [...fams.values()];
}

export const CATALOG: readonly CatalogFamily[] = catalogOf(PRESETS);

/** The WMP versions a preset draws: its own version group's. */
export function versionsOf(kind: VisKind, preset: number): Versions {
  const f = CATALOG.find((x) => x.vis === kind);
  const g = f && [f.current, ...f.older].find((x) => x.items.some((i) => i.preset === preset));
  return g?.versions ?? CURRENT[kind];
}
