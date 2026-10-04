// The iPod's Queue edited in place: hold-centre on a row opens Play Next, Move Up, Move Down, Remove from
// Queue, Cancel; each asks the engine's reorderQueue for the new order, the list follows the store, and the
// selection follows the row it moved. Without reorderQueue (the local engine) the song's own menu.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { fakeData, mountSkinNow, settle } from './harness';

afterEach(() => { cleanup(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
const track = (n: number): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', duration: 1 });

/** the iPod on the Queue (Library's first tile) with three songs; `edits`: the engine has reorderQueue
 *  (a spy that reorders the store's queue, as the adapter's optimistic update does) */
async function onQueue(edits = true) {
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  const reorder = vi.fn((order: readonly number[]) => {
    const q = m.store.getState().queue.next;
    m.store.getState().actions.setQueue(order.map((i) => q[i]!));
  });
  act(() => {
    m.store.getState().actions.setQueue([track(1), track(2), track(3)]);
    if (edits) m.store.getState().actions.setCommands({ ...m.store.getState().commands, reorderQueue: reorder });
  });
  key('ArrowDown'); key('ArrowDown'); key('Enter');                 // the main menu's Library
  await settle();
  key('Enter');                                                     // its first tile: the Queue
  await settle();
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const options = () => shown('[role=option]');
  const wheel = within(ipod).getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return {
    ...m, reorder,
    songs: () => options().filter((x) => x.textContent?.startsWith('Song')).map((x) => x.textContent),
    sel: () => options().filter((x) => x.getAttribute('aria-selected') === 'true').map((x) => x.textContent),
    /** hold-centre (a right-click on the wheel's centre is its hold at once) */
    hold: () => act(() => {
      fireEvent.pointerDown(wheel, { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(wheel, { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
    }),
    /** the popup's rows: label, and whether it is dimmed */
    menu: () => options().filter((x) => !x.textContent?.startsWith('Song')).map((x) => [x.textContent, x.hasAttribute('aria-disabled')]),
    pick: (label: string) => act(() => { fireEvent.click(options().find((x) => x.textContent === label)!); }),
  };
}

it('hold-centre on a song: Play Next, Move Up, Move Down, Remove from Queue, Cancel; Move Up asks for the new order and the selection follows it', async () => {
  const m = await onQueue();
  key('ArrowDown');                                                 // Song 2
  m.hold();
  expect(m.menu()).toEqual([['Play Next', false], ['Move Up', false], ['Move Down', false], ['Remove from Queue', false], ['Cancel', false]]);
  m.pick('Move Up');
  expect(m.reorder).toHaveBeenCalledExactlyOnceWith([1, 0, 2]);
  expect(m.songs()).toEqual(['Song 2Queen', 'Song 1Queen', 'Song 3Queen']);
  expect(m.sel()).toEqual(['Song 2Queen']);
  expect(m.menu()).toEqual([]);                                     // the popup closed
});

it('Play Next moves a song to the top, Move Down one down; what cannot move is dimmed (the first: Play Next, Move Up; the last: Move Down)', async () => {
  const m = await onQueue();
  key('ArrowDown'); key('ArrowDown');                               // Song 3, the last
  m.hold();
  expect(m.menu().filter(([, off]) => off).map(([l]) => l)).toEqual(['Move Down']);
  m.pick('Play Next');
  expect(m.reorder).toHaveBeenLastCalledWith([2, 0, 1]);
  expect([m.songs(), m.sel()]).toEqual([['Song 3Queen', 'Song 1Queen', 'Song 2Queen'], ['Song 3Queen']]);
  m.hold();                                                         // now the first
  expect(m.menu().filter(([, off]) => off).map(([l]) => l)).toEqual(['Play Next', 'Move Up']);
  m.pick('Move Down');
  expect(m.reorder).toHaveBeenLastCalledWith([1, 0, 2]);
  expect([m.songs(), m.sel()]).toEqual([['Song 1Queen', 'Song 3Queen', 'Song 2Queen'], ['Song 3Queen']]);
});

it('Remove from Queue leaves the song out and selects the one in its place; Cancel does nothing', async () => {
  const m = await onQueue();
  key('ArrowDown');
  m.hold();
  m.pick('Cancel');
  expect(m.reorder).not.toHaveBeenCalled();
  m.hold();
  m.pick('Remove from Queue');
  expect(m.reorder).toHaveBeenCalledExactlyOnceWith([0, 2]);
  expect([m.songs(), m.sel()]).toEqual([['Song 1Queen', 'Song 3Queen'], ['Song 3Queen']]);
});

it('an engine without reorderQueue keeps the song\'s own menu on a Queue row', async () => {
  const m = await onQueue(false);
  m.hold();
  expect(m.menu().map(([l]) => l)).toContain('Start Radio');
  expect(m.menu().map(([l]) => l)).not.toContain('Move Up');
});
