// The Spotify adapter's private state and its one request helper (post). Everything the skins
// see goes to the store; what stays here is plumbing (hash tables, in-flight loads, the 429 gate).
import '../host/globals';
import type { AppStore, HomeFeed, Track } from '../../model';
import type { SpotifyObserved } from '../host/globals';
import { transport } from './transport';

/** player_state as the dealer / connect-state send it: every number is a string. */
export interface PlayerState {
  timestamp?: string;
  context_uri?: string;
  context_metadata?: Record<string, string>;
  is_paused?: boolean;
  position_as_of_timestamp?: string;
  playback_speed?: string | number;
  duration?: string;
  track?: { uri?: string; metadata?: Record<string, string> };
  restrictions?: Record<string, string[] | undefined>;
  options?: { shuffling_context?: boolean; repeating_context?: boolean; repeating_track?: boolean };
  next_tracks?: ({ uri?: string; metadata?: Record<string, string> } | null)[];
}

export interface Sp {
  store: AppStore;
  /** the host's mediaCmd (SMTC): the per-command fallback; pos in ms */
  fallback(cmd: string, posMs?: number): void;
  hasState: boolean;
  last: PlayerState | null;
  /** op -> sha from the bundle scan; refused shas; script urls read; the scan in flight */
  scanned: Record<string, string>;
  bad: Record<string, true>;
  read: Record<string, true>;
  scan: Promise<unknown> | null;
  routed: boolean;
  /** hidden-app routes already visited to load their chunks ('/artist') */
  routes: Record<string, true>;
  /** 429: no request before this (Date.now()) */
  blockedUntil: number;
  /** context uri -> its name, once known */
  ctxNames: Record<string, string>;
  /** Liked Songs as the player names it (spotify:user:<username>:collection), once known */
  liked?: string;
  /** radio seed uri -> station playlist uri (null = none) */
  seeds: Record<string, string | null>;
  /** the volumes we PUT (0..65535) in the last 1.5 s: the device echoing any of them is not a change */
  sentVolume: { value: number; at: number }[];
  /** true while a device-reported volume is written to the settings (no PUT back) */
  fromDevice: boolean;
  /** internal fetches by uri: the playing context and album names while in flight; a track asked for
   *  (a speaker's bare state, state.ts) stays, as the record that it was asked once */
  loading: Record<string, Promise<unknown>>;
  /** what the fetches have taught us, for naming the player's state (see cache.ts) */
  cache: Cache;
}

export const W = (): SpotifyObserved => window.__wmpSpotify || {};
export const status = (sp: Sp, msg: string) => sp.store.getState().actions.setStatus(msg);

export interface Resp { status: number; json: unknown; text: string }

/** POST JSON (or GET) with the web player's own credentials (the transport adds them). A 429
 *  blocks every request until Retry-After (seconds) has passed. Network errors reject. */
export async function post(sp: Sp, url: string, body: unknown, method = 'POST', extra: Record<string, string> = {}): Promise<Resp> {
  const t = transport();
  if (!t.authed()) return { status: 0, json: null, text: '' };
  if (sp.blockedUntil > Date.now()) return { status: 429, json: null, text: '' };
  const headers = { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json', ...extra };
  const r = await t.request(url, method, method !== 'GET' ? JSON.stringify(body) : undefined, headers);
  if (r.status === 429) sp.blockedUntil = Date.now() + (parseInt(r.retryAfter ?? '', 10) || 1) * 1000;
  let json: unknown = null;
  try { json = r.text ? JSON.parse(r.text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, text: r.text };
}

export const kindOf = (uri: string | undefined) => /^spotify:(\w+):/.exec(uri || '')?.[1] ?? '';
/** Liked Songs as the player plays it (the web player's own context uri for it) */
export const LIKED_CTX = /^spotify:user:[^:]+:collection$/;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The enrichment cache: every track row and name the fetches returned, so a player_state that
 *  lacks names (Up Next, artist-context plays, "Playing from") can be named without the store. */
export interface Cache {
  tracks: Map<string, Track>;
  /** a collection's first page of tracks, by collection uri */
  lists: Map<string, Track[]>;
  /** collection / artist / album names by uri */
  names: Map<string, string>;
  /** Liked Songs' cover from libraryV3's pseudo-playlist */
  likedImage?: string;
  /** saved (Liked) state learned without asking: Liked Songs rows, our own mutations */
  saved: Map<string, boolean>;
  /** playlist uri -> its tracks seen so far (track uri -> item uid, '' when unknown) */
  members: Map<string, Map<string, string>>;
  /** playlist uri -> when its last page was read (membership is complete then) */
  scanned: Map<string, number>;
  /** playlist uri -> owner uri (libraryV3) */
  owners: Map<string, string>;
  /** track uri -> isCuratedEntities' "in any of the user's playlists", and when */
  curated: Map<string, { at: number; isCurated: boolean }>;
  /** isCuratedEntities gave no usable answer once (the status bar said so) */
  curatedFailed?: boolean;
  /** the last home feed (radio seeds come from it) */
  home?: HomeFeed;
}
export const newCache = (): Cache => ({ tracks: new Map(), lists: new Map(), names: new Map(), saved: new Map(), members: new Map(), scanned: new Map(), owners: new Map(), curated: new Map() });

/** Pathfinder / spclient said 429: honour Retry-After before trying again. */
export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super('Spotify is rate limiting: retry in ' + Math.ceil(retryAfterMs / 1000) + ' s');
    this.name = 'RateLimitError';
  }
}
/** A query that failed for any other reason (no hash, a refusal, no data). status 0 = never sent. */
export class QueryError extends Error {
  constructor(public op: string, public status: number) {
    super('Spotify: ' + op + ' failed (' + status + ')');
    this.name = 'QueryError';
  }
}
