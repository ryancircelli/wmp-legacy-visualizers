// The Settings and Extras screens' own preferences, each a localStorage 'ipod.*' key read through one
// external store, so every reader (the chrome's status row and main menu included) re-renders on a
// change. Storage that throws (blocked) falls back to memory for the session.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useShell, type Preset } from '../../../../ui';
import type { MenuItem } from '../contract';
import { msUntil, STOPWATCH0, type Stopwatch, type StopwatchLog } from './logic';

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

// ---- Main Menu / Library Filters -----------------------------------------------------------------
/** The rows Settings > Menus > Main Menu turns on and off, in the chrome's order, by its row id
 *  (src/skins/ipod/menus.tsx: the label in lower case without spaces), and Library Filters' chips. */
const rows = (labels: string[]) => labels.map((l) => [l.toLowerCase().replace(/\s+/g, ''), l] as const);
export const MAIN_MENU = rows(['Home', 'Search', 'Library', 'Radio', 'Extras']);
/** the Library's filter chips (stored under `music`, the Library menu's old name) */
export const LIBRARY_FILTERS = rows(['Playlists', 'Albums', 'Artists', 'Podcasts']);
/** Off until turned on: Extras, Podcasts (the adapter lists no shows yet). */
const OFF = new Set(['extras', 'podcasts']);
/** 'ipod.menus': which main-menu rows and Library chips show, by id (MAIN_MENU, LIBRARY_FILTERS), and
 *  Every listed id is present; an id not
 *  listed (Settings, Now Playing) is undefined: show it. Only the user's own choices are stored; a
 *  stored id no menu lists any more is ignored. */
export interface MenuVisibility { main: Record<string, boolean>; music: Record<string, boolean> }
const shown = (l: typeof MAIN_MENU) => Object.fromEntries(l.map(([id]) => [id, !OFF.has(id)]));
const MENUS0: MenuVisibility = { main: shown(MAIN_MENU), music: shown(LIBRARY_FILTERS) };
const CHOSEN0: MenuVisibility = { main: {}, music: {} };

export function useMenuVisibility(): MenuVisibility {
  const [v] = usePref('ipod.menus', CHOSEN0);
  return useMemo(() => ({ main: { ...MENUS0.main, ...v.main }, music: { ...MENUS0.music, ...v.music } }), [v]);
}
export function setMenuItem(menu: keyof MenuVisibility, id: string, on: boolean): void {
  const v = readPref('ipod.menus', CHOSEN0);
  writePref('ipod.menus', { ...v, [menu]: { ...v[menu], [id]: on } });
}
/** Library Filters > Reset Filters: the chips as they ship */
export const resetMenu = (menu: keyof MenuVisibility) => writePref('ipod.menus', { ...readPref('ipod.menus', CHOSEN0), [menu]: {} });

// ---- Playback, Appearance, Menus ---------------------------------------------------------------------
/** 'ipod.view': Menus > Library View: the library's lists (Home's shelves, Playlists, Albums,
 *  Artists, Search's artists, albums and playlists) as a grid of covers, or as rows; songs are always rows */
export type LibraryView = 'grid' | 'list';
export const useLibraryView = () => usePref<LibraryView>('ipod.view', 'grid');
/** 'ipod.libraryFilter': the Library's chosen chip (a LIBRARY_FILTERS id) */
export const useLibraryFilter = () => usePref('ipod.libraryFilter', 'playlists');
/** 'ipod.shake': Playback > Shake (iPhone): a shake skips to the next song */
export const useShake = () => usePref('ipod.shake', true);
/** 'ipod.visFit': Appearance > Visualizer Fit: Fit draws it at the screen's own shape (settings.scale 'auto'),
 *  Stretch is WMP's native surface stretched to the screen ('original'); Now Playing applies it while
 *  the visualizer shows. Anything but 'stretch' reads as Fit. */
export type VisFit = 'fit' | 'stretch';
export const useVisFit = () => usePref<VisFit>('ipod.visFit', 'fit');
/** 'ipod.visualizer': the visualization Now Playing shows, a registry entry's (shell presets) visId,
 *  Bars and Waves' Bars until another is chosen; applied onto the shared settings.vis / preset only
 *  while it shows, as visFit is, so the WMP 9 skin's own choice is untouched. */
export const visId = (p: { vis: string; preset: number }) => p.vis + ':' + p.preset;
export const useVisualizer = () => usePref('ipod.visualizer', 'bars:0');
/** The registry by engine (Alchemy, Bars and Waves, Battery), for Now Playing's Visualizer… (its ⋯
 *  and hold menus): `engines(open)` the engine rows, the one holding the choice showing its name, each
 *  `open`ing its `presets(group)`, the choice checked; an engine of one preset (Alchemy's Random) is
 *  picked at its own row. A pick sets the pref, then `then`. */
export function useVisualizers(then?: () => void) {
  const sh = useShell(), [cur, set] = useVisualizer(), chosen = sh.presets.find((p) => visId(p) === cur);
  const of = (g: string) => sh.presets.filter((p) => p.group === g);
  const row = (p: Preset, label = p.name): MenuItem => ({ id: visId(p), label, right: visId(p) === cur ? '✓' : undefined,
                                                         onSelect: () => { set(visId(p)); then?.(); } });
  return {
    presets: (g: string) => of(g).map((p) => row(p)),
    engines: (open: (g: string) => void): MenuItem[] => [...new Set(sh.presets.map((p) => p.group))].map((g) => {
      const ps = of(g);
      return ps.length === 1 ? row(ps[0]!, g)
        : { id: g, label: g, right: chosen?.group === g ? chosen.name : undefined, chevron: true, onSelect: () => open(g) };
    }),
  };
}

// ---- Time in Title ---------------------------------------------------------------------------------
/** 'ipod.clock': Appearance > Time in Title (the status row over the menus shows the time instead of
 *  the screen's title). The clock's 12 / 24 hours are the device's (logic.ts h24); an old stored
 *  twentyFourHour is ignored, and dropped at the next write. */
export interface ClockPrefs { timeInTitle: boolean }
export const CLOCK0: ClockPrefs = { timeInTitle: false };
export const useClockPrefs = (): ClockPrefs => usePref('ipod.clock', CLOCK0)[0];

// ---- Volume Limit ----------------------------------------------------------------------------------
/** 'ipod.volumeLimit': 0..100, 100 = no limit. */
export const useVolumeLimitPref = () => usePref('ipod.volumeLimit', 100);

// ---- Extras ----------------------------------------------------------------------------------------
/** 'ipod.clocks': the world clocks' IANA zones, '' = this device's */
export const useClocks = () => usePref<string[]>('ipod.clocks', ['']);
export const useStopwatch = () => usePref<Stopwatch>('ipod.stopwatch', STOPWATCH0);
/** 'ipod.stopwatch.logs': Stopwatch's finished timers, newest first */
export const useStopwatchLogs = () => usePref<StopwatchLog[]>('ipod.stopwatch.logs', []);
/** 'ipod.lock': the Screen Lock combination, four digits; '' = none set yet */
export const useLockCode = () => usePref('ipod.lock', '');
/** 'ipod.appearance': what Settings' Theme last asked the host for */
export const useAppearance = () => usePref<'light' | 'dark' | 'auto'>('ipod.appearance', 'auto');
/** 'ipod.sleep': Alarms > Sleep Timer, for the chrome's moon too: `at` the Date.now() it pauses at
 *  (null = off), `mins` the choice */
export interface SleepTimer { at: number | null; mins: number }
export const SLEEP0: SleepTimer = { at: null, mins: 0 };
export const useSleepTimer = () => usePref('ipod.sleep', SLEEP0);
/** 'ipod.alarm': Alarms > Alarm: plays (commands.play) every day at h:mm while on */
export interface Alarm { on: boolean; h: number; m: number }
export const useAlarm = () => usePref<Alarm>('ipod.alarm', { on: false, h: 7, m: 0 });

// ---- what runs everywhere ------------------------------------------------------------------------------
/** Mount once, in the chrome's Root: Volume Limit holds the Spotify player's volume (settings.volume)
 *  at or under it (the local engine's volume is capture sensitivity, never limited); Shake skips on
 *  the iPhone's 'wmp-shake'; the sleep timer pauses when it runs out and the alarm plays when it is
 *  time, whichever screen shows (both only while the page runs). */
export function useSettingsEffects(): void {
  const store = useShell().store, [limit] = useVolumeLimitPref(), [shake] = useShake(), [sleep] = useSleepTimer(), [alarm] = useAlarm();
  const [rang, setRang] = useState(0);
  useEffect(() => store.subscribe((s) => s.auth.engine === 'spotify' && s.settings.volume > limit,
    (over) => { if (over) store.getState().actions.setSettings({ volume: limit }); }, { fireImmediately: true }), [store, limit]);
  useEffect(() => {
    if (!shake) return;
    const next = () => void store.getState().commands.next();
    window.addEventListener('wmp-shake', next);
    return () => window.removeEventListener('wmp-shake', next);
  }, [store, shake]);
  useEffect(() => {
    if (sleep.at == null) return;
    const t = setTimeout(() => { void store.getState().commands.pause(); writePref('ipod.sleep', SLEEP0); }, Math.max(0, sleep.at - Date.now()));
    return () => clearTimeout(t);
  }, [store, sleep.at]);
  useEffect(() => {
    if (!alarm.on) return;
    // `rang` re-arms it for tomorrow
    const t = setTimeout(() => { void store.getState().commands.play(); setRang((n) => n + 1); }, msUntil(alarm.h, alarm.m, Date.now()));
    return () => clearTimeout(t);
  }, [store, alarm.on, alarm.h, alarm.m, rang]);
}
/** The name Root mounts it by (it began as Volume Limit alone). */
export const useVolumeLimit = useSettingsEffects;
