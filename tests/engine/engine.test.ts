// Ported from tests/engine.test.js — asserts spec 06 (audio + scheduler) and spec 05 §2 (Bass Bounce).
// Replaces the old vm-sandboxed load of 15-effect.js + 50-engine.js with real module imports: alchemy.ts
// pulls in rand/effect/shift/draw at import time, and A.Shift / A.Draw are then swapped for fakes
// (the engine resolves them late-bound at construction, via resolve()/makeEffect() in alchemy.ts).
import { describe, expect, it, beforeAll } from 'vitest';
import { A } from '../../src/engine/ns';
import { parseColor } from '../../src/engine/alchemy';
import { level } from './helpers-2';
import type { TimedLevel } from '../../src/engine/ns';

// ---- fake effects (the real shift.ts / draw.ts are other agents' files under active typing) ----
const drawLog: string[] = [];
type Trace = { state: number; sf: number; tl: number };
function fake(name: string, cat: number) {
  return class extends (A.Effect as any) {
    rolls = 0;
    trace: Trace[] = [];
    constructor() { super(); this.name = name; this.category = cat; }
    randomize() { this.rolls++; }
    render(_ctx: unknown) {
      drawLog.push(this.name);
      this.trace.push({ state: this.state, sf: this.stateFrames, tl: this.transitionLen });
    }
  };
}

beforeAll(() => {
  const ShiftFake = fake('Shift', 3);
  (ShiftFake.prototype as any).activeKernelCount = function () { return 3; };
  (A as any).Shift = ShiftFake;
  (A as any).Draw = {
    SuperStar: fake('SuperStar', 4),
    WonderWave: fake('WonderWave', 4),
    AtomBalls: fake('AtomBalls', 4)
  };
});

function bassLevel(b: number): TimedLevel {
  const per = (b * 1200) / 6;
  return level(2, (l) => {
    l.freq[0][1] = per; l.freq[0][3] = per; l.freq[0][5] = per;
    l.freq[1][2] = per; l.freq[1][4] = per; l.freq[1][6] = per;
  });
}
const engine = (): any => new (A as any).Engine({ width: 64, height: 48 });

describe('Engine: bass formula', () => {
  it('sums the six asymmetric bins / 1200', () => {
    const e = engine().seed(1);
    const L = level(2, (l) => {
      // only the six magic bins count; neighbours must be ignored
      l.freq[0][1] = 10; l.freq[0][2] = 200; l.freq[0][3] = 20; l.freq[0][5] = 30;
      l.freq[1][1] = 200; l.freq[1][2] = 40; l.freq[1][4] = 50; l.freq[1][6] = 60;
    });
    e.render(L);
    expect(e.debug().bass).toBe((10 + 20 + 30 + 40 + 50 + 60) / 1200);
    expect(e.debug().bass).toBe(0.175);
    // range top
    const e2 = engine().seed(1);
    e2.render(bassLevel(1.275));
    expect(Math.abs(e2.debug().bass - 1.275)).toBeLessThanOrEqual(1e-12);
  });
});

describe('Engine: beat / big beat', () => {
  it('warm-up: beats only at frames 10 and 20 with constant input', () => {
    // Constant input, zero-init ring, hard /30 mean => beats on frames 10 and 20 only (spec §2.3).
    const e = engine().seed(7);
    const L = bassLevel(1.0);
    const beats: number[] = [], bigs: number[] = [];
    for (let f = 1; f <= 60; f++) {
      e.render(L);
      const d = e.debug();
      if (d.beat) beats.push(f);
      if (d.bigBeat) bigs.push(f);
    }
    expect(beats.join(',')).toBe('10,20');
    expect(bigs.join(',')).toBe('');
    expect(e.debug().bassMean).toBe(1.0);
  });

  it('spike above 1.1x mean fires beat and big beat; gaps hold at minimum', () => {
    const e = engine().seed(7);
    const quiet = bassLevel(0.05), loud = bassLevel(1.2);
    for (let f = 0; f < 40; f++) e.render(quiet);           // mean -> 0.05, beats fired at 10/20 then dry
    e.render(loud);
    let d = e.debug();
    expect(d.beat).toBe(true);
    expect(d.bigBeat).toBe(true);
    // minimum gaps: 10 frames for beat, 21 for big beat, both pre-incremented
    const beats: number[] = [], bigs: number[] = [];
    for (let f = 1; f <= 40; f++) {                          // keep hammering loud
      e.render(loud); d = e.debug();
      if (d.beat) beats.push(f);
      if (d.bigBeat) bigs.push(f);
    }
    expect(beats[0]).toBe(10);
    expect(beats.every((v, i) => i === 0 || v - beats[i - 1]! >= 10)).toBe(true);
    if (bigs.length) expect(bigs[0]).toBe(21);
    expect(bigs.every((v, i) => i === 0 || v - bigs[i - 1]! >= 21)).toBe(true);
  });
});

describe('Engine: state != 2 freezes everything', () => {
  it('freezes counters, ring, beats, and presents the stale surface', () => {
    const e = engine().seed(99);
    const L = bassLevel(0.4);
    for (let f = 0; f < 50; f++) e.render(L);
    const before = JSON.stringify(e.debug());
    const seedBefore = (A as any).randSeed ? (A as any).randSeed() : null;
    const surfBefore = e.render(level(0));
    for (let f = 0; f < 20; f++) e.render(level(1, (l) => { l.freq[0][1] = 255; }));
    expect(JSON.stringify(e.debug())).toBe(before);
    if (seedBefore !== null) expect((A as any).randSeed()).toBe(seedBefore);
    expect(e.render(level(0))).toBe(surfBefore);
    // ... and resumes cleanly
    e.render(L);
    expect(e.debug().frame).toBe(51);
  });
});

describe('Engine: slot membership over 20k frames', () => {
  it('only slots 1,2,6,8 ever hold an effect', () => {
    const e = engine().seed(20250922);
    const L = bassLevel(0.5);
    const seen = new Set<number>();
    const names = new Map<number, Set<string>>();
    for (let f = 0; f < 20000; f++) {
      e.render(L);
      e.cycle.slots.forEach((s: any, i: number) => {
        if (s.active.length) {
          seen.add(i);
          s.active.forEach((x: any) => names.set(i, (names.get(i) || new Set()).add(x.name)));
        }
      });
    }
    expect([...seen].map((i) => i + 1).sort((a, b) => a - b).join(',')).toBe('1,2,6,8');
    expect([...names.get(0)!].join(',')).toBe('Shift');
    expect([...names.get(7)!].join(',')).toBe('Bass Bounce');
    const cat4 = new Set([...names.get(1)!, ...names.get(5)!]);
    expect([...cat4].sort().join(',')).toBe('AtomBalls,SuperStar,WonderWave');
  });
});

describe('Engine: envelope frame counts', () => {
  it('fade-in/fade-out durations follow transitionLen', () => {
    const e = engine().seed(4242);
    const L = bassLevel(0.5);
    const shift = e.pool[0];
    shift.trace.length = 0;
    for (let f = 0; f < 6000; f++) e.render(L);

    // segment the trace into lives: a life starts at the frame with state 1 / stateFrames 0
    const t: Trace[] = shift.trace;
    const starts: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i]!.state === 1 && t[i]!.sf === 0) starts.push(i);
    expect(starts.length).toBeGreaterThan(5);

    let checkedFull = 0, checkedShort = 0;
    const failures: string[] = [];
    for (let k = 0; k + 1 < starts.length; k++) {
      const life = t.slice(starts[k], starts[k + 1]);
      const tl = life[0]!.tl;
      const dur = life.length + 1;    // the slot renders dur-1 frames, then the reroll frame
      const inCount = life.filter((x) => x.state === 1).length;
      const outCount = life.filter((x) => x.state === 2).length;
      if (!life.filter((x) => x.state === 0).every((x) => x.sf === 0)) failures.push('stateFrames pinned at 0 during steady');
      if (!life.filter((x) => x.state === 1).every((x, i) => x.sf === i)) failures.push('fade-in stateFrames = 0..tl');
      const outs = life.filter((x) => x.state === 2);
      if (!outs.every((x, i) => x.sf === i)) failures.push('fade-out stateFrames restarts at 0');
      if (dur > 2 * tl + 2) {          // long enough for a real steady phase (spec §5)
        if (inCount !== tl + 1) failures.push('fade-in lasts tl+1 frames (tl=' + tl + ')');
        if (outCount !== tl - 1) failures.push('fade-out lasts tl-1 frames (tl=' + tl + ')');
        if (outs.length && outs[outs.length - 1]!.sf !== tl - 2) failures.push('fade-out ratio stops at (tl-2)/tl');
        if (inCount + outCount + life.filter((x) => x.state === 0).length !== dur - 1) failures.push('life = dur-1 rendered frames');
        checkedFull++;
      } else {
        // degenerate: tl >= dur/2 (spec §5) — the first steady frame immediately arms the fade-out,
        // or the effect never leaves state 1 at all.
        if (!(outCount === dur - tl - 3 || inCount === dur - 1)) failures.push('degenerate envelope truncated by the reroll');
        checkedShort++;
      }
    }
    expect(failures).toEqual([]);
    expect(checkedFull, `checked several complete envelopes (${checkedFull} full, ${checkedShort} degenerate)`).toBeGreaterThan(3);

    // The transitionLen double-draw bug: on the frame a slot rerolls, slot.framesLeft is the fresh
    // duration, so the intended cap is floor(dur/3). The shipped code can blow past it.
    function tlVsCap(intended: boolean) {
      const eng = new (A as any).Engine({ width: 64, height: 48, options: { intended } }).seed(4242);
      const prev = eng.cycle.slots.map(() => 0);
      let rolls = 0, over = 0;
      for (let f = 0; f < 20000; f++) {
        eng.render(L);
        eng.cycle.slots.forEach((s: any, i: number) => {
          if (s.framesLeft > prev[i]) {                 // just rerolled
            const cap = (s.framesLeft / 3) | 0;
            s.active.forEach((x: any) => { rolls++; if (x.transitionLen > cap) over++; });
          }
          prev[i] = s.framesLeft;
        });
      }
      return { rolls, over };
    }
    const buggy = tlVsCap(false), fixed = tlVsCap(true);
    expect(buggy.rolls).toBeGreaterThan(200);
    expect(fixed.rolls).toBeGreaterThan(200);
    expect(fixed.over).toBe(0);
    expect(buggy.over).toBeGreaterThan(0);
  });
});

describe('Engine: category-4 mutual exclusion', () => {
  it('holds every frame across 20k frames', () => {
    const e = engine().seed(31337);
    const L = bassLevel(0.5);
    let checked = 0;
    const failures: string[] = [];
    for (let f = 0; f < 20000; f++) {
      e.render(L);
      const a = e.cycle.slots[1].active, b = e.cycle.slots[5].active;
      if (!(a.length >= 1 && b.length >= 1)) failures.push('both cat-4 slots always hold at least one effect');
      for (const x of a) if (b.indexOf(x) >= 0) failures.push('no effect object is live in both cat-4 slots');
      if (new Set([...a, ...b]).size !== a.length + b.length) failures.push('chosen lock holds');
      checked++;
    }
    expect(failures).toEqual([]);
    expect(checked).toBe(20000);
    // pool-wide: chosen flags match live membership
    const live = new Set<any>();
    e.cycle.slots.forEach((s: any) => s.active.forEach((x: any) => live.add(x)));
    const chosenFailures: string[] = [];
    e.pool.forEach((x: any) => { if (x.chosen !== live.has(x)) chosenFailures.push('chosen flag matches liveness for ' + x.name); });
    expect(chosenFailures).toEqual([]);
  });
});

describe('Engine: draw order', () => {
  it('matches slot construction order every frame across 3000 frames', () => {
    const e = engine().seed(555);
    const L = bassLevel(0.5);
    const failures: string[] = [];
    for (let f = 0; f < 3000; f++) {
      drawLog.length = 0;
      e.render(L);
      const expected: string[] = [];
      e.cycle.slots.forEach((s: any) => s.active.forEach((x: any) => { if (x.name !== 'Bass Bounce') expected.push(x.name); }));
      if (drawLog.join(',') !== expected.join(',')) failures.push('draw order == slot construction order, frame ' + f);
      if (drawLog[0] !== 'Shift') failures.push('Shift (the warp) renders first, frame ' + f);
    }
    expect(failures).toEqual([]);
    // slot 8 is last in construction order, so Bass Bounce writes destRect after everything drew
    expect(e.cycle.slots[7].index).toBe(8);
  });
});

describe('Engine: Bass Bounce IIR / snap', () => {
  it('follows the one-pole IIR, snaps on big beat, converges on fade-out, and stays in the hover band', () => {
    const e = engine().seed(1);
    const bb = e.pool[5];
    const F = Math.fround;
    bb.setSize(100, 80);
    bb.bassJump = 0.2; bb.hover = 0.1; bb.bounceFrame = 40;
    bb.zoom = 1.0; bb.frameCount = 0; bb.state = 0; bb.stateFrames = 0; bb.transitionLen = 20;
    const ctx = { bigBeat: false, destRect: { left: 0, top: 0, right: 0, bottom: 0 } };

    // frame 0: t=0 -> target = 1 - hover = 0.9; zoom = (0.9*1 + 15*1)/16
    bb.render(ctx);
    expect(Math.abs(bb.zoom - (0.9 + 15) / 16)).toBeLessThanOrEqual(1e-6);
    expect(bb.frameCount).toBe(1);
    // destRect is a centred source sub-rect
    const z = bb.zoom;
    const left = (((F(100) - F(100 * z)) | 0) / 2) | 0;
    expect(ctx.destRect.left).toBe(left);
    expect(ctx.destRect.right).toBe(100 - left);
    expect(ctx.destRect.bottom - ctx.destRect.top).toBe(80 - 2 * (((F(80) - F(80 * z)) | 0) / 2 | 0));

    // big-beat snap: zoom is SET to BassJump and the sine phase resets, then the IIR springs back
    ctx.bigBeat = true;
    bb.render(ctx);
    const afterSnap = F(F(F(0.9 * 1) + F(15 * F(0.2))) * 0.0625);   // target from t=0 again
    expect(Math.abs(bb.zoom - afterSnap)).toBeLessThanOrEqual(1e-6);
    expect(bb.frameCount).toBe(1);
    expect(bb.zoom).toBeLessThan(z);

    // snap is skipped while fading out
    bb.state = 2; bb.stateFrames = 0; bb.zoom = 0.5; bb.frameCount = 17;
    bb.render(ctx);
    expect(bb.frameCount).toBe(18);

    // fade-out converges toward 1.0 (identity): g -> 0 means weights morph to (16, 0)
    bb.state = 2; bb.transitionLen = 20; bb.zoom = 0.4; bb.frameCount = 0;
    ctx.bigBeat = false;
    const zs: number[] = [];
    for (let sf = 0; sf < 19; sf++) { bb.stateFrames = sf; bb.render(ctx); zs.push(bb.zoom); }
    expect(zs[18]!).toBeGreaterThan(zs[0]!);
    expect(Math.abs(zs[18]! - 1.0)).toBeLessThanOrEqual(0.02);
    expect(bb.zoom).toBeLessThanOrEqual(1.0);

    // hover band: free-running, zoom stays inside [1-2*Hover, 1]
    bb.state = 0; bb.stateFrames = 0; bb.zoom = 1; bb.frameCount = 0;
    bb.hover = 0.2; bb.bounceFrame = 30;
    let lo = 2;
    for (let f = 0; f < 400; f++) { bb.render(ctx); if (bb.zoom < lo) lo = bb.zoom; }
    expect(lo).toBeGreaterThan(1 - 2 * 0.2 - 1e-6);
    expect(lo).toBeLessThan(1);

    // Randomize ranges + Validate reset
    const rangeFailures: string[] = [];
    for (let i = 0; i < 400; i++) {
      bb.zoom = 0.3; bb.frameCount = 9;
      bb.randomize();
      if (!(bb.bassJump >= 0.13 - 1e-12 && bb.bassJump <= 0.25 + 1e-12)) rangeFailures.push('BassJump in [0.13,0.25]');
      if (!(bb.hover >= 0.05 - 1e-12 && bb.hover <= 0.20 + 1e-12)) rangeFailures.push('Hover in [0.05,0.20]');
      if (!(bb.bounceFrame >= 25 && bb.bounceFrame <= 55)) rangeFailures.push('BounceFrame in [25,55]');
      if (bb.zoom !== 1.0) rangeFailures.push('Validate resets zoom to 1');
      if (bb.frameCount !== 0) rangeFailures.push('Validate resets frameCount to 0');
    }
    expect(rangeFailures).toEqual([]);
    expect(bb.category).toBe(7);
    expect(bb.weight).toBe(0.5);
    expect(bb.nameId).toBe(115);
  });
});

describe('Engine: surfaces / options / present', () => {
  it('allocates, presents, and resizes surfaces correctly', () => {
    const e = new (A as any).Engine({ width: 8, height: 4, options: { backgroundColor: 0x112233 } });
    expect(e.A.px.length).toBe(32);
    expect(e.A.px[0]).toBe(0x112233);
    expect(e.B.px[31]).toBe(0x112233);
    expect(e.options.intended).toBe(false);
    expect(e.options.backgroundColor).toBe(0x112233);
    expect(typeof e.options.fps).toBe('number');
    const L = bassLevel(0.5);
    e.render(L);
    expect(e.A.px[0]).toBe(0x112233);
    expect(e.render(L)).toBe(e.A);
    e.resize(16, 8);
    expect(e.A.px.length).toBe(128);
    expect(e.A.px[127]).toBe(0x112233);
    expect(e.ctx.resized).toBe(true);
    e.render(L);
    expect(e.ctx.resized).toBe(false);
    expect(e.pool[0].w).toBe(16);

    // intended-mode present: a separate surface, A untouched, non-cumulative source-rect zoom
    const zi = new (A as any).Engine({ width: 8, height: 4, options: { intended: true } }).seed(3);
    zi.render(L);
    zi.A.px.fill(0); zi.A.px[2 * 8 + 4] = 0xabcdef;       // marker inside the sub-rect (rows 1..2, cols 2..5)
    const bb = zi.pool[5];
    bb.setSize(8, 4); bb.zoom = 0.5;
    zi.ctx.destRect = { left: 2, top: 1, right: 6, bottom: 3 };
    const out = zi.presentFrame();
    expect(out).not.toBe(zi.A);
    expect(zi.A.px[2 * 8 + 4]).toBe(0xabcdef);
    expect(Array.from(out.px as Uint32Array).indexOf(0xabcdef)).toBeGreaterThanOrEqual(0);
    const again = zi.presentFrame();
    expect(again.px.join(',')).toBe(out.px.join(','));
  });
});

describe('Engine: cycle / debug shape', () => {
  it('reports the debug() shape and keeps cycle/slot countdowns independent', () => {
    const e = engine().seed(12345);
    const L = bassLevel(0.5);
    e.render(L);
    const d = e.debug();
    expect(d.cycleLen >= 1500 && d.cycleLen <= 7499).toBe(true);
    expect(d.cycleFrame).toBe(0);
    expect(d.slots.length).toBe(8);
    expect(d.activeWarps).toBe(3);
    expect('bass' in d && 'bassMean' in d && 'beat' in d && 'bigBeat' in d && 'frame' in d && 'zoom' in d).toBe(true);
    const s1 = d.slots[0];
    expect(s1.index === 1 && s1.category === 3 && s1.effectName === 'Shift').toBe(true);
    expect(typeof s1.framesLeft === 'number' && typeof s1.state === 'number' &&
      typeof s1.stateFrames === 'number' && typeof s1.transitionLen === 'number').toBe(true);

    // cycle lengths are drawn uniformly from 1500..7499 with the max-exclusive idiom
    let min = 1e9, max = -1;
    for (let i = 0; i < 4000; i++) {
      const len = 1500 + ((A as any).rand() % 6000);
      if (len < min) min = len; if (len > max) max = len;
    }
    expect(min >= 1500 && max <= 7499).toBe(true);

    // the reroll only resets its own counter — slot countdowns are independent of the cycle
    const e2 = engine().seed(777);
    for (let i = 0; i < 40; i++) e2.render(L);
    e2.cycleFramesLeft = 1;
    const slotBefore = e2.cycle.slots.map((s: any) => s.framesLeft);
    e2.render(L);
    expect(e2.cycleFramesLeft >= 1500).toBe(true);
    expect(e2.cycle.slots.map((s: any) => s.framesLeft).join(',')).toBe(slotBefore.map((v: number) => v - 1).join(','));
  });
});

describe('Engine: IToleranceVis colours (18000734c, 180009550, 180009300)', () => {
  it('parses "#RRGGBB" as the DLL does: 7 units, the first skipped, six hex digits, else black', () => {
    expect(parseColor('#A4EB0C')).toBe(0xa4eb0c);
    expect(parseColor('x366ab3')).toBe(0x366ab3);
    expect(parseColor('black')).toBe(0);
    expect(parseColor('#A4EB0G')).toBe(0);
    expect(parseColor('#A4EB0C ')).toBe(0);
  });
  it('colours the surfaces only before the first Render; afterwards only the per-frame copy', () => {
    const e = engine().seed(1);
    e.setColor('#A4EB0C');                          // foregroundColor: the same setter
    e.setProperty('backgroundcolor', '#366AB3');    // case-insensitive name
    e.setProperty('Other', '#FFFFFF');              // ignored
    expect(e.A.px[0]).toBe(0x366ab3);
    expect(e.B.px[e.B.px.length - 1]).toBe(0x366ab3);
    e.render(level(2));
    expect(e.ctx.bgColor).toBe(0x366ab3);
    e.setProperty('BackgroundColor', '#000000');
    expect(e.A.px[0]).toBe(0x366ab3);               // no repaint after the first Render
    e.render(level(2));
    expect(e.ctx.bgColor).toBe(0);
  });
});
