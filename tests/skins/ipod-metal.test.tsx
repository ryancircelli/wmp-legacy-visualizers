// Settings > Metal > Rendered (docs/ipod-skin.md §1.7), with the GPU mocked (gl.ts createRenderer): the
// row switches it and keeps it; without WebGL or with the context lost the classic body comes back, said
// in the host's log; Low Power Mode holds it upright at the middle brightness on the same context; and it
// draws only on a change: a roll past half a degree, at most 30 a second, the brightness once it has
// stood half a second, the colour, the size; nothing while the page is hidden.
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { useMetal } from '../../src/skins/ipod/metal';
import { createRenderer, type Frame } from '../../src/skins/ipod/metal/gl';
import { Root } from '../../src/skins/ipod/Root';
import { DEFAULTS, useIpodSettings } from '../../src/skins/ipod/settings';
import { fakeData, mountSkinNow } from './harness';

vi.mock('../../src/skins/ipod/metal/gl', () => ({ createRenderer: vi.fn() }));

let gpu: { name: string; size: Mock; draw: Mock<(f: Frame) => void>; dispose: Mock };
let log: Mock<(line: string) => void>;
beforeEach(() => {
  gpu = { name: 'Test GPU', size: vi.fn(), draw: vi.fn(), dispose: vi.fn() };
  vi.mocked(createRenderer).mockReturnValue(gpu);
  log = vi.fn();
  window.alchemyLog = log;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  for (const k of ['alchemyLog', '__wmpTilt', '__wmpBrightness', '__wmpLowPower'] as const) delete window[k];
});

const SILVER = [0, 0, 66] as const, NAVY = [222, 31, 24] as const;
function Body({ on = true, color = SILVER }: { on?: boolean; color?: readonly [number, number, number] }) {
  const ref = useRef<HTMLDivElement>(null);
  useMetal(ref, on, color);
  return <div ref={ref} data-testid="body" />;
}
const host = (k: '__wmpTilt' | '__wmpBrightness' | '__wmpLowPower', v: number | boolean, ev: string) =>
  act(() => { (window as unknown as Record<string, unknown>)[k] = v; window.dispatchEvent(new Event(ev)); });
const tilt = (t: number) => host('__wmpTilt', t, 'wmp-tilt');
const bright = (b: number) => host('__wmpBrightness', b, 'wmp-brightness');
const lowPower = (on: boolean) => host('__wmpLowPower', on, 'wmp-lowpower');
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const draws = () => gpu.draw.mock.calls.length;
const last = () => gpu.draw.mock.lastCall![0];
const lines = () => log.mock.calls.map((c) => c[0]);
/** a roll of `deg` degrees as the host reports it (gravity's x) */
const roll = (deg: number) => Math.sin(deg * Math.PI / 180);

it('Settings > Metal: Classic by default, Rendered draws the body and is kept, Classic again frees the context', () => {
  const { result } = renderHook(() => useIpodSettings());
  act(() => result.current[1](DEFAULTS));
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const click = (label: string) => act(() => { fireEvent.click(shown('[role=option]').find((x) => x.textContent === label)!); });
  click('Settings');
  expect([ipod.querySelector('[data-wheel] > canvas'), vi.mocked(createRenderer).mock.calls.length]).toEqual([null, 0]);
  click('MetalClassic');
  expect(shown('[role=option]').map((x) => x.textContent)).toContain('MetalRendered');
  expect(ipod.querySelector('[data-wheel] > canvas')).not.toBeNull();       // the body's own canvas, under the device
  expect([draws(), lines()]).toEqual([1, ['ipod: metal rendered (Test GPU)']]);
  expect((JSON.parse(localStorage.getItem('ipod.settings')!) as { state: { metal: string } }).state.metal).toBe('rendered');
  click('MetalRendered');
  expect([ipod.querySelector('[data-wheel] > canvas'), gpu.dispose.mock.calls.length]).toEqual([null, 1]);
});

it('no WebGL: the classic body, said once', () => {
  vi.mocked(createRenderer).mockReturnValue('no webgl');
  const r = render(<Body />);
  expect([r.getByTestId('body').querySelector('canvas'), lines()]).toEqual([null, ['ipod: metal classic (no webgl)']]);
});

it('a lost context: the canvas goes (the classic body shows), freed, said; nothing draws after', () => {
  const r = render(<Body />), canvas = r.getByTestId('body').querySelector('canvas')!;
  act(() => { canvas.dispatchEvent(new Event('webglcontextlost')); });
  expect([r.getByTestId('body').querySelector('canvas'), gpu.dispose.mock.calls.length, lines().at(-1)]).toEqual([null, 1, 'ipod: metal classic (context lost)']);
  tilt(.5);
  r.rerender(<Body color={NAVY} />);
  wait(1000);
  expect(draws()).toBe(1);
});

it('draws once, then only on a change: a roll past a third of a degree, never a tremor; the colour; a turned-off metal is freed', () => {
  const r = render(<Body />);
  expect([draws(), last().turn, last().exposure]).toEqual([1, 0, 1]);      // no host: upright, the middle brightness
  for (let k = 0; k < 20; k++) { tilt(roll(k % 2 ? .2 : -.2)); wait(50); }   // the hand's tremor
  wait(5000);
  expect(draws()).toBe(1);
  tilt(roll(3));
  wait(50);
  expect(draws()).toBeGreaterThanOrEqual(2);                                  // glides there over a few frames
  wait(1000);
  expect(last().turn).toBeCloseTo(3 * Math.PI / 180, 3);                     // arrived: the room turned the whole roll
  const d = draws();
  r.rerender(<Body color={NAVY} />);
  wait(50);
  expect([draws(), last().f0[2] > last().f0[0]]).toEqual([d + 1, true]);    // navy's blue over its red, linear
  r.rerender(<Body color={NAVY} />);                                          // the same colour: nothing
  wait(5000);
  expect(draws()).toBe(d + 1);
  r.rerender(<Body on={false} color={NAVY} />);
  expect([gpu.dispose.mock.calls.length, r.getByTestId('body').querySelector('canvas')]).toEqual([1, null]);
});

it('a turning phone draws at most 30 a second and stops as soon as it is still', () => {
  render(<Body />);
  for (let t = 0; t < 1000; t += 5) { tilt(roll(t / 10)); wait(5); }       // 100 degrees in a second, a report every 5 ms
  expect(draws()).toBeGreaterThanOrEqual(30);
  expect(draws()).toBeLessThanOrEqual(32);
  const n = draws();
  wait(500);                                                                  // the glide to the last report, then none
  expect(draws()).toBeLessThanOrEqual(n + 12);
  const still = draws();
  wait(10_000);
  expect(draws()).toBe(still);
});

it('the brightness: once it has stood half a second, within the classic range; the same level draws nothing', () => {
  render(<Body />);
  bright(1); wait(200); bright(0); wait(200); bright(.9);
  wait(400);
  expect(draws()).toBe(1);                                                    // still moving: not yet
  wait(200);
  expect([draws(), +last().exposure.toFixed(3)]).toEqual([2, 1.112]);
  bright(.9);
  wait(1000);
  expect(draws()).toBe(2);
  bright(0); wait(600);
  expect(+last().exposure.toFixed(2)).toBe(.86);
});

it('Low Power Mode holds the metal still on the same context: upright, the middle brightness, drawn only for the colour; off, it follows again', () => {
  window.__wmpLowPower = true;
  window.__wmpTilt = roll(20);
  window.__wmpBrightness = 1;
  const r = render(<Body />);
  expect([draws(), last().turn, last().exposure, lines()]).toEqual([1, 0, 1, ['ipod: metal rendered (Test GPU)', 'ipod: metal still (low power)']]);
  tilt(roll(-30)); bright(0);
  wait(5000);
  expect(draws()).toBe(1);
  r.rerender(<Body color={NAVY} />);
  wait(50);
  expect([draws(), last().turn]).toEqual([2, 0]);
  lowPower(false);
  wait(1000);
  expect([draws() > 2, +last().turn.toFixed(3), +last().exposure.toFixed(2), lines().at(-1)]).toEqual([true, -0.524, .86, 'ipod: metal live']);
  let d = draws();
  tilt(roll(-25));
  wait(1000);
  expect(draws()).toBeGreaterThan(d);
  lowPower(true);                                                             // switched on mid-session: one still frame, the context kept
  wait(50);
  expect([last().turn, last().exposure, gpu.dispose.mock.calls.length, lines().at(-1)]).toEqual([0, 1, 0, 'ipod: metal still (low power)']);
  d = draws();
  tilt(roll(10));
  wait(1000);
  expect(draws()).toBe(d);
});

it('nothing draws while the page is hidden; what changed is drawn once it shows', () => {
  render(<Body />);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  tilt(roll(10));
  wait(1000);
  expect(draws()).toBe(1);
  hidden.mockReturnValue(false);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  wait(1000);
  expect([draws() >= 2, +last().turn.toFixed(3)]).toEqual([true, 0.175]);
});

it('says its redraws a minute in the host log while it is on', () => {
  render(<Body />);
  tilt(roll(5)); wait(100);
  wait(60_000);
  expect(lines().at(-1)).toMatch(/^ipod: metal ([3-9]|1\d) redraws\/min$/);   // the first, then the glide to 5°
  wait(60_000);
  expect(lines().at(-1)).toBe('ipod: metal 0 redraws/min');
});
