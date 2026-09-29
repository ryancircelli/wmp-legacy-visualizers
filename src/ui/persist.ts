// The Spotify views between launches: TanStack Query's own persistence (react-query-persist-client
// with the async storage persister) over IndexedDB through idb-keyval — not localStorage, which on
// open.spotify.com is Spotify's, quota included. The library, Media Guide, radio, albums, artists
// and opened playlists come back before the first render and refresh behind it. `buster` is the
// page build, so results another build wrote (another data shape, maybe) are never read.
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createStore, del, get, set } from 'idb-keyval';

declare const __PAGE_BUILD__: string | undefined;
const BUILD = typeof __PAGE_BUILD__ === 'string' ? __PAGE_BUILD__ : 'dev';
/** ['spotify', kind, ...]: what is worth keeping (not saved flags, membership, search or lyrics) */
const KINDS = new Set(['library', 'collection', 'home', 'radio', 'album', 'artist']);
export const keepable = (k: readonly unknown[]): boolean => k[0] === 'spotify' && KINDS.has(k[1] as string);

let persister: ReturnType<typeof createAsyncStoragePersister> | null = null;
/** Made on first use: idb-keyval opens its database as soon as the store is created. */
function spotifyPersister() {
  if (persister) return persister;
  const store = createStore('wmp-cache', 'queries');
  const p = createAsyncStoragePersister({
    storage: { getItem: (k) => get<string>(k, store), setItem: (k, v: string) => set(k, v, store), removeItem: (k) => del(k, store) },
    key: 'spotify',
  });
  // Every cache event asks for a save (a saved flag, lyrics, a fetch starting), and each save writes
  // the whole cache: only write when something kept has new data.
  let kept = '';
  return (persister = { ...p, persistClient: (c) => {
    const sig = c.clientState.queries.map((q) => q.queryHash + ':' + q.state.dataUpdatedAt).join();
    if (sig === kept) return;
    kept = sig;
    return p.persistClient(c);
  } });
}

/** Restores the last session's results into `client` (waiting `wait` ms at most) and keeps saving. */
export async function persistQueries(client: QueryClient, wait = 300): Promise<void> {
  try {
    const [, restored] = persistQueryClient({
      queryClient: client,
      persister: spotifyPersister(),
      buster: BUILD,
      maxAge: 7 * 24 * 60 * 60_000,
      dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && keepable(q.queryKey) },
    });
    await Promise.race([restored, new Promise((ok) => setTimeout(ok, wait))]);
  } catch { /* no IndexedDB: start empty */ }
}

/** Logged out: nothing of that account stays behind. */
export async function forgetQueries(): Promise<void> {
  try { await persister?.removeClient(); } catch { /* nothing kept, nothing to forget */ }
}
