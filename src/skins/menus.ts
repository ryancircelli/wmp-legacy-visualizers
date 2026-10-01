// WMP 9's menus as data: File / View / Play / Tools / Help, built from the store at the moment one
// opens (as the old shell did), for whichever engine is running. Skins render them with src/ui's
// MenuBar / Dropdown.
import { FPS_OPTS, type AppState, type RepeatMode } from '../model';
import {
  appDownload, detailsPaneOn, isPlaying, libraryView, LINKS, openLink, playingTrack, prevNext, toggleSaved, uiSettings, VIEW_LABELS, VOL_STEP, type AddToApi, type MenuEntry,
  type MenuItem, type Shell,
} from '../ui';
// a cycle (registry -> wmp9 -> here), safe: `skins` is read only when a menu opens
import { skinFor, skins } from './registry';
export type { MenuEntry, MenuItem } from '../ui';
export type MenuName = 'file' | 'view' | 'play' | 'tools' | 'help';
export const MENUS: readonly [MenuName, string][] = [
  ['file', 'File'], ['view', 'View'], ['play', 'Play'], ['tools', 'Tools'], ['help', 'Help'],
];

const SEP = { sep: true } as const;
const REPEAT_NAME: Record<RepeatMode, string> = { off: 'Off', context: 'Playlist', track: 'Track' };

/** View > Visualizations (and the picker ▾ beside the visualization name). */
export function visMenu(sh: Shell, s: AppState = sh.store.getState()): MenuItem[] {
  const out: MenuItem[] = [];
  for (const p of sh.presets) {
    let g = out.find((x) => x.label === p.group);
    if (!g) out.push((g = { label: p.group, sub: [] }));
    g.sub!.push({ label: p.name, radio: true, check: s.vis.kind === p.vis && s.vis.preset === p.preset,
                  act: () => sh.store.getState().actions.setVis(p.vis, p.preset) });
  }
  return out;
}

/** WMP 9's "Select Now Playing options" menu (the icon at the left end of the strip under the
 *  screen): the visualizations, the lyrics, the panes and full screen. `lyrics`: whether lyrics exist
 *  here (the desktop host fetches them; the website never has any). */
export function nowPlayingMenu(sh: Shell, lyrics: boolean, s: AppState = sh.store.getState()): MenuEntry[] {
  const { actions: a, settings: S } = s, full = s.ui.fullscreen || s.ui.bare;
  return [
    { label: 'Visualizations', sub: visMenu(sh, s) },
    SEP,
    ...(lyrics ? [{ label: 'Lyrics', accel: 'Ctrl+L', check: S.lyrics, act: () => a.setLyricsEnabled(!S.lyrics) },
                  { label: 'Karaoke Highlight', accel: 'Ctrl+K', check: S.karaoke !== false, disabled: !S.lyrics,
                    act: () => a.setKaraoke(S.karaoke === false) }, SEP] : []),
    { label: 'Task Pane', check: S.taskPane !== false, act: () => a.setSettings({ taskPane: S.taskPane === false }) },
    { label: 'Playlist Pane', check: S.playlistPane !== false, act: () => a.setSettings({ playlistPane: S.playlistPane === false }) },
    SEP,
    { label: 'Full Screen', accel: 'F', check: full, act: () => sh.toggleFullscreen() },
  ];
}

/** `addTo`: the playing track's Add to (the Play menu's Liked Songs and Add to Playlist entries). */
export function menuItems(name: MenuName, sh: Shell, addTo?: AddToApi): MenuEntry[] {
  const s = sh.store.getState(), { actions: a, commands: c, settings: S } = s;
  const spotify = s.auth.engine === 'spotify';
  const dialog = (d: string) => () => a.setUi({ dialog: d });
  switch (name) {
    case 'file': {
      const exit: MenuItem = { label: 'Exit', accel: 'Alt+F4', act: () => window.close() };
      if (!spotify) return [exit];
      return [{ label: 'Open Spotify Link...', act: dialog('link') },
        ...(s.auth.canLogout ? [{ label: 'Log Out of Spotify', act: () => c.logout() }] : []), SEP, exit];
    }
    case 'view': {
      const full = s.ui.fullscreen || s.ui.bare;
      return [
        ...(spotify ? [...VIEW_LABELS.map(([v, label], i) => ({ label, accel: 'Ctrl+' + (i + 1), radio: true, check: s.ui.view === v,
                                                                act: () => a.setView(v) })), SEP] : []),
        { label: 'Visualizations', sub: visMenu(sh, s) },
        { label: 'Refresh Rate', sub: FPS_OPTS.map((f) => ({ label: f + ' fps', radio: true, check: S.fps === f,
                                                             act: () => a.setSettings({ fps: f }) })) },
        { label: 'Karaoke Highlight', accel: 'Ctrl+K', check: S.karaoke !== false, act: () => a.setKaraoke(S.karaoke === false) },
        ...(spotify ? [SEP,
          { label: 'Task Pane', check: S.taskPane !== false, act: () => a.setSettings({ taskPane: S.taskPane === false }) },
          { label: 'Playlist Pane', check: S.playlistPane !== false,
            act: () => a.setSettings({ playlistPane: S.playlistPane === false }) },
          { label: 'Details Pane', check: detailsPaneOn(s), act: () => a.setSettings(uiSettings({ detailsPane: !detailsPaneOn(s) })) },
          { label: 'Library View', sub: (['details', 'tiles'] as const).map((v) => ({
            label: v === 'details' ? 'Details' : 'Tiles', radio: true, accel: v === 'tiles' ? 'Ctrl+Shift+T' : undefined, check: libraryView(s) === v,
            act: () => a.setSettings(uiSettings({ libraryView: v })) })) }] : []),
        SEP,
        { label: 'Skin', sub: Object.values(skins).map((k) => ({ label: k.name, radio: true, check: skinFor(S.skin).id === k.id,
                                                             act: () => a.setSettings({ skin: k.id }) })) },
        { label: 'Full Screen', accel: 'Alt+Enter', check: full, act: () => sh.toggleFullscreen() },
      ];
    }
    case 'play': {
      const base: MenuItem[] = [
        { label: isPlaying(s) ? 'Pause' : 'Play', accel: spotify ? 'Ctrl+P' : 'Space', act: () => { void c.playPause(); } },
        { label: 'Stop', accel: spotify ? 'Ctrl+S' : undefined, act: () => c.stop() },
      ];
      const skip: MenuItem[] = [
        { label: 'Previous', accel: spotify ? 'Ctrl+B' : undefined, act: () => prevNext(sh, -1) },
        { label: 'Next', accel: spotify ? 'Ctrl+F' : undefined, act: () => prevNext(sh, 1) },
      ];
      if (!spotify) return [...base, SEP, ...skip];
      const vol = S.volume;
      return [...base, SEP, ...skip, SEP,
        { label: 'Shuffle', accel: 'Ctrl+H', check: s.playback.shuffle, act: () => c.toggleShuffle() },
        { label: 'Repeat', sub: (['off', 'context', 'track'] as const).map((m) => ({
          label: REPEAT_NAME[m], radio: true, check: s.playback.repeat === m, act: () => c.setRepeat(m) })) },
        SEP,
        { label: addTo?.saved ? 'Unlike' : 'Like', accel: 'Ctrl+D', disabled: !playingTrack(s),
          act: () => { const u = playingTrack(sh.store.getState()); if (u) void toggleSaved(sh, u); } },
        ...(addTo ? [addTo.playlistMenu('Add to Playlist')] : []),
        SEP,
        { label: 'Rewind', accel: 'Ctrl+Shift+B', act: () => c.skip(-10) },
        { label: 'Fast Forward', accel: 'Ctrl+Shift+F', act: () => c.skip(10) },
        SEP,
        { label: 'Volume Up', accel: 'F9', act: () => a.setVolume(vol + VOL_STEP) },
        { label: 'Volume Down', accel: 'F8', act: () => a.setVolume(vol - VOL_STEP) },
        { label: 'Mute', accel: 'F7', check: S.muted, act: () => a.setVolume(null, !S.muted) },
      ];
    }
    case 'tools':
      return [{ label: 'Options...', act: dialog('options') }];
    case 'help':
      return [...(s.auth.hostUpdate ? [{ label: 'Download the New Version...', act: () => openLink(appDownload(spotify)) }, SEP] : []),
        ...(spotify ? [{ label: 'Keyboard Shortcuts', act: dialog('keys') }] : []),
        // the website's way to the Windows apps and the source (WMP 9's own Help went online too)
        ...(!spotify && s.auth.mode === 'web' ? [
          { label: 'Download WMP Spotify for Windows', act: () => openLink(LINKS.spotify) },
          { label: 'Download the Alchemy Screensaver', act: () => openLink(LINKS.screensaver) },
          { label: 'Source Code on GitHub', act: () => openLink(LINKS.repo) }, SEP] : []),
        { label: 'Check for Player Updates...', act: dialog('checkUpdates') },
        SEP,
        { label: 'About Windows Media Player', act: dialog('about') }];
  }
}
