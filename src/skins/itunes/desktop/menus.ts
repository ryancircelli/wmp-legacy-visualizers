// iTunes 10 for Windows' menu bar as data: File Edit View Controls Store Advanced Help, each built as
// it opens (as src/skins/menus.ts builds WMP 9's), onto the app's own actions. iTunes' entries with
// no Spotify meaning (New Playlist, Import, Burn, Sync, Authorize…) are left out rather than greyed.
import { FPS_OPTS } from '../../../model';
import { appDownload, isPlaying, LINKS, openLink, playingTrack, prevNext, toggleSaved, VOL_STEP, type AddToApi, type MenuEntry, type Shell } from '../../../ui';
import { visMenu } from '../../menus';
// a cycle (registry -> itunes -> here), safe: `skins` is read only when a menu opens
import { skinFor, skins } from '../../registry';
import { showPlaying } from '../shared/content';
import { itunesView, VIEW_MODES, VIEW_NAMES, viewActions } from '../shared/state';
import { focusSearch, toggleVisualizer } from '../shortcuts';

export type ItunesMenu = 'file' | 'edit' | 'view' | 'controls' | 'store' | 'advanced' | 'help';
export const MENUS: readonly [ItunesMenu, string][] = [
  ['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['controls', 'Controls'], ['store', 'Store'], ['advanced', 'Advanced'], ['help', 'Help'],
];
const SEP = { sep: true } as const;

export interface MenuContext {
  /** the playing song's Add to (Like, Add to Playlist) */
  addTo?: AddToApi;
  /** the selected source takes the four views (a list of songs) */
  views: boolean;
  /** the sidebar is collapsed by the window's width (View > Show Sidebar opens it over the content) */
  narrow: boolean;
  /** the AirPlay menu's entries (Controls > Play On) */
  devices: () => MenuEntry[];
  /** song radio from the playing song (Advanced > Start Genius), null when nothing plays */
  genius: (() => void) | null;
}

export function menuItems(name: ItunesMenu, sh: Shell, m: MenuContext): MenuEntry[] {
  const s = sh.store.getState(), { actions: a, commands: c, settings: S } = s, v = itunesView.getState();
  const spotify = s.auth.engine === 'spotify', dialog = (d: string) => () => a.setUi({ dialog: d });
  switch (name) {
    case 'file':
      return [
        ...(spotify ? [{ label: 'Open Spotify Link...', accel: 'Ctrl+U', act: dialog('link') }, SEP] : []),
        { label: 'Close Window', accel: 'Ctrl+W', act: () => (s.auth.hostWindow ? c.win('close') : window.close()) },
        { label: 'Exit', act: () => (s.auth.hostWindow ? c.win('close') : window.close()) },
      ];
    case 'edit':
      return [{ label: 'Preferences...', accel: 'Ctrl+,', act: dialog('options') }];
    case 'view': {
      const mode = v.views[v.source] ?? 'list', vis = s.ui.view === 'now', full = s.ui.fullscreen || s.ui.bare;
      return [
        ...(m.narrow ? [{ label: 'Show Sidebar', check: v.sidebarOpen, act: () => viewActions.setSidebarOpen(!v.sidebarOpen) }, SEP] : []),
        ...(spotify ? [...VIEW_MODES.map((x, i) => ({ label: 'as ' + VIEW_NAMES[x], accel: 'Ctrl+Alt+' + (i + 3), radio: true, check: m.views && mode === x,
                                                      disabled: !m.views, act: () => viewActions.setMode(x) })), SEP,
          { label: 'Show Artwork', accel: 'Ctrl+G', check: v.artwork, act: viewActions.toggleArtwork }, SEP] : []),
        { label: 'Show Visualizer', accel: 'Ctrl+T', check: vis, act: () => toggleVisualizer(sh) },
        { label: 'Visualizer', sub: visMenu(sh, s) },
        { label: 'Refresh Rate', sub: FPS_OPTS.map((f) => ({ label: f + ' fps', radio: true, check: S.fps === f, act: () => a.setSettings({ fps: f }) })) },
        { label: 'Lyrics', check: S.lyrics, act: () => a.setLyricsEnabled(!S.lyrics) },
        { label: 'Karaoke Highlight', accel: 'Ctrl+K', check: S.karaoke !== false, disabled: !S.lyrics, act: () => a.setKaraoke(S.karaoke === false) },
        SEP,
        { label: 'Full Screen', accel: 'Ctrl+Shift+F', check: full, act: () => sh.toggleFullscreen() },
        { label: 'Skin', sub: Object.values(skins).map((k) => ({ label: k.name, radio: true, check: skinFor(S.skin).id === k.id,
                                                             act: () => a.setSettings({ skin: k.id }) })) },
      ];
    }
    case 'controls': {
      const base: MenuEntry[] = [
        { label: isPlaying(s) ? 'Pause' : 'Play', accel: 'Space', act: () => { void c.playPause(); } },
        { label: 'Next', accel: 'Ctrl+Right', act: () => prevNext(sh, 1) },
        { label: 'Previous', accel: 'Ctrl+Left', act: () => prevNext(sh, -1) },
      ];
      if (!spotify) return base;
      return [...base,
        { label: 'Go to Current Song', accel: 'Ctrl+L', disabled: !s.playback.track, act: () => showPlaying(sh) },
        SEP,
        { label: 'Shuffle', check: s.playback.shuffle, act: () => c.toggleShuffle() },
        { label: 'Repeat', sub: ([['off', 'Off'], ['context', 'All'], ['track', 'One']] as const).map(([r, label]) => ({
          label, radio: true, check: s.playback.repeat === r, act: () => c.setRepeat(r) })) },
        SEP,
        { label: 'Increase Volume', accel: 'Ctrl+Up', act: () => a.setVolume(S.volume + VOL_STEP) },
        { label: 'Decrease Volume', accel: 'Ctrl+Down', act: () => a.setVolume(S.volume - VOL_STEP) },
        { label: 'Mute', accel: 'Ctrl+Alt+Down', check: S.muted, act: () => a.setVolume(null, !S.muted) },
        SEP,
        { label: 'Play On', sub: m.devices() },
        { label: m.addTo?.saved ? 'Unlike' : 'Like', disabled: !playingTrack(s),
          act: () => { const u = playingTrack(sh.store.getState()); if (u) void toggleSaved(sh, u); } },
        ...(m.addTo ? [m.addTo.playlistMenu('Add to Playlist')] : []),
      ];
    }
    case 'store':
      return [
        { label: 'Spotify Home', disabled: !spotify, act: () => viewActions.select('store') },
        { label: 'Search Spotify', accel: 'Ctrl+F', disabled: !spotify, act: () => focusSearch(sh) },
        ...(s.auth.canLogout ? [SEP, { label: 'Log Out of Spotify', act: () => c.logout() }] : []),
      ];
    case 'advanced':
      return [
        { label: 'Open Stream...', accel: 'Ctrl+U', disabled: !spotify, act: dialog('link') },
        { label: 'Start Genius', disabled: !m.genius, act: () => m.genius?.() },
      ];
    case 'help':
      return [
        ...(s.auth.hostUpdate ? [{ label: 'Download the New Version...', act: () => openLink(appDownload(spotify)) }, SEP] : []),
        { label: 'Keyboard Shortcuts', act: dialog('keys') },
        ...(!spotify && s.auth.mode === 'web' ? [
          { label: 'Download WMP Spotify for Windows', act: () => openLink(LINKS.spotify) },
          { label: 'Source Code on GitHub', act: () => openLink(LINKS.repo) }] : []),
        { label: 'Check for Updates', act: dialog('checkUpdates') },
        SEP,
        { label: 'About WMP Spotify', act: dialog('about') },
      ];
  }
}
