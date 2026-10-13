// MODELSET (0xa3bc bytes; ctor 0x10005820, Load 0x10005980, ParseANL 0x10005c90, SetSeries 0x100063b0, Animate
// 0x100067a0, CreateVideoResources 0x100066e0, release 0x10006760) and ACTOR (0x68; 0x10001000 .. 0x10001270): the
// models an ANL file names, grouped in animation series, and the one actor that plays them.
//   ANL:  <name>
//         Vertex | Matrix
//         Vertex: "<series> <seconds>" lines, each the keyframes <series>0000, <series>0001, ... (XFILE resources)
//         Matrix: the model's XFILE, then one animation XFILE per series
import type { Device } from '../d3d8/api';
import { mat, multiply, type Mat } from '../yule/math';
import { MatrixStack } from '../yule/d3dx';
import { Model, type DrawCtx, type LoadCtx, type ShaderSlot } from './model';
import { DECLARATION, shaderTokens } from './shaders';
import { ftol, Mem } from './nodes';
import { animateFrames, bindFrames, freezeFrames } from './anim';

const f = Math.fround;

export const MATRIX = 0, VERTEX = 1;

interface Series { anim: Model | null; start: number; count: number; time: number }

export class ModelSet {
  name = '';
  type = -1;                                         // +0x100
  models: Model[] = [];                              // +0x104 (count +0x9d44)
  series: Series[] = [];                             // +0x9d48 (count +0xa388)
  readonly S: ShaderSlot = { handle: -1 };           // +0xa38c
  readonly NS: ShaderSlot = { handle: -1 };          // +0xa3a4
  private fns: [Uint32Array, Uint32Array] | null = null;

  /** Load 0x10005980: ParseANL, then the two shaders' tokens (VSO_<name>S, VSO_<name>NS) */
  load(c: LoadCtx, anl: string): void {
    this.parseANL(c, c.assets.text[anl]);
    this.fns = shaderTokens(this.name.toUpperCase(), c.assets.shaderComments);
  }

  /** ParseANL 0x10005c90 */
  private parseANL(c: LoadCtx, text: string): void {
    let state = 0;
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      const w = t.split(/\s+/);
      if (state === 0) { this.name = w[0]; state = 1; }
      else if (state === 1) {
        if (w[0].toLowerCase() === 'matrix') { this.type = MATRIX; state = 2; }
        else if (w[0].toLowerCase() === 'vertex') { this.type = VERTEX; state = 4; }
        else throw new Error('ANL: illegal animation type ' + w[0]);
      } else if (state === 2) {
        this.models.push(this.newModel().load(c, w[0], this.xfile(c, w[0])));
        state = 3;
      } else if (state === 3) {
        const m = this.newModel().load(c, w[0], this.xfile(c, w[0]));
        this.series.push({ anim: m, start: this.models.length - 1, count: 1, time: 0 });
      } else {
        const time = f(parseFloat(w[1]));
        const start = this.models.length;
        for (let k = 0; ; k++) {
          const name = w[0] + String(k).padStart(4, '0');
          const x = c.assets.xfiles[name.toUpperCase()];
          if (!x) break;
          const m = this.newModel().load(c, name, x);
          m.period = time;
          this.models.push(m);
        }
        if (this.models.length === start) throw new Error('ANL: invalid anim series ' + w[0]);
        this.series.push({ anim: null, start, count: this.models.length - start, time });
      }
    }
  }

  private newModel(): Model { return new Model(this.S, this.NS); }
  private xfile(c: LoadCtx, name: string) {
    const x = c.assets.xfiles[name.toUpperCase()];
    if (!x) throw new Error('ANL: no model ' + name);
    return x;
  }

  /** 0x10006890: every model's root frame = root * m (and its copy at +0x98) */
  transformModels(m: Mat): void {
    for (const md of this.models) { multiply(md.root.local, md.root.local, m); md.root.orig.set(md.root.local); }
  }

  /** 0x100066e0 / 0x10006700: the two vertex shaders, S then NS */
  createVideoResources(dev: Device): void {
    this.S.handle = dev.createVertexShader(DECLARATION, this.fns![0], 0);
    this.NS.handle = dev.createVertexShader(DECLARATION, this.fns![1], 0);
  }

  /** 0x10006760 */
  releaseVideoResources(dev: Device): void {
    for (const s of [this.S, this.NS]) if (s.handle !== -1) { dev.deleteVertexShader(s.handle); s.handle = -1; }
  }

  /** SetSeries 0x100063b0: the first time, instance 0 = a clone of the series' model and (vertex series) instance 1 =
   *  a clone of instance 0, or (matrix series) the animation model's frames bound to instance 0's and instance 1 =
   *  its first keys (the blend model). Later (matrix series only) the current animation's pose at t is frozen into
   *  instance 1 and the new animation bound. */
  setSeries(dev: Device, k: number, a: Actor, t: number): void {
    if (a.inst0) {
      if (!a.anim) return;
      a.anim.t = t;                                                   // 0x10004e90
      freezeFrames(a.anim.root, t, a.inst1!.root);
      this.bind(a, k);
      return;
    }
    const s = this.series[k];
    a.inst0 = this.models[s.start].clone(dev);
    a.anim = s.anim;
    if (!a.anim) { a.inst1 = a.inst0.clone(dev); return; }
    this.bind(a, k);
    a.inst1 = a.anim.cloneKeys();
  }

  private bind(a: Actor, k: number): void {
    const anim = this.series[k].anim!;
    a.anim = anim;
    a.inst0!.period = anim.period;
    bindFrames(anim.root, a.inst0!.root);
  }

  /** Animate 0x100067a0: a matrix series' animation model sets instance 0's frames at t (0x100041e0), blending from
   *  `other`'s keys; a vertex series' instance 0 = the keyframes around t, or a blend from `other` into the series'
   *  first keyframe over half a second */
  animate(inst0: Model, anim: Model | null, other: Model | null, t: number, k: number): void {
    if (this.type === MATRIX) {
      if (!anim) return;
      anim.t = t > 1e15 ? 0 : t;
      animateFrames(anim.root, anim.t, anim, other ? other.root : null);
      return;
    }
    if (this.type !== VERTEX) return;
    const s = this.series[k];
    if (s.count <= 1) return;
    if (!other) {
      const tm = t % s.time;
      const seg = s.time / (s.count - 1);
      const i = ftol(tm / seg);
      inst0.interpolate(this.models[s.start + i], this.models[s.start + i + 1], f((tm - i * seg) / seg));
    } else {
      inst0.interpolate(other, this.models[s.start], f((t % 0.5) * 2));
    }
  }
}

/** ACTOR (0x68 bytes) */
export class Actor {
  /** +0x00 speed, an ENERGY node's output */
  readonly speedMem = new Mem(4);
  get speed(): number { return this.speedMem.f[0]; }
  t = 0;                     // +0x04
  t2 = 0;                    // +0x08
  matrix = mat();            // +0x0c
  blend = 0;                 // +0x4c
  inst0: Model | null = null;   // +0x50
  anim: Model | null = null;    // +0x54
  inst1: Model | null = null;   // +0x58
  next = 0;                  // +0x60
  cur = -1;                  // +0x64
  constructor(readonly set: ModelSet) {}

  /** 0x100010b0 */
  init(dev: Device): void {
    this.next = 0; this.cur = 0;
    this.set.setSeries(dev, 0, this, 0);
  }

  /** 0x10001130: instance 0's dynamic vertex buffers */
  createVideoResources(dev: Device): void { if (this.inst0) this.inst0.createVideoResources(dev); }

  /** ACTOR::Animate 0x10001160 */
  animate(dev: Device, dt: number): void {
    this.t2 = f(dt * this.speed * 30 + this.t2);
    const tv = dt * this.speed * 30 + this.t;
    let tt = f(tv);
    this.t = tt;
    const per = this.inst0!.period;
    tt = f(tv < 0 ? per - (-tt % per) : tt % per);
    if (this.next !== this.cur && tt < 0.1) {
      this.set.setSeries(dev, this.next, this, tt);
      this.blend = 1; this.t = 0; this.cur = this.next;
    }
    let other: Model | null = null;
    if (this.blend) {
      if (Math.abs(this.t) < 0.5) other = this.inst1;
      else { this.blend = 0; this.t = 0; tt = 0; }
    }
    this.set.animate(this.inst0!, this.anim, other, tt, this.cur);
  }

  /** ACTOR::Draw 0x10001270 */
  draw(s: DrawCtx, stack: MatrixStack): void {
    stack.push();
    stack.multMatrixLocal(this.matrix);
    s.dev.setTransform(256, stack.top()); s.world.set(stack.top());
    this.inst0!.draw(s, stack.top().slice());
    stack.pop();
    s.dev.setTransform(256, stack.top()); s.world.set(stack.top());
  }
}

