// The local sources' Web Audio wiring on top of the engine's two TimedLevel producers
// (src/engine/audio/analyser.ts for AudioNodes, pcm.ts for the host socket's samples).
import type { TimedLevel, VisKind } from '../../model';
import { createAnalyserSource, type AnalyserLevelSource } from '../../engine/audio/analyser';
import { createPcmSource } from '../../engine/audio/pcm';
import type { WmpBuild } from '../../engine/audio/wmp';
export { makeLevel } from '../../engine/index';

/** Whose analyzer arithmetic feeds a visualizer: the WMP its port follows. Ambience, Spikes, Particle and
 *  Plenoptic are WMP 9/10's (wmp.dll, x87), Alchemy, Bars and Waves and Battery today's (SSE). The bytes differ by
 *  1 in a few thousandths of a percent of them. */
const WMP9: readonly VisKind[] = ['ambience', 'spikes', 'particle', 'plenoptic'];
const buildFor = (kind: VisKind): WmpBuild => (WMP9.includes(kind) ? 'wmp9' : 'wmp12');

export interface AnalyserGraph {
  connect(node: AudioNode): void;
  source(stream: MediaStream): AudioNode;
  setGain(g: number): void;
  setSmoothing(v: number): void;
  /** an AudioContext made without a gesture starts suspended */
  resume(): void;
  fill(level: TimedLevel, kind: VisKind): void;
  /** ?src=tone: a sawtooth swept by an LFO (screenshots / CI) */
  tone(): { node: AudioNode; stop(): void };
  /** ?src=url:<href>: an audio element, looped */
  file(href: string): { node: AudioNode; isPaused(): boolean; pause(on: boolean): void; stop(): void; play(): Promise<void> };
  close(): void;
}

export function createAnalyserGraph(smoothing: number): AnalyserGraph {
  const a: AnalyserLevelSource = createAnalyserSource({ smoothing });
  const c = a.context;
  let el: HTMLAudioElement | null = null, elNode: MediaElementAudioSourceNode | null = null;
  return {
    connect: (node) => node.connect(a.input),
    source: (stream) => c.createMediaStreamSource(stream),
    setGain: (g) => { a.input.gain.value = g; },
    setSmoothing: (v) => a.setSmoothing(v),
    resume: () => { if (c.state === 'suspended') void c.resume(); },
    fill: (level, kind) => { a.setBuild(buildFor(kind)); a.fill(level); },
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

export function createPcmLevel(): { setRate(rate: number): void; push(pcm: Float32Array, gain: number): void; fill(level: TimedLevel, smoothing: number, kind: VisKind): void } {
  const p = createPcmSource();
  return {
    setRate: (r) => p.setRate(r),
    push: (f, gain) => p.push(f, gain),
    fill: (level, smoothing, kind) => { p.smoothing = smoothing; p.setBuild(buildFor(kind)); p.fill(level); },
  };
}
