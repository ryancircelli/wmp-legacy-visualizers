// The nano 5G's Music screens over the Spotify library: Playlists, Artists, Albums, Songs, Search,
// Cover Flow, and the empty pages Spotify has nothing for. Lists are the chrome's MenuScreen (center
// fires the row, hold-center its context menu); Search and Cover Flow draw themselves and take the
// wheel. What a screen should come back to (the selected row, the typed query) is kept on its entry,
// so it outlives the screen's unmount while a deeper one is on top.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { LIKED, type AppStore, type LibraryItem, type SearchResults, type Track } from '../../../../model';
import {
  canSave, isAlbum, useAddTo, useArtist, useCollection, useDebounced, useLibraryList, useSearchAll, useShell, type Shell,
} from '../../../../ui';
import { MenuScreen, Popup, Spinner, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';
import { artistsOf, SLOTS, strip, type Strip, type StripAct } from './logic';

/** nano pixels */
const u = (n: number) => `calc(var(--unit) * ${n})`;
// the chrome's screen colours (ipod.module.css .body)
const TEXT = 'var(--ipod-ink, #000)', DIM = 'var(--ipod-dim, #7a7a7a)';
const SEL = { background: 'var(--ipod-sel-bg, linear-gradient(#64aef0, #2c76d4))', color: 'var(--ipod-sel-ink, #fff)' };
/** rows from the end at which the next page is asked for */
const NEAR = 8;

interface Box<T> { get: () => T; set: (v: T) => void }
const box = <T,>(v: T): Box<T> => ({ get: () => v, set: (x) => { v = x; } });
/** state that lives on the entry: read once at mount, written through on every change */
function useKept<T>(b: Box<T>): [T, (v: T) => void] {
  const [v, setV] = useState(b.get);
  return [v, (x) => { b.set(x); setV(x); }];
}

function screen<T>(key: string, title: string, init: T, body: (k: Box<T>) => ReactNode): ScreenEntry {
  const k = box(init);
  return { key, title, render: () => body(k) };
}

/** MenuScreen with the selection kept on the entry; `near` runs as the selection nears the end. */
function List({ keep, items, near, loading, empty, preview }: {
  keep: Box<number>; items: MenuItem[]; near?: () => void; loading?: boolean; empty?: string; preview?: ReactNode;
}) {
  const [sel, setSel] = useKept(keep);
  return <MenuScreen items={items} selected={sel} loading={loading} empty={empty} preview={preview}
                     onSelectedChange={(i) => { setSel(i); if (near && i >= items.length - NEAR) near(); }} />;
}

const opens = (nav: Nav, x: { uri: string; name: string }): MenuItem =>
  ({ id: x.uri, label: x.name, chevron: true, onSelect: () => nav.push(collection(x.uri, x.name)) });

// ---- tracks --------------------------------------------------------------------------------

/** Play a song where it was listed (its playlist / album / artist; a Liked Songs row in its album,
 *  as everywhere in the app), then Now Playing, as the iPod does once a song is chosen. */
const playSong = (sh: Shell, nav: Nav, t: Track) => { sh.store.getState().commands.playItem(t); nav.toNowPlaying(); };

/** Songs: center plays from that row; hold-center: the song's menu. */
function TrackList({ keep, rows, loading, more }: { keep: Box<number>; rows: Track[]; loading: boolean; more?: () => void }) {
  const sh = useShell(), nav = useNav(), [held, setHeld] = useState<Held>(null);
  // index in the id: a playlist can hold the same track twice
  const items = rows.map((t, i): MenuItem => ({ id: i + ':' + t.uri, label: t.title,
    onSelect: () => playSong(sh, nav, t), onHold: () => setHeld({ t }) }));
  return (
    <>
      <List keep={keep} items={items} loading={loading} empty="No Songs" near={more} />
      {held && <TrackPopup held={held} set={setHeld} />}
    </>
  );
}

/** A playlist, album or Liked Songs, paged. */
function Collection({ uri, keep }: { uri: string; keep: Box<number> }) {
  const c = useCollection(uri);
  return <TrackList keep={keep} rows={c.rows} loading={c.loading} more={c.loadMore} />;
}
const collection = (uri: string, title: string) => screen('tracks:' + uri, title, 0, (k) => <Collection uri={uri} keep={k} />);

/** Song radio: the station seeded from the song, played, then Now Playing; the status line says
 *  when there is none. */
async function startRadio(sh: Shell, nav: Nav, t: Track): Promise<void> {
  const name = t.title + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: t.uri, name, sub: 'Song radio' }]).catch(() => [])).find((x) => x.name === name);
  const s = sh.store.getState();
  if (!st) { s.actions.setStatus('No radio for ' + t.title); return; }
  s.commands.playContext(st.uri, null);
  nav.toNowPlaying();
}

/** A song's hold-center menu, and whether it shows the playlists page. */
type Held = { t: Track; lists?: boolean } | null;

/** Hold-center on a song: Like, Add to Playlist (the editable ones, ✓ where it is; a pick toggles),
 *  Start Radio, Go to Artist, Go to Album, Cancel. The Popup closes on any choice, so Add to Playlist
 *  reopens it on the playlists page (both updates land in one render: useAddTo's state survives). */
function TrackPopup({ held: { t, lists }, set }: { held: NonNullable<Held>; set: (h: Held) => void }) {
  const sh = useShell(), nav = useNav(), a = useAddTo(canSave(t.uri) ? t.uri : null);
  const artist = t.artistUris?.[0], album = t.albumUri;
  const items: MenuItem[] = lists
    ? (a.playlistMenu().sub ?? []).flatMap((e, i): MenuItem[] => ('label' in e
      ? [{ id: 'pl' + i, label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled, onSelect: e.act }] : []))
    : [
      { id: 'like', label: a.saved ? 'Unlike' : 'Like', disabled: !a.uri, onSelect: a.toggle },
      { id: 'add', label: 'Add to Playlist', chevron: true, disabled: !a.uri, onSelect: () => { a.playlistMenu().onOpen?.(); set({ t, lists: true }); } },
      { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, t) },
      { id: 'artist', label: 'Go to Artist', disabled: !artist,
        onSelect: artist ? () => nav.push(artistPage(artist, artistsOf([t]).get(artist) ?? t.artist)) : undefined },
      { id: 'album', label: 'Go to Album', disabled: !album, onSelect: album ? () => nav.push(collection(album, t.album ?? 'Album')) : undefined },
      { id: 'cancel', label: 'Cancel' },
    ];
  // keyed: the playlists page opens on its first row
  return <Popup key={lists ? 'lists' : 'track'} items={items} onClose={() => set(null)} />;
}

// ---- the Music menu's lists ------------------------------------------------------------------

/** Liked Songs first (where Spotify pins it, as the nano pins On-The-Go), then the library's playlists. */
function Playlists({ keep }: { keep: Box<number> }) {
  const nav = useNav(), lib = useLibraryList();
  const items = [opens(nav, { uri: LIKED, name: 'Liked Songs' }), ...lib.items.filter((x) => !isAlbum(x.uri)).map((x) => opens(nav, x))];
  return <List keep={keep} items={items} loading={lib.loading} />;
}

function Albums({ keep }: { keep: Box<number> }) {
  const nav = useNav(), lib = useLibraryList();
  return <List keep={keep} items={lib.items.filter((x) => isAlbum(x.uri)).map((x) => opens(nav, x))} loading={lib.loading} empty="No Albums" />;
}

/** The adapter lists no followed artists: these are Liked Songs' artists, most recently liked first,
 *  growing a page of songs at a time as the selection nears the end. */
function Artists({ keep }: { keep: Box<number> }) {
  const nav = useNav(), liked = useCollection(LIKED);
  const items = [...artistsOf(liked.rows)].map(([uri, name]): MenuItem =>
    ({ id: uri, label: name, chevron: true, onSelect: () => nav.push(artistPage(uri, name)) }));
  return <List keep={keep} items={items} loading={liked.loading} empty="No Artists" near={liked.loadMore} />;
}

/** An artist: "All" (their top songs; played in the artist's context) then the discography. Spotify's
 *  rows carry no album / single type, so albums and singles are one list. */
function ArtistPage({ uri, name, keep }: { uri: string; name: string; keep: Box<number> }) {
  const nav = useNav(), { page, loading } = useArtist(uri);
  const items: MenuItem[] = page ? [
    { id: 'all', label: 'All', chevron: true, onSelect: () => nav.push(artistAll(uri, page.meta.name || name)) },
    ...page.albums.map((x) => opens(nav, x)),
  ] : [];
  const img = page?.meta.image;
  return <List keep={keep} items={items} loading={loading} empty="No Albums"
               preview={img ? <img src={img} alt="" className="block w-full h-full object-cover" /> : undefined} />;
}
const artistPage = (uri: string, name: string) => screen('artist:' + uri, name, 0, (k) => <ArtistPage uri={uri} name={name} keep={k} />);

function ArtistAll({ uri, keep }: { uri: string; keep: Box<number> }) {
  const { page, loading } = useArtist(uri);
  return <TrackList keep={keep} rows={page?.tracks ?? []} loading={loading} />;
}
const artistAll = (uri: string, name: string) => screen('artist-all:' + uri, name, 0, (k) => <ArtistAll uri={uri} keep={k} />);

// ---- Search ----------------------------------------------------------------------------------

interface Hit { key: string; head?: string; label: string; sub?: string; track?: Track; open: () => void }

/** The results as one list under group heads, in the nano's order. */
function hitsOf(r: SearchResults | undefined, nav: Nav, sh: Shell): Hit[] {
  if (!r) return [];
  const col = (x: LibraryItem) => ({ label: x.name, sub: x.artist ?? x.owner, open: () => nav.push(collection(x.uri, x.name)) });
  const groups: [string, Omit<Hit, 'key'>[]][] = [
    ['Artists', r.artists.items.map((x) => ({ label: x.name, open: () => nav.push(artistPage(x.uri, x.name)) }))],
    ['Albums', r.albums.items.map(col)],
    ['Songs', r.tracks.items.map((t) => ({ label: t.title, sub: t.artist, track: t, open: () => playSong(sh, nav, t) }))],
    ['Playlists', r.playlists.items.map(col)],
  ];
  return groups.flatMap(([head, hs]) => hs.map((h, i) => ({ ...h, key: head + i, head: i ? undefined : head })));
}

const SLOT = 18;

/** The letter strip under the typed text, the results below it. Wheel: walks the strip, and on past ⌫
 *  down the results; center: enters the slot / plays a song / opens the rest; hold-center on a song:
 *  its menu; MENU: out of the results, else deletes a letter, else back; Prev deletes, Next types a
 *  space (the iPod's own). The query searches 400 ms after the last letter. */
function Search({ keep }: { keep: Box<Strip> }) {
  const sh = useShell(), nav = useNav(), [s, setS] = useKept(keep), [q, setQ] = useState(s.q), search = useDebounced(setQ);
  const { results, loading } = useSearchAll(q), [held, setHeld] = useState<Held>(null), list = useRef<HTMLDivElement>(null);
  const hits = hitsOf(results, nav, sh);
  const go = (a: StripAct) => { const n = strip(s, a); setS(n); if (n.q !== s.q) search(n.q); };
  useWheel(held ? {} : {
    onTick: (dir) => go({ t: 'tick', dir, rows: hits.length }),
    onCenter: () => { if (s.row >= 0) hits[s.row]?.open(); else go({ t: 'enter' }); },
    onHoldCenter: () => { const t = hits[s.row]?.track; if (t) setHeld({ t }); },
    onMenu: () => { if (s.row < 0 && !s.q) return false; go({ t: 'menu' }); return true; },
    onPrev: () => go({ t: 'delete' }),
    onNext: () => go({ t: 'space' }),
  });
  useEffect(() => { list.current?.querySelector('[data-sel]')?.scrollIntoView?.({ block: 'nearest' }); }, [s.row]);
  const inStrip = s.row < 0;
  const empty = !!s.q.trim() && q === s.q && !loading && !hits.length;
  return (
    <div className="flex flex-col h-full min-h-0" style={{ color: TEXT, fontSize: u(15) }}>
      <div className="flex-none truncate" style={{ height: u(26), lineHeight: u(26), padding: '0 ' + u(8) }}>
        {s.q || <span style={{ color: DIM }}>Search</span>}
      </div>
      <div className="flex-none relative overflow-hidden" style={{ height: u(26), borderBottom: '1px solid ' + DIM }}>
        <div className="absolute top-0 left-1/2 flex" style={{ transform: `translateX(${u(-(s.slot + 0.5) * SLOT)})`, transition: 'transform .1s' }}>
          {SLOTS.map((ch, i) => (
            <span key={i} className="grid place-items-center font-bold"
                  style={{ width: u(SLOT), height: u(26), ...(i === s.slot && inStrip ? SEL : {}) }}>
              {ch === ' ' ? '␣' : ch}
            </span>
          ))}
        </div>
      </div>
      <div ref={list} className="flex-auto min-h-0 overflow-hidden">
        {loading && <div className="grid place-items-center" style={{ padding: u(8) }}><Spinner /></div>}
        {empty && <div style={{ padding: u(8), color: DIM }}>No Results</div>}
        {hits.map((h, i) => {
          const sel = i === s.row;
          return (
            <Fragment key={h.key}>
              {h.head && <div style={{ padding: `${u(4)} ${u(8)} 0`, fontSize: u(12), color: DIM }}>{h.head}</div>}
              <div className="flex items-baseline min-w-0" data-sel={sel || undefined}
                   style={{ gap: u(6), height: u(26), lineHeight: u(26), padding: '0 ' + u(8), ...(sel ? SEL : {}) }}>
                <span className="truncate font-bold">{h.label}</span>
                {h.sub && <span className="truncate" style={{ fontSize: u(12), color: sel ? SEL.color : DIM }}>{h.sub}</span>}
              </div>
            </Fragment>
          );
        })}
      </div>
      {held && <TrackPopup held={held} set={setHeld} />}
    </div>
  );
}

// ---- Cover Flow ------------------------------------------------------------------------------

const COVER = 120;

/** The saved albums' covers in a row, the centred one flat and the rest turned toward it (CSS 3D);
 *  the wheel moves along, center opens the centred album's songs. */
function CoverFlow({ keep }: { keep: Box<number> }) {
  const nav = useNav(), lib = useLibraryList(), albs = lib.items.filter((x) => isAlbum(x.uri));
  const [at, setAt] = useKept(keep), i = Math.min(at, Math.max(0, albs.length - 1)), cur = albs[i];
  useWheel({
    onTick: (d) => setAt(Math.max(0, Math.min(albs.length - 1, i + d))),
    onCenter: () => { if (cur) nav.push(collection(cur.uri, cur.name)); },
  });
  if (!cur) return <div className="grid place-items-center h-full" style={{ color: DIM }}>{lib.loading ? <Spinner /> : 'No Albums'}</div>;
  return (
    <div className="relative h-full overflow-hidden bg-black" style={{ perspective: u(400) }}>
      {albs.map((x, j) => {
        const o = j - i, d = Math.sign(o);
        if (Math.abs(o) > 5) return null;
        return (
          <div key={x.uri} className="absolute bg-[#333] bg-cover bg-center"
               style={{ left: '50%', top: u(28), width: u(COVER), height: u(COVER), marginLeft: u(-COVER / 2), zIndex: 10 - Math.abs(o),
                        backgroundImage: x.image ? `url("${x.image}")` : undefined, transition: 'transform .2s',
                        transform: `translateX(${u(d * (COVER * 0.55 + Math.abs(o) * COVER * 0.28))}) translateZ(${u(o ? -60 : 0)}) rotateY(${-d * 65}deg)`,
                        WebkitBoxReflect: 'below 2px linear-gradient(transparent 70%, rgba(255,255,255,.25))' }} />
        );
      })}
      <div className="absolute inset-x-0 text-center text-white" style={{ top: u(COVER + 70), padding: '0 ' + u(8), fontSize: u(14) }}>
        <div className="truncate font-bold">{cur.name}</div>
        <div className="truncate" style={{ color: '#aaa' }}>{cur.artist}</div>
      </div>
    </div>
  );
}

// ---- the factories (src/skins/ipod/screens/contract.ts Screens) -------------------------------

/** a category Spotify's library has nothing for: the nano's empty page */
const none = (key: string, title: string): ScreenEntry => ({ key, title, render: () => <MenuScreen items={[]} empty={'No ' + title} /> });

export const playlists = () => screen('playlists', 'Playlists', 0, (k) => <Playlists keep={k} />);
export const artists = () => screen('artists', 'Artists', 0, (k) => <Artists keep={k} />);
export const albums = () => screen('albums', 'Albums', 0, (k) => <Albums keep={k} />);
export const songs = () => screen('songs', 'Songs', 0, (k) => <Collection uri={LIKED} keep={k} />);
export const genres = () => none('genres', 'Genres');
export const composers = () => none('composers', 'Composers');
/** libraryV3 is asked for episodes, but the adapter's list keeps playlists and albums only */
export const audiobooks = () => none('audiobooks', 'Audiobooks');
export const podcasts = () => none('podcasts', 'Podcasts');
export const search = () => screen<Strip>('search', 'Search', { q: '', slot: 0, row: -1 }, (k) => <Search keep={k} />);
export const coverFlow = () => screen('coverFlow', 'Cover Flow', 0, (k) => <CoverFlow keep={k} />);

/** Shuffle Songs: shuffle on, then Liked Songs from the top (Play all, as WMP's details pane plays
 *  it shuffled; Spotify names no Liked Songs context, so that is the first liked song's album).
 *  Only starts playback: the chrome's main menu pushes Now Playing after calling this, since this
 *  group cannot import nowplaying/. The contract hands it no store: the chrome may pass its shell's,
 *  else it is the page's own (app/mount.tsx sets window.Alchemy.store). */
export function shuffleSongs(_nav: Nav, store = (window.Alchemy as { store?: AppStore } | undefined)?.store): void {
  if (!store) return;
  const { playback, commands } = store.getState();
  if (!playback.shuffle) commands.toggleShuffle();
  commands.playAll(LIKED);
}
