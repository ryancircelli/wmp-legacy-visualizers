// PixelTrip's engine (0x10001000) and scene (0x1000c200): every Render reads the levels; when the frame-rate cap lets a
// frame through, the field moves the last frame into the next buffer, the effects draw on it, it goes to the window and
// the buffers swap; then the scene and the field decide what comes next.
import { Ctx, Deck, F, ftol } from './ctx';
import { Field } from './field';
import { Effect, Grid, Ring, Slot, Wave } from './effects';
import { Globe, Idle, Lattice } from './effects2';

type Make = (c: Ctx, w: number, h: number, st: number, mode: number) => Effect;

/** the effect classes by their constructors' addresses (each takes the mode 0x1000c7b0 passes: 1 moving, 0 still) */
const MAKE: Record<string, Make> = {
  b240: (c, w, h, s, m) => new Ring(c, w, h, s, m),
  c0a0: (c, w, h, s, m) => new Ring(c, w, h, s, m, true),
  a0c0: (c, w, h, s, m) => new Wave(c, w, h, s, m),
  afd0: (c, w, h, s, m) => new Wave(c, w, h, s, m, 1, 0),
  b080: (c, w, h, s, m) => new Wave(c, w, h, s, m, 1, 1),
  b150: (c, w, h, s, m) => new Wave(c, w, h, s, m, 0, 1),
  '8980': (c, w, h, s, m) => new Grid(c, w, h, s, m, false),
  '94e0': (c, w, h, s, m) => new Grid(c, w, h, s, m, true),
  dbb0: (c, w, h, s, m) => new Globe(c, w, h, s, m),
  '9d60': (c, w, h, s, m) => new Globe(c, w, h, s, m, { zfirst: true }),
  '9fd0': (c, w, h, s, m) => new Globe(c, w, h, s, m, { zfirst: true, lines: true }),
  ee50: (c, w, h, s, m) => new Globe(c, w, h, s, m, { lines: true }),
  ec40: (c, w, h, s, m) => new Globe(c, w, h, s, m, { mirror: true }),
  '9e30': (c, w, h, s, m) => new Globe(c, w, h, s, m, { mirror: true, zfirst: true }),
  '9f00': (c, w, h, s, m) => new Globe(c, w, h, s, m, { mirror: true, zfirst: true, lines: true }),
  ed80: (c, w, h, s, m) => new Globe(c, w, h, s, m, { mirror: true, lines: true }),
  ef40: (c, w, h, s, m) => new Lattice(c, w, h, s, m),
  f9f0: (c, w, h, s, m) => new Lattice(c, w, h, s, m, true),
  fba0: (c, w, h, s) => new Idle(c, w, h, s),
};
/** 0x1000c7b0's two switches: the overlay drawn moving (ids 1-27) and the main one drawn still (ids 1-30) */
const MOVING = ['b240', 'afd0', 'ef40', 'c0a0', 'a0c0', 'dbb0', '9d60', 'ec40', '9e30', '8980', 'b150', 'b080', 'ee50',
  '9fd0', '9f00', 'ed80', 'f9f0', '94e0', 'b240', 'afd0', 'ef40', 'c0a0', 'a0c0', '8980', 'b150', 'b080'];
const STILL = ['a0c0', '9d60', 'afd0', 'ef40', '9f00', '9fd0', 'ec40', '8980', 'fba0', 'f9f0', '94e0', 'b240', '9e30',
  'b150', 'b080', 'ee50', 'dbb0', 'ed80', 'c0a0', 'c0a0', 'b150', 'b080', 'f9f0', '94e0', 'b240', '8980', 'a0c0', 'afd0', 'ef40'];

export class Scene {
  half: number;              // +0x10
  beat = 0;                  // +0x14
  beatOn = 0;                // +0x18
  sens = 0x5c;               // +0x1c
  s0 = new Int8Array(1024); s1 = new Int8Array(1024);     // +0x20 +0x420
  f0 = new Uint8Array(1024); f1 = new Uint8Array(1024);   // +0x820 +0xc20
  slots: (Effect | null)[] = new Array<Effect | null>(10).fill(null);   // +0x105c
  main: Effect | null = null;       // +0x1084
  over: Effect | null = null;       // +0x1088
  tMain = 0; tOver: number; tSlots: number;   // +0x108c +0x1090 +0x1094
  still: Deck; moving: Deck;        // +0x1098 +0x109c

  constructor(public c: Ctx, public w: number, public h: number, public stride: number) {
    this.half = (w + h) >> 1;
    this.tSlots = c.at(c.rdiv(120000) + 120000);
    this.tOver = c.at(c.rdiv(5000) + 2000);
    this.still = new Deck(c, 30);
    this.moving = new Deck(c, 27);
  }

  /** 0x1000c740: beat sensitivity 1..100 to the divisor of the mean level */
  setSens(v: number): void {
    let k = 100 - v;
    if (k < 0) k = 1; else if (k > 100) k = 100;
    const s = ftol(k * 512 * F(0.01));
    this.sens = s < 1 ? 1 : s > 0x200 ? 0x200 : s;
  }

  /** 0x1000d910: the spectra, their means (the beat), and the waveforms scaled to the window */
  analyze(w0: Uint8Array, w1: Uint8Array, f0: Uint8Array, f1: Uint8Array): void {
    const c = this.c;
    this.f0.set(f0); this.f1.set(f1);
    let a = 0, b = 0;
    for (let i = 0; i < 1024; i++) { a += f0[i]; b += f1[i]; }
    const avg0 = a >> 10, avg1 = b >> 10;
    this.beat = this.beatOn !== 0 ? ftol((avg0 + avg1) / this.sens) : 0;
    for (let i = 0; i < 1024; i++) { this.s0[i] = 0x80 - w0[i]; this.s1[i] = 0x80 - w1[i]; }
    this.scale(this.s0);
    this.scale(this.s1);
    c.prev0 = c.avg0; c.prev1 = c.avg1;
    c.avg0 = avg0; c.avg1 = avg1;
  }

  /** 0x1000da30 */
  private scale(s: Int8Array): void {
    let lo = 0, hi = 0;
    for (let i = 0; i < 1024; i++) { const v = s[i]; if (v < lo) lo = v; if (hi < v) hi = v; }
    if (hi === 0 || lo === 0) { s.fill(0); return; }
    const k = this.half * F(0.1) * 0.0078125;
    for (let i = 0; i < 1024; i++) {
      const v = s[i];
      let x = v * k;
      if (x === 0 && v !== 0) x = v > 0 ? 1 : -1;
      s[i] = ftol(x);
    }
  }

  /** 0x1000d860 */
  draw(buf: Int32Array): void {
    const args = [this.s0, this.s1, this.f0, this.f1] as const;
    for (const e of this.slots) if (e) e.draw(buf, args[0], args[1], args[2], args[3], this.beat);
    if (this.over) this.over.draw(buf, args[0], args[1], args[2], args[3], this.beat);
    if (this.main) this.main.draw(buf, args[0], args[1], args[2], args[3], this.beat);
  }

  private make(key: string, mode: number): Effect {
    return MAKE[key](this.c, this.w, this.h, this.stride, mode);
  }

  /** 0x1000c7b0: retire what has run its time, start what is due */
  update(): void {
    const c = this.c, now = c.tick >>> 0;
    let live = 0;
    for (let i = 0; i < 10; i++) {
      const e = this.slots[i];
      if (e) { if (e.done()) this.slots[i] = null; else live++; }
    }
    if (this.tSlots === 0xffffffff && live === 0) this.tSlots = c.at(c.rdiv(120000) + 180000);
    if (this.over && this.over.done()) { this.over = null; this.tOver = c.at(c.rdiv(8000) + 6000); }
    if (this.main && this.main.done()) { this.main = null; this.tMain = c.at(c.rdiv(8000) + 6000); }
    if (this.tSlots < now) {
      this.tSlots = 0xffffffff;
      for (let i = 0; i < 10; i++) { const e = this.slots[i]; if (e && e.done()) this.slots[i] = null; }
      const n = c.rdiv(7) + 3;
      for (let i = 0; i < n; i++) {
        const e = new Slot(c, this.w, this.h, this.stride);
        this.slots[i] = e;
        e.doneAt = 0xffffffff;
      }
    }
    if (!this.over && this.tOver < (c.tick >>> 0)) {
      this.tOver = 0xffffffff;
      const id = this.moving.draw();
      if (id >= 1 && id <= 26) this.over = this.make(MOVING[id - 1], 1);
      if (!this.over) this.tOver = c.at(c.rdiv(7000) + 6000);
    }
    let draw = true;
    if (!this.main) {
      let spawn = true;
      if ((c.tick >>> 0) <= this.tMain) {
        if (this.over) { spawn = false; draw = false; }
        else if (live !== 0) spawn = false;
      }
      if (spawn) {
        this.tMain = 0xffffffff;
        const id = this.still.draw();
        if (id >= 1 && id <= 29) this.main = this.make(STILL[id - 1], 0);
        if (!this.main) this.tMain = c.at(c.rdiv(7000) + 6000);
      }
    }
    if (draw && !this.over && !this.main && live === 0) {
      this.main = new Idle(c, this.w, this.h, this.stride);
      this.tMain = 0xffffffff;
    }
    if (this.main) this.main.tick();
    if (this.over) this.over.tick();
    for (const e of this.slots) if (e) e.tick();
  }
}

export interface Settings { fps: number; motion: number; bounce: number; beat: number; sensitivity: number }

export class Engine {
  size: number;
  front: Int32Array; back: Int32Array;   // +0x10 +0x14
  field: Field;                          // +0x1c
  scene: Scene;                          // +0x20
  start: number; last: number;           // +0x2c +0x30
  wait = 0;                              // +0x34
  frames = 0;                            // +0x38
  fps = 0;                               // +0x40
  desired = F(29.97);                    // +0x44
  transform = 1;                         // +0x48
  tMotion = 0xffffffff; tBounce = 0xffffffff;   // +0x4c +0x50
  motion = 0; bounce = 0;                // +0x54 +0x58

  constructor(public c: Ctx, public w: number, public h: number, s: Settings) {
    this.start = c.tick; this.last = c.tick;
    c.srand(c.tick);
    this.size = (h + 4) * w + 100;
    this.front = new Int32Array(this.size);
    this.back = new Int32Array(this.size);
    this.field = new Field(c, w, h, w);
    this.scene = new Scene(c, w, h, w);
    // 0x10002a40's settings, in its order
    this.desired = F(s.fps);
    this.scene.setSens(s.sensitivity);
    this.scene.beatOn = s.beat;
    this.setMotion(s.motion);
    this.setBounce(s.bounce);
  }

  private soon(): number { return this.c.at(this.c.rdiv(18000) + 20000); }

  /** 0x100012e0 "Enable PixelTrip Motion": 0 never, 1 sometimes, 2 always */
  setMotion(mode: number): void {
    this.field.setMotion(0);
    this.motion = mode;
    if (mode === 2) this.field.setMotion(1);
    else if (mode === 1) { this.field.setMotion(1); this.tMotion = this.soon(); }
    else this.tMotion = 0xffffffff;
  }

  /** 0x100013c0 "Enable Motion Bounce" */
  setBounce(mode: number): void {
    const c = this.c;
    c.bounce = 0;
    this.bounce = mode;
    if (mode === 2) c.bounce = 1;
    else if (mode === 1) { c.bounce = 1; this.tBounce = this.soon(); }
    else this.tBounce = 0xffffffff;
    if (c.bounce === 1 && this.field.moving === 1) { this.field.setMotion(0); this.field.setMotion(1); }
  }

  /** 0x10001780: draw a frame if the cap allows; true when one was drawn (into `back`, before the swap) */
  frame(): Int32Array | null {
    const c = this.c;
    if (((c.tick - this.last) >>> 0) < (this.wait >>> 0)) return null;
    const dst = this.back;
    if (this.transform) this.field.apply(this.front, dst, this.scene.beat);
    else dst.fill(0);
    this.scene.draw(dst);
    this.back = this.front; this.front = dst;
    this.after();
    this.frames++;
    const fps = this.frames / (((c.tick - this.start) >>> 0) * F(0.001));
    this.fps = F(fps);
    this.wait = 0;
    if (this.desired > 0) {
      let v = fps + 1 - this.desired;
      if (v > 0) {
        if (v > this.desired) v = this.desired;
        this.wait = ftol(1 / (this.desired / v) * 1000);
      }
    }
    this.last = c.tick;
    return dst;
  }

  /** 0x10001660 */
  private after(): void {
    const c = this.c, f = this.field;
    this.scene.update();
    f.update();
    if (this.motion !== 0 && (c.tick >>> 0) > this.tMotion) {
      if (this.motion === 1) f.setMotion(f.moving === 0 ? 1 : 0);
      else { f.setMotion(0); f.setMotion(1); }
      this.tMotion = this.soon();
    }
    if (this.bounce === 1 && (c.tick >>> 0) > this.tBounce) {
      c.bounce = c.bounce === 0 ? 1 : 0;
      this.tBounce = this.soon();
      if (c.bounce === 1 && f.moving === 1) { f.setMotion(0); f.setMotion(1); }
    }
  }
}
