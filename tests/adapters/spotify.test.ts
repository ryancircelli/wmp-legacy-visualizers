/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// The Spotify adapter against CONTRACT.md v6.1: a port of every behaviour tests/spotify.test.js
// checks that is not presentation (menus, DOM rows and dialogs are the skin's, tests/skins/**).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIKED, positionNow, totalMs, trackLabel } from '../../src/model';
import { createSpotifyAdapter, newSp } from '../../src/adapters/spotify';
import { hashFor, query, rescan, visitRoute } from '../../src/adapters/spotify/pathfinder';
import { dateOf } from '../../src/adapters/spotify/library';
import { parseLink } from '../../src/adapters/spotify/links';
import { QueryError, RateLimitError, post } from '../../src/adapters/spotify/sp';
import * as Q from '../../src/adapters/spotify/queries';
import { CHUNK, FX, FakeSocket, ME, T0, bundle, clone, mkEnv, settle } from './harness';

vi.mock('../../src/adapters/local/audio', () => ({
  makeLevel: () => ({ freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 0, timeStamp: 0 }),
  createAnalyserGraph: () => { throw new Error('no Web Audio in these tests'); },
  createPcmLevel: () => ({ push() {}, fill() {} }),
}));

let stops: (() => void)[] = [];
function boot(W: Record<string, unknown> = {}, settings = {}) {
  const env = mkEnv(W, settings);
  const ad = createSpotifyAdapter(env.store);
  stops.push(() => ad.stop());
  return Object.assign(env, { start: () => ad.start() });
}
afterEach(() => { stops.forEach((s) => s()); stops = []; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const PL = 'spotify:playlist:2awChHWKKqe1TgwxBtUp4E';
const pathfinderFixtures = (env: ReturnType<typeof boot>) => env.route(/pathfinder/, (_u, init) => {
  const b = JSON.parse(init.body), json = clone((FX[b.operationName] || {}).response);
  if (b.operationName === 'libraryV3' && b.variables.offset) json.data.me.libraryV3.items = [];   // later pages
  return { status: 200, json };
});

describe('1. login gate (wmp-spotify-auth)', () => {
  it('shows the overlay only while logged in; never calls the public Web API', async () => {
    localStorage.removeItem('wmp.loggedIn');
    const env = boot({ loggedIn: undefined });
    env.start();
    await settle();
    expect(env.host().style.display).toBe('none');
    expect(env.S.auth.loggedIn).toBe(null);                          // not known yet: nothing asked, nothing shown
    env.fire('wmp-spotify-auth', { loggedIn: !FX.apiToken.isAnonymous });
    await settle();
    expect(env.host().style.display).toBe('');
    expect(env.S.auth.loggedIn).toBe(true);
    env.fire('wmp-spotify-auth', { loggedIn: false });
    expect(env.host().style.display).toBe('none');
    expect(env.calls.every((c) => !/api\.spotify\.com/.test(c.url))).toBe(true);
  });
  it('loggedIn already true in __wmpSpotify at start: shown; nothing fetched until a view asks', async () => {
    const env = boot({ loggedIn: true });
    env.start();
    await settle();
    expect(env.host().style.display).toBe('');
    expect(env.pf()).toEqual([]);                                     // the library is a query the UI runs
    expect(env.calls.every((c) => !/api\.spotify\.com/.test(c.url))).toBe(true);
  });
});

describe('2. player_state -> playback', () => {
  it('maps the sample', async () => {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.start();
    await settle();
    const p = env.S.playback;
    expect(p.status).toBe('playing');
    expect(p.source).toBe('spotify');
    expect(p.track!.title).toBe('Wish I Knew You');
    expect(p.track!.artist).toBe('The Revivalists');
    expect(p.track!.album).toBe('Men Amongst Mountains');
    expect(p.track!.art).toBe('https://i.scdn.co/image/ab67616d00001e02c5214ee5d4300598a8a95264');
    expect(p.track!.duration).toBe(274140);
    expect(p.position).toBe(30091 + 5000);
    expect(p.canSeek && p.canNext && p.canPrev).toBe(true);
    expect(p.shuffle).toBe(true);
    expect(p.repeat).toBe('context');
    expect(env.S.ui.status).toBe('Playing: The Revivalists – Wish I Knew You');
    // Playing from: its own row, the kind until the name is fetched
    expect(p.context).toEqual({ uri: FX.playerState.context_uri, kind: 'playlist', label: 'Playlist' });
    expect(p.from).toBe('Playlist');
    // Up Next = next_tracks that carry metadata (delimiter and bare entries dropped)
    expect(env.S.queue.next.map(trackLabel).join('|')).toBe('Revelry – Kings of Leon');
    expect(vi.getTimerCount()).toBe(0);                    // no polling
  });
  it('is_paused, spotify:image:, disallow reasons', () => {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.start();
    const ps = clone(FX.playerState);
    ps.is_paused = true;                     // is_playing stays true while paused
    ps.track.metadata.image_url = 'spotify:image:ab67616d00001e02c5214ee5d4300598a8a95264';
    ps.restrictions.disallow_skipping_prev_reasons = ['no_prev_track'];
    env.fire('wmp-spotify-state', ps);
    const p = env.S.playback;
    expect(p.status).toBe('paused');
    expect(p.position).toBe(30091);
    expect(positionNow(env.S, T0 + 10_000)).toBe(30091);
    expect(p.track!.art).toBe('https://i.scdn.co/image/ab67616d00001e02c5214ee5d4300598a8a95264');
    expect(p.canPrev).toBe(false);
    expect(env.S.ui.status).toBe('Paused: The Revivalists – Wish I Knew You');
  });
  it('host GSMTC frames are ignored while a Spotify state exists, passed through before', () => {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.start();
    FakeSocket.last!.host({ type: 'media', status: 'playing', title: 'GSMTC' });
    expect(env.S.playback.track!.title).toBe('Wish I Knew You');
    const env2 = boot({ loggedIn: true });
    env2.start();
    FakeSocket.last!.host({ type: 'media', status: 'playing', title: 'GSMTC', position: 3, duration: 10 });
    expect([env2.S.playback.source, env2.S.playback.track!.title, env2.S.playback.position]).toEqual(['host', 'GSMTC', 3000]);
  });
  it('a state with no active device reads as paused', () => {
    const env = boot({ loggedIn: true, state: FX.playerState, activeDeviceId: '' });
    env.start();
    expect(env.S.playback.status).toBe('paused');
  });
});

describe('3. transport: connect-state commands', () => {
  function setup() {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.resources.push({ name: 'https://gew4-spclient.spotify.com/connect-state/v1/devices/hobs_x', initiatorType: 'fetch' });
    env.route(/player\/command/, { status: 200, json: { ack_id: 'a' } });
    env.route(/connect\/volume/, { status: 200, json: {} });
    env.start();
    return env;
  }
  it('play/pause, seek, next, prev', async () => {
    const env = setup();
    await settle();
    void env.C.playPause();
    await settle();
    const c = env.calls.filter((x) => /player\/command/.test(x.url)).pop()!;
    expect(c.url).toBe('https://gew4-spclient.spotify.com/connect-state/v1/player/command/from/' + ME + '/to/' + FX.activeDeviceId);
    expect(c.method).toBe('POST');
    expect(c.headers.Authorization).toBe('Bearer TOK');
    expect(c.headers['client-token']).toBe('CT');
    expect(JSON.stringify(c.body)).toBe('{"command":{"endpoint":"pause"}}');
    // seek resolves only once the player has answered
    let answered = false, release!: () => void;
    env.route(/player\/command/, { status: 200, json: { ack_id: 's' }, delay: new Promise<void>((r) => { release = r; }) });
    const sk = env.C.seek(60_000).then(() => { answered = true; });
    await settle();
    expect(answered).toBe(false);
    release(); await sk;
    expect(answered).toBe(true);
    expect(JSON.stringify(env.calls.pop()!.body)).toBe('{"command":{"endpoint":"seek_to","value":60000}}');
    env.route(/player\/command/, { status: 200, json: { ack_id: 'a' } });
    await expect(env.C.next()).resolves.toBeUndefined();
    env.calls.pop();
    void env.C.next(); await settle();
    expect(env.calls.pop()!.body.command.endpoint).toBe('skip_next');
    void env.C.prev(); await settle();
    expect(env.calls.pop()!.body.command.endpoint).toBe('skip_prev');
    expect(env.sent().filter((m) => m.type === 'mediaCmd')).toEqual([]);
  });
  it('a pending seek outlives a state that still shows the old position', async () => {
    const env = setup();
    await settle();
    env.route(/player\/command/, { status: 200, json: { ack_id: 's' } });
    void env.C.seek(60_000); await settle();
    expect(env.S.playback.position).toBe(60_000);
    // the cluster Spotify pushes on receipt, the device not yet sought: the slider must not snap back
    env.fire('wmp-spotify-state', clone(FX.playerState));
    expect(env.S.playback.position).toBe(60_000);
    expect(env.S.playback.pending).not.toBeNull();
    // the state after the seek: the player's word
    const ps = clone(FX.playerState);
    ps.position_as_of_timestamp = '60500'; ps.timestamp = String(Date.now());
    env.fire('wmp-spotify-state', ps);
    expect(env.S.playback.position).toBe(60_500);
    expect(env.S.playback.pending).toBeNull();
  });
  it('fallback to the host mediaCmd is per command: network error, then non-2xx', async () => {
    const env = setup();
    env.route(/player\/command/, () => new Error('offline'));
    void env.C.next(); await settle();
    expect(env.sent().filter((m) => m.type === 'mediaCmd')).toEqual([{ type: 'mediaCmd', cmd: 'next' }]);
    env.route(/player\/command/, { status: 200, json: { ack_id: 'b' } });
    const before = env.calls.length;
    void env.C.pause(); await settle();
    expect(env.calls.length > before && /player\/command/.test(env.calls[env.calls.length - 1]!.url)).toBe(true);
    env.route(/player\/command/, { status: 403, json: { error: { message: 'Premium required' } } });
    void env.C.next(); await settle();
    expect(env.sent().filter((m) => m.type === 'mediaCmd').length).toBe(2);
    expect(env.S.ui.status).toMatch(/Premium required/);
    env.route(/player\/command/, () => new Error('offline'));
    void env.C.seek(12_500); await settle();
    expect(env.sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'seek', position: 12.5 });
  });
  it('play a playlist from a track', async () => {
    const env = setup();
    env.C.playContext(PL, 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK');
    await settle();
    expect(JSON.stringify({ command: env.cmds().pop() })).toBe(JSON.stringify({ command: { endpoint: 'play',
      context: { uri: PL, url: 'context://' + PL },
      play_origin: { feature_identifier: 'playlist', feature_version: 'xpui' },
      options: { skip_to: { track_uri: 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK' } } } }));
  });
  it('stop = pause + seek_to 0 through the player', async () => {
    const env = setup();
    env.C.stop(); await settle();
    expect(env.cmds().slice(-2).map((c) => JSON.stringify(c)).join(' ')).toBe('{"endpoint":"pause"} {"endpoint":"seek_to","value":0}');
    expect(env.S.playback.capture).toBeNull();
  });
  it('volume and mute: PUT connect/volume 0..65535', async () => {
    const env = setup();
    await settle();
    env.S.actions.setVolume(50); await settle();
    const v = env.calls.pop()!;
    expect(v.url).toBe('https://gew4-spclient.spotify.com/connect-state/v1/connect/volume/from/' + ME + '/to/' + FX.activeDeviceId);
    expect(v.method).toBe('PUT');
    expect(v.body.volume).toBe(32768);
    env.S.actions.setVolume(null, true); await settle();
    expect(env.calls.pop()!.body.volume).toBe(0);
    env.S.actions.setVolume(150); await settle();
    expect(env.S.settings.volume).toBe(100);
    expect(env.calls.pop()!.body.volume).toBe(65535);
  });
  it('shuffle: from state, toggled', async () => {
    const env = setup();
    expect(env.S.playback.shuffle).toBe(true);
    env.C.toggleShuffle(); await settle();
    expect(JSON.stringify(env.cmds().pop())).toBe('{"endpoint":"set_shuffling_context","value":false}');
    env.fire('wmp-spotify-state', { ...FX.playerState, options: { shuffling_context: false } });
    expect(env.S.playback.shuffle).toBe(false);
  });
  it('rewind / fast-forward: seek_to relative to the extrapolated position', async () => {
    const env = setup();
    const posNow = +FX.playerState.position_as_of_timestamp + 5000;
    env.C.skip(10); await settle();
    const ff = env.cmds().pop();
    expect(ff.endpoint).toBe('seek_to');
    expect(Math.abs(ff.value - (posNow + 10_000))).toBeLessThan(50);
    env.C.skip(-10); await settle();                                  // from the shown (optimistic) position
    expect(Math.abs(env.cmds().pop().value - posNow)).toBeLessThan(50);
  });
  it('a remembered 150% capture volume clamps to the player\'s 100 at start', () => {
    const env = boot({ loggedIn: true }, { volume: 150 });
    env.start();
    expect(env.S.settings.volume).toBe(100);
  });
  it('before any state the slider is not the player\'s', async () => {
    const env = boot({ loggedIn: true });
    env.start();
    env.S.actions.setVolume(50); await settle();
    expect(env.calls.some((c) => /connect\/volume/.test(c.url))).toBe(false);
  });
});

describe('3b. the playing context names Now Playing and Up Next', () => {
  it('fetches the playing playlist once for its name and tracks', async () => {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      if (b.operationName !== 'fetchPlaylist') return { status: 200, json: { data: {} } };
      return { status: 200, json: { data: { playlistV2: { name: 'Road Trip', content: { items: [
        { itemV2: { data: { uri: 'spotify:track:53eJFr4Mfbw5PXJ01K6cFw', name: 'Under the Bridge', artists: { items: [{ profile: { name: 'RHCP' } }] } } } },
      ] } } } } };
    });
    env.start();
    await settle();
    const f = env.pf().filter((c) => c.body.operationName === 'fetchPlaylist');
    expect(f.length).toBe(1);
    expect(f[0]!.body.variables.uri).toBe(FX.playerState.context_uri);
    expect(env.S.playback.context!.label).toBe('Playlist: Road Trip');
    expect(env.S.playback.from).toBe('Playlist: Road Trip');
    // metadata entry, then one named from the context; the unknown one left out
    expect(env.S.queue.next.map(trackLabel).join('|')).toBe('Revelry – Kings of Leon|Under the Bridge – RHCP');
  });
});

describe('4. hash resolution + 412 rescan', () => {
  it('W.hashes -> script scan -> baked; 412 rescans once and retries', async () => {
    const env = mkEnv({ loggedIn: false, hashes: { fetchLibraryTracks: 'a'.repeat(64) } });
    const sp = newSp(env.store);
    env.route(/web-player\.abc\.js/, { status: 200, body: bundle({ libraryV3: 'b'.repeat(64), fetchLibraryTracks: 'c'.repeat(64) }) });
    await rescan(sp);
    expect(hashFor(sp, 'fetchLibraryTracks')).toBe('a'.repeat(64));
    expect(hashFor(sp, 'libraryV3')).toBe('b'.repeat(64));
    expect(hashFor(sp, 'getAlbum')).toBe('6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361');

    env.resources.push({ name: CHUNK, initiatorType: 'script' });
    env.route(/xpui-routes-search/, { status: 200, body: bundle({ fetchLibraryTracks: 'e'.repeat(64) }) });
    env.route(/pathfinder/, (_u, init) => JSON.parse(init.body).extensions.persistedQuery.sha256Hash === 'a'.repeat(64)
      ? { status: 412, body: 'Invalid query hash' } : { status: 200, json: FX.fetchLibraryTracks.response });
    const d = await query(sp, 'fetchLibraryTracks', { offset: 0, limit: 50 });
    const q = env.pf();
    expect(q.length).toBe(2);
    expect(q[1]!.body.extensions.persistedQuery.sha256Hash).toBe('e'.repeat(64));
    expect(env.calls.some((c) => c.url === CHUNK)).toBe(true);
    expect(q[0]!.url).toBe('https://api-partner.spotify.com/pathfinder/v2/query');
    expect(q[0]!.body.operationName).toBe('fetchLibraryTracks');
    expect(q[0]!.headers.Authorization).toBe('Bearer TOK');
    expect(d.me.library.tracks.items.length).toBe(2);

    env.route(/pathfinder/, { status: 412, body: 'Invalid query hash' });
    const err = await query(sp, 'libraryV3', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QueryError);
    expect(err).toMatchObject({ op: 'libraryV3', status: 412 });
    expect(env.pf().length).toBe(4);
    expect(env.S.ui.status).toMatch(/libraryV3 failed \(412\)/);
  });
  it('429 honours Retry-After: nothing is sent until it has passed', async () => {
    const env = mkEnv();
    const sp = newSp(env.store);
    env.route(/x\.test/, { status: 429, headers: { 'Retry-After': 2 } });
    expect((await post(sp, 'https://x.test/a', {})).status).toBe(429);
    expect((await post(sp, 'https://x.test/b', {})).status).toBe(429);
    expect(env.calls.length).toBe(1);
    vi.setSystemTime(T0 + 2001);
    env.route(/x\.test/, { status: 200, json: {} });
    expect((await post(sp, 'https://x.test/c', {})).status).toBe(200);
    expect(env.calls.length).toBe(2);
    vi.setSystemTime(T0 + 5000);
    env.route(/x\.test/, { status: 429 });           // no Retry-After: one second
    await post(sp, 'https://x.test/d', {});
    vi.setSystemTime(T0 + 6001);
    await post(sp, 'https://x.test/e', {});
    expect(env.calls.length).toBe(4);
  });
  it('no token: nothing is sent', async () => {
    const env = mkEnv({ token: undefined });
    expect((await post(newSp(env.store), 'https://x.test/a', {})).status).toBe(0);
    expect(env.calls.length).toBe(0);
  });
});

describe('5. search: route trigger, then searchDesktop', () => {
  it('visits /search once, scans the chunk, returns every bucket + the top result', async () => {
    const env = boot({ loggedIn: false });
    env.route(/web-player\.abc\.js/, { status: 200, body: bundle({ libraryV3: 'b'.repeat(64) }) });
    env.route(/xpui-routes-search/, { status: 200, body: bundle({ searchDesktop: 'f'.repeat(64) }) });
    env.route(/pathfinder/, { status: 200, json: FX.searchDesktop.response });
    env.start();
    const p = Q.fetchSearch('queen', 'all');
    await settle();
    expect(env.pushed.join()).toBe('/search');
    env.resources.push({ name: CHUNK, initiatorType: 'script' });
    await vi.advanceTimersByTimeAsync(1500);
    const s = await p;
    const q = env.pf().pop()!;
    expect(q.body.operationName).toBe('searchDesktop');
    expect(q.body.extensions.persistedQuery.sha256Hash).toBe('f'.repeat(64));
    expect([q.body.variables.searchTerm, q.body.variables.limit]).toEqual(['queen', 10]);
    expect(s.tracks.items[0] && trackLabel(s.tracks.items[0])).toBe('Bohemian Rhapsody – Queen');
    expect(s.tracks).toMatchObject({ total: 18, offset: 0, exact: false, hasMore: true, nextOffset: 2 });
    expect(s.albums.items.map((c) => [c.name, c.artist])).toEqual([['Queen Of The Damned (Music From The Motion Picture)', 'Various Artists']]);
    expect(s.playlists.items.map((c) => c.name)).toEqual(['Queen Radio']);
    expect([s.albums.total, s.playlists.total, s.artists.total]).toEqual([20, 15, 16]);
    expect(s.artists.items.map((a) => a.name)).toEqual(['Queen', 'Queen Latifah', 'Queens of the Stone Age']);
    expect(s.artists.items[0]).toEqual({ uri: 'spotify:artist:1dfeR4HaWDbWqFHLkxsg1d', name: 'Queen', kind: 'artist',
                                         image: 'https://i.scdn.co/image/ab6761610000517473e4d22612ac8d944b5789b4' });
    expect(s.top).toEqual({ kind: 'artist', item: s.artists.items[0] });
    await Q.fetchSearch('again', 'all');
    expect(env.pushed.length).toBe(1);
    const n = env.pf().length;
    expect(await Q.fetchSearch('  ', 'all')).toMatchObject({ tracks: { items: [], total: 0 } });
    expect(env.pf().length).toBe(n);
    env.C.search('queen');
    expect(env.S.ui.searchQ).toBe('queen');                           // the command only selects
    expect(env.pf().length).toBe(n);
  });
});

describe('5b. search: typed paging and fallback', () => {
  const trackItem = (n: number) => ({ item: { data: { uri: 'spotify:track:t' + n, name: 'T' + n, artists: { items: [] } } } });
  const artistItem = (n: number) => ({ data: { uri: 'spotify:artist:a' + n, profile: { name: 'A' + n } } });
  function setup() {
    const env = boot({ loggedIn: false, hashes: { searchDesktop: 'f'.repeat(64) } });
    env.start();
    return env;
  }
  it('searchTracks pages of 20 up to the total; nextOffset leads on; offsets stop at 1000', async () => {
    const env = setup();
    env.route(/pathfinder/, (_u, init) => {
      const v = JSON.parse(init.body).variables;
      const n = Math.max(0, Math.min(v.limit, 45 - v.offset));
      return { status: 200, json: { data: { searchV2: { tracksV2: { totalCount: 45, items: Array.from({ length: n }, (_x, i) => trackItem(v.offset + i)) } } } } };
    });
    let pg = await Q.fetchSearch('queen', 'tracks');
    const q = env.pf().pop()!;
    expect(q.body.operationName).toBe('searchTracks');
    expect(q.body.extensions.persistedQuery.sha256Hash).toBe('b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751');
    expect([q.body.variables.searchTerm, q.body.variables.offset, q.body.variables.limit]).toEqual(['queen', 0, 20]);
    expect(pg).toMatchObject({ total: 45, offset: 0, exact: false, hasMore: true, nextOffset: 20 });
    pg = await Q.fetchSearch('queen', 'tracks', pg.nextOffset);
    expect(pg).toMatchObject({ offset: 20, hasMore: true, nextOffset: 40 });
    pg = await Q.fetchSearch('queen', 'tracks', pg.nextOffset);
    expect(pg.items.map((t) => t.uri)).toEqual(['spotify:track:t40', 'spotify:track:t41', 'spotify:track:t42', 'spotify:track:t43', 'spotify:track:t44']);
    expect([pg.hasMore, pg.nextOffset, pg.exact]).toEqual([false, undefined, true]);
    await Q.fetchSearch('queen', 'tracks', 995, 50);
    expect(env.pf().pop()!.body.variables.limit).toBe(5);             // offset + limit <= 1000
    const n = env.pf().length;
    expect((await Q.fetchSearch('queen', 'tracks', 1000)).items).toEqual([]);
    expect(env.pf().length).toBe(n);
  });
  it('a refused typed op falls back to searchDesktop (50) and says so', async () => {
    const env = setup();
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      if (b.operationName === 'searchArtists') return { status: 400, json: { errors: [{ message: 'bad variables' }] } };
      return { status: 200, json: { data: { searchV2: { artists: { totalCount: 3, items: [artistItem(1), artistItem(2), artistItem(3)] } } } } };
    });
    const pg = await Q.fetchSearch('queen', 'artists');
    expect(env.pf().map((c) => c.body.operationName as string).slice(-2)).toEqual(['searchArtists', 'searchDesktop']);
    expect(env.pf().pop()!.body.variables.limit).toBe(50);
    expect(pg.items.map((a) => (a as { name: string }).name)).toEqual(['A1', 'A2', 'A3']);
    expect(pg).toMatchObject({ exact: false, note: 'searchArtists unavailable: via searchDesktop' });
  });
});

describe('6. library list and collection pages (the query functions)', () => {
  function setup(W: Record<string, unknown> = {}) {
    const env = boot({ loggedIn: false, hashes: FX.hashes, ...W });
    pathfinderFixtures(env);
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.start();
    return env;
  }
  it('libraryV3 pages to totalCount; Liked Songs is its own collection', async () => {
    const env = setup();
    const list = await Q.fetchLibraryList();
    expect(list.map((p) => p.name)).toEqual(['lawnmower classics', 'core core']);
    expect(list[0]).toEqual({ uri: PL, name: 'lawnmower classics', editable: true,
      image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da8450fa2f36e1698624683a85a6' });
    const lv = env.pf().filter((c) => c.body.operationName === 'libraryV3');
    expect(lv.length).toBe(3);                                         // totalCount 133
    expect(lv[0]!.body.extensions.persistedQuery.sha256Hash).toBe(FX.libraryV3.request.sha256Hash);
    expect(JSON.stringify(lv[0]!.body.variables)).toBe(JSON.stringify(FX.libraryV3.request.variables));
    expect(lv.map((c) => c.body.variables.offset)).toEqual([0, 50, 100]);
  });
  it('a playlist page: 100 at a time, rows, total, nextOffset; a row plays in its context', async () => {
    const env = setup();
    const pg = await Q.fetchCollectionPage(PL);
    const fp = env.pf().pop()!;
    expect(fp.body.operationName).toBe('fetchPlaylist');
    expect(fp.body.variables).toMatchObject({ uri: PL, offset: 0, limit: 100 });
    expect(pg.tracks.slice(0, 3).map(trackLabel).join('|')).toBe('Linger – The Cranberries|One Last Breath – Creed|Black – Pearl Jam');
    expect([pg.total, pg.nextOffset, pg.meta!.name]).toEqual([123, 3, 'lawnmower classics']);
    expect(Math.round(pg.tracks[0]!.duration / 1000)).toBe(275);
    const more = await Q.fetchCollectionPage(PL, pg.nextOffset);
    expect(env.pf().pop()!.body.variables.offset).toBe(3);
    expect(more.meta).toBeUndefined();                                // the details come with the first page
    env.C.playContext(pg.tracks[1]!.ctx!, pg.tracks[1]!.uri);
    await settle();
    const play = env.cmds().pop();
    expect(play.context.uri + ' ' + play.options.skip_to.track_uri)
      .toBe(PL + ' ' + FX.fetchPlaylist.response.data.playlistV2.content.items[1].itemV2.data.uri);
    env.C.playAll(PL); await settle();                                 // from the remembered first page
    const all = env.cmds().pop();
    expect([all.context.uri, all.options.skip_to.track_uri]).toEqual([PL, 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK']);
  });
  it('Liked Songs pages in 50s; Play all starts its first track in that track\'s album', async () => {
    const env = setup();
    const pg = await Q.fetchCollectionPage(LIKED);
    expect(trackLabel(pg.tracks[0]!)).toBe('Brokenhearted – Karmin');
    expect([pg.total, pg.nextOffset]).toEqual([1814, 2]);
    await Q.fetchCollectionPage(LIKED, 2);
    const lt = env.pf().filter((c) => c.body.operationName === 'fetchLibraryTracks').pop()!;
    expect(lt.body.variables.offset + '/' + lt.body.variables.limit).toBe('2/50');
    env.C.playAll(LIKED); await settle();
    const lp = env.cmds().pop();
    expect([lp.context.uri, lp.options.skip_to.track_uri]).toEqual([pg.tracks[0]!.ctx, pg.tracks[0]!.uri]);
  });
  it('openInLibrary / the saved view: selection only', () => {
    const env = setup();
    env.C.openInLibrary(PL, 'lawnmower classics');
    expect([env.S.ui.view, env.S.ui.libNode, env.S.vis.hold, env.S.settings.view]).toEqual(['library', PL, true, 'library']);
    expect(env.pf()).toEqual([]);
    const env2 = boot({ loggedIn: true }, { view: 'radio' });
    env2.start();
    expect([env2.S.ui.view, env2.S.vis.hold]).toEqual(['radio', true]);
  });
});

describe('8. devices', () => {
  it('from W.devices and the wmp-spotify-devices event; self is this window', () => {
    const env = boot({ loggedIn: true, devices: [
      { id: ME, name: 'Web Player (Microsoft Edge)', type: 'Computer', active: false, volume: 65535 },
      { id: 'p1', name: 'Pixel', type: 'Smartphone', active: true, volume: 30000 }, null, { name: 'no id' }] });
    env.start();
    expect(env.S.devices.list.map((d) => d.name)).toEqual(['Web Player (Microsoft Edge)', 'Pixel']);
    expect(env.S.devices.self).toBe(ME);
    env.fire('wmp-spotify-devices', [{ id: 'k', name: 'Kitchen', type: 'Speaker', active: true }]);
    expect(env.S.devices.list.map((d) => d.name)).toEqual(['Kitchen']);
    for (const v of ['guide', 'radio', 'search', 'library'] as const) {
      const n = env.calls.length;
      env.S.actions.setView(v);
      expect([env.S.ui.view, env.S.vis.hold, env.S.settings.view]).toEqual([v, true, v]);
      if (v === 'search') expect(env.calls.length).toBe(n);          // the search view fetches nothing by itself
    }
    env.S.actions.setView('devices');                                 // no longer a view
    expect(env.S.ui.view).toBe('now');
  });
});

describe('9. Media Guide from the home sample', () => {
  it('fetchHome: sections, tiles; a tile plays', async () => {
    const env = boot({ loggedIn: true, hashes: { home: FX.home.request.sha256Hash } });
    env.route(/pathfinder/, { status: 200, json: FX.home.response });
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.start();
    await settle();
    expect(env.pf()).toEqual([]);                                     // nothing until the view's query
    const h = await Q.fetchHome();
    const req = env.pf().filter((c) => c.body.operationName === 'home');
    expect(req.length).toBe(1);
    expect(req[0]!.body.variables).toMatchObject({ homeEndUserIntegration: 'INTEGRATION_WEB_PLAYER', sectionItemsLimit: 10 });
    const secs = h.sections;
    expect(h.greeting).toBe('Good afternoon');
    expect(secs[0]!.title).toBe('Good afternoon');                  // the untitled shortcuts row
    expect(secs[1]!.title).toBe('Made For someone');
    const tile = secs[0]!.items[0]!;
    expect(tile.name).toBe('Kings of Leon Radio');
    expect(tile.sub).toBe('With The Black Keys, Pearl Jam, Florence + The Machine and more');
    expect(tile.img).toMatch(/^https:\/\//);
    expect(secs.some((s) => s.title === 'Recents' && /Playlist/.test(s.items[0]!.sub))).toBe(true);
    expect(secs.filter((s) => s.title === 'Made for you').length).toBe(1);   // folded together
    env.C.playItem(tile); await settle();
    expect(env.cmds().pop().context.uri).toBe('spotify:playlist:37i9dQZF1E4oCVQRGUtgSv');
    const artist = secs.flatMap((s) => s.items).find((t) => t.sub === 'Artist');
    if (artist) {
      env.C.playItem(artist); await settle();
      expect(env.cmds().pop().context.uri).toMatch(/^spotify:artist:/);
    }
  });
});

describe('10. repeat, logout, links, pane shortcuts', () => {
  it('repeat cycles Off -> Playlist -> Track -> Off from the state, one atomic set_options each', async () => {
    const ps = clone(FX.playerState);
    ps.options.repeating_context = false; ps.options.repeating_track = false;
    const env = boot({ loggedIn: true, state: ps });
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.start();
    let n = env.cmds().length;
    env.C.cycleRepeat(); await settle();
    expect(JSON.stringify(env.cmds().slice(n))).toBe('[{"endpoint":"set_options","repeating_context":true,"repeating_track":false}]');
    ps.options.repeating_context = true; env.fire('wmp-spotify-state', clone(ps));
    expect(env.S.playback.repeat).toBe('context');
    n = env.cmds().length; env.C.cycleRepeat(); await settle();
    expect(JSON.stringify(env.cmds().slice(n))).toBe('[{"endpoint":"set_options","repeating_context":true,"repeating_track":true}]');
    ps.options.repeating_track = true; env.fire('wmp-spotify-state', clone(ps));
    expect(env.S.playback.repeat).toBe('track');
    n = env.cmds().length; env.C.cycleRepeat(); await settle();
    expect(JSON.stringify(env.cmds().slice(n))).toBe('[{"endpoint":"set_options","repeating_context":false,"repeating_track":false}]');
    n = env.cmds().length; env.C.setRepeat('off'); await settle();
    expect(env.cmds().length).toBe(n);                               // already Off (optimistically, before the state says so)
  });
  it('Log Out only when bound', () => {
    const env = boot({ loggedIn: true });
    env.start();
    expect(env.S.auth.canLogout).toBe(false);
    env.C.logout();
    let out = 0;
    window.alchemySpotifyLogout = () => { out++; };
    const env2 = boot({ loggedIn: true });
    window.alchemySpotifyLogout = () => { out++; };
    env2.start();
    expect(env2.S.auth.canLogout).toBe(true);
    env2.C.logout();
    expect(out).toBe(1);
  });
  it('Open Spotify Link', async () => {
    expect(parseLink('https://open.spotify.com/intl-de/album/4d40uSufPdCDGGedQGCdGn?si=abc')).toBe('spotify:album:4d40uSufPdCDGGedQGCdGn');
    expect(parseLink(' spotify:playlist:37i9dQZF1E4oCVQRGUtgSv ')).toBe('spotify:playlist:37i9dQZF1E4oCVQRGUtgSv');
    expect(parseLink('https://example.com/album/x')).toBeNull();
    const env = boot({ loggedIn: true, state: FX.playerState, hashes: { getTrack: 'g'.repeat(64) } });
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.route(/pathfinder/, (_u, init) => JSON.parse(init.body).operationName === 'getTrack'
      ? { status: 200, json: { data: { trackUnion: { albumOfTrack: { uri: 'spotify:album:AL' } } } } } : { status: 200, json: { data: {} } });
    env.start();
    expect(env.C.openLink('nonsense')).toBe(false);
    expect(env.C.openLink('https://open.spotify.com/track/2EWpa5XnAuSn0sIkSSIhYk')).toBe(true);
    await settle();
    const c = env.cmds().pop();
    expect(c.context.uri + ' ' + c.options.skip_to.track_uri).toBe('spotify:album:AL spotify:track:2EWpa5XnAuSn0sIkSSIhYk');
    env.C.openLink('spotify:artist:5kuJibJcwOC53s3OkoGMRA'); await settle();
    expect(env.cmds().pop().context.uri).toBe('spotify:artist:5kuJibJcwOC53s3OkoGMRA');
  });
  it('album / Playing from / artist select in the Media Library; an artist without a page gets albums by search', async () => {
    const env = boot({ loggedIn: true, state: FX.playerState, hashes: { searchDesktop: 's'.repeat(64), queryArtistDiscographyAll: 'h'.repeat(64) } });
    env.route(/pathfinder/, (_u, init) => JSON.parse(init.body).operationName === 'searchDesktop'
      ? { status: 200, json: { data: { searchV2: { albumsV2: { items: [
        { data: { uri: 'spotify:album:a1', name: 'Men Amongst Mountains', artists: { items: [{ profile: { name: 'The Revivalists' } }] } } },
        { data: { uri: 'spotify:album:a2', name: 'Cover Album', artists: { items: [{ profile: { name: 'Someone Else' } }] } } }] } } } } }
      : { status: 200, json: { data: {} } });
    env.start();
    await settle();
    const n = env.pf().length;
    env.C.openAlbum();
    expect([env.S.ui.view, env.S.ui.libNode]).toEqual(['library', 'spotify:album:4d40uSufPdCDGGedQGCdGn']);
    env.S.actions.setView('now');
    env.C.openFrom();
    expect([env.S.ui.view, env.S.ui.libNode]).toEqual(['library', FX.playerState.context_uri]);
    env.S.actions.setView('now');
    env.C.openArtist();
    const AR = 'spotify:artist:5kuJibJcwOC53s3OkoGMRA';
    expect([env.S.ui.view, env.S.ui.libNode]).toEqual(['library', AR]);
    expect(env.pf().length).toBe(n);                                   // selection only
    // its page: no overview (answers nothing), so the albums come from a search for the name
    const a = await Q.fetchArtist(AR);
    expect(a).toMatchObject({ meta: { kind: 'artist', name: 'The Revivalists', total: 0 }, tracks: [],
      albums: [{ uri: 'spotify:album:a1', name: 'Men Amongst Mountains', artist: 'The Revivalists' }] });
    expect(env.S.ui.status).toMatch(/artist page unavailable/);
  });
});

describe('11. Radio Tuner (seed_to_playlist) and Play on Device (transfer)', () => {
  it('stations, each seed once; transfer', async () => {
    const ps = clone(FX.playerState);
    ps.track.uri = 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK';
    ps.track.metadata.artist_uri = 'spotify:artist:7t0rwkOPGlDPEhaOcVtOt9';
    const me = FX.devices[3].id;
    const env = boot({ loggedIn: true, state: ps, hashes: { home: FX.home.request.sha256Hash }, deviceId: me, activeDeviceId: me, devices: FX.devices });
    env.route(/pathfinder/, { status: 200, json: FX.home.response });
    env.route(/seed_to_playlist\/spotify:track:/, { status: 200, json: FX.seedTrack.body });
    env.route(/seed_to_playlist\/spotify:artist:7t0/, { status: 200, json: FX.seedArtist.body });
    env.route(/seed_to_playlist\/spotify:artist:(?!7t0)/, (u) => ({ status: 200, json: { total: 1, mediaItems: [{ uri: 'spotify:playlist:R' + u.split(':').pop()!.slice(0, 4) }] } }));
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.route(/connect\/transfer/, { status: 200, json: { ack_id: 't' } });
    env.start();
    await settle();
    const rs = Q.radioSeeds();
    expect(rs.map((x) => x.name)).toEqual(['Wish I Knew You Radio', 'The Revivalists Radio']);
    expect(Q.keys.radio(rs.map((x) => x.seed))).toEqual(['spotify', 'radio', 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK', 'spotify:artist:7t0rwkOPGlDPEhaOcVtOt9']);
    const st = await Q.fetchRadio(rs);
    const seeds = env.calls.filter((c) => /seed_to_playlist/.test(c.url));
    expect(seeds[0]!.url).toBe(FX.seedTrack.url);
    expect(seeds[0]!.method).toBe('GET');
    expect(seeds[0]!.body === undefined && seeds[0]!.headers.Authorization === 'Bearer TOK').toBe(true);
    expect(seeds[1]!.url).toBe(FX.seedArtist.url);
    expect(st[0]!.name).toBe('Wish I Knew You Radio');
    expect(st[0]!.uri).toBe(FX.seedTrack.body.mediaItems[0].uri);
    expect(st[1]!.name).toBe('The Revivalists Radio');
    expect(st.some((s) => s.name === 'Daft Punk Radio')).toBe(true);
    expect(new Set(st.map((s) => s.uri)).size).toBe(st.length);
    env.C.playContext(st[0]!.uri); await settle();
    expect(env.cmds().pop().context.uri).toBe(FX.seedTrack.body.mediaItems[0].uri);
    const n = seeds.length;
    await Q.fetchRadio(rs);
    expect(env.calls.filter((c) => /seed_to_playlist/.test(c.url)).length).toBe(n);    // each seed once

    expect(env.S.devices.list.map((d) => [!!d.offline, !!d.active])).toEqual([[true, false], [false, false], [true, false], [false, true]]);
    expect(env.S.devices.self).toBe(me);
    await env.C.transfer(FX.devices[1].id);
    const t = env.calls.filter((c) => /transfer/.test(c.url)).pop()!;
    expect(t.url).toBe('https://gue1-spclient.spotify.com/connect-state/v1/connect/transfer/from/' + me + '/to/' + FX.devices[1].id);
    expect(JSON.stringify(t.body)).toBe('{"transfer_options":{"restore_paused":"restore"}}');
    expect(t.method).toBe('POST');
    expect(env.S.ui.status).toBe('Moving playback…');
  });
});

describe('12. details pane metadata and row fields', () => {
  const ALBUM = 'spotify:album:4d40uSufPdCDGGedQGCdGn';
  function setup() {
    const env = boot({ loggedIn: false, hashes: FX.hashes });
    pathfinderFixtures(env);
    env.start();
    return env;
  }
  it('playlist: meta from fetchPlaylist, rows with playcount / cover / album / artists / numbers', async () => {
    setup();
    const c = await Q.fetchCollectionPage(PL);
    expect(c.meta).toEqual({
      kind: 'playlist', name: 'lawnmower classics',
      image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da8450fa2f36e1698624683a85a6',
      owner: { name: 'someone', uri: 'spotify:user:00000000000000000000000000', avatar: 'https://i.scdn.co/image/ab6775700000ee8500000000000000000000000' },
      description: 'Mowing music & more', followers: 0, following: true, total: 123,
      shareUrl: 'https://open.spotify.com/playlist/2awChHWKKqe1TgwxBtUp4E?si=0000000000000000000000', format: '',
    });
    expect(c.tracks[0]).toEqual({
      uri: 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK', title: 'Linger', artist: 'The Cranberries',
      album: 'Everybody Else Is Doing It, So Why Can\'t We?', duration: 274706, ctx: PL,
      playcount: 1476105414, explicit: false, image: 'https://i.scdn.co/image/ab67616d00004851f6325f361d7803ad0d908451',
      albumUri: 'spotify:album:0AP5O47kJWlaKVnnybKvQI', artistUris: ['spotify:artist:7t0rwkOPGlDPEhaOcVtOt9'],
      releaseDate: '1993-03-01', trackNumber: 7, discNumber: 1, uid: '09ae1581344b553f',
    });
    expect(totalMs(c.tracks)).toBe(c.tracks.reduce((a, t) => a + t.duration, 0));
  });
  it('album: meta from getAlbum, rows carry the album\'s cover, uri and date', async () => {
    const env = setup();
    const c = await Q.fetchCollectionPage(ALBUM);
    expect(env.pf().pop()!.body.operationName).toBe('getAlbum');
    expect(c.meta).toEqual({
      kind: 'album', name: 'Men Amongst Mountains', image: 'https://i.scdn.co/image/ab67616d0000b273c5214ee5d4300598a8a95264',
      artists: [{ name: 'The Revivalists', uri: 'spotify:artist:5kuJibJcwOC53s3OkoGMRA' }], releaseDate: '2015-07-15',
      label: 'Concord Records', copyright: '© 2015 Wind-up Records\n℗ 2015 Wind-up Records', saved: false, total: 14,
      shareUrl: 'https://open.spotify.com/album/4d40uSufPdCDGGedQGCdGn?si=0000000000000000000000', format: 'ALBUM',
    });
    expect([c.total, c.nextOffset]).toEqual([14, 3]);
    expect(await Q.fetchAlbumMeta(ALBUM)).toEqual(c.meta);
    expect(c.tracks[1]).toMatchObject({
      title: 'Wish I Knew You', album: 'Men Amongst Mountains', albumUri: ALBUM, ctx: ALBUM, playcount: 307026068,
      explicit: false, image: 'https://i.scdn.co/image/ab67616d00004851c5214ee5d4300598a8a95264', releaseDate: '2015-07-15',
      trackNumber: 2, discNumber: 1, artistUris: ['spotify:artist:5kuJibJcwOC53s3OkoGMRA'], duration: 274093,
    });
  });
  it('Liked Songs: total from fetchLibraryTracks, image from the libraryV3 pseudo-playlist; list covers', async () => {
    const env = setup();
    expect((await Q.fetchCollectionPage(LIKED)).meta).toEqual({ kind: 'liked', name: 'Liked Songs', total: 1814 });
    const list = await Q.fetchLibraryList();                          // remembers the pseudo-playlist's cover
    const c = await Q.fetchCollectionPage(LIKED);
    expect(env.pf().filter((x) => x.body.operationName === 'fetchLibraryTracks').length).toBe(2);
    expect(c.meta).toEqual({ kind: 'liked', name: 'Liked Songs', total: 1814, image: 'https://misc.scdn.co/liked-songs/liked-songs-640.png' });
    const t = c.tracks[0]!;
    expect(t).toMatchObject({ title: 'Brokenhearted', albumUri: 'spotify:album:7FbPwQGriWa8IT4u6RxjWK', trackNumber: 2, discNumber: 1,
                              image: 'https://i.scdn.co/image/ab67616d00004851cc50268bd94de0934dad0ca0', explicit: false });
    expect('playcount' in t).toBe(false);                            // liked items carry none
    // library list items: covers for the Tiles mode
    expect(list[0]).toEqual({ uri: PL, name: 'lawnmower classics', editable: true,
      image: 'https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da8450fa2f36e1698624683a85a6' });
  });
  it('search rows and contexts carry covers', async () => {
    const env = boot({ loggedIn: false, hashes: { searchDesktop: 'f'.repeat(64) } });
    env.route(/pathfinder/, { status: 200, json: FX.searchDesktop.response });
    env.start();
    const s = await Q.fetchSearch('queen', 'all');
    expect(s.tracks.items[0]).toMatchObject({ title: 'Bohemian Rhapsody', albumUri: 'spotify:album:1TkbyIkf6GSrO5e7gWS4AM',
      image: 'https://i.scdn.co/image/ab67616d00004851fdab4a163ab9f6db72c952ee', artistUris: ['spotify:artist:1dfeR4HaWDbWqFHLkxsg1d'] });
    expect(s.albums.items[0]!.image).toBe('https://i.scdn.co/image/ab67616d00001e021f1752e1af3db7677f1bc948');   // the 300 px one
    expect(s.playlists.items[0]!.image).toMatch(/^https:\/\/pickasso/);
  });
});

describe('13. artist collections and typed search against spike 4\'s captured pages', () => {
  const AR = 'spotify:artist:1dfeR4HaWDbWqFHLkxsg1d';
  const S4 = FX.spike4;
  function setup(W: Record<string, unknown> = {}) {
    const env = boot({ loggedIn: false, state: FX.playerState, ...W });
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body), cap = S4[b.operationName];
      return { status: 200, json: cap ? clone(cap.response) : { data: {} } };
    });
    env.route(/player\/command/, { status: 200, json: { ack_id: 'x' } });
    env.start();
    return env;
  }
  it('overview + discography: the variables and hashes the page sends; meta, top tracks, albums', async () => {
    const env = setup();
    const c = await Q.fetchArtist(AR);
    expect(env.pushed).toEqual([]);                                   // the discography hash is baked: no route visit
    const ov = env.pf().find((c) => c.body.operationName === 'queryArtistOverview')!;
    expect(ov.body.variables).toEqual(S4.queryArtistOverview.request.variables);
    expect(ov.body.extensions.persistedQuery.sha256Hash).toBe(S4.queryArtistOverview.request.extensions.persistedQuery.sha256Hash);
    const dg = env.pf().find((c) => c.body.operationName === 'queryArtistDiscographyAll')!;
    expect(dg.body.extensions.persistedQuery.sha256Hash).toBe('5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599');
    expect(dg.body.variables).toMatchObject({ uri: AR, offset: 0, order: 'DATE_DESC' });
    expect(c.meta).toMatchObject({ kind: 'artist', name: 'Queen', total: 3, followers: 58_588_896, saved: false,
      image: 'https://i.scdn.co/image/ab6761610000e5eb73e4d22612ac8d944b5789b4',
      shareUrl: 'https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d?si=0000000000000000000000' });
    expect(c.meta.description).toMatch(/^Queen epitomize all the glittery excess/);
    expect(c.meta.description).not.toMatch(/<a /);
    // top tracks: albumOfTrack has no name, so the album comes from the discography by uri; one
    // getAlbum per still-unnamed album (none answers here), else the field is left out
    expect(c.tracks.map((t) => [t.title, t.album, t.albumUri, t.ctx])).toEqual([
      ['Don\'t Stop Me Now', undefined, 'spotify:album:1yzF0wUwJFgtkkXmKNe5BE', AR],
      ['Bohemian Rhapsody', 'A Night At The Opera', 'spotify:album:1TkbyIkf6GSrO5e7gWS4AM', AR],
      ['Under Pressure (feat. David Bowie)', 'Hot Space', 'spotify:album:4pFJdTvK6zNyWOO3W1hkGd', AR]]);
    expect(c.tracks[0]).toMatchObject({ playcount: 2_776_249_382, explicit: false, discNumber: 1, duration: 209_413,
      image: 'https://i.scdn.co/image/ab67616d00001e026c03b757ece416e014feef5e' });   // unsized sources: the first
    // the whole discography (artistUnion.discography.all.items[].releases.items[])
    expect(c.albums).toEqual([
      { uri: 'spotify:album:1BGiS3fcRGNi1Fw68WCC2W', name: 'Tie Your Mother Down (Live in Budapest)', total: 1, image: expect.stringMatching(/ab67616d00001e02/) as unknown },
      { uri: 'spotify:album:1phOF1iJfhjm64XX3P6Vny', name: 'Who Wants to Live Forever (Live in Budapest)', total: 1, image: expect.any(String) as unknown },
      { uri: 'spotify:album:2i3G9uRIMioVziTJ4T5fxI', name: 'Radio Ga Ga (Live in Budapest)', total: 1, image: expect.any(String) as unknown }]);
    env.C.playAll(AR); await settle();                                 // the remembered top tracks
    const p = env.cmds().pop();
    expect([p.context.uri, p.options.skip_to.track_uri]).toEqual([AR, 'spotify:track:1NHWG8zxSEypSRF3UufrnO']);
    const pg = await Q.fetchCollectionPage(AR);                        // an artist uri reads as its top tracks
    expect([pg.meta!.kind, pg.tracks.length, pg.total, pg.nextOffset]).toEqual(['artist', 3, 3, undefined]);
  });
  it('without the discography op the overview teaser is the album list', async () => {
    const env = setup();
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      return b.operationName === 'queryArtistOverview' ? { status: 200, json: clone(S4.queryArtistOverview.response) } : { status: 500 };
    });
    const al = (await Q.fetchArtist(AR)).albums;
    expect(al.slice(0, 4).map((a) => a.name)).toEqual(['The Game', 'A Night At The Opera', 'Hot Space', 'Queen II (2026 Mix)']);
    expect(al.length).toBe(12);                                       // popular 3 + albums 3 + singles 3 + compilations 3
    // NOTE queryArtistDiscographyAlbums: spike 4 got 200 but did not capture its inner key; read as disc.all || disc.albums.
  });
  it('release dates in both shapes', () => {
    expect(dateOf({ day: 27, month: 6, precision: 'DAY', year: 1980 })).toBe('1980-06-27');
    expect(dateOf({ isoString: '2026-09-10T00:00:00Z', precision: 'DAY', year: 2026 })).toBe('2026-09-10');
    expect(dateOf({ isoString: '1975-11-21T00:00:00Z', precision: 'YEAR' })).toBe('1975');
    expect(dateOf({ year: 2009 })).toBe('2009');
    expect(dateOf({ year: 2009, month: 3, precision: 'MONTH' })).toBe('2009-03');
  });
  it('a route is visited only for ops with no hash anywhere', async () => {
    const env = setup();
    const sp = newSp(env.store);
    await visitRoute(sp, '/artist/x', ['queryArtistDiscographyAll']);
    expect(env.pushed).toEqual([]);
    const v = visitRoute(sp, '/artist/x', ['noSuchOp']);
    await settle();
    expect(env.pushed).toEqual(['/artist/x']);
    await vi.advanceTimersByTimeAsync(1500);
    await v;
    await visitRoute(sp, '/artist/y', ['noSuchOp']);
    expect(env.pushed.length).toBe(1);                                // once per route kind
  });
  it('typed searches send the page\'s variables and read its buckets', async () => {
    const env = setup();
    for (const [type, op, key, total] of [['artists', 'searchArtists', 'artists', 121], ['albums', 'searchAlbums', 'albumsV2', 135],
                                          ['playlists', 'searchPlaylists', 'playlists', 109], ['tracks', 'searchTracks', 'tracksV2', 728]] as const) {
      const b = await Q.fetchSearch('queen', type);
      const q = env.pf().pop()!;
      expect(q.body.operationName).toBe(op);
      expect(q.body.variables).toEqual(S4[op].request.variables);
      expect([b.items.length, b.total, b.offset, b.exact, b.hasMore]).toEqual([S4[op].response.data.searchV2[key].items.length, total, 0, false, true]);   // more pages: not exact yet
      // pagingInfo.nextOffset (30 / 20), not the 3 items the trimmed sample holds
      expect(b.nextOffset).toBe(S4[op].response.data.searchV2[key].pagingInfo.nextOffset);
      if (type === 'artists') expect(b.items[0]).toMatchObject({ uri: AR, name: 'Queen', kind: 'artist' });
      if (type === 'playlists') expect(b.items.every((p) => (p as { image?: string }).image)).toBe(true);
    }
    await Q.fetchSearch('queen', 'artists', 30);
    expect(env.pf().pop()!.body.variables).toMatchObject({ offset: 30, limit: 30 });
  });
  it('the full search sends what the page sends', async () => {
    const env = setup({ hashes: { searchDesktop: 'f'.repeat(64) } });
    await Q.fetchSearch('queen', 'all');
    expect(env.pf().pop()!.body.variables).toEqual({ searchTerm: 'queen', offset: 0, limit: 10, numberOfTopResults: 5,
      includeAudiobooks: true, includeArtistHasConcertsField: false, includePreReleases: true, includeAlbumPreReleases: false,
      includeAuthors: false, includeEpisodeContentRatingsV2: true, isPrefix: null, sectionFilters: ['GENERIC'] });
  });
  it('openArtist: the playing artist when no uri; selecting fetches nothing', async () => {
    const env = setup();
    await settle();
    const n = env.pf().length;
    env.C.openArtist();
    expect(env.S.ui.libNode).toBe('spotify:artist:5kuJibJcwOC53s3OkoGMRA');
    env.C.openArtist(AR);
    for (const node of ['playlists', 'albums', 'search', 'spotify:artist:zz']) { env.S.actions.setUi({ libNode: node }); await settle(); }
    expect(env.pf().length).toBe(n);
  });
});

describe('14. live findings: artist names, top-track albums, search totals', () => {
  const AR = 'spotify:artist:1dfeR4HaWDbWqFHLkxsg1d';
  const S4 = FX.spike4;
  const DSMN = 'spotify:track:1NHWG8zxSEypSRF3UufrnO', JAZZ = 'spotify:album:1yzF0wUwJFgtkkXmKNe5BE';
  function artistState(md: Record<string, string>) {
    const ps = clone(FX.playerState);
    ps.context_uri = AR;
    ps.track = { uri: DSMN, metadata: { title: 'Don\'t Stop Me Now', artist_uri: AR, ...md } };
    return ps;
  }
  function setup(W: Record<string, unknown>, getAlbum?: (uri: string) => unknown) {
    const env = boot({ loggedIn: false, ...W });
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      if (b.operationName === 'getAlbum' && getAlbum) return { status: 200, json: getAlbum(b.variables.uri) };
      const cap = S4[b.operationName];
      return { status: 200, json: cap ? clone(cap.response) : { data: {} } };
    });
    env.start();
    return env;
  }
  const album = (uri: string, name: string) => {
    const a = clone(FX.getAlbum.response);
    a.data.albumUnion.uri = uri; a.data.albumUnion.name = name;
    return a;
  };
  it('an artist-context play without artist_name is named from the artist once known', async () => {
    const env = setup({ state: artistState({}) });
    expect(env.S.playback.track!.artist).toBe('');
    expect(env.S.ui.status).toBe('Playing: Don\'t Stop Me Now');
    await Q.fetchArtist(AR);
    expect(env.S.playback.track!.artist).toBe('Queen');
    expect(env.S.ui.status).toBe('Playing: Queen – Don\'t Stop Me Now');
  });
  it('a playlist play without artist_name takes the artist from the loaded row; Up Next too', async () => {
    const ps = clone(FX.playerState);
    const row = FX.fetchPlaylist.response.data.playlistV2.content.items[1].itemV2.data;
    ps.context_uri = PL;
    ps.track = { uri: row.uri, metadata: { title: row.name } };
    ps.next_tracks = [{ uri: FX.fetchPlaylist.response.data.playlistV2.content.items[2].itemV2.data.uri, metadata: { title: 'Black' } }];
    const env = boot({ loggedIn: false, hashes: FX.hashes, state: ps });
    pathfinderFixtures(env);
    env.start();
    await settle();
    expect(env.S.playback.track!.artist).toBe('Creed');
    expect(env.S.queue.next.map(trackLabel)).toEqual(['Black – Pearl Jam']);
  });
  it('top tracks: the playing track names its album; one cached getAlbum per missing album, at most 5', async () => {
    const env = setup({ state: artistState({ album_title: 'Jazz' }) }, (u) => album(u, 'Album ' + u.slice(-4)));
    const t = (await Q.fetchArtist(AR)).tracks;
    expect(t[0]!.album).toBe('Jazz');                                   // from the player, no lookup
    expect(env.pf().filter((c) => c.body.operationName === 'getAlbum').length).toBe(0);
    // not playing: looked up once, then cached in byUri
    const env2 = setup({}, (u) => album(u, u === JAZZ ? 'Jazz' : 'x'));
    expect((await Q.fetchArtist(AR)).tracks[0]!.album).toBe('Jazz');
    const ga = env2.pf().filter((c) => c.body.operationName === 'getAlbum');
    expect(ga.map((c) => c.body.variables.uri)).toEqual([JAZZ]);
    await Q.fetchArtist(AR);                                            // the name is cached now
    expect(env2.pf().filter((c) => c.body.operationName === 'getAlbum').length).toBe(1);
    // the cap: seven top tracks on seven unknown albums -> five lookups, two rows left without an album
    const ov = clone(S4.queryArtistOverview.response);
    const tt = ov.data.artistUnion.discography.topTracks.items;
    ov.data.artistUnion.discography.topTracks.items = Array.from({ length: 7 }, (_x, i) => {
      const x = clone(tt[0]); x.track.uri = 'spotify:track:x' + i; x.track.albumOfTrack.uri = 'spotify:album:u' + i; return x;
    });
    const env3 = setup({}, (u) => album(u, 'A' + u.slice(-1)));
    env3.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      if (b.operationName === 'queryArtistOverview') return { status: 200, json: ov };
      if (b.operationName === 'getAlbum') return { status: 200, json: album(b.variables.uri, 'A' + String(b.variables.uri).slice(-1)) };
      return { status: 200, json: { data: {} } };
    });
    const rows = (await Q.fetchArtist(AR)).tracks;
    expect(env3.pf().filter((c) => c.body.operationName === 'getAlbum').length).toBe(5);
    expect(rows.map((r) => r.album)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', undefined, undefined]);
    expect('album' in rows[6]!).toBe(false);                            // left out, not ''
  });
  it('search totals: the full search\'s are lower bounds, a typed page\'s are exact', async () => {
    const env = setup({ hashes: { searchDesktop: 'f'.repeat(64) } });
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      return { status: 200, json: b.operationName === 'searchDesktop' ? FX.searchDesktop.response : clone(S4[b.operationName].response) };
    });
    const all = await Q.fetchSearch('queen', 'all');
    expect(all.tracks).toMatchObject({ total: 18, exact: false, hasMore: true, nextOffset: 2 });   // show "18+"
    expect(await Q.fetchSearch('queen', 'tracks', all.tracks.nextOffset)).toMatchObject({ total: 728, exact: false, hasMore: true, offset: 2 });
    expect(await Q.fetchSearch('queen', 'artists')).toMatchObject({ total: 121, exact: false, hasMore: true });
  });
});

describe('15. the slider and mute follow the device volume', () => {
  const ACT = FX.activeDeviceId;
  const dev = (volume: number) => [{ id: ACT, name: 'Pixel', type: 'Smartphone', active: true, volume }];
  function setup(volume = 32768) {
    const env = boot({ loggedIn: true, state: FX.playerState, devices: dev(volume) }, { volume: 30 });
    env.route(/connect\/volume/, { status: 200, json: {} });
    env.start();
    return env;
  }
  const puts = (env: ReturnType<typeof setup>) => env.calls.filter((c) => /connect\/volume/.test(c.url)).map((c) => c.body.volume as number);
  it('at launch the device volume is the slider, and nothing is sent back', async () => {
    const env = setup(32768);
    await settle();
    expect([env.S.settings.volume, env.S.settings.muted]).toEqual([50, false]);
    expect(puts(env)).toEqual([]);
  });
  it('an external change moves the slider; our own echo within 1.5 s does not', async () => {
    const env = setup();
    env.fire('wmp-spotify-devices', dev(13107));                     // another client set 20%
    expect(env.S.settings.volume).toBe(20);
    expect(puts(env)).toEqual([]);
    env.S.actions.setVolume(70); await settle();
    expect(puts(env)).toEqual([45875]);
    env.fire('wmp-spotify-devices', dev(45875));                     // the echo
    env.S.actions.setVolume(72); await settle();                     // dragging on
    env.fire('wmp-spotify-devices', dev(45875));                     // a late echo of the previous PUT
    expect(env.S.settings.volume).toBe(72);
    vi.setSystemTime(T0 + 2000);
    env.fire('wmp-spotify-devices', dev(45875));                     // not an echo any more: a real change
    expect(env.S.settings.volume).toBe(70);
    expect(puts(env)).toEqual([45875, 47185]);
  });
  it('device 0 = muted with the level kept; a level while muted unmutes', () => {
    const env = setup();
    env.fire('wmp-spotify-devices', dev(0));
    expect([env.S.settings.volume, env.S.settings.muted]).toEqual([50, true]);
    env.fire('wmp-spotify-devices', dev(26214));
    expect([env.S.settings.volume, env.S.settings.muted]).toEqual([40, false]);
    expect(puts(env)).toEqual([]);
  });
  it('mute PUTs 0, unmute restores the level; dragging while muted unmutes at the new level', async () => {
    const env = setup();
    env.S.actions.setVolume(null, true); await settle();
    env.S.actions.setVolume(null, false); await settle();
    expect(puts(env)).toEqual([0, 32768]);
    expect([env.S.settings.volume, env.S.settings.muted]).toEqual([50, false]);
    env.S.actions.setVolume(null, true); await settle();
    env.S.actions.setVolume(30); await settle();
    expect([env.S.settings.volume, env.S.settings.muted]).toEqual([30, false]);
    expect(puts(env).slice(-2)).toEqual([0, 19661]);
  });
});

describe('16. optimistic transport', () => {
  function setup(reply: object | (() => unknown) = { status: 200, json: { ack_id: 'a' } }, W: Record<string, unknown> = {}) {
    const env = boot({ loggedIn: true, state: FX.playerState, ...W });
    env.route(/player\/command|connect\/transfer/, reply as never);
    env.start();
    return env;
  }
  const gated = () => {
    let release!: () => void;
    const delay = new Promise<void>((r) => { release = r; });
    return { reply: { status: 200, json: { ack_id: 'g' }, delay }, release };
  };
  it('pause shows at once, the clock stops, pending until the state confirms', async () => {
    const g = gated(), env = setup(g.reply);
    const at = positionNow(env.S);
    void env.C.pause();
    expect([env.S.playback.status, env.S.playback.paused]).toEqual(['paused', true]);
    expect(env.S.playback.pending!.fields).toEqual(['status', 'paused', 'position', 'at']);
    vi.setSystemTime(T0 + 3000);
    expect(positionNow(env.S)).toBe(at);                               // no extrapolation while paused
    g.release(); await settle();
    expect(env.S.playback.pending).not.toBeNull();                     // took it, the state has not come yet
    env.fire('wmp-spotify-state', { ...clone(FX.playerState), is_paused: true });
    expect(env.S.playback.pending).toBeNull();
    expect(env.S.playback.status).toBe('paused');
  });
  it('the state wins over the optimistic value', async () => {
    const g = gated(), env = setup(g.reply);
    void env.C.pause();
    env.fire('wmp-spotify-state', clone(FX.playerState));             // still playing, says Spotify
    expect([env.S.playback.status, env.S.playback.pending]).toEqual(['playing', null]);
    g.release(); await settle();
    expect(env.S.playback.status).toBe('playing');
  });
  it('a refusal or a network error rolls back and says why', async () => {
    const env = setup({ status: 403, json: { error: { message: 'Premium required' } } });
    const done = env.C.pause();
    expect(env.S.playback.status).toBe('paused');
    await done;
    expect([env.S.playback.status, env.S.playback.paused, env.S.playback.pending]).toEqual(['playing', false, null]);
    expect(env.S.ui.status).toMatch(/Premium required/);
    const env2 = setup(() => new Error('offline'));
    await settle();                                                    // the library loads first
    env2.C.toggleShuffle(); await settle();
    expect([env2.S.playback.shuffle, env2.S.playback.pending]).toEqual([true, null]);
    expect(env2.S.ui.status).toMatch(/offline/);
  });
  it('no state within 2 s: pending clears, the optimistic value stays', async () => {
    const env = setup();
    env.C.cycleRepeat(); await settle();                               // sample: repeating_context -> Track
    expect(env.S.playback.repeat).toBe('track');
    expect(env.S.playback.pending!.fields).toEqual(['repeat']);
    await vi.advanceTimersByTimeAsync(2000);
    expect([env.S.playback.repeat, env.S.playback.pending]).toEqual(['track', null]);
  });
  it('next / prev: playing from 0 at once; seek: the position at once', async () => {
    const g = gated(), env = setup(g.reply);
    void env.C.pause(); g.release(); await settle();
    void env.C.next();
    expect([env.S.playback.status, env.S.playback.position, env.S.playback.at]).toEqual(['playing', 0, T0]);
    void env.C.seek(90_000);
    expect(env.S.playback.position).toBe(90_000);
    expect(env.S.playback.pending!.fields).toEqual(['position', 'at']);
    vi.setSystemTime(T0 + 1000);
    expect(positionNow(env.S)).toBe(91_000);
  });
  it('shuffle and repeat show at once', () => {
    const env = setup(gated().reply);
    env.C.toggleShuffle();
    env.C.setRepeat('off');
    expect([env.S.playback.shuffle, env.S.playback.repeat]).toEqual([false, 'off']);
  });
  it('transfer lights the target at once; a refusal puts the old device back', async () => {
    const devices = [{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: false }];
    const env = setup({ status: 500 }, { devices });
    const done = env.C.transfer('b');
    expect(env.S.devices.list.map((d) => !!d.active)).toEqual([false, true]);
    expect(env.S.playback.pending!.fields).toEqual(['device']);
    await done;
    expect(env.S.devices.list.map((d) => !!d.active)).toEqual([true, false]);
    expect(env.S.ui.status).toMatch(/could not move playback \(500\)/);
  });
});

describe('17. transfer never starts playback that was not playing', () => {
  async function body(W: Record<string, unknown>, paused = false) {
    const ps = { ...clone(FX.playerState), is_paused: paused };
    const env = boot({ loggedIn: true, state: ps, ...W });
    env.route(/connect\/transfer/, { status: 200, json: {} });
    env.start();
    await env.C.transfer('echo');
    return env.calls.filter((c) => /transfer/.test(c.url)).pop()!.body.transfer_options.restore_paused as string;
  }
  it('idle session (no active device, stale is_paused:false) -> pause', async () => {
    expect(await body({ activeDeviceId: '' })).toBe('pause');
  });
  it('paused -> pause; playing -> restore', async () => {
    expect(await body({}, true)).toBe('pause');
    expect(await body({})).toBe('restore');
  });
});

describe('18. query functions: keys, errors, retry policy, the enrichment cache', () => {
  it('stable keys', () => {
    expect(Q.keys.collection(PL)).toEqual(['spotify', 'collection', PL]);
    expect(Q.keys.collectionPage(PL, 100)).toEqual(['spotify', 'collection', PL, 100]);
    expect(Q.keys.search(' queen ', 'tracks', 20)).toEqual(Q.keys.search('queen', 'tracks', 20));
    expect(Q.keys.home()).toEqual(['spotify', 'home']);
    expect(Q.keys.artist('spotify:artist:a')).toEqual(['spotify', 'artist', 'spotify:artist:a']);
    expect(Q.keys.album('spotify:album:a')).toEqual(['spotify', 'album', 'spotify:album:a']);
  });
  it('429 throws RateLimitError carrying Retry-After; the gate keeps later calls from the network', async () => {
    const env = boot({ loggedIn: false, hashes: FX.hashes });
    env.route(/pathfinder/, { status: 429, headers: { 'Retry-After': 7 } });
    env.start();
    const e = await Q.fetchCollectionPage(PL).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(7000);
    const n = env.calls.length;
    vi.setSystemTime(T0 + 3000);
    const e2 = await Q.fetchHome().catch((x: unknown) => x);
    expect((e2 as RateLimitError).retryAfterMs).toBe(4000);           // what is left of the wait
    expect(env.calls.length).toBe(n);
    // the QueryClient's policy honours it; a missing hash is not retried; others once
    expect([Q.retryPolicy.retry(0, e), Q.retryPolicy.retry(2, e), Q.retryPolicy.retry(3, e)]).toEqual([true, true, false]);
    expect(Q.retryPolicy.retryDelay(0, e)).toBe(7000);
    expect(Q.retryPolicy.retry(0, new QueryError('x', 0))).toBe(false);
    expect([Q.retryPolicy.retry(0, new QueryError('x', 500)), Q.retryPolicy.retry(1, new QueryError('x', 500))]).toEqual([true, false]);
    expect(Q.retryPolicy.retryDelay(1, new QueryError('x', 500))).toBe(2000);
  });
  it('a failed query throws QueryError with its op and status', async () => {
    const env = boot({ loggedIn: false, hashes: FX.hashes });
    env.route(/pathfinder/, { status: 500 });
    env.start();
    await expect(Q.fetchLibraryList()).rejects.toMatchObject({ name: 'QueryError', op: 'libraryV3', status: 500 });
  });
  it('remember: rows the UI got elsewhere name the queue and the playing track', () => {
    const ps = clone(FX.playerState);
    ps.track.metadata = { title: 'Wish I Knew You' };                  // no artist_name
    ps.next_tracks = [{ uri: 'spotify:track:q1' }, { uri: 'spotify:track:q2' }];
    const env = boot({ loggedIn: true, state: ps });
    env.start();
    expect(env.S.queue.next).toEqual([]);
    Q.remember([{ uri: 'spotify:track:q2', title: 'Q2', artist: 'B', duration: 1 }]);
    Q.remember([{ uri: ps.track.uri, title: 'Wish I Knew You', artist: 'The Revivalists', duration: 1 }]);
    env.fire('wmp-spotify-state', clone(ps));
    expect(env.S.queue.next.map(trackLabel)).toEqual(['Q2 – B']);
    expect(env.S.playback.track!.artist).toBe('The Revivalists');
  });
  it('the playing context is fetched once, quietly, to name "Playing from" and Up Next', async () => {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.route(/pathfinder/, { status: 500 });
    env.start();
    await settle();
    expect(env.pf().filter((c) => c.body.operationName === 'fetchPlaylist').length).toBe(1);
    expect(env.S.ui.status).toBe('Playing: The Revivalists – Wish I Knew You');   // a background failure says nothing
  });
});

describe('19. the local engine\'s query surface is empty', () => {
  it('same names, nothing fetched', async () => {
    const L = await import('../../src/adapters/local/queries');
    expect(L.keys.collection('x')).toEqual(['local', 'collection', 'x']);
    expect(await L.fetchLibraryList()).toEqual([]);
    expect(await L.fetchCollectionPage()).toEqual({ tracks: [], total: 0 });
    expect(await L.fetchSearch('q', 'all')).toMatchObject({ tracks: { items: [], hasMore: false } });
    expect(await L.fetchSearch('q', 'tracks')).toMatchObject({ items: [], hasMore: false });
    expect(await L.fetchHome()).toEqual({ greeting: '', sections: [] });
    expect(await L.fetchRadio()).toEqual([]);
    expect(L.retryPolicy.retry()).toBe(false);
    const { getQueries } = await import('../../src/adapters');
    window.alchemyEngine = 'local';
    expect(getQueries().keys.home()).toEqual(['local', 'home']);
    window.alchemyEngine = 'spotify';
    expect(getQueries().keys.home()).toEqual(['spotify', 'home']);
  });
});

describe('20. typed-search totals grow while paging', () => {
  it('18 -> 36 -> 46: total is the latest count, exact only on the last page', async () => {
    const env = boot({ loggedIn: false, hashes: { searchDesktop: 'f'.repeat(64) } });
    const pages: Record<number, [number, number | null]> = { 0: [18, 20], 20: [36, 40], 40: [46, null] };   // [totalCount, nextOffset]
    env.route(/pathfinder/, (_u, init) => {
      const v = JSON.parse(init.body).variables, [total, next] = pages[v.offset as number]!;
      const n = Math.min(20, 46 - v.offset);
      return { status: 200, json: { data: { searchV2: { tracksV2: { totalCount: total, pagingInfo: { limit: 20, nextOffset: next },
        items: Array.from({ length: n }, (_x, i) => ({ item: { data: { uri: 'spotify:track:t' + (v.offset + i), name: 'T', artists: { items: [] } } } })) } } } } };
    });
    env.start();
    const a = await Q.fetchSearch('queen', 'tracks');
    expect([a.total, a.exact, a.hasMore, a.nextOffset]).toEqual([20, false, true, 20]);   // 18 reported, 20 already held
    const b = await Q.fetchSearch('queen', 'tracks', 20);
    expect([b.total, b.exact, b.hasMore, b.nextOffset]).toEqual([40, false, true, 40]);
    const c = await Q.fetchSearch('queen', 'tracks', 40);
    expect([c.total, c.exact, c.hasMore, c.nextOffset]).toEqual([46, true, false, undefined]);
  });
});

describe('21. Spotify lyrics first, LRCLIB as the fallback (synthetic responses; shape unverified)', () => {
  const TR = FX.playerState.track.uri as string, ID = TR.split(':')[2]!;
  const IMG = 'https://i.scdn.co/image/ab67616d0000b273c5214ee5d4300598a8a95264';
  const line = (t: number, words: string, syllables?: object[]) => ({ startTimeMs: String(t), words, endTimeMs: '0', ...(syllables ? { syllables } : {}) });
  function setup(reply: object) {
    const env = boot({ loggedIn: true, state: FX.playerState });
    env.route(/color-lyrics/, reply as never);
    env.start();
    return env;
  }
  const LRC = { type: 'lyrics', status: 'synced', source: 'lrclib', plain: null, lines: [{ t: 1, text: 'from lrclib' }],
                track: { title: 'Wish I Knew You', artist: 'The Revivalists', album: 'Men Amongst Mountains', duration: 274 } };
  it('LINE_SYNCED: the request the web player sends; lines in ms; wins over LRCLIB for the track', async () => {
    const env = setup({ status: 200, json: { lyrics: { syncType: 'LINE_SYNCED', lines: [line(12340, 'First line'), line(15000, 'Second')] }, colors: {} } });
    expect(Q.keys.lyrics(ID)).toEqual(['spotify', 'lyrics', ID]);
    const l = await Q.fetchLyrics(TR, IMG);
    const c = env.calls.filter((x) => /color-lyrics/.test(x.url)).pop()!;
    expect(c.url).toBe('https://spclient.wg.spotify.com/color-lyrics/v2/track/' + ID + '/image/' + encodeURIComponent(IMG) + '?format=json&vocalRemoval=false&market=from_token');
    expect([c.method, c.headers.Authorization, c.headers['app-platform'], c.headers['client-token']]).toEqual(['GET', 'Bearer TOK', 'WebPlayer', 'CT']);
    expect(l).toMatchObject({ status: 'synced', source: 'spotify', lines: [{ t: 12340, text: 'First line' }, { t: 15000, text: 'Second' }] });
    Q.acceptLyrics(TR, l);
    expect(env.S.lyrics).toMatchObject({ status: 'synced', source: 'spotify', track: { title: 'Wish I Knew You', artist: 'The Revivalists' } });
    FakeSocket.last!.host(LRC);                                         // the host's, for the same track: ignored
    expect(env.S.lyrics.source).toBe('spotify');
    await Q.fetchLyrics(TR);                                            // the /image segment is optional
    expect(env.calls.filter((x) => /color-lyrics/.test(x.url)).pop()!.url).toBe('https://spclient.wg.spotify.com/color-lyrics/v2/track/' + ID + '?format=json&vocalRemoval=false&market=from_token');
  });
  it('SYLLABLE_SYNCED with syllable text -> karaoke words', async () => {
    setup({ status: 200, json: { lyrics: { syncType: 'SYLLABLE_SYNCED', lines: [
      line(1000, 'Hel lo', [{ startTimeMs: '1000', endTimeMs: '1300', text: 'Hel' }, { startTimeMs: '1300', endTimeMs: '1800', text: 'lo' }]),
      line(2000, 'no text', [{ startTimeMs: '2000', endTimeMs: '2500' }])] } } });
    const l = await Q.fetchLyrics(TR);
    expect(l.lines).toEqual([{ t: 1000, text: 'Hel lo', words: [{ t: 1000, text: 'Hel' }, { t: 1300, text: 'lo' }] }, { t: 2000, text: 'no text' }]);
  });
  it('UNSYNCED -> plain', async () => {
    setup({ status: 200, json: { lyrics: { syncType: 'UNSYNCED', lines: [line(0, 'la la'), line(0, 'la la la')] } } });
    expect(await Q.fetchLyrics(TR)).toMatchObject({ status: 'plain', plain: 'la la\nla la la', lines: null, source: 'spotify' });
  });
  it('404 -> none: the host\'s LRCLIB lyrics stay', async () => {
    const env = setup({ status: 404 });
    FakeSocket.last!.host(LRC);
    const l = await Q.fetchLyrics(TR);
    expect(l.status).toBe('none');
    Q.acceptLyrics(TR, l);
    expect(env.S.lyrics).toMatchObject({ status: 'synced', source: 'lrclib', lines: [{ t: 1000, text: 'from lrclib' }] });
  });
  it('401 -> QueryError (no lyrics for this account): LRCLIB stays; a stale track is never applied', async () => {
    const env = setup({ status: 401 });
    FakeSocket.last!.host(LRC);
    await expect(Q.fetchLyrics(TR)).rejects.toMatchObject({ name: 'QueryError', op: 'lyrics', status: 401 });
    expect(env.S.lyrics.source).toBe('lrclib');
    Q.acceptLyrics('spotify:track:someOtherTrack', { status: 'synced', lines: [{ t: 0, text: 'x' }], plain: null, track: null, source: 'spotify' });
    expect(env.S.lyrics.source).toBe('lrclib');
  });
  it('an odd body reads as none', async () => {
    setup({ status: 200, json: { something: 'else' } });
    expect((await Q.fetchLyrics(TR)).status).toBe('none');
    expect((await Q.fetchLyrics('spotify:episode:x')).status).toBe('none');
  });
});

describe('22. like / unlike, add to playlist, membership (synthetic responses; shapes unverified)', () => {
  const TRK = 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK';                  // "Linger", row 0 of the fixture playlist
  function setup(route?: (op: string, v: Record<string, unknown>) => { status: number } | undefined) {
    const env = boot({ loggedIn: true, hashes: FX.hashes });
    const inv: (readonly unknown[])[][] = [];
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body), r = route?.(b.operationName, b.variables);
      if (r) return r;
      const cap = (FX[b.operationName] || {}).response;
      return { status: 200, json: cap ? clone(cap) : { data: {} } };
    });
    env.start();
    Q.setInvalidator((ks) => { inv.push(ks.map((k) => [...k])); });
    const ops = (name: string) => env.pf().filter((c) => c.body.operationName === name);
    return Object.assign(env, { inv, ops });
  }
  it('Like: addToLibrary { libraryItemUris }, optimistic, then Liked Songs / library / saved refetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const env = setup((op) => (op === 'addToLibrary' ? { status: 200, json: { data: { addLibraryItems: { __typename: 'AddLibraryItemsResponse' } } }, delay: gate }
      : op === 'removeFromLibrary' ? { status: 200, json: { data: { removeLibraryItems: { __typename: 'RemoveLibraryItemsResponse' } } } } : undefined));
    const done = env.C.setLiked(TRK, true);
    expect(env.S.saved[TRK]).toBe(true);                               // at once
    release(); await done;
    const m = env.ops('addToLibrary').pop()!;
    expect(m.body.variables).toEqual({ libraryItemUris: [TRK] });     // live: `uris` is a 400
    expect(m.body.extensions.persistedQuery.sha256Hash).toBe('1ad0d40b3c09660d818b9e770eb1e84745dfbe941df159a64f8772b6fa2bfc3a');
    expect(env.inv.pop()).toEqual([['spotify', 'collection', LIKED], ['spotify', 'library'], ['spotify', 'saved']]);
    expect(await Q.fetchSaved([TRK])).toEqual({ [TRK]: true });        // known now: no call
    expect(env.ops('areEntitiesInLibrary').length).toBe(0);
    await env.C.addTo(TRK, LIKED, false);                             // Liked Songs routes to the library mutations
    expect(env.ops('removeFromLibrary').pop()!.body.variables).toEqual({ libraryItemUris: [TRK] });
    expect(env.S.saved[TRK]).toBe(false);
  });
  it('a refusal rolls back and says so; nothing is refetched', async () => {
    const env = setup((op) => (op === 'removeFromLibrary' ? { status: 400, json: { errors: [{ message: 'bad' }] } } : undefined));
    await env.C.setLiked(TRK, false);
    expect(TRK in env.S.saved).toBe(false);
    expect(env.S.ui.status).toMatch(/could not remove from your library \(400\)/);
    expect(env.inv).toEqual([]);
    const env2 = setup((op) => (op === 'addToLibrary' ? { status: 200, json: { data: { something: {} } } } : undefined));
    await env2.C.setLiked(TRK, true);                                   // 200 without the op's payload: a failure
    expect(TRK in env2.S.saved).toBe(false);
    expect(env2.S.ui.status).toMatch(/could not add to your library \(unexpected answer\)/);
  });
  it('saved flags: Liked Songs rows without a call, the rest 50 per areEntitiesInLibrary', async () => {
    const env = setup((op, v) => (op === 'areEntitiesInLibrary'
      ? { status: 200, json: { data: { lookup: (v.uris as string[]).map((u) => (u.startsWith('spotify:playlist:')
        ? { __typename: 'PlaylistResponseWrapper' }                    // live: a playlist entry carries no data
        : { __typename: 'TrackResponseWrapper', data: { __typename: 'Track', saved: u.endsWith('7') } })) } } } : undefined));
    const liked = await Q.fetchCollectionPage(LIKED);
    const uris = Array.from({ length: 119 }, (_x, i) => 'spotify:track:n' + i).concat('spotify:playlist:p');
    const got = await Q.fetchSaved([...uris, liked.tracks[0]!.uri]);
    expect(env.ops('areEntitiesInLibrary').map((c) => (c.body.variables.uris as string[]).length)).toEqual([50, 50, 20]);
    expect('spotify:playlist:p' in got).toBe(false);                   // unknown, not false
    expect(env.ops('areEntitiesInLibrary')[0]!.body.extensions.persistedQuery.sha256Hash).toBe('134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed');
    expect([got['spotify:track:n7'], got['spotify:track:n8'], got[liked.tracks[0]!.uri]]).toEqual([true, false, true]);
    expect(Q.keys.saved(['a', 'b'])).toEqual(['spotify', 'saved', 'a', 'b']);
    expect(Q.savedKey('a')).toEqual(['spotify', 'saved', 'a']);
  });
  it('editable playlists: canEditItems, and the same owner as an editable one', async () => {
    const pl = (id: string, owner: string, can?: boolean) => ({ item: { __typename: 'PlaylistResponseWrapper', data: { __typename: 'Playlist', uri: 'spotify:playlist:' + id, name: id,
      ownerV2: { data: { uri: 'spotify:user:' + owner, name: owner } }, ...(can === undefined ? {} : { currentUserCapabilities: { canEditItems: can } }) } } });
    setup((op) => (op === 'libraryV3' ? { status: 200, json: { data: { me: { libraryV3: { totalCount: 4, items: [
      pl('mine', 'me', true), pl('mineToo', 'me'), pl('theirs', 'them'), pl('followed', 'them', false)] } } } } } : undefined));
    expect((await Q.fetchEditablePlaylists()).map((p) => p.name)).toEqual(['mine', 'mineToo']);
  });
  it('add to a playlist: addToPlaylist at the bottom, optimistic, the playlist refetches', async () => {
    const env = setup((op) => (op === 'addToPlaylist' ? { status: 200, json: { data: { addItemsToPlaylist: { __typename: 'AddItemsToPlaylistPayload' } } } } : undefined));
    const done = env.C.addTo(TRK, PL, true);
    expect(env.S.membership[PL]![TRK]).toBe(true);
    await done;
    const m = env.ops('addToPlaylist').pop()!;
    expect(m.body.variables).toEqual({ playlistItemUris: [TRK], playlistUri: PL, newPosition: { moveType: 'BOTTOM_OF_PLAYLIST', fromUid: null } });
    expect(m.body.extensions.persistedQuery.sha256Hash).toBe('47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990');
    expect(env.inv.pop()).toEqual([['spotify', 'collection', PL], ['spotify', 'membership', TRK]]);
    expect(await Q.fetchMembership(TRK, [PL])).toEqual({ [PL]: true });
  });
  it('remove from a playlist: the uid is found by reading its pages; not found -> rolled back', async () => {
    const env = setup((op) => (op === 'removeFromPlaylist' ? { status: 200, json: { data: { removeItemsFromPlaylist: { __typename: 'RemoveItemsFromPlaylistPayload' } } } } : undefined));
    await env.C.addTo(TRK, PL, false);
    expect(env.ops('fetchPlaylist').length).toBe(1);                   // page 0 had it
    expect(env.ops('removeFromPlaylist').pop()!.body.variables).toEqual({ playlistUri: PL, uids: ['09ae1581344b553f'] });
    expect(env.S.membership[PL]![TRK]).toBe(false);
    await env.C.addTo('spotify:track:notThere', PL, false);          // 5 pages read, never seen
    expect(env.ops('fetchPlaylist').length).toBe(6);
    expect(env.ops('removeFromPlaylist').length).toBe(1);
    expect('spotify:track:notThere' in env.S.membership[PL]!).toBe(false);
    expect(env.S.ui.status).toMatch(/could not remove from the playlist \(not found in that playlist\)/);
  });
  it('membership: sightings, complete reads for 5 min, 10 playlists per call, long playlists unknown', async () => {
    const short = (u: string) => ({ status: 200, json: { data: { playlistV2: { name: u, content: { totalCount: 1, items: [
      { uid: 'u1', itemV2: { data: { uri: 'spotify:track:other', name: 'Other', artists: { items: [] } } } }] } } } } });
    const env = setup((op, v) => (op === 'fetchPlaylist' && v.uri !== PL ? short(String(v.uri)) : undefined));
    const many = Array.from({ length: 12 }, (_x, i) => 'spotify:playlist:s' + i);
    const a = await Q.fetchMembership(TRK, [PL, ...many]);
    expect(a[PL]).toBe(true);                                          // the fixture's page 0 has it
    expect(Object.keys(a).length).toBe(10);                           // PL + 9 short ones: 10 read this call
    expect(Object.values(a).filter((x) => x === false).length).toBe(9);
    const n = env.ops('fetchPlaylist').length;
    const b = await Q.fetchMembership(TRK, [PL, ...many]);
    expect(Object.keys(b).length).toBe(13);                           // the 3 left read now, the rest cached
    expect(env.ops('fetchPlaylist').length).toBe(n + 3);
    vi.setSystemTime(T0 + 5 * 60_000 + 1);
    await Q.fetchMembership(TRK, [many[0]!]);
    expect(env.ops('fetchPlaylist').length).toBe(n + 4);              // stale after 5 min: read again
    const c = await Q.fetchMembership('spotify:track:nowhere', [PL]);  // 123 tracks, 5 pages read, not seen
    expect(c).toEqual({});
  });
});

describe('23. membership: isCuratedEntities is a gate (captured shape)', () => {
  const TRK = 'spotify:track:0gEyKnHvgkrkBM6fbeHdwK', A = 'spotify:playlist:A', B = 'spotify:playlist:B';
  const answer = (isCurated: boolean) => ({ status: 200, json: { data: { lookupEntities: [{ __typename: 'Entity', isCurated, uri: TRK }] } } });
  function setup(curatedReply: object) {
    const env = boot({ loggedIn: true, hashes: FX.hashes });
    env.route(/pathfinder/, (_u, init) => {
      const b = JSON.parse(init.body);
      if (b.operationName === 'isCuratedEntities') return curatedReply as never;
      if (b.operationName === 'addToPlaylist') return { status: 200, json: { data: { addItemsToPlaylist: { __typename: 'AddItemsToPlaylistPayload' } } } };
      if (b.operationName === 'fetchPlaylist' && b.variables.uri === A) return { status: 200, json: { data: { playlistV2: { name: 'A', content: { totalCount: 1, items: [
        { uid: 'uA', itemV2: { data: { uri: TRK, name: 'Linger', artists: { items: [] } } } }] } } } } };
      return { status: 200, json: { data: { playlistV2: { name: 'x', content: { totalCount: 0, items: [] } } } } };
    });
    env.start();
    return Object.assign(env, { ops: (n: string) => env.pf().filter((c) => c.body.operationName === n) });
  }
  it('isCurated false: in none of them, no page reads; remembered 5 min', async () => {
    const env = setup(answer(false));
    expect(await Q.fetchMembership(TRK, [A, B])).toEqual({ [A]: false, [B]: false });
    const c = env.ops('isCuratedEntities');
    expect(c.length).toBe(1);
    expect(c[0]!.body.variables).toEqual({ uris: [TRK] });
    expect(c[0]!.body.extensions.persistedQuery.sha256Hash).toBe('af6bb0d2691f78f9169e1ba2dfed34a414bb4994e858f81487d6a26b95280566');
    expect(env.ops('fetchPlaylist').length).toBe(0);
    await Q.fetchMembership(TRK, [B]);
    expect(env.ops('isCuratedEntities').length).toBe(1);
    await env.C.addTo(TRK, B, true);                                   // our own add makes it curated
    expect(await Q.fetchMembership(TRK, [A, B])).toMatchObject({ [B]: true });
    expect(env.ops('fetchPlaylist').length).toBe(1);                   // A read now: true is only a gate
  });
  it('isCurated true: which ones is the page reads\' answer', async () => {
    const env = setup(answer(true));
    expect(await Q.fetchMembership(TRK, [A, B])).toEqual({ [A]: true, [B]: false });
    expect(env.ops('fetchPlaylist').length).toBe(2);
    expect(env.S.ui.status).not.toMatch(/unavailable/);
  });
  it('a refusal or another shape: the page reads, said once', async () => {
    const env = setup({ status: 400, json: { errors: [{ message: 'bad variables' }] } });
    expect(await Q.fetchMembership(TRK, [A, B])).toEqual({ [A]: true, [B]: false });
    expect(env.ops('fetchPlaylist').length).toBe(2);
    expect(env.S.ui.status).toBe('Spotify: playlist check unavailable — reading the playlists instead');
    env.S.actions.setStatus('x');
    await Q.fetchMembership('spotify:track:other', ['spotify:playlist:C']);
    expect(env.S.ui.status).toBe('x');
    const env2 = setup({ status: 200, json: { data: { lookup: [{ data: { isCurated: false } }] } } });   // not lookupEntities
    await Q.fetchMembership(TRK, [B]);
    expect(env2.ops('fetchPlaylist').length).toBe(1);
  });
});

describe('the Tauri host bridge (CONTRACT v8)', () => {
  it('follows the host, sends every request through sp_request, and never holds the bearer', async () => {
    type Args = { url: string; method: string; body: string; headers: Record<string, string> };
    const on: Record<string, (e: { payload: unknown }) => void> = {}, calls: [string, Args][] = [];
    const snapshot = { loggedIn: null, hasToken: false, deviceId: null, hobs: 'dddd', spclient: 'gew4-spclient.spotify.com',
                       hashes: { libraryV3: '1'.repeat(64) }, scanned: { searchDesktop: '3'.repeat(64) }, cluster: null };
    vi.stubGlobal('__TAURI__', {
      core: { invoke: (cmd: string, args: Args) => {
        calls.push([cmd, args]);
        const lib = { data: { me: { libraryV3: { totalCount: 0, items: [] } } } };
        return Promise.resolve(cmd === 'sp_snapshot' ? snapshot : cmd === 'sp_request'
          ? { status: 200, text: JSON.stringify(/pathfinder/.test(args.url) ? lib : { ack_id: 'x' }), retryAfter: null } : undefined);
      } },
      event: { listen: (e: string, f: (e: { payload: unknown }) => void) => { on[e] = f; return Promise.resolve(() => { delete on[e]; }); } },
    });
    const env = boot({ loggedIn: true });                         // the Deno host's object: replaced, never read
    env.start();
    await settle();
    const W = window.__wmpSpotify!;
    expect([W.token, W.spclient, W.hashes!.libraryV3, env.S.auth.loggedIn, env.S.auth.canLogout]).toEqual([undefined, 'gew4-spclient.spotify.com', '1'.repeat(64), null, true]);
    on['sp:auth']!({ payload: { loggedIn: true, hasToken: true } });
    on['sp:cluster']!({ payload: { active_device_id: FX.activeDeviceId, player_state: FX.playerState,
                                   devices: { [ME]: { name: 'Web Player (Microsoft Edge)', device_type: 'computer', volume: 65535 } } } });
    await settle();
    expect(env.S.auth.loggedIn).toBe(true);
    expect(W.deviceId).toBe(ME);                                   // resolved from the hobs prefix
    expect(env.S.playback.track!.title).toBe('Wish I Knew You');
    expect(env.S.devices.list.map((d) => d.name)).toEqual(['Web Player (Microsoft Edge)']);
    await env.C.pause();
    await Q.fetchLibraryList();
    const req = calls.filter((c) => c[0] === 'sp_request').map((c) => c[1]);
    const cmd = req.find((r) => /player\/command/.test(r.url)), lib = req.find((r) => /libraryV3/.test(r.body));
    expect(cmd).toMatchObject({ url: `https://gew4-spclient.spotify.com/connect-state/v1/player/command/from/${ME}/to/${FX.activeDeviceId}`,
                                method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
    expect(JSON.parse(cmd!.body)).toEqual({ command: { endpoint: 'pause' } });
    expect(JSON.parse(lib!.body).extensions.persistedQuery.sha256Hash).toBe('1'.repeat(64));
    expect(req.every((r) => !('Authorization' in r.headers) && !('authorization' in r.headers))).toBe(true);
    expect(calls.some(([c]) => c === 'sp_route' || c === 'sp_cookie')).toBe(false);
    env.C.logout();
    expect(calls.at(-1)![0]).toBe('sp_logout');
  });
});
