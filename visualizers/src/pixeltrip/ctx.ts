// PixelTrip's process-wide state and the arithmetic every part shares. The DLL keeps these as globals of the module
// (they outlive an engine reset, as a DLL's statics do); here one Ctx per PixelTrip instance.
//
// The DLL is VC6 x87 code run at 53-bit precision (0x27f): every FADD/FMUL/FDIV rounds to a double, so JS doubles
// reproduce it, and Math.fround reproduces each store to a float. Its rand is the static CRT's LCG at 0x10014f0b with
// holdrand at 0x100239ec, seeded once per engine by srand(GetTickCount()) (0x10001000).

export const F = Math.fround;

/** _ftol (0x10015350): truncate; out of range or NaN gives 0x80000000 */
export function ftol(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}

export class Ctx {
  /** GetTickCount for this frame (a uint32); the caller sets it before each render */
  tick = 0;
  hold = 1;
  /** 0x10026970: bounce on beat ("Enable Motion Bounce") currently on */
  bounce = 0;
  /** 0x1002698c: which of the lazily made path constants below exist */
  lazy = 0;
  /** 0x10026984, 0x1002697c, 0x10026980, 0x10026978: the tilted paths' angles (degrees 1..360 in radians) and its sin, cos */
  g5 = 0; g4 = 0; g4s = 0; g4c = 0;
  /** 0x10026988, 0x100231cc: the spiral path's radius and its direction */
  g2 = 0; dir2 = 1;
  /** 0x10026960/64 this frame's mean spectrum level per channel, 0x10026968/6c the previous frame's */
  avg0 = 0; avg1 = 0; prev0 = 0; prev1 = 0;

  srand(s: number): void { this.hold = s | 0; }
  rand(): number {
    this.hold = (Math.imul(this.hold, 214013) + 2531011) | 0;
    return (this.hold >> 16) & 0x7fff;
  }
  /** `(int)(rand() * k) / 0x7fff`, the 32-bit product wrapping as the DLL's IMUL does */
  rdiv(k: number): number { return (Math.imul(this.rand(), k) / 32767) | 0; }
  /** GetTickCount() % n == 0, an unsigned DIV */
  every(n: number): boolean { return (this.tick >>> 0) % (n >>> 0) === 0; }
  /** GetTickCount() + k as the DWORD the DLL stores */
  at(k: number): number { return ((k | 0) + this.tick) >>> 0; }
}

/** 0x100021c0 / 0x10002250: a deck of ids that hands one out per draw, moving it to the back (not a fair shuffle: the
 *  index is rand() % remaining, clamped below the last slot; once `left` reaches 0 it draws the first without rand) */
export class Deck {
  ids: number[];
  left: number;
  constructor(public c: Ctx, n: number) {
    this.ids = [];
    for (let i = 1; i <= n; i++) this.ids.push(i);
    this.left = n;
    for (let i = 0; i < n; i++) this.draw();
  }
  draw(): number {
    const n = this.ids.length;
    let i = 0;
    if (this.left !== 0) i = this.c.rand() % this.left;
    if (i >= n - 1) i = n - 2;
    const v = this.ids[i];
    for (; i < n - 1; i++) this.ids[i] = this.ids[i + 1];
    this.ids[n - 1] = v;
    if (--this.left < 0) this.left = n - 1;
    return v;
  }
}

/** 0x100085c0: HSV (h 0..1 in sixths, s, v) to RGB in place, as floats; out of 0..6 sixths it keeps (v, h*6, p) */
export function hsv(c: [number, number, number]): void {
  const s = c[1], v = c[2];
  if (!(s > 0)) { c[0] = v; c[1] = v; c[2] = v; return; }
  const h6 = c[0] * 6, h6f = F(h6), i = Math.floor(h6), f = h6f - i;
  const p = F((1 - s) * v), q = F((1 - f * s) * v), t = F((1 - (1 - f) * s) * v);
  switch (ftol(i)) {
    case 0: case 6: c[0] = v; c[1] = t; c[2] = p; break;
    case 1: c[0] = q; c[1] = v; c[2] = p; break;
    case 2: c[0] = p; c[1] = v; c[2] = t; break;
    case 3: c[0] = p; c[1] = q; c[2] = v; break;
    case 4: c[0] = t; c[1] = p; c[2] = v; break;
    case 5: c[0] = v; c[1] = p; c[2] = q; break;
    default: c[0] = v; c[1] = h6f; c[2] = p;
  }
}
