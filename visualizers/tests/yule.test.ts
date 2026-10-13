// Yule Log (src/yule): the port's own output on its own art. The scene's call stream is checked through
// TraceDevice (the D3T1 records the private harness compares with the DLL's), the pieces of D3DX it reproduces
// against values worked out by hand, and its response to sound against a silent stream.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { A } from '../src/ns';
import '../src/rand';
import { TraceDevice } from '../src/d3d8/trace';
import { Scene } from '../src/yule/scene';
import { makeYuleArt } from '../src/yule/art';
import { assemble, DECLARATION, RIGID, SKIN } from '../src/yule/shaders';
import { inverse, lookAtRH, mat, multiply, perspectiveFovRH, rotationY, vec3Normalize } from '../src/yule/math';
import { loadMesh } from '../src/yule/d3dx';

interface Rec { id: number; args: number[]; blobs: Uint8Array[] }
function records(b: Uint8Array): Rec[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Rec[] = [];
  let o = 8;
  while (o < b.length) {
    const id = dv.getUint32(o, true), n = dv.getUint32(o + 8, true); o += 12;
    const args = Array.from({ length: n }, (_, i) => dv.getUint32(o + i * 4, true)); o += n * 4;
    const nb = dv.getUint32(o, true); o += 4;
    const blobs: Uint8Array[] = [];
    for (let i = 0; i < nb; i++) { const len = dv.getUint32(o, true); o += 4; blobs.push(b.slice(o, o + len)); o += len; }
    out.push({ id, args, blobs });
  }
  return out;
}
/** records of frame f (between its 0xF0 and 0xF1 marks) */
function frame(rs: Rec[], f: number): Rec[] {
  const a = rs.findIndex((r) => r.id === 0xf000 && r.args[0] === f), b = rs.findIndex((r) => r.id === 0xf100 && r.args[0] === f);
  return rs.slice(a + 1, b);
}

const art = makeYuleArt();
function level(loud: number, f: number) {
  const fr = new Uint8Array(1024), fr2 = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const v = loud * (200 - i * 0.18) * (0.6 + 0.4 * Math.sin(f * 0.7 + i * 0.05));
    fr[i] = Math.max(0, Math.min(255, Math.round(v))); fr2[i] = fr[(i + 7) % 1024]!;
  }
  return { freq: [fr, fr2] as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>],
    wave: [new Uint8Array(1024).fill(128), new Uint8Array(1024).fill(128)] as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>],
    state: 2, timeStamp: f * 166667 };
}
function run(n: number, loud: number): Rec[] {
  A.randSeed(1);
  const dev = new TraceDevice(320, 240, 0x46);
  let f = 0;
  const scene = new Scene(dev, { assets: art, now: () => (100000 + f * 16) * 1000 });
  for (f = 0; f < n; f++) { dev.frameStart(f); scene.render(level(loud, f), 320, 240); dev.frameEnd(f); }
  return records(dev.bytes());
}

describe('Yule Log scene', () => {
  const loud = run(6, 1), quiet = run(6, 0);

  it('sets up in the first frame (textures, flame copies, meshes, a Reset to the window) and draws from the second', () => {
    const f0 = frame(loud, 0), f1 = frame(loud, 1);
    const count = (rs: Rec[], slot: number) => rs.filter((r) => r.id === slot).length;
    expect(count(f0, 20)).toBe(25 + 8 + 4);                   // CACHE_TEX, CACHE_TURB, the flames' SYSTEMMEM copies
    expect(count(f0, 28)).toBe(4);                            // CopyRects
    expect(count(f0, 75)).toBe(8);                            // the four shaders, made again after the Reset
    expect(count(f0, 15)).toBe(0);                            // no Present while the window size settles
    expect(count(f1, 15)).toBe(1);
    expect(count(f1, 36)).toBe(1);
    const draws = count(f1, 71);
    expect(draws).toBeGreaterThan(10);
    expect(count(frame(loud, 5), 71)).toBe(draws);
  });

  it('is deterministic', () => {
    // what the calls carry (states, constants, draws, every lock's bytes), not object addresses (TraceDevice numbers
    // its objects process-wide)
    const keep = new Set([50, 63, 71, 79, 1 << 8 | 17, 2 << 8 | 10, 3 << 8 | 12, 4 << 8 | 12]);
    const h = (rs: Rec[]) => createHash('sha1').update(JSON.stringify(rs.filter((r) => keep.has(r.id))
      .map((r) => [r.id, r.args.slice(1), r.blobs.map((x) => createHash('sha1').update(x).digest('hex'))]))).digest('hex');
    expect(h(run(4, 1))).toBe(h(run(4, 1)));
  });

  it('answers the music: the glow colour, the logs\' glow and the flames change with the spectrum', () => {
    const c21 = (rs: Rec[], f: number) => Array.from(new Float32Array(frame(rs, f).find((r) => r.id === 79 && r.args[1] === 21)!.blobs[0]!.buffer));
    const tf = (rs: Rec[], f: number) => frame(rs, f).filter((r) => r.id === 50 && r.args[1] === 60).map((r) => r.args[2]);
    const flames = (rs: Rec[], f: number) => frame(rs, f).filter((r) => r.id === (2 << 8 | 10) && r.blobs.length && r.blobs[0]!.length > 32)
      .map((r) => createHash('sha1').update(r.blobs[0]!).digest('hex'));
    // silence: the nodes' offsets only (0.99, 0.11, 0.01) and no glow
    expect(c21(quiet, 3)).toEqual([Math.fround(0.99), Math.fround(0.11), Math.fround(0.01), 1]);
    expect(tf(quiet, 3).every((v) => v === 0)).toBe(true);
    expect(c21(loud, 3)).not.toEqual(c21(quiet, 3));
    expect(tf(loud, 3).some((v) => v !== 0)).toBe(true);
    expect(flames(loud, 4)).not.toEqual(flames(quiet, 4));
    expect(flames(loud, 4)).not.toEqual(flames(loud, 5));      // music: the flames move
  });
});

describe('Yule Log D3DX pieces', () => {
  it('looks at the fire like the DLL: view and projection', () => {
    const v = lookAtRH(mat(), new Float32Array([0, -0.05, 1.02]), new Float32Array([0, -0.15, 0]), new Float32Array([0, 1, 0]));
    // the table reciprocal square root leaves x = 1.0000001 (not 1)
    expect(Array.from(v.subarray(0, 3))).toEqual([Math.fround(1.0000001192092896), 0, 0]);
    const p = perspectiveFovRH(mat(), 0.6108652353286743, Math.fround(320 / 240), 0.009999999776482582, 3.299999952316284);
    expect(p[11]).toBe(-1);
    expect(p[5]).toBeCloseTo(1 / Math.tan(0.6108652353286743 / 2), 6);
  });

  it('normalises with the chord table: |v| within a float ulp-ish of 1, (0,-1,-2) -> 1/sqrt(5)', () => {
    const n = vec3Normalize(new Float32Array(3), new Float32Array([0, -1, -2]));
    expect(n[1]).toBeCloseTo(-1 / Math.sqrt(5), 6);
    expect(n[2]).toBeCloseTo(-2 / Math.sqrt(5), 6);
  });

  it('inverts and multiplies: R * R^-1 = I for a rotation and translation', () => {
    const m = rotationY(mat(), 0.7); m[12] = 0.3; m[13] = -0.2; m[14] = 0.1;
    const i = inverse(mat(), null, m)!;
    const id = multiply(mat(), m, i);
    for (let k = 0; k < 16; k++) expect(id[k]).toBeCloseTo(k % 5 === 0 ? 1 : 0, 6);
    expect(inverse(mat(), null, new Float32Array(16))).toBeNull();
  });

  it('attribute-sorts a mesh: faces by material, each material its own run of vertices (shared ones copied)', () => {
    const dev = new TraceDevice(16, 16);
    // two quads sharing an edge (vertices 1, 2), the second quad's faces first in the file
    const m = {
      name: 'm', positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0], normals: new Array(18).fill(0), uvs: new Array(12).fill(0),
      faces: [1, 4, 5, 1, 5, 2, 0, 1, 2, 0, 2, 3], faceMaterials: [1, 1, 0, 0],
      materials: [{ diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], texture: null },
        { diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], texture: null }],
    };
    const o = loadMesh(dev, m);
    expect(o.attributes).toEqual([{ id: 0, faceStart: 0, faceCount: 2, vertexStart: 0, vertexCount: 4 },
      { id: 1, faceStart: 2, faceCount: 2, vertexStart: 4, vertexCount: 4 }]);
    // material 0 owns 0..3; material 1 owns 4, 5 and copies 1, 2 in the order its faces use them: 1, 2 -> 6, 7
    expect(Array.from(o.indices)).toEqual([0, 1, 2, 0, 2, 3, 6, 4, 5, 6, 5, 7]);
    expect(o.vertices.length).toBe(8 * 8);
  });

  it('assembles vs.1.1: version, the declaration, instruction tokens, end', () => {
    const t = assemble(RIGID);
    expect(t[0]).toBe(0xfffe0101);
    expect(t[t.length - 1]).toBe(0x0000ffff);
    expect(t[1]).toBe(9);                                     // dp4
    expect(t[2]).toBe((0x80000000 | (4 << 28) | (1 << 16)) >>> 0);  // oPos.x
    expect(t.length).toBe(1 + 4 * 4 + 3 * 2 + 5 + 3 + 3 * 2 + 1);
    expect(assemble(SKIN).length).toBeGreaterThan(t.length);
    expect(DECLARATION[DECLARATION.length - 1]).toBe(0xffffffff);
  });
});
