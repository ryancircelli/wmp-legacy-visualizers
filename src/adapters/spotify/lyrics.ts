/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// Spotify's own lyrics (the web player's color-lyrics endpoint): line-synced and, for some tracks,
// syllable-synced, so better karaoke timing than LRCLIB. Tried first in Spotify mode; when a track
// has none (404) LRCLIB is asked (fetchLrclib below, or the desktop host's own), and when the account
// may not have them (401/403) the host's LRCLIB lyrics stay.
// ponytail: response shape as reported for the web player, unverified against a live capture;
// read defensively, and with settings.debug the raw keys of the first answer go to the console.
import type { LyricLine, Lyrics } from '../../model';
import { QueryError, RateLimitError, post, type Sp } from './sp';

const BASE = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/';
let logged = false;

/** Spotify's lyrics -> the Lyrics shape (ms). */
export function normalizeLyrics(body: any, track: Lyrics['track']): Lyrics {
  const L = body && body.lyrics;
  const none: Lyrics = { status: 'none', lines: null, plain: null, track: null, source: 'spotify' };
  if (!L || !Array.isArray(L.lines) || !L.lines.length) return none;
  const text = (x: any) => String((x && (x.words ?? x.text)) ?? '');
  if (L.syncType === 'UNSYNCED') {
    const plain = L.lines.map(text).join('\n').trim();
    return plain ? { status: 'plain', lines: null, plain, track, source: 'spotify' } : none;
  }
  if (L.syncType !== 'LINE_SYNCED' && L.syncType !== 'SYLLABLE_SYNCED') return none;
  const lines: LyricLine[] = [];
  for (const x of L.lines) {
    const t = +(x && x.startTimeMs);
    if (!Number.isFinite(t)) continue;
    const line: LyricLine = { t, text: text(x) };
    // Syllable timings name the karaoke words when they carry their text.
    const syl = (Array.isArray(x.syllables) ? x.syllables : []).filter((s: any) => s && Number.isFinite(+s.startTimeMs) && s.text);
    if (syl.length) line.words = syl.map((s: any) => ({ t: +s.startTimeMs, text: String(s.text) }));
    lines.push(line);
  }
  return lines.length ? { status: 'synced', lines, plain: null, track, source: 'spotify' } : none;
}

/** Lyrics for a track uri (its cover url makes the request the web player's own). 404 = none;
 *  401/403 and other failures throw QueryError (the host's LRCLIB lyrics stay), 429 RateLimitError. */
export async function fetchLyrics(sp: Sp, trackUri: string, imageUrl?: string | null, track: Lyrics['track'] = null): Promise<Lyrics> {
  const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(trackUri)?.[1];
  if (!id) return { status: 'none', lines: null, plain: null, track: null, source: 'spotify' };
  const url = BASE + id + (imageUrl ? '/image/' + encodeURIComponent(imageUrl) : '') + '?format=json&vocalRemoval=false&market=from_token';
  const r = await post(sp, url, null, 'GET', { 'app-platform': 'WebPlayer' });
  if (r.status !== 200) window.alchemyLog?.('spotify: lyrics for ' + id + ': ' + r.status + (r.status === 404 ? ' (none)' : ''));
  if (r.status === 404) return { status: 'none', lines: null, plain: null, track: null, source: 'spotify' };
  if (r.status === 429) throw new RateLimitError(Math.max(1000, sp.blockedUntil - Date.now()));
  if (r.status !== 200) throw new QueryError('lyrics', r.status);
  if (!logged && sp.store.getState().settings.debug) {
    logged = true;
    const L = (r.json as any)?.lyrics;
    console.debug('spotify lyrics keys', Object.keys((r.json as object | null) ?? {}), L && Object.keys(L), L?.lines?.[0] && Object.keys(L.lines[0]));
  }
  const out = normalizeLyrics(r.json, track);
  window.alchemyLog?.('spotify: lyrics for ' + id + ': 200, ' + out.status + ', ' + (out.lines?.length ?? 0) + ' lines');
  return out;
}

/** A fetchLyrics / fetchLrclib result for trackUri -> the lyrics slice, when it is still the playing
 *  track and has lyrics; 'none' leaves whatever the host's LRCLIB sent. */
export function acceptLyrics(sp: Sp, trackUri: string, l: Lyrics): void {
  const { playback, actions } = sp.store.getState();
  const t = playback.track;
  if (!t || t.uri !== trackUri || l.status === 'none') {
    window.alchemyLog?.('spotify: lyrics not kept: ' + (l.status === 'none' ? 'none' : 'for ' + trackUri.slice(-6) + ', playing ' + (t?.uri ?? '-').slice(-6)));
    return;
  }
  actions.setLyrics({ ...l, track: { title: t.title, artist: t.artist, uri: t.uri } });
}

// ------------------------------------------------------------------ LRCLIB
// For a track Spotify has no lyrics for (404), lrclib.net (CORS *): asked from the page, since the
// iOS app has no host that asks it. The desktop (Tauri) host asks LRCLIB itself and sends `lyrics`
// frames (CONTRACT v5), so there the page never does.
const LRCLIB = 'https://lrclib.net/api/';
// LRCLIB requires clients to name themselves; a browser cannot set User-Agent, so the header its docs
// name for that (its preflight allows lrclib-client). The desktop host's User-Agent, verbatim.
const CLIENT = { 'Lrclib-Client': 'WmpLegacyVisualizers/1.0 (github.com/ryancircelli/wmp-legacy-visualizers)' };
interface Hit { duration?: number; instrumental?: boolean; plainLyrics?: string | null; syncedLyrics?: string | null }

/** LRC `[mm:ss.xx] text` -> lines in ms, one per stamp (a line may carry several), in time order;
 *  tag lines ([ar:...]) skipped. ponytail: enhanced `<mm:ss.xx>` word stamps would stay in the text
 *  (LRCLIB's syncedLyrics carry none; the host's parse_lrc reads them, port it if they appear). */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const head = /^(?:\[\d+:\d+(?:\.\d+)?\])+/.exec(row)?.[0];
    if (!head) continue;
    const text = row.slice(head.length).trim();
    for (const m of head.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) out.push({ t: Math.round((+m[1]! * 60 + +m[2]!) * 1000), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** LRCLIB's lyrics for the playing track, once Spotify said it has none: `get` with its title, first
 *  artist, album and length, else the `search` hit within 2 s of that length (a synced one first).
 *  404, instrumental or no hit = none; 429 throws RateLimitError (LRCLIB's Retry-After), other
 *  failures QueryError. Nothing is asked on the desktop host, or for a track not playing or not
 *  yet named (the hook waits for its title, artist and length). */
export async function fetchLrclib(sp: Sp, trackUri: string): Promise<Lyrics> {
  const none: Lyrics = { status: 'none', lines: null, plain: null, track: null, source: 'lrclib' };
  const t = sp.store.getState().playback.track, id = /^spotify:track:([A-Za-z0-9]+)$/.exec(trackUri)?.[1];
  if (window.__TAURI__ || !id || !t || t.uri !== trackUri || !t.title || !t.artist || !(t.duration > 0)) return none;
  const say = (m: string) => window.alchemyLog?.('spotify: lyrics for ' + id + ': none on Spotify, LRCLIB: ' + m);
  // ponytail: rows join their artists with ', ', so "Tyler, The Creator" asks as "Tyler" (then the search)
  const sec = t.duration / 1000, q = { track_name: t.title, artist_name: t.artist.split(', ')[0]! };
  const ask = async (path: string, params: Record<string, string>): Promise<unknown> => {
    const r = await fetch(LRCLIB + path + '?' + new URLSearchParams(params).toString(), { headers: CLIENT })
      .catch((e: unknown) => { say('failed (network)'); throw e; });
    if (r.status === 404) return null;
    if (r.status === 200) return r.json();
    say('failed (' + r.status + ')');
    if (r.status === 429) throw new RateLimitError((parseInt(r.headers.get('Retry-After') ?? '', 10) || 1) * 1000);
    throw new QueryError('lrclib', r.status);
  };
  let hit = (await ask('get', { ...q, album_name: t.album ?? '', duration: String(Math.round(sec)) })) as Hit | null;
  if (!hit) {
    const near = (((await ask('search', q)) ?? []) as Hit[]).filter((h) => h.duration != null && Math.abs(h.duration - sec) <= 2);
    hit = near.find((h) => h.syncedLyrics) ?? near[0] ?? null;
  }
  const lines = hit?.syncedLyrics && !hit.instrumental ? parseLrc(hit.syncedLyrics) : [];
  const plain = hit?.plainLyrics && !hit.instrumental ? hit.plainLyrics.trim() : '';
  const track = { title: t.title, artist: t.artist, uri: trackUri };
  const out: Lyrics = lines.length ? { status: 'synced', lines, plain: null, track, source: 'lrclib' }
    : plain ? { status: 'plain', lines: null, plain, track, source: 'lrclib' } : none;
  say(out.status + (lines.length ? ', ' + lines.length + ' lines' : ''));
  return out;
}
