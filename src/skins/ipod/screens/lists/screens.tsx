// The Library's screens over the Spotify library, in the nano 5G's look (docs/ipod-skin.md §2.4, §4.2):
// the Library as Spotify's Your Library, filter chips over a grid: Playlists (the Queue first, which any
// song's hold-centre > Add to Queue adds to and whose rows' hold-centre moves or removes them, then
// Recently Played while the home feed has it, then Liked Songs, then New Playlist…), Albums, Artists, Podcasts
// (the followed shows, each to its episodes, whose hold-centre marks one played or unplayed); and Search.
// Lists are the chrome's GridScreen (center fires the tile, hold-center
// its menu, Play/Pause plays it), or its MenuScreen in Settings > General > Library View: List; songs
// are always rows (a playlist's, album's or Liked Songs' under Spotify's header). Search draws itself.
// What a screen comes back to (the selected row, the typed query) is kept on its entry, so it outlives
// the screen's unmount.
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LIKED, type LibraryItem, type SearchResults, type Track } from '../../../../model';
import {
  bigCover, canSave, isAlbum, STALE, useAddTo, useApp, useArtist, useCollection, useDebounced, useLibraryList, useRecentlyPlayed, useSearch, useSearchAll, useShell,
  useShows, type Bucket, type Shell,
} from '../../../../ui';
import { CollectionHeader, cycleShuffle, FilterChips, GridScreen, MenuScreen, Popup, Tile, useNav, useWheel } from '../../ui';
import type { GridItem, HeadAction, MenuItem, Nav, ScreenEntry } from '../contract';
import { confirm, LIBRARY_FILTERS, useLibraryFilter, useLibraryView, useMenuVisibility } from '../settings';
import { albumsBy, artistList, artistsOf, az, episodeLine, queueEdit, subline, type QueueEdit } from './logic';

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
/** Play a collection from its top (an artist or a show: their context), then Now Playing (§4.1). */
function playUri(sh: Shell, nav: Nav, uri: string) {
  const c = sh.store.getState().commands;
  if (/^spotify:(artist|show):/.test(uri)) c.playContext(uri, null); else c.playAll(uri);
  nav.toNowPlaying();
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
/** a row that acts rather than opens (New Playlist…, Clear Queue): the ♪ tile's grey with a white glyph */
const glyphArt = (d: string) => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#D6D6DA"/>' +
  '<stop offset="1" stop-color="#B2B2B8"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/>' +
  `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`);
const NEW_ART = glyphArt('M12 6.5v11M6.5 12h11'), CLEAR_ART = glyphArt('M8 8l8 8M16 8l-8 8');

/** New Playlist… (commands.createPlaylist): the name asked in the platform's own dialog (the iPod has no
 *  text field; window.prompt is the iOS app's system alert with one), then the new playlist opened, empty;
 *  Cancel or no name makes none */
async function newPlaylist(sh: Shell, nav: Nav) {
  const name = window.prompt('New Playlist', '')?.trim();
  const uri = name && await sh.store.getState().commands.createPlaylist?.(name);
  if (uri) nav.push(collection(uri, name));
}

// ---- tracks --------------------------------------------------------------------------------------

/** a collection page's header: its uri, cover, title and "<owner or artist> · <n> songs"; `saved`: in
 *  the library (undefined: ask), `own`: a playlist the user can edit (theirs: saved, never removed) */
interface Head { uri: string; art?: string | null; title: string; line: string; saved?: boolean; own?: boolean }

/** the playing song's row: a small ▶ at its right */
const PLAYING = <svg viewBox="0 0 8 10" fill="currentColor" style={{ width: u(7), height: u(9) }} role="img" aria-label="Playing"><path d="M0 0l8 5-8 5z" /></svg>;

/** Songs: center plays from that row; hold-center: the song's menu. A playlist's, album's or Liked
 *  Songs' page (`head`) leads with Spotify's header: the cover, Play (Pause while it is what plays:
 *  then it pauses / resumes), the Shuffle toggle (Spotify's shuffle, as the status row's), the heart
 *  and "…" (Save to Library, Start Radio; hold-centre on a button too), and its songs are two-line
 *  rows with their covers (the collection's when a song has none), as `tall` asks for without one.
 *  `edit`: a row's hold-centre is this menu (the Queue's) instead of the song's; `tail`: rows after the songs
 *  (the Queue's Clear Queue). The "…" menu of the user's own playlist has Delete Playlist (a red confirm). */
function TrackList({ keep, rows, loading, more, head, tall = !!head, edit, tail = [] }: {
  keep: Box<number>; rows: readonly Track[]; loading: boolean; more?: () => void; head?: Head; tall?: boolean; edit?: (i: number) => MenuItem[];
  tail?: GridItem[];
}) {
  const sh = useShell(), nav = useNav(), [held, setHeld] = useState<Held>(null), [menu, setMenu] = useState(false);
  const like = useAddTo(head && canSave(head.uri) ? head.uri : null, head?.saved), playing = useApp((s) => s.playback.track?.uri);
  const here = useApp((s) => !!head && s.playback.context?.uri === head.uri), paused = useApp((s) => s.playback.paused);
  const shuffle = useApp((s) => s.playback.shuffle), smart = useApp((s) => s.playback.shuffleMode === 'smart'), c = () => sh.store.getState().commands;
  const deletes = useApp((s) => !!s.commands.deletePlaylist) && !!head?.own && !!head.uri.startsWith('spotify:playlist:');
  const open = like.uri ? () => setMenu(true) : undefined;
  // the playing context: pause / resume it, not again from the top
  const start = () => (here ? void c().playPause() : playUri(sh, nav, head!.uri));
  const acts: HeadAction[] = head && rows.length ? [
    { id: 'play', kind: 'play', label: here && !paused ? 'Pause' : 'Play', on: here && !paused, onSelect: start, onHold: open },
    { id: 'shuffle', kind: smart ? 'smart' : 'shuffle', label: smart ? 'Smart Shuffle' : 'Shuffle', on: shuffle, onSelect: () => cycleShuffle(sh.store), onHold: open },
    ...(like.uri ? [head.own ? { id: 'like', kind: 'like' as const, label: 'Saved', on: true, onHold: open }
      : { id: 'like', kind: 'like' as const, label: like.saved ? 'Unlike' : 'Like', on: !!like.saved, onSelect: like.toggle, onHold: open }] : []),
  ] : [];
  const lead = acts.length;
  const items: GridItem[] = [
    ...acts,
    // index in the id: a playlist can hold the same track twice
    ...rows.map((t, i): GridItem => ({
      id: i + ':' + t.uri, label: t.title, sub: t.artist, art: t.image || t.art || head?.art, right: head && t.uri === playing ? PLAYING : undefined,
      onSelect: () => playSong(sh, nav, t), onHold: () => setHeld({ t, i }) })),
    ...tail,
  ];
  // Play/Pause on the header: the green button's; on a tail row, nothing
  const play = (i: number) => { const r = rows[i - lead]; if (i < lead) start(); else if (r) playSong(sh, nav, r); };
  return (
    <>
      <List keep={keep} items={items} loading={loading} empty="No Songs" near={more} play={held || menu ? undefined : play} lead={lead} tall={tall}
            head={head && <CollectionHeader art={head.art} title={head.title} line={head.line} actions={acts} onMore={open} />} />
      {held && (edit && held.i != null ? <Popup items={edit(held.i)} onClose={() => setHeld(null)} /> : <TrackPopup held={held} set={setHeld} />)}
      {menu && head && <Popup onClose={() => setMenu(false)} items={[
        ...(head.own ? [] : [{ id: 'like', label: like.saved ? 'Remove from Library' : 'Save to Library', onSelect: like.toggle }]),
        { id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, head.uri, head.title) },
        // the confirm opens on Cancel; Delete leaves it and this page (gone from the library), then asks Spotify
        ...(deletes ? [{ id: 'delete', label: 'Delete Playlist', onSelect: () => nav.push(confirm('delete:' + head.uri, head.title, 'Delete Playlist',
          (n) => { n.pop(); n.pop(); void c().deletePlaylist?.(head.uri); })) }] : []),
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
  // Saved, as WMP 9's Details pane has it: areEntitiesInLibrary never answers a playlist, so a Like just
  // made, then the collection's own flag, then whether the library list holds it (the user's playlists,
  // the ones they follow, saved albums). One they can edit is theirs (or one they collaborate on).
  const lib = useLibraryList(), listed = lib.items.find((x) => x.uri === uri), opt = useApp((s) => s.saved[uri]);
  const saved = opt ?? m?.saved ?? m?.following ?? (lib.loading ? undefined : !!listed);
  return <TrackList keep={keep} rows={c.rows} loading={c.loading} more={c.loadMore}
                    head={{ uri, title: m?.name || title, art: uri === LIKED ? LIKED_ART : m?.image, line, saved, own: !!listed?.editable }} />;
}
export const collection = (uri: string, title: string) =>
  screen('tracks:' + uri, title, 0, (k) => <Collection uri={uri} title={title} keep={k} />);

/** Radio from a song or collection: the station seeded from it, played, then Now Playing; the status
 *  line says when there is none. */
export async function startRadio(sh: Shell, nav: Nav, uri: string, title: string, sub = ''): Promise<void> {
  const name = title + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: uri, name, sub }]).catch(() => [])).find((x) => x.name === name);
  const s = sh.store.getState();
  if (!st) { s.actions.setStatus('No radio for ' + title); return; }
  s.commands.playContext(st.uri, null);
  nav.toNowPlaying();
}

/** A song's hold-center menu, and whether it shows the playlists page; `i`: its row. */
type Held = { t: Track; lists?: boolean; i?: number } | null;

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

/** The Queue (§6 item 7), then Recently Played (while the home feed has it), then Liked Songs (where
 *  Spotify pins it), then the library's playlists in library order. */
const Playlists: Body = ({ bar, keep }) => {
  const sh = useShell(), nav = useNav(), lib = useLibraryList(), liked = useCollection(LIKED), next = useApp((s) => s.queue.next[0]);
  const recent = useRecentlyPlayed().items, creates = useApp((s) => !!s.commands.createPlaylist);
  const items: GridItem[] = [
    // the Queue's tile: the next song's cover, at 640 px (its row carries the 64 px thumbnail)
    { id: 'queue', label: 'Queue', chevron: true, art: bigCover(next?.art || next?.image), sub: 'Up next', onSelect: () => nav.push(onTheGo()) },
    ...(recent.length ? [{ id: 'recent', label: 'Recently Played', chevron: true, art: recent[0]!.img, sub: 'Jump back in', onSelect: () => nav.push(recentlyPlayed()) }] : []),
    { ...opens(nav, { uri: LIKED, name: 'Liked Songs' }), art: LIKED_ART,
      sub: liked.loaded ? 'Playlist · ' + liked.total.toLocaleString() + (liked.total === 1 ? ' song' : ' songs') : 'Playlist' },
    // over the playlists, where Spotify puts a new one (the top of the library)
    ...(creates ? [{ id: 'new', label: 'New Playlist…', art: NEW_ART, onSelect: () => void newPlaylist(sh, nav) }] : []),
    ...lib.items.filter((x) => !isAlbum(x.uri)).map((x) => opens(nav, x)),
  ];
  // Play/Pause on the Queue is the plain play/pause: the queue is already what plays next; on Recently Played, nothing
  return <Filtered bar={bar} keep={keep} items={items} loading={lib.loading} play={(it) => { if (it.id.startsWith('spotify:')) playUri(sh, nav, it.id); }} />;
};

/** The Queue: what Spotify plays next; a song joins it from any list's hold-centre > Add to Queue,
 *  and shows here with the player's next state. Hold-centre on a row: Play Next, Move Up, Move Down,
 *  Remove from Queue, Cancel (the engine's reorderQueue: Connect's set_queue, queued and context rows
 *  alike); the selection follows the row it moved. Without reorderQueue (the local engine), the song's menu.
 *  While the user has queued songs (Track.queued), a last row Clear Queue (the nano's On-The-Go > Clear
 *  Playlist; its red confirm): commands.clearQueue, the context's own upcoming songs left. */
function OnTheGo({ keep }: { keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), rows = useApp((s) => s.queue.next), edits = useApp((s) => !!s.commands.reorderQueue), [rev, setRev] = useState(0);
  const clears = useApp((s) => !!s.commands.clearQueue) && rows.some((t) => t.queued);
  const tail: GridItem[] = clears ? [{ id: 'clear', label: 'Clear Queue', art: CLEAR_ART, onSelect: () => nav.push(confirm('onTheGo/clear', 'Clear Queue', 'Clear Queue',
    (n) => { n.pop(); void sh.store.getState().commands.clearQueue?.(); })) }] : [];
  const edit = (i: number): MenuItem[] => {
    const item = (id: QueueEdit, label: string): MenuItem => {
      const r = queueEdit(rows.length, i, id);
      return { id, label, disabled: !r, onSelect: r ? () => { sh.store.getState().commands.reorderQueue?.(r.order); keep.set(r.at); setRev(rev + 1); } : undefined };
    };
    return [item('next', 'Play Next'), item('up', 'Move Up'), item('down', 'Move Down'), item('remove', 'Remove from Queue'), { id: 'cancel', label: 'Cancel' }];
  };
  // keyed: a fresh list after an edit, its selection where keep now says
  return <TrackList key={rev} keep={keep} rows={rows} loading={false} tall edit={edits ? edit : undefined} tail={tail} />;
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

/** The followed shows in Spotify's order; a show opens to its episodes, Play/Pause plays it. */
const Podcasts: Body = ({ bar, keep }) => {
  const sh = useShell(), nav = useNav(), shows = useShows();
  const items = shows.items.map((x): GridItem => ({ id: x.uri, label: x.name, chevron: true, art: x.image, sub: subline(x.uri), onSelect: () => nav.push(showPage(x.uri, x.name)) }));
  return <Filtered bar={bar} keep={keep} items={items} loading={shows.loading} empty="No Podcasts" play={(it) => playUri(sh, nav, it.id)} />;
};

/** the blue dot of an episode not yet played [UG p.47]: the row value's blue, white on the selection */
const UNPLAYED = <svg viewBox="0 0 8 8" fill="currentColor" style={{ width: u(8), height: u(8) }} role="img" aria-label="Unplayed"><circle cx="4" cy="4" r="4" /></svg>;

/** An episode's Mark as Played / Mark as Unplayed (commands.markPlayed; none without it, or for a song): the
 *  blue dot follows at once. Both, as Spotify's played state does not tell a started episode from a finished
 *  one; dimmed is what is already so: Played once marked here, Unplayed while the dot shows. */
export function useEpisodeMarks(): (t: Track | null | undefined) => MenuItem[] {
  const sh = useShell(), on = useApp((s) => !!s.commands.markPlayed), played = useApp((s) => s.played);
  const mark = (uri: string, p: boolean) => () => void sh.store.getState().commands.markPlayed?.(uri, p);
  return (t) => (!on || !t?.uri.startsWith('spotify:episode:') ? [] : [
    { id: 'played', label: 'Mark as Played', disabled: played[t.uri] === true, onSelect: mark(t.uri, true) },
    { id: 'unplayed', label: 'Mark as Unplayed', disabled: !!t.unplayed, onSelect: mark(t.uri, false) },
  ]);
}

/** A show's episodes, newest first [UG p.47]: two-line rows (the title; its date · length), the blue dot
 *  where Spotify says it is unplayed; centre (or Play/Pause) plays it in its show, then Now Playing;
 *  hold-centre: Mark as Played / Unplayed (useEpisodeMarks).
 *  ponytail: sorts what is loaded, so a show Spotify lists oldest first gets its newest as pages arrive. */
function Show({ uri, keep }: { uri: string; keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), c = useCollection(uri), art = useShows().items.find((x) => x.uri === uri)?.image;
  const marks = useEpisodeMarks(), [held, setHeld] = useState<Track | null>(null);
  const rows = [...c.rows].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  const items = rows.map((t, i): GridItem => ({ id: i + ':' + t.uri, label: t.title, sub: episodeLine(t.releaseDate, t.duration), art: t.image || t.art || art,
                                                right: t.unplayed ? UNPLAYED : undefined, onSelect: () => playSong(sh, nav, t),
                                                onHold: marks(t).length ? () => setHeld(t) : undefined }));
  // the held row as it is now (its dot), not as it was when held
  const now = held && (rows.find((x) => x.uri === held.uri) ?? held);
  return (
    <>
      <List keep={keep} items={items} loading={c.loading} empty="No Episodes" near={c.loadMore} tall play={held ? undefined : (i) => playSong(sh, nav, rows[i]!)} />
      {now && <Popup items={[...marks(now), { id: 'cancel', label: 'Cancel' }]} onClose={() => setHeld(null)} />}
    </>
  );
}
const showPage = (uri: string, title: string) => screen('show:' + uri, title, 0, (k) => <Show uri={uri} keep={k} />);

/** Recently played playlists, albums, artists and shows (the home feed's shelves for them), each opening
 *  as its Library tile does; Play/Pause plays it. */
function Recent({ keep }: { keep: Box<number> }) {
  const sh = useShell(), nav = useNav(), r = useRecentlyPlayed();
  const open = (uri: string, name: string) =>
    uri.startsWith('spotify:artist:') ? artistPage(uri, name) : uri.startsWith('spotify:show:') ? showPage(uri, name) : collection(uri, name);
  const items = r.items.map((x): GridItem => ({ id: x.uri, label: x.name, chevron: true, art: x.img, sub: subline(x.uri, x.sub), onSelect: () => nav.push(open(x.uri, x.name)) }));
  return <List keep={keep} items={items} loading={r.loading} empty="Nothing Played Lately" tiles play={(i) => playUri(sh, nav, items[i]!.id)} />;
}
const recentlyPlayed = () => screen('recent', 'Recently Played', 0, (k) => <Recent keep={k} />);

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

// a row spans the grid view's two columns
const LINE: CSSProperties = { display: 'flex', alignItems: 'center', gap: u(6), height: ROW, padding: `0 ${u(9)} 0 ${u(10)}`, whiteSpace: 'nowrap', gridColumn: '1 / -1' };
const TILES: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignContent: 'start' };

/** What Search comes back to: the typed text and the wheel's place (0: the field, 1..: the results). */
interface Find { q: string; row: number }

/** The search field over the results, the phone's keyboard to type in. A tap on the field, or the
 *  centre on it (the wheel's first place), focuses it and so opens the keyboard; typing searches after
 *  the 400 ms debounce; the keyboard's Search (Enter) searches at once, closes it and selects the first
 *  result; × clears. Unfocused, the wheel walks the field then the results, centre opens one; MENU
 *  (Escape) while typing closes the keyboard, then goes back. In the grid view the artists, albums and
 *  playlists are tiles, two across, between the song rows; the wheel still steps one result at a time. */
function Search({ keep }: { keep: Box<Find> }) {
  const sh = useShell(), nav = useNav(), [s, setS] = useKept(keep), [q, setQ] = useState(s.q), run = useDebounced(setQ);
  const list = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null), grid = useGrid();
  const { results, loading } = useSearchAll(q), [held, setHeld] = useState<Held>(null);
  const hits = hitsOf(results, q.trim(), nav, sh), row = Math.min(s.row, hits.length), h = hits[row - 1];
  // the shadow root's activeElement under Spotify, the document's standalone
  const typing = () => { const f = field.current; return !!f && (f.getRootNode() as Document | ShadowRoot).activeElement === f; };
  // the selected result in view (the field: the list's top), scrolling the list only (never the page around it)
  useLayoutEffect(() => {
    const l = list.current, el = l?.children[row - 1] as HTMLElement | undefined;
    if (!l) return;
    if (!el) l.scrollTop = 0;
    else if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
  }, [row]);
  useWheel(held ? {} : {
    // from the kept place: several detents can land before a re-render; false when nothing moved (no click)
    onTick: (dir) => { const at = Math.min(keep.get().row, hits.length), n = Math.max(0, Math.min(hits.length, at + dir)); if (n === at) return false; setS({ ...keep.get(), row: n }); },
    onCenter: () => (h ? h.open() : field.current?.focus()),
    onHoldCenter: h?.track ? () => setHeld({ t: h.track! }) : undefined,
    onMenu: () => { if (!typing()) return; field.current!.blur(); return true; },
    onPlay: h?.play,
  });
  const note = loading ? 'Loading…' : q.trim() && !hits.length ? 'No Results' : null;
  return (
    <div className="flex flex-col h-full min-h-0" style={{ color: TEXT }}>
      <div className="flex-none" style={{ padding: u(6), background: 'linear-gradient(#FDFDFD, #E6E6E6 50%, #D0D0D0 51%, #E4E4E4)', borderBottom: `${u(1)} solid #5A5F64` }}>
        {/* the iPod's search field: a white pill, the magnifier, ringed blue while the wheel is on it */}
        <label className="flex items-center" style={{ height: u(26), gap: u(5), padding: `0 ${u(5)} 0 ${u(8)}`, borderRadius: u(13), background: '#fff',
                                                      border: `${u(1)} solid #5A5F64`, color: DIM,
                                                      boxShadow: row === 0 ? `0 0 0 ${u(2)} #3F7FCD` : `inset 0 ${u(1)} ${u(2)} rgb(0 0 0 / .25)` }}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: 'none', width: u(12), height: u(12) }} aria-hidden="true">
            <circle cx="5" cy="5" r="3.8" /><path d="M7.8 7.8 11.3 11.3" />
          </svg>
          {/* 16 px at least: iOS zooms the page into a smaller field */}
          <input ref={field} type="search" inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                 placeholder="Search" aria-label="Search" value={s.q}
                 className="flex-auto min-w-0 appearance-none [&::-webkit-search-cancel-button]:appearance-none"
                 style={{ border: 0, padding: 0, outline: 'none', background: 'transparent', color: TEXT, fontSize: `max(16px, ${u(14)})`, fontWeight: 'normal' }}
                 onFocus={() => setS({ ...keep.get(), row: 0 })}
                 onChange={(e) => { setS({ q: e.currentTarget.value, row: 0 }); run(e.currentTarget.value); }}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run.now(s.q); e.currentTarget.blur(); setS({ ...s, row: 1 }); }
                   // the page's Escape (leave full screen) is not this one's
                   else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
                 }} />
          {s.q && (
            <button type="button" aria-label="Clear" onClick={() => { setS({ q: '', row: 0 }); run.now(''); field.current?.focus(); }}
                    className="grid place-items-center" style={{ flex: 'none', width: u(16), height: u(16), padding: 0, border: 0, borderRadius: '50%', background: '#B4B4B8', color: '#fff' }}>
              <svg viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.6" style={{ width: u(7), height: u(7) }} aria-hidden="true"><path d="M1 1l6 6M7 1 1 7" /></svg>
            </button>
          )}
        </label>
      </div>
      <div ref={list} className="relative flex-auto min-h-0 overflow-hidden" role="listbox" style={{ fontSize: u(18), fontWeight: 'bold', ...(grid ? TILES : {}) }}>
        {note ? <div style={{ ...LINE, color: '#8e8e93' }}>{note}</div> : hits.map((x, i) => {
          const tap = () => { setS({ ...s, row: i + 1 }); x.open(); };
          return grid && x.line != null ? <Tile key={x.key} item={{ id: x.key, label: x.label, sub: x.line, art: x.art }} selected={i + 1 === row} onClick={tap} /> : (
          <div key={x.key} onClick={tap} role="option" aria-selected={i + 1 === row} style={{ ...LINE, ...(i + 1 === row ? SEL : {}) }}>
            <svg viewBox="0 0 12 12" fill="currentColor" style={{ flex: 'none', width: u(12), height: u(12) }} aria-hidden="true">
              {x.kind && GLYPH[x.kind]}
            </svg>
            <span className="truncate">{x.label}</span>
            {x.sub && <span className="truncate" style={{ flex: 'none', maxWidth: '45%', fontSize: u(13), fontWeight: 'normal', color: i + 1 === row ? 'inherit' : DIM }}>{x.sub}</span>}
          </div>
        ); })}
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
export const search = () => screen<Find>('search', 'Search', { q: '', row: 0 }, (k) => <Search keep={k} />);
