import type { Skin } from '../types';
import { Root } from './Root';
import { ITUNES_SHORTCUTS } from './shortcuts';

/** iTunes 10 (2010): the Windows window on a desktop, the phone layout on a phone (Root). */
export const itunes: Skin = { id: 'itunes', name: 'iTunes 10', Root, shortcuts: ITUNES_SHORTCUTS };
