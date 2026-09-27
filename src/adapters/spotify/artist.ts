/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
// An artist as a Media Library collection: queryArtistOverview (top tracks, header, followers,
// bio, the discography teaser) and queryArtistDiscographyAll / ...Albums for the album list. The
// discography ops live in the artist route's chunk: the hidden app is sent to /artist/<id> once
// so the page loads it, then the bundles are rescanned. Without the overview op the albums come
// from a search for the artist's name.
// Shapes and variables as captured from the web player in spike 4 (2026-09-25, SPIKE4.md).
import type { ArtistPage, CollectionMeta, LibraryItem, Track } from '../../model';
import { albumMeta, bigImage, contextRow, plain, remember, trackRow } from './library';
import { onState } from './state';
import { hashFor, query, searchRoute, visitRoute } from './pathfinder';
import { RateLimitError, status, type Sp } from './sp';

const DISCOG = ['queryArtistDiscographyAll', 'queryArtistDiscographyAlbums'];
const items = (p: any): any[] => (p && p.items) || [];
const ok = <T>(l: (T | null | undefined)[]) => l.filter((x): x is T => !!x);
function uniq(l: LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  return l.filter((x) => !seen.has(x.uri) && !!seen.add(x.uri));
}
/** A release (album / single / compilation) -> a list row; they carry no artists of their own. */
const release = (r: any): LibraryItem | null => contextRow(r && { ...r, artists: undefined });

function fromOverview(a: any, uri: string): { name: string; meta: CollectionMeta; tracks: Track[]; albums: LibraryItem[] } {
  const name: string = (a.profile && a.profile.name) || '';
  const tracks = ok<Track>(items(a.discography && a.discography.topTracks).map((i) => trackRow(i.track || (i.data ?? i), uri)));
  const disc = a.discography || {};
  const albums = ok<LibraryItem>([
    ...items(disc.popularReleasesAlbums).map(release),
    ...['albums', 'singles', 'compilations'].flatMap((k) => items(disc[k]).flatMap((g) => items(g.releases).map(release))),
  ]);
  const bio = a.profile && a.profile.biography && a.profile.biography.text;
  const meta: CollectionMeta = { kind: 'artist', name, total: tracks.length };
  const image = bigImage(a.visuals && a.visuals.avatarImage && a.visuals.avatarImage.sources)
    || bigImage(a.headerImage && a.headerImage.data && a.headerImage.data.sources);
  if (image) meta.image = image;
  if (a.stats && typeof a.stats.followers === 'number') meta.followers = a.stats.followers;
  if (bio) meta.description = plain(bio);
  if (a.sharingInfo && a.sharingInfo.shareUrl) meta.shareUrl = a.sharingInfo.shareUrl;
  return { name, meta, tracks, albums: uniq(albums) };
}

/** The whole discography, when the page's own op is known. */
async function discography(sp: Sp, uri: string): Promise<LibraryItem[] | null> {
  const op = DISCOG.find((o) => hashFor(sp, o));
  if (!op) return null;
  // ponytail: the first 50 releases (the page pages by 20); Queen has 95.
  const d = await query(sp, op, { uri, offset: 0, limit: 50, order: 'DATE_DESC' });
  const disc = d && d.artistUnion && d.artistUnion.discography;
  if (!disc) return null;
  return uniq(ok<LibraryItem>(items(disc.all || disc.albums).flatMap((g) => items(g.releases).map(release))));
}

/** No overview: the artist's albums from a search for their name. */
async function albumsBySearch(sp: Sp, uri: string, name: string): Promise<LibraryItem[]> {
  if (!name) return [];
  await searchRoute(sp);
  const d = await query(sp, 'searchDesktop', { searchTerm: name, offset: 0, limit: 30, numberOfTopResults: 5,
    includeAudiobooks: false, includeArtistHasConcertsField: false, includePreReleases: false,
    includeLocalConcertsField: false, includeAuthors: false });
  const low = name.toLowerCase();
  return ok<LibraryItem>(items(d && d.searchV2 && d.searchV2.albumsV2).map((i) => i.data).filter((a) =>
    a && items(a.artists).some((x) => x.uri === uri || (x.profile && String(x.profile.name).toLowerCase() === low)))
    .map(contextRow));
}

/** The details of an album (getAlbum's first page); its name is remembered for naming rows. */
export async function fetchAlbumMeta(sp: Sp, uri: string, quiet = false): Promise<CollectionMeta> {
  const d = await query(sp, 'getAlbum', { uri, locale: '', offset: 0, limit: 50 }, { quiet });
  const meta = albumMeta(d.albumUnion || {});
  if (meta.name) sp.cache.names.set(uri, meta.name);
  return meta;
}

/** An artist: overview (details, top tracks, teaser) + the whole discography when its op is known.
 *  Without the overview the albums come from a search for the artist's name (status bar says so). */
export async function fetchArtist(sp: Sp, uri: string): Promise<ArtistPage> {
  await visitRoute(sp, '/artist/' + (uri.split(':')[2] ?? ''), DISCOG);
  const d = hashFor(sp, 'queryArtistOverview')
    ? await query(sp, 'queryArtistOverview', { uri, locale: '', preReleaseV2: false }).catch((e: unknown) => {
      if (e instanceof RateLimitError) throw e;
      return null;
    }) : null;
  const a = d && d.artistUnion;
  const known = sp.cache.names.get(uri) ?? '';
  let teaser: LibraryItem[] = [];
  let r: { name: string; meta: CollectionMeta; tracks: Track[]; albums: LibraryItem[] };
  if (a && a.profile) {
    r = fromOverview(a, uri);
    teaser = r.albums;
    const all = await discography(sp, uri).catch(() => null);
    if (all && all.length) r.albums = all;
  } else {
    status(sp, 'Spotify: artist page unavailable — albums from a search');
    r = { name: known, meta: { kind: 'artist', name: known, total: 0 }, tracks: [],
          albums: await albumsBySearch(sp, uri, known).catch(() => []) };
  }
  const name = r.name || known;
  // Top tracks' albumOfTrack carries no name: the discography's, the player's when it is the
  // playing track, else one getAlbum per album (names cached), at most 5 per artist.
  const albumName = new Map(teaser.concat(r.albums).map((x) => [x.uri, x.name]));
  const playing = sp.last?.track;
  for (const t of r.tracks) {
    if (!t.album && t.albumUri) t.album = albumName.get(t.albumUri) ?? sp.cache.names.get(t.albumUri);
    if (!t.album && playing?.uri === t.uri && playing.metadata?.album_title) t.album = playing.metadata.album_title;
    if (!t.album) delete t.album;
  }
  const missing = [...new Set(r.tracks.filter((t) => !t.album && t.albumUri).map((t) => t.albumUri!))].slice(0, 5);
  await Promise.all(missing.map((u) => fetchAlbumMeta(sp, u, true).catch(() => null)));
  for (const t of r.tracks) if (!t.album && t.albumUri && sp.cache.names.get(t.albumUri)) t.album = sp.cache.names.get(t.albumUri);
  if (name) sp.cache.names.set(uri, name);
  remember(sp, r.tracks, uri, r.albums);
  // Playing this artist: the state gets its name (artist-context plays carry no artist_name).
  const pb = sp.store.getState().playback;
  if (sp.last && pb.track && !pb.track.artist && (sp.last.context_uri === uri || sp.last.track?.metadata?.artist_uri === uri)) onState(sp, sp.last, true);
  return { meta: { ...r.meta, name }, tracks: r.tracks, albums: r.albums };
}

/** Open an artist in the Media Library (no uri: the playing track's artist): only the selection;
 *  the page is fetched by whoever shows it (fetchArtist). */
export function openArtist(sp: Sp, uri?: string): void {
  const md = sp.last?.track?.metadata ?? {};
  const u = uri || md.artist_uri;
  if (!u || !/^spotify:artist:/.test(u)) return;
  if (!uri && md.artist_name && !sp.cache.names.has(u)) sp.cache.names.set(u, md.artist_name);
  const { actions } = sp.store.getState();
  actions.setUi({ libNode: u, libSel: null });
  actions.setView('library');
}
