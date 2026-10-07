// The store binding and the behaviours every skin shares (the menus' and the keyboard's
// Previous/Next, the preset walk, the per-frame clock), so a second skin reuses them.
import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { hasMedia, type AppState } from '../model';
import type { Preset, Shell } from './types';

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const s = useContext(ShellContext);
  if (!s) throw new Error('skin rendered outside <ShellContext>');
  return s;
}

/** A store selector; objects and arrays compare shallowly. */
export function useApp<T>(sel: (s: AppState) => T): T {
  return useStore(useShell().store, useShallow(sel));
}

export function presetIndex(presets: readonly Preset[], s: AppState): number {
  const i = presets.findIndex((p) => p.vis === s.vis.kind && p.preset === s.vis.preset);
  return i < 0 ? 0 : i;
}

export function presetLabel(presets: readonly Preset[], s: AppState): string {
  const p = presets[presetIndex(presets, s)];
  return p ? p.group + ' : ' + p.name : 'Alchemy : Random';
}

/** WMP's next()/previous(): one flat walk over every preset of every family, wrapping at both ends, so
 *  stepping back out of a family lands on the previous family's last preset. */
export function cyclePreset(sh: Shell, d: number): void {
  const n = sh.presets.length, s = sh.store.getState();
  if (!n) return;
  const p = sh.presets[(presetIndex(sh.presets, s) + d + n) % n]!;
  s.actions.setVis(p.vis, p.preset);
}

/** WMP's nextEffect()/previousEffect() (Shift+click on WMP 7's and 9's arrows): the next family at its
 *  first preset, the previous family at its last, wrapping. */
export function cycleFamily(sh: Shell, d: number): void {
  const ps = sh.presets, n = ps.length, s = sh.store.getState(), i = presetIndex(ps, s);
  for (let k = 1; k < n; k++) {
    const p = ps[(((i + d * k) % n) + n) % n]!;
    if (p.vis !== ps[i]!.vis) { s.actions.setVis(p.vis, p.preset); return; }
  }
}

/** Prev/Next: the session's track skip while one exists, the visualizers otherwise. */
export function prevNext(sh: Shell, d: number): void {
  const s = sh.store.getState(), p = s.playback;
  if (!hasMedia(s)) return cyclePreset(sh, d);
  if (d < 0 ? p.canPrev : p.canNext) {
    if (d < 0) void s.commands.prev();
    else void s.commands.next();
  }
}

/** Playing: the session's own status, or a capture that is attached and not paused. */
export const isPlaying = (s: AppState) =>
  hasMedia(s) ? s.playback.status === 'playing' : !!s.playback.capture && !s.playback.capture.paused;

export const VOL_STEP = 10;

/** The task pane's views, in its (and Ctrl+1..5's) order. */
export const VIEW_LABELS = [
  ['now', 'Now Playing'], ['guide', 'Media Guide'], ['library', 'Media Library'], ['search', 'Search'], ['radio', 'Radio Tuner'],
] as const;

// Covered: the desktop host calls window.alchemyOccluded when its window stops or starts being seen
// (tauri/src/win.rs occluded). WebView2 runs rAF at 60 fps for a window nobody can see, so every
// frame loop stops asking while it is covered and is restarted when it is not, as minimized does.
let covered = false;
const seen = new Set<() => void>();
/** Whether the host's window is covered; a frame loop that finds it so stops and waits for onSeen. */
export const occluded = (): boolean => covered;
/** Runs `f` each time the window is seen again; returns the unsubscribe. */
export function onSeen(f: () => void): () => void {
  seen.add(f);
  return () => { seen.delete(f); };
}
if (typeof window !== 'undefined') {
  window.alchemyOccluded = (on) => { covered = on; if (!on) for (const f of [...seen]) f(); };
}

/** Run `cb` on every animation frame while mounted, `on` and not covered. */
export function useRaf(cb: () => void, on = true): void {
  const ref = useRef(cb);
  useLayoutEffect(() => { ref.current = cb; });
  useEffect(() => {
    if (!on) return;
    let id = 0;
    const tick = () => { if (covered) { id = 0; return; } ref.current(); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    const off = onSeen(() => { if (!id) id = requestAnimationFrame(tick); });
    return () => { off(); cancelAnimationFrame(id); };
  }, [on]);
}

/** Run `cb` whenever the clock may have moved: every frame while it runs (isPlaying) and `on`, and
 *  on every store change (a seek or a state event while paused). A stopped clock asks for no frames. */
export function useClock(cb: () => void, on = true): void {
  const store = useShell().store, ref = useRef(cb), playing = useApp(isPlaying);
  useLayoutEffect(() => { ref.current = cb; });
  useEffect(() => store.subscribe(() => ref.current()), [store]);
  useRaf(() => ref.current(), on && playing);
}

/** A value derived from the clock (position, capture time): computed in render, and re-rendered on
 *  the frame it changes. `fn` must return a primitive. */
export function useFrame<T extends string | number | boolean>(fn: () => T): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const v = fn(), last = useRef(v), f = useRef(fn);
  useLayoutEffect(() => { last.current = v; f.current = fn; });
  useClock(() => { if (f.current() !== last.current) force(); });
  return v;
}

/** Join class names, skipping the falsy ones. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
