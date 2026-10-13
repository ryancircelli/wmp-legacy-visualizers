// What a skin may ask of whichever adapter is active (spotify or local). The store holds one
// (`store.getState().commands`); until an adapter starts it is `noCommands`. Settings-only
// changes (volume, mute, lyrics on/off, view, visualizer) are store actions, not commands: the
// adapters subscribe to them.
import type { RepeatMode, ShuffleMode } from './types';

export type WinAction = 'drag' | 'min' | 'max' | 'close' | 'size';

/** Help > Check for Player Updates. `ready`: a newer page is cached (the apps: restart to use it) or
 *  deployed (the website: reload); `app`: a newer exe is out; `error`: the check could not be made. */
export type UpdateCheck = { state: 'latest' | 'ready' | 'app' | 'error'; message?: string };

export interface Commands {
  // transport: the promises settle when the player has answered (Spotify) or at once (host SMTC)
  playPause(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** WMP's Stop: halt and go back to the start */
  stop(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  seek(ms: number): Promise<void>;
  /** Rewind / Fast Forward: seconds relative to the extrapolated position (±10) */
  skip(sec: number): void;
  toggleShuffle(): void;
  setRepeat(mode: RepeatMode): void;
  /** Off -> Playlist (context) -> Track -> Off */
  cycleRepeat(): void;
  /** play a context (playlist/album/artist/station, Liked Songs as LIKED), optionally starting at one of its tracks */
  playContext(ctx: string, track?: string | null): void;
  /** a tile / row: a track plays in its ctx from itself, anything else as a context */
  playItem(item: { uri: string; ctx?: string | null }): void;
  /** Media Library > Play all: the collection (Liked Songs too) from its first track; with shuffle on,
   *  shuffled from a random one (the iPod's Shuffle Songs is this on LIKED) */
  playAll(uri: string): void;
  /** Add to the queue (the iPod's On-The-Go; WMP 9's details pane shows its button when present);
   *  `queue.next` follows with the player's next state. Absent: the engine has no queue (local). */
  addToQueue?(trackUri: string): void;
  /** Up Next as it should be: `queue.next`'s rows by index in their new order, a row left out removed.
   *  Optimistic (queue.next at once, back if the player refuses). Absent: the engine has no queue. */
  reorderQueue?(order: readonly number[]): void;
  /** Clear queue: the rows the user queued (Track.queued) removed, the context's own upcoming songs left
   *  as they are. Optimistic, as reorderQueue. Absent: the engine has no queue. */
  clearQueue?(): Promise<void>;
  /** Spotify's three-way shuffle (playback.shuffleMode). 'smart' only while playback.canSmartShuffle: it
   *  is refused, with a status-bar note, where the player has none. Optimistic. Absent: no such switch. */
  setShuffleMode?(mode: ShuffleMode): Promise<void>;
  /** New playlist: the new playlist's uri once Spotify has made it and put it at the top of the library
   *  (the library list refetches), null if it could not (status-bar note). */
  createPlaylist?(name: string): Promise<string | null>;
  /** Delete a playlist of the user's (Spotify's Delete: off the library; another's playlist is unfollowed).
   *  false if refused (status-bar note). */
  deletePlaylist?(uri: string): Promise<boolean>;
  /** Mark as played / unplayed: a podcast episode. Optimistic in `played` (the rows' Track.unplayed
   *  follows at once), rolled back with a status-bar note if Spotify refuses. */
  markPlayed?(episodeUri: string, played: boolean): Promise<void>;

  // selection (fetched data is TanStack Query's: see adapters/*/queries.ts)
  /** the Search view's query: sets ui.searchQ (the results are a query keyed on it) */
  search(q: string): void;
  /** select that playlist/album in the Media Library and switch to it */
  openInLibrary(uri: string, name?: string): void;
  /** right-hand pane shortcuts: the playing album / artist's albums / playing context */
  openAlbum(): void;
  /** select an artist in the Media Library (its page is fetchArtist); no uri = the playing artist */
  openArtist(uri?: string): void;
  openFrom(): void;
  transfer(deviceId: string): Promise<void>;
  /** Like / Remove from Liked Songs (tracks; albums, playlists, artists: save / follow): optimistic
   *  in `saved`, rolled back with a status-bar note if Spotify refuses */
  setLiked(uri: string, on: boolean): Promise<void>;
  /** Add to / remove from a target: Liked Songs (spotify:collection:tracks) or one of the user's
   *  playlists. Optimistic (`saved` / `membership`), rolled back with a status-bar note on failure. */
  addTo(trackUri: string, targetUri: string, on: boolean): Promise<void>;
  /** File > Open Spotify Link: false when the text is not a track/album/playlist/artist link */
  openLink(text: string): boolean;
  /** File > Log Out of Spotify (only when auth.canLogout) */
  logout(): void;

  // local sources
  /** the browser's share picker (getDisplayMedia) */
  startCapture(): Promise<void>;

  /** the desktop host's window (auth.hostWindow); a no-op in a browser */
  win(action: WinAction): void;
  /** Help > Check for Player Updates */
  checkForUpdates(): Promise<UpdateCheck>;
}

const none = () => {};
const resolved = () => Promise.resolve();
export const noCommands: Commands = {
  playPause: resolved, play: resolved, pause: resolved, stop: none, next: resolved, prev: resolved, seek: resolved, skip: none,
  toggleShuffle: none, setRepeat: none, cycleRepeat: none, playContext: none, playItem: none, playAll: none,
  search: none,
  openInLibrary: none, openAlbum: none, openArtist: none, openFrom: none, transfer: resolved, setLiked: resolved, addTo: resolved,
  openLink: () => false, logout: none, startCapture: resolved, win: none,
  checkForUpdates: () => Promise.resolve({ state: 'error', message: 'The check could not be made.' }),
};
