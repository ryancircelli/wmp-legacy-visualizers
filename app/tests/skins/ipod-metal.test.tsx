// Settings > Metal > Rendered (docs/ipod-skin.md §1.7), with the GPU mocked (gl.ts createRenderer): the
// row switches it and keeps it; the glass has its canvas over the screen while its context can be had;
// without WebGL or with the context lost the classic look comes back, said in the host's log; Low Power
// Mode holds it upright at the middle brightness on the same context; and it draws only on a change: a
// roll or tip past 2°, gliding at most 30 a second, a tip settling home in visible steps, never a host
// step's flicker, the brightness once it has stood half a second, the colours, the size and the wheel's
// and the glass's place (followed on a resize); nothing while the page is hidden.
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { useMetal } from '../../src/skins/ipod/metal';
import { createRenderer, type Frame, type Layout } from '../../src/skins/ipod/metal/gl';
import s from '../../src/skins/ipod/ipod.module.css';
import { Root } from '../../src/skins/ipod/Root';
import { DEFAULTS, useIpodSettings } from '../../src/skins/ipod/settings';
import { fakeData, mountSkinNow } from './harness';

vi.mock('../../src/skins/ipod/metal/gl', () => ({ createRenderer: vi.fn() }));

let gpu: { name: string; glass: boolean; size: Mock<(w: number, h: number, l: Layout) => void>; draw: Mock<(f: Frame) => void>; dispose: Mock };
let log: Mock<(line: string) => void>;
beforeEach(() => {
  gpu = { name: 'Test GPU', glass: true, size: vi.fn(), draw: vi.fn(), dispose: vi.fn() };
  vi.mocked(createRenderer).mockReturnValue(gpu);
  log = vi.fn();
  window.alchemyLog = log;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  for (const k of ['alchemyLog', '__wmpTilt', '__wmpPitch', '__wmpBrightness', '__wmpLowPower'] as const) delete window[k];
});

const SILVER = [0, 0, 66] as const, NAVY = [222, 31, 24] as const;
function Body({ on = true, color = SILVER, ring = 'white', children }: { on?: boolean; color?: readonly [number, number, number]; ring?: Frame['ring']; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useMetal(ref, on, color, ring);
  return <div ref={ref} data-testid="body">{children}</div>;
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
  expect(ipod.querySelector('[class*=bezel] > canvas[class*=glass]')).not.toBeNull(); // the glass's, over the screen
  click('MetalRendered');
  expect([ipod.querySelector('[data-wheel] > canvas'), ipod.querySelector('[class*=glass]'), gpu.dispose.mock.calls.length]).toEqual([null, null, 1]);
});

it('the glass over the screen has its own canvas there, and none (Classic\'s glare) when its context cannot be had', () => {
  const r = render(<Body><div className={s.bezel} /></Body>);
  const over = () => r.getByTestId('body').querySelector(`.${s.bezel} > canvas`);
  expect([over()?.className, vi.mocked(createRenderer).mock.lastCall![1]]).toEqual([s.glass, over()]);
  r.unmount();
  gpu.glass = false;
  const r2 = render(<Body><div className={s.bezel} /></Body>);
  expect([r2.getByTestId('body').querySelector(`.${s.bezel} > canvas`), r2.getByTestId('body').querySelector(':scope > canvas')]).toEqual([null, expect.anything()]);
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
  expect(last().turn).toBeCloseTo(.25 * 3 * Math.PI / 180, 3);               // arrived: the room turned 25% of the roll
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
  for (let t = 0; t < 1000; t += 5) { tilt(roll(t / 30)); wait(5); }       // 33 degrees in a second (the room's 5°, short of its reach), a report every 5 ms
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
  expect([draws() > 2, +last().turn.toFixed(3), +last().exposure.toFixed(2), lines().at(-1)]).toEqual([true, -0.131, .86, 'ipod: metal live']);
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
  expect([draws() >= 2, +last().turn.toFixed(3)]).toEqual([true, 0.044]);
});

it('says its redraws a minute in the host log while it is on', () => {
  render(<Body />);
  tilt(roll(5)); wait(100);
  wait(60_000);
  expect(lines().at(-1)).toMatch(/^ipod: metal ([3-9]|1\d) redraws\/min$/);   // the first, then the glide to 5°
  wait(60_000);
  expect(lines().at(-1)).toBe('ipod: metal 0 redraws/min');
});

it('tipping the phone toward or away from how it is held turns the room the other way, then settles back', () => {
  window.__wmpPitch = 55;
  render(<Body />);
  expect(last().pitch).toBe(0);                                               // as it is held: level
  act(() => { window.__wmpPitch = 70; window.dispatchEvent(new Event('wmp-pitch')); });
  wait(200);
  expect(last().pitch).toBeGreaterThan(0);                                    // tipped back 15°: the light moves
  wait(60_000);
  expect(last().pitch).toBe(0);                                               // held there: the new level
  const d = draws();
  wait(5000);
  expect(draws()).toBe(d);                                                    // and nothing more once settled
});

it('the wheel, its centre button and the glass are drawn where the page lays them out, and follow a resize; the ring\'s colour is the setting\'s', () => {
  // the layout jsdom does not have: each element's box by its class, the observer's callback by hand
  const box: Record<string, [number, number, number, number]> = { canvas: [0, 0, 390, 844], wheel: [62, 590, 266, 266], hub: [127, 655, 136, 136], bezel: [12, 8, 366, 566] };
  const of = (el: Element) => (el.tagName === 'CANVAS' && !el.className.includes('glass') ? 'canvas' : ['wheel', 'hub', 'bezel'].find((k) => el.className === s[k]));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [x, y, w, h] = box[of(this) ?? ''] ?? [0, 0, 0, 0];
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) };
  });
  let resized = () => {};
  const watched: Element[] = [];
  vi.stubGlobal('ResizeObserver', class { constructor(f: () => void) { resized = f; } observe(el: Element) { watched.push(el); } disconnect() {} });
  const r = render(<Body ring="black"><div className={s.bezel} /><div className={s.wheel}><div className={s.hub} /></div></Body>);
  expect(watched.map(of)).toEqual(['canvas', 'wheel', 'hub', 'bezel']);
  expect(gpu.size.mock.lastCall).toEqual([390, 844, { wheel: { x: 195, y: 844 - 723, r: 133, hub: 68 }, glass: { x: 12, y: 8, w: 366, h: 566 } }]);
  expect([draws(), last().ring]).toEqual([1, 'black']);
  // a shorter page: the wheel smaller and higher, the glass shorter
  Object.assign(box, { canvas: [0, 0, 390, 700], wheel: [80, 500, 230, 230], hub: [136.5, 556.5, 117, 117], bezel: [12, 8, 366, 480] });
  act(() => resized());
  wait(50);
  expect(gpu.size.mock.lastCall).toEqual([390, 700, { wheel: { x: 195, y: 700 - 615, r: 115, hub: 58.5 }, glass: { x: 12, y: 8, w: 366, h: 480 } }]);
  expect(draws()).toBe(2);
  act(() => resized());                                                       // the same layout: nothing
  wait(1000);
  expect([gpu.size.mock.calls.length, draws()]).toEqual([2, 2]);
  box.wheel = [80, 480, 230, 230]; box.hub = [136.5, 536.5, 117, 117];      // the wheel alone moves (a safe area's change)
  act(() => resized());
  wait(50);
  expect([gpu.size.mock.lastCall![2].wheel!.y, draws()]).toEqual([700 - 595, 3]);
  r.rerender(<Body ring="white"><div className={s.bezel} /><div className={s.wheel}><div className={s.hub} /></div></Body>);
  wait(50);
  expect([draws(), last().ring]).toEqual([4, 'white']);
  vi.unstubAllGlobals();
});

it('a hand come to rest on the edge of one of the host\'s 1° steps, flickering between two, draws only its glide there', () => {
  render(<Body />);
  const d = draws();
  for (let k = 0; k < 50; k++) { tilt(roll(k % 2 ? 11 : 10)); wait(100); }   // turned to 10°, then ten a second for five seconds
  expect(draws() - d).toBeLessThan(20);                                       // the glide to 10° (about a dozen), then none
  expect(last().turn).toBeCloseTo(.25 * 10 * Math.PI / 180, 4);
});

it('a tip held still settles home in steps a visible distance apart, not a draw every frame; a tip after a still spell shows', () => {
  render(<Body />);
  wait(20_000);                                                               // still a while: the next tip is not how it is held
  act(() => { window.__wmpPitch = 25; window.dispatchEvent(new Event('wmp-pitch')); });
  wait(500);
  const tipped = last().pitch, d = draws();
  expect(tipped).toBeGreaterThan(7 * Math.PI / 180);                          // 25° tipped: the room about 9°
  wait(60_000);
  expect([last().pitch, draws() - d < 120]).toEqual([0, true]);              // home, in under a hundred draws over its seconds
  const e = draws();
  wait(10_000);
  expect(draws()).toBe(e);
});
