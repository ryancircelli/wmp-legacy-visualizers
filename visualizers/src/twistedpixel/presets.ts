// TwistedPixel's preset list (0x100103a0): the files of the Presets folder in FindFirstFile order, shuffled once
// with the engine's rand(), then dealt out one by one and reshuffled after the last (0x10010970).
import { A } from '../ns';
import '../rand';

/** NTFS directory order for ASCII names: compare the upper-cased names code unit by code unit. */
export function ntfsOrder(names: readonly string[]): string[] {
  const k = (s: string) => s.toUpperCase();
  return names.slice().sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
}

export class PresetList {
  readonly v: string[];
  /** +0x2c: the next index to deal */
  idx = 0;
  /** +0x28: the last name dealt */
  current = '';
  /** +0x34: set, the list is dealt again in the same order (never set by the engine) */
  noReshuffle = false;
  constructor(names: readonly string[], initial = '') {
    this.v = names.slice();
    if (this.v.length > 0) this.shuffle();
    this.current = initial;
    if (initial === '') this.next();
  }
  /** 0x10010700: VC6 random_shuffle, for i = 1..n-1 swap(v[i], v[rand() % i]) (n - 1 draws; i = 1 always swaps 0 and 1) */
  shuffle(): void {
    const v = this.v;
    for (let i = 1; i < v.length; i++) {
      const j = A.rand() % i, t = v[i];
      v[i] = v[j]; v[j] = t;
    }
  }
  /** 0x10010970 */
  next(): string {
    if (this.v.length === 0) return '';
    if (this.idx > this.v.length - 1) {
      this.idx = 0;
      if (!this.noReshuffle) this.shuffle();
    }
    this.current = this.v[this.idx++];
    return this.current;
  }
}
