// What the app hands every skin (and every src/ui piece) through <ShellContext>.
import type { QueryClient } from '@tanstack/react-query';
import type { AppStore, VisKind } from '../model';
import type { Shortcut } from './shortcuts';
// type only: the functions arrive from the app (the engine's adapter), src/ui never imports adapters
import type { Queries } from '../adapters';

/** One entry of the flat visualization list, in WMP's own order (its families by registry key: engine PRESETS). */
export interface Preset {
  vis: VisKind;
  preset: number;
  group: string;
  name: string;
}

export interface Shell {
  store: AppStore;
  presets: readonly Preset[];
  /** the engine's query functions and keys (TanStack Query; src/ui/data.ts) */
  queries: Queries;
  /** the fetched-data cache, for what runs outside a component (Ctrl+D reads a saved flag) */
  client?: QueryClient;
  /** the keyboard accelerators in force (the skin's table, else WMP 9's) */
  shortcuts: readonly Shortcut[];
  /** where menus and dialogs portal to: document.body standalone, the open shadow root under Spotify */
  portal: HTMLElement | ShadowRoot;
  /** F / Alt+Enter / View > Full Screen / double-click: the Fullscreen API, else the chrome-free view */
  toggleFullscreen(): void;
  /** the current engine's native surface ('Original' in Options), [w, h] */
  nativeSize(): [number, number];
  /** the text for the debug overlay (engine.debug() and the ticker), '' before the first frame */
  debugText(): string;
}
