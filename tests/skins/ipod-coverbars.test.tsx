// Cover Bars on the iPod's Now Playing: a choice of Visualizer… that keeps the cover and draws Bars and
// Waves' Bars over it, tinted to the cover's accent (node-vibrant mocked: its palette is set here).
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { tintMatrix } from '../../src/skins/ipod/screens/nowplaying/accent';
import { NavContext } from '../../src/skins/ipod/wheel';
import { fakeData, mountSkinNow, settle } from './harness';

const from = vi.hoisted(() => vi.fn<(url: string) => unknown>(() => ({ maxDimension: () => ({ getPalette: () => Promise.resolve({
  Vibrant: { rgb: [230, 40, 40], population: 50 }, DarkMuted: { rgb: [20, 20, 30], population: 900 }, Muted: null }) }) })));
vi.mock('node-vibrant/browser', () => ({ Vibrant: { from } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('Cover Bars: the cover stays and Bars draws over it, tinted to its accent; WMP\'s own visualization back after; no cover: plain Bars', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  const np = m.getByTestId('np'), options = () => [...np.querySelectorAll('[role=option]')];
  const pick = (label: string) => act(() => { fireEvent.click(options().find((x) => x.textContent === label)!); });
  const play = async (uri: string, art?: string) => {
    act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: { uri, title: 'T', artist: 'A', duration: 100_000, art } } })); });
    await settle();
  };
  const ART = 'https://i.scdn.co/image/abc';
  act(() => m.store.getState().actions.setVis('battery', 3));   // the WMP 9 skin's own choice
  await play('spotify:track:a', ART);
  act(() => { fireEvent.click(within(np).getByRole('button', { name: 'Options' })); });
  pick('Visualizer…');
  expect(options().map((x) => x.textContent)).toEqual(['Cover Bars', 'Alchemy', 'Bars and WavesBars', 'Battery']);
  pick('Cover Bars');
  await settle();
  const over = np.querySelector<HTMLElement>('[class*=overart]');
  expect([localStorage.getItem('ipod.visualizer'), np.querySelector('img[class*=art]')?.getAttribute('src'), !!over?.querySelector('canvas')])
    .toEqual(['"cover-bars"', ART, true]);
  expect([m.S().vis.kind, m.S().vis.preset]).toEqual(['bars', 0]);   // Bars and Waves' Bars is in effect
  expect(from).toHaveBeenCalledWith(ART);
  // the tint: the accent's matrix, in the page's own tree and in the document
  expect(over!.style.filter).toContain('#ipod-cover-bars');
  const filters = [...document.querySelectorAll('#ipod-cover-bars feColorMatrix')];
  expect([filters.length, filters.filter((f) => np.contains(f)).length]).toEqual([2, 1]);
  expect(filters.map((f) => f.getAttribute('values'))).toEqual([tintMatrix('#e62828'), tintMatrix('#e62828')]);
  act(() => { fireEvent.click(within(np).getByRole('button', { name: 'Options' })); });
  pick('Visualizer…');
  pick('Cover Bars✓');                               // checked; picked again, it closes
  expect(options()).toEqual([]);

  await play('spotify:track:none');                  // no cover: the plain Bars, the whole screen, untinted
  expect([!!np.querySelector('[class*=overart]'), !!np.querySelector('[class*=noart]'), !!np.querySelector('canvas'), m.S().vis.kind])
    .toEqual([false, false, true, 'bars']);
  expect(document.querySelector('#ipod-cover-bars')).toBeNull();
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // away from the visualizer
  expect([m.S().vis.kind, m.S().vis.preset]).toEqual(['battery', 3]);
});
