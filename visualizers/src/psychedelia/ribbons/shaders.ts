// Ribbons' post-processing effects (the DLL's RCDATA 101 Copy, 102 Emboss and 103 Box4x4Blur, compiled by D3DX9 when
// the device is made) as the programs the compiler makes of them. Each pass draws one screen quad of pre-transformed
// vertices (POSITIONT: the vertex shader is bypassed, but Copy's technique still sets its own).
//   Copy:       c0.x attenuation; out = texture * c0.x
//   Emboss:     c0, c1 texel offsets; out = tex(t + c1) - tex(t + c0) + 0.5
//   Box4x4Blur: c0..c3 texel offsets; out = the average of the four samples
import { Op, Reg, Usage, assemble, d, s } from '../asm9';

export const COPY_VS = assemble('vs', 0x101, [
  { op: Op.DCL, usage: Usage.POSITION, dst: d(Reg.V, 0) },
  { op: Op.DCL, usage: Usage.TEXCOORD, dst: d(Reg.V, 1) },
  { op: Op.MOV, dst: d(Reg.RASTOUT, 0), src: [s(Reg.V, 0)] },
  { op: Op.MOV, dst: d(Reg.OT, 0, 'xy'), src: [s(Reg.V, 1)] },
]);

export const COPY_PS = assemble('ps', 0x101, [
  { op: Op.DEF, dst: d(Reg.C, 1), v: [1, 0, 0, 0] },
  { op: Op.TEX, dst: d(Reg.T, 0), src: [] },
  { op: Op.DP3, dst: d(Reg.R, 0), src: [s(Reg.C, 1), s(Reg.C, 0)] },
  { op: Op.MUL, dst: d(Reg.R, 0), src: [s(Reg.T, 0), s(Reg.R, 0)] },
]);

export const EMBOSS_PS = assemble('ps', 0x200, [
  { op: Op.DEF, dst: d(Reg.C, 2), v: [0.5, 0, 0, 0] },
  { op: Op.DCL, usage: 0, dst: d(Reg.T, 0, 'xy') },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 0) },
  { op: Op.ADD, dst: d(Reg.R, 0, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 0)] },
  { op: Op.ADD, dst: d(Reg.R, 1, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 1)] },
  { op: Op.TEX, dst: d(Reg.R, 0), src: [s(Reg.R, 0), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 1), src: [s(Reg.R, 1), s(Reg.S, 0)] },
  { op: Op.ADD, dst: d(Reg.R, 0), src: [s(Reg.R, 0, 'xyzw', true), s(Reg.R, 1)] },
  { op: Op.ADD, dst: d(Reg.R, 0), src: [s(Reg.R, 0), s(Reg.C, 2, 'x')] },
  { op: Op.MOV, dst: d(Reg.OC, 0), src: [s(Reg.R, 0)] },
]);

export const BLUR_PS = assemble('ps', 0x200, [
  { op: Op.DEF, dst: d(Reg.C, 4), v: [0.25, 0, 0, 0] },
  { op: Op.DCL, usage: 0, dst: d(Reg.T, 0, 'xy') },
  { op: Op.DCL, sampler2d: true, dst: d(Reg.S, 0) },
  { op: Op.ADD, dst: d(Reg.R, 0, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 0)] },
  { op: Op.ADD, dst: d(Reg.R, 3, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 1)] },
  { op: Op.ADD, dst: d(Reg.R, 2, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 2)] },
  { op: Op.ADD, dst: d(Reg.R, 1, 'xy'), src: [s(Reg.T, 0), s(Reg.C, 3)] },
  { op: Op.TEX, dst: d(Reg.R, 0), src: [s(Reg.R, 0), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 3), src: [s(Reg.R, 3), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 2), src: [s(Reg.R, 2), s(Reg.S, 0)] },
  { op: Op.TEX, dst: d(Reg.R, 1), src: [s(Reg.R, 1), s(Reg.S, 0)] },
  { op: Op.ADD, dst: d(Reg.R, 0), src: [s(Reg.R, 0), s(Reg.R, 3)] },
  { op: Op.ADD, dst: d(Reg.R, 0), src: [s(Reg.R, 2), s(Reg.R, 0)] },
  { op: Op.ADD, dst: d(Reg.R, 0), src: [s(Reg.R, 1), s(Reg.R, 0)] },
  { op: Op.MUL, dst: d(Reg.R, 0), src: [s(Reg.R, 0), s(Reg.C, 4, 'x')] },
  { op: Op.MOV, dst: d(Reg.OC, 0), src: [s(Reg.R, 0)] },
]);
