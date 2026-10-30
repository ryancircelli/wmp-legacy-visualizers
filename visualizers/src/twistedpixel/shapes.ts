// TwistedPixel's custom shapes (0x1001a0c0), drawn first in the scene: up to 1000 per frame, each built by calling
// ProcessCustomShape (0x1000e3d0) and drawn from a static vertex array with DrawPrimitiveUP (FVF XYZRHW | DIFFUSE |
// TEX1, 28 bytes). Float operations are single x87 instructions at 24-bit precision (see fpu.ts).
import { Prim, type Device, type Texture } from '../d3d8/api';
import { sincos87 } from '../plenoptic/x87';
import { add24, sub24, mul24, div24, mulx24, sqrt24 } from './fpu';
import { V } from './vars';
import { ftolq, rgbaColor } from './waves';

const f = Math.fround;
const SC = new Float64Array(4);
const MAXV = 200;   // 0x10065c50 up to the count at 0x10067230

export class Shapes {
  private readonly mem = new ArrayBuffer(MAXV * 28);
  private readonly F = new Float32Array(this.mem);
  private readonly U = new Uint32Array(this.mem);
  private readonly u8 = new Uint8Array(this.mem);
  /** 0x10067230 */
  private count = 0;
  // the shape object (0x1000e340), fields +0x10..+0x28
  private textured = 0;
  private border = 0;
  private fill = 0;
  private borderColor = 0;
  private outer = 0;
  private center = 0;

  /** `hasVb`: the canvas shape buffer (+0x10c) exists (it is only tested); `tex`: the canvas texture at +0x130;
   *  `processShape`: the script's ProcessCustomShape on the current context `cur`. */
  draw(dev: Device, cur: Float32Array, W: number, H: number, hasVb: boolean, tex: Texture, processShape: () => boolean): void {
    if (!hasVb) return;
    const hw = W >> 1, hh = H >> 1;
    const R0 = mul24(sqrt24(hw * hw + hh * hh), f(0.64));
    for (let it = 0; it < 1000; it++) {
      this.count = 0;
      const ret = this.build(cur, W, H, R0, processShape);
      if (ftolq(cur[V.shape_enabled]) === 1) {
        dev.setRenderState(27, 1);
        dev.setRenderState(19, 2);
        dev.setRenderState(20, cur[V.shape_additive] !== 0 ? 2 : 6);
        dev.setRenderState(22, 1);
        dev.setVertexShader(0x144);
        if (this.textured) {
          dev.setTexture(0, tex);
          dev.setTextureStageState(0, 1, 4);
          dev.setTextureStageState(0, 2, 0);
          dev.setTextureStageState(0, 3, 2);
          dev.setTextureStageState(1, 1, 1);
          dev.setTextureStageState(0, 4, 2);
          dev.setTextureStageState(0, 5, 0);
        }
        const n = this.count;
        // ponytail: an enabled shape with under 3 sides makes the DLL copy -28 bytes (a crash); skipped here
        if (n < 1) { if (ret === 1) break; continue; }
        // the outline: vertices 1..n-1 and vertex 1 again
        const line = new Uint8Array(n * 28);
        line.set(this.u8.subarray(28, n * 28));
        line.set(this.u8.subarray(28, 56), (n - 1) * 28);
        if (this.fill) {
          dev.drawPrimitiveUP(Prim.TRIANGLEFAN, n - 2, this.u8, 28);
          if (n > 3) {
            // the fan stops one wedge short: vertex 2 becomes the last vertex for one more triangle
            const s = (n - 1) * 7;
            this.F[14] = this.F[s]; this.F[15] = this.F[s + 1];
            this.U[18] = this.U[s + 4]; this.F[19] = this.F[s + 5]; this.F[20] = this.F[s + 6];
            dev.drawPrimitiveUP(Prim.TRIANGLELIST, 1, this.u8, 28);
          }
        }
        dev.setRenderState(22, 3);
        if (this.textured) dev.setTexture(0, null);
        if (this.border) {
          const d = new DataView(line.buffer);
          for (let i = 0; i < n; i++) d.setUint32(i * 28 + 16, this.borderColor, true);
          dev.drawPrimitiveUP(Prim.LINESTRIP, n - 1, line, 28);
        }
      }
      if (ret === 1) break;
    }
  }

  // 0x1000e3d0: clear the shape variables, run the script, build the polygon. Returns 1 when the script returned
  // False (no more shapes).
  private build(cur: Float32Array, W: number, H: number, R0: number, processShape: () => boolean): number {
    for (let k = V.shape_sides; k <= V.shape_enabled; k++) cur[k] = 0;
    const ret = processShape() ? 0 : 1;
    if (ftolq(cur[V.shape_enabled]) === 0) return ret;
    this.textured = cur[V.shape_textured] > 0 ? 1 : 0;
    this.border = 0; this.fill = 0; this.borderColor = 0; this.outer = 0; this.center = 0;
    if (cur[V.shape_border_a] !== 0) {
      this.border = 1;
      this.borderColor = rgbaColor(cur[V.shape_border_r], cur[V.shape_border_g], cur[V.shape_border_b], cur[V.shape_border_a]);
    }
    if (cur[V.shape_a] === 0 && cur[V.shape_a2] === 0) {
      if (this.textured) this.fill = 1;
    } else {
      this.fill = 1;
      this.outer = rgbaColor(cur[V.shape_r2], cur[V.shape_g2], cur[V.shape_b2], cur[V.shape_a2]);
      this.center = rgbaColor(cur[V.shape_r], cur[V.shape_g], cur[V.shape_b], cur[V.shape_a]);
    }
    const su = div24(1.25, W), sv = div24(1.25, H);
    let sides = ftolq(cur[V.shape_sides]);
    if (sides < 3) return ret;
    if (sides > MAXV - 1) sides = MAXV - 1;   // ponytail: the DLL has no limit and writes past its array
    const cy = sub24(H, mul24(H, cur[V.shape_y])), cx = mul24(W, cur[V.shape_x]), R = mul24(R0, cur[V.shape_rad]);
    const step = div24(f(6.2831855), sides);
    const off = (sides & 1) === 0 ? 1.5 : sides % 3 === 0 ? -0.75 : 0.75;
    const a0 = -add24(off, cur[V.shape_ang]);
    const F = this.F, U = this.U;
    F[0] = cx; F[1] = cy; F[2] = 1; F[3] = 1; U[4] = this.center; F[5] = 0.5; F[6] = 0.5;
    this.count = 1;
    for (let i = 0; i < sides; i++) {
      const o = (i + 1) * 7, t = mul24(i, step);
      sincos87(add24(a0, t), SC);
      F[o] = sub24(cx, ftolq(mulx24(SC[2], SC[3], R)));
      F[o + 1] = add24(ftolq(mulx24(SC[0], SC[1], R)), cy);
      F[o + 2] = 1; F[o + 3] = 1;
      if (this.textured) {
        sincos87(t, SC);
        const u = sub24(0.5, mul24(mulx24(SC[2], SC[3], R), su)), v = add24(mul24(mulx24(SC[0], SC[1], R), sv), 0.5);
        F[o + 5] = u < 0 ? 0 : u > 1 ? 1 : u;
        F[o + 6] = v < 0 ? 0 : v > 1 ? 1 : v;
      } else { F[o + 5] = 1; F[o + 6] = 1; }
      U[o + 4] = this.fill ? this.outer : 0xffffffff;
      this.count++;
    }
    return ret;
  }
}
