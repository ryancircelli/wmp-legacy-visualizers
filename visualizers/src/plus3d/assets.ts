// What plusvis.dll (Plus! 3-D Visualizations) loads from its own resources, in the form the port takes it. The DLL
// keeps everything as named resources (the name -> id table at 0x1005cd40): .x models and animations (XFILE), the
// ANL files naming each preset's models and animation series, the BEH files with its camera and light paths, the
// vertex shaders (SHADER, compiled .vso) and the textures (TEXTURE: JPEG and TGA files, decoded by D3DX). The port
// gets them already decoded: images as BGRA rows, the .x files as frames, meshes and animation sets. The public
// build makes its own (./art.ts); the private A/B harness feeds the original resources to prove the engine exact.
import type { XMaterial } from '../yule/d3dx';

/** a decoded image: BGRA bytes, rows top-down (what D3DX writes into level 0) */
export interface Image { w: number; h: number; bgra: Uint8Array; /** a 32-bit TGA (A8R8G8B8); else a JPEG (X8R8G8B8) */ alpha?: boolean }

/** an .x SkinWeights object */
export interface XSkinWeights {
  node: string;                 // transformNodeName
  vertices: ArrayLike<number>;
  weights: ArrayLike<number>;
  offset: ArrayLike<number>;    // matrixOffset, 16 floats row-major
}

/** an .x Mesh: triangles, normals and texture coordinates per position (the data the DLL ships, and ours) */
export interface XMesh {
  name: string | null;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  uvs: ArrayLike<number>;
  faces: ArrayLike<number>;            // 3 indices per face
  faceMaterials: ArrayLike<number>;
  materials: readonly XMaterial[];
  /** VertexDuplicationIndices (indices, original vertex count), when the file has them */
  duplication?: { original: number; indices: ArrayLike<number> };
  /** XSkinMeshHeader (max weights per vertex, per face, bones) */
  skinHeader?: readonly [number, number, number];
  skinWeights?: readonly XSkinWeights[];
  /** MeshNormals' faces (skinned meshes: equal to the faces) */
  normalFaces?: ArrayLike<number>;
}

/** an .x Frame: its FrameTransformMatrix (16 floats row-major), meshes and child frames in file order */
export interface XFrame {
  name: string | null;
  matrix: ArrayLike<number> | null;
  meshes: XMesh[];
  children: XFrame[];
}

/** an AnimationKey: its type (0 rotation, 1 scale, 2 position, 4 matrix) and keys [time, values...] */
export interface XAnimationKey { type: number; keys: ArrayLike<number>[] }
/** an Animation: the frame it moves (CraniacMeshFile or a {reference}) and its keys */
export interface XAnimation { name: string | null; frame: string | null; keys: XAnimationKey[] }
export interface XAnimationSet { name: string | null; animations: XAnimation[] }

/** one .x file: its top-level frames and animation sets, in file order */
export interface XFile { frames: XFrame[]; animationSets: XAnimationSet[] }

export interface Plus3DAssets {
  /** XFILE resources by name (X_MUNCH_MUNCH, MAF_MUNCH_BOP, X_BLOBBY_SEQ20000, ...) */
  xfiles: Record<string, XFile>;
  /** TEXTURE resources by name, decoded (JPG_BLOBBY, JPG_BLOBBY_TOP, TGA_MUNCH_CHAIR, ...) */
  textures: Record<string, Image>;
  /** ANLFILE / BEHFILE resources by name (ANL_BLOBBY, BEH_BLOBBY, ...) */
  text: Record<string, string>;
  /** optional debug comment tokens per shader (VSO_BLOBBYS, ...), per instruction plus one group before the end
   *  token: with them the assembled shaders are token-for-token the DLL's */
  shaderComments?: Record<string, number[][]>;
}
