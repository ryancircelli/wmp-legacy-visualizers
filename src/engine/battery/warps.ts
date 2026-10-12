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
  /** the WMP build whose arithmetic to use (12 default; 8, 9, 10, 11 for the variant presets), set by the engine */
  build?: number;
  setBuild?(b: number): void;
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
    sin = A.sin || Math.sin, cos = A.cos || Math.cos, sqrt = Math.sqrt,   // ucrtbase clones, 00-rand.js
    sincos = A.sincos;              // SC[0] = sin, SC[1] = cos of one angle: the same bits, one reduction
var SC = new Float64Array(2);
// CRT-exact atan2 from 00-rand.js. Every warp here feeds atan2 straight into cos/sin and
// truncates the product (e.g. CStarburstShift 0x18041ac40 -> sin 0x18041ad3e -> mulsd
// 0x18041ad43 -> cvttsd2si 0x18041ad47), and on the image diagonals that product is an exact
// integer, so the cast is decided by atan2's last bit and a map entry moves one pixel.
// Math.atan2 disagrees with ucrtbase on 16.5% of the (always integer) argument pairs Battery
// actually uses; A.atan2 is ucrtbase's own algorithm and agrees on all of them.
var atan2 = A.atan2 || Math.atan2;
/* eslint-enable @typescript-eslint/unbound-method */
import { sincos87, atan2_87, mulExt } from './x87';
import { atan2_32, sinExt32, cosExt32 } from './msvcrt';

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
// The x86 builds' arithmetic (WMP 8, 9, 10: the variant presets, index.ts GROUPS). x87 at 53 bits: every
// +,-,*,/ of doubles below is one x87 op in the DLL's operand order (FUNCTION-MAP-X86 §7). Randomize: u =
// (double)rand() * float(1/32767), an exact product (0x07743aa4), and the parameters are stored as doubles,
// never rounded to float. Polar warps share ToPolar (WMP 9 0x0779932f: th = FPATAN(dy, dx) stored as a double,
// r = FSQRT of the integer sum) and FromPolar (0x0779938b: y = (H-cy) - trunc(FSIN(th)*r), x = (W-cx) -
// trunc(FCOS(th)*r), each product one rounding of the 64-bit sine/cosine). WMP 11 keeps WMP 12's path here.
var C32767 = fround(1 / 32767);       // 3.0518509447574615e-05
function u87(): number { return A.rand() * C32767; }
var INV_157 = 0.6369426751592356;     // 0x077c40d8: 1/1.57 as the x86 builds multiply by it
var THIRD = 0.3333333333333333;       // 0x077b7b98
var TAU_F = 6.2831854820251465;       // 0x077b7b60 = (double)(float)2pi
var EX = new Float64Array(4), EY = new Float64Array(4), AT = new Float64Array(2);
function isX87(s: { build?: number }): boolean { var b = s.build; return b !== undefined && b !== 12 && b !== 11; }
// WMP 11 (its own /fp:precise-like build): Randomize stores F32((double)rand()/32767.0 * k) and subtracts the
// offset in double (WMP 11 0x13164300 etc.); its warps are WMP 12's formulas in double with msvcrt's trig.
function is11(s: { build?: number }): boolean { return s.build === 11; }
function u11(k: number): number { return fround((A.rand() / 32767) * k); }
// WMP 11's trig is msvcrt's _CIsin/_CIcos/_CIatan2, which on the harness run the x87 instructions (msvcrt.ts):
// 64-bit results, each product with them one rounding; ToPolar = _CIatan2 + _CIsqrt (0x1315e492), FromPolar =
// _CIsin/_CIcos (0x1315e4e4), shaped like WMP 9's.
var E11 = new Float64Array(2);
function sin11(x: number): Float64Array { sinExt32(x, E11); return E11; }
function cos11(x: number): Float64Array { cosExt32(x, E11); return E11; }
function sinExt32d(x: number): number { sinExt32(x, E11); return E11[0] + E11[1]; }
function fromPolar11(sh: Shift, p: Point, th: number, r: number): void {
  sinExt32(th, E11); var yo = trunc(mulExt(r, E11[0], E11[1]));
  cosExt32(th, E11); var xo = trunc(mulExt(r, E11[0], E11[1]));
  p.y = sh.hmcy - yo; p.x = sh.wmcx - xo;
}
/** a 64-bit register value divided by a double, one rounding (fdiv QWORD after _CIcos) */
function divExt(hi: number, lo: number, d: number): number {
  var q = hi / d; return q + (A.fma(-q, d, hi) + lo) / d;
}
function atan87(dy: number, dx: number): number { atan2_87(dy, dx, AT); return AT[0] + AT[1]; }
function sinExt(x: number): Float64Array { sincos87(x, EX); return EX; }       // [sinHi, sinLo, cosHi, cosLo]
/** the sum of two 64-bit register values, rounded once to 53 bits (faddp of two FSIN results) */
function addExt(ah: number, al: number, bh: number, bl: number): number {
  var s = ah + bh, bb = s - ah, e = (ah - (s - bb)) + (bh - bb);
  return s + (e + al + bl);
}
/** FromPolar: p = ((H - cy) - trunc(sin*r), (W - cx) - trunc(cos*r)) */
function fromPolar87(sh: Shift, p: Point, th: number, r: number): void {
  sincos87(th, EX);
  var yo = trunc(mulExt(r, EX[0], EX[1])), xo = trunc(mulExt(r, EX[2], EX[3]));
  p.y = sh.hmcy - yo; p.x = sh.wmcx - xo;
}
/** WMP 11's selector: _CIcos (0), _CIsin (1), by x parity (2: odd _CIsin), else 0, divided by 1.57 */
function trig11(mode: number, x: number, th0: number): number {
  if (mode < 0 || mode > 2) return 0.0;
  var e = (mode === 1 || (mode === 2 && (x % 2) !== 0)) ? sin11(th0) : cos11(th0);
  return divExt(e[0], e[1], HALFPI_157);
}
/** CTrigShift / CTrigStretchShift's selector: FCOS (0), FSIN (1), by x parity (2: odd FSIN), else 0, times 1/1.57 */
function trig87(mode: number, x: number, th0: number): number {
  if (mode < 0 || mode > 2) return 0.0;
  sincos87(th0, EY);
  var useSin = mode === 1 || (mode === 2 && (x % 2) !== 0);
  return useSin ? mulExt(INV_157, EY[0], EY[1]) : mulExt(INV_157, EY[2], EY[3]);
}

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
  declare build: number;

  constructor() {
    this.build = 12;
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
    if (is11(this)) { this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.8); this.derive(); return this; }
    if (isX87(this)) { this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.8; this.derive(); return this; }   // 0x07974e32
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = fround(u() * 0.8);                    // [0, 0.8] of H>>1
    this.derive();
    return this;
  }

  // WMP 9/10 0x07974e80: q = trunc(r * (1/ring)), r2 = r - ((1/ring)*m)*m, the 1e-4 guard; WMP 8 divides, no guard
  warp87(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y, th0 = atan87(dy, dx), r = sqrt(dy * dy + dx * dx);
    var ring = this.halfH * this.dbl1, q, m, r2;
    if (this.build === 8) { q = trunc(r / ring); m = r - q * ring; r2 = r - (m / ring) * m; }
    else { if (ring === 0.0) ring = TINY; var inv = 1 / ring; q = trunc(inv * r); m = r - q * ring; r2 = r - (inv * m) * m; }
    fromPolar87(this, p, th0 + this.dbl0, r2);
  }

  warp(p: Point): void {
    if (isX87(this)) { this.warp87(p); return; }
    if (is11(this)) {                                 // WMP 11 0x13164354: WMP 12's divisions
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), r1 = sqrt(dy1 * dy1 + dx1 * dx1);
      var g1 = this._ring, m1 = r1 - trunc(r1 / g1) * g1;
      fromPolar11(this, p, this.dbl0 + th1, r1 - (m1 / g1) * m1);
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var th = atan2(dy, dx) + this.dbl0;
    var r = sqrt(dy * dy + dx * dx);
    var ring = this._ring;
    var m = r - trunc(r / ring) * ring;               // r mod ring, trunc toward zero
    var r2 = r - (m / ring) * m;
    sincos(th, SC);
    p.y = (this.h - trunc(SC[0] * r2)) - this.cy;
    p.x = this.wmcx - trunc(SC[1] * r2);
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
    if (is11(this)) { this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.3); this.derive(); return this; }
    if (isX87(this)) { this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.3; this.derive(); return this; }   // 0x077a1fd4
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(u() * 0.3);                    // [0, 0.3] of H
    this.derive();
    return this;
  }

  warp(p: Point): void {
    if (is11(this)) {                                 // WMP 11 0x131644ac: ((rn*rn)*rn)*A, as WMP 12
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), r1 = sqrt(dy1 * dy1 + dx1 * dx1);
      var rn1 = this._wok ? r1 / this.halfW : 0.0;
      fromPolar11(this, p, rn1 * this.dbl0 + th1, r1 - ((rn1 * rn1) * rn1) * this._A);
      return;
    }
    if (isX87(this)) {                                // 0x077a21a6: r2 = r - ((A*rn)*rn)*rn
      var dx8 = this.cx - p.x, dy8 = this.cy - p.y, th8 = atan87(dy8, dx8), r8 = sqrt(dy8 * dy8 + dx8 * dx8);
      var rn8 = this._wok ? r8 / this.halfW : 0.0, A8 = this._A;
      fromPolar87(this, p, rn8 * this.dbl0 + th8, r8 - ((A8 * rn8) * rn8) * rn8);
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var rn = this._wok ? r / this.halfW : 0.0;
    var r2 = r - rn * rn * rn * this._A;
    var th = a0 + rn * this.dbl0;
    sincos(th, SC);
    p.y = (this.h - trunc(SC[0] * r2)) - this.cy;
    p.x = this.wmcx - trunc(SC[1] * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. CShiitake — polar radial offset + spiral twist + angular ripple. Warp 0x18041a9b0.
// ---------------------------------------------------------------------------------------------
class CShiitake extends Shift {
  randomize(): this {
    if (is11(this)) {                                          // WMP 11: F32((u*k)*pi_f), k = 16 or 0.05f
      this.dbl0 = u11(11) - 1;
      var big11 = (A.rand() % 100) === 0;
      this.dbl1 = fround((A.rand() / 32767) * (big11 ? 16 : f0_05) * PI_F);
      this.dbl2 = u11((A.rand() % 100) === 0 ? 8 : f0_05);
      var r11 = A.rand();
      this.dbl3 = 1 + (r11 % 10 === 0 ? A.rand() % 100 : r11 % 10 < 4 ? A.rand() % 5 : A.rand() % 2);
      this.derive();
      return this;
    }
    if (isX87(this)) {                                         // 0x077cadf7: folded F32(0.05pi), F32(16pi)
      this.dbl0 = u87() * 11 - 1;
      var big8 = (A.rand() % 100) === 0;                       // the 1-in-100 test draws first
      this.dbl1 = u87() * (big8 ? 50.26548385620117 : 0.15707963705062866);
      var wide8 = (A.rand() % 100) === 0;
      this.dbl2 = u87() * (wide8 ? 8 : f0_05);
      var r8 = A.rand();
      this.dbl3 = 1 + (r8 % 10 === 0 ? A.rand() % 100 : r8 % 10 < 4 ? A.rand() % 5 : A.rand() % 2);
      this.derive();
      return this;
    }
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
    if (is11(this)) {                                 // WMP 11 0x13165180: ((cos(dbl4*t)*dbl2) + th0) + dbl3*t
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), R1 = this.dbl0 + sqrt(dy1 * dy1 + dx1 * dx1);
      var t1 = this.cy !== 0 ? ((R1 + R1) * PI_F) / this.cy : R1;
      var c1 = cos11(this.dbl3 * t1);
      fromPolar11(this, p, (mulExt(this.dbl1, c1[0], c1[1]) + th1) + this.dbl2 * t1, R1);
      return;
    }
    if (isX87(this)) {                                // 0x077ce73c: th = (cos_x87(t*dbl4)*dbl2 + th0) + t*dbl3
      var dx8 = this.cx - p.x, dy8 = this.cy - p.y, th8 = atan87(dy8, dx8), R8 = sqrt(dy8 * dy8 + dx8 * dx8) + this.dbl0;
      var t8 = this.cy !== 0 ? (TAU_F * R8) / this.cy : R8;
      var c8 = sinExt(t8 * this.dbl3);
      fromPolar87(this, p, (mulExt(this.dbl1, c8[2], c8[3]) + th8) + t8 * this.dbl2, R8);
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var R = r + this.dbl0;
    var t = this.cy !== 0 ? (R + R) * PI_F / this.cy : R;
    var th = a0 + this.dbl1 * cos(t * this.dbl3) + this.dbl2 * t;
    sincos(th, SC);
    p.y = this.hmcy - trunc(SC[0] * R);
    p.x = (this.w - trunc(SC[1] * R)) - this.cx;
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
    if (is11(this)) { this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.3); }
    else if (isX87(this)) { this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.3; }   // 0x077a8872
    else {
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(u() * 0.3);                    // [0, 0.3] of H
    }
    var m = A.rand() % 40;
    this.dbl2 = m + (m % 2);                          // even, 0..40
    this.dbl3 = A.rand() % 2;                         // mode
    this.derive();
    return this;
  }

  // 0x077a8b54: mode A g = rn * FSIN(N*th0), r2 = r + ((A*g)*g)*g; mode B d = ((A*rn)*rn)*rn by sector parity,
  // the dbl3 = 1 repair (none in WMP 8: 6.28/0 puts every pixel in sector 0); th = g*dbl1 + th0
  warp87(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y, th0 = atan87(dy, dx), r = sqrt(dy * dy + dx * dx);
    var A0 = this._A, rn = r / this.halfW, g: number, r2: number;
    if (this.dbl3 === 0.0) {
      var s = sinExt(trunc(this.dbl2) * th0);
      g = mulExt(rn, s[0], s[1]);
      r2 = r + ((A0 * g) * g) * g;
    } else {
      if (this.dbl2 === 0.0 && this.build !== 8) { this.dbl2 = 1.0; this.derive(); }
      var sect = trunc(th0 / (TAU_628 / this.dbl2)), d = ((A0 * rn) * rn) * rn;
      r2 = (sect % 2 !== 0) ? r + d : r - d;
      g = rn;
    }
    fromPolar87(this, p, g * this.dbl0 + th0, r2);
  }

  // WMP 11 0x13164bbc: mode A g = sin(N*th0)*rn, ((g*g)*g)*A; mode B ((rn*rn)*rn)*A; WMP 12's repair
  warp11(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y, th0 = atan2_32(dy, dx), r = sqrt(dy * dy + dx * dx);
    var A0 = this._A, rn = r / this.halfW, g: number, r2: number;
    if (this.dbl3 === 0.0) {
      var s = sin11(trunc(this.dbl2) * th0);
      g = mulExt(rn, s[0], s[1]);
      r2 = r + ((g * g) * g) * A0;
    } else {
      if (this.dbl2 === 0.0) { this.dbl2 = 1.0; this.derive(); }
      var sect = trunc(th0 / (TAU_628 / this.dbl2)), d = ((rn * rn) * rn) * A0;
      r2 = (sect % 2 !== 0) ? r + d : r - d;
      g = rn;
    }
    fromPolar11(this, p, g * this.dbl0 + th0, r2);
  }

  warp(p: Point): void {
    if (isX87(this)) { this.warp87(p); return; }
    if (is11(this)) { this.warp11(p); return; }
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
    sincos(th, SC);
    p.y = this.hmcy - trunc(SC[0] * r2);
    p.x = this.wmcx - trunc(SC[1] * r2);
  }
}

// ---------------------------------------------------------------------------------------------
// 5. CSinShimmerShift — Cartesian single-axis sine shimmer. Warp 0x18041ab00.
// ---------------------------------------------------------------------------------------------
class CSinShimmerShift extends Shift {
  declare _mode: number;

  derive(): void { this._mode = trunc(this.dbl2); }

  randomize(): this {
    if (is11(this)) {
      this.dbl0 = u11(10) - 5; var t11 = A.rand() / 32767; this.dbl1 = fround(t11 + t11); this.dbl2 = A.rand() % 2; this.derive(); return this;
    }
    if (isX87(this)) {                          // 0x0797505e
      this.dbl0 = u87() * 10 - 5; var t8 = u87(); this.dbl1 = t8 + t8; this.dbl2 = A.rand() % 2; this.derive(); return this;
    }
    this.dbl0 = fround(fround(u() * 10) - 5);   // [-5, 5] px
    var t = u(); this.dbl1 = fround(t + t);     // (float)(u + u) — ONE draw, doubled: [0, 2]
    this.dbl2 = A.rand() % 2;                   // axis
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var x = p.x, y = p.y, f = this.dbl1;
    if (is11(this)) {                           // WMP 11 0x131648f7: the first sine stored as a double, the second added
      var s1: number, e1: Float64Array;
      if (this._mode === 0) { s1 = sinExt32d(x * f); e1 = sin11(f * y); p.y = trunc(y - (e1[0] + (e1[1] + s1)) * this.dbl0); }
      else if (this._mode === 1) { s1 = sinExt32d(y * f); e1 = sin11(f * x); p.x = trunc(x - (e1[0] + (e1[1] + s1)) * this.dbl0); }
      return;
    }
    if (isX87(this)) {                          // 0x079750b1: the two FSIN results summed in the register
      var a: Float64Array, b: Float64Array, ah: number, al: number;
      if (this._mode === 0) {
        a = sinExt(x * f); ah = a[0]; al = a[1]; b = sinExt(y * f);
        p.y = trunc(y - addExt(ah, al, b[0], b[1]) * this.dbl0);
      } else if (this._mode === 1) {
        a = sinExt(y * f); ah = a[0]; al = a[1]; b = sinExt(x * f);
        p.x = trunc(x - addExt(ah, al, b[0], b[1]) * this.dbl0);
      }
      return;
    }
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
    if (is11(this)) { this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.1) - f0_05; this.dbl2 = A.rand() % 3; this.derive(); return this; }
    if (isX87(this)) {                                      // 0x07974f1c
      this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.1 - f0_05; this.dbl2 = A.rand() % 3; this.derive(); return this;
    }
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);         // [-0.05, 0.05]
    this.dbl1 = fround(fround(u() * 0.1) - f0_05);          // [-0.05, 0.05], double mul
    this.dbl2 = A.rand() % 3;                               // trig selector
    this.derive();
    return this;
  }

  warp(p: Point): void {
    if (is11(this)) {                                       // WMP 11 0x1316472f: T = trig(th0) / 1.57
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), r1 = sqrt(dy1 * dy1 + dx1 * dx1);
      fromPolar11(this, p, this.dbl0 + th1, r1 - (this._wd2 * (r1 / this._D)) * trig11(this._mode, p.x, th1));
      return;
    }
    if (isX87(this)) {                                      // 0x07974f79: T = trig_x87(th0) * (1/1.57)
      var dx8 = this.cx - p.x, dy8 = this.cy - p.y, th8 = atan87(dy8, dx8), r8 = sqrt(dy8 * dy8 + dx8 * dx8);
      var T8 = trig87(this._mode, p.x, th8);
      fromPolar87(this, p, th8 + this.dbl0, r8 - (this._wd2 * (r8 / this._D)) * T8);
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var a0 = atan2(dy, dx);
    var r = sqrt(dx * dx + dy * dy);
    var m = this._mode, T = 0.0;
    if (m === 0) T = cos(a0) / HALFPI_157;
    else if (m === 1) T = sin(a0) / HALFPI_157;
    else if (m === 2) T = ((p.x & 1) ? sin(a0) : cos(a0)) / HALFPI_157;
    var r2 = r - this._wd2 * (r / this._D) * T;
    var th = a0 + this.dbl0;
    sincos(th, SC);
    p.y = this.hmcy - trunc(SC[0] * r2);
    p.x = this.wmcx - trunc(SC[1] * r2);
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
    if (is11(this)) { this.dbl0 = u11(f0_8) - f0_4; this.dbl1 = u11(f0_2); this.derive(); return this; }
    if (isX87(this)) { this.dbl0 = u87() * f0_8 - f0_4; this.dbl1 = u87() * f0_2; this.derive(); return this; }   // 0x07974d70
    this.dbl0 = fround(fround(u() * f0_8) - f0_4);   // [-0.4, 0.4]
    this.dbl1 = fround(u() * f0_2);                  // [0, 0.2] of W
    this.derive();
    return this;
  }

  warp(p: Point): void {
    if (is11(this)) {                                // WMP 11 0x131640a0: as WMP 12
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), r1 = sqrt(dy1 * dy1 + dx1 * dx1);
      var q1 = (this._qn - r1) / this._qd;
      fromPolar11(this, p, q1 * this.dbl0 + th1, this._wd2 * q1 + r1);
      return;
    }
    if (isX87(this)) {                               // 0x07974db6
      var dx8 = this.cx - p.x, dy8 = this.cy - p.y, th8 = atan87(dy8, dx8), r8 = sqrt(dy8 * dy8 + dx8 * dx8);
      var q8 = (this._qn - r8) / this._qd;
      fromPolar87(this, p, q8 * this.dbl0 + th8, this._wd2 * q8 + r8);
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var r = sqrt(dx * dx + dy * dy);
    var q = (this._qn - r) / this._qd;
    var r2 = this._wd2 * q + r;
    var a0 = atan2(dy, dx);
    var th = a0 + q * this.dbl0;
    sincos(th, SC);
    p.y = this.hmcy - trunc(SC[0] * r2);
    p.x = (this.w - trunc(SC[1] * r2)) - this.cx;
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
    if (is11(this)) { this.dbl0 = u11(0.2); this.derive(); return this; }
    if (isX87(this)) { this.dbl0 = u87() * 0.2; this.derive(); return this; }   // 0x077abd32
    this.dbl0 = fround(u() * 0.2);                   // [0, 0.2] of H
    this.derive();
    return this;
  }

  // WMP 9/10 0x077abd90: inv = 1/P, q = trunc(inv*v), t = inv*m, guard; WMP 8 divides (no guard)
  warp87(p: Point): void {
    var P = this.h * this.dbl0, v: number, m: number, t: number;
    if (this.build === 8) {
      v = p.y; m = v - trunc(v / P) * P; t = m / P; p.y = v - trunc(((t * t) * t) * m);
      v = p.x; m = v - trunc(v / P) * P; t = m / P; p.x = v - trunc(((t * t) * t) * m);
      return;
    }
    if (P === 0.0) P = TINY;
    var inv = 1 / P;
    v = p.y; m = v - trunc(inv * v) * P; t = inv * m; p.y = v - trunc(((t * t) * t) * m);
    v = p.x; m = v - trunc(inv * v) * P; t = inv * m; p.x = v - trunc(((t * t) * t) * m);
  }

  warp(p: Point): void {
    if (isX87(this)) { this.warp87(p); return; }
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
    if (is11(this)) { this.dbl0 = A.rand() % 50 + 1; this.dbl1 = u11(f0_6); this.dbl2 = A.rand() % 10; this.derive(); return this; }
    if (isX87(this)) {                      // 0x07798a7a
      this.dbl0 = A.rand() % 50 + 1; this.dbl1 = u87() * f0_6; this.dbl2 = A.rand() % 10; this.derive(); return this;
    }
    this.dbl0 = A.rand() % 50 + 1;          // 1..50 rings
    this.dbl1 = fround(u() * f0_6);         // [0, 0.6] rad
    this.dbl2 = fround(A.rand() % 10);      // 0..9, used as a boolean
    this.derive();
    return this;
  }

  warp(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var th0 = isX87(this) ? atan87(dy, dx) : is11(this) ? atan2_32(dy, dx) : atan2(dy, dx);
    var r = sqrt(dy * dy + dx * dx);
    var hy = this._hy, q: number;
    if (!this._inward) q = hy === 0.0 ? 0.0 : r / hy;
    else q = r === 0.0 ? 0.0 : hy / r;
    if (is11(this)) {                       // WMP 11 0x13164f58: as WMP 9 with _CIcos
      var c1 = cos11(q * PI_F * this.dbl0);
      fromPolar11(this, p, mulExt(this.dbl1, c1[0], c1[1]) + th0, r);
      return;
    }
    if (isX87(this)) {                      // 0x07799265: th = FCOS((q*pi_f)*dbl1)*dbl2 + th0
      var c8 = sinExt(q * PI_F * this.dbl0);
      fromPolar87(this, p, mulExt(this.dbl1, c8[2], c8[3]) + th0, r);
      return;
    }
    var th = th0 + cos(q * PI_F * this.dbl0) * this.dbl1;
    sincos(th, SC);
    p.y = this.hmcy - trunc(SC[0] * r);
    p.x = (this.w - trunc(SC[1] * r)) - this.cx;
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
    this.dbl0 = is11(this) ? u11(f0_1) - f0_05 : isX87(this) ? u87() * f0_1 - f0_05 : fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = A.rand() % 20 - 10.0;                 // -10..9 px
    this.dbl2 = A.rand() % 24 - 12.0;                 // -12..11 lobes
    this.derive();
    return this;
  }

  // 0x077ca879: the shear arguments ((dbl3*6.28)/H)*y0 and ((dbl3*6.28)/W)*x0, every sine/cosine a 64-bit result
  warp87(p: Point): void {
    var x0 = p.x, y0 = p.y, amp = this.dbl1, e: Float64Array;
    e = sinExt(((this.dbl2 * TAU_628) / this.h) * y0);
    var px = x0 + trunc(mulExt(amp, e[0], e[1]));
    e = sinExt(((this.dbl2 * TAU_628) / this.w) * x0);
    var py = y0 + trunc(mulExt(amp, e[2], e[3]));
    var dx = this.cx - px, dy = this.cy - py;
    var th = atan87(dy, dx) + this.dbl0, r = sqrt(dy * dy + dx * dx);
    e = sinExt(th * this.dbl2);
    fromPolar87(this, p, th, r - mulExt(amp, e[0], e[1]));
    var v = this.dither === null ? A.rand() % 4 - 2 : this.dither;
    p.y = y0 < this.cy ? p.y - v : p.y + v;
    p.x = x0 < this.cx ? p.x - v : p.x + v;
  }

  // WMP 11 0x13164d88: WMP 12's shear arguments ((dbl3+dbl3)*3.14)/H*y0, _CIsin/_CIcos 64-bit results
  warp11(p: Point): void {
    var x0 = p.x, y0 = p.y, amp = this.dbl1, e: Float64Array;
    e = sin11(this._kx * y0);
    var px = x0 + trunc(mulExt(amp, e[0], e[1]));
    e = cos11(this._ky * x0);
    var py = y0 + trunc(mulExt(amp, e[0], e[1]));
    var dx = this.cx - px, dy = this.cy - py;
    var th = this.dbl0 + atan2_32(dy, dx), r = sqrt(dy * dy + dx * dx);
    e = sin11(th * this.dbl2);
    fromPolar11(this, p, th, r - mulExt(amp, e[0], e[1]));
    var v = this.dither === null ? A.rand() % 4 - 2 : this.dither;
    p.y = y0 < this.cy ? p.y - v : p.y + v;
    p.x = x0 < this.cx ? p.x - v : p.x + v;
  }

  warp(p: Point): void {
    if (isX87(this)) { this.warp87(p); return; }
    if (is11(this)) { this.warp11(p); return; }
    var x0 = p.x, y0 = p.y, amp = this.dbl1;
    // stage 1: separable sine shear — both terms read the ORIGINAL x0/y0.
    var px = x0 + trunc(sin(this._kx * y0) * amp);
    var py = y0 + trunc(cos(this._ky * x0) * amp);
    // stages 2+3: polar spin and the dbl3-lobed rosette ripple.
    var dx = this.cx - px, dy = this.cy - py;
    var th = atan2(dy, dx) + this.dbl0;
    var r = sqrt(dy * dy + dx * dx);
    var r2 = r - sin(th * this.dbl2) * amp;
    sincos(th, SC);
    var sy = this.h - trunc(SC[0] * r2) - this.cy;
    var sx = this.wmcx - trunc(SC[1] * r2);
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
    if (is11(this)) { this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.2) - f0_1; this.derive(); return this; }
    if (isX87(this)) { this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.2 - f0_1; this.derive(); return this; }   // 0x077a1f88
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05] rad/frame
    this.dbl1 = fround(fround(u() * 0.2) - f0_1);     // [-0.1, 0.1]; double mul, float sub
    this.derive();
    return this;
  }

  warp(p: Point): void {
    if (is11(this)) {                                 // WMP 11 0x131641e6: as WMP 12
      var dx1 = this.cx - p.x, dy1 = this.cy - p.y, th1 = atan2_32(dy1, dx1), r1 = sqrt(dy1 * dy1 + dx1 * dx1);
      fromPolar11(this, p, this.dbl0 + th1, r1 - this._wd2 * (r1 / this._diag));
      return;
    }
    if (isX87(this)) {                                // 0x077a2277
      var dx8 = this.cx - p.x, dy8 = this.cy - p.y, th8 = atan87(dy8, dx8), r8 = sqrt(dy8 * dy8 + dx8 * dx8);
      fromPolar87(this, p, th8 + this.dbl0, r8 - this._wd2 * (r8 / this._diag));
      return;
    }
    var dx = this.cx - p.x, dy = this.cy - p.y;
    var r = sqrt(dy * dy + dx * dx);
    var r2 = r - this._wd2 * (r / this._diag);
    var th = atan2(dy, dx) + this.dbl0;
    sincos(th, SC);
    p.x = (this.w - trunc(SC[1] * r2)) - this.cx;
    p.y = this.hmcy - trunc(SC[0] * r2);
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
    if (is11(this)) {
      this.dbl0 = u11(f0_1) - f0_05; this.dbl1 = u11(0.1) - f0_05; this.dbl2 = A.rand() % 3; this.dbl3 = u11(0.3);
      this.derive(); return this;
    }
    if (isX87(this)) {                                // 0x077c3e3e
      this.dbl0 = u87() * f0_1 - f0_05; this.dbl1 = u87() * 0.1 - f0_05; this.dbl2 = A.rand() % 3; this.dbl3 = u87() * 0.3;
      this.derive(); return this;
    }
    this.dbl0 = fround(fround(u() * f0_1) - f0_05);   // [-0.05, 0.05]
    this.dbl1 = fround(fround(u() * 0.1) - f0_05);    // [-0.05, 0.05]; double mul, float sub
    this.dbl2 = A.rand() % 3;                         // axis mode
    this.dbl3 = fround(u() * 0.3);                    // [0, 0.3] pinch depth
    this.derive();
    return this;
  }

  // 0x077c3fc0: g = trig_x87(th0)*(1/1.57); b = r - ((W*dbl2)*(r/diag))*g; a = r - ((A*q)*q)*q;
  // r2 = ((b+b)+a)*(1/3); th = ((q*dbl1 + th0) + 2(th0+dbl1))*(1/3)
  warp87(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y, th0 = atan87(dy, dx), r = sqrt(dy * dy + dx * dx);
    var g = trig87(this._mode, p.x, th0), thA = th0 + this.dbl0;
    var b = r - (this._wd2 * (r / this._diag)) * g;
    var q = r / this.halfW, A0 = this._A, a = r - ((A0 * q) * q) * q;
    fromPolar87(this, p, ((q * this.dbl0 + th0) + (thA + thA)) * THIRD, ((b + b) + a) * THIRD);
  }

  // WMP 11 0x1316530c: a = r - A*((q*q)*q), r2 = (a + 2b)/3, th = ((q*dbl1 + th0) + 2(dbl1 + th0))/3
  warp11(p: Point): void {
    var dx = this.cx - p.x, dy = this.cy - p.y, th0 = atan2_32(dy, dx), r = sqrt(dy * dy + dx * dx);
    var g = trig11(this._mode, p.x, th0), thA = this.dbl0 + th0;
    var b = r - (this._wd2 * (r / this._diag)) * g;
    var q = r / this.halfW, a = r - this._A * ((q * q) * q);
    fromPolar11(this, p, ((q * this.dbl0 + th0) + 2 * thA) / 3, (a + 2 * b) / 3);
  }

  warp(p: Point): void {
    if (isX87(this)) { this.warp87(p); return; }
    if (is11(this)) { this.warp11(p); return; }
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
    sincos(th, SC);
    p.x = (this.w - trunc(SC[1] * r2)) - this.cx;
    p.y = (this.h - trunc(SC[0] * r2)) - this.cy;
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
    this.dbl0 = is11(this) ? u11(f0_1) : isX87(this) ? u87() * f0_1 : fround(u() * f0_1);   // [0, 0.1] — always a magnification (x86 0x07798982)
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
