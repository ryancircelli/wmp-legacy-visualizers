// @vitest-environment node
// Alchemy's WMP versions as presets (alchemy.ts PRESET_VERSIONS): the preset picks the version, a switch to another
// version is a fresh instance of that version's DLL, and the x86 builds' pieces that differ most from WMP 12's
// (Shift's gather + blur, RandomRGB, the x87 products at Pythagorean points). The golden guard
// (tests/engine/golden) holds each version's whole output.
import { describe, expect, it } from 'vitest';
import { A, type Surface } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/effect';
import '../../src/engine/kernels';
import { Shift } from '../../src/engine/shift';
import '../../src/engine/draw';
import '../../src/engine/alchemy';
import { truncAtan2Trig, truncTrig } from '../../src/engine/x86';
import type { EffectCtx } from '../../src/engine/effect';
import { InputGen } from './golden/harness';
import { mirror } from './helpers-2';

function withClock<T>(sec: number, f: () => T): T {
  const now = Date.now;
  Date.now = () => sec * 1000;
  try { return f(); } finally { Date.now = now; }
}
function hashes(e: { render(L: ReturnType<InputGen['next']>): Surface | null }, frames: number, gen = new InputGen()): number[] {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    const px = e.render(gen.next())!.px;
    let h = 0;
    for (let i = 0; i < px.length; i += 7) h = (Math.imul(h, 31) + px[i]!) | 0;
    out.push(h);
  }
  return out;
}

describe('Alchemy versions', () => {
  it('names one preset per WMP version, and the preset picks the version', () => {
    expect(A.Engine.PRESET_NAMES).toEqual(['Random', 'Random (WMP 9)', 'Random (WMP 10)', 'Random (WMP 11)']);
    const vers = [0, 1, 2, 3].map((preset) => new A.Engine({ width: 32, height: 24, preset }).debug().version);
    expect(vers).toEqual([12, 9, 10, 11]);
    expect(new A.Engine({ width: 32, height: 24 }).debug()).toMatchObject({ preset: 0, presetName: 'Random', version: 12 });
    expect(new A.Engine({ width: 32, height: 24, preset: 9 }).debug().version).toBe(12);   // out of range: WMP 12
  });

  it('setPreset: false out of range; the same version carries on; another one is a fresh DLL instance', { timeout: 60_000 }, () => {
    const e = new A.Engine({ width: 64, height: 48 }).seed(5);
    expect(e.setPreset(4)).toBe(false);
    expect(e.setPreset(-1)).toBe(false);
    expect(e.setPreset(1.5)).toBe(false);
    hashes(e, 30);
    expect(e.setPreset(0)).toBe(true);
    expect(e.debug().frame).toBe(30);                  // same version: nothing rebuilt

    // switch to WMP 10 mid-run, at a pinned clock, then pin the seed: frame for frame a new WMP 10 engine
    const gen = new InputGen(77);
    hashes(e, 50, gen);
    expect(withClock(1700000000, () => e.setPreset(2))).toBe(true);
    expect(e.debug()).toMatchObject({ preset: 2, version: 10, frame: 0 });
    e.seed(1700000000);
    const got = hashes(e, 400, gen);                   // first: rand() is the one CRT stream, as in the DLL
    expect(new Set(got).size).toBeGreaterThan(100);
    const fresh = withClock(1700000000, () => new A.Engine({ width: 64, height: 48, preset: 2 })).seed(1700000000);
    const gen2 = new InputGen(77);
    for (let f = 0; f < 50; f++) gen2.next();          // the same input from here on
    expect(got).toEqual(hashes(fresh, 400, gen2));
  });

  it('every version responds to the sound, and the x86 builds draw differently from WMP 12', { timeout: 60_000 }, () => {
    const run = (preset: number, silent: boolean) => {
      const e = withClock(1700000000, () => new A.Engine({ width: 96, height: 72, preset })).seed(1700000000);
      const gen = new InputGen();
      return hashes({ render: (L) => { if (silent) { L.freq[0].fill(0); L.freq[1].fill(0); L.wave[0].fill(128); L.wave[1].fill(128); } return e.render(L); } }, 300, gen).join();
    };
    const sound = [0, 1, 2, 3].map((p) => run(p, false));
    for (let p = 1; p < 4; p++) expect(sound[p]).not.toBe(sound[0]);
    for (let p = 0; p < 4; p++) expect(run(p, true)).not.toBe(sound[p]);
  });

  it('x86: the picture moves down 2 rows a frame and the three surfaces rotate (WMP 12: in place)', () => {
    const W = 16, H = 12, mk = (): Surface => A.makeSurface(W, H, 0);
    const ctx = { w: W, h: H, bgColor: 0, A: mk(), B: mk(), C: mk(), options: { intended: false } } as unknown as EffectCtx;
    const [sa, sc] = [ctx.A!, ctx.C!];
    sa.px[5 * W + 7] = 0x808080;
    const s = new Shift(10), tab = Int32Array.from({ length: W * H }, (_, i) => i);   // the identity warp
    s._moveBits({ buf: tab, dirty: false, cursorY: 0, slot: 2 }, ctx, false);
    expect(ctx.A).toBe(sc);                            // D: the next frame's target, presented
    expect(ctx.C).toBe(sa);
    const D = ctx.A!.px;
    expect(D[7 * W + 7]).toBe(0x202020);               // (3 * 0 + 0x80) / 4: the centre, 2 rows down
    expect([D[6 * W + 7], D[8 * W + 7], D[7 * W + 6], D[7 * W + 8]]).toEqual([0x181818, 0x181818, 0x181818, 0x181818]);
    expect(D[5 * W + 7]).toBe(0);

    // a non-black background: WMP 10/11 draw the edge as four lines short of their far ends; WMP 9 none
    for (const ver of [9, 10, 11]) {
      const c = { w: W, h: H, bgColor: 0x123456, A: mk(), B: mk(), C: mk(), options: { intended: false } } as unknown as EffectCtx;
      new Shift(ver)._moveBits({ buf: tab, dirty: false, cursorY: 0, slot: 2 }, c, false);
      const P = c.A!.px, edge = [P[0], P[W - 2], P[(H - 1) * W], P[(H - 1) * W + W - 2], P[(H - 2) * W], P[W - 1], P[(H - 2) * W + W - 1]];
      expect(edge).toEqual(new Array<number>(7).fill(ver === 9 ? 0 : 0x123456));
      expect(P[H * W - 1]).toBe(0);                    // the far corner: no line reaches it, and D's last pixel is never written
      expect(P[3 * W + 3]).toBe(0);
    }

    const ctx12 = { w: W, h: H, bgColor: 0, A: mk(), B: mk(), C: mk(), options: { intended: false } } as unknown as EffectCtx;
    const a12 = ctx12.A!;
    a12.px[5 * W + 7] = 0x808080;
    new Shift()._moveBits({ buf: tab, dirty: false, cursorY: 0, slot: 2 }, ctx12, false);
    expect(ctx12.A).toBe(a12);
    expect(a12.px[5 * W + 7]).toBe(0x202020);           // in place
  });

  it('RandomRGB: WMP 12 puts the draws in G, R, B; the x86 builds in R, G, B', () => {
    const r = mirror(4242), [b1, b2, b3] = [r() & 255, r() & 255, r() & 255];
    A.srand(4242);
    expect(new A.Draw.ColorFader().from).toBe(b3 | (b2 << 16) | (b1 << 8));
    for (const ver of [9, 10, 11]) {
      A.srand(4242);
      expect(new A.Draw.ColorFader(ver).from).toBe(b3 | (b1 << 16) | (b2 << 8));
    }
  });

  it('x87 products at a Pythagorean point land on the whole number the double misses', () => {
    const a = A.atan2(4, 3);
    expect(Math.trunc(A.sin(a) * 5)).toBe(3);         // 3.9999999999999996 in double
    expect(truncAtan2Trig(A.sin(a), 4, 3, 0, 5, 0)).toBe(4);
    expect(truncAtan2Trig(A.cos(a), 4, 3, 0, 5, 1)).toBe(3);
    expect(truncTrig(A.sin(a), a, 5, 0)).toBe(4);
    expect(truncTrig(A.sin(0.3), 0.3, 5, 0)).toBe(Math.trunc(A.sin(0.3) * 5));   // far from a whole number: the double
  });
});
