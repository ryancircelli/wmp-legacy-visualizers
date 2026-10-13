// Now Playing's menus (the song's: ♪ and hold centre; the page's: ⋯) and their pages (Visualizer…, Play
// On…, Add to Playlist…, Playlist…): the nano's own list pages (MenuScreen: left-aligned rows at the list's
// size, the blue selection, values in the accent blue, the chevron) under a title in the light status bar's
// look, in a panel over the top of the screen as tall as the page's rows, six at most ("no need to stretch for
// the white space", the owner, 2026-10-12), the picture live under it. A page opens on its first row that
// can be chosen.
// A row that opens a page pushes it, opened on the row holding the choice (a page `fromTop`, a list of
// ticks rather than one choice, on its first row); whether any other row closes the
// panel is that row's own. MENU (a swipe right) goes back a page, from the first closes; a tap on the
// picture closes. No Cancel row: the nano's list pages have none, MENU is their way out.
import { useState, type CSSProperties } from 'react';
import { MenuScreen, useWheel } from '../../ui';
import type { MenuItem } from '../contract';
import css from './nowplaying.module.css';

export type Page = { title: string; items: MenuItem[]; fromTop?: boolean };

/** `page(key, open)`: a page's title and rows; a row's `open(key)` pushes that page */
export function ListPanel<K>({ first, page, onClose }: { first: K; page: (k: K, open: (k: K) => void) => Page; onClose: () => void }) {
  const usable = (items: MenuItem[]) => Math.max(0, items.findIndex((x) => !x.disabled && !x.header));
  const [stack, setStack] = useState(() => [{ key: first, sel: usable(page(first, () => {}).items) }]);
  const top = stack[stack.length - 1]!;
  const open = (k: K) => {
    const pg = page(k, open), i = pg.fromTop ? -1 : pg.items.findIndex((x) => x.right != null && !x.header);
    setStack((s) => [...s, { key: k, sel: i >= 0 ? i : usable(pg.items) }]);
  };
  const back = () => { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onClose(); };
  const { title, items } = page(top.key, open);
  useWheel({ onMenu: () => { back(); return true; }, onHoldCenter: () => {} });
  return (
    <div className={css.pages} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={css.panel} style={{ '--rows': Math.min(items.length, 6) } as CSSProperties}>
        <div className={css.pagetitle}>{title}</div>
        {/* a page of its own each: the list's scroll starts over */}
        <MenuScreen key={stack.length + title} items={items} selected={top.sel}
                    onSelectedChange={(i) => setStack((s) => [...s.slice(0, -1), { key: top.key, sel: i }])} />
      </div>
    </div>
  );
}
