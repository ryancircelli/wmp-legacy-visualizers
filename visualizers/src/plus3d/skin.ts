// The skinned-mesh path of D3DX 8 (statically linked into plusvis.dll) as MODEL::LoadMesh (0x10007950) drives it
// for a .x Mesh with SkinWeights: D3DXLoadSkinMeshFromXof (0x1001bdcd: the mesh from 0x1001af09, the skin object
// from 0x10021d0c), then (0x100081e0) ID3DXSkinMesh::ConvertToIndexedBlendedMesh (0x10026b0e) with
// D3DXMESH_SYSTEMMEM, the loader's adjacency and a palette of 15, then GetAttributeTable on the result. Every
// buffer D3DX makes on the way is made here too, in the same order with the same sizes, flags and contents, so
// that the device sees the same calls as the DLL's (a recorded trace names buffers by creation order).
// What the device does not see (D3DX's own heap objects: the adjacency, the remap buffers) is computed only as far
// as it decides what the device sees.
import { Fmt, Lock, Pool, type Buffer, type Device } from '../d3d8/api';
import type { AttributeRange, XMaterial } from '../yule/d3dx';

/** an .x SkinWeights data object */
export interface XSkinWeights {
  node: string;                     // transformNodeName
  vertices: ArrayLike<number>;      // vertexIndices
  weights: ArrayLike<number>;
  offset: ArrayLike<number>;        // matrixOffset, 16 floats row-major
}
/** an .x Mesh data object with skin weights: triangles, normals per position (MeshNormals' faces equal to the
 *  mesh's), texture coordinates per position, VertexDuplicationIndices and XSkinMeshHeader */
export interface XSkinMesh {
  name: string | null;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  normalFaces: ArrayLike<number>;   // 3 per face
  uvs: ArrayLike<number>;
  faces: ArrayLike<number>;         // 3 indices per face
  faceMaterials: ArrayLike<number>;
  materials: readonly XMaterial[];
  duplicationIndices: { original: number; indices: ArrayLike<number> };
  /** XSkinMeshHeader: nMaxSkinWeightsPerVertex, nMaxSkinWeightsPerFace, nBones (D3DX reads only nBones) */
  skinHeader: readonly number[];
  skinWeights: readonly XSkinWeights[];
}
/** D3DXBONECOMBINATION, BoneId as its own array (paletteSize entries, 0xffffffff where unused) */
export interface BoneCombination {
  attribId: number; faceStart: number; faceCount: number; vertexStart: number; vertexCount: number; boneId: Uint32Array;
}
/** what LoadMesh takes from D3DX: the blended mesh (FVF XYZBn | LASTBETA_UBYTE4 | NORMAL | TEX1, 16-bit indices),
 *  its attribute table (one range per bone combination, id = the combination's index), the bone combination table,
 *  the bones (in D3DX's order: the file's SkinWeights order) and the materials */
export interface SkinMesh {
  fvf: number;
  stride: number;
  /** the mesh's vertices (GetNumVertices of them: the vertex buffer can be longer) */
  vertices: Uint8Array;
  indices: Uint16Array;
  attributes: AttributeRange[];
  boneCombinations: BoneCombination[];
  boneNames: string[];
  boneOffsets: Float32Array[];
  /** influences per vertex the blended mesh carries (weights stride - 1 floats, the last implied) */
  maxVertexInfluences: number;
  materials: readonly XMaterial[];
  /** the blended mesh's index and vertex buffers */
  ib: Buffer;
  vb: Buffer;
}

const FVF_MESH = 0x112;              // XYZ | NORMAL | TEX1
const NV = Lock.NOSYSLOCK;
/** D3DX's influence limit on a software-vertex-processing device (0x1001c072: 4 unless the device is hardware,
 *  pure or mixed, when it is the caps' MaxVertexBlendMatrices); plusvis.dll creates its device with software
 *  vertex processing */
const MAX_INFLUENCES = 4;
const u8 = (a: Float32Array | Uint16Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/**
 * D3DXLoadSkinMeshFromXof + ConvertToIndexedBlendedMesh(D3DXMESH_SYSTEMMEM, adjacency, paletteSize) +
 * GetAttributeTable. The device sees, in order:
 *  - D3DXCreateMeshFVF (0x10023840): the index buffer, then the vertex buffer (FVF 0x112), filled under nested locks
 *    (vertex buffer locked first) by 0x1002ce8b: the file's vertices as they are, its faces less the degenerate ones;
 *  - ConvertPointRepsToAdjacency (from VertexDuplicationIndices): a lock of the index buffer;
 *  - the convert's attribute count (0x1001f100) and its per-face bone sets: two more locks of the index buffer;
 *  - the new mesh (0x100252a8): an index buffer filled from the old one, held locked while the vertex buffer
 *    (blended FVF) is made and filled from the old vertex buffer (locked READONLY), and then given the new indices;
 *  - the blend weights and palette indices written into the new vertex buffer under one more lock.
 * (GetDirect3D, GetDeviceCaps and GetCreationParameters calls D3DX makes on the way are not part of Device.)
 */
export function loadSkinMesh(dev: Device, m: XSkinMesh, paletteSize = 15): SkinMesh {
  const nv = m.positions.length / 3;
  const nBones = m.skinHeader[2] ?? 0;
  for (let i = 0; i < m.faces.length; i++) {
    if (m.normalFaces[i] !== m.faces[i]) throw new Error('loadSkinMesh: normal faces must equal the faces');
  }
  if (m.skinWeights.length !== nBones) throw new Error('loadSkinMesh: SkinWeights count differs from nBones');
  if (nBones > 256) throw new Error('loadSkinMesh: D3DX 8 bone sets hold 256 bones');
  if (nv > 0xfffe) throw new Error('loadSkinMesh: 32-bit index meshes are not ported');

  // 0x1002ce8b: a face with a repeated index is dropped
  const faces: number[] = [], attr: number[] = [];
  for (let f = 0; f < m.faces.length / 3; f++) {
    const a = m.faces[f * 3], b = m.faces[f * 3 + 1], c = m.faces[f * 3 + 2];
    if (a === b || a === c || b === c) continue;
    faces.push(a, b, c); attr.push(m.faceMaterials[f]);
  }
  const nf = attr.length;
  if (nf === 0 || nv === 0) throw new Error('loadSkinMesh: empty mesh');
  const raw = new Float32Array(nv * 8);
  for (let i = 0; i < nv; i++) {
    raw.set([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], m.normals[i * 3], m.normals[i * 3 + 1],
      m.normals[i * 3 + 2], m.uvs[i * 2], m.uvs[i * 2 + 1]], i * 8);
  }
  const rawI = Uint16Array.from(faces);
  const ib0 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  const vb0 = dev.createVertexBuffer(nv * 32, 0, FVF_MESH, Pool.SYSTEMMEM);
  const pv = vb0.lock(0, 0, NV), pi = ib0.lock(0, 0, NV);
  pv.set(u8(raw)); pi.set(u8(rawI));
  ib0.unlock(); vb0.unlock();
  touch(ib0);                                       // ConvertPointRepsToAdjacency

  // the skin object's per-vertex influences (0x1001c4ef): bones in bone order, each bone's vertices in file order
  const count = new Int32Array(nv);
  for (const sw of m.skinWeights) for (let k = 0; k < sw.vertices.length; k++) count[sw.vertices[k]]++;
  let maxInf = 0;                                   // GetMaxVertexInfluences (0x1001cad5)
  for (let v = 0; v < nv; v++) maxInf = Math.max(maxInf, count[v]);
  // 0x1001c66f trims a vertex with more than MAX_INFLUENCES (keeping the heaviest, renormalised, through the
  // point reps the adjacency gives): not ported
  if (maxInf > MAX_INFLUENCES) throw new Error(`loadSkinMesh: a vertex has more than ${MAX_INFLUENCES} influences`);
  if (maxInf === 0) throw new Error('loadSkinMesh: no influences');
  const bone = new Int32Array(nv * maxInf), weight = new Float32Array(nv * maxInf);
  count.fill(0);
  m.skinWeights.forEach((sw, b) => {
    for (let k = 0; k < sw.vertices.length; k++) {
      const v = sw.vertices[k], j = v * maxInf + count[v]++;
      bone[j] = b; weight[j] = sw.weights[k];
    }
  });
  const inf = Math.min(maxInf, MAX_INFLUENCES);
  if (paletteSize < inf * 3) throw new Error('loadSkinMesh: palette smaller than three vertices\' influences');

  // ConvertToIndexedBlendedMesh (0x10026b0e)
  touch(ib0);                                       // 0x1001f100
  const sets = new Uint32Array(nf * 8);             // each face's bones, a 256-bit set
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k];
      for (let j = 0; j < Math.min(count[v], inf); j++) { const b = bone[v * maxInf + j]; sets[f * 8 + (b >> 5)] |= 1 << (b & 31); }
    }
  }
  touch(ib0);
  // bone combinations, first fit: each takes, in face order, every face still free whose bones fit the palette
  // with the combination's so far and whose attribute is that of the combination's first face
  const combo = new Int32Array(nf).fill(-1);
  const comboSets: Uint32Array[] = [];
  for (let left = nf; left > 0;) {
    const s = new Uint32Array(8), u = new Uint32Array(8);
    let at = -1;
    for (let f = 0; f < nf; f++) {
      if (combo[f] >= 0) continue;
      let n = 0;
      for (let w = 0; w < 8; w++) { u[w] = s[w] | sets[f * 8 + w]; n += popcount(u[w]); }
      if (n > paletteSize) continue;
      if (at < 0) at = attr[f];
      if (attr[f] !== at) continue;
      combo[f] = comboSets.length; s.set(u); left--;
    }
    comboSets.push(s);
  }

  // the new mesh, attribute-sorted by combination (0x100252a8, 0x10024493 with attribute sort + compact): faces
  // sorted stably by combination; each combination a run of vertices, first those whose first face in the file's
  // order is in it, in their original order, then a copy of every other vertex its faces use, in the order they
  // first use them (sorted order). A vertex no face uses is dropped, but the vertex buffer is still made for the
  // old vertex count plus the copies: its tail holds what D3DX converts from the 32 bytes before the old vertex
  // buffer's memory (the runtime's allocation header: a heap entry, zeros and the alignment slack), zeros here.
  const order = Array.from({ length: nf }, (_, i) => i).sort((a, b) => combo[a] - combo[b] || a - b);
  const owner = new Int32Array(nv).fill(-1);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) { const x = faces[f * 3 + k]; if (owner[x] < 0) owner[x] = combo[f]; }
  const remap: number[] = [], key = new Map<number, number>();     // (combination << 16 | vertex) -> new index
  const attributes: AttributeRange[] = [];
  for (let fi = 0; fi < nf;) {
    const c = combo[order[fi]];
    let fe = fi; while (fe < nf && combo[order[fe]] === c) fe++;
    const vs = remap.length;
    for (let x = 0; x < nv; x++) if (owner[x] === c) { key.set(c * 0x10000 + x, remap.length); remap.push(x); }
    for (let q = fi; q < fe; q++) for (let k = 0; k < 3; k++) {
      const x = faces[order[q] * 3 + k];
      if (!key.has(c * 0x10000 + x)) { key.set(c * 0x10000 + x, remap.length); remap.push(x); }
    }
    attributes.push({ id: c, faceStart: fi, faceCount: fe - fi, vertexStart: vs, vertexCount: remap.length - vs });
    fi = fe;
  }
  const indices = new Uint16Array(nf * 3);
  order.forEach((f, q) => { for (let k = 0; k < 3; k++) indices[q * 3 + k] = key.get(combo[f] * 0x10000 + faces[f * 3 + k])!; });

  const fvf = (inf === 1 ? 2 : (inf * 2 + 4) | 0x1000) | (FVF_MESH & ~0xe);
  const wOff = 12, iOff = 12 + (inf - 1) * 4, stride = inf === 1 ? 32 : iOff + 4 + 20;
  const ib1 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  const p1 = ib1.lock(0, 0, NV);
  ib0.lock(0, 0, NV);
  p1.set(u8(rawI)); ib0.unlock(); ib1.unlock();
  const pIdx = ib1.lock(0, 0, NV);
  let used = 0;
  for (let x = 0; x < nv; x++) if (owner[x] >= 0) used++;
  const vbLen = (nv + remap.length - used) * stride;
  const vb1 = dev.createVertexBuffer(vbLen, 0, fvf, Pool.SYSTEMMEM);
  const vertices = new Uint8Array(vbLen);
  const p2 = vb1.lock(0, 0, NV);
  vb0.lock(0, 0, NV | Lock.READONLY);
  const rawB = u8(raw);
  remap.forEach((x, i) => {                         // 0x1001eee7: position, normal, uv; the blend fields zero
    vertices.set(rawB.subarray(x * 32, x * 32 + 12), i * stride);
    vertices.set(rawB.subarray(x * 32 + 12, x * 32 + 32), i * stride + stride - 20);
  });
  p2.set(vertices); vb1.unlock(); vb0.unlock();
  pIdx.set(u8(indices)); ib1.unlock();

  // the bone combination table: the palette is the combination's bones in ascending order
  const slot = new Int32Array(comboSets.length * nBones);
  const boneCombinations = attributes.map((r, c): BoneCombination => {
    const boneId = new Uint32Array(paletteSize).fill(0xffffffff);
    let n = 0;
    for (let b = 0; b < nBones; b++) if (comboSets[c][b >> 5] & (1 << (b & 31))) { boneId[n] = b; slot[c * nBones + b] = n++; }
    return { attribId: attr[order[r.faceStart]], faceStart: r.faceStart, faceCount: r.faceCount, vertexStart: r.vertexStart,
      vertexCount: r.vertexCount, boneId };
  });
  if (inf > 1) {
    const out = vertices, dv = new DataView(out.buffer);
    let c = 0, inC = 0;
    remap.forEach((v, i) => {
      // the first inf - 1 weights (a slot past the vertex's influences: D3DX leaves its heap's leftovers; 0 here)
      for (let k = 0; k < inf - 1; k++) dv.setFloat32(i * stride + wOff + k * 4, k < count[v] ? weight[v * maxInf + k] : 0, true);
      for (let k = 0; k < Math.min(count[v], inf); k++) out[i * stride + iOff + k] = slot[c * nBones + bone[v * maxInf + k]];
      if (++inC >= boneCombinations[c].vertexCount) { c++; inC = 0; }
    });
    vb1.lock(0, 0, NV).set(vertices); vb1.unlock();
  }
  return {
    fvf, stride, vertices: vertices.slice(0, remap.length * stride), indices, attributes, boneCombinations,
    boneNames: m.skinWeights.map((s) => s.node), boneOffsets: m.skinWeights.map((s) => Float32Array.from(s.offset)),
    maxVertexInfluences: inf, materials: m.materials, ib: ib1, vb: vb1,
  };
}

/** a lock and unlock that reads */
function touch(b: Buffer): void { b.lock(0, 0, NV); b.unlock(); }

function popcount(x: number): number {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}
