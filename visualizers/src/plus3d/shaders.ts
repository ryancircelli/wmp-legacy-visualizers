// The Plus! scenes' vertex shaders (MODELSET::LoadShader 0x10006330 reads VSO_<NAME>S and VSO_<NAME>NS, CreateShader
// 0x10006700 makes them with the declaration of 0x10005980: stream 0, v0 position float3, v1/v2 blend weights
// float1, v3 blend indices float2, v4 normal float3, v5 uv float2: the 48-byte MESHCONT vertex). Written here as
// vs.1.1 source and assembled into the DirectX 8 token stream by Yule Log's assembler (../yule/shaders.ts); a caller
// with the original files' debug comment tokens can pass them to make the streams token-for-token equal.
//   S  (skinned): two bones per vertex from the palette at c51 (three rows each, index * 3 in v3), lit by c20/c21
//   NS (rigid): world*view*proj in c8-c11; Munch: normal by c51 (world), diffuse from c20/c21; Blobby and Jelly:
//      normal by c12-c14 (inverse world*view), diffuse and specular with lit (power c19.w), alpha by the angle to the
//      eye (c26)
import { assemble, dst, src, Op, Reg, type Ins } from '../yule/shaders';

export { DECLARATION } from '../yule/shaders';

const OPS: Record<string, Op> = { mov: Op.MOV, add: Op.ADD, mad: Op.MAD, mul: Op.MUL, rsq: Op.RSQ, dp3: Op.DP3, dp4: Op.DP4, max: Op.MAX, lit: Op.LIT };
const REG: Record<string, Reg> = { r: Reg.R, v: Reg.V, c: Reg.C, a: Reg.A, oD: Reg.ATTROUT, oT: Reg.TEXOUT };

/** one operand: rN, vN, cN, c[a0.x+N], a0, oPos, oDN, oTN, with an optional -, .mask or .swizzle */
function operand(s: string, isDst: boolean) {
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const dot = s.endsWith(']') ? -1 : s.lastIndexOf('.');
  const name = dot < 0 ? s : s.slice(0, dot), sw = dot < 0 ? '' : s.slice(dot + 1);
  let t: Reg, n: number, rel = false;
  const m = /^c\[a0\.x\+(\d+)\]$/.exec(name);
  if (m) { t = Reg.C; n = +m[1]; rel = true; }
  else if (name === 'oPos') { t = Reg.RASTOUT; n = 0; }
  else {
    const k = /^(oD|oT|r|v|c|a)(\d+)$/.exec(name);
    if (!k) throw new Error('vs: operand ' + s);
    t = REG[k[1]]; n = +k[2];
  }
  return isDst ? dst(t, n, sw || 'xyzw') : src(t, n, sw || 'xyzw', neg, rel);
}
function asm(text: string): Ins[] {
  return text.trim().split('\n').map((l) => {
    const [op, rest] = l.trim().split(/\s+(.*)/);
    const args = rest.split(',').map((x) => x.trim());
    return [OPS[op], operand(args[0], true), ...args.slice(1).map((a) => operand(a, false))] as Ins;
  });
}

// the skinned shader, the same for the three scenes but for its last lines
const SKIN_HEAD = `
mov a0.x, v3.x
dp4 r0.x, v0, c[a0.x+51]
dp4 r0.y, v0, c[a0.x+52]
dp4 r0.z, v0, c[a0.x+53]
dp3 r2.x, v4, c[a0.x+51]
dp3 r2.y, v4, c[a0.x+52]
dp3 r2.z, v4, c[a0.x+53]
mov a0.x, v3.y
dp4 r1.x, v0, c[a0.x+51]
dp4 r1.y, v0, c[a0.x+52]
dp4 r1.z, v0, c[a0.x+53]
dp3 r3.x, v4, c[a0.x+51]
dp3 r3.y, v4, c[a0.x+52]
dp3 r3.z, v4, c[a0.x+53]
mul r0.xyz, r0.xyzz, v1.x
mad r1, r1.xyzz, v2.x, r0.xyzz
mov r1.w, c27.z
mul r2.xyz, r2.xyzz, v1.x
mad r3, r3.xyzz, v2.x, r2.xyzz
mov r3.w, c27.z
dp4 oPos.x, r1, c4
dp4 oPos.y, r1, c5
dp4 oPos.z, r1, c6
dp4 oPos.w, r1, c7
mov r0, r3
dp3 r0.w, r0, r0
rsq r0.w, r0.w
mul r0, r0, r0.w
mov r1, -c20
dp3 r1.w, r1, r1
rsq r1.w, r1.w
mul r1, r1, r1.w
dp3 r0.x, r1, r0
max r1, r0.x, c27.x`;
const UV = `
mov oT0.xy, v5
mov oT1.xy, v5`;

/** MunchS.vsh */
const MUNCH_S = asm(SKIN_HEAD + `
mul r1, r1.x, c21
add oD0, r1, c27.y` + UV);

/** BlobbyS.vsh, JellyS.vsh */
const SKIN_MAD = asm(SKIN_HEAD + `
mad oD0, r1.x, c27.z, c27.w
mul oD0, r1, c21` + UV);

/** MunchNS.vsh */
const MUNCH_NS = asm(`
dp4 oPos.x, v0, c8
dp4 oPos.y, v0, c9
dp4 oPos.z, v0, c10
dp4 oPos.w, v0, c11
dp3 r2.x, v4, c51
dp3 r2.y, v4, c52
dp3 r2.z, v4, c53
mov r2.w, c27.z
mov r0, r2
dp3 r0.w, r0, r0
rsq r0.w, r0.w
mul r0, r0, r0.w
mov r1, -c20
dp3 r1.w, r1, r1
rsq r1.w, r1.w
mul r1, r1, r1.w
dp3 r0.x, r1, r0
max r1, r0.x, c27.x
mul r1, r1.x, c21
add oD0, r1, c27.y
mov oD0.w, c27.x` + UV);

/** BlobbyNS.vsh / JellyNS.vsh: the same but for the diffuse term's clamp and colour */
function litNS(clamp: string, colour: string): Ins[] {
  return asm(`
dp4 oPos.x, v0, c8
dp4 oPos.y, v0, c9
dp4 oPos.z, v0, c10
dp4 oPos.w, v0, c11
dp3 r1.x, v4, c12
dp3 r1.y, v4, c13
dp3 r1.z, v4, c14
dp3 r1.w, r1, r1
rsq r1.w, r1.w
mul r1, r1, r1.w
dp3 r10.x, r1, -c20
max r10.x, r10.x, ${clamp}
mov r5, -c20
add r5, r5, c26
dp3 r5.w, r5, r5
rsq r5.w, r5.w
mul r5, r5, r5.w
dp3 r10.y, r1, r5
mov r10.w, c19.w
lit r11, r10
mov r3, c16
mov r10, c17
mad r3, r3, ${colour}, r10
mul oD0, r11.y, r3
mul oD1, r11.z, c18
dp3 r1.x, v4, c8
dp3 r1.y, v4, c9
dp3 r1.z, v4, c10
dp3 r1.w, r1, r1
rsq r1.w, r1.w
mul r1, r1, r1.w
dp3 r9.x, r1, -c26
max r4, r9.x, -r9.x
mad r4, r4, c27.w, r4
add oD0.w, c27.z, -r4.w` + UV);
}

/** the two shaders of each scene (S, NS), by the scene's name as MODELSET::Load builds the resource names */
export const SHADERS: Record<string, [Ins[], Ins[]]> = {
  MUNCH: [MUNCH_S, MUNCH_NS],
  BLOBBY: [SKIN_MAD, litNS('c27.x', 'c21')],
  JELLY: [SKIN_MAD, litNS('-r10.x', 'c27.z')],
};

/** the token streams of a scene's S and NS shaders (comments: VSO_<NAME>S / NS groups, when given) */
export function shaderTokens(name: string, comments?: Record<string, number[][]>): [Uint32Array, Uint32Array] {
  const [s, ns] = SHADERS[name];
  return [assemble(s, comments?.['VSO_' + name + 'S']), assemble(ns, comments?.['VSO_' + name + 'NS'])];
}
