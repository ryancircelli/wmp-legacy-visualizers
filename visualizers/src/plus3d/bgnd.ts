// BGND: the sky box every Plus! scene sits in (ctor 0x10001970, init 0x10001a60, CreateVideoResources 0x10001aa0,
// InitTextures 0x10002c80, Draw 0x10002980, release 0x10002950): a cube of six inward-facing quads (FVF
// XYZ|NORMAL|TEX1), size `size` around the origin raised by `rise`, one texture each, JPG_<name>_TOP, _FRT, _BOT,
// _LFT, _RGT, _BAK; drawn with the fixed-function pipeline (the scene sets the states) before the models.
import { Fmt, Pool, Prim, type Buffer, type Device, type Texture } from '../d3d8/api';
import { resourceTexture, type LoadCtx } from './model';

/** the unit cube's 24 vertices (position, normal, uv) in the DLL's order: top, front (z-), bottom, left, right, back
 *  (z+); uv inset by 0.001 */
const LO = 0.0010000000474974513, HI = 0.9990000128746033;
const FACES: [number[][], number[]][] = [
  [[[1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1]], [0, -1, 0]],
  [[[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], [0, 0, 1]],
  [[[1, -1, -1], [-1, -1, -1], [-1, -1, 1], [1, -1, 1]], [0, 1, 0]],
  [[[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [1, 0, 0]],
  [[[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], [-1, 0, 0]],
  [[[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], [0, 0, -1]],
];
const UV = [[HI, LO], [LO, LO], [LO, HI], [HI, HI]];
const SUFFIX = ['_TOP', '_FRT', '_BOT', '_LFT', '_RGT', '_BAK'];

export class Bgnd {
  size = 1; rise = 0; name = '';
  ib: Buffer | null = null;            // +0x28
  vb: Buffer | null = null;            // +0x2c
  tex: (Texture | null)[] = [null, null, null, null, null, null];   // the globals 0x10061530..0x10061544

  /** 0x10001a60 */
  init(size: number, rise: number, name: string): void { this.size = size; this.rise = rise; this.name = name; }

  /** 0x10001aa0: the index and vertex buffers (WRITEONLY, MANAGED), the material, the textures (loaded once) */
  createVideoResources(c: LoadCtx): void {
    const dev = c.dev;
    if (!this.vb) {
      this.ib = dev.createIndexBuffer(0x48, 8, Fmt.INDEX16, Pool.MANAGED);
      const pi = this.ib.lock(0, 0x48, 0), ix = new Uint16Array(pi.buffer, pi.byteOffset, 36);
      for (let k = 0; k < 6; k++) ix.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 3, k * 4], k * 6);
      this.ib.unlock();
    }
    if (!this.vb) {
      this.vb = dev.createVertexBuffer(0x300, 8, 0x112, Pool.MANAGED);
      const pv = this.vb.lock(0, 0x300, 0), v = new Float32Array(pv.buffer, pv.byteOffset, 192);
      let o = 0;
      for (const [pts, n] of FACES) pts.forEach((p, k) => { v.set([p[0], p[1], p[2], n[0], n[1], n[2], UV[k][0], UV[k][1]], o); o += 8; });
      for (let i = 0; i < 24; i++) {
        v[i * 8] *= this.size; v[i * 8 + 1] *= this.size; v[i * 8 + 2] *= this.size;
        v[i * 8 + 1] += this.rise;
      }
      this.vb.unlock();
    }
    // 0x10002bf0: diffuse 0.9, ambient 1, specular 0.5, power 10
    const m = new ArrayBuffer(68), mf = new Float32Array(m);
    mf.set([0.8999999761581421, 0.8999999761581421, 0.8999999761581421, 1, 1, 1, 1, 0, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 10]);
    dev.setMaterial(m);
    for (let k = 0; k < 6; k++) if (!this.tex[k]) this.tex[k] = resourceTexture(c, 'JPG_' + this.name + SUFFIX[k]);
  }

  /** 0x10002980 */
  draw(dev: Device): void {
    dev.setVertexShader(0x112);
    dev.setStreamSource(0, this.vb, 0x20);
    dev.setIndices(this.ib, 0);
    for (let k = 0; k < 6; k++) {
      dev.setTexture(0, this.tex[k]);
      dev.drawIndexedPrimitive(Prim.TRIANGLELIST, 0, 24, k * 6, 2);
    }
  }

  /** 0x10002950: the buffers go before a Reset (the textures are managed and stay) */
  release(): void { this.vb = null; this.ib = null; }
}

