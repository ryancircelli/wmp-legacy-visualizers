// The Settings and Extras screens' own preferences, each a localStorage 'ipod.*' key read through one
// external store, so every reader (the chrome's status row and main menu included) re-renders on a
// change. Storage that throws (blocked) falls back to memory for the session.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useShell } from '../../../../ui';
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

// ---- Main Menu / Music Menu ----------------------------------------------------------------------
/** The rows Settings > General > Main Menu and Music Menu turn on and off, in the chrome's order, by
 *  its row id (src/skins/ipod/menus.tsx: the label in lower case without spaces). */
const rows = (labels: string[]) => labels.map((l) => [l.toLowerCase().replace(/\s+/g, ''), l] as const);
export const MAIN_MENU = rows(['Music', 'Videos', 'Photos', 'Podcasts', 'Radio', 'Extras', 'Shuffle Songs']);
export const MUSIC_MENU = rows(['Cover Flow', 'Genius Mixes', 'Playlists', 'Artists', 'Albums', 'Songs', 'Genres', 'Composers', 'Audiobooks', 'Search']);
/** Off until turned on: what Spotify has nothing behind (docs/ipod-skin.md §4.2, the owner's §6 calls).
 *  Voice Memos is Extras' own row; its main-menu id is off should the chrome list it. */
const OFF = new Set(['videos', 'podcasts', 'voicememos', 'genres', 'composers', 'audiobooks']);
/** 'ipod.menus': which main- and music-menu rows show, by row id (MAIN_MENU, MUSIC_MENU), and
 *  main.previewpanel (General > Main Menu > Preview Panel). Every listed id is present; an id not
 *  listed (Settings, Now Playing) is undefined: show it. Only the user's own choices are stored. */
export interface MenuVisibility { main: Record<string, boolean>; music: Record<string, boolean> }
const shown = (l: typeof MAIN_MENU) => Object.fromEntries(l.map(([id]) => [id, !OFF.has(id)]));
const MENUS0: MenuVisibility = { main: { ...shown(MAIN_MENU), voicememos: false, previewpanel: true }, music: shown(MUSIC_MENU) };
const CHOSEN0: MenuVisibility = { main: {}, music: {} };

export function useMenuVisibility(): MenuVisibility {
  const [v] = usePref('ipod.menus', CHOSEN0);
  return useMemo(() => ({ main: { ...MENUS0.main, ...v.main }, music: { ...MENUS0.music, ...v.music } }), [v]);
}
export function setMenuItem(menu: keyof MenuVisibility, id: string, on: boolean): void {
  const v = readPref('ipod.menus', CHOSEN0);
  writePref('ipod.menus', { ...v, [menu]: { ...v[menu], [id]: on } });
}
/** Music Menu > Reset Menu: the Music menu as it ships */
export const resetMenu = (menu: keyof MenuVisibility) => writePref('ipod.menus', { ...readPref('ipod.menus', CHOSEN0), [menu]: {} });

// ---- General, Playback -------------------------------------------------------------------------------
/** 'ipod.display', for the chrome (useDisplayPrefs): General > Backlight (seconds idle before the LCD
 *  goes dark, 0 = Always On), General > Brightness off the iPhone (0.2..1; the chrome dims the LCD by
 *  it; on the iPhone it is the phone's own), Playback > Energy Saver (off: the clock screen, not black). */
export interface DisplayPrefs { backlight: number; brightness: number; energySaver: boolean }
export const DISPLAY0: DisplayPrefs = { backlight: 10, brightness: 1, energySaver: true };
export const useDisplay = () => usePref('ipod.display', DISPLAY0);
export const useDisplayPrefs = (): DisplayPrefs => useDisplay()[0];
/** 'ipod.shake': Playback > Shake (iPhone): a shake skips to the next song */
export const useShake = () => usePref('ipod.shake', true);

// ---- Date & Time -----------------------------------------------------------------------------------
/** 'ipod.clock': Settings > Date & Time's 24 Hour Clock and Time in Title (the status row shows the
 *  time instead of the screen's title). fmtClock(h, m, twentyFourHour) writes it. */
export interface ClockPrefs { twentyFourHour: boolean; timeInTitle: boolean }
export const CLOCK0: ClockPrefs = { twentyFourHour: false, timeInTitle: false };
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
/** 'ipod.appearance': what Settings > Appearance last asked the host for */
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
