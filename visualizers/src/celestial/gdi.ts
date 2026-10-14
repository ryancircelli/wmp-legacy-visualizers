// The GDI Celestial draws with, on its 32bpp DIB: Polyline / Polygon / Ellipse with a wide solid pen (CreatePen(PS_SOLID,
// w): round caps, round joins), solid brushes, ROP2 COPYPEN / MERGEPEN / XORPEN, PolyFillMode ALTERNATE. Written to give
// Windows GDI's pixels exactly. Coordinates are 28.4 fixed point (FIX, 16 per pixel) as GDI's path code keeps them.
//
// A wide line is widened into an outline and that outline is filled (WINDING): pixel (x, y) is lit when its centre
// (16x, 16y) is inside, edges owning their top row and the first pixel at or right of each crossing.
// The widener, as GDI's does it:
// - The pen is a polygon around the origin, kept as half a polygon P[0..n-1] whose ends overlap the other half
//   (P[0] = -P[n-2], P[n-1] = -P[1]); the whole pen is P[1..n-2] followed by its negation. Pens up to 6 px are fixed
//   shapes on the half-pixel grid; wider ones are the upper half of a circle of radius 8w built from two Beziers
//   (control offset r - floor(r * 0x729d7775 / 2^32)) and flattened as every curve is.
// - Each segment's offset: the pen vertex tangent to its direction (a binary search over the half polygon for where
//   the cross product with the edges changes sign), negated when the first edge's cross product is negative, then
//   snapped to the half-pixel grid (multiples of 8, ties away from zero). The right side runs at +offset, the left at
//   -offset.
// - Round caps and the outer side of round joins go around the pen's own vertices strictly between the two offsets,
//   each pulled one 28.4 unit towards the centre when the point is on the pixel grid; the inner side of a join goes
//   through the vertex itself. A figure with no length is a dot: both caps of a horizontal segment.
// - An open figure is one outline: start cap, right side, end cap, left side reversed. A closed figure is two: the
//   right side and the reversed left side.

const toRgb = (c: number): number => ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);

/** floor((a*b + c*e) / d), d > 0, exact for any integers (BigInt once a product leaves the exact double range). */
function mulAddDiv(a: number, b: number, c: number, e: number, d: number): number {
  const p = a * b, q = c * e;
  if (Math.abs(p) + Math.abs(q) < 2 ** 52) return Math.floor((p + q) / d);
  const n = BigInt(a) * BigInt(b) + BigInt(c) * BigInt(e), D = BigInt(d), t = n / D;
  return Number(n < 0n && t * D !== n ? t - 1n : t);
}

/**
 * GDI's Bezier flattener (hybrid forward differencing in 32-bit fixed point): the points after the start of the cubic
 * c[o..o+7] appended to out. Basis per axis relative to the curve's bounding box; the step halved until the second
 * differences are within 6*0x2aa0 at 18.14, re-halved or doubled while stepping.
 * ponytail: the 32-bit flattener only (GDI switches to a 64-bit one for curves past ~1024 px; pens here are < 100 px)
 */
export function flattenBezier(c: ArrayLike<number>, o: number, out: number[]): void {
  const TM = 6 * 0x2aa0, TMN = TM << 3;
  const xl = Math.min(c[o], c[o + 2], c[o + 4], c[o + 6]);
  const yt = Math.min(c[o + 1], c[o + 3], c[o + 5], c[o + 7]);
  const basis = (p1: number, p2: number, p3: number, p4: number): number[] =>
    [p1 << 10, (p4 - p1) << 10, (6 * (p2 - p3 - p3 + p4)) << 10, (6 * (p1 - p2 - p2 + p3)) << 10];
  const x = basis(c[o] - xl, c[o + 2] - xl, c[o + 4] - xl, c[o + 6] - xl);
  const y = basis(c[o + 1] - yt, c[o + 3] - yt, c[o + 5] - yt, c[o + 7] - yt);
  const err = (e: number[]): number => Math.max(Math.abs(e[2]), Math.abs(e[3]));
  const perr = (e: number[]): number => Math.max(Math.abs(e[3]), Math.abs(2 * e[2] - e[3]));
  let sh = 0, steps = 1;
  while (err(x) > TM << sh || err(y) > TM << sh) {
    sh += 2;
    for (const e of [x, y]) { e[2] = (e[2] + e[3]) >> 1; e[1] = (e[1] - (e[2] >> sh)) >> 1; }
    steps <<= 1;
  }
  for (const e of [x, y]) {
    e[0] = e[0] << 3; e[1] = e[1] << 3;
    if (sh < 3) { e[2] = e[2] << (3 - sh); e[3] = e[3] << (3 - sh); } else { e[2] = e[2] >> (sh - 3); e[3] = e[3] >> (sh - 3); }
  }
  const step = (e: number[]): void => { const t = e[2]; e[0] = e[0] + e[1]; e[1] = e[1] + t; e[2] = t + t - e[3]; e[3] = t; };
  step(x); step(y); steps--;
  for (;;) {
    out.push(((x[0] + 4096) >> 13) + xl, ((y[0] + 4096) >> 13) + yt);
    if (steps === 0) return;
    if (Math.max(err(x), err(y)) > TMN) {
      for (const e of [x, y]) { e[2] = (e[2] + e[3]) >> 3; e[1] = (e[1] - e[2]) >> 1; e[3] = e[3] >> 2; }
      steps <<= 1;
    }
    while (!(steps & 1) && perr(x) <= TMN >> 2 && perr(y) <= TMN >> 2) {
      for (const e of [x, y]) { e[1] = 2 * e[1] + e[2]; e[3] = e[3] << 2; e[2] = (e[2] << 3) - e[3]; }
      steps >>= 1;
    }
    steps--; step(x); step(y);
  }
}

/** The small pens (diameter up to 6 px): from the right side through the top to the left, in half pixels. Width 1 is
 *  the diamond, 2 a hexagon; 3..6 put a vertex at each odd column x < y with y = round(sqrt(w^2 - x^2)), mirrored about
 *  the diagonal, the right side closed by (w, +-1). */
function smallPen(w: number): number[] {
  if (w === 1) return [0, 1, 1, 0, 0, -1, -1, 0];
  if (w === 2) return [1, 2, 2, 0, 1, -2, -1, -2, -2, 0];
  const q: [number, number][] = [];                  // first octant from the top: (x, y), x <= y
  for (let x = 1; ; x += 2) {
    const y = Math.round(Math.sqrt(w * w - x * x));
    if (x > y) break;
    q.push([x, y]);
    if (x === y) break;
  }
  const quad: [number, number][] = [...q];          // top -> right: then the mirrored points, (y, x)
  for (let i = q.length - 1; i >= 0; i--) if (q[i][0] !== q[i][1]) quad.push([q[i][1], q[i][0]]);
  if (quad[quad.length - 1][1] !== 1) quad.push([w, 1]);
  // the record runs right side (w, 1) -> top -> left (-w, 1): screen y down, so "up" is negative y
  const out: number[] = [];
  for (let i = quad.length - 1; i >= 0; i--) out.push(quad[i][0], -quad[i][1]);
  out.unshift(quad[quad.length - 1][0], quad[quad.length - 1][1]);
  for (let i = 0; i < quad.length; i++) out.push(-quad[i][0], -quad[i][1]);
  out.push(-quad[quad.length - 1][0], quad[quad.length - 1][1]);
  return out;
}

/** a pen's half-polygon record P[0..n-1] (FIX) for a solid pen w pixels wide */
export function penRecord(w: number): Int32Array {
  if (w <= 6) return Int32Array.from(smallPen(Math.max(1, w)), (v) => v * 8);
  const r = 8 * w;
  const mulhi = (v: number): number => Math.floor((v * 0x729d7775) / 4294967296);
  const kx = r - mulhi(r), ky = -r - mulhi(-r);
  const c = [r, 0, r, ky, kx, -r, 0, -r, -kx, -r, -r, ky, -r, 0];
  const pts = [0, 0, r, 0];
  flattenBezier(c, 0, pts);
  flattenBezier(c, 6, pts);
  const n = pts.length >> 1;
  pts[0] = -pts[2 * (n - 2)]; pts[1] = -pts[2 * (n - 2) + 1];
  return Int32Array.from(pts);
}

interface Tangent { k: number; s: number; vx: number; vy: number }

class Pen {
  readonly P: Int32Array;
  readonly n: number;
  constructor(w: number) { this.P = penRecord(w); this.n = this.P.length >> 1; }

  /** the tangent vertex for direction (dx, dy) and the side offset (the snapped vertex, negated by its sign) */
  tangent(dx: number, dy: number): Tangent {
    const P = this.P, n = this.n;
    const cr = (k: number): number => (P[2 * k + 3] - P[2 * k + 1]) * dx - (P[2 * k + 2] - P[2 * k]) * dy;
    const s = cr(0) < 0 ? 1 : 0;
    let lo = 0, hi = n - 2;
    while (hi !== lo + 1) {
      const mid = lo + ((hi - lo) >> 1);
      if ((cr(mid) < 0 ? 1 : 0) === s) lo = mid; else hi = mid;
    }
    let vx = P[2 * hi], vy = P[2 * hi + 1];
    if (s) { vx = -vx; vy = -vy; }
    const snap = (v: number): number => (v + (v >> 31) + 4) & ~7;
    return { k: hi, s, vx: snap(vx), vy: snap(vy) };
  }

  /** pen vertex k of half s (0: as stored, 1: negated) as an offset from a point on the pixel grid (pulled in by 1) */
  vertex(k: number, s: number, out: number[], px: number, py: number, neg: boolean): void {
    let x = this.P[2 * k], y = this.P[2 * k + 1];
    if (s !== (neg ? 1 : 0)) { x = -x; y = -y; }
    if ((px | py) & 15) { out.push(px + x, py + y); return; }
    x = x > 0 ? x - 1 : x < 0 ? x + 1 : 0;
    y = y > 0 ? y - 1 : y < 0 ? y + 1 : 0;
    out.push(px + x, py + y);
  }

  /** a round cap's arc at (px, py): from the tangent t forward, half a turn, both ends excluded (into out) */
  cap(t: Tangent, s: number, out: number[], px: number, py: number): void {
    const n = this.n;
    let k = t.k + 1, sg = s;
    for (;;) {
      if (k > n - 2) { k = 1; sg ^= 1; }
      if (k === t.k && sg !== s) return;
      this.vertex(k, sg, out, px, py, false);
      k++;
    }
  }

  /** a round join's outer arc from tangent a to tangent b, strictly between; forward (dir 1, the right side, +v) or
   *  backward (dir 0, the left side, -v) */
  arc(a: Tangent, b: Tangent, dir: number, out: number[], px: number, py: number): void {
    if (a.k === b.k && a.s === b.s) return;
    const n = this.n, neg = dir === 0;
    let sg = a.s;
    if (dir) {
      let k = a.k + 1;
      while (k > b.k || sg !== b.s) {
        for (; k < n - 1; k++) this.vertex(k, sg, out, px, py, neg);
        sg ^= 1; k = 1;
      }
      for (; k < b.k; k++) this.vertex(k, sg, out, px, py, neg);
    } else {
      // backwards the walk wraps onto the record's last point (the other half's first): from the pen's first vertex
      // it passes that vertex again, as GDI's does
      let k = a.k - 1;
      while (k < b.k || sg !== b.s) {
        for (; k > 1; k--) this.vertex(k, sg, out, px, py, neg);
        sg ^= 1; k = n - 1;
      }
      for (; k > b.k; k--) this.vertex(k, sg, out, px, py, neg);
    }
  }
}

const pens = new Map<number, Pen>();
function penOf(w: number): Pen {
  let p = pens.get(w);
  if (!p) pens.set(w, (p = new Pen(w)));
  return p;
}

/** The outline figures (FIX) of a wide stroke along points q (FIX, consecutive duplicates already removed). dirs: each
 *  segment's direction for its offset and the joins' turns when it is not the chord (a curve's first and last
 *  flattened pieces take the curve's end tangents). */
export function widen(w: number, q: number[], closed: boolean, dirs: number[] | null = null): number[][] {
  const pen = penOf(w), m = q.length >> 1;
  const segs = closed ? m : m - 1;
  if (m === 1) {                                   // no length: a dot, both caps of a horizontal segment
    const t = pen.tangent(16, 0), px = q[0], py = q[1], out: number[] = [];
    out.push(px - t.vx, py - t.vy); pen.cap(t, t.s ^ 1, out, px, py); out.push(px + t.vx, py + t.vy);
    out.push(px + t.vx, py + t.vy); pen.cap(t, t.s, out, px, py); out.push(px - t.vx, py - t.vy);
    return [out];
  }
  const D: number[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % m;
    if (dirs) D.push(dirs[2 * i], dirs[2 * i + 1]); else D.push(q[2 * j] - q[2 * i], q[2 * j + 1] - q[2 * i + 1]);
  }
  const tan: Tangent[] = [];
  for (let i = 0; i < segs; i++) tan.push(pen.tangent(D[2 * i], D[2 * i + 1]));
  const right: number[] = [], left: number[] = [];
  const join = (i: number, a: number, b: number): void => {     // at point i, from segment a to segment b
    const px = q[2 * i], py = q[2 * i + 1], ta = tan[a], tb = tan[b];
    right.push(px + ta.vx, py + ta.vy); left.push(px - ta.vx, py - ta.vy);
    if (ta.vx === tb.vx && ta.vy === tb.vy) return;
    const ax = D[2 * a], ay = D[2 * a + 1], bx = D[2 * b], by = D[2 * b + 1];
    if (ax * by < bx * ay) { pen.arc(ta, tb, 1, right, px, py); left.push(px, py); }
    else { pen.arc(ta, tb, 0, left, px, py); right.push(px, py); }
    right.push(px + tb.vx, py + tb.vy); left.push(px - tb.vx, py - tb.vy);
  };
  if (!closed) {
    const t0 = tan[0], p0x = q[0], p0y = q[1];
    right.push(p0x - t0.vx, p0y - t0.vy); pen.cap(t0, t0.s ^ 1, right, p0x, p0y); right.push(p0x + t0.vx, p0y + t0.vy);
    for (let i = 1; i < m - 1; i++) join(i, i - 1, i);
    const tl = tan[segs - 1], pmx = q[2 * (m - 1)], pmy = q[2 * (m - 1) + 1];
    right.push(pmx + tl.vx, pmy + tl.vy); pen.cap(tl, tl.s, right, pmx, pmy); right.push(pmx - tl.vx, pmy - tl.vy);
    for (let i = left.length - 2; i >= 0; i -= 2) right.push(left[i], left[i + 1]);
    return [right];
  }
  for (let i = 1; i < m; i++) join(i, i - 1, i);
  join(0, m - 1, 0);
  const rev: number[] = [];
  for (let i = left.length - 2; i >= 0; i -= 2) rev.push(left[i], left[i + 1]);
  return [right, rev];
}

/** Spans of the figures' fill (FIX polygons), WINDING (nonzero) or ALTERNATE: cb(y, x0, x1) for [x0, x1). */
export function fillSpans(figs: number[][], winding: boolean, w: number, h: number, cb: (y: number, x0: number, x1: number) => void): void {
  let ne = 0;
  for (const p of figs) ne += p.length >> 1;
  // edges: ya < yb, the first scanline ys, dir +1 when the figure runs down
  const YA = new Int32Array(ne), YB = new Int32Array(ne), XA = new Int32Array(ne), XB = new Int32Array(ne), DIR = new Int8Array(ne);
  let top = Infinity, bot = -Infinity, m = 0;
  for (const p of figs) {
    const n = p.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const ya = p[2 * i + 1], yb = p[2 * j + 1];
      if (ya === yb) continue;
      if (ya < yb) { YA[m] = ya; YB[m] = yb; XA[m] = p[2 * i]!; XB[m] = p[2 * j]!; DIR[m] = 1; }
      else { YA[m] = yb; YB[m] = ya; XA[m] = p[2 * j]!; XB[m] = p[2 * i]!; DIR[m] = -1; }
      if (YA[m] < top) top = YA[m]!;
      if (YB[m] > bot) bot = YB[m]!;
      m++;
    }
  }
  if (!m) return;
  const y0 = Math.max(Math.ceil(top / 16), 0), y1 = Math.min(Math.ceil(bot / 16), h);
  if (y0 >= y1) return;
  // bucket the edges by their first scanline (linked lists)
  const head = new Int32Array(y1 - y0).fill(-1), next = new Int32Array(m);
  for (let e = 0; e < m; e++) {
    const ys = Math.max(Math.ceil(YA[e] / 16), y0);
    if (ys * 16 >= YB[e] || ys >= y1) continue;
    next[e] = head[ys - y0]!; head[ys - y0] = e;
  }
  const act = new Int32Array(m), xs = new Int32Array(m), ds = new Int8Array(m), key = new Int32Array(m);
  let na = 0;
  for (let y = y0; y < y1; y++) {
    const Y = 16 * y;
    for (let e = head[y - y0]; e >= 0; e = next[e]!) act[na++] = e;
    let k = 0;
    for (let i = 0; i < na; i++) { const e = act[i]; if (Y < YB[e]) act[k++] = e; }
    na = k;
    if (!na) continue;
    for (let i = 0; i < na; i++) {
      const e = act[i], ya = YA[e], yb = YB[e], xa = XA[e], dy = yb - ya;
      // first pixel whose centre is at or right of the crossing: ceil((xa + (Y-ya)(xb-xa)/(yb-ya)) / 16)
      const x = -mulAddDiv(-(Y - ya), XB[e] - xa, -xa, dy, 16 * dy);
      key[i] = (x << 2) | (DIR[e] + 1);              // sorts by x; the direction rides in the low bits
    }
    if (na > 24) key.subarray(0, na).sort();
    else for (let i = 1; i < na; i++) { const v = key[i]; let j = i; while (j > 0 && key[j - 1] > v) { key[j] = key[j - 1]!; j--; } key[j] = v; }
    for (let i = 0; i < na; i++) { const v = key[i]; xs[i] = v >> 2; ds[i] = (v & 3) - 1; }
    let wn = 0;
    for (let i = 0; i < na; i++) {
      const was = wn;
      wn = winding ? wn + ds[i] : wn ^ 1;
      if (was !== 0 || wn === 0) continue;
      let i2 = i + 1;
      for (; i2 < na; i2++) {
        wn = winding ? wn + ds[i2] : wn ^ 1;
        if (wn === 0) break;
      }
      const xa = Math.max(xs[i], 0), xb = Math.min(i2 < na ? xs[i2] : w, w);
      if (xb > xa) cb(y, xa, xb);
      i = i2;
    }
  }
}

const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;

export class Gdi {
  /** ROP2: 13 R2_COPYPEN, 15 R2_MERGEPEN, 7 R2_XORPEN */
  rop = 13;
  private penW = 1;
  private penC = 0;
  private penNull = false;
  private brushC = 0xffffff;

  readonly px: Uint32Array;
  readonly w: number;
  readonly h: number;
  constructor(px: Uint32Array, w: number, h: number) { this.px = px; this.w = w; this.h = h; }

  clear(): void { this.px.fill(0); }
  pen(colorref: number, width: number): void { this.penW = width; this.penC = toRgb(colorref); this.penNull = false; }
  nullPen(): void { this.penNull = true; }
  brush(colorref: number): void { this.brushC = toRgb(colorref); }

  /** ROP2 the colour into the figures' spans; skip: pixels already painted by this call's outline (Polygon and Ellipse
   *  fill their interior without the pen's pixels: each pixel is drawn once) */
  private paint(figs: number[][], winding: boolean, c: number, skip: Uint8Array | null = null, mark: Uint8Array | null = null): void {
    const px = this.px, W = this.w, rop = this.rop;
    fillSpans(figs, winding, this.w, this.h, (y, x0, x1) => {
      const o = y * W;
      for (let x = x0; x < x1; x++) {
        const i = o + x;
        if (skip && skip[i]) continue;
        if (mark) mark[i] = 1;
        px[i] = rop === 15 ? px[i] | c : rop === 7 ? px[i] ^ c : c;
      }
    });
  }

  private points(xs: ArrayLike<number>, ys: ArrayLike<number>, s: number, n: number): number[] {
    const q: number[] = [];
    for (let i = s; i < s + n; i++) {
      const x = 16 * xs[i], y = 16 * ys[i];
      if (q.length && q[q.length - 2] === x && q[q.length - 1] === y) continue;
      q.push(x, y);
    }
    return q;
  }

  /** the pen's outline of the points; mark: the pixels it painted */
  private stroke(q: number[], closed: boolean, mark: Uint8Array | null = null): void {
    if (this.penNull || !q.length) return;
    if (closed && q.length > 2 && q[0] === q[q.length - 2] && q[1] === q[q.length - 1]) q = q.slice(0, -2);
    this.paint(widen(this.penW, q, closed), true, this.penC, null, mark);
  }

  private mask(): Uint8Array | null {
    if (this.penNull) return null;
    if (!this.maskBuf) this.maskBuf = new Uint8Array(this.w * this.h);
    else this.maskBuf.fill(0);
    return this.maskBuf;
  }
  private maskBuf: Uint8Array | null = null;

  polyline(xs: ArrayLike<number>, ys: ArrayLike<number>, s: number, n: number): void {
    if (n < 2) return;
    this.stroke(this.points(xs, ys, s, n), false);
  }

  /** the outline (the pen), then the interior (ALTERNATE, the brush) where the outline did not paint */
  polygon(xs: ArrayLike<number>, ys: ArrayLike<number>, s: number, n: number): void {
    if (n < 2) return;
    const fill: number[] = [];
    for (let i = s; i < s + n; i++) fill.push(16 * xs[i], 16 * ys[i]);
    const m = this.mask();
    this.stroke(this.points(xs, ys, s, n), true, m);
    this.paint([fill], false, this.brushC, m);
  }

  /** GDI builds the ellipse as four Beziers in 28.4 over the box shrunk by one pixel at the right and bottom */
  ellipse(l: number, t: number, r: number, b: number): void {
    if (l > r) [l, r] = [r, l];
    if (t > b) [t, b] = [b, t];
    if (l === r || t === b) return;
    const L = 16 * l, T = 16 * t, R = 16 * (r - 1), B = 16 * (b - 1);
    const cx = (L + R) / 2, cy = (T + B) / 2;
    const ox = Math.ceil(KAPPA * (R - cx)), oy = Math.floor(KAPPA * (cy - T));
    const ctl = [R, cy, R, cy - oy, cx + ox, T, cx, T, cx - ox, T, L, cy - oy, L, cy, L, cy + oy, cx - ox, B, cx, B,
      cx + ox, B, R, cy + oy, R, cy];
    const pts = [R, cy];
    for (let k = 0; k < 4; k++) flattenBezier(ctl, 6 * k, pts);
    // filled, the ellipse is stroked along its flattened outline: each piece's own direction (with a hollow brush GDI
    // strokes the curves, the first and last piece of each taking the curve's end tangent; Celestial never does)
    const q: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      if (q.length && q[q.length - 2] === pts[i] && q[q.length - 1] === pts[i + 1]) continue;
      q.push(pts[i], pts[i + 1]);
    }
    q.length -= 2;                                 // the closing piece ends where the figure starts
    const m = this.mask();
    if (!this.penNull) this.paint(widen(this.penW, q, true), true, this.penC, null, m);
    this.paint([pts], false, this.brushC, m);
  }
}
