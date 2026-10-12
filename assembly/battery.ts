// AssemblyScript source of src/engine/battery/kernel-wasm.ts (npm run build:wasm regenerates it).
// Two of Battery's whole-buffer passes (src/engine/battery/index.ts), the same integer results as
// the JavaScript there (its third, the warp gather, is no faster here than in JS, so it stays there):
//   blur     dst[p] = lut[src[p-w] + src[p-1] + src[p] + src[p+1] + src[p+w]] for p in [w, (h-1)*w):
//            rows 1..h-2 as one linear run, so x = 0 reads the previous row's last byte and x = w-1
//            the next row's first, exactly like the JS; rows 0 and h-1 stay with the JS.
//            lut[s] = min(max(floor(s/5) - 1, 1), 254), and floor(s/5) = q15mulr(s - 2, 6554) for
//            every s in [0, 1275] (5 * 255): checked exhaustively in tests/engine/battery-kernel.test.ts.
//   palette px[i] = pal[src[i]] for i < n
// Pointers are byte offsets in this module's memory, laid out by the JS glue.

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize {
  return (__heap_base + 15) & ~(<usize>15);
}

@inline function lut(s: i32): u8 {
  const q = (((s - 2) * 6554 + 0x4000) >> 15) - 1;
  return <u8>(q < 1 ? 1 : q > 254 ? 254 : q);
}

export function blur(src: usize, dst: usize, w: i32, h: i32): void {
  const end = (h - 1) * w;
  const wb = <usize>w;
  const two = i16x8.splat(2), k = i16x8.splat(6554), one = i16x8.splat(1), top = i16x8.splat(254);
  let p = w;
  for (; p + 16 <= end; p += 16) {
    const a = src + <usize>p;
    const u = v128.load(a - wb), d = v128.load(a + wb), l = v128.load(a - 1), c = v128.load(a), r = v128.load(a + 1);
    const lo = i16x8.add(i16x8.add(i16x8.add(i16x8.extend_low_i8x16_u(u), i16x8.extend_low_i8x16_u(d)),
      i16x8.add(i16x8.extend_low_i8x16_u(l), i16x8.extend_low_i8x16_u(r))), i16x8.extend_low_i8x16_u(c));
    const hi = i16x8.add(i16x8.add(i16x8.add(i16x8.extend_high_i8x16_u(u), i16x8.extend_high_i8x16_u(d)),
      i16x8.add(i16x8.extend_high_i8x16_u(l), i16x8.extend_high_i8x16_u(r))), i16x8.extend_high_i8x16_u(c));
    const qlo = i16x8.min_s(i16x8.max_s(i16x8.sub(i16x8.q15mulr_sat_s(i16x8.sub(lo, two), k), one), one), top);
    const qhi = i16x8.min_s(i16x8.max_s(i16x8.sub(i16x8.q15mulr_sat_s(i16x8.sub(hi, two), k), one), one), top);
    v128.store(dst + <usize>p, i8x16.narrow_i16x8_u(qlo, qhi));
  }
  for (; p < end; p++) {
    const a = src + <usize>p;
    store<u8>(dst + <usize>p, lut(<i32>load<u8>(a - wb) + <i32>load<u8>(a - 1) + <i32>load<u8>(a) + <i32>load<u8>(a + 1) + <i32>load<u8>(a + wb)));
  }
}

export function palette(src: usize, pal: usize, dst: usize, n: i32): void {
  for (let i = 0; i < n; i++) store<u32>(dst + (<usize>i << 2), load<u32>(pal + (<usize>load<u8>(src + <usize>i) << 2)));
}
