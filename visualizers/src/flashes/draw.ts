// Flashes 2.0's drawing half: the level analysis, the colour from the spectrum, the per-frame sparkle fade to black and
// the four drawing modes Flashes picks from (0x15 random clouds, 0x16 / 0x18 bouncing band particles, 0x17 a long
// burst), plus the extras a style can switch on (a band flower, a shrinking cloud, a falling burst). Globals keep their
// DLL address: gXXXXX = 0x100XXXXX. It is Animator's drawing code (animator/draw.ts) cut down and moved to a 16-bit
// x555 DIB: every dot and line takes the spectrum colour (r, g, b as 16-bit values) instead of a palette index.
//
// The engine owns the thread flags and calls, per frame in the DLL's order: levels() (0x10007e10); drawMode(0x16) when
// the style says so; drawA() (0x10008930); extraBc30() when ga17c4; cloud84a0() when ga17ec; drawMode(0x77) when
// ga1788. Start-up: initTables() then createDib(). pick() is the style for the next ~30 s (0x1000bf8e).
//
// x87: 53-bit precision, so double arithmetic matches; FSIN/FCOS results are 64-bit and multiplied once (cosm/sinm),
// _ftol truncates, `fstp float` is Math.fround (a Float32Array store).
import type { TimedLevel } from '../ns';
import { Dib } from '../glass3d/dib';
import type { Lcg } from '../glass3d/lcg';
import { ftol, sincos87, mulExt } from '../glass3d/fpu';

/** 1/32767 as the DLL's double and as its float */
const RC = 3.051850947599719e-05, RCF = 3.0518509447574615e-05;
const DEG = 0.005555555555555556, PI = 3.141592653589793;
/** 0x1001e454: the particles' bounce margin */
const B = 32;

const SC = new Float64Array(4);
/** m * FCOS(a), m * FSIN(a): the 64-bit result times a double, one rounding */
function cosm(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[2], SC[3]); }
function sinm(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[0], SC[1]); }
const i32 = new Int32Array(2), f64 = new Float64Array(i32.buffer);

/** 0x1000d8b0: the 16-bit pixel of the colour (r, g, b), each a 16-bit value */
const px555 = (r: number, g: number, b: number): number => ((r & 0xf800) >> 1) | ((g & 0xf800) >> 6) | ((b & 0xffff) >> 11);

// The particles: floats from 0x100203b0 (speed), 0x100203b4 (vy[255]), 0x100207b0 (vx[255]), 0x10020bac (y[255]),
// 0x10020fa8 (x[255]), then the int 0x100213a4 (the particle count), as one block: an index of 255 runs into the next.
const SPEED = 0, VY = 1, VX = 256, Y = 511, X = 766, NP = 1021;

export class Draw {
  dib!: Dib<Uint16Array>;
  // ---- engine-owned ----
  /** 0x100a17cc, 0x100a17d0: the picture size, set before initTables() / createDib() */
  ga17cc = 0; ga17d0 = 0;
  /** the drawing mode (2 until the first pick), the drawMode() flag, the style's switches */
  g1e4e8 = 2; ga17b8 = 0; g1e4f4 = 1; ga17c4 = 0; ga1790 = 0;
  /** 0x10021408: the TimedLevel copy: frequency[2][1024] then waveform[2][1024] */
  readonly g21408 = new Uint8Array(4096);
  // ---- this file's ----
  g1e498 = 2; g1e4a0 = 7; g1e4a8 = 7;
  ga1788 = 0; ga178c = 0; ga1798 = 0; ga17c8 = 0; ga17d4 = 0; ga17d8 = 0; ga17dc = 0; ga17e4 = 0; ga17e8 = 0;
  ga17ec = 0; ga17f0 = 0; ga17f4 = 0; ga17f8 = 0; ga17fc = 0; ga1800 = 0; ga1810 = 0; ga1814 = 0; ga1818 = 0;
  g1e4ec = 2; g1e4f0 = 1;
  g80f30 = 0; g80f34 = 0; g80f38 = 0; g80f3c = 0; g80f40 = 0; g80f44 = 0; g80f48 = 0; g80f50 = 0;
  g80f58 = 0; g80f5c = 0; g80f64 = 0;
  g81768 = 0; g8176c = 0;
  /** the colours: current (0x10021404 r, 0x10021400 g, 0x100213fc b), the burst's, the cloud's, mode 0x17's */
  g21404 = 0; g21400 = 0; g213fc = 0; g213f8 = 0; g213f4 = 0; g213f0 = 0;
  g213ec = 0; g213e8 = 0; g213e4 = 0; g213e0 = 0; g213dc = 0; g213d8 = 0;
  /** 0x10060c28: the size scale (W + H) / 600 */
  g60c28 = 0;
  /** 0x10060c30: spectrum bands, rows of 1024 ints (row ga17dc; 0x10060c2c = g60c28's high word) */
  readonly g60c30 = new Int32Array(16 * 1024);
  /** 0x10022418, 0x10041820: 16001 rand()/32767 and its cubes */
  readonly g22418 = new Float64Array(16001);
  readonly g41820 = new Float64Array(16001);
  /** 0x10099780: 64 (sin, cos) pairs, pair k + 3 = angle k * pi / 31 for k = -2..60 (pair 0 stays 0) */
  readonly g99780 = new Float64Array(128);
  /** 0x10081780: 256 burst points (x, y, z) */
  readonly g81780 = new Float64Array(256 * 3);
  private readonly pb = new ArrayBuffer(1022 * 4);
  private readonly pf = new Float32Array(this.pb);
  private readonly pi = new Int32Array(this.pb);

  constructor(readonly rng: Lcg) {}

  setLevels(l: TimedLevel): void {
    const t = this.g21408;
    t.set(l.freq[0], 0); t.set(l.freq[1], 1024); t.set(l.wave[0], 2048); t.set(l.wave[1], 3072);
  }

  /** 0x10007d20 */
  rnd(n: number): number { return ftol(this.rng.rand() * n * RC); }

  private pen(w: number, thr: number): void { this.dib.setBrush(w); this.dib.thresh = thr; }
  private dot(x: number, y: number, c: number): void { this.dib.line(x, y, x, y, c); }
  private colour(): number { return px555(this.g21404, this.g21400, this.g213fc); }

  /** 0x10008040: n times the next cube in the table */
  private fae0(n: number): number {
    const v = ftol(n * this.g41820[this.ga17e4]);
    this.ga17e4 = (this.ga17e4 + 1) % 16001;
    return v;
  }
  /** 0x10008070: x times the next rand()/32767 in the table (left on the FPU) */
  private fb10(x: number): number {
    const v = x * this.g22418[this.ga17e8];
    this.ga17e8 = (this.ga17e8 + 1) % 16001;
    return v;
  }
  private cos(p: number): number { return p < 0 ? 0 : this.g99780[2 * p + 1]; }
  private sin(p: number): number { return p < 0 ? 0 : this.g99780[2 * p]; }

  /** a dot of the current pen on a random point of the disc min(W, H) / 4 around (cx, cy) */
  private discDot(cx: number, cy: number, c: number): void {
    const W = this.ga17cc, H = this.ga17d0;
    const r = this.fae0((W < H ? W : H) / 4 | 0), i = this.ga17e8, th = this.fb10(PI * 2000) * 0.001, k = i * 4, sc = this.discSC;
    // the angle is one of the table's 16001: its FSIN/FCOS (a slow model in JS, ~200k a frame in the long burst) cached
    if (!this.discOk[i]) { sincos87(th, SC); sc.set(SC, k); this.discOk[i] = 1; }
    this.dot(ftol(mulExt(r, sc[k], sc[k + 1])) + cx, ftol(mulExt(r, sc[k + 2], sc[k + 3])) + cy, c);
  }
  private readonly discSC = new Float64Array(16001 * 4);
  private readonly discOk = new Uint8Array(16001);

  // ---- start-up --------------------------------------------------------------------------------------------------
  /** 0x10007f20, 0x10007eb0, 0x10007f90, 0x10007ff0, 0x100070e0 */
  initTables(): void {
    const W = this.ga17cc, H = this.ga17d0, rng = this.rng;
    this.ga17c8 = 0x3f;
    this.discOk.fill(0);
    this.g80f64 = ((750 * 5 - 250) / 950 | 0) + 10;
    const c = PI * 0.03225806451612903, T = this.g99780;
    for (let k = -2; k <= 60; k++) {
      sincos87(k * c, SC);
      T[2 * (k + 3)] = SC[0] + SC[1]; T[2 * (k + 3) + 1] = SC[2] + SC[3];
    }
    // ponytail: the 1024 stars (0x1008d780) only feed modes 9..11, which Flashes never picks: their rand()s are drawn, not kept
    for (let k = 0; k < 3 * 1024; k++) rng.rand();
    for (let k = 0; k < 16001; k++) {
      const v = rng.rand() * RC;
      this.g41820[k] = v * v * v;
      this.g22418[k] = rng.rand() * RC;
    }
    this.ga17e4 = 0; this.ga17e8 = 0;
    this.ga17f0 = 500; this.g1e4f0 = 1; this.ga17f4 = W / 2 | 0; this.ga17f8 = H / 2 | 0;
    this.g1e4ec = W > 1200 ? 3 : 2;
    // the particles on a disc around the centre, random velocities in [-1, 1)
    const n = W / 8 | 0, F = this.pf;
    this.pi[NP] = n < 0xff ? n : 0xff;
    for (let i = 0; i < 255; i++) {
      const r = this.fae0((W < H ? W : H) / 8 | 0), th = this.fb10(PI * 2000) * 0.001;
      F[X + i] = ftol(sinm(th, r)) + (W / 2 | 0);
      F[Y + i] = ftol(cosm(th, r)) + (H / 2 | 0);
      F[VX + i] = rng.rand() * 2 * RCF - 1;
      F[VY + i] = rng.rand() * 2 * RCF - 1;
    }
  }

  /** 0x10007070: the 16-bit DIB (65,536 rand()) */
  createDib(): void { this.dib = new Dib<Uint16Array>(this.ga17cc, this.ga17d0, this.rng, 16); }

  // ---- per frame -------------------------------------------------------------------------------------------------
  /** 0x10007e10: loudness of the left waveform (and one byte past it) */
  levels(): void {
    const lv = this.g21408;
    let sum = 0, mx = 0;
    for (let i = 0; i <= 0x400; i++) { const v = lv[0x800 + i]; if (v > mx) mx = v; sum += v; }
    const q = sum >> 10;
    this.g80f30 = (q >> 3) * q;
    this.g80f34 = (mx * mx) >> 3;
    this.ga17d8 = this.g80f34 > this.ga17d4 + 1000 ? 1 : 0;
    this.ga17d4 = this.g80f34;
    this.g60c28 = (this.ga17d0 + this.ga17cc) * 0.0016666666666666668;
  }

  /** 0x10007d40: n bands of the left spectrum (averages less 1, times 16, clamped at 0) into g60c30[off..] */
  private bands(off: number, n: number): void {
    const lv = this.g21408, t = this.g60c30, k = 1024 / n | 0;
    let start = 0;
    for (let i = 0; i < n; i++) {
      let acc = 0, c = 0;
      if (k >= 0) {
        let b = start;
        do { if (b > 0x3ff) break; acc += lv[start + c]; c++; b++; } while (c <= k);
      }
      const v = ftol(acc / c - 1) << 4;
      t[off + i] = v < 0 ? 0 : v;
      start += k;
    }
  }

  /** 0x10008260: the colour from 7 bands, the sparkle fade to black, and sometimes a burst (0x10008180) */
  private theme(): void {
    const t = this.g60c30, W = this.ga17cc, H = this.ga17d0;
    this.bands(0, 7);
    const r = Math.imul(Math.max(t[0], t[1] / 2 | 0), 31);
    const g = Math.imul(Math.max(t[2], t[3]), 31);
    const b = Math.imul(Math.max(t[4], t[5], t[6]), 31);
    this.g21404 = r * 4; this.g21400 = g * 4; this.g213fc = b * 4;
    this.ga1818 = r / 10 | 0;
    this.dib.sparkle([0, 0, W, H], 6000000 / (this.g80f34 + 1000) | 0);
    if (this.ga1790 && !this.ga1788 && this.g80f34 > 6000 && this.ga17d8 && this.rnd(10) < 2) {   // 0x10008180
      this.burst();
      this.ga1788 = 1;
      this.g213f8 = this.g21404; this.g213f4 = this.g21400; this.g213f0 = this.g213fc;
    }
  }

  /** 0x10008090: 256 burst points on a disc, a random centre */
  private burst(): void {
    const W = this.ga17cc, H = this.ga17d0, b = this.g81780;
    for (let k = 0; k < 256; k++) {
      const r = this.fae0((W < H ? W : H) / 2 | 0);
      const th = this.fb10(PI * 2000) * 0.001;
      b[3 * k] = ftol(sinm(th, r));
      b[3 * k + 1] = ftol(cosm(th, r));
      b[3 * k + 2] = 7;
    }
    this.g80f58 = this.rnd(W) - (W / 2 | 0);
    this.g80f5c = this.rnd(H) - (H / 2 | 0);
    this.ga178c = 0;
  }

  /** 0x1000c1a3: drawA() with the mode overridden (0x16 for the style's extra particles, 0x77 for the burst) */
  drawMode(mode: number): void {
    const m = this.g1e4e8;
    this.g1e4e8 = mode; this.ga17b8 = 1;
    this.drawA();
    this.ga17b8 = 0; this.g1e4e8 = m;
  }

  /** 0x10008930: the main draw. Flashes only ever reaches modes 2 (the first frames), 0x15..0x18 and 0x77; the rest
   *  of Animator's modes are still in the DLL but no pick or key leads to them, so they are not ported. */
  drawA(): void {
    const m = this.g1e4e8, f = this.ga17b8, W = this.ga17cc, H = this.ga17d0;
    let set = true;
    if (m === 2 || m === 0x16 || m === 0x17 || m === 0x18) this.ga17c8 = f ? 0x20 : (((750 - 50) << 7) / 950 | 0) + 15;
    else if (m === 0x77) this.ga17c8 = 0xff;
    else set = false;                                // 0x15
    if (set) this.g80f64 = 1;
    this.g80f44 = W; this.g80f40 = H; this.g80f50 = H / 2 | 0; this.g80f48 = W / 2 | 0;
    if (this.ga17d8) { this.ga1810 = 3; this.g80f3c = 2; this.g80f38 = 4; }
    else { if (this.ga1810 && !f) this.ga1810--; this.g80f3c = 1; this.g80f38 = 1; }
    if (!f) {
      this.theme();
      // mode 0x17's band history row (0x10080f4c, the row's offset, only feeds the unported bars)
      if (m === 0x17) this.bands(Math.imul(this.ga17dc, 1024), this.ga17c8 * 2 + 2);
    }
    switch (m) {
      case 0x15: { this.ring(); const k = this.g80f3c; this.g80f3c = 1; this.ring(); this.g80f3c = k; break; }
      case 0x16: this.particles(false); break;
      case 0x17: for (let k = this.ga1818 < 4000 ? 1 : 10; k > 0; k--) this.longBurst(); break;
      case 0x18: this.particles(true); break;
      default:
        for (let i = 1; i <= this.ga17c8; i++) {
          if (m === 2) this.spiral(i);
          else if (m === 0x77) this.burstDot(i);
        }
    }
    // the tail: wobble the parameters, turn the picture
    if (this.rnd(1000) < 10) this.g1e498 = this.rnd(10) + 1;
    if (this.rnd(1000) < 10) this.g1e4a8 = this.rnd(10) + 1;
    this.g1e4a0 = this.rnd(10) + 1;
    if (this.rnd(1000) < 500) this.g1e4a0 = -this.g1e4a0;
    if (m === 2) { const a = this.ga1798 + 0.05; this.ga1798 = a < PI + PI ? a : 0; }
    else if (m === 0x17) this.ga1798 = this.rnd(360) * PI * DEG;
    if (++this.ga17dc > this.g80f64) this.ga17dc = 0;
  }

  /** mode 2 (the first frames): a ring of lines whose radius follows the loudness */
  private spiral(i: number): void {
    this.pen(2, 0xffff);
    const sv = (PI + PI) / this.ga17c8, K = this.g80f3c, g868 = this.g60c28, c88 = this.g80f48, c90 = this.g80f50;
    const Q = (Math.imul(this.g80f34, this.g80f34) / 100000 | 0) - 50;
    const tt = i * sv, R = (cosm(this.g1e498 * tt, 20) + Q) * K * g868 * 0.2, a = tt + this.ga1798;
    const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
    const t2 = (i + 1) * sv, R2 = (cosm(this.g1e498 * t2, 20) + Q) * K * g868 * 0.2, a2 = t2 + this.ga1798;
    const y1 = ftol(sinm(a2, R2)) + c90;
    this.dib.line(x0, y0, ftol(cosm(a2, R2)) + c88, y1, this.colour());
  }

  /** mode 0x77: the burst's points falling in, in the colour it started with */
  private burstDot(i: number): void {
    const W = this.ga17cc, H = this.ga17d0, b = this.g81780, o = 3 * i;
    // ponytail: the DLL's flash branch (0x100a178c > 0) is dead: nothing sets that counter above 0
    const z = b[o + 2];
    this.pen(ftol((this.g80f34 / 1000 | 0) / (z * z + 1.0)) + 1, 15000);
    const zz = b[o + 2] + 1.0;
    const x = ftol(b[o] / zz + (W / 2 | 0)) + this.g80f58;
    const y = ftol(b[o + 1] / zz + (H / 2 | 0)) + this.g80f5c;
    b[o + 2] -= 0.5;
    if (b[o + 2] <= 0 && this.ga178c === 0) this.ga1788 = 0;
    if (x >= 32 && x <= W - 32 && y >= 32 && y <= H - 32) this.dot(x, y, px555(this.g213f8, this.g213f4, this.g213f0));
  }

  /** mode 0x15's half (0x100087d0): a new random centre and cb74 / 16 random dots on a disc around it */
  private ring(): void {
    const W = this.ga17cc, H = this.ga17d0;
    this.ga17ec = 1;
    this.ga17f4 = W - ftol(this.fb10(W));
    this.ga17f8 = H - ftol(this.fb10(H));
    this.pen(this.ga1810 ? this.g1e4ec : this.g1e4f0, this.g80f3c !== 1 ? 16000 : 0xffff);
    const c = this.colour();
    for (let e = 0; e < (this.g80f34 >> 4); e++) this.discDot(this.ga17f4, this.ga17f8, c);
  }

  /** modes 0x16 (0x100074b0) and 0x18 (0x10007690): a particle per band; a loud band moves its particle (and draws a
   *  cloud there), a quiet one puts it back (on a disc around the centre, or anywhere for 0x18) */
  private particles(anywhere: boolean): void {
    const f = this.ga17b8, W = this.ga17cc, H = this.ga17d0, t = this.g60c30, F = this.pf;
    const n = f ? 3 : this.pi[NP], lim = f ? 0x100 : 0x800;
    if (!f) this.ga17ec = 1;
    F[SPEED] = Math.imul(this.g80f34 / 50 | 0, this.g80f3c);
    this.bands(0, n);
    for (let i = 0; i < n && i <= 5; i++) t[i] = t[i] / (3 - (i >> 1)) | 0;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const thr = 2 * this.g80f34;
      if (t[i] > (thr < lim ? thr : lim)) { moved++; this.step(i); }
      else if (anywhere) { F[X + i] = this.rnd(W); F[Y + i] = this.rnd(H); }
      else {
        const r = this.fae0((W < H ? W : H) / 2 | 0), th = this.fb10(PI * 2000) * 0.001;
        F[X + i] = ftol(sinm(th, r)) + (W / 2 | 0);
        F[Y + i] = ftol(cosm(th, r)) + (H / 2 | 0);
      }
    }
    if (moved === 0) this.step(this.rnd(this.pi[NP]));
  }

  /** 0x10007270: move particle k, bouncing off the edges (with a velocity jitter), and draw a cloud around it */
  private step(k: number): void {
    const F = this.pf, W = this.ga17cc, H = this.ga17d0;
    const xd = F[SPEED] * F[VX + k] + F[X + k];
    F[X + k] = xd;
    if (xd - B < 0) { F[X + k] = B - xd; F[VX + k] = -F[VX + k]; this.jitter(VX + k); }
    else if (W - 1 < (B >> 1) + xd) { F[X + k] = ((W - xd) - B) + W + 1.0; F[VX + k] = -F[VX + k]; this.jitter(VX + k); }
    const yd = F[SPEED] * F[VY + k] + F[Y + k];
    F[Y + k] = yd;
    // sic: a bounce off the top or bottom jitters vx, not vy
    if (yd - (B >> 1) < 0) { F[Y + k] = B - yd; F[VY + k] = -F[VY + k]; this.jitter(VX + k); }
    else if (H - 1 < yd + B) { F[Y + k] = ((H - yd) - B) + H + 1.0; F[VY + k] = -F[VY + k]; this.jitter(VX + k); }
    const x = ftol(F[X + k]), y = ftol(F[Y + k]);
    this.pen(this.ga1810 ? this.g1e4ec : this.g1e4f0, 0xffff);
    const c = this.colour();
    for (let e = 0; e < (this.g80f34 >> 4); e++) this.discDot(x, y, c);
  }

  /** 0x10007230: v += rand() * 0.2 / 32767 - 0.1, clamped to [-1, 1] */
  private jitter(j: number): void {
    const F = this.pf, s = (this.rng.rand() * 6.1037018951994385e-06 - 0.1) + F[j];
    F[j] = s;
    if (s < -1) F[j] = -1;
    if (F[j] > 1) F[j] = 1;
  }

  /** mode 0x17 (0x10008650): a cloud that starts big at a random point and shrinks by 500 dots a frame */
  private longBurst(): void {
    const W = this.ga17cc, H = this.ga17d0, c = this.g80f34 > 1 ? this.g80f34 : 1;
    if (this.ga1814 === 0) {
      this.ga1814 = Math.imul(this.ga1818, 20) / c | 0;
      this.g213e0 = this.g21404; this.g213dc = this.g21400; this.g213d8 = this.g213fc;
      this.ga17fc = W - this.rnd(W);
      this.ga1800 = H - this.rnd(H);
    }
    this.pen(this.ga1810 ? this.g1e4ec : this.g1e4f0, 0xffff);
    // sic: a count that comes out 0 leaves 0x100a1814 counting down below 0, and the mode draws nothing from then on
    this.ga17f0 = Math.imul(this.ga1814, 500); this.ga1814 = (this.ga1814 - 1) | 0;
    const col = px555(this.g213e0, this.g213dc, this.g213d8);
    for (let e = 0; e < this.ga17f0; e++) this.discDot(this.ga17fc, this.ga1800, col);
  }

  /** 0x100084a0: the cloud the modes leave, shrinking by 100 dots a frame from cb74 / 4 + 200 */
  cloud84a0(): void {
    const W = this.ga17cc, H = this.ga17d0;
    if (!this.g1e4f4) { this.g213ec = this.g21404; this.g213e8 = this.g21400; this.g213e4 = this.g213fc; }
    if (this.ga17f0 <= 0 && this.ga17d8) {
      this.ga17f0 = (this.g80f34 / 4 | 0) + 200;
      this.ga17fc = W - ftol(this.fb10(W));
      this.ga1800 = H - ftol(this.fb10(H));
      this.g213ec = this.g21404; this.g213e8 = this.g21400; this.g213e4 = this.g213fc;
    }
    this.pen(1, 0xffff);
    const c = px555(this.g213ec, this.g213e8, this.g213e4);
    for (let e = 0; e < this.ga17f0; e++) this.discDot(this.ga17fc, this.ga1800, c);
    this.ga17f0 -= 100;
    if (this.ga17f0 <= 0) this.ga17ec = 0;
  }

  /** 0x1000bc30 (Animator's 0x100130a0): a band flower (64 bands) around the last offset, then a new offset marked by
   *  a big dot */
  extraBc30(): void {
    const t = this.g60c30;
    if (this.g80f3c === 1) return;
    if (this.rnd(2) !== 0 && this.ga17ec === 0) { this.ga17ec = 1; return; }
    const W = this.ga17cc, H = this.ga17d0, hh = H / 2 | 0, hw = W / 2 | 0, col = this.colour();
    this.bands(0, 64);
    for (let k = 0; k <= 5; k++) t[k] = t[k] / (3 - (k >> 1)) | 0;
    const r = this.rnd(64), S = this.g60c28 * 0.5;
    this.pen(1, 0xffff);
    const cy = hh - this.g8176c, cx = hw - this.g81768;
    for (let e = 0; e <= 16; e++) {
      let a: number, pa: number;
      if (this.rnd(2) < 1) { const ix = e || 64; pa = (r + 4 * ix) % 63; a = t[ix] / 20 | 0; }
      else {
        const ix = (e - 1) || 64;
        pa = (r + 4 * ix) % 63;
        if (ix < 0) {
          // t[-1] is the high word of g60c28 (0x10060c2c): clamped to 100 in place like any band
          f64[0] = this.g60c28;
          if (i32[1] > 100) { i32[1] = 100; this.g60c28 = f64[0]; }
          a = i32[1] / 15 | 0;
        } else {
          if (t[ix] > 100) t[ix] = 100;
          a = t[ix] / 15 | 0;
        }
      }
      let y0 = ftol(a * this.cos(pa) * S + cy); if (y0 < 0) y0 = 0;
      const x0 = ftol(a * this.sin(pa) * S + cx);
      const pb = (r + 4 * e) % 63, b = t[e] / 15 | 0;
      let y1 = ftol(b * this.cos(pb) * S + cy); if (y1 < 0) y1 = 0;
      this.dib.line(x0, y0, ftol(b * this.sin(pb) * S + cx), y1, col);
    }
    this.g81768 = hw - this.rnd(W);
    this.g8176c = hh - this.rnd(H);
    this.pen(32, 3000);
    this.dot(this.g81768 + hw, this.g8176c + hh, col);
  }
}
