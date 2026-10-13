// The iTunes skin's phone layout: the source list as navigation (a tap opens a source, ‹ goes back), a
// tap on a song plays it in its context and the list ends on its status line, a list's head (Genius:
// its radio), a long press opens a song's sheet (iTunes DJ's moves and removal asking the engine for Up
// Next's new order) and Up Next's grip drags a row, a show's episodes newest first with the unplayed
// dot, search from the source list's field, Now Playing's play order (played, playing, Up Next: a side
// cover browses, springs back, plays on a second tap) and its transport, Preferences' sound section only
// with the host's own player, and the fit onto the iOS app's desktop-wide viewport. The app's newer
// commands: Add Playlist… and a playlist's Delete, Mark as Played, iTunes DJ's Clear, Smart Shuffle; and a
// tap on a cover opening it, never playing it.
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIKED, type ShuffleMode, type Track } from '../../src/model';
import { fit } from '../../src/skins/itunes/phone/host';
import { nav, phoneNav } from '../../src/skins/itunes/phone/nav';
import { BROWSE_MS } from '../../src/skins/itunes/phone/NowPlaying';
import { PageGuard, PhoneRoot } from '../../src/skins/itunes/phone/Root';
import { LONG_MS } from '../../src/skins/itunes/phone/Sheet';
import { DEFAULT_VIEW, itunesView } from '../../src/skins/itunes/shared';
import { fakeData, mountSkinNow, settle } from './harness';

const PL = 'spotify:playlist:road', SHOW = 'spotify:show:pod';
const track = (n: number, ctx?: string): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Band', album: 'LP', duration: 180000, ctx });

// a phone held upright (jsdom's 1024 x 768 window would be one on its side: Cover Flow alone)
const wide = [window.innerWidth, window.innerHeight] as const;
const size = (w: number, h: number) => { Object.defineProperty(window, 'innerWidth', { value: w, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: h, configurable: true }); };
beforeEach(() => { size(390, 844); phoneNav.setState({ pages: ['sources', 'source'] }); itunesView.setState(DEFAULT_VIEW); });
afterEach(() => { cleanup(); localStorage.clear(); size(...wide); });

async function phone() {
  const m = mountSkinNow('spotify', fakeData({
    list: [{ uri: PL, name: 'Road Trip', owner: 'ryan', editable: true }, { uri: 'spotify:album:lp', name: 'LP', artist: 'Band' }],
    collections: { [PL]: { tracks: [1, 2, 3].map((n) => track(n, PL)) }, [LIKED]: { tracks: [track(9, LIKED)] },
      [SHOW]: { tracks: [{ ...track(21, SHOW), uri: 'spotify:episode:21', releaseDate: '2026-09-01' }, { ...track(22, SHOW), uri: 'spotify:episode:22', releaseDate: '2026-09-29', unplayed: true }] } },
    stations: [{ uri: 'spotify:playlist:radio', name: 'Road Trip Radio', sub: '' }],
  }), <div data-testid="phone"><PhoneRoot /></div>);
  await settle();
  const ui = within(m.getByTestId('phone'));
  const $ = (sel: string) => m.getByTestId('phone').querySelector<HTMLElement>(sel)!;
  return { ...m, ui, $, title: () => $('#striptitle')?.textContent };
}

it('opens on the selected source; ‹ shows the source list, a tap opens a playlist (its status line its last row) and a tap on a song plays it there', async () => {
  const m = await phone();
  expect(m.title()).toBe('Music');
  // the LCD and the transport at the foot, over the bottom bar (by attribute: the WMP 9 skin the harness mounts shares ids)
  const order = [...m.getByTestId('phone').querySelectorAll('[id="top"], [id="page"], [id="toolbar"], [id="bottombar"]')].map((e) => e.id);
  expect(order).toEqual(['page', 'top', 'toolbar', 'bottombar']);
  act(() => { fireEvent.click(m.$('#bback')); });
  expect(m.ui.getByRole('tree', { name: 'Sources' })).toBeTruthy();
  act(() => { fireEvent.mouseDown(m.$('[data-source="' + PL + '"]')); });
  await settle();
  expect(m.title()).toBe('Road Trip');
  expect(m.$('#listfoot').textContent).toBe('3 songs, 9 minutes');
  act(() => { fireEvent.mouseDown(m.$('tr[data-i="1"]')); });
  expect(m.cmd.playContext).toHaveBeenCalledExactlyOnceWith(PL, 'spotify:track:2');
  // the double click a double tap also sends is the same tap
  act(() => { fireEvent.doubleClick(m.$('tr[data-i="1"]')); });
  expect(m.cmd.playContext).toHaveBeenCalledOnce();
});

it('iTunes DJ: a long press opens the song’s sheet; Move Up and Remove ask the engine for Up Next’s new order', async () => {
  const m = await phone();
  const reorder = vi.fn((order: readonly number[]) => { const q = m.S().queue.next; m.S().actions.setQueue(order.map((i) => q[i]!)); });
  act(() => {
    m.S().actions.setQueue([track(1), track(2), track(3)]);
    m.S().actions.setCommands({ ...m.S().commands, reorderQueue: reorder });
    itunesView.setState({ source: 'dj', stack: [] });
  });
  expect(m.title()).toBe('iTunes DJ');
  const press = async (i: number) => {
    act(() => { fireEvent.pointerDown(m.$('tr[data-i="' + i + '"]'), { button: 0, clientX: 10, clientY: 10 }); });
    await act(() => new Promise((r) => setTimeout(r, LONG_MS + 50)));
    act(() => { fireEvent.pointerUp(m.$('tr[data-i="' + i + '"]')); });
    return within(m.ui.getByRole('menu'));
  };
  let sheet = await press(1);
  expect(sheet.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Move to Top', 'Move Up', 'Move Down', 'Remove from Up Next']));
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Move Up' })); });
  expect(reorder).toHaveBeenLastCalledWith([1, 0, 2]);
  expect(m.cmd.playContext).not.toHaveBeenCalled();          // the press that opened the sheet played nothing
  expect(m.ui.queryByRole('menu')).toBeNull();               // a choice closes it
  sheet = await press(0);
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Remove from Up Next' })); });
  expect(reorder).toHaveBeenLastCalledWith([1, 2]);
  expect(m.S().queue.next.map((t) => t.title)).toEqual(['Song 1', 'Song 3']);
});

it('the source list’s field searches Spotify; its Search key opens STORE > Search Results, which keeps a field of its own', async () => {
  const m = await phone();
  act(() => { fireEvent.click(m.$('#bback')); });
  m.cmd.search.mockImplementation((q) => { m.S().actions.setUi({ searchQ: q as string }); });
  const box = m.$('[data-search-box]') as HTMLInputElement;
  act(() => { fireEvent.change(box, { target: { value: 'queen' } }); });
  act(() => { fireEvent.keyDown(box, { key: 'Enter' }); });
  await settle();
  expect(m.cmd.search).toHaveBeenLastCalledWith('queen');
  expect(m.title()).toBe('Search Results');
  expect((m.$('[data-search-box]') as HTMLInputElement).value).toBe('queen');
});

it('Preferences: the Playback section only with the host’s own player; its switches and the skin list set the settings', async () => {
  const m = await phone();
  act(() => { fireEvent.click(m.$('#bprefs')); });
  expect(m.title()).toBe('Preferences');
  expect(m.ui.queryByText('PLAYBACK')).toBeNull();
  act(() => { m.S().actions.setAuth({ hostPlayer: true }); });
  expect(m.ui.getByText('PLAYBACK')).toBeTruthy();
  act(() => { fireEvent.click(m.$('#pnormalise')); });
  expect(m.S().settings.normalise).toBe(false);
  act(() => { fireEvent.click(m.$('#pskin')); });
  act(() => { fireEvent.click(m.ui.getByText('iPod nano')); });
  expect(m.S().settings.skin).toBe('ipod');
});

it('a list’s head: Genius plays the playlist’s radio', async () => {
  const m = await phone();
  act(() => { itunesView.setState({ source: PL, stack: [] }); });
  await settle();
  act(() => { fireEvent.click(within(m.$('#listacts')).getByText('Genius')); });
  await settle();
  expect(m.queries.fetchRadio).toHaveBeenCalledWith([{ seed: PL, name: 'Road Trip Radio', sub: '' }]);
  expect(m.cmd.playContext).toHaveBeenCalledExactlyOnceWith('spotify:playlist:radio', null);
});

it('a show’s episodes newest first, the unplayed one dotted', async () => {
  const m = await phone();
  act(() => { itunesView.setState({ source: 'podcasts', stack: [SHOW] }); });
  await settle();
  const rows = [...m.getByTestId('phone').querySelectorAll('#tracks tbody tr')].map((r) => [r.children[1]!.textContent, r.children[2]!.textContent]);
  expect(rows).toEqual([['●', 'Song 22'], ['', 'Song 21']]);
});

it('Up Next: a row dragged by its grip lands where it is let go (one reorderQueue)', async () => {
  const m = await phone();
  const reorder = vi.fn();
  act(() => {
    m.S().actions.setQueue([track(1), track(2), track(3)]);
    m.S().actions.setCommands({ ...m.S().commands, reorderQueue: reorder });
    itunesView.setState({ source: 'dj', stack: [] });
  });
  const grip = m.$('tr[data-i="0"] > td:last-child');
  expect(grip.textContent).toBe('≡');
  // jsdom lays nothing out (a row 0 px tall reads as 1): each px moved is a row's 36
  act(() => { fireEvent.pointerDown(grip, { button: 0, clientY: 100 }); });
  act(() => { fireEvent.pointerMove(grip, { clientY: 102 }); });
  act(() => { fireEvent.pointerUp(grip, { clientY: 102 }); });
  expect(reorder).toHaveBeenCalledExactlyOnceWith([1, 2, 0]);
  expect(m.cmd.playContext).not.toHaveBeenCalled();
});

it('Now Playing: the play order in Cover Flow (played, playing, Up Next); a side cover browses, springs back, plays on a second tap', async () => {
  const m = await phone();
  const playing = (n: number) => m.S().actions.setPlayback({ status: 'playing', track: track(n, PL), context: { uri: PL, kind: 'playlist', label: 'Playlist: Road Trip' } });
  act(() => { playing(1); });
  const reorder = vi.fn();
  act(() => { playing(2); m.S().actions.setQueue([track(3), track(4)]); m.S().actions.setCommands({ ...m.S().commands, reorderQueue: reorder }); nav.push('now'); });
  const flow = () => m.$('#npflow'), front = () => flow().querySelector('[data-front]')!.getAttribute('title');
  expect([...flow().querySelectorAll('[title]')].map((c) => c.getAttribute('title'))).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4']);
  expect(front()).toBe('Song 2');
  vi.useFakeTimers();
  try {
    act(() => { fireEvent.click(flow().querySelector('[title="Song 4"]')!); });
    expect(front()).toBe('Song 4');
    expect(flow().textContent).toContain('tap to play');
    act(() => { vi.advanceTimersByTime(BROWSE_MS + 50); });
    expect(front()).toBe('Song 2');                                  // sprang back
    act(() => { fireEvent.click(flow().querySelector('[title="Song 4"]')!); });
    act(() => { fireEvent.click(flow().querySelector('[data-front]')!); });
    expect(reorder).toHaveBeenCalledExactlyOnceWith([1]);              // Song 3 leaves Up Next…
    expect(m.cmd.next).toHaveBeenCalledOnce();                       // …and Song 4 is skipped to
    act(() => { fireEvent.click(flow().querySelector('[title="Song 1"]')!); });
    act(() => { vi.advanceTimersByTime(500); fireEvent.click(flow().querySelector('[data-front]')!); });
    expect(m.cmd.playContext).toHaveBeenCalledWith(PL, 'spotify:track:1');   // a played song again, in its context
  } finally { vi.useRealTimers(); }
  // the mini player stays on Now Playing and is its transport; the page adds only Like, Lyrics and Up Next
  const phoneEl = m.getByTestId('phone');
  expect(phoneEl.querySelector('[id="toolbar"]')).not.toBeNull();
  expect(phoneEl.querySelector('[id="npplay"]')).toBeNull();
  expect(phoneEl.querySelector('[id="npseek"]')).toBeNull();
  act(() => { fireEvent.click(phoneEl.querySelector('[id="toolbar"] [id="bplay"]')!); });
  expect(m.cmd.playPause).toHaveBeenCalledOnce();
});

it('Play On (the AirPlay button) carries the volume of what plays: a Connect speaker’s has no other place', async () => {
  const m = await phone();
  // (by role: the WMP 9 skin the harness mounts has a #bdevice too, and jsdom resolves an id document-wide)
  act(() => { fireEvent.click(m.ui.getByRole('button', { name: 'Play On' })); });
  const vol = within(m.ui.getByRole('menu', { name: 'Play On' })).getByRole('slider', { name: 'Volume' });
  act(() => { fireEvent.keyDown(vol, { key: 'ArrowLeft' }); });
  expect(m.S().settings.volume).toBe(95);
});

it('a keyboard the host reports while none of the layout’s fields has the focus changes nothing (iOS’s zero end frame: a whole screen of it)', async () => {
  const m = await phone();
  act(() => { window.__wmpKeyboard = 844; window.dispatchEvent(new Event('wmp-keyboard')); });
  const at = (id: string) => m.getByTestId('phone').querySelector('[id="' + id + '"]');
  expect(at('bottombar')).toBeTruthy();
  expect(at('tracks')).toBeTruthy();
  act(() => { window.__wmpKeyboard = 0; window.dispatchEvent(new Event('wmp-keyboard')); });
});

it('a page that throws shows the way back and says so in the host’s log, the layout standing', () => {
  const log = vi.fn();
  window.alchemyLog = log;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Boom = () => { throw new Error('boom'); };
  const r = render(<PageGuard reset="a"><Boom /></PageGuard>);
  expect(log).toHaveBeenCalledWith('itunes: boom');
  act(() => { phoneNav.setState({ pages: ['sources', 'source'] }); fireEvent.click(r.getByText('Back to iTunes')); });
  expect(phoneNav.getState().pages).toEqual(['sources']);
  delete window.alchemyLog;
  vi.restoreAllMocks();
});

it('a list’s Shuffle plays it whole, shuffled; LIBRARY’s Albums opens Music’s Grid on its albums; a cover’s long press offers Play and Shuffle', async () => {
  const m = await phone();
  act(() => { itunesView.setState({ source: PL, stack: [] }); });
  await settle();
  act(() => { fireEvent.click(within(m.$('#listacts')).getByRole('button', { name: 'Shuffle Road Trip' })); });
  expect(m.cmd.toggleShuffle).toHaveBeenCalledOnce();
  expect(m.cmd.playAll).toHaveBeenCalledExactlyOnceWith(PL);
  act(() => { fireEvent.click(m.$('#bback')); });
  act(() => { fireEvent.mouseDown(m.$('[data-source="albums"]')); });
  await settle();
  expect([itunesView.getState().source, itunesView.getState().views.music, itunesView.getState().gridTab]).toEqual(['music', 'grid', 'albums']);
  const tile = m.$('button[data-uri="spotify:album:lp"]');
  act(() => { fireEvent.pointerDown(tile, { button: 0, clientX: 5, clientY: 5 }); });
  await act(() => new Promise((r) => setTimeout(r, LONG_MS + 50)));
  act(() => { fireEvent.pointerUp(tile); });
  const sheet = within(m.ui.getByRole('menu', { name: 'LP' }));
  expect(sheet.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Open', 'Play', 'Shuffle', 'Save to Library', 'Start Genius']);
  act(() => { fireEvent.click(sheet.getByText('Play')); });
  expect(m.cmd.playAll).toHaveBeenLastCalledWith('spotify:album:lp');
});

it('the phone on its side shows Cover Flow alone', async () => {
  size(844, 390);
  const m = await phone();
  expect(m.$('#landscape')).toBeTruthy();
  expect(m.$('#toolbar')).toBeNull();
});

it('fits the iPhone 4’s 320 points to the narrow side of the viewport, whatever its CSS px', () => {
  // the iOS app's desktop content mode: 980 CSS px across a 390-point phone
  expect(fit(980, 2121, 390)).toMatchObject({ s: 980 / 320, w: 320, landscape: false, pt: 320 / 390 });
  expect(fit(980, 453, 390)).toMatchObject({ h: 320, landscape: true });
  // a plain mobile browser (a point is a CSS px), and no screen report
  expect(fit(390, 844, 0).pt).toBeCloseTo(320 / 390);
});

/** a finger held on `el` until its sheet opens; the sheet */
async function hold(m: Awaited<ReturnType<typeof phone>>, el: HTMLElement) {
  act(() => { fireEvent.pointerDown(el, { button: 0, clientX: 5, clientY: 5 }); });
  await act(() => new Promise((r) => setTimeout(r, LONG_MS + 50)));
  act(() => { fireEvent.pointerUp(el); });
  return within(m.ui.getByRole('menu'));
}
const plays = (m: Awaited<ReturnType<typeof phone>>) => (['playContext', 'playItem', 'playAll', 'playPause', 'play'] as const).filter((k) => m.cmd[k].mock.calls.length);

it('a tap on a cover opens it and plays nothing, the playing one’s too (its ▶ is the corner’s)', async () => {
  const m = await phone();
  act(() => {
    m.S().actions.setPlayback({ status: 'playing', track: track(1), context: { uri: 'spotify:album:lp', kind: 'album', label: 'Album: LP' } });
    itunesView.setState({ source: 'music', views: { music: 'grid' }, stack: [] });
  });
  await settle();
  const tile = m.$('button[data-uri="spotify:album:lp"]');
  expect(tile.hasAttribute('data-current')).toBe(true);
  act(() => { fireEvent.click(tile.querySelector('span')!, { detail: 1 }); });
  expect(itunesView.getState().stack).toEqual(['spotify:album:lp']);
  expect(plays(m)).toEqual([]);
});

it('PLAYLISTS’ Add Playlist… asks the name in the system’s alert, makes the playlist and opens it; a playlist’s long press deletes it, asked again', async () => {
  const m = await phone(), createPlaylist = vi.fn(() => Promise.resolve('spotify:playlist:gym')), deletePlaylist = vi.fn(() => Promise.resolve(true));
  const ask = vi.spyOn(window, 'prompt').mockReturnValue(' Gym ');
  act(() => { m.S().actions.setCommands({ ...m.S().commands, createPlaylist, deletePlaylist }); fireEvent.click(m.$('#bback')); });
  act(() => { fireEvent.mouseDown(m.$('[data-source="newplaylist"]')); });
  await settle();
  expect(ask).toHaveBeenCalledOnce();
  expect(createPlaylist).toHaveBeenCalledExactlyOnceWith('Gym');
  expect([itunesView.getState().source, phoneNav.getState().pages]).toEqual(['spotify:playlist:gym', ['sources', 'source']]);
  ask.mockRestore();
  act(() => { fireEvent.click(m.$('#bback')); itunesView.setState({ source: PL }); });
  let sheet = await hold(m, m.$('[data-source="' + PL + '"]'));
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Delete Playlist' })); });
  sheet = within(m.ui.getByRole('menu'));                                // asked again, red
  expect(deletePlaylist).not.toHaveBeenCalled();
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Delete Playlist' })); });
  await settle();
  expect(deletePlaylist).toHaveBeenCalledExactlyOnceWith(PL);
  expect(itunesView.getState().source).toBe('music');
});

it('an episode’s long press marks it played; iTunes DJ’s Clear (in its strip) while songs the user queued are in Up Next', async () => {
  const m = await phone(), markPlayed = vi.fn(() => Promise.resolve()), clearQueue = vi.fn(() => Promise.resolve());
  act(() => { m.S().actions.setCommands({ ...m.S().commands, markPlayed, clearQueue }); itunesView.setState({ source: 'podcasts', stack: [SHOW] }); });
  await settle();
  const sheet = await hold(m, m.$('tr[data-i="0"]'));                    // newest first: Song 22, unplayed
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Mark as Played' })); });
  expect(markPlayed).toHaveBeenCalledExactlyOnceWith('spotify:episode:22', true);
  act(() => { m.S().actions.setQueue([track(4), track(5)]); itunesView.setState({ source: 'dj', stack: [] }); });
  expect(m.ui.queryByRole('button', { name: 'Clear the songs you queued' })).toBeNull();
  act(() => { m.S().actions.setQueue([{ ...track(4), queued: true }, track(5)]); });
  act(() => { fireEvent.click(m.ui.getByRole('button', { name: 'Clear the songs you queued' })); });
  expect(clearQueue).toHaveBeenCalledOnce();
});

it('the bottom bar’s shuffle cycles Off, Shuffle, Smart Shuffle (a sparkle), Off; Now Playing’s ••• names the three', async () => {
  const m = await phone();
  const setShuffleMode = vi.fn((mode: ShuffleMode) => { m.S().actions.setPlayback({ shuffle: mode !== 'off', shuffleMode: mode }); return Promise.resolve(); });
  act(() => {
    m.S().actions.setCommands({ ...m.S().commands, setShuffleMode });
    m.S().actions.setPlayback({ status: 'playing', track: track(1, PL), canSmartShuffle: true });
  });
  const b = () => m.getByTestId('phone').querySelector<HTMLElement>('[id="bshuffle"]')!;
  for (let i = 0; i < 5; i++) act(() => { fireEvent.click(b()); });
  expect(setShuffleMode.mock.calls.map((c) => c[0])).toEqual(['shuffle', 'smart', 'off', 'shuffle', 'smart']);
  expect([b().getAttribute('data-mode'), b().querySelectorAll('svg').length]).toEqual(['smart', 2]);
  act(() => { nav.push('now'); });
  act(() => { fireEvent.click(m.$('#npmore')); });
  act(() => { fireEvent.click(m.ui.getByRole('menuitem', { name: 'Shuffle: Smart Shuffle…' })); });
  const sheet = within(m.ui.getByRole('menu', { name: 'Shuffle' }));
  expect(sheet.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['Off', 'Shuffle', '✓ Smart Shuffle']);
  act(() => { fireEvent.click(sheet.getByRole('menuitem', { name: 'Off' })); });
  expect(setShuffleMode).toHaveBeenLastCalledWith('off');
});
