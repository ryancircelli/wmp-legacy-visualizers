// The pure logic of the Settings screens (logic.test.ts): the Custom colour's picker, by touch and by wheel.
import { LIGHT } from '../../settings';
import type { IpodSettings } from '../contract';

type Hsl = Pick<IpodSettings, 'hue' | 'sat' | 'light'>;
/** the picker's three controls in the order the centre button walks them */
export const FOCI = ['hue', 'light', 'sat'] as const;
export type Focus = (typeof FOCI)[number];

/** One wheel detent turns the hue 5 degrees, wrapping round 0..355. */
export const HUE_STEP = 5;
export const stepHue = (h: number, dir: 1 | -1): number => ((((Math.round(h / HUE_STEP) + dir) * HUE_STEP) % 360) + 360) % 360;

const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
/** A point in the field (0..1 across, 0..1 down, past the edges when a drag leaves it): the hue
 *  across, the lightness down, light at the top. */
export const fieldAt = (x: number, y: number): Pick<Hsl, 'hue' | 'light'> =>
  ({ hue: fit(x * 360, 0, 360), light: fit(LIGHT[1] - y * (LIGHT[1] - LIGHT[0]), LIGHT[0], LIGHT[1]) });
/** A point along the saturation slider (0..1 across). */
export const satAt = (x: number): Pick<Hsl, 'sat'> => ({ sat: fit(x * 100, 0, 100) });
/** Where a colour sits in the field, 0..1 across and down (fieldAt's inverse). */
export const fieldPoint = (c: Hsl): [number, number] => [c.hue / 360, (LIGHT[1] - c.light) / (LIGHT[1] - LIGHT[0])];

/** One detent of the focused control: the hue 5 degrees round, the lightness 1 % and the saturation
 *  2 %, stopping at their ends (null: nothing moved, so no click). */
export function stepColor(c: Hsl, f: Focus, dir: 1 | -1): Partial<Hsl> | null {
  if (f === 'hue') return { hue: stepHue(c.hue, dir) };
  const v = f === 'light' ? fit(c.light + dir, LIGHT[0], LIGHT[1]) : fit(c.sat + dir * 2, 0, 100);
  return v === c[f] ? null : { [f]: v };
}
