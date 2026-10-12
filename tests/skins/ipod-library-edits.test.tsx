// The four Spotify features the app learned (commands.createPlaylist / deletePlaylist, markPlayed, clearQueue,
// setShuffleMode) in the iPod's idioms: Library > Playlists > New Playlist… (the platform's prompt, then the
// playlist opened); Delete Playlist in an own playlist's "…" menu, behind the red confirm; an episode's
// hold-centre (and Now Playing's ♪) Mark as Played / Unplayed; the Queue's last row Clear Queue while the
// user has queued songs; and the shuffle toggles stepping Off -> Shuffle -> Smart Shuffle where it is offered.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Commands, LibraryItem, Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { StatusRow } from '../../src/skins/ipod/ui';
import { fakeData, mountSkinNow, settle, type FakeData } from './harness';

// Now Playing watches whether it is on screen (jsdom has no IntersectionObserver: this one never calls back, so it is)
beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

const MINE = 'spotify:playlist:mine', NEW = 'spotify:playlist:new', SHOW = 'spotify:show:hf';
const track = (n: number, o: Partial<Track> = {}): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', duration: 1, ...o });
const ep = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:episode:e' + n, title: 'Episode ' + n, artist: 'Hard Fork', duration: 60_000, ctx: SHOW, releaseDate: '2026-09-0' + n, ...o });

/** the iPod over `data` with the optional commands `extra` (spies), on the main menu */
function mount(data: Partial<FakeData> = {}, extra: Partial<Commands> = {}) {
  const m = mountSkinNow('spotify', fakeData(data), <div data-testid="ipod"><Root /></div>);
  act(() => { m.store.getState().actions.setCommands({ ...m.store.getState().commands, ...extra }); });
  Object.assign(m.queries, { fetchShows: vi.fn(() => Promise.resolve([{ uri: SHOW, name: 'Hard Fork' }] as LibraryItem[])) });
  m.queries.keys.shows = () => ['fake', 'library', 'shows'];
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const wheel = within(ipod).getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  const option = (text: string) => shown('[role=option]').find((x) => x.textContent?.startsWith(text));
  return {
    ...m, shown, option,
    rows: () => shown('[role=option]').map((x) => x.textContent),
    /** the popup's rows (a popup over a list: its sheet's options), each with whether it is dimmed */
    menu: () => shown('[role=option]').filter((x) => x.closest('[class*=sheet]')).map((x) => [x.textContent, x.hasAttribute('aria-disabled')]),
    click: async (text: string) => { act(() => { fireEvent.click(option(text)!); }); await settle(); },
    /** hold-centre (a right-click on the wheel's centre is its hold at once) */
    hold: () => act(() => {
      fireEvent.pointerDown(wheel, { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(wheel, { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
    }),
    /** the confirm list's rows (plain rows, not options), red first */
    confirmRows: () => shown('div').filter((x) => !x.children.length && /^(Delete Playlist|Clear Queue|Cancel)$/.test(x.textContent ?? '')
                                              && !x.closest('[role=option]')).map((x) => x.textContent),
    /** the screen's title in the status row */
    title: () => shown('[class*=status] > :first-child')[0]?.textContent,
    library: async () => { key('ArrowDown'); key('ArrowDown'); key('Enter'); await settle(); },
  };
}

it('New Playlist…: a Playlists tile over the user\'s playlists (only with the command); the name asked, the playlist made and opened', async () => {
  const prompt = vi.fn(() => '  Road Songs '), create = vi.fn(() => Promise.resolve(NEW));
  vi.stubGlobal('prompt', prompt);
  const mine: LibraryItem = { uri: MINE, name: 'lawnmower classics', owner: 'me', editable: true };
  const m = mount({ list: [mine], collections: { [NEW]: { meta: { kind: 'playlist', name: 'Road Songs', total: 0 }, tracks: [] } } }, { createPlaylist: create });
  await m.library();
  expect(m.rows().slice(4)).toEqual(['QueueUp next', 'Liked SongsPlaylist · 0 songs', 'New Playlist…', 'lawnmower classicsPlaylist · me']);
  await m.click('New Playlist…');
  expect(prompt).toHaveBeenCalledWith('New Playlist', '');
  expect(create).toHaveBeenCalledExactlyOnceWith('Road Songs');
  expect(m.title()).toBe('Road Songs');
  expect(m.shown('[data-head]')[0]!.textContent).toContain('Road Songs');
  key('Escape');
  prompt.mockReturnValue(null as unknown as string);                   // Cancel: nothing made
  await m.click('New Playlist…');
  expect(create).toHaveBeenCalledTimes(1);
  cleanup();
  const w = mount({ list: [mine] });                                    // an engine without the command: no tile
  await w.library();
  expect(w.rows()).not.toContain('New Playlist…');
});

it('Delete Playlist: in the own playlist\'s "…" menu, behind the red confirm that opens on Cancel; Delete goes back to the Library and asks Spotify', async () => {
  const del = vi.fn(() => Promise.resolve(true));
  const m = mount({ list: [{ uri: MINE, name: 'lawnmower classics', owner: 'me', editable: true }, { uri: 'spotify:playlist:theirs', name: 'theirs', owner: 'x' }],
                    collections: { [MINE]: { meta: { kind: 'playlist', name: 'lawnmower classics', total: 1 }, tracks: [track(1)] } } }, { deletePlaylist: del });
  await m.library();
  await m.click('lawnmower classics');
  act(() => { fireEvent.click(m.shown('[aria-label=More]')[0]!); });
  expect(m.menu().map(([l]) => l)).toEqual(['Start Radio', 'Delete Playlist', 'Cancel']);
  await m.click('Delete Playlist');
  expect(m.title()).toBe('lawnmower classics');                        // the confirm, on the playlist's name
  expect(m.confirmRows()).toEqual(['Delete Playlist', 'Cancel']);
  key('Enter');                                                        // it opens on Cancel: back, nothing deleted
  expect(del).not.toHaveBeenCalled();
  expect(m.shown('[data-head]').length).toBe(1);
  act(() => { fireEvent.click(m.shown('[aria-label=More]')[0]!); });
  await m.click('Delete Playlist');
  key('ArrowUp'); key('Enter');                                        // Delete Playlist, the red row
  expect(del).toHaveBeenCalledExactlyOnceWith(MINE);
  expect(m.title()).toBe('Library');
});

it('a followed playlist\'s menu has no Delete Playlist (Remove from Library is its way out)', async () => {
  const m = mount({ list: [{ uri: MINE, name: 'theirs', owner: 'x' }], collections: { [MINE]: { meta: { kind: 'playlist', name: 'theirs', total: 1 }, tracks: [track(1)] } } },
                  { deletePlaylist: vi.fn() });
  await m.library();
  await m.click('theirs');
  act(() => { fireEvent.click(m.shown('[aria-label=More]')[0]!); });
  expect(m.menu().map(([l]) => l)).toEqual(['Remove from Library', 'Start Radio', 'Cancel']);
});

it('an episode\'s hold-centre: Mark as Played / Unplayed, what is already so dimmed; the blue dot follows at once', async () => {
  let m: ReturnType<typeof mount> | null = null;
  const mark = vi.fn((uri: string, played: boolean) => { m!.store.getState().actions.setPlayed(uri, played); return Promise.resolve(); });
  m = mount({ collections: { [SHOW]: { tracks: [ep(2, { unplayed: true }), ep(1, { unplayed: false })] } } }, { markPlayed: mark });
  await m.library();
  await m.click('Podcasts');
  key('Enter');                                                        // Hard Fork's episodes
  await settle();
  const dots = () => m.shown('[role=option] [aria-label=Unplayed]').map((x) => x.closest('[role=option]')!.textContent?.slice(0, 9));
  expect(dots()).toEqual(['Episode 2']);
  m.hold();
  expect(m.menu()).toEqual([['Mark as Played', false], ['Mark as Unplayed', true], ['Cancel', false]]);
  await m.click('Mark as Played');
  expect(mark).toHaveBeenCalledExactlyOnceWith('spotify:episode:e2', true);
  expect(dots()).toEqual([]);
  m.hold();
  expect(m.menu()).toEqual([['Mark as Played', true], ['Mark as Unplayed', false], ['Cancel', false]]);
  await m.click('Mark as Unplayed');
  expect(mark).toHaveBeenLastCalledWith('spotify:episode:e2', false);
  expect(dots()).toEqual(['Episode 2']);
});

it('Now Playing\'s ♪ menu has Mark as Played / Unplayed for an episode, never for a song', async () => {
  const mark = vi.fn(() => Promise.resolve());
  const m = mount({ collections: { [SHOW]: { tracks: [ep(1, { unplayed: true })] } } }, { markPlayed: mark });
  const songs = () => { act(() => { fireEvent.click(m.shown('[aria-label=Track]')[0]!); }); return m.menu().map(([l]) => l); };
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'playing', track: ep(1) } })); });
  act(() => { fireEvent.click(m.shown('[aria-label="Now Playing"]')[0]!); });   // the bar under the menu
  await settle();
  expect(songs()).toEqual(expect.arrayContaining(['Mark as Played', 'Mark as Unplayed']));
  expect(m.menu().find(([l]) => l === 'Mark as Unplayed')![1]).toBe(true);   // its row's dot shows
  await m.click('Mark as Played');
  expect(mark).toHaveBeenCalledWith('spotify:episode:e1', true);
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, track: track(1) } })); });
  expect(songs()).not.toContain('Mark as Played');
});

it('Clear Queue: the Queue\'s last row while the user has queued songs, behind the red confirm; none with only the context\'s', async () => {
  const clear = vi.fn(() => Promise.resolve());
  const m = mount({}, { clearQueue: clear });
  act(() => { m.store.getState().actions.setQueue([track(1, { queued: true }), track(2)]); });
  await m.library();
  key('Enter');                                                        // the Queue
  await settle();
  expect(m.rows()).toEqual(['Song 1Queen', 'Song 2Queen', 'Clear Queue']);
  key('ArrowDown'); key('ArrowDown');
  key('Enter');
  expect([m.title(), m.confirmRows()]).toEqual(['Clear Queue', ['Clear Queue', 'Cancel']]);
  key('ArrowUp'); key('Enter');                                        // the red row
  expect(clear).toHaveBeenCalledTimes(1);
  expect(m.title()).toBe('Queue');
  act(() => { m.store.getState().actions.setQueue([track(2)]); });     // what the player says next: only the context's
  expect(m.rows()).toEqual(['Song 2Queen']);
});

it('the status row\'s shuffle steps Off -> Shuffle -> Smart Shuffle (its own glyph) -> Off where the player offers it, and skips it where not', () => {
  const smart = vi.fn(() => Promise.resolve());
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="row"><StatusRow title="" dark /></div>);
  act(() => { m.store.getState().actions.setCommands({ ...m.store.getState().commands, setShuffleMode: smart }); });
  const row = within(m.getByTestId('row')), play = (o: object) => act(() => { m.store.setState((s) => ({ playback: { ...s.playback, ...o } })); });
  const tap = (name: string) => act(() => { fireEvent.click(row.getByRole('button', { name })); });
  tap('Shuffle');                                                      // Off -> Shuffle
  expect([m.cmd.toggleShuffle.mock.calls.length, smart.mock.calls.length]).toEqual([1, 0]);
  play({ shuffle: true, shuffleMode: 'shuffle', canSmartShuffle: false });
  tap('Shuffle');                                                      // the phone's speaker: no Smart Shuffle, Off
  expect([m.cmd.toggleShuffle.mock.calls.length, smart.mock.calls.length]).toEqual([2, 0]);
  play({ canSmartShuffle: true });
  tap('Shuffle');                                                      // Shuffle -> Smart Shuffle
  expect(smart).toHaveBeenCalledExactlyOnceWith('smart');
  play({ shuffleMode: 'smart' });
  const glyph = row.getByRole('button', { name: 'Smart Shuffle' });
  expect([glyph.getAttribute('aria-pressed'), glyph.querySelectorAll('path').length]).toEqual(['true', 3]);   // the sparkle
  tap('Smart Shuffle');                                                // Smart Shuffle -> Off
  expect([m.cmd.toggleShuffle.mock.calls.length, smart.mock.calls.length]).toEqual([3, 1]);
});

it('a collection header\'s Shuffle steps the same way, its button Smart Shuffle\'s while on', async () => {
  const smart = vi.fn(() => Promise.resolve());
  const m = mount({ list: [{ uri: MINE, name: 'lawnmower classics', owner: 'me' }],
                    collections: { [MINE]: { meta: { kind: 'playlist', name: 'lawnmower classics', total: 1 }, tracks: [track(1)] } } }, { setShuffleMode: smart });
  await m.library();
  await m.click('lawnmower classics');
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, shuffle: true, shuffleMode: 'shuffle', canSmartShuffle: true } })); });
  act(() => { fireEvent.click(m.shown('[data-kind=shuffle]')[0]!); });
  expect(smart).toHaveBeenCalledExactlyOnceWith('smart');
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, shuffleMode: 'smart' } })); });
  const b = m.shown('[data-kind=smart]')[0]!;
  expect([b.getAttribute('aria-label'), b.getAttribute('aria-checked')]).toEqual(['Smart Shuffle', 'true']);
  act(() => { fireEvent.click(b); });
  expect(m.cmd.toggleShuffle).toHaveBeenCalledTimes(1);
});
