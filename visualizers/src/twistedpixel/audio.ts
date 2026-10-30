// TwistedPixel's audio stage: what one Render() call makes of WMP's TimedLevel before the frame runs.
//   sample()  0x10001e00  576 samples a channel off the waveform, and the silence test that skips a whole frame
//   process() 0x10012d10  0x100142f0 smoothed waves, 0x10013f70 FFT + bass/mid/treb (+ _att, volume),
//                         0x10013c80 beat ratio and the per-channel scaled waves
// Everything after CreateDevice runs at the x87's 24-bit precision (fpu.ts); the FFT's tables are built in the engine's
// constructor, before the device exists, at the default 53-bit precision.
import { A, type TimedLevel } from '../ns';
import '../rand';
import { sincos87 } from '../plenoptic/x87';
import { add24, sub24, mul24, div24, sqrt24, f32x, ftol } from './fpu';
import { two, ln87, pow87 } from './crt';
import { V } from './vars';

const f = Math.fround;
export const N = 576;           // samples per channel
const NFFT = 1024, NSPEC = 512;

const T2 = new Float64Array(2);

// ---- 0x10016a70: the FFT object (576 samples in, 1024-point transform, 512 bins out), tables at 53-bit precision ----
export class Fft {
  readonly br = new Int32Array(NFFT);
  readonly env = new Float32Array(N);
  readonly eq = new Float32Array(NSPEC);
  readonly cs = new Float32Array(20);       // [cos, sin] per stage, dftsize 2..1024
  private re = new Float32Array(NFFT);
  private im = new Float32Array(NFFT);
  constructor() {
    // 0x10016ca0 bit reversal
    for (let i = 0, j = 0; i < NFFT; i++) {
      this.br[i] = j;
      let m = NFFT >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    // 0x10016bc0 envelope (power 1): (sin(i * 2pi/576 - pi/2) + 1) / 2
    const sc = new Float64Array(4), c = f((1 / N) * 6.2831854820251465);
    for (let i = 0; i < N; i++) {
      sincos87(i * c - 1.5707963705062866, sc);
      two(sc[0], 1, T2);
      this.env[i] = f((T2[0] + (T2[1] + sc[1])) * 0.5);
    }
    // 0x10016b50 equalizer: ln((512 - i) / 512) * -0.02
    const ln = new Float64Array(2), c2 = 1 / NSPEC;
    for (let i = 0; i < NSPEC; i++) {
      ln87((NSPEC - i) * c2, ln);
      const p = ln[0] * -0.019999999552965164, e = A.fma(ln[0], -0.019999999552965164, -p) + ln[1] * -0.019999999552965164;
      this.eq[i] = f(p + e);
    }
    // 0x10016d20 twiddles: x = -2pi/dftsize, cos and sin straight from 64 bits to float
    for (let d = 2, t = 0; d <= NFFT; d <<= 1, t += 2) {
      sincos87(-6.2831854820251465 / d, sc);
      this.cs[t] = f32x(sc[2], sc[3]);
      this.cs[t + 1] = f32x(sc[0], sc[1]);
    }
  }
  /** 0x10016d90 at 24-bit precision: in = 576 floats, out = 512 magnitudes */
  run(inp: Float32Array, out: Float32Array): void {
    const re = this.re, im = this.im, br = this.br, env = this.env;
    for (let k = 0; k < NFFT; k++) {
      const b = br[k];
      re[k] = b < N ? f(inp[b] * env[b]) : 0;
      im[k] = 0;
    }
    for (let d = 2, t = 0; d <= NFFT; d <<= 1, t += 2) {
      const wpr = this.cs[t], wpi = this.cs[t + 1], h = d >> 1;
      let wr = 1, wi = 0;
      for (let m = 0; m < h; m++) {
        for (let i = m; i < NFFT; i += d) {
          const j = i + h;
          const tr = f(f(wr * re[j]) - f(wi * im[j]));
          const ti = f(f(wr * im[j]) + f(wi * re[j]));
          re[j] = f(re[i] - tr); im[j] = f(im[i] - ti);
          re[i] = f(re[i] + tr); im[i] = f(im[i] + ti);
        }
        const w = wr;
        wr = f(f(wr * wpr) - f(wi * wpi));
        wi = f(f(wi * wpr) + f(w * wpi));
      }
    }
    for (let k = 0; k < NSPEC; k++) out[k] = f(sqrt24(f(f(re[k] * re[k]) + f(im[k] * im[k]))) * this.eq[k]);
  }
}

// The band edges 0x10013f70 recomputes every frame: ftol(pow(k/3, 2.1) * 256) for k = 0..3 (2.1 as a float).
// pow87 gives 0, 25, 109, 256; kept as constants (the test checks them against pow87).
export const BANDS = [0, 25, 109, 256];
const BAND_K = [3.7037036418914795, 2.915452003479004, 3.3898305892944336];
const BAND_V = [V.bass, V.mid, V.treb], ATT_V = [V.bass_att, V.mid_att, V.treb_att];

/** The audio state the DLL keeps in globals (addresses in the comments). */
export class Audio {
  readonly fft = new Fft();
  /** 0x10001e00's samples: ftol((128 - wave byte) * 0.675f); tp_WaveformLeft/Right (DAT_1004682c/30) */
  readonly L = new Int8Array(N);
  readonly R = new Int8Array(N);
  /** the TimedLevel's first 576 spectrum bytes; tp_SpectrumLeft/Right (DAT_10046834/38) give them as signed chars */
  readonly freqL = new Uint8Array(N);
  readonly freqR = new Uint8Array(N);
  /** 0x100142f0: box-filtered waves (DAT_10043b2c, DAT_1004442c) and their mean (DAT_1004322c) */
  readonly waveL = new Float32Array(N);
  readonly waveR = new Float32Array(N);
  readonly waveMono = new Float32Array(N);
  /** 0x10016d90 spectra of the half-sample-shifted waves (DAT_10044d2c, DAT_1004562c) */
  readonly specL = new Float32Array(NSPEC);
  readonly specR = new Float32Array(NSPEC);
  /** 0x10013c80: mean of the first 10 spectrum bytes now and last frame (DAT_1004320c/10, DAT_10043214/18) */
  avgL = 0; avgR = 0; prevAvgL = 0; prevAvgR = 0;
  /** 0x10013e20's divisor (DAT_1003e470, 192.0 at load) */
  thr = 192;
  /** 0x10013d20: the samples scaled by ((w + h) / 2) * 0.1 / 256 (DAT_10045f2c, DAT_1004616c) and their extremes */
  readonly scaledL = new Int8Array(N);
  readonly scaledR = new Int8Array(N);
  minL = 0; maxL = 0; minR = 0; maxR = 0;
  private a = new Float32Array(N);
  private b = new Float32Array(N);

  /** 0x10001e00's sampling loop. False when every sampled byte of both channels is 128: the DLL then returns
   *  before the frame (no audio update, no preset timing, nothing drawn, the frame counter stays). */
  sample(tl: TimedLevel): boolean {
    let live = false;
    const w0 = tl.wave[0], w1 = tl.wave[1];
    for (let i = 0, p = 0; i < N; i++, p += 0x1c71c) {
      const k = p >>> 16, dl = 128 - w0[k], dr = 128 - w1[k];
      if (dl !== 0 || dr !== 0) live = true;
      this.L[i] = ftol(f(dl * 0.675000011920929));
      this.R[i] = ftol(f(dr * 0.675000011920929));
    }
    if (live) {                     // a silent frame leaves the last frame's spectrum copy in place
      this.freqL.set(tl.freq[0].subarray(0, N));
      this.freqR.set(tl.freq[1].subarray(0, N));
    }
    return live;
  }

  /** 0x10012d10, after sample(): writes bass, mid, treb, their _att, volume and (beat detection on) bBeatDetected
   *  into the current preset's vars; reads its fWaveSmoothing, _att and nBeatDetectionSensitivity.
   *  fps = the engine's last estimate (DAT_1003e418); halfWH = (width + height) >> 1 (engine +0x270). */
  process(vars: Float32Array, fps: number, beatOn: boolean, halfWH: number): void {
    this.smooth(vars[V.fWaveSmoothing]);
    this.bands(vars, fps);
    this.beat(vars, beatOn, halfWH);
  }

  /** 0x100142f0: a centred running sum over n = clamp(1 - ftol(s*s*-576) / 20, 1, 576) samples, wrapping */
  private smooth(s: number): void {
    let n = 1 - ((ftol(mul24(mul24(s, s), -576)) / 20) | 0);
    if (n < 1) n = 1; else if (n > N) n = N;
    const half = n >> 1, L = this.L, R = this.R;
    let sl = 0, sr = 0;
    for (let k = -half; k < n - half; k++) { const j = (k + N) % N; sl += L[j]; sr += R[j]; }
    const kLR = f(1 / (n << 7)), kM = f(1 / (n << 8));
    let head = n - half, tail = (N - half) % N;
    for (let i = 0; i < N; i++) {
      this.waveMono[i] = f((sl + sr) * kM);
      this.waveL[i] = f(sl * kLR);
      this.waveR[i] = f(sr * kLR);
      sl += L[head % N] - L[tail]; sr += R[head % N] - R[tail];
      head = (head + 1) % N; tail = (tail + 1) % N;
    }
  }

  /** 0x10013f70: spectra, the three bands from the LEFT spectrum, their attack/decay, volume */
  private bands(vars: Float32Array, fps: number): void {
    const L = this.L, R = this.R, a = this.a, b = this.b;
    for (let i = 0; i < N; i++) {
      const p = i > 0 ? i - 1 : 0;
      a[i] = f((L[i] + L[p]) * 0.5);            // (both sums are small integers: exact)
      b[i] = f((R[i] + R[p]) * 0.5);
    }
    this.fft.run(a, this.specL);
    this.fft.run(b, this.specR);
    const att = [vars[V.bass_att], vars[V.mid_att], vars[V.treb_att]];
    const nv = [0, 0, 0];
    const y = div24(1, fps);
    for (let k = 0; k < 3; k++) {
      let s = 1;
      for (let i = BANDS[k]; i < BANDS[k + 1]; i++) s = add24(s, this.specL[i]);
      const v = mul24(div24(s, BANDS[k + 1] - BANDS[k]), BAND_K[k]);
      vars[BAND_V[k]] = v; nv[k] = v;
      const rate = pow87(pow87(v > att[k] ? 0.20000000298023224 : 0.5, 14), y);
      vars[ATT_V[k]] = add24(mul24(sub24(1, rate), v), mul24(rate, att[k]));
    }
    vars[V.volume] = mul24(add24(add24(nv[2], nv[1]), nv[0]), 0.3333333432674408);
  }

  /** 0x10013c80 */
  private beat(vars: Float32Array, beatOn: boolean, halfWH: number): void {
    this.prevAvgL = this.avgL; this.prevAvgR = this.avgR;
    let sl = 0, sr = 0;
    for (let i = 0; i < 10; i++) { sl += this.freqL[i]; sr += this.freqR[i]; }
    this.avgL = (sl / 10) | 0; this.avgR = (sr / 10) | 0;
    if (beatOn) {                                       // 0x10013e20
      const sens = vars[V.nBeatDetectionSensitivity];
      if (this.thr !== sens) {
        let v = (100 - ftol(sens)) | 0;
        if (v < 0) v = 1; else if (v > 100) v = 100;
        let t = mul24(f(v * 512), 0.009999999776482582);
        if (!(t >= 1)) t = 1; else if (t > 512) t = 512;
        this.thr = t;
      }
      vars[V.bBeatDetected] = div24(this.avgR + this.avgL, this.thr);
    }
    const sc = mul24(f(halfWH * 0.10000000149011612), 0.00390625);
    this.scale(this.L, this.scaledL, sc, 0);
    this.scale(this.R, this.scaledR, sc, 1);
  }
  /** 0x10013d20 */
  private scale(src: Int8Array, dst: Int8Array, sc: number, ch: number): void {
    let mn = 0, mx = 0;
    for (let i = 0; i < N; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (ch === 0) { this.minL = mn; this.maxL = mx; } else { this.minR = mn; this.maxR = mx; }
    if (mx === 0 || mn === 0) { dst.fill(0); return; }
    for (let i = 0; i < N; i++) {
      const v = src[i], p = f(v * sc);
      dst[i] = p === 0 && v !== 0 ? (v > 0 ? 1 : -1) : ftol(p);
    }
  }
}
