// Battery draw effects A: CDotPlane (0x1804193a0/0x180419720) and CJDar (0x180418020), from
// spec/battery/13-battery-draw-a.md. Oracles: spec/battery/work-draw-a/{f32,calc,jdar}.py.
//
// Fills registry slots 6 (CDotPlane) and 7 (CJDar) of the Alchemy.BatteryDraws namespace opened by
// src/72-battery-draws.js, and reuses its base class and raster primitives (prim.BatteryDraw,
// prim.Stroke, prim.LineClamped). 72 must load first; see NOTES-battery-draws-a.md.
//
// Field naming, as in src/70-battery-warps.js: the contract names the 8 parameter doubles
// dbl0..dbl7, the DLL and the specs name the same slots dbl1..dbl8 (+0x08..+0x40). So:
//   CDotPlane  dbl0 = spec dbl1 = N (grid side)    dbl1 = spec dbl2 = spin mask
//              dbl3 = spec dbl4 = camZ mirror (written on resize, never read)
//   CJDar      dbl0 = spec dbl1 (dead)             dbl1 = spec dbl2 = flip mode
//              dbl2 = spec dbl3 = mirror-if-0      dbl3 = spec dbl4 = nSeg
//              dbl4 = spec dbl5 = angle gain       dbl5 = spec dbl6 = lines-if-0
//              dbl6 = spec dbl7 (dead)             dbl7 = spec dbl8 (unused)
// setParams([dbl1..dbl8]) from the registry therefore loads straight in.
// Wrapped verbatim from src/73-battery-draws-a.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from '../ns';
import '../rand';
import './draws';
import type { TimedLevel } from '../ns';
import type { BatteryDrawCtx } from './draws';
import { sincos87, mulExt, tan87 } from './x87';
import { sinExt32, cosExt32, tanExt32, f32Ext as f32x } from './msvcrt';

// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sin/A.cos never read `this`; hoisted once, not per-call, on purpose
var F = Math.fround, trunc = Math.trunc, sin = A.sin || Math.sin, cos = A.cos || Math.cos, sqrt = Math.sqrt;
// SC[0] = sin, SC[1] = cos of one angle: the same bits as the two calls, one reduction.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sincos never reads `this`; hoisted once on purpose
var sincos = A.sincos, SC = new Float64Array(2);

// DLL literals — never "fix" these to Math.PI / 2*Math.PI.
var TWO_PI_F = 6.2831854820251465;    // 0x18088c468 = (double)(float)2pi
var PI_F     = 3.1415927410125732;    // 0x18088c440 / 0x18088c4c8 = (double)(float)pi
var TAU_F32  = F(6.2831855);          // 0x18088c598 spin numerator
var F300     = F(300.0);              // 0x18088c644 spin period
var F0_015   = F(0.015);              // 0x18088c26c dot height gain
var F1_096   = F(1.096);              // 0x18088c330 spectrum bin step
var F0_6     = F(0.6);                // 0x18088c2d4 camera distance = w*0.6
var F9000    = F(9000.0);             // 0x18088c664 CJDar phase divisor
var F255     = F(255.0);              // 0x18088c640 CJDar band normaliser
var FOV_F    = F(1.0471975803375244); // camera ctor fov = pi/3 as float

// ---- the older builds (this.build 8, 9, 10: x87 at 53 bits; 11: VC8 x87, msvcrt trig) ------------
// FUNCTION-MAP-X86.md §6/§7, re-read from the listings (WMP 9 VAs unless noted). Float products of two
// floats are exact in a double, sums round at 53 bits, a float store is one F(); FSIN/FCOS/FPTAN results are
// 64-bit (x87.ts) until the next op or store rounds them. WMP 11 calls msvcrt's _CIsin/_CIcos/_CItan, which on
// the harness run the same x87 instructions and return the 64-bit st(0) (msvcrt.ts).
var F2PI300  = 0.02094395086169243;   // float(2pi/300): WMP 9 X spin, WMP 8 all three (0x077b7b70)
var F1_300   = 0.0033333334140479565; // float(1/300): WMP 9/10 Y, Z spin (0x077b7b68)
var K32767   = 3.0518509447574615e-05; // float(1/32767), every 8/9/10 Randomize and ctor
var F1_9000  = 0.00011111111234640703; // float(1/9000), CJDar 8/9/10 (0x0779a568)
var F0_3     = F(0.3);
var T4 = new Float64Array(4), T2 = new Float64Array(2);
// Matrix4 multiply orders: for element (i,j), the k of each A[i][k]*B[k][j] in summation order
// ((t0 + t1) + t2) + t3, products exact, sums at 53 bits, one F (xsym of each build's listing).
var ORD9 = [2,1,0,3, 3,1,2,0, 0,3,1,2, 2,0,3,1,  2,3,0,1, 0,1,3,2, 0,3,2,1, 3,2,1,0,     // WMP 9/10 0x0779ab52
            2,3,0,1, 1,0,3,2, 3,2,0,1, 3,2,1,0,  2,3,0,1, 1,0,3,2, 2,3,0,1, 3,2,1,0];
var ORD8 = [2,1,0,3, 3,1,2,0, 0,3,1,2, 2,0,3,1,  2,3,1,0, 1,0,3,2, 3,2,0,1, 3,2,1,0,     // WMP 8 0x591d3d58
            2,3,1,0, 1,0,3,2, 3,2,0,1, 3,2,1,0,  2,3,1,0, 1,0,3,2, 3,2,0,1, 3,2,1,0];
var ORD11: number[] = []; for (var oi = 0; oi < 16; oi++) ORD11.push(0, 1, 2, 3);       // WMP 11 0x131671e8
// WMP 8's Update inlines (A*B)*C*D (0x591d331b..0x591d3d28) with its own orders, and keeps row 0 of A*B and
// element (0,3) of A*B*C in registers, never float-rounded.
var ORD8AB = [2,1,0,3, 3,1,2,0, 2,0,3,1, 1,3,0,2,  2,0,3,1, 3,2,1,0, 1,3,2,0, 3,2,1,0,
              2,0,3,1, 3,2,1,0, 1,3,2,0, 3,2,1,0,  2,0,3,1, 3,2,1,0, 1,3,2,0, 3,2,1,0];
var ORD8ABC = [3,2,0,1, 0,1,3,2, 0,1,3,2, 3,2,0,1,  3,2,0,1, 0,1,3,2, 0,1,3,2, 3,2,0,1,
               3,2,0,1, 0,1,3,2, 0,1,3,2, 3,2,0,1,  3,2,1,0, 3,2,0,1, 1,3,2,0, 0,3,2,1];
var ORD8ABCD = [0,1,3,2, 1,3,2,0, 0,3,2,1, 1,0,3,2,  0,1,3,2, 1,3,2,0, 0,3,2,1, 1,0,3,2,
                0,1,3,2, 1,3,2,0, 0,3,2,1, 1,0,3,2,  0,1,3,2, 1,3,2,0, 0,3,2,1, 1,0,3,2];
/** sum_k a[i][k]*b[k][j] in the order o[e..e+3], at 53 bits, unrounded */
function m4el(a: ArrayLike<number>, b: ArrayLike<number>, i: number, j: number, o: number[]): number {
  var r = i * 4, e = (r + j) * 4, k0 = o[e], k1 = o[e + 1], k2 = o[e + 2], k3 = o[e + 3];
  return ((a[r + k0] * b[k0 * 4 + j] + a[r + k1] * b[k1 * 4 + j]) + a[r + k2] * b[k2 * 4 + j]) + a[r + k3] * b[k3 * 4 + j];
}
function m4mulX(a: ArrayLike<number>, b: ArrayLike<number>, dst: Float32Array | Float64Array, o: number[]): Float32Array | Float64Array {
  for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) dst[i * 4 + j] = F(m4el(a, b, i, j, o));
  return dst;
}
var AB8 = new Float64Array(16), ABC8 = new Float64Array(16);
/** WMP 8 Update's inline A*B*C*D into dst (float) */
function chain8(A: Float32Array, B: Float32Array, C: Float32Array, D: Float32Array, dst: Float32Array): void {
  var i, j;
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) { var v = m4el(A, B, i, j, ORD8AB); AB8[i * 4 + j] = i === 0 ? v : F(v); }
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) { var w = m4el(AB8, C, i, j, ORD8ABC); ABC8[i * 4 + j] = i === 0 && j === 3 ? w : F(w); }
  m4mulX(ABC8, D, dst, ORD8ABCD);
}
/** Normalize3 of build b (WMP 9 0x0779aa65: len = sqrt at 53 bits, guard, inv = 1/len; WMP 8: x/len, no
 * guard; WMP 11: len = F(sqrt(F(sum))), x/len, guard) */
function norm3X(b: number, out: Float32Array, x: number, y: number, z: number): Float32Array {
  var s = (x * x + y * y) + z * z, len;
  if (b === 11) {
    len = F(sqrt(F(s)));
    if (len > 0.0) { out[0] = F(x / len); out[1] = F(y / len); out[2] = F(z / len); } else { out[0] = x; out[1] = y; out[2] = z; }
  } else if (b === 8) {
    len = sqrt(s); out[0] = F(x / len); out[1] = F(y / len); out[2] = F(z / len);
  } else {
    len = sqrt(s);
    if (len > 0.0) { var inv = 1 / len; out[0] = F(inv * x); out[1] = F(inv * y); out[2] = F(inv * z); }
    else { out[0] = x; out[1] = y; out[2] = z; }
  }
  return out;
}
/** F(cos a), F(sin a) of a spin angle as build b takes them: FCOS/FSIN (8/9/10) or msvcrt's (11), each
 * 64-bit result rounded once to float */
function spinCS(b: number, a: number, out: Float64Array): void {
  if (b === 11) { cosExt32(a, T2); out[0] = f32x(T2[0], T2[1]); sinExt32(a, T2); out[1] = f32x(T2[0], T2[1]); return; }
  sincos87(a, T4); out[0] = f32x(T4[2], T4[3]); out[1] = f32x(T4[0], T4[1]);
}
var CS = new Float64Array(2);

// Same reasoning as 72-battery-draws.js: A.BatteryDraws/D.prim are always-present per AlchemyNS,
// so `X || {}` already has type X and needs no cast.
var D = A.BatteryDraws = A.BatteryDraws || {};
var prim = D.prim = D.prim || {};

// Raster primitives come from 72-battery-draws.js: prim.Stroke (0x180413ca0, the eased polar
// arc, spec 13 §3.5 == spec 14 §9.4) and, through it, prim.LineClamped (0x180413c20, the wrapper
// that clamps x0/y0/x1 but not y1). CJDar resolves prim.Stroke per frame, never per pixel.
var BatteryDraw = prim.BatteryDraw;

// ---------------------------------------------------------------------------------------------
// float32 4x4 row-major matrix helpers — the arithmetic of work-draw-a/f32.py (each product and
// each partial sum rounded). dst must not alias a or b.
// ---------------------------------------------------------------------------------------------
function m4mul(a: Float32Array, b: Float32Array, dst: Float32Array): Float32Array {
  for (var i = 0; i < 4; i++) {
    var r = i * 4;
    for (var j = 0; j < 4; j++) {
      dst[r + j] = F(F(F(F(a[r] * b[j]) + F(a[r + 1] * b[4 + j])) + F(a[r + 2] * b[8 + j]))
                   + F(a[r + 3] * b[12 + j]));
    }
  }
  return dst;
}
function m4ident(m: Float32Array): Float32Array {
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}
function m4(): Float32Array { return m4ident(new Float32Array(16)); }
function f32dot3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return F(F(F(ax * bx) + F(ay * by)) + F(az * bz));
}
// Normalize3 = 0x18041c448: length in float, sqrt in double then narrowed, guard len > 0.
function norm3(out: Float32Array, x: number, y: number, z: number): Float32Array {
  var len = F(sqrt(f32dot3(x, y, z, x, y, z)));
  if (len > 0.0) { out[0] = F(x / len); out[1] = F(y / len); out[2] = F(z / len); }
  else { out[0] = x; out[1] = y; out[2] = z; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CDotPlane — 50x50 dot grid on y = 0 scrolling toward a LookAt + off-centre-perspective camera.
// ---------------------------------------------------------------------------------------------
class CDotPlane extends BatteryDraw {
  declare gridCapacity: number;
  declare cachedW: number; declare cachedH: number;
  declare grid: Float32Array;
  declare eye: Float32Array; declare target: Float32Array;
  declare up: Float32Array;
  declare zn: number; declare fov: number;
  declare V: Float32Array; declare P: Float32Array; declare VP: Float32Array; declare viewDir: Float32Array;
  declare ringRow: number;
  declare spinX: number; declare spinY: number; declare spinZ: number;
  declare angleX: number; declare angleY: number; declare angleZ: number;
  declare A: Float32Array; declare B: Float32Array; declare C: Float32Array; declare D: Float32Array; declare M: Float32Array;
  declare t1: Float32Array; declare t2: Float32Array; declare t3: Float32Array;
  declare translateDirty: boolean;
  declare camZ: number;
  declare matrixDirty: boolean;
  declare gravity: number; declare vel0: number;
  declare build: number;
  constructor() {
    super(2);                            // +0xe0 compat mask 2 (body effect), dbl0..7 = 0
    this.build = 12;
    this.gridCapacity = 50;              // +0xe8 — rows AND columns allocated
    this.cachedW = 0; this.cachedH = 0;  // +0xec/+0xf0 resize trigger
    // Dot { x, y, z, w, vel } x 2500, row stride 50 records. The vector ctor zeroes only the
    // first 16 bytes of each record; vel starts 0 here too (see spec §6.4 — unreachable).
    this.grid = new Float32Array(2500 * 5);
    this.eye = new Float32Array([64.0, 57.0, 51.5298]);   // ctor leftovers, overwritten frame 1
    this.target = new Float32Array(3);
    // Camera (+0x10c): only up, zn and fov survive the first frame.
    this.up = new Float32Array([0, 1, 0]);
    this.zn = F(-1.0); this.fov = FOV_F;
    this.V = m4(); this.P = m4(); this.VP = m4(); this.viewDir = new Float32Array(3);
    this.ringRow = 0;                    // +0xc554
    this.spinX = 0; this.spinY = 0; this.spinZ = 0;
    this.angleX = 0; this.angleY = 0; this.angleZ = 0;
    this.A = m4(); this.B = m4(); this.C = m4(); this.D = m4(); this.M = m4();
    this.t1 = m4(); this.t2 = m4(); this.t3 = m4();   // composite scratch, hoisted
    this.translateDirty = false;
    this.camZ = F(1.0);                  // +0xc674
    this.matrixDirty = false;
    this.gravity = F(0.01); this.vel0 = 0.0;
    this.resetTransforms();
  }

  // ResetTransforms = 0x180419628.
  resetTransforms(): void {
    m4ident(this.A); m4ident(this.B); m4ident(this.C); m4ident(this.D);
    this.spinX = this.spinY = this.spinZ = 0;
    this.angleX = this.angleY = this.angleZ = 0;
    this.gravity = F(0.01); this.vel0 = 0.0;
    this.matrixDirty = true;
  }

  // setSize/setParams come from prim.BatteryDraw. The DLL has no SetSize for CDotPlane: Render
  // detects the resize itself against cachedW/H, so setSize only records the size.

  // Randomize = 0x1804192b0. rand() order: N, then one roll per axis.
  randomize() {
    this.resetTransforms();
    this.cachedW = 0; this.cachedH = 0;             // forces a camera rebuild
    this.dbl0 = A.rand() % 28 + 20;                 // 20..47
    var r1 = A.rand(), r2 = A.rand(), r3 = A.rand();
    if (this.build !== 12) { this.dbl1 = (r1 % 4 === 0 ? 4 : 0) | (r2 % 4 === 0 ? 2 : 0) | (r3 % 4 === 0 ? 1 : 0); return this; }  // x86: bits r1->2, r3->0 (rule 4)
    this.dbl1 = ((r1 % 4 === 0 ? 1 : 0) | (r2 % 4 === 0 ? 2 : 0) | (r3 % 4 === 0 ? 4 : 0)) & 0xff;
    return this;
  }

  // OnKey = vtable +0x28 = 0x180419230: the authoring 'D'/'d' zoom nudge, via the ±100 detour.
  onKey(ch: number): void {
    var f: number;
    if (ch === 0x44) f = F(F(F(100.0) - this.camZ) - F(1.0));
    else if (ch === 0x64) f = F(F(F(100.0) - this.camZ) + F(1.0));
    else return;
    this.matrixDirty = true; this.translateDirty = true;
    this.camZ = F(-F(f - F(100.0)));
    this.dbl3 = this.camZ;
  }

  // Camera Build = 0x18041c4e0, five args. Row-vector LookAt + off-centre projection on the
  // short axis; everything float32.
  buildCamera(W: number, H: number): void {
    if (this.build !== 12) { this.buildCameraX(W, H); return; }
    var ex = this.eye[0], ey = this.eye[1], ez = this.eye[2];
    var d = norm3(this.viewDir, F(ex - this.target[0]), F(ey - this.target[1]), F(ez - this.target[2]));
    var dx = d[0], dy = d[1], dz = d[2];
    var ux = this.up[0], uy = this.up[1], uz = this.up[2];
    var t = F(F(F(uy * dy) + F(ux * dx)) + F(uz * dz));      // that summation order
    var u = norm3(new Float32Array(3), F(ux - F(dx * t)), F(uy - F(dy * t)), F(uz - F(dz * t)));
    var r = norm3(new Float32Array(3),
                  F(F(u[2] * dy) - F(u[1] * dz)),            // d x u, not u x d
                  F(F(u[0] * dz) - F(u[2] * dx)),
                  F(F(u[1] * dx) - F(u[0] * dy)));
    var V = this.V;
    V[0] = r[0]; V[1] = u[0]; V[2] = dx; V[3] = 0;
    V[4] = r[1]; V[5] = u[1]; V[6] = dy; V[7] = 0;
    V[8] = r[2]; V[9] = u[2]; V[10] = dz; V[11] = 0;
    V[12] = F(-f32dot3(ex, ey, ez, r[0], r[1], r[2]));
    V[13] = F(-f32dot3(ex, ey, ez, u[0], u[1], u[2]));
    V[14] = F(-f32dot3(ex, ey, ez, dx, dy, dz));
    V[15] = 1;

    var m = W < H ? W : H, zn = this.zn;
    var tanHalf = F(Math.tan(F(this.fov * F(0.5))));
    var zf = F(zn + F(0.01));
    var bottom = F(tanHalf * zn), top = F(-bottom);
    var w0 = F(F(0.0) - F(m));
    var sx = top !== bottom ? F(w0 / F(top - bottom)) : 1;
    var sy = bottom !== top ? F(w0 / F(bottom - top)) : 1;
    var den = F(F(zn * zn) * F(F(1000.0) - zf));
    var sz = den !== 0 ? F(F(F(zn - zf) * F(zn - F(1000.0))) / den) : 1;
    var tx = top !== bottom ? F(F(F(F(m) * top) - F(bottom * 0.0)) / F(top - bottom)) : 1;
    var den2 = F(F(zf - F(1000.0)) * zn);
    var tz = den2 !== 0 ? F(F(F(zn - F(1000.0)) * zf) / den2) : 1;
    var q = zn !== 0 ? F(F(-1.0) / zn) : F(-1.0);

    var P1 = this.t1, Q = this.t2;
    m4ident(P1); P1[0] = sx; P1[5] = sy; P1[10] = sz; P1[12] = tx; P1[13] = tx; P1[14] = tz;
    m4ident(Q); Q[11] = q;
    m4mul(Q, P1, this.P);
    m4mul(V, this.P, this.VP);
  }

  // The x86 camera Build: WMP 9/10 0x0779a6a3, WMP 8 0x591d449d, WMP 11 0x131682cc.
  buildCameraX(W: number, H: number): void {
    var b = this.build, ex = this.eye[0], ey = this.eye[1], ez = this.eye[2];
    var d = norm3X(b, this.viewDir, F(ex - this.target[0]), F(ey - this.target[1]), F(ez - this.target[2]));
    var dx = d[0], dy = d[1], dz = d[2];
    var ux = this.up[0], uy = this.up[1], uz = this.up[2];
    var t = b === 11 ? F((uy * dy + ux * dx) + uz * dz) : (dy * uy + dz * uz) + dx * ux;   // 8/9/10: in a register
    var u = norm3X(b, new Float32Array(3), F(ux - dx * t), F(uy - dy * t), F(uz - dz * t));
    var r = norm3X(b, new Float32Array(3), F(dy * u[2] - dz * u[1]), F(dz * u[0] - u[2] * dx), F(dx * u[1] - dy * u[0]));
    var V = this.V;
    V[0] = r[0]; V[1] = u[0]; V[2] = dx; V[3] = 0;
    V[4] = r[1]; V[5] = u[1]; V[6] = dy; V[7] = 0;
    V[8] = r[2]; V[9] = u[2]; V[10] = dz; V[11] = 0;
    if (b === 8) {
      V[12] = F(-((r[0] * ex + r[2] * ez) + r[1] * ey));
      V[13] = F(-((u[0] * ex + u[2] * ez) + u[1] * ey));
      V[14] = F(-((dx * ex + dy * ey) + dz * ez));
    } else if (b === 11) {                      // dot3 helper 0x13168172 returns a float
      V[12] = -F((ey * r[1] + ex * r[0]) + ez * r[2]);
      V[13] = -F((ey * u[1] + ex * u[0]) + ez * u[2]);
      V[14] = -F((ey * dy + ex * dx) + ez * dz);
    } else {
      V[12] = F(-((r[2] * ez + r[1] * ey) + r[0] * ex));
      V[13] = F(-((u[2] * ez + u[1] * ey) + u[0] * ex));
      V[14] = F(-((dy * ey + dz * ez) + dx * ex));
    }
    V[15] = 1;

    var m = W < H ? W : H, zn = this.zn, fov = this.fov;
    var P1 = this.t1, Q = this.t2, o = b === 8 ? ORD8 : b === 11 ? ORD11 : ORD9;
    m4ident(P1);
    var bb: number, nb: number, zf: number, tx: number;
    if (b === 8) {                              // no viewport boxes, no guards, b and zf kept in registers
      tan87(fov * 0.5, T2); bb = mulExt(zn, T2[0], T2[1]); nb = F(-bb);
      var zf53 = zn + F(0.01), zfF = F(zf53), K = F(zn - 1000), den1 = nb - bb;
      P1[0] = F(-m / F(den1));
      P1[5] = F(-m / (bb - nb));
      P1[10] = F(((zn - zf53) * K) / (((1000 - zf53) * zn) * zn));
      P1[12] = P1[13] = F((nb * m) / den1);
      P1[14] = F((K * zfF) / ((zfF - 1000) * zn));
    } else {
      if (b === 11) { tanExt32(F(fov * 0.5), T2); bb = F(f32x(T2[0], T2[1]) * zn); nb = F(-bb); }
      else { tan87(fov * 0.5, T2); var b53 = mulExt(zn, T2[0], T2[1]); bb = F(b53); nb = F(-b53); }
      zf = F(zn + F(0.01));
      // boxes (0, m, 0)-(m, 0, 0) and (nb, nb, 0)-(bb, bb, 0)
      P1[0] = nb !== bb ? F((0 - m) / (nb - bb)) : 1;
      P1[5] = bb !== nb ? F((0 - m) / (bb - nb)) : 1;
      var den = b === 11 ? (zn * zn) * (1000 - zf) : ((1000 - zf) * zn) * zn;
      P1[10] = den !== 0 ? F(((zn - zf) * (zn - 1000)) / den) : 1;
      tx = nb !== bb ? (m * nb - 0 * bb) / (nb - bb) : 1;                // = m/2 exactly
      P1[12] = P1[13] = F(tx);
      var den2 = (zf - 1000) * zn;
      P1[14] = den2 !== 0 ? F(b === 11 ? (zf * (zn - 1000)) / den2 : ((zn - 1000) * zf) / den2) : 1;
    }
    m4ident(Q); Q[11] = b === 8 || zn !== 0 ? F(-1 / zn) : -1;
    m4mulX(Q, P1, this.P, o);
    m4mulX(V, this.P, this.VP, o);
  }

  // Update = 0x180419720: seed one row, age the rest, spin, translate, recompose.
  update(level: TimedLevel): void {
    var g = this.grid, N, i, col, row, k, base, x86 = this.build !== 12;
    if (level.state !== 1) {                    // 1 == PAUSED: the whole simulation is skipped
      N = trunc(this.dbl0); if (N > this.gridCapacity) N = this.gridCapacity;
      var f0 = level.freq[0], f1 = level.freq[1];
      var half = (N / 2) | 0, z0 = F(-F(F(N) * F(0.5))), vel0 = this.vel0;
      i = 1;                                    // spectrum bin cursor
      for (col = 0; col < N; col++) {
        base = (this.ringRow * 50 + col) * 5;
        g[base] = col - half;                   // (float)(col - N/2), signed int div
        var v = (f0[i] > f1[i] ? f0[i] : f1[i]) >> 2;     // byte max, 0..63
        g[base + 1] = x86 ? F(v * F0_015 * v) : F(F(v * F0_015) * v);   // (v*0.015f)*v, in that order (x86: one F)
        g[base + 2] = z0;
        g[base + 3] = 1.0;
        g[base + 4] = vel0;
        var next = trunc(x86 ? i * F1_096 : F(F(i) * F1_096));        // x86: the product unrounded
        i = next > i ? next : i + 1;            // log-ish spacing, minimum step 1
      }
      this.ringRow++; if (this.ringRow >= N) this.ringRow -= N;

      row = this.ringRow;                       // start at the OLDEST row
      var grav = this.gravity;
      for (k = 0; k < N - 1; k++) {
        if (row >= N) row -= N;
        base = row * 250;                       // row * 50 records * 5 floats
        for (col = 0; col < N; col++, base += 5) {
          g[base + 2] = F(g[base + 2] + 1.0);   // the plane always scrolls
          var y = g[base + 1];
          if (y > 0.0) {
            var vel = g[base + 4];
            y = F(y - vel);
            g[base + 1] = y < 0.0 ? 0.0 : y;    // rest on the plane, no bounce
            g[base + 4] = F(vel + grav);
          }
        }
        row++;
      }
    }

    if (x86) { this.spinX86(); return; }
    var mask = trunc(this.dbl1) >>> 0;
    var dirty = this.matrixDirty, n, a, ca, sa, M;
    if (mask & 1) {
      n = ++this.spinX;
      a = F(F(F(n) * TAU_F32) / F300); this.angleX = a;
      ca = F(cos(a)); sa = F(sin(a)); M = this.A;
      M[0] = 1; M[1] = 0; M[2] = 0; M[3] = 0;
      M[4] = 0; M[5] = ca; M[6] = F(-sa); M[7] = 0;
      M[8] = 0; M[9] = sa; M[10] = ca; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinX = 0; this.angleX = 0; }
      this.matrixDirty = true; dirty = true;
    }
    if (mask & 2) {
      n = ++this.spinY;
      a = F(F(F(n) * TAU_F32) / F300); this.angleY = a;
      ca = F(cos(a)); sa = F(sin(a)); M = this.B;
      M[0] = ca; M[1] = 0; M[2] = F(-sa); M[3] = 0;
      M[4] = 0; M[5] = 1; M[6] = 0; M[7] = 0;
      M[8] = sa; M[9] = 0; M[10] = ca; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinY = 0; this.angleY = 0; }
      this.matrixDirty = true; dirty = true;
    }
    if (mask & 4) {
      n = ++this.spinZ;
      a = F(F(F(n) * TAU_F32) / F300); this.angleZ = a;
      ca = F(cos(a)); sa = F(sin(a)); M = this.C;
      M[0] = ca; M[1] = F(-sa); M[2] = 0; M[3] = 0;
      M[4] = sa; M[5] = ca; M[6] = 0; M[7] = 0;
      M[8] = 0; M[9] = 0; M[10] = 1; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinZ = 0; this.angleZ = 0; }
      this.matrixDirty = true; dirty = true;
    }

    if (this.translateDirty) {
      var z = this.camZ, dir = this.viewDir;
      m4ident(this.D);
      this.D[12] = F(z * dir[0]); this.D[13] = F(z * dir[1]); this.D[14] = F(z * dir[2]);
      this.translateDirty = false; this.matrixDirty = true; dirty = true;
    }

    if (dirty) {
      m4mul(m4mul(m4mul(this.A, this.B, this.t1), this.C, this.t2), this.D, this.t3);
      m4mul(this.t3, this.VP, this.M);          // A*B*C*D*VP, left to right, row-major
      this.matrixDirty = false;
    }
  }

  // Update's spin, translate and recompose on x86 (WMP 9 0x0779b242.., WMP 8 0x591d2ff4.., WMP 11 0x131678e1..).
  // Angle: X n*float(2pi/300) (8/9/10); Y, Z (n*2pi_f)*float(1/300) (9/10) or as X (8): stored to a float with
  // `fst`, so B[0]/C[0] take FCOS of the unrounded angle, every other entry of the float. WMP 11: F((n*2pi_f)/300),
  // all entries of the float angle.
  spinX86(): void {
    var b = this.build, mask = trunc(this.dbl1) >>> 0, n, a, a53, M;
    if (mask & 1) {
      n = ++this.spinX;
      a = F(b === 11 ? (n * TWO_PI_F) / 300 : n * F2PI300); this.angleX = a;
      spinCS(b, a, CS); M = this.A;
      M[0] = 1; M[1] = 0; M[2] = 0; M[3] = 0;
      M[4] = 0; M[5] = CS[0]; M[6] = -CS[1]; M[7] = 0;
      M[8] = 0; M[9] = CS[1]; M[10] = CS[0]; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinX = 0; this.angleX = 0; }
      this.matrixDirty = true;
    }
    if (mask & 2) {
      n = ++this.spinY;
      a53 = b === 11 ? (n * TWO_PI_F) / 300 : b === 8 ? n * F2PI300 : (n * TWO_PI_F) * F1_300;
      a = F(a53); this.angleY = a;
      spinCS(b, a, CS); M = this.B;
      M[0] = b === 11 ? CS[0] : this.cos53(a53); M[1] = 0; M[2] = -CS[1]; M[3] = 0;
      M[4] = 0; M[5] = 1; M[6] = 0; M[7] = 0;
      M[8] = CS[1]; M[9] = 0; M[10] = CS[0]; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinY = 0; this.angleY = 0; }
      this.matrixDirty = true;
    }
    if (mask & 4) {
      n = ++this.spinZ;
      a53 = b === 11 ? (n * TWO_PI_F) / 300 : b === 8 ? n * F2PI300 : (n * TWO_PI_F) * F1_300;
      a = F(a53); this.angleZ = a;
      spinCS(b, a, CS); M = this.C;
      M[0] = b === 11 ? CS[0] : this.cos53(a53); M[1] = -CS[1]; M[2] = 0; M[3] = 0;
      M[4] = CS[1]; M[5] = CS[0]; M[6] = 0; M[7] = 0;
      M[8] = 0; M[9] = 0; M[10] = 1; M[11] = 0;
      M[12] = 0; M[13] = 0; M[14] = 0; M[15] = 1;
      if (n === 300) { this.spinZ = 0; this.angleZ = 0; }
      this.matrixDirty = true;
    }
    if (this.translateDirty) {
      var z = this.camZ, dir = this.viewDir;
      m4ident(this.D);
      this.D[12] = F(dir[0] * z); this.D[13] = F(dir[1] * z); this.D[14] = F(dir[2] * z);
      this.translateDirty = false; this.matrixDirty = true;
    }
    if (this.matrixDirty) {
      if (b === 8) { chain8(this.A, this.B, this.C, this.D, this.t3); m4mulX(this.t3, this.VP, this.M, ORD8); }
      else {
        var o = b === 11 ? ORD11 : ORD9;
        m4mulX(m4mulX(m4mulX(m4mulX(this.A, this.B, this.t1, o), this.C, this.t2, o), this.D, this.t3, o), this.VP, this.M, o);
      }
      this.matrixDirty = false;
    }
  }
  /** F(FCOS(a)) of a double angle */
  cos53(a: number): number { sincos87(a, T4); return f32x(T4[2], T4[3]); }

  // Render = 0x1804193a0.
  draw(ctx: BatteryDrawCtx): void {
    var W = ctx.w, H = ctx.h, buf = ctx.buf;
    if (W !== this.cachedW || H !== this.cachedH) {
      this.cachedW = W; this.cachedH = H;
      this.eye[0] = (W / 2) | 0; this.eye[1] = (H / 2) | 0; this.eye[2] = (H / 2) | 0;
      this.translateDirty = true; this.matrixDirty = true;
      this.camZ = F(F(W) * F0_6);
      this.dbl3 = this.camZ;                    // write-only mirror, never read
      this.buildCamera(W, H);
      // The DLL also recomposes M here; matrixDirty is set, so update() redoes it. Skipped.
    }

    this.update(ctx.level);

    var N = trunc(this.dbl0);
    // Spec §6.3: the DLL has no clamp — dbl1 > 50 walks off grid[]. Clamped, divergence noted.
    if (N > this.gridCapacity) N = this.gridCapacity;
    var g = this.grid, M = this.M;
    var m00 = M[0], m01 = M[1], m03 = M[3], m10 = M[4], m11 = M[5], m13 = M[7],
        m20 = M[8], m21 = M[9], m23 = M[11], m30 = M[12], m31 = M[13], m33 = M[15];
    var xoff = W > H ? (W - H) >> 1 : 0;
    if (this.build !== 12) { this.projectX(buf, W, H, N, xoff); return; }
    for (var row = 0; row < N; row++) {
      var base = row * 250;
      for (var col = 0; col < N; col++, base += 5) {
        var px = g[base], py = g[base + 1], pz = g[base + 2], pw = g[base + 3];
        var ow = F(F(F(F(px * m03) + F(py * m13)) + F(pz * m23)) + F(pw * m33));
        if (ow < 0.0) {
          var ox = F(F(F(F(px * m00) + F(py * m10)) + F(pz * m20)) + F(pw * m30));
          var oy = F(F(F(F(px * m01) + F(py * m11)) + F(pz * m21)) + F(pw * m31));
          var x = trunc(F(ox / ow)) + xoff, y = trunc(F(oy / ow));
          if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = 0xfe;
        }
      }
    }
  }

  // x86 projection: vec4 x M (WMP 9 0x0779b659: ox = ((w*m30 + z*m20) + y*m10) + x*m00, the others
  // ((w*m3j + x*m0j) + z*m2j) + y*m1j; WMP 11 0x1316743a: x, y, z, w order), one F each; then WMP 9/10
  // inv = 1/ow, trunc(ox*inv), trunc(inv*oy) at 53 bits; WMP 8 and 11 divide.
  projectX(buf: Uint8Array, W: number, H: number, N: number, xoff: number): void {
    var g = this.grid, M = this.M, b = this.build;
    var m00 = M[0], m01 = M[1], m03 = M[3], m10 = M[4], m11 = M[5], m13 = M[7],
        m20 = M[8], m21 = M[9], m23 = M[11], m30 = M[12], m31 = M[13], m33 = M[15];
    for (var row = 0; row < N; row++) {
      var base = row * 250;
      for (var col = 0; col < N; col++, base += 5) {
        var px = g[base], py = g[base + 1], pz = g[base + 2], pw = g[base + 3], ow, ox, oy, x, y;
        if (b === 11) {
          ow = F(((px * m03 + py * m13) + pz * m23) + pw * m33);
          if (!(ow < 0.0)) continue;
          ox = F(((px * m00 + py * m10) + pz * m20) + pw * m30);
          oy = F(((px * m01 + py * m11) + pz * m21) + pw * m31);
        } else {
          ow = F(((pw * m33 + px * m03) + pz * m23) + py * m13);
          if (!(ow < 0.0)) continue;
          ox = F(((pw * m30 + pz * m20) + py * m10) + px * m00);
          oy = F(((pw * m31 + px * m01) + pz * m21) + py * m11);
        }
        if (b === 8 || b === 11) { x = trunc(ox / ow) + xoff; y = trunc(oy / ow); }
        else { var inv = 1 / ow; x = trunc(ox * inv) + xoff; y = trunc(inv * oy); }
        if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = 0xfe;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// CJDar — radial zig-zag: nSeg vertices at the frame's phase ± each band's deflection, every
// edge a 100-step eased polar arc about a bouncing anchor in a hard-coded 512x352 box.
// ---------------------------------------------------------------------------------------------
class CJDar extends BatteryDraw {
  declare nSeg: number;
  declare ax: number; declare ay: number; declare fx: number; declare fy: number;
  declare vx: number; declare vy: number;
  declare minX: number; declare minY: number; declare maxX: number; declare maxY: number;
  declare sizeX: number; declare sizeY: number;
  declare colour: number;
  declare toggle: number;
  declare phase: number;
  declare build: number;
  declare rPhase: number; declare rV1: number; declare rV2: number; declare fresh: boolean;
  constructor() {
    super(2);
    this.build = 12;
    this.dbl1 = 1.0;                  // spec dbl2: flip mode (with dbl6, the only non-zero default)
    this.nSeg = 0;                    // +0x130, refreshed every frame
    // Bouncer +0x0f8: bounds and size are hard-coded and never scaled to the render size.
    this.ax = 0; this.ay = 0; this.fx = 0; this.fy = 0; this.vx = 0; this.vy = 0;
    this.minX = 0; this.minY = 0; this.maxX = 512; this.maxY = 352;
    this.sizeX = 40; this.sizeY = 40;
    this.colour = A.rand() % 256;                                   // +0xe8
    var r = A.rand(); this.toggle = 0;
    this.phase = F(F(F(r) / F(32767)) * F(PI_F));                   // +0xf0, [0, pi]
    var ry = A.rand(), rx = A.rand();
    this.ay = ry % 200; this.fy = F(this.ay);
    this.ax = rx % 200; this.fx = F(this.ax);
    var rvy = A.rand(), rvx = A.rand();
    this.vy = F(F(rvy) / F(32767));
    this.vx = F(F(rvx) / F(32767));
    this.dbl6 = 100.0;                // spec dbl7, dead
    this.rPhase = r; this.rV1 = rvy; this.rV2 = rvx; this.fresh = true;   // for setBuild
  }

  // The ctor runs before the engine knows the build: while the object is fresh (never drawn or randomized),
  // re-derive its float fields from the same rand() values the way build b's ctor does (WMP 9 0x076f0854:
  // phase = (r*float(1/32767))*pi_f kept as a double; WMP 11 0x13166f88: (r/32767.0)*pi_f).
  setBuild(b: number): void {
    if (!this.fresh) return;
    var r = this.rPhase;
    this.phase = b === 12 ? F(F(F(r) / F(32767)) * F(PI_F)) : b === 11 ? (r / 32767) * PI_F : (r * K32767) * PI_F;
    this.setVel(this.rV1, this.rV2, b);
  }
  /** Bouncer velocities from the two rand() values in call order: WMP 12, 8, 9, 10 take the first for vy
   * (8/9/10: F(r*float(1/32767))), WMP 11 for vx (F(r/32767.0)). */
  setVel(r1: number, r2: number, b: number): void {
    if (b === 12) { this.vy = F(F(r1) / F(32767)); this.vx = F(F(r2) / F(32767)); }
    else if (b === 11) { this.vx = F(r1 / 32767); this.vy = F(r2 / 32767); }
    else { this.vy = F(r1 * K32767); this.vx = F(r2 * K32767); }
  }

  // setSize/setParams come from prim.BatteryDraw; the anchor box stays a hard-coded 512 x 352.

  // Randomize = 0x180416da0, in exactly this rand() order (12 rolls). phase is NOT touched.
  randomize() {
    this.fresh = false;
    if (this.build !== 12) return this.randomizeX();
    this.dbl0 = A.rand() % 100 + 5;                 // dead, 5..104
    this.dbl1 = A.rand() % 4;                       // flip mode 0..3
    this.dbl2 = A.rand() % 2;                       // mirror if 0
    this.dbl3 = F(Math.pow(2.0, A.rand() % 4 + 2)); // 4, 8, 16, 32 (via (float)pow)
    this.dbl4 = F(F(F(F(A.rand()) / F(32767)) * F(1.5)) + F(0.3));   // 0.3..1.8
    this.dbl5 = A.rand() % 2;                       // lines if 0
    this.dbl6 = A.rand() % 95 + 5;                  // dead, 5..99
    this.colour = A.rand() & 0xff;
    var ry = A.rand(), rx = A.rand();
    this.ay = ry % 200; this.fy = F(this.ay);
    this.ax = rx % 200; this.fx = F(this.ax);
    var rvy = A.rand(), rvx = A.rand();
    this.vy = F(F(rvy) / F(32767));
    this.vx = F(F(rvx) / F(32767));
    return this;
  }
  // x86 Randomize (WMP 9 0x077a2087, WMP 11 0x131669a8): dbl5 = u*1.5f + 0.3f at 53 bits, kept as a double.
  randomizeX() {
    var b = this.build;
    this.dbl0 = A.rand() % 100 + 5;
    this.dbl1 = A.rand() % 4;
    this.dbl2 = A.rand() % 2;
    this.dbl3 = Math.pow(2.0, A.rand() % 4 + 2);
    var r = A.rand();
    this.dbl4 = (b === 11 ? (r / 32767) * 1.5 : (r * K32767) * 1.5) + F0_3;
    this.dbl5 = A.rand() % 2;
    this.dbl6 = A.rand() % 95 + 5;
    this.colour = A.rand() & 0xff;
    var ry = A.rand(), rx = A.rand();
    this.ay = ry % 200; this.fy = F(this.ay);
    this.ax = rx % 200; this.fx = F(this.ax);
    var r1 = A.rand(), r2 = A.rand();
    this.setVel(r1, r2, b);
    return this;
  }

  // Bounce = 0x180418b4c, dt = 6.0f. Float accumulate, integer position by truncation.
  bounce(dt: number): void {
    if (this.build !== 12) { this.bounceX(dt); return; }
    this.fx = F(F(this.vx * dt) + this.fx);
    this.fy = F(F(this.vy * dt) + this.fy);
    var x = trunc(this.fx), y = trunc(this.fy);
    this.ax = x; this.ay = y;
    if ((x + this.sizeX >= this.maxX && this.vx > 0) || (x <= this.minX && this.vx < 0))
      this.vx = F(-this.vx);
    if ((y <= this.minY && this.vy < 0) || (y + this.sizeY >= this.maxY && this.vy > 0))
      this.vy = F(-this.vy);
  }
  // x86 Bouncer::Step (WMP 9 0x077a240c): f = dt*v + f rounded to float once; WMP 8/9/10 truncate x from the
  // unrounded 53-bit sum (y from the stored float), WMP 11 (0x13165f73) both from the floats.
  bounceX(dt: number): void {
    var fx53 = dt * this.vx + this.fx;
    this.fx = F(fx53);
    this.fy = F(dt * this.vy + this.fy);
    var x = trunc(this.build === 11 ? this.fx : fx53), y = trunc(this.fy);
    this.ax = x; this.ay = y;
    if ((x + this.sizeX >= this.maxX && this.vx > 0) || (x <= this.minX && this.vx < 0))
      this.vx = F(-this.vx);
    if ((y <= this.minY && this.vy < 0) || (y + this.sizeY >= this.maxY && this.vy > 0))
      this.vy = F(-this.vy);
  }

  // Render = 0x180418020.
  draw(ctx: BatteryDrawCtx): void {
    if (this.dbl3 === 0.0) return;
    var nSeg = this.nSeg = trunc(this.dbl3);
    var W = ctx.w, H = ctx.h, buf = ctx.buf, b = this.build;
    this.fresh = false;
    var f0 = ctx.level.freq[0], f1 = ctx.level.freq[1];

    this.bounce(F(6.0));

    var sum = f1[0] + f0[1] + f0[0];
    // float, then widened: [0, 0.085]. x86: sum*float(1/9000) at 53 bits (WMP 9 0x0779a43e); 11: sum/9000.0
    var inc = b === 12 ? F(F(sum) / F9000) : b === 11 ? sum / 9000 : sum * F1_9000;
    // (int)(inc * -6.0) is always 0 — the base colour never moves. Reproduced literally.
    this.colour = (this.colour - trunc(inc * -6.0)) % 256 & 0xff;
    this.phase += inc;
    if (this.phase > TWO_PI_F) this.phase -= TWO_PI_F;

    var cx = W >> 1, cy = H >> 1;
    var R = A.rand() % (W >> 1);                          // re-drawn every frame
    var total = 0;
    for (var k = 0; k < 512; k++) total += f1[2 * k + 1] + f0[2 * k];

    var step = (1024 / nSeg) | 0;
    if (total === 0 || step === 0 || nSeg <= 0) return;

    var mode = trunc(this.dbl1), gain = this.dbl4,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- prim.Stroke never reads `this`; resolved once per frame on purpose
        mirror = this.dbl2 === 0.0, useLines = this.dbl5 === 0.0, stroke = prim.Stroke;
    var norm = F(F(step) * F255), invNorm = 1 / (step * 255);   // WMP 9/10 multiply by 1/(step*255f)
    var acc = 0, x0 = cx, y0 = cy, off = 0, s, segSum, ia, negate, ang, rad, x1, y1;
    for (s = 0; s < nSeg; s++) {
      segSum = 0.0;
      if (step > 1) {
        for (k = 0; k <= (step - 2) / 2; k++) {
          ia = 0x400 - off - 2 * k;
          // raw[0x400] is frequency[1][0] where frequency[0][1024] was meant: bug #2, kept.
          segSum += (ia === 1024 ? f1[0] : f0[ia]) + f1[1023 - off - 2 * k];
        }
      }
      acc += trunc(segSum);
      rad = (acc * R) / total;
      var delta = (b === 9 || b === 10 ? segSum * invNorm : segSum / norm) * gain;   // [0,1] * gain
      if (mode === 0) negate = (s & 1) === 0;
      else if (mode === 1) { this.toggle = (this.toggle + 1) % 2; negate = this.toggle === 0; }
      else negate = A.rand() % 2 === 1;
      ang = this.phase + (negate ? -delta : delta);        // reloaded from phase, never accumulated
      if (b === 12) {
        sincos(ang, SC);
        x1 = trunc(SC[1] * rad) + cx;
        y1 = trunc(SC[0] * rad) + cy;
      } else if (b === 11) {                                // msvcrt's 64-bit st(0), one rounding in the fmul
        cosExt32(ang, T2); x1 = trunc(mulExt(rad, T2[0], T2[1])) + cx;
        sinExt32(ang, T2); y1 = trunc(mulExt(rad, T2[0], T2[1])) + cy;
      } else {                                              // FCOS/FSIN 64-bit, one rounding in the fmul
        sincos87(ang, T4);
        x1 = trunc(mulExt(rad, T4[2], T4[3])) + cx;
        y1 = trunc(mulExt(rad, T4[0], T4[1])) + cy;
      }

      stroke(buf, W, H, x0, y0, x1, y1, this.ax, this.ay, 100, this.colour, 0xff, useLines, 3, b);
      if (mirror)
        stroke(buf, W, H, W - x0, H - y0, W - x1, H - y1, W - this.ax, H - this.ay,
               100, this.colour, 0xff, useLines, 3, b);

      x0 = x1; y0 = y1; off += step;
    }
  }
}

D.CDotPlane = CDotPlane;
D.CJDar = CJDar;
