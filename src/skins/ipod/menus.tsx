// The Main menu: the nano 5G's look (docs/ipod-skin.md §2.3) with Spotify's options. Every other
// screen is a group's (screens/*), reached through the factories contract.ts names; Extras is the
// settings group's. Settings > Main Menu hides rows by id: the label in lower case without spaces
// ('Now Playing' is 'nowplaying'); 'previewpanel' off drops the main menu's preview panel, which
// otherwise shows while there are covers to show.
import { artOk, useApp } from '../../ui';
import * as groups from './screens';
import type { MenuItem, Nav, ScreenEntry, Screens } from './screens/contract';
import { MenuScreen, useNav } from './ui';
import s from './ipod.module.css';

const screens: Screens = groups;

const id = (label: string) => label.toLowerCase().replace(/\s+/g, '');
/** a row that pushes a screen */
const to = (nav: Nav, label: string, f: keyof Screens): MenuItem => ({ id: id(label), label, chevron: true, onSelect: () => nav.push(screens[f]()) });
const visible = (items: MenuItem[], shown: Record<string, boolean>) => items.filter((it) => shown[it.id] !== false);

export const mainMenu = (): ScreenEntry => ({ key: 'main', title: 'iPod', render: () => <MainMenu /> });

/** Now Playing is listed only while there is a track, as on the nano. */
function MainMenu() {
  const nav = useNav(), shown = groups.useMenuVisibility().main, track = useApp((x) => !!x.playback.track);
  // the preview panel's covers: the playing one, then the queue's next ones (distinct, up to three)
  const arts = useApp((x) => {
    const t = x.playback.track;
    return t ? [...new Set([t, ...x.queue.next].map((n) => artOk(n.art || n.image)).filter(Boolean))].slice(0, 3).join('\n') : '';
  });
  const items: MenuItem[] = [
    to(nav, 'Home', 'home'), to(nav, 'Search', 'search'), to(nav, 'Library', 'library'), to(nav, 'Radio', 'fmRadio'),
    ...(track ? [{ id: 'nowplaying', label: 'Now Playing', chevron: true, onSelect: () => nav.toNowPlaying() }] : []),
    to(nav, 'Settings', 'settings'), to(nav, 'Extras', 'extras'),
  ];
  const preview = arts && shown.previewpanel !== false ? arts.split('\n').map((a) => <img key={a} className={s.tile} src={a} alt="" />) : undefined;
  return <MenuScreen items={visible(items, shown)} preview={preview} />;
}
