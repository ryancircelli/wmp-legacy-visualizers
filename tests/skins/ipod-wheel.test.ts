// The click wheel's math, without a DOM: degrees turned -> detent ticks, a press's zone, the list's
// acceleration and the scan's speed.
import { describe, expect, it } from 'vitest';
import { DETENT, HUB, ticksFor, zoneAt } from '../../src/skins/ipod/ClickWheel';
import { scanned, stride, wheelSpeed } from '../../src/skins/ipod/ui';

describe('ticksFor', () => {
  it('counts whole detents, clockwise positive', () => {
    expect(DETENT).toBe(15);
    expect(ticksFor(0, 14, 15)).toBe(0);
    expect(ticksFor(0, 15, 15)).toBe(1);
    expect(ticksFor(0, 44, 15)).toBe(2);
    expect(ticksFor(0, -14, 15)).toBe(0);
    expect(ticksFor(0, -31, 15)).toBe(-2);
  });
  it('takes the short way across the ±180° seam', () => {
    expect(ticksFor(170, -170, 15)).toBe(1);        // 20° clockwise through 180
    expect(ticksFor(-170, 170, 15)).toBe(-1);
    expect(ticksFor(350, 10, 15)).toBe(1);
    expect(ticksFor(10, 350, 15)).toBe(-1);
    expect(ticksFor(3600 + 5, 25, 15)).toBe(1);     // an anchor many turns round
  });
});

describe('zoneAt', () => {
  it('finds the centre button (0.49 of the wheel) and the four buttons by angle (y down)', () => {
    expect(HUB).toBe(0.49);
    expect(zoneAt(0, 0, 100)).toBe('center');
    expect(zoneAt(48, 0, 100)).toBe('center');
    expect(zoneAt(50, 0, 100)).toBe('next');
    expect(zoneAt(0, -80, 100)).toBe('menu');
    expect(zoneAt(80, 0, 100)).toBe('next');
    expect(zoneAt(0, 80, 100)).toBe('play');
    expect(zoneAt(-80, 0, 100)).toBe('prev');
    expect(zoneAt(60, -50, 100)).toBe('next');
    expect(zoneAt(50, -60, 100)).toBe('menu');
  });
});

describe('acceleration', () => {
  it('filters the tick rate as Rockbox does and forgets it after 250 ms', () => {
    let v = 0;
    for (let i = 0; i < 40; i++) v = wheelSpeed(v, 50);          // 20 ticks/s, held
    expect(v).toBeGreaterThan(14);
    expect(wheelSpeed(v, 251)).toBe(0);
  });
  it('steps 1 / 3 / 5 / 8 rows by speed, on lists over 100 rows only', () => {
    expect([0, 6, 10, 14].map((v) => stride(v, 500))).toEqual([1, 3, 5, 8]);
    expect(stride(20, 100)).toBe(1);
  });
});

it('scans 4× real time, 8× after 2 s, 16× after 5 s', () => {
  expect(scanned(1000)).toBe(4000);
  expect(scanned(3000)).toBe(8000 + 8000);
  expect(scanned(6000)).toBe(8000 + 24_000 + 16_000);
});
