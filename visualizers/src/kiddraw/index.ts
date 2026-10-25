// Alchemy.KidDrawing — Microsoft's "Kid Drawing" (Dance.dll 1.0.0.1, 2000-11: the Windows Media Player 7 Bonus Pack),
// two presets, "Solo Dance" and "Surfing": a stick figure whose joints are jostled by the waveform, drawn with plain
// GDI calls (lines, ellipses, a polygon, one thick line) onto an off-screen DC and BitBlt'd to the window. IWMPEffects
// only, no resources, no clock: one animation step per Render, the CRT's rand() the only randomness.
//
// The DLL keeps seven joints (a head, a neck, a hip, two hands, two feet) joined by six bones; ../gdi is the GDI
// rasterizer it draws through. The numbers in the comments are the DLL's own addresses (0x1000xxxx): Render 0x10001180
// (a black FillRect, then preset 0's 0x10001290 or preset 1's 0x10001320, then the BitBlt), the layout 0x10002100, the
// ring shapes' builder 0x10001cc0, their constructor 0x10002d30 and Draw 0x10002f10, the joint kick 0x10002950 / 0x10002b80,
// the joint step 0x10002cb0, bones 0x10002a90, heads 0x10002c30.
import { A, type Surface, type TimedLevel } from '../ns';
import { Gdi } from '../gdi';

declare module '../ns' {
  interface AlchemyNS {
    KidDrawing: typeof KidDrawing;
  }
}

const PRESET_NAMES: string[] = ['Solo Dance', 'Surfing'];

export interface KidDrawingConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown>;
  preset?: number;
}

type Rect = [number, number, number, number];

/** one joint, the DLL's 0x54-byte record (0x10002b10): its offsets in the comments */
interface Joint {
  x0: number; y0: number;       // +0, +4: the layout's position (the kick's origin)
  x: number; y: number;         // +8, +0xc: where it is drawn
  fx: number; fy: number;       // +0x10, +0x14: the step's start
  tx: number; ty: number;       // +0x18, +0x1c: its target
  w: number; h: number;         // +0x20, +0x24: the head's size
  cx0: number; cy0: number; cx1: number; cy1: number;   // +0x28..+0x34: the clamp the kick keeps its target in
  mode: number;                 // +0x38: 0 still, 1 up/down, 2 sideways, 3 and 4 the diagonals
  idx: number;                  // +0x3c: the waveform sample that picked the mode
  vel: number;                  // +0x40: the kick's sign, flipped each time
  steps: number;                // +0x44: steps in the current move (0: none yet)
  step: number;                 // +0x48: the next step number
  head: number;                 // +0x4c: draws a head (always 1)
  active: number;               // +0x50: takes steps (Surfing's feet are put by hand)
}

/** a ring of spokes (0x10002d30 + Draw 0x10002f10) or a filled ellipse (0x10003020 + Draw 0x10003060) */
interface Ring { kind: 'ring'; cx: number; cy: number; color: number; xs: Int32Array; ys: Int32Array }
interface Disc { kind: 'disc'; color: number; rect: Rect }
type Shape = Ring | Disc;

/** C's x / 2 and x / 4 on an int (round toward zero) */
const div2 = (v: number): number => (v + ((v >> 31) & 1)) >> 1;
const div4 = (v: number): number => (v + ((v >> 31) & 3)) >> 2;
const ftol = Math.trunc;

class KidDrawing {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: Record<string, unknown>;
  private gdi: Gdi;
  // the DLL's object (0x78 bytes; offsets in comments)
  private joints: (Joint | null)[] = [];                       // +0x14
  private bones: [Joint, Joint][] = [];                        // +0x1c
  private shapes: Shape[] = [];                                // +0x24
  private last: Rect = [0, 0, 0, 0];                           // +0x2c..+0x38
  private frame = 0;                                           // +0x3c
  private inited = false;                                      // +0x40
  private hist = new Uint8Array(50);                           // +0x44: Surfing's five rows of ten wave samples
  private frames = 0;

  constructor(cfg: KidDrawingConfig = {}) {
    this.w = cfg.width || 640; this.h = cfg.height || 480;
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);
    this.gdi = new Gdi(this.w, this.h);
    if (cfg.preset) this.setPreset(cfg.preset);
  }

  /** the CRT's rand stream (the DLL links it statically and never calls srand: a fresh thread's 1) */
  seed(n: number): this { A.srand(n | 0); return this; }

  resize(w: number, h: number): void {
    w = w | 0; h = h | 0;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.gdi = new Gdi(w, h);
  }

  /** SetCurrentPreset (0x10001ad0): any of the two; the frame counter and the "laid out" flag go back to 0 */
  setPreset(n: number): boolean {
    if (n < 0 || n > 1) return false;
    this.preset = n | 0; this.frame = 0; this.inited = false;
    return true;
  }

  /** Render (0x10001180) */
  render(level: TimedLevel): Surface | null {
    const g = this.gdi, rc: Rect = [0, 0, this.w, this.h];
    g.fillRect(0, 0, this.w, this.h, 0);           // CreateSolidBrush(0), FillRect
    if (this.preset === 0) this.solo(level, g, rc); else this.surf(level, g, rc);
    this.frames++;
    return { w: this.w, h: this.h, px: g.px };
  }

  // ---- the layout (0x100028e0, 0x10002100): the joints and bones inside rect r
  private reset(r: Rect): void {
    const [L, T, R, B] = r;
    const W = R - L, H = B - T;
    const hw = W * 0.5, tenth = H * 0.1;
    const mk = (x: number, y: number, w: number, h: number, k: number): Joint => ({
      x0: x, y0: y, x, y, fx: x, fy: y, tx: x, ty: y, w, h,
      cx0: x - k * w, cy0: y - k * h, cx1: k * w + x, cy1: k * h + y,
      mode: 0, idx: 0, vel: 1, steps: 0, step: 0, head: 1, active: 1,
    });
    const sw = ftol(W * 0.1), sh = ftol(tenth);      // the head's and body's size
    const aw = ftol(W * 0.05), ah = ftol(H * 0.05);  // the hands' and feet's
    const xc = ftol(L + hw), xl = ftol(L + W * 0.25), xr = ftol(L + W * 0.75);
    const j: Joint[] = [];
    // the first joint's clamp is a quarter of its size (w/4, h/4); the others' the full size, the feet's four times
    const j0 = mk(xc, ftol(T + tenth), sw, sh, 0);
    j0.cx0 = j0.x - div4(sw); j0.cy0 = j0.y - div4(sh); j0.cx1 = div4(sw) + j0.x; j0.cy1 = div4(sh) + j0.y;
    j.push(j0,
      mk(xc, ftol(H * 0.3 + T), sw, sh, 1),
      mk(xc, ftol(H * 0.6 + T), sw, sh, 1),
      mk(xl, ftol(T + H * 0.2), aw, ah, 1),
      mk(xr, ftol(T + H * 0.2), aw, ah, 1),
      mk(xl, ftol(B - H * 0.025), aw, ah, 4),
      mk(xr, ftol(B - H * 0.025), aw, ah, 4));
    this.joints = j;
    this.bones = [[j[0], j[1]], [j[1], j[2]], [j[1], j[3]], [j[1], j[4]], [j[2], j[5]], [j[2], j[6]]];
    // Surfing: the feet are placed by hand each frame, not stepped (0x100028e0)
    if (this.preset === 1) { j[5].active = 0; j[6].active = 0; }
    this.inited = true;
  }

  // ---- the ring shapes (0x10002d30): n points round the rect's perimeter, n/4 a side
  private ring(cx: number, cy: number, r: Rect, n: number, color: number): Ring {
    const [left, top, right, bottom] = r, dx = right - left, dy = bottom - top, q = n >> 2;
    const xs = new Int32Array(n), ys = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < q; i++, k++) { xs[k] = ftol(i / q * dx + left); ys[k] = top; }
    for (let i = 0; i < q; i++, k++) { xs[k] = right; ys[k] = ftol(i / q * dy + top); }
    for (let i = 0; i < q; i++, k++) { xs[k] = ftol((1 - i / q) * dx + left); ys[k] = bottom; }
    for (let i = 0; i < q; i++, k++) { xs[k] = left; ys[k] = ftol((1 - i / q) * dy + top); }
    return { kind: 'ring', cx, cy, color, xs, ys };
  }

  /** the shapes' builder (0x10001cc0), every frame in Solo Dance, once per layout in Surfing */
  private build(r: Rect): void {
    const [L, T, R, B] = r, W = R - L, H = B - T;
    const s: Shape[] = [];
    if (this.preset === 0) {
      // three rings at random places, 5% of the window each way (x, y: two rand() each, x first)
      const a = W * 0.05, b = H * 0.05;
      const spec: [number, number][] = [[16, 0x33ff66], [8, 0xff00ff], [8, 0xffff]];
      for (const [n, color] of spec) {
        const x = A.rand() % W + L, y = A.rand() % H + T;
        s.push(this.ring(x, y, [ftol(x - a), ftol(y - b), ftol(x + a), ftol(y + b)], n, color));
      }
    } else if (this.preset === 1) {
      // the sun in the top right corner: a ring of 48 spokes and a disc inside it
      const w2 = div2(W), h2 = div2(H), w5 = ftol(W / 5), h5 = ftol(H / 5);
      s.push(this.ring(R, T, [R - w2, T - h2, w2 + R, h2 + T], 0x30, 0x33ccff));
      s.push({ kind: 'disc', color: 0x33ffff, rect: [R - w5, T - h5, R + w5, T + h5] });
    }
    this.shapes = s;
  }

  /** FUN_10001740: every shape's Draw */
  private drawShapes(level: TimedLevel, g: Gdi): void {
    for (const s of this.shapes) {
      if (s.kind === 'disc') { g.ellipse(s.rect[0], s.rect[1], s.rect[2], s.rect[3], s.color, 0); continue; }
      // 0x10002f10: each point is pulled toward the centre by the waveform (0..1 of the way, wave/256) and
      // joined to the centre
      const n = s.xs.length, wave = level.wave[0];
      for (let i = 0; i < n; i++) {
        const t = ftol(i * -1024 / n), sc = wave[-t] * 0.00390625, u = 1 - sc;
        const x = ftol(s.xs[i] * sc + s.cx * u), y = ftol(s.ys[i] * sc + s.cy * u);
        g.moveTo(x, y);
        g.lineTo(s.cx, s.cy, s.color);
      }
    }
  }

  /** the kick (0x10002950): every 50th frame the joints get a new mode from a random sample; each frame one joint
   *  (frame mod 7) starts a six-step move whose size is a fifth of its sample */
  private kick(level: TimedLevel): void {
    const wave = level.wave[0];
    if (this.frame % 50 === 0) {
      for (const j of this.joints) {
        if (!j) continue;
        j.idx = A.rand() & 0x3ff;
        j.mode = wave[j.idx] % 5;
      }
    }
    this.frame = (this.frame + 1) >>> 0;
    const j = this.joints[this.frame % 7];
    if (j) this.move(j, ftol(wave[j.idx] / 5), 6);
  }

  /** 0x10002b80: a new target from the layout position, the clamp (one test at a time, as the DLL's chain), steps = 6 */
  private move(j: Joint, amp: number, steps: number): void {
    let x = j.x0, y = j.y0;
    const d = j.vel * amp;
    switch (j.mode) {
      case 1: y += d; break;
      case 2: x += d; break;
      case 3: x += d; y += d; break;
      case 4: x -= d; y += d; break;
      default: break;
    }
    if (x < j.cx0) x = j.cx0;
    else if (y < j.cy0) y = j.cy0;
    else if (x > j.cx1) x = j.cx1;
    else if (y > j.cy1) y = j.cy1;
    j.tx = x; j.ty = y; j.steps = steps; j.fx = j.x0; j.fy = j.y0; j.step = 1; j.vel = -j.vel;
  }

  /** 0x10002a10: every joint a step, then the bones (red), then the heads (blue discs) */
  private stepAndDraw(g: Gdi): void {
    for (const j of this.joints) {
      if (!j || !j.active || !j.steps || j.step > j.steps) continue;       // 0x10002cb0
      const t = j.step / j.steps, u = 1 - t;
      j.x = ftol(j.tx * t + j.fx * u);
      j.y = ftol(j.ty * t + j.fy * u);
      j.step++;
    }
    for (const [a, b] of this.bones) {
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y, 0xff);
    }
    for (const j of this.joints) {
      if (!j || !j.head) continue;
      const hw = div2(j.w), hh = div2(j.h);
      g.ellipse(j.x - hw, j.y - hh, j.x + hw, j.y + hh, 0xff0000, 0);
    }
  }

  private same(r: Rect): boolean {
    const l = this.last;
    return l[0] === r[0] && l[1] === r[1] && l[2] === r[2] && l[3] === r[3];
  }

  /** Solo Dance (0x10001290) */
  private solo(level: TimedLevel, g: Gdi, r: Rect): void {
    if (!(this.inited && this.same(r))) this.reset(r);
    this.build(r);
    if (this.inited) {
      this.drawShapes(level, g);
      if (level.state === 2) this.kick(level);
      this.stepAndDraw(g);
    }
    this.last = [r[0], r[1], r[2], r[3]];
  }

  /** Surfing (0x10001320): the waveform's last five rows as a wave of layers, a polygon of sea under the first, a
   *  fat green board on the second; the figure's feet on the board's ends */
  private surf(level: TimedLevel, g: Gdi, r: Rect): void {
    const [L, T, R, B] = r;
    const lr: Rect = [L, T, R, div2(B - T)];       // the figure lives in the top half (its bottom is a height/2, not T + height/2)
    if (!(this.inited && this.same(lr))) { this.reset(lr); this.build(r); }
    // 0x10001780: the rows move down one, the newest ten samples (every 102.3rd of the first 1024) in row 0
    const hist = this.hist;
    hist.copyWithin(10, 0, 40);
    for (let k = 0, c = 0; c < 0x27f6; k++, c += 0x3ff) hist[k] = level.wave[0][ftol(c / 10)];
    const step = ftol((R - L) / 9), q = div2(ftol((B - T) / 5)), sc = q * 0.00390625;
    const BLUE = 0xff0000, GREEN = 0xff00;
    const px = new Int32Array(10), py = new Int32Array(10);
    let boardX0 = 0, boardY0 = 0, boardX1 = 0, boardY1 = 0, onBoard = false;
    for (let b = 0; b < 5; b++) {
      if (b === 1) g.polygon([...px, R, L], [...py, B, B], 0xffcc33, BLUE);
      const base = div2(B - T) + b * q;
      g.moveTo(L, ftol(hist[b * 10] * sc + base));
      for (let i = 0; i < 10; i++) {
        const y = ftol(hist[b * 10 + i] * sc + base);
        if (b === 0) { px[i] = i * step; py[i] = y; }
        if (b === 1 && onBoard) {
          boardX1 = i * step; g.wideLineTo(boardX1, y, GREEN, 8); boardY1 = y; onBoard = false;
        } else g.lineTo(i * step, y, BLUE);
        if (b === 1 && i === 5) { onBoard = true; boardX0 = step * 5; boardY0 = y; }
      }
    }
    if (!this.inited) this.reset(r);
    if (this.inited) {
      if (level.state === 2) this.kick(level);
      const j5 = this.joints[5], j6 = this.joints[6];
      if (boardX0 !== 0 && boardX1 !== 0 && j5 && this.joints.length) {
        // the feet go on the board: j5 on its left end, j6 on its right end (the rest of each record follows)
        for (const [j, x, y] of [[j5, boardX0, boardY0], [j6!, boardX1, boardY1]] as [Joint, number, number][]) {
          j.x0 = x; j.y0 = y; j.x = x; j.y = y; j.fx = x; j.fy = y; j.tx = x; j.ty = y;
        }
      }
      this.stepAndDraw(g);
      this.drawShapes(level, g);
    }
    this.last = lr;
  }

  debug(): Record<string, unknown> {
    return { engine: 'KidDrawing', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, frames: this.frames };
  }
}

A.KidDrawing = KidDrawing;
export { KidDrawing };
