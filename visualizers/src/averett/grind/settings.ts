// Grind's settings (Picture Viz 3D's 0x10028e80 / 0x10028d90 rebuilt, ../../pictureviz/pv3/photo.ts): the defaults
// are Grind's own and the folders are fixed below the DLL's folder. Both functions keep Picture Viz II's registry
// code (HKCU\...\PictureViz_II, the "temp_" values, the first run that creates the key and writes every value), but
// behind obj+0x2270, which the constructor sets to 1 (0x10021565) and nothing ever clears: Grind never reads or
// writes the registry, and its settings are the defaults below on every frame. Offsets are Grind's (core.ts).
import { gdef, gi, si, unported } from './core';
import { o } from './layout';
import type { Core } from '../../pictureviz/pv3/core';

/** the defaults, in the order 0x10030150 stores them (transition n's flag at 0x28ac + 4 (n - 1): 3..10 on;
 *  0x2914 Chk_PicIII_Favorite_Randomize on) */
export const DEFAULTS: [number, number][] = [
  [0x3a64, 6],          // How_often_should_picture_be_changed (s)
  [0x27e4, 0],          // Randomize_picture
  [0x2814, 0], [0x2818, 0],                  // Use_temp_Show_effects, Use_temp_Transition_effects
  [0x281c, 0], [0x2820, 1],                  // Flag_Show_Bkg, Flag_Show_Bkg_photo
  [0x2888, 0], [0x2894, 0x10e], [0x2898, 0], // Use_temp_values_for_Bkg, How_often_..._Bkg_..., Randomize_..._Bkg
  [0x2828, 0], [0x2834, 1],                  // New_Bkg_effect, Flag_to_show_Photo_Edge
  // the photo edge: size, transparency, special mix, tint, flat, colour
  [0x283c, 8], [0x2840, 7], [0x2844, 0x32], [0x284c, 0], [0x2850, 0], [0x2848, -1],
  [0x2824, 0],          // Flag_Show_Photo_drop_shadow
  // the drop shadow: colour, transparency, edge width, edge transparency, horz, vert
  [0x2858, 0], [0x285c, 0xff], [0x2860, 0x10], [0x2864, 0], [0x2868, 0x41], [0x286c, 0x3f],
  [0x27e4, 0], [0x27f0, 0],                  // Randomize_picture again, New_folder_selected
  [0x2880, 0], [0x2884, 1],                  // Photo_delay, Photo_cnt
  // Chk_PicIII_transition_1..26
  [0x28ac, 0], [0x28b0, 0], [0x28b4, 1], [0x28d4, 0], [0x28d8, 0], [0x28b8, 1], [0x28dc, 0], [0x28bc, 1],
  [0x28e0, 0], [0x28c0, 1], [0x28e4, 0], [0x28c4, 1], [0x28e8, 0], [0x28c8, 1], [0x28ec, 0], [0x28cc, 1],
  [0x28f0, 0], [0x28d0, 1], [0x28f8, 0], [0x28f4, 0], [0x2900, 0], [0x28fc, 0], [0x2908, 0], [0x2904, 0],
  [0x2910, 0], [0x290c, 0],
  [0x2914, 1],          // Chk_PicIII_Favorite_Randomize
];

/** vt+0x114 0x10030150: the settings, every frame: Display_this_photo_1st, the picture size (90 %), the logos (on
 *  with a window), the folders (%s\Grind_Media\Foreground and \Background below 0x3960), the defaults */
function settings(c: Core): number {
  return settingsWith(c, 'Grind_Media', DEFAULTS);
}
/** 0x10030150 with the media folder's name and the defaults as arguments (T3's twin differs in nothing else) */
export function settingsWith(c: Core, media: string, defaults: [number, number][]): number {
  si(c, 0x2280, 1);
  si(c, 0x3a68, 0x5a);                       // How_big_should_picture_be
  si(c, 0x291c, gi(c, 0x31bec) !== 0 ? 1 : 0);   // Flag_Logos_on_or_off: on when there is a window
  const dir = c.str.get(o(0x3960)) ?? '';
  c.str.set(o(0x2288), dir + '\\' + media + '\\Foreground');
  c.str.set(o(0x2594), dir + '\\' + media + '\\Background');
  for (const [g, v] of defaults) si(c, g, v);
  if (gi(c, 0x2270) !== 1) unported(0x10030527);     // the registry
  return 0;
}

/** vt+0x118 0x10030040 (the first Render): Reload_current_Bkg_Photo off, the first backdrop photo (1) */
function photoFirst(c: Core): number {
  si(c, 0x280c, 0);
  si(c, 0x288c, 1);
  if (gi(c, 0x2270) !== 1) unported(0x10030081);     // the registry
  return 0;
}

gdef({ 0x114: settings, 0x118: photoFirst });
