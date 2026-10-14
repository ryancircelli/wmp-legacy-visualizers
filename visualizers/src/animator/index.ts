// Alchemy.Animator -- "Animator 2.2" (Animator2.dll, Glass3D, 2003-04: the free WMP build of A2Setup_2007.exe). One WMP
// preset, "Show": an 8-bit palettised picture that is resampled every frame through a warp map (each effect's two
// per-pixel callbacks, effects-a.ts / effects-b.ts) and darkened by 31/32, with the music drawn on top as thick stippled
// lines and dots (draw.ts) in a palette that fades toward a colour theme. Every ~30 s (the first five effects ~15 s) a
// new effect is picked at random and its map built a few rows at a time, then swapped in.
//
// The DLL draws on its own thread (0x10001f40 -> 0x100136f3 per frame) paced by GetTickCount; Render (0x10001d40) only
// shows the latest finished frame and hands the thread the next TimedLevel. This port runs that thread as a generator
// in lockstep with the clock, the way the private harness runs the DLL: the thread runs until it would wait (on the
// clock or on Render), Render shows what it finished. The clock is GetTickCount in ms: options.clock() if given, else
// 100000 + timeStamp / 10000.
import { A, type Surface, type TimedLevel } from '../ns';
import { Lcg } from '../glass3d/lcg';
import { ftol } from '../glass3d/fpu';
import { WarpMap, applyWarp, type WarpFn } from '../glass3d/warp';
import type { FxCtx, FxGlobals, FxGroup } from './fx';
import { GROUP0, GROUP1, GROUP2 } from './effects-a';
import { GROUP3, GROUP4, GROUP5 } from './effects-b';
import { DrawState, Draw } from './draw';

declare module '../ns' {
  interface AlchemyNS {
    Animator: typeof Animator;
  }
}

const PRESET_NAMES: string[] = ['Show'];
const GROUPS: FxGroup[] = [GROUP0, GROUP1, GROUP2, GROUP3, GROUP4, GROUP5];

/** where the thread waits: on the clock (Sleep, or a paced-out spin), or on Render's "go" event */
const enum Block { Clock, Go }

export interface AnimatorConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown> & { clock?: () => number };
  preset?: number;
}

class Animator {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: AnimatorConfig['options'] & object;
  private out: Surface;
  private rng = new Lcg();
  private s!: DrawState;
  private d!: Draw;
  private cur: WarpMap | null = null;      // 0x100ad998
  private pend: WarpMap | null = null;     // 0x100ad99c
  /** 0x100ad990.. : the last map's parameters, for 0x10014f40's re-creation */
  private saved: { p: [number, number, number, number, number]; polar: number; square: number; fn1: WarpFn; fn2: WarpFn } | null = null;
  private fx!: FxCtx;
  private g!: FxGlobals;
  // the thread's own flags (0x100ad5xx)
  private f458 = 0; private f5d0 = 0; private f5d4 = 0; private f5d8 = 0; private f5e0 = 0;
  private f560 = 0; private f564 = 0; private f568 = 0; private f56c = 0; private f570 = 0;
  private f594 = 0; private f598 = 0; private f5a8 = 0; private f5cc = 0;
  private f578 = 0; private f5ec = 0; private f59c = 0;
  private ready = false;                   // 0x1002d018: the DIB exists
  // the lockstep: Render calls so far, the events, where the thread waits
  private calls = 0;
  private drawn = 0;
  private clockNow = 0;
  private e1 = false; private e2 = false;
  private rectSet = false;
  private cf00 = false;
  private th: Generator<Block, void, void> | null = null;
  private waiting: Block | null = null;
  private waitClock = 0;

  constructor(cfg: AnimatorConfig = {}) {
    this.w = Math.max(32, cfg.width || 640); this.h = Math.max(32, cfg.height || 480);
    this.options = Object.assign({ intended: false, fps: 20, backgroundColor: 0x000000 }, cfg.options);
    this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    this.restart();
  }

  seed(n: number): this { this.options.clock = () => n + this.calls * 50; return this; }

  resize(w: number, h: number): void {
    // ponytail: a new size restarts the plug-in (the DLL would rebuild its DIB and maps on the thread's next frame)
    this.w = Math.max(32, w); this.h = Math.max(32, h);
    this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    this.restart();
  }

  setPreset(n: number): void { this.preset = n === 0 ? 0 : 0; }

  debug(): Record<string, unknown> {
    return { calls: this.calls, drawn: this.drawn, f404: this.s ? this.s.gad404 : 0, f42c: this.s ? this.s.gad42c : 0, f3c8: this.s ? this.s.gad3c8 : 0, f3e8: this.s ? this.s.gad3e8 : 0, f3f4: this.s ? this.s.gad3f4 : 0, f3c0: this.s ? this.s.gad3c0 : 0, mode: this.s ? this.s.g28fc0 : -1, group: this.g ? this.g.g2cff0 : -1, effects: this.g ? this.g.g2cff4 : 0,
      map: this.cur ? this.cur.row : -1, pending: this.pend ? this.pend.row : -1 };
  }

  private restart(): void {
    this.calls = 0; this.th = null; this.waiting = null; this.ready = false; this.rectSet = false;
    this.e1 = this.e2 = this.cf00 = false; this.cur = this.pend = null; this.saved = null;
    const rng = this.rng = new Lcg();
    this.s = new DrawState();
    this.d = new Draw(this.s, rng);
    this.g = { g28fd0: -1, g28fc8: 1, g28fcc: 1, g28f14: -1, g28f98: -1, gad3f0: 0, gad3ec: 0, gad3e8: 0,
      g2cff0: 0, g2cff4: 0, g2cff8: 0, g2d008: 0, gad5ac: 0, gad5a4: 0 };
    this.fx = {
      rng, w: this.w, h: this.h, g: this.g,
      rnd: (n: number) => ftol(rng.rand() * n * 3.051850947599719e-05),
      newMap: (p, polar, square, fn1, fn2) => this.startMap(p, polar, square, fn1, fn2),
    };
    this.f458 = this.f5d0 = this.f5d4 = this.f5d8 = this.f5e0 = 0;
    this.f560 = this.f564 = this.f568 = this.f56c = this.f570 = 0;
    this.f594 = this.f598 = this.f5a8 = this.f5cc = 0;
  }

  private clock(level: TimedLevel): number {
    const c = this.options.clock;
    return (c ? c() : 100000 + Math.floor(level.timeStamp / 10000)) >>> 0;
  }

  render(level: TimedLevel): Surface | null {
    // the host advances the clock first: a thread waiting on it runs until it waits again
    this.clockNow = this.clock(level);
    if (this.waiting === Block.Clock && this.clockNow !== this.waitClock) this.run();
    const n = ++this.calls;
    if (n === 1) return this.out;                     // 0x10001ea0: the thread is created suspended
    if (n === 2) { this.th = this.thread(); this.run(); return this.out; }   // ResumeThread
    if (level.state !== 2) {                          // not playing: 0x10014450 paints the rect black (its text and logo left out)
      this.out.px.fill(0);
      return this.out;
    }
    this.rectSet = true;                              // 0x10001af0 copies the rect for the thread
    if (this.ready && this.s.gad40c === this.w && this.s.gad410 === this.h) {
      this.cf00 = this.e2;
      if (this.e2) { this.e2 = false; this.blit(); }
    }
    if (this.cf00) this.s.setLevels(level);
    this.e1 = true;
    if (this.waiting === Block.Go) { this.e1 = false; this.run(); }
    return this.out;
  }

  /** resume the thread until it waits again */
  private run(): void {
    const r = this.th!.next();
    this.waiting = r.done ? null : r.value;
    this.waitClock = this.clockNow;
  }

  /** BitBlt of the bottom-up 8-bit DIB (height + 2 rows) to the window at (0, 0): window row y is DIB row h + 1 - y,
   *  so the picture lands 2 rows down under 2 rows of the DIB's never-drawn bottom padding */
  private blit(): void {
    const dib = this.d.dib, pal = dib.pal32(), px = this.out.px, w = this.w, st = dib.stride, bits = dib.bits;
    for (let y = 0; y < this.h; y++) {
      const src = (this.h + 1 - y) * st, o = y * w;
      for (let x = 0; x < w; x++) px[o + x] = pal[bits[src + x]];
    }
  }

  private now(): number { return this.clockNow; }

  // ---- the thread ------------------------------------------------------------------------------------------------
  private *thread(): Generator<Block, void, void> {
    this.rng.srand(this.now());                       // 0x10002010 (a fresh install: no licence dialog, no rand)
    for (;;) {                                        // 0x10001f85
      if (!this.rectSet) { yield Block.Clock; continue; }
      yield* this.frame();
    }
  }

  /** b7 (0x100136b7): a map is being built (or the first frame) */
  private building(): boolean { return this.f564 !== 0 || this.f568 !== 0; }
  /** d5 (0x100136d5) */
  private idle(): boolean { return this.f564 === 0 || this.f568 !== 0; }

  /** 0x100136f3 and the parts Ghidra split off (0x10013927, 0x1001398b, 0x100139ce, 0x10013ae0) */
  private *frame(): Generator<Block, void, void> {
    if (!this.ready || this.s.gad40c !== this.w || this.s.gad410 !== this.h) this.init();
    // the host blocks a paced-out spin with no map to build inside GetTickCount until the clock moves
    let now = this.now();
    while (((now - this.f5d4) | 0) < this.f5e0 && this.pend === null && this.building()) { yield Block.Clock; now = this.now(); }
    this.f458 = now;
    if (((now - this.f5d4) | 0) < this.f5e0) {
      if (this.building()) this.mapStep(); else yield Block.Clock;   // Sleep(1)
      return;
    }
    this.f5d4 = now;
    const dt = (now - this.f5d0) >>> 0;
    if (dt > 1000) {
      this.f578 = Math.floor(((this.f5d8 * 1000) >>> 0) / dt);
      this.f5e0 += (this.f578 - this.s.g28fc4) | 0;
      if (this.f5e0 < 0) this.f5e0 = 0;
      this.f5d0 = now; this.f5d8 = 0;
    }
    this.f5d8++;
    let skipTimer = false;
    if (this.f598) {
      if (((this.f458 - this.f594) >>> 0) > 5000) { this.f598 = 0; if (this.idle()) this.swap(); }
      if (this.f598) skipTimer = true;
    }
    if (!skipTimer && Math.floor(((this.f458 - this.f5cc) >>> 0) / 1000) > 30 && this.idle()) {
      this.f594 = this.f458; this.f560 = 1; this.f598 = this.f568 === 0 ? 1 : 0;
    }
    if (this.f570) { this.f568 = 1; this.f570 = 0; this.e1 = true; }
    const s = this.s, d = this.d;
    d.levels();                                       // 0x1000f8d0
    if (s.gad3c0) this.warp();
    const m = s.g28fc0;
    if (m === 1 || (m > 14 && m < 20)) d.drawB(); else d.drawA();
    if (s.gad404) d.extra130a0();
    if (!s.gad3c0) this.warp();
    if (s.gad42c) d.stars();                          // 0x1000feb0
    if (s.gad3c8) d.drawMode(0x77);
    if (s.gad3e8) {
      const k = [9, 10, 8, 0x66, 0xb, 0x67][s.gad3f4];
      if (k !== undefined) d.drawMode(k);
    }
    this.e2 = true; this.drawn++;                    // SetEvent: the frame is done
    if (!this.building()) {
      if (this.e1) this.e1 = false; else yield Block.Go;
    } else {
      while (this.f564) {                             // build map rows until Render's go
        if (this.e1) { this.e1 = false; break; }
        if (this.pend === null) { yield Block.Go; break; }   // nothing to build: the host waits on go
        this.mapStep();
      }
    }
    if ((this.f560 && this.idle()) || this.f568) {
      this.f1404b();
      if (!this.g.gad5ac && !this.g.gad5a4) this.f56c = 1;   // 0x10013b4e (nothing is ever locked: [0x100ad5a0] = 0)
      if (!this.g.g2cff4) this.f5a8 = 1;              // 0x10013b6b
      this.f560 = 0;
      this.newEffect();                               // 0x100071b0
      this.f564 = 1;
    }
    if (this.building()) this.mapStep();
    this.f568 = 0;
    if (this.f56c || this.f5a8) { this.f1339e(); this.f56c = 0; this.f5a8 = 0; }
    this.g.gad5a4 = 0;
  }

  /** start-up (0x100136f3's first branch) */
  private init(): void {
    this.g.gad5a4 = 1;
    this.s.gad40c = this.w; this.s.gad410 = this.h;
    this.d.initTables();                              // 0x1000f9e0, 0x1000f970, 0x1000fa50, 0x1000fab0
    this.f570 = 1; this.f568 = 0; this.f560 = 0;
    this.d.createDib();                               // 0x1000f190
    this.ready = true;
  }

  /** 0x1001361c / 0x10015090 / 0x1001365c: one or two rows of the pending map; once it is complete (or on the first
   *  frame) it replaces the current one, unless an effect change is waiting out its 5 s */
  private mapStep(): void {
    let res = 0;
    const p = this.pend;
    if (p) {
      if (p.done) res = 1;
      else {
        p.step();
        if (p.done) res = 1;
        else if (p.h > 600) { p.step(); if (p.done) res = 1; }
      }
    }
    if (res === 1 || this.f568) {
      if (this.f598 === 0 || this.f568 !== 0) this.swap();
      this.f564 = 0;
    }
  }

  /** 0x100135c5 / 0x10015040 */
  private swap(): void {
    if (this.pend) { this.cur = this.pend; this.pend = null; }
    this.s.g28fd8 = this.g.g28f14; this.s.g28fdc = this.g.g2cff0;
  }

  /** 0x10014dc0: finish the current map and resample the picture through it */
  private warp(): void {
    const m = this.cur;
    if (!m) return;
    m.finish();
    const dib = this.d.dib;
    applyWarp(dib.bits, dib.stride, dib.w, dib.h, m);
  }

  /** 0x1001404b */
  private f1404b(): void {
    if (this.g.gad5a4 === 0) {
      this.f5cc = this.f458;
      if (this.f568 !== 0 || this.g.g2cff4 < 7) this.f5cc = (this.f458 - 15000) >>> 0;
    }
  }

  /** 0x100071b0: pick the next effect */
  private newEffect(): void {
    const g = this.g;
    if (g.gad5a4 && this.saved) { this.startMap(this.saved.p, this.saved.polar, this.saved.square, this.saved.fn1, this.saved.fn2); return; }
    g.gad5ac = 0; g.g28f98 = -1; g.g28fd0 = -1; g.gad3ec = 0;
    const was = g.g2cff4++;
    g.g28fc8 = 1; g.g28fcc = 1; g.gad3f0 = 1;
    let grp: number;
    if (was < 5) {
      if (g.g2cff4 < 2) this.rng.srand(this.now());
      grp = 5;
    } else {
      const v = this.fx.rnd(0x42);
      grp = v < 16 ? 0 : v < 28 ? 1 : v < 42 ? 2 : v < 57 ? 3 : v < 66 ? 4 : v;
    }
    g.g2cff0 = grp;
    if (grp <= 5) GROUPS[grp](this.fx);
    // ponytail: (fc8 == 0 && fcc == 0) raises the DLL's error path (0x10013390); no setup does it
  }

  /** 0x10014e10 */
  private startMap(p: [number, number, number, number, number], polar: number, square: number, fn1: WarpFn, fn2: WarpFn): WarpMap {
    this.saved = { p, polar, square, fn1, fn2 };
    const m = new WarpMap(fn1, fn2, p, polar !== 0, square !== 0);
    m.ctx = this.fx;
    m.begin(this.d.dib.w, this.d.dib.h);
    this.pend = m;
    return m;
  }

  /** 0x1001339e: the drawing style for the new effect */
  private f1339e(): void {
    const s = this.s, g = this.g, rnd = (n: number): number => this.fx.rnd(n);
    s.g28f68 = rnd(2) === 0 ? 1 : 0;
    s.gad420 = s.gad420 ? 0 : 1; s.g28fbc = s.g28fb8;
    s.gad3c4 = rnd(2) === 0 ? 1 : 0;
    s.gad3c0 = rnd(2) === 0 ? 1 : 0;
    if (g.g28fc8 === 0) s.gad3c0 = 1;
    if (g.g28fcc === 0) s.gad3c0 = 0;
    let m = g.g28fd0;
    if (m >= 0) g.g28fd0 = -1; else m = rnd(0x16);
    s.g28fc0 = m;
    if (m === 0x15) s.gad3c0 = 1;
    if (m === 0 || m === 4 || m === 0x13) s.gad3c0 = 0;
    if (m === 5) s.gad3f4 = 2;
    s.gad3d8 = 0;
    this.f5ec = rnd(0x14);
    this.f59c = rnd(2) !== 0 && s.g28fc0 !== 0x16 ? 1 : 0;
    s.gad420 = s.gad420 ? 0 : 1; s.g28fbc = s.g28fb8;
    let blur = false;
    if ((m < 8 || m > 11) && g.gad3f0 !== 0) blur = rnd(2) > 0 || g.gad3ec !== 0;
    if (blur) {
      s.gad3e8 = 1;
      s.gad3f4 = s.g28fc0 === 5 ? 2 : rnd(6);
      s.g28f9c = rnd(0x20) + 4;
      s.g28fa4 = rnd(0x40) + 2;
      s.g28fa0 = rnd(10) + 1;
      s.gad400 = rnd(2) === 0 ? 1 : 0;
    } else s.gad3e8 = 0;
    if (g.g28f98 >= 0) s.gad3f4 = g.g28f98;
    s.gad404 = rnd(0x64) <= 0x2d ? 1 : 0;
    s.gad3d0 = s.g28fc0 === 0x15 ? 1 : (rnd(0x64) <= 0x21 ? 1 : 0);
    s.gad444 = rnd(2);
  }
}

A.Animator = Animator;
export { Animator, PRESET_NAMES };
