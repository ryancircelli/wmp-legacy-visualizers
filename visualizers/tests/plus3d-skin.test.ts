// Plus! 3-D's skinned meshes (src/plus3d/skin.ts): D3DX 8's skinned-mesh load and indexed-blended convert on a
// small mesh of the port's own, its results worked out by hand, and the device calls it makes through TraceDevice.
import { describe, expect, it } from 'vitest';
import { TraceDevice } from '../src/d3d8/trace';
import { loadSkinMesh, type XSkinMesh } from '../src/plus3d/skin';

const MAT = { diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], texture: null };
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** a strip of four triangles over vertices 0..5 (vertex 6 unused), a degenerate fifth; seven bones, each vertex
 *  on one or two of them */
function strip(faceMaterials = [0, 0, 0, 0, 0]): XSkinMesh {
  const faces = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 0, 0, 1];
  const infl: [number, number[], number[]][] = [   // bone: vertices, weights
    [0, [0, 1], [1, 0.5]], [1, [1, 2], [0.5, 0.5]], [2, [2, 3], [0.5, 0.25]], [3, [3, 4], [0.75, 0.5]],
    [4, [5], [0.5]], [5, [5], [0.5]], [6, [4], [0.5]],
  ];
  return {
    name: null,
    positions: Array.from({ length: 21 }, (_, i) => i), normals: Array.from({ length: 21 }, (_, i) => -i),
    uvs: Array.from({ length: 14 }, (_, i) => i / 16), faces, normalFaces: faces, faceMaterials,
    materials: [MAT, MAT], duplicationIndices: { original: 7, indices: [0, 1, 2, 3, 4, 5, 6] }, skinHeader: [2, 6, 7],
    skinWeights: infl.map(([b, vertices, weights]) => ({ node: 'b' + b, vertices, weights, offset: I })),
  };
}

interface Rec { id: number; args: number[] }
function records(b: Uint8Array): Rec[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Rec[] = [];
  let o = 8;
  while (o < b.length) {
    const id = dv.getUint32(o, true), n = dv.getUint32(o + 8, true); o += 12;
    const args = Array.from({ length: n }, (_, i) => dv.getUint32(o + i * 4, true)); o += n * 4;
    const nb = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < nb; i++) o += 4 + dv.getUint32(o, true);
    out.push({ id, args });
  }
  return out.filter((r) => r.id >> 8 !== 0xf2);
}
const CIB = 24, CVB = 23, VL = 0x30b, VU = 0x30c, IL = 0x40b, IU = 0x40c;

describe('plus3d skinned mesh (D3DX 8 indexed blending)', () => {
  it('splits faces into bone combinations that fit the palette, first fit in face order', () => {
    const dev = new TraceDevice(16, 16);
    const o = loadSkinMesh(dev, strip(), 6);
    // face bones: f0 {0,1,2}, f1 {0..3}, f2 {1,2,3,6}, f3 {2..6}: f3 does not fit beside the others in 6
    expect(o.boneCombinations.map((c) => [c.attribId, c.faceStart, c.faceCount, c.vertexStart, c.vertexCount, Array.from(c.boneId)]))
      .toEqual([[0, 0, 3, 0, 5, [0, 1, 2, 3, 6, 0xffffffff]], [0, 3, 1, 5, 3, [2, 3, 4, 5, 6, 0xffffffff]]]);
    expect(o.attributes.map((a) => a.id)).toEqual([0, 1]);
    // combination 1 owns vertex 5 and copies 3 and 4 in the order f3 uses them; the degenerate face is gone
    expect(Array.from(o.indices)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 6, 5, 7]);
    expect(o.fvf).toBe(0x1118);
    expect(o.stride).toBe(40);
    expect(o.vertices.length).toBe(8 * 40);
    const dv = new DataView(o.vertices.buffer);
    const v = (i: number) => [dv.getFloat32(i * 40, true), dv.getFloat32(i * 40 + 12, true),
      ...o.vertices.subarray(i * 40 + 16, i * 40 + 20), dv.getFloat32(i * 40 + 20, true), dv.getFloat32(i * 40 + 32, true)];
    // x, the first weight (the file's first influence), the palette slots, nx, u
    expect(v(0)).toEqual([0, 1, 0, 0, 0, 0, -0, 0]);
    expect(v(1)).toEqual([3, 0.5, 0, 1, 0, 0, -3, 2 / 16]);
    expect(v(4)).toEqual([12, 0.5, 3, 4, 0, 0, -12, 8 / 16]);
    expect(v(5)).toEqual([15, 0.5, 2, 3, 0, 0, -15, 10 / 16]);
    expect(v(6)).toEqual([9, 0.25, 0, 1, 0, 0, -9, 6 / 16]);
    expect(v(7)).toEqual([12, 0.5, 1, 4, 0, 0, -12, 8 / 16]);
    expect(o.boneNames).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
    expect(o.maxVertexInfluences).toBe(2);

    // the device: the loaded mesh (index then vertex buffer, nested fill), three reading locks, the new mesh
    // (index buffer copied and held, vertex buffer sized for the old count plus the copies), the weights
    const rs = records(dev.bytes());
    expect(rs.map((r) => r.id)).toEqual([CIB, CVB, VL, IL, IU, VU, IL, IU, IL, IU, IL, IU,
      CIB, IL, IL, IU, IU, IL, CVB, VL, VL, VU, VU, IU, VL, VU]);
    expect(rs.filter((r) => r.id === CIB || r.id === CVB).map((r) => r.args.slice(1, 5)))
      .toEqual([[24, 0, 101, 2], [7 * 32, 0, 0x112, 2], [24, 0, 101, 2], [(7 + 2) * 40, 0, 0x1118, 2]]);
    expect(rs.filter((r) => r.id === VL).map((r) => r.args[4])).toEqual([0x800, 0x800, 0x810, 0x800]);
  });

  it('keeps each combination to one attribute', () => {
    const o = loadSkinMesh(new TraceDevice(16, 16), strip([0, 1, 0, 1, 0]));
    expect(o.boneCombinations.map((c) => [c.attribId, c.faceStart, c.faceCount])).toEqual([[0, 0, 2], [1, 2, 2]]);
    expect(Array.from(o.boneCombinations[1]!.boneId.subarray(0, 8))).toEqual([0, 1, 2, 3, 4, 5, 6, 0xffffffff]);
  });

  it('makes a mesh with one influence a vertex unblended', () => {
    const m = strip();
    m.skinWeights = [{ node: 'a', vertices: [0, 1, 2], weights: [1, 1, 1], offset: I }, { node: 'b', vertices: [3, 4, 5], weights: [1, 1, 1], offset: I }];
    m.skinHeader = [1, 3, 2];
    const dev = new TraceDevice(16, 16);
    const o = loadSkinMesh(dev, m);
    expect([o.fvf, o.stride, o.boneCombinations.length]).toEqual([0x112, 32, 1]);
    expect(records(dev.bytes()).filter((r) => r.id === VL).length).toBe(3);   // no weights pass
  });

  it('refuses what D3DX would trim or reject', () => {
    const m = strip();
    m.skinWeights = Array.from({ length: 5 }, (_, b) => ({ node: 'b' + b, vertices: [0], weights: [0.2], offset: I }));
    m.skinHeader = [5, 5, 5];
    expect(() => loadSkinMesh(new TraceDevice(16, 16), m)).toThrow(/more than 4/);
    expect(() => loadSkinMesh(new TraceDevice(16, 16), strip(), 5)).toThrow(/palette/);
  });
});
