/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// The four commands the skins lacked (2026-10-05): Clear queue, Smart Shuffle, New / Delete playlist, Mark as
// played. Request shapes are what open.spotify.com sent (CONTRACT v6.1 "Library writes", "Smart Shuffle").
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackLabel } from '../../src/model';
import { createSpotifyAdapter } from '../../src/adapters/spotify';
import { setInvalidator } from '../../src/adapters/spotify/saved';
import type { ProvidedTrack } from '../../src/adapters/spotify/sp';
import { FX, clone, mkEnv, settle } from './harness';

vi.mock('../../src/adapters/local/audio', () => ({
  makeLevel: () => ({ freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 0, timeStamp: 0 }),
  createAnalyserGraph: () => { throw new Error('no Web Audio in these tests'); },
  createPcmLevel: () => ({ push() {}, fill() {} }),
}));

let stops: (() => void)[] = [];
afterEach(() => { stops.forEach((s) => s()); stops = []; setInvalidator(null); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ACTIVE = FX.activeDeviceId as string, SPK = { id: 'spk1', name: 'WMP Spotify (iOS)' };
const tr = (id: string, provider: string): ProvidedTrack =>
  ({ uri: 'spotify:track:' + id, uid: 'uid-' + id, metadata: { title: id.toUpperCase(), artist_name: 'Queen', ...(provider === 'queue' ? { is_queued: 'true' } : {}) }, provider });
const D: ProvidedTrack = { uri: 'spotify:delimiter', uid: 'delimiter0', metadata: { hidden: 'true' } };
/** devices[id].capabilities as the cluster carries them */
const cluster = (caps: Record<string, Record<string, unknown>>) =>
  ({ devices: Object.fromEntries(Object.entries(caps).map(([id, c]) => [id, { name: id, capabilities: c }])) });
const SMART = { supports_smart_shuffle_mode: true, supports_set_options_command: true };
/** the fixture's state (a Daily Mix, RECOMMENDATION refused) made a plain playlist the device may smart-shuffle */
const smartState = (o: Record<string, unknown> = {}) => {
  const ps = clone(FX.playerState);
  ps.context_uri = 'spotify:playlist:2awChHWKKqe1TgwxBtUp4E';
  ps.restrictions.disallow_setting_modes.context_enhancement.values.RECOMMENDATION = {};
  return Object.assign(ps, o);
};

function setup(W: Record<string, unknown> = {}, reply: object = { status: 200, json: { ack_id: 'a' } }) {
  const env = mkEnv({ loggedIn: true, state: FX.playerState, hashes: { profileAttributes: 'p'.repeat(64) }, ...W });
  const ad = createSpotifyAdapter(env.store);
  stops.push(() => ad.stop());
  env.route(/player\/command/, reply as never);
  env.route(/pathfinder/, (_u, init) => (JSON.parse(init.body).operationName === 'profileAttributes'
    ? { status: 200, json: { data: { me: { profile: { uri: 'spotify:user:ryan%40x', username: 'ryan@x' } } } } } : { status: 200, json: { data: {} } }));
  ad.start();
  const invalidated: unknown[] = [];
  setInvalidator((keys) => { invalidated.push(...keys); });
  const writes = () => env.calls.filter((c) => /spclient\.wg\.spotify\.com/.test(c.url)).map((c) => [c.url.replace('https://spclient.wg.spotify.com', ''), c.body]);
  return Object.assign(env, { invalidated, writes });
}

describe('Clear queue (set_queue less the queued rows)', () => {
  const RAW = [tr('q1', 'queue'), tr('q2', 'queue'), tr('c1', 'context'), tr('c2', 'context'), D];
  const state = () => ({ ...clone(FX.playerState), next_tracks: clone(RAW) });

  it('queued rows are marked; the clear sends the context\'s rows as the cluster gave them, prev_tracks and revision; the queue shows it at once', async () => {
    const env = setup({ state: state() });
    expect(env.S.queue.next.map((t) => [t.title, !!t.queued])).toEqual([['Q1', true], ['Q2', true], ['C1', false], ['C2', false]]);
    void env.C.clearQueue!();
    expect(env.S.queue.next.map(trackLabel)).toEqual(['C1 – Queen', 'C2 – Queen']);                // optimistic
    await settle();
    const c = env.calls.filter((x) => /player\/command/.test(x.url)).pop()!;
    expect(c.url).toMatch(new RegExp('/to/' + ACTIVE + '$'));
    expect(c.body.command).toEqual({ endpoint: 'set_queue', next_tracks: [RAW[2], RAW[3], D], prev_tracks: FX.playerState.prev_tracks,
                                     queue_revision: FX.playerState.queue_revision, logging_params: {} });
  });

  it('refused: the queued rows come back; nothing queued: nothing sent', async () => {
    const env = setup({ state: state() }, { status: 403, json: { error: { message: 'no' } } });
    await env.C.clearQueue!();
    expect(env.S.queue.next.map((t) => t.title)).toEqual(['Q1', 'Q2', 'C1', 'C2']);
    const none = setup({ state: { ...clone(FX.playerState), next_tracks: [tr('c1', 'context')] } });
    await none.C.clearQueue!();
    expect(none.cmds()).toEqual([]);
  });

  it('the host\'s speaker in charge: still connect-state (set_queue to the speaker; librespot replaces its lists), nothing to alchemyPlayer', async () => {
    const sent: string[] = [];
    vi.stubGlobal('__wmpSpeaker', SPK);
    vi.stubGlobal('alchemyPlayer', (c: string) => { sent.push(c); });
    const env = setup({ state: state(), activeDeviceId: 'spk1' });
    await env.C.clearQueue!();
    expect(env.calls.filter((x) => /player\/command/.test(x.url)).map((x) => [x.url.split('/to/')[1], x.body.command.endpoint])).toEqual([['spk1', 'set_queue']]);
    expect(sent.filter((c) => !/^(crossfade|eq|quality|normalise|cache):/.test(c))).toEqual([]);
  });
});

describe('Smart Shuffle (the three-way shuffle)', () => {
  it('read from options.modes; offered only where the target device lists supports_smart_shuffle_mode and does not refuse RECOMMENDATION', () => {
    const on = setup({ state: smartState({ options: { shuffling_context: true, modes: { context_enhancement: 'RECOMMENDATION' } } }), cluster: cluster({ [ACTIVE]: SMART }) });
    expect([on.S.playback.shuffle, on.S.playback.shuffleMode, on.S.playback.canSmartShuffle]).toEqual([true, 'smart', true]);
    // the fixture as captured: a Daily Mix, RECOMMENDATION 'not_supported_by_content_type'
    const mix = setup({ cluster: cluster({ [ACTIVE]: SMART }) });
    expect([mix.S.playback.shuffleMode, mix.S.playback.canSmartShuffle]).toEqual(['shuffle', false]);
    // librespot (the app's speaker) has no such capability
    const spk = setup({ state: smartState(), cluster: cluster({ [ACTIVE]: { supports_set_options_command: true } }) });
    expect(spk.S.playback.canSmartShuffle).toBe(false);
    const album = setup({ state: smartState({ context_uri: 'spotify:album:x' }), cluster: cluster({ [ACTIVE]: SMART }) });
    expect(album.S.playback.canSmartShuffle).toBe(false);
  });

  it('set_options with the mode, as the web player sends it; optimistic; refused: back as it was', async () => {
    const env = setup({ state: smartState(), cluster: cluster({ [ACTIVE]: SMART }) });
    void env.C.setShuffleMode!('smart');
    expect([env.S.playback.shuffle, env.S.playback.shuffleMode]).toEqual([true, 'smart']);
    await settle();
    expect(env.cmds().pop()).toEqual({ endpoint: 'set_options', shuffling_context: true, modes: { context_enhancement: 'RECOMMENDATION' } });
    env.fire('wmp-spotify-state', smartState({ options: { shuffling_context: true, modes: { context_enhancement: 'RECOMMENDATION' } } }));
    env.C.toggleShuffle();                                                                       // from smart: off, the mode cleared with it
    await settle();
    expect(env.cmds().pop()).toEqual({ endpoint: 'set_options', shuffling_context: false, modes: { context_enhancement: 'NONE' } });
    const no = setup({ state: smartState(), cluster: cluster({ [ACTIVE]: SMART }) }, { status: 403, json: { error: { message: 'no' } } });
    await no.C.setShuffleMode!('smart');
    expect([no.S.playback.shuffleMode, no.S.playback.pending]).toEqual(['shuffle', null]);
  });

  it('not offered: smart is said, not sent; plain shuffle still is', async () => {
    const env = setup({ state: smartState() });                                                  // no capabilities known
    await env.C.setShuffleMode!('smart');
    expect([env.cmds(), env.S.playback.shuffleMode, env.S.ui.status]).toEqual([[], 'shuffle', 'Spotify: Smart Shuffle is not available on this device']);
    await env.C.setShuffleMode!('off');
    expect(env.cmds().pop()).toEqual({ endpoint: 'set_options', shuffling_context: false, modes: { context_enhancement: 'NONE' } });
  });

  it('the host\'s speaker in charge: never smart (none in its commands, none in librespot); off and shuffle go as shuffle:0/1', async () => {
    const sent: string[] = [];
    vi.stubGlobal('__wmpSpeaker', SPK);
    vi.stubGlobal('alchemyPlayer', (c: string) => { sent.push(c); });
    const env = setup({ state: smartState(), activeDeviceId: 'spk1', cluster: cluster({ spk1: { supports_set_options_command: true } }) });
    expect(env.S.playback.canSmartShuffle).toBe(false);
    await env.C.setShuffleMode!('smart');
    await env.C.setShuffleMode!('off');
    expect(sent.filter((c) => c.startsWith('shuffle'))).toEqual(['shuffle:0']);
    expect(env.cmds()).toEqual([]);
  });
});

describe('New playlist / Delete', () => {
  const NEW = 'spotify:playlist:7newPlaylistId000000000';
  const PATH = '/playlist/v2/user/ryan%40x/rootlist/changes';
  function routes(env: ReturnType<typeof setup>, create: object = { status: 200, json: { uri: NEW, revision: 'AAAAAQ==' } }, root: object = { status: 200, json: {} }) {
    env.route(/playlist\/v2\/playlist$/, create as never);
    env.route(/rootlist\/changes/, root as never);
  }

  it('creates by name, puts it at the top of the user\'s rootlist, answers its uri; the library list refetches', async () => {
    const env = setup();
    routes(env);
    expect(await env.C.createPlaylist!('WMP test')).toBe(NEW);
    expect(env.writes()).toEqual([
      ['/playlist/v2/playlist', { ops: [{ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { name: 'WMP test' } } } }] }],
      [PATH, { deltas: [{ ops: [{ kind: 'ADD', add: { items: [{ uri: NEW, attributes: { timestamp: String(Date.now()) } }], addFirst: true } }],
                          info: { source: { client: 'WEBPLAYER' } } }] }]]);
    expect(env.invalidated).toEqual([['spotify', 'library']]);
  });

  it('refused (either step): null and a note, the list untouched', async () => {
    const env = setup();
    routes(env, { status: 400, json: {} });
    expect(await env.C.createPlaylist!('WMP test')).toBe(null);
    expect([env.writes().length, env.S.ui.status, env.invalidated]).toEqual([1, 'Spotify: could not create the playlist (400)', []]);
    const root = setup();
    routes(root, undefined, { status: 500, json: {} });
    expect(await root.C.createPlaylist!('WMP test')).toBe(null);
    expect(root.S.ui.status).toBe('Spotify: could not create the playlist (500)');
  });

  it('Delete takes it off the rootlist (REM, itemsAsKey); refused: false', async () => {
    const env = setup();
    routes(env);
    expect(await env.C.deletePlaylist!(NEW)).toBe(true);
    expect(env.writes()).toEqual([[PATH, { deltas: [{ ops: [{ kind: 'REM', rem: { items: [{ uri: NEW }], itemsAsKey: true } }], info: { source: { client: 'WEBPLAYER' } } }] }]]);
    expect(env.invalidated).toEqual([['spotify', 'library']]);
    const no = setup();
    routes(no, undefined, { status: 403, json: {} });
    expect(await no.C.deletePlaylist!(NEW)).toBe(false);
  });
});

describe('Mark as played / unplayed', () => {
  const EP = 'spotify:episode:550hUc5OP9domL3oJBIimF';

  it('the collection set markedasfinished: added for played, is_removed for unplayed; the mark shows at once and stays', async () => {
    const env = setup();
    env.route(/collection\/v2\/write/, { status: 200, json: {} });
    const p = env.C.markPlayed!(EP, true);
    expect(env.S.played).toEqual({ [EP]: true });                                                // optimistic
    await p;
    await env.C.markPlayed!(EP, false);
    expect(env.writes()).toEqual([
      ['/collection/v2/write', { username: 'ryan@x', set: 'markedasfinished', items: [{ uri: EP }] }],
      ['/collection/v2/write', { username: 'ryan@x', set: 'markedasfinished', items: [{ uri: EP, is_removed: true }] }]]);
    expect(env.S.played).toEqual({ [EP]: false });
    // the collection service refuses "application/json;charset=UTF-8" (400)
    expect(env.calls.filter((c) => /collection/.test(c.url)).map((c) => c.headers['Content-Type'])).toEqual(['application/json', 'application/json']);
  });

  it('refused: the mark goes back and the status bar says so', async () => {
    const env = setup();
    env.route(/collection\/v2\/write/, { status: 403, json: {} });
    await env.C.markPlayed!(EP, true);
    expect([env.S.played, env.S.ui.status]).toEqual([{}, 'Spotify: could not mark the episode played (403)']);
  });
});
