// RefDevice (src/d3d8/ref.ts) on pre-transformed (XYZRHW) vertices, lines and points: synthetic scenes of our own,
// each frame's back buffer hashed (FNV-1a over B, G, R) and compared with golden values of the port's own output,
// taken once the private harness had found them identical to the reference rasterizer on the same calls
// (D3D_XYZRHW_TRACE=<dir> writes each scene's calls to <dir>/<scene>.d3t for that). The scenes cover what TwistedPixel's passes use: Gouraud and textured XYZRHW triangles with arbitrary
// rhw (the border pass leaves all but one rhw stale), MODULATE2X/4X, alpha test on A4R4G4B4, alpha blending with
// dithering, guard-band clipping, lines (list and strip, LASTPIXEL, LINEPATTERN, flat) and points.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClearFlag, type Device, Fmt, Fvf, Pool, Prim, Rs, Tss } from '../src/d3d8/api';
import { RefDevice, refKernel } from '../src/d3d8/ref';
import { TraceDevice } from '../src/d3d8/trace';

const W = 160, H = 120;

function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
/** vertex bytes: 'f' float, 'c' D3DCOLOR, 'u' raw 32-bit word (a float given by its bits) */
function verts(layout: string, rows: number[][]): Uint8Array {
  const out = new Uint8Array(rows.length * layout.length * 4), dv = new DataView(out.buffer);
  let o = 0;
  for (const r of rows) for (let i = 0; i < layout.length; i++, o += 4) { if (layout[i] === 'f') dv.setFloat32(o, r[i]!, true); else dv.setUint32(o, r[i]! >>> 0, true); }
  return out;
}
const f32bits = (x: number): number => new Uint32Array(new Float32Array([x]).buffer)[0]!;
const u16 = (a: number[]): Uint8Array => new Uint8Array(new Uint16Array(a).buffer);
/** TwistedPixel's fixed state: no Z, no culling, dithering on */
function base(d: Device, clear: number): void {
  d.beginScene();
  d.clear(null, ClearFlag.TARGET, clear, 1, 0);
  d.setRenderState(Rs.ZENABLE, 0); d.setRenderState(Rs.ZWRITEENABLE, 0); d.setRenderState(Rs.CULLMODE, 1);
  d.setRenderState(Rs.LIGHTING, 0); d.setRenderState(Rs.DITHERENABLE, 1);
}
/** a gouraud XYZRHW background quad, so that blending has something under it */
function backdrop(d: Device): void {
  d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  d.setTexture(0, null);
  d.setTextureStageState(0, Tss.COLOROP, 2); d.setTextureStageState(0, Tss.COLORARG1, 0);
  d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 0);
  d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE);
  d.drawPrimitiveUP(Prim.TRIANGLEFAN, 2, verts('ffffc', [
    [0, 0, 0.5, 1, 0xff204060], [W, 0, 0.5, 1, 0xffa04020], [W, H, 0.5, 1, 0xff20a040], [0, H, 0.5, 1, 0xff6020a0]]), 20);
}
/** a procedural texture; A4R4G4B4 or A8R8G8B8 */
function texture(d: Device, size: number, fmt: Fmt): ReturnType<Device['createTexture']> {
  const t = d.createTexture(size, size, 1, 0, fmt, Pool.MANAGED);
  const lk = t.lockRect(0, null, 0), dv = new DataView(lk.data.buffer, lk.data.byteOffset);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = ((x * 8 / size) ^ (y * 8 / size)) & 1, a = ((x + y) * 255 / (2 * size - 2)) | 0;
    const r = c ? 230 : 30, g = (x * 255 / size) | 0, b = (y * 255 / size) | 0;
    if (fmt === Fmt.A4R4G4B4) dv.setUint16(y * lk.pitch + x * 2, ((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), true);
    else dv.setUint32(y * lk.pitch + x * 4, ((a << 24) | (r << 16) | (g << 8) | b) >>> 0, true);
  }
  t.unlockRect(0);
  return t;
}

/** the 16 border vertices as TwistedPixel lays them out (four bars, two triangles each); only vertex 0's rhw is
 *  written, the other fifteen words are what the buffer held */
function border(stale: number[], col: (i: number) => number): number[][] {
  const R = W - 0.5, B = H - 0.5, bw = 1.9;
  const xy = [[0, 0], [R, 0], [R, 1], [0, 1], [0, B - 1], [R, B - 1], [R, B], [0, B],
    [0, 1], [bw, 1], [bw, B - 1], [0, B - 1], [R - bw, 1], [R, 1], [R, B - 1], [R - bw, B - 1]];
  return xy.map(([x, y], i) => [x!, y!, 0x3f800000, i === 0 ? 0x3f800000 : stale[i - 1]!, col(i)]);
}
const BORDER_IDX = u16([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15]);
const STALE: number[][] = [
  new Array(15).fill(0),                                              // a fresh (zeroed) buffer
  new Array(15).fill(0x3f800000),                                     // every rhw 1
  [0, 0x11100000, 0, 0x0c0076db, 0, 0, 0x080aa584, 0, 0, 0x080aa5a4, 1, 0, 0x080aa5c4, 0x03545af8, 0x11100000],
  [0xab65536f, 1, 0x02fc9a08, 0x2e303438, 0xd, 0x325a8b04, 0x342e392e, 0xfcb298ee, 0xeb325a8b, 0x2e303438, 0x04003734,
    0x8130e481, 0xf09b7711, 0x81309881, 0x13315355],                   // heap words seen in recordings: tiny, huge, negative
  [0, 0, 0x06ca10d0, 0, 0, 0x06c20600, 0, 0, 0x42000042, 0, 0, 0, 0, 0, 0],
  [0x80000000, 0xbf800000, 0x00000001, 0x007fffff, 0x7f7fffff, 0xff7fffff, 0x3f000000, 0x40000000, 0x00800000,
    0x0b000000, 0xc0000000, 0x3e800000, 0x80000001, 0x41200000, 0x3c000000],
];

type Scene = { name: string; frames: number; setup?: (d: Device) => unknown; draw: (d: Device, f: number, ctx: unknown) => void };

const SCENES: Scene[] = [
  {
    // random XYZRHW triangles, some across the viewport edges (inside the guard band), rhw from 0.2 to 2
    name: 'tl-gouraud', frames: 3,
    draw(d, f) {
      const r = lcg(40 + f);
      base(d, 0xff102030);
      d.setRenderState(Rs.SHADEMODE, f === 2 ? 1 : 2);
      d.setTexture(0, null);
      d.setTextureStageState(0, Tss.COLOROP, 2); d.setTextureStageState(0, Tss.COLORARG1, 0);
      d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 0);
      d.setRenderState(Rs.ALPHABLENDENABLE, f === 1 ? 1 : 0); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE);
      const rows: number[][] = [];
      for (let i = 0; i < 12 * 3; i++) rows.push([r() * (W + 80) - 40, r() * (H + 60) - 30, r(), 0.2 + r() * 1.8, (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.TRIANGLELIST, 12, verts('ffffc', rows), 20);
      d.endScene(); d.present();
    },
  },
  {
    // the border pass: stale rhw words, uniform colour, blended (frame 6: per-vertex colours and varied rhw)
    name: 'tl-rhw', frames: 7,
    draw(d, f) {
      base(d, 0xff000000);
      backdrop(d);
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE);
      const r = lcg(77);
      const rows = f < 6 ? border(STALE[f]!, () => 0xc0ff8020)
        : border(Array.from({ length: 15 }, () => f32bits(0.25 + r() * 3)),
          () => (r() * 0x100000000) >>> 0);
      d.drawIndexedPrimitiveUP(Prim.TRIANGLELIST, 0, 16, 8, BORDER_IDX, Fmt.INDEX16, verts('ffuuc', rows), 20);
      d.endScene(); d.present();
    },
  },
  {
    // textured XYZRHW quads with perspective rhw: MODULATE, MODULATE2X, MODULATE4X, ADD with blending; wrap/clamp;
    // frame 4: no diffuse (FVF 0x104), as the final blit
    name: 'tl-textured', frames: 5,
    setup: (d) => texture(d, 32, Fmt.A8R8G8B8),
    draw(d, f, tex) {
      base(d, 0xff302010);
      backdrop(d);
      d.setTexture(0, tex as ReturnType<Device['createTexture']>);
      d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MINFILTER, 2); d.setTextureStageState(0, Tss.MIPFILTER, 0);
      d.setTextureStageState(0, Tss.ADDRESSU, f & 1 ? 3 : 1); d.setTextureStageState(0, Tss.ADDRESSV, f & 1 ? 3 : 1);
      d.setTextureStageState(0, Tss.COLOROP, [4, 5, 6, 7, 4][f]!); d.setTextureStageState(0, Tss.COLORARG1, 2); d.setTextureStageState(0, Tss.COLORARG2, 0);
      d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 2);
      d.setRenderState(Rs.ALPHABLENDENABLE, f >= 3 ? 1 : 0); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, f === 3 ? 2 : 6);
      const q = (w0: number, w1: number): number[][] => [
        [6, 8, 0.5, w0, 0xff8080ff, -0.5 * w0, -0.25 * w0], [W - 10, 4, 0.5, w1, 0xffff8080, 2.5 * w1, -0.25 * w1],
        [W - 4, H - 6, 0.5, w1, 0x80ffff80, 2.5 * w1, 1.75 * w1], [10, H - 12, 0.5, w0, 0xff8080ff, -0.5 * w0, 1.75 * w0]];
      if (f === 4) {
        d.setVertexShader(Fvf.XYZRHW | 0x100);
        d.drawPrimitiveUP(Prim.TRIANGLEFAN, 2, verts('ffffff', q(1, 0.4).map((v) => [v[0]!, v[1]!, v[2]!, v[3]!, v[5]!, v[6]!])), 24);
      } else {
        d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE | 0x100);
        d.drawPrimitiveUP(Prim.TRIANGLEFAN, 2, verts('ffffcff', q(1, 0.35 + 0.2 * f)), 28);
      }
      d.endScene(); d.present();
    },
  },
  {
    // the logo pass: A4R4G4B4, point sampled, MODULATE with diffuse alpha, alpha test GREATEREQUAL 8, blended
    name: 'tl-alphatest', frames: 1,
    setup: (d) => texture(d, 32, Fmt.A4R4G4B4),
    draw(d, _f, tex) {
      base(d, 0xff406080);
      backdrop(d);
      d.setTexture(0, tex as ReturnType<Device['createTexture']>);
      d.setTextureStageState(0, Tss.MAGFILTER, 1); d.setTextureStageState(0, Tss.MINFILTER, 1);
      d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.COLORARG1, 2); d.setTextureStageState(0, Tss.COLORARG2, 0);
      d.setTextureStageState(0, Tss.ALPHAOP, 4); d.setTextureStageState(0, Tss.ALPHAARG1, 2); d.setTextureStageState(0, Tss.ALPHAARG2, 0);
      d.setRenderState(Rs.ALPHATESTENABLE, 1); d.setRenderState(Rs.ALPHAREF, 8); d.setRenderState(Rs.ALPHAFUNC, 7);
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE | 0x100);
      d.drawPrimitiveUP(Prim.TRIANGLELIST, 2, verts('ffffcff', [
        [20, 10, 0, 1, 0xffffffff, 0, 0], [140, 10, 0, 1, 0xc0ffffff, 1, 0], [140, 110, 0, 1, 0x80ffffff, 1, 1],
        [20, 10, 0, 1, 0xffffffff, 0, 0], [140, 110, 0, 1, 0x80ffffff, 1, 1], [20, 110, 0, 1, 0x40ffffff, 0, 1]]), 28);
      d.endScene(); d.present();
    },
  },
  {
    // lines: a random list (some leaving the viewport, inside the guard band), a strip, exact diagonals and axis
    // lines; LASTPIXEL off in frame 1, flat shading in frame 2, LINEPATTERN in frame 3, blended in frame 1
    name: 'lines', frames: 4,
    draw(d, f) {
      const r = lcg(90 + f);
      base(d, 0xff181818);
      d.setTexture(0, null);
      d.setTextureStageState(0, Tss.COLOROP, 2); d.setTextureStageState(0, Tss.COLORARG1, 0);
      d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 0);
      d.setRenderState(Rs.LASTPIXEL, f === 1 ? 0 : 1);
      d.setRenderState(Rs.SHADEMODE, f === 2 ? 1 : 2);
      d.setRenderState(Rs.LINEPATTERN, f === 3 ? ((0xf0f3 << 16) | 2) >>> 0 : 0);
      d.setRenderState(Rs.ALPHABLENDENABLE, f === 1 ? 1 : 0); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE);
      const rows: number[][] = [];
      for (let i = 0; i < 40; i++) rows.push([r() * (W + 40) - 20, r() * (H + 40) - 20, r(), 0.5 + r(), (r() * 0x100000000) >>> 0]);
      for (let i = 0; i < 6; i++) {                                    // diagonals both ways, axis-aligned, sub-pixel ends
        const x = 10 + i * 23.37, y = 5 + i * 13.61, k = 20 + i * 3;
        rows.push([x, y, 0, 1, 0xffff0000], [x + k, y + k, 0, 1, 0xff00ff00]);
        rows.push([x + k, y, 0, 1, 0xff0000ff], [x, y + k, 0, 1, 0xffffff00]);
        rows.push([x, y + 0.5, 0, 1, 0xffffffff], [x + k + 0.25, y + 0.5, 0, 1, 0xff808080]);
        rows.push([x + 0.75, y, 0, 1, 0xffff00ff], [x + 0.75, y + k, 0, 1, 0xff00ffff]);
      }
      d.drawPrimitiveUP(Prim.LINELIST, rows.length / 2, verts('ffffc', rows), 20);
      const strip: number[][] = [];
      for (let i = 0; i < 24; i++) strip.push([80 + Math.cos(i * 0.7) * (20 + i * 2.1), 60 + Math.sin(i * 0.7) * (15 + i * 1.7), 0, 1, (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.LINESTRIP, strip.length - 1, verts('ffffc', strip), 20);
      d.endScene(); d.present();
    },
  },
  {
    // points (FVF 0x44, as the dots pass), some off screen
    name: 'points', frames: 2,
    draw(d, f) {
      const r = lcg(120 + f);
      base(d, 0xff000010);
      d.setTexture(0, null);
      d.setTextureStageState(0, Tss.COLOROP, 2); d.setTextureStageState(0, Tss.COLORARG1, 0);
      d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 0);
      d.setRenderState(Rs.ALPHABLENDENABLE, f); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, f ? 2 : 6);
      d.setVertexShader(Fvf.XYZRHW | Fvf.DIFFUSE);
      const rows: number[][] = [];
      for (let i = 0; i < 300; i++) rows.push([r() * (W + 10) - 5, r() * (H + 10) - 5, r(), 1, (r() * 0x100000000) >>> 0]);
      d.drawPrimitiveUP(Prim.POINTLIST, rows.length, verts('ffffc', rows), 20);
      d.endScene(); d.present();
    },
  },
];

/** FNV-1a over B, G, R of the back buffer */
function hashBackBuffer(d: Device): string {
  const bb = d.getBackBuffer(), l = bb.lockRect(null, 0x10);
  let h = 0x811c9dc5;
  for (let y = 0; y < bb.height; y++) for (let x = 0; x < bb.width; x++) {
    const o = y * l.pitch + x * 4;
    h = Math.imul(h ^ l.data[o]!, 16777619); h = Math.imul(h ^ l.data[o + 1]!, 16777619); h = Math.imul(h ^ l.data[o + 2]!, 16777619);
  }
  bb.unlockRect();
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** the back buffer's hash at each Present */
const REF: Record<string, string[]> = {
  'tl-gouraud': ['35dd6513', '9cb211ab', '6fcce89f'],
  'tl-rhw': ['272fb02a', 'eaf4f4e4', 'b27314e7', 'b651d955', '81149ff3', '08611855', '44414d17'],
  'tl-textured': ['155b157d', '52d9937d', 'b3a2efc1', 'f9815568', 'd291dd8a'],
  'tl-alphatest': ['de639409'],
  'lines': ['891e416b', '8ac556cb', '15467892', 'aef2dda2'],
  'points': ['8d7b7498', '2de31ef2'],
};

function run(sc: Scene, path: 'js' | 'wasm' | 'alternate'): string[] {
  refKernel.mode = path === 'js' ? 'js' : 'wasm';
  try {
    const d = new RefDevice(W, H, null);
    const ctx = sc.setup?.(d);
    const got: string[] = [];
    for (let f = 0; f < sc.frames; f++) {
      if (path === 'alternate') refKernel.mode = f & 1 ? 'js' : 'wasm';
      sc.draw(d, f, ctx); got.push(hashBackBuffer(d));
    }
    return got;
  } finally { refKernel.mode = 'auto'; }
}

describe('RefDevice on XYZRHW vertices, lines and points', () => {
  const out = process.env.D3D_XYZRHW_TRACE;
  if (out) {
    it('writes the scenes as D3T1 traces for d3dplay', () => {
      mkdirSync(out, { recursive: true });
      for (const sc of SCENES) {
        const d = new TraceDevice(W, H, 0x52, null);
        const ctx = sc.setup?.(d);
        for (let f = 0; f < sc.frames; f++) { d.frameStart(f); sc.draw(d, f, ctx); d.frameEnd(f); }
        writeFileSync(join(out, `${sc.name}.d3t`), d.bytes());
      }
    });
  }
  for (const sc of SCENES) {
    it(`draws the ${sc.name} scene to its golden in JS, in WebAssembly and alternating`, () => {
      const js = run(sc, 'js');
      if (process.env.D3D_REF_PRINT) console.log(JSON.stringify(sc.name), JSON.stringify(js));
      expect(js).toEqual(REF[sc.name]);
      expect(run(sc, 'wasm')).toEqual(REF[sc.name]);
      expect(run(sc, 'alternate')).toEqual(REF[sc.name]);
    });
  }
});
