// Goom's two scope lines (0x10012500..0x10012a50): 512 points each on a circle, a horizontal or a vertical
// line, displaced by one channel's samples along each point's normal, drawn as connected segments with a
// saturating add, easing toward a target shape and colour every frame.
import { f32, ftol, log10_87 } from './fpu';
import { sincos87 as sincos87Pair, mulExt as mulExt64 } from '../plenoptic/x87';
import type { GoomRandom } from './random';
import { drawLine } from './draw';

export const GML_CIRCLE = 0, GML_HLINE = 1, GML_VLINE = 2;

/** 0x10012600 getcolor: 0 GML_BLEUBLANC .. 6 GML_BLACK */
export function lineColor(c: number): number {
  switch (c) {
    case 0: return 0xdc8c28;
    case 1: return 0xe6780a;
    case 2: return 0xeca028;
    case 3: return 0xfc780a;
    case 4: return 0x50c80a;
    case 5: return 0x501efa;
    case 6: return 5;
    default: return 0;
  }
}

const SC = new Float64Array(4);
/** 0x10012500 genline: points as {x, y, angle} float triples */
function genline(id: number, param: number, p: Float32Array, rx: number, ry: number): void {
  if (id === GML_CIRCLE) {
    const cx = rx * 0.5, cy = ry * 0.5;
    for (let i = 0; i < 512; i++) {
      const a = i * 0.012271846303085117;
      sincos87Pair(a, SC);
      p[i * 3 + 2] = a;
      p[i * 3] = f32(mulExt64(param, SC[2], SC[3]) + cx);
      p[i * 3 + 1] = f32(mulExt64(param, SC[0], SC[1]) + cy);
    }
  } else if (id === GML_HLINE) {
    for (let i = 0; i < 512; i++) {
      p[i * 3] = i * rx * 0.001953125;
      p[i * 3 + 1] = param;
      p[i * 3 + 2] = 1.5707963705062866;
    }
  } else if (id === GML_VLINE) {
    for (let i = 0; i < 512; i++) {
      p[i * 3] = param;
      p[i * 3 + 1] = i * ry * 0.001953125;
      p[i * 3 + 2] = 0;
    }
  }
}

/** 0x10013fd0 lighten one byte: v * log10(power) / 2, clamped to 0..255 */
export function lightenByte(v: number, power: number): number {
  const t = log10_87(power) * v * 0.5;
  if (t <= 0) return 0;
  const i = ftol(t);
  return i > 255 ? 255 : i < 0 ? 0 : i;
}
export function lighten(c: number, power: number): number {
  return (lightenByte(c & 255, power) | lightenByte((c >>> 8) & 255, power) << 8
    | lightenByte((c >>> 16) & 255, power) << 16 | lightenByte(c >>> 24, power) << 24) >>> 0;
}

export class GMLine {
  points = new Float32Array(512 * 3);   // +0x00
  points2 = new Float32Array(512 * 3);  // +0x04
  IDdest = 0;                           // +0x08
  param = 0;                            // +0x0c float
  amplitudeF = 1.0;                     // +0x10
  amplitude = 1.0;                      // +0x14
  color = 0;                            // +0x1c
  color2 = 0;                           // +0x20
  screenX: number; screenY: number;     // +0x24 +0x28
  power = 0;                            // +0x2c
  powinc = f32(0.01);                   // +0x30
  // draw()'s cos(angle) * 0.001 and sin(angle) * 0.001 per point, kept while the angle is unchanged
  private cacheA = new Float32Array(512).fill(NaN);
  private cacheC = new Float64Array(512);
  private cacheS = new Float64Array(512);

  /** 0x10012820 goom_lines_init */
  constructor(private rnd: GoomRandom, rx: number, ry: number, IDsrc: number, paramS: number, coulS: number,
    IDdest: number, paramD: number, coulD: number) {
    this.param = paramD;
    this.IDdest = IDdest;
    genline(IDsrc, paramS, this.points, rx, ry);
    genline(IDdest, paramD, this.points2, rx, ry);
    this.color = lineColor(coulS);
    this.color2 = lineColor(coulD);
    this.screenX = rx; this.screenY = ry;
    this.switchTo(IDdest, paramD, 1.0, coulD);
  }

  /** 0x10012660 goom_lines_set_res */
  setRes(rx: number, ry: number): void {
    this.screenX = rx; this.screenY = ry;
    genline(this.IDdest, this.param, this.points2, rx, ry);
  }

  /** 0x100127d0 goom_lines_switch_to */
  switchTo(IDdest: number, param: number, amplitude: number, col: number): void {
    genline(IDdest, param, this.points2, this.screenX, this.screenY);
    this.IDdest = IDdest;
    this.param = param;
    this.amplitudeF = amplitude;
    this.color2 = lineColor(col);
  }

  /** 0x10012690 goom_lines_move */
  private move(): void {
    const p = this.points, q = this.points2;
    for (let i = 0; i < 512 * 3; i++) p[i] = (p[i] * 39.0 + q[i]) * 0.02500000037252903;
    let c = this.color, c2 = this.color2, r = 0;
    for (let k = 0; k < 32; k += 8) {
      const a = (c >>> k) & 255, b = (c2 >>> k) & 255;
      r |= (((a << 6) - a + b) >> 6) << k;
    }
    this.color = r >>> 0;
    const pw = this.power + this.powinc;
    this.power = f32(pw);
    if (pw < 1.100000023841858) {
      this.power = 1.100000023841858;
      this.powinc = f32((this.rnd.irand(20) + 10) * 0.0033333334140479565);
    }
    if (this.power > 17.5) {
      this.power = 17.5;
      this.powinc = f32((this.rnd.irand(20) + 10) * -0.0033333334140479565);
    }
    this.amplitude = f32((this.amplitude * 99.0 + this.amplitudeF) * 0.009999999776482582);
  }

  /** 0x10012910 goom_lines_draw: data is 512 samples of one channel */
  draw(data: Int16Array, off: number, p: Uint32Array, drawLineFn: typeof drawLine = drawLine): void {
    const pts = this.points;
    const color = lighten(this.color, this.power);
    sincos87Pair(pts[2], SC);
    const cosa = f32(mulExt64(0.001, SC[2], SC[3])), sina = f32(mulExt64(0.001, SC[0], SC[1]));
    const d0 = data[off] * this.amplitude;
    let x1 = ftol(cosa * d0 + pts[0]);
    let y1 = ftol(d0 * sina + pts[1]);
    const CA = this.cacheA, CC = this.cacheC, CS = this.cacheS;
    for (let i = 1; i < 512; i++) {
      const d = data[off + i];
      const a = pts[i * 3 + 2];
      if (CA[i] !== a) {
        sincos87Pair(a, SC);
        CA[i] = a; CC[i] = mulExt64(0.001, SC[2], SC[3]); CS[i] = mulExt64(0.001, SC[0], SC[1]);
      }
      const x2 = ftol(CC[i] * this.amplitude * d + pts[i * 3]);
      const y2 = ftol(CS[i] * this.amplitude * d + pts[i * 3 + 1]);
      drawLineFn(p, x1, y1, x2, y2, color, this.screenX, this.screenY);
      x1 = x2; y1 = y2;
    }
    this.move();
  }
}
