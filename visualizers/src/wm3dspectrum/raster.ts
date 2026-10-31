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
// is skipped before its edges, and one whose edges cover none before its setup (most of the grid's triangles are
// slivers under a pixel wide). assembly/wm3dspectrum.ts runs the same steps in WebAssembly (kernel.ts).
import * as E from '../d3d8/ref/ext';

const fr = Math.fround;
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
/** PerTriangleSetup's snap: the 28.4 fixed-point bits of f32(v + 786432) (v a float: the sum is exact) */
export function snap(v: number): number { F1[0] = v + 786432; return (I1[0] << 10) >> 10; }

/** transformed vertices, struct of arrays */
export class Verts {
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly rhw: Float32Array;
  readonly X: Int32Array; readonly Y: Int32Array;
  /** the colour: index s of the palette (r, g, b at 3 s, 3 s + 1, 3 s + 2); -1 before the first frame */
  readonly s: Int32Array;
  /** the palette (Verts.s indexes it) */
  cols: Float32Array = new Float32Array(0);
  /** n vertices: in buf from byte at (7 arrays of n, kernel.ts's layout), else in arrays of their own */
  constructor(n: number, buf?: ArrayBuffer, at = 0) {
    const b = buf || new ArrayBuffer(28 * n), o = buf ? at : 0;
    this.x = new Float32Array(b, o, n); this.y = new Float32Array(b, o + 4 * n, n); this.z = new Float32Array(b, o + 8 * n, n);
    this.rhw = new Float32Array(b, o + 12 * n, n);
    this.X = new Int32Array(b, o + 16 * n, n); this.Y = new Int32Array(b, o + 20 * n, n);
    this.s = new Int32Array(b, o + 24 * n, n);
    this.s.fill(-1);
  }
}

/** the back buffer (0x00RRGGBB) and the depth buffer (u, 24 bits) */
export class Target {
  readonly px: Uint32Array; readonly zb: Uint32Array;
  /** in buf from byte at (px, then zb), else in arrays of their own */
  constructor(readonly w: number, readonly h: number, buf?: ArrayBuffer, at = 0) {
    this.px = buf ? new Uint32Array(buf, at, w * h) : new Uint32Array(w * h);
    this.zb = buf ? new Uint32Array(buf, at + 4 * w * h, w * h) : new Uint32Array(w * h);
  }
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
  private invDet = 0;
  private fX0 = 0; private fY0 = 0; private dX10 = 0; private dX02 = 0; private dY01 = 0; private dY20 = 0;
  private xmin = 0; private xmax = 0; private ymin = 0; private ymax = 0;
  /** the pixel centres inside the snapped bounding box: every covered pixel is one of them */
  private kx0 = 0; private kx1 = 0; private ky0 = 0; private ky1 = 0;
  private rh = new Plane(); private zp = new Plane();
  private pr = new Plane(); private pg = new Plane(); private pb = new Plane();
  private va = 0; private vb = 0; private vc = 0;
  private eA = new Float64Array(3); private eB = new Float64Array(3); private eC = new Float64Array(3); private eI = new Uint8Array(3);

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
    this.kx0 = k0; this.kx1 = k1;
    lo = ya < yb ? ya : yb; hi = ya < yb ? yb : ya;
    if (yc < lo) lo = yc; else if (yc > hi) hi = yc;
    k0 = (lo + 15) >> 4; k1 = hi >> 4;
    if (k0 < 0) k0 = 0;
    if (k1 > t.h - 1) k1 = t.h - 1;
    if (k0 > k1) return;
    this.ky0 = k0; this.ky1 = k1;
    // the edges: DrawTriangle's three (its rotation starting at the smallest x is the same three lines, the same
    // way round), flipped since the determinant is positive; the rest of the setup waits for a covered pixel
    this.edge(0, true, xa, ya, xb, yb);
    this.edge(1, true, xb, yb, xc, yc);
    this.edge(2, true, xc, yc, xa, ya);
    this.va = i0; this.vb = i1; this.vc = i2;
    this.scan();
  }

  /** DrawTriangle's order (the vertex with the smallest x, then y, first) and PerTriangleSetup; true = nothing to draw */
  private order(): boolean {
    const x = this.v.x, y = this.v.y, i0 = this.va, i1 = this.vb, i2 = this.vc;
    let best = 0, bx = x[i0], by = y[i0];
    if (x[i1] < bx || (x[i1] === bx && y[i1] < by)) { best = 1; bx = x[i1]; by = y[i1]; }
    if (x[i2] < bx || (x[i2] === bx && y[i2] < by)) best = 2;
    const a = best === 0 ? i0 : best === 1 ? i1 : i2, b = best === 0 ? i1 : best === 1 ? i2 : i0, c = best === 0 ? i2 : best === 1 ? i0 : i1;
    this.va = a; this.vb = b; this.vc = c;
    return this.setup(a, b, c);
  }

  /** the triangle's colour planes, set up at its first visible pixel (most cover none) */
  private colours(): void {
    this.rhw();
    const v = this.v, a = this.va, b = this.vb, c = this.vc, w0 = v.rhw[a], w1 = v.rhw[b], w2 = v.rhw[c];
    const C = v.cols, sa = 3 * v.s[a], sb = 3 * v.s[b], sc = 3 * v.s[c];
    this.plane(this.pr, C[sa], C[sb], C[sc], w0, w1, w2);
    this.plane(this.pg, C[sa + 1], C[sb + 1], C[sc + 1], w0, w1, w2);
    this.plane(this.pb, C[sa + 2], C[sb + 2], C[sc + 2], w0, w1, w2);
  }

  /** RefDev::DrawPoint for vertex i (size 1) */
  point(i: number): void {
    const v = this.v, t = this.t, px = v.x[i], py = v.y[i];
    const ax = fr(px - 0.5), ay = fr(py - 0.5), bx = fr(px + 0.5), cy = fr(py + 0.5);
    const X0 = snap(ax), Y0 = snap(ay), X1 = snap(bx), Y2 = snap(cy);
    // PerTriangleSetup(A, B, C): snap, determinant (no cull; the rhw plane is the constant rhw), bounding box
    if (X1 === X0 || Y2 === Y0) return;
    let x0 = Math.max(Math.trunc(ax + 0.5), 0), x1 = Math.min(Math.trunc(bx + 0.5), t.w - 1);
    let y0 = Math.max(Math.trunc(ay + 0.5), 0), y1 = Math.min(Math.trunc(cy + 0.5), t.h - 1);
    // the four edges A B, B D, D C, C A (D = (f32(x + 0.5), f32(y + 0.5)) snaps to (X1, Y2) like B and C), flipped
    // (X1 > X0, Y2 > Y0): by the top-left rule A B and C A exclude and B D and D C include their side of the edge
    // function, which leaves the pixel centres with X0 <= 16 x < X1 and Y0 <= 16 y < Y2
    if (x0 < (X0 + 15) >> 4) x0 = (X0 + 15) >> 4;
    if (x1 > (X1 - 1) >> 4) x1 = (X1 - 1) >> 4;
    if (y0 < (Y0 + 15) >> 4) y0 = (Y0 + 15) >> 4;
    if (y1 > (Y2 - 1) >> 4) y1 = (Y2 - 1) >> 4;
    if (x0 > x1 || y0 > y1) return;
    // constant planes: depth z, W = f32(1 / rhw), colour f32(f32(c * rhw) * W) (at the first pixel that passes)
    const z = v.z[i], u = Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5);
    const zb = t.zb, out = t.px, tw = t.w;
    let col = -1;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0, o = yy * tw + xx; xx <= x1; xx++, o++) {
        if (u > zb[o]) continue;
        zb[o] = u;
        if (col < 0) {
          const w = v.rhw[i], W = fr(1 / w), C = v.cols, k = 3 * v.s[i];
          col = (byte(fr(fr(C[k] * w) * W)) << 16) | (byte(fr(fr(C[k + 1] * w) * W)) << 8) | byte(fr(fr(C[k + 2] * w) * W));
        }
        out[o] = col;
      }
    }
  }

  /** PerTriangleSetup 0x1002701f; true = nothing to draw */
  private setup(a: number, b: number, c: number): boolean {
    const v = this.v;
    const X0 = v.X[a], Y0 = v.Y[a], X1 = v.X[b], Y1 = v.Y[b], X2 = v.X[c], Y2 = v.Y[c];
    const dX10 = X1 - X0, dY20 = Y2 - Y0, dX02 = X0 - X2, dY01 = Y0 - Y1;
    const det = dY20 * dX10 - dY01 * dX02;
    if (det <= 0) return true;
    // bounding box: trunc(min + 0.5) .. trunc(max + 0.5) of the float positions, clamped to the target
    const t = this.t, x = v.x, y = v.y;
    this.xmin = Math.max(Math.trunc(Math.min(x[a], x[b], x[c]) + 0.5), 0); this.xmax = Math.min(Math.trunc(Math.max(x[a], x[b], x[c]) + 0.5), t.w - 1);
    this.ymin = Math.max(Math.trunc(Math.min(y[a], y[b], y[c]) + 0.5), 0); this.ymax = Math.min(Math.trunc(Math.max(y[a], y[b], y[c]) + 0.5), t.h - 1);
    if (this.xmin > this.xmax || this.ymin > this.ymax) return true;
    this.fX0 = X0 * 0.0625; this.fY0 = Y0 * 0.0625;
    this.dX10 = dX10 * 0.0625; this.dX02 = dX02 * 0.0625; this.dY01 = dY01 * 0.0625; this.dY20 = dY20 * 0.0625;
    // 1 / f32(f32(det) / 256): the determinant rounded to float first (fildll; fstps)
    this.invDet = fr(1 / (fr(det) * 0.00390625));
    return false;
  }

  /** the rhw plane (0x100274eb, part of PerTriangleSetup: d1, d2 rounded to float), set up at the triangle's first
   *  visible pixel like the colours (it only feeds them) */
  private rhw(): void {
    const v = this.v, a = this.va, w0 = v.rhw[a], d1 = fr(v.rhw[this.vb] - w0), d2 = fr(v.rhw[this.vc] - w0), p = this.rh;
    p.A = sumMul32(this.dY20 * d1, this.dY01 * d2, this.invDet);
    p.B = sumMul32(this.dX10 * d2, this.dX02 * d1, this.invDet);
    p.C = subSub32(w0, p.A * this.fX0, p.B * this.fY0);
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

  /** DoScanCnvTri over the bounding box (three edges), column by column: each edge function is linear in y, so a
   *  column's covered pixels are one run, found from the three edges without visiting the rows outside it (most
   *  triangles are slivers under a pixel wide and many rows tall). A triangle's pixels never overlap, so the order
   *  they are tested and written in does not change the result; then the depth test and the pixel */
  private scan(): void {
    const t = this.t, zb = t.zb, out = t.px, tw = t.w;
    const rh = this.rh, zp = this.zp, pr = this.pr, pg = this.pg, pb = this.pb, v = this.v;
    const eA = this.eA, eB = this.eB, eC = this.eC, eI = this.eI;
    let ready = false, zs = false, cs = false;
    const y0 = this.ky0, y1 = this.ky1;
    for (let x = this.kx0; x <= this.kx1; x++) {
      // edge k at (x, y): 16 A x + 16 B y + C (less 1 unless inclusive), inside iff negative: integers, exact
      let lo = y0, hi = y1;
      for (let k = 0; k < 3 && lo <= hi; k++) {
        const b = 16 * eB[k], e = 16 * eA[k] * x + b * lo + eC[k] - (eI[k] ? 0 : 1);   // at row lo
        if (b === 0) { if (e >= 0) hi = lo - 1; continue; }
        if (b > 0) {        // inside iff lo + d with e + b d < 0: d <= dmax
          let d = Math.ceil(-e / b) - 1;
          while (e + b * (d + 1) < 0) d++;
          while (d >= 0 && e + b * d >= 0) d--;
          if (lo + d < hi) hi = lo + d;
        } else {            // inside iff d >= dmin
          let d = e < 0 ? 0 : Math.floor(e / -b) + 1;
          while (d > 0 && e + b * (d - 1) < 0) d--;
          while (e + b * d >= 0) d++;
          lo += d;
        }
      }
      for (let y = lo, o = lo * tw + x; y <= hi; y++, o += tw) {
        // the setup at the first covered pixel; then only those inside its bounding box
        if (!ready) { if (this.order()) return; ready = true; }
        if (x < this.xmin || x > this.xmax || y < this.ymin || y > this.ymax) continue;
        if (!zs) { zs = true; this.plane(zp, v.z[this.va], v.z[this.vb], v.z[this.vc], 1, 1, 1); }
        // depth (RDAttribute::Sample: f32((B y + A x) + C) at 64 bits), LESSEQUAL on u, written on a pass
        const z = E.sum32x3(zp.B * y, zp.A * x, zp.C);
        const u = Math.trunc((z > 1 ? 1 : z >= 0 ? z : 0) * 16777215 + 0.5);
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
