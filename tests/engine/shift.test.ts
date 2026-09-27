// Ported from tests/shift.test.js — asserts spec 01/02's numeric claims for Alchemy.Shift.
import { describe, expect, it } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import { Effect, WarpKernel } from '../../src/engine/effect';
import type { EffectCtx } from '../../src/engine/effect';
import { Shift } from '../../src/engine/shift';
import type { Surface } from '../../src/engine/ns';

interface Point { x: number; y: number }
// Shift.render() takes the full EffectCtx (level/frame/beat/... — everything Engine threads
// through every effect), but Shift itself only ever reads w/h/A/B/bgColor/options.intended.
// Build just those, then cast: the old vm-sandbox test never had an EffectCtx to satisfy.
interface ShiftCtx {
  w: number; h: number;
  A: Surface; B: Surface;
  bgColor: number;
  options: { intended: boolean };
}

// src/engine/shift.ts is still (partially) settling under concurrent typing by other agents:
// this widens locally rather than fighting it if a real runtime field isn't declared yet upstream.
interface KernelFields {
  w: number; h: number;
  chainable: boolean;
  identityFallback: boolean;
  fallbackX: number; fallbackY: number;
}
type Kernel = WarpKernel & KernelFields;
interface WarpTable { buf: Int32Array | null; dirty: boolean; cursorY: number }
type TestShift = Shift & {
  category: number; nameId: number; traceId: number; weight: number;
  pool: Kernel[];
  F1: Kernel | null; F2: Kernel | null; F1next: Kernel | null; F2next: Kernel | null;
  front: WarpTable; back: WarpTable; trans: WarpTable[];
  transitionActive: boolean; transIdx: number; transFrame: number;
  TransitionMode: number; TransitionTime: number;
  _rampHalf: number;
};

// ---------------------------------------------------------------- fake kernels
class Identity extends WarpKernel implements KernelFields {
  declare w: number; declare h: number;
  declare chainable: boolean;
  declare identityFallback: boolean;
  declare fallbackX: number; declare fallbackY: number;
  override map(_p: Point): void { /* p stays put */ }
}
class Translate extends WarpKernel implements KernelFields {
  declare w: number; declare h: number;
  declare chainable: boolean;
  declare identityFallback: boolean;
  declare fallbackX: number; declare fallbackY: number;
  dx: number; dy: number;     // pushes coords out of range on purpose
  constructor(dx: number, dy: number, identityFallback: boolean, fx: number, fy: number) {
    super();
    this.dx = dx; this.dy = dy;
    this.identityFallback = !!identityFallback;
    this.fallbackX = fx | 0; this.fallbackY = fy | 0;
  }
  override map(p: Point): void { p.x += this.dx; p.y += this.dy; }
}
function pool(kernels: Kernel[]): void {
  (A as unknown as { Kernels: { makePool: () => Kernel[] } }).Kernels = { makePool: () => kernels };
}
function makeShift(w: number, h: number, kernels: Kernel[]): TestShift {
  pool(kernels);
  const s = new Shift() as TestShift;
  s.setSize(w, h);
  return s;
}
function makeCtx(w: number, h: number, fill: number, intended: boolean, bg?: number): ShiftCtx {
  return {
    w, h,
    A: A.makeSurface(w, h, fill),
    B: A.makeSurface(w, h, 0),
    bgColor: bg === undefined ? 0 : bg,
    options: { intended: !!intended },
  };
}
// Shift.render() only reads w/h/A/B/bgColor/options.intended off the ctx (verified against
// src/engine/shift.ts), but its _moveBits swaps ctx.A/ctx.B on the %4 bug path (section 7) — that
// swap has to land on the caller's own `ctx` object, so pad it in place rather than passing a copy.
function renderShift(s: TestShift, ctx: ShiftCtx): void {
  const full = ctx as ShiftCtx & Partial<EffectCtx>;
  if (full.destRect === undefined) {
    Object.assign(full, {
      level: null, frame: 0, beat: false, bigBeat: false,
      framesSinceBeat: 0, framesSinceBigBeat: 0, bass: 0, bassDelta: 0,
      C: null, target: null, surfaces: null,
      destRect: { left: 0, top: 0, right: ctx.w, bottom: ctx.h },
      bassHistory: new Float64Array(30), bassIdx: 0, resized: false, paused: false,
      useAltRender: false, newAudio: false,
    });
  }
  s.render(full as EffectCtx);
}

// -------------------------------------------- 0. identity / registration facts
describe('0. identity / registration facts', () => {
  it('category 3 / nameId 103 / traceId 9 / weight 1.0, pool from Kernels.makePool()', () => {
    const s = makeShift(8, 8, [new Identity()]);
    expect(s.category).toBe(3);
    expect(s.nameId).toBe(103);
    expect(s.traceId).toBe(9);
    expect(s.weight).toBe(1.0);
    expect(s).toBeInstanceOf(Effect);
    expect(s.pool.length).toBe(1);
  });
});

// ------------------------------------------------ 1. the blur (spec 01 §2.3)
describe('1. the blur (spec 01 §2.3)', () => {
  it('DC gain is exactly 1 on a flat region; rows 0/H-1 = bgColor', () => {
    const W = 8, H = 8, flat = 0x204060;
    const s = makeShift(W, H, [new Identity()]);
    s.F1 = s.pool[0]!;
    const ctx = makeCtx(W, H, flat, false, 0);
    renderShift(s, ctx);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 0; x < W; x++) {
        expect(ctx.A.px[y * W + x]).toBe(flat);
      }
    }
    expect(ctx.A.px[0]).toBe(0);
    expect(ctx.A.px[(H - 1) * W]).toBe(0);
  });

  it('1-px impulse response 63 centre / 47 orthogonal / 0 diagonal, per channel', () => {
    const W = 8, H = 8;
    const s = makeShift(W, H, [new Identity()]);
    s.F1 = s.pool[0]!;
    const ctx = makeCtx(W, H, 0, false, 0);
    ctx.A.px[4 * W + 4] = 0xffffff;
    renderShift(s, ctx);
    // centre: (0*3 + 255) >> 2 = 63 ; N/S/E/W: ((255>>2)*3) >> 2 = 47 ; diagonals: 0
    expect(ctx.A.px[4 * W + 4]).toBe(0x3f3f3f);
    for (const i of [3 * W + 4, 5 * W + 4, 4 * W + 3, 4 * W + 5]) {
      expect(ctx.A.px[i]).toBe(0x2f2f2f);
    }
    for (const i of [3 * W + 3, 3 * W + 5, 5 * W + 3, 5 * W + 5]) {
      expect(ctx.A.px[i]).toBe(0);
    }
  });
});

// ----------------------------- 2. the build is 3 scanlines per render call
describe('2. the build is 3 scanlines per render call', () => {
  it('ceil(H/3) render calls at H=7 (3 rows/call, H%3 != 0)', () => {
    const W = 5, H = 7;                       // H % 3 != 0
    const s = makeShift(W, H, [new Identity(), new Identity(), new Identity()]);
    A.srand(12345);
    const ctx = makeCtx(W, H, 0x101010, false, 0);
    renderShift(s, ctx);                            // frame 1: front built synchronously
    expect(s.front.dirty).toBe(false);
    expect(s.F1next).toBeTruthy();
    let calls = 0;
    while (s.back.dirty) { renderShift(s, ctx); calls++; expect(calls).toBeLessThan(100); }
    expect(calls).toBe(Math.ceil(H / 3));
    expect(s.back.cursorY).toBe(H);
  });

  it('H%3==0 takes H/3+1 calls (faithful to the pass<3 loop)', () => {
    // H % 3 == 0 costs one extra call: the y == H test is only reached on the next pass.
    const W = 4, H = 6;
    const s = makeShift(W, H, [new Identity(), new Identity()]);
    A.srand(7);
    const ctx = makeCtx(W, H, 0, false, 0);
    renderShift(s, ctx);
    let calls = 0;
    while (s.back.dirty) { renderShift(s, ctx); calls++; expect(calls).toBeLessThan(100); }
    expect(calls).toBe(H / 3 + 1);
  });
});

// ------------------------------------ 3. morph lengths (spec 02 §5.3 table)
function armedShift(W: number, H: number, mode: number, tt: number): { s: TestShift; ctx: ShiftCtx } {
  const s = makeShift(W, H, [new Identity(), new Identity(), new Identity()]);
  const ctx = makeCtx(W, H, 0x203040, false, 0);
  renderShift(s, ctx);
  while (s.back.dirty) renderShift(s, ctx);        // finish the build => ladder allocated
  expect(s.trans[0]!.buf).toBeTruthy();
  s.randomize();                             // promote + arm the morph
  expect(s.transitionActive).toBe(true);
  s.TransitionMode = mode; s.TransitionTime = tt;
  s.transIdx = 0; s.transFrame = 0;
  return { s, ctx };
}
function morphFrames(mode: number, tt: number): number {
  const { s, ctx } = armedShift(5, 7, mode, tt);
  let frames = 0;
  while (s.transitionActive) {
    renderShift(s, ctx);
    if (!s.transitionActive) break;
    frames++;
    expect(frames).toBeLessThan(10000);
  }
  return frames;
}
describe('3. morph lengths (spec 02 §5.3 table)', () => {
  it('TransitionMode 0 lasts 22*T+1 frames (T = 1, 3, 12)', () => {
    A.srand(99);
    for (const tt of [1, 3, 12]) {
      expect(morphFrames(0, tt)).toBe(22 * tt + 1);
    }
  });
  it('TransitionMode 1 lasts 21*T frames (T = 1, 2, 5)', () => {
    for (const tt of [1, 2, 5]) {
      expect(morphFrames(1, tt)).toBe(21 * tt);
    }
  });
  it('TransitionMode 2 with T=1 lasts 21 frames', () => {
    expect(morphFrames(2, 1)).toBe(21);
  });
  it('sine-branch quirk: max step 21 when intended is false, 22 when true', () => {
    // the sine branch never emits 22 (bug) but does when intended
    const { s, ctx } = armedShift(5, 7, 0, 1);
    let max = 0;
    while (s.transitionActive) { renderShift(s, ctx); if (s.transitionActive) max = Math.max(max, s.transIdx); }
    expect(max).toBe(21);
    const b = armedShift(5, 7, 0, 1);
    b.ctx.options.intended = true;
    let imax = 0, n = 0;
    while (b.s.transitionActive && n++ < 200) { renderShift(b.s, b.ctx); imax = Math.max(imax, b.s.transIdx); }
    expect(imax).toBe(22);
  });
});

// ------------------------------------------- 4. the pair draw (rand()%5 == 0)
function pairRate(chainable: boolean, trials: number): number {
  const k: WarpKernel[] = [];
  for (let i = 0; i < 10; i++) { const e = new Identity(); e.chainable = chainable; k.push(e); }
  const s = makeShift(8, 8, k);
  A.srand(2468);
  let pairs = 0;
  for (let i = 0; i < trials; i++) {
    s.transitionActive = false; s.back.dirty = false;
    s.randomize();
    if (s.F2next) pairs++;
  }
  return pairs / trials;
}
describe('4. the pair draw (rand()%5 == 0)', () => {
  it('pair rate with an all-chainable pool = ~1/5', () => {
    const r = pairRate(true, 20000);
    expect(Math.abs(r - 0.2)).toBeLessThan(0.02);
  });
  it("pair rate is 0 when a side is not chainable (Shift O' Scope never chains)", () => {
    expect(pairRate(false, 2000)).toBe(0);
  });
});

// ------------------------------------------ 5. rerolls dropped during a morph
describe('5. rerolls dropped/promoted around a morph and an unfinished build', () => {
  it('a reroll during a morph is dropped (no promote, no new pick)', () => {
    const { s, ctx } = armedShift(5, 7, 0, 12);
    renderShift(s, ctx);
    expect(s.transitionActive).toBe(true);
    const F1 = s.F1, F1next = s.F1next, idx = s.transIdx, frame = s.transFrame;
    s.randomize();
    expect(s.F1).toBe(F1);
    expect(s.F1next).toBe(F1next);
    expect(s.transIdx).toBe(idx);
    expect(s.transFrame).toBe(frame);
  });

  it('a reroll with an unfinished build is dropped', () => {
    const s = makeShift(5, 7, [new Identity(), new Identity()]);
    A.srand(31337);
    const ctx = makeCtx(5, 7, 0, false, 0);
    renderShift(s, ctx); renderShift(s, ctx);
    expect(s.back.dirty).toBe(true);
    const F1next = s.F1next;
    s.randomize();
    expect(s.F1next).toBe(F1next);
  });

  it('a legal reroll promotes the pending set and swaps front/back', () => {
    // ... and once it is finished the reroll promotes (hard cut path is exercised by
    // forcing back.dirty while a promote happens: no morph, table finished in one frame)
    const s = makeShift(5, 7, [new Identity(), new Identity()]);
    A.srand(5);
    const ctx = makeCtx(5, 7, 0, false, 0);
    renderShift(s, ctx);
    const pending = s.F1next, oldFront = s.front;
    s.back.dirty = false;          // pretend the build finished
    s.back.cursorY = 0;
    s.randomize();
    expect(s.F1).toBe(pending);
    expect(s.front).not.toBe(oldFront);
  });

  it('preparation outran the slot => hard cut, remaining rows finished synchronously', () => {
    // hard cut: promote while the build is unfinished -> no morph, synchronous finish
    const W = 5, H = 7;
    const s = makeShift(W, H, [new Identity(), new Identity()]);
    A.srand(11);
    const ctx = makeCtx(W, H, 0, false, 0);
    renderShift(s, ctx); renderShift(s, ctx);        // 3 of 7 rows of back built
    expect(s.back.dirty).toBe(true);
    s._hardInit();                       // the scheduler's hard-init path
    expect(s.transitionActive).toBe(false);
    expect(s.front.dirty).toBe(false);
    expect(s.front.cursorY).toBe(H);
  });
});

// --------------------- 6. gather + range recovery vs a brute-force reference
function refTable(W: number, H: number, F1: WarpKernel, F2: WarpKernel | null): Int32Array {
  const t = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p: Point = { x: x, y: y };
      F1.map(p);
      if (p.x < 0 || p.x >= F1.w) p.x = F1.identityFallback ? x : F1.fallbackX;
      if (p.y < 0 || p.y >= F1.h) p.y = F1.identityFallback ? y : F1.fallbackY;
      if (F2) {
        const ax = p.x, ay = p.y;
        F2.map(p);
        if (p.x < 0 || p.x >= F2.w) p.x = F2.identityFallback ? ax : F2.fallbackX;
        if (p.y < 0 || p.y >= F2.h) p.y = F2.identityFallback ? ay : F2.fallbackY;
        p.x = Math.floor((p.x + x) / 2);
        p.y = Math.floor((p.y + y) / 2);
      }
      t[y * W + x] = p.y * W + p.x;
    }
  }
  return t;
}
function gatherCheck(W: number, H: number, F1: WarpKernel, F2: WarpKernel | null): void {
  const k = [F1]; if (F2) k.push(F2);
  const s = makeShift(W, H, k);
  s.F1 = s.pool[0]!; s.F2 = F2 ? s.pool[1]! : null;
  const ctx = makeCtx(W, H, 0, false, 0);
  for (let i = 0; i < W * H; i++) ctx.A.px[i] = (i * 2654435761) >>> 8;  // distinct values
  const srcCopy = Uint32Array.from(ctx.A.px);
  renderShift(s, ctx);
  const ref = refTable(W, H, F1, F2);
  for (let i = 0; i < W * H; i++) {
    expect(ref[i]! >= 0 && ref[i]! < W * H).toBe(true);
    expect(s.front.buf![i]).toBe(ref[i]);
    expect(ctx.B.px[i]).toBe(srcCopy[ref[i]!]);
  }
}
describe('6. gather + range recovery vs a brute-force reference', () => {
  it('gather + per-axis range recovery + chained average match the reference', () => {
    // identityFallback: out-of-range coords stay put. fallback: they collapse to (fx,fy).
    gatherCheck(8, 6, new Translate(3, 2, true, 0, 0), null);
    gatherCheck(8, 6, new Translate(-5, -4, false, 0, 0), null);
    gatherCheck(8, 6, new Translate(9, 7, false, 2, 3), null);
    gatherCheck(8, 6, new Translate(4, 3, true, 0, 0), new Translate(-6, -5, false, 1, 1));
  });
});

// ------------------------------- 7. the W*H % 4 bug and its intended-mode fix
describe('7. the W*H % 4 bug and its intended-mode fix', () => {
  it('bug mode: surfaces left swapped and the frame frozen; fixed when intended', () => {
    const W = 3, H = 3;                       // n = 9
    const s = makeShift(W, H, [new Identity()]);
    s.F1 = s.pool[0]!;
    const ctx = makeCtx(W, H, 0x112233, false, 0);
    const A0 = ctx.A, B0 = ctx.B;
    renderShift(s, ctx);
    expect(ctx.A).toBe(B0);
    expect(ctx.B).toBe(A0);
    expect(A0.px[4]).toBe(0x112233);

    const s2 = makeShift(W, H, [new Identity()]);
    s2.F1 = s2.pool[0]!;
    const ctx2 = makeCtx(W, H, 0x112233, true, 0);
    const A1 = ctx2.A;
    renderShift(s2, ctx2);
    expect(ctx2.A).toBe(A1);
    expect(ctx2.A.px[4]).toBe(0x112233);
    expect(ctx2.A.px[0]).toBe(0);
  });
});

// ------------------------------------------- 8. portrait ramp overrun is safe
describe('8. portrait ramp overrun is safe', () => {
  it('does not throw and keeps the tables finite (bug mode); intended sizes the ramp for the taller axis', () => {
    const W = 4, H = 40;                      // H-1 > W: the ramp index overruns
    const s = makeShift(W, H, [new Translate(2, 30, true, 0, 0), new Identity()]);
    A.srand(4242);
    const ctx = makeCtx(W, H, 0x445566, false, 0);
    for (let i = 0; i < 400; i++) renderShift(s, ctx);
    for (let i = 0; i < W * H; i++) expect(Number.isFinite(ctx.A.px[i])).toBe(true);

    const s2 = makeShift(W, H, [new Translate(2, 30, true, 0, 0), new Identity()]);
    const ctx2 = makeCtx(W, H, 0x445566, true, 0);
    for (let i = 0; i < 400; i++) renderShift(s2, ctx2);
    expect(s2._rampHalf).toBe(H);
  });
});

// Section 9 of the old file ("gather + blur timing") is a wall-clock micro-benchmark
// (process.hrtime, logged fps ceiling) with no pass/fail assertion of its own — nothing to port.
