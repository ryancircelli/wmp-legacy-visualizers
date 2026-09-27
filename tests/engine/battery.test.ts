// Ported from tests/battery.test.js — asserts spec/battery/10-battery-engine.md.
// Every numeric claim below is one of engine_sim.py's asserts, re-expressed against
// src/engine/battery/index.ts (formerly src/75-battery.js).
// Load order mirrors src/engine/index.ts: rand, effect (for A.makeSurface — battery/index.ts itself
// only imports rand.ts), then battery/index (which pulls in warps.ts/draws.ts/draws-a.ts itself, so
// unlike the old vm-sandboxed test there are no "optional sibling modules": every class is real here).
import { describe, expect, it } from 'vitest';
import { A } from '../../src/engine/ns';
import '../../src/engine/rand';
import '../../src/engine/effect';
import '../../src/engine/battery/index';
import { level } from './helpers-2';

const Battery = (A as any).Battery;
const I = Battery.internals;

describe('Battery: blur LUT (§3.2)', () => {
  it('lut[s] = max(1, s/5 - 1) for every s in [0, 1280)', () => {
    const lut: Uint8Array = I.BLUR_LUT;
    expect(lut.length).toBe(0x500);
    let bad = 0;
    for (let s = 0; s < 0x500; s++) if (lut[s] !== Math.max(1, ((s / 5) | 0) - 1)) bad++;
    expect(bad).toBe(0);
    // engine_sim.py's own spot checks
    expect(lut[0]).toBe(1);
    expect(lut[14]).toBe(1);
    expect(lut[15]).toBe(2);
    expect(lut[1279]).toBe(254);
    let lo = 255, hi = 0;
    for (let s = 0; s < 0x500; s++) { if (lut[s]! < lo) lo = lut[s]!; if (lut[s]! > hi) hi = lut[s]!; }
    expect(lo).toBe(1);
    expect(hi).toBe(254);
  });
});

describe('Battery: blur tap wiring (§3.3)', () => {
  it('a plus-neighbourhood 5-tap blur with the DLL\'s wrap quirks', () => {
    const w = 8, h = 6;
    const src = new Uint8Array(w * h), dst = new Uint8Array(w * h);
    src[2 * w + 3] = 100;
    I.blur(src, dst, w, h);
    expect(dst[2 * w + 3]).toBe(19);
    for (const nb of [1 * w + 3, 3 * w + 3, 2 * w + 2, 2 * w + 4]) expect(dst[nb]).toBe(19);
    expect(dst[0]).toBe(1);

    // a flat field decays by exactly one level per frame (5v/5 - 1)
    let a = new Uint8Array(w * h).fill(120), b = new Uint8Array(w * h);
    I.blur(a, b, w, h);
    expect([...b].every((v) => v === 119)).toBe(true);
    for (let i = 0; i < 19; i++) { I.blur(b, a, w, h); const t = a; a = b; b = t; }
    expect([...b].every((v) => v === 100)).toBe(true);

    // the wiring quirks §0 #11: rows 1..h-2 use LINEAR neighbours, only rows 0 / h-1 wrap.
    const q = new Uint8Array(w * h);
    q[1 * w + (w - 1)] = 200;                       // last pixel of row 1
    I.blur(q, dst, w, h);
    expect(dst[2 * w + 0]).toBe(I.BLUR_LUT[200]);
    const r0 = new Uint8Array(w * h);
    r0[w] = 210;                                     // pixel (0,1)
    I.blur(r0, dst, w, h);
    expect(dst[w - 1]).toBe(I.BLUR_LUT[210]);
    const rl = new Uint8Array(w * h);
    rl[0] = 190;                                     // pixel (0,0)
    I.blur(rl, dst, w, h);
    expect(dst[(h - 1) * w + 0]).toBe(I.BLUR_LUT[190]);
    const rb = new Uint8Array(w * h);
    rb[(h - 1) * w] = 180;
    I.blur(rb, dst, w, h);
    expect(dst[0]).toBe(I.BLUR_LUT[180]);
    expect(dst[w - 1]).toBe(I.BLUR_LUT[0]);
  });
});

describe('Battery: the 18-map morph (§4.3)', () => {
  it('animMap[k-1] holds the blend factor k/19, truncating toward zero', () => {
    expect(I.INV19).toBe(0.05263157894736842);
    // a fake shift whose warp is a constant translate, with prev holding the identity map
    const W = 384, H = 4;
    function fakeShift(dx: number, dy: number) {
      return {
        identityRecovery: true, compatMask: 0,
        warp(p: { x: number; y: number }) { p.x = p.x + dx; p.y = p.y + dy; },
        setSize() {}
      } as any;
    }
    const prev = fakeShift(0, 0);
    I.allocMaps(prev, W, H, false);
    prev.map = null; I.allocMaps(prev, W, H, false);
    prev.animIdx = 18; prev.animMap = null; prev.building = false; prev.prev = null;
    prev.mapComplete = false; prev.buildRow = 0;
    while (!prev.mapComplete) I.buildRows(prev);

    const cur = fakeShift(100, 50);
    cur.animIdx = 18; cur.animMap = null; cur.prev = null; cur.building = false;
    cur.mapComplete = false; cur.buildRow = 0; cur.mw = 0; cur.mh = 0;
    I.allocMaps(cur, W, H, true);
    cur.prev = prev;
    while (!cur.mapComplete) I.buildRows(cur);
    // destination (0,0): prev says (0,0), cur says (100,50) -> clipped in y (H=4) to (100, 0)
    const sx = 100, sy = 0, px = 0, py = 0;
    const failures: string[] = [];
    for (let k = 1; k <= 18; k++) {
      const want = Math.trunc(k * I.INV19 * (sx - px)) + px + (Math.trunc(k * I.INV19 * (sy - py)) + py) * W;
      if (cur.animMap[k - 1][0] !== want) failures.push('animMap[' + (k - 1) + '] holds blend factor ' + k + '/19');
    }
    expect(failures).toEqual([]);
    expect(cur.animMap[17][0]).not.toBe(cur.map[0]);
    expect(cur.animMap[0][0]).toBe(Math.trunc(1 / 19 * 100));

    // negative deltas truncate TOWARD ZERO, not floor
    const back = fakeShift(-100, 0);
    back.animIdx = 18; back.animMap = null; back.prev = null; back.building = false;
    back.mapComplete = false; back.buildRow = 0; back.mw = 0; back.mh = 0;
    I.allocMaps(back, W, H, true);
    back.prev = cur;                                       // prev.map[100] holds source x = 200
    back.mapComplete = false; back.buildRow = 0;
    while (!back.mapComplete) I.buildRows(back);
    const pv = cur.map[100] % W;
    expect(back.animMap[0][100]).toBe(Math.trunc(1 / 19 * (0 - pv)) + pv);

    // SelectMap: read-then-decrement, one step lasts hold+1 frames, 18 steps then the static map
    const s = fakeShift(1, 1);
    s.animIdx = 18; s.animMap = null; s.prev = null; s.building = false;
    s.mapComplete = false; s.buildRow = 0; s.mw = 0; s.mh = 0;
    I.allocMaps(s, W, H, true);
    s.animHold = 1;
    expect(I.selectMap(s)).toBe(s.animMap[0]);
    expect(s.animHold).toBe(0);
    expect(I.selectMap(s)).toBe(s.animMap[1]);
    s.animIdx = 17; s.animHold = 0;
    expect(I.selectMap(s)).toBe(s.map);
    expect(s.animMap).toBeNull();
    expect(s.animIdx).toBe(18);
  });
});

describe('Battery: out-of-range recovery (§4.3)', () => {
  it('identityRecovery true snaps to the destination pixel, false clamps to 0', () => {
    const W = 16, H = 8;
    function shift(identity: boolean) {
      const s: any = {
        identityRecovery: identity, compatMask: 0, setSize() {},
        warp(p: { x: number; y: number }) { p.x = -5; p.y = 99; }
      };
      s.animIdx = 18; s.animMap = null; s.prev = null; s.building = false;
      s.mapComplete = false; s.buildRow = 0; s.mw = 0; s.mh = 0; s.map = null;
      I.allocMaps(s, W, H, false);
      while (!s.mapComplete) I.buildRows(s);
      return s;
    }
    const a = shift(true);
    expect(a.map[3 * W + 5]).toBe(3 * W + 5);
    const b = shift(false);
    expect(b.map[3 * W + 5]).toBe(0);
  });
});

describe('Battery: srand(time) comes AFTER the registries (§0 #2)', () => {
  it('every ctor rand() is on the CRT default stream; only srand(time) varies per run', () => {
    // CreateInstance 0x18040ba20: operator new(0xff0) -> ctor 0x18040b4b0 (which builds both effect
    // registries at 0x18040f470) -> time(NULL) 0x18040bd38 -> srand 0x18040bd40 -> presets[0]->Activate().
    // So every effect ctor's rand() runs on the CRT's default stream and is identical on every run;
    // only what happens after this point varies. Seeding first randomises CJDar's base colour per run.
    const realNow = Date.now;
    try {
      (A as any).srand(1);
      Date.now = () => 1000 * 1000;
      const a = new Battery({ width: 32, height: 16 });
      expect((A as any).randSeed() | 0).toBe(1000);
      (A as any).srand(1);
      Date.now = () => 987654321 * 1000;
      const b = new Battery({ width: 32, height: 16 });
      expect((A as any).randSeed() | 0).toBe(987654321 | 0);
      const ja = a.drawByName.CJDar, jb = b.drawByName.CJDar;
      if (ja && jb && !ja.placeholder) {
        expect(jb.colour).toBe(ja.colour);
        expect(jb.ax).toBe(ja.ax);
        expect(jb.ay).toBe(ja.ay);
        expect(jb.phase).toBe(ja.phase);
      }
    } finally { Date.now = realNow; }
  });
});

describe('Battery: palette cross-fade (§5)', () => {
  it('the ctor ramp, Gradient span math, and the 25-frame fade', () => {
    const b = new Battery({ width: 32, height: 16 });
    // the blue ramp the ctor seeds
    expect(b.LIVE[4 * 200 + 2]).toBe(200);
    expect(b.LIVE[4 * 200]).toBe(0);
    expect(b.LIVE32[255] >>> 0).toBe(0x0000FF);

    // Gradient: t = (i-start)/(end-start+1), so it never reaches the second key
    b.TO.fill(0);
    b.buildPalette(0, 2, new Uint8Array([0, 0, 0, 255, 255, 255]));
    expect(b.TO[0]).toBe(0);
    expect(b.TO[255 * 4]).toBe(254);
    b.TO.fill(0);
    b.buildPalette(0, 3, new Uint8Array([0, 0, 0, 100, 0, 0, 0, 0, 200]));
    expect(b.TO[128 * 4]).toBe(100);
    expect(b.TO[255 * 4]).toBe(100 + Math.trunc(-100 * (127 / 128)));
    expect(b.TO[255 * 4 + 2]).toBe(Math.trunc(200 * (127 / 128)));

    // newPalette's key sort is an exchange sort against the pass anchor, not a bubble sort: with
    // equal brightness sums the two give different orders. Scripted rand():
    {
      const script = [1, 1, 3, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, 0, 0];
      const real = (A as any).rand;
      let k = 0; (A as any).rand = () => script[k++];
      const seen: unknown[] = [];
      b.buildPalette = (_fade: number, n: number, key: Uint8Array) => seen.push(n, Array.from(key.subarray(0, n * 3)).join(','));
      b.newPalette();
      (A as any).rand = real; delete b.buildPalette;
      expect(seen[0]).toBe(5);
      expect(seen[1]).toBe('0,0,0,0,0,0,100,0,0,0,100,0,255,255,255');
    }

    // the fade: t = (len-ctr)/len over 25 frames, 0 .. 24/25, never 1
    const c = new Battery({ width: 32, height: 16 });
    c.paletteAutoCycle = false; c.palettePaused = false;
    c.FROM.fill(0); c.TO.fill(0);
    for (let i = 0; i < 256; i++) c.TO[i * 4] = 250;
    c.paletteFading = true; c.paletteFadeLen = c.paletteFadeCtr = 25;
    const seen2: number[] = [];
    for (let f = 0; f < 25; f++) { c.updatePalette(); seen2.push(c.LIVE[0]); }
    expect(seen2[0]).toBe(0);
    expect(seen2[24]).toBe(Math.trunc(250 * 24 / 25));
    expect(c.paletteFading).toBe(false);

    // fadeLen <= 0 snaps on the first frame
    const d = new Battery({ width: 32, height: 16 });
    d.paletteAutoCycle = false;
    d.FROM.fill(0); d.TO.fill(0);
    for (let i = 0; i < 256; i++) d.TO[i * 4] = 250;
    d.paletteFading = true; d.paletteFadeLen = d.paletteFadeCtr = 0;
    d.updatePalette();
    expect(d.LIVE[0]).toBe(250);
  });
});

describe('Battery: NewPalette\'s rand() order (§5)', () => {
  it('draws nKeys then g,b,r for key 0, dark-clamped', () => {
    const b = new Battery({ width: 32, height: 16 });
    b.paletteAutoCycle = false;
    (A as any).srand(1);
    const mirrorSeq: number[] = [];
    { let s = 1; for (let i = 0; i < 40; i++) { s = (Math.imul(s, 214013) + 2531011) | 0; mirrorSeq.push((s >>> 16) & 0x7fff); } }
    (A as any).srand(1);
    b.newPalette();
    const r1 = mirrorSeq[0]!, r3 = mirrorSeq[2]!;
    const nKeys = r3 % ((r1 % 10 !== 0) ? 4 : 10) + 2;
    expect(nKeys >= 2 && nKeys <= 11).toBe(true);
    // key0 = dark from draws 3,4,5 in the order g, b, r
    const g0 = mirrorSeq[3]! % 32, b0 = mirrorSeq[4]! % 32, r0 = mirrorSeq[5]! % 32;
    expect(b.TO[0]).toBe(r0);
    expect(b.TO[1]).toBe(g0);
    expect(b.TO[2]).toBe(b0);
    expect(r0 < 32 && g0 < 32 && b0 < 32).toBe(true);
    expect(b.FROM.length).toBe(1024);
    // the fade length is the draw right after the keys
    expect(b.paletteFadeLen >= 0 && b.paletteFadeLen < 250).toBe(true);
    expect(b.paletteFadeCtr).toBe(b.paletteFadeLen);
    expect(b.paletteFading).toBe(true);
  });
});

describe('Battery: preset order + names (§9)', () => {
  it('26 presets, case-insensitive hive key sort, out-of-range values kept verbatim', () => {
    const b = new Battery({ width: 32, height: 16 });
    expect(b.presetNames.length).toBe(26);
    expect(b.presetNames[0]).toBe('Randomization');
    const keys: string[] = I.PRESETS.map((p: any) => p[0]);
    const sorted = keys.slice().sort((x, y) => (x.toUpperCase() < y.toUpperCase() ? -1 : x.toUpperCase() > y.toUpperCase() ? 1 : 0));
    expect(keys.join('|')).toBe(sorted.join('|'));
    expect(keys[0]).toBe('BrightSphere');
    expect(keys[8]).toBe('Geeks Kick ASCII');
    expect(keys[9]).toBe('gemstone matrix');
    expect(keys[24]).toBe('what is an egab');
    expect(b.presetNames[1]).toBe('brightsphere');
    expect(b.presetNames[25]).toBe('back to the groove');
    expect(I.PRESETS.length).toBe(25);
    // the loader honours out-of-range shipped values verbatim (§9)
    const ev = I.PRESETS.find((p: any) => p[0] === 'eventhorizon');
    expect(ev[5][0][1][0]).toBe(159);
    const sleepy = I.PRESETS.find((p: any) => p[0] === 'sleepyspray');
    expect(sleepy[6][0][1][3]).toBe(384.000015258789);
    expect(I.PRESETS.filter((p: any) => p[7]).length).toBe(17);
    expect(I.hexToPalette(I.PRESETS.find((p: any) => p[0] === 'cominatya')[8]).length).toBe(1024);
  });
});

describe('Battery: saved vs Randomization (§0 #2, §7.5)', () => {
  it('only Randomization auto-randomizes; a saved preset never rerolls', () => {
    // count randomize() calls on every registry singleton
    const b = new Battery({ width: 64, height: 48 });
    let calls = 0;
    for (const e of b.shifts.concat(b.draws)) {
      const orig = e.randomize.bind(e);
      e.randomize = function () { calls++; return orig(); };
    }
    const L = level(2);
    b.render(L);
    expect(calls).toBeGreaterThan(0);
    expect(b.presets[0].autoMovement).toBe(true);
    expect(b.presets[0].autoEffects).toBe(true);

    const autoMovementFailures: string[] = [];
    for (let i = 1; i <= 25; i++) {
      if (b.presets[i].autoMovement !== false) autoMovementFailures.push('saved preset ' + i + ' has bAutoMovement = 0');
    }
    expect(autoMovementFailures).toEqual([]);
    // the 25 bAutoEffects checks, collapsed into one: no saved preset auto-randomizes effects
    expect(b.presets.slice(1, 26).every((p: any) => !p.autoEffects)).toBe(true);

    b.setPreset(3);                           // cominatcha: CStretchShift + CJiggyScribble (pre)
    calls = 0;
    for (let f = 0; f < 400; f++) b.render(L);
    expect(calls).toBe(0);
    expect(b.presets[3].movementCurrent.className).toBe('CStretchShift');
    expect(b.presets[3].pre.map((e: any) => e.className).join(',')).toBe('CJiggyScribble');
    expect(b.presets[3].post.length).toBe(0);
    expect(b.palettePaused).toBe(true);
    expect(b.shiftByName.CStretchShift.dbl0 === undefined ? 0.0435239728506501 : b.shiftByName.CStretchShift.dbl0)
      .toBe(0.0435239728506501);

    // preset 0 re-selected: both flags still set, and SetCurrentPreset to the same index is a no-op
    expect(b.setPreset(3)).toBe(true);
    expect(b.setPreset(99)).toBe(false);
    b.setPreset(0);
    expect(b.presets[0].autoEffects && b.presets[0].autoMovement).toBe(true);
  });
});

describe('Battery: AllocAll\'s SetSize sweep unlocks a locked palette (§0 quirk)', () => {
  it('a locked preset selected before the first Render loses bPalettePaused; after, it stays locked', () => {
    // Measured on the real DLL with _time64 pinned and _o_rand hooked: a locked preset selected
    // BEFORE the first Render loses bPalettePaused (preset 0's SetSize has no save/restore), so the
    // auto-cycle replaces the stored palette rand()%600 frames after the 25-frame fade; a locked
    // preset selected AFTER the first Render stays locked forever.
    const L = level(2);
    const early = new Battery({ width: 32, height: 16 });
    early.setPreset(13);                                  // Geeks Kick ASCII, PaletteLocked = 1
    expect(early.palettePaused).toBe(true);
    early.render(L);                                      // the first Render => AllocAll
    expect(early.palettePaused).toBe(false);
    for (let f = 0; f < 24; f++) early.render(L);          // finish the 25-frame registry fade
    expect(early.paletteFading).toBe(false);
    expect(early.paletteChangeCountdown > 0 && early.paletteChangeCountdown < 600).toBe(true);
    const cd = early.paletteChangeCountdown;
    for (let f = 0; f < cd; f++) early.render(L);
    expect(early.paletteFading).toBe(true);

    const late = new Battery({ width: 32, height: 16 });
    late.render(L);                                       // AllocAll first, then select
    late.setPreset(13);
    for (let f = 0; f < 200; f++) late.render(L);
    expect(late.palettePaused).toBe(true);
    expect(late.paletteFading).toBe(false);
  });
});

describe('Battery: the scheduler (§8.2)', () => {
  it('movement/effects timers use rand() in movement-then-effects order', () => {
    const b = new Battery({ width: 384, height: 288 });
    b.seed(12345);
    const p = b.presets[0];
    expect(p.movementTimer).toBe(0);
    expect(p.effectsTimer).toBe(0);
    b.render(level(2));
    expect(p.movementTimer >= 96 && p.movementTimer <= 485).toBe(true);
    expect(p.effectsTimer >= 90 && p.effectsTimer <= 399).toBe(true);
    const m0 = p.movementTimer, e0 = p.effectsTimer;
    const n = Math.min(m0, e0) - 1;
    for (let f = 0; f < n; f++) b.render(level(2));
    expect(p.movementTimer).toBe(m0 - n);
    expect(p.effectsTimer).toBe(e0 - n);

    // both randomizers are driven off the same rand() stream in movement-then-effects order
    const c = new Battery({ width: 384, height: 288 });
    c.paletteAutoCycle = false;          // UpdatePalette runs first and would otherwise eat the stream
    c.seed(999);
    const mirror = ((seed: number) => { let s = seed | 0; return () => { s = (Math.imul(s, 214013) + 2531011) | 0; return (s >>> 16) & 0x7fff; }; })(999);
    const wantMovement = mirror() % 390 + 96;
    c.render(level(2));
    expect(c.presets[0].movementTimer).toBe(wantMovement);

    // h = 192 / 384 move the floor, per §0 #3
    const d = new Battery({ width: 256, height: 192 });
    d.seed(7);
    d.render(level(2));
    expect(d.presets[0].movementTimer >= 64 && d.presets[0].movementTimer <= 453).toBe(true);
  });
});

describe('Battery: RandomizeMovement / Effects (§8.3, §8.4)', () => {
  it('the two registries and the two selection passes', () => {
    expect(I.SHIFT_NAMES.length).toBe(15);
    expect(I.SHIFT_NAMES[0]).toBe('CLinearShift');
    expect(I.SHIFT_NAMES[1]).toBe('CLinearShift');
    expect(I.DRAW_NAMES.length).toBe(10);
    expect(I.DRAW_NAMES.join(',')).toBe(
      'CEdgeTrace,CEdgeGradiant,CCosEdgeGradiant,CWaveEdge,CSpectrumEdge,CCircleWaveform,CDotPlane,CJDar,CGalaxy,CJiggyScribble');

    const b = new Battery({ width: 64, height: 48 });
    expect(b.shifts.length).toBe(15);
    expect(b.shifts[0]).not.toBe(b.shifts[1]);
    expect(b.draws.filter((e: any) => e.compatMask & 1).length).toBe(5);
    expect(b.draws.filter((e: any) => e.compatMask & 2).length).toBe(5);
    expect(b.shifts.filter((s: any) => s.compatMask !== 0).length).toBe(1);
    expect(b.shiftByName.CTileShift.compatMask).toBe(1);
    expect(b.shiftByName.CRingSpinShift.identityRecovery).toBe(false);
    expect(b.shiftByName.CLinearShift.identityRecovery).toBe(true);

    // the two selection passes, over 300 rerolls: 0-1 border effects always pre, 1-2 overlays pre or post
    const p = b.presets[0];
    let maxPre = 0, sawTwoOverlays = false, borderInPost = 0, total = 0;
    const chainFailures: string[] = [];
    for (let i = 0; i < 300; i++) {
      p.randomizeEffects();
      const chain = p.pre.concat(p.post);
      if (!(chain.length >= 1 && chain.length <= 3)) chainFailures.push('a Randomization frame set is 1..3 effects');
      total += chain.length;
      if (p.pre.length > maxPre) maxPre = p.pre.length;
      if (chain.filter((e: any) => e.compatMask & 2).length === 2) sawTwoOverlays = true;
      borderInPost += p.post.filter((e: any) => e.compatMask & 1).length;
    }
    expect(chainFailures).toEqual([]);
    expect(borderInPost).toBe(0);
    expect(sawTwoOverlays).toBe(true);
    expect(total / 300 > 1.3 && total / 300 < 2.6).toBe(true);

    // RandomizeMovement never picks the outgoing shift again, and arms prev for the morph
    const neverSameFailures: string[] = [];
    const advancesFailures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const before = p.movementCurrent;
      p.randomizeMovement();
      if (p.movementNext === p.movementCurrent) neverSameFailures.push('the next shift is never the current one');
      if (before && p.movementCurrent === null) advancesFailures.push('current advances from next');
    }
    expect(neverSameFailures).toEqual([]);
    expect(advancesFailures).toEqual([]);
    expect(p.movementNext.prev).toBe(p.movementCurrent);
  });
});

describe('Battery: compat filtering in RenderChain (§7.4)', () => {
  it('CTileShift suppresses border effects in the pre pass only', () => {
    const b = new Battery({ width: 64, height: 48 });
    const p = b.presets[0];
    const drawn: string[] = [];
    for (const e of b.draws) { const n = e.className; e.draw = function () { drawn.push(n); }; }
    p.pre = [b.drawByName.CEdgeTrace, b.drawByName.CJDar];
    p.post = [b.drawByName.CEdgeGradiant];
    p.autoMovement = p.autoEffects = false;
    p.movementNext = null;

    p.movementCurrent = p.shift = b.shiftByName.CLinearShift;      // mask 0 suppresses nothing
    drawn.length = 0; p.renderChain(level(2));
    expect(drawn.join(',')).toBe('CEdgeTrace,CJDar,CEdgeGradiant');

    p.movementCurrent = p.shift = b.shiftByName.CTileShift;        // mask 1 kills border effects in PRE
    drawn.length = 0; p.renderChain(level(2));
    expect(drawn.join(',')).toBe('CJDar,CEdgeGradiant');
  });
});

describe('Battery: buffer parity and swaps (§1)', () => {
  it('PLAYING swaps twice, STOPPED swaps once, PAUSED re-presents', () => {
    const b = new Battery({ width: 64, height: 48 });
    const f0 = b.front;
    b.render(level(2));
    expect(b.front).toBe(f0);
    b.render(level(0));
    expect(b.front).not.toBe(f0);
    expect(b.idleDecay).toBe(299);
    const before = b.last;
    b.render(level(1));
    expect(b.render(level(1))).toBe(before);
    // 300 stopped frames then the flat fill
    for (let i = 0; i < 400; i++) b.render(level(0));
    expect(b.idleDecay).toBe(0);
    const px = b.render(level(0)).px;
    expect(px[0]).toBe(b.LIVE32[1]);
    expect(px[px.length - 1]).toBe(b.LIVE32[1]);
    b.render(level(2));
    expect(b.idleDecay).toBe(300);
  });
});

describe('Battery: 300 frames, no out-of-bounds writes', () => {
  // fake classes: a warp that returns wild coordinates, draws that scribble far outside the buffer
  it('hostile warp/draw classes stay in bounds across 300 frames, all 26 presets, and a resize', () => {
    const warpCalls = { n: 0 }, drawCalls = { n: 0 };
    const ctxBufFailures: string[] = [];
    class WildWarp {
      compatMask = 0; identityRecovery = true;
      [k: string]: any;
      constructor() { for (let i = 0; i < 8; i++) this['dbl' + i] = 0; }
      setSize(w: number, h: number) { this.w = w; this.h = h; }
      randomize() { for (let i = 0; i < 8; i++) this['dbl' + i] = (A as any).rand(); }
      setParams(d: number[]) { for (let i = 0; i < 8; i++) this['dbl' + i] = d[i]; }
      warp(p: { x: number; y: number }) { warpCalls.n++; p.x = p.x * 3 - 700; p.y = -p.y * 5 + 1000; }
    }
    class WildDraw {
      compatMask = 3;
      [k: string]: any;
      constructor() { for (let i = 0; i < 8; i++) this['dbl' + i] = 0; }
      setSize() {}
      randomize() { (A as any).rand(); }
      setParams(d: number[]) { for (let i = 0; i < 8; i++) this['dbl' + i] = d[i]; }
      draw(ctx: any) {
        drawCalls.n++;
        if (ctx.buf.length !== ctx.w * ctx.h) ctxBufFailures.push('ctx.buf is the live w*h byte buffer');
        for (let i = -100; i < ctx.w * ctx.h + 100; i += 997) ctx.buf[i] = 42;
      }
    }
    const warps: any = { list: () => [] }, draws: any = { list: () => [] };
    for (const n of I.SHIFT_NAMES) warps[n] = WildWarp;
    for (const n of I.DRAW_NAMES) draws[n] = WildDraw;
    (A as any).BatteryWarps = warps; (A as any).BatteryDraws = draws;
    const b = new Battery({ width: 96, height: 72 });
    b.seed(4242);
    const L = level(2, (l) => { for (let i = 0; i < 1024; i++) { l.freq[0][i] = i & 255; l.wave[0][i] = 128 + (i & 63); } });
    let bad = 0;
    for (let f = 0; f < 300; f++) {
      const S = b.render(L);
      if (S.px.length !== 96 * 72) bad++;
      for (let i = 0; i < b.front.length; i++) if (b.front[i] === undefined) bad++;
      if (f === 150) {
        for (let i = 0; i < S.px.length; i++) if (!(S.px[i] >= 0 && S.px[i] <= 0xFFFFFF)) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(ctxBufFailures).toEqual([]);
    expect(warpCalls.n).toBeGreaterThan(0);
    expect(drawCalls.n).toBeGreaterThan(0);
    // every preset survives 30 frames each
    bad = 0;
    for (let i = 0; i < 26; i++) {
      b.setPreset(i);
      for (let f = 0; f < 30; f++) { const S = b.render(L); if (S.w !== 96 || S.h !== 72) bad++; }
    }
    expect(bad).toBe(0);
    // and a resize mid-flight
    b.resize(384, 288);
    for (let f = 0; f < 20; f++) b.render(L);
    expect(b.render(L).w).toBe(384);
    const d = b.debug();
    expect(d.engine).toBe('Battery');
    expect(d.size).toBe('384x288');
    expect(typeof d.movement).toBe('string');
    expect(Array.isArray(d.placeholders)).toBe(true);
    delete (A as any).BatteryWarps; delete (A as any).BatteryDraws;
  }, 20000);
});
