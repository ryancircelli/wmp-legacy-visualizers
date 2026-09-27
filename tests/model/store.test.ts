import { describe, expect, it, beforeEach } from 'vitest';
import {
  createAppStore, DEFAULTS, LS_KEY, totalMs, loadSettings, normalize, positionNow, captureElapsed, lyricsShown, lineAt,
  wordTimes, wordAt, mss, mmss, trackLabel, trackName,
} from '../../src/model';

const track = { uri: 'spotify:track:x', title: 'Windowlicker', artist: 'Aphex Twin', album: 'EP', duration: 130_000 };

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the old key and shape; defaults when nothing is saved', () => {
    expect(LS_KEY).toBe('alchemy.settings');
    expect(loadSettings()).toEqual(DEFAULTS);
  });
  it('normalises an old blob: drops frame keys, clamps, keeps unknown flags', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ fps: 33, vis: 'nope', preset: 9, volume: 500, frame: 'x', frameSet: 1,
      remaining: true, taskPane: false, view: 'library', lyrics: false, animate: 0 }));
    const s = loadSettings() as unknown as Record<string, unknown>;
    expect(s.fps).toBe(60);
    expect(s.vis).toBe('alchemy');
    expect(s.preset).toBe(3);
    expect(s.volume).toBe(200);
    expect('frame' in s || 'frameSet' in s).toBe(false);
    expect([s.remaining, s.taskPane, s.view, s.lyrics, s.animate]).toEqual([true, false, 'library', false, true]);
    expect(s.skin).toBe('wmp9');
    expect([s.detailsPane, s.libraryView, s.karaoke]).toEqual([true, 'details', true]);
    expect(normalize({ karaoke: false }).karaoke).toBe(false);
    expect(normalize({ view: 'devices' }).view).toBe('now');
    expect(normalize({ view: 'search' }).view).toBe('search');
    expect([normalize({ detailsPane: false, libraryView: 'tiles' }).detailsPane, normalize({ libraryView: 'tiles' }).libraryView,
            normalize({ libraryView: 'bogus' }).libraryView]).toEqual([false, 'tiles', 'details']);
  });
  it('battery presets clamp to 25; a corrupt blob falls back to defaults', () => {
    expect(normalize({ vis: 'battery', preset: 40 }).preset).toBe(25);
    localStorage.setItem(LS_KEY, '{nope');
    expect(loadSettings()).toEqual(DEFAULTS);
  });
  it('the desktop host starts a first run on Battery', () => {
    (window as { alchemyElectron?: object }).alchemyElectron = { mode: 'app' };
    try { expect([loadSettings().vis, loadSettings().preset]).toEqual(['battery', 0]); }
    finally { delete (window as { alchemyElectron?: object }).alchemyElectron; }
  });
  it('the store persists every settings change', () => {
    const st = createAppStore();
    st.getState().actions.setVolume(40);
    expect((JSON.parse(localStorage.getItem(LS_KEY)!) as { volume: number }).volume).toBe(40);
    st.getState().actions.setKaraoke(false);
    expect((JSON.parse(localStorage.getItem(LS_KEY)!) as { karaoke: boolean }).karaoke).toBe(false);
    expect(st.getState().settings.lyrics).toBe(true);                // independent of lyrics
  });
});

describe('store actions', () => {
  const mk = () => createAppStore({ persist: false });

  it('initial slices: fetched data is not state (TanStack Query holds it)', () => {
    const s = mk().getState();
    expect(s.playback.status).toBe('none');
    expect(s.playback.pending).toBeNull();
    expect(s.ui).toMatchObject({ view: 'now', libNode: null, libSel: null, searchQ: '' });
    expect(s.vis.hold).toBe(false);
    expect(Object.keys(s).sort()).toEqual(['actions', 'auth', 'commands', 'devices', 'lyrics', 'membership', 'playback', 'queue', 'saved', 'settings', 'ui', 'vis']);
  });
  it('setView holds the engine off Now Playing, saves the view, unknown -> now', () => {
    const st = mk();
    st.getState().actions.setView('library');
    expect([st.getState().ui.view, st.getState().vis.hold, st.getState().settings.view]).toEqual(['library', true, 'library']);
    st.getState().actions.setView('bogus');
    expect([st.getState().ui.view, st.getState().vis.hold]).toEqual(['now', false]);
  });
  it('setVolume clamps (200 local, 100 spotify), unmutes; mute alone keeps the volume', () => {
    const st = mk(), a = st.getState().actions;
    a.setVolume(null, true);
    expect([st.getState().settings.volume, st.getState().settings.muted]).toEqual([100, true]);
    a.setVolume(250);
    expect([st.getState().settings.volume, st.getState().settings.muted]).toEqual([200, false]);
    a.setAuth({ engine: 'spotify' });
    a.setVolume(150);
    expect(st.getState().settings.volume).toBe(100);
    a.setVolume(-5);
    expect(st.getState().settings.volume).toBe(0);
  });
  it('totalMs sums the tracks given', () => {
    expect(totalMs([{ duration: 1000 }, { duration: 2500 }])).toBe(3500);
    expect(totalMs(undefined)).toBe(0);
  });
  it('setVis clamps the preset and mirrors into settings', () => {
    const st = mk();
    st.getState().actions.setVis('bars', 9);
    expect([st.getState().vis.kind, st.getState().vis.preset, st.getState().settings.vis, st.getState().settings.preset]).toEqual(['bars', 3, 'bars', 3]);
  });
  it('subscribeWithSelector is on', () => {
    const st = mk(), seen: string[] = [];
    st.subscribe((s) => s.ui.view, (v) => seen.push(v));
    st.getState().actions.setStatus('x');
    st.getState().actions.setView('radio');
    expect(seen).toEqual(['radio']);
  });
});

describe('selectors', () => {
  it('positionNow extrapolates while playing, stands still paused, caps at the duration', () => {
    const st = createAppStore({ persist: false }), a = st.getState().actions;
    expect(positionNow(st.getState(), 5)).toBe(0);
    a.setPlayback({ status: 'playing', paused: false, track, position: 10_000, at: 1000 });
    expect(positionNow(st.getState(), 3000)).toBe(12_000);
    expect(positionNow(st.getState(), 1e9)).toBe(130_000);
    a.setPlayback({ status: 'paused' });
    expect(positionNow(st.getState(), 3000)).toBe(10_000);
  });
  it('captureElapsed', () => {
    const st = createAppStore({ persist: false });
    st.getState().actions.setPlayback({ capture: { kind: 'x', label: 'x', paused: false, acc: 500, from: 1000 } });
    expect(captureElapsed(st.getState(), 3000)).toBe(2500);
  });
  it('labels and clocks', () => {
    expect(trackLabel(track)).toBe('Windowlicker – Aphex Twin');
    expect(trackName(track)).toBe('Aphex Twin – Windowlicker');
    expect(mss(275_000)).toBe('4:35');
    expect(mmss(65_900)).toBe('01:05');
  });
  it('lyrics: shown only on, with a session, for its own track', () => {
    const st = createAppStore({ persist: false }), a = st.getState().actions;
    a.setLyrics({ status: 'synced', lines: [{ t: 4000, text: 'a' }], plain: null, track: { title: 'Windowlicker', artist: 'Aphex Twin' } });
    expect(lyricsShown(st.getState())).toBeNull();
    a.setPlayback({ status: 'paused', track });
    expect(lyricsShown(st.getState())).toBe('synced');
    a.setLyricsEnabled(false);
    expect(lyricsShown(st.getState())).toBeNull();
    a.setLyricsEnabled(true);
    a.setPlayback({ track: { ...track, title: 'Other' } });
    expect(lyricsShown(st.getState())).toBeNull();
  });
  it('line and karaoke word timing (shell-smoke step 19)', () => {
    const L = [{ t: 4000, text: 'First line' }, { t: 10_000, text: 'Second line' }, { t: 16_000, text: 'Third line' }];
    expect(lineAt(L, 3000)).toBe(-1);
    expect(lineAt(L, 5000)).toBe(0);
    expect(lineAt(L, 12_000)).toBe(1);
    const w = wordTimes(L, 0);
    // 'First line' spread over 1.92 s from t 4: 'First' fills until 5.05 s, then 'line'
    expect(w.map((x) => x.text)).toEqual(['First', 'line']);
    expect(w[0]!.end).toBeCloseTo(4000 + 6 * (1920 / 11), 6);
    expect(wordAt(w, 5000)).toBe(0);
    expect(wordAt(w, 5500)).toBe(1);
    const stamped = wordTimes([{ t: 0, text: 'a b', words: [{ t: 0, text: 'a' }, { t: 300, text: 'b' }] }], 0);
    expect(stamped).toEqual([{ text: 'a', t: 0, end: 300 }, { text: 'b', t: 300, end: 5000 }]);
  });
});
