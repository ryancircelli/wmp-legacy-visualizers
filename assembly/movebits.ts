// AssemblyScript source of src/engine/movebits-wasm.ts (npm run build:wasm regenerates it).
// Alchemy's ShiftMoveBits core, the same integer ops as the JavaScript in src/engine/shift.ts:
//   gather  dst[i] = src[tab[i]] for i < n (an index outside [0, n) reads 0, as a JS typed array does)
//   blur    src[i] for i in [W, (H-1)*W): m = (sum of the 4 neighbours >>> 2) per field, out =
//           (3m + centre) >>> 2 per field, with R|B in one 0x00FF00FF lane pair and G in 0x0000FF00.
// The blur walks the interior as one linear run, so x = 0 reads the previous row's last pixel and
// x = W-1 the next row's first, exactly like the JS. Each 32-bit lane is one pixel; field sums stay
// below 1024 << 16, so nothing carries between fields or lanes, and every shift is unsigned.
// Pointers are byte offsets of u32/i32 arrays in this module's memory, laid out by the JS glue.

const RB: u32 = 0x00FF00FF;
const GM: u32 = 0x0000FF00;

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize {
  return (__heap_base + 15) & ~(<usize>15);
}

export function gather(src: usize, tab: usize, dst: usize, n: i32): void {
  for (let i = 0; i < n; i++) {
    const t = load<i32>(tab + (<usize>i << 2));
    const ok = <u32>t < <u32>n;
    const k: u32 = ok ? <u32>t : 0;                     // never load outside src
    const v = load<u32>(src + (<usize>k << 2));
    store<u32>(dst + (<usize>i << 2), ok ? v : 0);
  }
}

@inline function blur1(src: usize, dst: usize, i: i32, W: i32): void {
  const p = dst + (<usize>i << 2), wb = <usize>W << 2;
  const a = load<u32>(p - wb), b = load<u32>(p + wb), l = load<u32>(p - 4), r = load<u32>(p + 4), c = load<u32>(p);
  const m1 = (((a & RB) + (b & RB) + (l & RB) + (r & RB)) >>> 2) & RB;
  const m2 = (((a & GM) + (b & GM) + (l & GM) + (r & GM)) >>> 2) & GM;
  store<u32>(src + (<usize>i << 2), (((m1 * 3 + (c & RB)) >>> 2) & RB) | (((m2 * 3 + (c & GM)) >>> 2) & GM));
}

export function blur(src: usize, dst: usize, W: i32, H: i32): void {
  const end = (H - 1) * W;
  const wb = <usize>W << 2;
  const rb = i32x4.splat(RB), gm = i32x4.splat(GM);
  let i = W;
  for (; i + 4 <= end; i += 4) {
    const p = dst + (<usize>i << 2);
    const a = v128.load(p - wb), b = v128.load(p + wb), l = v128.load(p - 4), r = v128.load(p + 4), c = v128.load(p);
    const m1 = v128.and(i32x4.shr_u(i32x4.add(i32x4.add(i32x4.add(v128.and(a, rb), v128.and(b, rb)), v128.and(l, rb)), v128.and(r, rb)), 2), rb);
    const m2 = v128.and(i32x4.shr_u(i32x4.add(i32x4.add(i32x4.add(v128.and(a, gm), v128.and(b, gm)), v128.and(l, gm)), v128.and(r, gm)), 2), gm);
    const o1 = v128.and(i32x4.shr_u(i32x4.add(i32x4.add(i32x4.shl(m1, 1), m1), v128.and(c, rb)), 2), rb);
    const o2 = v128.and(i32x4.shr_u(i32x4.add(i32x4.add(i32x4.shl(m2, 1), m2), v128.and(c, gm)), 2), gm);
    v128.store(src + (<usize>i << 2), v128.or(o1, o2));
  }
  for (; i < end; i++) blur1(src, dst, i, W);
}

export function moveBits(src: usize, tab: usize, dst: usize, W: i32, H: i32): void {
  gather(src, tab, dst, W * H);
  blur(src, dst, W, H);
}
