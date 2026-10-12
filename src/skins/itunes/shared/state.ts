// The skin's own view state, apart from the app's settings: which source is selected, how each one
// is viewed (iTunes remembered List / Album List / Grid / Cover Flow per source), the artwork pane,
// the Grid's Albums / Artists tab. Persisted in localStorage under 'itunes.view' (a blocked storage
// keeps it for the session). What was opened inside a source (an album from the Grid, an artist from
// a search) is the session's only: iTunes too came back to the source itself.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export type ViewMode = 'list' | 'album' | 'grid' | 'flow';
export const VIEW_MODES: readonly ViewMode[] = ['list', 'album', 'grid', 'flow'];
export const VIEW_NAMES: Record<ViewMode, string> = { list: 'List', album: 'Album List', grid: 'Grid', flow: 'Cover Flow' };

export interface ItunesView {
  /** the selected source's id (useSources: 'music', 'store', a playlist uri, …) */
  source: string;
  /** the view each source was last shown in (absent: List) */
  views: Record<string, ViewMode>;
  /** the artwork pane under the sidebar (the bottom bar's ▣, View > Show Artwork) */
  artwork: boolean;
  /** Music's Grid: the saved albums or the followed artists */
  gridTab: 'albums' | 'artists';
  /** the LCD's right-hand time: the song's length instead of the time left (a click flips it) */
  total: boolean;
  /** session: what was opened inside the source, the last on top (a uri: an album, playlist, artist, show) */
  stack: string[];
  /** session: the sidebar shown over the content on a narrow window */
  sidebarOpen: boolean;
  /** session: bumped by "show the current song" (Ctrl+L, the LCD's ➜): the list selects the playing row */
  reveal: number;
}

export const DEFAULT_VIEW: ItunesView = { source: 'music', views: {}, artwork: true, gridTab: 'albums', total: false, stack: [], sidebarOpen: false, reveal: 0 };

// memory when localStorage throws (blocked): the choices last the session
const mem = new Map<string, string>();
const storage = createJSONStorage(() => ({
  getItem: (k: string) => { try { return localStorage.getItem(k) ?? mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
  removeItem: (k: string) => { try { localStorage.removeItem(k); } catch { /* blocked */ } mem.delete(k); },
}));

const isMode = (v: unknown): v is ViewMode => (VIEW_MODES as readonly unknown[]).includes(v);

export const itunesView = create<ItunesView>()(persist(() => DEFAULT_VIEW, {
  name: 'itunes.view',
  version: 1,
  storage,
  partialize: (s) => ({ source: s.source, views: s.views, artwork: s.artwork, gridTab: s.gridTab, total: s.total }),
  // a hand-edited or older blob reads as valid state
  merge: (saved, cur) => {
    const p = (saved ?? {}) as Partial<ItunesView>;
    return {
      ...cur,
      source: typeof p.source === 'string' && p.source ? p.source : cur.source,
      views: Object.fromEntries(Object.entries(p.views ?? {}).filter(([, v]) => isMode(v))),
      artwork: typeof p.artwork === 'boolean' ? p.artwork : cur.artwork,
      gridTab: p.gridTab === 'artists' ? 'artists' : 'albums',
      total: p.total === true,
    };
  },
}));

/** A slice of the view state (re-renders when it changes; objects and arrays compare shallowly, as useApp's). */
export const useItunesView = <T,>(sel: (s: ItunesView) => T): T => itunesView(useShallow(sel));

/** The view state's changes, for both layouts. */
export const viewActions = {
  /** select a source: back to the source itself (nothing opened in it) */
  select: (source: string) => itunesView.setState({ source, stack: [], sidebarOpen: false }),
  /** select a source with a collection opened in it, and the playing row shown */
  reveal: (source: string, opened: string | null) =>
    itunesView.setState((s) => ({ source, stack: opened ? [opened] : [], sidebarOpen: false, reveal: s.reveal + 1 })),
  /** the selected source's view (List / Album List / Grid / Cover Flow) */
  setMode: (mode: ViewMode, source = itunesView.getState().source) =>
    itunesView.setState((s) => ({ views: { ...s.views, [source]: mode } })),
  /** open a collection inside the source (a Grid tile, a search result) */
  open: (uri: string) => itunesView.setState((s) => (s.stack[s.stack.length - 1] === uri ? s : { stack: [...s.stack, uri] })),
  back: () => itunesView.setState((s) => ({ stack: s.stack.slice(0, -1) })),
  toggleArtwork: () => itunesView.setState((s) => ({ artwork: !s.artwork })),
  setGridTab: (gridTab: ItunesView['gridTab']) => itunesView.setState({ gridTab, stack: [] }),
  setSidebarOpen: (sidebarOpen: boolean) => itunesView.setState({ sidebarOpen }),
  toggleTotal: () => itunesView.setState((s) => ({ total: !s.total })),
};

/** The view a source shows in: its own choice, else `fallback`. */
export const modeOf = (s: Pick<ItunesView, 'views'>, source: string, fallback: ViewMode = 'list'): ViewMode => s.views[source] ?? fallback;
