// The Library screens' pure parts: the iPod's A–Z order, the Artists list and the grid's description
// lines. No React, no DOM.
import type { LibraryItem, Track } from '../../../../model';

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

export type QueueEdit = 'next' | 'up' | 'down' | 'remove';
/** Up Next after an edit of row `i` of `n` (the Queue's hold-centre): the rows by index in their new
 *  order (removed: left out) and where the selection goes (the moved row; after a removal, the row now
 *  in its place); null when the row would not move (Play Next or Move Up on the first, Move Down on the last). */
export function queueEdit(n: number, i: number, edit: QueueEdit): { order: number[]; at: number } | null {
  const order = [...Array(n).keys()];
  order.splice(i, 1);
  if (edit === 'remove') return { order, at: Math.max(0, Math.min(i, n - 2)) };
  const to = edit === 'next' ? 0 : edit === 'up' ? i - 1 : i + 1;
  if (to < 0 || to >= n || to === i) return null;
  order.splice(to, 0, i);
  return { order, at: to };
}

/** An episode's second line: its date and length, "Sep 30, 2026 · 1 hr 5 min" (the device's date format;
 *  either alone when the other is unknown). */
export function episodeLine(date: string | undefined, ms: number): string {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : date;
  const min = Math.round(ms / 60_000), h = Math.floor(min / 60);
  const len = ms > 0 ? (h ? h + ' hr' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : Math.max(1, min) + ' min') : '';
  return [day, len].filter(Boolean).join(' · ');
}
