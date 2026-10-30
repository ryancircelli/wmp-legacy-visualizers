// CD3DFont, the DirectX 8 SDK framework's text class (d3dfont.cpp) as the D3D families' DLLs compiled it: a glyph
// atlas texture (A4R4G4B4), a 300-vertex dynamic buffer, a saved and a drawing state block, and text drawn as two
// pre-transformed triangles a character. The glyphs themselves are GDI's rendering of a Windows font, so they are
// not here: a family supplies the atlas and each character's cell (FontData).
import { type Buffer, type Device, Fmt, Lock, Pool, Prim, type StateBlock, type Texture, Usage } from './api';

/** the drawing state, recorded twice (the saved block, then the drawing block) */
export const FONT_RS: [number, number][] = [[7, 0], [27, 1], [19, 5], [20, 6], [15, 1], [24, 8], [25, 7], [8, 3], [22, 3], [52, 0],
  [136, 1], [40, 0], [152, 0], [151, 0], [167, 0], [28, 0]];
export const FONT_TSS: [number, number, number][] = [[0, 1, 4], [0, 2, 2], [0, 3, 0], [0, 4, 4], [0, 5, 2], [0, 6, 0], [0, 17, 1],
  [0, 16, 1], [0, 18, 0], [0, 11, 0], [0, 24, 0], [1, 1, 1], [1, 4, 1]];

const MAX_VERTICES = 300;

/** a font's atlas (texW x texH A4R4G4B4 texels) and, for characters 32..126, their cells: x, y, width, height */
export interface FontData { texW: number; texH: number; atlas: Uint16Array; cells: Int32Array }

/** cells laid out the way InitDeviceObjects does: left to right, a new row when the next would not fit, one texel
 *  apart */
export function layoutCells(widths: ArrayLike<number>, height: number, texW: number): Int32Array {
  const cells = new Int32Array(95 * 4);
  let x = 0, y = 0;
  for (let i = 0; i < 95; i++) {
    const cx = widths[i];
    if (x + cx + 1 > texW) { x = 0; y += height + 1; }
    cells.set([x, y, cx, height], i * 4);
    x += cx + 1;
  }
  return cells;
}

export class D3DFont {
  private tex!: Texture;
  private vb!: Buffer;
  private saved: StateBlock = 0;
  private drawing: StateBlock = 0;

  constructor(private readonly dev: Device, private readonly data: FontData) {}

  /** InitDeviceObjects (the atlas) then RestoreDeviceObjects (the buffer, the state blocks) */
  init(): void {
    const d = this.dev, { texW, texH, atlas } = this.data;
    this.tex = d.createTexture(texW, texH, 1, 0, Fmt.A4R4G4B4, Pool.MANAGED);
    const l = this.tex.lockRect(0, null, 0);
    const src = new Uint8Array(atlas.buffer, atlas.byteOffset, texW * texH * 2);
    for (let y = 0; y < texH; y++) l.data.set(src.subarray(y * texW * 2, (y + 1) * texW * 2), y * l.pitch);
    this.tex.unlockRect(0);
    this.vb = d.createVertexBuffer(MAX_VERTICES * 28, Usage.WRITEONLY | Usage.DYNAMIC, 0, Pool.DEFAULT);
    for (let k = 0; k < 2; k++) {
      d.beginStateBlock();
      d.setTexture(0, this.tex);
      for (const [s, v] of FONT_RS) d.setRenderState(s, v);
      for (const [st, s, v] of FONT_TSS) d.setTextureStageState(st, s, v);
      if (k === 0) this.saved = d.endStateBlock(); else this.drawing = d.endStateBlock();
    }
  }

  /** GetTextExtent: the widest line and the lines' total height, truncated */
  extent(text: string): [number, number] {
    const c = this.data.cells, rowH = c[3];
    let row = 0, w = 0, h = rowH;
    for (const ch of text) {
      const k = ch.charCodeAt(0);
      if (k === 10) { row = 0; h += rowH; }
      if (k < 32) continue;
      row += c[(k - 32) * 4 + 2];
      if (row > w) w = row;
    }
    return [Math.trunc(w), Math.trunc(h)];
  }

  /** DrawText (flags 4 = filtered) */
  draw(sx: number, sy: number, color: number, text: string, flags: number): void {
    const d = this.dev, c = this.data.cells, { texW, texH } = this.data;
    d.captureStateBlock(this.saved);
    d.applyStateBlock(this.drawing);
    d.setVertexShader(0x144);
    d.setPixelShader(0);
    d.setStreamSource(0, this.vb, 28);
    if (flags & 4) { d.setTextureStageState(0, 17, 2); d.setTextureStageState(0, 16, 2); }
    const x0 = sx;
    let x = Math.fround(sx), y = Math.fround(sy), tris = 0;
    let mem = this.vb.lock(0, 0, Lock.DISCARD);
    let fv = new Float32Array(mem.buffer, mem.byteOffset, MAX_VERTICES * 7);
    let uv = new Uint32Array(mem.buffer, mem.byteOffset, MAX_VERTICES * 7);
    let o = 0;
    const vert = (vx: number, vy: number, tu: number, tv: number): void => {
      fv[o] = vx; fv[o + 1] = vy; fv[o + 2] = 0.9; fv[o + 3] = 1; uv[o + 4] = color >>> 0; fv[o + 5] = tu; fv[o + 6] = tv; o += 7;
    };
    for (const ch of text) {
      const k = ch.charCodeAt(0);
      if (k === 10) { x = x0; y = Math.fround(y + c[3]); }
      if (k < 32 || k > 126) continue;
      const i = (k - 32) * 4, cx = c[i + 2];
      const tx1 = Math.fround(c[i] / texW), ty1 = Math.fround(c[i + 1] / texH);
      const tx2 = Math.fround((c[i] + cx) / texW), ty2 = Math.fround((c[i + 1] + c[i + 3]) / texH);
      const w = cx, h = c[i + 3];
      if (k !== 32) {
        const l = x - 0.5, r = Math.fround(x + w) - 0.5, t = y - 0.5, b = Math.fround(y + h) - 0.5;
        vert(l, b, tx1, ty2); vert(l, t, tx1, ty1); vert(r, b, tx2, ty2);
        vert(r, t, tx2, ty1); vert(r, b, tx2, ty2); vert(l, t, tx1, ty1);
        tris += 2;
        if (tris * 3 > MAX_VERTICES - 6) {
          this.vb.unlock();
          d.drawPrimitive(Prim.TRIANGLELIST, 0, tris);
          mem = this.vb.lock(0, 0, Lock.DISCARD);
          fv = new Float32Array(mem.buffer, mem.byteOffset, MAX_VERTICES * 7);
          uv = new Uint32Array(mem.buffer, mem.byteOffset, MAX_VERTICES * 7);
          o = 0; tris = 0;
        }
      }
      x = Math.fround(x + w);
    }
    this.vb.unlock();
    if (tris) d.drawPrimitive(Prim.TRIANGLELIST, 0, tris);
    d.applyStateBlock(this.saved);
  }
}
