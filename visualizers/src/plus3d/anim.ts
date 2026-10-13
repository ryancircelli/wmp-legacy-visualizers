// MODEL's key-frame animation as the matrix series use it: an animation model's frames (one per .x Animation, named
// "Anim-<frame>") each drive one frame of the actor's model, binding by name (MODELSET::SetSeries 0x100063b0,
// 0x100065b0); every frame step each sets its model frame's matrix from the two keys around the time
// (MODEL::Animate 0x100041e0, 0x10004230), and a series switch first freezes the current pose into the blend
// model's single keys (0x10004e90, 0x10004eb0) to blend from over half a second. Only matrix keys (the type the
// shipped animations use) are ported; frames with position, rotation or scale keys throw.
import type { Frame, Model } from './model';
import { vec4Normalize } from './math';

const f = Math.fround;

/** the frame named `name` (strcmp), searched from `fr`: itself, its children's subtrees, then its siblings
 *  (0x10006660); here children arrays hold each sibling chain in order */
export function findFrame(fr: Frame, name: string): Frame | null {
  if (fr.name === name) return fr;
  for (const k of fr.children) { const r = findFrame(k, name); if (r) return r; }
  return null;
}

/** 0x100065b0: every animation frame of `anim` bound to the frame of `root` its name (less "Anim-") names */
export function bindFrames(anim: Frame, root: Frame): void {
  if (anim.isAnim && anim.name) anim.bound = findFrame(root, anim.name.slice(5));
  for (const k of anim.children) bindFrames(k, root);
}

const ROW = new Float32Array(16), NRM = new Float32Array(4);
const len4 = (a: ArrayLike<number>, i: number, j: number, k: number, l: number): number =>
  Math.sqrt(((a[i] * a[i] + a[j] * a[j]) + a[k] * a[k]) + a[l] * a[l]);

/** the matrix between keys P and N (time, 16 floats) at s: each row's elements lerped and normalised, times its
 *  lerped length. The first key's first row length stays in a register; the freeze (0x10004eb0) sums the second
 *  key's first row starting from its w. */
function lerpKey(out: Float32Array, o: number, P: ArrayLike<number>, N: ArrayLike<number>, s: number, freeze: boolean): void {
  const p0 = len4(P, 1, 2, 3, 4), p1 = f(len4(P, 5, 6, 7, 8)), p2 = f(len4(P, 9, 10, 11, 12)), p3 = f(len4(P, 13, 14, 15, 16));
  const n0 = f(freeze ? len4(N, 4, 1, 2, 3) : len4(N, 1, 2, 3, 4));
  const n1 = f(len4(N, 5, 6, 7, 8)), n2 = f(len4(N, 9, 10, 11, 12)), n3 = f(len4(N, 13, 14, 15, 16));
  const L = [f((n0 - p0) * s + p0), f((n1 - p1) * s + p1), f((n2 - p2) * s + p2), f((n3 - p3) * s + p3)];
  for (let k = 0; k < 16; k++) ROW[k] = (N[k + 1] - P[k + 1]) * s + P[k + 1];
  for (let r = 0; r < 4; r++) {
    vec4Normalize(NRM, ROW.subarray(r * 4, r * 4 + 4));
    for (let c = 0; c < 4; c++) out[o + r * 4 + c] = NRM[c] * L[r];
  }
}

/** the keys around ms in [0, last): the first key later than t and the one before it (0x10004230 / 0x10004eb0) */
function around(keys: Float32Array[], t: number): [Float32Array, Float32Array] {
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (t < keys[k][0]) { i = k; break; }
  return [keys[i < 1 ? 0 : i - 1], keys[i]];
}

function checkKeys(fr: Frame): void {
  if (fr.posKeys.length || fr.rotKeys.length || fr.scaleKeys.length) throw new Error('plus3d: only matrix keys are ported');
}

/** 0x10004230: from `fr` down (children, then siblings, walked alongside `other`'s), every bound frame's matrix at
 *  time t (seconds); with `other` (the blend model) from its first keys to this one's over half a second. Each frame
 *  sets the model's period (+0x18) to its last key time, or a half second when blending. */
export function animateFrames(fr: Frame, t: number, model: Model, other: Frame | null): void {
  if (fr.bound && fr.matKeys.length) {
    let P: ArrayLike<number>, N: ArrayLike<number>, tm: number, t0: number, t1: number;
    if (other) {
      tm = (t * 1000) % 500; t0 = 0; t1 = 500;
      model.period = 0.5;
      P = other.matKeys[0]; N = fr.matKeys[0];
    } else {
      const keys = fr.matKeys, last = keys[keys.length - 1][0];
      tm = (t * 1000) % last;
      model.period = f(last * 0.001);
      [P, N] = around(keys, tm);
      t0 = P[0]; t1 = N[0];
    }
    const s = t1 - t0 === 0 ? 0 : (tm - t0) / (t1 - t0);
    lerpKey(fr.bound.local, 0, P, N, s, false);
  } else if (fr.bound) checkKeys(fr);
  fr.children.forEach((k, i) => animateFrames(k, t, model, other ? other.children[i] ?? null : null));
}

/** 0x10004eb0: the pose at time t frozen into `dst`'s first keys (time 0), frame by frame alongside */
export function freezeFrames(fr: Frame, t: number, dst: Frame): void {
  if (fr.bound && fr.matKeys.length) {
    const keys = fr.matKeys, last = keys[keys.length - 1][0];
    const tm = (t * 1000) % last;
    const [P, N] = around(keys, tm);
    const s = N[0] - P[0] === 0 ? 0 : (tm - P[0]) / (N[0] - P[0]);
    const d = dst.matKeys[0];
    lerpKey(d, 1, P, N, s, true);
    d[0] = 0;
  } else if (fr.bound) checkKeys(fr);
  fr.children.forEach((k, i) => freezeFrames(k, t, dst.children[i]));
}
