// REF9's vertex shader virtual machine (RefVM, d3dref9.dll) for vs_1_1 token streams: ExecuteShader 0x1003b66f
// interprets the tokens directly, sources through SetSrcReg 0x1003f290 (swizzle, negate, abs), results through
// WriteResult 0x1003f8b6 (write mask, saturate). Arithmetic at 64 bits, each result stored to float.
import * as E from '../../d3d8/ref/ext';

const fr = Math.fround;

/** register types (D3DSHADER_PARAM_REGISTER_TYPE) */
export const Reg = { TEMP: 0, INPUT: 1, CONST: 2, ADDR: 3, RASTOUT: 4, ATTROUT: 5, TEXCRDOUT: 6, SAMPLER: 10 } as const;

export interface Src { type: number; num: number; swz: number; mod: number }
export interface Dst { type: number; num: number; mask: number; sat: boolean }
export interface Inst { op: number; dst: Dst; src: Src[] }
/** a dcl: register (type, num) bound to usage / usage index (or, for a sampler, the texture type) */
export interface Dcl { type: number; num: number; usage: number; index: number; mask: number }

export function regType(t: number): number { return ((t >>> 28) & 7) | ((t >>> 8) & 0x18); }
export function parseDst(t: number): Dst { return { type: regType(t), num: t & 0x7ff, mask: (t >>> 16) & 0xf, sat: ((t >>> 20) & 1) !== 0 }; }
export function parseSrc(t: number): Src {
  if (t & 0x2000) throw new Error('RefDevice9: relative addressing is not implemented');
  return { type: regType(t), num: t & 0x7ff, swz: (t >>> 16) & 0xff, mod: (t >>> 24) & 0xf };
}

/** split a token stream into dcls, defs and instructions (comments skipped; versions below 2.0 carry no length in
 *  the instruction token, so the parameters are the following tokens with bit 31 set) */
export function parse(tokens: Uint32Array): { version: number; dcls: Dcl[]; defs: { num: number; v: Float32Array }[]; code: Inst[] } {
  const version = tokens[0] >>> 0, dcls: Dcl[] = [], defs: { num: number; v: Float32Array }[] = [], code: Inst[] = [];
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i] >>> 0;
    if (t === 0xffff) break;
    const op = t & 0xffff;
    if (op === 0xfffe) { i += 1 + ((t >>> 16) & 0x7fff); continue; }
    let n: number;
    if ((version & 0xffff) >= 0x200) n = (t >>> 24) & 0xf;
    else if (op === 81) n = 5;
    else { n = 0; while (i + 1 + n < tokens.length && (tokens[i + 1 + n] & 0x80000000) !== 0) n++; }
    const p = tokens.subarray(i + 1, i + 1 + n);
    if (op === 31) {
      const d = parseDst(p[1]);
      dcls.push({ type: d.type, num: d.num, usage: p[0] & 0x1f, index: (p[0] >>> 16) & 0xf, mask: d.mask });
      if (d.type === Reg.SAMPLER) dcls[dcls.length - 1].usage = (p[0] >>> 27) & 0xf;
    } else if (op === 81) {
      defs.push({ num: p[0] & 0x7ff, v: new Float32Array(new Uint32Array(p.subarray(1, 5)).buffer) });
    } else if (op !== 0) {
      code.push({ op, dst: parseDst(p[0]), src: Array.from(p.subarray(1), parseSrc) });
    }
    i += 1 + n;
  }
  return { version, dcls, defs, code };
}

const Op = { MOV: 1, ADD: 2, MAD: 4, MUL: 5, DP4: 9 } as const;

/** a compiled vertex shader and its register file */
export class VertexShader9 {
  readonly dcls: Dcl[];
  readonly code: Inst[];
  /** r0..r11, v0..v15, a0, then the outputs: oPos, oFog, oPts (RASTOUT 0..2), oD0, oD1, oT0..oT7 */
  readonly r = new Float64Array(12 * 4);
  readonly v = new Float64Array(16 * 4);
  /** outputs persist from vertex to vertex (RefVM resets only oPos); RefVM's registers start at 0 */
  readonly oPos = new Float64Array(4);
  readonly oD = new Float64Array(2 * 4);
  readonly oT = new Float64Array(8 * 4);
  readonly oX = new Float64Array(2 * 4);
  private s = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  private res = new Float64Array(4);
  constructor(tokens: Uint32Array) {
    const p = parse(tokens);
    if ((p.version >>> 16) !== 0xfffe || (p.version & 0xffff) !== 0x101) throw new Error('RefDevice9: only vs_1_1 is implemented');
    if (p.defs.length) throw new Error('RefDevice9: vertex shader def is not implemented');
    this.dcls = p.dcls;
    this.code = p.code;
    for (const i of this.code) {
      if (i.op !== Op.MOV && i.op !== Op.ADD && i.op !== Op.MAD && i.op !== Op.MUL && i.op !== Op.DP4) {
        throw new Error('RefDevice9: vertex shader opcode ' + i.op + ' is not implemented');
      }
    }
  }

  /** the register file of (type, num), its offset left in fo (no tuple: an allocation per operand) */
  private fo = 0;
  private file(type: number, num: number, c: Float32Array): Float64Array | Float32Array {
    this.fo = num * 4;
    switch (type) {
      case Reg.TEMP: return this.r;
      case Reg.INPUT: return this.v;
      case Reg.CONST: return c;
      case Reg.RASTOUT: if (num === 0) return this.oPos; this.fo = (num - 1) * 4; return this.oX;
      case Reg.ATTROUT: return this.oD;
      case Reg.TEXCRDOUT: return this.oT;
      default: throw new Error('RefDevice9: vertex shader register type ' + type + ' is not implemented');
    }
  }

  /** ExecuteShader 0x1003b66f for one vertex (inputs already in v) */
  run(c: Float32Array): void {
    const P = this.oPos; P[0] = 0; P[1] = 0; P[2] = 0; P[3] = 1;
    for (const ins of this.code) {
      for (let k = 0; k < ins.src.length; k++) {
        const s = ins.src[k], f = this.file(s.type, s.num, c), o = this.fo, d = this.s[k];
        for (let j = 0; j < 4; j++) {
          let x = f[o + ((s.swz >>> (2 * j)) & 3)];
          if (s.mod === 1) x = -x; else if (s.mod === 0xb) x = Math.abs(x); else if (s.mod === 0xc) x = -Math.abs(x);
          else if (s.mod !== 0) throw new Error('RefDevice9: source modifier ' + s.mod + ' is not implemented');
          d[j] = x;
        }
      }
      const a = this.s[0], b = this.s[1], e = this.s[2], res = this.res, m = ins.dst.mask;
      switch (ins.op) {
        case Op.MOV: for (let j = 0; j < 4; j++) res[j] = a[j]; break;
        // InstAdd: f32(a + b); InstMul: f32(a * b) (one operation: double, then float, is the 64-bit result)
        case Op.ADD: for (let j = 0; j < 4; j++) res[j] = fr(a[j] + b[j]); break;
        case Op.MUL: for (let j = 0; j < 4; j++) res[j] = fr(a[j] * b[j]); break;
        // InstMad 0x1003d21f: f32(a*b + c) at 64 bits (the product exact); the written components only
        case Op.MAD: for (let j = 0; j < 4; j++) if ((m >> j) & 1) res[j] = E.add32(a[j] * b[j], e[j]); break;
        // InstDP4 0x1003c6c7: f32(((y1 y2 + x1 x2) + z1 z2) + w1 w2) at 64 bits
        case Op.DP4: res[0] = res[1] = res[2] = res[3] = E.sum32(a[1] * b[1], a[0] * b[0], a[2] * b[2], a[3] * b[3]); break;
      }
      const dt = ins.dst, f = this.file(dt.type, dt.num, c), o = this.fo;
      if (dt.type === Reg.ADDR) throw new Error('RefDevice9: a0 is not implemented');
      for (let j = 0; j < 4; j++) {
        if (!((dt.mask >> j) & 1)) continue;
        let x = res[j];
        if (dt.sat) x = x > 1 ? 1 : x >= 0 ? x : 0;   // ponytail: Saturate's NaN handling unchecked
        f[o + j] = x;
      }
    }
  }
}
