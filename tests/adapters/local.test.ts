// The local adapter with fake host frames: the pure-logic half of tests/shell-smoke.js step 19
// (Now Playing, transport to the host, lyrics, "none"), plus wake, socket loss, the share picker.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, lineAt, lyricsShown, positionNow, DEFAULTS, type AppStore } from '../../src/model';
import { createAdapter } from '../../src/adapters';
import { FakeSocket } from './harness';

const graph = vi.hoisted(() => ({ connected: [] as unknown[], gain: 1 }));
vi.mock('../../src/adapters/local/audio', async (orig) => ({
  ...(await orig<object>()),
  createAnalyserGraph: () => ({
    connect: (n: unknown) => graph.connected.push(n), source: (s: unknown) => ({ stream: s, disconnect() {} }),
    setGain: (g: number) => { graph.gain = g; }, setSmoothing() {}, resume() {}, fill() {}, close() {},
    tone: () => ({ node: {}, stop() {} }), file: () => ({ node: {}, isPaused: () => false, pause() {}, stop() {}, play: () => Promise.resolve() }),
  }),
}));

const ART = 'data:image/svg+xml;base64,AAAA';
const TRACK = { title: 'Windowlicker', artist: 'Aphex Twin', album: 'Windowlicker EP' };
const media = (o: object = {}) => ({ type: 'media', status: 'paused', app: 'Spotify.exe', position: 65, duration: 130, art: ART,
                                     canSeek: true, canNext: true, canPrev: true, ...TRACK, ...o });
const LYR = { type: 'lyrics', status: 'synced', source: 'lrclib', plain: null,
              lines: [{ t: 4, text: 'First line' }, { t: 10, text: 'Second line' }, { t: 16, text: 'Third line' }],
              track: { duration: 130, ...TRACK } };

let store: AppStore, ws: FakeSocket, stop: () => void;
const S = () => store.getState();
const sent = (): { type: string }[] => ws.sent as { type: string }[];

function boot(win: Partial<Window> = {}) {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  Object.assign(window, { alchemyScreensaver: { audio: true, url: 'ws://127.0.0.1:1/audio' } }, win);
  store = createAppStore({ persist: false, settings: { ...DEFAULTS } });
  const ad = createAdapter(store);
  ad.start();
  stop = () => ad.stop();
  ws = FakeSocket.last!;
  ws.onopen?.();
  ws.onmessage?.({ data: '{"rate":48000}' });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => {
  stop();
  delete window.alchemyScreensaver; delete window.alchemyElectron; delete window.alchemyWinFull; delete window.alchemyEngine;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('local adapter: host frames (CONTRACT v4/v5)', () => {
  it('connects: lyricsPref first, the PCM source attached', () => {
    boot();
    expect(ws.url).toBe('ws://127.0.0.1:1/audio');
    expect(sent()).toEqual([{ type: 'lyricsPref', enabled: true }]);
    expect(S().auth).toMatchObject({ engine: 'local', loggedIn: true, mode: 'app' });
    expect(S().playback.capture).toMatchObject({ kind: 'wsaudio', label: 'System audio (local)', paused: false });
    expect(S().ui.status).toBe('System audio (local)');
    const lv = S().vis.level!();
    expect(lv.state).toBe(2);
    expect(lv.freq[0].length).toBe(1024);
  });
  it('a media frame drives playback, the status line and the clock', () => {
    boot();
    ws.host(media());
    const p = S().playback;
    expect([p.status, p.source, p.track!.title, p.track!.artist, p.track!.album, p.track!.art]).toEqual(
      ['paused', 'host', 'Windowlicker', 'Aphex Twin', 'Windowlicker EP', ART]);
    expect([p.position, p.track!.duration, p.canSeek]).toEqual([65_000, 130_000, true]);
    expect(S().ui.status).toBe('Paused: Aphex Twin – Windowlicker');
    ws.host(media({ art: 'http://insecure/x.jpg' }));
    expect(S().playback.track!.art).toBeNull();
    ws.host(media({ status: 'playing', position: 15.5 }));
    expect(S().ui.status).toBe('Playing: Aphex Twin – Windowlicker');
    vi.setSystemTime(1_001_200);
    expect(positionNow(S())).toBe(16_700);          // runs on between frames
  });
  it('track skip, play/pause and seek go to the host as mediaCmd', async () => {
    boot();
    ws.host(media());
    void S().commands.next();
    expect(sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'next' });
    void S().commands.prev();
    expect(sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'prev' });
    void S().commands.playPause();
    expect(sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'playpause' });
    await expect(S().commands.seek(32_500)).resolves.toBeUndefined();
    expect(sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'seek', position: 32.5 });
    expect(S().playback.position).toBe(32_500);
    ws.host(media({ canNext: false }));
    const n = sent().length;
    void S().commands.next();
    expect(sent().length).toBe(n);
  });
  it('play / pause show at once; the next host frame confirms', () => {
    boot();
    ws.host(media({ status: 'playing', position: 10 }));
    void S().commands.playPause();
    expect(sent().pop()).toEqual({ type: 'mediaCmd', cmd: 'playpause' });
    expect([S().playback.status, S().playback.paused, S().playback.pending!.fields]).toEqual(['paused', true, ['status', 'paused', 'position', 'at']]);
    ws.host(media({ status: 'paused', position: 10 }));
    expect([S().playback.status, S().playback.pending]).toEqual(['paused', null]);
    void S().commands.play();
    expect(S().playback.status).toBe('playing');
  });
  it('synced lyrics follow the position; the option hides them and tells the host', () => {
    boot();
    ws.host(LYR);
    ws.host(media({ position: 5 }));
    expect(lyricsShown(S())).toBe('synced');
    const L = S().lyrics.lines!;
    expect(L.map((l) => l.t)).toEqual([4000, 10_000, 16_000]);
    expect(L[lineAt(L, positionNow(S()))]!.text).toBe('First line');
    ws.host(media({ position: 12 }));
    expect(L[lineAt(L, positionNow(S()))]!.text).toBe('Second line');
    S().actions.setLyricsEnabled(false);
    expect(sent().pop()).toEqual({ type: 'lyricsPref', enabled: false });
    expect(lyricsShown(S())).toBeNull();
    S().actions.setLyricsEnabled(true);
    expect(sent().pop()).toEqual({ type: 'lyricsPref', enabled: true });
    ws.host({ ...LYR, status: 'plain', lines: null, plain: 'la la\nla la la' });
    expect([lyricsShown(S()), S().lyrics.plain]).toEqual(['plain', 'la la\nla la la']);
    ws.host({ ...LYR, status: 'none', lines: null });
    expect(lyricsShown(S())).toBeNull();
    ws.host({ ...LYR, track: { title: 'Other', artist: 'Aphex Twin' } });
    expect(lyricsShown(S())).toBeNull();           // they raced a track change
  });
  it('"none" puts the visualizer-only player back; no mediaCmd without a session', () => {
    boot();
    ws.host(media());
    ws.host({ type: 'media', status: 'none' });
    expect(S().playback.status).toBe('none');
    expect(S().playback.track).toBeNull();
    expect(S().playback.capture!.kind).toBe('wsaudio');
    expect(S().ui.status).toBe('System audio (local)');
    const n = sent().length;
    void S().commands.next();
    void S().commands.seek(1000);
    expect(sent().length).toBe(n);
  });
  it('socket loss: session and lyrics cleared, back to the silence animation', () => {
    boot();
    ws.host(media());
    ws.host(LYR);
    ws.close();
    expect(S().playback.status).toBe('none');
    expect(S().lyrics.status).toBe('none');
    expect(S().playback.capture).toBeNull();
    expect(S().ui.status).toBe('No audio — animating');
    expect(S().vis.level!().state).toBe(2);         // animate on
    S().actions.setSettings({ animate: false });
    expect(S().vis.level!().state).toBe(1);
  });
  it('full screen sends wake and moves the host window; never in the screensaver', () => {
    const full: boolean[] = [];
    boot({ alchemyWinFull: (on: boolean) => { full.push(on); } });
    S().actions.setUi({ fullscreen: true });
    S().actions.setUi({ fullscreen: false, bare: true });     // still full: nothing new
    S().actions.setUi({ bare: false });
    expect(sent().filter((m: { type: string }) => m.type === 'wake')).toEqual([{ type: 'wake', on: true }, { type: 'wake', on: false }]);
    expect(full).toEqual([true, false]);
    stop();
    boot({ alchemyElectron: { mode: 'screensaver' } });
    expect(S().auth.mode).toBe('screensaver');
    S().actions.setUi({ fullscreen: true });
    expect(sent().some((m: { type: string }) => m.type === 'wake')).toBe(false);
  });
  it('the volume slider is capture gain', () => {
    boot();
    S().actions.setVolume(150);
    expect(S().settings.volume).toBe(150);
    S().actions.setVolume(null, true);
    expect([S().settings.volume, S().settings.muted]).toEqual([150, true]);
    S().actions.setVolume(80);                                       // dragging while muted unmutes
    expect([S().settings.volume, S().settings.muted]).toEqual([80, false]);
  });
});

describe('local adapter: the browser (no host)', () => {
  function web(getDisplayMedia: () => Promise<unknown>) {
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    store = createAppStore({ persist: false, settings: { ...DEFAULTS } });
    const ad = createAdapter(store);
    ad.start();
    stop = () => ad.stop();
    ws = new FakeSocket('none');
  }
  const track = (kind: string, label = '') => ({ kind, label, stop: vi.fn(), addEventListener: vi.fn() });
  const stream = (tracks: ReturnType<typeof track>[]) => ({
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'), getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getTracks: () => tracks, removeTrack: (t: unknown) => tracks.splice(tracks.indexOf(t as ReturnType<typeof track>), 1),
  });
  it('no source: Play opens the share picker (video too, dropped at once)', async () => {
    const v = track('video'), a = track('audio', 'Tab audio');
    const gdm = vi.fn(() => Promise.resolve(stream([v, a])));
    web(gdm);
    expect(S().auth.mode).toBe('web');
    expect(S().ui.status).toBe('No audio — animating');
    void S().commands.playPause();
    expect(gdm).toHaveBeenCalledWith({ video: true, audio: true });
    await Promise.resolve(); await Promise.resolve();
    expect(v.stop).toHaveBeenCalled();
    expect(S().playback.capture).toMatchObject({ kind: 'display', label: 'Sharing: Tab audio' });
    expect(S().ui.status).toBe('Sharing: Tab audio');
    // Play again pauses the capture (the clock holds), and again resumes it
    vi.setSystemTime(1_002_000);
    void S().commands.playPause();
    expect(S().playback.capture).toMatchObject({ paused: true, acc: 2000 });
    expect(S().ui.status).toBe('Paused');
    expect(S().vis.level!().state).toBe(1);
    void S().commands.playPause();
    expect(S().playback.capture!.paused).toBe(false);
    // "Stop sharing" ends the track: back to silence
    const ended = a.addEventListener.mock.calls.find((c) => c[0] === 'ended')![1] as () => void;
    ended();
    expect(S().playback.capture).toBeNull();
    expect(a.stop).toHaveBeenCalled();
  });
  it('a share without audio says so; a cancelled picker leaves the instructions', async () => {
    web(() => Promise.resolve(stream([track('video')])));
    await S().commands.startCapture();
    expect(S().ui.status).toBe('No audio in that share — share again with "Share audio" ticked');
    stop();
    web(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })));
    await S().commands.startCapture();
    expect(S().ui.status).toBe('Choose a tab or your screen and tick "Share audio"');
  });
});
