// T3's settings (0x10028ec0 / 0x10028db0): Grind's (../grind/settings.ts) with T3_Media for Grind_Media and T3's
// defaults: a new picture every 2 s, the drop shadow on, transitions 4..26 on, Chk_PicIII_Favorite_Randomize off.
import { DEFAULTS, settingsWith } from '../grind/settings';
import type { Core } from '../../pictureviz/pv3/core';
import { tdef } from './core';

const T3 = new Map<number, number>([[0x3a64, 2], [0x2824, 1], [0x28b4, 0], [0x2914, 0]]);
// Chk_PicIII_transition_4..26 (Grind offsets 0x28b8..0x2910)
for (let g = 0x28b8; g <= 0x2910; g += 4) T3.set(g, 1);
const T3_DEFAULTS = DEFAULTS.map(([g, v]): [number, number] => [g, T3.get(g) ?? v]);

tdef({ 0x114: (c: Core) => settingsWith(c, 'T3_Media', T3_DEFAULTS) });
