// A small assembler for Direct3D 9 shader token streams (vs_1_1, ps_1_x, ps_2_0): the Psychedelia DLLs compile
// HLSL effects with D3DX at run time; the ports write the compiled programs out as instructions here and hand the
// device the same token stream (debug comment blocks aside, which the device ignores).

export const enum Reg { R = 0, V = 1, C = 2, T = 3, RASTOUT = 4, ATTROUT = 5, OT = 6, OC = 8, S = 10 }
export const enum Op {
  MOV = 1, ADD = 2, SUB = 3, MAD = 4, MUL = 5, RCP = 6, RSQ = 7, DP3 = 8, DP4 = 9, MIN = 10, MAX = 11, SLT = 12, SGE = 13,
  LRP = 18, FRC = 19, DCL = 31, POW = 32, ABS = 35, NRM = 36, TEX = 66, DEF = 81, CMP = 88,
}
/** D3DDECLUSAGE */
export const enum Usage { POSITION = 0, NORMAL = 3, TEXCOORD = 5, COLOR = 10 }

export interface Dst { t: Reg; n: number; mask: number; mod: number }
export interface Src { t: Reg; n: number; sw: number; neg: boolean }

const regBits = (t: Reg, n: number): number => ((t & 7) << 28) | ((t & 0x18) << 8) | n;
/** destination: register, number, write mask ('xyzw' subset), _sat */
export function d(t: Reg, n: number, m = 'xyzw', sat = false): Dst {
  let mask = 0;
  for (const ch of m) mask |= 1 << 'xyzw'.indexOf(ch);
  return { t, n, mask, mod: sat ? 1 : 0 };
}
/** source: register, number, swizzle (1 to 4 of xyzw, the last repeated), negate */
export function s(t: Reg, n: number, sw = 'xyzw', neg = false): Src {
  const c = Array.from(sw, (ch) => 'xyzw'.indexOf(ch));
  while (c.length < 4) c.push(c[c.length - 1]);
  return { t, n, sw: c[0] | (c[1] << 2) | (c[2] << 4) | (c[3] << 6), neg };
}
const dstTok = (x: Dst): number => (0x80000000 | regBits(x.t, x.n) | (x.mask << 16) | (x.mod << 20)) >>> 0;
const srcTok = (x: Src): number => (0x80000000 | regBits(x.t, x.n) | (x.sw << 16) | ((x.neg ? 1 : 0) << 24)) >>> 0;

export type Line =
  | { op: Op.DCL; usage: number; index?: number; dst: Dst }
  | { op: Op.DCL; sampler2d: true; dst: Dst }
  | { op: Op.DEF; dst: Dst; v: [number, number, number, number] }
  | { op: Exclude<Op, Op.DCL | Op.DEF>; dst: Dst; src: Src[] };

const F1 = new Float32Array(1), U1 = new Uint32Array(F1.buffer);
const bits = (x: number): number => { F1[0] = x; return U1[0]; };

/** kind 'vs' or 'ps', version e.g. 0x101 (1.1) or 0x200 (2.0) */
export function assemble(kind: 'vs' | 'ps', version: number, lines: Line[]): Uint32Array {
  const out: number[] = [((kind === 'vs' ? 0xfffe0000 : 0xffff0000) | version) >>> 0];
  const v2 = version >= 0x200;
  const tok = (op: number, args: number[]): void => { out.push((op | (v2 ? args.length << 24 : 0)) >>> 0, ...args); };
  for (const l of lines) {
    if (l.op === Op.DCL) {
      const decl = 'sampler2d' in l ? (0x80000000 | (2 << 27)) >>> 0 : (0x80000000 | l.usage | ((l.index ?? 0) << 16)) >>> 0;
      tok(Op.DCL, [decl, dstTok(l.dst)]);
    } else if (l.op === Op.DEF) {
      tok(Op.DEF, [dstTok(l.dst), ...l.v.map(bits)]);
    } else {
      tok(l.op, [dstTok(l.dst), ...l.src.map(srcTok)]);
    }
  }
  out.push(0x0000ffff);
  return Uint32Array.from(out);
}
