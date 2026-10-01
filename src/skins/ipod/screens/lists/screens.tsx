// The nano 5G's Music screens over the Spotify library (docs/ipod-skin.md §2.4, §4.2): Playlists
// (On-The-Go first: the queue, which any song's hold-centre > Add to On-The-Go adds to), Artists,
// Albums, Songs, Search, Cover Flow, and the empty pages Spotify has nothing for. Lists are the
// chrome's MenuScreen (center fires the row, hold-center its menu, Play/Pause plays the row); Search
// and Cover Flow draw themselves. What a screen comes back to (the selected row, the typed query) is
// kept on its entry, so it outlives the screen's unmount.
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LIKED, type AppStore, type LibraryItem, type SearchResults, type Track } from '../../../../model';
import {
  canSave, isAlbum, STALE, useAddTo, useApp, useArtist, useCollection, useLibraryList, useSearch, useSearchAll, useShell, type Bucket, type Shell,
} from '../../../../ui';
import { MenuScreen, Popup, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';
import { albumsBy, artistList, artistsOf, az, SLOTS, strip, STRIP0, type Strip, type StripAct } from './logic';

/** nano pixels */
const u = (n: number) => `calc(var(--unit) * ${n})`;
// the chrome's screen colours and row (ipod.module.css), with the spec's values (§2.1, §2.2) behind them
const TEXT = 'var(--ipod-ink, #000)', DIM = 'var(--ipod-dim, #6b6b6b)', ROW = `var(--ipod-row-h, ${u(29.67)})`;
const SEL: CSSProperties = {
  background: 'var(--ipod-sel-bg, linear-gradient(180deg, #4ea0dc 0%, #4690d4 40%, #3f7fcd 70%, #336ac7 100%))',
  color: 'var(--ipod-sel-ink, #fff)',
};
/** rows from the loaded end at which the next page is asked for (§4.2) */
const NEAR = 10;

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

/** MenuScreen with the selection kept on the entry; `near` runs as the selection nears the loaded
 *  end; `play` is Play/Pause on a row (the iPod plays it, a collection whole [UG p.6]). */
function List({ keep, items, near, loading, empty, play }: {
  keep: Box<number>; items: MenuItem[]; near?: () => void; loading?: boolean; empty?: string; play?: (i: number) => void;
}) {
  const [sel, setSel] = useKept(keep), i = Math.min(sel, items.length - 1);
  useWheel({ onPlay: play && i >= 0 ? () => play(i) : undefined });
  return <MenuScreen items={items} selected={sel} loading={loading} empty={empty}
                     onSelectedChange={(n) => { setSel(n); if (near && n >= items.length - NEAR) near(); }} />;
}

// ---- playing -------------------------------------------------------------------------------------

/** Play a song where it was listed (its playlist / album / artist / Liked Songs), then Now Playing,
 *  as the iPod does once a song is chosen. */
const playSong = (sh: Shell, nav: Nav, t: Track) => { sh.store.getState().commands.playItem(t); nav.toNowPlaying(); };
/** Play a collection from its top (an artist: their context), then Now Playing (§4.1). */
function playUri(sh: Shell, nav: Nav, uri: string) {
  const c = sh.store.getState().commands;
  if (uri.startsWith('spotify:artist:')) c.playContext(uri, null); else c.playAll(uri);
  nav.toNowPlaying();
}
/** A page's Shuffle row: shuffle on, then a random song of it, in its playlist / album / Liked Songs. */
function shufflePlay(sh: Shell, nav: Nav, rows: readonly Track[]) {
  const s = sh.store.getState(), t = rows[Math.floor(Math.random() * rows.length)];
  if (!t) return;
  if (!s.playback.shuffle) s.commands.toggleShuffle();
  playSong(sh, nav, t);
}

const opens = (nav: Nav, x: { uri: string; name: string }): MenuItem =>
  ({ id: x.uri, label: x.name, chevron: true, onSelect: () => nav.push(collection(x.uri, x.name, true)) });

// ---- tracks --------------------------------------------------------------------------------------

/** Songs: center plays from that row; hold-center: the song's menu. An album or playlist page leads
 *  with Shuffle (§2.4 List pages). */
function TrackList({ keep, rows, loading, more, shuffle }: {
  keep: Box<number>; rows: readonly Track[]; loading: boolean; more?: () => void; shuffle?: boolean;
}) {
  const sh = useShell(), nav = useNav(), [held, setHeld] = useState<Held>(null), lead = shuffle && rows.length ? 1 : 0;
  const items: MenuItem[] = [
    ...(lead ? [{ id: 'shuffle', label: 'Shuffle', onSelect: () => shufflePlay(sh, nav, rows) }] : []),
    // index in the id: a playlist can hold the same track twice
    ...rows.map((t, i): MenuItem => ({ id: i + ':' + t.uri, label: t.title, onSelect: () => playSong(sh, nav, t), onHold: () => setHeld({ t }) })),
  ];
  const play = (i: number) => (i < lead ? shufflePlay(sh, nav, rows) : playSong(sh, nav, rows[i - lead]!));
  return (
    <>
      <List keep={keep} items={items} loading={loading} empty="No Songs" near={more} play={held ? undefined : play} />
      {held && <TrackPopup held={held} set={setHeld} />}
    </>
  );
}

/** A playlist, album or Liked Songs, paged. */
function Collection({ uri, keep, shuffle }: { uri: string; keep: Box<number>; shuffle: boolean }) {
  const c = useCollection(uri);
  return <TrackList keep={keep} rows={c.rows} loading={c.loading} more={c.loadMore} shuffle={shuffle} />;
}
const collection = (uri: string, title: string, shuffle: boolean) =>
  screen('tracks:' + uri, title, 0, (k) => <Collection uri={uri} keep={k} shuffle={shuffle} />);

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

/** Hold-center on a song (§3.1): Add to On-The-Go (Spotify's queue), Like, Add to Playlist (the
 *  editable ones, ✓ where it is; a pick toggles), Start Radio, Browse Album, Browse Artist, Cancel.
 *  The Popup closes on any choice, so Add to Playlist reopens it on the playlists page (both updates
 *  land in one render). */
function TrackPopup({ held: { t, lists }, set }: { held: NonNullable<Held>; set: (h: Held) => void }) {
  const sh = useShell(), nav = useNav(), a = useAddTo(canSave(t.uri) ? t.uri : null), queues = useApp((s) => !!s.commands.addToQueue);
  const artist = t.artistUris?.[0], album = t.albumUri;
  const items: MenuItem[] = lists
    ? (a.playlistMenu().sub ?? []).flatMap((e, i): MenuItem[] => ('label' in e
      ? [{ id: 'pl' + i, label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled, onSelect: e.act }] : []))
    : [
      { id: 'queue', label: 'Add to On-The-Go', disabled: !queues, onSelect: () => sh.store.getState().commands.addToQueue?.(t.uri) },
      { id: 'like', label: a.saved ? 'Unlike' : 'Like', disabled: !a.uri, onSelect: a.toggle },
      { id: 'add', label: 'Add to Playlist', chevron: true, disabled: !a.uri, onSelect: () => { a.playlistMenu().onOpen?.(); set({ t, lists: true }); } },
      { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, t) },
      { id: 'album', label: 'Browse Album', disabled: !album, onSelect: album ? () => nav.push(collection(album, t.album ?? 'Album', true)) : undefined },
      { id: 'artist', label: 'Browse Artist', disabled: !artist,
        onSelect: artist ? () => nav.push(artistPage(artist, artistsOf([t]).get(artist) ?? t.artist)) : undefined },
      { id: 'cancel', label: 'Cancel' },
    ];
  // keyed: the playlists page opens on its first row
  return <Popup key={lists ? 'lists' : 'track'} items={items} onClose={() => set(null)} />;
}

// ---- the Music menu's lists ----------------------------------------------------------------------

/** On-The-Go (the queue, §6 item 7), then Liked Songs (where Spotify pins it), then the library's
 *  playlists in library order. */
function Playlists({ keep }: { keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), lib = useLibraryList();
  const items: MenuItem[] = [
    { id: 'onthego', label: 'On-The-Go', chevron: true, onSelect: () => nav.push(onTheGo()) },
    opens(nav, { uri: LIKED, name: 'Liked Songs' }),
    ...lib.items.filter((x) => !isAlbum(x.uri)).map((x) => opens(nav, x)),
  ];
  // Play/Pause on On-The-Go is the plain play/pause: the queue is already what plays next
  return <List keep={keep} items={items} loading={lib.loading} play={(i) => { if (i) playUri(sh, nav, items[i]!.id); }} />;
}

/** On-The-Go: what Spotify plays next (its queue); a song joins it from any list's hold-centre >
 *  Add to On-The-Go, and shows here with the player's next state. */
function OnTheGo({ keep }: { keep: Box<number> }) {
  const rows = useApp((s) => s.queue.next);
  return <TrackList keep={keep} rows={rows} loading={false} />;
}

/** Saved albums, A–Z (§6 item 11). */
function Albums({ keep }: { keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), lib = useLibraryList();
  const items = lib.items.filter((x) => isAlbum(x.uri)).sort((a, b) => az(a.name, b.name)).map((x) => opens(nav, x));
  return <List keep={keep} items={items} loading={lib.loading} empty="No Albums" play={(i) => playUri(sh, nav, items[i]!.id)} />;
}

/** Followed artists (Your Library > Artists) in Spotify's order; none under the local engine. */
function useFollowedArtists(): { items: LibraryItem[]; loading: boolean } {
  const q = useShell().queries, on = useApp((s) => s.auth.loggedIn === true);
  const r = useQuery({ queryKey: q.keys.followedArtists(), queryFn: q.fetchFollowedArtists, enabled: on, staleTime: STALE.list });
  return { items: (r.data ?? []) as LibraryItem[], loading: on && r.isPending };
}

/** The followed artists, A–Z; with none, the liked songs' and saved albums' artists (§6 item 1). The
 *  selection is kept by artist, as later pages of liked songs land in between.
 *  ponytail: the fallback's complete A–Z needs every liked page; they load as the selection nears the end. */
function Artists({ keep }: { keep: Box<string> }) {
  const sh = useShell(), nav = useNav(), followed = useFollowedArtists(), liked = useCollection(LIKED), lib = useLibraryList(), [id, setId] = useKept(keep);
  const derived = !followed.loading && !followed.items.length;
  const list = followed.loading ? [] : derived ? artistList(artistsOf(liked.rows), lib.items.filter((x) => isAlbum(x.uri)))
    : followed.items.map((x) => ({ key: x.uri, name: x.name, uri: x.uri })).sort((a, b) => az(a.name, b.name));
  const sel = Math.max(0, list.findIndex((a) => a.key === id)), a = list[sel];
  useWheel({ onPlay: a?.uri ? () => playUri(sh, nav, a.uri!) : undefined });
  const items = list.map((x): MenuItem => ({
    id: x.key, label: x.name, chevron: true, onSelect: () => nav.push(x.uri ? artistPage(x.uri, x.name) : savedArtist(x.name)) }));
  return <MenuScreen items={items} selected={sel} loading={followed.loading || (!items.length && (liked.loading || lib.loading))} empty="No Artists"
                     onSelectedChange={(n) => { setId(items[n]!.id); if (derived && n >= items.length - NEAR) liked.loadMore(); }} />;
}

/** An artist: All Songs (their top songs; played in the artist's context) then the discography.
 *  Spotify's rows carry no album / single type, so albums and singles are one list. */
function ArtistPage({ uri, name, keep }: { uri: string; name: string; keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), { page, loading } = useArtist(uri);
  const items: MenuItem[] = page ? [
    { id: uri, label: 'All Songs', chevron: true, onSelect: () => nav.push(artistAll(uri, page.meta.name || name)) },
    ...page.albums.map((x) => opens(nav, x)),
  ] : [];
  return <List keep={keep} items={items} loading={loading} empty="No Albums" play={(i) => playUri(sh, nav, items[i]!.id)} />;
}
const artistPage = (uri: string, name: string) => screen('artist:' + uri, name, 0, (k) => <ArtistPage uri={uri} name={name} keep={k} />);

function ArtistAll({ uri, keep }: { uri: string; keep: Box<number> }) {
  const { page, loading } = useArtist(uri);
  return <TrackList keep={keep} rows={page?.tracks ?? []} loading={loading} />;
}
const artistAll = (uri: string, name: string) => screen('artist-all:' + uri, name, 0, (k) => <ArtistAll uri={uri} keep={k} />);

/** An artist known only by a saved album's credit: their saved albums. */
function SavedArtist({ name, keep }: { name: string; keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), lib = useLibraryList();
  const items = albumsBy(name, lib.items.filter((x) => isAlbum(x.uri))).sort((a, b) => az(a.name, b.name)).map((x) => opens(nav, x));
  return <List keep={keep} items={items} loading={lib.loading} empty="No Albums" play={(i) => playUri(sh, nav, items[i]!.id)} />;
}
const savedArtist = (name: string) => screen('artist-name:' + name, name, 0, (k) => <SavedArtist name={name} keep={k} />);

// ---- Search (§2.4: layout reconstructed) -----------------------------------------------------------

type Kind = 'song' | 'artist' | 'album' | 'playlist';
/** the results' type glyphs, 12 px [UG p.45] */
const GLYPH: Record<Kind, ReactNode> = {
  song: <path d="M4.5 2.2 11 .5v7.8a1.9 1.6 0 1 1-1.3-1.5V3.1L5.8 4.2v5.6a1.9 1.6 0 1 1-1.3-1.5z" />,
  artist: <><circle cx="6" cy="3.4" r="2.7" /><path d="M.8 12c0-3.1 2.3-5.2 5.2-5.2s5.2 2.1 5.2 5.2z" /></>,
  album: <path fillRule="evenodd" d="M6 .2a5.8 5.8 0 1 1 0 11.6A5.8 5.8 0 0 1 6 .2zm0 4.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />,
  playlist: <path d="M0 1.5h2v2H0zm3.5 0H12v2H3.5zM0 5h2v2H0zm3.5 0H12v2H3.5zM0 8.5h2v2H0zm3.5 0H12v2H3.5z" />,
};
/** the results in the order of §4.2: Songs, Artists, Albums, Playlists */
const BUCKETS: readonly (readonly [Bucket, Kind, string])[] =
  [['tracks', 'song', 'Songs'], ['artists', 'artist', 'Artists'], ['albums', 'album', 'Albums'], ['playlists', 'playlist', 'Playlists']];

interface Hit { key: string; kind?: Kind; label: string; sub?: string; track?: Track; open: () => void; play?: () => void }

function hit(kind: Kind, x: Track | LibraryItem, nav: Nav, sh: Shell): Omit<Hit, 'key'> {
  if (kind === 'song') {
    const t = x as Track;
    return { kind, label: t.title, sub: t.artist, track: t, open: () => playSong(sh, nav, t), play: () => playSong(sh, nav, t) };
  }
  const c = x as LibraryItem;
  const open = kind === 'artist' ? () => nav.push(artistPage(c.uri, c.name)) : () => nav.push(collection(c.uri, c.name, true));
  return { kind, label: c.name, sub: kind === 'artist' ? undefined : c.artist ?? c.owner, open, play: () => playUri(sh, nav, c.uri) };
}

/** Every bucket's first page flattened, each bucket ending in "More…" when it has more. */
function hitsOf(r: SearchResults | undefined, q: string, nav: Nav, sh: Shell): Hit[] {
  if (!r) return [];
  return BUCKETS.flatMap(([b, kind, title]) => {
    const page = r[b], hs: Hit[] = (page.items as (Track | LibraryItem)[]).map((x, i) => ({ ...hit(kind, x, nav, sh), key: b + i }));
    if (page.hasMore) hs.push({ key: b + ':more', label: 'More…', open: () => nav.push(more(q, b, kind, title)) });
    return hs;
  });
}

const SLOT = 20;
const LINE: CSSProperties = { display: 'flex', alignItems: 'center', gap: u(6), height: ROW, padding: `0 ${u(9)} 0 ${u(10)}`, whiteSpace: 'nowrap' };

/** Results above, the picker band below: the typed query over the letter strip, the current letter
 *  in a centred blue box. Wheel: the letter (in the results: the row); center: types it (opens the
 *  row); ⏭ a space, ⏮ deletes; MENU: to the results once something was typed, back to the picker,
 *  then out. Each typed character searches (§4.5). */
function Search({ keep }: { keep: Box<Strip> }) {
  const sh = useShell(), nav = useNav(), [s, setS] = useKept(keep), list = useRef<HTMLDivElement>(null);
  const { results, loading } = useSearchAll(s.q), [held, setHeld] = useState<Held>(null);
  const hits = hitsOf(results, s.q.trim(), nav, sh), row = s.row >= 0 ? Math.min(s.row, hits.length - 1) : -1, h = hits[row];
  const go = (a: StripAct) => { const n = strip(s, a); if (n) setS(n); return !!n; };
  /** a detent; false when nothing moved (the chrome then does not click) */
  const tick = (dir: 1 | -1) => { const n = strip(s, { t: 'tick', dir, rows: hits.length })!; if (n.slot === s.slot && n.row === s.row) return false; setS(n); };
  // the selected result in view, scrolling the list only (never the page around it)
  useLayoutEffect(() => {
    const l = list.current, el = l?.children[row] as HTMLElement | undefined;
    if (!l || !el) return;
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
  }, [row]);
  useWheel(held ? {} : {
    onTick: tick,
    onCenter: () => { if (h) h.open(); else go({ t: 'enter' }); },
    onHoldCenter: h?.track ? () => setHeld({ t: h.track! }) : undefined,
    onMenu: () => go({ t: 'menu', rows: hits.length }),
    onPlay: h?.play,
    onPrev: h ? undefined : () => go({ t: 'delete' }),
    onNext: h ? undefined : () => go({ t: 'space' }),
  });
  const note = loading ? 'Loading…' : s.q.trim() && !hits.length ? 'No Results' : null;
  return (
    <div className="flex flex-col h-full min-h-0" style={{ color: TEXT }}>
      <div ref={list} className="relative flex-auto min-h-0 overflow-hidden" style={{ fontSize: u(18), fontWeight: 'bold' }}>
        {note ? <div style={{ ...LINE, color: '#8e8e93' }}>{note}</div> : hits.map((x, i) => (
          <div key={x.key} onClick={() => { setS({ ...s, row: i, typed: false }); x.open(); }} style={{ ...LINE, ...(i === row ? SEL : {}) }}>
            <svg viewBox="0 0 12 12" fill="currentColor" style={{ flex: 'none', width: u(12), height: u(12) }} aria-hidden="true">
              {x.kind && GLYPH[x.kind]}
            </svg>
            <span className="truncate">{x.label}</span>
            {x.sub && <span className="truncate" style={{ flex: 'none', maxWidth: '45%', fontSize: u(13), fontWeight: 'normal', color: i === row ? 'inherit' : DIM }}>{x.sub}</span>}
          </div>
        ))}
      </div>
      <div className="flex-none" style={{ height: u(56), background: 'linear-gradient(#656565, #262626)', color: '#fff', fontWeight: 'bold' }}>
        <div className="flex items-center" style={{ height: u(26), gap: u(6), padding: `0 ${u(10)}`, fontSize: u(16) }}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: 'none', width: u(12), height: u(12) }} aria-hidden="true">
            <circle cx="5" cy="5" r="3.8" /><path d="M7.8 7.8 11.3 11.3" />
          </svg>
          {/* right-to-left so a long query shows its end */}
          <div className="flex-auto min-w-0 overflow-hidden" style={{ whiteSpace: 'pre', direction: 'rtl', textAlign: 'left' }}>
            <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>{s.q}</span>
          </div>
        </div>
        <div className="relative overflow-hidden" style={{ height: u(30), fontSize: u(14) }}>
          <div className="absolute" style={{ left: '50%', top: u(4), width: u(SLOT), height: u(22), marginLeft: u(-SLOT / 2), ...SEL, opacity: h ? 0.35 : 1 }} />
          <div className="absolute flex" style={{ left: '50%', top: u(4), transform: `translateX(${u(-(s.slot + 0.5) * SLOT)})`, transition: 'transform .1s' }}>
            {SLOTS.map((ch, k) => <span key={ch} className="grid place-items-center" style={{ width: u(SLOT), height: u(22) }}
                                         onClick={() => setS(strip({ ...s, slot: k, row: -1 }, { t: 'enter' })!)}>{ch}</span>)}
          </div>
        </div>
      </div>
      {held && <TrackPopup held={held} set={setHeld} />}
    </div>
  );
}

/** A bucket's "More…": its results paged. */
function More({ q, bucket, kind, keep }: { q: string; bucket: Bucket; kind: Kind; keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), r = useSearch(q, bucket), [held, setHeld] = useState<Held>(null);
  const hits = r.items.map((x) => hit(kind, x, nav, sh));
  const items = hits.map((x, i): MenuItem => ({ id: String(i), label: x.label, chevron: kind !== 'song', onSelect: x.open,
                                                onHold: x.track ? () => setHeld({ t: x.track! }) : undefined }));
  return (
    <>
      <List keep={keep} items={items} loading={r.loading && !items.length} empty="No Results" near={r.loadMore}
            play={held ? undefined : (i) => hits[i]?.play?.()} />
      {held && <TrackPopup held={held} set={setHeld} />}
    </>
  );
}
const more = (q: string, b: Bucket, kind: Kind, title: string) =>
  screen('search:' + b, title, 0, (k) => <More q={q} bucket={b} kind={kind} keep={k} />);

// ---- Cover Flow (§2.4: ours, a portrait page) -------------------------------------------------------

const COVER = 150, PITCH = 38;

/** The saved albums by artist (the iPod's order [UG p.37]): the centred cover flat, its neighbours
 *  turned toward it. Wheel and ⏮⏭ flip; center pushes the album's songs; Play/Pause plays it. */
function CoverFlow({ keep }: { keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), lib = useLibraryList();
  const albs = lib.items.filter((x) => isAlbum(x.uri)).sort((a, b) => az(a.artist ?? '', b.artist ?? '') || az(a.name, b.name));
  const [at, setAt] = useKept(keep), i = Math.min(at, Math.max(0, albs.length - 1)), cur = albs[i];
  /** false when nothing moved (the chrome then does not click) */
  const flip = (d: number) => { const k = Math.max(0, Math.min(albs.length - 1, i + d)); if (k === i) return false; setAt(k); };
  useWheel({
    onTick: flip, onPrev: () => flip(-1), onNext: () => flip(1),
    onCenter: () => { if (cur) nav.push(collection(cur.uri, cur.name, true)); },
    onPlay: cur ? () => playUri(sh, nav, cur.uri) : undefined,
  });
  if (!cur) return <MenuScreen items={[]} loading={lib.loading} empty="No Albums" />;
  return (
    <div className="relative h-full overflow-hidden" style={{ background: 'linear-gradient(#fff, #e9e9e9)', perspective: u(500) }}>
      {albs.map((x, j) => {
        const o = j - i, d = Math.sign(o);
        if (Math.abs(o) > 6) return null;
        return (
          <div key={x.uri} className="absolute bg-cover bg-center" onClick={() => (o ? setAt(j) : nav.push(collection(x.uri, x.name, true)))}
               style={{ left: '50%', top: u(50), width: u(COVER), height: u(COVER), marginLeft: u(-COVER / 2), zIndex: 10 - Math.abs(o),
                        backgroundColor: '#c8c8c8', backgroundImage: x.image ? `url("${x.image}")` : undefined, transition: 'transform .2s',
                        transform: o ? `translateX(${u(d * (COVER / 2 + 30 + PITCH * (Math.abs(o) - 1)))}) translateZ(${u(-60)}) rotateY(${-d * 65}deg)` : undefined,
                        WebkitBoxReflect: 'below 0 linear-gradient(transparent 70%, rgb(255 255 255 / .35))' }} />
        );
      })}
      <div className="absolute inset-x-0 text-center" style={{ top: u(222), padding: `0 ${u(10)}`, color: TEXT }}>
        <div className="truncate font-bold" style={{ fontSize: u(14), lineHeight: u(18) }}>{cur.name}</div>
        <div className="truncate" style={{ fontSize: u(12), lineHeight: u(18), color: DIM }}>{cur.artist}</div>
      </div>
    </div>
  );
}

// ---- the factories (src/skins/ipod/screens/contract.ts Screens) -----------------------------------

/** a category Spotify's library has nothing for: the nano's empty page */
const none = (key: string, title: string): ScreenEntry => ({ key, title, render: () => <MenuScreen items={[]} empty={'No ' + title} /> });

export const playlists = () => screen('playlists', 'Playlists', 0, (k) => <Playlists keep={k} />);
export const onTheGo = () => screen('onTheGo', 'On-The-Go', 0, (k) => <OnTheGo keep={k} />);
export const artists = () => screen('artists', 'Artists', '', (k) => <Artists keep={k} />);
export const albums = () => screen('albums', 'Albums', 0, (k) => <Albums keep={k} />);
export const songs = () => screen('songs', 'Songs', 0, (k) => <Collection uri={LIKED} keep={k} shuffle={false} />);
export const genres = () => none('genres', 'Genres');
export const composers = () => none('composers', 'Composers');
/** libraryV3 is asked for episodes, but the adapter's list keeps playlists and albums only */
export const audiobooks = () => none('audiobooks', 'Audiobooks');
export const podcasts = () => none('podcasts', 'Podcasts');
export const search = () => screen<Strip>('search', 'Search', STRIP0, (k) => <Search keep={k} />);
export const coverFlow = () => screen('coverFlow', 'Cover Flow', 0, (k) => <CoverFlow keep={k} />);

/** Shuffle Songs: shuffle on, then Liked Songs played whole (one play of the Liked Songs context,
 *  shuffled, from a random song; §4.2, §6 item 3). Only starts playback: the chrome's main menu
 *  pushes Now Playing after calling this. The contract hands it no store: the chrome may pass its
 *  shell's, else it is the page's own (app/mount.tsx sets window.Alchemy.store). */
export function shuffleSongs(_nav: Nav, store = (window.Alchemy as { store?: AppStore } | undefined)?.store): void {
  if (!store) return;
  const { playback, commands } = store.getState();
  if (!playback.shuffle) commands.toggleShuffle();
  commands.playAll(LIKED);
}
