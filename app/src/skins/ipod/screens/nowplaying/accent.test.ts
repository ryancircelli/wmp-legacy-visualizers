import { describe, expect, it } from 'vitest';
import { contrast, pickAccent, rgbOf } from './accent';

const sw = (rgb: number[], population: number) => ({ rgb, population });

describe('Cover Bars accent', () => {
  it('measures WCAG contrast', () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
  it('takes the Vibrant swatch when it stands 3:1 off the dominant colour', () => {
    expect(pickAccent({ Vibrant: sw([230, 40, 40], 50), DarkMuted: sw([20, 20, 30], 900), LightVibrant: sw([250, 200, 200], 10) }))
      .toEqual({ color: '#e62828', from: 'Vibrant' });
  });
  it('passes over one too close to the dominant colour, to the next in order', () => {
    // a red cover: Vibrant is the dominant red itself; LightVibrant stands off it
    expect(pickAccent({ Vibrant: sw([200, 30, 30], 800), LightVibrant: sw([255, 220, 220], 20), DarkVibrant: sw([60, 0, 0], 40) }))
      .toEqual({ color: '#ffdcdc', from: 'LightVibrant' });
    expect(pickAccent({ Vibrant: sw([200, 30, 30], 800), LightVibrant: sw([220, 60, 60], 20), DarkVibrant: sw([40, 0, 0], 40) }))
      .toEqual({ color: '#280000', from: 'DarkVibrant' });
  });
  it('with nothing standing off: white or black, whichever contrasts more; no swatches: white', () => {
    expect(pickAccent({ Vibrant: sw([30, 30, 40], 500), DarkMuted: sw([20, 20, 25], 900) })).toEqual({ color: '#ffffff', from: 'white: no swatch at 3:1' });
    expect(pickAccent({ Vibrant: sw([240, 240, 230], 500), LightMuted: sw([250, 250, 250], 900) })).toEqual({ color: '#000000', from: 'black: no swatch at 3:1' });
    expect(pickAccent({})).toEqual({ color: '#ffffff', from: 'no swatches' });
  });
  it('reads a colour as its channels', () => {
    expect(rgbOf('#ff8000')).toEqual([255, 128, 0]);
  });
});
