// Spotify's lyrics: fetched per playing track (useLyricsFor) and handed to the store; syllable-
// synced words through the karaoke path; the source named on the lyrics button and in Options.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lyrics, Track } from '../../src/model';
import { useApp, useLyricsFor } from '../../src/ui';
import { fakeData, mountSkin } from './harness';

const T1: Track = { uri: 'spotify:track:aaa', title: 'Song', artist: 'Band', album: 'LP', duration: 200000, art: 'https://i/c.jpg' };
const T2: Track = { ...T1, uri: 'spotify:track:bbb', title: 'Other' };
const SPOTIFY: Lyrics = { status: 'synced', source: 'spotify', plain: null, track: null,
  lines: [{ t: 0, text: 'Hel lo there', words: [{ t: 0, text: 'Hel' }, { t: 400, text: 'lo' }, { t: 1000, text: 'there' }] },
          { t: 5000, text: 'next line' }] };

function Loader() {
  const t = useApp((s) => s.playback.track);
  useLyricsFor(t?.uri, t?.art);
  return null;
}
const $ = (s: string) => document.querySelector<HTMLElement>(s);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Spotify lyrics', () => {
  it('fetched on every track change (with the art url) and handed to acceptLyrics; cached per track', async () => {
    const h = await mountSkin('spotify', fakeData({ lyrics: { [T1.uri]: SPOTIFY } }), <Loader />);
    act(() => h.S().actions.setPlayback({ status: 'playing', track: T1, position: 0, at: Date.now() }));
    await h.settle();
    expect(h.queries.fetchLyrics.mock.calls).toEqual([[T1.uri, T1.art]]);
    expect(h.queries.acceptLyrics).toHaveBeenCalledWith(T1.uri, SPOTIFY);
    act(() => h.S().actions.setPlayback({ track: T2 }));
    await h.settle();
    act(() => h.S().actions.setPlayback({ track: T1 }));
    await h.settle();
    expect(h.queries.fetchLyrics.mock.calls.map((c) => c[0])).toEqual([T1.uri, T2.uri]);   // T1 again from the cache
    act(() => h.S().actions.setLyricsEnabled(false));
    act(() => h.S().actions.setPlayback({ track: { ...T1, uri: 'spotify:track:ccc' } }));
    await h.settle();
    expect(h.queries.fetchLyrics).toHaveBeenCalledTimes(2);                                   // lyrics off: nothing asked
  });

  it('syllable-synced words run the karaoke path; the source shows on the button and in Options', async () => {
    const h = await mountSkin('spotify');
    act(() => {
      h.S().actions.setPlayback({ status: 'paused', track: T1, position: 500, at: Date.now() });
      h.S().actions.setLyrics({ ...SPOTIFY, track: { title: T1.title, artist: T1.artist } });
    });
    const spans = [...$('#lyrcur')!.querySelectorAll('span')];
    expect(spans.map((x) => x.textContent + ':' + x.dataset.k)).toEqual(['Hel:sung', 'lo:now', 'there:']);
    expect(spans[1]!.style.getPropertyValue('--f')).toBe('16%');       // 100 of the 600 ms 'lo' is sung
    expect($('#lyrnext')!.textContent).toBe('next line');
    expect($('#blyrics')!.title).toBe('Lyrics: On (Spotify)');
    act(() => h.S().actions.setUi({ dialog: 'options' }));
    expect($('#lyricsource')!.textContent).toMatch(/Spotify.s own lyrics first, LRCLIB when it has none\. This track: Spotify\./);
    act(() => h.S().actions.setLyrics({ ...SPOTIFY, source: 'lrclib', track: { title: T1.title, artist: T1.artist } }));
    expect([$('#blyrics')!.title, $('#lyricsource')!.textContent]).toEqual(['Lyrics: On (LRCLIB)', expect.stringMatching(/This track: LRCLIB\./)]);
  });
});
