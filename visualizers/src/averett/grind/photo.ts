// Grind's photo pipeline: the folders (Grind_Media\Foreground: the photos, Grind_Media\Background: the backdrop),
// the search for the next picture, the GDI+ loaders, the fitted sizes, the photo edge, the backdrop's timer and the
// three signs it draws into the backdrop (Grind_Media\Grind_logo). Picture Viz 3D's twins are in
// ../../pictureviz/pv3/photo.ts and sprite.ts; offsets here are Grind's (core.ts).
//
// The folders: as Picture Viz 3D's (FindFirstFileA from *.jpg on, one node per folder), but the port has two
// folders, told apart by name (core.ts FOREGROUND / BACKGROUND): env.pictures and env.background. Grind's pictures
// are JPEGs: every one is found by the first pass (*.jpg), which counts n files as n. c.found is the picture the
// search stopped at, in the list of the folder it searched.
//
// Not ported here, Picture Viz 3D's code runs: the folder walks and nodes (vt+0x44 / 0x48 0x10034ec0 / 0x100352f0,
// vt+0x6c / 0x70, vt+0x74 / 0x78: the same code but for a path buffer's address), the plain backdrop (vt+0x104
// 0x10032e90), the floor texture (vt+0x154 0x100034d0: Grind writes the texture's size into its copy of the
// DATATABLE_tga header rather than into the resource before copying it; the copy, and the texture, are the same).
// 0x1000ac30 / 0x1001f8f0 (Gdiplus::Bitmap's destructor, GdipDisposeImage): GDI+'s objects are not in the heap.
import type { Core } from '../../pictureviz/pv3/core';
import type { Picture } from '../../pictureviz/picture';
import { ftol, fr } from '../../pictureviz/pv2/mem';
import { scaleHQ } from '../gdip';
import { A } from '../../ns';
import '../../rand';
import { type GrindCore, type GrindEnv, type ArgbPicture, gdef, gvt, gi, si, gf, sf, tick, FOREGROUND, BACKGROUND } from './core';
import { o } from './layout';

const E_FAIL = 0x80004005 | 0;
/** the FindFirstFileA pass (1 *.jpg .. 5 *.exif) Grind's pictures are found by */
const PASS = 1;
/** stand-in for the Scan0 of GDI+'s locked bitmaps (GDI+'s heap, not the DLL's) */
const SCAN0 = 0x7a000000;

/** the current sprite's record field (sprite 0's offset `f`) */
const rec = (c: Core, f: number): number => f + gi(c, 0x1ca4) * 0x1ec;
const ri = (c: Core, f: number): number => c.m.I[rec(c, f) >> 2];
const rs = (c: Core, f: number, v: number): void => { c.m.I[rec(c, f) >> 2] = v; };
const genv = (c: Core): GrindEnv => (c as GrindCore).genv;
/** SetCurrentDirectoryA(the folder name at Grind offset g) succeeds when it is not empty */
const dirOk = (c: Core, g: number): boolean => (c.str.get(o(g)) ?? '') !== '';
/** GdiplusStartup, once (0x279c; the token 0x3a7c is GDI+'s and stays 0 here) */
const gdipStart = (c: Core): void => si(c, 0x279c, 1);
/** GdipBitmapLockBits' BitmapData (operator new(0x18), deleted after each lock): when the lock fails (a bitmap of no
 *  size: GdipCreateBitmapFromScan0 refused it) the loader reads the block as the last lock left it */
const LOCK = new WeakMap<Core, [number, number]>();
function lock(c: Core, w: number, h: number): [number, number] {
  if (w > 0 && h > 0) LOCK.set(c, [w, h]);
  return LOCK.get(c) ?? [0, 0];
}

// ------------------------------------------------------------------------------------------------ the folders
/** vt+0x64 0x100339a0 (Picture Viz 3D's 0x1002c630): count the current folder's (0x3550) pictures into 0x27f4 */
function countFiles(c: Core): number {
  const s = c.str.get(o(0x3550)) ?? '', e = genv(c);
  si(c, 0x27f4, s === FOREGROUND ? e.pictures.length : s === BACKGROUND ? e.background.length : 0);
  return 0;
}

/** vt+0x7c 0x10035240 / vt+0x80 0x10035660: which node of the list at `head` holds photo number `idx` (counted
 *  from the list's end); 0x227c = its number within that node. A number past the list returns with 0x227c as the
 *  remainder (Picture Viz 3D's twin dereferences the null node). */
function seekPhoto(c: Core, head: number, idx: number): number {
  const I = c.m.I;
  let p = gi(c, head);
  si(c, 0x227c, gi(c, head + 8) - gi(c, idx));
  if (p === 0) return 0;
  for (; ;) {
    if (gi(c, 0x227c) < I[(p + 0x104) >> 2]) break;
    si(c, 0x227c, gi(c, 0x227c) - I[(p + 0x104) >> 2]);
    p = I[(p + 0x10c) >> 2];
    if (p === 0) return 0;
  }
  si(c, 0x227c, I[(p + 0x104) >> 2] - gi(c, 0x227c));
  return 0;
}

/** Randomize_picture's walk (0x10033131.. / 0x100335e9..): jumps of a random stride, restarted at random. fg: the
 *  foreground's, whose run end also clears the search counter. */
function randomStep(c: Core, idx: number, runs: number, stride: number, count: number, fg: boolean): void {
  let inRun = gi(c, runs) !== 0;
  for (;;) {
    const n = gi(c, count);
    if (inRun) {
      const a = gi(c, idx) + gi(c, stride);
      si(c, idx, a);
      if (a <= n) return;
      const r = gi(c, runs);
      si(c, idx, 1);
      si(c, 0x313fc, 0);                    // (the background's walk clears the foreground's pass too)
      si(c, runs, r - 1);
      if (r - 1 !== 0) { si(c, idx, r); return; }
      if (fg) { si(c, 0x313fc, 0); si(c, 0x287c, 0); }
    }
    if (n <= 1) si(c, runs, 1);
    else if (n <= 10) si(c, runs, (A.rand() & 3) + 1);
    else if (n <= 0x1e) si(c, runs, (A.rand() & 7) + 3);
    else si(c, runs, (A.rand() & 0xf) + 7);
    si(c, stride, gi(c, runs));
    if ((A.rand() & 0x10) === 0) { si(c, idx, 1); return; }
    si(c, idx, 0);
    inRun = true;
  }
}

/** the passes *.jpg (1) to *.exif (5) in `pass`, counting files in 0x287c until it reaches 0x227c, then the
 *  loader (vt+0x4c / vt+0x50) */
function search(c: Core, pass: number, n: number, load: number): number {
  si(c, pass, 1);
  do {
    if (gi(c, pass) === PASS) {
      for (let k = 0; k < n; k++) {
        si(c, 0x287c, gi(c, 0x287c) + 1);
        if (gi(c, 0x227c) === gi(c, 0x287c)) {
          c.found = k;
          gvt(c, load);
          return 0;
        }
      }
    }
    si(c, pass, gi(c, pass) + 1);
  } while (gi(c, pass) < 6);
  return E_FAIL;
}

/** vt+0x28 0x10033080: the next photo (number 0x2278, 1-based; Randomize_picture with 3 or more) into the current
 *  sprite. New_folder_selected (0x27f0) restarts at the first; 0x2808 holds the step for one call. */
function findPhoto(c: Core): number {
  si(c, 0x313fc, 0);
  si(c, 0x287c, 0);
  if (gi(c, 0x27f0) === 1) {
    si(c, 0x27f0, 0); si(c, 0x2278, 1); si(c, 0x287c, 0); si(c, 0x27e0, 1); si(c, 0x31648, 0);
    si(c, 0x27c4, tick(c));
  }
  if (!dirOk(c, 0x2288)) return E_FAIL;
  if (gi(c, 0x2e47c) === 0) gvt(c, 0x40);
  if (gi(c, 0x31aa4) !== 3 && gi(c, 0x2808) !== 1) {
    const n = gi(c, 0x2e47c);
    si(c, 0x2808, 1);
    if (n < 3 || gi(c, 0x27e4) === 0) {
      const a = gi(c, 0x2278) + 1;
      si(c, 0x2278, a);
      if (n < a) si(c, 0x2278, 1);
    } else randomStep(c, 0x2278, 0x31648, 0x31654, 0x2e47c, true);
  }
  if (gi(c, 0x2e47c) < gi(c, 0x2278) || gi(c, 0x2278) < 1) si(c, 0x2278, 1);
  gvt(c, 0x7c);
  return search(c, 0x313fc, c.env.pictures.length, 0x4c);
}

/** vt+0x2c 0x100333c0: the next backdrop picture (0x288c) into the current sprite, or a window-sized image of the
 *  background colour when the folder holds none (inline in the DLL: what vt+0x104 does) */
function findBackground(c: Core): number {
  if (!dirOk(c, 0x2594)) return E_FAIL;
  const n = gi(c, 0x2e488);
  if (n === 0) return gvt(c, 0x104);
  if (gi(c, 0x2810) === 1 || n < 3 || gi(c, 0x2898) === 0) {
    if (gi(c, 0x2810) === 0) { si(c, 0x2810, 1); si(c, 0x288c, gi(c, 0x288c) + 1); }
    if (n < gi(c, 0x288c) || gi(c, 0x288c) < 1) si(c, 0x288c, 1);
  } else {
    si(c, 0x2810, 1);
    randomStep(c, 0x288c, 0x3164c, 0x31658, 0x2e488, false);   // (no range check after it)
  }
  gvt(c, 0x80);
  si(c, 0x31400, 1);
  si(c, 0x287c, 0);
  return search(c, 0x31400, genv(c).background.length, 0x50);
}

// ------------------------------------------------------------------------------------------------ loading
/** the image block the loaders malloc at 0x3150c: [w, h, 0] then w*h pixels (the cursor 0x31270 walks the header);
 *  returns the pixels' address (0x31898) */
function imageBlock(c: Core, w: number, h: number): number {
  const p = c.m.malloc(Math.imul(w, h) * 4 + 0xc), I = c.m.I;
  si(c, 0x3150c, p);
  I[p >> 2] = w; I[(p + 4) >> 2] = h; I[(p + 8) >> 2] = 0;
  si(c, 0x31270, p + 12);
  si(c, 0x31898, p + 12);
  return p + 12;
}
/** the current sprite takes the image: its own (-1), w x h */
function bindImage(c: Core, img: number, w: number, h: number): void {
  rs(c, 0x970, -1);
  rs(c, 0x9f4, w); rs(c, 0x9f8, h);
  rs(c, 0x99c, w); rs(c, 0x9a0, h);
  rs(c, 0x994, img);
  if (ri(c, 0x97c) === 0) rs(c, 0x97c, 2);
  si(c, 0x3150c, 0);
}

/** vt+0x4c 0x100343e0 (Picture Viz 3D's 0x1002d070): load the found photo into the current sprite. GDI+:
 *  GdipCreateBitmapFromFileICM, its size (0x3181c x 0x3180c), the fit (vt+0x1b4: 0x282c x 0x2830, shrunk when its
 *  larger side less 10 reaches the texture limit 0x3d20), a 32bppPARGB bitmap of the fitted size,
 *  HighQualityBicubic, DrawImageRectRectI (0, 0, w, h) <- (0, 0, W, H), LockBits 32bppARGB: Env.scale's contract.
 *  Copied (only when the locked size is the fitted one, as it always is) alpha dropped, rows bottom-up. */
function loadPhoto(c: Core): number {
  gdipStart(c);
  const pic = c.env.pictures[c.found];
  si(c, 0x3181c, pic ? pic.w : 0);
  si(c, 0x3180c, pic ? pic.h : 0);
  if (Math.imul(gi(c, 0x3181c), gi(c, 0x3180c)) === 0) return E_FAIL;
  gvt(c, 0x1b4);
  const big = (gi(c, 0x2830) < gi(c, 0x282c) ? gi(c, 0x282c) : gi(c, 0x2830)) - 10, lim = gi(c, 0x3d20);
  si(c, 0x31910, big);
  if (big < lim) si(c, 0x3d24, 0);
  else {
    const s = lim / big;                     // FILD / FIDIV; FST float keeps the double on the stack
    sf(c, 0x3d24, s);
    si(c, 0x2830, ftol(gi(c, 0x2830) * s) - 10);
    si(c, 0x282c, ftol(gi(c, 0x282c) * s) - 10);
  }
  gvt(c, 0x250);
  const w = gi(c, 0x282c), h = gi(c, 0x2830), n = Math.imul(w, h);
  si(c, 0x31a94, n);
  if (n === 0) return E_FAIL;
  if (n < 0) { si(c, 0x31420, 1); return E_FAIL; }          // malloc(n * 4 + 12) fails
  const img = imageBlock(c, w, h);
  si(c, 0x31278, img + n * 4);
  // the first photo comes before Direct3D: the texture limit 0x3d20 is still 0 and the fit -10 x -10
  const px = w > 0 && h > 0 ? c.env.scale(pic, 0, 0, w, h, w, h) : null;
  const [lw, lh] = lock(c, w, h);
  si(c, 0x312a8, SCAN0);
  si(c, 0x3181c, lw);
  si(c, 0x3180c, lh);
  si(c, 0x31278, gi(c, 0x31270) + n * 4);
  if (px && lh === h && lw === w) {
    const end = gi(c, 0x31278), I = c.m.I;
    si(c, 0x31494, 0);
    for (let r = 0; r < h; r++) {
      const d = end - Math.imul(r + 1, w) * 4;
      si(c, 0x31474, 0);
      for (let x = 0; x < w; x++) I[(d >> 2) + x] = px[r * w + x] & 0xffffff;
      si(c, 0x31270, d + w * 4);
      si(c, 0x31474, w);
      si(c, 0x31494, r + 1);
    }
    si(c, 0x312a8, SCAN0 + n * 4);
  }
  bindImage(c, img, w, h);
  return 0;
}

/** vt+0x50 0x100349c0 (Picture Viz 3D's 0x1002d620): load the found backdrop picture: as vt+0x4c, but drawn at its
 *  fitted size centred in a window-sized (0x31514 x 0x31518) bitmap that is stored whole, top-down (the block is
 *  sized for the fitted picture, which covers the window) */
function loadBackground(c: Core): number {
  gdipStart(c);
  const pic: Picture | undefined = genv(c).background[c.found];
  si(c, 0x3181c, pic ? pic.w : 0);
  si(c, 0x3180c, pic ? pic.h : 0);
  if (Math.imul(gi(c, 0x3181c), gi(c, 0x3180c)) === 0) return E_FAIL;
  gvt(c, 0x1b4);
  gvt(c, 0x250);
  const w = gi(c, 0x282c), h = gi(c, 0x2830), n = Math.imul(w, h);
  si(c, 0x31a94, n);
  if (n === 0) return E_FAIL;
  const img = imageBlock(c, w, h);
  si(c, 0x31278, img + n * 4);
  const W = gi(c, 0x31514), H = gi(c, 0x31518);
  const px = c.env.scale(pic, ((W - w) / 2) | 0, ((H - h) / 2) | 0, w, h, W, H);
  lock(c, W, H);
  si(c, 0x312a8, SCAN0);
  si(c, 0x3181c, W);
  si(c, 0x3180c, H);
  const N = Math.imul(W, H), I = c.m.I;
  si(c, 0x31494, 0);
  for (let k = 0; k < N; k++) I[(img >> 2) + k] = px[k] & 0xffffff;
  if (N > 0) { si(c, 0x31270, img + N * 4); si(c, 0x312a8, SCAN0 + N * 4); si(c, 0x31494, N); }
  bindImage(c, img, W, H);
  return 0;
}

// ------------------------------------------------------------------------------------------------ the signs
/** GDI+'s 1/255 and 1.0 (float data) */
const K255 = fr(1 / 255);

/** GDI+ as the sign loaders run it on a PNG (32bppARGB): a 32bppPARGB bitmap w x h, InterpolationModeHighQuality-
 *  Bicubic, DrawImageRectRectI (0, 0, w, h) <- (0, 0, W, H) UnitPixel (the source premultiplied, round(c * a / 255);
 *  1:1 a copy), LockBits 32bppARGB (c * floor(0xff0000 / a) >> 16). pic null: nothing drawn (transparent). */
function signBitmap(pic: ArgbPicture | null, w: number, h: number): Uint32Array {
  if (!pic) return new Uint32Array(w * h);
  const W = pic.w, H = pic.h, b = pic.bgra, src = new Uint32Array(W * H);
  const pm = (v: number, a: number): number => { const t = v * a + 0x80; return (t + (t >> 8)) >> 8; };
  for (let i = 0; i < W * H; i++) {
    const a = b[i * 4 + 3];
    src[i] = ((a << 24) | (pm(b[i * 4 + 2], a) << 16) | (pm(b[i * 4 + 1], a) << 8) | pm(b[i * 4], a)) >>> 0;
  }
  const out = scaleHQ(src, W, H, 0, 0, W, H, w, h);
  for (let i = 0; i < out.length; i++) {
    const p = out[i], a = p >>> 24, m = a ? Math.floor(0xff0000 / a) : 0;
    out[i] = ((a << 24) | ((((p >>> 16) & 255) * m >> 16) << 16) | ((((p >>> 8) & 255) * m >> 16) << 8) | ((p & 255) * m >> 16)) >>> 0;
  }
  return out;
}

/** The sign loaders (vt+0x3c 0x1001f920 Grind_Logo_0; vt+0x38 0x1001fe80 Grind_Logo_1 / _1_hover by the state at
 *  0x2948; vt+0x34 0x100204d0 Grind_Logo_3D / _3D_hover by 0x2960; the state 1 normal, 2 hover, else nothing is
 *  drawn): the PNG's size from the normal one, the fit (vt+0x1b0 for sprite 1 at How_big_should_picture_be 90),
 *  no larger than the PNG, drawn by GDI+ (signBitmap), then blended into the backdrop (sprite 6's image) from
 *  column 2, row 3 on: alpha 0 skipped, 255 copied, else each channel d * (1 - a/255) + s * a/255 truncated (x87:
 *  a times the float 1/255, both products and the sum double), alpha 0xff. `rect` gets x, y (2, 2), w, h. */
function sign(c: Core, normal: number, hover: number, state: number, rect: number): number {
  gdipStart(c);
  const logos = genv(c).logos, pic = logos[normal];
  si(c, 0x3181c, pic ? pic.w : 0);
  si(c, 0x3180c, pic ? pic.h : 0);
  if (Math.imul(gi(c, 0x3181c), gi(c, 0x3180c)) === 0) return E_FAIL;
  const big = gi(c, 0x3a68);
  si(c, 0x3a68, 0x5a);
  si(c, 0x1ca4, 1);
  gvt(c, 0x1b0);
  si(c, 0x3a68, big);
  si(c, 0x1ca4, 6);
  if (gi(c, 0x2830) > gi(c, 0x3180c) || gi(c, 0x282c) > gi(c, 0x3181c)) {
    si(c, 0x282c, gi(c, 0x3181c)); si(c, 0x2830, gi(c, 0x3180c));
  }
  const w = gi(c, 0x282c), h = gi(c, 0x2830);
  const st = state < 0 ? 1 : gi(c, state);
  const px = signBitmap(st === 1 ? pic : st === 2 ? logos[hover] : null, w, h);
  lock(c, w, h);
  si(c, 0x312a8, SCAN0);
  si(c, 0x3181c, w);
  si(c, 0x3180c, h);
  const sw = ri(c, 0x9f4);
  si(c, 0x31308, sw);
  si(c, 0x31304, ri(c, 0x9f8));
  si(c, 0x31274, ri(c, 0x994) + sw * 8 + 8);
  si(c, rect, 2); si(c, rect + 4, 2); si(c, rect + 8, w); si(c, rect + 12, h);
  const I = c.m.I;
  si(c, 0x31494, 0);
  for (let r = 0; r < h; r++) {
    let d = gi(c, 0x31274) + Math.imul(r + 1, sw) * 4;
    si(c, 0x31474, 0);
    for (let x = 0; x < w; x++) {
      const s = px[r * w + x], a = s >>> 24;
      if (a === 0xff) I[d >> 2] = s | 0;
      else if (a !== 0) {
        const q = I[d >> 2];
        const k = a * K255, m = 1 - k;
        sf(c, 0x315d0, k); sf(c, 0x315cc, m);
        si(c, 0x31a2c, a);
        si(c, 0x31734, q & 0xff); si(c, 0x31768, (q >>> 8) & 0xff); si(c, 0x31770, (q >>> 16) & 0xff);
        const R = ftol(((q >>> 16) & 0xff) * m + ((s >>> 16) & 0xff) * k);
        const B = ftol((q & 0xff) * m + (s & 0xff) * k);
        const G = ftol(((q >>> 8) & 0xff) * m + ((s >>> 8) & 0xff) * k);
        si(c, 0x31998, R); si(c, 0x317ec, B); si(c, 0x318f8, G);
        I[d >> 2] = (((((R | 0xffffff00) << 8) | G) << 8) | B) | 0;
      }
      d += 4;
      si(c, 0x31474, x + 1);
    }
    si(c, 0x31270, d);
    si(c, 0x312a8, SCAN0 + Math.imul(r + 1, w) * 4);
    si(c, 0x31494, r + 1);
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------ the sizes
/** the fitted picture centred in the window (the current sprite's 0x9e8 / 0xa08), at least 8 x 8 */
function centre(c: Core): void {
  rs(c, 0x9e8, ((gi(c, 0x31514) - gi(c, 0x282c)) / 2) | 0);
  rs(c, 0xa08, -(((gi(c, 0x31518) - gi(c, 0x2830)) / 2) | 0));
  if (gi(c, 0x282c) < 8 || gi(c, 0x2830) < 8) { si(c, 0x282c, 8); si(c, 0x2830, 8); }
}

/** vt+0x1b4 0x10038180 (Picture Viz 3D's 0x100366d0): the picture's size on screen (0x282c x 0x2830) from its
 *  size (0x3181c x 0x3180c). The backdrop (sprite 6 with Flag_Show_Bkg_photo) covers the window; anything else
 *  is How_big_should_picture_be % of the window (k = 0x3a68 * 0.01, stored as floats 0x315d4 / 0x315d8), or what
 *  vt+0x1b8 leaves when the sign's button is up (0x2944) */
function fitSize(c: Core): number {
  const w = gi(c, 0x3181c), h = gi(c, 0x3180c), W = gi(c, 0x31514), H = gi(c, 0x31518);
  if (gi(c, 0x2820) !== 0 && gi(c, 0x1ca4) === 6) {
    si(c, 0x282c, W);
    const fh = ftol(W * h / w);
    si(c, 0x2830, fh);
    if (fh < H) { si(c, 0x2830, H); si(c, 0x282c, ftol(H * w / h)); }
    rs(c, 0x9e8, 0);
    return 0;
  }
  const k = gi(c, 0x3a68) * 0.01;
  sf(c, 0x315d4, k); sf(c, 0x315d8, k);
  gvt(c, 0x1b8);
  if (gi(c, 0x2944) === 0) {
    const fw = ftol(W * gf(c, 0x315d4));
    si(c, 0x282c, fw);
    const fh = ftol(fw * h / w);
    si(c, 0x2830, fh);
    const hmax = ftol(H * gf(c, 0x315d8));
    if (fh > hmax) { si(c, 0x2830, hmax); si(c, 0x282c, ftol(hmax * w / h)); }
  }
  centre(c);
  return 0;
}

/** vt+0x1b0 0x10038350: the size as Picture Viz 3D's fit has it (k = 0x3a68 * 0.01 kept as a double, the picture's
 *  size through floats), no backdrop case; the signs' fit */
function fitSign(c: Core): number {
  const k = gi(c, 0x3a68) * 0.01;
  sf(c, 0x315d4, k); sf(c, 0x315d8, k);
  const fw = ftol(gi(c, 0x31514) * k);
  si(c, 0x282c, fw);
  const hf = fr(gi(c, 0x3180c)), wf = fr(gi(c, 0x3181c));
  const fh = ftol(fw * hf / wf);
  si(c, 0x2830, fh);
  const hmax = ftol(gi(c, 0x31518) * k);
  if (fh > hmax) { si(c, 0x2830, hmax); si(c, 0x282c, ftol(hmax * wf / hf)); }
  centre(c);
  return 0;
}

/** vt+0x1b8 0x10038480: with the sign's button up (its height 0x2944, at y 0x293c), the picture takes the window's
 *  height less twice (0.4 of the button + y + 5), no wider than 0.9 of the window; else How_big = 90 */
function fitUnderSign(c: Core): number {
  const bh = gi(c, 0x2944);
  if (bh === 0) { si(c, 0x3a68, 0x5a); return 0; }
  const w = gi(c, 0x3181c), h = gi(c, 0x3180c);
  const nh = (gi(c, 0x31518) - ((ftol(bh * fr(0.4)) + gi(c, 0x293c) + 5) << 1)) | 0;
  si(c, 0x2830, nh);
  const nw = ftol(nh * w / h);
  si(c, 0x282c, nw);
  const lim = ftol(gi(c, 0x31514) * fr(0.9));
  if (nw > lim) { si(c, 0x282c, lim); si(c, 0x2830, ftol(lim * h / w)); }
  return 0;
}

// ------------------------------------------------------------------------------------------------ dressing
/** vt+0x108 0x10032400 (every frame): the backdrop's timer (How_often_should_Bkg_picture_be_changed seconds), a
 *  size change, New_Bkg_effect, a scene rebuild (0x31418) or a hover change (0x2964 / 0x294c): a new backdrop
 *  (sprite 6: the next backdrop picture, else the plain one), then the signs: Grind_Logo_0, and with
 *  Flag_Logos_on_or_off (0x291c) the two buttons, the hovered one drawn last */
function backgroundTimer(c: Core): number {
  const s = ((((tick(c) - gi(c, 0x27cc)) >>> 0) / 1000) >>> 0) | 0, bk = gi(c, 0x2894);
  si(c, 0x27d8, s);
  const resized = (): boolean => gi(c, 0x3169c) !== gi(c, 0x31518) || gi(c, 0x31694) !== gi(c, 0x31514);
  if (!((bk < s && gi(c, 0x12c0) !== -1 && gi(c, 0x31aa4) === 0 && gi(c, 0x2820) !== 0) || resized() ||
      gi(c, 0x2828) !== 0 || gi(c, 0x31418) === 1 || gi(c, 0x2964) === 1 || gi(c, 0x294c) === 1)) return 0;
  if (bk < s) { si(c, 0x2810, 0); si(c, 0x27cc, tick(c)); si(c, 0x27d8, 0); }
  si(c, 0x31aa4, 3); si(c, 0x27e0, 1); si(c, 0x27e8, 0); si(c, 0x289c, 1);
  si(c, 0x1ca4, 6);
  si(c, 0x14f4, 2);
  rs(c, 0x9e8, 0); rs(c, 0x9ec, -2000); rs(c, 0xa08, -2000); rs(c, 0x9e4, -2);
  gvt(c, 0x250);
  if (gi(c, 0x2820) === 0) gvt(c, 0x104);
  else if (gvt(c, 0x2c) === E_FAIL) gvt(c, 0x104);
  const on = gi(c, 0x291c);
  if (on === 1 && (gi(c, 0x2960) === 0 || gi(c, 0x2948) === 0)) { si(c, 0x2948, 1); si(c, 0x2960, 1); }
  if ((((gi(c, 0x2964) === 1 && gi(c, 0x2960) > 1) || (gi(c, 0x2948) > 1 && gi(c, 0x294c) === 1)) && on === 0) ||
      resized() || gi(c, 0x2940) === 0 || on === 1) {
    gvt(c, 0x3c);
    if (gi(c, 0x2960) === 2) { gvt(c, 0x38); gvt(c, 0x34); } else { gvt(c, 0x34); gvt(c, 0x38); }
  } else { si(c, 0x2948, 0); si(c, 0x2960, 0); }
  si(c, 0x294c, 0); si(c, 0x2964, 0);
  return 0;
}

/** vt+0x10c 0x1002ffa0 (Picture Viz 3D's 0x10028d20): dress the loaded photo (the edge, vt+0x110), 0x12fc = "no
 *  backdrop at all", then Direct3D (vt+0x12c, only while there is none and the window has a size), the floor
 *  texture (vt+0x154) and the camera's z (vt+0x120) */
function dressPhoto(c: Core): number {
  if (gi(c, 0x2834) === 1) { gvt(c, 0x110); si(c, 0x12fc, 0); }
  si(c, 0x12fc, gi(c, 0x2820) === 0 && gi(c, 0x281c) === 0 ? 1 : 0);
  if (gi(c, 0x1120) === -1 && Math.imul(gi(c, 0x11a8), gi(c, 0x11a4)) !== 0) gvt(c, 0x12c);
  gvt(c, 0x154);
  gvt(c, 0x120);
  return 0;
}

/** vt+0x110 0x100326c0 (Picture Viz 3D's 0x1002b370): the photo edge, only while Direct3D is not up (0x1120 = -1)
 *  and the photo has a size (else E_FAIL: the first photo, loaded before Direct3D, has none): the backdrop under
 *  the photo's rectangle (or the background colour) as a block, sprite 8 = the photo with the edge settings
 *  rendered onto it (vt+0x2bc), then that block, flipped and without alpha, becomes sprite 4's image */
function photoEdge(c: Core): number {
  const m = c.m;
  si(c, 0x1ca4, 4);
  if (!(gi(c, 0x11a4) > 0 && gi(c, 0x1120) === -1 && gi(c, 0x11a8) > 0)) return E_FAIL;
  gvt(c, 0x2d4);
  const w = gi(c, 0x11a4), h = gi(c, 0x11a8);
  si(c, 0x3180c, h); si(c, 0x3181c, w);
  si(c, 0x31a94, Math.imul(w, h));
  const p = m.malloc(gi(c, 0x31a94) * 4 + 0xc);          // (the DLL's out-of-memory exit is unreachable here)
  let I = m.I;
  I[p >> 2] = w; I[(p + 4) >> 2] = h; I[(p + 8) >> 2] = 0;
  si(c, 0x31270, p + 12); si(c, 0x31898, p + 12);
  const bgPic = gi(c, 0x2820) !== 0 || gi(c, 0x281c) !== 0;
  if (!bgPic) {
    // no backdrop: the background colour
    const n = Math.imul(gi(c, 0x3180c), gi(c, 0x3181c)), col = gi(c, 0x3131c);
    si(c, 0x31494, 0);
    for (let k = 0; k < n; k++) { I[(p + 12 + k * 4) >> 2] = col; si(c, 0x31494, k + 1); }
    if (n > 0) si(c, 0x31270, p + 12 + n * 4);
  } else {
    // the backdrop (sprite 6's image) under sprite 4's rectangle, stride = sprite 6's width
    let s = gi(c, 0x151c);
    si(c, 0x312a8, s);
    if (s === 0) return E_FAIL;
    s = (s + ((Math.imul(gi(c, 0x1134), gi(c, 0x157c)) + gi(c, 0x1130)) << 2)) | 0;
    si(c, 0x312a8, s); si(c, 0x312b0, s);
    const rows = gi(c, 0x3180c), cols = gi(c, 0x3181c), stride = gi(c, 0x157c);
    si(c, 0x31494, 0);
    for (let i = 0; i < rows; i++) {
      let r = (s + (Math.imul(stride, i) << 2)) | 0, q = gi(c, 0x31270);
      si(c, 0x31474, 0);
      for (let j = 0; j < cols; j++) { I[q >> 2] = I[r >> 2]; q += 4; r += 4; si(c, 0x31474, j + 1); }
      si(c, 0x31270, q); si(c, 0x312a8, r); si(c, 0x31494, i + 1);
    }
  }
  si(c, 0x31258, gi(c, 0x31898));
  si(c, 0x31ad0, 0); si(c, 0x31adc, 0);
  si(c, 0x31308, w); si(c, 0x31304, h);
  si(c, 0x1ca4, 4);
  si(c, 0x11c4, 0);
  rs(c, 0x980, 0); rs(c, 0xa18, 0); rs(c, 0x984, 0);
  // sprite 8 (at its absolute offsets, as the asm writes them)
  si(c, 0x18dc, 2); si(c, 0x18cc, 2); si(c, 0x1a70, 0); si(c, 0x18d0, -1);
  si(c, 0x1954, w); si(c, 0x1958, h);
  si(c, 0x1944, -2);
  si(c, 0x18fc, gi(c, 0x114c)); si(c, 0x1900, gi(c, 0x1150));
  si(c, 0x1ca4, 8);
  si(c, 0x1974, gi(c, 0x11c4));
  rs(c, 0x980, gi(c, 0x1130));
  rs(c, 0xa18, gi(c, 0x11c8));
  rs(c, 0x984, gi(c, 0x1134));
  rs(c, 0x994, gi(c, 0x1144));
  // the edge settings: size 0x283c, transparency 0x2840, special mix 0x2844, colour 0x2848, tint 0x284c, flat 0x2850
  const flat = gi(c, 0x2850);
  si(c, 0x19b0, gi(c, 0x283c));
  si(c, 0x19f8, flat);
  if (flat === 1) {
    // "flat" edge: the settings themselves are rescaled, every time this runs
    const t = ftol(gi(c, 0x2840) * 0.8);
    si(c, 0x2840, t);
    si(c, 0x284c, ftol(gi(c, 0x284c) + gi(c, 0x284c)));
    if (t < 0) si(c, 0x2840, -t | 0);
  }
  let v = gi(c, 0x2840);
  si(c, 0x19ac, v >= 0x32 ? (Math.imul(v, 5) - 250) << 1 : (Math.imul(v, 5) - 250) | 0);
  v = gi(c, 0x2844);
  if (v >= 0x32) { si(c, 0x19d8, 0); si(c, 0x19d4, ftol(((v - 0x32) | 0) * 5.1)); }
  else { si(c, 0x19d8, ftol(((0x32 - v) | 0) * 5.1)); si(c, 0x19d4, 0); }
  v = gi(c, 0x284c);
  if (v >= 0x32) { si(c, 0x19bc, 100); si(c, 0x1a74, ftol(((v - 0x32) | 0) * 5.1)); }
  else { si(c, 0x1a74, 0); si(c, 0x19bc, (v + v) | 0); }
  const col = gi(c, 0x2848);
  si(c, 0x1aac, col === 0 ? 1 : col === 0xffffff ? 2 : 0);
  si(c, 0x19a8, (col & 0xfe) | 1);                       // each channel forced odd
  si(c, 0x18dc, 3);
  si(c, 0x19a0, ((col & 0xfe0000) | 0x10000) >> 16);
  si(c, 0x19a4, ((col & 0xfe00) | 0x100) >> 8);
  gvt(c, 0x2bc);
  si(c, 0x1ca4, 8);
  si(c, 0x18f4, 0);
  si(c, 0x970, 0);                                       // absolute: sprite 0's field, as the asm has it
  gvt(c, 0x250);
  si(c, 0x18dc, 0); si(c, 0x18cc, -1); si(c, 0x1a70, -1);
  si(c, 0x1ca4, 4);
  for (const f of [0x1aac, 0x19b0, 0x19ac, 0x19d4, 0x19d8, 0x19a0, 0x19a4, 0x19a8, 0x19bc, 0x1a74, 0x19f8]) si(c, f, 0);
  gvt(c, 0x250);
  rs(c, 0x970, -1);
  rs(c, 0x994, gi(c, 0x31258));
  si(c, 0x3180c, gi(c, 0x11a8));
  si(c, 0x3181c, gi(c, 0x11a4));
  si(c, 0x31a94, Math.imul(gi(c, 0x11a4), gi(c, 0x3180c)));
  si(c, 0x3150c, 0);
  const q = m.malloc(gi(c, 0x31a94) * 4 + 0xc);
  I = m.I;
  si(c, 0x3150c, q);
  // the rendered block (now sprite 4's image), flipped vertically, alpha cleared
  let src = gi(c, 0x1144);
  si(c, 0x312a8, src);
  I[q >> 2] = gi(c, 0x31308); I[(q + 4) >> 2] = gi(c, 0x31304); I[(q + 8) >> 2] = 0;
  si(c, 0x31270, q + 12); si(c, 0x31898, q + 12);
  si(c, 0x31494, 0);
  const end = q + 12 + gi(c, 0x31a94) * 4;
  si(c, 0x31278, end);
  const rows = gi(c, 0x3180c), cols = gi(c, 0x3181c);
  for (let i = 0; i < rows; i++) {
    let d = end - Math.imul(i + 1, cols) * 4;
    si(c, 0x31474, 0);
    for (let j = 0; j < cols; j++) { I[d >> 2] = I[src >> 2] & 0xffffff; d += 4; src += 4; si(c, 0x31474, j + 1); }
    si(c, 0x31270, d); si(c, 0x312a8, src); si(c, 0x31494, i + 1);
  }
  si(c, 0x1ca4, 4);
  gvt(c, 0x250);
  rs(c, 0x970, -1);
  rs(c, 0x994, gi(c, 0x31898));
  si(c, 0x3150c, 0);
  return 0;
}

gdef({
  0x28: findPhoto, 0x2c: findBackground,
  0x34: (c) => sign(c, 3, 4, 0x2960, 0x2950),
  0x38: (c) => sign(c, 1, 2, 0x2948, 0x2938),
  0x3c: (c) => sign(c, 0, 0, -1, 0x2920),
  0x4c: loadPhoto, 0x50: loadBackground,
  0x64: countFiles,
  0x7c: (c) => seekPhoto(c, 0x2e474, 0x2278), 0x80: (c) => seekPhoto(c, 0x2e480, 0x288c),
  0x108: backgroundTimer, 0x10c: dressPhoto, 0x110: photoEdge,
  0x1b0: fitSign, 0x1b4: fitSize, 0x1b8: fitUnderSign,
});
