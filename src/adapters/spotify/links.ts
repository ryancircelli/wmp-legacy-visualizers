// File > Open Spotify Link.
import { query } from './pathfinder';
import { playContext } from './connect';
import type { Sp } from './sp';

/** open.spotify.com/{kind}/{id} (with or without intl-xx/ and ?si=) or spotify:{kind}:{id}. */
export function parseLink(v: string): string | null {
  v = String(v || '').trim();
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/.exec(v) ||
            /^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/.exec(v);
  return m ? 'spotify:' + m[1] + ':' + m[2] : null;
}

/** A track plays in its album (getTrack names it), starting at the track; the rest as contexts.
 *  ponytail: without the album the track is sent as its own context. */
export async function openLink(sp: Sp, uri: string): Promise<void> {
  if (!uri.startsWith('spotify:track:')) return playContext(sp, uri, null);
  const d = await query<{ trackUnion?: { albumOfTrack?: { uri?: string } } }>(sp, 'getTrack', { uri }).catch(() => null);
  const al = d?.trackUnion?.albumOfTrack?.uri;
  return playContext(sp, al || uri, al ? uri : null);
}
