// The Music screens' pure parts: Search's letter strip and the Artists list's names. No React, no DOM.
import type { Track } from '../../../../model';

/** The strip under the typed text, as the wheel walks it: letters, digits, space, delete. */
export const SLOTS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ' ', '⌫'];
const LAST = SLOTS.length - 1;

/** `row` -1: the wheel walks the strip (at `slot`); 0..: the result row it is on. */
export interface Strip { q: string; slot: number; row: number }
export type StripAct =
  | { t: 'tick'; dir: 1 | -1; rows: number }
  | { t: 'enter' } | { t: 'delete' } | { t: 'space' } | { t: 'menu' };

const del = (s: Strip): Strip => ({ ...s, q: s.q.slice(0, -1) });

/** Clockwise past ⌫ goes down into the results, counter-clockwise from the first result back up.
 *  MENU leaves the results first, then deletes a letter (the screen goes back once both are spent). */
export function strip(s: Strip, a: StripAct): Strip {
  switch (a.t) {
    case 'tick':
      if (s.row >= 0) return { ...s, row: s.row + a.dir < 0 ? -1 : Math.min(s.row + a.dir, a.rows - 1) };
      if (a.dir > 0 && s.slot === LAST) return a.rows ? { ...s, row: 0 } : s;
      return { ...s, slot: Math.max(0, Math.min(LAST, s.slot + a.dir)) };
    case 'enter': return s.slot === LAST ? del(s) : { ...s, q: s.q + SLOTS[s.slot] };
    case 'space': return { ...s, q: s.q + ' ' };
    case 'delete': return del(s);
    case 'menu': return s.row >= 0 ? { ...s, row: -1 } : del(s);
  }
}

/** Artist uri -> name from tracks, in order of first appearance. A track names its artists in one
 *  string ("A, B"): it counts only where that splits into as many names as it has uris.
 *  ponytail: a collaboration whose names hold ", " ("Tyler, The Creator" + one) is skipped. */
export function artistsOf(rows: readonly Track[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of rows) {
    const uris = t.artistUris ?? [], names = uris.length === 1 ? [t.artist] : t.artist.split(', ');
    if (names.length === uris.length) uris.forEach((u, i) => { if (!m.has(u)) m.set(u, names[i]!); });
  }
  return m;
}
