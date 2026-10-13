// The parts of D3DX 8 (statically linked into yule.dll) whose results reach the device: loading a mesh from an
// .x data object and attribute-sorting it, loading a texture from decoded pixels, and the matrix stack. Where D3DX
// makes buffers or textures of its own on the way, they are made here too, in the same order with the same sizes,
// so that the device sees the same objects (a recorded trace names them by creation order).
import { Fmt, Lock, Pool, type Buffer, type Device, type Texture } from '../d3d8/api';
import { identity, mat, multiply, type Mat } from './math';

// ---------------------------------------------------------------------------------------------------- meshes
/** an .x Material, as the file gives it */
export interface XMaterial {
  diffuse: readonly number[];   // faceColor r g b a
  power: number;
  specular: readonly number[];  // r g b
  emissive: readonly number[];  // r g b
  texture: string | null;       // TextureFilename
}
/** an .x Mesh data object: triangles only, normals and texture coordinates per position (MeshNormals' faces equal
 *  the mesh's faces, MeshTextureCoords one per position), as the data Yule Log ships and the port's own scenes have */
export interface XMesh {
  name: string;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  uvs: ArrayLike<number>;
  faces: ArrayLike<number>;           // 3 indices per face
  faceMaterials: ArrayLike<number>;
  materials: readonly XMaterial[];
}
/** D3DXATTRIBUTERANGE */
export interface AttributeRange { id: number; faceStart: number; faceCount: number; vertexStart: number; vertexCount: number }
/** an ID3DXMesh after Optimize(D3DXMESHOPT_ATTRSORT): FVF XYZ|NORMAL|TEX1 (8 floats a vertex), 16-bit indices */
export interface OptMesh { vertices: Float32Array; indices: Uint16Array; attributes: AttributeRange[] }

const FVF_MESH = 0x112;

function fill(buf: Buffer, flags: number, bytes: Uint8Array): void {
  const p = buf.lock(0, 0, flags); p.set(bytes); buf.unlock();
}
const u8 = (a: Float32Array | Uint16Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/**
 * D3DXLoadSkinMeshFromXof (no skin weights) then ID3DXMesh::Optimize(D3DXMESHOPT_ATTRSORT), as LoadMesh 0x10006310
 * calls them. The loaded mesh is the file's vertices and faces as they are (one vertex per position: normals and
 * uvs index alike). ATTRSORT then sorts the faces by attribute (stably) and gives each attribute a contiguous run of
 * vertices: first the vertices whose first face (in sorted order) has this attribute, in their original order,
 * then a copy of every other vertex its faces use, in the order its faces first use them. (Checked against the
 * DLL's own buffers for all twenty meshes of the fire, including the two whose shared vertices get copies.)
 * The device sees D3DXCreateMeshFVF's index and vertex buffers, then Optimize's: four SYSTEMMEM buffers.
 */
export function loadMesh(dev: Device, m: XMesh): OptMesh {
  const nv = m.positions.length / 3, nf = m.faces.length / 3;
  const raw = new Float32Array(nv * 8);
  for (let i = 0; i < nv; i++) {
    raw.set([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], m.normals[i * 3], m.normals[i * 3 + 1],
      m.normals[i * 3 + 2], m.uvs[i * 2], m.uvs[i * 2 + 1]], i * 8);
  }
  const rawI = Uint16Array.from(m.faces);
  // D3DXCreateMeshFVF(nf, nv, SYSTEMMEM, 0x112) and the loader's fill
  const ib0 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  const vb0 = dev.createVertexBuffer(nv * 32, 0, FVF_MESH, Pool.SYSTEMMEM);
  fill(ib0, Lock.NOSYSLOCK, u8(rawI)); fill(vb0, Lock.NOSYSLOCK, u8(raw));

  // ATTRSORT
  const order = Array.from({ length: nf }, (_, i) => i).sort((a, b) => m.faceMaterials[a] - m.faceMaterials[b] || a - b);
  const owner = new Int32Array(nv).fill(-1);
  for (const f of order) for (let k = 0; k < 3; k++) { const x = m.faces[f * 3 + k]; if (owner[x] < 0) owner[x] = m.faceMaterials[f]; }
  const remap: number[] = [], key = new Map<number, number>();       // (attr << 20 | vertex) -> new index
  const attributes: AttributeRange[] = [];
  let fi = 0;
  while (fi < nf) {
    const at = m.faceMaterials[order[fi]];
    let fe = fi; while (fe < nf && m.faceMaterials[order[fe]] === at) fe++;
    const vs = remap.length;
    for (let x = 0; x < nv; x++) if (owner[x] === at) { key.set(at * 0x100000 + x, remap.length); remap.push(x); }
    for (let q = fi; q < fe; q++) for (let k = 0; k < 3; k++) {
      const x = m.faces[order[q] * 3 + k];
      if (!key.has(at * 0x100000 + x)) { key.set(at * 0x100000 + x, remap.length); remap.push(x); }
    }
    attributes.push({ id: at, faceStart: fi, faceCount: fe - fi, vertexStart: vs, vertexCount: remap.length - vs });
    fi = fe;
  }
  const vertices = new Float32Array(remap.length * 8);
  remap.forEach((x, i) => vertices.set(raw.subarray(x * 8, x * 8 + 8), i * 8));
  const indices = new Uint16Array(nf * 3);
  order.forEach((f, q) => {
    const at = m.faceMaterials[f];
    for (let k = 0; k < 3; k++) indices[q * 3 + k] = key.get(at * 0x100000 + m.faces[f * 3 + k])!;
  });
  // Optimize: a new mesh (its index buffer first, filled with the old indices, then the new vertices, then the
  // new indices)
  const ib1 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  fill(ib1, Lock.NOSYSLOCK, u8(rawI));
  const p = ib1.lock(0, 0, Lock.NOSYSLOCK);
  const vb1 = dev.createVertexBuffer(remap.length * 32, 0, FVF_MESH, Pool.SYSTEMMEM);
  fill(vb1, Lock.NOSYSLOCK, u8(vertices));
  p.set(u8(indices)); ib1.unlock();
  return { vertices, indices, attributes };
}

// -------------------------------------------------------------------------------------------------- textures
/** D3DXCreateTextureFromFileEx's device side for an A8R8G8B8 image already decoded to BGRA rows (top-down):
 *  CreateTexture (levels as given; 0 = the full chain, which D3DX would then fill with its box filter: the port
 *  only ever reads such a texture's level 0, so the smaller levels are not made), level 0 written through
 *  GetSurfaceLevel + LockRect(NOSYSLOCK). */
export function textureFromPixels(dev: Device, w: number, h: number, bgra: Uint8Array, levels: number): Texture {
  const n = levels || 1 + Math.floor(Math.log2(Math.max(w, h)));
  const t = dev.createTexture(w, h, n, 0, Fmt.A8R8G8B8, Pool.MANAGED);
  const s = t.getSurfaceLevel(0);
  const l = s.lockRect(null, Lock.NOSYSLOCK);
  for (let y = 0; y < h; y++) l.data.set(bgra.subarray(y * w * 4, (y + 1) * w * 4), y * l.pitch);
  s.unlockRect();
  return t;
}

// ---------------------------------------------------------------------------------------------- matrix stack
/** ID3DXMatrixStack (D3DXCreateMatrixStack) for the calls Yule Log makes */
export class MatrixStack {
  private st: Mat[] = [mat()];
  loadIdentity(): void { identity(this.top()); }
  push(): void { this.st.push(this.top().slice()); }
  pop(): void { if (this.st.length > 1) this.st.pop(); }
  /** top = m * top */
  multMatrixLocal(m: Mat): void { multiply(this.top(), m, this.top()); }
  top(): Mat { return this.st[this.st.length - 1]; }
}
