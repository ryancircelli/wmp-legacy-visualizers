// The skin tests' harness: a real store, spy commands, and fake query functions (the engine's
// Queries surface, answering from plain data the test sets) under a QueryClient, so what is
// tested is the skin and src/ui over TanStack Query without an adapter or the network.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi, type Mock } from 'vitest';
import type { Queries } from '../../src/adapters';
import { makeShell, onKey } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import {
  createAppStore, noCommands, type AppStore, type ArtistPage, type CollectionMeta, type CollectionPage, type Commands, type HomeFeed, type LibraryItem, type Lyrics,
  type RadioSeed, type SearchPage, type SearchResults, type SearchType, type Station, type Track,
} from '../../src/model';
import { Root } from '../../src/skins/wmp9/Root';
import { ShellContext } from '../../src/ui';

const ticker = { nativeSize: () => [640, 480], debugText: () => '' } as unknown as Ticker;

/** What the fake catalogue serves. Change it, then `await h.refresh()`. */
export interface FakeData {
  list: LibraryItem[];
  /** collections: every track the collection has; `pageSize` pages them */
  collections: Record<string, { meta?: CollectionMeta; tracks: Track[]; total?: number; pageSize?: number }>;
  search: Record<string, SearchResults>;
  /** typed searches: every item of the bucket, paged `pageSize` at a time (exact once the last page is in, as the model says) */
  typed: Record<string, { items: (Track | LibraryItem)[]; total: number; exact?: boolean; pageSize?: number; note?: string }>;
  home: HomeFeed;
  stations: Station[];
  seeds: RadioSeed[];
  artists: Record<string, ArtistPage>;
  albums: Record<string, CollectionMeta>;
  /** Spotify's lyrics by track uri */
  lyrics: Record<string, Lyrics>;
  /** saved (Liked) flags by uri (absent = false) */
  saved: Record<string, boolean>;
  /** the playlists the user can add to, and which of them hold a track (track -> playlist -> in it) */
  editable: LibraryItem[];
  membership: Record<string, Record<string, boolean>>;
}

const empty = <T,>(): SearchPage<T> => ({ items: [], total: 0, offset: 0, exact: true, hasMore: false });
export const emptyResults = (): SearchResults => ({ tracks: empty(), artists: empty(), albums: empty(), playlists: empty() });

type Page = SearchResults | SearchPage<Track | LibraryItem>;
/** The fake Queries: each function a vitest mock (assert calls, swap an answer). */
export interface FakeQueries {
  keys: Record<string, unknown>;
  fetchLibraryList: Mock<() => Promise<LibraryItem[]>>;
  fetchCollectionPage: Mock<(uri: string, offset?: number) => Promise<CollectionPage>>;
  fetchSearch: Mock<(q: string, type?: SearchType, offset?: number) => Promise<Page>>;
  fetchHome: Mock<() => Promise<HomeFeed>>;
  radioSeeds: Mock<() => RadioSeed[]>;
  fetchRadio: Mock<() => Promise<Station[]>>;
  fetchArtist: Mock<(uri: string) => Promise<ArtistPage>>;
  fetchAlbumMeta: Mock<(uri: string) => Promise<CollectionMeta>>;
  fetchLyrics: Mock<(uri: string, image?: string | null) => Promise<Lyrics>>;
  acceptLyrics: Mock<(uri: string, l: Lyrics) => void>;
  fetchSaved: Mock<(uris: string[]) => Promise<Record<string, boolean>>>;
  savedKey: (uri: string) => unknown[];
  fetchEditablePlaylists: Mock<() => Promise<LibraryItem[]>>;
  fetchMembership: Mock<(track: string, pls: string[]) => Promise<Record<string, boolean>>>;
  membershipKey: (track: string) => unknown[];
  setInvalidator: Mock<() => void>;
  applyMembership: Mock<() => void>;
  remember: Mock<() => void>;
  retryPolicy: { retry: () => boolean; retryDelay: () => number };
}

export function fakeQueries(data: FakeData): FakeQueries {
  const k = (...a: unknown[]) => ['fake', ...a];
  return {
    keys: {
      all: ['fake'], libraryList: () => k('library'), collection: (uri: string) => k('collection', uri),
      collectionPage: (uri: string, o: number) => k('collection', uri, o),
      search: (s: string, t: SearchType, o = 0) => k('search', s.trim(), t, o), home: () => k('home'),
      radio: (seeds: readonly string[]) => k('radio', ...seeds), artist: (uri: string) => k('artist', uri), album: (uri: string) => k('album', uri),
      lyrics: (id: string) => k('lyrics', id), saved: (uris: readonly string[]) => k('saved', ...uris),
    },
    fetchSaved: vi.fn((uris: string[]) => Promise.resolve(Object.fromEntries(uris.map((u) => [u, !!data.saved[u]])))),
    savedKey: (uri: string) => k('saved', uri),
    fetchEditablePlaylists: vi.fn(() => Promise.resolve(data.editable)),
    fetchMembership: vi.fn((track: string, pls: string[]) => Promise.resolve(Object.fromEntries(pls.filter((p) => p in (data.membership[track] ?? {}))
      .map((p) => [p, data.membership[track]![p]!])))),
    membershipKey: (track: string) => k('membership', track),
    setInvalidator: vi.fn(),
    applyMembership: vi.fn(),
    fetchLibraryList: vi.fn(() => Promise.resolve(data.list)),
    fetchCollectionPage: vi.fn((uri: string, offset = 0): Promise<CollectionPage> => {
      const c = data.collections[uri] ?? { tracks: [] };
      const size = c.pageSize ?? Math.max(1, c.tracks.length), total = c.total ?? c.tracks.length, end = offset + size;
      return Promise.resolve({ ...(offset ? {} : { meta: c.meta }), tracks: c.tracks.slice(offset, end), total, ...(end < total ? { nextOffset: end } : {}) });
    }),
    fetchSearch: vi.fn((s: string, type: SearchType = 'all', offset = 0): Promise<Page> => {
      if (type === 'all') return Promise.resolve(data.search[s.trim()] ?? emptyResults());
      const b = data.typed[s.trim() + '|' + type] ?? { items: [], total: 0 };
      const size = b.pageSize ?? 20, items = b.items.slice(offset, offset + size), more = offset + size < b.items.length;
      return Promise.resolve({ items, total: b.total, offset, exact: b.exact ?? !more, hasMore: more, ...(more ? { nextOffset: offset + size } : {}),
                               ...(b.note ? { note: b.note } : {}) });
    }),
    fetchHome: vi.fn(() => Promise.resolve(data.home)),
    radioSeeds: vi.fn(() => data.seeds),
    fetchRadio: vi.fn(() => Promise.resolve(data.stations)),
    fetchArtist: vi.fn((uri: string) => Promise.resolve(data.artists[uri] ?? { meta: { kind: 'artist' as const, name: uri, total: 0 }, tracks: [], albums: [] })),
    fetchAlbumMeta: vi.fn((uri: string) => Promise.resolve(data.albums[uri] ?? { kind: 'album' as const, name: uri, total: 0 })),
    fetchLyrics: vi.fn((uri: string) => Promise.resolve(data.lyrics[uri] ?? { status: 'none' as const, lines: null, plain: null, track: null, source: 'spotify' as const })),
    acceptLyrics: vi.fn(),
    remember: vi.fn(),
    retryPolicy: { retry: () => false, retryDelay: () => 0 },
  };
}

export interface Mounted extends ReturnType<typeof render> {
  store: AppStore;
  cmd: { [K in keyof Commands]: Mock<(...a: unknown[]) => unknown> };
  sh: ReturnType<typeof makeShell>;
  queries: FakeQueries;
  client: QueryClient;
  data: FakeData;
  S: () => ReturnType<AppStore['getState']>;
  $: (sel: string) => HTMLElement | null;
  key: (key: string, o?: KeyboardEventInit) => void;
  refresh: () => Promise<void>;
  settle: () => Promise<void>;
}

export const fakeData = (o: Partial<FakeData> = {}): FakeData => ({
  list: [], collections: {}, search: {}, typed: {}, home: { greeting: '', sections: [] }, stations: [], seeds: [], artists: {}, albums: {}, lyrics: {},
  saved: {}, editable: [], membership: {}, ...o,
});

/** Let pending queries settle (their promises and React's updates). */
export const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

/** The WMP 9 skin over a store, spy commands and the fake catalogue; queries settled. */
export async function mountSkin(engine: 'local' | 'spotify' = 'spotify', data: FakeData = fakeData(), extra?: ReactNode): Promise<Mounted> {
  const m = mountSkinNow(engine, data, extra);
  await settle();
  return m;
}

/** mountSkin without waiting for the queries (a test that starts with no fetched data). */
export function mountSkinNow(engine: 'local' | 'spotify' = 'spotify', data: FakeData = fakeData(), extra?: ReactNode): Mounted {
  const store: AppStore = createAppStore({ persist: false });
  const cmd = Object.fromEntries(Object.keys(noCommands).map((key) =>
    [key, vi.fn(() => (key === 'openLink' ? true : Promise.resolve()))])) as unknown as Mounted['cmd'];
  store.getState().actions.setCommands(cmd as unknown as Commands);
  store.getState().actions.setAuth({ engine, mode: 'web', loggedIn: true });
  const queries = fakeQueries(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } });
  const sh = makeShell(store, ticker, document.body, undefined, queries as unknown as Queries, client);
  const r = render(<QueryClientProvider client={client}><ShellContext.Provider value={sh}><Root />{extra}</ShellContext.Provider></QueryClientProvider>);
  return {
    ...r, store, cmd, sh, queries, client, data,
    S: () => store.getState(),
    $: (sel: string) => document.querySelector<HTMLElement>(sel),
    key: (key: string, o: KeyboardEventInit = {}) => act(() => onKey(sh, new KeyboardEvent('keydown', { key, cancelable: true, ...o }))),
    /** after changing `data`: refetch what is showing */
    refresh: async () => { await act(() => client.invalidateQueries()); await settle(); },
    settle,
  };
}
