// The one entry the app uses: the Spotify adapter when the host set window.alchemyEngine =
// 'spotify', else the local one (app / website / screensaver). start() opens the audio source:
// call it after the first painted frame (a host socket spawns the WASAPI helper, which was
// measured to delay the first frame by seconds).
import './host/globals';
import type { AppStore } from '../model';
import { createLocalAdapter } from './local';
import { createSpotifyAdapter } from './spotify';
import * as spotifyQueries from './spotify/queries';
import * as localQueries from './local/queries';

export interface Adapter { start(): void; stop(): void }

export function createAdapter(store: AppStore): Adapter {
  return window.alchemyEngine === 'spotify' ? createSpotifyAdapter(store) : createLocalAdapter(store);
}
export { mark } from './host';

/** The active engine's query functions (TanStack Query): Spotify's catalogue, or the local engine's
 *  empty one. Same names and signatures either way. */
export type Queries = Pick<typeof spotifyQueries, 'keys' | 'fetchLibraryList' | 'fetchCollectionPage' | 'fetchSearch' |
  'fetchHome' | 'radioSeeds' | 'fetchRadio' | 'fetchArtist' | 'fetchAlbumMeta' | 'fetchLyrics' | 'acceptLyrics' | 'fetchCanvas' | 'fetchFollowedArtists' | 'fetchSaved' | 'savedKey' | 'setInvalidator' | 'fetchEditablePlaylists' | 'fetchMembership' | 'membershipKey' | 'applyMembership' | 'remember' | 'retryPolicy'>;
export function getQueries(): Queries {
  return window.alchemyEngine === 'spotify' ? spotifyQueries : (localQueries as unknown as Queries);
}
export { QueryError, RateLimitError } from './spotify/sp';
