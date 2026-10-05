// What a source shows, as data both layouts render: a list of songs (Music, a playlist, an album, a
// show's episodes, iTunes DJ, Genius), a field of covers (Podcasts, the store's front page, Genius
// Mixes, Recently Played), an artist (top songs and albums), the radio stations, a device, or the
// search results. `opened` is what was opened inside the source (state.ts stack), which shows in its
// place. Every fetch is a query (src/ui/data.ts); the ones only some sources need are asked only there.
import { useQuery } from '@tanstack/react-query';
import { LIKED, type HomeItem, type LibraryItem, type Station, type Track } from '../../../model';
import {
  isAlbum, isCollectionUri, STALE, useApp, useArtist, useCollection, useHome, useLibraryList, useRadioSeeds, useRecentlyPlayed, useShell,
  type Shell, type TileItem, type TileSection,
} from '../../../ui';
import type { Source } from './sources';
import { viewActions } from './state';

export interface TracksContent {
  kind: 'tracks'; title: string;
  /** the context a row plays in (null: each row's own, as the queue's) */
  ctx: string | null;
  tracks: Track[]; total: number; loading: boolean;
  /** the next page, while there is one */
  more: (() => void) | null;
  image?: string | null;
  /** a line under the title (Genius: what it is based on; an album: its artist) */
  sub?: string;
  /** iTunes DJ: the rows are Up Next (reorder and remove through commands.reorderQueue) */
  queue?: boolean;
  /** Music's Grid: the saved albums and the followed artists instead of the songs' albums */
  browse?: { albums: TileItem[]; artists: TileItem[] };
  empty: string;
}
export interface TilesContent { kind: 'tiles'; title: string; sections: TileSection[]; loading: boolean; empty: string }
export interface ArtistContent { kind: 'artist'; title: string; ctx: string; tracks: Track[]; albums: TileItem[]; loading: boolean; image?: string | null }
export interface StationsContent { kind: 'stations'; title: string; stations: Station[] | null }
export interface SearchContent { kind: 'search'; title: string }
export interface NoContent { kind: 'none'; title: string; note: string }
export type Content = TracksContent | TilesContent | ArtistContent | StationsContent | SearchContent | NoContent;

const KIND = /^spotify:(playlist|album|artist|show):|^spotify:collection:tracks$/;
/** a tile that opens a page of its own (a playlist, album, artist, show, Liked Songs); a track tile plays */
export const opensPage = (uri: string) => KIND.test(uri);
/** Spotify's made-for-you mixes on the home feed (Daily Mix, Discover Weekly, Release Radar, daylist, …) */
const MIX = /mix|discover weekly|release radar|daylist|made for you|on repeat|repeat rewind/i;

const colTile = (c: LibraryItem): TileItem => ({
  key: c.uri, uri: c.uri, name: c.name, img: c.image ?? null, openable: true,
  sub: c.kind === 'artist' ? 'Artist' : isAlbum(c.uri) ? c.artist ?? '' : c.owner ?? '' });
const homeTile = (x: HomeItem, i: number): TileItem => ({ key: i + ':' + x.uri, uri: x.uri, name: x.name, sub: x.sub || '', img: x.img, openable: opensPage(x.uri) });

/** Songs grouped by album, in their order (Album List, the Grid and Cover Flow of a list of songs). */
export interface AlbumGroup {
  key: string; uri: string | null; name: string; artist: string; img: string | null; tracks: Track[];
  /** each song's index in the list given; `first` the first of them */
  index: number[]; first: number;
}
export function albumsOf(tracks: readonly Track[]): AlbumGroup[] {
  const out: AlbumGroup[] = [], at = new Map<string, AlbumGroup>();
  tracks.forEach((t, i) => {
    const key = t.albumUri ?? (t.album ? t.album + '\u0000' + t.artist : t.uri);
    let g = at.get(key);
    if (!g) {
      g = { key, uri: t.albumUri ?? null, name: t.album || t.title, artist: t.artist, img: t.image ?? t.art ?? null, tracks: [], index: [], first: i };
      at.set(key, g);
      out.push(g);
    }
    g.tracks.push(t);
    g.index.push(i);
  });
  return out;
}

/** Followed artists (Your Library > Artists), only while Music's Grid wants them. */
function useFollowed(on: boolean): LibraryItem[] {
  const q = useShell().queries, ready = useApp((s) => s.auth.loggedIn === true);
  return useQuery({ queryKey: q.keys.followedArtists(), queryFn: q.fetchFollowedArtists, enabled: on && ready, staleTime: STALE.list }).data ?? [];
}
/** The followed shows, only while Podcasts shows. */
function useShowsIf(on: boolean): { items: LibraryItem[]; loading: boolean } {
  const q = useShell().queries, ready = useApp((s) => s.auth.loggedIn === true), go = on && ready;
  const r = useQuery({ queryKey: go ? q.keys.shows() : ['itunes', 'shows', 'off'], queryFn: () => q.fetchShows(), enabled: go, staleTime: STALE.list });
  return { items: r.data ?? [], loading: go && r.isPending };
}
/** The stations seeded from what plays, only while Radio or Genius shows (a track change re-seeds). */
function useStationsIf(on: boolean): { stations: Station[] | null; seed: string } {
  const q = useShell().queries, seeds = useRadioSeeds(), go = on && seeds.length > 0;
  const r = useQuery({ queryKey: q.keys.radio(seeds.map((s) => s.seed)), queryFn: () => q.fetchRadio(seeds), enabled: go, staleTime: STALE.collection });
  return { stations: !on ? null : seeds.length ? r.data ?? null : [], seed: seeds[0]?.name ?? '' };
}

/** What `source` (with `opened` on top of it, if any) shows. */
export function useSourceContent(source: Source | undefined, opened: string | null): Content {
  const k = opened ? null : source?.kind ?? null;
  const st = useApp((s) => ({ queue: s.queue.next }));
  const lib = useLibraryList();
  const openedCol = opened && !opened.startsWith('spotify:artist:') ? opened : null;
  const colUri = openedCol ?? (k === 'music' ? LIKED : k === 'playlist' ? source?.uri ?? null : null);
  const col = useCollection(colUri);
  const artist = useArtist(opened);
  const followed = useFollowed(k === 'music');
  const shows = useShowsIf(k === 'podcasts');
  const radio = useStationsIf(k === 'radio' || k === 'genius');
  const geniusUri = k === 'genius' ? radio.stations?.find((x) => isCollectionUri(x.uri))?.uri ?? null : null;
  const genius = useCollection(geniusUri);
  const home = useHome().sections;
  const recent = useRecentlyPlayed();

  if (opened) {
    if (opened.startsWith('spotify:artist:')) {
      const p = artist.page;
      return { kind: 'artist', title: p?.meta.name ?? 'Artist', ctx: opened, tracks: p?.tracks ?? [], albums: (p?.albums ?? []).map(colTile),
               loading: artist.loading, image: p?.meta.image ?? null };
    }
    const known = lib.items.find((x) => x.uri === opened);
    return { kind: 'tracks', title: col.meta?.name ?? known?.name ?? (opened === LIKED ? 'Liked Songs' : col.loading ? 'Loading…' : ''),
             sub: col.meta?.artists?.map((a) => a.name).join(', ') ?? col.meta?.owner?.name,
             ctx: opened, tracks: col.rows, total: col.total || col.rows.length, loading: col.loading, image: col.meta?.image ?? known?.image ?? null,
             more: col.hasMore ? col.loadMore : null, empty: opened.startsWith('spotify:show:') ? 'No episodes.' : 'No songs.' };
  }
  if (!source) return { kind: 'none', title: '', note: lib.loading ? 'Loading…' : '' };
  switch (source.kind) {
    case 'music': {
      const albums = lib.items.filter((x) => isAlbum(x.uri)).map(colTile);
      return { kind: 'tracks', title: 'Music', ctx: LIKED, tracks: col.rows, total: col.total || col.rows.length, loading: col.loading,
               more: col.hasMore ? col.loadMore : null, browse: { albums, artists: followed.map(colTile) }, empty: 'No liked songs yet.' };
    }
    case 'playlist':
      return { kind: 'tracks', title: col.meta?.name ?? source.label, sub: col.meta?.owner?.name, ctx: source.uri ?? null, tracks: col.rows,
               total: col.total || col.rows.length, loading: col.loading, image: col.meta?.image ?? null,
               more: col.hasMore ? col.loadMore : null, empty: 'This playlist is empty.' };
    case 'dj':
      return { kind: 'tracks', title: 'iTunes DJ', sub: 'Up Next', ctx: null, tracks: st.queue, total: st.queue.length, loading: false, more: null, queue: true,
               empty: 'Nothing is queued. Songs you choose to Play Next show here.' };
    case 'genius':
      return { kind: 'tracks', title: 'Genius', sub: radio.seed ? 'Based on ' + radio.seed : undefined, ctx: geniusUri,
               tracks: genius.rows, total: genius.total || genius.rows.length, loading: genius.loading || (radio.stations === null && !!radio.seed),
               more: genius.hasMore ? genius.loadMore : null, empty: 'Play a song to make a Genius playlist from it.' };
    case 'podcasts':
      return { kind: 'tiles', title: 'Podcasts', sections: [{ items: shows.items.map((x) => ({ ...colTile(x), sub: x.owner ?? '' })) }], loading: shows.loading,
               empty: 'No podcasts followed.' };
    case 'store':
      return { kind: 'tiles', title: 'Spotify', sections: (home ?? []).map((s, j) => ({ title: s.title, items: s.items.map((x, i) => homeTile(x, j * 1000 + i)) })),
               loading: !home, empty: 'Nothing on the home feed.' };
    case 'mixes': {
      const seen = new Set<string>();
      const items = (home ?? []).flatMap((s) => s.items.filter((x) => MIX.test(s.title) || MIX.test(x.name)))
        .filter((x) => x.uri.startsWith('spotify:playlist:') && !seen.has(x.uri) && !!seen.add(x.uri));
      return { kind: 'tiles', title: 'Genius Mixes', sections: [{ items: items.map(homeTile) }], loading: !home, empty: 'No mixes on the home feed yet.' };
    }
    case 'recent':
      return { kind: 'tiles', title: 'Recently Played', sections: [{ items: recent.items.map(homeTile) }], loading: recent.loading, empty: 'Nothing played lately.' };
    case 'radio':
      return { kind: 'stations', title: 'Radio', stations: radio.stations };
    case 'search':
      return { kind: 'search', title: 'Search Results' };
  }
}
/** Playing from a content: a row in its context (from itself), a tile's page whole. */
export function playRow(sh: Shell, c: Content, t: Track): void {
  const ctx = 'ctx' in c && c.ctx ? c.ctx : t.ctx ?? null;
  sh.store.getState().commands.playContext(ctx ?? t.uri, ctx ? t.uri : null);
}
export function playUri(sh: Shell, uri: string): void {
  const cmd = sh.store.getState().commands;
  if (isCollectionUri(uri)) cmd.playAll(uri);
  else if (opensPage(uri)) cmd.playContext(uri, null);
  else cmd.playItem({ uri });
}

/** "Show the current song" (Ctrl+L, the LCD's ➜): the source the song plays from selected, its row
 *  shown — Music for Liked Songs, a library playlist as itself, iTunes DJ when it was queued, and
 *  anything else (an album, an artist, a station) opened inside Music. */
export function showPlaying(sh: Shell): void {
  const s = sh.store.getState(), ctx = s.playback.context?.uri ?? s.playback.track?.ctx ?? null;
  if (!s.playback.track) return;
  const lib = sh.client?.getQueryData<LibraryItem[]>(sh.queries.keys.libraryList()) ?? [];
  if (!ctx || ctx === LIKED) viewActions.reveal('music', null);
  else if (lib.some((x) => x.uri === ctx && !isAlbum(x.uri))) viewActions.reveal(ctx, null);
  else if (opensPage(ctx)) viewActions.reveal('music', ctx);
  else viewActions.reveal('dj', null);
}

/** Genius from a song (Advanced > Start Genius, the bottom bar's ⚛): its own radio station played, as
 *  the iPod's Start Radio finds it (the station named for the seed, else the first). `seed`: a track's
 *  uri; none = the playing song. */
export function startGenius(sh: Shell, seed?: string): void {
  const seeds = sh.queries.radioSeeds(), s = seed ? seeds.find((x) => x.seed === seed) ?? { seed, name: '', sub: '' } : seeds[0];
  if (!s) return;
  void sh.queries.fetchRadio([s]).then((st) => {
    const hit = st.find((x) => x.name === s.name) ?? st[0];
    if (hit) sh.store.getState().commands.playContext(hit.uri, null);
  }, () => {});
}

const plural = (n: number, one: string) => n.toLocaleString('en-US') + ' ' + one + (n === 1 ? '' : 's');
/** A length as iTunes' status line words it: "47 minutes", "3.2 hours", "1.4 days". */
export function spanText(ms: number): string {
  const min = ms / 60000;
  return min < 60 ? plural(Math.round(min), 'minute') : min < 1440 ? (min / 60).toFixed(1) + ' hours' : (min / 1440).toFixed(1) + ' days';
}
/** The bottom bar's status text for what shows: "12 songs, 47 minutes" (the length once every page is
 *  in; Spotify has no file sizes, so no "GB"), "8 albums", "5 stations". */
export function statusLine(c: Content): string {
  switch (c.kind) {
    case 'tracks': {
      if (c.loading) return '';
      const n = Math.max(c.total, c.tracks.length), ms = c.tracks.reduce((a, t) => a + (t.duration || 0), 0);
      return n ? plural(n, c.title === 'Podcasts' ? 'episode' : 'song') + (c.tracks.length >= n && ms ? ', ' + spanText(ms) : '') : '';
    }
    case 'tiles': {
      const n = c.sections.reduce((a, s) => a + s.items.length, 0);
      return c.loading || !n ? '' : plural(n, c.title === 'Podcasts' ? 'podcast' : c.title === 'Genius Mixes' ? 'mix' : 'item').replace(/mixs$/, 'mixes');
    }
    case 'artist': return c.loading ? '' : plural(c.tracks.length, 'song') + ', ' + plural(c.albums.length, 'album');
    case 'stations': return c.stations?.length ? plural(c.stations.length, 'station') : '';
    default: return '';
  }
}

/** iTunes DJ's edits as an Up Next order for commands.reorderQueue (the rows by index in their new
 *  order, a row left out removed): a row moved from one place to another, or removed. */
export function queueOrder(n: number, edit: { move: [number, number] } | { remove: number }): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  if ('remove' in edit) return order.filter((i) => i !== edit.remove);
  const [from, to] = edit.move, [x] = order.splice(from, 1);
  if (x !== undefined) order.splice(to, 0, x);
  return order;
}
