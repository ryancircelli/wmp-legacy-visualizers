// The Windows pieces Googly Moogly! draws through, reproduced exactly: shlwapi's ColorHLSToRGB, GDI's RoundRect (solid
// brush, the default 1-pixel black pen) and its cosmetic-pen LineTo, on a 32bpp memory DC in MM_TEXT / GM_COMPATIBLE.
// The 28.4 Bezier flattener, polygon fill and fixed-point line stepping are copied from kiddraw/gdi.ts (Kid Drawing's
// Ellipse, written alongside); ponytail: one copy per family until that file lands as a shared GDI module.

/** floor((a*b + c*e) / d), d > 0, exact for any integers (BigInt once a product leaves the exact double range). */
function mulAddDiv(a: number, b: number, c: number, e: number, d: number): number {
  const p = a * b, q = c * e;
  if (Math.abs(p) + Math.abs(q) < 2 ** 52) return Math.floor((p + q) / d);
  const n = BigInt(a) * BigInt(b) + BigInt(c) * BigInt(e), D = BigInt(d), t = n / D;
  return Number(n < 0n && t * D !== n ? t - 1n : t);
}

// ---- shlwapi ColorHLSToRGB (hue, luminance, saturation on 0..240): RGB as 0x00RRGGBB
function hueToRgb(n1: number, n2: number, h: number): number {
  if (h < 0) h += 240;
  if (h > 240) h -= 240;
  if (h < 40) return n1 + Math.trunc(((n2 - n1) * h + 20) / 40);
  if (h < 120) return n2;
  if (h < 160) return n1 + Math.trunc(((n2 - n1) * (160 - h) + 20) / 40);
  return n1;
}
export function hlsToRgb(h: number, l: number, s: number): number {
  // grey only for the "undefined" hue 160; any other hue at saturation 0 gives black
  if (s === 0) { const v = h === 160 ? Math.trunc((l * 255) / 240) : 0; return (v << 16) | (v << 8) | v; }
  const m2 = l <= 120 ? Math.trunc((l * (240 + s) + 120) / 240) : l + s - Math.trunc((l * s + 120) / 240);
  const m1 = 2 * l - m2;
  const c = (hh: number) => Math.trunc((hueToRgb(m1, m2, hh) * 255 + 120) / 240) & 255;
  return (c(h + 80) << 16) | (c(h) << 8) | c(h - 80);
}

// ---- RoundRect
/** GDI's 4(sqrt2-1)/3, the quarter-ellipse Bezier's control distance */
const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;

/**
 * GDI's Bezier flattener (hybrid forward differencing in 32-bit fixed point), appending the points after the
 * start of the cubic c[o..o+7] (28.4) to out. Basis per axis relative to the curve's box: value, forward
 * difference, second differences at the far/near end; the step halves until both second differences are within
 * 6*0x2aa0 at 18.14 precision, and halves or doubles while stepping.
 */
function flattenBezier(c: ArrayLike<number>, o: number, out: number[]): void {
  const TM = 6 * 0x2aa0, TMN = TM << 3;
  const xl = Math.min(c[o], c[o + 2], c[o + 4], c[o + 6]);
  const yt = Math.min(c[o + 1], c[o + 3], c[o + 5], c[o + 7]);
  const basis = (p1: number, p2: number, p3: number, p4: number): number[] =>
    [p1 << 10, (p4 - p1) << 10, (6 * (p2 - p3 - p3 + p4)) << 10, (6 * (p1 - p2 - p2 + p3)) << 10];
  const x = basis(c[o] - xl, c[o + 2] - xl, c[o + 4] - xl, c[o + 6] - xl);
  const y = basis(c[o + 1] - yt, c[o + 3] - yt, c[o + 5] - yt, c[o + 7] - yt);
  const err = (e: number[]) => Math.max(Math.abs(e[2]), Math.abs(e[3]));
  const perr = (e: number[]) => Math.max(Math.abs(e[3]), Math.abs(2 * e[2] - e[3]));
  let sh = 0, steps = 1;
  while (err(x) > TM << sh || err(y) > TM << sh) {
    sh += 2;
    for (const e of [x, y]) { e[2] = (e[2] + e[3]) >> 1; e[1] = (e[1] - (e[2] >> sh)) >> 1; }
    steps <<= 1;
  }
  for (const e of [x, y]) {
    e[0] <<= 3; e[1] <<= 3;
    if (sh < 3) { e[2] <<= 3 - sh; e[3] <<= 3 - sh; } else { e[2] >>= sh - 3; e[3] >>= sh - 3; }
  }
  const step = (e: number[]) => { const t = e[2]; e[0] += e[1]; e[1] += t; e[2] = t + t - e[3]; e[3] = t; };
  step(x); step(y); steps--;
  for (;;) {
    out.push(((x[0] + 4096) >> 13) + xl, ((y[0] + 4096) >> 13) + yt);
    if (steps === 0) return;
    if (Math.max(err(x), err(y)) > TMN) {
      for (const e of [x, y]) { e[2] = (e[2] + e[3]) >> 3; e[1] = (e[1] - e[2]) >> 1; e[3] >>= 2; }
      steps <<= 1;
    }
    while (!(steps & 1) && perr(x) <= TMN >> 2 && perr(y) <= TMN >> 2) {
      for (const e of [x, y]) { e[1] = 2 * e[1] + e[2]; e[3] <<= 2; e[2] = (e[2] << 3) - e[3]; }
      steps >>= 1;
    }
    steps--; step(x); step(y);
  }
}

/** a w x h byte mask: 0 outside, 1 pen, 2 brush */
interface Mask { w: number; h: number; m: Uint8Array }

/** ALTERNATE fill of a closed 28.4 polygon [X0,Y0,...]: a pixel whose centre is inside; edges own their top row. */
function fillFix(k: Mask, p: number[], v: number): void {
  const n = p.length >> 1;
  let top = Infinity, bot = -Infinity;
  for (let i = 0; i < n; i++) { top = Math.min(top, p[2 * i + 1]); bot = Math.max(bot, p[2 * i + 1]); }
  const y1 = Math.min(Math.ceil(bot / 16), k.h), cross: number[] = [];
  for (let y = Math.max(Math.ceil(top / 16), 0); y < y1; y++) {
    const Y = 16 * y;
    cross.length = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      let xa = p[2 * i], ya = p[2 * i + 1], xb = p[2 * j], yb = p[2 * j + 1];
      if (ya > yb) { [xa, xb] = [xb, xa]; [ya, yb] = [yb, ya]; }
      if (Y < ya || Y >= yb) continue;
      cross.push(-mulAddDiv(-(Y - ya), xb - xa, -xa, yb - ya, 16 * (yb - ya)));
    }
    cross.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cross.length; c += 2) {
      for (let x = Math.max(cross[c], 0); x < Math.min(cross[c + 1], k.w); x++) k.m[y * k.w + x] = v;
    }
  }
}

/** GDI's diamond around pixel centre (16cx, 16cy): |du|+|dv| < 8 plus its right and bottom corners */
function inDiamond(U: number, V: number, cx: number, cy: number): boolean {
  const du = U - 16 * cx, dv = V - 16 * cy, s = Math.abs(du) + Math.abs(dv);
  return s < 8 || (s === 8 && ((dv === 0 && du > 0) || (du === 0 && dv > 0)));
}

/** Cosmetic 1-pixel line between 28.4 points, the end excluded (how GDI strokes a flattened curve). */
function strokeFix(k: Mask, X0: number, Y0: number, X1: number, Y1: number, v: number): void {
  const dX = X1 - X0, dY = Y1 - Y0;
  if (dX === 0 && dY === 0) return;
  const adX = Math.abs(dX), adY = Math.abs(dY);
  const slide = adX === adY && (((X0 - Math.sign(dX * dY) * Y0) % 16) + 16) % 16 === 8;
  const xMajor = slide ? dY > 0 : adX > adY;
  const A0 = xMajor ? X0 : Y0, B0 = xMajor ? Y0 : X0, dA = xMajor ? dX : dY, dB = xMajor ? dY : dX;
  const dir = dA > 0 ? 1 : -1;
  let k0: number, k1: number;
  if (slide) {
    k0 = dir > 0 ? Math.ceil(A0 / 16) : Math.floor((A0 + dA) / 16) + 1;
    k1 = dir > 0 ? Math.ceil((A0 + dA) / 16) - 1 : Math.floor(A0 / 16);
  } else {
    k0 = Math.floor(Math.min(A0, A0 + dA) / 16) - 1;
    k1 = Math.ceil(Math.max(A0, A0 + dA) / 16) + 1;
  }
  k0 = Math.max(k0, 0);
  k1 = Math.min(k1, (xMajor ? k.w : k.h) - 1);
  const adA = Math.abs(dA), sB = dA > 0 ? dB : -dB;
  for (let s = k0; s <= k1; s++) {
    const t = 16 * s - A0;
    let n: number;
    if (slide) n = (B0 + t * Math.sign(sB) - 8) / 16 + (!xMajor && dX < 0 ? 1 : 0);
    else n = -mulAddDiv(-t, sB, 8 - B0, adA, 16 * adA);
    const cx = xMajor ? s : n, cy = xMajor ? n : s;
    if (!slide) {
      const spans = t * dir >= 0 && t * dir <= adA;
      if (!((spans || inDiamond(X0, Y0, cx, cy)) && !inDiamond(X1, Y1, cx, cy))) continue;
    }
    if (cx >= 0 && cy >= 0 && cx < k.w && cy < k.h) k.m[cy * k.w + cx] = v;
  }
}

/**
 * RoundRect(0, 0, w, h, ew, eh) with a brush and the default pen, as a w x h mask (0 outside, 1 pen, 2 brush).
 * GDI builds the path in 28.4 over the box less one pixel at the right and bottom: from the right edge's top end,
 * counter-clockwise, four quarter-ellipse Beziers (radii 8*ew, 8*eh scaled to that box) joined by the straight sides (the control
 * points kappa of a radius in, rounded up across and down along the vertical); it flattens it, fills it, strokes it.
 */
export function roundRectMask(w: number, h: number, ew: number, eh: number): Uint8Array {
  const k: Mask = { w, h, m: new Uint8Array(w * h) };
  const pts = roundRectPath(w, h, ew, eh);
  fillFix(k, pts.slice(0, -2), 2);
  for (let i = 2; i < pts.length; i += 2) strokeFix(k, pts[i - 2], pts[i - 1], pts[i], pts[i + 1], 1);
  return k.m;
}

/** the flattened, closed 28.4 path (the start repeated at the end) */
export function roundRectPath(w: number, h: number, ew: number, eh: number): number[] {
  // the corner radii (8*ew, 8*eh in 28.4) scale with the box as it loses its right column and bottom row
  const L = 0, T = 0, R = 16 * (w - 1), B = 16 * (h - 1);
  const rx = Math.round((8 * ew * (w - 1)) / w), ry = Math.round((8 * eh * (h - 1)) / h);
  const ox = Math.ceil(KAPPA * rx), oy = Math.floor(KAPPA * ry);
  const pts = [R, T + ry];
  const bez = (c: number[]) => flattenBezier(c, 0, pts);
  const line = (x: number, y: number) => { pts.push(x, y); };
  bez([R, T + ry, R, T + ry - oy, R - rx + ox, T, R - rx, T]);
  line(L + rx, T);
  bez([L + rx, T, L + rx - ox, T, L, T + ry - oy, L, T + ry]);
  line(L, B - ry);
  bez([L, B - ry, L, B - ry + oy, L + rx - ox, B, L + rx, B]);
  line(R - rx, B);
  bez([R - rx, B, R - rx + ox, B, R, B - ry + oy, R, B - ry]);
  pts.push(R, T + ry);                       // the close
  return pts;
}

// ---- LineTo
/**
 * Cosmetic 1-pixel line between integer points into px (w x h), the end excluded, clipped: Bresenham along the
 * major axis, the minor offset after k steps k*minor/major rounded to nearest, ties up in octants 3, 5, 6, 8.
 */
export function line(px: Uint32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, rgb: number): void {
  const dx = x1 - x0, dy = y1 - y0, adx = Math.abs(dx), ady = Math.abs(dy), xMajor = adx > ady;
  const bias = (dy > 0 && dx <= 0 && !xMajor) || (dy <= 0 && dx < 0) || (dy <= 0 && dx > 0 && xMajor) ? 1 : 0;
  const maj = xMajor ? adx : ady, min = xMajor ? ady : adx;
  if (maj === 0) return;
  const majInc = (xMajor ? dx : dy) > 0 ? 1 : -1, minInc = (xMajor ? dy : dx) > 0 ? 1 : -1;
  const m0 = xMajor ? x0 : y0, n0 = xMajor ? y0 : x0, lim = xMajor ? w : h, nlim = xMajor ? h : w;
  const k0 = Math.max(majInc > 0 ? -m0 : m0 - (lim - 1), 0), k1 = Math.min(majInc > 0 ? lim - m0 : m0 + 1, maj);
  if (k0 >= k1) return;
  let m = Math.floor((2 * min * k0 + maj - 1 + bias) / (2 * maj));
  let err = 2 * min * (k0 + 1) - maj - 2 * maj * m;
  for (let s = k0; s < k1; s++) {
    const a = m0 + majInc * s, n = n0 + minInc * m;
    if (n >= 0 && n < nlim) px[xMajor ? n * w + a : a * w + n] = rgb;
    if (err + bias > 0) { m++; err -= 2 * maj; }
    err += 2 * min;
  }
}
