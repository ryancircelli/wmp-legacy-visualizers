// PixelTrip's globe, lattice and idle-trace effects (the rest are in effects.ts).
import { Ctx, F, ftol } from './ctx';
import { Effect, PH, SP, SP3, randomPath, stillPath } from './effects';

const PI_F = F(Math.PI), HALF_PI_F = F(Math.PI / 2), TWO_PI_F = F(2 * Math.PI), INV_PI_F = F(1 / Math.PI);
const even = (x: number) => ((x - (x >> 31)) >> 1) << 1;
const mid = (v: number, o: number) => (o + v) >> 1;

/** 0x1000dbb0: a wire globe of latitude circles about the mover (`mirror` 0x1000ec40: and a half-size copy;
 *  `zfirst`, `lines`: the 0x10009d60 / 0x1000ee50 families' flags) */
export class Globe extends Effect {
  mirror = 0; invert = 0; zfirst = 0; add = 0; lines = 0;   // +0x1cc +0x1d0 +0x1d4 +0x1d8 +0x1dc
  r0 = 0; bump = 0; latStep = 0; lonStep = 0; count = 0;    // +0x1f0 +0x1f4 +0x1f8 +0x1fc +0x200
  bAmp = 0; bFreq = 0; breathe = 0; mode = 0;               // +0x204 +0x208 +0x20c +0x214
  spinBase = 0; wobble = 1; spinAmp = 0; spinFreq = 0; flip = 0;  // +0x210 +0x218 +0x21c +0x220 +0x224
  private pt = new Int32Array(3);
  constructor(c: Ctx, public w: number, public h: number, public stride: number, mode: number,
              o: { mirror?: boolean, zfirst?: boolean, lines?: boolean } = {}) {
    super(c);
    this.init(mode);
    if (o.mirror) {
      this.mirror = 1; this.invert = 1;
      if (c.every(c.rdiv(4) + 1)) this.invert = 0;
      if (this.invert !== 0) { this.add = 0; if (c.every(c.rdiv(4) + 2)) this.add = 1; }
    }
    if (o.zfirst) this.zfirst = 1;
    if (o.lines) this.lines = 1;
  }
  /** 0x1000e340 */
  private init(mode: number): void {
    const c = this.c;
    this.breathe = 0; this.bFreq = 0; this.bAmp = 0;
    this.mode = mode;
    const df = F(ftol(Math.sqrt(Math.imul(this.w, this.w) + Math.imul(this.h, this.h) | 0)));
    const n = ftol(df / (c.rand() * F(3.0518509447574615e-05) + 2));
    let path = mode;
    if (mode === 1) {
      const fn = F(n);
      this.r0 = ftol(c.rand() * (fn * F(0.08)) * F(3.0518509447574615e-05) + fn * F(0.12));
    } else if (c.every(c.rdiv(3) + 2)) {
      path = 1;   // as in Grid, the DLL's register holding the mode becomes 1 on this branch
      const fn = F(n);
      this.r0 = ftol(c.rand() * (fn * F(0.2)) * F(3.0518509447574615e-05) + fn * F(0.12));
    } else {
      this.r0 = n - c.rdiv(n >> 1);
      this.breathe = 1;
      const q = F((c.rand() * F(3.051851081181667e-06) + F(0.2)) * this.r0);
      this.bAmp = q;
      this.bFreq = F(c.rand() * F(8.81984960869886e-05) + 0.25);
      if (c.every(ftol(c.rand() * F(9.155552834272385e-05) + 1))) this.breathe = 0;
      if (this.breathe === 1) this.r0 -= ftol(q);
    }
    this.bump = ftol(this.r0 * F(0.15));
    this.lines = 0;
    let nlon: number;
    if (path === 1) {
      this.latStep = F(PI_F / even(c.rdiv(10) + 8));
      nlon = even(c.rdiv(16) + 12);
    } else {
      this.latStep = F(PI_F / even(c.rdiv(18) + 14));
      nlon = even(c.rdiv(30) + 22);
    }
    this.lonStep = F(TWO_PI_F / nlon);
    this.count = ftol((this.latStep + PI_F) / this.latStep * ((this.lonStep + TWO_PI_F) / this.lonStep));
    this.pal.setMode(ftol(c.rand() * F(0.00912503432482481) * F(0.01)), this.count);
    this.add = 0;
    this.spinBase = F(c.rand() * F(3.814813680946827e-05) + 0.5);
    if (c.every(c.rdiv(4) + 1)) this.add = 1;
    // 0x1000e7f0
    this.pen.w = this.w; this.pen.h = this.h;
    if (path === 1) randomPath(c, this.m, this.w, this.h, F(0.00015259254723787308), SP, PH, SP3);
    else stillPath(this.m, this.w, this.h);
    const s = this.spin;
    s.rotate = 1;
    s.setDir(~c.tick & 1);
    s.init(0);
    if (this.breathe === 0) { s.init(1); if (c.every(c.rdiv(3) + 2)) s.init(0); }
    if (s.warpy === 1) this.spinBase = F(c.rand() * F(1.678518128755968e-05) + F(0.2));
    this.wobble = 1;
    if (c.every(c.rdiv(3) + 1)) this.wobble = 0;
    this.spinAmp = 0; this.spinFreq = 0;
    if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
    this.flip = (c.tick >>> 0) % ((c.rdiv(3) + 1) >>> 0);
  }
  /** one point of the globe (0x1000df1c / 0x1000e019): longitude `lon`, latitude cosine `cl`, height `z` */
  private point(lon: number, R: number, cl: number, z: number): void {
    const p = this.pt, m = this.m;
    p[0] = ftol(Math.cos(lon) * R * cl); p[1] = ftol(Math.sin(lon) * R * cl);
    p[2] = this.zfirst === 1 ? ftol(z * INV_PI_F) : z;
    this.spin.apply(p, 1, 2);
    this.spin.apply(p, 0, 2);
    if (this.zfirst === 0) p[2] = ftol(p[2] * INV_PI_F);
    p[0] = p[0] + (m.X + p[2]) | 0;
    p[1] = p[1] + (m.Y + p[2]) | 0;
  }
  /** 0x1000dd90 */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    const m = this.m, pal = this.pal, pen = this.pen, st = this.stride, p = this.pt;
    let col = 0;
    m.update(beat);
    pal.update();
    this.spin.turn(F(Math.sin(this.spinFreq * m.t) * this.spinAmp + this.spinBase));
    let pm = pal.mode;
    this.life();
    if (pm !== 1) col = pal.get();
    let R = this.r0;
    if (this.breathe === 1) R = ftol(Math.sin(this.bFreq * m.t) * this.bAmp + this.r0);
    if (beat !== 0 && this.lines === 1) {
      if (this.mirror) col = ~col & 0xffffff;
      else { pm = 2; col = 0xffffff; }
    }
    if (beat !== 0) R = R + this.bump | 0;
    let dot = beat === 1 ? 2 : 1;
    if (this.flip !== 0 && pm !== 1 && beat !== 0) { dot = 1; col = ~col; }
    const plot = (x: number, y: number, px: number, py: number, cc: number) => {
      if (this.lines === 1) pen.line(buf, st, x, y, px, py, cc, this.add);
      else pen.disc(buf, st, x, y, dot, cc);
    };
    let lon = F(-Math.PI), lat = F(-Math.PI / 2);
    for (;;) {
      const cl = Math.cos(lat);
      const z = ftol(Math.sin(lat) * R);
      this.point(lon, R, cl, z);
      const fx = p[0], fy = p[1];
      let px = fx, py = fy;
      lon = F(-Math.PI);
      for (;;) {
        this.point(lon, R, cl, z);
        const x = p[0], y = p[1];
        if (pm === 1) col = pal.get();
        if (this.mirror) {
          const c2 = this.invert === 1 ? ~col & 0xffffff : col;
          plot(mid(x, m.X), mid(y, m.Y), mid(px, m.X), mid(py, m.Y), c2);
        }
        plot(x, y, px, py, col);
        px = x; py = y;
        const v = lon + this.lonStep;
        lon = F(v);
        if (v > PI_F) break;
      }
      if (this.lines === 1) {
        pen.line(buf, st, px, py, fx, fy, col, this.add);
        if (this.mirror) {
          const c2 = this.invert === 1 ? ~col & 0xffffff : col;
          pen.line(buf, st, mid(px, m.X), mid(py, m.Y), mid(fx, m.X), mid(fy, m.Y), c2, this.add);
        }
      }
      const u = lat + this.latStep;
      lat = F(u);
      if (u > HALF_PI_F) break;
    }
  }
}

/** 0x1000ef40 (and 0x1000f9f0, `plain`): a flat grid of dots, square or the window's shape, spinning about the mover */
export class Lattice extends Effect {
  mode = 0;            // +0x204
  sx = 0; sy = 0;      // +0x1f8 +0x1fc
  nx = 2; ny = 2;      // +0x1f4 +0x1f0
  bright = 0;          // +0x1ec
  spinBase = 0; wobble = 1; spinAmp = 0; spinFreq = 0;  // +0x1cc +0x1d0 +0x1d4 +0x1d8
  private pt = new Int32Array(2);
  constructor(c: Ctx, public w: number, public h: number, public stride: number, mode: number, plain = false) {
    super(c);
    this.init(mode);
    if (plain) {
      this.spin.init(0);
      this.spin.warp = 0;
      this.wobble = 1;
      this.spinBase = F(c.rand() * F(6.866664625704288e-05) + 0.25);
      if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
      this.spinAmp = 0; this.spinFreq = 0;
      if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
    }
  }
  /** 0x1000f350 */
  private init(mode: number): void {
    const c = this.c;
    this.mode = mode;
    if (mode === 1) {
      const df = F(ftol(Math.sqrt(Math.imul(this.w, this.w) + Math.imul(this.h, this.h) | 0)));
      this.sx = this.sy = ftol(c.rand() * (df * F(0.1)) * F(3.0518509447574615e-05) + df * F(0.15));
    } else { this.sx = this.w; this.sy = this.h; }
    const kx = ftol(this.sx * F(0.05)), ky = ftol(this.sy * F(0.05));
    this.nx = kx < 2 ? 2 : kx; this.ny = ky < 2 ? 2 : ky;
    this.pal.setMode(ftol(c.rand() * F(0.00912503432482481) * F(0.01)), Math.imul(this.ny, this.nx));
    this.bright = 0;
    this.spinBase = F(c.rand() * F(6.866664625704288e-05) + 0.25);
    if (c.every(c.rdiv(4) + 1)) this.bright = 1;
    // 0x1000f5a0
    this.pen.w = this.w; this.pen.h = this.h;
    if (mode === 1) randomPath(c, this.m, this.w, this.h, F(0.00015259254723787308), SP, PH, SP3);
    else stillPath(this.m, this.w, this.h);
    const s = this.spin;
    s.rotate = 1;
    s.setDir(~c.tick & 1);
    if (c.every(c.rdiv(3) + 1)) s.setDir(0);
    s.warp = 1;
    if (c.every(c.rdiv(4) + 3)) s.warp = 0;
    s.init(1);
    if (s.warpy === 1) this.spinBase = F(c.rand() * F(1.678518128755968e-05) + F(0.2));
    this.wobble = 1;
    if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
    this.spinAmp = 0; this.spinFreq = 0;
    if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
  }
  /** 0x1000f0d0 */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    const m = this.m, pal = this.pal, p = this.pt;
    let col = 0;
    m.update(beat);
    pal.update();
    this.spin.turn(F(Math.sin(this.spinFreq * m.t) * this.spinAmp + this.spinBase));
    const pm = pal.mode;
    this.life();
    if (pm !== 1) col = pal.get();
    const dy = (((this.sy << 16) >>> 0) / (this.ny >>> 0)) >>> 0, hy = this.sy >> 1;
    const dx = (((this.sx << 16) >>> 0) / (this.nx >>> 0)) >>> 0, hx = this.sx >> 1;
    let ox = 0, oy = 0;
    if (this.mode === 0) { ox = ((this.w / this.ny) | 0) >> 1; oy = ((this.h / this.nx) | 0) >> 1; }
    const r = beat === 1 ? 2 : 1;
    let ay = 0;
    for (let iy = 0; iy < this.ny; iy++, ay = (ay + dy) >>> 0) {
      const y0 = (ay >>> 16) + oy - hy;
      let ax = 0;
      for (let ix = 0; ix < this.nx; ix++, ax = (ax + dx) >>> 0) {
        p[0] = (ax >>> 16) - hx + ox; p[1] = y0;
        this.spin.apply(p, 0, 1);
        const x = p[0] + m.X | 0, y = p[1] + m.Y | 0;
        if (pm === 1) col = pal.get();
        this.pen.disc(buf, this.stride, x, y, r, col);
      }
    }
  }
}

/** 0x1000fba0: the idle trace, the waveform straight across the window (or down it); up whenever nothing else is */
export class Idle extends Effect {
  twin = 0; add = 0; lines = 0; down: number;   // +0x1dc +0x1e4 +0x1e0 +0x1e8
  constructor(c: Ctx, public w: number, public h: number, public stride: number) {
    super(c);
    if (c.every(ftol(c.rand() * F(0.00015259254723787308) + 1))) this.twin = 1;
    if (c.every(ftol(c.rand() * F(0.00012207403779029846) + 1))) this.add = 1;
    this.lines = c.every(3) ? 1 : 0;
    this.down = ~c.tick & 1;
    // 0x100101a0
    this.pen.w = w; this.pen.h = h;
    this.m.mode = 0; this.m.speedMode = 0;
    this.pal.setMode(c.tick & 1 ? 2 : 0, 0);
  }
  /** vtable slot 1, 0x1000fdf0: its colour runs on every frame, drawn or not */
  tick(): void { this.pal.update(); }
  /** 0x1000fe00: 0x1000fe40 across, 0x1000fff0 down */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    this.life();
    const down = this.down !== 0, len = down ? this.h : this.w, span = down ? this.w : this.h;
    const step = (0x4000000 / (len >>> 0)) >>> 0;
    const col = beat !== 0 ? 0xffffff : this.pal.get();
    const col2 = this.pal.dim();
    const half = span >> 1, st = this.stride, pen = this.pen;
    let acc = 0, pa = down ? half : 0, pb = down ? 0 : half;   // the previous point, x and y
    for (let i = 0; i < len; i++) {
      const v = s0[len < 0x400 ? acc >>> 16 : i % 1024];
      acc = (acc + step) >>> 0;
      let q = half - v;
      if (q < 0) q = half;
      if (q > span - 1) q = half;
      const x = down ? q : i, y = down ? i : q;
      if (this.lines === 0) buf[Math.imul(st, pb) + pa] = col;
      else {
        pen.line(buf, st, pa, pb, x, y, col, this.add);
        if (this.twin) pen.line(buf, st, pa, pb + 1, x, y + 1, col2, this.add);
      }
      pa = x; pb = y;
    }
  }
}
