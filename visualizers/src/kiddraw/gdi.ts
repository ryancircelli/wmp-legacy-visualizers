// Kid Drawing GDI subset: a software rasterizer for the plain GDI calls Dance.dll makes on its
// 32bpp memory DC (MM_TEXT, R2_COPYPEN, ALTERNATE fill), written to reproduce Windows GDI pixel for pixel.

const toRgb = (c: number): number => ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);

/** floor((a*b + c*e) / d), d > 0, exact for any integers (BigInt once a product leaves the exact double range). */
function mulAddDiv(a: number, b: number, c: number, e: number, d: number): number {
  const p = a * b;
  const q = c * e;
  if (Math.abs(p) + Math.abs(q) < 2 ** 52) return Math.floor((p + q) / d);
  const n = BigInt(a) * BigInt(b) + BigInt(c) * BigInt(e);
  const D = BigInt(d);
  const t = n / D; // truncates toward zero
  return Number(n < 0n && t * D !== n ? t - 1n : t);
}

/**
 * GDI's diamond around the pixel centre (16cx, 16cy) in 28.4 units: the open diamond |du|+|dv| < 8 plus its
 * right and bottom corners (no edges).
 */
function inDiamond(U: number, V: number, cx: number, cy: number): boolean {
  const du = U - 16 * cx;
  const dv = V - 16 * cy;
  const s = Math.abs(du) + Math.abs(dv);
  return s < 8 || (s === 8 && ((dv === 0 && du > 0) || (du === 0 && dv > 0)));
}

const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;
/** the control length of a 45-degree arc's Bezier, 4/3 tan(45/4 degrees) */
const KAPPA45 = (4 / 3) * Math.tan(Math.PI / 16);

/**
 * GDI's Bezier flattener (hybrid forward differencing in 32-bit fixed point), appending the points after the
 * start of the cubic c[o..o+7] to out. Basis per axis, relative to the curve's bounding box: e0 = value,
 * e1 = forward difference, e2/e3 = second differences at the far/near end. The step is halved (lazily at
 * first) until max(|e2|,|e3|) is within 6*0x2aa0 at 18.14 precision, re-halved or doubled while stepping.
 * Plain (non-wrapping) arithmetic, so it also stands in for GDI's 64-bit variant used past 1024 px.
 */
function flattenBezier(c: ArrayLike<number>, o: number, out: number[]): void {
  const TM = 6 * 0x2aa0;
  const TMN = TM * 8;
  const shr = (v: number, n: number): number => Math.floor(v / 2 ** n); // >> without int32 wrap
  const xl = Math.min(c[o], c[o + 2], c[o + 4], c[o + 6]);
  const yt = Math.min(c[o + 1], c[o + 3], c[o + 5], c[o + 7]);
  const basis = (p1: number, p2: number, p3: number, p4: number): number[] => [
    p1 * 1024,
    (p4 - p1) * 1024,
    6 * (p2 - p3 - p3 + p4) * 1024,
    6 * (p1 - p2 - p2 + p3) * 1024,
  ];
  const x = basis(c[o] - xl, c[o + 2] - xl, c[o + 4] - xl, c[o + 6] - xl);
  const y = basis(c[o + 1] - yt, c[o + 3] - yt, c[o + 5] - yt, c[o + 7] - yt);
  const err = (e: number[]): number => Math.max(Math.abs(e[2]), Math.abs(e[3]));
  const perr = (e: number[]): number => Math.max(Math.abs(e[3]), Math.abs(2 * e[2] - e[3]));
  let sh = 0;
  let steps = 1;
  while (err(x) > TM * 2 ** sh || err(y) > TM * 2 ** sh) {
    sh += 2;
    for (const e of [x, y]) {
      e[2] = shr(e[2] + e[3], 1);
      e[1] = shr(e[1] - shr(e[2], sh), 1);
    }
    steps *= 2;
  }
  for (const e of [x, y]) {
    e[0] *= 8;
    e[1] *= 8;
    e[2] = shr(e[2], sh - 3);
    e[3] = shr(e[3], sh - 3);
  }
  const step = (e: number[]): void => {
    const t = e[2];
    e[0] += e[1];
    e[1] += t;
    e[2] = t + t - e[3];
    e[3] = t;
  };
  step(x);
  step(y);
  steps--;
  for (;;) {
    out.push(shr(x[0] + 4096, 13) + xl, shr(y[0] + 4096, 13) + yt);
    if (steps === 0) return;
    if (Math.max(err(x), err(y)) > TMN) {
      for (const e of [x, y]) {
        e[2] = shr(e[2] + e[3], 3);
        e[1] = shr(e[1] - e[2], 1);
        e[3] = shr(e[3], 2);
      }
      steps *= 2;
    }
    while (steps % 2 === 0 && perr(x) <= TMN / 4 && perr(y) <= TMN / 4) {
      for (const e of [x, y]) {
        e[1] = 2 * e[1] + e[2];
        e[3] *= 4;
        e[2] = e[2] * 8 - e[3];
      }
      steps /= 2;
    }
    steps--;
    step(x);
    step(y);
  }
}

type Pen = readonly (readonly [number, number])[];
/** a pen polygon from its first quarter, turned three times by a quarter (screen (x, y) -> (y, -x)) */
const ring = (q: Pen): Pen => {
  const v: [number, number][] = [];
  for (let r = 0; r < 4; r++)
    for (const [x, y] of q) {
      let a = x,
        b = y;
      for (let k = 0; k < r; k++) [a, b] = [b, -a];
      v.push([a, b]);
    }
  return v;
};
/**
 * The round pens modelled (CreatePen(PS_SOLID, w)): the polygon GDI widens with, 28.4 offsets from the centre in the
 * order its caps run (counter-clockwise on screen), from the last vertex before straight up (pick() depends on it).
 */
const PENS: Record<number, Pen> = {
  3: ring([[8, -24], [-8, -24]]),
  5: ring([[8, -40], [-8, -40], [-24, -32], [-32, -24]]),
  8: [[46, -45], [0, -64], [-45, -45], [-64, 0], [-46, 45], [0, 64], [45, 45], [64, 0]],
}; // prettier-ignore

/**
 * The pen vertex a piece heading (dx, dy) is offset by on its left: the one most extreme along the left normal. When
 * the pen's edge e (V[e] to V[e+1]) is parallel to the piece, GDI takes V[e+1] for e in [n/4, 3n/4) and V[e]
 * otherwise. A zero-length piece counts as heading right.
 */
function pick(V: Pen, dx: number, dy: number): number {
  if (dx === 0 && dy === 0) dx = 1;
  const n = V.length;
  const c = (k: number): number => V[k][0] * dy - V[k][1] * dx;
  let m = 0;
  for (let k = 1; k < n; k++) if (c(k) > c(m)) m = k;
  const late = (e: number): boolean => e >= n / 4 && e < (3 * n) / 4;
  const pv = (m + n - 1) % n,
    nx = (m + 1) % n;
  if (c(pv) === c(m)) return late(pv) ? m : pv;
  if (c(nx) === c(m)) return late(m) ? nx : m;
  return m;
}

/**
 * GDI's widened outline of an open 28.4 polyline F with one heading per piece in D, for the round pen V: a cap at the
 * start (the left offset, the pen's vertices half way round, the right offset), along the right side, a cap at the
 * end, back along the left side. The offsets are pen vertices snapped to half pixels. Where two pieces meet, the
 * outer side turns through the pen's vertices between the two offsets and the inner side goes through the centre
 * point. Cap and join vertices are pulled one 28.4 unit toward the centre when the centre is on the pixel grid.
 */
function widen(F: number[], D: number[], V: Pen): number[] {
  const n = V.length,
    h = n / 2,
    m = D.length / 2;
  const J: number[] = [];
  for (let k = 0; k < m; k++) J.push(pick(V, D[2 * k], D[2 * k + 1]));
  const out: number[] = [];
  const off = (i: number, k: number): void => {
    out.push(F[2 * i] + Math.round(V[k][0] / 8) * 8, F[2 * i + 1] + Math.round(V[k][1] / 8) * 8);
  };
  const fan = (i: number, a: number, b: number): void => {
    const x = F[2 * i],
      y = F[2 * i + 1],
      g = x % 16 === 0 && y % 16 === 0 ? 1 : 0;
    for (let k = (a + 1) % n; k !== b; k = (k + 1) % n) out.push(x + V[k][0] - g * Math.sign(V[k][0]), y + V[k][1] - g * Math.sign(V[k][1]));
  };
  const join = (i: number, a: number, b: number): void => {
    if (a === b) return;
    if ((b - a + n) % n < h) fan(i, a, b);
    else out.push(F[2 * i], F[2 * i + 1]);
    off(i, b);
  };
  const o0 = (J[0] + h) % n;
  off(0, J[0]);
  fan(0, J[0], o0);
  off(0, o0);
  for (let k = 0; k < m; k++) {
    off(k + 1, (J[k] + h) % n);
    if (k + 1 < m) join(k + 1, (J[k] + h) % n, (J[k + 1] + h) % n);
  }
  fan(m, (J[m - 1] + h) % n, J[m - 1]);
  off(m, J[m - 1]);
  for (let k = m - 1; k > 0; k--) {
    off(k, J[k]);
    join(k, J[k], J[k - 1]);
  }
  return out;
}

export class Gdi {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;
  private cx = 0;
  private cy = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h);
  }

  /** FillRect: an inverted rectangle is normalised, not skipped. */
  fillRect(l: number, t: number, r: number, b: number, colorref: number): void {
    this.span(Math.min(l, r), Math.max(l, r), Math.min(t, b), Math.max(t, b), toRgb(colorref));
  }

  moveTo(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
  }

  lineTo(x: number, y: number, colorref: number): void {
    this.line(this.cx, this.cy, x, y, toRgb(colorref));
    this.cx = x;
    this.cy = y;
  }

  /**
   * Cosmetic pen from integer points: the 28.4 stroke below on whole-pixel points (Bresenham, ties to the
   * smaller minor coordinate). GDI refuses the call when, on either axis, max+1 >= 2^27 or max+1-min > 2^27.
   */
  private line(x0: number, y0: number, x1: number, y1: number, rgb: number): void {
    const bad = (a: number, b: number): boolean => Math.max(a, b) + 1 >= 2 ** 27 || Math.abs(a - b) + 1 > 2 ** 27;
    if (bad(x0, x1) || bad(y0, y1)) return;
    this.strokeFix(16 * x0, 16 * y0, 16 * x1, 16 * y1, rgb);
  }

  /**
   * GDI builds the ellipse as a closed path of four Beziers in 28.4 device units over the box shrunk by one
   * pixel at the right and bottom, flattens it, fills the polygon, then strokes it with the cosmetic pen.
   */
  ellipse(l: number, t: number, r: number, b: number, brushColorref: number, penColorref: number): void {
    if (l > r) [l, r] = [r, l];
    if (t > b) [t, b] = [b, t];
    if (l === r || t === b) return;
    const L = 16 * l,
      T = 16 * t,
      R = 16 * (r - 1),
      B = 16 * (b - 1);
    const cx = (L + R) / 2,
      cy = (T + B) / 2;
    // control offsets: 4(sqrt2-1)/3 of the half axes, rounded outward horizontally and inward vertically
    const ox = Math.ceil(KAPPA * (R - cx)),
      oy = Math.floor(KAPPA * (cy - T));
    const ctl = [
      R,
      cy,
      R,
      cy - oy,
      cx + ox,
      T,
      cx,
      T,
      cx - ox,
      T,
      L,
      cy - oy,
      L,
      cy,
      L,
      cy + oy,
      cx - ox,
      B,
      cx,
      B,
      cx + ox,
      B,
      R,
      cy + oy,
      R,
      cy,
    ];
    const pts = [R, cy];
    for (let q = 0; q < 4; q++) flattenBezier(ctl, 6 * q, pts);
    this.fillFix(pts, toRgb(brushColorref));
    const pen = toRgb(penColorref);
    for (let i = 2; i < pts.length; i += 2) this.strokeFix(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], pen);
  }

  /** Rectangle with a cosmetic pen: the outline on [l, r-1] x [t, b-1], the brush inside it. */
  rectangle(l: number, t: number, r: number, b: number, brushColorref: number, penColorref: number): void {
    if (l > r) [l, r] = [r, l];
    if (t > b) [t, b] = [b, t];
    if (l === r || t === b) return;
    this.span(l + 1, r - 1, t + 1, b - 1, toRgb(brushColorref));
    const pen = toRgb(penColorref);
    const xs = [l, r - 1, r - 1, l, l],
      ys = [t, t, b - 1, b - 1, t];
    for (let i = 0; i < 4; i++) this.line(xs[i], ys[i], xs[i + 1], ys[i + 1], pen);
  }

  /**
   * Arc(l, t, r, b, l, t, l, t): the whole ellipse, starting and ending on the radial through the box's top-left
   * corner (the only Arc this rasterizer models). GDI builds it over the box shrunk by one pixel at the right and
   * bottom, in 28.4: the start point at 135 degrees, centre - (a, b)/sqrt2 rounded; a 45-degree Bezier to the left
   * point, the ellipse's own quarters (as in ellipse()) round the bottom, right and top, and a 45-degree Bezier back
   * (controls 4/3 tan(11.25 deg) along the tangents, rounded). Nothing when the box has no width or height.
   * Exact against GDI for the cosmetic pen on any box with l < r and t < b, and for widths 3 and 5 on boxes of even
   * width and height (Shacojin's: 30,351 sizes each). Not yet fitted: wide pens on odd-sized boxes (edge pixels
   * differ), and boxes given right-to-left or bottom-to-top (GDI's start radial is then not the top-left one).
   */
  arc(l: number, t: number, r: number, b: number, colorref: number, width: number): void {
    if (l > r) [l, r] = [r, l];
    if (t > b) [t, b] = [b, t];
    if (l === r || t === b) return;
    const L = 16 * l,
      T = 16 * t,
      R = 16 * (r - 1),
      B = 16 * (b - 1);
    const cx = (L + R) / 2,
      cy = (T + B) / 2,
      a = (R - L) / 2,
      e = (B - T) / 2;
    const ox = Math.ceil(KAPPA * a),
      oy = Math.floor(KAPPA * e);
    const S = Math.SQRT1_2,
      H = KAPPA45,
      rd = Math.round;
    const sx = cx + rd(-a * S),
      sy = cy + rd(-e * S);
    const ctl = [
      sx, sy,
      rd(cx - a * (S + H * S)), rd(cy - e * (S - H * S)), rd(cx - a), rd(cy - e * H), L, cy,
      L, cy + oy, cx - ox, B, cx, B,
      cx + ox, B, R, cy + oy, R, cy,
      R, cy - oy, cx + ox, T, cx, T,
      rd(cx - a * H), rd(cy - e), rd(cx - a * (S - H * S)), rd(cy - e * (S + H * S)), sx, sy,
    ]; // prettier-ignore
    const rgb = toRgb(colorref);
    const pts = [sx, sy];
    // the pieces' headings: their chords, but a curve flattened to several pieces heads its first piece along its
    // start tangent and its last along its end tangent; zero-length pieces are dropped
    const F = [sx, sy],
      D: number[] = [];
    for (let q = 0; q < 5; q++) {
      const s0 = pts.length;
      flattenBezier(ctl, 6 * q, pts);
      const o = 6 * q,
        np = (pts.length - s0) / 2;
      for (let i = 0; i < np; i++) {
        const x = pts[s0 + 2 * i],
          y = pts[s0 + 2 * i + 1],
          px = pts[s0 + 2 * i - 2],
          py = pts[s0 + 2 * i - 1];
        if (x === px && y === py) continue;
        F.push(x, y);
        if (np > 1 && i === 0) D.push(ctl[o + 2] - ctl[o], ctl[o + 3] - ctl[o + 1]);
        else if (np > 1 && i === np - 1) D.push(ctl[o + 6] - ctl[o + 4], ctl[o + 7] - ctl[o + 5]);
        else D.push(x - px, y - py);
      }
    }
    if (width <= 1) {
      for (let i = 2; i < pts.length; i += 2) this.strokeFix(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], rgb);
      return;
    }
    const V = PENS[width];
    if (!V) throw new Error(`Gdi.arc: width ${width} is not modelled`);
    if (!D.length) {
      F.push(sx, sy);
      D.push(0, 0);
    }
    this.fillFix(widen(F, D, V), rgb, true);
  }

  polygon(xs: ArrayLike<number>, ys: ArrayLike<number>, brushColorref: number, penColorref: number): void {
    const n = xs.length;
    if (n < 2) return;
    const p: number[] = [];
    // GDI converts to 28.4 in 32 bits (wrapping) and draws nothing when the result spans 2^31 or more
    for (let i = 0; i < n; i++) p.push(xs[i] << 4, ys[i] << 4);
    for (let a = 0; a < 2; a++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < 2 * n; i += 2) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      if (hi - lo >= 2 ** 31) return;
    }
    this.fillFix(p, toRgb(brushColorref));
    const pen = toRgb(penColorref);
    for (let i = 0; i < 2 * n; i += 2) {
      const j = i + 2 === 2 * n ? 0 : i + 2;
      this.strokeFix(p[i], p[i + 1], p[j], p[j + 1], pen);
    }
  }

  /**
   * ALTERNATE (or WINDING) fill of a 28.4 polygon given as [X0,Y0,X1,Y1,...]: pixel (x,y) is filled when its centre
   * (16x,16y) is inside. Edges own their top row but not their bottom one; a crossing exactly on a centre
   * belongs to the span it starts.
   */
  private fillFix(p: ArrayLike<number>, rgb: number, winding = false): void {
    const n = p.length >> 1;
    let top = Infinity;
    let bot = -Infinity;
    for (let i = 0; i < n; i++) {
      top = Math.min(top, p[2 * i + 1]);
      bot = Math.max(bot, p[2 * i + 1]);
    }
    const y0 = Math.max(Math.ceil(top / 16), 0);
    const y1 = Math.min(Math.ceil(bot / 16), this.h); // rows with 16y in [top, bot)
    const cross: number[] = [];
    const wind: number[] = [];
    for (let y = y0; y < y1; y++) {
      const Y = 16 * y;
      cross.length = 0;
      wind.length = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        let xa = p[2 * i],
          ya = p[2 * i + 1],
          xb = p[2 * j],
          yb = p[2 * j + 1];
        const up = ya > yb;
        if (up) {
          [xa, xb] = [xb, xa];
          [ya, yb] = [yb, ya];
        }
        if (Y < ya || Y >= yb) continue;
        // first pixel whose centre is at or right of the crossing: ceil((xa + (Y-ya)(xb-xa)/(yb-ya)) / 16)
        cross.push(-mulAddDiv(-(Y - ya), xb - xa, -xa, yb - ya, 16 * (yb - ya)));
        wind.push(up ? -1 : 1);
      }
      if (!winding) {
        cross.sort((a, b) => a - b);
        for (let k = 0; k + 1 < cross.length; k += 2) this.span(cross[k], cross[k + 1], y, y + 1, rgb);
        continue;
      }
      const ord = cross.map((_, k) => k).sort((a, b) => cross[a] - cross[b]);
      for (let k = 0, w = 0, x0 = 0; k < ord.length; k++) {
        const w1 = w + wind[ord[k]];
        if (w === 0) x0 = cross[ord[k]];
        else if (w1 === 0) this.span(x0, cross[ord[k]], y, y + 1, rgb);
        w = w1;
      }
    }
  }

  /**
   * Geometric round-capped pen (widths 3, 5 and 8: PENS); width 0/1 is the cosmetic pen. GDI widens the segment into a
   * convex outline (widen(): two caps joined by the side offsets) and fills it; a zero-length segment counts as
   * heading right and leaves a dot.
   */
  wideLineTo(x: number, y: number, colorref: number, width: number): void {
    const x0 = this.cx,
      y0 = this.cy;
    this.cx = x;
    this.cy = y;
    if (width <= 1) return this.line(x0, y0, x, y, toRgb(colorref));
    const V = PENS[width];
    if (!V) throw new Error(`Gdi.wideLineTo: width ${width} is not modelled`);
    this.fillFix(widen([16 * x0, 16 * y0, 16 * x, 16 * y], [x - x0, y - y0], V), toRgb(colorref));
  }

  /** Fill [l,r) x [t,b), clipped. */
  private span(l: number, r: number, t: number, b: number, rgb: number): void {
    l = Math.max(l, 0);
    r = Math.min(r, this.w);
    t = Math.max(t, 0);
    b = Math.min(b, this.h);
    for (let y = t; y < b; y++) this.px.fill(rgb, y * this.w + l, y * this.w + Math.max(l, r));
  }

  /**
   * Cosmetic 1px line between 28.4 fixed-point points (how GDI strokes flattened curves), the end excluded.
   * Each integer step k along the major axis has one candidate pixel: the one whose diamond the line crosses
   * there (minor coordinate rounded to nearest, ties to the smaller; see tieUp). It is lit when the segment spans that
   * step or starts inside the diamond, and does not end inside it. A 45-degree line through the diamond
   * corners slides along diamond edges; GDI then lights the pixel at each step in [start, end), stepping along
   * x when going down and along y when going up, ties to the smaller minor except up-left (larger x).
   */
  private strokeFix(X0: number, Y0: number, X1: number, Y1: number, rgb: number): void {
    const dX = X1 - X0;
    const dY = Y1 - Y0;
    if (dX === 0 && dY === 0) return;
    const adX = Math.abs(dX);
    const adY = Math.abs(dY);
    const slide = adX === adY && (((X0 - Math.sign(dX * dY) * Y0) % 16) + 16) % 16 === 8;
    const xMajor = slide ? dY > 0 : adX > adY;
    const A0 = xMajor ? X0 : Y0;
    const B0 = xMajor ? Y0 : X0;
    const dA = xMajor ? dX : dY;
    const dB = xMajor ? dY : dX;
    const dir = dA > 0 ? 1 : -1;
    const lim = xMajor ? this.w : this.h;
    let k0: number;
    let k1: number; // inclusive candidate range of major steps
    if (slide) {
      // steps 16k in [A0, A1) along dir
      k0 = dir > 0 ? Math.ceil(A0 / 16) : Math.floor((A0 + dA) / 16) + 1;
      k1 = dir > 0 ? Math.ceil((A0 + dA) / 16) - 1 : Math.floor(A0 / 16);
    } else {
      k0 = Math.floor(Math.min(A0, A0 + dA) / 16) - 1;
      k1 = Math.ceil(Math.max(A0, A0 + dA) / 16) + 1;
    }
    k0 = Math.max(k0, 0);
    k1 = Math.min(k1, lim - 1);
    const adA = Math.abs(dA);
    const sB = dA > 0 ? dB : -dB; // minor change per +1 of major, times adA
    // segments of 2^21 px or more along the major axis switch GDI to its long-line DDA: ties round away from the start
    const tieUp = adA >= 2 ** 25 && dB > 0;
    for (let k = k0; k <= k1; k++) {
      const t = 16 * k - A0;
      let n: number;
      let cx: number;
      let cy: number;
      if (slide) {
        const b = B0 + t * Math.sign(sB); // an odd multiple of 8
        n = (b - 8) / 16 + (!xMajor && dX < 0 ? 1 : 0);
        cx = xMajor ? k : n;
        cy = xMajor ? n : k;
      } else {
        // minor at this step b = B0 + t*sB/adA; candidate ceil((b - 8) / 16), or floor((b + 8) / 16) when ties go up
        n = tieUp ? mulAddDiv(t, sB, B0 + 8, adA, 16 * adA) : -mulAddDiv(-t, sB, 8 - B0, adA, 16 * adA);
        cx = xMajor ? k : n;
        cy = xMajor ? n : k;
        const spans = t * dir >= 0 && t * dir <= adA;
        if (!((spans || inDiamond(X0, Y0, cx, cy)) && !inDiamond(X1, Y1, cx, cy))) continue;
      }
      if (cx >= 0 && cy >= 0 && cx < this.w && cy < this.h) this.px[cy * this.w + cx] = rgb;
    }
  }
}
