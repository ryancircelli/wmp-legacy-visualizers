// The Settings and Extras screens' pure logic: the Custom hue step, the stopwatch's laps, the month grid.
import { describe, expect, it } from 'vitest';
import { elapsed, fmtClock, fmtStopwatch, lapTimes, markLap, monthGrid, startStop, stepHue, STOPWATCH0 } from './logic';

describe('iPod settings logic', () => {
  it('turns the hue 5 degrees a detent, wrapping both ways', () => {
    expect(stepHue(0, 1)).toBe(5);
    expect(stepHue(0, -1)).toBe(355);
    expect(stepHue(355, 1)).toBe(0);
    expect(stepHue(212, 1)).toBe(215);   // off the grid: snaps onto it
  });

  it('runs, stops, resumes and splits laps', () => {
    let w = startStop(STOPWATCH0, 1000);   // start at t=1s
    w = markLap(w, 4000);                   // lap 1: 3 s
    w = startStop(w, 6000);                 // stop at 5 s run
    expect(elapsed(w, 99_000)).toBe(5000);  // stopped: the clock holds
    w = startStop(w, 10_000);               // resume
    w = markLap(w, 11_000);                 // lap 2: 2 s before the stop + 1 s after
    expect(lapTimes(w, 12_500)).toEqual([1500, 3000, 3000]);  // running lap first, newest first
    expect(fmtStopwatch(elapsed(w, 12_500))).toBe('00:07.50');
    expect(fmtStopwatch(3_723_450)).toBe('1:02:03.45');
  });

  it('writes the time on either clock', () => {
    expect(fmtClock(0, 5, false)).toBe('12:05 AM');
    expect(fmtClock(13, 5, false)).toBe('1:05 PM');
    expect(fmtClock(13, 5, true)).toBe('13:05');
  });

  it('lays a month out Sunday first in whole weeks', () => {
    const g = monthGrid(2026, 8);            // September 2026 starts on a Tuesday
    expect(g.slice(0, 3)).toEqual([0, 0, 1]);
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean).length).toBe(30);
  });
});
