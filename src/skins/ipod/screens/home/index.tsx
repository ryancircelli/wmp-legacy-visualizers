// The home group: the nano's Genius Mixes, Videos, Photos, Radio and Voice Memos slots over Spotify
// (docs/ipod-skin.md §2.4, §4.2). Genius Mixes are Spotify Home's playlists and albums, one mix a
// page; Videos (hidden by default) lists Home's shelves; Photos is the library's cover art; Radio is
// Spotify's stations on the FM dial; Voice Memos is the iPod's empty page. Hold-center on a thing
// that can be saved opens Like / Add to Playlist / Start Radio.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LIKED, type HomeItem, type HomeSection, type LibraryItem, type Station } from '../../../../model';
import {
  canSave, isCollectionUri, toggleSaved, useAddTo, useApp, useArtist, useCollection, useHome, useLibraryList, usePosition, useRadio,
  useRadioSeeds, useShell, type Shell,
} from '../../../../ui';
import { Bar, MenuScreen, Popup, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';
import { step } from './step';

/** nano pixels */
const u = (n: number) => `calc(var(--unit) * ${n})`;

/** State held by the screen entry, not its component: the chrome may unmount a covered screen, and
 *  the full-screen photo moves the grid's selection. */
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
/** move a selection kept in `set` from i to k; false when it stays (the chrome then does not click) */
const moveTo = (set: (n: number) => void, i: number, k: number) => { if (k === i) return false; set(k); };

/** Play a collection or a station from its top, then Now Playing. */
function play(sh: Shell, nav: Nav, uri: string) {
  const c = sh.store.getState().commands;
  if (/^spotify:(playlist|album):/.test(uri) || uri === LIKED) c.playAll(uri); else c.playItem({ uri });
  nav.toNowPlaying();
}

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

// ---- Genius Mixes: Spotify Home's playlists and albums ------------------------------------------

export function geniusMixes(): ScreenEntry {
  const at = kept(0);
  return { key: 'geniusMixes', title: 'Genius Mixes', render: () => <Mixes at={at} /> };
}

/** every playlist and album on Home, once, in feed order (§4.2) */
function mixesOf(sections: HomeSection[] | null): HomeItem[] {
  const seen = new Set<string>();
  return (sections ?? []).flatMap((s) => s.items).filter((x) => /^spotify:(playlist|album):/.test(x.uri) && !seen.has(x.uri) && !!seen.add(x.uri));
}

/** at most this many page dots, the current one kept inside them */
const DOTS = 15;

/** One mix a page (§2.4 Genius Mixes): "◀ name ▶" and its artists over a 2×2 mosaic of its covers,
 *  page dots under it. Wheel and ⏮⏭ change mixes; center or Play/Pause plays it. The mosaic is the
 *  mix's first songs' covers (one page fetched per mix shown), else its own cover. */
function Mixes({ at }: { at: Kept }) {
  const sh = useShell(), nav = useNav(), { sections } = useHome(), [sel, setI] = useKept(at), [hold, openHold] = useHold();
  const mixes = mixesOf(sections), n = mixes.length, i = Math.min(sel, Math.max(0, n - 1)), m = mixes[i];
  const songs = useCollection(m?.uri), playing = useApp((s) => !!m && s.playback.context?.uri === m.uri);
  const go = (d: number) => moveTo(setI, i, step(i, d, n));
  useWheel({
    onTick: go, onPrev: () => go(-1), onNext: () => go(1),
    onCenter: m ? () => play(sh, nav, m.uri) : undefined, onPlay: m ? () => play(sh, nav, m.uri) : undefined,
    onHoldCenter: m ? () => openHold({ uri: m.uri, name: m.name }) : undefined,
  });
  if (!m) return <MenuScreen items={[]} loading={!sections} empty="No Genius Mixes" />;
  const covers = [...new Set(songs.rows.map((t) => t.art || t.image).filter((x): x is string => !!x))].slice(0, 4);
  const artists = [...new Set(songs.rows.map((t) => t.artist))].slice(0, 6).join(', ') || m.sub;
  const lo = Math.max(0, Math.min(i - (DOTS >> 1), n - DOTS));
  const arrow = (on: boolean, ch: string) => <span style={{ fontSize: u(11), opacity: on ? 1 : 0.3 }}>{ch}</span>;
  return (
    <div className="relative h-full overflow-hidden text-white" style={{ background: '#000' }}>
      <div className="text-center" style={{ height: u(56), padding: `${u(5)} ${u(8)} 0`, background: 'linear-gradient(#424242, #010101)' }}>
        <div className="flex items-center justify-center font-bold" style={{ gap: u(6), fontSize: u(16), lineHeight: u(20) }}>
          {arrow(i > 0, '◀')}
          <span className="truncate">{m.name}</span>
          {playing && <svg viewBox="0 0 10 10" fill="currentColor" style={{ flex: 'none', width: u(10), height: u(10) }} aria-label="Playing">
            <path d="M0 3.5h2.5L5.5 1v8L2.5 6.5H0z" /><path d="M7 2.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>}
          {arrow(i < n - 1, '▶')}
        </div>
        <div style={{ fontSize: u(12), lineHeight: u(14), color: '#cfcfcf', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {artists}
        </div>
      </div>
      <div className="absolute grid grid-cols-2 grid-rows-2" style={{ top: u(62), left: u(10), width: u(220), height: u(220), background: '#222' }}>
        {covers.length === 4 ? covers.map((c) => <img key={c} src={c} alt="" className="block w-full h-full object-cover" />)
          : m.img && <img src={m.img} alt="" className="block object-cover col-span-2 row-span-2 w-full h-full" />}
      </div>
      <div className="absolute inset-x-0 flex justify-center" style={{ top: u(300), gap: u(5) }}>
        {mixes.slice(lo, lo + DOTS).map((x, k) => (
          <span key={x.uri} style={{ width: u(6), height: u(6), borderRadius: '50%', background: lo + k === i ? '#fff' : '#6a6a6a' }} />
        ))}
      </div>
      {hold}
    </div>
  );
}

// ---- Videos: Spotify Home's shelves (hidden by default; §6 item 5) -------------------------------

export function videos(): ScreenEntry {
  const at = kept(0);
  return { key: 'videos', title: 'Spotify Home', render: () => <Shelves at={at} /> };
}

function Shelves({ at }: { at: Kept }) {
  const { sections } = useHome(), nav = useNav(), [i, setI] = useKept(at);
  const items = (sections ?? []).map((sec, k): MenuItem => ({ id: String(k), label: sec.title, chevron: true, onSelect: () => nav.push(shelf(sec, k)) }));
  return <MenuScreen items={items} selected={i} onSelectedChange={setI} loading={!sections} empty="Nothing on Home" />;
}

function shelf(sec: HomeSection, k: number): ScreenEntry {
  const at = kept(0);
  return { key: 'videos/' + k, title: sec.title, render: () => <Shelf items={sec.items} at={at} /> };
}

/** a playlist, album, Liked Songs or artist opens to its songs; anything else plays */
const opens = (uri: string) => uri.startsWith('spotify:artist:') || isCollectionUri(uri);

function Shelf({ items, at }: { items: HomeItem[]; at: Kept }) {
  const sh = useShell(), nav = useNav(), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const menu = items.map((it, k): MenuItem => ({
    id: String(k), label: it.name, chevron: opens(it.uri),
    onSelect: () => { if (opens(it.uri)) nav.push(songs(it.uri, it.name)); else { sh.store.getState().commands.playItem(it); nav.toNowPlaying(); } },
    onHold: canSave(it.uri) ? () => openHold({ uri: it.uri, name: it.name }) : undefined,
  }));
  return (
    <>
      <MenuScreen items={menu} selected={i} onSelectedChange={setI} empty="Nothing here" />
      {hold}
    </>
  );
}

function songs(uri: string, name: string): ScreenEntry {
  const at = kept(0);
  return { key: 'videos:' + uri, title: name, render: () => <Songs uri={uri} at={at} /> };
}

/** a collection's songs (paged as the selection nears the end), or an artist's top songs */
function Songs({ uri, at }: { uri: string; at: Kept }) {
  const sh = useShell(), nav = useNav(), coll = useCollection(uri), artist = useArtist(uri), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const rows = isCollectionUri(uri) ? coll.rows : artist.page?.tracks ?? [];
  const items = rows.map((t, k): MenuItem => ({
    id: String(k), label: t.title, chevron: false,
    onSelect: () => { sh.store.getState().commands.playContext(t.ctx ?? uri, t.uri); nav.toNowPlaying(); },
    onHold: canSave(t.uri) ? () => openHold({ uri: t.uri, name: t.title }) : undefined,
  }));
  const move = (n: number) => { setI(n); if (n >= rows.length - 10) coll.loadMore(); };
  return (
    <>
      <MenuScreen items={items} selected={i} onSelectedChange={move} loading={coll.loading || artist.loading} empty="No Songs" />
      {hold}
    </>
  );
}

// ---- Photos: the library's cover art (§2.4 Photos, ours) ------------------------------------------

export function photos(): ScreenEntry {
  const at = kept(0);
  return { key: 'photos', title: 'Photos', render: () => <Photos at={at} /> };
}

const LIKED_ITEM: LibraryItem = { uri: LIKED, name: 'Liked Songs' };
/** a cover; Liked Songs (which has none) as Spotify draws it */
const Art = ({ x }: { x: LibraryItem }): ReactNode =>
  x.uri === LIKED ? <div className="grid place-items-center w-full h-full" style={{ background: 'linear-gradient(135deg, #450af5, #c4efd9)' }}>
    <svg viewBox="0 0 24 22" fill="#fff" style={{ width: '45%' }} aria-hidden="true"><path d="M12 21.6 10.3 20C4.2 14.5 0 10.7 0 6.1 0 2.7 2.7 0 6.1 0 8 0 9.9.9 12 3.1 14.1.9 16 0 17.9 0 21.3 0 24 2.7 24 6.1c0 4.6-4.2 8.4-10.3 13.9z" /></svg>
  </div>
  : x.image ? <img src={x.image} alt="" loading="lazy" className="block w-full h-full object-cover" />
  : <div className="w-full h-full" style={{ background: '#8e8e93' }} />;

/** cells a ⏮ / ⏭ page moves: the 5 whole rows on screen */
const PAGE = 20;

/** The thumbnail grid: 4 columns of 56 with a 4 gap, the selection ringed blue and raised. Wheel
 *  moves it, ⏮⏭ a page (held: to the first / last), center shows it full screen, Play/Pause plays it. */
function Photos({ at }: { at: Kept }) {
  const sh = useShell(), nav = useNav(), lib = useLibraryList(), all = [LIKED_ITEM, ...lib.items];
  const [sel, setI] = useKept(at), [hold, openHold] = useHold(), grid = useRef<HTMLDivElement>(null);
  // an album removed from the library (hold-center: Remove) shortens the grid under the selection
  const n = all.length, i = Math.min(sel, n - 1), a = all[i]!;
  // keep the selected cell in view, scrolling the grid only (never the page around it)
  useLayoutEffect(() => {
    const g = grid.current, c = g?.children[i] as HTMLElement | undefined;
    if (!g || !c) return;
    if (c.offsetTop < g.scrollTop) g.scrollTop = c.offsetTop;
    else if (c.offsetTop + c.offsetHeight > g.scrollTop + g.clientHeight) g.scrollTop = c.offsetTop + c.offsetHeight - g.clientHeight;
  }, [i, n]);
  useWheel({
    onTick: (d) => moveTo(setI, i, step(i, d, n)), onPrev: () => setI(step(i, -PAGE, n)), onNext: () => setI(step(i, PAGE, n)),
    onHoldPrev: () => setI(0), onHoldNext: () => setI(n - 1),
    onCenter: () => nav.push(photo(all, at)),
    onPlay: () => play(sh, nav, a.uri),
    onHoldCenter: canSave(a.uri) ? () => openHold({ uri: a.uri, name: a.name }) : undefined,
  });
  return (
    <>
      <div ref={grid} className="relative grid content-start h-full overflow-hidden"
           style={{ gridTemplateColumns: `repeat(4, ${u(56)})`, gap: u(4), padding: u(2) }}>
        {all.map((x, k) => (
          <div key={x.uri} className="relative" onClick={() => (k === i ? nav.push(photo(all, at)) : setI(k))} style={{ width: u(56), height: u(56), ...(k === i
            ? { zIndex: 1, transform: 'scale(1.08)', boxShadow: `0 0 0 ${u(2)} #3f7fcd` } : {}) }}>
            <Art x={x} />
          </div>
        ))}
      </div>
      {hold}
    </>
  );
}

function photo(all: LibraryItem[], at: Kept): ScreenEntry {
  return { key: 'photos/full', title: 'Photos', render: () => <Photo all={all} at={at} /> };
}

/** One cover full screen on black with its name and owner or artist under it: the wheel and ⏮⏭
 *  move through them (and the grid's selection with it), center or Play/Pause plays it. */
function Photo({ all, at }: { all: LibraryItem[]; at: Kept }) {
  const sh = useShell(), nav = useNav(), [i, setI] = useKept(at), [hold, openHold] = useHold(), a = all[i];
  const go = (d: number) => moveTo(setI, i, step(i, d, all.length));
  useWheel({
    onTick: go, onPrev: () => go(-1), onNext: () => go(1),
    onCenter: a ? () => play(sh, nav, a.uri) : undefined, onPlay: a ? () => play(sh, nav, a.uri) : undefined,
    onHoldCenter: a && canSave(a.uri) ? () => openHold({ uri: a.uri, name: a.name }) : undefined,
  });
  if (!a) return null;
  return (
    <div className="flex flex-col justify-center h-full text-white text-center" style={{ background: '#000' }}>
      <div style={{ width: u(240), height: u(240) }}><Art x={a} /></div>
      <div className="truncate font-bold" style={{ fontSize: u(14), padding: `${u(6)} ${u(8)} 0` }}>{a.name}</div>
      <div className="truncate" style={{ fontSize: u(12), padding: `0 ${u(8)}`, color: '#bdbdbd' }}>{a.artist ?? a.owner}</div>
      {hold}
    </div>
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

/** station i on the dial, MHz (§4.2) */
const MHZ0 = 87.5, STEP = 0.2, MHZ1 = 108;
/** nano pixels per MHz: the numbers every 2 MHz sit 60 apart, four of them on screen */
const PX = 30;

/** The FM screen: the station's name as RDS, the playing title and artist, the frequency big, the
 *  dial at the bottom. Turning tunes and plays once the wheel rests 600 ms; ⏮⏭ seek a station;
 *  center switches the dial with the song's progress bar; hold-center: Favorites; MENU: the Radio menu. */
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
    onMenu: () => { nav.replace(radioMenu(r)); return true; },
  });
  if (!st) return <MenuScreen items={[]} loading={!live} empty="No Stations" />;
  const f = MHZ0 + STEP * i;
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
        {bar ? <Progress /> : <Scale f={f} dots={list.flatMap((x, k) => (log.fav.some((y) => y.uri === x.uri) ? [k] : []))} />}
      </div>
      {held && <Popup onClose={() => setHeld(false)} items={[
        { id: 'fav', label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => {
          const v = radioLog.get();
          radioLog.set({ ...v, fav: fav ? without(v.fav, st) : [...v.fav, bare(st)] });
        } },
        { id: 'cancel', label: 'Cancel' },
      ]} />}
    </div>
  );
}

/** The scale under the fixed red needle, sliding as the dial tunes: a tick every 0.2 MHz, a long one
 *  every 1, the numbers every 2; orange dots on the favourites. */
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
          <span key={k} className="absolute" style={{ left: x(MHZ0 + STEP * k), top: u(40), width: u(5), height: u(5), marginLeft: u(-2.5), borderRadius: '50%', background: '#ff9500' }} />
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

/** MENU on the FM screen: Play Radio (back to it, playing), Stop Radio, Favorites, Recent Songs
 *  [UG p.65]. It replaces the FM screen, so MENU here goes back to the main menu, as on the nano. */
function radioMenu(r: Tuner): ScreenEntry {
  return { key: 'fmRadio/menu', title: 'Radio', render: () => <RadioMenu r={r} /> };
}

function RadioMenu({ r }: { r: Tuner }) {
  const sh = useShell(), nav = useNav(), live = useRadio(useRadioSeeds()).stations, list = r.list.get() ?? live;
  const items: MenuItem[] = [
    { id: 'play', label: 'Play Radio', onSelect: () => {
      const st = list?.[Math.min(r.at.get(), list.length - 1)];
      if (st) { r.list.set(list); tuneIn(sh, st); }
      nav.replace(dial(r));
    } },
    { id: 'stop', label: 'Stop Radio', onSelect: () => void sh.store.getState().commands.pause() },
    { id: 'fav', label: 'Favorites', chevron: true, onSelect: () => nav.push(stations('fav', 'Favorites')) },
    { id: 'recent', label: 'Recent Songs', chevron: true, onSelect: () => nav.push(stations('recent', 'Recent Songs')) },
  ];
  return <MenuScreen items={items} />;
}

const stations = (which: keyof RadioLog, title: string): ScreenEntry =>
  ({ key: 'fmRadio/' + which, title, render: () => <Stations which={which} title={title} /> });

/** a Radio menu list: center or Play/Pause plays the station, then Now Playing */
function Stations({ which, title }: { which: keyof RadioLog; title: string }) {
  const sh = useShell(), nav = useNav(), [log] = useKept(radioLog);
  const items = log[which].map((x): MenuItem => ({ id: x.uri, label: x.name, onSelect: () => { tuneIn(sh, x); nav.toNowPlaying(); } }));
  return <MenuScreen items={items} empty={'No ' + title} />;
}

// ---- Voice Memos: nothing records here -----------------------------------------------------------

export function voiceMemos(): ScreenEntry {
  return { key: 'voiceMemos', title: 'Voice Memos', render: () => <MenuScreen items={[]} empty="No Voice Memos" /> };
}
