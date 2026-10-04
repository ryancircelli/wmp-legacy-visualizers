// The host's own player's sound settings (CONTRACT v10 `crossfade:` `eq:` `quality:` `normalise:` `cache:`):
// every one sent once at the start with the stored values and again at its every change; nothing without the binding.
import { afterEach, expect, it, vi } from 'vitest';
import { hostSettings } from '../../src/adapters/spotify';
import { createAppStore, DEFAULTS, EQ_PRESETS, eqPreset, normalize, type Settings } from '../../src/model';

afterEach(() => { vi.unstubAllGlobals(); });
const ROCK = '[5,4,3,1.5,-0.5,-1,0.5,2.5,3.5,4.5]';

it('the five commands go out at the start with the stored values, then each again at its change only', () => {
  const sent: string[] = [], log: string[] = [];
  vi.stubGlobal('alchemyPlayer', (c: string) => { sent.push(c); });
  vi.stubGlobal('alchemyLog', (l: string) => { log.push(l); });
  const store = createAppStore({ persist: false, settings: { ...DEFAULTS, crossfade: 5, eq: 'rock', quality: 320, normalise: true, audioCache: false } });
  const off = hostSettings(store), set = (p: Partial<Settings>) => store.getState().actions.setSettings(p);
  expect([sent, store.getState().auth.hostPlayer]).toEqual([['crossfade:5', 'eq:' + ROCK, 'quality:320', 'normalise:1', 'cache:0'], true]);
  sent.length = 0;
  set({ eq: 'off' });
  set({ quality: 96 });
  set({ normalise: false });
  set({ audioCache: true });
  set({ crossfade: 0 });
  set({ volume: 40 });                               // not a sound setting: nothing
  set({ eq: 'flat' });                               // the same gains as Off: nothing
  expect(sent).toEqual(['eq:[0,0,0,0,0,0,0,0,0,0]', 'quality:96', 'normalise:0', 'cache:1', 'crossfade:0']);
  expect(log).toContain("spotify: eq:[0,0,0,0,0,0,0,0,0,0] to the host's player");
  off();
  set({ eq: 'rock' });
  expect(sent).toHaveLength(5);                      // stopped
});

it('without the binding nothing is sent and the host is said to have no player', () => {
  const log: string[] = [];
  vi.stubGlobal('alchemyLog', (l: string) => { log.push(l); });
  const store = createAppStore({ persist: false });
  hostSettings(store);
  store.getState().actions.setSettings({ eq: 'rock', quality: 320 });
  expect([store.getState().auth.hostPlayer, log]).toEqual([false, []]);
});

it('the presets: the iPod\'s 23 in its order, ten bands each within the host\'s ±12 dB; Off and Flat all zeros; an unknown id is Off', () => {
  expect(EQ_PRESETS.map((p) => p.name)).toEqual(['Off', 'Acoustic', 'Bass Booster', 'Bass Reducer', 'Classical', 'Dance', 'Deep', 'Electronic',
    'Flat', 'Hip Hop', 'Jazz', 'Latin', 'Loudness', 'Lounge', 'Piano', 'Pop', 'R&B', 'Rock', 'Small Speakers', 'Spoken Word',
    'Treble Booster', 'Treble Reducer', 'Vocal Booster']);
  expect(EQ_PRESETS.every((p) => p.gains.length === 10 && p.gains.every((g) => Math.abs(g) <= 12))).toBe(true);
  expect([eqPreset('off').gains, eqPreset('flat').gains, eqPreset('nope').id]).toEqual([Array(10).fill(0), Array(10).fill(0), 'off']);
});

it('the settings as stored: the contract\'s defaults (eq off, 160 kbps, normalise on (Spotify\'s own default), cache on); a value out of its set reads as its default', () => {
  const pick = ({ eq, quality, normalise, audioCache }: ReturnType<typeof normalize>) => ({ eq, quality, normalise, audioCache });
  expect(pick(normalize({}))).toEqual({ eq: 'off', quality: 160, normalise: true, audioCache: true });
  expect(pick(normalize({ eq: 'loud', quality: 128, normalise: 'yes', audioCache: false }))).toEqual({ eq: 'off', quality: 160, normalise: true, audioCache: false });
  expect(pick(normalize({ eq: 'rnb', quality: 320, normalise: true }))).toEqual({ eq: 'rnb', quality: 320, normalise: true, audioCache: true });
});
