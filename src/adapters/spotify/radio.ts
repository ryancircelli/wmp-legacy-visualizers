// Radio Tuner (spike 3 §2): not a GraphQL op but the REST call the web player makes,
//   GET spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/<seed uri>?response-format=json
//   -> {"mediaItems":[{"uri":"spotify:playlist:…"}]}   (without response-format it answers protobuf)
// Stations: song radio and artist radio for what is playing, radio for the artists in the home
// feed's "Jump back in" / "Recents" rows, then the feed's own "Recommended Stations".
import type { RadioSeed, Station } from '../../model';
import { fetchHome } from './home';
import { post, type Sp } from './sp';

const RADIO = 'https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/';

/** Each seed resolves once. */
async function seedStation(sp: Sp, seed: string): Promise<string | null> {
  if (sp.seeds[seed] !== undefined) return sp.seeds[seed];
  try {
    const r = await post(sp, RADIO + seed + '?response-format=json', null, 'GET');
    const it = r.status === 200 ? (r.json as { mediaItems?: { uri?: string }[] } | null)?.mediaItems?.[0] : undefined;
    return (sp.seeds[seed] = it?.uri ?? null);
  } catch { return null; }
}

/** The seeds for what is playing: song radio, then artist radio. */
export function radioSeeds(sp: Sp): RadioSeed[] {
  const md = sp.last?.track?.metadata ?? {}, seeds: RadioSeed[] = [];
  if (md.title && sp.last?.track?.uri && /^spotify:track:/.test(sp.last.track.uri)) {
    seeds.push({ seed: sp.last.track.uri, name: md.title + ' Radio', sub: 'Song radio · ' + (md.artist_name || '') });
  }
  if (md.artist_uri) seeds.push({ seed: md.artist_uri, name: (md.artist_name ?? '') + ' Radio', sub: 'Artist radio' });
  return seeds;
}

/** Stations: these seeds, then artist radio for the home feed's "Jump back in" / "Recents"
 *  artists, then its "Recommended Stations" (home fetched when not held). Each seed resolves once. */
export async function fetchRadio(sp: Sp, seeds: RadioSeed[] = radioSeeds(sp)): Promise<Station[]> {
  seeds = [...seeds];
  const home = sp.cache.home ?? await fetchHome(sp).catch(() => null);
  const rec: Station[] = [];
  for (const sec of home?.sections ?? []) {
    const recent = /jump back in|recent/i.test(sec.title);
    for (const it of sec.items) {
      const a = /^spotify:artist:/.test(it.uri) ? { uri: it.uri, name: it.name } : it.artist;
      if (recent && a && seeds.length < 10 && !seeds.some((x) => x.seed === a.uri)) {
        seeds.push({ seed: a.uri, name: a.name + ' Radio', sub: 'Artist radio', img: a.uri === it.uri ? it.img : null });
      }
      if (/station/i.test(sec.title) && /^spotify:playlist:/.test(it.uri)) rec.push({ uri: it.uri, name: it.name, sub: it.sub, img: it.img });
    }
  }
  const uris = await Promise.all(seeds.map((x) => seedStation(sp, x.seed)));
  const out: Station[] = [];
  seeds.forEach((x, i) => { const u = uris[i]; if (u) out.push({ uri: u, name: x.name, sub: x.sub, img: x.img ?? null }); });
  const seen = new Set<string>();
  return out.concat(rec).filter((x) => !seen.has(x.uri) && !!seen.add(x.uri));
}
