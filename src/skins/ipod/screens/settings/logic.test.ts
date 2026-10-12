// The Settings screens' pure logic: the Custom colour picker's points and steps.
import { describe, expect, it } from 'vitest';
import { fieldAt, fieldPoint, satAt, stepColor, stepHue } from './logic';

describe('iPod settings logic', () => {
  it('turns the hue 5 degrees a detent, wrapping both ways', () => {
    expect(stepHue(0, 1)).toBe(5);
    expect(stepHue(0, -1)).toBe(355);
    expect(stepHue(355, 1)).toBe(0);
    expect(stepHue(212, 1)).toBe(215);   // off the grid: snaps onto it
  });

  it('reads the field as hue across and lightness down (75 % at the top, 15 % at the foot), clamped past the edges', () => {
    expect(fieldAt(0, 0)).toEqual({ hue: 0, light: 75 });
    expect(fieldAt(1, 1)).toEqual({ hue: 360, light: 15 });
    expect(fieldAt(0.25, 0.5)).toEqual({ hue: 90, light: 45 });
    expect(fieldAt(-0.3, 1.4)).toEqual({ hue: 0, light: 15 });
    expect(fieldAt(1.2, -0.5)).toEqual({ hue: 360, light: 75 });
    expect(fieldPoint({ hue: 90, sat: 0, light: 45 })).toEqual([0.25, 0.5]);
    expect([satAt(0.42), satAt(-1), satAt(2)]).toEqual([{ sat: 42 }, { sat: 0 }, { sat: 100 }]);
  });

  it('steps the focused control a detent: the hue round, the lightness 1 and the saturation 2, null at their ends', () => {
    const c = { hue: 355, sat: 50, light: 50 };
    expect(stepColor(c, 'hue', 1)).toEqual({ hue: 0 });
    expect(stepColor(c, 'light', -1)).toEqual({ light: 49 });
    expect(stepColor(c, 'sat', 1)).toEqual({ sat: 52 });
    expect(stepColor({ ...c, light: 75 }, 'light', 1)).toBeNull();
    expect(stepColor({ ...c, light: 15 }, 'light', -1)).toBeNull();
    expect(stepColor({ ...c, sat: 100 }, 'sat', 1)).toBeNull();
    expect(stepColor({ ...c, sat: 1 }, 'sat', -1)).toEqual({ sat: 0 });
  });
});
