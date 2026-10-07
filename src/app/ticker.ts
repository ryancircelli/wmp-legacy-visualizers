// The render loop: by default WMP's own pacing (wmpDelay), else the old shell's fixed-fps
// accumulator (src/90-shell.js frame(), at most 3 engine steps a frame), both on rAF. Held while a
// non-visualizer view covers the screen (full screen always shows the visualizer), stopped while the
// desktop host's window is covered (ui/shell.ts occluded), and the first painted frame reported once.
// A paused capture stops rendering, as before, except Particle's: WMP renders paused too (the level at
// state 1), and every other family's DLL then holds its picture, so those Renders change nothing and only
// cost power (the phone); Particle's spin goes on, so it keeps rendering. The engine and the canvas come
// and go with the <Visualizer/> that shows them.
import { createEngine, makeLevel, nativeSize, type TimedLevel, type VisEngine } from '../engine';
import type { AppStore } from '../model';
import { occluded, onSeen } from '../ui/shell';

export interface Ticker {
  attach(canvas: HTMLCanvasElement): () => void;
  readonly engine: VisEngine | null;
  readonly level: TimedLevel;
  readonly fps: number;
  /** a test/debug hold: no Render at all (a paused capture still renders, its level at state 1) */
  paused: boolean;
  nativeSize(): [number, number];
  debugText(): string;
}

/** ms: rAF timestamps jitter by about half a millisecond; any display under 500 Hz has vsyncs further apart than this. */
const SLACK = 2;
/** ms between the host log's perf lines */
const PERF_MS = 60_000;

/**
 * WMP's frame pacing, the same in every version from 7.0 to 12 (re/player/PLAYER.md §4: WMP 9 0x0770b3f0,
 * WMP 12 0x10576260, WMP 7.1 0x52578295). After each Render the player re-arms its timer with this delay:
 * 30 ms while fewer than 8 render times are kept (`hist`, emptied on every preset change), else
 * clamp(max(avg / 0.6, 33.333) - avg, 10, 500) ms truncated to whole ms, avg the mean of the last 8. So at
 * most ~30 frames a second, and a slow visualizer gets 60% of the time. `ms` is this Render's own time.
 */
export function wmpDelay(hist: number[], ms: number): number {
  const had = hist.length;
  hist.push(ms);
  if (hist.length > 8) hist.shift();
  if (had < 8) return 30;
  const avg = (hist.reduce((a, b) => a + b, 0)) * 0.125;
  return Math.trunc(Math.min(500, Math.max(10, Math.max(avg / 0.6, 100 / 3) - avg)));
}

function mark(n: string) {
  window.alchemyMarks?.push(n + '=' + Math.round(performance.now()));
}

export function createTicker(store: AppStore, onFirstFrame: () => void): Ticker {
  const silent = makeLevel();
  let canvas: HTMLCanvasElement | null = null, eng: VisEngine | null = null, level: TimedLevel = silent;
  let acc = 0, last = 0, frames = 0, fpsAt = 0, fps = 0, raf = 0, first = true;
  // WMP pacing: when the next Render is due (0: at once), and the last render times (wmpDelay)
  let due = 0;
  const hist: number[] = [];
  // the host's log, once a minute while frames are drawn: the fps reached, the draw's cost (render +
  // present, main thread only), the sizes and the phone's thermal state (the owner: "my phone does overheat")
  let perfAt = 0, drawMs = 0, drawn = 0;
  const S = () => store.getState().settings;
  const full = (s = store.getState()) => !!document.fullscreenElement || s.ui.bare || s.auth.mode === 'screensaver';
  /** Nothing to draw: held (a library view covers the visualizer; full screen always shows it; WMP
   *  too renders nothing it does not show), or the capture is paused and the family holds its picture
   *  then (all but Particle; see the top). The loop stops asking for frames then, as it does covered: every rAF is
   *  a whole Chromium frame even when the callback does nothing (measured 2026-09-29 at 120 Hz: an
   *  empty rAF loop cost ~3% of a core across the page and GPU processes). */
  const idle = (s = store.getState()) => (s.vis.hold && !full(s)) || (!!s.playback.capture?.paused && s.vis.kind !== 'particle');

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
    eng = createEngine(s.vis.kind, canvas, { preset: s.vis.preset, scale: s.vis.scale ?? S().scale,
      options: { intended: S().intended, backgroundColor: S().bg, alpha: s.vis.alpha, tint: s.vis.tint } });
  }

  /** A preset or family change: WMP empties the render-time history (30 ms delays for 8 frames); the next
   *  frame comes at the next vsync (WMP: a family switch arms its timer for 10 ms). */
  function restart() { hist.length = 0; due = 0; }

  function frame(now: number) {
    // covered: the engine pauses as it does minimized; idle: no frames asked for until there is one to draw
    if (occluded() || idle()) { raf = 0; fps = 0; return; }
    raf = requestAnimationFrame(frame);
    const f = S().fps, prev = last;
    last = now;
    let drew = false;
    if (f === 'wmp') {
      // One Render a frame at most, never a catch-up: WMP's timer is armed only once a frame is done.
      // SLACK: a frame due within 2 ms is taken on this vsync.
      if (eng && !t.paused && now >= due - SLACK) {
        const l = fillLevel(), t0 = performance.now();
        eng.render(l);
        eng.present();                                // the DLL's own blit is inside its Render
        const ms = performance.now() - t0;
        drawMs += ms; drew = true;
        // Next due = this frame's start + its render time + the delay. The start is when it was due, so
        // waiting for the vsync after a due time costs nothing and frames average WMP's period at any
        // refresh rate down to 30 Hz; a frame later than that (a stall, a hidden tab, a preset change)
        // starts afresh instead of catching up.
        due = (now - due < 1000 / 30 ? due : now) + ms + wmpDelay(hist, ms);
      }
    } else {
      let dt = now - prev;
      if (dt > 250) dt = 250;                       // tab was hidden; don't catch up
      const step = 1000 / f;
      acc += dt;
      let runs = 0;
      // SLACK: a step due within 2 ms is taken on this vsync. Without it a 120 Hz display (two vsyncs
      // per 60 fps step) sums two rAF intervals to a hair under or over the step, and the steps land
      // 8 and 25 ms apart instead of every 16.7 (measured 2026-09-29: 5-59% of presents per run; 0-1% with it).
      while (acc >= step - SLACK && runs < 3) {     // hard cap: no spiral of death
        acc -= step; runs++;
        if (eng && !t.paused) { const t0 = performance.now(); eng.render(fillLevel()); drawMs += performance.now() - t0; drew = true; }
      }
      if (acc > step * 3) acc = 0;
      if (drew && eng) { const t0 = performance.now(); eng.present(); drawMs += performance.now() - t0; }
    }
    if (drew) {
      frames++; drawn++;
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
    if (!perfAt) perfAt = now;
    else if (now - perfAt >= PERF_MS && window.alchemyLog && eng && canvas) {
      const s = store.getState();
      window.alchemyLog('perf: fps ' + fps + '/' + S().fps + ', draw ' + (drawn ? (drawMs / drawn).toFixed(1) : '-') + ' ms, ' +
        s.vis.kind + ':' + s.vis.preset + ' ' + eng.width + 'x' + eng.height + ' -> ' + canvas.width + 'x' + canvas.height +
        ', thermal ' + (window.__wmpThermal ?? '?') + (window.__wmpLowPower ? ', low power' : ''));
      perfAt = now; drawMs = 0; drawn = 0;
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
      restart();
      const offs = [
        store.subscribe((s) => s.vis.kind + ':' + s.vis.preset, () => {
          const s = store.getState();
          // WMP: another preset of the same family is SetCurrentPreset on the same object (its state kept);
          // another family destroys the object and creates a fresh one
          if (eng && eng.kind === s.vis.kind) eng.setPreset(s.vis.preset);
          else make();
          restart();
        }),
        store.subscribe((s) => s.vis.scale ?? s.settings.scale, (v) => eng?.setScale(v)),
        store.subscribe((s) => s.settings.intended, (v) => { if (eng) eng.options.intended = v; }),
        store.subscribe((s) => s.settings.bg, (v) => { if (eng) eng.options.backgroundColor = v; }),
        store.subscribe((s) => s.settings.fps, () => { acc = 0; }),
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
