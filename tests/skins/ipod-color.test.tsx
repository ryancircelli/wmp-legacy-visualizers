// Settings > Color: the presets (with the owner's Mocha Tan and Espresso Brown) and Custom's picker:
// a drag in the field sets hue and lightness, a drag on the slider the saturation, both clamped and
// never the screen's swipe-back; the wheel turns the focused control and the centre walks the focus;
// the body's --h --s --l follow; a stored blob from before the lightness loads with the defaults.
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Root } from '../../src/skins/ipod/Root';
import { DEFAULTS, useIpodSettings, type IpodSettings } from '../../src/skins/ipod/settings';
import { fakeData, mountSkinNow } from './harness';

beforeEach(() => { const { result } = renderHook(() => useIpodSettings()); act(() => result.current[1](DEFAULTS)); });
afterEach(() => { cleanup(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

/** the iPod at Settings > Color */
function atColor() {
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const click = (label: string) => act(() => { fireEvent.click(shown('[role=option]').find((x) => x.textContent?.startsWith(label))!); });
  click('Settings');
  click('Color');
  const body = ipod.querySelector<HTMLElement>('[data-wheel]')!;
  return {
    ...m, shown, click,
    rows: () => shown('[role=option]').map((x) => x.textContent),
    title: () => shown('[class*=status] [class*=title]')[0]?.textContent,
    /** the body's colour as it is meant to look: the knobs bodyVars set, Custom's brought back up by
     *  the 1.15 its base is taken down by (settings.ts LOOK), so a picked value reads as picked */
    hsl: () => {
      const k = (JSON.parse(localStorage.getItem('ipod.settings') ?? '{}') as { state?: IpodSettings }).state?.color === 'custom' ? 1.15 : 1;
      const [h, sat, l] = ['--h', '--s', '--l'].map((v) => body.style.getPropertyValue(v));
      return [h, Math.round(parseFloat(sat!) * k) + '%', Math.round(parseFloat(l!) * k) + '%'];
    },
    focus: () => shown('[data-focus]').map((x) => x.textContent),
    saved: () => (JSON.parse(localStorage.getItem('ipod.settings')!) as { state: IpodSettings }).state,
  };
}
/** jsdom has no layout: the element `w` x `h` at the page's top left */
const box = (el: HTMLElement, w: number, h: number) => {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
  return el;
};
const drag = (el: HTMLElement, id: number, ...pts: [number, number][]) => {
  const [first, ...rest] = pts;
  act(() => { fireEvent.pointerDown(el, { pointerId: id, button: 0, clientX: first![0], clientY: first![1] }); });
  for (const [x, y] of rest) act(() => { fireEvent.pointerMove(el, { pointerId: id, clientX: x, clientY: y }); });
  act(() => { fireEvent.pointerUp(el, { pointerId: id, clientX: pts.at(-1)![0], clientY: pts.at(-1)![1] }); });
};

it('lists the nine colours, Mocha Tan, Espresso Brown and Crimson, then Custom; a preset sets the body', () => {
  const m = atColor();
  expect(m.rows()).toEqual(['Silver', 'Black', 'Purple', 'Blue', 'Green✓ ', 'Yellow', 'Orange', 'Pink', '(PRODUCT) RED',
    'Mocha Tan', 'Espresso Brown', 'Crimson', 'Gold', 'Navy', 'Forest Green', 'Custom']);
  expect(m.hsl()).toEqual(['140', '70%', '34%']);
  m.click('Mocha Tan');
  expect(m.hsl()).toEqual(['24', '32%', '40%']);
  expect(m.rows()).toContain('Mocha Tan✓ ');
  m.click('Espresso Brown');
  expect(m.hsl()).toEqual(['22', '36%', '17%']);
  expect(m.saved().color).toBe('espresso');
});

it('Custom: a drag in the field sets the hue across and the lightness down, clamped, kept, and is no swipe-back', () => {
  const m = atColor();
  m.click('Custom');
  expect([m.title(), m.hsl()]).toEqual(['Custom', ['0', '85%', '50%']]);   // the defaults: today's Custom look
  const field = box(m.shown('[data-picker=field]')[0]!, 360, 60);           // 1 px a degree, 1 px a lightness %
  drag(field, 1, [34, 7]);                                                  // a tap: tan's hue and lightness
  expect(m.hsl()).toEqual(['34', '85%', '68%']);
  drag(field, 2, [34, 7], [28, 45], [300, 80]);                             // right and down, past the foot: the swipe's shape
  expect(m.hsl()).toEqual(['300', '85%', '15%']);
  expect(m.title()).toBe('Custom');                                         // still here: the screen saw no swipe
  drag(field, 3, [-40, -20]);                                               // past the top left corner
  expect(m.hsl()).toEqual(['0', '85%', '75%']);
  act(() => { fireEvent.pointerMove(field, { pointerId: 3, clientX: 100, clientY: 30 }); });   // lifted: a move does nothing
  expect(m.hsl()).toEqual(['0', '85%', '75%']);
  expect(m.saved()).toMatchObject({ color: 'custom', hue: 0, sat: 85, light: 75 });
});

it('Custom: a drag on the slider sets the saturation, clamped, and gives it the wheel', () => {
  const m = atColor();
  m.click('Custom');
  const slider = box(m.shown('[data-picker=sat]')[0]!, 100, 14);
  drag(slider, 1, [42, 7]);
  expect(m.hsl()).toEqual(['0', '42%', '50%']);
  expect(m.focus()).toEqual(['Saturation42%']);
  drag(slider, 2, [42, 7], [-20, 30]);
  expect(m.hsl()).toEqual(['0', '0%', '50%']);
  drag(slider, 3, [140, 7]);
  expect([m.hsl(), m.saved().sat]).toEqual([['0', '100%', '50%'], 100]);
});

it('Custom by wheel: it turns the focused control, the centre walks hue, lightness, saturation and round, MENU leaves with the colour kept', () => {
  const m = atColor();
  m.click('Custom');
  expect(m.focus()).toEqual(['Hue0°']);
  key('ArrowDown');
  key('ArrowDown');
  expect(m.hsl()).toEqual(['10', '85%', '50%']);
  key('ArrowUp');
  key('ArrowUp');
  key('ArrowUp');                                                           // round past 0
  expect(m.hsl()[0]).toBe('355');
  key('Enter');
  expect(m.focus()).toEqual(['Lightness50%']);
  key('ArrowUp');
  expect(m.hsl()).toEqual(['355', '85%', '49%']);
  key('Enter');
  expect(m.focus()).toEqual(['Saturation85%']);
  key('ArrowDown');
  expect(m.hsl()).toEqual(['355', '87%', '49%']);
  key('Enter');
  expect(m.focus()).toEqual(['Hue355°']);
  key('Escape');
  expect(m.title()).toBe('Color');
  expect(m.rows()).toContain('Custom✓ ');
  expect(m.hsl()).toEqual(['355', '87%', '49%']);
});

it('the wheel stops at the lightness\'s ends (no click there)', () => {
  window.alchemyHaptic = vi.fn();
  const m = atColor();
  m.click('Custom');
  drag(box(m.shown('[data-picker=field]')[0]!, 360, 60), 1, [0, 0]);      // the top: 75 %
  key('Enter');
  vi.mocked(window.alchemyHaptic).mockClear();
  key('ArrowDown');
  expect(m.hsl()[2]).toBe('75%');
  expect(window.alchemyHaptic).not.toHaveBeenCalledWith('selection');
  key('ArrowUp');
  expect(m.hsl()[2]).toBe('74%');
  expect(window.alchemyHaptic).toHaveBeenCalledWith('selection');
  delete window.alchemyHaptic;
});

it('a blob stored before the lightness loads as it looked: lightness 50, the old 0 saturation as 85; a newer one keeps a grey', async () => {
  const load = async (blob: object) => {
    localStorage.setItem('ipod.settings', JSON.stringify(blob));
    vi.resetModules();
    const s = await import('../../src/skins/ipod/settings');
    return [s.ipodSettings(), s.bodyVars(s.ipodSettings())] as const;
  };
  const [old, vars] = await load({ state: { color: 'custom', hue: 30, sat: 0, clicker: false, wheel: 'black' }, version: 0 });
  expect(old).toEqual({ color: 'custom', hue: 30, sat: 85, light: 50, clicker: false, wheel: 'black', metal: 'classic', backlight: 60 });
  // Custom's base is the picked colour taken down by 1.15: the cylinder's lights bring it back up
  expect(vars).toEqual({ '--h': 30, '--s': 85 / 1.15 + '%', '--l': 50 / 1.15 + '%' });
  expect(JSON.parse(localStorage.getItem('ipod.settings')!)).toMatchObject({ version: 1, state: { light: 50 } });   // migrated, rewritten
  const [grey] = await load({ state: { color: 'custom', hue: 30, sat: 0, light: 90, clicker: true, wheel: 'white' }, version: 1 });
  expect([grey.sat, grey.light]).toEqual([0, 50]);                          // out of range: the default
});
