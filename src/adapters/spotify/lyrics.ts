/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// Spotify's own lyrics (the web player's color-lyrics endpoint): line-synced and, for some tracks,
// syllable-synced, so better karaoke timing than LRCLIB. Tried first in Spotify mode; when a track
// has none (404) or the account may not have them (401/403) the host's LRCLIB lyrics stay.
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
  if (r.status === 404) return { status: 'none', lines: null, plain: null, track: null, source: 'spotify' };
  if (r.status === 429) throw new RateLimitError(Math.max(1000, sp.blockedUntil - Date.now()));
  if (r.status !== 200) throw new QueryError('lyrics', r.status);
  if (!logged && sp.store.getState().settings.debug) {
    logged = true;
    const L = (r.json as any)?.lyrics;
    console.debug('spotify lyrics keys', Object.keys((r.json as object | null) ?? {}), L && Object.keys(L), L?.lines?.[0] && Object.keys(L.lines[0]));
  }
  return normalizeLyrics(r.json, track);
}

/** A fetchLyrics result for trackUri -> the lyrics slice, when it is still the playing track and
 *  has lyrics; 'none' leaves whatever the host's LRCLIB sent. */
export function acceptLyrics(sp: Sp, trackUri: string, l: Lyrics): void {
  const { playback, actions } = sp.store.getState();
  const t = playback.track;
  if (!t || t.uri !== trackUri || l.status === 'none') return;
  actions.setLyrics({ ...l, track: { title: t.title, artist: t.artist }, source: 'spotify' });
}
