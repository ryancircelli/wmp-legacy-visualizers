// Plus! 3-D's matrix animation (src/plus3d/anim.ts): an animation model's frames binding by name, the matrix between
// two keys (rows lerped and renormalised, times their lerped lengths), the pose frozen at a series switch and the
// half-second blend out of it.
import { describe, expect, it } from 'vitest';
import { Frame, Model } from '../src/plus3d/model';
import { animateFrames, bindFrames, freezeFrames } from '../src/plus3d/anim';
import { vec4Normalize } from '../src/plus3d/math';

const f = Math.fround;
/** a key: time (ms), then a scaled rotation about z by a and a translation */
function key(t: number, a: number, s: number, tx: number): Float32Array {
  const c = Math.cos(a) * s, n = Math.sin(a) * s;
  return Float32Array.from([t, c, n, 0, 0, -n, c, 0, 0, 0, 0, s, 0, tx, 0, 0, 1]);
}
/** the DLL's in-between: each row lerped then normalised, times the lerp of the two rows' lengths (row 3 included,
 *  its w too) */
function between(P: Float32Array, N: Float32Array, s: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    const p = Array.from(P.subarray(1 + r * 4, 5 + r * 4)), n = Array.from(N.subarray(1 + r * 4, 5 + r * 4));
    const len = (v: number[]): number => Math.hypot(...v), row = p.map((x, i) => x + (n[i]! - x) * s), l = len(p) + (len(n) - len(p)) * s;
    out.push(...row.map((x) => (x / len(row)) * l));
  }
  return out;
}
function rig(keys: Float32Array[]): { model: Frame; anim: Model } {
  const model = new Frame(null), arm = new Frame('arm');
  model.children = [arm];
  const set = new Frame(null), a = new Frame('Anim-arm');
  set.isAnim = true; a.isAnim = true; a.matKeys = keys;
  set.children = [a];
  const anim = new Model({ handle: -1 }, { handle: -1 });
  anim.root = new Frame(null); anim.root.children = [set];
  bindFrames(anim.root, model);
  return { model, anim };
}

describe('Plus! 3-D matrix animation', () => {
  it('Vec4Normalize: unit vectors copied, tiny ones zero, the rest over the float length', () => {
    const o = new Float32Array(4);
    expect(Array.from(vec4Normalize(o, [0.6, 0.8, 0, 0]))).toEqual([f(0.6), f(0.8), 0, 0]);
    expect(Array.from(vec4Normalize(o, [1e-6, 0, 0, 0]))).toEqual([0, 0, 0, 0]);
    expect(Array.from(vec4Normalize(o, [3, 0, 4, 0]))).toEqual([f(0.6), 0, f(0.8), 0]);
  });

  it('binds "Anim-<name>" to the model\'s frame of that name and sets it from the keys around t', () => {
    const K = [key(0, 0, 1, 0), key(1000, Math.PI / 2, 2, 4), key(2000, Math.PI, 2, 0)];
    const { model, anim } = rig(K);
    const arm = model.children[0]!;
    expect(anim.root.children[0]!.children[0]!.bound).toBe(arm);
    const close = (got: Float32Array, want: number[]): void => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));
    animateFrames(anim.root, f(0.5), anim, null);
    expect(anim.period).toBe(f(2));
    close(arm.local, between(K[0]!, K[1]!, 0.5));
    animateFrames(anim.root, f(1), anim, null);                     // on a key: that key
    close(arm.local, Array.from(K[1]!.subarray(1)));
    animateFrames(anim.root, f(2.25), anim, null);                  // past the end: wraps (t mod the last key)
    close(arm.local, between(K[0]!, K[1]!, 0.25));
  });

  it('freezes the pose into the blend model\'s first key and blends from it over half a second', () => {
    const K = [key(0, 0, 1, 0), key(1000, 1, 1, 4)], L = [key(0, -1, 1, -2), key(500, 0, 1, 0)];
    const { model, anim } = rig(K);
    const close = (got: ArrayLike<number>, want: number[]): void => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));
    const blend = anim.cloneKeys();
    freezeFrames(anim.root, f(0.25), blend.root);
    const k = blend.root.children[0]!.children[0]!.matKeys;
    expect(k.length).toBe(1);
    expect(k[0]![0]).toBe(0);
    const frozen = between(K[0]!, K[1]!, 0.25);                    // the pose at 0.25 s
    close(k[0]!.subarray(1), frozen);
    const { anim: next } = rig(L);
    bindFrames(next.root, model);
    const arm = model.children[0]!.local;
    animateFrames(next.root, 0, next, blend.root);                 // blending: from the frozen pose...
    close(arm, frozen);
    expect(next.period).toBe(0.5);
    animateFrames(next.root, f(0.25), next, blend.root);           // ...half way to the new series' first key
    close(arm, between(k[0]!, L[0]!, 0.5));
  });
});
