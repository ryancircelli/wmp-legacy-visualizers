// Alchemy.Ribbons: "Ribbons" from the Psychedelia Viz Pack (RibbonsVis.dll, 2007; Windows Media Player 11): glowing
// ribbons trail through 3D noise past a wandering camera, each stepped by one frequency band, the camera's walk by the
// level and reversed on beats; the frame fades into the next through a blur. Six presets: Random (one of the others,
// picked per song), Mystify (one wide ribbon), Ribbons (30), Dense (250 thin ones), Embossed (30) and More Embossed
// (250), the last two shown through an emboss filter.
//
// Wiring: the DLL draws with Direct3D 9 into its own device on WMP's window, the back buffer the size of the desktop
// mode, presented stretched; the port's back buffer is the canvas (the projection's aspect is the client rectangle's,
// as the DLL's). Blit 1:1, nearest. It reads TimedLevel.freq[0] (700 bytes for the beat and level, one byte per
// ribbon), no clock: one step per Render. rand() is the CRT LCG, seeded by srand(time(NULL)) in the constructor and
// again in IWMPEffects2::Create (both see the same second: seed()). It draws through ../../d3d9/ref.ts, the port of
// Microsoft's Direct3D 9 reference device; options.device swaps in another (the A/B's recorder).
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import '../../rand';
import type { Device9, Texture9, Buffer9 } from '../../d3d9/api';
import { RefDevice9 } from '../../d3d9/ref';
import { f, identity, lookAtRH, perspectiveFovRH } from '../d3dx9';
import { MAX, Scene, pick } from './scene';
import { BLUR_PS, COPY_PS, COPY_VS, EMBOSS_PS } from './shaders';
import * as art from './art';

export interface RibbonsOptions {
  /** a device factory; the default is the reference device */
  device?: (w: number, h: number) => Device9;
  /** the ribbon texture, 128 x 128 BGRA; the default is our own (art.ts) */
  texture?: () => Uint8Array;
  /** the noise's 256-entry permutation; the default is our own (art.ts) */
  perm?: () => Int32Array;
}
export interface RibbonsConfig {
  width?: number;
  height?: number;
  options?: RibbonsOptions;
  preset?: number;
}

const PRESET_NAMES = ['Random', 'Mystify', 'Ribbons', 'Dense', 'Embossed', 'More Embossed'];

// D3D9 values the DLL and its effects use
const A8R8G8B8 = 21, POOL_DEFAULT = 0, POOL_MANAGED = 1, POOL_SYSTEMMEM = 2, USAGE_RENDERTARGET = 1, USAGE_AUTOGENMIPMAP = 0x400,
  USAGE_DYNAMIC = 0x200, USAGE_WRITEONLY = 8, LOCK_DISCARD = 0x2000, TRIANGLESTRIP = 5, TRIANGLEFAN = 6, FVF = 0x142;
/** the effects' pass states: no alpha test, no blending, no culling, lighting and z off */
const PASS_RS: [number, number][] = [[24, 1], [15, 0], [25, 7], [27, 0], [19, 7], [20, 2], [22, 1], [137, 0], [7, 0], [23, 2], [14, 0]];
/** FUN_0f303c50's states for a ribbon: the same, but added to the target (ONE, ONE) */
const RIBBON_RS: [number, number][] = [[24, 1], [15, 0], [25, 7], [27, 1], [19, 2], [20, 2], [22, 1], [137, 0], [7, 0], [23, 2], [14, 0]];
/** colour = texture * diffuse, alpha = diffuse */
const RIBBON_TSS: [number, number][] = [[1, 4], [2, 2], [3, 0], [4, 3], [5, 2], [6, 0]];
/** the quads' declaration: POSITIONT float4, TEXCOORD0 float2, TEXCOORD1 float2 */
const DECL = new Uint8Array([0, 0, 0, 0, 3, 0, 9, 0, 0, 0, 16, 0, 1, 0, 5, 0, 0, 0, 24, 0, 1, 0, 5, 1, 0xff, 0, 0, 0, 17, 0, 0, 0]);

class Ribbons {
  declare dev: Device9 | null;
  declare scene: Scene;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: RibbonsOptions;
  declare seedVal: number;
  declare out: Surface;
  declare r: {
    tex: Texture9; vbs: Buffer9[]; rtA: Texture9; rtB: Texture9; quad: Buffer9; half: Buffer9;
    decl: number; copyVs: number; copy: number; emboss: number; blur: number;
  } | null;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: RibbonsConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    this.seedVal = (Date.now() / 1000) | 0;
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.w = Math.max(1, (cfg.width || 640) | 0);
    this.h = Math.max(1, (cfg.height || 480) | 0);
    this.preset = cfg.preset ? cfg.preset | 0 : 0;
    this.dev = null; this.r = null;
    this.frame = 0;
    this.scene = new Scene(this.options.perm ? this.options.perm() : art.perm());
  }

  /** srand's seed (time(NULL) when WMP creates the plug-in) */
  seed(n: number): this { this.seedVal = n | 0; return this; }

  /** a new song (IWMPEffects::MediaInfo 0x0f304c10): Random picks again, something else */
  mediaInfo(): void {
    if (this.preset !== 0) return;
    const old = this.scene.mode;
    do this.scene.mode = pick(); while (this.scene.mode === old);
  }

  resize(w: number, h: number): void {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    if (this.dev) this.createDevice();
  }

  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= PRESET_NAMES.length) return false;
    this.preset = n;
    return true;
  }

  /** a screen quad of pre-transformed vertices over a w x h target */
  private quad(dev: Device9, w: number, h: number): Buffer9 {
    const vb = dev.createVertexBuffer(128, USAGE_WRITEONLY, 0x104, POOL_MANAGED);
    const x = w - 0.5, y = h - 0.5;
    vb.lock(0, 128, 0).set(new Uint8Array(Float32Array.of(
      -0.5, -0.5, 1, 1, 0, 0, 0, 0, x, -0.5, 1, 1, 1, 0, 0, 0, x, y, 1, 1, 1, 1, 0, 0, -0.5, y, 1, 1, 0, 1, 0, 0).buffer));
    vb.unlock();
    return vb;
  }

  /** IWMPEffects2::Create (0x0f305f60): the device, then FUN_0f304690: the ribbon texture (FUN_0f302840: a 128 x 128
   *  texture with autogenerated mipmaps, filled through a SYSTEMMEM copy), a vertex buffer per ribbon, the effects,
   *  the render targets (the frame, and half its size for the blur) */
  private createDevice(): void {
    const o = this.options, w = this.w, h = this.h;
    const dev = this.dev = o.device ? o.device(w, h) : new RefDevice9(w, h);
    const tex = dev.createTexture(128, 128, 0, USAGE_AUTOGENMIPMAP, A8R8G8B8, POOL_DEFAULT);
    const sys = dev.createTexture(128, 128, 1, USAGE_DYNAMIC, A8R8G8B8, POOL_SYSTEMMEM);
    const ss = sys.getSurfaceLevel(0), l = ss.lockRect(null, LOCK_DISCARD), px = o.texture ? o.texture() : art.glow();
    for (let y = 0; y < 128; y++) l.data.set(px.subarray(y * 512, y * 512 + 512), y * l.pitch);
    ss.unlockRect();
    dev.updateSurface(ss, null, tex.getSurfaceLevel(0), null);
    const vbs: Buffer9[] = [];
    for (let i = 0; i < MAX; i++) {
      const vb = dev.createVertexBuffer(0x990, USAGE_WRITEONLY, FVF, POOL_MANAGED);
      vb.lock(0, 0x990, 0).set(new Uint8Array(this.scene.ribbons[i].vb.buffer));
      vb.unlock();
      vbs.push(vb);
    }
    const hw = w >> 1, hh = h >> 1;
    this.r = {
      tex, vbs, quad: this.quad(dev, w, h), half: this.quad(dev, hw, hh),
      rtA: dev.createTexture(w, h, 1, USAGE_RENDERTARGET, A8R8G8B8, POOL_DEFAULT),
      rtB: dev.createTexture(hw, hh, 1, USAGE_RENDERTARGET, A8R8G8B8, POOL_DEFAULT),
      decl: dev.createVertexDeclaration(DECL), copyVs: dev.createVertexShader(COPY_VS), copy: dev.createPixelShader(COPY_PS),
      emboss: dev.createPixelShader(EMBOSS_PS), blur: dev.createPixelShader(BLUR_PS),
    };
  }

  render(level: TimedLevel | null): Surface | null {
    if (!this.dev) {
      A.srand(this.seedVal);
      this.scene.construct();
      A.srand(this.seedVal);
      this.scene.init();
      this.createDevice();
    }
    const freq = level ? level.freq[0] : new Uint8Array(1024);
    this.scene.step(this.preset, freq, this.w, this.h);
    this.frame++;
    const d = this.draw(this.dev as Device9);
    if (this.out.w !== this.w || this.out.h !== this.h) this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    const out = this.out.px;
    for (let i = 0; i < out.length; i++) out[i] = (d[i * 4 + 2] << 16) | (d[i * 4 + 1] << 8) | d[i * 4];
    return this.out;
  }

  /** one effect pass (FUN_0f302060 and its siblings): the quad, the technique's states, then End restores the shaders
   *  its Begin saved (every other state it touches the next draw sets again) */
  private pass(dev: Device9, quad: Buffer9, vs: number, ps: number, c: Float32Array, src: Texture9, clamp: boolean): void {
    const r = this.r as NonNullable<Ribbons['r']>;
    dev.setStreamSource(0, quad, 0, 32);
    dev.setVertexDeclaration(r.decl);
    dev.setVertexShader(vs);
    dev.setPixelShader(ps);
    dev.setPixelShaderConstantF(0, c, c.length >> 2);
    dev.setTexture(0, src);
    if (clamp) { dev.setSamplerState(0, 1, 3); dev.setSamplerState(0, 2, 3); }
    dev.setSamplerState(0, 7, 2); dev.setSamplerState(0, 6, 2); dev.setSamplerState(0, 5, 2);
    for (const [s, v] of PASS_RS) dev.setRenderState(s, v);
    dev.drawPrimitive(TRIANGLEFAN, 0, 2);
    dev.setVertexShader(0);
    dev.setPixelShader(0);
  }

  /** texel offsets for a w x h source (the effects' FUN_0f302b00) */
  private static offsets(pts: number[], w: number, h: number): Float32Array {
    const c = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i += 2) { c[i * 2] = f(pts[i] / w); c[i * 2 + 1] = f(pts[i + 1] / h); }
    return c;
  }

  /** FUN_0f305860: the last frame (blurred, halved) faded into the frame target, the ribbons added on it, the result
   *  blurred for the next frame and shown (copied, or embossed) */
  private draw(dev: Device9): Uint8Array {
    const sc = this.scene, r = this.r as NonNullable<Ribbons['r']>, w = this.w, h = this.h;
    dev.clear(null, 3, 0xff000000, 1, 0);
    dev.beginScene();
    dev.setTransform(3, perspectiveFovRH(new Float32Array(16), sc.fov, sc.aspect, f(0.1), 300));
    dev.setTransform(256, identity(new Float32Array(16)));
    dev.setRenderTarget(0, r.rtA.getSurfaceLevel(0));
    this.pass(dev, r.quad, r.copyVs, r.copy, Float32Array.of(f(0.97), 0, 0, 0), r.rtB, false);
    dev.setTransform(2, lookAtRH(new Float32Array(16), sc.eye, sc.at, sc.up));
    for (let i = 0; i < sc.count; i++) {
      const vb = r.vbs[i];
      vb.lock(0, 0x990, 0).set(new Uint8Array(sc.ribbons[i].vb.buffer));
      vb.unlock();
      for (const [t, v] of RIBBON_TSS) dev.setTextureStageState(0, t, v);
      for (const [s, v] of RIBBON_RS) dev.setRenderState(s, v);
      dev.setSamplerState(0, 6, 2); dev.setSamplerState(0, 5, 2); dev.setSamplerState(0, 7, 2);
      dev.setSamplerState(0, 1, 3); dev.setSamplerState(0, 2, 3);
      dev.setTexture(0, r.tex);
      dev.setVertexShader(0);
      dev.setFVF(FVF);
      dev.setStreamSource(0, vb, 0, 24);
      dev.drawPrimitive(TRIANGLESTRIP, 0, 100);
    }
    dev.setRenderTarget(0, r.rtB.getSurfaceLevel(0));
    this.pass(dev, r.half, 0, r.blur, Ribbons.offsets([-1, -1, 1, -1, 1, 1, -1, 1], w, h), r.rtA, true);
    dev.setRenderTarget(0, dev.getBackBuffer());
    if (sc.emboss) this.pass(dev, r.quad, 0, r.emboss, Ribbons.offsets([-0.5, -0.5, 0.5, 0.5], w, h), r.rtA, true);
    else this.pass(dev, r.quad, r.copyVs, r.copy, Float32Array.of(1, 0, 0, 0), r.rtA, false);
    dev.endScene();
    return dev.present();
  }

  debug(): Record<string, unknown> {
    return { engine: 'Ribbons', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, mode: this.scene.mode, ribbons: this.scene.count, emboss: this.scene.emboss };
  }
}

declare module '../../ns' {
  interface AlchemyNS {
    Ribbons: typeof Ribbons;
  }
}

A.Ribbons = Ribbons;
export { Ribbons };
