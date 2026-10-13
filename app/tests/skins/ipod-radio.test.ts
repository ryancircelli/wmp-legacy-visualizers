// The FM dial's frequencies: the stations spread evenly over 87.5-108 (the owner, 2026-10-02: "evenly
// disperse across the standard range, right now it goes between 87 and 89"), to the nearest 0.1.
import { expect, it } from 'vitest';
import { mhz } from '../../src/skins/ipod/screens/home';

it('spreads n stations from 87.5 to 108.0', () => {
  expect([mhz(0, 1), mhz(0, 2), mhz(1, 2)]).toEqual([87.5, 87.5, 108]);
  expect(Array.from({ length: 5 }, (_, i) => mhz(i, 5))).toEqual([87.5, 92.6, 97.8, 102.9, 108]);
  expect(mhz(23, 24)).toBe(108);
  expect(mhz(1, 24)).toBe(88.4);
});
