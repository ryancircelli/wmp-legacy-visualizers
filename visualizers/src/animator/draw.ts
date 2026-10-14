// Animator 2.2's drawing half: the level analysis, the palette fade toward the theme colours and the ~24 drawing
// modes that put the music on the picture as thick stippled lines and dots (all in palette index 254) on top of
// the warp. Globals keep their DLL address: gXXXXX = 0x100XXXXX, tables as typed arrays of the same name.
//
// The engine owns a DrawState and a Draw and keeps these up to date (everything else is this file's):
//  - gad40c, gad410: the picture size, set before initTables() / createDib() (0x100136f3's start-up)
//  - g2d048 (setLevels): the TimedLevel copy, before levels() each frame
//  - g28fc0 (the drawing mode) and the style 0x1001339e picks: g28f68, gad420, g28fbc (= g28fb8), gad3d0, gad3d8
//    (reset to 0), gad3e8, gad3f4, g28f9c, g28fa0, g28fa4, gad400, gad404, gad444, gad3c0
//  - gad44c: the colour theme menu choice (2 and 9 change the fade), g28fc4, g28fd8, g28fdc: its own
// and reads back gad42c (stars() wanted), gad3c8 (drawMode(0x77) wanted) after the draw.
// Entry points, per frame in the DLL's order: levels() (0x1000f8d0); drawA() (0x10010150) or, for modes 1 and
// 15..19, drawB() (0x10012040); extra130a0() when gad404; stars() (0x1000feb0) when gad42c; drawMode(0x77) when
// gad3c8; drawMode(k) (0x10013597) for the blur style. Start-up: initTables() then createDib().
//
// x87: the DLL runs at 53-bit precision, so double arithmetic matches it; FSIN/FCOS results are 64-bit and are
// multiplied once (cosm/sinm: one rounding of m * the 64-bit value), _ftol truncates.
import type { TimedLevel } from '../ns';
import { Dib } from '../glass3d/dib';
import type { Lcg } from '../glass3d/lcg';
import { ftol, sincos87, mulExt } from '../glass3d/fpu';

/** 1/32767 as the DLL's double */
const RC = 3.051850947599719e-05;
const DEG = 0.005555555555555556, THIRD = 0.3333333333333333, SIXTIETH = 0.016666666666666666;
const COL = 0xfe;

export class DrawState {
  // ---- engine-owned (see the top) ----
  g28fc0 = 2; g28fc4 = 20; g28fd8 = -1; g28fdc = -1;
  g28f68 = 1; g28f9c = 32; g28fa0 = 7; g28fa4 = 7; g28fb8 = 30; g28fbc = 1;
  gad3c0 = 0; gad3d0 = 0; gad3e8 = 0; gad3f4 = 0; gad400 = 0; gad404 = 0; gad420 = 0; gad444 = 0; gad44c = 0;
  gad40c = 0; gad410 = 0;
  /** 0x1002d048: the TimedLevel copy: frequency[2][1024] then waveform[2][1024] */
  readonly g2d048 = new Uint8Array(4096);
  // ---- this file's ----
  g28fa8 = 750;
  g28fb0 = 3.141592653589793;
  g28f70 = 2; g28f78 = 7; g28f80 = 7; g28f90 = 0.1;
  gad3c4 = 0; gad3c8 = 0; gad3cc = 0; gad3d8 = 0; gad3e0 = 0; gad3f8 = 0; gad3fc = 0;
  gad408 = 0; gad414 = 0; gad418 = 0; gad41c = 0; gad424 = 0; gad428 = 0; gad42c = 0;
  gad430 = 0; gad434 = 0; gad438 = 0; gad43c = 0; gad440 = 0; gad448 = 0;
  g8cb70 = 0; g8cb74 = 0; g8cb78 = 0; g8cb7c = 0; g8cb80 = 0; g8cb84 = 0; g8cb88 = 0; g8cb8c = 0;
  g8cb90 = 0; g8cb94 = 0; g8cb98 = 0; g8cb9c = 0; g8cba0 = 0;
  g8c870 = 0; g8c874 = 0; g8c878 = 0; g8d3a8 = 0; g8d3ac = 0;
  g2d018 = 0; g8cfa4 = 0;
  /** 0x1006c868: the size scale (W + H) / 600 */
  g6c868 = 0;
  /** 0x1006c870: spectrum bands, 32 rows of 1024 ints (row g41c of the history; 0x1006c86c = g6c868's high word) */
  readonly g6c870 = new Int32Array(32 * 1024);
  /** 0x1008cfa8: the palette (BGRX) */
  readonly g8cfa8 = new Uint8Array(1024);
  /** 0x1002e058, 0x1004d460: 16001 rand()/32767 and its squares */
  readonly g2e058 = new Float64Array(16001);
  readonly g4d460 = new Float64Array(16001);
  /** 0x100993c0: 2048 stars (x, y, z), the first 1024 set at start-up */
  readonly g993c0 = new Float64Array(2048 * 3);
  /** 0x100a53c0: 64 (sin, cos) pairs, pair k + 3 = angle k * pi / 31 for k = -2..60 (pair 0 stays 0) */
  readonly ga53c0 = new Float64Array(128);
  /** 0x1008d3c0: 256 burst points (x, y, z) */
  readonly g8d3c0 = new Float64Array(256 * 3);

  /** the engine's copy of the TimedLevel into 0x1002d048 */
  setLevels(l: TimedLevel): void {
    const t = this.g2d048;
    t.set(l.freq[0], 0); t.set(l.freq[1], 1024); t.set(l.wave[0], 2048); t.set(l.wave[1], 3072);
  }
}

const SC = new Float64Array(4);
/** m * FCOS(a), m * FSIN(a): the 64-bit result times a double, one rounding */
function cosm(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[2], SC[3]); }
function sinm(a: number, m: number): number { sincos87(a, SC); return mulExt(m, SC[0], SC[1]); }
const i32 = new Int32Array(2), f64 = new Float64Array(i32.buffer);

export class Draw {
  dib!: Dib;
  constructor(readonly s: DrawState, readonly rng: Lcg) {}

  /** 0x1000f7f0 */
  rnd(n: number): number { return ftol(this.rng.rand() * n * RC); }

  private line(x0: number, y0: number, x1: number, y1: number): void { this.dib.line(x0, y0, x1, y1, COL); }
  private dot(x: number, y: number): void { this.dib.line(x, y, x, y, COL); }
  private pen(w: number, thr: number): void { this.dib.setBrush(w); this.dib.thresh = thr; }

  /** 0x1000fae0: n times the next square in the table */
  private fae0(n: number): number {
    const s = this.s, v = ftol(n * s.g4d460[s.gad424]);
    s.gad424 = (s.gad424 + 1) % 16001;
    return v;
  }
  /** 0x1000fb10: x times the next rand()/32767 in the table (left on the FPU) */
  private fb10(x: number): number {
    const s = this.s, v = x * s.g2e058[s.gad428];
    s.gad428 = (s.gad428 + 1) % 16001;
    return v;
  }
  private cos(p: number): number { return p < 0 ? 0 : this.s.ga53c0[2 * p + 1]; }
  private sin(p: number): number { return p < 0 ? 0 : this.s.ga53c0[2 * p]; }

  // ---- start-up --------------------------------------------------------------------------------------------------
  /** 0x1000f9e0, 0x1000f970, 0x1000fa50, 0x1000fab0 */
  initTables(): void {
    const s = this.s, W = s.gad40c, H = s.gad410;
    s.gad408 = 0x3f;
    s.g8cba0 = ((s.g28fa8 * 5 - 250) / 950 | 0) + 10;
    const c = s.g28fb0 * 0.03225806451612903, T = s.ga53c0;
    for (let k = -2; k <= 60; k++) {
      sincos87(k * c, SC);
      T[2 * (k + 3)] = SC[0] + SC[1]; T[2 * (k + 3) + 1] = SC[2] + SC[3];
    }
    const st = s.g993c0, r87 = (n: number): number => this.rng.rand() * n * RC;   // 0x1000f7d0
    for (let k = 0; k < 1024; k++) {
      st[3 * k] = r87(W) - (W / 2 | 0);
      st[3 * k + 1] = r87(H) - (H / 2 | 0);
      st[3 * k + 2] = r87(32);
    }
    for (let k = 0; k < 16001; k++) {
      const v = this.rng.rand() * RC;
      s.g4d460[k] = v * v;
      s.g2e058[k] = this.rng.rand() * RC;
    }
    s.gad424 = 0; s.gad428 = 0;
    s.gad430 = 500; s.gad434 = W / 2 | 0; s.gad438 = H / 2 | 0;
  }

  /** 0x1000f190: the DIB (65,536 rand()) and the black palette with a white 255 */
  createDib(): void {
    const s = this.s, p = s.g8cfa8;
    this.dib = new Dib(s.gad40c, s.gad410, this.rng);
    p.fill(0);
    p[1020] = p[1021] = p[1022] = 0xff;
    s.g8cfa4 = 0xffffff;
    this.dib.setPalette(p);
    s.g2d018 = 1;
  }

  // ---- per frame -------------------------------------------------------------------------------------------------
  /** 0x1000f8d0: loudness of the left waveform (and one byte past it) */
  levels(): void {
    const s = this.s, lv = s.g2d048;
    let sum = 0, mx = 0;
    for (let i = 0; i <= 0x400; i++) { const v = lv[0x800 + i]; if (v > mx) mx = v; sum += v; }
    const q = sum >> 10;
    s.g8cb70 = (q >> 3) * q;
    s.g8cb74 = (mx * mx) >> 3;
    const prev = s.gad414 + 1000;
    s.gad414 = s.g8cb74;
    s.gad418 = s.g8cb74 > prev ? 1 : 0;
    s.g6c868 = (s.gad410 + s.gad40c) * 0.0016666666666666668;
  }

  /** 0x1000f810: n bands of the left spectrum (averages less 1, times 16, clamped at 0) into g6c870[off..] */
  private bands(off: number, n: number): void {
    const s = this.s, lv = s.g2d048, t = s.g6c870, k = 1024 / n | 0;
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

  /** 0x1000fce0: the theme colours from 7 bands; sometimes starts a burst (0x1000fc30 -> 0x1000fb30) */
  private theme(): void {
    const s = this.s, t = s.g6c870;
    this.bands(0, 7);
    s.g8c870 = Math.imul(Math.max(t[0], t[1] / 2 | 0), 31);
    s.g8c874 = Math.imul(Math.max(t[2], t[3]), 31);
    s.g8c878 = Math.imul(Math.max(t[4], t[5], t[6]), 31);
    if (s.gad3d0 && !s.gad3c8 && s.g8cb74 > 6000 && s.gad418 && this.rnd(10) < 2) {
      this.burst();
      s.gad3c8 = 1;
    }
  }

  /** 0x1000fb30: 256 burst points on a disc, a random centre */
  private burst(): void {
    const s = this.s, W = s.gad40c, H = s.gad410, P = s.g28fb0 * 2000, b = s.g8d3c0;
    for (let k = 0; k < 256; k++) {
      const r = this.fae0((W < H ? W : H) / 2 | 0);
      const th = this.fb10(P) * 0.001;
      b[3 * k] = ftol(sinm(th, r));
      b[3 * k + 1] = ftol(cosm(th, r));
      b[3 * k + 2] = 7;
    }
    s.g8cb94 = this.rnd(W) - (W / 2 | 0);
    s.g8cb98 = this.rnd(H) - (H / 2 | 0);
    s.gad3cc = 0;
  }

  /** 0x1000fca0 */
  private fca0(v: number, i: number): number {
    const m = this.s.gad44c;
    if (m === 2) return i < 150 ? i : v < i ? v : i;
    if (m === 9) { const t = i * 20; return v < t ? v : t; }
    return v === 0 ? 0 : v - 1 < i ? v - 1 : i;          // 0x1000fc50
  }
  /** 0x1000fc70: step the top entry's channel b toward the theme byte a */
  private fc70(a: number, b: number): number {
    if (a <= b) return b === 0 ? 0 : b - 1;
    return b >= 0xff ? b : (this.s.g8cb78 + b) & 0xff;
  }
  /** the fade both draws open with: 8 times shift entries 1..254 down a slot (each channel capped by the slot
   *  number and darkened by 1) and move 254 toward the theme colour, then set the palette */
  private fade(): void {
    const s = this.s, p = s.g8cfa8, r = s.g8c870 & 0xff, g = s.g8c874 & 0xff, b = s.g8c878 & 0xff;
    for (let n = 0; n < 8; n++) {
      for (let i = 0; i < 254; i++) {
        p[4 * i] = this.fca0(p[4 * i + 4], i + 1);
        p[4 * i + 1] = this.fca0(p[4 * i + 5], i + 1);
        p[4 * i + 2] = this.fca0(p[4 * i + 6], i + 1);
      }
      p[1016] = this.fc70(b, p[1016]);
      p[1017] = this.fc70(g, p[1017]);
      p[1018] = this.fc70(r, p[1018]);
    }
    this.dib.setPalette(p);
  }

  /** 0x10013597: drawA() with the mode overridden (the blur styles and the burst, 0x77) */
  drawMode(mode: number): void {
    const s = this.s, m = s.g28fc0;
    s.g28fc0 = mode; s.gad3f8 = 1;
    this.drawA();
    s.gad3f8 = 0; s.g28fc0 = m;
  }

  /** 0x10010150: the main draw */
  drawA(): void {
    const s = this.s, t = s.g6c870, m = s.g28fc0, f = s.gad3f8;
    s.g8cb8c = 0;
    const g408a = ((s.g28fa8 - 50) << 7) / 950 | 0;
    let set = true;
    switch (m) {
      case 0: case 14: s.gad408 = 0x80; break;
      case 2: case 3: case 4: case 6: case 7: case 8: case 12: case 20: case 22: case 23:
        s.gad408 = f ? s.g28f9c : g408a + 15; break;
      case 5: s.gad408 = f ? s.g28f9c : 0x8f; break;
      case 9: case 10: case 11: s.gad408 = f ? s.g28f9c : 0x100; break;
      case 13: s.gad408 = g408a + 15; break;
      case 102: s.gad408 = s.g28f9c / 4 | 0; break;
      case 103: s.gad408 = s.g28f9c; break;
      case 119: s.gad408 = 0xff; break;
      default: set = false;
    }
    if (set) s.g8cba0 = 1;
    const W = s.gad40c, H = s.gad410;
    s.g8cb84 = W; s.g8cb80 = H; s.g8cb90 = H / 2 | 0; s.g8cb88 = W / 2 | 0;
    if (s.gad418) { s.g8cb7c = 2; s.g8cb78 = 4; } else { s.g8cb7c = 1; s.g8cb78 = 1; }
    if (!f) {
      if ((m >= 0 && m < 15) || m >= 20) { this.theme(); this.fade(); }
      if (m === 0 || m === 1 || m === 3 || m === 6 || m === 14 || m === 23) {
        this.bands(Math.imul(s.gad41c, 1024), s.gad408 * 2 + 2);
        const c = H / 2 | 0;
        s.g8cb8c = s.gad420 && s.g28f68 ? Math.imul(c / s.g28fb8 | 0, s.g28fbc) - c : Math.imul(-c / s.g28fb8 | 0, s.g28fbc);
      }
    }
    if (s.g28fbc > 0) s.g28fbc--;
    if (m === 4) this.wave();
    else if (m === 21) { this.ring(); const k = s.g8cb7c; s.g8cb7c = 1; this.ring(); s.g8cb7c = k; }
    else if (m !== 22) {
      for (let i = 1; i <= s.gad408; i++) {
        const row = s.gad41c < 0 ? s.gad41c + 1 + s.g8cba0 : s.gad41c;
        const K = s.g8cb7c, g868 = s.g6c868, pi = s.g28fb0, c88 = s.g8cb88, c90 = s.g8cb90;
        const sv = (pi + pi) / s.gad408;
        switch (m) {
          case 0: case 14: this.bars(row * 1024 + i, i); break;
          case 2: {
            this.pen(2, 0xffff);
            const tt = i * sv, Q = (Math.imul(s.g8cb74, s.g8cb74) / 100000 | 0) - 50;
            const R = (cosm(s.g28f70 * tt, 20) + Q) * g868 * K * 0.2, a = s.gad3d8 + tt;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            const t2 = (i + 1) * sv;
            const R2 = (cosm(s.g28f70 * t2, 20) + Q) * g868 * K * 0.2, a2 = s.gad3d8 + t2;
            this.line(x0, y0, ftol(cosm(a2, R2)) + c88, ftol(sinm(a2, R2)) + c90);
            break;
          }
          case 3: {
            this.pen(1, 0xffff);
            let A = ((t[row * 1024 + i] / 20 | 0) + 20) * g868;
            if (s.gad444) A *= K;
            const tt = i * sv, R = (A - 50) + cosm(s.g28f70 * tt, 20), a = s.gad3d8 + tt;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            const t2 = (i + 1) * sv, R2 = cosm(s.g28f70 * t2, 20) + A * THIRD, a2 = t2 + s.gad3d8;
            const y1 = ftol(sinm(a2, R2)) + c90;
            this.line(x0, y0, ftol(cosm(a2, R2)) + c88, y1);
            break;
          }
          case 5: {
            this.pen(2, 0xffff);
            const u = i * sv * 5.0, ip = 1.0 / pi, Q = (Math.imul(s.g8cb74, s.g8cb74) / 200000 | 0) - 50;
            const R = ((ftol(ip * u * 0.5) + u * 3.184713375796178) + Q) * g868 * K, a = s.gad3d8 + u;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            const t2 = (i + 1) * sv;
            const R2 = ((ftol(ip * t2 * 0.5) + t2 * 3.184713375796178) + Q) * g868 * K, a2 = s.gad3d8 + t2;
            const y1 = ftol(sinm(a2, R2)) + c90;
            this.line(x0, y0, ftol(cosm(a2, R2)) + c88, y1);
            break;
          }
          case 6: {
            this.pen(ftol((s.g8cb74 / 1000 | 0) * K * g868) + 1, 15000);
            const v = t[row * 1024 + i], u = sv * i * 3.0;
            const R = (((Math.imul(v, v) / 100000 | 0) * K * g868) + (3 * i / s.gad408 | 0)) + u * 11.146496815286623;
            const a = s.gad3d8 + u;
            this.dot(ftol(cosm(a, R)) + c88, ftol(sinm(a, R)) + c90);
            break;
          }
          case 7: case 20: {
            const q0 = m === 7 ? Math.imul(s.g8cb74, s.g8cb74) / 400000 | 0 : s.g8cb74 / 50 | 0;
            this.pen(ftol((s.g8cb74 / (m === 7 ? 2000 : 4000) | 0) * K * g868) + 1, 15000);
            const e = s.gad408 - i, u = (i - 1) * sv * 3.0;
            const R = (Math.imul(e + 1, q0) + u * 1.592356687898089) * g868 * K * SIXTIETH, a = s.gad3d8 + u;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            const q1 = m === 7 ? q0 : Math.imul(s.g8cb74, s.g8cb74) / 800000 | 0;
            const u2 = sv * i * 3.0;
            const R2 = (Math.imul(e, q1) + u2 * 1.592356687898089) * g868 * K * SIXTIETH, a2 = s.gad3d8 + u2;
            const y1 = ftol(sinm(a2, R2)) + c90;
            this.line(x0, y0, ftol(cosm(a2, R2)) + c88, y1);
            break;
          }
          case 8: {
            this.pen(ftol(((s.g8cb74 / 3000 | 0) * K + (s.g8cb74 / 1000 | 0)) * g868) + 1, s.gad418 ? 5000 : 15000);
            const x = this.rnd(s.g8cb84), y = this.rnd(s.g8cb80);
            this.dot(x, y);
            break;
          }
          case 9: case 10: case 11: this.star(i, m); break;
          case 12: {
            this.pen(2, 0xffff);
            const Q = (s.g8cb74 / 50 | 0) - 50, tt = i * sv;
            const R = (cosm(s.g28f78 * tt, 20) + Q) * g868 * K, a = s.gad3d8 + tt;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            if (s.g28f78 > 0) {
              const t2 = (i + 1) * sv, R2 = (cosm(s.g28f78 * t2, 20) + Q) * g868 * K, a2 = s.gad3d8 + t2;
              this.line(x0, y0, ftol(cosm(a2, R2)) + c88, ftol(sinm(a2, R2)) + c90);
            } else {
              this.pen(ftol((s.g8cb74 / 1000 | 0) * g868) + 1, 15000);
              this.dot(x0, y0);
            }
            break;
          }
          case 13: {
            this.pen(ftol((s.g8cb74 / 2000 | 0) * g868) + 1, 0xffff);
            const T = sv * i;
            const R = (cosm(s.g28f70 * T, 20) + ((s.g8cb74 / 50 | 0) - 50)) * K * g868, a = s.gad3d8 + T;
            this.dot(ftol(cosm(a, R)) + c88, ftol(sinm(a, R)) + c90);
            this.pen(Math.imul(s.g8cb74 / 1000 | 0, K) + 1, 5000);
            const R2 = (cosm(s.g28f80 * T, 20) + ((s.g8cb74 / 30 | 0) - 50)) * K * g868;
            this.dot(ftol(cosm(a, R2)) + c88, ftol(sinm(a, R2)) + c90);
            break;
          }
          case 23: {
            const K2 = Math.imul(K, K);
            this.pen(K2, 0xffff / K2 | 0);
            const tq = this.fae0(30);
            let A = (t[row * 1024 + i] / (tq + 20) | 0) * g868;
            if (s.gad444) A *= K;
            const P = this.fb10(pi);
            const tp = i * sv + P, R = (A - 50) + cosm(s.g28f70 * tp, 20), a = s.gad3d8 + tp;
            const x0 = ftol(cosm(a, R)) + c88, y0 = ftol(sinm(a, R)) + c90;
            const tp2 = P + (i + 1) * sv, R2 = cosm(s.g28f70 * tp2, 20) + A * THIRD, a2 = tp2 + s.gad3d8;
            const y1 = ftol(sinm(a2, R2)) + c90;
            this.line(x0, y0, ftol(cosm(a2, R2)) + c88, y1);
            break;
          }
          case 102: case 103: {
            if (s.gad400) this.pen(ftol((s.g8cb74 / 1000 | 0) * g868) + 1, 15000);
            else this.pen((Math.imul(s.g8cb80, 5) / 400 | 0) + 1, 0xffff);
            const a = Math.imul(Math.imul(s.g28fa4, i) + s.gad3fc, 2) * pi * 0.0009765625;
            const c200 = cosm(s.g28fa0 * a, 200);
            const x = c88 - ftol(cosm(a, c88) * g868 * c200 * -0.0019047619047619048);
            const y = c90 - ftol(sinm(a, c90) * g868 * c200 * -0.0019047619047619048);
            this.dot(x, y);
            break;
          }
          case 119: this.burstDot(i); break;
        }
      }
    }
    // the tail: wobble the parameters, turn the picture
    if (s.g8cb9c > s.gad408) s.g8cb9c = 0; else if (s.g8cb9c < 0) s.g8cb9c = s.gad408;
    if (this.rnd(1000) < 10) s.g28f70 = this.rnd(10) + 1;
    if (this.rnd(1000) < 10) s.g28f80 = this.rnd(10) + 1;
    s.g28f78 = this.rnd(10) + 1;
    if (this.rnd(1000) < 500) s.g28f78 = -s.g28f78;
    const e = s.g28f90 + s.gad3e0;
    s.gad3e0 = e;
    if (!(e < 2.0)) s.g28f90 = -0.1;
    if (e <= -2.0) s.g28f90 = 0.1;
    const pi2 = s.g28fb0 + s.g28fb0;
    switch (m) {
      case 3: case 12: case 13: case 23:
        s.gad3d8 = this.rnd(360) * s.g28fb0 * DEG; break;
      case 2: case 5: case 7: case 20: {
        const a = s.gad3d8 + (m === 2 || m === 5 ? 0.05 : 1.0);
        s.gad3d8 = a < pi2 ? a : 0;
        break;
      }
      case 6: case 102: case 103: {
        const a = s.gad3d8 - 1.0;
        s.gad3d8 = a < 0 ? pi2 : a;
        break;
      }
    }
    if (s.gad3f8 && ++s.gad3fc >= 0x400) s.gad3fc = 0;
    if (++s.gad41c > s.g8cba0) s.gad41c = 0;
  }

  /** modes 0 and 14: mirrored spectrum bars (two lines per band from the centre, or one each side) */
  private bars(base: number, i: number): void {
    const s = this.s, t = s.g6c870, H = s.gad410, K = s.g8cb7c, g868 = s.g6c868;
    if (this.rnd(5) === 0) this.pen(1, 0xffff);
    else this.pen(ftol((s.g8cb74 / 2000 | 0) * K * g868) + 1, s.gad418 ? 5000 : 15000);
    const h = (j: number): number => { const v = (t[j] / 50 | 0) * g868 * K; return ftol(v > 65535 ? 65535 : v); };
    const clamp = (v: number): number => v < 0 ? 0 : v > H ? H : v;
    const c90 = s.g8cb90, c8c = s.g8cb8c, dx = s.g8cb84 / s.gad408;
    const xa = ftol((i - 1) * dx), xb = ftol(i * dx);
    let h1 = h(base - 1);
    let y0 = clamp(c90 - h1 - c8c), y2 = clamp(h1 - c8c);
    let h2 = h(base);
    let y1 = c90 - h2 - c8c, y3 = h2 - c8c;
    if (y1 > H) y1 = H;
    if (y1 < 0) y0 = 0;                                // sic: the DLL zeroes the other end
    if (y3 > H) y3 = H; if (y3 < 0) y3 = 0;
    if (s.g28f68) { this.line(xa, y0, xb, y1); this.line(xa, y2, xb, y3); }
    else this.line(xb, (H / 2 | 0) - 8, xb, y1);
    h1 = h(base - 1);
    y0 = c90 + h1 + c8c; if (y0 > H) y0 = H; if (y0 < 0) y0 = 0;
    y2 = clamp(s.g8cb80 - h1 + c8c);
    h2 = h(base);
    y1 = c90 + h2 + c8c; y3 = s.g8cb80 - h2 + c8c;
    if (y1 > H) y1 = H;
    if (y1 < 0) y0 = 0;                                // sic
    if (y3 > H) y3 = H; if (y3 < 0) y3 = 0;
    if (s.g28f68) { this.line(xa, y0, xb, y1); this.line(xa, y2, xb, y3); }
    else this.line(xa, (H / 2 | 0) + 8, xa, y1);
  }

  /** modes 9, 10, 11: a star field flying out (9, 11) or in (10) */
  private star(i: number, m: number): void {
    const s = this.s, st = s.g993c0, o = 3 * i, W = s.gad40c, H = s.gad410, g868 = s.g6c868;
    const a = s.g8cb74 / 500 | 0;
    if (m === 9) this.pen(ftol(a / (st[o + 2] + 1.0) * g868) + 1, 0xffff);
    else this.pen(ftol(a / (st[o + 2] + 1.0) * s.g8cb7c * g868) + 1, s.gad418 ? 15000 : 0xffff);
    const zz = st[o + 2] + 1.0;
    let x = ftol(st[o] / zz * g868 + (W / 2 | 0)), y = ftol(st[o + 1] / zz * g868 + (H / 2 | 0));
    const z = m === 10 ? st[o + 2] + 0.5 : st[o + 2] - 0.5;
    st[o + 2] = z;
    if (m === 10 ? !(z < 16) : z <= 0) {
      st[o] = this.rnd(W) - (W / 2 | 0);
      st[o + 1] = this.rnd(H) - (H / 2 | 0);
      st[o + 2] = this.rnd(8) + (m === 10 ? 0 : 16);
      if (m === 10) this.pen(32, 2000); else if (m === 11) this.pen(32, 1000);
    } else if (m === 11 && z === 1.0) this.pen(10, 5000);
    if (x < 32) x = 32; if (x > W - 32) x = W - 32;
    if (y < 32) y = 32; if (y > H - 32) y = H - 32;
    this.dot(x, y);
  }

  /** mode 0x77: the burst's flash (while gad3cc counts down) or its points falling in */
  private burstDot(i: number): void {
    const s = this.s, W = s.gad40c, H = s.gad410, b = s.g8d3c0, o = 3 * i;
    let x: number, y: number;
    if (s.gad3cc > 0) {
      this.pen(16, (s.gad3cc / s.g28f9c | 0) << 8);
      s.gad3cc--;
      x = this.rnd(W); y = this.rnd(H);
      if (s.gad3cc <= 0) { s.gad3c8 = 0; s.gad3cc = 0; }
    } else {
      const z = b[o + 2];
      this.pen(ftol((s.g8cb74 / 1000 | 0) / (z * z + 1.0)) + 1, 15000);
      const zz = b[o + 2] + 1.0;
      x = ftol(b[o] / zz + (W / 2 | 0)) + s.g8cb94;
      y = ftol(b[o + 1] / zz + (H / 2 | 0)) + s.g8cb98;
      b[o + 2] -= 0.5;
    }
    if (b[o + 2] <= 0 && s.gad3cc === 0) s.gad3c8 = 0;
    if (x >= 32 && x <= W - 32 && y >= 32 && y <= H - 32) this.dot(x, y);
  }

  /** mode 4 (0x1000fdb0): the left waveform as a polyline */
  private wave(): void {
    const s = this.s, W = s.gad40c, H = s.gad410, lv = s.g2d048, hs = H * 0.00390625;
    this.pen(1, 0xffff);
    let px = 0, py = 0;
    if (W <= 1024) {
      for (let x = 0; x < W - 1; x++) { const y = ftol(hs * lv[0x801 + x]); this.line(px, py, x, y); px = x; py = y; }
    } else {
      for (let e = 0; e < 0x3ff; e++) {
        const x = Math.imul(W, e) / 1024 | 0, y = ftol(hs * lv[0x801 + e]);
        this.line(px, py, x, y); px = x; py = y;
      }
    }
  }

  /** mode 21's half (0x10010000): a new random centre and cb74 / 16 random dots on a disc around it */
  private ring(): void {
    const s = this.s, W = s.gad40c, H = s.gad410;
    s.gad42c = 1;
    s.gad434 = W - ftol(this.fb10(W));
    s.gad438 = H - ftol(this.fb10(H));
    const one = s.g8cb7c === 1;
    this.pen(one ? 1 : 2, one ? 0xffff : 16000);
    for (let e = 0; e < (s.g8cb74 / 16 | 0); e++) this.discDot(s.gad434, s.gad438);
  }

  private discDot(cx: number, cy: number): void {
    const s = this.s, W = s.gad40c, H = s.gad410;
    const r = this.fae0((W < H ? W : H) / 4 | 0), th = this.fb10(s.g28fb0 * 2000) * 0.001;
    const x = ftol(sinm(th, r)) + cx, y = ftol(cosm(th, r)) + cy;
    this.dot(x, y);
  }

  /** 0x1000feb0: the disc of dots the ring left, shrinking by 100 a frame from 1000 */
  stars(): void {
    const s = this.s, W = s.gad40c, H = s.gad410;
    if (s.gad430 <= 0 && s.gad418) {
      s.gad430 = 1000;
      s.gad43c = W - ftol(this.fb10(W));
      s.gad440 = H - ftol(this.fb10(H));
    }
    this.pen(1, 0xffff);
    for (let e = 0; e < s.gad430; e++) this.discDot(s.gad43c, s.gad440);
    s.gad430 -= 100;
    if (s.gad430 <= 0) s.gad42c = 0;
  }

  /** 0x10012040: the other draw, modes 1 and 15..19 (polar spectrum shapes) */
  drawB(): void {
    const s = this.s, t = s.g6c870, m = s.g28fc0, W = s.gad40c, H = s.gad410;
    const hh = H / 2 | 0, hw = W / 2 | 0;
    s.gad408 = 0x3f;
    s.g8cb7c = s.gad418 ? 2 : 1;
    this.theme(); this.fade();
    this.bands(0, s.gad408 * 2 + 2);
    for (let k = 0; k <= 5; k++) t[k] = t[k] / (3 - (k >> 1)) | 0;
    const g868 = s.g6c868;
    if (m === 1 || m === 15 || m === 16) {
      if (s.gad408 < 1) return;
      for (let j = 0; ;) {
        this.pen(2, 0xffff);
        const ix = j || s.gad408;
        if (m === 16 && this.rnd(1000) < 10) s.gad3c4 = s.gad3c4 ? 0 : 1;
        if (s.gad3c4 && t[ix] > 10) t[ix] = 10;
        if ((m === 15 || m === 1) && this.rnd(1000) < 50) t[j + 1] = t[j + 1] / 10 | 0;
        const A = t[ix] / 15 | 0, K = s.g8cb7c;
        let y0 = ftol(K * this.cos(ix) * A * g868 + hh); if (y0 < 0) y0 = 0;
        const x0 = ftol(K * this.sin(ix) * A * g868 + hw);
        const b = t[j + 1] / 15 | 0;
        let y1 = ftol(b * this.cos(j + 1) * K * g868 + hh); if (y1 < 0) y1 = 0;
        this.line(x0, y0, ftol(b * K * g868 * this.sin(j + 1) + hw), y1);
        if (++j + 1 > s.gad408) break;
      }
    } else if (m === 17) {
      for (let e = 1; e <= s.gad408; e++) {
        this.pen((Math.imul(s.g8cb74, s.g8cb74) / 600000 | 0) + 1, s.g8cb74);
        const A = t[e] / 15 | 0, K = s.g8cb7c;
        let y = ftol(A * this.cos(e) * K * g868 + hh); if (y < 0) y = 0;
        this.dot(ftol(A * this.sin(e) * K * g868 + hw), y);
      }
    } else if (m === 18) this.flower(hw, hh);
    else if (m === 19) {
      s.gad42c = 1;
      const cx = hw - this.rnd(W) + hw, cy = hh - this.rnd(H) + hh;
      if (s.gad408 >= 1) {
        for (let j = 0; ;) {
          this.pen(1, 0xffff);
          const ix = j || s.gad408;
          if (t[ix] > 10) t[ix] = 10;
          const K = s.g8cb7c, R = (t[ix] / 20 | 0) * K * g868;
          let y0 = ftol(R * this.cos(ix) + cy); if (y0 < 0) y0 = 0;
          const x0 = ftol(R * this.sin(ix) + cx);
          const R2 = (t[j + 1] / 20 | 0) * K * g868;
          let y1 = ftol(R2 * this.cos(j + 1) + cy); if (y1 < 0) y1 = 0;
          this.line(x0, y0, ftol(R2 * this.sin(j + 1) + cx), y1);
          if (++j + 1 > s.gad408) break;
        }
      }
      this.extra130a0();
    }
    // ponytail: mode 0x78's branch (a mode-19 variant) is unreachable (0x10013927 sends 0x78 to drawA), not ported
  }

  /** mode 18: a spinning band ring, then four mirrored copies around a wandering offset */
  private flower(hw: number, hh: number): void {
    const s = this.s, t = s.g6c870, g868 = s.g6c868;
    this.pen(1, 0xffff);
    for (let e = 1; e <= s.gad408; e++) {
      const K = s.g8cb7c, ia = e - 1 || s.gad408, base = 7 * (63 - s.gad448);
      const pa = (base + ia) % 63, R = ((t[ia] > 10 ? 10 : t[ia]) / 15 | 0) * K * g868 * 0.5;
      let y0 = ftol(R * this.cos(pa) + hh); if (y0 < 0) y0 = 0;
      const x0 = ftol(R * this.sin(pa) + hw);
      const pb = (base + e) % 63, R2 = (t[e] / 15 | 0) * K * g868 * 0.5;
      let y1 = ftol(R2 * this.cos(pb) + hh); if (y1 < 0) y1 = 0;
      this.line(x0, y0, ftol(R2 * this.sin(pb) + hw), y1);
    }
    const r1 = this.rnd(64);
    const r2 = this.rnd(hw / 5 | 0);
    const X = ftol(r2 + (hw - (Math.imul(s.g8cb74, hw) / 8000 | 0)) * this.sin(s.gad448));
    const r3 = this.rnd(hh / 5 | 0);
    const Y = ftol(r3 + (hh - (Math.imul(s.g8cb74, hh) / 8000 | 0)) * this.cos(s.gad448));
    s.gad448 = (s.gad448 + (s.g8cb7c === 1 ? 1 : 5)) % 63;
    for (let k = 0; k < 4; k++) {
      const ox = k === 0 ? X : k === 1 ? Y : k === 2 ? -X : -Y;
      const oy = k === 0 ? Y : k === 1 ? -X : k === 2 ? -Y : X;
      const cy = oy + hh, cx = ox + hw;
      for (let e = 1; e <= 64; e++) {
        const first = e <= 16;
        let a: number, pa: number;
        if (this.rnd(2) < (first ? 2 : 1)) { a = t[e] / 20 | 0; pa = ((first ? r1 : 0) + 4 * e) % 63; }
        else {
          const ix = e - 1 || s.gad408;
          a = (t[ix] > 100 ? 100 : t[ix]) / 15 | 0; pa = ((first ? r1 : 0) + 4 * ix) % 63;
        }
        const K = s.g8cb7c, R = a * K * g868 * 0.5;
        let y0 = ftol(R * this.cos(pa) + cy); if (y0 < 0) y0 = 0;
        const x0 = ftol(R * this.sin(pa) + cx);
        const pb = ((first ? r1 : 0) + 4 * e) % 63, R2 = (t[e] / 15 | 0) * K * g868 * 0.5;
        let y1 = ftol(R2 * this.cos(pb) + cy); if (y1 < 0) y1 = 0;
        this.line(x0, y0, ftol(R2 * this.sin(pb) + cx), y1);
      }
    }
  }

  /** 0x100130a0: a band burst (64 bands) around the last offset, then a new offset marked by a big dot */
  extra130a0(): void {
    const s = this.s, t = s.g6c870;
    if (s.g8cb7c === 1) return;
    if (this.rnd(2) !== 0 && s.gad42c === 0) { s.gad42c = 1; return; }
    const W = s.gad40c, H = s.gad410, hh = H / 2 | 0, hw = W / 2 | 0;
    this.bands(0, 64);
    for (let k = 0; k <= 5; k++) t[k] = t[k] / (3 - (k >> 1)) | 0;
    const r = this.rnd(64), S = s.g6c868 * 0.5;
    this.pen(1, 0xffff);
    const cy = hh - s.g8d3ac, cx = hw - s.g8d3a8;
    for (let e = 0; e <= 16; e++) {
      let a: number, pa: number;
      if (this.rnd(2) < 1) { const ix = e || 64; pa = (r + 4 * ix) % 63; a = t[ix] / 20 | 0; }
      else {
        const ix = (e - 1) || 64;
        pa = (r + 4 * ix) % 63;
        if (ix < 0) {
          // t[-1] is the high word of g6c868 (0x1006c86c): clamped to 100 in place like any band
          f64[0] = s.g6c868;
          if (i32[1] > 100) { i32[1] = 100; s.g6c868 = f64[0]; }
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
      this.line(x0, y0, ftol(b * this.sin(pb) * S + cx), y1);
    }
    s.g8d3a8 = hw - this.rnd(W);
    s.g8d3ac = hh - this.rnd(H);
    this.pen(32, 3000);
    this.dot(s.g8d3a8 + hw, s.g8d3ac + hh);
  }
}
