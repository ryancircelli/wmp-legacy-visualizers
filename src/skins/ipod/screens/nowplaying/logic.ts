// Now Playing's pure logic: the clock text, the wheel's scrub and volume steps, the center-press
// mode cycle and the "N of M" line.

/** default: ticks change the volume; scrub: ticks seek; lyrics: the synced lines in the art's place */
export type Mode = 'default' | 'scrub' | 'lyrics';

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

/** one scrub detent: 2 % of the length, clamped to the track */
export const scrubStep = (ms: number, dir: 1 | -1, d: number): number => Math.min(d, Math.max(0, ms + dir * 0.02 * d));

/** one volume detent: 2 % of the range (Spotify 0..100, the capture's sensitivity 0..200) */
export const volumeStep = (vol: number, dir: 1 | -1, max: number): number =>
  Math.min(max, Math.max(0, Math.round(vol + (dir * max) / 50)));

/** center: default -> scrub (when the track can seek) -> lyrics (when it has them) -> default */
export function nextMode(m: Mode, canScrub: boolean, hasLyrics: boolean): Mode {
  if (m === 'default' && canScrub) return 'scrub';
  if (m !== 'lyrics' && hasLyrics) return 'lyrics';
  return 'default';
}

/** "3 of 12": the track's place among the loaded rows of what it plays from, '' when not among them */
export function ofText(rows: readonly { uri: string }[], uri: string, total: number): string {
  const i = uri ? rows.findIndex((r) => r.uri === uri) : -1;
  return i < 0 ? '' : i + 1 + ' of ' + Math.max(total, rows.length);
}
