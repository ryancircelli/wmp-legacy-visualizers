// Now Playing's pure logic: the clock text, the wheel's scrub and volume steps, the center-press
// mode cycle and the "N of M" line (docs/ipod-skin.md §2.4, §3.1).

/** The mode row, in the order the center cycles it (§2.4): the progress bar (ticks: volume), the
 *  scrubber (ticks: seek), the nano's Genius slider as Spotify radio. The nano's shuffle and rating
 *  modes are the status row's toggles here (shuffle, Like); its lyrics mode is none: they show by
 *  themselves while Lyrics is on. */
export type Mode = 'default' | 'scrub' | 'radio';
export const MODES: readonly Mode[] = ['default', 'scrub', 'radio'];

/** ms: a scrub seeks this long after its last detent (§3.1); a mode falls back to the progress bar
 *  after IDLE without input (§2.4, 5 s reconstructed); the volume bar goes VOLUME after its last tick */
export const SCRUB_COMMIT_MS = 400, IDLE_MS = 5000, VOLUME_MS = 2000;

/** m:ss (h:mm:ss past an hour), whole seconds as the iPod counts them */
export function clock(sec: number): string {
  const n = Math.max(0, Math.floor(sec)), h = Math.floor(n / 3600), ss = String(n % 60).padStart(2, '0');
  return h ? h + ':' + String(Math.floor(n / 60) % 60).padStart(2, '0') + ':' + ss : Math.floor(n / 60) + ':' + ss;
}

/** elapsed and -remaining at `ms` of `d`; the two add up to the length */
export function times(ms: number, d: number): [string, string] {
  const e = Math.floor(ms / 1000);
  return [clock(e), '-' + clock(Math.max(0, Math.round(d / 1000) - e))];
}

/** one scrub detent: 1 % of the length (at least 1 s) times the acceleration, clamped to the track */
export const scrubStep = (ms: number, dir: 1 | -1, d: number, accel = 1): number =>
  Math.min(d, Math.max(0, ms + dir * accel * Math.max(1000, d / 100)));

/** the scrub's acceleration from the gap since the last detent: x2 from 6 detents/s, x4 from 10 (§3.2's rates) */
export const scrubAccel = (gapMs: number): 1 | 2 | 4 => (gapMs < 100 ? 4 : gapMs < 1000 / 6 ? 2 : 1);

/** one volume detent: 2 % of the range (Spotify 0..100, the capture's sensitivity 0..200) */
export const volumeStep = (vol: number, dir: 1 | -1, max: number): number =>
  Math.min(max, Math.max(0, Math.round(vol + (dir * max) / 50)));

/** Bars and Waves' bars at a fixed width (src/engine/bars.ts drawBars): `bars` at most, each `barW`
 *  wide with `gap` after it, centred, so a frame wider than they span keeps a margin either side. The
 *  widest frame at or under `w` that they fill edge to edge: whole pitches, less the last gap (the
 *  engine's xoff 0, its last bar on the right edge). The Bars preset: (w, 50, 5, 1), 299 at most. */
export const barsFit = (w: number, bars: number, barW: number, gap: number): number => {
  const p = barW + gap;
  return p * Math.min(bars, Math.floor((w + gap) / p)) - gap;
};

/** center: the next mode this track has, in the nano's order; past the last, the progress bar */
export const nextMode = (m: Mode, has: Partial<Record<Mode, boolean>>): Mode =>
  MODES.slice(MODES.indexOf(m) + 1).find((x) => has[x]) ?? 'default';

/** "3 of 12": the track's place among the loaded rows of what it plays from, '' when not among them */
export function ofText(rows: readonly { uri: string }[], uri: string, total: number): string {
  const i = uri ? rows.findIndex((r) => r.uri === uri) : -1;
  return i < 0 ? '' : i + 1 + ' of ' + Math.max(total, rows.length);
}
