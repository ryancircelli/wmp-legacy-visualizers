// T3's object as the port keeps it. T3.dll is Grind.dll's engine built again (../grind): the same fields, some
// dropped (Grind's two other signs), the rest moved down. T3's own functions are written against T3's offsets;
// o3() turns each into Grind's (found by aligning the two DLLs' twin functions instruction by instruction) and that
// into the heap through Grind's own map (o, ../grind/layout.ts). Offsets below 0x94c are the framework's, the same.
// Runs of [T3 offset, Grind offset, dwords]:
import { o } from '../grind/layout';

const RUNS = [
  0x94c, 0x94c, 1414,
  0x1f64, 0x1f7c, 3,
  0x1f70, 0x1f94, 1,
  0x1f74, 0x1f9c, 8,
  0x1f94, 0x21c0, 34,
  0x201c, 0x2250, 210,
  0x2568, 0x3960, 1,
  0x266c, 0x279c, 97,
  0x27f0, 0x2950, 3,
  0x27fc, 0x2944, 3,
  0x2808, 0x2968, 102,
  0x2ff0, 0x3150, 1,
  0x30f4, 0x30f4, 133,
  0x33f0, 0x3550, 1,
  0x34f4, 0x34f4, 5,
  0x35f8, 0x3758, 66,
  0x3800, 0x3a64, 214,
  0x3efc, 0x3efc, 5,
  0x3f90, 0x41f4, 2,
  0x40fc, 0x40fc, 169,
  0x4c34, 0x4e98, 1,
  0x7ef0, 0x8154, 1,
  0xfbfc, 0xfbfc, 1,
  0x2ae20, 0x2af24, 6,
  0x2df94, 0x2e1f8, 186,
  0x2e284, 0x2e5b0, 32,
  0x2eb20, 0x2ee4c, 1,
  0x2f340, 0x2f66c, 1,
  0x2fb60, 0x2fe8c, 1,
  0x30380, 0x306ac, 1,
  0x30920, 0x30c4c, 1,
  0x30ec0, 0x311ec, 644];
/** T3 offset / 4 -> heap offset (-1: no field T3's code names) */
const H = new Int32Array(0x318d0 >> 2).fill(-1);
for (let i = 0; i < 0x94c >> 2; i++) H[i] = i << 2;
for (let i = 0; i < RUNS.length; i += 3) for (let k = 0; k < RUNS[i + 2]; k++) H[(RUNS[i] >> 2) + k] = o(RUNS[i + 1] + 4 * k);
/** the heap offset of T3's field at byte offset t */
export function o3(t: number): number {
  const p = H[t >> 2];
  if (p === undefined || p < 0) throw new Error('T3: no field at 0x' + t.toString(16));
  return p + (t & 3);
}
