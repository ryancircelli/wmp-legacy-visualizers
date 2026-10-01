// The Library's screens over the Spotify library, in the nano 5G's look (docs/ipod-skin.md §2.4, §4.2):
// the Library as Spotify's Your Library, filter chips over a grid: Playlists (the Queue first, which any
// song's hold-centre > Add to Queue adds to, then Liked Songs), Albums, Artists, Podcasts (empty: the
// adapter lists none); and Search. Lists are the chrome's GridScreen (center fires the tile, hold-center
// its menu, Play/Pause plays it), or its MenuScreen in Settings > General > Library View: List; songs
// are always rows (a playlist's, album's or Liked Songs' under Spotify's header). Search draws itself.
// What a screen comes back to (the selected row, the typed query) is kept on its entry, so it outlives
// the screen's unmount.
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LIKED, type LibraryItem, type SearchResults, type Track } from '../../../../model';
import {
  canSave, isAlbum, STALE, useAddTo, useApp, useArtist, useCollection, useLibraryList, useSearch, useSearchAll, useShell, type Bucket, type Shell,
} from '../../../../ui';
import { CollectionHeader, FilterChips, GridScreen, MenuScreen, Popup, Tile, useNav, useWheel } from '../../ui';
import type { GridItem, HeadAction, MenuItem, Nav, ScreenEntry } from '../contract';
import { LIBRARY_FILTERS, useLibraryFilter, useLibraryView, useMenuVisibility } from '../settings';
import { albumsBy, artistList, artistsOf, az, SLOTS, strip, STRIP0, subline, type Strip, type StripAct } from './logic';

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

/** Settings > General > Library View is Grid: the lists with covers are tiles */
const useGrid = () => useLibraryView()[0] === 'grid';

/** MenuScreen (with `tiles` in the grid view: GridScreen) with the selection kept on the entry; `near`
 *  runs as the selection nears the loaded end; `play` is Play/Pause on a row (the iPod plays it, a
 *  collection whole [UG p.6]); `head`, `lead` and `tall` go to MenuScreen. */
function List({ keep, items, near, loading, empty, play, tiles, head, lead, tall }: {
  keep: Box<number>; items: GridItem[]; near?: () => void; loading?: boolean; empty?: string; play?: (i: number) => void; tiles?: boolean;
  head?: ReactNode; lead?: number; tall?: boolean;
}) {
  const [sel, setSel] = useKept(keep), i = Math.min(sel, items.length - 1), grid = useGrid() && tiles;
  useWheel({ onPlay: play && i >= 0 ? () => play(i) : undefined });
  const p = { items, selected: sel, loading, empty, onSelectedChange: (n: number) => { setSel(n); if (near && n >= items.length - NEAR) near(); } };
  return grid ? <GridScreen {...p} /> : <MenuScreen {...p} head={head} lead={lead} tall={tall} />;
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
/** A page's Shuffle: shuffle on, then a random song of it, in its playlist / album / Liked Songs. */
function shufflePlay(sh: Shell, nav: Nav, rows: readonly Track[]) {
  const s = sh.store.getState(), t = rows[Math.floor(Math.random() * rows.length)];
  if (!t) return;
  if (!s.playback.shuffle) s.commands.toggleShuffle();
  playSong(sh, nav, t);
}

/** a playlist or album: a row that opens its songs, or a tile with its cover and what it is */
const opens = (nav: Nav, x: LibraryItem): GridItem => ({
  id: x.uri, label: x.name, chevron: true, art: x.image, sub: subline(x.uri, x.artist ?? x.owner),
  onSelect: () => nav.push(collection(x.uri, x.name)),
});
/** Liked Songs has no cover: Spotify's own, its gradient and heart */
const LIKED_ART = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#450af5"/>' +
  '<stop offset="1" stop-color="#c4efd9"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/><path fill="#fff" ' +
  'transform="translate(7 7.4) scale(.42)" d="M12 21.6 10.3 20C4.2 14.5 0 10.7 0 6.1 0 2.7 2.7 0 6.1 0 8 0 9.9.9 12 3.1 14.1.9 16 0 17.9 0 21.3 0 24 2.7 24 6.1c0 4.6-4.2 8.4-10.3 13.9z"/></svg>');

// ---- tracks --------------------------------------------------------------------------------------

/** a collection page's header: its uri, cover, title and "<owner or artist> · <n> songs" */
interface Head { uri: string; art?: string | null; title: string; line: string }

/** the playing song's row: a small ▶ at its right */
const PLAYING = <svg viewBox="0 0 8 10" fill="currentColor" style={{ width: u(7), height: u(9) }} role="img" aria-label="Playing"><path d="M0 0l8 5-8 5z" /></svg>;

/** Songs: center plays from that row; hold-center: the song's menu. A playlist's, album's or Liked
 *  Songs' page (`head`) leads with Spotify's header: the cover, Play, Shuffle, the heart and "…"
 *  (Save to Library, Start Radio; hold-centre on a button too), and its songs are two-line rows with
 *  their covers (the collection's when a song has none). */
function TrackList({ keep, rows, loading, more, head }: {
  keep: Box<number>; rows: readonly Track[]; loading: boolean; more?: () => void; head?: Head;
}) {
  const sh = useShell(), nav = useNav(), [held, setHeld] = useState<Held>(null), [menu, setMenu] = useState(false);
  const like = useAddTo(head && canSave(head.uri) ? head.uri : null), playing = useApp((s) => s.playback.track?.uri);
  const open = like.uri ? () => setMenu(true) : undefined;
  const acts: HeadAction[] = head && rows.length ? [
    { id: 'play', kind: 'play', label: 'Play', onSelect: () => playUri(sh, nav, head.uri), onHold: open },
    { id: 'shuffle', kind: 'shuffle', label: 'Shuffle', onSelect: () => shufflePlay(sh, nav, rows), onHold: open },
    ...(like.uri ? [{ id: 'like', kind: 'like' as const, label: like.saved ? 'Unlike' : 'Like', on: !!like.saved, onSelect: like.toggle, onHold: open }] : []),
  ] : [];
  const lead = acts.length;
  const items: GridItem[] = [
    ...acts,
    // index in the id: a playlist can hold the same track twice
    ...rows.map((t, i): GridItem => ({
      id: i + ':' + t.uri, label: t.title, sub: t.artist, art: t.image || t.art || head?.art, right: head && t.uri === playing ? PLAYING : undefined,
      onSelect: () => playSong(sh, nav, t), onHold: () => setHeld({ t }) })),
  ];
  // Play/Pause on the header: Shuffle shuffles, the other buttons play from the top
  const play = (i: number) => (i >= lead ? playSong(sh, nav, rows[i - lead]!) : i === 1 ? shufflePlay(sh, nav, rows) : playUri(sh, nav, head!.uri));
  return (
    <>
      <List keep={keep} items={items} loading={loading} empty="No Songs" near={more} play={held || menu ? undefined : play} lead={lead} tall={!!head}
            head={head && <CollectionHeader art={head.art} title={head.title} line={head.line} actions={acts} onMore={open} />} />
      {held && <TrackPopup held={held} set={setHeld} />}
      {menu && head && <Popup onClose={() => setMenu(false)} items={[
        { id: 'like', label: like.saved ? 'Remove from Library' : 'Save to Library', onSelect: like.toggle },
        { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, head.uri, head.title) },
        { id: 'cancel', label: 'Cancel' },
      ]} />}
    </>
  );
}

/** A playlist, album or Liked Songs (its gradient heart for a cover), paged, under its header. */
function Collection({ uri, title, keep }: { uri: string; title: string; keep: Box<number> }) {
  const c = useCollection(uri), m = c.meta, n = c.total || c.rows.length;
  const by = m?.owner?.name || m?.artists?.map((a) => a.name).join(', ');
  const line = [by, c.loaded ? n.toLocaleString() + (n === 1 ? ' song' : ' songs') : ''].filter(Boolean).join(' · ');
  return <TrackList keep={keep} rows={c.rows} loading={c.loading} more={c.loadMore}
                    head={{ uri, title: m?.name || title, art: uri === LIKED ? LIKED_ART : m?.image, line }} />;
}
export const collection = (uri: string, title: string) =>
  screen('tracks:' + uri, title, 0, (k) => <Collection uri={uri} title={title} keep={k} />);

/** Radio from a song or collection: the station seeded from it, played, then Now Playing; the status
 *  line says when there is none. */
async function startRadio(sh: Shell, nav: Nav, uri: string, title: string, sub = ''): Promise<void> {
  const name = title + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: uri, name, sub }]).catch(() => [])).find((x) => x.name === name);
  const s = sh.store.getState();
  if (!st) { s.actions.setStatus('No radio for ' + title); return; }
  s.commands.playContext(st.uri, null);
  nav.toNowPlaying();
}

/** A song's hold-center menu, and whether it shows the playlists page. */
type Held = { t: Track; lists?: boolean } | null;

/** Hold-center on a song (§3.1): Add to Queue, Like, Add to Playlist (the
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
      { id: 'queue', label: 'Add to Queue', disabled: !queues, onSelect: () => sh.store.getState().commands.addToQueue?.(t.uri) },
      { id: 'like', label: a.saved ? 'Unlike' : 'Like', disabled: !a.uri, onSelect: a.toggle },
      { id: 'add', label: 'Add to Playlist', chevron: true, disabled: !a.uri, onSelect: () => { a.playlistMenu().onOpen?.(); set({ t, lists: true }); } },
      { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, t.uri, t.title, 'Song radio') },
      { id: 'album', label: 'Browse Album', disabled: !album, onSelect: album ? () => nav.push(collection(album, t.album ?? 'Album')) : undefined },
      { id: 'artist', label: 'Browse Artist', disabled: !artist,
        onSelect: artist ? () => nav.push(artistPage(artist, artistsOf([t]).get(artist) ?? t.artist)) : undefined },
      { id: 'cancel', label: 'Cancel' },
    ];
  // keyed: the playlists page opens on its first row
  return <Popup key={lists ? 'lists' : 'track'} items={items} onClose={() => set(null)} />;
}

// ---- the Library: Spotify's Your Library, filter chips over the chosen filter's grid ----------------

/** the chips over a filter's list: its first items, and the head that draws them */
interface Bar { chips: MenuItem[]; head?: ReactNode }

/** A filter's items under the chips: GridScreen (MenuScreen in List view), the selection kept by item
 *  id on the Library's entry (none kept: the first tile, so it never starts on a chip); `play` is
 *  Play/Pause on a tile; `near` runs as the selection nears the loaded end. */
function Filtered({ bar, keep, items, loading, empty, play, near }: {
  bar: Bar; keep: Box<string>; items: GridItem[]; loading?: boolean; empty?: string; play?: (it: GridItem) => void; near?: () => void;
}) {
  const [id, setId] = useKept(keep), all = [...bar.chips, ...items], lead = bar.chips.length;
  const found = all.findIndex((x) => x.id === id), sel = found < 0 ? lead : found, it = sel >= lead ? all[sel] : undefined;
  useWheel({ onPlay: play && it ? () => play(it) : undefined });
  const p = { items: all, selected: sel, loading, empty, head: bar.head, lead,
              onSelectedChange: (n: number) => { setId(all[n]!.id); if (near && n >= all.length - NEAR) near(); } };
  return useGrid() ? <GridScreen {...p} /> : <MenuScreen {...p} />;
}

type Body = (p: { bar: Bar; keep: Box<string> }) => ReactNode;

/** The Queue (§6 item 7), then Liked Songs (where Spotify pins it), then the library's
 *  playlists in library order. */
const Playlists: Body = ({ bar, keep }) => {
  const sh = useShell(), nav = useNav(), lib = useLibraryList(), liked = useCollection(LIKED), next = useApp((s) => s.queue.next[0]);
  const items: GridItem[] = [
    // the Queue's tile: the next song's cover
    { id: 'queue', label: 'Queue', chevron: true, art: next?.art || next?.image, sub: 'Up next', onSelect: () => nav.push(onTheGo()) },
    { ...opens(nav, { uri: LIKED, name: 'Liked Songs' }), art: LIKED_ART,
      sub: liked.loaded ? 'Playlist · ' + liked.total.toLocaleString() + (liked.total === 1 ? ' song' : ' songs') : 'Playlist' },
    ...lib.items.filter((x) => !isAlbum(x.uri)).map((x) => opens(nav, x)),
  ];
  // Play/Pause on the Queue is the plain play/pause: the queue is already what plays next
  return <Filtered bar={bar} keep={keep} items={items} loading={lib.loading} play={(it) => { if (it.id !== 'queue') playUri(sh, nav, it.id); }} />;
};

/** The Queue: what Spotify plays next; a song joins it from any list's hold-centre > Add to Queue,
 *  and shows here with the player's next state. */
function OnTheGo({ keep }: { keep: Box<number> }) {
  const rows = useApp((s) => s.queue.next);
  return <TrackList keep={keep} rows={rows} loading={false} />;
}
const onTheGo = () => screen('onTheGo', 'Queue', 0, (k) => <OnTheGo keep={k} />);

/** Saved albums, A–Z (§6 item 11). */
const Albums: Body = ({ bar, keep }) => {
  const sh = useShell(), nav = useNav(), lib = useLibraryList();
  const items = lib.items.filter((x) => isAlbum(x.uri)).sort((a, b) => az(a.name, b.name)).map((x) => opens(nav, x));
  return <Filtered bar={bar} keep={keep} items={items} loading={lib.loading} empty="No Albums" play={(it) => playUri(sh, nav, it.id)} />;
};

/** Followed artists (Your Library > Artists) in Spotify's order; none under the local engine. */
function useFollowedArtists(): { items: LibraryItem[]; loading: boolean } {
  const q = useShell().queries, on = useApp((s) => s.auth.loggedIn === true);
  const r = useQuery({ queryKey: q.keys.followedArtists(), queryFn: q.fetchFollowedArtists, enabled: on, staleTime: STALE.list });
  return { items: r.data ?? [], loading: on && r.isPending };
}

/** The followed artists, A–Z; with none, the liked songs' and saved albums' artists (§6 item 1), kept
 *  by artist (Filtered) as later pages of liked songs land in between.
 *  ponytail: the fallback's complete A–Z needs every liked page; they load as the selection nears the end. */
const Artists: Body = ({ bar, keep }) => {
  const sh = useShell(), nav = useNav(), followed = useFollowedArtists(), liked = useCollection(LIKED), lib = useLibraryList();
  const derived = !followed.loading && !followed.items.length;
  const list = followed.loading ? [] : derived ? artistList(artistsOf(liked.rows), lib.items.filter((x) => isAlbum(x.uri)))
    : followed.items.map((x) => ({ key: x.uri, name: x.name, uri: x.uri, image: x.image })).sort((a, b) => az(a.name, b.name));
  // an artist known by uri plays (their context); one known only by a saved album's credit does not
  const items = list.map((x): GridItem => ({
    id: x.key, label: x.name, chevron: true, art: x.image, sub: 'Artist', onSelect: () => nav.push(x.uri ? artistPage(x.uri, x.name) : savedArtist(x.name)) }));
  return <Filtered bar={bar} keep={keep} items={items} loading={followed.loading || (!items.length && (liked.loading || lib.loading))} empty="No Artists"
                   play={(it) => { if (it.id.startsWith('spotify:')) playUri(sh, nav, it.id); }} near={derived ? liked.loadMore : undefined} />;
};

/** libraryV3 is asked for episodes, but the adapter's list keeps playlists and albums only */
const Podcasts: Body = ({ bar, keep }) => <Filtered bar={bar} keep={keep} items={[]} empty="No Podcasts" />;

const BODIES: Record<string, Body> = { playlists: Playlists, albums: Albums, artists: Artists, podcasts: Podcasts };

/** The chips Settings > General > Library Filters shows ('ipod.libraryFilter' the chosen one, filled)
 *  over its filter's list. Picking a chip (the centre on it, or a tap) switches the list and puts the
 *  selection on its first tile. */
function Library({ keeps }: { keeps: Record<string, Box<string>> }) {
  const [chosen, choose] = useLibraryFilter(), shown = useMenuVisibility().music, [n, setN] = useState(0);
  const filters = LIBRARY_FILTERS.filter(([id]) => shown[id] !== false);
  const f = filters.some(([id]) => id === chosen) ? chosen : filters[0]?.[0] ?? 'playlists';
  const chips = filters.map(([id, label]): MenuItem => ({ id: 'chip:' + id, label, onSelect: () => { keeps[id]!.set(''); choose(id); setN(n + 1); } }));
  const View = BODIES[f]!;
  // keyed by the pick: a fresh list, from its first tile
  return <View key={f + n} bar={{ chips, head: chips.length ? <FilterChips chips={chips} active={'chip:' + f} /> : undefined }} keep={keeps[f]!} />;
}

/** An artist: All Songs (their top songs; played in the artist's context) then the discography.
 *  Spotify's rows carry no album / single type, so albums and singles are one list. */
function ArtistPage({ uri, name, keep }: { uri: string; name: string; keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), { page, loading } = useArtist(uri);
  const items: GridItem[] = page ? [
    { id: uri, label: 'All Songs', chevron: true, art: page.meta.image, sub: 'Top songs', onSelect: () => nav.push(artistAll(uri, page.meta.name || name)) },
    ...page.albums.map((x) => opens(nav, x)),
  ] : [];
  return <List keep={keep} items={items} loading={loading} empty="No Albums" tiles play={(i) => playUri(sh, nav, items[i]!.id)} />;
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
  return <List keep={keep} items={items} loading={lib.loading} empty="No Albums" tiles play={(i) => playUri(sh, nav, items[i]!.id)} />;
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

/** `sub`: a row's dim right side; `art` and `line`: an artist's, album's or playlist's tile in the grid view */
interface Hit { key: string; kind?: Kind; label: string; sub?: string; art?: string; line?: string; track?: Track; open: () => void; play?: () => void }

function hit(kind: Kind, x: Track | LibraryItem, nav: Nav, sh: Shell): Omit<Hit, 'key'> {
  if (kind === 'song') {
    const t = x as Track;
    return { kind, label: t.title, sub: t.artist, track: t, open: () => playSong(sh, nav, t), play: () => playSong(sh, nav, t) };
  }
  const c = x as LibraryItem;
  const open = kind === 'artist' ? () => nav.push(artistPage(c.uri, c.name)) : () => nav.push(collection(c.uri, c.name));
  return { kind, label: c.name, sub: kind === 'artist' ? undefined : c.artist ?? c.owner, art: c.image, line: subline(c.uri, c.artist ?? c.owner),
           open, play: () => playUri(sh, nav, c.uri) };
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
// a row spans the grid view's two columns
const LINE: CSSProperties = { display: 'flex', alignItems: 'center', gap: u(6), height: ROW, padding: `0 ${u(9)} 0 ${u(10)}`, whiteSpace: 'nowrap', gridColumn: '1 / -1' };
const TILES: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignContent: 'start' };

/** Results above, the picker band below: the typed query over the letter strip, the current letter
 *  in a centred blue box. In the grid view the artists, albums and playlists are tiles, two across,
 *  between the song rows; the wheel still steps one result at a time. Wheel: the letter (in the results: the row); center: types it (opens the
 *  row); ⏭ a space, ⏮ deletes; MENU: to the results once something was typed, back to the picker,
 *  then out. Each typed character searches (§4.5). */
function Search({ keep }: { keep: Box<Strip> }) {
  const sh = useShell(), nav = useNav(), [s, setS] = useKept(keep), list = useRef<HTMLDivElement>(null), grid = useGrid();
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
      <div ref={list} className="relative flex-auto min-h-0 overflow-hidden" style={{ fontSize: u(18), fontWeight: 'bold', ...(grid ? TILES : {}) }}>
        {note ? <div style={{ ...LINE, color: '#8e8e93' }}>{note}</div> : hits.map((x, i) => {
          const tap = () => { setS({ ...s, row: i, typed: false }); x.open(); };
          return grid && x.line != null ? <Tile key={x.key} item={{ id: x.key, label: x.label, sub: x.line, art: x.art }} selected={i === row} onClick={tap} /> : (
          <div key={x.key} onClick={tap} style={{ ...LINE, ...(i === row ? SEL : {}) }}>
            <svg viewBox="0 0 12 12" fill="currentColor" style={{ flex: 'none', width: u(12), height: u(12) }} aria-hidden="true">
              {x.kind && GLYPH[x.kind]}
            </svg>
            <span className="truncate">{x.label}</span>
            {x.sub && <span className="truncate" style={{ flex: 'none', maxWidth: '45%', fontSize: u(13), fontWeight: 'normal', color: i === row ? 'inherit' : DIM }}>{x.sub}</span>}
          </div>
        ); })}
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
  const items = hits.map((x, i): GridItem => ({ id: String(i), label: x.label, chevron: kind !== 'song', art: x.art, sub: x.line, onSelect: x.open,
                                                onHold: x.track ? () => setHeld({ t: x.track! }) : undefined }));
  return (
    <>
      <List keep={keep} items={items} loading={r.loading && !items.length} empty="No Results" near={r.loadMore} tiles={kind !== 'song'}
            play={held ? undefined : (i) => hits[i]?.play?.()} />
      {held && <TrackPopup held={held} set={setHeld} />}
    </>
  );
}
const more = (q: string, b: Bucket, kind: Kind, title: string) =>
  screen('search:' + b, title, 0, (k) => <More q={q} bucket={b} kind={kind} keep={k} />);

// ---- the factories (src/skins/ipod/screens/contract.ts Screens) -----------------------------------

export function library(): ScreenEntry {
  const keeps = Object.fromEntries(LIBRARY_FILTERS.map(([id]) => [id, box('')]));
  return { key: 'library', title: 'Library', render: () => <Library keeps={keeps} /> };
}
export const search = () => screen<Strip>('search', 'Search', STRIP0, (k) => <Search keep={k} />);
