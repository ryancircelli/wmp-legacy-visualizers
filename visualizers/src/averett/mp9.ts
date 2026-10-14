// Rhythm and Waves (MediaPlayer_9.dll, "Windows Media 9 Series", Averett & Associates' Plugin framework): the
// engine. One object (0x3123c bytes, Heap address 0) as the DLL keeps it; methods are named by the VA of the DLL
// function they reproduce (MediaPlayer_9's image base 0x10000000). What reaches the device: a 64x64 water mesh
// (the DirectX 8 SDK's Water sample, CWater at +0x3454) drawn with a D3DX effect into a 128x128 caustics render
// target and then over the back buffer, which the CPU first fills with the 2D layer (sprite 6: sky, hills, logos)
// and an equalizer. Particles are set up each frame but never emitted (their maximum is 0 in this scene).
import { Heap, fr, ftol, fsinF, fcosF } from './heap';
import {
  matMul, translation, quatYawPitchRoll, matRotQuat, perspectiveFovRH, vec3Normalize, textureFromPixels,
} from './d3dx';
import {
  type Device, type Texture, type Surface, type Buffer, type StateBlock, Fmt, Pool, Usage, Lock, Prim, ClearFlag, Ts, Rs, Tss,
} from '../d3d8/api';
import { drawEq } from './eq';

export const OBJ_SIZE = 0x3123c;

/** The pictures the scene composites: in the DLL they come out of GDI+ (sprite 5's floor gradient, sprite 6's sky
 *  and hills with the logos on top) and a JPEG resource (the particle glow). The public build supplies its own;
 *  the private A/B the DLL's own pixels. */
export interface Mp9Art {
  /** sprite 5 (1000d2e0): 512x512 BGRA, rows top-down as GDI+ drew them (the floor texture's source) */
  floor(): Uint8Array;
  /** sprite 6 (100105e0 + 10011cd0 + 100121d0): w x h BGRA top-down; alpha byte 0 for the GDI+ background, 0xff
   *  where a logo was blended over it (the byte goes to the back buffer as is) */
  background(w: number, h: number, scene: Mp9Background): Uint8Array;
  /** DATATABLE_Particle_1 decoded as D3DX gives it: 128x128 X8R8G8B8 */
  particle(): Uint8Array;
}

/** what 0x100105e0 draws sprite 6 from: a 512x512 picture (the sky's LinearGradientBrush over the top half, then
 *  three hills, each the Bezier (x0, y0) (x1, y1) (x2, y2) (x3, y3) closed through (512, 512) and (0, 512) and filled
 *  with a PathGradientBrush: surround 0xff4a88c1, centre 0xff9ab7de at (255, 512), focus scales (1, focus[i])),
 *  HighQualityBicubic to cover x cover, of which the window's w x h centre is kept; the logos (10011cd0, 100121d0)
 *  on top when logos is set */
export interface Mp9Background {
  beziers: number[][];
  focus: number[];
  cover: [number, number];
  logos: boolean;
}

export interface Mp9Options {
  art: Mp9Art;
  /** timeGetTime() in ms; QueryPerformanceCounter is this in us (the host pins both per frame) */
  clock: () => number;
  /** time(NULL) at the first Render: the CRT's srand seed */
  seed: number;
  /** the device the DLL creates on frame 1 (REF) */
  createDevice: (w: number, h: number) => Device;
  /** registry: "Flag Lights on or off", "Flag Logos on or off", "How big should EQ be" */
  lights?: number; logos?: number; eqSize?: number;
}

// the object's constant fields as the constructor (10019850 -> 10014890) leaves them (non-pointer, non-zero)
const INIT_I: [number, number][] = [
  [0x24, 70], [0x28, 100], [0x88, 1], [0x90, 640], [0x94, 480], [0x1d0c, 1], [0x1e60, 1], [0x1e88, 0xff], [0x1ee8, 1400],
  [0x1eec, 2400], [0x1f34, 64], [0x2010, 20], [0x2044, 10], [0x2078, 8], [0x207c, 2], [0x2098, 4], [0x20e4, 8], [0x20e8, 2],
  [0x20f4, 4], [0x20f8, 0xff], [0x2538, 3000], [0x253c, 3000], [0x2540, 5000], [0x2570, 4], [0x3438, 1], [0x36b0, 1],
  [0x36b4, 16], [0x36c4, 50], [0x36d8, 512], [0x36dc, 512], [0x2ddb4, 512], [0x2ddb8, 2048], [0x30da0, 1],
  [0x1f68, 0x4b07a238],
];
const INIT_F: [number, number][] = [
  [0xa4, 20], [0x1e64, 0.1], [0x1ffc, 0.2], [0x2014, 6], [0x2018, 24], [0x201c, 6], [0x2030, 0.2], [0x2048, 1], [0x204c, 1],
  [0x2050, 1], [0x2054, 1], [0x2060, 1], [0x2064, 0.1], [0x2068, -9.8], [0x206c, 0.25], [0x2070, 1], [0x2074, 0.04],
  [0x2080, 1], [0x2084, 0.15], [0x2094, 0.07], [0x209c, 6], [0x20a0, 12], [0x20a4, 6], [0x20ac, 0.2], [0x20b8, 0.2],
  [0x20bc, 1], [0x20c0, 1], [0x20cc, 0.5], [0x20d0, 0.5], [0x20d4, -9.8], [0x20d8, 0.4], [0x20dc, 1], [0x20e0, 0.04],
  [0x20ec, 1], [0x2100, 2], [0x2530, 0.25], [0x345c, 1], [0x2db64, 0.5], [0x2db68, -1], [0x2db6c, 1], [0x2db74, 0.5],
  [0x2db80, 1], [0x2db98, 1], [0x2db9c, 1], [0x2ddac, 0.03], [0x2ddd8, 3], [0x2dddc, -4], [0x2ddf0, 3], [0x2ddf4, -4],
];
// matrices the constructor leaves as identity (rewritten each frame by 10004cd0, but read before that on frame 1)
const INIT_IDENT = [0x2dba8, 0x2dbe8, 0x2dc28, 0x2dd28, 0x2dd68];

// effect T0 / P0 of DATATABLE_sha ("Water effect"), the states its pass sets, in the order D3DX records them
const P0_RS: [number, number][] = [[Rs.LIGHTING, 1], [Rs.SPECULARENABLE, 1]];
const P0_TSS0: [number, number][] = [[24, 2], [1, 2], [2, 2], [3, 1], [4, 10], [5, 2], [6, 0], [17, 2], [16, 2], [18, 1]];
const P0_TSS1: [number, number][] = [[24, 2], [1, 7], [2, 2], [3, 1], [4, 3], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1]];
const P0_TSS2: [number, number][] = [[1, 1], [4, 1]];
// CD3DFont (the DirectX 8 SDK framework's d3dfont.cpp) draw state, recorded twice per font (saved + drawing block)
const FONT_RS: [number, number][] = [[7, 0], [27, 1], [19, 5], [20, 6], [15, 1], [24, 8], [25, 7], [8, 3], [22, 3], [52, 0],
  [136, 1], [40, 0], [152, 0], [151, 0], [167, 0], [28, 0]];
const FONT_TSS: [number, number, number][] = [[0, 1, 4], [0, 2, 2], [0, 3, 0], [0, 4, 4], [0, 5, 2], [0, 6, 0], [0, 17, 1],
  [0, 16, 1], [0, 18, 0], [0, 11, 0], [0, 24, 0], [1, 1, 1], [1, 4, 1]];

/** The DLL's CRT rand: holdrand on the render thread */
class Crt { h = 1; srand(s: number): void { this.h = s >>> 0; } rand(): number { this.h = (Math.imul(this.h, 214013) + 2531011) >>> 0; return (this.h >>> 16) & 0x7fff; } }

export class Mp9Engine {
  readonly heap = new Heap(OBJ_SIZE, 24 << 20);
  readonly I = this.heap.I; readonly U = this.heap.U; readonly F = this.heap.F; readonly B = this.heap.B;
  readonly crt = new Crt();
  dev: Device | null = null;
  /** handles stored in the object's pointer fields -> D3D objects */
  private objs: unknown[] = [null];
  private refract = new Float32Array(512 * 3);   // 0x10083950..: 256 copies of entry 0, then the 256 entries
  private refractU = new Uint32Array(this.refract.buffer);
  private diffuse = new Uint32Array(8);          // 0x10083930
  private w = 0; private h = 0;
  // DXUtil_Timer (0x10002ed0) statics, microseconds
  private tInit = false; private tStop = 0; private tLast = 0; private tBase = 0; private tStopped = false;
  private blocks: StateBlock[] = [];
  private mats = new Float32Array(16 * 4);
  frame = 0;

  constructor(readonly opt: Mp9Options) {
    const { I, F } = this;
    for (const [o, v] of INIT_I) I[o >> 2] = v;
    for (const [o, v] of INIT_F) F[o >> 2] = v;
    for (const o of INIT_IDENT) for (let k = 0; k < 16; k++) F[(o >> 2) + k] = k % 5 === 0 ? 1 : 0;
    // pointers the constructor sets that are only tested for null: the two CD3DFont objects
    I[0x2db50 >> 2] = this.handle({}); I[0x2db54 >> 2] = this.handle({});
    // SetCurrentPreset(0): scene = preset + 1; Create(hwnd): the window
    I[0x30f8c >> 2] = 1;
    I[0x3122c >> 2] = 1;
  }

  // ---- helpers ----
  private handle(o: unknown): number { this.objs.push(o); return this.objs.length - 1; }
  private obj<T>(off: number): T { return this.objs[this.I[off >> 2]] as T; }
  private i(o: number): number { return this.I[o >> 2]; }
  private si(o: number, v: number): void { this.I[o >> 2] = v; }
  private f(o: number): number { return this.F[o >> 2]; }
  private sf(o: number, v: number): void { this.F[o >> 2] = v; }
  private tgt(): number { return this.opt.clock() >>> 0; }
  private get d(): Device { return this.dev!; }
  /** sprite record i field (records 0x1ec bytes from 0x998) */
  private sp(i: number, o: number): number { return 0x998 + i * 0x1ec + o; }
  private get cur(): number { return this.i(0x1cd0); }

  /** one IWMPEffects2::RenderWindowed: the levels as WMP's TimedLevel (freq 2x1024, wave 2x1024, state, time) */
  render(levels: Uint8Array, w: number, h: number): void {
    this.r10015420(levels, w, h);
    this.frame++;
  }

  // ======== 0x10015420 IWMPEffects::Render ========
  private r10015420(lv: Uint8Array, w: number, h: number): void {
    this.si(0x30d1c, 32);                         // GetDeviceCaps(hdc, BITSPIXEL)
    this.si(0x30d98, 0);
    this.reg10023090();
    if (this.i(0x30d90) === 0) {
      this.init10025aa0();
      this.reg10022fa0();
      this.si(0x30d90, 1);
      this.si(0x30f7c, 0x15e); this.si(0x30f80, 0x140); this.si(0x30e7c, 0x15e); this.si(0x30e80, 0x140);
      this.si(0x30f90, 0x100); this.si(0x30f94, 0x100);
      this.sf(0x30d28, (this.i(0x30f7c) / 2) | 0);
      this.crt.srand(this.opt.seed);              // srand(time(NULL))
      this.s10025e10(); this.s10025f20(); this.t10026340();
    }
    this.si(0x30fa8, 0); this.si(0x30f98, 0); this.si(0x30f9c, 0);
    if (this.i(0x30e7c) === w && this.i(0x30e80) === h) this.si(0x30ec4, 0);
    else {
      this.si(0x30ec4, 1); this.si(0x30f78, 0); this.si(0x30e80, h); this.si(0x30e7c, w);
      // ponytail: a size change after the device exists resets it in the DLL (Reset + restore); the port is
      // rebuilt by the host on resize instead
    }
    this.si(0x31034, this.i(0x13bc)); this.si(0x31028, this.i(0x13c0));
    const n = Math.imul(this.i(0x13c0), this.i(0x31034));
    this.si(0x310d4, n);
    if (n !== 0 && this.i(0x1338) === -1) this.d3d10001010(w, h);
    this.a100157d0(lv);
  }

  // ======== registry options ========
  private reg10023090(): void {
    this.si(0x36d0, 0); this.si(0x36cc, this.opt.lights ?? 1); this.si(0x36c8, this.opt.logos ?? 1);
    this.si(0x36c4, this.opt.eqSize ?? this.i(0x36c4));
  }
  private reg10022fa0(): void { this.si(0x258c, 0); this.reg10023090(); }

  // ======== 0x10025aa0: reset (first Render) ========
  private init10025aa0(): void {
    this.si(0x30d1c, 32);
    this.si(0x310d0, 9); this.si(0x1cd4, 10);
    for (let s = 0; s <= 9; s++) {
      for (let j = 0; j < 0x7b; j++) this.si(0x998 + (s * 0x7b + j) * 4, 0);
      for (let j = 0; j < 0x38; j++) this.si(0xb0 + (s * 0x39 + j) * 4, 0);
    }
    this.si(0x1cd0, 10); this.si(0x30de0, 0x7b); this.si(0x30e00, 0x38);
    for (let j = 0; j < 0x14; j++) this.si(0x30c64 + j * 4, 0);
    for (let j = 0; j < 0x208; j++) { this.si(0x2e0a4 + j * 4, 0); this.si(0x2e8c4 + j * 4, 0); this.si(0x2f0e4 + j * 4, 0); }
    for (let j = 0; j < 9; j++) this.si(0x2de04 + j * 4, 0);
    this.si(0x30de0, 9);
    for (const o of [0x1eac, 0x30cd8, 0x30ce4, 0x30d00]) this.si(o, 0);
    this.si(0x30d04, 0xffffff); this.si(0x30d38, 0xff);
    for (const o of [0x30d34, 0x1e98, 0x1cd0, 0x30d44, 0x30d48, 0x30d54, 0x30d58, 0x30d84, 0x30d94, 0x30d9c]) this.si(o, 0);
    this.si(0x30dbc, 400);
    for (const o of [0x30dfc, 0x30e10, 0x30e14]) this.si(o, 0);
    this.si(0x1ef4, 2); this.si(0x30e20, 0); this.si(0x30e48, 0x13);
    for (const o of [0x30e58, 0x30e5c, 0x30e60, 0x30e64, 0x30e68, 0x30e78]) this.si(o, 0);
    this.si(0x30e7c, 0x15e); this.si(0x30e80, 0x140);
    for (const o of [0x30e84, 0x1ea0, 0x1e9c]) this.si(o, 0);
    this.si(0x30ec4, 1); this.si(0x30ec8, 7);
    for (const o of [0x30ee4, 0x30ed4, 0x30ed8, 0x30edc, 0x1ec0, 0x1ec4]) this.si(o, 0);
    this.si(0x1ef0, 3); this.si(0x30f84, 0); this.si(0x30f88, 0); this.si(0x30f90, 0x100); this.si(0x30f94, 0x100); this.si(0x1e94, 0);
    for (const o of [0x30fbc, 0x30fc0, 0x30fc4, 0x30fc8, 0x30fd0, 0x30fd4, 0x30fd8, 0x30fe0, 0x30fdc, 0x30fe4, 0x3104c, 0x3107c,
      0x31080, 0x310c8, 0x310e4, 0x310e8, 0x310ec, 0x31124, 0x98]) this.si(o, 0);
    const t = this.tgt();
    this.si(0xa0, 0); this.si(0x9c, t);
  }

  // ======== sprite table setup ========
  private s10025e10(): void {
    this.si(0x30e50, this.i(0x30f80) << 2); this.si(0x30e4c, this.i(0x30f7c) << 2);
    for (let s = 0; s <= this.i(0x310d0); s++) this.si(this.sp(s, 0), -1);
    this.si(0x1cd0, this.i(0x310d0) + 1);
  }
  /** 0x100145c0: free sprite cur's buffers */
  private s100145c0(): void {
    const s = this.cur;
    if (this.i(this.sp(s, 4)) === -1 && this.i(this.sp(s, 0x28)) !== 0) {
      this.heap.release(this.i(this.sp(s, 0x28)) - 0xc);
      this.si(this.sp(s, 4), 0); this.si(this.sp(s, 0x28), 0);
    }
    this.si(this.sp(s, 0xb8), 0);
    for (const o of [0xc0, 0xbc, 0x1a0]) { const p = this.i(this.sp(s, o)); if (p) { this.heap.release(p); this.si(this.sp(s, o), 0); } }
  }
  private s10014580(): void {
    for (this.si(0x1cd0, 0); ; ) { this.s100145c0(); const v = this.i(0x1cd0) + 1; this.si(0x1cd0, v); if ((v >>> 0) > (this.i(0x310d0) >>> 0)) break; }
  }
  /** 0x100092c0 */
  private s100092c0(): void {
    const s = this.cur;
    if (this.i(this.sp(s, 4)) !== -1) { this.si(this.sp(s, 0), -1); this.si(this.sp(s, 0x28), 0); }
  }
  private s10025f20(): void {
    const I = this.I;
    this.s10014580();
    for (let s = 0; ; s++) {
      for (let j = 0; j < 0x7b; j++) I[s * 0x7b + j + 0x266] = 0;
      for (let j = 0; j < 0x39; j++) I[s * 0x39 + j + 0x2c] = 0;
      if (((s + 1) >>> 0) > (I[0xc434] >>> 0)) { I[0x734] = s + 1; I[0xc378] = 0x7b; I[0xc380] = 0x39; break; }
    }
    I[0xc43c] = 0x5a; I[0xc439] = 0; I[0xc43d] = 0x17d8; I[0xc43e] = 0x1989; I[0xc43f] = -0x13e;
    I[0x7a2] = 0xff; I[0x79f] = 0; I[0x7a0] = 0; I[0xc413] = 0; I[0x79e] = 0; I[0x7a1] = 0; I[0x7a3] = 0; I[0x7a4] = 0;
    for (let j = 0; j < 0x208; j++) I[j + 0xbe41] = 0;
    for (let j = 0; j < 10; j++) I[j + 0xb81f] = 0;
    I[0xc438] = 10;
    I[0x2cf] = -1; I[0x266] = 2; I[0x28a] = 0x479; I[0x285] = 0x453; I[0x286] = -0x1da; I[0x28d] = 0; I[0x26e] = 0; I[0x26f] = 1;
    I[0x284] = 0; I[0x2de] = 1; I[0x26a] = 2; I[0x734] = 0; this.s100092c0();
    I[0x2e1] = 2; I[0x305] = 0x58c; I[0x300] = 0x522; I[0x301] = -0x191; I[0x308] = 0; I[0x2e9] = 0; I[0x2ea] = 4; I[0x2ff] = -1;
    I[0x34a] = -1; I[0x2e5] = 2; I[0x734] = 1; this.s100092c0();
    I[0x35c] = 2; I[0x3c5] = -1; I[0x380] = 0x58c; I[0x37b] = 0x453; I[0x37c] = -0x1db; I[899] = 0; I[0x364] = 0; I[0x365] = 10;
    I[0x37a] = -1; I[0xd4] = 0x40000000; I[0x3d4] = 1; I[0xbf] = 0x43960000; I[200] = 0x3f800000; I[0xc9] = 0x3f000000;
    I[0x3d2] = 2; I[0x360] = 2; I[0x734] = 2; this.s100092c0();
    I[0x3d7] = 2; I[0x3fb] = 0x58c; I[0x3f6] = 0x524; I[0x3f7] = -0x191; I[0x3fe] = 0; I[0x3df] = 0; I[0x3e0] = 0xb; I[0x3f5] = 0;
    I[0x44f] = 1; I[0x734] = 3; I[0x440] = -1; I[0x3db] = 2; this.s100092c0();
    I[0x452] = 2; I[0x476] = 0x58c; I[0x471] = 0x524; I[0x472] = -0x191; I[0x479] = 0; I[0x45a] = 0; I[0x45b] = 0x23; I[0x470] = 0;
    I[0x4bb] = -1; I[0x456] = 2; I[0x453] = -1; I[0x474] = 0; I[0x475] = 0; I[0x4f1] = 0x58c; I[0x45e] = 0; I[0x45f] = 0;
    I[0x45c] = 0; I[0x549] = -1; I[0x56a] = 0; I[0x56b] = 0; I[0x554] = 0; I[0x555] = 0; I[0x552] = 0; I[0x4cd] = 2;
    I[0x4ec] = 0x4f5; I[0x4ed] = 0x35; I[0x4f4] = -0x2e; I[0x4d5] = 0; I[0x4d6] = 5; I[0x4eb] = -1; I[0x536] = -1; I[0x4d1] = 2;
    I[0x734] = 5; this.s100092c0();
  }
  /** 0x10026340: sin/cos tables by degree (x87 FSIN/FCOS of i * 0.01745328f) */
  private t10026340(): void {
    const k = fr(0.017453279346227646);
    this.sf(0x306c4, 0);
    for (let i = 1; i < 360; i++) this.sf(0x306c4 + i * 4, fsinF(i * k));
    this.sf(0x30124, 1);
    for (let i = 1; i < 360; i++) this.sf(0x30124 + i * 4, fcosF(i * k));
  }

  // ======== 0x100157d0: the per-frame audio step ========
  private a100157d0(lv: Uint8Array): void {
    const I = this.I;
    for (let i = 0; i < 0x100; i++) {
      let m = lv[i * 4]; if (m < lv[i * 4 + 1]) m = lv[i * 4 + 1]; if (m < lv[i * 4 + 2]) m = lv[i * 4 + 2]; if (m < lv[i * 4 + 3]) m = lv[i * 4 + 3];
      lv[i] = m;
    }
    I[0xc378] = 0x100;
    I[0x30f04 >> 2]++;
    for (let i = 0; i <= 9; i++) {
      const v = lv[i + 0x32];
      if (I[(0x30f08 >> 2) + i] !== v) { I[(0x30f08 >> 2) + i] = v; I[0x30f04 >> 2] = 0; }
    }
    I[0xc378] = 10;
    if (I[0x30f04 >> 2] >= 7) {
      I[0x30f04 >> 2] = 7;
      for (let i = 0; i <= 0xfe; i++) lv[i + 1] = 0;
      I[0xc378] = 0xff;
    }
    if (I[0x1e80 >> 2] === 0 || I[0x3104c >> 2] === 0) {
      I[0x30d34 >> 2] = 0; I[0x30d38 >> 2] = 0xff; I[0x30cf8 >> 2] = 0; I[0x2e4a0 >> 2] = 0;
      let sum = 0;
      for (let i = 0; i <= 0xfe; i++) {
        if (I[0x1e84 >> 2] === 2) I[(0x2e4a0 >> 2) + I[0x30d34 >> 2] * 0x208 - i] = lv[i + 1];
        else if (I[0x1e90 >> 2] === 0) I[(0x2e0a4 >> 2) + I[0x30d34 >> 2] * 0x208 + i] = lv[i + 1];
        else { const r = this.crt.rand() & 0xff; I[0x30f54 >> 2] = r; I[(0x2e0a4 >> 2) + I[0x30d34 >> 2] * 0x208 + i] = lv[r]; }
        sum += lv[i];
      }
      I[0x310e0 >> 2] = 0xff;
      let avg = (sum / 0x6a) | 0;
      if (avg > 0xff) avg = 0xff;
      I[0x30cf8 >> 2] = avg;
      let k = I[0x30cfc >> 2] + 1; if (k > 9) k = 0; I[0x30cfc >> 2] = k;
      I[(0x2e07c >> 2) + k] = avg;
      let s = 0; for (let j = 0; j < 10; j++) s += I[(0x2e07c >> 2) + j];
      I[0x30d00 >> 2] = (s / 10) | 0; I[0x310e0 >> 2] = 10;
      // ponytail: the "percent random" modes 2..4 (0x1e90) are 0 in this scene and not ported
      this.spec100253f0();
    }
    if (I[0x3104c >> 2] === 0) I[0x3104c >> 2] = I[0x1e80 >> 2]; else I[0x3104c >> 2]--;
    const now = this.tgt();
    const dt = (now - I[0x9c >> 2]) >>> 0;
    if (dt > 1000) {
      I[0xa0 >> 2] = Math.floor((Math.imul(I[0x98 >> 2], 1000) >>> 0) / dt);
      I[0x9c >> 2] = this.tgt();
      I[0x98 >> 2] = 0;
      this.F[0xa4 >> 2] = ((this.F[0xa4 >> 2] * 3 + I[0xa0 >> 2]) + 1) * 0.25;
    }
    I[0x98 >> 2]++;
    this.s100144c0();
    this.f10004b50();
  }

  // ---- 0x100253f0: the spectrum pipeline (modes all off in this scene but run) ----
  private spec100253f0(): void { this.s10025440(); this.s10025640(); this.s100255a0(); this.s10025900(); this.s100257c0(); this.s100259b0(); }
  private s10025440(): void {
    const I = this.I, m = I[0x1e84 >> 2];
    if (m === 9 || m === 8 || m === 7 || m === 6 || m === 5 || m === 4 || m === 3 || m === 1) {
      I[0x30de0 >> 2] = 0;
      for (let i = 0; i < I[0x30d38 >> 2]; i++) { I[(0x2ecc0 >> 2) + i] = I[(0x2e0a4 >> 2) + i]; I[(0x2e8c4 >> 2) + i] = I[0xb928 - i]; I[0x30de0 >> 2] = i + 1; }
      I[0x30d34 >> 2] = 1; I[0x30d38 >> 2] = 0x200;
    }
    if (m === 10) {
      // ponytail: mode 10 (0x1e84) is not used by Rhythm and Waves
    }
  }
  private s10025640(): void {
    const I = this.I;
    const avg = I[0x1e88 >> 2];
    if (avg === 0xff) return;
    // ponytail: the averaging resampler runs only for 0x1e88 != 0xff, which this scene never sets
  }
  private s100255a0(): void {
    const I = this.I, st = I[0x30d34 >> 2];
    if (st === 0) return;
    if (st === 1) { for (let i = 0; i < 0x201; i++) I[(0x2e0a4 >> 2) + i] = I[(0x2e8c4 >> 2) + i]; I[0x310e0 >> 2] = 0x201; I[0x30d34 >> 2] = 0; }
    if (I[0x30d34 >> 2] === 2) { for (let i = 0; i < 0x201; i++) I[(0x2e0a4 >> 2) + i] = I[(0x2f0e4 >> 2) + i]; I[0x310e0 >> 2] = 0x201; I[0x30d34 >> 2] = 0; }
  }
  private s10025900(): void {
    const I = this.I, a = I[0x1e78 >> 2];
    if (a === 0) return;
    for (let i = 0; i < I[0x30d38 >> 2]; i++) {
      let v = I[(0x2e0a4 >> 2) + i]; if (v !== 0) v += a; if (v < 0) v = 0; if (v > 0xff) v = 0xff; I[(0x2e0a4 >> 2) + i] = v; I[0x30de0 >> 2] = i + 1;
    }
  }
  private s100257c0(): void {
    // ponytail: the "delay" smoothing (0x1e7c) is 0 in this scene
  }
  private s100259b0(): void {
    // ponytail: the "percent old" blend (0x1e8c) is 0 in this scene
  }

  // ======== 0x100144c0 and the scene logic ========
  private s100144c0(): void {
    const I = this.I;
    if (I[0x26a] < 2 && I[0x2cf] !== -1) I[0x26a] = 2;
    if (I[0x360] < 2 && I[0x3c5] !== -1) I[0x360] = 3;
    if (I[0x7be] !== 0 && I[0x73a] !== 0) { I[0x7be] = 0; I[0x734] = I[0x95c]; this.floor100034f0(); }
    // 0x100263d0: move every live sprite
    for (I[0x734] = 0; ; ) {
      if (I[I[0x734] * 0x7b + 0x266] !== -1) this.s10026420();
      const v = I[0x734] + 1; I[0x734] = v; if ((v >>> 0) >= (I[0x735] >>> 0)) break;
    }
    // 0x10026820
    if (I[0xc385] !== I[0xc3e3]) { I[0xc385] = I[0xc3e3]; I[0xc365] = 0; }
    this.s10026860();
  }
  /** 0x10026420: a sprite's spin, fade, zoom and drift */
  private s10026420(): void {
    const F = this.F, I = this.I;
    const s = this.cur, t = s * 0xe4, r = s * 0x1ec;
    const step = (o: number, d: number, wrap: number | null): void => {
      if (F[(t + d) >> 2] !== 0) {
        F[(t + o) >> 2] = F[(t + d) >> 2] + F[(t + o) >> 2];
        if (wrap !== null && F[(t + o) >> 2] > wrap) F[(t + o) >> 2] = F[(t + o) >> 2] - wrap;
      }
    };
    step(0x124, 0x128, 359); step(0x12c, 0x130, 359);
    if (F[(t + 0x16c) >> 2] !== 0) {
      F[(t + 0x168) >> 2] = F[(t + 0x16c) >> 2] + F[(t + 0x168) >> 2];
      if (F[(t + 0x168) >> 2] > 255) I[(t + 0x168) >> 2] = 0x437f0000;
      if (F[(t + 0x168) >> 2] < 0) I[(t + 0x168) >> 2] = 0;
    }
    const sp = I[(r + 0xacc) >> 2];
    if (sp !== 0) { let v = I[(r + 0xaa8) >> 2] + sp; I[(r + 0xaa8) >> 2] = v; if (v > 0x167) I[(r + 0xaa8) >> 2] = v - 0x167; }
    if (I[(r + 0xae4) >> 2] > 0) {
      const a = I[(r + 0xa20) >> 2], b = I[(r + 0xa24) >> 2];
      if (F[(t + 0xd0) >> 2] !== 0 && F[(t + 0xcc) >> 2] * F[(t + 0xcc) >> 2] < Math.imul(a, a) + Math.imul(b, b)) F[(t + 0xcc) >> 2] = F[(t + 0xd0) >> 2] + F[(t + 0xcc) >> 2];
      const e = I[(r + 0xae0) >> 2];
      if (e !== 0) {
        let v = I[(r + 0xadc) >> 2] + e; I[(r + 0xadc) >> 2] = v;
        if (v < 0) I[(r + 0xadc) >> 2] = v + 0x167;
        if (I[(r + 0xadc) >> 2] > 0x167) I[(r + 0xadc) >> 2] -= 0x167;
      }
    }
    if (F[(t + 0x15c) >> 2] !== 0 || F[(t + 0x158) >> 2] !== 0) {
      F[(t + 0x150) >> 2] = F[(t + 0x158) >> 2] + F[(t + 0x150) >> 2];
      F[(t + 0x154) >> 2] = F[(t + 0x15c) >> 2] + F[(t + 0x154) >> 2];
    }
    if (F[(t + 0x18c) >> 2] !== 0) {
      if (F[(t + 0x188) >> 2] >= 1) F[(t + 0x188) >> 2] = F[(t + 0x188) >> 2] - ftol(F[(t + 0x188) >> 2]);
      F[(t + 0x188) >> 2] = F[(t + 0x18c) >> 2] + F[(t + 0x188) >> 2];
    }
  }
  /** 0x10026860 */
  private s10026860(): void {
    const I = this.I;
    if (I[0xc365] === 0) {
      I[0xc348] = 0;
      this.s10025f20();
      this.w10006ac0();
      this.c10005240();
      this.s1000c5e0();
      I[0x735] = 9;
      for (const k of [0x2cf, 0x266, 0x34a, 0x2e1, 0x3c5, 0x35c, 0x440, 0x3d7, 0x536, 0x4cd, 0x5b1, 0x548, 0x62c]) I[k] = -1;
      I[0xc43d] = 0; I[0xc43e] = 0; I[0xc43f] = 0; I[0xc43c] = 0;
      I[0x5c3] = 2; I[0x4bb] = 0; I[0x452] = 2; I[0x471] = 0; I[0x472] = 0; I[0x479] = -0x32; I[0x470] = -2; I[0x4c8] = 1;
    }
    this.s10026960();
  }
  private s1000c5e0(): void {
    const I = this.I;
    if (I[0x30f7c >> 2] !== 0x160 || I[0x30f80 >> 2] !== 0x140) {
      if (I[0x30e58 >> 2]) this.heap.release(I[0x30e58 >> 2]);
      I[0x30f7c >> 2] = 0x160; I[0x30f80 >> 2] = 0x140; I[0x30e58 >> 2] = this.heap.malloc(0x6e000);
    }
  }
  private s1000c6e0(): void {
    const I = this.I;
    if (I[0x30f7c >> 2] !== I[0x30e7c >> 2] || I[0x30f80 >> 2] !== I[0x30e80 >> 2]) {
      if (I[0x30e58 >> 2]) this.heap.release(I[0x30e58 >> 2]);
      I[0x30f7c >> 2] = I[0x30e7c >> 2]; I[0x30f80 >> 2] = I[0x30e80 >> 2];
      I[0x30e58 >> 2] = this.heap.malloc(Math.imul(I[0x30e7c >> 2], I[0x30e80 >> 2]) * 4);
    }
  }
  /** 0x10026960: scene 1 (Rhythm and Waves) */
  private s10026960(): void {
    const I = this.I, F = this.F;
    if (I[0xc3e3] !== 1) return;                       // scene 2 is the other preset of the framework; not used
    I[0x7cd] = I[0xc340] >> 1;
    if ((I[0xc340] >> 1) > 0xff) I[0x7cd] = 0xff;
    if (I[0x7cd] < 0x14) I[0x7cd] = 0x14;
    if (I[0xc365] === 0) {
      I[0xc365] = 1; I[0xb6e5] = 1;
      if (this.dev) this.lightEnable(true);
      I[0x804] = 0;
      this.p10004b00();
      I[0xb6d7] = 0; I[0xb814] = 0;
      for (let a = 0; a < 0x11; a++) for (let b = 0; b < 8; b++) I[b + a * 8 + 0xb78c] = 0;
      I[0xc380] = 0x11; I[0xc378] = 8;
      I[0x7a3] = 0; I[0x7a0] = 1; I[0x95c] = 5; I[0x734] = 6; I[0x548] = 2;
      I[6 * 0x7b + 0x285] = 0; I[6 * 0x7b + 0x286] = -2000; I[6 * 0x7b + 0x28d] = -2000; I[6 * 0x7b + 0x284] = -2;
      I[0x958] = 0; I[0x959] = 1; F[0x94c] = 0.05; I[0x840] = 0x588fc5;
      this.c10001500();
      this.w10006ac0();
      I[0x950] = 5000; I[0x95b] = 0; I[0x953] = this.tgt();
      this.s100273a0();
      if (I[0xc366] !== 1) {
        I[0x167] = 0x40a00000; I[0x169] = 0x40400000; I[0x166] = 0x43200000; I[0x168] = 0x41f00000;
        I[0x734] = 5; I[0x506] = 0x78;
        this.sprite5_1000d2e0();
        I[0x734] = 5;
        this.floor100034f0();
      }
      return;
    }
    this.s100273a0();
    if (I[0xc366] === 1) return;
    if (I[0xdb3] === 1) {
      if (F[0x29] >= 7) {
        if (I[0xb6e5] === 0) F[0x29] = F[0x29] + 20;
        I[0xb6e5] = 1;
        if (this.dev) this.lightEnable(true);
      } else {
        if (I[0xb6e5] === 1) F[0x29] = F[0x29] - 20;
        I[0xb6e5] = 0;
        if (this.dev) this.lightEnable(false);
      }
    }
    this.hills10026960();
    if (I[0x959] === 1) {
      I[0x959] = 0; I[0x734] = 6;
      this.sprite6_100105e0();             // + 10011cd0 / 100121d0 (the logos, when 0x36c8) in the picture
      I[0xdbc] = 0;
    }
    const t = this.tgt();
    I[0x956] = (t - I[0x953]) | 0;
    F[0xdb9] = ((t - I[0x953]) >>> 0) / I[0x950];
    I[0x7ed] = 0xc18b3333 | 0;               // -17.4: the caustics' y (0x1fb4)
    I[0x7f0] = 0x3e147ae1;                   // 0.145 (0x1fc0)
    if (I[0xc33e] <= 10) { this.w10006ae0(); this.w10006900(); return; }
    I[0x94c] = 0x3d8f5c29;                   // 0.07: the water's stiffness (0x2530) when the music is loud
    this.w10006900();
  }
  /** the three hills' control points (0x1f38..0x1f94), from the cos table at the angles 0x598 and 0x5a0 */
  private hills10026960(): void {
    const I = this.I, F = this.F;
    I[0x1f38 >> 2] = 0xc2c80000 | 0; I[0x1f3c >> 2] = 0x43190000; I[0x1f40 >> 2] = 0x44190000; I[0x1f44 >> 2] = 0x43190000;
    const A = F[(0x30124 >> 2) + ftol(F[0x598 >> 2])];
    F[0x1f68 >> 2] = A * 100 + 400; F[0x1f6c >> 2] = 255 - A * 100;
    const B = F[(0x30124 >> 2) + ftol(F[0x5a0 >> 2])];
    F[0x1f70 >> 2] = 100 - B * 100;
    I[0x1f48 >> 2] = 0xc3480000 | 0; I[0x1f4c >> 2] = 0x433f4000; I[0x1f50 >> 2] = 0x44320000; I[0x1f54 >> 2] = 0x433f4000;
    F[0x1f74 >> 2] = B * 100 + 255; F[0x1f78 >> 2] = B * 100 + 400; F[0x1f7c >> 2] = 255 - B * 100; F[0x1f80 >> 2] = 100 - A * 100;
    I[0x1f58 >> 2] = 0xc3480000 | 0; I[0x1f5c >> 2] = 0x434c0000; I[0x1f60 >> 2] = 0x44320000; I[0x1f64 >> 2] = 0x434c0000;
    F[0x1f84 >> 2] = A * 100 + 255; F[0x1f88 >> 2] = B * 50 + 400; F[0x1f8c >> 2] = 255 - B * 50; F[0x1f90 >> 2] = 100 - A * 50;
    F[0x1f94 >> 2] = A * 50 + 255;
  }

  /** 0x100273a0 */
  private s100273a0(): void {
    const I = this.I;
    if (I[0xc3e0] !== I[0xc3a0] || I[0xc3df] !== I[0xc39f] || I[0xc365] === 1) {
      I[0xc365] = 2;
      this.s1000c6e0();
      I[0xc437] = 3; I[0x959] = 1; I[0x95b] = 0;
      this.w10006ac0();
      this.p10004b00();
      I[0xb6e5] = 1;
    }
  }
  private p10004b00(): void {
    const I = this.I;
    // free the particle list (none are ever emitted here)
    I[0x2ddc0 >> 2] = 0; I[0x2ddbc >> 2] = 0; I[0x2010 >> 2] = 0;
  }
  /** 0x10001500: camera parameters, then 0x10001720 */
  private c10001500(): void {
    const I = this.I, F = this.F;
    for (let k = 0x7e6; k <= 0x803; k++) I[k] = 0;
    F[0x7f0] = 1.6; F[0x7ff] = 0.2;
    this.c10001720();
  }
  private c10001720(): void {
    const I = this.I, F = this.F;
    const v = I[0x30f8c >> 2] === 7 ? fr((0x11c - I[0x30e80 >> 2]) * 0.949999988079071) : 0;
    const t = I[0x36dc >> 2];
    if (t === 0x200) F[0x1fa0 >> 2] = -(v + 60);
    if (t === 0x400) F[0x1fa0 >> 2] = -(v * 0.5 + 30);
    if (t === 0x800) F[0x1fa0 >> 2] = -(v * 0.25 + 15);
    if (t > 0x800) F[0x1fa0 >> 2] = -(v * 0.125 + 7.5);
  }

  // ======== the 2D layers (GDI+ in the DLL, pictures here) ========
  /** 0x1000d2e0 for sprite 5: the floor gradient, 512x512, stored bottom-up */
  private sprite5_1000d2e0(): void {
    const I = this.I;
    I[0x7c6] = 0x32; I[0x7c5] = 0x32; I[0x7c0] = 0xffff; I[0x7c1] = 0; I[0x7c2] = 0x68; I[0x7c3] = 0; I[0x7c4] = 0; I[0x7cb] = 0x32; I[0x7cc] = 0x32;
    I[0x7c7] = 0xff; I[0x7c8] = 0xff; I[0x7c9] = 0xff; I[0x7ca] = 0xff;
    I[0x948] = 1;
    I[0x969] = 0x200; I[0x96a] = 0x200;
    this.s100145c0();
    const n = 0x200 * 0x200;
    I[0xc435] = n;
    const p = this.heap.malloc(n * 4 + 0xc);
    I[p >> 2] = 0x200; I[(p + 4) >> 2] = 0x200; I[(p + 8) >> 2] = 0;
    const px = p + 0xc;
    I[0xc41d] = px; I[0xc330] = px + n * 4 - 0x200 * 4; I[0xc332] = px + n * 4;
    const src = this.opt.art.floor();
    // rows reversed: GDI+'s top row lands last (the TGA the floor texture is loaded from is bottom-up)
    for (let y = 0; y < 0x200; y++) for (let x = 0; x < 0x200; x++) {
      const s = (y * 0x200 + x) * 4, d = px + ((0x1ff - y) * 0x200 + x) * 4;
      this.B[d] = src[s]; this.B[d + 1] = src[s + 1]; this.B[d + 2] = src[s + 2]; this.B[d + 3] = 0;
    }
    I[0xc40d] = 0x200; I[0xc40a] = 0x200; I[0xc380] = 0x200; I[0xc378] = 0x200;
    const s = this.cur;
    I[(s + 5) * 0x7b] = -1;
    I[s * 0x7b + 0x288] = 0x200; I[s * 0x7b + 0x289] = 0x200; I[s * 0x7b + 0x272] = 0x200; I[s * 0x7b + 0x273] = 0x200;
    I[s * 0x7b + 0x270] = px;
    I[0xc39d] = 0;
  }
  /** 0x100105e0 for sprite 6: sky, hills (and 10011cd0/100121d0: the logos), the window's size, alpha 0 */
  private sprite6_100105e0(): void {
    const I = this.I;
    I[0x734] = 6;
    this.s100145c0();
    I[0x7c0] = 0x4787c0; I[0x7c1] = 0; I[0x7c2] = 0x9bc1f7; I[0x7c3] = 0; I[0x7c4] = 0; I[0x7c6] = 0x3c; I[0x7c9] = 0xcc; I[0x7ca] = 0xff;
    I[0x948] = 1;
    I[0xc40a] = 0x200; I[0xc40d] = 0x200;
    this.s10027170();
    const w = I[0xc39f], h = I[0xc3a0];
    const n = Math.imul(I[0x969], I[0x96a]);
    I[0xc435] = n;
    const p = this.heap.malloc(n * 4 + 0xc);
    I[p >> 2] = I[0x969]; I[(p + 4) >> 2] = I[0x96a]; I[(p + 8) >> 2] = 0;
    const px = p + 0xc;
    I[0xc39d] = 0; I[0xc41d] = px;
    // the hills' control points as AddBezierI gets them (ftol of 0x1f38.. and 0x1f68..), the focus from spectrum
    // bins 5, 20 and 60 (0x2e0a4 + 4 * bin) times 0.0023
    const F = this.F, hill = (a: number, b: number): number[] => {
      const p = [F[a >> 2], F[(a + 4) >> 2], F[b >> 2], F[(b + 4) >> 2], F[(b + 8) >> 2], F[(b + 12) >> 2], F[(a + 8) >> 2], F[(a + 12) >> 2]];
      return p.map(ftol);
    };
    const src = this.opt.art.background(w, h, {
      beziers: [hill(0x1f38, 0x1f68), hill(0x1f48, 0x1f78), hill(0x1f58, 0x1f88)],
      focus: [5, 20, 60].map((b) => fr(I[(0x2e0a4 >> 2) + b] * fr(0.0023))),
      cover: [I[0x969], I[0x96a]], logos: I[0x36c8 >> 2] !== 0,
    });
    // alpha byte as the picture has it: 0 where GDI+ drew (& 0xffffff), 0xff where the logos were blended in
    this.B.set(src.subarray(0, w * h * 4), px);
    I[0xc330] = px + w * h * 4; I[0xc380] = h; I[0xc378] = w;
    const s = this.cur;
    I[(s + 5) * 0x7b] = -1;
    I[s * 0x7b + 0x288] = w; I[s * 0x7b + 0x289] = h; I[s * 0x7b + 0x272] = w; I[s * 0x7b + 0x273] = h;
    I[s * 0x7b + 0x270] = px;
  }
  /** 0x10027170: the 2D layer's working size (aspect fit of 512x512 over the window) */
  private s10027170(): void {
    const I = this.I;
    const h0 = I[0x31028 >> 2], w0 = I[0x31034 >> 2], w = I[0x30e7c >> 2], h = I[0x30e80 >> 2];
    I[0x25a4 >> 2] = w;
    I[0x25a8 >> 2] = ftol(w * h0 / w0);
    if (I[0x25a8 >> 2] < h) { I[0x25a8 >> 2] = h; I[0x25a4 >> 2] = ftol(h * w0 / h0); }
    I[(0xa14 + this.cur * 0x1ec) >> 2] = 0;
  }

  // ======== the floor texture (0x100034f0 + 0x10003a20): sprite 5 in a TGA, through D3DX ========
  private floor100034f0(): void {
    const I = this.I;
    const old = I[0xb6e1];
    if (old) I[0xb6e1] = 0;
    const s = this.cur;
    const sh = I[s * 0x7b + 0x289], sw = I[s * 0x7b + 0x288];
    I[0xc425] = I[0xc3a0] < I[0xc39f] ? I[0xc39f] : I[0xc3a0];
    I[0xdb6] = 0x200; I[0xdb7] = 0;
    I[0xdb7] = I[0xdb6];
    const tw = I[0xdb6], th = I[0xdb7];
    // the TGA (header from DATATABLE_tga: 32 bpp, 8 alpha bits, bottom-up), then the sprite centred with alpha
    // ftol(..) and the alpha border
    const buf = this.heap.malloc(tw * th * 4 + 0x2c);
    const pix = buf + 0x12;
    const oy = ((th - sh) / 2) | 0, ox = ((tw - sw) / 2) | 0;
    I[0xc428] = oy; I[0xc427] = ox;
    const src = I[s * 0x7b + 0x270];
    // 0x10003881: alpha = 0xff - the sprite's fade (its transform record +0x168)
    const alpha = (0xff000000 - (ftol(this.F[(s * 0xe4 + 0x168) >> 2]) << 24)) >>> 0;
    I[0x310b8 >> 2] = alpha | 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const d = pix + ((oy + y) * tw + ox + x) * 4;
      const v = (this.U[(src + (y * sw + x) * 4) >> 2] & 0xffffff | alpha) >>> 0;
      this.B[d] = v & 0xff; this.B[d + 1] = (v >>> 8) & 0xff; this.B[d + 2] = (v >>> 16) & 0xff; this.B[d + 3] = v >>> 24;
    }
    this.alpha10003a20(pix, tw, th);
    if (this.dev) {
      // D3DXCreateTextureFromFileInMemory: TGA bottom-up -> texture top-down, A8R8G8B8, full chain, box mips
      const top = new Uint8Array(tw * th * 4);
      for (let y = 0; y < th; y++) top.set(this.B.subarray(pix + (th - 1 - y) * tw * 4, pix + (th - y) * tw * 4), y * tw * 4);
      const tex = textureFromPixels(this.d, top, tw, th, Fmt.A8R8G8B8);
      I[0xb6e1] = this.handle(tex);
    }
    this.heap.release(buf);
    if (this.i(0x2db58)) this.effParam(0, I[0xb6e1]);
  }
  /** 0x10003a20: the floor's alpha fades to 0 over the outer 0xa7c (border width) pixels of the TGA */
  private alpha10003a20(pix: number, tw: number, th: number): void {
    const I = this.I;
    const s = this.cur;
    let border = I[(0xa7c + s * 0x1ec) >> 2];
    I[0x310bc >> 2] = border;
    if (!this.dev || border === 0) return;
    let base = I[(0xa78 + s * 0x1ec) >> 2];
    if (base > 0xff) base = 0xff;
    let A = (base << 24) >>> 0;
    I[0x310b8 >> 2] = A | 0;
    let step = this.F[(0x190 + s * 0xe4) >> 2];
    if (step === 0) step = fr(((0xff - A) | 0) / border);
    if (border > (tw / 2 | 0)) border = tw / 2 | 0;
    I[0x310bc >> 2] = border;
    let a = base;               // the accumulating alpha (st0, FADD float step)
    let row0 = pix, w = tw, h = th;
    const set = (p: number): void => { this.B[p + 3] = A >>> 24; };
    for (let ring = 1; ring < border; ring++) {
      for (let x = 0; x < w; x++) set(row0 + x * 4);
      for (let y = 0; y < h; y++) set(row0 + y * tw * 4);
      for (let y = 0; y < h; y++) set(row0 - 4 + (y * tw + w) * 4);
      let p = pix + ((th - ring) * tw + ring) * 4;
      for (let x = 0; x < w; x++, p += 4) set(p);
      row0 = pix + (tw + 1) * ring * 4;
      w -= 2; h -= 2;
      a += step;
      A = (ftol(a) << 24) >>> 0;
    }
    I[0x31034 >> 2] = w; I[0x31028 >> 2] = h; I[0x310b8 >> 2] = A | 0; I[0x30de0 >> 2] = border;
  }

  // ======== CWater (DirectX 8 SDK Water sample) at +0x3454 ========
  /** 0x10006560 CWater::Initialize(64, 20): sizes and the refraction table (water's index 1.333) */
  private w10006560(): void {
    this.sf(0x3454, 64); this.sf(0x3458, 20); this.si(0x3470, 0x1000); this.si(0x346c, 0x2000); this.sf(0x345c, 1 / 64);
    const R = this.refract, k = 0.7501875758171082;
    for (let i = 0; i < 256; i++) {
      const t = i / 256;
      const s = Math.sqrt((1 + t) * (1 - t));            // sin(acos t): FSIN(FPATAN(...)) to 64 bits
      const sf = fr(s), s2 = s * k, s2f = fr(s2);
      const c = Math.sqrt(1 - s2 * s2);                  // cos(asin s2)
      R[(256 + i) * 3] = (sf / s2f) * c - t;
      R[(256 + i) * 3 + 1] = -(s2f / sf);
      R[(256 + i) * 3 + 2] = 0;
    }
    for (let i = 0; i < 256; i++) { R[i * 3] = R[256 * 3]; R[i * 3 + 1] = R[256 * 3 + 1]; R[i * 3 + 2] = R[256 * 3 + 2]; }
    if (!this.i(0x3474)) this.si(0x3474, this.heap.malloc(0x8000));
  }
  private w10006ac0(): void { const p = this.i(0x3474); if (p) this.B.fill(0, p, p + 0x8000); }
  private w10006ae0(): void {
    if (!this.dev) return;
    const F = this.F, p = this.i(0x3474) >> 2;
    for (let i = 0; i < 0x1000; i++) { F[p + i * 2 + 1] = F[p + i * 2 + 1] * 0.8999999761581421; F[p + i * 2] = F[p + i * 2] * 0.8999999761581421; }
  }
  /** 0x10006900: damp, then a drop shaped by the spectrum at a random spot */
  private w10006900(): void {
    if (!this.dev) return;
    const F = this.F, I = this.I, p = this.i(0x3474) >> 2;
    for (let i = 0; i < 0x1000; i++) { F[p + i * 2] = F[p + i * 2] * 0.9800000190734863; F[p + i * 2 + 1] = F[p + i * 2 + 1] * 0.9800000190734863; }
    const x = (this.crt.rand() & 0x1f) + 0x10, y = (this.crt.rand() & 0x1f) + 0x10, e = (this.crt.rand() & 0xf0) + 1;
    const sv = I[(0x2e0a4 >> 2) + e];
    const H = (xx: number, yy: number, k: number): void => { F[p + (((xx & 0x3f) | ((yy << 6) & 0xfc0)) * 2)] = sv * k; };
    H(x, y, 0.03999999910593033);
    H(x - 1, y, 0.019999999552965164); H(x + 1, y, 0.019999999552965164);
    H(x, y - 1, 0.019999999552965164); H(x, y + 1, 0.019999999552965164);
    H(x - 1, y - 1, 0.029999999329447746); H(x + 1, y + 1, 0.029999999329447746);
    H(x + 1, y - 1, 0.029999999329447746); H(x - 1, y + 1, 0.029999999329447746);
  }
  /** 0x10006b30 CWater::Update(vecPos = 0, vecLight = (0,1,0), bCalcCaustics) */
  private w10006b30(caustics: boolean): void {
    const F = this.F, S = this.i(0x3474) >> 2, k = this.f(0x2530);
    // velocities
    let avg = 0;
    let c = S;
    for (let yN = 0xfc0, y = 0, yP = 0x40; ; ) {
      for (let xN = 0x3f, x = 0, xP = 1; ; ) {
        const h = (i: number): number => F[S + i * 2];
        const sA = ((h(x + yP) + h(xP + y)) + h(xN + y)) + h(x + yN);
        const sB = ((h(xP + yP) + h(xN + yP)) + h(xP + yN)) + h(xN + yN);
        const want = sB * 0.0833333358168602 + sA * 0.1666666716337204;
        let v = F[c + 1];
        if (v > 0.009999999776482582 || v < -0.009999999776482582) { v = fr(v * 0.9900000095367432); F[c + 1] = v; }
        if (this.i(0x30cf8) < 0x50) {
          this.sf(0x310c0, 20);
          if (v > 20 || v < -20) { v = fr(v * 0.8999999761581421); F[c + 1] = v; }
          const lim = this.f(0x310c0);
          if (v > lim || v < -lim) { v = fr(v * 0.8999999761581421); F[c + 1] = v; }
        }
        const nv = (want - F[c]) * k + v;
        F[c + 1] = nv;
        avg = fr((nv + F[c]) + avg);
        c += 2;
        xN = x; x = xP; xP = (xP + 1) & 0x3f;
        if (x === 0) break;
      }
      yN = y; y = yP; yP = (yP + 0x40) & 0xfc0;
      if (y === 0) break;
    }
    avg = fr(avg / this.i(0x3470));
    this.sf(0x3460, avg);
    const vb = this.obj<Buffer>(0x3484);
    const V = vb.lock(0, this.i(0x3470) * 0x24, 0);
    const vf = new Float32Array(V.buffer, V.byteOffset, V.byteLength >> 2), vu = new Uint32Array(vf.buffer, vf.byteOffset, vf.length);
    const size = this.f(0x3454), inc = fr(size * 0.01587301678955555), scale = this.f(0x345c);
    let fZ = fr(size * -0.5);
    const N = new Float32Array(3), P = new Float32Array(3);
    const R = this.refract;
    let o = 0, cell = S;
    for (let yN = 0xfc0, y = 0, yP = 0x40; ; ) {
      let fXd = size * -0.5, fX = fr(fXd);
      for (let xN = 0x3f, x = 0, xP = 1; ; ) {
        const hp = (F[cell + 1] + F[cell]) - avg;
        F[cell] = hp;
        const h = (i: number): number => F[S + i * 2];
        P[0] = fXd; P[1] = hp; P[2] = fZ;
        const d1 = fr(h(xN + yN) - h(xP + yP));
        const e = fr((h(x + yN) - h(x + yP)) + d1);
        const d3 = h(xP + yN) - h(xN + yP);
        const nx1 = fr(d1 - d3), nz = fr(e + d3);
        const nx = fr((h(xN + y) - h(xP + y)) + nx1);
        vec3Normalize(N, 0, nx, 1, nz);
        // the eye vector: vecPos (0,0,0) normalized is 0, so the refraction index is always entry 0
        const r0 = R[256 * 3], rn = R[256 * 3 + 1];
        vf[o] = P[0]; vf[o + 1] = P[1]; vf[o + 2] = P[2];
        vf[o + 3] = N[0]; vf[o + 4] = N[1]; vf[o + 5] = N[2];
        vu[o + 6] = this.refractU[256 * 3 + 2];
        const t60 = fr(r0 * N[0]);
        const t6c = fr(t60 + 0);
        const rz = (r0 * N[2] + 0) * rn;
        const t78 = fr(t6c * rn);
        vf[o + 7] = ((t78 * 10 + fX) * scale) + 0.5;
        vf[o + 8] = ((rz * 10 + fZ) * scale) + 0.5;
        fXd = fX + inc; fX = fr(fXd);
        o += 9; cell += 2;
        xN = x; x = xP; xP = (xP + 1) & 0x3f;
        if (x === 0) break;
      }
      fZ = fr(fZ + inc);
      yN = y; y = yP; yP = (yP + 0x40) & 0xfc0;
      if (y === 0) break;
    }
    if (caustics) {
      const cb = this.obj<Buffer>(0x3488);
      const C = cb.lock(0, this.i(0x3470) << 4, 0);
      const cf = new Float32Array(C.buffer, C.byteOffset, C.byteLength >> 2), cu = new Uint32Array(cf.buffer, cf.byteOffset, cf.length);
      for (let e = 1; e <= 8; e++) this.diffuse[e - 1] = Math.imul(((this.i(0x1f34) >>> 0) / e) >>> 0, 0x10101) >>> 0;
      let vo = 0, co = 0;
      for (let y = 0; y < 0x40; y++) {
        for (let x = 0; x < 0x40; x++) {
          const ny = vf[vo + 4];
          const ii = ftol(ny * -255);
          const ri = (256 - ii) * 3;
          const r0 = R[ri], rn = R[ri + 1];
          const a = fr(r0 * vf[vo + 3]);
          const b = fr(a + 0);                       // + vecLight.x
          const cc = fr(b * rn);
          const rz = (r0 * vf[vo + 5] + 0) * rn;     // + vecLight.z
          cf[co + 1] = 0;
          cf[co] = cc * 1.5 + vf[vo];
          cf[co + 2] = rz * 1.5 + vf[vo + 2];
          if (x !== 0 && y !== 0) {
            const q = co - 0x410 / 4;
            let area = (cf[q] - cf[co]) * (cf[co - 0x3f8 / 4] - cf[co + 2]) - (cf[co - 0x408 / 4] - cf[co + 2]) * (cf[co - 0x400 / 4] - cf[co]);
            if (area < 0) area = -area;
            const kk = ftol(area * area * 4);
            cu[co + 3] = (kk >>> 0) < 8 ? this.diffuse[kk] : 0;
          }
          co += 4; vo += 9;
        }
        cu[co - 0x400 / 4 + 3] = cu[co - 1];
      }
      for (let e = 0; e < 0x40; e++) cu[e * 4 + 3] = cu[(0xfc00 >> 2) + e * 4 + 3];
      cb.unlock();
    }
    vb.unlock();
  }

  // ======== D3D: the device and its objects (frame 1) ========
  private d3d10001010(w: number, h: number): void {
    const I = this.I;
    if (I[0xd33] !== 0) return;
    I[0xd33] = this.handle({});                  // IDirect3D8
    this.w = w; this.h = h;
    this.timer(1);
    this.w10006560();                            // 0x10002200 OneTimeSceneInit
    // 0x10002220 Initialize3DEnvironment: CreateDevice (REF, 0x52, 320x240 X8R8G8B8, D16)
    this.dev = this.opt.createDevice(w, h);
    I[0xd34] = this.handle(this.dev);
    I[0xd35] = 2;                                // D3DDEVTYPE_REF
    I[0xdb8] = 0;
    this.d.getBackBuffer();
    this.si(0x35c0, w); this.si(0x35c4, h);
    this.i10003480();
    this.r10002830();
    this.w10006ac0();
    if (I[0xc365] === 0) this.c10001500();
    I[0xb6d1] = 1;
  }
  /** InitDeviceObjects (0x10003480) */
  private i10003480(): void {
    const I = this.I;
    I[0xb6e4] = 1; I[0xb6e5] = 1;
    this.fontInit(); this.fontInit();
    this.si(0x347c, I[0xd34]);
    I[0x734] = I[0x95c];
    this.floor100034f0();
  }
  /** CD3DFont::InitDeviceObjects: the glyph texture (A4R4G4B4; its glyphs never reach a draw) */
  private fontInit(): void {
    const t = this.d.createTexture(256, 256, 1, 0, Fmt.A4R4G4B4, Pool.MANAGED);
    t.lockRect(0, null, 0); t.unlockRect(0);
    this.fonts.push(t);
  }
  private fonts: Texture[] = [];
  /** RestoreDeviceObjects (0x10002830) */
  private r10002830(): void {
    const I = this.I, d = this.d;
    for (const t of this.fonts) {
      d.createVertexBuffer(0x20d0, Usage.WRITEONLY | Usage.DYNAMIC, 0, Pool.DEFAULT);
      for (let k = 0; k < 2; k++) {
        d.beginStateBlock();
        d.setTexture(0, t);
        for (const [s, v] of FONT_RS) d.setRenderState(s, v);
        for (const [st, s, v] of FONT_TSS) d.setTextureStageState(st, s, v);
        this.blocks.push(d.endStateBlock());
      }
    }
    // light 0 (directional) and the material, from the object
    const L = new ArrayBuffer(104), lv = new DataView(L), lf = new Float32Array(L);
    lv.setUint32(0, 3, true);
    lf[1] = this.f(0x2db74); lf[2] = this.f(0x2db78); lf[3] = this.f(0x2db7c); lf[4] = this.f(0x2db80);
    lf[5] = 1; lf[6] = 1; lf[7] = 1; lf[8] = 0;
    lf[16] = this.f(0x2db64); lf[17] = this.f(0x2db68); lf[18] = this.f(0x2db6c);
    d.setLight(0, L);
    this.lightEnable(I[0xdb3] === 1);
    const M = new ArrayBuffer(68), mf = new Float32Array(M);
    mf[3] = 0.1; mf[7] = 0.1; mf[8] = 0.5; mf[9] = 0.5; mf[10] = 0.5; mf[16] = 20;
    d.setMaterial(M);
    d.setVertexShader(2);
    for (const [s, v] of [[Rs.LIGHTING, 0], [Rs.SPECULARENABLE, 0], [Rs.ZFUNC, 4], [Rs.CULLMODE, 2], [Rs.SHADEMODE, 2], [Rs.FILLMODE, 3]] as [Rs, number][]) d.setRenderState(s, v);
    for (const st of [0, 1]) {
      for (const [s, v] of [[1, 1], [2, 2], [3, 1], [4, 1], [5, 2], [6, 1], [17, 2], [16, 2], [18, 1], [11, 0]] as [Tss, number][]) d.setTextureStageState(st, s, v);
    }
    // the caustics render target, ID3DXRenderToSurface, the effect
    const ct = d.createTexture(128, 128, 1, Usage.RENDERTARGET, Fmt.X8R8G8B8, Pool.DEFAULT);
    I[0xb6e2] = this.handle(ct);
    I[0xb6e3] = this.handle(ct.getSurfaceLevel(0));
    I[0xb6d8] = this.handle({});
    I[0xb6d6] = this.handle({});
    this.effParam(0, I[0xb6e1]); this.effParam(1, I[0xb6e2]);
    this.effTechnique();
    this.w100066b0();
  }
  private lightEnable(on: boolean): void { this.d.lightEnable(0, on); }

  // ---- the effect (ID3DXEffect over DATATABLE_sha, technique T0) ----
  private effTex: number[] = [0, 0];
  private effParam(k: number, h: number): void { this.effTex[k] = h; }
  private tex(h: number): Texture | null { return h ? this.objs[h] as Texture : null; }
  /** SetTechnique (0x100017d0): D3DX records the pass into a state block and a second block for what it changes,
   *  captures the latter, validates, and restores */
  private effTechnique(): void {
    const d = this.d;
    const ident = new Float32Array(16); ident[0] = ident[5] = ident[10] = ident[15] = 1;
    d.beginStateBlock();
    d.setVertexShader(0x152);
    for (const [s, v] of P0_RS) d.setRenderState(s, v);
    d.setTexture(0, this.tex(this.effTex[0])); d.setTransform(Ts.TEXTURE0, ident);
    for (const [s, v] of P0_TSS0) d.setTextureStageState(0, s, v);
    d.setTexture(1, this.tex(this.effTex[1])); d.setTransform(Ts.TEXTURE0 + 1, ident);
    for (const [s, v] of P0_TSS1) d.setTextureStageState(1, s, v);
    for (const [s, v] of P0_TSS2) d.setTextureStageState(2, s, v);
    this.effSaved = d.endStateBlock();
    d.captureStateBlock(this.effSaved);
    d.beginStateBlock();
    d.setVertexShader(0x152);
    for (const [s, v] of P0_RS) d.setRenderState(s, v);
    for (const [s, v] of P0_TSS0) d.setTextureStageState(0, s, v);
    for (const [s, v] of P0_TSS1) d.setTextureStageState(1, s, v);
    for (const [s, v] of P0_TSS2) d.setTextureStageState(2, s, v);
    this.effPass = d.endStateBlock();
    this.effPass0();
    d.applyStateBlock(this.effSaved);
  }
  private effSaved = 0; private effPass = 0;
  private effPass0(): void {
    const d = this.d;
    const ident = new Float32Array(16); ident[0] = ident[5] = ident[10] = ident[15] = 1;
    d.applyStateBlock(this.effPass);
    d.setTexture(0, this.tex(this.effTex[0])); d.setTransform(Ts.TEXTURE0, ident);
    d.setTexture(1, this.tex(this.effTex[1])); d.setTransform(Ts.TEXTURE0 + 1, ident);
  }

  /** 0x100066b0 CWater::RestoreDeviceObjects: the strip index buffer and the two vertex buffers */
  private w100066b0(): void {
    const d = this.d, n = this.i(0x346c);
    const ib = d.createIndexBuffer(n * 2, 0, Fmt.INDEX16, Pool.DEFAULT);
    const L = ib.lock(0, n * 2, 0), idx = new Uint16Array(L.buffer, L.byteOffset, n);
    let o = 0, x = 0, y = 0;
    for (let m = 0x40; m !== 0; m -= 2) {
      for (let k = 0; k < m; k++) { idx[o++] = x + y * 64; idx[o++] = x + (y + 1) * 64; x++; }
      x--; y++;
      for (let k = 1; k < m; k++) { const v = y * 64 + x; idx[o++] = v; idx[o++] = v - 1; y++; }
      y--; x--;
      for (let k = 1; k < m; k++) { idx[o++] = x + y * 64; idx[o++] = x + (y + 0x3ff) * 64; x--; }
      x++; y--;
      for (let k = 2; k < m; k++) { const v = y * 64 + x; idx[o++] = v; idx[o++] = v + 1; y--; }
      y++; x++;
    }
    for (let k = 0; k < n; k++) if (idx[k] >= this.i(0x3470)) idx[k] = 0;
    ib.unlock();
    this.si(0x3480, this.handle(ib));
    this.si(0x3484, this.handle(d.createVertexBuffer(this.i(0x3470) * 0x24, Usage.DYNAMIC, 0x152, Pool.DEFAULT)));
    this.si(0x3488, this.handle(d.createVertexBuffer(this.i(0x3470) << 4, Usage.DYNAMIC | Usage.WRITEONLY, 0x42, Pool.DEFAULT)));
  }

  // ======== DXUtil_Timer (0x10002ed0), QPC at 1 MHz ========
  private qpc(): number { return this.tgt() * 1000; }
  private timer(cmd: number): number {
    const now = this.tStopped && cmd !== 1 && cmd !== 4 ? this.tStop : this.qpc();
    if (cmd === 1) { if (this.tStopped) this.tBase += now - this.tStop; this.tStop = 0; this.tStopped = false; this.tLast = now; this.tInit = true; return 0; }
    if (cmd === 5) return (now - this.tBase) / 1e6;
    if (cmd === 6) { const e = (now - this.tLast) / 1e6; this.tLast = now; return e; }
    return 0;
  }

  // ======== 0x10004b50: the frame ========
  private f10004b50(): void {
    const I = this.I;
    if (!this.dev || I[0xd33] === 0) return;     // 0x100011c0: TestCooperativeLevel
    const app = this.timer(5), el = this.timer(6);
    if (el === 0) return;
    this.sf(0x35f4, el); this.sf(0x35f0, app);
    const d = this.d;
    d.setTextureStageState(0, Tss.COLOROP, 1); d.setTextureStageState(0, Tss.ALPHAOP, 1);
    d.setTextureStageState(1, Tss.COLOROP, 1); d.setTextureStageState(1, Tss.ALPHAOP, 1);
    d.setRenderState(Rs.SHADEMODE, 2);
    this.m10004cd0();
    d.setTransform(Ts.VIEW, this.mat(0x2dc28));
    this.c10005240();
    d.setTransform(Ts.VIEW, this.mat(0x2dbe8));
    this.s10005890();
    this.d10005470();
    this.p10003d60();
    if (I[0xc48b] !== 0) { d.present(); return; }
  }
  private mat(o: number): Float32Array { return this.F.subarray(o >> 2, (o >> 2) + 16); }
  /** 0x10004cd0: the camera and object matrices */
  private m10004cd0(): void {
    const F = this.F;
    for (const o of [0x2dbe8, 0x2dc28, 0x2dba8, 0x2dc68, 0x2dca8, 0x2dce8]) for (let k = 0; k < 16; k++) F[(o >> 2) + k] = k % 5 === 0 ? 1 : 0;
    this.sf(0x1fd0, -54); this.sf(0x1fd8, 1.600000023841858);
    translation(this.mat(0x2dbe8), this.f(0x1f98), this.f(0x1f9c), this.f(0x1fa0));
    translation(this.mat(0x2dba8), this.f(0x1fb0), this.f(0x1fb4), this.f(0x1fb8));
    translation(this.mat(0x2dc68), this.f(0x1fc8), this.f(0x1fcc), this.f(0x1fd0));
    translation(this.mat(0x2dca8), this.f(0x1fe0), this.f(0x1fe4), this.f(0x1fe8));
    translation(this.mat(0x2dce8), this.f(0x1ff8), this.f(0x1ffc), this.f(0x2000));
    const q = new Float32Array(4), M = new Float32Array(16);
    const rot = (o: number, dst: number): void => {
      quatYawPitchRoll(q, this.f(o), this.f(o + 4), this.f(o + 8));
      matRotQuat(M, q);
      matMul(this.mat(dst), M, this.mat(dst));
    };
    rot(0x1fa4, 0x2dbe8);
    rot(0x1fbc, 0x2dba8);
    rot(0x1fd4, 0x2dc68);
    rot(0x1fec, 0x2dca8);        // 10005200 zeroes the rotation matrix first: same result
    rot(0x2004, 0x2dce8);
    matMul(this.mat(0x2dca8), this.mat(0x2dca8), this.mat(0x2dba8));
    matMul(this.mat(0x2dce8), this.mat(0x2dce8), this.mat(0x2dba8));
  }

  /** 0x10005240: CWater::Update and the caustics pass into the render target */
  private c10005240(): void {
    const I = this.I;
    if (I[0xb6e4] !== 1) return;
    const caustics = I[0xb6e5] !== 0 && this.effUsesCaustics();
    this.w10006b30(caustics);
    this.sf(0x35f0, this.f(0x2dba0) + this.f(0x35f0));
    if (!caustics) return;
    const d = this.d;
    this.rtsBegin();
    const aspect = fr(this.i(0x35c0) * 0.20000000298023224 / this.i(0x35c4));
    perspectiveFovRH(this.mat(0x2dd68), 1.0471975803375244, aspect, 0.10000000149011612, 2000);
    d.setTransform(Ts.PROJECTION, this.mat(0x2dd68));
    d.setTransform(Ts.WORLD, this.mat(0x2dc68));
    d.clear(null, ClearFlag.TARGET, 0xff000000, 0, 0);
    d.setRenderState(Rs.ZENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 1);
    // 0x10007150 CWater::DrawCaustics
    d.setVertexShader(0x42);
    d.setStreamSource(0, this.obj<Buffer>(0x3488), 0x10);
    d.setIndices(this.obj<Buffer>(0x3480), 0);
    d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, this.i(0x3470), 0, this.i(0x346c) - 2);
    d.setRenderState(Rs.CULLMODE, 2); d.setRenderState(Rs.ALPHABLENDENABLE, 0); d.setRenderState(Rs.ZENABLE, 1);
    this.rtsEnd();
  }
  private effUsesCaustics(): boolean { return true; }  // ID3DXEffect::IsParameterUsed("tCAU") for T0
  // ---- ID3DXRenderToSurface (128x128, no depth) ----
  private rtsBlock = 0; private rtsOld: Surface | null = null; private rtsOldDs: Surface | null = null;
  private rtsBegin(): void {
    const d = this.d;
    const vp = new ArrayBuffer(24), vv = new DataView(vp);
    vv.setUint32(8, 128, true); vv.setUint32(12, 128, true); vv.setFloat32(16, 0, true); vv.setFloat32(20, 1, true);
    if (!this.rtsBlock) { d.beginStateBlock(); d.setViewport(vp); this.rtsBlock = d.endStateBlock(); }
    d.captureStateBlock(this.rtsBlock);
    this.rtsOld = d.getRenderTarget(); this.rtsOldDs = d.getDepthStencilSurface();
    d.setRenderTarget(this.obj<Surface>(0x2db8c), null);
    d.setViewport(vp);
    d.beginScene();
  }
  private rtsEnd(): void {
    const d = this.d;
    d.endScene();
    d.setRenderTarget(this.rtsOld, this.rtsOldDs);
    d.applyStateBlock(this.rtsBlock);
  }

  /** 0x10005890: the first time, render once and find the first row the water left non-black (0x36f0) */
  private s10005890(): void {
    if (this.i(0x36f0) !== 0) return;
    this.d10005470();
    const bb = this.d.getBackBuffer();
    const L = bb.lockRect(null, Lock.NOSYSLOCK);
    const pitch = L.pitch >>> 2, u = new Uint32Array(L.data.buffer, L.data.byteOffset, (L.data.byteLength >> 2));
    this.si(0x2db4c, pitch); this.si(0x36e8, this.i(0x35c0)); this.si(0x36ec, this.i(0x35c4));
    let y = 0;
    for (; y < this.i(0x35c4); y++) if (u[y * pitch] !== 0) break;
    this.si(0x36f0, y);
    bb.unlockRect();
  }
  /** 0x10005470: the water over the 2D layer in the back buffer */
  private d10005470(): void {
    const I = this.I, d = this.d;
    d.beginScene();
    const aspect = fr(this.i(0x35c0) * 0.20000000298023224 / this.i(0x35c4));
    this.sf(0x2dba4, aspect);
    perspectiveFovRH(this.mat(0x2dd28), 1.0471975803375244, aspect, 0.10000000149011612, 2000);
    d.setTransform(Ts.PROJECTION, this.mat(0x2dd28));
    d.setTransform(Ts.WORLD, this.mat(0x2dca8));
    if (this.i(0x36f0) === 0) d.clear(null, ClearFlag.TARGET, 0, 1, 0);
    else { I[0x734] = 6; if (!this.cpu10005670()) d.clear(null, ClearFlag.TARGET, 0, 1, 0); }
    d.clear(null, ClearFlag.ZBUFFER, 0, 1, 0);
    if (I[0xb6e4] === 1) {
      d.setRenderState(Rs.ALPHABLENDENABLE, 1); d.setRenderState(Rs.SRCBLEND, 5); d.setRenderState(Rs.DESTBLEND, 6);
      if (this.f(0x2dba4) < 0.662) {
        d.captureStateBlock(this.effSaved);    // Begin
        this.effPass0();                       // Pass(0)
        // 0x100071e0 CWater::DrawSurface
        d.setStreamSource(0, this.obj<Buffer>(0x3484), 0x24);
        d.setIndices(this.obj<Buffer>(0x3480), 0);
        d.drawIndexedPrimitive(Prim.TRIANGLESTRIP, 0, this.i(0x3470), 0, this.i(0x346c) - 2);
        d.applyStateBlock(this.effSaved);      // End
      }
    }
    d.endScene();
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  }
  /** 0x10005670: sprite 6 (the 2D layer) into the back buffer, then the equalizer over it */
  private cpu10005670(): boolean {
    const I = this.I, s = this.cur;
    const w = I[(0xa20 + s * 0x1ec) >> 2], h = I[(0xa24 + s * 0x1ec) >> 2];
    I[0x31034 >> 2] = w; I[0x31028 >> 2] = h; I[0x310d4 >> 2] = Math.imul(w, h);
    if (I[(0x99c + s * 0x1ec) >> 2] !== -1 || Math.imul(w, h) === 0) return false;
    const bb = this.d.getBackBuffer();
    const L = bb.lockRect(null, Lock.NOSYSLOCK);
    const pitch = L.pitch >>> 2;
    this.si(0x2db4c, pitch); this.si(0x36e8, this.i(0x35c0)); this.si(0x36ec, this.i(0x35c4));
    if (w !== this.i(0x35c0) || h !== this.i(0x35c4)) { bb.unlockRect(); return false; }
    const src = I[(0x9c0 + s * 0x1ec) >> 2];
    const u = new Uint32Array(L.data.buffer, L.data.byteOffset, L.data.byteLength >> 2);
    for (let y = 0; y < h; y++) u.set(this.U.subarray((src >> 2) + y * w, (src >> 2) + (y + 1) * w), y * pitch);
    drawEq(this, u, pitch);
    bb.unlockRect();
    return true;
  }

  // ======== particles (the DirectX 8 SDK PointSprites sample's CParticleSystem) ========
  private particleTex: Texture | null = null; private particleVb: Buffer | null = null;
  private p10003d60(): void {
    const d = this.d, I = this.I;
    if (!this.particleTex) {
      this.particleTex = textureFromPixels(d, this.opt.art.particle(), 128, 128, Fmt.X8R8G8B8);
      I[0xb773] = this.handle(this.particleTex);
    }
    if (I[0xd35] === 2) this.sf(0x35f4, 0.05000000074505806);
    // 0x10003f20: no particle is alive and none may be emitted (maximum 0): only the clock advances
    this.particleClock = fr(this.particleClock + this.f(0x35f4));
    d.setTransform(Ts.WORLD, this.mat(0x2dce8));
    d.beginScene();
    d.setRenderState(Rs.ZWRITEENABLE, 0); d.setRenderState(Rs.ALPHABLENDENABLE, 1);
    d.setTexture(0, this.particleTex);
    d.setTextureStageState(0, Tss.COLOROP, 4); d.setTextureStageState(0, Tss.ALPHAOP, 4);
    d.setTextureStageState(1, Tss.COLOROP, 1); d.setTextureStageState(1, Tss.ALPHAOP, 1);
    d.setRenderState(Rs.SRCBLEND, 2); d.setRenderState(Rs.DESTBLEND, 2); d.setRenderState(Rs.SHADEMODE, 1);
    this.p10004510();
    d.setRenderState(Rs.ZWRITEENABLE, 1); d.setRenderState(Rs.ALPHABLENDENABLE, 0);
    d.endScene();
    d.setRenderState(Rs.ALPHABLENDENABLE, 0);
  }
  private particleClock = 0;
  /** 0x10004510 CParticleSystem::Render with no particles: states set, the next chunk locked and released */
  private p10004510(): void {
    const d = this.d, I = this.I;
    if (!this.particleVb) this.particleVb = d.createVertexBuffer(I[0x2ddb8 >> 2] << 4, Usage.DYNAMIC | Usage.WRITEONLY | Usage.POINTS, 0x42, Pool.DEFAULT);
    d.setRenderState(Rs.POINTSPRITEENABLE, 1); d.setRenderState(Rs.POINTSCALEENABLE, 1);
    d.setRenderState(Rs.POINTSIZE, I[0x2084 >> 2]); d.setRenderState(Rs.POINTSIZE_MIN, I[0x2088 >> 2]);
    d.setRenderState(Rs.POINT_SCALE_A, I[0x208c >> 2]); d.setRenderState(Rs.POINT_SCALE_B, I[0x2090 >> 2]); d.setRenderState(Rs.POINT_SCALE_C, I[0x2094 >> 2]);
    d.setStreamSource(0, this.particleVb, 0x10);
    d.setVertexShader(0x42);
    let base = I[0x2ddb0 >> 2] + I[0x2ddb4 >> 2];
    if ((base >>> 0) >= (I[0x2ddb8 >> 2] >>> 0)) base = 0;
    I[0x2ddb0 >> 2] = base;
    this.particleVb.lock(base * 16, I[0x2ddb4 >> 2] * 16, base ? Lock.NOOVERWRITE : Lock.DISCARD);
    this.particleVb.unlock();
    d.setRenderState(Rs.POINTSPRITEENABLE, 0); d.setRenderState(Rs.POINTSCALEENABLE, 0);
  }
}
