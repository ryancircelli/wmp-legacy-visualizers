// The render loop the old shell ran (src/90-shell.js frame()): a fixed-fps accumulator on rAF,
// at most 3 engine steps a frame, paused while the capture is, held while a non-visualizer view
// covers the screen (full screen always shows the visualizer), stopped while the desktop host's
// window is covered (ui/shell.ts occluded), and the first painted frame reported once.
// The engine and the canvas come and go with the <Visualizer/> that shows them.
import { createEngine, makeLevel, nativeSize, type TimedLevel, type VisEngine } from '../engine';
import type { AppStore } from '../model';
import { occluded, onSeen } from '../ui/shell';

export interface Ticker {
  attach(canvas: HTMLCanvasElement): () => void;
  readonly engine: VisEngine | null;
  readonly level: TimedLevel;
  readonly fps: number;
  /** a test/debug hold on top of the capture's own pause */
  paused: boolean;
  nativeSize(): [number, number];
  debugText(): string;
}

/** ms: rAF timestamps jitter by about half a millisecond; any display under 500 Hz has vsyncs further apart than this. */
const SLACK = 2;

function mark(n: string) {
  window.alchemyMarks?.push(n + '=' + Math.round(performance.now()));
}

export function createTicker(store: AppStore, onFirstFrame: () => void): Ticker {
  const silent = makeLevel();
  let canvas: HTMLCanvasElement | null = null, eng: VisEngine | null = null, level: TimedLevel = silent;
  let acc = 0, last = 0, frames = 0, fpsAt = 0, fps = 0, raf = 0, first = true;
  const S = () => store.getState().settings;
  const full = (s = store.getState()) => !!document.fullscreenElement || s.ui.bare || s.auth.mode === 'screensaver';
  /** Nothing to draw: held (a library view covers the visualizer; full screen always shows it), or
   *  the capture is paused. The loop stops asking for frames then, as it does covered: every rAF is
   *  a whole Chromium frame even when the callback does nothing (measured 2026-09-29 at 120 Hz: an
   *  empty rAF loop cost ~3% of a core across the page and GPU processes). */
  const idle = (s = store.getState()) => (s.vis.hold && !full(s)) || !!s.playback.capture?.paused;

  function fillLevel(): TimedLevel {
    const f = store.getState().vis.level;
    if (f) return (level = f());
    // no audio producer yet: digital silence, still animating if the setting says so
    silent.state = !t.paused && S().animate ? 2 : 1;
    silent.timeStamp = performance.now();
    return (level = silent);
  }

  function make() {
    if (!canvas) return;
    const s = store.getState();
    eng = createEngine(s.vis.kind, canvas, { preset: s.vis.preset, scale: S().scale,
      options: { intended: S().intended, fps: S().fps, backgroundColor: S().bg, alpha: s.vis.alpha, tint: s.vis.tint } });
  }

  function frame(now: number) {
    // covered: the engine pauses as it does minimized; idle: no frames asked for until there is one to draw
    if (occluded() || idle()) { raf = 0; fps = 0; return; }
    raf = requestAnimationFrame(frame);
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;                       // tab was hidden; don't catch up
    const step = 1000 / S().fps, st = store.getState();
    const paused = t.paused || !!st.playback.capture?.paused;
    acc += dt;
    let runs = 0, drew = false;
    // SLACK: a step due within 2 ms is taken on this vsync. Without it a 120 Hz display (two vsyncs
    // per 60 fps step) sums two rAF intervals to a hair under or over the step, and the steps land
    // 8 and 25 ms apart instead of every 16.7 (measured 2026-09-29: 5-59% of presents per run; 0-1% with it).
    while (acc >= step - SLACK && runs < 3) {     // hard cap: no spiral of death
      acc -= step; runs++;
      if (eng && !paused) { eng.render(fillLevel()); drew = true; }
    }
    if (acc > step * 3) acc = 0;
    if (drew && eng) {
      eng.present(); frames++;
      if (first) {
        first = false; mark('firstRender');
        // setTimeout, not straight through: inside rAF the frame is not composited yet.
        setTimeout(onFirstFrame, 0);
      }
    }
    if (now - fpsAt >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0; fpsAt = now;
    }
  }

  const t: Ticker = {
    paused: false,
    get engine() { return eng; },
    get level() { return level; },
    get fps() { return fps; },
    attach(c) {
      canvas = c;
      make();
      const offs = [
        store.subscribe((s) => s.vis.kind + ':' + s.vis.preset, () => {
          const s = store.getState();
          if (eng && eng.kind === s.vis.kind) eng.setPreset(s.vis.preset);
          else make();
        }),
        store.subscribe((s) => s.settings.scale, (v) => eng?.setScale(v)),
        store.subscribe((s) => s.settings.intended, (v) => { if (eng) eng.options.intended = v; }),
        store.subscribe((s) => s.settings.bg, (v) => { if (eng) eng.options.backgroundColor = v; }),
        store.subscribe((s) => s.settings.fps, (v) => { if (eng) eng.options.fps = v; acc = 0; }),
        store.subscribe((s) => s.vis.alpha, (v) => { if (eng) eng.options.alpha = v; }),
        store.subscribe((s) => s.vis.tint, (v) => { if (eng) eng.options.tint = v; }),
      ];
      // One observer covers window resizes, full screen and the task pane collapsing.
      let tm = 0;
      const ro = new ResizeObserver(() => { clearTimeout(tm); tm = window.setTimeout(() => eng?.resize(), 150); });
      ro.observe(c);
      last = fpsAt = performance.now();
      raf = requestAnimationFrame(frame);
      const start = () => { if (!raf && !occluded() && !idle()) { last = fpsAt = performance.now(); raf = requestAnimationFrame(frame); } };
      const offSeen = onSeen(start);
      offs.push(store.subscribe(idle, (v) => { if (!v) start(); }));
      return () => {
        cancelAnimationFrame(raf); ro.disconnect(); clearTimeout(tm); offSeen();
        for (const off of offs) off();
        canvas = null; eng = null;
      };
    },
    nativeSize() {
      const c = canvas;
      return nativeSize(store.getState().vis.kind, Math.max(16, c?.clientWidth || innerWidth), Math.max(16, c?.clientHeight || innerHeight));
    },
    debugText() {
      if (!eng || !canvas) return '';
      let d: unknown;
      try { d = eng.debug(); } catch (e) { d = { error: String(e) }; }
      const st = store.getState(), c = st.playback.capture;
      return 'fps ' + fps + ' / ' + S().fps + '   buffer ' + eng.width + 'x' + eng.height +
        ' (' + S().scale + ')   view ' + canvas.width + 'x' + canvas.height +
        '\nstate ' + level.state + (t.paused || c?.paused ? ' PAUSED' : '') +
        '   source ' + (c ? c.kind : 'none') + '\n' + JSON.stringify(d, null, 1);
    },
  };
  return t;
}
