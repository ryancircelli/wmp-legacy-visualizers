// ?src=synthetic: a silent stand-in for music, for a screen with no audio and no user gesture (a TV's screen
// saver). A small drum machine and synth, generated in JS and pushed through the same PCM path as the desktop
// host's loopback samples (createPcmLevel: WMP's own analyzer), so every visualizer sees beats, a moving spectrum
// and a waveform. Nothing is played: no AudioContext, no element, nothing near the speakers, so no gesture is
// needed either. The samples are made on the visualizers' clock, in fill(), as many as the wall clock says are
// due: a hidden page makes none, and a stall longer than half a second is skipped rather than caught up.
//
// The music: sections of 8 bars, each with its own tempo, key, chord progression and arrangement (kick, snare,
// hats, bass, arpeggio, pad; a drumless breakdown now and then), so the spectrum, the beats and the loudness keep
// changing over hours. Cheap: a sine table, phase accumulators and one multiply per envelope per sample, about
// 44,100 stereo frames a second.
import type { TimedLevel, VisKind } from '../../model';
import { createPcmLevel } from './audio';

export const SYNTH_RATE = 44100;

const TABLE = 4096;
const SIN = new Float32Array(TABLE);
for (let i = 0; i < TABLE; i++) SIN[i] = Math.sin((2 * Math.PI * i) / TABLE);
/** sin(2π·ph) for a phase in [0, 1) */
const sin = (ph: number): number => SIN[(ph * TABLE) | 0]!;
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** The per-sample factor that takes an envelope down 60 dB in `sec` seconds. */
const decay = (sec: number, rate: number): number => Math.exp(Math.log(0.001) / (sec * rate));

/** Chords as [semitones above the key, minor]. */
const PROGRESSIONS: readonly (readonly [number, boolean])[][] = [
  [[0, false], [7, false], [9, true], [5, false]],     // I V vi IV
  [[0, true], [8, false], [3, false], [10, false]],    // i VI III VII
  [[0, true], [5, true], [7, false], [0, true]],       // i iv V i
  [[9, true], [5, false], [0, false], [7, false]],     // vi IV I V
  [[0, false], [5, false], [0, false], [7, false]],    // I IV I V
  [[0, true], [10, false], [8, false], [7, false]],    // i VII VI V
];
/** Steps of a bar of 16ths, as bit masks (bit i = step i). */
const bits = (...s: number[]): number => s.reduce((m, i) => m | (1 << i), 0);
const KICKS = [bits(0, 4, 8, 12), bits(0, 6, 10), bits(0, 3, 8, 11, 14), bits(0, 4, 8, 10, 12)];
const SNARES = [bits(4, 12), bits(4, 12, 15), bits(4, 11, 12)];
const HATS = [bits(2, 6, 10, 14), bits(0, 2, 4, 6, 8, 10, 12, 14), 0xffff];
const BASSES = [bits(0, 2, 4, 6, 8, 10, 12, 14), bits(0, 3, 6, 8, 11, 14), bits(0, 7, 8, 10), 0xffff];
const ARPS = [0xffff, bits(0, 2, 4, 6, 8, 10, 12, 14), bits(0, 3, 6, 9, 12, 14)];
const TEMPOS = [96, 104, 112, 120, 124, 128, 136];

interface Section { kick: number; snare: number; hat: number; bass: number; arp: number; pad: boolean; drums: boolean; prog: number; key: number; bpm: number; bright: number }

export interface Synth {
  readonly rate: number;
  /** The next `frames` stereo frames, interleaved, into out[0 .. 2·frames), each sample in [-1, 1]. */
  render(out: Float32Array, frames: number): void;
}

export function createSynth(rate = SYNTH_RATE, seed = 0x5eed): Synth {
  let s = seed | 0 || 1;
  const rnd = (): number => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const pick = <T>(a: readonly T[]): T => a[(rnd() * a.length) | 0]!;

  const kickAmp = decay(0.35, rate), kickPitch = decay(0.06, rate), snareD = decay(0.18, rate), hatD = decay(0.05, rate),
        bassD = decay(0.45, rate), arpD = decay(0.22, rate);
  let sec: Section = { kick: 0, snare: 0, hat: 0, bass: 0, arp: 0, pad: true, drums: false, prog: 0, key: 45, bpm: 120, bright: 0.2 };
  let wasBreak = true, bar = 0, step = 0, stepLeft = 0, stepLen = 1, chord = 0;
  // voices
  let kPh = 0, kF = 0, kA = 0, snA = 0, snPh = 0, hA = 0, hPrev = 0, hPan = 0.5;
  let bPh = 0, bF = 55, bA = 0, bLp = 0, aPh = 0, aF = 440, aA = 0, aPan = 0.3, aIdx = 0;
  const pPh = new Float64Array(6), pF = new Float64Array(6);
  let pA = 0, pTarget = 0, swell = 0, t = 0;

  function newSection(): void {
    const brk = !wasBreak && rnd() < 0.2;
    wasBreak = brk;
    sec = {
      drums: !brk, kick: pick(KICKS), snare: rnd() < 0.85 ? pick(SNARES) : 0, hat: rnd() < 0.85 ? pick(HATS) : 0,
      bass: brk && rnd() < 0.5 ? 0 : pick(BASSES), arp: rnd() < 0.75 || brk ? pick(ARPS) : 0, pad: brk || rnd() < 0.7,
      prog: (rnd() * PROGRESSIONS.length) | 0, key: 40 + ((rnd() * 12) | 0), bpm: pick(TEMPOS), bright: 0.06 + rnd() * 0.3,
    };
    stepLen = Math.round((rate * 60) / sec.bpm / 4);
  }
  function newChord(): void {
    const [off, minor] = PROGRESSIONS[sec.prog]![chord]!;
    const root = sec.key + off, tones = [root + 12, root + 12 + (minor ? 3 : 4), root + 19];
    bF = hz(root - 12);
    for (let i = 0; i < 3; i++) { const f = hz(tones[i]!); pF[2 * i] = f * 1.003; pF[2 * i + 1] = f * 0.997; }
    pTarget = sec.pad ? 1 : 0;
  }
  function onStep(): void {
    if (step === 16) { step = 0; bar++; if (bar % 8 === 0) newSection(); if (bar % 2 === 0) { chord = (chord + 1) % 4; } newChord(); }
    const b = 1 << step;
    if (sec.drums && sec.kick & b) { kA = 1; kF = 120; }
    if (sec.drums && sec.snare & b) snA = 1;
    if (sec.drums && sec.hat & b) { hA = 0.6 + 0.4 * rnd(); hPan = 0.25 + 0.5 * rnd(); }
    if (sec.bass & b) { bA = 1; }
    if (sec.arp & b) {
      const [off, minor] = PROGRESSIONS[sec.prog]![chord]!;
      const r = sec.key + off + 24, notes = [r, r + (minor ? 3 : 4), r + 7, r + 12];
      aF = hz(notes[aIdx++ % 4]! + (rnd() < 0.15 ? 12 : 0)); aA = 1; aPan = aPan < 0.5 ? 0.75 : 0.25;
    }
    step++;
    stepLeft = stepLen;
  }
  newSection();
  newChord();
  step = 0; onStep();

  return {
    rate,
    render(out, frames) {
      for (let i = 0; i < frames; i++) {
        if (stepLeft === 0) onStep();
        stepLeft--;
        // once per 64 samples: the pad's glide and the section's slow swell and filter sweep
        if ((t & 63) === 0) {
          pA += (pTarget - pA) * 0.01;
          swell = 0.75 + 0.25 * sin(((t / (rate * 9.7)) % 1 + 1) % 1);
        }
        t++;
        let l = 0, r = 0;
        // kick: a sine falling from ~165 Hz to 45
        if (kA > 1e-4) {
          kPh += (45 + kF) / rate; kPh -= kPh | 0; kF *= kickPitch; kA *= kickAmp;
          const v = sin(kPh) * kA * 0.55; l += v; r += v;
        }
        const n = rnd() * 2 - 1;
        if (snA > 1e-4) {
          snPh += 190 / rate; snPh -= snPh | 0; snA *= snareD;
          const v = (n * 0.7 + sin(snPh) * 0.3) * snA * 0.3; l += v; r += v;
        }
        if (hA > 1e-4) {
          const v = (n - hPrev) * hA * 0.08; hA *= hatD; l += v * (1 - hPan); r += v * hPan;
        }
        hPrev = n;
        if (bA > 1e-4) {
          bPh += bF / rate; bPh -= bPh | 0; bA *= bassD;
          bLp += (bPh * 2 - 1 - bLp) * sec.bright;
          const v = bLp * bA * 0.3; l += v; r += v;
        }
        if (aA > 1e-4) {
          aPh += aF / rate; aPh -= aPh | 0; aA *= arpD;
          const v = (sin(aPh) + 0.3 * (aPh < 0.5 ? 1 : -1)) * aA * 0.12; l += v * (1 - aPan); r += v * aPan;
        }
        if (pA > 1e-3) {
          let pl = 0, pr = 0;
          for (let k = 0; k < 6; k += 2) {
            let a = pPh[k]! + pF[k]! / rate, c = pPh[k + 1]! + pF[k + 1]! / rate;
            a -= a | 0; c -= c | 0; pPh[k] = a; pPh[k + 1] = c;
            pl += 1 - 4 * Math.abs(a - 0.5); pr += 1 - 4 * Math.abs(c - 0.5);   // triangles
          }
          l += pl * pA * 0.05; r += pr * pA * 0.05;
        }
        l *= swell; r *= swell;
        out[2 * i] = l > 1 ? 1 : l < -1 ? -1 : l;
        out[2 * i + 1] = r > 1 ? 1 : r < -1 ? -1 : r;
      }
    },
  };
}

/** The synthetic source: samples made on demand, as the wall clock says are due, into WMP's analyzer. */
export function createSyntheticLevel(opts: { now?: () => number; seed?: number } = {}): { fill(level: TimedLevel, smoothing: number, kind: VisKind, preset: number): void } {
  const now = opts.now ?? (() => performance.now());
  const syn = createSynth(SYNTH_RATE, opts.seed), pcm = createPcmLevel(), chunk = 4096, buf = new Float32Array(chunk * 2);
  pcm.setRate(SYNTH_RATE);
  let t0 = -1, made = 0;
  return {
    fill(level, smoothing, kind, preset) {
      const t = now();
      if (t0 < 0) t0 = t;
      const due = Math.floor(((t - t0) * SYNTH_RATE) / 1000);
      // A hidden page or a long stall: start again from now, not with seconds of samples in one frame.
      if (due - made > SYNTH_RATE / 2) made = due - (SYNTH_RATE / 30) * 2;
      while (made < due) {
        const n = Math.min(chunk, due - made);
        syn.render(buf, n);
        pcm.push(n === chunk ? buf : buf.subarray(0, n * 2), 1);
        made += n;
      }
      pcm.fill(level, smoothing, kind, preset);
    },
  };
}
