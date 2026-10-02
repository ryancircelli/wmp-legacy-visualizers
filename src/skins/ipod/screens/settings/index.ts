// The Settings and Extras screens (screens/contract.ts Screens.settings / extras / alarms), and what
// the chrome reads of their preferences:
// - useMenuVisibility(): Menus > Main Menu / Library Filters, {main, music} each Record<id, boolean>
//   ('ipod.menus'; main.previewpanel is the Preview Panel); MAIN_MENU / LIBRARY_FILTERS list the ids.
// - useLibraryFilter(): the Library's chosen chip, [id, set] ('ipod.libraryFilter'; Playlists first).
// - useClockPrefs(): Date & Time, {twentyFourHour, timeInTitle} ('ipod.clock').
// - useDisplayPrefs(): Appearance > Backlight (s, 0 = Always On), Brightness (off the iPhone, for the
//   LCD) and Energy Saver ('ipod.display'); the chrome does the dimming.
// - useLibraryView(): Menus > Library View, ['grid' | 'list', set] ('ipod.view'; grid first): how
//   the lists with covers draw (GridScreen or MenuScreen).
// - useSleepTimer(): Alarms > Sleep Timer, [{at, mins}] ('ipod.sleep'; at null = off), for the moon.
// - useVisFit(): Playback > Visualizer Fit, ['fit' | 'stretch', set] ('ipod.visFit'; fit first): the
//   settings.scale Now Playing applies while its visualizer shows ('auto' / 'original').
// - useVisualizer(): Now Playing's Visualizer…, [visId, set] ('ipod.visualizer'; Bars first): the
//   settings.vis / preset Now Playing applies while its visualizer shows; useVisualizers() lists them by engine.
// - useSettingsEffects() (also named useVolumeLimit): mount once in Root: Volume Limit, Shake, the
//   sleep timer and the alarm.
export { settings } from './Settings';
export { alarms, extras } from './Extras';
export {
  LIBRARY_FILTERS, MAIN_MENU, useClockPrefs, useDisplayPrefs, useLibraryFilter, useLibraryView, useMenuVisibility, useSettingsEffects, useSleepTimer,
  useVisFit, useVisualizer, useVisualizers, useVolumeLimit, visId,
  type ClockPrefs, type DisplayPrefs, type LibraryView, type MenuVisibility, type SleepTimer, type VisFit,
} from './prefs';
