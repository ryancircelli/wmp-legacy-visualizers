// Alchemy.BatteryDraws — Battery's drawing effects, group B.  Port of spec/battery/14-battery-draw-b.md
// (wmp.dll x64, image base 0x180000000).  Classes here, in registry order:
//   0 CEdgeTrace  1 CEdgeGradiant  2 CCosEdgeGradiant  3 CWaveEdge  4 CSpectrumEdge
//   5 CCircleWaveform  (6 CDotPlane, 7 CJDar — src/73-battery-draws-a.js)  8 CGalaxy  9 CJiggyScribble
// This file only *extends* Alchemy.BatteryDraws, so 73-battery-draws-a.js can add its two classes to
// the same object in either order.  Shared primitives live on Alchemy.BatteryDraws.prim.
// The classes call those primitives late-bound through `prim.X(...)` (one property load per line or
// per border, never per pixel), so 73's classes share one implementation and the tests can spy on
// prim.LineClamped/prim.Stroke to read exact endpoints.
//
// ---- ctx -------------------------------------------------------------------------------------
// draw(ctx), ctx = { buf: Uint8Array(w*h), w, h, level: TimedLevel, frame, pre, audio }.
// Optional ctx.sw/ctx.sh override the *surface* w/h (== pitch) where the DLL reads front->w/h
// instead of E->w/E->h (spec §1.1: the classes are inconsistent and a port must copy that; with a
// single size they always agree, so sw/sh default to w/h).  Reads front->w/h: CJiggyScribble
// (centre), CGalaxy (radius scale + Stroke extent), CWaveEdge (pitch only), every Line() pitch.
//
// ---- ctx.audio -------------------------------------------------------------------------------
// NONE.  Battery does no engine-side audio reduction (FUNCTION-MAP §3.16): every Draw in this group
// reads raw TimedLevel bytes itself, so nothing here needs ctx.audio.<name>.  What is read, per class:
//   CCircleWaveform  level.freq[0][0]; level.wave[0][i], level.wave[1][i], i < n
//   CJiggyScribble   freq[0][0,2,4] + freq[1][1,3,5]            (6-tap bass sum / 1530)
//   CGalaxy          freq[0][k,k+2,k+4] + freq[1][k+1,k+3,k+5]  (sliding 6-tap, per star),
//                    wave[0][k] (brightness), wave[1][k] (inner radius)
//   CSpectrumEdge    freq[0][i] + freq[1][i+1], i even, i < dbl1 (its own 15-frame boxcar ring)
//   CWaveEdge        all 1024 bytes of freq[0]/freq[1] or wave[0]/wave[1]
//   CEdgeGradiant, CCosEdgeGradiant, CEdgeTrace — no audio at all.
// (If the engine later wants to hand over a pre-summed bass, it cannot serve CGalaxy: that one
// slides the 6-tap window one bin per star.)
//
// ---- parameter numbering ---------------------------------------------------------------------
// CONTRACT names the eight params dbl0..dbl7; spec 14 names the same slots dbl1..dbl8 after their
// object offsets +0x08..+0x40.  **this.dbl0 === spec dbl1.**  setParams(arr) takes them in offset
// order, arr[0] -> dbl0, which is the order the preset parameter tables store them in.
//
// All writes are overwrite-only palette-index byte stores; no max/add/blend anywhere (spec §1.2).
// Wrapped verbatim from src/72-battery-draws.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from '../ns';
import '../rand';
import type { TimedLevel } from '../ns';
import { sincos87, mulExt, atan2_87 } from './x87';
import { atan2Ext32, f32Ext } from './msvcrt';

/** draw(ctx) argument: one frame's playfield buffer + audio. See the ctx/ctx.audio notes above. */
export interface BatteryDrawCtx {
  buf: Uint8Array;
  w: number;
  h: number;
  level: TimedLevel;
  frame?: number;
  pre?: boolean;
  audio?: unknown;
  sw?: number;
  sh?: number;
}

/** The engine-side (src/battery/index.ts) view of a draw effect instance. */
export interface BatteryDrawEffect {
  compatMask: number;
  dbl0: number; dbl1: number; dbl2: number; dbl3: number;
  dbl4: number; dbl5: number; dbl6: number; dbl7: number;
  className?: string;
  placeholder?: boolean;
  setSize(w: number, h: number): void;
  randomize(): void;
  setParams(a: number[]): void;
  draw(ctx: BatteryDrawCtx): void;
  /** the WMP build whose arithmetic to use (12 default; 8, 9, 10, 11 for the variant presets), set by the engine */
  build?: number;
  setBuild?(b: number): void;
}

/** A draw-effect constructor, as stored in the registry / on BatteryDrawsNS by class name. */
export type BatteryDrawCtor = new () => BatteryDrawEffect;

/** Shared raster primitives, late-bound so 73-battery-draws-a.js's classes and the test spies
 * (prim.LineClamped/prim.Stroke reassignment) all see the same implementation. */
export interface BatteryDrawPrim {
  cvt(v: number): number;
  surfW(ctx: BatteryDrawCtx): number;
  surfH(ctx: BatteryDrawCtx): number;
  Line(buf: Uint8Array, pitch: number, x0: number, y0: number, x1: number, y1: number, c: number): void;
  LineClamped(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: number): void;
  border(buf: Uint8Array, pitch: number, w: number, h: number, c: number): void;
  plot(buf: Uint8Array, w: number, h: number, X: number, Y: number, c: number): void;
  BatteryDraw: typeof BatteryDraw;
  Stroke(buf: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number,
         px: number, py: number, n: number, c0: number, c1: number, bLine: boolean, mode: number, build?: number): void;
}

/** Alchemy.BatteryDraws — this file's classes plus CDotPlane/CJDar, filled in by
 * 73-battery-draws-a.js in either load order (see the header note above). */
export interface BatteryDrawsNS {
  prim: BatteryDrawPrim;
  CEdgeTrace: typeof CEdgeTrace;
  CEdgeGradiant: typeof CEdgeGradiant;
  CCosEdgeGradiant: typeof CCosEdgeGradiant;
  CWaveEdge: typeof CWaveEdge;
  CSpectrumEdge: typeof CSpectrumEdge;
  CCircleWaveform: typeof CCircleWaveform;
  CGalaxy: typeof CGalaxy;
  CJiggyScribble: typeof CJiggyScribble;
  CDotPlane?: BatteryDrawCtor;
  CJDar?: BatteryDrawCtor;
  registry: string[];
  list(): (BatteryDrawCtor | null)[];
}

// A.BatteryDraws/D.prim are typed as always-present objects (AlchemyNS), so `X || {}` already
// has type X (the fallback branch is unreachable per the types) — no cast needed here.
var D = A.BatteryDraws = A.BatteryDraws || {};
var prim = D.prim = D.prim || {};

var F = Math.fround;
// CRT-exact atan2 from 00-rand.js — see the note in 70-battery-warps.js. Stroke's th0/th1
// (0x180413dc8) go straight into cos/sin (0x180413ed6/0x180413eec) and are truncated
// (0x180413ee4/0x180413f15); step k = 0 reproduces (x0,y0), which is an exact integer, so
// atan2's last bit decides whether the arc's first pixel lands on it.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.atan2 never reads `this`; hoisted once on purpose
var atan2 = A.atan2 || Math.atan2;
// ucrtbase's sin/cos (00-rand.js): they are 1 ulp off correctly rounded on ~3 % of arguments, and
// Stroke's first pixel and the warp diagonals sit exactly on those ulps.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sin/A.cos never read `this`; hoisted once, not per-call, on purpose
var sin = A.sin || Math.sin, cos = A.cos || Math.cos;
// sincosN(x, n, out): out[2i] = sin(x[i]), out[2i+1] = cos(x[i]), the same bits (00-rand.js), one
// reduction for each pair and one call for all n: Stroke's arc and CJiggyScribble's points. The
// scratch arrays grow to the longest.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sincosN never reads `this`; hoisted once on purpose
var sincosN = A.sincosN, ANG = new Float64Array(256), ASC = new Float64Array(512), RAD = new Float64Array(256);
function arcRoom(n: number): void {
  if (ANG.length >= n) return;
  var m = Math.ceil(n);
  ANG = new Float64Array(m); ASC = new Float64Array(2 * m); RAD = new Float64Array(m);
}
// Both 2pi constants in Battery are (double)(float)6.2831855f, not 2*Math.PI; pi likewise.
var TAU = 6.2831854820251465;      // 0x18088c468 (f64) == 0x18088c598 (f32) widened
var PI_ = 3.1415927410125732;      // 0x18088c4c8 (f32) / 0x18088c440 (f64)
var INV256 = 0.00390625;           // 0x18088c264 f32
var F32767 = 32767.0;              // 0x18088c668 f32
var F0_05 = 0.05000000074505806;   // 0x18088c278 f32
var F0_6 = 0.6000000238418579;     // 0x18088c2d4 f32
var F0_09 = 0.09000000357627869;   // 0x18088c280 f32
var F0_9 = 0.8999999761581421;     // 0x18088c310 f32
var F768 = 768.0;                  // 0x18088c658 f32
var F5_6 = 5.599999904632568;      // 0x18088c588 f32
var F0_4 = 0.4000000059604645;     // 0x18088c2ac f32
var F0_3 = 0.30000001192092896;    // 0x18088c2a4 f32
var F6E_7 = 6.000000212225132e-07; // 0x18088c250 f32
var PHASE_STEP = 0.04908738657832146; // 0x18088c274 f32 == (float)(pi/64)

// cvttsd2si: truncate toward zero; out of int32 range / NaN -> 0x80000000.
function cvt(v: number): number { return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648; }
prim.cvt = cvt;

// ---- the older builds (this.build 8, 9, 10: x87; 11: VC8 x87 with msvcrt trig) -----------------
// FUNCTION-MAP-X86.md §7.1: x87 at 53 bits, reciprocal multiplies, 64-bit FSIN/FCOS/FPATAN results that
// the next fmul rounds once (mulExt), float rounding only on float stores. WMP 11's _CIsin/_CIcos/_CIatan2
// run msvcrt's x87 path and also leave a 64-bit st(0) (./msvcrt: FSIN/FCOS as sincos87, its own atan2).
var INV32767F = 3.0518509447574615e-05;   // float(1/32767), every 8/9/10 Randomize (rule 5)
var INV1530 = 1 / 1530, INV255 = 1 / 255; // WMP 9 0x077b7bb0 / 0x077b7bb8 (doubles)
/** u = rand()/32767 as build b computes it before scaling: (double)r * float(1/32767), or r / 32767.0 on 11 */
function urand(b: number): number { var r = A.rand(); return b === 11 ? r / F32767 : r * INV32767F; }
/** round53(hi + lo + d): an fadd of a double to a 64-bit register */
function add53x(hi: number, lo: number, d: number): number {
  if (lo === 0) return hi + d;
  var s = hi + d, bb = s - hi;
  return s + (((hi - (s - bb)) + (d - bb)) + lo);
}
var SC = new Float64Array(4), AT = new Float64Array(2);
// FSIN/FCOS of a 64-bit argument xh + xl (Stroke's first step takes them of FPATAN's unrounded result):
// ../plenoptic/x87.ts's model (reduction by pi/2 to 66 bits, double-double Taylor, round to 64 bits) with the
// low part carried through the reduction. xl == 0 is exactly sincos87.
var PIO2_1 = 1.5707963267341256, PIO2_2 = 6.077100506303966e-11;
function twoSumX(a: number, b: number, o: Float64Array): void { var s = a + b, bb = s - a; o[0] = s; o[1] = (a - (s - bb)) + (b - bb); }
function twoProdX(a: number, b: number, o: Float64Array): void {
  var p = a * b, t = 134217729 * a, ah = t - (t - a), al = a - ah, u = 134217729 * b, bh = u - (u - b), bl = b - bh;
  o[0] = p; o[1] = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
var XR = new Float64Array(2), XT = new Float64Array(2), XU = new Float64Array(2), XBITS = new Float64Array(1), XW = new Uint32Array(XBITS.buffer);
function mulDDX(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  twoProdX(ah, bh, XU); twoSumX(XU[0], XU[1] + (ah * bl + al * bh), o);
}
function addDDX(ah: number, al: number, bh: number, bl: number, o: Float64Array): void {
  twoSumX(ah, bh, XU); twoSumX(XU[0], XU[1] + al + bl, o);
}
function round64X(hi: number, lo: number, o: Float64Array, k: number): void {
  if (hi === 0) { o[k] = 0; o[k + 1] = 0; return; }
  XBITS[0] = hi;
  var e = ((XW[1] >>> 20) & 0x7ff) - 1023;
  if (XW[0] === 0 && (XW[1] & 0xfffff) === 0 && (lo < 0) !== (hi < 0)) e--;
  var g = Math.pow(2, e - 63), q = lo / g, n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;
  o[k] = hi; o[k + 1] = n * g;
}
function sincos87x(xh: number, xl: number, out: Float64Array): void {
  if (xl === 0) { sincos87(xh, out); return; }
  var k = 0, rh = xh, rl = xl;
  if (Math.abs(xh) > 0.7853981633974483) {
    k = Math.round(xh * 0.6366197723675814);
    twoSumX(xh, -k * PIO2_1, XR); twoSumX(XR[0], -k * PIO2_2, XT);
    twoSumX(XT[0], XT[1] + XR[1] + xl, XR); rh = XR[0]; rl = XR[1];
  }
  mulDDX(rh, rl, rh, rl, XT);
  var r2h = XT[0], r2l = XT[1], th = rh, tl = rl, sh = rh, sl = rl, ch = 1, cl = 0, n, d;
  for (n = 1; n < 16; n++) {
    mulDDX(th, tl, r2h, r2l, XT); d = -(2 * n) * (2 * n + 1);
    th = XT[0] / d; tl = (A.fma(-th, d, XT[0]) + XT[1]) / d;
    addDDX(sh, sl, th, tl, XR); sh = XR[0]; sl = XR[1];
  }
  th = 1; tl = 0;
  for (n = 1; n < 16; n++) {
    mulDDX(th, tl, r2h, r2l, XT); d = -(2 * n - 1) * (2 * n);
    th = XT[0] / d; tl = (A.fma(-th, d, XT[0]) + XT[1]) / d;
    addDDX(ch, cl, th, tl, XR); ch = XR[0]; cl = XR[1];
  }
  var q = ((k % 4) + 4) % 4;
  if (q === 0) { round64X(sh, sl, out, 0); round64X(ch, cl, out, 2); }
  else if (q === 1) { round64X(ch, cl, out, 0); round64X(-sh, -sl, out, 2); }
  else if (q === 2) { round64X(-sh, -sl, out, 0); round64X(-ch, -cl, out, 2); }
  else { round64X(-ch, -cl, out, 0); round64X(sh, sl, out, 2); }
}

function surfW(ctx: BatteryDrawCtx): number { return ctx.sw === undefined ? ctx.w : ctx.sw; }
function surfH(ctx: BatteryDrawCtx): number { return ctx.sh === undefined ? ctx.h : ctx.sh; }
prim.surfW = surfW; prim.surfH = surfH;

// 0x180414050 — integer Bresenham, no clipping at all, pitch == surface width. Both loop bounds
// are <=, so the endpoint always lands and Line(x,y,x,y) writes exactly one pixel. Offsets may
// leave the buffer; a Uint8Array drops those stores, which is the closest faithful behaviour.
function Line(buf: Uint8Array, pitch: number, x0: number, y0: number, x1: number, y1: number, c: number): void {
  var p = pitch * y0 + x0;
  var dy = y1 - y0;
  var sy = dy >= 0 ? pitch : -pitch;
  var ay = dy >= 0 ? dy : -dy;
  var dx = x1 - x0;
  var ax = dx >= 0 ? dx : -dx;
  var sx = ((dx >> 31) & ~1) + 1;
  var err = 0, i;
  if (ay < ax) {
    for (i = 0; i <= ax; i++) { buf[p] = c; err += ay; p += sx; if (err > ax) { err -= ax; p += sy; } }
  } else {
    for (i = 0; i <= ay; i++) { buf[p] = c; err += ax; p += sy; if (err > ay) { err -= ay; p += sx; } }
  }
}
prim.Line = Line;

// 0x180413c20 — clamps ALL FOUR coordinates: x0/x1 against [rcx+0x8] (width) at 0x180413c33 and
// 0x180413c61, y0/y1 against [rcx+0xc] (height) at 0x180413c4c and 0x180413c78; y1 arrives in the
// callee's [rsp+0x28] and is written back clamped at 0x180413c8d, before the tail jmp to Line.
// FUNCTION-MAP-WMP.md §3.15 used to call the y1 clamp a missing one ("an original bug; reproduce
// it") — there is no such bug, and an unclamped y1 would let Line walk off the allocation.
// It is still a clamp, not a clip, so the drawn slope differs from the true segment whenever an
// endpoint is out of range (this is what flattens CCircleWaveform's rings against the frame).
// Out-of-range y1 only ever reaches here from CJDar: zero occurrences in 300 frames on every
// CCircleWaveform/CJiggyScribble preset, 2.7k-14k on the CJDar ones.
function LineClamped(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 = x0 < 0 ? 0 : (x0 >= w ? w - 1 : x0);
  y0 = y0 < 0 ? 0 : (y0 >= h ? h - 1 : y0);
  x1 = x1 < 0 ? 0 : (x1 >= w ? w - 1 : x1);
  y1 = y1 < 0 ? 0 : (y1 >= h ? h - 1 : y1);
  Line(buf, w, x0, y0, x1, y1, c);
}
prim.LineClamped = LineClamped;

// The four border lines every edge class draws, in the DLL's order (top L->R, right T->B,
// bottom R->L, left B->T) with the unclipped Line — always exactly on the border, so in range.
function border(buf: Uint8Array, pitch: number, w: number, h: number, c: number): void {
  Line(buf, pitch, 0, 0, w - 1, 0, c);
  Line(buf, pitch, w - 1, 0, w - 1, h - 1, c);
  Line(buf, pitch, w - 1, h - 1, 0, h - 1, c);
  Line(buf, pitch, 0, h - 1, 0, 0, c);
}
prim.border = border;

// Bounds-checked single pixel: the comparison happens in double, then the coords truncate.
function plot(buf: Uint8Array, w: number, h: number, X: number, Y: number, c: number): void {
  if (X >= 0.0 && Y >= 0.0 && X < w && Y < h) buf[cvt(Y) * w + cvt(X)] = c;
}
prim.plot = plot;

// Base of every draw effect (DLL base ctors 0x18040fcdc -> 0x18040f3a0): dbl0..dbl7 = 0,
// compat mask at +0xe0. Exported for 73-battery-draws-a.js.
class BatteryDraw implements BatteryDrawEffect {
  declare dbl0: number; declare dbl1: number; declare dbl2: number; declare dbl3: number;
  declare dbl4: number; declare dbl5: number; declare dbl6: number; declare dbl7: number;
  declare compatMask: number;
  declare w: number; declare h: number;
  declare build: number;
  constructor(mask: number) {
    this.build = 12;
    this.dbl0 = 0; this.dbl1 = 0; this.dbl2 = 0; this.dbl3 = 0;
    this.dbl4 = 0; this.dbl5 = 0; this.dbl6 = 0; this.dbl7 = 0;
    this.compatMask = mask;          // +0xe0: bit0 border/pre-only, bit1 body/pre-or-post
    this.w = 0; this.h = 0;
  }
  setSize(w: number, h: number): void { this.w = w; this.h = h; }
  randomize(): void {}                                    // vt+0x18, the only rand() entry point
  setParams(a: number[]): void {
    // dynamic dbl<i> field write — no literal-union way to type this without changing the loop.
    for (var i = 0; i < 8; i++) if (i < a.length) (this as unknown as Record<string, number>)['dbl' + i] = a[i];
  }
  draw(ctx: BatteryDrawCtx): void {}                      // vt+0x20
}
prim.BatteryDraw = BatteryDraw;

// ------------------------------------------------------------------ CEdgeGradiant (idx 1)
// ctor 0x18041110c, Draw 0x1804177e0. No Randomize (vt+0x18 is the bare ret at 0x180086140),
// no parameters, no audio. 0<->255 triangle on the border, period exactly 514 frames.
class CEdgeGradiant extends BatteryDraw {
  declare v: number;
  declare step: number;
  constructor() { super(1); this.v = 0; this.step = 1; }
  draw(ctx: BatteryDrawCtx): void {
    // UNSIGNED compare (cmp ecx,0xff / jbe at 0x1804177f6): at v == -1 the test sees 0xFFFFFFFF.
    if ((this.v >>> 0) > 255) this.step = -this.step;
    this.v = (this.v + this.step) | 0;
    prim.border(ctx.buf, surfW(ctx), ctx.w, ctx.h, this.v & 0xff);
  }
}

// ------------------------------------------------------------------ CCosEdgeGradiant (idx 2)
// ctor 0x180410fd0, Randomize 0x1804169b0, Draw 0x1804176f0. dbl0 = radians/frame.
class CCosEdgeGradiant extends BatteryDraw {
  declare phase: number;
  constructor() { super(1); this.phase = 0.0; }
  randomize(): void {
    var b = this.build;
    if (b === 12) this.dbl0 = F(F(A.rand() / F32767) * F0_09);   // 0 .. 0.09, all float32
    else if (b === 11) this.dbl0 = F(urand(b) * F0_09);            // a float local on WMP 11
    else this.dbl0 = urand(b) * F0_09;                             // WMP 9 0x07798de5: a double
  }
  draw(ctx: BatteryDrawCtx): void {
    this.phase += this.dbl0;
    if (this.phase > TAU) this.phase = 0.0;                      // hard reset, not a subtraction
    // signed cvttsd2si then a BYTE store: the index ramps backwards down from 255 while cos < 0.
    var c;
    if (this.build === 12) c = cos(this.phase) * 253.0 + 1.0;
    else { sincos87(this.phase, SC); c = mulExt(253.0, SC[2], SC[3]) + 1.0; }   // WMP 9 0x07799717: fcos; fmul 253 (11 _CIcos)
    prim.border(ctx.buf, surfW(ctx), ctx.w, ctx.h, cvt(c) & 0xff);
  }
}

// ------------------------------------------------------------------ CWaveEdge (idx 3)
// ctor 0x180411778, Randomize 0x180417290, Draw 0x180418a30. dbl0: 0 waveform, else spectrum.
class CWaveEdge extends BatteryDraw {
  constructor() { super(1); }
  randomize(): void { this.dbl0 = A.rand() % 2; }
  draw(ctx: BatteryDrawCtx): void {
    var L = ctx.level, spec = this.dbl0 !== 0.0;
    var ch0 = spec ? L.freq[0] : L.wave[0];
    var ch1 = spec ? L.freq[1] : L.wave[1];
    var b = ctx.buf, pitch = surfW(ctx);
    var xmax = ctx.w - 1, ymax = ctx.h - 1, x: number, y: number;
    for (x = 0; x < xmax; x++) {                 // x < w-1: the last column is skipped
      b[x] = ch0[x % 1024];                      // signed % in the original
      b[ymax * pitch + x] = ch1[x % 1024];
    }
    for (y = 0; y < ymax; y++) {                 // y < h-1: the last row is skipped
      b[y * pitch] = ch0[y & 1023];              // mask in the original
      b[y * pitch + xmax] = ch1[y & 1023];
    }
    // Consequence, reproduced: (0,0) is written twice, (w-1,0) and (0,h-1) once each, and
    // (w-1,h-1) is never written by this class.
  }
}

// ------------------------------------------------------------------ CSpectrumEdge (idx 4)
// ctor 0x1804114e0, Randomize 0x1804171c0, Draw 0x180418860. The only history buffer in Battery.
// dbl0 style, dbl1 byte span, dbl2 history frames.
class CSpectrumEdge extends BatteryDraw {
  declare hist: Int32Array;
  declare idx: number;
  constructor() { super(1); this.hist = new Int32Array(15); this.idx = 0; }
  randomize(): void {
    this.dbl0 = A.rand() % 10;                  // 0 .. 9
    this.dbl1 = (A.rand() % 10) * 2 + 2;        // 2 .. 20
    this.dbl2 = A.rand() % 11 + 4;              // 4 .. 14
  }
  draw(ctx: BatteryDrawCtx): void {
    // All four guards must hold or Draw does nothing. dbl2 == 0 is what makes CSpectrumEdge
    // inert in `event horizon` (159, 59, 0) and `the world` (214, 106, 0).
    if (!(this.dbl1 !== 0.0)) return;
    if (!(this.dbl2 > 0.0)) return;
    if (!(Math.trunc(this.dbl2) < 16)) return;
    if (!(Math.trunc(this.dbl1) < 1023)) return;

    var len = Math.trunc(this.dbl2);
    var h = this.hist;
    this.idx = (this.idx + 1) % len;
    h[this.idx] = 0;

    var f0 = ctx.level.freq[0], f1 = ctx.level.freq[1], i = 0;
    // do-while: always at least one bin; x86 (WMP 9 0x077c3d02) is a while loop, none when dbl1 <= 0
    if (this.build === 12 || 0 < this.dbl1) do {
      h[this.idx] = h[this.idx] + f0[i] + f1[i + 1];
      i += 2;
    } while (i < this.dbl1);

    var sum = 0, k = 0;
    // k is an 8-bit counter in the original. A fractional dbl2 in (15,16) passes the guard and
    // reads hist[15], which in the DLL is the `idx` field at +0x124; `| 0` keeps that 0 here.
    while (k < this.dbl2) { sum += h[k] | 0; k = (k + 1) & 0xff; }
    var v = cvt(sum / (this.dbl2 * this.dbl1)) & 0xff;   // divisor is historyFrames x byteSpan

    if (this.dbl0 === 0.0) v = ~v & 0xff;                        // invert
    else if (this.dbl0 > 5.0) {                                  // 0.9f on the already-byte value
      v = (this.build === 12 ? cvt(F(F(v) * F0_9)) : cvt(v * F0_9)) & 0xff;   // x86: the product in a register
    }
    /* 1 .. 5 inclusive: a third style, pass-through */

    prim.border(ctx.buf, surfW(ctx), ctx.w, ctx.h, v);
  }
}

// ------------------------------------------------------------------ CEdgeTrace (idx 0)
// ctor 0x1804111b4, Randomize 0x180416a00, Draw 0x1804178d0. No audio. One position marches
// clockwise round all four edges, carried across the corners; 4 px/frame.
class CEdgeTrace extends BatteryDraw {
  declare phase: number;
  constructor() { super(1); this.dbl0 = 50.0; this.phase = 0; }
  randomize(): void { this.dbl0 = A.rand() % 30 + 35; }        // 35 .. 64
  draw(ctx: BatteryDrawCtx): void {
    var step = Math.trunc(this.dbl0);
    if (step === 0) return;      // 0x1804178f2 divides by zero; unreachable from ctor/Randomize,
                                 // but SetParams does not validate (open item 8) — guard instead.
    var b = ctx.buf, pitch = surfW(ctx);
    var t = (this.phase + 1) % step + 3;
    if (t < 4) t = 3;                          // safety net for a negative %
    this.phase = t;                            // stored back *including* the +3 => +4 px/frame
    var w = ctx.w, h = ctx.h, a: number;

    for (; t < w - 4; t += step) {             // top, left -> right
      b[t - 3] = 0xf5; b[t - 2] = 0xff;
      b[t - 1] = 0xff; b[t] = 0xf5;
      b[pitch + t - 2] = 0xf5; b[pitch + t - 1] = 0xf5;
    }
    t -= w; if (t < 3) t += step;

    for (; t < h - 4; t += step) {             // right, top -> bottom
      b[(t - 3) * pitch + w - 1] = 0xf5; b[(t - 2) * pitch + w - 1] = 0xff;
      b[(t - 1) * pitch + w - 1] = 0xff; b[t * pitch + w - 1] = 0xf5;
      b[(t - 2) * pitch + w - 2] = 0xf5; b[(t - 1) * pitch + w - 2] = 0xf5;
    }
    t -= h; if (t < 3) t += step;

    for (; t < w - 4; t += step) {             // bottom, right -> left
      a = w - t;
      b[(h - 1) * pitch + a - 3] = 0xf5; b[(h - 1) * pitch + a - 2] = 0xff;
      b[(h - 1) * pitch + a - 1] = 0xff; b[(h - 1) * pitch + a] = 0xf5;
      b[(h - 2) * pitch + a - 2] = 0xf5; b[(h - 2) * pitch + a - 1] = 0xf5;
    }
    t -= w; if (t < 3) t += step;

    for (; t < h - 4; t += step) {             // left, bottom -> top
      a = h - t;
      b[(a - 3) * pitch] = 0xf5; b[(a - 2) * pitch] = 0xff;
      b[(a - 1) * pitch] = 0xff; b[a * pitch] = 0xf5;
      b[(a - 2) * pitch + 1] = 0xf5; b[(a - 1) * pitch + 1] = 0xf5;
    }
  }
}

// ------------------------------------------------------------------ CCircleWaveform (idx 5)
// ctor 0x180410f14, Randomize 0x1804168c0, Draw 0x1804172d0. 1-3 polar waveform rings: wave[0]
// sweeps [0,pi] below the centre line, wave[1] the same angles mirrored above it, so the two
// polylines close one circle. dbl0 colour style 0..3, dbl1 ring count, dbl2 sample fraction.
class CCircleWaveform extends BatteryDraw {
  declare baseRadius: number;
  declare phase: number;
  declare _n: number;
  declare _b: number;
  declare _cs: Float64Array;
  constructor() { super(2); this.dbl1 = 1.0; this.baseRadius = 20; this.phase = 0.0; this._n = -1; this._b = 12; this._cs = new Float64Array(0); }
  randomize(): void {
    var r1 = A.rand(), r2 = A.rand(), r3 = A.rand();          // order matters for replay
    this.dbl0 = r3 % 4;                                       // from the THIRD draw
    this.dbl1 = 2 - (r1 % 5 !== 0 ? 1 : 0) + (r2 % 5 === 0 ? 1 : 0);   // 1..3, p 16/25, 8/25, 1/25
    if (this.build === 12) this.dbl2 = F(F(F(A.rand() / F32767) * F0_6) + F0_05);    // 0.05 .. 0.65
    else this.dbl2 = urand(this.build) * F0_6 + F0_05;        // x86: a double, never float-rounded
  }
  draw(ctx: BatteryDrawCtx): void {
    var L = ctx.level, buf = ctx.buf, sw = surfW(ctx), sh = surfH(ctx), b = this.build, x87 = b !== 12 && b !== 11;
    var H0 = ctx.h;                                           // read ONCE, before the ring loop
    var amp = cvt(F(F(F(L.freq[0][0]) * INV256) * F(H0 >> 1)));   // freq0[0] only: the DC bin
    var w0 = L.wave[0], w1 = L.wave[1];
    var nRings = Math.trunc(this.dbl1);
    var c1 = 0, c2 = 0;      // dbl0 outside 0..3 keeps the previous colours (uninitialised in the
                             // DLL on the first sample); 0 stands in for that garbage.
    var p1x = 0, p1y = 0, p2x = 0, p2y = 0;   // not reset between rings; the i!=0 guard hides it
    for (var ring = 0; ring < nRings; ring++) {
      var cx = ctx.w >> 1, cy = ctx.h >> 1;                   // re-read every ring
      if (Math.trunc(this.dbl1) > 1) {                        // ring of centres, spins pi/64/frame
        var rad = F(ctx.w >> 3);
        if (b === 12) {
          var aF = F(F(F(TAU / F(this.dbl1)) * F(ring)) + this.phase);   // float32 throughout
          cx += cvt(cos(aF) * rad);
          cy += cvt(sin(aF) * rad);
        } else if (b === 11) {                                // one F32 of the 53-bit angle, float cos/sin
          sincos87(F((TAU / F(this.dbl1)) * ring + this.phase), SC);
          cx += cvt(f32Ext(SC[2], SC[3]) * rad);
          cy += cvt(f32Ext(SC[0], SC[1]) * rad);
        } else {                                              // WMP 9 0x077b1482: 53 bits, fcos * rad once
          sincos87((TAU / this.dbl1) * ring + this.phase, SC);
          cx += cvt(mulExt(rad, SC[2], SC[3]));
          cy += cvt(mulExt(rad, SC[0], SC[1]));
        }
      }
      var n;
      if (this.dbl2 > 1.0) { this.dbl2 = 1.0; n = 1024; }     // writes the parameter back
      else { n = cvt(this.dbl2 * 1024.0); if (n <= 0) continue; }
      // cos(a)/sin(a) depend on i and n alone: made once per n, the same calls on the same arguments.
      if (n !== this._n || b !== this._b) {
        var cs = this._cs = new Float64Array((x87 ? 6 : 2) * n);
        for (var j = 0; j < n; j++) {
          if (b === 12) { var aj = F(F(j / n) * PI_); cs[2 * j] = cos(aj); cs[2 * j + 1] = sin(aj); }
          else if (b === 11) { sincos87(F(PI_ * (j / n)), SC); cs[2 * j] = f32Ext(SC[2], SC[3]); cs[2 * j + 1] = f32Ext(SC[0], SC[1]); }
          else {
            // the angle (j / F32(n)) * pi_f stays a 53-bit register value. Per point: [x1 mult hi, lo, y1 mult
            // hi, lo, x2 mult, y2 mult] (lo = 0 where the build multiplies a stored copy). WMP 8 0x591cf6fc stores
            // cos and sin as doubles for all four; WMP 9 0x07799b9e keeps the 64-bit fcos for x1 only; WMP 10
            // 0x0759d670 keeps both 64-bit values for the first point and float copies for the mirrored one.
            sincos87((j / n) * PI_, SC);
            var cD = SC[2] + SC[3], sD = SC[0] + SC[1], o = 6 * j;
            if (b === 8) { cs[o] = cD; cs[o + 2] = sD; cs[o + 4] = cD; cs[o + 5] = sD; }
            else if (b === 9) { cs[o] = SC[2]; cs[o + 1] = SC[3]; cs[o + 2] = sD; cs[o + 4] = cD; cs[o + 5] = sD; }
            else { cs[o] = SC[2]; cs[o + 1] = SC[3]; cs[o + 2] = SC[0]; cs[o + 3] = SC[1]; cs[o + 4] = F(cD); cs[o + 5] = F(sD); }
          }
        }
        this._n = n; this._b = b;
      }
      var csT = this._cs;

      for (var i = 0; i < n; i++) {
        var ca = csT[2 * i], sa = csT[2 * i + 1];            // a = F(F(i / n) * PI_): HALF a turn over the run
        switch (Math.trunc(this.dbl0)) {
          case 0:
            c1 = (2 * Math.abs(w0[i] - 128)) & 0xff;          // 256 -> 0 when the sample is 0
            c2 = (2 * Math.abs(w1[i] - 128)) & 0xff;
            break;
          case 1: c1 = w0[i]; c2 = w1[i]; break;
          case 2: c1 = 0xff; c2 = 0xff; break;
          case 3: {
            // triangle over 0 .. 767; x86 multiplies in a register: 8/9/10 the float copy of i/n, 11 the quotient
            var tri = b === 12 ? cvt(F(F(i / n) * F768)) : cvt((b === 11 ? i / n : F(i / n)) * F768);
            var v = tri & 0xff;
            if ((tri >> 8) & 1) v = ~v & 0xff;
            c1 = v; c2 = v; break;
          }
          default: break;
        }
        // r1, r2: amp * w/256 + 20 is exact in float, so the x86 builds' unrounded value is the same
        var r1 = F(F(F(amp) * F(F(w0[i]) * INV256)) + F(this.baseRadius));
        var r2 = F(F(F(amp) * F(F(w1[i]) * INV256)) + F(this.baseRadius));
        var x1, y1, x2, y2;
        if (x87) {
          var o6 = 6 * i;
          x1 = cvt(mulExt(r1, csT[o6], csT[o6 + 1])) + cx;
          y1 = cvt(mulExt(r1, csT[o6 + 2], csT[o6 + 3])) + cy;
          x2 = cvt(csT[o6 + 4] * r2) + cx;
          y2 = cy - cvt(csT[o6 + 5] * r2);
        } else {
          x1 = cvt(ca * r1) + cx;
          y1 = cvt(sa * r1) + cy;
          x2 = cvt(ca * r2) + cx;
          y2 = cy - cvt(sa * r2);                        // SUBTRACTION: mirrored in Y
        }
        if (i !== 0) prim.LineClamped(buf, sw, sh, p1x, p1y, x1, y1, c1);
        if (i !== 0) prim.LineClamped(buf, sw, sh, p2x, p2y, x2, y2, c2);

        p1x = x1; p1y = y1; p2x = x2; p2y = y2;
      }
    }
    this.phase = F(this.phase + PHASE_STEP);   // float32 accumulator, advances even when idle
  }
}

// ------------------------------------------------------------------ CJiggyScribble (idx 9)
// ctor 0x180411264, Randomize 0x180417010, Draw 0x180418470. An epitrochoid in index 0xFF whose
// X and Y are accidentally transposed: atan2 is called as atan2(ax, ay) (xmm0 = the cosine-built
// component), so the sqrt/atan2/cos/sin round-trip is the identity with X and Y swapped and, with
// phase == 0 (every shipped preset), the whole thing reduces to plot(cx + ay, cy + ax).
// dbl0 inner radius, dbl1 outer radius at full bass, dbl2 point count, dbl3 harmonic,
// dbl4 phase increment, dbl5 never read, dbl6 == 9 selects line mode.
class CJiggyScribble extends BatteryDraw {
  declare phase: number;
  declare _d2: number;
  declare _d3: number;
  declare _tt: Float64Array;
  declare _tx: Float64Array;
  declare _x2: number;
  declare _x3: number;
  constructor() {
    super(2); this.phase = 0.0; this._d2 = NaN; this._d3 = NaN; this._tt = new Float64Array(0);
    this._x2 = NaN; this._x3 = NaN; this._tx = new Float64Array(0);
  }
  randomize(): void {
    this.dbl0 = A.rand() % 100 + 4;        // 4 .. 103
    this.dbl1 = A.rand() % 200 + 40;       // 40 .. 239
    this.dbl2 = A.rand() % 1000 + 300;     // 300 .. 1299
    this.dbl3 = A.rand() % 20 + 1;         // 1 .. 20
    if (this.build === 12) this.dbl4 = F(F(F(A.rand() / F32767) * F0_6) + F0_05);   // 0.05 .. 0.65
    else this.dbl4 = urand(this.build) * F0_6 + F0_05;      // x86: a double
    this.dbl5 = A.rand() % 10;             // never read by Draw
    this.dbl6 = A.rand() % 10;             // line mode only on 9, p = 1/10
  }
  draw(ctx: BatteryDrawCtx): void {
    if (this.build !== 12) { this.drawX87(ctx); return; }
    var lineMode = this.dbl6 === 9.0;
    var stepA = this.dbl2 === 0.0 ? 0.0 : TAU / this.dbl2;
    var f0 = ctx.level.freq[0], f1 = ctx.level.freq[1];
    var Esum = f0[0] + f0[2] + f0[4] + f1[1] + f1[3] + f1[5];         // 6-tap bass
    var radMod = (Esum / 1530.0) * (this.dbl1 - this.dbl0);           // 1530 = 6 x 255

    this.phase += this.dbl4;
    if (this.phase > TAU) this.phase -= TAU;                          // subtract, not reset
    var ph = this.phase;

    var buf = ctx.buf, sw = surfW(ctx), sh = surfH(ctx);
    var cx = sw >> 1, cy = sh >> 1;                                   // the SURFACE, not E->w/h
    var px = 0.0, py = 0.0, ax, ay, r, th;

    if (lineMode) {                        // seeded with P(t = 0), the same expression the first
      ax = radMod + this.dbl0;             // iteration evaluates, so i = 0 draws a 1-pixel segment
      ay = 0.0;
      r = Math.sqrt(ax * ax + ay * ay);
      th = atan2(ax, ay) + ph;
      px = cos(th) * r + cx;
      py = sin(th) * r + cy;
    }

    var n = Math.trunc(this.dbl2), tt = this._tt;
    // t = 0, stepA, 2*stepA... (accumulated): cos/sin of t and of t*dbl3 depend on dbl2 and dbl3
    // alone, so they are made once per pair of values, the same calls on the same arguments.
    if (this.dbl2 !== this._d2 || this.dbl3 !== this._d3) {
      tt = this._tt = new Float64Array(4 * (n > 0 ? n : 0));
      for (var j = 0, t = 0.0; j < n; j++) {
        tt[4 * j] = cos(t); tt[4 * j + 1] = sin(t);
        tt[4 * j + 2] = cos(t * this.dbl3); tt[4 * j + 3] = sin(t * this.dbl3);
        t += stepA;
      }
      this._d2 = this.dbl2; this._d3 = this.dbl3;
    }
    // every point's radius and angle first, then their sin and cos in one call
    arcRoom(n);
    for (var i = 0; i < n; i++) {
      ax = radMod * tt[4 * i] + this.dbl0 * tt[4 * i + 2];
      ay = radMod * tt[4 * i + 1] + this.dbl0 * tt[4 * i + 3];
      RAD[i] = Math.sqrt(ax * ax + ay * ay);
      ANG[i] = atan2(ax, ay) + ph;         // ARGUMENTS SWAPPED — not a typo, keep them
    }
    sincosN(ANG, n, ASC);
    for (i = 0; i < n; i++) {
      var X = ASC[2 * i + 1] * RAD[i] + cx;
      var Y = ASC[2 * i] * RAD[i] + cy;
      if (lineMode) {
        prim.LineClamped(buf, sw, sh, cvt(px), cvt(py), cvt(X), cvt(Y), 0xff);
        px = X; py = Y;
      } else {
        prim.plot(buf, sw, sh, X, Y, 0xff);   // compares in double, then truncates
      }
    }
  }
  // WMP 9 0x077a2970 (8 and 10 the same float sequence): radMod by the reciprocal 1/1530, every fcos/fsin
  // and fpatan a 64-bit result that one fmul / fadd rounds, the angle fpatan + phase rounded once. WMP 11
  // (0x131666be) is the same sequence through _CIcos/_CIsin/_CIatan2, with Esum / 1530.0.
  drawX87(ctx: BatteryDrawCtx): void {
    var lineMode = this.dbl6 === 9.0;
    var stepA = this.dbl2 === 0.0 ? 0.0 : TAU / this.dbl2;
    var f0 = ctx.level.freq[0], f1 = ctx.level.freq[1];
    var Esum = f0[0] + f0[2] + f0[4] + f1[1] + f1[3] + f1[5], atan = this.build === 11 ? atan2Ext32 : atan2_87;
    var radMod = (this.build === 11 ? Esum / 1530.0 : Esum * INV1530) * (this.dbl1 - this.dbl0);
    this.phase += this.dbl4;
    if (this.phase > TAU) this.phase -= TAU;
    var ph = this.phase, d0 = this.dbl0;
    var buf = ctx.buf, sw = surfW(ctx), sh = surfH(ctx);
    var cx = sw >> 1, cy = sh >> 1;
    var px = 0.0, py = 0.0, ax, ay, r, X, Y;
    if (lineMode) {                        // t = 0: cos 0 = 1, sin 0 = 0 exactly
      ax = d0 + radMod; ay = 0.0;
      r = Math.sqrt(ay * ay + ax * ax);
      atan(ax, ay, AT); sincos87(add53x(AT[0], AT[1], ph), SC);
      px = mulExt(r, SC[2], SC[3]) + cx;
      py = mulExt(r, SC[0], SC[1]) + cy;
    }
    var n = Math.trunc(this.dbl2), tx = this._tx;
    // the 64-bit cos/sin of t and of u = t * dbl3 (t accumulated): per (dbl2, dbl3), [ct, st, cu, su] as hi/lo
    if (this.dbl2 !== this._x2 || this.dbl3 !== this._x3) {
      tx = this._tx = new Float64Array(8 * (n > 0 ? n : 0));
      for (var j = 0, t = 0.0; j < n; j++) {
        sincos87(t, SC); tx[8 * j] = SC[2]; tx[8 * j + 1] = SC[3]; tx[8 * j + 2] = SC[0]; tx[8 * j + 3] = SC[1];
        sincos87(t * this.dbl3, SC); tx[8 * j + 4] = SC[2]; tx[8 * j + 5] = SC[3]; tx[8 * j + 6] = SC[0]; tx[8 * j + 7] = SC[1];
        t += stepA;
      }
      this._x2 = this.dbl2; this._x3 = this.dbl3;
    }
    for (var i = 0, o = 0; i < n; i++, o += 8) {
      ax = mulExt(d0, tx[o + 4], tx[o + 5]) + mulExt(radMod, tx[o], tx[o + 1]);
      ay = mulExt(d0, tx[o + 6], tx[o + 7]) + mulExt(radMod, tx[o + 2], tx[o + 3]);
      r = Math.sqrt(ay * ay + ax * ax);
      atan(ax, ay, AT);                    // ARGUMENTS SWAPPED, as in draw()
      sincos87(add53x(AT[0], AT[1], ph), SC);
      X = mulExt(r, SC[2], SC[3]) + cx;
      Y = mulExt(r, SC[0], SC[1]) + cy;
      if (lineMode) {
        prim.LineClamped(buf, sw, sh, cvt(px), cvt(py), cvt(X), cvt(Y), 0xff);
        px = X; py = Y;
      } else {
        prim.plot(buf, sw, sh, X, Y, 0xff);
      }
    }
  }
}

// Stroke's colour, c0 + dCol + dCol + ... in doubles. Kept in a local, V8 left it boxed (the loop
// starts it from an integer argument) and every += allocated: 6200 heap numbers a frame on CJDar.
var CL = new Float64Array(1);

// ------------------------------------------------------------------ Stroke (0x180413ca0)
// The shared eased-arc primitive: CGalaxy here (mode 0), CJDar in 73-battery-draws-a.js (mode 3).
// Read instruction-by-instruction from 0x180413ca0..0x18041403e; see spec/battery/15.
//   r0/r1  = |start-pivot| / |end-pivot|,  th0/th1 = atan2 of the same two, normalised to [0,2pi)
//   dth    = th1 - th0, then wrapped by `mode` (below)
//   step k = 0..n-1:  ang = th0 + k*dAng (ACCUMULATED), env = k*half (accumulated),
//                     rr = sin(env)*(r1-r0) + r0,  colour = c0 + k*dCol (accumulated)
// `half` is computed in float32 as pi/(2n), so env sweeps [0, pi/2) and the radius eases from r0
// towards — but never reaching — r1. Line mode starts from (x0,y0).
// `build` (default 12): the caller's this.build; 8, 9, 10 and 11 take strokeX87.
function Stroke(buf: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number,
                 px: number, py: number, n: number, c0: number, c1: number, bLine: boolean, mode: number, build?: number): void {
  if (n === 0) return;                              // test ebp,ebp / je 0x180414031
  if (build !== undefined && build !== 12) { strokeX87(buf, W, H, x0, y0, x1, y1, px, py, n, c0, c1, bLine, mode, build); return; }
  var a = x0 - px, b = y0 - py, a2 = x1 - px, b2 = y1 - py;
  var col = c0, dCol = (c1 - c0) / n;               // both bytes; (int)(c1-c0) is signed
  var r0 = Math.sqrt(a * a + b * b);
  var r1 = Math.sqrt(a2 * a2 + b2 * b2);
  var th0 = a !== 0 ? atan2(b, a) : 0.0;            // atan2(y, x) — xmm0 = b, xmm1 = a
  var th1 = a2 !== 0 ? atan2(b2, a2) : 0.0;
  if (th0 < 0.0) th0 += TAU;                        // comisd 0.0, th0 / jbe: 0 > th0 => += 2pi
  if (th1 < 0.0) th1 += TAU;
  var dth = th1 - th0;
  // 0x180413e1a..0x180413e5f — a jump ladder on the byte `mode`, NOT a short-way-round test:
  //   1      always wrap        2      never wrap
  //   4      wrap when dth <  pi
  //   0, 3, and everything else: wrap when dth >= pi   (so CGalaxy's 0 and CJDar's 3 agree)
  // The wrap is written `-(2pi - dth)`, which is dth - 2pi up to the last bit.
  var wrap: boolean;
  if (mode === 1) wrap = true;
  else if (mode === 2) wrap = false;
  else if (mode === 4) wrap = dth < PI_;
  else wrap = dth >= PI_;                           // pi here is the f64 at 0x18088c440
  if (wrap) dth = -(TAU - dth);
  var dAng = dth / n;
  var half = F(PI_ / F(2.0 * F(n)));                // float32: pi_f / (2n)
  if (n < 1) return;                                // cmp ebp,1 / jl — signed, after the setup
  var ang = th0, env = 0.0, prevX = x0, prevY = y0, k;
  CL[0] = col;                                      // the colour accumulates in CL: see below
  var envSin = (n | 0) === n && n <= 1024 ? strokeEnvelope(n, half) : null;
  // The angles first (the same accumulation, ang += dAng), then their sin and cos in one call.
  arcRoom(n);
  for (k = 0; k < n; k++) { ANG[k] = ang; ang += dAng; }
  sincosN(ANG, n, ASC);
  for (k = 0; k < n; k++) {
    var rr = (envSin ? envSin[k] : sin(env)) * (r1 - r0) + r0;
    var X = cvt(ASC[2 * k + 1] * rr + px);
    var Y = cvt(ASC[2 * k] * rr + py);
    var c = cvt(CL[0]) & 0xff;
    if (bLine) { prim.LineClamped(buf, W, H, prevX, prevY, X, Y, c); prevX = X; prevY = Y; }
    else if (X >= 0 && X < W && Y >= 0 && Y < H) buf[Y * W + X] = c;
    env += half; CL[0] += dCol;
  }
}
prim.Stroke = Stroke;

// Stroke on WMP 8/9/10, WMP 9 0x077a2717 instruction by instruction (10 identical, 8 below): r0, r1 = fsqrt
// of the integer sums; th0/th1 = FPATAN, 64-bit, += 2pi (one rounding) when negative; dth = th1 - th0 rounded
// once; the same wrap ladder; dAng = dth/n and half = pi_f/(n+n) as doubles; the step's angle, envelope and
// colour accumulate in registers at 53 bits, starting from the 64-bit th0; rr = sin(env)*dr + r0 and
// X = cos(ang)*rr + px with each fsin/fcos product rounded once. WMP 8 0x591ce984 in line mode reloads the
// angle from its stored double copy (fst [esp+0x18]) for the accumulation, so step 1 is round53(th0) + dAng.
// WMP 11 0x13161fa1: the same through _CIatan2/_CIsin/_CIcos, but th0 is reloaded from its stored double for
// dth when a2 != 0 (0x1316206f) and for every step, the first included.
var ENV87 = new Map<number, Float64Array>();
// The first step lands on the integer start point only up to the FPU's rounding: X = trunc(r0 cos th0 + px), th0 =
// FPATAN(b, a). Neither FPATAN nor FSIN/FCOS is correctly rounded on the CPU, and our models of them (./x87) give
// another r0 cos th0 or r0 sin th0 for 134 of the 1,231,041 integer (a, b) with |a| <= 640, |b| <= 480 (measured on
// the FPU itself, an i7-11370H, which the DLL runs on). Those first steps, as (a, b, dx, dy): the FPU's products
// minus the model's, in units of 2^(floor(log2 |a|) - 53) and 2^(floor(log2 |b|) - 53).
var K0 = [
  -497,-459,6,-8,-583,-448,0,-2,532,-398,0,-2,431,-390,0,-2,-583,-383,4,-10,-350,-352,-2,0,140,-337,0,-2,
  491,-335,0,-2,535,-305,0,-2,274,-303,-10,-10,190,-291,2,0,-436,-288,-2,0,219,-270,2,0,-48,-267,0,-2,328,-254,0,-2,
  -558,-232,-2,0,266,-199,0,-2,-175,-176,-2,0,-218,-144,-2,0,164,-127,0,-2,-279,-116,-2,0,-109,-72,-2,0,-279,11,0,2,
  185,14,0,-2,155,21,0,-2,-558,22,0,2,370,28,0,-2,-473,30,0,-2,-455,30,0,-2,447,30,0,-2,477,31,0,-2,3,36,-2,0,
  121,42,0,2,310,42,0,-2,-524,45,0,2,175,49,0,-2,584,49,0,2,-391,50,0,2,-1,50,-1,0,-539,53,0,2,255,57,0,-2,
  -241,63,0,2,6,72,-2,0,242,84,0,2,620,84,0,-2,629,90,0,2,-283,97,0,2,350,98,0,-2,166,99,0,-2,-2,100,-1,0,
  510,114,0,-2,441,116,0,-2,380,119,0,2,42,121,-2,0,317,124,0,-2,475,125,0,-2,-482,126,0,2,-273,127,0,-2,7,140,-2,0,
  12,144,-2,0,-53,158,2,0,521,159,0,-2,-203,164,-2,0,607,165,0,2,484,168,0,2,-599,173,0,2,123,176,-2,0,-202,179,0,-2,
  -13,190,2,0,246,193,-2,0,247,193,0,-2,633,193,0,2,-566,194,0,2,332,198,0,-2,-4,200,-1,0,179,202,-2,0,342,213,0,2,
  -629,221,0,2,285,232,0,2,577,232,0,2,-474,235,-2,0,-213,236,0,2,637,237,0,-2,84,242,-2,0,-332,245,0,2,580,247,0,2,
  634,248,0,-2,-244,251,0,2,-546,254,0,-2,-195,267,-2,0,14,280,-2,0,-171,281,-2,0,-1,281,1,0,97,283,-2,0,24,288,-2,0,
  -211,293,-2,0,-503,294,0,-2,-501,297,0,2,-463,314,0,-2,-106,316,2,0,-527,320,0,-2,-406,328,-2,0,504,337,2,0,
  -423,339,0,2,-527,342,0,2,-213,342,-2,0,585,343,0,-2,240,349,2,0,-396,351,-2,0,-391,351,0,2,246,352,-2,0,
  407,354,0,-2,-404,358,0,-2,-26,380,2,0,392,383,0,2,-505,385,0,-2,492,386,-2,0,494,386,0,-2,444,387,0,2,123,390,-2,0,
  -8,400,-1,0,7,401,2,0,358,404,-2,0,621,422,0,-2,-426,429,0,-2,-461,432,0,2,-343,432,0,2,-116,441,-2,0,-284,449,2,0,
  570,464,0,2,608,471,0,2,-426,472,0,2,500,473,-2,0,519,474,0,2
];
// WMP 11's (msvcrt's _CIatan2, _CIcos, _CIsin on the same FPU; th0 rounded to a double first): 47 first steps, as
// (a, b, dx, dy, when): when 2 = always, 1 = only when x1 == px (a2 == 0 keeps th0's 64 bits for the 2pi wrap).
var K0W = [
  -582,-450,4,-8,2,-583,-448,0,-2,2,532,-398,0,-2,1,431,-390,0,-2,2,-485,-375,4,-8,2,-350,-352,-2,0,2,140,-337,0,-2,2,
  491,-335,0,-2,2,535,-305,0,-2,2,190,-291,2,0,2,-436,-288,-2,0,2,219,-270,2,0,2,-48,-267,0,-2,2,328,-254,0,-2,2,
  -558,-232,-2,0,2,266,-199,0,-2,1,-175,-176,-2,0,2,-218,-144,-2,0,2,164,-127,0,-2,2,-279,-116,-2,0,2,-109,-72,-2,0,2,
  37,53,0,2,2,74,106,0,2,2,50,191,-2,0,2,540,199,0,-2,2,-184,207,-2,0,2,148,212,0,2,2,325,236,0,2,2,-253,264,-2,0,2,
  639,265,2,0,2,91,275,2,0,2,-631,306,0,2,2,-616,327,0,2,2,383,342,0,2,2,451,363,0,2,2,-485,375,6,8,2,623,376,2,0,2,
  100,382,-2,0,2,597,383,2,0,2,575,397,2,0,2,369,406,2,0,2,-368,414,-2,0,2,296,424,0,2,2,289,431,-2,2,2,325,432,0,2,2,
  -582,450,4,10,2,472,462,2,-2,2
];
var K0FIX = new Map<number, number>(), K0WFIX = new Map<number, number>();
for (var k0i = 0; k0i < K0.length; k0i += 4) K0FIX.set(K0[k0i] * 4096 + K0[k0i + 1], k0i);
for (k0i = 0; k0i < K0W.length; k0i += 5) K0WFIX.set(K0W[k0i] * 4096 + K0W[k0i + 1], k0i);
function k0unit(v: number): number { return Math.pow(2, Math.floor(Math.log2(Math.abs(v))) - 53); }
function strokeX87(buf: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number,
                   px: number, py: number, n: number, c0: number, c1: number, bLine: boolean, mode: number, build: number): void {
  var a = x0 - px, b = y0 - py, a2 = x1 - px, b2 = y1 - py;
  var col = c0, dCol = (c1 - c0) / n;
  var r0 = Math.sqrt(a * a + b * b), dr = Math.sqrt(a2 * a2 + b2 * b2) - r0;
  var t0h = 0.0, t0l = 0.0, t1h = 0.0, t1l = 0.0, w11 = build === 11, atan = w11 ? atan2Ext32 : atan2_87;
  if (a !== 0) { atan(b, a, AT); t0h = AT[0]; t0l = AT[1]; }
  if (w11 && a2 !== 0) { t0h += t0l; t0l = 0.0; }
  if (a2 !== 0) { atan(b2, a2, AT); t1h = AT[0]; t1l = AT[1]; }
  if (t0h < 0.0) { t0h = add53x(t0h, t0l, TAU); t0l = 0.0; }
  if (t1h < 0.0) { t1h = add53x(t1h, t1l, TAU); t1l = 0.0; }
  var dth = add53x(t1h, t1l - t0l, -t0h);            // fsub st,st(1): both 64-bit, one rounding
  var wrap: boolean;
  if (mode === 1) wrap = true;
  else if (mode === 2) wrap = false;
  else if (mode === 4) wrap = dth < PI_;
  else wrap = dth >= PI_;
  if (wrap) dth = -(TAU - dth);
  var dAng = dth / n, half = PI_ / (n + n);
  if (n < 1) return;
  var env = (n | 0) === n && n <= 1024 ? ENV87.get(n) : undefined;
  if (!env) {                                        // fsin of the accumulated envelope, per n
    env = new Float64Array(2 * n);
    for (var j = 0, e = 0.0; j < n; j++) { sincos87(e, SC); env[2 * j] = SC[0]; env[2 * j + 1] = SC[1]; e += half; }
    if ((n | 0) === n && n <= 1024) ENV87.set(n, env);
  }
  var angH = w11 ? t0h + t0l : t0h, angL = w11 ? 0.0 : t0l, prevX = x0, prevY = y0;
  for (var k = 0; k < n; k++) {
    var rr = mulExt(dr, env[2 * k], env[2 * k + 1]) + r0;
    sincos87x(angH, angL, SC);
    var ox = mulExt(rr, SC[2], SC[3]), oy = mulExt(rr, SC[0], SC[1]);
    if (k === 0 && (a | 0) === a && (b | 0) === b) {
      var fix = w11 ? K0WFIX.get(a * 4096 + b) : K0FIX.get(a * 4096 + b), T = w11 ? K0W : K0;
      if (fix !== undefined && (!w11 || T[fix + 4] === 2 || a2 === 0)) { ox += T[fix + 2] * k0unit(a); oy += T[fix + 3] * k0unit(b); }
    }
    var X = cvt(ox + px);
    var Y = cvt(oy + py);
    var c = cvt(col) & 0xff;
    if (bLine) { prim.LineClamped(buf, W, H, prevX, prevY, X, Y, c); prevX = X; prevY = Y; }
    else if (X >= 0 && X < W && Y >= 0 && Y < H) buf[Y * W + X] = c;
    col += dCol;
    if (k === 0) angH = (build === 8 && bLine) || w11 ? (t0h + t0l) + dAng : add53x(t0h, t0l, dAng);
    else angH += dAng;
    angL = 0.0;
  }
}
// sin(env) in Stroke depends on n alone (env accumulates `half`, itself a function of n, from 0),
// so each integer n's envelope is the same sin() calls on the same arguments every stroke: they
// are made once per n and reused. CJDar always strokes n = 100; CGalaxy's n is trunc(dbl3).
var ENVELOPES = new Map<number, Float64Array>();
function strokeEnvelope(n: number, half: number): Float64Array {
  var t = ENVELOPES.get(n);
  if (!t) {
    t = new Float64Array(n);
    for (var k = 0, env = 0.0; k < n; k++) { t[k] = sin(env); env += half; }
    ENVELOPES.set(n, t);
  }
  return t;
}

// ------------------------------------------------------------------ CGalaxy (idx 8)
// ctor 0x180416414 (inline in 0x18040f470), Randomize 0x180416a60, Draw 0x180417c70,
// Plot 0x1804166d8. No shipped preset uses it, but its compat mask is 2 so ChangeEffects picks it
// with p = 1/5 per overlay slot — reachable, so it is ported. Two mirrored arms per star, each an
// eased arc from the centre; all four trig calls in Plot share one angle (xmm7).
// dbl0 star/declination count (1..5 from Randomize, capped at 50 in Draw), dbl1 never read,
// dbl2 phase rate, dbl3 steps and end colour, dbl4 == 0 selects line mode, dbl5 drift enable
// (< 2) and radius bias, dbl6 spring constant (+0x38), dbl7 damping (+0x40).
// Spec 14 §9.3 attributed the spring term to dbl5 (+0x28); the disassembly at 0x180417d44 reads
// [rcx+0x38] — dbl6. See spec/battery/15 §3.
class CGalaxy extends BatteryDraw {
  declare phase: number;
  declare centreDX: number; declare centreDY: number;
  declare minX: number; declare minY: number;
  declare maxX: number; declare maxY: number;
  declare marginX: number; declare marginY: number;
  declare posX: number; declare posY: number;
  declare vy: number; declare vx: number;
  constructor() {
    super(2);
    this.phase = 0.0;
    this.centreDX = 0; this.centreDY = 0;                     // +0xf0 / +0xf4
    this.minX = 0; this.minY = 0;                             // +0xf8 / +0xfc
    this.maxX = 0x200; this.maxY = 0x160;                     // +0x100 / +0x104 (512, 352)
    this.marginX = 0x28; this.marginY = 0x28;                 // +0x110 / +0x114 (40, 40)
    this.posX = 0.0; this.posY = 0.0;                         // +0x120 / +0x124, floats
    // 0x1804164a0/0x1804164c7: the ctor itself burns two rand()s, vy FIRST then vx. Randomize
    // ends with the same pair in the same order. Both matter for rand()-sequence replay.
    this.vy = F(F(A.rand() / F32767) * F5_6);                 // +0x11c
    this.vx = F(F(A.rand() / F32767) * F5_6);                 // +0x118
  }
  // 0x180416a60, read in full. 11 rand() draws, or 13 when dbl5 < 3. Order is load-bearing:
  // ChangeEffects replays the same stream. Note dbl1 and dbl6 are never read by Draw... dbl6 is:
  // it is the spring constant. dbl1 is the only genuinely dead parameter.
  randomize(): void {
    this.dbl0 = A.rand() % 5 + 1;                             // 1..5 declinations (== star count)
    var pick = A.rand() % 4;                                  // always 0..3; the 4th arm is dead
    this.dbl1 = pick === 0 ? A.rand() % 100 + 9 : A.rand() % 20 + 10;   // never read
    // 0x180416b38: `if (dbl0 == 0.0) 0.1` is unreachable — dbl0 is 1..5 one line above.
    var b = this.build, x86 = b !== 12;                       // x86: rule 5, doubles never float-rounded
    this.dbl2 = this.dbl0 === 0.0 ? 0.10000000149011612
              : x86 ? (urand(b) * F0_4 + F0_05) / this.dbl0
              : F(F(F(A.rand() / F32767) * F0_4) + F0_05) / this.dbl0;  // (0.05..0.45)/stars
    this.dbl3 = A.rand() % 56 + 200;                          // 200..255: steps and end colour
    this.dbl4 = A.rand() % 10;                                // == 0 -> line mode, p = 1/10
    this.dbl5 = A.rand() % 150;                               // drift enabled 2 times in 150
    this.dbl6 = x86 ? urand(b) * F6E_7 : F(F(A.rand() / F32767) * F6E_7);   // spring constant, 0 .. 6e-7
    this.dbl7 = x86 ? urand(b) * F0_3 : F(F(A.rand() / F32767) * F0_3);     // damping, 0 .. 0.3
    if (this.dbl5 < 3.0) {                                    // note: 3, not the drift gate's 2
      var ry = A.rand() % 200, rx = A.rand() % 200;           // Y is drawn FIRST
      this.centreDY = ry; this.posY = F(ry);
      this.centreDX = rx; this.posX = F(rx);
    } else {
      this.centreDX = 0; this.centreDY = 0; this.posX = 0.0; this.posY = 0.0;
    }
    if (b === 11) {                                           // WMP 11 0x131664b1: the first goes to vx
      this.vx = F(urand(b) * F5_6); this.vy = F(urand(b) * F5_6);
    } else if (x86) {
      this.vy = F(urand(b) * F5_6); this.vx = F(urand(b) * F5_6);
    } else {
      this.vy = F(F(A.rand() / F32767) * F5_6);               // vy FIRST, as in the ctor
      this.vx = F(F(A.rand() / F32767) * F5_6);
    }
  }
  // 0x180418b4c — Euler step + velocity reflection, shared with CJDar (which passes dt = 6.0f
  // against its own +0xf8 block; CGalaxy passes 0.6f from 0x18088c2d4). Everything is float32.
  // There is NO position clamp: only the velocity flips, and only when it already points at the
  // wall it has crossed. The margin applies to the two upper bounds only — symmetric in X and Y,
  // so the drift box is [min, max - margin]; it is not lopsided.
  integrate(dt: number): void {
    var vx = this.vx, vy = this.vy, ix, iy;
    if (this.build === 12) {
      this.posX = F(F(vx * dt) + this.posX);
      this.posY = F(F(vy * dt) + this.posY);
      ix = cvt(this.posX); iy = cvt(this.posY);               // cvttss2si
    } else {                    // x86 (WMP 9 0x077a240c): the float product is exact, one rounding to store
      var x = vx * dt + this.posX;
      this.posX = F(x);
      this.posY = F(vy * dt + this.posY);
      ix = cvt(this.build === 11 ? this.posX : x);            // 8/9/10: ftol of the register, not the store
      iy = cvt(this.posY);
    }
    this.centreDX = ix; this.centreDY = iy;
    if ((ix + this.marginX >= this.maxX && vx > 0.0) || (ix <= this.minX && vx < 0.0)) this.vx = -vx;
    if ((iy <= this.minY && vy < 0.0) || (iy + this.marginY >= this.maxY && vy > 0.0)) this.vy = -vy;
  }
  // Plot 0x1804166d8 — two mirrored eased arcs, control point rotated 90 deg by (1 - brightness).
  plotStar(ctx: BatteryDrawCtx, ang: number, r: number, r2: number, bright: number): void {
    var buf = ctx.buf, W = surfW(ctx), H = surfH(ctx);
    var cx = (ctx.w >> 1) + this.centreDX;
    var cy = (ctx.h >> 1) + this.centreDY;
    var k = 1.0 - bright, dx1, dy1, dx2, dy2, b = this.build;
    if (b === 11) {             // WMP 11 0x131664e8: cos stored as a double, the 64-bit sin multiplied
      sincos87(ang, SC);
      var cD = SC[2] + SC[3];
      dx1 = cvt(cD * r); dy1 = cvt(mulExt(r, SC[0], SC[1]));
      dx2 = cvt(dy1 * k) + cvt(cD * r2);
      dy2 = cvt(mulExt(r2, SC[0], SC[1])) - cvt(dx1 * k);
    } else if (b === 12) {
      var ca = cos(ang), sa = sin(ang);
      dx1 = cvt(ca * r); dy1 = cvt(sa * r);
      dx2 = cvt(ca * r2) + cvt(dy1 * k);
      dy2 = cvt(sa * r2) - cvt(dx1 * k);
    } else {                    // WMP 9 0x077a8db7: 64-bit fcos for both of its products, fsin stored once
      sincos87(ang, SC);
      dx1 = cvt(mulExt(r, SC[2], SC[3])); dy1 = cvt(mulExt(r, SC[0], SC[1]));
      dx2 = cvt(dy1 * k) + cvt(mulExt(r2, SC[2], SC[3]));
      dy2 = cvt((SC[0] + SC[1]) * r2) - cvt(dx1 * k);
    }
    var n = Math.trunc(this.dbl3);
    var cEnd = Math.trunc(this.dbl3) & 0xff;      // dbl3 doubles as step count and end colour
    var line = this.dbl4 === 0.0;
    prim.Stroke(buf, W, H, cx, cy, cx + dx1, cy + dy1, cx + dx2, cy + dy2, n, 0xff, cEnd, line, 0, b);
    prim.Stroke(buf, W, H, cx, cy, cx - dx1, cy - dy1, cx - dx2, cy - dy2, n, 0xff, cEnd, line, 0, b);
  }
  draw(ctx: BatteryDrawCtx): void {
    var L = ctx.level, f0 = L.freq[0], f1 = L.freq[1], b = this.build, x87 = b !== 12 && b !== 11;
    var bass = x87 ? (f0[0] + f0[2] + f0[4] + f1[1] + f1[3] + f1[5]) * INV1530
                   : (f0[0] + f0[2] + f0[4] + f1[1] + f1[3] + f1[5]) / 1530.0;

    if (this.dbl5 < 2.0 && b !== 12) this.driftX86(ctx, bass);
    else if (this.dbl5 < 2.0) {                   // (A) drifting centre
      var vx = this.vx, vy = this.vy, pX = this.posX, pY = this.posY;
      var sq = F(F(pY * pY) + F(pX * pX));        // float maths, posY first as the DLL reads it
      var len = Math.sqrt(F(F(vy * vy) + F(vx * vx)));
      var ux = 0.0, uy = 0.0;
      if (len !== 0.0) { ux = vy / len; uy = -vx / len; }
      this.maxX = surfW(ctx); this.maxY = surfH(ctx);
      this.minX = -surfW(ctx); this.minY = -surfH(ctx);
      this.vx = F(F(ux * bass + (-pX * sq * this.dbl6 - vx * this.dbl7)) + vx);
      this.vy = F(F(uy * bass + (-pY * sq * this.dbl6 - vy * this.dbl7)) + vy);
      this.integrate(F0_6);        // dt = 0.6f, 0x18088c2d4
    }

    this.phase += bass * this.dbl2;               // (B) global spiral phase
    if (this.phase > TAU) this.phase -= TAU;

    var nDecl = Math.trunc(this.dbl0);            // (C) the stars
    var stepA = nDecl < 1 ? 0.5 : PI_ / nDecl;
    var hS = surfH(ctx);
    var nStars = nDecl > 50 ? 50 : nDecl;         // hard cap 50
    var w0 = L.wave[0], w1 = L.wave[1];
    for (var k = 0; k < nStars; k++) {
      var e = f0[k] + f0[k + 2] + f0[k + 4] + f1[k + 1] + f1[k + 3] + f1[k + 5];  // sliding 6-tap
      if (x87) {
        var rx = (e * INV1530) * (hS + this.dbl5);
        this.plotStar(ctx, k * stepA + this.phase, rx, (w1[k] * INV255) * rx, w0[k] * INV255);
        continue;
      }
      var r = (e / 1530.0) * (hS + this.dbl5);
      this.plotStar(ctx, k * stepA + this.phase, r, (w1[k] / 255.0) * r, w0[k] / 255.0);
    }
  }
  // (A) on the older builds. 53-bit sq = fx^2 + fy^2 and len = sqrt(vx^2 + vy^2) (WMP 11: F32(sqrt(F32(..))));
  // the spring term ((-f * dbl6) * sq) on 8/9 (WMP 9 0x07835a7b), ((-f * sq) * dbl6) on 10/11 (WMP 10
  // 0x0771da0e); WMP 8 has no len == 0 guard (0/0 = NaN, reproduced); the velocity is F32((u*bass + acc) + v)
  // on WMP 9 and F32(F32(u*bass + acc) + v) on 8 (0x591cf842), 10 (0x0787053d) and 11.
  driftX86(ctx: BatteryDrawCtx, bass: number): void {
    var b = this.build, vx = this.vx, vy = this.vy, pX = this.posX, pY = this.posY;
    var sq = pX * pX + pY * pY;
    var len = b === 11 ? F(Math.sqrt(F(vx * vx + vy * vy))) : Math.sqrt(vx * vx + vy * vy);
    var accX, accY, ux = 0.0, uy = 0.0;
    if (b === 8 || b === 9) { accX = ((-pX * this.dbl6) * sq) - vx * this.dbl7; accY = ((-pY * this.dbl6) * sq) - vy * this.dbl7; }
    else { accX = ((-pX * sq) * this.dbl6) - vx * this.dbl7; accY = ((-pY * sq) * this.dbl6) - vy * this.dbl7; }
    if (b === 8 || len !== 0.0) { ux = vy / len; uy = -vx / len; }
    this.maxX = surfW(ctx); this.maxY = surfH(ctx);
    this.minX = -surfW(ctx); this.minY = -surfH(ctx);
    if (b === 9) { this.vx = F((ux * bass + accX) + vx); this.vy = F((uy * bass + accY) + vy); }
    else { this.vx = F(F(ux * bass + accX) + vx); this.vy = F(F(uy * bass + accY) + vy); }
    this.integrate(F0_6);
  }
}

D.CEdgeTrace = CEdgeTrace;
D.CEdgeGradiant = CEdgeGradiant;
D.CCosEdgeGradiant = CCosEdgeGradiant;
D.CWaveEdge = CWaveEdge;
D.CSpectrumEdge = CSpectrumEdge;
D.CCircleWaveform = CCircleWaveform;
D.CGalaxy = CGalaxy;
D.CJiggyScribble = CJiggyScribble;

// The engine's draw-effect registry order, fixed by the append order in FUN_18040f470 (§1.4).
// Indices must stay stable: ChangeEffects (0x180415d60, engine-side, src/75-battery.js) is a pair
// of rejection samplers over `registry[rand() % 10]` and every rejected draw burns a rand().
// Entries this file does not own are null until 73-battery-draws-a.js fills them in.
D.registry = ['CEdgeTrace', 'CEdgeGradiant', 'CCosEdgeGradiant', 'CWaveEdge', 'CSpectrumEdge',
              'CCircleWaveform', 'CDotPlane', 'CJDar', 'CGalaxy', 'CJiggyScribble'];
D.list = function () {
  // dynamic by-name lookup over the registry — same reasoning as setParams' dbl<i> write above.
  return D.registry.map(function (n) { return (D as unknown as Record<string, BatteryDrawCtor | undefined>)[n] || null; });
};
