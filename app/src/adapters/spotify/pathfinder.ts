// Persisted-query hashes and POST pathfinder/v2/query (CONTRACT v6.1). Order: W.hashes (what the
// page itself sent) -> the scan of the loaded bundles -> BAKED. A hash the server refused (412)
// is never used again; a 412 rescans once and retries.
import { QueryError, RateLimitError, W, post, status, type Sp } from './sp';
import { transport } from './transport';

export const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query';
// web-player.eb2d94d5 as of 2026-09-24 (SPIKE2.md §5): last resort only, they change with deploys.
const DISCOGRAPHY = '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599';
export const BAKED: Record<string, string> = {
  searchDesktop: '1148393611bbc58e84e47aed35ecc731275df9f9eb660956962e352dd3631d89',
  searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
  libraryV3: '390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist: '243c0ba2736f16da721e3a227004bbcdb8df6c846f198bd478172e00aa1faf42',
  getAlbum: '6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361',
  home: '76243c78b0e20ecdbe41b794dec8cbe73f75e585b0a7201b8d2e84578412847a',     // spike 3, same day
  getTrack: 'a8ef9e9f02b836feb0da3003c31dbb30decc6f4b473ef89ca88c882386d668de', // spike 2 bundle scan
  // typed searches and the artist overview: spike 2's chunk scan, confirmed by spike 4's
  // captures (2026-09-25, SPIKE4.md).
  searchArtists: '7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d',
  searchAlbums: '202cb3305e31e5a0767ba7925f28bd728cf8f8b0217e6da43909056071cd70e9',
  searchPlaylists: 'd520014e748f9ea44f7707d8df1819867ac1205e8b7f3e28f22fe5fc858921b1',
  queryArtistOverview: '9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6',
  // spike 4 (2026-09-25): one persisted document serves every discography operation.
  queryArtistDiscographyAll: DISCOGRAPHY,
  queryArtistDiscographyAlbums: DISCOGRAPHY,
  queryArtistDiscographySingles: DISCOGRAPHY,
  queryArtistDiscographyCompilations: DISCOGRAPHY,
  queryArtistDiscographyOverview: DISCOGRAPHY,
  // spike 4 (2026-09-25) ops.json: one document for add / remove (and pin / unpin).
  addToLibrary: '1ad0d40b3c09660d818b9e770eb1e84745dfbe941df159a64f8772b6fa2bfc3a',
  removeFromLibrary: '1ad0d40b3c09660d818b9e770eb1e84745dfbe941df159a64f8772b6fa2bfc3a',
  areEntitiesInLibrary: '134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed',
  isCuratedEntities: 'af6bb0d2691f78f9169e1ba2dfed34a414bb4994e858f81487d6a26b95280566',
  isCurated: 'e4ed1f91a2cc5415befedb85acf8671dc1a4bf3ca1a5b945a6386101a22e28a6',
  // one document for add / remove / move (spike 4)
  addToPlaylist: '47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990',
  removeFromPlaylist: '47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990',
  // Canvas (queries.ts fetchCanvas): the hash two open-source fetchers ship, as of January 2026
  // (github.com/squeeeezy/Wolframe-spotify-canvas src/lib.rs; CHEYCKIT/BitChord PR #461,
  // SpotifyCanvasQuery.kt KNOWN_CANVAS_HASH). Not seen in our own captures.
  canvas: '575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f',
};
export function hashFor(sp: Sp, op: string): string | null {
  for (const h of [W().hashes?.[op], sp.scanned[op], BAKED[op]]) if (h && !sp.bad[h]) return h;
  return null;
}

/** The operations the web player's scripts declare, each script read once (a deploy brings new
 *  URLs; a refused hash is skipped by hashFor). */
export function rescan(sp: Sp): Promise<unknown> {
  sp.scan = transport().scan(sp.read).then((found) => { for (const [op, sha] of found) if (!sp.bad[sha]) sp.scanned[op] = sha; });
  return sp.scan;
}

/** The search operations live in a chunk the app loads only once it has been to /search: send the
 *  hidden app there (its router listens to popstate), give the chunk a moment, and scan again. */
export async function searchRoute(sp: Sp): Promise<void> {
  if (sp.routed || sp.scanned.searchDesktop || W().hashes?.searchDesktop) return;
  sp.routed = true;
  try { await transport().route('/search'); } catch { /* no router to poke */ }
  await new Promise((ok) => setTimeout(ok, 1500));
  await rescan(sp);
}

/** The same trick for another route (e.g. '/artist/<id>' loads the artist chunk): once per route
 *  kind, and only while none of `ops` has a hash from anywhere (page, scan, baked). */
export async function visitRoute(sp: Sp, path: string, ops: string[]): Promise<void> {
  const kind = path.split('/')[1] ?? path;
  if (sp.routes[kind] || ops.some((op) => hashFor(sp, op))) return;
  sp.routes[kind] = true;
  try { await transport().route(path); } catch { /* no router to poke */ }
  await new Promise((ok) => setTimeout(ok, 1500));
  await rescan(sp);
}

/** POST pathfinder/v2/query as the page does; the response's `data`. Throws RateLimitError on 429
 *  (carrying the wait) and QueryError otherwise; the status bar says why, the host's log adds
 *  GraphQL's first error message. `mutation`: a 200 without `errors` is done even with no `data`
 *  (then null; the log keeps the body). */
export async function query<T = any>(sp: Sp, op: string, variables: object, opts: { quiet?: boolean; retried?: boolean; mutation?: boolean } = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await (sp.scan || rescan(sp));
  const sha = hashFor(sp, op);
  if (!sha) { if (!opts.quiet) status(sp, 'Spotify: no query hash for ' + op); throw new QueryError(op, 0); }
  const r = await post(sp, PATHFINDER, { variables, operationName: op,
                                         extensions: { persistedQuery: { version: 1, sha256Hash: sha } } });
  if (r.status === 412 && !opts.retried) {
    sp.bad[sha] = true;
    await rescan(sp);
    return query<T>(sp, op, variables, { ...opts, retried: true });
  }
  if (r.status === 429) throw new RateLimitError(Math.max(1000, sp.blockedUntil - Date.now()));
  const body = r.json as { data?: T | null; errors?: { message?: string }[] } | null, data = body?.data;
  const err = Array.isArray(body?.errors) ? body.errors : null;
  if (r.status === 200 && !data && opts.mutation && !err?.length) {
    // ponytail: what such an answer means is unknown (the phone's heart got these); taken as done
    window.alchemyLog?.('spotify: query ' + op + ': 200 without data, taken as done: ' + r.text.slice(0, 160));
    return null as T;
  }
  if (r.status !== 200 || !data) {
    const why = err?.[0]?.message;
    window.alchemyLog?.('spotify: query ' + op + ' failed: ' + r.status + (why ? ' (' + why + ')' : ''));   // the host's log, quiet or not
    if (!opts.quiet) status(sp, 'Spotify: ' + op + ' failed (' + r.status + ')');
    throw new QueryError(op, r.status);
  }
  return data;
}
