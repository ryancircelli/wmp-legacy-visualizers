// The iPod skin mounted: the wheel (its keyboard stand-in) reaches the top screen only, MENU goes back,
// the nano 5G's menus, the chevron on the selected row only, taps, and the hold-⏮/⏭ scan.
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeShell } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore } from '../../src/model';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { Root } from '../../src/skins/ipod/Root';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { Bar, MenuScreen, scan, StatusRow, useScan } from '../../src/skins/ipod/ui';
import { NavContext } from '../../src/skins/ipod/wheel';
import { ShellContext } from '../../src/ui';
import { fakeData, mountSkinNow, settle } from './harness';

afterEach(() => { cleanup(); delete window.alchemyHaptic; vi.useRealTimers(); vi.unstubAllGlobals(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

function mount() {
  const store = createAppStore({ persist: false });
  const { container } = render(<ShellContext.Provider value={makeShell(store, {} as Ticker)}><Root /></ShellContext.Provider>);
  // the screen on top (the ones under it are mounted, hidden)
  const shown = (q: string) => [...container.querySelectorAll(q)].filter((x) => !x.closest('[hidden]'));
  return {
    store,
    sel: () => shown('[aria-selected=true]').map((x) => x.textContent),
    rows: () => shown('[role=option]').map((x) => x.textContent),
    row: (label: string) => shown('[role=option]').find((x) => x.textContent === label)!,
    chevrons: () => shown('[role=option] svg').map((x) => x.closest('[role=option]')!.textContent),
  };
}

it('arrows move the selection, Enter opens Library, Escape comes back; a tick that moves is a haptic, one at the end is not', () => {
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const m = mount();
  expect(m.sel()).toEqual(['Home']);
  key('ArrowUp');                                    // the top: nothing moves, no click
  expect(m.sel()).toEqual(['Home']);
  expect(haptic).not.toHaveBeenCalledWith('selection');
  key('ArrowDown');
  expect(m.sel()).toEqual(['Search']);
  expect(haptic).toHaveBeenCalledWith('selection');
  key('ArrowDown');
  key('Enter');
  expect(m.sel()).toEqual(['Playlists']);
  key('Escape');
  expect(m.sel()).toEqual(['Library']);
});

it('Spotify\'s menus in the nano\'s look: Extras hidden, Now Playing only with a track; the Library without Podcasts & Shows or Cover Flow', () => {
  const m = mount();
  expect(m.rows()).toEqual(['Home', 'Search', 'Library', 'Radio', 'Settings']);
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, track: { uri: 'spotify:track:a', title: 'T', artist: 'A', duration: 1 } } })); });
  expect(m.rows()).toEqual(['Home', 'Search', 'Library', 'Radio', 'Now Playing', 'Settings']);
  act(() => { fireEvent.click(m.row('Library')); });
  expect(m.rows()).toEqual(['Playlists', 'Liked Songs', 'Albums', 'Artists', 'Queue']);
});

it('a chevron shows on the selected row only', () => {
  const m = mount();
  expect(m.chevrons()).toEqual(['Home']);
  key('ArrowDown');
  expect(m.chevrons()).toEqual(m.sel());
});

it('a tap selects a row and does what the centre would', () => {
  const m = mount();
  act(() => { fireEvent.click(m.row('Library')); });
  expect(m.sel()).toEqual(['Playlists']);
  const a = vi.fn(), b = vi.fn(), off = vi.fn();
  const { getByText } = render(<ShellContext.Provider value={makeShell(m.store, {} as Ticker)}>
    <MenuScreen items={[{ id: 'a', label: 'A', onSelect: a }, { id: 'b', label: 'B', onSelect: b }, { id: 'c', label: 'C', onSelect: off, disabled: true }]} />
  </ShellContext.Provider>);
  act(() => { fireEvent.click(getByText('B')); });
  expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1]);
  expect(getByText('B').closest('[role=option]')!.getAttribute('aria-selected')).toBe('true');
  act(() => { fireEvent.click(getByText('C')); });
  expect(off).not.toHaveBeenCalled();
});

it('a loading list says why it waits: signing in, signed out, or loading', () => {
  const store = createAppStore({ persist: false });
  const { container } = render(<ShellContext.Provider value={makeShell(store, {} as Ticker)}><MenuScreen items={[]} loading /></ShellContext.Provider>);
  const say = (loggedIn: boolean | null) => {
    act(() => { store.setState((s) => ({ auth: { ...s.auth, engine: 'spotify', loggedIn } })); });
    return container.textContent;
  };
  expect(say(null)).toBe('Signing in…');
  expect(say(false)).toBe('Not signed in');
  expect(say(true)).toBe('Loading…');
});

it('a swipe right on the screen is MENU, and not also a tap on the row it ended on', () => {
  const m = mount();
  act(() => { fireEvent.click(m.row('Library')); });
  const row = m.row('Playlists');
  act(() => { fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(row, { pointerId: 1, clientX: 90, clientY: 110 }); });
  act(() => { fireEvent.click(row); });
  expect(m.sel()).toEqual(['Library']);
  const library = m.row('Library');                   // a short drag is no swipe
  act(() => { fireEvent.pointerDown(library, { pointerId: 2, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(library, { pointerId: 2, clientX: 30, clientY: 100 }); });
  act(() => { fireEvent.click(library); });
  expect(m.sel()).toEqual(['Playlists']);
});

it('a seekable Bar follows a drag and seeks once, on release', () => {
  const seek = vi.fn();
  const { getByRole } = render(<Bar value={0.2} onSeek={seek} />);
  const bar = getByRole('slider');
  bar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 9, right: 200, bottom: 9, x: 0, y: 0, toJSON: () => ({}) });
  act(() => { fireEvent.pointerDown(bar, { pointerId: 1, clientX: 50 }); });
  act(() => { fireEvent.pointerMove(bar, { pointerId: 1, clientX: 150 }); });
  expect(bar.getAttribute('aria-valuenow')).toBe('75');
  expect(seek).not.toHaveBeenCalled();
  act(() => { fireEvent.pointerUp(bar, { pointerId: 1, clientX: 100 }); });
  expect(seek).toHaveBeenCalledExactlyOnceWith(0.5);
  expect(bar.getAttribute('aria-valuenow')).toBe('20');
});

it('holding ⏭ scans locally (4× real time), seeks once on release, and shows the scan until playback answers', () => {
  vi.useFakeTimers();
  const store = createAppStore({ persist: false }), seek = vi.fn();
  store.setState((s) => ({
    commands: { ...s.commands, seek },
    playback: { ...s.playback, status: 'paused', canSeek: true, position: 10_000, at: Date.now(),
                track: { uri: 'spotify:track:x', title: 'T', artist: 'A', duration: 200_000 } },
  }));
  const shown = renderHook(() => useScan());
  const release = scan(store, 1);
  expect(release).toBeTypeOf('function');
  act(() => { vi.advanceTimersByTime(1000); });
  expect(shown.result.current).toEqual({ scanning: 1, offsetMs: 4000 });
  act(() => { (release as () => void)(); });
  expect(seek).toHaveBeenCalledTimes(1);
  expect(seek).toHaveBeenCalledWith(14_000);
  expect(shown.result.current.scanning).toBe(1);   // held until the seek lands
  act(() => { store.setState((s) => ({ playback: { ...s.playback, position: 14_000, at: Date.now() + 1 } })); });
  expect(shown.result.current).toEqual({ scanning: 0, offsetMs: 0 });
  store.setState((s) => ({ playback: { ...s.playback, canSeek: false } }));
  expect(scan(store, -1)).toBe(false);
});

it('the dark status row: shuffle and repeat are toggles (dimmed when off), a tap is theirs alone, a light haptic each', () => {
  const haptic = vi.fn(), outer = vi.fn();
  window.alchemyHaptic = haptic;
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="row" onClick={outer}><StatusRow title="" dark /></div>);
  const row = within(m.getByTestId('row'));
  const shuffle = row.getByRole('button', { name: 'Shuffle' }), repeat = row.getByRole('button', { name: 'Repeat' });
  expect([shuffle.getAttribute('aria-pressed'), repeat.getAttribute('aria-pressed')]).toEqual(['false', 'false']);
  act(() => { fireEvent.click(shuffle); });
  expect(m.cmd.toggleShuffle).toHaveBeenCalledTimes(1);
  expect(haptic).toHaveBeenCalledWith('light');
  act(() => { fireEvent.click(repeat); });
  expect(m.cmd.cycleRepeat).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, shuffle: true, repeat: 'track' } })); });
  expect(shuffle.getAttribute('aria-pressed')).toBe('true');
  const one = row.getByRole('button', { name: 'Repeat one' });
  expect([one.getAttribute('aria-pressed'), one.textContent]).toEqual(['true', '1']);
});

it('the dark status row\'s Like: dimmed and inert with no track, else the playing track\'s saved flag, toggled by a tap', async () => {
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const m = mountSkinNow('spotify', fakeData({ saved: { 'spotify:track:a': true } }), <div data-testid="row"><StatusRow title="" dark /></div>);
  const row = within(m.getByTestId('row'));
  const none = row.getByRole('button', { name: 'Like' });
  expect([none.getAttribute('aria-disabled'), none.hasAttribute('data-off')]).toEqual(['true', true]);
  act(() => { fireEvent.click(none); });
  expect([m.cmd.addTo.mock.calls.length, haptic.mock.calls.length]).toEqual([0, 0]);
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: { uri: 'spotify:track:a', title: 'T', artist: 'A', duration: 1 } } })); });
  await settle();
  const liked = row.getByRole('button', { name: 'Unlike' });
  expect([liked.getAttribute('aria-pressed'), liked.hasAttribute('data-off')]).toEqual(['true', false]);
  act(() => { fireEvent.click(liked); });
  expect(m.cmd.addTo).toHaveBeenCalledExactlyOnceWith('spotify:track:a', expect.any(String), false);
  expect(haptic).toHaveBeenCalledWith('light');
});

it('a tap on the cover area swaps the Canvas for the cover and back, remembered; none is fetched while the cover is chosen', async () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  m.queries.fetchCanvas.mockImplementation((uri) => Promise.resolve(uri.endsWith('none') ? null : { url: uri + '.mp4', type: 'video' }));
  const play = async (uri: string) => {
    act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: { uri, title: 'T', artist: 'A', duration: 100_000 } } })); });
    await settle();
  };
  const np = m.getByTestId('np'), tap = () => act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });
  await play('spotify:track:a');
  expect(np.querySelector('video')?.getAttribute('src')).toBe('spotify:track:a.mp4');
  tap();
  expect(np.querySelector('video')).toBeNull();
  expect(haptic).toHaveBeenCalledWith('light');
  expect(localStorage.getItem('ipod.canvas')).toContain('"on":false');
  await play('spotify:track:b');                     // the cover stays chosen: nothing fetched
  expect(m.queries.fetchCanvas).not.toHaveBeenCalledWith('spotify:track:b');
  tap();
  await settle();
  expect(np.querySelector('video')?.getAttribute('src')).toBe('spotify:track:b.mp4');
  await play('spotify:track:none');                  // no Canvas: the cover, and a tap does nothing
  haptic.mockClear();
  tap();
  expect(haptic).not.toHaveBeenCalled();
  expect(localStorage.getItem('ipod.canvas')).toContain('"on":true');
});
