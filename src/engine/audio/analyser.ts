// TimedLevel from Web Audio (display capture, loopback, the CI tone, a URL): the graph's raw samples through
// WMP's own analyzer (pcm.ts, wmp.ts). An AudioWorklet taps the stereo signal and posts it to the page, which
// analyses it exactly as the host socket's samples are. Until the worklet runs, or where it cannot (no
// AudioWorklet, a file:// page, whose opaque origin cannot load the blob: module, a CSP refusing it), an
// AnalyserNode stands in: its newest 2048 samples through the same analyzer on every fill. Same window, FFT and
// bytes, but no carried-over history (WMP windows the overlap twice: about 0.5 dB on a tone at 44.1 kHz) and a
// fresh snapshot per fill rather than 30 a second.
import type { TimedLevel } from '../ns';
import { createPcmSource } from './pcm';
import { WmpAnalyzer, type WmpBuild } from './wmp';

export interface AnalyserLevelSource {
  readonly context: AudioContext;
  /** Connect sources here. Its gain is the volume slider: capture sensitivity ahead of the analyser. */
  readonly input: GainNode;
  setSmoothing(v: number): void;
  /** Whose arithmetic: pcm.ts setBuild. */
  setBuild(build: WmpBuild): void;
  /** Fill freq/wave/timeStamp of both channels (state is the caller's). */
  fill(level: TimedLevel): void;
}

// Batches of 512 frames (about 11 ms at 48 kHz, well inside a hop), interleaved, handed over with their buffer.
const TAP = `registerProcessor('wmp-tap', class extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const l = ch[0], r = ch[1] || ch[0];
      for (let i = 0; i < l.length; i++) {
        this.b[this.n++] = l[i]; this.b[this.n++] = r[i];
        if (this.n === 1024) { this.port.postMessage(this.b, [this.b.buffer]); this.b = new Float32Array(1024); this.n = 0; }
      }
    }
    return true;
  }
});`;

export function createAnalyserSource(opts: { context?: AudioContext; smoothing?: number } = {}): AnalyserLevelSource {
  const actx = opts.context ?? new AudioContext();
  // ChannelSplitterNode-style consumers see a mono input as one channel; this gain node does the mono -> L/R
  // duplication ("speakers" up-mix) and passes stereo through untouched. Sources attach here.
  const up = actx.createGain();
  up.channelCount = 2;
  up.channelCountMode = 'explicit';
  up.channelInterpretation = 'speakers';
  // Keep the graph pulling even when nothing is routed to the speakers.
  const mute = actx.createGain();
  mute.gain.value = 0;
  mute.connect(actx.destination);
  const pcm = createPcmSource(actx.sampleRate, { smoothing: opts.smoothing });

  // the stand-in: an AnalyserNode per channel, read as float samples
  const split = actx.createChannelSplitter(2);
  up.connect(split);
  const analysers = [actx.createAnalyser(), actx.createAnalyser()];
  analysers.forEach((a, c) => { a.fftSize = 2048; split.connect(a, c); });
  split.connect(mute);
  const f32 = new Float32Array(2048), s16 = new Int16Array(4096);
  let one = new WmpAnalyzer(actx.sampleRate, 2);
  function standIn(level: TimedLevel): void {
    for (let c = 0; c < 2; c++) {
      analysers[c].getFloatTimeDomainData(f32);
      for (let i = 0; i < 2048; i++) {
        const v = Math.round(f32[i] * 32768);
        s16[i * 2 + c] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
    one.reset();
    one.process(s16, 2048, 0);
    for (let c = 0; c < 2; c++) { level.freq[c].set(one.freq[c]); level.wave[c].set(one.wave[c]); }
    level.timeStamp = Math.floor(actx.currentTime * 1e7);
  }

  let tapped = false;
  const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
  actx.audioWorklet?.addModule(url).then(() => {
    const tap = new AudioWorkletNode(actx, 'wmp-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => pcm.push(e.data);
    up.connect(tap);
    tap.connect(mute);
    up.disconnect(split);
    tapped = true;
  }).catch(() => { /* the stand-in stays */ }).finally(() => URL.revokeObjectURL(url));

  return {
    context: actx,
    input: up,
    setSmoothing(v) { pcm.smoothing = v; },
    setBuild(b) { pcm.setBuild(b); if (b !== one.build) one = new WmpAnalyzer(actx.sampleRate, 2, b); },
    fill(level) { if (tapped) pcm.fill(level); else standIn(level); },
  };
}
