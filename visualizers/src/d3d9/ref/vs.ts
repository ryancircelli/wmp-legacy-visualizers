// REF9's vertex shader virtual machine (RefVM, d3dref9.dll) for vs_1_1 and vs_2_0 token streams: ExecuteShader
// 0x1003b66f interprets the tokens directly, sources through SetSrcReg 0x1003f290 (relative address, swizzle, negate,
// abs), results through WriteResult 0x1003f8b6 (write mask, saturate). Arithmetic at 64 bits, each result stored to
// float.
import * as E from '../../d3d8/ref/ext';
import { cosExt32, sinExt32 } from '../../battery/msvcrt';

const fr = Math.fround;

/** register types (D3DSHADER_PARAM_REGISTER_TYPE) */
export const Reg = { TEMP: 0, INPUT: 1, CONST: 2, ADDR: 3, RASTOUT: 4, ATTROUT: 5, TEXCRDOUT: 6, CONSTINT: 7, SAMPLER: 10, LOOP: 15 } as const;

/** rel: -1 for a plain source, else the a0 component added to num (4: the loop counter aL) */
export interface Src { type: number; num: number; swz: number; mod: number; rel: number }
export interface Dst { type: number; num: number; mask: number; sat: boolean }
export interface Inst { op: number; dst: Dst; src: Src[] }
/** a dcl: register (type, num) bound to usage / usage index (or, for a sampler, the texture type) */
export interface Dcl { type: number; num: number; usage: number; index: number; mask: number }

export function regType(t: number): number { return ((t >>> 28) & 7) | ((t >>> 8) & 0x18); }
export function parseDst(t: number): Dst { return { type: regType(t), num: t & 0x7ff, mask: (t >>> 16) & 0xf, sat: ((t >>> 20) & 1) !== 0 }; }
/** the sources of one instruction: a relative-addressed one (bit 13) is followed, from shader model 2 on, by its
 *  address token (SetSrcReg: a0 by the token's first swizzle component, or aL); before, it is a0.x */
export function parseSrcs(p: Uint32Array, sm2: boolean): Src[] {
  const out: Src[] = [];
  for (let k = 0; k < p.length; k++) {
    const t = p[k] >>> 0;
    let rel = -1;
    if (t & 0x2000) {
      if (!sm2) rel = 0;
      else { const a = p[++k] >>> 0; rel = regType(a) === Reg.LOOP ? 4 : (a >>> 16) & 3; }
    }
    out.push({ type: regType(t), num: t & 0x7ff, swz: (t >>> 16) & 0xff, mod: (t >>> 24) & 0xf, rel });
  }
  return out;
}

/** split a token stream into dcls, defs and instructions (comments skipped; versions below 2.0 carry no length in
 *  the instruction token, so the parameters are the following tokens with bit 31 set) */
export function parse(tokens: Uint32Array): { version: number; dcls: Dcl[]; defs: { num: number; v: Float32Array }[]; idefs: { num: number; v: Int32Array }[]; code: Inst[] } {
  const version = tokens[0] >>> 0, dcls: Dcl[] = [], defs: { num: number; v: Float32Array }[] = [], code: Inst[] = [];
  const idefs: { num: number; v: Int32Array }[] = [], sm2 = (version & 0xff00) >= 0x200 && (version & 0xff00) !== 0xfe00;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i] >>> 0;
    if (t === 0xffff) break;
    const op = t & 0xffff;
    if (op === 0xfffe) { i += 1 + ((t >>> 16) & 0x7fff); continue; }
    let n: number;
    // (REF's legacy fixed-function shader, version 0xfffffefe, is laid out as 1.x)
    if (sm2) n = (t >>> 24) & 0xf;
    else if (op === 81) n = 5;
    else { n = 0; while (i + 1 + n < tokens.length && (tokens[i + 1 + n] & 0x80000000) !== 0) n++; }
    const p = tokens.subarray(i + 1, i + 1 + n);
    if (op === 31) {
      const d = parseDst(p[1]);
      dcls.push({ type: d.type, num: d.num, usage: p[0] & 0x1f, index: (p[0] >>> 16) & 0xf, mask: d.mask });
      if (d.type === Reg.SAMPLER) dcls[dcls.length - 1].usage = (p[0] >>> 27) & 0xf;
    } else if (op === 81) {
      defs.push({ num: p[0] & 0x7ff, v: new Float32Array(new Uint32Array(p.subarray(1, 5)).buffer) });
    } else if (op === 48) {
      idefs.push({ num: p[0] & 0x7ff, v: new Int32Array(p.subarray(1, 5)) });
    } else if (op === Op.REP || op === Op.ENDREP) {
      // no destination: the operand (rep's integer register) is a source
      code.push({ op, dst: parseDst(0), src: parseSrcs(p, sm2) });
    } else if (op !== 0) {
      code.push({ op, dst: parseDst(p[0]), src: parseSrcs(p.subarray(1), sm2) });
    }
    i += 1 + n;
  }
  return { version, dcls, defs, idefs, code };
}

const Op = { MOV: 1, ADD: 2, MAD: 4, MUL: 5, RCP: 6, DP3: 8, DP4: 9, FRC: 19, SINCOS: 37, REP: 38, ENDREP: 39, MOVA: 46 } as const;
const IMPLEMENTED: number[] = Object.values(Op);
const FLT_MAX = 3.4028234663852886e38;
const SC = new Float64Array(2);
/** FISTP in round-to-nearest-even (the FPU's default rounding) */
function rint(x: number): number { const r = Math.round(x); return r - x === 0.5 && (r & 1) !== 0 ? r - 1 : r; }

/** a compiled vertex shader and its register file */
export class VertexShader9 {
  readonly dcls: Dcl[];
  readonly code: Inst[];
  /** r0..r11, v0..v15, a0, then the outputs: oPos, oFog, oPts (RASTOUT 0..2), oD0, oD1, oT0..oT7 */
  readonly r = new Float64Array(12 * 4);
  /** a0 (MOVA's integers) and i0..i15 (the defi values; SetVertexShaderConstantI is not part of the device) */
  private a0 = new Int32Array(4);
  private ic = new Int32Array(16 * 4);
  /** the device constants with the shader's defs over them (null: no defs) */
  private cd: Float32Array | null = null;
  private defs: { num: number; v: Float32Array }[];
  /** per instruction: rep -> the index after its endrep; endrep -> the index after its rep */
  private jump: Int32Array;
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
    if (p.version !== 0xfffe0101 && p.version !== 0xfffe0200) throw new Error('RefDevice9: only vs_1_1 and vs_2_0 are implemented');
    this.dcls = p.dcls;
    this.code = p.code;
    this.defs = p.defs;
    if (p.defs.length) this.cd = new Float32Array(256 * 4);
    for (const d of p.idefs) this.ic.set(d.v, d.num * 4);
    this.jump = new Int32Array(this.code.length);
    const open: number[] = [];
    this.code.forEach((ins, k) => {
      if (!IMPLEMENTED.includes(ins.op)) throw new Error('RefDevice9: vertex shader opcode ' + ins.op + ' is not implemented');
      if (ins.dst.type === Reg.ADDR && ins.op !== Op.MOVA) throw new Error('RefDevice9: a0 written by opcode ' + ins.op);
      if (ins.op === Op.REP) open.push(k);
      else if (ins.op === Op.ENDREP) { const r = open.pop()!; this.jump[r] = k + 1; this.jump[k] = r + 1; }
    });
    if (open.length) throw new Error('RefDevice9: rep without endrep');
  }

  /** the register file of (type, num), its offset left in fo (no tuple: an allocation per operand) */
  private fo = 0;
  private file(type: number, num: number, c: Float32Array): Float64Array | Float32Array {
    this.fo = num * 4;
    switch (type) {
      case Reg.TEMP: return this.r;
      case Reg.INPUT: return this.v;
      // GetDataAddr 0x1003bd44: an index past REF's 8192 constants reads c0
      // ponytail: indices 256..8191 (REF's never-set constants) read c0 too; give them zeros if a shader reaches them
      case Reg.CONST: if (num < 0 || num >= 256) this.fo = 0; return c;
      case Reg.RASTOUT: if (num === 0) return this.oPos; this.fo = (num - 1) * 4; return this.oX;
      case Reg.ATTROUT: return this.oD;
      case Reg.TEXCRDOUT: return this.oT;
      default: throw new Error('RefDevice9: vertex shader register type ' + type + ' is not implemented');
    }
  }

  /** ExecuteShader 0x1003b66f for one vertex (inputs already in v) */
  run(c: Float32Array): void {
    const P = this.oPos; P[0] = 0; P[1] = 0; P[2] = 0; P[3] = 1;
    // the defs as local constants over the device's
    if (this.cd) { this.cd.set(c.subarray(0, 1024)); for (const d of this.defs) this.cd.set(d.v, d.num * 4); c = this.cd; }
    // the rep counters (OnStartLoopRep 0x1003df89 / OnEndLoopRep 0x1003df05: up to 4 deep)
    const reps: number[] = [];
    const code = this.code;
    for (let pc = 0; pc < code.length; pc++) {
      const ins = code[pc];
      if (ins.op === Op.REP) {
        // InstRep 0x1003d859: the count is i#.x; a count below 1 skips past the endrep
        const n = this.ic[ins.src[0].num * 4];
        if (n < 1) pc = this.jump[pc] - 1; else reps.push(n);
        continue;
      }
      if (ins.op === Op.ENDREP) {
        const n = reps.pop()! - 1;
        if (n > 0) { reps.push(n); pc = this.jump[pc] - 1; }
        continue;
      }
      for (let k = 0; k < ins.src.length; k++) {
        const s = ins.src[k];
        if (s.rel === 4) throw new Error('RefDevice9: aL relative addressing is not implemented');
        const f = this.file(s.type, s.rel < 0 ? s.num : s.num + this.a0[s.rel], c), o = this.fo, d = this.s[k];
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
        // InstDP3 0x1003c64e: f32((y1 y2 + x1 x2) + z1 z2) at 64 bits
        case Op.DP3: res[0] = res[1] = res[2] = res[3] = E.sum32x3(a[1] * b[1], a[0] * b[0], a[2] * b[2]); break;
        // InstDP4 0x1003c6c7: f32(((y1 y2 + x1 x2) + z1 z2) + w1 w2) at 64 bits
        case Op.DP4: res[0] = res[1] = res[2] = res[3] = E.sum32(a[1] * b[1], a[0] * b[0], a[2] * b[2], a[3] * b[3]); break;
        // InstRcp 0x1003d7c7: of the w source; 1 -> 1, +-0 -> FLT_MAX (below vs_3_0), else f32(1 / w) at 64 bits
        case Op.RCP: {
          const w = a[3];
          let r = 1;
          if (w !== 1) { if (w === 0) r = FLT_MAX; else { const h = E.div(1, 0, w, 0); r = E.toF32(h, E.lo()); } }
          res[0] = res[1] = res[2] = res[3] = r;
          break;
        }
        // InstFrc 0x1003c92f: f32(x - floor(x)) at 64 bits
        case Op.FRC: for (let j = 0; j < 4; j++) res[j] = E.add32(a[j], -Math.floor(a[j])); break;
        // InstSincos 0x1003dc7f: msvcrt's _CIcos / _CIsin (FCOS / FSIN) of the w source, each stored to float, into x
        // and y only (the Taylor constants of vs_2_0's sources 1 and 2 are read, not used)
        case Op.SINCOS:
          cosExt32(a[3], SC); res[0] = E.toF32(SC[0], SC[1]);
          sinExt32(a[3], SC); res[1] = E.toF32(SC[0], SC[1]);
          break;
        // InstMova 0x1003d52e: each component rounded to the nearest integer (FISTP)
        case Op.MOVA: for (let j = 0; j < 4; j++) if ((m >> j) & 1) this.a0[j] = rint(a[j]); continue;
      }
      const dt = ins.dst, f = this.file(dt.type, dt.num, c), o = this.fo;
      const wm = ins.op === Op.SINCOS ? dt.mask & 3 : dt.mask;
      for (let j = 0; j < 4; j++) {
        if (!((wm >> j) & 1)) continue;
        let x = res[j];
        if (dt.sat) x = x > 1 ? 1 : x >= 0 ? x : 0;   // ponytail: Saturate's NaN handling unchecked
        f[o + j] = x;
      }
    }
  }
}
