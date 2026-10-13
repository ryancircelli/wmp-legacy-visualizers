/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// Like / Remove from Liked Songs (and save / follow albums, playlists, artists): the web player's
// persisted mutations addToLibrary / removeFromLibrary { libraryItemUris }, and areEntitiesInLibrary { uris }
// for the saved state (50 per call). Hashes: W.hashes -> the bundle scan -> spike 4's baked ones.
// ponytail: response shapes unverified against a live capture; read defensively, and with
// settings.debug the first answers' keys go to the console.
import { LIKED, type LibraryItem } from '../../model';
import { username } from './connect';
import { fetchCollectionPage, fetchLibraryList } from './library';
import { query } from './pathfinder';
import { post, status, type Resp, type Sp } from './sp';

const BATCH = 50;
let logged = false;
function debugShape(sp: Sp, op: string, d: unknown): void {
  if (logged || !sp.store.getState().settings.debug) return;
  logged = true;
  console.debug('spotify ' + op + ' data', JSON.stringify(d).slice(0, 400));
}

/** One answer per uri, in order (captured live): data.lookup[i] = { __typename, data: { saved } }.
 *  An entry without data (a playlist: { __typename: 'PlaylistResponseWrapper' }) is unknown. */
function flags(d: any, n: number): (boolean | undefined)[] {
  const arr: any[] = (d && d.lookup) || [];
  return Array.from({ length: n }, (_x, i) => {
    const f = arr[i] && arr[i].data && arr[i].data.saved;
    return typeof f === 'boolean' ? f : undefined;
  });
}

/** The mutations' answers (captured live): success is the op's own payload key. A 200 with no data
 *  and no errors is taken as done too (query's `mutation`). */
const PAYLOAD: Record<string, string> = { addToLibrary: 'addLibraryItems', removeFromLibrary: 'removeLibraryItems',
  addToPlaylist: 'addItemsToPlaylist', removeFromPlaylist: 'removeItemsFromPlaylist' };
async function mutate(sp: Sp, op: string, variables: object): Promise<void> {
  const d = await query(sp, op, variables, { mutation: true });
  debugShape(sp, op, d);
  if (d && !d[PAYLOAD[op]!]) throw new Error('unexpected answer');
}

/** Saved state of these uris: known ones (Liked Songs rows, our mutations) without asking, the
 *  rest by areEntitiesInLibrary in batches of 50. Unknown answers read false. */
export async function fetchSaved(sp: Sp, uris: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}, ask: string[] = [];
  for (const u of new Set(uris)) {
    const k = sp.cache.saved.get(u);
    if (k !== undefined) out[u] = k; else ask.push(u);
  }
  for (let i = 0; i < ask.length; i += BATCH) {
    const part = ask.slice(i, i + BATCH);
    const d = await query(sp, 'areEntitiesInLibrary', { uris: part });
    debugShape(sp, 'areEntitiesInLibrary', d);
    flags(d, part.length).forEach((f, j) => { if (f !== undefined) out[part[j]!] = f; });
  }
  return out;
}

/** What to refetch after a library change: set by the UI (its QueryClient); keys are query keys. */
let invalidate: ((keys: readonly (readonly unknown[])[]) => void) | null = null;
export function setInvalidator(fn: typeof invalidate): void { invalidate = fn; }

/** Like (on) or remove (off): optimistic in the store's `saved`, then the mutation; a refusal rolls
 *  back and says so. Afterwards Liked Songs, the library list and this uri's saved state refetch. */
export async function setLiked(sp: Sp, uri: string, on: boolean): Promise<void> {
  const { saved, actions } = sp.store.getState(), had = uri in saved ? saved[uri]! : null;
  actions.setSaved(uri, on);
  try {
    // variables as the web player sends them (live 2026-09-25: `uris` is a 400, "missing variable $libraryItemUris")
    await mutate(sp, on ? 'addToLibrary' : 'removeFromLibrary', { libraryItemUris: [uri] });
  } catch (e) {
    actions.setSaved(uri, had);
    status(sp, 'Spotify: could not ' + (on ? 'add to' : 'remove from') + ' your library (' +
      ((e as { status?: number }).status ?? (e as Error).message) + ')');
    return;
  }
  sp.cache.saved.set(uri, on);
  if (!on) {
    const liked = sp.cache.lists.get(LIKED);
    if (liked) sp.cache.lists.set(LIKED, liked.filter((t) => t.uri !== uri));
  }
  invalidate?.([['spotify', 'collection', LIKED], ['spotify', 'library'], ['spotify', 'saved']]);
}

// ------------------------------------------------------------------ playlists
const MEMBERSHIP_TTL = 5 * 60_000, SCAN_PAGES = 5, SCAN_PLAYLISTS = 10;

/** The playlists the user can add to: libraryV3's canEditItems, plus any playlist owned by the
 *  same user as one of those (for rows that carry no capabilities). */
export async function fetchEditablePlaylists(sp: Sp): Promise<LibraryItem[]> {
  const list = (await fetchLibraryList(sp)).filter((p) => p.uri.startsWith('spotify:playlist:'));
  const mine = new Set(list.filter((p) => p.editable).map((p) => sp.cache.owners.get(p.uri)).filter(Boolean));
  return list.filter((p) => p.editable || (mine.has(sp.cache.owners.get(p.uri)) && !!sp.cache.owners.get(p.uri)));
}

/** The optimistic membership mark (store.membership; Liked Songs = store.saved). */
export function applyMembership(sp: Sp, trackUri: string, targetUri: string, on: boolean | null): void {
  const { actions } = sp.store.getState();
  if (targetUri === LIKED) actions.setSaved(trackUri, on);
  else actions.setMembership(targetUri, trackUri, on);
}

/** The track's item uid in a playlist: from the pages seen, else reading its pages (5 at most). */
async function uidIn(sp: Sp, pl: string, trackUri: string): Promise<string | null> {
  const known = sp.cache.members.get(pl)?.get(trackUri);
  if (known) return known;
  for (let offset = 0, i = 0; i < SCAN_PAGES; i++) {
    const pg = await fetchCollectionPage(sp, pl, offset, true);
    const hit = pg.tracks.find((t) => t.uri === trackUri && t.uid);
    if (hit) return hit.uid!;
    if (pg.nextOffset == null) break;
    offset = pg.nextOffset;
  }
  return null;
}

/** Add to / remove from Liked Songs or a playlist (see Commands.addTo). */
export async function addTo(sp: Sp, trackUri: string, targetUri: string, on: boolean): Promise<void> {
  if (targetUri === LIKED) return setLiked(sp, trackUri, on);
  const had = sp.store.getState().membership[targetUri]?.[trackUri];
  applyMembership(sp, trackUri, targetUri, on);
  try {
    if (on) {
      await mutate(sp, 'addToPlaylist', { playlistItemUris: [trackUri], playlistUri: targetUri,
                                         newPosition: { moveType: 'BOTTOM_OF_PLAYLIST', fromUid: null } });
    } else {
      const uid = await uidIn(sp, targetUri, trackUri);
      if (!uid) throw new Error('not found in that playlist');
      await mutate(sp, 'removeFromPlaylist', { playlistUri: targetUri, uids: [uid] });
    }
  } catch (e) {
    applyMembership(sp, trackUri, targetUri, had ?? null);
    status(sp, 'Spotify: could not ' + (on ? 'add to' : 'remove from') + ' the playlist (' +
      ((e as { status?: number }).status ?? (e as Error).message) + ')');
    return;
  }
  const m = sp.cache.members.get(targetUri) ?? new Map<string, string>();
  if (on) { if (!m.has(trackUri)) m.set(trackUri, ''); } else m.delete(trackUri);
  sp.cache.members.set(targetUri, m);
  if (on) sp.cache.curated.set(trackUri, { at: Date.now(), isCurated: true });
  else sp.cache.curated.delete(trackUri);                         // may still be in another one
  invalidate?.([['spotify', 'collection', targetUri], ['spotify', 'membership', trackUri]]);
}

/** The web player's own gate, isCuratedEntities { uris: [track] } (captured live 2026-09-25):
 *  data.lookupEntities[{ uri, isCurated }] — ONE flag per track, "is it in any of the user's
 *  playlists", not which. false answers every playlist; true (or no answer: null) leaves it to the
 *  page reads. Remembered 5 min per track; our own add / remove update it. */
async function curated(sp: Sp, trackUri: string): Promise<boolean | null> {
  const memo = sp.cache.curated.get(trackUri);
  if (memo && Date.now() - memo.at < MEMBERSHIP_TTL) return memo.isCurated;
  let d: any;
  try { d = await query(sp, 'isCuratedEntities', { uris: [trackUri] }, { quiet: true }); } catch { return null; }
  debugShape(sp, 'isCuratedEntities', d);
  const e = ((d && d.lookupEntities) || []).find((x: any) => x && x.uri === trackUri) ?? (d && d.lookupEntities && d.lookupEntities[0]);
  if (!e || typeof e.isCurated !== 'boolean') return null;
  sp.cache.curated.set(trackUri, { at: Date.now(), isCurated: e.isCurated });
  return e.isCurated;
}

/** Which of these playlists hold the track. Pages already seen answer first (a sighting = in it;
 *  a complete read in the last 5 min without it = not); then the isCuratedEntities gate (in none
 *  of the user's playlists = all false, one call); otherwise each playlist's pages are read, at
 *  most 10 playlists per call and 5 pages (500 tracks) each — a longer playlist without the track
 *  stays unknown (absent from the answer). Cost then: up to 50 fetchPlaylist calls uncached. */
export async function fetchMembership(sp: Sp, trackUri: string, playlistUris: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}, now = Date.now();
  const ask: string[] = [];
  for (const pl of new Set(playlistUris)) {
    if (sp.cache.members.get(pl)?.has(trackUri)) out[pl] = true;
    else if (now - (sp.cache.scanned.get(pl) ?? -Infinity) < MEMBERSHIP_TTL) out[pl] = false;
    else ask.push(pl);
  }
  if (!ask.length) return out;
  const cur = await curated(sp, trackUri);
  if (cur === false) {                                            // in none of the user's playlists
    for (const pl of ask) out[pl] = false;
    return out;
  }
  if (cur === null && !sp.cache.curatedFailed) {
    sp.cache.curatedFailed = true;
    status(sp, 'Spotify: playlist check unavailable — reading the playlists instead');
  }
  for (const pl of ask.slice(0, SCAN_PLAYLISTS)) {
    try {
      const uid = await uidIn(sp, pl, trackUri);
      if (uid || sp.cache.members.get(pl)?.has(trackUri)) out[pl] = true;
      else if (now - (sp.cache.scanned.get(pl) ?? -Infinity) < MEMBERSHIP_TTL) out[pl] = false;
    } catch { /* unknown */ }
  }
  return out;
}

// ------------------------------------------------------------------ new and deleted playlists, played episodes
// What the web player sends (captured 2026-10-05 on open.spotify.com, its writes held back): New playlist is
// POST spclient.wg playlist/v2/playlist { ops: [UPDATE_LIST_ATTRIBUTES { name }] } -> { uri }, then that uri
// put at the top of the user's rootlist (rootlist/changes, ADD addFirst); Delete takes it off the rootlist
// (REM, itemsAsKey), which for another's playlist is an unfollow.
const WG = 'https://spclient.wg.spotify.com';
const took = (r: Resp) => r.status >= 200 && r.status < 300;
const why = (e: unknown) => (e as Error).message;

async function rootlist(sp: Sp, op: object): Promise<void> {
  const user = await username(sp);
  if (!user) throw new Error('no username');
  const r = await post(sp, WG + '/playlist/v2/user/' + encodeURIComponent(user) + '/rootlist/changes',
                       { deltas: [{ ops: [op], info: { source: { client: 'WEBPLAYER' } } }] });
  if (!took(r)) throw new Error(String(r.status));
}

/** New playlist (Commands.createPlaylist): its uri, the library list refetched; null and a note if refused. */
export async function createPlaylist(sp: Sp, name: string): Promise<string | null> {
  try {
    const r = await post(sp, WG + '/playlist/v2/playlist',
                         { ops: [{ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { name } } } }] });
    const uri = (r.json as { uri?: unknown } | null)?.uri;
    if (!took(r) || typeof uri !== 'string' || !uri.startsWith('spotify:playlist:')) throw new Error(String(r.status));
    // ponytail: refused here, the playlist stays made but out of the library (Spotify's own client the same)
    await rootlist(sp, { kind: 'ADD', add: { items: [{ uri, attributes: { timestamp: String(Date.now()) } }], addFirst: true } });
    sp.cache.names.set(uri, name);
    invalidate?.([['spotify', 'library']]);
    return uri;
  } catch (e) {
    status(sp, 'Spotify: could not create the playlist (' + why(e) + ')');
    return null;
  }
}

/** Delete (Commands.deletePlaylist): off the library, the list refetched; false and a note if refused. */
export async function deletePlaylist(sp: Sp, uri: string): Promise<boolean> {
  try {
    await rootlist(sp, { kind: 'REM', rem: { items: [{ uri }], itemsAsKey: true } });
  } catch (e) {
    status(sp, 'Spotify: could not delete the playlist (' + why(e) + ')');
    return false;
  }
  invalidate?.([['spotify', 'library']]);
  return true;
}

// Mark as played: the web player's two menu items for it (an episode's, and a show's "mark as finished") both
// put the uri in the collection set "markedasfinished" and take it out for unplayed, POST collection/v2/write
// { username, set, items: [{ uri }] } with is_removed: true to take out (its bundle, 2026-10-05). The web
// build hides both (canMarkEpisodesAsDone false); the desktop also calls a native markAsPlayed the web has
// none of, and reads the set back as "marked as finished". Measured live 2026-10-05: the set takes the
// write, while pathfinder's playedState (NOT_STARTED) does not follow it, so the show's rows read the set
// too (markedFinished). ponytail: what Spotify's phone app shows for such an episode is unconfirmed, and
// unplayed only undoes a mark: an episode listened to the end stays COMPLETED in playedState.
const FINISHED = 'markedasfinished';
// the bare media type, as the web player sends it here: with ";charset=UTF-8" the collection service answers
// 400 and an empty body (measured on contains, 2026-10-05)
const collection = async (sp: Sp, op: 'write' | 'contains', items: object[]) => {
  const user = await username(sp);
  if (!user) throw new Error('no username');
  const r = await post(sp, WG + '/collection/v2/' + op, { username: user, set: FINISHED, items }, 'POST', { 'Content-Type': 'application/json' });
  if (!took(r)) throw new Error(String(r.status));
  return r.json as { found?: unknown[] } | null;
};

/** Which of these episodes are in the set (fetchShowPage reads its rows' marks with it). */
export async function markedFinished(sp: Sp, uris: string[]): Promise<Set<string>> {
  const found = uris.length ? (await collection(sp, 'contains', uris.map((uri) => ({ uri }))))?.found ?? [] : [];
  return new Set(uris.filter((_u, i) => found[i] === true));
}

/** Mark as played / unplayed (Commands.markPlayed): optimistic in `played`, the show's rows refetched. */
export async function markPlayed(sp: Sp, uri: string, played: boolean): Promise<void> {
  const { played: marks, actions } = sp.store.getState(), had = uri in marks ? marks[uri]! : null;
  actions.setPlayed(uri, played);
  try {
    await collection(sp, 'write', [{ uri, ...(played ? {} : { is_removed: true }) }]);
  } catch (e) {
    actions.setPlayed(uri, had);
    status(sp, 'Spotify: could not mark the episode ' + (played ? 'played' : 'unplayed') + ' (' + why(e) + ')');
    return;
  }
  const show = sp.cache.tracks.get(uri)?.ctx;
  if (show) invalidate?.([['spotify', 'collection', show]]);
}
