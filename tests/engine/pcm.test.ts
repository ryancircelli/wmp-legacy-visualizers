// @vitest-environment node
// The host socket's PCM analysis (src/engine/audio/pcm.ts) stays byte-identical through its speedups:
// fftMags against the bin-outer loop it replaced, bit for bit, and createPcmSource's skipped FFTs
// (no new samples since the last fill) against recomputing on every fill.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcmSource, fftMags, magBytes, waveBytes } from '../../src/engine/audio/pcm';
import { makeLevel } from '../../src/engine';

const N = 2048;
function lcg(seed: number): () => number {
  let s = seed | 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
}

// fftMags as it shipped before the loop reorder: same tables, bin-outer butterflies.
const WIN = new Float32Array(N), REV = new Uint16Array(N), TWR = new Float32Array(N >> 1), TWI = new Float32Array(N >> 1);
for (let i = 0; i < N; i++) {
  WIN[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
  let r = 0, x = i;
  for (let b = 0; b < 11; b++, x >>= 1) r = (r << 1) | (x & 1);
  REV[i] = r;
}
for (let k = 0; k < N >> 1; k++) { TWR[k] = Math.cos((-2 * Math.PI * k) / N); TWI[k] = Math.sin((-2 * Math.PI * k) / N); }
const RE = new Float32Array(N), IM = new Float32Array(N);
function reference(ring: Float32Array, at: number, gain: number, mags: Float32Array): void {
  for (let i = 0; i < N; i++) { const j = REV[i]!; RE[i] = ring[(at + j) & (N - 1)]! * WIN[j]! * gain; IM[i] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const tr = TWR[k]! * RE[j + half]! - TWI[k]! * IM[j + half]!, ti = TWR[k]! * IM[j + half]! + TWI[k]! * RE[j + half]!;
        const ur = RE[j]!, ui = IM[j]!;
        RE[j] = ur + tr; IM[j] = ui + ti; RE[j + half] = ur - tr; IM[j + half] = ui - ti;
      }
    }
  }
  for (let k = 0; k < N >> 1; k++) mags[k] = Math.sqrt(RE[k]! * RE[k]! + IM[k]! * IM[k]!) / N;
}

// Music-ish, full-scale noise, subnormals, DC, Nyquist and silence: every rounding regime.
function windows(): Float32Array[] {
  const r = lcg(7), out: Float32Array[] = [];
  for (let w = 0; w < 24; w++) {
    out.push(Float32Array.from({ length: N }, (_, i) =>
      0.3 * Math.sin(2 * Math.PI * (55 + 40 * w) * i / 48000) + 0.1 * Math.sin(2 * Math.PI * 3.01 * (55 + 40 * w) * i / 48000) + 0.05 * (r() * 2 - 1)));
  }
  out.push(Float32Array.from({ length: N }, () => (r() * 2 - 1) * 4));
  out.push(Float32Array.from({ length: N }, () => (r() * 2 - 1) * 1e-38));
  out.push(new Float32Array(N).fill(1), Float32Array.from({ length: N }, (_, i) => (i & 1 ? 1 : -1)), new Float32Array(N));
  return out;
}

describe('fftMags', () => {
  it('matches the bin-outer loop bit for bit', () => {
    const want = new Float32Array(N >> 1), got = new Float32Array(N >> 1);
    for (const ring of windows()) {
      for (const gain of [1, 0.5, 2, 0.37, 0]) {
        for (const at of [0, 1, 777]) {
          reference(ring, at, gain, want);
          fftMags(ring, at, gain, got);
          for (let k = 0; k < want.length; k++) if (!Object.is(want[k], got[k])) expect([k, got[k]]).toEqual([k, want[k]]);
        }
      }
    }
  });
});

describe('createPcmSource', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives the bytes of a full recompute on every fill, whatever arrives between fills', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = lcg(3), src = createPcmSource(), level = makeLevel();
    // the reference recomputes everything on every fill, as the source did before it skipped FFTs
    const ring = [new Float32Array(N), new Float32Array(N)], mags = [new Float32Array(N >> 1), new Float32Array(N >> 1)];
    const prev = [new Float32Array(N >> 1), new Float32Array(N >> 1)], want = makeLevel();
    let at = 0, fresh = 0, gain = 1, smoothing = 0, t = 0, fills = 0;
    const diff: string[] = [];
    for (let step = 0; step < 600; step++) {
      // a period, a LineWriter half, a backed-up burst, or nothing at all
      const x = r(), n = x < 0.55 ? 480 : x < 0.7 ? 1 + ((r() * 479) | 0) : x < 0.8 ? 3000 : 0;
      if (n) {
        const pcm = new Float32Array(n * 2);
        for (let i = 0; i < n; i++, t++) { pcm[i * 2] = 0.3 * Math.sin(t / 7) + 0.05 * (r() * 2 - 1); pcm[i * 2 + 1] = 0.2 * Math.sin(t / 3); }
        src.push(pcm);
        for (let i = n > N ? n - N : 0; i < n; i++) { ring[0]![at] = pcm[i * 2]!; ring[1]![at] = pcm[i * 2 + 1]!; at = (at + 1) & (N - 1); }
        fresh = now;
      }
      now += x < 0.95 ? 10 : 400;                                      // now and then a stall
      if (r() < 0.05) smoothing = [0, 0.5, 0.8][(r() * 3) | 0]!;
      for (let f = 1 + (r() < 0.2 ? 2 : 0); f > 0; f--) {              // a frame loop catching up
        if (r() < 0.1) gain = [1, 0.5, 0, 2][(r() * 4) | 0]!;           // the slider, between two fills
        src.smoothing = smoothing;
        src.fill(level, gain);
        if (now - fresh > 250) { ring[0]!.fill(0); ring[1]!.fill(0); }
        for (let c = 0; c < 2; c++) {
          fftMags(ring[c]!, at, gain, mags[c]!);
          magBytes(mags[c]!, prev[c]!, want.freq[c]!, smoothing);
          waveBytes(ring[c]!, at, gain, want.wave[c]!);
        }
        fills++;
        for (let c = 0; c < 2; c++) {
          if (Buffer.compare(level.freq[c]!, want.freq[c]!)) diff.push(`step ${step} freq[${c}]`);
          if (Buffer.compare(level.wave[c]!, want.wave[c]!)) diff.push(`step ${step} wave[${c}]`);
        }
      }
    }
    expect(fills).toBeGreaterThan(700);
    expect(diff).toEqual([]);
  });
});
