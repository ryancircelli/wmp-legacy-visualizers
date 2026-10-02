// The iPod skin mounted: the wheel (its keyboard stand-in) reaches the top screen only, MENU goes back,
// the nano 5G's menus, the chevron on the selected row only, taps, the library's grid, Home's shelves, a
// collection's header, and the hold-⏮/⏭ scan.
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { makeShell } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore } from '../../src/model';
import { mainMenu } from '../../src/skins/ipod/menus';
import { createNav } from '../../src/skins/ipod/nav';
import { Root } from '../../src/skins/ipod/Root';
import { nowPlaying } from '../../src/skins/ipod/screens';
import { writePref } from '../../src/skins/ipod/screens/settings/prefs';
import { Bar, GridScreen, MenuScreen, scan, ShelvesScreen, StatusRow, useScan } from '../../src/skins/ipod/ui';
import { NavContext } from '../../src/skins/ipod/wheel';
import { ShellContext } from '../../src/ui';
import { fakeData, mountSkinNow, settle } from './harness';

afterEach(() => { cleanup(); delete window.alchemyHaptic; vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

/** the iPod skin mounted over the fake catalogue; `shown` reads the screen on top (the ones under it
 *  are mounted, hidden) */
function mountIpod(data = fakeData(), extra?: ReactNode) {
  const m = mountSkinNow('spotify', data, <><div data-testid="ipod"><Root /></div>{extra}</>);
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll(q)].filter((x) => !x.closest('[hidden]'));
  return {
    ...m, shown,
    // a button says what it is by its label, a row, tile or chip by its text
    sel: () => shown('[aria-selected=true]').map((x) => x.getAttribute('aria-label') ?? x.textContent),
    rows: () => shown('[role=option]').map((x) => x.textContent),
    row: (label: string) => shown('[role=option]').find((x) => x.textContent === label)!,
    chevrons: () => shown('[role=option] svg').map((x) => x.closest('[role=option]')!.textContent),
  };
}
const mount = mountIpod;

it('arrows move the selection, Enter opens Library, Escape comes back; a tick that moves is a haptic, one at the end is not', async () => {
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
  await settle();
  expect(m.sel()).toEqual(['QueueUp next']);           // the Library's first tile
  key('Escape');
  expect(m.sel()).toEqual(['Library']);
});

it('Spotify\'s menus in the nano\'s look: Extras hidden, Now Playing only with a track; the Library\'s chips without Podcasts', async () => {
  const m = mount();
  expect(m.rows()).toEqual(['Home', 'Search', 'Library', 'Radio', 'Settings']);
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, track: { uri: 'spotify:track:a', title: 'T', artist: 'A', duration: 1 } } })); });
  expect(m.rows()).toEqual(['Home', 'Search', 'Library', 'Radio', 'Now Playing', 'Settings']);
  act(() => { fireEvent.click(m.row('Library')); });
  await settle();
  expect(m.rows()).toEqual(['Playlists', 'Albums', 'Artists', 'QueueUp next', 'Liked SongsPlaylist · 0 songs']);
});

it('a chevron shows on the selected row only', () => {
  const m = mount();
  expect(m.chevrons()).toEqual(['Home']);
  key('ArrowDown');
  expect(m.chevrons()).toEqual(m.sel());
});

it('a tap selects a row and does what the centre would', async () => {
  const m = mount();
  act(() => { fireEvent.click(m.row('Library')); });
  await settle();
  expect(m.sel()).toEqual(['QueueUp next']);
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

it('the Library is chips over a grid: it opens on the first tile, the wheel steps a tile at a time, up into the chips, Enter on one switches (kept); List view is rows again', async () => {
  const album = (i: number, name: string, artist: string) => ({ uri: 'spotify:album:' + i, name, artist, image: 'https://i.scdn.co/' + i });
  const data = fakeData({
    list: [album(2, 'Kid A', 'Radiohead'), album(0, 'Abbey Road', 'The Beatles'), album(1, 'Hot Space', 'Queen')],
    collections: { 'spotify:album:1': { tracks: [{ uri: 'spotify:track:s', title: 'Staying Power', artist: 'Queen', duration: 1 }] } },
  });
  const { shown, sel, rows } = mountIpod(data);
  const on = () => shown('[data-on]').map((x) => x.textContent);
  key('ArrowDown'); key('ArrowDown'); key('Enter');          // Library: Playlists, on its first tile
  await settle();
  expect(rows()).toEqual(['Playlists', 'Albums', 'Artists', 'QueueUp next', 'Liked SongsPlaylist · 0 songs']);
  expect([on(), sel()]).toEqual([['Playlists'], ['QueueUp next']]);
  key('ArrowUp');                                            // up past the first tile: the chips, from the end
  expect(sel()).toEqual(['Artists']);
  key('ArrowUp');
  expect(sel()).toEqual(['Albums']);
  key('ArrowDown'); key('ArrowDown');                        // down from the chips: the first tile
  expect(sel()).toEqual(['QueueUp next']);
  key('ArrowUp'); key('ArrowUp'); key('Enter');              // Albums, on its first tile
  await settle();
  expect(rows()).toEqual(['Playlists', 'Albums', 'Artists', 'Abbey RoadAlbum · The Beatles', 'Hot SpaceAlbum · Queen', 'Kid AAlbum · Radiohead']);
  expect(shown('[role=option] img').map((x) => x.getAttribute('src'))).toEqual(['https://i.scdn.co/0', 'https://i.scdn.co/1', 'https://i.scdn.co/2']);
  expect([on(), sel(), localStorage.getItem('ipod.libraryFilter')]).toEqual([['Albums'], ['Abbey RoadAlbum · The Beatles'], '"albums"']);
  key('ArrowDown');                                          // the next tile, beside it
  expect(sel()).toEqual(['Hot SpaceAlbum · Queen']);
  key('ArrowDown'); key('ArrowDown');                        // the next row's first, then the end holds
  expect(sel()).toEqual(['Kid AAlbum · Radiohead']);
  key('ArrowUp'); key('Enter');                              // songs are rows, under the header's three buttons
  await settle();
  expect(rows()).toEqual(['', '', '', 'Staying PowerQueen']);
  key('Escape');
  act(() => { localStorage.setItem('ipod.view', '"list"'); window.dispatchEvent(new StorageEvent('storage')); });
  expect(rows()).toEqual(['Playlists', 'Albums', 'Artists', 'Abbey Road', 'Hot Space', 'Kid A']);
  expect(sel()).toEqual(['Hot Space']);
  act(() => { fireEvent.click(shown('[role=option]')[0]!); });   // a tap on a chip switches
  await settle();
  expect([on(), sel()]).toEqual([['Playlists'], ['Queue']]);
});

it('a grid waits and empties as a list does, a tap opens a tile, a long press is its hold (and not also a tap)', () => {
  const store = createAppStore({ persist: false });
  store.setState((s) => ({ auth: { ...s.auth, engine: 'spotify', loggedIn: true } }));
  const wrap = (el: ReactNode) => <ShellContext.Provider value={makeShell(store, {} as Ticker)}>{el}</ShellContext.Provider>;
  const { container, rerender, getByText } = render(wrap(<GridScreen items={[]} loading />));
  expect(container.textContent).toBe('Loading…');
  rerender(wrap(<GridScreen items={[]} empty="No Albums" />));
  expect(container.textContent).toBe('No Albums');
  const open = vi.fn(), hold = vi.fn();
  rerender(wrap(<GridScreen items={[{ id: 'a', label: 'A', sub: 'Artist', art: null }, { id: 'b', label: 'B', onSelect: open, onHold: hold }]} />));
  const a = getByText('A').closest('[role=option]')!, b = getByText('B').closest('[role=option]')!;
  expect([a.querySelector('img'), a.querySelector('svg')?.tagName]).toEqual([null, 'svg']);   // no cover: the ♪ tile
  act(() => { fireEvent.click(b); });
  expect([open.mock.calls.length, b.getAttribute('aria-selected')]).toEqual([1, 'true']);
  vi.useFakeTimers();
  act(() => { fireEvent.pointerDown(b); vi.advanceTimersByTime(500); });
  act(() => { fireEvent.pointerUp(b); fireEvent.click(b); });
  expect([hold.mock.calls.length, open.mock.calls.length]).toEqual([1, 1]);
  act(() => { fireEvent.pointerDown(a); vi.advanceTimersByTime(500); });      // A has no hold: its press stays a press
  act(() => { fireEvent.pointerUp(a); fireEvent.click(a); });
  expect(a.getAttribute('aria-selected')).toBe('true');
});

it('Home is Spotify\'s shelves: the wheel runs along a strip, past its end (See all) into the next shelf and back; Enter plays or opens', async () => {
  const shelf = (title: string, p: string) => ({ title, items: [1, 2, 3].map((i) => ({ uri: 'spotify:track:' + p + i, name: p + i, sub: 'Queen', img: null })) });
  const m = mountIpod(fakeData({ home: { greeting: '', sections: [shelf('Made for you', 'A'), shelf('Jump back in', 'B')] } }));
  key('Enter');                                               // Home
  await settle();
  expect(m.shown('[role=listbox] [role=group]').map((x) => x.getAttribute('aria-label'))).toEqual(['Made for you', 'Jump back in']);
  expect(m.rows()).toEqual(['A1Song · Queen', 'A2Song · Queen', 'A3Song · Queen', 'See all', 'B1Song · Queen', 'B2Song · Queen', 'B3Song · Queen', 'See all']);
  expect(m.sel()).toEqual(['A1Song · Queen']);
  key('ArrowDown'); key('ArrowDown');
  expect(m.sel()).toEqual(['A3Song · Queen']);
  key('ArrowDown');                                           // the strip's end
  expect(m.sel()).toEqual(['See all']);
  key('ArrowDown');                                           // on into the next shelf
  expect(m.sel()).toEqual(['B1Song · Queen']);
  key('ArrowUp');                                             // back: the previous shelf's last
  expect(m.sel()).toEqual(['See all']);
  key('ArrowDown'); key('ArrowDown'); key('Enter');           // a song plays
  expect(m.cmd.playItem).toHaveBeenCalledWith(expect.objectContaining({ uri: 'spotify:track:B2' }));
  key('Escape');                                              // back from Now Playing, where it was
  expect(m.sel()).toEqual(['B2Song · Queen']);
  key('ArrowUp'); key('ArrowUp'); key('Enter');               // See all: the shelf's items as a screen
  await settle();
  expect(m.rows()).toEqual(['A1Song · Queen', 'A2Song · Queen', 'A3Song · Queen']);
  key('Escape');
  expect(m.sel()).toEqual(['See all']);
});

it('the shelves wait and empty as a list does, and a tap opens a tile', () => {
  const store = createAppStore({ persist: false });
  store.setState((s) => ({ auth: { ...s.auth, engine: 'spotify', loggedIn: true } }));
  const wrap = (el: ReactNode) => <ShellContext.Provider value={makeShell(store, {} as Ticker)}>{el}</ShellContext.Provider>;
  const { container, rerender, getByText } = render(wrap(<ShelvesScreen shelves={[]} loading />));
  expect(container.textContent).toBe('Loading…');
  rerender(wrap(<ShelvesScreen shelves={[]} empty="Nothing on Home" />));
  expect(container.textContent).toBe('Nothing on Home');
  const open = vi.fn(), more = vi.fn();
  rerender(wrap(<ShelvesScreen shelves={[{ id: 'a', title: 'A', items: [{ id: '1', label: 'One' }] },
                                         { id: 'b', title: 'B', items: [{ id: '1', label: 'Two', onSelect: open }], onMore: more }]} />));
  act(() => { fireEvent.click(getByText('Two')); });
  expect([open.mock.calls.length, getByText('Two').closest('[role=option]')!.getAttribute('aria-selected')]).toEqual([1, 'true']);
  act(() => { fireEvent.click(getByText('See all')); });
  expect(more).toHaveBeenCalledTimes(1);
});

it('a playlist opens under Spotify\'s header: its cover, title, owner and count; the wheel walks Play, Shuffle, the heart, then the songs; Enter on Play plays it all', async () => {
  const t = (i: number) => ({ uri: 'spotify:track:' + i, title: 'Song ' + i, artist: 'Queen', duration: 1, image: 'https://i.scdn.co/t' + i });
  const m = mountIpod(fakeData({
    list: [{ uri: 'spotify:playlist:p', name: 'Road Trip', owner: 'ryan', image: 'https://i.scdn.co/p' }],
    collections: { 'spotify:playlist:p': { meta: { kind: 'playlist', name: 'Road Trip', owner: { name: 'ryan', uri: 'spotify:user:ryan' }, image: 'https://i.scdn.co/p', total: 2 },
                                           tracks: [t(1), { ...t(2), image: undefined }] } },
  }));
  key('ArrowDown'); key('ArrowDown'); key('Enter');                 // Library: Playlists
  await settle();
  key('ArrowDown'); key('ArrowDown'); key('Enter');                 // past the Queue and Liked Songs
  await settle();
  const head = m.shown('[data-head]')[0]!;
  expect([head.textContent, head.querySelector('img')?.getAttribute('src')]).toEqual(['Road Tripryan · 2 songs', 'https://i.scdn.co/p']);
  // two-line rows, each with its cover (the playlist's when the song has none); the playing one marked
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, track: { uri: 'spotify:track:2', title: 'Song 2', artist: 'Queen', duration: 1 } } })); });
  expect(m.rows()).toEqual(['', '', '', 'Song 1Queen', 'Song 2Queen']);
  expect(m.shown('[role=option] img').map((x) => x.getAttribute('src'))).toEqual(['https://i.scdn.co/t1', 'https://i.scdn.co/p']);
  expect(m.shown('[role=option] [aria-label=Playing]').map((x) => x.closest('[role=option]')!.textContent)).toEqual(['Song 2Queen']);
  expect(m.sel()).toEqual(['Play']);
  key('ArrowDown');
  expect(m.sel()).toEqual(['Shuffle']);
  key('ArrowDown');
  expect(m.sel()).toEqual(['Like']);
  key('ArrowDown');
  expect(m.sel()).toEqual(['Song 1Queen']);
  key('ArrowUp'); key('ArrowUp'); key('ArrowUp'); key('Enter');
  expect(m.cmd.playAll).toHaveBeenCalledExactlyOnceWith('spotify:playlist:p');
});

it('a swipe right on the screen is MENU, and not also a tap on the row it ended on', async () => {
  const m = mount();
  act(() => { fireEvent.click(m.row('Library')); });
  await settle();
  const row = m.row('QueueUp next');
  act(() => { fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(row, { pointerId: 1, clientX: 90, clientY: 110 }); });
  act(() => { fireEvent.click(row); });
  expect(m.sel()).toEqual(['Library']);
  const library = m.row('Library');                   // a short drag is no swipe
  act(() => { fireEvent.pointerDown(library, { pointerId: 2, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(library, { pointerId: 2, clientX: 30, clientY: 100 }); });
  act(() => { fireEvent.click(library); });
  await settle();
  expect(m.sel()).toEqual(['QueueUp next']);
});

it('the Now Playing bar: with a track, under every screen but Now Playing; a tap opens it, the button plays / pauses, a swipe left is next and not also a tap', () => {
  const m = mount();
  const bar = () => m.shown('[aria-label="Now Playing"][role=button]')[0] as HTMLElement | undefined;
  const rect = () => ({ left: 0, width: 240, top: 0, height: 44, right: 240, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
  expect(bar()).toBeUndefined();
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'paused', track: { uri: 'spotify:track:a', title: 'Song', artist: 'Band', duration: 1000 } } })); });
  expect(bar()!.textContent).toContain('Song • Band');
  act(() => { fireEvent.click(within(bar()!).getByRole('button', { name: 'Play' })); });
  expect(m.cmd.playPause).toHaveBeenCalledTimes(1);
  expect(bar()).toBeDefined();                         // the button is not a tap on the bar
  const b = bar()!;
  b.getBoundingClientRect = rect;
  act(() => { fireEvent.pointerDown(b, { pointerId: 1, clientX: 200, clientY: 20 }); });
  act(() => { fireEvent.pointerUp(b, { pointerId: 1, clientX: 120, clientY: 24 }); });
  act(() => { fireEvent.click(b); });
  expect(m.cmd.next).toHaveBeenCalledTimes(1);
  expect(bar()).toBeDefined();                          // still on the main menu
  expect(m.sel()).toEqual(['Home']);                    // and the swipe was not the screen's MENU either
  key('ArrowDown');
  key('ArrowDown');
  key('Enter');                                          // Library: a swipe right on the bar is prev, not MENU
  const c = bar()!;
  c.getBoundingClientRect = rect;
  act(() => { fireEvent.pointerDown(c, { pointerId: 2, clientX: 40, clientY: 20 }); });
  act(() => { fireEvent.pointerUp(c, { pointerId: 2, clientX: 140, clientY: 18 }); });
  act(() => { fireEvent.click(c); });
  expect(m.cmd.prev).toHaveBeenCalledTimes(1);
  expect(m.rows()).not.toContain('Home');
  act(() => { fireEvent.click(bar()!); });
  expect(bar()).toBeUndefined();                        // Now Playing on top: no bar over it
  key('Escape');
  expect(bar()).toBeDefined();
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

it('a tap on the cover area cycles Canvas -> cover -> visualizer -> Canvas, remembered; a Canvas is fetched only while chosen', async () => {
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
  // [the Canvas clip, the cover (no art: the ♪ tile), the visualizer's canvas, the choice saved]
  const shows = () => [np.querySelector('video')?.getAttribute('src') ?? null, !!np.querySelector('[class*=noart]'), !!np.querySelector('canvas'),
                       (JSON.parse(localStorage.getItem('ipod.canvas') ?? 'null') as { state?: { show?: string } } | null)?.state?.show];
  await play('spotify:track:a');
  expect(shows().slice(0, 3)).toEqual(['spotify:track:a.mp4', false, false]);
  tap();
  expect(shows()).toEqual([null, true, false, 'cover']);
  expect(haptic).toHaveBeenCalledWith('light');
  await play('spotify:track:b');                     // the cover stays chosen: nothing fetched
  expect(m.queries.fetchCanvas).not.toHaveBeenCalledWith('spotify:track:b');
  act(() => { m.store.setState((s) => ({ vis: { ...s.vis, hold: true } })); });   // WMP's view left on Library
  tap();                                             // the visualizer: the app's canvas, unheld while shown
  expect(shows()).toEqual([null, false, true, 'vis']);
  expect(m.S().vis.hold).toBe(false);
  expect(m.queries.fetchCanvas).not.toHaveBeenCalledWith('spotify:track:b');
  tap();
  await settle();
  expect(shows()).toEqual(['spotify:track:b.mp4', false, false, 'video']);
  expect(m.S().vis.hold).toBe(false);                // the view is Now Playing: no hold put back
  await play('spotify:track:none');                  // no Canvas: the cover, and a tap goes on to the visualizer
  expect(shows()).toEqual([null, true, false, 'video']);
  haptic.mockClear();
  tap();
  expect(shows()).toEqual([null, false, true, 'vis']);
  expect(haptic).toHaveBeenCalledWith('light');
  tap();                                             // back to the default for the tests after
  expect(shows()).toEqual([null, true, false, 'video']);
});

it('the visualizer takes the screen\'s shape (Playback > Visualizer: Fit) while shown, then the scale WMP had', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  const tap = () => act(() => { fireEvent.click(m.getByTestId('np').querySelector('[class*=tap]')!); });
  act(() => m.store.getState().actions.setSettings({ scale: 'original' }));   // WMP's stretched surface
  tap();                                             // no Canvas: the tap goes on to the visualizer
  expect(m.S().settings.scale).toBe('auto');         // Fit, the default
  act(() => writePref('ipod.visFit', 'stretch'));   // changed while shown: at once
  expect(m.S().settings.scale).toBe('original');
  act(() => writePref('ipod.visFit', 'fit'));
  expect(m.S().settings.scale).toBe('auto');
  tap();                                             // away from the visualizer: WMP's own choice back
  expect(m.S().settings.scale).toBe('original');
});

it('Now Playing\'s visualizer is Bars (ipod.visualizer) while shown, a change at once, then the visualization WMP had', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  const tap = () => act(() => { fireEvent.click(m.getByTestId('np').querySelector('[class*=tap]')!); });
  const vis = () => [m.S().vis.kind, m.S().vis.preset, m.S().settings.vis, m.S().settings.preset];
  act(() => m.store.getState().actions.setVis('battery', 3));   // the WMP 9 skin's own choice
  tap();                                             // no Canvas: the tap goes on to the visualizer
  expect(vis()).toEqual(['bars', 0, 'bars', 0]);
  act(() => writePref('ipod.visualizer', 'alchemy:0'));
  expect(vis()).toEqual(['alchemy', 0, 'alchemy', 0]);
  tap();                                             // away from the visualizer: WMP's own choice back
  expect(vis()).toEqual(['battery', 3, 'battery', 3]);
});

it('Settings > Visualizer: the engines, the chosen one\'s showing its preset, each a page of its presets (Alchemy picked at its row); Now Playing shows a choice at once', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mount(fakeData(), <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  const tap = () => act(() => { fireEvent.click(m.getByTestId('np').querySelector('[class*=tap]')!); });
  const click = (label: string) => act(() => { fireEvent.click(m.row(label)); });
  const now = () => [localStorage.getItem('ipod.visualizer'), m.S().vis.kind, m.S().vis.preset];
  act(() => m.store.getState().actions.setVis('battery', 3));   // the WMP 9 skin's own choice
  tap();                                             // Now Playing on its visualizer
  click('Settings');
  click('VisualizerBars');
  expect(m.rows()).toEqual(['Alchemy', 'Bars and WavesBars', 'Battery']);
  click('Bars and WavesBars');
  expect(m.rows()).toEqual(['Bars✓', 'Ocean Mist', 'Fire Storm', 'Scope']);
  click('Ocean Mist');
  expect([now(), m.rows()]).toEqual([['"bars:1"', 'bars', 1], ['Bars', 'Ocean Mist✓', 'Fire Storm', 'Scope']]);
  key('Escape');
  expect(m.rows()).toEqual(['Alchemy', 'Bars and WavesOcean Mist', 'Battery']);
  click('Battery');
  expect(m.rows()).toEqual(m.sh.presets.filter((p) => p.group === 'Battery').map((p) => p.name));
  key('Escape');
  click('Alchemy');                                  // its one preset: picked here, no page
  expect([now(), m.rows()]).toEqual([['"alchemy:0"', 'alchemy', 0], ['Alchemy✓', 'Bars and Waves', 'Battery']]);
  key('Escape');
  expect(m.rows()).toContain('VisualizerAlchemy');
  tap();                                             // back to the Canvas for the tests after
  expect([m.S().vis.kind, m.S().vis.preset]).toEqual(['battery', 3]);   // WMP's own choice, untouched
});

it('the ⋯ over the cover opens this page\'s options: Lyrics and Karaoke toggle, Visualizer… picks one by engine, put on screen at once', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const nav = createNav(mainMenu(), () => nowPlaying());
  const m = mountSkinNow('spotify', fakeData(),
    <NavContext.Provider value={nav}><div data-testid="np">{nowPlaying().render(nav)}</div></NavContext.Provider>);
  const np = m.getByTestId('np'), options = () => [...np.querySelectorAll('[role=option]')];
  const rows = () => options().map((x) => x.textContent);
  const pick = (label: string) => act(() => { fireEvent.click(options().find((x) => x.textContent === label)!); });
  const open = () => act(() => { fireEvent.click(within(np).getByRole('button', { name: 'Options' })); });
  open();
  expect(rows()).toEqual(['Visualizer…', 'LyricsOn', 'KaraokeOn', 'Cancel']);
  expect(haptic).toHaveBeenCalledWith('light');
  pick('LyricsOn');                                  // a choice closes it
  expect([m.S().settings.lyrics, rows()]).toEqual([false, []]);
  open();
  pick('KaraokeOn');
  open();
  expect([m.S().settings.karaoke, rows()]).toEqual([false, ['Visualizer…', 'LyricsOff', 'KaraokeOff', 'Cancel']]);
  pick('Visualizer…');                               // the engines, then (a second popup) an engine's presets
  expect(rows()).toEqual(['Alchemy', 'Bars and WavesBars', 'Battery']);
  pick('Bars and WavesBars');
  expect(rows()).toEqual(['Bars✓', 'Ocean Mist', 'Fire Storm', 'Scope']);
  expect(np.querySelector('canvas')).toBeNull();     // the cover (no Canvas) until one is picked
  pick('Fire Storm');
  expect([localStorage.getItem('ipod.visualizer'), !!np.querySelector('canvas'), m.S().vis.kind, m.S().vis.preset, rows()])
    .toEqual(['"bars:2"', true, 'bars', 2, []]);
  open();
  pick('Visualizer…');
  expect(rows()).toEqual(['Alchemy', 'Bars and WavesFire Storm', 'Battery']);
  pick('Alchemy');                                   // its one preset: picked at its row
  expect([localStorage.getItem('ipod.visualizer'), m.S().vis.kind, rows()]).toEqual(['"alchemy:0"', 'alchemy', []]);
  act(() => { fireEvent.click(np.querySelector('[class*=tap]')!); });   // back to the Canvas for the tests after
});
