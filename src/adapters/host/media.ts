// A media session into the store — the host's GSMTC frames and the Spotify player's state both
// land here — plus the status bar line that follows it (90-shell.js onMedia).
import { initialPlayback, positionNow, trackName, type AppStore, type Playback } from '../../model';
import type { LyricsFrame, MediaFrame } from './index';

export const MSG_SILENT = 'No audio — animating';
export const MSG_LOCAL = 'System audio (local)';
const VERB = { playing: 'Playing', paused: 'Paused', stopped: 'Stopped' } as const;

export function idleStatus(store: AppStore): string {
  return store.getState().settings.animate ? MSG_SILENT : 'Ready';
}
/** The status line with no session: the capture source, or idle. */
export function sourceStatus(store: AppStore): string {
  const c = store.getState().playback.capture;
  return c ? (c.paused ? 'Paused' : c.label) : idleStatus(store);
}

/** A session (a partial Playback with status playing/paused/stopped), or null for "none". */
export function setSession(store: AppStore, p: Partial<Playback> | null): void {
  const s = store.getState(), had = s.playback.status !== 'none';
  if (!had && !p) return;                        // "none" after "none": the player untouched
  const { actions } = s;
  if (!p) {
    actions.setPlayback({ ...initialPlayback(), capture: s.playback.capture });
    actions.setStatus(sourceStatus(store));
    return;
  }
  const art = p.track?.art;
  const track = p.track ? { ...p.track, art: typeof art === 'string' && /^(data:image\/|https:)/.test(art) ? art : null } : null;
  actions.setPlayback({ ...p, track, pending: null });              // the player's word wins
  const st = p.status as keyof typeof VERB, name = track ? trackName(track) : '';
  actions.setStatus(name ? VERB[st] + ': ' + name : MSG_LOCAL);
}

/** CONTRACT v4 `media` frame -> the store. */
export function onMediaFrame(store: AppStore, m: MediaFrame): void {
  if (!(m.status in VERB)) return setSession(store, null);
  const status = m.status as keyof typeof VERB;
  setSession(store, {
    status, source: 'host', paused: status !== 'playing', at: Date.now(),
    position: (+(m.position ?? 0) || 0) * 1000,
    track: { uri: '', title: m.title || '', artist: m.artist || '', album: m.album || '',
             duration: (+(m.duration ?? 0) || 0) * 1000, art: m.art ?? null },
    canSeek: !!m.canSeek, canNext: m.canNext !== false, canPrev: m.canPrev !== false,
    context: null, from: '', app: m.app || '',
  });
}

/** CONTRACT v5 `lyrics` frame -> the store (seconds -> ms). */
export function onLyricsFrame(store: AppStore, l: LyricsFrame): void {
  const synced = l.status === 'synced' && Array.isArray(l.lines) && l.lines.length > 0;
  const plain = l.status === 'plain' && typeof l.plain === 'string' && !!l.plain;
  const track = l.track ? { title: l.track.title, artist: l.track.artist } : null;
  // Spotify's own lyrics for this track (Spotify mode) win over the host's LRCLIB ones.
  const cur = store.getState().lyrics, pt = store.getState().playback.track;
  if (cur.source === 'spotify' && cur.status !== 'none' && pt && cur.track?.title === pt.title && cur.track.artist === pt.artist) return;
  store.getState().actions.setLyrics(
    synced ? { status: 'synced', plain: null, track, source: 'lrclib', lines: l.lines!.map((x) => ({
      t: x.t * 1000, text: x.text, ...(x.words ? { words: x.words.map((w) => ({ t: w.t * 1000, text: w.text })) } : {}) })) }
    : plain ? { status: 'plain', lines: null, plain: l.plain!, track, source: 'lrclib' }
    : { status: 'none', lines: null, plain: null, track: null, source: null });
}

/** Pause / play as the playback slice will look once the player agrees. */
export function pausedPatch(store: AppStore, paused: boolean): Partial<Playback> {
  return { status: paused ? 'paused' : 'playing', paused, position: positionNow(store.getState()), at: Date.now() };
}

/** Optimistic transport: apply `patch` now and mark it pending. The next state/frame (setSession)
 *  clears pending and wins; `run` resolving false (refused) or rejecting rolls the fields back;
 *  with no word within 2 s pending clears and the optimistic values stay (a no-op may not push).
 *  `extra` covers a change outside the playback slice (a transfer's active device): its apply()
 *  returns the undo. */
export async function optimistic(store: AppStore, patch: Partial<Playback>, run: () => Promise<boolean>,
                                 extra?: { field: string; apply: () => () => void }): Promise<void> {
  const { playback, actions } = store.getState();
  const keys = Object.keys(patch) as (keyof Playback)[];
  const prev: Partial<Playback> = {};
  for (const k of keys) (prev as Record<string, unknown>)[k] = playback[k];
  const pending = { fields: [...keys, ...(extra ? [extra.field] : [])] as string[], since: Date.now() };
  actions.setPlayback({ ...patch, pending });
  const undo = extra?.apply();
  const mine = () => store.getState().playback.pending === pending;
  const timer = setTimeout(() => { if (mine()) actions.setPlayback({ pending: null }); }, 2000);
  let ok = false;
  try { ok = await run(); } catch { ok = false; }
  if (ok) return;
  clearTimeout(timer);
  if (mine()) { actions.setPlayback({ ...prev, pending: null }); undo?.(); }
}
