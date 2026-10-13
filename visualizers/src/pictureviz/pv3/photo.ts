// Picture Viz 3D's settings, picture folders and picture loading: the registry (HKCU\...\PictureViz_II, Picture Viz
// II's key, with Picture Viz 3D's own values beside II's), the folder lists, the search for the next foreground and
// background picture, the GDI+ loaders, the plain background, the photo edge. VAs and offsets as in core.ts.
//
// The folder: the DLL lists its picture folder with FindFirstFileA over *.jpg, *.png, *.bmp, *.tif, *.exif (the
// *.tga pass exists in the code but every loop starts after it), walks its sub-folders and keeps one 0x110-byte
// node per folder (+0x104 its count, +0x108 visited, +0x10c next). The port's folder is the picture list
// (c.env.pictures): one folder, no sub-folders, every picture found by the *.bmp pass (the A/B's pictures are
// BMPs, and the counts come out the same for any pass but the last); c.found is the picture the search stopped at.
// Paths, file names and WIN32_FIND_DATA buffers (0x2048.., 0x214c, 0x2250, 0x2354, 0x2724, 0x2864, 0x2ee4, 0x32e4,
// 0x34ec, 0x35f0) are host file-system state: the folder names live in c.str, the rest is not modeled.
// SetCurrentDirectoryA(folder) succeeds when the folder name is not empty.
import { A } from '../../ns';
import '../../rand';
import { type Core, def, vt, tick, unported } from './core';
import { ftol } from '../pv2/mem';

const E_FAIL = 0x80004005 | 0;
/** the FindFirstFileA pass (1 *.jpg .. 5 *.exif) the port's pictures are found by: *.bmp */
const PASS = 3;
/** stand-in for the Scan0 of GDI+'s locked bitmaps (GDI+'s heap, not the DLL's) */
const SCAN0 = 0x7a000000;
/** SHGetFolderPathA(CSIDL_MYPICTURES): the folder the first run names */
const MY_PICTURES = 'My Pictures';
/** the options dialog's prompt (BROWSEINFO.lpszTitle), an address in the DLL's data */
const DIALOG_TITLE = 0x1008e718;

// ------------------------------------------------------------------------------------------------ registry
// The key is c.reg; it exists once it holds a value (RegOpenKeyExA fails on an empty map, and the settings then
// create it with every value, as on the DLL's first run). The A/B host seeds Use_pictures_in_this_folder,
// New_folder_selected = 1 and How_often_should_picture_be_changed = 2 only: every other read misses and leaves the
// field as it was.
function regQ(c: Core, name: string, field: number): boolean {
  const v = c.reg.get(name);
  if (v === undefined) return false;
  if (typeof v === 'number') c.m.I[field >> 2] = v; else c.str.set(field, v);
  return true;
}
function regSet(c: Core, name: string, v: number | string): void { c.reg.set(name, v); }
/** SetCurrentDirectoryA(the folder at `off`) */
const dirOk = (c: Core, off: number): boolean => (c.str.get(off) ?? '') !== '';

/** the first 26 transition flags (Chk_PicIII_transition_n at 0x2670 + 4 (n - 1)) and Chk_PicIII_Favorite_Randomize */
const CHK = 0x2670, CHK_FAV = 0x26d8;

/** vt+0x100 0x10028e80: the settings, every frame: defaults, then the key's values over them; the one-shot flags
 *  the options dialog sets (New_folder_selected, New_..._effect, Reload_...) are written back. obj+0x3160c is the
 *  scratch dword the writes go through. */
function settings(c: Core): number {
  const I = c.m.I;
  I[0x25d4 >> 2] = 0; I[0x25d8 >> 2] = 0; I[0x25dc >> 2] = 0; I[0x25e0 >> 2] = 1; I[0x25f4 >> 2] = 1; I[0x25e4 >> 2] = 1;
  I[0x2648 >> 2] = 0; I[0x264c >> 2] = 0; I[0x2658 >> 2] = 0x3c; I[0x265c >> 2] = 0;
  I[0x25fc >> 2] = 8; I[0x2600 >> 2] = 7; I[0x2604 >> 2] = 0x32; I[0x260c >> 2] = 0; I[0x2610 >> 2] = 0; I[0x2608 >> 2] = -1;
  I[0x2618 >> 2] = 0; I[0x261c >> 2] = 0xff; I[0x2620 >> 2] = 0x10; I[0x2624 >> 2] = 0; I[0x2628 >> 2] = 0x41; I[0x262c >> 2] = 0x3f;
  I[0x25a4 >> 2] = 0; I[0x25b0 >> 2] = 0; I[0x2640 >> 2] = 0; I[0x2644 >> 2] = 1;
  for (let i = 0; i < 26; i++) I[(CHK >> 2) + i] = i < 3 ? 0 : 1;      // transitions 4..26 on
  I[CHK_FAV >> 2] = 0;
  if (c.reg.size === 0) return firstRun(c);
  regQ(c, 'Reload_current_Photo', 0x25c4);
  regQ(c, 'New_Bkg_effect', 0x25e8);
  regQ(c, 'Reload_current_Bkg_Photo', 0x25cc);
  if (I[0x25c4 >> 2] === 1) regQ(c, 'Display_this_photo', 0x2038); else regSet(c, 'Display_this_photo', I[0x2038 >> 2]);
  if (I[0x25e8 >> 2] === 1) regQ(c, 'Display_this_photo_in_Bkg', 0x2650); else regSet(c, 'Display_this_photo_in_Bkg', I[0x2650 >> 2]);
  if (!regQ(c, 'Use_temp_size_and_duration_etc', 0x25c0)) I[0x25c0 >> 2] = 0;
  if (!regQ(c, 'New_folder_selected', 0x25b0)) I[0x25c4 >> 2] = 0;    // (a miss clears Reload's field: the DLL's slip)
  I[0x3160c >> 2] = 0;
  regSet(c, 'New_folder_selected', 0);
  const t = I[0x25c0 >> 2] === 0 ? '' : 'temp_';
  regQ(c, t + 'Use_pictures_in_this_folder', 0x2048);
  if (!regQ(c, t + 'How_often_should_picture_be_changed', 0x36f4)) I[0x36f4 >> 2] = 2;
  if (!regQ(c, t + 'How_big_should_picture_be', 0x36f8)) I[0x36f8 >> 2] = 0x5a;
  regQ(c, t + 'Randomize_picture', 0x25a4);
  if (I[0x25c4 >> 2] === 1) {
    I[0x3166c >> 2] = 3; I[0x25a0 >> 2] = 1; I[0x25a8 >> 2] = 0; I[0x31228 >> 2] = 0; I[0x25c4 >> 2] = 0;
    regSet(c, 'Reload_current_Photo', 0);
  }
  if ((I[0x36f4 >> 2] >>> 0) > 600) { I[0x36f4 >> 2] = 2; regSet(c, 'How_often_should_picture_be_changed', 2); }
  if ((I[0x36f8 >> 2] >>> 0) > 100) { I[0x36f8 >> 2] = 0x5a; regSet(c, 'How_big_should_picture_be', 0x5a); }
  if ((I[0x25a4 >> 2] >>> 0) > 1) I[0x25a4 >> 2] = 0;
  regQ(c, 'Use_temp_Show_effects', 0x25d4);
  const s = I[0x25d4 >> 2] === 0 ? '' : 'temp_';
  regQ(c, s + 'Flag_Show_Bkg', 0x25dc);
  regQ(c, s + 'Flag_Show_Bkg_photo', 0x25e0);
  regQ(c, s + 'Flag_to_show_Photo_Edge', 0x25f4);
  regQ(c, s + 'Flag_Show_Photo_drop_shadow', 0x25e4);
  if (s) { I[0x3160c >> 2] = 1; regSet(c, 'Use_temp_Show_effects', 1); }
  regQ(c, 'New_Bkg_effect', 0x25e8);
  regQ(c, 'Use_temp_values_for_Bkg', 0x2648);
  if (I[0x2648 >> 2] === 0) {
    regQ(c, 'Bkg_picture_in_this_folder', 0x2354);
    regQ(c, 'Flag_Show_Bkg_photo', 0x25e0);
    regQ(c, 'Selected_Bkg_photo_1', 0x264c);
    regQ(c, 'How_often_should_Bkg_picture_be_changed', 0x2658);
    regQ(c, 'Randomize_picture_for_Bkg', 0x265c);
    regQ(c, 'Background_Color', 0x30ee4);
    if (!regQ(c, 'Flag_Logos_on_or_off', 0x26e0)) I[0x26e0 >> 2] = 1;
  } else {
    if (!regQ(c, 'temp_Flag_Logos_on_or_off', 0x26e0)) I[0x26e0 >> 2] = 1;
    regQ(c, 'temp_Bkg_picture_in_this_folder', 0x2354);
    regQ(c, 'temp_Flag_Show_Bkg_photo', 0x25e0);
    regQ(c, 'temp_Selected_Bkg_photo_1', 0x264c);
    regQ(c, 'temp_How_often_should_Bkg_picture_be_changed', 0x2658);
    regQ(c, 'temp_Randomize_picture_for_Bkg', 0x265c);
    regQ(c, 'temp_Background_Color', 0x30ee4);
  }
  I[0x3160c >> 2] = 0;
  regSet(c, 'New_Bkg_effect', 0);
  if (I[0x25cc >> 2] === 1) regSet(c, 'Reload_current_Bkg_Photo', 0);
  regQ(c, 'New_Photo_Edge_effect', 0x25f8);
  const e = I[0x25f8 >> 2] < 2 ? '' : 'temp_';
  regQ(c, e + 'Photo_Edge_Color_1', 0x2608);
  regQ(c, e + 'Photo_Edge_Size', 0x25fc);
  regQ(c, e + 'Photo_Edge_Transparency', 0x2600);
  regQ(c, e + 'Photo_Edge_Special_Mix', 0x2604);
  regQ(c, e + 'How_Much_Photo_Edge_Tint', 0x260c);
  regQ(c, e + 'Flag_Photo_Edge_normal_flat', 0x2610);
  I[0x3160c >> 2] = e ? 3 : 0;
  regSet(c, 'New_Photo_Edge_effect', I[0x3160c >> 2]);
  regQ(c, 'New_Drop_shadow_effect', 0x2614);
  const d = I[0x2614 >> 2] < 2 ? '' : 'temp_';
  regQ(c, d + 'Drop_shadow_Color', 0x2618);
  regQ(c, d + 'Drop_shadow_Transparency', 0x261c);
  regQ(c, d + 'Drop_shadow_Edge_width', 0x2620);
  regQ(c, d + 'Drop_shadow_Edge_Transparency', 0x2624);
  regQ(c, d + 'Drop_shadow_horz', 0x2628);
  regQ(c, d + 'Drop_shadow_vert', 0x262c);
  I[0x3160c >> 2] = d ? 3 : 0;
  regSet(c, 'New_Drop_shadow_effect', I[0x3160c >> 2]);
  regQ(c, 'Use_temp_Transition_effects', 0x25d8);
  const x = I[0x25d8 >> 2] === 0 ? '' : 'temp_';
  for (let i = 1; i <= 26; i++) regQ(c, x + 'Chk_PicIII_transition_' + i, CHK + (i - 1) * 4);
  regQ(c, x + 'Chk_PicIII_Favorite_Randomize', CHK_FAV);
  const pe = I[0x25f8 >> 2], ds = I[0x2614 >> 2];
  if (I[0x25e8 >> 2] !== 0 || ds === 2 || ds === 1 || pe === 2 || pe === 1 || I[0x25d4 >> 2] === 2 || I[0x25c4 >> 2] === 1) {
    I[0x3166c >> 2] = 3; I[0x25a0 >> 2] = 1; I[0x25a8 >> 2] = 0;
  }
  return 0;
}

/** 0x10028e80's other half: no key yet (RegOpenKeyExA failed): RegCreateKeyExA and every value from the defaults
 *  just set, the folders named after My Pictures */
function firstRun(c: Core): number {
  const I = c.m.I;
  const both = (n: string, v: number | string): void => { regSet(c, n, v); regSet(c, 'temp_' + n, v); };
  I[0x2668 >> 2] = 1;
  I[0x2040 >> 2] = 1; regSet(c, 'Display_this_photo_1st', 1);
  I[0x2654 >> 2] = 1; regSet(c, 'Display_this_photo_in_Bkg_1st', 1);
  I[0x36f4 >> 2] = 2; regSet(c, 'How_often_should_picture_be_changed', 2);
  I[0x36f8 >> 2] = 0x5a; regSet(c, 'How_big_should_picture_be', 0x5a);
  I[0x25a4 >> 2] = 0; regSet(c, 'Randomize_picture', 0);
  I[0x25b0 >> 2] = 1; regSet(c, 'New_folder_selected', 1);
  c.str.set(0x2048, MY_PICTURES);
  c.str.set(0x2354, MY_PICTURES);
  both('Use_pictures_in_this_folder', MY_PICTURES);
  regSet(c, 'DirPath_last', MY_PICTURES);
  regSet(c, 'Cur_edit_box', MY_PICTURES);
  both('Bkg_picture_in_this_folder', MY_PICTURES);
  regSet(c, 'Use_temp_Show_effects', I[0x25d4 >> 2]);
  regSet(c, 'Use_temp_values_for_Bkg', I[0x2648 >> 2]);
  both('Flag_Show_Bkg', I[0x25dc >> 2]);
  both('Flag_Show_Bkg_photo', I[0x25e0 >> 2]);
  both('Flag_to_show_Photo_Edge', I[0x25f4 >> 2]);
  both('Flag_Show_Photo_drop_shadow', I[0x25e4 >> 2]);
  both('Selected_Bkg_photo_1', I[0x264c >> 2]);
  both('How_often_should_Bkg_picture_be_changed', I[0x2658 >> 2]);
  both('Randomize_picture_for_Bkg', I[0x265c >> 2]);
  I[0x3160c >> 2] = 0; regSet(c, 'Reload_current_Bkg_Photo', 0);
  I[0x26e0 >> 2] = 1; both('Flag_Logos_on_or_off', 1);
  both('Photo_Edge_Size', I[0x25fc >> 2]);
  both('Photo_Edge_Transparency', I[0x2600 >> 2]);
  both('Photo_Edge_Special_Mix', I[0x2604 >> 2]);
  both('How_Much_Photo_Edge_Tint', I[0x260c >> 2]);
  both('Flag_Photo_Edge_normal_flat', I[0x2610 >> 2]);
  both('Photo_Edge_Color_1', I[0x2608 >> 2]);
  both('Drop_shadow_Color', I[0x2618 >> 2]);
  both('Drop_shadow_Transparency', I[0x261c >> 2]);
  both('Drop_shadow_Edge_width', I[0x2620 >> 2]);
  both('Drop_shadow_Edge_Transparency', I[0x2624 >> 2]);
  both('Drop_shadow_horz', I[0x2628 >> 2]);
  both('Drop_shadow_vert', I[0x262c >> 2]);
  for (let i = 1; i <= 26; i++) both('Chk_PicIII_transition_' + i, I[(CHK >> 2) + i - 1]);
  both('Chk_PicIII_Favorite_Randomize', I[CHK_FAV >> 2]);
  regSet(c, 'Randomize_picture', I[0x25a4 >> 2]);
  regSet(c, 'New_folder_selected', I[0x25b0 >> 2]);
  regSet(c, 'Photo_delay', I[0x2640 >> 2]);
  regSet(c, 'Photo_cnt', I[0x2644 >> 2]);
  return 0;
}

/** vt+0x104 0x10028d90 (the first Render): the first photo numbers and the logo flag (a missed
 *  Display_this_photo_1st writes obj+0x2040, not 0x2038: the DLL's slip) */
function photoFirst(c: Core): number {
  const I = c.m.I;
  I[0x25cc >> 2] = 0;
  if (!regQ(c, 'Display_this_photo_1st', 0x2038)) I[0x2040 >> 2] = 1;
  if (!regQ(c, 'Display_this_photo_in_Bkg_1st', 0x2650)) I[0x2650 >> 2] = 1;
  if (!regQ(c, 'Flag_Logos_on_or_off', 0x26e0)) I[0x26e0 >> 2] = 1;
  return 0;
}

// ------------------------------------------------------------------------------------------------ the folders
/** vt+0x3c 0x1002db20 / vt+0x40 0x1002df40: the folder name (cur) changed since last time: free the folder list at
 *  obj+head (head+4 nodes, head+8 pictures), count the folder (vt+0x5c) into a node, walk the sub-folders of every
 *  node not visited yet, store the total as cur_Photo_cnt_foreground / _background */
function folderChanged(c: Core, cur: number, last: number, head: number, node: number, walk: number, name: string): number {
  const s = c.str.get(cur) ?? '';
  if ((c.str.get(last) ?? '') === s) return 0;          // lstrcmpA
  c.str.set(last, s);
  let I = c.m.I;
  for (let p = I[head >> 2]; p !== 0; p = I[head >> 2]) {
    I[head >> 2] = I[(p + 0x10c) >> 2];
    c.m.release(p);
  }
  I[(head + 4) >> 2] = 0;
  I[(head + 8) >> 2] = 0;
  c.str.set(0x32e4, s);                                   // (GetCurrentDirectoryA, SetCurrentDirectoryA(folder))
  vt(c, 0x5c);
  vt(c, node);
  for (let again = true; again;) {
    again = false;
    I = c.m.I;
    for (let p = I[head >> 2]; p !== 0;) {
      const next = I[(p + 0x10c) >> 2];
      if (I[(p + 0x108) >> 2] === 0) {
        I[(p + 0x108) >> 2] = 1;
        again = true;
        c.str.set(0x32e4, s + '\\');                      // the node's name
        vt(c, walk);
        I = c.m.I;
      }
      p = next;
    }
  }
  regSet(c, name, c.m.I[(head + 8) >> 2]);
  return 0;
}

/** vt+0x5c 0x1002c630: count the current folder's pictures into obj+0x25b4. FindFirstFileA / FindNextFileA from
 *  *.jpg on: the count goes up per FindNextFileA call, not per file (a pass's first file is not counted, its
 *  closing ERROR_NO_MORE_FILES is, except after *.exif), so n pictures of one pass count n unless the pass is
 *  *.exif. The port's folder is the picture list. */
function countFiles(c: Core): number {
  c.m.I[0x25b4 >> 2] = dirOk(c, 0x32e4) ? c.env.pictures.length : 0;
  return 0;
}

/** vt+0x6c 0x1002dc90 / vt+0x70 0x1002e0a0: a folder node for the current folder (operator new(0x110)) pushed on
 *  the list at obj+head with obj+0x25b4 pictures (its name, the path + '\', is not kept) */
function folderNode(c: Core, head: number): number {
  const p = c.m.malloc(0x110), I = c.m.I;
  I[(p + 0x10c) >> 2] = I[head >> 2];
  I[(head + 4) >> 2]++;
  I[head >> 2] = p;
  I[(head + 8) >> 2] += I[0x25b4 >> 2];
  I[(p + 0x108) >> 2] = 0;
  I[(p + 0x104) >> 2] = I[0x25b4 >> 2];
  return 0;
}

/** vt+0x74 0x1002dea0 / vt+0x78 0x1002e2b0: which node holds photo number obj+idx (counted from the list's end);
 *  obj+0x203c = its number within that node. (A number past the list dereferences a null node in the DLL.) */
function seekPhoto(c: Core, head: number, idx: number, va: number): number {
  const I = c.m.I;
  let p = I[head >> 2];
  I[0x203c >> 2] = I[(head + 8) >> 2] - I[idx >> 2];
  for (; p !== 0; p = I[(p + 0x10c) >> 2]) {
    if (I[0x203c >> 2] < I[(p + 0x104) >> 2]) break;
    I[0x203c >> 2] -= I[(p + 0x104) >> 2];
  }
  if (p === 0) unported(va);
  I[0x203c >> 2] = I[(p + 0x104) >> 2] - I[0x203c >> 2];
  return 0;
}

/** Randomize_picture's walk (0x1002bdde.. / 0x1002c296..): jumps of a random stride, restarted at random. fg: the
 *  foreground's, whose run end also clears the search counter. */
function randomStep(c: Core, idx: number, runs: number, stride: number, count: number, fg: boolean): void {
  const I = c.m.I;
  let inRun = I[runs >> 2] !== 0;
  for (;;) {
    const n = I[count >> 2];
    if (inRun) {
      const a = I[idx >> 2] + I[stride >> 2];
      I[idx >> 2] = a;
      if (a <= n) return;
      const r = I[runs >> 2];
      I[idx >> 2] = 1;
      I[0x30fc4 >> 2] = 0;                                // (the background's walk clears the foreground's pass too)
      I[runs >> 2] = r - 1;
      if (r - 1 !== 0) { I[idx >> 2] = r; return; }
      if (fg) { I[0x30fc4 >> 2] = 0; I[0x263c >> 2] = 0; }
    }
    if (n <= 1) I[runs >> 2] = 1;
    else if (n <= 10) I[runs >> 2] = (A.rand() & 3) + 1;
    else if (n <= 0x1e) I[runs >> 2] = (A.rand() & 7) + 3;
    else I[runs >> 2] = (A.rand() & 0xf) + 7;
    I[stride >> 2] = I[runs >> 2];
    if ((A.rand() & 0x10) === 0) { I[idx >> 2] = 1; return; }
    I[idx >> 2] = 0;
    inRun = true;
  }
}

/** The search loop of 0x1002bd20 / 0x1002c060: passes *.jpg (1) to *.exif (5) in obj+pass, counting files in
 *  obj+0x263c until it reaches obj+0x203c, then the loader (vt+0x44 / vt+0x48; pass 0, *.tga, would take the TGA
 *  loaders vt+0x50 / vt+0x54, but no loop starts there) */
function search(c: Core, pass: number, load: number): number {
  const I = c.m.I, n = c.env.pictures.length;
  I[pass >> 2] = 1;
  do {
    if (I[pass >> 2] === PASS) {
      for (let k = 0; k < n; k++) {
        I[0x263c >> 2]++;
        if (I[0x203c >> 2] === I[0x263c >> 2]) {
          c.found = k;
          vt(c, load);
          return 0;
        }
      }
    }
    I[pass >> 2]++;
  } while (I[pass >> 2] < 6);
  return E_FAIL;
}

/** vt+0x28 0x1002bd20: the next foreground picture (photo number obj+0x2038, 1-based; Randomize_picture with 3 or
 *  more) into the current sprite. New_folder_selected (obj+0x25b0) restarts at the first; obj+0x25c8 holds the step
 *  for one call. */
function findPhoto(c: Core): number {
  let I = c.m.I;
  I[0x30fc4 >> 2] = 0;
  I[0x263c >> 2] = 0;
  if (I[0x25b0 >> 2] === 1) {
    I[0x25b0 >> 2] = 0; I[0x2038 >> 2] = 1; I[0x263c >> 2] = 0; I[0x25a0 >> 2] = 1; I[0x31210 >> 2] = 0;
    I[0x2584 >> 2] = tick(c);
  }
  if (!dirOk(c, 0x2048)) return E_FAIL;
  if (I[0x2e10c >> 2] === 0) { vt(c, 0x38); I = c.m.I; }
  if (I[0x3166c >> 2] !== 3 && I[0x25c8 >> 2] !== 1) {
    const n = I[0x2e10c >> 2];
    I[0x25c8 >> 2] = 1;
    if (n <= 2 || I[0x25a4 >> 2] === 0) {
      const a = I[0x2038 >> 2] + 1;
      I[0x2038 >> 2] = a;
      if (n < a) I[0x2038 >> 2] = 1;
    } else randomStep(c, 0x2038, 0x31210, 0x3121c, 0x2e10c, true);
  }
  if (I[0x2e10c >> 2] < I[0x2038 >> 2] || I[0x2038 >> 2] <= 0) I[0x2038 >> 2] = 1;
  vt(c, 0x74);
  return search(c, 0x30fc4, 0x44);
}

/** vt+0x2c 0x1002c060: the next background picture (obj+0x2650) into the current sprite, or a window-sized image
 *  of the background colour when the background folder holds none */
function findBackground(c: Core): number {
  if (!dirOk(c, 0x2354)) return E_FAIL;
  const I = c.m.I, n = I[0x2e118 >> 2];
  if (n === 0) {
    I[0x25ec >> 2] = I[0x310dc >> 2];
    I[0x25f0 >> 2] = I[0x310e0 >> 2];
    return plainFill(c);
  }
  if (I[0x25d0 >> 2] === 1 || n <= 2 || I[0x265c >> 2] === 0) {
    if (I[0x25d0 >> 2] === 0) { I[0x25d0 >> 2] = 1; I[0x2650 >> 2]++; }
    if (n < I[0x2650 >> 2] || I[0x2650 >> 2] <= 0) I[0x2650 >> 2] = 1;
  } else {
    I[0x25d0 >> 2] = 1;
    randomStep(c, 0x2650, 0x31214, 0x31220, 0x2e118, false);   // (no range check after it)
  }
  vt(c, 0x78);
  const J = c.m.I;
  J[0x30fc8 >> 2] = 1;
  J[0x263c >> 2] = 0;
  return search(c, 0x30fc8, 0x48);
}

/** vt+0x38 0x1000fb70: the folder dialog (SHBrowseForFolderA), shown when the picture folder holds none; the
 *  port's host has no dialog: as when it is cancelled (CoInitializeEx, SHGetMalloc, GetFocus are not modeled) */
function folderDialog(c: Core): number {
  const I = c.m.I;
  if (I[0x2044 >> 2] === 4 || I[0x2044 >> 2] === 0) {
    for (let a = 0x26fc; a < 0x271c; a += 4) I[a >> 2] = 0;
    I[0x2708 >> 2] = DIALOG_TITLE;
    I[0x270c >> 2] = 0x1055;
    I[0x271c >> 2] = 0;
    I[0x2720 >> 2] = 0;
    I[0x2044 >> 2] = 2;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ loading
/** the image block the loaders malloc at obj+0x310d4: [w, h, 0] then w*h pixels (the cursor obj+0x30e38 walks the
 *  header); returns the pixels' address (obj+0x31460) */
function imageBlock(c: Core, w: number, h: number): number {
  const p = c.m.malloc(Math.imul(w, h) * 4 + 0xc), I = c.m.I;
  I[0x310d4 >> 2] = p;
  I[0x30e38 >> 2] = p; I[p >> 2] = w;
  I[0x30e38 >> 2] = p + 4; I[(p + 4) >> 2] = h;
  I[0x30e38 >> 2] = p + 8; I[(p + 8) >> 2] = 0;
  I[0x30e38 >> 2] = p + 12;
  I[0x31460 >> 2] = p + 12;
  return p + 12;
}
/** the current sprite (obj+0x1ca4) takes the image: its own (-1), w x h */
function bindImage(c: Core, img: number, w: number, h: number): void {
  const I = c.m.I, l = I[0x1ca4 >> 2] * 0x1ec;
  I[(0x970 + l) >> 2] = -1;
  I[(0x9f4 + l) >> 2] = w;
  I[(0x9f8 + l) >> 2] = h;
  I[(0x99c + l) >> 2] = w;
  I[(0x9a0 + l) >> 2] = h;
  I[(0x994 + l) >> 2] = img;
  if (I[(0x97c + l) >> 2] === 0) I[(0x97c + l) >> 2] = 2;
  I[0x310d4 >> 2] = 0;
}
/** GdiplusStartup, once (obj+0x255c; the token obj+0x370c is GDI+'s and stays 0 here) */
function gdipStart(c: Core): void { c.m.I[0x255c >> 2] = 1; }

/** vt+0xf0 0x1002bb30 (and 0x1002c060's empty-folder path): a window-sized (obj+0x25ec x 0x25f0) image of the
 *  background colour obj+0x30ee4 for the current sprite */
function plainBackground(c: Core): number {
  const I = c.m.I;
  I[0x25ec >> 2] = I[0x310dc >> 2];
  I[0x25f0 >> 2] = I[0x310e0 >> 2];
  return plainFill(c);
}
function plainFill(c: Core): number {
  vt(c, 0x230);
  let I = c.m.I;
  const w = I[0x25ec >> 2], h = I[0x25f0 >> 2], n = Math.imul(h, w);
  I[0x3165c >> 2] = n;
  const img = imageBlock(c, w, h);                        // (the DLL's out-of-memory exits are unreachable here)
  I = c.m.I;
  const col = I[0x30ee4 >> 2];
  I[0x3103c >> 2] = 0;
  for (let k = 0; k < n; k++) I[(img >> 2) + k] = col;
  if (n > 0) { I[0x30e38 >> 2] = img + n * 4; I[0x3103c >> 2] = n; }
  bindImage(c, img, w, h);
  return 0;
}

/** vt+0x44 0x1002d070: load the found picture into the current sprite. GDI+: GdipCreateBitmapFromFileICM, its size
 *  (obj+0x313e4 x 0x313d4), the fit (vt+0x19c: obj+0x25ec x 0x25f0, shrunk when its larger side less 10 reaches
 *  the texture limit obj+0x39b0), a 32bppPARGB bitmap of the fitted size, InterpolationModeHighQualityBicubic,
 *  DrawImageRectRectI (0, 0, w, h) <- (0, 0, W, H) UnitPixel, LockBits 32bppARGB: Env.scale's contract. Stored
 *  alpha dropped, rows bottom-up. */
function loadPhoto(c: Core): number {
  let I = c.m.I;
  gdipStart(c);
  const pic = c.env.pictures[c.found];
  I[0x313e4 >> 2] = pic ? pic.w : 0;
  I[0x313d4 >> 2] = pic ? pic.h : 0;
  if (Math.imul(I[0x313e4 >> 2], I[0x313d4 >> 2]) === 0) return E_FAIL;
  vt(c, 0x19c);
  I = c.m.I;
  I[0x314d8 >> 2] = I[0x25ec >> 2] > I[0x25f0 >> 2] ? I[0x25ec >> 2] : I[0x25f0 >> 2];
  const big = I[0x314d8 >> 2] - 10, lim = I[0x39b0 >> 2];
  I[0x314d8 >> 2] = big;
  if (big < lim) I[0x39b4 >> 2] = 0;
  else {
    const s = lim / big;                                  // FILD / FIDIV; FST float keeps the double on the stack
    c.m.F[0x39b4 >> 2] = s;
    const h = ftol(I[0x25f0 >> 2] * s);
    I[0x25f0 >> 2] = h - 10;
    I[0x25ec >> 2] = ftol(I[0x25ec >> 2] * s) - 10;
  }
  vt(c, 0x230);
  I = c.m.I;
  const w = I[0x25ec >> 2], h = I[0x25f0 >> 2], n = Math.imul(w, h);
  I[0x3165c >> 2] = n;
  if (n === 0) return E_FAIL;
  const img = imageBlock(c, w, h);
  I = c.m.I;
  I[0x30e40 >> 2] = img + n * 4;
  const px = c.env.scale(pic, 0, 0, w, h, w, h);
  I[0x30e70 >> 2] = SCAN0;
  I[0x313e4 >> 2] = w;
  I[0x313d4 >> 2] = h;
  I[0x3105c >> 2] = 0;
  I[0x30e40 >> 2] = I[0x30e38 >> 2] + n * 4;
  const end = I[0x30e40 >> 2];
  for (let r = 0; r < h; r++) {
    const d = end - Math.imul(r + 1, w) * 4;
    I[0x3103c >> 2] = 0;
    for (let x = 0; x < w; x++) I[(d >> 2) + x] = px[r * w + x] & 0xffffff;
    if (w > 0) { I[0x30e38 >> 2] = d + w * 4; I[0x3103c >> 2] = w; } else I[0x30e38 >> 2] = d;
    I[0x3105c >> 2] = r + 1;
  }
  I[0x30e70 >> 2] = SCAN0 + n * 4;
  bindImage(c, img, w, h);
  return 0;
}

/** vt+0x48 0x1002d620: load the found background picture: as vt+0x44, but drawn at its fitted size centred in a
 *  window-sized (obj+0x310dc x 0x310e0) bitmap that is stored whole, top-down (the block is sized for the fitted
 *  picture, which covers the window) */
function loadBackground(c: Core): number {
  let I = c.m.I;
  gdipStart(c);
  const pic = c.env.pictures[c.found];
  I[0x313e4 >> 2] = pic ? pic.w : 0;
  I[0x313d4 >> 2] = pic ? pic.h : 0;
  if (Math.imul(I[0x313e4 >> 2], I[0x313d4 >> 2]) === 0) return E_FAIL;
  vt(c, 0x19c);
  vt(c, 0x230);
  I = c.m.I;
  const w = I[0x25ec >> 2], h = I[0x25f0 >> 2], n = Math.imul(w, h);
  I[0x3165c >> 2] = n;
  if (n === 0) return E_FAIL;
  const img = imageBlock(c, w, h);
  I = c.m.I;
  I[0x30e40 >> 2] = img + n * 4;
  const W = I[0x310dc >> 2], H = I[0x310e0 >> 2];
  const px = c.env.scale(pic, ((W - w) / 2) | 0, ((H - h) / 2) | 0, w, h, W, H);
  I[0x30e70 >> 2] = SCAN0;
  I[0x313e4 >> 2] = W;
  I[0x313d4 >> 2] = H;
  const N = Math.imul(W, H);
  I[0x3105c >> 2] = 0;
  for (let k = 0; k < N; k++) I[(img >> 2) + k] = px[k] & 0xffffff;
  if (N > 0) { I[0x30e38 >> 2] = img + N * 4; I[0x30e70 >> 2] = SCAN0 + N * 4; I[0x3105c >> 2] = N; }
  bindImage(c, img, W, H);
  return 0;
}

/** vt+0x34 0x1001f510: the logo (c:\Program Files\Windows Media Player\Visualizations\Media\windows_normal.png and
 *  windows_hover.png, GDI+, drawn into the background sprite's corner). Those files are not there (not in the A/B's
 *  Windows, not in the app): GdipCreateBitmapFromFile fails, the sizes read 0, E_FAIL. */
function loadLogo(c: Core): number {
  const I = c.m.I;
  gdipStart(c);
  I[0x313e4 >> 2] = 0;
  I[0x313d4 >> 2] = 0;
  return E_FAIL;
}

/** vt+0xf4 0x1002b120 (every frame): the background picture's timer (How_often_should_Bkg_picture_be_changed
 *  seconds), a size change, New_Bkg_effect or a scene rebuild: a new background (sprite 6: the next background
 *  picture, else the plain one), then the logo */
function backgroundTimer(c: Core): number {
  let I = c.m.I;
  const s = ((((tick(c) - I[0x258c >> 2]) >>> 0) / 1000) >>> 0) | 0, bk = I[0x2658 >> 2];
  I[0x2598 >> 2] = s;
  if ((s > bk && I[0x12c0 >> 2] !== -1 && I[0x3166c >> 2] === 0 && I[0x25e0 >> 2] !== 0) ||
      I[0x31264 >> 2] !== I[0x310e0 >> 2] || I[0x3125c >> 2] !== I[0x310dc >> 2] || I[0x25e8 >> 2] !== 0 ||
      I[0x30fe0 >> 2] === 1 || I[0x26f8 >> 2] === 1) {
    if (s > bk) { I[0x25d0 >> 2] = 0; I[0x258c >> 2] = tick(c); I[0x2598 >> 2] = 0; }
    I[0x3166c >> 2] = 3; I[0x25a0 >> 2] = 1; I[0x25a8 >> 2] = 0; I[0x2660 >> 2] = 1;
    I[0x1ca4 >> 2] = 6;
    I[0x14f4 >> 2] = 2;
    const l = I[0x1ca4 >> 2] * 0x1ec;
    I[(0x9e8 + l) >> 2] = 0; I[(0x9ec + l) >> 2] = -2000; I[(0xa08 + l) >> 2] = -2000; I[(0x9e4 + l) >> 2] = -2;
    vt(c, 0x230);
    if (c.m.I[0x25e0 >> 2] === 0) vt(c, 0xf0);
    else if (vt(c, 0x2c) === E_FAIL) vt(c, 0xf0);
    I = c.m.I;
    const logos = I[0x26e0 >> 2];
    if (logos === 1 && I[0x26f4 >> 2] === 0) I[0x26f4 >> 2] = 1;
    if ((I[0x26f8 >> 2] === 1 && logos === 0 && I[0x26f4 >> 2] > 1) || I[0x31264 >> 2] !== I[0x310e0 >> 2] ||
        I[0x3125c >> 2] !== I[0x310dc >> 2] || I[0x26ec >> 2] === 0 || logos === 1) {
      vt(c, 0x34);
      c.m.I[0x26f8 >> 2] = 0;
      return 0;
    }
    I[0x26f4 >> 2] = 0; I[0x26f8 >> 2] = 0;
  }
  return 0;
}

/** vt+0xf8 0x10028d20: dress the loaded picture (the photo edge, vt+0xfc), obj+0x12fc = "no background at all",
 *  then Direct3D (vt+0x118) and the floor texture (vt+0x140) */
function dressPhoto(c: Core): number {
  let I = c.m.I;
  if (I[0x25f4 >> 2] === 1) { vt(c, 0xfc); I = c.m.I; I[0x12fc >> 2] = 0; }
  I[0x12fc >> 2] = I[0x25e0 >> 2] === 0 && I[0x25dc >> 2] === 0 ? 1 : 0;
  vt(c, 0x118);
  vt(c, 0x140);
  return 0;
}

/** vt+0xfc 0x1002b370 (Picture Viz II's 0x10018760): the photo edge: the background under the picture's
 *  rectangle (or the background colour) as a block, sprite 8 = the picture with the edge settings rendered onto it
 *  (vt+0x29c), then that block, flipped and without alpha, becomes sprite 4's image */
function photoEdge(c: Core): number {
  const m = c.m;
  m.I[0x1ca4 >> 2] = 4;
  vt(c, 0x2b0);
  let I = m.I;
  I[0x313d4 >> 2] = I[0x11a8 >> 2];
  I[0x313e4 >> 2] = I[0x11a4 >> 2];
  I[0x3165c >> 2] = Math.imul(I[0x11a4 >> 2], I[0x313d4 >> 2]);
  const p = m.malloc(I[0x3165c >> 2] * 4 + 0xc);          // (the DLL's out-of-memory exit is unreachable here)
  I = m.I;
  I[0x30e38 >> 2] = p; I[p >> 2] = I[0x11a4 >> 2];
  I[0x30e38 >> 2] = p + 4; I[(p + 4) >> 2] = I[0x11a8 >> 2];
  I[0x30e38 >> 2] = p + 8; I[(p + 8) >> 2] = 0;
  I[0x30e38 >> 2] = p + 12; I[0x31460 >> 2] = p + 12;
  if (I[0x25e0 >> 2] === 0 && I[0x25dc >> 2] === 0) {
    // no background picture: the background colour
    I[0x3105c >> 2] = 0;
    const n = Math.imul(I[0x313e4 >> 2], I[0x313d4 >> 2]), col = I[0x30ee4 >> 2];
    for (let k = 0; k < n; k++) { I[I[0x30e38 >> 2] >> 2] = col; I[0x30e38 >> 2] += 4; I[0x3105c >> 2] = k + 1; }
  }
  if (I[0x25e0 >> 2] !== 0 || I[0x25dc >> 2] !== 0) {
    // the background (sprite 6's image) under sprite 4's rectangle, stride = sprite 6's width
    let s = I[0x151c >> 2];
    I[0x30e70 >> 2] = s;
    if (s === 0) return E_FAIL;
    s = (s + ((Math.imul(I[0x1134 >> 2], I[0x157c >> 2]) + I[0x1130 >> 2]) << 2)) | 0;
    I[0x30e70 >> 2] = s; I[0x30e78 >> 2] = s;
    const rows = I[0x313d4 >> 2], cols = I[0x313e4 >> 2], stride = I[0x157c >> 2];
    I[0x3105c >> 2] = 0;
    for (let i = 0; i < rows; i++) {
      let r = (s + (Math.imul(stride, i) << 2)) | 0, q = I[0x30e38 >> 2];
      I[0x3103c >> 2] = 0;
      for (let j = 0; j < cols; j++) { I[q >> 2] = I[r >> 2]; q += 4; r += 4; I[0x3103c >> 2] = j + 1; }
      I[0x30e38 >> 2] = q; I[0x30e70 >> 2] = r; I[0x3105c >> 2] = i + 1;
    }
  }
  I[0x30e20 >> 2] = I[0x31460 >> 2];
  I[0x31698 >> 2] = 0; I[0x316a4 >> 2] = 0;
  I[0x30ed0 >> 2] = I[0x11a4 >> 2]; I[0x30ecc >> 2] = I[0x11a8 >> 2];
  I[0x1ca4 >> 2] = 4;
  I[0x11c4 >> 2] = 0;
  let l = I[0x1ca4 >> 2] * 0x1ec;
  I[(0x980 + l) >> 2] = 0; I[(0xa18 + l) >> 2] = 0; I[(0x984 + l) >> 2] = 0;
  // sprite 8 (at its absolute offsets, as the asm writes them)
  I[0x18dc >> 2] = 2; I[0x18cc >> 2] = 2; I[0x1a70 >> 2] = 0; I[0x18d0 >> 2] = -1;
  I[0x1954 >> 2] = I[0x11a4 >> 2]; I[0x1958 >> 2] = I[0x11a8 >> 2];
  I[0x1944 >> 2] = -2;
  I[0x18fc >> 2] = I[0x114c >> 2]; I[0x1900 >> 2] = I[0x1150 >> 2];
  I[0x1ca4 >> 2] = 8;
  I[0x1974 >> 2] = I[0x11c4 >> 2];
  l = I[0x1ca4 >> 2] * 0x1ec;
  I[(0x980 + l) >> 2] = I[0x1130 >> 2];
  I[(0xa18 + l) >> 2] = I[0x11c8 >> 2];
  I[(0x984 + l) >> 2] = I[0x1134 >> 2];
  I[(0x994 + l) >> 2] = I[0x1144 >> 2];
  const flat = I[0x2610 >> 2];
  I[0x19b0 >> 2] = I[0x25fc >> 2];
  I[0x19f8 >> 2] = flat;
  if (flat === 1) {
    // "flat" edge: the settings themselves are rescaled, every time this runs
    const t = ftol(I[0x2600 >> 2] * 0.8);
    I[0x2600 >> 2] = t;
    I[0x260c >> 2] = ftol(I[0x260c >> 2] + I[0x260c >> 2]);
    if (t < 0) I[0x2600 >> 2] = -t | 0;
  }
  let v = I[0x2600 >> 2];
  I[0x19ac >> 2] = v >= 0x32 ? (Math.imul(v, 5) - 250) << 1 : (Math.imul(v, 5) - 250) | 0;
  v = I[0x2604 >> 2];
  if (v >= 0x32) { I[0x19d8 >> 2] = 0; I[0x19d4 >> 2] = ftol(((v - 0x32) | 0) * 5.1); }
  else { I[0x19d8 >> 2] = ftol(((0x32 - v) | 0) * 5.1); I[0x19d4 >> 2] = 0; }
  v = I[0x260c >> 2];
  if (v >= 0x32) { I[0x19bc >> 2] = 100; I[0x1a74 >> 2] = ftol(((v - 0x32) | 0) * 5.1); }
  else { I[0x1a74 >> 2] = 0; I[0x19bc >> 2] = (v + v) | 0; }
  const col = I[0x2608 >> 2];
  I[0x1aac >> 2] = col === 0 ? 1 : col === 0xffffff ? 2 : 0;
  I[0x19a8 >> 2] = (col & 0xfe) | 1;                      // each channel forced odd
  I[0x18dc >> 2] = 3;
  I[0x19a0 >> 2] = ((col & 0xfe0000) | 0x10000) >> 16;
  I[0x19a4 >> 2] = ((col & 0xfe00) | 0x100) >> 8;
  vt(c, 0x29c);
  I = m.I;
  I[0x1ca4 >> 2] = 8;
  I[0x18f4 >> 2] = 0;
  I[0x970 >> 2] = 0;                                      // absolute: sprite 0's field, as the asm has it
  vt(c, 0x230);
  I = m.I;
  I[0x18dc >> 2] = 0; I[0x18cc >> 2] = -1; I[0x1a70 >> 2] = -1;
  I[0x1ca4 >> 2] = 4;
  for (const f of [0x1aac, 0x19b0, 0x19ac, 0x19d4, 0x19d8, 0x19a0, 0x19a4, 0x19a8, 0x19bc, 0x1a74, 0x19f8]) I[f >> 2] = 0;
  vt(c, 0x230);
  I = m.I;
  l = I[0x1ca4 >> 2] * 0x1ec;
  I[(0x970 + l) >> 2] = -1;
  I[(0x994 + l) >> 2] = I[0x30e20 >> 2];
  I[0x313d4 >> 2] = I[0x11a8 >> 2];
  I[0x313e4 >> 2] = I[0x11a4 >> 2];
  I[0x3165c >> 2] = Math.imul(I[0x11a4 >> 2], I[0x313d4 >> 2]);
  I[(0x994 + l) >> 2] = I[0x30e20 >> 2];
  I[0x310d4 >> 2] = 0;
  const q = m.malloc(I[0x3165c >> 2] * 4 + 0xc);
  I = m.I;
  I[0x310d4 >> 2] = q;
  // the rendered block (now sprite 4's image), flipped vertically, alpha cleared
  let src = I[0x1144 >> 2];
  I[0x30e38 >> 2] = q; I[0x30e70 >> 2] = src; I[q >> 2] = I[0x30ed0 >> 2];
  I[0x30e38 >> 2] = q + 4; I[(q + 4) >> 2] = I[0x30ecc >> 2];
  I[0x30e38 >> 2] = q + 8; I[(q + 8) >> 2] = 0;
  I[0x30e38 >> 2] = q + 12; I[0x31460 >> 2] = q + 12;
  I[0x3105c >> 2] = 0;
  const end = q + 12 + I[0x3165c >> 2] * 4;
  I[0x30e40 >> 2] = end;
  const rows = I[0x313d4 >> 2], cols = I[0x313e4 >> 2];
  for (let i = 0; i < rows; i++) {
    let d = end - Math.imul(i + 1, cols) * 4;
    I[0x3103c >> 2] = 0;
    for (let j = 0; j < cols; j++) { I[d >> 2] = I[src >> 2] & 0xffffff; d += 4; src += 4; I[0x3103c >> 2] = j + 1; }
    I[0x30e38 >> 2] = d; I[0x30e70 >> 2] = src; I[0x3105c >> 2] = i + 1;
  }
  I[0x1ca4 >> 2] = 4;
  vt(c, 0x230);
  I = m.I;
  l = I[0x1ca4 >> 2] * 0x1ec;
  I[(0x970 + l) >> 2] = -1;
  I[(0x994 + l) >> 2] = I[0x31460 >> 2];
  I[0x310d4 >> 2] = 0;
  return 0;
}

// ------------------------------------------------------------------------------------------------ canvas
/** vt+0x2d8 0x1001d790: the canvas, 352 x 320 (obj+0x310b8 its buffer) */
function canvasDefault(c: Core): number {
  const I = c.m.I;
  if (I[0x3125c >> 2] !== 0x160 || I[0x31264 >> 2] !== 0x140) {
    if (I[0x310b8 >> 2] !== 0) c.m.release(I[0x310b8 >> 2]);
    I[0x3125c >> 2] = 0x160;
    I[0x31264 >> 2] = 0x140;
    const p = c.m.malloc(0x6e000);
    c.m.I[0x310b8 >> 2] = p;
  }
  return 0;
}
/** vt+0x2e0 0x1001d890: the canvas, window-sized */
function canvasWindow(c: Core): number {
  const I = c.m.I;
  if (I[0x3125c >> 2] !== I[0x310dc >> 2] || I[0x31264 >> 2] !== I[0x310e0 >> 2]) {
    if (I[0x310b8 >> 2] !== 0) c.m.release(I[0x310b8 >> 2]);
    I[0x3125c >> 2] = I[0x310dc >> 2];
    I[0x31264 >> 2] = I[0x310e0 >> 2];
    const p = c.m.malloc(Math.imul(I[0x310dc >> 2], I[0x310e0 >> 2]) * 4);
    c.m.I[0x310b8 >> 2] = p;
  }
  return 0;
}

/** 0x1000a800 (Gdiplus::Bitmap's scalar deleting destructor) -> 0x1000a820 (GdipDisposeImage): GDI+'s objects are
 *  not in the port's heap; nothing to do */
export function f1000a800(_c: Core, obj: number): number { return obj; }
export function f1000a820(_c: Core): void { /* GdipDisposeImage */ }

def({
  0x100: settings, 0x104: photoFirst,
  0x3c: (c) => folderChanged(c, 0x2048, 0x214c, 0x2e104, 0x6c, 0x64, 'cur_Photo_cnt_foreground'),
  0x40: (c) => folderChanged(c, 0x2354, 0x2250, 0x2e110, 0x70, 0x68, 'cur_Photo_cnt_background'),
  0x5c: countFiles,
  0x6c: (c) => folderNode(c, 0x2e104), 0x70: (c) => folderNode(c, 0x2e110),
  // vt+0x64 0x1002dd20 / vt+0x68 0x1002e130: the sub-folder walks (FindFirstFileA "path\*", a node per directory);
  // the port's folder has none
  0x64: () => 0, 0x68: () => 0,
  0x74: (c) => seekPhoto(c, 0x2e104, 0x2038, 0x1002df11), 0x78: (c) => seekPhoto(c, 0x2e110, 0x2650, 0x1002e321),
  0x28: findPhoto, 0x2c: findBackground, 0x38: folderDialog,
  0x34: loadLogo, 0x44: loadPhoto, 0x48: loadBackground,
  0xf0: plainBackground, 0xf4: backgroundTimer, 0xf8: dressPhoto, 0xfc: photoEdge,
  0x2d8: canvasDefault, 0x2e0: canvasWindow,
});
