/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
// Search all of Spotify. Type 'all' is searchDesktop (what the web player's search page sends:
// every bucket, 10 each, and the top result); a typed search pages one bucket with the web
// player's per-type op (searchTracks / searchArtists / searchAlbums / searchPlaylists).
import { SEARCH_CAP, type LibraryItem, type SearchPage, type SearchResults, type SearchType, type Track } from '../../model';
import { artistRow, contextRow, remember, trackRow } from './library';
import { hashFor, query, searchRoute } from './pathfinder';
import { RateLimitError, type Sp } from './sp';

type Bucket = Exclude<SearchType, 'all'>;
const items = (p: any): any[] => (p && p.items) || [];
const ok = <T>(l: (T | null)[]) => l.filter((x): x is T => !!x);

export const SEARCH_OPS: Record<Bucket, string> = {
  tracks: 'searchTracks', artists: 'searchArtists', albums: 'searchAlbums', playlists: 'searchPlaylists' };

/** One bucket of a searchV2 response. */
interface Got { items: (Track | LibraryItem)[]; total: number; next?: number | null }
function bucket(s: any, b: Bucket): Got {
  const p = b === 'tracks' ? s.tracksV2 : b === 'artists' ? s.artistsV2 || s.artists : b === 'albums' ? s.albumsV2 : s.playlists;
  const got: (Track | LibraryItem | null)[] = items(p).map((i) =>
    b === 'tracks' ? trackRow(i.item && i.item.data) : b === 'artists' ? artistRow(i.data) : contextRow(i.data));
  const list = ok(got);
  const pi = p && p.pagingInfo;
  return { items: list, total: Math.max((p && p.totalCount) || 0, list.length), ...(pi ? { next: pi.nextOffset ?? null } : {}) };
}

function topResult(s: any): SearchResults['top'] {
  for (const x of (s.topResultsV2 && s.topResultsV2.itemsV2) || []) {
    const it = x.item || {}, d = it.data;
    const hit = it.__typename === 'ArtistResponseWrapper' ? ['artist', artistRow(d)]
      : it.__typename === 'TrackResponseWrapper' ? ['track', trackRow(d)]
      : it.__typename === 'AlbumResponseWrapper' ? ['album', contextRow(d)]
      : it.__typename === 'PlaylistResponseWrapper' ? ['playlist', contextRow(d)] : null;
    if (hit && hit[1]) return { kind: hit[0] as 'artist', item: hit[1] as LibraryItem };
  }
  return undefined;
}

// The variables the web player sends (spike 4, SPIKE4.md).
const desktopVars = (q: string, offset: number, limit: number) => ({ searchTerm: q, offset, limit, numberOfTopResults: 5,
  includeAudiobooks: true, includeArtistHasConcertsField: false, includePreReleases: true, includeAlbumPreReleases: false,
  includeAuthors: false, includeEpisodeContentRatingsV2: true, isPrefix: null, sectionFilters: ['GENERIC'] });
const typedVars = (q: string, offset: number, limit: number) => ({ includePreReleases: false, includeAlbumPreReleases: false,
  numberOfTopResults: 20, searchTerm: q, offset, limit, includeAudiobooks: true, includeAuthors: false,
  includeEpisodeContentRatingsV2: true });

/** One bucket as a page. Spotify's totalCount grows as you page (live 2026-09-25, typed "queen"
 *  songs: 18, then 36, then 46), so `total` is the latest count reported and `exact` holds only on
 *  a typed page with no next page (pagingInfo without nextOffset). The full search's buckets are
 *  never exact. nextOffset = where the next page starts. */
function pageOf<T>(got: Got, offset: number, limit: number, typed: boolean): SearchPage<T> {
  const items = got.items as unknown as T[], end = offset + items.length;
  const more = !items.length || end >= SEARCH_CAP ? false
    : got.next !== undefined ? got.next != null
    : typed ? end < got.total : got.total > end || items.length >= limit;
  return { items, total: Math.max(got.total, end), offset, exact: typed && !more, hasMore: more,
           ...(more ? { nextOffset: got.next ?? end } : {}) };
}

/** Search all of Spotify. type 'all': searchDesktop, every bucket (10 each) + the top result. A
 *  typed search is one page of one bucket with the web player's per-type op; if that op is unknown
 *  or refused, searchDesktop (50) stands in and `note` says so. Offsets stop at SEARCH_CAP. */
export async function fetchSearch(sp: Sp, q: string, type: 'all', offset?: number, limit?: number): Promise<SearchResults>;
export async function fetchSearch(sp: Sp, q: string, type: Bucket, offset?: number, limit?: number): Promise<SearchPage<Track | LibraryItem>>;
export async function fetchSearch(sp: Sp, q: string, type: SearchType, offset?: number, limit?: number): Promise<SearchResults | SearchPage<Track | LibraryItem>>;
export async function fetchSearch(sp: Sp, q: string, type: SearchType = 'all', offset = 0, limit?: number): Promise<SearchResults | SearchPage<Track | LibraryItem>> {
  q = String(q || '').trim();
  offset = Math.max(0, offset | 0);
  const lim = Math.min(Math.max(1, (limit ?? (type === 'all' ? 10 : type === 'tracks' ? 20 : 30)) | 0), 50, Math.max(0, SEARCH_CAP - offset));
  const empty = <T>(): SearchPage<T> => ({ items: [], total: 0, offset, exact: true, hasMore: false });
  if (type === 'all') {
    if (!q || lim <= 0) return { tracks: empty(), artists: empty(), albums: empty(), playlists: empty() };
    await searchRoute(sp);
    const s = (await query(sp, 'searchDesktop', desktopVars(q, offset, lim))).searchV2 || {};
    const b = { tracks: bucket(s, 'tracks'), artists: bucket(s, 'artists'), albums: bucket(s, 'albums'), playlists: bucket(s, 'playlists') };
    remember(sp, b.tracks.items as Track[], undefined, (b.albums.items as LibraryItem[]).concat(b.playlists.items as LibraryItem[], b.artists.items as LibraryItem[]));
    const top = topResult(s);
    return { ...(top ? { top } : {}), tracks: pageOf<Track>(b.tracks, offset, lim, false), artists: pageOf<LibraryItem>(b.artists, offset, lim, false),
             albums: pageOf<LibraryItem>(b.albums, offset, lim, false), playlists: pageOf<LibraryItem>(b.playlists, offset, lim, false) };
  }
  if (!q || lim <= 0) return empty();
  const op = SEARCH_OPS[type];
  if (!hashFor(sp, op)) await searchRoute(sp);
  let d: any = hashFor(sp, op) ? await query(sp, op, typedVars(q, offset, lim)).catch((e: unknown) => {
    if (e instanceof RateLimitError) throw e;
    return null;
  }) : null;
  let note: string | undefined;
  if (!(d && d.searchV2)) {
    note = op + ' unavailable: via searchDesktop';
    d = await query(sp, 'searchDesktop', desktopVars(q, offset, Math.max(lim, 50)));
  }
  const got = bucket(d.searchV2 || {}, type);
  if (type === 'tracks') remember(sp, got.items as Track[]);
  else remember(sp, [], undefined, got.items as LibraryItem[]);
  const page = pageOf<Track | LibraryItem>(got, offset, lim, !note);
  return note ? { ...page, note } : page;
}
