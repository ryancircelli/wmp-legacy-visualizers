// tests/engine/battery-draws-b.test.ts — ported from tests/battery-draws-b.test.js.
// Asserts spec/battery/14-battery-draw-b.md for src/engine/battery/draws.ts. Every numeric fixture
// below is a port of spec/battery/vectors-draw-b.py's output (the oracle) — do not "correct" them.
// Same assertions as the old harness (252 checks); see each `describe` for the old vs new count.
// Deliberately imports ONLY draws.ts (not draws-a.ts), matching the old test's load of
// 72-battery-draws.js alone: CDotPlane/CJDar (registry slots 6/7) are unfilled here.
/* eslint-disable @typescript-eslint/restrict-plus-operands -- engine types are still settling (@ts-nocheck); these mirror tests/adapters/harness.ts's precedent */
import { describe, it, expect } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/battery/draws';

const D = A.BatteryDraws as unknown as Record<string, any> & {
  prim: Record<string, any>; registry: string[]; list(): (undefined | (new () => any))[];
};
const prim = D.prim;

const W = 384, H = 288;
function newBuf(w: number, h: number) { return new Uint8Array(w * h); }
interface Level { freq: [Uint8Array, Uint8Array]; wave: [Uint8Array, Uint8Array]; state: number; timeStamp: number }
interface Ctx { buf: Uint8Array; w: number; h: number; level: Level; frame: number; pre: boolean; audio: object }
function mkCtx(buf: Uint8Array, w: number, h: number, level: Level, frame?: number): Ctx {
  return { buf, w, h, level, frame: frame || 0, pre: false, audio: {} };
}
function mkLevel(f0: (i: number) => number, f1: (i: number) => number, w0: (i: number) => number, w1: (i: number) => number): Level {
  const mk = (fn: (i: number) => number) => { const a = new Uint8Array(1024); for (let i = 0; i < 1024; i++) a[i] = fn(i); return a; };
  return { freq: [mk(f0), mk(f1)], wave: [mk(w0), mk(w1)], state: 2, timeStamp: 0 };
}
const ZERO = mkLevel(() => 0, () => 0, () => 128, () => 128);

// A buffer that reports out-of-range stores instead of silently dropping them (JS typed arrays drop
// them, which is what the DLL's overrun did to the heap — but a port must not rely on it).
function guarded(w: number, h: number) {
  const raw = new Uint8Array(w * h), bad: number[] = [];
  const buf = new Proxy(raw, {
    set(t, k, v) {
      const i = Number(k);
      if (Number.isInteger(i)) { if (i < 0 || i >= t.length) bad.push(i); else t[i] = v; }
      else (t as unknown as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
    get(t, k) { return t[k as unknown as number]; },
  });
  return { buf, raw, bad };
}
function spy(name: string) {                       // record prim.<name> calls, suppress the drawing
  const saved = prim[name], calls: unknown[][] = [];
  prim[name] = function (...args: unknown[]) { calls.push(args); };
  return { calls, restore() { prim[name] = saved; } };
}

// ================================================================ §1.3 LineClamped
// old: 6 checks
describe('§1.3 LineClamped', () => {
  it('clamps x0,y0,x1,y1 into range and never writes past the buffer', () => {
    // 0x180413c20 clamps ALL FOUR coordinates: x0 and x1 against [rcx+0x8] (width) at 0x180413c33 /
    // 0x180413c61, y0 and y1 against [rcx+0xc] (height) at 0x180413c4c / 0x180413c78 — y1 arrives in
    // the callee's [rsp+0x28] and leaves clamped in the same slot before the tail jmp to Line.
    // FUNCTION-MAP-WMP.md §3.15's "clamps x0, y0, x1 but not y1" is wrong; there is no such bug.
    const a = newBuf(8, 8), b = newBuf(8, 8);
    prim.LineClamped(a, 8, 8, -5, -5, 18, 5, 9);
    prim.Line(b, 8, 0, 0, 7, 5, 9);
    expect(Array.from(a), 'LineClamped clamps x0,y0,x1 into range').toEqual(Array.from(b));

    // y1 is clamped too, so the walk can never leave the buffer: the drawn line is the one to
    // (x1, h-1), not the steeper unclamped one, and nothing is written past w*h.
    const small = guarded(8, 8), ref = newBuf(8, 8);
    prim.LineClamped(small.buf, 8, 8, 0, 0, 7, 20, 9);
    prim.Line(ref, 8, 0, 0, 7, 7, 9);
    expect(Array.from(small.raw), 'LineClamped clamps y1 to h-1').toEqual(Array.from(ref));
    expect(small.bad.length, 'LineClamped never writes past the buffer').toBe(0);

    const neg = guarded(8, 8), ref2 = newBuf(8, 8);
    prim.LineClamped(neg.buf, 8, 8, 0, 5, 7, -20, 9);
    prim.Line(ref2, 8, 0, 5, 7, 0, 9);
    expect(Array.from(neg.raw), 'LineClamped clamps a negative y1 to 0').toEqual(Array.from(ref2));
    expect(neg.bad.length, 'LineClamped with y1 < 0 writes nothing below the buffer').toBe(0);

    // degenerate Line writes exactly one pixel (both loop bounds are <=).
    const c = guarded(8, 8);
    prim.Line(c.buf, 8, 3, 3, 3, 3, 7);
    expect(Array.from(c.raw).filter((v) => v).length, 'Line(x,y,x,y) writes exactly one pixel').toBe(1);
  });
});

// ================================================================ §2 CEdgeGradiant
// old: 11 checks
describe('§2 CEdgeGradiant', () => {
  it('0<->255 triangle on the border, period exactly 514 frames', () => {
    const e = new D.CEdgeGradiant();
    expect(e.compatMask, 'CEdgeGradiant compat mask').toBe(1);
    expect(e.v, 'CEdgeGradiant ctor v').toBe(0);
    expect(e.step, 'CEdgeGradiant ctor step').toBe(1);
    const buf = newBuf(W, H), ctx = mkCtx(buf, W, H, ZERO);
    const seq: number[] = [];
    const states: [number, number][] = [[0, 1]];
    for (let f = 0; f < 520; f++) { e.draw(ctx); seq.push(buf[0] as number); states.push([e.v, e.step]); }
    expect(seq.slice(0, 6), 'CEdgeGradiant frames 1..6').toEqual([1, 2, 3, 4, 5, 6]);
    expect(seq.slice(253, 260), 'CEdgeGradiant frames 254..260').toEqual([254, 255, 0, 255, 254, 253, 252]);
    expect(seq.slice(509, 516), 'CEdgeGradiant frames 510..516').toEqual([2, 1, 0, 255, 0, 1, 2]);
    expect(states[514], 'CEdgeGradiant state(514) == state(0): period is 514').toEqual(states[0]);
    // the unsigned compare emits one extra 0 (frame 256, v == 256) and one extra 255 (frame 513, v == -1)
    const win = seq.slice(0, 514);
    expect(win.map((v, i) => v === 0 ? i + 1 : 0).filter(Boolean), 'index 0 frames').toEqual([256, 512, 514]);
    expect(win.map((v, i) => v === 255 ? i + 1 : 0).filter(Boolean), 'index 255 frames').toEqual([255, 257, 513]);
    // all four borders carry the same index, and only the border.
    e.draw(ctx);
    const c = buf[0];
    expect(buf[W - 1] === c && buf[(H - 1) * W] === c && buf[H * W - 1] === c, 'four corners painted').toBe(true);
    expect(buf[W + 1], 'the interior is untouched').toBe(0);
  });
});

// ================================================================ §3 CCosEdgeGradiant
// old: 26 checks
describe('§3 CCosEdgeGradiant', () => {
  it('phase/index sequence, cycle lengths, byte wrap, and randomize range', () => {
    const e = new D.CCosEdgeGradiant();
    expect(e.compatMask, 'CCosEdgeGradiant compat mask').toBe(1);
    expect(e.dbl0, 'CCosEdgeGradiant ctor dbl0 (phase increment)').toBe(0);
    // strawberryaid (MUI 5719), dbl1 = 0.0806421126 — vectors-draw-b.py
    const fx: [number, number][] = [[0.0806421126, 253], [0.1612842252, 250], [0.2419263378, 246], [0.3225684504, 240],
      [0.40321056299999997, 233], [0.48385267559999995, 224], [0.5644947882, 214],
      [0.6451369008, 203]];
    e.dbl0 = 0.0806421126;
    const buf = newBuf(W, H), ctx = mkCtx(buf, W, H, ZERO);
    fx.forEach(([ph, idx], i) => {
      e.draw(ctx);
      expect(e.phase, 'CCosEdgeGradiant frame ' + (i + 1) + ' phase').toBe(ph);
      expect(buf[0], 'CCosEdgeGradiant frame ' + (i + 1) + ' index').toBe(idx);
    });
    // the 78th increment is the first to exceed the float-derived 2pi, so the cycle is 78 frames.
    const f2 = new D.CCosEdgeGradiant(); f2.dbl0 = 0.0806421126;
    const seq: number[] = [];
    for (let f = 0; f < 79; f++) { f2.draw(ctx); seq.push(buf[0] as number); }
    expect(f2.phase, 'CCosEdgeGradiant frame 79 repeats frame 1 (78-frame cycle)').toBe(0.0806421126);
    expect(seq[77], 'frame 78 resets the phase to 0 and emits trunc(cos(0)*253+1) = 254').toBe(254);
    const f3 = new D.CCosEdgeGradiant(); f3.dbl0 = 0.00978911748;   // hizodge (5723)
    let n = 0; do { f3.draw(ctx); n++; } while (f3.phase !== 0.0);
    expect(n, 'hizodge cycle length').toBe(642);
    // signed cvttsd2si + BYTE store: the index runs backwards down from 255 while cos < 0.
    ([[1.58, 255], [1.585, 254], [1.5695, 1]] as [number, number][]).forEach(([ph, idx]) => {
      const p = new D.CCosEdgeGradiant(); p.dbl0 = ph; p.draw(ctx);
      expect(buf[0], 'CCosEdgeGradiant byte wrap at phase ' + ph).toBe(idx);
    });
    // randomize: 0 .. 0.09, float32 chain
    A.srand(12345);
    let mn = 1, mx = -1;
    for (let i = 0; i < 4000; i++) { const p = new D.CCosEdgeGradiant(); p.randomize(); mn = Math.min(mn, p.dbl0); mx = Math.max(mx, p.dbl0); }
    expect(mn >= 0 && mx <= 0.09000000357627869, 'CCosEdgeGradiant randomize range').toBe(true);
    A.srand(1);
    const probe = new D.CCosEdgeGradiant(); probe.randomize();
    A.srand(1);
    expect(probe.dbl0, 'randomize is one rand() in float32').toBe(Math.fround(Math.fround(A.rand() / 32767) * 0.09000000357627869));
  });
});

// ================================================================ §4 CWaveEdge
// old: 16 checks
describe('§4 CWaveEdge', () => {
  it('waveform/spectrum border trace never writes out of bounds and skips exactly the documented corners', () => {
    const e = new D.CWaveEdge();
    expect(e.compatMask, 'CWaveEdge compat mask').toBe(1);
    expect(e.dbl0, 'CWaveEdge ctor dbl0 (0 = waveform)').toBe(0);
    const L = mkLevel((i) => (i + 1) & 0xff, (i) => (200 - i) & 0xff, (i) => (i * 3) & 0xff, (i) => (i * 5 + 1) & 0xff);
    const g = guarded(W, H), ctx = mkCtx(g.buf, W, H, L);
    g.raw.fill(0xaa);
    e.draw(ctx);
    expect(g.bad.length, 'CWaveEdge never writes out of bounds').toBe(0);
    expect(g.raw[0], 'top row from wave[0]').toBe(L.wave[0][0]);
    expect(g.raw[W - 2], 'top row last written column is w-2').toBe(L.wave[0][W - 2]);
    expect(g.raw[W - 1], '(w-1, 0) is skipped by the top run, written once by the right column').toBe(L.wave[1][0]);
    expect(g.raw[(H - 1) * W + 5], 'bottom row from wave[1]').toBe(L.wave[1][5]);
    expect(g.raw[3 * W], 'left column from wave[0]').toBe(L.wave[0][3]);
    expect(g.raw[3 * W + W - 1], 'right column from wave[1]').toBe(L.wave[1][3]);
    expect(g.raw[(H - 2) * W + W - 1], 'right column last written row is h-2').toBe(L.wave[1][H - 2]);
    expect(g.raw[H * W - 1], 'CWaveEdge NEVER writes (w-1, h-1)').toBe(0xaa);
    expect(g.raw[(H - 1) * W], '(0, h-1) written once, by the bottom run').toBe(L.wave[1][0]);
    // (0,0) is written twice, same byte either way
    expect(g.raw[0], '(0,0) written twice with the same value').toBe(L.wave[0][0]);
    // dbl0 != 0 -> spectrum
    const s = new D.CWaveEdge(); s.dbl0 = 1;
    const g2 = guarded(W, H);
    s.draw(mkCtx(g2.buf, W, H, L));
    expect(g2.raw[0], 'dbl0 = 1 selects the spectrum').toBe(L.freq[0][0]);
    expect(g2.raw[(H - 1) * W + 7], 'spectrum channel 1 on the bottom row').toBe(L.freq[1][7]);
    A.srand(7);
    const vals = new Set<number>();
    for (let i = 0; i < 200; i++) { const p = new D.CWaveEdge(); p.randomize(); vals.add(p.dbl0); }
    expect(Array.from(vals).sort(), 'CWaveEdge randomize is rand() % 2').toEqual([0, 1]);
  });
});

// ================================================================ §5 CSpectrumEdge
// old: 26 checks
describe('§5 CSpectrumEdge', () => {
  it('the 15-frame boxcar ring, its three colour styles, its guards, and its randomize ranges', () => {
    const e = new D.CSpectrumEdge();
    expect(e.compatMask, 'CSpectrumEdge compat mask').toBe(1);
    expect(e.hist.length, 'CSpectrumEdge history is exactly 15 entries').toBe(15);
    // drinkdeep (5703): dbl1=7, dbl2=16, dbl3=7, synthetic freq0[i] = i & 255, freq1[i] = (255-i) & 255
    const L = mkLevel((i) => i & 255, (i) => (255 - i) & 255, () => 128, () => 128);
    e.dbl0 = 7; e.dbl1 = 16; e.dbl2 = 7;
    const g = guarded(W, H), ctx = mkCtx(g.buf, W, H, L);
    ([[1, 1, 2032, 2032, 16], [2, 2, 2032, 4064, 32], [3, 3, 2032, 6096, 48]] as [number, number, number, number, number][]).forEach(([f, idx, hi, , v]) => {
      e.draw(ctx);
      expect(e.idx, 'drinkdeep frame ' + f + ' ring index').toBe(idx);
      expect(e.hist[e.idx], 'drinkdeep frame ' + f + ' hist[idx]').toBe(hi);
      expect(g.raw[0], 'drinkdeep frame ' + f + ' border index').toBe(v);
    });
    for (let f = 0; f < 10; f++) e.draw(ctx);
    expect(g.raw[0], 'drinkdeep steady state: 7*2032/(7*16) = 127 -> 0.9f -> 114').toBe(114);
    expect(g.bad.length, 'CSpectrumEdge never writes out of bounds').toBe(0);
    // three styles
    const styles: [number, number][] = [[0, 128], [4, 127], [7, 114]];   // invert / pass-through / 0.9f gain
    styles.forEach(([d1, want]) => {
      const p = new D.CSpectrumEdge(); p.dbl0 = d1; p.dbl1 = 16; p.dbl2 = 7;
      const b = newBuf(W, H), c = mkCtx(b, W, H, L);
      for (let f = 0; f < 13; f++) p.draw(c);
      expect(b[0], 'CSpectrumEdge style dbl1 = ' + d1).toBe(want);
    });
    // the two inert shipped instances: dbl3 = 0 fails `dbl3 > 0.0`, Draw does nothing at all
    ([['event horizon', 159, 59, 0], ['the world', 214, 106, 0]] as [string, number, number, number][]).forEach(([nm, d1, d2, d3]) => {
      const p = new D.CSpectrumEdge(); p.setParams([d1, d2, d3]);
      const gg = guarded(W, H), c = mkCtx(gg.buf, W, H, L);
      for (let f = 0; f < 50; f++) p.draw(c);
      expect(Array.from(gg.raw).filter((v) => v).length, nm + ': CSpectrumEdge is inert (guard fails)').toBe(0);
      expect(p.idx, nm + ': the ring does not even advance').toBe(0);
    });
    // the other three guards
    const cases: [string, number[]][] = [['dbl2 = 0 (no bin span)', [7, 0, 7]], ['(int)dbl3 >= 16', [7, 16, 16]],
      ['(int)dbl2 >= 1023', [7, 1023, 7]]];
    cases.forEach(([nm, p]) => {
      const q = new D.CSpectrumEdge(); q.setParams(p);
      const b = newBuf(W, H); q.draw(mkCtx(b, W, H, L));
      expect(Array.from(b).filter((v) => v).length, 'CSpectrumEdge guard: ' + nm).toBe(0);
    });
    // randomize ranges, and that a randomized instance always passes the guard
    A.srand(99);
    let d1mn = 9e9, d1mx = -1, d3mn = 9e9, d3mx = -1;
    const d2s = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      const p = new D.CSpectrumEdge(); p.randomize();
      d1mn = Math.min(d1mn, p.dbl0); d1mx = Math.max(d1mx, p.dbl0);
      d2s.add(p.dbl1); d3mn = Math.min(d3mn, p.dbl2); d3mx = Math.max(d3mx, p.dbl2);
    }
    expect(d1mn === 0 && d1mx === 9, 'randomize dbl1 in 0..9').toBe(true);
    expect(Array.from(d2s).sort((a, b) => a - b), 'randomize dbl2 in 2,4..20').toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(d3mn === 4 && d3mx === 14, 'randomize dbl3 in 4..14').toBe(true);
  });
});

// ================================================================ §6 CEdgeTrace
// old: 15 checks
describe('§6 CEdgeTrace', () => {
  it('a single position marches 4 px/frame clockwise round all four edges, carried across corners', () => {
    const e = new D.CEdgeTrace();
    expect(e.compatMask, 'CEdgeTrace compat mask').toBe(1);
    expect(e.dbl0, 'CEdgeTrace ctor dash spacing is 50').toBe(50.0);
    // illuminator (5709), dbl1 = 41 — phase advances 4 px/frame, not 1
    const p = new D.CEdgeTrace(); p.dbl0 = 41;
    const g = guarded(W, H), ctx = mkCtx(g.buf, W, H, ZERO);
    const phases: number[] = [];
    p.draw(ctx); phases.push(p.phase);
    const raw1 = Uint8Array.from(g.raw);
    for (let f = 1; f < 6; f++) { p.draw(ctx); phases.push(p.phase); }
    expect(phases, 'CEdgeTrace phase: +4 px per frame').toEqual([4, 8, 12, 16, 20, 24]);
    expect(g.bad.length, 'CEdgeTrace never writes out of bounds').toBe(0);
    // frame 1, from phase = 0: the exact dash bytes of §6.5
    expect([raw1[1], raw1[2], raw1[3], raw1[4]], 'top dash 0xf5,0xff,0xff,0xf5').toEqual([0xf5, 0xff, 0xff, 0xf5]);
    expect([raw1[W + 2], raw1[W + 3]], 'top dash inner shoulder, lagging 1 and 2 px').toEqual([0xf5, 0xf5]);
    expect([raw1[271 * W], raw1[272 * W], raw1[273 * W], raw1[274 * W]], 'left dash').toEqual([0xf5, 0xff, 0xff, 0xf5]);
    expect([raw1[272 * W + 1], raw1[273 * W + 1]], 'left dash shoulder').toEqual([0xf5, 0xf5]);
    // the four runs and the position carried round each corner
    const tops: number[] = [];
    for (let x = 0; x < W - 1; x++) if (raw1[x] === 0xf5 && raw1[x + 1] === 0xff) tops.push(x + 3);
    expect(tops, 'frame 1 top marks (stop before w-4)').toEqual([4, 45, 86, 127, 168, 209, 250, 291, 332, 373]);
    const rights: number[] = [];
    for (let y = 0; y < H - 1; y++) if (raw1[y * W + W - 1] === 0xf5 && raw1[(y + 1) * W + W - 1] === 0xff) rights.push(y + 3);
    expect(rights, 'carry 414-384=30, then the right edge').toEqual([30, 71, 112, 153, 194, 235, 276]);
    const bots: number[] = [];
    for (let x = W - 1; x > 0; x--) if (raw1[(H - 1) * W + x] === 0xf5 && raw1[(H - 1) * W + x - 1] === 0xff) bots.push(x);
    expect(bots, 'carry 317-288=29, then the bottom anchors w-t').toEqual([355, 314, 273, 232, 191, 150, 109, 68, 27]);
    const lefts: number[] = [];
    for (let y = H - 1; y > 0; y--) if (raw1[y * W] === 0xf5 && raw1[(y - 1) * W] === 0xff) lefts.push(y);
    expect(lefts, 'carry 398-384=14, then the left anchors h-t').toEqual([274, 233, 192, 151, 110, 69, 28]);
    // step / gcd(step,4) frames per revolution: 41 for step 41
    const q = new D.CEdgeTrace(); q.dbl0 = 41;
    const b = newBuf(W, H), c2 = mkCtx(b, W, H, ZERO);
    const seen: number[] = [];
    for (let f = 0; f < 42; f++) { q.draw(c2); seen.push(q.phase); }
    expect(seen[41], 'step 41 repeats every 41 frames').toBe(seen[0]);
    // dbl1 = 0 would divide by zero in the DLL; the port guards instead (open item 8)
    const z = new D.CEdgeTrace(); z.dbl0 = 0;
    const gz = guarded(W, H); z.draw(mkCtx(gz.buf, W, H, ZERO));
    expect(Array.from(gz.raw).filter((v) => v).length, 'dbl1 = 0 draws nothing instead of dividing by zero').toBe(0);
    A.srand(4242);
    let mn = 9e9, mx = -1;
    for (let i = 0; i < 4000; i++) { const r = new D.CEdgeTrace(); r.randomize(); mn = Math.min(mn, r.dbl0); mx = Math.max(mx, r.dbl0); }
    expect(mn === 35 && mx === 64, 'CEdgeTrace randomize: rand() % 30 + 35').toBe(true);
  });
});

// ================================================================ §7 CCircleWaveform
// old: 44 checks
describe('§7 CCircleWaveform', () => {
  it('1-3 polar waveform rings, colour styles, ring centres, and randomize order', () => {
    const e = new D.CCircleWaveform();
    expect(e.compatMask, 'CCircleWaveform compat mask').toBe(2);
    expect(e.dbl1, 'ctor ring count is 1.0').toBe(1.0);
    expect(e.baseRadius, 'ctor base radius is 20').toBe(20);
    expect(e.phase, 'ctor phase').toBe(0.0);
    // sepiaswirl (5707): dbl1=1 (colour = raw sample), dbl2=1 ring, dbl3=0.590983328, freq0[0]=200,
    // wave0[i] = 128 + trunc(100 sin(2pi i/64)), wave1[i] = 128 + trunc(80 cos(2pi i/48)).
    const L = mkLevel((i) => (i === 0 ? 200 : 0), () => 0,
      (i) => (128 + Math.trunc(100 * Math.sin(2 * Math.PI * i / 64))) & 0xff,
      (i) => (128 + Math.trunc(80 * Math.cos(2 * Math.PI * i / 48))) & 0xff);
    const p = new D.CCircleWaveform(); p.setParams([1, 1, 0.590983328]);
    const s = spy('LineClamped');
    const g = guarded(W, H);
    p.draw(mkCtx(g.buf, W, H, L));
    s.restore();
    expect(s.calls.length, 'n = trunc(0.590983328 * 1024) = 605, two polylines, i=0 seeds only').toBe((605 - 1) * 2);
    // [i, wave0, r1, P1x, P1y, wave1, r2, P2x, P2y] — vectors-draw-b.py
    const fx: [number, number, number, number, number, number, number, number, number][] = [
      [0, 128, 76.0, 268, 144, 208, 111.0, 303, 144],
      [1, 137, 79.9375, 271, 144, 207, 110.5625, 302, 144],
      [2, 147, 84.3125, 276, 144, 205, 109.6875, 301, 143],
      [151, 205, 109.6875, 269, 221, 176, 97.0, 260, 76],
      [302, 30, 33.125, 192, 177, 108, 67.25, 192, 77],
    ];
    fx.forEach(([i, w0, , x1, y1, w1, , x2, y2]) => {
      expect(L.wave[0][i], 'fixture wave0[' + i + ']').toBe(w0);
      expect(L.wave[1][i], 'fixture wave1[' + i + ']').toBe(w1);
      if (i === 0) {          // i = 0 draws nothing but seeds both previous points
        expect((s.calls[0] as number[]).slice(3, 7), 'i=0 seeds polyline 1 at (268,144)').toEqual([268, 144, 271, 144]);
        expect((s.calls[1] as number[]).slice(3, 7), 'i=0 seeds polyline 2 at (303,144)').toEqual([303, 144, 302, 144]);
        return;
      }
      const c1 = s.calls[(i - 1) * 2] as number[], c2 = s.calls[(i - 1) * 2 + 1] as number[];
      expect(c1.slice(5, 8), 'CCircleWaveform i=' + i + ' polyline 1 -> (' + x1 + ',' + y1 + ')').toEqual([x1, y1, w0]);
      expect(c2.slice(5, 8), 'CCircleWaveform i=' + i + ' polyline 2 -> (' + x2 + ',' + y2 + ')').toEqual([x2, y2, w1]);
    });
    // i = 302 of 605: the angle is ~pi/2, so both points sit on the vertical through the centre, one
    // below and one above. This is the assertion that the sweep is pi and that polyline 2 mirrors Y.
    const a302 = s.calls[301 * 2] as number[], b302 = s.calls[301 * 2 + 1] as number[];
    expect(a302[5], 'i=302 polyline 1 x == cx (sweep is pi, not 2pi)').toBe(192);
    expect((a302[6] as number) > 144 && (b302[6] as number) < 144, 'polyline 1 below the centre, polyline 2 above it').toBe(true);
    // amp uses freq0[0] only, once per Draw; in silence the ring collapses to baseRadius = 20
    {
      const q = new D.CCircleWaveform(); q.setParams([2, 1, 0.01]);
      const sp = spy('LineClamped');
      q.draw(mkCtx(newBuf(W, H), W, H, mkLevel(() => 0, () => 0, () => 255, () => 255)));
      sp.restore();
      expect((sp.calls[0] as number[]).slice(3, 7), 'amp = 0 -> radius 20 (n = 10, i = 1 at pi/10)').toEqual([212, 144, 211, 150]);
      expect((sp.calls[0] as number[])[7], 'colour style 2 is index 255').toBe(0xff);
    }
    // dbl3 > 1.0 is clamped and WRITTEN BACK into the parameter
    {
      const q = new D.CCircleWaveform(); q.setParams([2, 1, 1.5]);
      const sp = spy('LineClamped');
      q.draw(mkCtx(newBuf(W, H), W, H, ZERO));
      sp.restore();
      expect(q.dbl2, 'dbl3 > 1.0 is written back as 1.0').toBe(1.0);
      expect(sp.calls.length, 'and n becomes 1024').toBe((1024 - 1) * 2);
    }
    // ring centres: dbl2 = 2 puts ring 1 at (cx - w/8, cy), phase 0
    {
      const q = new D.CCircleWaveform(); q.setParams([2, 2, 0.002]);
      const sp = spy('LineClamped');
      q.draw(mkCtx(newBuf(W, H), W, H, ZERO));
      sp.restore();
      expect((sp.calls[0] as number[])[1], 'LineClamped gets the surface width').toBe(W);
      expect(sp.calls.length, 'two rings x one segment per polyline').toBe(4);
      // the i=0 point of each ring is (centre.x + baseRadius, centre.y): ring 0 sits at angle 0 on the
      // ring of centres (cx + 48), ring 1 at float-pi, where cos*48 = -47.99... and cvttsd2si gives -47.
      expect((sp.calls[0] as number[]).slice(3, 5), 'ring 0 centre is (cx + (w>>3), cy)').toEqual([192 + 48 + 20, 144]);
      expect((sp.calls[2] as number[]).slice(3, 5), 'ring 1 centre is (cx - 47, cy): trunc toward zero').toEqual([192 - 47 + 20, 144]);
    }
    // phase: pi/64 per frame in float32, advancing even when dbl3 = 0 draws nothing
    {
      const q = new D.CCircleWaveform();     // ctor dbl3 = 0 -> no samples
      const sp = spy('LineClamped');
      let want = 0;
      for (let f = 0; f < 5; f++) { q.draw(mkCtx(newBuf(W, H), W, H, ZERO)); want = Math.fround(want + 0.04908738657832146); }
      sp.restore();
      expect(sp.calls.length, 'dbl3 = 0 draws nothing').toBe(0);
      expect(q.phase, 'phase is a float32 accumulator of pi/64 and advances anyway').toBe(want);
    }
    // colour style 0 (2*|v-128|, mod 256) and 3 (triangle over i/n*768)
    {
      const q = new D.CCircleWaveform(); q.setParams([0, 1, 0.005]);
      const sp = spy('LineClamped');
      q.draw(mkCtx(newBuf(W, H), W, H, mkLevel(() => 0, () => 0, (i) => (i * 40) & 0xff, () => 0)));
      sp.restore();
      expect((sp.calls[0] as number[])[7], 'style 0 is 2*|v-128|').toBe((2 * Math.abs(40 - 128)) & 0xff);
      expect((sp.calls[1] as number[])[7], 'style 0 of sample 0 wraps 256 -> 0').toBe((2 * Math.abs(0 - 128)) & 0xff);
      const r = new D.CCircleWaveform(); r.setParams([3, 1, 0.5]);
      const sp2 = spy('LineClamped');
      r.draw(mkCtx(newBuf(W, H), W, H, ZERO));
      sp2.restore();
      const n = 512, tri = (i: number) => { const t = Math.trunc(Math.fround(Math.fround(i / n) * 768)); return ((t >> 8) & 1) ? ~t & 0xff : t & 0xff; };
      expect(sp2.calls.every((c, k) => (c as number[])[7] === tri((k >> 1) + 1)), 'style 3 is a triangle over 0..767').toBe(true);
    }
    // rand() consumption order: r1, r2 -> ring count; r3 -> colour style; r4 -> sample fraction
    {
      A.srand(2024);
      const q = new D.CCircleWaveform(); q.randomize();
      A.srand(2024);
      const r1 = A.rand(), r2 = A.rand(), r3 = A.rand(), r4 = A.rand();
      expect(q.dbl0, 'dbl1 (colour style) comes from the THIRD rand()').toBe(r3 % 4);
      expect(q.dbl1, 'dbl2 (ring count) from the first two').toBe(2 - (r1 % 5 !== 0 ? 1 : 0) + (r2 % 5 === 0 ? 1 : 0));
      expect(q.dbl2, 'dbl3 (sample fraction) from the fourth, in float32')
        .toBe(Math.fround(Math.fround(Math.fround(r4 / 32767) * 0.6000000238418579) + 0.05000000074505806));
      A.srand(31337);
      let mn = 9, mx = 0;
      for (let i = 0; i < 4000; i++) { const z = new D.CCircleWaveform(); z.randomize(); mn = Math.min(mn, z.dbl1); mx = Math.max(mx, z.dbl1); }
      expect(mn === 1 && mx === 3, 'ring count is 1..3').toBe(true);
    }
  });
});

// ================================================================ §8 CJiggyScribble
// old: 24 checks
describe('§8 CJiggyScribble', () => {
  it('the transposed epitrochoid, point/line modes, phase wrap, and the harmonic/dead params', () => {
    const e = new D.CJiggyScribble();
    expect(e.compatMask, 'CJiggyScribble compat mask').toBe(2);
    // cominatcha (5701): 80, 227, 456, 11, 0, 0, 0 with the 6-tap bass bytes 60,80,100,120,140,160
    const L = mkLevel((i) => (i === 0 ? 60 : i === 2 ? 100 : i === 4 ? 140 : 0),
      (i) => (i === 1 ? 80 : i === 3 ? 120 : i === 5 ? 160 : 0), () => 128, () => 128);
    const p = new D.CJiggyScribble(); p.setParams([80, 227, 456, 11, 0, 0, 0]);
    const g = guarded(W, H);
    p.draw(mkCtx(g.buf, W, H, L));
    expect(g.bad.length, 'CJiggyScribble point mode never writes out of bounds').toBe(0);
    expect(p.phase, 'dbl5 = 0 -> the phase never leaves 0 (all six shipped instances)').toBe(0.0);
    // [i, x, y] — vectors-draw-b.py. i=0 is the transposition assertion: straight DOWN, not right.
    ([[0, 192, 287], [1, 204, 286], [2, 217, 283], [114, 175, 144], [455, 179, 286]] as [number, number, number][]).forEach(([i, x, y]) => {
      expect(g.raw[y * W + x], 'CJiggyScribble i=' + i + ' plots (' + x + ',' + y + ')').toBe(0xff);
    });
    expect(g.raw[144 * W + 335], 'the untransposed point (cx+ax, cy+ay) = (335,144) is NOT plotted').toBe(0);
    expect(Array.from(g.raw).filter((v) => v === 0xff).length, 'dbl3 = 456 points, all in index 0xFF').toBe(456);
    // line mode (dbl7 == 9) seeds the polyline with P(0), so i = 0 draws a degenerate 1-px segment
    {
      const q = new D.CJiggyScribble(); q.setParams([80, 227, 1, 11, 0, 0, 9]);
      const gg = guarded(W, H);
      q.draw(mkCtx(gg.buf, W, H, L));
      expect(Array.from(gg.raw).filter((v) => v).length, 'line mode: the seeded i=0 segment is one pixel').toBe(1);
      expect(gg.raw[287 * W + 192], 'and it is P(0) = (192,287)').toBe(0xff);
    }
    // phase += dbl5 (NOT dbl4), wrapped by SUBTRACTION
    {
      const q = new D.CJiggyScribble(); q.setParams([80, 227, 0, 11, 0.5, 0, 0]);
      const c = mkCtx(newBuf(W, H), W, H, L);
      for (let f = 0; f < 12; f++) q.draw(c);
      expect(Math.abs(q.phase - 6.0) <= 1e-12, 'phase accumulates dbl5').toBe(true);
      q.draw(c);
      expect(Math.abs(q.phase - (6.5 - 6.2831854820251465)) <= 1e-12, 'the 2pi wrap subtracts, it does not reset').toBe(true);
    }
    // dbl4 is the harmonic multiplier on the inner circle; dbl6 is never read
    {
      const pix = (d4: number, d6: number) => {
        const q = new D.CJiggyScribble(); q.setParams([80, 227, 456, d4, 0, d6, 0]);
        const b = newBuf(W, H); q.draw(mkCtx(b, W, H, L));
        return Array.from(b).map((v, i) => v ? i : -1).filter((i) => i >= 0).join(',');
      };
      expect(pix(11, 0) !== pix(16, 0), 'dbl4 (harmonic) changes the figure').toBe(true);
      expect(pix(11, 0), 'dbl6 is never read by Draw').toBe(pix(11, 9));
    }
    // radMod goes negative when dbl1 > dbl2 (Randomize can produce it; no shipped preset does)
    {
      const q = new D.CJiggyScribble(); q.setParams([103, 40, 456, 11, 0, 0, 0]);
      const gg = guarded(W, H); q.draw(mkCtx(gg.buf, W, H, L));
      expect(gg.bad.length, 'dbl1 > dbl2 inverts the figure without escaping the buffer').toBe(0);
    }
    // randomize: seven draws, in offset order
    {
      A.srand(555);
      const q = new D.CJiggyScribble(); q.randomize();
      A.srand(555);
      const r = [A.rand(), A.rand(), A.rand(), A.rand(), A.rand(), A.rand(), A.rand()];
      expect(q.dbl0, 'randomize dbl1').toBe((r[0] as number) % 100 + 4);
      expect(q.dbl1, 'randomize dbl2').toBe((r[1] as number) % 200 + 40);
      expect(q.dbl2, 'randomize dbl3').toBe((r[2] as number) % 1000 + 300);
      expect(q.dbl3, 'randomize dbl4').toBe((r[3] as number) % 20 + 1);
      expect(q.dbl4, 'randomize dbl5').toBe(Math.fround(Math.fround(Math.fround((r[4] as number) / 32767) * 0.6000000238418579) + 0.05000000074505806));
      expect(q.dbl5, 'randomize dbl6').toBe((r[5] as number) % 10);
      expect(q.dbl6, 'randomize dbl7').toBe((r[6] as number) % 10);
    }
  });
});

// ================================================================ §9 CGalaxy
// old: 17 checks
describe('§9 CGalaxy', () => {
  it('mirrored arms, the 50-star cap, the global spiral phase, and centre drift', () => {
    const e = new D.CGalaxy();
    expect(e.compatMask, 'CGalaxy compat mask').toBe(2);
    // 0x180416477 writes 0x200 to +0x100 (maxX) and 0x18041646d writes 0x160 to +0x104 (maxY).
    // Spec 14 §9.2 had these transposed; spec 15 §3.1 corrects them, and CJDar's box agrees.
    expect([e.maxX, e.maxY, e.marginX, e.marginY], 'CGalaxy ctor box and margins').toEqual([512, 352, 40, 40]);
    const L = mkLevel((i) => (i * 3 + 30) & 0xff, (i) => (200 - i * 2) & 0xff, (i) => (i * 11) & 0xff, (i) => (255 - i) & 0xff);
    // dbl1 = 8 stars, dbl4 = 200 steps / end colour 200, dbl5 != 0 -> Stroke plots points (not lines),
    // dbl6 = 5 -> no centre drift.
    const p = new D.CGalaxy(); p.setParams([8, 0, 0.3, 200, 0.001, 5, 0, 0.1]);
    const s = spy('Stroke');
    p.draw(mkCtx(newBuf(W, H), W, H, L));
    s.restore();
    expect(s.calls.length, '8 stars x two mirrored arms').toBe(16);
    expect((s.calls[0] as number[])[9], 'dbl4 is the Stroke step count').toBe(200);
    expect((s.calls[0] as number[])[10], 'strokes start at index 255').toBe(0xff);
    expect((s.calls[0] as number[])[11], 'and end at (uint8)(int)dbl4').toBe(200);
    expect((s.calls[0] as unknown[])[12], 'dbl5 != 0 -> point mode').toBe(false);
    // the two arms are point-mirrored about the centre, which is what "all four trig calls share one
    // angle" means for the output
    const cx = W >> 1, cy = H >> 1;
    expect((s.calls[0] as number[])[3]! - cx, 'arm 2 mirrors arm 1 in x').toBe(cx - (s.calls[1] as number[])[3]!);
    expect((s.calls[0] as number[])[4]! - cy, 'arm 2 mirrors arm 1 in y').toBe(cy - (s.calls[1] as number[])[4]!);
    // hard cap of 50 stars
    const q = new D.CGalaxy(); q.setParams([80, 0, 0.3, 4, 0.001, 5, 0, 0.1]);
    const s2 = spy('Stroke'); q.draw(mkCtx(newBuf(W, H), W, H, L)); s2.restore();
    expect(s2.calls.length, 'the star count is capped at 50').toBe(100);
    // the global phase integrates bass * dbl3 and wraps by subtraction
    const bass = ((L.freq[0][0] as number) + (L.freq[0][2] as number) + (L.freq[0][4] as number) +
      (L.freq[1][1] as number) + (L.freq[1][3] as number) + (L.freq[1][5] as number)) / 1530.0;
    const r = new D.CGalaxy(); r.setParams([0, 0, 1.0, 4, 0.001, 5, 0, 0.1]);
    r.draw(mkCtx(newBuf(W, H), W, H, L));
    expect(Math.abs(r.phase - bass) <= 1e-12, 'phase += bass * dbl3').toBe(true);
    // dbl6 < 2 enables the centre drift, and the box is reset from the surface every frame
    const t = new D.CGalaxy(); t.setParams([0, 0, 0.3, 4, 0.001, 0, 0, 0.1]); t.vx = 2.0; t.vy = -1.0;
    t.draw(mkCtx(newBuf(W, H), W, H, L));
    expect([t.maxX, t.maxY, t.minX, t.minY], 'the drift box is reset to +-(w,h) each frame').toEqual([W, H, -W, -H]);
    expect(t.posX !== 0 || t.posY !== 0, 'the centre drifts when dbl6 < 2').toBe(true);
    const u = new D.CGalaxy(); u.setParams([0, 0, 0.3, 4, 0.001, 5, 0, 0.1]); u.vx = 2.0;
    u.draw(mkCtx(newBuf(W, H), W, H, L));
    expect(u.posX, 'and does not when dbl6 >= 2').toBe(0);
    // Stroke: n = 0 returns, the degenerate arc plots, colour interpolates c0 -> c1
    {
      const g = guarded(W, H);
      prim.Stroke(g.buf, W, H, 10, 10, 20, 10, 10, 10, 0, 255, 200, false, 0);
      expect(Array.from(g.raw).filter((v) => v).length, 'Stroke with n = 0 draws nothing').toBe(0);
      prim.Stroke(g.buf, W, H, 10, 10, 20, 10, 10, 10, 8, 255, 200, false, 0);
      expect(Array.from(g.raw).filter((v) => v).length > 0, 'Stroke plots its steps').toBe(true);
      expect(g.bad.length, 'Stroke point mode is bounds-checked').toBe(0);
    }
  });
});

// ============================================ spec 15 §1 — Stroke, 0x180413ca0, read in full
// old: 14 checks
describe('spec 15 §1 — Stroke (0x180413ca0)', () => {
  it('the four wrap modes, colour ramp, easing, the atan2 zero-guard, and n<=0', () => {
    // Every row below is the pixel sequence a 4-step Stroke writes, taken from the traced loop at
    // 0x180413eb8..0x180414031 (accumulated ang/env/colour, env stepping by the float32 pi/(2n)).
    // Geometry: pivot (10,10), start (20,10) -> r0 = 10, th0 = 0.
    function points(x1: number, y1: number, mode: number, n?: number): [number, number, number][] {
      const out: [number, number, number][] = [], S = 64;
      const buf = new Proxy(new Uint8Array(S * S), {
        set(t, k, v) { const i = Number(k); if (Number.isInteger(i)) { out.push([i % S, (i / S) | 0, v as number]); t[i] = v; } else (t as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
        get(t, k) { return t[k as unknown as number]; },
      });
      prim.Stroke(buf, S, S, 20, 10, x1, y1, 10, 10, n === undefined ? 4 : n, 255, 200, false, mode);
      return out;
    }
    const flat = (a: [number, number, number][]) => a.map((p) => p.join(',')).join(' ');

    // end (5,15): th1 = 3pi/4 = 2.3561944901923448 < pi.
    expect(flat(points(5, 15, 0)), 'mode 0 keeps dth when dth < pi').toBe('20,10,255 17,14,241 13,17,227 8,17,213');
    expect(flat(points(5, 15, 3)), "CJDar's mode 3 == CGalaxy's mode 0").toBe('20,10,255 17,14,241 13,17,227 8,17,213');
    expect(flat(points(5, 15, 2)), 'mode 2 never wraps').toBe('20,10,255 17,14,241 13,17,227 8,17,213');
    expect(flat(points(5, 15, 4)), 'mode 4 wraps when dth < pi').toBe('20,10,255 14,2,241 6,2,227 2,8,213');
    expect(flat(points(5, 15, 1)), 'mode 1 always wraps').toBe('20,10,255 14,2,241 6,2,227 2,8,213');
    // end (5,5): th1 = 5pi/4 = 3.9269909918328016 >= pi.
    expect(flat(points(5, 5, 0)), 'mode 0 wraps when dth >= pi').toBe('20,10,255 17,5,241 13,2,227 8,2,213');
    expect(flat(points(5, 5, 3)), 'mode 3 wraps when dth >= pi').toBe('20,10,255 17,5,241 13,2,227 8,2,213');
    expect(flat(points(5, 5, 2)), 'mode 2 still never wraps').toBe('20,10,255 14,17,241 6,17,227 2,11,213');
    expect(flat(points(5, 5, 4)), 'mode 4 keeps dth when dth >= pi').toBe('20,10,255 14,17,241 6,17,227 2,11,213');
    // the atan2 zero guard is on the X difference only: x1 == px forces th1 = 0, so dth = 0 and the
    // whole stroke collapses onto its first point. Original bug, reachable from CGalaxy.
    expect(flat(points(10, 20, 0)), 'x1 == px degenerates the arc to a single point (a2 != 0 guard)')
      .toBe('20,10,255 20,10,241 20,10,227 20,10,213');
    // n steps, k = 0 first: the colour ramp is c0, c0 + dCol, ... and never reaches c1.
    expect(points(5, 15, 0, 8).map((p) => p[2]).join(','), 'colour accumulates c0 + k*(c1-c0)/n and stops one step short of c1')
      .toBe('255,248,241,234,227,220,213,206');
    // env sweeps [0, pi/2) so the radius eases from exactly r0 towards — but never reaching — r1
    expect(points(5, 15, 0, 1).map((p) => p.join(',')).join(' '), 'n = 1 draws exactly the start point at colour c0').toBe('20,10,255');

    // line mode starts from (x0,y0), so segment 0 is zero length.
    {
      const saved = prim.LineClamped, segs: string[] = [];
      prim.LineClamped = function (...args: unknown[]) { segs.push(args.slice(3, 8).join(',')); };
      prim.Stroke(new Uint8Array(64 * 64), 64, 64, 20, 10, 5, 15, 10, 10, 4, 255, 200, true, 0);
      prim.LineClamped = saved;
      expect(segs, 'line mode chains from (x0,y0); the first segment is degenerate')
        .toEqual(['20,10,20,10,255', '20,10,17,14,241', '17,14,13,17,227', '13,17,8,17,213']);
    }
    // n <= 0 draws nothing at all (test ebp,ebp then the signed cmp ebp,1)
    {
      const g = guarded(64, 64);
      prim.Stroke(g.buf, 64, 64, 20, 10, 5, 15, 10, 10, -3, 255, 200, false, 0);
      expect(Array.from(g.raw).filter((v) => v).length, 'negative n draws nothing').toBe(0);
    }
  });
});

// ============================================ spec 15 §2 — Integrate, 0x180418b4c
// old: 12 checks
describe('spec 15 §2 — Integrate (0x180418b4c)', () => {
  it('float32 Euler step, no position clamp, and margin-gated velocity reflection', () => {
    function box(vx: number, vy: number, px: number, py: number) {
      const g = new D.CGalaxy();
      g.vx = vx; g.vy = vy; g.posX = px; g.posY = py;
      g.minX = -W; g.minY = -H; g.maxX = W; g.maxY = H;
      return g;
    }
    const DT = 0.6000000238418579;                     // 0x18088c2d4, CGalaxy's dt
    const g = box(10.0, -3.0, 0.0, 0.0), rows: string[] = [];
    for (let i = 0; i < 6; i++) { g.integrate(DT); rows.push([g.posX, g.posY, g.centreDX, g.centreDY].join(',')); }
    expect(rows, 'Integrate: float32 Euler step at dt = 0.6f, centre truncates TOWARD ZERO').toEqual([
      '6,-1.8000000715255737,6,-1',
      '12,-3.6000001430511475,12,-3',
      '18,-5.400000095367432,18,-5',
      '24,-7.200000286102295,24,-7',
      '30,-9,30,-9',
      '36,-10.800000190734863,36,-10',
    ]);

    // the flip happens marginX early, at centreDX >= maxX - 40, and the position is NOT clamped
    const b = box(100.0, 0.0, 300.0, 0.0);
    b.integrate(DT);
    expect(b.posX, 'Integrate never clamps the position').toBe(360);
    expect(b.vx, 'vx flips when centreDX + marginX >= maxX and vx > 0').toBe(-100);
    b.integrate(DT);
    expect(b.posX, 'and the point walks back out of the wall').toBe(300);
    expect(b.vx, 'without flipping again while it heads inward').toBe(-100);
    // 344 is the last non-flipping centre; 343 + 40 = 383 < 384
    const c1 = box(1.0, 0.0, 342.4, 0.0); c1.integrate(DT); expect(c1.vx, 'centreDX 343: no flip').toBe(1);
    const c2 = box(1.0, 0.0, 343.4, 0.0); c2.integrate(DT); expect(c2.vx, 'centreDX 344: flip').toBe(-1);
    // the lower bound gets NO margin, and the sign gate means an outbound-only reflection
    const d1 = box(-1.0, 0.0, -382.4, 0.0); d1.integrate(DT); expect(d1.vx, 'centreDX -383 is not <= minX yet').toBe(-1);
    const d2 = box(-1.0, 0.0, -383.4, 0.0); d2.integrate(DT); expect(d2.vx, 'centreDX -384 <= minX flips vx').toBe(1);
    const d3 = box(1.0, 0.0, -400.0, 0.0); d3.integrate(DT); expect(d3.vx, 'already heading in: no flip').toBe(1);
    // Y is the same rule with the same margin — the box is not lopsided
    const y1 = box(0.0, 1.0, 0.0, 246.4); y1.integrate(DT); expect(y1.vy, 'centreDY 247: no flip').toBe(1);
    const y2 = box(0.0, 1.0, 0.0, 247.4); y2.integrate(DT); expect(y2.vy, 'centreDY 248 = maxY - marginY: flip').toBe(-1);
  });
});

// ============================================ spec 15 §3 — CGalaxy ctor + Randomize rand() stream
// old: 15 checks
describe('spec 15 §3 — CGalaxy ctor + Randomize rand() stream', () => {
  it('ctor and Randomize draw rand() in exactly the documented order, count, and values', () => {
    // the ctor itself burns two rand()s: vy first, then vx (0x1804164a0 / 0x1804164c7)
    A.srand(1);
    const c = new D.CGalaxy();
    expect(Math.abs(c.vy - 0.007007049862295389) <= 0, 'ctor vy comes from the FIRST rand()').toBe(true);
    expect(Math.abs(c.vx - 3.1560778617858887) <= 0, 'ctor vx comes from the second').toBe(true);

    // 11 draws when dbl5 >= 3, 13 when dbl5 < 3
    function countRands(fn: () => void): number {
      const saved = A.rand; let n = 0;
      A.rand = function () { n++; return saved(); };
      fn(); A.rand = saved; return n;
    }
    A.srand(1);
    expect(countRands(() => new D.CGalaxy()), 'the ctor draws exactly two rand()s').toBe(2);
    A.srand(1);
    const g = new D.CGalaxy();
    expect(countRands(() => g.randomize()), 'Randomize draws 11 rand()s when dbl5 >= 3').toBe(11);
    expect([g.dbl0, g.dbl1, g.dbl2, g.dbl3, g.dbl4, g.dbl5, g.dbl6, g.dbl7], 'Randomize from srand(1): every draw in order').toEqual(
      [5, 78, 0.048389843106269835, 254, 8, 112, 4.4796288989346067e-7, 0.05223243311047554]);
    expect([g.centreDX, g.centreDY, g.posX, g.posY], 'dbl5 = 112 >= 3 leaves the drift origin at 0').toEqual([0, 0, 0, 0]);
    expect([g.vy, g.vx], 'and vy is drawn before vx, as in the ctor').toEqual([4.810083389282227, 3.9788079261779785]);

    A.srand(58);
    const h = new D.CGalaxy();
    expect(countRands(() => h.randomize()), 'Randomize draws 13 when dbl5 < 3 (the extra position pair)').toBe(13);
    expect([h.dbl5, h.centreDX, h.centreDY, h.posX, h.posY], 'the position pair is Y first, then X').toEqual([0, 45, 55, 45, 55]);
    // dbl0 is the star count and it is 1..5, so a randomized CGalaxy always draws
    for (let sd = 1; sd < 200; sd++) {
      A.srand(sd); const z = new D.CGalaxy(); z.randomize();
      if (!(z.dbl0 >= 1 && z.dbl0 <= 5)) { expect(false, 'dbl0 out of 1..5 at seed ' + sd).toBe(true); break; }
      if (sd === 199) expect(true, 'dbl0 (the star count) is 1..5 for every seed').toBe(true);
    }
    // dbl6 is the spring constant (+0x38), not dbl4 (+0x28): dbl4 only selects line mode.
    function drift(spring: number): number {
      const z = new D.CGalaxy();
      z.setParams([0, 0, 0.3, 4, 0, 0, spring, 0]);
      z.vx = 1.0; z.vy = 0.0; z.posX = 100.0; z.posY = 0.0;
      z.draw(mkCtx(newBuf(W, H), W, H, ZERO));
      return z.vx;
    }
    expect(drift(0) !== drift(1e-4), 'dbl6 is the spring constant').toBe(true);
    const noSpring = new D.CGalaxy();
    noSpring.setParams([0, 0, 0.3, 4, 1e-4, 0, 0, 0]);
    noSpring.vx = 1.0; noSpring.vy = 0.0; noSpring.posX = 100.0; noSpring.posY = 0.0;
    noSpring.draw(mkCtx(newBuf(W, H), W, H, ZERO));
    expect(noSpring.vx, 'dbl4 does not feed the spring term').toBe(drift(0));

    // end to end: seed 58 randomizes into the drift branch and draws 5 stars x 2 arms
    A.srand(58);
    const k = new D.CGalaxy(); k.randomize();
    const L2 = mkLevel((i) => (i * 3 + 30) & 0xff, (i) => (200 - i * 2) & 0xff,
      (i) => (i * 11) & 0xff, (i) => (255 - i) & 0xff);
    const sp = spy('Stroke');
    k.draw(mkCtx(newBuf(W, H), W, H, L2));
    sp.restore();
    expect(sp.calls.length, 'srand(58): 5 stars x two arms').toBe(10);
    expect((sp.calls[0] as unknown[]).slice(3), 'srand(58): the first Stroke bundle')
      .toEqual([239, 199, 368, 201, 370, 72, 215, 255, 215, false, 0]);
    expect([k.posX, k.posY, k.centreDX, k.centreDY], 'srand(58): the drift after one frame at dt = 0.6f')
      .toEqual([47.28975296020508, 55.458316802978516, 47, 55]);
  });
});

// ================================================================ §1.4 masks and registry
// old: 4 checks
describe('§1.4 masks and registry', () => {
  it('registry order, compat masks, and the pre-pass suppression rule', () => {
    expect(D.registry, 'the registry order of FUN_18040f470').toEqual(['CEdgeTrace', 'CEdgeGradiant', 'CCosEdgeGradiant', 'CWaveEdge', 'CSpectrumEdge',
      'CCircleWaveform', 'CDotPlane', 'CJDar', 'CGalaxy', 'CJiggyScribble']);
    expect(D.list().length, 'list() keeps all ten registry slots (indices feed ChangeEffects)').toBe(10);
    expect(D.list().map((c) => c ? new c().compatMask : null), 'compat masks: 1 = border/pre-only, 2 = body')
      .toEqual([1, 1, 1, 1, 1, 2, null, null, 2, 2]);
    // RenderChain suppresses a pre-list effect when (shift->compat & effect->compat) != 0, and
    // CTileShift is the only shift with compat 1 => exactly the five border classes, in the pre pass.
    const TILE = 1;
    expect(D.list().map((c) => c ? ((TILE & new c().compatMask) !== 0) : null),
      'CTileShift masks off exactly the five border classes (dance of the freaky circles)')
      .toEqual([true, true, true, true, true, false, null, null, false, false]);
  });
});

// ================================================================ no out-of-bounds writes, 50 frames
// old: 22 checks
describe('no out-of-bounds writes, 50 frames', () => {
  it('every class stays inside a guarded buffer and still draws something, over 50 frames', () => {
    const cases: [string, () => any][] = [
      ['CEdgeGradiant', () => new D.CEdgeGradiant()],
      ['CCosEdgeGradiant', () => { const c = new D.CCosEdgeGradiant(); c.dbl0 = 0.08; return c; }],
      ['CWaveEdge (waveform)', () => new D.CWaveEdge()],
      ['CWaveEdge (spectrum)', () => { const c = new D.CWaveEdge(); c.dbl0 = 1; return c; }],
      ['CSpectrumEdge', () => { const c = new D.CSpectrumEdge(); c.setParams([7, 16, 7]); return c; }],
      ['CEdgeTrace', () => { const c = new D.CEdgeTrace(); c.dbl0 = 41; return c; }],
      ['CEdgeTrace (55)', () => { const c = new D.CEdgeTrace(); c.dbl0 = 55; return c; }],
      ['CCircleWaveform', () => { const c = new D.CCircleWaveform(); c.setParams([1, 3, 0.64]); return c; }],
      ['CJiggyScribble (points)', () => { const c = new D.CJiggyScribble(); c.setParams([30, 120, 666, 19, 0.3, 0, 0]); return c; }],
      ['CJiggyScribble (lines)', () => { const c = new D.CJiggyScribble(); c.setParams([20, 120, 666, 19, 0.3, 0, 9]); return c; }],
      ['CGalaxy', () => { const c = new D.CGalaxy(); c.setParams([12, 0, 0.3, 60, 0.001, 0, 0, 0.1]); return c; }],
    ];
    cases.forEach(([nm, make]) => {
      const inst = make();
      const g = guarded(W, H);
      for (let f = 0; f < 50; f++) {
        // synthetic levels: a slow sweep that keeps CCircleWaveform's rings inside the frame
        const L = mkLevel((i) => (i === 0 ? 40 + f : (i * 5 + f) & 0xff), (i) => (i * 3 + f * 2) & 0xff,
          (i) => (128 + Math.trunc(100 * Math.sin((i + f) / 9))) & 0xff,
          (i) => (128 + Math.trunc(90 * Math.cos((i + f) / 13))) & 0xff);
        inst.draw(mkCtx(g.buf, W, H, L, f));
      }
      expect(g.bad.length, nm + ': no out-of-bounds writes over 50 frames' +
        (g.bad.length ? ' (first: ' + g.bad.slice(0, 4) + ')' : '')).toBe(0);
      expect(Array.from(g.raw).some((v) => v !== 0), nm + ': did draw something').toBe(true);
    });
  });
});
