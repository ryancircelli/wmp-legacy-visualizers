// The click wheel's math, without a DOM: degrees turned -> detent ticks, and a press's zone.
import { describe, expect, it } from 'vitest';
import { DETENT, ticksFor, zoneAt } from '../../src/skins/ipod/ClickWheel';

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
  it('finds the centre button and the four buttons by angle (y down)', () => {
    expect(zoneAt(0, 0, 100)).toBe('center');
    expect(zoneAt(30, 0, 100)).toBe('center');
    expect(zoneAt(0, -80, 100)).toBe('menu');
    expect(zoneAt(80, 0, 100)).toBe('next');
    expect(zoneAt(0, 80, 100)).toBe('play');
    expect(zoneAt(-80, 0, 100)).toBe('prev');
    expect(zoneAt(60, -50, 100)).toBe('next');
    expect(zoneAt(50, -60, 100)).toBe('menu');
  });
});
