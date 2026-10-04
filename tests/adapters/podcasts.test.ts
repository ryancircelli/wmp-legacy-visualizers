/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// Podcasts: the followed shows (libraryV3 under the Podcasts filter), a show's episodes (queryPodcastEpisodes,
// its hash from the bundle scan after a visit to /show/<id>), and an episode in Now Playing. Responses are
// synthetic, in the shapes the adapter's sources document (podcasts.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpotifyAdapter } from '../../src/adapters/spotify';
import * as Q from '../../src/adapters/spotify/queries';
import { FX, bundle, clone, mkEnv, settle } from './harness';

vi.mock('../../src/adapters/local/audio', () => ({
  makeLevel: () => ({ freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 0, timeStamp: 0 }),
  createAnalyserGraph: () => { throw new Error('no Web Audio in these tests'); },
  createPcmLevel: () => ({ push() {}, fill() {} }),
}));

let stops: (() => void)[] = [];
afterEach(() => { stops.forEach((s) => s()); stops = []; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.alchemyLog; });

const SHOW = 'spotify:show:5CfCWKI5pZ28U0uOzXkDHe', SHA = 'e'.repeat(64);
const pics = (id: string) => ({ sources: [{ url: 'https://i.scdn.co/image/' + id + '64', width: 64 }, { url: 'https://i.scdn.co/image/' + id + '300', width: 300 }] });
/** libraryV3's Podcasts filter: one show in libraryV3's item wrapper, and Your Episodes (not a show) */
const showsPage = (filters: object[] = [{ id: 'Playlists', name: 'Playlists' }, { id: 'Podcasts', name: 'Podcasts & Shows' }]) => ({ data: { me: { libraryV3: {
  __typename: 'LibraryPage', totalCount: 2, availableFilters: filters, items: [
    { item: { __typename: 'LibraryPseudoPlaylistResponseWrapper', _uri: 'spotify:collection:your-episodes', data: { uri: 'spotify:collection:your-episodes', name: 'Your Episodes' } } },
    { item: { __typename: 'PodcastResponseWrapper', _uri: SHOW, data: { __typename: 'Podcast', uri: SHOW, name: 'Hard Fork', coverArt: pics('show'), publisher: { name: 'The New York Times' } } } },
  ] } } } });
const episode = (n: number, state?: string) => ({ entity: { _uri: 'spotify:episode:e' + n, data: {
  __typename: 'Episode', uri: 'spotify:episode:e' + n, name: 'Episode ' + n, duration: { totalMilliseconds: 3_900_000 + n },
  releaseDate: { isoString: '2026-09-' + String(10 + n) + 'T09:00:00Z', precision: 'DAY' }, coverArt: pics('ep' + n),
  ...(state ? { playedState: { state, playPositionMilliseconds: 0 } } : {}) } } });
const episodesPage = (items: unknown[], totalCount: number) => ({ data: { podcastUnionV2: { __typename: 'Podcast', episodesV2: { totalCount, items } } } });

function setup(o: { library?: (filters: string[]) => object; episodes?: object; hash?: boolean; state?: unknown } = {}) {
  const env = mkEnv({ loggedIn: true, state: o.state });
  const ad = createSpotifyAdapter(env.store);
  stops.push(() => ad.stop());
  env.route(/web-player\.abc\.js/, { status: 200, body: bundle(o.hash === false ? {} : { ...FX.hashes, queryPodcastEpisodes: SHA }) });
  env.route(/player\/command/, { status: 200, json: { ack_id: 'p' } });
  env.route(/pathfinder/, (_u, init) => {
    const b = JSON.parse(init.body);
    if (b.operationName === 'libraryV3') return { status: 200, json: (o.library ?? (() => showsPage()))(b.variables.filters) };
    if (b.operationName === 'queryPodcastEpisodes') return { status: 200, json: o.episodes ?? episodesPage([episode(1, 'NOT_STARTED'), episode(2, 'COMPLETED'), episode(3)], 120) };
    return { status: 200, json: { data: {} } };
  });
  ad.start();
  const log = vi.fn();
  window.alchemyLog = log;
  const ops = (name: string) => env.pf().filter((c) => c.body.operationName === name);
  return Object.assign(env, { log, ops });
}

describe('the followed shows', () => {
  it('libraryV3 under the Podcasts filter, as the Artists chip asks; show rows only, the publisher as owner; under the library\'s key', async () => {
    const env = setup();
    expect(await Q.fetchShows()).toEqual([{ uri: SHOW, name: 'Hard Fork', image: 'https://i.scdn.co/image/show300', owner: 'The New York Times' }]);
    const lv = env.ops('libraryV3');
    expect(JSON.stringify(lv[0]!.body.variables)).toBe(JSON.stringify({ ...FX.libraryV3.request.variables, filters: ['Podcasts'] }));
    expect(Q.keys.shows()).toEqual([...Q.keys.libraryList(), 'shows']);
    expect(env.log).not.toHaveBeenCalled();
  });
  it('a podcast filter offered under another id is asked for next; none at all is said in the host\'s log', async () => {
    const env = setup({ library: (f) => (f[0] === 'Shows' ? showsPage([{ id: 'Shows', name: 'Podcasts' }])
      : { data: { me: { libraryV3: { totalCount: 0, availableFilters: [{ id: 'Shows', name: 'Podcasts' }], items: [] } } } }) });
    expect((await Q.fetchShows()).map((s) => s.name)).toEqual(['Hard Fork']);
    expect(env.ops('libraryV3').map((c) => c.body.variables.filters)).toEqual([['Podcasts'], ['Shows']]);
    const none = setup({ library: () => FX.libraryV3.response });                            // the captured library: no Podcasts filter
    expect(await Q.fetchShows()).toEqual([]);
    expect(none.log).toHaveBeenCalledWith('spotify: libraryV3: no followed shows (filters offered: Playlists, Artists, Albums; '
      + 'items: LibraryPseudoPlaylistResponseWrapper, PlaylistResponseWrapper)');
  });
});

describe('a show\'s episodes', () => {
  it('queryPodcastEpisodes { uri, offset, limit } with the scanned hash: title, the show\'s name, length, date, unplayed only where Spotify says', async () => {
    const env = setup();
    await Q.fetchShows();                                                                     // names the show
    const p = await Q.fetchCollectionPage(SHOW);
    const q = env.ops('queryPodcastEpisodes')[0]!;
    expect(q.body.variables).toEqual({ uri: SHOW, offset: 0, limit: 50 });
    expect(q.body.extensions.persistedQuery.sha256Hash).toBe(SHA);
    expect(env.pushed).toEqual([]);                                                           // the hash was known: no route visit
    expect(p.tracks[0]).toEqual({ uri: 'spotify:episode:e1', title: 'Episode 1', artist: 'Hard Fork', album: 'Hard Fork', duration: 3_900_001, ctx: SHOW,
                                  art: 'https://i.scdn.co/image/ep1300', image: 'https://i.scdn.co/image/ep164', releaseDate: '2026-09-11', unplayed: true });
    expect(p.tracks.map((t) => t.unplayed)).toEqual([true, false, undefined]);
    expect([p.total, p.nextOffset, p.meta]).toEqual([120, 3, undefined]);
  });
  it('no hash in the bundles: /show/<id> visited, then the host\'s log says so and the page fails; an odd shape is said too', async () => {
    const env = setup({ hash: false });
    const p = Q.fetchCollectionPage(SHOW).catch((e: Error) => e);
    await settle();
    expect(env.pushed).toEqual(['/show/5CfCWKI5pZ28U0uOzXkDHe']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBeInstanceOf(Q.QueryError);
    expect(env.log).toHaveBeenCalledWith('spotify: no hash for queryPodcastEpisodes in the page\'s bundles: a show\'s episodes cannot be listed');
    const odd = setup({ episodes: { data: { showUnion: {} } } });
    expect((await Q.fetchCollectionPage(SHOW)).tracks).toEqual([]);                          // its hash scanned first: no visit
    expect(odd.pushed).toEqual([]);
    expect(odd.log).toHaveBeenCalledWith('spotify: queryPodcastEpisodes: unexpected shape (data: showUnion; podcastUnionV2: )');
  });
});

describe('an episode playing', () => {
  it('plays in its show; Now Playing names it from the listed row (title, the show as artist and album, its cover); its metadata keys go to the log', async () => {
    const env = setup();
    await Q.fetchShows();
    const [e1] = (await Q.fetchCollectionPage(SHOW)).tracks;
    env.C.playItem(e1!); await settle();
    const play = env.cmds().pop();
    expect([play.endpoint, play.context.uri, play.options.skip_to]).toEqual(['play', SHOW, { track_uri: 'spotify:episode:e1' }]);
    const ps = clone(FX.playerState);
    ps.context_uri = SHOW;
    ps.track = { uri: 'spotify:episode:e1', uid: 'x', metadata: { context_uri: SHOW }, provider: 'context' };   // what an episode carries is unconfirmed
    env.fire('wmp-spotify-state', ps);
    const t = env.S.playback.track!;
    expect([t.title, t.artist, t.album, t.art]).toEqual(['Episode 1', 'Hard Fork', 'Hard Fork', 'https://i.scdn.co/image/ep1300']);
    expect(env.S.playback.context).toMatchObject({ uri: SHOW, kind: 'show' });
    expect(env.log).toHaveBeenCalledWith('spotify: episode e1 metadata keys: context_uri');
  });
});
