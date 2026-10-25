// The part of Microsoft's Direct3D 9 reference rasterizer (d3dref9.dll, as ../d3d9/ref/rast.ts ports it) that
// 3D Spectrum Analyzer's scene reaches, specialised for its million vertices a frame: triangles and one-pixel points
// of one colour attribute (ps_3_0 `mov oC0, v0`) into an X8R8G8B8 back buffer with a D24S8 depth buffer (ZFUNC
// LESSEQUAL, depth written), no blending, culling CCW. Vertices arrive transformed (screen x, y, z, rhw as floats,
// the 28.4 snapped x and y) in struct-of-arrays form.
//
//  * triangles: DrawTriangle 0x10023262 (the smallest-x vertex first), PerTriangleSetup 0x1002701f (28.4 snap,
//    determinant, cull, bounding box, invDet, the rhw plane), RDEdge::Set 0x1002891d (top-left rule), the colour
//    planes perspective-correct (RDAttribute::Setup 0x10028ee1), the z plane linear (weights 1), each pixel's
//    W = f32(1 / f32(rhw plane)), EVAL f32(f32(plane) * W), the depth test u = trunc(clamp(z) * 16777215 + 0.5)
//    against the buffer's u, ClampToRange and trunc(c * 255 + 0.5) per channel.
//  * points (RefDev::DrawPoint 0x10022d53, size 1): the square A = (x - 0.5, y - 0.5), B = (x + 0.5, y - 0.5),
//    C = (x - 0.5, y + 0.5) through PerTriangleSetup (no cull), its fourth corner D = (x + 0.5, y + 0.5) rounded to
//    float before the snap like the others, scanned with four edges A, B, D, C; every plane constant: depth z, colour f32(f32(c * rhw) *
//    f32(1 / rhw)).
// Pixels are independent here (the shader takes no derivatives), so each covered pixel is tested and written in
// turn instead of in REF's 2x2 quads: the same result. A triangle whose snapped bounding box holds no pixel centre
// is skipped before its setup: it cannot cover one (most of the grid's triangles are smaller than a pixel).
import * as E from '../d3d8/ref/ext';

const fr = Math.fround;
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
/** PerTriangleSetup's snap: the 28.4 fixed-point bits of f32(v + 786432) (v a float: the sum is exact) */
export function snap(v: number): number { F1[0] = v + 786432; return (I1[0] << 10) >> 10; }

/** transformed vertices, struct of arrays */
export class Verts {
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly rhw: Float32Array;
  readonly X: Int32Array; readonly Y: Int32Array;
  /** the colour (r, g, b) */
  readonly r: Float32Array; readonly g: Float32Array; readonly b: Float32Array;
  constructor(n: number) {
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n); this.rhw = new Float32Array(n);
    this.X = new Int32Array(n); this.Y = new Int32Array(n);
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
  }
}

/** the back buffer (0x00RRGGBB) and the depth buffer (u, 24 bits) */
export class Target {
  readonly px: Uint32Array; readonly zb: Uint32Array;
  constructor(readonly w: number, readonly h: number) { this.px = new Uint32Array(w * h); this.zb = new Uint32Array(w * h); }
  /** Clear(TARGET | ZBUFFER, 0xff000000, 1.0, 0) */
  clear(): void { this.px.fill(0); this.zb.fill(16777215); }
}

/** a plane value * rhw = A x + B y + C */
class Plane { A = 0; B = 0; C = 0; }

const byte = (c: number): number => ((c > 1 ? 1 : c >= 0 ? c : 0) * 255 + 0.5) | 0;

// x87 chains rounded to float, each from its double evaluation where an error bound settles the float, else at 64 bits
/** f32(a - b) */
function sub32(a: number, b: number): number {
  const t = a - b, e = Math.abs(t) * E.EPS, r = fr(t - e);
  if (r === fr(t + e)) return r;
  E.ld(a); E.fsub(b); return E.st32();
}
/** f32((x + y) * inv) */
function sumMul32(x: number, y: number, inv: number): number {
  if (x === 0 && y === 0) return 0;
  const t = (x + y) * inv, e = (Math.abs(x) + Math.abs(y)) * Math.abs(inv) * E.EPS, r = fr(t - e);
  if (r === fr(t + e) && r !== 0) return r;
  E.ld(x); E.fadd(y); E.fmul(inv); return E.st32();
}
/** f32((p - a) - b) */
function subSub32(p: number, a: number, b: number): number {
  if (p === 0 && a === 0 && b === 0) return 0;
  const t = (p - a) - b, e = (Math.abs(p) + Math.abs(a) + Math.abs(b)) * E.EPS, r = fr(t - e);
  if (r === fr(t + e) && r !== 0) return r;
  E.ld(p); E.fsub(a); E.fsub(b); return E.st32();
}

export class Raster {
  private X = new Int32Array(3); private Y = new Int32Array(3);
  private det = 0; private invDet = 0;
  private fX0 = 0; private fY0 = 0; private dX10 = 0; private dX02 = 0; private dY01 = 0; private dY20 = 0;
  private xmin = 0; private xmax = 0; private ymin = 0; private ymax = 0;
  private rh = new Plane(); private zp = new Plane();
  private pr = new Plane(); private pg = new Plane(); private pb = new Plane();
  private s0 = 0; private s1 = 0; private va = 0; private vb = 0; private vc = 0;
  private eA = new Float64Array(4); private eB = new Float64Array(4); private eC = new Float64Array(4); private eI = new Uint8Array(4);

  constructor(private t: Target, private v: Verts) {}

  /** DrawTriangle for the vertices i0, i1, i2 (culling CCW) */
  triangle(i0: number, i1: number, i2: number): void {
    const v = this.v, t = this.t, X = v.X, Y = v.Y;
    // no pixel centre (integer coordinates, 16 k in 28.4) inside the snapped bounding box: nothing to draw
    const xa = X[i0], xb = X[i1], xc = X[i2], ya = Y[i0], yb = Y[i1], yc = Y[i2];
    // the determinant (any rotation of the three gives the same): zero or culled, nothing to draw
    if ((yc - ya) * (xb - xa) - (ya - yb) * (xa - xc) <= 0) return;
    let lo = xa < xb ? xa : xb, hi = xa < xb ? xb : xa;
    if (xc < lo) lo = xc; else if (xc > hi) hi = xc;
    let k0 = (lo + 15) >> 4, k1 = hi >> 4;
    if (k0 < 0) k0 = 0;
    if (k1 > t.w - 1) k1 = t.w - 1;
    if (k0 > k1) return;
    lo = ya < yb ? ya : yb; hi = ya < yb ? yb : ya;
    if (yc < lo) lo = yc; else if (yc > hi) hi = yc;
    k0 = (lo + 15) >> 4; k1 = hi >> 4;
    if (k0 < 0) k0 = 0;
    if (k1 > t.h - 1) k1 = t.h - 1;
    if (k0 > k1) return;
    // the vertex with the smallest x (then y) first
    const x = v.x, y = v.y;
    let best = 0, bx = x[i0], by = y[i0];
    if (x[i1] < bx || (x[i1] === bx && y[i1] < by)) { best = 1; bx = x[i1]; by = y[i1]; }
    if (x[i2] < bx || (x[i2] === bx && y[i2] < by)) best = 2;
    const a = best === 0 ? i0 : best === 1 ? i1 : i2, b = best === 0 ? i1 : best === 1 ? i2 : i0, c = best === 0 ? i2 : best === 1 ? i0 : i1;
    if (this.setup(a, b, c, true)) return;
    const flip = this.det > 0, SX = this.X, SY = this.Y;
    this.edge(0, flip, SX[0], SY[0], SX[1], SY[1]);
    this.edge(1, flip, SX[1], SY[1], SX[2], SY[2]);
    this.edge(2, flip, SX[2], SY[2], SX[0], SY[0]);
    this.va = a; this.vb = b; this.vc = c;
    this.scan(3);
  }

  /** the triangle's colour planes, set up at its first visible pixel (most cover none) */
  private colours(): void {
    const v = this.v, a = this.va, b = this.vb, c = this.vc, w0 = v.rhw[a], w1 = v.rhw[b], w2 = v.rhw[c];
    this.plane(this.pr, v.r[a], v.r[b], v.r[c], w0, w1, w2);
    this.plane(this.pg, v.g[a], v.g[b], v.g[c], w0, w1, w2);
    this.plane(this.pb, v.b[a], v.b[b], v.b[c], w0, w1, w2);
  }

  /** RefDev::DrawPoint for vertex i (size 1) */
  point(i: number): void {
    const v = this.v, t = this.t, px = v.x[i], py = v.y[i];
    const ax = fr(px - 0.5), ay = fr(py - 0.5), bx = fr(px + 0.5), cy = fr(py + 0.5);
    const X0 = snap(ax), Y0 = snap(ay), X1 = snap(bx), Y2 = snap(cy);
    // the same pixel-centre test as triangles' (the square's snapped box)
    let k0 = (X0 + 15) >> 4, k1 = X1 >> 4;
    if (k0 < 0) k0 = 0;
    if (k1 > t.w - 1) k1 = t.w - 1;
    if (k0 > k1) return;
    k0 = (Y0 + 15) >> 4; k1 = Y2 >> 4;
    if (k0 < 0) k0 = 0;
    if (k1 > t.h - 1) k1 = t.h - 1;
    if (k0 > k1) return;
    // PerTriangleSetup(A, B, C): snap, determinant, bounding box (no cull; the rhw plane is the constant rhw)
    const dX10 = X1 - X0, dY20 = Y2 - Y0;
    const det = dY20 * dX10;   // dY01 = dX02 = 0
    if (det === 0) return;
    this.xmin = Math.max(Math.trunc(ax + 0.5), 0); this.xmax = Math.min(Math.trunc(bx + 0.5), t.w - 1);
    this.ymin = Math.max(Math.trunc(ay + 0.5), 0); this.ymax = Math.min(Math.trunc(cy + 0.5), t.h - 1);
    const flip = det > 0;
    this.edge(0, flip, X0, Y0, X1, Y0);
    // D = (f32(x + 0.5), f32(y + 0.5)): rounded to float before its snap like B and C, so (X1, Y2)
    this.edge(1, flip, X1, Y0, X1, Y2);
    this.edge(2, flip, X1, Y2, X0, Y2);
    this.edge(3, flip, X0, Y2, X0, Y0);
    // constant planes: W = f32(1 / rhw), colour f32(f32(c * rhw) * W), depth z
    const w = v.rhw[i], W = fr(1 / w);
    const r = byte(fr(fr(v.r[i] * w) * W)), g = byte(fr(fr(v.g[i] * w) * W)), b = byte(fr(fr(v.b[i] * w) * W));
    const z = v.z[i], u = Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5), col = (r << 16) | (g << 8) | b;
    const zb = t.zb, out = t.px, tw = t.w;
    for (let yy = this.ymin; yy <= this.ymax; yy++) {
      if (!this.span(4, yy)) continue;
      for (let xx = this.s0, o = yy * tw + xx; xx <= this.s1; xx++, o++) if (u <= zb[o]) { zb[o] = u; out[o] = col; }
    }
  }

  /** PerTriangleSetup 0x1002701f; true = nothing to draw */
  private setup(a: number, b: number, c: number, cull: boolean): boolean {
    const v = this.v, X = this.X, Y = this.Y;
    const X0 = v.X[a], Y0 = v.Y[a], X1 = v.X[b], Y1 = v.Y[b], X2 = v.X[c], Y2 = v.Y[c];
    X[0] = X0; X[1] = X1; X[2] = X2; Y[0] = Y0; Y[1] = Y1; Y[2] = Y2;
    const dX10 = X1 - X0, dY20 = Y2 - Y0, dX02 = X0 - X2, dY01 = Y0 - Y1;
    const det = dY20 * dX10 - dY01 * dX02;
    this.det = det;
    if (det === 0 || (cull && det < 0)) return true;
    // bounding box: trunc(min + 0.5) .. trunc(max + 0.5) of the float positions, clamped to the target
    const t = this.t, x = v.x, y = v.y;
    this.xmin = Math.max(Math.trunc(Math.min(x[a], x[b], x[c]) + 0.5), 0); this.xmax = Math.min(Math.trunc(Math.max(x[a], x[b], x[c]) + 0.5), t.w - 1);
    this.ymin = Math.max(Math.trunc(Math.min(y[a], y[b], y[c]) + 0.5), 0); this.ymax = Math.min(Math.trunc(Math.max(y[a], y[b], y[c]) + 0.5), t.h - 1);
    if (this.xmin > this.xmax || this.ymin > this.ymax) return true;
    this.fX0 = X0 * 0.0625; this.fY0 = Y0 * 0.0625;
    this.dX10 = dX10 * 0.0625; this.dX02 = dX02 * 0.0625; this.dY01 = dY01 * 0.0625; this.dY20 = dY20 * 0.0625;
    // 1 / f32(f32(det) / 256): the determinant rounded to float first (fildll; fstps)
    this.invDet = fr(1 / (fr(det) * 0.00390625));
    // the rhw plane (0x100274eb): d1, d2 rounded to float
    const w0 = v.rhw[a], d1 = fr(v.rhw[b] - w0), d2 = fr(v.rhw[c] - w0), p = this.rh;
    p.A = sumMul32(this.dY20 * d1, this.dY01 * d2, this.invDet);
    p.B = sumMul32(this.dX10 * d2, this.dX02 * d1, this.invDet);
    p.C = subSub32(w0, p.A * this.fX0, p.B * this.fY0);
    return false;
  }

  /** RDEdge::Set 0x1002891d */
  private edge(k: number, flip: boolean, xa: number, ya: number, xb: number, yb: number): void {
    let A = ya - yb, B = xb - xa;
    if (flip) { A = -A; B = -B; }
    this.eA[k] = A; this.eB[k] = B; this.eC[k] = -(ya * B + xa * A);
    this.eI[k] = (A !== 0 ? A > 0 : B > 0) ? 1 : 0;
  }

  /** RDAttribute::Setup 0x10028ee1, as rast.ts's plane(): p0 = a0 w0 kept at 64 bits; d1 = f32(a1 w1 - p0),
   *  d2 = f32(a2 w2 - p0); A = f32((dY20 d1 + dY01 d2) * invDet), B = f32((dX02 d1 + dX10 d2) * invDet),
   *  C = f32((p0 - A fX0) - B fY0); the double evaluation where its error bound settles the float, else 64 bits */
  private plane(p: Plane, a0: number, a1: number, a2: number, w0: number, w1: number, w2: number): void {
    const p0 = a0 * w0, d2 = sub32(a2 * w2, p0), d1 = sub32(a1 * w1, p0), inv = this.invDet;
    const A = sumMul32(this.dY20 * d1, this.dY01 * d2, inv), B = sumMul32(this.dX02 * d1, this.dX10 * d2, inv);
    const C = subSub32(p0, A * this.fX0, B * this.fY0);
    p.A = A; p.B = B; p.C = C;
  }

  /** f32((A x + B y) + C) at 64 bits (EVAL's sum) */
  private static eval(p: Plane, px: number, py: number): number {
    const xa = p.A * px, yb = p.B * py, C = p.C, sm = (xa + yb) + C, e = (Math.abs(xa) + Math.abs(yb) + Math.abs(C)) * E.EPS;
    const lo = fr(sm - e);
    if (lo === fr(sm + e)) return lo;
    const ab = xa + yb;
    return ab - xa === yb && ab - yb === xa && sm - ab === C && sm - C === ab ? fr(sm) : E.sum32x3(xa, yb, C);
  }

  /** the pixels of row y inside all n edges, within the bounding box: [lo, hi] in this.s0, this.s1. Edge k at pixel
   *  (x, y) is 16 B y + 16 A x + C, inside iff that less (inclusive ? 0 : 1) is negative: integers, exact in doubles,
   *  so each edge bounds x by a division settled by testing its neighbours */
  private span(n: number, y: number): boolean {
    const A = this.eA, B = this.eB, C = this.eC, I = this.eI;
    let lo = this.xmin, hi = this.xmax;
    for (let k = 0; k < n; k++) {
      const a = 16 * A[k], K = 16 * B[k] * y + C[k] - (I[k] ? 0 : 1);
      if (a === 0) { if (K >= 0) return false; continue; }
      let x = Math.floor(-K / a);
      if (a > 0) {   // inside iff x < -K / a
        while (a * x + K >= 0) x--;
        while (a * (x + 1) + K < 0) x++;
        if (x < hi) hi = x;
      } else {       // inside iff x > -K / a
        while (a * x + K < 0) x--;
        while (a * (x + 1) + K >= 0) x++;
        if (x + 1 > lo) lo = x + 1;
      }
      if (lo > hi) return false;
    }
    this.s0 = lo; this.s1 = hi;
    return true;
  }

  /** DoScanCnvTri over the bounding box with n edges; then the depth test and the pixel */
  private scan(n: number): void {
    const t = this.t, zb = t.zb, out = t.px, tw = t.w;
    const rh = this.rh, zp = this.zp, pr = this.pr, pg = this.pg, pb = this.pb, v = this.v;
    let zs = false, cs = false;
    for (let y = this.ymin; y <= this.ymax; y++) {
      if (!this.span(n, y)) continue;
      if (!zs) { zs = true; this.plane(zp, v.z[this.va], v.z[this.vb], v.z[this.vc], 1, 1, 1); }
      for (let x = this.s0; x <= this.s1; x++) {
        // depth (RDAttribute::Sample: f32((B y + A x) + C) at 64 bits), LESSEQUAL on u, written on a pass
        const z = E.sum32x3(zp.B * y, zp.A * x, zp.C);
        const u = Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5), o = y * tw + x;
        if (u > zb[o]) continue;
        zb[o] = u;
        if (!cs) { cs = true; this.colours(); }
        // SampleAndInvertRHW: f32(1 / f32((A x + B y) + C)), 0 for a zero rhw
        const s = E.sum32x3(rh.A * x, rh.B * y, rh.C), W = s === 0 ? 0 : fr(1 / s);
        out[o] = (byte(fr(Raster.eval(pr, x, y) * W)) << 16) | (byte(fr(Raster.eval(pg, x, y) * W)) << 8) | byte(fr(Raster.eval(pb, x, y) * W));
      }
    }
  }
}
