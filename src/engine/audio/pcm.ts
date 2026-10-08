// TimedLevel from raw PCM through WMP's own analyzer (wmp.ts), whatever the samples' way in: the desktop host's
// WASAPI loopback over its WebSocket ({"rate":n}, then interleaved stereo float32; tauri/src/audio), the iOS
// host's librespot audio through the same socket stand-in (int16 as float, ios/WmpSpotify/observer.js), and the
// browser's own audio graph through an AudioWorklet tap (analyser.ts).
//
// The samples go in as 16-bit, as a decoder hands them to WMP (x·32768 rounded and clamped: the iOS host's int16
// come back exactly), in buffers of exactly hop = rate/30 frames, which keeps WMP's windows contiguous: each
// snapshot is the 2048 samples ending hop after the last one's, 30 a second of sound. Each fill() hands out the
// newest snapshot, as WMP's host does for a clock past every queued snapshot (TIMEDLEVEL.md §3.8), with its
// timestamp (100 ns of stream time): a fill faster than the snapshots repeats one, timestamp and all, which is
// what Bars and Spikes hold on and what Particle's timer counts.
import type { TimedLevel } from '../ns';
import { WmpAnalyzer, type WmpBuild } from './wmp';

export interface PcmLevelSource {
  /** Off-WMP option: an exponential average over fills, 0 = none (WMP has none). */
  smoothing: number;
  /** The sample rate, from the host's {"rate"} frame or the AudioContext; a change starts a fresh analyzer. */
  setRate(rate: number): void;
  /** Whose arithmetic (wmp.ts ROUNDING): the WMP the visualizer on screen comes from. A change starts afresh. */
  setBuild(build: WmpBuild): void;
  /** Interleaved stereo float32 in [-1, 1]; `gain` scales it first (the volume slider as capture sensitivity). */
  push(pcm: Float32Array, gain?: number): void;
  /** freq, wave and timeStamp of both channels from the newest snapshot (state is the caller's): frequency 0 and
   *  wave 128 before the first, as WMP shows with none; a quarter second with no samples is taken as silence. */
  fill(level: TimedLevel): void;
}

export function createPcmSource(rate = 48000, opts: { smoothing?: number } = {}): PcmLevelSource {
  let an = new WmpAnalyzer(rate, 2), s16 = new Int16Array(0), fresh = 0, fedAt = 0, zeros = new Int16Array(0);
  const avg = [new Float32Array(1024), new Float32Array(1024)];
  const src: PcmLevelSource = {
    smoothing: opts.smoothing ?? 0,
    setRate(r) { if (r > 0 && r !== an.rate) an = new WmpAnalyzer(r, 2, an.build); },
    setBuild(b) { if (b !== an.build) an = new WmpAnalyzer(an.rate, 2, b); },
    push(pcm, gain = 1) {
      if (s16.length < pcm.length) s16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const v = Math.round(pcm[i] * gain * 32768);
        s16[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      an.push(s16, pcm.length >> 1);
      fresh = fedAt = performance.now();
    },
    fill(level) {
      // Nothing for a quarter second: the stream stalled, nothing plays (the desktop host then sends nothing), or
      // the helper died between restarts. That time is silence, fed as such: its snapshots go on every hop, so the
      // spectrum falls as it does on a silent track and the timestamps the visualizers hold on keep moving.
      const now = performance.now();
      if (now - fresh > 250) {
        const n = Math.min(Math.round(((now - fedAt) * an.rate) / 1000), an.rate);
        if (n > 0) {
          if (zeros.length < n * 2) zeros = new Int16Array(n * 2);
          an.push(zeros, n);
          fedAt = now;
        }
      }
      const sm = src.smoothing;
      for (let c = 0; c < 2; c++) {
        const f = an.freq[c], out = level.freq[c], a = avg[c];
        if (sm) for (let k = 0; k < 1024; k++) out[k] = Math.round((a[k] = sm * a[k] + (1 - sm) * f[k]));
        else out.set(f);
        level.wave[c].set(an.wave[c]);
      }
      level.timeStamp = an.ts;
    },
  };
  return src;
}
