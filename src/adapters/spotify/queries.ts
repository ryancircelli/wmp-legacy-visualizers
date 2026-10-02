// The Spotify adapter's fetched data as framework-free query functions for TanStack Query
// (ARCHITECTURE v7.1): stable keys, one function per resource, the pathfinder machinery (hashes,
// 412 rescan) underneath, and a typed 429 so the QueryClient's retry honours Retry-After. The
// functions are bound to the running adapter (bindQueries at start); every result also feeds the
// enrichment cache that names the player's state (remember).
import type {
  ArtistPage, CollectionMeta, CollectionPage, HomeFeed, LibraryItem, Lyrics, RadioSeed, SearchPage, SearchResults, SearchType, Station, Track,
} from '../../model';
import { fetchAlbumMeta as albumMeta, fetchArtist as artist } from './artist';
import { fetchHome as home } from './home';
import { fetchCollectionPage as page, fetchFollowedArtists as followed, fetchLibraryList as list, remember as rememberIn } from './library';
import { fetchRadio as radio, radioSeeds as seeds } from './radio';
import { fetchSearch as search } from './search';
import { acceptLyrics as accept, fetchLyrics as lyrics } from './lyrics';
import { applyMembership as applyM, fetchEditablePlaylists as editable, fetchMembership as membership, fetchSaved as saved, setInvalidator } from './saved';
import { query } from './pathfinder';
import { fetchTrack as track } from './state';
import { QueryError, RateLimitError, type Sp } from './sp';

export { QueryError, RateLimitError };

let sp: Sp | null = null;
/** The adapter binds its state here at start (tests bind their own). */
export function bindQueries(s: Sp | null): void { sp = s; }
function bound(): Sp {
  if (!sp) throw new QueryError('spotify', 0);
  return sp;
}

/** Query keys: arrays under 'spotify', stable for equal arguments. */
export const keys = {
  all: ['spotify'] as const,
  libraryList: () => ['spotify', 'library'] as const,
  /** under the library's key: a follow / unfollow (setLiked) refetches it with the list */
  followedArtists: () => ['spotify', 'library', 'artists'] as const,
  collection: (uri: string) => ['spotify', 'collection', uri] as const,
  collectionPage: (uri: string, offset: number) => ['spotify', 'collection', uri, offset] as const,
  search: (q: string, type: SearchType, offset = 0) => ['spotify', 'search', q.trim(), type, offset] as const,
  home: () => ['spotify', 'home'] as const,
  radio: (seedUris: readonly string[]) => ['spotify', 'radio', ...seedUris] as const,
  artist: (uri: string) => ['spotify', 'artist', uri] as const,
  album: (uri: string) => ['spotify', 'album', uri] as const,
  lyrics: (trackId: string) => ['spotify', 'lyrics', trackId] as const,
  /** a batch of saved flags (the UI batches per visible list) */
  saved: (uris: readonly string[]) => ['spotify', 'saved', ...uris] as const,
  canvas: (trackUri: string) => ['spotify', 'canvas', trackUri] as const,
};
/** A track's membership in the given playlists (the UI keys it per open menu). */
export const membershipKey = (trackUri: string) => ['spotify', 'membership', trackUri] as const;
/** One uri's saved flag (setLiked invalidates exactly this). */
export const savedKey = (uri: string) => ['spotify', 'saved', uri] as const;

/** The playlists and saved albums of the library (libraryV3, up to 400). */
export const fetchLibraryList = (): Promise<LibraryItem[]> => list(bound());
/** The followed artists (libraryV3, the Artists filter; up to 400) as { uri, name, image, kind: 'artist' }, in Spotify's order. */
export const fetchFollowedArtists = (): Promise<LibraryItem[]> => followed(bound());
/** One page of a playlist / album / Liked Songs (meta with offset 0); nextOffset absent = the end. */
export const fetchCollectionPage = (uri: string, offset = 0): Promise<CollectionPage> => page(bound(), uri, offset);
/** Type 'all': SearchResults (every bucket's first page + top result); a typed search: one SearchPage. */
export function fetchSearch(q: string, type: 'all', offset?: number, limit?: number): Promise<SearchResults>;
export function fetchSearch(q: string, type: Exclude<SearchType, 'all'>, offset?: number, limit?: number): Promise<SearchPage<Track | LibraryItem>>;
export function fetchSearch(q: string, type: SearchType, offset?: number, limit?: number): Promise<SearchResults | SearchPage<Track | LibraryItem>>;
export function fetchSearch(q: string, type: SearchType = 'all', offset = 0, limit?: number): Promise<SearchResults | SearchPage<Track | LibraryItem>> {
  return search(bound(), q, type, offset, limit);
}
export const fetchHome = (): Promise<HomeFeed> => home(bound());
/** The seeds for what is playing (song radio, artist radio): keys.radio(radioSeeds().map(s => s.seed)). */
export const radioSeeds = (): RadioSeed[] => seeds(bound());
export const fetchRadio = (s?: RadioSeed[]): Promise<Station[]> => radio(bound(), s);
export const fetchArtist = (uri: string): Promise<ArtistPage> => artist(bound(), uri);
export const fetchAlbumMeta = (uri: string): Promise<CollectionMeta> => albumMeta(bound(), uri);
/** Spotify's lyrics for a track (keys.lyrics(trackId), trackId = the uri's last part); 404 -> status
 *  'none'; 401/403 throw QueryError (keep the host's LRCLIB lyrics). The hook then calls acceptLyrics. */
export const fetchLyrics = (trackUri: string, imageUrl?: string | null): Promise<Lyrics> => lyrics(bound(), trackUri, imageUrl);
/** A track's Canvas: the looping clip (or still) Spotify's apps show behind Now Playing. */
export interface Canvas { url: string; type: 'video' | 'image' }
/** The track's Canvas, null when it has none. The web player's own route: its persisted `canvas`
 *  query on pathfinder v2, variables { trackUri }, read at data.trackUnion.canvas { url, type, uri }
 *  (type 'VIDEO_LOOPING' with a .cnvs.mp4 url, 'IMAGE' with a .jpg). Sources: Wolframe-spotify-canvas
 *  src/lib.rs (github.com/squeeeezy/Wolframe-spotify-canvas) and BitChord PR #461's
 *  SpotifyCanvasQuery.kt + its test (github.com/kushagrasinghx/BitChord/pull/461); both note the older
 *  spclient canvaz-cache protobuf endpoint is no longer what the web player uses. The hash comes
 *  from the bundle scan ("canvas","query","<sha>"), BAKED as the last resort. Quiet: no canvas is
 *  normal, a missing hash too. */
export async function fetchCanvas(trackUri: string): Promise<Canvas | null> {
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(trackUri)) return null;
  type D = { trackUnion?: { canvas?: { url?: string | null; type?: string | null } | null } | null };
  const c = (await query<D>(bound(), 'canvas', { trackUri }, { quiet: true })).trackUnion?.canvas, url = c?.url;
  if (!url?.startsWith('https://')) return null;
  return { url, type: /VIDEO/.test(c?.type ?? '') || /\.mp4(?:[?#]|$)/i.test(url) ? 'video' : 'image' };
}
/** A track by uri (getTrack): the row a list gives plus `art`, the cover near 300 px; null for an
 *  episode or no such track. The player's state asks it for tracks it names by uri alone (librespot). */
export const fetchTrack = (uri: string): Promise<Track | null> => track(bound(), uri);
/** Put a fetchLyrics result into the lyrics slice if it is still the playing track's and not 'none'. */
export const acceptLyrics = (trackUri: string, l: Lyrics): void => accept(bound(), trackUri, l);
/** Saved (Liked) flags by uri: Liked Songs rows and our own changes known without a call, the rest
 *  by areEntitiesInLibrary, 50 per call. Show `store.saved[uri] ?? data[uri]`. */
export const fetchSaved = (uris: string[]): Promise<Record<string, boolean>> => saved(bound(), uris);
/** The UI's QueryClient invalidation, called after a Like / Remove succeeded with the keys to refetch
 *  (Liked Songs, the library list, that uri's savedKey). */
export { setInvalidator };
/** The playlists the user can add to (canEditItems, or the same owner as one that can). */
export const fetchEditablePlaylists = (): Promise<LibraryItem[]> => editable(bound());
/** Which of these playlists hold the track: cached sightings, else page reads (10 playlists, 5 pages
 *  each at most; unknown ones absent). Show `store.membership[pl]?.[track] ?? data[pl]`. */
export const fetchMembership = (trackUri: string, playlistUris: string[]): Promise<Record<string, boolean>> => membership(bound(), trackUri, playlistUris);
/** The optimistic mark alone (addTo applies it itself); null clears it. */
export const applyMembership = (trackUri: string, targetUri: string, on: boolean | null): void => applyM(bound(), trackUri, targetUri, on);
/** Feed rows (and names) the UI got elsewhere into the enrichment cache. */
export const remember = (tracks: Track[], list?: string, items?: LibraryItem[]): void => rememberIn(bound(), tracks, list, items);

/** For the QueryClient (defaultOptions.queries): 429 waits Retry-After (up to 3 tries), other
 *  failures retry once after 1 s, a missing hash (status 0) not at all. */
export const retryPolicy = {
  retry: (count: number, err: unknown): boolean =>
    err instanceof RateLimitError ? count < 3 : err instanceof QueryError && err.status === 0 ? false : count < 1,
  retryDelay: (count: number, err: unknown): number =>
    err instanceof RateLimitError ? err.retryAfterMs : Math.min(1000 * 2 ** count, 8000),
};
