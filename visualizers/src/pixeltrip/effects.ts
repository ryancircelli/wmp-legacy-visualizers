// PixelTrip's effects: what the scene (scene.ts) draws over the transformed frame. Each is a C++ object built from the
// four parts in parts.ts; its vtable's draw (slot 2) gets the buffer, the two scaled waveforms, the two spectra and the
// beat level, and slot 3 says whether its time is up.
import { Ctx, F, ftol } from './ctx';
import { Mover, Palette, Pen, Spin } from './parts';

export abstract class Effect {
  m: Mover; spin: Spin; pal: Palette; pen = new Pen();
  doneAt = 0xffffffff;
  constructor(public c: Ctx) {
    this.m = new Mover(c);
    this.spin = new Spin(c);
    this.pal = new Palette(c);
  }
  /** vtable slot 3 */
  done(): boolean { return this.doneAt < (this.c.tick >>> 0); }
  /** vtable slot 1 (a no-op but for the idle effect) */
  tick(): void {}
  abstract draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void;
  /** the lifetime most effects start counting at their first draw: 12-36 s */
  protected life(): void {
    if (this.doneAt === 0xffffffff) this.doneAt = this.c.at(this.c.rdiv(24000) + 12000);
  }
}

/** the random path most effects ride (0x10007ac0, 0x100090f0, 0x1000ab20, 0x1000bc10 for a mode-1 effect) */
export function randomPath(c: Ctx, m: Mover, w: number, h: number, modeK: number, sp: number[], ph: number[], sp3: number[]): void {
  m.mode = ftol(c.rand() * modeK + 1);
  m.speedMode = ftol(c.rand() * F(0.0009155552834272385) * F(0.1));
  let ax = w >> 2, ay = h >> 2;
  let r = c.rand();
  ax = ax - ((Math.imul(r, ftol(ax * F(-0.75))) / 32767) | 0);
  r = c.rand();
  ay = ay - ((Math.imul(r, ftol(ay * F(-0.75))) / 32767) | 0);
  m.ax = ax; m.ay = ay;
  m.cx = w >> 1; m.cy = h >> 1;
  m.setR(ftol(Math.sqrt(Math.imul(ay, ay) + Math.imul(ax, ax) | 0)));
  m.setX(c.rdiv(ax) - (ax >> 1));
  m.setY(c.rdiv(ay) - (ay >> 1));
  m.setSpeed(F(c.rand() * sp[0] + sp[1]));
  m.phase = F(c.rand() * ph[0] + ph[1]);
  const a = F(c.rand() * F(3.0213324862415902e-05) + 0.5);
  const b = F((c.rand() * 1.4496292001098666e-05 + 0.5) * a);
  m.fx = a; m.fy = b;
  if (!(c.tick & 1)) { m.fx = b; m.fy = a; }
  if (m.mode === 2) { m.flag58 = c.tick & 1; m.step = F(c.rand() * F(3.814813680946827e-05) + 0.25); }
  if (m.mode === 3) { m.setSpeed(F(c.rand() * sp3[0] + sp3[1])); m.k = c.rdiv(6) + 2; }
}
export const SP = [F(2.5940732939488953e-06), F(0.015)], PH = [F(1.5259254837474145e-07), F(0.01)], SP3 = [F(4.2725915250230173e-07), F(0.01)];

/** a mode-0 effect stays at the centre */
export function stillPath(m: Mover, w: number, h: number): void {
  m.mode = 0; m.speedMode = 0;
  const ax = w >> 1, ay = h >> 1;
  m.ax = ax; m.ay = ay; m.cx = w >> 1; m.cy = h >> 1;
  m.setR(ftol(Math.sqrt(Math.imul(ay, ay) + Math.imul(ax, ax) | 0)));
  m.setX(0); m.setY(0); m.setSpeed(0); m.phase = 0;
}

/** 0x1000ab20 / 0x1000bc10's spin: rotation one way or the other, maybe a warp, maybe the m5/m6 wobble */
function waveSpin(c: Ctx, s: Spin, still: number): void {
  s.rotate = 1;
  s.setDir(~c.tick & 1);
  if (c.every(c.rdiv(3) + 1)) s.setDir(0);
  s.warp = 1;
  if (c.every(c.rdiv(4) + 3)) s.warp = 0;
  s.init(0);
  if (still === 0) { s.init(1); if (c.every(c.rdiv(3) + 2)) s.init(0); }
}

/** 0x100077e0: a small ring (or a disc on a beat) riding a random path; 3-9 at once */
export class Slot extends Effect {
  add = 0;
  constructor(c: Ctx, public w: number, public h: number, public stride: number) {
    super(c);
    this.pen.w = w; this.pen.h = h;
    randomPath(c, this.m, w, h, F(0.00015259254723787308), [F(3.280739747424377e-06), F(0.0175)],
      [F(5.035553840571083e-07), F(0.01)], [F(1.2207403869979316e-06), F(0.0175)]);
    this.pal.setMode(0, 0);
    if (c.every(c.rdiv(4) + 1)) this.add = 1;
  }
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    this.life();
    this.m.update(beat);
    this.pal.update();
    const col = this.pal.get();
    if (beat === 1) this.pen.disc(buf, this.stride, this.m.X, this.m.Y, 4, col);
    else this.pen.circle(buf, this.stride, this.m.X, this.m.Y, 4, col, this.add);
  }
}

/** 0x10008980 (and 0x100094e0, `flat`): a spinning 3-D grid of dots */
export class Grid extends Effect {
  mode = 0;            // +0x20c
  nx = 2; ny = 2; nz = 2;    // +0x1f4 +0x1f0 +0x1f8
  sx = 0; sy = 0; sz = 0;    // +0x1fc +0x200 +0x204
  bright = 0;          // +0x1ec
  spinBase = 0; spinAmp = 0; spinFreq = 0;  // +0x1cc +0x1d4 +0x1d8
  wobble = 1;          // +0x1d0
  invert = 0;          // +0x210
  constructor(c: Ctx, public w: number, public h: number, public stride: number, mode: number, flat: boolean) {
    super(c);
    this.init(mode);
    if (flat) {
      this.spin.init(0);
      this.spinBase = F(c.rand() * F(6.866664625704288e-05) + 0.25);
      this.wobble = 1;
      if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
      this.spinAmp = 0; this.spinFreq = 0;
      if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
    }
  }
  /** 0x10008dd0 */
  private init(mode: number): void {
    const c = this.c;
    this.mode = mode;
    const d = ftol(Math.sqrt(Math.imul(this.w, this.w) + Math.imul(this.h, this.h) | 0));
    let n: number, k: number, path = mode;
    if (mode === 1) {
      const df = F(d);
      n = ftol(c.rand() * (df * F(0.05)) * F(3.0518509447574615e-05) + df * F(0.07));
      k = ftol(n * F(0.1));
    } else {
      if (c.every(c.rdiv(3) + 2)) {
        const df = F(d);
        path = 1;   // the DLL writes 1 over its mode argument here, so this one rides a random path after all
        n = ftol(c.rand() * (df * F(0.2)) * F(3.0518509447574615e-05) + df * F(0.12));
      } else {
        const df = F(d * F(0.2));
        n = ftol(c.rand() * df * F(3.0518509447574615e-05) + df);
      }
      k = ftol(n * F(0.05));
    }
    this.sx = this.sy = this.sz = n;
    this.nx = k < 2 ? 2 : k; this.ny = k < 2 ? 2 : k; this.nz = k < 2 ? 2 : k;
    const total = Math.imul(Math.imul(this.nz, this.ny), this.nx);
    this.pal.setMode(ftol(c.rand() * F(0.00912503432482481) * F(0.01)), total);
    this.bright = 0;
    this.spinBase = F(c.rand() * F(6.866664625704288e-05) + 0.25);
    if (c.every(c.rdiv(4) + 1)) this.bright = 1;
    // 0x100090f0
    this.pen.w = this.w; this.pen.h = this.h;
    if (path === 1) randomPath(c, this.m, this.w, this.h, F(0.00015259254723787308), SP, PH, SP3);
    else stillPath(this.m, this.w, this.h);
    this.spin.rotate = 1;
    this.spin.setDir(~c.tick & 1);
    this.spin.init(1);
    if (this.spin.warpy === 1) this.spinBase = F(c.rand() * F(1.678518128755968e-05) + F(0.2));
    this.wobble = 1;
    if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
    this.spinAmp = 0; this.spinFreq = 0;
    if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
    this.invert = (c.tick >>> 0) % ((c.rdiv(3) + 1) >>> 0);
  }
  /** 0x10008b10 */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    const m = this.m, pal = this.pal;
    let col = 0;
    m.update(beat);
    pal.update();
    this.spin.turn(F(Math.sin(m.t * this.spinFreq) * this.spinAmp + this.spinBase));
    const pm = pal.mode;
    this.life();
    if (pm !== 1) col = pal.get();
    const dz = (((this.sz << 16) >>> 0) / (this.nz >>> 0)) >>> 0;
    const dy = (((this.sy << 16) >>> 0) / (this.ny >>> 0)) >>> 0;
    const dx = (((this.sx << 16) >>> 0) / (this.nx >>> 0)) >>> 0;
    const hy = this.sy >> 1, hx = this.sx >> 1;
    let r = beat === 1 ? 2 : 1;
    if (this.invert !== 0 && pm !== 1 && beat !== 0) { r = 1; col = ~col; }
    const p = this.pt;
    let az = 0;
    for (let iz = 0; iz < this.nz; iz++, az = (az + dz) >>> 0) {
      const zz = (az >>> 16) - (this.sz >> 1);
      let ay = 0;
      for (let iy = 0; iy < this.ny; iy++, ay = (ay + dy) >>> 0) {
        const yy = (ay >>> 16) - hy;
        let ax = 0;
        for (let ix = 0; ix < this.nx; ix++, ax = (ax + dx) >>> 0) {
          p[0] = zz; p[1] = yy; p[2] = (ax >>> 16) - hx;
          this.spin.apply(p, 1, 0);
          this.spin.apply(p, 2, 0);
          const X = p[2] + (m.X + p[0]) | 0, Y = p[1] + (m.Y + p[0]) | 0;
          if (pm === 1) col = pal.get();
          this.pen.disc(buf, this.stride, X, Y, r, col);
        }
      }
    }
  }
  private pt = new Int32Array(3);
}

/** 0x1000a0c0: a waveform drawn along a line through the mover (and, `cross`, a second one across it) */
export class Wave extends Effect {
  mode = 0;          // +0x20c
  add = 0;           // +0x1e4
  lines = 0;         // +0x1ec
  n = 0;             // +0x1f0
  breathe = 1;       // +0x1e8
  bAmp = 0; bFreq = 0;  // +0x1f4 +0x1f8
  spinBase = 0; spinAmp = 0; spinFreq = 0; wobble = 1;  // +0x1fc +0x204 +0x208 +0x200
  constructor(c: Ctx, public w: number, public h: number, public stride: number, mode: number,
              public cross = 0, public taper = 0) {
    super(c);
    this.init(mode);
  }
  /** 0x1000a860 */
  private init(mode: number): void {
    const c = this.c;
    this.mode = mode;
    this.add = 0;
    this.spinBase = F(c.rand() * F(6.866664625704288e-05) + 0.25);
    if (c.every(c.rdiv(3) + 1)) this.add = 1;
    this.lines = c.rdiv(100) & 1;
    const df = F(ftol(Math.sqrt(Math.imul(this.w, this.w) + Math.imul(this.h, this.h) | 0)));
    if (mode === 1) this.n = ftol(c.rand() * (df * F(0.1)) * F(3.0518509447574615e-05) + df * F(0.2));
    else this.n = ftol(c.rand() * (df * F(0.2)) * F(3.0518509447574615e-05) + df * F(0.6));
    this.breathe = 1;
    this.bAmp = F((c.rand() * F(6.103702162363334e-06) + F(0.2)) * this.n);
    this.bFreq = F(c.rand() * F(6.535843567689881e-05) + 1);
    if (c.every(ftol(c.rand() * F(9.155552834272385e-05) + 1))) this.breathe = 0;
    this.pal.setMode(ftol(c.rand() * F(0.00912503432482481) * F(0.01)), this.n);
    // 0x1000ab20
    this.pen.w = this.w; this.pen.h = this.h;
    if (mode === 1) randomPath(c, this.m, this.w, this.h, F(0.00015259254723787308), SP, PH, SP3);
    else stillPath(this.m, this.w, this.h);
    waveSpin(c, this.spin, this.breathe);
    if (this.spin.warpy === 1) this.spinBase = F(c.rand() * F(1.983703077712562e-05) + 0.25);
    this.wobble = 1;
    if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
    this.spinAmp = 0; this.spinFreq = 0;
    if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
  }
  /** 0x1000a290 */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    const m = this.m;
    m.update(beat);
    this.pal.update();
    this.spin.turn(F(Math.sin(this.spinFreq * m.t) * this.spinAmp + this.spinBase));
    this.life();
    let n = this.n;
    if (this.breathe === 1) n = ftol(Math.sin(this.bFreq * m.t) * this.bAmp + this.n);
    this.trace(buf, s0, beat, n, false);
    if (this.cross) this.trace(buf, s0, beat, n, true);
  }
  /** 0x1000a3a0 (along x) and 0x1000a600 (`down`: along y) */
  private trace(buf: Int32Array, s0: Int8Array, beat: number, n: number, down: boolean): void {
    const m = this.m, pal = this.pal, p = this.pt, X = down ? 1 : 0, Y = down ? 0 : 1;
    let col = 0, lines = this.lines, pm = pal.mode;
    if (pm !== 1) col = pal.get();
    const dv = this.mode === 1 ? 2 : 1;
    if (beat !== 0) {
      if (lines === 0) { if (pm === 2) col = 0xffffff; else lines = 1; }
      else { pm = 2; col = 0xffffff; }
    }
    const step = (0x4000000 / (n >>> 0)) >>> 0, hn = n >> 1;
    let acc = 0;
    p[X] = -hn; p[Y] = 0;
    this.spin.apply(p, 0, 1);
    let px = m.X + p[0] | 0, py = m.Y + p[1] | 0;
    for (let i = 0, j = hn; i < n; i++, j--) {
      const s = s0[acc >>> 16];
      const v = this.taper ? ftol(j / hn * s) : (s / dv) | 0;
      acc = (acc + step) >>> 0;
      if (pm === 1) col = pal.get();
      p[X] = i - hn; p[Y] = v;
      this.spin.apply(p, 0, 1);
      const x = p[0] + m.X | 0, y = p[1] + m.Y | 0;
      if (lines === 0) {
        if (this.add) this.pen.add(buf, this.stride, x, y, col); else this.pen.set(buf, this.stride, x, y, col);
      } else this.pen.line(buf, this.stride, x, y, px, py, col, this.add);
      px = x; py = y;
    }
  }
  private pt = new Int32Array(2);
}

/** 0x1000b240: the waveform bent round a ring about the mover (`mirror`: and a half-size copy inside it) */
export class Ring extends Effect {
  mode = 0;          // +0x204
  r0 = 0;            // +0x1f0
  breathe = 0; bAmp = 0; bFreq = 0;  // +0x1fc +0x1f4 +0x1f8
  lines = 0;         // +0x1ec
  n = 0x400;         // +0x1e4
  add = 0;           // +0x1d4
  mirror = 0; invert = 0;  // +0x1cc +0x1d0
  spinBase = 0; spinAmp = 0; spinFreq = 0; wobble = 1;  // +0x200 +0x20c +0x210 +0x208
  constructor(c: Ctx, public w: number, public h: number, public stride: number, mode: number, mirror = false) {
    super(c);
    this.init(mode);
    if (mirror) {
      this.mirror = 1; this.invert = 1;
      if (c.every(c.rdiv(4) + 1)) this.invert = 0;
      if (this.invert !== 0) { this.add = 0; if (c.every(c.rdiv(4) + 2)) this.add = 1; }
    }
  }
  /** 0x1000b8f0 */
  private init(mode: number): void {
    const c = this.c;
    this.breathe = 0; this.bFreq = 0; this.bAmp = 0;
    this.mode = mode;
    const df = F(ftol(Math.sqrt(Math.imul(this.w, this.w) + Math.imul(this.h, this.h) | 0)));
    const n = ftol(df / (c.rand() * F(3.0518509447574615e-05) + 3));
    if (mode === 1) {
      const k = F(n * F(0.2));
      this.r0 = ftol(c.rand() * k * F(3.0518509447574615e-05) + k);
    } else {
      this.r0 = n - c.rdiv(n >> 1);
      this.breathe = 1;
      const q = F((c.rand() * F(6.103702162363334e-06) + F(0.2)) * this.r0);
      this.bAmp = q;
      this.bFreq = F(c.rand() * F(8.81984960869886e-05) + 0.25);
      if (c.every(ftol(c.rand() * F(9.155552834272385e-05) + 1))) this.breathe = 0;
      if (this.breathe === 1) this.r0 -= ftol(q);
    }
    this.lines = c.rdiv(100) & 1;
    this.n = this.lines ? 0x3fc : 0x400;
    this.pal.setMode(ftol(c.rand() * F(0.00912503432482481) * F(0.01)), this.n);
    this.add = 0;
    this.spinBase = F(c.rand() * F(3.814813680946827e-05) + 0.25);
    if (c.every(c.rdiv(4) + 1)) this.add = 1;
    // 0x1000bc10
    this.pen.w = this.w; this.pen.h = this.h;
    if (mode === 1) randomPath(c, this.m, this.w, this.h, F(0.0001831110566854477), SP, PH, SP3);
    else stillPath(this.m, this.w, this.h);
    waveSpin(c, this.spin, this.breathe);
    if (this.spin.warpy === 1) this.spinBase = F(c.rand() * F(1.983703077712562e-05) + 0.25);
    this.wobble = 1;
    if (c.every(c.rdiv(5) + 2)) this.wobble = 0;
    this.spinAmp = 0; this.spinFreq = 0;
    if (this.wobble === 1) { this.spinAmp = F(this.spinBase * 0.5); this.spinFreq = F(c.rand() * F(6.535843567689881e-05) + 1); }
  }
  /** 0x1000b420 */
  draw(buf: Int32Array, s0: Int8Array, s1: Int8Array, f0: Uint8Array, f1: Uint8Array, beat: number): void {
    const m = this.m, pal = this.pal, p = this.pt, pen = this.pen, st = this.stride;
    let col = 0, lines = this.lines, n = this.n;
    m.update(beat);
    pal.update();
    this.spin.turn(F(Math.sin(this.spinFreq * m.t) * this.spinAmp + this.spinBase));
    let pm = pal.mode;
    this.life();
    if (pm !== 1) col = pal.get();
    const dv = this.mode === 1 ? 3 : 2;
    if (beat !== 0) {
      if (lines === 0) { if (pm === 2) col = 0xffffff; else { lines = 1; n = 0x400; } }
      else { pm = 2; col = 0xffffff; }
    }
    let rb = this.r0;
    if (this.breathe === 1) rb = ftol(Math.sin(this.bFreq * m.t) * this.bAmp + this.r0);
    const v0 = ((s0[0] / dv) | 0) + rb;
    p[0] = ftol(Math.cos(0) * v0); p[1] = ftol(Math.sin(0) * v0);
    this.spin.apply(p, 0, 1);
    const x0 = p[0] + m.X | 0, y0 = p[1] + m.Y | 0;
    let px = x0, py = y0, x = x0, y = y0;
    const mid = (v: number, o: number) => (o + v) >> 1;
    for (let i = 1; i < n; i++) {
      const a = i * F(0.006135923322290182);
      const v = ((s0[i] / dv) | 0) + rb;
      p[0] = ftol(Math.cos(a) * v); p[1] = ftol(Math.sin(a) * v);
      this.spin.apply(p, 0, 1);
      x = p[0] + m.X | 0; y = p[1] + m.Y | 0;
      if (pm === 1) col = pal.get();
      if (lines === 0) { if (this.add) pen.add(buf, st, x, y, col); else pen.set(buf, st, x, y, col); }
      else pen.line(buf, st, x, y, px, py, col, this.add);
      if (this.mirror) {
        const mx = mid(x, m.X), my = mid(y, m.Y), mpx = mid(px, m.X), mpy = mid(py, m.Y);
        const c2 = this.invert === 1 ? ~col & 0xffffff : col;
        if (lines === 0) { if (this.add) pen.add(buf, st, mx, my, c2); else pen.set(buf, st, mx, my, c2); }
        else pen.line(buf, st, mx, my, mpx, mpy, c2, this.add);
      }
      px = x; py = y;
    }
    if (lines === 1) {
      pen.line(buf, st, x, y, x0, y0, col, this.add);
      if (this.mirror) {
        const c2 = this.invert === 1 ? ~col & 0xffffff : col;
        pen.line(buf, st, mid(x, m.X), mid(y, m.Y), mid(x0, m.X), mid(y0, m.Y), c2, this.add);
      }
    }
  }
  private pt = new Int32Array(2);
}
