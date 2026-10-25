// Alchemy.Flashes -- "Flashes 2.0" (Flashes.dll, Glass3D, 2004: the free WMP plug-in from FlashSetup.exe, Animator's
// sibling). One WMP preset, "Show": coloured clouds of dots on black, put where the music is loud and faded out every
// frame by a random sparkle of black over the whole picture. The colour follows the spectrum (red: bass, green: mids,
// blue: highs). Every ~30 s a new style is picked at random: random clouds, particles that bounce around the picture
// one per spectrum band, or one long burst, with extras switched on at random (a band flower, a falling burst).
//
// Like Animator (animator/index.ts) the DLL draws on its own thread (0x10001df0 -> 0x1000c1e7 per frame) paced by
// GetTickCount, and Render (0x10001bf0) only shows the latest finished frame and hands the thread the next TimedLevel.
// This port runs that thread as a generator in lockstep with the clock, as the private harness runs the DLL. Unlike
// Animator there is no warp map, and the picture is a 16-bit x555 DIB. The clock is GetTickCount in ms:
// options.clock() if given, else 100000 + timeStamp / 10000.
import { A, type Surface, type TimedLevel } from '../ns';
import { Lcg } from '../glass3d/lcg';
import { Draw } from './draw';

declare module '../ns' {
  interface AlchemyNS {
    Flashes: typeof Flashes;
  }
}

const PRESET_NAMES: string[] = ['Show'];

/** where the thread waits: on the clock (Sleep), or on Render's "go" event */
const enum Block { Clock, Go }

/** GDI's 5-bit to 8-bit channel expansion when it blits the x555 DIB (the top bits repeated below), per 15-bit pixel */
const E5 = (c: number): number => (c << 3) | (c >> 2);
const X555 = Uint32Array.from({ length: 32768 }, (_, c) => (E5(c >> 10) << 16) | (E5((c >> 5) & 31) << 8) | E5(c & 31));

export interface FlashesConfig {
  width?: number;
  height?: number;
  options?: Record<string, unknown> & { clock?: () => number };
  preset?: number;
}

class Flashes {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  options: FlashesConfig['options'] & object;
  private out: Surface;
  private rng = new Lcg();
  private d!: Draw;
  // the thread's own globals (0x100a19xx)
  private f1824 = 0; private f192c = 0; private f1930 = 0; private f1934 = 0; private f1938 = 0;
  private f195c = 0; private f1960 = 0; private f1964 = 0; private f196c = 0; private f1994 = 0;
  private f1998 = 0; private f199c = 0; private f19a0 = 0; private f19a8 = 0;
  private ready = false;                   // 0x100203ac: the DIB exists
  // the lockstep: Render calls so far, the events, where the thread waits
  private calls = 0;
  private drawn = 0;
  private clockNow = 0;
  private e1 = false; private e2 = false;
  private rectSet = false;
  private b8 = false;                      // 0x100202b8: the last wait for the frame succeeded
  private th: Generator<Block, void, void> | null = null;
  private waiting: Block | null = null;
  private waitClock = 0;

  constructor(cfg: FlashesConfig = {}) {
    this.w = Math.max(32, cfg.width || 640); this.h = Math.max(32, cfg.height || 480);
    this.options = Object.assign({ intended: false, fps: 20, backgroundColor: 0x000000 }, cfg.options);
    this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    this.restart();
  }

  seed(n: number): this { this.options.clock = () => n + this.calls * 50; return this; }

  resize(w: number, h: number): void {
    // ponytail: a new size restarts the plug-in (the DLL would rebuild its tables and DIB on the thread's next frame)
    this.w = Math.max(32, w); this.h = Math.max(32, h);
    this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    this.restart();
  }

  setPreset(n: number): void { this.preset = n === 0 ? 0 : 0; }

  debug(): Record<string, unknown> {
    const d = this.d;
    return { calls: this.calls, drawn: this.drawn, mode: d.g1e4e8, c4: d.ga17c4, ec: d.ga17ec, burst: d.ga1788,
      extra16: this.f1964, wait: this.f19a8 };
  }

  private restart(): void {
    this.calls = 0; this.th = null; this.waiting = null; this.ready = false; this.rectSet = false;
    this.e1 = this.e2 = this.b8 = false;
    this.rng = new Lcg();
    this.d = new Draw(this.rng);
    this.f1824 = this.f192c = this.f1930 = this.f1934 = this.f1938 = 0;
    this.f195c = this.f1960 = this.f1964 = this.f196c = this.f1994 = 0;
    this.f1998 = this.f199c = this.f19a0 = this.f19a8 = 0;
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
    if (n === 1) return this.out;                     // 0x10001d50: the thread is created suspended
    if (n === 2) { this.th = this.thread(); this.run(); return this.out; }   // ResumeThread
    if (level.state !== 2) {                          // not playing: 0x1000cd30 paints the window (its logo left out)
      this.out.px.fill(0);
      return this.out;
    }
    this.rectSet = true;                              // 0x100019a0 copies the rect for the thread
    if (this.ready && this.d.ga17cc === this.w && this.d.ga17d0 === this.h) {
      this.b8 = this.e2;
      if (this.e2) { this.e2 = false; this.blit(); }
    }
    if (this.b8) this.d.setLevels(level);
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

  /** BitBlt of the bottom-up 16-bit DIB (height + 2 rows) to the window at (0, 0): window row y is DIB row h + 1 - y,
   *  so the picture lands 2 rows down under 2 rows of the DIB's never-drawn bottom padding */
  private blit(): void {
    const dib = this.d.dib, px = this.out.px, w = this.w, st = dib.stride, bits = dib.bits;
    for (let y = 0; y < this.h; y++) {
      const src = (this.h + 1 - y) * st, o = y * w;
      for (let x = 0; x < w; x++) px[o + x] = X555[bits[src + x] & 0x7fff];
    }
  }

  private now(): number { return this.clockNow; }

  // ---- the thread ------------------------------------------------------------------------------------------------
  private *thread(): Generator<Block, void, void> {
    this.rng.srand(this.now());                       // 0x10001ec0 (a fresh install: no licence dialog, no rand)
    for (;;) {                                        // 0x10001e35
      if (!this.rectSet) { yield Block.Clock; continue; }
      yield* this.frame();
    }
  }

  /** 0x1000c1e7 and its tail 0x1000c43b */
  private *frame(): Generator<Block, void, void> {
    const d = this.d;
    if (!this.ready || d.ga17cc !== this.w || d.ga17d0 !== this.h) this.init();
    const now = this.now();
    this.f1824 = now;
    if (((now - this.f199c) | 0) < this.f19a8) { yield Block.Clock; return; }   // Sleep(1)
    this.f199c = now;
    const dt = (now - this.f1998) >>> 0;
    if (dt > 1000) {                                  // once a second: lengthen or shorten the wait toward 20 fps
      const fps = Math.floor(((this.f19a0 * 1000) >>> 0) / dt);
      this.f19a8 = (this.f19a8 + fps - 20) | 0;
      if (this.f19a8 < 0) this.f19a8 = 0;
      this.f1998 = now; this.f19a0 = 0;
    }
    this.f19a0++;
    let hold = false;
    if (this.f1960) {
      if (((now - this.f195c) >>> 0) > 5000) this.f1960 = 0;
      if (this.f1960) hold = true;
    }
    if (!hold && Math.floor(((now - this.f1994) >>> 0) / 1000) > 30) {   // a new style every 30 s
      this.f195c = now; this.f1960 = this.f1930 === 0 ? 1 : 0; this.f192c = 1;
    }
    if (this.f1938) { this.f1930 = 1; this.f1938 = 0; this.e1 = true; }
    d.levels();
    if (this.f1964) d.drawMode(0x16);
    d.drawA();                                        // (drawB, 0x1000a8c0, takes modes 1 and 15..19: never picked)
    if (d.ga17c4) d.extraBc30();
    if (d.ga17ec) d.cloud84a0();
    if (d.ga1788) d.drawMode(0x77);
    this.e2 = true; this.drawn++;                    // SetEvent: the frame is done
    if (this.e1) this.e1 = false; else yield Block.Go;
    if (this.f192c || this.f1930) {
      if (!this.f196c) {                              // 0x1000c5ee, 0x1000c524
        this.f1994 = this.f1930 ? (this.f1824 - 15000) >>> 0 : this.f1824;
        this.f1934 = 1;
      }
      this.f192c = 0;
    }
    this.f1930 = 0;
    if (this.f1934) { this.pick(); this.f1934 = 0; }
    this.f196c = 0;
  }

  /** start-up (0x1000c1e7's first branch) */
  private init(): void {
    this.f196c = 1;
    this.d.ga17cc = this.w; this.d.ga17d0 = this.h;
    this.d.initTables();
    this.f1938 = 1; this.f1930 = 0; this.f192c = 0;
    this.d.createDib();
    this.ready = true;
  }

  /** 0x1000bf8e: the drawing style for the next 30 s (the draws whose results only unported modes read are kept for
   *  their rand()) */
  private pick(): void {
    const d = this.d, rnd = (n: number): number => d.rnd(n);
    rnd(2); rnd(2);                                   // 0x1001e490, 0x100a1784
    d.g1e4f4 = rnd(2) === 0 ? 1 : 0;
    const v = rnd(3);
    const m = d.g1e4e8 = v === 0 ? 0x15 : v === 1 ? 0x16 : v === 2 ? 0x18 : 0x17;
    d.ga1798 = 0;
    rnd(0x14);                                        // 0x100a19b4
    this.f1964 = rnd(2) !== 0 && m !== 0x16 ? 1 : 0;
    d.ga17c4 = rnd(100) <= 0x2d && m !== 0x17 ? 1 : 0;
    d.ga1790 = m === 0x15 ? 1 : rnd(100) <= 0x21 && m !== 0x17 ? 1 : 0;
    rnd(2);                                           // 0x100a1804
  }
}

A.Flashes = Flashes;
export { Flashes, PRESET_NAMES };
