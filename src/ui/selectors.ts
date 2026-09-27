// Store reads more than one skin piece repeats. Pure functions of the state (no React); the
// model's own (positionNow, lyricsShown, trackLabel, ...) stay in src/model/selectors.ts.
import {
  captureElapsed, hasMedia, mmss, positionNow, type AppState, type Device, type SearchResults, type LibraryItem, type Settings, type Track,
} from '../model';

export const isSpotify = (s: AppState) => s.auth.engine === 'spotify';
export const isBare = (s: AppState) => s.ui.bare || s.auth.mode === 'screensaver';
export const duration = (s: AppState) => s.playback.track?.duration ?? 0;

/** a Spotify playlist or album: the kinds that open as a list of tracks */
export const isContext = (uri: string) => /^spotify:(playlist|album):/.test(uri);
export const isAlbum = (uri: string) => uri.startsWith('spotify:album:');
/** only inline images and https: art is shown (no file:, no http:) */
export const artOk = (a: string | null | undefined) => (a && /^(data:image\/|https:)/.test(a) ? a : '');

/** 0..1 through the track (4 decimals), -1 = no session (the seek thumb goes home) */
export function seekFraction(s: AppState, now = Date.now()): number {
  if (!hasMedia(s)) return -1;
  const d = duration(s);
  return Math.round((d > 0 ? positionNow(s, now) / d : 0) * 10000) / 10000;
}

/** The track's clock while a session exists (elapsed, or -remaining), else the capture's. */
export function clockText(s: AppState, now = Date.now()): string {
  if (!hasMedia(s)) return mmss(captureElapsed(s, now));
  const p = positionNow(s, now), d = duration(s);
  return s.settings.remaining && d > 0 ? '-' + mmss(d - p) : mmss(p);
}

export type DeviceKind = 'pc' | 'phone' | 'tv' | 'speaker';
export function deviceKind(d: Pick<Device, 'type'>): DeviceKind {
  const k = String(d.type || '').toLowerCase();
  return /computer|web|browser/.test(k) ? 'pc' : /phone|tablet/.test(k) ? 'phone' : /tv|cast|chromecast/.test(k) ? 'tv' : 'speaker';
}
/** "Speaker", "Computer"… ('Device' when the type is unknown) */
export function deviceKindName(d: Pick<Device, 'type'>): string {
  const k = String(d.type || '').toLowerCase();
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Device';
}
/** Cluster pushes can name a speaker by its id; show its kind instead of the id. */
export const deviceName = (d: Pick<Device, 'id' | 'name' | 'type'>) =>
  d.name && d.name !== d.id ? d.name : deviceKindName(d) + ' ' + String(d.id).slice(0, 6);

// ---- the Media Library's details pane and tiles view --------------------------------------
/** kept as names for the pane's code: the model's own types */
export type TrackInfo = Track;
export type ListItem = LibraryItem;
export type LibraryView = 'details' | 'tiles';
// Two settings the model's Settings does not name yet; they persist like every other key.
type UiSettings = { detailsPane?: boolean; libraryView?: LibraryView };

/** every collection row the last search found (artists, albums, playlists) */
export const searchCollections = (q: SearchResults) =>
  [...q.artists.items, ...q.albums.items, ...q.playlists.items];
export const detailsPaneOn = (s: AppState) => (s.settings as UiSettings).detailsPane !== false;
export const libraryView = (s: AppState): LibraryView => ((s.settings as UiSettings).libraryView === 'tiles' ? 'tiles' : 'details');
/** settings the model's Settings type does not name yet (persisted like every other key) */
export const uiSettings = (p: UiSettings) => p as Partial<Settings>;

/** 12,345 */
export const count = (n: number) => Math.round(n).toLocaleString('en-US');
/** h:mm (a total length) */
/** A collection's total as WMP prints it: "47 min", "3 hr 7 min" — never h:mm, which reads like a
 *  track length next to the m:ss column. */
export function hmm(ms: number): string {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return h ? h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
}
/** spotify:playlist:abc → https://open.spotify.com/playlist/abc */
export function shareUrl(uri: string): string {
  const [, kind, id] = uri.split(':');
  return kind && id && kind !== 'collection' ? 'https://open.spotify.com/' + kind + '/' + id : '';
}
