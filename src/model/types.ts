// The shapes the store holds. Framework-free: no DOM, no React.
// Times: every position/duration in the store is milliseconds; `at` stamps are Date.now().

/** CONTRACT.md: one WMP Render() input (state 2 = playing); the engine's own type. */
export type { TimedLevel } from '../engine/ns';

export type MediaStatus = 'playing' | 'paused' | 'stopped' | 'none';
export type RepeatMode = 'off' | 'context' | 'track';
/** Spotify's three-way shuffle button: off, shuffle, Smart Shuffle (shuffle plus recommendations in the queue) */
export type ShuffleMode = 'off' | 'shuffle' | 'smart';
/** The task pane's views; Play on Device is the bottom bar's device button, not a view. */
export type View = 'now' | 'guide' | 'library' | 'search' | 'radio';
export type VisKind = 'alchemy' | 'bars' | 'battery' | 'spikes';
export type Mode = 'web' | 'app' | 'screensaver';

/** A track row anywhere: Now Playing, Up Next, a playlist/album/Liked Songs page, search. */
export interface Track {
  uri: string;
  title: string;
  artist: string;
  /** absent when no source names it (an artist's top track outside everything we could look up) */
  album?: string;
  /** ms, 0 when unknown */
  duration: number;
  art?: string | null;
  /** the context it plays in (its playlist/album, LIKED for a Liked Songs row); a click plays ctx starting at uri */
  ctx?: string | null;
  // Spotify only (absent from local sources):
  playcount?: number;
  explicit?: boolean;
  /** album cover, smallest source >= 64 px */
  image?: string;
  albumUri?: string;
  artistUris?: string[];
  /** the album's date: '2015-07-15', '2015-07' or '2015' as precise as Spotify gives it */
  releaseDate?: string;
  trackNumber?: number;
  discNumber?: number;
  /** a playlist row's item uid (removeFromPlaylist needs it) */
  uid?: string;
  /** a podcast episode Spotify says is not started yet (the iPod's blue dot); absent when it does not say */
  unplayed?: boolean;
  /** an Up Next row the user queued (Spotify's "Next in queue"; Clear queue removes these), not the context's own */
  queued?: boolean;
}

/** A playlist or album row (libraryV3, search, artist albums). */
export interface LibraryItem {
  uri: string;
  name: string;
  /** cover, the source nearest 300 px (Spotify only) */
  image?: string;
  /** a playlist's owner name, when the list carries it */
  owner?: string;
  /** an album's artists ("Queen, David Bowie"); `name` is the bare album name */
  artist?: string;
  /** a playlist the user can add tracks to (libraryV3's currentUserCapabilities.canEditItems) */
  editable?: boolean;
  /** tracks, when the list carries it */
  total?: number;
  /** set on artist rows only (search results) */
  kind?: 'artist';
}

export type SearchType = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';
/** One page of one bucket of search results (fetchSearch). Spotify's totalCount grows as you page
 *  (typed "queen" songs: 18, 36, then 46), so `total` is the latest count reported and `exact` is true
 *  only on a typed page with no next page; the full search's buckets are never exact (show "18+").
 *  hasMore / nextOffset: where the next page starts (absent = none; offsets stop at SEARCH_CAP).
 *  note: a typed op was unavailable and the full search stood in. */
export interface SearchPage<T> {
  items: T[];
  total: number;
  offset: number;
  exact: boolean;
  hasMore: boolean;
  nextOffset?: number;
  note?: string;
}
/** The full search (fetchSearch type 'all'): every bucket's first page and the top result. */
export interface SearchResults {
  top?: { kind: 'track' | 'artist' | 'album' | 'playlist'; item: Track | LibraryItem };
  tracks: SearchPage<Track>;
  /** artist rows: { uri, name, image, kind: 'artist' } */
  artists: SearchPage<LibraryItem>;
  albums: SearchPage<LibraryItem>;
  playlists: SearchPage<LibraryItem>;
}

/** The Media Library's details pane: what the first page of fetchPlaylist / getAlbum /
 *  fetchLibraryTracks says about the collection itself. */
export interface CollectionMeta {
  kind: 'playlist' | 'album' | 'liked' | 'artist';
  name: string;
  /** cover, largest source <= 640 px */
  image?: string;
  owner?: { name: string; uri: string; avatar?: string };
  /** playlist description, HTML stripped */
  description?: string;
  followers?: number;
  following?: boolean;
  artists?: { name: string; uri: string }[];
  /** '2015-07-15', '2015-07' or '2015' as precise as Spotify gives it */
  releaseDate?: string;
  label?: string;
  /** the copyright lines, one per line (© and ℗) */
  copyright?: string;
  saved?: boolean;
  /** tracks */
  total: number;
  shareUrl?: string;
  /** playlist format (e.g. '' or 'daylist'); for albums the album type ('ALBUM', 'SINGLE', ...) */
  format?: string;
}

/** One fetched page of a collection (fetchCollectionPage): the details with the first page;
 *  nextOffset absent = no more pages. */
export interface CollectionPage {
  meta?: CollectionMeta;
  tracks: Track[];
  total: number;
  nextOffset?: number;
}

/** An artist page (fetchArtist): details, top tracks, discography. */
export interface ArtistPage {
  meta: CollectionMeta;
  tracks: Track[];
  albums: LibraryItem[];
}


export interface PlayingContext {
  uri: string;
  /** 'playlist' | 'album' | 'artist' | 'show' | 'liked' (uri LIKED) */
  kind: string;
  /** "Playlist: Road Trip", or just "Playlist" until the name is known */
  label: string;
}

export interface HomeItem {
  uri: string;
  name: string;
  sub: string;
  img: string | null;
  /** an album tile's first artist (radio seeds) */
  artist?: { uri: string; name: string } | null;
}
export interface HomeSection {
  title: string;
  items: HomeItem[];
}

/** Media Guide: Spotify's home feed (fetchHome). */
export interface HomeFeed {
  greeting: string;
  sections: HomeSection[];
}
/** A radio seed (radioSeeds / fetchRadio): the uri a station is made from and how it is named. */
export interface RadioSeed {
  seed: string;
  name: string;
  sub: string;
  img?: string | null;
}

export interface Station {
  uri: string;
  name: string;
  sub?: string;
  img?: string | null;
}

export interface Device {
  id: string;
  name?: string;
  type?: string;
  active?: boolean;
  offline?: boolean;
  volume?: number;
}

/** CONTRACT v5 lyric line, converted to ms. */
export interface LyricLine {
  t: number;
  text: string;
  words?: { t: number; text: string }[];
}

/** Lyrics normalised from any source (fetchLyrics, the host's LRCLIB frames): times in ms. */
export interface Lyrics {
  status: 'synced' | 'plain' | 'none';
  lines: LyricLine[] | null;
  plain: string | null;
  track: { title: string; artist: string; uri?: string } | null;
  source: 'spotify' | 'lrclib' | null;
}

export interface CaptureSource {
  /** 'display' | 'wsaudio' | 'loopback' | 'tone' | 'file' */
  kind: string;
  label: string;
}
