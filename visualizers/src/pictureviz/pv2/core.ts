// PictureViz_II ("Picture It! Visualization 2", PictureViz_II.dll, CLSID {5C95CA51-C282-4540-B4D4-5C6A897DDC32}):
// the engine object and its host side. Built on the Averett engine framework Musical Colors uses (layer
// records of 0x7b ints from obj+0x211c, transform records of 0x38 ints from obj+0x185c), with the picture
// loading, frames, drop shadows and 26 transitions on top.
//
// VAs are the gallery build's (1.0.0.5, image base 0x10000000); the Winter Edition (1.0.0.1) is the same
// engine with a few differences, marked `winter` where they are.
//
// Arithmetic: the x87 runs at 53-bit precision (control word 0x027F in the host process), so FMUL/FDIV/FADD
// are JS double operations; `FSTP float` is Math.fround; the CRT's _ftol (0x1002a3f8) is ftol().
import { A } from '../../ns';
import '../../rand';
import { Mem, ftol, fr } from './mem';
import { vt, def } from './vt';
import type { Picture } from '../picture';

/** What the DLL gets from Windows: the clock, the "folder" of pictures and GDI+'s picture scaling. */
export interface Env {
  /** timeGetTime(): milliseconds, wraps at 2^32 */
  tick(): number;
  /** the pictures, in the order the DLL would list the folder's files */
  pictures: Picture[];
  /** GDI+: the picture drawn with HighQualityBicubic into a dw x dh 32bppPARGB bitmap at (dx, dy) and read
   *  back as 32bppARGB; returns the bw x bh bitmap as 0x00RRGGBB, top-down. (The foreground loader draws at
   *  0,0 into a bitmap of exactly dw x dh; the background loader into the window-sized bitmap, centred.) */
  scale(pic: Picture, dx: number, dy: number, dw: number, dh: number, bw: number, bh: number): Uint32Array;
}

export class Core {
  declare m: Mem;
  declare env: Env;
  /** the DC the DLL draws into (Render's HDC): dcW x dcH, 0x00RRGGBB, persistent between frames */
  declare dc: Uint32Array;
  declare dcW: number;
  declare dcH: number;
  /** the Winter Edition (1.0.0.1) instead of the gallery build (1.0.0.5) */
  declare winter: boolean;
  /** string fields of the object (folder names), by byte offset */
  declare str: Map<number, string>;
  /** HKCU\Software\Microsoft\MediaPlayer\PictureViz_II */
  declare reg: Map<string, number | string>;
  /** what srand(time(NULL)) gets on the first Render */
  declare seedVal: number;
  /** the picture the folder search stopped at (index into env.pictures), for the loaders */
  declare found: number;
  /** test hook: intermediate pixel buffers (the drop shadow's GDI+ bitmaps), or null */
  declare dbg: ((tag: string, px: Uint32Array, w: number, h: number) => void) | null;

  constructor(env: Env, folder: string, winter?: boolean) {
    this.m = new Mem(32 << 20);
    this.env = env;
    this.dcW = this.dcH = 0;
    this.dc = new Uint32Array(0);
    this.str = new Map();
    this.winter = !!winter;
    this.reg = firstRunRegistry(folder, this.winter);
    this.seedVal = 1;
    this.found = 0;
    this.dbg = null;
    construct(this);
  }
}

/** byte delta of the current layer's record (layer obj+0x6214; records of 0x1ec bytes from obj+0x211c):
 *  field `off` (as layer 0 has it) of the current layer is I[(off + lb(c)) >> 2] */
export function lb(c: Core): number { return c.m.I[0x6214 >> 2] * 0x1ec; }
/** byte delta of the current layer's transform record (records of 0xe0 bytes from obj+0x185c) */
export function xb(c: Core): number { return c.m.I[0x6214 >> 2] * 0xe0; }
/** timeGetTime() */
export function tick(c: Core): number { return c.env.tick() | 0; }

const E_FAIL = 0x80004005 | 0;

// ------------------------------------------------------------------------------------------------ registry
// The settings live in HKCU\Software\Microsoft\MediaPlayer\PictureViz_II, read (and partly rewritten) every
// frame by 0x100162e0. The port keeps the key as a map with what the DLL writes on its first run, and the DLL's
// own reads and writes go through it, so the per-frame side effects (the "New_..." / "Reload_..." flags the
// options dialog sets, written back to 0) behave as in the DLL.
function regQ(c: Core, name: string, field: number): boolean {
  const v = c.reg.get(name);
  if (v === undefined) return false;
  if (typeof v === 'number') c.m.I[field >> 2] = v; else c.str.set(field, v);
  return true;
}
function regSet(c: Core, name: string, v: number | string): void { c.reg.set(name, v); }

/** What 0x100162e0 writes when its key is absent (its first run), except the two folders, which name the
 *  pictures the app hands over. */
export function firstRunRegistry(folder: string, winter?: boolean): Map<string, number | string> {
  const r = new Map<string, number | string>();
  const both = (n: string, v: number | string) => { r.set(n, v); r.set('temp_' + n, v); };
  r.set('Display_this_photo_1st', 1);
  r.set('Display_this_photo_in_Bkg_1st', 1);
  r.set('How_often_should_picture_be_changed', 2);
  r.set('How_big_should_picture_be', 0x5a);
  r.set('Randomize_picture', 0);
  r.set('New_folder_selected', 1);
  both('Use_pictures_in_this_folder', folder);
  r.set('DirPath_last', folder);
  r.set('Cur_edit_box', folder);
  both('Bkg_picture_in_this_folder', folder);
  r.set('Use_temp_Show_effects', 0);
  r.set('Use_temp_values_for_Bkg', 0);
  both('Flag_Show_Bkg', 0);
  both('Flag_Show_Bkg_photo', 1);
  both('Flag_to_show_Photo_Edge', 1);
  both('Flag_Show_Photo_drop_shadow', 1);
  both('Number_of_Bkg_photos_selected', 0);
  both('Selected_Bkg_photo_1', 0);
  both('How_often_should_Bkg_picture_be_changed', 0x3c);
  both('Randomize_picture_for_Bkg', 0);
  r.set('Reload_current_Bkg_Photo', 0);
  both('Photo_Edge_Size', 8);
  both('Photo_Edge_Transparency', 7);
  both('Photo_Edge_Special_Mix', 0x54);
  both('How_Much_Photo_Edge_Tint', 0x3a);
  both('Flag_Photo_Edge_normal_flat', 0);
  both('Photo_Edge_Color_1', winter ? 0xff0000 : 0xff);        // the Winter Edition's frame is red
  both('Drop_shadow_Color', 0);
  both('Drop_shadow_Transparency', 0xff);
  both('Drop_shadow_Edge_width', 0x10);
  both('Drop_shadow_Edge_Transparency', 0);
  both('Drop_shadow_horz', 0x41);
  both('Drop_shadow_vert', 0x3f);
  for (let i = 1; i <= 26; i++) both('Chk_PicII_transition_' + i, 0);
  both('Chk_PicII_Favorite_Randomize', 0);
  r.set('Photo_delay', 0);
  r.set('Photo_cnt', 1);
  return r;
}

// ------------------------------------------------------------------------------------------------ the object
/** CreateInstance's constructor 0x1001c490 (+ the base at obj+4, 0x10015540): the fields it sets to non-zero
 *  values (the rest of the 0x6b20-byte block is zero: the A/B host zero-fills HeapAlloc, as a fresh process
 *  heap mostly is). */
export function construct(c: Core): void {
  const I = c.m.I;
  I[0xa0 >> 2] = 0xff;
  I[0x1840 >> 2] = 1;
  I[0x6308 >> 2] = 1;
  I[0x63b8 >> 2] = 0x18;           // the frame rate before the first transition step sets 11
  I[0x70 >> 2] = 4;                // base: pointer to itself (obj+4)
  I[0x74 >> 2] = 1;
  I[0x7c >> 2] = 0x280;
  I[0x80 >> 2] = 0x1e0;
}

/** IWMPEffects::SetCurrentPreset 0x1001d400 (this = obj+0x98). Presets 0..4 are the selection modes 1..5
 *  (Favorites, Random Basic / Geometric / Particle / All), 5..30 set the transition id n + 1 directly. */
export function setPreset(c: Core, n: number): boolean {
  if (n < 0 || n >= 0x1f) return false;
  const I = c.m.I, k = n + 1;
  if (k <= 5) {
    I[0x6554 >> 2] = 0;
    I[0x6550 >> 2] = k;
    I[0x62ec >> 2] = 0;
    I[0x65ac >> 2] = 6;
  } else {
    I[0x6550 >> 2] = 0;
    I[0x65ac >> 2] = k;
  }
  I[0xa4 >> 2] = n;
  return true;
}

/** IWMPEffects::Render 0x1001c6f0 (this = obj+0x98; the field offsets below are the object's). The window is
 *  w x h (the rect is 0-based: RenderWindowed's GetClientRect, or the A/B host's DIB). The TimedLevel goes to
 *  the selector 0x1001c8f0, which never reads it: the visualization does not respond to the sound. */
export function render(c: Core, w: number, h: number): void {
  const m = c.m;
  if (w !== c.dcW || h !== c.dcH) {
    c.dc = new Uint32Array(w * h);         // a fresh DIB is black
    c.dcW = w; c.dcH = h;
  }
  let I = m.I;
  I[0x61b8 >> 2] = 32;                     // GetDeviceCaps(hdc, BITSPIXEL)
  I[0x6998 >> 2] = 0;
  let now: number;
  if (I[0x638c >> 2] === 0) {
    now = tick(c);
    I[0x638c >> 2] = now;
  } else {
    now = tick(c);
    // frame limiter: the picture logic runs at most obj+0x63b8 times a second (11 once it has run once);
    // the compositor still runs every call
    if (((now - I[0x638c >> 2]) >>> 0) < (((1000 / I[0x63b8 >> 2]) | 0) >>> 0)) I[0x6998 >> 2] = 1;
    else I[0x638c >> 2] = tick(c);
  }
  I[0x62f4 >> 2] = 0;
  I[0x63a4 >> 2] = 1;                      // the HDC
  vt(c, 0xf4);                             // settings 0x100162e0
  if (!c.winter) {                         // (the Winter Edition counts its folders in the searches instead)
    vt(c, 0x30);                           // picture folder 0x1001bc40
    vt(c, 0x34);                           // background folder 0x1001c070
  }
  I = m.I;
  if (I[0x62dc >> 2] === 0) {
    vt(c, 0x23c);                          // init 0x10021910
    vt(c, 0xf8);                           // 0x10016220
    I = m.I;
    I[0x62dc >> 2] = 1;
    I[0x6590 >> 2] = 0x15e;
    I[0x6598 >> 2] = 0x140;
    I[0x6408 >> 2] = 0x15e;
    I[0x640c >> 2] = 0x140;
    I[0x65b4 >> 2] = 0x100;
    I[0x65b8 >> 2] = 0x100;
    m.F[0x61dc >> 2] = (I[0x6590 >> 2] / 2) | 0;
    A.srand(c.seedVal);                    // srand(time(NULL))
    vt(c, 0x204);                          // 0x10021d60
    vt(c, 0x20c);                          // scene 0x10021e70
    vt(c, 0x208);                          // trig tables 0x100222a0
    I = m.I;
    I[0x6348 >> 2] = 1;                    // GetForegroundWindow(): never read
  }
  I[0x65e4 >> 2] = 0;
  I[0x65bc >> 2] = 0;                      // rect.left, rect.top
  I[0x65c0 >> 2] = 0;
  if (I[0x6408 >> 2] !== w || I[0x640c >> 2] !== h) {
    I[0x6458 >> 2] = 1;
    I[0x655c >> 2] = 0;
    I[0x640c >> 2] = h;
    I[0x6408 >> 2] = w;
  } else I[0x6458 >> 2] = 0;
  if (I[0x655c >> 2] > 0xf) { I[0x655c >> 2] = 0; I[0x6458 >> 2] = 1; } else I[0x655c >> 2]++;
  vt(c, 0x2ec);                            // the selector 0x1001c8f0
}

// ------------------------------------------------------------------------------------------------ settings
/** E+0xf4 0x100162e0: the settings, every frame (see regQ). */
function settings(c: Core): number {
  let I = c.m.I;
  I[0x634 >> 2] = 0; I[0x638 >> 2] = 0; I[0x63c >> 2] = 0; I[0x640 >> 2] = 1;
  I[0x654 >> 2] = 1; I[0x644 >> 2] = 1;
  I[0x6a8 >> 2] = 0; I[0x6ac >> 2] = 0; I[0x6b0 >> 2] = 0;
  I[0x6bc >> 2] = 0x3c; I[0x6c0 >> 2] = 0;
  I[0x65c >> 2] = 8; I[0x660 >> 2] = 7; I[0x664 >> 2] = 0x54; I[0x66c >> 2] = 0x3a; I[0x670 >> 2] = 0;
  I[0x668 >> 2] = c.winter ? 0xff0000 : 0xff; I[0x678 >> 2] = 0; I[0x67c >> 2] = 0xff; I[0x680 >> 2] = 0x10; I[0x684 >> 2] = 0;   // edge colour: blue; the Winter Edition's red
  I[0x688 >> 2] = 0x41; I[0x68c >> 2] = 0x3f;
  I[0x610 >> 2] = 0; I[0x618 >> 2] = 0; I[0x6a0 >> 2] = 0; I[0x6a4 >> 2] = 1;
  for (let a = 0x6d0; a <= 0x738; a += 4) I[a >> 2] = 0;
  // RegOpenKeyEx: the key exists from the first frame on (the port's map is never empty)
  regQ(c, 'Reload_current_Photo', 0x62c);
  regQ(c, 'New_Bkg_effect', 0x648);
  regQ(c, 'Reload_current_Bkg_Photo', 0x630);
  if (I[0x62c >> 2] === 1) regQ(c, 'Display_this_photo', 0xc8); else regSet(c, 'Display_this_photo', I[0xc8 >> 2]);
  if (I[0x648 >> 2] === 1) regQ(c, 'Display_this_photo_in_Bkg', 0x6b4); else regSet(c, 'Display_this_photo_in_Bkg', I[0x6b4 >> 2]);
  if (!regQ(c, 'Use_temp_size_and_duration_etc', 0x628)) I[0x628 >> 2] = 0;
  if (!regQ(c, 'New_folder_selected', 0x618)) I[0x62c >> 2] = 0;
  I[0x694c >> 2] = 0;
  regSet(c, 'New_folder_selected', 0);
  const t = I[0x628 >> 2] === 0 ? '' : 'temp_';
  regQ(c, t + 'Use_pictures_in_this_folder', 0xd4);
  if (!regQ(c, t + 'How_often_should_picture_be_changed', 0x1838)) I[0x1838 >> 2] = 2;
  if (!regQ(c, t + 'How_big_should_picture_be', 0x183c)) I[0x183c >> 2] = 0x5a;
  regQ(c, t + 'Randomize_picture', 0x610);
  if (I[0x62c >> 2] === 1) {
    I[0x69b0 >> 2] = 3; I[0x60c >> 2] = 1; I[0x614 >> 2] = 0; I[0x6554 >> 2] = 0; I[0x62c >> 2] = 0;
    regSet(c, 'Reload_current_Photo', 0);
  }
  if ((I[0x1838 >> 2] >>> 0) > 600) { I[0x1838 >> 2] = 2; regSet(c, 'How_often_should_picture_be_changed', 2); }
  if ((I[0x183c >> 2] >>> 0) > 100) { I[0x183c >> 2] = 0x5a; regSet(c, 'How_big_should_picture_be', 0x5a); }
  if ((I[0x610 >> 2] >>> 0) > 1) I[0x610 >> 2] = 0;
  regQ(c, 'Use_temp_Show_effects', 0x634);
  if (I[0x634 >> 2] === 0) {
    regQ(c, 'Flag_Show_Bkg', 0x63c); regQ(c, 'Flag_Show_Bkg_photo', 0x640);
    regQ(c, 'Flag_to_show_Photo_Edge', 0x654); regQ(c, 'Flag_Show_Photo_drop_shadow', 0x644);
  } else {
    regQ(c, 'temp_Flag_Show_Bkg', 0x63c); regQ(c, 'temp_Flag_Show_Bkg_photo', 0x640);
    regQ(c, 'temp_Flag_to_show_Photo_Edge', 0x654); regQ(c, 'temp_Flag_Show_Photo_drop_shadow', 0x644);
    I[0x694c >> 2] = 1;
    regSet(c, 'Use_temp_Show_effects', 1);
  }
  regQ(c, 'New_Bkg_effect', 0x648);
  regQ(c, 'Use_temp_values_for_Bkg', 0x6a8);
  const b = I[0x6a8 >> 2] === 0 ? '' : 'temp_';
  regQ(c, b + 'Bkg_picture_in_this_folder', 0x3e0);
  regQ(c, b + 'Flag_Show_Bkg_photo', 0x640);
  regQ(c, b + 'Selected_Bkg_photo_1', 0x6b0);
  regQ(c, b + 'Number_of_Bkg_photos_selected', 0x6ac);
  regQ(c, b + 'How_often_should_Bkg_picture_be_changed', 0x6bc);
  regQ(c, b + 'Randomize_picture_for_Bkg', 0x6c0);
  I[0x694c >> 2] = 0;
  regSet(c, 'New_Bkg_effect', 0);
  if (I[0x630 >> 2] === 1) regSet(c, 'Reload_current_Bkg_Photo', 0);
  regQ(c, 'New_Photo_Edge_effect', 0x658);
  const e = I[0x658 >> 2] < 2 ? '' : 'temp_';
  regQ(c, e + 'Photo_Edge_Color_1', 0x668); regQ(c, e + 'Photo_Edge_Size', 0x65c);
  regQ(c, e + 'Photo_Edge_Transparency', 0x660); regQ(c, e + 'Photo_Edge_Special_Mix', 0x664);
  regQ(c, e + 'How_Much_Photo_Edge_Tint', 0x66c); regQ(c, e + 'Flag_Photo_Edge_normal_flat', 0x670);
  I[0x694c >> 2] = e ? 3 : 0;
  regSet(c, 'New_Photo_Edge_effect', I[0x694c >> 2]);
  regQ(c, 'New_Drop_shadow_effect', 0x674);
  const d = I[0x674 >> 2] < 2 ? '' : 'temp_';
  regQ(c, d + 'Drop_shadow_Color', 0x678); regQ(c, d + 'Drop_shadow_Transparency', 0x67c);
  regQ(c, d + 'Drop_shadow_Edge_width', 0x680); regQ(c, d + 'Drop_shadow_Edge_Transparency', 0x684);
  regQ(c, d + 'Drop_shadow_horz', 0x688); regQ(c, d + 'Drop_shadow_vert', 0x68c);
  I[0x694c >> 2] = d ? 3 : 0;
  regSet(c, 'New_Drop_shadow_effect', I[0x694c >> 2]);
  regQ(c, 'Use_temp_Transition_effects', 0x638);
  const x = I[0x638 >> 2] === 0 ? '' : 'temp_';
  for (let i = 1; i <= 26; i++) regQ(c, x + 'Chk_PicII_transition_' + i, 0x6d0 + (i - 1) * 4);
  regQ(c, x + 'Chk_PicII_Favorite_Randomize', 0x738);
  I = c.m.I;
  const pe = I[0x658 >> 2];
  if (I[0x62c >> 2] === 1 || I[0x648 >> 2] !== 0 || I[0x674 >> 2] === 2 || I[0x674 >> 2] === 1 || pe === 2 || pe === 1 ||
      I[0x634 >> 2] === 2) {
    I[0x69b0 >> 2] = 3; I[0x60c >> 2] = 1; I[0x614 >> 2] = 0;
  }
  return 0;
}

/** E+0xf8 0x10016220: the first photo indexes (a failed read writes obj+0xcc, not 0xc8: the DLL's slip). */
function photoFirst(c: Core): number {
  const I = c.m.I;
  I[0x630 >> 2] = 0;
  if (!regQ(c, 'Display_this_photo_1st', 0xc8)) I[0xcc >> 2] = 1;
  if (!regQ(c, 'Display_this_photo_in_Bkg_1st', 0x6b4)) I[0x6b4 >> 2] = 1;
  return 0;
}

// ------------------------------------------------------------------------------------------------ the folders
// The DLL lists its folders with FindFirstFileA over *.tga, *.jpg, *.png, *.bmp, *.tif, *.exif (and walks the
// sub-folders). The port's folder is the picture list: no sub-folders, every file found by the *.jpg pass
// (the order within one pass is the list's order). A folder name change in the registry makes the DLL count
// the pictures again; setPictures() does that.

/** E+0x50 0x1001a7a0: count the pictures of the current folder into obj+0x61c */
function countFiles(c: Core): number {
  c.m.I[0x61c >> 2] = c.env.pictures.length;
  return 0;
}
/** E+0x60 0x1001bdb0 / E+0x64 0x1001c1d0: a folder node (0x110 bytes: name, +0x104 count, +0x108 visited,
 *  +0x10c next) pushed on the list at obj+head; nodes / total at head+4 / head+8 */
function folderNode(c: Core, head: number): number {
  const p = c.m.malloc(0x110), I = c.m.I;
  I[(p + 0x10c) >> 2] = I[head >> 2];
  I[(head + 4) >> 2]++;
  I[head >> 2] = p;
  I[(head + 8) >> 2] += I[0x61c >> 2];
  I[(p + 0x108) >> 2] = 0;
  I[(p + 0x104) >> 2] = I[0x61c >> 2];
  return 0;
}
/** E+0x30 0x1001bc40 / E+0x34 0x1001c070: when the folder name changed, count its pictures again
 *  (cur_Photo_cnt_foreground / _background) */
function scanFolder(c: Core, cur: number, last: number, head: number, regName: string): number {
  const name = c.str.get(cur) ?? '';
  if ((c.str.get(last) ?? '') === name) return 0;      // lstrcmpA
  c.str.set(last, name);
  let I = c.m.I;
  let p = I[head >> 2];
  while (p !== 0) {
    I[head >> 2] = I[(p + 0x10c) >> 2];
    c.m.release(p);
    p = I[head >> 2];
  }
  I[(head + 4) >> 2] = 0;
  I[(head + 8) >> 2] = 0;
  countFiles(c);
  folderNode(c, head);
  I = c.m.I;
  for (p = I[head >> 2]; p !== 0; p = I[(p + 0x10c) >> 2]) I[(p + 0x108) >> 2] = 1;   // no sub-folders to walk
  regSet(c, regName, I[(head + 8) >> 2]);
  return 0;
}
/** E+0x68 0x1001bfc0 / E+0x6c 0x1001c3e0: which node holds photo number obj+idx; obj+0xc0 = its index there */
function seekPhoto(c: Core, head: number, idx: number): number {
  const I = c.m.I;
  let p = I[head >> 2];
  I[0xc0 >> 2] = I[(head + 8) >> 2] - I[idx >> 2];
  if (p === 0) return 0;
  for (;;) {
    if (I[0xc0 >> 2] < I[(p + 0x104) >> 2]) break;
    I[0xc0 >> 2] -= I[(p + 0x104) >> 2];
    p = I[(p + 0x10c) >> 2];
    if (p === 0) return 0;
  }
  I[0xc0 >> 2] = I[(p + 0x104) >> 2] - I[0xc0 >> 2];
  return 0;
}
/** The pattern loop of 0x10019e90 / 0x1001a1d0: FindFirstFileA / FindNextFileA over the six patterns from
 *  *.jpg on, counting files in obj+0x69c until it reaches obj+0xc0; then the loader. Every picture is
 *  found by the *.jpg pass. */
function findAndLoad(c: Core, passField: number, load: number): number {
  let I = c.m.I;
  const n = c.env.pictures.length;
  I[passField >> 2] = 1;
  if (n > 0) {
    for (let k = 0; k < n; k++) {
      I[0x69c >> 2]++;
      if (I[0xc0 >> 2] === I[0x69c >> 2]) {
        c.found = k;
        vt(c, load);
        return 0;
      }
    }
  }
  I = c.m.I;
  I[passField >> 2] = 6;
  return E_FAIL;
}
/** E+0x2c 0x100070e0: the folder dialog (SHBrowseForFolder), shown when the folder holds no picture; the
 *  port's host has no dialog: as when it is cancelled. */
function folderDialog(c: Core): number {
  const I = c.m.I;
  if (I[0xd0 >> 2] === 4 || I[0xd0 >> 2] === 0) {
    for (let a = 0x73c; a < 0x75c; a += 4) I[a >> 2] = 0;
    I[0x74c >> 2] = 0x1055;
    I[0x75c >> 2] = 0;
    I[0xd0 >> 2] = 2;
  }
  return 0;
}

/** The Winter Edition's E+0x24 (its 0x10019e80): counts the folder every time (from *.tga on; here the field
 *  0x61c stands for its count), steps the photo number without the gallery build's Reload_current_Photo gate,
 *  and searches from *.tga on, comparing the count with the photo number directly */
function findPhotoWinter(c: Core): number {
  let I = c.m.I;
  I[0x62c4 >> 2] = 0;
  I[0x69c >> 2] = 0;
  if (I[0x618 >> 2] === 1) {
    I[0x618 >> 2] = 0; I[0xc8 >> 2] = 1; I[0x69c >> 2] = 0; I[0x60c >> 2] = 1; I[0x653c >> 2] = 0;
    I[0x5f8 >> 2] = tick(c);
  }
  countFiles(c);
  if (I[0x61c >> 2] === 0) { vt(c, 0x2c); I = c.m.I; }
  if (I[0x69b0 >> 2] !== 3) {
    const n = I[0x61c >> 2];
    if (n < 3 || I[0x610 >> 2] === 0) {
      const a = I[0xc8 >> 2];
      I[0xc8 >> 2] = a + 1;
      if (n < a + 1) I[0xc8 >> 2] = 1;
    } else randomStep(c, 0xc8, 0x653c, 0x6548, 0x61c, n, I[0x653c >> 2] !== 0);
  }
  I = c.m.I;
  if (I[0x61c >> 2] < I[0xc8 >> 2] || I[0xc8 >> 2] < 1) I[0xc8 >> 2] = 1;
  I[0xc0 >> 2] = I[0xc8 >> 2];               // (the search compares the photo number itself)
  return findAndLoad(c, 0x62c4, 0x38);
}

/** The Winter Edition's E+0x28 (its 0x1001a1e0): counts the background folder every time; Number_of_Bkg_photos
 *  _selected is zeroed when stepping, Reload_current_Bkg_Photo skips one step instead of marking one */
function findBackgroundWinter(c: Core): number {
  let I = c.m.I;
  countFiles(c);
  const n = I[0x61c >> 2];
  if (n === 0) return findBackgroundPlain(c);
  if (n < 3 || I[0x6c0 >> 2] === 0) {
    I[0x6ac >> 2] = 0;
    if (I[0x630 >> 2] === 0) I[0x6b4 >> 2]++; else I[0x630 >> 2] = 0;
    if (n < I[0x6b4 >> 2] || I[0x6b4 >> 2] < 1) I[0x6b4 >> 2] = 1;
  } else randomStep(c, 0x6b4, 0x6540, 0x654c, 0x61c, n, I[0x6540 >> 2] !== 0);
  I = c.m.I;
  I[0x69c >> 2] = 0;
  I[0xc0 >> 2] = I[0x6ac >> 2] === 0 ? I[0x6b4 >> 2] : I[0x6b0 >> 2];
  return findAndLoad(c, 0x62c8, 0x3c);
}

/** E+0x24 0x10019e90: the next foreground picture (obj+0xc8, 1-based) into layer 4 */
function findPhoto(c: Core): number {
  if (c.winter) return findPhotoWinter(c);
  let I = c.m.I;
  I[0x62c4 >> 2] = 0;
  I[0x69c >> 2] = 0;
  if (I[0x618 >> 2] === 1) {
    I[0x618 >> 2] = 0; I[0xc8 >> 2] = 1; I[0x69c >> 2] = 0; I[0x60c >> 2] = 1; I[0x653c >> 2] = 0;
    I[0x5f8 >> 2] = tick(c);
  }
  if (I[0xb0 >> 2] === 0) { vt(c, 0x2c); I = c.m.I; }
  if (I[0x69b0 >> 2] !== 3 && I[0x62c >> 2] !== 1) {
    let n = I[0xb0 >> 2];
    I[0x62c >> 2] = 1;
    if (n < 3 || I[0x610 >> 2] === 0) {
      const a = I[0xc8 >> 2];
      I[0xc8 >> 2] = a + 1;
      if (n < a + 1) I[0xc8 >> 2] = 1;
    } else randomStep(c, 0xc8, 0x653c, 0x6548, 0xb0, n, I[0x653c >> 2] !== 0);
  }
  I = c.m.I;
  if (I[0xb0 >> 2] < I[0xc8 >> 2] || I[0xc8 >> 2] < 1) I[0xc8 >> 2] = 1;
  vt(c, 0x68);
  return findAndLoad(c, 0x62c4, 0x38);
}
/** Randomize_picture's walk (0x10019f61.. / 0x1001a407..): jumps of a random stride, restarted at random */
function randomStep(c: Core, idx: number, runs: number, stride: number, count: number, n: number, inRun: boolean): void {
  const I = c.m.I;
  for (;;) {
    if (inRun) {
      const a = I[idx >> 2];
      n = I[count >> 2];
      I[idx >> 2] = a + I[stride >> 2];
      if (a + I[stride >> 2] <= n) return;
      const r = I[runs >> 2];
      I[idx >> 2] = 1;
      I[0x62c4 >> 2] = 0;
      I[runs >> 2] = r - 1;
      if (r - 1 !== 0) { I[idx >> 2] = r; return; }
      I[0x62c4 >> 2] = 0;
      I[0x69c >> 2] = 0;
    }
    if (n < 2) I[runs >> 2] = 1;
    else if (n < 0xb) I[runs >> 2] = (A.rand() & 3) + 1;
    else if (n < 0x1f) I[runs >> 2] = (A.rand() & 7) + 3;
    else I[runs >> 2] = (A.rand() & 0xf) + 7;
    I[stride >> 2] = I[runs >> 2];
    if ((A.rand() & 0x10) === 0) { I[idx >> 2] = 1; return; }
    I[idx >> 2] = 0;
    inRun = true;
  }
}

/** E+0x28 0x1001a1d0: the next background picture (obj+0x6b4) into the current layer (6), or a plain
 *  background of colour obj+0x61bc when the background folder holds none */
function findBackground(c: Core): number {
  if (c.winter) return findBackgroundWinter(c);
  let I = c.m.I;
  const n = I[0xbc >> 2];
  if (n === 0) return findBackgroundPlain(c);
  if (I[0x630 >> 2] === 1 || n < 3 || I[0x6c0 >> 2] === 0) {
    if (I[0x630 >> 2] === 0) { I[0x630 >> 2] = 1; I[0x6b4 >> 2]++; }
    if (n < I[0x6b4 >> 2] || I[0x6b4 >> 2] < 1) I[0x6b4 >> 2] = 1;
  } else {
    I[0x630 >> 2] = 1;
    randomStep(c, 0x6b4, 0x6540, 0x654c, 0xbc, n, I[0x6540 >> 2] !== 0);
  }
  vt(c, 0x6c);
  I = c.m.I;
  I[0x69c >> 2] = 0;
  return findAndLoad(c, 0x62c8, 0x3c);
}
/** 0x1001a1d0's empty-folder path: a window-sized image of colour obj+0x61bc */
function findBackgroundPlain(c: Core): number {
  let I = c.m.I;
  {
    I[0x64c >> 2] = I[0x6408 >> 2];
    I[0x650 >> 2] = I[0x640c >> 2];
    vt(c, 0x1b0);
    I = c.m.I;
    const cnt = I[0x650 >> 2] * I[0x64c >> 2];
    I[0x69a0 >> 2] = cnt;
    const p = c.m.malloc(cnt * 4 + 0xc);
    I = c.m.I;
    I[0x6400 >> 2] = p;
    I[p >> 2] = I[0x64c >> 2];
    I[(p + 4) >> 2] = I[0x650 >> 2];
    I[(p + 8) >> 2] = 0;
    const img = p + 0xc;
    I[0x67a8 >> 2] = img;
    I[0x634c >> 2] = 0;
    const col = I[0x61bc >> 2];
    let k = 0;
    do { I[(img >> 2) + k] = col; k++; } while (k < cnt);
    I[0x6118 >> 2] = img + k * 4;
    I[0x634c >> 2] = k;
    const l = lb(c);
    I[(0x2120 + l) >> 2] = -1;
    I[(0x21a4 + l) >> 2] = I[0x64c >> 2];
    I[(0x21a8 + l) >> 2] = I[0x650 >> 2];
    I[(0x2178 + l) >> 2] = I[0x64c >> 2];
    I[(0x217c + l) >> 2] = I[0x650 >> 2];
    I[(0x2144 + l) >> 2] = img;
    if (I[(0x212c + l) >> 2] === 0) I[(0x212c + l) >> 2] = 2;
    I[0x6400 >> 2] = 0;
    return 0;
  }
}

// ------------------------------------------------------------------------------------------------ loading
/** E+0x10c 0x10023770: the picture's size on screen (obj+0x64c x obj+0x650) and the layer's offset. The
 *  background (layer 6, Flag_Show_Bkg_photo) covers the window keeping its aspect; a picture fills
 *  How_big_should_picture_be percent of it. */
function fitSize(c: Core): number {
  const I = c.m.I, F = c.m.F, L = I[0x6214 >> 2], l = L * 0x1ec;
  const imgW = I[0x672c >> 2], imgH = I[0x6718 >> 2];
  if (L === 6 && I[0x640 >> 2] !== 0) {
    const W = I[0x6408 >> 2], H = I[0x640c >> 2];
    I[0x64c >> 2] = W;
    let fh = ftol(W * imgH / imgW);
    I[0x650 >> 2] = fh;
    if (fh < H) {
      I[0x650 >> 2] = H;
      I[0x64c >> 2] = ftol(H * imgW / imgH);
    }
    I[(0x2198 + l) >> 2] = 0;
    return 0;
  }
  const s = I[0x183c >> 2] * 0.01;          // double on the x87 stack; the stores round it
  F[0x64d0 >> 2] = s;
  F[0x64d4 >> 2] = s;
  const W = I[0x6590 >> 2];
  const fw = ftol(W * s);
  I[0x64c >> 2] = fw;
  const hf = fr(imgH), wf = fr(imgW);
  const fh = ftol(fw * hf / wf);
  I[0x650 >> 2] = fh;
  const hmax = ftol(I[0x6598 >> 2] * s);
  if (fh > hmax) {
    I[0x650 >> 2] = hmax;
    I[0x64c >> 2] = ftol(hmax * wf / hf);
  }
  I[(0x2198 + l) >> 2] = ((W - I[0x64c >> 2]) / 2) | 0;
  I[(0x21b8 + l) >> 2] = -(((I[0x6598 >> 2] - I[0x650 >> 2]) / 2) | 0);
  if (I[0x64c >> 2] < 0x10 || I[0x650 >> 2] < 0x10) { I[0x64c >> 2] = 0x10; I[0x650 >> 2] = 0x10; }
  return 0;
}

/** The image block the loaders malloc: [w, h, 0] then w*h pixels; returns the pixel address, 0 if out of
 *  memory (then obj+0x62f4 = 1). obj+0x6400 = the block, obj+0x67a8 = the pixels, 0x611c = their end. */
function imageBlock(c: Core): number {
  const I0 = c.m.I;
  const n = I0[0x64c >> 2] * I0[0x650 >> 2];
  I0[0x69a0 >> 2] = n;
  const p = c.m.malloc(n * 4 + 0xc);
  const I = c.m.I;
  I[0x6400 >> 2] = p;
  I[0x6118 >> 2] = p;
  I[p >> 2] = I[0x64c >> 2];
  I[(p + 4) >> 2] = I[0x650 >> 2];
  I[(p + 8) >> 2] = 0;
  const img = p + 0xc;
  I[0x6118 >> 2] = img;
  I[0x67a8 >> 2] = img;
  I[0x611c >> 2] = img + n * 4;
  return img;
}
function bindImage(c: Core, img: number, w: number, h: number): void {
  const I = c.m.I, l = lb(c);
  I[(0x2120 + l) >> 2] = -1;
  I[(0x21a4 + l) >> 2] = w;
  I[(0x21a8 + l) >> 2] = h;
  I[(0x2178 + l) >> 2] = w;
  I[(0x217c + l) >> 2] = h;
  I[(0x2144 + l) >> 2] = img;
  if (I[(0x212c + l) >> 2] === 0) I[(0x212c + l) >> 2] = 2;
  I[0x6400 >> 2] = 0;
}

/** E+0x38 0x1001b1e0: load the found picture as the current layer's image: GDI+ draws it (HighQualityBicubic)
 *  into a 32bppPARGB bitmap of the fitted size, read back as 32bppARGB, alpha dropped, rows stored bottom-up */
function loadPhoto(c: Core): number {
  let I = c.m.I;
  I[0x5e8 >> 2] = 1;                       // GdiplusStartup
  const pic = c.env.pictures[c.found];
  I[0x672c >> 2] = pic.w;
  I[0x6718 >> 2] = pic.h;
  if (pic.w * pic.h === 0) return E_FAIL;
  vt(c, 0x10c);
  vt(c, 0x1b0);
  I = c.m.I;
  if (I[0x64c >> 2] * I[0x650 >> 2] === 0) { I[0x69a0 >> 2] = 0; return E_FAIL; }
  const fw = I[0x64c >> 2], fh = I[0x650 >> 2];
  const img = imageBlock(c);
  const px = c.env.scale(pic, 0, 0, fw, fh, fw, fh);
  I = c.m.I;
  I[0x672c >> 2] = fw;
  I[0x6718 >> 2] = fh;
  const end = img + fw * fh * 4;
  for (let r = 0; r < fh; r++) {
    const d = (end - (r + 1) * fw * 4) >> 2;
    for (let x = 0; x < fw; x++) I[d + x] = px[r * fw + x] & 0xffffff;
  }
  I[0x6118 >> 2] = end - fh * fw * 4 + fw * 4;
  I[0x6374 >> 2] = fh;
  I[0x634c >> 2] = fw;
  bindImage(c, img, fw, fh);
  return 0;
}

/** E+0x3c 0x1001b740: load the background picture: GDI+ draws it at its fitted size, centred, into a
 *  window-sized 32bppPARGB bitmap, read back as 32bppARGB, alpha dropped, rows top-down. (The block is sized
 *  for the fitted picture, at least the window.) */
function loadBackground(c: Core): number {
  let I = c.m.I;
  I[0x5e8 >> 2] = 1;
  const pic = c.env.pictures[c.found];
  I[0x672c >> 2] = pic.w;
  I[0x6718 >> 2] = pic.h;
  if (pic.w * pic.h === 0) return E_FAIL;
  vt(c, 0x10c);
  vt(c, 0x1b0);
  I = c.m.I;
  if (I[0x64c >> 2] * I[0x650 >> 2] === 0) { I[0x69a0 >> 2] = 0; return E_FAIL; }
  const fw = I[0x64c >> 2], fh = I[0x650 >> 2];
  const img = imageBlock(c);
  I = c.m.I;
  const bw = I[0x6408 >> 2], bh = I[0x640c >> 2];
  const px = c.env.scale(pic, ((bw - fw) / 2) | 0, ((bh - fh) / 2) | 0, fw, fh, bw, bh);
  I = c.m.I;
  I[0x672c >> 2] = bw;
  I[0x6718 >> 2] = bh;
  const d = img >> 2, n = bw * bh;
  for (let k = 0; k < n; k++) I[d + k] = px[k] & 0xffffff;
  I[0x6118 >> 2] = img + n * 4;
  I[0x6374 >> 2] = n;
  bindImage(c, img, bw, bh);
  return 0;
}

// ------------------------------------------------------------------------------------------------ set-up
/** E+0x23c 0x10021910: clear the layer and transform records and the work tables, defaults */
function init(c: Core): number {
  const I = c.m.I;
  I[0x61b8 >> 2] = 32;
  I[0x6994 >> 2] = 9;
  I[0x63c4 >> 2] = 10;
  for (let k = 0; k <= 9; k++) {
    for (let j = 0; j < 0x7b; j++) I[(0x211c >> 2) + k * 0x7b + j] = 0;
    for (let j = 0; j < 0x38; j++) I[(0x185c >> 2) + k * 0x38 + j] = 0;
  }
  I[0x6214 >> 2] = 10;
  I[0x634c >> 2] = 0x7b;
  I[0x6374 >> 2] = 0x38;
  for (let j = 0; j < 0x14; j++) I[(0x6090 >> 2) + j] = 0;
  for (let j = 0; j < 0x208; j++) I[(0x34d0 >> 2) + j] = 0;
  for (let j = 0; j < 0x208; j++) I[(0x3cf0 >> 2) + j] = 0;
  for (let j = 0; j < 0x208; j++) I[(0x4510 >> 2) + j] = 0;
  for (let j = 0; j < 9; j++) I[(0x3454 >> 2) + j] = 0;
  I[0x634c >> 2] = 9;
  const z = [0x60f0, 0x612c, 0x613c, 0x617c, 0x6180, 0x61c0, 0x61c4, 0x61f0, 0x61f8, 0x61fc, 0x6210, 0x6214, 0x6228,
    0x622c, 0x6230, 0x6234, 0x623c, 0x6240, 0x6244, 0x6254, 0x6264, 0x626c, 0x62c0, 0x62e0, 0x62e4, 0x62ec, 0x62fc,
    0x636c, 0x6368, 0x6370, 0x6380, 0x6384, 0x639c, 0x63e4, 0x63e8, 0x63ec, 0x63f0, 0x63f4, 0x6404, 0x6410, 0x6424,
    0x6450, 0x646c, 0x6470, 0x6474, 0x647c, 0x6584, 0x6588, 0x65d0, 0x65a0, 0x65a4, 0x65a8, 0x65c4, 0x65dc, 0x664c,
    0x6650, 0x6654, 0x6658, 0x6694, 0x6698, 0x669c, 0x66b0, 0x66ac, 0x66b4, 0x6748, 0x67b0, 0x67b4, 0x6978, 0x6974,
    0x697c, 0x69c4, 0x69c8, 0x69cc, 0x6a08, 0x84, 0x8c];
  for (const a of z) I[a >> 2] = 0;
  I[0x61a0 >> 2] = 0xffffff; I[0x6190 >> 2] = 1; I[0x6200 >> 2] = 0xff; I[0x620c >> 2] = 1;
  I[0x6238 >> 2] = 0xff; I[0x6248 >> 2] = 1; I[0x62e8 >> 2] = 1; I[0x6304 >> 2] = 1; I[0x6324 >> 2] = 400;
  I[0x6388 >> 2] = 5; I[0x6394 >> 2] = 2; I[0x63cc >> 2] = 0x13; I[0x63d8 >> 2] = 0x578; I[0x63dc >> 2] = 0x578;
  I[0x6408 >> 2] = 0x15e; I[0x640c >> 2] = 0x140;
  I[0x6500 >> 2] = (I[0x63d0 >> 2] / 2) | 0;
  I[0x6458 >> 2] = 1; I[0x6460 >> 2] = 7;
  I[0x6504 >> 2] = I[0x63d4 >> 2];
  I[0x659c >> 2] = 3; I[0x65b4 >> 2] = 0x100; I[0x65b8 >> 2] = 0x100; I[0x65cc >> 2] = 0x14; I[0x6724 >> 2] = 1;
  I[0x88 >> 2] = tick(c);
  return 0;
}

/** E+0x204 0x10021d60: canvas strides; every layer starts unused */
function strides(c: Core): number {
  const I = c.m.I;
  I[0x63d4 >> 2] = I[0x6598 >> 2] << 2;
  I[0x63d0 >> 2] = I[0x6590 >> 2] << 2;
  let k = 0;
  do { I[(0x211c >> 2) + k * 0x7b] = -1; k++; } while ((k >>> 0) <= (I[0x6994 >> 2] >>> 0));
  I[0x6214 >> 2] = k;
  return 0;
}

/** E+0x1b0 0x10015e80: free the current layer's image (if it owns one) and its work buffers */
function freeLayer(c: Core): number {
  const m = c.m, I = m.I, l = lb(c);
  if (I[(0x2120 + l) >> 2] === -1 && I[(0x2144 + l) >> 2] !== 0) {
    m.release(I[(0x2144 + l) >> 2] - 0xc);
    I[(0x2120 + l) >> 2] = 0;
    I[(0x2144 + l) >> 2] = 0;
  }
  I[(0x21d4 + l) >> 2] = 0;
  for (const f of [0x21dc, 0x21d8, 0x22bc]) {
    if (I[(f + l) >> 2] !== 0) { m.release(I[(f + l) >> 2]); I[(f + l) >> 2] = 0; }
  }
  return 0;
}
/** E+0x1ac 0x10015e40: freeLayer for layers 0..obj+0x6994 */
function freeLayers(c: Core): number {
  const I = c.m.I;
  let k = 0;
  do { I[0x6214 >> 2] = k; vt(c, 0x1b0); k++; } while ((k >>> 0) <= (c.m.I[0x6994 >> 2] >>> 0));
  c.m.I[0x6214 >> 2] = k;
  void I;
  return 0;
}
/** E+0x200 0x10007f70: a layer bound to a table image (not its own, 0x2120 != -1) is switched off;
 *  returns 1 when it was not */
function unbindLayer(c: Core): number {
  const I = c.m.I, l = lb(c);
  const was = I[(0x2120 + l) >> 2] !== -1;
  if (was) { I[(0x211c + l) >> 2] = -1; I[(0x2144 + l) >> 2] = 0; }
  return was ? 0 : 1;
}

/** E+0x20c 0x10021e70: the scene every preset starts from (layers 0..5) */
function scene(c: Core): number {
  vt(c, 0x1ac);
  let I = c.m.I;
  let k = 0;
  do {
    for (let j = 0; j < 0x7b; j++) I[(0x211c >> 2) + k * 0x7b + j] = 0;
    for (let j = 0; j < 0x38; j++) I[(0x185c >> 2) + k * 0x38 + j] = 0;
    k++;
  } while ((k >>> 0) <= (I[0x6994 >> 2] >>> 0));
  I[0x6214 >> 2] = k; I[0x634c >> 2] = 0x7b; I[0x6374 >> 2] = 0x38;
  I[0x69d0 >> 2] = 0x5a; I[0x69c4 >> 2] = 0; I[0x69d4 >> 2] = 0x17d8; I[0x69d8 >> 2] = 0x1989; I[0x69dc >> 2] = -0x13e;
  I[0x6238 >> 2] = 0xff;
  for (const a of [0x622c, 0x6230, 0x6748, 0x6228, 0x6234, 0x623c, 0x6240]) I[a >> 2] = 0;
  for (let j = 0; j < 0x208; j++) I[(0x4d30 >> 2) + j] = 0;
  for (let j = 0; j < 10; j++) I[(0x34a8 >> 2) + j] = 0;
  I[0x69c0 >> 2] = 10;
  // layer 0
  I[0x22c0 >> 2] = -1; I[0x211c >> 2] = 2; I[0x21ac >> 2] = 0x479; I[0x2198 >> 2] = 0x453; I[0x219c >> 2] = -0x1da;
  I[0x21b8 >> 2] = 0; I[0x213c >> 2] = 0; I[0x2140 >> 2] = 1; I[0x2194 >> 2] = 0; I[0x22fc >> 2] = 1; I[0x212c >> 2] = 2;
  I[0x6214 >> 2] = 0; vt(c, 0x200); I = c.m.I;
  // layer 1
  I[0x2308 >> 2] = 2; I[0x2398 >> 2] = 0x58c; I[0x2384 >> 2] = 0x522; I[0x2388 >> 2] = -0x191; I[0x23a4 >> 2] = 0;
  I[0x2328 >> 2] = 0; I[0x232c >> 2] = 4; I[0x2380 >> 2] = -1; I[0x24ac >> 2] = -1; I[0x2318 >> 2] = 2;
  I[0x6214 >> 2] = 1; vt(c, 0x200); I = c.m.I;
  // layer 2
  I[0x24f4 >> 2] = 2; I[0x2698 >> 2] = -1; I[0x2584 >> 2] = 0x58c; I[0x2570 >> 2] = 0x453; I[0x2574 >> 2] = -0x1db;
  I[0x2590 >> 2] = 0; I[0x2514 >> 2] = 0; I[0x2518 >> 2] = 10; I[0x256c >> 2] = -1;
  I[0x1af4 >> 2] = 0x40000000; I[0x26d4 >> 2] = 1; I[0x1aa0 >> 2] = 0x43960000; I[0x1ac4 >> 2] = 0x3f800000;
  I[0x1ac8 >> 2] = 0x3f000000; I[0x26cc >> 2] = 2; I[0x2504 >> 2] = 2;
  I[0x6214 >> 2] = 2; vt(c, 0x200); I = c.m.I;
  // layer 3
  I[0x26e0 >> 2] = 2; I[0x2770 >> 2] = 0x58c; I[0x275c >> 2] = 0x524; I[0x2760 >> 2] = -0x191; I[0x277c >> 2] = 0;
  I[0x2700 >> 2] = 0; I[0x2704 >> 2] = 0xb; I[0x2758 >> 2] = 0; I[0x28c0 >> 2] = 1; I[0x6214 >> 2] = 3;
  I[0x2884 >> 2] = -1; I[0x26f0 >> 2] = 2; vt(c, 0x200); I = c.m.I;
  // layer 4
  I[0x28cc >> 2] = 2; I[0x295c >> 2] = 0x58c; I[0x2948 >> 2] = 0x524; I[0x294c >> 2] = -0x191; I[0x2968 >> 2] = 0;
  I[0x28ec >> 2] = 0; I[0x28f0 >> 2] = 0x23; I[0x2944 >> 2] = 0; I[0x2a70 >> 2] = -1; I[0x28dc >> 2] = 2;
  I[0x28d0 >> 2] = -1; I[0x2954 >> 2] = 0; I[0x2958 >> 2] = 0; I[0x28fc >> 2] = 0; I[0x6214 >> 2] = 4;
  I[0x2900 >> 2] = 0; I[0x28f4 >> 2] = 0; vt(c, 0x200); I = c.m.I;
  // layer 5
  I[0x2ca8 >> 2] = -1; I[0x2d2c >> 2] = 0; I[0x2d30 >> 2] = 0; I[0x2cd4 >> 2] = 0; I[0x2cd8 >> 2] = 0; I[0x2ccc >> 2] = 0;
  I[0x2ab8 >> 2] = 2; I[0x2b48 >> 2] = 0x58c; I[0x2b34 >> 2] = 0x4f5; I[0x2b38 >> 2] = 0x35; I[0x2b54 >> 2] = -0x2e;
  I[0x2ad8 >> 2] = 0; I[0x2adc >> 2] = 5; I[0x2b30 >> 2] = -1; I[0x2c5c >> 2] = -1; I[0x2ac8 >> 2] = 2;
  I[0x6214 >> 2] = 5; vt(c, 0x200);
  return 0;
}

/** E+0x208 0x100222a0: sin / cos of whole degrees (x87 FSIN/FCOS of d * (float)0.01745328, stored as float) */
function trigTables(c: Core): number {
  const F = c.m.F, k = fr(0.01745328);
  F[0x5af0 >> 2] = 0;
  for (let d = 1; d < 360; d++) F[(0x5af0 >> 2) + d] = Math.sin(d * k);
  F[0x5550 >> 2] = 1;
  for (let d = 1; d < 360; d++) F[(0x5550 >> 2) + d] = Math.cos(d * k);
  return 0;
}

/** E+0x258 0x10014d30: the canvas, 352 x 320 */
function canvasDefault(c: Core): number {
  const I = c.m.I;
  if (I[0x6590 >> 2] !== 0x160 || I[0x6598 >> 2] !== 0x140) {
    if (I[0x63e4 >> 2] !== 0) c.m.release(I[0x63e4 >> 2]);
    I[0x6590 >> 2] = 0x160;
    I[0x6598 >> 2] = 0x140;
    const p = c.m.malloc(0x6e000);
    c.m.I[0x63e4 >> 2] = p;
  }
  return 0;
}
/** E+0x260 0x10014e30: the canvas, window-sized */
function canvasWindow(c: Core): number {
  const I = c.m.I;
  if (I[0x6590 >> 2] !== I[0x6408 >> 2] || I[0x6598 >> 2] !== I[0x640c >> 2]) {
    if (I[0x63e4 >> 2] !== 0) c.m.release(I[0x63e4 >> 2]);
    I[0x6590 >> 2] = I[0x6408 >> 2];
    I[0x6598 >> 2] = I[0x640c >> 2];
    const p = c.m.malloc(I[0x6408 >> 2] * I[0x640c >> 2] * 4);
    c.m.I[0x63e4 >> 2] = p;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ per frame
const RAND_BASIC = [6, 7, 8, 9, 10, 11, 12, 13];
const RAND_GEOMETRIC = [0xe, 0x10, 0x13, 0x18, 0x1a, 0x1d, 0x1e, 0x1f];
const RAND_PARTICLE = [0xf, 0x11, 0x14, 0x15, 0x16, 0x17, 0x19, 0x1c];

/** E+0x2ec 0x1001c8f0 (Render's last call; the TimedLevel it gets is never read): the selection modes pick the
 *  next transition id (obj+0x65ac) once per picture (obj+0x6554 = picked) */
function select(c: Core): number {
  const I = c.m.I;
  const mode = I[0x6550 >> 2];
  if (mode === 1) {
    const fav: number[] = [];
    for (let i = 0; i < 26; i++) if (I[(0x6d0 >> 2) + i] === 1) fav.push(6 + i);
    const n = fav.length;
    I[0x634c >> 2] = n;
    const list = (k: number) => (k >= 0 && k < 27 ? fav[k] ?? 0 : 0);
    if (I[0x6cc >> 2] === 0 && I[0x6b10 >> 2] !== 0 && n === 0) {
      // DisplayPropertyPage(hwnd): only when IWMPEffects2::Create gave a window; the port has none
      I[0x6cc >> 2] = 1;
    } else if (n === 0) I[0x65ac >> 2] = 6;
    else if (n === 1) I[0x65ac >> 2] = list(0);
    else if (I[0x69b0 >> 2] === 4 || I[0x6554 >> 2] !== 0 || I[0x738 >> 2] === 0 || n < 2) {
      if (I[0x69b0 >> 2] !== 4 && I[0x6554 >> 2] === 0) {
        I[0x6554 >> 2] = 1;
        if (n <= I[0x6c8 >> 2]) I[0x6c8 >> 2] = 0;
        I[0x65ac >> 2] = list(I[0x6c8 >> 2]);
        I[0x6c8 >> 2]++;
      }
    } else {
      if (n < 4) I[0x694c >> 2] = 3;
      else if (n < 8) I[0x694c >> 2] = 7;
      else if (n < 0x10) I[0x694c >> 2] = 0xf;
      else if (n < 0x20) I[0x694c >> 2] = 0x1f;
      else if (n < 0x40) I[0x694c >> 2] = 0x3f;
      else if (n <= I[0x694c >> 2]) I[0x694c >> 2] -= n;
      I[0x6554 >> 2] = 1;
      const u = A.rand() & I[0x694c >> 2];
      I[0x6374 >> 2] = u;
      if (n <= u) I[0x6374 >> 2] = u - n;
      if (n <= I[0x6374 >> 2]) I[0x6374 >> 2] = 0;
      if (I[0x65ac >> 2] === list(I[0x6374 >> 2])) {
        I[0x6374 >> 2]++;
        if (n <= I[0x6374 >> 2]) I[0x6374 >> 2] = 0;
      }
      I[0x65ac >> 2] = list(I[0x6374 >> 2]);
    }
  }
  const pick = (tab: number[]) => {
    I[0x6554 >> 2] = 1;
    const u = A.rand() & 7;
    I[0x634c >> 2] = u;
    if (I[0x65ac >> 2] === tab[u]) { I[0x634c >> 2] = u + 1; if (u + 1 > 6) I[0x634c >> 2] = 0; }
    I[0x65ac >> 2] = tab[I[0x634c >> 2]];
  };
  const free = I[0x69b0 >> 2] !== 4 && I[0x6554 >> 2] === 0;
  if (mode === 2 && free) pick(RAND_BASIC);
  if (mode === 3 && I[0x69b0 >> 2] !== 4 && I[0x6554 >> 2] === 0) pick(RAND_GEOMETRIC);
  if (mode === 4 && I[0x69b0 >> 2] !== 4 && I[0x6554 >> 2] === 0) pick(RAND_PARTICLE);
  if (mode === 5 && I[0x69b0 >> 2] !== 4 && I[0x6554 >> 2] === 0) {
    I[0x6554 >> 2] = 1;
    const t = (I[0x65ac >> 2] + (A.rand() & 3) + 1) >>> 0;
    I[0x65ac >> 2] = t;
    if (t > 0x1f || t < 6) I[0x65ac >> 2] = (A.rand() & 1) + 6;
  }
  vt(c, 0x224);
  return 0;
}

/** E+0x224 0x10015d90: the picture logic (at most 11 times a second), then the compositor */
function dispatch(c: Core): number {
  let I = c.m.I;
  if (I[0x22c0 >> 2] !== -1 && I[0x212c >> 2] <= 1) I[0x212c >> 2] = 2;
  if (I[0x2698 >> 2] !== -1 && I[0x2504 >> 2] <= 1) I[0x2504 >> 2] = 3;
  if (I[0x6998 >> 2] === 0) { vt(c, 0x110); vt(c, 0x150); I = c.m.I; }
  if (I[0x5f0 >> 2] === 0) { I[0x62e8 >> 2] = 1; vt(c, 0x14c); } else I[0x5f0 >> 2] = 0;
  return 0;
}

/** E+0x110 0x100212f0 -> E+0x124 0x10021310: animate every used layer (E+0x194) */
function animateLayers(c: Core): number {
  const I = c.m.I;
  let k = 0;
  do {
    I[0x6214 >> 2] = k;
    if (c.m.I[(0x211c >> 2) + k * 0x7b] !== -1) vt(c, 0x194);
    k++;
  } while ((k >>> 0) < (c.m.I[0x63c4 >> 2] >>> 0));
  c.m.I[0x6214 >> 2] = k;
  return 0;
}

/** E+0x194 0x10021360: the current layer's per-step motion: two spins (wrap 359), the fade (clamp 0..255),
 *  the integer spin, the zoom towards the image diagonal, the turn, a drift and a phase */
function animateLayer(c: Core): number {
  const m = c.m;
  let I = m.I, F = m.F;
  const L = I[0x6214 >> 2], l = L * 0x1ec, x = L * 0xe0;
  const mark = () => { I = m.I; I[(0x211c + l) >> 2] = 2; vt(c, 0x2c0); I = m.I; F = m.F; };
  if (F[(0x18d4 + x) >> 2] !== 0) {
    F[(0x18d0 + x) >> 2] = F[(0x18d4 + x) >> 2] + F[(0x18d0 + x) >> 2];
    if (F[(0x18d0 + x) >> 2] > 359) F[(0x18d0 + x) >> 2] = F[(0x18d0 + x) >> 2] - 359;
    mark();
    I[(0x212c + l) >> 2] = 3;
  }
  if (F[(0x18dc + x) >> 2] !== 0) {
    F[(0x18d8 + x) >> 2] = F[(0x18dc + x) >> 2] + F[(0x18d8 + x) >> 2];
    if (F[(0x18d8 + x) >> 2] > 359) F[(0x18d8 + x) >> 2] = F[(0x18d8 + x) >> 2] - 359;
    mark();
    I[(0x212c + l) >> 2] = 3;
  }
  if (F[(0x1918 + x) >> 2] !== 0) {
    F[(0x1914 + x) >> 2] = F[(0x1918 + x) >> 2] + F[(0x1914 + x) >> 2];
    if (F[(0x1914 + x) >> 2] > 255) F[(0x1914 + x) >> 2] = 255;
    if (F[(0x1914 + x) >> 2] < 0) F[(0x1914 + x) >> 2] = 0;
    mark();
  }
  if (I[(0x2250 + l) >> 2] !== 0) {
    I[(0x222c + l) >> 2] = (I[(0x222c + l) >> 2] + I[(0x2250 + l) >> 2]) | 0;
    if (I[(0x222c + l) >> 2] > 0x167) I[(0x222c + l) >> 2] -= 0x167;
    mark();
    I[(0x212c + l) >> 2] = 3;
  }
  if (I[(0x2268 + l) >> 2] >= 1) {
    const w = I[(0x21a4 + l) >> 2], h = I[(0x21a8 + l) >> 2];
    const d2 = (Math.imul(w, w) + Math.imul(h, h)) | 0;
    const z = F[(0x1878 + x) >> 2];
    if (F[(0x187c + x) >> 2] !== 0 && z * z < d2) {
      F[(0x1878 + x) >> 2] = F[(0x187c + x) >> 2] + F[(0x1878 + x) >> 2];
      vt(c, 0x2c0);
      mark();
      I[(0x212c + l) >> 2] = 3;
    }
    if (I[(0x2264 + l) >> 2] !== 0) {
      I[(0x2260 + l) >> 2] = (I[(0x2260 + l) >> 2] + I[(0x2264 + l) >> 2]) | 0;
      if (I[(0x2260 + l) >> 2] < 0) I[(0x2260 + l) >> 2] += 0x167;
      if (I[(0x2260 + l) >> 2] > 0x167) I[(0x2260 + l) >> 2] -= 0x167;
      vt(c, 0x2c0);
      mark();
      I[(0x212c + l) >> 2] = 3;
    }
  }
  if (F[(0x1904 + x) >> 2] !== 0 || F[(0x1908 + x) >> 2] !== 0) {
    F[(0x18fc + x) >> 2] = F[(0x1904 + x) >> 2] + F[(0x18fc + x) >> 2];
    F[(0x1900 + x) >> 2] = F[(0x1908 + x) >> 2] + F[(0x1900 + x) >> 2];
    vt(c, 0x2c0);
    mark();
    I[(0x212c + l) >> 2] = 3;
  }
  if (F[(0x1938 + x) >> 2] !== 0) {
    if (!(F[(0x1934 + x) >> 2] < 1)) F[(0x1934 + x) >> 2] = F[(0x1934 + x) >> 2] - ftol(F[(0x1934 + x) >> 2]);
    F[(0x1934 + x) >> 2] = F[(0x1938 + x) >> 2] + F[(0x1934 + x) >> 2];
  }
  return 0;
}

/** E+0x2c0 0x10007d80: the first time a layer moves, remember where it was (for the redraw) */
function saveRect(c: Core): number {
  const I = c.m.I, l = lb(c);
  if (I[(0x212c + l) >> 2] === 1 && I[(0x2154 + l) >> 2] !== 2) {
    I[0x6730 >> 2] = I[(0x2130 + l) >> 2];
    I[0x6738 >> 2] = I[(0x2134 + l) >> 2];
    if (I[0x6590 >> 2] < I[0x6730 >> 2]) I[0x6730 >> 2] = 0;
    if (I[0x6598 >> 2] < I[0x6738 >> 2]) I[0x6738 >> 2] = 0;
    I[(0x2158 + l) >> 2] = I[0x6730 >> 2];
    I[(0x215c + l) >> 2] = I[0x6738 >> 2];
    I[(0x22d0 + l) >> 2] = I[(0x2148 + l) >> 2];
    I[(0x216c + l) >> 2] = I[(0x214c + l) >> 2];
    I[(0x2170 + l) >> 2] = I[(0x2150 + l) >> 2];
    I[(0x2168 + l) >> 2] = I[(0x2140 + l) >> 2];
    I[(0x2164 + l) >> 2] = I[(0x213c + l) >> 2];
    I[(0x2154 + l) >> 2] = 2;
  }
  return 0;
}

/** E+0x150 0x10022330: a new transition id restarts the scene (single-transition presets) */
function presetCheck(c: Core): number {
  const I = c.m.I;
  if (I[0x6384 >> 2] !== I[0x65ac >> 2]) {
    I[0x6384 >> 2] = I[0x65ac >> 2];
    if (I[0x6550 >> 2] === 0) I[0x62ec >> 2] = 0;
  }
  vt(c, 0x228);
  return 0;
}

/** E+0x228 0x10022370: (re)build the scene when obj+0x62ec is 0, then the transition step */
function presetReset(c: Core): number {
  let I = c.m.I;
  if (I[0x62ec >> 2] === 0) {
    I[0x61bc >> 2] = 0;
    vt(c, 0x20c);
    vt(c, 0x258);
    I = c.m.I;
    I[0x63c4 >> 2] = 9;
    for (const a of [0x22c0, 0x211c, 0x24ac, 0x2308, 0x2698, 0x24f4, 0x2884, 0x26e0, 0x2c5c, 0x2ab8, 0x2e48, 0x2ca4,
      0x3034]) I[a >> 2] = -1;
    I[0x69d4 >> 2] = 0; I[0x69d8 >> 2] = 0; I[0x69dc >> 2] = 0; I[0x69d0 >> 2] = 0;
    I[0x2e90 >> 2] = 2;                    // layer 7
    I[0x2a70 >> 2] = 0; I[0x28cc >> 2] = 2; I[0x2948 >> 2] = 0; I[0x294c >> 2] = 0; I[0x2968 >> 2] = -0x32;
    I[0x2944 >> 2] = -2; I[0x2aa4 >> 2] = 1; I[0x29b0 >> 2] = 0; I[0x29ac >> 2] = 300;   // layer 4: the picture
  }
  vt(c, 0x22c);
  return 0;
}

/** Transition ids (obj+0x65ac, 6..0x1f) -> the transition number (obj+0x69ac) the per-tick step dispatches on,
 *  and which ids run the drop-shadow cycle E+0x100 every tick */
const TX_NUM: Record<number, number> = { 6: 0, 7: 1, 8: 2, 0x1b: 3, 0x14: 4, 10: 5, 0xb: 6, 0xc: 7, 0xd: 8, 0x1d: 9,
  9: 10, 0x19: 11, 0x17: 12, 0x10: 13, 0x12: 14, 0x11: 15, 0x15: 16, 0x16: 17, 0x1c: 18, 0xf: 19, 0x13: 20, 0x18: 21,
  0x1e: 22, 0x1a: 23, 0xe: 24, 0x1f: 25 };
const TX_SHADOW = new Set([8, 0xb, 0xd, 0x1d, 0x19, 0x18, 0x1e]);

/** E+0x22c 0x10022470: one step of the picture cycle: the background timer, the size check, the picture
 *  change every How_often_should_picture_be_changed seconds, then the transition's step (E+0x74) */
function step(c: Core): number {
  let I = c.m.I;
  const id = I[0x65ac >> 2];
  I[0x63b8 >> 2] = 0xb;
  const num = TX_NUM[id];
  if (num === undefined) return 0;
  vt(c, 0xe8);
  I = c.m.I;
  if (I[0x62ec >> 2] === 0) {
    if (id === 0x1f) {
      I[0x608 >> 2] = 0; I[0x62ec >> 2] = 1; I[0x60c >> 2] = 1; I[0x69b0 >> 2] = 0; I[0x614 >> 2] = 0; I[0x69c >> 2] = 0;
      return 0;
    }
    I[0x62ec >> 2] = 1;
    if (id === 0xb || id === 0x17) I[0x2aa4 >> 2] = 1;
    I[0x60c >> 2] = 1; I[0x608 >> 2] = 0; I[0x69b0 >> 2] = 0; I[0x614 >> 2] = 0;
    return 0;
  }
  I[0x69ac >> 2] = num;
  if (I[0x6c4 >> 2] !== 1 && (I[0x69b0 >> 2] === 2 || I[0x60c >> 2] === 1)) I[0x5f8 >> 2] = tick(c);
  I[0x600 >> 2] = (((tick(c) - I[0x5f8 >> 2]) >>> 0) / 1000) >>> 0;
  vt(c, 0x134);
  I = c.m.I;
  if (I[0x62f4 >> 2] === 1) return 0;
  if (TX_SHADOW.has(id)) { vt(c, 0x100); I = c.m.I; }
  if ((I[0x600 >> 2] > I[0x1838 >> 2] || I[0x60c >> 2] === 1) && (I[0x69b0 >> 2] === 0 || I[0x69b0 >> 2] === 3)) {
    I[0x6214 >> 2] = 4;
    if (vt(c, 0x24) === E_FAIL) return 0;
    vt(c, 0xec);
    I = c.m.I;
    if (I[0x6c4 >> 2] === 1) { I[0x6c4 >> 2] = 0; I[0x60c >> 2] = 0; return 0; }
    if (id === 6) I[0x6554 >> 2] = 0;
    I[0x60c >> 2] = 0;
    I[0x5f8 >> 2] = tick(c);
    I[0x5f4 >> 2] = tick(c);
    if (id === 6) { if (I[0x614 >> 2] === 0) I[0x608 >> 2] = 0; } else I[0x608 >> 2] = I[0x614 >> 2] === 0 ? 0 : 1;
    I[0x28dc >> 2] = 3;
  }
  I[0x6214 >> 2] = 4;
  vt(c, 0x74);
  return 0;
}

/** E+0xe8 0x100185d0: the background picture's timer (How_often_should_Bkg_picture_be_changed seconds), and a
 *  new background when the window size changed */
function backgroundTimer(c: Core): number {
  let I = c.m.I;
  const s = (((tick(c) - I[0x5fc >> 2]) >>> 0) / 1000) >>> 0;
  I[0x604 >> 2] = s;
  if (I[0x640 >> 2] !== 0 && ((I[0x6bc >> 2] < (s | 0) && I[0x2a70 >> 2] !== -1 && I[0x69b0 >> 2] === 0) ||
      I[0x62ec >> 2] === 1 || I[0x648 >> 2] !== 0 || I[0x6590 >> 2] !== I[0x6408 >> 2] || I[0x6598 >> 2] !== I[0x640c >> 2])) {
    if (I[0x6590 >> 2] !== I[0x6408 >> 2] || I[0x6598 >> 2] !== I[0x640c >> 2]) I[0x630 >> 2] = 1;
    I[0x69b0 >> 2] = 3; I[0x60c >> 2] = 1; I[0x614 >> 2] = 0; I[0x6c4 >> 2] = 1;
    I[0x5fc >> 2] = tick(c);
    I[0x604 >> 2] = 0;
    I[0x6214 >> 2] = 6;
    I[0x2ca4 >> 2] = 2;
    const l = 6 * 0x1ec;
    I[(0x2198 + l) >> 2] = 0; I[(0x219c + l) >> 2] = -2000; I[(0x21b8 + l) >> 2] = -2000; I[(0x2194 + l) >> 2] = -2;
    vt(c, 0x1b0);
    vt(c, 0x28);
    I = c.m.I;
  }
  return 0;
}

/** E+0x134 0x10023930: the window size changed (or the scene was just rebuilt): window-sized canvas, reload */
function sizeCheck(c: Core): number {
  const I = c.m.I;
  if (I[0x6598 >> 2] !== I[0x640c >> 2] || I[0x6590 >> 2] !== I[0x6408 >> 2] || I[0x62ec >> 2] === 1) {
    I[0x62ec >> 2] = 2;
    vt(c, 0x260);
    const J = c.m.I;
    J[0x69b0 >> 2] = 3; J[0x60c >> 2] = 1; J[0x614 >> 2] = 0;
  }
  return 0;
}

/** E+0x74 0x10023ad0: the transition's step for this tick (by obj+0x69ac), then the clock (E+0x70) */
const TX_SLOT = [0, 0x7c, 0x8c, 0x84, 0x88, 0x80, 0xa4, 0xa8, 0xac, 0xb0, 0xb4, 0x90, 0x94, 0x98, 0xb8, 0xbc, 0xc0, 0xc4,
  0xc8, 0xcc, 0xd0, 0xd4, 0xd8, 0xdc, 0xe0, 0xe4];
function transition(c: Core): number {
  let I = c.m.I;
  if (I[0x69b0 >> 2] === 3 || I[0x614 >> 2] === 0) { I[0x614 >> 2] = 1; vt(c, 0x78); I = c.m.I; }
  const t = I[0x69ac >> 2];
  if (t === 0) return 0;
  if (I[0x620 >> 2] === 1 || t === 1) { vt(c, 0x7c); vt(c, 0x70); return 0; }
  if (t > 0 && t < TX_SLOT.length) { vt(c, TX_SLOT[t]); vt(c, 0x70); }
  return 0;
}

/** E+0x78 0x10023f10: the current layer's transition fields back to rest */
function transitionReset(c: Core): number {
  const I = c.m.I, l = lb(c), x = xb(c);
  I[0x69b0 >> 2] = 0;
  for (const f of [0x2230, 0x2234, 0x2200, 0x223c, 0x2240, 0x2244, 0x22ac, 0x2290, 0x228c, 0x2284, 0x2288, 0x2208,
    0x2210, 0x2214, 0x2268, 0x226c, 0x2270, 0x2264]) I[(f + l) >> 2] = 0;
  for (let j = 0; j < 0x38; j++) I[((0x185c + x) >> 2) + j] = 0;
  I[0x6374 >> 2] = 0x38;
  return 0;
}

/** E+0x70 0x10023db0: the transition's clock: 3 s in (state 1) and out (state 2) */
function transitionClock(c: Core): number {
  const I = c.m.I;
  if (I[0x600 >> 2] === I[0x1838 >> 2]) I[0x5f4 >> 2] = tick(c);
  if (I[0x69b0 >> 2] === 1 || I[0x69b0 >> 2] === 2) I[0xc4 >> 2] = tick(c) - I[0x5f4 >> 2];
  const u = I[0xc4 >> 2] >>> 0;
  if (u > 3000 && I[0x69b0 >> 2] === 1) {
    I[0x69b0 >> 2] = 0;
    I[0x620 >> 2] = 1;
    vt(c, 0x78);
    const J = c.m.I;
    J[(0x22c0 + lb(c)) >> 2] = -1;
    return 0;
  }
  if (u < 3000 && I[0x69b0 >> 2] === 1) I[0x620 >> 2] = 0;
  if (u > 3000 && I[0x69b0 >> 2] === 2) {
    I[0x620 >> 2] = 0;
    I[0x6554 >> 2] = 0;
    vt(c, 0x78);
    const J = c.m.I;
    J[(0x22c0 + lb(c)) >> 2] = 0;
    const id = J[0x65ac >> 2];
    J[0x69b0 >> 2] = (id === 0x1e || id === 0x1d || id === 0x19 || id === 0x18 || id === 0xd || id === 0xb || id === 8) &&
      J[0x644 >> 2] === 1 ? 4 : 0;
  }
  return 0;
}

/** E+0x100 0x10029ca0: the transitions that draw the picture without its drop shadow reload it with the shadow
 *  when they are done (state 4) or the time is up */
function shadowCycle(c: Core): number {
  let I = c.m.I;
  if (I[0x644 >> 2] === 1) {
    I[0x6214 >> 2] = 4;
    if (I[0x600 >> 2] === I[0x1838 >> 2]) {
      I[0x644 >> 2] = 0; I[0x60c >> 2] = 1; I[0x614 >> 2] = 0; I[0x69b0 >> 2] = 3;
      vt(c, 0x24);
      vt(c, 0xec);
      I = c.m.I;
      I[0x600 >> 2] = I[0x1838 >> 2];
      I[0x5f4 >> 2] = tick(c);
      I[0x60c >> 2] = 0;
    }
    if (I[(0x22c0 + lb(c)) >> 2] === -1) I[0x644 >> 2] = 0;
    if (I[0x69b0 >> 2] === 4) {
      I[0x60c >> 2] = 1; I[0x614 >> 2] = 0; I[0x69b0 >> 2] = 3;
      vt(c, 0x24);
      vt(c, 0xec);
      I = c.m.I;
      I[0x60c >> 2] = 0; I[0x69b0 >> 2] = 0;
    }
  }
  return 0;
}

/** E+0x154 0x1000a060: clear the alpha bytes of the current layer's image (and the dword before it, where the
 *  alpha ring keeps its signature) */
function clearAlpha(c: Core): number {
  const I = c.m.I, l = lb(c);
  const n = Math.imul(I[(0x21a8 + l) >> 2], I[(0x21a4 + l) >> 2]);
  if (n === 0) return 0;
  const p = I[(0x2144 + l) >> 2];
  I[0x614c >> 2] = p;
  I[(p - 4) >> 2] = 0;
  I[0x634c >> 2] = 0;
  if (n > 0) {
    const b = p >> 2;
    for (let k = 0; k < n; k++) I[b + k] &= 0xffffff;
    I[0x614c >> 2] = p + n * 4;
    I[0x634c >> 2] = n;
  }
  return 0;
}

def({
  0x154: clearAlpha,
  0x24: findPhoto, 0x28: findBackground, 0x2c: folderDialog,
  0x30: (c) => scanFolder(c, 0xd4, 0x1d8, 0xa8, 'cur_Photo_cnt_foreground'),
  0x34: (c) => scanFolder(c, 0x3e0, 0x2dc, 0xb4, 'cur_Photo_cnt_background'),
  0x38: loadPhoto, 0x3c: loadBackground,
  0x50: countFiles, 0x60: (c) => folderNode(c, 0xa8), 0x64: (c) => folderNode(c, 0xb4),
  0x58: () => 0, 0x5c: () => 0,                       // sub-folder walks: the port's folder has none
  0x68: (c) => seekPhoto(c, 0xa8, 0xc8), 0x6c: (c) => seekPhoto(c, 0xb4, 0x6b4),
  0x70: transitionClock, 0x74: transition, 0x78: transitionReset,
  0x100: shadowCycle, 0x10c: fitSize, 0x110: animateLayers, 0x124: animateLayers, 0x134: sizeCheck, 0x150: presetCheck,
  0x194: animateLayer, 0x1ac: freeLayers, 0x1b0: freeLayer, 0x200: unbindLayer, 0x204: strides, 0x208: trigTables,
  0x20c: scene, 0x224: dispatch, 0x228: presetReset, 0x22c: step, 0x23c: init, 0x258: canvasDefault,
  0x260: canvasWindow, 0x2c0: saveRect, 0x2ec: select,
  0xe8: backgroundTimer, 0xec: dressPhoto, 0xf4: settings, 0xf8: photoFirst,
});

/** E+0xec 0x100161b0: dress the loaded picture: the edge (E+0xf0), the drop shadow (E+0xfc); obj+0x2aac =
 *  "no background at all" */
function dressPhoto(c: Core): number {
  let I = c.m.I;
  if (I[0x654 >> 2] === 1) { vt(c, 0xf0); I = c.m.I; I[0x2aac >> 2] = 0; }
  I[0x2aac >> 2] = I[0x63c >> 2] === 0 && I[0x640 >> 2] === 0 ? 1 : 0;
  if (I[0x644 >> 2] === 1) vt(c, 0xfc);
  return 0;
}
