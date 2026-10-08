// The iPod's Now Playing visualizer, an overlay over the art (Visualizer… > Visualizer, on at first):
// the engine's 'luma' output (vis.alpha / vis.tint, which the ticker hands the engine) over the whole
// area under the status row, over the cover, the Canvas or the black; Bars and Waves in the cover's
// accent over either, Alchemy and Battery in their own colours; Opacity its layer's. What earlier builds
// stored, read as it is now. node-vibrant and fetch are stand-ins here.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { migrateCanvasPref } from '../../src/skins/ipod/screens/nowplaying/NowPlaying';
import { migrateVisPrefs, readPref, writePref } from '../../src/skins/ipod/screens/settings/prefs';
import { NavContext } from '../../src/skins/ipod/wheel';
import { fakeData, mountSkinNow, settle } from './harness';

const from = vi.hoisted(() => vi.fn<(url: string) => unknown>(() => ({ maxDimension: () => ({ getPalette: () => Promise.resolve({
  Vibrant: { rgb: [230, 40, 40], population: 50 }, DarkMuted: { rgb: [20, 20, 30], population: 900 }, Muted: null }) }) })));
vi.mock('node-vibrant/browser', () => ({ Vibrant: { from } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

/** Now Playing alone; a track `play`ed with a cover or none, with a Canvas when its uri ends in 'c' */
function atNowPlaying() {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const log = vi.fn();
  vi.stubGlobal('alchemyLog', log);
  vi.stubGlobal('fetch', vi.fn((url: string) => (url.endsWith('bad') ? Promise.reject(new TypeError('Load failed'))
    : Promise.resolve(new Response(new Blob(['jpeg']))))));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  m.queries.fetchCanvas.mockImplementation((uri) => Promise.resolve(uri.endsWith('c') ? { url: uri + '.mp4', type: 'video' } : null));
  const np = m.getByTestId('np'), options = () => [...np.querySelectorAll('[role=option]')];
  const row = (label: string) => options().find((x) => x.textContent?.startsWith(label))!;
  return {
    ...m, np, log, options, row,
    pick: (label: string) => act(() => { fireEvent.click(row(label)); }),
    menu: () => { act(() => { fireEvent.click(within(np).getByRole('button', { name: 'Options' })); }); act(() => { fireEvent.click(row('Visualizer…')); }); },
    play: async (uri: string, art?: string) => {
      act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: { uri, title: 'T', artist: 'A', duration: 100_000, art } } })); });
      await settle();
    },
    /** the overlay's box: the whole area under the status row, whatever the art */
    box: () => np.querySelector('[class*=overlay]')?.className.match(/overlay/)?.[0] ?? null,
    layer: () => np.querySelector<HTMLElement>('[class*=overlay]'),
    out: () => [m.S().vis.alpha, m.S().vis.tint],
  };
}

it('the overlay: over the cover and over the Canvas, Bars in the cover\'s accent, Alchemy in its own colours; over the black with no cover; off: none, the output opaque, WMP\'s own visualization back', async () => {
  const m = atNowPlaying();
  const ART = 'https://i.scdn.co/image/abc';
  await m.play('spotify:track:a', ART);              // a cover, no Canvas: over the cover's rectangle
  expect([m.np.querySelector('img[class*=art]')?.getAttribute('src'), m.box(), ...m.out()]).toEqual([ART, 'overlay', 'luma', [230, 40, 40]]);
  expect([vi.mocked(fetch).mock.calls[0]![0], from.mock.calls[0]![0]]).toEqual([ART, 'blob:cover']);
  expect(m.log).toHaveBeenCalledWith('ipod: over cover accent #e62828 (Vibrant)');
  await m.play('spotify:track:c', ART);              // a Canvas: over it, the whole area, the accent still the cover's
  expect([!!m.np.querySelector('video'), m.box(), ...m.out()]).toEqual([true, 'overlay', 'luma', [230, 40, 40]]);
  m.menu();
  m.pick('Alchemy');                                 // Alchemy: its own colours; its canvas the whole area always
  expect([m.S().vis.kind, m.box(), ...m.out()]).toEqual(['alchemy', 'overlay', 'luma', null]);
  await m.play('spotify:track:x');                   // neither: over the black, the whole area, no ♪ tile
  expect([!!m.np.querySelector('[class*=noart]'), m.box(), ...m.out()]).toEqual([false, 'overlay', 'luma', null]);
  m.menu();
  m.pick('Bars and Waves');
  m.pick('Bars');
  expect([m.box(), ...m.out()]).toEqual(['overlay', 'luma', null]);   // Bars over the black: its own green
  await m.play('spotify:track:b', 'https://i.scdn.co/image/bad');     // a cover that cannot be read: white, logged
  expect([m.log.mock.calls.at(-1)![0], m.S().vis.tint]).toEqual(['ipod: over cover accent #ffffff (cover not readable: Load failed)', [255, 255, 255]]);
  m.menu();
  m.pick('VisualizerOn');                            // off: no overlay, the output opaque
  expect([m.box(), !!m.np.querySelector('canvas'), ...m.out()]).toEqual([null, false, 'opaque', null]);
});

it('Opacity (dim while the overlay is off), 50 by default, steps 50 -> 25 -> 100 -> 75 -> 50 with the list kept open; the layer follows over the cover and over the Canvas', async () => {
  const m = atNowPlaying();
  await m.play('spotify:track:a', 'https://i.scdn.co/image/abc');
  m.menu();
  expect([m.row('Opacity').textContent, m.row('Opacity').getAttribute('aria-disabled')]).toEqual(['Opacity50%', null]);
  const steps: [string, string][] = [];
  for (let k = 0; k < 4; k++) { m.pick('Opacity'); steps.push([m.row('Opacity').textContent ?? '', m.layer()!.style.opacity]); }
  expect(steps).toEqual([['Opacity25%', '0.25'], ['Opacity100%', ''], ['Opacity75%', '0.75'], ['Opacity50%', '0.5']]);
  m.pick('Opacity');
  expect(readPref('ipod.visOpacity', 50)).toBe(25);
  await m.play('spotify:track:c', 'https://i.scdn.co/image/abc');   // over the Canvas: the same
  expect([m.box(), m.layer()?.style.opacity, m.layer()?.style.filter]).toEqual(['overlay', '0.25', 'saturate(3.25)']);   // thinner, and its colour stronger
  m.pick('Visualizer');                              // off: the row dim, the setting kept
  expect([m.layer(), m.row('Opacity').getAttribute('aria-disabled'), m.row('Opacity').textContent]).toEqual([null, 'true', 'Opacity25%']);
  m.pick('Visualizer');
  expect(m.layer()?.style.opacity).toBe('0.25');
});

it('black (the tap\'s third art): WMP\'s own look, no art, no reflection, the visualization opaque, untinted, at full strength (Opacity kept but not applied, not dimmed); the next tap brings the art back as it was', async () => {
  const m = atNowPlaying();
  const ART = 'https://i.scdn.co/image/abc';
  const shown = () => [!!m.np.querySelector('img[class*=art]'), m.np.querySelectorAll('[class*=reflection]').length, !!m.np.querySelector('video'),
                       m.np.firstElementChild!.hasAttribute('data-canvas')];   // the bands' translucent look
  const tap = () => act(() => { fireEvent.click(m.np.querySelector('[class*=tap]')!); });
  await m.play('spotify:track:a', ART);              // no Canvas: the cover, Bars in its accent
  expect([...m.out(), ...shown(), m.layer()?.style.opacity, m.layer()?.style.filter]).toEqual(['luma', [230, 40, 40], true, 2, false, false, '0.5', 'saturate(2.5)']);
  tap();                                             // black
  expect([...m.out(), ...shown(), m.layer()?.style.opacity, m.layer()?.style.filter, !!m.np.querySelector('canvas')])
    .toEqual(['opaque', null, false, 0, false, true, '', '', true]);
  m.menu();
  expect([m.options().map((x) => x.textContent), m.row('Opacity').getAttribute('aria-disabled')])
    .toEqual([['VisualizerOn', 'Opacity50%', 'Alchemy', 'Bars and WavesBars', 'Battery', 'Particle', 'Plenoptic', 'Spikes'], null]);   // no Background row; Opacity as ever
  m.pick('Opacity');                                 // stepped: kept for the art, not applied here
  expect([readPref('ipod.visOpacity', 50), m.layer()?.style.opacity]).toEqual([25, '']);
  act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
  tap();                                             // back: the cover (no Canvas), the tint, the opacity
  expect([...m.out(), ...shown(), m.layer()?.style.opacity]).toEqual(['luma', [230, 40, 40], true, 2, false, false, '0.25']);
});

it('a stored opacity that is not 100, 75, 50 or 25 reads as 50', () => {
  localStorage.setItem('ipod.visOpacity', '60');
  const m = atNowPlaying();
  m.menu();
  expect(m.row('Opacity').textContent).toBe('Opacity50%');
  localStorage.setItem('ipod.visOpacity', '"half"');
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ipod.visOpacity' })); });
  expect(m.row('Opacity').textContent).toBe('Opacity50%');
});

it('what earlier builds stored: Cover Bars is Bars with the overlay on; the tap cycle\'s visualizer and Over Cover are the overlay on (the art the cover), Over Cover\'s key gone', () => {
  localStorage.setItem('ipod.visualizer', JSON.stringify('cover-bars'));
  migrateVisPrefs();
  expect([readPref('ipod.visualizer', 'bars:0'), readPref('ipod.visOn', true)]).toEqual(['bars:0', true]);
  localStorage.clear();
  localStorage.setItem('ipod.visOn', 'false');
  localStorage.setItem('ipod.canvas', JSON.stringify({ state: { show: 'vis' }, version: 1 }));
  migrateVisPrefs();
  expect([readPref('ipod.visOn', true), migrateCanvasPref({ show: 'vis' }, 1), migrateCanvasPref({ show: 'video' }, 1), migrateCanvasPref({ on: false }, 0)])
    .toEqual([true, { show: 'cover' }, { show: 'video' }, { show: 'cover' }]);
  localStorage.clear();
  localStorage.setItem('ipod.visOn', 'false');
  localStorage.setItem('ipod.visOverCover', 'true');
  migrateVisPrefs();
  expect([readPref('ipod.visOn', true), localStorage.getItem('ipod.visOverCover')]).toEqual([true, null]);
});

it('two buttons over the art: ♪ (top-left) opens the track\'s menu, without the page options, with Playlist… when a playlist plays (its own Browse and Start Radio); ⋯ (top-right) the page options', async () => {
  const m = atNowPlaying();
  m.data.collections['spotify:playlist:pl'] = { meta: { name: 'Lawn', uri: 'spotify:playlist:pl' } as never, tracks: [] };
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing',
    track: { uri: 'spotify:track:x', title: 'T', artist: 'A', duration: 100_000, ctx: 'spotify:playlist:pl', albumUri: 'spotify:album:al' } } })); });
  await settle();
  act(() => { fireEvent.click(within(m.np).getByRole('button', { name: 'Track' })); });
  expect(m.options().map((x) => x.textContent)).toEqual(['Start Radio', 'Add to Playlist…', 'Like', 'Browse Album', 'Browse Artist', 'Playlist…', 'Cancel']);
  m.pick('Playlist…');
  expect(m.options().map((x) => x.textContent)).toEqual(['Browse Playlist', 'Playlist Radio', 'Cancel']);
  m.pick('Browse Playlist');
  await settle();
  expect(m.np.querySelector('[role=listbox]')).toBeNull();      // the popup closed; the playlist's screen was pushed
  act(() => { fireEvent.click(within(m.np).getByRole('button', { name: 'Options' })); });
  expect(m.options().map((x) => x.textContent)).toEqual(['Play On…', 'Visualizer…', 'LyricsOn', 'KaraokeOn', 'Cancel']);
});

it('Bars, Ocean Mist and Fire Storm start under the info band (their peaks mid-screen); Scope and the engines fill the area', async () => {
  const m = atNowPlaying();
  await m.play('spotify:track:x');
  const rising = () => /rising/.test(m.layer()?.className ?? '');
  expect(rising()).toBe(true);                       // Bars, the default
  for (const [id, want] of [['bars:1', true], ['bars:2', true], ['bars:3', false], ['alchemy:0', false], ['battery:0', false]] as const) {
    act(() => writePref('ipod.visualizer', id));
    expect([id, rising()]).toEqual([id, want]);
  }
});
