// ?src=synthetic (src/adapters/local/synthetic.ts): generated music through WMP's analyzer, for a screen saver with
// no audio and no gesture. The signal is never silent for long, has beats and a spectrum that moves, and the page
// attaches it without an AudioContext.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, DEFAULTS, type AppStore } from '../../src/model';
import { makeLevel } from 'wmp-legacy-visualizers';
import { createAdapter } from '../../src/adapters';
import { createSynth, createSyntheticLevel, SYNTH_RATE } from '../../src/adapters/local/synthetic';

const graphs = vi.hoisted(() => ({ made: 0 }));
vi.mock('../../src/adapters/local/audio', async (orig) => {
  const real = await orig<typeof import('../../src/adapters/local/audio')>();
  return { ...real, createAnalyserGraph: (sm: number) => { graphs.made++; return real.createAnalyserGraph(sm); } };
});

/** `sec` seconds of the synth, as RMS per second (both channels). */
function rmsPerSecond(sec: number, seed?: number): number[] {
  const syn = createSynth(SYNTH_RATE, seed), buf = new Float32Array(SYNTH_RATE * 2), out: number[] = [];
  for (let k = 0; k < sec; k++) {
    syn.render(buf, SYNTH_RATE);
    let e = 0;
    for (const v of buf) e += v * v;
    out.push(Math.sqrt(e / buf.length));
  }
  return out;
}

describe('the synthetic composition', () => {
  it('is deterministic, in [-1, 1], and never quiet for a second over five minutes', () => {
    const a = createSynth(), b = createSynth(), x = new Float32Array(20000), y = new Float32Array(20000);
    a.render(x, 10000); b.render(y, 10000);
    expect(x).toEqual(y);
    const rms = rmsPerSecond(300);
    expect(Math.min(...rms)).toBeGreaterThan(0.02);
    expect(Math.max(...rms)).toBeLessThan(0.7);
    // a different seed, a different piece
    expect(rmsPerSecond(20, 7)).not.toEqual(rms.slice(0, 20));
  }, 30_000);   // seconds on a loaded machine

  it('through the analyzer: beats in the bass, a spectrum that moves, a waveform', () => {
    let t = 0;
    const src = createSyntheticLevel({ now: () => t }), L = makeLevel();
    const lows: number[] = [], centroids: number[] = [];
    let waveSpan = 0;
    for (let f = 0; f <= 60 * 30; f++, t += 1000 / 30) {
      src.fill(L, 0, 'bars', 0);
      if (f < 30) continue;
      let low = 0, e = 0, m = 0;
      for (let k = 0; k < 1024; k++) { const v = L.freq[0][k]!; if (k < 12) low += v; e += v; m += v * k; }
      lows.push(low / 12);
      centroids.push(e ? m / e : 0);
      waveSpan = Math.max(waveSpan, Math.max(...L.wave[0]) - Math.min(...L.wave[0]));
    }
    expect(Math.max(...lows)).toBeGreaterThan(150);
    // the kick comes and goes: the bass band swings within each second
    let swings = 0;
    for (let s = 0; s + 30 <= lows.length; s += 30) { const w = lows.slice(s, s + 30); if (Math.max(...w) - Math.min(...w) > 20) swings++; }
    expect(swings).toBeGreaterThan(40);
    expect(Math.max(...centroids) - Math.min(...centroids)).toBeGreaterThan(20);
    expect(waveSpan).toBeGreaterThan(60);
    expect(L.timeStamp).toBeGreaterThan(0);
  }, 30_000);

  it('skips a stall instead of catching it up in one frame', () => {
    let t = 0;
    const src = createSyntheticLevel({ now: () => t }), L = makeLevel();
    src.fill(L, 0, 'bars', 0);
    t = 1000; src.fill(L, 0, 'bars', 0);
    const ts = L.timeStamp;
    t = 3_600_000; src.fill(L, 0, 'bars', 0);       // an hour hidden: two hops, not an hour, of samples
    expect(L.timeStamp - ts).toBeLessThan(1e6);
  });
});

describe('local adapter: ?src=synthetic', () => {
  let store: AppStore, stop = () => {};
  afterEach(() => { stop(); history.replaceState(null, '', '/'); vi.useRealTimers(); });

  it('attaches the generated source with no audio graph, and the level moves', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    history.replaceState(null, '', '/?mode=screensaver&src=synthetic');
    store = createAppStore({ persist: false, settings: { ...DEFAULTS, muted: true } });
    const ad = createAdapter(store);
    ad.start();
    stop = () => ad.stop();
    expect(store.getState().playback.capture).toMatchObject({ kind: 'synthetic', label: 'synthetic audio', paused: false });
    let peak = 0;
    for (let f = 0; f < 60; f++) {
      vi.advanceTimersByTime(33);
      const lv = store.getState().vis.level!();
      expect(lv.state).toBe(2);
      peak = Math.max(peak, ...lv.freq[0]);
    }
    expect(peak).toBeGreaterThan(150);              // muted makes no difference: nothing is played
    expect(graphs.made).toBe(0);
  });
});
