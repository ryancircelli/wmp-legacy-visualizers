// Goom's zoom filter (the "Zoom Filter" visual, data 0x1000b260; driver 0x1000ad50): every frame each pixel
// of the destination is a 2x2 bilinear blend (16x16 fixed-point position, coefficient table 0x1000b350) of
// the source at a position that eases from brutS to brutD by buffratio/65536. brutD is the finished
// target; brutT is recomputed from the zoom parameters 1/16 of the rows per frame (0x1000a910) and swapped
// in when complete. The blend is the DLL's MMX routine (0x1001f430; MMX is what the plug-in picks on any
// x86 since the Pentium MMX).
import { f32, ftol, sinMul } from './fpu';
import type { GoomRandom, Crt } from './random';

/** ZoomFilterData (goomInfo+0x16c4): what goom_update hands the filter when the effect changes */
export class ZoomFilterData {
  vitesse = 127;         // +0x00
  pertedec = 8;          // +0x04 byte
  sqrtperte = 16;        // +0x05 byte
  middleX = 1;           // +0x08
  middleY = 1;           // +0x0c
  reverse = 0;           // +0x10 byte
  mode = 0;              // +0x11 byte
  hPlaneEffect = 0;      // +0x14
  vPlaneEffect = 0;      // +0x18
  waveEffect = 0;        // +0x1c
  hypercosEffect = 0;    // +0x20
  noisify = 0;           // +0x24 byte
}

// precalCoef (0x1000b350): [h*16 + v] = four weights (pos, pos+1, pos+w, pos+w+1), each product less one
// unless zero; h = v = 0 is 255 on the first pixel alone
const COEF = new Int32Array(256);
for (let h = 0; h < 16; h++) {
  for (let v = 0; v < 16; v++) {
    if (h === 0 && v === 0) { COEF[h * 16 + v] = 255; continue; }
    let i1 = (16 - h) * (16 - v), i2 = h * (16 - v), i3 = (16 - h) * v, i4 = h * v;
    if (i1) i1--;
    if (i2) i2--;
    if (i3) i3--;
    if (i4) i4--;
    COEF[h * 16 + v] = (i4 << 24) | (i3 << 16) | (i2 << 8) | i1;
  }
}

export class ZoomFilter {
  // the visual's data (0x4a8 bytes at goomInfo+0xa1c's pointer)
  enabled = 1;               // +0x10 (the "Enabled" parameter)
  brutS = new Int32Array(0); // +0x44
  brutD = new Int32Array(0); // +0x4c
  brutT = new Int32Array(0); // +0x54
  prevX = 0; prevY = 0;      // +0x60 +0x64
  generalSpeed = 0;          // +0x68 float
  reverse = 0;               // +0x6c
  theMode = 4;               // +0x70 byte
  waveEffect = 0;            // +0x74
  hypercosEffect = 0;        // +0x78
  vPlaneEffect = 0;          // +0x7c
  hPlaneEffect = 0;          // +0x80
  noisify = 2;               // +0x84 byte
  middleX = 0; middleY = 0;  // +0x88 +0x8c
  mustInitBuffers = 1;       // +0x90
  interlaceStart = -2;       // +0x94
  buffratio = 0;             // +0x98
  firedec = new Int32Array(0); // +0x9c

  constructor(private rnd: GoomRandom, private crt: Crt) {}

  /** 0x1000ad50 zoomFilterFastRGB(pix1 -> pix2) */
  apply(pix1: Uint32Array, pix2: Uint32Array, zf: ZoomFilterData | null, w: number, h: number,
    switchIncr: number, switchMult: number): void {
    if (!this.enabled) return;
    if (this.prevX !== w || this.prevY !== h) {
      this.prevX = w; this.prevY = h;
      this.middleX = w >>> 1; this.middleY = h >>> 1;
      this.mustInitBuffers = 1;
    }
    if (this.interlaceStart === -2 && zf) {
      this.reverse = (zf.reverse << 24) >> 24;
      const gs = f32((zf.vitesse - 128) * 0.0078125);
      this.generalSpeed = this.reverse ? f32(-gs) : gs;
      this.middleX = zf.middleX; this.middleY = zf.middleY;
      this.theMode = zf.mode;
      this.hPlaneEffect = zf.hPlaneEffect; this.vPlaneEffect = zf.vPlaneEffect;
      this.waveEffect = zf.waveEffect; this.hypercosEffect = zf.hypercosEffect;
      this.noisify = zf.noisify;
      this.interlaceStart = 0;
    }
    if (this.mustInitBuffers) {
      const n = this.prevX * this.prevY;
      this.mustInitBuffers = 0;
      this.brutS = new Int32Array(n * 2);
      this.brutD = new Int32Array(n * 2);
      this.brutT = new Int32Array(n * 2);
      this.buffratio = 0;
      this.firedec = new Int32Array(this.prevY);
      this.generateWaterFX();
      this.interlaceStart = 0;
      this.makeZoomBufferStripe(this.prevY);
      this.brutS.set(this.brutT);
      this.brutD.set(this.brutT);
    }
    if (this.interlaceStart === -1) {
      // the target is done: brutS becomes where the blend got to, brutD the new target
      const S = this.brutS, D = this.brutD, r = this.buffratio, n = this.prevY * this.prevX * 2;
      for (let i = 0; i < n; i++) S[i] = (Math.imul(D[i] - S[i], r) >> 16) + S[i];
      this.buffratio = 0;
      const t = this.brutT; this.brutT = this.brutD; this.brutD = t;
      this.interlaceStart = -2;
    }
    if (this.interlaceStart >= 0) this.makeZoomBufferStripe(this.prevY >> 4);
    if (switchIncr !== 0) {
      this.buffratio += switchIncr;
      if (this.buffratio > 0xffff) this.buffratio = 0xffff;
    }
    if (switchMult !== 1.0) this.buffratio = ftol((1.0 - switchMult) * 65535.0 + this.buffratio * switchMult);
    zoomMMX(this.prevX, this.prevY, pix1, pix2, this.brutS, this.brutD, this.buffratio);
  }

  /** 0x1000b090 generateWaterFXHorizontalBuffer: firedec (unused by the drawing, but it draws on the
   *  goom random table) */
  private generateWaterFX(): void {
    const R = this.rnd;
    let decc = R.irand(8) - 4, spdc = R.irand(8) - 4, accel = R.irand(8) - 4;
    for (let loopv = this.prevY; loopv !== 0;) {
      loopv--;
      this.firedec[loopv] = decc;
      decc += (spdc / 10) | 0;
      spdc += R.irand(3) - R.irand(3);
      if (decc > 4) spdc -= 1;
      if (decc < -4) spdc += 1;
      if (spdc > 30) spdc = spdc - R.irand(3) + ((accel / 10) | 0);
      if (spdc < -30) spdc = spdc + R.irand(3) + ((accel / 10) | 0);
      if (decc > 8 && spdc > 1) spdc -= R.irand(3) - 2;
      if (decc < -8 && spdc < -1) spdc += R.irand(3) + 2;
      if (decc > 8 || decc < -8) decc = ((decc * 8) / 9) | 0;
      accel += R.irand(2) - R.irand(2);
      if (accel > 20) accel -= 2;
      if (accel < -20) accel += 2;
    }
  }

  /** 0x1000a910 makeZoomBufferStripe: rows interlaceStart .. +incr of brutT */
  private makeZoomBufferStripe(incr: number): void {
    const prevX = this.prevX, prevY = this.prevY, T = this.brutT;
    const ratio = f32(2.0 / prevX);
    const invRatio = f32(16.0 / ratio);
    const minVal = f32(ratio * 0.0625);
    let Y = f32((this.interlaceStart - this.middleY) * ratio);
    let maxEnd = prevY;
    if (maxEnd > incr + this.interlaceStart) maxEnd = incr + this.interlaceStart;
    let y = this.interlaceStart;
    for (; y < prevY && y < maxEnd; y++) {
      let premul = y * prevX * 2;
      let X = f32(-(this.middleX * ratio));
      for (let x = 0; x < prevX; x++) {
        this.zoomVector(X, Y);
        let vx = VX, vy = VY;
        if (!(minVal < Math.abs(vx) || minVal === Math.abs(vx))) vx = vx < 0 ? -minVal : minVal;
        if (!(minVal < Math.abs(vy) || minVal === Math.abs(vy))) vy = vy < 0 ? -minVal : minVal;
        T[premul] = ftol((X - vx) * invRatio) + (this.middleX << 4);
        T[premul + 1] = ftol((Y - vy) * invRatio) + (this.middleY << 4);
        premul += 2;
        X = f32(X + ratio);
      }
      Y = f32(Y + ratio);
    }
    this.interlaceStart += incr;
    if (y >= prevY - 1) this.interlaceStart = -1;
  }

  /** 0x1000a720 zoomVector: the displacement at (X, Y) as two doubles (VX, VY) */
  private zoomVector(X: number, Y: number): void {
    const sq = f32(X * X + Y * Y);
    let coef = (this.generalSpeed + 1.0) * 0.019999999552965164;
    switch (this.theMode) {
      case 1: coef = sinMul(sq * 20.0, 0.01) + coef; break;                  // WAVE
      case 2: coef = coef - (sq - 0.30000001192092896) * 0.06666667014360428; break;
      case 3: coef = sq * 0.10000000149011612 + coef; break;
      case 4: coef = sq * 3.5 + coef; break;
      case 9: coef = coef * Y * 4.0; break;
      default: break;
    }
    if (coef < -2.009999990463257) coef = -2.009999990463257;
    else if (coef > 2.009999990463257) coef = 2.009999990463257;
    let vx = f32(X * coef), vy: number;
    if (this.noisify) {
      vx = f32((this.crt.rand() * 3.0518509447574615e-05 - 0.5) * 0.019999999552965164 + vx);
      const vyf = f32(coef * Y);
      vy = (this.crt.rand() * 3.0518509447574615e-05 - 0.5) * 0.019999999552965164 + vyf;
    } else {
      vy = coef * Y;
    }
    if (this.hypercosEffect) {
      vx = sinMul(Y * 10.0, 0.008333333333333333) + vx;
      vy = sinMul(X * 10.0, 0.008333333333333333) + vy;
    }
    if (this.hPlaneEffect) vx = this.hPlaneEffect * Y * 0.0024999999441206455 + vx;
    if (this.vPlaneEffect) vy = this.vPlaneEffect * X * 0.0024999999441206455 + vy;
    VX = vx; VY = vy;
  }
}
let VX = 0, VY = 0;

/** 0x1001f430: the MMX zoom. Positions outside [0, (w-1)*16) x [0, (h-1)*16) read pixel 0 with weight 0. */
export function zoomMMX(prevX: number, prevY: number, src: Uint32Array, dst: Uint32Array, S: Int32Array, D: Int32Array, ratio: number): void {
  const ax = (prevX - 1) << 4, ay = (prevY - 1) << 4, n = prevX * prevY;
  for (let i = 0, j = 0; i < n; i++, j += 2) {
    const s0 = S[j], s1 = S[j + 1];
    const px = (Math.imul(D[j] - s0, ratio) >> 16) + s0;
    const py = (Math.imul(D[j + 1] - s1, ratio) >> 16) + s1;
    let pos = 0, c = 0;
    if ((py >>> 0) < ay && (px >>> 0) < ax) {
      pos = (px >> 4) + Math.imul(py >> 4, prevX);
      c = COEF[((px & 15) << 4) + (py & 15)];
    }
    const c0 = c & 255, c1 = (c >>> 8) & 255, c2 = (c >>> 16) & 255, c3 = c >>> 24;
    const a = src[pos], b = src[pos + 1], e = src[pos + prevX], f = src[pos + prevX + 1];
    // two channels per 16-bit lane, as PMULLW/PADDW do them: the weights sum to at most 255, so a lane
    // never exceeds 255 * 255 and never carries into the next (int32 wrap-around is harmless: the result
    // is taken mod 2^32)
    let lo = (Math.imul(a & 0xff00ff, c0) + Math.imul(b & 0xff00ff, c1)) | 0;
    lo = (lo + Math.imul(e & 0xff00ff, c2) + Math.imul(f & 0xff00ff, c3)) | 0;
    let hi = (Math.imul((a >>> 8) & 0xff00ff, c0) + Math.imul((b >>> 8) & 0xff00ff, c1)) | 0;
    hi = (hi + Math.imul((e >>> 8) & 0xff00ff, c2) + Math.imul((f >>> 8) & 0xff00ff, c3)) | 0;
    dst[i] = ((lo >>> 8) & 0xff00ff) | (hi & 0xff00ff00);
  }
}
