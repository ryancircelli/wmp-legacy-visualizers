// Goom's sound analysis (evaluate_sound 0x100131e0, SoundInfo at goomInfo+0x14): the peak of every other
// sample of the first channel against the loudest ever, an "acceleration" and "speed" smoothed from it,
// and goom detection (a goom is a jump of the acceleration over an adaptive limit).
import { f32 } from './fpu';

export class SoundInfo {
  timeSinceLastGoom = 0;      // +0x000
  goomPower = 0;              // +0x004 float
  timeSinceLastBigGoom = 0;   // +0x008
  volume = 0;                 // +0x00c float
  samples = new Int16Array(1024); // +0x010
  goomLimit = 1.0;            // +0x810 float
  bigGoomLimit = 0;           // +0x814 float
  accelvar = 0;               // +0x818 float
  speedvar = 0;               // +0x81c float
  allTimesMax = 1;            // +0x820
  totalgoom = 0;              // +0x824
  provMax = 0;                // +0x828 float
  cycle = 0;                  // +0x82c
  // parameters the brightness script reads (each a value the DLL also hands its GUI)
  volumeP = 0;                // +0x840
  speedP = 0;                 // +0x86c
  accelP = 0;                 // +0x898
  goomLimitP = 0;             // +0x8c4
  goomPowerP = 0;             // +0x8f0 "Goom Power"
  lastGoomP = 0;              // +0x91c "Goom Detection"
  lastBigGoomP = 0;           // +0x948 "Big Goom Detection"
  biggoomSpeedLimit = 10;     // +0x974
  biggoomFactor = 10;         // +0x9a0

  /** 0x100131e0 */
  evaluate(data: Int16Array): void {
    let inc = 0;
    for (let i = 0; i < 512; i += 2) if (data[i] > inc) inc = data[i];
    if (inc > this.allTimesMax) this.allTimesMax = inc;
    const incvar = inc / this.allTimesMax;
    this.volume = f32(incvar);
    const prevAccel = this.accelvar;
    this.samples.set(data);
    this.accelvar = f32(incvar);
    if (!(this.speedvar <= 1.0)) this.speedvar = 1.0;
    let difaccel: number;
    if (this.speedvar < 0.10000000149011612) difaccel = 1.0 - this.speedvar;
    else if (this.speedvar < 0.30000001192092896) difaccel = 0.8999999761581421 - (this.speedvar - 0.10000000149011612) * 0.5;
    else difaccel = 0.800000011920929 - (this.speedvar - 0.30000001192092896) * 0.25;
    this.accelvar = f32(difaccel * incvar);
    const a95 = this.accelvar * 0.949999988079071;
    this.accelvar = f32(a95);
    if (a95 < 0) this.accelvar = 0;
    let d = this.accelvar - prevAccel;
    if (d < 0) d = -d;
    const sp = (d * 0.5 + this.speedvar) * 0.4950000047683716;
    this.speedvar = f32(sp);
    if (sp < 0) this.speedvar = 0;
    if (!(this.speedvar <= 1.0)) this.speedvar = 1.0;
    this.timeSinceLastGoom++;
    this.cycle++;
    this.timeSinceLastBigGoom++;
    if (this.biggoomSpeedLimit * 0.009999999776482582 < this.speedvar && this.accelvar > this.bigGoomLimit
      && this.timeSinceLastBigGoom > 100) this.timeSinceLastBigGoom = 0;
    if (this.accelvar > this.goomLimit) {
      this.timeSinceLastGoom = 0;
      this.totalgoom++;
      this.goomPower = f32(this.accelvar - this.goomLimit);
    }
    if (this.accelvar > this.provMax) this.provMax = this.accelvar;
    if (!(this.goomLimit <= 1.0)) this.goomLimit = 1.0;
    if (this.cycle % 64 === 0) {
      if (this.speedvar < 0.009999999776482582) this.goomLimit = f32(this.goomLimit * 0.91);
      if (this.totalgoom > 4) this.goomLimit = f32(this.goomLimit + 0.02);
      if (this.totalgoom > 7) this.goomLimit = f32(this.goomLimit * 1.0299999713897705 + 0.03);
      if (this.totalgoom > 16) this.goomLimit = f32(this.goomLimit * 1.0499999523162842 + 0.04);
      if (this.totalgoom === 0) this.goomLimit = f32(this.provMax - 0.02);
      if (this.totalgoom === 1 && this.goomLimit > 0.02) this.goomLimit = f32(this.goomLimit - 0.01);
      this.totalgoom = 0;
      this.provMax = 0;
      this.bigGoomLimit = f32((this.biggoomFactor * 0.0020000000949949026 + 1.0) * this.goomLimit);
    }
    this.volumeP = f32(incvar);
    this.speedP = f32(this.speedvar * 4.0);
    this.accelP = this.accelvar;
    this.goomLimitP = this.goomLimit;
    this.goomPowerP = this.goomPower;
    this.lastGoomP = f32(1.0 - this.timeSinceLastGoom * 0.05000000074505806);
    this.lastBigGoomP = f32(1.0 - this.timeSinceLastBigGoom * 0.02500000037252903);
  }
}
