// The keyboard as data: WMP 9's accelerator table (what Help > Keyboard Shortcuts lists and what
// the page dispatches under the Spotify engine). A skin may bring its own table (Skin.shortcuts).
// Rows without `match` are the page's own keys (App's onKey), listed here for the help dialog.
import { playingTrack, toggleSaved } from './AddTo';
import { libraryView, uiSettings } from './selectors';
import { useShell, prevNext, VIEW_LABELS, VOL_STEP } from './shell';
import type { Shell } from './types';

export interface Shortcut {
  /** as Help > Keyboard Shortcuts shows it */
  keys: string;
  label: string;
  match?: (e: KeyboardEvent) => boolean;
  run?: (sh: Shell, e: KeyboardEvent) => void;
}

const ctl = (e: KeyboardEvent, key: string, shift = false) =>
  e.ctrlKey && !e.altKey && e.shiftKey === shift && String(e.key || '').toLowerCase() === key;
const cmd = (sh: Shell) => sh.store.getState().commands;
const act = (sh: Shell) => sh.store.getState().actions;
const vol = (sh: Shell, d: number) => act(sh).setVolume(sh.store.getState().settings.volume + d);

export const WMP9_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Ctrl+1 … Ctrl+5', label: 'Now Playing, Media Guide, Media Library, Search, Radio Tuner',
    match: (e) => e.ctrlKey && !e.altKey && !e.shiftKey && e.key.length === 1 && '12345'.includes(e.key),
    run: (sh, e) => act(sh).setView(VIEW_LABELS['12345'.indexOf(e.key)]![0]) },
  { keys: 'Ctrl+P', label: 'Play / Pause', match: (e) => ctl(e, 'p'), run: (sh) => { void cmd(sh).playPause(); } },
  { keys: 'Ctrl+S', label: 'Stop', match: (e) => ctl(e, 's'), run: (sh) => cmd(sh).stop() },
  { keys: 'Ctrl+B', label: 'Previous track', match: (e) => ctl(e, 'b'), run: (sh) => prevNext(sh, -1) },
  { keys: 'Ctrl+F', label: 'Next track', match: (e) => ctl(e, 'f'), run: (sh) => prevNext(sh, 1) },
  { keys: 'Ctrl+Shift+B', label: 'Rewind 10 seconds', match: (e) => ctl(e, 'b', true), run: (sh) => cmd(sh).skip(-10) },
  { keys: 'Ctrl+Shift+F', label: 'Fast forward 10 seconds', match: (e) => ctl(e, 'f', true), run: (sh) => cmd(sh).skip(10) },
  { keys: 'Ctrl+H', label: 'Shuffle', match: (e) => ctl(e, 'h'), run: (sh) => cmd(sh).toggleShuffle() },
  { keys: 'Ctrl+T', label: 'Repeat (Off, Playlist, Track)', match: (e) => ctl(e, 't'), run: (sh) => cmd(sh).cycleRepeat() },
  { keys: 'Ctrl+Shift+T', label: 'Media Library: Details / Tiles', match: (e) => ctl(e, 't', true),
    run: (sh) => act(sh).setSettings(uiSettings({ libraryView: libraryView(sh.store.getState()) === 'tiles' ? 'details' : 'tiles' })) },
  { keys: 'Ctrl+E', label: 'Search Spotify', match: (e) => ctl(e, 'e'), run: focusSearch },
  { keys: 'Ctrl+D', label: 'Like / Unlike the playing track', match: (e) => ctl(e, 'd'),
    run: (sh) => { const u = playingTrack(sh.store.getState()); if (u) void toggleSaved(sh, u); } },
  { keys: 'Ctrl+L', label: 'Lyrics on / off' },
  { keys: 'Ctrl+K', label: 'Karaoke word highlight on / off' },
  { keys: 'F7', label: 'Mute', match: (e) => e.key === 'F7',
    run: (sh) => act(sh).setVolume(null, !sh.store.getState().settings.muted) },
  { keys: 'F8', label: 'Volume down', match: (e) => e.key === 'F8', run: (sh) => vol(sh, -VOL_STEP) },
  { keys: 'F9', label: 'Volume up', match: (e) => e.key === 'F9', run: (sh) => vol(sh, VOL_STEP) },
  { keys: 'Space', label: 'Play / Pause' },
  { keys: 'F, Alt+Enter', label: 'Full screen' },
  { keys: 'Esc', label: 'Leave full screen' },
];

/** Ctrl+E: the Search view, focus in its box (the skin marks it data-search-box). */
function focusSearch(sh: Shell) {
  act(sh).setView('search');
  const root: Document | ShadowRoot = typeof ShadowRoot !== 'undefined' && sh.portal instanceof ShadowRoot ? sh.portal : document;
  // the view renders on the next frame when it was not showing; once focused, keys typed since stay
  const focus = () => {
    const b = root.querySelector<HTMLInputElement>('[data-search-box]');
    if (b && root.activeElement !== b) { b.focus(); b.select(); }
  };
  focus();
  setTimeout(focus, 0);
}

/** Run the first accelerator `e` matches: true when one did (and the key's default is prevented). */
export function runShortcut(sh: Shell, e: KeyboardEvent, table: readonly Shortcut[] = sh.shortcuts): boolean {
  const s = table.find((x) => x.match?.(e));
  if (!s?.run) return false;
  e.preventDefault();
  s.run(sh, e);
  return true;
}

/** The active table (the skin's, else WMP 9's), for a help dialog. */
export const useShortcuts = (): readonly Shortcut[] => useShell().shortcuts;
