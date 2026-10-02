// Cover Bars on the iPod's Now Playing: a choice of Visualizer… that keeps the cover and draws Bars and
// Waves' Bars over it in the cover's accent: the engine's canvas hidden, a copy of it tinted every frame.
// node-vibrant, fetch, the canvases' contexts and the animation frames are stand-ins here.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { NavContext } from '../../src/skins/ipod/wheel';
import { fakeData, mountSkinNow, settle } from './harness';

const from = vi.hoisted(() => vi.fn<(url: string) => unknown>(() => ({ maxDimension: () => ({ getPalette: () => Promise.resolve({
  Vibrant: { rgb: [230, 40, 40], population: 50 }, DarkMuted: { rgb: [20, 20, 30], population: 900 }, Muted: null }) }) })));
vi.mock('node-vibrant/browser', () => ({ Vibrant: { from } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

it('Cover Bars: the cover stays, the engine\'s canvas draws unseen, its copy is tinted to the cover\'s accent every frame until it goes; no cover: plain Bars', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  // the animation frames, run by hand
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.set(++id, f); return id; });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => { frames.delete(n); });
  const tick = () => act(() => { const fs = [...frames.values()]; frames.clear(); for (const f of fs) f(0); });
  // the canvases' 2D contexts: the engine's frame is black with one Bars-green pixel
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
                getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
                  const data = new Uint8ClampedArray(w * h * 4);
                  data.set([0, 0, 0, 255, 0xa4, 0xeb, 0x0c, 255]);
                  return { data, width: w, height: h };
                }) };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
  // the cover fetched again for its pixels
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
  const over = np.querySelector<HTMLElement>('[class*=overart]')!;
  const [engine, copy] = [...over.querySelectorAll('canvas')];
  expect([localStorage.getItem('ipod.visualizer'), np.querySelector('img[class*=art]')?.getAttribute('src')]).toEqual(['"cover-bars"', ART]);
  expect([engine?.className, copy?.className]).toEqual([expect.stringContaining('source'), expect.stringContaining('tinted')]);
  expect([m.S().vis.kind, m.S().vis.preset]).toEqual(['bars', 0]);   // Bars and Waves' Bars is in effect
  // the engine's canvas claimed for its 2D path; the accent from the cover's own fetch, logged
  expect(getContext.mock.contexts.indexOf(engine!)).toBeGreaterThanOrEqual(0);
  expect(getContext.mock.calls[getContext.mock.contexts.indexOf(engine!)]![0]).toBe('2d');
  expect([vi.mocked(fetch).mock.calls[0]![0], from.mock.calls[0]![0]]).toEqual([ART, 'blob:cover']);
  expect(log).toHaveBeenCalledWith('ipod: cover bars accent #e62828 (Vibrant)');
  // a frame: the engine's canvas copied, each pixel the accent with its brightness as alpha
  ctx.putImageData.mockClear();
  tick();
  expect(ctx.drawImage.mock.calls.at(-1)![0]).toBe(engine);
  const put = ctx.putImageData.mock.calls.at(-1)![0] as { data: Uint8ClampedArray };
  expect([...put.data.slice(0, 8)]).toEqual([230, 40, 40, 0, 230, 40, 40, 255]);
  tick();
  expect(ctx.putImageData).toHaveBeenCalledTimes(2);   // every frame

  await play('spotify:track:b', 'https://i.scdn.co/image/bad');   // a cover that cannot be read: white, logged
  expect(log).toHaveBeenLastCalledWith('ipod: cover bars accent #ffffff (cover not readable: Load failed)');
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // away from the visualizer: the copying stops
  ctx.putImageData.mockClear();
  tick();
  expect([ctx.putImageData.mock.calls.length, !!np.querySelector('[class*=overart]'), m.S().vis.kind, m.S().vis.preset]).toEqual([0, false, 'battery', 3]);
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // no Canvas: straight back to Cover Bars

  await play('spotify:track:none');                  // no cover: the plain Bars, the whole screen, no copy
  ctx.putImageData.mockClear();
  tick();
  expect([!!np.querySelector('[class*=overart]'), np.querySelectorAll('canvas').length, ctx.putImageData.mock.calls.length, m.S().vis.kind])
    .toEqual([false, 1, 0, 'bars']);
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // back to the Canvas for the tests after
});
