// The parts of D3DX 8 (statically linked into plusvis.dll, an earlier build than Yule Log's) whose results reach the
// device: a texture from a decoded image with its box-filtered mip chain, a texture's copy, and a rigid mesh loaded
// from an .x Mesh and attribute-sorted. Where D3DX makes buffers or textures on the way, they are made here too, in
// the same order with the same sizes, flags and locks, so the device sees the same objects (a recorded trace names
// them by creation order).
import { Fmt, Lock, Pool, type Buffer, type Device, type Rect, type Texture } from '../d3d8/api';
import type { AttributeRange } from '../yule/d3dx';
import type { Image, XMesh } from './assets';

// -------------------------------------------------------------------------------------------------- textures
const full = (w: number, h: number): Rect => ({ left: 0, top: 0, right: w, bottom: h });

/** D3DXCreateTextureFromFileInMemory (0x1001ac59 -> 0x1001a848 with every parameter D3DX_DEFAULT): a MANAGED
 *  texture of the image's size and format (JPEG: X8R8G8B8, 32-bit TGA: A8R8G8B8) with the full mip chain; level 0
 *  written through its surface, then D3DX_FILTER_BOX level by level, each level read (READONLY) to make the next:
 *  per byte (a + b + c + d + 2) >> 2 of the 2x2 block (checked on every level the DLL writes). */
export function textureFromImage(dev: Device, im: Image, fmt: Fmt): Texture {
  const { w, h } = im;
  let n = 1;
  while ((w >> (n - 1)) > 1 || (h >> (n - 1)) > 1) n++;
  const t = dev.createTexture(w, h, n, 0, fmt, Pool.MANAGED);
  let s = t.getSurfaceLevel(0);
  let l = s.lockRect(full(w, h), 0);
  for (let y = 0; y < h; y++) l.data.set(im.bgra.subarray(y * w * 4, (y + 1) * w * 4), y * l.pitch);
  s.unlockRect();
  let cur = im.bgra, cw = w, ch = h;
  s = t.getSurfaceLevel(0);
  for (let lv = 1; lv < n; lv++) {
    const d = t.getSurfaceLevel(lv);
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    s.lockRect(full(cw, ch), Lock.READONLY);
    l = d.lockRect(full(nw, nh), 0);
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      let v: number;
      if (cw > 1 && ch > 1) {
        const a = ((2 * y) * cw + 2 * x) * 4 + c, b = a + cw * 4;
        v = (cur[a] + cur[a + 4] + cur[b] + cur[b + 4] + 2) >> 2;
      } else if (cw > 1) v = (cur[(2 * x) * 4 + c] + cur[(2 * x + 1) * 4 + c] + 1) >> 1;
      else v = (cur[(2 * y) * 4 + c] + cur[(2 * y + 1) * 4 + c] + 1) >> 1;
      next[(y * nw + x) * 4 + c] = v;
    }
    for (let y = 0; y < nh; y++) l.data.set(next.subarray(y * nw * 4, (y + 1) * nw * 4), y * l.pitch);
    d.unlockRect(); s.unlockRect();
    s = d; cur = next; cw = nw; ch = nh;
  }
  return t;
}

/** MESHCONT::Clone's texture copy (0x10009530): a texture of the same description, every level copied with
 *  CopyRects (GetSurfaceLevel of the source, then of the copy, per level) */
export function cloneTexture(dev: Device, src: Texture): Texture {
  const t = dev.createTexture(src.width, src.height, src.levels, 0, src.format, Pool.MANAGED);
  for (let lv = 0; lv < src.levels; lv++) dev.copyRects(src.getSurfaceLevel(lv), null, t.getSurfaceLevel(lv), null);
  return t;
}

// ---------------------------------------------------------------------------------------------------- meshes
/** an ID3DXMesh after Optimize(D3DXMESHOPT_ATTRSORT): FVF XYZ|NORMAL|TEX1 (8 floats a vertex), 16-bit indices */
export interface OptMesh { vertices: Float32Array; indices: Uint16Array; attributes: AttributeRange[]; /** the mesh's index buffer */ ib: Buffer }

const FVF_MESH = 0x112;
const u8 = (a: Float32Array | Uint16Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** the file's vertices as the 32-byte mesh vertex (position, normal, uv) */
export function meshVertices(m: XMesh): Float32Array {
  const nv = m.positions.length / 3, raw = new Float32Array(nv * 8);
  for (let i = 0; i < nv; i++) {
    raw[i * 8] = m.positions[i * 3]; raw[i * 8 + 1] = m.positions[i * 3 + 1]; raw[i * 8 + 2] = m.positions[i * 3 + 2];
    raw[i * 8 + 3] = m.normals[i * 3]; raw[i * 8 + 4] = m.normals[i * 3 + 1]; raw[i * 8 + 5] = m.normals[i * 3 + 2];
    raw[i * 8 + 6] = m.uvs[i * 2]; raw[i * 8 + 7] = m.uvs[i * 2 + 1];
  }
  return raw;
}

/** ATTRSORT's remap (as Yule Log's D3DX does it, src/yule/d3dx.ts): faces sorted by attribute (stably); each
 *  attribute a contiguous run of vertices, first those whose first face has this attribute, in their original
 *  order, then a copy of every other vertex its faces use, in first-use order */
export function attrSort(m: XMesh): { remap: number[]; indices: Uint16Array; attributes: AttributeRange[] } {
  const nv = m.positions.length / 3, nf = m.faces.length / 3;
  const order = Array.from({ length: nf }, (_, i) => i).sort((a, b) => m.faceMaterials[a] - m.faceMaterials[b] || a - b);
  const owner = new Int32Array(nv).fill(-1);
  for (const f of order) for (let k = 0; k < 3; k++) { const x = m.faces[f * 3 + k]; if (owner[x] < 0) owner[x] = m.faceMaterials[f]; }
  const remap: number[] = [], key = new Map<number, number>();
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
  const indices = new Uint16Array(nf * 3);
  order.forEach((f, q) => {
    const at = m.faceMaterials[f];
    for (let k = 0; k < 3; k++) indices[q * 3 + k] = key.get(at * 0x100000 + m.faces[f * 3 + k])!;
  });
  return { remap, indices, attributes };
}

/**
 * D3DXLoadSkinMeshFromXof for a mesh without skin weights (0x1001bdcd -> 0x1001af09), then
 * ID3DXMesh::Optimize(D3DXMESHOPT_ATTRSORT) and the vertex read-back MODEL::LoadMesh 0x10007950 makes, with this
 * D3DX's own order of buffer locks (the vertex buffer locked first and unlocked last while filling; the index buffer
 * read once more; Optimize copying the indices into its new buffer and holding it locked while it fills the new
 * vertex buffer from the old one, READONLY).
 */
export function loadRigidMesh(dev: Device, m: XMesh): OptMesh {
  const nv = m.positions.length / 3, nf = m.faces.length / 3;
  const raw = meshVertices(m), rawI = Uint16Array.from(m.faces);
  const ib0 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  const vb0 = dev.createVertexBuffer(nv * 32, 0, FVF_MESH, Pool.SYSTEMMEM);
  const pv = vb0.lock(0, 0, Lock.NOSYSLOCK);
  const pi = ib0.lock(0, 0, Lock.NOSYSLOCK); pi.set(u8(rawI)); ib0.unlock();
  pv.set(u8(raw)); vb0.unlock();
  ib0.lock(0, 0, Lock.NOSYSLOCK); ib0.unlock();
  const { remap, indices, attributes } = attrSort(m);
  const vertices = new Float32Array(remap.length * 8);
  remap.forEach((x, i) => vertices.set(raw.subarray(x * 8, x * 8 + 8), i * 8));
  // Optimize
  const ib1 = dev.createIndexBuffer(nf * 6, 0, Fmt.INDEX16, Pool.SYSTEMMEM);
  const p1 = ib1.lock(0, 0, Lock.NOSYSLOCK);
  ib0.lock(0, 0, Lock.NOSYSLOCK); p1.set(u8(rawI)); ib0.unlock(); ib1.unlock();
  const p2 = ib1.lock(0, 0, Lock.NOSYSLOCK);
  const vb1 = dev.createVertexBuffer(remap.length * 32, 0, FVF_MESH, Pool.SYSTEMMEM);
  const q = vb1.lock(0, 0, Lock.NOSYSLOCK);
  vb0.lock(0, 0, Lock.NOSYSLOCK | Lock.READONLY);
  q.set(u8(vertices)); vb1.unlock(); vb0.unlock();
  p2.set(u8(indices)); ib1.unlock();
  // LoadMesh reads the optimized vertices back (LockVertexBuffer)
  vb1.lock(0, 0, Lock.NOSYSLOCK); vb1.unlock();
  return { vertices, indices, attributes, ib: ib1 };
}
