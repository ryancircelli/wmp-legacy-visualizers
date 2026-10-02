// The iPod's Search: a real search field (the phone's keyboard) over the results; the wheel walks
// the field then the results, and keys typed into the field stay there.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { LibraryItem, Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { emptyResults, fakeData, mountSkinNow, settle } from './harness';

afterEach(() => { cleanup(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
const track = (n: number): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', duration: 1 });
const artist: LibraryItem = { uri: 'spotify:artist:q', name: 'Queen' };

/** the iPod on its Search screen, 'queen' finding two songs and an artist */
async function onSearch() {
  const data = fakeData({ search: { queen: { ...emptyResults(), tracks: { items: [track(1), track(2)], total: 2, offset: 0, exact: true, hasMore: false },
                                             artists: { items: [artist], total: 1, offset: 0, exact: true, hasMore: false } } } });
  const m = mountSkinNow('spotify', data, <div data-testid="ipod"><Root /></div>);
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  key('ArrowDown');
  key('Enter');
  await settle();
  const field = () => shown('input[type=search]')[0]!;
  return {
    ...m, field, shown,
    sel: () => shown('[aria-selected=true]').map((x) => x.textContent),
    type: (v: string) => act(() => { fireEvent.change(field(), { target: { value: v } }); }),
    focused: () => document.activeElement === field(),
  };
}

it('the letter picker is gone: a search field, the wheel on it, not focused until asked', async () => {
  const m = await onSearch();
  expect(m.field()).toBeTruthy();
  expect(m.field().getAttribute('enterkeyhint')).toBe('search');
  expect(m.getByTestId('ipod').textContent).not.toContain('ABCDEFGHIJ');
  expect(m.focused()).toBe(false);
  key('Enter');                                        // the centre on the field: focus, so the keyboard
  expect(m.focused()).toBe(true);
});

it('typing searches after the debounce and lists the results; the keyboard\'s Search closes it and selects the first', async () => {
  const m = await onSearch();
  act(() => { m.field().focus(); });
  m.type('queen');
  expect(m.queries.fetchSearch).not.toHaveBeenCalledWith('queen', 'all');
  await act(() => new Promise((r) => setTimeout(r, 450)));
  await settle();
  expect(m.queries.fetchSearch).toHaveBeenCalledWith('queen', 'all');
  expect(m.shown('[role=option]').map((x) => x.textContent)).toEqual(['Song 1Queen', 'Song 2Queen', 'QueenArtist']);
  expect(m.sel()).toEqual([]);                         // the wheel is on the field while typing
  act(() => { fireEvent.keyDown(m.field(), { key: 'Enter' }); });
  expect(m.focused()).toBe(false);
  expect(m.sel()).toEqual(['Song 1Queen']);
});

it('Enter searches at once, before the debounce', async () => {
  const m = await onSearch();
  act(() => { m.field().focus(); });
  m.type('queen');
  act(() => { fireEvent.keyDown(m.field(), { key: 'Enter' }); });
  await settle();
  expect(m.sel()).toEqual(['Song 1Queen']);
});

it('× clears the field and the results, and puts the focus back', async () => {
  const m = await onSearch();
  m.type('queen');
  act(() => { fireEvent.keyDown(m.field(), { key: 'Enter' }); });
  await settle();
  act(() => { fireEvent.click(m.getByLabelText('Clear')); });
  await settle();
  expect((m.field() as HTMLInputElement).value).toBe('');
  expect(m.shown('[role=option]')).toEqual([]);
  expect(m.queryByLabelText('Clear')).toBeNull();
  expect(m.focused()).toBe(true);
});

it('unfocused, the wheel walks the field then the results; typed keys stay in the field; MENU closes the keyboard, then goes back', async () => {
  const m = await onSearch();
  m.type('queen');
  act(() => { fireEvent.keyDown(m.field(), { key: 'Enter' }); });
  await settle();
  key('ArrowDown');
  expect(m.sel()).toEqual(['Song 2Queen']);
  key('ArrowDown');
  expect(m.sel()).toEqual(['QueenArtist']);
  key('ArrowDown');                                    // the end
  expect(m.sel()).toEqual(['QueenArtist']);
  key('ArrowUp'); key('ArrowUp'); key('ArrowUp');      // up onto the field
  expect(m.sel()).toEqual([]);
  key('Enter');
  expect(m.focused()).toBe(true);
  // arrows and Backspace typed into the field are the field's, not the wheel's
  act(() => { fireEvent.keyDown(m.field(), { key: 'ArrowDown' }); fireEvent.keyDown(m.field(), { key: 'Backspace' }); });
  expect(m.focused()).toBe(true);
  expect(m.sel()).toEqual([]);
  act(() => { fireEvent.keyDown(m.field(), { key: 'Escape' }); });   // MENU: the keyboard closes
  expect(m.focused()).toBe(false);
  expect(m.field()).toBeTruthy();
  key('Escape');                                       // MENU again: back to the main menu
  expect(m.shown('input[type=search]')).toEqual([]);
  expect(m.sel()).toEqual(['Search']);
});
