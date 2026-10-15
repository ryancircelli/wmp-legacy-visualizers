// Alchemy.Bubbles: "Bubbles" from the Psychedelia Viz Pack (Bubbles.dll, 2007, Tim Cowley and Stephen Coy; Windows
// Media Player 11), 42 glassy bubbles in a box, sized by the sound; the first shows the song's cover art. Four
// presets: Random (one of the others, picked per song), Centered (pulled to the middle, the cover bubble pulsing with
// the level), Gravity (falling, each bubble sized by one frequency band) and Pop (bubbles pop on beats).
//
// Wiring: the DLL draws with Direct3D 9 into its own device on WMP's window, the back buffer the size of the desktop
// mode, presented stretched; the port's back buffer is the canvas (the scene's aspect is the client rectangle's, as
// the DLL's). Blit 1:1, nearest. It reads TimedLevel.freq[0] (the first 50 bytes for the level, 700 for Pop's beats,
// one band per bubble for Gravity), no clock: one step per Render. rand() is the CRT LCG, seeded by
// srand(time(NULL)) when the device is created (seed()). It draws through ../../d3d9/ref.ts, the port of Microsoft's
// Direct3D 9 reference device; options.device swaps in another (the A/B's recorder).
import { A } from '../../ns';
import type { Surface, TimedLevel } from '../../ns';
import '../../rand';
import type { Picture } from '../../pictureviz/picture';
import type { Device9, Texture9, Buffer9 } from '../../d3d9/api';
import { RefDevice9 } from '../../d3d9/ref';
import { f, identity, lookAtRH, matMul, orthoRH } from '../d3dx9';
import { COUNT, Scene } from './scene';
import { PS_ALBUM, PS_SOLID, VS } from './shaders';
import * as art from './art';

export interface BubblesTextures {
  /** 256 x 256 BGRA each (see art.ts for what each one is) */
  diffuse: Uint8Array; fresnel: Uint8Array; specular: Uint8Array; album: Uint8Array;
}
export interface BubblesOptions {
  /** a device factory; the default is the reference device */
  device?: (w: number, h: number) => Device9;
  /** the textures; the default is our own artwork (art.ts) */
  textures?: () => BubblesTextures;
}
export interface BubblesConfig {
  width?: number;
  height?: number;
  options?: BubblesOptions;
  preset?: number;
}

const PRESET_NAMES = ['Random', 'Centered', 'Gravity', 'Pop'];

// D3D9 values the DLL and its effect use
const A8R8G8B8 = 21, POOL_DEFAULT = 0, POOL_MANAGED = 1, POOL_SYSTEMMEM = 2, USAGE_AUTOGENMIPMAP = 0x400,
  USAGE_DYNAMIC = 0x200, USAGE_WRITEONLY = 8, LOCK_DISCARD = 0x2000, TRIANGLEFAN = 6;
const RS: [number, number][] = [   // the techniques' pass states: AlphaRef 1, no alpha test, GreaterEqual, blend
  [24, 1], [15, 0], [25, 7], [27, 1], [19, 5], [20, 6], [22, 1], [137, 0], [7, 0], [23, 4], [14, 0]];
const DECL = new Uint8Array([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 12, 0, 1, 0, 5, 0, 0xff, 0, 0, 0, 17, 0, 0, 0]);
const QUAD = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, -1, 0, 1, 1]);

/** the cover art, resampled to the 256 x 256 texture (box filter over the source; ours: the DLL loads Folder.jpg
 *  through WIC, which a browser's decoder cannot reproduce anyway) */
function coverTexture(p: Picture): Uint8Array {
  const out = new Uint8Array(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    const y0 = Math.floor(y * p.h / 256), y1 = Math.max(y0 + 1, Math.floor((y + 1) * p.h / 256));
    for (let x = 0; x < 256; x++) {
      const x0 = Math.floor(x * p.w / 256), x1 = Math.max(x0 + 1, Math.floor((x + 1) * p.w / 256));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * p.w + xx) * 3; r += p.rgb[i]; g += p.rgb[i + 1]; b += p.rgb[i + 2]; n++;
      }
      const o = (y * 256 + x) * 4;
      out[o] = Math.round(b / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(r / n); out[o + 3] = 255;
    }
  }
  return out;
}

class Bubbles {
  declare dev: Device9 | null;
  declare scene: Scene;
  declare w: number;
  declare h: number;
  declare preset: number;
  declare frame: number;
  declare options: BubblesOptions;
  declare seedVal: number;
  declare out: Surface;
  declare tex: { diffuse: Texture9; fresnel: Texture9; specular: Texture9; album: Texture9 } | null;
  declare vb: Buffer9 | null;
  declare h9: { decl: number; vs: number; album: number; solid: number };
  declare cover: Picture | null;

  static PRESET_NAMES: string[] = PRESET_NAMES;

  constructor(cfg?: BubblesConfig) {
    cfg = cfg || {};
    this.options = Object.assign({}, cfg.options);
    this.seedVal = (Date.now() / 1000) | 0;
    this.out = { w: 0, h: 0, px: new Uint32Array(0) };
    this.w = Math.max(1, (cfg.width || 640) | 0);
    this.h = Math.max(1, (cfg.height || 480) | 0);
    this.preset = cfg.preset ? cfg.preset | 0 : 0;
    this.cover = null;
    this.dev = null; this.tex = null; this.vb = null;
    this.frame = 0;
    this.scene = new Scene();
  }

  /** srand's seed (the DLL seeds with time(NULL) in IWMPEffects2::Create, before its first frame) */
  seed(n: number): this { this.seedVal = n | 0; return this; }

  /** the song's cover art for the first bubble (null: our own picture), as WMP's NotifyNewMedia makes the DLL load
   *  the album's Folder.jpg */
  setPictures(p: Picture[]): void {
    this.cover = p.length ? p[0] : null;
    if (this.dev && this.tex) {
      this.tex.album = this.upload(this.dev, this.cover ? coverTexture(this.cover) : this.textures().album);
      this.mediaInfo();                 // a new song's art: WMP has called MediaInfo for it
    }
  }

  /** a new song (IWMPEffects::MediaInfo 0x0f3027c0): Random picks again */
  mediaInfo(): void { if (this.preset === 0) this.scene.mode = Scene.pick(); }

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

  private textures(): BubblesTextures {
    const t = this.options.textures;
    return t ? t() : { diffuse: art.diffuse(), fresnel: art.fresnel(), specular: art.specular(), album: art.album() };
  }

  /** FUN_0f3017b0 / FUN_0f3010a0: a 256 x 256 A8R8G8B8 texture with autogenerated mipmaps, filled through a
   *  SYSTEMMEM copy and UpdateSurface */
  private upload(dev: Device9, bgra: Uint8Array): Texture9 {
    const t = dev.createTexture(256, 256, 0, USAGE_AUTOGENMIPMAP, A8R8G8B8, POOL_DEFAULT);
    const s = dev.createTexture(256, 256, 1, USAGE_DYNAMIC, A8R8G8B8, POOL_SYSTEMMEM);
    const ss = s.getSurfaceLevel(0), l = ss.lockRect(null, LOCK_DISCARD);
    for (let y = 0; y < 256; y++) l.data.set(bgra.subarray(y * 1024, y * 1024 + 1024), y * l.pitch);
    ss.unlockRect();
    dev.updateSurface(ss, null, t.getSurfaceLevel(0), null);
    return t;
  }

  /** IWMPEffects2::Create (0x0f304df0) then FUN_0f3035e0 / FUN_0f3032d0: the device and its resources */
  private createDevice(): void {
    const o = this.options;
    const dev = this.dev = o.device ? o.device(this.w, this.h) : new RefDevice9(this.w, this.h);
    this.h9 = { album: dev.createPixelShader(PS_ALBUM), vs: dev.createVertexShader(VS), solid: dev.createPixelShader(PS_SOLID), decl: 0 };
    this.h9.decl = dev.createVertexDeclaration(DECL);
    const t = this.textures();
    const specular = this.upload(dev, t.specular), diffuse = this.upload(dev, t.diffuse), fresnel = this.upload(dev, t.fresnel);
    const album = this.upload(dev, this.cover ? coverTexture(this.cover) : t.album);
    this.tex = { diffuse, fresnel, specular, album };
    const vb = this.vb = dev.createVertexBuffer(80, USAGE_WRITEONLY, 0x102, POOL_MANAGED);
    vb.lock(0, 80, 0).set(new Uint8Array(QUAD.buffer));
    vb.unlock();
  }

  render(level: TimedLevel | null): Surface | null {
    if (!this.dev) {
      A.srand(this.seedVal);
      this.scene.init();
      this.createDevice();
    }
    const dev = this.dev as Device9, sc = this.scene;
    const freq = level ? level.freq[0] : new Uint8Array(1024);
    sc.step(this.preset, freq, this.w, this.h);
    this.frame++;
    this.draw(dev);
    const bb = dev.getBackBuffer(), l = bb.lockRect(null, 0x10);
    if (this.out.w !== this.w || this.out.h !== this.h) this.out = { w: this.w, h: this.h, px: new Uint32Array(this.w * this.h) };
    const px = this.out.px, d = l.data;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * l.pitch + x * 4;
      px[y * this.w + x] = (d[i + 2] << 16) | (d[i + 1] << 8) | d[i];
    }
    bb.unlockRect();
    return this.out;
  }

  /** FUN_0f303bf0: clear, the AlbumArt technique for bubble 0, Solid (Glass in Pop) for the rest, present */
  private draw(dev: Device9): void {
    const sc = this.scene, tex = this.tex as NonNullable<Bubbles['tex']>, h = this.h9;
    dev.clear(null, 3, 0xff000000, 1, 0);
    dev.beginScene();
    const proj = orthoRH(new Float32Array(16), f(sc.halfW * 2), f(sc.halfH * 2), 1, 100);
    const view = lookAtRH(new Float32Array(16), [0, 0, 50], [0, 0, 0], [0, 1, 0]);
    const wvp = matMul(new Float32Array(16), matMul(new Float32Array(16), identity(new Float32Array(16)), view), proj);
    const c = new Float32Array(28);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c[i * 4 + j] = wvp[j * 4 + i];
    dev.setStreamSource(0, this.vb, 0, 20);
    dev.setVertexDeclaration(h.decl);
    for (const [s, v] of RS) dev.setRenderState(s, v);
    dev.setVertexShader(h.vs);
    const glass = sc.mode === 3;
    const bind = (stages: Texture9[]): void => {
      stages.forEach((t, s) => {
        dev.setTexture(s, t);
        dev.setSamplerState(s, 1, 3); dev.setSamplerState(s, 2, 3);          // ADDRESSU/V = CLAMP
        dev.setSamplerState(s, 7, 2); dev.setSamplerState(s, 6, 2); dev.setSamplerState(s, 5, 2);   // MIP/MIN/MAG = LINEAR
      });
    };
    const one = (i: number): void => {
      c.fill(0, 16);
      c[16] = sc.drawRadius(i);
      c[20] = sc.col[i * 3]; c[21] = sc.col[i * 3 + 1]; c[22] = sc.col[i * 3 + 2];
      c[24] = sc.px[i]; c[25] = sc.py[i];
      dev.setVertexShaderConstantF(0, c, 7);
      dev.drawPrimitive(TRIANGLEFAN, 0, 2);
    };
    dev.setPixelShader(h.album);
    bind([tex.diffuse, tex.album, tex.specular]);
    one(0);
    dev.setTexture(2, null);            // the effect's End restores the state its Begin saved
    dev.setPixelShader(h.solid);
    bind([glass ? tex.fresnel : tex.diffuse, tex.specular]);
    for (let i = 1; i < COUNT; i++) one(i);
    dev.endScene();
    dev.present();
  }

  debug(): Record<string, unknown> {
    return { engine: 'Bubbles', preset: this.preset, presetName: PRESET_NAMES[this.preset], size: this.w + 'x' + this.h,
      frame: this.frame, mode: this.scene.mode, popping: this.scene.popping, cover: !!this.cover };
  }
}

declare module '../../ns' {
  interface AlchemyNS {
    Bubbles: typeof Bubbles;
  }
}

A.Bubbles = Bubbles;
export { Bubbles };
