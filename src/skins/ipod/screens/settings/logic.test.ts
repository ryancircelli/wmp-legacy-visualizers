// The Settings and Extras screens' pure logic: the Custom hue step, the stopwatch's laps and logs,
// the month grid, the sleep timer's countdown, the alarm's next ring.
import { describe, expect, it } from 'vitest';
import {
  elapsed, fmtClock, fmtLeft, fmtStopwatch, lapStats, lapTimes, logOf, markLap, monthGrid, msUntil, startStop, stepHue, STOPWATCH0,
} from './logic';

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

  it('logs a timer: its start, total and laps oldest first; none for one never run', () => {
    expect(logOf(STOPWATCH0, 5000)).toBeNull();
    let w = startStop(STOPWATCH0, 1000);
    w = markLap(w, 4000);
    w = startStop(w, 6000);
    w = startStop(w, 9000);                 // a resume keeps the first start
    const log = logOf(w, 10_000)!;
    expect(log).toEqual({ began: 1000, total: 6000, laps: [3000, 3000] });
    expect(lapStats([3000, 1000, 2000])).toEqual({ shortest: 1000, longest: 3000, average: 2000 });
  });

  it('counts the sleep timer down by the second', () => {
    expect(fmtLeft(14 * 60_000 + 5_000)).toBe('14:05');
    expect(fmtLeft(1)).toBe('0:01');
    expect(fmtLeft(-5)).toBe('0:00');
  });

  it("rings the alarm at the next h:mm, tomorrow's once today's has passed", () => {
    const at = (h: number, m: number) => new Date(2026, 8, 30, h, m).getTime();
    expect(msUntil(7, 0, at(6, 30))).toBe(30 * 60_000);
    expect(msUntil(7, 0, at(7, 0))).toBe(24 * 3_600_000);      // ringing now: the next is tomorrow's
    expect(msUntil(7, 0, at(8, 0))).toBe(23 * 3_600_000);
  });
});
