// Yule Log's four vertex shaders (noskin, skin, flame, log: PRESET1::CreateShader 0x1000b550 reads them from
// fire\*.vso and CreateVertexShader makes them in CreateVideoResources 0x1000a850), written here as vs.1.1 programs
// and assembled into the DirectX 8 token stream by our own small assembler. All four share one declaration
// (stream 0: v0 position float3, v1/v2 blend weights float1, v3 blend indices float2, v4 normal float3, v5 uv
// float2: the 48-byte MESHCONT vertex). noskin, flame and log run the same program: the position through c8-c11
// (world * view * projection, transposed), diffuse c17 * c16 + c21 (the fire's glow colour), alpha c27.x, uv to
// stages 0 and 1. skin blends two bones from the palette at c51 (three rows each) and lights with c20/c21.
// An assembled file can also carry debug comment tokens (D3DSIO_COMMENT: source file and line records); a caller
// that has them passes them per instruction to make the token stream equal to such a file.

const enum Reg { R = 0, V = 1, C = 2, A = 3, RASTOUT = 4, ATTROUT = 5, TEXOUT = 6 }
const enum Op { MOV = 1, ADD = 2, MAD = 4, MUL = 5, RSQ = 7, DP3 = 8, DP4 = 9, MAX = 11 }

/** a destination operand: register type, number, write mask (xyzw bits) */
interface Dst { t: Reg; n: number; mask: number }
/** a source operand: register type, number, swizzle (4 components 0..3), negate, a0.x relative */
interface Src { t: Reg; n: number; sw: number[]; neg?: boolean; rel?: boolean }

const SW = (s: string): number[] => {
  const c = Array.from(s, (ch) => 'xyzw'.indexOf(ch));
  while (c.length < 4) c.push(c[c.length - 1]);
  return c;
};
const dst = (t: Reg, n: number, m = 'xyzw'): Dst => ({ t, n, mask: Array.from(m).reduce((a, ch) => a | (1 << 'xyzw'.indexOf(ch)), 0) });
const src = (t: Reg, n: number, s = 'xyzw', neg = false, rel = false): Src => ({ t, n, sw: SW(s), neg, rel });

function dstTok(d: Dst): number { return (0x80000000 | (d.t << 28) | (d.mask << 16) | d.n) >>> 0; }
function srcTok(s: Src): number {
  const sw = s.sw[0] | (s.sw[1] << 2) | (s.sw[2] << 4) | (s.sw[3] << 6);
  return (0x80000000 | (s.t << 28) | ((s.neg ? 1 : 0) << 24) | (sw << 16) | ((s.rel ? 1 : 0) << 13) | s.n) >>> 0;
}

type Ins = [Op, Dst, ...Src[]];

/** assemble: version 1.1, the instructions, end; comments[i] (raw dwords) go before instruction i, comments[n]
 *  before the end token */
export function assemble(prog: Ins[], comments?: readonly (readonly number[])[]): Uint32Array {
  const out: number[] = [0xfffe0101];
  prog.forEach((ins, i) => {
    if (comments) out.push(...comments[i]);
    out.push(ins[0], dstTok(ins[1]));
    for (let k = 2; k < ins.length; k++) out.push(srcTok(ins[k] as Src));
  });
  if (comments) out.push(...comments[prog.length]);
  out.push(0x0000ffff);
  return Uint32Array.from(out, (x) => x >>> 0);
}

// D3DVSD_STREAM(0), D3DVSD_REG(0, FLOAT3), REG(1, FLOAT1), REG(2, FLOAT1), REG(3, FLOAT2), REG(4, FLOAT3),
// REG(5, FLOAT2), D3DVSD_END() (PRESET1::CreateShader's vectors, 0x1000b550)
export const DECLARATION = Uint32Array.from([0x20000000, 0x40020000, 0x40000001, 0x40000002, 0x40010003, 0x40020004,
  0x40010005, 0xffffffff]);

const oPos = (m: string) => dst(Reg.RASTOUT, 0, m);
const v = (n: number, s?: string) => src(Reg.V, n, s);
const c = (n: number, s?: string, neg?: boolean) => src(Reg.C, n, s, neg);
const cr = (n: number) => src(Reg.C, n, 'xyzw', false, true);
const r = (n: number, s?: string) => src(Reg.R, n, s);
const R = (n: number, m?: string) => dst(Reg.R, n, m);

/** noskin.vso / flame.vso / log.vso */
export const RIGID: Ins[] = [
  [Op.DP4, oPos('x'), v(0), c(8)], [Op.DP4, oPos('y'), v(0), c(9)], [Op.DP4, oPos('z'), v(0), c(10)], [Op.DP4, oPos('w'), v(0), c(11)],
  [Op.MOV, R(0), c(21)], [Op.MOV, R(1), c(16)], [Op.MAD, dst(Reg.ATTROUT, 0), c(17), r(1), r(0)],
  [Op.MOV, dst(Reg.ATTROUT, 0, 'w'), c(27, 'x')],
  [Op.MOV, dst(Reg.TEXOUT, 0, 'xy'), v(5)], [Op.MOV, dst(Reg.TEXOUT, 1, 'xy'), v(5)],
];

/** skin.vso */
export const SKIN: Ins[] = [
  [Op.MOV, dst(Reg.A, 0, 'x'), v(3, 'x')],
  [Op.DP4, R(0, 'x'), v(0), cr(51)], [Op.DP4, R(0, 'y'), v(0), cr(52)], [Op.DP4, R(0, 'z'), v(0), cr(53)],
  [Op.DP3, R(2, 'x'), v(4), cr(51)], [Op.DP3, R(2, 'y'), v(4), cr(52)], [Op.DP3, R(2, 'z'), v(4), cr(53)],
  [Op.MOV, dst(Reg.A, 0, 'x'), v(3, 'y')],
  [Op.DP4, R(1, 'x'), v(0), cr(51)], [Op.DP4, R(1, 'y'), v(0), cr(52)], [Op.DP4, R(1, 'z'), v(0), cr(53)],
  [Op.DP3, R(3, 'x'), v(4), cr(51)], [Op.DP3, R(3, 'y'), v(4), cr(52)], [Op.DP3, R(3, 'z'), v(4), cr(53)],
  [Op.MUL, R(0, 'xyz'), r(0, 'xyzz'), v(1, 'x')], [Op.MAD, R(1), r(1, 'xyzz'), v(2, 'x'), r(0, 'xyzz')],
  [Op.MOV, R(1, 'w'), c(27, 'z')],
  [Op.MUL, R(2, 'xyz'), r(2, 'xyzz'), v(1, 'x')], [Op.MAD, R(3), r(3, 'xyzz'), v(2, 'x'), r(2, 'xyzz')],
  [Op.MOV, R(3, 'w'), c(27, 'z')],
  [Op.DP4, oPos('x'), r(1), c(4)], [Op.DP4, oPos('y'), r(1), c(5)], [Op.DP4, oPos('z'), r(1), c(6)], [Op.DP4, oPos('w'), r(1), c(7)],
  [Op.MOV, R(0), r(3)], [Op.DP3, R(0, 'w'), r(0), r(0)], [Op.RSQ, R(0, 'w'), r(0, 'w')], [Op.MUL, R(0), r(0), r(0, 'w')],
  [Op.MOV, R(1), c(20, 'xyzw', true)], [Op.DP3, R(1, 'w'), r(1), r(1)], [Op.RSQ, R(1, 'w'), r(1, 'w')], [Op.MUL, R(1), r(1), r(1, 'w')],
  [Op.DP3, R(0, 'x'), r(1), r(0)], [Op.MAX, R(1), r(0, 'x'), c(27, 'x')],
  [Op.MUL, R(1), r(1, 'x'), c(21)], [Op.ADD, dst(Reg.ATTROUT, 0), r(1), c(27, 'y')],
  [Op.MOV, dst(Reg.TEXOUT, 0, 'xy'), v(5)], [Op.MOV, dst(Reg.TEXOUT, 1, 'xy'), v(5)],
];

/** the four shaders in PRESET1's order (noskin, skin, flame, log: CreateShader 0x1000b550) */
export const SHADERS: { name: string; prog: Ins[] }[] = [
  { name: 'noskin', prog: RIGID }, { name: 'skin', prog: SKIN }, { name: 'flame', prog: RIGID }, { name: 'log', prog: RIGID },
];
