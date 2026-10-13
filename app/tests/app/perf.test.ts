// The "perf2:" line's maths: per-second sums, the lag probe's busy share, the leftover estimate.
import { describe, expect, it } from 'vitest';
import { Lag, perf2Line, type Perf } from '../../src/app/perf';

const P = (o: Partial<Perf> = {}): Perf => ({ rd: 0, pr: 0, an: 0, br: 0, kb: 0, ui: 0, ...o });

describe('Lag', () => {
  it('counts probes later than 1 ms as finding the thread busy, ignores frozen ones', () => {
    const l = new Lag();
    for (const ms of [0, 0.4, 3, 10, -1, 60_000]) l.add(ms);
    expect(l).toMatchObject({ n: 5, late: 2, max: 10 });
    expect(l.sum).toBeCloseTo(13.4);
  });
});

describe('perf2Line', () => {
  it('divides the sums by the seconds and leaves the rest as the estimate', () => {
    const lag = new Lag();
    for (let i = 0; i < 100; i++) lag.add(i < 20 ? 5 : 0);          // 20% busy: 200 ms/s
    const line = perf2Line(P({ rd: 1200, pr: 600, an: 300, br: 60, kb: 600, ui: 240 }), lag, 60);   // 20 + 10 + 5 + 1 + 4 = 40 ms/s
    expect(line).toBe('perf2: vis render 20.0 ms/s, present 10.0 ms/s, analyzer 5.0 ms/s, bridge 1.0 ms/s (10.0 KB/s), ' +
      'UI commits 4.0 ms/s, main thread busy 20% (lag avg 1.0 ms, worst 5 ms), web player and rest ~160 ms/s (estimate: busy less the parts above)');
  });
  it('never reports a negative rest, nor divides by no probes', () => {
    expect(perf2Line(P({ rd: 6000 }), new Lag(), 60)).toContain('busy 0% (lag avg 0.0 ms, worst 0 ms), web player and rest ~0 ms/s');
  });
});
