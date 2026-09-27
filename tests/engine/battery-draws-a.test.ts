// tests/engine/battery-draws-a.test.ts — ported from tests/battery-draws-a.test.js.
// spec/battery/13-battery-draw-a.md numeric claims for Alchemy.BatteryDraws.CDotPlane and .CJDar
// (src/engine/battery/draws-a.ts). Fixtures are the spec's worked numbers, recomputed at full
// precision with the spec's own calculators (spec/battery/work-draw-a/{f32,calc,jdar}.py).
// Same assertions as the old harness (226 checks); see each `describe` for the old vs new count.
 
import { describe, it, expect } from 'vitest';
import { A } from '../../src/engine/ns';
// draws-a.ts imports draws.ts itself, so this one static import gets both onto A.BatteryDraws
// in the DLL's own load order (72 owns the namespace/base class/prim, 73 fills slots 6 and 7).
import '../../src/engine/battery/draws-a';

const F = Math.fround;
const BD = A.BatteryDraws as unknown as Record<string, any> & {
  prim: Record<string, any>; registry: string[]; list(): unknown[];
};
const prim = BD.prim;

interface Level { freq: [Uint8Array, Uint8Array]; wave: [Uint8Array, Uint8Array]; state: number; timeStamp: number }
interface Ctx { buf: Uint8Array; w: number; h: number; level: Level; frame: number; pre: boolean; audio: object }

function mkLevel(state?: number): Level {
  return {
    freq: [new Uint8Array(1024), new Uint8Array(1024)],
    wave: [new Uint8Array(1024), new Uint8Array(1024)],
    state: state === undefined ? 2 : state, timeStamp: 0,
  };
}
function mkCtx(w: number, h: number, level: Level, frame?: number): Ctx {
  return { buf: new Uint8Array(w * h), w, h, level, frame: frame || 0, pre: false, audio: {} };
}
function pixels(buf: Uint8Array, w: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < buf.length; i++) if (buf[i]) out.push([i % w, (i / w) | 0, buf[i] as number]);
  return out;
}

// ---------------------------------------------------------------- object shape / ctor defaults
// old: 32 checks
describe('object shape / ctor defaults', () => {
  it('CDotPlane and CJDar extend the shared draw base and start with the documented defaults', () => {
    A.srand(1);
    const dp = new BD.CDotPlane(), jd = new BD.CJDar();
    expect(dp instanceof prim.BatteryDraw, 'CDotPlane extends the shared draw base').toBe(true);
    expect(jd instanceof prim.BatteryDraw, 'CJDar extends the shared draw base').toBe(true);
    expect(BD.registry[6], 'registry slot 6').toBe('CDotPlane');
    expect(BD.registry[7], 'registry slot 7').toBe('CJDar');
    expect(BD.list().filter((x) => x).length, 'the 10-entry draw registry is complete').toBe(10);
    expect(dp.compatMask, 'CDotPlane compat mask +0xe0').toBe(2);
    expect(jd.compatMask, 'CJDar compat mask +0xe0').toBe(2);
    expect(dp.gridCapacity, 'CDotPlane gridCapacity').toBe(50);
    expect(dp.grid.length, 'CDotPlane grid is 2500 x 5 floats (row stride 50 records)').toBe(2500 * 5);
    for (let i = 0; i < 8; i++) expect(dp['dbl' + i], 'CDotPlane dbl' + i + ' defaults to 0').toBe(0.0);
    expect(dp.camZ, 'CDotPlane ctor camZ = 1.0f').toBe(1.0);
    expect(dp.gravity, 'CDotPlane gravity = 0.01f').toBe(F(0.01));
    expect(dp.vel0, 'CDotPlane vel0 = 0.0f').toBe(0.0);
    expect(dp.eye[2], 'CDotPlane ctor eye.z = 51.5298f (overwritten on frame 1)').toBe(F(51.5298));
    // N = 0 -> a freshly constructed CDotPlane draws nothing.
    const c0 = mkCtx(384, 288, mkLevel());
    dp.draw(c0);
    expect(pixels(c0.buf, 384).length, 'CDotPlane with dbl1 = 0 draws nothing').toBe(0);
    // CJDar: dbl2 = 1.0 and dbl7 = 100.0 are the only non-zero parameter defaults; dbl4 = 0
    // early-outs Render.
    expect(jd.dbl1, 'CJDar spec dbl2 default 1.0 (toggle flip mode)').toBe(1.0);
    expect(jd.dbl6, 'CJDar spec dbl7 default 100.0 (dead)').toBe(100.0);
    expect(jd.dbl3, 'CJDar spec dbl4 default 0 -> effect disabled').toBe(0.0);
    expect(jd.minX, 'CJDar anchor minX').toBe(0);
    expect(jd.maxX, 'CJDar anchor bounds are a hard-coded 512 x 352').toBe(512);
    expect(jd.maxY, 'CJDar anchor maxY').toBe(352);
    expect(jd.sizeX, 'CJDar anchor sizeX').toBe(40);
    expect(jd.phase >= 0 && jd.phase <= Math.PI, 'CJDar ctor phase in [0, pi]').toBe(true);
    expect(jd.colour >= 0 && jd.colour < 256, 'CJDar ctor colour is a byte').toBe(true);
    const c1 = mkCtx(384, 288, mkLevel());
    jd.draw(c1);
    expect(pixels(c1.buf, 384).length, 'CJDar with dbl4 = 0 draws nothing').toBe(0);
  });
});

// ---------------------------------------------------------------- camera at 384x288 (spec §2.3/§2.8)
// old: 51 checks
const VP = [
  [248.43238830566406, -3.8753204345703125, 0.6860012412071228, 0.6859943866729736],
  [74.08739471435547, 287.9592590332031, 0.5145009160041809, 0.5144957900047302],
  [-125.4448471069336, -2.9064865112304688, 0.5145009160041809, 0.5144957900047302],
  [-40159.54296875, -40159.5390625, -278.89849853515625, -278.8857116699219],
];
const MM = [VP[0], VP[1], VP[2],
  [-6981.93359375, -6981.94140625, -48.49615478515625, -48.48565673828125]];
function eqRow(m: Float32Array, i: number, want: number[], msg: string) {
  for (let j = 0; j < 4; j++) expect(m[i * 4 + j], msg + '[' + i + '][' + j + ']').toBe(want[j]);
}
describe('camera at 384x288 (spec §2.3/§2.8)', () => {
  it('paused draw() latches the resize and builds the exact VP/P/D/M matrices', () => {
    const dp = new BD.CDotPlane();
    dp.dbl0 = 37;
    const c = mkCtx(384, 288, mkLevel(1));       // state 1 = paused: no simulation, matrices only
    dp.draw(c);
    expect(dp.cachedW, 'resize latched cachedW').toBe(384);
    expect(dp.eye[0], 'eye.x = W/2').toBe(192);
    expect(dp.eye[1], 'eye.y = H/2').toBe(144);
    expect(dp.eye[2], 'eye.z = H/2').toBe(144);
    expect(dp.camZ, 'camZ = (float)384 * 0.6f').toBe(230.40000915527344);
    expect(dp.dbl3, 'spec dbl4 is overwritten with (double)camZ on the first frame').toBe(230.40000915527344);
    expect(dp.viewDir[0], 'viewDir.x').toBe(0.6859943866729736);
    expect(dp.viewDir[1], 'viewDir.y').toBe(0.5144957900047302);
    expect(dp.viewDir[2], 'viewDir.z').toBe(0.5144957900047302);
    // P pins the projection: P[0][0] = sx = -249.415 (focal length 288/(2 tan30)), P[3][0] = tx = 144.
    expect(dp.P[0], 'P sx = -249.41531372070312').toBe(-249.41531372070312);
    expect(dp.P[5], 'P sy = +249.41531372070312').toBe(249.41531372070312);
    expect(dp.P[12], 'P tx = 144 (principal point)').toBe(144);
    expect(dp.P[13], 'P ty = 144').toBe(144);
    expect(dp.P[15], 'P[3][3] = 1').toBe(1);
    for (let i = 0; i < 4; i++) eqRow(dp.VP, i, VP[i] as number[], 'VP');
    eqRow(dp.D, 3, [158.05311584472656, 118.53983306884766, 118.53983306884766, 1], 'D');
    for (let i = 0; i < 4; i++) eqRow(dp.M, i, MM[i] as number[], 'M = A*B*C*D*VP with A=B=C=I');
    expect(pixels(c.buf, 384).length, 'an all-zero grid plots nothing (o.w == 0 fails o.w < 0)').toBe(0);
  });
});

// ---------------------------------------------------------------- the per-N spectrum bin table (§2.8)
// One walk, i0 = 1, i(k+1) = max(i+1, trunc((float)i * 1.096f)); every N's table is its prefix.
// old: 21 checks
const SEQ = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25, 27,
  29, 31, 33, 36, 39, 42, 46, 50, 54, 59, 64, 70, 76, 83, 90, 98, 107, 117, 128, 140, 153, 167, 183];
const LAST: Record<number, number> = { 20: 20, 24: 27, 30: 42, 31: 46, 33: 54, 37: 76, 38: 83, 45: 153, 46: 167, 47: 183 };
describe('the per-N spectrum bin table (§2.8)', () => {
  it('column k always samples exactly bin SEQ[k]', () => {
    const Y63 = 59.53499984741211;              // 0.015f * 63 * 63
    for (const N of Object.keys(LAST).map(Number)) {
      expect(SEQ[N - 1], 'N=' + N + ' last spectrum bin').toBe(LAST[N]);
      const dp = new BD.CDotPlane();
      dp.dbl0 = N;
      let bad = 0;
      for (let k = 0; k < N; k++) {              // probe: only bin SEQ[k] is loud this frame
        const lv = mkLevel();
        lv.freq[0][SEQ[k] as number] = 252;      // v = 252 >> 2 = 63
        const row = dp.ringRow;
        dp.update(lv);
        for (let col = 0; col < N; col++) {
          const y = dp.grid[(row * 50 + col) * 5 + 1];
          if (col === k ? y !== Y63 : y !== 0) bad++;
        }
      }
      expect(bad, 'N=' + N + ': column k samples exactly bin SEQ[k]').toBe(0);
    }
    expect(SEQ[46] === 183, 'the N=47 maximum stops at bin 183 — no out-of-range spectrum read').toBe(true);
  });
});

// ---------------------------------------------------------------- the five plotted dots (§2.8)
// old: 18 checks
describe('the five plotted dots (§2.8)', () => {
  it('plots exactly the expected pixel for each hand-placed grid dot, or clips it', () => {
    const dp = new BD.CDotPlane();
    dp.dbl0 = 37; dp.dbl1 = 0;
    const lv = mkLevel(1);                       // paused: the hand-written dot survives
    const c = mkCtx(384, 288, lv);
    const cases: [number, number, number, [number, number] | null, string][] = [
      [0, 0, 0, [191, 144], 'grid origin (0,0,0)'],
      [0, 0, -18.5, [128, 119], 'col 18, v = 0'],
      [-18, 0, -18.5, [177, 97], 'col 0, v = 0'],
      [18, F(F(32 * F(0.015)) * 32), -18.5, [23, 68], 'col 36, v = 32'],
      [0, F(F(63 * F(0.015)) * 63), -18.5, null, 'col 18, v = 63 clips off the top (y = -373)'],
    ];
    for (const [x, y, z, want, name] of cases) {
      c.buf.fill(0);
      dp.grid[0] = x; dp.grid[1] = y; dp.grid[2] = z; dp.grid[3] = 1.0; dp.grid[4] = 0;
      dp.draw(c);
      const px = pixels(c.buf, 384);
      if (want === null) expect(px.length, name).toBe(0);
      else {
        expect(px.length, name + ' plots exactly one pixel').toBe(1);
        if (px.length === 1) {
          expect(px[0]?.[0], name + ' x').toBe(want[0]);
          expect(px[0]?.[1], name + ' y').toBe(want[1]);
          expect(px[0]?.[2], name + ' palette index 254').toBe(254);
        }
      }
    }
    expect(dp.grid[1], 'y = 0.015f*63*63 = 59.535').toBe(F(F(63 * F(0.015)) * 63));
  });
});

// ---------------------------------------------------------------- the rotated check (§2.8)
// dbl2 = 1 (X spin), spinCounterX = 75 -> angle 1.57079637, dot (-18, 37.5, -18.5) -> (138, 135).
// (Spec §2.8 prints the model y as 11.25; its own oracle calc.py uses v = 50 -> y = 37.5, and the
// quoted o/pixel match 37.5 exactly, so the 11.25 in the prose is a typo.)
// old: 11 checks
describe('the rotated check (§2.8)', () => {
  it('an X-spin rotation at n = 75 (~pi/2) plots the rotated dot, and the 300-frame counter wraps', () => {
    const dp = new BD.CDotPlane();
    dp.dbl0 = 37; dp.dbl1 = 1; dp.spinX = 74;
    const c = mkCtx(384, 288, mkLevel(1));
    dp.grid[0] = -18; dp.grid[1] = F(F(50 * F(0.015)) * 50); dp.grid[2] = -18.5; dp.grid[3] = 1.0;
    dp.draw(c);
    expect(dp.spinX, 'spin counter advanced').toBe(75);
    expect(dp.angleX, 'angle = (float)n * 6.2831855f / 300.0f').toBe(F(F(F(75) * F(6.2831855)) / F(300)));
    expect(Math.abs(dp.angleX - 1.57079637) <= 1e-7, 'angle at n = 75 is ~pi/2').toBe(true);
    expect(dp.A[5], 'A[1][1] = cos(pi/2) in float').toBe(-4.371138828673793e-08);
    expect(dp.A[6], 'A[1][2] = -sin').toBe(-1);
    expect(dp.A[9], 'A[2][1] = +sin').toBe(1);
    const px = pixels(c.buf, 384);
    expect(px.length, 'rotated dot plots one pixel').toBe(1);
    if (px.length === 1) { expect(px[0]?.[0], 'rotated x').toBe(138); expect(px[0]?.[1], 'rotated y').toBe(135); }
    // 300-frame period, phase-locked, never zero.
    dp.spinX = 299; dp.dbl0 = 0; dp.draw(c);
    expect(dp.spinX, 'the counter resets after using n = 300').toBe(0);
    expect(dp.angleX, 'the cached angle resets with it').toBe(0);
  });
});

// ---------------------------------------------------------------- reseed / gravity over 4 frames (§2.5)
// old: 25 checks
describe('reseed / gravity over 4 frames (§2.5)', () => {
  it('four frames age each row by gravity, and a landed dot rests at y = 0 without bouncing', () => {
    const dp = new BD.CDotPlane();
    dp.dbl0 = 20;
    const lv = mkLevel();
    lv.freq[0].fill(252);                        // v = 63 in every bin
    for (let f = 0; f < 4; f++) dp.update(lv);
    expect(dp.ringRow, 'ringRow advanced once per frame').toBe(4);
    const want: [number, number, number, number][] = [   // row, y, z, vel — aged 3, 2, 1, 0 times
      [0, 59.505001068115234, -7, 0.029999999329447746],
      [1, 59.525001525878906, -8, 0.019999999552965164],
      [2, 59.53499984741211, -9, 0.009999999776482582],
      [3, 59.53499984741211, -10, 0],
    ];
    for (const [row, y, z, vel] of want) {
      const b = row * 250;
      expect(dp.grid[b + 1], 'row ' + row + ' y after gravity').toBe(y);
      expect(dp.grid[b + 2], 'row ' + row + ' z (+1.0 per frame from -N*0.5)').toBe(z);
      expect(dp.grid[b + 4], 'row ' + row + ' vel (+0.01f per aged frame)').toBe(vel);
      expect(dp.grid[b + 3], 'row ' + row + ' w = 1').toBe(1.0);
      expect(dp.grid[b], 'row ' + row + ' x = col - N/2').toBe(0 - 10);
    }
    // y clamps at 0 and never goes negative, and z keeps scrolling after the dot lands.
    const dp2 = new BD.CDotPlane();
    dp2.dbl0 = 50;                               // 50 rows: row 0 is seeded once, then only ages
    const quiet = mkLevel();
    quiet.freq[0][1] = 4;                        // v = 1 -> y = 0.015
    dp2.update(quiet);
    quiet.freq[0][1] = 0;
    for (let f = 0; f < 40; f++) dp2.update(quiet);
    expect(dp2.grid[1], 'a fallen dot rests at y = 0 (no bounce)').toBe(0);
    expect((dp2.grid[2] as number) > 0, 'z keeps advancing after the dot lands').toBe(true);
    // Paused (state 1) skips the whole simulation.
    const before = dp2.grid[2], ring = dp2.ringRow;
    dp2.update(mkLevel(1));
    expect(dp2.grid[2], 'state 1 (paused) freezes the grid').toBe(before);
    expect(dp2.ringRow, 'state 1 does not advance ringRow').toBe(ring);
  });
});

// ---------------------------------------------------------------- CJDar: the worked frame (§3.7)
// freq0 = 100, freq1 = 50 everywhere; nSeg 16, parity flip, gain 0.702707003, phase 1.0, R = 137.
// old: 20 checks
const VERTS = [[192, 144, 197, 150], [197, 150, 197, 160], [197, 160, 209, 162], [209, 162, 203, 176],
  [203, 176, 221, 175], [221, 175, 208, 192], [208, 192, 232, 187], [232, 187, 214, 208],
  [214, 208, 244, 200], [244, 200, 220, 224], [220, 224, 256, 212], [256, 212, 225, 240],
  [225, 240, 267, 225], [267, 225, 231, 257], [231, 257, 279, 237], [279, 237, 237, 273]];
describe('CJDar: the worked frame (§3.7)', () => {
  it('all 16 (or 32 mirrored) vertices match the spec table', () => {
    A.srand(1234);
    const jd = new BD.CJDar();
    jd.dbl3 = 16;                  // spec dbl4 = nSeg
    jd.dbl1 = 0;                   // spec dbl2 = flip on even segment index
    jd.dbl2 = 1;                   // spec dbl3 != 0 -> no mirrored twin
    jd.dbl4 = 0.702707003;         // spec dbl5 = angle gain
    jd.dbl5 = 0;                   // spec dbl6 = 0 -> connected lines
    jd.phase = 1.0; jd.colour = 200;
    jd.fx = 60; jd.fy = 90; jd.vx = 0; jd.vy = 0;       // anchor parked at (60, 90)
    const lv = mkLevel();
    lv.freq[0].fill(100); lv.freq[1].fill(50);
    const c = mkCtx(384, 288, lv);

    const rec: unknown[][] = [], realRand = A.rand, realStroke = prim.Stroke;
    A.rand = function () { return 137; };               // R = 137 % 192
    prim.Stroke = function (...args: unknown[]) { rec.push(args); };
    jd.draw(c);
    prim.Stroke = realStroke; A.rand = realRand;

    expect(jd.nSeg, 'nSeg = (int)dbl4').toBe(16);
    expect(jd.ax, 'bounce with zero velocity leaves the anchor at (60, 90)').toBe(60);
    expect(jd.ay, 'anchor y').toBe(90);
    expect(jd.phase, 'phase += (float)(50+100+100)/9000f').toBe(1.0277777779847383);
    expect(jd.colour, 'the colour advance (int)(inc * -6.0) is always 0').toBe(200);
    expect(rec.length, '16 strokes, no mirror').toBe(16);
    let bad = 0;
    for (let s = 0; s < rec.length && s < 16; s++) {
      const a = rec[s] as number[];
      const v = VERTS[s] as number[];
      if (a[3] !== v[0] || a[4] !== v[1] || a[5] !== v[2] || a[6] !== v[3]) bad++;
    }
    expect(bad, 'all 16 vertices match the spec table (segSum, acc, rad, delta, phase +/- delta)').toBe(0);
    const a0 = rec[0] as unknown[];
    expect(a0[7], 'stroke centre x = anchor.x').toBe(60);
    expect(a0[8], 'stroke centre y = anchor.y').toBe(90);
    expect(a0[9], 'stroke steps is the literal 100 (dbl7 is dead)').toBe(100);
    expect(a0[10], 'stroke col0 = instance colour').toBe(200);
    expect(a0[11], 'stroke col1 = 255').toBe(0xff);
    expect(a0[12], 'dbl6 == 0 -> useLines').toBe(true);
    expect(a0[13], 'stroke mode 3').toBe(3);

    // The mirrored twin (spec dbl3 == 0) doubles the strokes and point-mirrors every coordinate.
    const rec2: unknown[][] = [];
    jd.dbl2 = 0; jd.phase = 1.0;
    A.rand = function () { return 137; };
    prim.Stroke = function (...args: unknown[]) { rec2.push(args); };
    const c2 = mkCtx(384, 288, lv);
    jd.draw(c2);
    prim.Stroke = realStroke; A.rand = realRand;
    expect(rec2.length, 'dbl3 == 0 -> 32 strokes (16 + mirror)').toBe(32);
    const r1 = rec2[1] as number[];
    expect(r1[3], 'mirror x0 = W - x0').toBe(384 - (VERTS[0] as number[])[0]!);
    expect(r1[4], 'mirror y0 = H - y0').toBe(288 - (VERTS[0] as number[])[1]!);
    expect(r1[7], 'mirror centre x = W - anchor.x').toBe(384 - 60);
    expect(r1[8], 'mirror centre y = H - anchor.y').toBe(288 - 90);

    // acc_final == total - freq0[0] + freq1[0]: the off-by-one first band (raw[0x400] = freq1[0]).
    // rad of the last vertex = acc_final*R/total, which the segment-15 vertex above encodes.
    expect((VERTS[15] as number[])[2], 'outermost vertex is at ~R but not exactly (bug #2)').toBe(237);
  });
});

// ---------------------------------------------------------------- CJDar: flip modes and R (§3.4/§3.5)
// old: 4 checks
describe('CJDar: flip modes and R (§3.4/§3.5)', () => {
  it('mode 0 vs mode 1 deflect oppositely, mode >= 2 burns an extra rand(), and R rescales per frame', () => {
    A.srand(99);
    const jd = new BD.CJDar();
    const lv = mkLevel();
    lv.freq[0].fill(100); lv.freq[1].fill(50);
    jd.dbl3 = 4; jd.dbl2 = 1; jd.dbl4 = 1.0; jd.dbl5 = 0;
    const realRand = A.rand, realStroke = prim.Stroke;
    function angles(mode: number, randFn: () => number): unknown[][] {
      const rec: unknown[][] = [];
      jd.dbl1 = mode; jd.phase = 1.0; jd.toggle = 0;
      A.rand = randFn; prim.Stroke = function (...args: unknown[]) { rec.push(args); };
      jd.draw(mkCtx(384, 288, lv));
      prim.Stroke = realStroke; A.rand = realRand;
      return rec;
    }
    // mode 0 flips on even s, mode 1 on a persistent toggle: with toggle starting 0 the first
    // segment's toggle becomes 1 -> not negated, i.e. the opposite sign from mode 0 at s = 0.
    const m0 = angles(0, function () { return 137; });
    const m1 = angles(1, function () { return 137; });
    expect((m0[0] as number[])[6] !== (m1[0] as number[])[6], 'mode 0 and mode 1 deflect segment 0 in opposite directions').toBe(true);
    expect(jd.toggle, 'mode 1 toggles once per segment (4 segments -> back to 0)').toBe(0);
    // mode >= 2 burns one rand() per segment.
    let calls = 0;
    angles(3, function () { calls++; return 137; });
    expect(calls, 'mode 3 draws R once then one rand() per segment').toBe(1 + 4);
    // R is re-drawn every frame: two frames with different rand() give different radii.
    const big = angles(0, function () { return 191; });
    const small = angles(0, function () { return 1; });
    expect((big[0] as number[])[5] !== (small[0] as number[])[5], 'R = rand() % (w/2) rescales the whole figure every frame').toBe(true);
  });
});

// ---------------------------------------------------------------- Stroke / LineClamped (§3.5)
// old: 7 checks
describe('Stroke / LineClamped (§3.5)', () => {
  it('the pixel/colour trail matches, single steps and steps==0 behave, and LineClamped clamps x0/y0/x1 not y1', () => {
    // The frame's first stroke in dots mode: 100 steps collapse onto 11 pixels, the colour ramping
    // to 254 at the outer end (255 is only reached by the step past the last).
    const TRAIL = [[192, 144, 206], [193, 144, 207], [193, 145, 212], [194, 145, 214], [194, 146, 219],
      [195, 146, 222], [195, 147, 228], [196, 147, 231], [196, 148, 241], [196, 149, 244],
      [197, 149, 254]];
    const c = mkCtx(384, 288, mkLevel());
    prim.Stroke(c.buf, 384, 288, 192, 144, 197, 150, 60, 90, 100, 200, 255, false, 3);
    const got = pixels(c.buf, 384);
    expect(JSON.stringify(got), '100-step dots stroke pixel/colour trail').toBe(JSON.stringify(TRAIL));
    // Step 0 in isolation: t = 0, a = a0, r = r0 -> (192,144) with the base colour.
    const c1 = mkCtx(384, 288, mkLevel());
    prim.Stroke(c1.buf, 384, 288, 192, 144, 197, 150, 60, 90, 1, 200, 255, false, 3);
    expect(JSON.stringify(pixels(c1.buf, 384)), 'stroke step 0').toBe(JSON.stringify([[192, 144, 200]]));
    // steps == 0 draws nothing.
    const c2 = mkCtx(8, 8, mkLevel());
    prim.Stroke(c2.buf, 8, 8, 0, 0, 7, 7, 0, 0, 0, 1, 255, false, 3);
    expect(pixels(c2.buf, 8).length, 'steps == 0 returns immediately').toBe(0);
    // dx == 0 forces the angle to 0 rather than +-pi/2: both endpoints on the centre's x column
    // sweep from angle 0, so the arc leaves the column entirely.
    const c3 = mkCtx(64, 64, mkLevel());
    prim.Stroke(c3.buf, 64, 64, 32, 10, 32, 50, 32, 32, 8, 1, 8, false, 3);
    const p3 = pixels(c3.buf, 64);
    expect(p3.length > 0 && p3.every((p) => p[1] === 32), 'atan2 forced to 0 when dx == 0 -> arc on y = cy').toBe(true);

    // LineClamped clamps x0, y0, x1 but NOT y1 — the walk escapes vertically and those writes are
    // dropped (they landed past the malloc in the original).
    const c4 = mkCtx(8, 8, mkLevel());
    prim.LineClamped(c4.buf, 8, 8, 4, 4, 4, 20, 9);
    expect(JSON.stringify(pixels(c4.buf, 8)), 'y1 escapes downward, unclamped')
      .toBe(JSON.stringify([[4, 4, 9], [4, 5, 9], [4, 6, 9], [4, 7, 9]]));
    const c5 = mkCtx(8, 8, mkLevel());
    prim.LineClamped(c5.buf, 8, 8, 4, 4, 4, -20, 9);
    expect(pixels(c5.buf, 8).length, 'y1 escapes upward (rows 4..0 written, the rest dropped)').toBe(5);
    const c6 = mkCtx(8, 8, mkLevel());
    prim.LineClamped(c6.buf, 8, 8, -5, -5, 99, 3, 7);   // x0,y0,x1 clamped to 0,0,7
    const p6 = pixels(c6.buf, 8);
    expect(p6.length > 0 && p6[0]?.[0] === 0 && p6[0]?.[1] === 0, 'x0/y0 are clamped, not clipped').toBe(true);
  });
});

// ---------------------------------------------------------------- randomize() order and ranges (§2.6/§3.6)
// old: 27 checks
describe('randomize() order and ranges (§2.6/§3.6)', () => {
  it('CDotPlane and CJDar randomize() draw rand() in the documented order and ranges', () => {
    function LCG(s: number) {
      let seed = s | 0;
      return function () { seed = (Math.imul(seed, 214013) + 2531011) | 0; return (seed >>> 16) & 0x7fff; };
    }

    A.srand(7);
    const r = LCG(7);
    const dp = new BD.CDotPlane();               // the ctor consumes no rand()
    dp.randomize();
    const wantN = r() % 28 + 20, r1 = r(), r2 = r(), r3 = r();
    expect(dp.dbl0, 'CDotPlane dbl1 = rand() % 28 + 20').toBe(wantN);
    expect(dp.dbl1, 'CDotPlane dbl2 = three independent 1-in-4 spin bits, in rand() order')
      .toBe((r1 % 4 === 0 ? 1 : 0) | (r2 % 4 === 0 ? 2 : 0) | (r3 % 4 === 0 ? 4 : 0));
    expect(dp.dbl2, 'CDotPlane dbl3 untouched by randomize').toBe(0.0);
    expect(dp.cachedW, 'randomize forces a camera rebuild').toBe(0);
    expect(dp.matrixDirty, 'randomize resets the transforms dirty').toBe(true);

    let minN = 99, maxN = 0;
    const masks = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      dp.randomize();
      minN = Math.min(minN, dp.dbl0); maxN = Math.max(maxN, dp.dbl0);
      masks.add(dp.dbl1);
      if (dp.dbl1 < 0 || dp.dbl1 > 7) { expect(false, 'spin mask out of range').toBe(true); break; }
    }
    expect(minN, 'N minimum 20').toBe(20);
    expect(maxN, 'N maximum 47').toBe(47);
    expect(masks.size, 'all 8 spin masks occur').toBe(8);

    A.srand(31);
    const r2b = LCG(31);
    const jd = new BD.CJDar();                   // 6 rand() in the ctor
    for (let i = 0; i < 6; i++) r2b();
    jd.randomize();
    expect(jd.dbl0, 'CJDar dbl1 = rand() % 100 + 5 (dead)').toBe(r2b() % 100 + 5);
    expect(jd.dbl1, 'CJDar dbl2 = rand() % 4').toBe(r2b() % 4);
    expect(jd.dbl2, 'CJDar dbl3 = rand() % 2').toBe(r2b() % 2);
    expect(jd.dbl3, 'CJDar dbl4 = (float)pow(2, rand()%4 + 2)').toBe(F(Math.pow(2, r2b() % 4 + 2)));
    expect(jd.dbl4, 'CJDar dbl5 = rand()/32767*1.5 + 0.3').toBe(F(F(F(F(r2b()) / F(32767)) * F(1.5)) + F(0.3)));
    expect(jd.dbl5, 'CJDar dbl6 = rand() % 2').toBe(r2b() % 2);
    expect(jd.dbl6, 'CJDar dbl7 = rand() % 95 + 5 (dead)').toBe(r2b() % 95 + 5);
    expect(jd.colour, 'CJDar colour = (BYTE)rand()').toBe(r2b() & 0xff);
    expect(jd.ay, 'CJDar anchor y then x, in that rand() order').toBe(r2b() % 200);
    expect(jd.ax, 'CJDar anchor x').toBe(r2b() % 200);
    expect(jd.vy, 'CJDar anchor vy then vx, in that rand() order').toBe(F(F(r2b()) / F(32767)));
    expect(jd.vx, 'CJDar anchor vx').toBe(F(F(r2b()) / F(32767)));

    const phase = jd.phase;
    const segs = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      jd.randomize();
      segs.add(jd.dbl3);
      if (jd.dbl4 < 0.3 || jd.dbl4 > 1.8) { expect(false, 'dbl5 gain out of range').toBe(true); break; }
      if (jd.dbl0 < 5 || jd.dbl0 > 104) { expect(false, 'dbl1 out of range').toBe(true); break; }
      if (jd.dbl6 < 5 || jd.dbl6 > 99) { expect(false, 'dbl7 out of range').toBe(true); break; }
      if (jd.vx < 0 || jd.vx >= 1 || jd.vy < 0 || jd.vy >= 1) { expect(false, 'velocity out of range').toBe(true); break; }
      if (jd.ax < 0 || jd.ax > 199 || jd.ay < 0 || jd.ay > 199) { expect(false, 'anchor out of range').toBe(true); break; }
    }
    expect(JSON.stringify(Array.from(segs).sort((a, b) => a - b)), 'dbl4 is 4, 8, 16 or 32').toBe('[4,8,16,32]');
    expect(jd.phase, 'randomize does not touch phase').toBe(phase);

    // setParams loads the registry's dbl1..dbl8 straight in (brightsphere / dandelionaid).
    const dp3 = new BD.CDotPlane();
    dp3.setParams([37, 0, 0, 384.000015, 0, 0, 0, 0]);
    expect(dp3.dbl0, 'setParams N').toBe(37);
    expect(dp3.dbl3, 'setParams dbl4').toBe(384.000015);
    const jd3 = new BD.CJDar();
    jd3.setParams([82, 3, 1, 16, 0.702707003, 0, 100, 0]);
    expect(jd3.dbl3, 'setParams nSeg').toBe(16);
    expect(jd3.dbl4, 'setParams gain').toBe(0.702707003);
    jd3.setSize(384, 288);
    expect(jd3.maxX, 'setSize does not scale the hard-coded anchor box').toBe(512);
  });
});

// ---------------------------------------------------------------- 100 frames, no out-of-bounds writes
// old: 10 checks
describe('100 frames, no out-of-bounds writes', () => {
  it('a canary-padded buffer stays intact over 100 frames at three sizes', () => {
    // The framebuffer is a view in the middle of a larger buffer whose surrounding bytes are 0xAA.
    // Every escaping store (LineClamped's unclamped y1, a dot at |o.w| -> 0) must be dropped by the
    // view, exactly as spec 14 §1.3 prescribes — the canary proves nothing lands outside.
    const PAD = 4096;
    function guarded(n: number) {
      const ab = new ArrayBuffer(PAD + n + PAD);
      new Uint8Array(ab).fill(0xaa);
      const raw = new Uint8Array(ab, PAD, n);
      raw.fill(0);
      const pre = new Uint8Array(ab, 0, PAD), post = new Uint8Array(ab, PAD + n, PAD);
      const clean = (a: Uint8Array) => a.every((v) => v === 0xaa);
      return { buf: raw, raw, intact: () => clean(pre) && clean(post) };
    }
    A.srand(4242);
    const dp = new BD.CDotPlane();
    dp.dbl0 = 60;                                 // > gridCapacity: clamped to 50 (spec §6.3)
    dp.dbl1 = 7;                                  // all three spins
    const jdLines = new BD.CJDar();
    jdLines.dbl3 = 32; jdLines.dbl2 = 0; jdLines.dbl4 = 1.8; jdLines.dbl5 = 0; jdLines.dbl1 = 3;
    const jdDots = new BD.CJDar();
    jdDots.dbl3 = 9; jdDots.dbl2 = 0; jdDots.dbl4 = 1.8; jdDots.dbl5 = 1; jdDots.dbl1 = 1;
    for (const [W, H] of [[384, 288], [64, 48], [288, 384]] as [number, number][]) {
      const g = guarded(W * H);
      const lv = mkLevel();
      let drew = 0;
      for (let f = 0; f < 100; f++) {
        for (let i = 0; i < 1024; i++) {
          lv.freq[0][i] = A.rand() & 0xff;
          lv.freq[1][i] = A.rand() & 0xff;
        }
        lv.state = (f % 37 === 0) ? 1 : 2;
        const c = { buf: g.buf, w: W, h: H, level: lv, frame: f, pre: (f & 1) === 0, audio: {} };
        dp.draw(c); jdLines.draw(c); jdDots.draw(c);
        if (f === 99) for (let i = 0; i < g.raw.length; i++) if (g.raw[i]) drew++;
      }
      expect(g.intact(), W + 'x' + H + ': no writes outside the framebuffer over 100 frames').toBe(true);
      expect(drew > 0, W + 'x' + H + ': the frame is not empty').toBe(true);
      expect(g.raw.length === W * H, W + 'x' + H + ': buffer length unchanged').toBe(true);
    }
    expect(dp.grid.length, 'N > 50 stayed inside grid[] (clamped; the DLL does not clamp)').toBe(2500 * 5);
  });
});
