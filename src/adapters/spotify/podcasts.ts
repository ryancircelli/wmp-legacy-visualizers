/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// Podcasts: the followed shows (libraryV3 under Your Library's filter id "Podcasts & Shows", named
// "Podcasts": confirmed against the live API 2026-10-04, where the id "Podcasts" answers a
// LibraryInvalidFilterIdError and the items are PodcastResponseWrapper { _uri, data: Podcast }; paged as the Artists
// chip is) and a show's episodes (pathfinder queryPodcastEpisodes with { uri, offset, limit }, read at
// data.podcastUnionV2.episodesV2 { totalCount, items }, as github.com/Aran404/SpotAPI spotapi/podcast.py
// sends and reads it). Neither shape is in our own captures: both are read defensively and the host's
// log says when one is not what was expected. The episodes' hash comes from the bundle scan alone (none
// baked), after the hidden app has been to a show's page once (the chunk that declares it).
import type { CollectionPage, LibraryItem, Track } from '../../model';
import { dateOf, libraryPages, midImage, remember, smallImage } from './library';
import { hashFor, query, rescan, visitRoute } from './pathfinder';
import { RateLimitError, type Sp } from './sp';

const log = (s: string) => window.alchemyLog?.('spotify: ' + s);
const SHOWS = 'Podcasts & Shows', EPISODES = 'queryPodcastEpisodes';
const sources = (d: any) => (d.coverArt && d.coverArt.sources) || (d.images && d.images.items && d.images.items[0] && d.images.items[0].sources);

/** A followed show (libraryV3's Podcast): a row that opens to its episodes; `owner` its publisher. */
export function showRow(d: any): LibraryItem | null {
  if (!d || !/^spotify:show:/.test(d.uri || '') || !d.name) return null;
  const image = midImage(sources(d)), owner = d.publisher && d.publisher.name;
  return { uri: d.uri, name: d.name, ...(image ? { image } : {}), ...(owner ? { owner } : {}) };
}

/** The followed shows, in Your Library's order (up to 400). The Podcasts filter is asked for; a podcast
 *  filter libraryV3 offers under another id is asked for next, and a refused filter falls back to the
 *  whole library with its shows kept. None found: the host's log names the filters offered and the
 *  kinds of item seen. */
export async function fetchShows(sp: Sp): Promise<LibraryItem[]> {
  let offered: { id?: string; name?: string }[] = [];
  const kinds = new Set<string>();
  const pages = async (filters: string[]) => {
    const acc: LibraryItem[] = [];
    await libraryPages(sp, filters, (L) => {
      if (Array.isArray(L.availableFilters)) offered = L.availableFilters;
      for (const i of L.items || []) {
        const r = showRow(i && i.item && i.item.data && { uri: i.item._uri, ...i.item.data });
        if (r) acc.push(r); else kinds.add(String(i && i.item && i.item.__typename));
      }
    });
    return acc;
  };
  let acc = await pages([SHOWS]).catch((e: unknown) => { if (e instanceof RateLimitError) throw e; return null; });
  const other = offered.find((f) => f && f.id && f.id !== SHOWS && /podcast|show/i.test(f.id + ' ' + (f.name ?? '')))?.id;
  if (!acc?.length && other) acc = await pages([other]);
  else if (!acc) acc = await pages([]);
  if (!acc.length) log('libraryV3: no followed shows (filters offered: ' + (offered.map((f) => f && f.id).join(', ') || 'none') + '; items: ' + ([...kinds].join(', ') || 'none') + ')');
  remember(sp, [], undefined, acc);
  return acc;
}

/** an episode item's data, whichever wrapper it comes in */
const unwrap = (x: any) => (x && ((x.entity && x.entity.data) || (x.episode && x.episode.data) || (x.itemV2 && x.itemV2.data) || x.data)) || x;

/** An episode -> a row that plays in its show (`ctx`): the show's name as artist and album, its date,
 *  length and cover; `unplayed` only where Spotify says (playedState.state NOT_STARTED). */
export function episodeRow(x: any, show: string, showName = ''): Track | null {
  const d = unwrap(x);
  if (!d || !/^spotify:episode:/.test(d.uri || '') || !d.name) return null;
  const pics = sources(d), name: string = (d.podcastV2 && d.podcastV2.data && d.podcastV2.data.name) || showName;
  const state = d.playedState && d.playedState.state, image = smallImage(pics), date = dateOf(d.releaseDate);
  return { uri: d.uri, title: d.name, artist: name, album: name, duration: (d.duration && d.duration.totalMilliseconds) || 0, ctx: show,
           art: midImage(pics) ?? null, ...(image ? { image } : {}), ...(date ? { releaseDate: date } : {}),
           ...(typeof state === 'string' ? { unplayed: state === 'NOT_STARTED' } : {}) };
}

/** One page of a show's episodes (50), in Spotify's order; remembered, so Now Playing can name an episode
 *  whose state carries little. */
export async function fetchShowPage(sp: Sp, uri: string, offset = 0): Promise<CollectionPage> {
  await (sp.scan || rescan(sp));   // the bundles read first: the route is visited only when they lack the hash
  await visitRoute(sp, '/show/' + (uri.split(':')[2] ?? ''), [EPISODES]);
  if (!hashFor(sp, EPISODES)) log('no hash for ' + EPISODES + ' in the page\'s bundles: a show\'s episodes cannot be listed');
  const d = await query(sp, EPISODES, { uri, offset, limit: 50 });
  const p = d && d.podcastUnionV2, e = p && p.episodesV2, items: any[] = (e && e.items) || [];
  if (!e) log(EPISODES + ': unexpected shape (data: ' + Object.keys(d || {}).join(', ') + '; podcastUnionV2: ' + Object.keys(p || {}).join(', ') + ')');
  const name: string = (p && p.name) || sp.cache.names.get(uri) || '';
  const tracks = items.map((x) => episodeRow(x, uri, name)).filter((t): t is Track => !!t);
  if (items.length && !tracks.length) log(EPISODES + ': no episode read in ' + items.length + ' items (the first\'s keys: ' + Object.keys(items[0] || {}).join(', ') + ')');
  const total = Math.max((e && e.totalCount) || 0, offset + tracks.length), next = offset + items.length;
  if (name) sp.cache.names.set(uri, name);
  remember(sp, tracks, offset ? undefined : uri);
  return { tracks, total, ...(items.length && next < total ? { nextOffset: next } : {}) };
}
