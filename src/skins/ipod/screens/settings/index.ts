// The Settings screens (screens/contract.ts Screens.settings), and what
// the chrome reads of their preferences:
// - useMenuVisibility(): Menus > Main Menu / Library Filters, {main, music} each Record<id, boolean>
//   ('ipod.menus'; main.previewpanel is the Preview Panel); MAIN_MENU / LIBRARY_FILTERS list the ids.
// - useLibraryFilter(): the Library's chosen chip, [id, set] ('ipod.libraryFilter'; Playlists first).
// - useClockPrefs(): Appearance > Time in Title, {timeInTitle} ('ipod.clock'); 12 / 24 hours are the device's.
// - useLibraryView(): Menus > Library View, ['grid' | 'list', set] ('ipod.view'; grid first): how
//   the lists with covers draw (GridScreen or MenuScreen).
// - useVisFit(): Appearance > Visualizer Fit, ['fit' | 'stretch', set] ('ipod.visFit'; fit first): the
//   settings.scale Now Playing applies while its visualizer shows ('auto' / 'original').
// - useVisualizer(): Now Playing's Visualizer…, [visId, set] ('ipod.visualizer'; Bars first): the
//   settings.vis / preset Now Playing applies while its visualizer shows; useVisualizers() lists them by engine.
// - useSettingsEffects() (also named useVolumeLimit): mount once in Root: Volume Limit and Shake.
export { settings } from './Settings';
export {
  LIBRARY_FILTERS, MAIN_MENU, useClockPrefs, useLibraryFilter, useLibraryView, useMenuVisibility, useSettingsEffects,
  useVisFit, useVisualizer, useVisualizers, useVolumeLimit, visId,
  type ClockPrefs, type LibraryView, type MenuVisibility, type VisFit,
} from './prefs';
