// The iPod's Now Playing goes quiet after QUIET_MS without input while it plays: nothing moves or goes,
// the info band thins to .3, the controls band's background goes (its reflection stays) and the ⋯ fades out (CSS on data-quiet; the look is
// checked in Chromium against the original build); any input wakes it, a tap on the screen, a wheel turn
// or an arrow key doing nothing else, the wheel's buttons acting as ever. The visualizer overlay is the
// whole area in both views; the minimized view's bar and mirrors are gone.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Root } from '../../src/skins/ipod/Root';
import { QUIET_MS } from '../../src/skins/ipod/screens/nowplaying/logic';
import { fakeData, mountSkinNow, settle } from './harness';

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** the iPod on Now Playing, a track playing from 25 s of 100 */
function atNowPlaying() {
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  const play = (uri: string, title: string, status: 'playing' | 'paused' = 'playing', art?: string) => act(() => {
    m.store.setState((s) => ({ playback: { ...s.playback, status, paused: status === 'paused', position: 25_000, at: Date.now(), canSeek: true,
                                           track: { uri, title, artist: 'Band', duration: 100_000, art } } }));
  });
  play('spotify:track:a', 'Song');
  act(() => { fireEvent.click(m.getByTestId('ipod').querySelector('[aria-label="Now Playing"][role=button]')!); });
  const np = () => m.getByTestId('ipod').querySelector<HTMLElement>('[class*=root]:has([class*=controls])')!;
  return { ...m, play, np, quiet: () => np().hasAttribute('data-quiet') };
}

it('goes quiet after QUIET_MS without input while it plays: nothing added, moved or taken away (the cover\'s reflection too), the title and the progress where they were; a track change keeps it so', () => {
  const m = atNowPlaying();
  m.play('spotify:track:a', 'Song', 'playing', 'https://i.scdn.co/image/abc');
  const reflection = () => m.np().querySelector('[class*=reflection]')?.getAttribute('src') ?? null;
  expect([reflection(), m.np().hasAttribute('data-canvas')]).toEqual(['https://i.scdn.co/image/abc', false]);   // the cover's view
  const before = m.np().querySelectorAll('*').length;
  expect(QUIET_MS).toBe(5000);
  wait(QUIET_MS - 1);
  expect(m.quiet()).toBe(false);
  wait(1);
  expect(m.quiet()).toBe(true);
  // the same elements: the info lines, the progress row, the ⋯ (faded by CSS), no bar, no mirror
  expect([m.np().querySelector('[class*=title]')?.textContent, !!m.np().querySelector('[class*=row] [class*=track]'),
          !!within(m.np()).queryByRole('button', { name: 'Options' }), within(m.np()).queryByRole('button', { name: 'Now Playing' }),
          m.np().querySelector('[class*=mirror], [class*=foot]')]).toEqual(['Song', true, true, null, null]);
  expect([m.np().querySelectorAll('*').length, reflection()]).toEqual([before, 'https://i.scdn.co/image/abc']);   // the same elements
  m.play('spotify:track:b', 'Next One');             // the next track: still quiet, its title shown
  expect([m.quiet(), m.np().querySelector('[class*=title]')?.textContent]).toEqual([true, 'Next One']);
});

it('not while paused, nor with a popup open; pausing wakes it', () => {
  const m = atNowPlaying();
  wait(QUIET_MS);
  expect(m.quiet()).toBe(true);
  m.play('spotify:track:a', 'Song', 'paused');       // paused: awake, and it stays so
  expect(m.quiet()).toBe(false);
  wait(QUIET_MS * 2);
  expect(m.quiet()).toBe(false);
  m.play('spotify:track:a', 'Song');                 // playing again: after the time again
  wait(QUIET_MS);
  expect(m.quiet()).toBe(true);
  act(() => { fireEvent.pointerDown(m.np()); fireEvent.click(within(m.np()).getByRole('button', { name: 'Options' })); });
  expect([m.quiet(), m.np().querySelectorAll('[role=option]').length]).toEqual([false, 0]);   // that tap only woke it: no popup
  act(() => { fireEvent.pointerDown(m.np()); fireEvent.click(within(m.np()).getByRole('button', { name: 'Options' })); });
  expect(m.np().querySelectorAll('[role=option]').length).toBeGreaterThan(0);
  wait(QUIET_MS * 2);
  expect(m.quiet()).toBe(false);                     // the ⋯ menu is open
});

it('a wheel turn or a tap on the screen wakes it and does nothing else; the wheel\'s buttons act and wake it', () => {
  const m = atNowPlaying();
  const volume = m.S().settings.volume, show = () => localStorage.getItem('ipod.canvas');
  wait(QUIET_MS);
  key('ArrowUp');                                    // a wheel tick: awake, the volume as it was
  expect([m.quiet(), m.S().settings.volume]).toEqual([false, volume]);
  key('ArrowUp');                                    // the next one is the volume's
  expect(m.S().settings.volume).not.toBe(volume);
  wait(QUIET_MS);
  const before = show();
  const tap = m.np().querySelector('[class*=tap]')!;
  act(() => { fireEvent.pointerDown(tap); fireEvent.click(tap); });   // a tap on the art: awake, the art as it was
  expect([m.quiet(), show()]).toEqual([false, before]);
  wait(QUIET_MS);
  const shuffle = within(m.getByTestId('ipod')).getByRole('button', { name: 'Shuffle' });
  act(() => { fireEvent.pointerDown(shuffle); fireEvent.click(shuffle); });   // the status row's toggle: not toggled
  expect([m.quiet(), m.cmd.toggleShuffle.mock.calls.length]).toEqual([false, 0]);
  wait(QUIET_MS);
  const wheel = within(m.getByTestId('ipod')).getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  act(() => {                                        // ⏯ on the wheel: it plays / pauses, and wakes it
    fireEvent.pointerDown(wheel, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
    fireEvent.pointerUp(wheel, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
  });
  expect([m.cmd.playPause.mock.calls.length, m.quiet()]).toEqual([1, false]);
  wait(QUIET_MS);
  key('Enter');                                      // the centre (its key): its mode, and awake
  expect([m.quiet(), !!m.np().querySelector('[class*=diamond]')]).toEqual([false, true]);
});

it('the overlay is the whole area in both views, quiet or not: over the cover and over the Canvas, Bars and Alchemy alike', async () => {
  localStorage.setItem('ipod.visualizer', JSON.stringify('alchemy:0'));
  const m = atNowPlaying();
  m.queries.fetchCanvas.mockImplementation((uri) => Promise.resolve(uri.endsWith('c') ? { url: uri + '.mp4', type: 'video' } : null));
  const box = () => m.np().querySelector('[class*=overlay]')?.className.match(/overlay/)?.[0] ?? null;
  const any = () => m.np().querySelector('[class*=overart], [class*=overclip], [class*=overfull]');
  m.play('spotify:track:a', 'Song', 'playing', 'https://i.scdn.co/image/abc');   // the cover
  expect([box(), any(), !!m.np().querySelector('img[class*=art]')]).toEqual(['overlay', null, true]);
  wait(QUIET_MS);
  expect([m.quiet(), box()]).toEqual([true, 'overlay']);
  vi.useRealTimers();
  m.play('spotify:track:c', 'Song', 'playing', 'https://i.scdn.co/image/abc');   // the Canvas
  await settle();
  expect([!!m.np().querySelector('video'), box(), any()]).toEqual([true, 'overlay', null]);
  localStorage.setItem('ipod.visualizer', JSON.stringify('bars:0'));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ipod.visualizer' })); });
  expect([m.S().vis.kind, box()]).toEqual(['bars', 'overlay']);
});

it('the status row: the output in ▶\'s place once the phone reports a route (headphones / AirPlay / the speaker; another device playing: the speaker), ▶ without one; a charging battery carries a bolt', () => {
  const m = atNowPlaying(), ipod = m.getByTestId('ipod');
  const push = (key: string, event: string, v: unknown) => act(() => { (window as unknown as Record<string, unknown>)[key] = v; window.dispatchEvent(new Event(event)); });
  const img = () => ipod.querySelector('[class*=status] [role=img]')?.getAttribute('aria-label') ?? null;
  expect(img()).toBe('Playing');
  push('__wmpRoute', 'wmp-route', { name: 'AirPods', type: 'BluetoothA2DPOutput' });
  expect(img()).toBe('Headphones');
  push('__wmpRoute', 'wmp-route', { name: 'Speaker', type: 'Speaker' });
  expect(img()).toBe('Speaker');
  push('__wmpRoute', 'wmp-route', { name: 'TV', type: 'AirPlay' });
  expect(img()).toBe('AirPlay');
  act(() => { m.store.getState().actions.setDevices([{ id: 'other', name: 'Kitchen', type: 'Speaker', active: true }], 'me'); });
  expect(img()).toBe('Playing elsewhere');
  expect(ipod.querySelector('[class*=bolt]')).toBeNull();
  push('__wmpBattery', 'wmp-battery', { level: 40, charging: true });
  expect([!!ipod.querySelector('[class*=bolt]'), ipod.querySelector('[class*=battery]')?.getAttribute('aria-label')]).toEqual([true, 'Battery 40%, charging']);
  delete (window as unknown as Record<string, unknown>).__wmpRoute; delete (window as unknown as Record<string, unknown>).__wmpBattery;
});
