// The app icon's name for a body colour: a preset's own, Custom snapped to the grid ios/icons.py draws.
import { expect, it } from 'vitest';
import { iconFor } from '../../src/skins/ipod/icon';
import { DEFAULTS } from '../../src/skins/ipod/settings';

it('names the preset, or Custom\'s nearest grid colour (grey when unsaturated)', () => {
  expect(iconFor({ ...DEFAULTS, color: 'gold' })).toBe('gold');
  expect(iconFor({ ...DEFAULTS, color: 'custom', hue: 0, sat: 100, light: 29 })).toBe('c-h000-l35');
  expect(iconFor({ ...DEFAULTS, color: 'custom', hue: 352, sat: 80, light: 60 })).toBe('c-h000-l55');
  expect(iconFor({ ...DEFAULTS, color: 'custom', hue: 196, sat: 89, light: 44 })).toBe('c-h210-l35');
  expect(iconFor({ ...DEFAULTS, color: 'custom', hue: 100, sat: 10, light: 60 })).toBe('c-grey-l50');
});
