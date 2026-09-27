// Ported from tests/kernels.test.js — spec 03 numeric claims for Alchemy.Kernels.
import { describe, expect, it } from 'vitest';
import { A } from '../../src/engine/ns';
import { Kernels } from '../../src/engine/kernels';
import { WarpKernel } from '../../src/engine/effect';
import type { WarpPoint } from '../../src/engine/effect';

const K = Kernels;
type ShiftOScopeK = InstanceType<typeof K.ShiftOScope>;
type PoolEntry = ReturnType<typeof K.makePool>[number];

function pt(k: WarpKernel, x: number, y: number): string {
  const p: WarpPoint = { x, y };
  k.map(p);
  return p.x + ',' + p.y;
}
// The driver contract (spec 01 §2.4 Map2 / spec 03 §0.2), F2 optional.
function map2(F1: WarpKernel, F2: WarpKernel | null, x: number, y: number): string {
  const p: WarpPoint = { x, y };
  F1.map(p);
  if ((p.x >>> 0) >= (F1.w >>> 0)) p.x = F1.identityFallback ? x : F1.fallbackX;
  if ((p.y >>> 0) >= (F1.h >>> 0)) p.y = F1.identityFallback ? y : F1.fallbackY;
  if (F2) {
    const ax = p.x, ay = p.y;
    F2.map(p);
    if ((p.x >>> 0) >= (F2.w >>> 0)) p.x = F2.identityFallback ? ax : F2.fallbackX;
    if ((p.y >>> 0) >= (F2.h >>> 0)) p.y = F2.identityFallback ? ay : F2.fallbackY;
    p.x = (p.x + x) >> 1;
    p.y = (p.y + y) >> 1;
  }
  return p.x + ',' + p.y;
}
function mid(v: number): number { return v >> 1; }
const W = 16, H = 12;                            // mx=8 my=6 halfDiag=10

// ---------------------------------------------------------------- flags / identity
describe('flags / identity', () => {
  it('nameId, WarpKernel flags and defaults for all four kernels', () => {
    const c = new K.CombShear(), l = new K.LinearShift(), s = new K.StretchShift(), o = new K.ShiftOScope();
    expect(c.nameId).toBe(114);
    expect(l.nameId).toBe(105);
    expect(s.nameId).toBe(106);
    expect(o.nameId).toBe(109);
    for (const [k, n] of [[c, 'COMB'], [l, 'LINEAR'], [s, 'STRETCH'], [o, 'SCOPE']] as const) {
      expect(k, n + ' extends WarpKernel').toBeInstanceOf(WarpKernel);
      expect(k.category, n + ' category').toBe(5);
      expect(k.traceId, n + ' trace id').toBe(6);
      expect(k.prob, n + ' probability').toBe(1.0);
      expect(k.fallbackX, n + ' fallbackX').toBe(0);
      expect(k.fallbackY, n + ' fallbackY').toBe(0);
    }
    expect(c.chainable).toBe(true); expect(c.instantTransition).toBe(false); expect(c.identityFallback).toBe(true);
    expect(l.chainable).toBe(true); expect(l.instantTransition).toBe(false); expect(l.identityFallback).toBe(false);
    expect(s.chainable).toBe(true); expect(s.instantTransition).toBe(false); expect(s.identityFallback).toBe(true);
    expect(o.chainable).toBe(false); expect(o.instantTransition).toBe(true); expect(o.identityFallback).toBe(false);
    // ctor defaults
    expect(c.speed).toBe(1); expect(c.width).toBe(1); expect(c.vertical).toBe(false);
    expect(l.xShift).toBe(1); expect(l.yShift).toBe(1); expect(l.falloff).toBe(false);
    expect(l.fallPctX).toBe(0.5); expect(l.fallPctY).toBe(0.5);
    expect(l.fallDir).toBe(0); expect(l.sinShake).toBe(0); expect(l.sinLoops).toBe(4);
    expect(s.rotation).toBe(0.01); expect(s.movePct).toBe(0.1);
    expect(s.flowPoint).toBe(false); expect(s.pctX).toBe(0.5); expect(s.pctY).toBe(0.5);
    expect(s.sinShake).toBe(false); expect(s.sinLoops).toBe(5);
    expect(s.maxRadius).toBe(100.0); expect(s.amp).toBe(0);
    // SCOPE ctor randomizes itself last, so only the never-touched defaults survive
    expect(o.stretchFactor).toBe(0.0); expect(o.linearMoveX).toBe(0);
    expect(o.linearMoveY).toBe(0); expect(o.oceanFactor).toBe(0.0);
    expect(o.wigglyStretch).toBe(false);
    // base geometry
    const g = new K.CombShear(); g.setSize(16, 12);
    expect(g.cx0, 'cx0 = W>>1').toBe(8); expect(g.cy0, 'cy0 = H>>1').toBe(6); expect(g.halfDiag, 'halfDiag = sqrt(W*W+H*H)/2').toBe(10);
    const g2 = new K.CombShear(); g2.setSize(17, 13);
    expect(g2.cx0, 'cx0 floors').toBe(8); expect(g2.cy0, 'cy0 floors').toBe(6);
  });

  it('SCOPE ctor draws ReflectionMode first from the live stream', () => {
    A.srand(4242); const want = A.rand() % 5;
    A.srand(4242); const o = new K.ShiftOScope();
    expect(o.reflectionMode).toBe(want);
  });
});

// ---------------------------------------------------------------- COMB
describe('COMB', () => {
  it('band geometry, vertical stripes, Speed=0 identity, band-pair split', () => {
    const c = new K.CombShear(); c.setSize(W, H);
    c.width = 3; c.speed = 2; c.vertical = false;          // B=3 S=2 P=6
    expect(pt(c, 0, 0), 'upper band, wedge guard rx<=ry -> x-S (off surface)').toBe('-2,0');
    expect(map2(c, null, 0, 0), 'out of range keeps the destination (identity policy)').toBe('0,0');
    expect(pt(c, 5, 0), 'upper band, dstX>=B -> x-S').toBe('3,0');
    expect(pt(c, 1, 4), 'lower band -> x+S').toBe('3,4');
    expect(pt(c, 15, 4), 'lower band right wedge -> y+S').toBe('15,6');
    expect(pt(c, 2, 1), 'upper band wedge diversion -> y+S').toBe('2,3');
    c.vertical = true;
    expect(pt(c, 2, 5), 'vertical stripe rx<=B -> y-S').toBe('2,3');
    expect(pt(c, 4, 5), 'vertical stripe rx>B -> y+S').toBe('4,7');
    expect(pt(c, 3, 5), 'vertical boundary rx==B is inclusive').toBe('3,3');
    // zero Speed == identity
    c.speed = 0;
    for (const vert of [false, true]) {
      c.vertical = vert;
      const bad: string[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pt(c, x, y) !== x + ',' + y) bad.push(x + ',' + y);
      expect(bad, 'Speed=0 is the identity (vertical=' + vert + ')').toEqual([]);
    }
    // band pair split is [0..B] / [B+1..2B-1] -> the halves differ by one pixel
    c.speed = 1; c.width = 3; c.vertical = true;
    let up = 0;
    for (let x = 0; x < 6; x++) if (pt(c, x, 5) === x + ',4') up++;
    expect(up, 'vertical band pair splits 4/2 for Width=3').toBe(4);
  });
});

// ---------------------------------------------------------------- LINEAR
describe('LINEAR', () => {
  it('translate, all 8 falloff directions, sine shear, identity cases', () => {
    const l = new K.LinearShift(); l.setSize(W, H);
    l.xShift = 2; l.yShift = -1; l.falloff = false; l.sinShake = 0; l._derive();
    expect(pt(l, 5, 5), 'translate').toBe('7,4');
    expect(map2(l, null, 15, 5), 'out of range samples pixel (0,0) per axis (fallback policy)').toBe('0,4');
    l.falloff = true; l.fallPctX = 0.1; l.fallPctY = 0.1; l._derive();
    l.fallDir = 0; expect(pt(l, 10, 3), 'SCALE_X_FROM_LEFT').toBe('11,3');
    l.fallDir = 1; expect(pt(l, 10, 3), 'SCALE_Y_FROM_TOP (trunc(1.1*3)=3)').toBe('10,3');
    l.fallDir = 1; expect(pt(l, 10, 5), 'SCALE_Y_FROM_TOP (trunc(1.1*5)=5)').toBe('10,5');
    l.fallDir = 1; expect(pt(l, 10, 10), 'SCALE_Y_FROM_TOP (trunc(1.1*10)=11)').toBe('10,11');
    l.fallDir = 2; expect(pt(l, 4, 3), 'SCALE_X_FROM_RIGHT').toBe('3,3');
    l.fallDir = 3; expect(pt(l, 4, 3), 'SCALE_Y_FROM_BOTTOM (trunc(1.1*8-8)=0)').toBe('4,3');
    l.fallDir = 3; expect(pt(l, 4, 0), 'SCALE_Y_FROM_BOTTOM (trunc(1.1*11-11)=1)').toBe('4,-1');
    l.fallDir = 4; expect(pt(l, 10, 10), 'FallDir 4 = left + top').toBe('11,11');
    l.fallDir = 5; expect(pt(l, 4, 0), 'FallDir 5 = right + bottom').toBe('3,-1');
    l.fallDir = 6; expect(pt(l, 10, 0), 'FallDir 6 = left + bottom').toBe('11,-1');
    l.fallDir = 7; expect(pt(l, 4, 10), 'FallDir 7 = right + top').toBe('3,11');
    l.fallDir = 9; expect(pt(l, 4, 10), 'FallDir out of range = no scale').toBe('4,10');
    expect(pt(l, 0, 0), 'Falloff ignores XShift/YShift').toBe('0,0');
    // stage 2: single-precision sine shear, x driven by y and amplitude 3*YShift
    l.falloff = false; l.xShift = 0; l.yShift = 1; l.sinShake = 1; l.sinLoops = 6; l._derive();
    expect(pt(l, 5, 0), 'shear sin(pi/2)*3 -> +3').toBe('8,1');
    expect(pt(l, 5, 1), 'shear sin(pi)*3 -> 0').toBe('5,2');
    expect(pt(l, 5, 2), 'shear sin(3pi/2)*3 -> -3 (round away from zero)').toBe('2,3');
    expect(pt(l, 5, 3), 'shear sin(2pi)*3 -> 0').toBe('5,4');
    l.sinShake = 2; l.xShift = 0; l.yShift = 1; l._derive();
    expect(pt(l, 5, 3), 'SinShake=2 with XShift=0 has zero amplitude (cross-coupled)').toBe('5,4');
    l.xShift = 1; l.yShift = 1; l.sinLoops = 4; l._derive();
    expect(pt(l, 0, 5), 'y-shear +2').toBe('1,8');
    expect(pt(l, 4, 5), 'y-shear -2').toBe('5,4');
    // zero parameters -> identity
    l.xShift = 0; l.yShift = 0; l.falloff = false; l.sinShake = 0; l._derive();
    let bad: string[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pt(l, x, y) !== x + ',' + y) bad.push(x + ',' + y);
    expect(bad, 'zero shifts / no falloff / no shake is the identity').toEqual([]);
    l.sinShake = 1; l.sinLoops = 7; l._derive();
    bad = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pt(l, x, y) !== x + ',' + y) bad.push(x + ',' + y);
    expect(bad, 'shear with both shifts 0 stays the identity').toEqual([]);
  });
});

// ---------------------------------------------------------------- STRETCH
describe('STRETCH', () => {
  it('pole/maxRadius/amp geometry, identity axes, radial pinch, ripple, FlowPoint, off-centre', () => {
    const s = new K.StretchShift();
    s.rotation = 0; s.movePct = 0; s.flowPoint = false; s.pctX = 0.5; s.pctY = 0.5; s.sinShake = false;
    s.setSize(W, H);
    expect(s.poleX, 'poleX = trunc(W*PctX)').toBe(8);
    expect(s.poleY, 'poleY = trunc(H*PctY)').toBe(6);
    expect(s.maxRadius, 'maxRadius = largest pole-to-corner distance').toBe(10);
    expect(s.amp, 'amp = trunc(H*MovePct)').toBe(0);
    expect(pt(s, 12, 6), 'identity on +x axis').toBe('12,6');
    expect(pt(s, 4, 6), 'identity on -x axis').toBe('4,6');
    expect(pt(s, 8, 0), 'identity on -y axis').toBe('8,0');
    expect(pt(s, 8, 11), 'identity on +y axis').toBe('8,11');
    expect(pt(s, 11, 10), 'trunc-toward-zero costs a pixel off-axis (r=5 at 3-4-5)').toBe('11,9');
    let worst = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p: WarpPoint = { x, y }; s.map(p);
      worst = Math.max(worst, Math.abs(p.x - x), Math.abs(p.y - y));
    }
    expect(worst, 'zero Rotation/MovePct is the identity to within the truncation (worst ' + worst + ')').toBeLessThanOrEqual(1);
    // cubic radial pinch
    s.movePct = 0.5; s.setSize(W, H);
    expect(s.amp, 'amp with MovePct=0.5, H=12').toBe(6);
    expect(pt(s, 12, 6), 'pinch: r=4, t=0.4, rSrc=4-0.4^3*6=3.616 -> trunc 3').toBe('11,6');
    expect(pt(s, 8, 6), 'pole maps to itself').toBe('8,6');
    // amp scales with H on BOTH axes
    const wide = new K.StretchShift(); wide.movePct = 0.5; wide.pctX = 0.5; wide.pctY = 0.5; wide.setSize(100, 10);
    expect(wide.amp, 'amp uses H even on a wide surface').toBe(5);
    // maxRadius with an off-centre pole = the far corner
    const off = new K.StretchShift(); off.pctX = 0.05; off.pctY = 0.05; off.movePct = 0; off.setSize(W, H);
    expect(off.poleX, 'pole at PctX=0.05 on W=16').toBe(0);
    expect(off.maxRadius, 'maxRadius = sqrt((W-poleX)^2+(H-poleY)^2) = 20').toBe(20);
    // FlowPoint moves the centre to the pole
    const fp = new K.StretchShift(); fp.rotation = 0; fp.movePct = 0; fp.pctX = 0.25; fp.pctY = 0.5;
    fp.flowPoint = true; fp.setSize(W, H);
    expect(fp.poleX, 'FlowPoint pole').toBe(4);
    expect(pt(fp, 4, 6), 'FlowPoint centre is the pole').toBe('4,6');
    // ripple mode uses the single-precision pi and SinLoops half-periods
    const rip = new K.StretchShift(); rip.rotation = 0.2; rip.movePct = 0.1; rip.pctX = 0.5; rip.pctY = 0.5;
    rip.sinShake = true; rip.sinLoops = 3; rip.setSize(W, H);
    expect(rip.amp, 'ripple amp').toBe(1);
    expect(pt(rip, 12, 6), 'ripple regression point A').toBe('11,6');
    expect(pt(rip, 4, 2), 'ripple regression point B').toBe('4,3');
    // out of range keeps the destination per axis (identity policy)
    const edge = new K.StretchShift();
    edge.rotation = 0.22; edge.movePct = 0.30; edge.flowPoint = true; edge.pctX = 0.95; edge.pctY = 0.95;
    edge.sinShake = false; edge.setSize(W, H);
    expect(edge.poleX, 'off-centre pole').toBe(15); expect(edge.amp, 'off-centre amp').toBe(3);
    expect(pt(edge, 15, 0), 'can map off the right edge').toBe('16,1');
    expect(map2(edge, null, 15, 0), 'out-of-range x keeps dstX, y is untouched').toBe('15,1');
  });
});

// ---------------------------------------------------------------- SCOPE folds
function scope(mode: number, extra?: (o: ShiftOScopeK) => void): ShiftOScopeK {
  const o = new K.ShiftOScope();
  o.reflectionMode = mode;
  o.shiftMode = 1;                                   // LINEAR sub-warp...
  o.linear.xShift = 0; o.linear.yShift = 0; o.linear.falloff = false; o.linear.sinShake = 0;
  o.linear._derive();                                // ...configured as the identity
  if (extra) extra(o);
  o.setSize(W, H);
  return o;
}
describe('SCOPE folds', () => {
  it('embeds one of each other kernel, forwards W/H/geometry', () => {
    const o = scope(0);
    expect(o.stretch.w, 'forwards W to the embedded STRETCH').toBe(W);
    expect(o.stretch.h, 'forwards H to the embedded STRETCH').toBe(H);
    expect(o.stretch.maxRadius, 'embedded STRETCH recomputes its geometry on resize').toBe(10);
    expect(o.linear.w, 'forwards W to the embedded LINEAR').toBe(W);
    expect(o.comb.h, 'forwards H to the embedded COMB').toBe(H);
    expect(o.mx).toBe(8); expect(o.my).toBe(6);
    expect(o.stretch instanceof K.StretchShift && o.linear instanceof K.LinearShift && o.comb instanceof K.CombShear,
      'embeds one of each other class').toBe(true);
  });

  it("only the outer flag is consulted: a COMB sub-warp off the surface lands on (0,0)", () => {
    const oc = scope(4, k => { k.shiftMode = 2; k.boxSize = 1; k.comb.width = 3; k.comb.speed = 2; k.comb.vertical = false; });
    expect(oc.comb.identityFallback, 'embedded COMB keeps its own identity policy').toBe(true);
    expect(pt(oc, 0, 0), 'sub-warp may leave the surface').toBe('-2,0');
    expect(map2(oc, null, 0, 0), "SCOPE's own fallback policy wins over the sub-kernel's").toBe('0,0');
  });

  it('mode 0 — 4-way axis mirror, reflection about W and H', () => {
    const m0 = scope(0);
    expect(pt(m0, 3, 2), 'top-left quadrant warps (identity sub-warp)').toBe('3,2');
    expect(pt(m0, 13, 2), 'top-right mirrors to W-dstX').toBe('3,2');
    expect(pt(m0, 3, 9), 'bottom-left mirrors to H-dstY').toBe('3,3');
    expect(pt(m0, 13, 9), 'bottom-right mirrors both').toBe('3,3');
    const bad: string[] = [];
    for (let y = 1; y <= 6; y++) for (let x = 1; x <= 8; x++) {
      if (pt(m0, x, y) !== pt(m0, W - x, y)) bad.push('W-x@' + x + ',' + y);              // about W, not W-1
      if (pt(m0, x, y) !== pt(m0, x, H - y)) bad.push('H-y@' + x + ',' + y);              // about H, not H-1
      if (pt(m0, x, y) !== pt(m0, W - x, H - y)) bad.push('both@' + x + ',' + y);
    }
    expect(bad, 'symmetric under x->W-x and y->H-y').toEqual([]);
    expect(pt(m0, 8, 6), 'boundaries x<=mx and y<=my are inclusive on the warped side').toBe('8,6');
    expect(pt(m0, 0, 0) === '0,0', 'column 0 maps to itself').toBe(true);
    let reach = 0;
    for (let x = 0; x < W; x++) { const r = Number(pt(m0, x, 2).split(',')[0]) | 0; if (r === 0) reach++; }
    expect(reach, 'reflection about W leaves one mirrored column unreachable (x=0 hit once)').toBe(1);
  });

  it('mode 1 — 8-way diagonal kaleidoscope', () => {
    const m1 = scope(1);
    expect(pt(m1, 2, 1), 'top triangle left half warps').toBe('2,1');
    expect(pt(m1, 14, 1), 'top triangle right half folds to 2*mx-dstX').toBe('2,1');
    expect(pt(m1, 14, 5), 'right triangle -> ((W-dstX)+mx, |dstY-my|)').toBe('10,1');
    expect(pt(m1, 1, 5), 'left triangle -> (mx-dstX, |dstY-my|)').toBe('7,1');
    expect(pt(m1, 6, 11), 'bottom triangle -> (dstX, H-dstY)').toBe('6,1');
    expect(pt(m1, 12, 11), 'bottom triangle right half -> (2*mx-dstX, H-dstY)').toBe('4,1');
    const bad: string[] = [];
    for (let y = 0; y < H; y++) for (let x = 1; x < mid(W); x++) {
      const Av = W * y, Bv = H * x, Cv = (W - x) * H;
      const top = Av < Bv && Av < Cv, bot = Av >= Bv && Av >= Cv;
      if (top || bot) if (pt(m1, x, y) !== pt(m1, 2 * 8 - x, y)) bad.push(x + ',' + y);  // the two x-mirrored wedges
    }
    expect(bad, 'top and bottom wedges are symmetric about x=mx').toEqual([]);
  });

  it('mode 2 — radial ring fold at a QUARTER of the diagonal, then mode 0 inside', () => {
    const m2 = scope(2);
    expect(m2.halfInt, 'fold radius = halfDiag/2 = sqrt(W*W+H*H)/4').toBe(5);
    expect(pt(m2, 13, 6), 'continuous at the seam (r == half)').toBe('13,6');
    expect(pt(m2, 12, 6), 'inside the disk behaves like mode 0').toBe('4,6');
    expect(pt(m2, 0, 0), 'corners collapse to the centre').toBe('8,6');
    expect(pt(m2, 8, 0), 'outer annulus reflects the radius about half').toBe('8,2');
    expect(pt(m2, 8, 2), 'reflected partner at r=4 maps to the same source').toBe('8,2');
    expect(pt(m2, 8, 6), 'centre maps to itself').toBe('8,6');
    const bad: string[] = [];
    for (let y = 1; y <= 6; y++) for (let x = 1; x <= 8; x++) {
      const dx = x - 8, dy = y - 6;
      if (Math.trunc(Math.sqrt(dx * dx + dy * dy)) >= 5) continue;       // inside the disk only
      if (Math.trunc(Math.sqrt((W - x - 8) * (W - x - 8) + dy * dy)) >= 5) continue;
      if (pt(m2, x, y) !== pt(m2, W - x, y)) bad.push(x + ',' + y);
    }
    expect(bad, 'keeps mode 0 mirror symmetry inside the disk').toEqual([]);
    // the boundary really is floor(r) >= floor(half): needs a non-integer half
    const m2b = scope(2); m2b.setSize(17, 13);
    expect(m2b.halfInt, 'halfInt truncates (half = 5.3502…)').toBe(5);
    expect(pt(m2b, 11, 10), 'r=5 < half=5.35 still takes the OUTER branch (integer test)').toBe('11,10');
    // a float r >= half test would have given the inner mode-0 result (6,10)
  });

  it('mode 3 — lattice of shrunken clones', () => {
    const m3 = scope(3, k => { k.centerCircleRadius = 5; k.littleCircleRadius = 3; });
    expect(m3.mxMinusR, 'offset mx - CenterCircleRadius').toBe(3);
    expect(m3.myMinusR, 'offset my - CenterCircleRadius').toBe(1);
    expect(pt(m3, 8, 6), 'inside the central disk warps').toBe('8,6');
    expect(pt(m3, 8, 1), 'disk edge (R >= r) is inclusive and warps').toBe('8,1');
    expect(pt(m3, 0, 0), 'lattice tile origin -> (mx-R, my-R)').toBe('3,1');
    expect(pt(m3, 2, 1), 'lattice scaled by 2R/N with round-away').toBe('10,4');
    const bad: string[] = [];
    const P = 5;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = 8 - x, dy = 6 - y;
      if (Math.sqrt(dx * dx + dy * dy) <= 5) continue;
      if (x + P < W && Math.sqrt((8 - x - P) * (8 - x - P) + dy * dy) > 5) {
        if (pt(m3, x, y) !== pt(m3, x + P, y)) bad.push('x+P@' + x + ',' + y);
      }
      if (y + P < H && Math.sqrt(dx * dx + (6 - y - P) * (6 - y - P)) > 5) {
        if (pt(m3, x, y) !== pt(m3, x, y + P)) bad.push('y+P@' + x + ',' + y);
      }
    }
    expect(bad, 'lattice is (LittleCircleRadius+2)-periodic outside the disk').toEqual([]);
  });

  it('mode 4 — checkerboard gate (the sub-warp is a visible +1 so the gate is observable)', () => {
    const m4 = scope(4, k => { k.boxSize = 2; k.linear.xShift = 1; k.linear.yShift = 0; k.linear._derive(); });
    m4.linear._derive();
    expect(pt(m4, 0, 0), 'both block indices even -> warp').toBe('1,0');
    expect(pt(m4, 1, 1), 'inside the same even block -> warp').toBe('2,1');
    expect(pt(m4, 2, 0), 'odd x block -> identity').toBe('2,0');
    expect(pt(m4, 0, 2), 'odd y block -> identity').toBe('0,2');
    expect(pt(m4, 3, 3), 'both odd -> identity').toBe('3,3');
    let warped = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pt(m4, x, y) !== x + ',' + y) warped++;
    expect(warped, 'warps exactly one block in four').toBe((W * H) / 4);
    const m4s = scope(4, k => { k.boxSize = 1; k.linear.xShift = 1; k.linear.yShift = 0; });
    m4s.linear._derive();
    expect(pt(m4s, 0, 0), 'BoxSize=1 stipple warps (0,0)').toBe('1,0');
    expect(pt(m4s, 1, 0), 'BoxSize=1 stipple freezes (1,0)').toBe('1,0');
    expect(pt(m4s, 2, 2), 'BoxSize=1 stipple warps (2,2)').toBe('3,2');
    const m4z = scope(4, k => { k.boxSize = 0; k.linear.xShift = 1; k.linear.yShift = 0; });
    m4z.linear._derive();
    expect(pt(m4z, 1, 1), 'BoxSize=0 skips the gate entirely').toBe('2,1');
  });

  it('ReflectionMode outside 0..4 is the identity', () => {
    const m9 = scope(9, k => { k.linear.xShift = 3; });
    m9.linear._derive();
    const bad: string[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pt(m9, x, y) !== x + ',' + y) bad.push(x + ',' + y);
    expect(bad).toEqual([]);
  });

  it('ShiftMode dispatch (0 STRETCH, 2 COMB, 3 spin, >3 identity)', () => {
    const sm = scope(4, k => { k.boxSize = 0; });
    sm.shiftMode = 0; sm.stretch.rotation = 0; sm.stretch.movePct = 0; sm.stretch.pctX = 0.5; sm.stretch.pctY = 0.5;
    sm.stretch.flowPoint = false; sm.stretch.sinShake = false; sm.setSize(W, H);
    expect(pt(sm, 12, 6), 'ShiftMode 0 dispatches to the embedded STRETCH').toBe('12,6');
    sm.shiftMode = 2; sm.comb.width = 3; sm.comb.speed = 2; sm.comb.vertical = true;
    expect(pt(sm, 2, 5), 'ShiftMode 2 dispatches to the embedded COMB').toBe('2,3');
    sm.shiftMode = 3; sm.spinFactor = 0;
    let worst3 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p: WarpPoint = { x, y }; sm.map(p);
      worst3 = Math.max(worst3, Math.abs(p.x - x), Math.abs(p.y - y));
    }
    expect(worst3, 'ShiftMode 3 with SpinFactor=0 is the identity to within the truncation (worst ' + worst3 + ')').toBeLessThanOrEqual(1);
    expect(pt(sm, 8, 6), 'ShiftMode 3 fixes the centre').toBe('8,6');
    expect(pt(sm, 12, 6), 'ShiftMode 3 with SpinFactor=0 is exact on the x axis').toBe('12,6');
    expect(pt(sm, 8, 2), 'ShiftMode 3 with SpinFactor=0 is exact on the y axis').toBe('8,2');
    sm.spinFactor = 0.2;
    expect(pt(sm, 4, 4), 'ShiftMode 3 rotates the sampling grid about (cx0,cy0)').toBe('5,4');
    sm.shiftMode = 7;
    expect(pt(sm, 4, 4), 'ShiftMode outside 0..3 is the identity').toBe('4,4');
  });
});

// ---------------------------------------------------------------- pool
describe('pool', () => {
  it('makePool() order, per-entry flags, distinct instances, SetSize fan-out', () => {
    const pool: PoolEntry[] = K.makePool();
    expect(pool.length, 'pool has ten entries').toBe(10);
    const order = pool.map(k => k.nameId).join(' ');
    expect(order, 'pool order: 4 SCOPE, 2 LINEAR, 2 STRETCH, 2 COMB').toBe('109 109 109 109 105 105 106 106 114 114');
    for (let i = 0; i < 10; i++) {
      const k = pool[i]!;
      expect(k.poolIndex, 'pool entry ' + i + ' knows its index').toBe(i);
      expect(k.category, 'pool entry ' + i + ' is category 5').toBe(5);
      expect(k.prob, 'pool entry ' + i + ' has probability 1.0').toBe(1.0);
      expect(k.chosen, 'pool entry ' + i + ' starts unchosen').toBe(false);
    }
    const scopes = pool.filter((k): k is ShiftOScopeK => k instanceof K.ShiftOScope);
    expect(scopes.length, "four Shift O' Scope").toBe(4);
    expect(pool.filter(k => k instanceof K.LinearShift && !(k instanceof K.ShiftOScope)).length, 'two Linear Shift').toBe(2);
    expect(pool.filter(k => k instanceof K.StretchShift).length, 'two Stretch Shift').toBe(2);
    expect(pool.filter(k => k instanceof K.CombShear).length, 'two name-114 comb').toBe(2);
    expect(pool.slice(0, 4).every(k => k.chainable === false && k.instantTransition === true), 'SCOPE entries are unchainable, instant').toBe(true);
    expect(pool.slice(4).every(k => k.chainable === true && k.instantTransition === false), 'the other six are chainable, non-instant').toBe(true);
    // distinct objects, distinct embedded sub-objects
    expect(new Set(pool).size, 'ten distinct instances').toBe(10);
    expect(new Set(scopes.map(k => k.stretch)).size, 'each SCOPE has its own embedded STRETCH').toBe(4);
    // SetSize reaches everything
    for (const k of pool) k.setSize(W, H);
    expect(pool.every(k => k.w === W && k.h === H), 'SetSize applies to the whole pool').toBe(true);
    expect(scopes.every(k => k.comb.w === W && k.linear.w === W && k.stretch.w === W),
      'SetSize reaches the embedded instances').toBe(true);
  });
});

// ---------------------------------------------------------------- randomize ranges, 10k draws
describe('randomize ranges, 10k draws', () => {
  it('per-draw range invariants and coverage of the 10000-draw stream', () => {
    A.srand(20260922);
    const c = new K.CombShear(), l = new K.LinearShift(), s = new K.StretchShift(), o = new K.ShiftOScope();
    for (const k of [c, l, s, o] as const) k.setSize(W, H);
    const seen = {
      cw: new Set<number>(), cs: new Set<number>(), cv: new Set<boolean>(),
      lx: new Set<number>(), ly: new Set<number>(), lf: new Set<boolean>(),
      ld: new Set<number>(), lss: new Set<number>(), lsl: new Set<number>(),
      sss: new Set<boolean>(), ssl: new Set<number>(), sfp: new Set<boolean>(),
      rm: new Set<number>(), sm: new Set<number>(),
      bs1: 0, bs4: 0,
      ccr: [999, -1] as [number, number], lcr: [999, -1] as [number, number], bsr: [999, -1] as [number, number],
    };
    const bad = {
      combWidth: [] as string[], combSpeed: [] as string[], combVertical: [] as string[],
      linXShift: [] as string[], linYShift: [] as string[], linFallDir: [] as string[],
      linSinShake: [] as string[], linSinLoops: [] as string[],
      strSinLoops: [] as string[], scopeRefl: [] as string[], scopeShift: [] as string[],
      scopeMode3: [] as string[],
    };
    let bothZero = 0, fpBad = 0, rotBad = 0, mvBad = 0, pctBad = 0, ampBad = 0, spinBad = 0;
    for (let i = 0; i < 10000; i++) {
      c.randomize();
      if (!(c.width >= 1 && c.width <= 40)) bad.combWidth.push(String(i));
      if (!(c.speed >= 1 && c.speed <= 4)) bad.combSpeed.push(String(i));
      if (typeof c.vertical !== 'boolean') bad.combVertical.push(String(i));
      seen.cw.add(c.width); seen.cs.add(c.speed); seen.cv.add(c.vertical);

      l.randomize();
      if (!(l.xShift >= -3 && l.xShift <= 3 && Number.isInteger(l.xShift))) bad.linXShift.push(String(i));
      if (!(l.yShift >= -3 && l.yShift <= 3 && Number.isInteger(l.yShift))) bad.linYShift.push(String(i));
      if (l.xShift === 0 && l.yShift === 0) bothZero++;
      if (!(l.fallPctX >= 0 && l.fallPctX <= 0.1 && l.fallPctY >= 0 && l.fallPctY <= 0.1)) fpBad++;
      if (!(l.fallDir >= 0 && l.fallDir <= 7)) bad.linFallDir.push(String(i));
      if (!(l.sinShake >= 0 && l.sinShake <= 2)) bad.linSinShake.push(String(i));
      if (!(l.sinLoops >= 1 && l.sinLoops <= 15)) bad.linSinLoops.push(String(i));
      seen.lx.add(l.xShift); seen.ly.add(l.yShift); seen.lf.add(l.falloff);
      seen.ld.add(l.fallDir); seen.lss.add(l.sinShake); seen.lsl.add(l.sinLoops);

      s.randomize();
      const lim = s.sinShake ? 0.22 : 0.10;
      if (!(s.rotation >= -lim && s.rotation <= lim)) rotBad++;
      if (!(s.movePct >= 0.05 && s.movePct <= 0.30)) mvBad++;
      if (!(s.pctX >= 0.05 && s.pctX <= 0.95 && s.pctY >= 0.05 && s.pctY <= 0.95)) pctBad++;
      if (s.amp !== Math.trunc(H * s.movePct) || !(s.maxRadius > 0)) ampBad++;
      if (!(s.sinLoops >= 1 && s.sinLoops <= 15)) bad.strSinLoops.push(String(i));
      seen.sss.add(s.sinShake); seen.ssl.add(s.sinLoops); seen.sfp.add(s.flowPoint);

      o.randomize();
      if (!(o.reflectionMode >= 0 && o.reflectionMode <= 4)) bad.scopeRefl.push(String(i));
      if (!(o.shiftMode >= 0 && o.shiftMode <= 3)) bad.scopeShift.push(String(i));
      seen.rm.add(o.reflectionMode); seen.sm.add(o.shiftMode);
      if (o.shiftMode === 3 && !(o.spinFactor >= -0.2 && o.spinFactor <= 0.2)) spinBad++;
      if (o.reflectionMode === 3) {
        seen.ccr[0] = Math.min(seen.ccr[0], o.centerCircleRadius); seen.ccr[1] = Math.max(seen.ccr[1], o.centerCircleRadius);
        seen.lcr[0] = Math.min(seen.lcr[0], o.littleCircleRadius); seen.lcr[1] = Math.max(seen.lcr[1], o.littleCircleRadius);
        if (o.mxMinusR !== o.mx - o.centerCircleRadius) bad.scopeMode3.push(String(i));
      }
      if (o.reflectionMode === 4) {
        seen.bsr[0] = Math.min(seen.bsr[0], o.boxSize); seen.bsr[1] = Math.max(seen.bsr[1], o.boxSize);
        seen.bs4++; if (o.boxSize === 1) seen.bs1++;
      }
    }
    expect(bad.combWidth, 'COMB Width in 1..40').toEqual([]);
    expect(bad.combSpeed, 'COMB Speed in 1..4').toEqual([]);
    expect(bad.combVertical, 'COMB Vertical is a bool').toEqual([]);
    expect(bad.linXShift, 'LINEAR XShift in -3..3').toEqual([]);
    expect(bad.linYShift, 'LINEAR YShift in -3..3').toEqual([]);
    expect(bothZero, 'LINEAR never draws XShift==0 && YShift==0').toBe(0);
    expect(fpBad, 'LINEAR FallPctX/Y stay in [0, 0.1]').toBe(0);
    expect(bad.linFallDir, 'LINEAR FallDir in 0..7').toEqual([]);
    expect(bad.linSinShake, 'LINEAR SinShake in 0..2').toEqual([]);
    expect(bad.linSinLoops, 'LINEAR SinLoops in 1..15').toEqual([]);
    expect(rotBad, 'STRETCH Rotation stays in its per-mode range (±0.22 ripple / ±0.10 spiral)').toBe(0);
    expect(mvBad, 'STRETCH MovePct stays in [0.05, 0.30]').toBe(0);
    expect(pctBad, 'STRETCH PctX/PctY stay in [0.05, 0.95]').toBe(0);
    expect(ampBad, 'STRETCH randomize refreshes the derived geometry').toBe(0);
    expect(bad.strSinLoops, 'STRETCH SinLoops in 1..15').toEqual([]);
    expect(bad.scopeRefl, 'SCOPE ReflectionMode in 0..4').toEqual([]);
    expect(bad.scopeShift, 'SCOPE ShiftMode in 0..3').toEqual([]);
    expect(spinBad, 'SCOPE SpinFactor stays in ±0.2').toBe(0);
    expect(bad.scopeMode3, 'SCOPE mode 3 refreshes mx-R').toEqual([]);
    expect(seen.cw.size, 'COMB Width covers 1..40').toBe(40);
    expect(seen.cs.size, 'COMB Speed covers 1..4').toBe(4);
    expect(seen.cv.size, 'COMB Vertical takes both values').toBe(2);
    expect(seen.lx.size, 'LINEAR XShift covers -3..3').toBe(7);
    expect(seen.ly.size, 'LINEAR YShift covers -3..3').toBe(7);
    expect(seen.lf.size, 'LINEAR Falloff takes both values').toBe(2);
    expect(seen.ld.size, 'LINEAR FallDir covers 0..7').toBe(8);
    expect(seen.lss.size, 'LINEAR SinShake covers 0..2').toBe(3);
    expect(seen.lsl.size, 'LINEAR SinLoops covers 1..15').toBe(15);
    expect(seen.sss.size, 'STRETCH SinShake takes both values').toBe(2);
    expect(seen.ssl.size, 'STRETCH SinLoops covers 1..15').toBe(15);
    expect(seen.sfp.size, 'STRETCH FlowPoint takes both values').toBe(2);
    expect(seen.rm.size, 'SCOPE ReflectionMode covers 0..4').toBe(5);
    expect(seen.sm.size, 'SCOPE ShiftMode covers 0..3').toBe(4);
    expect(seen.ccr[0], 'SCOPE CenterCircleRadius min 5').toBe(5);
    expect(seen.ccr[1], 'SCOPE CenterCircleRadius max 254').toBe(254);
    expect(seen.lcr[0], 'SCOPE LittleCircleRadius min 3').toBe(3);
    expect(seen.lcr[1], 'SCOPE LittleCircleRadius max 52').toBe(52);
    expect(seen.bsr[0] === 1 && seen.bsr[1] <= 300, 'SCOPE BoxSize in 1..300').toBe(true);
    const share = seen.bs1 / seen.bs4;
    expect(share > 0.85 && share < 0.95, 'SCOPE BoxSize is 1 in ~9 of 10 mode-4 draws (' + share.toFixed(3) + ')').toBe(true);
  });

  it('probabilities: Falloff 2/3, COMB Vertical 1/4, STRETCH bools 1/2', () => {
    const c = new K.CombShear(), l = new K.LinearShift(), s = new K.StretchShift();
    for (const k of [c, l, s] as const) k.setSize(W, H);
    A.srand(7); let nv = 0, nf = 0, nss = 0, nfp = 0;
    for (let i = 0; i < 10000; i++) {
      c.randomize(); if (c.vertical) nv++;
      l.randomize(); if (l.falloff) nf++;
      s.randomize(); if (s.sinShake) nss++; if (s.flowPoint) nfp++;
    }
    expect(Math.abs(nv / 10000 - 0.25) < 0.02, 'COMB Vertical p=1/4 (' + nv / 10000 + ')').toBe(true);
    expect(Math.abs(nf / 10000 - 2 / 3) < 0.02, 'LINEAR Falloff p=2/3 (' + nf / 10000 + ')').toBe(true);
    expect(Math.abs(nss / 10000 - 0.5) < 0.02, 'STRETCH SinShake p=1/2 (' + nss / 10000 + ')').toBe(true);
    expect(Math.abs(nfp / 10000 - 0.5) < 0.02, 'STRETCH FlowPoint p=1/2 (' + nfp / 10000 + ')').toBe(true);
  });
});

// ---------------------------------------------------------------- chaining halves the displacement
describe('chaining halves the displacement', () => {
  it('a chained pair averages with the identity (>>1)', () => {
    const a = new K.LinearShift(), b = new K.LinearShift();
    a.setSize(W, H); b.setSize(W, H);
    a.xShift = 4; a.yShift = 0; a.falloff = false; a.sinShake = 0; a._derive();
    b.xShift = 0; b.yShift = 0; b.falloff = false; b.sinShake = 0; b._derive();
    expect(map2(a, b, 4, 4)).toBe('6,4');
  });
});

// ------------------------------------------------- atan2 matches ucrtbase bit for bit
// The maps truncate cos/sin(atan2(dy,dx)) * r to int, and at Pythagorean-triple radii that
// product is exactly an integer, so a 1-ulp atan2 difference moves a table entry one pixel.
// These are integer (y,x) pairs where V8's Math.atan2 disagrees with ucrtbase.dll; the
// expected values are ucrtbase's, captured through a P/Invoke bridge on Windows.
describe('atan2 matches ucrtbase bit for bit', () => {
  it('24 hard integer pairs, plus the one-pixel table-error regression', () => {
    const A2 = A.atan2;
    const buf = new DataView(new ArrayBuffer(8));
    const bits = (v: number): bigint => { buf.setFloat64(0, v); return buf.getBigUint64(0); };
    const CASES: Array<[number, number, bigint]> = [
      [95, 92, 0x3fe9a56497cf0821n], [-176, 391, 0xbfdb11c7ed32a3a8n],
      [-309, 194, 0xbff029a10189ac88n], [210, 460, 0x3fdb68ae0ca9e14fn],
      [66, 503, 0x3fc0b327c6074882n], [-452, 213, 0xbff216347caa3b41n],
      [231, 211, 0x3fea94686689b880n], [456, -83, 0x3ffc0373be02fd41n],
      [140, -109, 0x4001dbd1d43f433dn], [-267, -6, 0xbff97e02de9bd4ccn],
      [342, 122, 0x3ff3a67929c57667n], [190, 391, 0x3fdcf2fea4d94ccdn],
      [-147, -540, 0xc00701a9110b03f9n], [-104, 241, 0xbfda12ba38efb07cn],
      [-324, 436, 0xbfe4735dee27cf7fn], [-358, -156, 0xbfffb535851f5426n],
      [210, 501, 0x3fd9670ed89b9be4n], [-275, -235, 0xc002392fe08d0e59n],
      [27, 465, 0x3fadb218b2083188n], [-49, 145, 0xbfd4db435f953b37n],
      [168, -74, 0x3fffc56f8c877258n], [150, 470, 0x3fd3c58574786933n],
      [460, -409, 0x4002616e42558bf5n], [348, -335, 0x4002b28293064d27n],
    ];
    let bad = 0, v8bad = 0;
    for (const [y, x, want] of CASES) {
      if (bits(A2(y, x)) !== want) bad++;
      if (bits(Math.atan2(y, x)) !== want) v8bad++;
    }
    expect(bad, 'atan2 matches ucrtbase on ' + CASES.length + ' hard pairs (' + bad + ' wrong)').toBe(0);
    expect(v8bad, 'and every one of them is a pair Math.atan2 gets wrong').toBe(CASES.length);
    // The exact-integer case that moved a warp-table entry: SCOPE reflection 2 at dst (257,24)
    // with cx0/cy0 = 320/240 gives r = 225 (63-216-225) and rSrc = 175, so cos(a) * rSrc is
    // mathematically exactly -49 and the (int) cast is a coin flip on atan2's last bit.
    // ucrtbase lands just above -49 -> -48 -> srcX 272; Math.atan2 lands just below -> 271.
    expect(Math.trunc(Math.cos(A2(-216, -63)) * 175),
      'cos(atan2(-216,-63)) * 175 truncates to -48 like ucrtbase').toBe(-48);
    expect(Math.trunc(Math.cos(Math.atan2(-216, -63)) * 175),
      'and to -49 with Math.atan2, which is the one-pixel table error').toBe(-49);
  });
});
