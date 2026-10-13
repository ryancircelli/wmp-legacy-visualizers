// A skin = React components styled with Tailwind utilities (plus a small CSS module for what
// utilities cannot express) composed from src/ui's headless pieces. It never imports adapters/ or
// engine/; what it needs from the app arrives through ShellContext (src/ui/shell.ts).
import type { FC } from 'react';
import type { Shortcut } from '../ui/shortcuts';
export type { Preset, Shell } from '../ui/types';

export interface Skin {
  id: string;
  name: string;
  /** the whole player; rendered inside <ShellContext> */
  Root: FC;
  /** the keyboard accelerators (default: src/ui/shortcuts.ts WMP9_SHORTCUTS) */
  shortcuts?: readonly Shortcut[];
}
