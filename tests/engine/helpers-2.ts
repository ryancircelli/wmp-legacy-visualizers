// Shared helpers for engine/bars/battery tests: a synthetic WMP audio frame, and a JS mirror of the
// MSVC CRT LCG (src/engine/rand.ts's A.rand()) used to predict rand() draws independently of the
// engine's own stream.
import type { TimedLevel } from '../../src/engine/ns';

export function level(state: number, fill?: (l: TimedLevel) => void): TimedLevel {
  const mk = () => new Uint8Array(1024);
  const L: TimedLevel = { freq: [mk(), mk()], wave: [mk(), mk()], state, timeStamp: 0 };
  if (fill) fill(L);
  return L;
}

export function mirror(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (Math.imul(s, 214013) + 2531011) | 0; return (s >>> 16) & 0x7fff; };
}
