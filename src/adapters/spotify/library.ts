/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// Library (libraryV3 playlists/albums, Liked Songs) and collection paging. Pathfinder shapes are
// Spotify's private GraphQL, read defensively: `any` is the honest type for them.
import { LIKED, type CollectionMeta, type CollectionPage, type LibraryItem, type Track } from '../../model';
import { fetchArtist } from './artist';
import { query } from './pathfinder';
import { onState } from './state';
import type { Sp } from './sp';

export const artists = (a: any): string =>
  ((a && a.items) || []).map((x: any) => x.profile && x.profile.name).filter(Boolean).join(', ');

export const plain = (html: any) => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

const width = (x: any): number => x.width || x.maxWidth || 0;
/** The largest image source no wider than 640 px (unsized sources count as fitting). */
export function bigImage(sources: any): string | undefined {
  let best: any = null;
  for (const x of sources || []) if (width(x) <= 640 && (!best || width(x) > width(best))) best = x;
  return (best || (sources || [])[0])?.url;
}
/** The source nearest 300 px wide (unsized sources count as a match): list covers / tiles. */
export function midImage(sources: any): string | undefined {
  let best: any = null;
  const off = (x: any) => (width(x) ? Math.abs(width(x) - 300) : 0);
  for (const x of sources || []) if (!best || off(x) < off(best)) best = x;
  return best?.url;
}
/** The smallest image source at least 64 px wide, else the largest there is. */
export function smallImage(sources: any): string | undefined {
  let best: any = null;
  for (const x of sources || []) {
    const w = width(x), bw = best ? width(best) : -1;
    if (!best || (w >= 64 ? bw < 64 || w < bw : bw < 64 && w > bw)) best = x;
  }
  return best?.url;
}
/** {isoString, precision} or {year, month, day, precision} -> '2015-07-15' | '2015-07' | '2015'. */
export function dateOf(d: any): string | undefined {
  if (!d) return undefined;
  const two = (n: any) => String(n).padStart(2, '0');
  const iso: string | undefined = d.isoString ||
    (d.year && d.month && d.day ? d.year + '-' + two(d.month) + '-' + two(d.day) : undefined);
  if (!iso) return d.year ? (d.month && d.precision === 'MONTH' ? d.year + '-' + two(d.month) : String(d.year)) : undefined;
  return d.precision === 'YEAR' ? iso.slice(0, 4) : d.precision === 'MONTH' ? iso.slice(0, 7) : iso.slice(0, 10);
}
const people = (a: any) => ((a && a.items) || []).filter((x: any) => x && x.uri && x.profile)
  .map((x: any) => ({ name: x.profile.name as string, uri: x.uri as string }));
/** Drop the keys whose value is undefined (the optional fields stay absent, not undefined). */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

interface AlbumInfo { name?: string; uri?: string; image?: string; date?: string }
/** A track from any pathfinder shape (fetchLibraryTracks, fetchPlaylist itemV2, getAlbum, searchV2).
 *  fetchLibraryTracks keeps the uri beside the data (track._uri), the others inside it; getAlbum's
 *  tracks carry no album (it is the album being read, passed in). */
export function trackRow(d: any, ctx?: string | null, uri?: string | null, album: AlbumInfo = {}): Track | null {
  const u: string | undefined = (d && d.uri) || uri;
  if (!d || !u || !d.name) return null;
  const al = d.albumOfTrack || {}, uris = people(d.artists).map((a: { uri: string }) => a.uri);
  return clean<Track>({
    uri: u, title: d.name, artist: artists(d.artists), album: al.name || album.name || undefined,
    duration: (d.duration || d.trackDuration || {}).totalMilliseconds || 0,
    ctx: ctx || al.uri || null,
    playcount: d.playcount != null && d.playcount !== '' && !isNaN(+d.playcount) ? +d.playcount : undefined,
    explicit: d.contentRating ? d.contentRating.label === 'EXPLICIT' : undefined,
    image: smallImage(al.coverArt && al.coverArt.sources) || album.image,
    albumUri: al.uri || album.uri,
    artistUris: uris.length ? uris : undefined,
    releaseDate: dateOf(al.date) || album.date,
    trackNumber: typeof d.trackNumber === 'number' ? d.trackNumber : undefined,
    discNumber: typeof d.discNumber === 'number' ? d.discNumber : undefined,
  });
}

/** fetchPlaylist's playlistV2 / getAlbum's albumUnion -> the details pane. */
export function playlistMeta(p: any): CollectionMeta {
  const o = p.ownerV2 && p.ownerV2.data;
  return clean<CollectionMeta>({
    kind: 'playlist', name: p.name || '',
    image: bigImage(p.images && p.images.items && p.images.items[0] && p.images.items[0].sources),
    owner: o && o.name ? clean({ name: o.name, uri: o.uri || '', avatar: bigImage(o.avatar && o.avatar.sources) }) : undefined,
    description: p.description ? plain(p.description) : undefined,
    followers: typeof p.followers === 'number' ? p.followers : undefined,
    following: typeof p.following === 'boolean' ? p.following : undefined,
    total: (p.content && p.content.totalCount) || 0,
    shareUrl: (p.sharingInfo && p.sharingInfo.shareUrl) || undefined,
    format: typeof p.format === 'string' ? p.format : undefined,
  });
}
export function albumMeta(a: any): CollectionMeta {
  const cr = ((a.copyright && a.copyright.items) || []).map((x: any) => x.text).filter(Boolean);
  const ar = people(a.artists);
  return clean<CollectionMeta>({
    kind: 'album', name: a.name || '',
    image: bigImage(a.coverArt && a.coverArt.sources),
    artists: ar.length ? ar : undefined,
    releaseDate: dateOf(a.date),
    label: a.label || undefined,
    copyright: cr.length ? cr.join('\n') : undefined,
    saved: typeof a.saved === 'boolean' ? a.saved : undefined,
    total: (a.tracksV2 && a.tracksV2.totalCount) || 0,
    shareUrl: (a.sharingInfo && a.sharingInfo.shareUrl) || undefined,
    format: a.type || undefined,
  });
}

/** A playlist or album: a row that opens to its tracks; an album's artists in `artist`. */
export function contextRow(d: any): LibraryItem | null {
  if (!d || !/^spotify:(playlist|album):/.test(d.uri || '') || !d.name) return null;
  const by = artists(d.artists), o = d.ownerV2 && d.ownerV2.data;
  const total = [d.content, d.tracks, d.tracksV2].map((x: any) => x && x.totalCount).find((n: any) => typeof n === 'number');
  return clean<LibraryItem>({ uri: d.uri, name: d.name, artist: by || undefined,
    image: midImage((d.coverArt && d.coverArt.sources) || (d.images && d.images.items && d.images.items[0] && d.images.items[0].sources)),
    owner: (o && o.name) || undefined, total,
    editable: d.currentUserCapabilities && d.currentUserCapabilities.canEditItems === true ? true : undefined });
}
const rows = <T>(l: (T | null | undefined)[]) => l.filter((x): x is T => !!x);
const withUid = (t: Track | null, uid: unknown): Track | null => (t && typeof uid === 'string' && uid ? { ...t, uid } : t);

/** Feed the enrichment cache: rows by uri, a collection's first page, names. */
export function remember(sp: Sp, tracks: Track[], list?: string, items: LibraryItem[] = []): void {
  for (const t of tracks) sp.cache.tracks.set(t.uri, t);
  if (list) sp.cache.lists.set(list, tracks);
  for (const it of items) sp.cache.names.set(it.uri, it.name);
}

/** libraryV3: the user's playlists and saved albums, in library order (8 pages of 50 at most;
 *  folders are not opened). Liked Songs is its own collection; its cover is remembered. */
export async function fetchLibraryList(sp: Sp): Promise<LibraryItem[]> {
  let acc: LibraryItem[] = [];
  // ponytail: 8 pages (400 entries); folders are not opened.
  for (let offset = 0; offset < 400; offset += 50) {
    const d = await query(sp, 'libraryV3', { filters: [], order: null, textFilter: '',
      features: ['LIKED_SONGS', 'YOUR_EPISODES_V2', 'PRERELEASES', 'EVENTS'], limit: 50, offset, flatten: false,
      expandedFolders: [], folderUri: null, includeFoldersWhenFlattening: true });
    const L = d && d.me && d.me.libraryV3;
    if (!L) break;
    const got = rows((L.items || []).map((i: any) => contextRow(i.item && i.item.data)) as (LibraryItem | null)[]);
    const pseudo = (L.items || []).map((i: any) => i.item && i.item.data).find((x: any) => x && x.uri === LIKED);
    if (pseudo) sp.cache.likedImage = bigImage(pseudo.image && pseudo.image.sources) ?? sp.cache.likedImage;
    acc = acc.concat(got);
    remember(sp, [], undefined, got);
    for (const i of L.items || []) {
      const d = i.item && i.item.data, o = d && d.ownerV2 && d.ownerV2.data;
      if (d && d.uri && o && o.uri) sp.cache.owners.set(d.uri, o.uri);
    }
    if (offset + 50 >= (L.totalCount || 0)) break;
  }
  return acc;
}

/** One page of a collection: playlists 100 at a time (fetchPlaylist), albums and Liked Songs 50
 *  (getAlbum, fetchLibraryTracks); the details (meta) with the first page. An artist uri is
 *  fetchArtist's top tracks. */
export async function fetchCollectionPage(sp: Sp, uri: string, offset = 0, quiet = false): Promise<CollectionPage> {
  if (uri.startsWith('spotify:artist:')) {
    const a = await fetchArtist(sp, uri);
    return { meta: a.meta, tracks: offset ? [] : a.tracks, total: a.tracks.length };
  }
  const liked = uri === LIKED, album = uri.startsWith('spotify:album:');
  const o = { quiet };
  const d: any = await (liked ? query(sp, 'fetchLibraryTracks', { offset, limit: 50 }, o)
    : album ? query(sp, 'getAlbum', { uri, locale: '', offset, limit: 50 }, o)
    : query(sp, 'fetchPlaylist', { uri, offset, limit: 100, enableWatchFeedEntrypoint: false,
                                   includeEpisodeContentRatingsV2: false }, o));
  const root = liked ? d && d.me && d.me.library : album ? d && d.albumUnion : d && d.playlistV2;
  const page = liked ? root && root.tracks : album ? root && root.tracksV2 : root && root.content;
  if (!liked && root && root.name) { sp.ctxNames[uri] = root.name; sp.cache.names.set(uri, root.name); }
  const albumInfo: AlbumInfo = album && root ? { name: root.name, uri, image: smallImage(root.coverArt && root.coverArt.sources), date: dateOf(root.date) } : {};
  const tracks = rows(((page && page.items) || []).map((i: any) =>
    liked ? i.track && trackRow(i.track.data, null, i.track._uri)
    : album ? trackRow(i.track, uri, null, albumInfo) : withUid(trackRow(i.itemV2 && i.itemV2.data, uri), i.uid)) as (Track | null)[]);
  const total = Math.max((page && page.totalCount) || 0, offset + tracks.length);
  const next = offset + tracks.length;
  const meta: CollectionMeta | undefined = offset || !root ? undefined
    : liked ? clean<CollectionMeta>({ kind: 'liked', name: 'Liked Songs', total, image: sp.cache.likedImage })
    : album ? albumMeta(root) : playlistMeta(root);
  remember(sp, tracks, offset ? undefined : uri);
  if (liked) for (const t of tracks) sp.cache.saved.set(t.uri, true);   // Liked Songs rows are saved
  if (!liked && !album) {                                                // playlist membership + uids
    const m = sp.cache.members.get(uri) ?? new Map<string, string>();
    for (const t of tracks) m.set(t.uri, t.uid ?? m.get(t.uri) ?? '');
    sp.cache.members.set(uri, m);
    if (!(tracks.length && next < total)) sp.cache.scanned.set(uri, Date.now());   // the last page: complete
  }
  // The playing context: its name and its tracks name the Now Playing / Up Next rows too.
  if (!offset && sp.last && sp.last.context_uri === uri) onState(sp, sp.last, true);
  return { ...(meta ? { meta } : {}), tracks, total, ...(tracks.length && next < total ? { nextOffset: next } : {}) };
}
