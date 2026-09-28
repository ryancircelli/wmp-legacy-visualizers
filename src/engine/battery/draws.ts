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

/** The engine-side (src/engine/battery/index.ts) view of a draw effect instance. */
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
         px: number, py: number, n: number, c0: number, c1: number, bLine: boolean, mode: number): void;
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
  constructor(mask: number) {
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
  randomize(): void { this.dbl0 = F(F(A.rand() / F32767) * F0_09); }   // 0 .. 0.09, all float32
  draw(ctx: BatteryDrawCtx): void {
    this.phase += this.dbl0;
    if (this.phase > TAU) this.phase = 0.0;                      // hard reset, not a subtraction
    // signed cvttsd2si then a BYTE store: the index ramps backwards down from 255 while cos < 0.
    prim.border(ctx.buf, surfW(ctx), ctx.w, ctx.h, cvt(cos(this.phase) * 253.0 + 1.0) & 0xff);
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
    do {                                        // do-while: always at least one bin
      h[this.idx] = h[this.idx] + f0[i] + f1[i + 1];
      i += 2;
    } while (i < this.dbl1);

    var sum = 0, k = 0;
    // k is an 8-bit counter in the original. A fractional dbl2 in (15,16) passes the guard and
    // reads hist[15], which in the DLL is the `idx` field at +0x124; `| 0` keeps that 0 here.
    while (k < this.dbl2) { sum += h[k] | 0; k = (k + 1) & 0xff; }
    var v = cvt(sum / (this.dbl2 * this.dbl1)) & 0xff;   // divisor is historyFrames x byteSpan

    if (this.dbl0 === 0.0) v = ~v & 0xff;                        // invert
    else if (this.dbl0 > 5.0) v = cvt(F(F(v) * F0_9)) & 0xff;    // 0.9f on the already-byte value
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
  constructor() { super(2); this.dbl1 = 1.0; this.baseRadius = 20; this.phase = 0.0; }
  randomize(): void {
    var r1 = A.rand(), r2 = A.rand(), r3 = A.rand();          // order matters for replay
    this.dbl0 = r3 % 4;                                       // from the THIRD draw
    this.dbl1 = 2 - (r1 % 5 !== 0 ? 1 : 0) + (r2 % 5 === 0 ? 1 : 0);   // 1..3, p 16/25, 8/25, 1/25
    this.dbl2 = F(F(F(A.rand() / F32767) * F0_6) + F0_05);    // 0.05 .. 0.65
  }
  draw(ctx: BatteryDrawCtx): void {
    var L = ctx.level, buf = ctx.buf, sw = surfW(ctx), sh = surfH(ctx);
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
        var aF = F(F(F(TAU / F(this.dbl1)) * F(ring)) + this.phase);   // float32 throughout
        cx += cvt(cos(aF) * rad);
        cy += cvt(sin(aF) * rad);
      }
      var n;
      if (this.dbl2 > 1.0) { this.dbl2 = 1.0; n = 1024; }     // writes the parameter back
      else { n = cvt(this.dbl2 * 1024.0); if (n <= 0) continue; }

      for (var i = 0; i < n; i++) {
        var a = F(F(i / n) * PI_);                            // HALF a turn over the whole run
        switch (Math.trunc(this.dbl0)) {
          case 0:
            c1 = (2 * Math.abs(w0[i] - 128)) & 0xff;          // 256 -> 0 when the sample is 0
            c2 = (2 * Math.abs(w1[i] - 128)) & 0xff;
            break;
          case 1: c1 = w0[i]; c2 = w1[i]; break;
          case 2: c1 = 0xff; c2 = 0xff; break;
          case 3: {
            var tri = cvt(F(F(i / n) * F768));                // triangle over 0 .. 767
            var v = tri & 0xff;
            if ((tri >> 8) & 1) v = ~v & 0xff;
            c1 = v; c2 = v; break;
          }
          default: break;
        }
        var r1 = F(F(F(amp) * F(F(w0[i]) * INV256)) + F(this.baseRadius));
        var x1 = cvt(cos(a) * r1) + cx;
        var y1 = cvt(sin(a) * r1) + cy;
        if (i !== 0) prim.LineClamped(buf, sw, sh, p1x, p1y, x1, y1, c1);

        var r2 = F(F(F(amp) * F(F(w1[i]) * INV256)) + F(this.baseRadius));
        var x2 = cvt(cos(a) * r2) + cx;
        var y2 = cy - cvt(sin(a) * r2);                  // SUBTRACTION: mirrored in Y
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
  constructor() { super(2); this.phase = 0.0; }
  randomize(): void {
    this.dbl0 = A.rand() % 100 + 4;        // 4 .. 103
    this.dbl1 = A.rand() % 200 + 40;       // 40 .. 239
    this.dbl2 = A.rand() % 1000 + 300;     // 300 .. 1299
    this.dbl3 = A.rand() % 20 + 1;         // 1 .. 20
    this.dbl4 = F(F(F(A.rand() / F32767) * F0_6) + F0_05);   // 0.05 .. 0.65
    this.dbl5 = A.rand() % 10;             // never read by Draw
    this.dbl6 = A.rand() % 10;             // line mode only on 9, p = 1/10
  }
  draw(ctx: BatteryDrawCtx): void {
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

    var t = 0.0, n = Math.trunc(this.dbl2);
    for (var i = 0; i < n; i++) {
      ax = radMod * cos(t) + this.dbl0 * cos(t * this.dbl3);
      ay = radMod * sin(t) + this.dbl0 * sin(t * this.dbl3);
      r = Math.sqrt(ax * ax + ay * ay);
      th = atan2(ax, ay) + ph;             // ARGUMENTS SWAPPED — not a typo, keep them
      var X = cos(th) * r + cx;
      var Y = sin(th) * r + cy;
      if (lineMode) {
        prim.LineClamped(buf, sw, sh, cvt(px), cvt(py), cvt(X), cvt(Y), 0xff);
        px = X; py = Y;
      } else {
        prim.plot(buf, sw, sh, X, Y, 0xff);   // compares in double, then truncates
      }
      t += stepA;
    }
  }
}

// ------------------------------------------------------------------ Stroke (0x180413ca0)
// The shared eased-arc primitive: CGalaxy here (mode 0), CJDar in 73-battery-draws-a.js (mode 3).
// Read instruction-by-instruction from 0x180413ca0..0x18041403e; see spec/battery/15.
//   r0/r1  = |start-pivot| / |end-pivot|,  th0/th1 = atan2 of the same two, normalised to [0,2pi)
//   dth    = th1 - th0, then wrapped by `mode` (below)
//   step k = 0..n-1:  ang = th0 + k*dAng (ACCUMULATED), env = k*half (accumulated),
//                     rr = sin(env)*(r1-r0) + r0,  colour = c0 + k*dCol (accumulated)
// `half` is computed in float32 as pi/(2n), so env sweeps [0, pi/2) and the radius eases from r0
// towards — but never reaching — r1. Line mode starts from (x0,y0).
function Stroke(buf: Uint8Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number,
                 px: number, py: number, n: number, c0: number, c1: number, bLine: boolean, mode: number): void {
  if (n === 0) return;                              // test ebp,ebp / je 0x180414031
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
  var envSin = (n | 0) === n && n <= 1024 ? strokeEnvelope(n, half) : null;
  for (k = 0; k < n; k++) {
    var rr = (envSin ? envSin[k] : sin(env)) * (r1 - r0) + r0;
    var X = cvt(cos(ang) * rr + px);
    var Y = cvt(sin(ang) * rr + py);
    var c = cvt(col) & 0xff;
    if (bLine) { prim.LineClamped(buf, W, H, prevX, prevY, X, Y, c); prevX = X; prevY = Y; }
    else if (X >= 0 && X < W && Y >= 0 && Y < H) buf[Y * W + X] = c;
    env += half; ang += dAng; col += dCol;
  }
}
prim.Stroke = Stroke;
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
    this.dbl2 = this.dbl0 === 0.0 ? 0.10000000149011612
              : F(F(F(A.rand() / F32767) * F0_4) + F0_05) / this.dbl0;  // (0.05..0.45)/stars
    this.dbl3 = A.rand() % 56 + 200;                          // 200..255: steps and end colour
    this.dbl4 = A.rand() % 10;                                // == 0 -> line mode, p = 1/10
    this.dbl5 = A.rand() % 150;                               // drift enabled 2 times in 150
    this.dbl6 = F(F(A.rand() / F32767) * F6E_7);              // spring constant, 0 .. 6e-7
    this.dbl7 = F(F(A.rand() / F32767) * F0_3);               // damping, 0 .. 0.3
    if (this.dbl5 < 3.0) {                                    // note: 3, not the drift gate's 2
      var ry = A.rand() % 200, rx = A.rand() % 200;           // Y is drawn FIRST
      this.centreDY = ry; this.posY = F(ry);
      this.centreDX = rx; this.posX = F(rx);
    } else {
      this.centreDX = 0; this.centreDY = 0; this.posX = 0.0; this.posY = 0.0;
    }
    this.vy = F(F(A.rand() / F32767) * F5_6);                 // vy FIRST, as in the ctor
    this.vx = F(F(A.rand() / F32767) * F5_6);
  }
  // 0x180418b4c — Euler step + velocity reflection, shared with CJDar (which passes dt = 6.0f
  // against its own +0xf8 block; CGalaxy passes 0.6f from 0x18088c2d4). Everything is float32.
  // There is NO position clamp: only the velocity flips, and only when it already points at the
  // wall it has crossed. The margin applies to the two upper bounds only — symmetric in X and Y,
  // so the drift box is [min, max - margin]; it is not lopsided.
  integrate(dt: number): void {
    var vx = this.vx, vy = this.vy;
    this.posX = F(F(vx * dt) + this.posX);
    this.posY = F(F(vy * dt) + this.posY);
    var ix = cvt(this.posX), iy = cvt(this.posY);             // cvttss2si
    this.centreDX = ix; this.centreDY = iy;
    if ((ix + this.marginX >= this.maxX && vx > 0.0) || (ix <= this.minX && vx < 0.0)) this.vx = -vx;
    if ((iy <= this.minY && vy < 0.0) || (iy + this.marginY >= this.maxY && vy > 0.0)) this.vy = -vy;
  }
  // Plot 0x1804166d8 — two mirrored eased arcs, control point rotated 90 deg by (1 - brightness).
  plotStar(ctx: BatteryDrawCtx, ang: number, r: number, r2: number, bright: number): void {
    var buf = ctx.buf, W = surfW(ctx), H = surfH(ctx);
    var cx = (ctx.w >> 1) + this.centreDX;
    var cy = (ctx.h >> 1) + this.centreDY;
    var ca = cos(ang), sa = sin(ang);
    var dx1 = cvt(ca * r), dy1 = cvt(sa * r);
    var k = 1.0 - bright;
    var dx2 = cvt(ca * r2) + cvt(dy1 * k);
    var dy2 = cvt(sa * r2) - cvt(dx1 * k);
    var n = Math.trunc(this.dbl3);
    var cEnd = Math.trunc(this.dbl3) & 0xff;      // dbl3 doubles as step count and end colour
    var line = this.dbl4 === 0.0;
    prim.Stroke(buf, W, H, cx, cy, cx + dx1, cy + dy1, cx + dx2, cy + dy2, n, 0xff, cEnd, line, 0);
    prim.Stroke(buf, W, H, cx, cy, cx - dx1, cy - dy1, cx - dx2, cy - dy2, n, 0xff, cEnd, line, 0);
  }
  draw(ctx: BatteryDrawCtx): void {
    var L = ctx.level, f0 = L.freq[0], f1 = L.freq[1];
    var bass = (f0[0] + f0[2] + f0[4] + f1[1] + f1[3] + f1[5]) / 1530.0;

    if (this.dbl5 < 2.0) {                        // (A) drifting centre
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
      var r = (e / 1530.0) * (hS + this.dbl5);
      this.plotStar(ctx, k * stepA + this.phase, r, (w1[k] / 255.0) * r, w0[k] / 255.0);
    }
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
