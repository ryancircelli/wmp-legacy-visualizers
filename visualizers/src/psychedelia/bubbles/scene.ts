// Bubbles' simulation: 42 bubbles in a box, moved by Verlet steps, kept apart and inside the walls, sized by the
// sound. FUN_0f304120 is the DLL's IWMPEffects::Render (Bubbles.dll, image base 0x0f300000); offsets in comments are
// from the object WMP holds (the IWMPEffects pointer; the C++ object begins 8 bytes before it).
//
// Everything runs after Direct3D 9 has set the thread's x87 to 24-bit precision (no FPU_PRESERVE), so every
// arithmetic result is a float: f() after each operation (see ../d3dx9.ts). The constants the code multiplies by are
// doubles holding float values (0.2f, 0.9f, 1000.1f, ...), written here as their float values.
import { A } from '../../ns';
import '../../rand';
import { ftol } from '../../x86';
import { f } from '../d3dx9';

export const COUNT = 42;                       // set by the constructor 0x0f3034d0 (+0x31c)
const F = (x: number): number => Math.fround(x);
const K02 = F(0.2), K06 = F(0.6), K08 = F(0.8), K09 = F(0.9), K1000 = F(1000.1), K60 = F(0.016666668),
  K3600 = F(0.0002777778), K1175 = F(1.175), K0001 = F(0.0001), K095 = F(0.95);

/** the beat detector FUN_0f302b50: its state is three function-local statics in the DLL (process wide) */
class Beat {
  long = new Float32Array(120); li = 0; lsum = 0;    // 0x0f323b40: 120 frames
  short = new Float32Array(3); si = 0; ssum = 0;     // 0x0f323b30: 3 frames
  thr = 0; hold = 0;                                  // 0x0f323b18, 0x0f323b1c
  test(freq: Uint8Array): boolean {
    let sum = 0;
    for (let i = 0; i < 700; i++) sum += freq[i];      // whole numbers: exact in a float
    const v = f(sum * K0001);
    const ol = this.long[this.li]; this.long[this.li] = v; this.li = (this.li + 1) % 120;
    this.lsum = f(f(v - ol) + this.lsum);
    const avgL = f(this.lsum / 120);
    const os = this.short[this.si]; this.short[this.si] = v;
    this.ssum = f(f(v - os) + this.ssum);
    this.si = (this.si + 1) % 3;
    const diff = f(f(f(this.ssum / 3) - avgL) * 100);
    const old = this.thr;
    if (this.hold !== 0 || diff <= this.thr || diff <= 10) {
      if (this.thr > 0) this.thr = f(this.thr * K095);
      if (this.hold !== 0) this.hold--;
      return false;
    }
    this.thr = diff;
    if (f(old * 1.5) < diff) { this.hold = 5; return true; }
    return false;
  }
}

export class Scene {
  // per bubble (stride 0x38 from +0x318): position, previous position, acceleration, radius, colour, band, settled
  px = new Float32Array(COUNT); py = new Float32Array(COUNT);
  qx = new Float32Array(COUNT); qy = new Float32Array(COUNT);
  ax = new Float32Array(COUNT); ay = new Float32Array(COUNT);
  base = new Float32Array(COUNT); r = new Float32Array(COUNT);
  col = new Float32Array(COUNT * 3);
  band = new Int32Array(COUNT);
  settled = new Uint8Array(COUNT);
  mode = 0;                     // +0x27c: 1 Centered, 2 Gravity, 3 Pop (Random picks one)
  halfW = 6; halfH = 6;         // +0x2b4, +0x2b8
  popping = false; popK = 0; popT = 0;   // +0xddd8, +0xdddc, +0xdde0
  beat = new Beat();

  /** IWMPEffects2::Create's FUN_0f302210 after srand(time(NULL)): the bubbles' radii, colours and first moves. This runs
   *  before the device exists, so the x87 is still at the host's 53 bits: doubles, rounded to float where stored */
  init(): void {
    for (let i = 0; i < COUNT; i++) {
      this.px[i] = 0; this.py[i] = 0; this.ax[i] = 0; this.ay[i] = 0;
      const rad = f(0.75 - (i * K06) / COUNT);
      this.base[i] = rad; this.r[i] = rad;
      const r1 = f(A.rand() * 2 ** -15), r2 = f(A.rand() * 2 ** -15), r3 = f(A.rand() * 2 ** -15), r4 = f(A.rand() * 2 ** -15);
      this.qx[i] = f(f(r3 - r4) * K02);
      this.qy[i] = f(f(r1 - r2) * K02);
      this.band[i] = ftol((i / COUNT) * 800);
      if (i === 0) { this.col[0] = this.col[1] = this.col[2] = 1; }
      else {
        const c0 = f(A.rand() * 2 ** -15), c1 = f(A.rand() * 2 ** -15), c2 = f(A.rand() * 2 ** -15);
        let r = c2, g = c1, b = c0;
        let m = r; if (g < m) m = g; if (b < m) m = b;
        m = f(m * 0.5);
        r = f(r - m); g = f(g - m); b = f(b - m);
        let M = r; if (M < g) M = g; if (M < b) M = b;
        this.col[i * 3] = f(r / M); this.col[i * 3 + 1] = f(g / M); this.col[i * 3 + 2] = f(b / M);
      }
      this.settled[i] = 1;
    }
  }

  /** Random's pick (MediaInfo 0x0f3027c0 on a new song, Render when none is picked yet) */
  static pick(): number { return 1 - ftol(f(f(A.rand() * -(2 ** -15)) * 3)); }

  /** one Render call (FUN_0f304120) up to the draw: preset 0..3, the frame's frequency bytes, the client size */
  step(preset: number, freq: Uint8Array, w: number, h: number): void {
    if (preset === 0) { if (this.mode === 0) this.mode = Scene.pick(); }
    else this.mode = preset;
    let sum = 0;
    for (let i = 0; i < 50; i++) sum += freq[i];
    const lv = f(sum / 12750);
    const aspect = f(w / h);
    this.halfW = 6; this.halfH = 6;
    if (aspect <= 1) this.halfH = f(6 / aspect); else this.halfW = f(aspect * 6);
    const n = COUNT, r = this.r;
    if (this.mode === 1) {
      r[0] = f(f(f(f(lv * 3) + K02) * K08) + f(r[0] * K02));
      for (let i = 1; i < n; i++) r[i] = this.base[i];
    } else if (this.mode === 2) {
      for (let i = 0; i < n; i++) r[i] = f(f(r[i] * K08) + f(f(f(f(freq[this.band[i]] / 255) * 2) + K02) * K02));
    } else if (this.mode === 3) {
      for (let i = 0; i < n; i++) r[i] = 0.5;
      if (!this.popping) {
        if (this.beat.test(freq)) {
          this.popping = true;
          this.popK = ftol(f(n * f(A.rand() * 2 ** -15)));
          this.popT = 24;
        }
      } else {
        const t = this.popT;
        if (t > 20) {
          const k = f((t - 20) * 0.25);
          r[this.popK] = f(f(f(1 - k) * 2) + f(k * 0.5));
        } else {
          r[this.popK] = t <= 12 ? f(f(1 - f(t / 12)) * 0.5) : 0;
        }
        if (--this.popT === 0) this.popping = false;
      }
      r[0] = f(r[0] * 2);
    }
    // accelerations (+0x328): toward the centre, down, or none
    let gx = 0, gy = 0;
    for (let i = 0; i < n; i++) {
      if (this.mode === 1) {
        const x = this.px[i], y = this.py[i];
        const dist = f(Math.sqrt(f(f(x * x) + f(y * y))));
        if (dist <= 0) { gx = 0; gy = 0; } else { gx = f(f(-x * K1000) / dist); gy = f(f(-y * K1000) / dist); }
      } else if (this.mode === 2) { gx = 0; gy = -K1000; }
      else if (this.mode === 3) { gx = 0; gy = 0; }
      this.ax[i] = f(gx * K60); this.ay[i] = f(gy * K60);
    }
    // Verlet
    for (let i = 0; i < n; i++) {
      const ox = this.qx[i], oy = this.qy[i];
      this.qx[i] = this.px[i]; this.qy[i] = this.py[i];
      this.px[i] = f(f(f(this.px[i] * 2) - ox) + f(this.ax[i] * K3600));
      this.py[i] = f(f(f(this.py[i] * 2) - oy) + f(this.ay[i] * K3600));
    }
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) this.constrain(i);
  }

  private bounceX(i: number, t: number): void {
    const x = this.px[i];
    this.qx[i] = f(t - this.qx[i]); this.px[i] = f(t - x);
    this.qx[i] = f(f(f(this.qx[i] - this.px[i]) * K09) + this.px[i]);
    this.qy[i] = f(this.py[i] + f(f(this.qy[i] - this.py[i]) * K09));
  }
  private bounceY(i: number, t: number): void {
    const y = this.py[i];
    this.qy[i] = f(t - this.qy[i]); this.py[i] = f(t - y);
    this.qx[i] = f(this.px[i] + f(f(this.qx[i] - this.px[i]) * K09));
    this.qy[i] = f(this.py[i] + f(f(this.qy[i] - this.py[i]) * K09));
  }

  private constrain(i: number): void {
    const n = COUNT, ri = this.r[i];
    const lo = f(ri - this.halfW), hi = f(this.halfW - ri), hiY = f(this.halfH - ri), loY = f(ri - this.halfH);
    const x = this.px[i];
    if (lo <= x) { if (hi < x) this.bounceX(i, f(hi * 2)); }
    else this.bounceX(i, f(lo * 2));
    const y = this.py[i];
    if (y <= hiY) { if (y < loY) this.bounceY(i, f(loY * 2)); }
    else this.bounceY(i, f(hiY * 2));
    if (!this.settled[i]) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = f(this.px[i] - this.px[j]), dy = f(this.py[i] - this.py[j]);
        if (f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) < f(this.r[j] + ri)) { this.speed(i); return; }
      }
      this.settled[i] = 1;
    } else {
      for (let j = i + 1; j < n; j++) {
        const xi = this.px[i], xj = this.px[j], yi = this.py[i], yj = this.py[j];
        const dx = f(xi - xj), dy = f(yi - yj);
        const dist = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))));
        let sr = f(this.r[j] + ri);
        if (dist < sr) {
          sr = f(sr - dist);
          const mx = f(f(dx / dist) * sr), my = f(sr * f(dy / dist));
          this.px[i] = f(this.px[i] + mx); this.py[i] = f(this.py[i] + my);
          this.px[j] = f(this.px[j] - mx); this.py[j] = f(this.py[j] - my);
          if (this.mode === 1 && i === 0) { this.px[0] = 0; this.py[0] = 0; this.qx[0] = 0; this.qy[0] = 0; }
        }
      }
    }
    this.speed(i);
  }

  /** FUN_0f301fd0(bubble, 0.5): a step longer than 0.5 is cut to half of itself */
  private speed(i: number): void {
    const dx = f(this.qx[i] - this.px[i]), dy = f(this.qy[i] - this.py[i]);
    const dist = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))));
    if (0.5 < dist) {
      this.qx[i] = f(this.px[i] + f(dx * 0.5));
      this.qy[i] = f(this.py[i] + f(0.5 * dy));
    }
  }

  /** the vertex shader constants c4.x of bubble i: the drawn radius */
  drawRadius(i: number): number { return f(this.r[i] * K1175); }
}
