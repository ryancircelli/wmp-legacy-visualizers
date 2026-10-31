// Fixed-function lighting as d3dref9.dll's RefVP does it: UpdateLightingData 0x10048ac2 (material, ambient, each
// light's ProcessLight 0x100481eb and XformLight 0x10048d59), and per vertex LightVertex 0x10047ffb with
// RDLV_PointAndSpot 0x10048620. All of it in 0..255 units, in the x87's 64-bit precision (../../d3d8/ref/ext).
// Point and spot lights only.
import * as E from '../../d3d8/ref/ext';

const fr = Math.fround;
const F1 = new Float32Array(1), I1 = new Int32Array(F1.buffer);
/** a float's bits as a signed integer (REF compares many floats that way) */
const bits = (x: number): number => { F1[0] = x; return I1[0]; };
const FLT_MAX = 3.4028234663852886e38;

type X = [number, number];
/** 64-bit (hi, lo) arithmetic, each result rounded to 64 bits */
const xm = (a: X, b: X): X => { const h = E.mul(a[0], a[1], b[0], b[1]); return [h, E.lo()]; };
const xa = (a: X, b: X): X => { const h = E.add(a[0], a[1], b[0], b[1]); return [h, E.lo()]; };
const xs = (a: X, b: X): X => { const h = E.add(a[0], a[1], -b[0], -b[1]); return [h, E.lo()]; };
/** a b - c d of floats (each product exact) at 64 bits */
const mn = (a: number, b: number, c: number, d: number): X => xs([a * b, 0], [c * d, 0]);
/** a qword store: the value rounded to double */
const q = (a: X): X => [a[0], 0];

/** Inverse4x4 0x10048dbd's upper 3x3 (all the normals use): cofactors with the 64-bit intermediates the code keeps on
 *  the FPU stack and the double ones it spills, 1 / det at 64 bits, each element f32(cofactor * (1 / det)). A
 *  singular matrix gives the identity (as REF's). */
export function inverse3(m: Float32Array, o: Float32Array): void {
  const v = (i: number): X => [m[i], 0];
  const A = q(mn(m[6], m[11], m[10], m[7])), B = q(mn(m[15], m[10], m[14], m[11])), C64 = mn(m[6], m[15], m[7], m[14]);
  const C = q(C64), D = q(mn(m[2], m[11], m[10], m[3])), Em = q(mn(m[2], m[7], m[6], m[3])), G = q(mn(m[2], m[15], m[3], m[14]));
  const c0 = xa(xm(A, v(13)), xs(xm(B, v(5)), xm(C, v(9))));
  const c1 = q(xs(xs(xm(D, v(5)), xm(Em, v(9))), xm(A, v(1))));
  const c2 = q(xa(xm(Em, v(13)), xs(xm(C64, v(1)), xm(G, v(5)))));
  const c3 = q(xs(xs(xm(G, v(9)), xm(D, v(13))), xm(B, v(1))));
  const det = xa(xm(c0, v(0)), xa(xa(xm(c1, v(12)), xm(c2, v(8))), xm(c3, v(4))));
  if (det[0] === 0 && det[1] === 0) { o.fill(0); o[0] = o[5] = o[10] = 1; return; }
  const ih = E.div(1, 0, det[0], det[1]), inv: X = [ih, E.lo()];
  const f = (a: X): number => { const p = xm(inv, a); return E.toF32(p[0], p[1]); };
  o[0] = f(q(c0)); o[1] = f(c3); o[2] = f(c2);
  o[4] = f(xs(xs(xm(C, v(8)), xm(A, v(12))), xm(B, v(4))));
  o[5] = f(xa(xm(D, v(12)), xs(xm(v(0), B), xm(G, v(8)))));
  o[6] = f(xs(xs(xm(G, v(4)), xm(v(12), Em)), xm(C, v(0))));
  const P = mn(m[13], m[8], m[12], m[9]), Q = mn(m[4], m[13], m[12], m[5]), R = q(mn(m[9], m[4], m[5], m[8]));
  const S = mn(m[13], m[0], m[1], m[12]), T = mn(m[0], m[9], m[8], m[1]), U = mn(m[5], m[0], m[4], m[1]);
  o[8] = f(q(xa(xs(xm(P, v(7)), xm(v(11), Q)), xm(R, v(15)))));
  o[9] = f(q(xs(xs(xm(S, v(11)), xm(T, v(15))), xm(P, v(3)))));
  o[10] = f(q(xa(xm(U, v(15)), xs(xm(Q, v(3)), xm(S, v(7))))));
}

/** Normalize 0x10043a1e in place: |v| = f32(sqrt(f32((x^2 + y^2) + z^2))), each component f32(c / |v|); a zero length
 *  gives +0s */
export function normalize(v: Float64Array): void {
  const mag = fr(Math.sqrt(E.sum32x3(v[0] * v[0], v[1] * v[1], v[2] * v[2])));
  if ((bits(mag) & 0x7fffffff) === 0) { v[0] = 0; v[1] = 0; v[2] = 0; return; }
  v[0] = fr(v[0] / mag); v[1] = fr(v[1] / mag); v[2] = fr(v[2] / mag);
}

/** one light as ProcessLight and XformLight leave it (RDLIGHTI) */
interface Lit {
  spot: boolean;
  /** f32(material * light * 255) ambient, diffuse, specular RGB */
  amb: Float64Array; dif: Float64Array; spe: Float64Array;
  /** eye-space position and (spot) negated unit direction */
  pos: Float64Array; dir: Float64Array;
  range2: number; att0: number; att1: number; att2: number; falloff: number;
  cosTheta: number; cosPhi: number; inv: number;
}

/** UpdateLightingData's results, then LightVertex per vertex */
export class Lighting {
  lights: Lit[] = [];
  /** ambient * material ambient + emissive, in 0..255 (0x1086c) */
  private base = new Float64Array(3);
  /** the D3DCOLOR alpha bytes (<< 24) of the material's diffuse and specular (0x108f8, 0x108fc) */
  private difA = 0; private speA = 0;
  /** the specular cut-off 0x108c0: 0.001^(1/power), kept from the last material with power > 0.001 */
  private thresh = 0;
  private power = 0;
  private specular = false; private local = false;

  /** `mat` 17 floats (D3DMATERIAL9), `ambient` the AMBIENT colour, `lights` the enabled lights' D3DLIGHT9 (26 32-bit
   *  words) in REF's list order, `view` the view matrix */
  setup(mat: Float32Array, ambient: number, lights: Uint32Array[], view: Float32Array, specular: boolean, local: boolean): void {
    this.specular = specular; this.local = local;
    // ScaleRGBColorTo255 0x10048a28: f32(c * 255); AMBIENT as SetRenderState stored it: f32(byte / 255.0)
    const s = (i: number): number => fr(mat[i] * 255);
    const ab = (sh: number): number => { E.ld((ambient >>> sh) & 0xff); E.fdiv(255); return E.st32(); };
    this.base[0] = E.add32(ab(16) * s(4), s(12)); this.base[1] = E.add32(s(5) * ab(8), s(13)); this.base[2] = E.add32(s(6) * ab(0), s(14));
    const alpha = (a: number): number => { const t = Math.trunc(a * 255); return a >= 0 ? (t > 255 ? 0xff000000 : t << 24) >>> 0 : 0; };
    this.difA = alpha(mat[3]); this.speA = alpha(mat[11]);
    this.power = mat[16];
    // ponytail: the CRT's pow and cos taken as JS Math.pow / Math.cos (equal for the powers and angles in use)
    if (mat[16] > fr(0.001)) this.thresh = fr(Math.pow(0.001, 1 / mat[16]));
    this.lights = lights.map((w) => {
      const l = new Float32Array(w.buffer, w.byteOffset, 26), type = w[0];
      if (type !== 1 && type !== 2) throw new Error('RefDevice9: light type ' + type + ' is not implemented');
      const prod = (mi: number, li: number): Float64Array => Float64Array.from([0, 1, 2], (c) => { E.ldMul(mat[mi + c], l[li + c]); E.fmul(255); return E.st32(); });
      const v = view, px = l[13], py = l[14], pz = l[15];
      // XformBy4x3 0x10048cfa
      const pos = Float64Array.of(E.sum32(v[4] * py, v[0] * px, v[8] * pz, v[12]), E.sum32(v[1] * px, v[5] * py, v[9] * pz, v[13]),
        E.sum32(v[2] * px, v[6] * py, v[10] * pz, v[14]));
      const dir = new Float64Array(3);
      let cosTheta = 0, cosPhi = 0, inv = 1;
      if (type === 2) {
        // Xform3VecBy3x3 0x10048ca4, Normalize, negated
        const dx = l[16], dy = l[17], dz = l[18];
        dir[0] = E.sum32x3(v[4] * dy, v[0] * dx, v[8] * dz); dir[1] = E.sum32x3(v[1] * dx, v[5] * dy, v[9] * dz);
        dir[2] = E.sum32x3(v[2] * dx, v[6] * dy, v[10] * dz);
        normalize(dir); dir[0] = -dir[0]; dir[1] = -dir[1]; dir[2] = -dir[2];
        cosTheta = fr(Math.cos(l[24] * 0.5)); cosPhi = fr(Math.cos(l[25] * 0.5));
        const d = fr(cosTheta - cosPhi);
        inv = d === 0 ? 1 : fr(1 / d);
      }
      return { spot: type === 2, amb: prod(4, 9), dif: prod(0, 1), spe: prod(8, 5), pos, dir, range2: fr(l[19] * l[19]),
        att0: l[21], att1: l[22], att2: l[23], falloff: l[20], cosTheta, cosPhi, inv };
    });
  }

  private acc = new Float64Array(3); private sacc = new Float64Array(3);
  private V = new Float64Array(3); private H = new Float64Array(3);
  /** LightVertex for eye-space position p and normal n (null: none in the declaration): the diffuse and specular
   *  D3DCOLORs into out[0], out[1] */
  vertex(p: Float64Array, n: Float64Array | null, out: Uint32Array): void {
    const acc = this.acc, sacc = this.sacc;
    acc.set(this.base); sacc.fill(0);
    for (const L of this.lights) this.pointAndSpot(L, p, n);
    out[0] = (pack(acc) + this.difA) >>> 0;
    out[1] = ((this.specular ? pack(sacc) : 0) + this.speA) >>> 0;
  }

  /** RDLV_PointAndSpot 0x10048620 */
  private pointAndSpot(L: Lit, p: Float64Array, n: Float64Array | null): void {
    const acc = this.acc;
    const dy = fr(L.pos[1] - p[1]), dx = fr(L.pos[0] - p[0]), dz = fr(L.pos[2] - p[2]);
    const d2 = E.sum32x3(dy * dy, dx * dx, dz * dz);
    if (bits(d2) >= bits(L.range2) || (bits(d2) & 0x7fffffff) === 0) return;
    const dist = fr(Math.sqrt(d2));
    const a = E.sum32x3(L.att1 * dist, L.att0, L.att2 * d2);
    let att = (bits(a) & 0x7fffffff) === 0 ? FLT_MAX : fr(1 / a);
    const invD = fr(1 / dist);
    if (L.spot) {
      const rho = fr(E.sum32x3(L.dir[1] * dy, L.dir[0] * dx, L.dir[2] * dz) * invD);
      if (bits(rho) <= bits(L.cosPhi)) return;
      if (bits(rho) < bits(L.cosTheta)) {
        E.ld(rho); E.fsub(L.cosPhi); E.fmul(L.inv);
        let t = E.st32();
        if ((bits(fr(L.falloff - 1)) & 0x7fffffff) !== 0) t = fr(Math.pow(t, L.falloff));
        att = fr(t * att);
      }
    }
    for (let c = 0; c < 3; c++) acc[c] = E.add32(L.amb[c] * att, acc[c]);
    if (!n) return;
    const dot = E.sum32x3(n[1] * dy, n[0] * dx, n[2] * dz);
    if (bits(dot) <= 0) return;
    E.ldMul(att, invD); E.fmul(dot);
    const k = E.st32();
    for (let c = 0; c < 3; c++) acc[c] = E.add32(L.dif[c] * k, acc[c]);
    if (!this.specular) return;
    // the half vector: to the light plus to the eye (the origin, or (0, 0, -1) without LOCALVIEWER), both unit
    const V = this.V, H = this.H;
    if (this.local) { V[0] = fr(0 - p[0]); V[1] = fr(0 - p[1]); V[2] = fr(0 - p[2]); normalize(V); }
    else { V[0] = 0; V[1] = 0; V[2] = -1; }
    H[0] = fr(fr(dx * invD) + V[0]); H[1] = fr(fr(dy * invD) + V[1]); H[2] = fr(fr(dz * invD) + V[2]);
    normalize(H);
    const dh = E.sum32x3(n[1] * H[1], n[0] * H[0], n[2] * H[2]);
    if (bits(dh) < bits(this.thresh)) return;
    const s = fr(fr(Math.pow(dh, this.power)) * att);
    for (let c = 0; c < 3; c++) this.sacc[c] = E.add32(L.spe[c] * s, this.sacc[c]);
  }
}

/** FISTP (nearest even) of each accumulator, clamped to 0..255, packed R G B */
function pack(a: Float64Array): number {
  let r = 0;
  for (let c = 0; c < 3; c++) {
    let v = a[c] - Math.floor(a[c]) === 0.5 ? 2 * Math.round(a[c] / 2) : Math.round(a[c]);
    v = v > 0 ? (v > 255 ? 255 : v) : 0;
    r = r * 256 + v;
  }
  return r;
}
