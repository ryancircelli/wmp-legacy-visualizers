// The engine vtable (obj+0, 0x10032784 in the gallery build): every engine method takes the object as its only
// argument and shares all state through it, and calls the others through this table. The port keeps the
// table: `vt(c, 0x230)` is the DLL's `call [eax+0x230]` (offsets are the gallery build's; the Winter Edition's
// table is 0x20 shorter between +0x2c and +0x6c and the port maps its calls onto these). Each module puts its
// methods in it (`VT[0x230 >> 2] = project`); a slot nobody filled is an unported path and throws.
import type { Core } from './core';

export type Method = (c: Core) => number;
export const VT: (Method | undefined)[] = [];

export function vt(c: Core, off: number): number {
  const f = VT[off >> 2];
  if (!f) throw new Error('PictureViz2: unported engine method E+0x' + off.toString(16));
  return f(c);
}

/** register methods: def({ 0x230: project, ... }) */
export function def(t: Record<number, Method>): void {
  for (const k in t) VT[+k >> 2] = t[k];
}
