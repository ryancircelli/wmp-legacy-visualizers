// Over Cover on the iPod's Now Playing (Visualizer… > Over Cover): the cover stays and the chosen
// visualization draws over it through the engine's 'luma' output (vis.alpha / vis.tint, which the ticker
// hands the engine), Bars and Waves in the cover's accent, Alchemy and Battery in their own colours.
// node-vibrant and fetch are stand-ins here.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { migrateVisPrefs, readPref } from '../../src/skins/ipod/screens/settings/prefs';
import { NavContext } from '../../src/skins/ipod/wheel';
import { fakeData, mountSkinNow, settle } from './harness';

const from = vi.hoisted(() => vi.fn<(url: string) => unknown>(() => ({ maxDimension: () => ({ getPalette: () => Promise.resolve({
  Vibrant: { rgb: [230, 40, 40], population: 50 }, DarkMuted: { rgb: [20, 20, 30], population: 900 }, Muted: null }) }) })));
vi.mock('node-vibrant/browser', () => ({ Vibrant: { from } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

it('Over Cover: the cover stays and the visualization draws over it with the engine\'s luma output, Bars in the cover\'s accent, Alchemy in its own colours; off, or no cover: opaque as ever', async () => {
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
  const np = m.getByTestId('np'), options = () => [...np.querySelectorAll('[role=option]')];
  const pick = (label: string) => act(() => { fireEvent.click(options().find((x) => x.textContent === label)!); });
  const menu = () => { act(() => { fireEvent.click(within(np).getByRole('button', { name: 'Options' })); }); pick('Visualizer…'); };
  const play = async (uri: string, art?: string) => {
    act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: { uri, title: 'T', artist: 'A', duration: 100_000, art } } })); });
    await settle();
  };
  const out = () => [m.S().vis.alpha, m.S().vis.tint];
  const ART = 'https://i.scdn.co/image/abc';
  act(() => m.store.getState().actions.setVis('battery', 3));   // the WMP 9 skin's own choice
  await play('spotify:track:a', ART);
  menu();
  expect(options().map((x) => x.textContent)).toEqual(['Over CoverOff', 'Alchemy', 'Bars and WavesBars', 'Battery']);
  pick('Over CoverOff');                             // on: and the visualizer on screen
  await settle();
  const over = np.querySelector<HTMLElement>('[class*=overart]');
  expect([readPref('ipod.visOverCover', false), np.querySelector('img[class*=art]')?.getAttribute('src'),
          over?.querySelectorAll('canvas').length, over?.querySelector('canvas')?.className]).toEqual([true, ART, 1, expect.stringContaining('clear')]);
  expect([m.S().vis.kind, m.S().vis.preset]).toEqual(['bars', 0]);
  expect(out()).toEqual(['luma', [230, 40, 40]]);    // Bars and Waves: the accent
  expect([vi.mocked(fetch).mock.calls[0]![0], from.mock.calls[0]![0]]).toEqual([ART, 'blob:cover']);
  expect(log).toHaveBeenCalledWith('ipod: over cover accent #e62828 (Vibrant)');
  menu();
  expect(options()[0]!.textContent).toBe('Over CoverOn');
  pick('Alchemy');                                   // another engine: its own colours, still over the cover
  // (Alchemy's box is the whole area, clipped to the cover: overclip; Bars and Waves' the cover's: overart)
  expect([m.S().vis.kind, ...out(), !!np.querySelector('[class*=overclip]')]).toEqual(['alchemy', 'luma', null, true]);
  menu();
  pick('Over CoverOn');                              // off: the visualizer opaque, the whole area
  expect([...out(), !!np.querySelector('[class*=overart], [class*=overclip]'), !!np.querySelector('canvas[class*=vis]')]).toEqual(['opaque', null, false, true]);
  menu();
  pick('Over CoverOff');
  menu();
  pick('Bars and Waves');                            // the engine row (Alchemy chosen: it names no preset)
  pick('Ocean Mist');
  expect([m.S().vis.kind, m.S().vis.preset, ...out()]).toEqual(['bars', 1, 'luma', [230, 40, 40]]);

  await play('spotify:track:b', 'https://i.scdn.co/image/bad');   // a cover that cannot be read: white, logged
  expect([log.mock.calls.at(-1)![0], m.S().vis.tint]).toEqual(['ipod: over cover accent #ffffff (cover not readable: Load failed)', [255, 255, 255]]);
  await play('spotify:track:none');                  // no cover: opaque, the whole area
  expect([...out(), !!np.querySelector('[class*=overart], [class*=overclip]'), !!np.querySelector('canvas')]).toEqual(['opaque', null, false, true]);
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // away from the visualizer
  expect([m.S().vis.kind, m.S().vis.preset, ...out()]).toEqual(['battery', 3, 'opaque', null]);
});

it('a stored Cover Bars is Bars with Over Cover on', () => {
  localStorage.setItem('ipod.visualizer', JSON.stringify('cover-bars'));
  migrateVisPrefs();
  expect([readPref('ipod.visualizer', ''), readPref('ipod.visOverCover', false)]).toEqual(['bars:0', true]);
});
