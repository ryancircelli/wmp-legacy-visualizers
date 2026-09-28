// The one state the skins read (ARCHITECTURE.md "Store"). Vanilla zustand, so this module has no
// React: a skin binds it with `useStore(store, selector)` from 'zustand'.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { noCommands, type Commands } from './commands';
import { loadSettings, saveSettings, presetMax, DEFAULTS, type Settings } from './settings';
import type {
  CaptureSource, Device, LyricLine, MediaStatus, Mode, PlayingContext, RepeatMode, TimedLevel, Track, View, VisKind,
} from './types';

export interface Playback {
  /** 'none' = no media session (the visualizer-only player) */
  status: MediaStatus;
  /** where the state came from: the Spotify web player, the host's GSMTC frames, or nothing */
  source: 'spotify' | 'host' | null;
  track: Track | null;
  /** ms at `at` (Date.now()); positionNow() extrapolates while playing */
  position: number;
  at: number;
  paused: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  canSeek: boolean;
  canNext: boolean;
  canPrev: boolean;
  context: PlayingContext | null;
  /** "Playlist: Road Trip" — the line under the art ('' when unknown) */
  from: string;
  /** the GSMTC app ('Spotify.exe') or 'Spotify' */
  app: string;
  /** the local capture source (share picker, host PCM socket, ...) and its clock, null = none */
  capture: (CaptureSource & { paused: boolean; acc: number; from: number }) | null;
  /** an optimistic transport change awaiting the player's word: which Playback fields (plus
   *  'device' for a transfer) and since when (Date.now()). Cleared by the next player state / host
   *  frame, by a refusal (the fields roll back), or after 2 s with the optimistic values kept. */
  pending: { fields: string[]; since: number } | null;
}

export interface AppState {
  auth: {
    /** Spotify login (null = unknown); always true for the local engine */
    loggedIn: boolean | null;
    engine: 'spotify' | 'local';
    mode: Mode;
    /** window.alchemySpotifyLogout is bound (File > Log Out) */
    canLogout: boolean;
    /** window.alchemyWin* are bound (the desktop host draws no frame of its own) */
    hostWindow: boolean;
    /** a newer exe is out (window.alchemyHostUpdate): Help offers the download */
    hostUpdate?: boolean;
  };
  playback: Playback;
  queue: { next: Track[] };
  /** optimistic Like / Remove from Liked Songs, by uri, over what fetchSaved answered (absent = ask it) */
  saved: Record<string, boolean>;
  /** optimistic playlist membership: playlist uri -> track uri -> in it (absent = ask fetchMembership) */
  membership: Record<string, Record<string, boolean>>;
  /** self = this web player's connect id ("(this window)") */
  devices: { list: Device[]; self: string };
  lyrics: {
    status: 'synced' | 'plain' | 'none';
    lines: LyricLine[] | null;
    plain: string | null;
    /** the track they belong to (they can race a track change) */
    track: { title: string; artist: string } | null;
    /** where they came from: Spotify's own (preferred in Spotify mode) or the host's LRCLIB */
    source?: 'spotify' | 'lrclib' | null;
  };
  ui: {
    view: View;
    fullscreen: boolean;
    bare: boolean;
    dialog: string | null;
    menu: string | null;
    /** the status bar line */
    status: string;
    /** Media Library: the selected node (a collection uri, or a tree heading) and selected row */
    libNode: string | null;
    libSel: string | null;
    /** the Search view's query (commands.search sets it; the results are a query, not state) */
    searchQ: string;
    /** the Search view's "Show all" type (one bucket paged alone), null = every section */
    searchOnly: 'tracks' | 'artists' | 'albums' | 'playlists' | null;
  };
  settings: Settings;
  vis: {
    kind: VisKind;
    preset: number;
    /** engine held (a non-visualizer view is showing) */
    hold: boolean;
    /** the audio producer: one TimedLevel per call, filled in place */
    level: (() => TimedLevel) | null;
  };
  commands: Commands;
  actions: Actions;
}

export interface Actions {
  setAuth(p: Partial<AppState['auth']>): void;
  setPlayback(p: Partial<Playback>): void;
  setQueue(next: Track[]): void;
  setDevices(list: Device[], self?: string): void;
  /** set (true/false) or clear (null) the optimistic saved state of one uri */
  setSaved(uri: string, on: boolean | null): void;
  /** set or clear (null) the optimistic membership of a track in a playlist */
  setMembership(playlistUri: string, trackUri: string, on: boolean | null): void;
  setLyrics(l: AppState['lyrics']): void;
  setUi(p: Partial<AppState['ui']>): void;
  /** switch view: holds the engine off 'now', and remembers it in the settings */
  setView(v: string | null | undefined): void;
  setStatus(msg: string): void;
  setSettings(p: Partial<Settings>): void;
  /** volume and/or mute, as the slider, mute button and F7..F9 set them; volume unmutes */
  setVolume(vol: number | null, muted?: boolean): void;
  setLyricsEnabled(on: boolean): void;
  setKaraoke(on: boolean): void;
  setVis(kind: VisKind, preset: number): void;
  setLevel(fn: (() => TimedLevel) | null): void;
  setCommands(c: Commands): void;
}

/** Spotify serves search pages up to this offset + limit. */
export const SEARCH_CAP = 1000;
export const VIEWS: readonly View[] = ['now', 'guide', 'library', 'search', 'radio'];
export const LIKED = 'spotify:collection:tracks';

export const initialPlayback = (): Playback => ({
  status: 'none', source: null, track: null, position: 0, at: 0, paused: true, shuffle: false, repeat: 'off',
  canSeek: false, canNext: false, canPrev: false, context: null, from: '', app: '', capture: null, pending: null,
});

export type AppStore = StoreApi<AppState> & {
  subscribe: StoreApi<AppState>['subscribe'] & (<U>(
    selector: (s: AppState) => U, listener: (u: U, prev: U) => void,
    opts?: { equalityFn?: (a: U, b: U) => boolean; fireImmediately?: boolean }) => () => void);
};

/** A fresh store. `persist` saves settings to localStorage on every change (off in tests). */
export function createAppStore(opts: { settings?: Settings; persist?: boolean } = {}): AppStore {
  const settings = opts.settings ?? (opts.persist === false ? { ...DEFAULTS } : loadSettings());
  const store = createStore<AppState>()(devtools(subscribeWithSelector((set, get) => {
    const merge = <K extends keyof AppState>(k: K, p: Partial<AppState[K]>, name: string) =>
      set((s) => ({ [k]: { ...s[k], ...p } }), false, name);
    const actions: Actions = {
      setAuth: (p) => merge('auth', p, 'auth'),
      setPlayback: (p) => merge('playback', p, 'playback'),
      setQueue: (next) => set({ queue: { next } }, false, 'queue'),
      setSaved: (uri, on) => set((s) => {
        const saved = { ...s.saved };
        if (on == null) delete saved[uri]; else saved[uri] = on;
        return { saved };
      }, false, 'saved'),
      setMembership: (pl, tr, on) => set((s) => {
        const row = { ...(s.membership[pl] ?? {}) };
        if (on == null) delete row[tr]; else row[tr] = on;
        return { membership: { ...s.membership, [pl]: row } };
      }, false, 'membership'),
      setDevices: (list, self) => set((s) => ({ devices: { list, self: self ?? s.devices.self } }), false, 'devices'),
      setLyrics: (l) => set({ lyrics: l }, false, 'lyrics'),
      setUi: (p) => merge('ui', p, 'ui'),
      setView: (v) => {
        const view: View = (VIEWS as readonly string[]).includes(v as string) ? (v as View) : 'now';
        set((s) => ({ ui: { ...s.ui, view }, vis: { ...s.vis, hold: view !== 'now' },
                      settings: s.settings.view === view ? s.settings : { ...s.settings, view } }), false, 'view');
      },
      setStatus: (status) => merge('ui', { status }, 'status'),
      setSettings: (p) => merge('settings', p, 'settings'),
      setVolume: (vol, muted) => {
        const s = get().settings, max = get().auth.engine === 'spotify' ? 100 : 200;
        const p: Partial<Settings> = {};
        if (vol != null) { p.volume = Math.max(0, Math.min(max, +vol || 0)); p.muted = false; }
        if (muted != null) p.muted = !!muted;
        if (p.volume !== s.volume || p.muted !== s.muted) merge('settings', p, 'volume');
      },
      setLyricsEnabled: (on) => merge('settings', { lyrics: !!on }, 'lyrics on'),
      setKaraoke: (on) => merge('settings', { karaoke: !!on }, 'karaoke'),
      setVis: (kind, preset) => {
        const p = Math.max(0, Math.min(presetMax(kind), preset | 0));
        set((s) => ({ vis: { ...s.vis, kind, preset: p }, settings: { ...s.settings, vis: kind, preset: p } }), false, 'vis');
      },
      setLevel: (level) => merge('vis', { level }, 'level'),
      setCommands: (commands) => set({ commands }, false, 'commands'),
    };
    return {
      auth: { loggedIn: null, engine: 'local', mode: 'web', canLogout: false, hostWindow: false },
      playback: initialPlayback(),
      queue: { next: [] },
      saved: {},
      membership: {},
      devices: { list: [], self: '' },
      lyrics: { status: 'none', lines: null, plain: null, track: null, source: null },
      ui: { view: 'now', fullscreen: false, bare: false, dialog: null, menu: null, status: '', libNode: null, libSel: null, searchQ: '', searchOnly: null },
      settings,
      vis: { kind: settings.vis, preset: settings.preset, hold: false, level: null },
      commands: noCommands,
      actions,
    };
  }), { name: 'alchemy', enabled: typeof window !== 'undefined' && '__REDUX_DEVTOOLS_EXTENSION__' in window }));
  const app = store as AppStore;
  if (opts.persist !== false) app.subscribe((s) => s.settings, saveSettings);
  return app;
}

