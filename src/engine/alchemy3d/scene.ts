// 3D Alchemy's scenes: mpvis3d.dll's little scene graph (frames, meshes, a starfield, a light, a camera; the
// classes at 0x00446400-0x00449280) and its six presets (0x00413100-0x00416600). Every number the DLL hands
// Direct3D is computed here as it computes it: D3DX's math from math.ts, the DLL's own x87 code (VC7, 53-bit
// precision) as double arithmetic with a float rounding (fr) wherever it stores to memory. VAs in the comments.
import { A } from '../ns';
import {
  fr, mat, vec3, matMul, matTranslation, matScaling, matRotationX, matRotationY, matRotationZ, matRotationAxis,
  matLookAtLH, matPerspectiveFovLH, vec3Normalize, vec3NormalizeX87, vec3TransformCoord, type Vec3,
} from './math';
import { D3D, Device, IndexBuffer, Texture, VertexBuffer, type Light, type Material } from './device';

/** the preset names: string resources 117-122. GetPresetCount says 5 and SetCurrentPreset refuses 5, so WMP
 *  never offers Draco's room; the DLL still builds and draws it (scene preset 5, 0x004143e4). */
export const PRESET_NAMES = ['Classic', 'Kaleidoscope', 'Monoliths', 'Strange world', 'WM Museum', "Draco's room"];

/** a float constant from its bits, as the DLL stores it */
const fb = (u: number): number => new Float32Array(new Uint32Array([u]).buffer)[0];
const RAD = fb(0x3c8efa35);                  // 0x004040f8: 0.017453292
const DEG_PER_100 = fr(0.01);                // 0x00404138
const HALF_PI = fb(0x3fc90fdb), THREE_HALF_PI = fb(0x4096cbe4), PI = fb(0x40490fdb), QUARTER_PI = fb(0x3f490fdb);

// ------------------------------------------------------------------ the clock (DXUtil_Timer, 0x00448f95)
/** The DirectX SDK samples' timer on QueryPerformanceCounter, as the DLL keeps it. `now` is the counter, `freq`
 *  its frequency (counts per second). Only the calls the scenes make are here: START (1), ELAPSED (6) and
 *  APPTIME (5); RESET is never called. APPTIME counts from the first START. */
export class Timer {
  // the timer starts out stopped at time 0 (0x0044fc2c = 1): the first START sets the base to that moment
  base = 0; last = 0; stopped = true; stopTime = 0;
  constructor(public freq: number, public now: () => number) {}
  start(): void {
    const t = this.now();
    if (this.stopped) this.base += t - this.stopTime;
    this.stopped = false; this.stopTime = 0; this.last = t;
  }
  elapsed(): number { const t = this.now(), d = (t - this.last) / this.freq; this.last = t; return d; }
  appTime(): number { return (this.now() - this.base) / this.freq; }
}

// ------------------------------------------------------------------ objects
export interface SceneEnv {
  dev: Device;
  /** a resource texture at the size the DLL asks D3DX for (A8R8G8B8, 4 levels, point mips); null if none */
  texture(resId: number, size: number): Texture | null;
}

abstract class Obj {
  visible = true;                            // +0x10
  owner: Node | null = null;                 // +0x08
  abstract render(env: SceneEnv): void;      // vtable[0]
}

/** D3DMATERIAL8 from the DLL's 17 constants */
function material(v: readonly number[]): Material { return Float32Array.from(v); }
const DEFAULT_MATERIAL = [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5];

/** the mesh base, 0x00446918 */
abstract class Mesh extends Obj {
  vb: VertexBuffer | null = null;            // +0x14
  ib: IndexBuffer | null = null;             // +0x18
  diffuse = 0xffffff;                        // +0x1c
  specular = 0xffffff;                       // +0x24
  texture: Texture | null = null;            // +0x28
  mat: Material = material(DEFAULT_MATERIAL);  // +0x2c
  dirty = true;                              // +0x70
  specularOn = false;                        // +0x71
  resId = 0;                                 // +0x80
  cull = 3;                                  // +0x84
  dims = vec3(1, 1, 1);                      // +0x88
  offs = vec3(0, 0, 0);                      // +0x94
  /** 0x004467f9: (re)load a resource texture when the id changes or there is none */
  loadTexture(env: SceneEnv, resId: number, size: number): void {
    if (this.resId === resId && this.texture) return;
    this.resId = resId;
    this.texture = env.texture(resId, size);
  }
}

/** the grid, class 0x00407cfc (ctor 0x00446a9b, size 0x00446ae5, build 0x00446cf7, render 0x004472cd) */
export class Grid extends Mesh {
  cols = 0; rows = 0;                        // +0xac, +0xae
  levels = 1;                                // +0xb0: heights rand() % levels inside the grid
  altUV = false;                             // +0xb8: texture coordinates mirrored cell to cell
  size = 1;                                  // +0xbc
  caps = 0;                                  // +0xb4
  constructor() { super(); this.diffuse = 0xff808080; this.specular = 0xffffffff; }
  setSize(cols: number, rows: number, size: number, levels: number, altUV: boolean): void {
    this.size = fr(size); this.altUV = altUV; this.cols = cols; this.rows = rows;
    this.levels = levels === 0 ? 1 : levels;
    this.dirty = true;
  }
  get nVerts(): number { return (this.cols + 1) * (this.rows + 1); }
  get nIdx(): number { return this.cols * this.rows * 6; }
  /** 0x00446b59: two triangles a cell, t = the cell's first vertex: (t+R+1, t, t+R+2), (t+1, t+R+2, t) */
  private buildIndices(): void {
    const ib = new IndexBuffer(this.nIdx), R = this.rows;
    let cx = R + 1, q = R + 2, e = 0, p = 0;
    for (let r = 0; r < this.cols; r++) {
      for (let k = 0; k < R; k++) {
        ib.idx[p] = cx; ib.idx[p + 1] = e; ib.idx[p + 2] = q; ib.idx[p + 3] = e + 1; ib.idx[p + 4] = q; ib.idx[p + 5] = e;
        p += 6; cx++; q++; e++;
      }
      cx = q; e++; q++;
    }
    this.ib = ib;
  }
  /** 0x00446cf7 */
  build(): void {
    if (!this.vb || !this.ib) { this.vb = new VertexBuffer(this.nVerts * 40, D3D.FVF_MESH); this.buildIndices(); }
    const n = this.nVerts, f = new Float32Array(n * 10), u = new Uint32Array(f.buffer);
    const acc = new Float32Array(n * 3), cnt = new Uint16Array(n);
    if (this.cols === 1 && this.rows === 1) {
      // four fixed corners (normals come from the face pass below)
      const P = [[-1, -1, 0, 1], [-1, 1, 0, 0], [1, -1, 1, 1], [1, 1, 1, 0]];
      for (let i = 0; i < 4; i++) {
        f[10 * i] = P[i][0]; f[10 * i + 1] = P[i][1]; f[10 * i + 2] = 0;
        u[10 * i + 6] = this.diffuse; u[10 * i + 7] = this.specular;
        f[10 * i + 8] = P[i][2]; f[10 * i + 9] = P[i][3];
      }
    } else {
      const W = this.cols, H = this.rows;
      const hw = fr(W * 0.5), mhw = fr(-(W * 0.5)), hh = fr(H * 0.5), mhh = fr(-(H * 0.5));
      const invW = fr(1 / W), invH = fr(1 / H);
      let iv = 0;
      for (let c = mhw; c <= hw; c = fr(c + 1)) {
        for (let x = mhh; x <= hh; x += 1) {           // x stays a double on the x87 stack
          cnt[iv] = 0;
          const o = 10 * iv;
          f[o] = fr(x * this.size);
          if (c === mhw || c === hw || x === mhh || x === hh) f[o + 1] = 0;
          else f[o + 1] = (A.rand() % this.levels);
          f[o + 2] = fr(-(c * this.size));
          f[o + 3] = 0; f[o + 4] = 0; f[o + 5] = 0;
          u[o + 7] = this.specular; u[o + 6] = this.diffuse;
          if (this.altUV) {
            // _ftol2 of the row coordinate, then of the column one: even/odd picks 0 or 1 (a mirrored tiling)
            const cr = Math.trunc(c) % 2, xr = Math.trunc(x) % 2;
            f[o + 8] = xr === 0 ? 0 : 1;
            f[o + 9] = cr === 0 ? 0 : 1;
          } else if (c === mhw) {
            f[o + 8] = x === mhh ? 0 : fr((x - mhh) * invW);
            f[o + 9] = 0;
          } else {
            f[o + 8] = x === mhh ? 0 : fr((x - mhh) * invW);
            f[o + 9] = fr((c - mhw) * invH);
          }
          iv++;
        }
      }
    }
    // face normals, summed per vertex, averaged and normalized
    const idx = this.ib!.idx, nrm = vec3();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], cc = idx[t + 2];
      faceNormal(nrm, f, 10 * a, f, 10 * b, f, 10 * cc);
      cnt[a]++; cnt[b]++; cnt[cc]++;
      for (const v of [a, b, cc]) for (let k = 0; k < 3; k++) acc[3 * v + k] = fr(nrm[k] + acc[3 * v + k]);
    }
    const tmp = vec3();
    for (let v = 0; v < n; v++) {
      tmp[0] = fr(acc[3 * v] / cnt[v]); tmp[1] = fr(acc[3 * v + 1] / cnt[v]); tmp[2] = fr(acc[3 * v + 2] / cnt[v]);
      vec3Normalize(tmp, tmp);
      f[10 * v + 3] = tmp[0]; f[10 * v + 4] = tmp[1]; f[10 * v + 5] = tmp[2];
    }
    this.vb.f32.set(f);
    this.dirty = false;
  }
  render(env: SceneEnv): void {                // 0x004472cd
    const d = env.dev;
    if (!this.visible) return;
    if (this.dirty) this.build();
    d.setStreamSource(0, this.vb!, 40);
    d.setVertexShader(D3D.FVF_MESH);
    let saved: Texture | null = null, swapped = false;
    if (this.texture) {
      if (this.caps === 0) this.caps = d.textureFilterCaps;
      if (this.caps & 0x4000000) {
        d.setTextureStageState(0, D3D.MAGFILTER, 3); d.setTextureStageState(0, D3D.MINFILTER, 3); d.setTextureStageState(0, D3D.MIPFILTER, 3);
      } else if (this.caps & 0x2000000) {
        d.setTextureStageState(0, D3D.MAGFILTER, 2); d.setTextureStageState(0, D3D.MINFILTER, 2); d.setTextureStageState(0, D3D.MIPFILTER, 2);
      }
      d.setTextureStageState(0, D3D.COLOROP, 4); d.setTextureStageState(0, D3D.COLORARG1, 2); d.setTextureStageState(0, D3D.COLORARG2, 1);
      saved = d.getTexture(0); swapped = true;
      d.setTexture(0, this.texture);
    }
    const sm = d.getMaterial();
    d.setMaterial(this.mat);
    d.setIndices(this.ib!, 0);
    d.drawIndexedPrimitive(D3D.TRIANGLELIST, 0, this.nVerts, 0, this.cols * this.rows * 2);
    d.setMaterial(sm);
    if (swapped && saved) d.setTexture(0, saved);
  }
}

/** 0x0044688a: normalize(cross(c - a, b - a)) as the DLL orders it (e1 = b - a and e2.z on the x87 stack) */
function faceNormal(out: Vec3, fa: Float32Array, ia: number, fb: Float32Array, ib: number, fc: Float32Array, ic: number): Vec3 {
  const e1x = fb[ib] - fa[ia], e1y = fb[ib + 1] - fa[ia + 1], e1z = fb[ib + 2] - fa[ia + 2];
  const e2x = fr(fc[ic] - fa[ia]), e2y = fr(fc[ic + 1] - fa[ia + 1]), e2z = fc[ic + 2] - fa[ia + 2];
  out[0] = fr(e2z * e1y - e2y * e1z);
  out[1] = fr(e1z * e2x - e2z * e1x);
  out[2] = fr(e2y * e1x - e2x * e1y);
  return vec3Normalize(out, out);
}

/** the box, class 0x00407d24 (build 0x004474bd, render 0x0044816b): 6 faces, 12 triangles, 36 vertices */
export class Box extends Mesh {
  build(): void {
    if (!this.vb) this.vb = new VertexBuffer(0x5a0, D3D.FVF_MESH);
    const [w, h, dpt] = this.dims, [ox, oy, oz] = this.offs;
    // alignment +0xa0/+0xa4 is always 0 in the presets: centred
    const X0 = fr(fr(-fr(w * 0.5)) + ox), X1 = fr(fr(w * 0.5) + ox);
    const Y1 = fr(fr(h * 0.5) + oy), Y0 = fr(fr(-fr(h * 0.5)) + oy);
    const hz = fr(dpt * 0.5), Z0 = fr(oz - hz), Z1 = fr(hz + oz);
    const faces = [
      [[X0, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z0], [X1, Y1, Z1]],
      [[X0, Y0, Z0], [X0, Y1, Z0], [X1, Y0, Z0], [X1, Y1, Z0]],
      [[X1, Y0, Z0], [X1, Y1, Z0], [X1, Y0, Z1], [X1, Y1, Z1]],
      [[X1, Y0, Z1], [X1, Y1, Z1], [X0, Y0, Z1], [X0, Y1, Z1]],
      [[X0, Y0, Z1], [X0, Y1, Z1], [X0, Y0, Z0], [X0, Y1, Z0]],
      [[X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z0], [X0, Y0, Z1]],
    ];
    const UV = [[0, 1], [0, 0], [1, 1], [1, 0]], ORDER = [0, 1, 2, 3, 2, 1];
    const f = this.vb.f32, u = this.vb.u32, nrm = vec3();
    for (let fi = 0; fi < 6; fi++) for (let k = 0; k < 6; k++) {
      const o = 10 * (6 * fi + k), c = faces[fi][ORDER[k]];
      f[o] = c[0]; f[o + 1] = c[1]; f[o + 2] = c[2];
      u[o + 6] = 0xffffffff; u[o + 7] = 0xff808080;
      f[o + 8] = UV[ORDER[k]][0]; f[o + 9] = UV[ORDER[k]][1];
    }
    // per triangle: its face normal on its three vertices, the object's colours on its first
    for (let t = 0; t < 12; t++) {
      const o = 30 * t;
      faceNormal(nrm, f, o, f, o + 10, f, o + 20);
      for (let k = 0; k < 3; k++) { f[o + 10 * k + 3] = nrm[0]; f[o + 10 * k + 4] = nrm[1]; f[o + 10 * k + 5] = nrm[2]; }
      u[o + 6] = this.diffuse; u[o + 7] = this.specular;
    }
    this.dirty = false;
  }
  render(env: SceneEnv): void {
    const d = env.dev;
    if (!this.visible) return;
    if (this.dirty) this.build();
    const sc = d.getRenderState(D3D.CULLMODE);
    d.setRenderState(D3D.CULLMODE, this.cull);
    d.setStreamSource(0, this.vb!, 40);
    d.setVertexShader(D3D.FVF_MESH);
    let saved: Texture | null = null, swapped = false;
    if (this.texture) {
      d.setTextureStageState(0, D3D.COLOROP, 4); d.setTextureStageState(0, D3D.COLORARG1, 2); d.setTextureStageState(0, D3D.COLORARG2, 1);
      d.setTextureStageState(0, D3D.MIPFILTER, 2);
      saved = d.getTexture(0); swapped = true;
      d.setTexture(0, this.texture);
    }
    const sm = d.getMaterial();
    d.setMaterial(this.mat);
    d.drawPrimitive(D3D.TRIANGLELIST, 0, 12);
    d.setRenderState(D3D.CULLMODE, sc);
    d.setMaterial(sm);
    if (swapped && saved) d.setTexture(0, saved);
  }
}

/** the sphere, class 0x00407d74 (ctor 0x004488ad, size 0x004485ee, build 0x00448674, render 0x00448904) */
export class Sphere extends Mesh {
  rings = 100; segs = 100;                   // +0xb0, +0xb4
  constructor() { super(); this.dims = vec3(3, 3, 3); }
  setRes(rings: number, segs: number): void { this.segs = segs; this.rings = rings; this.dirty = true; }
  get nVerts(): number { return (this.rings + 1) * (this.segs + 1); }
  get nIdx(): number { return (this.segs + 1) * this.rings * 2; }
  build(): void {
    if (!this.vb || !this.ib) { this.vb = new VertexBuffer(this.nVerts * 40, D3D.FVF_MESH); this.ib = new IndexBuffer(this.nIdx); }
    const f = this.vb.f32, u = this.vb.u32, idx = this.ib.idx;
    const a = fr(3.1415927410125732 / this.rings), b = fr(6.2831854820251465 / this.segs);
    const n = vec3();
    let vi = 0, ii = 0, k = 0;
    for (let i = 0; i <= this.rings; i++) {
      const t = i * a;
      const Ri = fr(Math.sin(t) * this.dims[0]), Ci = fr(Math.cos(t) * this.dims[1]);
      for (let j = 0; j <= this.segs; j++) {
        const s = j * b, sx = Math.sin(s) * Ri;
        const X = fr(sx), Z = fr(Math.cos(s) * Ri);
        n[0] = X; n[1] = Ci; n[2] = Z;
        vec3Normalize(n, n);
        const o = 10 * vi;
        f[o] = X; f[o + 1] = Ci; f[o + 2] = Z;
        f[o + 3] = n[0]; f[o + 4] = n[1]; f[o + 5] = n[2];
        f[o + 8] = fr(1 - j / this.segs);
        f[o + 9] = fr(i / this.rings);
        u[o + 6] = this.diffuse; u[o + 7] = this.specular;
        vi++;
        if (i !== this.rings) { idx[ii++] = k; idx[ii++] = (this.segs + k + 1) & 0xffff; k++; }
      }
    }
    this.dirty = false;
  }
  render(env: SceneEnv): void {
    const d = env.dev;
    if (!this.visible) return;
    if (this.dirty) this.build();
    d.setStreamSource(0, this.vb!, 40);
    d.setVertexShader(D3D.FVF_MESH);
    const sw = d.getRenderState(D3D.WRAP0);
    d.setRenderState(D3D.WRAP0, 3);
    let ss = 0;
    if (this.specularOn) { ss = d.getRenderState(D3D.SPECULARENABLE); d.setRenderState(D3D.SPECULARENABLE, 1); }
    let saved: Texture | null = null, swapped = false;
    if (this.texture) {
      d.setTextureStageState(0, D3D.COLOROP, 4); d.setTextureStageState(0, D3D.COLORARG1, 2); d.setTextureStageState(0, D3D.COLORARG2, 1);
      d.setTextureStageState(0, D3D.MIPFILTER, 2);
      saved = d.getTexture(0); swapped = true;
      d.setTexture(0, this.texture);
    }
    const sm = d.getMaterial();
    d.setMaterial(this.mat);
    d.setIndices(this.ib!, 0);
    d.drawIndexedPrimitive(D3D.TRIANGLESTRIP, 0, this.nVerts, 0, this.nIdx - 2);
    d.setRenderState(D3D.WRAP0, sw);
    d.setMaterial(sm);
    if (swapped && saved) d.setTexture(0, saved);
    if (this.specularOn) d.setRenderState(D3D.SPECULARENABLE, ss);
  }
}

/** the point list, class 0x00407d4c (ctor 0x004482a9, add 0x0044830f, alloc 0x0044837c, render 0x004483c8) */
export class Points extends Obj {
  type = -1;                                 // +0x20: 0 points, 1 lines, 2 triangles
  data: Uint8Array | null = null;            // +0x14: (x, y, z, colour) records
  cap = 0;                                   // +0x24
  count = 0;                                 // +0x28: the last record written (the first written is record 1)
  dirty = true;                              // +0x1c
  vb: VertexBuffer | null = null;            // +0x18
  alloc(n: number): void {
    if (this.type < 0) return;
    this.data = new Uint8Array(n * 16); this.cap = n; this.count = 0;
  }
  add(x: number, y: number, z: number, color: number): void {
    if (!this.data || this.type < 0 || !(this.count < this.cap - 1)) return;
    const dv = new DataView(this.data.buffer), o = ++this.count * 16;
    dv.setFloat32(o, x, true); dv.setFloat32(o + 4, y, true); dv.setFloat32(o + 8, z, true); dv.setUint32(o + 12, color, true);
    this.dirty = true;
  }
  render(env: SceneEnv): void {
    const d = env.dev;
    if (!this.data || this.cap <= 0) return;
    if (!this.vb || this.dirty) this.vb = new VertexBuffer(this.cap * 16, D3D.FVF_XYZ_DIFFUSE);
    this.dirty = false;
    this.vb.bytes.set(this.data);
    const saved = d.getTexture(0);
    d.setTexture(0, null);
    d.setStreamSource(0, this.vb, 16);
    d.setVertexShader(D3D.FVF_XYZ_DIFFUSE);
    const sm = d.getMaterial();
    d.setMaterial(material([10, 10, 10, 0, 1, 1, 1, 0, 1, 1, 1, 0, 10, 10, 10, 0, 10]));   // c = 10 (0x00404178)
    if (this.type === 0) d.drawPrimitive(D3D.POINTLIST, 0, this.cap - 1);
    else if (this.type === 1) d.drawPrimitive(2, 0, this.cap >> 1);
    else if (this.type === 2) d.drawPrimitive(3, 0, this.cap);
    d.setMaterial(sm);
    d.setTexture(0, saved);
    if (saved) d.setTexture(0, saved);
  }
}

/** the light, class 0x00407d9c (ctor 0x00448bdc, set 0x00448a90) */
export class SceneLight extends Obj {
  l: Light = new Float32Array(26);           // +0x14: D3DLIGHT8
  index: number;                             // +0x7c
  on = false;                                // +0x80
  node: Node | null = null;                  // +0x84
  local = vec3();                            // +0x88
  constructor(index: number) {
    super();
    this.index = index;
    const l = this.l;
    l[0] = 3;                                // directional
    l[1] = 1; l[2] = 1; l[3] = 1; l[4] = 0;  // diffuse
    l[16] = 0; l[17] = -1; l[18] = 1;        // direction (0, -1, 1)
    l[19] = 100; l[20] = 1; l[21] = 1; l[22] = 0; l[23] = 0;   // range, falloff, attenuation 1, 0, 0
    l[24] = fb(0x3ec49809); l[25] = QUARTER_PI;              // theta, phi
  }
  apply(d: Device): void {
    if (this.node) {
      const p = vec3TransformCoord(vec3(), this.local, this.node.m);
      this.l[13] = p[0]; this.l[14] = p[1]; this.l[15] = p[2];
    }
    d.setLight(this.index, this.l);
    d.lightEnable(this.index, this.on);
  }
  render(env: SceneEnv): void { this.apply(env.dev); }
}

/** the camera, class 0x00407da8 (init 0x00448cc2, update 0x00448d60) */
export class Camera {
  eye = vec3(0, 0, -1);                      // +0x14
  dir = vec3(0, 0, 1);                       // +0x20
  up = vec3(0, 1, 0);                        // +0x2c
  right = vec3(1, 0, 0);                     // +0x38
  move = vec3(0, 0, 0);                      // +0x44
  view = mat();                              // +0x50
  roll = 0; pitch = 0; yaw = 0;              // +0x90 (about dir), +0x94 (about right), +0x98 (about up)
  /** D3DX's dispatch table starts out pointing at thunks that switch it to the SSE2 routines and then run the
   *  x87 one, once: in a fresh process the first D3DX call through the table is this camera's first
   *  normalize, so that one is x87 (it leaves (0, 0, 1) exactly as it is, and the view settles elsewhere). */
  fresh = true;
  update(d: Device): void {
    const E = this.eye, D = this.dir, U = this.up, R = this.right, M = this.move;
    E[0] = fr(((D[0] * M[2] + U[0] * M[1]) + R[0] * M[0]) + E[0]);
    E[1] = fr(((R[1] * M[0] + U[1] * M[1]) + D[1] * M[2]) + E[1]);
    E[2] = fr(((R[2] * M[0] + U[2] * M[1]) + D[2] * M[2]) + E[2]);
    if (this.fresh) { this.fresh = false; vec3NormalizeX87(D, D); } else vec3Normalize(D, D);
    const r0 = fr(D[2] * U[1] - U[2] * D[1]), r1 = fr(U[2] * D[0] - U[0] * D[2]), r2 = fr(U[0] * D[1] - D[0] * U[1]);
    R[0] = r0; R[1] = r1; R[2] = r2;
    vec3Normalize(R, R);
    const u0 = fr(R[2] * D[1] - R[1] * D[2]), u1 = fr(R[0] * D[2] - R[2] * D[0]), u2 = fr(D[0] * R[1] - D[1] * R[0]);
    U[0] = u0; U[1] = u1; U[2] = u2;
    vec3Normalize(U, U);
    const mp = matRotationAxis(mat(), R, this.pitch), my = matRotationAxis(mat(), U, this.yaw), mr = matRotationAxis(mat(), D, this.roll);
    vec3TransformCoord(D, D, my); vec3TransformCoord(R, R, my);
    vec3TransformCoord(D, D, mp); vec3TransformCoord(U, U, mp);
    vec3TransformCoord(R, R, mr); vec3TransformCoord(U, U, mr);
    matLookAtLH(this.view, E, D, U);
    d.setTransform(D3D.VIEW, this.view);
  }
}

// ------------------------------------------------------------------ the frame (node), 0x00446486
export class Node {
  m = mat();                                 // +0x04
  pos = vec3();                              // +0x44
  vel = vec3();                              // +0x50
  rotY = 0; rotX = 0; rotZ = 0;              // +0x5c, +0x60, +0x64
  scale = vec3(1, 1, 1);                     // +0x68
  objects: Obj[] = [];                       // +0x74
  children: Node[] = [];                     // +0x7c / +0x78
  parent: Node | null = null;                // +0x80
  constructor() { this.m[0] = 1; this.m[5] = 1; this.m[10] = 1; this.m[15] = 1; }
  add(o: Obj): void { o.owner = this; this.objects.push(o); }            // 0x0044641b
  addChild(n: Node): void { n.parent = this; this.children.push(n); }    // 0x004463f0
  setPos(x: number, y: number, z: number): void { this.pos[0] = fr(x); this.pos[1] = fr(y); this.pos[2] = fr(z); }     // 0x0044646e
  setScale(x: number, y: number, z: number): void { this.scale[0] = fr(x); this.scale[1] = fr(y); this.scale[2] = fr(z); } // 0x00446456
  /** 0x0044654f: m = ((RX * (RZ * RY)) * T) * S, then * the parent's */
  update(d: Device): void {
    const p = this.pos, v = this.vel;
    p[0] = fr(v[0] + p[0]); p[1] = fr(v[1] + p[1]); p[2] = fr(v[2] + p[2]);
    const T = matTranslation(mat(), p[0], p[1], p[2]);
    const S = matScaling(mat(), this.scale[0], this.scale[1], this.scale[2]);
    const RX = matRotationX(mat(), this.rotX), RY = matRotationY(mat(), this.rotY), RZ = matRotationZ(mat(), this.rotZ);
    const M = matMul(mat(), RZ, RY);
    matMul(M, RX, M);
    matMul(T, M, T);
    matMul(T, T, S);
    this.m.set(T);
    if (this.parent) matMul(this.m, this.m, this.parent.m);
    d.setTransform(D3D.WORLD, this.m);
  }
  /** 0x004466a5 */
  render(env: SceneEnv): void {
    this.update(env.dev);
    for (const c of this.children) c.render(env);
    if (this.objects.length) {
      env.dev.setTransform(D3D.WORLD, this.m);
      for (const o of this.objects) if (o.visible) o.render(env);
    }
  }
}

// ------------------------------------------------------------------ the presets
export interface PresetCtx extends SceneEnv {
  timer: Timer;
  /** the window (GetWindowRect of the visualization window), for the starfield's size */
  winW: number; winH: number;
  /** the Alchemy texture's width (the museum's floor picks its checkerboard from it) */
  texW: number;
}

/** the preset base, 0x004131a4: a root frame (+0x04) and the fields the scene reads */
export abstract class Preset {
  root = new Node();
  deg = 0;                                   // +0x94
  speed = 0;                                 // +0x98
  /** +0x9c: more than 1 keeps the Alchemy texture at 256 in windows over 240000 pixels (0x0040b887) */
  texHint = 0;
  regen = true;                              // +0xa0: rebuild the starfield (set when the window is given)
  abstract render(env: PresetCtx, update: boolean): void;
  /** k = ftol(APPTIME * 100) % 36000, deg = k * 0.01 * speed: (0x00413c11..) as a double */
  protected degrees(env: PresetCtx): number {
    const k = Math.trunc(env.timer.appTime() * 100) % 36000;
    return (k * DEG_PER_100) * this.speed;
  }
}

function grid(cols: number, rows: number, size: number, levels: number, altUV: boolean, mat17: readonly number[] | null): Grid {
  const g = new Grid();
  g.setSize(cols, rows, size, levels, altUV);
  if (mat17) g.mat = material(mat17);
  return g;
}

/** 0: Classic (0x00413262, render 0x00413393) */
class Classic extends Preset {
  g = grid(2, 2, 2, 1, false, [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 2.2, 2.2, 2.2, 0, 50]);
  constructor() { super(); this.root.add(this.g); }
  render(env: PresetCtx, update: boolean): void {
    env.dev.setRenderState(D3D.WRAP0, 0);
    if (update) { this.root.rotX = THREE_HALF_PI; this.root.setScale(2.08, 2.08, 2.08); }
    this.root.render(env);
  }
}

/** 1: Kaleidoscope (0x004133e7, render 0x004135e0). The album-art flip (every 5 s, timeGetTime) only runs
 *  with album art, which needs WMP's core: never here. */
class Kaleidoscope extends Preset {
  g1 = grid(4, 4, 3, 0, true, [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 50]);
  g2 = grid(4, 4, 2, 0, false, null);
  albumArt: Texture | null = null;
  flipped = false;
  constructor() {
    super();
    this.texHint = 2;
    this.root.add(this.g1);
    this.g2.visible = false;
    this.root.add(this.g2);
  }
  render(env: PresetCtx, update: boolean): void {
    if (update) {
      this.g2.texture = this.albumArt;           // 0x004467cc
      this.g2.visible = this.flipped;
      this.g1.visible = !this.flipped;
      this.root.rotY = fr(this.deg * RAD);
      this.root.rotX = THREE_HALF_PI;
      this.root.setScale(1.05, 1.05, 1.05);
    }
    env.dev.setRenderState(D3D.CULLMODE, 1);
    env.dev.setRenderState(D3D.WRAP0, 0);
    this.root.render(env);
  }
}

/** the starfield both Monoliths and Strange world draw: w + h points, (r4 - r5, r2 - r3) * 10/32767 across and
 *  3 + r1 * 0.00026245919 deep (0x00413add, 0x00414231) */
function stars(p: Points, env: PresetCtx): void {
  p.type = 0;
  const n = env.winW + env.winH, K = fr(0.00030518509447574615), KZ = fr(0.0002624591870699078);
  p.alloc(n);
  for (let i = 0; i < n; i++) {
    const z = fr(A.rand() * KZ + 3.0);
    const t = fr(A.rand() * K);
    const y = fr(t - A.rand() * K);
    const t2 = fr(A.rand() * K);
    const x = fr(t2 - A.rand() * K);
    p.add(x, y, z, 0xffffffff);
  }
}

/** 2: Monoliths (0x004137df, render 0x00413bdd) */
class Monoliths extends Preset {
  starNode = new Node(); pts = new Points();
  n1 = new Node(); b1 = new Box();           // +0xa4 / +0xa8: 3 x 5 x 0.15
  n2 = new Node(); b2 = new Box();           // +0xac / +0xb0: 2.5 x 2.5 x 0.05 (album art)
  n3 = new Node(); b3 = new Box();           // +0xb4 / +0xb8: 1.5 x 1.5 x 0.05 (the Windows Media 9 Series logo)
  albumArt: Texture | null = null;
  logoLoaded = false;
  constructor(t: Timer) {
    super();
    this.texHint = 3; this.speed = 10; this.deg = fr(t.appTime());
    this.starNode.add(this.pts);
    this.b3.dims.set([1.5, 1.5, fr(0.05)]); this.n3.setPos(2, 1, 3); this.n3.add(this.b3); this.root.addChild(this.n3);
    this.b2.dims.set([2.5, 2.5, fr(0.05)]); this.n2.setPos(-2, -1, 2); this.n2.add(this.b2); this.root.addChild(this.n2);
    this.b1.dims.set([3, 5, fr(0.15)]); this.n1.setPos(0, 0, -2); this.n1.add(this.b1); this.root.addChild(this.n1);
  }
  render(env: PresetCtx, update: boolean): void {
    if (this.regen) { this.regen = false; stars(this.pts, env); }
    if (update) {
      const deg = fr(this.degrees(env));
      this.deg = deg;
      const r = fr(deg * RAD);
      this.root.rotX = r; this.root.rotY = r; this.root.rotZ = r;
      if (!this.logoLoaded) { this.b3.loadTexture(env, 0x9b, 256); this.logoLoaded = true; }
      const a1 = fr((360 - deg) * RAD), a2 = fr((180 - deg) * RAD), a3 = fr(deg * RAD);
      this.n1.rotX = a1; this.n1.rotY = a1; this.n1.rotZ = a1;
      this.n2.rotX = a2; this.n2.rotY = a2; this.n2.rotZ = a2;
      this.n3.rotX = a3; this.n3.rotY = a3; this.n3.rotZ = a3;
      this.starNode.render(env);
    }
    this.root.render(env);
  }
}

/** 3: Strange world (0x00413df7, render 0x00414331) */
class StrangeWorld extends Preset {
  starNode = new Node(); pts = new Points();
  nSmall = new Node(); sSmall = new Sphere();   // +0xa8 / +0xb0
  nBig = new Node(); sBig = new Sphere();       // +0xa4 / +0xac
  constructor(t: Timer) {
    super();
    this.texHint = 3; this.speed = 10; this.deg = fr(t.appTime());
    this.starNode.add(this.pts);
    const s = this.sSmall;
    s.dims.set([0.5, 0.5, 0.5]);
    s.mat = material([0.5, fr(0.2), fr(0.2), 0, 1, 0.5, 0.5, 0, fr(0.8), fr(0.2), fr(0.2), 0, fr(0.6), fr(0.2), fr(0.2), 0, fr(5.8)]);
    s.offs.set([0, 0, 2]);
    this.nSmall.add(s); this.root.addChild(this.nSmall);
    this.nSmall.rotZ = fb(0x3ea0d97c);
    this.nSmall.setPos(0, 0, -2);
    const b = this.sBig;
    b.dims.set([2.5, 2.5, 2.5]);
    b.mat = material([1, 1, 1, 0, 1, 1, 1, 0, fr(0.6), fr(0.6), 1, 0, fr(0.7), fr(0.7), fr(0.7), 0, fr(5.8)]);
    this.nBig.add(b); this.root.addChild(this.nBig);
    this.nBig.rotZ = fb(0xbea0d97c);
    this.nSmall.setPos(0, 0, 4);              // the DLL sets the small sphere's frame again (0x00413fdb), not the big one's
    this.speed = 10; this.deg = fr(t.appTime());
  }
  render(env: PresetCtx, update: boolean): void {
    if (this.regen) { this.regen = false; stars(this.pts, env); }
    if (update) {
      const deg = this.degrees(env);          // unrounded on the x87 stack
      this.deg = fr(deg);
      this.root.rotY = fr(RAD * deg);
      this.nSmall.rotY = fr(deg * -2 * RAD);
      this.starNode.render(env);
    }
    env.dev.setRenderState(D3D.SPECULARENABLE, 1);
    this.root.render(env);
  }
}

/** 4: WM Museum (0x00414935, render 0x0041581d) */
class Museum extends Preset {
  lightNode = new Node(); light = new SceneLight(1);
  nRoom = new Node(); room = new Box();
  nFloor = new Node(); floor = grid(8, 8, 1, 1, true, [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0.5]);
  nSphere = new Node(); sphere = new Sphere();
  nArt = new Node(); art = grid(2, 2, 2, 1, false, [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, fr(0.3), fr(0.3), fr(0.3), 0, 0.5, 0.5, 0.5, 0, 4]);
  pics: { node: Node; g: Grid; res: number }[] = [];
  albumArt: Texture | null = null;
  constructor(t: Timer) {
    super();
    this.texHint = 5; this.speed = 10; this.deg = fr(t.appTime());
    const L = this.light, l = L.l;
    l[0] = 2;                                // spot
    l[16] = 0; l[17] = 0; l[18] = 1;         // direction (0, 0, 1)
    l[24] = fb(0x3ec49809); l[25] = fb(0x3ec49809); l[20] = 1;   // theta, phi, falloff
    l[21] = 0.5; l[22] = 1; l[23] = 0.5;     // attenuation
    l[19] = 8;                               // range
    l[1] = 1; l[2] = 1; l[3] = 1; l[4] = 0;  // diffuse
    l[5] = 0.5; l[6] = 0.5; l[7] = 0.5; l[8] = 0;   // specular
    L.on = true; L.node = this.lightNode;
    this.lightNode.setPos(0, 0, 0); this.lightNode.add(L); this.root.addChild(this.lightNode);
    this.room.mat = material([2, 2, 2, 0, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0, fr(0.2), fr(0.2), fr(0.2), 0, 10]);
    this.nRoom.setScale(14, 7, 14); this.nRoom.add(this.room); this.root.addChild(this.nRoom);
    this.nFloor.add(this.floor); this.root.addChild(this.nFloor);
    const s = this.sphere;
    s.setRes(60, 60);
    s.dims.set([1, 1, 1]);
    s.mat = material([5, 1, 1, 0, 0.5, 0.5, 0.5, 0, 1, 1, 1, 0, 0.5, 0.5, 0.5, 0, 5]);
    this.nSphere.add(s); this.root.addChild(this.nSphere);
    this.nSphere.setScale(1.2, 1.2, 1.2); this.nSphere.rotX = fb(0xbfc90fdb); this.nSphere.setPos(0, 3.5, 0);
    const a = this.art;
    a.specular = 0x404040; a.specularOn = true; a.diffuse = 0x404040;
    this.nArt.add(a); this.root.addChild(this.nArt);
    this.nArt.setPos(0, 0, 6.5); this.nArt.rotZ = 0; this.nArt.rotX = THREE_HALF_PI; this.nArt.rotY = 0; this.nArt.setScale(1, 1, 1);
    // the five pictures: frame position, turn, resource; in the DLL's order of creation
    const P: [number, number, number, number, number][] = [
      [6.5, 0, 3, HALF_PI, 0x97], [6.5, 0, -3, HALF_PI, 0x96], [3, 0, fr(-6.3), PI, 0x99], [-3, 0, fr(-6.3), PI, 0x9a],
    ];
    for (const [x, y, z, ry, res] of P) {
      const g = grid(2, 2, 2, 1, false, [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, fr(0.3), fr(0.3), fr(0.3), 0, 0.5, 0.5, 0.5, 0, 4]);
      const n = new Node(); n.add(g); this.root.addChild(n);
      n.setPos(x, y, z); n.rotZ = 0; n.rotX = THREE_HALF_PI; n.rotY = ry;
      this.pics.push({ node: n, g, res });
    }
    const g = grid(2, 2, 2, 1, false, [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, fr(0.3), fr(0.3), fr(0.3), 0, 0.5, 0.5, 0.5, 0, 8]);
    const n = new Node(); n.add(g); this.root.addChild(n);
    this.pics.push({ node: n, g, res: 0x98 });
  }
  render(env: PresetCtx, update: boolean): void {
    if (update) {
      const w = env.texW;
      const chk = w === 0x40 || w === 0x80 ? 0 : w === 0x100 ? 1 : w === 0x200 || w === 0x400 ? 2 : 0;
      const deg = this.degrees(env);
      this.deg = fr(deg);
      this.root.rotY = fr(deg * RAD);
      this.room.cull = 2;
      this.art.texture = this.albumArt;
      for (let i = 0; i < 4; i++) this.pics[i].g.loadTexture(env, this.pics[i].res, 256);
      const last = this.pics[4];
      last.g.loadTexture(env, 0x98, 256);
      last.node.setPos(-6.5, 0, 0); last.node.rotZ = 0; last.node.rotY = THREE_HALF_PI; last.node.rotX = THREE_HALF_PI;
      this.floor.loadTexture(env, 0xc9 + chk, 256);
      this.nFloor.setPos(0, fr(-3.4), 0); this.nFloor.setScale(2, 1, 2);
      env.dev.setRenderState(D3D.SPECULARENABLE, 1);
      this.sphere.cull = 3;
    }
    this.root.render(env);
  }
}

/** 5: Draco's room (0x004143e4, render 0x0041483f) */
class Dracos extends Preset {
  nSphere = new Node(); sphere = new Sphere();
  nWall = new Node(); wall = grid(4, 4, 4, 1, true, [fr(0.2), fr(0.2), fr(0.2), 0, 0.5, 0.5, 0.5, 0, fr(0.2), fr(0.2), fr(0.2), 0, fr(0.2), fr(0.2), fr(0.2), 0, 5]);
  nFloor = new Node(); floor = grid(1, 1, 2, 1, true, [0.5, 0.5, 0.5, 0, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 1, 1, 1, 0, 5]);
  constructor(t: Timer) {
    super();
    this.speed = 10; this.deg = fr(t.appTime()); this.texHint = 4;
    this.nWall.add(this.wall); this.root.addChild(this.nWall);
    this.nFloor.add(this.floor); this.root.addChild(this.nFloor);
    const s = this.sphere;
    s.dims.set([1, 1, 1]);
    s.mat = material([2, 2, 2, 0, 0.5, 0.5, 0.5, 0, 5, 5, 5, 0, 0, 0, 0, 0, 300]);
    this.nSphere.add(s); this.root.addChild(this.nSphere);
  }
  render(env: PresetCtx, update: boolean): void {
    if (update) {
      this.deg = fr(this.degrees(env));
      this.nWall.rotX = THREE_HALF_PI; this.nWall.setPos(0, 0, 15);
      this.nFloor.setPos(0, -1, 0); this.nFloor.setScale(1.5, 1, 1.5); this.nFloor.rotX = fb(0x3fbde44f);
      this.nSphere.rotX = fb(0xbf8efa35);
    }
    this.root.render(env);
  }
}

// ------------------------------------------------------------------ the scene, 0x004165c2 / 0x00415b22 / 0x00415d26
export class Scene {
  preset = -1;                               // +0x38
  p: Preset | null = null;                   // +0x3c
  camera = new Camera();                     // +0x44
  light = new SceneLight(0);                 // +0x48
  alchemyTex: Texture | null = null;         // +0x40
  paused = false;                            // +0x2c
  accum = 0;                                 // +0x30
  proj = mat();                              // +0x74
  constructor(public timer: Timer) {}

  /** 0x00415b22 */
  setPreset(n: number): void {
    if (this.preset === n) return;
    this.preset = n;
    const t = this.timer;
    this.p = n === 0 ? new Classic() : n === 1 ? new Kaleidoscope() : n === 2 ? new Monoliths(t) : n === 3 ? new StrangeWorld(t)
      : n === 4 ? new Museum(t) : n === 5 ? new Dracos(t) : null;
    const L = this.light.l;
    L[0] = 3;
    L[1] = 1; L[2] = 1; L[3] = 1; L[4] = 0;
    L[5] = 1; L[6] = 1; L[7] = 1; L[8] = 0;
    if (n === 0) { L[16] = 0; L[17] = 0; L[18] = -1; }
    const v = n === 2 ? -3 : -1;
    L[16] = v; L[17] = v; L[18] = 1;
    if (this.p) this.p.regen = true;
    t.start();
  }

  /** 0x00415d26, inside BeginScene/EndScene */
  render(env: PresetCtx, aspect: number): void {
    const d = env.dev;
    d.setTransform(D3D.PROJECTION, matPerspectiveFovLH(this.proj, QUARTER_PI, aspect, 1, 500));
    d.setRenderState(D3D.ZENABLE, 0);
    this.camera.eye.set([0, 0, -10]);
    this.camera.update(d);
    d.setRenderState(D3D.CULLMODE, 3);
    d.setRenderState(D3D.DIFFUSEMATERIALSOURCE, 0);
    d.setRenderState(D3D.AMBIENTMATERIALSOURCE, 1);
    d.setRenderState(D3D.SPECULARMATERIALSOURCE, 2);
    this.light.on = true;
    this.light.apply(d);
    d.setRenderState(D3D.LIGHTING, 1);
    d.setRenderState(D3D.AMBIENT, 0xff404040);
    if (this.alchemyTex) {
      d.setTexture(0, this.alchemyTex);
      d.setTextureStageState(0, D3D.COLOROP, 4); d.setTextureStageState(0, D3D.COLORARG1, 2); d.setTextureStageState(0, D3D.COLORARG2, 1);
    }
    const p = this.p;
    if (!p) return;
    let update = !this.paused;
    if (!this.paused) {
      this.timer.start();
      const acc = this.timer.elapsed() + this.accum;
      this.accum = fr(acc);
      if (acc > fr(0.016)) { update = true; this.accum = 0; }
    } else { this.accum = 0; update = false; }
    switch (this.preset) {
      case 0:
        d.setTransform(D3D.PROJECTION, matPerspectiveFovLH(this.proj, QUARTER_PI, 1, 1, 100));
        p.render(env, update);
        break;
      case 1: p.render(env, update); break;
      case 2:
        d.setRenderState(D3D.ZENABLE, 1);
        d.setRenderState(D3D.AMBIENTMATERIALSOURCE, 0); d.setRenderState(D3D.SPECULARMATERIALSOURCE, 0); d.setRenderState(D3D.DIFFUSEMATERIALSOURCE, 0);
        this.light.l[16] = 0; this.light.l[17] = -1; this.light.l[18] = 1;
        this.light.apply(d);
        d.setRenderState(D3D.AMBIENT, 0xff000000);
        p.render(env, update);
        break;
      case 3:
        d.setRenderState(D3D.ZENABLE, 1);
        this.camera.eye.set([0, -2, -10]);
        this.camera.update(d);
        d.setRenderState(D3D.AMBIENTMATERIALSOURCE, 0); d.setRenderState(D3D.SPECULARMATERIALSOURCE, 0); d.setRenderState(D3D.DIFFUSEMATERIALSOURCE, 0);
        d.setRenderState(D3D.AMBIENT, 0xff000000);
        p.render(env, update);
        break;
      case 4:
        d.setRenderState(D3D.ZENABLE, 0);
        d.setRenderState(D3D.SPECULARENABLE, 1);
        d.setRenderState(D3D.AMBIENT, 0xff404040);
        d.setRenderState(D3D.AMBIENTMATERIALSOURCE, 0); d.setRenderState(D3D.SPECULARMATERIALSOURCE, 0); d.setRenderState(D3D.DIFFUSEMATERIALSOURCE, 0);
        p.render(env, update);
        break;
      case 5:
        this.camera.eye.set([0, 0, -4]);
        this.camera.update(d);
        p.render(env, update);
        break;
    }
  }
}
