// Alchemy.Alchemy3D — "3D Alchemy" (mpvis3d.dll, CLSID D00D3D66-808B-4127-8635-1229AC08CC6C, Effects key
// "3D-Alchemy"), from the Windows XP Creativity Fun Pack for Windows Media Player 9 Series (2003). Ported from
// its 9.00.00.2980 build (x86, 2003-02-10, image base 0x00400000).
//
// What it is: WMP 9's Alchemy, unchanged, drawing into Direct3D textures instead of a GDI surface, and a
// Direct3D 8 scene per preset that shows that texture: on a flat panel (Classic), a mirrored tiling
// (Kaleidoscope), turning slabs over a starfield (Monoliths), two planets (Strange world), a gallery room
// (WM Museum) and a hidden sixth scene WMP never lists (Draco's room). In a window WMP gives it (IWMPEffects2::
// Create, then RenderWindowed every frame) it always takes the Direct3D path on a CPU with SSE.
//
// Per frame (0x0040bcf7): the 2D engine renders into the texture (A.Engine as WMP 9's: preset 1 of alchemy.ts,
// which matches this DLL frame for frame), then the scene draws (0x00412b65: Clear, UpdateTexture, BeginScene,
// the scene, EndScene, Present). The texture is square: 512 in a window over 240000 pixels (Classic only), 256
// over 153600, else 128 (0x0040b887). The scene's clock is the DLL's DXUtil timer on QueryPerformanceCounter;
// here a counter of 10^7 per second that advances 1/60 s a frame unless options.clock gives another.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';
import '../alchemy';
import { Device, D3D, Texture } from './device';
import { Scene, Timer, PRESET_NAMES, type PresetCtx } from './scene';
import { resourceTexture } from './textures';

declare module '../ns' {
  interface AlchemyNS {
    Alchemy3D: typeof Alchemy3D;
  }
}

export interface Alchemy3DOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
  /** the scene clock in 10^7 counts per second (QueryPerformanceCounter's role); default: 10^12 + frame * 10^7/60 */
  clock?: (() => number) | null;
}

export interface Alchemy3DConfig {
  width?: number;
  height?: number;
  options?: Partial<Alchemy3DOptions>;
  preset?: number;
}

/** the texture size code 0x0040b887 picks: 128 under 153600 window pixels, 512 over 240000 unless the preset
 *  asks for less (its +0x9c above 1: every preset but Classic), else 256 */
export function textureSize(w: number, h: number, hint: number): number {
  const area = w * h;
  if (hint <= 1 && area > 240000) return 512;
  return area < 153600 ? 128 : 256;
}

interface SurfTex { sys: Texture; gpu: Texture }

class Alchemy3D {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  declare options: Alchemy3DOptions;
  declare preset: number;
  declare w: number;
  declare h: number;
  declare texSize: number;
  declare engine: InstanceType<typeof A.Engine>;
  declare dev: Device;
  declare scene: Scene;
  declare timer: Timer;
  /** render() calls so far, and the one in progress: the default clock's frame */
  declare frame: number;
  declare cur: number;
  declare out: Surface;
  declare last: Surface;
  declare tex: Map<Surface, SurfTex>;
  declare resTex: Map<string, Texture | null>;

  constructor(cfg?: Alchemy3DConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000, clock: null }, cfg.options);
    this.frame = 0; this.cur = 0;
    this.w = Math.max(16, cfg.width || 640) | 0;
    this.h = Math.max(16, cfg.height || 480) | 0;
    this.preset = Math.min(PRESET_NAMES.length - 1, Math.max(0, (cfg.preset ?? 0) | 0));
    this.timer = new Timer(1e7, () => (this.options.clock ? this.options.clock() : 1e12 + Math.floor(this.cur * 1e7 / 60)));
    this.resTex = new Map();
    // CreateInstance: the 2D engine (its pool drawn from the CRT's start-of-process rand state, then
    // srand(time)) as WMP 9's mpvis builds it
    this.engine = new A.Engine({ width: 16, height: 16, options: this.options, preset: 1 });
    this.allocate();
  }

  /** IWMPEffects2::Create / a new device (0x0040b887): the scene with its preset, the texture size, the
   *  textures (black), the 2D engine resized onto them */
  allocate(): void {
    // the device and its state go with the window; the scene object (its camera and light) is made once
    // (0x0040b887: new only while +0x414 is empty), its preset made again (0x00416445)
    if (!this.dev || this.dev.target.w !== this.w || this.dev.target.h !== this.h) this.dev = new Device(this.w, this.h);
    if (!this.scene) this.scene = new Scene(this.timer);
    this.scene.preset = -1;
    this.scene.setPreset(this.preset);
    this.texSize = textureSize(this.w, this.h, this.scene.p ? this.scene.p.texHint : 0);
    this.tex = new Map();
    this.engine.resize(this.texSize, this.texSize);
    this.out = { w: this.w, h: this.h, px: this.dev.target.color };
    this.last = this.out;
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  resize(w: number, h: number): void {
    w = Math.max(16, w | 0); h = Math.max(16, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.allocate();
  }

  setPreset(n: number): boolean {
    if (!(n >= 0 && n < PRESET_NAMES.length) || (n | 0) !== n) return false;
    if (n === this.preset) return true;
    this.preset = n;
    this.allocate();
    return true;
  }

  /** the two textures of one of the 2D engine's surfaces: SYSTEMMEM (the surface's own pixels) and DEFAULT */
  private texOf(s: Surface): SurfTex {
    let t = this.tex.get(s);
    if (!t) {
      const sys = new Texture(s.w, s.h, D3D.X8R8G8B8, 1);
      sys.levels[0] = s.px;
      t = { sys, gpu: new Texture(s.w, s.h, D3D.X8R8G8B8, 1) };
      this.tex.set(s, t);
    }
    t.sys.levels[0] = s.px;
    return t;
  }

  private ctx(): PresetCtx {
    return {
      dev: this.dev, timer: this.timer, winW: this.w, winH: this.h, texW: this.texSize,
      texture: (id: number, size: number) => {
        const k = id + ':' + size;
        if (!this.resTex.has(k)) this.resTex.set(k, resourceTexture(id, size));
        return this.resTex.get(k) ?? null;
      },
    };
  }

  /** one RenderWindowed (0x0040b565): nothing at all while stopped or paused */
  render(L: TimedLevel): Surface | null {
    this.cur = this.frame++;
    if (!L || L.state === 0 || L.state === 1) return this.last;
    const s = this.engine.render(L) as Surface;
    const t = this.texOf(s), d = this.dev;
    d.clear(3, 0xff000000, 1, 0);
    d.updateTexture(t.sys, t.gpu);
    d.beginScene();
    this.scene.alchemyTex = t.gpu;
    this.scene.render(this.ctx(), Math.fround(this.w / this.h));
    d.endScene();
    d.present();
    return (this.last = this.out);
  }

  debug(): Record<string, unknown> {
    return { preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h, texture: this.texSize, frame: this.frame };
  }
}

A.Alchemy3D = Alchemy3D;
export { Alchemy3D };
