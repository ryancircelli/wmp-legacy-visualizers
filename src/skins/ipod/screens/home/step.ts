/** i moved d places through n things (a wheel detent, or a ⏮⏭ press): held at the
 *  ends like an iPod list, or round like the nano's FM dial (108.0 tunes on to 87.5). */
export function step(i: number, d: number, n: number, wrap = false): number {
  if (n <= 0) return 0;
  return wrap ? (((i + d) % n) + n) % n : Math.max(0, Math.min(n - 1, i + d));
}
