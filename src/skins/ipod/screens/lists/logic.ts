// The Library screens' pure parts: Search's letter picker, the iPod's A–Z order, the Artists list and
// the grid's description lines. No React, no DOM.
import type { LibraryItem, Track } from '../../../../model';

/** The picker's strip: letters then digits (⏭ types a space, ⏮ deletes; docs/ipod-skin.md §2.4). */
export const SLOTS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
const LAST = SLOTS.length - 1;

/** `row` -1: the picker has the wheel (at `slot`); 0..: the result row it is on. `typed`: the query
 *  changed since the results last had the wheel, so MENU goes to them rather than out. */
export interface Strip { q: string; slot: number; row: number; typed: boolean }
export const STRIP0: Strip = { q: '', slot: 0, row: -1, typed: false };
export type StripAct =
  | { t: 'tick'; dir: 1 | -1; rows: number }
  | { t: 'enter' } | { t: 'delete' } | { t: 'space' } | { t: 'menu'; rows: number };

const edit = (s: Strip, q: string): Strip => ({ ...s, q, typed: true });

/** The picker as the nano runs it. MENU in the picker goes to the results once something was typed
 *  (and there are results), else leaves (null); MENU in the results goes back to the picker. */
export function strip(s: Strip, a: StripAct): Strip | null {
  switch (a.t) {
    case 'tick':
      if (s.row >= 0) return { ...s, row: Math.max(0, Math.min(s.row + a.dir, a.rows - 1)) };
      return { ...s, slot: Math.max(0, Math.min(LAST, s.slot + a.dir)) };
    case 'enter': return edit(s, s.q + SLOTS[s.slot]);
    case 'space': return s.q ? edit(s, s.q + ' ') : s;
    case 'delete': return s.q ? edit(s, s.q.slice(0, -1)) : s;
    case 'menu':
      if (s.row >= 0) return { ...s, row: -1 };
      return s.typed && a.rows ? { ...s, row: 0, typed: false } : null;
  }
}

/** The iPod's A–Z: a leading "The", "A" or "An" ignored, case and accents too, and anything that
 *  does not start with a letter after Z (docs/ipod-skin.md §3.2). */
export function az(a: string, b: string): number {
  const k = (s: string) => s.replace(/^(the|an?)\s+/i, '');
  const x = k(a), y = k(b), lx = /^\p{L}/u.test(x), ly = /^\p{L}/u.test(y);
  return lx !== ly ? (lx ? -1 : 1) : x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true });
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

export interface Artist { key: string; name: string; uri?: string; image?: string }

/** Library > Artists: the liked songs' artists (with their uri) and the saved albums' (names only, the
 *  adapter lists no followed artists), one per name, A–Z. */
export function artistList(liked: Map<string, string>, albums: readonly LibraryItem[]): Artist[] {
  const by = new Map<string, Artist>();
  for (const [uri, name] of liked) if (!by.has(name.toLowerCase())) by.set(name.toLowerCase(), { key: uri, name, uri });
  for (const a of albums) {
    for (const name of a.artist?.split(', ') ?? []) {
      if (name && !by.has(name.toLowerCase())) by.set(name.toLowerCase(), { key: 'name:' + name, name });
    }
  }
  return [...by.values()].sort((a, b) => az(a.name, b.name));
}

/** An artist's saved albums, by the name the album lists them under. */
export const albumsBy = (name: string, albums: readonly LibraryItem[]): LibraryItem[] =>
  albums.filter((a) => a.artist?.split(', ').includes(name));

/** the kind a uri names, as the grid's description line words it */
const KIND: Record<string, string> = { album: 'Album', artist: 'Artist', show: 'Podcast', episode: 'Podcast', track: 'Song' };

/** A tile's description line, Spotify's library grid's words: "Playlist · <by>" (Spotify when no one
 *  is named), "Album · <by>", "Song · <by>", "Artist", "Podcast". `by` is an album's artists, a
 *  playlist's owner (or, on Home, Spotify's own line under it); one that only repeats the kind is dropped. */
export function subline(uri: string, by?: string): string {
  const kind = KIND[uri.split(':')[1] ?? ''] ?? 'Playlist';
  if (kind === 'Artist' || kind === 'Podcast') return kind;
  const who = kind === 'Playlist' ? by || 'Spotify' : by;
  return who && who.toLowerCase() !== kind.toLowerCase() ? kind + ' · ' + who : kind;
}
