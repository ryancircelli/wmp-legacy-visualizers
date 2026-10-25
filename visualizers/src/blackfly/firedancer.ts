// Alchemy.FireDancer: Blackfly Studios' "Fire Dancer" (FireDancer.dll, 2003; CLSID 235C14A0-D423-11D7-BAB8-0080AD4BAD68,
// Effects key "Fire Dancer"), our own implementation of what that binary does, written from its machine code; frame for
// frame the same pixels. VAs are FireDancer.dll's (TVizFireDancer, VMT 0x4254f0, on the TVizSimple shell).
//
// A dancer made of fire: a skeleton of 39 parts (hip, legs, a 24-vertebra spine, arms, head) whose joints swing
// through queued movements, each part carrying ellipsoid "blobs" that shed short-lived particles. The loudness's
// rise over its own recent spread picks the dance moves, the tempo and the spin. Every frame runs nine sub-steps:
// move the body, respawn and drift the particles, then stamp each particle as a soft 11x17 dot into a 320x384
// 8-bit DIB (black each frame), back to front by depth; every third sub-step the DIB and a persistent copy are
// pulled together (the trails). Then a 2x2 box blur, a palette from three bands of the spectrum (black to colour to
// a darker second colour), and the DIB StretchBlt'd to the window's height, centred (./stretch.ts).
// Randomness: Delphi's System.Random, seeded by Randomize on the first frame (the `seed` option is that RandSeed).
// Its clock (GetTickCount pacing to 40 ms) does not touch the pixels.
import { A, type Surface, type TimedLevel } from '../ns';
import { mulExt, sincos87 } from '../plenoptic/x87';
import { BlackflyViz, delphiRound, type BlackflyConfig } from './common';
import {
  ArmFlail, BackFlail, CrossLeg, FootWork, Kick, KickBack, LegFlail, March, SexyKick, SideStep, SpreadStance, Stand,
  SymmetricArmFlail, type DanceMove, type MoveBody, type MoveClass,
} from './firedancer-moves';
import { stretchPresent } from './stretch';

const PRESET_NAMES = ['Fire Dancer'];
const DW = 320, DH = 384;

// Delphi's extended literals as hi + lo doubles (FLD TBYTE)
const PI_H = 3.1415926535, PI_L = -5.421010862427522e-17;        // 3.1415926535
const PI2_H = 6.283185307, PI2_L = -1.0842021724855044e-16;      // 6.283185307
const FIFTH_H = 0.2, FIFTH_L = -1.1099519740820352e-17;          // 0.2
const RISE_H = 0.00095, RISE_L = 1.9058241313221758e-21;         // 0.00095
const SIXTIETH = 0.016666666666666666;                           // 1/60: the extended one sits just above this double

/** a + (hi + lo) rounded once to a double (FADD of an extended constant at 53-bit precision).
 *  ponytail: e + lo is itself rounded, which could only flip an exact tie; none is expected for these values. */
function addExt(a: number, hi: number, lo: number): number {
  const s = a + hi, bb = s - a, e = (a - (s - bb)) + (hi - bb);
  return s + (e + lo);
}

const SC = new Float64Array(4);

// TMatrix (VMT 0x41f510): 16 doubles, row vectors (translation in 12..14); angles in degrees through a table
let SIN: Float64Array | null = null;
/** the table 0x429af4: sin of i/100 degrees, i < 36000, built with the literal 3.1415926535 at 53-bit precision */
function sinTable(): Float64Array {
  if (!SIN) {
    SIN = new Float64Array(36000);
    for (let i = 0; i < 36000; i++) {
      sincos87(mulExt(i, PI_H, PI_L) / 18000, SC);
      SIN[i] = SC[0] + SC[1];
    }
  }
  return SIN;
}
/** 0x41f5e8 / 0x41f518: the angle into [0, 360), then table[Trunc(a * 100) (+ 9000 for cos) mod 36000] */
function tableIndex(a: number): number {
  if (a >= 360) a -= 360 * Math.trunc(a / 360);
  else if (a < 0) a += 360 * (Math.trunc(-a / 360) + 1);
  return Math.trunc(a * 100);
}
function sinD(a: number): number { return SIN![tableIndex(a) % 36000]; }
function cosD(a: number): number { return SIN![(tableIndex(a) + 9000) % 36000]; }

function identity(m: Float64Array): void {
  m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
}
/** 0x41f6fc */
function translate(m: Float64Array, x: number, y: number, z: number): void {
  for (let j = 0; j < 4; j++) m[12 + j] = ((m[j] * x + m[4 + j] * y) + m[8 + j] * z) + m[12 + j];
}
/** 0x41f77c */
function rotX(m: Float64Array, a: number): void {
  const s = sinD(a), c = cosD(a);
  for (let j = 0; j < 4; j++) {
    const t = m[4 + j];
    m[4 + j] = t * c + m[8 + j] * s;
    m[8 + j] = m[8 + j] * c - t * s;
  }
}
/** 0x41f870 */
function rotY(m: Float64Array, a: number): void {
  const s = sinD(a), c = cosD(a);
  for (let j = 0; j < 4; j++) {
    const t = m[j];
    m[j] = t * c - m[8 + j] * s;
    m[8 + j] = m[8 + j] * c + t * s;
  }
}

/** TParticle (VMT 0x42558c) */
class Particle {
  x = 0; y = 0; z = 0;            // +8 +0xc +0x10, float32
  vx = 0; vy = 0; vz = 0;         // +0x14 +0x18 +0x1c, float32
  cx = 0; cy = 0;                 // +0x20 +0x24: the screen centre it is drawn about
  ox = 0; oy = 0;                 // +0x28 +0x2c, float32: its blob's centre, where it was born
  tx = 0; tz = 0;                 // +0x30 +0x34, float32: where x and z drift to
  life = 0; age = 0;              // +0x3c +0x40
  next: Particle | null = null;   // +0x44: the depth bucket's list

  /** 0x426e60 */
  step(fd: FireDancer): void {
    const r = fd.rnd, f = Math.fround;
    this.y = f(this.y + this.vy);
    let n = (r.randomFloat() - 0.5) / 100;
    this.x = f(n + (this.x + this.vx));
    n = (r.randomFloat() - 0.5) / 100;
    this.z = f(n + (this.z + this.vz));
    this.x = f((this.x * 23 + this.tx) / 24);
    this.z = f((this.z * 23 + this.tz) / 24);
    this.age++;
    this.vy = f(addExt(this.vy, RISE_H, RISE_L));
    this.vx = f((fd.drag * this.vx) / 8);
    this.vz = f((fd.drag * this.vz) / 8);
  }
}

/** TFireBlob (VMT 0x4255e8) on TBlob (0x422360): an ellipsoid on a part, centre and radii in the part's frame */
class Blob {
  readonly particles: Particle[] = [];
  constructor(readonly part: Part, readonly x: number, readonly y: number, readonly z: number,
    readonly rx: number, readonly ry: number, readonly rz: number, type: number) {
    // 0x4269fc: 50 particles (type 1), 200 (type 2), else 10 on a vertebra and 100 elsewhere
    const n = type === 1 ? 50 : type === 2 ? 200 : part.vertebra ? 10 : 100;
    for (let i = 0; i < n; i++) this.particles.push(new Particle());
  }

  /** 0x426bb8: a new particle somewhere on the ellipsoid's surface scaled by three random radii */
  respawn(p: Particle, fd: FireDancer): void {
    const r = fd.rnd, f = Math.fround, m = this.part.m;
    const r1 = r.randomFloat() * this.rx, r2 = r.randomFloat() * this.ry, r3 = r.randomFloat() * this.rz;
    const a1 = f(mulExt(r.randomFloat(), PI2_H, PI2_L)), a2 = f(mulExt(r.randomFloat(), PI2_H, PI2_L));
    sincos87(a1, SC);
    const dz = mulExt(r3, SC[2], SC[3]);
    const s = f(SC[0] + SC[1]);
    sincos87(a2, SC);
    let px = mulExt(r1, SC[2], SC[3]) * s + this.x;
    let py = mulExt(r2, SC[0], SC[1]) * s + this.y;
    let pz = dz + this.z;
    // 0x41f9b8, the point and the centre into the world
    let x = px, y = py, z = pz;
    px = ((x * m[0] + y * m[4]) + z * m[8]) + m[12];
    py = ((x * m[1] + y * m[5]) + z * m[9]) + m[13];
    pz = ((x * m[2] + y * m[6]) + z * m[10]) + m[14];
    x = this.x; y = this.y; z = this.z;
    const cx = ((x * m[0] + y * m[4]) + z * m[8]) + m[12];
    const cy = ((x * m[1] + y * m[5]) + z * m[9]) + m[13];
    const cz = ((x * m[2] + y * m[6]) + z * m[10]) + m[14];
    p.age = 0;
    p.life = r.random(27) + 5;
    p.x = f(px);
    p.y = f(py - fd.floor);
    p.z = f(pz);
    p.ox = f(cx);
    p.oy = f(cy);
    let d = r.random(1800) + fd.spread;
    p.vx = f((r.randomFloat() - 0.5) / d);
    p.vy = f((r.randomFloat() - 0.5) / 1800);
    d = r.random(1800) + fd.spread;
    p.vz = f((r.randomFloat() - 0.5) / d);
    p.tx = f((cx + px) / 3.5);
    p.tz = f((cz + pz) / 3.5);
    if (px < cx) p.vx = -p.vx;
    if (py < cy) p.vy = -p.vy;
    if (pz < cz) p.vz = -p.vz;
  }

  /** 0x426b20: respawn the spent, step all, file each in its depth bucket (Round(z * 256), -256..256) */
  draw(fd: FireDancer, cx: number, cy: number): void {
    const buckets = fd.buckets;
    for (const p of this.particles) {
      if (p.age > p.life) this.respawn(p, fd);
      p.step(fd);
      p.cx = cx; p.cy = cy;
      let b = delphiRound(p.z * 256);
      if (b < -256) b = -256; else if (b > 256) b = 256;
      p.next = buckets[b + 256];
      buckets[b + 256] = p;
    }
  }
}

interface Movement { dur: number; delay: number; a: number; b: number; c: number }

const enum Kind { Plain, Thigh, Spine }

/** TBodyPart (VMT 0x41fc60) */
class Part {
  moving = false;                          // +4
  readonly children: Part[] = [];          // +8
  readonly m = new Float64Array(16);       // +0xc (its blobs' matrices are copies of it)
  readonly blobs: Blob[] = [];             // +0x10
  readonly queue: Movement[] = [];         // +0x14
  altC = 0; altB = 0; altA = 0;            // +0x18 +0x20 +0x28: the angles used instead when `alt` (+0x30)
  alt = false;
  sa = 0; sb = 0; sc = 0;                  // +0x38 +0x40 +0x48: start
  ta = 0; tb = 0; tc = 0;                  // +0x50 +0x58 +0x60: target
  step = 0; dur = 0; delay = 0;            // +0x68 +0x6c +0x70
  parent: Part | null = null;              // +0x74
  ox = 0; oy = 0; oz = 0;                  // +0xa0 +0xa8 +0xb0: offset in the parent's frame
  wy = 0;                                  // +0xc0: world height (+0xb8.. hold the world position)
  rz = 0; rx = 0; ry = 0;                  // +0xd0 +0xd8 +0xe0: current angles
  constructor(readonly kind: Kind, readonly vertebra = false) {
    this.alt = kind !== Kind.Plain;
  }

  /** 0x4205f4 */
  add(child: Part, x: number, y: number, z: number): Part {
    this.children.push(child);
    child.parent = this;
    child.ox = x; child.oy = y; child.oz = z;
    return child;
  }

  /** 0x420a20: a = target of ry (+0xe0), b of rx (+0xd8), c of rz (+0xd0) */
  addMovement(dur: number, delay: number, flag: boolean, a: number, b: number, c: number): void {
    if (this.moving && !flag) { this.queue.push({ dur, delay, a, b, c }); return; }
    this.begin(dur, delay, a, b, c);
    if (flag) this.queue.length = 0;
  }

  private begin(dur: number, delay: number, a: number, b: number, c: number): void {
    this.dur = dur; this.step = 0;
    this.sa = this.ry; this.sb = this.rx; this.sc = this.rz;
    this.ta = a; this.tb = b; this.tc = c;
    this.delay = delay;
    this.moving = true;
  }

  /** 0x4208dc */
  update(): void {
    if (this.moving) {
      if (this.delay > 0) { this.delay--; return; }
      this.step++;
      const f = this.step / this.dur, g = 1 - f;
      this.ry = this.sa * g + this.ta * f;
      this.rx = this.sb * g + this.tb * f;
      this.rz = this.sc * g + this.tc * f;
      if (this.dur <= this.step) this.moving = false;
    }
    if (!this.moving && this.queue.length > 0) {
      const q = this.queue.shift()!;
      this.begin(q.dur, q.delay, q.a, q.b, q.c);
    }
  }

  /** VMT slot 2: 0x420648, with the thighs' (0x4210dc) and the spine's (0x4214bc) preludes */
  compute(): void {
    if (this.kind === Kind.Thigh) {
      this.altB = this.rx - this.parent!.rx; this.altA = this.ry; this.altC = this.rz;
    } else if (this.kind === Kind.Spine) {
      // the bend and twist spread evenly down the 24 vertebrae; the spine itself stays straight
      let v = this.children[0];
      for (let i = 0; i < 24; i++) {
        v.ry = this.ry; v.rx = this.rx / 24; v.rz = this.rz / 24;
        v = v.children[0];
      }
      this.altA = this.altB = this.altC = 0;
    }
    const m = this.m;
    if (this.parent) m.set(this.parent.m);
    translate(m, this.ox, this.oy, this.oz);
    this.wy = m[13];
    const a = this.alt ? this.altA : this.ry, b = this.alt ? this.altB : this.rx, c = this.alt ? this.altC : this.rz;
    if (a !== 0) rotY(m, a);
    if (b !== 0) rotX(m, b);
    if (c - a !== 0) rotY(m, c - a);
  }
}

// The skeleton (TBasicBody.Build, 0x420c4c, and the parts' constructors). Blobs: [x, y, z, rx, ry, rz, type].
type BlobDef = number[];
const HIP_BLOBS: BlobDef[] = [[0, -0.01, 0.01, 0.1, 0.075, 0.05, 0], [-0.05, -0.04, -0.02, 0.08, 0.085, 0.075, 0], [0.05, -0.04, -0.02, 0.08, 0.085, 0.075, 0]];
const thighBlobs = (s: number): BlobDef[] => [[0.03 * s, -0.135, -0.01, 0.07, 0.24, 0.07, 2]];
const shinBlobs = (s: number): BlobDef[] => [[0.05 * s, -0.19, 0, 0.035, 0.175, 0.025, 0], [0.03 * s, -0.13, -0.01, 0.04, 0.09, 0.035, 0]];
const ARM_BLOBS: BlobDef[] = [[0, -0.11, 0, 0.03, 0.15, 0.03, 0]];
const FOREARM_BLOBS: BlobDef[] = [[0, -0.12, 0, 0.03, 0.12, 0.02, 0]];
const HEAD_BLOBS: BlobDef[] = [[0, 0.08, 0.045, 0.07, 0.1, 0.08, 0]];
/** the spine (TSpine, 0x421574): each vertebra's offset from the one below [y, z], then its blobs */
const VERTEBRAE: [number, number, BlobDef[]][] = [
  [0, 0, [[0, 0, 0.015, 0.095, 0.09, 0.04, 0]]],
  [0.022916666666666665, 0.010026041666666667, [[0, 0, 0.01, 0.08, 0.09, 0.03, 0]]],
  [0.022200520833333334, 0.004296875, [[0, 0, 0.01, 0.075, 0.09, 0.03, 0]]],
  [0.021484375, 0, [[0, 0, 0.01, 0.075, 0.09, 0.03, 0]]],
  [0.020768229166666666, -0.005729166666666666, [[0, 0, 0.0125, 0.075, 0.09, 0.03, 0]]],
  [0.020052083333333335, -0.00859375, [[0, 0, 0.0125, 0.08, 0.08, 0.035, 0]]],
  [0.0193359375, -0.00859375, [[0, 0, 0.015, 0.085, 0.08, 0.04, 0]]],
  [0.018619791666666666, -0.0064453125, [[0, 0, 0.0175, 0.09, 0.08, 0.045, 0]]],
  [0.017903645833333332, -0.004296875, [[0, 0, 0.02375, 0.095, 0.08, 0.0575, 0]]],
  [0.0171875, -0.002864583333333333, [[0, 0, 0.02, 0.1, 0.08, 0.05, 0]]],
  [0.016471354166666667, -0.0014322916666666666, [[0, 0, 0.0225, 0.1, 0.08, 0.055, 0]]],
  [0.015755208333333333, 0, [[0, 0, 0.025, 0.1, 0.08, 0.06, 0], [-0.05, 0, 0.065, 0.055, 0.055, 0.07, 1], [0.05, 0, 0.065, 0.055, 0.055, 0.07, 1]]],
  [0.0150390625, 0.0014322916666666666, [[0, 0, 0.0255, 0.1, 0.07, 0.055, 0]]],
  [0.014322916666666666, 0.002864583333333333, [[0, 0, 0.025, 0.09, 0.06, 0.05, 0]]],
  [0.013606770833333334, 0.0035807291666666665, [[0, 0, 0.0125, 0.08, 0.05, 0.035, 0]]],
  [0.012890625, 0.004296875, [[0, 0, 0.01, 0.07, 0.04, 0.03, 0]]],
  // the shoulders (TSpine +0xe8)
  [0.012174479166666667, 0.0035807291666666665, [[0, 0, 0.0075, 0.06, 0.03, 0.025, 0], [-0.08, -0.035, 0, 0.05, 0.045, 0.03, 0], [0.08, -0.035, 0, 0.05, 0.045, 0.03, 0]]],
  [0.011458333333333333, 0.002864583333333333, [[0, 0, 0.01, 0.04, 0.05, 0.03, 0]]],
  [0.0107421875, 0.0021484375, [[0, 0, 0.01, 0.03, 0.05, 0.03, 0]]],
  [0.010026041666666667, 0.0014322916666666666, [[0, 0, 0.01, 0.0275, 0.05, 0.0275, 0]]],
  [0.009309895833333333, 0.0007161458333333333, [[0, 0, 0.01, 0.025, 0.05, 0.025, 0]]],
  [0.00859375, 0.0007161458333333333, [[0, 0, 0.01, 0.0225, 0.05, 0.0225, 0]]],
  [0.007877604166666666, -0.0021484375, [[0, 0, 0.015, 0.02, 0.06, 0.025, 0]]],
  // the top (TSpine +0xec)
  [0.007161458333333333, -0.0014322916666666666, [[0, 0, 0.015, 0.025, 0.06, 0.0275, 0]]],
];

const MOVE_BY_ROLL: MoveClass[] = [SpreadStance, SpreadStance, CrossLeg, KickBack, SideStep, SideStep, SideStep, March,
  LegFlail, LegFlail, LegFlail, FootWork, FootWork, FootWork, FootWork, FootWork, SexyKick, SexyKick, Kick, Kick];

/** TDancer (VMT 0x42039c) on TBasicBody (0x4202d0) */
class Dancer implements MoveBody {
  readonly parts: Part[] = [];             // +4, in the order they were made
  rot = 0;                                 // +0x18, degrees
  readonly scale = 200;                    // +0x20
  readonly hipWidth = 0.21;                // +0x70
  readonly shoulderWidth = 0.2;            // +0x78
  readonly slots: (DanceMove | null)[] = [null, null, null];   // +0x80..+0x88
  spin = 0;                                // +0x8c, float32
  tempo = 200;                             // +0x90
  ratio = 0;                               // +0x94, float32
  declare hip: Part; declare rthigh: Part; declare lthigh: Part; declare rshin: Part; declare lshin: Part;
  declare rfoot: Part; declare lfoot: Part; declare spine: Part; declare rarm: Part; declare larm: Part;
  declare rforearm: Part; declare lforearm: Part; declare rhand: Part; declare lhand: Part; declare head: Part;

  constructor(readonly fd: FireDancer) {
    sinTable();
    this.build();
  }
  get rnd() { return this.fd.rnd; }

  private part(kind: Kind, blobs: BlobDef[], vertebra = false): Part {
    const p = new Part(kind, vertebra);
    this.parts.push(p);
    for (const [x, y, z, rx, ry, rz, t] of blobs) p.blobs.push(new Blob(p, x, y, z, rx, ry, rz, t));
    return p;
  }

  /** 0x420c4c */
  private build(): void {
    const P = Kind.Plain;
    const hip = (this.hip = this.part(P, HIP_BLOBS));
    hip.oy = 0.5;
    this.rthigh = hip.add(this.part(Kind.Thigh, thighBlobs(1)), -this.hipWidth / 2, -0.05, 0.0125);
    this.lthigh = hip.add(this.part(Kind.Thigh, thighBlobs(-1)), this.hipWidth / 2, -0.05, 0.0125);
    this.rshin = this.rthigh.add(this.part(P, shinBlobs(1)), 0, -0.31666666666666665, -0.0125);
    this.lshin = this.lthigh.add(this.part(P, shinBlobs(-1)), 0, -0.31666666666666665, -0.0125);
    this.rfoot = this.rshin.add(this.part(P, []), 0, -0.31666666666666665, 0);
    this.lfoot = this.lshin.add(this.part(P, []), 0, -0.31666666666666665, 0);
    const spine = (this.spine = hip.add(this.part(Kind.Spine, []), 0, 0, 0));
    let v = spine, shoulders = spine;
    for (const [y, z, blobs] of VERTEBRAE) {
      v = v.add(this.part(P, blobs, true), 0, y, z);
      if (blobs.length === 3 && blobs[1][1] < 0) shoulders = v;
    }
    this.rarm = shoulders.add(this.part(P, ARM_BLOBS), -this.shoulderWidth / 2, 0, 0);
    this.larm = shoulders.add(this.part(P, ARM_BLOBS), this.shoulderWidth / 2, 0, 0);
    this.head = v.add(this.part(P, HEAD_BLOBS), 0, 0.007291666666666667, 0);
    this.rforearm = this.rarm.add(this.part(P, FOREARM_BLOBS), 0, -0.2, -0);
    this.lforearm = this.larm.add(this.part(P, FOREARM_BLOBS), 0, -0.2, -0);
    this.rhand = this.rforearm.add(this.part(P, []), 0, -0.2, 0);
    this.lhand = this.lforearm.add(this.part(P, []), 0, -0.2, 0);
    this.larm.rx = 15; this.larm.ry = -90;
    this.rarm.rx = 15; this.rarm.ry = 90;
    this.lforearm.rx = -5;
    this.rforearm.rx = -5;
  }

  /** 0x4227f0: a move of a class not already running, displacing those whose flags overlap its own */
  addMove(cls: MoveClass): void {
    const s = this.slots;
    for (let i = 0; i < 3; i++) if (s[i] && s[i]!.constructor === cls) return;
    for (let i = 0; i < 3; i++) if (s[i] && s[i]!.flags() & cls.FLAGS) s[i] = null;
    for (let i = 0; i < 3; i++) {
      if (!s[i]) {
        const mv = new cls(this);
        mv.start();
        s[i] = mv;
        return;
      }
    }
  }
  /** 0x4227c0: no move with flag 1 (the legs) running */
  idle(): boolean {
    for (const m of this.slots) if (m && m.flags() & 1) return false;
    return true;
  }
  /** VMT slot 3, 0x422788 */
  stepMoves(): void {
    const s = this.slots;
    for (let i = 0; i < 3; i++) if (s[i] && s[i]!.step()) s[i] = null;
  }

  /** VMT slot 0, 0x420b04: the skeleton's matrices (0x4203b4), then the floor eased up toward the lower foot + 0.2
   *  (it falls at once) */
  compute(): void {
    const hip = this.parts[0], fd = this.fd;
    identity(hip.m);
    rotY(hip.m, this.rot);
    for (const p of this.parts) p.compute();
    if (fd.floor <= SIXTIETH) fd.floor = SIXTIETH;
    const a = this.lfoot.wy, b = this.rfoot.wy;
    const f = addExt(a < b ? a : b, FIFTH_H, FIFTH_L);
    if (f > fd.floor) { fd.lift += 0.0009765625; fd.floor += fd.lift; }
    if (fd.floor > f) { fd.floor = f; fd.lift = 0; }
  }

  /** VMT slot 2, 0x420494: the parts' movements, the matrices, then every blob's particles */
  draw(cx: number, cy: number): void {
    for (const p of this.parts) p.update();
    this.compute();
    for (const p of this.parts) for (const b of p.blobs) b.draw(this.fd, cx, cy);
  }
}

// the three colour bands' bytes to the palette's colour (0x425a18): red 128 + v/2, green squared, blue as a cosine
const RED = new Uint8Array(256), GREEN = new Uint8Array(256), BLUE = new Uint8Array(256);
for (let v = 0; v < 256; v++) {
  const t = v / 255;
  RED[v] = delphiRound(t * 127) + 0x80;
  GREEN[v] = delphiRound(t * t * 255);
  sincos87(mulExt(t, PI_H, PI_L), SC);
  const h = SC[2], l = SC[3];
  BLUE[v] = delphiRound(A.fma(h, h, 2 * h * l) * 255);
}

class FireDancer extends BlackflyViz {
  static PRESET_NAMES: string[] = PRESET_NAMES;
  /** +0xae8: the frame drawn each frame; +0xaec: its persistent twin (the trails) */
  dib8 = new Uint8Array(DW * DH);
  dib8b = new Uint8Array(DW * DH);
  pal = new Uint32Array(256);
  dancer: Dancer | null = null;            // +0x74
  /** 0x470024: the depth buckets' heads, -256..256 */
  readonly buckets: (Particle | null)[] = new Array<Particle | null>(513).fill(null);
  /** globals 0x470008 / 0x470010: the floor height and its rise */
  floor = 0;
  lift = 0;
  /** globals 0x470830 (float32) / 0x470828: the particles' sideways drag and the spread of their speeds */
  drag = 7;
  spread = 0x40;
  private started = false;                 // +0x60
  private resting = true;                  // +0x6c
  private quiet = 0;                       // +0x70
  private holdN = 0;                       // +0x64
  private holdRatio = 0;                   // +0x68, float32
  private readonly prev = new Uint8Array(2048);    // +0x95
  private readonly hist = new Int32Array(128);     // +0x898
  private histAt = 0;                      // +0xa98
  private readonly band = new Float64Array(3);     // +0xaa0.., smoothed
  private readonly scaleBy = new Float64Array(3);  // +0xab8.., 255 / max
  private readonly peak = new Float64Array(3);     // +0xad0.., the maxima
  private spreadL = 0;                     // +0xaf0
  private beat = 0;                        // +0xaf8
  /** +0x7c..: the dot (4256fc(11, 17)): per row [start, length] */
  private readonly brush = new Int32Array(34);

  constructor(cfg?: BlackflyConfig) {
    super(cfg || {}, PRESET_NAMES.length);
  }

  protected resized(): void {
    this.front = new Uint32Array(this.w * this.h);
  }

  /** 0x4256fc: an 11 x 17 ellipse-ish dot, narrower at the bottom; rows centred on 5 */
  private makeBrush(w: number, h: number): void {
    const f = Math.fround;
    for (let k = 0; k < h; k++) {
      const t = f((k + 1) / (h + 1)), u = f(2 * t - 1);
      let v = f(Math.sqrt(t) * Math.sqrt(1 - u * u));
      v = f((w * v) / 2);
      const start = delphiRound(w / 2 - v);
      this.brush[2 * k] = start;
      this.brush[2 * k + 1] = w - 2 * start;
    }
  }

  /** 0x4258a0: how much louder the spectrum got (sum over bins of the rises), kept in a 128-frame history */
  private rise(f0: Uint8Array, f1: Uint8Array): number {
    const prev = this.prev;
    let sum = 0;
    for (let i = 0; i < 1024; i++) {
      const now = (f0[i] + f1[i]) >> 1, was = (prev[i] + prev[1024 + i]) >> 1;
      if (was < now) sum += (2 * now - was) >> 1;
    }
    prev.set(f0, 0); prev.set(f1, 1024);
    this.hist[this.histAt] = sum;
    if (++this.histAt >= 128) this.histAt = 0;
    return sum;
  }

  /** 0x425980: the history's standard deviation, rounded */
  private deviation(): void {
    let s = 0;
    for (let i = 0; i < 128; i++) s += this.hist[i];
    const mean = s / 128;
    let q = 0;
    for (let i = 0; i < 128; i++) { const d = this.hist[i] - mean; q = d * d + q; }
    this.spreadL = delphiRound(Math.sqrt(q / 127));
  }

  /** 0x425da4: a leg move by loudness, at most every 15 frames unless louder than the last pick */
  private pickMove(ratio: number): void {
    if (this.holdN > 0) {
      this.holdN--;
      if (!(ratio > this.holdRatio)) return;
    }
    this.holdRatio = ratio; this.holdN = 15;
    const r = this.rnd;
    const n = ratio >= 9 ? r.random(2) + 18 : ratio >= 8 ? r.random(16) + 4 : ratio >= 6 ? r.random(20) : r.random(13);
    this.dancer!.addMove(MOVE_BY_ROLL[n]);
  }
  /** 0x425f84 */
  private pickArms(): void {
    this.dancer!.addMove(this.rnd.random(10) < 4 ? ArmFlail : SymmetricArmFlail);
  }

  /** 0x425a18: three bands (bins 0-511, 256-767, 512-1023 of both channels) smoothed, scaled by their peaks, into
   *  the palette's two colours (COLORREFs) */
  private colours(f0: Uint8Array, f1: Uint8Array): [number, number] {
    const lo = [0, 256, 512];
    const v = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let i = lo[k]; i < lo[k] + 512; i++) s = (f0[i] + s) + f1[i];
      const b = (this.band[k] = (this.band[k] * 255 + s / 1024) / 256);
      if (b > this.peak[k]) { this.peak[k] = b; this.scaleBy[k] = 255 / b; }
      const c = delphiRound(b * this.scaleBy[k]);
      v[k] = c > 255 ? 255 : c;
    }
    const r = RED[v[0]], g = GREEN[v[1]], b = BLUE[v[2]];
    const c1 = r | g << 8 | b << 16;
    const c2 = this.preset === 0 ? (r >> 2) | (g >> 3) << 8 | ((b / 6) | 0) << 16 : 0;
    return [c1, c2];
  }

  /** 0x41f1c0(dib, 0, c1, c2): entries 0-127 black to c1, 128-255 from c1 to c2 */
  private palette(c1: number, c2: number): void {
    const pal = this.pal;
    const ch = (c: number, s: number) => (c >>> s) & 255;
    for (let i = 0; i < 128; i++) {
      const a = 255 - 2 * i, b = 2 * i;
      pal[i] = (((b * ch(c1, 0)) / 255) | 0) << 16 | (((b * ch(c1, 8)) / 255) | 0) << 8 | (((b * ch(c1, 16)) / 255) | 0);
      pal[255 - i] = (((a * ch(c2, 0) + b * ch(c1, 0)) / 255) | 0) << 16 |
        (((a * ch(c2, 8) + b * ch(c1, 8)) / 255) | 0) << 8 | (((a * ch(c2, 16) + b * ch(c1, 16)) / 255) | 0);
    }
  }

  /** stamp every particle, far buckets first, each bucket newest first (0x426600..0x4267a0) */
  private stamp(): void {
    const d = this.dib8, br = this.brush, sc = this.dancer!.scale, bk = this.buckets;
    for (let b = -256; b <= 256; b++) {
      for (let p = bk[b + 256]; p; p = p.next) {
        const x0 = delphiRound(p.x * sc) + p.cx;
        const y0 = delphiRound((1 - p.y) * sc) + p.cy;
        const dx = p.x - p.ox, dy = p.y - p.oy;
        const dist = delphiRound(Math.fround(Math.sqrt(dx * dx + dy * dy) * 200));
        let v = ((((255 - 2 * p.age) - (128 - ((b + 256) >> 2))) - dist) * 13 / 10) | 0;
        v = v > 255 ? 255 : v < 0 ? 0 : v;
        const add = ((32 - p.age) & 255) * v, age = p.age;
        for (let k = 0, y = y0 - 8; k < 17; k++, y++) {
          if (y < 0 || y >= DH) continue;
          const xs = x0 + br[2 * k] - 5;
          if (xs < 0 || xs >= DW) continue;          // GetPixelPtr gives nil: the whole row is skipped
          const row = y * DW, end = row + Math.min(xs + br[2 * k + 1], DW);
          for (let i = row + xs; i < end; i++) d[i] = (d[i] * age + add) >>> 5;   // the byte store wraps
        }
      }
    }
  }

  /** 0x4255fc: where the frame and its twin differ, both become (3 twin + frame) / 4 */
  private merge(): void {
    const a = this.dib8, b = this.dib8b;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) a[i] = b[i] = ((b[i] << 2) + (a[i] - b[i])) >> 2;
    }
  }

  /** 0x425684: each pixel but the last row and column the mean of its 2x2 block (truncated) */
  private blur(): void {
    const d = this.dib8;
    for (let y = 0; y < DH - 1; y++) {
      for (let x = 0, i = y * DW; x < DW - 1; x++, i++) d[i] = (d[i] + d[i + DW] + d[i + DW + 1] + d[i + 1]) >> 2;
    }
  }

  /** TVizFireDancer.Render (0x425fcc) */
  render(tl: TimedLevel): Surface {
    if (this.viewW !== this.w || this.viewH !== this.h) {
      this.w = this.viewW; this.h = this.viewH;
      this.resized();
    }
    const [f0, f1] = tl.freq, r = this.rnd;
    if (!this.started) {
      this.started = true;
      this.resting = true; this.quiet = 0;
      this.peak.set([64, 16, 4]);
      for (let k = 0; k < 3; k++) this.scaleBy[k] = 255 / this.peak[k];
      this.spread = 0x40; this.drag = 7;
    }
    this.dib8.fill(0);                                     // PatBlt BLACKNESS
    if (!this.dancer) {
      this.dancer = new Dancer(this);
      this.beat = 100; this.dancer.tempo = 200;
      this.makeBrush(11, 17);
      // then Randomize: RandSeed from the clock, which the `seed` option stands for
    }
    if (this.preset === 0) { this.drag = 7; this.spread = 0x20; } else { this.drag = 9; this.spread = 0x140; }
    const lv = this.rise(f0, f1);
    this.deviation();
    let ratio: number;
    if (this.spreadL === 0) { this.spreadL = lv; ratio = 1; } else ratio = Math.fround(lv / this.spreadL);
    let t = Math.trunc((120000 - 8 * this.spreadL) / 1200);
    if (t < 25) t = 25;
    this.beat = Math.trunc((this.beat * 7 + t) / 8);
    const d = this.dancer;
    d.tempo = this.beat * 2;
    d.ratio = ratio;
    if (ratio > 7.5) {
      if (d.spin > 0.25) d.spin = ratio;
      else if (d.spin < -0.25) d.spin = -ratio;
      else d.spin = r.random(2) === 0 ? ratio / 2 : -ratio / 2;
    }
    if (ratio > 5 && !this.resting) this.pickArms();
    if ((ratio > 4 || d.idle()) && !this.resting) this.pickMove(ratio);
    if (lv === 0) {
      if (!this.resting) {
        if (++this.quiet > 10) { d.addMove(Stand); this.resting = true; this.quiet = 0; }
      } else this.quiet = 0;
    } else {
      this.quiet = 0;
      if (this.resting) { d.addMove(BackFlail); this.pickMove(ratio); this.pickArms(); this.resting = false; }
    }
    for (let k = 1; k <= 9; k++) {
      this.buckets.fill(null);
      d.rot = d.rot + d.spin;
      d.spin = Math.fround((d.spin * 199) / 200);
      if (d.rot > 180) d.rot -= 360;
      if (d.rot < -180) d.rot += 360;
      d.rot = (1023 * d.rot) / 1024;
      d.stepMoves();
      d.draw(160, 120);
      this.stamp();
      if (k % 3 === 0) this.merge();
    }
    this.blur();
    const [c1, c2] = this.colours(f0, f1);
    this.palette(c1, c2);
    stretchPresent(this.dib8, this.pal, this.w, this.h, this.front);
    this.frame++;
    return { w: this.w, h: this.h, px: this.front };
  }

  protected draw(): void {}
}

declare module '../ns' {
  interface AlchemyNS {
    FireDancer: typeof FireDancer;
  }
}
A.FireDancer = FireDancer;
