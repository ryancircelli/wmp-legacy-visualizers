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

/** Walk the flat preset list across all three engines. */
export function cyclePreset(sh: Shell, d: number): void {
  const n = sh.presets.length, s = sh.store.getState();
  if (!n) return;
  const p = sh.presets[(presetIndex(sh.presets, s) + d + n) % n]!;
  s.actions.setVis(p.vis, p.preset);
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

/** Run `cb` on every animation frame while mounted. */
export function useRaf(cb: () => void): void {
  const ref = useRef(cb);
  useLayoutEffect(() => { ref.current = cb; });
  useEffect(() => {
    let id = 0;
    const tick = () => { ref.current(); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** A value derived from the clock (position, capture time): computed in render, and re-rendered on
 *  the frame it changes. `fn` must return a primitive. */
export function useFrame<T extends string | number | boolean>(fn: () => T): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const v = fn(), last = useRef(v), f = useRef(fn);
  useLayoutEffect(() => { last.current = v; f.current = fn; });
  useRaf(() => { if (f.current() !== last.current) force(); });
  return v;
}

/** Join class names, skipping the falsy ones. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
