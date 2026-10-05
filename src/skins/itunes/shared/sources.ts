// The source list: Spotify laid onto iTunes 10's sidebar (docs/itunes-skin.md §2). iTunes' sections
// in its order, each holding what Spotify has in that place:
//   LIBRARY    Music (Liked Songs; its Grid: the saved albums, the followed artists), Podcasts (the
//              followed shows), Radio (stations seeded from what plays)
//   STORE      Spotify (the home feed, as the iTunes Store's front page), Search Results (while a
//              search is typed: iTunes searched the store from the same box)
//   GENIUS     Genius (the playing song's radio, as a playlist), Genius Mixes (Spotify's made-for-you mixes)
//   PLAYLISTS  iTunes DJ (the Up Next queue), Recently Played (a smart playlist in iTunes), then the
//              library's playlists in library order
// Movies, TV Shows, iTunes U, Books, Apps, Ringtones, Ping, Purchased and SHARED have no Spotify
// counterpart and are not shown. Nor is DEVICES: in iTunes 10 it held the synced iPods, and speakers were
// the AirPlay menu's (the bottom bar's), where the Connect devices are; both was the same list twice (the
// owner, 2026-10-04: "redundant ui on a tight screen space").
import { LIKED, type LibraryItem } from '../../../model';
import { isAlbum, useApp, useLibraryList } from '../../../ui';
import type { IconName } from './icons';

export type SourceKind = 'music' | 'podcasts' | 'radio' | 'store' | 'search' | 'genius' | 'mixes' | 'dj' | 'recent' | 'playlist';

export interface Source {
  /** the selection key ('music', 'store', 'device:<id>', or a playlist's uri) */
  id: string;
  label: string;
  icon: IconName;
  kind: SourceKind;
  /** the collection it lists, when it is one (Music: Liked Songs; a playlist: itself) */
  uri?: string;
  /** the count pill at the right (the queue's length on iTunes DJ) */
  badge?: string;
  /** a device that is playing now */
  on?: boolean;
}
export interface SourceSection { id: 'library' | 'store' | 'genius' | 'playlists'; title: string; items: Source[] }

export interface SourceInput {
  spotify: boolean;
  /** the library list (playlists and saved albums; the albums are Music's Grid, not rows here) */
  library: readonly LibraryItem[];
  searchQ: string;
  /** Up Next's length */
  queue: number;
}

/** The sections from what the app knows (pure: the tests' and both layouts'). Nothing without Spotify:
 *  the local engine has no library, and the layouts show the visualizer instead. */
export function buildSources(i: SourceInput): SourceSection[] {
  if (!i.spotify) return [];
  const sections: SourceSection[] = [
    { id: 'library', title: 'LIBRARY', items: [
      { id: 'music', label: 'Music', icon: 'music', kind: 'music', uri: LIKED },
      { id: 'podcasts', label: 'Podcasts', icon: 'podcast', kind: 'podcasts' },
      { id: 'radio', label: 'Radio', icon: 'radio', kind: 'radio' },
    ] },
    { id: 'store', title: 'STORE', items: [
      { id: 'store', label: 'Spotify', icon: 'store', kind: 'store' },
      ...(i.searchQ.trim() ? [{ id: 'search', label: 'Search Results', icon: 'search' as const, kind: 'search' as const }] : []),
    ] },
    { id: 'genius', title: 'GENIUS', items: [
      { id: 'genius', label: 'Genius', icon: 'genius', kind: 'genius' },
      { id: 'mixes', label: 'Genius Mixes', icon: 'mixes', kind: 'mixes' },
    ] },
    { id: 'playlists', title: 'PLAYLISTS', items: [
      { id: 'dj', label: 'iTunes DJ', icon: 'dj', kind: 'dj', ...(i.queue ? { badge: String(i.queue) } : {}) },
      { id: 'recent', label: 'Recently Played', icon: 'smart', kind: 'recent' },
      ...i.library.filter((p) => !isAlbum(p.uri)).map((p) => ({ id: p.uri, label: p.name, icon: 'playlist' as const, kind: 'playlist' as const, uri: p.uri })),
    ] },
  ];
  return sections.filter((s) => s.items.length);
}

/** The source list over the store and the library query; `find(id)` resolves a selection (a
 *  selection that no longer exists, a playlist deleted or a device gone, resolves to undefined: the
 *  layouts fall back to Music). */
export function useSources(): { sections: SourceSection[]; find: (id: string) => Source | undefined; loading: boolean } {
  const st = useApp((s) => ({ spotify: s.auth.engine === 'spotify', searchQ: s.ui.searchQ, queue: s.queue.next.length }));
  const lib = useLibraryList();
  const sections = buildSources({ ...st, library: lib.items });
  const find = (id: string) => {
    for (const s of sections) for (const x of s.items) if (x.id === id) return x;
    return undefined;
  };
  return { sections, find, loading: lib.loading };
}
