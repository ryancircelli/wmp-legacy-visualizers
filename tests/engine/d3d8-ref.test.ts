// RefDevice (src/engine/d3d8/ref.ts): synthetic scenes of our own drawn through the software rasterizer, each frame's
// back buffer hashed (FNV-1a over B, G, R as the D3D harness hashes) and compared with golden values of the port's
// own output. The scenes cover what the D3D families use: transform and clipping, Gouraud/flat colour, lighting
// with specular, textures with filtering and mipmaps, stage blending, alpha test and blending, Z, point sprites,
// render-to-texture and a vertex shader.
import { describe, expect, it } from 'vitest';
import { type Device, Fmt, Fvf, Pool, Prim, Rs, Tss, Usage, ClearFlag } from '../../src/engine/d3d8/api';
import { RefDevice, refKernel } from '../../src/engine/d3d8/ref';

const W = 160, H = 120;

// ---- helpers ----
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
const ident = (): Float32Array => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function persp(fovy: number, aspect: number, zn: number, zf: number): Float32Array {
  const ys = 1 / Math.tan(fovy / 2), xs = ys / aspect;
  return new Float32Array([xs, 0, 0, 0, 0, ys, 0, 0, 0, 0, zf / (zf - zn), 1, 0, 0, -zn * zf / (zf - zn), 0]);
}
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; o[i * 4 + j] = s; }
  return o;
}
function world(rx: number, ry: number, tx: number, ty: number, tz: number): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  const X = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const Y = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]);
  return mul(mul(X, Y), T);
}
/** vertex bytes: 'f' float, 'c' D3DCOLOR */
function verts(layout: string, rows: number[][]): Uint8Array {
  const out = new Uint8Array(rows.length * layout.length * 4), dv = new DataView(out.buffer);
  let o = 0;
  for (const r of rows) for (let i = 0; i < layout.length; i++, o += 4) { if (layout[i] === 'c') dv.setUint32(o, r[i] >>> 0, true); else dv.setFloat32(o, r[i], true); }
  return out;
}
function f32bits(x: number): number { return new Uint32Array(new Float32Array([x]).buffer)[0]; }
function material(d: number[], a: number[], s: number[], e: number[], p: number): ArrayBuffer {
  return new Float32Array([...d, ...a, ...s, ...e, p]).buffer;
}
function dirLight(diffuse: number[], specular: number[], ambient: number[], dir: number[]): ArrayBuffer {
  const f = new Float32Array(26); new Uint32Array(f.buffer)[0] = 3;
  f.set(diffuse, 1); f.set(specular, 5); f.set(ambient, 9); f.set(dir, 16);
  return f.buffer;
}
/** a procedural ARGB texture with a full mip chain, each level drawn (not filtered down) */
function checkerTexture(d: Device, size: number, alpha: boolean): ReturnType<Device['createTexture']> {
  const t = d.createTexture(size, size, 0, 0, alpha ? Fmt.A8R8G8B8 : Fmt.X8R8G8B8, Pool.MANAGED);
  for (let l = 0; l < t.levels; l++) {
    const n = Math.max(1, size >> l), lk = t.lockRect(l, null, 0), dv = new DataView(lk.data.buffer, lk.data.byteOffset);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = ((x * 8 / n) ^ (y * 8 / n)) & 1;
      const r = c ? 230 : 40 + l * 20, g = (x * 255 / n) | 0, b = (y * 255 / n) | 0, a = alpha ? ((x + y) * 255 / (2 * n)) | 0 : 255;
      dv.setUint32(y * lk.pitch + x * 4, ((a << 24) | (r << 16) | (g << 8) | b) >>> 0, true);
    }
    t.unlockRect(l);
  }
  return t;
}

// ---- scenes: (device, frame) -> draws one frame and presents ----
export type Scene = { name: string; frames: number; setup?: (d: Device) => unknown; draw: (d: Device, f: number, ctx: unknown) => void };

export const SCENES: Scene[] = [
  {
    name: 'gouraud', frames: 3,
    draw(d, f) {
      const r = lcg(10 + f);
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff203040, 1, 0);
      d.setTransform(256, ident()); d.setTransform(2, ident()); d.setTransform(3, ident());
      d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.CULLMODE, 1); d.setRenderState(Rs.ZENABLE, 0);
      d.setRenderState(Rs.SHADEMODE, f === 2 ? 1 : 2);
      d.setVertexShader(Fvf.XYZ | Fvf.DIFFUSE);
      const rows: number[][] = [];
      for (let i = 0; i < 10 * 3; i++) rows.push([r() * 2.4 - 1.2, r() * 2.4 - 1.2, r(), (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.TRIANGLELIST, 10, verts('fffc', rows), 16);
      d.endScene(); d.present();
    },
  },
  {
    name: 'textured', frames: 3,
    setup: (d) => [checkerTexture(d, 64, true), checkerTexture(d, 32, false)],
    draw(d, f, ctx) {
      const [t0, t1] = ctx as ReturnType<Device['createTexture']>[];
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff102030, 1, 0);
      d.setTransform(2, ident()); d.setTransform(3, persp(0.9, W / H, 0.5, 50));
      d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.CULLMODE, 1); d.setRenderState(Rs.ZENABLE, 1);
      d.setVertexShader(Fvf.XYZ | Fvf.DIFFUSE | 0x100);
      d.setTexture(0, t0);
      d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MINFILTER, 2); d.setTextureStageState(0, Tss.MIPFILTER, f === 1 ? 1 : 2);
      d.setTextureStageState(0, Tss.ALPHAOP, 4);
      // a floor receding into the distance (LOD and mip selection) and a wall crossing it (Z)
      d.setTransform(256, world(0.2 * f, 0.3 + 0.1 * f, 0, -1, 0));
      const floor = verts('fffcff', [[-8, 0, 1, 0xffffffff, 0, 0], [8, 0, 1, 0xffff8080, 6, 0], [-8, 0, 30, 0xff80ff80, 0, 12], [8, 0, 30, 0xff8080ff, 6, 12]]);
      d.drawPrimitiveUP(Prim.TRIANGLESTRIP, 2, floor, 24);
      d.setTexture(0, t1);
      d.setTextureStageState(0, Tss.COLOROP, f === 2 ? 7 : 4); d.setTextureStageState(0, Tss.ADDRESSU, 3);
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      d.setRenderState(Rs.ALPHATESTENABLE, 1); d.setRenderState(Rs.ALPHAREF, 8); d.setRenderState(Rs.ALPHAFUNC, 7);
      d.setTransform(256, world(0, 0.5 - 0.2 * f, 0.5, 0, 4));
      const wall = verts('fffcff', [[-2, -1, 0, 0x80ffffff, -0.5, 1.5], [2, -1, 0, 0xc0ff0000, 1.5, 1.5], [-2, 2, 0, 0x4000ff00, -0.5, -0.5], [2, 2, 0, 0xff0000ff, 1.5, -0.5]]);
      d.drawPrimitiveUP(Prim.TRIANGLESTRIP, 2, wall, 24);
      d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.ALPHATESTENABLE, 0);
      d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.ADDRESSU, 1); d.setTexture(0, null);
      d.endScene(); d.present();
    },
  },
  {
    name: 'lit', frames: 3,
    setup: (d) => checkerTexture(d, 32, false),
    draw(d, f, ctx) {
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff000000, 1, 0);
      d.setTransform(2, ident()); d.setTransform(3, persp(0.8, W / H, 1, 20));
      d.setTransform(256, world(0.4 + f * 0.3, f * 0.5, 0, 0, 5));
      d.setRenderState(Rs.LIGHTING, 1); d.setRenderState(Rs.SPECULARENABLE, f === 1 ? 0 : 1); d.setRenderState(Rs.NORMALIZENORMALS, 1);
      d.setRenderState(Rs.AMBIENT, 0x202020); d.setRenderState(Rs.ZENABLE, 1); d.setRenderState(Rs.CULLMODE, 3);
      d.setMaterial(material([0.8, 0.7, 0.6, 1], [0.3, 0.3, 0.3, 1], [1, 1, 1, 1], [0, 0, 0.1, 0], 12));
      d.setLight(0, dirLight([1, 0.9, 0.8, 1], [1, 1, 1, 1], [0.1, 0.1, 0.1, 1], [0.3, -0.5, 1]));
      d.lightEnable(0, true);
      d.setLight(1, dirLight([0.2, 0.3, 0.9, 1], [0.5, 0.5, 0.5, 1], [0, 0, 0, 1], [-1, 0.2, 0.3]));
      d.lightEnable(1, f === 2);
      d.setTexture(0, ctx as ReturnType<Device['createTexture']>);
      d.setTextureStageState(0, Tss.TEXTURETRANSFORMFLAGS, 2);
      d.setTransform(16, new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0.25 * f, 0.5, 1, 0, 0, 0, 0, 1]));
      d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MINFILTER, 2);
      // a sphere as triangle strips (XYZ | NORMAL | DIFFUSE | TEX1), indexed
      const rows: number[][] = [], R = 1.5, NS = 16, NR = 10;
      for (let i = 0; i <= NR; i++) for (let j = 0; j <= NS; j++) {
        const th = Math.PI * i / NR, ph = 2 * Math.PI * j / NS;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        rows.push([R * nx, R * ny, R * nz, nx, ny, nz, 0xff000000 | ((i * 25) << 16) | ((j * 15) << 8) | 0x80, j / NS, i / NR]);
      }
      const vb = d.createVertexBuffer(rows.length * 36, Usage.WRITEONLY, 0x152, Pool.MANAGED);
      vb.lock(0, 0, 0).set(verts('ffffffcff', rows)); vb.unlock();
      const idx: number[] = [];
      for (let i = 0; i < NR; i++) { for (let j = 0; j <= NS; j++) idx.push(i * (NS + 1) + j, (i + 1) * (NS + 1) + j); idx.push((i + 1) * (NS + 1) + NS, (i + 1) * (NS + 1)); }
      const ib = d.createIndexBuffer(idx.length * 2, Usage.WRITEONLY, Fmt.INDEX16, Pool.MANAGED);
      const ibd = ib.lock(0, 0, 0); new Uint16Array(ibd.buffer, ibd.byteOffset, idx.length).set(idx); ib.unlock();
      d.setVertexShader(0x152); d.setStreamSource(0, vb, 36); d.setIndices(ib, 0);
      d.setRenderState(Rs.COLORVERTEX, f === 0 ? 0 : 1); d.setRenderState(Rs.AMBIENTMATERIALSOURCE, 1);
      d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, rows.length, 0, idx.length - 2);
      d.setTextureStageState(0, Tss.TEXTURETRANSFORMFLAGS, 0); d.setTexture(0, null);
      d.endScene(); d.present();
    },
  },
  {
    name: 'clip', frames: 3,
    draw(d, f) {
      const r = lcg(77 + f);
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff304050, 1, 0);
      d.setTransform(2, ident()); d.setTransform(3, persp(1.2, W / H, 1, 10)); d.setTransform(256, world(0, f * 0.2, 0, 0, 0));
      d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.CULLMODE, 1); d.setRenderState(Rs.ZENABLE, 1);
      d.setVertexShader(Fvf.XYZ | Fvf.DIFFUSE);
      // big triangles crossing the near and far planes and reaching far past the guard band
      const rows: number[][] = [];
      for (let i = 0; i < 8 * 3; i++) rows.push([(r() - 0.5) * 12, (r() - 0.5) * 9, r() * 14 - 2, (r() * 0x100000000) >>> 0]);
      for (let i = 0; i < 3; i++) rows.push([(r() - 0.5) * 4000, (r() - 0.5) * 3000, 3 + r() * 4, (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.TRIANGLELIST, 9, verts('fffc', rows), 16);
      d.endScene(); d.present();
    },
  },
  {
    name: 'sprites', frames: 2,
    setup: (d) => checkerTexture(d, 16, true),
    draw(d, f, ctx) {
      const r = lcg(5 + f);
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff000010, 1, 0);
      d.setTransform(2, ident()); d.setTransform(3, persp(1, W / H, 0.5, 30)); d.setTransform(256, ident());
      d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.ZENABLE, 0);
      d.setRenderState(Rs.POINTSPRITEENABLE, 1); d.setRenderState(Rs.POINTSCALEENABLE, f);
      d.setRenderState(Rs.POINTSIZE, f32bits(f ? 0.6 : 7.5)); d.setRenderState(Rs.POINTSIZE_MIN, f32bits(0.05));
      d.setRenderState(Rs.POINT_SCALE_A, f32bits(0)); d.setRenderState(Rs.POINT_SCALE_B, f32bits(0)); d.setRenderState(Rs.POINT_SCALE_C, f32bits(0.07));
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 2);
      d.setTexture(0, ctx as ReturnType<Device['createTexture']>);
      d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MINFILTER, 2); d.setTextureStageState(0, Tss.ALPHAOP, 4);
      d.setVertexShader(Fvf.XYZ | Fvf.DIFFUSE);
      const rows: number[][] = [];
      for (let i = 0; i < 60; i++) rows.push([(r() - 0.5) * 8, (r() - 0.5) * 6, 1 + r() * 10, (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.POINTLIST, 60, verts('fffc', rows), 16);
      d.setRenderState(Rs.POINTSPRITEENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setTexture(0, null);
      d.endScene(); d.present();
    },
  },
  {
    name: 'rendertarget', frames: 2,
    setup: (d) => d.createTexture(64, 64, 1, Usage.RENDERTARGET, Fmt.X8R8G8B8, Pool.DEFAULT),
    draw(d, f, ctx) {
      const rt = ctx as ReturnType<Device['createTexture']>, bb = d.getBackBuffer(), z = d.getDepthStencilSurface();
      d.setRenderTarget(rt.getSurfaceLevel(0), null);
      d.beginScene();
      d.clear(null, ClearFlag.TARGET, 0xff400000 + f * 0x2000, 1, 0);
      d.setTransform(256, ident()); d.setTransform(2, ident()); d.setTransform(3, ident());
      d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.CULLMODE, 1); d.setRenderState(Rs.ZENABLE, 0);
      d.setVertexShader(Fvf.XYZ | Fvf.DIFFUSE);
      d.drawPrimitiveUP(Prim.TRIANGLELIST, 1, verts('fffc', [[-0.9, -0.8, 0.5, 0xffff0000], [0.1 * f, 0.9, 0.5, 0xff00ff00], [0.9, -0.3, 0.5, 0xff0000ff]]), 16);
      d.endScene();
      d.setRenderTarget(bb, z);
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff000000, 1, 0);
      d.setTexture(0, rt);
      d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MINFILTER, 2);
      d.setTextureStageState(0, Tss.COLOROP, 2); d.setTextureStageState(0, Tss.ALPHAOP, 2);
      d.setVertexShader(Fvf.XYZ | 0x100);
      d.drawPrimitiveUP(Prim.TRIANGLESTRIP, 2, verts('fffff', [[-0.8, 0.8, 0.5, 0, 0], [0.8, 0.8, 0.5, 1, 0], [-0.8, -0.8, 0.5, 0, 1], [0.8, -0.8, 0.5, 1, 1]]), 20);
      d.setTexture(0, null); d.setTextureStageState(0, Tss.COLOROP, 4);
      d.endScene(); d.present();
    },
  },
  {
    name: 'vshader', frames: 2,
    setup(d) {
      // vs.1.1: oPos = v0 * c0..c3 (dp4), r0 = c5, oD0 = mad(v1, c4, r0), oT0 = v2
      const decl = new Uint32Array([0x20000000, 0x40020000, 0x40020001, 0x40010002, 0xffffffff]);
      const fn = new Uint32Array([0xfffe0101,
        0x00000009, 0xc0010000, 0x90e40000, 0xa0e40000, 0x00000009, 0xc0020000, 0x90e40000, 0xa0e40001,
        0x00000009, 0xc0040000, 0x90e40000, 0xa0e40002, 0x00000009, 0xc0080000, 0x90e40000, 0xa0e40003,
        0x00000001, 0x800f0000, 0xa0e40005, 0x00000004, 0xd00f0000, 0x90e40001, 0xa0e40004, 0x80e40000,
        0x00000001, 0xe0030000, 0x90e40002, 0x0000ffff]);
      return d.createVertexShader(decl, fn, 0);
    },
    draw(d, f, ctx) {
      d.beginScene();
      d.clear(null, ClearFlag.TARGET | ClearFlag.ZBUFFER, 0xff101010, 1, 0);
      const m = mul(world(0.3, 0.4 * f, 0, 0, 4), persp(0.9, W / H, 1, 10));
      const t = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) t[i * 4 + j] = m[j * 4 + i];
      d.setVertexShaderConstant(0, t, 4);
      d.setVertexShaderConstant(4, new Float32Array([0.9, 0.7, 0.5, 1, 0.05, 0.1, 0.2, 0]), 2);
      d.setRenderState(Rs.CULLMODE, 1); d.setRenderState(Rs.ZENABLE, 1);
      d.setVertexShader(ctx as number);
      const rows: number[][] = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) rows.push([i - 2, j - 2, Math.sin(i + j + f) * 0.5, i / 4, j / 4, (i + j) / 8, i / 4, j / 4]);
      const vb = d.createVertexBuffer(rows.length * 32, 0, 0, Pool.MANAGED);
      vb.lock(0, 0, 0).set(verts('ffffffff', rows)); vb.unlock();
      const idx: number[] = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j; idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6); }
      const ib = d.createIndexBuffer(idx.length * 2, 0, Fmt.INDEX16, Pool.MANAGED);
      const ibd = ib.lock(0, 0, 0); new Uint16Array(ibd.buffer, ibd.byteOffset, idx.length).set(idx); ib.unlock();
      d.setStreamSource(0, vb, 32); d.setIndices(ib, 0);
      d.drawIndexedPrimitive(Prim.TRIANGLELIST, 0, rows.length, 0, idx.length / 3);
      d.endScene(); d.present();
    },
  },
];

/** FNV-1a over B, G, R of the back buffer */
export function hashBackBuffer(d: Device): string {
  const bb = d.getBackBuffer(), l = bb.lockRect(null, 0x10);
  let h = 0x811c9dc5;
  for (let y = 0; y < bb.height; y++) for (let x = 0; x < bb.width; x++) {
    const o = y * l.pitch + x * 4;
    h = Math.imul(h ^ l.data[o], 16777619); h = Math.imul(h ^ l.data[o + 1], 16777619); h = Math.imul(h ^ l.data[o + 2], 16777619);
  }
  bb.unlockRect();
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** the port's own output, frame by frame */
const GOLDEN: Record<string, string[]> = {
  gouraud: ['f1d7631e', 'c158751a', '09cf7ec8'],
  textured: ['0bd57b69', '6207db6b', '9ceb3e8f'],
  lit: ['1acdef86', 'ffb300b1', '4182c5ae'],
  clip: ['c02891c5', 'a731d2eb', '1947559d'],
  sprites: ['c95e42df', '6fa7dc41'],
  rendertarget: ['7fe5f169', '833c14a7'],
  vshader: ['e3ef05bd', 'a8a26115'],
};

/** a scene's frame hashes; path: 'js' (rast.ts), 'wasm' (the kernel, which must take every draw), or 'alternate'
 *  (resources in the kernel's memory, frames drawn by the kernel and by rast.ts in turn) */
function run(sc: Scene, path: 'js' | 'wasm' | 'alternate'): string[] {
  refKernel.mode = path === 'js' ? 'js' : 'wasm';
  try {
    const d = new RefDevice(W, H);
    const ctx = sc.setup?.(d);
    const got: string[] = [];
    for (let f = 0; f < sc.frames; f++) {
      if (path === 'alternate') refKernel.mode = f & 1 ? 'js' : 'wasm';
      sc.draw(d, f, ctx); got.push(hashBackBuffer(d));
    }
    return got;
  } finally { refKernel.mode = 'auto'; }
}

describe('RefDevice', () => {
  for (const sc of SCENES) {
    it(`draws the ${sc.name} scene as recorded, in JS, in WebAssembly and alternating`, () => {
      const js = run(sc, 'js');
      if (process.env.D3D_REF_PRINT) console.log(JSON.stringify(sc.name), JSON.stringify(js));
      expect(js).toEqual(GOLDEN[sc.name]);
      expect(run(sc, 'wasm')).toEqual(GOLDEN[sc.name]);
      expect(run(sc, 'alternate')).toEqual(GOLDEN[sc.name]);
    });
  }
  it('records Set* calls into a state block without applying them, and applies them later', () => {
    const d = new RefDevice(8, 8);
    d.beginStateBlock(); d.setRenderState(Rs.CULLMODE, 1); const b = d.endStateBlock();
    expect(d.st.rs[Rs.CULLMODE]).toBe(3);
    d.applyStateBlock(b);
    expect(d.st.rs[Rs.CULLMODE]).toBe(1);
    d.setRenderState(Rs.CULLMODE, 2); d.captureStateBlock(b); d.setRenderState(Rs.CULLMODE, 3); d.applyStateBlock(b);
    expect(d.st.rs[Rs.CULLMODE]).toBe(2);
  });
});
