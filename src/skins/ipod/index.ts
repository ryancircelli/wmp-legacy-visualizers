import type { Skin } from '../types';
import { Root } from './Root';

/** No accelerator table: the wheel's keys (ClickWheel) are the keyboard, not WMP 9's. */
export const ipod: Skin = { id: 'ipod', name: 'iPod nano', Root, shortcuts: [] };
