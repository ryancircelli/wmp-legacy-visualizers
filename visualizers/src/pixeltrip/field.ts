// PixelTrip's transform: a vector field over the window (0x10012370). Every pixel of the next frame is read, bilinearly,
// from where the field maps it in the last one (MMX, 8.8 fixed point), less a small fade. One of 23 field kinds is
// chosen every 14.5-18.5 s; its table is built a row per drawn frame in the background and swapped in when done. The
// fields are polar maps (radius, angle) of the point scaled about the centre; "PixelTrip Motion" moves where the
// table is read with a Mover.
import { Ctx, Deck, F, ftol } from './ctx';
import { Mover } from './parts';

/** a polar map (every kind's vtable slot 2 answers polar) */
interface Kind { map(x: number, y: number, p: Float32Array): void }

const R0 = 0, A0 = 1;   // p[R0] radius, p[A0] angle (floats)

/** the k of most kinds: k0, or k0 scaled by (R - r) / R or r / R */
function lean(f28: number, f2c: number, R: number, iR: number, r: number, k: number): number {
  return f28 ? (f2c ? (R - r) * iR * k : iR * r * k) : k;
}

/** 0x10010230 (kind 10): a swirl whose angle ripples with r^2 */
class Swirl implements Kind {
  iR: number; k20: number; k24: number; f28 = 1; f2c = 1; k30: number; k34: number; k1c: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k24 = F(c.rand() * F(2.2888882540428312e-06) + F(0.025));
    this.k20 = F(c.rand() * F(2.2888882540428312e-06) + F(0.025));
    if (c.every(c.rdiv(3) + 1)) this.k20 = -this.k20;
    if (c.every(c.rdiv(4) + 2)) this.f2c = 0;
    if (c.every(c.rdiv(3) + 2)) this.f28 = 0;
    this.k30 = F(c.rand() * 2.2888882106997894e-06 + F(0.025));
    this.k34 = F(c.rand() * F(0.0002441480755805969) + 4);
    this.k1c = F(R / (c.rand() * F(4.577776417136192e-05) + 1));
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0], k = lean(this.f28, this.f2c, this.R, this.iR, r, this.k20);
    const r2 = r - (this.k1c - r) * this.k24 * r;
    p[R0] = r2;
    p[A0] = p[A0] - (Math.sin(r2 * this.iR * r2 * this.k34) * this.k30 + k);
  }
}

/** 0x10010420 (kind 20) and 0x100122f0 (kind 21, a stronger twist): one of ten radial pulls */
class Pull implements Kind {
  iR: number; mode: number; k20 = F(0.18); k4: number;
  constructor(c: Ctx, public R: number, strong: boolean) {
    this.iR = F(1 / R);
    this.mode = ftol(c.rand() * F(0.030487991869449615) * F(0.01));
    c.rand();
    this.k4 = F(c.rand() * F(3.051851081181667e-06) + F(0.05));
    if (strong) this.k4 = F(c.rand() * F(2.288888208568096e-05) + 0.25);
  }
  map(x: number, y: number, p: Float32Array): void {
    const R = this.R, iR = this.iR, k = this.k20, r = p[R0];
    p[A0] = p[A0] + Math.sin((R - r) * 0.3986) * (this.k4 * r);
    const t = (R - r) * iR;
    let v: number;
    switch (this.mode) {
      case 0: v = Math.atan(R - r) * k; break;
      case 1: v = Math.atan(iR * r) * k; break;
      case 2: v = Math.atan(t) * k; break;
      case 3: v = Math.cos(t) * k; break;
      case 4: v = Math.atan(t) * (t * k); break;
      case 5: v = Math.cos(t) * (t * k); break;
      case 6: v = Math.sin(t) * (t * k); break;
      case 7: v = Math.sinh(t) * (F(t) * k); break;
      case 8: v = Math.cosh(t) * (F(t) * k); break;
      default: v = Math.tanh(t) * (F(t) * k);
    }
    p[R0] = v + r;
  }
}

/** 0x10010620 (kind 14): radius pushed by |x||y|, angle by sin(r) */
class Cross implements Kind {
  iR: number; f24 = 1; f28 = 1; f2c = 1; f30 = 0; k3c: number; k20: number; k1c: number; k40: number; k44: number;
  k34: number; k38: number; f48: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k3c = (c.tick & 1) ? 1 : -1;
    this.k20 = F(c.rand() * F(6.866664534754818e-06) + F(0.075));
    this.k1c = F(c.rand() * 5.722220526749474e-07 + F(0.00625));
    if (c.every(c.rdiv(3) + 1)) this.k1c = -this.k1c;
    if (c.every(c.rdiv(4) + 2)) this.f28 = 0;
    if (c.every(c.rdiv(3) + 2)) this.f24 = 0;
    this.k40 = F(c.rand() * F(3.8148138514770835e-07) + F(0.0125));
    this.k44 = c.rdiv(16) + 4;
    this.f2c = c.every(c.rdiv(2) + 2) ? 1 : 0;
    this.k34 = F(c.rand() * 2.2888882106997894e-06 + F(0.025));
    this.k38 = F(c.rand() * F(0.0002441480755805969) + 4);
    this.f30 = ~c.tick & 1;
    this.f48 = c.every(c.rdiv(5) + 2) ? 1 : 0;
  }
  map(x: number, y: number, p: Float32Array): void {
    const k = lean(this.f24, this.f28, this.R, this.iR, p[R0], this.k1c);
    let X = x, Y = y;
    if (this.f48) { if (X < 0) X = -X; if (Y < 0) Y = -Y; }
    const q = X * (this.k20 * this.iR * Y) * this.k3c + p[R0];
    p[R0] = q;
    let a = p[A0] - (Math.sin(q * this.k44) * this.k40 + k);
    if (this.f2c) a = a - Math.sin(this.k38 * p[R0]) * this.k34;
    p[A0] = a;
  }
}

/** 0x10010900 (kind 6): twin-sine twists of the angle and the radius */
class Waves implements Kind {
  iR: number; f24 = 1; f28 = 1; f2c: number; f30: number; k3c: number; k20: number; k1c: number; k34: number; k38: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k3c = (c.tick & 1) ? 1 : -1;
    this.k20 = F(c.rand() * F(1.3733329069509637e-05) + F(0.1));
    this.k1c = F(c.rand() * F(6.103702162363334e-06) + F(0.05));
    if (c.every(c.rdiv(3) + 1)) this.k1c = -this.k1c;
    if (c.every(c.rdiv(4) + 2)) this.f28 = 0;
    if (c.every(c.rdiv(3) + 2)) this.f24 = 0;
    this.f2c = ~c.tick & 1;
    this.f30 = ~c.tick & 1;
    this.k34 = F(c.rand() * 2.2888882106997894e-06 + F(0.025));
    this.k38 = F(c.rand() * F(0.0002441480755805969) + 4);
  }
  map(x: number, y: number, p: Float32Array): void {
    const R = this.R, r = p[R0], k = lean(this.f24, this.f28, R, this.iR, r, this.k1c);
    const t = R - r;
    p[A0] = p[A0] + (Math.sin(t * F(0.381)) * F(0.6) + Math.sin(t * F(0.539)) * F(0.4)) * k;
    const u = this.iR * r * r;
    const v = (Math.sin(u * F(0.339)) * F(0.6) + Math.sin(u * F(0.276)) * F(0.4)) * this.k20 * this.k3c + r;
    p[R0] = v;
    if (this.f2c) p[A0] = p[A0] - Math.sin((this.f30 ? R - v : v) * this.k38) * this.k34;
  }
}

/** 0x10010b50 (the 23rd kind): a ripple from x, y or the radius */
class Ripple implements Kind {
  iR: number; mode: number; off = F(0.01);
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.mode = ftol(c.rand() * F(0.00912503432482481) * F(0.01));
  }
  map(x: number, y: number, p: Float32Array): void {
    const v = this.mode === 0 ? Math.abs(x) : this.mode === 1 ? Math.abs(y) : Math.sin(this.iR * p[R0]) * this.R;
    const rr = F(p[R0] - this.off);
    p[R0] = rr;
    p[A0] = p[A0] + Math.sin(rr * 11 - v * F(3.3)) * (F(1.3) - rr) * F(0.16);
  }
}

/** 0x10010de0 (kind 17) and 0x10011000 (kind 16, the radius grows instead of shrinking) */
class Drift implements Kind {
  iR: number; s4: number; f28 = 1; f2c = 1; f30 = 1; k24: number; k20: number; k38: number; k3c: number;
  constructor(c: Ctx, public R: number, grow: boolean) {
    this.iR = F(1 / R);
    this.k24 = F(c.rand() * F(6.103702162363334e-06) + F(0.05));
    this.k20 = F(c.rand() * 2.2888882106997894e-06 + F(0.025));
    if (c.every(c.rdiv(3) + 1)) this.k20 = -this.k20;
    if (c.every(c.rdiv(4) + 2)) this.f2c = 0;
    if (c.every(c.rdiv(3) + 2)) this.f28 = 0;
    this.f30 = c.every(c.rdiv(2) + 2) ? 1 : 0;
    this.k38 = F(c.rand() * 1.1444441053498947e-06 + F(0.0125));
    this.k3c = F(c.rand() * F(0.0002441480755805969) + 4);
    this.s4 = grow ? 1 : -1;
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0], k = lean(this.f28, this.f2c, this.R, this.iR, r, this.k20);
    p[R0] = this.iR * r * this.k24 * this.s4 + r;
    let a = p[A0] - k;
    if (this.f30) a = a - Math.sin(this.k3c * p[R0]) * this.k38;
    p[A0] = a;
  }
}

/** 0x10011090 (kinds 3, 5, 9, 11, 13): radius and angle feed each other through one of 16 trig couplings */
class Couple implements Kind {
  iR: number; k1c: number; k20: number; k24: number; k28: number; k2c = 1; k30 = 1; k34 = 0; k38 = 0; k3c = 1; k40 = 1;
  mode: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k1c = F(c.rand() * F(1.5259255405908334e-06) + F(0.01));
    this.k20 = F(c.rand() * F(1.5259255405908334e-06) + F(0.01));
    this.k24 = c.rdiv(30) + 2;
    this.k28 = c.rdiv(30) + 2;
    if (c.every(c.rdiv(3) + 1)) this.k2c = -1;
    if (c.every(c.rdiv(3) + 1)) this.k30 = -1;
    if (c.every(c.rdiv(3) + 2)) {
      this.k34 = F(c.rand() * F(3.6240728604752803e-06) + F(0.00625));
      if (c.every(c.rdiv(5) + 3)) this.k34 = F(this.k34 * 0.5 * -1);
    }
    if (c.every(c.rdiv(3) + 2)) {
      this.k38 = F(c.rand() * F(1.2207403869979316e-06) + F(0.005));
      if (c.every(c.rdiv(3) + 1)) this.k38 = -this.k38;
      if (c.every(c.rdiv(4) + 2)) this.k40 = 0;
    }
    if (c.every(c.rdiv(3) + 2)) this.k3c = 0;
    this.mode = c.rdiv(15);
  }
  map(x: number, y: number, p: Float32Array): void {
    const iR = this.iR;
    const r1 = p[R0] - p[R0] * iR * this.k34;
    p[R0] = r1;
    if (this.k3c === 0) p[A0] = p[A0] - this.k38;
    else if (this.k40 === 0) p[A0] = p[A0] - r1 * iR * this.k38;
    else p[A0] = p[A0] - (this.R - r1) * iR * this.k38;
    const A = p[A0], LR = p[R0];
    const ra = (v: number) => v * this.k1c * this.k2c, ar = (v: number) => v * this.k20 * this.k30;
    const k24 = this.k24, k28 = this.k28;
    let a = A, r = LR;
    switch (this.mode) {
      case 0: a = A + ra(Math.cos(LR * k24)); r = LR + ar(Math.cos(A * k28)); break;
      case 1: a = A + ra(Math.sin(LR * k24)); r = LR + ar(Math.sin(A * k28)); break;
      case 2: a = A + ra(Math.cos(LR * k24)); r = LR + ar(Math.sin(A * k28)); break;
      case 3: a = A + ra(Math.sin(LR * k24)); r = LR + ar(Math.cos(A * k28)); break;
      case 4: { const v = ar(Math.cos(A * k28)) + LR; r = v; a = A + ra(Math.cos(v * k24)); break; }
      case 5: { const v = ar(Math.sin(A * k28)) + LR; r = v; a = A + ra(Math.sin(v * k24)); break; }
      case 6: { const v = ar(Math.sin(A * k28)) + LR; r = v; a = A + ra(Math.cos(v * k24)); break; }
      case 7: { const v = ar(Math.cos(A * k28)) + LR; r = v; a = A + ra(Math.sin(v * k24)); break; }
      case 8: a = A + ra(Math.cos(LR * k24)); r = LR + ar(Math.cos(a * k28)); break;
      case 9: a = A + ra(Math.sin(LR * k24)); r = LR + ar(Math.sin(a * k28)); break;
      case 10: a = A + ra(Math.cos(LR * k24)); r = LR + ar(Math.sin(a * k28)); break;
      case 11: a = A + ra(Math.sin(LR * k24)); r = LR + ar(Math.cos(a * k28)); break;
      case 12: a = A + ra(Math.cos((this.R - LR) * k24)); r = LR + ar(Math.cos(Math.atan2(x, y) * k28)); break;
      case 13: a = A + ra(Math.sin((this.R - LR) * k24)); r = LR + ar(Math.sin(Math.atan2(x, y) * k28)); break;
      case 14: a = A + ra(Math.cos((this.R - LR) * k24)); r = LR + ar(Math.sin(Math.atan2(x, y) * k28)); break;
      case 15: a = A + ra(Math.sin((this.R - LR) * k24)); r = LR + ar(Math.cos(Math.atan2(x, y) * k28)); break;
    }
    p[A0] = a; p[R0] = r;
  }
}

/** 0x10011980 (kind 22): radius scaled by 1 + atan(k - (R - r)) */
class Lens implements Kind {
  iR: number; f28 = 1; f2c = 1; k24: number; k20: number; k1c: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k24 = F(c.rand() * F(2.7466658139019273e-05) + F(0.1));
    this.k20 = F(c.rand() * F(1.5259254723787308e-05) + F(0.06));
    this.k1c = F(c.rand() * F(1.4496291669274797e-06) + F(0.0125));
    if (c.every(c.rdiv(3) + 1)) this.k1c = -this.k1c;
    if (c.every(c.rdiv(4) + 2)) this.f2c = 0;
    if (c.every(c.rdiv(3) + 2)) this.f28 = 0;
    if (this.f28 === 0) this.k1c = F(this.k1c * 0.5);
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0];
    p[A0] = p[A0] + lean(this.f28, this.f2c, this.R, this.iR, r, this.k1c);
    p[R0] = (Math.atan(this.k24 - (this.R - r)) * this.k20 + 1) * r;
  }
}

/** 0x10011b20 (kind 19): radius scaled by 1 + sin or atan(k - r), angle optionally rippled */
class Bulge implements Kind {
  iR: number; f28 = 1; f2c = 1; m30: number; k24: number; k20: number; k1c: number; f34: number; f38: number; k3c: number; k40: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.m30 = ftol(c.rand() * F(0.0060731833800673485) * F(0.01));
    this.k24 = F(c.rand() * F(1.5259254723787308e-05) + 0.25);
    this.k20 = F(c.rand() * F(1.5259254723787308e-05) + F(0.06));
    this.k1c = F(c.rand() * F(1.4496291669274797e-06) + F(0.0125));
    if (c.every(c.rdiv(3) + 1)) this.k1c = -this.k1c;
    if (c.every(c.rdiv(4) + 2)) this.f2c = 0;
    if (c.every(c.rdiv(3) + 2)) this.f28 = 0;
    if (this.f28 === 0) this.k1c = F(this.k1c * 0.5);
    this.f34 = ~c.tick & 1;
    this.f38 = ~c.tick & 1;
    this.k3c = F(c.rand() * 2.2888882106997894e-06 + F(0.025));
    this.k40 = F(c.rand() * F(0.0002441480755805969) + 4);
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0];
    p[A0] = p[A0] + lean(this.f28, this.f2c, this.R, this.iR, r, this.k1c);
    const t = this.k24 - r;
    p[R0] = ((this.m30 === 0 ? Math.sin(t) : Math.atan(t)) * this.k20 + 1) * r;
    if (this.f34) p[A0] = p[A0] - Math.sin((this.f38 ? this.R - p[R0] : p[R0]) * this.k40) * this.k3c;
  }
}

/** 0x10011d60 (kind 4): radius rippled by sin(k r) */
class Rings implements Kind {
  iR: number; f28 = 1; f2c = 1; k20: number; k1c: number; k24: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k20 = F(c.rand() * F(5.798516667709919e-06) + F(0.01));
    this.k1c = F(c.rand() * F(1.4496291669274797e-06) + F(0.0125));
    if (c.every(c.rdiv(3) + 1)) this.k1c = -this.k1c;
    if (c.every(c.rdiv(4) + 2)) this.f2c = 0;
    if (c.every(c.rdiv(3) + 2)) this.f28 = 0;
    if (this.f28 === 0) this.k1c = F(this.k1c * 0.5);
    this.k24 = F((c.rand() * F(4.577776417136192e-05) + F(0.05)) * F(Math.PI));
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0];
    p[A0] = p[A0] + lean(this.f28, this.f2c, this.R, this.iR, r, this.k1c);
    p[R0] = Math.sin(this.k24 * r) * this.k20 + r;
  }
}

/** 0x10011f00 (kind 12): radius drawn in by sin(n pi r), angle twisted */
class Coil implements Kind {
  iR: number; k1c: number; k20: number; k24: number; k28 = 0; f2c = 1; f30 = 1; f34 = 1; k3c: number; k40: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k1c = F(c.rand() * F(6.675923600596434e-07) + F(0.0125));
    this.k20 = F((c.rdiv(18) + 2) * F(Math.PI));
    this.k24 = F(this.k1c * 0.5 + F(0.003125));
    if (c.every(c.rdiv(3) + 2)) {
      this.k28 = F(c.rand() * 1.1444441053498947e-06 + F(0.0125));
      if (c.every(c.rdiv(3) + 1)) this.k28 = -this.k28;
      if (c.every(c.rdiv(4) + 2)) this.f30 = 0;
      if (c.every(c.rdiv(3) + 2)) this.f2c = 0;
    }
    this.f34 = c.every(c.rdiv(2) + 2) ? 1 : 0;
    this.k3c = F(c.rand() * 1.1444441053498947e-06 + F(0.0125));
    this.k40 = F(c.rand() * F(0.0002441480755805969) + 4);
  }
  map(x: number, y: number, p: Float32Array): void {
    const v = p[R0] - (Math.sin(this.k20 * p[R0]) * this.k24 + this.k1c);
    p[R0] = v;
    const k = this.f2c ? (this.f30 ? this.R - v : v) * this.iR * this.k28 : this.k28;
    let a = k + p[A0];
    if (this.f34) a = a - Math.sin(this.k40 * p[R0]) * this.k3c;
    p[A0] = a;
  }
}

/** 0x10012160 (kinds 2, 8, 15): radius shrunk by r^2, angle by cos(r)^n */
class Spiral implements Kind {
  iR: number; k28: number; n20: number; f4 = 1; k24: number; k2c: number; k30: number;
  constructor(c: Ctx, public R: number) {
    this.iR = F(1 / R);
    this.k28 = F(c.rand() * F(1.2207404324726667e-05) + F(0.1));
    if (!(c.tick & 1)) this.k28 = F(this.k28 * -1);
    this.n20 = c.rdiv(20) + 18;
    this.k24 = F(c.rand() * F(3.814813680946827e-06) + F(0.025));
    if (c.every(c.rdiv(5) + 2)) this.f4 = 0;
    this.k2c = F(c.rand() * F(1.1444441270214156e-06) + F(0.0125));
    this.k30 = F(c.rand() * F(0.0003662221133708954) + 4);
  }
  map(x: number, y: number, p: Float32Array): void {
    const r = p[R0];
    p[R0] = r - this.k24 * r * (this.iR * r);
    let a = p[A0] - Math.pow(Math.cos(p[R0]), this.n20) * this.k28;
    if (this.f4) a = a - Math.sin(this.k30 * p[R0]) * this.k2c;
    p[A0] = a;
  }
}

/** two kinds applied in an order fixed at birth (0x10010c30, 0x10011610, 0x100117c0) */
class Pair implements Kind {
  first: number;
  constructor(c: Ctx, public a: Kind, public b: Kind) { this.first = ~c.tick & 1; }
  map(x: number, y: number, p: Float32Array): void {
    if (this.first) { this.a.map(x, y, p); this.b.map(x, y, p); } else { this.b.map(x, y, p); this.a.map(x, y, p); }
  }
}

/** 0x10012630's switch: kind 1..23 */
function makeKind(c: Ctx, id: number, R: number): Kind {
  switch (id) {
    case 1: { const a = new Couple(c, R); return new Pair(c, a, new Spiral(c, R)); }
    case 2: case 8: case 15: return new Spiral(c, R);
    case 3: case 5: case 9: case 11: case 13: return new Couple(c, R);
    case 4: return new Rings(c, R);
    case 6: return new Waves(c, R);
    case 7: { const a = new Couple(c, R); return new Pair(c, a, new Coil(c, R)); }
    case 10: return new Swirl(c, R);
    case 12: return new Coil(c, R);
    case 14: return new Cross(c, R);
    case 16: return new Drift(c, R, true);
    case 17: return new Drift(c, R, false);
    case 18: { const a = new Ripple(c, R); a.off = 0; const b = new Spiral(c, R); b.f4 = 0; return new Pair(c, a, b); }
    case 19: return new Bulge(c, R);
    case 20: return new Pull(c, R, false);
    case 21: return new Pull(c, R, true);
    case 22: return new Lens(c, R);
    default: return new Ripple(c, R);
  }
}

export class Field {
  row = 0;               // +0x04
  next = 0;              // +0x08
  w: number; h: number;  // +0x0c +0x10
  hw: number; hh: number; // +0x14 +0x18
  stride: number;        // +0x1c
  cy = 0; cx = 0;        // +0x20 +0x24
  sx = 0; sy = 0;        // +0x28 +0x2c
  R = 0;                 // +0x34
  building = 0;          // +0x38
  maxFade = 4; fade = 0; // +0x3c +0x40
  /** +0x44 active, +0x48 building: per pixel the source byte offset (or -1) and 8.8 fractions x<<16|y */
  live: Int32Array; next2: Int32Array;
  kind: Kind | null = null;   // +0x4c
  deck: Deck;            // +0x50
  mover: Mover | null = null; // +0x54
  t = 0;                 // +0x58
  start: number;         // +0x5c
  moving = 0;            // +0x60
  private p = new Float32Array(2);

  constructor(public c: Ctx, w: number, h: number, stride: number) {
    this.start = c.tick;
    this.stride = stride;
    this.w = w; this.hw = w >> 1;
    this.h = h; this.hh = h >> 1;
    this.live = new Int32Array(w * h * 2 + 100);
    this.next2 = new Int32Array(w * h * 2 + 100);
    this.deck = new Deck(c, 23);
    this.update();
    while (this.building === 1) this.buildRow();
  }

  /** 0x10012630: every 14.5-18.5 s a new kind, scale and fade */
  update(): void {
    const c = this.c;
    this.t = F(((c.tick - this.start) >>> 0) * F(0.001));
    if ((c.tick >>> 0) < this.next || this.building === 1) return;
    const m = this.maxFade;
    let f = ftol(c.rand() * m * F(3.0518509447574615e-05));
    if ((f >>> 0) > (m >>> 0)) f = m;
    this.fade = f;
    let s = c.rand() * F(9.155552834272385e-05) + 1;
    this.sx = F(s / this.w); this.sy = F(s / this.h);
    if (c.every(c.rdiv(6) + 5)) {
      s = c.rand() * F(0.0002136295661330223) + 3;
      this.sx = F(s / this.w); this.sy = F(s / this.h);
    }
    if (!c.every(3)) { if (this.w < this.h) this.sy = this.sx; else this.sx = this.sy; }
    const a = this.hh * this.sy, b = this.hw * this.sx;
    this.R = F(Math.sqrt(b * b + a * a));
    this.cx = this.hw; this.cy = this.hh;
    this.kind = makeKind(c, this.deck.draw(), this.R);
    this.building = 1;
    this.row = 0;
    this.buildRow();
    this.next = c.at(c.rdiv(4000) + 0x38a4);
  }

  /** 0x10013190: one row of the next table; when all are done it becomes the live one */
  buildRow(): void {
    if (this.row >= this.h) {
      this.building = 0; this.row = 0;
      const t = this.live; this.live = this.next2; this.next2 = t;
      return;
    }
    const p = this.p, kind = this.kind!, tab = this.next2;
    const fy = F((this.row - this.cy) * this.sy);
    let o = this.w * this.row * 2;
    this.row++;
    for (let x = 0; this.w > x; x++, o += 2) {
      const fx = F((x - this.cx) * this.sx);
      p[A0] = Math.atan2(fy, fx);
      p[R0] = Math.sqrt(fx * fx + fy * fy);
      kind.map(fx, fy, p);
      const nx = F(Math.cos(p[A0]) * p[R0]);
      let ny = Math.sin(p[A0]) * p[R0];
      let ex = nx;
      if (nx === fx) ex = nx + this.sx;
      if (ny === fy) ny = ny + this.sy;
      this.entry(tab, o, F(ex / this.sx + this.cx), F(ny / this.sy + this.cy));
    }
  }

  /** 0x10013330 */
  private entry(tab: Int32Array, o: number, x: number, y: number): void {
    if (y < 0 || !(this.h > y) || x < 0 || !(this.w > x)) { tab[o] = -1; tab[o + 1] = 0; return; }
    const ix = ftol(x), iy = ftol(y);
    const fx = (ftol(x * 256) - ((ix & 0xff) << 8)) & 0xffff;
    const fy = (ftol(y * 256) - ((iy & 0xff) << 8)) & 0xffff;
    tab[o] = (Math.imul(this.stride, iy) + ix) << 2;
    tab[o + 1] = (fx << 16) | fy;
  }

  /** 0x100125f0 / 0x10013420: PixelTrip Motion on (a new random path) or off */
  setMotion(on: number): void {
    if (this.moving === on) return;
    this.moving = on;
    this.mover = null;
    if (on) this.newMover();
  }

  private newMover(): void {
    const c = this.c, m = new Mover(c);
    this.mover = m;
    m.mode = c.rdiv(5) + 1;
    if (m.mode === 2) m.mode = 3;
    m.speedMode = (c.rdiv(30) / 10) | 0;
    let ax = ftol((c.rand() * F(7.629627702954167e-07) + F(0.0175)) * this.w);
    let ay = ftol((c.rand() * F(7.629627702954167e-07) + F(0.0175)) * this.h);
    const n = ftol(c.rand() * F(0.00012207403779029846) + 1);
    if (c.every(n)) { if (ax < ay) ay = ax; else ax = ay; }
    m.ax = ax; m.ay = ay;
    m.cx = this.w >> 1; m.cy = this.h >> 1;
    m.setR(ftol(Math.sqrt(Math.imul(ay, ay) + Math.imul(ax, ax) | 0)));
    m.setX(this.w >> 1); m.setY(this.h >> 1);
    m.setSpeed(F(c.rand() * F(2.8992583338549593e-06) + F(0.0175)));
    m.phase = F(c.rand() * F(2.670369667612249e-07) + F(0.00875));
    if (c.bounce === 1) m.setSpeed(F(0.1125));
    const a = F(c.rand() * F(3.0213324862415902e-05) + 0.5);
    const b = F((c.rand() * 1.4496292001098666e-05 + 0.5) * a);
    m.fx = a; m.fy = b;
    if (!(c.tick & 1)) { m.fx = b; m.fy = a; }
    if (m.mode === 3) {
      m.setSpeed(F(m.phase * F(0.8)));
      m.phase = F(m.phase * F(0.8));
      m.k = c.rdiv(6) + 2;
    }
    if (c.bounce === 1) {
      let k = F((ay + ax) * 0.125);
      if (k < 2) k = 2;
      m.kick = F(m.kick * k);
    }
  }

  /** 0x10012dc0: next frame from the last through the live table (one more row of the next first) */
  apply(src: Int32Array, dst: Int32Array, beat: number): void {
    if (this.building === 1) this.buildRow();
    const w = this.w, h = this.h, tab = this.live, s4 = this.stride, fade = this.fade;
    if (this.mover) {
      const m = this.mover;
      m.update(beat);
      const ox = m.X, oy = m.Y, hx = w >> 1, hy = h >> 1;
      for (let y = 0; y < h; y++) {
        let sy = y - hy + oy;
        if (sy < 0) sy = -sy; else if (sy > h - 1) sy = h - 1 + (h - sy);
        let o = y * this.stride;
        for (let x = 0; x < w; x++, o++) {
          let sx = x - hx + ox;
          if (sx < 0) sx = -sx; else if (sx > w - 1) sx = w - 1 + (w - sx);
          const e = (Math.imul(sy, w * 2) + sx * 2) | 0;
          dst[o] = sample(src, tab[e], tab[e + 1], s4, fade, 0xffff);
        }
      }
      return;
    }
    for (let i = 0, n = w * h; i < n; i++) dst[i] = sample(src, tab[2 * i], tab[2 * i + 1], s4, fade, -1);
  }
}

/** 0x10012e00's per-pixel MMX: bilinear in 8.8 with 16-bit wrapping products, then a saturating fade of the RGB bytes.
 *  Four black neighbours give black; the moving version (0x10012f60) tests them after unpacking, so only their blue and
 *  green bytes (`zmask` 0xffff): a red-only patch goes black there. */
function sample(src: Int32Array, off: number, frac: number, stride: number, fade: number, zmask: number): number {
  if (off === -1) return 0;
  const i = off >> 2;
  const p00 = src[i], p01 = src[i + 1], p10 = src[i + stride], p11 = src[i + stride + 1];
  if (((p00 | p01 | p10 | p11) & zmask) === 0) return 0;
  const fx = frac >>> 16, fy = frac & 0xffff, wy = (0x100 - fy) & 0xffff;
  // per byte (the top one comes out 0): each row's (b - a) * fx + (a << 8) wrapped to 16 bits, their high bytes
  // weighted by the row fractions (the products stay under 2^16: fractions are 8.8) and added with unsigned saturation
  let a = p00 & 0xff, b = p01 & 0xff, c = p10 & 0xff, d = p11 & 0xff;
  let t = ((((b - a) & 0xffff) * fx + (a << 8)) & 0xffff) >>> 8, u = ((((d - c) & 0xffff) * fx + (c << 8)) & 0xffff) >>> 8;
  let v = t * wy + u * fy;
  let o = (v > 0xffff ? 0xff : v >>> 8) - fade;
  let out = o < 0 ? 0 : o;
  a = (p00 >>> 8) & 0xff; b = (p01 >>> 8) & 0xff; c = (p10 >>> 8) & 0xff; d = (p11 >>> 8) & 0xff;
  t = ((((b - a) & 0xffff) * fx + (a << 8)) & 0xffff) >>> 8; u = ((((d - c) & 0xffff) * fx + (c << 8)) & 0xffff) >>> 8;
  v = t * wy + u * fy;
  o = (v > 0xffff ? 0xff : v >>> 8) - fade;
  if (o > 0) out |= o << 8;
  a = (p00 >>> 16) & 0xff; b = (p01 >>> 16) & 0xff; c = (p10 >>> 16) & 0xff; d = (p11 >>> 16) & 0xff;
  t = ((((b - a) & 0xffff) * fx + (a << 8)) & 0xffff) >>> 8; u = ((((d - c) & 0xffff) * fx + (c << 8)) & 0xffff) >>> 8;
  v = t * wy + u * fy;
  o = (v > 0xffff ? 0xff : v >>> 8) - fade;
  if (o > 0) out |= o << 16;
  return out;
}
