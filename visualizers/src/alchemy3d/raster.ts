// What the graphics card did with 3D Alchemy's draws: Direct3D 8's fixed-function pipeline in software, for the
// subset the scenes use (one texture stage, MODULATE; vertex lighting with directional and spot lights; Gouraud
// shading; z buffer; CCW/CW culling; WRAP0; point lists). The DLL's own part, everything up to the draw calls,
// is exact (scene.ts); this part is a picture of the same scene, not the reference GPU's pixels, which are
// the driver's (D3D8 promises no rasterization bit pattern).
import type { Device } from './device';

export interface Target { w: number; h: number; color: Uint32Array; z: Float32Array }

type M = Float64Array;
function mul(a: ArrayLike<number>, b: ArrayLike<number>): M {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    r[4 * i + j] = a[4 * i] * b[j] + a[4 * i + 1] * b[4 + j] + a[4 * i + 2] * b[8 + j] + a[4 * i + 3] * b[12 + j];
  }
  return r;
}
const IDENT = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

// a processed vertex: clip position, colour (diffuse rgb, specular rgb, 0..1) and texture coordinates
const VS = 12;                                 // x y z w r g b sr sg sb u v
const X = 0, Y = 1, Z = 2, W = 3, R = 4, U = 10, V = 11, NA = 8;   // NA: the attributes after w (r..v)
const ch = (c: number, s: number) => ((c >>> s) & 255) / 255;

/** what lighting needs for one draw: material colours by source, lights in camera space */
interface LightRig {
  on: boolean; spec: boolean; power: number;
  /** emissive + ambient * global ambient, and per light: kind, colour terms, position/direction, attenuation */
  base: number[]; md: number[]; ma: number[]; ms: number[];
  srcD: number; srcA: number; srcS: number;
  lights: { type: number; dx: number; dy: number; dz: number; px: number; py: number; pz: number; L: Float32Array; ct: number; cp: number }[];
}
function rig(d: Device): LightRig {
  const m = d.material, view = d.transforms.get(2) ?? IDENT;
  const ga = d.getRenderState(139);
  const lights: LightRig['lights'] = [];
  for (const [i, L] of d.lights) {
    if (!d.lightOn.get(i)) continue;
    const dx = L[16] * view[0] + L[17] * view[4] + L[18] * view[8], dy = L[16] * view[1] + L[17] * view[5] + L[18] * view[9], dz = L[16] * view[2] + L[17] * view[6] + L[18] * view[10];
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    lights.push({ type: L[0], dx: dx / dl, dy: dy / dl, dz: dz / dl, L, ct: Math.cos(L[24] / 2), cp: Math.cos(L[25] / 2),
      px: L[13] * view[0] + L[14] * view[4] + L[15] * view[8] + view[12],
      py: L[13] * view[1] + L[14] * view[5] + L[15] * view[9] + view[13],
      pz: L[13] * view[2] + L[14] * view[6] + L[15] * view[10] + view[14] });
  }
  return {
    on: d.getRenderState(137) !== 0, spec: d.getRenderState(29) !== 0, power: m[16],
    base: [m[12], m[13], m[14], ch(ga, 16), ch(ga, 8), ch(ga, 0)],
    md: [m[0], m[1], m[2]], ma: [m[4], m[5], m[6]], ms: [m[8], m[9], m[10]],
    srcD: d.getRenderState(145), srcA: d.getRenderState(147), srcS: d.getRenderState(146), lights,
  };
}

const MD = [0, 0, 0], MA = [0, 0, 0], MS = [0, 0, 0];
/** vertex processing: transform to clip space, light in camera space (D3D8's fixed function) */
function processVertex(d: Device, lr: LightRig, vi: number, wv: M, wvp: M, out: Float64Array, o: number): void {
  const vb = d.vb!, f = vb.f32, u = vb.u32, base = vi * (d.stride >> 2);
  const x = f[base], y = f[base + 1], z = f[base + 2];
  out[o + X] = x * wvp[0] + y * wvp[4] + z * wvp[8] + wvp[12];
  out[o + Y] = x * wvp[1] + y * wvp[5] + z * wvp[9] + wvp[13];
  out[o + Z] = x * wvp[2] + y * wvp[6] + z * wvp[10] + wvp[14];
  out[o + W] = x * wvp[3] + y * wvp[7] + z * wvp[11] + wvp[15];
  const fvf = d.fvf, hasNormal = (fvf & 0x10) !== 0, hasDiffuse = (fvf & 0x40) !== 0, hasSpec = (fvf & 0x80) !== 0;
  let p = base + 3, nx = 0, ny = 0, nz = 0;
  if (hasNormal) { nx = f[p]; ny = f[p + 1]; nz = f[p + 2]; p += 3; }
  const vd = hasDiffuse ? u[p++] : 0xffffffff, vs = hasSpec ? u[p++] : 0;
  out[o + U] = (fvf & 0x100) ? f[p] : 0; out[o + V] = (fvf & 0x100) ? f[p + 1] : 0;
  if (!lr.on) {
    out[o + 4] = ch(vd, 16); out[o + 5] = ch(vd, 8); out[o + 6] = ch(vd, 0);
    out[o + 7] = ch(vs, 16); out[o + 8] = ch(vs, 8); out[o + 9] = ch(vs, 0);
    return;
  }
  for (let k = 0; k < 3; k++) {
    const sh = 16 - 8 * k;
    MD[k] = lr.srcD === 1 && hasDiffuse ? ch(vd, sh) : lr.srcD === 2 && hasSpec ? ch(vs, sh) : lr.md[k];
    MA[k] = lr.srcA === 1 && hasDiffuse ? ch(vd, sh) : lr.srcA === 2 && hasSpec ? ch(vs, sh) : lr.ma[k];
    MS[k] = lr.srcS === 1 && hasDiffuse ? ch(vd, sh) : lr.srcS === 2 && hasSpec ? ch(vs, sh) : lr.ms[k];
  }
  const b0 = lr.base;
  let r = b0[0] + MA[0] * b0[3], g = b0[1] + MA[1] * b0[4], b = b0[2] + MA[2] * b0[5], sr = 0, sg = 0, sb = 0;
  const px = x * wv[0] + y * wv[4] + z * wv[8] + wv[12], py = x * wv[1] + y * wv[5] + z * wv[9] + wv[13], pz = x * wv[2] + y * wv[6] + z * wv[10] + wv[14];
  let Nx = nx * wv[0] + ny * wv[4] + nz * wv[8], Ny = nx * wv[1] + ny * wv[5] + nz * wv[9], Nz = nx * wv[2] + ny * wv[6] + nz * wv[10];
  const nl = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1; Nx /= nl; Ny /= nl; Nz /= nl;
  for (let li = 0; li < lr.lights.length; li++) {
    const Lt = lr.lights[li], L = Lt.L;
    let Lx: number, Ly: number, Lz: number, att = 1;
    if (Lt.type === 3) { Lx = -Lt.dx; Ly = -Lt.dy; Lz = -Lt.dz; }
    else {
      Lx = Lt.px - px; Ly = Lt.py - py; Lz = Lt.pz - pz;
      const dist = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz) || 1e-9;
      if (dist > L[19]) continue;
      Lx /= dist; Ly /= dist; Lz /= dist;
      att = 1 / (L[21] + L[22] * dist + L[23] * dist * dist);
      if (Lt.type === 2) {
        const rho = -(Lx * Lt.dx + Ly * Lt.dy + Lz * Lt.dz);
        if (rho <= Lt.cp) continue;
        if (rho < Lt.ct) att *= Math.pow((rho - Lt.cp) / (Lt.ct - Lt.cp), L[20]);
      }
    }
    const ndl = hasNormal ? Math.max(0, Nx * Lx + Ny * Ly + Nz * Lz) : 0;
    r += att * (MA[0] * L[9] + MD[0] * L[1] * ndl);
    g += att * (MA[1] * L[10] + MD[1] * L[2] * ndl);
    b += att * (MA[2] * L[11] + MD[2] * L[3] * ndl);
    if (lr.spec && hasNormal && ndl > 0) {
      const vl = Math.sqrt(px * px + py * py + pz * pz) || 1;          // local viewer: H = normalize(L + V)
      let hx = Lx - px / vl, hy = Ly - py / vl, hz = Lz - pz / vl;
      const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      const s = Math.pow(Math.max(0, Nx * hx + Ny * hy + Nz * hz), lr.power) * att;
      sr += MS[0] * L[5] * s; sg += MS[1] * L[6] * s; sb += MS[2] * L[7] * s;
    }
  }
  out[o + 4] = r > 1 ? 1 : r; out[o + 5] = g > 1 ? 1 : g; out[o + 6] = b > 1 ? 1 : b;
  out[o + 7] = sr > 1 ? 1 : sr; out[o + 8] = sg > 1 ? 1 : sg; out[o + 9] = sb > 1 ? 1 : sb;
}

// ---- the texture stage, set per draw
interface Stage { px: Uint32Array | null; levels: Uint32Array[]; w: number; h: number; mip: number; mag: number; min: number; spec: boolean; zOn: boolean; cull: number }
let st: Stage;

const PL = new Float64Array(3 * (2 + NA));        // plane equations: iw and the attributes over w, a*x + b*y + c
/** one triangle in screen space (s: x, y, z, 1/w, attributes over w at a, b, c) */
function drawTriangle(t: Target, s: Float64Array, a: number, b: number, c: number): void {
  const Wd = t.w, Hd = t.h;
  const ax = s[a], ay = s[a + 1], bx = s[b], by = s[b + 1], cx = s[c], cy = s[c + 1];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  if ((st.cull === 2 && area > 0) || (st.cull === 3 && area < 0)) return;   // y down: area > 0 is clockwise
  const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), maxX = Math.min(Wd - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
  const minY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), maxY = Math.min(Hd - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
  if (minX > maxX || minY > maxY) return;
  const inv = 1 / area;
  // barycentric planes: w0 = e0x * x + e0y * y + e0c, etc.
  const e0x = (by - cy) * inv, e0y = (cx - bx) * inv, e0c = (bx * cy - by * cx) * inv;
  const e1x = (cy - ay) * inv, e1y = (ax - cx) * inv, e1c = (cx * ay - cy * ax) * inv;
  // planes of z, 1/w and each attribute over w (index 2 .. 3 + NA - 1 of the vertex)
  const NP = 2 + NA;
  for (let k = 0; k < NP; k++) {
    const va = s[a + 2 + k], vb = s[b + 2 + k], vc = s[c + 2 + k];
    PL[3 * k] = va * e0x + vb * e1x + vc * (-e0x - e1x);
    PL[3 * k + 1] = va * e0y + vb * e1y + vc * (-e0y - e1y);
    PL[3 * k + 2] = va * e0c + vb * e1c + vc * (1 - e0c - e1c);
  }
  // texture level and filter for the whole triangle (texel to pixel area ratio)
  let lpx: Uint32Array | null = null, lw = 0, lh = 0, linear = false;
  if (st.px) {
    let level = 0;
    const ua = s[a + 10] / s[a + 3], va = s[a + 11] / s[a + 3], ub = s[b + 10] / s[b + 3], vb2 = s[b + 11] / s[b + 3], uc = s[c + 10] / s[c + 3], vc = s[c + 11] / s[c + 3];
    const tArea = Math.abs((ub - ua) * (vc - va) - (vb2 - va) * (uc - ua)) * st.w * st.h;
    const lod = 0.5 * Math.log2(tArea / Math.abs(area) || 1);
    if (st.levels.length > 1 && st.mip > 0 && lod > 0) level = Math.min(st.levels.length - 1, Math.round(lod));
    lpx = st.levels[level]; lw = Math.max(1, st.w >> level); lh = Math.max(1, st.h >> level);
    linear = (lod > 0 ? st.min : st.mag) >= 2;
  }
  RS.lpx = lpx; RS.lw = lw; RS.lh = lh; RS.linear = linear; RS.zOn = st.zOn; RS.spec = st.spec; RS.col = t.color; RS.zb = t.z;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    // the span: where both barycentric planes and the third are >= 0
    let x0 = minX, x1 = maxX;
    const k0 = e0y * py + e0c, k1 = e1y * py + e1c, e2x = -e0x - e1x, k2 = 1 - k0 - k1;   // ex * px + k >= 0
    if (e0x > 0) x0 = Math.max(x0, Math.ceil(-k0 / e0x - 0.5)); else if (e0x < 0) x1 = Math.min(x1, Math.floor(-k0 / e0x - 0.5)); else if (k0 < 0) continue;
    if (e1x > 0) x0 = Math.max(x0, Math.ceil(-k1 / e1x - 0.5)); else if (e1x < 0) x1 = Math.min(x1, Math.floor(-k1 / e1x - 0.5)); else if (k1 < 0) continue;
    if (e2x > 0) x0 = Math.max(x0, Math.ceil(-k2 / e2x - 0.5)); else if (e2x < 0) x1 = Math.min(x1, Math.floor(-k2 / e2x - 0.5)); else if (k2 < 0) continue;
    if (x0 <= x1) row(y * Wd, x0, x1, py, e0x * (x0 + 0.5) + k0, e1x * (x0 + 0.5) + k1, e0x, e1x);
  }
}

// the row loop on its own: inside drawTriangle V8 keeps re-entering it on-stack and deoptimizing
interface RowState { lpx: Uint32Array | null; lw: number; lh: number; linear: boolean; zOn: boolean; spec: boolean; col: Uint32Array; zb: Float32Array }
const RS: RowState = { lpx: null, lw: 0, lh: 0, linear: false, zOn: false, spec: false, col: new Uint32Array(0), zb: new Float32Array(0) };
function row(base: number, x0: number, x1: number, py: number, w0: number, w1: number, e0x: number, e1x: number): void {
  const lpx = RS.lpx, lw = RS.lw, lh = RS.lh, linear = RS.linear, zOn = RS.zOn, spec = RS.spec, col = RS.col, zb = RS.zb;
  const px0 = x0 + 0.5;
  let z = PL[0] * px0 + PL[1] * py + PL[2], iw = PL[3] * px0 + PL[4] * py + PL[5];
  let ar = PL[6] * px0 + PL[7] * py + PL[8], ag = PL[9] * px0 + PL[10] * py + PL[11], ab = PL[12] * px0 + PL[13] * py + PL[14];
  let sr = PL[15] * px0 + PL[16] * py + PL[17], sg = PL[18] * px0 + PL[19] * py + PL[20], sb = PL[21] * px0 + PL[22] * py + PL[23];
  let au = PL[24] * px0 + PL[25] * py + PL[26], av = PL[27] * px0 + PL[28] * py + PL[29];
  const dz = PL[0], diw = PL[3], dr = PL[6], dg = PL[9], db = PL[12], dsr = PL[15], dsg = PL[18], dsb = PL[21], du = PL[24], dv = PL[27];
  for (let x = x0, i = base + x0; x <= x1; x++, i++, w0 += e0x, w1 += e1x, z += dz, iw += diw, ar += dr, ag += dg, ab += db, sr += dsr, sg += dsg, sb += dsb, au += du, av += dv) {
    if (w0 < -1e-9 || w1 < -1e-9 || w0 + w1 > 1 + 1e-9) continue;
    if (zOn) { if (z > zb[i]) continue; zb[i] = z; }
    const k = 1 / iw;
    let r = ar * k, g = ag * k, bl = ab * k;
    if (lpx !== null) {
      let u = au * k, v = av * k;
      u -= Math.floor(u); v -= Math.floor(v);          // D3DTADDRESS_WRAP
      if (!linear) {
        const tx = (u * lw) | 0, ty = (v * lh) | 0;
        const tc = lpx[(ty < lh ? ty : lh - 1) * lw + (tx < lw ? tx : lw - 1)];
        r *= ((tc >>> 16) & 255) / 255; g *= ((tc >>> 8) & 255) / 255; bl *= (tc & 255) / 255;
      } else {
        const fx = u * lw - 0.5, fy = v * lh - 0.5, xi = Math.floor(fx), yi = Math.floor(fy), ex = fx - xi, ey = fy - yi;
        const X0 = xi < 0 ? xi + lw : xi, X1 = X0 + 1 < lw ? X0 + 1 : 0, Y0 = yi < 0 ? yi + lh : yi, Y1 = Y0 + 1 < lh ? Y0 + 1 : 0;
        const c00 = lpx[Y0 * lw + X0], c10 = lpx[Y0 * lw + X1], c01 = lpx[Y1 * lw + X0], c11 = lpx[Y1 * lw + X1];
        const w00 = (1 - ex) * (1 - ey), w10 = ex * (1 - ey), w01 = (1 - ex) * ey, w11 = ex * ey;
        r *= (((c00 >>> 16) & 255) * w00 + ((c10 >>> 16) & 255) * w10 + ((c01 >>> 16) & 255) * w01 + ((c11 >>> 16) & 255) * w11) / 255;
        g *= (((c00 >>> 8) & 255) * w00 + ((c10 >>> 8) & 255) * w10 + ((c01 >>> 8) & 255) * w01 + ((c11 >>> 8) & 255) * w11) / 255;
        bl *= ((c00 & 255) * w00 + (c10 & 255) * w10 + (c01 & 255) * w01 + (c11 & 255) * w11) / 255;
      }
    }
    if (spec) { r += sr * k; g += sg * k; bl += sb * k; }
    const R8 = r >= 1 ? 255 : r <= 0 ? 0 : (r * 255 + 0.5) | 0, G8 = g >= 1 ? 255 : g <= 0 ? 0 : (g * 255 + 0.5) | 0, B8 = bl >= 1 ? 255 : bl <= 0 ? 0 : (bl * 255 + 0.5) | 0;
    col[i] = (R8 << 16) | (G8 << 8) | B8;
  }
}

/** a clip-space vertex (VS floats at o) to screen space, attributes over w */
function toScreen(t: Target, v: Float64Array, o: number, out: Float64Array, p: number): void {
  const iw = 1 / v[o + W];
  out[p + X] = (v[o + X] * iw * 0.5 + 0.5) * t.w; out[p + Y] = (-v[o + Y] * iw * 0.5 + 0.5) * t.h; out[p + Z] = v[o + Z] * iw; out[p + W] = iw;
  for (let k = R; k < VS; k++) out[p + k] = v[o + k] * iw;
}

let vbuf = new Float64Array(0), done = new Uint8Array(0);
const poly = new Float64Array(9 * VS), clipped = new Float64Array(9 * VS), scr = new Float64Array(9 * VS);

/** one draw call: `start`/`count` are the start index and primitive count (DrawIndexedPrimitive with `ib`) or
 *  the start vertex and count (DrawPrimitive) */
export function rasterize(d: Device, type: number, start: number, count: number, ib: { idx: Uint16Array } | null, _minIdx: number): void {
  if (!d.vb) return;
  const world = d.transforms.get(256) ?? IDENT, view = d.transforms.get(2) ?? IDENT, proj = d.transforms.get(3) ?? IDENT;
  const wv = mul(world, view), wvp = mul(wv, proj), lr = rig(d);
  const t = d.target, nv = d.vb.bytes.length / d.stride;
  if (vbuf.length < nv * VS) { vbuf = new Float64Array(nv * VS); done = new Uint8Array(nv); } else done.fill(0, 0, nv);
  const verts = vbuf;
  const vert = (i: number): number => { const o = i * VS; if (!done[i]) { processVertex(d, lr, i, wv, wvp, verts, o); done[i] = 1; } return o; };
  const tex = d.textures[0] ?? null;
  st = { px: tex ? tex.px : null, levels: tex ? tex.levels : [], w: tex ? tex.w : 0, h: tex ? tex.h : 0,
    mip: d.tss.get(18) ?? 0, mag: d.tss.get(16) ?? 1, min: d.tss.get(17) ?? 1, spec: d.getRenderState(29) !== 0,
    zOn: d.getRenderState(7) !== 0, cull: d.getRenderState(22) };
  if (type === 1) {                                     // points: one pixel each
    for (let k = 0; k < count; k++) {
      const o = vert(start + k);
      if (verts[o + W] <= 0 || verts[o + Z] < 0) continue;
      toScreen(t, verts, o, scr, 0);
      const x = Math.floor(scr[X]), y = Math.floor(scr[Y]);
      if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
      const i = y * t.w + x;
      if (st.zOn) { if (scr[Z] > t.z[i]) continue; t.z[i] = scr[Z]; }
      const c8 = (v: number) => (v >= 1 ? 255 : (v * 255 + 0.5) | 0);
      t.color[i] = (c8(verts[o + 4]) << 16) | (c8(verts[o + 5]) << 8) | c8(verts[o + 6]);
    }
    return;
  }
  const wrap = d.getRenderState(128);
  const tri = (i0: number, i1: number, i2: number) => {
    const o0 = vert(i0), o1 = vert(i1), o2 = vert(i2);
    if (!(wrap & 3) && verts[o0 + Z] >= 0 && verts[o1 + Z] >= 0 && verts[o2 + Z] >= 0) {
      toScreen(t, verts, o0, scr, 0); toScreen(t, verts, o1, scr, VS); toScreen(t, verts, o2, scr, 2 * VS);
      drawTriangle(t, scr, 0, VS, 2 * VS);
      return;
    }
    for (let k = 0; k < VS; k++) { poly[k] = verts[o0 + k]; poly[VS + k] = verts[o1 + k]; poly[2 * VS + k] = verts[o2 + k]; }
    if (poly[Z] >= 0 && poly[VS + Z] >= 0 && poly[2 * VS + Z] >= 0) {
      if (wrap & 1) { const m = Math.min(poly[U], poly[VS + U], poly[2 * VS + U]); for (let j = 0; j < 3; j++) if (poly[j * VS + U] - m > 0.5) poly[j * VS + U] -= 1; }
      if (wrap & 2) { const m = Math.min(poly[V], poly[VS + V], poly[2 * VS + V]); for (let j = 0; j < 3; j++) if (poly[j * VS + V] - m > 0.5) poly[j * VS + V] -= 1; }
      toScreen(t, poly, 0, scr, 0); toScreen(t, poly, VS, scr, VS); toScreen(t, poly, 2 * VS, scr, 2 * VS);
      drawTriangle(t, scr, 0, VS, 2 * VS);
      return;
    }
    // D3DRS_WRAP0: u (v) interpolated the short way round
    if (wrap & 1) { const m = Math.min(poly[U], poly[VS + U], poly[2 * VS + U]); for (let j = 0; j < 3; j++) if (poly[j * VS + U] - m > 0.5) poly[j * VS + U] -= 1; }
    if (wrap & 2) { const m = Math.min(poly[V], poly[VS + V], poly[2 * VS + V]); for (let j = 0; j < 3; j++) if (poly[j * VS + V] - m > 0.5) poly[j * VS + V] -= 1; }
    // clip to the near plane z >= 0 (Sutherland-Hodgman); sides and far plane are left to the guard band
    let n = 0;
    for (let j = 0; j < 3; j++) {
      const A0 = j * VS, B0 = ((j + 1) % 3) * VS, ia = poly[A0 + Z] >= 0, ib2 = poly[B0 + Z] >= 0;
      if (ia) { for (let k = 0; k < VS; k++) clipped[n * VS + k] = poly[A0 + k]; n++; }
      if (ia !== ib2) {
        const tt = poly[A0 + Z] / (poly[A0 + Z] - poly[B0 + Z]);
        for (let k = 0; k < VS; k++) clipped[n * VS + k] = poly[A0 + k] + (poly[B0 + k] - poly[A0 + k]) * tt;
        n++;
      }
    }
    if (n < 3) return;
    for (let j = 0; j < n; j++) toScreen(t, clipped, j * VS, scr, j * VS);
    for (let j = 1; j + 1 < n; j++) drawTriangle(t, scr, 0, j * VS, (j + 1) * VS);
  };
  if (type === 4) {
    if (ib) for (let k = 0; k < count; k++) tri(ib.idx[start + 3 * k], ib.idx[start + 3 * k + 1], ib.idx[start + 3 * k + 2]);
    else for (let k = 0; k < count; k++) tri(start + 3 * k, start + 3 * k + 1, start + 3 * k + 2);
  } else if (type === 5) {
    const idx = (k: number) => (ib ? ib.idx[start + k] : start + k);
    for (let k = 0; k < count; k++) { if (k & 1) tri(idx(k + 1), idx(k), idx(k + 2)); else tri(idx(k), idx(k + 1), idx(k + 2)); }
  }
}
