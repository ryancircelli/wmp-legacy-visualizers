// Now Playing's Visualizer… (its ⋯ menu): the nano's own list pages (MenuScreen: left-aligned rows at the
// list's size, the blue selection, values in the accent blue, the chevron) under a title in the light status
// bar's look, in a panel over the top of the screen, the picture live under it: a pick or an Opacity step
// shows at once and the page stays open, so they can be stepped through and watched. Pages (the shell's
// catalog): Visualizer (the toggle, Opacity, the families, each naming the choice it holds) > a family (its
// current version's presets, then a row per older WMP version) > that version's presets. MENU (a swipe
// right) goes back a page, from the first closes; a tap on the picture closes.
import { useState } from 'react';
import { useShell } from '../../../../ui';
import { MenuScreen, useWheel } from '../../ui';
import type { MenuItem } from '../contract';
import { useVisualizers } from '../settings';
import css from './nowplaying.module.css';

/** a page: the Visualizer page (neither), a family's (`group`), or one of its older versions' (`version` too) */
type Page = { group?: string; version?: string };

export function VisMenu({ onClose }: { onClose: () => void }) {
  const cat = useShell().catalog, vz = useVisualizers();
  const [stack, setStack] = useState<{ page: Page; sel: number }[]>([{ page: {}, sel: 0 }]);
  const { page, sel } = stack[stack.length - 1]!;
  // where the choice is: its family, its version group, its row
  const [vis, n] = vz.preset.split(':'), f0 = cat.find((f) => f.vis === vis);
  const g0 = f0 && [f0.current, ...f0.older].find((g) => g.items.some((i) => String(i.preset) === n));
  const it0 = g0?.items.find((i) => String(i.preset) === n);

  const fam = cat.find((f) => f.group === page.group), ver = fam?.older.find((g) => g.label === page.version);
  /** a page opened on the row holding the choice, else its first */
  const open = (p: Page, items: MenuItem[]) => {
    const i = items.findIndex((x) => x.right != null && !x.header);
    setStack((s) => [...s, { page: p, sel: Math.max(0, i) }]);
  };
  const back = () => { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onClose(); };
  /** a family's preset: checked when it is the choice */
  const pick = (vis: string) => (i: { name: string; preset: number }): MenuItem =>
    ({ id: String(i.preset), label: i.name, right: i === it0 ? '✓' : undefined, onSelect: () => vz.pick(vis + ':' + i.preset) });
  const familyItems = (f: NonNullable<typeof fam>): MenuItem[] => [
    { id: 'h:current', label: f.current.label, header: true },
    ...f.current.items.map(pick(f.vis)),
    ...(f.older.length ? [{ id: 'h:older', label: 'Older Versions', header: true }] : []),
    ...f.older.map((g) => ({ id: g.label, label: g.label, right: g === g0 ? it0?.name : undefined, chevron: true,
                             onSelect: () => open({ group: f.group, version: g.label }, g.items.map(pick(f.vis))) })),
  ];

  const title = ver ? fam!.group + ' · ' + ver.label : fam ? fam.group : 'Visualizer';
  const items: MenuItem[] = ver ? ver.items.map(pick(fam!.vis)) : fam ? familyItems(fam) : [
    { id: 'on', label: 'Visualizer', right: vz.on ? 'On' : 'Off', onSelect: vz.toggle },
    { id: 'opacity', label: 'Opacity', right: vz.opacity + '%', disabled: !vz.on, onSelect: vz.step },
    ...cat.map((f) => ({ id: f.group, label: f.group, chevron: true,
                         // the choice's name, and its version when an older one's
                         right: f === f0 && it0 ? it0.name + (g0 === f.current ? '' : ' · ' + g0!.label) : undefined,
                         onSelect: () => open({ group: f.group }, familyItems(f)) })),
  ];
  useWheel({ onMenu: () => { back(); return true; }, onHoldCenter: () => {} });
  return (
    <div className={css.vismenu} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={css.panel}>
        <div className={css.vistitle}>{title}</div>
        {/* a page of its own each: the list's scroll starts over */}
        <MenuScreen key={stack.length + title} items={items} selected={sel}
                    onSelectedChange={(i) => setStack((s) => [...s.slice(0, -1), { page, sel: i }])} />
      </div>
    </div>
  );
}
