// The BEH files: named paths of segments (camera and light paths), parsed by ParseBEH 0x1000acf0 into PATH nodes
// the scenes pick by name. A PATH is a behaviour node: its input (+0xc) is a time, its output (+0x10) a point.
//   PATH <name> LOOP|CLAMP
//     SEG LINEAR p0 p1          (x y z each)
//     SEG SPLINE p0 t0 p1 t1    (Hermite: points and tangents)
//   ENDPATH
import { Node, ftol, type Ref } from './nodes';

const f = Math.fround;
export const CLAMP = 1, LOOP = 2;

/** D3DXVec3Hermite (0x10018ee0), in its x87 order: the four weights h1 (2s^3 - 3s^2 + 1), h2 (s^3 - 2s^2 + s),
 *  h3 (3s^2 - 2s^3) stored as floats, h4 (s^3 - s^2) kept in a register; x summed h1 v1 + h2 t1 + h3 v2 + h4 t2,
 *  y and z in the reverse order */
export function hermite(out: Float32Array, v1: ArrayLike<number>, t1: ArrayLike<number>, v2: ArrayLike<number>, t2: ArrayLike<number>, s: number): void {
  const s2 = s * s, s3 = s * s2, s3x2 = s3 + s3, s2x3 = s2 * 3;
  const h1 = f(s3x2 - s2x3 + 1);
  const h2 = f(s3 - (s2 + s2) + s);
  const h3 = f(s2x3 - s3x2);
  const h4 = s3 - s2;
  out[0] = ((h1 * v1[0] + h2 * t1[0]) + h3 * v2[0]) + h4 * t2[0];
  out[1] = ((h4 * t2[1] + h3 * v2[1]) + h2 * t1[1]) + h1 * v1[1];
  out[2] = ((h4 * t2[2] + h3 * v2[2]) + h2 * t1[2]) + h1 * v1[2];
}

/** SEG (100 bytes; init 0x10001660, evaluate 0x100017c0): type 1 linear (both tangents p1 - p0), 2 spline */
export class Seg {
  type = 0; mode = 0;
  readonly p0 = new Float32Array(3); readonly t0 = new Float32Array(3);
  readonly p1 = new Float32Array(3); readonly t1 = new Float32Array(3);
  readonly scale = new Float32Array([1, 1, 1]); readonly offset = new Float32Array(3);
  private tmp = new Float32Array(3);
  init(type: number, mode: number, a: number[], b: number[], c: number[] | null, d: number[] | null): this {
    this.type = type; this.mode = mode;
    if (type === 1) {
      this.p0.set(a); this.p1.set(b);
      for (let k = 0; k < 3; k++) this.t0[k] = this.p1[k] - this.p0[k];
      this.t1.set(this.t0);
    } else { this.p0.set(a); this.t0.set(b); this.p1.set(c!); this.t1.set(d!); }
    return this;
  }
  evaluate(out: Float32Array, s: number): void {
    if (this.mode === CLAMP) { let x = s <= 0 ? 0 : s; if (1 <= x) x = 1; s = f(x); } else s = f(s - ftol(s));
    if (this.type > 0 && this.type < 3) {
      hermite(this.tmp, this.p0, this.t0, this.p1, this.t1, s);
      for (let k = 0; k < 3; k++) out[k] = this.tmp[k] * this.scale[k] + this.offset[k];
    } else out.set(this.offset);
  }
}

/** PATH (0x40; ctor 0x10001300, init 0x100013c0, finish 0x10001430, evaluate 0x10001480, update 0x10001560):
 *  input time +0xc, output point through +0x10, mode +0x18, segments +0x20 (count +0x1c), scale +0x24, offset +0x30 */
export class Path extends Node {
  out: Ref | null = null;
  segs: Seg[] = [];
  readonly scale = new Float32Array([1, 1, 1]); readonly offset = new Float32Array(3);
  private tmp = new Float32Array(3);
  constructor(readonly name: string, readonly mode: number) { super(0x40); }
  update(): void {
    if (!this.enabled || !this.out) return;
    this.evaluate(this.out, this.m.f[3]);
  }
  /** 0x10001480 */
  evaluate(out: Ref, t: number): void {
    let x: number;
    if (this.mode === CLAMP) { x = t > 0 ? t : 0; if (!(x < 1)) x = 1; } else x = t - ftol(t);
    const n = this.segs.length;
    const y = x * n;
    let i = ftol(y), s: number;
    if (i === n) { i = n - 1; s = 1; } else s = f(y - i);
    this.segs[i].evaluate(this.tmp, s);
    const o = out.f, j = out.i;
    o[j] = this.tmp[0] * this.scale[0] + this.offset[0];
    o[j + 1] = this.tmp[1] * this.scale[1] + this.offset[1];
    o[j + 2] = this.tmp[2] * this.scale[2] + this.offset[2];
  }
}

/** ParseBEH 0x1000acf0: the file's paths, as the DLL's list (each ENDPATH prepends to it) */
export function parseBEH(text: string): Path[] {
  const list: Path[] = [];
  let cur: Path | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const w = t.split(/\s+/);
    if (!cur) {
      if (w[0] !== 'PATH') throw new Error('BEH: syntax error: ' + t);
      const mode = w[2] === 'LOOP' ? LOOP : w[2] === 'CLAMP' ? CLAMP : 0;
      if (!mode) throw new Error('BEH: syntax error: ' + t);
      cur = new Path(w[1], mode);
    } else if (w[0] === 'SEG') {
      const v = w.slice(2).map(Number);
      const s = new Seg();
      if (w[1] === 'LINEAR') s.init(1, cur.mode, v.slice(0, 3), v.slice(3, 6), null, null);
      else if (w[1] === 'SPLINE') s.init(2, cur.mode, v.slice(0, 3), v.slice(3, 6), v.slice(6, 9), v.slice(9, 12));
      else throw new Error('BEH: syntax error: ' + t);
      cur.segs.push(s);
    } else if (w[0] === 'ENDPATH') { list.unshift(cur); cur = null; }
    else throw new Error('BEH: syntax error: ' + t);
  }
  return list;
}

/** 0x10001580: find a path by name (case-insensitively) and take it off the list */
export function takePath(list: Path[], name: string): Path | null {
  const k = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  return k < 0 ? null : list.splice(k, 1)[0];
}
