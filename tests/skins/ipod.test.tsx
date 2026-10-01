// The iPod skin mounted: the wheel (its keyboard stand-in) reaches the top screen only, MENU goes back,
// the nano 5G's menus, the chevron on the selected row only, taps, and the hold-⏮/⏭ scan.
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeShell } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { Bar, MenuScreen, scan, useScan } from '../../src/skins/ipod/ui';
import { ShellContext } from '../../src/ui';

afterEach(() => { cleanup(); delete window.alchemyHaptic; vi.useRealTimers(); });
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

it('arrows move the selection, Enter opens Music, Escape comes back; a tick that moves is a haptic, one at the end is not', () => {
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const m = mount();
  expect(m.sel()).toEqual(['Music']);
  key('ArrowUp');                                    // the top: nothing moves, no click
  expect(m.sel()).toEqual(['Music']);
  expect(haptic).not.toHaveBeenCalledWith('selection');
  key('ArrowDown');
  expect(m.sel()).toEqual([m.rows()[1]]);
  expect(haptic).toHaveBeenCalledWith('selection');
  key('ArrowUp');
  key('Enter');
  expect(m.sel()).toEqual(['Cover Flow']);
  key('Escape');
  expect(m.sel()).toEqual(['Music']);
});

it('the nano 5G menus: Radio not FM Radio, Voice Memos in Extras, Genius Mixes in Music, no On-The-Go there', () => {
  const m = mount();
  expect(m.rows()).toContain('Radio');
  expect(m.rows()).toContain('Extras');
  expect(m.rows()).not.toContain('FM Radio');
  expect(m.rows()).not.toContain('Voice Memos');
  key('Enter');
  expect(m.rows().slice(0, 3)).toEqual(['Cover Flow', 'Genius Mixes', 'Playlists']);
  expect(m.rows()).not.toContain('On-The-Go');
});

it('a chevron shows on the selected row only', () => {
  const m = mount();
  expect(m.chevrons()).toEqual(['Music']);
  key('ArrowDown');
  expect(m.chevrons()).toEqual(m.sel());
});

it('a tap selects a row and does what the centre would', () => {
  const m = mount();
  act(() => { fireEvent.click(m.row('Music')); });
  expect(m.sel()).toEqual(['Cover Flow']);
  const a = vi.fn(), b = vi.fn(), off = vi.fn();
  const { getByText } = render(<MenuScreen items={[{ id: 'a', label: 'A', onSelect: a }, { id: 'b', label: 'B', onSelect: b },
                                                   { id: 'c', label: 'C', onSelect: off, disabled: true }]} />);
  act(() => { fireEvent.click(getByText('B')); });
  expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1]);
  expect(getByText('B').closest('[role=option]')!.getAttribute('aria-selected')).toBe('true');
  act(() => { fireEvent.click(getByText('C')); });
  expect(off).not.toHaveBeenCalled();
});

it('a swipe right on the screen is MENU, and not also a tap on the row it ended on', () => {
  const m = mount();
  key('Enter');
  const row = m.row('Cover Flow');
  act(() => { fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(row, { pointerId: 1, clientX: 90, clientY: 110 }); });
  act(() => { fireEvent.click(row); });
  expect(m.sel()).toEqual(['Music']);
  const music = m.row('Music');                       // a short drag is no swipe
  act(() => { fireEvent.pointerDown(music, { pointerId: 2, clientX: 10, clientY: 100 }); });
  act(() => { fireEvent.pointerUp(music, { pointerId: 2, clientX: 30, clientY: 100 }); });
  act(() => { fireEvent.click(music); });
  expect(m.sel()).toEqual(['Cover Flow']);
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
