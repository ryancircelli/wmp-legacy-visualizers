// Alchemy.Particle — Windows Media Player 7-10's "Particle" visualization (internal name "Dotplane"; WMP 9
// wmp.dll, CLSID {61180810-EF20-11D2-9431-00A0C92A2F2D}, creator 0x07979528, object 0xccc0 bytes).
// Spec: re/wmp9/particle/ in the private repo. VAs below are WMP 9's (image base 0x07680000).
//
// A 50x50 grid of dots: every frame a new row of 50 is lifted out of the spectrum at z = -25, and every
// older row scrolls one unit toward the viewer and falls back under gravity. A fixed LookAt camera, an
// optional spin about X/Y/Z, and one dot per grid point, coloured by its height from a 41-entry gradient.
//
// The DLL is 32-bit x87 code at the process's default control word (0x027F: 53-bit precision, round to
// nearest), so every x87 add/sub/mul/div here is a JS double operation and every float store is
// Math.fround. FSIN/FCOS/FPTAN are only ever stored straight to float32: Math.sin/cos/tan rounded to float32
// give the same bits as the x87 instruction on every angle the class can produce (checked against this
// machine's FSIN/FCOS/FPTAN, all 2101 inputs). _ftol is msvcrt's: truncate to int64, keep the low dword.
//
// The class draws into its own DIB the size of the window (32 bpp when the screen is > 8 bpp), clears it to
// the background every frame, plots the dots with a plain pixel store, then copies only a "dirty" rectangle
// to the window DC and FillRects the rest with the background. That rectangle is computed with two bugs the
// output keeps (see render): dots outside it are not shown.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';

declare module '../ns' {
  interface AlchemyNS {
    Particle: typeof Particle;
  }
}

var F = Math.fround;

// .rdata float32 literals
var K_BIN = F(1.096);                 // 0x077b7b78 spectrum bin step
var K_HEIGHT = F(0.015);              // 0x077b7b74 dot height gain
var K_XSTEP = F(0.02094395);          // 0x077b7b70 X spin step (2pi/300)
var K_TAU = F(6.2831855);             // 0x077b7b6c } Y/Z spin step: n * 2pi * (1/300)
var K_300TH = F(0.0033333334);        // 0x077b7b68 }
var K_GRAVITY = F(0.01);              // 0x077b56f8 (also the camera's near-plane offset)
var K_FOV = F(1.0471975803375244);    // camera ctor 0x076f0360: fov 0x3f860a92
var EYE = [F(64), F(57), F(51.526)];  // ctor 0x07978fc7: obj+0x48 = 0x42800000 0x42640000 0x424e1aa0
var ROWS = 50;                        // obj+0xcc94; the row loop and the per-row loop both use it

// Presets 2 and 3 are WMP 7.0-8's (wmpui.dll): they project with another summation order and divide by w
// instead of multiplying by 1/w (a dot one pixel off, now and then), and a Y or Z spin (only the timer turns
// them on) steps by 0.02094395 rather than 2pi * (1/300) and is composed with other arithmetic (ORD7 below).
// They also never initialize the dot array, so their first frames show whatever the heap held: not portable;
// zeroed, as here, they match.
var PRESET_NAMES: string[] = ['Particle', 'Rotating Particle', 'Particle (WMP 7-8)', 'Rotating Particle (WMP 7-8)'];

// 4x4 row-major matrices, out = a * b. Every element is four products summed left to right in the order the
// compiler scheduled them: ord[e*4..e*4+3] lists k for element e = r*4+c, out[e] = ((p_k0 + p_k1) + p_k2) + p_k3
// with p_k = a[r*4+k] * b[k*4+c], each op a double (x87, 53-bit). An element is then stored as float, unless
// its bit is set in `keep`: WMP 7-8's inlined products leave some partial results in x87 registers.
function tab(digits: string): Uint8Array { return Uint8Array.from(digits, Number); }
var ORD = tab('2103312003122031230101320321321023011032320132102301103223013210');     // 0x0779ab52
// WMP 7.0-8 (wmpui.dll; VAs of 7.1, 7.00.1956/8 have the same code): the generic multiply 0x5256eca0, and the
// inlined Rx*Ry*Rz*Tr of Update (0x5256e33f) and of Render's DIB path (0x5256f09e). Derived mechanically from
// the instruction stream (tools in re/wmp9/particle/SPEC.md).
var ORD7 = tab('2103312003122031231010323201321023101032320132102310103232013210');
var U7_XY = tab('3210201331202310132003211320103213200321132010321320032113201032');  // row 0 kept
var U7_Z = tab('1032320113200132103232011320013210323201132001323210032110323201');   // element 3 kept
var U7_T = tab('1032103232011320103210323201132010321032320113201032103232011320');
var R7_XY = tab('0321213031022310103203211320103210320321132010321032032113201032');  // row 0 kept
var R7_Z = tab('3210013201323201321001320132320132100132032103211032132003211032');
type Mat = Float32Array | Float64Array;
function mul(a: Mat, b: Mat, out: Mat, ord?: Uint8Array, keep?: number): Mat {
  ord = ord || ORD; keep = keep || 0;
  for (var e = 0; e < 16; e++) {
    var r = e & 12, c = e & 3, o = e * 4, k0 = ord[o], k1 = ord[o + 1], k2 = ord[o + 2], k3 = ord[o + 3];
    var v = ((a[r + k0] * b[k0 * 4 + c] + a[r + k1] * b[k1 * 4 + c]) + a[r + k2] * b[k2 * 4 + c]) + a[r + k3] * b[k3 * 4 + c];
    out[e] = (keep >> e) & 1 ? v : F(v);
  }
  return out;
}
function ident(m: Float32Array): Float32Array {
  m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
// FUN_0779aa65: in-place normalize, the length and its reciprocal kept in x87 registers (doubles here)
function norm(v: Float32Array): void {
  var s = Math.sqrt((v[0] * v[0] + v[1] * v[1]) + v[2] * v[2]);
  if (!(s > 0)) return;
  var q = 1 / s;
  v[0] = F(q * v[0]); v[1] = F(q * v[1]); v[2] = F(q * v[2]);
}
// msvcrt _ftol: FISTP qword with truncation, EAX = the low dword (2^63 or more, or NaN: 0x8000000000000000).
// ToInt32 (`| 0`) is exactly trunc-then-low-dword for every finite double; only the indefinite case differs.
function ftol(d: number): number {
  return d < 9223372036854775808 && d > -9223372036854775808 ? d | 0 : 0;
}
// COLORREF 0x00BBGGRR -> the Surface's 0x00RRGGBB (the DIB stores B, G, R at bytes 0..2: 0x07977ce5)
function rgb(c: number): number {
  return ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);
}

export interface ParticleConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

class Particle {
  static PRESET_NAMES = PRESET_NAMES;

  // the dots: { x, y, z, w, v } x 50 rows x 50, obj+0x674. The vector ctor (0x07688130) zeroes x/y/z/w
  // only; v is left as the heap had it, and is never read before its row is first written.
  declare grid: Float32Array;
  declare row: number;               // obj+0xc9c4, the row written next
  declare channels: number;          // obj+0x44, MediaInfo's channel count (0 until it is called)
  // the IDotplane properties
  declare zoom: number;              // obj+0xcb10 (get returns 100 - zoom)
  declare gravity: number;           // obj+0xcb14
  declare vel0: number;              // obj+0xcb18, a new dot's fall speed
  declare bg: number;                // obj+0xcb1c, COLORREF
  declare keys: number[];            // obj+0xcb24.. the five gradient keys, COLORREF
  declare spinX: boolean; declare spinY: boolean; declare spinZ: boolean;   // obj+0xc9c8..0xc9ca
  declare nX: number; declare nY: number; declare nZ: number;               // obj+0x28..0x30
  declare translateDirty: boolean;   // obj+0xc9cb
  declare dirty: boolean;            // obj+0xc9cc
  declare Rx: Float32Array; declare Ry: Float32Array; declare Rz: Float32Array; declare Tr: Float32Array;
  declare M: Float32Array;           // obj+0xcad0 = Rx * Ry * Rz * Tr * VP
  declare t1: Float64Array; declare t2: Float64Array; declare t3: Float64Array;   // compose scratch
  declare VP: Float32Array;          // camera + 0xac
  declare fwd: Float32Array;         // camera + 0xec
  declare pal: Uint32Array;          // obj+0xcb4c, 41 COLORREFs
  declare preset: number;            // PRESET_NAMES index; the DLL's obj+0xccac is preset & 1
  declare legacy: boolean;           // WMP 7-8 arithmetic (presets 2, 3)
  // the DIB: (re)built by Render when missing or of another size
  declare dibW: number; declare dibH: number;
  declare w: number; declare h: number;
  declare surface: Surface;
  declare hits: Int32Array;          // pixels plotted this frame
  // the 250 ms timer SetCurrentPreset(1) starts (SetTimer, see onTimer), driven here by TimedLevel time
  declare timerNext: number;         // 100-ns ticks; NaN = armed, starts at the next frame; -1 = off
  /** srand's seed when SetCurrentPreset(1) runs: time(NULL). Replace it to pin. */
  declare clock: () => number;
  declare frame: number;

  constructor(cfg?: ParticleConfig) {
    cfg = cfg || {};
    this.grid = new Float32Array(ROWS * ROWS * 5);
    this.row = 0;
    this.channels = 2;               // WMP calls MediaInfo with the stream's channel count; stereo
    this.zoom = 0; this.gravity = K_GRAVITY; this.vel0 = 0;
    this.bg = 0;
    this.keys = [0xff, 0xff00ff, 0xff7070, 0xff7000, 0xffff00];
    this.spinX = this.spinY = this.spinZ = false;
    this.nX = this.nY = this.nZ = 0;
    this.translateDirty = false; this.dirty = false;
    this.Rx = ident(new Float32Array(16)); this.Ry = ident(new Float32Array(16));
    this.Rz = ident(new Float32Array(16)); this.Tr = ident(new Float32Array(16));
    this.M = new Float32Array(16);
    this.t1 = new Float64Array(16); this.t2 = new Float64Array(16); this.t3 = new Float64Array(16); this.VP = new Float32Array(16); this.fwd = new Float32Array(3);
    this.pal = new Uint32Array(41);
    this.preset = 0; this.legacy = false;
    this.dibW = 0; this.dibH = 0;
    this.hits = new Int32Array(ROWS * ROWS);
    this.timerNext = -1;
    this.clock = function () { return (Date.now() / 1000) | 0; };
    this.frame = 0;
    this.buildGradient();
    this.resize(cfg.width || 640, cfg.height || 480);
    this.setPreset((cfg.preset as number) | 0);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.surface = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h).fill(rgb(this.bg)) };
  }

  // ---- 0x07977ba9: pal[a..b] from c1 toward c2 in (b - a + 2) truncated steps, per byte, wrapping
  ramp(a: number, b: number, c1: number, c2: number): void {
    var n = b - a + 2;
    var dR = (((c2 & 0xff) - (c1 & 0xff)) / n) | 0;
    var dG = ((((c2 >>> 8) & 0xff) - ((c1 >>> 8) & 0xff)) / n) | 0;
    var dB = ((((c2 >>> 16) & 0xff) - ((c1 >>> 16) & 0xff)) / n) | 0;
    var c = c1 >>> 0;
    this.pal[a] = c;
    for (var k = a + 1; k <= b; k++) {
      c = ((((c >>> 16) + dB) & 0xff) << 16) | ((((c >>> 8) + dG) & 0xff) << 8) | (((c & 0xff) + dR) & 0xff);
      this.pal[k] = c;
    }
  }
  // ---- 0x07978620: the five keys over 0-7, 8-17, 18-29, 30-37, then 38-40 = the last key
  buildGradient(): void {
    var k = this.keys;
    this.ramp(0, 7, k[0], k[1]); this.ramp(8, 0x11, k[1], k[2]);
    this.ramp(0x12, 0x1d, k[2], k[3]); this.ramp(0x1e, 0x25, k[3], k[4]);
    this.pal[0x26] = this.pal[0x27] = this.pal[0x28] = k[4];
  }

  // ---- property setters (the IDotplane dispatch interface, 0x07978897 / 0x07977cf4)
  setZoomProp(v: number): void {      // put slot 8: rejects v < 0, zoom = 100 - v
    v = F(v);
    if (v < 0) return;
    this.zoom = F(-(v - 100));
    this.translateDirty = true; this.dirty = true;
  }
  resetView(): void {                 // 0x07977cf4
    ident(this.Rx); ident(this.Ry); ident(this.Rz); ident(this.Tr);
    this.nX = this.nY = this.nZ = 0;
    this.setZoomProp(100);
    this.gravity = K_GRAVITY;
    this.vel0 = 0;
    this.dirty = true;
  }

  // ---- SetCurrentPreset, 0x07978753
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n > 3) return false;                  // E_INVALIDARG (the DLLs have 0 and 1)
    if (this.legacy !== n >= 2) this.dibW = 0;         // another DLL's camera: rebuilt on the next frame
    this.preset = n;
    this.legacy = n >= 2;
    if ((n & 1) === 0) {
      this.keys = [0xff, 0xff00ff, 0xff7070, 0xff7000, 0xffff00];
      this.bg = 0;
      this.buildGradient();
      this.spinX = this.spinY = this.spinZ = false;     // slot 19 -> slot 20 (0x07977df7)
      this.resetView();
    } else {
      this.ramp(0, 7, 0xf00080, 0xa000a0);              // the keys and the background are left alone
      this.ramp(8, 0x18, 0xa000a0, 0xa0a000);
      this.ramp(0x19, 0x28, 0xa0a000, 0xffffff);
      A.srand(this.clock() | 0);                        // srand(time(NULL))
      this.timerNext = NaN;                             // SetTimer(250 ms)
      this.resetView();
      this.spinX = true;                                // spin Y/Z keep whatever they were
    }
    return true;
  }

  // ---- the timer callback, 0x07977a4a: WM_TIMER every 250 ms while preset 1 is current. Each tick
  // nudges one property at random. (The ground-truth host has no message loop; its A/B calls this
  // directly on the same 250 ms schedule.)
  onTimer(): void {
    if ((this.preset & 1) === 0) { this.timerNext = -1; return; }   // KillTimer
    switch (A.rand() % 30) {
      case 1:
        if (A.rand() % 10 === 0) { this.spinX = this.spinY = this.spinZ = false; this.resetView(); }
        break;
      case 2: this.spinY = !this.spinY; break;
      case 3: this.spinX = !this.spinY; break;          // all three test spin Y (obj+0xc9c9)
      case 4: this.spinZ = !this.spinY; break;
      case 5: this.vel0 = F(this.vel0 + 0.5); break;
      case 6: this.vel0 = F(this.vel0 - 0.5); break;
      case 7: this.gravity = F(this.gravity + this.gravity); break;
      case 8: this.gravity = F(this.gravity * 0.5); break;
      default: {
        var z = F(-this.zoom + 100);                    // get slot 7
        z = F(A.rand() < 0x3fff ? z + 1 : z - 1);
        this.setZoomProp(z);
      }
    }
  }

  // ---- the camera, FUN_0779a6a3: LookAt from EYE to the origin, up (0,1,0), near d = -1, fov pi/3,
  // projected onto the min(W, H) square. Builds VP = V * (L * P) and keeps the view direction.
  buildCamera(W: number, H: number): void {
    var d = -1;
    var f = this.fwd;
    f[0] = F(EYE[0] - 0); f[1] = F(EYE[1] - 0); f[2] = F(EYE[2] - 0);
    norm(f);
    var t = (f[1] * 1 + f[2] * 0) + f[0] * 0;          // dot(f, up), that order
    var u = new Float32Array([F(0 - f[0] * t), F(1 - f[1] * t), F(0 - f[2] * t)]);
    norm(u);
    var r = new Float32Array([F(f[1] * u[2] - f[2] * u[1]), F(f[2] * u[0] - u[2] * f[0]), F(f[0] * u[1] - f[1] * u[0])]);
    norm(r);
    var V = new Float32Array(16);
    V[0] = r[0]; V[1] = u[0]; V[2] = f[0];
    V[4] = r[1]; V[5] = u[1]; V[6] = f[1];
    V[8] = r[2]; V[9] = u[2]; V[10] = f[2];
    V[12] = F(-(((r[2] * EYE[2]) + (r[1] * EYE[1])) + r[0] * EYE[0]));
    V[13] = F(-(((u[2] * EYE[2]) + (u[1] * EYE[1])) + u[0] * EYE[0]));
    V[14] = F(-(((f[1] * EYE[1]) + (f[2] * EYE[2])) + f[0] * EYE[0]));
    V[15] = 1;
    // viewport {0, side, side, 0} and window {-tt, -tt, tt, tt}
    var side = W < H ? W : H;
    var tt = Math.tan(K_FOV * 0.5) * d;                 // FPTAN, times d in the register (53-bit)
    var P = new Float32Array(16), L = ident(new Float32Array(16)), sx, sy, sz, tx, tz;
    if (!this.legacy) {
      var vx0 = 0, vy0 = side, vx1 = side, vy1 = 0;
      var wx0 = F(-tt), wy0 = F(-tt), wx1 = F(tt), wy1 = F(tt);
      var zf = F(d + K_GRAVITY);
      sx = wx0 !== wx1 ? F((vx0 - vx1) / (wx0 - wx1)) : 1;
      sy = wy1 !== wy0 ? F((vy1 - vy0) / (wy1 - wy0)) : 1;
      var q = ((1000 - zf) * d) * d;
      sz = q !== 0 ? F(((d - zf) * (d - 1000)) / q) : 1;
      tx = wx0 !== wx1 ? ((vx1 * wx0) - (vx0 * wx1)) / (wx0 - wx1) : 1;
      var q2 = (zf - 1000) * d;
      tz = q2 !== 0 ? F(((d - 1000) * zf) / q2) : 1;
      L[11] = d !== 0 ? F(-1 / d) : -1;
    } else {                                            // WMP 7.1 0x52570ec5: no guards, tt and d + 0.01
      var mt = F(-tt), zr = d + K_GRAVITY, zF = F(zr), dm = F(d - 1000), D1 = mt - tt;   // kept in registers
      sz = F(((d - zr) * dm) / (((1000 - zr) * d) * d));
      tx = (mt * side) / D1;
      tz = F((dm * zF) / ((zF - 1000) * d));
      sx = F(-side / F(D1));
      sy = F(-side / (tt - mt));
      L[11] = F(-1 / d);
    }
    P[0] = sx; P[5] = sy; P[10] = sz; P[12] = F(tx); P[13] = F(tx); P[14] = tz; P[15] = 1;
    var ord = this.legacy ? ORD7 : ORD;
    mul(V, mul(L, P, new Float32Array(16), ord), this.VP, ord);
  }

  // M = Rx * Ry * Rz * Tr * VP: Render after (re)creating the DIB (0x07978154) and Update (0x07977947) chain
  // the generic multiply; WMP 7-8 inline the first products, each site its own way.
  compose(inRender: boolean): void {
    var t1 = this.t1, t2 = this.t2, t3 = this.t3;
    if (!this.legacy) mul(mul(mul(mul(this.Rx, this.Ry, t1), this.Rz, t2), this.Tr, t3), this.VP, this.M);
    else if (inRender) mul(mul(mul(mul(this.Rx, this.Ry, t1, R7_XY, 0xf), this.Rz, t2, R7_Z), this.Tr, t3, ORD7), this.VP, this.M, ORD7);
    else mul(mul(mul(mul(this.Rx, this.Ry, t1, U7_XY, 0xf), this.Rz, t2, U7_Z, 8), this.Tr, t3, U7_T), this.VP, this.M, ORD7);
  }

  // ---- 0x079774a7: lift a row, scroll and drop the rest, spin, translate, recompose
  update(L: TimedLevel): void {
    var g = this.grid, i, k, b;
    if (L.state !== 1) {             // PAUSED skips the dots (not the spin)
      var f0 = L.freq[0], f1 = L.freq[1], stereo = this.channels > 1, idx = 1;
      for (i = 0; i < 50; i++) {
        var next = ftol(idx * K_BIN);
        if (next <= idx) next = idx + 1;
        b = (this.row * 50 + i) * 5;
        g[b] = i - 25;
        var v = (stereo && f1[idx] > f0[idx] ? f1[idx] : f0[idx]) >> 2;
        g[b + 1] = F(v * K_HEIGHT * v);
        g[b + 2] = -25;
        g[b + 3] = 1;
        g[b + 4] = this.vel0;
        idx = next;
      }
      if (++this.row >= ROWS) this.row -= ROWS;
      var r = this.row, grav = this.gravity;
      for (k = 0; k < ROWS - 1; k++, r++) {          // every row but the new one, oldest first
        if (r >= ROWS) r -= ROWS;
        for (i = 0, b = r * 250; i < ROWS; i++, b += 5) {
          g[b + 2] = F(g[b + 2] + 1);
          var y = g[b + 1];
          if (y > 0) {
            var ny = y - g[b + 4];
            g[b + 1] = ny < 0 ? 0 : ny;              // the double is tested, the float stored
            g[b + 4] = F(grav + g[b + 4]);
          }
        }
      }
    }
    var n, a, ad, M;
    if (this.spinX) {
      n = ++this.nX; a = F(n * K_XSTEP); M = this.Rx;
      ident(M); M[5] = F(Math.cos(a)); M[6] = F(-Math.sin(a)); M[9] = F(Math.sin(a)); M[10] = F(Math.cos(a));
      if (n === 300) this.nX = 0;
      this.dirty = true;
    }
    if (this.spinY) {                // cos of the unrounded angle, sin and the second cos of the float
      n = ++this.nY; ad = this.legacy ? n * K_XSTEP : (n * K_TAU) * K_300TH; a = F(ad); M = this.Ry;
      ident(M); M[0] = F(Math.cos(ad)); M[2] = F(-Math.sin(a)); M[8] = F(Math.sin(a)); M[10] = F(Math.cos(a));
      if (n === 300) this.nY = 0;
      this.dirty = true;
    }
    if (this.spinZ) {
      n = ++this.nZ; ad = this.legacy ? n * K_XSTEP : (n * K_TAU) * K_300TH; a = F(ad); M = this.Rz;
      ident(M); M[0] = F(Math.cos(ad)); M[1] = F(-Math.sin(a)); M[4] = F(Math.sin(a)); M[5] = F(Math.cos(a));
      if (n === 300) this.nZ = 0;
      this.dirty = true;
    }
    if (this.translateDirty) {
      M = ident(this.Tr);
      M[12] = F(this.fwd[0] * this.zoom); M[13] = F(this.fwd[1] * this.zoom); M[14] = F(this.fwd[2] * this.zoom);
      this.translateDirty = false; this.dirty = true;
    }
    if (this.dirty) { this.compose(false); this.dirty = false; }
  }

  // ---- Render, 0x07977f9a
  render(L: TimedLevel | null): Surface | null {
    var S = this.surface, W = this.w, H = this.h, px = S.px, bg = rgb(this.bg);
    if (!L) return S;
    if (this.timerNext !== -1) {
      if (this.timerNext !== this.timerNext) this.timerNext = L.timeStamp + 2500000;
      while (this.timerNext !== -1 && L.timeStamp >= this.timerNext) { this.timerNext += 2500000; this.onTimer(); }
    }
    if (L.state === 0) { px.fill(bg); return S; }     // STOPPED: FillRect(prc, background) and out
    this.frame++;
    if (this.dibW !== W || this.dibH !== H) {         // CreateDIB + the camera + the composite
      this.dibW = W; this.dibH = H;
      this.buildCamera(W, H);
      this.compose(true);
    }
    this.update(L);

    px.fill(bg);                                      // 0x077156d4: the DIB cleared to the background
    var M = this.M, g = this.grid, pal = this.pal, hits = this.hits, nh = 0;
    var m0 = M[0], m1 = M[1], m3 = M[3], m4 = M[4], m5 = M[5], m7 = M[7], m8 = M[8], m9 = M[9],
        m11 = M[11], m12 = M[12], m13 = M[13], m15 = M[15];
    var xoff = W > H ? (W - H) >> 1 : 0, legacy = this.legacy;
    var minX = W, maxX = 0, minY = H, maxY = 0;
    for (var b = 0, e = ROWS * ROWS * 5; b < e; b += 5) {   // memory order, row 0 first
      var x = g[b], y = g[b + 1], z = g[b + 2], w = g[b + 3], ow, ox, oy, sx, sy;
      if (!legacy) {
        ow = F(((m15 * w + m3 * x) + m11 * z) + m7 * y);  // FUN_0779b659, its summation order
        if (!(ow < 0)) continue;
        ox = F(((m12 * w + m8 * z) + m4 * y) + m0 * x);
        oy = F(((m13 * w + m1 * x) + m9 * z) + m5 * y);
        var q = 1 / ow;
        sx = (ftol(ox * q) + xoff) | 0; sy = ftol(q * oy);
      } else {                                          // WMP 7.1 0x5256f887: inline, divides
        ow = F(((z * m11 + x * m3) + y * m7) + w * m15);
        if (ow >= 0) continue;                          // FCOMP; TEST AH,1: NaN is drawn
        ox = F(((m4 * y + m0 * x) + z * m8) + w * m12);
        oy = F(((z * m9 + m5 * y) + x * m1) + m13 * w);
        sx = (ftol(ox / ow) + xoff) | 0; sy = ftol(oy / ow);
      }
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
      var ci = ftol(y);
      ci = ci > 39 ? 40 : ci < 0 ? 0 : ci;
      var o = sy * W + sx;
      px[o] = rgb(pal[ci]);
      hits[nh++] = o;
      // the bounding box is an else-if, so a dot that lowers the minimum never raises the maximum
      if (sx < minX) minX = sx; else if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; else if (sy > maxY) maxY = sy;
    }
    // 0x0797842c: the rectangle copied to the window is left = minX, right = left + maxX + 1 (the maximum is
    // added to the minimum, not to 0), same for y. Everything outside it is FillRect'ed with the background,
    // so a dot outside it (only possible through the else-if above) is not shown.
    var x1 = minX + maxX + 1, y1 = minY + maxY + 1;
    for (var j = 0; j < nh; j++) {
      var p = hits[j], hx = p % W, hy = (p / W) | 0;
      if (hx < minX || hx >= x1 || hy < minY || hy >= y1) px[p] = bg;
    }
    return S;
  }

  debug() {
    return {
      engine: 'Particle', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      spin: (this.spinX ? 'X' : '') + (this.spinY ? 'Y' : '') + (this.spinZ ? 'Z' : ''),
      zoom: this.zoom, gravity: this.gravity, vel0: this.vel0, row: this.row, frame: this.frame,
      channels: this.channels, timer: this.timerNext === -1 ? 'off' : 'on'
    };
  }
}

A.Particle = Particle;
export { Particle };
