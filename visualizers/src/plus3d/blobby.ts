// PRESET2, "Maxx's Kingdom" (vtable 0x10051350: Init 0x10012890, Destroy 0x10012950, Animate 0x100130f0, Render
// 0x10012960): the blob of the ANL_BLOBBY vertex-animated series in a sky box, a camera wandering a graph of 27
// spline paths, a light circling with time, its colour from three bands of the spectrum.
import { A, type TimedLevel } from '../ns';
import { CAMERA_GRAPH } from './camgraph';
import { Preset, type Rect4 } from './scene';
import { ModelSet, Actor } from './modelset';
import { Bgnd } from './bgnd';
import { mat, multiply, scaling, translation, transpose } from './math';
import { Beat, DT, ELAPSED, Energy, Env, Fanout, Select, Tempo, Vec3Node, ftol, type Ref } from './nodes';
import type { Path } from './beh';

const f = Math.fround;
const V3_SCALE = [-1, -1, -1], V3_OFFSET = [0, 0, 0];

/** what PRESET1 (Munch's Oddysee, ./munch.ts) does differently from PRESET2 */
export interface BlobbyCfg {
  base: number;             // the preset's globals, from its sensitivity
  anl: string; beh: string; bgnd: string;
  move: [number, number, number]; scale: number;   // CreateScene's translation and scale (float bits)
  colourScale: number;      // the colour energies' scale
  clear: number;
  munch: boolean;
}
const BLOBBY: BlobbyCfg = { base: 0x100626c8, anl: 'ANL_BLOBBY', beh: 'BEH_BLOBBY', bgnd: 'BLOBBY',
  move: [0x3e428f5c, 0xc1a8e148, 0xbf1c28f6], scale: 0x3b93459c, colourScale: 3, clear: 0xff5def4e | 0, munch: false };

export class Blobby extends Preset {
  protected cfg = BLOBBY;
  // the preset's globals (PRESET2's at 0x100626c8, PRESET1's at 0x10062440: the same layout)
  protected get SENS(): number { return this.cfg.base; }
  protected get CAM_IDX(): number { return this.cfg.base + 8; }
  protected get LIGHT(): number { return this.cfg.base + 0x10; }
  protected get EYE(): number { return this.cfg.base + 0x128; }
  protected get COLOUR(): number { return this.cfg.base + 0x138; }
  protected get CIRCLE(): number { return this.cfg.base + 0x148; }
  protected get CAM_T(): number { return this.cfg.base + 0x164; }
  protected get BEAT(): number { return this.cfg.base + 0x168; }
  protected get BPM(): number { return this.cfg.base + 0x16c; }
  sens = 100;
  private shuffle: number[] = [];       // 0x10062824, index 0x10062828
  private shuffleIdx = 0;
  private seriesTimer = 7;              // 0x1005c084
  private clearColour = 0;              // 0x100625b0

  /** Init 0x10012890 */
  init(): void {
    const G = this.g;
    G.set(this.SENS, this.sens);
    this.createScene();
    const n = this.set.series.length;
    this.shuffle = new Array<number>(n);
    shuffleSeries(this.shuffle, n);
    this.shuffleIdx = 0;
    A.srand(this.time());
  }

  /** CreateScene 0x100132a0 */
  private createScene(): void {
    const G = this.g;
    G.set(this.CIRCLE, 0); G.set(this.CIRCLE + 4, 0); G.set(this.CIRCLE + 8, 0);
    G.set(this.LIGHT, 1); G.set(this.LIGHT + 4, -0.5); G.set(this.LIGHT + 8, -1);
    for (let k = 0; k < 4; k++) G.set(this.COLOUR + k * 4, 1);
    G.set(this.EYE, 0); G.set(this.EYE + 4, 1); G.set(this.EYE + 8, 1);
    this.set = new ModelSet();
    this.set.load(this.c, this.cfg.anl);
    const m = mat(), s = mat(), t = mat();
    translation(m, bitsF(this.cfg.move[0]), bitsF(this.cfg.move[1]), bitsF(this.cfg.move[2]));
    const k = bitsF(this.cfg.scale);
    scaling(s, k, k, k);
    multiply(m, m, s);
    if (this.cfg === BLOBBY) { translation(t, 0, 0, 0); multiply(m, m, t); }
    this.set.transformModels(m);
    this.actor = new Actor(this.set);
    this.actor.init(this.dev);
    this.bgnd = new Bgnd();
    this.bgnd.init(3, bitsF(0x40266666), this.cfg.bgnd);
    this.createVideoResources();
    this.loadPaths(this.cfg.beh);
    this.behaviours();
    G.seti(this.CAM_IDX, 0);
  }

  /** CreateVideoResources 0x10013590 */
  private createVideoResources(): void {
    this.setupCamera();
    this.light(this.COLOUR, this.LIGHT);
    this.fontRestore();
    this.set.createVideoResources(this.dev);
    this.actor.createVideoResources(this.dev);
    this.bgnd.createVideoResources(this.c);
    this.active = true;
  }

  /** 0x10013840 */
  private releaseVideoResources(): void {
    this.active = false;
    this.bgnd.release();
    this.set.releaseVideoResources(this.dev);
    this.fontRelease();
  }

  /** SetupCamera 0x10015130: the eye looking at (0, 0.3, 0); 60 degrees, the viewport's aspect, 0.01 .. 27.5 */
  private setupCamera(): void { this.camera(this.g.f.subarray((this.EYE - 0x10062000) >> 2, ((this.EYE - 0x10062000) >> 2) + 3), AT, UP, bitsF(0x3f860a92), 27.5); }

  /** the behaviour graph 0x100139e0 (registration order) */
  private behaviours(): void {
    const G = this.g;
    const sens = G.at(this.SENS);
    const beat = new Beat(), tempo = new Tempo(), foA = new Fanout(), foB = new Fanout(), env = new Env();
    const foC = new Fanout(), foD = new Fanout(), e9 = new Energy(), v3 = new Vec3Node();
    const e13 = new Energy(), e14 = new Energy(), e15 = new Energy(), foE = new Fanout(), foF = new Fanout(), sel = new Select();
    const unused = (): Ref => G.at(0x10062ffc);          // outputs into objects nothing reads (MIXER, XFORM1 inputs)
    const circle = this.path('CircleXY');
    const cams: Path[] = [];
    for (let k = 0; k < 27; k++) cams.push(this.path('CamPath' + String(k).padStart(2, '0')));
    this.reg(new Energy().init(beat.at(0xc), 20, 500, sens, 1, 0));
    this.reg(beat.init(G.at(this.BEAT), f(0.3), f(1.15)));
    this.reg(foA.init(G.at(this.BEAT), 1).add(tempo.at(0xc), 1, 0));
    this.reg(tempo.init(G.at(this.BPM), f(0.3), G.get(DT)));
    this.reg(foB.init(G.at(ELAPSED), 10).add(circle.at(0xc), f(0.25), 0).add(env.at(0xc), 1, 0));
    this.reg(env.init(unused(), 0, 5, f(0.95), 0, f(0.05), 0, 1, 0, G.get(ELAPSED)));
    circle.out = G.at(this.CIRCLE); this.reg(circle);
    this.reg(foC.init(G.at(this.CIRCLE), 1).add(v3.at(0xc), 1, 0));
    this.reg(foD.init(G.at(this.CIRCLE + 4), 10).add(v3.at(0x10), 1, 0));
    this.reg(e9.init(unused(), 20, 22050, sens, 10, 0));
    v3.m.f[5] = 0.5;
    this.reg(v3.init(G.at(this.LIGHT), V3_SCALE, V3_OFFSET));
    this.reg(e13.init(G.at(this.COLOUR + 8), 10000, 15000, sens, this.cfg.colourScale, 0));
    this.reg(e14.init(G.at(this.COLOUR + 4), 5000, 10000, sens, this.cfg.colourScale, 0));
    this.reg(e15.init(G.at(this.COLOUR), 20, 5000, sens, this.cfg.colourScale, 0));
    foE.init(G.at(this.CAM_T), 30);
    cams.forEach((p, k) => foE.add(p.at(0xc), f(1 / CAMERA_GRAPH[k].time), 0));
    this.reg(foE);
    this.reg(foF.init(G.at(this.CAM_IDX), 1).add(sel.at(0xc), 1, 0));
    sel.init(27);
    for (const p of cams) sel.add(p.at(8));
    sel.set(0, 1);
    this.reg(sel);
    for (const p of cams) { p.out = G.at(this.EYE); this.reg(p); }
    this.reg(new Energy().init(this.actor.speedMem.ref(0), 50, 22050, sens, 1, 0));
  }

  /** Animate 0x100130f0 */
  animate(level: TimedLevel): void {
    this.runNodes(level);
    this.walkCamera(CAMERA_GRAPH, this.CAM_T, this.CAM_IDX);
    const G = this.g;
    this.seriesTimer = f(this.seriesTimer - G.get(DT));
    if (this.seriesTimer < 0) {
      this.seriesTimer = f(this.seriesTimer + 7);
      this.shuffleIdx++;
      const n = this.set.series.length;
      if (this.shuffleIdx >= n) { shuffleSeries(this.shuffle, n); this.shuffleIdx = 0; }
      this.actor.next = this.shuffle[this.shuffleIdx];
    }
    if (this.active) this.actor.animate(this.dev, G.get(DT));
    this.clearColour = this.cfg.clear;
  }

  /** Render 0x10012960 */
  render(rc: Rect4): void {
    const dev = this.dev;
    if (rc.right - rc.left !== this.rect.right - this.rect.left || rc.bottom - rc.top !== this.rect.bottom - this.rect.top) {
      this.releaseVideoResources();
      this.resetDevice(rc.right - rc.left, rc.bottom - rc.top);
      this.createVideoResources();
      this.rect = { ...rc };
      return;
    }
    this.setupCamera();
    if (!this.active) return;
    const G = this.g;
    dev.beginScene();
    dev.clear(null, 3, this.clearColour, 1, 0);
    dev.setTransform(2, this.view);
    this.stack.loadIdentity();
    dev.setTransform(256, this.stack.top()); this.world.set(this.stack.top());
    dev.setVertexShaderConstant(20, new Float32Array([G.get(this.LIGHT), G.get(this.LIGHT + 4), G.get(this.LIGHT + 8), 0]), 1);
    dev.setVertexShaderConstant(21, G.f.subarray((this.COLOUR - 0x10062000) >> 2, ((this.COLOUR - 0x10062000) >> 2) + 4), 1);
    dev.setVertexShaderConstant(27, new Float32Array([0, 0.5, 1, f(0.2)]), 1);
    dev.setVertexShaderConstant(28, new Float32Array([2, f(Math.PI), f(Math.E), 10]), 1);
    // c26 = the eye; its w is whatever follows it in memory (the CD3DFont's address): unused by the shaders
    dev.setVertexShaderConstant(26, new Float32Array([G.get(this.EYE), G.get(this.EYE + 4), G.get(this.EYE + 8), 0]), 1);
    dev.setVertexShaderConstant(4, transpose(mat(), multiply(mat(), this.view, this.proj)), 4);
    // PRESET1 draws its sky box z-tested and clamped (border addressing), the character alpha-blended
    const z = this.cfg.munch ? 1 : 0, addr = this.cfg.munch ? 4 : 1;
    for (const [s, v] of [[7, z], [23, 4], [14, z], [8, 3], [137, 0], [22, 2], [143, 1], [141, 0]]) dev.setRenderState(s, v);
    for (const [t, v] of [[13, addr], [14, addr], [17, 2], [16, 2], [18, 2]]) dev.setTextureStageState(0, t, v);
    for (const [s, v] of [[29, 1 - z], [27, 0], [19, 5], [20, 6]]) dev.setRenderState(s, v);
    for (const [t, v] of [[1, 4], [2, 2], [3, 0], [4, 1], [5, 2], [6, 0]]) dev.setTextureStageState(0, t, v);
    if (this.cfg.munch) {
      dev.setRenderState(27, 0);
      this.bgnd.draw(dev);
    } else {
      this.stack.push();
      this.stack.translateLocal(0, bitsF(0xbd8f21e8), 0);
      dev.setTransform(256, this.stack.top()); this.world.set(this.stack.top());
      this.bgnd.draw(dev);
      this.stack.pop();
      dev.setTransform(256, this.stack.top()); this.world.set(this.stack.top());
    }
    if (this.actor.inst0) {
      dev.setVertexShaderConstant(16, new Float32Array([1, 1, 1, 1]), 1);
      dev.setVertexShaderConstant(17, new Float32Array([f(0.2), f(0.2), f(0.2), 1]), 1);
      dev.setVertexShaderConstant(18, new Float32Array([1, 1, 1, 1]), 1);
      dev.setVertexShaderConstant(19, new Float32Array([0, 0, 0, 100]), 1);
      if (this.cfg.munch) {
        dev.setTextureStageState(0, 13, 1); dev.setTextureStageState(0, 14, 1);
        dev.setRenderState(27, 1);
        dev.setTextureStageState(0, 4, 0xd); dev.setTextureStageState(0, 5, 2); dev.setTextureStageState(0, 6, 1);
      } else {
        dev.setRenderState(7, 1); dev.setRenderState(14, 1);
        dev.setTextureStageState(0, 13, 1); dev.setTextureStageState(0, 14, 1);
      }
      this.actor.draw(this.drawCtx, this.stack);
    }
    dev.endScene();
    dev.present();
  }
}
const AT = new Float32Array([0, f(0.3), 0]), UP = new Float32Array([0, 1, 0]);
const BF = new Float32Array(1), BU = new Uint32Array(BF.buffer);
/** a float constant by its bits */
export function bitsF(u: number): number { BU[0] = u; return BF[0]; }

/** the series shuffle (0x10015210): Fisher-Yates from the front, j = i - (int)(rand * ((n - 1 + 0.999999) - i) *
 *  -1/32767) */
export function shuffleSeries(t: number[], n: number): void {
  for (let i = 0; i < n; i++) t[i] = i;
  const m = n - 1, K = m + 0.999999;
  for (let i = 0; i < m; i++) {
    const r = A.rand();
    const j = i - ftol((r * (K - i)) * -3.0518509475997192e-05);
    const a = t[i]; t[i] = t[j]; t[j] = a;
  }
}

export { ModelSet, Actor, Bgnd };
