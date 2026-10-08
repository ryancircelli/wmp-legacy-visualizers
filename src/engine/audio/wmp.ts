// Windows Media Player's own spectrum analyzer, the "WMPlayer Spectrum Analyzer DMO" that turns the sound into
// the TimedLevel every visualizer's Render gets. One algorithm from WMP 7 to 12; this follows today's
// wmpeffects.dll (SSE single precision, the x64 and x86 builds alike) operation for operation, and with
// build 'wmp11' or 'wmp9' the x87 arithmetic of WMP 11's wmpeffects.dll or WMP 9 and 10's wmp.dll, so its bytes
// are each DLL's bit for bit (the private harness feeds both the same PCM and compares every byte of every
// snapshot).
//
// Per input buffer (ProcessOutput 0x1800207b0 hands the whole buffer to the loop 0x180020450):
//   - 16-bit samples go into a 2048-sample float history per channel, and their top byte with the sign bit
//     flipped ((s >> 8) + 128) into a byte history (fill 0x180020010). Channels 0 and 1 only.
//   - Each time the history is full: a snapshot (spectrum + the OLDEST 1024 wave bytes), then the read position
//     moves on by hop = floor(rate / 30) samples FROM WHERE THIS BUFFER'S WINDOWS STARTED (not from where the
//     last read stopped), the histories shift left by hop, and filling goes on from there. A buffer that ends
//     before the next read position leaves 2048 - hop samples to skip at the start of the next one. Within a
//     long buffer, windows are contiguous and end every hop samples; across buffer boundaries they are only
//     contiguous when the buffers are whole multiples of hop (see push()).
//   - The window is applied IN PLACE to the float history (0x1800221e0), so the 2048 - hop samples carried
//     into the next window are windowed again there.
// Per snapshot and channel (0x18001fbf0): 4-term Blackman-Harris window, Sorensen's split-radix real FFT
// (0x180021580) with a sine table, power = (Re² + Im²) / 2048², and bytes through two lookup tables indexed by
// the bits of the float (255/80 bytes per dB, 0 dB = power 1). frequency[i] = FFT bin i + E + 1, with
// E = 1 + ceil(20 Hz / binwidth) (2 at 44.1 and 48 kHz: bin i + 3); the last E + 1 bytes are 0. This is the
// layout every visualizer here gets (their GetCapabilities leave EFFECT_VARIABLEFREQSTEP clear).
// Timestamps (100 ns) as the DLL keeps them: the buffer's, less what the history held, plus hop per snapshot.

const N = 2048, HALF = 1024;
const f = Math.fround;

// Window (0x180022741): double arithmetic with the binary's truncated 2π, rounded to float.
const W = new Float32Array(N);
// Sine table sin(πk/N), k < 2N (0x18002260b): the truncated π, rounded to float; cos(x) = S[k + N/2].
const S = new Float32Array(2 * N);
// out[REV[i]] = in[i]: the FFT's bit-reversal copy.
const REV = new Uint16Array(N);
// Power to byte (T1 at RVA 0x3a600, T2 at 0x3a200): K·log2 of the mantissa and of the exponent, each rounded
// half up and truncated toward zero as C's (int) does.
const T1 = new Int32Array(2048), T2 = new Int32Array(256);
(function () {
  const step = 6.28318530717958 / (N - 1), step2 = step + step, step3 = step * 3;
  for (let n = 0; n < N; n++) {
    W[n] = 0.35875 - Math.cos(n * step) * 0.48829 + Math.cos(n * step2) * 0.14128 - Math.cos(n * step3) * 0.01168;
  }
  const a = 3.14159265358979 / N;
  for (let k = 1; k < N / 2; k++) {
    const s = f(Math.sin(a * k));
    S[k] = S[N - k] = s;
    S[N + k] = S[2 * N - k] = -s;
  }
  S[N / 2] = 1;
  S[(3 * N) / 2] = -1;
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0, x = i; b < 11; b++, x >>= 1) r = (r << 1) | (x & 1);
    REV[i] = r;
  }
  const K = (255 / 80) * 10 * Math.log10(2);
  for (let m = 0; m < 2048; m++) T1[m] = Math.trunc(K * Math.log2(1 + m / 2048) + 0.5);
  for (let e = 0; e < 256; e++) T2[e] = Math.trunc(K * (e - 127) + 0.5);
})();

const BITS = new Float32Array(1), UBITS = new Uint32Array(BITS.buffer);
function toByte(p: number): number {
  BITS[0] = p;
  const b = UBITS[0], v = T1[(b >>> 12) & 0x7ff] + T2[(b >>> 23) & 0xff];
  return v > 255 ? 255 : v < 0 ? 0 : v;
}

const R2 = f(Math.SQRT1_2);

type Round = (v: number) => number;
const same: Round = (v) => v;
/** Which build's arithmetic: WMP 12's SSE code (wmpeffects.dll, x64 and x86 alike) rounds every operation to
 *  float; WMP 11's x87 code (wmpeffects.dll) keeps products and some sums at double precision; WMP 9 and 10's
 *  (wmp.dll) keep more. [products and register-held sums, sums WMP 11 spills]. */
const ROUNDING = { wmp12: [f, f], wmp11: [same, f], wmp9: [same, same] } as const;
export type WmpBuild = keyof typeof ROUNDING;

// Sorensen, Jones, Heideman & Burrus' split-radix real FFT as the DLL has it: x (windowed) in, d out in
// half-complex order (d[k] = Re X[k] for k <= N/2, d[N-k] = Im X[k]). Every store to the array is a float; the
// builds differ in the intermediates (Rounding): `p` for products and sums the x87 builds keep in registers at
// double precision, `s` for sums WMP 11 spills to float temporaries and WMP 9/10 do not. f() marks the spills
// every build makes (WMP 9 0x07793649-0x07793663, WMP 11 0x134d2c9f-0x134d2d0c, 0x134d3427-0x134d348f).
function fft(x: Float32Array, d: Float32Array, p: Round, s: Round): void {
  for (let i = 0; i < N; i++) d[REV[i]] = x[i]!;
  for (let i0 = 0, id = 4; i0 < N - 1; i0 = 2 * id - 2, id *= 4) {
    for (let i = i0; i < N; i += id) {
      const a = d[i], b = d[i + 1];
      d[i] = f(a + b);
      d[i + 1] = f(a - b);
    }
  }
  for (let n2 = 4, ts = N / 2; n2 <= N; n2 *= 2, ts /= 2) {
    const n4 = n2 >> 2, n8 = n2 >> 3;
    for (let i = 0, id = 2 * n2; i < N; i = 2 * id - n2, id *= 4) {
      for (let i1 = i; i1 < N; i1 += id) {
        const i2 = i1 + n4, i3 = i2 + n4, i4 = i3 + n4;
        const t1 = s(d[i3] + d[i4]);
        d[i4] = f(d[i4] - d[i3]);
        d[i3] = f(d[i1] - t1);
        d[i1] = f(t1 + d[i1]);
        if (n4 > 1) {
          const j0 = i1 + n8, j2 = i2 + n8, j3 = i3 + n8, j4 = i4 + n8;
          const a = s(p(d[j3] + d[j4]) * R2), b = s(p(d[j3] - d[j4]) * R2);
          d[j4] = f(d[j2] - a);
          d[j3] = f(-d[j2] - a);
          d[j2] = f(d[j0] - b);
          d[j0] = f(b + d[j0]);
        }
      }
    }
    for (let j = 1; j < n8; j++) {
      const ss1 = S[j * ts], cc1 = S[j * ts + N / 2], ss3 = S[3 * j * ts], cc3 = S[3 * j * ts + N / 2];
      for (let i = 0, id = 2 * n2; i < N; i = 2 * id - n2, id *= 4) {
        for (let b = i; b < N; b += id) {
          const i1 = b + j, i2 = i1 + n4, i3 = i2 + n4, i4 = i3 + n4;
          const i5 = b + n4 - j, i6 = i5 + n4, i7 = i6 + n4, i8 = i7 + n4;
          const t1 = s(p(d[i7] * ss1) + p(d[i3] * cc1));
          const t2 = s(p(d[i7] * cc1) - p(d[i3] * ss1));
          const t3 = s(p(d[i8] * ss3) + p(d[i4] * cc3));
          const t4 = f(p(d[i8] * cc3) - p(d[i4] * ss3));
          const t5 = f(t3 + t1), t6 = f(t4 + t2), u1 = f(t1 - t3), u2 = s(t2 - t4);
          const a6 = d[i6];
          d[i3] = f(t6 - a6);
          d[i8] = f(a6 + t6);
          const a2 = d[i2];
          d[i7] = f(-a2 - u1);
          d[i4] = f(a2 - u1);
          const a1 = d[i1];
          d[i6] = f(a1 - t5);
          d[i1] = f(a1 + t5);
          const a5 = d[i5];
          d[i5] = f(a5 - u2);
          d[i2] = f(a5 + u2);
        }
      }
    }
  }
}

const P = new Float32Array(N);

export class WmpAnalyzer {
  /** The newest snapshot: native-layout frequency bytes and the wave bytes, per channel (mono: both channel 0). */
  readonly freq: [Uint8Array, Uint8Array] = [new Uint8Array(HALF), new Uint8Array(HALF)];
  readonly wave: [Uint8Array, Uint8Array] = [new Uint8Array(HALF).fill(128), new Uint8Array(HALF).fill(128)];
  /** The newest snapshot's timestamp (100 ns), and how many snapshots there have been. */
  ts = 0;
  count = 0;
  /** Called after every snapshot, while freq/wave/ts hold it. */
  onSnapshot: (() => void) | null = null;
  readonly hop: number;
  private readonly hist = [new Float32Array(N), new Float32Array(N)];
  private readonly wb = [new Uint8Array(N), new Uint8Array(N)];
  private readonly e: number;
  private fill = 0;
  private skip = 0;
  private clock = 0;
  private pending: Int16Array;
  private have = 0;
  private fed = 0;
  private readonly p: Round;
  private readonly s: Round;

  /** `build`: whose arithmetic (ROUNDING); 'wmp9' is WMP 9 and 10's. Everything else is the same in all. */
  constructor(readonly rate: number, readonly channels: 1 | 2, readonly build: WmpBuild = 'wmp12') {
    [this.p, this.s] = ROUNDING[build];
    this.hop = Math.floor(rate / 30);
    const bw = f(rate * 0.00048828125);
    let e = 1;
    for (let x = 0; !(x >= 20); ) { e++; x = f(x + bw); if (e >= HALF) break; }
    this.e = e;
    this.pending = new Int16Array(this.hop * channels);
  }

  /** One input buffer, as the DMO gets it from ProcessOutput: `frames` interleaved 16-bit frames, timestamp `ts`
   *  (100 ns). Returns the snapshots it made. */
  process(pcm: Int16Array, frames: number, ts: number): number {
    const sr = this.rate, hop = this.hop, before = this.count;
    this.clock = ts - Math.floor((this.fill * 1e7) / sr);
    let p = 0, anchor = 0;
    if (this.skip > 0) {
      p = this.skip;
      this.clock += Math.floor((this.skip * 1e7) / sr);
      this.skip = 0;
    }
    let ok = this.read(pcm, p, frames);
    while (ok) {
      this.fill = 0;
      this.snapshot();
      anchor += hop;
      this.clock += Math.floor((hop * 1e7) / sr);
      if (anchor > frames) { this.skip = N - hop; break; }
      if (hop < N) {
        for (let c = 0; c < this.channels; c++) {
          this.hist[c].copyWithin(0, hop);
          this.wb[c].copyWithin(0, hop);
        }
        this.fill = N - hop;
      }
      ok = this.read(pcm, anchor, frames);
    }
    return this.count - before;
  }

  /** A continuous stream in pieces of any size: cut into buffers of exactly hop frames, the size that keeps every
   *  window contiguous (each one ends hop samples after the last, as inside one long buffer of WMP's). */
  push(pcm: Int16Array, frames = pcm.length / this.channels): number {
    const ch = this.channels, hop = this.hop, buf = this.pending;
    let made = 0;
    for (let i = 0; i < frames; ) {
      const take = Math.min(hop - this.have, frames - i);
      buf.set(pcm.subarray(i * ch, (i + take) * ch), this.have * ch);
      this.have += take;
      i += take;
      if (this.have === hop) {
        made += this.process(buf, hop, Math.floor((this.fed * 1e7) / this.rate));
        this.fed += hop;
        this.have = 0;
      }
    }
    return made;
  }

  /** No history and no snapshot (frequency 0, wave 128, as WMP shows with none); the stream clock goes on. */
  reset(): void {
    this.fill = this.skip = this.have = 0;
    for (let c = 0; c < 2; c++) { this.freq[c].fill(0); this.wave[c].fill(128); }
  }

  private read(pcm: Int16Array, p: number, end: number): boolean {
    const ch = this.channels;
    while (this.fill < N) {
      if (p >= end) return false;
      for (let c = 0; c < ch; c++) {
        const s = pcm[p * ch + c];
        this.hist[c][this.fill] = s;
        this.wb[c][this.fill] = (s >> 8) + 128;
      }
      p++;
      this.fill++;
    }
    return true;
  }

  private snapshot(): void {
    const e = this.e, last = HALF - 1 - e;
    for (let c = 0; c < this.channels; c++) {
      const h = this.hist[c], out = this.freq[c];
      for (let n = 0; n < N; n++) h[n] = f(W[n] * h[n]);
      fft(h, P, this.p, this.s);
      // the x87 builds sum re² + im² at double precision (WMP 9 0x0779329b), and store after the scale
      const p = this.p;
      for (let j = 1; j < HALF; j++) {
        const re = P[j], im = P[N - j];
        P[j] = f(p(p(im * im) + p(re * re)) * 2.384185791015625e-7);
      }
      for (let i = 0; i < HALF; i++) out[i] = i < last ? toByte(P[e + 1 + i]) : 0;
      this.wave[c].set(this.wb[c].subarray(0, HALF));
    }
    if (this.channels === 1) { this.freq[1].set(this.freq[0]); this.wave[1].set(this.wave[0]); }
    this.ts = this.clock;
    this.count++;
    this.onSnapshot?.();
  }
}
