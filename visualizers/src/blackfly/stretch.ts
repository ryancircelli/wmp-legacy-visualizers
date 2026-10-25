// Fire Dancer's present (FireDancer.dll 0x426813..0x42694c): the 320x384 8-bit frame StretchBlt'd to the window,
// as our own model of what GDI does with that one call, measured on Windows' own GDI (a 320x384 8bpp bottom-up DIB
// section with a SetDIBColorTable palette, blitted into a 32bpp DIB section; probe images that encode the source
// coordinates, single pixels and lines on grey, random rows and random images with random palettes).
//
// The DLL: ratio = H / 384; SetStretchBltMode(HALFTONE) when ratio < 1, else COLORONCOLOR; dw = Round(320 ratio)
// (halves to even); dx = (W - dw) div 2 (toward zero); PatBlt(BLACKNESS) the bars either side; StretchBlt(dx, 0, dw,
// H <- 0, 0, 320, 384). Where dx < 0 the stretch is clipped to the window.
//
// COLORONCOLOR (H >= 384): each destination pixel takes one source pixel, column and row independently: destination
// d of D takes source floor((2d + 1) S / 2D), the source pixel under its centre, except that GDI special-cases one
// pixel either way: D = S + 1 repeats the last source pixel, D = S - 1 drops it.
//
// HALFTONE (H < 384): an area average, then a sharpen, on the palette colours (each of R, G, B alone; no dither, a
// flat colour comes out unchanged):
//  1. edges: source pixel s spans destination [E(s), E(s+1)) with E(s) = floor(s D 8192 / S), in 1/8192 of a
//     destination pixel; a destination pixel's weights are its overlaps with the source pixels, summing to 8192
//  2. each source row is averaged across: (sum w c + 4096) >> 13, an integer
//  3. those rows are averaged down with the row weights and kept in 1/8192 units
//  4. a 4-neighbour sharpen on that: (12 c - up - down - left - right) / 8, floored, clamped to 0..255; past the
//     edges of the stretched image a pixel is its own neighbour
// The 13-bit edges matter only where D / S is not a binary fraction (dw 319 or 167, H 383 or 200, say); elsewhere the
// average is exact.
// Not modelled: before all this GDI sometimes softens 2x2 checkers in the source (colours a b / b a): the brighter
// pair moves toward its four neighbours, round((12 p + n + s + e + w) / 16) for a lone checker, more where checkers
// chain. Whether it fires depends on the rest of the image in a way we have not pinned down (any busy, many-valued
// content seems to switch it off), so frames of a few flat colours with diagonal pairs (sparse sparks on black) can
// differ there; continuous-tone frames come out exact.
import { delphiRound } from './common';

const SW = 320, SH = 384;

/** one axis of a HALFTONE stretch, S -> D: destination d's weights are w[o[d] .. o[d+1]) on sources s0[d] + k */
interface Axis { s0: Int32Array; o: Int32Array; w: Int32Array }

function axis(S: number, D: number): Axis {
  const s0 = new Int32Array(D).fill(-1), o = new Int32Array(D + 1), w: number[] = [];
  const E = (s: number) => Math.floor((s * D * 8192) / S);   // exact: s D 8192 stays below 2^53
  let s = 0;
  for (let d = 0; d < D; d++) {
    const a = d * 8192, b = a + 8192;
    while (E(s + 1) <= a) s++;
    s0[d] = s;
    for (let t = s; t < S && E(t) < b; t++) w.push(Math.min(b, E(t + 1)) - Math.max(a, E(t)));
    o[d + 1] = w.length;
  }
  return { s0, o, w: Int32Array.from(w) };
}

/** COLORONCOLOR: the source pixel destination d takes, S -> D */
function nearest(S: number, D: number): Int32Array {
  const m = new Int32Array(D);
  for (let d = 0; d < D; d++) m[d] = D === S + 1 ? Math.min(d, S - 1) : D === S - 1 ? d : Math.floor(((2 * d + 1) * S) / (2 * D));
  return m;
}

interface Plan {
  W: number; H: number; dx: number; dw: number; halftone: boolean;
  col?: Int32Array; row?: Int32Array;                 // COLORONCOLOR
  ax?: Axis; ay?: Axis;                               // HALFTONE
  h?: Int32Array; v?: Int32Array;                     // HALFTONE scratch: rows averaged across (3 x 384 x dw), then down (3 x H x dw)
}

let plan: Plan | null = null;

function makePlan(W: number, H: number): Plan {
  const ratio = H / SH, dw = delphiRound(SW * ratio), dx = Math.trunc((W - dw) / 2);
  if (ratio >= 1) return { W, H, dx, dw, halftone: false, col: nearest(SW, dw), row: nearest(SH, H) };
  return { W, H, dx, dw, halftone: true, ax: axis(SW, dw), ay: axis(SH, H), h: new Int32Array(3 * SH * dw), v: new Int32Array(3 * H * dw) };
}

/** The frame as Fire Dancer presents it: idx 320x384 palette indices (top row first), pal 256 x 0x00RRGGBB, out the
 *  W x H window (0x00RRGGBB, top row first), black bars included. */
export function stretchPresent(idx: Uint8Array, pal: Uint32Array, W: number, H: number, out: Uint32Array): void {
  if (!plan || plan.W !== W || plan.H !== H) plan = makePlan(W, H);
  const { dx, dw } = plan;
  const x0 = Math.max(0, dx), x1 = Math.min(W, dx + dw);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    out.fill(0, r, r + x0);
    out.fill(0, r + Math.max(x0, x1), r + W);
  }
  if (x1 <= x0) return;
  if (!plan.halftone) {
    const col = plan.col!, row = plan.row!;
    for (let y = 0; y < H; y++) {
      const s = row[y] * SW, r = y * W;
      for (let x = x0; x < x1; x++) out[r + x] = pal[idx[s + col[x - dx]]]!;
    }
    return;
  }
  const { ax, ay } = plan as Required<Plan>, h = plan.h!, v = plan.v!, n = SH * dw, m = H * dw;
  // 2: each source row across, per channel (h[c n + y dw + d])
  for (let y = 0; y < SH; y++) {
    const srow = y * SW, hrow = y * dw;
    for (let d = 0; d < dw; d++) {
      let r = 4096, g = 4096, b = 4096, s = srow + ax.s0[d];
      for (let k = ax.o[d], e = ax.o[d + 1]; k < e; k++, s++) {
        const c = pal[idx[s]], w = ax.w[k];
        r += w * (c >>> 16); g += w * ((c >>> 8) & 255); b += w * (c & 255);
      }
      h[hrow + d] = r >> 13; h[n + hrow + d] = g >> 13; h[2 * n + hrow + d] = b >> 13;
    }
  }
  // 3: down (v[c m + y dw + d], 1/8192 units)
  for (let y = 0; y < H; y++) {
    const vrow = y * dw, e = ay.o[y + 1];
    for (let c = 0; c < 3; c++) {
      const vc = c * m + vrow, hc = c * n;
      for (let d = 0; d < dw; d++) v[vc + d] = 0;
      for (let k = ay.o[y], s = ay.s0[y]; k < e; k++, s++) {
        const w = ay.w[k], hr = hc + s * dw;
        for (let d = 0; d < dw; d++) v[vc + d] += w * h[hr + d];
      }
    }
  }
  // 4: sharpen, edges repeated; only the window's columns
  for (let y = 0; y < H; y++) {
    const up = (y > 0 ? y - 1 : 0) * dw, dn = (y < H - 1 ? y + 1 : y) * dw, me = y * dw, r = y * W;
    for (let x = x0; x < x1; x++) {
      const d = x - dx, l = d > 0 ? d - 1 : 0, rt = d < dw - 1 ? d + 1 : d;
      let px = 0;
      for (let c = 0, sh = 16; c < 3; c++, sh -= 8) {
        const b = c * m;
        let q = (12 * v[b + me + d] - v[b + up + d] - v[b + dn + d] - v[b + me + l] - v[b + me + rt]) >> 16;
        q = q < 0 ? 0 : q > 255 ? 255 : q;
        px |= q << sh;
      }
      out[r + x] = px;
    }
  }
}
