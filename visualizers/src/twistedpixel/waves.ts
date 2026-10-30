// TwistedPixel's waves: the eight built-in wave modes and their blend across a preset transition, custom waveforms
// (ProcessWaveform / AddWaveformElement) and motion vectors, in Direct3D canvas mode. Every float operation is one
// x87 instruction at 24-bit precision (see fpu.ts); FSIN/FCOS results enter at 64 bits.
// Built-in waves are computed in the frame update (wave object vtable+8, 0x10017bf0) into a point array that persists
// across frames; the render draws that array (0x10019ce0), then runs the custom waveforms, which call the script
// from inside the scene.
import { Prim, type Buffer, type Device } from '../d3d8/api';
import { sincos87 } from '../plenoptic/x87';
import { add24, sub24, mul24, div24, mulx24, f32x } from './fpu';
import { V } from './vars';
import type { Audio } from './audio';

const f = Math.fround;
const SC = new Float64Array(4);   // [sinHi, sinLo, cosHi, cosLo] of the last FSIN/FCOS
const LINESTRIP = Prim.LINESTRIP, POINTLIST = Prim.POINTLIST;
const RS_SRCBLEND = 19, RS_DESTBLEND = 20, RS_ALPHABLENDENABLE = 27, FVF = 0x44;

/** _ftol (0x10028820): FISTP qword with truncation, low 32 bits returned (indefinite gives 0) */
export function ftolq(v: number): number {
  return v > -9223372036854775808 && v < 9223372036854775808 ? Math.trunc(v) | 0 : 0;
}
/** 0x1000ee60: a / b, or 0 when b is 0 */
const ratio = (a: number, b: number): number => b === 0 ? 0 : div24(a, b);

/** 0x10010320: the shape and motion-vector colour, premultiplied by alpha */
export function rgbaColor(r: number, g: number, b: number, a: number): number {
  const c = (x: number): number => ftolq(mul24(mul24(x, a), 255)) & 0xff;
  return ((ftolq(mul24(a, 255)) & 0xff) << 24 | c(r) << 16 | c(g) << 8 | c(b)) >>> 0;
}

/** 0x1000ffe0 (D3D branch): a wave colour from the context's alpha-by-volume and maximize settings. `mode` is the
 *  wave mode (ftol of tp_nWaveMode) for the context's own colour, -1 for an AddWaveformElement point.
 *  An AddWaveformElement point is computed inside the script's call (DispCallFunc from vbscript.dll), where the x87
 *  control word is 0x027F: 53-bit precision (measured at 0x10025f00 and 0x1000ffe0 by the private harness; the frame
 *  code runs at 0x007F). There every FADD/FMUL/FDIV rounds to a double; values the DLL stores (fstp dword) are
 *  float32, the maximized blue and the alpha scale stay in the register: `x53` selects that precision. */
export function waveColor(v: Float32Array, r: number, g: number, b: number, alpha: number, mode: number, x53 = false): number {
  const mul = x53 ? (p: number, q: number): number => p * q : mul24;
  const add = x53 ? (p: number, q: number): number => p + q : add24;
  const sub = x53 ? (p: number, q: number): number => p - q : sub24;
  const div = x53 ? (p: number, q: number): number => q === 0 ? 0 : p / q : ratio;
  let a = alpha;
  if (v[V.bModWaveAlphaByVolume] !== 0) {
    const vol = v[V.volume], t = f(add(mul(vol, 0.5), vol)), s = v[V.fModWaveAlphaStart], e = v[V.fModWaveAlphaEnd];
    if (t < s) a = v[V.fWaveAlpha];
    else if (t > e) a = 1;
    else a = f(mul(div(sub(t, s), sub(e, s)), alpha));
  }
  if (mode === 5 || mode === 2) a = f(mul(a, 0.125));
  if (mode === 3) a = 1;
  else if (a > 1) a = 1;
  else if (a < f(0.01)) a = f(0.01);
  if (v[V.bMaximizeWaveColor] !== 0) {
    let mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
    let sc = div(1, mx);
    if (sc < 1) sc = 1;
    r = f(mul(sc, r)); g = f(mul(sc, g)); b = mul(sc, b);
  }
  const cl = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x;
  r = cl(r); g = cl(g); b = cl(b);
  let A = mul(a, 255);
  A = A < 0 ? 0 : A > 255 ? 255 : A;
  const c = (x: number): number => ftolq(mul(x, A)) & 0xff;
  return ((ftolq(A) & 0xff) << 24 | c(r) << 16 | c(g) << 8 | c(b)) >>> 0;
}
/** the context's own wave colour, as 0x1000f780 stores it at ctx+0x224 at the end of its frame code */
export function ctxWaveColor(v: Float32Array): number {
  return waveColor(v, v[V.wave_r], v[V.wave_g], v[V.wave_b], v[V.fWaveAlpha], ftolq(v[V.nWaveMode]));
}

const PTS = 1100;
// The three point arrays the DLL keeps back to back (0x10046840 primary, 0x1004be30 secondary, 0x10051420 the
// second line of mode 7), 1100 points of 20 bytes (x, y, z, rhw, colour) each; offsets below are in floats.
const PRIM = 0, SEC = PTS * 5, LINE2 = 2 * PTS * 5;

export class Waves {
  /** wave object +0x1c, +0x20 */
  mode = 0;
  nextMode = 0;
  /** 0x10056a10, 0x10056a14 */
  count = 0;
  count2 = 0;
  private readonly mem = new ArrayBuffer(3 * PTS * 20);
  private readonly f32 = new Float32Array(this.mem);
  private readonly u32 = new Uint32Array(this.mem);
  private readonly u8 = new Uint8Array(this.mem);
  // motion vectors: 0x10065c4c (drawn), 0x10065c48 (count), 0x10056a18 (points)
  private mvOn = 0;
  private mvCount = 0;
  private readonly mv = new ArrayBuffer(64 * 48 * 20);
  private readonly mvF = new Float32Array(this.mv);
  private readonly mvU = new Uint32Array(this.mv);
  private w7c = 0;
  private w78 = 0;

  /** W, H: the canvas texture size (wave object +0x10/+0x14, the same as 0x1003e430/434). `audio`: the engine's
   *  audio state, whose smoothed waves (0x100142f0) and right-channel peak (0x10013d20, DAT_10043220) the modes read. */
  constructor(readonly W: number, readonly H: number, private readonly audio: Audio) {}

  /** 0x10017ba0, from the preset loader with ftol of the incoming preset's tp_nWaveMode. Draws one rand() when
   *  the mode is neither -1 nor 0..7. */
  setNextMode(v: number, rand: () => number): void {
    this.nextMode = v;
    if (v !== -1 && (v < 0 || v > 7)) this.nextMode = ((rand() * 7) / 0x7fff) | 0;
  }
  /** 0x10017b80, when the transition ends (before the contexts swap): the next mode becomes current, and `cur`
   *  (the context current at that moment, i.e. the outgoing one) gets it as tp_nWaveMode. */
  commitMode(cur: Float32Array): void {
    this.mode = this.nextMode;
    cur[V.nWaveMode] = this.mode;
  }

  /** vtable+8 (0x10017bf0), in the frame update after the script: motion vectors, then the built-in wave into the
   *  primary array and, during a transition into a different preset, its blend with the next preset's mode.
   *  `color` is the current context's wave colour (ctx+0x224), `time` its ctx+0x230; `w7c`/`w78` the transition
   *  weights (0x1006727c/0x10067278). */
  update(cur: Float32Array, color: number, time: number, transition: boolean, w7c: number, w78: number): void {
    this.computeMV(cur);
    if (this.mode === -1) return;
    this.w7c = w7c; this.w78 = w78;
    this.build(PRIM, cur, color, time, this.mode);
    if (transition && this.nextMode !== -1) {
      const n1 = this.count;
      this.build(SEC, cur, color, time, this.nextMode);
      const n2 = this.count;
      this.count = n1;
      this.count = this.blend(n1, n2);
    }
  }

  /** 0x10019ce0, in the scene after the shapes: the built-in wave from the primary array, its thick, stereo and
   *  mode-7 passes, then the custom waveforms. `vb` is the canvas wave buffer (+0x114). */
  draw(dev: Device, vb: Buffer, cur: Float32Array, processWaveform: () => boolean): void {
    dev.setStreamSource(0, vb, 20);
    dev.setVertexShader(FVF);
    dev.setRenderState(RS_ALPHABLENDENABLE, 1);
    if (cur[V.nWaveMode] === -1) { this.custom(dev, vb, cur, processWaveform); return; }
    const n = this.count, size = n * 20, stereo = cur[V.bRedBlueStereo] !== 0;
    let m = vb.lock(0, size, 0);
    copy(m, this.u8, 0, size);
    if (stereo) { const d = dv(m); for (let i = 0; i < n; i++) d.setUint32(i * 20 + 16, 0xa00000, true); }
    vb.unlock();
    this.blendStates(dev, cur);
    this.strip(dev, cur, n);
    if (cur[V.bWaveThick] !== 0) this.thick(dev, vb, cur);
    if (stereo) {
      m = vb.lock(0, size, 0);
      copy(m, this.u8, 0, size);
      const d = dv(m), off = mul24(this.W, f(0.01));
      for (let i = 0; i < n; i++) {
        d.setFloat32(i * 20, sub24(d.getFloat32(i * 20, true), off), true);
        d.setUint32(i * 20 + 16, 0xf0ff, true);
      }
      vb.unlock();
      dev.drawPrimitive(LINESTRIP, 0, n - 1);
    }
    if (cur[V.nWaveMode] === 7) {
      const n2 = this.count2;
      m = vb.lock(0, n2 * 20, 0);
      copy(m, this.u8, LINE2 * 4, n2 * 20);
      vb.unlock();
      this.strip(dev, cur, n2);
    }
    this.custom(dev, vb, cur, processWaveform);
  }

  /** AddWaveformElement (0x10025f00): point `ord` (a script Integer) of the custom waveform */
  addWaveformElement(cur: Float32Array, ord: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
    const i = ((ord << 16) >> 16) * 5;
    if (i >= 0 && i + 5 <= this.f32.length) {   // ponytail: the DLL writes wherever ord points; out of range is dropped here
      this.f32[i] = mul24(this.W, x);
      this.f32[i + 1] = mul24(this.H, y);
      this.f32[i + 2] = 1; this.f32[i + 3] = 1;
      this.u32[i + 4] = waveColor(cur, r, g, b, a, -1, true);   // inside the script's call: 53-bit precision
    }
    this.count++;
  }

  /** 0x1001a450, in the scene after the waves. `vb`: the canvas point buffer (+0x108). */
  drawMotionVectors(dev: Device, vb: Buffer | null, cur: Float32Array): void {
    if (!this.mvOn || !vb) return;
    dev.setStreamSource(0, vb, 20);
    dev.setVertexShader(FVF);
    dev.setRenderState(RS_ALPHABLENDENABLE, 1);
    const n = this.mvCount, m = vb.lock(0, n * 20, 0);
    copy(m, new Uint8Array(this.mv), 0, n * 20);
    vb.unlock();
    this.blendStates(dev, cur);
    dev.drawPrimitive(POINTLIST, 0, n);
  }

  // 0x10019fb0: custom waveforms, up to 1000 per frame, while ProcessWaveform returns True. Each copies a fixed
  // number of points (the count when the render reached it) into the buffer, whatever the custom count.
  private custom(dev: Device, vb: Buffer, cur: Float32Array, processWaveform: () => boolean): void {
    const size = this.count * 20;
    for (let it = 0; it < 1000; it++) {
      this.count = 0;
      const more = processWaveform();
      if (this.count === 0) return;
      const m = vb.lock(0, size, 0);
      copy(m, this.u8, 0, size);
      vb.unlock();
      this.blendStates(dev, cur);
      this.strip(dev, cur, this.count);
      if (cur[V.bWaveThick] !== 0) this.thick(dev, vb, cur);
      if (!more) return;
    }
  }

  // 0x10019b00
  private blendStates(dev: Device, cur: Float32Array): void {
    dev.setRenderState(RS_SRCBLEND, 2);
    dev.setRenderState(RS_DESTBLEND, cur[V.bAdditiveWaves] !== 0 ? 2 : 6);
  }
  private strip(dev: Device, cur: Float32Array, n: number): void {
    if (cur[V.bWaveDots] === 0) dev.drawPrimitive(LINESTRIP, 0, n - 1);
    else dev.drawPrimitive(POINTLIST, 0, n);
  }
  // 0x10019b70: four more passes, x-1 and x+1 (only x rewritten), then y-1 and y+1 (x stays at x+1)
  private thick(dev: Device, vb: Buffer, cur: Float32Array): void {
    const n = this.count, size = n * 20;
    for (let k = 0; k < 2; k++) {
      for (let d = -1; d <= 1; d += 2) {
        const v = dv(vb.lock(0, size, 0));
        for (let i = 0; i < n && i * 20 + 8 <= v.byteLength; i++) v.setFloat32(i * 20 + 4 * k, add24(d, this.f32[PRIM + i * 5 + k]), true);
        vb.unlock();
        this.strip(dev, cur, this.count);
      }
    }
  }

  private pt(base: number, i: number, x: number, y: number, color: number): void {
    const o = base + i * 5;
    this.f32[o] = x; this.f32[o + 1] = y; this.f32[o + 2] = 1; this.f32[o + 3] = 1; this.u32[o + 4] = color;
  }

  // 0x10018590: the builders, into `base`
  private build(base: number, cur: Float32Array, color: number, time: number, mode: number): void {
    const W = this.W, H = this.H, L = this.audio.waveL, R = this.audio.waveR;
    const x = cur[V.wave_x], y = cur[V.wave_y], scale = cur[V.fWaveScale], p = cur[V.fWaveParam];
    const cy = sub24(H, mul24(H, y)), cx = mul24(W, x);
    switch (mode) {
      case 2: case 3: {   // 0x10017dd0
        const s = mul24(mul24(W, scale), 0.5);
        this.count = 0;
        for (let i = 0; i < 544; i++) { this.pt(base, i, add24(mul24(s, R[i]), cx), sub24(cy, mul24(s, L[i + 32])), color); this.count++; }
        return;
      }
      case 4: {   // 0x10017e70
        const xo = mul24(sub24(x, 0.5), W), yb = mul24(sub24(1, y), H), a = mul24(mul24(W, scale), 0.25);
        const dx = mul24(W, f(0.0057803467)), k = mul24(this.audio.maxR, f(0.2));
        this.count = 0;
        for (let i = 0; i < 173; i++) {
          const t = mul24(i, dx);
          if (ftolq(t) > W) return;
          const q = mul24(a, L[i + 32]);
          sincos87(mul24(t, f(0.15915494)), SC);
          this.pt(base, i, add24(add24(mul24(mul24(R[i], f(1.33)), a), t), xo), add24(sub24(yb, q), mulx24(SC[2], SC[3], k)), color);
          this.count++;
        }
        return;
      }
      case 5: {   // 0x10017f80
        const a = mul24(time, f(0.31830987));
        sincos87(a, SC);
        const cosA = f32x(SC[2], SC[3]), sinA = f32x(SC[0], SC[1]), mx = this.audio.maxR, s5 = mul24(mul24(W, scale), 0.5);
        sincos87(mul24(a, 4), SC);
        const e = mul24(ftolq(mulx24(SC[2], SC[3], mx)), 0.75);
        const ox = ftolq(mul24(cosA, e)), oy = ftolq(mul24(sinA, e)), g = mul24(add24(mx, 8), 0.0078125);
        this.count = 0;
        for (let i = 0; i < 544; i++) {
          const u = mul24(mul24(L[i], g), s5), v = mul24(mul24(mul24(g, L[i + 32]), f(0.6993007)), s5);
          this.pt(base, i,
            add24(add24(ftolq(sub24(mul24(u, cosA), mul24(v, sinA))), ox), cx),
            add24(sub24(cy, ftolq(add24(mul24(u, sinA), mul24(v, cosA)))), oy), color);
          this.count++;
        }
        return;
      }
      case 6: case 7: {   // 0x10018100, 0x10018240
        sincos87(mul24(add24(p, 1), f(1.5707964)), SC);
        const cosA = f32x(SC[2], SC[3]), sh = SC[0], sl = SC[1];
        const q = mulx24(sh, sl, f(1.4142135)), r = mul24(cosA, f(-1.4142135)), dxw = sub24(x, 0.5);
        const X0 = mul24(add24(sub24(mul24(dxw, cosA), mul24(q, 0.5)), 0.5), W);
        const Y0 = mul24(add24(sub24(mul24(r, 0.5), mulx24(sh, sl, dxw)), 0.5), H);
        const kx = mul24(mul24(q, W), f(0.0034722222)), ky = mul24(mul24(W, r), f(0.0034722222));
        const amp = mul24(mul24(W, scale), f(0.23));
        this.count = 0;
        if (mode === 6) {
          for (let i = 0; i < 288; i++) {
            const m = mul24(amp, this.audio.waveMono[i]);
            this.pt(base, i, add24(add24(mul24(i, kx), mul24(m, cosA)), X0), sub24(Y0, add24(mul24(i, ky), mulx24(sh, sl, m))), color);
            this.count++;
          }
          return;
        }
        const sep = mul24(mul24(mul24(y, y), H), 0.5);
        this.count2 = 0;
        for (let i = 0; i < 288; i++) {
          const ix = mul24(i, kx), iy = mul24(i, ky);
          const m1 = add24(mul24(amp, L[i]), sep), m2 = sub24(mul24(amp, R[i]), sep);
          this.pt(base, i, add24(add24(mul24(m1, cosA), ix), X0), sub24(Y0, add24(mulx24(sh, sl, m1), iy)), color);
          this.pt(LINE2, i, add24(add24(mul24(m2, cosA), ix), X0), sub24(Y0, add24(mulx24(sh, sl, m2), iy)), color);
          this.count++; this.count2++;
        }
        return;
      }
      default: {   // 0, 1 and anything else: 0x10017cc0
        const r0 = mul24(W, f(0.24)), amp = mul24(mul24(r0, scale), f(0.8)), k = mul24(r0, add24(add24(p, p), 1));
        this.count = 0;
        for (let i = 0; i < 575; i++) {
          const ang = mul24(i, 0.010927279099174167), rad = add24(mul24(amp, R[i]), k);
          sincos87(ang, SC);
          this.pt(base, i, add24(ftolq(mulx24(SC[2], SC[3], rad)), cx), sub24(cy, ftolq(mulx24(SC[0], SC[1], rad))), color);
          this.count++;
        }
        // the closing point copies the primary array's first point, whichever array is being built
        this.pt(base, 575, this.f32[PRIM], this.f32[PRIM + 1], color);
        this.count++;
      }
    }
  }

  // 0x10018630: blend the primary points toward the secondary ones; mode 1 as next mode takes the secondary count
  private blend(n1: number, n2: number): number {
    let n = n1 > n2 ? n2 : n1;
    if (this.nextMode === 1) n = n2;
    const F = this.f32, U = this.u32;
    for (let i = 0; i < n; i++) {
      const o = PRIM + i * 5, s = SEC + i * 5;
      F[o] = this.lerp(F[o], F[s]);
      F[o + 1] = this.lerp(F[o + 1], F[s + 1]);
      U[o + 4] = ftolq(this.lerp(f(U[o + 4]), f(U[s + 4])));
    }
    return n;
  }
  // 0x1000f2c0
  private lerp(a: number, b: number): number {
    const d = sub24(b, a);
    return this.w7c < 0.5 ? add24(mul24(d, this.w7c), a) : sub24(b, mul24(d, this.w78));
  }

  // 0x100177e0: the motion-vector grid; with too few vectors the flag stays set and the old count is kept
  private computeMV(cur: Float32Array): void {
    this.mvOn = 0;
    if (cur[V.mv_a] < 0.01) return;
    this.mvOn = 1;
    let nx = ftolq(cur[V.mv_x]), ny = ftolq(cur[V.mv_y]);
    if (nx < 1 || ny < 1) return;
    if (nx > 64) nx = 64;
    if (ny > 48) ny = 48;
    const color = rgbaColor(cur[V.mv_r], cur[V.mv_g], cur[V.mv_b], cur[V.mv_a]);
    const dx = (this.W / nx) | 0, dy = (this.H / ny) | 0;
    let x0 = dx >> 1, y0 = dy >> 1;
    const mdx = cur[V.mv_dx], mdy = cur[V.mv_dy];
    if (mdx !== 0) { const o = ftolq(mul24(Math.abs(mdx), this.W)); x0 += mdx < 0 ? -o : o; }
    if (mdy !== 0) { const o = ftolq(mul24(Math.abs(mdy), this.H)); y0 += mdy < 0 ? -o : o; }
    let k = 0;
    for (let j = 0, y = y0; j < ny; j++, y += dy) {
      for (let i = 0, x = x0; i < nx; i++, x += dx, k += 5) {
        this.mvF[k] = x; this.mvF[k + 1] = y; this.mvF[k + 2] = 1; this.mvF[k + 3] = 1; this.mvU[k + 4] = color;
      }
    }
    this.mvCount = nx * ny;
  }
}

const dv = (m: Uint8Array): DataView => new DataView(m.buffer, m.byteOffset, m.byteLength);
// ponytail: a lock past the buffer's end is cut at the end; the DLL would write past it
function copy(dst: Uint8Array, src: Uint8Array, from: number, size: number): void {
  dst.set(src.subarray(from, from + Math.min(size, dst.length)));
}
