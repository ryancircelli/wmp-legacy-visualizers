// Alchemy.Corona — "Phthalo's Corona" (Corona.dll, Richard Asbury, 2003-04; this is the 2004-12 build: a free third-party
// visualization for WMP 9 and 10, ported by its author from his Sonique plug-in). A "glowing particle storm": 2000+ particles
// fall, bounce, get kicked off the floor and swirled on beats, each drawn as a streak of colour 255 into an 8-bit buffer
// that every frame is (1) averaged with a slowly re-randomised displacement field and dimmed, (2) blurred, then shown
// through a 256-colour palette that drifts between 31 gradients. The bottom quarter mirrors the buffer's lowest rows
// through the same palette at 70%. Render 0x100079f0; the window's width, 4/5 of its height, two SetDIBitsToDevice.
//
//  - Corona (preset 0, string 103) and Blaze (preset 1, string 102: the streaks drawn three times, the last capped at
//    10 px, and a faster fade below 150,000 pixels).
//  - x87 at 53 bits: every + - * / sqrt is a double op. FSIN/FCOS/FPATAN/F2XM1 keep 64-bit results that the next op
//    rounds: ../plenoptic/x87's FSIN/FCOS model, and here FPATAN and F2XM1 the same way (double-double, then 64 bits).
//    The CPU's own FPATAN/FSIN/FCOS are not correctly rounded (about 1 result in 40 is a 64-bit ulp off, near a midpoint),
//    so now and then a particle's velocity differs in its last bit and the swarm's 10-particle mean spreads it: identical
//    to the DLL for 30,000 frames on music, for the first 4,000-11,000 on some other streams.
//  - msvcr70 rand (the LCG): 1000 particles and the field drawn from the thread's seed 1 in the constructor (0x10009660),
//    then srand(time(0)). `seed` is that time.
//  - Palettes: the DLL's built-in 31 (table 0x1000b768, loaded by 0x10008a30): it only reads CoronaPalettes.txt when
//    HKLM\...\MediaPlayer\VisualizationsDir is a REG_SZ, and today's Windows has a REG_EXPAND_SZ there.
import { A, type Surface, type TimedLevel } from '../ns';
import { ftol } from '../x86';
import { sincos87, mulExt } from '../plenoptic/x87';

declare module '../ns' {
  interface AlchemyNS {
    Corona: typeof Corona;
  }
}

const PRESET_NAMES: string[] = ['Corona', 'Blaze'];

/** the built-in palettes as waypoints (index, 0xRRGGBB): the colour at the index, linear from the previous waypoint
 *  (black at 0 before the first); after the last, its colour. Rows 14 and 15 also carry two (0, black) waypoints after
 *  index 256, which change nothing (left out). */
const PALETTES: readonly (readonly number[])[] = [
  [85, 0xff0000, 170, 0xffff00, 224, 0xffffff, 240, 0xf8f8e0], [85, 0x0000ff, 170, 0x00ffff, 256, 0xffffff], [256, 0xffffff],
  [128, 0xffffff, 256, 0x0000ff], [128, 0x808080, 256, 0x0000ff], [128, 0xffff80, 256, 0x0000ff], [128, 0xffffff, 256, 0xff0000],
  [128, 0x0000ff, 256, 0xff0000], [128, 0xff0000, 256, 0x0000ff], [128, 0x0000ff, 256, 0xffffff], [128, 0xffffff, 256, 0x000000],
  [128, 0x0000ff, 256, 0x000000], [128, 0xff0000, 256, 0x000000],
  [32, 0x0000ff, 64, 0x000000, 96, 0x0000ff, 128, 0x000000, 192, 0x0000ff, 256, 0x000000],
  [32, 0xffffff, 64, 0x000000, 96, 0xffffff, 128, 0x000000, 192, 0xffffff, 256, 0x000000],
  [0, 0x000020, 128, 0x000040, 256, 0xffffff], [128, 0xff8080, 256, 0x0000ff], [0, 0xffffff, 256, 0x000000],
  [0, 0xffffff, 128, 0x000000, 256, 0xffffff], [0, 0xffffff, 128, 0x000000, 256, 0xc0c0ff],
  [120, 0x000078, 128, 0xff0000, 136, 0x000088, 256, 0x0000ff], [0, 0xffe0a0, 256, 0x000000],
  [0, 0xc0c0ff, 128, 0xa0a0a0, 256, 0xffffff], [0, 0xbfa878, 160, 0x000000, 224, 0x0000ff, 255, 0x000000],
  [0, 0xffffff, 64, 0x000000, 96, 0xc0c0ff, 160, 0x000000, 216, 0xffe0a0, 224, 0xffffd8, 232, 0xffe0a0, 255, 0x000000],
  [85, 0xd45454, 128, 0xffc07f, 170, 0xd4d47f, 224, 0x9e9eff, 240, 0x8b8bef, 255, 0x7c7cef],
  [0, 0xffffff, 64, 0x3f3f3f, 96, 0x7f7f9f, 128, 0x30303f, 160, 0x181820, 224, 0xc8b8b0, 255, 0x60607f],
  [32, 0xaf7f7f, 64, 0x600000, 85, 0xd35353, 96, 0xff907f, 128, 0x7f4000, 170, 0xd3d353, 192, 0xffffb3, 224, 0xbebebe,
    240, 0x9a9a8e, 255, 0x7c7c70],
  [0, 0xffe0a0, 96, 0x9f8c64, 128, 0x9f4632, 176, 0x312319, 255, 0x000000], [0, 0xffffff, 128, 0x000000, 255, 0xffc0e0],
  [0, 0xffffff, 128, 0x808080, 160, 0x600000, 224, 0x000000],
];

const INV = 1 / 32767;                                   // rand() / 32767
const L2E_HI = 1.4426950408889634, L2E_LO = 2.0383000842727483e-17;   // FLDL2E: log2(e) to 64 bits
const LN2_HI = 0.6931471805599453, LN2_LO = 2.3190468138462996e-17;
const PIO2_HI = 1.5707963267948966, PIO2_LO = 6.123233995736766e-17;

// ---- double-double: the x87's 64-bit FPATAN and F2XM1 ---------------------------------------------------------------
const D = new Float64Array(2), E2 = new Float64Array(2), SC = new Float64Array(4);
function twoSum(a: number, b: number, o: Float64Array): void { const s = a + b, bb = s - a; o[0] = s; o[1] = (a - (s - bb)) + (b - bb); }
/** hi + lo rounded to a 64-bit mantissa, ties to even (x87 register precision) */
function round64(hi: number, lo: number, o: Float64Array): void {
  if (hi === 0 || lo === 0) { o[0] = hi; o[1] = lo; return; }
  let e = Math.floor(Math.log2(Math.abs(hi)));
  if (Math.pow(2, e) > Math.abs(hi)) e--;                      // log2 rounding at powers of two
  if (Math.abs(hi) === Math.pow(2, e) && (lo < 0) !== (hi < 0)) e--;
  const g = Math.pow(2, e - 63), q = lo / g;
  let n = Math.round(q);
  if (n - q === 0.5 && (n & 1)) n--;
  twoSum(hi, n * g, o);
}
/** sin and cos of the double x (|x| <~ 4) as double-doubles: [sh, sl, ch, cl] */
function ddSinCos(x: number, o: Float64Array): void {
  const k = Math.round(x / PIO2_HI);
  const p = k * PIO2_HI, pe = A.fma(k, PIO2_HI, -p);   // r = x - k pi/2 in double-double
  twoSum(x, -p, D); twoSum(D[0], D[1] - pe - k * PIO2_LO, D);
  const rh = D[0], rl = D[1], r2h = rh * rh, r2l = A.fma(rh, rh, -r2h) + 2 * rh * rl;
  // Horner, 14 terms each: s = 1 - r2/(2m(2m+1)) s, c = 1 - r2/((2m-1)2m) c, m = 14..1
  let sh = 1, sl = 0, ch = 1, cl = 0;
  for (let m = 14; m >= 1; m--) {
    sh = 1 - ddDiv(sh, sl, r2h, r2l, 2 * m * (2 * m + 1)); sl = -E2[1] + ((1 - sh) - E2[0]);
    ch = 1 - ddDiv(ch, cl, r2h, r2l, (2 * m - 1) * 2 * m); cl = -E2[1] + ((1 - ch) - E2[0]);
  }
  const th = sh * rh, tl = A.fma(sh, rh, -th) + sh * rl + sl * rh;
  twoSum(th, tl, D); sh = D[0]; sl = D[1];
  const q = ((k % 4) + 4) % 4;
  if (q === 0) { o[0] = sh; o[1] = sl; o[2] = ch; o[3] = cl; }
  else if (q === 1) { o[0] = ch; o[1] = cl; o[2] = -sh; o[3] = -sl; }
  else if (q === 2) { o[0] = -sh; o[1] = -sl; o[2] = -ch; o[3] = -cl; }
  else { o[0] = -ch; o[1] = -cl; o[2] = sh; o[3] = sl; }
}
/** (ah + al)(bh + bl) / d as a double-double in E2, its high part returned */
function ddDiv(ah: number, al: number, bh: number, bl: number, d: number): number {
  const ph = ah * bh, pl = A.fma(ah, bh, -ph) + ah * bl + al * bh, qh = ph / d;
  E2[0] = qh; E2[1] = (A.fma(-qh, d, ph) + pl) / d;
  return qh;
}
const DS = new Float64Array(4);
/** FPATAN (atan2(y, x)) to 64 bits as [hi, lo] in o: Math.atan2, then one Newton step on sin/cos in double-double */
function fpatan(y: number, x: number, o: Float64Array): void {
  const a0 = Math.atan2(y, x);
  if (y === 0 && x >= 0) { o[0] = a0; o[1] = 0; return; }
  ddSinCos(a0, DS);
  const p1 = y * DS[2], e1 = A.fma(y, DS[2], -p1), p2 = x * DS[0], e2 = A.fma(x, DS[0], -p2);
  const num = (p1 - p2) + ((e1 - e2) + (y * DS[3] - x * DS[1]));
  const den = x * DS[2] + y * DS[0];
  twoSum(a0, num / den, D);
  round64(D[0], D[1], o);
}
/** hi + lo + c rounded once to a double (the FADD of a 64-bit register and a double at 53 bits) */
function add3(hi: number, lo: number, c: number): number { twoSum(hi, c, D); return D[0] + (D[1] + lo); }
/** e^x as FLDL2E-scaled 2^t: FRNDINT (nearest even), F2XM1 to 64 bits, FLD1 FADDP (53), FSCALE */
function exp87(t: number): number {
  let k = Math.round(t);
  if (k - t === 0.5 && (k & 1)) k--;
  const f = t - k;
  if (f === 0) return Math.pow(2, k);
  // 2^f - 1 = expm1(f ln2) in double-double, Taylor (|f ln2| <= 0.35: 27 terms)
  const zh = f * LN2_HI, zl = A.fma(f, LN2_HI, -zh) + f * LN2_LO;
  let sh = 0, sl = 0;
  for (let n = 27; n >= 1; n--) {                          // s = z/1 (1 + z/2 (1 + z/3 (...)))
    twoSum(1, sh, D); const ah = D[0], al = D[1] + sl;      // 1 + s
    const ph = ah * zh, pl = A.fma(ah, zh, -ph) + ah * zl + al * zh;
    sh = ph / n; sl = (A.fma(-sh, n, ph) + pl) / n;
  }
  round64(sh, sl, E2);
  return add3(E2[0], E2[1], 1) * Math.pow(2, k);
}

export interface CoronaConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
  /** time(0) at creation: the srand seed */
  seed?: number;
}

class Corona {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  preset = 0;
  options: Record<string, unknown>;
  private winW: number;
  private winH: number;
  private px: Uint32Array;
  private hold = 1;
  // the buffer (obj+0x24): W x H bytes, rows `stride` apart, row 0 the bottom of the picture
  private W = 0;
  private H = -1;
  private stride = 0;
  private buf = new Uint8Array(0);
  private map = new Int32Array(0);                       // obj+0x60: per pixel, the buffer offset it averages with
  private p = new Float64Array(0);                       // particles: x, y, vx, vy
  private n = 0;
  private fx = 0; private fy = 0; private fk = 0; private fs = 0;   // the field: centre, twist, scale (obj+0x40..0x58)
  private countdown = 0; private vx0 = 0; private vy0 = 0; private strength = 0; private factor = 0;  // the swirl (+0x64..0x80)
  private pal = new Uint32Array(256);                    // bmi1's colours
  private pal2 = new Uint32Array(256);                   // bmi2's: 70%
  private old = new Uint32Array(256);                    // +0x88
  private target = new Uint32Array(256);                 // +0x488
  private next = 0;
  private fading = false;
  private t = 0;
  private avg = 1;                                       // +0x8b8
  private lastBeat = 0;                                  // +0x8c0
  private loud = 0;                                      // +0x8c8
  private frames = 0;

  constructor(cfg: CoronaConfig = {}) {
    this.winW = Math.max(32, cfg.width || 640); this.winH = Math.max(32, cfg.height || 480);
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.px = new Uint32Array(this.winW * this.winH);
    this.preset = cfg.preset === 1 ? 1 : 0;
    this.seed(cfg.seed ?? Math.floor(Date.now() / 1000));
  }

  private rand(): number { this.hold = (Math.imul(this.hold, 214013) + 2531011) | 0; return (this.hold >>> 16) & 0x7fff; }

  /** the constructor (0x10009660) and FinalConstruct (0x100075a0) again, srand(n) between them */
  seed(n: number): this {
    this.hold = 1;
    this.n = 1000; this.p = new Float64Array(4000);
    for (let i = 0; i < 4000; i += 4) { this.p[i] = this.rand() * INV; this.p[i + 1] = this.rand() * INV; }
    this.newField();
    this.hold = n | 0;
    this.newPalette();
    this.blend(1);
    this.fading = false;
    this.avg = 1; this.lastBeat = 0; this.loud = 0; this.countdown = 0;
    this.W = 0; this.H = -1;
    return this;
  }

  resize(w: number, h: number): void {
    w = Math.max(32, w | 0); h = Math.max(32, h | 0);
    if (w === this.winW && h === this.winH) return;
    this.winW = w; this.winH = h;
    this.px = new Uint32Array(w * h);
  }

  setPreset(n: number): boolean {
    if (n < 0 || n > 1) return false;
    this.preset = n | 0;
    return true;
  }

  /** 0x10005500 */
  private newField(): void {
    this.fx = this.rand() * 1.831110568559832e-05 + 0.2;
    this.fy = this.rand() * 1.831110568559832e-05 + 0.2;
    this.fk = this.rand() * 6.103701895199438e-07 - 0.01;
    this.fs = this.rand() * 1.2207403790398887e-06 + 1.0;
  }

  /** 0x10007360: fade from what is showing to a random palette */
  private newPalette(): void {
    this.old.set(this.pal);
    this.next = this.rand() % PALETTES.length;
    const wp = PALETTES[this.next], out = this.target;
    let i = 0, prev = 0;                                 // 0x100071e0
    for (let k = 0; k < wp.length; k += 2) {
      const idx = wp[k], c = wp[k + 1], n = idx - i;
      for (let j = 0; i < idx; i++, j++) {
        const t = j / n, u = 1 - t;
        out[i] = (ftol((c >> 16) * t + (prev >> 16) * u) << 16) | (ftol(((c >> 8) & 255) * t + ((prev >> 8) & 255) * u) << 8)
          | ftol((c & 255) * t + (prev & 255) * u);
      }
      prev = c;
    }
    for (; i < 256; i++) out[i] = prev;
    this.fading = true; this.t = 0;
  }

  /** 0x10005770: bmi1 = old (1-s) + target s per channel, bmi2 = 70% of it */
  private blend(s: number): void {
    const u = 1 - s;
    for (let i = 0; i < 256; i++) {
      const o = this.old[i], n = this.target[i];
      const r = ftol((o >> 16) * u + (n >> 16) * s), g = ftol(((o >> 8) & 255) * u + ((n >> 8) & 255) * s), b = ftol((o & 255) * u + (n & 255) * s);
      this.pal[i] = (r << 16) | (g << 8) | b;
      this.pal2[i] = (ftol(r * 0.7) << 16) | (ftol(g * 0.7) << 8) | ftol(b * 0.7);
    }
  }

  /** 0x10007800: new buffer, field and particle count for a W x H picture */
  private setup(W: number, H: number): void {
    this.W = W; this.H = H;
    this.stride = (W + 3) & ~3;
    this.buf = new Uint8Array(this.stride * H);
    this.map = new Int32Array(W * H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) this.mapAt(x, y);
    let n = ftol(Math.sqrt(W * H) * 3);
    if (n <= 2000) n = 2000;
    const p = new Float64Array(n * 4);
    p.set(this.p.subarray(0, Math.min(this.n, n) * 4));
    for (let i = this.n; i < n; i++) { p[i * 4] = this.rand() * INV; p[i * 4 + 1] = this.rand() * INV; }
    this.p = p; this.n = n;
  }

  /** 0x10005580: where pixel (x, y) takes its other half from: the field's swirl about its centre, scaled, plus -2..2
   *  at random, mirrored at the edges (the DLL's mirror: -(x + dx) as the new offset) */
  private mapAt(x: number, y: number): void {
    const W = this.W, H = this.H;
    const fx = x / W - this.fx, fy = y / H - this.fy, d2 = fy * fy + fx * fx, r = Math.sqrt(d2), q = this.fk / (d2 + 0.01);
    // ponytail: doubles first; the x87 models only when a product lands within 1e-7 of a whole number (truncation edge)
    let a = Math.atan2(fy, fx) + q;
    let vx = (Math.cos(a) * this.fs * r - fx) * W, vy = (Math.sin(a) * this.fs * r - fy) * H;
    if (Math.abs(vx - Math.round(vx)) < 1e-7 || Math.abs(vy - Math.round(vy)) < 1e-7) {
      fpatan(fy, fx, E2); a = add3(E2[0], E2[1], q);
      sincos87(a, SC);
      vx = (mulExt(this.fs, SC[2], SC[3]) * r - fx) * W; vy = (mulExt(this.fs, SC[0], SC[1]) * r - fy) * H;
    }
    let dx = this.rand() % 5 - 2 + ftol(vx);
    let dy = this.rand() % 5 - 2 + ftol(vy);
    if (dx + x < 0) dx = -(dx + x);
    if (dx + x >= W) dx = (W - x) * 2 - dx - 1;
    if (dy + y < 0) dy = -(dy + y);
    if (dy + y >= H) dy = (H - y) * 2 - dy - 1;
    this.map[W * y + x] = (dy + y) * this.stride + dx + x;
  }

  /** 0x10006020: the energy of bins 500-699 of the left channel when it beats (1.2x its running mean, 75 ms on), else 0 */
  private beat(f: Uint8Array, ts: number): number {
    let e = 0;
    for (let i = 500; i < 700; i++) e += f[i];
    this.avg = this.avg * 0.9 + e * 0.1;
    if (this.avg < 3000) this.avg = 3000;
    if (!(e > this.avg * 1.2) || Math.abs(ts - this.lastBeat) <= 750000) return 0;
    this.avg = e; this.lastBeat = ts;
    return e > 7500 ? 7500 : e;
  }

  render(level: TimedLevel): Surface | null {
    const H = ((this.winH * 4) / 5) | 0;
    if (this.winW !== this.W || H !== this.H) this.setup(this.winW, H);
    if (level.state !== 1) { this.step(level); this.draw(); }
    this.blit();
    this.frames++;
    return { w: this.winW, h: this.winH, px: this.px };
  }

  /** Render up to the drawing: beats, particles, field, palette */
  private step(level: TimedLevel): void {
    const P = this.p, N = this.n * 4, f = level.freq[0], ts = level.timeStamp;
    if (this.beat(f, ts) > 3000) {
      let s = 0;
      for (let i = 0; i < 1024; i++) s += f[i];
      this.loud = ((1 - exp87(mulExt(-s * 2.5e-5, L2E_HI, L2E_LO))) + this.loud) * 0.5;
      let cx = 0, cy = 0;                                // 0x10006ba0: the mean of 10 random particles
      for (let k = 0; k < 10; k++) { const i = (this.rand() % this.n) * 4; cx = P[i] + cx; cy = P[i + 1] + cy; }
      cx *= 0.1; cy *= 0.1;
      if (cy < 0.2 && this.rand() % 4 !== 0) {
        // a bump: the particles on the floor kicked up, a Gaussian about cx as wide as the sound is loud
        const w = this.loud * 5;
        for (let i = 0; i < N; i += 4) {
          if (P[i + 1] < 0.1) {
            const q = (P[i] - cx) / w;
            P[i + 3] = exp87(mulExt(q * q * -1000, L2E_HI, L2E_LO)) * w * 0.01 + P[i + 3];
          }
        }
      } else {
        // a swirl for one frame about a point near (cx, cy), either way round
        cx = (this.rand() * 6.1037018951994385e-06 + cx) - 0.1;
        cy = (this.rand() * 6.1037018951994385e-06 + cy) - 0.1;
        let a = this.loud * 0.009;
        const b = this.loud * 0.0036;
        if (this.rand() % 2 === 0) a = -a;
        this.vx0 = cx; this.vy0 = cy;
        const lo = a * 0.8;
        this.strength = (a - lo) * this.rand() * INV + lo;
        const lo2 = 1 - b;
        this.countdown = 1;
        this.factor = ((1 - b * 0.2) - lo2) * this.rand() * INV + lo2;
      }
    }
    const every = (this.n / 5) >>> 0;
    for (let i = 0; i < N; i += 4) {
      P[i + 3] = P[i + 3] - 0.0006;
      if (this.countdown > 0) {
        const dx = P[i] - this.vx0, dy = P[i + 1] - this.vy0, d2 = dy * dy + dx * dx, r = Math.sqrt(d2);
        fpatan(dy, dx, E2);
        sincos87(add3(E2[0], E2[1], this.strength / (d2 + 0.01)), SC);
        P[i + 2] = (mulExt(r, SC[2], SC[3]) * this.factor - dx) + P[i + 2];
        P[i + 3] = (mulExt(r, SC[0], SC[1]) * this.factor - dy) + P[i + 3];
      }
      P[i + 2] = (this.rand() * 1.2207403790398878e-08 + P[i + 2]) - 0.0002;
      P[i + 3] = (this.rand() * 1.2207403790398878e-08 + P[i + 3]) - 0.0002;
      if (P[i + 2] < -0.1) P[i + 2] = -0.1;
      if (P[i + 2] > 0.1) P[i + 2] = 0.1;
      if (P[i + 3] < -0.1) P[i + 3] = -0.1;
      if (P[i + 3] > 0.1) P[i + 3] = 0.1;
      if (this.rand() % every === 0) { P[i] = this.rand() * INV; P[i + 1] = this.rand() * INV; P[i + 2] = 0; P[i + 3] = 0; }
      P[i] = P[i + 2] + P[i];
      P[i + 1] = P[i + 1] + P[i + 3];
      if (P[i] < 0) { P[i] = -P[i]; P[i + 2] = P[i + 2] * -0.25; P[i + 3] = P[i + 3] * 0.25; }
      if (P[i + 1] < 0) { P[i + 1] = -P[i + 1]; P[i + 2] = P[i + 2] * 0.25; P[i + 3] = P[i + 3] * -0.25; }
      if (P[i] > 1) { P[i] = 2 - P[i]; P[i + 2] = P[i + 2] * -0.25; P[i + 3] = P[i + 3] * 0.25; }
      if (P[i + 1] > 1) { P[i + 1] = 2 - P[i + 1]; P[i + 2] = P[i + 2] * 0.25; P[i + 3] = 0; }
    }
    if (this.countdown > 0) this.countdown--;
    if (this.rand() % 200 === 0) this.newField();
    const recent = ts - this.lastBeat <= 10000000;       // a beat in the last second: slower, rarer palette changes
    if (this.rand() % (recent ? 400 : 100) === 0) this.newPalette();
    if (this.fading) {
      this.t += recent ? 0.005 : 0.01;
      if (this.t >= 1) { this.fading = false; this.t = 1; }
      const t = this.t;
      this.blend(t < 0.5 ? (1 - t) * t * 2 : (t - 1) * t * 2 + 1);   // inverse sigmoid
    }
  }

  /** the drawing half of Render (0x1000807e on) */
  private draw(): void {
    const blaze = this.preset === 1, W = this.W, H = this.H, buf = this.buf, map = this.map, S = this.stride;
    this.streaks(false);
    const sub = blaze && W * H < 150000 ? 2 : 1;         // 0x100056a0: average with the field's pixel, dim
    for (let y = 0; y < H; y++) {
      for (let x = 0, o = y * S, m = y * W; x < W; x++, o++, m++) {
        const v = (buf[map[m]] + buf[o]) >> 1;
        buf[o] = v >= sub ? v - sub : v;
      }
    }
    for (let k = ((W * H) / 100) | 0; k > 0; k--) { const y = this.rand() % H; this.mapAt(this.rand() % W, y); }
    if (blaze) this.streaks(false);
    for (let y = 1; y < H - 1; y++) {                    // blur: 4 neighbours, in place
      const r = y * S;
      buf[r] = 0;
      for (let o = r + 1; o < r + W - 1; o++) buf[o] = (buf[o - S] + buf[o + S] + buf[o - 1] + buf[o + 1]) >> 2;
    }
    if (blaze) this.streaks(true);
  }

  /** each particle a line of 255 from its position back along its velocity; `cap`: at most ~10 px (Blaze's last pass) */
  private streaks(cap: boolean): void {
    const P = this.p, N = this.n * 4, W = this.W, H = this.H;
    for (let i = 0; i < N; i += 4) {
      const x = ftol(W * P[i]), y = ftol(H * P[i + 1]);
      let dx = ftol(W * P[i + 2]), dy = ftol(H * P[i + 3]);
      if (cap) {
        const len = Math.sqrt(dy * dy + dx * dx);
        if (len > 10) { const k = 10 / (len + 0.01); dx = ftol(dx * k); dy = ftol(dy * k); }
      }
      this.line(x, y, x - dx, y - dy);
    }
  }

  /** 0x100053e0: the DLL's Bresenham on buffer offsets (no clipping: anything inside the buffer is drawn, rows wrap);
   *  the end point is left out, the start drawn twice */
  private line(x0: number, y0: number, x1: number, y1: number): void {
    const buf = this.buf, S = this.stride, end = (this.H - 1) * S + this.W;
    const sx = x0 < x1 ? 1 : -1, sy = y1 <= y0 ? -S : S, ady = Math.abs(y1 - y0), adx = Math.abs(x1 - x0);
    let o = x0 + S * y0;
    if (o >= 0 && o < end) buf[o] = 255;
    if (ady < adx) {
      for (let e = x0 - x1, n = adx; n > 0; n--) {
        if (o >= 0 && o < end) buf[o] = 255;
        e += ady * 2;
        if (e > 0) { o += sy; e -= adx * 2; }
        o += sx;
      }
    } else {
      for (let e = y0 - y1, n = ady; n > 0; n--) {
        if (o >= 0 && o < end) buf[o] = 255;
        e += adx * 2;
        if (e > 0) { o += sx; e -= ady * 2; }
        o += sy;
      }
    }
  }

  /** the two SetDIBitsToDevice: the bottom-up picture, then its lowest H/4 rows top-down beneath it through the 70% palette */
  private blit(): void {
    const W = this.W, H = this.H, S = this.stride, buf = this.buf, px = this.px, ww = this.winW;
    for (let y = 0; y < H; y++) {
      for (let x = 0, o = (H - 1 - y) * S, d = y * ww; x < W; x++) px[d + x] = this.pal[buf[o + x]]!;
    }
    const h4 = (H / 4) | 0;
    for (let y = 0; y < h4; y++) {
      for (let x = 0, o = y * S, d = (H + y) * ww; x < W; x++) px[d + x] = this.pal2[buf[o + x]]!;
    }
  }

  debug(): Record<string, unknown> {
    return { engine: 'Corona', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.winW + 'x' + this.winH,
      particles: this.n, palette: this.next + 1, fading: this.fading, frames: this.frames };
  }
}

A.Corona = Corona;
export { Corona, fpatan, exp87 };
