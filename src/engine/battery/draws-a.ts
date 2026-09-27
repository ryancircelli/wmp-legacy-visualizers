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

// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sin/A.cos never read `this`; hoisted once, not per-call, on purpose
var F = Math.fround, trunc = Math.trunc, sin = A.sin || Math.sin, cos = A.cos || Math.cos, sqrt = Math.sqrt;

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
  constructor() {
    super(2);                            // +0xe0 compat mask 2 (body effect), dbl0..7 = 0
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

  // Update = 0x180419720: seed one row, age the rest, spin, translate, recompose.
  update(level: TimedLevel): void {
    var g = this.grid, N, i, col, row, k, base;
    if (level.state !== 1) {                    // 1 == PAUSED: the whole simulation is skipped
      N = trunc(this.dbl0); if (N > this.gridCapacity) N = this.gridCapacity;
      var f0 = level.freq[0], f1 = level.freq[1];
      var half = (N / 2) | 0, z0 = F(-F(F(N) * F(0.5))), vel0 = this.vel0;
      i = 1;                                    // spectrum bin cursor
      for (col = 0; col < N; col++) {
        base = (this.ringRow * 50 + col) * 5;
        g[base] = col - half;                   // (float)(col - N/2), signed int div
        var v = (f0[i] > f1[i] ? f0[i] : f1[i]) >> 2;     // byte max, 0..63
        g[base + 1] = F(F(v * F0_015) * v);     // (v*0.015f)*v, in that order
        g[base + 2] = z0;
        g[base + 3] = 1.0;
        g[base + 4] = vel0;
        var next = trunc(F(F(i) * F1_096));
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
  constructor() {
    super(2);
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
  }

  // setSize/setParams come from prim.BatteryDraw; the anchor box stays a hard-coded 512 x 352.

  // Randomize = 0x180416da0, in exactly this rand() order (12 rolls). phase is NOT touched.
  randomize() {
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

  // Bounce = 0x180418b4c, dt = 6.0f. Float accumulate, integer position by truncation.
  bounce(dt: number): void {
    this.fx = F(F(this.vx * dt) + this.fx);
    this.fy = F(F(this.vy * dt) + this.fy);
    var x = trunc(this.fx), y = trunc(this.fy);
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
    var W = ctx.w, H = ctx.h, buf = ctx.buf;
    var f0 = ctx.level.freq[0], f1 = ctx.level.freq[1];

    this.bounce(F(6.0));

    var inc = F(F(f1[0] + f0[1] + f0[0]) / F9000);        // float, then widened: [0, 0.085]
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
    var norm = F(F(step) * F255);
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
      var delta = (segSum / norm) * gain;                 // [0,1] * gain
      if (mode === 0) negate = (s & 1) === 0;
      else if (mode === 1) { this.toggle = (this.toggle + 1) % 2; negate = this.toggle === 0; }
      else negate = A.rand() % 2 === 1;
      ang = this.phase + (negate ? -delta : delta);        // reloaded from phase, never accumulated
      x1 = trunc(cos(ang) * rad) + cx;
      y1 = trunc(sin(ang) * rad) + cy;

      stroke(buf, W, H, x0, y0, x1, y1, this.ax, this.ay, 100, this.colour, 0xff, useLines, 3);
      if (mirror)
        stroke(buf, W, H, W - x0, H - y0, W - x1, H - y1, W - this.ax, H - this.ay,
               100, this.colour, 0xff, useLines, 3);

      x0 = x1; y0 = y1; off += step;
    }
  }
}

D.CDotPlane = CDotPlane;
D.CJDar = CJDar;
