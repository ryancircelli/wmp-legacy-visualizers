// PRESET3, "Undersea Wonders" (vtable 0x10051364: Init 0x100153d0, Destroy 0x10015450, Animate 0x10015db0, Render
// 0x10015460): NumObjs jellyfish (the ANL_JELLY vertex series, each its own ACTOR in a CHARACTER that drifts and
// bounces in a box and spins with the music), drawn additively in a lit sky box, a camera wandering 16 paths.
import { A, type TimedLevel } from '../ns';
import { JELLY_GRAPH } from './camgraph';
import { Preset, type Rect4 } from './scene';
import { ModelSet, Actor } from './modelset';
import { Bgnd } from './bgnd';
import { mat, multiply, rotationY, scaling, translation, transpose, vec3Normalize } from './math';
import { Beat, DT, Energy, Fanout, Select, Tempo } from './nodes';
import { bitsF } from './blobby';
import type { Path } from './beh';

const f = Math.fround;
// PRESET3's globals
const ANL = 'ANL_JELLY', LIGHT = 0x10062960, SENS = 0x10062950, EYE = 0x10062a78, COLOUR = 0x10062a88, CAM_T = 0x10062ab0;
const BEAT = 0x10062ab4, BPM = 0x10062ab8, SPEED = 0x10062abc, CAM_IDX = 0x10062958, ANGLE = 0x10062ac0;

/** CHARACTER (0x1c bytes): velocity, position, the ACTOR */
class Character {
  v = new Float32Array(3);
  p = new Float32Array(3);
  constructor(readonly actor: Actor) {}
  /** 0x10017cc0 */
  init(): void {
    this.v[0] = A.rand() * 3.0518509475997192e-06 - 0.05;
    this.v[1] = (A.rand() * 9.1555528427991577e-07 - 0.015) + 0.05;
    this.v[2] = A.rand() * 3.0518509475997192e-06 - 0.05;
    this.p[0] = A.rand() * 6.1037018951994385e-05 - 1;
    this.p[2] = A.rand() * 6.1037018951994385e-05 - 1;
    this.p[1] = A.rand() * 0.00012359996337778863 - 2.05;
  }
}

export class Jelly extends Preset {
  sens = 100;
  numObjs = 2;
  private chars: Character[] = [];          // +0x14 .. (created +0x1a4, active +0x1a8)
  private active2 = 0;
  private speeds!: Fanout;                  // +0x1ac
  private clearColour = 0;                  // 0x10062838

  /** Init 0x100153d0 */
  init(): void {
    this.g.set(SENS, this.sens);
    this.createScene();
    A.srand(this.time());
  }

  /** CreateScene 0x10016130 */
  private createScene(): void {
    const G = this.g;
    G.set(LIGHT, 1); G.set(LIGHT + 4, -0.5); G.set(LIGHT + 8, -1);
    for (let k = 0; k < 4; k++) G.set(COLOUR + k * 4, 1);
    G.set(EYE, 0); G.set(EYE + 4, 1); G.set(EYE + 8, 1);
    this.set = new ModelSet();
    this.set.load(this.c, ANL);
    const m = mat(), s = mat();
    translation(m, bitsF(0x42c66666), bitsF(0x432ae666), bitsF(0xc086147b));
    const k = f((((A.rand() * 9.155552842799156e-06) + 0.85) * 0.45) * 0.002570694087403599);
    scaling(s, k, k, k);
    multiply(m, m, s);
    this.set.transformModels(m);
    for (let i = 0; i < this.numObjs; i++) {
      const a = new Actor(this.set);
      a.init(this.dev);
      const c = new Character(a);
      c.init();
      this.chars.push(c);
    }
    this.active2 = this.numObjs;
    this.bgnd = new Bgnd();
    this.bgnd.init(3, 0, 'jelly');
    this.createVideoResources();
    this.loadPaths('BEH_JELLY');
    this.behaviours();
  }

  /** CreateVideoResources 0x10016430 */
  private createVideoResources(): void {
    this.setupCamera();
    this.jellyLight();
    this.fontRestore();
    this.set.createVideoResources(this.dev);
    for (const c of this.chars) c.actor.createVideoResources(this.dev);
    this.bgnd.createVideoResources(this.c);
    this.active = true;
  }

  /** 0x10016740 */
  private releaseVideoResources(): void {
    this.active = false;
    this.set.releaseVideoResources(this.dev);
    this.bgnd.release();
    this.fontRelease();
  }

  /** SetupCamera 0x10017b90: the eye at 1.5 times the eye path's point looking at the origin (up = the point's
   *  horizontal opposite when it is high); 45 degrees, 0.01 .. 10 */
  private setupCamera(): void {
    const G = this.g;
    const x = G.get(EYE), y = G.get(EYE + 4), z = G.get(EYE + 8);
    const up = y <= 0.5 ? [0, 1, 0] : [-x, 0, -z];
    EYE15[0] = x * 1.5; EYE15[1] = y * 1.5; EYE15[2] = z * 1.5;
    this.camera(EYE15, ORIGIN, up, bitsF(0x3f490fdb), 10);
  }

  /** 0x100167f0: ambient 0x101010, lighting on, a white directional light (ambient 0.2) along the light direction
   *  (copied, then normalised in place) */
  private jellyLight(): void {
    const dev = this.dev, G = this.g;
    dev.setRenderState(139, 0x101010);
    dev.setRenderState(137, 1);
    const L = new ArrayBuffer(104), lf = new Float32Array(L), li = new Uint32Array(L);
    li[0] = 3;
    lf[1] = 1; lf[2] = 1; lf[3] = 1; lf[4] = 1;
    lf[5] = 1; lf[6] = 1; lf[7] = 1;
    lf[9] = f(0.2); lf[10] = f(0.2); lf[11] = f(0.2);
    for (let k = 0; k < 3; k++) lf[16 + k] = G.get(LIGHT + k * 4);
    const d = G.at(LIGHT), v = d.f.subarray(d.i, d.i + 3);
    vec3NormalizeInPlace(v);
    dev.setLight(0, L);
    dev.lightEnable(0, true);
  }

  /** the behaviour graph 0x100168f0 (registration order) */
  private behaviours(): void {
    const G = this.g;
    const sens = G.at(SENS);
    const beat = new Beat(), foA = new Fanout(), tempo = new Tempo();
    const foB = new Fanout(), foC = new Fanout(), sel = new Select();
    this.speeds = new Fanout();
    const cams: Path[] = [];
    for (let k = 0; k < 16; k++) cams.push(this.path('CamPath' + String(k).padStart(2, '0')));
    this.reg(new Energy().init(beat.at(0xc), 20, 500, sens, 1, 0));
    this.reg(beat.init(G.at(BEAT), f(0.3), f(1.15)));
    this.reg(foA.init(G.at(BEAT), 1).add(tempo.at(0xc), 1, 0));
    this.reg(tempo.init(G.at(BPM), f(0.3), G.get(DT)));
    this.reg(new Energy().init(G.at(COLOUR), 20, 5000, sens, 1, 0));
    this.reg(new Energy().init(G.at(COLOUR + 4), 5000, 10000, sens, 1, 0));
    this.reg(new Energy().init(G.at(COLOUR + 8), 10000, 15000, sens, 1, 0));
    foB.init(G.at(CAM_T), 20);
    this.reg(foB);
    cams.forEach((p, k) => foB.add(p.at(0xc), f(1 / JELLY_GRAPH[k].time), 0));
    this.reg(foC.init(G.at(CAM_IDX), 1).add(sel.at(0xc), 1, 0));
    sel.init(16);
    for (const p of cams) sel.add(p.at(8));
    sel.set(0, 1);
    this.reg(sel);
    for (const p of cams) { p.out = G.at(EYE); this.reg(p); }
    this.reg(new Energy().init(G.at(SPEED), 50, 22050, sens, 1, 0));
    this.reg(this.speeds.init(G.at(SPEED), 100));
    for (const c of this.chars) this.speeds.add(c.actor.speedMem.ref(0), f(A.rand() * 3.814813684499649e-05 + 1.25), 0);
  }

  /** Animate 0x10015db0 */
  animate(level: TimedLevel): void {
    this.runNodes(level);
    this.walkCamera(JELLY_GRAPH, CAM_T, CAM_IDX);
    const G = this.g;
    if (this.active) {
      for (let i = 0; i < this.active2; i++) {
        const c = this.chars[i], a = c.actor, v = c.v, p = c.p;
        const ang = a.speed * 20 + G.get(ANGLE);
        G.set(ANGLE, ang);
        if (!(ang < 360)) G.set(ANGLE, G.get(ANGLE) - 360);
        rotationY(a.matrix, f(G.get(ANGLE) * bitsF(0x3c8efa35)));
        const x = v[0] + p[0]; p[0] = x;
        const y = f(p[1] + v[1]); p[1] = y;
        const z = f(v[2] + p[2]); p[2] = z;
        if (x < -1) { v[0] = v[0] * -1; p[0] = (-1 - p[0]) - 1; }
        if (p[0] > 1) { v[0] = v[0] * -1; p[0] = 1 - (p[0] - 1); }
        if (z < -1) { v[2] = v[2] * -1; p[2] = (-1 - p[2]) - 1; }
        if (p[2] > 1) { v[2] = v[2] * -1; p[2] = 1 - (p[2] - 1); }
        if (y < -2.1 || y > 1.1) {
          p[0] = A.rand() * 6.1037018951994385e-05 - 1;
          const r = A.rand();
          p[1] = bitsF(0xc0033333);
          p[2] = r * 6.1037018951994385e-05 - 1;
          v[0] = A.rand() * 3.0518509475997192e-06 - 0.05;
          v[1] = (A.rand() * 3.3570360423596916e-06 - 0.04) + 0.05;
          v[2] = A.rand() * 3.0518509475997192e-06 - 0.05;
        }
        a.matrix[12] = p[0]; a.matrix[13] = p[1]; a.matrix[14] = p[2];
        if (a.speed < 0.02) a.speedMem.f[0] = bitsF(0x3dcccccd);
        a.animate(this.dev, G.get(DT));
      }
    }
    this.clearColour = 0xff000000 | 0;
  }

  /** Render 0x10015460 */
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
    this.active2 = this.numObjs;
    if (!this.active) return;
    const G = this.g;
    dev.beginScene();
    dev.clear(null, 3, this.clearColour, 1, 0);
    dev.setTransform(2, this.view);
    this.stack.loadIdentity();
    dev.setTransform(256, this.stack.top()); this.world.set(this.stack.top());
    dev.setVertexShaderConstant(20, new Float32Array([G.get(LIGHT), G.get(LIGHT + 4), G.get(LIGHT + 8), 0]), 1);
    dev.setVertexShaderConstant(21, G.f.subarray((COLOUR - 0x10062000) >> 2, ((COLOUR - 0x10062000) >> 2) + 4), 1);
    dev.setVertexShaderConstant(27, new Float32Array([0, 0.5, 1, f(0.2)]), 1);
    dev.setVertexShaderConstant(28, new Float32Array([2, f(Math.PI), f(Math.E), 10]), 1);
    // c26 = the eye path's point; its w is the CD3DFont's address: unused by the shaders
    dev.setVertexShaderConstant(26, new Float32Array([G.get(EYE), G.get(EYE + 4), G.get(EYE + 8), 0]), 1);
    dev.setVertexShaderConstant(16, new Float32Array([0.75, 0.75, 1, 1]), 1);
    dev.setVertexShaderConstant(17, new Float32Array([bitsF(0x3e19999a), bitsF(0x3e19999a), bitsF(0x3e4ccccd), 1]), 1);
    dev.setVertexShaderConstant(18, new Float32Array([1, 1, 1, 1]), 1);
    dev.setVertexShaderConstant(19, new Float32Array([0, 0, 0, 100]), 1);
    dev.setVertexShaderConstant(4, transpose(mat(), multiply(mat(), this.view, this.proj)), 4);
    for (const [s, v] of [[7, 1], [23, 4], [14, 1], [8, 3], [143, 1], [22, 1], [137, 1], [141, 1]]) dev.setRenderState(s, v);
    for (const [t, v] of [[13, 1], [14, 1], [17, 2], [16, 2], [18, 0], [1, 2], [2, 2]]) dev.setTextureStageState(0, t, v);
    dev.setRenderState(29, 0); dev.setRenderState(27, 0);
    dev.setTextureStageState(0, 4, 1);
    this.jellyLight();
    this.bgnd.draw(dev);
    for (const [s, v] of [[7, 0], [23, 4], [14, 0], [8, 3], [143, 1], [22, 1], [137, 0], [141, 0]]) dev.setRenderState(s, v);
    for (const [t, v] of [[13, 1], [14, 1], [17, 2], [16, 2], [18, 2], [1, 12], [2, 0], [3, 1]]) dev.setTextureStageState(0, t, v);
    for (const [s, v] of [[29, 1], [27, 1], [19, 5], [20, 2]]) dev.setRenderState(s, v);
    for (const [t, v] of [[4, 16], [5, 2], [6, 1]]) dev.setTextureStageState(0, t, v);
    for (let i = 0; i < this.active2; i++) {
      this.stack.push();
      this.chars[i].actor.draw(this.drawCtx, this.stack);
      this.stack.pop();
      dev.setTransform(256, this.stack.top()); this.world.set(this.stack.top());
    }
    dev.endScene();
    dev.present();
  }
}
const EYE15 = new Float32Array(3), ORIGIN = new Float32Array(3);
function vec3NormalizeInPlace(v: Float32Array): void { vec3Normalize(v, v); }

export { ModelSet, Actor, Bgnd };
