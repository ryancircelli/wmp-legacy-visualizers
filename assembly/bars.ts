// AssemblyScript source of src/engine/bars-wasm.ts (npm run build:wasm regenerates it).
// Bars and Waves' per-frame drawing (src/engine/bars.ts), the same integer ops as the JavaScript there:
//   draw  DrawBars' draw half (0x18041d294) for bars 0..n-1: DrawLevelBar 0x18041db5c on history row
//         2i, then DrawPeakCap 0x18041dc84 on row 2i+1, both through the clipped inclusive rect fill
//         (0x18044b160), with the per-bar level/peak values the JS already computed in lv[]/pk[].
//   sink  FadeStep's history shift (0x18041d74c): v -= 1 for every entry with 0 <= v < H.
// The trail colours are compared with the terminator as JavaScript compares an Int32Array element with
// a Number (term is bg >>> 0, so an entry with bit 31 set never matches), hence the f64.
// Pointers are byte offsets of u32/i32 arrays in this module's memory, laid out by the JS glue.

/** First byte the glue may use (16-aligned). */
export function heapBase(): usize {
  return (__heap_base + 15) & ~(<usize>15);
}

// Both corners normalised, then clipped to the surface, never wrapped; y2 = H relies on the clip.
@inline function fillRect(px: usize, W: i32, H: i32, x1: i32, y1: i32, x2: i32, y2: i32, c: u32): void {
  let t: i32;
  if (x1 > x2) { t = x1; x1 = x2; x2 = t; }
  if (y1 > y2) { t = y1; y1 = y2; y2 = t; }
  if (x1 < 0) x1 = 0;
  if (y1 < 0) y1 = 0;
  if (x2 > W - 1) x2 = W - 1;
  if (y2 > H - 1) y2 = H - 1;
  if (x1 > x2 || y1 > y2) return;
  const wb = <usize>W << 2, n = <usize>(x2 - x1) << 2;
  let o = px + (<usize>(y1 * W + x1) << 2);
  const e = px + (<usize>(y2 * W + x1) << 2);
  if (n == 0) { for (; o <= e; o += wb) store<u32>(o, c); return; }   // a one-pixel column
  for (; o <= e; o += wb)
    for (let i = o, ie = o + n; i <= ie; i += 4) store<u32>(i, c);
}

export function draw(px: usize, W: i32, H: i32, hist: usize, lt: usize, pt: usize, lv: usize, pk: usize,
  n: i32, barW: i32, spacing: i32, xoff: i32, trail: i32, head: i32, term: f64, peaks: i32): void {
  let levelN = 0, peakMask = 0;
  while (levelN < 16 && <f64>load<i32>(lt + (<usize>levelN << 2)) != term) levelN++;
  for (let k = 0; k < 16; k++) if (<f64>load<i32>(pt + (<usize>k << 2)) != term) peakMask |= 1 << k;
  const lc0 = load<u32>(lt), pc0 = load<u32>(pt);
  for (let i = 0; i < n; i++) {
    const x = (barW + spacing) * i + xoff;
    let x2 = x + barW; if (x2 - 1 >= W - 1) x2 = W; x2--;

    // DrawLevelBar
    const level = load<i32>(lv + (<usize>i << 2));
    const h = level > 0 ? level : 0;
    const top = h < H - 1 ? h : H - 2;
    let drawn: i32;
    if (!trail) {
      if (top >= 0) fillRect(px, W, H, x, H - top, x2, H, lc0);
      drawn = top;
    } else {
      const row = hist + (<usize>(i << 5) << 2);         // row 2i, 16 entries
      store<i32>(row + (<usize>head << 2), top);
      let drawnTo = 0, pos = head;
      for (let k = 0; k < levelN; k++) {
        const v = load<i32>(row + (<usize>pos << 2));
        if (v >= drawnTo) {
          fillRect(px, W, H, x, H - v, x2, H - drawnTo, load<u32>(lt + (<usize>k << 2)));
          drawnTo = v + 1;
        }
        pos = (pos + 1) & 0xF;
      }
      drawn = drawnTo - 1;
    }
    if (!peaks) continue;

    // DrawPeakCap: `drawn` is a skip test, not a floor
    const peak = load<i32>(pk + (<usize>i << 2));
    const floor = drawn > 0 ? drawn : 1;
    const v = peak < H ? peak : -1;
    if (!trail) {
      if (v >= floor) fillRect(px, W, H, x, H - v, x2, H - v, pc0);
      continue;
    }
    const row = hist + (<usize>((i << 5) + 16) << 2);   // row 2i+1
    store<i32>(row + (<usize>head << 2), v);
    for (let k = 15; k >= 0; k--) {
      const q = row + (<usize>((head + k) & 0xF) << 2);
      let hv = load<i32>(q);
      if (hv >= H) { store<i32>(q, -1); hv = -1; }
      if ((peakMask >> k) & 1 && hv >= floor)
        fillRect(px, W, H, x, H - hv, x2, H - hv, load<u32>(pt + (<usize>k << 2)));
    }
  }
}

/** n is a multiple of 16 (trailRows * 16); H >= 2, so 0 <= v < H is v < H unsigned. */
export function sink(hist: usize, n: i32, H: i32): void {
  const hh = i32x4.splat(H);
  for (let k = 0; k < n; k += 4) {
    const p = hist + (<usize>k << 2), v = v128.load(p);
    v128.store(p, i32x4.add(v, i32x4.lt_u(v, hh)));
  }
}
