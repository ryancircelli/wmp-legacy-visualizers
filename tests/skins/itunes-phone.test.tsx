// The iTunes skin's phone layout: the source list as navigation (a tap opens a source, ‹ goes back), a
// tap on a song plays it in its context and the list ends on its status line, a long press opens its
// sheet (iTunes DJ's moves and removal asking the engine for Up Next's new order), search from the
// source list's field, Preferences' sound section only with the host's own player, and the fit onto the
// iOS app's desktop-wide viewport.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIKED, type Track } from '../../src/model';
import { fit } from '../../src/skins/itunes/phone/host';
import { phoneNav } from '../../src/skins/itunes/phone/nav';
import { PhoneRoot } from '../../src/skins/itunes/phone/Root';
import { LONG_MS } from '../../src/skins/itunes/phone/Sheet';
import { DEFAULT_VIEW, itunesView } from '../../src/skins/itunes/shared';
import { fakeData, mountSkinNow, settle } from './harness';

const PL = 'spotify:playlist:road';
const track = (n: number, ctx?: string): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Band', album: 'LP', duration: 180000, ctx });

// a phone held upright (jsdom's 1024 x 768 window would be one on its side: Cover Flow alone)
const wide = [window.innerWidth, window.innerHeight] as const;
const size = (w: number, h: number) => { Object.defineProperty(window, 'innerWidth', { value: w, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: h, configurable: true }); };
beforeEach(() => { size(390, 844); phoneNav.setState({ pages: ['sources', 'source'] }); itunesView.setState(DEFAULT_VIEW); });
afterEach(() => { cleanup(); localStorage.clear(); size(...wide); });

async function phone() {
  const m = mountSkinNow('spotify', fakeData({
    list: [{ uri: PL, name: 'Road Trip', owner: 'ryan' }],
    collections: { [PL]: { tracks: [1, 2, 3].map((n) => track(n, PL)) }, [LIKED]: { tracks: [track(9, LIKED)] } },
  }), <div data-testid="phone"><PhoneRoot /></div>);
  await settle();
  const ui = within(m.getByTestId('phone'));
  const $ = (sel: string) => m.getByTestId('phone').querySelector<HTMLElement>(sel)!;
  return { ...m, ui, $, title: () => $('#striptitle')?.textContent };
}

it('opens on the selected source; ‹ shows the source list, a tap opens a playlist (its status line its last row) and a tap on a song plays it there', async () => {
  const m = await phone();
  expect(m.title()).toBe('Music');
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
