// tests/engine/battery-warps.test.ts — ported from tests/battery-warps.test.js.
// Specs 11/12 numeric claims for Alchemy.BatteryWarps. Every warp fixture below was generated from
// spec/battery/ref-warps-a.py and ref-warps-b.py, the Python reference models that produced the
// specs' worked examples. Same assertions as the old harness (346 checks); see the file header of
// each `describe` block for the old vs new count.
/* eslint-disable @typescript-eslint/restrict-plus-operands -- engine types are still settling (@ts-nocheck); these mirror tests/adapters/harness.ts's precedent */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A } from '../../src/engine/ns';
import { BatteryWarps } from '../../src/engine/battery/warps';

const here = path.dirname(fileURLToPath(import.meta.url));

type Kernel = any;
type KernelCtor = new () => Kernel;
// The 14 named classes get real (non-optional) properties so `BW.CFoo` reads cleanly; a dynamic
// string name (from a fixture/loop/CASES row) goes through K(name), a single explicit assertion
// instead of fighting noUncheckedIndexedAccess at every call site.
interface WarpKernelsNS {
  Shift: KernelCtor;
  CRingSpinShift: KernelCtor; CShiitake: KernelCtor; CStretchShift: KernelCtor; CStarburstShift: KernelCtor;
  CTrigShift: KernelCtor; CThingusShift: KernelCtor; CSinShimmerShift: KernelCtor; CTileShift: KernelCtor;
  CTwirlocity: KernelCtor; CLinearShift: KernelCtor; CSwirlShift: KernelCtor; CZoomShift: KernelCtor;
  CTrigStretchShift: KernelCtor; CEdgeFalloffShift: KernelCtor;
  list(): KernelCtor[];
}
const BW = BatteryWarps as unknown as WarpKernelsNS;
function K(name: string): KernelCtor { return (BW as unknown as Record<string, KernelCtor>)[name]!; }

// steps of the LCG consumed by fn()
function randCalls(fn: () => void): number {
  A.srand(12345);
  const before = A.randSeed();
  fn();
  const after = A.randSeed();
  A.randSeed(before);
  for (let i = 0; i <= 4096; i++) {
    if (A.randSeed() === after) return i;
    A.rand();
  }
  return -1;
}
const W = 384, H = 288;

// Generated from spec/battery/ref-warps-a.py + ref-warps-b.py (the specs' oracles).
// Row = [dstX, dstY, rawSrcX, rawSrcY, recoveredSrcX, recoveredSrcY].
interface Fixture {
  n: string; c: string; d: number[]; ir: boolean;
  p: [number, number, number, number, number, number][];
  v?: number;
}
const FIXTURES: Fixture[] = [
  { n:"CRingSpinShift brightsphere", c:"CRingSpinShift", d:[-0.0375484487,0.762913907,0,0], ir:false, p:[[0,0,-2,10,0,10],[1,1,-1,11,0,11],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,385,277,0,277],[96,72,95,77,95,77],[300,200,300,195,300,195],[10,250,93,207,93,207]] },
  { n:"CRingSpinShift illuminator", c:"CRingSpinShift", d:[0.0281029698,0.386169011,0,0], ir:false, p:[[0,0,9,-1,9,0],[1,1,9,-1,9,0],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,375,289,375,0],[96,72,100,71,100,71],[300,200,296,202,296,202],[10,250,38,228,38,228]] },
  { n:"CShiitake drinkdeep", c:"CShiitake", d:[7.5231788,0.00704214565,0.0218924531,2], ir:true, p:[[0,0,34,-45,34,0],[1,1,34,-44,34,1],[192,144,185,144,185,144],[193,144,200,144,200,144],[192,145,192,152,192,152],[383,287,350,332,350,287],[96,72,101,56,101,56],[300,200,298,217,298,217],[10,250,-15,210,10,210]] },
  { n:"CShiitake the world", c:"CShiitake", d:[-0.348063601,0.130804622,0.0215704828,1], ir:true, p:[[0,0,26,-28,26,0],[1,1,25,-25,25,1],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,359,313,359,287],[96,72,111,57,111,57],[300,200,287,218,287,218],[10,250,4,236,4,236]] },
  { n:"CStretchShift cominatcha", c:"CStretchShift", d:[0.0435239729,0.154408399,0,0], ir:false, p:[[0,0,74,45,74,45],[1,1,74,46,74,46],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,310,242,310,242],[96,72,107,77,107,77],[300,200,288,197,288,197],[10,250,57,214,57,214]] },
  { n:"CStretchShift strawberryaid", c:"CStretchShift", d:[-0.0370937229,0.142158269,0,0], ir:false, p:[[0,0,59,53,59,53],[1,1,59,54,59,54],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,325,234,325,234],[96,72,103,80,103,80],[300,200,292,192,292,192],[10,250,59,228,59,228]] },
  { n:"CStarburstShift dandelionaid", c:"CStarburstShift", d:[-0.0373287154,0.229520554,26,0], ir:true, p:[[0,0,69,44,69,44],[1,1,66,42,66,42],[192,144,192,144,192,144],[193,144,193,144,193,144],[192,145,192,145,192,145],[383,287,318,246,318,246],[96,72,106,77,106,77],[300,200,299,200,299,200],[10,250,65,212,65,212]] },
  { n:"CStarburstShift eletriarnation", c:"CStarburstShift", d:[-0.0270867035,0.0415936765,22,1], ir:true, p:[[0,0,13,19,13,19],[1,1,14,20,14,20],[192,144,192,144,192,144],[193,144,193,144,193,144],[192,145,192,145,192,145],[383,287,370,268,370,268],[96,72,97,76,97,76],[300,200,303,199,303,199],[10,250,1,263,1,263]] },
  { n:"CSinShimmerShift ex m=0", c:"CSinShimmerShift", d:[3,0.25,0,0], ir:true, p:[[0,0,0,0,0,0],[1,1,1,0,1,0],[192,144,192,149,192,149],[193,144,193,149,193,149],[192,145,192,150,192,150],[383,287,383,282,383,282],[96,72,96,76,96,76],[300,200,300,201,300,201],[10,250,10,249,10,249]] },
  { n:"CSinShimmerShift ex m=1", c:"CSinShimmerShift", d:[-2.5,1.5,1,0], ir:true, p:[[0,0,0,0,0,0],[1,1,5,1,5,1],[192,144,191,144,191,144],[193,144,195,144,195,144],[192,145,188,145,188,145],[383,287,383,287,383,287],[96,72,97,72,97,72],[300,200,295,200,295,200],[10,250,9,250,9,250]] },
  { n:"CTrigShift ex m=0", c:"CTrigShift", d:[0.02,0.05,0,0], ir:true, p:[[0,0,11,3,11,3],[1,1,12,4,12,4],[192,144,192,144,192,144],[193,144,193,144,193,144],[192,145,192,144,192,144],[383,287,387,296,383,287],[96,72,102,74,102,74],[300,200,303,204,303,204],[10,250,17,241,17,241]] },
  { n:"CTrigShift ex m=2", c:"CTrigShift", d:[-0.03,0.08,2,0], ir:true, p:[[0,0,9,15,9,15],[1,1,7,14,7,14],[192,144,192,144,192,144],[193,144,192,144,192,144],[192,145,192,144,192,144],[383,287,396,287,383,287],[96,72,101,80,101,80],[300,200,309,200,309,200],[10,250,26,247,26,247]] },
  { n:"CThingusShift ex", c:"CThingusShift", d:[0.25,0.1,0,0], ir:true, p:[[0,0,1,35,1,35],[1,1,2,36,2,36],[192,144,180,143,180,143],[193,144,205,145,205,145],[192,145,191,157,191,157],[383,287,382,252,382,252],[96,72,98,76,98,76],[300,200,298,196,298,196],[10,250,34,258,34,258]] },
  { n:"CLinearShift sleepyspray", c:"CLinearShift", d:[-1,-3], ir:true, p:[[0,0,-1,-3,0,0],[10,10,9,7,9,7],[192,144,191,141,191,141],[200,100,199,97,199,97],[383,287,382,284,382,284],[50,250,49,247,49,247]] },
  { n:"CTileShift gemstonematrix", c:"CTileShift", d:[0.100997955], ir:true, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,189,121,189,121],[200,100,183,99,183,99],[383,287,383,271,383,271],[50,250,43,247,43,247]] },
  { n:"CTileShift dance of the freaky circles", c:"CTileShift", d:[0.0337656789], ir:true, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,190,140,190,140],[200,100,199,100,199,100],[383,287,383,287,383,287],[50,250,50,248,50,248]] },
  { n:"CTileShift zero param", c:"CTileShift", d:[0], ir:true, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,192,144,192,144],[200,100,200,100,200,100],[383,287,383,287,383,287],[50,250,50,250,50,250]] },
  { n:"CTwirlocity relatively calm", c:"CTwirlocity", d:[11,0.0227790164,8], ir:true, p:[[0,0,-1,2,0,2],[10,10,7,15,7,15],[192,144,192,144,192,144],[200,100,199,100,199,100],[383,287,384,285,383,285],[50,250,53,253,53,253]] },
  { n:"CTwirlocity outward mode", c:"CTwirlocity", d:[7,0.3,0], ir:true, p:[[0,0,24,-27,24,0],[10,10,-21,70,10,70],[192,144,192,144,192,144],[200,100,210,104,210,104],[383,287,369,303,369,287],[50,250,62,264,62,264]] },
  { n:"CSwirlShift smoke or water?", c:"CSwirlShift", d:[-0.0440031135,5,-5], ir:true, v:0, p:[[0,0,-6,13,0,13],[10,10,0,21,0,21],[192,144,192,136,192,136],[200,100,202,94,202,94],[383,287,388,282,383,282],[50,250,51,254,51,254]] },
  { n:"CSwirlShift my tornado is resting", c:"CSwirlShift", d:[0.0251609854,0,-10], ir:true, v:0, p:[[0,0,4,-4,4,0],[10,10,14,6,14,6],[192,144,192,144,192,144],[200,100,201,101,201,101],[383,287,379,291,379,287],[50,250,48,246,48,246]] },
  { n:"CSwirlShift smoke or water? v=1", c:"CSwirlShift", d:[-0.0440031135,5,-5], ir:true, v:1, p:[[0,0,-7,12,0,12],[10,10,-1,20,10,20],[192,144,193,137,193,137],[200,100,203,93,203,93],[383,287,389,283,383,283],[50,250,50,255,50,255]] },
  { n:"CSwirlShift smoke or water? v=-2", c:"CSwirlShift", d:[-0.0440031135,5,-5], ir:true, v:-2, p:[[0,0,-4,15,0,15],[10,10,2,23,2,23],[192,144,190,134,190,134],[200,100,200,96,200,96],[383,287,386,280,383,280],[50,250,53,252,53,252]] },
  { n:"CZoomShift synthetic", c:"CZoomShift", d:[0.02,0.05], ir:false, p:[[0,0,19,9,19,9],[10,10,28,18,28,18],[192,144,192,144,192,144],[200,100,200,104,200,104],[383,287,365,279,365,279],[50,250,60,238,60,238]] },
  { n:"CZoomShift zoom out clamp", c:"CZoomShift", d:[0,-0.08], ir:false, p:[[0,0,-24,-18,0,0],[10,10,-13,-7,0,0],[192,144,192,144,192,144],[200,100,201,95,201,95],[383,287,407,305,0,0],[50,250,32,263,32,263]] },
  { n:"CTrigStretchShift synthetic", c:"CTrigStretchShift", d:[0.02,0.03,1,0.15], ir:false, p:[[0,0,28,15,28,15],[10,10,34,23,34,23],[192,144,192,144,192,144],[200,100,200,102,200,102],[383,287,360,275,360,275],[50,250,56,241,56,241]] },
  { n:"CTrigStretchShift mode 0", c:"CTrigStretchShift", d:[0.02,0.03,0,0.15], ir:false, p:[[0,0,29,16,29,16],[10,10,35,23,35,23],[192,144,192,144,192,144],[200,100,200,101,200,101],[383,287,361,276,361,276],[50,250,60,238,60,238]] },
  { n:"CTrigStretchShift mode 2", c:"CTrigStretchShift", d:[0.02,0.03,2,0.15], ir:false, p:[[0,0,29,16,29,16],[10,10,35,23,35,23],[192,144,192,144,192,144],[200,100,200,101,200,101],[383,287,360,275,360,275],[50,250,60,238,60,238]] },
  { n:"CTrigStretchShift default mode", c:"CTrigStretchShift", d:[0.02,0.03,5,0.15], ir:false, p:[[0,0,26,14,26,14],[10,10,32,21,32,21],[192,144,192,144,192,144],[200,100,200,101,200,101],[383,287,358,274,358,274],[50,250,58,240,58,240]] },
  { n:"CEdgeFalloffShift mode 0", c:"CEdgeFalloffShift", d:[0.05,0], ir:false, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,201,144,201,144],[200,100,210,100,210,100],[383,287,402,287,0,287],[50,250,52,250,52,250]] },
  { n:"CEdgeFalloffShift mode 1", c:"CEdgeFalloffShift", d:[0.05,1], ir:false, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,192,151,192,151],[200,100,200,105,200,105],[383,287,383,301,383,0],[50,250,50,262,50,262]] },
  { n:"CEdgeFalloffShift mode 2", c:"CEdgeFalloffShift", d:[0.05,2], ir:false, p:[[0,0,-19,0,0,0],[10,10,-8,10,0,10],[192,144,183,144,183,144],[200,100,191,100,191,100],[383,287,383,287,383,287],[50,250,34,250,34,250]] },
  { n:"CEdgeFalloffShift mode 3", c:"CEdgeFalloffShift", d:[0.05,3], ir:false, p:[[0,0,0,-14,0,0],[10,10,10,-3,10,0],[192,144,192,137,192,137],[200,100,200,91,200,91],[383,287,383,287,383,287],[50,250,50,249,50,249]] },
  { n:"CEdgeFalloffShift mode 4", c:"CEdgeFalloffShift", d:[0.05,4], ir:false, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,192,144,192,144],[200,100,200,100,200,100],[383,287,383,287,383,287],[50,250,50,250,50,250]] },
  { n:"CEdgeFalloffShift zero rate mode 2", c:"CEdgeFalloffShift", d:[0,2], ir:false, p:[[0,0,0,0,0,0],[10,10,10,10,10,10],[192,144,192,144,192,144],[200,100,200,100,200,100],[383,287,383,287,383,287],[50,250,50,250,50,250]] }
];

// ---------------------------------------------------------------- worked examples (ref-*.py)
// old: 35 fixtures x (1 identityRecovery + 1 aggregate warp-points) = 70 checks
describe('worked examples (ref-warps-a.py / ref-warps-b.py)', () => {
  it('every fixture: identityRecovery and warp()/mapPoint() at each sample point', () => {
    for (const fx of FIXTURES) {
      const k = new (K(fx.c))();
      k.setSize(W, H);
      k.setParams(fx.d);
      if ('v' in fx) k.dither = fx.v;
      expect(k.identityRecovery, fx.n + ': identityRecovery').toBe(fx.ir);
      let rawBad = 0, recBad = 0;
      for (const [x, y, rx, ry, cx, cy] of fx.p) {
        const p = { x, y };
        k.warp(p);
        if (p.x !== rx || p.y !== ry) rawBad++;
        const q = { x, y };
        k.mapPoint(q);
        if (q.x !== cx || q.y !== cy) recBad++;
      }
      expect(rawBad === 0 && recBad === 0, fx.n + ': ' + fx.p.length + ' warp points').toBe(true);
    }
  });
});

// ---------------------------------------------------------------- list(): the 15-entry order
// old: 20 checks
describe('list()', () => {
  it('is the 15-entry 0x18040f470 registration order', () => {
    const want = ['CLinearShift', 'CLinearShift', 'CThingusShift', 'CZoomShift', 'CRingSpinShift',
      'CStretchShift', 'CTileShift', 'CTrigShift', 'CSinShimmerShift', 'CEdgeFalloffShift',
      'CStarburstShift', 'CSwirlShift', 'CTrigStretchShift', 'CTwirlocity', 'CShiitake'];
    const got = BW.list();
    expect(got.length, 'RandomizeMovement list has 15 entries').toBe(15);
    expect(got.map((c) => c.name).join(','), 'list() is 0x18040f470 registration order').toBe(want.join(','));
    expect(got.filter((c) => c === BW.CLinearShift).length, 'CLinearShift registered twice').toBe(2);
    const distinct = new Set(got);
    expect(distinct.size, 'list() covers 14 distinct classes').toBe(14);
    for (const name of want) expect(distinct.has(K(name)), name + ' is exported under its DLL name').toBe(true);
    expect(BW.list() !== BW.list(), 'list() returns a fresh array').toBe(true);
  });
});

// ---------------------------------------------------------------- ctor defaults, flags, geometry
// old: 14 classes x 5 checks = 70
describe('ctor defaults, flags, geometry', () => {
  it('every class: zero dbl defaults, compatMask, identityRecovery, retail geometry, parametric resize', () => {
    const noIdentity = ['CRingSpinShift', 'CStretchShift', 'CZoomShift', 'CTrigStretchShift',
      'CEdgeFalloffShift'];
    for (const name of new Set(BW.list().map((c) => c.name))) {
      const k = new (K(name))();
      let zero = true;
      for (let i = 0; i < 8; i++) if (k['dbl' + i] !== 0.0) zero = false;
      expect(zero, name + ': all eight dbl default to 0.0').toBe(true);
      expect(k.compatMask, name + ': compatMask (+0xe0)').toBe(name === 'CTileShift' ? 1 : 0);
      expect(k.identityRecovery, name + ': identityRecovery (+0x1a0)').toBe(noIdentity.indexOf(name) < 0);
      expect(k.w + 'x' + k.h + ' ' + k.cx + ',' + k.cy, name + ': retail geometry').toBe('384x288 192,144');
      k.setSize(16, 12);
      expect(k.cx + ',' + k.cy + ' ' + k.wmcx + ',' + k.hmcy, name + ': setSize stays parametric').toBe('8,6 8,6');
    }
  });
});

// ---------------------------------------------------------------- identity at zero parameters
// old: 10 checks (one per isIdentity() call)
describe('identity at zero parameters', () => {
  it('every zero-parameter map is an exact identity (up to the documented exceptions)', () => {
    const pts: [number, number][] = [[0, 0], [1, 1], [10, 10], [192, 144], [200, 100], [383, 287], [50, 250], [96, 72]];
    function isIdentity(k: Kernel, msg: string) {
      let bad = 0;
      for (const [x, y] of pts) { const p = { x, y }; k.warp(p); if (p.x !== x || p.y !== y) bad++; }
      expect(bad === 0, msg).toBe(true);
    }
    const lin = new BW.CLinearShift();                       // (0,0) is a legal Randomize draw
    isIdentity(lin, 'CLinearShift (0,0) is an exact identity map');
    isIdentity(new BW.CTileShift(), 'CTileShift dbl1 = 0 degenerates to identity via the 1e-4 guard');
    isIdentity(new BW.CSinShimmerShift(), 'CSinShimmerShift dbl1 = 0 is identity');
    const sh = new BW.CSinShimmerShift();
    sh.setParams([3, 0.25, 2]);
    isIdentity(sh, 'CSinShimmerShift mode >= 2 is identity (unreachable from Randomize)');
    for (let m = 0; m < 5; m++) {
      const ef = new BW.CEdgeFalloffShift();
      ef.setParams([0.0, m]);
      isIdentity(ef, 'CEdgeFalloffShift dbl1 = 0, mode ' + m + ' is identity');
    }
    const ef4 = new BW.CEdgeFalloffShift();
    ef4.setParams([0.05, 4]);
    isIdentity(ef4, 'CEdgeFalloffShift mode >= 4 is identity');
  });
});

// ---------------------------------------------------------------- the polar round trip at r = 0
// old: 9 checks (8 centre cases + 1 starburst worst-case)
describe('the polar round trip at r = 0', () => {
  it('every radial kernel maps the exact centre to itself when its radial terms vanish there', () => {
    const centre: [string, number[]][] = [['CRingSpinShift', [0.03, 0.5]], ['CStretchShift', [0.04, 0.15]],
      ['CStarburstShift', [-0.037, 0.23, 26, 0]], ['CStarburstShift', [-0.027, 0.04, 22, 1]],
      ['CTrigShift', [0.02, 0.05, 0]], ['CTwirlocity', [11, 0.0227790164, 8]],
      ['CZoomShift', [0.02, 0.05]], ['CTrigStretchShift', [0.02, 0.03, 1, 0.15]]];
    for (const [name, d] of centre) {
      const k = new (K(name))();
      k.setParams(d);
      const p = { x: 192, y: 144 };
      k.warp(p);
      expect(p.x + ',' + p.y, name + ' [' + d + ']: centre pixel is a fixed point').toBe('192,144');
    }
    // CStarburstShift mode A with dbl3 = 0: g = 0, so r2 = r and theta = a0 — the map is the bare
    // polar round trip, identity up to the two truncations (never worse than 1 px).
    const sb = new BW.CStarburstShift();
    sb.setParams([-0.04, 0.23, 0, 0]);
    let worst = 0;
    for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) {
      const p = { x, y };
      sb.warp(p);
      worst = Math.max(worst, Math.abs(p.x - x), Math.abs(p.y - y));
    }
    expect(worst <= 1, 'CStarburstShift mode A, dbl3 = 0: identity within ' + worst + ' px (truncation only)').toBe(true);
  });
});

// ---------------------------------------------------------------- CStarburstShift's self-repair
// old: 3 checks
describe("CStarburstShift's self-repair", () => {
  it('mode B with dbl3 == 0 writes dbl3 = 1.0 back and then agrees with dbl3 = 1.0 outright', () => {
    const sb = new BW.CStarburstShift();
    sb.setParams([-0.03, 0.2, 0, 1]);                       // mode B with dbl3 == 0
    expect(sb.dbl2, 'CStarburstShift dbl3 starts at 0').toBe(0.0);
    sb.warp({ x: 10, y: 10 });
    expect(sb.dbl2, 'CStarburstShift mode B writes dbl3 = 1.0 back into the instance (0x18041acf0)').toBe(1.0);
    const ref = new BW.CStarburstShift();
    ref.setParams([-0.03, 0.2, 1, 1]);
    let bad = 0;
    for (let y = 0; y < H; y += 11) for (let x = 0; x < W; x += 11) {
      const p = { x, y }, q = { x, y };
      sb.warp(p); ref.warp(q);
      if (p.x !== q.x || p.y !== q.y) bad++;
    }
    expect(bad, 'CStarburstShift after self-repair == dbl3 = 1.0').toBe(0);
  });
});

// ---------------------------------------------------------------- CSwirlShift's per-pixel rand()
// old: 12 checks
describe("CSwirlShift's per-pixel rand()", () => {
  it('draws exactly one rand() per destination pixel, dithers correctly, and covers rand()%4-2', () => {
    const sw = new BW.CSwirlShift();
    sw.setParams([-0.0440031135, 5, -5]);
    expect(randCalls(() => sw.warp({ x: 10, y: 10 })), 'CSwirlShift draws one rand() per destination pixel').toBe(1);
    expect(randCalls(() => { for (let i = 0; i < 100; i++) sw.warp({ x: i, y: 10 }); }),
      'CSwirlShift: one rand() per pixel, 100 pixels').toBe(100);
    sw.dither = 0;
    expect(randCalls(() => sw.warp({ x: 10, y: 10 })), 'an injected dither consumes no rand()').toBe(0);
    // the dither pushes outward: v > 0 moves away from the centre in both axes.
    for (const v of [1, -2]) {
      sw.dither = 0;
      const base = { x: 50, y: 250 }; sw.warp(base);
      sw.dither = v;
      const got = { x: 50, y: 250 }; sw.warp(got);
      expect(got.x - base.x, 'dither v=' + v + ': x0 < cx subtracts v').toBe(-v);
      expect(got.y - base.y, 'dither v=' + v + ': y0 >= cy adds v').toBe(v);
      const base2 = { x: 300, y: 100 }; sw.dither = 0; sw.warp(base2);
      sw.dither = v;
      const got2 = { x: 300, y: 100 }; sw.warp(got2);
      expect(got2.x - base2.x, 'dither v=' + v + ': x0 >= cx adds v').toBe(v);
      expect(got2.y - base2.y, 'dither v=' + v + ': y0 < cy subtracts v').toBe(-v);
    }
    // rand()%4 - 2 covers exactly -2..1
    A.srand(99);
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(A.rand() % 4 - 2);
    expect([...seen].sort((a, b) => a - b).join(','), 'dither range is rand()%4 - 2').toBe('-2,-1,0,1');
  });
});

// ---------------------------------------------------------------- warp() allocates nothing
// old: 14 classes x 2 checks = 28
describe('warp() allocates nothing', () => {
  it('touches only p.x / p.y (sealed point) and yields integers', () => {
    // A warp that allocated would show up as a growing heap over a full map build; the cheap
    // structural check is that warp() only ever touches p.x / p.y.
    const p = { x: 100, y: 100 };
    Object.seal(p);
    for (const C of new Set(BW.list())) {
      const k = new C();
      k.randomize();
      p.x = 100; p.y = 100;
      let threw: unknown = null;
      try { k.warp(p); } catch (e) { threw = e; }
      expect(threw === null, C.name + ': warp() writes only p.x / p.y (sealed point)').toBe(true);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y), C.name + ': warp() yields integers').toBe(true);
    }
  });
});

// ---------------------------------------------------------------- Randomize(): rand() budget
// old: 14 checks
describe('Randomize(): rand() budget', () => {
  it('every class draws its documented number of rand()s', () => {
    const budget: Record<string, number> = {
      CRingSpinShift: 2, CStretchShift: 2, CShiitake: 7, CStarburstShift: 4,
      CSinShimmerShift: 3, CTrigShift: 3, CThingusShift: 2, CTileShift: 1, CTwirlocity: 3,
      CLinearShift: 2, CSwirlShift: 3, CZoomShift: 2, CTrigStretchShift: 4, CEdgeFalloffShift: 2,
    };
    for (const name in budget) {
      const k = new (K(name))();
      expect(randCalls(() => k.randomize()), name + ': Randomize draw count').toBe(budget[name]);
    }
  });
});

// ---------------------------------------------------------------- Randomize(): ranges, splits
// old: 59 checks
describe('Randomize(): ranges, splits', () => {
  it('every parameter lands in its documented range/split', () => {
    const N = 10000;
    function draws(name: string, n?: number): number[][] {
      A.srand(1);
      const k = new (K(name))();
      const out: number[][] = [];
      for (let i = 0; i < (n || N); i++) { k.randomize(); out.push([k.dbl0, k.dbl1, k.dbl2, k.dbl3]); }
      return out;
    }
    // A parameter whose last step is a float narrow (cvtpd2ps) can round UP past its nominal top
    // when u == 1.0, e.g. (float)(1.0*0.3) = 0.30000001192092896. One float ulp of slack.
    function range(rows: number[][], i: number, lo: number, hi: number, msg: string) {
      let mn = Infinity, mx = -Infinity;
      for (const r of rows) { const v = r[i] as number; if (v < mn) mn = v; if (v > mx) mx = v; }
      const slack = Math.max(Math.abs(lo), Math.abs(hi)) * 1.2e-7;
      expect(mn >= lo - slack && mx <= hi + slack,
        msg + ' in [' + lo + ', ' + hi + '] — saw [' + mn + ', ' + mx + ']').toBe(true);
    }
    function frac(rows: number[][], pred: (r: number[]) => boolean): number {
      let n = 0; for (const r of rows) if (pred(r)) n++; return n / rows.length;
    }
    function ints(rows: number[][], i: number, msg: string) {
      expect(rows.every((r) => Number.isInteger(r[i])), msg).toBe(true);
    }
    function spread(rows: number[][], i: number, lo: number, hi: number, msg: string) {   // every integer value in [lo,hi] is drawn at least once
      const seen = new Set(rows.map((r) => r[i]));
      const miss: number[] = [];
      for (let v = lo; v <= hi; v++) if (!seen.has(v)) miss.push(v);
      expect(miss.length === 0 && seen.size === hi - lo + 1,
        msg + ' covers ' + lo + '..' + hi + (miss.length ? ' — missing ' + miss : '') +
        (seen.size !== hi - lo + 1 ? ' — extra values' : '')).toBe(true);
    }

    let r = draws('CRingSpinShift');
    range(r, 0, -0.05, 0.05, 'CRingSpinShift dbl1 spin');
    range(r, 1, 0, 0.8, 'CRingSpinShift dbl2 ring');
    expect(Math.abs(frac(r, (x) => (x[0] as number) < 0) - 0.5) < 0.02, 'CRingSpinShift spin is centred on 0').toBe(true);

    r = draws('CStretchShift');
    range(r, 0, -0.05, 0.05, 'CStretchShift dbl1');
    range(r, 1, 0, 0.3, 'CStretchShift dbl2');

    r = draws('CShiitake');
    range(r, 0, -1, 10, 'CShiitake dbl1 radial offset');
    range(r, 1, 0, 16 * Math.PI, 'CShiitake dbl2 ripple amplitude');
    range(r, 2, 0, 8, 'CShiitake dbl3 twist');
    // 1-in-100 escapes: dbl2 > 0.05*pi and dbl3 > 0.05 can only come from the wide branch
    expect(Math.abs(frac(r, (x) => (x[1] as number) > 0.05 * Math.PI) - 0.01) <= 0.004, 'CShiitake dbl2 1-in-100 escape rate').toBe(true);
    expect(Math.abs(frac(r, (x) => (x[2] as number) > 0.05) - 0.01) <= 0.004, 'CShiitake dbl3 1-in-100 escape rate').toBe(true);
    ints(r, 3, 'CShiitake dbl4 is integer-valued');
    range(r, 3, 1, 100, 'CShiitake dbl4');
    // 1/10 -> 1..100, 3/10 -> 1..5, 6/10 -> 1..2
    expect(Math.abs(frac(r, (x) => (x[3] as number) > 5) - 0.1 * 0.95) <= 0.01, 'CShiitake dbl4 > 5 only via the 1/10 branch').toBe(true);
    expect(Math.abs(frac(r, (x) => (x[3] as number) >= 3 && (x[3] as number) <= 5) - (0.1 * 0.03 + 0.3 * 0.6)) <= 0.02, 'CShiitake dbl4 in 3..5').toBe(true);
    expect(Math.abs(frac(r, (x) => (x[3] as number) <= 2) - (0.1 * 0.02 + 0.3 * 0.4 + 0.6)) <= 0.02, 'CShiitake dbl4 <= 2').toBe(true);

    r = draws('CStarburstShift');
    range(r, 0, -0.05, 0.05, 'CStarburstShift dbl1');
    range(r, 1, 0, 0.3, 'CStarburstShift dbl2');
    expect(r.every((x) => (x[2] as number) % 2 === 0), 'CStarburstShift dbl3 is always even (m + m%2)').toBe(true);
    range(r, 2, 0, 40, 'CStarburstShift dbl3');
    expect(r.every((x) => x[3] === 0 || x[3] === 1), 'CStarburstShift dbl4 is 0 or 1').toBe(true);
    expect(Math.abs(frac(r, (x) => x[3] === 1) - 0.5) <= 0.02, 'CStarburstShift mode split').toBe(true);
    // dbl3 = m + (m%2) over m = rand()%40 is 0 only for m == 0, so p = 1/40 — NOT the 1/20 spec 11
    // §4 states (and the self-repair therefore fires on 1 in 80 instances, not 1 in 40).
    expect(Math.abs(frac(r, (x) => x[2] === 0) - 0.025) <= 0.008, 'CStarburstShift dbl3 == 0 (p = 1/40)').toBe(true);

    r = draws('CSinShimmerShift');
    range(r, 0, -5, 5, 'CSinShimmerShift dbl1 amplitude');
    range(r, 1, 0, 2, 'CSinShimmerShift dbl2 frequency');
    expect(r.every((x) => x[2] === 0 || x[2] === 1), 'CSinShimmerShift dbl3 axis is 0 or 1').toBe(true);
    expect(Math.abs(frac(r, (x) => x[2] === 1) - 0.5) <= 0.02, 'CSinShimmerShift axis split').toBe(true);

    r = draws('CTrigShift');
    range(r, 0, -0.05, 0.05, 'CTrigShift dbl1');
    range(r, 1, -0.05, 0.05, 'CTrigShift dbl2');
    spread(r, 2, 0, 2, 'CTrigShift dbl3 selector');
    for (const m of [0, 1, 2]) expect(Math.abs(frac(r, (x) => x[2] === m) - 1 / 3) <= 0.02, 'CTrigShift mode ' + m + ' rate').toBe(true);

    r = draws('CThingusShift');
    range(r, 0, -0.4, 0.4, 'CThingusShift dbl1');
    range(r, 1, 0, 0.2, 'CThingusShift dbl2');

    r = draws('CTileShift');
    range(r, 0, 0, 0.2, 'CTileShift dbl1');

    r = draws('CTwirlocity');
    ints(r, 0, 'CTwirlocity dbl1 rings is integer-valued');
    spread(r, 0, 1, 50, 'CTwirlocity dbl1 rings');
    range(r, 1, 0, 0.6, 'CTwirlocity dbl2 twist');
    spread(r, 2, 0, 9, 'CTwirlocity dbl3');
    expect(Math.abs(frac(r, (x) => x[2] === 0) - 0.1) <= 0.015, 'CTwirlocity outward mode p = 1/10').toBe(true);

    r = draws('CLinearShift');
    spread(r, 0, -3, 2, 'CLinearShift dbl1 (asymmetric -3..2)');
    spread(r, 1, -3, 2, 'CLinearShift dbl2');
    expect(Math.abs(frac(r, (x) => x[0] === 0 && x[1] === 0) - 1 / 36) <= 0.01, 'CLinearShift draws (0,0) at p = 1/36').toBe(true);

    r = draws('CSwirlShift');
    range(r, 0, -0.05, 0.05, 'CSwirlShift dbl1 spin');
    spread(r, 1, -10, 9, 'CSwirlShift dbl2 amplitude');
    spread(r, 2, -12, 11, 'CSwirlShift dbl3 lobes');

    r = draws('CZoomShift');
    range(r, 0, -0.05, 0.05, 'CZoomShift dbl1 spin');
    range(r, 1, -0.1, 0.1, 'CZoomShift dbl2 zoom rate');
    expect(Math.abs(frac(r, (x) => (x[1] as number) < 0) - 0.5) < 0.02, 'CZoomShift zoom rate is centred on 0').toBe(true);

    r = draws('CTrigStretchShift');
    range(r, 0, -0.05, 0.05, 'CTrigStretchShift dbl1');
    range(r, 1, -0.05, 0.05, 'CTrigStretchShift dbl2');
    spread(r, 2, 0, 2, 'CTrigStretchShift dbl3 axis mode');
    range(r, 3, 0, 0.3, 'CTrigStretchShift dbl4 pinch');

    r = draws('CEdgeFalloffShift');
    range(r, 0, 0, 0.1, 'CEdgeFalloffShift dbl1 rate is non-negative');
    spread(r, 1, 0, 3, 'CEdgeFalloffShift dbl2 edge');
    for (const m of [0, 1, 2, 3]) expect(Math.abs(frac(r, (x) => x[1] === m) - 0.25) <= 0.02, 'CEdgeFalloffShift edge ' + m).toBe(true);
  });
});

// ---------------------------------------------------------------- shipped values reconstruct
// old: 16 checks
describe('shipped values reconstruct', () => {
  it('every shipped registry parameter is reproduced by the Randomize float chain from one rand() draw', () => {
    // Every shipped registry parameter is reproduced by the Randomize float chain from one integer
    // rand() draw n (spec 11 §0.3 / §1). Relative fit < 1e-7 — the registry decimals are stored at
    // reduced precision, so this pins the op sequence, not the last ulp (spec 11 §10 item 1).
    const CASES: [string, number, number, number, string][] = [
      ['CRingSpinShift', 0, 4080, -0.0375484487, 'brightsphere dbl1'],
      ['CRingSpinShift', 1, 31248, 0.762913907, 'brightsphere dbl2'],
      ['CStretchShift', 0, 30645, 0.0435239729, 'cominatcha dbl1'],
      ['CStretchShift', 1, 16865, 0.154408399, 'cominatcha dbl2'],
      ['CStretchShift', 0, 4229, -0.0370937229, 'strawberryaid dbl1'],
      ['CStretchShift', 1, 15527, 0.142158269, 'strawberryaid dbl2'],
      ['CTileShift', 0, 16547, 0.100997955, 'gemstonematrix dbl1'],
      ['CTileShift', 0, 5532, 0.0337656789, 'dance of the freaky circles dbl1'],
      ['CTwirlocity', 1, 1244, 0.0227790164, 'relatively calm dbl2'],
      ['CSwirlShift', 0, 1965, -0.0440031135, 'smoke or water? dbl1'],
      ['CSwirlShift', 0, 643, -0.0480376606, 'back to the groove dbl1'],
      ['CSwirlShift', 0, 24628, 0.0251609854, 'my tornado is resting dbl1'],
      ['CShiitake', 0, 25389, 7.5231788, 'drinkdeep dbl1'],
      ['CShiitake', 1, 1469, 0.00704214565, 'drinkdeep dbl2'],
      ['CShiitake', 2, 14347, 0.0218924531, 'drinkdeep dbl3'],
      ['CShiitake', 0, 1942, -0.348063601, 'the world dbl1'],
    ];
    for (const [cls, slot, n, shipped, label] of CASES) {
      // force every draw in the body to return n, then read the slot this value came from
      const realRand = A.rand;
      A.rand = () => n;
      const probe = new (K(cls))();
      probe.randomize();
      A.rand = realRand;
      const got = probe['dbl' + slot];
      expect(Math.abs(got - shipped) / Math.abs(shipped) < 1e-7,
        cls + ' ' + label + ': rand() = ' + n + ' -> ' + got + ' vs shipped ' + shipped +
        ' (rel ' + (Math.abs(got - shipped) / Math.abs(shipped)).toExponential(2) + ')').toBe(true);
    }
  });
});

// ---------------------------------------------------------------- constants are the DLL's literals
// old: 7 checks
describe("constants are the DLL's literals", () => {
  it('the source has the hand-typed float literals verbatim and no Math.PI', () => {
    const srcPath = path.join(here, '..', '..', 'src', 'engine', 'battery', 'warps.ts');
    const raw = fs.readFileSync(srcPath, 'utf8');
    const src = raw.replace(/\/\/[^\n]*/g, '');           // code only, comments mention Math.PI
    for (const lit of ['3.1415927410125732', '6.28', '1.57', '3.14', '9.9999997473787516e-05']) {
      expect(src.indexOf(lit) >= 0, 'literal ' + lit + ' is present verbatim').toBe(true);
    }
    expect(src.indexOf('Math.PI') < 0, 'no Math.PI anywhere — the DLL wrote its own pi literals').toBe(true);
    // CTileShift derives its period from H on BOTH axes (the DLL copy-paste, kept deliberately):
    // a wide-but-short surface must still pinch x with the H period.
    const t = new BW.CTileShift();
    t.setSize(400, 100);
    t.setParams([0.5]);                                     // P = 100 * 0.5 = 50, not 200
    const p = { x: 99, y: 5 };
    t.warp(p);
    const m = 99 - Math.trunc(99 / 50) * 50, tt = m / 50;
    expect(p.x, 'CTileShift x period comes from H').toBe(99 - Math.trunc(tt * tt * tt * m));
  });
});

// ---------------------------------------------------------------- full map build (driver contract)
// old: 14 classes x 2 checks = 28
describe('full map build (driver contract)', () => {
  it('every recovered source pixel is on the surface, for every class', () => {
    const map = new Int32Array(W * H), p = { x: 0, y: 0 };
    for (const C of new Set(BW.list())) {
      const k = new C();
      A.srand(4242);
      k.randomize();
      let bad = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        p.x = x; p.y = y;
        k.mapPoint(p);
        if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) bad++;
        map[y * W + x] = p.y * W + p.x;
      }
      expect(bad === 0, C.name + ': every recovered source pixel is on the surface').toBe(true);
      expect(map.every((v) => v >= 0 && v < W * H), C.name + ': map offsets are in range').toBe(true);
    }
  });
});
