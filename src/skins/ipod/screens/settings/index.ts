// The Settings and Extras screens (screens/contract.ts Screens.settings / extras), and what the chrome
// reads of their preferences:
// - useMenuVisibility(): Settings > Main Menu / Music Menu, {main, music} each Record<row id,
//   boolean> ('ipod.menus'); MAIN_MENU / MUSIC_MENU list the ids and labels in the nano's order.
// - useClockPrefs(): Settings > Date & Time, {twentyFourHour, timeInTitle} ('ipod.clock').
// - useVolumeLimit(): mount once in Root; holds the Spotify player's volume under Volume Limit.
export { settings } from './Settings';
export { extras } from './Extras';
export { MAIN_MENU, MUSIC_MENU, useClockPrefs, useMenuVisibility, useVolumeLimit, type ClockPrefs, type MenuVisibility } from './prefs';
