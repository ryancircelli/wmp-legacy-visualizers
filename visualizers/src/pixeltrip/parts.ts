// The parts every PixelTrip effect is built from (each effect object embeds all four, at +0, +0x68, +0x98, +0x1c0):
//  - Mover (0x100018d0): a point that travels one of six paths; also the transform field's motion (0x10013420).
//  - Spin (0x10001f30): a rotation (and optional warp) applied to an effect's own points.
//  - Palette (0x10007ed0): the effect's colour over time.
//  - Pen (0x10009690): plotting into the 32-bit buffer (set or MMX saturating add), lines, circles, discs.
import { Ctx, F, ftol, hsv } from './ctx';

const PI_F = F(Math.PI), RAD = F(Math.PI / 180), TWO_PI_F = F(2 * Math.PI);

export class Mover {
  t = 0;                     // +0x04 seconds since made
  mode = 0;                  // +0x08 path: 0 none, 1 Lissajous, 2 spiral, 3 rose, 4 and 5 tilted rose, 6 circles
  speedMode = 0;             // +0x0c 0 even, 1 faster inside, 2 faster outside
  ax = 0x140; ay = 200;      // +0x10 +0x14 half extents
  rmax = 0x179; rk = 0x140;  // +0x18 +0x1c
  cx = 0xa0; cy = 100;       // +0x20 +0x24
  px = 0; py = 0;            // +0x28 +0x2c last position
  phase = F(0.01);           // +0x34
  speed = F(0.01);           // +0x38
  fx = 0.5; fy = 0.25;       // +0x3c +0x40
  x = 0xa0; y = 100;         // +0x4c +0x50
  step = 1;                  // +0x54 spiral step
  flag58 = 1;                // +0x58
  k = 2;                     // +0x5c rose petals
  kick: number;              // +0x60 phase kick on a beat while bouncing (2.0 when bounce was on at birth)
  start: number;             // +0x64

  constructor(public c: Ctx) {
    this.start = c.tick;
    this.kick = c.bounce === 1 ? 2 : 0;
  }
  setR(r: number): void { this.rmax = r; this.rk = r - (r >> 2); }
  setX(v: number): void { this.px = v; this.x = v; }
  setY(v: number): void { this.py = v; this.y = v; }
  setSpeed(v: number): void { this.speed = v; }
  get X(): number { return (this.x + this.cx) | 0; }
  get Y(): number { return (this.y + this.cy) | 0; }

  /** 0x100019b0 */
  update(beat: number): void {
    this.t = F(((this.c.tick - this.start) >>> 0) * F(0.001));
    this.move(beat !== 0 && this.c.bounce === 1);
  }

  /** 0x10001a10 */
  private move(kick: boolean): void {
    if (this.mode === 0) return;
    const c = this.c;
    this.px = this.x; this.py = this.y;
    if (kick) this.phase = F(this.kick * this.speed + this.phase);
    else this.advance();
    const ph = this.phase;
    switch (this.mode) {
      case 6: {
        const a = (ph + this.t) * PI_F, h = this.ax >> 1;
        this.x = (ftol(Math.cos(a) * h + (this.ax >> 4)) + ftol(Math.cos(this.t) * this.ax)) | 0;
        this.y = (ftol(Math.sin(a) * h + (this.ay >> 4)) + ftol(Math.sin(this.t) * this.ay)) | 0;
        return;
      }
      case 3: {
        const r = Math.cos(this.k * ph) * this.rk;
        this.x = ftol(Math.cos(ph) * r); this.y = ftol(Math.sin(ph) * r);
        return;
      }
      case 1:
        this.x = ftol(Math.cos(this.fx * ph) * this.ax);
        this.y = ftol(Math.sin(this.fy * ph) * this.ay);
        return;
      case 5: {
        if (!(c.lazy & 1)) { c.lazy |= 1; c.g5 = F((c.rand() * F(0.010956144891679287) + 1) * F(0.01745329238474369)); }
        const r = Math.cos(ph) * this.rk, s = Math.sin(c.g5);
        this.x = ftol(Math.cos(s * ph) * r); this.y = ftol(Math.sin(s * ph) * r);
        return;
      }
      case 4: {
        if (!(c.lazy & 2)) { c.lazy |= 2; c.g4 = F((c.rand() * F(0.010956144891679287) + 1) * F(0.01745329238474369)); }
        if (!(c.lazy & 4)) { c.lazy |= 4; c.g4s = F(Math.sin(c.g4)); }
        if (!(c.lazy & 8)) { c.lazy |= 8; c.g4c = F(Math.cos(c.g4)); }
        const r = Math.cos(ph) * this.rk;
        this.x = ftol(Math.sin(c.g4c * ph) * r); this.y = ftol(Math.sin(c.g4s * ph) * r);
        return;
      }
      case 2: {
        const d2 = Math.imul(this.y, this.y) + Math.imul(this.x, this.x) | 0;
        if (!(c.lazy & 0x10)) { c.lazy |= 0x10; c.g2 = F(Math.sqrt(d2)); }
        const d = Math.sqrt(d2);
        if (d < this.step) { c.dir2 = 1; c.g2 = 1; } else if (d > this.rmax) { c.dir2 = -1; c.g2 = F(this.rmax); }
        c.g2 = F(c.dir2 * this.step + c.g2);
        this.x = ftol(Math.cos(ph) * c.g2); this.y = ftol(Math.sin(ph) * c.g2);
        return;
      }
    }
  }

  /** 0x10001ec0: the phase step, scaled by the distance from the centre in speed modes 1 and 2 */
  private advance(): void {
    let v = this.speed;
    if (this.speedMode !== 0) {
      const q = this.speed * 0.25;
      let d = Math.sqrt(Math.imul(this.x, this.x) + Math.imul(this.y, this.y) | 0);
      if (this.speedMode === 1) d = this.rmax - d;
      const r = q + d / this.rmax * (this.speed - q);
      if (r > 0) v = r;
    }
    this.phase = F(v + this.phase);
  }
}

export class Spin {
  speed = RAD;     // +0x04
  angle = 0;       // +0x08
  sin = 0;         // +0x0c
  cos = 0;         // +0x10
  m5 = 1; m6 = 1;  // +0x14 +0x18
  warpy = 0;       // +0x1c
  rotate = 0;      // +0x20
  warp = 0;        // +0x24
  dir = 1;         // +0x28

  constructor(public c: Ctx) { this.init(0); }

  /** 0x10001fd0 */
  init(flag: number): void {
    this.warpy = flag;
    if (flag === 0) { this.m5 = 1; this.m6 = 1; return; }
    const c = this.c;
    this.m5 = F(c.rand() * F(0.0004882961511611938) - 9 + 1);
    const m6 = c.rand() * F(0.0004882961511611938) - 9 + 1;
    if (Math.abs(this.m5) === Math.abs(m6)) this.m5 = F(this.m5 + 1);
    this.m6 = m6 === 0 ? 1 : F(m6);
    if (this.m5 === 0) this.m5 = 1;
  }
  /** 0x10002090 */
  setDir(d: number): void { this.dir = d; this.speed = d === 1 ? RAD : -RAD; }

  /** 0x100020b0 */
  turn(dt: number): void {
    const v = dt * this.speed + this.angle;
    this.angle = F(v);
    if (v < 0) { this.angle = 0; this.speed = F(this.speed * -1); }
    else if (v > TWO_PI_F) { this.angle = TWO_PI_F; this.speed = F(this.speed * -1); }
    this.cos = F(Math.cos(this.m5 * this.angle));
    this.sin = F(Math.sin(this.m6 * this.angle));
  }

  /** 0x10002110: rotate (and warp) an integer point in place; p = [x, y] */
  apply(p: Int32Array, ix: number, iy: number): void {
    let x = p[ix], y = p[iy];
    if (this.rotate === 1) {
      const fx = x, fy = y;
      x = ftol(fx * this.cos - fy * this.sin);
      y = ftol(fx * this.sin + fy * this.cos);
    }
    if (this.warp === 1) {
      const a = Math.cos(this.angle) * this.angle;
      x = ftol(Math.cos(a) * x);
      y = ftol(Math.sin(a) * y);
    }
    p[ix] = x; p[iy] = y;
  }
}

/** the 47 colours 0x10008740 picks from (0x10007ed0's table at +0x48; the white after them is never picked) */
const COLOURS = [
  0xe64000, 0xe66000, 0xdf4000, 0xdf8000, 0xe6df00, 0xe6af00, 0xe6a000, 0xdf, 0xe64000, 0xdf00, 0xdf0000, 0xdfdf00,
  0xe66000, 0xdf00df, 0xdfdf, 0x80df00, 0xdf4000, 0x80df, 0xdf0080, 0xdf80, 0xdf8000, 0x80dfdf, 0xdfdf80, 0xdf80df,
  0xe6df00, 0xdf4080, 0xdf4080, 0xdf8000, 0xe6af00, 0xdf8040, 0xdf8080, 0x80df80, 0xe6a000, 0xe67200, 0xe60072,
  0x72e600, 0xdf2000, 0xe672, 0x7200e6, 0x72e6, 0xe64000, 0xe66000, 0xdf4000, 0xdf8000, 0xe6df00, 0xe6af00, 0xe6a000,
];

export class Palette {
  mode = 0;                       // +0x04: 0 HSV wander, 1 a hue ramp stepped per point, 2 RGB wander
  start = 0;                      // +0x08
  cur = [0, 0, 0];                // +0x0c..0x14
  base = [0, 0, 0];               // +0x18..0x20
  t = 0;                          // +0x24
  amp = [0, 0, 0];                // +0x28..0x30
  freq = [0, 0, 0];               // +0x34..0x3c
  hues: Float32Array | null = null;  // +0x10c
  wobble = 0;                     // +0x110
  wAmp = 0; wFreq = 0; wOff = 0;  // +0x114 +0x118 +0x11c
  index = 0;                      // +0x120
  count = 0;                      // +0x124

  constructor(public c: Ctx) { this.pick(); }

  /** 0x10008740: a random HSV colour (one time in n, converted to RGB) or one of the 46, and its wander */
  pick(): void {
    const c = this.c;
    this.start = c.tick;
    const n = c.rdiv(4) + 1;
    const b = this.base;
    if (c.every(n)) {
      b[0] = F(c.rand() * F(0.0001916562468977645) * F(0.1592400074005127));
      b[1] = F(c.rand() * F(6.103702162363334e-06) + F(0.8));
      b[2] = F(c.rand() * F(6.103702162363334e-06) + F(0.8));
      hsv(b as [number, number, number]);
      this.cur[0] = b[0]; this.cur[1] = b[1]; this.cur[2] = b[2];
    } else {
      const col = COLOURS[c.rdiv(46)];
      for (let k = 0; k < 3; k++) b[k] = this.cur[k] = F(((col >> (16 - 8 * k)) & 0xff) * F(0.003921568859368563));
    }
    for (let k = 0; k < 3; k++) this.amp[k] = F((b[k] > 0.5 ? 1 - b[k] : b[k]) * 0.5);
    for (let k = 0; k < 3; k++) this.freq[k] = F(c.rand() * F(6.535843567689881e-05) + 1);
  }

  /** 0x100080e0 */
  setMode(mode: number, n: number): void {
    const c = this.c;
    this.mode = mode;
    this.count = n;
    if (mode === 2) { this.pick(); return; }
    if (mode === 1) {
      const inv = F(1 / n);
      this.hues = new Float32Array(n);
      for (let i = 0; i < n; i++) this.hues[i] = i * inv;
      this.wobble = 1;
      if (c.every(c.rdiv(5) + 3)) this.wobble = 0;
      this.wAmp = F(n >> 1);
      this.wFreq = F(c.rand() * F(6.535538705065846e-05) + 1);
      this.wOff = this.wobble === 1 ? n >> 1 : 0;
      return;
    }
    this.base[0] = this.cur[0] = 0.5;
    this.base[1] = this.cur[1] = 1;
    this.base[2] = this.cur[2] = 1;
    this.amp[0] = 0.5; this.amp[1] = 0; this.amp[2] = 0;
    this.freq[0] = F(c.rand() * F(3.814813680946827e-05) + 0.75);
    this.freq[1] = 0; this.freq[2] = 0;
  }

  /** 0x10008280 */
  update(): void {
    const t = ((this.c.tick - this.start) >>> 0) * F(0.001);
    this.t = F(t);
    this.index = 0;
    if (this.wobble === 1) this.index = ftol(Math.sin(t * this.wFreq) * this.wAmp + this.wOff);
    const cur = this.cur;
    const r = F(Math.sin(t * this.freq[0]) * this.amp[0] + this.base[0]);
    const g = F(Math.sin(t * this.freq[1]) * this.amp[1] + this.base[1]);
    const b = Math.sin(t * this.freq[2]) * this.amp[2] + this.base[2];
    cur[0] = r < 0 ? 0 : r > 1 ? 1 : r;
    cur[1] = g < 0 ? 0 : g > 1 ? 1 : g;
    cur[2] = b < 0 ? 0 : b > 1 ? 1 : F(b);
  }

  /** 0x100083c0: this point's colour as 0x00RRGGBB (mode 1 steps the ramp) */
  get(): number {
    const v = [0, 0, 0] as [number, number, number];
    if (this.mode === 1) {
      v[0] = this.hues![this.index % this.count]; v[1] = 1; v[2] = 1;
      hsv(v);
      this.index++;
      return ((ftol(v[0] * 255) & 0xff) << 16) | ((ftol(v[1] * 255) & 0xff) << 8) | (ftol(v[2] * 255) & 0xff);
    }
    v[0] = this.cur[0]; v[1] = this.cur[1]; v[2] = this.cur[2];
    if (this.mode === 0) hsv(v);
    return ((ftol(v[0] * 255) & 0xff) << 16) | ((ftol(v[1] * 255) & 0xff) << 8) | (ftol(v[2] * 255) & 0xff);
  }

  /** 0x10008520: mode 2 dimmed by 64 a channel, else get() */
  dim(): number {
    if (this.mode !== 2) return this.get();
    const ch = (k: number) => { const v = ftol(this.cur[k] * -255) * -1 - 64; return v < 0 ? 0 : v & 0xff; };
    return (ch(0) << 16) | (ch(1) << 8) | ch(2);
  }
}

/** 0x10009690: plots into a 32-bit buffer of `stride` pixels a row, clipped to w x h */
export class Pen {
  w = 0; h = 0;
  /** 0x10009840 */
  set(buf: Int32Array, stride: number, x: number, y: number, col: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    buf[stride * y + x] = col;
  }
  /** 0x10009880: MMX PADDUSB of all four bytes (MM0 is zero: the field's PXOR left it so) */
  add(buf: Int32Array, stride: number, x: number, y: number, col: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = stride * y + x, p = buf[i];
    let o = 0;
    for (let s = 0; s < 32; s += 8) {
      const v = ((p >>> s) & 0xff) + ((col >>> s) & 0xff);
      o |= (v > 0xff ? 0xff : v) << s;
    }
    buf[i] = o;
  }
  private plot(add: number, buf: Int32Array, stride: number, x: number, y: number, col: number): void {
    if (add) this.add(buf, stride, x, y, col); else this.set(buf, stride, x, y, col);
  }

  /** 0x100096f0: Bresenham from (x0, y0), not drawing it, to (x1, y1) */
  line(buf: Int32Array, stride: number, x0: number, y0: number, x1: number, y1: number, col: number, add: number): void {
    const dx = x1 - x0, dy = y1 - y0, ax = Math.abs(dx), ay = Math.abs(dy);
    const sx = dx < 0 ? -1 : dx > 0 ? 1 : 0, sy = dy < 0 ? -1 : dy > 0 ? 1 : 0;
    let x = x0, y = y0;
    if (ax >= ay) {
      let e = ax >> 1;
      for (let n = ax; n > 0; n--) {
        e += ay;
        if (e >= ax) { e -= ax; y += sy; }
        x += sx;
        this.plot(add, buf, stride, x, y, col);
      }
    } else {
      let e = ay >> 1;
      for (let n = ay; n > 0; n--) {
        e += ax;
        if (e >= ay) { e -= ay; x += sx; }
        y += sy;
        this.plot(add, buf, stride, x, y, col);
      }
    }
  }

  /** 0x100098e0: midpoint circle of radius r (its row test compares the column offset with the height, as the DLL does) */
  circle(buf: Int32Array, stride: number, cx: number, cy: number, r: number, col: number, add: number): void {
    if (r <= 0) return;
    if (r === 1) { this.set(buf, stride, cx, cy, col); return; }
    let d = 3 - 2 * r, rx = r;
    for (let i = 0; i <= rx; i++) {
      const rows = [cy + rx, cy - rx, cy + i, cy - i], cols = [i, i, rx, rx];
      for (let k = 0; k < 4; k++) {
        const y = rows[k];
        if (y < 0 || rx >= this.h) continue;
        const o = cols[k];
        if (cx - o >= 0 && cx - o < this.w) this.plot(add, buf, stride, cx - o, y, col);
        if (cx + o >= 0 && cx + o < this.w) this.plot(add, buf, stride, cx + o, y, col);
      }
      if (d < 0) d = d + i * 4 + 6;
      else { d = d + (i - rx) * 4 + 10; rx--; }
    }
  }

  /** 0x10009bc0: a disc of radius r as horizontal lines (each skipping its first pixel), always set */
  disc(buf: Int32Array, stride: number, cx: number, cy: number, r: number, col: number): void {
    if (this.w <= 0 || r < 0 || r >= this.h) return;
    let d = 3 - 2 * r, rx = r;
    for (let i = 0; i <= rx; i++) {
      const ys = [cy + rx, cy - rx], ys2 = [cy + i, cy - i];
      for (const y of ys) if (y >= 0 && rx < this.h) this.line(buf, stride, cx - i, y, cx + i, y, col, 0);
      for (const y of ys2) if (y >= 0 && rx < this.h) this.line(buf, stride, cx - rx, y, cx + rx, y, col, 0);
      if (d < 0) d = d + i * 4 + 6;
      else { d = d + (i - rx) * 4 + 10; rx--; }
    }
  }
}
