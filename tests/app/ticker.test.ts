// The render loop against WMP's own pacing (re/player/PLAYER.md §4): a fake clock and a fake vsync drive
// a stub engine whose Render takes a set time; what is checked is when Render is called, and with what.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, type AppStore } from '../../src/model';
import { createTicker, wmpDelay, type Ticker } from '../../src/app/ticker';

const h = vi.hoisted(() => ({
  clock: 0,
  cost: 2,
  renders: [] as { t: number; state: number; eng: number }[],
  made: [] as { kind: string; preset: number }[],
  setPresets: [] as number[],
}));

vi.mock('../../src/engine', async (orig) => {
  const m = await orig<typeof import('../../src/engine')>();
  return {
    ...m,
    createEngine: (kind: string, _c: unknown, o?: { preset?: number }) => {
      const id = h.made.push({ kind, preset: o?.preset ?? 0 });
      const e = {
        kind, preset: o?.preset ?? 0, presetName: '', options: {}, width: 640, height: 480,
        render(l: { state: number }) { h.renders.push({ t: h.clock, state: l.state, eng: id }); h.clock += h.cost; return null; },
        present() {}, resize() {}, setScale() {}, seed() {}, debug: () => ({}),
        setPreset(n: number) { e.preset = n; h.setPresets.push(n); },
      };
      return e;
    },
  };
});

let rafs: FrameRequestCallback[] = [], vsync = 0, store: AppStore, ticker: Ticker, detach: () => void;

/** `ms` of vsyncs at `hz`; a Render that overruns a vsync makes the next callback come at the vsync after. */
function run(ms: number, hz = 60) {
  const iv = 1000 / hz, end = vsync + ms;
  while (vsync + iv <= end) {
    vsync = Math.max(vsync + iv, Math.ceil(h.clock / iv) * iv);
    h.clock = vsync;
    for (const cb of rafs.splice(0)) cb(vsync);
  }
}
/** Render calls from `t` on; `now()`: after the last vsync run */
const since = (t: number) => h.renders.filter((r) => r.t >= t);
const now = () => vsync + 0.5;
const gaps = (rs: { t: number }[]) => rs.slice(1).map((r, i) => Math.round(r.t - rs[i]!.t));

beforeEach(() => {
  h.clock = vsync = 1000; h.cost = 2; h.renders = []; h.made = []; h.setPresets = []; rafs = [];
  vi.spyOn(performance, 'now').mockImplementation(() => h.clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { rafs = []; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  store = createAppStore({ persist: false });
  ticker = createTicker(store, () => {});
  detach = ticker.attach(document.createElement('canvas'));
});
afterEach(() => { detach(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('wmpDelay', () => {
  /** the delay once 8 render times of `ms` are kept */
  const steady = (ms: number) => {
    const hist: number[] = [];
    for (let i = 0; i < 8; i++) expect(wmpDelay(hist, ms)).toBe(30);   // the first 8 frames: 30 ms
    return wmpDelay(hist, ms);
  };
  it("is WMP's: clamp(max(avg / 0.6, 33.333) - avg, 10, 500), truncated, after 8 frames of 30 ms", () => {
    expect(steady(0)).toBe(33);
    expect(steady(5)).toBe(28);       // 28.33: ~30 fps
    expect(steady(20)).toBe(13);      // 13.33: the lowest it goes, so the 10 ms floor never binds
    expect(steady(25)).toBe(16);      // 41.67 - 25: 24 fps, the visualizer 60% of the time
    expect(steady(60)).toBe(40);      // 10 fps
    expect(steady(1000)).toBe(500);   // the ceiling
  });
  it('averages the last 8 render times only', () => {
    const hist: number[] = [];
    for (let i = 0; i < 8; i++) wmpDelay(hist, 5);
    for (let i = 0; i < 7; i++) wmpDelay(hist, 60);
    expect(wmpDelay(hist, 60)).toBe(40);
    expect(hist).toHaveLength(8);
  });
});

describe('the ticker', () => {
  it("renders at WMP's ~30 a second by default, at any refresh rate (not the old 60)", () => {
    expect(store.getState().settings.fps).toBe('wmp');
    for (const hz of [60, 144, 75, 120, 30]) {
      const t = now();
      run(10_000, hz);
      expect(Math.abs(since(t).length - 303)).toBeLessThan(6);   // 1000 / (2 ms + 31 ms) a second
      expect(Math.min(...gaps(since(t)))).toBeGreaterThan(1000 / hz - 1);   // one Render a vsync at most
    }
  });

  it('gives a slow visualizer 60% of the time: 25 ms Renders come every 41 ms', () => {
    h.cost = 25;
    run(1000);
    const t = now();
    run(10_000);
    expect(Math.abs(since(t).length - 244)).toBeLessThan(5);
  });

  it("keeps the user's fixed rates", () => {
    store.getState().actions.setSettings({ fps: 60 });
    let t = now();
    run(10_000, 120);
    expect(Math.abs(since(t).length - 600)).toBeLessThan(6);
    store.getState().actions.setSettings({ fps: 120 });
    t = now();
    run(10_000, 60);                  // up to 3 Renders a vsync, as before
    expect(Math.abs(since(t).length - 1200)).toBeLessThan(12);
  });

  it('a preset change keeps the engine and restarts the pacing (30 ms for 8 frames); a family change makes a new one', () => {
    h.cost = 20;
    run(2000);
    store.getState().actions.setVis('alchemy', 0);                      // no change at all: nothing happens
    store.getState().actions.setVis('bars', 2);
    expect(h.made.map((m) => m.kind + ':' + m.preset)).toEqual(['alchemy:0', 'bars:2']);
    let t = now();
    run(1000);
    expect(since(t).every((r) => r.eng === 2)).toBe(true);
    expect(gaps(since(t)).slice(0, 9)).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 33]);   // at once, then 20 + 30, then 20 + 13
    store.getState().actions.setVis('bars', 3);
    t = now();
    run(1000);
    expect(h.made).toHaveLength(2);                                      // the same object...
    expect(h.setPresets).toEqual([3]);                                   // ...told its new preset
    expect(gaps(since(t)).slice(0, 9)).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 33]);
    store.getState().actions.setVis('battery', 0);
    expect(h.made.map((m) => m.kind)).toEqual(['alchemy', 'bars', 'battery']);
  });

  it('never catches up after a hidden tab or a stall', () => {
    run(1000);
    h.clock = vsync += 5000;          // no vsyncs for 5 s
    const t = now();
    run(200);
    expect(gaps(since(t)).every((g) => g >= 33)).toBe(true);
    expect(since(t).length).toBeLessThanOrEqual(7);
  });

  it('feeds each Render the level fetched for it; paused, only Particle keeps rendering (at state 1, as WMP renders paused)', () => {
    let fetched = 0;
    const level = { ...ticker.level, state: 2 };
    store.getState().actions.setLevel(() => { fetched++; return level; });
    run(1000);
    const n = since(0).length;
    expect(fetched).toBe(n);
    level.state = 1;
    store.getState().actions.setPlayback({ capture: { kind: 'tone', label: '', paused: true, acc: 0, from: 0 } });
    let t = now();
    run(1000);
    expect(since(t)).toHaveLength(0);                                    // the others hold their picture
    store.getState().actions.setVis('particle', 1);                      // which keeps spinning
    t = now();
    run(1000);
    expect(since(t).length).toBeGreaterThan(25);
    expect(since(t).every((r) => r.state === 1)).toBe(true);
  });

  it('holds while a library view covers the visualizer, as WMP renders nothing it does not show', () => {
    store.getState().actions.setView('library');
    const t = now();
    run(1000);
    expect(since(t)).toHaveLength(0);
    store.getState().actions.setView('now');
    run(1000);
    expect(since(t).length).toBeGreaterThan(25);
  });
});
