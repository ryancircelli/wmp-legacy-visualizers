// Ported from tests/draw.test.js — asserts the numeric claims of specs 04 and 05 for Alchemy.Draw.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import type { Surface, TimedLevel } from '../../src/engine/ns';
import type { EffectCtx } from '../../src/engine/effect';
import { Draw } from '../../src/engine/draw';

const { Pen, ColorFader, SuperStar, WonderWave, AtomBalls } = Draw;
const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- tiny harness (kept close to
// the old file's ok/eq/near so the section bodies below stay a near-verbatim transcription).
function ok(cond: unknown): void { expect(Boolean(cond)).toBe(true); }
function eq<T>(got: T, want: T): void { expect(got).toBe(want); }
function near(got: number, want: number, eps: number): void { expect(Math.abs(got - want)).toBeLessThanOrEqual(eps); }

// ---------------------------------------------------------------- fixtures
function surface(w: number, h: number, fill: number): Surface { return A.makeSurface(w, h, fill); }

// Synthetic TimedLevel: freq bins constant `f`, waveform from wfn(i).
function level(f: number, wfn?: (i: number) => number): TimedLevel {
  const mk = (fn: (i: number) => number) => { const a = new Uint8Array(1024); for (let i = 0; i < 1024; i++) a[i] = fn(i); return a; };
  const w = wfn || (() => 128);
  return {
    freq: [mk(() => f), mk(() => f)],
    wave: [mk(w), mk(w)],
    state: 2, timeStamp: 0,
  };
}
function ctxFor(surf: Surface, opts?: Partial<EffectCtx>): EffectCtx {
  return Object.assign({
    level: level(255), frame: 0, beat: false, bigBeat: false,
    framesSinceBeat: 0, framesSinceBigBeat: 0,
    bass: 1.275, bassDelta: 0, w: surf.w, h: surf.h, A: surf, B: surf, C: surf,
    target: null, surfaces: null,
    bgColor: 0, destRect: { left: 0, top: 0, right: surf.w, bottom: surf.h },
    bassHistory: new Float64Array(30), bassIdx: 0, resized: false, paused: false,
    useAltRender: false, newAudio: false,
    options: { intended: false },
  }, opts);
}

// A surface whose pixel store traps every write, to catch out-of-bounds indices.
interface GuardSurface { w: number; h: number; px: Uint32Array; bad: string[]; store: number[] }
function guardSurface(w: number, h: number, fill: number): GuardSurface {
  const store: number[] = new Array(w * h).fill(fill >>> 0);
  const bad: string[] = [];
  const px = new Proxy(store, {
    get(t, k) { return typeof k === 'string' && /^-?\d+$/.test(k) ? t[k as unknown as number] : (t as unknown as Record<PropertyKey, unknown>)[k]; },
    set(t, k, v) {
      if (typeof k === 'string' && /^-?\d+$/.test(k)) {
        const i = +k;
        if (i < 0 || i >= w * h) { bad.push('index ' + i); return true; }
        if (!Number.isFinite(v) || v < 0 || v > 0xFFFFFF) bad.push('value ' + v + ' at ' + i);
      }
      (t as unknown as Record<PropertyKey, unknown>)[k] = v; return true;
    },
  });
  return { w, h, px: px as unknown as Uint32Array, bad, store };
}

// =================================================================== 1. blend formulas
describe('1. blend formulas', () => {
  it('brush modes 0-3, Blur5, and the guard band', () => {
    // mode 0: p = Lerp(col, old, 0.9). White on black: per channel a=255,b=0,
    // d = (int8)RoundToInt(-255*0.9) = (int8)(-230) = 26, (26+255)&255 = 25 -> 0x191919.
    // (The int8 wrap is why it is 25 and not the "mathematical" 26.)
    let S = surface(16, 16, 0x000000);
    let P = new Pen();
    P.surf = S; P.brushMode = 0; P.inkColor.cur = 0xFFFFFF;
    P.brush(5 * 16 + 5, 5, 5);
    eq(S.px[5 * 16 + 5], 0x191919);
    eq(S.px[5 * 16 + 6], 0x000000);

    // mode 1: hard core, halo = Lerp(col, old, 0.3) -> (int8)(-77)=-77, (-77+255)&255=178.
    S = surface(16, 16, 0x000000);
    P = new Pen(); P.surf = S; P.brushMode = 1; P.inkColor.cur = 0xFFFFFF;
    P.brush(5 * 16 + 5, 5, 5);
    eq(S.px[5 * 16 + 5], 0xFFFFFF);
    eq(S.px[5 * 16 + 6], 0xB2B2B2);
    eq(S.px[5 * 16 + 4], 0xB2B2B2);
    eq(S.px[6 * 16 + 5], 0xB2B2B2);
    eq(S.px[4 * 16 + 5], 0xB2B2B2);
    eq(S.px[4 * 16 + 4], 0x000000);

    // mode 2/3: core + blendAmt halo + a 9-cell sequential 5-tap blur. Modes 2 and 3 are
    // byte-identical (mode 3 is an unused alias).
    const run = (mode: number): Uint32Array => {
      const S2 = surface(16, 16, 0x000000);
      const P2 = new Pen();
      P2.surf = S2; P2.brushMode = mode; P2.blendAmt = 0.5; P2.inkColor.cur = 0xFFFFFF;
      P2.brush(5 * 16 + 5, 5, 5);
      return S2.px;
    };
    const m2 = run(2), m3 = run(3);
    let same = true;
    for (let i = 0; i < m2.length; i++) if (m2[i] !== m3[i]) same = false;
    ok(same);
    ok(m2[5 * 16 + 5] !== 0xFFFFFF);
    ok(m2[4 * 16 + 4] !== 0x000000);
    // halo strength before the blur is the plain lerp: (int8)RoundToInt(-127.5) = -128 -> 127.
    eq(Pen.lerp(0xFFFFFF, 0x000000, 0.5), 0x7F7F7F);

    // Blur5 in isolation: integer /5 of the plus-shaped neighbourhood.
    S = surface(8, 8, 0);
    S.px[2 * 8 + 2] = 0x0A0A0A; S.px[1 * 8 + 2] = 0x040404; S.px[3 * 8 + 2] = 0x010101;
    S.px[2 * 8 + 1] = 0x020202; S.px[2 * 8 + 3] = 0x000000;   // sum 0x11 = 17 per channel
    Pen.blur5(S, 2 * 8 + 2);
    eq(S.px[2 * 8 + 2], 0x030303);

    // guard band of 2: nothing is written when the centre is within 2 px of an edge.
    S = surface(16, 16, 0x000000);
    P = new Pen(); P.surf = S; P.brushMode = 1; P.inkColor.cur = 0xFFFFFF;
    P.brush(1 * 16 + 1, 1, 1);
    P.brush(14 * 16 + 14, 14, 14);
    let touched = 0;
    for (let i = 0; i < S.px.length; i++) if (S.px[i] !== 0) touched++;
    eq(touched, 0);
  });
});

// =================================================================== 2. colour lerp wrap
describe('2. colour lerp wrap', () => {
  it('Pen.lerp / Pen.roundToInt edge behaviour', () => {
    eq(Pen.lerp(0x000000, 0xFFFFFF, 0.0), 0x000000);
    eq(Pen.lerp(0x000000, 0xFFFFFF, 1.0), 0xFFFFFF);
    // t > 1 wraps per 8-bit channel: d = RoundToInt(255*2) = 510, (int8)510 = -2, (-2+0)&255 = 254.
    eq(Pen.lerp(0x000000, 0x0000FF, 2.0), 0x0000FE);
    eq(Pen.lerp(0x000000, 0x00FF00, 2.0), 0x00FE00);
    eq(Pen.lerp(0x000000, 0xFF0000, 2.0), 0xFE0000);
    // alpha is always forced to 0.
    eq(Pen.lerp(0xFFFFFFFF >>> 0, 0xFFFFFFFF >>> 0, 1.0), 0xFFFFFF);
    // RoundToInt is half away from zero.
    eq(Pen.roundToInt(2.5), 3);
    eq(Pen.roundToInt(-2.5), -3);
    // ±inf / NaN -> 0x80000000 (the x86 integer indefinite), which the clipper then rejects.
    eq(Pen.roundToInt(Infinity), -2147483648);
    eq(Pen.roundToInt(NaN), -2147483648);
  });
});

// =================================================================== 3. ColorFader easing
describe('3. ColorFader easing', () => {
  it('quarter-sine ease, ping-pong, and the random walk', () => {
    const f = new ColorFader();
    f.reset(0x000000, 0x0000FF, 4, 1);
    eq(f.cur, 0x000000);
    // cur = Lerp(from, to, sin(tick/period * PI/2)) with a float divide:
    // tick 1..4 -> sin = .38268, .70711, .92388, 1.0 -> 98, 180, 236, 255.
    const want = [98, 180, 236, 255];
    for (let i = 0; i < 4; i++) { f.step(); eq(f.cur & 0xff, want[i]); }
    eq(f.period, 4);

    // segments > 1 => ping-pong: on expiry the endpoints swap instead of a random target.
    const g = new ColorFader();
    g.reset(0x000000, 0x0000FF, 6, 3);
    eq(g.period, 2);
    ok(g.ramping);
    g.step(); g.step();                    // reaches `to`
    eq(g.cur & 0xff, 255);
    g.step();                              // expiry -> swap endpoints, tick restarts at 0
    eq(g.from, 0x0000FF);
    eq(g.to, 0x000000);

    // random walk (segments == 1, enabled): a fresh random target and a new period.
    A.srand(1234);
    const h = new ColorFader();
    h.reset(0x101010, 0x202020, 1, 1);
    h.step();                              // arrives
    const before = h.cur;
    h.step();                              // expiry -> Reset(cur, RandomRGB(), rand()%100, 1)
    eq(h.from, before);
    ok(h.period >= 1 && h.period <= 100);
    eq(h.to & 0xFF000000, 0);
  });
});

// =================================================================== 4. waveform kernel
describe('4. waveform kernel', () => {
  it('Pen.wiggle across sources/envelopes/fold', () => {
    const P = new Pen();
    P.amplitude = 50; P.steps = 100; P.loops = 2; P.source = 0; P.fold = true;
    // envelope 2+ = flat, so the raw displacement shows: amplitude/128 * (v - 128).
    P.envelope = 2;
    P.tl = level(0, () => 0);   near(P.wiggle(0), -50, 1e-6);
    P.tl = level(0, () => 128); near(P.wiggle(0), 0, 1e-6);
    P.tl = level(0, () => 255); near(P.wiggle(0), 49.609375, 1e-6);

    // envelope 0 = |sin(loops * i/steps * PI)|: zero at i=0, full at i=steps/4 with loops=2.
    P.envelope = 0; P.tl = level(0, () => 0);
    near(P.wiggle(0), 0, 1e-6);
    near(P.wiggle(25), -50, 1e-5);
    near(P.wiggle(50), 0, 1e-5);

    // envelope 1 = triangle on the raw index.
    P.envelope = 1;
    near(P.wiggle(25), -25, 1e-6);
    near(P.wiggle(50), -50, 1e-6);

    // fold: the sample index reflects about steps/2, so i and (steps-i) read the same sample.
    P.envelope = 2;
    P.tl = level(0, (i) => (i === 10 ? 0 : 128));
    near(P.wiggle(10), -50, 1e-6);
    near(P.wiggle(90), -50, 1e-6);

    // source 2 (the default) averages the two channels.
    P.source = 2; P.tl = level(0, () => 0); P.tl.wave[1].fill(128);
    near(P.wiggle(0), -25, 1e-6);
  });
});

// =================================================================== 5. SuperStar geometry
describe('5. SuperStar geometry', () => {
  it('vertex geometry, per-frame pen setup, and identity', () => {
    for (const [n, k] of [[5, 3], [10, 7], [14, 9]] as const) {
      const S = surface(64, 64, 0);
      const T = new SuperStar();
      T.setSize(64, 64);
      T.Scale = 1.0; T.MaxSpin = 0; T.Divisions = n; T.angle = 0;
      const segs: [number, number, number, number][] = [];
      T.pen.drawJaggedLine = function (x0: number, y0: number, x1: number, y1: number): void { segs.push([x0, y0, x1, y1]); };
      const ctx = ctxFor(S);
      T.render(ctx);

      eq(segs.length, n + 1);
      // bass = 6*255/1200 = 1.275; R = bass * (h>>1) * Scale
      const R = 1.275 * 32 * 1.0, step = (6.2831854820251465 / n) * k, cx = 32, cy = 32;
      const vx = (i: number) => Math.trunc(Math.cos(i * step) * R) + cx;
      const vy = (i: number) => Math.trunc(Math.sin(i * step) * R) + cy;
      eq(segs[0]![0], vx(0));
      eq(segs[0]![1], vy(0));
      eq(segs[0]![2], vx(1));
      eq(segs[0]![3], vy(1));
      // n*step is a whole number of turns, so the (n+1)th edge repeats the first.
      eq(segs[n]!.join(), segs[0]!.join());
      // per-frame pen setup
      eq(T.pen.brushMode, 3);
      eq(T.pen.amplitude, 50);
      eq(T.pen.maxSteps, 50);
      eq(T.pen.blendAmt, 0.5);
      eq(T.pen.rampColor.segments, 3);
      eq(T.pen.mirrored, false);
    }
    // identity
    const T = new SuperStar();
    eq(T.nameId, 107); eq(T.traceId, 12);
    eq(T.category, 4); eq(T.weight, 0.5);
    // randomize ranges
    A.srand(7);
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      T.randomize();
      ok(T.Scale >= 0.2 && T.Scale <= 1.0);
      ok(T.MaxSpin >= -0.3 && T.MaxSpin <= 0.3);
      seen.add(T.Divisions);
    }
    ok(!seen.has(5) && !seen.has(6));
    ok(seen.has(20) && seen.has(21));
    for (const d of seen) ok([3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 20, 21].includes(d));
  });
});

// =================================================================== 6. WonderWave amplitude
describe('6. WonderWave amplitude', () => {
  it('amplitude, clip margins, ramp segments, spin laws, and randomize ranges', () => {
    const mk = () => {
      const T = new WonderWave();
      T.setSize(64, 64);
      T.Points = 50; T.ScalePct = 0.4; T.SinLoops = 1; T.SpinMode = 3;
      T.RenderMode = 0; T.BassFlex = false; T.CrossLine = false; T.Mirrored = false;
      return T;
    };
    let S = surface(64, 64, 0);
    let T = mk();
    T.render(ctxFor(S, { options: { intended: false } }));
    eq(T.pen.amplitude, 0);

    S = surface(64, 64, 0);
    T = mk();
    T.render(ctxFor(S, { options: { intended: true } }));
    eq(T.pen.amplitude, 25);

    // With amplitude 0 the wiggle is flat for every envelope, i.e. straight diameters.
    T = mk(); T.pen.amplitude = 0; T.pen.tl = level(0, () => 255); T.pen.steps = 50;
    for (const env of [0, 1, 2]) { T.pen.envelope = env; near(T.pen.wiggle(12), 0, 0); }

    // clip margin follows RenderMode (0 / 1 / 9) and brushMode is RenderMode.
    for (const [rm, margin] of [[0, 0], [1, 1], [2, 9]] as const) {
      S = surface(64, 64, 0); T = mk(); T.RenderMode = rm;
      T.render(ctxFor(S));
      eq(T.pen.brushMode, rm);
      eq(T.pen.clipMin, margin);
      eq(T.pen.clipMaxX, 64 - margin);
    }
    // ramp segments = 2*SinLoops; Mirrored doubles each line; CrossLine adds a second diameter.
    S = surface(64, 64, 0); T = mk(); T.SinLoops = 3; T.Mirrored = true; T.CrossLine = true;
    T.validate();
    const lines: number[] = [];
    T.pen.drawJaggedLine = function (): void { lines.push(1); };
    T.render(ctxFor(S));
    eq(T.pen.rampColor.segments, 6);
    eq(T.pen.mirrored, true);
    eq(lines.length, 2);

    // primary diameter is at rotation + PI/2 (vertical at rotation 0): endpoints share x.
    S = surface(64, 64, 0); T = mk(); T.rotation = 0;
    const segs: [number, number, number, number][] = [];
    T.pen.drawJaggedLine = function (x0: number, y0: number, x1: number, y1: number): void { segs.push([x0, y0, x1, y1]); };
    T.render(ctxFor(S));
    eq(segs[0]![0], segs[0]![2]);
    ok(segs[0]![1] !== segs[0]![3]);

    // identity + spin laws
    T = new WonderWave();
    eq(T.nameId, 108); eq(T.traceId, 13);
    eq(T.category, 4); eq(T.weight, 1.0);
    eq(T.Points, 2); eq(T.ScalePct, 0.2);
    for (const [mode, want] of [[0, 1.275 * 1.275 * 0.1], [1, 1.275 * 0.1], [2, 0.1], [3, 0]] as const) {
      S = surface(64, 64, 0); const W2 = mk();
      W2.Spin = 0.1; W2.SpinMode = mode; W2.rotation = 0;
      W2.render(ctxFor(S));
      near(W2.rotation, want, 1e-12);
    }
    // randomize + validate keep everything in range
    A.srand(99);
    for (let i = 0; i < 2000; i++) {
      T.randomize();
      ok(T.RenderMode >= 0 && T.RenderMode <= 2);
      ok(T.Points >= 10 && T.Points <= 1023);
      ok(T.ScalePct >= 0.01 && T.ScalePct <= 0.99);
      ok(T.SinLoops >= 1 && T.SinLoops <= 20);
      ok(T.SpinMode >= 0 && T.SpinMode <= 3);
      ok(T.Spin >= -0.13 && T.Spin <= 0.13);
      ok(T.crossRotation >= -Math.PI / 2 - 1e-6 && T.crossRotation <= Math.PI / 2 + 1e-6);
    }
  });
});

// ====================== 7a. AtomBalls Randomize draw order (180010a30, verified vs the real DLL)
describe('7a. AtomBalls Randomize draw order', () => {
  it('every field pulls from its own rand() draw, in DLL order', () => {
    // The DLL draws x, y, vx, vy, Ball1Radius, damping, then the 1-in-15 Ball2Radius gate.
    // Feed a known LCG run and check every field against its own draw.
    const vals: number[] = [];
    A.srand(4242);
    for (let i = 0; i < 8; i++) vals.push(A.rand());
    const T = new AtomBalls(); T.setSize(640, 480);
    A.srand(4242); T.randomize();
    eq(T.x, vals[0]! % 640);
    eq(T.y, vals[1]! % 480);
    near(T.vx, (vals[2]! / 32767) * 4 - 2, 0);
    near(T.vy, (vals[3]! / 32767) * 4 - 2, 0);
    near(T.Ball1Radius, (vals[4]! / 32767) * 21 + 9, 0);
    near(T.damping, (vals[5]! / 32767) * 0.3999999761581421 + 0.5, 0);
    ok(vals[6]! % 15 !== 0 ? T.Ball2Radius === T.Ball1Radius : true);
    near(T.radius, T.Ball1Radius, 0);
  });
});

// =================================================================== 7. AtomBalls motion
describe('7. AtomBalls motion', () => {
  it('friction, wall bounce, bass kicks, ball B mirroring, and the radius spring/flash', () => {
    const mk = () => {
      const T = new AtomBalls();
      T.setSize(100, 100);
      T.Ball1Radius = 10; T.radius = 10; T.springK = 1; T.springM = 1; T.damping = 0.5;
      return T;
    };
    // no bounce: velocity is damped by 0.8 on both axes; bass 0 means zero-size kicks.
    let S = surface(100, 100, 0);
    let T = mk();
    T.x = 50; T.y = 50; T.vx = 1; T.vy = 2;
    T.render(ctxFor(S, { bass: 0 }));
    eq(T.x, 51);
    eq(T.y, 52);
    const FRIC = 0.80000000298023224;            // (double)(float)0.8, exactly as the DLL stores it
    near(T.vx, 1 * FRIC, 0);
    near(T.vy, 2 * FRIC, 0);
    eq(T.bounced, false);

    // wall: reflection is undamped, and the position is NOT clamped back inside.
    S = surface(100, 100, 0); T = mk();
    T.x = 99.5; T.y = 50; T.vx = 1; T.vy = 2;
    T.render(ctxFor(S, { bass: 0 }));
    eq(T.bounced, true);
    near(T.x, 100.5, 1e-12);
    near(T.vx, -1, 1e-12);
    near(T.vy, 2 * FRIC, 0);
    // and it keeps reflecting until it re-enters
    T.render(ctxFor(S, { bass: 0 }));
    near(T.x, 99.5, 1e-12);
    near(T.vx, -1 * FRIC, 0);

    // negative wall
    S = surface(100, 100, 0); T = mk();
    T.x = 0.5; T.y = 50; T.vx = -1; T.vy = 0;
    T.render(ctxFor(S, { bass: 0 }));
    near(T.x, -0.5, 1e-12);
    near(T.vx, 1, 1e-12);

    // bass kicks are +-bass and only on non-bounce frames
    S = surface(100, 100, 0); T = mk();
    T.x = 50; T.y = 50; T.vx = 0; T.vy = 0;
    T.render(ctxFor(S, { bass: 0.5 }));
    ok(Math.abs(Math.abs(T.vx) - 0.5) < 1e-12);
    ok(Math.abs(Math.abs(T.vy) - 0.5) < 1e-12);
    S = surface(100, 100, 0); T = mk();
    T.x = 99.9; T.y = 50; T.vx = 1; T.vy = 0;
    T.render(ctxFor(S, { bass: 0.5 }));
    near(T.vx, -1, 1e-12);

    // ball B is the point reflection of ball A through the centre
    S = surface(100, 100, 0); T = mk();
    T.x = 30; T.y = 40; T.vx = 0; T.vy = 0;
    const balls: [number, number, number, number][] = [];
    T.drawBall = function (_s: Surface, cx: number, cy: number, r: number, a: number): void { balls.push([cx, cy, r, a]); };
    T.render(ctxFor(S, { bass: 0 }));
    eq(balls.length, 2);
    eq(balls[1]![0], T.w - balls[0]![0]);
    eq(balls[1]![1], T.h - balls[0]![1]);

    // radius spring + R = trunc(radius*bass)+1, and the beat response
    S = surface(100, 100, 0); T = mk();
    T.x = 50; T.y = 50; T.vx = 0; T.vy = 0; T.radius = 10; T.springV = 0;
    const b2: [number, number][] = [];
    T.drawBall = function (_s: Surface, _cx: number, _cy: number, r: number, a: number): void { b2.push([r, a]); };
    T.render(ctxFor(S, { bass: 0 }));
    // springV = ((10-10)*1 + 0.8*0/1) * 0.5 = 0 -> radius stays 10, R = trunc(10*0)+1 = 1
    near(T.radius, 10, 1e-12);
    eq(b2[0]![0], 1);
    eq(b2[1]![1], 0);

    S = surface(100, 100, 0); T = mk();
    T.x = 50; T.y = 50; T.vx = 0; T.vy = 0; T.radius = 10; T.springV = 0;
    const b3: [number, number][] = [];
    T.drawBall = function (_s: Surface, _cx: number, _cy: number, r: number, a: number): void { b3.push([r, a]); };
    const beatCtx = ctxFor(S, { bass: 1.0, beat: true });
    T.pen.drawJaggedLine = function (): void {};                 // the bolt is exercised in section 8
    T.render(beatCtx);
    // springV = (0 + 0.8*1) * 0.5 = 0.4 -> radius 10.4 -> R = trunc(10.4)+1 = 11, doubled = 22
    eq(b3[0]![0], 22);
    eq(b3[0]![1], Math.fround(0.4));
    eq(T.flashFrames, 4);
    eq(T.invertColors, true);
    // the flash ramp: ball A shrinks through 1.6, 1.2, 0.8, 0.4 x R
    const factors: number[] = [];
    for (let i = 0; i < 4; i++) {
      const S4 = surface(100, 100, 0);
      const c4 = ctxFor(S4, { bass: 1.0, beat: false });
      const got: number[] = [];
      T.drawBall = function (_s: Surface, _cx: number, _cy: number, r: number): void { got.push(r); };
      T.render(c4);
      factors.push(got[0]! / got[1]!);
    }
    for (let i = 0; i < 4; i++) near(factors[i]!, [1.6, 1.2, 0.8, 0.4][i]!, 0.06);
    eq(T.flashFrames, 0);
    eq(T.invertColors, true);

    // DrawBall's signed-depth metric: solid centre, ~3.14 px halo ring, nothing past it.
    S = surface(41, 41, 0x000000); T = mk();
    T.colorA.cur = 0xFFFFFF; T.colorB.cur = 0xFF0000; T.invertColors = false;
    T.drawBall(S, 20, 20, 10, 0.0);                        // alpha 0 -> body is solid bodyCol
    eq(S.px[20 * 41 + 20], 0xFFFFFF);
    ok((S.px[20 * 41 + 30]! >>> 16) > 0);
    eq(S.px[20 * 41 + 34], 0x000000);
    // halo ring thickness ~3.14 px: |dist - r| <~ 1.57
    let ring = 0;
    for (let x = 0; x < 41; x++) if (S.px[20 * 41 + x] !== 0) ring++;
    ok(ring >= 20 && ring <= 26);

    // identity + randomize ranges
    T = new AtomBalls();
    eq(T.nameId, 113); eq(T.traceId, 17);
    eq(T.category, 4); eq(T.weight, 0.9);
    near(T.friction, 0.80000000298023224, 0);
    near(T.drive, 0.80000000298023224, 0);
    T.setSize(100, 100);
    A.srand(4242);
    for (let i = 0; i < 2000; i++) {
      T.randomize();
      ok(T.Ball1Radius >= 9 && T.Ball1Radius <= 30);
      ok(T.damping >= 0.5 && T.damping <= 0.9);
      ok(T.vx >= -2 && T.vx <= 2 && T.vy >= -2 && T.vy <= 2);
      ok(T.x >= 0 && T.x < 100 && T.y >= 0 && T.y < 100);
      eq(T.radius, T.Ball1Radius);
      eq(T.springK, 1);
    }
  });
});

// =================================================================== 8. no out-of-bounds writes
describe('8. no out-of-bounds writes', () => {
  it('SuperStar / WonderWave / AtomBalls stay inside a trapping surface', () => {
    // Every effect renders into a trapping surface; the Pen's guard band of 2 (plus the blur's
    // 1-px reach) means row/column 0 must stay at the sentinel. DrawBall clips to [0,w) x [0,h)
    // and may legitimately paint the outer ring, so only the index check applies to AtomBalls.
    const SENT = 0x123456;
    const ringClean = (S: { w: number; h: number; px: number[] }, sent: number): boolean => {
      for (let x = 0; x < S.w; x++) if (S.px[x] !== sent || S.px[(S.h - 1) * S.w + x] !== sent) return false;
      for (let y = 0; y < S.h; y++) if (S.px[y * S.w] !== sent || S.px[y * S.w + S.w - 1] !== sent) return false;
      return true;
    };

    A.srand(20250922);
    const wave = (i: number) => (i * 37) & 0xff;             // full-swing synthetic waveform

    // --- SuperStar: 30 frames, largest star, radius pushed past the surface so it clips hard.
    let G = guardSurface(48, 40, SENT);
    let T: InstanceType<typeof SuperStar> | InstanceType<typeof WonderWave> | InstanceType<typeof AtomBalls> = new SuperStar();
    T.setSize(48, 40); T.randomize();
    (T).Scale = 4.0; (T).Divisions = 21; (T).MaxSpin = 0.3;
    let ctx = ctxFor(G);
    ctx.level = level(255, wave);
    for (let i = 0; i < 30; i++) { ctx.frame = i; T.render(ctx); }
    eq(G.bad.length, 0);
    let R = { w: G.w, h: G.h, px: G.store };
    ok(ringClean(R, SENT));
    let painted = 0; for (const v of G.store) if (v !== SENT) painted++;
    ok(painted > 0);

    // --- WonderWave: every RenderMode, mirrored + cross line, shipped and intended.
    for (const intended of [false, true]) {
      for (const rm of [0, 1, 2]) {
        G = guardSurface(48, 40, SENT);
        const W2 = new WonderWave(); W2.setSize(48, 40); W2.randomize();
        W2.RenderMode = rm; W2.Points = 600; W2.Mirrored = true; W2.CrossLine = true;
        W2.CrossMode = 0; W2.Spin = 0.13; W2.SpinMode = 0; W2.ScalePct = 0.9; W2.BassFlex = true;
        W2.validate();
        ctx = ctxFor(G, { options: { intended } });
        ctx.level = level(255, wave);
        for (let i = 0; i < 30; i++) { ctx.frame = i; W2.render(ctx); }
        eq(G.bad.length, 0);
        R = { w: G.w, h: G.h, px: G.store };
        ok(ringClean(R, SENT));
        painted = 0; for (const v of G.store) if (v !== SENT) painted++;
        ok(painted > 0);
      }
    }

    // --- AtomBalls: beats every 7th frame so the bolt and the flash ramp both run.
    G = guardSurface(48, 40, SENT);
    T = new AtomBalls(); T.setSize(48, 40); T.randomize();
    (T).Ball1Radius = 60;                                   // oversized: forces heavy clipping
    ctx = ctxFor(G);
    ctx.level = level(255, wave);
    for (let i = 0; i < 40; i++) { ctx.frame = i; ctx.beat = (i % 7 === 0); T.render(ctx); }
    eq(G.bad.length, 0);
    painted = 0; for (const v of G.store) if (v !== SENT) painted++;
    ok(painted > 0);

    // --- and with a 1x1 and 5x5 surface nothing explodes
    for (const n of [1, 5]) {
      const tiny = guardSurface(n, n, SENT);
      const c = ctxFor(tiny);
      c.level = level(255, wave);
      const s1 = new SuperStar(); s1.setSize(n, n); s1.randomize(); s1.render(c);
      const w1 = new WonderWave(); w1.setSize(n, n); w1.randomize(); w1.render(c);
      const a1 = new AtomBalls(); a1.setSize(n, n); a1.randomize(); c.beat = true; a1.render(c);
      eq(tiny.bad.length, 0);
    }
  }, 30_000);   // ~1.4 s alone; the 5 s default was overrun while other builds loaded the machine
});

// =================================================================== 9. rand() only
describe('9. rand() only', () => {
  it('the module never reaches for Math.random and A.Draw exports exactly five', () => {
    // The module must never reach for Math.random. (Old test read src/40-draw.js's text;
    // src/engine/draw.ts is now the source of truth.)
    const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'engine', 'draw.ts'), 'utf8');
    ok(!/Math\.random/.test(src));
    ok(Object.keys(Draw).sort().join() === 'AtomBalls,ColorFader,Pen,SuperStar,WonderWave');
  });
});
