// Alchemy.Gigertron: "Gigertron 3D" from the Psychedelia Viz Pack (ThreeDBars.dll, Windows Media Player 11): the
// spectrum as a field of 3D bars, added onto the frame. Of its ten presets three are here: Cubetro (the current
// spectrum alone, over a cleared frame), Syntax and Northern (the spectrum spinning slowly around the view axis, never
// cleared, so it leaves glowing trails; Northern reads the bands in reverse). The DLL's seven other presets draw the
// whole history as fifty rings (Guybrush, Polaris, Beausoleil, Blacklight, Arcadia, Etherium, Dragons): the scene ports
// them, but the original crashes the reference device on every one, so there is nothing to check them against and they
// stay out of the menu.
//
// Wiring: the DLL draws with Direct3D 9 into its own device on WMP's window; the port's back buffer is the canvas.
// Blit 1:1, nearest. It reads TimedLevel.freq[0] (every 20th byte from 10). rand() is the CRT LCG, seeded by
// srand(time(NULL)) in Create (seed()): it fills the first heights and the bars' first colours. The frame time (16 ms a
// frame here) nudges the bars' width on the first frames. It draws fixed-function (no shaders), additively, through
// ../../d3d9/ref.ts, the port of Microsoft's Direct3D 9 reference device; options.device swaps in another.
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import type { Buffer9, Device9, Texture9 } from '../../d3d9/api';
import { RefDevice9 } from '../../d3d9/ref';
import { lookAtRH, perspectiveFovRH } from '../d3dx9';
import { RING, Scene, VB_BYTES, indices, rotationYawPitchRoll } from './scene';

export interface GigertronOptions {
  /** a device factory; the default is the reference device */
  device?: (w: number, h: number) => Device9;
  /** the back buffer's bytes before the first frame (B G R X rows): Syntax and Northern never clear it */
  backBuffer?: Uint8Array;
}
export interface GigertronConfig {
  width?: number;
  height?: number;
  options?: GigertronOptions;
  preset?: number;
}

/** the menu: the presets the original runs on the reference device */
const PRESET_NAMES = ['Cubetro', 'Syntax', 'Northern'];
/** each menu preset's number in the DLL */
const DLL_PRESET = [0, 7, 8];
const A8R8G8B8 = 21, INDEX32 = 102, POOL_DEFAULT = 0, POOL_MANAGED = 1, POOL_SYSTEMMEM = 2, USAGE_AUTOGENMIPMAP = 0x400,
  USAGE_DYNAMIC = 0x200, USAGE_WRITEONLY = 8, LOCK_DISCARD = 0x2000, TRIANGLELIST = 4, FVF = 0x152;
/** z off, dither on, no specular, clockwise culling, no lighting */
const RS: [number, number][] = [[7, 0], [26, 1], [29, 0], [22, 2], [156, 0], [137, 0]];
/** linear filtering, clamped, on stages 0 and 1 */
const SS: [number, number][] = [[5, 2], [6, 2], [7, 2], [1, 3], [2, 3]];
/** stage 0 takes the vertex colour and alpha alone, stage 1 off */
const TSS: [number, number, number][] = [[0, 1, 2], [0, 2, 0], [0, 3, 2], [0, 4, 2], [0, 5, 0], [0, 24, 0], [1, 1, 1]];

/** the texture the DLL binds; its texels never reach the frame (stage 0 takes the vertex colour and alpha alone), so
 *  the port binds our own: a soft grey weave */
function weave(): Uint8Array {
  const b = new Uint8Array(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = 96 + ((x ^ y) & 63), o = (y * 256 + x) * 4;
    b[o] = b[o + 1] = b[o + 2] = v; b[o + 3] = 255;
  }
  return b;
}

class Gigertron {
  declare dev: Device9 | null;
  declare scene: Scene;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: GigertronOptions;
  declare seedVal: number;
  declare out: Surface;
  declare clears: number;
  declare r: { tex: Texture9; vb: Buffer9; ib: Buffer9 } | null;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: GigertronConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    this.seedVal = (Date.now() / 1000) | 0;
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.w = Math.max(1, (cfg.width || 640) | 0);
    this.h = Math.max(1, (cfg.height || 480) | 0);
    this.preset = 0; this.setPreset(cfg.preset || 0);
    this.dev = null; this.r = null;
    this.frame = 0; this.clears = 0;
    this.scene = new Scene();
  }

  /** srand's seed (time(NULL) when WMP creates the plug-in) */
  seed(n: number): this { this.seedVal = n | 0; return this; }

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

  /** the device, then FUN_0f301210: the texture (filled through a SYSTEMMEM copy), the vertex and index buffers */
  private createDevice(): void {
    const o = this.options, w = this.w, h = this.h;
    const dev = this.dev = o.device ? o.device(w, h) : new RefDevice9(w, h);
    const bgra = weave();
    const tex = dev.createTexture(256, 256, 0, USAGE_AUTOGENMIPMAP, A8R8G8B8, POOL_DEFAULT);
    const sys = dev.createTexture(256, 256, 1, USAGE_DYNAMIC, A8R8G8B8, POOL_SYSTEMMEM);
    const ss = sys.getSurfaceLevel(0), l = ss.lockRect(null, LOCK_DISCARD);
    for (let y = 0; y < 256; y++) l.data.set(bgra.subarray(y * 1024, y * 1024 + 1024), y * l.pitch);
    ss.unlockRect();
    dev.updateSurface(ss, null, tex.getSurfaceLevel(0), null);
    const vb = dev.createVertexBuffer(VB_BYTES, USAGE_WRITEONLY, FVF, POOL_MANAGED);
    const ixs = indices();
    const ib = dev.createIndexBuffer(ixs.length, USAGE_WRITEONLY, INDEX32, POOL_MANAGED);
    vb.lock(0, VB_BYTES, 0).set(this.scene.vb);
    vb.unlock();
    ib.lock(0, ixs.length, 0).set(ixs);
    ib.unlock();
    this.r = { tex, vb, ib };
    if (o.backBuffer) {
      const rt = dev.getBackBuffer().lockRect(null, 0);
      for (let y = 0; y < h; y++) rt.data.set(o.backBuffer.subarray(y * w * 4, (y + 1) * w * 4), y * rt.pitch);
      dev.getBackBuffer().unlockRect();
    }
  }

  render(level: TimedLevel | null): Surface | null {
    if (!this.dev) {
      this.scene.init(DLL_PRESET[this.preset], this.seedVal);
      this.createDevice();
    }
    const dev = this.dev as Device9, r = this.r as NonNullable<Gigertron['r']>;
    const freq = level ? level.freq[0] : new Uint8Array(1024);
    const n = this.scene.step(DLL_PRESET[this.preset], freq, this.frame * 16, this.w, this.h);
    this.frame++;
    r.vb.lock(0, n, 0).set(this.scene.vb.subarray(0, n));
    r.vb.unlock();
    const d = this.draw(dev);
    if (this.out.w !== this.w || this.out.h !== this.h) this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    const out = this.out.px;
    for (let i = 0; i < out.length; i++) out[i] = (d[i * 4 + 2] << 16) | (d[i * 4 + 1] << 8) | d[i * 4];
    return this.out;
  }

  /** FUN_0f303ff0: the states; a clear (Syntax and Northern only every 402nd frame); the camera; then the first ring
   *  turned by the roll, or each of the fifty turned by its own place */
  private draw(dev: Device9): Uint8Array {
    const sc = this.scene, r = this.r as NonNullable<Gigertron['r']>;
    for (const [s, v] of RS) dev.setRenderState(s, v);
    for (let st = 0; st < 2; st++) for (const [s, v] of SS) dev.setSamplerState(st, s, v);
    const p = DLL_PRESET[this.preset], old = this.clears;
    if ((p !== 7 && p !== 8) || (this.clears = old + 1, old > 400)) {
      dev.clear(null, 3, 0, 1, 0);
      this.clears = 0;
    }
    dev.beginScene();
    dev.setTransform(3, perspectiveFovRH(new Float32Array(16), sc.fov, sc.aspect, 1, 1500));
    dev.setTransform(2, lookAtRH(new Float32Array(16), sc.eye, sc.at, sc.up));
    dev.setTexture(0, r.tex);
    dev.setTexture(1, null);
    dev.setRenderState(27, 1); dev.setRenderState(19, 2); dev.setRenderState(20, 2);
    for (const [st, s, v] of TSS) dev.setTextureStageState(st, s, v);
    dev.setFVF(FVF);
    const m = new Float32Array(16);
    const rings = sc.rings ? 50 : 1;
    for (let k = 0; k < rings; k++) {
      const [yaw, pitch, roll] = sc.rings ? sc.ringAngles(p, k) : [sc.yaw, sc.pitch, sc.roll];
      dev.setTransform(256, rotationYawPitchRoll(m, yaw, pitch, roll));
      dev.setIndices(r.ib);
      dev.setStreamSource(0, r.vb, 0, 36);
      // ponytail: the DLL passes MinVertexIndex = StartIndex here (1800 k), below the ring's vertices, which crashes
      // the reference device; a hardware device takes it as a hint, so the right range (ring k's 1200) stands in
      dev.drawIndexedPrimitive(TRIANGLELIST, 0, k * RING, RING, k * 1800, 600);
    }
    dev.endScene();
    return dev.present();
  }

  debug(): Record<string, unknown> {
    const sc = this.scene;
    return { engine: 'Gigertron', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, row: sc.row, width: sc.width, roll: sc.roll };
  }
}

declare module '../../ns' {
  interface AlchemyNS {
    Gigertron: typeof Gigertron;
  }
}

A.Gigertron = Gigertron;
export { Gigertron };
