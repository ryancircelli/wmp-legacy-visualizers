// TwistedPixel's Direct3D canvas (the 0xd54-byte object at engine+0x27c): the device's resources, the warp mesh,
// and the passes of a frame (100193f0): the warp of the last picture into a render-target texture (100198d0), the
// overlays (custom shapes, waves: ./shapes.ts, ./waves.ts), the borders (1001a530), the composite to the back
// buffer with gamma and video echo (1001af30) and its post effects, the text (100194d0, ./font.ts), Present.
// Every float operation runs at the x87's 24-bit precision (./fpu.ts).
import { type Buffer, type Device, Fmt, Pool, Prim, Rs, type Surface, type Texture, Tss } from '../d3d8/api';
import { add24, div24, ftol, mul24, sub24 } from './fpu';
import { V } from './vars';
import { D3DFont, type FontData } from '../d3d8/d3dfont';
import { ownFont } from './font';

const f = Math.fround;

/** FVF XYZRHW | DIFFUSE | TEX1 (28 bytes) and XYZRHW | DIFFUSE (20 bytes) */
const FVF_TL = 0x144, FVF_C = 0x44;

/** what a pass reads of the current preset context (DAT_10067264) */
export interface CanvasCtx { value: Float32Array; postFx: boolean }

/** the warp mesh (10013910): DAT_1006724c (7 floats a vertex: x, y, z, rhw, diffuse, u, v), DAT_10067250 */
export class Mesh {
  w = 0; h = 0; count = 0; icount = 0;
  buf = new ArrayBuffer(0);
  fv = new Float32Array(0);
  uv = new Uint32Array(0);
  idx = new Uint16Array(0);

  /** 10013910 for a requested mesh size; returns the size kept (the DLL widens a mesh too coarse to cover the
   *  texture, and keeps the result as its mesh size) */
  build(meshW: number, meshH: number, texW: number, texH: number): void {
    let W = meshW, H = meshH;
    const sx = ((W + texW) / (W - 1)) | 0, sy = ((H + texH) / (H - 1)) | 0;
    if (W * sx < texW) { W = ((texW / sx) | 0) + 1; if (W & 1) W = ((texW / sx) | 0) + 2; }
    if (H * sy < texH) { H = ((texH / sy) | 0) + 1; if (H & 1) H = ((texH / sy) | 0) + 2; }
    this.w = W; this.h = H; this.count = W * H; this.icount = (H * 6 - 6) * (W - 1);
    this.buf = new ArrayBuffer(this.count * 28);
    this.fv = new Float32Array(this.buf); this.uv = new Uint32Array(this.buf);
    const iw = f(1 / texW), ih = f(1 / texH), fsx = f(sx), fsy = f(sy);
    for (let j = 0, o = 0; j < H; j++) {
      for (let i = 0; i < W; i++, o += 7) {
        const x = sub24(mul24(i, fsx), 0.5), y = sub24(mul24(fsy, j), 0.5);
        this.fv[o] = x; this.fv[o + 1] = y; this.fv[o + 2] = 1; this.fv[o + 3] = 1; this.uv[o + 4] = 0xffffffff;
        this.fv[o + 5] = mul24(iw, x); this.fv[o + 6] = mul24(ih, y);
      }
    }
    // two triangles a cell, (below, here, right) and (below, right, below right)
    const idx = this.idx = new Uint16Array(this.icount);
    let k = 0;
    for (let j = 0; j < H - 1; j++) {
      const r = W * j;
      for (let i = 0; i < W - 1; i++) {
        idx[k++] = W + i + r; idx[k++] = i + r; idx[k++] = i + r + 1;
        idx[k++] = W + i + r; idx[k++] = i + r + 1; idx[k++] = W + i + r + 1;
      }
    }
  }

  /** 1000f780: below full decay every vertex takes the grey ftol(decay * 255 - 0.5), clamped to 0..255 */
  fade(decay: number): void {
    let c = ftol(sub24(mul24(decay, 255), 0.5));
    c = c < 0 ? 0 : c > 255 ? 255 : c;
    const v = (c * 0x10101) >>> 0;
    for (let o = 4; o < this.uv.length; o += 7) this.uv[o] = v;
  }
}

export class Canvas {
  readonly mesh = new Mesh();
  /** canvas+0x108 (62000 bytes, XYZRHW|DIFFUSE), +0x10c (0x15e0, XYZRHW|DIFFUSE|TEX1), +0x110 (index, 400 bytes),
   *  +0x114 (0x2d00, XYZRHW|DIFFUSE): the overlays' buffers */
  vb108!: Buffer; vb10c!: Buffer; ib110!: Buffer; vb114!: Buffer;
  private meshVB!: Buffer; private meshIB!: Buffer; private quadVB!: Buffer; private borderVB!: Buffer; private borderIB!: Buffer;
  /** +0x130 the last picture (read by the warp), +0x134 the warp's target, +0x138 the post effects' source */
  rtA!: Texture; rtB!: Texture; rtC!: Texture;
  private back!: Surface;
  readonly font: D3DFont;
  /** the message in the corner (canvas+0x28) and the GetTickCount it goes at (+0x24) */
  private msg: string | null = null;
  private msgUntil = 0;

  constructor(readonly dev: Device, readonly winW: number, readonly winH: number, readonly texW: number, readonly texH: number,
    meshW: number, meshH: number, private gtc: () => number, font: FontData = ownFont()) {
    this.font = new D3DFont(dev, font);
    this.init(meshW, meshH);
  }

  /** 10018b50: render targets, mesh, buffers (1001b820), states (1001b6a0), the font, and the first blank picture */
  private init(meshW: number, meshH: number): void {
    const d = this.dev;
    this.rtA = d.createTexture(this.texW, this.texH, 1, 1, Fmt.X8R8G8B8, Pool.DEFAULT);
    this.rtB = d.createTexture(this.texW, this.texH, 1, 1, Fmt.X8R8G8B8, Pool.DEFAULT);
    this.rtC = d.createTexture(this.texW, this.texH, 1, 1, Fmt.X8R8G8B8, Pool.DEFAULT);
    this.mesh.build(meshW, meshH, this.texW, this.texH);
    this.createBuffers();
    // 1001b6a0
    d.setTextureStageState(0, Tss.MINFILTER, 2); d.setTextureStageState(0, Tss.MAGFILTER, 2); d.setTextureStageState(0, Tss.MIPFILTER, 0);
    d.setRenderState(Rs.DITHERENABLE, 1); d.setRenderState(Rs.SPECULARENABLE, 0); d.setRenderState(Rs.ZENABLE, 0);
    d.setRenderState(Rs.ZWRITEENABLE, 0);
    d.setTextureStageState(0, Tss.ADDRESSU, 1); d.setTextureStageState(0, Tss.ADDRESSV, 1);
    d.setTextureStageState(0, Tss.ALPHAOP, 2); d.setTextureStageState(0, Tss.ALPHAARG1, 2);
    d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.COLORARG1, 2); d.setTextureStageState(0, Tss.COLORARG2, 1);
    this.back = d.getRenderTarget();
    d.clear(null, 1, 0xff000000, 1, 0);
    this.font.init();
    d.beginScene();
    d.setRenderTarget(this.rtA.getSurfaceLevel(0), null);
    d.setTexture(0, null);
    d.clear(null, 1, 0xff000000, 1, 0);
    d.endScene();
    d.setRenderTarget(this.back, null);
    // 1001bfe0: the blank picture to the back buffer (no Present)
    d.setTexture(0, this.rtA);
    d.setVertexShader(FVF_TL);
    d.drawPrimitiveUP(Prim.TRIANGLEFAN, 2, this.quad(this.winW, this.winH, 0xffffffff), 28);
  }

  /** 10013910 + 1001b820 when a preset asks for another mesh size */
  rebuildMesh(meshW: number, meshH: number): void {
    this.mesh.build(meshW, meshH, this.texW, this.texH);
    this.createBuffers();
  }

  /** 1001b820 (in its order; the DLL releases the old ones first) */
  private createBuffers(): void {
    const d = this.dev, m = this.mesh;
    this.vb114 = d.createVertexBuffer(0x2d00, 0, FVF_C, Pool.DEFAULT);
    this.vb108 = d.createVertexBuffer(62000, 0, FVF_C, Pool.DEFAULT);
    this.vb10c = d.createVertexBuffer(0x15e0, 0, FVF_TL, Pool.DEFAULT);
    this.ib110 = d.createIndexBuffer(400, 8, Fmt.INDEX16, Pool.DEFAULT);
    this.meshVB = d.createVertexBuffer(m.count * 28, 0, FVF_TL, Pool.DEFAULT);
    this.meshIB = d.createIndexBuffer(m.icount * 2, 8, Fmt.INDEX16, Pool.DEFAULT);
    let b = this.meshIB.lock(0, m.icount * 2, 0);
    b.set(new Uint8Array(m.idx.buffer, 0, m.icount * 2)); this.meshIB.unlock();
    this.quadVB = d.createVertexBuffer(0x70, 0, FVF_TL, Pool.DEFAULT);
    b = this.quadVB.lock(0, 0x70, 0);
    b.set(this.quad(this.winW, this.winH, 0xffffffff)); this.quadVB.unlock();
    this.borderVB = d.createVertexBuffer(16 * 20, 0, FVF_C, Pool.DEFAULT);
    this.borderIB = d.createIndexBuffer(48, 8, Fmt.INDEX16, Pool.DEFAULT);
    b = this.borderIB.lock(0, 48, 0);
    b.set(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15]).buffer));
    this.borderIB.unlock();
  }

  /** a w x h quad as a fan of XYZRHW|DIFFUSE|TEX1 vertices, texture corners 0..1 */
  private quad(w: number, h: number, color: number): Uint8Array {
    const q = new ArrayBuffer(0x70), fv = new Float32Array(q), uv = new Uint32Array(q);
    const x1 = sub24(w, 0.5), y1 = sub24(h, 0.5);
    const xs = [-0.5, x1, x1, -0.5], ys = [-0.5, -0.5, y1, y1], us = [0, 1, 1, 0], vs = [0, 0, 1, 1];
    for (let i = 0; i < 4; i++) {
      const o = i * 7;
      fv[o] = xs[i]; fv[o + 1] = ys[i]; fv[o + 2] = 1; fv[o + 3] = 1; uv[o + 4] = color >>> 0; fv[o + 5] = us[i]; fv[o + 6] = vs[i];
    }
    return new Uint8Array(q);
  }

  /** the canvas's vtable+0x1c: a message in the corner for 4 seconds */
  message(text: string): void { this.msg = text; this.msgUntil = (this.gtc() + 4000) >>> 0; }

  /** DAT_100431ec, the bottom-left text, with DAT_10067270 (a script error is showing) and DAT_1006726c (DebugOut) */
  private info = ''; private infoErr = false; private infoDbg = false;
  /** 0x100280d0 (from OnScriptError 0x10027a20): the error replaces the text and stays until the next swap */
  scriptError(text: string): void { this.infoErr = true; this.info = text; }
  /** 0x100257a0: DebugOut replaces the text unless an error is showing */
  debugOut(text: string): void { if (this.infoErr) return; this.info = text; this.infoDbg = text.length > 0; }
  clearInfo(): void { this.info = ''; this.infoErr = false; this.infoDbg = false; }

  /** 100193f0: one frame. `overlays` draws the custom shapes (1001a0c0), the waves (10019ce0) and 1001a450. */
  render(ctx: CanvasCtx, overlays: () => void): void {
    const d = this.dev;
    d.beginScene();
    this.warp(ctx);
    d.setTexture(0, null);
    overlays();
    this.borders(ctx);
    this.composite(ctx);
    d.endScene();
    const t = this.rtB; this.rtB = this.rtA; this.rtA = t;
    this.text(ctx);
    this.infoText(ctx);
    d.present();
  }

  /** 100198d0: the last picture through the mesh into the other render target */
  private warp(ctx: CanvasCtx): void {
    const d = this.dev, m = this.mesh;
    const b = this.meshVB.lock(0, m.count * 28, 0);
    b.set(new Uint8Array(m.buf)); this.meshVB.unlock();
    d.setTexture(0, this.rtA);
    d.setRenderTarget(this.rtB.getSurfaceLevel(0), null);
    d.setStreamSource(0, this.meshVB, 28);
    d.setVertexShader(FVF_TL);
    d.setIndices(this.meshIB, 0);
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
    d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.COLORARG1, 2); d.setTextureStageState(0, Tss.COLORARG2, 1);
    const wrap = ctx.value[V.bTexWrap] === 0 ? 3 : 1;
    d.setTextureStageState(0, Tss.ADDRESSU, wrap); d.setTextureStageState(0, Tss.ADDRESSV, wrap);
    d.drawIndexedPrimitive(Prim.TRIANGLELIST, 0, m.count, 0, (m.icount / 3) | 0);
    d.setTextureStageState(0, Tss.ADDRESSU, 1); d.setTextureStageState(0, Tss.ADDRESSV, 1);
  }

  /** 1001a530: the inner border inside the outer one, each four strips, alpha blended. The DLL writes the rhw of the
   *  first vertex only; the others keep what the buffer held. */
  private borders(ctx: CanvasCtx): void {
    const d = this.dev, v = ctx.value, tw = this.texW, th = this.texH;
    d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
    const half = (n: number, s: number): number => mul24(mul24(n, s), 0.5);
    let oH = half(th, v[V.ob_size]), oW = half(tw, v[V.ob_size]), iH = half(th, v[V.ib_size]), iW = half(tw, v[V.ib_size]);
    if (!(v[V.ob_size] < 0.001) && oH < 1) oH = 1;
    if (!(v[V.ob_size] < 0.001) && oW < 1) oW = 1;
    if (!(v[V.ib_size] < 0.001) && iH < 1) iH = 1;
    if (!(v[V.ib_size] < 0.001) && iW < 1) iW = 1;
    const c8 = (x: number): number => ftol(mul24(x, 255));
    const ic = ((c8(v[V.ib_a]) << 24) | ((c8(v[V.ib_r]) & 0xff) << 16) | ((c8(v[V.ib_g]) & 0xff) << 8) | (c8(v[V.ib_b]) & 0xff)) >>> 0;
    const oc = ((c8(v[V.ob_a]) << 24) | ((c8(v[V.ob_r]) & 0xff) << 16) | ((c8(v[V.ob_g]) & 0xff) << 8) | (c8(v[V.ob_b]) & 0xff)) >>> 0;
    const W = f(tw - 0.5), H = f(th - 0.5);
    // inner border
    const a = sub24(W, oW), bb = add24(iH, oH), c = sub24(H, bb), dd = sub24(H, oH), e = add24(iW, oW), g = sub24(W, e);
    this.border([oW, oH, a, oH, a, bb, oW, bb, oW, c, a, c, a, dd, oW, dd, oW, bb, e, bb, e, c, oW, c, g, bb, a, bb, a, c, g, c], ic);
    // outer border
    const h = sub24(H, oH), k = sub24(W, oW);
    this.border([0, 0, W, 0, W, oH, 0, oH, 0, h, W, h, W, H, 0, H, 0, oH, oW, oH, oW, h, 0, h, k, oH, W, oH, W, h, k, h], oc);
  }

  private border(xy: number[], color: number): void {
    const d = this.dev, b = this.borderVB.lock(0, 16 * 20, 0);
    const fv = new Float32Array(b.buffer, b.byteOffset, 80), uv = new Uint32Array(b.buffer, b.byteOffset, 80);
    for (let i = 0; i < 16; i++) {
      fv[i * 5] = xy[i * 2]; fv[i * 5 + 1] = xy[i * 2 + 1]; fv[i * 5 + 2] = 1; uv[i * 5 + 4] = color;
    }
    fv[3] = 1;
    this.borderVB.unlock();
    d.setStreamSource(0, this.borderVB, 20);
    d.setVertexShader(FVF_C);
    d.setIndices(this.borderIB, 0);
    d.drawIndexedPrimitive(Prim.TRIANGLELIST, 0, 16, 0, 8);
  }

  /** 1001af30: the warped picture to the back buffer (or, with a post effect, to the third texture first) with gamma
   *  (MODULATE, 2X or 4X as the gamma needs, the rest in the colour) and the video echo as a second, zoomed and
   *  flipped, pass; gamma above 4 adds a second pass of the excess */
  private composite(ctx: CanvasCtx): void {
    const d = this.dev, v = ctx.value;
    const ea = v[V.fVideoEchoAlpha], echo = ea > f(0.01), gamma = v[V.fGammaAdj];
    const g1 = gamma > 4 ? 4 : gamma;
    let g2 = sub24(gamma, 4); g2 = g2 < 0 ? 0 : g2 > 4 ? 4 : g2;
    const toBB = !ctx.postFx;
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
    d.setRenderTarget(toBB ? this.back : this.rtC.getSurfaceLevel(0), null);
    d.setTexture(0, this.rtB);
    const w = toBB ? this.winW : this.texW, h = toBB ? this.winH : this.texH;
    const pass = (g: number, alpha: number): [number, number] => {
      const mult = g > 2 ? 4 : g > 1 ? 2 : 1;
      const c = ftol(div24(mul24(alpha, g), mult)) & 0xff;
      return [(c * 0x10101) >>> 0, g > 2 ? 6 : g > 1 ? 5 : 4];
    };
    let alpha = 255;
    if (echo && ea < 1) alpha = 255 - ftol(mul24(sub24(1, ea), 128));
    const [c1, op1] = pass(g1, alpha);
    d.setTextureStageState(0, Tss.COLOROP, op1);
    const q = this.quad(w, h, c1);
    let b = this.quadVB.lock(0, 0x70, 0); b.set(q); this.quadVB.unlock();
    d.setStreamSource(0, this.quadVB, 28);
    d.setVertexShader(FVF_TL);
    d.drawPrimitive(Prim.TRIANGLEFAN, 0, 2);
    if (echo || g2 > 0) {
      const g = echo ? g1 : g2;
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 2);
      let a2 = 255;
      if (echo && ea < 1) a2 = 255 - ftol(mul24(ea, 128));
      const [c2, op2] = pass(g, a2);
      d.setTextureStageState(0, Tss.COLOROP, op2);
      if (echo) this.echo(q, c2, v[V.nVideoEchoOrientation], v[V.fVideoEchoZoom]);
      b = this.quadVB.lock(0, 0x70, 0); b.set(q); this.quadVB.unlock();
      d.drawPrimitive(Prim.TRIANGLEFAN, 0, 2);
    }
    d.setTextureStageState(0, Tss.COLOROP, 4);
    if (toBB) return;
    // the post effects: the third texture to the back buffer, blended for solarize / brighten / darken, inverted
    d.setRenderTarget(this.back, null);
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
    const sol = v[V.bSolarize] !== 0, inv = v[V.bInvert] !== 0;
    if (sol) { d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 4); d.setRenderState(Rs.DESTBLEND, 1); }
    else if (v[V.bBrighten] !== 0) { d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 3); }
    else if (v[V.bDarken] !== 0) { d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 3); d.setRenderState(Rs.DESTBLEND, 1); }
    if (inv) d.setTextureStageState(0, Tss.COLORARG1, 0x12);
    this.blit(this.rtC, this.winW, this.winH);
    if (sol) { d.setRenderState(Rs.DESTBLEND, 2); this.blit(this.rtC, this.winW, this.winH); }
    if (inv) d.setTextureStageState(0, Tss.COLORARG1, 2);
    d.setTextureStageState(0, Tss.COLOROP, 4);
  }

  /** 1001c230: the echo pass's colour, its orientation (1 mirrors u, 2 flips v, 3 both) and its zoom about the
   *  centre (by the zoom or its inverse, whichever is below 1) */
  private echo(q: Uint8Array, color: number, orient: number, zoom: number): void {
    const fv = new Float32Array(q.buffer, q.byteOffset, 28), uv = new Uint32Array(q.buffer, q.byteOffset, 28);
    const z = zoom < 1 ? zoom : div24(1, zoom);
    for (let i = 0; i < 4; i++) {
      const o = i * 7;
      uv[o + 4] = color;
      let u = fv[o + 5], t = fv[o + 6];
      if (orient === 1) u = sub24(1, u);
      else if (orient === 2) t = sub24(1, t);
      else if (orient === 3) { u = sub24(1, u); t = sub24(1, t); }
      fv[o + 5] = add24(mul24(sub24(u, 0.5), z), 0.5);
      fv[o + 6] = add24(mul24(sub24(t, 0.5), z), 0.5);
    }
  }

  /** 1001c120: a texture over w x h as XYZRHW|TEX1 */
  private blit(tex: Texture, w: number, h: number): void {
    const d = this.dev, q = new ArrayBuffer(96), fv = new Float32Array(q);
    const x1 = sub24(w, 0.5), y1 = sub24(h, 0.5);
    fv.set([-0.5, -0.5, 1, 1, 0, 0, x1, -0.5, 1, 1, 1, 0, x1, y1, 1, 1, 1, 1, -0.5, y1, 1, 1, 0, 1]);
    d.setTexture(0, tex);
    d.setVertexShader(0x104);
    d.drawPrimitiveUP(Prim.TRIANGLEFAN, 2, new Uint8Array(q), 24);
  }

  /** 100194d0: the message, bottom right, white (black when the picture is inverted), until 4 s are up */
  private text(ctx: CanvasCtx): void {
    if (this.msg === null) return;
    const color = ctx.value[V.bInvert] === 0 ? 0xffffffff : 0xff000000;
    const [w, h] = this.font.extent(this.msg);
    this.font.draw(this.winW - w - 5, this.winH - h - 5, color, this.msg, 0);
    if (this.msgUntil < (this.gtc() >>> 0)) this.msg = null;
  }

  /** 100194d0's last part: the script error / DebugOut text, bottom left, while either flag is up */
  private infoText(ctx: CanvasCtx): void {
    if (!(this.infoErr || this.infoDbg) || this.info.length === 0) return;
    const color = ctx.value[V.bInvert] === 0 ? 0xffffffff : 0xff000000;
    const [, h] = this.font.extent(this.info);
    this.font.draw(5, this.winH - h - 5, color, this.info, 0);
  }
}
