// The Settings and Extras screens' own preferences, each a localStorage 'ipod.*' key read through one
// external store, so every reader (the chrome's status row and main menu included) re-renders on a
// change. Storage that throws (blocked) falls back to memory for the session.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useShell } from '../../../../ui';
import { STOPWATCH0, type Stopwatch } from './logic';

const subs = new Set<() => void>();
const mem = new Map<string, string>();
const cache = new Map<string, { raw: string | null; val: unknown }>();
const notify = () => { for (const f of [...subs]) f(); };
function subscribe(f: () => void) {
  if (!subs.size) window.addEventListener('storage', notify);
  subs.add(f);
  return () => { subs.delete(f); if (!subs.size) window.removeEventListener('storage', notify); };
}
function raw(key: string): string | null {
  try { return localStorage.getItem(key) ?? mem.get(key) ?? null; } catch { return mem.get(key) ?? null; }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The stored value, the default's missing fields filled in; a corrupt or mistyped blob reads as the default. */
export function readPref<T>(key: string, def: T): T {
  const r = raw(key), c = cache.get(key);
  if (c && c.raw === r) return c.val as T;
  let val = def;
  try {
    const p = r == null ? undefined : JSON.parse(r) as unknown;
    if (isObj(def) && isObj(p)) val = { ...def, ...p };
    else if (p !== undefined && typeof p === typeof def && Array.isArray(p) === Array.isArray(def)) val = p as T;
  } catch { /* corrupt: the default */ }
  cache.set(key, { raw: r, val });
  return val;
}
export function writePref<T>(key: string, v: T): void {
  const s = JSON.stringify(v);
  try { localStorage.setItem(key, s); mem.delete(key); } catch { mem.set(key, s); }
  notify();
}
export function usePref<T>(key: string, def: T): [T, (v: T) => void] {
  return [useSyncExternalStore(subscribe, () => readPref(key, def)), (v: T) => writePref(key, v)];
}
/** Settings > Reset Settings: every 'ipod.*' key goes (the chrome's 'ipod.settings' too). */
export function resetPrefs(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('ipod.')) keys.push(k); }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* blocked storage: memory only */ }
  mem.clear();
  notify();
}

// ---- Main Menu / Music Menu ----------------------------------------------------------------------
/** The rows Settings > Main Menu and Music Menu turn on and off, in the nano 5G's order, by the
 *  chrome's row id (src/skins/ipod/menus.tsx: the label in lower case without spaces). */
const rows = (labels: string[]) => labels.map((l) => [l.toLowerCase().replace(/\s+/g, ''), l] as const);
export const MAIN_MENU = rows(['Music', 'Videos', 'Photos', 'Podcasts', 'FM Radio', 'Voice Memos', 'Extras', 'Shuffle Songs']);
export const MUSIC_MENU = rows(['Cover Flow', 'Playlists', 'Artists', 'Albums', 'Songs', 'Genres', 'Composers', 'Audiobooks', 'Search']);
/** 'ipod.menus': which main- and music-menu rows show, by row id (MAIN_MENU, MUSIC_MENU). Every
 *  listed id is present; an id not listed (Settings, Now Playing) is undefined: show it. */
export interface MenuVisibility { main: Record<string, boolean>; music: Record<string, boolean> }
const allOn = (l: typeof MAIN_MENU) => Object.fromEntries(l.map(([id]) => [id, true]));
const MENUS0: MenuVisibility = { main: allOn(MAIN_MENU), music: allOn(MUSIC_MENU) };

export function useMenuVisibility(): MenuVisibility {
  const [v] = usePref('ipod.menus', MENUS0);
  return useMemo(() => ({ main: { ...MENUS0.main, ...v.main }, music: { ...MENUS0.music, ...v.music } }), [v]);
}
export function setMenuItem(menu: keyof MenuVisibility, id: string, on: boolean): void {
  const v = readPref('ipod.menus', MENUS0);
  writePref('ipod.menus', { ...v, [menu]: { ...v[menu], [id]: on } });
}

// ---- Date & Time -----------------------------------------------------------------------------------
/** 'ipod.clock': Settings > Date & Time's 24 Hour Clock and Time in Title (the status row shows the
 *  time instead of the screen's title). fmtClock(h, m, twentyFourHour) writes it. */
export interface ClockPrefs { twentyFourHour: boolean; timeInTitle: boolean }
export const CLOCK0: ClockPrefs = { twentyFourHour: false, timeInTitle: false };
export const useClockPrefs = (): ClockPrefs => usePref('ipod.clock', CLOCK0)[0];

// ---- Volume Limit ----------------------------------------------------------------------------------
/** 'ipod.volumeLimit': 0..100, 100 = no limit. */
export const useVolumeLimitPref = () => usePref('ipod.volumeLimit', 100);
/** Mount once, in the chrome's Root: holds the Spotify player's volume (settings.volume) at or under
 *  Settings > Volume Limit. The local engine's volume is capture sensitivity, never limited. */
export function useVolumeLimit(): void {
  const [limit] = useVolumeLimitPref(), store = useShell().store;
  useEffect(() => store.subscribe((s) => s.auth.engine === 'spotify' && s.settings.volume > limit,
    (over) => { if (over) store.getState().actions.setSettings({ volume: limit }); }, { fireImmediately: true }), [store, limit]);
}

// ---- Extras ----------------------------------------------------------------------------------------
/** 'ipod.clocks': the world clocks' IANA zones, '' = this device's */
export const useClocks = () => usePref<string[]>('ipod.clocks', ['']);
export const useStopwatch = () => usePref<Stopwatch>('ipod.stopwatch', STOPWATCH0);
/** 'ipod.lock': the Screen Lock combination, four digits */
export const useLockCode = () => usePref('ipod.lock', '0000');
/** 'ipod.appearance': what Settings > Appearance last asked the host for */
export const useAppearance = () => usePref<'light' | 'dark' | 'auto'>('ipod.appearance', 'auto');
