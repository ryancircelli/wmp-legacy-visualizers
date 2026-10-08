// Alchemy.Engine — the whole-frame pipeline: surfaces, audio reduction + beat detector,
// the 3-level scheduler (render cycle / 8 slots / per-frame envelope), draw order, Bass Bounce.
// Spec 06 (+ spec 05 §2 for Bass Bounce). Replaces 10-stub-engine.js.
// Wrapped verbatim from src/50-engine.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A, type Surface, type TimedLevel } from './ns';
import type { Effect, EffectCtx } from './effect';
import './rand';
import './effect';
import './shift';
import './draw';
// mpvis.DLL's sin/cos are ucrtbase's (_o_sin/_o_cos -> 0x1800aba70/0x1800a7730): the clones in 00-rand.js.
// (Bass Bounce is the only effect here that needs one of them; cos is unused in this file.)
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sin never reads `this`; hoisted once, not per-call, on purpose (see 00-rand.js)
var sin = A.sin || Math.sin;

var F32 = Math.fround;
// .rdata constants, widened float literals (spec 06 §2)
var M11 = F32(1.1);            // 1.100000023841858
var M12 = F32(1.2);            // 1.2000000476837158
var TAU_F = F32(6.2831855);    // 6.2831854820251465

// ---- the two range helpers (spec 06 §4.1) ----
function a260(lo: number, hi: number): number {         // FUN_18000a260: uniform, INCLUSIVE both ends
  var span = hi - lo + 1, r = A.rand();
  return (span > 0 ? r % span : 0) + lo;
}
function a29c(lo: number, hi: number, n: number): number {   // FUN_18000a29c: minimum of n draws (n<=0 -> hi)
  var best = hi;
  while (n-- > 0) { var v = a260(lo, hi); if (v < best) best = v; }
  return best;
}
function accept(w: number): boolean {                   // 18000a707-a72f: (double)(float)weight >= (double)rand()/32767.0
  return A.rand() / 32767 <= F32(w);    // the quotient stays double (DIVSD, not DIVSS)
}
function rnd01(): number { return A.rand() / 32767; }   // (double)rand()/32767.0
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : (v > hi ? hi : v); }
// 18000734c: exactly 7 UTF-16 units, the first skipped, six hex digits (either case) -> 0xRRGGBB; else 0.
export function parseColor(s: string): number {
  return /^[\s\S][0-9A-Fa-f]{6}$/.test(s) ? parseInt(s.slice(1), 16) : 0;
}

// ---------------------------------------------------------------- Bass Bounce
// Category 7, weight 0.5, nameId 115. FUN_180011200 / Randomize 180011440 / Validate 1800113e0.
// Writes ctx.destRect and nothing else. Retail never reads that rect (spec 05 §2.4); with
// options.intended the engine applies it at present time as a SOURCE sub-rect zoom-in.
class BassBounce extends A.Effect {
  declare bassJump: number;
  declare hover: number;
  declare bounceFrame: number;
  declare zoom: number;
  declare frameCount: number;
  constructor() {
    super();
    this.name = 'Bass Bounce'; this.nameId = 115;
    this.category = 7; this.weight = 0.5; this.traceId = 6;
    this.bassJump = 0.19; this.hover = 0.125;   // ctor leaves these uninit; pick mid-range
    this.bounceFrame = 40;                      // ctor default 0x28
    this.zoom = 1.0; this.frameCount = 0;
  }
  randomize(): void {
    this.bassJump = rnd01() * 0.12 + 0.13;                  // [0.13, 0.25]
    this.hover = rnd01() * 0.15000000000000002 + 0.05;      // [0.05, 0.20]
    this.bounceFrame = a260(25, 55);
    // Validate (vt+0x58) always runs after Randomize
    this.bassJump = clamp(this.bassJump, 0.01, 0.99);
    this.hover = clamp(this.hover, 0.01, 0.99);
    this.bounceFrame = this.bounceFrame >= 500 ? 500 : (this.bounceFrame <= 5 ? 5 : this.bounceFrame);
    this.zoom = 1.0; this.frameCount = 0;                   // every reroll restarts the hover
  }
  render(ctx: EffectCtx): void {
    if (ctx.bigBeat && this.state !== 2) {   // snap hard in; skipped while fading out
      this.frameCount = 0;
      this.zoom = F32(this.bassJump);
    }
    var w1 = 1.0, w15 = 15.0;
    var bf = this.bounceFrame;
    var t = bf > 0 ? this.frameCount % bf : 0;
    var hv = F32(this.hover);
    var target = F32(F32(sin(F32(F32(t) / F32(bf)) * TAU_F)) * hv + F32(1 - hv));
    if (this.state === 2) {                  // fade out: weights morph (1,15) -> (16,0), target -> 1
      var g = F32(1 - F32(F32(this.stateFrames) / F32(this.transitionLen)));
      w15 = F32(g * 15);
      target = F32(F32(g * target) + F32(1 - g));
      w1 = F32(16 - w15);
    }
    this.zoom = F32(F32(F32(target * w1) + F32(w15 * this.zoom)) * 0.0625);   // 1/16 one-pole IIR
    if (this.zoom > 1) this.zoom = 1;
    this.frameCount++;
    // (int)((float)dim - (float)dim*zoom) / 2 — truncate, then signed /2
    var left = (((F32(this.w) - F32(F32(this.w) * this.zoom)) | 0) / 2) | 0;
    var top = (((F32(this.h) - F32(F32(this.h) * this.zoom)) | 0) / 2) | 0;
    var r = ctx.destRect;
    r.left = left; r.right = this.w - left;
    r.top = top; r.bottom = this.h - top;
  }
}

// ---------------------------------------------------------------- pool & slots
interface PoolDesc { name: string; cat: number; weight: number; traceId: number; path: string[] | null; }
// Registration order is load-bearing: the reroll's index draws walk this array (spec 06 §4.4).
var POOL: PoolDesc[] = [
  { name: 'Shift',       cat: 3, weight: 1.0, traceId: 9,  path: ['Shift'] },
  { name: 'Blur',        cat: 2, weight: 1.0, traceId: 7,  path: null },   // dead: no slot has cat 2
  { name: 'SwitchBlur',  cat: 2, weight: 0.2, traceId: 8,  path: null },   // dead
  { name: 'WonderWave',  cat: 4, weight: 1.0, traceId: 13, path: ['Draw', 'WonderWave'] },
  { name: 'SuperStar',   cat: 4, weight: 0.5, traceId: 12, path: ['Draw', 'SuperStar'] },
  { name: 'Bass Bounce', cat: 7, weight: 0.5, traceId: 6,  path: null },   // BassBounce, below
  { name: 'AtomBalls',   cat: 4, weight: 0.9, traceId: 17, path: ['Draw', 'AtomBalls'] }
];

// [category, minCount, maxCount, minDur, maxDur, flags] — construction == per-frame draw order.
var SLOTS: number[][] = [
  [3, 1, 1,  90, 500, 0],   // 1  Shift
  [4, 1, 2,  50, 350, 2],   // 2  one drawing effect
  [6, 0, 1,  30, 500, 1],   // 3  dead (no effect has category 6)
  [5, 0, 4,  30, 500, 1],   // 4  dead (category 5 lives inside Shift, not the pool)
  [6, 0, 1,  30, 500, 1],   // 5  dead
  [4, 1, 3,  50, 350, 2],   // 6  one more drawing effect
  [5, 0, 2,  30, 500, 1],   // 7  dead
  [7, 0, 1,  50, 400, 1]    // 8  Bass Bounce
];

var CYCLE_MIN = 1500, CYCLE_MAX = 7500, CYCLE_WEIGHT = 1.0;

function resolve(path: string[]): (new () => Effect) | null {
  var o: unknown = A;
  for (var i = 0; i < path.length; i++) { o = o && (o as Record<string, unknown>)[path[i]]; }
  return typeof o === 'function' ? (o as unknown as new () => Effect) : null;
}

function makeEffect(desc: PoolDesc): Effect {
  var e: Effect;
  if (desc.name === 'Bass Bounce') e = new BassBounce();
  else {
    var Ctor = desc.path && resolve(desc.path);
    e = Ctor ? new Ctor() : new A.Effect();      // no-op placeholder so the engine runs alone
    e.name = desc.name;
  }
  e.category = desc.cat;      // pool table is authoritative (+0x48)
  e.weight = desc.weight;     // registration argument, not the effect's own choice
  e.traceId = desc.traceId;
  return e;
}

// ---------------------------------------------------------------- engine
export interface EngineOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
}

export interface EngineConfig {
  width?: number;
  height?: number;
  options?: Partial<EngineOptions>;
}

interface Slot {
  index: number; category: number; minCount: number; maxCount: number;
  minDur: number; maxDur: number; flags: number; bias: number;
  active: Effect[]; framesLeft: number;
}
interface Cycle { minFrames: number; maxFrames: number; weight: number; slots: Slot[]; }

class Engine {
  declare options: EngineOptions;
  declare pool: Effect[];
  declare cycle: Cycle;
  declare cycleFramesLeft: number;
  declare cycleLen: number;
  declare ctx: EffectCtx;
  declare bassMean: number;
  declare A: Surface;
  declare B: Surface;
  declare C: Surface;
  declare presentSurface: Surface | null;
  declare w: number;
  declare h: number;
  declare last: Surface;
  declare allocated: boolean;

  constructor(cfg?: EngineConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);

    // 180006a22 builds the pool+slots, and only THEN 180006a8b/180006a93 do
    // srand(_time64(0)).  So every effect's ColorFaders are drawn from the CRT's
    // start-of-process state (MSVC seed 1), and the time seed governs the scheduler
    // from the first frame onwards.  Seeding before the pool build desynchronises
    // the whole stream by ~90 draws.
    A.srand(1);                           // CRT default state at CoCreateInstance time
    this.pool = POOL.map(makeEffect);
    A.srand((Date.now() / 1000) | 0);     // 180006a93 _o_srand(_time64(0))
    this.cycle = {
      minFrames: CYCLE_MIN, maxFrames: CYCLE_MAX, weight: CYCLE_WEIGHT,
      slots: SLOTS.map(function (s, i): Slot {
        return {
          index: i + 1, category: s[0], minCount: s[1], maxCount: s[2],
          minDur: s[3], maxDur: s[4], flags: s[5],
          bias: (s[5] & 2) ? 10 : ((s[5] & 1) * 2 | 1),
          active: [], framesLeft: 0
        };
      })
    };
    this.cycleFramesLeft = 0;     // 0 -> frame 1 draws the cycle and rerolls every slot
    this.cycleLen = 0;

    this.ctx = {
      level: null, frame: 0,
      beat: false, bigBeat: false, framesSinceBeat: 0, framesSinceBigBeat: 0,
      bass: 0, bassDelta: 0,
      w: 0, h: 0,
      A: null, B: null, C: null, target: null, surfaces: null,
      bgColor: this.options.backgroundColor | 0,
      destRect: { left: 0, top: 0, right: 0, bottom: 0 },
      bassHistory: new Float64Array(30), bassIdx: 0,
      resized: true,            // ctx+0x10 inits to 1
      paused: false,            // ctx+0x11: nothing in the DLL ever sets it
      useAltRender: false,      // ctx+0x3a: likewise never set, so altRender() is unreachable
      newAudio: false,          // v1 contract alias; unused
      options: this.options as unknown as EffectCtx['options']
    };
    this.bassMean = 0;

    this.resize(cfg.width || 320, cfg.height || 240);
    this.allocated = false;     // the DLL allocates (and fills) its surfaces in the first Render
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  // ---- the scriptable IToleranceVis (vtable 0x180020230), as WMP's SynchEffectColor script drives it ----
  // put_foregroundColor and put_backgroundColor are ONE function (180009550: the two identical bodies were
  // folded), and SetProperty("BackgroundColor", BSTR) (180009300) writes the same field: each parses
  // "#RRGGBB" (18000734c) into CVisual+0xde0, the BackgroundColor. Nothing else reads a foreground colour.
  // The colour reaches the surfaces when they are allocated (the first Render; a later call does not
  // repaint them) and rows 0 and H-1 every frame (Shift's border fill). WMP 12 Now Playing sets
  // foregroundColor = "#A4EB0C", then SetProperty("BackgroundColor", "#000000"): black, the default.
  setColor(s: string): void {
    this.options.backgroundColor = parseColor(s);
    if (!this.allocated) this.resize(this.w, this.h);
  }
  setProperty(name: string, value: unknown): void {      // _wcsicmp, VT_BSTR only
    if (name.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'backgroundcolor' && typeof value === 'string') this.setColor(value);
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    var bg = this.options.backgroundColor | 0;
    // FUN_1800126e0 fills each surface with BackgroundColor at ALLOCATION only, not per frame.
    this.A = A.makeSurface(this.w, this.h, bg);
    this.B = A.makeSurface(this.w, this.h, bg);
    this.C = A.makeSurface(this.w, this.h, bg);   // allocated, locked, never read or written
    this.presentSurface = null;
    var c = this.ctx;
    c.w = this.w; c.h = this.h;
    c.A = this.A; c.B = this.B; c.C = this.C;
    c.target = this.A;
    c.surfaces = [this.A, this.B, this.C];
    c.resized = true;           // pushes SetSize into the pool on the next played frame
    this.last = this.A;
  }

  // ---- audio reduction, FUN_18000ac48 (spec 06 §2) ----
  analyseAudio(L: TimedLevel): void {
    var c = this.ctx;
    c.frame++;                                        // +0x14, written and never read by the DLL
    c.destRect.left = c.destRect.top = c.destRect.right = c.destRect.bottom = 0;  // SetRectEmpty
    c.level = L;

    var f0 = L.freq[0], f1 = L.freq[1];
    var bass = (f0[1] + f0[3] + f0[5] + f1[2] + f1[4] + f1[6]) / 1200.0;
    c.bass = bass;
    c.bassHistory[c.bassIdx] = bass;

    c.framesSinceBeat++;
    c.bigBeat = false; c.beat = false;                // one 16-bit clear of both flags
    c.framesSinceBigBeat++;
    c.bassIdx = (c.bassIdx + 1) % 30;                 // write-then-advance

    var sum = 0;
    for (var i = 0; i < 30; i++) sum += c.bassHistory[i];
    var mean = sum / 30.0;                            // hard /30, ring is zero-initialised
    this.bassMean = mean;
    c.bassDelta = bass - mean;

    if (c.framesSinceBeat > 9 && mean * M11 < bass) {
      c.beat = true; c.framesSinceBeat = 0;
      if (bass > 0.9 && mean * M12 < bass && c.framesSinceBigBeat > 20) {
        c.bigBeat = true; c.framesSinceBigBeat = 0;
      }
    }
  }

  // ---- level 2: per-slot reroll, FUN_18000a624 (spec 06 §4.2) ----
  reroll(slot: Slot): void {
    var i;
    for (i = 0; i < slot.active.length; i++) slot.active[i].chosen = false;  // only THIS slot's claims
    slot.active.length = 0;

    var want = a29c(slot.minCount, slot.maxCount, slot.bias);
    slot.framesLeft = a260(slot.minDur, slot.maxDur);

    var poolCount = this.pool.length;
    var attempts = 100;
    var intended = !!this.options.intended;
    while (want > 0 && attempts > 0) {
      attempts--;
      // 93 uniform draws, then a deterministic descending sweep 6..0 — so minCount is satisfiable
      var k = (attempts >= poolCount) ? a260(0, poolCount - 1) : attempts;
      var e = this.pool[k];
      if (e.category === slot.category && !e.chosen && accept(e.weight)) {
        slot.active.push(e);
        e.randomize();                 // slot+0x34 is never 1, so hardInit never runs
        e.state = 1; e.stateFrames = 0;
        var t = (slot.framesLeft / 3) | 0;
        var r1 = a260(10, 90);
        // The shipped bug: when r1 < t it throws r1 away and draws a FRESH uniform[10,90]
        // that may exceed t. options.intended repairs it to the obvious min().
        e.transitionLen = intended ? (r1 < t ? r1 : t)
                                   : (r1 < t ? a260(10, 90) : t);
        e.chosen = true;
        want--;
      }
    }
  }

  // ---- level 3: per-slot per-frame, FUN_18000a4f4 (spec 06 §5) ----
  tickSlot(slot: Slot): void {
    var c = this.ctx;
    if (!c.paused) slot.framesLeft--;
    if (slot.framesLeft < 1) this.reroll(slot);

    for (var i = 0; i < slot.active.length; i++) {
      var e = slot.active[i];
      if (e.hasAlt && c.useAltRender) e.altRender(c); else e.render(c);

      if (e.state === 1) {                        // fading in
        var n = e.stateFrames++;                  // pre-increment value is what gets tested
        if (e.transitionLen <= n) { e.state = 0; e.stateFrames = 0; }
      } else if (e.state === 0) {                 // steady; stateFrames stays pinned at 0
        if (slot.framesLeft <= e.transitionLen) e.state = 2;   // arm fade-out for NEXT frame
      } else {
        e.stateFrames++;                          // fading out
      }
    }
  }

  // ---- level 1: render-cycle selection, FUN_18000a394 (spec 06 §3) ----
  tickScheduler(): void {
    var c = this.ctx, i;
    if (c.resized) {
      for (i = 0; i < this.pool.length; i++) this.pool[i].setSize(c.w, c.h);
    }
    if (!c.paused) this.cycleFramesLeft--;
    if (this.cycleFramesLeft < 1) {
      do { A.rand(); } while (((this.cycle.weight * 1000.0) | 0) < A.rand() % 1000);   // weight 1.0 never rejects
      // the one max-EXCLUSIVE range in the DLL: 1500 .. 7499
      this.cycleLen = CYCLE_MIN + A.rand() % (CYCLE_MAX - CYCLE_MIN);
      this.cycleFramesLeft = this.cycleLen;
    }
    var slots = this.cycle.slots;
    for (i = 0; i < slots.length; i++) this.tickSlot(slots[i]);
  }

  // ---- present ----
  // Retail: StretchBlt of the whole of A, source rect ignored (spec 06 §1, spec 05 §2.4).
  // options.intended: apply destRect as a SOURCE sub-rect (zoom IN), nearest neighbour, once per
  // frame, non-cumulative, into a separate surface so A is never touched.
  presentFrame(): Surface {
    if (!this.options.intended) return (this.last = this.A);
    var r = this.ctx.destRect, w = this.w, h = this.h;
    var sw = r.right - r.left, sh = r.bottom - r.top;
    if (sw <= 0 || sh <= 0 || (sw >= w && sh >= h)) return (this.last = this.A);
    if (!this.presentSurface) this.presentSurface = A.makeSurface(w, h, this.options.backgroundColor | 0);
    var src = this.A.px, dst = this.presentSurface.px, i = 0;
    for (var y = 0; y < h; y++) {
      var row = (r.top + ((y * sh / h) | 0)) * w;
      for (var x = 0; x < w; x++, i++) dst[i] = src[row + r.left + ((x * sw / w) | 0)];
    }
    return (this.last = this.presentSurface);
  }

  // ---- one WMP Render() ----
  render(L: TimedLevel): Surface | null {
    this.allocated = true;      // Render allocates the surfaces whatever the state (spec 06 §1 step 2)
    // state != 2: RenderEffect is skipped entirely — audio ring, both beat counters, the cycle
    // countdown and all eight slot countdowns freeze, and the stale image is presented again.
    if (!L || L.state !== 2) return this.last;

    this.analyseAudio(L);
    this.ctx.bgColor = this.options.backgroundColor | 0;    // 4-byte copy, every frame
    this.tickScheduler();
    this.ctx.level = null;
    this.ctx.resized = false;
    return this.presentFrame();
  }

  debug() {
    var c = this.ctx;
    var shift = this.cycle.slots[0].active[0] as (Effect & { activeKernelCount?: () => number }) | undefined;
    var bb = this.pool[5] as BassBounce;
    return {
      cycleFrame: this.cycleLen - this.cycleFramesLeft,
      cycleLen: this.cycleLen,
      slots: this.cycle.slots.map(function (s) {
        var e = s.active[0] || null;
        return {
          index: s.index, category: s.category,
          effectName: s.active.map(function (x) { return x.name; }).join('+') || null,
          framesLeft: s.framesLeft,
          state: e ? e.state : null,
          stateFrames: e ? e.stateFrames : null,
          transitionLen: e ? e.transitionLen : null
        };
      }),
      activeWarps: (shift && typeof shift.activeKernelCount === 'function') ? shift.activeKernelCount() : 0,
      bass: c.bass, bassMean: this.bassMean,
      beat: c.beat, bigBeat: c.bigBeat,
      frame: c.frame,
      zoom: bb.zoom
    };
  }
}

A.Engine = Engine;
export { Engine };
