// Bubbles' effect (the DLL's RCDATA 120, compiled by D3DX9 when the device is made; FUN_0f3032d0) as the programs
// the compiler makes of it: one vertex shader for every technique, and the three pixel shaders of the techniques
// AlbumArt (the first bubble), Solid (Random, Centered, Gravity) and Glass (Pop; the same program as Solid, its first
// sampler bound to the fresnel texture instead of the diffuse one).
//   vertex constants: c0..c3 world * view * projection (transposed), c4.x radius, c5.xyz colour, c6.xy position
import { Op, Reg, Usage, assemble, d, s } from '../asm9';

export const VS = assemble('vs', 0x101, [
  { op: Op.DCL, usage: Usage.POSITION, dst: d(Reg.V, 0) },
  { op: Op.DCL, usage: Usage.TEXCOORD, dst: d(Reg.V, 1) },
  { op: Op.MOV, dst: d(Reg.R, 0, 'w'), src: [s(Reg.C, 4, 'x')] },
  { op: Op.MAD, dst: d(Reg.R, 0, 'xy'), src: [s(Reg.V, 0), s(Reg.R, 0, 'w'), s(Reg.C, 6)] },
  { op: Op.MOV, dst: d(Reg.R, 0, 'zw'), src: [s(Reg.V, 0)] },
  { op: Op.DP4, dst: d(Reg.RASTOUT, 0, 'x'), src: [s(Reg.R, 0), s(Reg.C, 0)] },
  { op: Op.DP4, dst: d(Reg.RASTOUT, 0, 'y'), src: [s(Reg.R, 0), s(Reg.C, 1)] },
  { op: Op.DP4, dst: d(Reg.RASTOUT, 0, 'z'), src: [s(Reg.R, 0), s(Reg.C, 2)] },
  { op: Op.DP4, dst: d(Reg.RASTOUT, 0, 'w'), src: [s(Reg.R, 0), s(Reg.C, 3)] },
  { op: Op.MOV, dst: d(Reg.ATTROUT, 0, 'xyz'), src: [s(Reg.C, 5)] },
  { op: Op.MOV, dst: d(Reg.OT, 0, 'xy'), src: [s(Reg.V, 1)] },
]);

/** AlbumArt: s0 diffuse, s1 album art, s2 specular; rgb = art * diffuse + specular, a = specular.a */
export const PS_ALBUM = assemble('ps', 0x200, [
  { op: Op.DCL, usage: 0, dst: d(Reg.T, 0, 'xy') },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 0) },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 1) },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 2) },
  { op: Op.TEX, dst: d(Reg.R, 2), src: [s(Reg.T, 0), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 1), src: [s(Reg.T, 0), s(Reg.S, 1)] },
  { op: Op.TEX, dst: d(Reg.R, 0), src: [s(Reg.T, 0), s(Reg.S, 2)] },
  { op: Op.MAD, dst: d(Reg.R, 0, 'xyz'), src: [s(Reg.R, 1), s(Reg.R, 2), s(Reg.R, 0)] },
  { op: Op.MOV, dst: d(Reg.OC, 0), src: [s(Reg.R, 0)] },
]);

/** Solid / Glass: s0 diffuse or fresnel, s1 specular; rgb = tex * colour + specular, a = specular.a */
export const PS_SOLID = assemble('ps', 0x200, [
  { op: Op.DCL, usage: 0, dst: d(Reg.V, 0, 'xyz') },
  { op: Op.DCL, usage: 0, dst: d(Reg.T, 0, 'xy') },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 0) },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 1) },
  { op: Op.TEX, dst: d(Reg.R, 1), src: [s(Reg.T, 0), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 0), src: [s(Reg.T, 0), s(Reg.S, 1)] },
  { op: Op.MAD, dst: d(Reg.R, 0, 'xyz'), src: [s(Reg.R, 1), s(Reg.V, 0), s(Reg.R, 0)] },
  { op: Op.MOV, dst: d(Reg.OC, 0), src: [s(Reg.R, 0)] },
]);
