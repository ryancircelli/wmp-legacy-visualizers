// The four Shift warp kernels (spec 03). Destination -> source maps, mutated in place.
// Precision is load-bearing: Math.fround marks the single-precision stages, Math.trunc the
// CVTTSD2SI/CVTTSS2SI truncations. No allocation anywhere below map().
// Wrapped verbatim from src/30-kernels.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A } from './ns';
import './rand';
import './effect';
import type { WarpPoint } from './effect';
// mpvis.DLL's sin/cos are ucrtbase's (_o_sin/_o_cos -> 0x1800aba70/0x1800a7730): the clones in 00-rand.js.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sin/A.cos never read `this`; hoisted once, not per-call, on purpose (see 00-rand.js)
var sin = A.sin || Math.sin;
// SC[0] = sin, SC[1] = cos of one angle: the same bits as the two calls, one reduction.
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.sincos never reads `this`; hoisted once on purpose
var sincos = A.sincos, SC = new Float64Array(2);

const PI_F = Math.fround(Math.PI);   // 0x18002377c = 3.1415927f
const PI_D = 3.1415927410125732;     // 0x180023740 = (double)(float)M_PI
const fr = Math.fround, tr = Math.trunc, sqrt = Math.sqrt;
// eslint-disable-next-line @typescript-eslint/unbound-method -- A.atan2 never reads `this`; hoisted once on purpose
const atan2 = A.atan2 || Math.atan2;  // CRT-exact (00-rand.js); Math.atan2 moves warp-table entries

// 18000bef4: float -> int, round half away from zero (the one non-truncating conversion).
function roundAway(v: number): number { return v <= 0 ? tr(fr(v - 0.5)) : tr(fr(v + 0.5)); }

// 18000ad94/18000c774 base + SetSize 18000ae60: W,H,halfDiag,cx0,cy0 then the +0x40 hook.
class Kernel extends A.WarpKernel {
  declare cx0: number;
  declare cy0: number;
  declare halfDiag: number;
  declare poolIndex: number;   // stamped by makePool(), below; unset (never read) otherwise
  constructor(nameId: number, name: string) {
    super();
    this.nameId = nameId;
    this.name = name;
    this.cx0 = 0; this.cy0 = 0; this.halfDiag = 0;
  }
  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    this.halfDiag = sqrt((w * w + h * h) | 0) * 0.5;   // int32 sum, then double
    this.cx0 = w >> 1; this.cy0 = h >> 1;
    this.onResize();
  }
  onResize() {}                                        // vtable +0x40
}

// ---------------------------------------------------------------- COMB (114), 18000e500
class CombShear extends Kernel {
  declare speed: number;
  declare width: number;
  declare vertical: boolean;
  constructor() {
    super(114, 'Comb Shear');
    this.speed = 1; this.width = 1; this.vertical = false;
  }
  randomize() {                                        // 18000ed70: Width, Speed, Vertical
    this.width = A.rand() % 40 + 1;
    this.speed = A.rand() % 4 + 1;
    this.vertical = A.rand() % 4 === 0;
  }
  map(p: WarpPoint) {                                  // pure int32, no FP
    const B = this.width, S = this.speed, P = 2 * B, dstX = p.x, dstY = p.y;
    let rx = 0, ry = 0;
    if (P >= 1) { rx = dstX % P; ry = dstY % P; }
    if (this.vertical) {
      p.y = rx <= B ? dstY - S : dstY + S;
    } else if (ry > B) {
      if (this.w - dstX >= B || rx <= ry - B) p.x = dstX + S;
      else p.y = dstY + S;
    } else {
      if (dstX >= B || rx <= ry) p.x = dstX - S;
      else p.y = dstY + S;
    }
  }
}

// ------------------------------------------------------ LINEAR (105), 18000e280
class LinearShift extends Kernel {
  declare xShift: number;
  declare yShift: number;
  declare falloff: boolean;
  declare fallPctX: number;
  declare fallPctY: number;
  declare fallDir: number;
  declare sinShake: number;
  declare sinLoops: number;
  declare _sx: number;
  declare _sy: number;
  declare _loopsF: number;
  declare _ampX: number;
  declare _ampY: number;
  constructor() {
    super(105, 'Linear Shift');
    this.identityFallback = false;                     // +0x52 = 0 -> out of range samples (0,0)
    this.xShift = 1; this.yShift = 1;
    this.falloff = false;
    this.fallPctX = 0.5; this.fallPctY = 0.5;
    this.fallDir = 0; this.sinShake = 0; this.sinLoops = 4;
    this._derive();
  }
  _derive() {                                          // hoisted constants only
    this._sx = this.fallPctX + 1.0;
    this._sy = this.fallPctY + 1.0;
    this._loopsF = fr(this.sinLoops);
    this._ampX = fr(3 * this.yShift);                  // cross-coupled on purpose
    this._ampY = fr(3 * this.xShift);
  }
  randomize() {                                        // 18000ebe0
    let X, Y;
    do {                                               // rejects only the (0,0) pair
      X = A.rand() % 7 - 3;
      Y = A.rand() % 7 - 3;
      if (X !== 0) break;
    } while (Y === 0);
    this.xShift = X; this.yShift = Y;
    this.falloff = A.rand() % 3 !== 0;
    this.fallPctX = (A.rand() / 32767.0) * 0.1 + 0.0;
    this.fallPctY = (A.rand() / 32767.0) * 0.1 + 0.0;
    this.fallDir = A.rand() % 8;
    this.sinShake = A.rand() % 3;
    this.sinLoops = A.rand() % 15 + 1;
    this._derive();
  }
  map(p: WarpPoint) {
    const W = this.w, H = this.h;
    let x = p.x, y = p.y;
    if (!this.falloff) {                               // stage 1, double
      x = x + this.xShift;
      y = y + this.yShift;
    } else {
      let d: number;
      switch (this.fallDir) {
        case 0: x = tr(this._sx * x); break;
        case 1: y = tr(this._sy * y); break;
        case 2: d = (W - x) - 1; x = x - tr(this._sx * d - d); break;
        case 3: d = (H - y) - 1; y = y - tr(this._sy * d - d); break;
        case 4: x = tr(this._sx * x); y = tr(this._sy * y); break;
        case 5: d = (W - x) - 1; x = x - tr(this._sx * d - d);
                d = (H - y) - 1; y = y - tr(this._sy * d - d); break;
        case 6: x = tr(this._sx * x);
                d = (H - y) - 1; y = y - tr(this._sy * d - d); break;
        case 7: d = (W - x) - 1; x = x - tr(this._sx * d - d);
                y = tr(this._sy * y); break;
        default: break;
      }
    }
    if (this.sinShake > 0) {                           // stage 2, float32 argument
      if (this.sinShake === 1) {
        const s = fr(sin(fr(fr(fr(fr(y) / fr(H)) * this._loopsF) * PI_F)));
        x += roundAway(fr(s * this._ampX));
      } else {
        const s = fr(sin(fr(fr(fr(fr(x) / fr(W)) * this._loopsF) * PI_F)));
        y += roundAway(fr(s * this._ampY));
      }
    }
    p.x = x; p.y = y;
  }
}

// ----------------------------------------------------- STRETCH (106), 18000e590
class StretchShift extends Kernel {
  declare rotation: number;
  declare movePct: number;
  declare flowPoint: boolean;
  declare pctX: number;
  declare pctY: number;
  declare sinShake: boolean;
  declare sinLoops: number;
  declare poleX: number;
  declare poleY: number;
  declare amp: number;
  declare maxRadius: number;
  declare _cx: number;
  declare _cy: number;
  constructor() {
    super(106, 'Stretch Shift');
    this.rotation = 0.01; this.movePct = 0.1;
    this.flowPoint = false;
    this.pctX = 0.5; this.pctY = 0.5;
    this.sinShake = false; this.sinLoops = 5;
    this.poleX = 0; this.poleY = 0; this.amp = 0; this.maxRadius = 100.0;
    this._cx = 0; this._cy = 0;
  }
  randomize() {                                        // 18000ee00, draw order matters
    this.sinShake = ((~A.rand()) & 1) !== 0;
    this.sinLoops = A.rand() % 15 + 1;
    this.rotation = this.sinShake
      ? (A.rand() / 32767.0) * 0.44 - 0.22
      : (A.rand() / 32767.0) * 0.20 - 0.10;
    this.movePct = (A.rand() / 32767.0) * 0.25 + 0.05;
    this.flowPoint = ((~A.rand()) & 1) !== 0;
    this.pctX = (A.rand() / 32767.0) * 0.8999999999999999 + 0.05;
    this.pctY = (A.rand() / 32767.0) * 0.8999999999999999 + 0.05;
    this.onResize();
  }
  onResize() {                                         // 18000ea40, vtable +0x58
    if (this.pctX < 0.01) this.pctX = 0.01; else if (0.99 < this.pctX) this.pctX = 0.99;
    if (this.pctY < 0.01) this.pctY = 0.01; else if (0.99 < this.pctY) this.pctY = 0.99;
    const W = this.w, H = this.h;
    this.poleX = tr(W * this.pctX);
    this.poleY = tr(H * this.pctY);
    this.amp = tr(H * this.movePct);                   // H on BOTH axes
    const ax = Math.abs(this.poleX), ay = Math.abs(this.poleY);
    const bx = Math.abs(W - this.poleX), by = Math.abs(H - this.poleY);
    const d0 = sqrt((ax * ax + ay * ay) | 0), d1 = sqrt((bx * bx + ay * ay) | 0);
    const d2 = sqrt((by * by + bx * bx) | 0), d3 = sqrt((by * by + ax * ax) | 0);
    let m = 0.0;
    if (m < d0) m = d0;
    if (m < d1) m = d1;
    if (m < d2) m = d2;
    if (m < d3) m = d3;
    this.maxRadius = m;
    // Map() reads FlowPoint per pixel in the DLL; hoisted here, so any change to
    // flowPoint/pctX/pctY/movePct must go through randomize() or setSize().
    this._cx = this.flowPoint ? this.poleX : this.cx0;
    this._cy = this.flowPoint ? this.poleY : this.cy0;
  }
  map(p: WarpPoint) {
    const cx = this._cx, cy = this._cy;
    const dx = p.x - cx, dy = p.y - cy;
    const a0 = atan2(dy, dx);
    const r = sqrt((dy * dy + dx * dx) | 0);
    const t = r / this.maxRadius;
    const rSrc = r - t * t * t * this.amp;
    const w = this.sinShake ? sin(this.sinLoops * t * PI_D) : t;
    const aSrc = a0 + w * this.rotation;
    sincos(aSrc, SC);
    p.x = tr(SC[1] * rSrc) + cx;
    p.y = tr(SC[0] * rSrc) + cy;
  }
}

// ------------------------------------------------------- SCOPE (109), 18000e6e0
class ShiftOScope extends Kernel {
  declare stretch: StretchShift;
  declare linear: LinearShift;
  declare comb: CombShear;
  declare stretchFactor: number;
  declare wigglyStretch: boolean;
  declare spinFactor: number;
  declare linearMoveX: number;
  declare linearMoveY: number;
  declare oceanFactor: number;
  declare centerCircleRadius: number;
  declare littleCircleRadius: number;
  declare reflectionMode: number;
  declare shiftMode: number;
  declare boxSize: number;
  declare mx: number;
  declare my: number;
  declare mxMinusR: number;
  declare myMinusR: number;
  declare halfHalf: number;
  declare halfInt: number;
  constructor() {
    super(109, "Shift O' Scope");
    this.chainable = false;            // +0x50  (18000dffc MOV byte [RBX+0x50],0)
    this.instantTransition = true;     // +0x51  (18000dfef MOV word [RBX+0x51],0x1, low byte)
    // +0x52 = 0: that SAME word store writes 0x0001 across 0x51..0x52, so its high byte clears
    // the 1 the base ctor put there (18000c799 MOV byte [RCX+0x52],1). => fixed fallback, and
    // 18000c774 leaves fallbackX/Y at 0. Spec 03 s0.2 has it right; spec 07 item 12 read the
    // store as byte-wide and "corrected" it the wrong way.
    this.identityFallback = false;     // +0x52
    this.stretch = new StretchShift();
    this.linear = new LinearShift();
    this.comb = new CombShear();
    this.stretchFactor = 0.0;          // never read
    this.wigglyStretch = false;        // never read
    this.spinFactor = 0.0;
    this.linearMoveX = 0;              // never read
    this.linearMoveY = 0;              // never read
    this.oceanFactor = 0.0;            // never read
    this.centerCircleRadius = 50;
    this.littleCircleRadius = 10;
    this.reflectionMode = 0; this.shiftMode = 0; this.boxSize = 1;
    this.mx = 0; this.my = 0;
    this.mxMinusR = -50; this.myMinusR = -50;
    this.halfHalf = 0;                 // halfDiag*0.5, and its int truncation
    this.halfInt = 0;
    this.randomize();                  // 18000df64's last statement
  }
  onResize() {                         // 18000f1a0, vtable +0x40
    this.mx = this.w >> 1;
    this.my = this.h >> 1;
    this.mxMinusR = this.mx - this.centerCircleRadius;
    this.myMinusR = this.my - this.centerCircleRadius;
    this.halfHalf = this.halfDiag * 0.5;
    this.halfInt = tr(this.halfHalf);
    this.stretch.setSize(this.w, this.h);
    this.linear.setSize(this.w, this.h);
    this.comb.setSize(this.w, this.h);
  }
  randomize() {                        // 18000ef90
    this.reflectionMode = A.rand() % 5;
    this.shiftMode = A.rand() % 4;
    switch (this.shiftMode) {
      case 0: this.stretch.randomize(); break;
      case 1: this.linear.randomize(); break;
      case 2: this.comb.randomize(); break;
      case 3: this.spinFactor = (A.rand() / 32767.0) * 0.4 - 0.2; break;
    }
    if (this.reflectionMode === 3) {
      this.centerCircleRadius = A.rand() % 250 + 5;
      this.littleCircleRadius = A.rand() % 50 + 3;
      this.mxMinusR = this.mx - this.centerCircleRadius;
      this.myMinusR = this.my - this.centerCircleRadius;
    } else if (this.reflectionMode === 4) {
      if (A.rand() % 10 === 0) this.boxSize = A.rand() % 300 + 1;
      else this.boxSize = 1;
    }
  }
  subwarp(p: WarpPoint) {              // 18000e128
    switch (this.shiftMode) {
      case 0: this.stretch.map(p); break;
      case 1: this.linear.map(p); break;
      case 2: this.comb.map(p); break;
      case 3: {
        const dx = this.cx0 - p.x, dy = this.cy0 - p.y;
        const r = sqrt((dy * dy + dx * dx) | 0);
        const a = atan2(dy, dx) + this.spinFactor;
        sincos(a, SC);
        p.y = (this.h - this.cy0) - tr(SC[0] * r);
        p.x = (this.w - this.cx0) - tr(SC[1] * r);
        break;
      }
      default: break;
    }
  }
  map(p: WarpPoint) {
    const W = this.w, H = this.h, mx = this.mx, my = this.my;
    const dstX = p.x, dstY = p.y;
    switch (this.reflectionMode) {
      case 0: {
        const inLeft = dstX <= mx;
        p.x = inLeft ? dstX : W - dstX;
        if (dstY > my) { p.y = H - dstY; return; }
        if (!inLeft) return;                           // p.y already dstY
        this.subwarp(p);
        return;
      }
      case 1: {
        const Av = W * dstY, Bv = H * dstX, Cv = (W - dstX) * H;
        if (Av < Bv) {
          if (Av < Cv) {                               // top triangle
            if (dstX < mx) this.subwarp(p);
            else p.x = 2 * mx - dstX;
          } else {                                     // right triangle
            p.x = (W - dstX) + mx;
            p.y = Math.abs(dstY - my);
          }
        } else if (Av < Cv) {                          // left triangle
          p.x = mx - dstX;
          p.y = Math.abs(dstY - my);
        } else {                                       // bottom triangle
          p.x = dstX <= mx ? dstX : 2 * mx - dstX;
          p.y = H - dstY;
        }
        return;
      }
      case 2: {
        const dx = dstX - this.cx0, dy = dstY - this.cy0;
        const r = sqrt((dy * dy + dx * dx) | 0);
        if (tr(r) >= this.halfInt) {                    // (int)r / (int)half != 0
          const a = atan2(dy, dx);
          const rSrc = 2.0 * this.halfHalf - r;
          sincos(a, SC);
          p.x = tr(SC[1] * rSrc) + this.cx0;
          p.y = tr(SC[0] * rSrc) + this.cy0;
          return;
        }
        const inLeft = dstX <= mx;                     // inside the disk: mode 0
        p.x = inLeft ? dstX : W - dstX;
        if (dstY > my) { p.y = H - dstY; return; }
        if (!inLeft) return;
        this.subwarp(p);
        return;
      }
      case 3: {
        const dy = this.cy0 - dstY, dx = this.cx0 - dstX;
        const R = this.centerCircleRadius;
        const r = sqrt((dy * dy + dx * dx) | 0);
        if (R >= r) { this.subwarp(p); return; }
        const N = this.littleCircleRadius, P = N + 2;
        let rx = 0, ry = 0;
        if (P >= 1) { rx = dstX % P; ry = dstY % P; }
        const k = (R + R) / N;
        p.x = roundAway(fr(rx * k)) + this.mxMinusR;
        p.y = roundAway(fr(ry * k)) + this.myMinusR;
        return;
      }
      case 4: {
        const g = this.boxSize;
        if (g !== 0) {
          if ((((dstX / g) | 0) & 1) !== 0) return;
          if ((((dstY / g) | 0) & 1) !== 0) return;
        }
        this.subwarp(p);
        return;
      }
      default: return;                                 // identity, unreachable
    }
  }
}

// 180009eb0 pool order: 4 SCOPE, 2 LINEAR, 2 STRETCH, 2 COMB; each stamped with its index.
function makePool(): Kernel[] {
  const pool = [
    new ShiftOScope(), new ShiftOScope(), new ShiftOScope(), new ShiftOScope(),
    new LinearShift(), new LinearShift(),
    new StretchShift(), new StretchShift(),
    new CombShear(), new CombShear()
  ];
  for (let i = 0; i < pool.length; i++) pool[i].poolIndex = i;
  return pool;
}

export const Kernels = { LinearShift, StretchShift, ShiftOScope, CombShear, makePool };
A.Kernels = Kernels;
