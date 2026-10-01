// The Settings and Extras screens (screens/contract.ts Screens.settings / extras / alarms), and what
// the chrome reads of their preferences:
// - useMenuVisibility(): General > Main Menu / Library Menu, {main, music} each Record<row id, boolean>
//   ('ipod.menus'; main.previewpanel is the Preview Panel); MAIN_MENU / MUSIC_MENU list the ids.
// - useClockPrefs(): Date & Time, {twentyFourHour, timeInTitle} ('ipod.clock').
// - useDisplayPrefs(): General > Backlight (s, 0 = Always On) and Brightness (off the iPhone, for the
//   LCD), Playback > Energy Saver ('ipod.display'); the chrome does the dimming.
// - useSleepTimer(): Alarms > Sleep Timer, [{at, mins}] ('ipod.sleep'; at null = off), for the moon.
// - useSettingsEffects() (also named useVolumeLimit): mount once in Root: Volume Limit, Shake, the
//   sleep timer and the alarm.
export { settings } from './Settings';
export { alarms, extras } from './Extras';
export {
  MAIN_MENU, MUSIC_MENU, useClockPrefs, useDisplayPrefs, useMenuVisibility, useSettingsEffects, useSleepTimer, useVolumeLimit,
  type ClockPrefs, type DisplayPrefs, type MenuVisibility, type SleepTimer,
} from './prefs';
