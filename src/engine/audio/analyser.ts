// TimedLevel from Web Audio: the old shell's audioGraph() + fillLevel() (src/90-shell.js), lifted as is.
import type { TimedLevel } from '../ns';

// The Web Audio defaults (-100/-30) clip every bin of a normal-loudness track at 255, so `bass` pins near
// its 1.275 ceiling and loses all dynamics. Default window fitted against WMP's own Bars visualizer
// (spec/CALIBRATION.md, agentH): WMP frequency byte == getByteFrequencyData with min -93 / max -15.1 dB
// (residuals < 3.3/256). The old page took `?db=<min>,<max>` to override it (opt-in only).
export const DB_WINDOW: readonly [number, number] = [-93.0, -15.1];

export interface AnalyserLevelSource {
  readonly context: AudioContext;
  /** Connect sources here. Its gain is the volume slider: capture sensitivity ahead of the analysers. */
  readonly input: GainNode;
  readonly analysers: readonly [AnalyserNode, AnalyserNode];
  setSmoothing(v: number): void;
  /** Fill freq/wave of both channels from the analysers (state/timeStamp are the caller's). */
  fill(level: TimedLevel): void;
}

export interface AnalyserOptions {
  context?: AudioContext;
  smoothing?: number;
  dbWindow?: readonly [number, number];
}

export function createAnalyserSource(opts: AnalyserOptions = {}): AnalyserLevelSource {
  const actx = opts.context ?? new AudioContext();
  const db = opts.dbWindow ?? DB_WINDOW;
  // ChannelSplitterNode's channelInterpretation is locked to "discrete", so a mono input
  // would leave channel 1 silent. This gain node does the mono -> L/R duplication
  // ("speakers" up-mix) and passes stereo through untouched; sources attach here.
  const up = actx.createGain();
  up.channelCount = 2;
  up.channelCountMode = 'explicit';
  up.channelInterpretation = 'speakers';
  const split = actx.createChannelSplitter(2);
  up.connect(split);
  const analysers: [AnalyserNode, AnalyserNode] = [actx.createAnalyser(), actx.createAnalyser()];
  for (let c = 0; c < 2; c++) {
    const a = analysers[c];
    a.fftSize = 2048; // => frequencyBinCount 1024
    a.smoothingTimeConstant = opts.smoothing ?? 0;
    a.minDecibels = db[0];
    a.maxDecibels = db[1];
    split.connect(a, c);
  }
  // Keep the graph pulling even when nothing is routed to the speakers.
  const mute = actx.createGain();
  mute.gain.value = 0;
  split.connect(mute);
  mute.connect(actx.destination);

  const waveScratch = new Uint8Array(2048);
  return {
    context: actx,
    input: up,
    analysers,
    setSmoothing(v) {
      for (const a of analysers) a.smoothingTimeConstant = v;
    },
    fill(level) {
      for (let c = 0; c < 2; c++) {
        const a = analysers[c];
        a.getByteFrequencyData(level.freq[c]);
        // getByteTimeDomainData copies the OLDEST min(fftSize, len) samples; WMP's waveform holds the
        // most recent 1024, so read the full 2048 window and keep its last half (agentI finding).
        a.getByteTimeDomainData(waveScratch);
        level.wave[c].set(waveScratch.subarray(1024));
      }
    },
  };
}
