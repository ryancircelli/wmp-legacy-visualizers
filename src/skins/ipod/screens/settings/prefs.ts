// The Settings screens' own preferences, each a localStorage 'ipod.*' key read through one
// external store, so every reader (the chrome's main menu included) re-renders on a change. Storage
// that throws (blocked) falls back to memory for the session. (Earlier builds' 'ipod.clock',
// 'ipod.volumeLimit' and 'ipod.shake' are read by nothing now; Reset Settings clears them with the rest.)
import { useMemo, useSyncExternalStore } from 'react';
import { useShell } from '../../../../ui';
import type { MenuItem } from '../contract';

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
export const MAIN_MENU = rows(['Home', 'Search', 'Library', 'Radio', 'Brick']);
/** the Library's filter chips (stored under `music`, the Library menu's old name) */
export const LIBRARY_FILTERS = rows(['Playlists', 'Albums', 'Artists', 'Podcasts']);
/** Off until turned on: none (Podcasts was, until the adapter listed the followed shows, 2026-10-03). */
const OFF = new Set<string>();
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
/** 'ipod.visualizer': the visualization Now Playing shows, a registry entry's (shell presets) visId,
 *  Bars and Waves' Bars until another is chosen; applied onto the shared settings.vis / preset only
 *  while it shows (with settings.scale 'auto'), so the WMP 9 skin's own choice is untouched. */
export const visId = (p: { vis: string; preset: number }) => p.vis + ':' + p.preset;
export const useVisualizer = () => usePref('ipod.visualizer', 'bars:0');
/** 'ipod.visOn': Visualizer… > Visualizer: the visualization drawn over the art (the cover, the Canvas,
 *  or the black when there is neither), clear where it is dark (the engine's 'luma' output; Bars and
 *  Waves in the cover's accent). On at first. */
export const useVisOn = () => usePref('ipod.visOn', true);
/** 'ipod.visOpacity': Visualizer… > Opacity, in percent: the visualization's while it is on; one of
 *  VIS_OPACITY, 50 by default (the owner, 2026-10-02), anything else read as 50 */
export const VIS_OPACITY = [100, 75, 50, 25] as const;
export function useVisOpacity(): [number, (v: number) => void] {
  const [v, set] = usePref('ipod.visOpacity', 50);
  return [(VIS_OPACITY as readonly number[]).includes(v) ? v : 50, set];
}
/** What earlier builds stored, as it is now (2026-10-02): Cover Bars (a value of 'ipod.visualizer' of
 *  its own) is Bars; the tap cycle's visualizer mode ('ipod.canvas' show 'vis') and Over Cover
 *  ('ipod.visOverCover') are the overlay on, and Over Cover's key goes. (NowPlaying.tsx reads a stored
 *  show 'vis' as the cover.) Run at import, before Now Playing's own store reads 'ipod.canvas'. */
export function migrateVisPrefs(): void {
  // readPref caches by key: each read here with the default its hook has, or a key no hook reads
  if (readPref<string>('ipod.visualizer', 'bars:0') === 'cover-bars') { writePref('ipod.visualizer', 'bars:0'); writePref('ipod.visOn', true); }
  const was = readPref<{ state?: { show?: string } }>('ipod.canvas', {}).state?.show === 'vis';
  if (was || readPref('ipod.visOverCover', false)) writePref('ipod.visOn', true);
  try { localStorage.removeItem('ipod.visOverCover'); } catch { /* blocked storage */ }
  mem.delete('ipod.visOverCover');
}
migrateVisPrefs();
/** The visualizations for Now Playing's Visualizer… (its ⋯ and hold menus): `engines(open)` is the
 *  Visualizer toggle and Opacity (100 -> 75 -> 50 -> 25 -> 100; dim while it is off; over black it is
 *  not applied), then the registry's
 *  engines (Alchemy, Bars and Waves, Battery), the one holding the choice showing its name, each
 *  `open`ing its `presets(group)`, the choice checked; an engine of one preset (Alchemy's Random) is
 *  picked at its own row. A pick, the toggle or a step sets its pref; a pick turns it on. `preset`: the
 *  choice; `on`: it is on; `opacity`: its percent. */
export function useVisualizers() {
  const sh = useShell(), [cur, set] = useVisualizer(), [on, setOn] = useVisOn(), [opacity, setOpacity] = useVisOpacity();
  const chosen = sh.presets.find((p) => visId(p) === cur);
  const of = (g: string) => sh.presets.filter((p) => p.group === g);
  const pick = (id: string, label: string): MenuItem => ({ id, label, right: id === cur ? '✓' : undefined, onSelect: () => { set(id); setOn(true); } });
  return {
    preset: cur,
    on,
    opacity,
    presets: (g: string) => of(g).map((p) => pick(visId(p), p.name)),
    engines: (open: (g: string) => void): MenuItem[] => [
      { id: 'on', label: 'Visualizer', right: on ? 'On' : 'Off', onSelect: () => setOn(!on) },
      { id: 'opacity', label: 'Opacity', right: opacity + '%', disabled: !on,
        onSelect: () => setOpacity(VIS_OPACITY[(VIS_OPACITY.indexOf(opacity as 100) + 1) % VIS_OPACITY.length]!) },
      ...[...new Set(sh.presets.map((p) => p.group))].map((g) => {
        const ps = of(g);
        return ps.length === 1 ? pick(visId(ps[0]!), g)
          : { id: g, label: g, right: chosen?.group === g ? chosen.name : undefined, chevron: true, onSelect: () => open(g) };
      })],
  };
}

// ---- Theme -----------------------------------------------------------------------------------------
/** 'ipod.appearance': what Settings' Theme last asked the host for */
export const useAppearance = () => usePref<'light' | 'dark' | 'auto'>('ipod.appearance', 'auto');
