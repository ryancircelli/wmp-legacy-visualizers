import { describe, expect, it } from 'vitest';
import { clock, nextMode, ofText, scrubAccel, scrubStep, times, volumeStep, type Mode } from './logic';

describe('Now Playing logic', () => {
  it('formats the clock as the iPod does', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(times(61_400, 200_000)).toEqual(['1:01', '-2:19']);
    expect(times(0, 0)).toEqual(['0:00', '-0:00']);
  });
  it('scrubs 1 % a detent (at least 1 s), accelerated, within the track', () => {
    expect(scrubStep(10_000, 1, 200_000)).toBe(12_000);
    expect(scrubStep(10_000, 1, 200_000, 4)).toBe(18_000);
    expect(scrubStep(10_000, -1, 60_000)).toBe(9_000);
    expect(scrubStep(1_000, -1, 200_000)).toBe(0);
    expect(scrubStep(199_000, 1, 200_000)).toBe(200_000);
  });
  it('accelerates the scrub by the detent rate', () => {
    expect(scrubAccel(500)).toBe(1);
    expect(scrubAccel(150)).toBe(2);
    expect(scrubAccel(80)).toBe(4);
  });
  it('steps the volume within its range', () => {
    expect(volumeStep(50, 1, 100)).toBe(52);
    expect(volumeStep(1, -1, 100)).toBe(0);
    expect(volumeStep(199, 1, 200)).toBe(200);
  });
  it('cycles the modes on center in the nano order, skipping what the track lacks (no lyrics mode)', () => {
    const all = { scrub: true, radio: true };
    const order: Mode[] = ['default'];
    for (let i = 0; i < 3; i++) order.push(nextMode(order[i]!, all));
    expect(order).toEqual(['default', 'scrub', 'radio', 'default']);
    expect(nextMode('default', { radio: true })).toBe('radio');
    expect(nextMode('scrub', {})).toBe('default');
    expect(nextMode('radio', { scrub: true, radio: true })).toBe('default');
    expect(nextMode('default', {})).toBe('default');
  });
  it('says N of M only when the track is among the rows', () => {
    const rows = [{ uri: 'a' }, { uri: 'b' }];
    expect(ofText(rows, 'b', 12)).toBe('2 of 12');
    expect(ofText(rows, 'c', 12)).toBe('');
    expect(ofText(rows, '', 12)).toBe('');
  });
});
