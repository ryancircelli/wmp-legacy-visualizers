// goom_init (0x1000c4d0), goom_set_resolution (0x1000c730) and goom_update (0x1000c7c0) of the WMP 9 plug-in:
// the effect state machine that picks the zoom mode, the IFS, points, tentacles, scope lines and particle
// bursts from the sound, then runs them over two ping-pong buffers and copies the result out through the
// brightness flash.
import { f32, ftol, cosMul, sinMul, log10_87 } from './fpu';
import { Crt, GoomRandom } from './random';
import { SoundInfo } from './sound';
import { ZoomFilter, ZoomFilterData } from './zoom';
import { Convolve } from './convolve';
import { GMLine, GML_CIRCLE, GML_HLINE } from './lines';
import { Stars } from './stars';
import { Tentacles } from './tentacles';
import { Ifs } from './ifs';
import { drawText, type GoomFont } from './text';

interface GoomState { drawIFS: number; drawPoints: number; drawTentacle: number; drawScope: number; farVal: number; rangemin: number; rangemax: number }
// goomInfo+0xa64: eight states, picked by a random number 0..509 falling in their range
const STATES: GoomState[] = [
  { drawIFS: 1, drawPoints: 0, drawTentacle: 0, drawScope: 1, farVal: 4, rangemin: 0, rangemax: 100 },
  { drawIFS: 1, drawPoints: 0, drawTentacle: 0, drawScope: 0, farVal: 1, rangemin: 101, rangemax: 140 },
  { drawIFS: 1, drawPoints: 0, drawTentacle: 0, drawScope: 1, farVal: 2, rangemin: 141, rangemax: 200 },
  { drawIFS: 0, drawPoints: 1, drawTentacle: 0, drawScope: 1, farVal: 2, rangemin: 201, rangemax: 260 },
  { drawIFS: 0, drawPoints: 1, drawTentacle: 0, drawScope: 1, farVal: 0, rangemin: 261, rangemax: 330 },
  { drawIFS: 0, drawPoints: 1, drawTentacle: 1, drawScope: 1, farVal: 4, rangemin: 331, rangemax: 400 },
  { drawIFS: 0, drawPoints: 0, drawTentacle: 1, drawScope: 0, farVal: 5, rangemin: 401, rangemax: 450 },
  { drawIFS: 0, drawPoints: 0, drawTentacle: 1, drawScope: 1, farVal: 1, rangemin: 451, rangemax: 510 },
];

// filter modes (ZoomFilterData.mode)
const NORMAL = 0, WAVE = 1, CRYSTAL_BALL = 2, SCRUNCH = 3, AMULETTE = 4, WATER = 5, HYPERCOS1 = 6, HYPERCOS2 = 7, YONLY = 8, SPEEDWAY = 9;

export class GoomCore {
  w = 0; h = 0;
  crt = new Crt();
  rnd = new GoomRandom();
  sound = new SoundInfo();
  p1 = new Uint32Array(0); p2 = new Uint32Array(0); out = new Uint32Array(0);
  cycle = 0;                       // +0xa60
  curState = STATES[6];            // +0x126c
  lockvar = 0;                     // +0x127c
  goomvar = 0;                     // +0x1280
  loopvar = 0;                     // +0x1284
  stopLines = 0;                   // +0x1288
  ifsIncr = 1;                     // +0x128c
  decayIfs = 0;                    // +0x1290
  recayIfs = 0;                    // +0x1294
  cyclesSinceLastChange = 0;       // +0x1298
  drawLinesDuration = 80;          // +0x129c
  lineMode = 80;                   // +0x12a0
  switchMultAmount = f32(29.0 / 30.0); // +0x12a4 (0x3f777777)
  switchIncrAmount = 0x7f;         // +0x12a8
  switchMult = 1.0;                // +0x12ac
  switchIncr = 0x7f;               // +0x12b0
  stateSelectionRnd = 0;           // +0x12b4
  stateSelectionBlocker = 0;       // +0x12b8
  previousZoomSpeed = 128;         // +0x12bc
  timeOfTitleDisplay = 0;          // +0x12c0
  titleText = '';                  // +0x12c4
  zfd = new ZoomFilterData();      // +0x16c4
  // the message (goom_draw_text's caller 0x1000def0): +0x16ec lines, +0x16f0 text, +0x1ef0 frames left
  msgLines = 0; msgText = ''; msgAffiche = 0;
  zoom: ZoomFilter;
  stars: Stars;
  tentacles: Tentacles;
  convolve = new Convolve();
  ifs: Ifs;
  line1: GMLine; line2: GMLine;
  font: GoomFont | null = null;

  /** goom_init(w, h) with the random table seeded by `seed` (the DLL: the first buffer's heap address) */
  constructor(w: number, h: number, seed: number) {
    this.stars = new Stars(this.rnd);
    this.zoom = new ZoomFilter(this.rnd, this.crt);
    this.tentacles = new Tentacles(this.rnd, this.crt);   // its grids draw 18 rand()s before the srand
    this.w = w; this.h = h;
    this.allocBuffers();
    this.rnd.init(this.crt, seed);
    this.cycle = 0;
    this.ifs = new Ifs(this.rnd, this.crt);
    const fh = f32(h);
    this.line1 = new GMLine(this.rnd, w, h, GML_HLINE, fh, 6, GML_CIRCLE, f32(fh * 0.4000000059604645), 4);
    this.line2 = new GMLine(this.rnd, w, h, GML_HLINE, 0, 6, GML_CIRCLE, f32(h * 0.20000000298023224), 1);
  }

  private allocBuffers(): void {
    const n = this.w * this.h;
    this.p1 = new Uint32Array(n); this.p2 = new Uint32Array(n); this.out = new Uint32Array(n);
  }

  /** 0x1000c730 goom_set_resolution */
  setResolution(w: number, h: number): void {
    this.w = w; this.h = h;
    this.allocBuffers();
    this.ifs.reset();
    this.line1.setRes(w, h);
    this.line2.setRes(w, h);
  }

  /** 0x1000b440 pointFilter: a five-pixel plus with a white centre on a Lissajous path */
  private pointFilter(pix: Uint32Array, r: number, g: number, b: number, t1: number, t2: number, t3: number, t4: number, cycle: number): void {
    const w = this.w, h = this.h;
    const x = ftol(cosMul(cycle / t3, t1)) + ((w / 2) | 0);
    const y = ftol(sinMul(cycle / t4, t2)) + ((h / 2) | 0);
    if ((x >>> 0) > 1 && (y >>> 0) > 1 && (x >>> 0) < ((w - 2) >>> 0) && (y >>> 0) < ((h - 2) >>> 0)) {
      const c = b | (g << 8) | (r << 16);
      pix[(x + 1) + w * y] = c;
      pix[x + w * (y + 1)] = c;
      pix[(x + 1) + w * (y + 1)] = 0xffffff;
      pix[(x + 2) + w * (y + 1)] = c;
      pix[(x + 1) + w * (y + 2)] = c;
    }
  }

  /** 0x1000dd20 choose_a_goom_line */
  private chooseLine(far: number): { param1: number; param2: number; couleur: number; mode: number; amplitude: number } {
    const R = this.rnd, w = this.w, h = this.h;
    const mode = R.irand(3);
    let amplitude = 1.0, param1 = 0, param2 = 0;
    if (mode === 0) {
      if (far) { param1 = param2 = f32(0.47); amplitude = f32(0.8); }
      else if (R.irand(3) === 0) { param1 = param2 = 0; amplitude = 3.0; }
      else if (R.irand(2)) { param1 = f32(h * 0.4000000059604645); param2 = f32(h * 0.2199999988079071); }
      else { param1 = param2 = f32(h * 0.35); }
    } else if (mode === 1) {
      if (R.irand(4) === 0 && !far) { param1 = param2 = f32(h * 0.5); amplitude = 2.0; }
      else { param1 = (h / 7) | 0; param2 = f32(h * 0.8571428656578064); }
    } else {
      if (R.irand(3) === 0 && !far) { param1 = param2 = f32(w * 0.5); amplitude = 1.5; }
      else { param1 = f32(w * 0.1428571492433548); param2 = f32(w * 0.8571428656578064); }
    }
    return { param1, param2, couleur: R.irand(6), mode, amplitude };
  }

  /** goom_update: data = 512 samples of channel 0 then 512 of channel 1 (int16) */
  update(data: Int16Array, forceMode: number, fps: number, songTitle: string | null, message: string | null): Uint32Array {
    const R = this.rnd, w = this.w, h = this.h, snd = this.sound, zfd = this.zfd;
    const pointWidth = ((w * 2) / 5) | 0, pointHeight = ((h * 2) / 5) | 0;
    snd.evaluate(data);
    const lfd = snd.volume * 0.6666666865348816 + snd.speedvar * 0.006666666828095913;
    const largfactor = lfd > 1.5 ? 1.5 : f32(lfd);

    // the IFS fading in and out
    this.decayIfs--;
    if (this.decayIfs > 0) this.ifsIncr += 2;
    if (this.decayIfs === 0) this.ifsIncr = 0;
    if (this.recayIfs) {
      this.ifsIncr -= 2;
      this.recayIfs--;
      if (this.recayIfs === 0 && this.ifsIncr <= 0) this.ifsIncr = 1;
    }
    if (this.ifsIncr > 0) this.ifs.apply(this.p1, this.p2, w, h, this.ifsIncr);

    if (this.curState.drawPoints && !(snd.speedvar * 80.0 + 15.0 < 15.0)) {
      const lf = largfactor;
      const PH = pointHeight >>> 0, PW = pointWidth >>> 0;
      const tA = f32((PH - 6.0) * lf + 5.0), tB = f32((PW - 6.0) * lf + 5.0);
      const tC = f32((PH >>> 1) * lf), tD = f32((PW >>> 1) * lf);
      const ph3 = Math.floor(PH / 3);
      const tE = f32((ph3 + 5.0) * lf), tF = f32(ph3 * lf + 20.0), tG = f32(PH * lf);
      let i = 1, j = 15;
      do {
        this.loopvar = ftol(snd.speedvar * 50.0 + this.loopvar + 1.0);
        const fi = i;
        this.pointFilter(this.p1, 0xff, 0xff, 0x33, tB, tA, f32(fi * 152.0), 128.0, (this.loopvar + 2032 * i) >>> 0);
        const q = (this.loopvar / i) | 0;
        const fi10 = f32(fi * 10.0);
        this.pointFilter(this.p1, 0xff, 0xcc, 0x05, f32(tD / fi + fi10), f32(tC / fi + fi10), 96.0, f32(fi * 80.0), q >>> 0);
        const u = f32(tE / fi + fi10);
        this.pointFilter(this.p1, 0x55, 0x05, 0xff, u, u, f32(fi + 122.0), 134.0, q >>> 0);
        this.pointFilter(this.p1, 0, 0, 0, tF, tF, 58.0, f32(fi * 66.0), q >>> 0);
        const v = f32((tG + fi10) / fi);
        this.pointFilter(this.p1, 0xff, 0xff, 0xff, v, v, 66.0, 74.0, (this.loopvar + 500 * i) >>> 0);
        j += 15; i++;
      } while (!(snd.speedvar * 80.0 + 15.0 < j));
    }

    this.lockvar--;
    if (this.lockvar < 0) this.lockvar = 0;

    if ((snd.timeSinceLastGoom === 0 || forceMode > 0 || this.cyclesSinceLastChange > 300) && R.irand(16) === 0) {
      const v = R.irand(32);
      const resetWH = (): void => { zfd.waveEffect = 0; zfd.hypercosEffect = 0; };
      const waveBlock = (): void => {
        zfd.mode = WAVE; zfd.reverse = 0;
        zfd.waveEffect = R.irand(3) === 0 ? 1 : 0;
        if (R.irand(2)) zfd.vitesse = (zfd.vitesse + 127) >> 1;
      };
      if (v === 0 || v === 10) { zfd.hypercosEffect = R.irand(2); waveBlock(); }
      else if (v === 13 || v === 20 || v === 21) waveBlock();
      else if (v === 1 || v === 11) { zfd.mode = CRYSTAL_BALL; resetWH(); }
      else if (v === 2 || v === 12) { zfd.mode = AMULETTE; resetWH(); }
      else if (v === 3) { zfd.mode = WATER; resetWH(); }
      else if (v === 4 || v === 14) { zfd.mode = SCRUNCH; resetWH(); }
      else if (v === 5 || v === 15 || v === 22) {
        zfd.mode = HYPERCOS1; zfd.waveEffect = 0;
        zfd.hypercosEffect = R.irand(3) === 0 ? 1 : 0;
      }
      else if (v === 6 || v === 16) { zfd.mode = HYPERCOS2; resetWH(); }
      else if (v === 7 || v === 17) {
        zfd.mode = CRYSTAL_BALL;
        zfd.waveEffect = R.irand(4) === 0 ? 1 : 0;
        zfd.hypercosEffect = R.irand(2);
      }
      else if (v === 8 || v === 18 || v === 19) { zfd.mode = SCRUNCH; zfd.waveEffect = 1; zfd.hypercosEffect = 1; }
      else if (v === 29 || v === 30) zfd.mode = YONLY;
      else if (v === 31 || v === 32) zfd.mode = SPEEDWAY;
      else { zfd.mode = NORMAL; resetWH(); }
    }

    let pzfd: ZoomFilterData | null = null;
    if (this.lockvar === 0) {
      if (snd.timeSinceLastGoom === 0) {
        this.goomvar++;
        if (this.stateSelectionBlocker === 0) {
          if (R.irand(3) !== 0) { this.stateSelectionRnd = R.irand(510); this.stateSelectionBlocker = 3; }
        } else this.stateSelectionBlocker--;
        for (const s of STATES) if (s.rangemin <= this.stateSelectionRnd && this.stateSelectionRnd <= s.rangemax) this.curState = s;
        if (this.curState.drawIFS && this.ifsIncr <= 0) { this.recayIfs = 5; this.ifsIncr = 11; }
        if (!this.curState.drawIFS && this.ifsIncr > 0 && this.decayIfs <= 0) this.decayIfs = 100;
        if (!this.curState.drawScope) { this.stopLines = 0; this.lineMode = this.drawLinesDuration; }
        this.lockvar = 50;
        const newvit = ftol(129.0 - log10_87(snd.speedvar * 60.0 + 1.0) * 3.5);
        if (zfd.reverse && this.cycle % 13 === 0 && this.crt.rand() % 5 === 0) {
          zfd.reverse = 0; zfd.vitesse = 126; this.lockvar = 75;
        }
        if (R.irand(10) === 0) { zfd.reverse = 1; this.lockvar = 100; }
        if (R.irand(10) === 0) zfd.vitesse = 127;
        if (R.irand(12) === 0) zfd.vitesse = 129;
        const m = R.irand(25);
        if (m === 0 || m === 3 || m === 6) { zfd.middleY = h - 1; zfd.middleX = (w / 2) | 0; }
        else if (m === 1 || m === 4) zfd.middleX = w - 1;
        else if (m === 2 || m === 5) zfd.middleX = 1;
        else { zfd.middleY = (h / 2) | 0; zfd.middleX = (w / 2) | 0; }
        if (zfd.mode === WATER || zfd.mode === YONLY || zfd.mode === AMULETTE) { zfd.middleX = (w / 2) | 0; zfd.middleY = (h / 2) | 0; }
        const p = R.irand(15);
        if (p === 0) {
          zfd.vPlaneEffect = R.irand(3) - R.irand(3);
          zfd.hPlaneEffect = R.irand(3) - R.irand(3);
        } else if (p === 3) {
          zfd.vPlaneEffect = 0;
          zfd.hPlaneEffect = R.irand(8) - R.irand(8);
        } else if (p >= 4 && p <= 7) {
          zfd.vPlaneEffect = R.irand(5) - R.irand(5);
          zfd.hPlaneEffect = -zfd.vPlaneEffect;
        } else if (p === 8) {
          zfd.hPlaneEffect = R.irand(8) + 5;
          zfd.vPlaneEffect = -zfd.hPlaneEffect;
        } else if (p === 9) {
          zfd.vPlaneEffect = R.irand(8) + 5;
          zfd.hPlaneEffect = -zfd.hPlaneEffect;
        } else if (p === 13) {
          zfd.hPlaneEffect = 0;
          zfd.vPlaneEffect = R.irand(10) - R.irand(10);
        } else if (p === 14) {
          zfd.hPlaneEffect = R.irand(10) - R.irand(10);
          zfd.vPlaneEffect = R.irand(10) - R.irand(10);
        } else if (p < 10) {
          zfd.hPlaneEffect = 0; zfd.vPlaneEffect = 0;
        }
        if (R.irand(5) !== 0) zfd.noisify = 0;
        else { zfd.noisify = R.irand(2) + 1; this.lockvar *= 2; }
        if (zfd.mode === AMULETTE) { zfd.vPlaneEffect = 0; zfd.hPlaneEffect = 0; zfd.noisify = 0; }
        if (zfd.middleX === 1 || zfd.middleX === w - 1) {
          zfd.vPlaneEffect = 0;
          if (R.irand(2)) zfd.hPlaneEffect = 0;
        }
        if (newvit < zfd.vitesse) {
          pzfd = zfd;
          if (((newvit >>> 0) < 0x79 && zfd.vitesse < 0x7a && this.cycle % 3 === 0) || R.irand(40) === 0) {
            zfd.vitesse = 0x80 - R.irand(2) + R.irand(2);
            zfd.reverse = zfd.reverse ? 0 : 1;
          } else {
            zfd.vitesse = ((zfd.vitesse * 7 + newvit) >>> 0) >>> 3;
          }
          this.lockvar += 50;
        }
        if (this.lockvar > 150) { this.switchIncr = this.switchIncrAmount; this.switchMult = 1.0; }
      }
      if (R.irand(700) === 0) {
        zfd.pertedec = 8; zfd.sqrtperte = 16; zfd.vitesse = 127;
        this.goomvar = 1;
        this.lockvar += 50;
        this.switchIncr = this.switchIncrAmount;
        this.switchMult = 1.0;
        pzfd = zfd;
      }
    }
    if (snd.speedvar < 0.009999999776482582 && zfd.vitesse < 124 && (this.cycle & 0xf) === 0) {
      zfd.vitesse += 3; zfd.pertedec = 8; zfd.sqrtperte = 16; this.goomvar = 0; pzfd = zfd;
    }
    if (this.cycle % 73 === 0 && zfd.vitesse < 123) { zfd.vitesse++; pzfd = zfd; }
    if (this.cycle % 101 === 0 && zfd.pertedec === 7) { pzfd = zfd; zfd.pertedec = 8; zfd.sqrtperte = 16; }
    if (forceMode > 0 && forceMode <= 10) { pzfd = zfd; zfd.mode = forceMode - 1; }
    if (forceMode === -1) pzfd = null;
    if (pzfd) {
      this.cyclesSinceLastChange = 0;
      let diff = zfd.vitesse - this.previousZoomSpeed;
      this.switchIncr = this.switchIncrAmount;
      if (diff < 0) diff = -diff;
      if (diff > 2) this.switchIncr = (((diff + 2) / 2) | 0) * this.switchIncrAmount;
      this.previousZoomSpeed = zfd.vitesse;
      this.switchMult = 1.0;
      if ((snd.timeSinceLastGoom === 0 && snd.totalgoom < 2) || forceMode > 0) {
        this.switchIncr = 0;
        this.switchMult = this.switchMultAmount;
      }
    } else if (this.cyclesSinceLastChange > 300) {
      pzfd = zfd;
      this.cyclesSinceLastChange = 0;
    } else this.cyclesSinceLastChange++;

    this.zoom.apply(this.p1, this.p2, pzfd, w, h, this.switchIncr, this.switchMult);
    this.tentacles.apply(this.p2, this.p1, w, h, snd.samples, snd.accelvar, this.curState.drawTentacle);
    this.stars.apply(this.p1, snd, w, h);
    this.drawMessage(message);
    if (fps > 0) drawText(this.font, this.p1, w, h, 10, 24, fps.toFixed(0).padStart(2) + ' fps', 1.0, 0);
    if (songTitle !== null) {
      this.titleText = songTitle.slice(0, 0x3ff);
      this.timeOfTitleDisplay = 200;
    }
    if (this.timeOfTitleDisplay) {
      drawText(this.font, this.p1, w, h, (w / 2) | 0, ((h / 2) | 0) + 7, this.titleText, f32((190 - this.timeOfTitleDisplay) * 0.10000000149011612), 1);
      this.timeOfTitleDisplay--;
      if (this.timeOfTitleDisplay < 4) {
        drawText(this.font, this.p2, w, h, (w / 2) | 0, ((h / 2) | 0) + 7, this.titleText, f32((190 - this.timeOfTitleDisplay) * 0.10000000149011612), 1);
      }
    }

    // the scope lines
    if ((this.stopLines & 0xf000) || !this.curState.drawScope) {
      const c = this.chooseLine(1);
      this.line1.switchTo(c.mode, c.param1, c.amplitude, 6);
      this.line2.switchTo(c.mode, c.param2, c.amplitude, 6);
      this.stopLines &= 0xfff;
    }
    if (this.lineMode !== this.drawLinesDuration) {
      this.lineMode--;
      if (this.lineMode === -1) this.lineMode = 0;
    } else if (this.cycle % 80 === 0 && R.irand(5) === 0 && this.lineMode) this.lineMode--;
    if (this.cycle % 120 === 0 && R.irand(4) === 0 && this.curState.drawScope) {
      if (this.lineMode === 0) this.lineMode = this.drawLinesDuration;
      else if (this.lineMode === this.drawLinesDuration) {
        this.lineMode--;
        this.switchLines();
      }
    }
    if (this.lineMode !== 0 || snd.timeSinceLastGoom < 5) {
      this.line2.power = this.line1.power;
      this.line1.draw(data, 0, this.p2);
      this.line2.draw(data, 512, this.p2);
      if (this.cycle % 121 === 9 && R.irand(3) === 1 && (this.lineMode === 0 || this.lineMode === this.drawLinesDuration)) {
        this.switchLines();
      }
    }

    const src = this.p1;
    this.p1 = this.p2; this.p2 = src;
    this.cycle = (this.cycle + 1) >>> 0;
    this.convolve.apply(src, this.out, w * h, snd);
    return this.out;
  }

  /** the two "switch to a random line" blocks of goom_update: one chooseLine, colours c and 5 - c */
  private switchLines(): void {
    const c = this.chooseLine(this.stopLines);
    let couleur = c.couleur, couleur2 = 5 - couleur;
    if (this.stopLines) {
      this.stopLines--;
      if (this.rnd.irand(2)) { couleur = 6; couleur2 = 6; }
    }
    this.line1.switchTo(c.mode, c.param1, c.amplitude, couleur);
    this.line2.switchTo(c.mode, c.param2, c.amplitude, couleur2);
  }

  /** 0x1000def0: a message rolls up through the middle for (lines * 25 + h + 105) frames */
  private drawMessage(message: string | null): void {
    const w = this.w, h = this.h;
    if (message !== null) {
      this.msgText = message;
      let n = 1;
      for (const ch of message) if (ch === '\n') n++;
      this.msgLines = n;
      this.msgAffiche = h + n * 25 + 105;
    }
    if (!this.msgAffiche) return;
    const lines = this.msgText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ypos0 = (i - this.msgLines) * 25 + this.msgAffiche;
      let ypos = ftol(cosMul(ypos0 * 0.05, 3.0) + ypos0) - 80;
      const charspace = f32(sinMul(ypos * 0.05, 1.5));
      if (i === lines.length - 1 && ypos * 2 < h) ypos = (h / 2) | 0;
      drawText(this.font, this.p1, w, h, (w / 2) | 0, ypos + 7, lines[i], charspace, 1);
    }
    this.msgAffiche--;
  }
}
