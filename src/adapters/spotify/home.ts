/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
// Media Guide = Spotify's home feed (pathfinder `home`, spike 3), as sections of tiles.
import type { HomeFeed, HomeItem, HomeSection } from '../../model';
import { artists, plain } from './library';
import { query } from './pathfinder';
import type { Sp } from './sp';

/** Image sources come as {url,width|maxWidth}: the smallest that still covers a 96 px tile (x1.5). */
export function pic(sources: any): string | null {
  let best: any = null, bw = 0;
  for (const x of sources || []) {
    const w = x.width || x.maxWidth || 0;
    if (!best || (w >= 144 && (bw < 144 || w < bw)) || (bw < 144 && w > bw)) { best = x; bw = w; }
  }
  return best ? best.url : null;
}

/** One home section item -> a tile; kinds we cannot play are dropped. */
function homeItem(c: any): HomeItem | null {
  const d = c && c.data;
  if (!d) return null;
  switch (c.__typename) {
    case 'PlaylistResponseWrapper':
      return { uri: d.uri, name: d.name, sub: plain(d.description) || (d.ownerV2 && d.ownerV2.data && d.ownerV2.data.name) || '',
               img: pic(d.images && d.images.items && d.images.items[0] && d.images.items[0].sources) };
    case 'AlbumResponseWrapper': {
      const a0 = d.artists && d.artists.items && d.artists.items[0];
      return { uri: d.uri, name: d.name, sub: artists(d.artists), img: pic(d.coverArt && d.coverArt.sources),
               artist: a0 && a0.uri ? { uri: a0.uri, name: a0.profile && a0.profile.name } : null };
    }
    case 'ArtistResponseWrapper':
      return { uri: d.uri, name: d.profile && d.profile.name, sub: 'Artist',
               img: pic(d.visuals && d.visuals.avatarImage && d.visuals.avatarImage.sources) };
    case 'EntityResponseWrapper': {       // the Recents list: entities with traits
      const id = d.identityTrait || {}, vi = d.visualIdentityTrait && d.visualIdentityTrait.squareCoverImage;
      return { uri: d.uri || c._uri, name: id.name, sub: id.type || '',
               img: pic(vi && vi.image && vi.image.data && vi.image.data.sources) };
    }
  }
  return null;
}

/** data.home.sectionContainer.sections.items -> sections. The one-tile "baseline" sections that
 *  share a title are folded together; the untitled shortcuts row takes the greeting. */
export function parseHome(d: any): HomeSection[] {
  const h = d && d.home, out: HomeSection[] = [], byTitle: Record<string, HomeSection> = {};
  const secs = (h && h.sectionContainer && h.sectionContainer.sections && h.sectionContainer.sections.items) || [];
  for (const sec of secs) {
    const sd = sec.data || {}, title: string = (sd.title && sd.title.transformedLabel) ||
      (h.greeting && h.greeting.transformedLabel) || 'Home';
    let list: (HomeItem | null)[] = [];
    for (const it of (sec.sectionItems && sec.sectionItems.items) || []) {
      const c = it.content || {};
      if (c.__typename === 'ListResponseWrapper') {
        for (const e of (c.data && c.data.items && c.data.items.items) || []) list.push(homeItem(e.entity));
      } else list.push(homeItem(c));
    }
    list = list.filter((x) => x && x.uri && x.name && /^spotify:(playlist|album|artist|track|episode|show|collection)/.test(x.uri));
    if (!list.length) continue;
    const got = list as HomeItem[];
    if (byTitle[title]) { byTitle[title].items = byTitle[title].items.concat(got); continue; }
    out.push(byTitle[title] = { title, items: got });
  }
  return out;
}

/** The page's own sp_t cookie (an opaque origin throws on document.cookie). */
function cookie(n: string): string {
  let c = '';
  try { c = document.cookie || ''; } catch { /* opaque origin */ }
  const m = new RegExp('(?:^|; )' + n + '=([^;]*)').exec(c);
  return m ? decodeURIComponent(m[1]!) : '';
}

/** Spotify's home feed (pathfinder `home` as the web player sends it); remembered for the radio seeds. */
export async function fetchHome(sp: Sp): Promise<HomeFeed> {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no Intl zone */ }
  const d = await query(sp, 'home', { homeEndUserIntegration: 'INTEGRATION_WEB_PLAYER', timeZone: tz, sp_t: cookie('sp_t'),
                                      facet: '', sectionItemsLimit: 10, includeEpisodeContentRatingsV2: true });
  const greeting: string = (d && d.home && d.home.greeting && d.home.greeting.transformedLabel) || '';
  return (sp.cache.home = { greeting, sections: parseHome(d) });
}
