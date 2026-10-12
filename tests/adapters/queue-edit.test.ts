/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Editing Up Next: Connect's set_queue with the whole next_tracks as the cluster gave them (uid, metadata,
// provider kept), the cluster's prev_tracks and queue_revision: the fields librespot's SetQueueCommand
// requires (librespot-core 0.8.0 dealer/protocol/request.rs). The store's queue moves at once and comes
// back if the player refuses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackLabel } from '../../src/model';
import { createSpotifyAdapter } from '../../src/adapters/spotify';
import { nextTracks } from '../../src/adapters/spotify/queue';
import type { ProvidedTrack } from '../../src/adapters/spotify/sp';
import { FX, clone, mkEnv, settle } from './harness';

vi.mock('../../src/adapters/local/audio', () => ({
  makeLevel: () => ({ freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024), new Uint8Array(1024)], state: 0, timeStamp: 0 }),
  createAnalyserGraph: () => { throw new Error('no Web Audio in these tests'); },
  createPcmLevel: () => ({ push() {}, fill() {} }),
}));

let stops: (() => void)[] = [];
afterEach(() => { stops.forEach((s) => s()); stops = []; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.alchemyLog; });

const tr = (id: string, provider: string, title?: string): ProvidedTrack =>
  ({ uri: 'spotify:track:' + id, uid: 'uid-' + id, metadata: { ...(title ? { title, artist_name: 'Queen' } : {}), ...(provider === 'queue' ? { is_queued: 'true' } : {}) }, provider });
// a queued song, two context songs with names, one the store cannot name yet (not shown), the end-of-context delimiter
const Q = tr('q', 'queue', 'Queued'), C1 = tr('c1', 'context', 'One'), U = tr('u', 'context'), C2 = tr('c2', 'context', 'Two');
const D: ProvidedTrack = { uri: 'spotify:delimiter', uid: 'delimiter0', metadata: { hidden: 'true' } };
const RAW = [Q, C1, U, C2, D], AT = [0, 1, 3];
const uris = (l: (ProvidedTrack | null)[]) => l.map((t) => t?.uri?.split(':').pop());

describe('nextTracks: the store\'s order back onto the cluster\'s list', () => {
  it('reorders the shown rows in their places, keeps the unshown ones where they were, drops a removed one', () => {
    expect(uris(nextTracks(RAW, AT, [0, 2, 1]))).toEqual(['q', 'c2', 'u', 'c1', 'delimiter']);
    expect(uris(nextTracks(RAW, AT, [0, 1]))).toEqual(['q', 'c1', 'u', 'delimiter']);        // the last row removed
    expect(uris(nextTracks(RAW, AT, [1, 2]))).toEqual(['c1', 'c2', 'u', 'delimiter']);       // the queued one removed
  });
  it('each track as the cluster gave it; one put above a queued track joins the queue', () => {
    const out = nextTracks(RAW, AT, [2, 0, 1]);                                               // Play Next on "Two"
    expect(uris(out)).toEqual(['c2', 'q', 'u', 'c1', 'delimiter']);
    expect(out[0]).toEqual({ ...C2, provider: 'queue', metadata: { ...C2.metadata, is_queued: 'true' } });
    expect(out.slice(1)).toEqual([Q, U, C1, D]);                                              // untouched: uid, metadata, provider
  });
});

describe('reorderQueue: set_queue through the command path', () => {
  function setup(reply: object = { status: 200, json: { ack_id: 'q' } }) {
    const ps = clone(FX.playerState);
    ps.next_tracks = clone(RAW);
    const env = mkEnv({ loggedIn: true, state: ps });
    const ad = createSpotifyAdapter(env.store);
    stops.push(() => ad.stop());
    env.route(/player\/command/, reply as never);
    env.route(/pathfinder/, { status: 200, json: { data: {} } });
    ad.start();
    const log = vi.fn();
    window.alchemyLog = log;
    return Object.assign(env, { ps, log, queue: () => env.S.queue.next.map(trackLabel) });
  }

  it('sends the whole list with the cluster\'s prev_tracks and queue_revision, the fields librespot requires; the queue moves at once', async () => {
    const env = setup();
    expect(env.queue()).toEqual(['Queued – Queen', 'One – Queen', 'Two – Queen']);
    env.C.reorderQueue!([1, 0, 2]);                                                           // Move Down on "Queued"
    expect(env.queue()).toEqual(['One – Queen', 'Queued – Queen', 'Two – Queen']);           // optimistic
    await settle();
    const c = env.calls.filter((x) => /player\/command/.test(x.url)).pop()!;
    expect(c.url).toMatch(new RegExp('/connect-state/v1/player/command/from/.+/to/' + FX.activeDeviceId + '$'));
    const cmd = c.body.command;
    expect(Object.keys(cmd).sort()).toEqual(['endpoint', 'logging_params', 'next_tracks', 'prev_tracks', 'queue_revision']);
    expect(cmd.endpoint).toBe('set_queue');
    expect(cmd.prev_tracks).toEqual(env.ps.prev_tracks);
    expect(cmd.queue_revision).toBe(env.ps.queue_revision);
    expect(cmd.next_tracks).toEqual([{ ...C1, provider: 'queue', metadata: { ...C1.metadata, is_queued: 'true' } }, Q, U, C2, D]);
    // the next state shows it: the host's log says so three seconds on
    env.fire('wmp-spotify-state', { ...env.ps, next_tracks: cmd.next_tracks });
    vi.advanceTimersByTime(3000);
    expect(env.log).toHaveBeenCalledWith('spotify: set_queue applied');
  });

  it('a second edit before any state builds on the first; Remove drops the row', async () => {
    const env = setup();
    env.C.reorderQueue!([0, 2, 1]);
    env.C.reorderQueue!([0, 1]);                                                              // then the last ("One") removed
    expect(env.queue()).toEqual(['Queued – Queen', 'Two – Queen']);
    await settle();
    expect(uris(env.cmds().pop().next_tracks)).toEqual(['q', 'c2', 'u', 'delimiter']);
  });

  it('refused: the queue goes back as it was; a state that does not show the edit is said in the log', async () => {
    const env = setup({ status: 403, json: { error: { message: 'nope' } } });
    env.C.reorderQueue!([2, 0, 1]);
    expect(env.queue()[0]).toBe('Two – Queen');
    await settle();
    expect(env.queue()).toEqual(['Queued – Queen', 'One – Queen', 'Two – Queen']);
    const ok = setup();
    ok.C.reorderQueue!([2, 0, 1]);
    await settle();
    ok.fire('wmp-spotify-state', ok.ps);                                                      // the device kept its order
    vi.advanceTimersByTime(3000);
    expect(ok.log).toHaveBeenCalledWith('spotify: set_queue not shown by the next state (its first: spotify:track:q spotify:track:c1 spotify:track:u spotify:track:c2)');
  });
});
