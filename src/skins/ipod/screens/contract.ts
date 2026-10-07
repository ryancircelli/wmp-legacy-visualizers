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
  /** a section's header (`label` its name): never selected, the wheel and a tap pass over it */
  header?: boolean;
}

/** A tile of GridScreen: `art` square on top (a grey ♪ tile when none), `label` under it, `sub` (its
 *  description: "Album · Queen") under that. A MenuItem is one too; its `right` and `chevron` go unused. */
export interface GridItem extends MenuItem {
  sub?: string;
  art?: string | null;
}

/** A CollectionHeader button: a MenuScreen item the header draws as a round `kind` button (`on`: the heart
 *  filled; 'smart': the Shuffle button while Smart Shuffle is on, its glyph). */
export interface HeadAction extends MenuItem {
  kind: 'play' | 'shuffle' | 'smart' | 'like';
  on?: boolean;
}

/** The screen contents a group may ask the chrome for (implemented in src/skins/ipod/ui.tsx). */
export interface Chrome {
  /** A list that the wheel scrolls: the selected row follows ticks, center fires onSelect. `preview`
   *  is the split-menu pane under the list (the main menu's album art / clock), when given. `head`
   *  (a CollectionHeader) leads the rows and scrolls away with them; its buttons are `items`' first
   *  `lead`, which the wheel walks before the rows. `tall`: two-line rows 44 high, the item's `art`
   *  at the left (the ♪ tile when none), its `sub` dim under the label. */
  MenuScreen: FC<{ items: GridItem[]; selected?: number; onSelectedChange?: (i: number) => void;
                   preview?: ReactNode; loading?: boolean; empty?: string; head?: ReactNode; lead?: number; tall?: boolean }>;
  /** Spotify's playlist / album header, a MenuScreen's `head`: the cover, the title, a dim line
   *  ("<owner or artist> · <n> songs"), the round `actions` and a "…" (`onMore`) */
  CollectionHeader: FC<{ art?: string | null; title: string; line: string; actions: HeadAction[]; onMore?: () => void }>;
  /** Spotify's filter chips, a MenuScreen's or GridScreen's `head`: pills in a row that scrolls
   *  sideways, the one whose id is `active` filled dark; `chips` are the list's first `lead` items */
  FilterChips: FC<{ chips: MenuItem[]; active: string }>;
  /** MenuScreen's list as 2 columns of tiles (Settings > General > Library View: Grid): the wheel
   *  moves the selection a tile at a time, row by row; the rest (`head`, `lead` too) as MenuScreen. */
  GridScreen: FC<{ items: GridItem[]; selected?: number; onSelectedChange?: (i: number) => void; loading?: boolean; empty?: string;
                   head?: ReactNode; lead?: number }>;
  /** Spotify Home's look: the shelves down one page, each its title over one strip of tiles (a
   *  'See all' tile ends it with `onMore`). The wheel moves along a strip and on into the next
   *  shelf; a drag scrolls a strip across or the page down; the rest as GridScreen. */
  ShelvesScreen: FC<{ shelves: { id: string; title: string; items: GridItem[]; onMore?: () => void }[]; loading?: boolean; empty?: string }>;
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
  /** the body: a preset name or the custom hue, saturation and lightness */
  color: 'silver' | 'black' | 'purple' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'mocha' | 'espresso' | 'crimson' | 'gold' | 'navy' | 'forest' | 'custom';
  hue: number;        // 0..360, for 'custom'
  sat: number;        // 0..100 %, for 'custom'
  light: number;      // 15..75 % (settings.ts LIGHT), for 'custom'
  clicker: boolean;   // the tick sound
  wheel: 'white' | 'black';
  /** the body: the CSS cylinder, or lit by the GPU (metal/, docs/ipod-skin.md §1.7) */
  metal: 'classic' | 'rendered';
}

/** Each group exports screen factories by these names; the chrome's main menu calls them (a
 *  factory returns the entry to push). A group that has no screen for an item exports a
 *  factory all the same, showing the iPod's "No <things>" page or the mapping the spec chose. */
export interface Screens {
  // group nowplaying/
  nowPlaying(): ScreenEntry;
  // group lists/
  /** Library: Spotify's Your Library, one screen: the filter chips (Playlists, Albums, Artists,
   *  Podcasts; Settings > General > Library Filters) over the chosen filter's grid */
  library(): ScreenEntry;
  search(): ScreenEntry;
  // group home/
  /** Radio: Spotify's stations on the FM dial (docs/ipod-skin.md §4.2) */
  fmRadio(): ScreenEntry;
  /** Home: Spotify Home's shelves of tiles on one page, each with See all (its items as a screen) */
  home(): ScreenEntry;
  // group settings/
  settings(): ScreenEntry;
  // group brick/
  /** Brick: the click wheel's Breakout (docs/ipod-skin.md §4.2) */
  brick(): ScreenEntry;
}
