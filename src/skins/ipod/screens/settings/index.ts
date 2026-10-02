// The Settings screens (screens/contract.ts Screens.settings), and what
// the chrome reads of their preferences:
// - useMenuVisibility(): Menus > Main Menu / Library Filters, {main, music} each Record<id, boolean>
//   ('ipod.menus'; main.previewpanel is the Preview Panel); MAIN_MENU / LIBRARY_FILTERS list the ids.
// - useLibraryFilter(): the Library's chosen chip, [id, set] ('ipod.libraryFilter'; Playlists first).
// - useLibraryView(): Menus > Library View, ['grid' | 'list', set] ('ipod.view'; grid first): how
//   the lists with covers draw (GridScreen or MenuScreen).
// - useVisualizer(): Now Playing's Visualizer…, [visId, set] ('ipod.visualizer'; Bars first): the
//   settings.vis / preset Now Playing applies while its visualizer shows; useVisualizers() lists them by engine.
export { settings } from './Settings';
export {
  LIBRARY_FILTERS, MAIN_MENU, useLibraryFilter, useLibraryView, useMenuVisibility,
  useVisualizer, useVisualizers, visId,
  type LibraryView, type MenuVisibility,
} from './prefs';
