// The skins the user can pick (settings.skin). The WMP 11 skin will be a second entry.
import type { Skin } from './types';
import { wmp9 } from './wmp9';

export const skins: Record<string, Skin> = { wmp9 };
export const skinFor = (id: string | undefined): Skin => skins[id ?? ''] ?? wmp9;
