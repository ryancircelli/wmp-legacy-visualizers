// The Settings screens' pure logic: the Custom hue step.
import { describe, expect, it } from 'vitest';
import { stepHue } from './logic';

describe('iPod settings logic', () => {
  it('turns the hue 5 degrees a detent, wrapping both ways', () => {
    expect(stepHue(0, 1)).toBe(5);
    expect(stepHue(0, -1)).toBe(355);
    expect(stepHue(355, 1)).toBe(0);
    expect(stepHue(212, 1)).toBe(215);   // off the grid: snaps onto it
  });
});
