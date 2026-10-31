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
const Op = { MOV: 1, ADD: 2, MAD: 4, MUL: 5, RSQ: 7, DP3: 8, POW: 0x20, NRM: 0x24, CMP: 0x58, TEXLD: 66, MAX: 11 } as const;
/** ooLOG2 0x1005b934 (its dynamic initializer 0x100071d0): f32(1 / f32(ln 2)) */
const OOLOG2 = fr(1 / fr(Math.LN2));
/** REF's own fixed-function pixel shader version (UpdateLegacyPixelShader 0x1002234f) */
export const PS_LEGACY = 0xfffffefe;
/** ps register types beyond vs's */
const PReg = { TEXTURE: 3, COLOROUT: 8 } as const;

/** the sampler a texld reads: its texture and states (filled by the device for each draw) */
export interface Sampler { tex: RefTexture9 | null; st: Uint32Array }

const PS_OPS = new Set<number>(Object.values(Op));

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
  readonly version: number;
  /** a ps_1_x or the legacy shader: colour inputs evaluated clamped to [0, 1] (CPSTrans::Initialize 0x1002f97d, the
   *  EVAL clamp flag for versions below 1.4), the colour result r0 (DoPixels 0x100251ab: RDColor::Clamp) */
  readonly v1: boolean;
  /** the register-file offset of the colour result (oC0, or r0 for ps_1_x) */
  readonly out: number;
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
    const p = parse(tokens), ver = p.version;
    this.version = ver;
    this.v1 = ver === PS_LEGACY || (ver >= 0xffff0101 && ver <= 0xffff0103);
    if (!this.v1 && ver !== 0xffff0200) throw new Error('RefDevice9: pixel shader version ' + ver.toString(16) + ' is not implemented');
    this.out = this.v1 && ver !== PS_LEGACY ? R : OC;   // (the legacy result: rast.ts's stage blending into oC0)
    this.dcls = p.dcls;
    if (this.v1) {
      // 1.x declares nothing: the inputs are the t# a tex samples through and the v# read
      const seen = new Set<number>();
      const add = (type: number, num: number): void => {
        const k = type * 64 + num;
        if (!seen.has(k)) { seen.add(k); this.dcls.push({ type, num, usage: 0, index: 0, mask: 0xf }); }
      };
      for (const i of p.code) {
        if (i.op === Op.TEXLD) add(PReg.TEXTURE, i.dst.num);
        for (const s of i.src) if (s.type === Reg.INPUT) add(Reg.INPUT, s.num);
      }
    }
    for (const d of p.defs) { this.consts.set(d.v, d.num * 4); this.defMask[d.num] = 1; }
    const written = new Set<number>();
    let inputCoords = true;
    for (const i of p.code) {
      if (this.v1 && i.op === Op.TEXLD) {
        // tex tN (1.x / legacy): sample stage N at texture coordinate set N into tN (no source tokens)
        if (i.src.length) throw new Error('RefDevice9: ps_1_4 texld is not implemented');
        i.src = [{ type: PReg.TEXTURE, num: i.dst.num, swz: 0xe4, mod: 0, rel: -1 }, { type: Reg.SAMPLER, num: i.dst.num, swz: 0xe4, mod: 0, rel: -1 }];
      }
      if (!PS_OPS.has(i.op) || (this.v1 && (i.op === Op.RSQ || (i.op > Op.DP3 && i.op !== Op.TEXLD)))) {
        throw new Error('RefDevice9: pixel shader opcode ' + i.op + ' is not implemented');
      }
      // the scalar sources (rsq's, pow's two): REF reads one component (CPSTrans: the swizzle's first selector, a
      // swizzle move first otherwise); with a replicate swizzle every reading agrees
      for (const k of i.op === Op.RSQ ? [0] : i.op === Op.POW ? [0, 1] : []) {
        const w = i.src[k].swz;
        if (w !== (w & 3) * 0x55) throw new Error('RefDevice9: a scalar pixel shader source without a replicate swizzle');
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
          if (op === Op.MAD || op === Op.CMP) {
            x = regs[b + I.c0]; y = regs[b + I.c1]; z = regs[b + I.c2]; w = regs[b + I.c3];
            if (I.nc) { x = -x; y = -y; z = -z; w = -w; }
            t[8] = x; t[9] = y; t[10] = z; t[11] = w;
          }
        }
        const o = b + I.dst;
        // the scalar ops' one value: rsq 0x29 f32(1 / f32(sqrt(|x|))) at 64 bits (one rounding each: neither a float's
        // square root nor a float's reciprocal lies within 2^-49 of a float midpoint unless exact); nrm: rsq of dp3
        // 0x1c of the source with itself (then mul 0x27); pow: log 0x21 f32(f32(ln |x|) * ooLOG2), mul 0x27 by y,
        // exp 0x1e f32(pow(2, that))
        // ponytail: the CRT's _CIlog / _CIpow against fdlibm's log / pow (V8's): equal floats unless a double result
        // straddles a float midpoint (about 2^-29 a value); a trace that differs there needs the CRT's own routines
        let sc = 0;
        if (op === Op.RSQ) sc = fr(1 / fr(Math.sqrt(Math.abs(t[0]))));
        else if (op === Op.NRM) sc = fr(1 / fr(Math.sqrt(Math.abs(E.sum32x3(t[0] * t[0], t[1] * t[1], t[2] * t[2])))));
        else if (op === Op.POW) sc = fr(Math.pow(2, fr(fr(fr(Math.log(Math.abs(t[0]))) * OOLOG2) * t[4])));
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
          // cmp 0x17: src0 >= 0 (not NaN) picks src1, else src2
          else if (op === Op.CMP) v = t[j] >= 0 ? t[4 + j] : t[8 + j];
          // max 0x24: src1 > src0 (or unordered) picks src1, else src0
          else if (op === Op.MAX) v = t[j] >= t[4 + j] ? t[j] : t[4 + j];
          else if (op === Op.NRM) v = fr(t[j] * sc);
          else if (op === Op.RSQ || op === Op.POW) v = sc;
          // dp3: f32((a.x b.x + a.y b.y) + a.z b.z) at 64 bits (exact float products)
          else if (op === Op.DP3) v = E.sum32x3(t[0] * t[4], t[1] * t[5], t[2] * t[6]);
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

/** UpdateLegacyPixelShader 0x1002234f: the shader REF runs without a pixel shader, `tex tN` for each texture stage
 *  up to the first COLOROP DISABLE (the stage blending itself is rast.ts's legacyBlend) */
const LEGACY = new Map<number, PixelShader9>();
export function legacyShader(stages: number): PixelShader9 {
  let s = LEGACY.get(stages);
  if (!s) {
    const t = [PS_LEGACY];
    for (let i = 0; i < stages; i++) t.push(0x42, (0xb00f0000 | i) >>> 0);
    t.push(0xffff);
    s = new PixelShader9(new Uint32Array(t));
    LEGACY.set(stages, s);
  }
  return s;
}
