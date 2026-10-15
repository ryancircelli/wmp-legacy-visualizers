// REF9's pixel shaders (ps_2_0). CPSTrans::Initialize 0x1002f97d translates the tokens into RDPSInst operations that
// RefRast::ExecShader 0x1002a590 runs for a 2x2 quad: inputs evaluated per pixel (EVAL, see rast.ts), arithmetic per
// pixel inside quad loops, and per texld: DSX / DSY outside the loop (f32(p1 - p0), f32(p2 - p0) of pixel 0's quad),
// one TEXCOVERAGE (the LOD, from those derivatives), then SAMPLE per pixel. All four pixels run whatever their
// coverage. This runs the same operations instruction by instruction across the quad, which gives the same values
// (no instruction reads another pixel's registers except DSX/DSY, which REF also runs between loops).
//
// Speed: the tokens are compiled once into a flat list of operations with their register offsets resolved, the
// constants are copied into each pixel's register file per draw (so every source is a register read), and when
// every texld reads its coordinates from an input register the program's other work is skipped for uncovered
// pixels (their results are never written, and DSX/DSY read only the inputs, which rast.ts evaluates for them).
import { LodControls, type RefTexture9, lodControls, sample } from './tex';
import { type Dcl, Reg, parse } from './vs';
import * as E from '../../d3d8/ref/ext';

const fr = Math.fround;
const Op = { MOV: 1, ADD: 2, MAD: 4, MUL: 5, TEXLD: 66 } as const;
/** ps register types beyond vs's */
const PReg = { TEXTURE: 3, COLOROUT: 8 } as const;

/** the sampler a texld reads: its texture and states (filled by the device for each draw) */
export interface Sampler { tex: RefTexture9 | null; st: Uint32Array }

/** per-pixel register file layout (doubles holding float values): r0..r31, v0..v1, t0..t7, oC0..oC3, c0..c31 */
const R = 0, V = 32 * 4, T = V + 2 * 4, OC = T + 8 * 4, C = OC + 4 * 4;
export const PS_REGS = C + 32 * 4;
export const PS_V = V, PS_T = T, PS_OC = OC;

/** one compiled instruction: register-file offsets (source offsets already include the swizzle component) */
interface POp {
  op: number; dst: number; mask: number; sat: boolean; sampler: number;
  /** sources 0..2: offsets of components x, y, z, w; negate flags */
  a0: number; a1: number; a2: number; a3: number; na: boolean;
  b0: number; b1: number; b2: number; b3: number; nb: boolean;
  c0: number; c1: number; c2: number; c3: number; nc: boolean;
  /** texld: its LOD controls (and their memo) */
  lc: LodControls;
}

export class PixelShader9 {
  readonly dcls: Dcl[];
  readonly prog: POp[] = [];
  readonly consts = new Float32Array(32 * 4);
  private defMask = new Uint8Array(32);
  /** true when every texld reads an input register the program never writes: uncovered pixels can skip the rest */
  readonly inputCoords: boolean;
  /** the input registers (offsets of their x) the texlds read (rast.ts evaluates these for all of pixels 0..2) */
  readonly coordInputs = new Set<number>();
  private deriv = new Float64Array(4);
  private smp = new Float64Array(4);
  private tmp = new Float64Array(12);
  constructor(tokens: Uint32Array) {
    const p = parse(tokens);
    if ((p.version >>> 16) !== 0xffff || (p.version & 0xffff) !== 0x200) throw new Error('RefDevice9: only ps_2_0 is implemented');
    this.dcls = p.dcls;
    for (const d of p.defs) { this.consts.set(d.v, d.num * 4); this.defMask[d.num] = 1; }
    const written = new Set<number>();
    let inputCoords = true;
    for (const i of p.code) {
      if (i.op !== Op.MOV && i.op !== Op.ADD && i.op !== Op.MAD && i.op !== Op.MUL && i.op !== Op.TEXLD) {
        throw new Error('RefDevice9: pixel shader opcode ' + i.op + ' is not implemented');
      }
      for (const s of i.src) if (s.mod !== 0 && s.mod !== 1) throw new Error('RefDevice9: pixel shader source modifier ' + s.mod + ' is not implemented');
      const src = (k: number): number[] => {
        const s = i.src[k];
        if (!s || s.type === Reg.SAMPLER) return [0, 0, 0, 0, 0];
        const o = PixelShader9.off(s.type, s.num);
        return [o + (s.swz & 3), o + ((s.swz >>> 2) & 3), o + ((s.swz >>> 4) & 3), o + ((s.swz >>> 6) & 3), s.mod];
      };
      const [a0, a1, a2, a3, na] = src(0), [b0, b1, b2, b3, nb] = src(1), [c0, c1, c2, c3, nc] = src(2);
      const dst = PixelShader9.off(i.dst.type, i.dst.num);
      if (i.op === Op.TEXLD) {
        const s = i.src[0];
        if ((s.type !== Reg.INPUT && s.type !== PReg.TEXTURE) || written.has(PixelShader9.off(s.type, s.num))) inputCoords = false;
        this.coordInputs.add(PixelShader9.off(s.type, s.num));
      }
      written.add(dst);
      this.prog.push({ op: i.op, dst, mask: i.dst.mask, sat: i.dst.sat, sampler: i.op === Op.TEXLD ? i.src[1].num : 0,
        a0, a1, a2, a3, na: na !== 0, b0, b1, b2, b3, nb: nb !== 0, c0, c1, c2, c3, nc: nc !== 0, lc: new LodControls() });
    }
    this.inputCoords = inputCoords;
  }

  private static off(type: number, num: number): number {
    switch (type) {
      case Reg.TEMP: return R + num * 4;
      case Reg.INPUT: return V + num * 4;
      case Reg.CONST: return C + num * 4;
      case PReg.TEXTURE: return T + num * 4;
      case PReg.COLOROUT: return OC + num * 4;
      default: throw new Error('RefDevice9: pixel shader register type ' + type + ' is not implemented');
    }
  }

  /** copy the constants (the device's, defs override) into the 4 pixel register files of a quad */
  bindConstants(regs: Float64Array, c: Float32Array): void {
    for (let p = 0; p < 4; p++) {
      const b = p * PS_REGS + C;
      for (let i = 0; i < 32; i++) {
        const cf = this.defMask[i] ? this.consts : c;
        for (let j = 0; j < 4; j++) regs[b + i * 4 + j] = cf[i * 4 + j];
      }
    }
  }

  /** run the shader on a quad: regs = 4 pixel register files of PS_REGS doubles (inputs already evaluated for the
   *  live pixels, the texld coordinate inputs for pixels 0..2 too); live = the pixels to compute (bit p) */
  run(regs: Float64Array, live: number, samplers: Sampler[]): void {
    const prog = this.prog, t = this.tmp;
    for (let n = 0; n < prog.length; n++) {
      const I = prog[n];
      if (I.op === Op.TEXLD) { this.texld(regs, I, live, samplers); continue; }
      const mask = I.mask, op = I.op;
      for (let p = 0; p < 4; p++) {
        if (!((live >> p) & 1)) continue;
        const b = p * PS_REGS;
        // sources first (the destination may be a source): swizzled, negated
        let x = regs[b + I.a0], y = regs[b + I.a1], z = regs[b + I.a2], w = regs[b + I.a3];
        if (I.na) { x = -x; y = -y; z = -z; w = -w; }
        t[0] = x; t[1] = y; t[2] = z; t[3] = w;
        if (op !== Op.MOV) {
          x = regs[b + I.b0]; y = regs[b + I.b1]; z = regs[b + I.b2]; w = regs[b + I.b3];
          if (I.nb) { x = -x; y = -y; z = -z; w = -w; }
          t[4] = x; t[5] = y; t[6] = z; t[7] = w;
          if (op === Op.MAD) {
            x = regs[b + I.c0]; y = regs[b + I.c1]; z = regs[b + I.c2]; w = regs[b + I.c3];
            if (I.nc) { x = -x; y = -y; z = -z; w = -w; }
            t[8] = x; t[9] = y; t[10] = z; t[11] = w;
          }
        }
        const o = b + I.dst;
        for (let j = 0; j < 4; j++) {
          if (!((mask >> j) & 1)) continue;
          let v: number;
          if (op === Op.MAD) {
            // 0x23: f32(a*b + c) at 64 bits; the product is exact, so E.add32's fast path (inline here: a call would
            // box the doubles): the double sum errs by <= 2^-53 (|ab| + |c|) and the 64-bit one less; when both ends of
            // that interval round to one float it is the result, else the exact path
            const pr = t[j] * t[4 + j], c = t[8 + j], sm = pr + c, e = (Math.abs(pr) + Math.abs(c)) * E.EPS, lo = fr(sm - e);
            v = lo === fr(sm + e) ? lo : E.add32(pr, c);
          }
          else if (op === Op.MOV) v = t[j];                                       // 0x26
          else if (op === Op.ADD) v = fr(t[j] + t[4 + j]);                        // 0x15
          else v = fr(t[j] * t[4 + j]);                                           // MUL 0x27
          if (I.sat) v = v > 1 ? 1 : v >= 0 ? v : 0;                               // _EmitDstMod: clamp 0x2
          regs[o + j] = v;
        }
      }
    }
  }

  /** texld: DSX 0x19, DSY 0x1a, TEXCOVERAGE 0xe (ComputeTextureCoverage 0x1001e82e), SAMPLE 0xb per pixel */
  private texld(regs: Float64Array, I: POp, live: number, samplers: Sampler[]): void {
    const sm = samplers[I.sampler], su = I.a0, sv = I.a1;
    const tex = sm.tex, out = this.smp, mask = I.mask, d = this.deriv;
    if (tex) {
      const u0 = regs[su], v0 = regs[sv];
      d[0] = fr(regs[PS_REGS + su] - u0); d[1] = fr(regs[2 * PS_REGS + su] - u0);
      d[2] = fr(regs[PS_REGS + sv] - v0); d[3] = fr(regs[2 * PS_REGS + sv] - v0);
      lodControls(tex, sm.st, d, I.lc);
    }
    for (let p = 0; p < 4; p++) {
      if (!((live >> p) & 1)) continue;
      const b = p * PS_REGS, o = b + I.dst;
      if (tex) sample(tex, sm.st, I.lc, regs, b + su, b + sv, out, 0);
      else { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; }
      for (let j = 0; j < 4; j++) if ((mask >> j) & 1) regs[o + j] = I.sat ? Math.min(Math.max(out[j], 0), 1) : out[j];
    }
  }
}
