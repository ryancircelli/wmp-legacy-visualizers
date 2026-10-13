// Now Playing's Visualizer… (its ⋯ menu's row): pages of the ⋯ menu's ListPanel, the picture live under it:
// a pick or an Opacity step shows at once and the page stays open, so they can be stepped through and
// watched. Pages (the shell's catalog): Visualizer (the toggle, Opacity, the families, each naming the choice
// it holds) > a family (its current version's presets, then a row per older WMP version) > that version's
// presets.
import { useShell } from '../../../../ui';
import type { MenuItem } from '../contract';
import { useVisualizers } from '../settings';
import type { Page } from './ListPanel';

/** a page: the Visualizer page (neither), a family's (`group`), or one of its older versions' (`version` too) */
export type VisPage = { group?: string; version?: string };

/** the Visualizer pages: `(page, open)` its title and rows, a row's `open` pushing the next */
export function useVisPages() {
  const cat = useShell().catalog, vz = useVisualizers();
  // where the choice is: its family, its version group, its row
  const [vis, n] = vz.preset.split(':'), f0 = cat.find((f) => f.vis === vis);
  const g0 = f0 && [f0.current, ...f0.older].find((g) => g.items.some((i) => String(i.preset) === n));
  const it0 = g0?.items.find((i) => String(i.preset) === n);
  /** a family's preset: checked when it is the choice */
  const pick = (vis: string) => (i: { name: string; preset: number }): MenuItem =>
    ({ id: String(i.preset), label: i.name, right: i === it0 ? '✓' : undefined, onSelect: () => vz.pick(vis + ':' + i.preset) });

  return (page: VisPage, open: (p: VisPage) => void): Page => {
    const fam = cat.find((f) => f.group === page.group), ver = fam?.older.find((g) => g.label === page.version);
    if (fam && ver) return { title: fam.group + ' · ' + ver.label, items: ver.items.map(pick(fam.vis)) };
    if (fam) return { title: fam.group, items: [
      { id: 'h:current', label: fam.current.label, header: true },
      ...fam.current.items.map(pick(fam.vis)),
      ...(fam.older.length ? [{ id: 'h:older', label: 'Older Versions', header: true }] : []),
      ...fam.older.map((g) => ({ id: g.label, label: g.label, right: g === g0 ? it0?.name : undefined, chevron: true,
                                 onSelect: () => open({ group: fam.group, version: g.label }) })),
    ] };
    return { title: 'Visualizer', items: [
      { id: 'on', label: 'Visualizer', right: vz.on ? 'On' : 'Off', onSelect: vz.toggle },
      { id: 'opacity', label: 'Opacity', right: vz.opacity + '%', disabled: !vz.on, onSelect: vz.step },
      ...cat.map((f) => ({ id: f.group, label: f.group, chevron: true,
                           // the choice's name, and its version when an older one's
                           right: f === f0 && it0 ? it0.name + (g0 === f.current ? '' : ' · ' + g0!.label) : undefined,
                           onSelect: () => open({ group: f.group }) })),
    ] };
  };
}
