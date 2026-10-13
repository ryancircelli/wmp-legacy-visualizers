// MODEL, its frames and mesh containers (plusvis.dll's Craniac engine; Yule Log's MODEL with skinning and matrix
// animation in use): loading an .x file into a frame tree (CreateStructure 0x10007250, LoadFrames 0x100075e0,
// LoadMesh 0x10007950, LoadAnimation 0x10008590), cloning it (0x10008e80 / 0x10008f80 / 0x10009530), vertex
// animation by interpolating two models' vertices into one's dynamic buffers (0x1000a440), and drawing it
// (0x10003c90 / 0x10003cf0 / 0x10003d40 / DrawMeshContainer 0x10003dc0).
import { Fmt, Lock, Pool, Prim, type Buffer, type Device, type Texture } from '../d3d8/api';
import { inverse, mat, multiply, transpose, type Mat } from '../yule/math';
import type { AttributeRange, XMaterial } from '../yule/d3dx';
import { cloneTexture, loadRigidMesh, textureFromImage } from './d3dx';
import type { Image, Plus3DAssets, XAnimationSet, XFile, XFrame, XMesh } from './assets';
import { rotationX } from './math';
import { loadSkinMesh } from './skin';
import { findFrame } from './anim';

const f = Math.fround;

/** a vertex shader slot of the MODELSET (0x18 bytes at +0xa38c / +0xa3a4: declaration, function, handle) */
export interface ShaderSlot { handle: number }

/** what loading needs from the scene: the device, the resources, D3DX's texture formats */
export interface LoadCtx { dev: Device; assets: Plus3DAssets }

/** D3DMATERIAL8 from an .x Material as this D3DX fills it (ambient left zero) */
export function materialBytes(x: XMaterial): ArrayBuffer {
  const b = new ArrayBuffer(68), v = new Float32Array(b);
  v.set([x.diffuse[0], x.diffuse[1], x.diffuse[2], x.diffuse[3], 0, 0, 0, 0, x.specular[0], x.specular[1], x.specular[2], 1,
    x.emissive[0], x.emissive[1], x.emissive[2], 1, x.power]);
  return b;
}

/** D3DXCreateTextureFromFileInMemory of a TEXTURE resource by name (MODEL::LoadMesh, BGND::InitTextures):
 *  null when there is no such resource (the DLL logs a warning and draws untextured) */
export function resourceTexture(c: LoadCtx, name: string): Texture | null {
  const im: Image | undefined = c.assets.textures[name.toUpperCase()];
  if (!im) return null;
  return textureFromImage(c.dev, im, im.alpha ? Fmt.A8R8G8B8 : Fmt.X8R8G8B8);
}

/** MESHCONT (0x60 bytes) */
export class MeshCont {
  name: string | null = null;
  ref: Float32Array | null = null;     // +0x08 reference vertices, 12 floats (48 bytes) each
  ib: Buffer | null = null;            // +0x0c the app's own index buffer
  vb: Buffer | null = null;            // +0x10 the dynamic vertex buffer (CreateVideoResources)
  skinned = false;                     // +0x18
  nBones = 0;                          // +0x1c
  nFaces = 0;                          // +0x20
  nVerts = 0;                          // +0x24
  fvf = 0;                             // +0x28
  materials: ArrayBuffer[] = [];       // +0x2c
  textures: (Texture | null)[] = [];   // +0x30
  attributes: AttributeRange[] = [];   // +0x44 (rigid) / the bone combinations' ranges (skinned)
  /** skinned: bone combinations (attribute id, ranges, 15 bone ids, -1 unused), bone frames' combined matrices,
   *  offset matrices */
  combos: { attrib: number; faceStart: number; faceCount: number; vertexStart: number; vertexCount: number; bones: number[] }[] = [];
  boneNames: string[] = [];
  boneMats: (Mat | null)[] = [];       // +0x48: pointers to the bone frames' +0xd8
  offsets: Mat[] = [];                 // +0x4c
}

/** a frame (0x138 bytes) */
export class Frame {
  meshes: MeshCont[] = [];             // +0x04 (each new one prepended)
  children: Frame[] = [];              // +0x0c and the +0x08 sibling chain, in that chain's order
  bound: Frame | null = null;          // +0x10 the model frame an animation frame drives
  isAnim = false;                      // +0x14
  local = mat();                       // +0x18
  anim = mat();                        // +0x58
  orig = mat();                        // +0x98
  combined = mat();                    // +0xd8
  /** animation keys (+0x118..+0x134): position (+0x118/+0x11c: time, x, y, z), rotation (+0x120: time, quat), scale
   *  (+0x128), matrix (+0x130: time, 16 floats) */
  posKeys: Float32Array[] = []; rotKeys: Float32Array[] = []; scaleKeys: Float32Array[] = []; matKeys: Float32Array[] = [];
  constructor(public name: string | null) {}
}

/** the order MODEL::LoadFrames links a frame's children: the first, then each later one right after the first */
function linkOrder<T>(xs: T[]): T[] { return xs.length ? [xs[0], ...xs.slice(1).reverse()] : []; }

/** MODEL (0x2c bytes) */
export class Model {
  name = '';
  t = 0;                               // +0x14 the time last animated at
  period = 0;                          // +0x18
  root!: Frame;                        // +0x24
  list: MeshCont[] = [];               // +0x28 the meshes with reference vertices, for Interpolate
  constructor(readonly shaderS: ShaderSlot, readonly shaderNS: ShaderSlot) {}

  // ------------------------------------------------------------------------------------- CreateStructure
  /** 0x10007250: the root frame (RotationX(-pi/2), copied to +0x98), the file's frames under it */
  load(c: LoadCtx, name: string, file: XFile): this {
    this.name = name;
    this.root = new Frame(null);
    const kids: Frame[] = [];
    for (const xf of file.frames) kids.push(this.loadFrame(c, xf));
    for (const xs of file.animationSets) kids.push(this.loadAnimationSet(xs));
    this.root.children = linkOrder(kids);
    findBones(this.root);
    this.list = meshList(this.root);
    rotationX(this.root.local, -1.5707963705062866);
    this.root.orig.set(this.root.local);
    return this;
  }

  private loadFrame(c: LoadCtx, xf: XFrame): Frame {
    const fr = new Frame(xf.name);
    if (xf.matrix) { const m = Float32Array.from(xf.matrix); fr.local.set(m); fr.orig.set(m); }
    for (const m of xf.meshes) fr.meshes.unshift(this.loadMesh(c, m));
    fr.children = linkOrder(xf.children.map((k) => this.loadFrame(c, k)));
    return fr;
  }

  /** 0x100082a0 / LoadAnimation 0x10008590: an animation set frame, under it a frame per Animation ("Anim-" and the
   *  frame it moves) with its keys; the model's period is the longest last key time */
  private loadAnimationSet(xs: XAnimationSet): Frame {
    const set = new Frame(xs.name);
    set.isAnim = true;
    const kids: Frame[] = [];
    for (const xa of xs.animations) {
      const fr = new Frame(xa.frame ? 'Anim-' + xa.frame : null);
      fr.isAnim = true;
      for (const k of xa.keys) {
        const keys = k.keys.map((v) => Float32Array.from(v));
        if (k.type === 0) fr.rotKeys = keys; else if (k.type === 1) fr.scaleKeys = keys;
        else if (k.type === 2) fr.posKeys = keys; else if (k.type === 4) fr.matKeys = keys;
        const last = k.keys[k.keys.length - 1][0] * 0.001;
        if (this.period < last) this.period = f(last);
      }
      kids.push(fr);
    }
    set.children = linkOrder(kids);
    return set;
  }

  /** MODEL::LoadMesh 0x10007950 */
  private loadMesh(c: LoadCtx, m: XMesh): MeshCont {
    if (m.skinWeights && m.skinWeights.length) return this.loadSkinnedMesh(c, m);
    const dev = c.dev;
    const o = loadRigidMesh(dev, m);
    const mc = new MeshCont();
    mc.name = m.name;
    mc.nFaces = o.indices.length / 3;
    const n = o.vertices.length / 8;
    mc.nVerts = n; mc.fvf = 0x112;
    mc.attributes = o.attributes;
    mc.ref = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const s = i * 8, d = i * 12, v = o.vertices;
      mc.ref[d] = v[s]; mc.ref[d + 1] = v[s + 1]; mc.ref[d + 2] = v[s + 2];
      mc.ref[d + 7] = v[s + 3]; mc.ref[d + 8] = v[s + 4]; mc.ref[d + 9] = v[s + 5]; mc.ref[d + 10] = v[s + 6]; mc.ref[d + 11] = v[s + 7];
    }
    // the app's own index buffer: GetIndexBuffer's description, WRITEONLY, SYSTEMMEM; the mesh's locked first
    mc.ib = dev.createIndexBuffer(o.indices.byteLength, 8, Fmt.INDEX16, Pool.SYSTEMMEM);
    o.ib.lock(0, 0, 0);
    const p = mc.ib.lock(0, 0, 0); p.set(new Uint8Array(o.indices.buffer, o.indices.byteOffset, o.indices.byteLength));
    mc.ib.unlock(); o.ib.unlock();
    for (const x of m.materials) {
      mc.materials.push(materialBytes(x));
      mc.textures.push(x.texture ? resourceTexture(c, x.texture) : null);
    }
    return mc;
  }

  /** LoadMesh's skinned branch: D3DX's skin mesh converted to an indexed blended mesh (palette 15, ./skin.ts); the
   *  reference vertices from its vertex buffer (position, weight, 1 - weight, the two palette indices times 3,
   *  normal, uv), the app's index buffer as for a rigid mesh, the bone combinations, names and offsets */
  private loadSkinnedMesh(c: LoadCtx, m: XMesh): MeshCont {
    const dev = c.dev;
    const o = loadSkinMesh(dev, {
      name: m.name, positions: m.positions, normals: m.normals, normalFaces: m.normalFaces ?? m.faces, uvs: m.uvs,
      faces: m.faces, faceMaterials: m.faceMaterials, materials: m.materials, duplicationIndices: m.duplication!,
      skinHeader: m.skinHeader!, skinWeights: m.skinWeights!,
    }, 15);
    if (o.stride !== 40) throw new Error('plus3d: skinned meshes with other than two weights are not ported');
    const mc = new MeshCont();
    mc.name = m.name;
    mc.skinned = true;
    mc.nBones = o.boneNames.length;
    mc.nFaces = o.indices.length / 3;
    const n = o.vertices.length / 40;
    mc.nVerts = n; mc.fvf = o.fvf;
    mc.attributes = o.attributes;
    o.vb.lock(0, 0, Lock.NOSYSLOCK); o.vb.unlock();               // ID3DXMesh::LockVertexBuffer, read
    const vf = new Float32Array(o.vertices.buffer, o.vertices.byteOffset, n * 10);
    const vu = new Uint32Array(o.vertices.buffer, o.vertices.byteOffset, n * 10);
    mc.ref = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const s = i * 10, d = i * 12, r = mc.ref;
      r[d] = vf[s]; r[d + 1] = vf[s + 1]; r[d + 2] = vf[s + 2];
      r[d + 3] = vf[s + 3]; r[d + 4] = 1 - vf[s + 3];
      r[d + 5] = (vu[s + 4] & 0xff) * 3; r[d + 6] = ((vu[s + 4] >>> 8) & 0xff) * 3;
      r[d + 7] = vf[s + 5]; r[d + 8] = vf[s + 6]; r[d + 9] = vf[s + 7]; r[d + 10] = vf[s + 8]; r[d + 11] = vf[s + 9];
    }
    mc.ib = dev.createIndexBuffer(o.indices.byteLength, 8, Fmt.INDEX16, Pool.SYSTEMMEM);
    o.ib.lock(0, 0, 0);
    const p = mc.ib.lock(0, 0, 0); p.set(new Uint8Array(o.indices.buffer, o.indices.byteOffset, o.indices.byteLength));
    mc.ib.unlock(); o.ib.unlock();
    mc.combos = o.boneCombinations.map((b) => ({ attrib: b.attribId, faceStart: b.faceStart, faceCount: b.faceCount,
      vertexStart: b.vertexStart, vertexCount: b.vertexCount, bones: Array.from(b.boneId, (x) => (x === 0xffffffff ? -1 : x)) }));
    mc.boneNames = o.boneNames;
    mc.offsets = o.boneOffsets;
    mc.boneMats = o.boneNames.map(() => null);
    for (const x of m.materials) {
      mc.materials.push(materialBytes(x));
      mc.textures.push(x.texture ? resourceTexture(c, x.texture) : null);
    }
    return mc;
  }

  // ------------------------------------------------------------------------------------------------ clones
  /** clone A (0x10008e80): name, period, every frame (0x10008f80) with its meshes (0x10009530: index buffer and
   *  textures copied) */
  clone(dev: Device): Model {
    const m = new Model(this.shaderS, this.shaderNS);
    m.name = this.name; m.t = this.t; m.period = this.period;
    m.root = cloneFrame(dev, this.root);
    findBones(m.root);
    m.list = meshList(m.root);
    return m;
  }

  /** clone B (0x10009df0, frames 0x10009eb0): the blend model, an animation model's frames each with a copy of
   *  only its first key of each kind */
  cloneKeys(): Model {
    const m = new Model(this.shaderS, this.shaderNS);
    m.name = this.name; m.t = this.t;
    const cl = (s: Frame): Frame => {
      const fr = new Frame(s.name);
      fr.isAnim = s.isAnim;
      const first = (k: Float32Array[]): Float32Array[] => (k.length ? [k[0].slice()] : []);
      fr.posKeys = first(s.posKeys); fr.rotKeys = first(s.rotKeys); fr.scaleKeys = first(s.scaleKeys); fr.matKeys = first(s.matKeys);
      fr.children = s.children.map(cl);
      return fr;
    };
    m.root = cl(this.root);
    return m;
  }

  // ---------------------------------------------------------------------------------- video resources
  /** 0x1000a640: every mesh's dynamic vertex buffer (0x1000a6d0), then the mesh list again */
  createVideoResources(dev: Device): void {
    const walk = (fr: Frame): void => {
      for (const mc of fr.meshes) {
        if (mc.ref) {
          mc.vb = dev.createVertexBuffer(mc.nVerts * 48, 0x200, 0, Pool.SYSTEMMEM);
          const p = mc.vb.lock(0, 0, 0); p.set(new Uint8Array(mc.ref.buffer, mc.ref.byteOffset, mc.ref.byteLength)); mc.vb.unlock();
        }
      }
      for (const k of fr.children) walk(k);
    };
    walk(this.root);
    this.list = meshList(this.root);
  }

  /** MODEL::Interpolate 0x1000a440: this model's vertex buffers (DISCARD) = (b - a) * t + a for position, normal, uv
   *  of the two models' reference vertices (the blend fields stay as created) */
  interpolate(a: Model, b: Model, t: number): void {
    const L = this.list, La = a.list, Lb = b.list;
    for (let k = 0; k < L.length; k++) {
      const vb = L[k].vb!, ra = La[k].ref!, rb = Lb[k].ref!;
      const n = (vb.length / 48) | 0;
      const p = vb.lock(0, 0, Lock.DISCARD);
      const d = new Float32Array(p.buffer, p.byteOffset, p.byteLength >> 2);
      for (let i = 0, o = 0; i < n; i++, o += 12) {
        d[o] = (rb[o] - ra[o]) * t + ra[o]; d[o + 1] = (rb[o + 1] - ra[o + 1]) * t + ra[o + 1]; d[o + 2] = (rb[o + 2] - ra[o + 2]) * t + ra[o + 2];
        d[o + 7] = (rb[o + 7] - ra[o + 7]) * t + ra[o + 7]; d[o + 8] = (rb[o + 8] - ra[o + 8]) * t + ra[o + 8];
        d[o + 9] = (rb[o + 9] - ra[o + 9]) * t + ra[o + 9]; d[o + 10] = (rb[o + 10] - ra[o + 10]) * t + ra[o + 10];
        d[o + 11] = (rb[o + 11] - ra[o + 11]) * t + ra[o + 11];
      }
      vb.unlock();
    }
  }

  // ------------------------------------------------------------------------------------------------- draw
  /** MODEL::Draw 0x10003c90: combined = local * parent * anim down the tree from the world matrix, then the frames */
  draw(s: DrawCtx, world: Mat): void {
    combine(this.root, world);
    this.drawFrame(s, this.root);
  }

  /** 0x10003d40 */
  private drawFrame(s: DrawCtx, fr: Frame): void {
    if (fr.meshes.length) { s.dev.setTransform(256, fr.combined); s.world.set(fr.combined); }
    for (const mc of fr.meshes) this.drawMeshCont(s, mc);
    for (const k of fr.children) this.drawFrame(s, k);
  }

  /** DrawMeshContainer 0x10003dc0 */
  private drawMeshCont(s: DrawCtx, mc: MeshCont): void {
    const dev = s.dev;
    if (!mc.skinned) {
      dev.setVertexShader(this.shaderNS.handle);
      const W = s.world;                                              // GetTransform(WORLD)
      dev.setVertexShaderConstant(51, transpose(T0, W), 4);
      const wv = multiply(T1, W, s.view);
      dev.setVertexShaderConstant(0, transpose(T0, wv), 4);
      const inv = mat();
      inverse(inv, null, wv);
      dev.setVertexShaderConstant(12, inv.subarray(0, 4), 1);
      dev.setVertexShaderConstant(13, inv.subarray(4, 8), 1);
      dev.setVertexShaderConstant(14, inv.subarray(8, 12), 1);
      dev.setVertexShaderConstant(8, transpose(T0, multiply(T2, wv, s.proj)), 4);
      for (let i = 0; i < mc.materials.length; i++) {
        const at = mc.attributes[i];
        dev.setMaterial(mc.materials[i]);
        dev.setTexture(0, mc.textures[i]);
        dev.setIndices(mc.ib, 0);
        dev.setStreamSource(0, mc.vb, 0x30);
        dev.drawIndexedPrimitive(Prim.TRIANGLELIST, at.vertexStart, at.vertexCount, at.faceStart * 3, at.faceCount);
        dev.setStreamSource(0, null, 0);
        dev.setTexture(0, null);
      }
      return;
    }
    for (const cb of mc.combos) {
      dev.setVertexShader(this.shaderS.handle);
      for (let k = 0; k < 15; k++) {
        const b = cb.bones[k];
        if (b === -1) continue;
        multiply(T1, mc.offsets[b], mc.boneMats[b]!);
        dev.setVertexShaderConstant(51 + k * 3, transpose(T0, T1), 3);
      }
      dev.setMaterial(mc.materials[cb.attrib]);
      dev.setTexture(0, mc.textures[cb.attrib]);
      dev.setIndices(mc.ib, 0);
      dev.setStreamSource(0, mc.vb, 0x30);
      dev.drawIndexedPrimitive(Prim.TRIANGLELIST, cb.vertexStart, cb.vertexCount, cb.faceStart * 3, cb.faceCount);
      dev.setStreamSource(0, null, 0);
      dev.setTexture(0, null);
    }
  }
}
const T0 = mat(), T1 = mat(), T2 = mat();

/** what drawing needs from the scene: the device, the device's world matrix as last set (DrawMeshContainer reads it
 *  back with GetTransform), view and projection */
export interface DrawCtx { dev: Device; world: Mat; view: Mat; proj: Mat }

/** 0x10003cf0: combined = local * parent, then * anim; children with the frame's combined */
function combine(fr: Frame, parent: Mat): void {
  multiply(fr.combined, fr.local, parent);
  multiply(fr.combined, fr.combined, fr.anim);
  for (const k of fr.children) combine(k, fr.combined);
}

/** 0x1000a370 / 0x1000a3c0: the meshes with reference vertices; each frame's group (in chain order) put at the head,
 *  then the children's, depth first */
export function meshList(root: Frame): MeshCont[] {
  let head: MeshCont[] = [];
  const walk = (fr: Frame): void => {
    const group = fr.meshes.filter((m) => m.ref);
    head = group.concat(head);
    for (const k of fr.children) walk(k);
  };
  walk(root);
  return head;
}

/** 0x10008f80: a frame's copy: matrices, keys; its meshes (0x10009530), then its children */
function cloneFrame(dev: Device, s: Frame): Frame {
  const fr = new Frame(s.name);
  fr.local.set(s.local); fr.anim.set(s.anim); fr.orig.set(s.orig); fr.combined.set(s.combined);
  fr.isAnim = s.isAnim;
  fr.posKeys = s.posKeys; fr.rotKeys = s.rotKeys; fr.scaleKeys = s.scaleKeys; fr.matKeys = s.matKeys;
  fr.meshes = s.meshes.map((m) => cloneMesh(dev, m));
  fr.children = s.children.map((k) => cloneFrame(dev, k));
  return fr;
}

/** MESHCONT::Clone 0x10009530: the index buffer copied (source locked first), the reference vertices, materials and
 *  each texture copied level by level */
function cloneMesh(dev: Device, s: MeshCont): MeshCont {
  const m = new MeshCont();
  Object.assign(m, s);
  m.vb = null;
  if (s.ib) {
    m.ib = dev.createIndexBuffer(s.ib.length, 8, Fmt.INDEX16, Pool.SYSTEMMEM);
    const sp = s.ib.lock(0, 0, 0), dp = m.ib.lock(0, 0, 0);
    dp.set(sp); m.ib.unlock(); s.ib.unlock();
  }
  if (s.ref) m.ref = s.ref.slice();
  m.materials = s.materials.slice();
  m.textures = s.textures.map((t) => (t ? cloneTexture(dev, t) : null));
  m.attributes = s.attributes.slice();
  if (s.skinned) { m.boneMats = s.boneNames.map(() => null); m.offsets = s.offsets.map((o) => o.slice()); }
  return m;
}

/** FindBones 0x10008d60: each skinned mesh's bone matrices are its bones' frames' combined matrices, the frames
 *  found by name from the model's root */
function findBones(root: Frame): void {
  const walk = (fr: Frame): void => {
    for (const mc of fr.meshes) {
      if (!mc.skinned) continue;
      mc.boneMats = mc.boneNames.map((n) => {
        const b = findFrame(root, n);
        if (!b) throw new Error('plus3d: no bone frame ' + n);
        return b.combined;
      });
    }
    for (const k of fr.children) walk(k);
  };
  walk(root);
}

export { f };
