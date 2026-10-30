// Alchemy.TwistedPixel — Visolu's TwistedPixel 1.0 (TwistedPixel.dll 1.0.0.1, Brian Spangler, 2003), a MilkDrop-style Direct3D 8
// visualization whose 333 presets are VBScript (and one JScript) programs. One preset to WMP, "TwistedPixel Preset Vis"; the
// plug-in deals its own presets in a shuffled order and cross-fades between them.
//
// The port runs the DLL's engine (./engine.ts: audio, scheduling, timing), the presets' script contexts (./ctx.ts,
// with the interpreters in ./script), the waves and shapes (./waves.ts, ./shapes.ts) and the canvas (./canvas.ts),
// issuing the Direct3D 8 calls the DLL issues through a Device (../d3d8/api.ts): by default the reference-
// rasterizer port, whose back buffer is the frame. The presets are our own (./own); the plug-in's 333 are its authors'.
import { A, type Surface, type TimedLevel } from '../ns';
import type { Device } from '../d3d8/api';
import { RefDevice } from '../d3d8/ref';
import { DEFAULT_SETTINGS, Engine, meshDims, type Settings, textureDims } from './engine';
import { Canvas } from './canvas';
import { Waves } from './waves';
import { Shapes } from './shapes';
import { PresetContext } from './ctx';
import { ntfsOrder } from './presets';
import type { FontData } from '../d3d8/d3dfont';
import { V } from './vars';
import { OWN } from './own/index';

declare module '../ns' {
  interface AlchemyNS {
    TwistedPixel: typeof TwistedPixel;
  }
}

const PRESET_NAMES: string[] = ['TwistedPixel Preset Vis'];   // GetPresetTitle(0)

export interface TwistedPixelConfig {
  width?: number;
  height?: number;
  /** TwistedPixel.ini: meshSize, desiredFps, disablePresetFps, useBeatDetection; clock: GetTickCount in ms */
  options?: Partial<Settings> & { clock?: (() => number) | null };
  preset?: number;
  /** the device to draw through (default: a RefDevice of width x height) */
  device?: Device;
  /** the corner text's font (default: the port's own lettering) */
  font?: FontData;
  /** the preset files (default: our own, ./own) */
  presets?: { names: string[]; source(name: string): string | null };
}

class TwistedPixel {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  w: number;
  h: number;
  preset = 0;
  private readonly cfg: TwistedPixelConfig;
  private dev: Device | null = null;
  private eng: Engine | null = null;
  private out: Surface | null = null;
  private frames = 0;
  private tick = 0;

  constructor(cfg: TwistedPixelConfig = {}) {
    this.cfg = cfg;
    this.w = cfg.width || 640; this.h = cfg.height || 480;
  }

  /** the DLL seeds rand from GetTickCount when it builds its engine */
  seed(_n: number): this { return this; }

  /** a new size rebuilds everything on the next frame */
  resize(w: number, h: number): void {
    w = w | 0; h = h | 0;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.eng = null; this.dev = null;
  }

  setPreset(n: number): boolean { return (n | 0) === 0; }

  private now(): number {
    const c = this.cfg.options?.clock;
    return (c ? c() : Math.floor(typeof performance !== 'undefined' ? performance.now() : Date.now())) >>> 0;
  }

  private build(): Engine {
    const cfg = this.cfg, w = this.w, h = this.h;
    const settings: Settings = { ...DEFAULT_SETTINGS, ...cfg.options };
    const dev = this.dev = cfg.device ?? new RefDevice(w, h);
    const [texW, texH] = textureDims(w, h), [meshW, meshH] = meshDims(settings.meshSize);
    const clock = { tick: () => this.tick, qpc: () => this.tick * 1000, qpf: 1e6 };
    const canvas = new Canvas(dev, w, h, texW, texH, meshW, meshH, clock.tick, cfg.font);
    const presets = cfg.presets ?? { names: ntfsOrder(Object.keys(OWN)), source: (n: string) => OWN[n] ?? null };
    let waves: Waves | null = null;
    const shapes = new Shapes();
    const eng: Engine = new Engine({
      width: w, height: h, clock, names: presets.names, source: (n) => presets.source(n),
      makeCtx: (e) => {
        waves ??= new Waves(texW, texH, e.audio);   // the engine's audio exists before its contexts
        return new PresetContext(e, {
          env: {
            rand: () => A.rand(), texW, texH,
            nextPreset: (s) => { e.cur.nextPreset = s; },
            debugOut: (s) => canvas.debugOut(s),
          },
          // 0x10027a20: the current preset's name, then the engine's error report
          onScriptError: (_c, err) => canvas.scriptError(`${e.curName}\n${err.lineText ?? '(null)'}\n${err.description}\nSrc: ${err.source}` +
            `\nLine:${err.line} Error:${err.wCode} Scode:${err.scode.toString(16)}`),
          addWaveformElement: (a) => waves!.addWaveformElement(e.cur.vars, a[0], a[1], a[2], a[3], a[4], a[5], a[6]),
          arrays: () => [e.audio.R, e.audio.L, e.audio.freqR, e.audio.freqL],
        });
      },
      waves: {
        setNextMode: (v, r) => waves!.setNextMode(v, r),
        commitMode: (c) => waves!.commitMode(c),
        update: (c, color, t, fading, w7c, w78) => waves!.update(c, color, t, fading, w7c, w78),
      },
      canvas,
      render: (e) => {
        const cur = e.cur as PresetContext;
        canvas.render({ value: cur.vars, postFx: cur.postFx }, () => {
          shapes.draw(dev, cur.vars, texW, texH, true, canvas.rtA, () => cur.processCustomShape());
          waves!.draw(dev, canvas.vb114, cur.vars, () => cur.processWaveform());
          waves!.drawMotionVectors(dev, canvas.vb108, cur.vars);
        });
      },
      settings,
    });
    canvas.message('Show Preset Name: Off');   // 0x1001623f: the creation applies the ini's Show Preset Name (0) with its announcement
    return eng;
  }

  render(level: TimedLevel): Surface | null {
    this.tick = this.now();
    if (!this.eng) this.eng = this.build();
    this.frames++;
    return this.eng.render(level) ? this.frame() : null;   // silence: the DLL draws nothing
  }

  /** the back buffer as presented, as 0x00RRGGBB, when the device is the reference rasterizer */
  private frame(): Surface | null {
    if (!(this.dev instanceof RefDevice)) return null;
    const bb = this.dev.getBackBuffer(), w = bb.width, h = bb.height;
    if (!this.out || this.out.w !== w || this.out.h !== h) this.out = { w, h, px: new Uint32Array(w * h) };
    const l = bb.lockRect(null, 0x10), px = this.out.px;
    const src = new Uint32Array(l.data.buffer, l.data.byteOffset, (l.pitch >> 2) * h);
    for (let y = 0; y < h; y++) {
      const s = y * (l.pitch >> 2), d = y * w;
      for (let x = 0; x < w; x++) px[d + x] = src[s + x] & 0xffffff;
    }
    bb.unlockRect();
    return this.out;
  }

  debug(): Record<string, unknown> {
    const e = this.eng;
    return { engine: 'TwistedPixel', size: this.w + 'x' + this.h, frames: this.frames,
      preset: e ? e.curName : '', fading: e ? e.fading : false, fps: e ? e.fps : 0,
      waveMode: e ? e.cur.vars[V.nWaveMode] : 0 };
  }
}

A.TwistedPixel = TwistedPixel;
export { TwistedPixel };
