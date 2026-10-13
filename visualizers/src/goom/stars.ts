// Goom's particle system ("flying stars", visual data 0x1000b5d0, apply 0x1000b7b0): on every goom a burst
// of particles (fireworks, rain or fountain), each a float position/velocity/acceleration and an age,
// drawn as two short trails while young.
import { f32, ftol } from './fpu';
import type { GoomRandom } from './random';
import type { SoundInfo } from './sound';
import { drawLine } from './draw';

// the particles' direction tables (0x100308f0 sin, 0x10030cf0 cos): 256 steps of a turn, each the value
// printed to 6 significant digits then read as a float; the cos table's first entry is 0, not 1
const SIN1 = new Float32Array(256), COS1 = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const a = i * 2 * Math.PI / 256;
  SIN1[i] = Number(Math.sin(a).toPrecision(6));
  COS1[i] = i === 0 ? 0 : Number(Math.cos(a).toPrecision(6));
}

// a particle's colour by its age (0x1002085c), age 0..15
const COLORS = [0x1416181a, 0x1419181a, 0x141f181a, 0x1426181a, 0x142a181a, 0x142f181a, 0x1436181a, 0x142f1819,
  0x14261615, 0x13201411, 0x111a100a, 0x0c180508, 0x08100304, 0x00050101, 0x00000000];

export class Stars {
  fxMode = 0;           // +0x00
  nbStars = 0;          // +0x04
  maxStars = 0x1000;    // +0x08
  // particle i: x y vx vy ax ay age vage (+0x0c, 32 bytes each)
  stars = new Float32Array(0x1000 * 8);
  minAge = 0;           // +0x10
  maxAge = 0;           // +0x14
  largest = 99;         // +0x28 "Fireworks Largest Bombs"
  smallest = 0x50;      // +0x54 "Fireworks Smallest Bombs"
  nbStarsLimit = 0x200; // +0xac "Max Number of Particules"
  fxModeP = 0;          // +0xd8 "FX Mode"
  nbStarsP = 0.5;       // +0x80 "Number of Particules (% of Max)"

  constructor(private rnd: GoomRandom) {}

  /** 0x1000bc00 addABomb */
  private addBomb(mx: number, my: number, radius: number, vage: number, gravity: number): void {
    if (this.nbStars >= this.maxStars) return;
    const s = this.nbStars++ * 8, S = this.stars, R = this.rnd;
    S[s] = mx; S[s + 1] = my;
    const ro0 = R.irand(100) * radius * 0.009999999776482582;
    const ro = ro0 * (R.irand(100) * 0.009999999776482582 + 1.0);
    const theta = R.irand(256);
    S[s + 2] = ro * COS1[theta];
    S[s + 3] = ro * SIN1[theta] - 0.20000000298023224;
    S[s + 4] = 0;
    S[s + 5] = gravity;
    S[s + 6] = 0;
    S[s + 7] = vage < this.minAge ? this.minAge : vage;
  }

  /** 0x1000ba40 fs_sound_event_occured */
  private soundEvent(snd: SoundInfo, w: number, h: number): void {
    const R = this.rnd;
    let max = ftol(R.irand(150) * (snd.goomPower + 1.0)) + 100;
    let radius = (R.irand(150) + 50) * (snd.goomPower + 1.0) * 0.0033333334140479565;
    let mx = R.irand(w), my: number, vage: number, gravity = 0.019999999552965164;
    switch (this.fxMode) {
      case 0:
        my = R.irand(h);
        vage = f32((1.0 - snd.goomPower) * this.maxAge);
        break;
      case 1: {
        const r = R.irand((w / 3) | 0);
        radius = radius * 1.5;
        vage = 0.0020000000949949026;
        my = -r - ((h / 3) | 0);
        break;
      }
      case 2:
        mx = (w / 2) | 0;
        my = h + 2;
        radius = radius + 1.0;
        vage = 0.0010000000474974513;
        gravity = 0.03999999910593033;
        break;
      default:
        return;
    }
    const fh = h;
    let radiusF = f32(fh * radius * 0.004999999888241291);
    let n = ftol(max * fh * 0.004999999888241291);
    if (snd.timeSinceLastBigGoom < 1) { radiusF = f32(radiusF * 1.5); n += n; }
    for (; n > 0; n--) this.addBomb(mx, my, radiusF, vage, gravity);
  }

  /** 0x1000b7b0: both trails go into dst (the apply's third argument, p1) */
  apply(dst: Uint32Array, snd: SoundInfo, w: number, h: number): void {
    const R = this.rnd, S = this.stars;
    this.minAge = f32(1.0 - this.largest * 0.009999999776482582);
    this.maxAge = f32(1.0 - this.smallest * 0.009999999776482582);
    this.nbStarsP = f32(this.nbStars / this.maxStars);
    this.maxStars = this.nbStarsLimit;
    this.fxMode = this.fxModeP;
    if (snd.timeSinceLastGoom < 1) {
      this.soundEvent(snd, w, h);
      if (R.irand(20) === 1) this.fxModeP = R.irand(9);
    }
    for (let i = 0; i < this.nbStars; i++) {
      const s = i * 8;
      S[s] = S[s] + S[s + 2];
      S[s + 1] = S[s + 1] + S[s + 3];
      S[s + 2] = S[s + 4] + S[s + 2];
      S[s + 3] = S[s + 5] + S[s + 3];
      S[s + 6] = S[s + 7] + S[s + 6];
      if (S[s + 6] < 15.0) {
        const col = COLORS[ftol(S[s + 6])];
        drawLine(dst, ftol(S[s]), ftol(S[s + 1]), ftol(S[s] - S[s + 2] * 6.0), ftol(S[s + 1] - S[s + 3] * 6.0), col, w, h);
        drawLine(dst, ftol(S[s]), ftol(S[s + 1]), ftol(S[s] - S[s + 2] * 2), ftol(S[s + 1] - S[s + 3] * 2), col, w, h);
      }
    }
    for (let i = 0; i < this.nbStars;) {
      const s = i * 8;
      if (w + 64 < S[s] || (!(S[s + 3] < 0) && h < S[s + 1] - S[s + 3] * 16.0) || S[s] < -64.0 || !(S[s + 6] < 15.0)) {
        S.copyWithin(s, (this.nbStars - 1) * 8, this.nbStars * 8);
        this.nbStars--;
      } else {
        i++;
      }
    }
  }
}
