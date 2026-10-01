// The pure logic of the Settings and Extras screens (logic.test.ts): the Custom colour's hue step,
// the stopwatch's clock, laps and logs, the world clock's time in a zone, the calendar's month grid,
// the alarm's next ring.

/** The Custom colour page: one wheel detent turns the hue 5 degrees, wrapping round 0..355. */
export const HUE_STEP = 5;
export const stepHue = (h: number, dir: 1 | -1): number => ((((Math.round(h / HUE_STEP) + dir) * HUE_STEP) % 360) + 360) % 360;

/** The stopwatch as it is kept in localStorage, so it runs on while its screen is closed. */
export interface Stopwatch {
  /** Date.now() when it last started; null = stopped */
  start: number | null;
  /** ms run before `start` */
  acc: number;
  /** the total at each lap mark, oldest first */
  laps: number[];
  /** Date.now() when it first started (its log's name); null = never run */
  began: number | null;
}
export const STOPWATCH0: Stopwatch = { start: null, acc: 0, laps: [], began: null };

export const elapsed = (w: Stopwatch, now: number): number => w.acc + (w.start == null ? 0 : now - w.start);
export const startStop = (w: Stopwatch, now: number): Stopwatch =>
  w.start == null ? { ...w, start: now, began: w.began ?? now } : { ...w, start: null, acc: elapsed(w, now) };
export const markLap = (w: Stopwatch, now: number): Stopwatch => ({ ...w, laps: [...w.laps, elapsed(w, now)] });
/** Each lap's own length, newest first, the lap still running first of all. */
export function lapTimes(w: Stopwatch, now: number): number[] {
  const marks = [...w.laps, elapsed(w, now)];
  return marks.map((m, i) => m - (i ? marks[i - 1]! : 0)).reverse();
}

/** A finished timer as Stopwatch's log keeps it: each lap's length, oldest first, the last one the
 *  run after the last mark. */
export interface StopwatchLog { began: number; total: number; laps: number[] }
export const logOf = (w: Stopwatch, now: number): StopwatchLog | null =>
  w.began == null ? null : { began: w.began, total: elapsed(w, now), laps: lapTimes(w, now).reverse() };
/** a log's shortest, longest and average lap */
export const lapStats = (laps: readonly number[]) =>
  ({ shortest: Math.min(...laps), longest: Math.max(...laps), average: laps.reduce((a, b) => a + b, 0) / laps.length });

const p2 = (n: number) => String(n).padStart(2, '0');
/** what is left of the sleep timer: 14:05 */
export const fmtLeft = (ms: number): string => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + p2(s % 60); };

/** ms from `now` to the next h:mm on this device's clock (tomorrow's once today's has passed) */
export function msUntil(h: number, m: number, now: number): number {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime() - now;
}
/** 1:02:03.45 past the hour, else 02:03.45 (the nano's hundredths) */
export function fmtStopwatch(ms: number): string {
  const cs = Math.floor(ms / 10), s = Math.floor(cs / 100), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return (h ? h + ':' : '') + p2(m % 60) + ':' + p2(s % 60) + '.' + p2(cs % 100);
}

/** The status row's and the clocks' time: 1:05 PM, or 13:05 on the 24-hour clock. */
export const fmtClock = (h: number, m: number, h24: boolean): string =>
  h24 ? h + ':' + p2(m) : ((h % 12) || 12) + ':' + p2(m) + (h < 12 ? ' AM' : ' PM');

/** The wall time in an IANA zone ('' = this device's). */
export function zoneTime(at: Date, tz: string): { h: number; m: number; s: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric',
    weekday: 'short', month: 'short', day: 'numeric',
  }).formatToParts(at);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? '';
  return { h: +g('hour') % 24, m: +g('minute'), s: +g('second'), date: g('weekday') + ' ' + g('month') + ' ' + g('day') };
}

/** The month's weeks as day numbers, Sunday first; 0 = a cell outside the month. */
export function monthGrid(y: number, m: number): number[] {
  const first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: Math.ceil((first + n) / 7) * 7 }, (_, i) => (i - first + 1 >= 1 && i - first + 1 <= n ? i - first + 1 : 0));
}

/** 'America/New_York' -> 'New York'; '' = this device's zone. */
export const cityOf = (tz: string): string =>
  (tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').split('/').pop()!.replace(/_/g, ' ');
