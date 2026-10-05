// iTunes 10's Windows accelerators (Apple's "Keyboard shortcuts in iTunes on PC" and the 2010 menus;
// docs/itunes-skin.md §Keys). Dispatched by the app under the Spotify engine before its own keys, so
// Ctrl+L here is Go to Current Song (the app's lyrics toggle is View > Lyrics in this skin). Rows with no
// `match` are the app's own keys (Space, Ctrl+K) or the lists', listed for Help > Keyboard Shortcuts.
import { prevNext, VOL_STEP, type Shell, type Shortcut } from '../../ui';
import { newPlaylist } from './desktop/spotify';
import { showPlaying } from './shared/content';
import { viewActions, VIEW_MODES } from './shared/state';

const typing = (e: KeyboardEvent) => /^(INPUT|SELECT|TEXTAREA)$/.test(((e.composedPath?.()[0] ?? e.target) as Element | null)?.tagName ?? '');
/** Ctrl (+Alt) (+Shift) with this key, nothing else; arrows not while typing (they move the caret) */
const key = (e: KeyboardEvent, k: string, o: { alt?: boolean; shift?: boolean } = {}) =>
  e.ctrlKey && !e.metaKey && e.altKey === !!o.alt && e.shiftKey === !!o.shift && e.key.toLowerCase() === k.toLowerCase()
  && !(k.startsWith('Arrow') && typing(e));
const st = (sh: Shell) => sh.store.getState();
const vol = (sh: Shell, d: number) => st(sh).actions.setVolume(st(sh).settings.volume + d);

/** The search field (the skin marks it data-search-box), focused with its text selected. */
export function focusSearch(sh: Shell): void {
  const root: Document | ShadowRoot = typeof ShadowRoot !== 'undefined' && sh.portal instanceof ShadowRoot ? sh.portal : document;
  const b = root.querySelector<HTMLInputElement>('[data-search-box]');
  b?.focus();
  b?.select();
}
/** View > Show Visualizer: the visualizer is the app's Now Playing view in this skin. */
export const toggleVisualizer = (sh: Shell) => st(sh).actions.setView(st(sh).ui.view === 'now' ? 'library' : 'now');

export const ITUNES_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Space', label: 'Play / Pause' },
  { keys: 'Enter', label: 'Play the selected song' },
  { keys: 'Ctrl+Right Arrow', label: 'Next song', match: (e) => key(e, 'ArrowRight'), run: (sh) => prevNext(sh, 1) },
  { keys: 'Ctrl+Left Arrow', label: 'Previous song', match: (e) => key(e, 'ArrowLeft'), run: (sh) => prevNext(sh, -1) },
  { keys: 'Ctrl+Alt+Right Arrow', label: 'Fast forward 10 seconds', match: (e) => key(e, 'ArrowRight', { alt: true }), run: (sh) => st(sh).commands.skip(10) },
  { keys: 'Ctrl+Alt+Left Arrow', label: 'Rewind 10 seconds', match: (e) => key(e, 'ArrowLeft', { alt: true }), run: (sh) => st(sh).commands.skip(-10) },
  { keys: 'Ctrl+Up Arrow', label: 'Increase the volume', match: (e) => key(e, 'ArrowUp'), run: (sh) => vol(sh, VOL_STEP) },
  { keys: 'Ctrl+Down Arrow', label: 'Decrease the volume', match: (e) => key(e, 'ArrowDown'), run: (sh) => vol(sh, -VOL_STEP) },
  { keys: 'Ctrl+Alt+Down Arrow', label: 'Mute / unmute', match: (e) => key(e, 'ArrowDown', { alt: true }),
    run: (sh) => st(sh).actions.setVolume(null, !st(sh).settings.muted) },
  { keys: 'Ctrl+L', label: 'Go to the current song', match: (e) => key(e, 'l'), run: showPlaying },
  { keys: 'Ctrl+T', label: 'Visualizer on / off', match: (e) => key(e, 't'), run: toggleVisualizer },
  { keys: 'Ctrl+F', label: 'Search Spotify', match: (e) => key(e, 'f'), run: focusSearch },
  { keys: 'Ctrl+Shift+F', label: 'Full screen', match: (e) => key(e, 'f', { shift: true }), run: (sh) => sh.toggleFullscreen() },
  { keys: 'Ctrl+Alt+3 … 6', label: 'View as List, Album List, Grid, Cover Flow',
    match: (e) => e.ctrlKey && e.altKey && !e.shiftKey && '3456'.includes(e.key) && e.key.length === 1,
    run: (_, e) => viewActions.setMode(VIEW_MODES['3456'.indexOf(e.key)]!) },
  { keys: 'Ctrl+G', label: 'Show / hide the artwork', match: (e) => key(e, 'g'), run: () => viewActions.toggleArtwork() },
  { keys: 'Ctrl+N', label: 'New playlist', match: (e) => key(e, 'n'), run: newPlaylist },
  { keys: 'Ctrl+U', label: 'Open a Spotify link (Open Stream)', match: (e) => key(e, 'u'), run: (sh) => st(sh).actions.setUi({ dialog: 'link' }) },
  { keys: 'Ctrl+,', label: 'Preferences', match: (e) => key(e, ','), run: (sh) => st(sh).actions.setUi({ dialog: 'options' }) },
  { keys: 'Ctrl+K', label: 'Karaoke word highlight on / off' },
  { keys: 'Esc', label: 'Leave full screen' },
];
