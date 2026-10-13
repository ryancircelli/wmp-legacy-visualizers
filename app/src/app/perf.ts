// "page: perf2:", once a minute in the host's log while the page is in front: where the main thread's time
// goes (the owner, 2026-10-13: "my phone does overheat"). Each part adds its milliseconds to the one
// window.__wmpPerf object, two clock reads a call and no per-pixel or per-sample work: the ticker (rd, pr),
// the PCM source in the engine (an), observer.js (br, kb: the bridge's decode, base64 characters received),
// React's Profiler (ui). A lag probe, a timer set 80-120 ms ahead and read for how late it fires, says how
// busy the thread was altogether; what is left over is Spotify's web player and the rest.
export interface Perf { rd: number; pr: number; an: number; br: number; kb: number; ui: number }

/** ms between the log lines (the ticker's "perf:" line has the same cadence) */
export const PERF_MS = 60_000;
/** a timer this much later than due (ms) found the main thread busy */
const BUSY = 1;
/** a timer later than this was frozen (the page suspended), not delayed: not counted */
const FROZEN = 5000;

export const perf = (): Perf => ((globalThis as { __wmpPerf?: Perf }).__wmpPerf ??= { rd: 0, pr: 0, an: 0, br: 0, kb: 0, ui: 0 });

/** React <Profiler onRender>: the commit's render time, summed. */
export function onCommit(_id: string, _phase: string, actualMs: number): void { perf().ui += actualMs; }

/** The lag probe's tally: a timer set at a random time ahead samples the thread like a Poisson arrival, so
 *  the share of probes that found it busy is its busy share (less the busy spells shorter than BUSY). */
export class Lag {
  n = 0; late = 0; sum = 0; max = 0;
  add(ms: number): void {
    if (ms > FROZEN) return;
    ms = Math.max(0, ms);
    this.n++; this.sum += ms;
    if (ms > BUSY) this.late++;
    if (ms > this.max) this.max = ms;
  }
  reset(): void { this.n = this.late = this.sum = this.max = 0; }
}

/** The line for `p` and `lag` gathered over `secs` seconds. Milliseconds are per second of wall time. */
export function perf2Line(p: Perf, lag: Lag, secs: number): string {
  const per = (v: number) => v / secs, f = (v: number) => per(v).toFixed(1);
  const busy = lag.n ? lag.late / lag.n : 0;
  const known = per(p.rd + p.pr + p.an + p.br + p.ui);
  return 'perf2: vis render ' + f(p.rd) + ' ms/s, present ' + f(p.pr) + ' ms/s, analyzer ' + f(p.an) + ' ms/s, bridge ' + f(p.br) +
    ' ms/s (' + f(p.kb) + ' KB/s), UI commits ' + f(p.ui) + ' ms/s, main thread busy ' + Math.round(busy * 100) + '% (lag avg ' +
    (lag.n ? lag.sum / lag.n : 0).toFixed(1) + ' ms, worst ' + lag.max.toFixed(0) + ' ms), web player and rest ~' +
    Math.round(Math.max(0, busy * 1000 - known)) + ' ms/s (estimate: busy less the parts above)';
}

/** Starts the probe and the log; a no-op without a host log. Returns the stop. */
export function startPerfLog(): () => void {
  const log = window.alchemyLog;
  if (!log) return () => {};
  const lag = new Lag(), p = perf();
  let from = 0, due = 0, tm = 0;
  const clear = () => { p.rd = p.pr = p.an = p.br = p.kb = p.ui = 0; lag.reset(); from = performance.now(); };
  const tick = () => {
    const now = performance.now();
    if (document.hidden) clear();
    else {
      lag.add(now - due);
      if (now - from >= PERF_MS) {
        if (now - from < PERF_MS * 1.5) log(perf2Line(p, lag, (now - from) / 1000));   // longer: asleep part of it
        clear();
      }
    }
    const d = 80 + Math.random() * 40;
    due = performance.now() + d;
    tm = window.setTimeout(tick, d);
  };
  clear();
  due = performance.now() + 100;
  tm = window.setTimeout(tick, 100);
  return () => clearTimeout(tm);
}
