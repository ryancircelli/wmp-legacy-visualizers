// The iPod's Now Playing minimizes after MINIMIZE_MS without input while it plays: the bands and the ⋯
// go, the cover stays as it is, and the menus' Now Playing bar comes up at the foot; any input restores
// it, a tap on the screen, a wheel turn or an arrow key doing nothing else, the wheel's buttons and the
// bar's acting as ever. (Where the cover and the lyrics sit is layout: checked in Chromium.)
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Root } from '../../src/skins/ipod/Root';
import { MINIMIZE_MS } from '../../src/skins/ipod/screens/nowplaying/logic';
import { fakeData, mountSkinNow } from './harness';

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
  /** the bar at the foot, there only while minimized (hidden from the accessibility tree otherwise) */
  const bar = () => within(np()).queryByRole('button', { name: 'Now Playing' });
  return { ...m, play, np, bar, mini: () => np().hasAttribute('data-mini'), line: () => bar()?.querySelector('[class*=nptitle]')?.textContent };
}

it('minimizes after MINIMIZE_MS without input while it plays: the menus\' Now Playing bar at the foot, the cover the same; a track change keeps it so', () => {
  const m = atNowPlaying();
  const cover = m.np().querySelector('img[class*=art]') ?? m.np().querySelector('[class*=noart]');
  expect(MINIMIZE_MS).toBe(5000);
  expect(m.bar()).toBeNull();
  wait(MINIMIZE_MS - 1);
  expect(m.mini()).toBe(false);
  wait(1);
  expect([m.mini(), m.line()]).toEqual([true, 'Song • Band']);
  expect(m.np().querySelector('[class*=miniline]')).toBeNull();   // the bar, not a line of its own
  expect([m.np().querySelector('img[class*=art]') ?? m.np().querySelector('[class*=noart]')]).toEqual([cover]);   // the same cover, its box CSS's
  const v = parseFloat(m.bar()!.style.getPropertyValue('--v'));
  expect(v).toBeGreaterThanOrEqual(0.25);            // 25 s of 100 and on
  expect(v).toBeLessThanOrEqual(0.31);
  m.play('spotify:track:b', 'Next One');             // the next track: still minimized, the bar its own
  expect([m.mini(), m.line()]).toEqual([true, 'Next One • Band']);
});

it('the bar: a tap on it restores (Now Playing is where it would go), its button plays / pauses and restores, a swipe skips', () => {
  const m = atNowPlaying();
  wait(MINIMIZE_MS);
  const tapBar = () => { const b = m.bar()!; act(() => { fireEvent.pointerDown(b, { pointerId: 1, clientX: 100, clientY: 10 }); fireEvent.pointerUp(b, { pointerId: 1, clientX: 100, clientY: 10 }); fireEvent.click(b); }); };
  tapBar();
  expect([m.mini(), m.np().closest('[hidden]'), m.cmd.playPause.mock.calls.length]).toEqual([false, null, 0]);
  wait(MINIMIZE_MS);
  const button = within(m.bar()!).getByRole('button', { name: 'Pause' });
  act(() => { fireEvent.pointerDown(button); fireEvent.click(button); });
  expect([m.cmd.playPause.mock.calls.length, m.mini()]).toEqual([1, false]);
  wait(MINIMIZE_MS);
  const b = m.bar()!;
  act(() => { fireEvent.pointerDown(b, { pointerId: 2, clientX: 200, clientY: 10 }); fireEvent.pointerUp(b, { pointerId: 2, clientX: 100, clientY: 12 }); fireEvent.click(b); });
  expect([m.cmd.next.mock.calls.length, m.mini()]).toEqual([1, false]);
});

it('not while paused, nor with a popup open; pausing restores', () => {
  const m = atNowPlaying();
  wait(MINIMIZE_MS);
  expect(m.mini()).toBe(true);
  m.play('spotify:track:a', 'Song', 'paused');       // paused: restored, and it stays so
  expect(m.mini()).toBe(false);
  wait(MINIMIZE_MS * 2);
  expect(m.mini()).toBe(false);
  m.play('spotify:track:a', 'Song');                 // playing again: after the time again
  wait(MINIMIZE_MS);
  expect(m.mini()).toBe(true);
  act(() => { fireEvent.pointerDown(m.np()); fireEvent.click(within(m.np()).getByRole('button', { name: 'Options' })); });
  expect(m.mini()).toBe(false);                      // that tap only woke it: no popup
  act(() => { fireEvent.pointerDown(m.np()); fireEvent.click(within(m.np()).getByRole('button', { name: 'Options' })); });
  expect(m.np().querySelectorAll('[role=option]').length).toBeGreaterThan(0);
  wait(MINIMIZE_MS * 2);
  expect(m.mini()).toBe(false);                      // the ⋯ menu is open
});

it('a wheel turn or a tap on the screen restores it and does nothing else; the wheel\'s buttons act and restore', () => {
  const m = atNowPlaying();
  const volume = m.S().settings.volume, show = () => localStorage.getItem('ipod.canvas');
  wait(MINIMIZE_MS);
  key('ArrowUp');                                    // a wheel tick (down: the volume is at the top): restored, the volume as it was
  expect([m.mini(), m.S().settings.volume]).toEqual([false, volume]);
  key('ArrowUp');                                    // the next one is the volume's
  expect(m.S().settings.volume).not.toBe(volume);
  wait(MINIMIZE_MS);
  const before = show();
  const tap = m.np().querySelector('[class*=tap]')!;
  act(() => { fireEvent.pointerDown(tap); fireEvent.click(tap); });   // a tap on the art: restored, the art as it was
  expect([m.mini(), show()]).toEqual([false, before]);
  wait(MINIMIZE_MS);
  const shuffle = within(m.getByTestId('ipod')).getByRole('button', { name: 'Shuffle' });
  act(() => { fireEvent.pointerDown(shuffle); fireEvent.click(shuffle); });   // the status row's toggle: not toggled
  expect([m.mini(), m.cmd.toggleShuffle.mock.calls.length]).toEqual([false, 0]);
  wait(MINIMIZE_MS);
  // ⏯ on the wheel: it plays / pauses, and restores
  const wheel = within(m.getByTestId('ipod')).getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  act(() => {
    fireEvent.pointerDown(wheel, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
    fireEvent.pointerUp(wheel, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
  });
  expect([m.cmd.playPause.mock.calls.length, m.mini()]).toEqual([1, false]);
  wait(MINIMIZE_MS);
  key('Enter');                                      // the centre (its key): its mode, and restored
  expect([m.mini(), !!m.np().querySelector('[class*=diamond]')]).toEqual([false, true]);
});

it('minimized with a cover, its mirror image above it and below it, behind the bar (the ♪ tile: none); the bar is the clear one here, the menus\' its own', () => {
  const m = atNowPlaying();
  // the mirror above the cover and the one under it (behind the bar)
  const mirrors = () => ['up', 'down'].map((k) => m.np().querySelector(`[class*=mirror][class*=${k}] > img`)?.getAttribute('src') ?? null);
  wait(MINIMIZE_MS);
  expect([m.mini(), ...mirrors()]).toEqual([true, null, null]);   // no cover: the ♪ tile, black round it
  m.play('spotify:track:a', 'Song', 'playing', 'https://i.scdn.co/image/abc');
  expect([m.mini(), ...mirrors()]).toEqual([true, 'https://i.scdn.co/image/abc', 'https://i.scdn.co/image/abc']);
  // the clear look is the page's own wrapper's (.foot); the menus' bar has none
  expect(m.bar()!.parentElement!.className).toMatch(/foot/);
  key('Escape');                                     // to the main menu: its bar, opaque as ever
  const menuBar = within(m.getByTestId('ipod')).getAllByRole('button', { name: 'Now Playing' }).find((x) => !x.closest('[aria-hidden=true]'))!;
  expect(menuBar.parentElement!.className).not.toMatch(/foot/);
});

it('Over Cover: Bars and Waves\' box is the cover\'s (the whole area minimized: a resize), Alchemy\'s and Battery\'s the whole area always, clipped to the cover in the full view (never resized)', () => {
  localStorage.setItem('ipod.visOverCover', 'true');
  localStorage.setItem('ipod.visualizer', JSON.stringify('alchemy:0'));
  const m = atNowPlaying();
  m.play('spotify:track:a', 'Song', 'playing', 'https://i.scdn.co/image/abc');
  const tap = () => act(() => { fireEvent.click(m.np().querySelector('[class*=tap]')!); });
  tap();                                             // no Canvas: on to the visualizer, over the cover
  const box = () => m.np().querySelector('[class*=overclip], [class*=overart]')?.className.match(/overclip|overart/)?.[0];
  expect(box()).toBe('overclip');
  wait(MINIMIZE_MS);
  expect([m.mini(), box()]).toEqual([true, 'overclip']);   // the same box: only its clip changes
  key('Escape');
  act(() => { fireEvent.click(m.getByTestId('ipod').querySelector('[aria-label="Now Playing"][role=button]')!); });
  localStorage.setItem('ipod.visualizer', JSON.stringify('bars:0'));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ipod.visualizer' })); });
  expect(box()).toBe('overart');
  tap();                                             // back to the Canvas for the tests after
});

