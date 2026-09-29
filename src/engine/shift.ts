// Alchemy.Shift — the warp container (category 3, slot 1). Specs 01 + 02.
// 18000c62c ctor, 18000d8b0 Render, 18000dc80 driver, 18000d940 ShiftMoveBits,
// 18000cd20 build-3-rows, 18000d354 full build, 18000ca2c stepper,
// 18000d4f0 promote/pick (vt+0x20), 18000db10 Randomize (vt+0x28), 18000db4c pick.
// Wrapped verbatim from src/20-shift.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from './ns';
import './rand';
import './effect';
import './kernels';
import { moveBitsWasm, newArena, type Arena } from './movebits';
import type { WarpKernel, WarpPoint, EffectCtx } from './effect';
import type { Surface } from './ns';
// mpvis.DLL's sin/cos are ucrtbase's (_o_sin/_o_cos -> 0x1800aba70/0x1800a7730): the clones in 00-rand.js.
// eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars -- A.sin/A.cos never read `this`, hoisted once on purpose (see 00-rand.js); cos is verbatim from the DLL wrapper and genuinely unused here
var sin = A.sin || Math.sin, cos = A.cos || Math.cos;

const MAX_DIM = 0x2711;          // 18000cb44 refuses any dimension >= 10001
const NLADDER = 22;              // transTab[0..21] = fractions 1/23 .. 22/23
const INV23 = Math.fround(0.04347826);
// (double)(float)(pi/2) — very slightly above pi/2, which is why the sine branch
// of 18000ca2c can never emit step 22 (spec 01 §2.6).
const SIN_K_BUG = 1.5707963705062866;
const RB = 0x00FF00FF;           // R and B fields, 16 bits apart
const GM = 0x0000FF00;

// WarpTable (0x30 bytes: buf / dirty / cursorY). 18000c750 / cb44 / d7cc.
interface WarpTable {
  buf: Int32Array | null;
  dirty: boolean;
  cursorY: number;
  slot: number;          // its place in the arena (surfaces A, B are slots 0, 1)
}

// 18000a260 / 18000a29c
function a260(lo: number, hi: number): number { return lo + A.rand() % (hi - lo + 1); }
function a29c(lo: number, hi: number, n: number): number {
  let m = a260(lo, hi);
  for (let i = 1; i < n; i++) { const v = a260(lo, hi); if (v < m) m = v; }
  return m;
}

// ShiftMoveBits' blur, one output pixel: m = avg of the 4 neighbours (per channel, truncating),
// out = (3m + centre) / 4 (truncating); R and B share one 32-bit lane pair, G has its own.
// The rows are computed as the DLL's single linear pass over i = W .. (H-1)*W-1 is: rows 1..H-2,
// with x = 0 reading the previous row's last pixel and x = W-1 the next row's first. dst is only
// read, so each tap is loaded once and carried in locals (already masked) to the pixels that
// share it: a pixel's left/centre are the previous pixel's centre/right, and in a row pair the
// upper row's centre is the lower row's up tap and vice versa. Same ops, same order, same pixels.
function blurRow(src: Uint32Array, dst: Uint32Array, W: number, i: number) {
  const e = i + W;
  let lRB = dst[i - 1] & RB, lGM = dst[i - 1] & GM, cRB = dst[i] & RB, cGM = dst[i] & GM;
  for (; i < e; i++) {
    const a = dst[i - W], b = dst[i + W], r = dst[i + 1];
    const rRB = r & RB, rGM = r & GM;
    const m1 = ((((a & RB) + (b & RB) + lRB + rRB) >>> 2) & RB);
    const m2 = ((((a & GM) + (b & GM) + lGM + rGM) >>> 2) & GM);
    src[i] = ((((m1 * 3 + cRB) >>> 2) & RB) | (((m2 * 3 + cGM) >>> 2) & GM));
    lRB = cRB; lGM = cGM; cRB = rRB; cGM = rGM;
  }
}
function blurRowPair(src: Uint32Array, dst: Uint32Array, W: number, i: number) {   // rows i/W and i/W + 1
  const e = i + W;
  let p = dst[i - 1], q = dst[i];
  let ulRB = p & RB, ulGM = p & GM, ucRB = q & RB, ucGM = q & GM;         // upper row: left, centre
  p = dst[i + W - 1]; q = dst[i + W];
  let vlRB = p & RB, vlGM = p & GM, vcRB = q & RB, vcGM = q & GM;         // lower row: left, centre
  for (; i < e; i++) {
    const a = dst[i - W], d = dst[i + 2 * W], ur = dst[i + 1], vr = dst[i + W + 1];
    const urRB = ur & RB, urGM = ur & GM, vrRB = vr & RB, vrGM = vr & GM;
    let m1 = ((((a & RB) + vcRB + ulRB + urRB) >>> 2) & RB);
    let m2 = ((((a & GM) + vcGM + ulGM + urGM) >>> 2) & GM);
    src[i] = ((((m1 * 3 + ucRB) >>> 2) & RB) | (((m2 * 3 + ucGM) >>> 2) & GM));
    m1 = (((ucRB + (d & RB) + vlRB + vrRB) >>> 2) & RB);
    m2 = (((ucGM + (d & GM) + vlGM + vrGM) >>> 2) & GM);
    src[i + W] = ((((m1 * 3 + vcRB) >>> 2) & RB) | (((m2 * 3 + vcGM) >>> 2) & GM));
    ulRB = ucRB; ulGM = ucGM; ucRB = urRB; ucGM = urGM;
    vlRB = vcRB; vlGM = vcGM; vcRB = vrRB; vcGM = vrGM;
  }
}

function adopt<T extends Uint32Array | Int32Array>(to: T, from: T): T { to.set(from); return to; }
function newTable(slot: number): WarpTable { return { buf: null, dirty: true, cursorY: 0, slot }; }
function tabAlloc(t: WarpTable, w: number, h: number, ar: Arena | null) {
  if (w >= MAX_DIM || h >= MAX_DIM) return;   // 18000cb44 bails before touching anything
  t.buf = ar && ar.n === w * h ? ar.i32(t.slot).fill(0) : new Int32Array(w * h);
  t.cursorY = 0; t.dirty = true;
}
function tabFree(t: WarpTable) { t.buf = null; t.cursorY = 0; t.dirty = true; }

export class Shift extends A.Effect {
  declare TransitionMode: number;
  declare TransitionTime: number;
  declare pool: WarpKernel[];
  declare F1: WarpKernel | null;
  declare F2: WarpKernel | null;
  declare F1next: WarpKernel | null;
  declare F2next: WarpKernel | null;
  declare _tabA: WarpTable;
  declare _tabB: WarpTable;
  declare front: WarpTable;
  declare back: WarpTable;
  declare trans: WarpTable[];
  declare allowTransition: boolean;
  declare transitionActive: boolean;
  declare transIdx: number;
  declare transFrame: number;
  declare rowOff: Int32Array | null;
  declare ramp: Int16Array[] | null;
  declare _rampHalf: number;
  declare _intended: boolean;
  declare _p: WarpPoint;
  declare _cur: (Int32Array | null)[];
  declare _arena: Arena | null;
  constructor() {
    super();
    this.name = 'Shift';
    this.nameId = 103; this.traceId = 9; this.category = 3;
    this.weight = 1.0; this.prob = 1.0;

    this.TransitionMode = 0;      // +0x50
    this.TransitionTime = 1;      // +0x54
    this.pool = (A.Kernels && A.Kernels.makePool) ? A.Kernels.makePool() : [];

    this.F1 = null; this.F2 = null;        // +0x70 / +0x78 live kernels
    this.F1next = null; this.F2next = null; // +0x80 / +0x88 pending kernels

    this._tabA = newTable(2); this._tabB = newTable(3);
    this.front = this._tabA;    // +0x510 rendered from
    this.back = this._tabB;     // +0x518 being built
    this.trans = new Array<WarpTable>(NLADDER);
    for (let k = 0; k < NLADDER; k++) this.trans[k] = newTable(4 + k);

    this.allowTransition = true;  // +0x520, always 1 in retail
    this.transitionActive = false; // +0x521
    this.transIdx = 0;            // +0x524
    this.transFrame = 0;          // +0x528
    this.rowOff = null;           // +0x530
    this.ramp = null;             // +0x538, 22 x 2*rampHalf shorts
    this._rampHalf = 0;
    this._intended = false;

    this._p = { x: 0, y: 0 };                 // the one point object; no per-pixel alloc
    this._cur = new Array<Int32Array | null>(NLADDER);   // scratch: ladder buffers for the build
    this._arena = null;                       // A.px, B.px and every table, resident for the kernel
  }

  // ---- 18000ae60 SetSize -> 18000dbd0 Init ---------------------------------
  // The side tables depend on ctx.options.intended (the ramp overrun), which is not
  // known here, so the allocation half of Init is deferred to the first render
  // (18000dc80 already does it when front->buf == NULL).
  activeKernelCount() { return (this.F1 ? 1 : 0) + (this.F2 ? 1 : 0); }
  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    for (let i = 0; i < this.pool.length; i++) this.pool[i].setSize(w, h);
    tabFree(this._tabA); tabFree(this._tabB);
    for (let k = 0; k < NLADDER; k++) tabFree(this.trans[k]);
    this.rowOff = null; this.ramp = null;
    this._arena = null;
  }

  _init(intended: boolean) {
    const W = this.w, H = this.h;
    this.rowOff = new Int32Array(H + 1);
    for (let y = 0; y <= H; y++) this.rowOff[y] = y * W;
    this._buildRamps(intended);
    tabAlloc(this._tabA, W, H, this._arena);
    tabAlloc(this._tabB, W, H, this._arena);
    for (let k = 0; k < NLADDER; k++) tabFree(this.trans[k]);
  }

  // ramp[k][half + d] = (short)trunc((double)d * (double)(float)((k+1) * (1/23f))).
  // 18000cbdc builds the step ONCE per ladder rung in float (18000cc99 CVTDQ2PS,
  // 18000cca7 MULSS [0x180023608]=0.043478261679410934f, 18000ccaf CVTPS2PD) and then
  // does the per-entry multiply in DOUBLE (18000ccca MULSD, 18000ccce CVTTSD2SI).
  // Multiplying d by (k+1) in float first and only then by 1/23 rounds differently and
  // disagrees on 324 of the 22*2*W entries by 1 px.
  // The DLL sizes these 2*W and indexes them with a *row* delta too, which overruns
  // on a portrait surface (spec 01 §2.5). intended: size them 2*max(W,H) instead.
  _buildRamps(intended: boolean) {
    const W = this.w, H = this.h;
    const half = intended ? (W > H ? W : H) : W;
    this._rampHalf = half;
    this._intended = intended;
    this.ramp = new Array<Int16Array>(NLADDER);
    for (let k = 0; k < NLADDER; k++) {
      const r = new Int16Array(2 * half);
      const step = Math.fround(Math.fround(k + 1) * INV23);   // float, then widened
      for (let i = 0; i < 2 * half; i++) r[i] = Math.trunc((i - half) * step);
      this.ramp[k] = r;
    }
  }

  // ---- 18000db4c pick ------------------------------------------------------
  _pick(): WarpKernel | null {
    const pool = this.pool, n = pool.length;
    if (n === 0) return null;
    let e: WarpKernel | null = null;
    for (let tries = 100; ; tries--) {
      e = pool[a260(0, n - 1)];
      if (tries < 1) { if (e.chosen) return null; break; }
      if (!e.chosen) break;
    }
    e.chosen = true;
    e.randomize();
    return e;
  }

  // ---- 18000d4f0 (vtable +0x20), always entered with arg 0 -----------------
  hardInit(ctx: EffectCtx) { this._hardInit(); }

  _hardInit() {
    this.transitionActive = false;
    if (this.F1next) {
      this.transitionActive = this.allowTransition;
      this.transIdx = 0; this.transFrame = 0;
      if (this.back.dirty) {
        // preparation outran the slot: hard cut, finish the rows synchronously
        this.transitionActive = false;
        this._buildAll(this.back, this.F1next, this.F2next);
      }
      this.TransitionMode = a29c(0, 2, 3);          // P(0)=19/27 P(1)=7/27 P(2)=1/27
      if (A.rand() % 3 === 0) this.TransitionTime = A.rand() % 15 + 1;   // 1..15
      else this.TransitionTime = A.rand() % 5 + 10;                      // 10..14
      if (this.transitionActive &&
          ((this.F1 && this.F1.instantTransition) || (this.F2 && this.F2.instantTransition) ||
           (this.F1next && this.F1next.instantTransition) ||
           (this.F2next && this.F2next.instantTransition))) {
        this.TransitionTime = 1;                   // a Shift O' Scope is involved
      }
      const t = this.front; this.front = this.back; this.back = t;   // PROMOTION
      if (this.F1) this.F1.chosen = false;
      if (this.F2) this.F2.chosen = false;
      this.F1 = this.F1next; this.F2 = this.F2next;
      this.F1next = null; this.F2next = null;
    }
    this.back.dirty = true; this.back.cursorY = 0;
    this.F1next = this._pick();
    if (A.rand() % 5 === 0 && this.F1next) {       // p = 6554/32768
      this.F2next = this._pick();
      // the DLL dereferences F2next unconditionally here (spec 02 §11.4); guarded.
      if (!this.F1next.chainable || !this.F2next || !this.F2next.chainable) {
        if (this.F2next) this.F2next.chosen = false;
        this.F2next = null;
      }
    }
    if (!this.F1) {                                // very first call only
      this.F1 = this._pick();
      this.front.dirty = true; this.front.cursorY = 0;
    }
  }

  // ---- 18000db10 (vtable +0x28) — the scheduler's reroll -------------------
  randomize() {
    if (this.transitionActive) return;             // dropped
    if (this.back && this.back.dirty) return;      // dropped: build unfinished
    this._hardInit();
  }

  // ---- the Map2 driver contract (identical in d354 and cd20) ---------------
  // Result lands in this._p. Unsigned range test, per-axis recovery, then the
  // average-with-identity that halves a chained pair's displacement.
  _map2(F1: WarpKernel, F2: WarpKernel | null, dx: number, dy: number) {
    const p = this._p;
    p.x = dx; p.y = dy;
    F1.map(p);
    if ((p.x >>> 0) >= (F1.w >>> 0)) p.x = F1.identityFallback ? dx : F1.fallbackX;
    if ((p.y >>> 0) >= (F1.h >>> 0)) p.y = F1.identityFallback ? dy : F1.fallbackY;
    if (F2) {
      const ax = p.x, ay = p.y;
      F2.map(p);
      if ((p.x >>> 0) >= (F2.w >>> 0)) p.x = F2.identityFallback ? ax : F2.fallbackX;
      if ((p.y >>> 0) >= (F2.h >>> 0)) p.y = F2.identityFallback ? ay : F2.fallbackY;
      p.x = (p.x + dx) >> 1;
      p.y = (p.y + dy) >> 1;
    }
  }

  // ---- 18000d354 — full (resumable, in practice one-shot) build ------------
  _buildAll(t: WarpTable, F1: WarpKernel | null, F2: WarpKernel | null) {
    if (!t.buf || !this.rowOff || !F1) return;
    const W = this.w, H = this.h, rowOff = this.rowOff, buf = t.buf, p = this._p;
    let y = t.cursorY, o = rowOff[y];
    while (y < H) {
      for (let x = 0; x < W; x++) {
        this._map2(F1, F2, x, y);
        buf[o++] = rowOff[p.y | 0] + (p.x | 0);
      }
      y++;
    }
    t.cursorY = y;
    t.dirty = false;
  }

  // ---- 18000cd20 ShiftBackgroundBuild: exactly 3 scanlines per call --------
  _build3() {
    const back = this.back, front = this.front;
    if (!back.buf || !back.dirty || !this.rowOff) return;
    const W = this.w, H = this.h, rowOff = this.rowOff;
    const dst = back.buf, old = front.buf;
    const F1 = this.F1next, F2 = this.F2next;
    if (!F1) return;

    let ladder = !!(this.trans[0].buf && old);
    const cur = this._cur;
    if (ladder) {
      for (let k = 0; k < NLADDER; k++) {
        const b = this.trans[k].buf;
        if (!b) { ladder = false; break; }
        cur[k] = b;
      }
    }
    const ramp = this.ramp!, half = this._rampHalf, p = this._p;
    let y = back.cursorY;
    for (let pass = 0; pass < 3; pass++) {
      if (y === H) { back.dirty = false; break; }
      let o = rowOff[y];
      for (let x = 0; x < W; x++, o++) {
        this._map2(F1, F2, x, y);
        const sx = p.x | 0, sy = p.y | 0;
        dst[o] = rowOff[sy] + sx;
        if (ladder) {
          const s = old![o] >>> 0;
          const ox = W > 0 ? s % W : 0;
          const oy = (s / W) | 0;                 // unsigned divide
          const iY = half + (sy - oy), iX = half + (sx - ox);
          for (let k = 0; k < NLADDER; k++) {
            const r = ramp[k];
            // `| 0` keeps an out-of-range ramp read (the portrait bug) from
            // poisoning the table with NaN; it degrades to "no displacement".
            cur[k]![o] = rowOff[oy + (r[iY] | 0)] + ox + (r[iX] | 0);
          }
        }
      }
      y++;
    }
    back.cursorY = y;
  }

  // ---- 18000ca2c — transition index advance --------------------------------
  _advance(intended: boolean): boolean {
    if (!this.transitionActive) return false;
    const TT = this.TransitionTime;
    switch (this.TransitionMode) {
      case 0: {
        const c = this.transFrame++;
        const total = TT * 22;
        if (total < c) this.transIdx = 22;
        else {
          const v = sin(((c + 1) / total) * (intended ? Math.PI / 2 : SIN_K_BUG));
          this.transIdx = Math.max(0, Math.trunc(v * 22) | 0);
        }
        break;
      }
      case 1: {
        const c = this.transFrame++;
        if (!(TT > 0 && (c % TT) !== 0)) this.transIdx++;
        break;
      }
      case 2: {
        const r = A.rand();
        if (!(TT > 0 && (r % TT) !== 0)) this.transIdx++;
        break;
      }
      default: break;                              // >= 3 never advances
    }
    if (this.transIdx < NLADDER && this.trans[this.transIdx].buf) return true;
    this.transitionActive = false;
    return false;
  }

  // ---- 18000dc80 — per-frame driver, returns the table to render from ------
  _driver(ctx: EffectCtx, intended: boolean): WarpTable {
    this.allowTransition = true;                   // = (ctx->[0x38] == 0)
    if (!this.front.buf) this._init(intended);
    else if (this._intended !== intended) this._buildRamps(intended);

    if (this.front.dirty === false || !this.F1) {
      if (this.transitionActive && this._advance(intended)) {
        return this.trans[this.transIdx];          // EARLY RETURN: build is paused
      }
      if (this.F1next && this.back.buf) {
        if (this.allowTransition && !this.trans[0].buf) {
          for (let k = 0; k < NLADDER; k++) tabAlloc(this.trans[k], this.w, this.h, this._arena);
        }
        this._build3();
      }
    } else {
      this._buildAll(this.front, this.F1, this.F2);  // first frame after Init
    }
    return this.front;
  }

  // Moves A.px, B.px and every allocated table into one arena (movebits.ts), unless they are all
  // there already: a copy each, once per size. Tables allocated later go straight in (tabAlloc).
  _resident(sa: Surface, sb: Surface, n: number) {
    const ar = this._arena;
    if (ar && ar.n === n && sa.px.buffer === ar.buf && sb.px.buffer === ar.buf) return;
    const nr = this._arena = sa.px.length === n && sb.px.length === n ? newArena(n, 4 + NLADDER) : null;
    if (!nr) return;
    sa.px = adopt(nr.u32(0), sa.px); sb.px = adopt(nr.u32(1), sb.px);
    for (const t of [this._tabA, this._tabB, ...this.trans]) if (t.buf && t.buf.length === n) t.buf = adopt(nr.i32(t.slot), t.buf);
  }

  // ---- 18000d940 ShiftMoveBits: gather + 5-tap blur + background rows ------
  _moveBits(t: WarpTable, ctx: EffectCtx, intended: boolean) {
    const W = ctx.w, H = ctx.h, n = W * H;
    const sa = ctx.A!, sb = ctx.B!;
    // The DLL swaps ctx+0x48/+0x50 twice per call (net zero). The swap is only
    // observable through the %4 bailout below.
    if (!intended && (n % 4) !== 0) { ctx.A = sb; ctx.B = sa; return; }

    this._resident(sa, sb, n);
    const tab = t.buf!, src = sa.px, dst = sb.px;
    if (!moveBitsWasm(src, tab, dst, W, H)) {            // the same gather + blur in WASM SIMD
      for (let i = 0; i < n; i++) dst[i] = src[tab[i]];   // nearest neighbour, unclamped
      let y = 1;
      for (; y + 1 < H - 1; y += 2) blurRowPair(src, dst, W, y * W);
      if (y < H - 1) blurRow(src, dst, W, y * W);
    }

    const end = (H - 1) * W;

    const bg = (ctx.bgColor || 0) >>> 0;
    src.fill(bg, 0, W - 1);          // 1800125e0 paints W-1 pixels per border row (spec 07)
    src.fill(bg, end, n - 1);
  }

  // ---- 18000d8b0 Shift::Render --------------------------------------------
  render(ctx: EffectCtx) {
    if (!this.F1) this._hardInit();
    const intended = !!(ctx.options && ctx.options.intended);
    const t = this._driver(ctx, intended);
    if (t && t.buf) this._moveBits(t, ctx, intended);
  }
}

A.Shift = Shift;
