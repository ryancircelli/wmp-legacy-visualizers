// Yule Log's scene: yule.dll's PRESET1 (vtable 0x100630d4: Init 0x10009e40, Animate 0x1000a310, Render 0x10009f20)
// and the CYule::Render around it (0x1000e060), issuing the Direct3D 8 calls the DLL issues.
// What it draws: a fireplace (four photographed walls on a box, iron grate, logs, embers) seen from a fixed
// camera, with four flames: each a textured quad whose texture is redrawn every frame on the CPU by warping a
// flame image through two scrolling turbulence maps (FLAME::Animate 0x100027e0). The music drives it through a
// small graph of nodes (0x1000bbe0): band energies of the spectrum set the flames' speed and height, the glow
// colour (vertex shader constant c21), and the logs' glow (TEXTUREFACTOR); a beat detector even zeroes the frame's
// time step on beats (the TEMPO node's quirk, 0x10001aa0).
import { A, type TimedLevel } from '../ns';
import { type Device, type Texture, type Buffer, type StateBlock, type VertexShader, Fmt, Lock, Pool, Prim, Rs, Tss } from '../d3d8/api';
import { inverse, lookAtRH, mat, multiply, perspectiveFovRH, rotationY, transpose, vec3Normalize, type Mat } from './math';
import { loadMesh, MatrixStack, textureFromPixels, type AttributeRange, type XMesh } from './d3dx';
import { assemble, DECLARATION, SHADERS } from './shaders';
import { FLAMES, TEXTURE_NAMES, TURBULENCE_NAMES, type Image, type XFrame, type YuleAssets } from './assets';

const f = Math.fround;
/** _ftol (0x100530d0): truncation */
const ftol = (v: number): number => (v > -2147483649 && v < 2147483648 ? Math.trunc(v) : -2147483648);
/** _CIfmod: FPREM, exact */
const fmod = (a: number, b: number): number => a % b;

/** the Preset1 registry values (YuleLog's REGISTRY script; LoadPrefs 0x1000c850) */
export interface YulePrefs { sens: number; yRollOn: boolean; xTurbOn: boolean; yTurbOn: boolean; yRollPeriod: number; xTurbPeriod: number; yTurbPeriod: number }
export const DEFAULT_PREFS: YulePrefs = { sens: 100, yRollOn: true, xTurbOn: true, yTurbOn: true, yRollPeriod: 1, xTurbPeriod: 3, yTurbPeriod: 5 };

// ------------------------------------------------------------------------------------------------ the frame tree
/** MESHCONT (0x68 bytes): one mesh of a frame, as LoadMesh 0x10006310 leaves it */
class MeshCont {
  renderType = 0;
  ib: Buffer | null = null;
  vb: Buffer | null = null;              // CreateVideoResources' dynamic copy of ref (0x10009050)
  ref!: Float32Array;                    // 12 floats a vertex: position, 4 blend fields (0 here), normal, uv
  nVerts = 0;
  materials!: ArrayBuffer[];             // D3DMATERIAL8 each
  tex!: (Texture | null)[];
  tex2: (Texture | null)[] | null = null;
  attributes!: AttributeRange[];
}
/** a frame (0x13c bytes): matrices at +0x1c (local), +0x5c (animation, identity here), +0xdc (combined) */
class Frame {
  meshes: MeshCont[] = [];               // +4 (prepended)
  children: Frame[] = [];                // +0xc and the +8 sibling chain, in that chain's order
  local = mat();
  anim = mat();
  combined = mat();
  renderType = 0;                        // +0x10 CraniacRenderType
  constructor(readonly name: string) {}
}
/** MODEL (0x2c bytes): a loaded keyframe or a clone of one */
interface Model { root: Frame; period: number; list: MeshCont[] }

/** the order MODEL::LoadFrames 0x10005f20 links a frame's children: the first one, then each later one right after
 *  the first, so [c0, cN, ..., c1] */
function linkOrder<T>(xs: T[]): T[] { return xs.length ? [xs[0], ...xs.slice(1).reverse()] : []; }

/** the meshes a model interpolates, in 0x10008cf0's list order (built by prepending during a depth-first walk) */
function meshList(root: Frame): MeshCont[] {
  const out: MeshCont[] = [];
  const walk = (fr: Frame): void => { for (const m of fr.meshes) out.unshift(m); for (const c of fr.children) walk(c); };
  walk(root);
  return out;
}

// --------------------------------------------------------------------------------------------- behaviour nodes
// Each node is evaluated once per Animate, in registration order (0x1000df80); only the ones whose outputs reach
// the device are kept (the CircleXY path and its fan-outs feed a node that is never registered; the dt average and
// the 5-second countdown are read by nothing).
interface Node { update(s: Scene): void }
/** ENERGY (update 0x100023c0): the summed spectrum bytes of both channels over [lo, hi] Hz, normalised */
class Energy implements Node {
  private lo: number; private hi: number;
  constructor(private out: (s: Scene, v: number) => void, loHz: number, hiHz: number, private scale: number, private offset: number) {
    if (loHz < 20) loHz = 20;
    if (hiHz > 22050) hiHz = 20000;
    if (hiHz < loHz) { const t = hiHz; hiHz = loHz; loHz = t; }
    // FILD (hz - 20) * 0.0464366786f, truncated
    this.lo = ftol((loHz - 20) * 0.04643667861819267); this.hi = ftol((hiHz - 20) * 0.04643667861819267);
  }
  update(s: Scene): void {
    let sum = 0;
    const a = s.level!.freq[0], b = s.level!.freq[1];
    for (let i = this.lo; i <= this.hi; i++) sum += a[i] + b[i];
    const n = this.hi - this.lo + 1;
    this.out(s, f(((sum / (n * 510)) * this.scale + this.offset) * (s.prefs.sens * 0.01)));
  }
}
/** BEAT (0x100019f0): a running average; a value more than thr times it is a beat (out 1), and resets it */
class Beat implements Node {
  input = 0; avg = 0;
  constructor(private alpha: number, private thr: number) {}
  update(s: Scene): void {
    const v = (1 - this.alpha) * this.input + this.avg * this.alpha;
    if (v / this.avg > this.thr) { this.avg = this.input; s.beat = 1; } else { this.avg = f(v); s.beat = 0; }
  }
}
/** TEMPO (0x10001aa0): on a beat it sets the frame's time step to the one it saw at creation (0: nothing has run
 *  yet then), so beat frames do not advance the flames */
class Tempo implements Node {
  input = 0; avg = 0;
  constructor(private alpha: number, private dt0: number) {}
  update(s: Scene): void {
    if (!(this.input > 0.5)) return;
    s.dt = this.dt0;
    this.avg = f((1 - this.alpha) * s.dt + this.avg * this.alpha);
    this.dt0 = s.dt;
  }
}
/** the moving average (0x1000d490): (v + the last N values) / (N + 1); the first one evaluated fills its window
 *  with v (the global 0x1006f63c) */
class Average implements Node {
  input = 0; private buf: Float32Array; private i = 0;
  constructor(private n: number, private src: (s: Scene) => number, private out: (s: Scene, v: number) => void) { this.buf = new Float32Array(n); }
  update(s: Scene): void {
    const v = this.src(s);
    if (s.fillFlag) { this.buf.fill(v); s.fillFlag = false; }
    let sum = v;
    for (let k = 0; k < this.n; k++) sum += this.buf[k];
    const avg = f(sum / (this.n + 1));
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.n;
    this.out(s, avg);
  }
}

// ------------------------------------------------------------------------------------------------------ flames
/** FLAME (0x48 bytes; Initialize 0x10002580, Animate 0x100027e0) */
class Flame {
  ref!: Texture;                         // +8: a SYSTEMMEM copy of the image
  speed = 0; p1 = 0; p2 = 0;             // +0x30, +0x34, +0x38
  h = 0; level = 0; hAvg = 0;            // +0x3c, +0x40, +0x44
  constructor(readonly name: string, readonly tex: Texture, readonly img: Image, readonly tx: Image, readonly ty: Image,
              readonly yRollOn: boolean, readonly xTurbOn: boolean, readonly yTurbOn: boolean,
              readonly yRollPeriod: number, readonly xTurbPeriod: number, readonly yTurbPeriod: number) {}

  init(dev: Device): void {
    this.ref = dev.createTexture(this.tex.width, this.tex.height, 1, 0, this.tex.format, Pool.SYSTEMMEM);
    dev.copyRects(this.tex.getSurfaceLevel(0), null, this.ref.getSurfaceLevel(0), null);
    this.refPx = new Uint32Array(this.img.bgra.buffer.slice(this.img.bgra.byteOffset, this.img.bgra.byteOffset + this.img.bgra.byteLength));
  }
  private refPx!: Uint32Array;           // what CopyRects put in ref: the image

  animate(dev: Device, dt: number, elapsed: number): void {
    this.p2 = f(dt * this.speed * 30 + this.p2);
    const t = dt * this.speed * 30 + this.p1, t32 = f(t);
    const period = (this.yTurbPeriod * this.yRollPeriod) * this.xTurbPeriod;
    this.p1 = f(t < 0 ? period - fmod(-t32, period) : fmod(t32, period));
    if (this.hAvg < 0.8) this.level = f(this.level + 0.01);
    else if (this.hAvg > 0.8) this.level = f(this.level - 0.01);
    const rs = this.ref.getSurfaceLevel(0), ds = this.tex.getSurfaceLevel(0);
    rs.lockRect(null, Lock.READONLY);
    const dl = ds.lockRect(null, 0);
    if (this.h > 1) this.h = 1;
    const W = this.ref.width, H = this.ref.height, dw = this.tex.width, dh = this.tex.height;
    const tx = this.tx, ty = this.ty;
    const roll = this.yRollOn ? ftol(fmod(elapsed / this.yRollPeriod, 1) * tx.h) : 0;
    const xph = this.xTurbOn ? f(fmod(this.p2 / this.xTurbPeriod, 1) * 3) : 0;
    // the blend weight between two noise channels: frac * 2^-9, truncated, is always 0 (0x10063078 holds 1/512, not
    // 256), so only the next channel is ever read
    const wx = ftol(fmod(xph, 1) * 0.001953125) << 8, cx = ftol(xph), cx2 = (cx + 1) % 3;
    const yph = this.yTurbOn ? f(fmod(this.p2 / this.yTurbPeriod, 1) * 3) : 0;
    const wy = ftol(fmod(yph, 1) * 0.001953125) << 8, cy = ftol(yph), cy2 = (cy + 1) % 3;
    const y0 = ftol((1 - this.h) * dh);
    const d32 = new Uint32Array(dl.data.buffer, dl.data.byteOffset, (dl.pitch >> 2) * dh);
    const dp = dl.pitch >> 2;
    const tb = tx.bgra, yb = ty.bgra;
    for (let y = 0; y < dh; y++) {
      const row = y * dp;
      if (y < y0) { d32.fill(0, row, row + dw); continue; }
      let vy = ftol((y - y0) / this.h);
      if (vy >= H) vy = H - 1;
      const xr = (((roll + y) % tx.h) * tx.w) * 4, yr = (ty.w * y) * 4;
      for (let x = 0; x < dw; x++) {
        let u = ((tb[xr + x * 4 + cx] * (256 - wx) + tb[xr + x * 4 + cx2] * wx) >> 8) - 128 + x;
        if (u < 0) u = 0; else if (u >= W) u = W - 1;
        let w = ((yb[yr + x * 4 + cy] * (256 - wy) + yb[yr + x * 4 + cy2] * wy) >> 8) + vy - 128;
        if (w < 0) w = 0; else if (w >= H) w = H - 1;
        d32[row + x] = this.refPx[w * W + u];
      }
    }
    rs.unlockRect(); ds.unlockRect();
  }
}

// ------------------------------------------------------------------------------------------------------ scene
/** D3D8's Reset: what the runtime does to the state through the device's own methods (the viewport, then per
 *  stage the texture and the 27 texture stage states, then every transform: view, projection, the 256 world
 *  matrices, the 8 texture matrices) */
export function resetDefaults(dev: Device): void {
  const vp = new ArrayBuffer(24), dv = new DataView(vp);
  dv.setUint32(8, dev.width, true); dv.setUint32(12, dev.height, true); dv.setFloat32(20, 1, true);
  dev.setViewport(vp);
  for (let st = 0; st < 8; st++) {
    dev.setTexture(st, null);
    const v: [Tss, number][] = [[Tss.COLOROP, st ? 1 : 4], [Tss.COLORARG1, 2], [Tss.COLORARG2, 1], [Tss.ALPHAOP, st ? 1 : 2],
      [Tss.ALPHAARG1, 2], [Tss.ALPHAARG2, 1], [Tss.BUMPENVMAT00, 0], [Tss.BUMPENVMAT01, 0], [Tss.BUMPENVMAT10, 0],
      [Tss.BUMPENVMAT11, 0], [Tss.TEXCOORDINDEX, st], [Tss.ADDRESSU, 1], [Tss.ADDRESSV, 1], [Tss.BORDERCOLOR, 0],
      [Tss.MAGFILTER, 1], [Tss.MINFILTER, 1], [Tss.MIPFILTER, 0], [Tss.MIPMAPLODBIAS, 0], [Tss.MAXMIPLEVEL, 0],
      [Tss.MAXANISOTROPY, 1], [Tss.BUMPENVLSCALE, 0], [Tss.BUMPENVLOFFSET, 0], [Tss.TEXTURETRANSFORMFLAGS, 0],
      [Tss.ADDRESSW, 1], [Tss.COLORARG0, 1], [Tss.ALPHAARG0, 1], [Tss.RESULTARG, 1]];
    for (const [t, x] of v) dev.setTextureStageState(st, t, x);
  }
  const I = mat();
  dev.setTransform(2, I); dev.setTransform(3, I);
  for (let i = 0; i < 256; i++) dev.setTransform(256 + i, I);
  for (let i = 0; i < 8; i++) dev.setTransform(16 + i, I);
}

const vec4 = (a: number, b: number, c: number, d: number): Float32Array => new Float32Array([a, b, c, d]);

export interface SceneConfig {
  assets: YuleAssets;
  prefs?: Partial<YulePrefs>;
  /** QueryPerformanceCounter in microseconds (frequency 1,000,000) */
  now: () => number;
}

export class Scene {
  readonly prefs: YulePrefs;
  dev: Device;
  level: TimedLevel | null = null;
  // globals the graph and the frame share
  dt = 0;                                  // 0x10077238
  elapsed = 0;                             // 0x10077234
  beat = 0;                                // 0x10076f58
  glow = 0;                                // 0x10077230
  fillFlag = true;                         // 0x1006f63c
  color = new Float32Array([1, 1, 1, 1]);  // 0x10076f28 (c21, the light's diffuse)
  lightDir = new Float32Array([0, -0.5, -1]); // 0x10076de8
  eye = new Float32Array([0, 1, 1]);       // 0x10076f18
  clearColor = 0;                          // 0x10076cb0
  private view = mat(); private proj = mat(); private vp = mat();   // 0x10077168, 0x10077128, 0x100771a8
  private nodes: Node[] = [];
  private flames: Flame[] = [];            // the list 0x10077210: last added first
  private texCache: { name: string; tex: Texture }[] = [];
  private turb = new Map<string, Image>();
  private keyframes: Model[] = [];
  private period = 2;                      // fire.anl: "seq1 2.0"
  private inst0!: Model; private inst1!: Model;
  private actor = { speed: 0, t: 0, t2: 0, matrix: mat(), blend: 0, cur: -1, next: 0 };
  private stack = new MatrixStack();
  private shaderFns: Uint32Array[] = [];
  private shaders: VertexShader[] = [-1, -1, -1, -1] as VertexShader[];
  private blocks: StateBlock[] = [-1, -1, -1, -1] as StateBlock[];
  private active = false;                  // PRESET1+8
  private rect: [number, number] = [0, 0];
  private animTimer = 7;                   // 0x1006ed18
  private shuffleIdx = 0;                  // 0x10076f50
  // CYule::Render's timer (0x1000d8a0, QueryPerformanceCounter branch)
  private tBase = 0; private tLast = 0; private tPaused = 0;
  private prevState = 0;                   // 0x100772d8
  private started = false;
  private resetTimer = true;               // 0x1006f8ec

  constructor(dev: Device, private cfg: SceneConfig) {
    this.dev = dev;
    this.prefs = { ...DEFAULT_PREFS, ...cfg.prefs };
  }

  private timer(n: number): number {
    const now = this.tPaused === 0 || n === 1 || n === 4 ? this.cfg.now() : this.tPaused;
    switch (n) {
      case 0: this.tBase = now; this.tLast = now; return 0;
      case 1: this.tBase = now - this.tPaused; this.tPaused = 0; this.tLast = now; return 0;
      case 2: this.tPaused = now; this.tLast = now; return 0;
      case 5: return (now - this.tBase) / 1e6;
      case 6: { const r = (now - this.tLast) / 1e6; this.tLast = now; return r; }
      default: return -1;
    }
  }

  /** IWMPEffects::Render (CYule 0x1000e060) */
  render(level: TimedLevel, w: number, h: number): void {
    this.level = level;
    if (!this.started) {
      this.timer(2);
      this.init(w, h);
      this.started = true;
      this.timer(1);
    }
    if (this.resetTimer) { this.timer(0); this.resetTimer = false; }
    const d6 = this.timer(6);
    this.dt = f(fmod(d6, 0.5));
    const el = this.timer(5);
    this.elapsed = f(el);
    if (el < 0 || this.dt < 0) { this.elapsed = 0; this.dt = 0; }
    const st = level.state;
    if (st >= 0) {
      if (st < 2) {
        if (this.prevState === 2) this.timer(2);
        this.presetRender(w, h);
      } else if (st === 2) {
        if (this.prevState === 1 || this.prevState === 0) this.timer(1);
        this.animate();
        this.presetRender(w, h);
      }
    }
    this.prevState = st;
  }

  // ---------------------------------------------------------------------------------------- Init / CreateScene
  private init(w: number, h: number): void {
    const dev = this.dev, as = this.cfg.assets, P = this.prefs;
    for (const g of SHADERS) this.shaderFns.push(assemble(g.prog, as.shaderComments?.[g.name]));
    for (const n of TEXTURE_NAMES) {
      const im = as.textures[n];
      this.texCache.unshift({ name: ('fire\\' + n).toLowerCase(), tex: textureFromPixels(dev, im.w, im.h, im.bgra, 1) });
    }
    for (const n of TURBULENCE_NAMES) {
      const im = as.turbulence[n];
      const t = textureFromPixels(dev, im.w, im.h, im.bgra, 0);
      // CACHE_TURB::Load 0x10001e60 copies level 0 out through the surface (LockRect flags 0) and lets the texture go
      const s = t.getSurfaceLevel(0); s.lockRect(null, 0); s.unlockRect();
      this.turb.set(n, im);
    }
    for (const [img, x, y] of FLAMES) {
      // 0x1000cf10: period +-25 %, from rand (YTurbPeriod first)
      const yT = f(this.vary(P.yTurbPeriod, 25)), xT = f(this.vary(P.xTurbPeriod, 25));
      const fl = new Flame(('fire\\' + img).toLowerCase(), this.tex('fire\\' + img)!, as.textures[img], this.turb.get(x)!, this.turb.get(y)!,
        P.yRollOn, P.xTurbOn, P.yTurbOn, f(P.yRollPeriod), xT, yT);
      this.flames.unshift(fl);
      fl.init(dev);
    }
    dev.setVertexShaderConstant(27, vec4(0, 0.5, 1, 0.2), 1);
    dev.setVertexShaderConstant(28, vec4(2, 3.1415927410125732, 2.7182817459106445, 10), 1);
    // MODELSET: fire.anl's one vertex-animated series, its keyframes loaded in order (ParseANL 0x10004c60)
    for (const kf of as.keyframes) this.keyframes.push(this.loadModel(kf));
    const rot = rotationY(mat(), 3.1415927410125732);
    for (const m of this.keyframes) multiply(m.root.local, m.root.local, rot);   // 0x100056f0
    // ACTOR (0x100010b0): instance 0 is a clone of the first keyframe, instance 1 a clone of instance 0
    this.inst0 = this.cloneModel(this.keyframes[0]);
    this.inst1 = this.cloneModel(this.inst0);
    this.createVideoResources(w, h);
    this.createBehaviours();
    this.stack = new MatrixStack();
  }

  /** 0x1000cf10: p + (rand() * (1/32767) * t - t * 0.5), t = (pct * 0.01 * p) * 2 */
  private vary(p: number, pct: number): number {
    const t = f(pct * f(0.01) * f(p) * 2);
    return A.rand() * f(3.0518509447574615e-05) * t - t * 0.5 + f(p);
  }

  private tex(name: string): Texture | null {
    const n = name.toLowerCase();
    for (const e of this.texCache) if (e.name === n) return e.tex;
    return null;
  }

  // ------------------------------------------------------------------------------------ MODEL::CreateStructure
  private loadModel(top: XFrame[]): Model {
    const root = new Frame('');
    const build = (xf: XFrame, rt: number): Frame => {
      const fr = new Frame(xf.name);
      fr.renderType = xf.renderType ?? rt;
      if (xf.matrix) fr.local.set(Array.from(xf.matrix, (x) => f(x)));
      for (const m of xf.meshes) fr.meshes.unshift(this.loadMeshCont(m, fr.renderType));
      fr.children = linkOrder(xf.children.map((c) => build(c, 0)));
      return fr;
    };
    root.children = linkOrder(top.map((t) => build(t, 0)));
    return { root, period: this.period, list: meshList(root) };
  }

  /** MODEL::LoadMesh 0x10006310 (rigid meshes) */
  private loadMeshCont(m: XMesh, renderType: number): MeshCont {
    const dev = this.dev;
    const o = loadMesh(dev, m);
    const mc = new MeshCont();
    mc.renderType = renderType;
    const n = o.vertices.length / 8;
    mc.nVerts = n;
    mc.ref = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const s = i * 8, d = i * 12;
      mc.ref[d] = o.vertices[s]; mc.ref[d + 1] = o.vertices[s + 1]; mc.ref[d + 2] = o.vertices[s + 2];
      mc.ref[d + 7] = o.vertices[s + 3]; mc.ref[d + 8] = o.vertices[s + 4]; mc.ref[d + 9] = o.vertices[s + 5];
      mc.ref[d + 10] = o.vertices[s + 6]; mc.ref[d + 11] = o.vertices[s + 7];
    }
    mc.ib = dev.createIndexBuffer(o.indices.length * 2, 8, Fmt.INDEX16, Pool.SYSTEMMEM);
    const p = mc.ib.lock(0, 0, 0); p.set(new Uint8Array(o.indices.buffer, 0, o.indices.byteLength)); mc.ib.unlock();
    mc.attributes = o.attributes;
    mc.materials = m.materials.map((x) => {
      const b = new ArrayBuffer(68), v = new Float32Array(b);
      v.set([x.diffuse[0], x.diffuse[1], x.diffuse[2], x.diffuse[3], 0, 0, 0, 1, x.specular[0], x.specular[1], x.specular[2], 1,
        x.emissive[0], x.emissive[1], x.emissive[2], 1, x.power]);
      return b;
    });
    mc.tex = m.materials.map((x) => {
      if (!x.texture) return null;
      if (renderType === 2) { const fl = this.flames.find((q) => q.name === x.texture!.toLowerCase()); return fl ? fl.tex : null; }
      return this.tex(x.texture);
    });
    if (renderType === 3) mc.tex2 = m.materials.map((x) => (x.texture ? this.tex(x.texture.slice(0, -4) + 'b.jpg') : null));
    return mc;
  }

  /** 0x10007940 / 0x10007a40 / 0x10007fb0: a model's clone, its index buffers copied (depth first: a frame's
   *  meshes, its children, then its next sibling) */
  private cloneModel(src: Model): Model {
    const dev = this.dev;
    const cloneFrame = (s: Frame): Frame => {
      const fr = new Frame(s.name);
      fr.renderType = s.renderType;
      fr.local.set(s.local); fr.anim.set(s.anim); fr.combined.set(s.combined);
      fr.meshes = s.meshes.map((m) => {
        const c = new MeshCont();
        Object.assign(c, m);
        c.vb = null;
        c.ib = dev.createIndexBuffer(m.ib!.length, 8, Fmt.INDEX16, Pool.SYSTEMMEM);
        const sp = m.ib!.lock(0, 0, 0), dp = c.ib.lock(0, 0, 0);
        dp.set(sp); c.ib.unlock(); m.ib!.unlock();
        c.ref = m.ref.slice();
        return c;
      });
      fr.children = s.children.map(cloneFrame);
      return fr;
    };
    const root = cloneFrame(src.root);
    return { root, period: src.period, list: meshList(root) };
  }

  // ------------------------------------------------------------------------------- CreateVideoResources 0x1000a850
  private setupCamera(): void {
    // 0x1000cd90: look-at (0, -0.15, 0) from the eye, up (0, 1, 0); 35 degrees, the viewport's aspect, 0.01..3.3
    lookAtRH(this.view, this.eye, new Float32Array([0, -0.15, 0]), new Float32Array([0, 1, 0]));
    const aspect = f(this.dev.width / this.dev.height);
    perspectiveFovRH(this.proj, 0.6108652353286743, aspect, 0.009999999776482582, 3.299999952316284);
    this.dev.setTransform(3, this.proj);
  }

  private createVideoResources(w: number, h: number): void {
    const dev = this.dev;
    this.setupCamera();
    // 0x1000bac0: ambient 0x101010, lighting on, one directional light coloured c21 (ambient 1/8 of it)
    dev.setRenderState(Rs.AMBIENT, 0x101010);
    dev.setRenderState(Rs.LIGHTING, 1);
    const L = new ArrayBuffer(104), lf = new Float32Array(L), li = new Uint32Array(L);
    li[0] = 3;
    lf[1] = this.color[0]; lf[2] = this.color[1]; lf[3] = this.color[2]; lf[4] = this.color[3];
    lf[5] = 1; lf[6] = 1; lf[7] = 1; lf[8] = 0;
    lf[9] = f(this.color[0] * 0.125); lf[10] = f(this.color[1] * 0.125); lf[11] = f(this.color[2] * 0.125);
    lf[16] = this.lightDir[0]; lf[17] = this.lightDir[1]; lf[18] = this.lightDir[2];
    vec3Normalize(this.lightDir, this.lightDir);
    dev.setLight(0, L);
    dev.lightEnable(0, true);
    // the actor's instance-0 vertex buffers (0x10009050), depth first
    const walk = (fr: Frame): void => {
      for (const m of fr.meshes) {
        m.vb = dev.createVertexBuffer(m.nVerts * 48, 0x200, 0, Pool.SYSTEMMEM);
        const p = m.vb.lock(0, 0, 0); p.set(new Uint8Array(m.ref.buffer, m.ref.byteOffset, m.ref.byteLength)); m.vb.unlock();
      }
      for (const c of fr.children) walk(c);
    };
    walk(this.inst0.root);
    this.inst0.list = meshList(this.inst0.root);
    this.active = true;
    for (let i = 0; i < 4; i++) this.shaders[i] = dev.createVertexShader(DECLARATION, this.shaderFns[i], 0);
    const common = (): void => {
      dev.setRenderState(Rs.ZENABLE, 1); dev.setRenderState(Rs.ZFUNC, 4); dev.setRenderState(Rs.ZWRITEENABLE, 1);
      dev.setRenderState(Rs.FILLMODE, 3); dev.setRenderState(Rs.LIGHTING, 0); dev.setRenderState(Rs.COLORVERTEX, 0);
      dev.setRenderState(Rs.CULLMODE, 2); dev.setRenderState(Rs.NORMALIZENORMALS, 1);
      dev.setTextureStageState(0, Tss.ADDRESSU, 3); dev.setTextureStageState(0, Tss.ADDRESSV, 3);
      dev.setTextureStageState(0, Tss.MINFILTER, 2); dev.setTextureStageState(0, Tss.MAGFILTER, 2);
      dev.setTextureStageState(0, Tss.MIPFILTER, 2);
      dev.setRenderState(Rs.SPECULARENABLE, 0);
    };
    const consts = (sh: VertexShader): void => {
      dev.setVertexShaderConstant(16, vec4(1, 1, 1, 1), 1);
      dev.setVertexShaderConstant(17, vec4(0.2, 0.2, 0.2, 1), 1);
      dev.setVertexShaderConstant(18, vec4(1, 1, 1, 1), 1);
      dev.setVertexShaderConstant(19, vec4(0, 0, 0, 100), 1);
      dev.setVertexShader(sh);
    };
    for (let i = 0; i < 2; i++) {        // noskin, skin: opaque, texture * current
      dev.beginStateBlock();
      common();
      dev.setRenderState(Rs.ALPHABLENDENABLE, 0);
      dev.setTextureStageState(0, Tss.COLOROP, 4); dev.setTextureStageState(0, Tss.COLORARG1, 2); dev.setTextureStageState(0, Tss.COLORARG2, 1);
      consts(this.shaders[i]);
      this.blocks[i] = dev.endStateBlock();
    }
    dev.beginStateBlock();               // flame: blended by texture alpha, colour texture * diffuse
    common();
    dev.setRenderState(Rs.ALPHABLENDENABLE, 1); dev.setRenderState(Rs.SRCBLEND, 5); dev.setRenderState(Rs.DESTBLEND, 6);
    dev.setTextureStageState(0, Tss.COLOROP, 4); dev.setTextureStageState(0, Tss.COLORARG1, 2); dev.setTextureStageState(0, Tss.COLORARG2, 0);
    dev.setTextureStageState(0, Tss.ALPHAOP, 13); dev.setTextureStageState(0, Tss.ALPHAARG1, 2); dev.setTextureStageState(0, Tss.ALPHAARG2, 1);
    consts(this.shaders[2]);
    this.blocks[2] = dev.endStateBlock();
    dev.beginStateBlock();               // log: the glow image blended over the log by TEXTUREFACTOR's alpha
    common();
    dev.setRenderState(Rs.ALPHABLENDENABLE, 1); dev.setRenderState(Rs.SRCBLEND, 5); dev.setRenderState(Rs.DESTBLEND, 6);
    dev.setTextureStageState(0, Tss.COLOROP, 4); dev.setTextureStageState(0, Tss.COLORARG1, 2); dev.setTextureStageState(0, Tss.COLORARG2, 1);
    dev.setTextureStageState(0, Tss.ALPHAOP, 2); dev.setTextureStageState(0, Tss.ALPHAARG1, 2);
    dev.setTextureStageState(1, Tss.COLOROP, 14); dev.setTextureStageState(1, Tss.COLORARG1, 2); dev.setTextureStageState(1, Tss.COLORARG2, 1);
    dev.setTextureStageState(1, Tss.ALPHAOP, 2); dev.setTextureStageState(1, Tss.ALPHAARG1, 2);
    consts(this.shaders[3]);
    this.blocks[3] = dev.endStateBlock();
    void w; void h;
  }

  /** 0x1000b9f0: the shaders, the state blocks and the actor's vertex buffers go before a Reset */
  private releaseVideoResources(): void {
    this.active = false;
    for (let i = 0; i < 4; i++) {
      if (this.shaders[i] !== -1) { this.dev.deleteVertexShader(this.shaders[i]); this.shaders[i] = -1; }
      if (this.blocks[i] !== -1) { this.dev.deleteStateBlock(this.blocks[i]); this.blocks[i] = -1; }
    }
  }

  // ----------------------------------------------------------------------------------- the graph (0x1000bbe0)
  private createBehaviours(): void {
    const N = this.nodes;
    const beat = new Beat(f(0.3), f(1.15)), tempo = new Tempo(f(0.3), this.dt);
    N.push(new Energy((_, v) => { beat.input = v; }, 20, 500, 1, 0));
    N.push(beat);
    N.push({ update: (s) => { tempo.input = f(s.beat * 1 + 0); } });
    N.push(tempo);
    N.push(new Energy((s, v) => { s.color[2] = v; }, 20, 15000, 2.7225000858306885, f(0.01)));
    N.push(new Energy((s, v) => { s.color[1] = v; }, 20, 15000, 2.447499990463257, f(0.11)));
    N.push(new Energy((s, v) => { s.color[0] = v; }, 20, 15000, 0.0274999737739563, f(0.99)));
    // SitInPlace (fire.beh): a WAIT path of one POINT, at time 0 (its fan-out reads 0x10076f54, never written):
    // the eye = point * (1, 1, 1) + (0, 0, 0), each step rounded to float
    const point = [0, f(-0.05), f(1.02)];
    N.push({ update: (s) => { for (let k = 0; k < 3; k++) s.eye[k] = f(f(1 * point[k] + 0) * 1 + 0); } });
    N.push(new Energy((s, v) => { s.actor.speed = v; }, 50, 22050, 1, 0));
    for (const fl of this.flames) {
      const avgS: Average = new Average(1, (): number => avgS.input, (_, v) => { fl.speed = v; });
      N.push(new Energy((_, v) => { avgS.input = v; }, 50, 22050, 1, 0));
      N.push(avgS);
      let a = 50 - ftol(A.rand() * -0.6714377269508957), b = 50 - ftol(A.rand() * -0.6714377269508957);
      if (a > b) { const t = a; a = b; b = t; }
      N.push(new Energy((_, v) => { fl.h = v; }, a, b, 2, f(0.3)));
      N.push(new Average(30, () => fl.h, (_, v) => { fl.hAvg = v; }));
    }
    N.push(new Energy((s, v) => { s.glow = v; }, 50, 22050, 3, 0));
  }

  // --------------------------------------------------------------------------------------- Animate 0x1000a310
  private animate(): void {
    for (const n of this.nodes) n.update(this);
    this.animTimer = f(this.animTimer - this.dt);
    if (this.animTimer < 0) {
      this.animTimer = f(this.animTimer + 7);
      this.shuffleIdx++;
      if (this.shuffleIdx >= 1) this.shuffleIdx = 0;       // one series: the shuffle (0x1000ce70) of one draws nothing
      this.actor.next = 0;
    }
    if (this.active) {
      this.animateActor();
      for (const fl of this.flames) fl.animate(this.dev, this.dt, this.elapsed);
    }
    this.clearColor = 0xff000000 | 0;
  }

  /** ACTOR::Animate 0x10001160 and MODELSET::Animate 0x10005600 (vertex animation) */
  private animateActor(): void {
    const a = this.actor;
    a.t2 = f(this.dt * a.speed * 30 + a.t2);
    const t = this.dt * a.speed * 30 + a.t;
    let tt = f(t);
    a.t = tt;
    const per = this.inst0.period;
    tt = f(t < 0 ? per - fmod(-tt, per) : fmod(tt, per));
    if (a.next !== a.cur && tt < 0.1) {
      a.blend = 1; a.t = 0; a.cur = a.next;
    }
    let other: Model | null = null;
    if (a.blend) {
      if (Math.abs(a.t) < 0.5) other = this.inst1;
      else { a.blend = 0; a.t = 0; tt = 0; }
    }
    const kf = this.keyframes, n = kf.length;
    if (n <= 1) return;
    if (!other) {
      const tm = fmod(tt, this.period);
      const seg = this.period / (n - 1);
      const i = ftol(tm / seg);
      this.interpolate(kf[i], kf[i + 1], f((tm - i * seg) / seg));
    } else {
      this.interpolate(other, kf[0], f(fmod(tt, 0.5) * 2));
    }
  }

  /** MODEL::Interpolate 0x10008dc0: instance 0's vertex buffers = lerp of two models' reference vertices (position,
   *  normal, uv; the blend fields stay as created) */
  private interpolate(ma: Model, mb: Model, t: number): void {
    const L = this.inst0.list, La = ma.list, Lb = mb.list;
    for (let k = 0; k < L.length; k++) {
      const vb = L[k].vb!, ra = La[k].ref, rb = Lb[k].ref;
      const p = vb.lock(0, 0, Lock.DISCARD);
      const d = new Float32Array(p.buffer, p.byteOffset, p.byteLength >> 2);
      const n = (vb.length / 48) | 0;
      for (let i = 0, o = 0; i < n; i++, o += 12) {
        for (const j of [0, 1, 2, 7, 8, 9, 10, 11]) d[o + j] = (rb[o + j] - ra[o + j]) * t + ra[o + j];
      }
      vb.unlock();
    }
  }

  debug(): Record<string, unknown> {
    return {
      dt: this.dt, elapsed: this.elapsed, glow: this.glow, color: Array.from(this.color), beat: this.beat,
      flames: this.flames.map((fl) => ({ name: fl.name, speed: fl.speed, height: fl.h, p2: fl.p2 })),
    };
  }

  // ---------------------------------------------------------------------------------------- Render 0x10009f20
  private presetRender(w: number, h: number): void {
    const dev = this.dev;
    if (w !== this.rect[0] || h !== this.rect[1]) {
      // the window's size changed (and the first time): Reset to it and make the video resources again
      this.releaseVideoResources();
      const r = dev as Device & { reset?: (w: number, h: number) => void };
      if (r.reset) r.reset(w, h);
      resetDefaults(dev);
      this.createVideoResources(w, h);
      this.rect = [w, h];
      return;
    }
    this.setupCamera();
    if (!this.active) return;
    dev.beginScene();
    dev.clear(null, 3, this.clearColor, 1, 0);
    dev.setTransform(2, this.view);
    this.stack.loadIdentity();
    this.setWorld(this.stack.top());
    dev.setVertexShaderConstant(20, vec4(this.lightDir[0], this.lightDir[1], this.lightDir[2], 0), 1);
    dev.setVertexShaderConstant(21, this.color, 1);
    dev.setVertexShaderConstant(26, vec4(this.eye[0], this.eye[1], this.eye[2], 0), 1);
    const t = transpose(mat(), multiply(mat(), this.view, this.proj));
    dev.setVertexShaderConstant(4, t, 4);
    this.drawActor();
    dev.endScene();
    dev.present();
  }

  /** ACTOR::Draw 0x10001270 */
  private drawActor(): void {
    this.stack.push();
    this.stack.multMatrixLocal(this.actor.matrix);
    this.setWorld(this.stack.top());
    multiply(this.vp, this.view, this.proj);
    const M = this.stack.top().slice();
    this.combine(this.inst0.root, M);
    this.drawFrame(this.inst0.root);
    this.stack.pop();
    this.setWorld(this.stack.top());
  }

  /** 0x10002f70 */
  private combine(fr: Frame, parent: Mat): void {
    multiply(fr.combined, fr.local, parent);
    multiply(fr.combined, fr.combined, fr.anim);
    for (const c of fr.children) this.combine(c, fr.combined);
  }

  /** 0x10002fc0 */
  private drawFrame(fr: Frame): void {
    if (fr.meshes.length) this.setWorld(fr.combined);
    for (const m of fr.meshes) this.drawMesh(m);
    for (const c of fr.children) this.drawFrame(c);
  }

  /** MODEL::DrawMeshContainer 0x10003040 (rigid meshes) */
  private drawMesh(m: MeshCont): void {
    const dev = this.dev;
    dev.applyStateBlock(this.blocks[m.renderType]);
    if (m.renderType === 3) {
      const g = ftol(this.glow * 256) & 0xff;
      dev.setRenderState(Rs.TEXTUREFACTOR, (g * 0x01010101) >>> 0);
    }
    const W = this.world;
    dev.setVertexShaderConstant(51, transpose(mat(), W), 4);
    const wv = multiply(mat(), W, this.view);
    dev.setVertexShaderConstant(0, transpose(mat(), wv), 4);
    const inv = mat();
    inverse(inv, null, wv);
    dev.setVertexShaderConstant(12, inv.subarray(0, 4), 1);
    dev.setVertexShaderConstant(13, inv.subarray(4, 8), 1);
    dev.setVertexShaderConstant(14, inv.subarray(8, 12), 1);
    const wvp = multiply(mat(), wv, this.proj);
    dev.setVertexShaderConstant(8, transpose(mat(), wvp), 4);
    for (let i = 0; i < m.attributes.length; i++) {
      const at = m.attributes[i];
      dev.setMaterial(m.materials[i]);
      dev.setTexture(0, m.tex[i]);
      if (m.renderType === 3) dev.setTexture(1, m.tex2![i]);
      dev.setIndices(m.ib, 0);
      dev.setStreamSource(0, m.vb, 0x30);
      dev.drawIndexedPrimitive(Prim.TRIANGLELIST, at.vertexStart, at.vertexCount, at.faceStart * 3, at.faceCount);
      dev.setStreamSource(0, null, 0);
      dev.setTexture(0, null);
      dev.setTexture(1, null);
    }
  }
  /** the device's world matrix (DrawMeshContainer reads it back with GetTransform) */
  private world = mat();
  private setWorld(m: Mat): void { this.world.set(m); this.dev.setTransform(256, m); }
}
