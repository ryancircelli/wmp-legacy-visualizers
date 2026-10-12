// The home group: the main menu's Home and Radio over Spotify (docs/ipod-skin.md §2.4, §4.2). Home
// is Spotify Home's shelves of tiles down one page, each with See all (its items as a screen: a grid
// of covers in Settings > General > Library View: Grid); Radio is Spotify's stations on the FM dial.
// Hold-center on a thing that can be saved opens Like / Add to Playlist / Start Radio.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HomeItem, HomeSection, Station } from '../../../../model';
import {
  canSave, isCollectionUri, toggleSaved, useAddTo, useApp, useArtist, useHome, usePosition, useRadio, useRadioSeeds, useShell, type Shell,
} from '../../../../ui';
import { Bar, GridScreen, MenuScreen, Popup, ShelvesScreen, useNav, useWheel } from '../../ui';
import type { GridItem, MenuItem, Nav, ScreenEntry } from '../contract';
import { subline } from '../lists/logic';
import { collection } from '../lists/screens';
import { useLibraryView } from '../settings';
import { step } from './step';

/** nano pixels */
const u = (n: number) => `calc(var(--unit) * ${n})`;

/** State held by the screen entry, not its component: the chrome may unmount a covered screen, and
 *  the Radio menu reads the dial's. */
function kept<T>(v: T) {
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (n: T) => { v = n; subs.forEach((f) => f()); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}
type Kept<T = number> = ReturnType<typeof kept<T>>;
const useKept = <T,>(k: Kept<T>) => [useSyncExternalStore(k.sub, k.get), k.set] as const;

/** Start Radio: the station Spotify makes from this uri (its "inspired by" mix), played, then Now Playing. */
async function startRadio(sh: Shell, nav: Nav, uri: string, name: string): Promise<void> {
  const want = name + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: uri, name: want, sub: '' }]).catch(() => [])).find((s) => s.name === want);
  if (st) { sh.store.getState().commands.playContext(st.uri, null); nav.toNowPlaying(); }
}

/** What hold-center was pressed on; `lists`: Add to Playlist's list is showing. */
type Held = { uri: string; name: string; lists?: boolean };

/** Hold-center on a track, album, playlist or artist: Like (save), Add to Playlist (tracks), Start
 *  Radio, Cancel. Returns the popup (null while closed) and its opener. The chrome's Popup closes
 *  before it runs a choice, so Add to Playlist reopens it as the playlists in the same batch. */
function useHold() {
  const [held, set] = useState<Held | null>(null);
  return [held && <Hold {...held} set={set} />, (h: Held) => set(h)] as const;
}

function Hold({ set, ...h }: Held & { set: (h: Held | null) => void }) {
  const sh = useShell(), nav = useNav(), a = useAddTo(h.uri), pl = a.playlistMenu(), track = h.uri.startsWith('spotify:track:');
  const items: MenuItem[] = h.lists
    ? (pl.sub ?? []).flatMap((e, k): MenuItem[] => e.sep ? [] : [{
        id: String(k), label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled || !e.act, onSelect: e.act }])
    : [
        { id: 'like', label: track ? (a.saved ? 'Unlike' : 'Like') : a.saved ? 'Remove from Library' : 'Save to Library',
          onSelect: () => void toggleSaved(sh, h.uri) },
        ...(track ? [{ id: 'pl', label: 'Add to Playlist', chevron: true, onSelect: () => { pl.onOpen?.(); set({ ...h, lists: true }); } }] : []),
        { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, h.uri, h.name) },
        { id: 'cancel', label: 'Cancel' },
      ];
  // a fresh Popup for the playlists (its list starts at the top); Hold itself stays, with the playlists it asked for
  return <Popup key={String(!!h.lists)} items={items} onClose={() => set(null)} />;
}

// ---- Home: Spotify Home's shelves of tiles, each with See all -----------------------------------

export function home(): ScreenEntry {
  return { key: 'home', title: 'Home', render: () => <Shelves /> };
}

function Shelves() {
  const { sections } = useHome(), sh = useShell(), nav = useNav(), [hold, openHold] = useHold();
  const shelves = (sections ?? []).map((sec, k) => ({
    id: String(k), title: sec.title, items: tiles(sec.items, sh, nav, openHold), onMore: () => nav.push(shelf(sec, k)) }));
  return (
    <>
      <ShelvesScreen shelves={shelves} loading={!sections} empty="Nothing on Home" />
      {hold}
    </>
  );
}

/** See all: a shelf's items as a screen */
function shelf(sec: HomeSection, k: number): ScreenEntry {
  const at = kept(0);
  return { key: 'home/' + k, title: sec.title, render: () => <Shelf items={sec.items} at={at} /> };
}

/** a playlist, album, Liked Songs or artist opens to its songs; anything else plays */
const opens = (uri: string) => uri.startsWith('spotify:artist:') || isCollectionUri(uri);

/** a shelf's items as covers with what each is ("Album · Queen", "Playlist · <Spotify's line>"):
 *  the centre opens one (a collection: the Library's page, under Spotify's header; an artist: their
 *  songs) or plays it, hold-centre its Like / Add to Playlist / Start Radio */
function tiles(items: HomeItem[], sh: Shell, nav: Nav, openHold: (h: Held) => void): GridItem[] {
  return items.map((it, k) => ({
    id: String(k), label: it.name, chevron: opens(it.uri), art: it.img, sub: subline(it.uri, it.sub),
    onSelect: () => {
      if (isCollectionUri(it.uri)) nav.push(collection(it.uri, it.name));
      else if (opens(it.uri)) nav.push(songs(it.uri, it.name));
      else { sh.store.getState().commands.playItem(it); nav.toNowPlaying(); }
    },
    onHold: canSave(it.uri) ? () => openHold({ uri: it.uri, name: it.name }) : undefined,
  }));
}

/** a shelf's items: rows, or covers */
function Shelf({ items, at }: { items: HomeItem[]; at: Kept }) {
  const sh = useShell(), nav = useNav(), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const Screen = useLibraryView()[0] === 'grid' ? GridScreen : MenuScreen;
  return (
    <>
      <Screen items={tiles(items, sh, nav, openHold)} selected={i} onSelectedChange={setI} empty="Nothing here" />
      {hold}
    </>
  );
}

function songs(uri: string, name: string): ScreenEntry {
  const at = kept(0);
  return { key: 'home:' + uri, title: name, render: () => <Songs uri={uri} at={at} /> };
}

/** an artist's top songs */
function Songs({ uri, at }: { uri: string; at: Kept }) {
  const sh = useShell(), nav = useNav(), artist = useArtist(uri), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const rows = artist.page?.tracks ?? [];
  const items = rows.map((t, k): MenuItem => ({
    id: String(k), label: t.title, chevron: false,
    onSelect: () => { sh.store.getState().commands.playContext(t.ctx ?? uri, t.uri); nav.toNowPlaying(); },
    onHold: canSave(t.uri) ? () => openHold({ uri: t.uri, name: t.title }) : undefined,
  }));
  return (
    <>
      <MenuScreen items={items} selected={i} onSelectedChange={setI} loading={artist.loading} empty="No Songs" />
      {hold}
    </>
  );
}

// ---- Radio: Spotify's stations on the FM dial (§2.4 Radio, §4.2) -----------------------------------

/** 'ipod.radio': the Radio menu's Favorites and Recent Songs (the stations played), this device's own */
interface RadioLog { fav: Station[]; recent: Station[] }
function loadRadio(): RadioLog {
  try {
    const v = JSON.parse(localStorage.getItem('ipod.radio') ?? 'null') as Partial<RadioLog> | null;
    return { fav: Array.isArray(v?.fav) ? v.fav : [], recent: Array.isArray(v?.recent) ? v.recent : [] };
  } catch { return { fav: [], recent: [] }; }
}
const radioLog = kept(loadRadio());
radioLog.sub(() => { try { localStorage.setItem('ipod.radio', JSON.stringify(radioLog.get())); } catch { /* blocked: this session only */ } });
const bare = (x: Station): Station => ({ uri: x.uri, name: x.name, sub: x.sub });
const without = (l: Station[], x: Station) => l.filter((y) => y.uri !== x.uri);

/** Tune in: play the station, and log it under Recent Songs. */
function tuneIn(sh: Shell, x: Station) {
  sh.store.getState().commands.playItem({ uri: x.uri });
  const v = radioLog.get();
  radioLog.set({ ...v, recent: [bare(x), ...without(v.recent, x)].slice(0, 20) });
}

/** The dial's state, kept across the Radio menu and back: the station it is on, and the stations
 *  as they were at the first turn (new seeds would move them under the needle). */
interface Tuner { at: Kept; list: Kept<Station[] | null> }

export const fmRadio = (): ScreenEntry => dial({ at: kept(0), list: kept<Station[] | null>(null) });
const dial = (r: Tuner): ScreenEntry => ({ key: 'fmRadio', title: 'Radio', render: () => <Dial r={r} /> });

/** the dial's range, MHz (§4.2); the stations spread evenly over it (the owner, 2026-10-02: "evenly
 *  disperse across the standard range, right now it goes between 87 and 89"), to the nearest 0.1 */
const MHZ0 = 87.5, STEP = 0.2, MHZ1 = 108;
export const mhz = (i: number, n: number): number => Math.round((MHZ0 + (n > 1 ? ((MHZ1 - MHZ0) * i) / (n - 1) : 0)) * 10) / 10;
/** nano pixels per MHz: the numbers every 2 MHz sit 60 apart, four of them on screen */
const PX = 30;

/** The FM screen: the station's name as RDS, the playing title and artist, the frequency big, the
 *  dial at the bottom. Turning tunes and plays once the wheel rests 600 ms; ⏮⏭ seek a station;
 *  center switches the dial with the song's progress bar; hold-center: Favorites and Recent Songs (the
 *  nano's Radio menu is gone: MENU goes back; the owner, 2026-10-02: "why is this page needed"). */
function Dial({ r }: { r: Tuner }) {
  const sh = useShell(), nav = useNav(), live = useRadio(useRadioSeeds()).stations, [frozen] = useKept(r.list);
  const list = frozen ?? live ?? [], n = list.length, [sel, setI] = useKept(r.at), i = Math.min(sel, Math.max(0, n - 1)), st = list[i];
  const [log] = useKept(radioLog), [held, setHeld] = useState(false), [bar, setBar] = useState(false), timer = useRef(0);
  const now = useApp((s) => (st && s.playback.context?.uri === st.uri ? s.playback.track : null));
  useEffect(() => () => clearTimeout(timer.current), []);
  const tune = (d: number) => {
    const k = step(i, d, n, true);
    if (k === i) return false;
    r.list.set(list);
    setI(k);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => tuneIn(sh, list[k]!), 600);
  };
  const fav = !!st && log.fav.some((x) => x.uri === st.uri);
  useWheel(held ? {} : {
    onTick: tune, onPrev: () => tune(-1), onNext: () => tune(1),
    onCenter: () => setBar(!bar),
    onHoldCenter: st ? () => setHeld(true) : undefined,
    onPlay: st && !now ? () => tuneIn(sh, st) : undefined,
  });
  if (!st) return <MenuScreen items={[]} loading={!live} empty="No Stations" />;
  const f = mhz(i, n);
  return (
    <div className="relative h-full overflow-hidden text-white" style={{ background: 'linear-gradient(#0d1420, #1b2a44 45%, #0a0f18)' }}>
      <div className="absolute inset-x-0 text-center" style={{ top: u(8), padding: `0 ${u(10)}` }}>
        <div className="truncate font-bold" style={{ fontSize: u(14), color: '#9aa3b2' }}>{st.name}</div>
        <div className="truncate font-bold" style={{ fontSize: u(18), marginTop: u(4) }}>{now?.title ?? ' '}</div>
        <div className="truncate" style={{ fontSize: u(12), color: '#c3cad6' }}>{now?.artist ?? st.sub ?? ''}</div>
      </div>
      <div className="absolute inset-x-0 flex items-baseline justify-center" style={{ top: u(98), gap: u(6) }}>
        <span className="font-bold" style={{ display: 'inline-block', fontSize: u(60), lineHeight: 1, letterSpacing: u(-1), color: 'transparent',
                                             background: 'linear-gradient(#fff 48%, #b4bfcf 52%, #e9edf3)', WebkitBackgroundClip: 'text', backgroundClip: 'text',
                                             WebkitBoxReflect: 'below 0 linear-gradient(transparent 55%, rgb(255 255 255 / .25))' }}>
          {f.toFixed(1)}
        </span>
        <span className="font-bold" style={{ fontSize: u(14) }}>FM</span>
      </div>
      <div className="absolute inset-x-0" style={{ bottom: u(16), height: u(60) }}>
        {bar ? <Progress /> : <Scale f={f} dots={list.flatMap((x, k) => (log.fav.some((y) => y.uri === x.uri) ? [mhz(k, n)] : []))} />}
      </div>
      {held && <Popup onClose={() => setHeld(false)} items={[
        { id: 'fav', label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => {
          const v = radioLog.get();
          radioLog.set({ ...v, fav: fav ? without(v.fav, st) : [...v.fav, bare(st)] });
        } },
        { id: 'favs', label: 'Favorites', onSelect: () => nav.push(stations('fav', 'Favorites')) },
        { id: 'recent', label: 'Recent Songs', onSelect: () => nav.push(stations('recent', 'Recent Songs')) },
        { id: 'cancel', label: 'Cancel' },
      ]} />}
    </div>
  );
}

/** The scale under the fixed red needle, sliding as the dial tunes: a tick every 0.2 MHz, a long one
 *  every 1, the numbers every 2; orange dots on the favourites (their MHz). */
function Scale({ f, dots }: { f: number; dots: number[] }) {
  const x = (mhz: number) => u((mhz - MHZ0) * PX);
  return (
    <>
      <div className="absolute inset-y-0" style={{ left: '50%', width: x(MHZ1), transform: `translateX(calc(-1 * ${x(f)}))`, transition: 'transform .2s' }}>
        <div className="absolute inset-x-0" style={{ top: u(20), height: u(14), background:
          `repeating-linear-gradient(90deg, #8a97ab 0 ${u(1)}, transparent 0 ${u(PX * STEP)}) 0 100% / 100% 50% no-repeat,` +
          `repeating-linear-gradient(90deg, #fff 0 ${u(1.5)}, transparent 0 ${u(PX)}) ${u(PX / 2)} 0 / 100% 100% no-repeat` }} />
        {Array.from({ length: 11 }, (_, k) => 88 + 2 * k).map((m) => (
          <span key={m} className="absolute font-bold" style={{ left: x(m), top: 0, transform: 'translateX(-50%)', fontSize: u(14), lineHeight: u(16) }}>{m}</span>
        ))}
        {dots.map((k) => (
          <span key={k} className="absolute" style={{ left: x(k), top: u(40), width: u(5), height: u(5), marginLeft: u(-2.5), borderRadius: '50%', background: '#ff9500' }} />
        ))}
      </div>
      <div className="absolute" style={{ left: '50%', top: u(16), height: u(34), width: u(2), marginLeft: u(-1), background: '#e0201a' }} />
    </>
  );
}

/** the playing song's progress, where the nano shows Live Pause */
function Progress() {
  const v = usePosition((ms, s) => { const d = s.playback.track?.duration ?? 0; return d ? Math.round((ms / d) * 500) / 500 : 0; });
  return <div style={{ padding: `${u(24)} ${u(30)} 0` }}><Bar value={v} /></div>;
}

const stations = (which: keyof RadioLog, title: string): ScreenEntry =>
  ({ key: 'fmRadio/' + which, title, render: () => <Stations which={which} title={title} /> });

/** a Radio menu list: center or Play/Pause plays the station, then Now Playing */
function Stations({ which, title }: { which: keyof RadioLog; title: string }) {
  const sh = useShell(), nav = useNav(), [log] = useKept(radioLog);
  const items = log[which].map((x): MenuItem => ({ id: x.uri, label: x.name, onSelect: () => { tuneIn(sh, x); nav.toNowPlaying(); } }));
  return <MenuScreen items={items} empty={'No ' + title} />;
}
