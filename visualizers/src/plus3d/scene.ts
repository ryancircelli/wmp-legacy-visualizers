// CPlusVis (plusvis.dll's IWMPEffects object) and what its three PRESET classes share: the per-frame flow of
// CPlusVis::Render 0x1000b4a0 (the clock, play state, Animate then Render), the camera (each preset's SetupCamera),
// the light, the CD3DFont the presets make and never draw, the device Reset when the window's size changes.
import { A, type TimedLevel } from '../ns';
import { Fmt, Pool, type Device, type StateBlock, type Texture, type Buffer } from '../d3d8/api';
import { resetDefaults } from '../yule/scene';
import { MatrixStack as YuleStack } from '../yule/d3dx';
import { mat, multiply, perspectiveFovRH, type Mat } from '../yule/math';
import { lookAtRH, translation, vec3Normalize } from './math';
import { Globals, DT, ELAPSED, ftol, type Node, type NodeCtx } from './nodes';
import type { CamNode } from './camgraph';
import { ModelSet, Actor } from './modelset';
import { Bgnd } from './bgnd';
import { parseBEH, takePath, type Path } from './beh';
import type { LoadCtx, DrawCtx } from './model';
import type { Plus3DAssets } from './assets';

const f = Math.fround;

/** the clock (0x10018820, QueryPerformanceCounter branch; Yule Log's 0x1000d8a0): 0 reset, 1 resume, 2 pause,
 *  5 seconds since the base, 6 seconds since the last call */
export class Timer {
  private base = 0; private last = 0; private paused = 0;
  constructor(private now: () => number) {}
  call(n: number): number {
    const now = this.paused === 0 || n === 1 || n === 4 ? this.now() : this.paused;
    switch (n) {
      case 0: this.base = now; this.last = now; return 0;
      case 1: this.base = now - this.paused; this.paused = 0; this.last = now; return 0;
      case 2: this.paused = now; this.last = now; return 0;
      case 5: return (now - this.base) / 1e6;
      case 6: { const r = (now - this.last) / 1e6; this.last = now; return r; }
      default: return -1;
    }
  }
}

/** ID3DXMatrixStack with TranslateLocal (top = translation * top) */
export class MatrixStack extends YuleStack {
  translateLocal(x: number, y: number, z: number): void { multiply(this.top(), translation(TMP, x, y, z), this.top()); }
}
const TMP = mat();

/** CD3DFont ("Arial", 12, bold): what it makes on the device (0x10018180) and releases (0x100187b0). The DLL renders
 *  its glyphs into the texture with GDI; nothing ever draws with it, so the port leaves the texture blank. */
class Font {
  private vb: Buffer | null = null;
  private sb: StateBlock[] = [];
  private tex: Texture | null = null;
  restore(dev: Device): void {
    this.vb = dev.createVertexBuffer(0x20d0, 0x208, 0, Pool.DEFAULT);
    for (let k = 0; k < 2; k++) {
      dev.beginStateBlock();
      dev.setTexture(0, this.tex);
      for (const [s, v] of [[27, 1], [19, 5], [20, 6], [15, 1], [24, 8], [25, 7], [8, 3], [22, 3], [7, 0], [52, 0], [136, 1], [40, 0],
        [152, 0], [151, 0], [167, 0], [28, 0]]) dev.setRenderState(s, v);
      for (const [t, v] of [[1, 4], [2, 2], [3, 0], [4, 4], [5, 2], [6, 0], [17, 1], [16, 1], [18, 0], [11, 0], [24, 0]]) dev.setTextureStageState(0, t, v);
      dev.setTextureStageState(1, 1, 1); dev.setTextureStageState(1, 4, 1);
      this.sb.push(dev.endStateBlock());
    }
    this.tex = dev.createTexture(256, 256, 1, 0, Fmt.A4R4G4B4, Pool.SYSTEMMEM);
    this.tex.lockRect(0, null, 0); this.tex.unlockRect(0);
  }
  release(dev: Device): void {
    this.vb = null;
    for (const s of this.sb) dev.deleteStateBlock(s);
    this.sb = [];
    this.tex = null;
  }
}

export interface Rect4 { left: number; top: number; right: number; bottom: number }

/** a PRESET: Init, Destroy, Animate, Render (vtable slots 0-3) and the scene state they share */
export abstract class Preset {
  readonly g = new Globals();
  protected nodes: Node[] = [];
  protected paths: Path[] = [];
  set!: ModelSet;
  actor!: Actor;
  bgnd!: Bgnd;
  protected font = new Font();
  protected stack = new MatrixStack();
  active = false;                         // +8
  inited = false;                         // +4
  readonly view = mat(); readonly proj = mat();
  readonly world = mat();
  protected rect: Rect4 = { left: 0, top: 0, right: 0, bottom: 0 };     // 0x10062d60..6c (the device's)
  /** time(NULL), which Init seeds rand with after making the scene (the harness pins it) */
  time: () => number = () => Math.floor(Date.now() / 1000);
  constructor(readonly dev: Device, readonly assets: Plus3DAssets) {}
  get c(): LoadCtx { return { dev: this.dev, assets: this.assets }; }
  get drawCtx(): DrawCtx { return { dev: this.dev, world: this.world, view: this.view, proj: this.proj }; }

  abstract init(): void;
  abstract animate(level: TimedLevel): void;
  abstract render(rc: Rect4): void;

  /** node registration (0x10018dd0: append) */
  protected reg<T extends Node>(n: T): T { this.nodes.push(n); return n; }
  protected runNodes(level: TimedLevel): void {
    const c: NodeCtx = { g: this.g, level };
    for (const n of this.nodes) n.update(c);
  }
  protected loadPaths(beh: string): void { this.paths = parseBEH(this.assets.text[beh]); }
  protected path(name: string): Path { const p = takePath(this.paths, name); if (!p) throw new Error('BEH: no path ' + name); return p; }

  /** SetupCamera (each preset's own: eye, target, up, fov, far plane) */
  protected camera(eye: ArrayLike<number>, at: ArrayLike<number>, up: ArrayLike<number>, fov: number, zf: number): void {
    lookAtRH(this.view, eye, at, up);
    const aspect = f(this.dev.width / this.dev.height);
    perspectiveFovRH(this.proj, fov, aspect, 0.009999999776482582, zf);
    this.dev.setTransform(3, this.proj);
  }

  /** the light (Yule Log's 0x1000bac0): ambient 0x101010, lighting on, one directional light coloured by the
   *  scene's colour (ambient 1/8 of it), its direction the scene's light direction, normalised in place */
  protected light(colour: number, dir: number): void {
    const dev = this.dev, G = this.g;
    dev.setRenderState(139, 0x101010);
    dev.setRenderState(137, 1);
    const L = new ArrayBuffer(104), lf = new Float32Array(L), li = new Uint32Array(L);
    li[0] = 3;
    for (let k = 0; k < 4; k++) lf[1 + k] = G.get(colour + k * 4);
    lf[5] = 1; lf[6] = 1; lf[7] = 1; lf[8] = 0;
    for (let k = 0; k < 3; k++) lf[9 + k] = f(G.get(colour + k * 4) * 0.125);
    for (let k = 0; k < 3; k++) lf[16 + k] = G.get(dir + k * 4);
    const d = G.at(dir), v = d.f.subarray(d.i, d.i + 3);
    vec3Normalize(v, v);
    dev.setLight(0, L);
    dev.lightEnable(0, true);
  }

  protected fontRestore(): void { this.font.restore(this.dev); }
  protected fontRelease(): void { this.font.release(this.dev); }

  /** ResetDevice 0x10003500 */
  protected resetDevice(w: number, h: number): void {
    const r = this.dev as Device & { reset?: (w: number, h: number) => void };
    if (r.reset) r.reset(w, h);
    resetDefaults(this.dev);
  }

  /** the camera's random walk (Maxx's Kingdom 0x100131a0, Undersea Wonders 0x10016050): its time runs; after a
   *  3-frame wait, when it passes the path's length the next path is a random one of its n successors, number
   *  (int)(rand * (n - 1 + 0.999999) / 32767) */
  protected camCountdown = 18;
  protected walkCamera(graph: CamNode[], tAddr: number, idxAddr: number): void {
    const G = this.g;
    G.set(tAddr, G.get(DT) + G.get(tAddr));
    if (this.camCountdown !== 0) { this.camCountdown--; return; }
    const cur = graph[G.geti(idxAddr)];
    if (cur.time <= G.get(tAddr)) {
      G.set(tAddr, G.get(tAddr) - cur.time);
      const k = ftol((A.rand() * (cur.next.length - 1 + 0.999999)) * 3.0518509475997192e-05);
      this.camCountdown = 3;
      G.seti(idxAddr, cur.next[k] ?? 0);
    }
  }

  /** a time step and elapsed time set by CPlusVis::Render */
  setClock(dt: number, elapsed: number): void { this.g.set(DT, dt); this.g.set(ELAPSED, elapsed); }
}

/** CPlusVis::Render 0x1000b4a0 around the current preset */
export class PlusVis {
  private timer: Timer;
  private first = true;                  // 0x10062274 == 0: the first call only shows the splash bitmap
  private resetTimer = true;             // 0x10059d10
  private prevState = 0;                 // 0x10062278
  constructor(readonly preset: Preset, now: () => number) { this.timer = new Timer(now); }

  render(level: TimedLevel, w: number, h: number): void {
    const p = this.preset;
    if (!p.inited) {
      if (this.first) { this.first = false; return; }
      this.timer.call(2);
      p.init();
      p.inited = true;
      this.timer.call(1);
    }
    if (this.resetTimer) { this.timer.call(0); this.resetTimer = false; }
    const d6 = this.timer.call(6);
    let dt = f(d6 % 0.5);
    const el = this.timer.call(5);
    let elapsed = f(el);
    if (el < 0 || dt < 0) { elapsed = 0; dt = 0; }
    p.setClock(dt, elapsed);
    const st = level.state;
    const rc = { left: 0, top: 0, right: w, bottom: h };
    if (st >= 0) {
      if (st < 2) {
        if (this.prevState === 2) this.timer.call(2);
        p.render(rc);
      } else if (st === 2) {
        if (this.prevState === 1 || this.prevState === 0) this.timer.call(1);
        p.animate(level);
        p.render(rc);
      }
    }
    this.prevState = st;
  }
}

export { A, Actor, ModelSet, Bgnd, type Mat };
