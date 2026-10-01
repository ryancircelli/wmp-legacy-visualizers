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

/** The screen contents a group may ask the chrome for (implemented in src/skins/ipod/ui.tsx). */
export interface Chrome {
  /** A list that the wheel scrolls: the selected row follows ticks, center fires onSelect. `preview`
   *  is the split-menu pane under the list (the main menu's album art / clock), when given. */
  MenuScreen: FC<{ items: MenuItem[]; selected?: number; onSelectedChange?: (i: number) => void;
                   preview?: ReactNode; loading?: boolean; empty?: string }>;
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

/** Each group exports screen factories by these names; the chrome's Main and Music menus call
 *  them (a factory returns the entry to push). A group that has no screen for an item exports a
 *  factory all the same, showing the iPod's "No <things>" page or the mapping the spec chose. */
export interface Screens {
  // group nowplaying/
  nowPlaying(): ScreenEntry;
  // group lists/
  playlists(): ScreenEntry; artists(): ScreenEntry; albums(): ScreenEntry; songs(): ScreenEntry;
  genres(): ScreenEntry; composers(): ScreenEntry; audiobooks(): ScreenEntry; podcasts(): ScreenEntry;
  search(): ScreenEntry; coverFlow(): ScreenEntry;
  /** play all songs shuffled, then Now Playing */
  shuffleSongs(nav: Nav): void;
  // group home/ (Media Guide shelves, radio; the nano's Videos / Photos / FM Radio / Voice Memos slots)
  videos(): ScreenEntry; photos(): ScreenEntry; fmRadio(): ScreenEntry; voiceMemos(): ScreenEntry;
  // group settings/ (Settings and Extras)
  settings(): ScreenEntry; extras(): ScreenEntry;
}
