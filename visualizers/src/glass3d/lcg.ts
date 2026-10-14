// The MSVC 6 static CRT rand/srand Glass3D's DLLs link (Animator 0x1001a503 / 0x1001a4f6): the classic LCG on a
// per-thread seed (a fresh thread starts at 1). Each plug-in draws on one thread, so one instance per engine.
export class Lcg {
  s = 1;
  srand(seed: number): void { this.s = seed >>> 0; }
  rand(): number {
    this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0;
    return (this.s >>> 16) & 0x7fff;
  }
}
