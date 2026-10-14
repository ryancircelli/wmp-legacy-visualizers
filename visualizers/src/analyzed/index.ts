// Alchemy.Analyzed — "Analyzed", Marko Mihovilic's (Miha Software) visualization plug-in for Windows Media Player
// 10 and 11 (Analyzed.dll 0.5.1.0, 2009; CLSID CE097244-9355-4CF2-8890-0161227E14CF, Effects key Analyzed), the
// successor to his "Barr". Our own implementation of what that binary does, written from its machine code; frame
// for frame the same pixels as the DLL drawing on Microsoft's Direct3D 9 reference rasterizer.
//
// Licence: Analyzed is freeware, "Copyright Marko Mihovilic 2007/2009. All Rights Reserved", redistributable
// unmodified, not to be modified without the author's consent (his download page). Nothing of the DLL is in
// this repository: this is a reimplementation of its behaviour, the owner's call.
//
// What it is: 32 spectrum bars (each the mean of 32 of WMP's 1024 frequency bins, both channels) or the
// waveform, eased towards each new frame by 0.3 per 60th of a second, with falling peaks, drawn as Direct3D 9
// quads (pre-transformed, vertex colours) into an offscreen buffer of 256x192, 384x288, 512x384 (the default) or
// 1024x768, which Present stretches to the window. Blur (on by default) keeps the picture in a render-target
// texture: each frame it is shrunk to half size and back (bilinear both ways), faded by dt/50 (reverse
// subtract), the bars drawn over it, and the texture drawn to the back buffer. Colours: the property page's
// three schemes (blue, the default; red; green). The animation runs on the clock (the DLL's own render thread,
// QueryPerformanceCounter, dt in 60ths of a second); `now` gives that clock in microseconds.
// The DLL draws through the GPU; the port draws as Microsoft's Direct3D 9 reference rasterizer does (./ref9.ts).
import { A, type Surface, type TimedLevel } from '../ns';
import { Blend, Ref9, type Target } from './ref9';

const PRESET_NAMES = ['Line Bars', 'Mirror Bars', 'Digital Bars', 'Line Ghost Bars', 'Mirror Ghost Bars', 'Digital Ghost Bars',
  'Bar Scope', 'Dot Scope'];
/** the Resolution setting (0x10002ad0): 0-3 */
const SIZES: readonly [number, number][] = [[256, 192], [384, 288], [512, 384], [1024, 768]];
export type AnalyzedColor = 'blue' | 'red' | 'green';

const f32 = Math.fround;
/** a colour as the DLL keeps it: [a, r, g, b] floats */
type Col = [number, number, number, number];
const col = (r: number, g: number, b: number): Col => [1, f32(r), f32(g), f32(b)];
/** 0x10006560: D3DCOLOR, each channel trunc(c * 255) */
const dword = (c: Col): number =>
  (((Math.trunc(c[0] * 255) & 0xff) << 24) | ((Math.trunc(c[1] * 255) & 0xff) << 16)
    | ((Math.trunc(c[2] * 255) & 0xff) << 8) | (Math.trunc(c[3] * 255) & 0xff)) >>> 0;
/** Create (0x10002bc0) reads each colour back from its D3DCOLOR: byte / 255 */
const fromDword = (d: number): Col => [f32((d >>> 24) / 255), f32(((d >>> 16) & 0xff) / 255), f32(((d >>> 8) & 0xff) / 255), f32((d & 0xff) / 255)];
/** 0x10006690 per channel: a + (b - a) * t, stored as a float */
const lerp = (a: Col, b: Col, t: number): Col =>
  [f32(a[0] + (b[0] - a[0]) * t), f32(a[1] + (b[1] - a[1]) * t), f32(a[2] + (b[2] - a[2]) * t), f32(a[3] + (b[3] - a[3]) * t)];

/** the schemes (0x100010d0): top, top end, bottom, bottom end, background, peak. Blue is the constructor's
 *  floats (0x10007940); red and green are the property page's D3DCOLORs. */
const SCHEMES: Record<AnalyzedColor, readonly number[]> = {
  blue: [col(0.2, 0.3, 0.7), col(0.3, 0.4, 0.9), col(0.1, 0.2, 0.4), col(0.2, 0.3, 0.7), col(0, 0, 0), col(0.4, 0.5, 0.9)].map(dword),
  red: [0xffeb2121, 0xfffa5151, 0xffa42929, 0xffad4444, 0xff000000, 0xffff2211],
  green: [0xff20a42d, 0xff0e971b, 0xff39a843, 0xff23842c, 0xff000000, 0xff22ff11],
};

/** Analyzed's own settings, read from the options object the shell hands every engine */
export interface AnalyzedOptions {
  /** the offscreen buffer: 0 256x192, 1 384x288, 2 512x384 (default), 3 1024x768 */
  analyzedResolution?: number;
  analyzedColor?: AnalyzedColor;
  /** default on */
  analyzedBlur?: boolean;
}

export interface AnalyzedConfig {
  width?: number;
  height?: number;
  options?: object;
  preset?: number;
  /** QueryPerformanceCounter in microseconds (default: performance.now()) */
  now?: () => number;
}

type Rect = [number, number, number, number];
const VSTRIDE = 28;

class Analyzed {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  /** the buffer's size for these options (the Resolution setting) */
  static size(o?: AnalyzedOptions): [number, number] { return [...(SIZES[o?.analyzedResolution ?? 2] ?? SIZES[2])]; }
  preset = 0;
  w = 0;
  h = 0;
  options: AnalyzedOptions;
  readonly ref = new Ref9();
  /** the buffer's size (the back buffer's) */
  readonly W: number;
  readonly H: number;
  readonly blur: boolean;
  private now: () => number;
  private last: number;
  private dt = 0;
  private frames = 0;
  private top: Col; private topEnd: Col; private bottom: Col; private bottomEnd: Col; private bg: Col; private peak: Col;
  // the analysis (0x634 target bars, 0x638 bars, 0x63c target wave, 0x640 wave, 0x644 peaks: pos, speed, hold)
  private barsIn = new Float32Array(32);
  private bars = new Float32Array(32);
  private waveIn = new Float32Array(1024);
  private wave = new Float32Array(1024);
  private peaks = new Float32Array(96);
  // Direct3D: the back buffer and the blur's render-target textures (X8R8G8B8)
  private bb: Target;
  private rt: Target;
  private full: Target | null = null;
  private half: Target | null = null;
  private verts = new ArrayBuffer(VSTRIDE * 0x8000);
  private vf = new Float32Array(this.verts);
  private vu = new Uint32Array(this.verts);
  private nv = 0;
  private tex: Target | null = null;
  private blend = Blend.Over;
  private out: Surface;

  constructor(cfg: AnalyzedConfig = {}) {
    this.options = cfg.options || {};
    const o = this.options;
    [this.W, this.H] = Analyzed.size(o);
    this.blur = o.analyzedBlur !== false;
    const s = SCHEMES[o.analyzedColor ?? 'blue'] ?? SCHEMES.blue;
    [this.top, this.topEnd, this.bottom, this.bottomEnd, this.bg, this.peak] = s.map(fromDword);
    this.now = cfg.now ?? ((): number => Math.floor(performance.now() * 1000));
    this.last = this.now();
    this.out = { w: this.W, h: this.H, px: new Uint32Array(this.W * this.H) };
    this.bb = this.rt = { w: this.W, h: this.H, px: this.out.px };
    // 0x10006ca0: the two textures (the full one ColorFill'd black); the device's states are the ones ref9.ts draws
    // with: alpha blending SRCALPHA / INVSRCALPHA, MODULATE(TEXTURE, DIFFUSE) for colour and alpha, bilinear,
    // clamped, no z, FVF XYZRHW | DIFFUSE | TEX1
    if (this.blur) {
      this.full = { w: this.W, h: this.H, px: new Uint32Array(this.W * this.H) };
      this.half = { w: this.W >>> 1, h: this.H >>> 1, px: new Uint32Array((this.W >>> 1) * (this.H >>> 1)) };
    }
    if (cfg.preset) this.setPreset(cfg.preset);
    this.resize(cfg.width || this.W, cfg.height || this.H);
  }

  /** the CRT's rand is never drawn from */
  seed(_n: number): this { return this; }

  /** the window's size: the DLL draws at its buffer's size whatever the window */
  resize(w: number, h: number): void { this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0); }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return true;
  }

  /** RenderWindowed 0x10008620: the new frame's targets (not while paused) */
  private ingest(l: TimedLevel): void {
    if (l.state === 1) return;
    const f0 = l.freq[0], f1 = l.freq[1], w0 = l.wave[0], w1 = l.wave[1];
    for (let b = 0; b < 32; b++) {
      let s = 0;
      for (let j = b * 32; j < b * 32 + 32; j++) s = f32(s + (f0[j] + f1[j]) * 0.5);
      this.barsIn[b] = f32(f32(s * 0.03125) * 2);
    }
    for (let i = 0; i < 1024; i++) this.waveIn[i] = (w0[i] + w1[i]) * 0.5 - 128;
  }

  /** the render thread's clock 0x100067b0 and animation 0x10006840 (the SSE path) */
  private tick(): void {
    const t = this.now();
    this.dt = 60 * ((t - this.last) / 1000000);
    this.last = t;
    const dt = this.dt;
    const x = f32(0.3) * dt, k = f32(x >= 1 ? 1 : x);
    const ease = (to: Float32Array, from: Float32Array): void => {
      for (let i = 0; i < to.length; i++) to[i] = f32(to[i] + f32(f32(from[i] - to[i]) * k));
    };
    ease(this.bars, this.barsIn);
    ease(this.wave, this.waveIn);
    const p = this.peaks, g = f32(-0.2);
    for (let i = 0; i < 32; i++) {
      const o = i * 3;
      if (0 < p[o + 2]) p[o + 2] = f32(p[o + 2] - (dt < 1 ? dt : 1));
      else {
        p[o] = f32((dt < 1 ? dt : 1) * p[o + 1] + p[o]);
        p[o + 1] = f32((dt < 1 ? dt : 1) * g + p[o + 1]);
      }
      if (p[o] < this.bars[i]) { p[o] = this.bars[i]; p[o + 1] = 0; p[o + 2] = 15; }
    }
  }

  // ---- 0x100072c0: a quad as two triangles, corners at the pixel edges (-0.5), z 0.5, rhw 1
  private quad(r: Rect, tl: Col, tr: Col, br: Col, bl: Col, tex: Target | null): void {
    if (this.nv && (this.nv + 6 > 0x7fff || this.tex !== tex)) this.flush();
    this.tex = tex;
    const [l, t, rr, b] = r;
    this.vtx(l, t, dword(tl), 0, 0);
    this.vtx(rr, t, dword(tr), 1, 0);
    this.vtx(rr, b, dword(br), 1, 1);
    this.vtx(rr, b, dword(br), 1, 1);
    this.vtx(l, b, dword(bl), 0, 1);
    this.vtx(l, t, dword(tl), 0, 0);
  }
  private vtx(x: number, y: number, c: number, u: number, v: number): void {
    const o = this.nv++ * 7, f = this.vf;
    f[o] = x - 0.5; f[o + 1] = y - 0.5; f[o + 2] = 0.5; f[o + 3] = 1;
    this.vu[o + 4] = c; f[o + 5] = u; f[o + 6] = v;
  }
  /** 0x10007030 */
  private flush(): void {
    if (!this.nv) return;
    this.ref.draw(this.rt, this.vf, this.vu, this.nv, this.tex, this.blend);
    this.nv = 0;
  }
  private solid = (r: Rect, c: Col): void => this.quad(r, c, c, c, c, null);
  private gradient = (r: Rect, top: Col, bottom: Col): void => this.quad(r, top, top, bottom, bottom, null);
  /** 0x10009c00: the rectangle's one-pixel outline, each side with the corners (tl, tr, tl, bl) */
  private outline(r: Rect, tl: Col, tr: Col, bl: Col): void {
    const [l, t, rr, b] = r;
    this.quad([l, t, rr, t + 1], tl, tr, tl, bl, null);
    this.quad([l, b - 1, rr, b], tl, tr, tl, bl, null);
    this.quad([l, t + 1, l + 1, b - 1], tl, tr, tl, bl, null);
    this.quad([rr - 1, t + 1, rr, b - 1], tl, tr, tl, bl, null);
  }
  private ghostSolid = (r: Rect, c: Col): void => this.outline(r, c, c, c);
  private ghostGradient = (r: Rect, top: Col, bottom: Col): void => this.outline(r, top, top, bottom);

  /** 0x10009d40 (Line Bars, Line Ghost Bars) */
  private lineBars(bar: (r: Rect, top: Col, bottom: Col) => void, peak: (r: Rect, c: Col) => void): void {
    const H = this.H, sH = f32(H / 384), sw = f32((this.W - 2) * 0.03125), q = f32(sw * 0.25), m = f32(sH + sH);
    const bw = sw * f32(0.8);
    for (let i = 0; i < 32; i++) {
      const t = f32(i * 0.03125);
      const a = lerp(this.bottom, this.bottomEnd, t), b = lerp(this.top, this.topEnd, t);
      const left = Math.trunc(i * sw + m), right = Math.trunc(left + bw);
      const top = Math.trunc((H - 2) - this.bars[i] * sH), bottom = H - 2;
      bar([left, top, right, bottom], lerp(a, b, f32((bottom - top) / H)), a);
      const pb = Math.trunc((H - 2) - this.peaks[i * 3] * sH);
      peak([left, Math.trunc(pb - q), right, pb], this.peak);
    }
  }

  /** 0x1000a060 (Mirror Bars, Mirror Ghost Bars): about the middle, a peak each side */
  private mirrorBars(bar: (r: Rect, top: Col, bottom: Col) => void, peak: (r: Rect, c: Col) => void): void {
    const H = this.H, sH = f32(H / 384), sw = f32((this.W - 2) * 0.03125), q = f32(sw * 0.25), m = f32(sH + sH);
    const bw = sw * f32(0.8);
    for (let i = 0; i < 32; i++) {
      const t = f32(i * 0.03125);
      const a = lerp(this.bottom, this.bottomEnd, t), b = lerp(this.top, this.topEnd, t);
      const left = Math.trunc(i * sw + m), right = Math.trunc(left + bw);
      const vs = this.bars[i] * sH;
      const bottom = Math.trunc(H * 0.5 + vs * 0.5), top = Math.trunc(bottom - vs);
      bar([left, top, right, bottom], lerp(a, b, f32((bottom - top) / H)), a);
      const ps = this.peaks[i * 3] * sH;
      const b1 = Math.trunc(H * 0.5 - ps * 0.5);
      peak([left, Math.trunc(b1 - q), right, b1], this.peak);
      const b2 = Math.trunc(H * 0.5 + ps * 0.5 + q);
      peak([left, Math.trunc(b2 - q), right, b2], this.peak);
    }
  }

  /** 0x1000a430 (Digital Bars, Digital Ghost Bars): segments, the top one as translucent as it is partial */
  private digitalBars(seg: (r: Rect, c: Col) => void): void {
    const H = this.H, sH = f32(H / 384), sw = f32((this.W - 2) * 0.03125), q = f32(sw * 0.25), m = f32(sH + sH);
    const pitch = m + q, k = f32(sH / pitch), bw = sw * f32(0.8);
    for (let i = 0; i < 32; i++) {
      const t = f32(i * 0.03125);
      const a = lerp(this.bottom, this.bottomEnd, t), b = lerp(this.top, this.topEnd, t);
      const n = this.bars[i] * k;
      const left = Math.trunc(i * sw + m), right = Math.trunc(left + bw);
      if (n > 0) {
        for (let j = 0; j === 0 || j < n; j++) {
          const bottom = Math.trunc((H - j * pitch) - m), top = Math.trunc(bottom - q);
          const c = lerp(a, b, f32(top / H)), al = n - j;
          c[0] = f32(al >= 1 ? 1 : al);
          seg([left, top, right, bottom], c);
        }
      }
      const pn = Math.trunc(this.peaks[i * 3] * k);
      const pb = Math.trunc((H - pn * pitch) - m);
      seg([left, Math.trunc(pb - q), right, pb], this.peak);
    }
  }

  /** 0x1000aae0 (Bar Scope): 128 columns about the middle, |wave| high */
  private barScope(): void {
    const H = this.H, sH = f32(H / 384), sw = f32((this.W - 2) * 0.0078125);
    const x0 = sw * f32(0.2), bw = sw * f32(0.8), mid = H >>> 1;
    for (let i = 0; i < 128; i++) {
      const t = f32(i * 0.0078125);
      const a = lerp(this.bottom, this.bottomEnd, t), b = lerp(this.top, this.topEnd, t);
      const left = Math.trunc(i * sw + x0), right = Math.trunc(left + bw);
      const n = Math.trunc(Math.abs(this.wave[i * 8]) * sH);
      let bottom = n + mid, top = mid - n;
      if (bottom < top) [bottom, top] = [top, bottom];
      this.gradient([left, top, right, bottom], lerp(a, b, f32((bottom - top) / H)), a);
    }
  }

  /** 0x1000a8a0 (Dot Scope): 256 dots at the wave's height */
  private dotScope(): void {
    const H = this.H, sH = f32(H / 384), sw = f32((this.W - 2) * 0.0078125);
    const step = sw * 0.5, dh = f32(sw * 0.5), x0 = sw * f32(0.2), bw = sw * f32(0.8), mid = H >>> 1;
    for (let i = 0; i < 256; i++) {
      const t = f32(i * 0.00390625);
      const a = lerp(this.bottom, this.bottomEnd, t), b = lerp(this.top, this.topEnd, t);
      const left = Math.trunc(i * step + x0), right = Math.trunc(left + bw);
      const bottom = mid - Math.trunc(this.wave[i * 4] * sH), top = Math.trunc(bottom - dh);
      this.solid([left, top, right, bottom], lerp(b, a, f32(top / H)));
    }
  }

  /** the preset's Render (each class's one virtual method) */
  private drawVis(): void {
    switch (this.preset) {
      case 0: this.lineBars(this.gradient, this.solid); break;
      case 1: this.mirrorBars(this.gradient, this.solid); break;
      case 2: this.digitalBars(this.solid); break;
      case 3: this.lineBars(this.ghostGradient, this.ghostSolid); break;
      case 4: this.mirrorBars(this.ghostGradient, this.ghostSolid); break;
      case 5: this.digitalBars(this.ghostSolid); break;
      case 6: this.barScope(); break;
      default: this.dotScope();
    }
  }

  /** 0x10007dc0: one frame, as the render thread draws it */
  private draw(): void {
    const W = this.W, H = this.H, white: Col = [1, 1, 1, 1];
    if (!this.blur) {
      this.ref.clear(this.bb, dword(this.bg));
      this.drawVis();
      this.flush();
      return;
    }
    const full = this.full as Target, half = this.half as Target;
    // shrink the picture to the half-size texture and back (bilinear both ways)
    this.rt = half;
    this.ref.clear(half, 0);
    this.quad([0, 0, W >>> 1, H >>> 1], white, white, white, white, full);
    this.flush();
    this.rt = full;
    this.quad([0, 0, W, H], white, white, white, white, half);
    this.flush();
    // fade: SRCALPHA, ONE, REVSUBTRACT with alpha dt/50
    this.blend = Blend.Fade;
    const x = this.dt / 50, fade: Col = [f32(x > 1 ? 1 : x < 0 ? 0 : x), 1, 1, 1];
    this.quad([0, 0, W, H], fade, fade, fade, fade, null);
    this.flush();
    this.blend = Blend.Over;
    this.drawVis();
    this.flush();
    this.rt = this.bb;
    this.quad([0, 0, W, H], white, white, white, white, full);
    this.flush();
  }

  render(level: TimedLevel): Surface | null {
    if (level) this.ingest(level);
    this.tick();
    this.draw();
    this.frames++;
    return this.out;
  }

  debug(): Record<string, unknown> {
    return { engine: 'Analyzed', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.W + 'x' + this.H,
      blur: this.blur, frames: this.frames };
  }
}

declare module '../ns' {
  interface AlchemyNS {
    Analyzed: typeof Analyzed;
  }
}
A.Analyzed = Analyzed;
export { Analyzed };
