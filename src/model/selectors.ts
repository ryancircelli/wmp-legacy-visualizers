// Derived values. Position extrapolation lives here, never in a 1 Hz setState.
import type { AppState } from './store';
import type { LyricLine, Track } from './types';

/** The track position in ms now: the stored one, run on while playing, capped at the duration. */
export function positionNow(s: AppState, now = Date.now()): number {
  const p = s.playback;
  if (p.status === 'none') return 0;
  const pos = p.position + (p.status === 'playing' && !p.paused ? Math.max(0, now - p.at) : 0);
  const d = p.track?.duration ?? 0;
  return Math.max(0, d > 0 ? Math.min(pos, d) : pos);
}

/** The capture clock (no media session): ms the source has been attached and unpaused. */
export function captureElapsed(s: AppState, now = Date.now()): number {
  const c = s.playback.capture;
  return c ? c.acc + (c.from ? now - c.from : 0) : 0;
}

/** Total length (ms) of these tracks (the pages loaded so far, not the whole collection until paged). */
export const totalMs = (tracks: readonly Pick<Track, 'duration'>[] | null | undefined): number =>
  (tracks ?? []).reduce((a, t) => a + (t.duration || 0), 0);

export const hasMedia = (s: AppState) => s.playback.status !== 'none';

/** "Title – Artist" */
export const trackLabel = (t: Pick<Track, 'title' | 'artist'>) => t.title + (t.artist ? ' – ' + t.artist : '');
/** "Artist – Title" (the status bar and the screensaver caption) */
export const trackName = (t: Pick<Track, 'title' | 'artist'>) => [t.artist, t.title].filter(Boolean).join(' – ');

/** m:ss (the Media Library's Length column) */
export function mss(ms: number): string {
  const s = Math.round((ms || 0) / 1000);
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}
/** mm:ss (the clock) */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000) || 0);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + ('0' + (s % 60)).slice(-2);
}

/** Lyrics show only while on, with a session, and for the session's own track. */
export function lyricsShown(s: AppState): 'synced' | 'plain' | null {
  const l = s.lyrics, t = s.playback.track;
  if (!s.settings.lyrics || s.playback.status === 'none' || !t || l.status === 'none') return null;
  if (l.track && (l.track.title !== t.title || l.track.artist !== t.artist)) return null;
  return l.status;
}

/** Index of the line sung at `ms` (-1 before the first). */
export function lineAt(lines: LyricLine[], ms: number): number {
  let i = -1;
  while (i + 1 < lines.length && ms >= lines[i + 1]!.t) i++;
  return i;
}

export interface WordTime { text: string; t: number; end: number }
/** Word times of line i: the LRC's own stamps, else spread by length over the line's sung span.
 *  ponytail: ~8 chars/s guess (0.6 s + 0.12 s/char), capped at the gap to the next line. */
export function wordTimes(lines: LyricLine[], i: number): WordTime[] {
  const line = lines[i];
  if (!line) return [];
  const end = i + 1 < lines.length ? lines[i + 1]!.t : line.t + 5000;
  if (line.words?.length) {
    const w = line.words;
    return w.map((x, k) => ({ text: x.text, t: x.t, end: k + 1 < w.length ? w[k + 1]!.t : end }));
  }
  const ws = line.text.split(/\s+/).filter(Boolean);
  const n = ws.reduce((a, w) => a + w.length + 1, 0);
  const per = Math.min(end - line.t, 600 + n * 120) / (n || 1);
  let t = line.t;
  return ws.map((w) => { const o = { text: w, t, end: t + (w.length + 1) * per }; t = o.end; return o; });
}

/** Index of the word sung at `ms` within wordTimes (-1 before the first). */
export function wordAt(words: WordTime[], ms: number): number {
  let k = -1;
  while (k + 1 < words.length && ms >= words[k + 1]!.t) k++;
  return k;
}
