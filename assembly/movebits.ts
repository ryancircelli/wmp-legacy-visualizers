// AssemblyScript source of src/engine/movebits-wasm.ts (npm run build:wasm regenerates it).
// Alchemy's ShiftMoveBits core, the same integer ops as the JavaScript in src/engine/shift.ts:
//   gather  dst[i] = src[tab[i]] for i < n (an index outside [0, n) reads 0, as a JS typed array does)
//   blur    src[i] for i in [W, (H-1)*W): m = (sum of the 4 neighbours >>> 2) per field, out =
//           (3m + centre) >>> 2 per field, with R|B in one 0x00FF00FF lane pair and G in 0x0000FF00.
// The blur walks the interior as one linear run, so x = 0 reads the previous row's last pixel and
// x = W-1 the next row's first, exactly like the JS. blur1 (the tail) works on one pixel's fields,
// whose sums stay below 1024 << 16, so nothing carries between them; the vector loop on channels.
// Pointers are byte offsets of u32/i32 arrays in this module's memory, laid out by the JS glue.

const RB: u32 = 0x00FF00FF;
const GM: u32 = 0x0000FF00;

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize {
  return (__heap_base + 15) & ~(<usize>15);
}

// Four table entries an iteration: their range test in one vector compare, an entry outside [0, n)
// turned into index 0 (loaded, then masked to 0, as the scalar select does), the four loads by lane.
export function gather(src: usize, tab: usize, dst: usize, n: i32): void {
  const nn = i32x4.splat(n);
  let i = 0;
  for (; i + 4 <= n; i += 4) {
    const t = v128.load(tab + (<usize>i << 2));
    const ok = i32x4.lt_u(t, nn);
    const k = v128.and(t, ok);
    let v = i32x4.splat(load<u32>(src + (<usize>i32x4.extract_lane(k, 0) << 2)));
    v = i32x4.replace_lane(v, 1, load<u32>(src + (<usize>i32x4.extract_lane(k, 1) << 2)));
    v = i32x4.replace_lane(v, 2, load<u32>(src + (<usize>i32x4.extract_lane(k, 2) << 2)));
    v = i32x4.replace_lane(v, 3, load<u32>(src + (<usize>i32x4.extract_lane(k, 3) << 2)));
    v128.store(dst + (<usize>i << 2), v128.and(v, ok));
  }
  for (; i < n; i++) {
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

// Four pixels an iteration, each channel in its own 16-bit lane (bytes widened, the alpha byte too):
// a channel's 4-neighbour sum is at most 1020 and 3m + centre at most 1020, so the lanes never
// overflow, >> 2 is the fields' >>> 2, and the narrow back to bytes never saturates; the alpha lane is
// then cleared, as the fields' masks clear it. The same numbers per channel as blur1.
export function blur(src: usize, dst: usize, W: i32, H: i32): void {
  const end = (H - 1) * W;
  const wb = <usize>W << 2;
  const rgb = i32x4.splat(0x00FFFFFF);
  let i = W;
  for (; i + 4 <= end; i += 4) {
    const p = dst + (<usize>i << 2);
    const a = v128.load(p - wb), b = v128.load(p + wb), l = v128.load(p - 4), r = v128.load(p + 4), c = v128.load(p);
    const slo = i16x8.add(i16x8.add(i16x8.extend_low_i8x16_u(a), i16x8.extend_low_i8x16_u(b)),
      i16x8.add(i16x8.extend_low_i8x16_u(l), i16x8.extend_low_i8x16_u(r)));
    const shi = i16x8.add(i16x8.add(i16x8.extend_high_i8x16_u(a), i16x8.extend_high_i8x16_u(b)),
      i16x8.add(i16x8.extend_high_i8x16_u(l), i16x8.extend_high_i8x16_u(r)));
    const mlo = i16x8.shr_u(slo, 2), mhi = i16x8.shr_u(shi, 2);
    const olo = i16x8.shr_u(i16x8.add(i16x8.add(i16x8.shl(mlo, 1), mlo), i16x8.extend_low_i8x16_u(c)), 2);
    const ohi = i16x8.shr_u(i16x8.add(i16x8.add(i16x8.shl(mhi, 1), mhi), i16x8.extend_high_i8x16_u(c)), 2);
    v128.store(src + (<usize>i << 2), v128.and(i8x16.narrow_i16x8_u(olo, ohi), rgb));
  }
  for (; i < end; i++) blur1(src, dst, i, W);
}

export function moveBits(src: usize, tab: usize, dst: usize, W: i32, H: i32): void {
  gather(src, tab, dst, W * H);
  blur(src, dst, W, H);
}
