// The skins the user can pick (settings.skin): View > Skin in WMP 9, Settings > Skin on the iPod.
import type { Skin } from './types';
import { ipod } from './ipod';
import { wmp9 } from './wmp9';

export const skins: Record<string, Skin> = { wmp9, ipod };
export const skinFor = (id: string | undefined): Skin => skins[id ?? ''] ?? wmp9;
