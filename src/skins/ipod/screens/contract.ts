// The contract between the iPod skin's chrome (Root, ClickWheel, nav, MenuScreen: src/skins/ipod/*)
// and its screens (src/skins/ipod/screens/<group>/*), so both are built apart. The chrome implements
// what is declared here; a screen imports only from this file, '../../..', 'react' and its own group.
import type { FC, ReactNode } from 'react';

/** One entry of the navigation stack. `render` draws the whole screen under the status row. */
export interface ScreenEntry {
  /** unique within the stack; the same key pushed twice replaces */
  key: string;
  title: string;
  render: (nav: Nav) => ReactNode;
}

export interface Nav {
  push(s: ScreenEntry): void;
  /** MENU: back; at the root, nothing */
  pop(): void;
  replace(s: ScreenEntry): void;
  /** back to the main menu */
  home(): void;
  /** Now Playing on top (pushed, or brought to the top if already in the stack): what the real
   *  iPod does once a song is chosen anywhere. The chrome owns the Now Playing entry. */
  toNowPlaying(): void;
  depth: number;
}

/** The wheel, as the topmost screen hears it. A screen registers with useWheel(); the chrome
 *  routes every wheel event to the top screen only. Missing handlers do nothing. */
export interface WheelInput {
  /** one detent; +1 clockwise */
  onTick?(dir: 1 | -1): void;
  onCenter?(): void;
  /** the context menu on the real iPod */
  onHoldCenter?(): void;
  /** back, unless the screen says it handled it (returns true) */
  onMenu?(): boolean | void;
  onPlay?(): void;
  onHoldPlay?(): void;
  onPrev?(): void;
  onNext?(): void;
  /** held: the chrome repeats these every 200 ms while held */
  onHoldPrev?(): void;
  onHoldNext?(): void;
}

/** A row of MenuScreen. `right` is drawn at the row's right edge (a value, a count, a glyph). */
export interface MenuItem {
  id: string;
  label: string;
  right?: ReactNode;
  /** draws the chevron; the default for an item that pushes a screen */
  chevron?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  onHold?: () => void;
}

/** A tile of GridScreen: `art` square on top (a grey ♪ tile when none), `label` under it, `sub` (its
 *  description: "Album · Queen") under that. A MenuItem is one too; its `right` and `chevron` go unused. */
export interface GridItem extends MenuItem {
  sub?: string;
  art?: string | null;
}

/** The screen contents a group may ask the chrome for (implemented in src/skins/ipod/ui.tsx). */
export interface Chrome {
  /** A list that the wheel scrolls: the selected row follows ticks, center fires onSelect. `preview`
   *  is the split-menu pane under the list (the main menu's album art / clock), when given. */
  MenuScreen: FC<{ items: MenuItem[]; selected?: number; onSelectedChange?: (i: number) => void;
                   preview?: ReactNode; loading?: boolean; empty?: string }>;
  /** MenuScreen's list as 2 columns of tiles (Settings > General > Library View: Grid): the wheel
   *  moves the selection a tile at a time, row by row; the rest as MenuScreen. */
  GridScreen: FC<{ items: GridItem[]; selected?: number; onSelectedChange?: (i: number) => void; loading?: boolean; empty?: string }>;
  /** one of GridScreen's tiles, for a screen that lays tiles out itself (Search's results) */
  Tile: FC<{ item: GridItem; selected: boolean; onClick?: () => void }>;
  /** the status row: time, play/pause/shuffle glyphs, battery; drawn by every screen's frame */
  StatusRow: FC<{ title: string }>;
  /** the blue iPod progress bar, 0..1 */
  Bar: FC<{ value: number; className?: string }>;
  /** a modal list the real iPod shows on hold-center (Add to playlist, Start radio...) */
  Popup: FC<{ items: MenuItem[]; onClose: () => void }>;
  Spinner: FC;
}

/** What the chrome exports for the screens (src/skins/ipod/ui.tsx re-exports these names). */
export interface ChromeModule extends Chrome {
  useWheel(handlers: WheelInput): void;
  useNav(): Nav;
  /** this skin's own options (hue, clicker...) with a setter; src/skins/ipod/settings.ts */
  useIpodSettings(): [IpodSettings, (patch: Partial<IpodSettings>) => void];
}

export interface IpodSettings {
  /** the body: a preset name or a custom hue */
  color: 'silver' | 'black' | 'purple' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'custom';
  hue: number;        // 0..360, for 'custom'
  sat: number;        // 0..100
  clicker: boolean;   // the tick sound
  wheel: 'white' | 'black';
}

/** Each group exports screen factories by these names; the chrome's Main and Library menus call
 *  them (a factory returns the entry to push). A group that has no screen for an item exports a
 *  factory all the same, showing the iPod's "No <things>" page or the mapping the spec chose. */
export interface Screens {
  // group nowplaying/
  nowPlaying(): ScreenEntry;
  // group lists/ (Library > Playlists, Liked Songs (songs), Albums, Artists, Podcasts & Shows, Cover Flow; Search)
  playlists(): ScreenEntry; artists(): ScreenEntry; albums(): ScreenEntry; songs(): ScreenEntry; podcasts(): ScreenEntry;
  search(): ScreenEntry; coverFlow(): ScreenEntry;
  /** Library > Queue, also Playlists' first row: Spotify's queue (commands.addToQueue adds to it) */
  onTheGo(): ScreenEntry;
  // group home/
  /** Radio: Spotify's stations on the FM dial (docs/ipod-skin.md §4.2) */
  fmRadio(): ScreenEntry;
  /** Home: Spotify Home's shelves, each opening its items */
  home(): ScreenEntry;
  // group settings/ (Settings and Extras; the 5G's Extras: Alarms, Calendars, Clocks, Contacts,
  // Fitness, Games, Notes, Screen Lock, Stopwatch, Voice Memos (§2.3))
  settings(): ScreenEntry; extras(): ScreenEntry;
  /** Extras > Alarms: a sleep timer and an alarm that plays (§6 item 12) */
  alarms(): ScreenEntry;
}
