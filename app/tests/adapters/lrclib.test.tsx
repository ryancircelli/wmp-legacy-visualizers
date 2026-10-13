// useLyricsFor's fallback step (Spotify under the speaker's uri, then LRCLIB) over the fake catalogue
// (tests/skins/harness): asked only when Spotify has none, only once the playing track is named, once
// per track, never while lyrics are off.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lyrics, Track } from '../../src/model';
import { useApp, useLyricsFor } from '../../src/ui';
import { fakeData, mountSkin } from '../skins/harness';

const T1: Track = { uri: 'spotify:track:aaa', title: 'Drift And Die', artist: 'Puddle Of Mudd', album: 'Come Clean', duration: 265066, art: null };
const T2: Track = { ...T1, uri: 'spotify:track:bbb', title: 'Savior' };
const HAS: Lyrics = { status: 'synced', source: 'spotify', plain: null, track: null, lines: [{ t: 0, text: 'x' }] };
const LRC: Lyrics = { status: 'synced', source: 'lrclib', plain: null, track: { title: T1.title, artist: T1.artist, uri: T1.uri }, lines: [{ t: 10720, text: 'Forgotten' }] };

function Loader() {
  const t = useApp((s) => s.playback.track);
  useLyricsFor(t?.uri, t?.art);
  return null;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('LRCLIB when Spotify has none', () => {
  it('asked once the track is named, once per track, and its answer goes to acceptLyrics', async () => {
    const h = await mountSkin('spotify', fakeData({ fallback: { [T1.uri]: LRC } }), <Loader />);
    act(() => h.S().actions.setPlayback({ status: 'playing', track: { ...T1, title: '' }, position: 0, at: Date.now() }));   // a bare speaker state
    await h.settle();
    expect(h.queries.fetchLyrics).toHaveBeenCalledTimes(1);
    expect(h.queries.fetchLyricsFallback).not.toHaveBeenCalled();                                      // no title yet
    act(() => h.S().actions.setPlayback({ track: T1 }));
    await h.settle();
    expect(h.queries.fetchLyricsFallback.mock.calls).toEqual([[T1.uri]]);
    expect(h.queries.acceptLyrics).toHaveBeenLastCalledWith(T1.uri, LRC);
    act(() => h.S().actions.setPlayback({ track: T2 }));
    await h.settle();
    act(() => h.S().actions.setPlayback({ track: T1 }));
    await h.settle();
    expect(h.queries.fetchLyricsFallback.mock.calls.map((c) => c[0])).toEqual([T1.uri, T2.uri]);        // T1 again from the cache
    expect(h.queries.acceptLyrics).toHaveBeenLastCalledWith(T1.uri, LRC);
  });

  it('not asked when Spotify has lyrics, nor while lyrics are off', async () => {
    const h = await mountSkin('spotify', fakeData({ lyrics: { [T1.uri]: HAS } }), <Loader />);
    act(() => h.S().actions.setPlayback({ status: 'playing', track: T1, position: 0, at: Date.now() }));
    await h.settle();
    expect(h.queries.fetchLyrics).toHaveBeenCalledTimes(1);
    act(() => h.S().actions.setLyricsEnabled(false));
    act(() => h.S().actions.setPlayback({ track: T2 }));
    await h.settle();
    expect(h.queries.fetchLyricsFallback).not.toHaveBeenCalled();
  });
});
