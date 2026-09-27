// Battery's 14 CShift feedback-warp kernels (wmp.dll). Specs: spec/battery/11-battery-warps-a.md
// (CRingSpinShift, CStretchShift, CShiitake, CStarburstShift, CSinShimmerShift, CTrigShift,
// CThingusShift) and 12-battery-warps-b.md (CTileShift, CTwirlocity, CLinearShift, CSwirlShift,
// CZoomShift, CTrigStretchShift, CEdgeFalloffShift). Oracles: spec/battery/ref-warps-{a,b}.py.
//
// warp(p) maps a DESTINATION pixel to its SOURCE pixel, in place, with no allocation and no
// clamping — BuildRows (0x180413630) does the per-axis out-of-range recovery, which mapPoint()
// reproduces. Motion is compounding: the map is static, the buffer iterates through it.
//
// Field naming: the contract names the eight parameter doubles dbl0..dbl7; the specs and the DLL
// name the same slots dbl1..dbl8 (+0x08..+0x40). So dbl0 === spec dbl1, dbl3 === spec dbl4, and
// setParams([dbl1..dbl8]) from the registry loads straight in.
// Wrapped verbatim from src/70-battery-warps.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from '../ns';
import '../rand';

// A destination/source coordinate pair, mutated in place by warp()/mapPoint() (BuildRows' WP).
interface Point {
  x: number;
  y: number;
}

// Everything battery/index.ts touches on a shift instance: the registry contract every class here
// implements (compatMask, identityRecovery, dbl0..dbl7, warp/randomize/setParams/setSize) plus the
// engine-side map/animation state it bolts on as expandos (allocMaps/buildRows/selectMap,
// makeShift, battery/index.ts) once a shift is wired into a preset. The expandos are optional: a
// freshly-constructed shift has none of them yet, and a placeholder (unknown className) has only
// the four no-op methods plus `placeholder`.
export interface BatteryShift {
  compatMask: number;
  identityRecovery: boolean;
  dbl0: number; dbl1: number; dbl2: number; dbl3: number;
  dbl4: number; dbl5: number; dbl6: number; dbl7: number;
  warp(p: Point): void;
  randomize(): this;
  setParams(a: number[]): this;
  setSize(w: number, h: number): this;
  // engine-side expandos (battery/index.ts: makeShift, allocMaps, buildRows, selectMap, ensureMap)
  className?: string;
  placeholder?: boolean;
  map?: Int32Array | null;
  animMap?: Int32Array[] | null;
  animIdx?: number;
  animHold?: number;
  mapComplete?: boolean;
  building?: boolean;
  buildRow?: number;
  mw?: number;
  mh?: number;
  cx?: number;
  cy?: number;
  prev?: BatteryShift | null;
}

// ns.ts types sin/cos/atan2 as interface methods (they're plain functions, never using `this`);
// referencing them unbound trips @typescript-eslint/unbound-method, which a cast doesn't silence
// (it inspects the member's declared origin, not the asserted type).
/* eslint-disable @typescript-eslint/unbound-method -- A.sin/A.cos/A.atan2 are plain functions, no `this` */
var fround = Math.fround, trunc = Math.trunc,
    sin = A.sin || Math.sin, cos = A.cos || Math.cos, sqrt = Math.sqrt;   // ucrtbase clones, 00-rand.js
// CRT-exact atan2 from 00-rand.js. Every warp here feeds atan2 straight into cos/sin and
// truncates the product (e.g. CStarburstShift 0x18041ac40 -> sin 0x18041ad3e -> mulsd
// 0x18041ad43 -> cvttsd2si 0x18041ad47), and on the image diagonals that product is an exact
// integer, so the cast is decided by atan2's last bit and a map entry moves one pixel.
// Math.atan2 disagrees with ucrtbase on 16.5% of the (always integer) argument pairs Battery
// actually uses; A.atan2 is ucrtbase's own algorithm and agrees on all of them.
var atan2 = A.atan2 || Math.atan2;
/* eslint-enable @typescript-eslint/unbound-method */

// Hand-typed DLL literals. Never "fix" these to Math.PI — the spec numbers depend on them.
var PI_F = 3.1415927410125732;      // 0x18088c440 = (double)(float)M_PI (CShiitake, CTwirlocity)
var PI_314 = 3.14;                  // 0x18088c438 (CSwirlShift shear)
var TAU_628 = 6.28;                 // 0x18088c460 (CStarburstShift sector width)
var HALFPI_157 = 1.57;              // 0x18088c410 (CTrigShift, CTrigStretchShift)
var TINY = 9.9999997473787516e-05;  // 0x18088c2d8 = (double)(float)1e-4 zero guard

// The compilers' single-precision constants, as doubles.
var f0_05 = fround(0.05), f0_1 = fround(0.1), f0_2 = fround(0.2),
    f0_4 = fround(0.4), f0_6 = fround(0.6), f0_8 = fround(0.8);

// u = (float)rand() / 32767.0f  (divss; MSVC 15-bit LCG, RAND_MAX 32767)
function u() { return fround(A.rand() / fround(32767)); }

// ---------------------------------------------------------------------------------------------
// Base: the parts of CShift (0x18040f308 ctor, AllocMaps, SetParams, BuildRows) every class shares.
// ---------------------------------------------------------------------------------------------
abstract class Shift {
  declare dbl0: number; declare dbl1: number; declare dbl2: number; declare dbl3: number;
  declare dbl4: number; declare dbl5: number; declare dbl6: number; declare dbl7: number;
  declare identityRecovery: boolean;
  declare compatMask: number;
  declare w: number; declare h: number; declare cx: number; declare cy: number;
  declare wmcx: number; declare hmcy: number;
  declare halfW: number; declare halfH: number;

  constructor() {
    this.dbl0 = 0.0; this.dbl1 = 0.0; this.dbl2 = 0.0; this.dbl3 = 0.0;
    this.dbl4 = 0.0; this.dbl5 = 0.0; this.dbl6 = 0.0; this.dbl7 = 0.0;
    this.identityRecovery = true;  // +0x1a0 = 1 (base default): out-of-range keeps dst coord
    this.compatMask = 0;           // +0xe0 (only CTileShift sets 1)
    this.w = 0; this.h = 0; this.cx = 0; this.cy = 0;
    this.wmcx = 0; this.hmcy = 0;  // W - cx, H - cy  (the canonical recentring terms)
    this.halfW = 0; this.halfH = 0;
    this.setSize(384, 288);        // retail internal render size
  }

  // AllocMaps (0x180413480): W,H then cx = W>>1, cy = H>>1 (arithmetic shifts).
  setSize(w: number, h: number): this {
    this.w = w; this.h = h;
    this.cx = w >> 1; this.cy = h >> 1;
    this.wmcx = w - this.cx; this.hmcy = h - this.cy;
    this.halfW = w >> 1; this.halfH = h >> 1;
    this.derive();
    return this;
  }

  // SetParams (0x180413230): the registry loader. Then Recalc → rebuild the map.
  setParams(a: number[]): this {
    for (var i = 0; i < 8; i++) (this as unknown as Record<string, number>)['dbl' + i] = i < a.length ? +a[i] : 0.0;
    this.derive();
    return this;
  }

  randomize(): this { this.derive(); return this; }

  // Everything a class can precompute from (w,h) and the parameters. Called on every write.
  derive(): void {}

  // Every registered leaf class provides this (never called on the base itself).
  abstract warp(p: Point): void;

  // BuildRows' per-axis recovery around Warp (0x1804136f9-0x18041374c). Signed compares.
  mapPoint(p: Point): Point {
    var x = p.x, y = p.y;
    this.warp(p);
    if (p.x < 0 || p.x >= this.w) p.x = this.identityRecovery ? x : 0;
    if (p.y < 0 || p.y >= this.h) p.y = this.identityRecovery ? y : 0;
    return p;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. CRingSpinShift — ring-quantised radial pinch + rigid spin. Warp 0x18041a870.
// ---------------------------------------------------------------------------------------------
class CRingSpinShift extends Shift {
  declare _ring: number;

  constructor() { super(); this.identityRecovery = false; }

  derive(): void {
    var ring = this.halfH * this.dbl1;          // (double)(H>>1) * dbl2
    this._ring = ring === 0.0 ? TINY : ring;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = fround(u() * 0.8);                    // [0, 0.8] of H>>1
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var th = atan2(dy, dx) + this.dbl0;
    var r = sqrt(dy * dy + dx * dx);
    var ring = this._ring;
    var m = r - trunc(r / ring) * ring;               // r mod ring, trunc toward zero
    var r2 = r - (m / ring) * m;
    p.y = (this.h - trunc(sin(th) * r2)) - this.cy;
    p.x = this.wmcx - trunc(cos(th) * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. CStretchShift — cubic radial suck + radius-proportional swirl. Warp 0x18041adc0.
// ---------------------------------------------------------------------------------------------
class CStretchShift extends Shift {
  declare _A: number;
  declare _wok: boolean;

  constructor() { super(); this.identityRecovery = false; }

  derive(): void {
    this._A = trunc(this.h * this.dbl1);  // integer! 0..86 px at H=288
    this._wok = this.w >= 2;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(u() * 0.3);                    // [0, 0.3] of H
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var rn = this._wok ? r / this.halfW : 0.0;
    var r2 = r - rn * rn * rn * this._A;
    var th = a0 + rn * this.dbl0;
    p.y = (this.h - trunc(sin(th) * r2)) - this.cy;
    p.x = this.wmcx - trunc(cos(th) * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. CShiitake — polar radial offset + spiral twist + angular ripple. Warp 0x18041a9b0.
// ---------------------------------------------------------------------------------------------
class CShiitake extends Shift {
  randomize(): this {
    this.dbl0 = fround(fround(u() * 11) - 1);                  // [-1, 10] px/frame
    var big = (A.rand() % 100) === 0;                          // 1-in-100 escape
    this.dbl1 = fround(fround(u() * (big ? 16 : f0_05)) * PI_F);   // 3.14159274f
    var wide = (A.rand() % 100) === 0;                         // 1-in-100 escape
    this.dbl2 = fround(u() * (wide ? 8 : f0_05));
    var r = A.rand();                                          // the three-way split
    this.dbl3 = 1 + (r % 10 === 0 ? A.rand() % 100
                   : r % 10 < 4 ? A.rand() % 5
                   : A.rand() % 2);
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var R = r + this.dbl0;
    var t = this.cy !== 0 ? (R + R) * PI_F / this.cy : R;
    var th = a0 + this.dbl1 * cos(t * this.dbl3) + this.dbl2 * t;
    p.y = this.hmcy - trunc(sin(th) * R);
    p.x = (this.w - trunc(cos(th) * R)) - this.cx;
  }
}

// ---------------------------------------------------------------------------------------------
// 4. CStarburstShift — CStretchShift plus an N-ray radial modulation. Warp 0x18041abf0.
// ---------------------------------------------------------------------------------------------
class CStarburstShift extends Shift {
  declare _A: number;
  declare _N: number;
  declare _sectorW: number;

  derive(): void {
    this._A = trunc(this.h * this.dbl1);
    this._N = trunc(this.dbl2);
    this._sectorW = TAU_628 / this.dbl2;   // Infinity when dbl3 == 0; see the write-back below
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(u() * 0.3);                    // [0, 0.3] of H
    var m = A.rand() % 40;
    this.dbl2 = m + (m % 2);                          // even, 0..40
    this.dbl3 = A.rand() % 2;                         // mode
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var rn = r / this.halfW;
    var g: number, r2: number;
    if (this.dbl3 === 0.0) {                          // mode A: smooth rays
      g = rn * sin(this._N * a0);
      r2 = r + g * g * g * this._A;
    } else {                                          // mode B: hard alternating sectors
      if (this.dbl2 === 0.0) {                        // 0x18041acf0: permanent self-repair
        this.dbl2 = 1.0; this._N = 1; this._sectorW = TAU_628;
      }
      var sect = trunc(a0 / this._sectorW);
      var d = rn * rn * rn * this._A;
      r2 = (sect & 1) ? r + d : r - d;
      g = rn;
    }
    var th = a0 + g * this.dbl0;
    p.y = this.hmcy - trunc(sin(th) * r2);
    p.x = this.wmcx - trunc(cos(th) * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 5. CSinShimmerShift — Cartesian single-axis sine shimmer. Warp 0x18041ab00.
// ---------------------------------------------------------------------------------------------
class CSinShimmerShift extends Shift {
  declare _mode: number;

  derive(): void { this._mode = trunc(this.dbl2); }

  randomize(): this {
    this.dbl0 = fround(fround(u() * 10) - 5);   // [-5, 5] px
    var t = u(); this.dbl1 = fround(t + t);     // (float)(u + u) — ONE draw, doubled: [0, 2]
    this.dbl2 = A.rand() % 2;                   // axis
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var x = p.x, y = p.y, f = this.dbl1;
    if (this._mode === 0) {
      p.y = trunc(y - this.dbl0 * (sin(x * f) + sin(y * f)));
    } else if (this._mode === 1) {
      p.x = trunc(x - this.dbl0 * (sin(y * f) + sin(x * f)));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6. CTrigShift — half-diagonal-normalised radial trig ripple + rigid spin. Warp 0x18041b2f0.
// ---------------------------------------------------------------------------------------------
class CTrigShift extends Shift {
  declare _D: number;
  declare _mode: number;
  declare _wd2: number;

  derive(): void {
    var D = 0.5 * sqrt(this.w * this.w + this.h * this.h);  // 240.0 at 384x288
    this._D = D === 0.0 ? TINY : D;
    this._mode = trunc(this.dbl2);
    this._wd2 = this.w * this.dbl1;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);         // [-0.05, 0.05]
    this.dbl1 = fround(fround(u() * 0.1) - f0_05);          // [-0.05, 0.05], double mul
    this.dbl2 = A.rand() % 3;                               // trig selector
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var m = this._mode, T = 0.0;
    if (m === 0) T = cos(a0) / HALFPI_157;
    else if (m === 1) T = sin(a0) / HALFPI_157;
    else if (m === 2) T = ((p.x & 1) ? sin(a0) : cos(a0)) / HALFPI_157;
    var r2 = r - this._wd2 * (r / this._D) * T;
    var th = a0 + this.dbl0;
    p.y = this.hmcy - trunc(sin(th) * r2);
    p.x = this.wmcx - trunc(cos(th) * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 7. CThingusShift — linear radial falloff toward a quarter-width ring. Warp 0x18041b0f0.
// ---------------------------------------------------------------------------------------------
class CThingusShift extends Shift {
  declare _qn: number;
  declare _qd: number;
  declare _wd2: number;

  derive(): void {
    this._qn = this.w >> 2;                      // (W>>2)
    this._qd = (this.w >> 1) + (this.w >> 2);    // (W>>1)+(W>>2)
    this._wd2 = this.w * this.dbl1;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_8) - f0_4);   // [-0.4, 0.4]
    this.dbl1 = fround(u() * f0_2);                  // [0, 0.2] of W
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var r = sqrt(dx * dx + dy * dy);
    var q = (this._qn - r) / this._qd;
    var r2 = this._wd2 * q + r;
    var a0 = atan2(dy, dx);
    var th = a0 + q * this.dbl0;
    p.y = this.hmcy - trunc(sin(th) * r2);
    p.x = (this.w - trunc(cos(th) * r2)) - this.cx;
  }
}

// ---------------------------------------------------------------------------------------------
// 8. CTileShift — separable cubic tile-edge pinch. Warp 0x18041b230.
// ---------------------------------------------------------------------------------------------
class CTileShift extends Shift {
  declare _P: number;

  constructor() { super(); this.compatMask = 1; }   // suppresses edge drawers in the pre pass

  derive(): void {
    var P = this.h * this.dbl0;                      // H for BOTH axes (DLL copy-paste, load-bearing)
    this._P = P === 0.0 ? TINY : P;
  }

  randomize(): this {
    this.dbl0 = fround(u() * 0.2);                   // [0, 0.2] of H
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var P = this._P, v: number, m: number, t: number;
    v = p.y;                                         // y is evaluated FIRST in the binary
    m = v - trunc(v / P) * P;
    t = m / P;
    p.y = v - trunc(t * t * t * m);
    v = p.x;
    m = v - trunc(v / P) * P;
    t = m / P;
    p.x = v - trunc(t * t * t * m);
  }
}

// ---------------------------------------------------------------------------------------------
// 9. CTwirlocity — 1/r-modulated polar twist, r preserved exactly. Warp 0x18041b700.
// ---------------------------------------------------------------------------------------------
class CTwirlocity extends Shift {
  declare _hy: number;
  declare _inward: boolean;

  derive(): void {
    this._hy = fround(fround(this.h) * fround(0.5));   // (double)((float)H * 0.5f)
    this._inward = this.dbl2 !== 0.0;                  // dbl3 is a boolean (p = 9/10 inward)
  }

  randomize(): this {
    this.dbl0 = A.rand() % 50 + 1;          // 1..50 rings
    this.dbl1 = fround(u() * f0_6);         // [0, 0.6] rad
    this.dbl2 = fround(A.rand() % 10);      // 0..9, used as a boolean
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var th0 = atan2(dy, dx);
    var r = sqrt(dy * dy + dx * dx);
    var hy = this._hy, q: number;
    if (!this._inward) q = hy === 0.0 ? 0.0 : r / hy;
    else q = r === 0.0 ? 0.0 : hy / r;
    var th = th0 + cos(q * PI_F * this.dbl0) * this.dbl1;
    p.y = this.hmcy - trunc(sin(th) * r);
    p.x = (this.w - trunc(cos(th) * r)) - this.cx;
  }
}

// ---------------------------------------------------------------------------------------------
// 10. CLinearShift — integer translate. Warp 0x18041a850 (16 bytes). Registered TWICE.
// ---------------------------------------------------------------------------------------------
class CLinearShift extends Shift {
  declare _dx: number;
  declare _dy: number;

  derive(): void { this._dx = trunc(this.dbl0); this._dy = trunc(this.dbl1); }

  randomize(): this {
    this.dbl0 = A.rand() % 6 - 3;   // -3..2 (asymmetric, and (0,0) is a legal draw)
    this.dbl1 = A.rand() % 6 - 3;
    this.derive();
    return this;
  }

  warp(p: Point): void { p.x = p.x + this._dx; p.y = p.y + this._dy; }
}

// ---------------------------------------------------------------------------------------------
// 11. CSwirlShift — sine pre-shear + polar twist + radial ripple + per-pixel dither.
//     Warp 0x18041af10. One Alchemy.rand() per destination pixel unless `dither` is set.
// ---------------------------------------------------------------------------------------------
class CSwirlShift extends Shift {
  declare dither: number | null;
  declare _kx: number;
  declare _ky: number;

  constructor() {
    super();
    this.dither = null;   // test hook: a number forces v and consumes no rand()
  }

  derive(): void {
    var two = this.dbl2 + this.dbl2;
    this._kx = two * PI_314 / this.h;   // x shear driven by y and H; multiply BEFORE divide
    this._ky = two * PI_314 / this.w;   // y shear driven by x and W
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = A.rand() % 20 - 10.0;                 // -10..9 px
    this.dbl2 = A.rand() % 24 - 12.0;                 // -12..11 lobes
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var x0 = p.x, y0 = p.y, amp = this.dbl1;
    // stage 1: separable sine shear — both terms read the ORIGINAL x0/y0.
    var px = x0 + trunc(sin(this._kx * y0) * amp);
    var py = y0 + trunc(cos(this._ky * x0) * amp);
    // stages 2+3: polar spin and the dbl3-lobed rosette ripple.
    var dx = this.cx - px, dy = this.cy - py;
    var th = atan2(dy, dx) + this.dbl0;
    var r = sqrt(dy * dy + dx * dx);
    var r2 = r - sin(th * this.dbl2) * amp;
    var sy = this.h - trunc(sin(th) * r2) - this.cy;
    var sx = this.wmcx - trunc(cos(th) * r2);
    // stage 4: outward 1-px dither, quadrant-signed off the destination pixel.
    var v = this.dither === null ? A.rand() % 4 - 2 : this.dither;
    if (y0 < this.cy) sy = sy - v; else sy = sy + v;
    if (x0 < this.cx) sx = sx - v; else sx = sx + v;
    p.x = sx; p.y = sy;
  }
}

// ---------------------------------------------------------------------------------------------
// 12. CZoomShift — linear radial zoom + spin. Warp 0x18041b850.
// ---------------------------------------------------------------------------------------------
class CZoomShift extends Shift {
  declare _diag: number;
  declare _wd2: number;

  constructor() { super(); this.identityRecovery = false; }

  derive(): void {
    var diag = sqrt(this.w * this.w + this.h * this.h) * 0.5;   // 268.328… at 384x288
    this._diag = diag === 0.0 ? TINY : diag;
    this._wd2 = this.w * this.dbl1;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = fround(fround(u() * 0.2) - f0_1);     // [-0.1, 0.1]; double mul, float sub
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var r = sqrt(dy * dy + dx * dx);
    var r2 = r - this._wd2 * (r / this._diag);
    var th = atan2(dy, dx) + this.dbl0;
    p.x = (this.w - trunc(cos(th) * r2)) - this.cx;
    p.y = this.hmcy - trunc(sin(th) * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 13. CTrigStretchShift — 1:2 blend of a cubic pinch and a directional zoom. Warp 0x18041b4a0.
// ---------------------------------------------------------------------------------------------
class CTrigStretchShift extends Shift {
  declare _diag: number;
  declare _mode: number;
  declare _A: number;
  declare _wd2: number;

  constructor() { super(); this.identityRecovery = false; }

  derive(): void {
    this._diag = sqrt(this.w * this.w + this.h * this.h) * 0.5;
    this._mode = trunc(this.dbl2);
    this._A = trunc(this.h * this.dbl3);   // (double)(int)(H * dbl4), truncated BEFORE q^3
    this._wd2 = this.w * this.dbl1;
  }

  randomize(): this {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(fround(u() * 0.1) - f0_05);    // [-0.05, 0.05]; double mul, float sub
    this.dbl2 = A.rand() % 3;                         // axis mode
    this.dbl3 = fround(u() * 0.3);                    // [0, 0.3] pinch depth
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var th0 = atan2(dy, dx);
    var r = sqrt(dy * dy + dx * dx);
    var m = this._mode, g = 0.0;
    if (m === 0) g = cos(th0) / HALFPI_157;
    else if (m === 1) g = sin(th0) / HALFPI_157;
    else if (m === 2) g = ((p.x & 1) ? sin(th0) : cos(th0)) / HALFPI_157;
    var q = r / this.halfW;
    var a = r - this._A * q * q * q;
    var b = r - this._wd2 * (r / this._diag) * g;
    var r2 = (a + b + b) / 3.0;
    var th = (th0 + this.dbl0 * q + 2.0 * (th0 + this.dbl0)) / 3.0;
    p.x = (this.w - trunc(cos(th) * r2)) - this.cx;
    p.y = (this.h - trunc(sin(th) * r2)) - this.cy;
  }
}

// ---------------------------------------------------------------------------------------------
// 14. CEdgeFalloffShift — one-axis edge-anchored scale. Warp 0x18041a770.
// ---------------------------------------------------------------------------------------------
class CEdgeFalloffShift extends Shift {
  declare _mode: number;
  declare _s: number;

  constructor() { super(); this.identityRecovery = false; }

  derive(): void { this._mode = trunc(this.dbl1); this._s = this.dbl0 + 1.0; }

  randomize(): this {
    this.dbl0 = fround(u() * f0_1);   // [0, 0.1] — always a magnification
    this.dbl1 = A.rand() % 4;         // anchor edge
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var s = this._s, d: number;
    switch (this._mode) {
      case 0: p.x = trunc(s * p.x); break;
      case 1: p.y = trunc(s * p.y); break;
      case 2: d = (this.w - p.x) - 1; p.x = p.x - trunc(s * d - d); break;
      case 3: d = (this.h - p.y) - 1; p.y = p.y - trunc(s * d - d); break;
      default: break;   // identity (reachable from a stored preset with dbl2 >= 4)
    }
  }
}

// RandomizeMovement's shift array, in the order 0x18040f470 appends it (verified against
// re/wmp/decomp/18040f470_FUN_18040f470.c): CLinearShift is registered twice — the two
// calls to its ctor 0x180411310 at 0x18040f5b4 and 0x18040f5ec — so the list is 15 entries
// over 14 classes and CLinearShift is picked with p = 2/15.
var ORDER: Array<new () => Shift> = [
  CLinearShift, CLinearShift, CThingusShift, CZoomShift, CRingSpinShift,
  CStretchShift, CTileShift, CTrigShift, CSinShimmerShift, CEdgeFalloffShift,
  CStarburstShift, CSwirlShift, CTrigStretchShift, CTwirlocity, CShiitake
];

export const BatteryWarps = {
  Shift: Shift,
  CRingSpinShift: CRingSpinShift,
  CShiitake: CShiitake,
  CStretchShift: CStretchShift,
  CStarburstShift: CStarburstShift,
  CTrigShift: CTrigShift,
  CThingusShift: CThingusShift,
  CSinShimmerShift: CSinShimmerShift,
  CTileShift: CTileShift,
  CTwirlocity: CTwirlocity,
  CLinearShift: CLinearShift,
  CSwirlShift: CSwirlShift,
  CZoomShift: CZoomShift,
  CTrigStretchShift: CTrigStretchShift,
  CEdgeFalloffShift: CEdgeFalloffShift,
  list: function () { return ORDER.slice(); }
};
A.BatteryWarps = BatteryWarps;
