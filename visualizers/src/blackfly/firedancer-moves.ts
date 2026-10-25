// Fire Dancer's dance moves (FireDancer.dll, unit of TDanceMove, VMT 0x420334): the 13 move classes the dancer
// keeps in its three move slots. Our own TypeScript of what each class's Start and Step do; VAs are FireDancer.dll's.
//
// A move is made, gets Start once, then Step every sub-frame until Step returns true (then it is freed). Moves only
// queue part movements (TBodyPart.AddMovement, 0x420a20) and draw from the dancer's System.Random, so every call
// below is in the DLL's order. The tempo (dancer +0x90) is read fresh in the DLL on every call but nothing here
// changes it, so it is read once. Ints negated before FILD are written `0 - x` (never -0); FCHS of a float is `-x`.
import { delphiRound, type DelphiRandom } from './common';

/** a TBodyPart, as far as the moves use it */
export interface MovePart {
  /** +0xd8: the current angle the B argument of addMovement drives (the legs' bend) */
  rx: number;
  /** 0x420a20: start now (flag: and drop the queue) unless the part is moving and !flag, then queue it. a/b/c are
   *  the targets for +0xe0 / +0xd8 / +0xd0 (stored at +0x50 / +0x58 / +0x60). */
  addMovement(dur: number, delay: number, flag: boolean, a: number, b: number, c: number): void;
}

/** the TDancer, as far as the moves use it */
export interface MoveBody {
  rnd: Pick<DelphiRandom, 'random'> & { randomFloat(): number };
  hip: MovePart; // +0x30
  rthigh: MovePart; // +0x34
  lthigh: MovePart; // +0x38
  rshin: MovePart; // +0x3c
  lshin: MovePart; // +0x40
  spine: MovePart; // +0x4c
  rarm: MovePart; // +0x50
  larm: MovePart; // +0x54
  rforearm: MovePart; // +0x58
  lforearm: MovePart; // +0x5c
  head: MovePart; // +0x68
  /** +0x90, int (0x422730) */
  tempo: number;
  /** +0x94, float32 (0x42271c) */
  ratio: number;
}

export abstract class DanceMove {
  /** +8 */
  counter = 0;
  /** +0xc: left 0 by the moves whose Start doesn't set it */
  duration = 0;
  /** +0x10 (int, the size-0x14 classes): March / SideStep / FootWork's state, BackFlail's countdown */
  extra = 0;
  constructor(readonly body: MoveBody) {}
  /** VMT slot 1, a class constant */
  flags(): number {
    return (this.constructor as MoveClass).FLAGS;
  }
  /** 0x42273c */
  start(): void {}
  /** 0x42270c */
  step(): boolean {
    return ++this.counter >= this.duration;
  }
}

export type MoveClass = (new (b: MoveBody) => DanceMove) & { FLAGS: number };

const half = (n: number) => (n / 2) | 0; // SAR with the round-toward-zero fixup
const threeQuarters = (n: number) => ((3 * n) / 4) | 0;
const rest = (p: MovePart, dur: number, flag: boolean) => p.addMovement(dur, 0, flag, 0, 0, 0);

/** a bent standing leg (either part's rx off 0) goes straight over dur, at once; the move then waits dur */
function clear(dur: number, thigh: MovePart, shin: MovePart): number {
  if (thigh.rx === 0 && shin.rx === 0) return 0;
  rest(thigh, dur, true);
  rest(shin, dur, true);
  return dur;
}

/** random(2) = 0: the right leg stands and the left one moves (sign 1); else the other way round (sign -1) */
function pickLeg(b: MoveBody): [MovePart, MovePart, MovePart, MovePart, number] {
  return b.rnd.random(2) === 0 ? [b.rthigh, b.rshin, b.lthigh, b.lshin, 1] : [b.lthigh, b.lshin, b.rthigh, b.rshin, -1];
}

/** March / SideStep states 0 and 2: all four leg parts straight over a beat, at once; random(4) < 3 picks `a` */
function settle(b: MoveBody, a: number, other: number): number {
  for (const p of [b.lthigh, b.lshin, b.rthigh, b.rshin]) rest(p, b.tempo, true);
  return b.rnd.random(4) < 3 ? a : other;
}

/** March / SideStep states 1 and 3: the standing leg straightens over half a beat if bent, then the other thigh
 *  bends to -(90..104) (a and c `side`) and its shin 1.5 times that, and both come back */
function lift(b: MoveBody, standThigh: MovePart, standShin: MovePart, thigh: MovePart, shin: MovePart, side: number) {
  const t = b.tempo, d = clear(half(t), standThigh, standShin);
  const r = b.rnd.random(15) + 90;
  thigh.addMovement(t, d, d === 0, side, 0 - r, side);
  shin.addMovement(t, d, d === 0, 0, r * 1.5, 0);
  rest(thigh, t, false);
  rest(shin, t, false);
}

/** TMarch (VMT 0x422918). Step (0x422e14): loud only (ratio > 3); counts but never ends itself */
export class March extends DanceMove {
  static FLAGS = 1; // 0x42329c
  step(): boolean {
    const b = this.body;
    if (!(b.ratio > 3)) return false;
    switch (this.extra) {
      case 0: this.extra = settle(b, 1, 3); break;
      case 1: lift(b, b.lthigh, b.lshin, b.rthigh, b.rshin, 0); this.extra = 2; break;
      case 2: this.extra = settle(b, 3, 1); break;
      case 3: lift(b, b.rthigh, b.rshin, b.lthigh, b.lshin, 0); this.extra = 0; break;
    }
    super.step();
    return false;
  }
}

/** TSideStep (VMT 0x422bec). Step (0x423904): March with the lifted thigh turned 45 degrees out */
export class SideStep extends DanceMove {
  static FLAGS = 1; // 0x423d98
  step(): boolean {
    const b = this.body;
    if (!(b.ratio > 3)) return false;
    switch (this.extra) {
      case 0: this.extra = settle(b, 1, 3); break;
      case 1: lift(b, b.lthigh, b.lshin, b.rthigh, b.rshin, 45); this.extra = 2; break;
      case 2: this.extra = settle(b, 3, 1); break;
      case 3: lift(b, b.rthigh, b.rshin, b.lthigh, b.lshin, -45); this.extra = 0; break;
    }
    super.step();
    return false;
  }
}

/** TFootWork (VMT 0x42297c) */
export class FootWork extends DanceMove {
  static FLAGS = 1; // 0x425184
  /** 0x425170 */
  start(): void {
    this.extra = this.body.rnd.random(2) + 1;
  }
  /** 0x424c80: counts but never ends itself. State 1 moves at a beat or half a beat (drawn every Step, even
   *  quiet ones); everything else at a beat. */
  step(): boolean {
    const b = this.body, rnd = b.rnd, t = b.tempo;
    const dur = rnd.random(2) === 0 ? t : half(t);
    if (!(b.ratio > 2.5)) return false;
    let d = 0;
    switch (this.extra) {
      case 0:
        if (rnd.random(6) === 0) for (const p of [b.lthigh, b.lshin, b.rthigh, b.rshin]) rest(p, dur, true);
        this.extra = rnd.random(4) < 3 ? 1 : 3;
        break;
      case 1: {
        if ((b.lthigh.rx !== 0 || b.lshin.rx !== 0) && rnd.random(2) === 0) {
          rest(b.lthigh, dur, true);
          rest(b.lshin, dur, true);
          d = dur;
        }
        const p = rnd.random(90) - 30;
        const a = 0 - rnd.random(90);
        b.rthigh.addMovement(dur, d, d === 0, a, 0 - p, rnd.random(10) - 5);
        b.rshin.addMovement(dur, d, d === 0, 0, rnd.randomFloat() * (p + 30) * 2, 0);
        rest(b.rthigh, dur, false);
        rest(b.rshin, dur, false);
        this.extra = 3;
        break;
      }
      case 2:
        if (rnd.random(6) === 0) for (const p of [b.lthigh, b.lshin, b.rthigh, b.rshin]) rest(p, t, true);
        this.extra = rnd.random(4) < 3 ? 3 : 1;
        break;
      case 3: {
        if ((b.rthigh.rx !== 0 || b.rshin.rx !== 0) && rnd.random(2) === 0) {
          rest(b.rthigh, t, true);
          rest(b.rshin, t, true);
          d = t;
        }
        const p = rnd.random(90) - 30;
        const a = rnd.random(90);
        b.lthigh.addMovement(t, d, d === 0, a, 0 - p, rnd.random(10) - 5);
        b.lshin.addMovement(t, d, d === 0, 0, rnd.randomFloat() * (p + 30) * 2, 0);
        rest(b.lthigh, t, false);
        rest(b.lshin, t, false);
        this.extra = 1;
        break;
      }
    }
    super.step();
    return false;
  }
}

/** TLegFlail (VMT 0x4229e4). Start (0x425190); ends after 3/4 of a beat */
export class LegFlail extends DanceMove {
  static FLAGS = 1; // 0x425438
  start(): void {
    const b = this.body, rnd = b.rnd, t = b.tempo;
    if (rnd.random(2) === 0) {
      const f = rnd.random(135); // through a float32 local: exact
      rest(b.rthigh, t, true);
      rest(b.rshin, t, true);
      const a = rnd.random(90) - 20;
      b.lthigh.addMovement(t, 0, true, a, -f, rnd.random(10) - 5);
      b.lshin.addMovement(t, 0, true, 0, rnd.randomFloat() * f, 0);
      rest(b.lthigh, t, false);
      rest(b.lshin, t, false);
    } else {
      const f = rnd.random(135);
      const a = 0 - (rnd.random(90) - 20);
      b.rthigh.addMovement(t, 0, true, a, -f, rnd.random(10) - 5);
      b.rshin.addMovement(t, 0, true, 0, rnd.randomFloat() * f, 0);
      rest(b.lthigh, t, true);
      rest(b.lshin, t, true);
      rest(b.rthigh, t, false);
      rest(b.rshin, t, false);
    }
    this.duration = threeQuarters(t);
  }
}

/** TKick (VMT 0x422a4c). Start (0x4232a8); ends after a beat */
export class Kick extends DanceMove {
  static FLAGS = 1; // 0x423554
  start(): void {
    const b = this.body, t = (this.duration = b.tempo);
    const [standThigh, standShin, thigh, shin, s] = pickLeg(b);
    const r = b.rnd.random(15) + 130;
    const d = clear(t, standThigh, standShin);
    thigh.addMovement(t, d, false, 20 * s, 0 - r, 0);
    rest(thigh, t, false);
    shin.addMovement(half(t), d, false, 0, 30, 0);
    rest(shin, half(t), false);
  }
}

/** TSexyKick (VMT 0x422ab0). Start (0x423560): Kick with the shin bent as far as the thigh */
export class SexyKick extends DanceMove {
  static FLAGS = 1; // 0x423820
  start(): void {
    const b = this.body, t = (this.duration = b.tempo);
    const [standThigh, standShin, thigh, shin, s] = pickLeg(b);
    const r = b.rnd.random(15) + 130;
    const d = clear(t, standThigh, standShin);
    thigh.addMovement(t, d, false, 20 * s, 0 - r, 0);
    shin.addMovement(half(t), d, false, 0, r, 0);
    rest(shin, half(t), false);
    rest(thigh, t, false);
  }
}

/** TKickBack (VMT 0x422b18). Start (0x4246c0); ends after a beat (its movements run on for 4) */
export class KickBack extends DanceMove {
  static FLAGS = 1; // 0x424968
  start(): void {
    const b = this.body, t = (this.duration = b.tempo);
    const [standThigh, standShin, thigh, shin, s] = pickLeg(b);
    const r = b.rnd.random(20) + 20;
    const d = clear(t, standThigh, standShin);
    thigh.addMovement(3 * t, d, false, 20 * s, r, 0);
    shin.addMovement(2 * t, d, false, 0, 2 * r, 0);
    rest(shin, t, false);
    rest(thigh, 2 * t, false);
  }
}

/** TCrossLeg (VMT 0x422c54). Start (0x424974); ends after a beat */
export class CrossLeg extends DanceMove {
  static FLAGS = 1; // 0x424c74
  start(): void {
    const b = this.body, rnd = b.rnd, t = (this.duration = b.tempo);
    const [standThigh, standShin, thigh, shin, s] = pickLeg(b);
    const e = rnd.random(20) + 80, p = rnd.random(20) + 70, k = rnd.random(40) + 80;
    const d = clear(t, standThigh, standShin);
    thigh.addMovement(t, d, false, 20 * s, 0 - e, p * s);
    shin.addMovement(half(t), d, false, 0, k, 0);
    rest(shin, t, false);
    rest(thigh, t, false);
  }
}

/** TSpreadStance (VMT 0x422b80). Start (0x42382c): legs out sideways; duration stays 0, so it ends on its first Step */
export class SpreadStance extends DanceMove {
  static FLAGS = 1; // 0x4238f8
  start(): void {
    const b = this.body, t = b.tempo;
    const r = b.rnd.random(15); // through a float32 local: exact
    b.rthigh.addMovement(t, 0, true, 90, r, 0);
    rest(b.rshin, t, true);
    b.lthigh.addMovement(t, 0, true, -90, r, 0);
    rest(b.lshin, t, true);
  }
}

/** TStand (VMT 0x422d94). Start (0x424320): every part to the standing pose over 50 sub-frames, at once; duration
 *  stays 0 */
export class Stand extends DanceMove {
  static FLAGS = 7; // 0x424498
  start(): void {
    const b = this.body;
    for (const p of [b.rthigh, b.lthigh, b.rshin, b.lshin]) rest(p, 50, true);
    b.rarm.addMovement(50, 0, true, 90, 15, 0);
    b.larm.addMovement(50, 0, true, -90, 15, 0);
    b.rforearm.addMovement(50, 0, true, 0, -5, 0);
    b.lforearm.addMovement(50, 0, true, 0, -5, 0);
    for (const p of [b.hip, b.spine, b.head]) rest(p, 50, true);
  }
}

/** TArmFlail (VMT 0x422cbc). Step (0x423da4): never counts, never ends itself */
export class ArmFlail extends DanceMove {
  static FLAGS = 4; // 0x4240d8
  step(): boolean {
    const b = this.body, rnd = b.rnd, t = b.tempo;
    if (b.ratio > 3.5) {
      const flag = rnd.random(16) === 0;
      let s = rnd.random(180);
      let e = rnd.random(100) + 80;
      b.rarm.addMovement(rnd.randomFloat() < 0.75 ? t : 2 * t, 0, flag, e, s, 0 - s);
      b.rforearm.addMovement(threeQuarters(t), 0, flag, -90, rnd.random(180 - s), 0);
      s = rnd.random(180);
      e = rnd.random(100) + 80;
      b.larm.addMovement(rnd.randomFloat() < 0.75 ? t : 2 * t, 0, flag, 0 - e, s, s);
      b.lforearm.addMovement(threeQuarters(t), 0, flag, -90, 0 - rnd.random(half(180 - s)), 0);
    } else if (b.ratio > 3) {
      const flag = rnd.random(16) === 0;
      let s = rnd.random(180);
      b.rforearm.addMovement(threeQuarters(t), 0, flag, -90, rnd.random(half(180 - s)), 0);
      s = rnd.random(180);
      b.lforearm.addMovement(threeQuarters(t), 0, flag, -90, 0 - rnd.random(180 - s), 0);
    }
    return false;
  }
}

/** TSymmetricArmFlail (VMT 0x422d24). Step (0x4240e4): ArmFlail mirrored; never counts, never ends itself */
export class SymmetricArmFlail extends DanceMove {
  static FLAGS = 4; // 0x424314
  step(): boolean {
    const b = this.body, rnd = b.rnd, t = b.tempo;
    let s = rnd.random(180); // drawn every Step, even quiet ones
    if (b.ratio > 3.5) {
      const flag = rnd.random(16) === 0;
      const e = rnd.random(100) + 80;
      const f = rnd.random(180 - s);
      b.rarm.addMovement(t, 0, flag, e, s, 0 - s);
      b.rforearm.addMovement(threeQuarters(t), 0, flag, -90, f, 0);
      b.larm.addMovement(t, 0, flag, 0 - e, s, s);
      b.lforearm.addMovement(threeQuarters(t), 0, flag, -90, 0 - f, 0);
    } else if (b.ratio > 3) {
      const flag = rnd.random(16) === 0;
      s = rnd.random(180);
      const f = rnd.random(180 - s);
      b.rforearm.addMovement(threeQuarters(t), 0, flag, -90, f, 0);
      b.lforearm.addMovement(threeQuarters(t), 0, flag, -90, 0 - f, 0);
    }
    return false;
  }
}

/** TBackFlail (VMT 0x422df8). Step (0x4244cc): never counts, never ends itself; after a flail it waits a beat */
export class BackFlail extends DanceMove {
  static FLAGS = 2; // 0x4246b4
  step(): boolean {
    const b = this.body;
    if (this.extra > 0) {
      this.extra--;
      return false;
    }
    if (!(b.ratio > 2.5)) return false;
    const t = b.tempo;
    this.flail(t, ((3 * t) / 2) | 0, true);
    this.flail(t, half(t), false);
    this.extra = t;
    return false;
  }
  /** spine over a beat to (-90..89, s, -90..89), s = ((0..239) - 90 + (0..119) - 90) / 2; hip b to
   *  Round((randomFloat - 0.5) * s) */
  private flail(t: number, hipDur: number, flag: boolean) {
    const rnd = this.body.rnd;
    const s = half(rnd.random(240) - 90 + (rnd.random(120) - 90));
    const a = rnd.random(180) - 90;
    this.body.spine.addMovement(t, 0, flag, a, s, rnd.random(180) - 90);
    this.body.hip.addMovement(hipDur, 0, flag, 0, delphiRound((rnd.randomFloat() - 0.5) * s), 0);
  }
}
