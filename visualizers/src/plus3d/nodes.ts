// The behaviour nodes of plusvis.dll's scenes (the Craniac engine Yule Log shares): small objects wired together by
// pointers to floats, each updated once per Animate in registration order (the list 0x10062d54, appended by
// 0x10018dd0). A node reads its input field and writes through its output pointers; some outputs are another node's
// fields (its input, or its "enabled" flag at +8, which the selector and mixer switch). The port keeps each node's
// fields as the DLL's bytes (a Float32Array and an Int32Array over one buffer, indexed by offset / 4), and output
// pointers as (array, index) pairs, so that values move exactly as in the DLL: float stores round, and an int written
// where a float is read (the camera path index) keeps its bits.
import type { TimedLevel } from '../ns';

const f = Math.fround;
/** _ftol (0x100447a0): truncation toward zero */
export const ftol = (v: number): number => (v > -2147483649 && v < 2147483648 ? Math.trunc(v) : -2147483648);

/** a pointer to a 32-bit cell: f[i] (and the same bytes as an int through u) */
export interface Ref { f: Float32Array; u: Int32Array; i: number }

/** a block of DLL memory: floats and ints over the same bytes */
export class Mem {
  readonly f: Float32Array;
  readonly u: Int32Array;
  constructor(bytes: number) { const b = new ArrayBuffer(bytes); this.f = new Float32Array(b); this.u = new Int32Array(b); }
  ref(off: number): Ref { return { f: this.f, u: this.u, i: off >> 2 }; }
}

/** the scene's globals (0x10062000..0x10063000): dt 0x10062d74, elapsed 0x10062d70, and each preset's own */
export class Globals extends Mem {
  constructor() { super(0x1000); }
  at(addr: number): Ref { return this.ref(addr - 0x10062000); }
  get(addr: number): number { return this.f[(addr - 0x10062000) >> 2]; }
  set(addr: number, v: number): void { this.f[(addr - 0x10062000) >> 2] = v; }
  geti(addr: number): number { return this.u[(addr - 0x10062000) >> 2]; }
  seti(addr: number, v: number): void { this.u[(addr - 0x10062000) >> 2] = v | 0; }
}
export const DT = 0x10062d74, ELAPSED = 0x10062d70;

/** what every node update sees */
export interface NodeCtx { g: Globals; level: TimedLevel | null }

/** a node: its memory (vtable at +0, next at +4, enabled at +8), its update */
export abstract class Node {
  readonly m: Mem;
  constructor(bytes: number) { this.m = new Mem(bytes); this.m.u[2] = 1; }
  get enabled(): boolean { return this.m.u[2] !== 0; }
  /** a pointer to one of this node's fields */
  at(off: number): Ref { return this.m.ref(off); }
  abstract update(c: NodeCtx): void;
}

const put = (r: Ref | null, v: number): void => { if (r) r.f[r.i] = v; };
const get = (r: Ref): number => r.f[r.i];

/** ENERGY (0x24 bytes; init 0x100035f0, update 0x10003680): the summed spectrum bytes of both channels over
 *  [lo, hi] bins (Hz in, bins out: (int)((hz - 20) * 0.0464366786f)), normalised, scaled and offset, times Sens * 0.01.
 *  +0xc out, +0x10 lo, +0x14 hi, +0x18 &Sens (default the constant 100.0 at 0x10058500), +0x1c scale, +0x20 offset */
export class Energy extends Node {
  private out: Ref | null = null;
  private sens: Ref;
  private lo = 0; private hi = 0;
  private static readonly SENS100 = (() => { const m = new Mem(4); m.f[0] = 100; return m.ref(0); })();
  constructor() { super(0x24); this.sens = Energy.SENS100; }
  init(out: Ref, loHz: number, hiHz: number, sens: Ref | null, scale: number, offset: number): this {
    if (loHz < 20) loHz = 20;
    if (hiHz > 22050) hiHz = 20000;
    if (hiHz < loHz) { const t = hiHz; hiHz = loHz; loHz = t; }
    this.out = out; this.m.u[4] = loHz; this.m.u[5] = hiHz; this.m.f[7] = scale; this.m.f[8] = offset;
    if (sens) this.sens = sens;
    // the update converts at use: FILD hz - 20, FMUL 0.0464366786f, _ftol
    this.lo = ftol((loHz - 20) * 0.04643667861819267); this.hi = ftol((hiHz - 20) * 0.04643667861819267);
    return this;
  }
  update(c: NodeCtx): void {
    if (!this.enabled) return;
    let sum = 0;
    // ponytail: the DLL sums rand() noise when it has no levels; WMP always passes them
    const a = c.level!.freq[0], b = c.level!.freq[1];
    for (let i = this.lo; i <= this.hi; i++) sum += a[i] + b[i];
    const n = this.hi - this.lo + 1;
    put(this.out, get(this.sens) * 0.01 * ((sum / (n * 510)) * this.m.f[7] + this.m.f[8]));
  }
}

/** BEAT (0x20; init 0x100018f0, update 0x10001920): a running average of the input (+0xc); an input more than thr
 *  (+0x18) times the average is a beat (out +0x10 = 1, the average restarts at the input), else 0. alpha +0x14 */
export class Beat extends Node {
  private out: Ref | null = null;
  constructor() { super(0x20); }
  init(out: Ref, alpha: number, thr: number): this { this.out = out; this.m.f[5] = alpha; this.m.f[6] = thr; this.m.f[7] = 0; return this; }
  update(): void {
    if (!this.enabled) return;
    const F = this.m.f;
    const v = F[7] * F[5] + (1 - F[5]) * F[3];
    if (F[6] < v / F[7]) { F[7] = F[3]; put(this.out, 1); return; }
    F[7] = v; put(this.out, 0);
  }
}

/** FANOUT (0x1c; init 0x10003250, add 0x10003290, update 0x100032e0): out_k = *in * scale_k + offset_k */
export class Fanout extends Node {
  private input!: Ref;
  private outs: { r: Ref; s: number; o: number }[] = [];
  constructor() { super(0x1c); }
  init(input: Ref, _n: number): this { this.input = input; return this; }
  add(r: Ref, scale: number, offset: number): this { this.outs.push({ r, s: f(scale), o: f(offset) }); return this; }
  update(): void {
    if (!this.enabled) return;
    for (const q of this.outs) put(q.r, get(this.input) * q.s + q.o);
  }
}

/** TEMPO (0x20; init 0x10003190, update 0x100031c0): on a beat (in +0xc > 0.5) it sets the frame's time step to the
 *  one it saw last (+0x18: at creation the dt of that moment, 0 when the scene is made before the first step), keeps
 *  a running average (+0x1c, alpha +0x14) and writes 60 / average (beats per minute) to out (+0x10) */
export class Tempo extends Node {
  private out: Ref | null = null;
  constructor() { super(0x20); }
  init(out: Ref, alpha: number, dtNow: number): this { this.out = out; this.m.f[5] = alpha; this.m.f[6] = dtNow; this.m.f[7] = 0; return this; }
  update(c: NodeCtx): void {
    const F = this.m.f;
    if (!this.enabled || !(0.5 < F[3])) return;
    c.g.set(DT, F[6]);
    const dt = c.g.get(DT);
    F[7] = F[7] * F[5] + (1 - F[5]) * dt;
    F[6] = dt;
    put(this.out, 60 / F[7]);
  }
}

/** ENV (0x40; init 0x10003a70, update 0x10003af0): a repeating envelope over the input time (+0xc) from the time
 *  at creation (+0x38): rise, hold, fall, rest phases of period (+0x18), count (+0x14, 0 = forever), amplitude
 *  (+0x2c) over offset (+0x30) */
export class Env extends Node {
  private out: Ref | null = null;
  constructor() { super(0x40); }
  init(out: Ref, count: number, period: number, a: number, b: number, c: number, d: number, amp: number, off: number, now: number): this {
    const F = this.m.f, U = this.m.u;
    this.out = out; U[5] = count;
    F[7] = period * a; F[6] = period;
    F[11] = amp; F[12] = off;
    const t1 = period * b + period * a; F[8] = t1;
    const t2 = period * c + F[8]; F[9] = t2;
    F[10] = period * d + F[9];
    U[15] = 0; F[14] = now; U[13] = 1;
    return this;
  }
  update(): void {
    const F = this.m.f, U = this.m.u;
    if (!this.enabled || U[13] === 3) return;
    let t = f(F[3] - F[14]);
    while (F[6] < t) { t = f(t - F[6]); U[15]++; }
    if (!(U[15] < U[5] || U[5] === 0)) return;
    if (F[10] < t) { put(this.out, F[12]); return; }
    if (F[9] < t) { put(this.out, (1 - (t - F[9]) / (F[10] - F[9])) * F[11] + F[12]); return; }
    if (F[8] < t) { put(this.out, F[12] + F[11]); return; }
    if (t <= F[7]) { put(this.out, F[12]); return; }
    put(this.out, ((t - F[7]) / (F[8] - F[7])) * F[11] + F[12]);
  }
}

/** VEC3 (0x34; init 0x10003c10, update 0x10003c50): out (+0x18, three floats) = in (+0xc..+0x14) * scale + offset,
 *  per component */
export class Vec3Node extends Node {
  private out!: Ref;
  constructor() { super(0x34); }
  init(out: Ref, scale: readonly number[], offset: readonly number[]): this {
    this.out = out;
    for (let k = 0; k < 3; k++) { this.m.f[7 + k] = scale[k]; this.m.f[10 + k] = offset[k]; }
    return this;
  }
  update(): void {
    if (!this.enabled) return;
    const F = this.m.f, o = this.out;
    o.f[o.i] = F[7] * F[3] + F[10];
    o.f[o.i + 1] = F[8] * F[4] + F[11];
    o.f[o.i + 2] = F[9] * F[5] + F[12];
  }
}

/** SELECT (0x1c; init 0x1000b200, add 0x1000b250, set 0x1000b2c0, update 0x1000b280): every output (an int flag,
 *  in the port the target node's "enabled") cleared, then the one numbered by the input (+0xc, an int) set to 1 */
export class Select extends Node {
  private outs: Ref[] = [];
  constructor() { super(0x1c); }
  init(_n: number): this { return this; }
  add(r: Ref): this { this.outs.push(r); return this; }
  set(k: number, v: number): this { const r = this.outs[k]; r.u[r.i] = v; return this; }
  update(): void {
    if (!this.enabled) return;
    for (const r of this.outs) r.u[r.i] = 0;
    const k = this.m.u[3];
    if (k >= 0 && k < this.outs.length) { const r = this.outs[k]; r.u[r.i] = 1; }
  }
}

/** XFORM1 (0x2c; update 0x10018ed0 -> 0x10018e20): out = (lerp(a, b, clamp(in)) or sin of it) * scale + offset */
export class Xform1 extends Node {
  private out: Ref | null = null;
  constructor() { super(0x2c); }
  init(out: Ref, type: number, a: number, b: number, scale: number, offset: number): this {
    this.out = out; this.m.u[5] = type; this.m.f[7] = a; this.m.f[8] = b; this.m.f[9] = scale; this.m.f[10] = offset; return this;
  }
  update(): void {
    if (!this.enabled) return;
    const F = this.m.f;
    this.m.u[6] = 1;
    let t = F[3] <= 0 ? 0 : F[3];
    if (1 <= t) t = 1;
    t = f(t);
    if (this.m.u[5] === 1) { put(this.out, ((F[8] - F[7]) * t + F[7]) * F[9] + F[10]); return; }
    // ponytail: type 3 (FSIN of the lerp) is not used by any registered node of the three scenes
    put(this.out, t);
  }
}
