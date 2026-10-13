// What Yule Log loads from disk, in the form the port takes it. yule.dll reads Visualizations\Media\fire.anl,
// fire.beh and Media\Fire\*: JPEG photographs of a fireplace (four walls, bricks, stone, iron, logs, embers),
// four flame images and eight turbulence maps (32-bit TGAs), two keyframes of the modelled scene (seq10000.x,
// seq10001.x) and four compiled vertex shaders (*.vso). The port gets them already decoded: images as BGRA rows,
// the .x files as frames and meshes. The public build makes its own (./art.ts); the private A/B harness feeds the
// original files to prove the engine exact.
import type { XMesh } from './d3dx';

/** a decoded image: BGRA bytes, rows top-down (what D3DX writes into an A8R8G8B8 level 0) */
export interface Image { w: number; h: number; bgra: Uint8Array }

/** an .x Frame: its transform (FrameTransformMatrix, 16 floats row-major), CraniacRenderType (0 rigid, 2 flame,
 *  3 log), its meshes and child frames, in file order */
export interface XFrame {
  name: string;
  matrix: ArrayLike<number> | null;
  renderType: number | null;
  meshes: XMesh[];
  children: XFrame[];
}

export interface YuleAssets {
  /** CACHE_TEX: the 25 images by the DLL's names (FRT.JPG ... LOG5b.JPG, FLAME1.TGA ... FLAME4.TGA) */
  textures: Record<string, Image>;
  /** CACHE_TURB: TURBX1-4.TGA, TURBY1-4.TGA */
  turbulence: Record<string, Image>;
  /** the ANL file's keyframes (fire.anl: one vertex-animated series, "seq1", 2.0 s): each the .x file's top-level
   *  frames */
  keyframes: XFrame[][];
  /** optional debug comment tokens per shader (noskin, skin, flame, log), per instruction plus one group before
   *  the end token: with them the assembled shaders are token-for-token the .vso files */
  shaderComments?: Record<string, number[][]>;
}

/** CACHE_TEX's list, in load order (0x1006ec50) */
export const TEXTURE_NAMES = ['FRT.JPG', 'BOT.JPG', 'LFT.JPG', 'RGT.JPG', 'BRICKS.JPG', 'STONE.JPG', 'IRON.JPG', 'EMBER1.JPG',
  'EMBER2.JPG', 'EMBER3.JPG', 'LOG1.JPG', 'LOG2.JPG', 'LOG3.JPG', 'LOG4.JPG', 'LOG5.JPG', 'FLAME1.TGA', 'FLAME2.TGA',
  'FLAME3.TGA', 'FLAME4.TGA', 'EMBER1b.JPG', 'EMBER2b.JPG', 'LOG1b.JPG', 'LOG2b.JPG', 'LOG3b.JPG', 'LOG5b.JPG'];
/** CACHE_TURB's list (0x1006ecb8) */
export const TURBULENCE_NAMES = ['TURBX1.TGA', 'TURBX2.TGA', 'TURBX3.TGA', 'TURBX4.TGA', 'TURBY1.TGA', 'TURBY2.TGA',
  'TURBY3.TGA', 'TURBY4.TGA'];
/** the four flames: image, x turbulence, y turbulence (0x1006ecdc) */
export const FLAMES: [string, string, string][] = [['FLAME1.TGA', 'TURBX1.TGA', 'TURBY1.TGA'],
  ['FLAME2.TGA', 'TURBX2.TGA', 'TURBY2.TGA'], ['FLAME3.TGA', 'TURBX3.TGA', 'TURBY3.TGA'], ['FLAME4.TGA', 'TURBX4.TGA', 'TURBY4.TGA']];
