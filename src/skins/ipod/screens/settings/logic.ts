// The pure logic of the Settings screens (logic.test.ts): the Custom colour's hue step.

/** The Custom colour page: one wheel detent turns the hue 5 degrees, wrapping round 0..355. */
export const HUE_STEP = 5;
export const stepHue = (h: number, dir: 1 | -1): number => ((((Math.round(h / HUE_STEP) + dir) * HUE_STEP) % 360) + 360) % 360;
