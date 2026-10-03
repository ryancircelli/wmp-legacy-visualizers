// The host's own player (CONTRACT v10): a Spotify Connect speaker the host drives itself, commanded
// and read through these bindings alone, whichever host provides them. Everything is feature-detected:
// a host without them (an older build, the website) leaves the page on connect-state as before.
import './globals';
import type { HostPlayer } from './globals';

/** The host takes player commands. */
export const available = (): boolean => typeof window.alchemyPlayer === 'function';
/** Its speaker's Connect device id while its session is up. */
export const speaker = (): string | null => window.__wmpSpeaker?.id || null;
/** Its last report, if it sends them. */
export const state = (): HostPlayer | null => window.__wmpPlayer ?? null;

/** A command (CONTRACT v10 §1), one line in the host's log. */
export function send(cmd: string): void {
  window.alchemyLog?.('spotify: ' + cmd + " to the host's player");
  window.alchemyPlayer?.(cmd);
}

/** fn at every report; returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  window.addEventListener('wmp-player', fn);
  return () => window.removeEventListener('wmp-player', fn);
}
