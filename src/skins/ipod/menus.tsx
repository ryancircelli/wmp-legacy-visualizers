// The nano's Main and Music menus. Every other screen is a group's (screens/*), reached through the
// factories contract.ts names. Settings > Main Menu / Music Menu hide items by id: the label in lower
// case without spaces ('Cover Flow' is 'coverflow').
import { artOk, isPlaying, useApp, useShell } from '../../ui';
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
    to(nav, 'FM Radio', 'fmRadio'), to(nav, 'Voice Memos', 'voiceMemos'), to(nav, 'Extras', 'extras'), to(nav, 'Settings', 'settings'),
    { id: 'shufflesongs', label: 'Shuffle Songs', onSelect: () => { groups.shuffleSongs(nav, store); nav.toNowPlaying(); } },
    ...(track ? [{ id: 'nowplaying', label: 'Now Playing', chevron: true, onSelect: () => nav.toNowPlaying() }] : []),
  ];
  return <MenuScreen items={visible(items, shown)} preview={<Preview />} />;
}

function MusicMenu() {
  const nav = useNav(), shown = groups.useMenuVisibility().music;
  const items = ([['Cover Flow', 'coverFlow'], ['Playlists', 'playlists'], ['Artists', 'artists'], ['Albums', 'albums'], ['Songs', 'songs'],
                  ['Genres', 'genres'], ['Composers', 'composers'], ['Audiobooks', 'audiobooks'], ['Search', 'search']] as const)
    .map(([label, f]) => to(nav, label, f));
  return <MenuScreen items={visible(items, shown)} />;
}

/** The split menu's pane: the playing track's cover, else the clock. */
function Preview() {
  const art = useApp((x) => (isPlaying(x) ? artOk(x.playback.track?.art || x.playback.track?.image) : ''));
  const time = useTime(groups.useClockPrefs().twentyFourHour);
  return art ? <img className="block w-full h-full object-cover" src={art} alt="" /> : <div className={s.clock}>{time}</div>;
}
