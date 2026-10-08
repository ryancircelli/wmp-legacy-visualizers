// Alchemy.Plenoptic — Windows Media Player 7-10's "Plenoptic" visualization (CLSID 607C27E9-AB27-11d3-
// A116-A0EA50C10801). Ported from WMP 10's wmp.dll (10.00.00.3802; WMP 9's wmp.dll 9.00.00.2980 in
// brackets where it differs). VAs are WMP 10's unless marked [9: ...].
//
// One 32bpp screen surface the size of the "Plenoptic_Resolution" table entry (256x192 by default),
// a bottom-up DIB the host StretchDIBits's (COLORONCOLOR) to the window. Every frame: copy the
// TimedLevel, dt from GetTickCount, a beat detector on the waveform's RMS, then the preset's effect
// and the always-on border effect draw into the screen surface. No srand anywhere: rand() continues
// whatever stream the process has (seed()). The FPU runs at 53-bit precision, so plain double arithmetic
// in the DLL's operand order is exact; FSIN/FCOS are modelled in x87.ts. `version` selects WMP 9's or
// WMP 7-8's arithmetic, which differ from WMP 10's in a few frames per tens of thousands.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';
import { Surf, ftol, gradient } from './surf';
import { sincos87 } from './x87';
import { PList, Camera, rotate, normalize, scale3, P_SIZE, PX, PY, PZ, VX, VY, VZ, AX, AY, AZ, AGE, LIFE } from './particles';

declare module '../ns' {
  interface AlchemyNS {
    Plenoptic: typeof Plenoptic;
  }
}

const PRESET_NAMES = ['Random', 'Smokey Circles', 'Smokey Lines', 'Vox', 'Flame', 'Fountain', 'Spyro'];

/** The resolution table, 0x79a4d50 [9: 0x7a635c8]; "Plenoptic_Resolution" (HKCU, then HKLM) picks the row, default 0. */
const RESOLUTIONS: number[][] = [[256, 192], [320, 200], [320, 240], [384, 288], [512, 384], [640, 480]];

export interface PlenopticConfig {
  width?: number;
  height?: number;
  preset?: number;
  /** 0..5, the "Plenoptic_Resolution" setting (RESOLUTIONS) */
  resolution?: number;
  /** the channel count WMP's MediaInfo hands it; 1 copies channel 0 over channel 1 every frame */
  channels?: number;
  /** the WMP to follow, 10 by default. 9 (and below): no life == 0 guard in the particle draw. 8 (and 7,
   *  wmpui.dll): division instead of reciprocal multiplication in normalize, the projection and vgrad, the
   *  older matrix * vector sum order and rotate's register set; each changes a few frames in tens of
   *  thousands. 7 (WMP 7.0/7.1): Vox's bars a quarter as tall, and a paused stream still draws the effect. */
  version?: number;
  /** GetTickCount: milliseconds, any origin (default performance.now()) */
  tick?: () => number;
  options?: Record<string, unknown>;
}

/** What the effects share: the DLL keeps these in globals (0x79a6ae8.. [9: 0x7a67058..]). */
export class Frame {
  wave0 = new Uint8Array(1024);
  wave1 = new Uint8Array(1024);
  freq0 = new Uint8Array(1024);
  freq1 = new Uint8Array(1024);
  state = 0;
  /** the screen size, globals 0x79a7af8/0x79a7afc [9: 0x7a67050/54], which the effects' init() read */
  W = 256;
  H = 192;
  /** PlenopticConfig.version */
  ver = 10;
  /** seconds since the last Render while playing, else 0 (0x79a7b10) */
  dt = 0;
  /** RMS of both waveforms about 128 (0x79a7b08) */
  rms = 0;
  /** the beat flag (0x79a7b01) */
  beat = false;
  // beat detector state (0x79a7b18 last level, 0x79a7b1c rising, 0x79a7b20 peak, 0x79a7b24 trough)
  prev = 0;
  rising = false;
  peak = 0;
  low = 0;

  /** beat, 0x78766bf [9: 0x797c9d7]: a beat is a rise-then-fall of the truncated RMS by more than twice its trough */
  detect(): void {
    var s = 0, w0 = this.wave0, w1 = this.wave1;
    for (var i = 0; i < 1024; i++) {
      var a = w1[i] - 128, b = w0[i] - 128;
      s = a * a + (b * b + s);
    }
    this.rms = Math.sqrt(s * 0.00048828125);
    var v = ftol(this.rms), turned = false;
    if (v - this.prev > 0) {
      if (!this.rising) { turned = true; this.low = this.prev; }
      this.rising = true;
    } else {
      if (this.rising) { turned = true; this.peak = this.prev; }
      this.rising = false;
    }
    this.beat = turned && !this.rising && this.peak - this.low > this.low + this.low;
    this.prev = v;
  }
}

/** An effect object: init on first use (vt[0]), render (vt[1]); runEffect, 0x7873767 [9: 0x7979a8b], keeps its clock. */
abstract class Effect {
  inited = false;
  /** seconds this effect has run (+0x10) */
  t = 0;
  constructor(protected f: Frame) {}
  abstract init(): void;
  abstract draw(s: Surf): void;
  run(s: Surf): void {
    if (!this.inited) { this.init(); this.t = 0; }
    this.draw(s);
    this.t = this.f.dt + this.t;
  }
}

/** The border effect every preset ends with (obj+0xd60f8; init 0x7876b18, render 0x7876b83 [9: 0x797cbcb,
 *  0x797cc36]): a one-pixel black frame drawn in the screen's current mode. The DLL also keeps a W/16
 *  radial sprite tinted white-to-black by the time since the last beat, but nothing ever draws it, so
 *  it is left out. */
class Border extends Effect {
  init(): void { this.inited = true; }
  draw(s: Surf): void {
    var c = 0xff000000 | 0;
    s.line(0, 0, 1, 0, c);
    s.line(1, 0, 1, 1, c);
    s.line(1, 1, 0, 1, c);
    s.line(0, 1, 0, 0, c);
  }
}

/** Smokey Circles (obj+0xe6538; init 0x7876cbd, render 0x7876d38 [9: 0x797cd64, 0x797cddc]): the
 *  screen blurred into a scratch surface (decay 4), two pairs of waveform circles averaged in, the
 *  colours cycling blue-yellow and green-orange over 120 s, then zoomed back by 1.05. */
class SmokeyCircles extends Effect {
  tmp = new Surf();
  period = 120;
  colA = new Uint32Array(1024);
  colB = new Uint32Array(1024);
  init(): void {
    this.colA.set(gradient(0xff0000ff, 0xffffff00, 512), 0);
    this.colA.set(gradient(0xffffff00, 0xff0000ff, 512), 512);
    this.colB.set(gradient(0xff00ff00, 0xffffa000, 512), 0);
    this.colB.set(gradient(0xffffa000, 0xff00ff00, 512), 512);
    this.inited = true;
  }
  draw(s: Surf): void {
    var t = this.tmp, f = this.f;
    t.match(s);
    t.mode = 2;
    s.decay = 4;
    s.blur(t);
    var inv = 1 / this.period;
    var c1 = this.colA[ftol(inv * this.t * 1024) & 0x3ff] | 0;
    var c2 = this.colB[ftol(inv * this.t * 1126.4) & 0x3ff] | 0;
    t.circleWave(0.35, 0.5, 0.25, f.wave0, c1);
    t.circleWave(0.35, 0.5, 0.255, f.wave0, c1);
    t.circleWave(0.65, 0.5, 0.25, f.wave1, c2);
    t.circleWave(0.65, 0.5, 0.255, f.wave1, c2);
    t.zoom(s, 1.05);
  }
}

/** Smokey Lines (obj+0xf88f8; render 0x7876ea5 [9: 0x797cf45], no init): the screen blurred into a
 *  scratch surface (decay 4), two pairs of waveform traces added in (orange low, blue high), zoomed back by 1.03. */
class SmokeyLines extends Effect {
  tmp = new Surf();
  init(): void { this.inited = true; }
  draw(s: Surf): void {
    var t = this.tmp, f = this.f;
    t.match(s);
    t.mode = 1;
    s.decay = 4;
    s.blur(t);
    t.lineWave(0.5, 0.25, 1, 0.5, f.wave0, 0xffa00000 | 0);
    t.lineWave(0.5, 0.26, 1, 0.5, f.wave0, 0xffa00000 | 0);
    t.lineWave(0.5, 0.75, 1, 0.5, f.wave1, 0xff0000a0 | 0);
    t.lineWave(0.5, 0.74, 1, 0.5, f.wave1, 0xff0000a0 | 0);
    t.zoom(s, 1.03);
  }
}

/** Vox (obj+0x108cb0; render 0x7877908 [9: 0x797d900], no init): the spectrum as orange-to-yellow bars
 *  mirrored about the middle row, stored straight into the screen, then the screen blurred in place
 *  (decay 4). The object after it (obj+0x108cc8, a textured quad) is constructed but never drawn. */
class Vox extends Effect {
  init(): void { this.inited = true; }
  draw(s: Surf): void {
    var f = this.f;
    s.mode = 0;
    s.spectrum(0.5, 0.5, 1, 1, f.freq0, f.freq1, 0xffffa000 | 0, 0xffffff00 | 0, f.ver);
    s.decay = 4;
    s.blur(s);
  }
}

/** What Flame, Fountain and Spyro share (one init template, 0x7877de0 / 0x7878008 / 0x7878238 [9: 0x797e038,
 *  0x797e258, 0x797e480]): a particle list, two W/32 radial sprites (an orange one, a grey one), a camera
 *  0.7 rad down from (0, eyeY, 1), and per particle two additive sprites: itself in black-yellow-red by
 *  remaining life, and its reflection in y (black to blue). */
abstract class Particles extends Effect {
  list = new PList();
  cam = new Camera();
  sprA = new Surf();
  sprB = new Surf();
  /** +0x2c and +0x12c read as one 128-entry table, +0x22c */
  fire = new Uint32Array(128);
  blue = new Uint32Array(128);
  p = new Float64Array(P_SIZE);
  abstract cap: number;
  abstract eyeY: number;

  init(): void {
    this.list.reserve(this.cap);
    var t = new Surf(), n = (this.f.W / 32) | 0;
    t.alloc(n, n);
    t.fill(0xff000000 | 0);
    t.radial();
    var A = this.sprA, B = this.sprB;
    A.match(t); B.match(t);
    A.fill(0xff000000 | 0);
    t.mode = 1; t.setLut(0xffff0000 | 0); t.blit(A, 0, 0);
    t.setLut(0xffffff00 | 0); t.mode = 2; t.blit(A, 0, 0);
    A.mode = 1;
    B.fill(0xff000000 | 0);
    B.radial();
    B.mode = 1;
    this.fire.set(gradient(0xff000000, 0xffffff00, 64), 0);
    this.fire.set(gradient(0xffffff00, 0xffff0000, 64), 64);
    this.blue.set(gradient(0xff000000, 0xff0000ff, 128), 0);
    var c = this.cam;
    c.old = this.f.ver < 9;
    c.setViewport(1, 1);
    c.eye[0] = 0; c.eye[1] = this.eyeY; c.eye[2] = 1;
    c.off.fill(0);
    rotate(c.V, 0, 0.7, 0, 0, c.old);
    this.inited = true;
  }

  /** The draw loop every one of them ends with, last particle first. */
  drawAll(s: Surf): void {
    var L = this.list, a = L.a, c = this.cam, A = this.sprA, B = this.sprB;
    for (var i = L.count; i-- > 0;) {
      var o = i * P_SIZE, life = a[o + LIFE];
      // WMP 10 added the life == 0 guard; WMP 7-9 take ftol(NaN or -inf) = 0x80000000, so k = 0 (black: no sprite)
      var k = life === 0 && this.f.ver >= 10 ? 0x7f : ftol((life - a[o + AGE]) / life * 127) & 255;
      var q = c.project(a[o + PX], a[o + PY], a[o + PZ]);
      A.mode = 1;
      A.setLut(this.fire[k] | 0);
      A.blit(s, q[0], q[1]);
      q = c.project(a[o + PX], a[o + PY] * -1, a[o + PZ]);
      B.mode = 1;
      B.setLut(this.blue[k] | 0);
      B.blit(s, q[0], q[1]);
    }
  }
}

const SC = new Float64Array(4);

/** rand() * (1/32767) - 0.5 */
function rnd(): number { return A.rand() * 3.051850947599719e-05 - 0.5; }

/** Flame (obj+0x42df8; render 0x7876fd8 [9: 0x797d070]): six sparks a frame on a sphere of radius
 *  rms/64 under the origin, pulled up and in by a field that weakens away from the axis, life up to 3 s. */
class Flame extends Particles {
  cap = 200;
  eyeY = -0.9;
  draw(s: Surf): void {
    var f = this.f, p = this.p, L = this.list, a = L.a, i;
    for (i = 6; i > 0; i--) {
      p.fill(0);
      p[PX] = rnd(); p[PY] = rnd(); p[PZ] = rnd();
      normalize(p, PX, f.ver < 9);
      scale3(p, PX, 0.2);
      scale3(p, PX, f.rms * 0.015625);
      p[PY] = p[PY] - 0.5;
      p[VX] = rnd(); p[VY] = rnd(); p[VZ] = rnd();
      normalize(p, VX, f.ver < 9);
      scale3(p, VX, 0.2);
      p[LIFE] = A.rand() * 9.155552842799158e-05;
      L.add(p);
    }
    for (i = L.count; i-- > 0;) {
      var o = i * P_SIZE, px = a[o + PX], pz = a[o + PZ];
      var r = Math.sqrt(pz * pz + px * px), ay;
      if (r === 0) ay = -0.4;
      else { ay = -(0.15 / r); if (!(ay > -0.4)) ay = -0.4; }
      a[o + AY] = ay;
      var nx = px * -1, nz = pz * -1;
      var k = Math.sqrt(nz * nz + nx * nx) * 10;
      if (!(k < 2)) k = 2;
      a[o + AX] = nx * k;
      a[o + AZ] = k * nz;
    }
    L.step(f.dt);
    this.drawAll(s);
    s.decay = 4;
    s.blur(s);
  }
}

/** Fountain (obj+0x73ef0; render 0x7877390 [9: 0x797d3c0]): while the RMS is loud enough, sixteen drops a
 *  frame around a ring (a random angle within each sixteenth), thrown up by the RMS and falling at 6,
 *  bouncing on y = 0, life 2 s; at most 1000, the oldest culled first. */
class Fountain extends Particles {
  cap = 1000;
  eyeY = -0.7;
  draw(s: Surf): void {
    var f = this.f, p = this.p, L = this.list, i;
    L.cull(16);
    var n = f.rms * 0.2 < 0.1 ? 0 : 16;
    for (i = n; i > 0; i--) {
      p.fill(0);
      var base = i * 6.283185307179586 / 16;
      var ang = A.rand() * 3.051850947599719e-05 * 6.283185307179586 / 16 + base;
      sincos87(ang, SC);                                     // fcos / fsin, stored
      p[VX] = SC[2] + SC[3]; p[VY] = -1; p[VZ] = SC[0] + SC[1];
      normalize(p, VX, f.ver < 9);
      scale3(p, VX, 0.47);
      p[VY] = -0.3 - f.rms * 0.14285714285714285;
      p[AY] = 6;
      p[LIFE] = 2;
      L.add(p);
    }
    L.step(f.dt);
    for (i = L.count; i-- > 0;) L.bounce(i, 0);
    this.drawAll(s);
    s.decay = 12;
    s.blur(s);
  }
}

/** Spyro (obj+0xa4fe8; render 0x7877618 [9: 0x797d62f]): pairs of mirrored jets from a nozzle turning
 *  half a turn a second (one pair a frame, more as the RMS rises, at most four), under a camera that
 *  turns 0.1 rev/s about y (a sixtieth of that when no time passed); life 4 s, at most 1000. */
class Spyro extends Particles {
  cap = 1000;
  eyeY = -0.9;
  spin = 0.5;
  turn = 0.1;
  ang = 0;
  draw(s: Surf): void {
    var f = this.f, p = this.p, L = this.list;
    var n = (1 - ftol(f.rms * -0.2)) >>> 0;
    if (n >= 4) n = 4;
    var step = this.spin / 60 * 6.283185307179586;
    for (; n > 0; n--) {
      p.fill(0);
      sincos87(this.ang, SC);
      p[VX] = SC[2] + SC[3]; p[VY] = -1; p[VZ] = SC[0] + SC[1];
      normalize(p, VX, f.ver < 9);
      scale3(p, VX, 0.47);
      p[VY] = -0.3 - f.rms * 0.14285714285714285;
      p[AY] = 6;
      p[LIFE] = 4;
      L.add(p);
      p[VX] = p[VX] * -1;
      p[VZ] = p[VZ] * -1;
      L.add(p);
      this.ang = step + this.ang;
    }
    L.step(f.dt);
    var rot = f.dt * this.turn * 6.283185307179586;
    if (rot === 0) rot = 1 / 60 * this.turn * 6.283185307179586;
    rotate(this.cam.V, 0, 0, rot, 0, this.cam.old);
    for (var i = L.count; i-- > 0;) L.bounce(i, 0);
    this.drawAll(s);
    s.decay = 10;
    s.blur(s);
  }
}

class Plenoptic {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  static RESOLUTIONS: number[][] = RESOLUTIONS;

  options: Record<string, unknown>;
  f = new Frame();
  /** the screen surface, obj+0x708 (attached to the DIB's bits) */
  scr = new Surf();
  /** obj+0x6e8: the preset (0 = Random), obj+0x6ec the effect running, obj+0x6f0 Random's countdown */
  preset = 0;
  current = 0;
  countdown = 0;
  /** obj+0x6f8: frames still faded after the music stops */
  fade = 0x40;
  channels = 0;
  resolution = 0;
  tick: () => number;
  lastTick = 0;
  frame = 0;
  out: Surface = { w: 0, h: 0, px: new Uint32Array(0) };
  black = false;
  effects: Effect[];
  border: Border;
  needAlloc = true;

  constructor(cfg?: PlenopticConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    var f = this.f;
    // dispatch order, 0x7873be8 [9: 0x7979f58]: Smokey Circles, Smokey Lines, Vox, Flame, Fountain, Spyro
    this.effects = [new SmokeyCircles(f), new SmokeyLines(f), new Vox(f), new Flame(f), new Fountain(f), new Spyro(f)];
    this.border = new Border(f);
    this.channels = (cfg.channels || 0) | 0;
    f.ver = cfg.version === undefined ? 10 : +cfg.version;
    this.resolution = cfg.resolution !== undefined && cfg.resolution >= 0 && cfg.resolution < 6 ? cfg.resolution | 0 : 0;
    this.tick = cfg.tick || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.lastTick = Math.floor(this.tick()) >>> 0;                // ctor base 0x787438a: obj+0x6e0 = GetTickCount()
    if (cfg.preset) this.setPreset(cfg.preset | 0);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  /** The native size follows the resolution setting, never the window: resize() only reselects it. */
  resize(_w: number, _h: number): void {}

  /** SetCurrentPreset, 0x78733d5 [9: 0x7979723]: 0..7 accepted (7 runs only the border); nothing is reset */
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n > 7) return false;
    this.preset = n;
    return true;
  }

  /** The resolution setter, 0x78735ee [9: 0x7979925]: a change drops the DIB and every effect's init. */
  setResolution(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= 6) return false;
    if (n !== this.resolution) {
      this.resolution = n;
      this.needAlloc = true;
      for (var e of this.effects) { e.inited = false; e.t = 0; }
      this.border.inited = false; this.border.t = 0;
    }
    return true;
  }

  /** Render, 0x7873e8d [9: 0x797a1d6] */
  render(L: TimedLevel): Surface | null {
    var f = this.f, s = this.scr;
    // frame setup, 0x78734ee [9: 0x7979830]
    f.freq0.set(L.freq[0]); f.freq1.set(L.freq[1]);
    f.wave0.set(L.wave[0]); f.wave1.set(L.wave[1]);
    f.state = L.state;
    if (this.channels === 1) { f.freq1.set(f.freq0); f.wave1.set(f.wave0); }
    var now = Math.floor(this.tick()) >>> 0;
    f.dt = ((now - this.lastTick) >>> 0) * 0.001;
    this.lastTick = now;
    if (f.state !== 2) f.dt = 0;
    f.detect();
    // the DIB, (re)made when missing: zeroed by CreateDIBSection; the surface's state reset
    if (this.needAlloc) {
      this.needAlloc = false;
      var r = RESOLUTIONS[this.resolution];
      f.W = r[0]; f.H = r[1];
      s.reset();
      s.alloc(r[0], r[1]);
      this.out = { w: r[0], h: r[1], px: new Uint32Array(r[0] * r[1]) };
    }
    this.black = false;
    if (f.ver < 8 && f.state === 1) this.dispatch();       // WMP 7.0/7.1 (wmpui.dll 0x5253a3ea): paused still draws
    else if (f.state >= 0) {
      if (f.state < 2) {
        if (this.fade < 1) this.black = true;               // FillRect black, the DIB is not blitted
        else { this.fade--; s.blur(s); }
      } else if (f.state === 2) {
        this.fade = 0x40;
        this.dispatch();
      }
    }
    this.frame++;
    return this.present();
  }

  /** dispatch, 0x7873be8 [9: 0x7979f58]: Random redraws an effect every 120 s of play */
  dispatch(): void {
    var s = this.scr;
    if (this.preset === 0) {
      if (!(0 < this.countdown)) {
        this.countdown = 120;
        this.current = A.rand() % 6;
      }
      this.countdown = this.countdown - this.f.dt;
    } else this.current = this.preset - 1;
    if (this.current < 6) this.effects[this.current].run(s);
    this.border.run(s);
  }

  /** The DIB as the window shows it: rows flipped to top-down, alpha byte cleared. */
  present(): Surface {
    var o = this.out, w = o.w, h = o.h, d = o.px;
    if (this.black) { d.fill(0); return o; }
    var src = this.scr.px;
    for (var y = 0; y < h; y++) {
      var si = (h - 1 - y) * w, di = y * w;
      for (var x = 0; x < w; x++) d[di + x] = src[si + x] & 0xffffff;
    }
    return o;
  }

  debug(): Record<string, unknown> {
    return {
      engine: 'Plenoptic', preset: this.preset, presetName: PRESET_NAMES[this.preset] || '(border only)',
      effect: this.current, size: this.scr.w + 'x' + this.scr.h, frame: this.frame,
      rms: this.f.rms, beat: this.f.beat, countdown: this.countdown, fade: this.fade,
    };
  }
}

A.Plenoptic = Plenoptic;
export { Plenoptic };
