// The plug-in's randomness: its own statically linked CRT rand() (0x10015483, the MSVC LCG, a per-thread
// state that starts at 1) and goom's random table (0x10010f80): after srand(s) 65536 entries
// (rand() * 65536 + rand()) / 127, read by a 16-bit index that starts at 1 and is incremented before
// every read (goom_irand 0x1000dc00: entry % n; 0x10011210: the raw entry). The DLL seeds with the heap
// address of its first pixel buffer, so a real run's randomness is that address: here it is the seed.

export class Crt {
  hold = 1;
  srand(s: number): void { this.hold = s >>> 0; }
  rand(): number {
    this.hold = (Math.imul(this.hold, 214013) + 2531011) >>> 0;
    return (this.hold >>> 16) & 0x7fff;
  }
}

export class GoomRandom {
  tab = new Int32Array(65536);
  pos = 1;
  /** 0x10010f80: srand(seed), then the table */
  init(crt: Crt, seed: number): void {
    crt.srand(seed);
    this.pos = 1;
    for (let i = 0; i < 65536; i++) {
      const a = crt.rand(), b = crt.rand();
      this.tab[this.pos] = ((a * 65536 + b) / 127) | 0;
      this.pos = (this.pos + 1) & 0xffff;
    }
  }
  /** 0x1000dc00 goom_irand */
  irand(n: number): number { this.pos = (this.pos + 1) & 0xffff; return this.tab[this.pos] % n; }
  /** 0x10011210 goom_random */
  raw(): number { this.pos = (this.pos + 1) & 0xffff; return this.tab[this.pos]; }
}
