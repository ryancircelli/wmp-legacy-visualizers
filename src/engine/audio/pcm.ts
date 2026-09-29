// TimedLevel from raw PCM: the host socket's path in the old shell (Shell.useLocalAudio, src/90-shell.js).
//
// WebView2 refuses every audio-only getDisplayMedia and shows its own unanswerable picker for the
// audio+video one, so the capture happens outside the browser: a WASAPI loopback helper writes PCM to the
// Deno host, which relays it over a WebSocket — first a {"rate":n} text message, then interleaved stereo
// float32 frames. Those samples are analysed here, in JS, and not by an AnalyserNode: a screensaver's
// AudioContext stays 'suspended' forever with no gesture to resume it, and a suspended context runs no graph.
//
// The bytes are the AnalyserNode's own definition, the one tools/gen_frames.py mirrors: a Blackman window
// over the most recent 2048 samples, |X[k]| / fftSize, 20log10, mapped across the calibrated dB window, with
// smoothingTimeConstant applied to the magnitudes. tests/shell-smoke.js step 17 checks a tone through here
// against the same tone through a real AnalyserNode.
import type { TimedLevel } from '../ns';
import { DB_WINDOW } from './analyser';

const N_FFT = 2048, N_BIN = 1024, N_MASK = N_FFT - 1;
const WIN = new Float32Array(N_FFT), REV = new Uint16Array(N_FFT);
const TWR = new Float32Array(N_FFT >> 1), TWI = new Float32Array(N_FFT >> 1);
(function () {
  for (let i = 0; i < N_FFT; i++) {
    WIN[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT) + 0.08 * Math.cos((4 * Math.PI * i) / N_FFT);
    let r = 0, x = i;
    for (let b = 0; b < 11; b++, x >>= 1) r = (r << 1) | (x & 1); // 2^11 = 2048
    REV[i] = r;
  }
  for (let k = 0; k < N_FFT >> 1; k++) {
    TWR[k] = Math.cos((-2 * Math.PI * k) / N_FFT);
    TWI[k] = Math.sin((-2 * Math.PI * k) / N_FFT);
  }
})();
const FRE = new Float32Array(N_FFT), FIM = new Float32Array(N_FFT);

// ring: N_FFT samples, `at` = where the next sample goes, which is also the oldest one.
// Each stage runs twiddle-outer: the butterflies of a stage touch disjoint elements, so their order
// cannot change a bit, and hoisting the twiddle pair makes the small stages' loops long. ~30% faster
// than bin-outer, output identical (tests/engine/pcm.test.ts).
export function fftMags(ring: Float32Array, at: number, gain: number, mags: Float32Array): void {
  let i, j, k, size, half, step, tr, ti, ur, ui, wr, wi, x, y;
  for (i = 0; i < N_FFT; i++) {
    j = REV[i];
    FRE[i] = ring[(at + j) & N_MASK] * WIN[j] * gain;
    FIM[i] = 0;
  }
  for (size = 2; size <= N_FFT; size <<= 1) {
    half = size >> 1;
    step = N_FFT / size;
    for (i = 0, k = 0; i < half; i++, k += step) {
      wr = TWR[k];
      wi = TWI[k];
      for (j = i; j < N_FFT; j += size) {
        x = FRE[j + half];
        y = FIM[j + half];
        tr = wr * x - wi * y;
        ti = wr * y + wi * x;
        ur = FRE[j];
        ui = FIM[j];
        FRE[j] = ur + tr;
        FIM[j] = ui + ti;
        FRE[j + half] = ur - tr;
        FIM[j + half] = ui - ti;
      }
    }
  }
  for (k = 0; k < N_BIN; k++) {
    mags[k] = Math.sqrt(FRE[k] * FRE[k] + FIM[k] * FIM[k]) / N_FFT;
  }
}

export function magBytes(
  mags: Float32Array,
  prev: Float32Array,
  out: Uint8Array,
  smoothing = 0,
  db: readonly [number, number] = DB_WINDOW,
): void {
  const scale = 255 / (db[1] - db[0]), sm = smoothing;
  let m, b;
  for (let k = 0; k < N_BIN; k++) {
    m = sm ? (prev[k] = sm * prev[k] + (1 - sm) * mags[k]) : mags[k];
    b = m > 0 ? (scale * (20 * Math.log10(m) - db[0])) | 0 : 0;
    out[k] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

// WMP's waveform is the most recent 1024 samples — the newer half of the FFT window.
export function waveBytes(ring: Float32Array, at: number, gain: number, out: Uint8Array): void {
  for (let i = 0, b; i < N_BIN; i++) {
    b = (128 * (1 + ring[(at + N_BIN + i) & N_MASK] * gain) + 0.5) | 0;
    out[i] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

export interface PcmLevelSource {
  /** Smoothing on the magnitudes (the AnalyserNode's smoothingTimeConstant), 0 = none. */
  smoothing: number;
  /** One socket frame: interleaved stereo float32. Only the most recent window can matter. */
  push(pcm: Float32Array): void;
  /** Fill freq/wave of both channels; `gain` is the volume slider as capture sensitivity (1 = as is). */
  fill(level: TimedLevel, gain: number): void;
}

export function createPcmSource(opts: { smoothing?: number; dbWindow?: readonly [number, number] } = {}): PcmLevelSource {
  const db = opts.dbWindow ?? DB_WINDOW;
  const ring: [Float32Array, Float32Array] = [new Float32Array(N_FFT), new Float32Array(N_FFT)];
  const mags = [new Float32Array(N_BIN), new Float32Array(N_BIN)] as const;
  const prev = [new Float32Array(N_BIN), new Float32Array(N_BIN)] as const;
  // `dirty`: the ring changed since the magnitudes were last taken. With no new samples (nothing
  // playing sends no packets at all; a frame loop catching up runs several fills per task) the FFT
  // would only recompute the same magnitudes. magBytes still runs every fill: smoothing is stateful.
  let at = 0, fresh = 0, dirty = true, zeroed = false, lastGain = NaN;
  const src: PcmLevelSource = {
    smoothing: opts.smoothing ?? 0,
    push(pcm) {
      const n = pcm.length >> 1;
      // Only the most recent window can matter, so a backed-up burst skips to its tail.
      for (let i = n > N_FFT ? n - N_FFT : 0; i < n; i++) {
        ring[0][at] = pcm[i * 2];
        ring[1][at] = pcm[i * 2 + 1];
        at = (at + 1) & N_MASK;
      }
      fresh = performance.now();
      if (n) { dirty = true; zeroed = false; }
    },
    fill(level, gain) {
      // Nothing for a quarter second means the stream stalled or the helper died between
      // restarts: read silence rather than leave the last spectrum frozen on screen.
      if (performance.now() - fresh > 250 && !zeroed) {
        ring[0].fill(0);
        ring[1].fill(0);
        dirty = zeroed = true;
      }
      const fft = dirty || gain !== lastGain;
      dirty = false;
      lastGain = gain;
      for (let c = 0; c < 2; c++) {
        if (fft) fftMags(ring[c], at, gain, mags[c]);
        magBytes(mags[c], prev[c], level.freq[c], src.smoothing, db);
        waveBytes(ring[c], at, gain, level.wave[c]);
      }
    },
  };
  return src;
}
