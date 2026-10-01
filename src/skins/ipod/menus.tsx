// The nano 5G's Main and Music menus (docs/ipod-skin.md §2.3). Every other screen is a group's
// (screens/*), reached through the factories contract.ts names; Extras is the settings group's.
// Settings > Main Menu / Music Menu hide rows by id: the label in lower case without spaces ('Cover
// Flow' is 'coverflow'); 'previewpanel' off drops the main menu's preview panel. Not listed: Video
// Camera (no camera; §4.2 hides it) and Compilations (opt-in on the real one, no data here).
import { artOk, useApp, useShell } from '../../ui';
import * as groups from './screens';
import type { MenuItem, Nav, ScreenEntry, Screens } from './screens/contract';
import { MenuScreen, useNav, useTime } from './ui';
import s from './ipod.module.css';

const screens: Screens = groups;
type Factory = Exclude<keyof Screens, 'shuffleSongs'>;

const id = (label: string) => label.toLowerCase().replace(/\s+/g, '');
/** a row that pushes a screen */
const to = (nav: Nav, label: string, f: Factory | (() => ScreenEntry)): MenuItem =>
  ({ id: id(label), label, chevron: true, onSelect: () => nav.push(typeof f === 'string' ? screens[f]() : f()) });
const visible = (items: MenuItem[], shown: Record<string, boolean>) => items.filter((it) => shown[it.id] !== false);

export const mainMenu = (): ScreenEntry => ({ key: 'main', title: 'iPod', render: () => <MainMenu /> });
const musicMenu = (): ScreenEntry => ({ key: 'music', title: 'Music', render: () => <MusicMenu /> });

/** Now Playing is listed only while there is a track, as on the nano. */
function MainMenu() {
  const nav = useNav(), store = useShell().store, shown = groups.useMenuVisibility().main, track = useApp((x) => !!x.playback.track);
  const items: MenuItem[] = [
    to(nav, 'Music', musicMenu), to(nav, 'Videos', 'videos'), to(nav, 'Photos', 'photos'), to(nav, 'Podcasts', 'podcasts'),
    to(nav, 'Radio', 'fmRadio'), to(nav, 'Extras', 'extras'), to(nav, 'Settings', 'settings'),
    { id: 'shufflesongs', label: 'Shuffle Songs', onSelect: () => { groups.shuffleSongs(nav, store); nav.toNowPlaying(); } },
    ...(track ? [{ id: 'nowplaying', label: 'Now Playing', chevron: true, onSelect: () => nav.toNowPlaying() }] : []),
  ];
  return <MenuScreen items={visible(items, shown)} preview={shown.previewpanel === false ? undefined : <Preview />} />;
}

/** The nano's Music menu, with the classic's Cover Flow first (the owner's choice). On-The-Go is
 *  Playlists' first row, not here. */
function MusicMenu() {
  const nav = useNav(), shown = groups.useMenuVisibility().music;
  const items = ([['Cover Flow', 'coverFlow'], ['Genius Mixes', 'geniusMixes'], ['Playlists', 'playlists'], ['Artists', 'artists'],
                  ['Albums', 'albums'], ['Songs', 'songs'], ['Genres', 'genres'], ['Composers', 'composers'], ['Audiobooks', 'audiobooks'],
                  ['Search', 'search']] as const)
    .map(([label, f]) => to(nav, label, f));
  return <MenuScreen items={visible(items, shown)} />;
}

/** The preview panel's three 80×80 tiles: the playing cover then the queue's next ones, else a clock. */
function Preview() {
  const arts = useApp((x) => {
    const t = x.playback.track;
    return t ? [...new Set([t, ...x.queue.next].map((n) => artOk(n.art || n.image)).filter(Boolean))].slice(0, 3).join('\n') : '';
  });
  const time = useTime(groups.useClockPrefs().twentyFourHour);
  if (arts) return <>{arts.split('\n').map((a) => <img key={a} className={s.tile} src={a} alt="" />)}</>;
  return <div className={s.clock}>{time}<small>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</small></div>;
}
