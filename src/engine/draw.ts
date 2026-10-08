// Alchemy.Draw — the category-4 "beam" effects and the shared polyline/colour cluster.
// Ports: 18000af60 (Pen), 18000aed8/afd4/bf70/b970 (ColorFader), 18000b3cc (Wiggle),
// 18000ba50 (DrawJaggedLine), 18000bdf4 (DrawDiameter), 18000b0a0 (clip), 18000b270 (DDA),
// 18000b730 (Brush), 18000b650 (Blur5), 18000b518 (Lerp), 18000b9f8 (RandomRGB),
// 18000f8ec/18000fe50 (SuperStar), 18000f960/180010120 (WonderWave),
// 18000fa0c/180010380/18000fbc4/18000b5b4 (AtomBalls).  Specs 04 + 05.
// Wrapped verbatim from src/40-draw.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from './ns';
import type { Surface, TimedLevel } from './ns';
import type { EffectCtx } from './effect';
import './rand';
import './effect';
// mpvis.DLL's sin/cos are ucrtbase's (_o_sin/_o_cos -> 0x1800aba70/0x1800a7730): the clones in 00-rand.js.
// eslint-disable-next-line @typescript-eslint/unbound-method -- plain functions, no `this` usage; not called as methods
var sin = A.sin || Math.sin, cos = A.cos || Math.cos;

var F = Math.fround;
var PI_2_F = 1.5707963705062866;   // 0x180023668 f32 / 0x180023718 f64 (same value)
var PI_D = 3.1415927410125732;     // 0x180023740 f64 (== (double)(float)PI)
var TAU_D = 6.2831854820251465;    // 0x180023750 f64

// (int) cast, x86 CVTTSD2SI semantics: out-of-range / NaN -> 0x80000000.
function cvt(v: number): number {
  return (v > -2147483649 && v < 2147483648) ? Math.trunc(v) : -2147483648;
}
// 18000bef4 — round half away from zero, then (int): ADDSS/SUBSS 0.5f, so the sum is rounded to
// float before CVTTSS2SI (|v| in [0.5 - 2^-25, 0.5) rounds to +-1, not 0).
function roundToInt(v: number): number { return cvt(F(v <= 0 ? v - 0.5 : v + 0.5)); }

// 18000b518 — per-channel lerp in 8-bit arithmetic. t=0 -> c0, t=1 -> c1.
// The delta is truncated to int8 and added mod 256, so t outside [0,1] WRAPS per channel.
function lerpChan(c0: number, c1: number, k: number, t: number): number {
  var a = (c0 >>> k) & 0xff;
  // (int8)RoundToInt((float)(int)(b - a) * t) (MULSS, then 18000bef4); b - a is exact in f32, so one
  // rounding suffices, and the product always fits an int32, so `| 0` is the (int) cast.
  var d = F((((c1 >>> k) & 0xff) - a) * t);
  d = ((F(d <= 0 ? d - 0.5 : d + 0.5) | 0) << 24) >> 24;
  return ((d + a) & 0xff) << k;
}
function lerp(c0: number, c1: number, t: number): number {                 // channel order G,R,B as in the DLL (no effect on output)
  return (lerpChan(c0, c1, 8, t) | lerpChan(c0, c1, 16, t) | lerpChan(c0, c1, 0, t)) >>> 0;
}

// 18000b9f8 — three rand() draws: 1st -> G, 2nd -> R, 3rd -> B, alpha 0.
function randomRGB(): number {
  var b1 = A.rand() & 0xff, b2 = A.rand() & 0xff, b3 = A.rand() & 0xff;
  return (b3 | (b2 << 16) | (b1 << 8)) >>> 0;
}

// 18000b650 — 5-tap plus-shaped in-place box blur, integer divide by 5.
function blur5(surf: Surface, p: number): void {
  var W = surf.w, px = surf.px;
  var a = px[p - W], b = px[p + W], c = px[p - 1], d = px[p + 1], e = px[p];
  var r = (((a >>> 16) & 0xff) + ((b >>> 16) & 0xff) + ((c >>> 16) & 0xff) + ((d >>> 16) & 0xff) + ((e >>> 16) & 0xff)) / 5 | 0;
  var g = (((a >>> 8) & 0xff) + ((b >>> 8) & 0xff) + ((c >>> 8) & 0xff) + ((d >>> 8) & 0xff) + ((e >>> 8) & 0xff)) / 5 | 0;
  var bl = ((a & 0xff) + (b & 0xff) + (c & 0xff) + (d & 0xff) + (e & 0xff)) / 5 | 0;
  px[p] = ((r << 16) | (g << 8) | bl) >>> 0;
}

// ---------------------------------------------------------------- ColorFader
// 18000aed8 ctor / 18000bf70 reset / 18000afd4 tick.
// The ease F(sin(F(tick / period) * PI_2_F)) depends on (tick, period) alone, so it is tabled per
// period as ticks first ask for it: the same call on the same argument, made once (NaN = not yet).
// Periods are whole numbers up to a line's step count (1023); anything else is computed as it comes.
var EASE = new Map<number, Float32Array>();
function ease(tick: number, period: number): number {
  if ((period | 0) !== period || period > 4096) return F(sin(F(tick / period) * PI_2_F));
  var t = EASE.get(period);
  if (!t) { t = new Float32Array(period + 1).fill(NaN); EASE.set(period, t); }
  var v = t[tick];
  if (v !== v) v = t[tick] = F(sin(F(tick / period) * PI_2_F));
  return v;
}
class ColorFader {
  declare maxPeriod: number;
  declare tick: number;
  declare period: number;
  declare ramping: boolean;
  declare segments: number;
  declare enabled: number;
  declare from: number;
  declare to: number;
  declare cur: number;
  static declare randomRGB: typeof randomRGB;
  static declare lerp: typeof lerp;

  constructor() {
    this.maxPeriod = 100;
    this.tick = 0; this.period = 0;
    this.ramping = false; this.segments = 1; this.enabled = 1;
    this.from = randomRGB(); this.to = randomRGB(); this.cur = this.from;
  }
  reset(from: number, to: number, period: number, segments: number): void {
    this.tick = 0;
    if (period < 1) period = (this.maxPeriod > 0 ? A.rand() % this.maxPeriod : 0) + 1;
    this.period = period; this.segments = segments; this.ramping = segments > 1;
    if (segments > 1) this.period = (period / segments) | 0;   // integer div; may be 0
    this.cur = this.from = from; this.to = to;
  }
  step(): void {                                  // 18000afd4 ("Tick"; `tick` is the counter field)
    if (++this.tick <= this.period) {
      var t = ease(this.tick, this.period);                 // quarter-sine ease-out
      this.cur = lerp(this.from, this.to, t);
    } else if (this.ramping) {               // segments > 1: ping-pong
      this.reset(this.to, this.from, this.segments * this.period, this.segments);
    } else if (this.enabled) {               // random walk; this rand() precedes RandomRGB's three
      var p = this.maxPeriod > 0 ? A.rand() % this.maxPeriod : 0;
      this.reset(this.cur, randomRGB(), p, 1);
    }                                        // else frozen forever
  }
}
ColorFader.randomRGB = randomRGB;
ColorFader.lerp = lerp;

// ------------------------------------------------------------------- Pen
// Wiggle's envelope 0, F(|sin(loops * (i / steps) * PI_D)|), depends on (loops, steps, i) alone:
// tabled per (loops, steps) as for the ColorFader's ease. loops is 1..20, steps a line's 1..1023.
var ENV = new Map<number, Float32Array>();
function envelope(loops: number, i: number, steps: number): number {
  if ((loops | 0) !== loops || (steps | 0) !== steps || loops < 0 || loops > 64 || steps < 1 || steps > 4096 ||
      (i | 0) !== i || i < 0 || i >= steps) return F(Math.abs(sin(loops * (i / steps) * PI_D)));
  var key = loops * 4097 + steps, t = ENV.get(key);
  if (!t) { t = new Float32Array(steps).fill(NaN); ENV.set(key, t); }
  var v = t[i];
  if (v !== v) v = t[i] = F(Math.abs(sin(loops * (i / steps) * PI_D)));
  return v;
}

// Plotter (clip/ink/brush/surf/blendAmt) + Wiggle (audio displacement) in one object,
// exactly as the DLL embeds them.
class Pen {
  // Plotter (Pen+0x08)
  declare clipMin: number;
  declare clipMaxY: number;
  declare clipMaxX: number;
  declare inkColor: ColorFader;
  declare holdColor: boolean;
  declare brushMode: number;
  declare surf: Surface | null;
  declare blendAmt: number;
  // Wiggle (Pen+0x50)
  declare steps: number;
  declare amplitude: number;
  declare fold: boolean;
  declare source: number;
  declare envelope: number;
  declare loops: number;
  declare tl: TimedLevel | null;
  declare maxSteps: number;
  declare rampColor: ColorFader;
  declare freezeRamp: boolean;
  declare crossFadeInk: boolean;
  declare mirrored: boolean;
  static declare lerp: typeof lerp;
  static declare blur5: typeof blur5;
  static declare roundToInt: typeof roundToInt;
  static declare cvt: typeof cvt;

  constructor() {
    // Plotter (Pen+0x08)
    this.clipMin = 0; this.clipMaxY = 0; this.clipMaxX = 0;
    this.inkColor = new ColorFader();
    this.holdColor = true;
    this.brushMode = 0;
    this.surf = null;
    this.blendAmt = 0;            // UNINITIALISED in the DLL; every caller writes it
    // Wiggle (Pen+0x50)
    this.steps = 100; this.amplitude = 50; this.fold = true; this.source = 2;
    this.envelope = 0; this.loops = 2; this.tl = null; this.maxSteps = 1;
    this.rampColor = new ColorFader();
    this.freezeRamp = true; this.crossFadeInk = false; this.mirrored = false;
  }

  // 18000b3cc — the audio kernel. Sample index folded about steps/2, envelope on the raw i.
  wiggle(i: number): number {
    var j = i;
    if (this.fold) { var hf = (this.steps / 2) | 0; if (i > hf) j = 2 * hf - i; }
    var tl = this.tl!, v: number;
    switch (this.source) {
      case 0: v = tl.wave[0][j]; break;
      case 1: v = tl.wave[1][j]; break;
      case 2: v = F(F(tl.wave[1][j] + tl.wave[0][j]) * 0.5); break;
      default: v = 0;
    }
    var d = F(F(this.amplitude * 0.0078125) * F(v - 128));      // 0.0078125f == 1/128
    if (this.envelope === 0) {
      d = F(d * envelope(this.loops, i, this.steps));
    } else if (this.envelope === 1) {
      var h = this.steps >> 1;
      d = F(d * F(F(i < h ? i : 2 * h - i) / h));
    }
    return d;
  }

  // 18000b970 — vtable slot 0. One-vertex lag: the PRE-tick ramp colour is the ink.
  nextStrokeColour(): void {
    var old = this.rampColor.cur;
    if (!this.freezeRamp) {
      this.rampColor.step();
      if (this.crossFadeInk) {            // dead: no writer of Pen+0x99 exists
        this.holdColor = false;
        this.inkColor.reset(old, this.rampColor.cur, 1, 1);
        return;
      }
      this.holdColor = true;
    } else this.holdColor = true;
    this.inkColor.cur = old;
  }

  // 18000ba50 — the polyline. Chord sampled at nSeg uniform positions, each pushed
  // perpendicular by wiggle(i). The last 1/nSeg of the chord is never drawn.
  drawJaggedLine(x0: number, y0: number, x1: number, y1: number): void {
    var dx = x1 - x0, dy = y1 - y0;
    var major = (Math.abs(dx) <= Math.abs(dy)) ? dy : dx;
    var nSeg = Math.min(this.maxSteps, Math.abs(major) + 1);
    this.steps = nSeg;

    var theta = F(F((A.atan2 || Math.atan2)(dy, dx)) + PI_2_F);   // CRT-exact atan2, 00-rand.js
    var c = F(cos(theta)), s = F(sin(theta));

    var o = this.wiggle(0);
    var ax = roundToInt(F(x0 + F(o * c))), ay = roundToInt(F(y0 + F(o * s)));
    var bx = 0, by = 0;
    if (this.mirrored) { bx = roundToInt(F(x0 - F(o * c))); by = roundToInt(F(y0 - F(o * s))); }

    this.rampColor.period = (nSeg / this.rampColor.segments) | 0;
    this.nextStrokeColour();

    for (var i = 1; i < nSeg; i++) {                 // NB: stops at nSeg-1
      o = this.wiggle(i);
      var t = F(i / nSeg);
      var cxf = F(x0 + F(dx * t)), cyf = F(y0 + F(dy * t));
      var qx = roundToInt(F(cxf + F(o * c))), qy = roundToInt(F(cyf + F(o * s)));
      this.clipAndDraw(ax, ay, qx, qy); ax = qx; ay = qy;
      if (this.mirrored) {
        var rx = roundToInt(F(cxf - F(o * c))), ry = roundToInt(F(cyf - F(o * s)));
        this.clipAndDraw(bx, by, rx, ry); bx = rx; by = ry;
      }
      this.nextStrokeColour();
    }
  }

  // 18000bdf4 — full-screen chord at an angle (WonderWave only).
  drawDiameter(cx: number, cy: number, a: number, len: number): void {
    var h = F(len * 0.5);
    var a2 = F(a + PI_D);
    this.drawJaggedLine(
      cx + roundToInt(F(F(cos(a)) * h)), cy + roundToInt(F(F(sin(a)) * h)),
      cx + roundToInt(F(F(cos(a2)) * h)), cy + roundToInt(F(F(sin(a2)) * h)));
  }

  // 18000b0a0 — clip against [clipMin, clipMaxX) x [clipMin, clipMaxY), then DDA.
  // Faithful quirks: vertical segments get slope 1.0; horizontal ones divide by zero on a
  // y-edge (-> 0x80000000 -> rejected). Both fail safe by dropping the segment.
  clipAndDraw(x0: number, y0: number, x1: number, y1: number): void {
    var lo = this.clipMin, hx = this.clipMaxX, hy = this.clipMaxY;
    var in0 = x0 >= lo && x0 < hx && y0 >= lo && y0 < hy;
    var in1 = x1 >= lo && x1 < hx && y1 >= lo && y1 < hy;
    if (in0 && in1) { this.drawSegment(x0, y0, x1, y1); return; }
    if ((x0 < lo && x1 < lo) || (x0 >= hx && x1 >= hx) ||
        (y0 < lo && y1 < lo) || (y0 >= hy && y1 >= hy)) return;

    var m = (x1 === x0) ? 1.0 : F(F(y1 - y0) / F(x1 - x0));
    var b = F(y0 - F(x0 * m));
    if (x0 < lo)  { x0 = lo;     y0 = roundToInt(F(F(m * x0) + b)); }
    if (x0 >= hx) { x0 = hx - 1; y0 = roundToInt(F(F(m * x0) + b)); }
    if (y0 < lo)  { y0 = lo;     x0 = roundToInt(F(F(y0 - b) / m)); }
    if (y0 >= hy) { y0 = hy - 1; x0 = roundToInt(F(F(y0 - b) / m)); }
    if (x1 < lo)  { x1 = lo;     y1 = roundToInt(F(F(m * x1) + b)); }
    if (x1 >= hx) { x1 = hx - 1; y1 = roundToInt(F(F(m * x1) + b)); }
    if (y1 < lo)  { y1 = lo;     x1 = roundToInt(F(F(y1 - b) / m)); }
    if (y1 >= hy) { y1 = hy - 1; x1 = roundToInt(F(F(y1 - b) / m)); }
    if (x0 < lo || x0 >= hx || y0 < lo || y0 >= hy) return;
    if (x1 < lo || x1 >= hx || y1 < lo || y1 >= hy) return;
    this.drawSegment(x0, y0, x1, y1);
  }

  // 18000b270 — integer DDA. err starts at 0 (half-pixel lag); the far endpoint is never
  // plotted; a zero-length segment plots nothing.
  drawSegment(x0: number, y0: number, x1: number, y1: number): void {
    var pitch = this.surf!.w;
    var dx = x1 - x0, dy = y1 - y0;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var xStep = Math.sign(dx), yStep = Math.sign(dy), rowStep = yStep * pitch;
    var p = pitch * y0 + x0, err = 0, x = x0, y = y0, n: number, adv: number;
    if (ady < adx) {
      this.inkColor.period = (adx / this.inkColor.segments) | 0;
      for (n = 0; n < adx; n++) {
        this.brush(p, x, y);
        err += ady; adv = xStep;
        if (err > adx) { y += yStep; err -= adx; adv += rowStep; }
        x += xStep; p += adv;
      }
    } else {
      this.inkColor.period = (ady / this.inkColor.segments) | 0;
      for (n = 0; n < ady; n++) {
        this.brush(p, x, y);
        err += adx; adv = rowStep;
        if (err > ady) { err -= ady; x += xStep; adv += xStep; }
        y += yStep; p += adv;
      }
    }
  }

  // 18000b730 — the deposit. Guard band of 2 px; modes are lerps TOWARD the ink colour
  // (not additive). Mode 3 is a byte-identical alias of mode 2.
  brush(p: number, x: number, y: number): void {
    var S = this.surf!, W = S.w, px = S.px;
    if (x < 2 || y < 2 || x >= W - 2 || y >= S.h - 2) return;
    var col = this.inkColor.cur, f = this.blendAmt;
    switch (this.brushMode) {
      case 0:                                        // single pixel, 10 % deposit
        px[p] = lerp(col, px[p], 0.8999999761581421);
        break;
      case 1:                                        // hard core + 70 % plus halo
        px[p] = col;
        px[p + 1] = lerp(col, px[p + 1], 0.30000001192092896);
        px[p - 1] = lerp(col, px[p - 1], 0.30000001192092896);
        px[p + W] = lerp(col, px[p + W], 0.30000001192092896);
        px[p - W] = lerp(col, px[p - W], 0.30000001192092896);
        break;
      case 2: case 3:                                // core + tunable halo + 3x3 blur
        px[p] = col;
        px[p + 1] = lerp(col, px[p + 1], f); px[p - 1] = lerp(col, px[p - 1], f);
        px[p + W] = lerp(col, px[p + W], f); px[p - W] = lerp(col, px[p - W], f);
        blur5(S, p - W - 1); blur5(S, p - W); blur5(S, p - W + 1);
        blur5(S, p - 1);     blur5(S, p);     blur5(S, p + 1);
        blur5(S, p + W - 1); blur5(S, p + W); blur5(S, p + W + 1);
        break;
      default: break;
    }
    if (!this.holdColor) this.inkColor.step();        // never taken: holdColor is always 1
  }
}
Pen.lerp = lerp;
Pen.blur5 = blur5;
Pen.roundToInt = roundToInt;
Pen.cvt = cvt;

// -------------------------------------------------------------- SuperStar
class SuperStar extends A.Effect {
  declare cx: number;
  declare cy: number;
  declare Scale: number;
  declare MaxSpin: number;
  declare Divisions: number;
  declare colorA: ColorFader;
  declare colorB: ColorFader;
  declare angle: number;
  declare pen: Pen;

  constructor() {
    super();
    this.name = 'SuperStar';
    this.nameId = 107; this.traceId = 12; this.category = 4;
    this.weight = 0.5; this.prob = 0.5;              // +0x20 overwritten at registration
    this.cx = 0; this.cy = 0;
    new ColorFader();                                // spare Plotter at +0x50: dead, but its
                                                     // ColorFader still burns 6 rand() draws
    this.Scale = 0; this.MaxSpin = 0; this.Divisions = 0;   // genuinely uninitialised in the DLL
    this.colorA = new ColorFader(); this.colorB = new ColorFader();
    this.angle = 0;
    this.pen = new Pen();
  }

  randomize(): void {                                      // 180010760
    this.Scale = (A.rand() / 32767.0) * 0.8 + 0.2;
    var r = A.rand();
    this.Divisions = r % 12 + 3;
    if (((r % 12) - 2) >>> 0 < 2) {                  // r%12 in {2,3} -> Divisions 5 or 6
      this.Divisions += (A.rand() % 3 === 0) ? 15 : 2;
    }
    this.MaxSpin = (A.rand() / 32767.0) * 0.6 - 0.3;
  }

  render(ctx: EffectCtx): void {                                      // 18000fe50
    var tl = ctx.level!, f0 = tl.freq[0], f1 = tl.freq[1];
    var bass = (f0[1] + f0[3] + f0[5] + f1[2] + f1[4] + f1[6]) / 1200.0;
    // 18000fed8/18000fee1/18000ff11: bass/1200 is formed first, then MULSD by
    // ((double)(h>>1) * Scale) — not ((bass*(h>>1)) * Scale).
    var R = bass * ((ctx.h >> 1) * this.Scale);
    var mid = (f0[501] + f0[503] + f0[505] + f1[502] + f1[504] + f1[506]) / 600.0;
    this.angle += mid * this.MaxSpin;
    if (this.angle > TAU_D) this.angle -= TAU_D;     // one-sided wrap only

    var n = this.Divisions, k = (n >> 1) + 1;
    if (n === 10 || n === 14) k++;                   // keeps gcd(n,k) == 1
    var step = (TAU_D / n) * k;
    var cx = ctx.w >> 1, cy = ctx.h >> 1;

    this.colorA.step(); this.colorB.step();

    var P = this.pen;
    P.tl = tl; P.surf = ctx.A; P.freezeRamp = false;
    P.rampColor.reset(this.colorA.cur, this.colorB.cur, 1, 3);
    P.brushMode = 3;
    P.clipMaxX = P.surf!.w - P.clipMin;
    P.clipMaxY = P.surf!.h - P.clipMin;
    P.blendAmt = F(0.5);
    P.maxSteps = 50; P.steps = 50; P.amplitude = 50;
    P.envelope = 0; P.loops = 2;
    // source stays 2 (channel average), fold stays true, mirrored stays false

    var th = this.angle;
    var px = cvt(cos(th) * R) + cx, py = cvt(sin(th) * R) + cy;
    for (var i = 0; i <= n; i++) {                   // n+1 edges: the first is drawn twice
      th += step;
      var qx = cvt(cos(th) * R) + cx, qy = cvt(sin(th) * R) + cy;
      P.drawJaggedLine(px, py, qx, qy);
      px = qx; py = qy;
    }
  }
}

// ------------------------------------------------------------- WonderWave
class WonderWave extends A.Effect {
  declare cx: number;
  declare cy: number;
  declare RenderMode: number;
  declare Points: number;
  declare ScaleMode: number;
  declare SinLoops: number;
  declare ScalePct: number;
  declare Spin: number;
  declare SpinMode: number;
  declare BassFlex: boolean;
  declare Mirrored: boolean;
  declare CrossLine: boolean;
  declare CrossMode: number;
  declare pen: Pen;
  declare rotation: number;
  declare crossRotation: number;
  declare colorA: ColorFader;
  declare colorB: ColorFader;

  constructor() {
    super();
    this.name = 'WonderWave';
    this.nameId = 108; this.traceId = 13; this.category = 4;
    this.weight = 1.0; this.prob = 1.0;
    this.cx = 0; this.cy = 0;
    this.RenderMode = 0; this.Points = 2; this.ScaleMode = 0; this.SinLoops = 1;
    this.ScalePct = 0.2; this.Spin = 0.0; this.SpinMode = 0;
    this.BassFlex = false; this.Mirrored = false; this.CrossLine = false; this.CrossMode = 0;
    this.pen = new Pen();                            // Pen (+0x80) precedes the two faders
    this.rotation = 0; this.crossRotation = 0;
    this.colorA = new ColorFader(); this.colorB = new ColorFader();
  }

  setSize(w: number, h: number): void { super.setSize(w, h); this.cx = w >> 1; this.cy = h >> 1; }

  randomize(): void {                                      // 180010860
    this.RenderMode = A.rand() % 3;
    this.Points = A.rand() % 512 + 10;
    var m = 2;                                       // MinOfN(0, 2, 3): biased to 0
    for (var i = 0; i < 3; i++) { var v = A.rand() % 3; if (v < m) m = v; }
    this.ScaleMode = m;
    this.SinLoops = A.rand() % 4 + 1;
    this.ScalePct = (A.rand() / 32767.0) * 0.32499999999999996 + 0.1;
    this.Spin = (A.rand() / 32767.0) * 0.26 - 0.13;
    this.SpinMode = A.rand() % 4;
    this.BassFlex = ((~(A.rand() & 0xff)) & 1) === 1;
    this.Mirrored = A.rand() % 3 === 0;
    this.CrossLine = A.rand() % 3 === 0;
    this.CrossMode = A.rand() % 3;
    this.crossRotation = (A.rand() / 32767.0) * PI_D - PI_2_F;
    this.validate();
  }

  validate(): void {                                       // 1800106a0 (only reachable from randomize)
    this.RenderMode = this.RenderMode > 2 ? 2 : this.RenderMode < 1 ? 0 : this.RenderMode;
    this.Points = this.Points >= 1023 ? 1023 : this.Points < 11 ? 10 : this.Points;
    this.ScalePct = Math.min(0.99, Math.max(0.01, this.ScalePct));
    this.ScaleMode = this.ScaleMode > 2 ? 2 : this.ScaleMode < 1 ? 0 : this.ScaleMode;
    this.SpinMode = this.SpinMode > 3 ? 3 : this.SpinMode < 1 ? 0 : this.SpinMode;
    this.SinLoops = this.SinLoops >= 20 ? 20 : this.SinLoops < 2 ? 1 : this.SinLoops;
    this.pen.mirrored = this.Mirrored;               // the only writer of pen.mirrored
  }

  render(ctx: EffectCtx): void {                                      // 180010120
    this.colorA.step(); this.colorB.step();

    var P = this.pen;
    P.surf = ctx.A; P.tl = ctx.level; P.freezeRamp = false;
    P.rampColor.reset(this.colorB.cur, this.colorA.cur, 1, this.SinLoops * 2);  // B->A (reversed)
    P.brushMode = this.RenderMode;
    P.clipMin = this.RenderMode === 0 ? 0 : this.RenderMode === 1 ? 1 : 9;
    P.clipMaxX = P.surf!.w - P.clipMin;
    P.clipMaxY = P.surf!.h - P.clipMin;
    P.blendAmt = F(0.1);   // 0.1f == 0.10000000149011612
    P.maxSteps = this.Points; P.steps = this.Points;
    // *** The shipped bug: (int)ScalePct * height, truncated BEFORE the multiply -> always 0.
    P.amplitude = (ctx.options && ctx.options.intended)
      ? cvt(this.ScalePct * ctx.h)                   // intended: a real oscilloscope trace
      : cvt(this.ScalePct) * ctx.h;                  // shipped: 0 -> straight diameters
    P.envelope = this.ScaleMode; P.loops = this.SinLoops;

    var len = F(Math.sqrt(ctx.w * ctx.w + ctx.h * ctx.h));
    if (this.BassFlex) len = F(len * F(ctx.bass));

    P.drawDiameter(this.cx, this.cy, F(F(this.rotation) + PI_2_F), len);   // starts vertical

    if (this.CrossLine) {
      var a2: number;
      switch (this.CrossMode) {
        case 0:
          this.crossRotation -= this.Spin * ctx.bass * 0.5;
          a2 = F(this.crossRotation + this.rotation); break;              // counter-rotating
        case 1: a2 = F(this.crossRotation + this.rotation); break;        // fixed offset
        case 2: a2 = F(this.rotation); break;                             // 90 deg behind
        default: a2 = 0.0; break;                                         // unreachable
      }
      P.drawDiameter(this.cx, this.cy, a2, len);
    }

    switch (this.SpinMode) {                          // AFTER drawing
      case 0: this.rotation += ctx.bass * ctx.bass * this.Spin; break;
      case 1: this.rotation += ctx.bass * this.Spin; break;
      case 2: this.rotation += this.Spin; break;
      default: return;                                // 3 = frozen
    }
  }
}

// -------------------------------------------------------------- AtomBalls
class AtomBalls extends A.Effect {
  declare cx: number;
  declare cy: number;
  // BouncePoint (+0x50)
  declare x: number;
  declare y: number;
  declare vx: number;
  declare vy: number;
  declare friction: number;
  declare maxX: number;
  declare maxY: number;
  declare bounced: boolean;
  declare Ball1Radius: number;
  declare Ball2Radius: number;
  declare colorA: ColorFader;
  declare colorB: ColorFader;
  declare invertColors: boolean;
  declare radius: number;
  declare springK: number;
  declare springV: number;
  declare springM: number;
  declare drive: number;
  declare damping: number;
  declare flashFrames: number;
  declare pen: Pen;

  constructor() {
    super();
    this.name = 'AtomBalls';
    this.nameId = 113; this.traceId = 17; this.category = 4;
    this.weight = 0.9; this.prob = 0.9;
    this.cx = 0; this.cy = 0;
    // BouncePoint (+0x50)
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    // 18000fa23/18000fa43: the qword 0x3fe99999a0000000 = (double)(float)0.8 = 0.800000011920929.
    // (0.80000000298023224 here before was a different double, 0x3fe999999b333333: x drifted by
    // ~1e-6 over a ball's life and moved a ball a pixel when x landed on a float .5 boundary.)
    this.friction = F(0.8);                           // never randomised
    this.maxX = 0; this.maxY = 0; this.bounced = false;
    new ColorFader();                                 // dead Plotter at +0x90: 6 rand() draws
    this.Ball1Radius = 0; this.Ball2Radius = 0;        // uninitialised in the DLL (Ball2 dead)
    this.colorA = new ColorFader(); this.colorB = new ColorFader();
    this.invertColors = false;
    this.radius = 0; this.springK = 0; this.springV = 0; this.springM = 1.0;
    this.drive = F(0.8);                              // 18000facb: the same qword as friction; never randomised
    this.damping = 0.5;
    this.flashFrames = 0;
    this.pen = new Pen();
  }

  setSize(w: number, h: number): void {                                     // 18000ae60 -> 180010cc0 -> 18000bf1c
    super.setSize(w, h);
    this.cx = w >> 1; this.cy = h >> 1;
    this.maxX = w; this.maxY = h;
    if (this.x > w) this.x = w >> 1;                  // shrink case only
    if (this.y > h) this.y = h >> 1;
  }

  randomize(): void {                                       // 180010a30 (no Validate)
    // Draw order is x, y, vx, vy, Ball1Radius, damping, Ball2Radius-test — NOT the order of
    // the parameter table in spec 05 §1.9.  Instruction by instruction: 180010a4b rand -> %w
    // -> +0x50, 180010a74 -> %h -> +0x58, 180010a96 -> +0x60, 180010acd -> +0x68,
    // 180010afb -> +0xe0 (and +0x148 = 1.0), 180010b3d -> +0x168 (and +0x158 = 1.0),
    // 180010b75 -> %15 gate on +0xe8.  Verified against the real DLL's rand() call log.
    this.x = this.w > 0 ? A.rand() % this.w : 0;
    this.y = this.h > 0 ? A.rand() % this.h : 0;
    this.vx = (A.rand() / 32767.0) * 4.0 - 2.0;
    this.vy = (A.rand() / 32767.0) * 4.0 - 2.0;
    this.Ball1Radius = (A.rand() / 32767.0) * 21.0 + 9.0;
    this.springK = 1.0; this.springM = 1.0;
    this.damping = (A.rand() / 32767.0) * 0.3999999761581421 + 0.5;
    this.Ball2Radius = (A.rand() % 15 === 0) ? (A.rand() / 32767.0) * 21.0 + 9.0
                                            : this.Ball1Radius;           // dead field
    this.radius = this.Ball1Radius;
    // +0x78/+0x7c = round(Ball1Radius) — written, never read; no rand() involved.
    // Arg-eval order: period is drawn first, then `to`, then `from` (the SECOND RandomRGB
    // supplies `from`/`cur`).
    var pA = A.rand() % 50 + 5, toA = randomRGB(), fromA = randomRGB();
    this.colorA.reset(fromA, toA, pA, 1);
    var pB = A.rand() % 50 + 5, toB = randomRGB(), fromB = randomRGB();
    this.colorB.reset(fromB, toB, pB, 1);
  }

  // 18000b5b4 — position committed before the wall test, never clamped back inside;
  // friction only on axes that stayed in; walls reflect with no damping.
  stepPoint(): void {
    this.x += this.vx; this.y += this.vy;
    this.bounced = false;
    if (this.x < 0.0 || this.x > this.maxX) { this.bounced = true; this.vx = -this.vx; }
    else this.vx *= this.friction;
    if (this.y < 0.0 || this.y > this.maxY) { this.bounced = true; this.vy = -this.vy; }
    else this.vy *= this.friction;
  }

  // 18000fbc4 — the only pixel kernel: signed-depth metric (r*r - dist*dist)/r.
  drawBall(S: Surface, cx: number, cy: number, r: number, alpha: number): void {
    var W = S.w, px = S.px;
    var bodyCol = this.invertColors ? (0xFFFFFF - this.colorA.cur) >>> 0 : this.colorA.cur;
    var haloCol = this.colorB.cur;
    var T = ballTable(r);
    if (T) {                                          // the same pixels, cos() from the radius's table
      var body = T.body, halo = T.halo, m = body.length;
      for (var x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= this.w) continue;
        for (var y = cy - r; y <= cy + r; y++) {
          if (y < 0 || y >= this.h) continue;
          var dx = x - cx, dy = y - cy, q = dx * dx + dy * dy;
          if (q >= m) continue;                       // outside the halo ring: neither branch
          var p = y * W + x, v = px[p], f = body[q], g = halo[q];
          if (f === f) { v = lerp(bodyCol, v, F(f * alpha)); px[p] = v; }
          if (g === g) px[p] = lerp(v, haloCol, g);
        }
      }
      return;
    }
    for (var x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= this.w) continue;             // unsigned compare in the DLL
      for (var y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= this.h) continue;
        var dx = x - cx, dy = y - cy;
        var d = (r * r - (dx * dx + dy * dy)) / r;
        var p = y * W + x, v = px[p];
        if (d >= 1.0) {                               // body: dist^2 <= r^2 - r
          var t = d / r;                              // 1 at centre -> 0 at rim
          var f = cos(t * t * PI_2_F);
          v = lerp(bodyCol, v, F(f * alpha));
          px[p] = v;
        }
        if (d > -3.140000104904175 && d < 3.140000104904175) {   // ~3.14 px halo ring
          var g = (cos(Math.abs(d)) + 1.0) * 0.5;
          px[p] = lerp(v, haloCol, F(g));             // composes on the body result
        }
      }
    }
  }

  render(ctx: EffectCtx): void {                                       // 180010380
    this.stepPoint();
    var amp = ctx.bass;
    if (!this.bounced) {                              // +-bass kicks, independent per axis
      this.vx += ((A.rand() % 2) * 2 - 1) * amp;
      this.vy += ((A.rand() % 2) * 2 - 1) * amp;
    }
    var bx = roundToInt(F(this.x)), by = roundToInt(F(this.y));
    var mx = this.w - bx, my = this.h - by;           // point reflection through the centre
    var alpha = F(amp);

    this.springV += (this.Ball1Radius - this.radius) * this.springK / this.springM;
    this.springV = (this.drive * amp / this.springM + this.springV) * this.damping;
    this.radius += this.springV;
    var R = cvt(this.radius * amp) + 1;

    var f: number, R1: number;
    if (ctx.beat) {                                   // soft beat only; bigBeat is not read
      f = 5; alpha = F(0.4); this.flashFrames = 5; R = R * 2;
      this.invertColors = !this.invertColors;         // a latch, not a pulse
      R1 = R;
    } else {
      f = this.flashFrames;
      R1 = (f !== 0) ? roundToInt(F(F(f / 2.5) * R)) : R;   // x1.6, 1.2, 0.8, 0.4
    }

    if (f !== 0) {                                    // the bolt between the two balls
      var P = this.pen;
      P.surf = ctx.A; P.tl = ctx.level; P.freezeRamp = false;
      P.rampColor.reset(this.colorA.cur, this.colorB.cur, 1, A.rand() % 6 + 1);
      P.brushMode = 1;
      P.clipMin = 1;
      P.clipMaxX = P.surf!.w - 1; P.clipMaxY = P.surf!.h - 1;
      P.maxSteps = 500; P.steps = 500; P.amplitude = 50;
      P.envelope = 0; P.loops = 2;
      P.drawJaggedLine(bx, by, mx, my);
      this.flashFrames--;
    }

    this.drawBall(ctx.A!, bx, by, R1, alpha);
    this.drawBall(ctx.A!, mx, my, R, alpha);           // ball B wins in the overlap
    this.colorA.step(); this.colorB.step();
  }
}

// drawBall's two cos() per pixel depend on r and the pixel's squared distance q alone: tabled per
// radius (body[q] = the body's cos, halo[q] = the halo's F(g); NaN where that branch is not taken),
// every entry the same expression on the same arguments as the loop above. q past r*r + 3.2r is in
// neither. Radii are whole numbers; any other (or r < 1, or a huge one) takes the loop.
interface BallTable { body: Float64Array; halo: Float32Array; }
var BALLS = new Map<number, BallTable>();
function ballTable(r: number): BallTable | null {
  if ((r | 0) !== r || r < 1 || r > 512) return null;
  var T = BALLS.get(r);
  if (T) return T;
  var m = r * r + Math.ceil(3.2 * r) + 1;
  T = { body: new Float64Array(m), halo: new Float32Array(m) };
  for (var q = 0; q < m; q++) {
    var d = (r * r - q) / r;
    if (d >= 1.0) { var t = d / r; T.body[q] = cos(t * t * PI_2_F); } else T.body[q] = NaN;
    T.halo[q] = d > -3.140000104904175 && d < 3.140000104904175 ? F((cos(Math.abs(d)) + 1.0) * 0.5) : NaN;
  }
  BALLS.set(r, T);
  return T;
}

export const Draw = { Pen: Pen, ColorFader: ColorFader, SuperStar: SuperStar,
           WonderWave: WonderWave, AtomBalls: AtomBalls };
A.Draw = Draw;
