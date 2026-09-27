// The local sources' Web Audio wiring on top of the engine's two TimedLevel producers
// (src/engine/audio/analyser.ts for AudioNodes, pcm.ts for the host socket's samples).
import type { TimedLevel } from '../../model';
import { createAnalyserSource, DB_WINDOW, type AnalyserLevelSource } from '../../engine/audio/analyser';
import { createPcmSource } from '../../engine/audio/pcm';
export { makeLevel } from '../../engine/index';

/** ?db=<min>,<max> overrides the analyser dB window (calibration only; opt-in). */
function dbWindow(): readonly [number, number] {
  const q = /(^|[?&])db=(-?[0-9.]+),(-?[0-9.]+)/.exec(location.search);
  return q ? [+q[2]!, +q[3]!] : DB_WINDOW;
}

export interface AnalyserGraph {
  connect(node: AudioNode): void;
  source(stream: MediaStream): AudioNode;
  setGain(g: number): void;
  setSmoothing(v: number): void;
  /** an AudioContext made without a gesture starts suspended */
  resume(): void;
  fill(level: TimedLevel): void;
  /** ?src=tone: a sawtooth swept by an LFO (screenshots / CI) */
  tone(): { node: AudioNode; stop(): void };
  /** ?src=url:<href>: an audio element, looped */
  file(href: string): { node: AudioNode; isPaused(): boolean; pause(on: boolean): void; stop(): void; play(): Promise<void> };
  close(): void;
}

export function createAnalyserGraph(smoothing: number): AnalyserGraph {
  const a: AnalyserLevelSource = createAnalyserSource({ smoothing, dbWindow: dbWindow() });
  const c = a.context;
  let el: HTMLAudioElement | null = null, elNode: MediaElementAudioSourceNode | null = null;
  return {
    connect: (node) => node.connect(a.input),
    source: (stream) => c.createMediaStreamSource(stream),
    setGain: (g) => { a.input.gain.value = g; },
    setSmoothing: (v) => a.setSmoothing(v),
    resume: () => { if (c.state === 'suspended') void c.resume(); },
    fill: (level) => a.fill(level),
    tone() {
      const osc = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain(), g = c.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 80;
      lfo.frequency.value = 0.4; depth.gain.value = 60;
      lfo.connect(depth); depth.connect(osc.frequency);
      g.gain.value = 0.9;
      osc.connect(g); osc.start(); lfo.start();
      return { node: g, stop: () => { osc.stop(); lfo.stop(); } };
    },
    file(href) {
      if (!el) {
        el = new Audio();
        el.crossOrigin = 'anonymous';
        el.loop = true;
        // createMediaElementSource may only be called once per element.
        elNode = c.createMediaElementSource(el);
        elNode.connect(c.destination);
      }
      const e = el;
      e.src = href;
      return { node: elNode!, isPaused: () => e.paused, stop: () => e.pause(),
               pause: (on) => { if (on) e.pause(); else void e.play().catch(() => {}); }, play: () => e.play() };
    },
    close: () => { void c.close().catch(() => {}); },
  };
}

export function createPcmLevel(): { push(pcm: Float32Array): void; fill(level: TimedLevel, gain: number, smoothing: number): void } {
  const p = createPcmSource({ dbWindow: dbWindow() });
  return { push: (f) => p.push(f), fill: (level, gain, smoothing) => { p.smoothing = smoothing; p.fill(level, gain); } };
}
