// Picture_Viz_III.dll's 2-D sprite engine: the Picture Viz layer compositor the DLL keeps from Picture Viz II
// (Musical Colors' engine), used here to compose the loaded photo (with its edge, tint and colour work) and the
// background into the 2-D buffers that frame.ts copies into the back buffer or turns into the floor texture.
// The functions are Picture Viz II's (pv2/compose.ts, fx.ts, fx2.ts) instruction for instruction: the same code
// at other object offsets. Sprite records: 0x1ec bytes from obj+0x96c, transform records 0xe0 bytes from
// obj+0xac (both 0x17b0 lower than PV2's), current sprite obj+0x1ca4; the work fields sit at obj+0x30e1c..
// 0x316a8 (PV2's 0x60fc..0x6a00, not at one fixed distance). Each function was checked against this DLL's
// assembly (aligned with PV2's, every field and slot mapped); where they differ the comment says so.
//
// Images are stored bottom-up ([w, h, 0] header, then w*h 0xAARRGGBB pixels). Arithmetic: x87 at 53 bits:
// float stores are Math.fround, _ftol truncates (pv2/mem.ts ftol).
import { type Core, lb, xb, vt, def } from './core';
import { ftol, fr } from '../pv2/mem';

/** FCOMP float 0.0 (0x10083400) + TEST AH,0x40: "not equal" (an unordered NaN sets C3 too: counts as equal) */
const nz = (f: number): boolean => f < 0 || f > 0;

/** 8.8 scales the DLL treats as 1.0 (no scaling): 0 and 0xfe..0x102 */
const unscaled = (v: number): boolean => v === 0 || (v >= 0xfe && v <= 0x102);

function bswap(x: number): number {
  return ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
}

const M32 = 4294967296;

/** vt+0x2b0 0x10012c30: perspective. The layer centre through the two rotations (projectPos), the scale
 *  focal / (focal + depth) (8.8, minus 0xa04) into 0x998 and 0x3145c, the size (scaleSize), the top-left
 *  0x980 / 0x984 (also 0xa14 / 0xa18); 0x30fec == 1: only the projected centre into 0x313e8 / 0x313f0. */
export function project(c: Core): number {
  const m = c.m;
  let I = m.I, F = m.F, b = lb(c);
  const hh = I[(0xa6c + b) >> 2] === 2 ? (I[(0xa08 + b) >> 2] + I[(0x9f8 + b) >> 2]) | 0 : I[(0x9f8 + b) >> 2];
  I[0x314c8 >> 2] = hh;
  I[0x30ed8 >> 2] = (I[(0x9ec + b) >> 2] + hh) | 0;
  vt(c, 0x2b4);
  I = m.I; F = m.F; b = lb(c);
  const dz = I[0x313f8 >> 2], foc = I[0x31014 >> 2];
  const t1 = (foc + dz) | 0, t2 = (I[0x3168c >> 2] + foc) | 0, t3 = (I[0x3168c >> 2] + foc + dz) | 0;
  F[0x31018 >> 2] = t1;
  F[0x31020 >> 2] = t2;
  F[0x3101c >> 2] = t3;
  if (!(t2 > 1)) F[0x31020 >> 2] = 1;              // the exact ints still on the x87 stack
  if (!(t1 > 1)) F[0x31018 >> 2] = 1;
  if (!(fr(t3) > 1)) F[0x3101c >> 2] = 1;          // reloaded from its float copy
  const q = (foc << 8) / F[0x31020 >> 2] * foc / F[0x31018 >> 2];
  F[0x313dc >> 2] = q;
  I[(0x998 + b) >> 2] = (ftol(q) - I[(0xa04 + b) >> 2]) | 0;          // of the unrounded double
  I[0x3145c >> 2] = (ftol(F[0x313dc >> 2]) - I[(0xa04 + b) >> 2]) | 0;   // of its float copy
  if (I[(0x998 + b) >> 2] < 0) { I[(0x998 + b) >> 2] = 1; I[0x3145c >> 2] = 1; }
  if (I[0x30fec >> 2] === 0) vt(c, 0x24c);
  I = m.I; F = m.F;
  const fo = I[0x31014 >> 2], ffo = fr(fo);
  const v = fo * F[0x30f7c >> 2] / F[0x31018 >> 2];
  F[0x30f7c >> 2] = v;
  const yp = I[0x316a8 >> 2] - v;
  F[0x313ac >> 2] = yp;
  const cx = I[0x313a0 >> 2];
  F[0x313a4 >> 2] = cx;
  const w2 = fr((fo << 8) / F[0x31020 >> 2]);
  F[0x31300 >> 2] = w2;
  const xs = fr(cx * w2 * K255 - I[0x31684 >> 2]);   // cx: the exact int (FILD), not its float copy
  F[0x313ec >> 2] = xs;
  const yv = yp * w2 * K255 - I[0x31688 >> 2];
  F[0x313f4 >> 2] = yv;
  if (I[0x30ff4 >> 2] === 0) {
    const q2 = (F[0x30f04 >> 2] - xs) * ffo / F[0x31018 >> 2];
    F[0x30f74 >> 2] = q2;
    F[0x313ec >> 2] = F[0x30f04 >> 2] - q2;
  }
  if (I[0x30fec >> 2] === 1) {
    I[0x313e8 >> 2] = ftol(F[0x313ec >> 2]);
    I[0x313f0 >> 2] = ftol(yv);                    // the double still on the stack
    return 0;
  }
  b = lb(c);
  F[0x313ec >> 2] = F[0x313ec >> 2] - ((I[(0x99c + b) >> 2] / 2) | 0);
  const h2 = (I[(0xa08 + b) >> 2] + I[(0x9f8 + b) >> 2]) | 0;
  F[0x313f4 >> 2] = yv - (h2 * (F[0x313dc >> 2] * 0.00390625) + 1);
  I[(0x980 + b) >> 2] = ftol(F[0x313ec >> 2] + 0.5);
  I[(0x984 + b) >> 2] = ftol(F[0x313f4 >> 2] + 0.5);
  I[(0xa14 + b) >> 2] = I[(0x980 + b) >> 2];
  I[(0xa18 + b) >> 2] = I[(0x984 + b) >> 2];
  return 0;
}

/** vt+0x2b4 0x10013040: the layer centre relative to the canvas centre (0x30f0c, 0x30f14) rotated by angle 0x31674
 *  (cos table obj+0x30274, sin table obj+0x30814, by degree), then depth 0x313f8 and height 0x30f7c from angle
 *  0x31680 over the distance to the bottom (0x316a8 = the larger canvas dimension). */
export function projectPos(c: Core): number {
  const I = c.m.I, F = c.m.F, b = lb(c);
  const cx0 = I[0x30f0c >> 2], a = I[0x31674 >> 2];
  const cx = (((I[(0x9f4 + b) >> 2] / 2) | 0) + I[(0x9e8 + b) >> 2]) | 0;
  I[0x313a0 >> 2] = cx;
  const dx = (cx - cx0) | 0, dy = (I[0x30ed8 >> 2] - I[0x30f14 >> 2]) | 0;
  I[0x311f8 >> 2] = dx;
  I[0x311fc >> 2] = dy;
  const co = F[(0x30274 >> 2) + a], sn = F[(0x30814 >> 2) + a];
  const rx = ftol(dx * co - dy * sn), ry = ftol(dy * co + dx * sn);
  I[0x30f70 >> 2] = rx;
  I[0x30f78 >> 2] = ry;
  I[0x313a0 >> 2] = (cx0 + rx) | 0;
  const y = (I[0x30f14 >> 2] + ry) | 0;
  I[0x313a8 >> 2] = y;
  I[(0x9f0 + b) >> 2] = y;
  I[0x316a8 >> 2] = I[0x310ac >> 2] < I[0x310b0 >> 2] ? I[0x310b0 >> 2] : I[0x310ac >> 2];
  const a2 = I[0x31680 >> 2], z = (I[0x316a8 >> 2] - y) | 0;
  I[0x311fc >> 2] = z;
  I[0x313f8 >> 2] = ftol(z * F[(0x30814 >> 2) + a2]);
  F[0x30f7c >> 2] = z * F[(0x30274 >> 2) + a2];
  I[(0x988 + b) >> 2] = I[0x313f8 >> 2];
  return 0;
}

/** vt+0x24c 0x10013190: the layer's on-canvas size at scale 0x3145c into 0x99c / 0x9a0 (and 0xa1c /
 *  0xa20); its 0xa08 (sign kept) into 0xa0c. */
export function scaleSize(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  I[0x30fb4 >> 2] = I[(0x9f4 + b) >> 2];
  I[0x30fb0 >> 2] = I[(0x9f8 + b) >> 2];
  const v = I[(0xa08 + b) >> 2], neg = v < 0;
  I[0x314f8 >> 2] = neg ? -v | 0 : v;
  vt(c, 0x1c8);
  I = m.I; b = lb(c);
  I[(0xa1c + b) >> 2] = I[0x30fb4 >> 2];
  I[(0xa20 + b) >> 2] = I[0x30fb0 >> 2];
  I[(0x99c + b) >> 2] = I[0x30fb4 >> 2];
  I[(0x9a0 + b) >> 2] = I[0x30fb0 >> 2];
  I[(0xa0c + b) >> 2] = neg ? -I[0x314f8 >> 2] | 0 : I[0x314f8 >> 2];
  return 0;
}

const FAIL = 0, SKIP = 1, RET = 2;

/** vt+0x29c 0x10011460: render the current layer (0x1ca4): clip its rect to the target, the edge map, then
 *  (dirty 3 only) its effects chain, each effect after a work-buffer swap (0x1a4), then the scale to its
 *  projected size (or the plain clip copy), then the draw (0x1e0). Every exit but a scaler's out-of-memory
 *  clears the four scratch-slot flags; a failure or a draw leaves dirty := 1 unless 0x30f18. */
export function renderLayer(c: Core): number {
  const m = c.m, I = m.I, b = lb(c);
  I[0x30fb4 >> 2] = I[(0x9f4 + b) >> 2];
  I[0x31160 >> 2] = I[(0x9f4 + b) >> 2];
  I[0x30fb0 >> 2] = I[(0x9f8 + b) >> 2];
  I[0x3115c >> 2] = I[(0x9f8 + b) >> 2];
  I[0x30e48 >> 2] = I[(0x994 + b) >> 2];
  I[0x30e68 >> 2] = I[(0x994 + b) >> 2];
  I[0x30e44 >> 2] = I[(0xa2c + b) >> 2];
  I[0x30e1c >> 2] = I[(0xa28 + b) >> 2];
  const t = renderBody(c);
  const J = m.I;
  if (t === RET) return 0;
  if (t === FAIL && J[0x30f18 >> 2] === 0) J[(0x97c + lb(c)) >> 2] = 1;
  J[0x3146c >> 2] = 0;
  J[0x31310 >> 2] = 0;
  J[0x31354 >> 2] = 0;
  J[0x3136c >> 2] = 0;
  return 0;
}

/** swap the work buffers (0x1a4), then the effect; false = abandon the layer */
function fx(c: Core, off: number): boolean {
  if (vt(c, 0x224) === 0) return false;
  vt(c, off);
  return true;
}

function renderBody(c: Core): number {
  const m = c.m;
  let I = m.I, F = m.F, b = lb(c), x: number;
  if (I[0x30fb4 >> 2] === 0 || I[0x30fb0 >> 2] === 0 || I[0x30e48 >> 2] === 0) return FAIL;
  I[0x3158c >> 2] = I[(0x9e4 + b) >> 2];         // the colour key
  let h: number;
  if (I[(0xa10 + b) >> 2] === 1) {               // clipped: the clipped rect
    I[0x313e8 >> 2] = I[(0xa14 + b) >> 2];
    I[0x313f0 >> 2] = I[(0xa18 + b) >> 2];
    I[0x30fb4 >> 2] = I[(0xa1c + b) >> 2];
    h = I[(0xa20 + b) >> 2];
  } else {
    I[0x313e8 >> 2] = I[(0x980 + b) >> 2];
    I[0x313f0 >> 2] = I[(0x984 + b) >> 2];
    I[0x30fb4 >> 2] = I[(0x99c + b) >> 2];
    h = I[(0x9a0 + b) >> 2];
  }
  I[0x30fb0 >> 2] = h;
  I[0x316a0 >> 2] = I[0x30fb4 >> 2];
  I[0x3169c >> 2] = h;
  vt(c, 0x1a4);
  I = m.I; b = lb(c);
  if (I[0x31048 >> 2] === 0) return SKIP;          // off the target
  I[0x31470 >> 2] = I[(0x9f4 + b) >> 2];
  I[0x31464 >> 2] = I[(0x9f8 + b) >> 2];
  if (I[(0xb50 + b) >> 2] === 3) {
    I[(0xb50 + b) >> 2] = 2;
    if (I[0x30e44 >> 2] === 0) {
      vt(c, 0x23c);
      if (m.I[0x30e44 >> 2] === 0) return FAIL;
    }
    vt(c, 0x25c);                                 // the edge-distance map
  } else if (I[(0xa50 + b) >> 2] !== 0 && I[0x30e44 >> 2] === 0) {
    vt(c, 0x23c);
    if (m.I[0x30e44 >> 2] === 0) return FAIL;
    vt(c, 0x25c);
  }
  I = m.I; b = lb(c);
  if ((I[(0xa64 + b) >> 2] !== 0 && I[(0xa60 + b) >> 2] !== 0) || (I[(0xa50 + b) >> 2] !== 0 && I[(0xa4c + b) >> 2] !== 0) ||
      I[(0xaf4 + b) >> 2] !== 0 || I[(0xa98 + b) >> 2] > 1) vt(c, 0x250);
  I = m.I; b = lb(c);
  if (I[(0x97c + b) >> 2] === 3) {
    I[(0xa24 + b) >> 2] = 0;
    x = xb(c);
    if (nz(F[(0x14c + x) >> 2]) || nz(F[(0x150 + x) >> 2])) { if (!fx(c, 0x20c)) return FAIL; }
    I = m.I; F = m.F; b = lb(c); x = xb(c);
    const t = (o: number): boolean => nz(F[(o + x) >> 2]);
    if (((t(0x13c) || t(0x138) || t(0x134)) && t(0x130)) || (I[(0xae4 + b) >> 2] !== 0 && t(0x118)) ||
        I[(0xa94 + b) >> 2] !== 0 || I[(0xa90 + b) >> 2] !== 0 || I[(0xa8c + b) >> 2] !== 0 ||
        t(0xfc) || t(0x100) || t(0x110) || t(0x10c) || t(0x108) || t(0x104)) {
      if (!fx(c, 0x1f8)) return FAIL;
    }
    I = m.I; b = lb(c);
    if (I[(0xb04 + b) >> 2] !== 0) { if (!fx(c, 0x1ec)) return FAIL; }
    I = m.I; F = m.F; b = lb(c); x = xb(c);
    const md = I[(0xab8 + b) >> 2];
    if ((((I[(0xa48 + b) >> 2] !== 0 || I[(0xa44 + b) >> 2] !== 0 || I[(0xa40 + b) >> 2] !== 0) && md <= 2 && md >= 1) || md === 3) &&
        ftol(F[(0xc8 + x) >> 2]) !== 0 && I[(0xabc + b) >> 2] !== 0) {
      if (!fx(c, 0x1f4)) return FAIL;
    }
    I = m.I; b = lb(c);
    if (I[(0xa34 + b) >> 2] !== 0 || I[(0xa38 + b) >> 2] !== 0 || I[(0xa3c + b) >> 2] !== 0 || I[(0xa5c + b) >> 2] !== 0 ||
        I[(0xa68 + b) >> 2] !== 0) { if (!fx(c, 0x200)) return FAIL; }
    I = m.I; b = lb(c);
    if (I[(0xa30 + b) >> 2] >= 2) { if (!fx(c, 0x1b0)) return FAIL; }
    F = m.F; x = xb(c);
    if (nz(F[(0x15c + x) >> 2]) || nz(F[(0x160 + x) >> 2])) { if (!fx(c, 0x208)) return FAIL; }
    I = m.I; b = lb(c);
    if (I[(0xa58 + b) >> 2] !== 0) { if (!fx(c, 0x204)) return FAIL; }
    I = m.I; b = lb(c);
    const pl = I[(0xb38 + b) >> 2];
    if (pl > 0 && pl <= I[0x31650 >> 2]) { if (!fx(c, 0x274)) return FAIL; }
  }
  I = m.I; b = lb(c);
  const sel = I[(0xa24 + b) >> 2];
  if (sel === 1 || sel === 2 || sel === 3) {      // what the last effect wrote
    const buf = I[((sel === 1 ? 0xa28 : sel === 2 ? 0xb0c : 0xa2c) + b) >> 2];
    if (buf === 0) return FAIL;
    I[0x30e48 >> 2] = buf;
    if (sel === 3) I[0x3158c >> 2] = -1;
  }
  const hid = I[(0xb10 + b) >> 2];
  if (hid === -1 || hid === 1) return FAIL;
  const sc = I[(0x998 + b) >> 2];
  I[0x3145c >> 2] = sc;
  if (unscaled(sc)) {
    if (I[0x30f94 >> 2] === 1) {                   // clipped: cut the visible part
      I[0x30fb4 >> 2] = I[0x316a0 >> 2];
      I[0x30fb0 >> 2] = I[0x3169c >> 2];
      vt(c, 0x1f0);
      I = m.I;
      if (I[0x30fe8 >> 2] === 1) return FAIL;
      const e = I[0x30e44 >> 2];
      if (I[(0xa30 + lb(c)) >> 2] === 1 && e !== 0) {   // and of the edge map
        I[0x30fb4 >> 2] = I[0x316a0 >> 2];
        I[0x30fb0 >> 2] = I[0x3169c >> 2];
        I[0x31374 >> 2] = I[0x30e48 >> 2];
        I[0x30e48 >> 2] = e;
        vt(c, 0x1f0);
        I = m.I;
        if (I[0x30fe8 >> 2] === 1) return FAIL;
        I[0x30e44 >> 2] = I[0x30e48 >> 2];
        I[0x30e48 >> 2] = I[0x31374 >> 2];
      }
    }
  } else if (I[0x30f94 >> 2] === 0) {              // scaled, whole
    vt(c, 0x1c4);
    I = m.I;
    if (I[0x30fe8 >> 2] === 1) return RET;
    const e = I[0x30e44 >> 2];
    if (e !== 0) {
      I[0x31374 >> 2] = I[0x30e48 >> 2];
      I[0x30e48 >> 2] = e;
      vt(c, 0x1c4);
      I = m.I;
      if (I[0x30fe8 >> 2] === 1) return RET;
      I[0x30e44 >> 2] = I[0x30e48 >> 2];
      I[0x30e48 >> 2] = I[0x31374 >> 2];
    }
  } else {                                        // scaled, clipped
    clippedSize(I);
    if (I[0x31158 >> 2] === 1) I[0x313f0 >> 2] = I[0x316a4 >> 2];
    else if (I[0x3114c >> 2] === 1) I[0x313f0 >> 2] = (I[0x316a4 >> 2] + I[0x30ecc >> 2] - I[0x30fb0 >> 2]) | 0;
    vt(c, 0x210);
    I = m.I;
    if (I[0x30fe8 >> 2] === 1) return RET;
    const e = I[0x30e44 >> 2];
    if (e !== 0) {
      clippedSize(I);
      I[0x31374 >> 2] = I[0x30e48 >> 2];
      I[0x30e48 >> 2] = e;
      vt(c, 0x210);
      I = m.I;
      if (I[0x30fe8 >> 2] === 1) return RET;
      I[0x30e44 >> 2] = I[0x30e48 >> 2];
      I[0x30e48 >> 2] = I[0x31374 >> 2];
    }
  }
  vt(c, 0x260);                                   // the draw
  return FAIL;                                    // falls into the dirty := 1 tail
}

/** 0x10011dd4: the visible size: projected size minus the clipped columns / rows */
function clippedSize(I: Int32Array): void {
  I[0x30fb4 >> 2] = (I[0x316a0 >> 2] - I[0x30f60 >> 2] - I[0x30f54 >> 2]) | 0;
  I[0x30fb0 >> 2] = (I[0x3169c >> 2] - I[0x30f6c >> 2] - I[0x30f48 >> 2]) | 0;
}

/** vt+0x224 0x10011f30: next work buffer: 0x30e48 = what the last effect wrote, 0x30e1c = where the next one
 *  writes (the layer's two buffers 0xa28 / 0xb0c, allocated on first use); 0xa24 = which. 0 = none. */
export function swapBuffers(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  const sel = I[(0xa24 + b) >> 2];
  if (sel === 0 || sel === 2) {
    I[0x30e48 >> 2] = I[((sel === 0 ? 0x994 : 0xb0c) + b) >> 2];
    if (I[(0xa28 + b) >> 2] === 0) {
      vt(c, 0x238);
      if (m.I[0x30e1c >> 2] === 0) return 0;
    }
    I = m.I; b = lb(c);
    I[0x30e1c >> 2] = I[(0xa28 + b) >> 2];
    I[(0xa24 + b) >> 2] = 1;
    return 1;
  }
  if (sel === 1) {
    I[0x30e48 >> 2] = I[(0xa28 + b) >> 2];
    if (I[(0xb0c + b) >> 2] === 0) {
      vt(c, 0x234);
      if (m.I[0x30e1c >> 2] === 0) return 0;
    }
    I = m.I; b = lb(c);
    I[0x30e1c >> 2] = I[(0xb0c + b) >> 2];
    I[(0xa24 + b) >> 2] = 2;
    return 1;
  }
  return 0;
}

/** a layer-sized buffer (w*h*4 + 8, from malloc) into 0x30e1c and the layer field off */
function allocLayerBuf(c: Core, off: number): number {
  const m = c.m;
  let I = m.I;
  const b = lb(c);
  const p = m.malloc((Math.imul(I[(0x9f8 + b) >> 2], I[(0x9f4 + b) >> 2]) << 2) + 8);
  I = m.I;
  I[0x30e1c >> 2] = p;
  if (p === 0) { I[0x30fe8 >> 2] = 1; return 0; }
  I[(off + lb(c)) >> 2] = p;
  return 0;
}

/** vt+0x238 0x10012760: the layer's first work buffer (0xa28) */
export function allocWork1(c: Core): number { return allocLayerBuf(c, 0xa28); }

/** vt+0x234 0x100127d0: the layer's second work buffer (0xb0c) */
export function allocWork2(c: Core): number { return allocLayerBuf(c, 0xb0c); }

/** vt+0x23c 0x100126a0: the layer's edge-distance buffer (0xa2c = 0x30e44), cleared */
export function allocEdge(c: Core): number {
  const m = c.m;
  let I = m.I, b = lb(c);
  const p = m.malloc((Math.imul(I[(0x9f8 + b) >> 2], I[(0x9f4 + b) >> 2]) << 2) + 8);
  I = m.I;
  I[0x30e44 >> 2] = p;
  if (p === 0) { I[0x30fe8 >> 2] = 1; return 0; }
  b = lb(c);
  I[(0xa2c + b) >> 2] = p;
  const n = Math.imul(I[(0x9f8 + b) >> 2], I[(0x9f4 + b) >> 2]);
  I[0x3165c >> 2] = n;
  m.U.fill(0, p >> 2, (p >> 2) + (n >>> 0));
  return 0;
}

const SLOTS = [[0x3146c, 0x31308, 0x31468], [0x31310, 0x31314, 0x3130c], [0x31354, 0x31358, 0x31350], [0x3136c, 0x31370, 0x31368]];

/** vt+0x240 0x10012480: the first free one of four scratch buffers (in-use flag, capacity, pointer), grown to
 *  0x30fb0 * 0x30fb4 * 4 when smaller, into 0x31124. All four in use: nothing. */
export function scratch(c: Core): number {
  const m = c.m;
  let I = m.I;
  for (const [f, cap, ptr] of SLOTS) {
    if (I[f >> 2] !== 0) continue;
    const need = Math.imul(I[0x30fb0 >> 2], I[0x30fb4 >> 2]) << 2;
    if (I[cap >> 2] < need) {
      if (I[ptr >> 2] !== 0) m.release(I[ptr >> 2]);
      I[cap >> 2] = need;
      const q = m.malloc(need);
      I = m.I;
      I[ptr >> 2] = q;
    }
    const p = I[ptr >> 2];
    if (p === 0) { I[0x31124 >> 2] = 0; I[0x30fe8 >> 2] = 1; return 0; }
    I[0x31124 >> 2] = p;
    I[f >> 2] = 1;
    return 0;
  }
  return 0;
}

/** vt+0x2b8 0x10012840: free the scratch slot whose buffer is 0x31144 */
export function scratchRelease(c: Core): number {
  const I = c.m.I, v = I[0x31144 >> 2];
  for (const [f, , ptr] of SLOTS) if (v === I[ptr >> 2]) { I[f >> 2] = 0; break; }
  return 0;
}

/** vt+0x1a4 0x100120f0: clip the sprite rect (0x313e8, 0x313f0, 0x30fb4 x 0x30fb0) to the target rect (0x31698,
 *  0x316a4, 0x30ed0 x 0x30ecc), unsigned as the asm compares. 0x31048 = visible, 0x30f94 = clipped; cut columns
 *  0x30f54 (left) / 0x30f60 (right), rows 0x30f6c (top) / 0x30f48 (bottom), each with its flag. */
export function clipRect(c: Core): number {
  const I = c.m.I;
  const ch = I[0x30fb0 >> 2];
  for (const o of [0x31048, 0x30f94, 0x31150, 0x31154, 0x31158, 0x3114c, 0x30f6c, 0x30f48, 0x30f60, 0x30f54]) I[o >> 2] = 0;
  I[0x313e4 >> 2] = I[0x30fb4 >> 2];
  I[0x313d4 >> 2] = ch;
  const u = (o: number): number => I[o >> 2] >>> 0;
  const x = u(0x313e8);
  if (x >= 0x80000000) {
    I[0x313e8 >> 2] = 0;
    I[0x313e4 >> 2] = (x + I[0x30fb4 >> 2]) | 0;
    I[0x30f54 >> 2] = -x | 0;
    I[0x31150 >> 2] = 1;
    if (I[0x31698 >> 2] === 0) I[0x30f94 >> 2] = 1;
  }
  const y = u(0x313f0);
  if (y >= 0x80000000) {
    I[0x313f0 >> 2] = 0;
    I[0x313d4 >> 2] = (y + I[0x30fb0 >> 2]) | 0;
    I[0x30f6c >> 2] = -y | 0;
    I[0x31158 >> 2] = 1;
    if (I[0x316a4 >> 2] === 0) I[0x30f94 >> 2] = 1;
  }
  const tx = u(0x31698), ty = u(0x316a4);
  if (u(0x313e8) >= ((tx + I[0x30ed0 >> 2]) >>> 0)) return 0;
  if (((u(0x313e8) + I[0x313e4 >> 2]) >>> 0) <= tx) return 0;
  if (u(0x313f0) >= ((ty + I[0x30ecc >> 2]) >>> 0)) return 0;
  if (((u(0x313f0) + I[0x313d4 >> 2]) >>> 0) <= ty) return 0;
  I[0x31048 >> 2] = 1;
  const r = (tx + I[0x30ed0 >> 2]) >>> 0, sx = u(0x313e8), e = (sx + I[0x313e4 >> 2]) >>> 0;
  if (r < e) { I[0x30f60 >> 2] = (e - r) | 0; I[0x31154 >> 2] = 1; I[0x30f94 >> 2] = 1; }
  if (tx > sx) {
    I[0x313e8 >> 2] = I[0x31698 >> 2];
    I[0x30f54 >> 2] = (I[0x30f54 >> 2] + (tx - sx)) | 0;
    I[0x31150 >> 2] = 1;
    I[0x30f94 >> 2] = 1;
  }
  const bt = (ty + I[0x30ecc >> 2]) >>> 0, ey = (u(0x313f0) + I[0x313d4 >> 2]) >>> 0;
  if (bt < ey) { I[0x30f48 >> 2] = (ey - bt) | 0; I[0x3114c >> 2] = 1; I[0x30f94 >> 2] = 1; }
  const sy = u(0x313f0);
  if (sy < ty) {
    I[0x30f6c >> 2] = (I[0x30f6c >> 2] + (ty - sy)) | 0;
    I[0x31158 >> 2] = 1;
    I[0x30f94 >> 2] = 1;
  }
  return 0;
}

/** vt+0x1f0 0x10012320: the unscaled clipped sprite: drop the cut rows (top: move to the target's top;
 *  bottom: the sprite is stored bottom-up, so skip that many rows of 0x30e48), then, when columns were cut,
 *  copy the visible columns into a scratch buffer, which becomes 0x30e48. */
export function clipCopy(c: Core): number {
  const m = c.m;
  let I = m.I;
  if (I[0x31158 >> 2] === 1) {
    I[0x313f0 >> 2] = I[0x316a4 >> 2];
    I[0x30fb0 >> 2] = (I[0x30fb0 >> 2] - I[0x30f6c >> 2]) | 0;
  }
  if (I[0x3114c >> 2] === 1) {
    const cut = I[0x30f48 >> 2];
    I[0x30fb0 >> 2] = (I[0x30fb0 >> 2] - cut) | 0;
    I[0x313f0 >> 2] = (I[0x316a4 >> 2] + I[0x30ecc >> 2] - I[0x30fb0 >> 2]) | 0;
    I[0x30e48 >> 2] = (I[0x30e48 >> 2] + (Math.imul(I[0x30fb4 >> 2], cut) << 2)) | 0;
  }
  if (I[0x31154 >> 2] !== 1 && I[0x31150 >> 2] !== 1) return 0;
  I[0x31148 >> 2] = I[0x30fb4 >> 2];
  I[0x30fb4 >> 2] = (I[0x30fb4 >> 2] - I[0x30f60 >> 2] - I[0x30f54 >> 2]) | 0;
  vt(c, 0x240);
  I = m.I;
  if (I[0x30fe8 >> 2] === 1) return 0;
  I[0x30f58 >> 2] = I[0x30f54 >> 2] << 2;
  const U = m.U, w = I[0x30fb4 >> 2], left = I[0x30f54 >> 2], right = I[0x30f60 >> 2];
  let s = I[0x30e48 >> 2] >> 2, d = I[0x31124 >> 2] >> 2;
  for (let r = I[0x30fb0 >> 2]; ; ) {
    s += left;
    U.copyWithin(d, s, s + w);
    s += w; d += w;
    s += right;
    if (--r === 0) break;
  }
  I[0x31144 >> 2] = I[0x30e48 >> 2];
  I[0x30e48 >> 2] = I[0x31124 >> 2];
  vt(c, 0x2b8);
  return 0;
}

/** vt+0x1c4 0x1001c3e0: scale the sprite 0x30e48 (0x31160 x 0x3115c) by 0x3145c into a scratch buffer (0x30fb4
 *  wide), which becomes 0x30e48 */
export function scaleSprite(c: Core): number { return scaleSpriteVia(c, 0x314); }

/** vt+0x210 0x1001c320: the same, emitting only the visible part (rows past 0x30f48, columns past 0x30f54,
 *  0x30fb4 x 0x30fb0 of them) */
export function scaleSpriteClipped(c: Core): number { return scaleSpriteVia(c, 0x308); }

function scaleSpriteVia(c: Core, base: number): number {
  const m = c.m;
  if (unscaled(m.I[0x3145c >> 2])) return 0;
  vt(c, 0x240);
  const I = m.I;
  if (I[0x30fe8 >> 2] === 1) return 0;
  const v = I[0x3145c >> 2];
  if (v <= 0xff) vt(c, base);
  else if (v <= 0x200) vt(c, base + 4);
  else {
    if (v > 0x300) I[0x3145c >> 2] = 0x300;
    vt(c, base + 8);
  }
  const J = m.I;
  J[0x31144 >> 2] = J[0x30e48 >> 2];
  J[0x30e48 >> 2] = J[0x31124 >> 2];
  vt(c, 0x2b8);
  return 0;
}

/** 0x1001c960 / 0x1001c9f0 / 0x1001ca90 (f = 0 / 1 / 2): the whole sprite, one step for both axes */
function ddaSprite(c: Core, f: number): number {
  const I = c.m.I;
  I[0x312e8 >> 2] = 0;
  if (f === 0) I[0x31164 >> 2] = I[0x31160 >> 2] << 2;
  I[0x313d4 >> 2] = I[0x3115c >> 2];
  const st = stepOf(I, f);
  ddaRows(c, f, f, st, st, 0x30fb4, 0);
  return 0;
}

/** 0x1001cb50 / 0x1001cc30 / 0x1001cdc0 (f = 0 / 1 / 2): the same scale, emitting only output rows past
 *  0x31408 (= 0x30f48) and columns past 0x30f54, 0x30fb4 x 0x30fb0 of them. Source rows seen 0x31074, rows
 *  emitted 0x30f88, row accumulator 0x312e8. */
function ddaClipped(c: Core, f: number): number {
  const I = c.m.I, U = c.m.U;
  I[0x30f88 >> 2] = 0;
  I[0x31074 >> 2] = 0;
  I[0x312e8 >> 2] = 0;
  I[0x31408 >> 2] = I[0x30f48 >> 2];
  if (f === 0) I[0x31164 >> 2] = I[0x31160 >> 2] << 2;
  if (f === 2) I[0x313d4 >> 2] = I[0x3115c >> 2];
  const step = stepOf(I, f), srcW = I[0x31160 >> 2], skipRows = I[0x31408 >> 2] >>> 0, outRows = I[0x30fb0 >> 2] >>> 0;
  const skipCols = I[0x30f54 >> 2] >>> 0, outW = I[0x30fb4 >> 2], rowSkip = I[0x31164 >> 2] >> 2;
  let si = I[0x30e48 >> 2] >> 2, di = I[0x31124 >> 2] >> 2, seen = 0, emitted = 0, accY = 0;
  // one output row from source row s, the first skipCols output columns dropped (0x1001cbce / 0x1001cc9d /
  // 0x1001ce47, label for label)
  const emit = (s: number): void => {
    let ebx = 0, eax = skipCols, ecx = outW, px = 0, t: number;
    if (f === 0) {
      if (eax !== 0) {
        for (;;) {
          s++;
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) continue;
          if (--eax === 0) break;
        }
      }
      for (;;) {
        U[di++] = U[s];
        if (--ecx === 0) return;
        for (;;) { s++; t = ebx + step; ebx = t >= M32 ? t - M32 : t; if (t < M32) break; }
      }
    }
    let st = 0;                                   // 0: load + store (A), 1: store again (B), 2: step (C)
    if (eax !== 0) {
      if (f === 1) {
        for (;;) {
          if (--eax === 0) { px = U[s]; s++; st = 2; break; }
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) { s++; continue; }
          if (--eax !== 0) { s++; continue; }
          s++; st = 0; break;
        }
      } else {
        for (;;) {
          if (--eax === 0) { px = U[s]; st = 1; break; }
          if (--eax === 0) { px = U[s]; st = 2; break; }
          s++;
          t = ebx + step; ebx = t >= M32 ? t - M32 : t;
          if (t >= M32) continue;
          if (--eax === 0) { st = 0; break; }
        }
      }
    }
    if (f === 1) {
      for (;;) {
        if (st === 0) { px = U[s]; U[di++] = px; s++; if (--ecx === 0) return; }
        t = ebx + step; ebx = t >= M32 ? t - M32 : t;
        st = 0;
        if (t >= M32) continue;
        U[di++] = px;
        if (--ecx === 0) return;
      }
    }
    for (;;) {
      if (st === 0) { px = U[s]; U[di++] = px; if (--ecx === 0) return; st = 1; }
      if (st === 1) { U[di++] = px; if (--ecx === 0) return; }
      s++;
      t = ebx + step; ebx = t >= M32 ? t - M32 : t;
      st = 0;
      if (t >= M32) continue;
      U[di++] = px;
      if (--ecx === 0) return;
    }
  };
  const dup = (): void => { U.copyWithin(di, di - outW, di); di += outW; };
  const nextAcc = (): boolean => { accY += step; if (accY >= M32) { accY -= M32; return true; } return false; };
  if (f === 0) {
    for (;;) {
      seen++;
      if (!(skipRows >= seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      while (nextAcc()) si += rowSkip;
    }
  } else if (f === 1) {
    for (;;) {
      if (!(skipRows > seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      seen++;
      if (nextAcc()) continue;
      seen++;
      if (skipRows >= seen) continue;
      if (outRows <= emitted) break;
      emitted++;
      if (emitted === 1) emit(si - srcW); else dup();
    }
  } else {
    let done = false;
    const extra = (): void => {                   // 0x1001cec2 / 0x1001cfa3: a repeated output row
      if (outRows <= emitted) { done = true; return; }
      emitted++;
      if (emitted === 1) emit(si - srcW); else dup();
    };
    for (;;) {
      if (!(skipRows > seen)) {
        if (outRows <= emitted) break;
        emitted++;
        emit(si);
      }
      si += srcW;
      seen += 2;
      if (!(skipRows >= seen)) { extra(); if (done) break; }
      if (nextAcc()) continue;
      seen++;
      if (skipRows >= seen) continue;
      extra();
      if (done) break;
    }
  }
  I[0x30f88 >> 2] = emitted;
  I[0x31074 >> 2] = seen;
  I[0x312e8 >> 2] = accY | 0;
  return 0;
}

/** The row DDA shared by scaleRows and the sprite scalers 0x1001c960 / 0x1001c9f0 / 0x1001ca90: source
 *  0x30e48 (0x31160 wide, 0x313d4 rows), destination 0x31124. Columns (xm): 0 = shrink (a carry of the 32-bit
 *  sum skips a source pixel), 1 = up to 2x (no carry: the pixel twice), 2 = up to 3x (twice, no carry:
 *  three times). Rows (ym) the same, by whole rows: 0 skips a source row (0x31164 bytes) on a carry, 1 and 2
 *  copy the output row just written (dupOff wide) below itself. Then pad pixels of 0x312a0. 0x312e8 is the
 *  row accumulator. */
function ddaRows(c: Core, xm: number, ym: number, stepX: number, stepY: number, dupOff: number, pad: number): void {
  const I = c.m.I, U = c.m.U;
  const srcW = I[0x31160 >> 2], skip = I[0x31164 >> 2] >> 2, padV = U[0x312a0 >> 2], dupW = I[dupOff >> 2];
  let si = I[0x30e48 >> 2] >> 2, di = I[0x31124 >> 2] >> 2, rows = I[0x313d4 >> 2], accY = I[0x312e8 >> 2] >>> 0;
  let n: number, acc: number, px: number, i: number;
  for (;;) {
    n = srcW; acc = 0;
    if (xm === 0) {
      row: for (;;) {
        U[di++] = U[si];
        for (;;) {
          si++;
          if (--n === 0) break row;
          acc += stepX;
          if (acc < M32) break;
          acc -= M32;
        }
      }
    } else if (xm === 1) {
      for (;;) {
        px = U[si++]; U[di++] = px;
        if (--n === 0) break;
        acc += stepX;
        if (acc >= M32) acc -= M32; else U[di++] = px;
      }
    } else {
      for (;;) {
        px = U[si++]; U[di++] = px; U[di++] = px;
        if (--n === 0) break;
        acc += stepX;
        if (acc >= M32) acc -= M32; else U[di++] = px;
      }
    }
    for (i = 0; i < pad; i++) U[di++] = padV;
    if (ym === 0) {
      for (;;) {
        if (--rows === 0) { I[0x313d4 >> 2] = 0; I[0x312e8 >> 2] = accY | 0; return; }
        accY += stepY;
        if (accY < M32) break;
        accY -= M32;
        si += skip;
      }
      continue;
    }
    if (ym === 2) { U.copyWithin(di, di - dupW, di); di += dupW; }
    if (--rows === 0) { I[0x313d4 >> 2] = 0; I[0x312e8 >> 2] = accY | 0; return; }
    accY += stepY;
    if (accY >= M32) { accY -= M32; continue; }
    U.copyWithin(di, di - dupW, di); di += dupW;
  }
}

/** the DDA counts of 0x1001c4a0 / 0x1001c510 / 0x1001c590 (vt+0x320 / 0x328 / 0x330; f = 0, 1, 2): how many output samples n input samples become at 8.8 scale 0x3145c */
function scaledCount(n: number, step: number, f: number): number {
  let out = f === 2 ? 2 : 1, acc = 0;
  for (;;) {
    if (--n === 0) return out;
    acc += step;
    if (acc >= M32) { acc -= M32; if (f !== 0) out += f; continue; }
    out += f + 1;
  }
}

/** the DDA step of scale 0x3145c for count/scale variant f */
function stepOf(I: Int32Array, f: number): number {
  const v = I[0x3145c >> 2];
  if (f === 0) return bswap((0x100 - v) >>> 0);
  if (f === 1) return bswap((0x200 - v) >>> 0);
  let e = (0x2ff - v + 1) >>> 0;
  if (e > 0xff) e = 0;
  return bswap(e);
}

/** 0x1001c4a0 / 0x1001c510 / 0x1001c590: 0x30fb4, 0x30fb0 and (when non-zero) 0x314f8 at scale 0x3145c */
function dimsAt(c: Core, f: number): number {
  const I = c.m.I, st = stepOf(I, f);
  I[0x30fb4 >> 2] = scaledCount(I[0x30fb4 >> 2], st, f);
  I[0x30fb0 >> 2] = scaledCount(I[0x30fb0 >> 2], st, f);
  if (I[0x314f8 >> 2] !== 0) I[0x314f8 >> 2] = scaledCount(I[0x314f8 >> 2], st, f);
  return 0;
}

/** vt+0x1c8 0x1001c220: the sprite size 0x30fb4 x 0x30fb0 (and 0x314f8) at scale 0x3145c (kept in 0x31470/0x31464) */
export function scaleDims(c: Core): number {
  const I = c.m.I, v = I[0x3145c >> 2];
  if (unscaled(v)) return 0;
  I[0x31470 >> 2] = I[0x30fb4 >> 2];
  I[0x31464 >> 2] = I[0x30fb0 >> 2];
  if (v <= 0xff) return vt(c, 0x320);
  if (v <= 0x200) return vt(c, 0x328);
  if (v > 0x300) I[0x3145c >> 2] = 0x300;
  vt(c, 0x330);
  return 0;
}

/** vt+0x274 0x1001bf60: the layer through a palette: each pixel (except the key 0x3158c) := entry (its alpha
 *  byte) of layer 0xb38's image (or its current work buffer), alpha kept; 0x30e48 -> 0x30e1c. */
export function paletteFromLayer(c: Core): number {
  const I = c.m.I, U = c.m.U, b = lb(c);
  const n = Math.imul(I[(0x9f8 + b) >> 2], I[(0x9f4 + b) >> 2]);
  I[0x3165c >> 2] = n;
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  const k = I[(0xb38 + b) >> 2], kb = k * 0x1ec;
  I[0x1cb0 >> 2] = k;
  I[0x30e7c >> 2] = I[(0x994 + kb) >> 2];
  if (I[(0xa24 + kb) >> 2] === 1) I[0x30e7c >> 2] = I[(0xa28 + kb) >> 2];
  if (I[(0xa24 + kb) >> 2] === 2) I[0x30e7c >> 2] = I[(0xb0c + kb) >> 2];
  if (I[0x30e7c >> 2] === 0) return 0;
  const pal = I[0x30e7c >> 2] >> 2;
  const key = I[0x3158c >> 2], d = I[0x30e38 >> 2] >> 2, s = I[0x30e70 >> 2] >> 2, nn = n >>> 0;
  for (let i = 0; i < nn; i++) {
    const v = U[s + i];
    if ((v & 0xffffff) !== key) U[d + i] = (U[pal + (v >>> 24)] | (v & 0xff000000)) >>> 0;
  }
  I[0x30e70 >> 2] = (I[0x30e70 >> 2] + (n << 2)) | 0;
  return 0;
}

const K255 = fr(0.003921568859368563);           // 0x10083620 (1/255 as a float)

const TAB = 0x30274 >> 2;          // obj+0x30274: the float table (cosine by degree) the colour work indexes

/** the target address of the sprite's bottom row: ((0x313f0 + 0x30fb0 - 0x316a4 - 1) * 0x30ed0 * 4) +
 *  (0x313e8 - 0x31698) * 4 + 0x30e20 (MUL: the low dword, as imul) */
function target(I: Int32Array): number {
  return (Math.imul((I[0x313f0 >> 2] + I[0x30fb0 >> 2] - I[0x316a4 >> 2] - 1) | 0, I[0x30ed0 >> 2] << 2) +
          ((I[0x313e8 >> 2] - I[0x31698 >> 2]) << 2) + I[0x30e20 >> 2]) | 0;
}

/** vt+0x25c 0x10013a80: the edge-distance map (0x30e44, low 16 bits per pixel) of the layer image 0x30e48:
 *  how far each pixel != the colour key (0x9e4) is from the shape's edge, 1..255, by up to four directional
 *  passes (0xa70 bits: 8 left-to-right, 4 right-to-left, 2 top-down, 1 bottom-up; 0 = all); the first key
 *  pixel after a run gets 0xffff OR'd in. 0xb54 := the largest distance. */
export function edgeDistance(c: Core): number {
  const m = c.m, I = m.I, U = m.U, L = lb(c);
  let md = I[(0xa70 + L) >> 2];
  I[0x312cc >> 2] = md;
  md &= 0xf;
  if (md === 0) md = 0xf;
  I[0x312cc >> 2] = md;
  const key = I[(0x9e4 + L) >> 2] >>> 0;
  I[0x3158c >> 2] = key;
  const w = I[(0x9f4 + L) >> 2], h = I[(0x9f8 + L) >> 2], n = Math.imul(w, h), nn = n >>> 0;
  I[0x3165c >> 2] = n;
  I[0x31658 >> 2] = n << 2;
  I[0x30fa8 >> 2] = w;
  I[0x31454 >> 2] = w;
  const srcA = I[0x30e48 >> 2], dstA = I[0x30e44 >> 2], src = srcA >> 2, dst = dstA >> 2;
  I[0x30fa0 >> 2] = (srcA + (n << 2) - 4) | 0;
  I[0x30f9c >> 2] = (dstA + (n << 2) - 4) | 0;
  let mx = 0, e = 0, cnt = 0, i = 0, q = 0, r = 0, col = 0;
  if ((md & 8) === 0) {
    for (i = 0; i < nn; i++) if (U[src + i] !== key) U[dst + i] = 0xfffe;   // the whole dword
  } else {
    cnt = w;
    for (i = 0; i < nn; i++) {
      if (U[src + i] !== key) {
        if (++e > 0xff) e = 0xff;
        U[dst + i] = ((U[dst + i] & 0xffff0000) | e) >>> 0;
        if (e > mx) mx = e;
      } else {
        if (e !== 0) e = 0xffff;
        U[dst + i] = (U[dst + i] | e) >>> 0;
        e = 0;
      }
      if (--cnt === 0) { e = 0; cnt = w; }
    }
  }
  // passes 4, 2, 1: the distance only ever shortens (0x10013cc2)
  const lower = (k: number): void => {
    if (U[src + k] !== key) {
      if (++e > 0xff) e = 0xff;
      const v = U[dst + k] & 0xffff;
      if (v > e) { U[dst + k] = ((U[dst + k] & 0xffff0000) | e) >>> 0; if (e > mx) mx = e; }
    } else {
      if (e !== 0) e = 0xffff;
      U[dst + k] = (U[dst + k] | e) >>> 0;
      e = 0;
    }
  };
  if (md & 4) {
    e = 0; cnt = w;
    for (i = nn - 1; i >= 0; i--) {
      lower(i);
      if (--cnt === 0) { e = 0; cnt = w; }
    }
  }
  I[0x30fa4 >> 2] = h;
  I[0x31450 >> 2] = h;
  I[0x31454 >> 2] = w << 2;
  if (md & 2) {
    e = 0;
    for (col = 0; col < w; col++) {
      for (r = 0, q = col; r < h; r++, q += w) lower(q);
      e = 0;
    }
    I[0x31444 >> 2] = (dstA + (w << 2)) | 0;
    I[0x31460 >> 2] = (srcA + (w << 2)) | 0;
  }
  I[0x30fa8 >> 2] = w;
  I[0x30fa4 >> 2] = h;
  I[0x31450 >> 2] = h;
  I[0x31454 >> 2] = w << 2;
  if (md & 1) {
    e = 0;
    for (col = 0; col < w; col++) {
      for (r = 0, q = nn - 1 - col; r < h; r++, q -= w) lower(q);
      e = 0;
    }
    I[0x30f9c >> 2] = (I[0x30f9c >> 2] - (w << 2)) | 0;
    I[0x30fa0 >> 2] = (I[0x30fa0 >> 2] - (w << 2)) | 0;
    I[0x30fa8 >> 2] = 0;
  }
  I[0x31080 >> 2] = mx;
  I[(0xb54 + L) >> 2] = mx;
  return 0;
}

/** vt+0x260 0x10013fc0: the layer image (0x30e48, 0x30fb4 x 0x30fb0) onto the target (0x30e20, 0x30ed0 wide).
 *  0xa30 == 1 first grabs the background under the key pixels (vt+0x264) and recolours it (vt+0x200). Any
 *  colour / alpha effect goes through the blend (vt+0x26c); a transform alpha (0x164) through the alpha
 *  copy (vt+0x268); else a plain copy, colour-keyed unless the key is -1. */
export function draw(c: Core): number {
  let I = c.m.I;
  if (I[0x30fb4 >> 2] === 0 || I[0x30e48 >> 2] === 0 || I[0x30fb0 >> 2] === 0) return 0;
  I[0x30fb8 >> 2] = I[0x30fb4 >> 2] << 2;
  I[0x30ed4 >> 2] = I[0x30ed0 >> 2] << 2;
  let L = lb(c);
  if (I[(0xa30 + L) >> 2] === 1) {
    vt(c, 0x264);
    I = c.m.I; L = lb(c);
    if (I[(0xa34 + L) >> 2] !== 0 || I[(0xa38 + L) >> 2] !== 0 || I[(0xa3c + L) >> 2] !== 0 ||
        I[(0xa5c + L) >> 2] !== 0 || I[(0xa68 + L) >> 2] !== 0) {
      I[0x31470 >> 2] = I[0x30fb4 >> 2];
      I[0x31464 >> 2] = I[0x30fb0 >> 2];
      I[0x30e1c >> 2] = I[0x30e48 >> 2];
      vt(c, 0x200);
      I = c.m.I;
    }
  }
  L = lb(c);
  const X = xb(c), F = c.m.F;
  I[0x31690 >> 2] = 0;
  const v2268 = I[(0xab8 + L) >> 2];
  const blend = (I[(0xaf4 + L) >> 2] !== 0 && I[(0xa58 + L) >> 2] !== 0) ||
    (I[(0xa64 + L) >> 2] !== 0 && I[(0xa60 + L) >> 2] !== 0) ||
    (I[(0xa50 + L) >> 2] !== 0 && I[(0xa4c + L) >> 2] !== 0) ||
    (I[(0xac0 + L) >> 2] !== 0 && v2268 === 1) ||
    ftol(F[(0x184 + X) >> 2]) !== 0 || I[(0xb4c + L) >> 2] !== 0 || I[(0xa98 + L) >> 2] > 1 ||
    v2268 === 3 || v2268 === 2;
  if (blend) { vt(c, 0x26c); return 0; }
  if (F[(0x164 + X) >> 2] !== 0) { vt(c, 0x268); return 0; }   // FCOMP + TEST AH,0x40: NaN counts as 0
  const U = c.m.U, key = I[0x3158c >> 2] >>> 0, w = I[0x30fb4 >> 2] >>> 0;
  let rows = I[0x30fb0 >> 2], si = I[0x30e48 >> 2] >> 2, di = target(I) >> 2, i = 0;
  const up = (I[0x30fb8 >> 2] + I[0x30ed4 >> 2]) >> 2;
  if (key !== 0xffffffff) {
    do {
      for (i = 0; i < w; i++) { const px = U[si++]; if (px !== key) U[di] = px; di++; }
      di -= up;
    } while (--rows !== 0);
  } else {
    do {
      for (i = 0; i < w; i++) U[di++] = U[si++];
      di -= up;
    } while (--rows !== 0);
  }
  return 0;
}

/** vt+0x26c 0x10014290: per pixel by its alpha byte: 0 = copy, 255 = keep the target, else
 *  src*(1-a)+dst*a (+ the layer's biases 0xa74 / 0xa78), optionally pulled toward the tint
 *  0xa40/0xa44/0xa48 by 0xb14; the source alpha is kept. 0xb4c 1 / 2 hand over to the fades.
 *  obj+0x31690 = extra source bytes per row. */
export function blend(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c);
  const mode = I[(0xb4c + L) >> 2];
  if (mode === 1) { vt(c, 0x338); return 0; }
  if (mode === 2) { vt(c, 0x33c); return 0; }
  I[0x30ed4 >> 2] = I[0x30ed0 >> 2] << 2;
  const w = I[0x30fb4 >> 2], h = I[0x30fb0 >> 2];
  I[0x31470 >> 2] = w;
  I[0x31464 >> 2] = h;
  F[0x31448 >> 2] = I[(0xa74 + L) >> 2] / 255;
  F[0x3144c >> 2] = I[(0xa78 + L) >> 2] / 255;
  F[0x31458 >> 2] = I[(0xb14 + L) >> 2] / 255;
  const tr = I[0x315ec >> 2] = I[(0xa40 + L) >> 2];
  const tg = I[0x315e8 >> 2] = I[(0xa44 + L) >> 2];
  const tb = I[0x315e0 >> 2] = I[(0xa48 + L) >> 2];
  const bias1 = F[0x31448 >> 2], bias2 = F[0x3144c >> 2], kt = F[0x31458 >> 2], tint = I[(0xb14 + L) >> 2] !== 0;
  const key = I[0x3158c >> 2] >>> 0, up = (w + (I[0x30ed4 >> 2] >> 2)) | 0, skip = I[0x31690 >> 2];
  let di = target(I) >> 2, sa = I[0x30e48 >> 2], rows = h, cnt = w, lastD = 0, lastS = 0, any = false;
  let a = 0, sr = 0, sg = 0, sb = 0, dr = 0, dg = 0, db = 0, r = 0, g = 0, b = 0, t10 = 0, t14 = 0;
  for (;;) {
    lastD = di; lastS = sa;
    const px = U[sa >> 2];
    if (px !== key) {
      const top = px >>> 24;
      if (top === 0) U[di] = px;
      else if (top !== 0xff) {
        a = top; any = true;
        sb = px & 0xff; sg = (px >>> 8) & 0xff; sr = (px >>> 16) & 0xff;
        const dd = U[di];
        db = dd & 0xff; dg = (dd >>> 8) & 0xff; dr = (dd >>> 16) & 0xff;
        t10 = fr(a / 255);
        t14 = fr(1 - t10);
        t10 = fr(t10 + bias1);
        t14 = fr(t14 + bias2);
        r = ftol(sr * t14 + dr * t10);
        b = ftol(sb * t14 + db * t10);
        g = ftol(sg * t14 + dg * t10);
        if (tint) {
          if (tr !== 0) r = (r + ftol(((tr - r) | 0) * kt * t10)) | 0;
          if (tb !== 0) b = (b + ftol(((tb - b) | 0) * kt * t10)) | 0;
          if (tg !== 0) g = (g + ftol(((tg - g) | 0) * kt * t10)) | 0;
          if (r > 0xff) r = 0xff;
          if (b > 0xff) b = 0xff;
          if (g > 0xff) g = 0xff;
        }
        if (r < 0) r = 0;
        if (b < 0) b = 0;
        if (g < 0) g = 0;
        U[di] = ((a << 24) | (r > 0xff ? 0xff : r) << 16 | (g > 0xff ? 0xff : g) << 8 | (b > 0xff ? 0xff : b)) >>> 0;
      }
    }
    sa += 4; di++;
    if (--cnt !== 0) continue;
    cnt = w;
    di -= up;
    sa = (sa + skip) | 0;
    if (--rows === 0) break;
  }
  I[0x31250 >> 2] = lastD << 2;
  I[0x31254 >> 2] = lastS;
  I[0x31464 >> 2] = 0;
  if (any) {
    I[0x315f4 >> 2] = a; I[0x315f8 >> 2] = a << 24;
    I[0x31560 >> 2] = r; I[0x313b4 >> 2] = b; I[0x314c0 >> 2] = g;
    I[0x312fc >> 2] = db; I[0x31330 >> 2] = dg; I[0x31338 >> 2] = dr;
    F[0x31194 >> 2] = t10; F[0x31198 >> 2] = t14;
  }
  return 0;
}

/** the two fades' shared loop: f maps a pixel with alpha 1..254 (alpha byte kept) */
function fadeLoop(c: Core, full: number, f: (px: number, a: number) => number): void {
  const m = c.m, I = m.I, U = m.U;
  const w = I[0x30fb4 >> 2];
  I[0x31470 >> 2] = w;
  I[0x30ed4 >> 2] = (I[0x30ed0 >> 2] + w) << 2;
  I[0x31464 >> 2] = I[0x30fb0 >> 2];
  const key = I[0x3158c >> 2] >>> 0, up = I[0x30ed4 >> 2] >> 2, ww = w >>> 0;
  let di = target(I) >> 2, si = I[0x30e48 >> 2] >> 2, rows = I[0x30fb0 >> 2];
  do {
    for (let i = 0; i < ww; i++, si++, di++) {
      const px = U[si];
      if (px === key) continue;
      const a = px >>> 24;
      if (a === 0) U[di] = px;
      else if (a !== 0xff) U[di] = f(px, a);
      else if (full >= 0) U[di] = full;
    }
    di -= up;
  } while (--rows !== 0);
  I[0x31464 >> 2] = 0;
}

/** vt+0x338 0x10014840: subtract the alpha byte from each channel (saturating at 0), alpha kept; alpha 255
 *  leaves the target. */
export function fadeSub(c: Core): number {
  fadeLoop(c, -1, (px, a) => {
    const r = ((px >>> 16) & 0xff) - a, g = ((px >>> 8) & 0xff) - a, b = (px & 0xff) - a;
    return ((a << 24) | (r < 0 ? 0 : r) << 16 | (g < 0 ? 0 : g) << 8 | (b < 0 ? 0 : b)) >>> 0;
  });
  return 0;
}

/** vt+0x33c 0x10014930: add the alpha byte to each channel (saturating at 255), alpha kept; alpha 255
 *  writes 0xffffffff. */
export function fadeAdd(c: Core): number {
  fadeLoop(c, 0xffffffff, (px, a) => {
    const r = ((px >>> 16) & 0xff) + a, g = ((px >>> 8) & 0xff) + a, b = (px & 0xff) + a;
    return ((a << 24) | (r > 0xff ? 0xff : r) << 16 | (g > 0xff ? 0xff : g) << 8 | (b > 0xff ? 0xff : b)) >>> 0;
  });
  return 0;
}

/** vt+0x268 0x10014a30: the layer onto the target at the transform's alpha 0x164 (clamped to 0..255; 255 =
 *  invisible, nothing drawn): src*(1-a)+dst*a + the biases 0xa74 / 0xa78, colour-keyed. The result's top
 *  byte is its red (BSWAP of r,r). */
export function alphaCopy(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c), X = xb(c);
  if (F[(0x164 + X) >> 2] < 0) F[(0x164 + X) >> 2] = 0;
  if (!(F[(0x164 + X) >> 2] < 255)) { F[(0x164 + X) >> 2] = 255; return 0; }
  I[0x30ed4 >> 2] = I[0x30ed0 >> 2] << 2;
  const a = I[0x315f4 >> 2] = ftol(F[(0x164 + X) >> 2]);
  const w = I[0x30fb4 >> 2];
  I[0x31470 >> 2] = w;
  I[0x31464 >> 2] = I[0x30fb0 >> 2];
  F[0x31448 >> 2] = I[(0xa74 + L) >> 2] / 255;
  F[0x3144c >> 2] = I[(0xa78 + L) >> 2] / 255;
  F[0x31194 >> 2] = a / 255;
  F[0x31198 >> 2] = 1 - F[0x31194 >> 2];
  F[0x31194 >> 2] = F[0x31194 >> 2] + F[0x31448 >> 2];
  F[0x31198 >> 2] = F[0x31198 >> 2] + F[0x3144c >> 2];
  const t10 = F[0x31194 >> 2], t14 = F[0x31198 >> 2], key = I[0x3158c >> 2] >>> 0;
  const up = (w + (I[0x30ed4 >> 2] >> 2)) | 0, ww = w >>> 0;
  let di = target(I) >> 2, si = I[0x30e48 >> 2] >> 2, rows = I[0x30fb0 >> 2], any = false;
  let r = 0, g = 0, b = 0, dr = 0, dg = 0, db = 0, nr = false, ng = false, nb = false;
  do {
    for (let i = 0; i < ww; i++, si++, di++) {
      const px = U[si];
      if (px === key) continue;
      any = true;
      const dd = U[di];
      db = dd & 0xff; dg = (dd >>> 8) & 0xff; dr = (dd >>> 16) & 0xff;
      r = ftol(((px >>> 16) & 0xff) * t14 + dr * t10);
      b = ftol((px & 0xff) * t14 + db * t10);
      g = ftol(((px >>> 8) & 0xff) * t14 + dg * t10);
      // 0x10014d23: the "< 0" clamps store 0 into 0x314a4 / 0x31480 / 0x31494, not into the channels, so a
      // negative channel reaches the unsigned "> 0xff" clamp and becomes 0xff
      if (r < 0) nr = true;
      if (b < 0) nb = true;
      if (g < 0) ng = true;
      const R = (r >>> 0) > 0xff ? 0xff : r, G = (g >>> 0) > 0xff ? 0xff : g, B = (b >>> 0) > 0xff ? 0xff : b;
      U[di] = ((R << 24) | (R << 16) | (G << 8) | B) >>> 0;
    }
    di -= up;
  } while (--rows !== 0);
  I[0x31464 >> 2] = 0;
  if (nr) I[0x314a4 >> 2] = 0;
  if (nb) I[0x31480 >> 2] = 0;
  if (ng) I[0x31494 >> 2] = 0;
  if (any) {
    I[0x31560 >> 2] = r; I[0x313b4 >> 2] = b; I[0x314c0 >> 2] = g;
    I[0x312fc >> 2] = db; I[0x31330 >> 2] = dg; I[0x31338 >> 2] = dr;
  }
  if (ww !== 0) {
    I[0x31250 >> 2] = (di + up - 1) << 2;       // the last pixel's addresses
    I[0x31254 >> 2] = (si - 1) << 2;
  }
  return 0;
}

/** vt+0x264 0x10014e00: the reverse copy: every non-key pixel of the layer image (all of them when the key
 *  is -1) takes the target pixel under it (rows walking up the target, as the draws do). */
export function grabBackground(c: Core): number {
  const m = c.m, I = m.I, U = m.U;
  I[0x30ed4 >> 2] = I[0x30ed0 >> 2] << 2;
  const key = I[0x3158c >> 2] >>> 0, w = I[0x30fb4 >> 2] >>> 0, up = (I[0x30fb4 >> 2] + (I[0x30ed4 >> 2] >> 2)) | 0;
  let di = target(I) >> 2, si = I[0x30e48 >> 2] >> 2, rows = I[0x30fb0 >> 2], i = 0;
  if (key !== 0xffffffff) {
    do {
      for (i = 0; i < w; i++, si++, di++) if (U[si] !== key) U[si] = U[di];
      di -= up;
    } while (--rows !== 0);
  } else {
    do {
      for (i = 0; i < w; i++) U[si++] = U[di++];
      di -= up;
    } while (--rows !== 0);
  }
  return 0;
}

/** vt+0x200 0x10014ed0: per-pixel colour work from 0x30e48 into 0x30e1c (0x31470 x 0x31464 pixels): a hue
 *  turn (0xa34: channel swap by quadrant, then a cos blend of the channels), a brightness bias (0xa38),
 *  a pull toward the tint 0xa40/0xa44/0xa48 by 0xa3c %, a ring-shaped tint by edge distance (0xa5c,
 *  0xa50) and a thresholded tint (0xa60, 0xa68); 0xb1c 1 / 2 scale the hue and brightness by cos of the
 *  transform's spin angle 0x120 / 0x128, 0xa7c the tints by cos of a fixed angle. Alpha is kept. */
export function colourWork(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, B8 = m.B, L = lb(c), X = xb(c);
  const Lf = (o: number): number => I[(o + L) >> 2];
  const hv = Lf(0xa34), spin = Lf(0xb1c);
  if (hv !== 0) {
    let t = hv;
    if (spin === 1) t = ftol(t * F[TAB + ftol(F[(0x120 + X) >> 2])]);
    if (spin === 2) t = ftol(t * F[TAB + ftol(F[(0x128 + X) >> 2])]);
    if (t < 0) t = -t | 0;
    while (t > 0x5a) t -= 0x5a;
    I[0x314d4 >> 2] = t;
  }
  if ((Lf(0xa3c) | Lf(0xa5c) | Lf(0xa68)) !== 0) {
    I[0x315ec >> 2] = Lf(0xa40); I[0x315e8 >> 2] = Lf(0xa44); I[0x315e0 >> 2] = Lf(0xa48);
    F[0x314b4 >> 2] = I[0x315ec >> 2]; F[0x314b0 >> 2] = I[0x315e8 >> 2]; F[0x314a8 >> 2] = I[0x315e0 >> 2];
    F[0x314b8 >> 2] = Lf(0xa60) > 0 ? (0xff - Lf(0xa60)) | 0 : -Lf(0xa60) | 0;
    F[0x311b0 >> 2] = Lf(0xa3c) / 100;
    F[0x311b8 >> 2] = Lf(0xa68) / 100;
    F[0x311b0 >> 2] = F[0x311b0 >> 2] * F[TAB + Lf(0xa7c)];
    F[0x311b8 >> 2] = F[0x311b8 >> 2] * F[TAB + Lf(0xa7c)];
  }
  const ring = I[0x311e4 >> 2] = Lf(0xa50);
  if (ring !== 0) {
    I[0x30f98 >> 2] = (I[0x30e44 >> 2] + Math.imul(Math.imul(I[0x30fb4 >> 2] << 2, I[0x30fb0 >> 2]), 4)) | 0;
    F[0x31090 >> 2] = Lf(0xa5c);
    if (F[0x31090 >> 2] < 0) F[0x31090 >> 2] = -F[0x31090 >> 2];
    F[0x30f68 >> 2] = F[0x31090 >> 2] / ring;
    F[0x31090 >> 2] = F[0x31090 >> 2] + F[0x30f68 >> 2];
  }
  const src = I[0x30e48 >> 2], dst = I[0x30e1c >> 2];
  I[0x30e2c >> 2] = src;
  I[0x30e30 >> 2] = dst;
  const n = Math.imul(I[0x31470 >> 2], I[0x31464 >> 2]);
  I[0x311dc >> 2] = n;
  F[0x31484 >> 2] = Lf(0xa38);
  if (Lf(0xa38) !== 0) {
    if (spin === 1) F[0x31484 >> 2] = F[0x31484 >> 2] * F[TAB + ftol(F[(0x120 + X) >> 2])];
    if (spin === 2) F[0x31484 >> 2] = F[0x31484 >> 2] * F[TAB + ftol(F[(0x128 + X) >> 2])];
  }
  // loop invariants (nothing in the loop writes them)
  const key = I[0x3158c >> 2] >>> 0, cosH = F[TAB + I[0x314d4 >> 2]], bright = Lf(0xa38) !== 0, kB = F[0x31484 >> 2];
  const anyT = (I[0x315ec >> 2] | I[0x315e8 >> 2] | I[0x315e0 >> 2]) !== 0;
  const onR = I[0x315ec >> 2] !== 0, onG = I[0x315e8 >> 2] !== 0, onB = I[0x315e0 >> 2] !== 0;
  const tR = F[0x314b4 >> 2], tG = F[0x314b0 >> 2], tB = F[0x314a8 >> 2], k64e4 = F[0x311b0 >> 2], k64ec = F[0x311b8 >> 2];
  const pct = Lf(0xa3c) !== 0, ringOn = Lf(0xa5c) !== 0 && ring !== 0, ringPos = Lf(0xa5c) > 0;
  const r63b0 = F[0x31090 >> 2], r6268 = F[0x30f68 >> 2], cosT = F[TAB + Lf(0xa7c)], ringU = ring >>> 0;
  const thrOn = Lf(0xa60) !== 0 && Lf(0xa68) !== 0, thrHi = Lf(0xa60) > 0, thr = F[0x314b8 >> 2];
  const edge = I[0x30e44 >> 2];
  let R = 0, G = 0, Bc = 0, a = 0, r = 0, g = 0, b = 0, any = false, ringHit = false, v6208 = 0, k64e8 = 0;
  let p64 = 0, p60 = 0, p5c = 0, pa8 = 0, pa4 = 0, pa0 = 0, hue = false;
  for (let i = 0, nn = n >>> 0; i < nn; i++) {
    const sp = (src + i * 4) | 0, dp = (dst + i * 4) | 0, px = U[sp >> 2];
    if (px === key) { if (dp !== sp) U[dp >> 2] = px; continue; }
    any = true;
    a = px >>> 24; b = px & 0xff; g = (px >>> 8) & 0xff; r = (px >>> 16) & 0xff;
    R = r; G = g; Bc = b;
    if (hv !== 0) {
      hue = true;
      if (hv >= 0x5a || hv <= -0xb4) { R = g; Bc = r; G = b; }          // 0x100155dc
      else if (hv <= -0x5a) { R = b; Bc = g; G = r; }                     // 0x100155a1
      p64 = fr(R * cosH); p60 = fr(G * cosH); p5c = fr(Bc * cosH);
      pa8 = fr(R - p64); pa4 = fr(G - p60); pa0 = fr(Bc - p5c);
      if (hv < 0) { R = fr(p64 + pa0); G = fr(p60 + pa8); Bc = fr(p5c + pa4); }
      else { R = fr(p64 + pa4); G = fr(p60 + pa0); Bc = fr(p5c + pa8); }
    }
    if (bright) { R = fr(R + kB); G = fr(G + kB); Bc = fr(Bc + kB); }
    if (anyT) {
      if (pct) {
        if (onR) R = fr((tR - R) * k64e4 + R);
        if (onG) G = fr((tG - G) * k64e4 + G);
        if (onB) Bc = fr((tB - Bc) * k64e4 + Bc);
      }
      ring: if (ringOn) {
        const d = B8[(edge - (src - sp)) | 0];             // word load AND 0xff: the low byte
        if (ringPos) {
          if (d > ringU) break ring;
          v6208 = d;
        } else {
          v6208 = 1;
          if (d < ringU) v6208 = (ring - d) | 0;
        }
        ringHit = true;
        k64e8 = fr((r63b0 - v6208 * r6268) / 100);
        k64e8 = fr(k64e8 * cosT);
        if (onR) R = fr((tR - R) * k64e8 + R);
        if (onG) G = fr((tG - G) * k64e8 + G);
        if (onB) Bc = fr((tB - Bc) * k64e8 + Bc);
      }
      if (thrOn) {
        if (onR && (thrHi ? !(R < thr) : R < thr)) R = fr((tR - R) * k64ec + R);
        if (onG && (thrHi ? !(G < thr) : G < thr)) G = fr((tG - G) * k64ec + G);
        if (onB && (thrHi ? !(Bc < thr) : Bc < thr)) Bc = fr((tB - Bc) * k64ec + Bc);
      }
    }
    if (R < 0) R = 0;
    if (G < 0) G = 0;
    if (Bc < 0) Bc = 0;
    if (R > 255) R = 255;
    if (G > 255) G = 255;
    if (Bc > 255) Bc = 255;
    r = ftol(R); g = ftol(G); b = ftol(Bc);
    U[dp >> 2] = ((((a << 8 | r) << 8 | g) << 8) | b) >>> 0;
  }
  I[0x30e2c >> 2] = (src + n * 4) | 0;
  I[0x30e30 >> 2] = (dst + n * 4) | 0;
  I[0x311dc >> 2] = 0;
  if (any) {
    I[0x31380 >> 2] = a; I[0x31560 >> 2] = r; I[0x314c0 >> 2] = g; I[0x313b4 >> 2] = b;
    F[0x314a4 >> 2] = R; F[0x31494 >> 2] = G; F[0x31480 >> 2] = Bc;
  }
  if (hue) {
    F[0x31320 >> 2] = p64; F[0x3131c >> 2] = p60; F[0x31318 >> 2] = p5c;
    F[0x31364 >> 2] = pa8; F[0x31360 >> 2] = pa4; F[0x3135c >> 2] = pa0;
  }
  if (ringHit) { I[0x30f2c >> 2] = v6208; F[0x311b4 >> 2] = k64e8; }
  return 0;
}

/** the mask-layer alpha (0x10016e17 / 0x100168b5): 0xa98 = k in 2..0x31650 takes layer k's image (0x994;
 *  0xa24 1 / 2: its work buffers 0xa28 / 0xb0c, none = stop) as an alpha mask: alpha = (keep ? alpha : 0)
 *  + 255 - the mask pixel's blue, saturating. Skipped when this layer has more pixels than layer k. */
function maskAlpha(c: Core, keep: boolean): void {
  const m = c.m, I = m.I, U = m.U, L = lb(c);
  const k = I[(0xa98 + L) >> 2];
  if (!(k > 1 && k <= I[0x31650 >> 2])) return;
  I[0x3103c >> 2] = k;
  const K = Math.imul(k, 0x1ec), n = Math.imul(I[0x31470 >> 2], I[0x31464 >> 2]);
  I[0x311dc >> 2] = n;
  if (n > Math.imul(I[(0x9f4 + K) >> 2], I[(0x9f8 + K) >> 2])) return;
  I[0x31374 >> 2] = I[(0x994 + K) >> 2];
  const sel = I[(0xa24 + K) >> 2];
  if (sel === 1 || sel === 2) {
    const p = I[((sel === 1 ? 0xa28 : 0xb0c) + K) >> 2];
    if (p === 0) return;
    I[0x31374 >> 2] = p;
  }
  const key = I[0x3158c >> 2] >>> 0, src = I[0x30e48 >> 2] >> 2, mk = I[0x31374 >> 2] >> 2;
  for (let i = 0, nn = n >>> 0; i < nn; i++) {
    const px = U[src + i];
    if (px === key) continue;
    const add = 0xff - (U[mk + i] & 0xff);
    const top = (keep ? px >>> 24 : 0) + add;
    U[src + i] = ((top > 0xff ? 0xff : top) << 24 | (px & 0xffffff)) >>> 0;
  }
  I[0x311dc >> 2] = 0;
}

/** vt+0x250 0x10015f70: the alpha byte of the layer image 0x30e48, in place: a ring of width 0xa50 round the
 *  shape's edge (the edge-distance map 0x30e44) fading by 0xa4c, a brightness term (0xa64 / 0xa60), on
 *  top of the transform's base alpha 0x164, then the mask-layer alpha (0xa98 > 1). Skipped while the
 *  parameter signature stored in the dword before the pixels is unchanged (0xb50 == 2: once, unchecked). */
export function alphaRing(c: Core): number {
  const m = c.m, I = m.I, F = m.F, U = m.U, L = lb(c), X = xb(c);
  const Lf = (o: number): number => I[(o + L) >> 2];
  if (Lf(0xb50) === 2) I[(0xb50 + L) >> 2] = 1;
  else {
    const sig = (Lf(0xa50) + Math.imul(Lf(0xa4c), 0xff) + (Lf(0xa64) << 9) + Lf(0xa60) + ftol(F[(0x164 + X) >> 2]) +
                 Math.imul(Lf(0xaf4), 3) + Lf(0xa98) + Lf(0xa9c) + 1) | 0;
    I[0x30e98 >> 2] = sig;
    const sp = (I[0x30e48 >> 2] - 4) >> 2;
    if (I[sp] === sig) return 0;
    I[sp] = sig;
  }
  const n = Math.imul(I[0x31470 >> 2], I[0x31464 >> 2]);
  I[0x311dc >> 2] = n;
  const ring = I[0x311e4 >> 2] = Lf(0xa50);
  I[0x31568 >> 2] = I[(0x164 + X) >> 2];          // MOV: the float's bits
  I[0x31600 >> 2] = 0;
  I[0x315fc >> 2] = 0;
  if (ring !== 0) {
    I[0x31080 >> 2] = Lf(0xb54);
    I[0x315b0 >> 2] = Lf(0xa4c);
    I[0x315f4 >> 2] = Lf(0xa4c) < 0 ? -Lf(0xa4c) | 0 : Lf(0xa4c);
    F[0x31094 >> 2] = I[0x315f4 >> 2];
    F[0x30f4c >> 2] = F[0x31094 >> 2] / ring;
    const r3 = (ring / 3) | 0;
    if (I[0x31080 >> 2] < r3) F[0x31094 >> 2] = ((r3 - I[0x31080 >> 2]) | 0) * F[0x30f4c >> 2] + F[0x31094 >> 2];
  }
  const key = I[0x3158c >> 2] >>> 0, src = I[0x30e48 >> 2] >> 2, edge = I[0x30e44 >> 2] >> 2, nn = n >>> 0;
  const b0 = F[(0x164 + X) >> 2] === 0, mode = Lf(0xa98);   // FCOMP + TEST AH,0x40: NaN counts as 0
  let i = 0;
  if (Lf(0xa64) === 0 && Lf(0xa60) === 0 && b0 && mode === 0 && ring !== 0 && Lf(0xa4c) > 0) {
    // 0x10016abc: only the ring. (Its mask-layer block, 0x10016b0c, needs 0xa98 > 1: unreachable here.)
    const a0 = I[0x315f4 >> 2] = ftol(F[0x31094 >> 2]), ringU = ring >>> 0, a0u = a0 >>> 0;
    for (i = 0; i < nn; i++) {
      const px = U[src + i];
      if (px === key) continue;
      const d = U[edge + i] & 0xffff;
      if (d > ringU) continue;
      const p = d * a0u;                                   // MUL / DIV: exact unsigned
      let q = Math.floor(p / ringU);
      if (q * ringU > p) q--;
      let v = (a0 - q) >>> 0;
      if (v > 0xff) v = 0xff;
      U[src + i] = ((px & 0xffffff) | (v << 24)) >>> 0;
    }
    I[0x311dc >> 2] = 0;
    return 0;
  }
  if (Lf(0xa64) === 0 && Lf(0xa60) === 0 && mode > 1 && b0) {
    maskAlpha(c, false);                                    // 0x100168b5: the mask's alpha replaces it
    return 0;
  }
  const bright = Lf(0xa64) !== 0 && Lf(0xa60) !== 0;
  if (bright) {
    let t = Lf(0xa60);
    t = t < 0 ? -t | 0 : (0xff - t) | 0;
    I[0x31614 >> 2] = t;
    I[0x315b4 >> 2] = Lf(0xa64);
    F[0x310a0 >> 2] = I[0x315b4 >> 2];
    F[0x30f50 >> 2] = F[0x310a0 >> 2] / 255;
  }
  const ringU = ring >>> 0, neg = I[0x315b0 >> 2] < 0, base = F[0x31568 >> 2];
  const ra = F[0x31094 >> 2], rk = F[0x30f4c >> 2], half = fr(F[0x31094 >> 2] / 2);
  const lim = I[0x31614 >> 2], bA = F[0x310a0 >> 2], bk = F[0x30f50 >> 2], pos = Lf(0xa60) >= 0;
  const m224c = Lf(0xa9c), br2 = fr((Lf(0xa64) - (Lf(0xa64) >> 31)) >> 1), br1 = fr(Lf(0xa64));
  let v = 0, mx = 0, a = 0, gotV = false, gotMx = false, any = false;
  for (i = 0; i < nn; i++) {
    const px = U[src + i];
    if (px === key) continue;
    any = true;
    let f40 = 0, f3c = 0;
    if (ring !== 0) {
      const e = U[edge + i] & 0xffff;
      v = e > ringU ? 0 : neg ? (ring - e) | 0 : e;        // 0x100164e6
      gotV = true;
      if (v !== 0) {
        if (mode === 0) f40 = fr(ra - v * rk);
        if (mode === 1) f40 = ring !== v ? ra : half;
        if (mode > 1) f40 = fr(ra - v * rk);
      }
    }
    if (bright) {
      const bb = px & 0xff, gg = (px >>> 8) & 0xff, rr = (px >>> 16) & 0xff;
      mx = rr; if (mx < gg) mx = gg; if (mx < bb) mx = bb;
      gotMx = true;
      if (m224c === 0) {
        if (pos) { if (mx > lim) f3c = fr(bA - (0xff - mx) * bk); }
        else if (mx < lim) f3c = fr(bA - mx * bk);
      }
      if (m224c === 1) {
        if (lim === mx) f3c = br2;
        else if (pos) { if (mx > lim) f3c = br1; }
        else if (mx < lim) f3c = br1;
      }
    }
    a = ftol(base + f40 + f3c);
    if (a > 0xff) a = 0xff;
    // BSWAP / AND 0xffffff00 / OR a / BSWAP: a negative a smears into the colour bytes
    U[src + i] = bswap(((bswap(px) & 0xffffff00) | a) >>> 0);
  }
  I[0x311dc >> 2] = 0;
  I[0x31254 >> 2] = (src + nn) << 2;
  I[0x31250 >> 2] = (edge + nn) << 2;
  if (gotV) I[0x30f2c >> 2] = v;
  if (gotMx) I[0x3109c >> 2] = mx;
  if (any) I[0x315f4 >> 2] = a;
  maskAlpha(c, true);                                       // 0x10016e17: the mask's alpha is added
  return 0;
}

const COS = 0x30274 >> 2;          // cos table, F[COS + degree]

const COS360 = 0x30814 >> 2;       // F[COS360 - a] = cos[360 - a] = cos(a); a = 0 reads sin(0) = 0

const SIN360 = 0x30db4 >> 2;       // F[SIN360 - a] = sin[360 - a] = sin(-a)

const K001 = 0.0010000000474974513;   // (float)0.001 at 0x1008368c

const K01 = 0.009999999776482582;     // (float)0.01 at 0x10083684 / 0x100836ac

const K1E4 = 9.999999747378752e-05;   // (float)0.0001 at 0x10083680

const K1 = 0.10000000149011612;       // (float)0.1 at 0x100834c0

/** ADD with the carry saturating the top byte (ADD; JNC; OR 0xff000000) */
function addSat(a: number, b: number): number {
  const s = (a >>> 0) + (b >>> 0);
  return s > 0xffffffff ? (s | 0) | 0xff000000 : s | 0;
}

/** an angle as the kernels fold it: |a|, then mod 360 (unsigned) when above 359 */
function fold(a: number): number {
  if (a < 0) a = -a | 0;
  return a > 0x167 ? ((a >>> 0) % 0x168) | 0 : a;
}

/** vt+0x1f8 0x10017190: the per-pixel forward warp. Fills the target with the key (0x3158c, or 0x312a0 when
 *  that is -1), derives every kernel's parameters from the transform (many scaled by cos of one of its two
 *  spin angles 0x120 / 0x128, picked per parameter by a layer selector = 1 or 2), then moves each opaque
 *  pixel by its offset from the centre (0xa80 / 0xa84 shift it) through the enabled kernels and lands it
 *  at the truncated result. Three loops: swirl only, ripple + swirl, or the full chain (which keeps the
 *  first pixel landing on each target spot unless the tile kernel cleared 0x30fe4). */
export function warp(c: Core): number {
  const m = c.m, I = m.I, F = m.F, B = m.B, L = lb(c), X = xb(c);
  const w0 = I[(0x9f4 + L) >> 2], n = Math.imul(I[(0x9f8 + L) >> 2], w0);
  I[0x3165c >> 2] = n;
  I[0x30e40 >> 2] = (I[0x30e1c >> 2] + (n << 2)) | 0;
  var fill = I[0x3158c >> 2];
  if (fill === -1) fill = I[0x312a0 >> 2];
  I[0x3160c >> 2] = fill;
  var d0 = I[0x30e1c >> 2] >> 2;
  if (n > 0) I.fill(fill, d0, d0 + n);           // LOOP: n = 0 would run 2^32 times in the DLL
  const A1 = (0x120 + X) >> 2, A2 = (0x128 + X) >> 2;
  const t = (o: number): number => F[(o + X) >> 2];
  const cosA = (a: number): number => F[COS + ftol(F[a])];
  const sel = (o: number): number => I[(o + L) >> 2];
  I[0x314fc >> 2] = sel(0xa80);
  I[0x31500 >> 2] = sel(0xa84);
  if (sel(0xb48) === 1) {
    I[0x314fc >> 2] = ftol(I[0x314fc >> 2] * cosA(A1));
    I[0x31500 >> 2] = ftol(I[0x31500 >> 2] * cosA(A1));
  }
  if (sel(0xb48) === 2) {
    I[0x314fc >> 2] = ftol(I[0x314fc >> 2] * cosA(A2));
    I[0x31500 >> 2] = ftol(I[0x31500 >> 2] * cosA(A2));
  }
  I[0x30f08 >> 2] = (((I[(0x9f4 + L) >> 2] / 2) | 0) + I[0x314fc >> 2]) | 0;
  I[0x30f10 >> 2] = (((I[(0x9f8 + L) >> 2] / 2) | 0) + I[0x31500 >> 2]) | 0;
  I[0x3155c >> 2] = I[(0x9f4 + L) >> 2];
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  // shear (0x2c8): 0x31594 / 0x31598 from 0xfc / 0x100, each with its own angle selector
  if (nz(t(0xfc)) || nz(t(0x100))) {
    I[0x31594 >> 2] = I[(0xfc + X) >> 2];
    I[0x31598 >> 2] = I[(0x100 + X) >> 2];
    F[0x31590 >> 2] = t(0x114) * K001;
    if (sel(0xac8) === 1) F[0x31594 >> 2] = cosA(A1) * F[0x31594 >> 2];
    if (sel(0xac8) === 2) F[0x31594 >> 2] = cosA(A2) * F[0x31594 >> 2];
    if (sel(0xb34) === 1) F[0x31598 >> 2] = cosA(A1) * F[0x31598 >> 2];
    if (sel(0xb34) === 2) F[0x31598 >> 2] = cosA(A2) * F[0x31598 >> 2];
  }
  // stretch (0x2cc)
  if (nz(t(0x108)) || nz(t(0x104))) {
    I[0x315c4 >> 2] = I[(0x104 + X) >> 2];
    I[0x315d8 >> 2] = I[(0x108 + X) >> 2];
    F[0x315c8 >> 2] = t(0x114) * K001;
    if (sel(0xacc) === 1) { F[0x315c4 >> 2] = cosA(A1) * F[0x315c4 >> 2]; F[0x315d8 >> 2] = cosA(A1) * F[0x315d8 >> 2]; }
    if (sel(0xacc) === 2) { F[0x315c4 >> 2] = cosA(A2) * F[0x315c4 >> 2]; F[0x315d8 >> 2] = cosA(A2) * F[0x315d8 >> 2]; }
  }
  // sine ripple (0x2d4): phases 0x3149c / 0x314a0 are the spin angles themselves
  if (nz(t(0x10c)) || nz(t(0x110))) {
    I[0x3161c >> 2] = I[(0x10c + X) >> 2];
    I[0x31620 >> 2] = I[(0x110 + X) >> 2];
    F[0x31618 >> 2] = t(0x114) * K001;
    I[0x3149c >> 2] = 0;
    I[0x314a0 >> 2] = 0;
    if (sel(0xad4) === 1) I[0x3149c >> 2] = I[A1];
    if (sel(0xad4) === 2) I[0x3149c >> 2] = I[A2];
    if (sel(0xad8) === 1) I[0x314a0 >> 2] = I[A1];
    if (sel(0xad8) === 2) I[0x314a0 >> 2] = I[A2];
  }
  // lens (0x2d0): radius^2 and 90 / radius^2 (from the unrounded double)
  var d8 = t(0x118), dd = d8 * d8;
  dd = dd + dd;
  F[0x31298 >> 2] = dd;
  F[0x31294 >> 2] = 90 / dd;
  var e = I[(0xae4 + L) >> 2] * K01;
  F[0x315b8 >> 2] = e;
  if (sel(0xaac) === 1) F[0x315b8 >> 2] = e * cosA(A1);
  if (sel(0xaac) === 2) F[0x315b8 >> 2] = cosA(A2) * F[0x315b8 >> 2];
  // tile (0x2dc)
  var f0 = t(0x130), ff = f0 * f0;
  F[0x3129c >> 2] = ff + ff;
  F[0x315cc >> 2] = t(0x140) * K1E4;
  F[0x315d0 >> 2] = t(0x144) * K1E4;
  F[0x315d4 >> 2] = t(0x148) * K1E4;
  I[0x311a4 >> 2] = I[(0x134 + X) >> 2];
  I[0x311a8 >> 2] = I[(0x138 + X) >> 2];
  I[0x311ac >> 2] = I[(0x13c + X) >> 2];
  F[0x314f4 >> 2] = 1;
  F[0x31334 >> 2] = 1;
  if (sel(0xaec) === 1) I[0x314f4 >> 2] = I[COS + ftol(F[A1])];
  if (sel(0xaec) === 2) I[0x314f4 >> 2] = I[COS + ftol(F[A2])];
  if (sel(0xaf0) === 1) I[0x31334 >> 2] = I[COS + ftol(F[A1])];
  if (sel(0xaf0) === 2) I[0x31334 >> 2] = I[COS + ftol(F[A2])];
  if (!(F[0x314f4 >> 2] >= 0)) F[0x314f4 >> 2] = -F[0x314f4 >> 2];
  if (!(F[0x31334 >> 2] >= 0)) F[0x31334 >> 2] = -F[0x31334 >> 2];
  F[0x311a4 >> 2] = F[0x311a4 >> 2] * F[0x314f4 >> 2];
  F[0x311a8 >> 2] = F[0x311a8 >> 2] * F[0x314f4 >> 2];
  F[0x311ac >> 2] = F[0x314f4 >> 2] * F[0x311ac >> 2];
  F[0x315cc >> 2] = F[0x315cc >> 2] * F[0x31334 >> 2];
  F[0x315d0 >> 2] = F[0x31334 >> 2] * F[0x315d0 >> 2];
  F[0x315d4 >> 2] = F[0x315d4 >> 2] * F[0x31334 >> 2];
  // swirl (0x2d8): spin rate 0x3156c, per-axis base angles 0x3133c..0x31344
  F[0x3156c >> 2] = t(0x114) * K1;
  I[0x31570 >> 2] = sel(0xa8c);
  I[0x31574 >> 2] = sel(0xa90);
  I[0x31578 >> 2] = sel(0xa94);
  if (nz(F[0x3156c >> 2])) {
    if (sel(0xaf8) === 1) F[0x3156c >> 2] = cosA(A1) * F[0x3156c >> 2];
    if (sel(0xaf8) === 2) F[0x3156c >> 2] = cosA(A2) * F[0x3156c >> 2];
  }
  for (var j = 0; j < 3; j++) {
    var ax = (0x31570 >> 2) + j;
    if (I[ax] === 0) continue;
    if (sel(0xafc) === 1) I[ax] = ftol(F[A1]);
    if (sel(0xafc) === 2) I[ax] = ftol(F[A2]);
    I[(0x3133c >> 2) + j] = I[ax];
  }
  // which loop
  const z = (o: number): boolean => !nz(t(o));
  const zf = z(0x130) || (z(0x134) && z(0x138) && z(0x13c));
  const zd = I[(0xae4 + L) >> 2] === 0 || z(0x118);
  const spin = sel(0xa8c) !== 0 || sel(0xa90) !== 0 || sel(0xa94) !== 0;
  var path: number;
  if (z(0xfc) && z(0x100) && z(0x108) && z(0x104) && z(0x10c) && z(0x110) && zd && zf) path = 0;
  else if ((zf && zd && spin && !z(0x110)) || (z(0x108) && z(0x100) && z(0xfc) && !z(0x10c) && z(0x104))) path = 1;
  else path = 2;
  I[0x3103c >> 2] = 0;
  if (path === 2) B[0x30fe4] = 1;
  const kShear = !z(0xfc) || !z(0x100), kStretch = !z(0x108) || !z(0x104), kWave = !z(0x10c) || !z(0x110);
  const kLens = !z(0x118) && I[(0xae4 + L) >> 2] !== 0;
  const kTile = !z(0x130) && (!z(0x134) || !z(0x138) || !z(0x13c));
  for (var i = 0; i < I[0x3165c >> 2]; i++) {
    var sp = I[0x30e70 >> 2], px = I[sp >> 2];
    pix: if (px !== I[0x3158c >> 2]) {
      I[0x313c4 >> 2] = px;
      I[0x31040 >> 2] = i;
      var wu = I[0x3155c >> 2] >>> 0, row = Math.floor((i >>> 0) / wu), col = (i >>> 0) - row * wu;
      I[0x311fc >> 2] = row;
      I[0x311f8 >> 2] = col;
      F[0x31200 >> 2] = (I[0x311f8 >> 2] - I[0x30f08 >> 2]) | 0;
      F[0x31204 >> 2] = (I[0x311fc >> 2] - I[0x30f10 >> 2]) | 0;
      if (path === 0) swirl(c);                   // vt+0x358
      else if (path === 1) { wave(c); swirl(c); }  // vt+0x354, vt+0x358
      else {
        if (kShear) shear(c);                     // vt+0x348
        if (kStretch) stretch(c);                 // vt+0x34c
        if (kWave) wave(c);                       // vt+0x354
        if (kLens) { lens(c); if (B[0x30ff0] === 1) break pix; }   // vt+0x350
        if (kTile) { tile(c); if (B[0x30ff0] === 1) break pix; }   // vt+0x35c
        if (spin) swirl(c);
      }
      var x = (ftol(F[0x31200 >> 2]) + I[0x30f08 >> 2]) | 0;
      I[0x313a0 >> 2] = x;
      var y = (ftol(F[0x31204 >> 2]) + I[0x30f10 >> 2]) | 0;
      I[0x313a8 >> 2] = y;
      var w = I[(0x9f4 + L) >> 2];
      if (y >= I[(0x9f8 + L) >> 2] || x >= w || y < 0 || x < 0) break pix;
      var a = (I[0x30e1c >> 2] + ((Math.imul(y, w) + x) << 2)) | 0;
      I[0x30e38 >> 2] = a;
      if ((a >>> 0) >= (I[0x30e40 >> 2] >>> 0)) break pix;
      if (path === 2 && B[0x30fe4] === 0 && I[a >> 2] !== I[0x3158c >> 2]) break pix;
      I[a >> 2] = I[0x313c4 >> 2];
    }
    I[0x30e70 >> 2] = (sp + 4) | 0;
    I[0x3103c >> 2] = i + 1;
  }
  return 0;
}

/** vt+0x354 0x10019d00: the sine ripple. Amplitudes grow with the square of the position (0x31618, plus the
 *  integer 0xae0); 0xadc picks what drives each axis' phase (> 12: product amplitudes, 13 subtracted);
 *  x += cos(|drive_y| * 0x10c + 0x3149c) * amp_x, y likewise with 0x110 / 0x314a0. */
export function wave(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var x = F[0x31200 >> 2], y = F[0x31204 >> 2];
  I[0x31550 >> 2] = I[0x31200 >> 2];
  I[0x31554 >> 2] = I[0x31204 >> 2];
  var md = I[(0xadc + L) >> 2], add = I[(0xae0 + L) >> 2], k = F[0x31618 >> 2];
  if (md <= 0xc) {
    I[0x31304 >> 2] = md;
    F[0x3138c >> 2] = y * y * k + add;
    F[0x31390 >> 2] = k * x * x + add;
  } else {
    var t = k * y;
    md = (md - 13) | 0;
    I[0x31304 >> 2] = md;
    F[0x3138c >> 2] = t * x + add;
    F[0x31390 >> 2] = t * y + add;
  }
  switch (md) {                                   // the plain copies of x / y the DLL also makes are no-ops
    case 1: F[0x31550 >> 2] = x * 0.5; break;
    case 2: F[0x31554 >> 2] = y * 0.5; break;
    case 3: F[0x31550 >> 2] = x * 0.5; F[0x31554 >> 2] = y * 0.5; break;
    case 4: F[0x31550 >> 2] = x * x; break;
    case 5: F[0x31554 >> 2] = y * y; break;
    case 6: F[0x31550 >> 2] = x * x; F[0x31554 >> 2] = y * y; break;
    case 7: F[0x31550 >> 2] = y * x; break;
    case 8: F[0x31554 >> 2] = y * x; break;
    case 9: F[0x31550 >> 2] = y * x; F[0x31554 >> 2] = y * x; break;
    case 10: F[0x31554 >> 2] = y * y / x; break;
    case 11: F[0x31550 >> 2] = x * x / y; break;
    case 12: F[0x31550 >> 2] = x * x / y; F[0x31554 >> 2] = y * y / x; break;
  }
  var a: number;
  if (nz(F[(0x10c + X) >> 2])) {
    if (!(F[0x31554 >> 2] >= 0)) F[0x31554 >> 2] = -F[0x31554 >> 2];
    a = fold(ftol(F[0x31554 >> 2] * F[(0x10c + X) >> 2] + F[0x3149c >> 2]));
    I[0x310f0 >> 2] = a;
    F[0x31200 >> 2] = F[COS + a] * F[0x3138c >> 2] + F[0x31200 >> 2];
  }
  if (nz(F[(0x110 + X) >> 2])) {
    if (!(F[0x31550 >> 2] >= 0)) F[0x31550 >> 2] = -F[0x31550 >> 2];
    a = fold(ftol(F[0x31550 >> 2] * F[(0x110 + X) >> 2] + F[0x314a0 >> 2]));
    I[0x310f4 >> 2] = a;
    F[0x31204 >> 2] = F[COS + a] * F[0x31390 >> 2] + F[0x31204 >> 2];
  }
  return 0;
}

/** vt+0x358 0x1001a790: the swirl. With a spin rate (0x3156c) each enabled axis angle (0xa8c / 0xa90 /
 *  0xa94 -> 0x31570 / 0x31574 / 0x31578) is its base (0x3133c..0x31344) minus r^2 * rate, folded into 0..359;
 *  then rotate by the third and scale y / x by the cos of the first / second. */
export function swirl(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  if (nz(F[0x3156c >> 2])) {
    var x = F[0x31200 >> 2], y = F[0x31204 >> 2];
    var r2 = ftol(x * x + y * y);
    I[0x315bc >> 2] = r2;
    for (var j = 0; j < 3; j++) {
      if (I[(0xa8c + L + j * 4) >> 2] === 0) continue;
      var v = (I[(0x3133c >> 2) + j] - ftol(r2 * F[0x3156c >> 2])) | 0;
      while (v < 0) v = (v + 0x168) | 0;
      if (v > 0x167) v = ((v >>> 0) % 0x168) | 0;
      I[(0x31570 >> 2) + j] = v;
    }
  }
  I[0x31550 >> 2] = I[0x31200 >> 2];
  var a = I[0x31578 >> 2];
  if (a !== 0) {
    F[0x31200 >> 2] = F[COS360 - a] * F[0x31200 >> 2] - F[SIN360 - a] * F[0x31204 >> 2];
    F[0x31204 >> 2] = F[SIN360 - a] * F[0x31550 >> 2] + F[COS360 - a] * F[0x31204 >> 2];
  }
  if (I[(0xa8c + L) >> 2] !== 0) F[0x31204 >> 2] = F[COS360 - I[0x31570 >> 2]] * F[0x31204 >> 2];
  if (I[(0xa90 + L) >> 2] !== 0) F[0x31200 >> 2] = F[COS360 - I[0x31574 >> 2]] * F[0x31200 >> 2];
  return 0;
}

/** vt+0x34c 0x100197e0: the stretch. Factors A (0x31328, from 0x315d8) and B (0x3132c, from 0x315c4) grow with
 *  the square of the position (0x315c8; 0xad0 > 9: product law, 10 subtracted); 0xad0 also picks the
 *  half-plane: "plus" x = (A + 1) * x, y += y * B; "minus" x -= A * x, y -= y * B. */
export function stretch(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  var x = F[0x31200 >> 2], y = F[0x31204 >> 2];
  I[0x31550 >> 2] = I[0x31200 >> 2];
  I[0x31554 >> 2] = I[0x31204 >> 2];
  var md = I[(0xad0 + L) >> 2], k = F[0x315c8 >> 2];
  if (md <= 9) {
    I[0x31304 >> 2] = md;
    F[0x31328 >> 2] = k * y * y + F[0x315d8 >> 2];
    F[0x3132c >> 2] = k * x * x + F[0x315c4 >> 2];
  } else {
    var t = k * y;
    md = (md - 10) | 0;
    I[0x31304 >> 2] = md;
    F[0x31328 >> 2] = t * x + F[0x315d8 >> 2];
    F[0x3132c >> 2] = t * y + F[0x315c4 >> 2];
  }
  var A = F[0x31328 >> 2], B = F[0x3132c >> 2];
  var plus = (): void => { F[0x31200 >> 2] = (A + 1) * x; F[0x31204 >> 2] = y * B + F[0x31204 >> 2]; };
  var minus = (): void => { F[0x31200 >> 2] = x - A * x; F[0x31204 >> 2] = F[0x31204 >> 2] - y * B; };
  switch (md) {
    case 0: plus(); break;
    case 1: if (!(y >= 0)) plus(); break;
    case 2: if (y > 0) plus(); break;
    case 3: if (y > 0) plus(); else minus(); break;
    case 4: if (!(y > 0)) plus(); else minus(); break;
    case 5: if (!(x >= 0)) plus(); break;
    case 6: if (x > 0) plus(); break;
    case 7: if (x > 0) plus(); else minus(); break;
    case 8: if (!(x > 0)) plus(); else minus(); break;
    case 9:
      F[0x31200 >> 2] = !(y > 0) ? (B + 1) * x : x - A * x;
      if (!(F[0x31550 >> 2] > 0)) F[0x31204 >> 2] = y * B + F[0x31204 >> 2];
      else F[0x31204 >> 2] = F[0x31204 >> 2] - y * A;
      break;
  }
  return 0;
}

/** vt+0x348 0x10019ad0: the shear. A (0x312f0, from 0x31594) and B (0x312f4, from 0x31598) grow with the
 *  square of the position (0x31590; 0xac4 > 9: product law, 10 subtracted); 0xac4 picks the half-plane:
 *  "plus" x += y * A, y += x * B; "minus" x -= y * A, y -= x * B. */
export function shear(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c);
  var x = F[0x31200 >> 2], y = F[0x31204 >> 2];
  I[0x31550 >> 2] = I[0x31200 >> 2];
  var md = I[(0xac4 + L) >> 2], k = F[0x31590 >> 2];
  if (md <= 9) {
    I[0x312ec >> 2] = md;
    F[0x312f0 >> 2] = y * y * k + F[0x31594 >> 2];
    F[0x312f4 >> 2] = x * x * k + F[0x31598 >> 2];
  } else {
    var t = k * y;
    md = (md - 10) | 0;
    I[0x312ec >> 2] = md;
    F[0x312f0 >> 2] = t * x + F[0x31594 >> 2];
    F[0x312f4 >> 2] = t * y + F[0x31598 >> 2];
  }
  var A = F[0x312f0 >> 2], B = F[0x312f4 >> 2];
  var plus = (): void => { F[0x31200 >> 2] = y * A + x; F[0x31204 >> 2] = x * B + F[0x31204 >> 2]; };
  var minus = (): void => { F[0x31200 >> 2] = x - y * A; F[0x31204 >> 2] = F[0x31204 >> 2] - x * B; };
  switch (md) {
    case 0: plus(); break;
    case 1: if (!(y >= 0)) plus(); break;
    case 2: if (y > 0) plus(); break;
    case 3: if (y > 0) plus(); else minus(); break;
    case 4: if (!(y > 0)) plus(); else minus(); break;
    case 5: if (!(x >= 0)) plus(); break;
    case 6: if (x > 0) plus(); break;
    case 7: if (x > 0) plus(); else minus(); break;
    case 8: if (!(x > 0)) plus(); else minus(); break;
    case 9:
      F[0x31200 >> 2] = !(y > 0) ? y * B + x : x - y * A;
      if (!(x > 0)) F[0x31204 >> 2] = x * B + F[0x31204 >> 2];
      else F[0x31204 >> 2] = F[0x31204 >> 2] - x * A;
      break;
  }
  return 0;
}

/** vt+0x350 0x1001a120: the lens. Only inside (0x118 > 0) or outside (else) the radius^2 0x31298: by
 *  0xa88, scale by 1 + cos(angle) * 0x315b8 (angle from r^2 and the position, 0 = cos, 1 = cos^3),
 *  scale by 1 + 0x315b8, or push out by 0x315b8 * 100. 0x30ff0 := 1 when the result left the lens. */
export function lens(c: Core): number {
  const I = c.m.I, F = c.m.F, B = c.m.B, L = lb(c), X = xb(c);
  B[0x30ff0] = 0;
  var x = F[0x31200 >> 2], y = F[0x31204 >> 2], x2 = x * x, y2 = y * y;
  F[0x31550 >> 2] = x2;
  F[0x31554 >> 2] = y2;
  I[0x31304 >> 2] = I[(0xa88 + L) >> 2];
  var r2 = ftol(y2 + x2);
  I[0x315bc >> 2] = r2;
  var inside = F[(0x118 + X) >> 2] > 0;
  if (inside ? r2 > ftol(F[0x31298 >> 2]) : r2 < ftol(F[0x31298 >> 2])) return 0;
  var md = I[0x31304 >> 2];
  if (md === 0 || md === 1) {
    var v = ftol((F[(0xe8 + X) >> 2] * K01 + F[0x31294 >> 2]) * r2 + F[(0xe4 + X) >> 2] * F[0x31204 >> 2] +
                 F[(0xe0 + X) >> 2] * F[0x31200 >> 2]);
    var a = fold((v + I[(0xab0 + L) >> 2]) | 0);
    I[0x3164c >> 2] = a;
    var co = F[COS + a], s = md === 0 ? co * F[0x315b8 >> 2] : co * F[0x315b8 >> 2] * co * co;
    F[0x31384 >> 2] = s;
    F[0x31200 >> 2] = (s + 1) * F[0x31200 >> 2];   // the double on the stack
    F[0x31204 >> 2] = (F[0x31384 >> 2] + 1) * F[0x31204 >> 2];   // the stored float
  } else if (md === 2) {
    var g = F[0x315b8 >> 2] + 1;
    F[0x31200 >> 2] = g * F[0x31200 >> 2];
    F[0x31204 >> 2] = g * F[0x31204 >> 2];
  } else if (md === 3) {
    var d = F[0x315b8 >> 2] * 100;
    F[0x31200 >> 2] = !(F[0x31200 >> 2] >= 0) ? F[0x31200 >> 2] - d : d + F[0x31200 >> 2];
    F[0x31204 >> 2] = !(F[0x31204 >> 2] >= 0) ? F[0x31204 >> 2] - d : d + F[0x31204 >> 2];
  }
  x = F[0x31200 >> 2];
  y = F[0x31204 >> 2];
  r2 = ftol(y * y + x * x);
  I[0x315bc >> 2] = r2;
  if (inside ? r2 > ftol(F[0x31298 >> 2]) : r2 < ftol(F[0x31298 >> 2])) B[0x30ff0] = 1;
  return 0;
}

/** vt+0x35c 0x1001a490: the tile / mirror. Scales (sx, sy) fall linearly with r^2 (0x311a4 / 0x311a8 +
 *  0x311ac minus r^2 times 0x315cc / 0x315d0 + 0x315d4); x -= trunc(sx * x), y likewise. 0xae8 = 0: leave
 *  pixels outside the unit square (0x30ff0 := 1) or with a negative scale (0x30fe4 := 0); 1 or 2: fold the
 *  scale into 0..1 (mirror). 0x30fe4 := 0 when the pixel did not move. 0xae8 > 2: nothing (0x30fe4 = 1). */
export function tile(c: Core): number {
  const I = c.m.I, F = c.m.F, B = c.m.B, L = lb(c), X = xb(c);
  B[0x30fe4] = 1;
  var md = I[(0xae8 + L) >> 2];
  I[0x31304 >> 2] = md;
  if (md > 2) return 0;
  var x = F[0x31200 >> 2], y = F[0x31204 >> 2];
  I[0x31550 >> 2] = I[0x31200 >> 2];
  B[0x30ff0] = 0;
  I[0x31554 >> 2] = I[0x31204 >> 2];
  var r2 = ftol(x * x + y * y);
  I[0x315bc >> 2] = r2;
  if (F[(0x130 + X) >> 2] > 0) {
    if (r2 > ftol(F[0x3129c >> 2])) return 0;
  } else if (r2 < ftol(F[0x3129c >> 2])) { B[0x30ff0] = 1; return 0; }
  var zz = F[0x311ac >> 2] - r2 * F[0x315d4 >> 2];
  var sx = fr(F[0x311a4 >> 2] - r2 * F[0x315cc >> 2] + zz);
  var sy = fr(F[0x311a8 >> 2] - r2 * F[0x315d0 >> 2] + zz);
  F[0x31538 >> 2] = sx;
  F[0x3153c >> 2] = sy;
  if (md === 0) {
    if (!(sx >= 0) || !(sy >= 0)) { B[0x30fe4] = 0; return 0; }
    if (sx > 1 || sy > 1) { B[0x30ff0] = 1; return 0; }
  } else if (md === 1 || md === 2) {
    if (!(sx >= 0)) F[0x31538 >> 2] = -sx;
    if (F[0x31538 >> 2] > 1) F[0x31538 >> 2] = 1 - (F[0x31538 >> 2] - ftol(F[0x31538 >> 2]));
    if (!(sy >= 0)) F[0x3153c >> 2] = -sy;
    if (F[0x3153c >> 2] > 1) F[0x3153c >> 2] = 1 - (F[0x3153c >> 2] - ftol(F[0x3153c >> 2]));
  }
  F[0x31200 >> 2] = F[0x31200 >> 2] - ftol(F[0x31538 >> 2] * F[0x31200 >> 2]);
  var yd = F[0x31204 >> 2] - ftol(F[0x3153c >> 2] * F[0x31204 >> 2]);   // stays a double on the x87 stack
  F[0x31204 >> 2] = yd;
  if (ftol(F[0x31554 >> 2]) === ftol(yd) && ftol(F[0x31550 >> 2]) === ftol(F[0x31200 >> 2])) B[0x30fe4] = 0;
  return 0;
}

/** vt+0x1f4 0x10018660: the spotlight. Per opaque pixel, inside the shape the transform describes around
 *  the centre (w/2 + 0xaa4, h/2 + 0xaa8; squared distance against 0xc8^2, a cut line 0xf0, a
 *  star / ray test 0xec, a spiral-order term 0xf4 read from spiralMap's buffer), an intensity
 *  0x311b0 = (cos(angle) + 0xdc) * (r^2 * 0xd8 / 0xc8^2 + 0xabc / 100); then by 0xab8: 3 = alpha
 *  0xac0 - 0xac0 * intensity into the source colour, 1 = pull the colour toward 0xa40 / 0xa44 / 0xa48,
 *  2 = add the blue byte into the SOURCE pixel's alpha; others (and pixels outside) get 0xac0 added into
 *  the alpha byte (saturating) when it is set. */
export function spotlight(c: Core): number {
  const m = c.m, L = lb(c), X = xb(c);
  var I = m.I, F = m.F;
  var w = I[(0x9f4 + L) >> 2], h = I[(0x9f8 + L) >> 2];
  I[0x3165c >> 2] = Math.imul(h, w);
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  I[0x315f0 >> 2] = I[(0xac0 + L) >> 2];
  F[0x311bc >> 2] = I[(0xabc + L) >> 2] / 100;
  var rr = F[(0xc8 + X) >> 2];
  I[0x315c0 >> 2] = ftol(rr * rr);
  I[0x315ec >> 2] = I[(0xa40 + L) >> 2];
  I[0x315e8 >> 2] = I[(0xa44 + L) >> 2];
  I[0x315e0 >> 2] = I[(0xa48 + L) >> 2];
  F[0x314b4 >> 2] = I[0x315ec >> 2];
  F[0x314b0 >> 2] = I[0x315e8 >> 2];
  F[0x314a8 >> 2] = I[0x315e0 >> 2];
  F[0x31298 >> 2] = rr * rr + rr * rr;
  I[0x30f08 >> 2] = (((w / 2) | 0) + I[(0xaa4 + L) >> 2]) | 0;
  I[0x30f10 >> 2] = (((h / 2) | 0) + I[(0xaa8 + L) >> 2]) | 0;
  I[0x3155c >> 2] = w;
  I[0x3103c >> 2] = 0;
  I[0x314ac >> 2] = 0;
  F[0x3147c >> 2] = F[(0xf8 + X) >> 2] * K001;
  if (nz(F[(0xf4 + X) >> 2])) {
    spiralMap(c);                                 // vt+0x1d0 (allocates)
    I = m.I;
    F = m.F;
  }
  const T = (o: number): number => F[(o + X) >> 2];
  do {
    var sp = I[0x30e70 >> 2], dp = I[0x30e38 >> 2];
    I[0x313c4 >> 2] = I[sp >> 2];
    I[0x31380 >> 2] = I[0x315f0 >> 2];
    var act = 0;                                  // 0: alpha tint then write (0x100194a4), 1: write, 2: done
    calc: {
      if (I[0x313c4 >> 2] === I[0x3158c >> 2]) { act = 1; break calc; }
      I[0x31040 >> 2] = I[0x3103c >> 2];
      var wu = I[0x3155c >> 2] >>> 0, iu = I[0x31040 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x311fc >> 2] = row;
      I[0x311f8 >> 2] = col;
      if (T(0xf0) > 0) F[0x315e4 >> 2] = I[0x311fc >> 2] * T(0xf0);
      else F[0x315e4 >> 2] = (-((I[(0x9f8 + L) >> 2] - I[0x311fc >> 2]) | 0) | 0) * T(0xf0);
      I[0x311f8 >> 2] = (I[0x311f8 >> 2] - I[0x30f08 >> 2]) | 0;
      I[0x311fc >> 2] = (I[0x311fc >> 2] - I[0x30f10 >> 2]) | 0;
      var cx = I[0x311f8 >> 2], cy = I[0x311fc >> 2];
      F[0x31200 >> 2] = cx + cx * T(0xd4);
      F[0x31204 >> 2] = cy + cy * T(0xd0);
      var k = T(0xec);
      if (nz(k) && nz(F[0x31200 >> 2]) && nz(F[0x31204 >> 2])) {   // the ray test, off on the axes
        if (!(F[0x31200 >> 2] >= 0)) F[0x31200 >> 2] = -F[0x31200 >> 2];
        if (!(F[0x31204 >> 2] >= 0)) F[0x31204 >> 2] = -F[0x31204 >> 2];
        F[0x3122c >> 2] = !(F[0x31204 >> 2] >= F[0x31200 >> 2]) ? F[0x31204 >> 2] / F[0x31200 >> 2] : F[0x31200 >> 2] / F[0x31204 >> 2];
        if (k > 0) {
          F[0x3122c >> 2] = F[0x3122c >> 2] - ftol(F[0x3122c >> 2]);
          if (F[0x3122c >> 2] > k && 1 - F[0x3122c >> 2] > k) break calc;
        } else if (-k > F[0x3122c >> 2]) break calc;
      }
      F[0x31200 >> 2] = F[0x31200 >> 2] * F[0x31200 >> 2];
      F[0x31204 >> 2] = F[0x31204 >> 2] * F[0x31204 >> 2];
      I[0x315bc >> 2] = ftol(F[0x31200 >> 2] + F[0x31204 >> 2]);
      var lim = ftol(F[0x31298 >> 2]);
      if (T(0xc8) > 0 ? I[0x315bc >> 2] > lim : I[0x315bc >> 2] < lim) break calc;
      if (nz(T(0xf0)) && F[0x31200 >> 2] > F[0x315e4 >> 2]) break calc;
      if (nz(T(0xf4))) {
        I[0x30f90 >> 2] = I[((I[0x30ef8 >> 2] + (Math.imul(I[0x3163c >> 2], I[0x311fc >> 2]) << 2) + (I[0x311f8 >> 2] << 2)) | 0) >> 2];
      }
      F[0x311b0 >> 2] = I[0x315bc >> 2] * T(0xd8) / I[0x315c0 >> 2] + F[0x311bc >> 2];
      I[0x31324 >> 2] = 0;
      F[0x314ac >> 2] = F[0x314ac >> 2] + F[0x3147c >> 2];
      if (!(T(0xf8) >= 0)) F[0x31324 >> 2] = I[0x315bc >> 2] * F[0x314ac >> 2];
      else F[0x31324 >> 2] = F[0x31200 >> 2] * F[0x314ac >> 2];
      var v = ftol(F[0x31200 >> 2] * T(0xe0) + F[0x31204 >> 2] * T(0xe4) + I[0x315bc >> 2] * T(0xe8) +
                   I[0x30f90 >> 2] * T(0xf4) + F[0x31324 >> 2]);
      var a = fold((I[(0xab0 + L) >> 2] + v) | 0);
      I[0x3164c >> 2] = a;
      F[0x311b0 >> 2] = (T(0xdc) + F[COS + a]) * F[0x311b0 >> 2];
      if (!(F[0x311b0 >> 2] > 0)) break calc;
      var al = (I[0x315f0 >> 2] - ftol(I[0x315f0 >> 2] * F[0x311b0 >> 2])) | 0;
      if (al > 0xff) al = 0xff;
      if (al < 0) al = 0;
      I[0x31380 >> 2] = al;
      if (I[(0xab8 + L) >> 2] === 3) {
        I[dp >> 2] = (I[sp >> 2] & 0xffffff) | (I[0x31380 >> 2] << 24);
        act = 2;
        break calc;
      }
      splitPixel(c);                              // inline in the DLL (the same code as vt+0x300)
      F[0x314a4 >> 2] = I[0x31560 >> 2];
      F[0x31494 >> 2] = I[0x314c0 >> 2];
      F[0x31480 >> 2] = I[0x313b4 >> 2];
      if (I[0x315ec >> 2] !== 0) F[0x314a4 >> 2] = (F[0x314b4 >> 2] - F[0x314a4 >> 2]) * F[0x311b0 >> 2] + F[0x314a4 >> 2];
      if (I[0x315e8 >> 2] !== 0) F[0x31494 >> 2] = (F[0x314b0 >> 2] - F[0x31494 >> 2]) * F[0x311b0 >> 2] + F[0x31494 >> 2];
      if (I[0x315e0 >> 2] !== 0) F[0x31480 >> 2] = (F[0x314a8 >> 2] - F[0x31480 >> 2]) * F[0x311b0 >> 2] + F[0x31480 >> 2];
      if (!(F[0x314a4 >> 2] >= 0)) I[0x314a4 >> 2] = 0;
      if (!(F[0x31494 >> 2] >= 0)) I[0x31494 >> 2] = 0;
      if (!(F[0x31480 >> 2] >= 0)) I[0x31480 >> 2] = 0;
      if (F[0x314a4 >> 2] > 255) F[0x314a4 >> 2] = 255;
      if (F[0x31494 >> 2] > 255) F[0x31494 >> 2] = 255;
      if (F[0x31480 >> 2] > 255) F[0x31480 >> 2] = 255;
      I[0x31560 >> 2] = ftol(F[0x314a4 >> 2]);
      I[0x314c0 >> 2] = ftol(F[0x31494 >> 2]);
      I[0x313b4 >> 2] = ftol(F[0x31480 >> 2]);
      var md = I[(0xab8 + L) >> 2];
      if (md === 1) {
        I[0x313c4 >> 2] = (((I[0x31380 >> 2] << 8 | I[0x31560 >> 2]) << 8 | I[0x314c0 >> 2]) << 8) | I[0x313b4 >> 2];
        I[dp >> 2] = I[0x313c4 >> 2];
        act = 2;
      } else if (md === 2) {
        I[0x313c4 >> 2] = addSat(I[0x313c4 >> 2], bswap(I[0x313b4 >> 2]));
        I[sp >> 2] = I[sp >> 2] | (I[0x313c4 >> 2] & 0xff000000);
        act = 2;
      }
    }
    if (act === 0) {
      if (I[(0xac0 + L) >> 2] !== 0) I[0x313c4 >> 2] = addSat(I[0x313c4 >> 2], bswap(I[0x31380 >> 2]));
      act = 1;
    }
    if (act === 1) I[dp >> 2] = I[0x313c4 >> 2];
    I[0x30e70 >> 2] = (I[0x30e70 >> 2] + 4) | 0;
    I[0x30e38 >> 2] = (I[0x30e38 >> 2] + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  return 0;
}

/** vt+0x1d0 0x10019590: the spiral-order map the spotlight reads: an S x S (+1 row) buffer, S = max(w, h),
 *  rebuilt (old one freed) only when the layer outgrows the last one (0x31638 x 0x3163c); each cell holds its
 *  step number along a square spiral from (S/2, S/2). 0x30ef8 = the centre cell, 0x310d8 = the block. */
export function spiralMap(c: Core): number {
  const m = c.m, L = lb(c);
  var I = m.I;
  if (!(I[(0x9f8 + L) >> 2] > I[0x31638 >> 2] || I[(0x9f4 + L) >> 2] > I[0x3163c >> 2])) return 0;
  var old = I[0x310d8 >> 2];
  I[0x30f34 >> 2] = 0;
  I[0x30eb8 >> 2] = 1;
  I[0x30f30 >> 2] = 1;
  I[0x313e0 >> 2] = 1;
  if (old !== 0) m.release(old);
  var h = I[(0x9f8 + L) >> 2], w = I[(0x9f4 + L) >> 2];
  I[0x31638 >> 2] = h;
  I[0x3163c >> 2] = w;
  if (h < w) I[0x31638 >> 2] = w;
  else I[0x3163c >> 2] = h;
  var p = m.malloc(Math.imul(Math.imul((I[0x3163c >> 2] + 1) | 0, I[0x31638 >> 2]), 4));
  I = m.I;
  I[0x310d8 >> 2] = p;
  if (p === 0) {
    I[0x30fe8 >> 2] = 1;
    I[(0xf4 + xb(c)) >> 2] = 0;
    return 0;
  }
  var s = I[0x3163c >> 2], s2 = I[0x31638 >> 2];
  I[0x3103c >> 2] = 1;
  var mid = ((Math.imul(s, s2) / 2) | 0) + ((s / 2) | 0);
  I[0x30ef8 >> 2] = (p + (mid << 2)) | 0;
  I[0x30f1c >> 2] = (I[0x30ef8 >> 2] - 4) | 0;
  I[0x31664 >> 2] = Math.imul(s2, s);
  do {
    var dir = I[0x30f34 >> 2];
    if ((dir >>> 0) <= 3) {
      var st = dir === 0 ? 4 : dir === 1 ? -I[0x3163c >> 2] << 2 : dir === 2 ? -4 : I[0x3163c >> 2] << 2;
      I[0x30f1c >> 2] = (I[0x30f1c >> 2] + st) | 0;
      I[I[0x30f1c >> 2] >> 2] = I[0x3103c >> 2];
    }
    I[0x313e0 >> 2] = (I[0x313e0 >> 2] - 1) | 0;
    if (I[0x313e0 >> 2] <= 0) {
      var nd = (I[0x30f34 >> 2] + 1) | 0;
      I[0x30f34 >> 2] = nd < 4 ? nd : 0;
      if (I[0x30f30 >> 2] === 0) {
        var g = (I[0x30eb8 >> 2] + 1) | 0;
        I[0x30eb8 >> 2] = g;
        I[0x30f30 >> 2] = g;
        I[0x313e0 >> 2] = g;
      } else {
        I[0x313e0 >> 2] = I[0x30f30 >> 2];
        I[0x30f30 >> 2] = 0;
      }
    }
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x31664 >> 2]);
  return 0;
}

/** vt+0x1ec 0x1001aa00: the cross blur. Each opaque pixel becomes the mean colour of itself and the opaque
 *  pixels up to 0xb04 (scaled by cos of a spin angle when 0xb00 = 1 / 2) to its right, left, up and down,
 *  with the alpha of the last one read. The right arm reaches the next row's first pixel and the down arm
 *  one row past the image, as in the DLL (raw heap reads there). */
export function blur(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var r0 = I[(0xb04 + L) >> 2];
  I[0x313bc >> 2] = r0;
  if (I[(0xb00 + L) >> 2] === 1) I[0x313bc >> 2] = ftol(r0 * F[COS + ftol(F[(0x120 + X) >> 2])]);
  if (I[(0xb00 + L) >> 2] === 2) I[0x313bc >> 2] = ftol(I[0x313bc >> 2] * F[COS + ftol(F[(0x128 + X) >> 2])]);
  if (I[0x313bc >> 2] < 0) I[0x313bc >> 2] = -I[0x313bc >> 2] | 0;
  I[0x3155c >> 2] = I[(0x9f4 + L) >> 2];
  I[0x3165c >> 2] = Math.imul(I[(0x9f8 + L) >> 2], I[(0x9f4 + L) >> 2]);
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  I[0x3103c >> 2] = 0;
  const take = (p: number): void => {           // one neighbour: add it when it is not the key
    I[0x313c4 >> 2] = I[p >> 2];
    if (I[0x313c4 >> 2] === I[0x3158c >> 2]) return;
    I[0x31238 >> 2] = (I[0x31238 >> 2] + 1) | 0;
    splitPixel(c);                                // vt+0x300
    I[0x31564 >> 2] = (I[0x31564 >> 2] + I[0x31560 >> 2]) | 0;
    I[0x314c4 >> 2] = (I[0x314c4 >> 2] + I[0x314c0 >> 2]) | 0;
    I[0x313b8 >> 2] = (I[0x313b8 >> 2] + I[0x313b4 >> 2]) | 0;
  };
  do {
    var sp = I[0x30e70 >> 2];
    I[0x313c4 >> 2] = I[sp >> 2];
    if (I[0x313c4 >> 2] !== I[0x3158c >> 2]) {
      splitPixel(c);                              // vt+0x300
      I[0x31564 >> 2] = I[0x31560 >> 2];
      I[0x314c4 >> 2] = I[0x314c0 >> 2];
      I[0x313b8 >> 2] = I[0x313b4 >> 2];
      I[0x31238 >> 2] = 1;
      I[0x31040 >> 2] = I[0x3103c >> 2];
      var wu = I[0x3155c >> 2] >>> 0, iu = I[0x31040 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x311f0 >> 2] = row;
      I[0x311e8 >> 2] = col;
      I[0x311ec >> 2] = (I[(0x9f4 + L) >> 2] - col) | 0;
      I[0x311e0 >> 2] = (I[(0x9f8 + L) >> 2] - row) | 0;
      var rad = I[0x313bc >> 2];
      if (I[0x311e8 >> 2] > rad) I[0x311e8 >> 2] = rad;
      if (I[0x311ec >> 2] > rad) I[0x311ec >> 2] = rad;
      if (row > rad) I[0x311f0 >> 2] = rad;
      if (I[0x311e0 >> 2] > rad) I[0x311e0 >> 2] = rad;
      for (; I[0x311ec >> 2] !== 0; I[0x311ec >> 2] = (I[0x311ec >> 2] - 1) | 0) take((sp + (I[0x311ec >> 2] << 2)) | 0);
      for (; I[0x311e8 >> 2] !== 0; I[0x311e8 >> 2] = (I[0x311e8 >> 2] - 1) | 0) take((sp - (I[0x311e8 >> 2] << 2)) | 0);
      for (; I[0x311f0 >> 2] !== 0; I[0x311f0 >> 2] = (I[0x311f0 >> 2] - 1) | 0) {
        take((sp - (Math.imul(I[0x311f0 >> 2], I[0x3155c >> 2]) << 2)) | 0);
      }
      for (; I[0x311e0 >> 2] !== 0; I[0x311e0 >> 2] = (I[0x311e0 >> 2] - 1) | 0) {
        take((sp + (Math.imul(I[0x311e0 >> 2], I[0x3155c >> 2]) << 2)) | 0);
      }
      var n = I[0x31238 >> 2];
      I[0x31560 >> 2] = (I[0x31564 >> 2] / n) | 0;
      I[0x314c0 >> 2] = (I[0x314c4 >> 2] / n) | 0;
      I[0x313b4 >> 2] = (I[0x313b8 >> 2] / n) | 0;
      I[0x313c4 >> 2] = (((I[0x31380 >> 2] << 8 | I[0x31560 >> 2]) << 8 | I[0x314c0 >> 2]) << 8) | I[0x313b4 >> 2];
    }
    I[I[0x30e38 >> 2] >> 2] = I[0x313c4 >> 2];
    I[0x30e38 >> 2] = (I[0x30e38 >> 2] + 4) | 0;
    I[0x30e70 >> 2] = (sp + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  return 0;
}

/** vt+0x300 0x1001af10: the pixel 0x313c4 into its bytes: 0x31380 alpha, 0x31560 red, 0x314c0 green, 0x313b4 blue */
export function splitPixel(c: Core): number {
  const I = c.m.I, p = I[0x313c4 >> 2];
  I[0x31380 >> 2] = p >>> 24;
  I[0x313b4 >> 2] = p & 0xff;
  I[0x314c0 >> 2] = (p >>> 8) & 0xff;
  I[0x31560 >> 2] = (p >>> 16) & 0xff;
  return 0;
}

/** vt+0x204 0x1001af60: the melt. Each key pixel takes the first opaque pixel along a square spiral of up
 *  to 0xa58 steps (spiralSearch), its alpha raised (saturating) by 0xaf4 - ring * 0xb08 (0xaf4 is
 *  clamped to 255 first). */
export function melt(c: Core): number {
  const I = c.m.I, L = lb(c);
  var r = I[(0xa58 + L) >> 2];
  I[0x314e0 >> 2] = r < 0 ? -r | 0 : r;
  if (I[(0xaf4 + L) >> 2] > 0xff) I[(0xaf4 + L) >> 2] = 0xff;
  I[0x3155c >> 2] = I[(0x9f4 + L) >> 2];
  var n = Math.imul(I[(0x9f8 + L) >> 2], I[(0x9f4 + L) >> 2]);
  I[0x3165c >> 2] = n;
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  I[0x30e90 >> 2] = I[0x30e48 >> 2];
  I[0x30e8c >> 2] = (I[0x30e48 >> 2] + (n << 2)) | 0;
  I[0x3103c >> 2] = 0;
  do {
    I[0x313c4 >> 2] = I[I[0x30e70 >> 2] >> 2];
    if (I[0x313c4 >> 2] === I[0x3158c >> 2]) {
      spiralSearch(c);                            // vt+0x2ec
      if (I[0x313c4 >> 2] !== I[0x3158c >> 2] && I[(0xaf4 + L) >> 2] !== 0) {
        var a = (I[(0xaf4 + L) >> 2] - Math.imul(I[0x30eb8 >> 2], I[(0xb08 + L) >> 2])) | 0;
        I[0x315f4 >> 2] = a > 0xff ? 0xff : a;
        I[0x313c4 >> 2] = addSat(I[0x313c4 >> 2], bswap(I[0x315f4 >> 2]));
      }
    }
    I[I[0x30e38 >> 2] >> 2] = I[0x313c4 >> 2];
    I[0x30e38 >> 2] = (I[0x30e38 >> 2] + 4) | 0;
    I[0x30e70 >> 2] = (I[0x30e70 >> 2] + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  return 0;
}

/** vt+0x2ec 0x1001b230: from 0x30e70, walk a square spiral (right, up, left, down; rows bounded by the
 *  current row's ends, the image by 0x30e90..0x30e8c) for up to 0xa58 steps; the first pixel != the key
 *  goes to 0x313c4. 0x30eb8 = the ring reached. */
export function spiralSearch(c: Core): number {
  const I = c.m.I, L = lb(c);
  var base = I[0x30e90 >> 2], cur = I[0x30e70 >> 2], w = I[(0x9f4 + L) >> 2];
  var dir = 0, ring = 1, half = 1, left = 1, step = 1;
  var rs = (base + (Math.imul((((cur - base) | 0) >> 2) / w | 0, w) << 2)) | 0, re = (rs + (w << 2)) | 0;
  var max = (I[(0xa58 + L) >> 2] + 1) | 0, key = I[0x3158c >> 2];
  I[0x3105c >> 2] = 1;
  I[0x31664 >> 2] = max;
  for (;;) {
    if ((dir >>> 0) <= 3) {
      var hit: boolean;
      if (dir === 0) { cur = (cur + 4) | 0; if ((cur >>> 0) >= (re >>> 0)) break; }
      else if (dir === 1) { cur = (cur + (-w << 2)) | 0; if ((cur >>> 0) <= (base >>> 0)) break; }
      else if (dir === 2) { cur = (cur - 4) | 0; if ((cur >>> 0) <= (rs >>> 0)) break; }
      else { cur = (cur + (w << 2)) | 0; if ((cur >>> 0) >= (I[0x30e8c >> 2] >>> 0)) break; }
      hit = I[cur >> 2] !== key;
      if (hit) { I[0x313c4 >> 2] = I[cur >> 2]; break; }
    }
    if (--left <= 0) {
      var nd = (dir + 1) | 0;
      dir = nd < 4 ? nd : 0;
      if (dir === 2 || dir === 0) {
        rs = (base + (Math.imul((((cur - base) | 0) >> 2) / w | 0, w) << 2)) | 0;
        re = (rs + (w << 2)) | 0;
      }
      if (half === 0) { ring = (ring + 1) | 0; half = ring; left = ring; }
      else { left = half; half = 0; }
    }
    if (++step >= max) break;
  }
  // every field the walk updates, as it left them
  I[0x30f1c >> 2] = cur;
  I[0x30f34 >> 2] = dir;
  I[0x30eb8 >> 2] = ring;
  I[0x30f30 >> 2] = half;
  I[0x313e0 >> 2] = left;
  I[0x3105c >> 2] = step;
  I[0x30e80 >> 2] = rs;
  I[0x30e84 >> 2] = re;
  return 0;
}

/** vt+0x20c 0x1001b490: scroll the layer by (0x14c, 0x150) pixels (first folded into (-w, w) / (-h, h)),
 *  wrapping, or dropping what leaves the image when 1 <= 0xb44 <= 3; 0xb44 >= 3 starts from a copy of
 *  the image, else from the key colour; 0xb44 = 2 / 3 keep only the fractional part of the offsets. */
export function shift(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var n = Math.imul(I[(0x9f8 + L) >> 2], I[(0x9f4 + L) >> 2]), i: number;
  I[0x3165c >> 2] = n;
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e40 >> 2] = (I[0x30e1c >> 2] + (n << 2)) | 0;
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  I[0x30e90 >> 2] = I[0x30e48 >> 2];
  I[0x30e8c >> 2] = (I[0x30e48 >> 2] + (n << 2)) | 0;
  var d = I[0x30e38 >> 2] >> 2, s = I[0x30e70 >> 2] >> 2;
  if (I[(0xb44 + L) >> 2] >= 3) { for (i = 0; i < n; i++) I[d + i] = I[s + i]; }   // LOOP (n > 0)
  else if (n > 0) I.fill(I[0x3158c >> 2], d, d + n);
  var ox = (0x14c + X) >> 2, oy = (0x150 + X) >> 2;
  for (;;) {
    var W = I[(0x9f4 + L) >> 2], H = I[(0x9f8 + L) >> 2];
    if (!(W >= F[ox])) { F[ox] = F[ox] - W; continue; }
    if (-W > F[ox]) { F[ox] = W + F[ox]; continue; }
    if (!(H >= F[oy])) { F[oy] = F[oy] - H; continue; }
    if (-H > F[oy]) { F[oy] = H + F[oy]; continue; }
    break;
  }
  I[0x3155c >> 2] = I[(0x9f4 + L) >> 2];
  I[0x31558 >> 2] = I[(0x9f8 + L) >> 2];
  var dx = ftol(F[ox]), dy = ftol(F[oy]);
  I[0x31584 >> 2] = dx < 0 ? -dx | 0 : dx;
  I[0x31588 >> 2] = dy < 0 ? -dy | 0 : dy;
  I[0x3103c >> 2] = 0;
  do {
    var sp = I[0x30e70 >> 2];
    I[0x313c4 >> 2] = I[sp >> 2];
    pix: if (I[0x313c4 >> 2] !== I[0x3158c >> 2]) {
      I[0x31040 >> 2] = I[0x3103c >> 2];
      var wu = I[0x3155c >> 2] >>> 0, iu = I[0x31040 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x311e0 >> 2] = row;
      I[0x311e8 >> 2] = col;
      I[0x311ec >> 2] = (I[(0x9f4 + L) >> 2] - col) | 0;
      I[0x311f0 >> 2] = (I[(0x9f8 + L) >> 2] - row) | 0;
      var dp = I[0x30e38 >> 2];
      I[0x30e6c >> 2] = dp;
      var md = I[(0xb44 + L) >> 2], noWrap = md <= 3 && md >= 1, k = I[0x31584 >> 2], ww = I[0x3155c >> 2];
      if (k !== 0) {
        if (F[ox] > 0) {
          if (k < I[0x311ec >> 2]) I[0x30e6c >> 2] = (dp + (k << 2)) | 0;
          else { if (noWrap) break pix; I[0x30e6c >> 2] = (dp + ((k - ww) << 2)) | 0; }
        } else {
          if (!(k > I[0x311e8 >> 2])) I[0x30e6c >> 2] = (dp - (k << 2)) | 0;
          else { if (noWrap) break pix; I[0x30e6c >> 2] = (dp + ((ww - k) << 2)) | 0; }
        }
      }
      k = I[0x31588 >> 2];
      if (k !== 0) {
        var kw = Math.imul(k, ww), e: number;
        if (F[oy] > 0) {
          if (k < I[0x311f0 >> 2]) e = kw;
          else { if (noWrap) break pix; e = (kw - I[0x3165c >> 2]) | 0; }
        } else {
          if (!(k > I[0x311e0 >> 2])) e = -kw | 0;
          else { if (noWrap) break pix; e = (I[0x3165c >> 2] - kw) | 0; }
        }
        I[0x30e6c >> 2] = (I[0x30e6c >> 2] + (e << 2)) | 0;
      }
      I[I[0x30e6c >> 2] >> 2] = I[0x313c4 >> 2];
    }
    I[0x30e38 >> 2] = (I[0x30e38 >> 2] + 4) | 0;
    I[0x30e70 >> 2] = (sp + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  var m2 = I[(0xb44 + L) >> 2];
  if (m2 === 3 || m2 === 2) {                     // keep only the fractional part
    if (F[oy] >= 1) F[oy] = F[oy] - ftol(F[oy]);
    if (F[ox] >= 1) F[ox] = F[ox] - ftol(F[ox]);
    if (!(F[oy] > -1)) F[oy] = F[oy] - ftol(F[oy]);
    if (!(F[ox] > -1)) F[ox] = F[ox] - ftol(F[ox]);
  }
  return 0;
}

/** vt+0x1b0 0x1001ba50: mask by another layer (0xa30, same size, not this one): the target starts as the
 *  key; each opaque pixel whose mask pixel (that layer's current buffer) is not that layer's key is copied,
 *  the mask's alpha byte added to its own (saturating). */
export function mask(c: Core): number {
  const I = c.m.I, L = lb(c);
  var k2 = I[(0xa30 + L) >> 2], L2 = Math.imul(k2, 0x1ec);
  I[0x314ec >> 2] = k2;
  var w = I[(0x9f4 + L) >> 2], h = I[(0x9f8 + L) >> 2];
  if (I[(0x9f4 + L2) >> 2] !== w || I[(0x9f8 + L2) >> 2] !== h || k2 === I[0x1ca4 >> 2]) return 0;
  var n = Math.imul(w, h);
  I[0x30e38 >> 2] = I[0x30e1c >> 2];
  I[0x30e40 >> 2] = (I[0x30e1c >> 2] + (n << 2)) | 0;
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  I[0x30e90 >> 2] = I[0x30e48 >> 2];
  I[0x30e8c >> 2] = (I[0x30e48 >> 2] + (n << 2)) | 0;
  I[0x3165c >> 2] = n;
  I[0x314e8 >> 2] = I[(0x9e4 + L2) >> 2];
  I[0x30e88 >> 2] = I[(0x994 + L2) >> 2];
  var sel = I[(0xa24 + L2) >> 2], b: number;
  if (sel === 1) { b = I[(0xa28 + L2) >> 2]; if (b !== 0) I[0x30e88 >> 2] = b; }
  else if (sel === 2) { b = I[(0xb0c + L2) >> 2]; if (b !== 0) I[0x30e88 >> 2] = b; }
  var d = I[0x30e38 >> 2] >> 2;
  if (n > 0) I.fill(I[0x3158c >> 2], d, d + n);   // LOOP (n > 0)
  I[0x3103c >> 2] = 0;
  do {
    var mp = I[I[0x30e88 >> 2] >> 2];
    if (mp !== I[0x314e8 >> 2]) {
      var px = I[I[0x30e70 >> 2] >> 2];
      if (px !== I[0x3158c >> 2]) {
        I[0x313c4 >> 2] = px;
        I[0x314e4 >> 2] = mp;
        I[0x313c4 >> 2] = addSat(px, mp & 0xff000000);
        I[I[0x30e38 >> 2] >> 2] = I[0x313c4 >> 2];
      }
    }
    I[0x30e88 >> 2] = (I[0x30e88 >> 2] + 4) | 0;
    I[0x30e38 >> 2] = (I[0x30e38 >> 2] + 4) | 0;
    I[0x30e70 >> 2] = (I[0x30e70 >> 2] + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  return 0;
}

/** vt+0x208 0x1001bc70: the taper. Each opaque pixel's offset from the centre (w/2 + 0xa80, h/2 + 0xa84)
 *  is scaled, x by (bottom edge - row) * 0x15c / 100 and y by (right edge - col) * 0x160 / 100 when
 *  those are set, and lands at the truncated result (onto a key-filled target). */
export function taper(c: Core): number {
  const I = c.m.I, F = c.m.F, L = lb(c), X = xb(c);
  var n = Math.imul(I[(0x9f8 + L) >> 2], I[(0x9f4 + L) >> 2]);
  I[0x3165c >> 2] = n;
  I[0x30e40 >> 2] = (I[0x30e1c >> 2] + (n << 2)) | 0;
  I[0x30e70 >> 2] = I[0x30e48 >> 2];
  var d = I[0x30e1c >> 2] >> 2;
  if (n > 0) I.fill(I[0x3158c >> 2], d, d + n);   // LOOP (n > 0)
  I[0x30f08 >> 2] = (I[(0xa80 + L) >> 2] + ((I[(0x9f4 + L) >> 2] / 2) | 0)) | 0;
  I[0x30f10 >> 2] = (((I[(0x9f8 + L) >> 2] / 2) | 0) + I[(0xa84 + L) >> 2]) | 0;
  I[0x3155c >> 2] = I[(0x9f4 + L) >> 2];
  F[0x31544 >> 2] = F[(0x15c + X) >> 2] * K01;
  F[0x31548 >> 2] = F[(0x160 + X) >> 2] * K01;
  I[0x3103c >> 2] = 0;
  do {
    I[0x313c4 >> 2] = I[I[0x30e70 >> 2] >> 2];
    pix: if (I[0x313c4 >> 2] !== I[0x3158c >> 2]) {
      I[0x31040 >> 2] = I[0x3103c >> 2];
      var wu = I[0x3155c >> 2] >>> 0, iu = I[0x31040 >> 2] >>> 0, row = Math.floor(iu / wu), col = iu - row * wu;
      I[0x311fc >> 2] = row;
      I[0x311f8 >> 2] = col;
      var cx = I[0x30f08 >> 2], a = (col - cx) | 0, b = (row - I[0x30f10 >> 2]) | 0, fb = fr(b);
      F[0x31200 >> 2] = a;
      F[0x31204 >> 2] = b;
      if (nz(F[(0x15c + X) >> 2])) {
        F[0x31200 >> 2] = ((I[(0xa84 + L) >> 2] + I[(0x9f8 + L) >> 2] - row) | 0) * a * F[0x31544 >> 2];
      }
      if (nz(F[(0x160 + X) >> 2])) {
        F[0x31204 >> 2] = ((I[(0xa80 + L) >> 2] + I[(0x9f4 + L) >> 2] - col) | 0) * F[0x31548 >> 2] * fb;
      }
      var x = (cx + ftol(F[0x31200 >> 2])) | 0;
      I[0x313a0 >> 2] = x;
      var y = (ftol(F[0x31204 >> 2]) + I[0x30f10 >> 2]) | 0;
      I[0x313a8 >> 2] = y;
      var w = I[(0x9f4 + L) >> 2];
      if (y >= I[(0x9f8 + L) >> 2] || x >= w || y < 0 || x < 0) break pix;
      var t = (I[0x30e1c >> 2] + ((Math.imul(y, w) + x) << 2)) | 0;
      I[0x30e38 >> 2] = t;
      I[t >> 2] = I[0x313c4 >> 2];
    }
    I[0x30e70 >> 2] = (I[0x30e70 >> 2] + 4) | 0;
    I[0x3103c >> 2] = (I[0x3103c >> 2] + 1) | 0;
  } while (I[0x3103c >> 2] < I[0x3165c >> 2]);
  return 0;
}

// ------------------------------------------------------------------------------------------------ loading
/** vt+0x19c 0x100366d0: the picture's size on screen (obj+0x25ec x obj+0x25f0) and the sprite's offset. Sprite 6
 *  with obj+0x25e0 set covers the window keeping its aspect; a picture fills obj+0x36f8 percent of it, at least
 *  8 x 8 (Picture Viz II: 16). */
function fitSize(c: Core): number {
  const I = c.m.I, F = c.m.F, L = I[0x1ca4 >> 2], l = L * 0x1ec;
  const imgW = I[0x313e4 >> 2], imgH = I[0x313d4 >> 2];
  if (L === 6 && I[0x25e0 >> 2] !== 0) {
    const W = I[0x310dc >> 2], H = I[0x310e0 >> 2];
    I[0x25ec >> 2] = W;
    let fh = ftol(W * imgH / imgW);
    I[0x25f0 >> 2] = fh;
    if (fh < H) {
      I[0x25f0 >> 2] = H;
      I[0x25ec >> 2] = ftol(H * imgW / imgH);
    }
    I[(0x9e8 + l) >> 2] = 0;
    return 0;
  }
  const s = I[0x36f8 >> 2] * 0.01;          // double on the x87 stack; the stores round it
  F[0x3119c >> 2] = s;
  F[0x311a0 >> 2] = s;
  const W = I[0x310dc >> 2];
  const fw = ftol(W * s);
  I[0x25ec >> 2] = fw;
  const hf = fr(imgH), wf = fr(imgW);
  const fh = ftol(fw * hf / wf);
  I[0x25f0 >> 2] = fh;
  const hmax = ftol(I[0x310e0 >> 2] * s);
  if (fh > hmax) {
    I[0x25f0 >> 2] = hmax;
    I[0x25ec >> 2] = ftol(hmax * wf / hf);
  }
  I[(0x9e8 + l) >> 2] = ((W - I[0x25ec >> 2]) / 2) | 0;
  I[(0xa08 + l) >> 2] = -(((I[0x310e0 >> 2] - I[0x25f0 >> 2]) / 2) | 0);
  if (I[0x25ec >> 2] < 8 || I[0x25f0 >> 2] < 8) { I[0x25ec >> 2] = 8; I[0x25f0 >> 2] = 8; }   // PV2: 16
  return 0;
}

/** vt+0x230 0x1001fb60: free the current layer's image (if it owns one) and its work buffers */
function freeLayer(c: Core): number {
  const m = c.m, I = m.I, l = lb(c);
  if (I[(0x970 + l) >> 2] === -1 && I[(0x994 + l) >> 2] !== 0) {
    m.release(I[(0x994 + l) >> 2] - 0xc);
    I[(0x970 + l) >> 2] = 0;
    I[(0x994 + l) >> 2] = 0;
  }
  I[(0xa24 + l) >> 2] = 0;
  for (const f of [0xa2c, 0xa28, 0xb0c]) {
    if (I[(f + l) >> 2] !== 0) { m.release(I[(f + l) >> 2]); I[(f + l) >> 2] = 0; }
  }
  return 0;
}

/** vt+0x22c 0x1001fb20: freeLayer for layers 0..obj+0x31650 */
function freeLayers(c: Core): number {
  const I = c.m.I;
  let k = 0;
  do { I[0x1ca4 >> 2] = k; vt(c, 0x230); k++; } while ((k >>> 0) <= (c.m.I[0x31650 >> 2] >>> 0));
  c.m.I[0x1ca4 >> 2] = k;
  void I;
  return 0;
}

/** vt+0x280 0x100109f0: a layer bound to a table image (not its own, 0x970 != -1) is switched off;
 *  returns 1 when it was not */
function unbindLayer(c: Core): number {
  const I = c.m.I, l = lb(c);
  const was = I[(0x970 + l) >> 2] !== -1;
  if (was) { I[(0x96c + l) >> 2] = -1; I[(0x994 + l) >> 2] = 0; }
  return was ? 0 : 1;
}

def({
  0x2b0: project, 0x2b4: projectPos, 0x24c: scaleSize, 0x29c: renderLayer, 0x224: swapBuffers,
  0x238: allocWork1, 0x234: allocWork2, 0x23c: allocEdge, 0x240: scratch, 0x2b8: scratchRelease,
  0x1a4: clipRect, 0x1f0: clipCopy, 0x1c4: scaleSprite, 0x210: scaleSpriteClipped, 0x1c8: scaleDims,
  0x314: (c: Core) => ddaSprite(c, 0), 0x318: (c: Core) => ddaSprite(c, 1), 0x31c: (c: Core) => ddaSprite(c, 2),
  0x308: (c: Core) => ddaClipped(c, 0), 0x30c: (c: Core) => ddaClipped(c, 1), 0x310: (c: Core) => ddaClipped(c, 2),
  0x320: (c: Core) => dimsAt(c, 0), 0x328: (c: Core) => dimsAt(c, 1), 0x330: (c: Core) => dimsAt(c, 2),
  0x274: paletteFromLayer,
  0x25c: edgeDistance, 0x260: draw, 0x26c: blend, 0x338: fadeSub, 0x33c: fadeAdd, 0x268: alphaCopy,
  0x264: grabBackground, 0x200: colourWork, 0x250: alphaRing,
  0x1f8: warp, 0x1f4: spotlight, 0x1d0: spiralMap, 0x34c: stretch, 0x348: shear, 0x354: wave, 0x350: lens,
  0x35c: tile, 0x358: swirl, 0x1ec: blur, 0x300: splitPixel, 0x204: melt, 0x2ec: spiralSearch, 0x20c: shift,
  0x1b0: mask, 0x208: taper,
  0x19c: fitSize, 0x230: freeLayer, 0x22c: freeLayers, 0x280: unbindLayer,
});
