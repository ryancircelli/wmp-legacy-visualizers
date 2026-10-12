// The wheel's volume on the iPod's Now Playing: a gesture's own running value from the level reported
// when it starts, moved by the wheel only (a stale report cannot pull it back), sent at most every
// VOLUME_SEND_MS; a turn of the ring moves it continuously (wheel.ts useTurn / offerTurn), keys 2 % a
// press; lists, the scrubber and every other screen keep the detents.
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClickWheel } from '../../src/skins/ipod/ClickWheel';
import { Root } from '../../src/skins/ipod/Root';
import { VOLUME_MS, VOLUME_SEND_MS } from '../../src/skins/ipod/screens/nowplaying/logic';
import { offerTurn, useTurn } from '../../src/skins/ipod/wheel';
import { fakeData, mountSkinNow } from './harness';

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); delete window.alchemyHaptic; });

const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const report = (v: number) => act(() => { vi.stubGlobal('__wmpVolume', v); window.dispatchEvent(new Event('wmp-volume')); });

/** the iPod on Now Playing (a track paused: the screen never goes quiet) */
function atNowPlaying() {
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  act(() => { m.store.setState((s) => ({ playback: { ...s.playback, status: 'paused', paused: true, canSeek: true, track: { uri: 'spotify:track:a', title: 'Song', artist: 'Band', duration: 100_000 } } })); });
  act(() => { fireEvent.click(m.getByTestId('ipod').querySelector('[aria-label="Now Playing"][role=button]')!); });
  const np = () => m.getByTestId('ipod').querySelector<HTMLElement>('[class*=root]:has([class*=controls])')!;
  /** the volume bar's value, while it shows */
  const bar = () => np().querySelector('[class*=controls] [role=progressbar]')?.getAttribute('aria-valuenow') ?? null;
  return { ...m, np, bar };
}

it('a gesture runs from the level reported when it starts, the report never moving: keys 2 % a press, sent at most every 50 ms, the last always', () => {
  vi.stubGlobal('__wmpVolume', 50);
  const m = atNowPlaying();
  const sent = vi.spyOn(m.S().actions, 'setVolume');
  key('ArrowUp'); key('ArrowUp'); key('ArrowUp');     // 50 -> 48 -> 46 -> 44, the phone still saying 50
  expect([m.bar(), sent.mock.calls.map((c) => c[0])]).toEqual(['44', [48]]);   // shown at once; the first sent at once
  wait(VOLUME_SEND_MS);
  expect([sent.mock.calls.map((c) => c[0]), m.S().settings.volume]).toEqual([[48, 44], 44]);   // then the latest
  report(50);                                        // a stale report mid-gesture: not pulled back
  expect(m.bar()).toBe('44');
  key('ArrowUp');
  wait(VOLUME_SEND_MS);
  expect([m.bar(), m.S().settings.volume]).toEqual(['42', 42]);
  wait(VOLUME_MS);                                   // the gesture over: the report is the base again
  report(70);
  expect(m.bar()).toBe('70');
  key('ArrowDown');
  wait(VOLUME_SEND_MS);
  expect(m.S().settings.volume).toBe(72);
});

it('a turn of the ring moves it continuously, 45 % a full turn, 1 % shown and sent, clamped with one light haptic at an end; the scrubber keeps the detents', () => {
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const m = atNowPlaying();                          // no phone report: the setting (100 of 100) is the base
  haptic.mockClear();                                // (the tap on the bar that opened it)
  let took = false;
  act(() => { took = offerTurn((-360 / 45) * 10); });   // -10 %
  expect([took, m.bar(), m.S().settings.volume]).toEqual([true, '90', 90]);
  act(() => { offerTurn(2); });                      // under 1 %: shown and sent as it was
  wait(VOLUME_SEND_MS);
  expect([m.bar(), m.S().settings.volume]).toEqual(['90', 90]);
  act(() => { offerTurn(1000); });                   // past the top: 100, one light haptic
  act(() => { offerTurn(40); });
  wait(VOLUME_SEND_MS);
  expect([m.bar(), m.S().settings.volume, haptic.mock.calls.filter((c) => c[0] === 'light').length]).toEqual(['100', 100, 1]);
  act(() => { offerTurn(-25); });                    // back at once (the turn past the end was not kept)
  expect(m.bar()).toBe(String(Math.round(100 - (25 * 45) / 360)));
  wait(VOLUME_MS);
  key('Enter');                                      // the scrubber: no continuous turn, the detents as ever
  expect(!!m.np().querySelector('[class*=diamond]')).toBe(true);
  act(() => { took = offerTurn(30); });
  expect(took).toBe(false);
});

it('ClickWheel: a turn ticks per detent as ever; with a screen following the turn, the turn is that screen\'s and no detents tick', () => {
  const onTick = vi.fn();
  const noop = () => {};
  const { getByRole } = render(<ClickWheel onTick={onTick} onCenter={noop} onMenu={noop} onPrev={noop} onNext={noop} onPlay={noop} />);
  const wheel = getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  const at = (deg: number) => ({ clientX: 100 + 80 * Math.cos((deg * Math.PI) / 180), clientY: 100 + 80 * Math.sin((deg * Math.PI) / 180) });
  const turn = (id: number, to: number) => act(() => {
    fireEvent.pointerDown(wheel, { pointerId: id, pointerType: 'touch', button: 0, ...at(0) });
    fireEvent.pointerMove(wheel, { pointerId: id, pointerType: 'touch', ...at(to / 2) });
    fireEvent.pointerMove(wheel, { pointerId: id, pointerType: 'touch', ...at(to) });
    fireEvent.pointerUp(wheel, { pointerId: id, pointerType: 'touch', ...at(to) });
  });
  turn(1, 40);                                       // 40° clockwise: two 15° detents
  expect(onTick.mock.calls).toEqual([[1], [1]]);
  const degs: number[] = [];
  const h = renderHook(() => useTurn((d) => { degs.push(d); return true; }));
  onTick.mockClear();
  turn(2, 40);
  expect([onTick.mock.calls.length, Math.round(degs.reduce((a, b) => a + b, 0))]).toEqual([0, 40]);
  h.unmount();                                       // the screen let go: detents again
  turn(3, -40);
  expect(onTick.mock.calls).toEqual([[-1], [-1]]);
});
