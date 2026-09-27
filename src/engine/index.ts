// Public surface of the visualizer engines (ARCHITECTURE.md "Engine"). Everything outside src/engine
// imports from here (or from ./audio/*). The engines themselves are the wrapped DLL ports; this file
// only adds what the old shell (src/90-shell.js) did around them: engine choice, the native-size and
// scale rules, the 0x00RRGGBB -> RGBA blit, and presenting onto a canvas.
import { A, type Surface, type TimedLevel } from './ns';
import './rand';
import './effect';
import './kernels';
import './shift';
import './draw';
import './alchemy';
import './bars';
import './battery/index';

export { A };
export type { Surface, TimedLevel };

export type VisKind = 'alchemy' | 'bars' | 'battery';
/** 'original' = each DLL's own surface size; 'auto' = the view, capped near 720p worth of pixels; n = view * n. */
export type Scale = 'original' | 'auto' | number;

/** Read every frame; mutate `engine.options.*` to change them live (as the shell did). */
export interface EngineOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
}

export interface CreateEngineOptions {
  preset?: number;
  scale?: Scale;
  options?: Partial<EngineOptions>;
}

export interface PresetEntry {
  vis: VisKind;
  preset: number;
  group: 'Alchemy' | 'Bars and Waves' | 'Battery';
  name: string;
}

/** The visualizer's own methods (Alchemy.Engine / Alchemy.Bars / Alchemy.Battery), as the shell used them. */
interface RawEngine {
  options: EngineOptions;
  preset?: number;
  render(level: TimedLevel): Surface | null;
  resize(w: number, h: number): void;
  setPreset?(n: number): void;
  seed(n: number): unknown;
  debug(): Record<string, unknown>;
}

export interface VisEngine {
  readonly kind: VisKind;
  /** Current preset (always 0 for Alchemy) and its menu name. */
  readonly preset: number;
  readonly presetName: string;
  readonly options: EngineOptions;
  /** The engine surface size (what `render` returns), after the scale rule. */
  readonly width: number;
  readonly height: number;
  /** One WMP Render() call. Does not paint; call present() after the last render of a frame. */
  render(level: TimedLevel): Surface | null;
  /** Paint the last rendered surface onto the canvas, stretched to the canvas size. */
  present(): void;
  /** Re-fit to the view: sets the canvas backing size (default: its client size) and re-sizes the engine if needed. */
  resize(viewWidth?: number, viewHeight?: number): void;
  setScale(scale: Scale): void;
  /** Same visualizer, other preset (keeps its state, like the shell's setVis with an unchanged vis). */
  setPreset(n: number): void;
  seed(n: number): void;
  debug(): Record<string, unknown>;
}

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

export const PRESETS: readonly PresetEntry[] = [
  { vis: 'alchemy', preset: 0, group: 'Alchemy', name: 'Random' },
  ...A.Bars.PRESET_NAMES.map((name, preset): PresetEntry => ({ vis: 'bars', preset, group: 'Bars and Waves', name })),
  ...A.Battery.PRESET_NAMES.map((name, preset): PresetEntry => ({ vis: 'battery', preset, group: 'Battery', name })),
];

export function presetMax(kind: VisKind): number {
  return kind === 'battery' ? A.Battery.PRESET_NAMES.length - 1 : kind === 'bars' ? A.Bars.PRESET_NAMES.length - 1 : 0;
}

/** Digital silence (wave bytes at 128, not -1 full scale), state 0, as the shell's makeLevel(). */
export function makeLevel(): TimedLevel {
  const l: TimedLevel = {
    freq: [new Uint8Array(1024), new Uint8Array(1024)],
    wave: [new Uint8Array(1024), new Uint8Array(1024)],
    state: 0,
    timeStamp: 0,
  };
  l.wave[0].fill(128);
  l.wave[1].fill(128);
  return l;
}

// 'original' = each DLL's native surface: Alchemy's hard-coded 640x480 GDI surface, StretchBlt'd
// (HALFTONE) to the window (spec 07); Bars and Waves has no internal surface at all — it draws
// straight into a DIB the size of the window client area (spec/wmp §2.6), capped at 1920x1080;
// Battery renders 384x288 8-bit and StretchBlt's it with STRETCH_DELETESCANS — nearest neighbour,
// whole RECT, no aspect correction (spec 10 §2.3), which is why smoothing is off for it.
export function nativeSize(kind: VisKind, viewW: number, viewH: number): [number, number] {
  if (kind === 'bars') return [Math.min(1920, viewW), Math.min(1080, viewH)];
  return kind === 'battery' ? [384, 288] : [640, 480];
}

/** 'auto' = full size up to ~720p worth of pixels (engine measured 8 ms/frame there, 20 ms at 1080p). */
export function effectiveScale(scale: Exclude<Scale, 'original'>, viewW: number, viewH: number): number {
  return scale === 'auto' ? Math.min(1, Math.sqrt((1280 * 720) / (viewW * viewH))) : scale;
}

// 0x00RRGGBB (as the DLL stores it) -> canvas RGBA, via a Uint32 view.
const LITTLE_ENDIAN = (function () {
  const b = new ArrayBuffer(4);
  new Uint32Array(b)[0] = 1;
  return new Uint8Array(b)[0] === 1;
})();

export function blit(px: Uint32Array, out32: Uint32Array): void {
  let i, p;
  const n = px.length;
  if (LITTLE_ENDIAN) {
    // bytes in memory are R,G,B,A -> u32 = A<<24 | B<<16 | G<<8 | R
    for (i = 0; i < n; i++) {
      p = px[i];
      out32[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
    }
  } else {
    for (i = 0; i < n; i++) out32[i] = (px[i] << 8) | 0xff;
  }
}

type RawCtor = new (cfg: { width: number; height: number; options: EngineOptions; preset?: number }) => RawEngine;

function makeRaw(kind: VisKind, preset: number, options: EngineOptions): RawEngine {
  if (kind === 'bars') return new (A.Bars as unknown as RawCtor)({ width: 16, height: 16, options, preset });
  if (kind === 'battery') return new (A.Battery as unknown as RawCtor)({ width: 384, height: 288, options, preset });
  return new (A.Engine as unknown as RawCtor)({ width: 16, height: 16, options });
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeBuffer(): { canvas: CanvasLike; ctx: Ctx2D | null } {
  const canvas: CanvasLike =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d') };
}

/**
 * A visualizer bound to a canvas. The canvas shows the engine surface stretched to its backing size;
 * `resize()` sets that backing size from the view (clientWidth/clientHeight by default).
 */
export function createEngine(kind: VisKind, canvas: CanvasLike, opts: CreateEngineOptions = {}): VisEngine {
  const options: EngineOptions = { intended: false, fps: 60, backgroundColor: 0x000000, ...opts.options };
  const max = presetMax(kind);
  const clampPreset = (n: number) => Math.min(max, Math.max(0, n | 0));
  const raw = makeRaw(kind, clampPreset(opts.preset ?? 0), options);
  let scale: Scale = opts.scale ?? 'original';
  const view = canvas.getContext('2d');
  const buf = makeBuffer();
  let img: ImageData | null = null, img32: Uint32Array | null = null;
  let bw = 0, bh = 0, last: Surface | null = null;

  const eng: VisEngine = {
    kind,
    get preset() {
      return raw.preset ?? 0;
    },
    get presetName() {
      const p = raw.preset ?? 0;
      return PRESETS.find((e) => e.vis === kind && e.preset === p)?.name ?? '';
    },
    options: raw.options,
    get width() {
      return bw;
    },
    get height() {
      return bh;
    },
    render(level) {
      return (last = raw.render(level));
    },
    present() {
      const s = last;
      if (!s || s.w !== bw || s.h !== bh || !img || !img32 || !buf.ctx || !view) return;
      blit(s.px, img32);
      buf.ctx.putImageData(img, 0, 0);
      view.drawImage(buf.canvas, 0, 0, canvas.width, canvas.height);
    },
    resize(viewWidth, viewHeight) {
      const el = canvas as Partial<HTMLCanvasElement>;
      const vw = Math.max(16, viewWidth ?? (el.clientWidth || canvas.width));
      const vh = Math.max(16, viewHeight ?? (el.clientHeight || canvas.height));
      canvas.width = vw;
      canvas.height = vh;
      if (view) {
        // Battery's blit is STRETCH_DELETESCANS (nearest neighbour); Alchemy's is HALFTONE.
        view.imageSmoothingEnabled = kind !== 'battery';
        view.imageSmoothingQuality = 'high';
      }
      const orig = scale === 'original' ? nativeSize(kind, vw, vh) : null;
      const s = scale === 'original' ? 1 : effectiveScale(scale, vw, vh);
      const w = orig ? orig[0] : Math.max(16, Math.round(vw * s));
      const h = orig ? orig[1] : Math.max(16, Math.round(vh * s));
      if (w === bw && h === bh) return;
      bw = w;
      bh = h;
      buf.canvas.width = w;
      buf.canvas.height = h;
      img = buf.ctx ? buf.ctx.createImageData(w, h) : null;
      img32 = img ? new Uint32Array(img.data.buffer) : null;
      raw.resize(w, h);
    },
    setScale(s) {
      scale = s;
      eng.resize(canvas.width, canvas.height);
    },
    setPreset(n) {
      if (raw.setPreset) raw.setPreset(clampPreset(n));
    },
    seed(n) {
      raw.seed(n);
    },
    debug() {
      return raw.debug();
    },
  };
  eng.resize();
  return eng;
}
