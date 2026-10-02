// The local engine has no catalogue: the same query surface as the Spotify adapter's, resolving to
// nothing (the Media Library, Guide, Search and Radio views stay empty in the app / website).
import type {
  ArtistPage, CollectionMeta, CollectionPage, HomeFeed, LibraryItem, Lyrics, RadioSeed, SearchPage, SearchResults, SearchType, Station, Track,
} from '../../model';

const page = <T>(): SearchPage<T> => ({ items: [], total: 0, offset: 0, exact: true, hasMore: false });
export const keys = {
  all: ['local'] as const,
  libraryList: () => ['local', 'library'] as const,
  collection: (uri: string) => ['local', 'collection', uri] as const,
  collectionPage: (uri: string, offset: number) => ['local', 'collection', uri, offset] as const,
  search: (q: string, type: SearchType, offset = 0) => ['local', 'search', q.trim(), type, offset] as const,
  home: () => ['local', 'home'] as const,
  radio: (seedUris: readonly string[]) => ['local', 'radio', ...seedUris] as const,
  artist: (uri: string) => ['local', 'artist', uri] as const,
  album: (uri: string) => ['local', 'album', uri] as const,
  lyrics: (trackId: string) => ['local', 'lyrics', trackId] as const,
  saved: (uris: readonly string[]) => ['local', 'saved', ...uris] as const,
  followedArtists: () => ['local', 'library', 'artists'] as const,
  canvas: (trackUri: string) => ['local', 'canvas', trackUri] as const,
};
export const savedKey = (uri: string) => ['local', 'saved', uri] as const;
export const fetchLibraryList = (): Promise<LibraryItem[]> => Promise.resolve([]);
export const fetchCollectionPage = (): Promise<CollectionPage> => Promise.resolve({ tracks: [], total: 0 });
export function fetchSearch(q: string, type: 'all', offset?: number, limit?: number): Promise<SearchResults>;
export function fetchSearch(q: string, type: Exclude<SearchType, 'all'>, offset?: number, limit?: number): Promise<SearchPage<Track | LibraryItem>>;
export function fetchSearch(q: string, type: SearchType, offset?: number, limit?: number): Promise<SearchResults | SearchPage<Track | LibraryItem>>;
export function fetchSearch(_q: string, type: SearchType = 'all'): Promise<SearchResults | SearchPage<Track | LibraryItem>> {
  return Promise.resolve(type === 'all' ? { tracks: page(), artists: page(), albums: page(), playlists: page() } : page());
}
export const fetchHome = (): Promise<HomeFeed> => Promise.resolve({ greeting: '', sections: [] });
export const radioSeeds = (): RadioSeed[] => [];
export const fetchRadio = (): Promise<Station[]> => Promise.resolve([]);
export const fetchArtist = (uri: string): Promise<ArtistPage> => Promise.resolve({ meta: { kind: 'artist', name: uri, total: 0 }, tracks: [], albums: [] });
export const fetchAlbumMeta = (uri: string): Promise<CollectionMeta> => Promise.resolve({ kind: 'album', name: uri, total: 0 });
export const fetchLyrics = (): Promise<Lyrics> => Promise.resolve({ status: 'none', lines: null, plain: null, track: null, source: null });
export const acceptLyrics = (): void => {};
export const fetchCanvas = (): Promise<null> => Promise.resolve(null);
export const fetchTrack = (): Promise<null> => Promise.resolve(null);
export const fetchSaved = (): Promise<Record<string, boolean>> => Promise.resolve({});
export const fetchFollowedArtists = (): Promise<never[]> => Promise.resolve([]);
export const setInvalidator = (): void => {};
export const membershipKey = (trackUri: string) => ['local', 'membership', trackUri] as const;
export const fetchEditablePlaylists = (): Promise<LibraryItem[]> => Promise.resolve([]);
export const fetchMembership = (): Promise<Record<string, boolean>> => Promise.resolve({});
export const applyMembership = (): void => {};
export const remember = (): void => {};
export const retryPolicy = { retry: (): boolean => false, retryDelay: (): number => 1000 };
