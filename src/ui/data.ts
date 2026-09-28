// Fetched data (ARCHITECTURE v7.1): TanStack Query over the engine's query functions, which the app
// hands in through the shell (Shell.queries: the Spotify adapter's, or the local engine's empty
// ones). The store keeps only the selection (ui.libNode, ui.libSel, ui.searchQ); lists, pages,
// search results, home, radio and artists are queries, cached per key across view switches.
import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LIKED, type CollectionMeta, type HomeFeed, type LibraryItem, type RadioSeed, type SearchPage, type SearchType, type Track } from '../model';
import { forgetQueries } from './persist';
import { useApp, useShell } from './shell';
import type { Shell } from './types';

const COLLECTION = /^spotify:(playlist:|album:|collection:tracks$)/;
/** a uri fetchCollectionPage serves (a playlist, an album, Liked Songs) */
export const isCollectionUri = (uri: string | null | undefined): uri is string => !!uri && COLLECTION.test(uri);
const isArtistUri = (uri: string | null | undefined): uri is string => !!uri && uri.startsWith('spotify:artist:');

/** How long a fetched thing is fresh (no refetch on remount within it). */
export const STALE = { collection: 60_000, home: 5 * 60_000, list: 5 * 60_000, search: 5 * 60_000, artist: 5 * 60_000 };

const useQ = () => useShell().queries;
type Q = Shell['queries'];

// One set of options per query, for the view that reads it and the prefetch that fills it alike.
const libraryQuery = (q: Q) => queryOptions({ queryKey: q.keys.libraryList(), queryFn: () => q.fetchLibraryList(), staleTime: STALE.list });
const collectionQuery = (q: Q, uri: string) => infiniteQueryOptions({
  queryKey: q.keys.collection(uri),
  queryFn: ({ pageParam }) => q.fetchCollectionPage(uri, pageParam),
  initialPageParam: 0,
  getNextPageParam: (last) => last.nextOffset,
  staleTime: STALE.collection,
});
const homeQuery = (q: Q) => queryOptions({ queryKey: q.keys.home(), queryFn: () => q.fetchHome(), staleTime: STALE.home });
const artistQuery = (q: Q, uri: string) => queryOptions({ queryKey: q.keys.artist(uri), queryFn: () => q.fetchArtist(uri), staleTime: STALE.artist });
const radioQuery = (q: Q, seeds: RadioSeed[]) =>
  queryOptions({ queryKey: q.keys.radio(seeds.map((s) => s.seed)), queryFn: () => q.fetchRadio(seeds), staleTime: STALE.collection });
/** The catalogue answers only once the engine runs (the Spotify adapter binds its query functions
 *  at start, after the first frame, and knows the login): until then nothing is asked. */
const useReady = () => useApp((s) => s.auth.engine !== 'spotify' || s.auth.loggedIn === true);

/** The library's playlists and saved albums, in library order. */
export function useLibraryList(): { items: LibraryItem[]; loading: boolean } {
  const q = useQ(), ready = useReady();
  const r = useQuery({ ...libraryQuery(q), enabled: ready });
  return { items: r.data ?? [], loading: r.isPending };
}

export interface CollectionData {
  /** the tracks loaded so far, page after page */
  rows: Track[];
  meta?: CollectionMeta;
  total: number;
  hasMore: boolean;
  /** the next page (the "Load more" row / tile) */
  loadMore: () => void;
  /** the first page is on its way */
  loading: boolean;
  /** a later page is on its way */
  loadingMore: boolean;
  loaded: boolean;
}

/** A playlist / album / Liked Songs, paged (null or another kind of uri: nothing, not fetched). */
export function useCollection(uri: string | null | undefined): CollectionData {
  // keyed by the uri even before the login is known: a result kept from the last session shows now
  const q = useQ(), ready = useReady(), is = isCollectionUri(uri), on = is && ready;
  const r = useInfiniteQuery({ ...collectionQuery(q, is ? uri : ''), enabled: on });
  const pages = r.data?.pages ?? [];
  return {
    rows: pages.flatMap((p) => p.tracks),
    meta: pages[0]?.meta,
    total: pages[0]?.total ?? 0,
    hasMore: !!r.hasNextPage,
    loadMore: () => { if (r.hasNextPage && !r.isFetchingNextPage) void r.fetchNextPage(); },
    loading: is && r.isPending,
    loadingMore: r.isFetchingNextPage,
    loaded: is && r.isSuccess,
  };
}

/** The first page of several collections at once (the Now Playing pane's opened playlists). */
export function useCollectionFirstPages(uris: string[]): Record<string, Track[] | undefined> {
  const q = useQ(), ready = useReady();
  const rs = useQueries({ queries: uris.map((uri) => ({
    queryKey: q.keys.collectionPage(uri, 0), queryFn: () => q.fetchCollectionPage(uri, 0), staleTime: STALE.collection, enabled: ready })) });
  return Object.fromEntries(uris.map((u, i) => [u, rs[i]?.data?.tracks]));
}

/** An artist page: details, top tracks, discography. */
export function useArtist(uri: string | null | undefined) {
  const q = useQ(), ready = useReady(), is = isArtistUri(uri);
  const r = useQuery({ ...artistQuery(q, is ? uri : ''), enabled: is && ready });
  return { page: r.data, loading: is && r.isPending };
}

/** An album's details alone (the details pane's track mode: release, label). */
export function useAlbumMeta(uri: string | null | undefined): CollectionMeta | undefined {
  const q = useQ(), ready = useReady(), is = !!uri && uri.startsWith('spotify:album:');
  return useQuery({ queryKey: q.keys.album(is ? uri : ''), queryFn: () => q.fetchAlbumMeta(uri!), enabled: is && ready, staleTime: STALE.artist }).data;
}

export type Bucket = Exclude<SearchType, 'all'>;

/** The full search for q (every bucket's first page and the top result); '' = none. */
export function useSearchAll(q: string) {
  const qs = useQ(), text = q.trim(), ready = useReady();
  const r = useQuery({ queryKey: qs.keys.search(text, 'all'), queryFn: () => qs.fetchSearch(text, 'all'), enabled: !!text && ready, staleTime: STALE.search });
  return { results: r.data, loading: !!text && r.isPending };
}

/** One bucket of q, paged ("Show all"): the items so far, the next page. */
export function useSearch(q: string, type: Bucket | null) {
  const qs = useQ(), ready = useReady(), text = q.trim(), on = !!text && !!type && ready;
  const r = useInfiniteQuery({
    queryKey: qs.keys.search(text, type ?? 'tracks'),
    queryFn: ({ pageParam }) => qs.fetchSearch(text, type!, pageParam),
    initialPageParam: 0,
    // Load more while the last page says where the next starts (the model's exact = no nextOffset)
    getNextPageParam: (last: SearchPage<Track | LibraryItem>) => last.nextOffset,
    enabled: on,
    staleTime: STALE.search,
  });
  const pages = r.data?.pages ?? [];
  const last = pages[pages.length - 1];
  return {
    items: pages.flatMap((p) => p.items),
    total: last?.total ?? 0,
    exact: last?.exact ?? true,
    hasMore: !!r.hasNextPage,
    note: pages.find((p) => p.note)?.note,
    loadMore: () => { if (r.hasNextPage && !r.isFetchingNextPage) void r.fetchNextPage(); },
    loading: on && (r.isPending || r.isFetchingNextPage),
  };
}

/** Warms a playlist, album or artist the pointer rests on, so the click finds it loaded (nothing
 *  is asked for what is still fresh). */
export function useWarm(): (uri: string | null | undefined) => void {
  const sh = useShell(), q = sh.queries, c = sh.client, ready = useReady();
  return (uri) => {
    if (!ready || !c) return;
    if (isCollectionUri(uri)) void c.prefetchInfiniteQuery(collectionQuery(q, uri));
    else if (isArtistUri(uri)) void c.prefetchQuery(artistQuery(q, uri));
  };
}

/** Collections fetched ahead after login: the playing one, Liked Songs, the library's first few. */
const AHEAD = 6;

/** Media Guide's first screen of covers into the browser's cache: the first four rows, eight covers
 *  each. The feed alone leaves them to load as the (lazy) tiles appear. Low priority; the prefetch
 *  after it waits 3 s at most. */
function warmCovers(feed: HomeFeed | undefined): Promise<void> {
  const urls = (feed?.sections ?? []).slice(0, 4).flatMap((s) => s.items.slice(0, 8).map((i) => i.img)).filter((u): u is string => !!u);
  const loads = urls.map((src) => new Promise<void>((ok) => {
    const img = new Image();
    img.onload = img.onerror = () => ok();
    img.fetchPriority = 'low';
    img.src = src;
  }));
  return Promise.race([Promise.all(loads).then(() => {}), new Promise<void>((ok) => setTimeout(ok, 3000))]);
}

/** After login, one at a time and only while the page is idle: the library, Media Guide, Radio
 *  Tuner and the first page of the collections most likely opened next. */
export function useIdlePrefetch(): void {
  const sh = useShell(), q = useQ(), c = useQueryClient(), ready = useApp((s) => s.auth.engine === 'spotify' && s.auth.loggedIn === true);
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const idle = () => new Promise<void>((ok) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => ok(), { timeout: 2000 });
      else setTimeout(ok, 200);
    });
    const later = (f: () => Promise<unknown>) => async () => { if (stop) return; await idle(); if (!stop) await f(); };
    void (async () => {
      await new Promise((ok) => setTimeout(ok, 2000)); // the views opened first go first
      await later(() => c.prefetchQuery(libraryQuery(q)))();
      await later(() => c.prefetchQuery(homeQuery(q)))();
      await later(() => warmCovers(c.getQueryData(homeQuery(q).queryKey)))();
      const seeds = q.radioSeeds();
      if (seeds.length) await later(() => c.prefetchQuery(radioQuery(q, seeds)))();
      const lib = c.getQueryData(libraryQuery(q).queryKey) ?? [];
      const uris = [sh.store.getState().playback.track?.ctx, LIKED, ...lib.slice(0, AHEAD).map((i) => i.uri)].filter(isCollectionUri);
      for (const u of new Set(uris)) await later(() => c.prefetchInfiniteQuery(collectionQuery(q, u)))();
    })();
    return () => { stop = true; };
  }, [ready, sh, q, c]);
}

/** Logged out: that account's results go, from memory and from IndexedDB (ui/persist.ts). */
export function useForgetOnLogout(): void {
  const c = useQueryClient(), out = useApp((s) => s.auth.engine === 'spotify' && s.auth.loggedIn === false);
  useEffect(() => { if (out) { c.clear(); void forgetQueries(); } }, [out, c]);
}

/** Media Guide: the home feed. */
export function useHome() {
  const q = useQ(), ready = useReady();
  const r = useQuery({ ...homeQuery(q), enabled: ready });
  return { sections: r.data?.sections ?? null, greeting: r.data?.greeting ?? '' };
}

/** What radio can be seeded from now (the playing track, its artist): re-read as the track changes. */
export function useRadioSeeds(): RadioSeed[] {
  const q = useQ(), ready = useReady();
  useApp((s) => s.playback.track?.uri ?? '');
  return ready ? q.radioSeeds() : [];
}

/** Radio Tuner: the stations for these seeds (null = still tuning). */
export function useRadio(seeds: RadioSeed[]) {
  const q = useQ(), ready = useReady();
  const r = useQuery({ ...radioQuery(q, seeds), enabled: ready });
  return { stations: r.data ?? null };
}

/** Spotify's lyrics for the playing track (fetchLyrics), handed to the store with acceptLyrics as
 *  they arrive (it keeps them only while that track still plays; 'none' leaves the host's LRCLIB
 *  lyrics). Cached an hour per track; nothing is asked while lyrics are off. */
export function useLyricsFor(trackUri: string | null | undefined, imageUrl?: string | null): void {
  const q = useQ(), ready = useReady(), on = useApp((s) => s.settings.lyrics);
  const id = trackUri?.split(':').pop() ?? '';
  const r = useQuery({
    queryKey: q.keys.lyrics(id), queryFn: () => q.fetchLyrics(trackUri!, imageUrl),
    enabled: !!trackUri && !!id && ready && on, staleTime: 60 * 60_000,
  });
  const data = r.data;
  useEffect(() => { if (trackUri && data) q.acceptLyrics(trackUri, data); }, [trackUri, data, q]);
}
